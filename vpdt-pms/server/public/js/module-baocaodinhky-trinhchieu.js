// ============ TỔNG HỢP BẰNG GHÉP FILE PDF THẬT (entryType==='PDF') — song song khối PPTX ở trên,
// dựng period.pdfCompilation (TÁCH RIÊNG khỏi period.compilation), xem mergeReportPeriodPdf()/
// publishReportPeriodPdf() ở lib/recordActions.js. ============

// Render lại toàn bộ N trang của 1 entry PDF (pdf.js, ngay trong trình duyệt) — cache theo entryId để
// tick/bỏ tick qua lại nhiều lần không phải tải/vẽ lại. pdfjsLib đã sẵn toàn cục (nạp sẵn lúc mở trang,
// xem window.renderPdfProtected/type="module" script cuối trang), không cần loadVendorScript() riêng.
function ensureEntryPagesCached(entryId) {
  if (prAggPdfEntryPagesCache.has(entryId)) return prAggPdfEntryPagesCache.get(entryId);
  const entry = DB.reportEntries.find(e => e.id === entryId);
  const promise = (async () => {
    if (!entry || !entry.fileUrl) return [];
    const pdf = await window.pdfjsLib.getDocument(entry.fileUrl).promise;
    const urls = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 0.35 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      urls.push(canvas.toDataURL('image/png'));
    }
    return urls;
  })();
  prAggPdfEntryPagesCache.set(entryId, promise);
  return promise;
}

// Gọi khi mở lại 1 kỳ đã từng tổng hợp PDF từ trước — pdfCompilation.pages chỉ lưu {sourceEntryId,
// sourcePageIndex,...}, KHÔNG lưu ảnh thumbnail (server không nhận/giữ dataUrl), nên phải render lại từ
// chính file gốc mỗi lần mở lại màn Tổng Hợp.
async function loadPrAggPdfThumbnails() {
  const distinctEntryIds = [...new Set(prAggPdfPages.map(p => p.sourceEntryId))];
  for (const entryId of distinctEntryIds) {
    try {
      const dataUrls = await ensureEntryPagesCached(entryId);
      prAggPdfPages.forEach((p) => { if (p.sourceEntryId === entryId && !p.dataUrl) p.dataUrl = dataUrls[p.sourcePageIndex] || ''; });
    } catch (err) { /* để trống ảnh, thẻ vẫn hiện được tên trang/phòng ban */ }
  }
  renderPrAggPdfGrid();
}

function renderPrAggPdfEntriesList() {
  const el = document.getElementById('prAggPdfEntriesList');
  const entries = getPrAggPdfPeriodEntries();
  if (!entries.length) {
    el.innerHTML = `<div class="text-xs text-gray-400 italic">Chưa có báo cáo PDF nào được gửi trong kỳ này.</div>`;
    return;
  }
  el.innerHTML = entries.map(e => `
    <label class="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-sky-50 cursor-pointer">
      <input type="checkbox" data-op-change="onPrAggPdfEntryCheckboxChange" data-arg0="${e.id}" data-arg-el="1" ${prAggPdfSelectedIds.includes(e.id) ? 'checked' : ''}>
      <span class="font-semibold text-gray-700">${escapeHtml(e.title)}</span>
      <span class="text-gray-400">— ${escapeHtml(e.creatorName)} (${escapeHtml(e.dept)})</span>
    </label>
  `).join('');
}

// Tick 1 báo cáo PDF -> render TOÀN BỘ trang của nó rồi thêm vào cuối prAggPdfPages (ĐÚNG thứ tự trang
// gốc); bỏ tick -> gỡ hết trang thuộc entry đó khỏi prAggPdfPages (không đụng thứ tự các trang còn lại).
// Wrapper CSP-safe cho checkbox onchange="togglePrAggPdfEntry(id, this.checked)" cũ (giống
// onPrAggEntryCheckboxChange() ở khối Tổng Hợp PPTX phía trên).
function onPrAggPdfEntryCheckboxChange(entryId, el) { togglePrAggPdfEntry(entryId, el.checked); }
async function togglePrAggPdfEntry(entryId, checked) {
  const entry = DB.reportEntries.find(e => e.id === entryId);
  if (!entry) return;
  const statusEl = document.getElementById('prAggPdfStatusLine');
  if (checked) {
    if (!prAggPdfSelectedIds.includes(entryId)) prAggPdfSelectedIds.push(entryId);
    statusEl.className = 'text-xs text-gray-500';
    statusEl.innerText = `⏳ Đang đọc trang của "${entry.title}"...`;
    try {
      const dataUrls = await ensureEntryPagesCached(entryId);
      dataUrls.forEach((dataUrl, pageIndex) => {
        prAggPdfPages.push({ sourceEntryId: entryId, sourceDept: entry.dept, sourceCreatorName: entry.creatorName, sourceFileName: entry.fileName, sourcePageIndex: pageIndex, dataUrl });
      });
      statusEl.innerText = '';
    } catch (err) {
      statusEl.className = 'text-xs text-rose-600';
      statusEl.innerText = `⛔ Không đọc được file của "${entry.title}": ${err.message}`;
      prAggPdfSelectedIds = prAggPdfSelectedIds.filter(id => id !== entryId);
    }
  } else {
    prAggPdfSelectedIds = prAggPdfSelectedIds.filter(id => id !== entryId);
    prAggPdfPages = prAggPdfPages.filter(p => p.sourceEntryId !== entryId);
  }
  renderPrAggPdfEntriesList();
  renderPrAggPdfGrid();
}

function renderPrAggPdfGrid() {
  const grid = document.getElementById('prAggPdfGrid');
  document.getElementById('prAggPdfGridWrap').classList.toggle('hidden', prAggPdfPages.length === 0);
  grid.innerHTML = '';
  prAggPdfPages.forEach((pg, idx) => {
    const card = document.createElement('div');
    card.className = 'pr-pdf-page-card';
    card.draggable = true;
    card.addEventListener('dragstart', () => { prAggPdfDragFromIndex = idx; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('dragover'); });
    card.addEventListener('dragleave', () => card.classList.remove('dragover'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('dragover');
      if (prAggPdfDragFromIndex === null || prAggPdfDragFromIndex === idx) return;
      const moved = prAggPdfPages.splice(prAggPdfDragFromIndex, 1)[0];
      prAggPdfPages.splice(idx, 0, moved);
      prAggPdfDragFromIndex = null;
      renderPrAggPdfGrid();
    });

    const idxBadge = document.createElement('div');
    idxBadge.className = 'pr-pdf-idx';
    idxBadge.textContent = String(idx + 1);
    card.appendChild(idxBadge);

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'pr-pdf-rm';
    rmBtn.textContent = '✕';
    rmBtn.title = 'Bỏ trang này khỏi bản ghép';
    rmBtn.onclick = () => { prAggPdfPages.splice(idx, 1); renderPrAggPdfGrid(); };
    card.appendChild(rmBtn);

    const img = document.createElement('img');
    img.src = pg.dataUrl || '';
    img.alt = `Trang ${pg.sourcePageIndex + 1} — ${escapeHtml(pg.sourceFileName || '')}`;
    card.appendChild(img);

    const src = document.createElement('div');
    src.className = 'pr-pdf-src';
    src.textContent = `${pg.sourceDept} · tr.${pg.sourcePageIndex + 1}`;
    src.title = `${pg.sourceCreatorName || ''} — ${pg.sourceFileName || ''} — trang ${pg.sourcePageIndex + 1}`;
    card.appendChild(src);

    grid.appendChild(card);
  });
}

function updatePrAggPdfActionsWrap(period) {
  const wrap = document.getElementById('prAggPdfActionsWrap');
  const hasCompilation = !!period?.pdfCompilation;
  wrap.classList.toggle('hidden', !hasCompilation);
  const isPublished = period?.pdfCompilation?.status === 'PUBLISHED';
  document.getElementById('btnPrPdfPublish').classList.toggle('hidden', !hasCompilation || isPublished);
  document.getElementById('btnPrPdfUnpublish').classList.toggle('hidden', !isPublished);
  // Đã phát hành thì khoá toàn bộ khu chọn/sắp trang — không sửa được nữa, phải "Hủy Phát Hành" trước.
  document.querySelectorAll('#prAggPdfEntriesList input[type=checkbox]').forEach((cb) => { cb.disabled = isPublished; });
  const gridWrap = document.getElementById('prAggPdfGridWrap');
  gridWrap.classList.toggle('opacity-50', isPublished);
  gridWrap.classList.toggle('pointer-events-none', isPublished);
}

// Chỉ hiện khối Ghép PDF khi kỳ CÓ báo cáo PDF đã gửi, hoặc đã từng tổng hợp/phát hành PDF trước đó (để
// vẫn xem/"Hủy Phát Hành" được dù không còn entry PDF hợp lệ nào — hiếm nhưng không nên chặn thao tác).
function renderPrAggPdfSection() {
  const period = DB.reportPeriods.find(p => p.id === prAggCurrentPeriodId);
  const pdfEntries = getPrAggPdfPeriodEntries();
  const section = document.getElementById('prAggPdfSection');
  const shouldShow = pdfEntries.length > 0 || !!period?.pdfCompilation;
  section.classList.toggle('hidden', !shouldShow);
  if (!shouldShow) return;

  const validIds = new Set(pdfEntries.map(e => e.id));
  const savedPages = (period.pdfCompilation?.pages || []).filter(p => validIds.has(p.sourceEntryId));
  prAggPdfSelectedIds = [...new Set(savedPages.map(p => p.sourceEntryId))];
  prAggPdfPages = savedPages.map(p => ({ ...p, dataUrl: null }));

  renderPrAggPdfEntriesList();
  renderPrAggPdfGrid();
  updatePrAggPdfActionsWrap(period);
  if (prAggPdfPages.length) loadPrAggPdfThumbnails();
}

async function mergeReportPeriodPdfAction() {
  if (!prAggCurrentPeriodId) return;
  if (!prAggPdfPages.length) return alert('Vui lòng chọn ít nhất 1 báo cáo PDF và giữ lại ít nhất 1 trang để tổng hợp!');
  const period = DB.reportPeriods.find(p => p.id === prAggCurrentPeriodId);
  if (!period) return;
  if (period.pdfCompilation?.status === 'PUBLISHED') {
    return alert('⛔ Bản tổng hợp PDF đã phát hành — vui lòng "Hủy phát hành" trước khi tổng hợp lại.');
  }
  const pages = prAggPdfPages.map(p => ({ sourceEntryId: p.sourceEntryId, sourcePageIndex: p.sourcePageIndex }));
  let result;
  try {
    result = await callRecordAction('reportPeriods', prAggCurrentPeriodId, 'mergePdf', { entryIds: prAggPdfSelectedIds, pages });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const updated = result.item;
  const idx = DB.reportPeriods.findIndex(p => p.id === updated.id);
  if (idx !== -1) DB.reportPeriods[idx] = updated;
  logSystemAction('PERIODIC_REPORT', 'MERGE_REPORT_PERIOD_PDF', `Tổng hợp PDF kỳ báo cáo [${updated.name}]: ${pages.length} trang`, 'SUCCESS', String(updated.id));
  alert('✅ Đã tổng hợp bản ghép PDF — có thể tiếp tục chọn/sắp/xoá trang rồi tổng hợp lại, hoặc bấm "Phát Hành PDF" khi đã ưng ý.');
  updatePrAggPdfActionsWrap(updated);
  renderPrPeriodsTable();
}

async function publishPrPdfCompilation() {
  if (!prAggCurrentPeriodId) return;
  const statusEl = document.getElementById('prAggPdfStatusLine');
  statusEl.className = 'text-xs text-gray-500';
  statusEl.innerText = '⏳ Đang ghép + đóng dấu file PDF cuối cùng (có thể mất vài giây)...';
  let result;
  try {
    result = await callRecordAction('reportPeriods', prAggCurrentPeriodId, 'publishPdf', {});
  } catch (err) {
    statusEl.className = 'text-xs text-rose-600';
    statusEl.innerText = `⛔ ${err.message}`;
    return;
  }
  const updated = result.item;
  const idx = DB.reportPeriods.findIndex(p => p.id === updated.id);
  if (idx !== -1) DB.reportPeriods[idx] = updated;
  logSystemAction('PERIODIC_REPORT', 'PUBLISH_REPORT_PERIOD_PDF', `Phát hành bản ghép PDF kỳ báo cáo [${updated.name}]`, 'SUCCESS', String(updated.id));
  statusEl.className = 'text-xs text-emerald-700';
  statusEl.innerText = '✅ Đã phát hành bản ghép PDF!';
  updatePrAggPdfActionsWrap(updated);
  renderPrPeriodsTable();
  renderPrPublishedTable();
}

async function unpublishPrPdfCompilation() {
  if (!prAggCurrentPeriodId) return;
  let result;
  try {
    result = await callRecordAction('reportPeriods', prAggCurrentPeriodId, 'unpublishPdf', {});
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const updated = result.item;
  const idx = DB.reportPeriods.findIndex(p => p.id === updated.id);
  if (idx !== -1) DB.reportPeriods[idx] = updated;
  logSystemAction('PERIODIC_REPORT', 'UNPUBLISH_REPORT_PERIOD_PDF', `Hủy phát hành bản ghép PDF kỳ báo cáo [${updated.name}]`, 'SUCCESS', String(updated.id));
  alert('✅ Đã hủy phát hành bản ghép PDF — có thể tổng hợp lại.');
  updatePrAggPdfActionsWrap(updated);
  renderPrPeriodsTable();
  renderPrPublishedTable();
}

// Đối Chiếu Theo Công Việc — dựng period.taskCompilation (xem mergeReportPeriodByTasks() ở
// lib/recordActions.js), TÁCH RIÊNG hoàn toàn khỏi period.compilation (bản tổng hợp chính thức từ báo
// cáo người dùng nộp, mergeReportPeriodAction() ở trên) — chỉ để xem/đối chiếu, không sửa/phát hành,
// sinh lại từ đầu (ghi đè bản taskCompilation cũ) mỗi lần bấm.
async function mergeReportPeriodByTasksAction() {
  if (!prAggCurrentPeriodId) return;
  const period = DB.reportPeriods.find(p => p.id === prAggCurrentPeriodId);
  if (!period) return;
  let result;
  try {
    result = await callRecordAction('reportPeriods', prAggCurrentPeriodId, 'mergeByTasks', {});
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const updated = result.item;
  const idx = DB.reportPeriods.findIndex(p => p.id === updated.id);
  if (idx !== -1) DB.reportPeriods[idx] = updated;
  logSystemAction('PERIODIC_REPORT', 'MERGE_REPORT_PERIOD_BY_TASKS', `Đối chiếu kỳ báo cáo [${updated.name}] theo Công Việc`, 'SUCCESS', String(updated.id));
  if (result.warning) alert(`⚠️ ${result.warning}`);
  renderPrTaskCompilation();
}

// Render CHỈ XEM period.taskCompilation.slides — dùng chung PR_SLIDE_KIND_LABELS/kiểu hiển thị đơn giản
// (không có khối sửa như renderPrAggCompilation(), vì bản đối chiếu này không cần sửa/lưu/phát hành).
function renderPrTaskCompilation() {
  const wrap = document.getElementById('prTaskCompilationWrap');
  const el = document.getElementById('prTaskCompilationSlidesList');
  if (!wrap || !el) return;
  const period = DB.reportPeriods.find(p => p.id === prAggCurrentPeriodId);
  const slides = period?.taskCompilation?.slides;
  if (!slides || !slides.length) {
    wrap.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  wrap.classList.remove('hidden');
  el.innerHTML = slides.map((s, idx) => {
    const kindLabel = PR_SLIDE_KIND_LABELS[s.kind] || s.kind;
    let bodyHTML = '';
    if (s.kind === 'TASK_STATS') {
      bodyHTML = `<pre class="text-xs whitespace-pre-wrap">${escapeHtml(s.text || '')}</pre>`;
    } else if (s.kind === 'TASKS') {
      bodyHTML = `
        <table class="w-full text-[11px] border-collapse">
          <thead><tr class="bg-gray-100 text-left"><th class="border p-1">Nội dung</th><th class="border p-1">Tiến độ</th><th class="border p-1">Deadline</th><th class="border p-1">Hỗ trợ</th></tr></thead>
          <tbody>${(s.items || []).map(it => `<tr><td class="border p-1">${escapeHtml(it.content || '')}</td><td class="border p-1">${escapeHtml(it.progress || '')}</td><td class="border p-1">${escapeHtml(it.deadline || '')}</td><td class="border p-1">${escapeHtml(it.support || '')}</td></tr>`).join('')}</tbody>
        </table>
        ${s.sourceCreatorName ? `<div class="text-[11px] text-gray-500 mt-1">${escapeHtml(s.sourceCreatorName)} — ${escapeHtml(s.sourceDept || '')}</div>` : ''}
      `;
    }
    return `
      <div class="border rounded p-2 bg-gray-50">
        <div class="text-[11px] font-bold text-teal-700 mb-1">Phần ${idx + 1} — ${escapeHtml(kindLabel)}</div>
        <div class="font-semibold text-xs mb-1">${escapeHtml(s.title || '')}</div>
        ${bodyHTML}
      </div>
    `;
  }).join('');
}

const PR_SLIDE_KIND_LABELS = { COVER: 'Trang bìa', DEPT: 'Chia phòng ban', TASKS: 'Bảng công việc', PLAN: 'Bảng kế hoạch', NUMBERS: 'Số liệu', OTHER: 'Khác', FILE: 'Tệp đính kèm', TASK_STATS: 'Thống kê công việc', PPTX_SLIDE: 'Trang PowerPoint' };

// Xuất PDF/Excel cho "Tổng Hợp Theo Công Việc" (period.taskCompilation) — yêu cầu người dùng, đợt bỏ
// upload PPTX. PDF: mirror ĐÚNG kỹ thuật exportBudgetSummaryPdf() (module-ngansach.js) — dựng lại nội
// dung ĐANG HIỂN THỊ (#prTaskCompilationSlidesList, đã render sẵn bởi renderPrTaskCompilation()) vào 1
// stage ẩn bề rộng cố định khổ A4, chụp html2canvas, cắt lát theo chiều cao 1 trang rồi ghép PDF nhiều
// trang bằng jsPDF — khác downloadPrPdf() ở trên (dựng slideshow 16:9 từ template màu), vì taskCompilation
// vốn là bảng/text đơn giản, không phải slideshow. Excel: dùng ĐÚNG route dùng chung
// POST /api/admin/export-xlsx (downloadXlsxFromServer(), cùng khuôn exportOperationWorkItems() ở
// module-vanhanh.js) — làm PHẲNG slides thành 1 dòng/công việc (dễ lọc/sắp xếp lại hơn giữ cấu trúc slide).
const PR_TASK_PDF_PAGE_W = 794;  // A4 @ 96dpi (px)
const PR_TASK_PDF_PAGE_H = 1123;
const PR_TASK_PDF_MARGIN = 30;
const PR_TASK_PDF_CAPTURE_SCALE = 2;

async function exportPrTaskCompilationPdf() {
  const period = DB.reportPeriods.find(p => p.id === prAggCurrentPeriodId);
  const source = document.getElementById('prTaskCompilationSlidesList');
  if (!period?.taskCompilation?.slides?.length || !source) {
    return alert('Chưa có bản đối chiếu nào — bấm "🗂️ Đối Chiếu Theo Công Việc" trước.');
  }
  const btn = document.getElementById('btnPrTaskCompilationExportPdf');
  const originalLabel = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Đang tạo PDF...'; }
  const stage = document.createElement('div');
  try {
    await Promise.all([
      loadVendorScript('/vendor/html2canvas/html2canvas.min.js'),
      loadVendorScript('/vendor/jspdf/jspdf.umd.min.js')
    ]);
    const contentWidth = PR_TASK_PDF_PAGE_W - PR_TASK_PDF_MARGIN * 2;
    stage.style.cssText = `position:fixed;left:-10000px;top:0;width:${contentWidth}px;background:#fff;color:#111;box-sizing:border-box;font-family:Arial,'Segoe UI',sans-serif;font-size:12px;`;
    stage.innerHTML = `<h2 style="font-size:16px;font-weight:bold;margin:0 0 12px;">TỔNG HỢP THEO CÔNG VIỆC — ${escapeHtml(period.name)}</h2>` + source.innerHTML;
    document.body.appendChild(stage);

    const bigCanvas = await window.html2canvas(stage, { backgroundColor: '#ffffff', scale: PR_TASK_PDF_CAPTURE_SCALE, useCORS: true, logging: false });

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'px', format: [PR_TASK_PDF_PAGE_W, PR_TASK_PDF_PAGE_H], compress: true });

    const pageCanvasW = PR_TASK_PDF_PAGE_W * PR_TASK_PDF_CAPTURE_SCALE;
    const pageCanvasH = PR_TASK_PDF_PAGE_H * PR_TASK_PDF_CAPTURE_SCALE;
    const marginPx = PR_TASK_PDF_MARGIN * PR_TASK_PDF_CAPTURE_SCALE;
    const sliceH = (PR_TASK_PDF_PAGE_H - PR_TASK_PDF_MARGIN * 2) * PR_TASK_PDF_CAPTURE_SCALE;
    const totalPages = Math.min(100, Math.max(1, Math.ceil(bigCanvas.height / sliceH)));

    for (let i = 0; i < totalPages; i++) {
      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = pageCanvasW;
      pageCanvas.height = pageCanvasH;
      const ctx = pageCanvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pageCanvasW, pageCanvasH);
      const thisSliceH = Math.min(sliceH, bigCanvas.height - i * sliceH);
      if (thisSliceH > 0) {
        ctx.drawImage(bigCanvas, 0, i * sliceH, bigCanvas.width, thisSliceH, marginPx, marginPx, bigCanvas.width, thisSliceH);
      }
      const imgData = pageCanvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) doc.addPage([PR_TASK_PDF_PAGE_W, PR_TASK_PDF_PAGE_H], 'portrait');
      doc.addImage(imgData, 'JPEG', 0, 0, PR_TASK_PDF_PAGE_W, PR_TASK_PDF_PAGE_H);
    }

    const safeName = (period.name || 'KyBaoCao').replace(/[\\/:*?"<>|]+/g, '_');
    doc.save(`TongHopTheoCongViec_${safeName}.pdf`);
    logSystemAction('PERIODIC_REPORT', 'EXPORT_TASK_COMPILATION_PDF', `Xuất PDF Tổng Hợp Theo Công Việc kỳ [${period.name}]`, 'SUCCESS', String(period.id));
  } catch (err) {
    alert('⛔ Không tạo được PDF: ' + err.message);
  } finally {
    stage.remove();
    if (btn) { btn.disabled = false; btn.innerHTML = originalLabel; }
  }
}

async function exportPrTaskCompilationExcel() {
  const period = DB.reportPeriods.find(p => p.id === prAggCurrentPeriodId);
  const slides = period?.taskCompilation?.slides;
  if (!slides?.length) return alert('Chưa có bản đối chiếu nào — bấm "🗂️ Đối Chiếu Theo Công Việc" trước.');

  const columns = [
    { header: 'Phòng Ban', key: 'dept', width: 22 },
    { header: 'Người Phụ Trách', key: 'person', width: 22 },
    { header: 'Nội Dung Công Việc', key: 'content', width: 40 },
    { header: 'Tiến Độ', key: 'progress', width: 16 },
    { header: 'Hạn Chót', key: 'deadline', width: 14 },
    { header: 'Hỗ Trợ', key: 'support', width: 22 }
  ];
  // Làm PHẲNG slides -> 1 dòng/công việc: DEPT set phòng ban đang xét cho các slide TASKS theo SAU nó
  // (đúng thứ tự đã dựng ở mergeReportPeriodByTasks(), TASKS.sourceDept cũng đã có sẵn nên dùng trực
  // tiếp field đó cho chắc, currentDept chỉ là phòng hờ nếu thiếu).
  let currentDept = '';
  const rows = [];
  slides.forEach((s) => {
    if (s.kind === 'DEPT') { currentDept = s.title || ''; return; }
    if (s.kind !== 'TASKS') return;
    (s.items || []).forEach((it) => {
      rows.push({
        dept: s.sourceDept || currentDept,
        person: s.sourceCreatorName || '',
        content: it.content || '',
        progress: it.progress || '',
        deadline: formatDateVN(it.deadline),
        support: it.support || ''
      });
    });
  });
  if (!rows.length) return alert('Không có công việc nào để xuất.');

  try {
    await ensureFnReady('downloadXlsxFromServer');
  } catch (err) {
    return alert('⛔ Không tải được bộ xuất Excel: ' + err.message);
  }
  const safeName = (period.name || 'KyBaoCao').replace(/[^\p{L}\p{N}]+/gu, '_');
  await downloadXlsxFromServer(`TongHopTheoCongViec_${safeName}.xlsx`, 'Tổng Hợp Theo Công Việc', columns, rows);
  logSystemAction('PERIODIC_REPORT', 'EXPORT_TASK_COMPILATION_XLSX', `Xuất Excel Tổng Hợp Theo Công Việc kỳ [${period.name}]`, 'SUCCESS', String(period.id));
}

// 2 mẫu màu cố định cho trình chiếu/PDF Báo Cáo Định Kỳ — KHÔNG còn chọn được (đã gỡ tính năng "Mẫu
// Trình Chiếu" tự tạo, mọi kỳ mới đều dùng đúng 'DEFAULT'). 'ORANGE_GOLD' chỉ còn đọc lại cho các kỳ đã
// tạo TRƯỚC đây có chọn mẫu này (period.slideTemplate cũ) — không xoá để không vỡ hiển thị kỳ cũ.
const PR_SLIDE_TEMPLATES = {
  DEFAULT: {
    pageBg: '#000000', coverTitleColor: '#ffffff', coverAccentColor: 'transparent',
    sectionTitleColor: '#ffffff', bodyTextColor: '#e5e7eb', sourceLabelColor: '#d1d5db',
    tableBorder: 'rgba(255,255,255,0.2)', tableHeadBg: 'rgba(255,255,255,0.1)', tableText: '#ffffff',
    navBtnBg: 'rgba(255,255,255,0.1)', navBtnText: '#ffffff', topBarBg: '#111827'
  },
  ORANGE_GOLD: {
    pageBg: '#ffffff', coverTitleColor: '#F58320', coverAccentColor: '#FFB200',
    sectionTitleColor: '#D86C0A', bodyTextColor: '#1e293b', sourceLabelColor: '#64748b',
    tableBorder: '#f0d9b5', tableHeadBg: '#FFF3E0', tableText: '#1e293b',
    navBtnBg: 'rgba(245,131,32,0.12)', navBtnText: '#D86C0A', topBarBg: '#111827'
  }
};

// templateRef: chuỗi 'DEFAULT'/'ORANGE_GOLD' (period.slideTemplate của kỳ cũ) hoặc undefined (kỳ mới,
// không còn chọn mẫu — luôn rơi về DEFAULT). Trả về đủ 12 field màu + bgImageUrl:null (khung dựng slide
// buildPrSlideScreenHTML()... vẫn đọc field này, giữ để không phải sửa lại các hàm đó).
function getPrSlideTemplateColors(templateRef) {
  return { ...(PR_SLIDE_TEMPLATES[templateRef] || PR_SLIDE_TEMPLATES.DEFAULT), bgImageUrl: null };
}

// Danh sách slide đang sửa (prAggPendingSlides) là bản nháp CHỈ Ở CLIENT — chỉ thực sự lưu lại khi
// bấm "Lưu Chỉnh Sửa" (savePrCompilation()), tránh gọi API liên tục mỗi lần gõ phím. Mỗi slide.kind
// (đặt lúc Tổng Hợp — xem mergeReportPeriod() ở lib/recordActions.js) có khối sửa RIÊNG khớp đúng field
// của kind đó: TASKS/PLAN sửa bằng bảng dòng động (renderPrItemsTable(), dùng chung với form Nhập Báo
// Cáo), NUMBERS/OTHER sửa text + có thể "Bỏ tệp" đã đính, COVER/DEPT/FILE chỉ sửa được tiêu đề.
function renderPrAggCompilation() {
  const wrap = document.getElementById('prAggCompilationWrap');
  const el = document.getElementById('prAggSlidesList');
  if (!prAggPendingSlides || !prAggPendingSlides.length) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const period = DB.reportPeriods.find(p => p.id === prAggCurrentPeriodId);
  const isPublished = period?.compilation?.status === 'PUBLISHED';
  el.innerHTML = prAggPendingSlides.map((s, idx) => {
    const kindLabel = PR_SLIDE_KIND_LABELS[s.kind] || s.kind;
    const sourceInfo = s.sourceCreatorName ? ` — ${escapeHtml(s.sourceCreatorName)} (${escapeHtml(s.sourceDept || '')})` : '';
    let bodyHTML = '';
    if (s.kind === 'TASKS' || s.kind === 'PLAN') {
      const progressField = s.kind === 'TASKS' ? 'progress' : 'plan';
      const progressLabel = s.kind === 'TASKS' ? 'Tiến độ' : 'Kế hoạch tiếp theo';
      bodyHTML = `
        <div class="flex justify-end">
          <button type="button" data-op="addPrAggItemRow" data-arg0="prAggItemsTable_${idx}" data-arg1="${escapeHtml(progressField)}" data-arg2="${escapeHtml(progressLabel)}" class="text-xs bg-sky-100 text-sky-700 px-2 py-1 rounded hover:bg-sky-200 font-semibold" ${isPublished ? 'disabled' : ''}>+ Thêm dòng</button>
        </div>
        <div id="prAggItemsTable_${idx}" class="space-y-2" data-op-input="syncPrAggSlideItems" data-arg0="${idx}" data-arg1="${escapeHtml(progressField)}"></div>
      `;
    } else if (s.kind === 'NUMBERS' || s.kind === 'OTHER' || s.kind === 'TASK_STATS') {
      bodyHTML = `
        <textarea data-op-input="updatePrAggSlideField" data-arg0="${idx}" data-arg1="text" data-arg-value="2" class="w-full border p-1.5 rounded text-xs h-20" ${isPublished ? 'disabled' : ''}>${escapeHtml(s.text || '')}</textarea>
        ${s.fileUrl ? `<div class="flex items-center justify-between text-[11px] bg-white border rounded p-1.5"><span>📎 ${escapeHtml(s.fileName || 'tệp đính kèm')}</span>${!isPublished ? `<button type="button" data-op="removePrAggSlideFile" data-arg0="${idx}" class="text-red-500 font-bold hover:underline">✕ Bỏ tệp</button>` : ''}</div>` : ''}
      `;
    } else if (s.kind === 'FILE') {
      bodyHTML = `<div class="text-[11px] bg-white border rounded p-1.5">📎 ${escapeHtml(s.fileName || 'tệp đính kèm')}</div>`;
    } else if (s.kind === 'PPTX_SLIDE') {
      // Text đọc từ .pptx (bodyLines) SỬA ĐƯỢC trực tiếp (mỗi dòng textarea = 1 gạch đầu dòng khi
      // trình chiếu). Ảnh (embedded/bảng/đồ thị — bảng và đồ thị đã được vẽ lại thành ảnh lúc đọc file,
      // xem parsePptxToSlideContents()) CHỈ ĐỌC, không sửa lại được nội dung bên trong ảnh.
      const imagesHTML = (s.images || []).length
        ? `<div class="flex flex-wrap gap-2 mt-1.5">${(s.images || []).map(im => `<img src="${im.dataUrl}" class="h-20 rounded border" oncontextmenu="return false;">`).join('')}</div>`
        : '';
      bodyHTML = `
        <textarea data-op-input="updatePrAggPptxBodyLines" data-arg0="${idx}" data-arg-value="1" placeholder="Nội dung (mỗi dòng là 1 gạch đầu dòng)" class="w-full border p-1.5 rounded text-xs h-24" ${isPublished ? 'disabled' : ''}>${escapeHtml((s.bodyLines || []).join('\n'))}</textarea>
        ${imagesHTML ? `<div class="text-[11px] text-gray-500">🖼️ Ảnh/bảng/đồ thị từ tệp gốc (không sửa được nội dung bên trong):</div>${imagesHTML}` : ''}
      `;
    }
    return `
      <div class="border rounded p-2 bg-gray-50 space-y-1">
        <div class="flex justify-between items-center">
          <span class="text-[11px] font-bold text-sky-700">Phần ${idx + 1} — ${escapeHtml(kindLabel)}${sourceInfo}</span>
          <div class="space-x-1">
            <button type="button" data-op="movePrAggSlide" data-arg0="${idx}" data-arg1="-1" class="px-1.5 py-0.5 bg-gray-200 rounded hover:bg-gray-300 text-[11px]" ${idx === 0 || isPublished ? 'disabled' : ''}>▲</button>
            <button type="button" data-op="movePrAggSlide" data-arg0="${idx}" data-arg1="1" class="px-1.5 py-0.5 bg-gray-200 rounded hover:bg-gray-300 text-[11px]" ${idx === prAggPendingSlides.length - 1 || isPublished ? 'disabled' : ''}>▼</button>
            <button type="button" data-op="removePrAggSlide" data-arg0="${idx}" class="px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded hover:bg-rose-200 text-[11px]" ${isPublished ? 'disabled' : ''}>✕</button>
          </div>
        </div>
        <input type="text" value="${escapeHtml(s.title)}" data-op-input="updatePrAggSlideField" data-arg0="${idx}" data-arg1="title" data-arg-value="2" class="w-full border p-1.5 rounded text-xs font-semibold" ${isPublished ? 'disabled' : ''}>
        ${bodyHTML}
      </div>
    `;
  }).join('');

  // renderPrItemsTable() thao tác trực tiếp theo id trên DOM thật — phải gọi SAU KHI khung `.innerHTML`
  // ở trên đã chèn xong, nếu không container `#prAggItemsTable_N` chưa tồn tại trong trang.
  prAggPendingSlides.forEach((s, idx) => {
    if (s.kind === 'TASKS') renderPrItemsTable(`prAggItemsTable_${idx}`, s.items, 'progress', 'Tiến độ', 'removePrAggItemRow');
    if (s.kind === 'PLAN') renderPrItemsTable(`prAggItemsTable_${idx}`, s.items, 'plan', 'Kế hoạch tiếp theo', 'removePrAggItemRow');
  });

  document.getElementById('btnPrPublish').classList.toggle('hidden', isPublished);
  document.getElementById('btnPrUnpublish').classList.toggle('hidden', !isPublished);
}

function updatePrAggSlideField(idx, field, value) {
  if (!prAggPendingSlides?.[idx]) return;
  prAggPendingSlides[idx][field] = value;
}

function updatePrAggPptxBodyLines(idx, value) {
  if (!prAggPendingSlides?.[idx]) return;
  prAggPendingSlides[idx].bodyLines = value.split('\n').map(l => l.trim()).filter(Boolean);
}

// Đọc lại toàn bộ dòng đang hiện trong bảng của slide idx, ghi đè vào prAggPendingSlides[idx].items —
// gọi ngay mỗi lần gõ (event delegation qua oninput ở div bọc ngoài #prAggItemsTable_N, xem
// renderPrAggCompilation()) để prAggPendingSlides luôn khớp DOM, không mất dữ liệu khi render lại toàn
// bộ danh sách (di chuyển/xoá slide khác, thêm/xoá dòng...).
function syncPrAggSlideItems(idx, progressField) {
  if (!prAggPendingSlides?.[idx]) return;
  prAggPendingSlides[idx].items = collectPrItemsTable(`prAggItemsTable_${idx}`, progressField);
}

function addPrAggItemRow(containerId, progressField, progressLabel) {
  addPrItemRow(containerId, progressField, progressLabel, 'removePrAggItemRow');
  syncPrAggSlideItems(Number(containerId.replace('prAggItemsTable_', '')), progressField);
}

function removePrAggItemRow(containerId, itemIdx, progressField, progressLabel) {
  removePrItemRow(containerId, itemIdx, progressField, progressLabel, 'removePrAggItemRow');
  syncPrAggSlideItems(Number(containerId.replace('prAggItemsTable_', '')), progressField);
}

function removePrAggSlideFile(idx) {
  if (!prAggPendingSlides?.[idx]) return;
  prAggPendingSlides[idx].fileUrl = null;
  prAggPendingSlides[idx].fileName = null;
  prAggPendingSlides[idx].fileType = null;
  renderPrAggCompilation();
}

function movePrAggSlide(idx, dir) {
  const target = idx + dir;
  if (!prAggPendingSlides || target < 0 || target >= prAggPendingSlides.length) return;
  [prAggPendingSlides[idx], prAggPendingSlides[target]] = [prAggPendingSlides[target], prAggPendingSlides[idx]];
  renderPrAggCompilation();
}

function removePrAggSlide(idx) {
  if (!prAggPendingSlides) return;
  prAggPendingSlides.splice(idx, 1);
  renderPrAggCompilation();
}

async function savePrCompilation() {
  if (!prAggCurrentPeriodId || !prAggPendingSlides) return;
  if (!prAggPendingSlides.length) return alert('Bản tổng hợp cần có ít nhất 1 phần!');
  let result;
  try {
    result = await callRecordAction('reportPeriods', prAggCurrentPeriodId, 'compilation', { slides: prAggPendingSlides });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const updated = result.item;
  const idx = DB.reportPeriods.findIndex(p => p.id === updated.id);
  if (idx !== -1) DB.reportPeriods[idx] = updated;
  prAggPendingSlides = updated.compilation.slides.map(s => ({ ...s }));
  logSystemAction('PERIODIC_REPORT', 'UPDATE_REPORT_COMPILATION', `Sửa bản tổng hợp kỳ báo cáo [${updated.name}]`, 'SUCCESS', String(updated.id));
  alert('✅ Đã lưu chỉnh sửa!');
  renderPrAggCompilation();
}

async function publishPrCompilation() {
  if (!prAggCurrentPeriodId) return;
  const period = DB.reportPeriods.find(p => p.id === prAggCurrentPeriodId);
  showConfirmModal({
    title: '🚀 Xác Nhận Phát Hành',
    bodyHTML: `<p>Phát hành bản tổng hợp kỳ <b>${escapeHtml(period?.name || '')}</b>? Sau khi phát hành, ai còn quyền vào module đều xem/trình chiếu/tải PDF được.</p>`,
    confirmLabel: 'Phát Hành',
    onConfirm: async () => {
      let result;
      try {
        result = await callRecordAction('reportPeriods', prAggCurrentPeriodId, 'publish', {});
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const updated = result.item;
      const idx = DB.reportPeriods.findIndex(p => p.id === updated.id);
      if (idx !== -1) DB.reportPeriods[idx] = updated;
      logSystemAction('PERIODIC_REPORT', 'PUBLISH_REPORT_PERIOD', `Phát hành kỳ báo cáo [${updated.name}]`, 'SUCCESS', String(updated.id));
      alert('✅ Đã phát hành!');
      renderPrAggCompilation();
      renderPrPeriodsTable();
    }
  });
}

async function unpublishPrCompilation() {
  if (!prAggCurrentPeriodId) return;
  const period = DB.reportPeriods.find(p => p.id === prAggCurrentPeriodId);
  showConfirmModal({
    title: '↩️ Xác Nhận Hủy Phát Hành',
    bodyHTML: `<p>Hủy phát hành kỳ <b>${escapeHtml(period?.name || '')}</b> để sửa lại? Người xem sẽ không truy cập được bản trình chiếu/PDF cho tới khi phát hành lại.</p>`,
    confirmLabel: 'Hủy Phát Hành',
    onConfirm: async () => {
      let result;
      try {
        result = await callRecordAction('reportPeriods', prAggCurrentPeriodId, 'unpublish', {});
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const updated = result.item;
      const idx = DB.reportPeriods.findIndex(p => p.id === updated.id);
      if (idx !== -1) DB.reportPeriods[idx] = updated;
      prAggPendingSlides = updated.compilation.slides.map(s => ({ ...s }));
      logSystemAction('PERIODIC_REPORT', 'UNPUBLISH_REPORT_PERIOD', `Hủy phát hành kỳ báo cáo [${updated.name}]`, 'SUCCESS', String(updated.id));
      alert('✅ Đã hủy phát hành, có thể sửa lại.');
      renderPrAggCompilation();
      renderPrPeriodsTable();
    }
  });
}

// ============ ĐÃ PHÁT HÀNH (ai còn quyền vào module đều xem được) ============
// Kỳ có thể phát hành ĐỘC LẬP compilation (slide) và pdfCompilation (ghép PDF) — 1 dòng/kỳ, hiện đúng
// nhóm nút của (các) bản đã phát hành, không phải 2 dòng riêng.
function renderPrPublishedTable() {
  const tbody = document.getElementById('prPublishedTableBody');
  if (!tbody) return;
  const published = DB.reportPeriods.filter(p => p.compilation?.status === 'PUBLISHED' || p.pdfCompilation?.status === 'PUBLISHED');
  if (!published.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center p-6 text-gray-500 italic">Chưa có báo cáo nào được phát hành.</td></tr>`;
    return;
  }
  tbody.innerHTML = published.map(p => {
    const slideDone = p.compilation?.status === 'PUBLISHED';
    const pdfDone = p.pdfCompilation?.status === 'PUBLISHED';
    const publishedAt = slideDone ? p.compilation.publishedAt : p.pdfCompilation.publishedAt;
    const publishedByName = slideDone ? p.compilation.publishedByName : p.pdfCompilation.publishedByName;
    const countParts = [];
    if (slideDone) countParts.push(`${p.compilation.slides.length} slide`);
    if (pdfDone) countParts.push(`${p.pdfCompilation.pages.length} trang PDF`);
    return `
    <tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-bold text-sky-800">${escapeHtml(p.name)}</td>
      <td class="border p-2 text-xs">${formatDateTimeVN(publishedAt)} — ${escapeHtml(publishedByName || '')}</td>
      <td class="border p-2 text-center text-xs">${escapeHtml(countParts.join(' · ') || '—')}</td>
      <td class="border p-2 text-center space-x-1">
        ${slideDone ? `<button data-op="openPrSlideshow" data-arg0="${p.id}" class="px-2.5 py-1 bg-sky-600 text-white rounded text-xs hover:opacity-90 font-bold">🎬 Trình Chiếu</button>
        <button data-op="downloadPrPdf" data-arg0="${p.id}" data-arg-el="1" class="px-2.5 py-1 bg-gray-600 text-white rounded text-xs hover:opacity-90 font-bold">📄 Tải PDF</button>` : ''}
        ${pdfDone ? `<button data-op="openPrPdfFullscreen" data-arg0="${p.id}" class="px-2.5 py-1 bg-indigo-600 text-white rounded text-xs hover:opacity-90 font-bold">🖥️ Xem PDF Toàn Màn Hình</button>
        <a href="/api/files/download?fileUrl=${encodeURIComponent(p.pdfCompilation.publishedFileUrl)}&name=${encodeURIComponent(p.pdfCompilation.publishedFileName || '')}" class="inline-block px-2.5 py-1 bg-gray-600 text-white rounded text-xs hover:opacity-90 font-bold">📄 Tải PDF Ghép</a>` : ''}
      </td>
    </tr>`;
  }).join('');
}

// ============ TRÌNH CHIẾU TOÀN MÀN HÌNH ============
// prSlideshowMode phân biệt 2 kiểu nội dung dùng CHUNG #prSlideshowModal: 'SLIDES' (compilation.slides,
// dựng bằng buildPrSlideScreenHTML — cách cũ) và 'PDF' (pdfCompilation, render TRỰC TIẾP từng trang PDF
// thật bằng pdf.js — xem openPrPdfFullscreen()/renderPrPdfFsPage() bên dưới) — prSlideshowNav()/
// closePrSlideshow() branch theo biến này, không cần modal/bàn phím riêng.
let prSlideshowMode = 'SLIDES';
function openPrSlideshow(periodId) {
  const period = DB.reportPeriods.find(p => p.id === periodId);
  if (!period || period.compilation?.status !== 'PUBLISHED') return;
  prSlideshowMode = 'SLIDES';
  prSlideshowSlides = period.compilation.slides;
  prSlideshowIndex = 0;
  prSlideshowTemplate = period.slideTemplate === 'ORANGE_GOLD' ? 'ORANGE_GOLD' : 'DEFAULT';
  document.getElementById('prSlideshowTitle').innerText = period.name;
  const modal = document.getElementById('prSlideshowModal');
  modal.classList.remove('hidden');
  modal.requestFullscreen?.().catch(() => {});
  renderPrSlideshowSlide();
}

// Trình chiếu PDF THẬT toàn màn hình — render TRỰC TIẾP từng trang bằng pdf.js (window.pdfjsLib đã sẵn
// toàn cục) vào <canvas>, KHÔNG rasterize/làm phẳng qua html2canvas như downloadPrPdf() — giữ nguyên vẹn
// định dạng/font/vector gốc của file đã ghép, đúng yêu cầu "không vỡ cấu trúc file". Dùng chung modal
// #prSlideshowModal (đã là khung tối toàn màn hình sẵn) + nút điều hướng/phím tắt có sẵn.
let prPdfFsDoc = null;
async function openPrPdfFullscreen(periodId) {
  const period = DB.reportPeriods.find(p => p.id === periodId);
  if (!period || period.pdfCompilation?.status !== 'PUBLISHED') return;
  prSlideshowMode = 'PDF';
  prSlideshowIndex = 0;
  prPdfFsDoc = null;
  document.getElementById('prSlideshowTitle').innerText = period.name;
  document.getElementById('prSlideshowCounter').innerText = '';
  const modal = document.getElementById('prSlideshowModal');
  modal.style.backgroundColor = '#000';
  modal.style.backgroundImage = 'none';
  modal.classList.remove('hidden');
  modal.requestFullscreen?.().catch(() => {});
  const bodyEl = document.getElementById('prSlideshowBody');
  bodyEl.innerHTML = `<div class="text-white text-center text-sm mt-20">⏳ Đang tải file PDF...</div>`;
  try {
    prPdfFsDoc = await window.pdfjsLib.getDocument(period.pdfCompilation.publishedFileUrl).promise;
    renderPrPdfFsPage();
  } catch (err) {
    bodyEl.innerHTML = `<div class="text-rose-300 text-center text-sm mt-20">⛔ Không mở được file PDF: ${escapeHtml(err.message)}</div>`;
  }
}

async function renderPrPdfFsPage() {
  if (!prPdfFsDoc) return;
  const bodyEl = document.getElementById('prSlideshowBody');
  document.getElementById('prSlideshowCounter').innerText = `${prSlideshowIndex + 1} / ${prPdfFsDoc.numPages}`;
  const page = await prPdfFsDoc.getPage(prSlideshowIndex + 1);
  const containerW = Math.max(bodyEl.clientWidth, 320);
  const containerH = Math.max(bodyEl.clientHeight, 320);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.max(0.3, Math.min(containerW / baseViewport.width, containerH / baseViewport.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  canvas.style.display = 'block';
  canvas.style.margin = '0 auto';
  canvas.style.background = '#fff';
  canvas.oncontextmenu = () => false;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  bodyEl.innerHTML = '';
  bodyEl.appendChild(canvas);
}

// Số La Mã cho khối "Mục lớn" trong bảng Công Việc/Kế Hoạch — đủ dùng tới vài chục mục lớn/kỳ báo cáo.
function toRomanNumeral(n) {
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let res = '';
  for (const [val, sym] of table) { while (n >= val) { res += sym; n -= val; } }
  return res || String(n);
}

// Dựng bảng Công Việc/Kế Hoạch để hiển thị (trình chiếu/PDF) — tự nhóm các dòng liên tiếp CÙNG "group"
// thành 1 khối "Mục lớn" đánh số La Mã (I, II, III...), dòng con trong khối đánh số thường (1, 2, 3...)
// — đúng khuôn mẫu PowerPoint công ty cung cấp. Dòng không điền "group" không có khối cha, đánh số
// Style inline theo màu "colors" (xem PR_SLIDE_TEMPLATES/getPrSlideTemplateColors() ở trên) để bảng đổi
// màu đúng theo mẫu đang chọn của kỳ báo cáo — dùng chung cho cả khung trình chiếu lẫn khung dựng ẩn để
// chụp ảnh xuất PDF (downloadPrPdf(), cùng render 1 kiểu HTML nên PDF luôn khớp với trình chiếu).
function buildPrTaskTableHTML(items, progressField, progressLabel, colors) {
  const list = Array.isArray(items) ? items : [];
  const c = colors || getPrSlideTemplateColors(prSlideshowTemplate);
  if (!list.length) return `<p style="font-style:italic;color:#9ca3af;">Không có nội dung.</p>`;
  const cellStyle = `border:1px solid ${c.tableBorder};padding:8px;font-size:14px;vertical-align:top;color:${c.tableText};`;
  const cellAttr = `style="${cellStyle}"`;
  const cellAttrCenter = `style="${cellStyle}text-align:center;"`;
  const headAttr = `style="border:1px solid ${c.tableBorder};padding:8px;font-size:14px;background:${c.tableHeadBg};text-align:left;color:${c.tableText};"`;
  const groupAttr = `style="border:1px solid ${c.tableBorder};padding:8px;font-size:14px;font-weight:700;background:${c.tableHeadBg};color:${c.tableText};"`;
  let romanCounter = 0, lastGroup = null, subCounter = 0, prevHadGroup = false;
  const rows = list.map((it) => {
    let groupRowHTML = '';
    if (it.group && it.group !== lastGroup) {
      romanCounter++; lastGroup = it.group; subCounter = 0;
      groupRowHTML = `<tr><td ${groupAttr}>${escapeHtml(toRomanNumeral(romanCounter))}</td><td ${groupAttr} colspan="4">${escapeHtml(it.group)}</td></tr>`;
    } else if (!it.group && prevHadGroup) {
      // Dòng không gán "Mục lớn" xuất hiện NGAY SAU 1 khối có nhóm — subCounter trước đây chỉ được
      // reset khi gặp nhóm MỚI, không reset khi gặp dòng không nhóm, nên dòng này kế thừa bộ đếm dư
      // từ nhóm trước, đánh số nhảy cóc thay vì tiếp tục đúng trình tự (1, 2, 3...).
      subCounter = 0;
    }
    prevHadGroup = !!it.group;
    subCounter++;
    const rowHTML = `<tr>
      <td ${cellAttrCenter}>${it.group ? subCounter : romanCounter + subCounter}</td>
      <td ${cellAttr}>${escapeHtml(it.content || '')}</td>
      <td ${cellAttr}>${escapeHtml(it[progressField] || '')}</td>
      <td ${cellAttr}>${escapeHtml(formatDateVN(it.deadline))}</td>
      <td ${cellAttr}>${escapeHtml(it.support || '')}</td>
    </tr>`;
    return groupRowHTML + rowHTML;
  }).join('');
  return `
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>
        <th ${headAttr} width="40">#</th>
        <th ${headAttr}>Nội dung công việc</th>
        <th ${headAttr}>${escapeHtml(progressLabel)}</th>
        <th ${headAttr}>Deadline</th>
        <th ${headAttr}>Hỗ trợ</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// Xem tệp đính kèm của slide ĐANG hiện trong khung trình chiếu — đọc thẳng từ prSlideshowSlides/Index
// (không truyền dữ liệu qua onclick) để tránh escaping fileName/fileUrl chứa dấu nháy. Dùng chung
// openFileProtectedView() nên tự động có watermark như mọi tệp đính kèm khác trong hệ thống.
function viewPrCurrentSlideFile() {
  const s = prSlideshowSlides[prSlideshowIndex];
  if (!s?.fileUrl) return;
  openFileProtectedView({ title: `📎 ${s.fileName || 'Tệp đính kèm'}`, fileSrc: s.fileUrl, fileType: s.fileType, fileName: s.fileName });
}

// Khối tệp đính kèm của slide NUMBERS/OTHER/FILE — ảnh hiện thẳng, tệp khác hiện nút mở khung xem có
// watermark (viewPrCurrentSlideFile(), dùng chung openFileProtectedView()). "colors" (PR_SLIDE_TEMPLATES)
// quyết định viền ảnh/màu nút cho đúng mẫu đang chọn — nút "bg-white/10" cũ chỉ hợp nền tối, vô hình trên
// nền trắng của mẫu Cam - Vàng.
function buildPrFileBlockHTML(s, colors) {
  if (!s.fileUrl) return '';
  const c = colors || getPrSlideTemplateColors(prSlideshowTemplate);
  const kind = getFileKind(s.fileType, s.fileName);
  if (kind === 'image') {
    return `<img src="${s.fileUrl}" class="max-h-96 mx-auto mt-3 block" style="border-radius:6px;border:1px solid ${c.tableBorder};" oncontextmenu="return false;">`;
  }
  return `<button type="button" data-op="viewPrCurrentSlideFile" class="mt-3 text-sm px-3 py-1.5 rounded" style="background:${c.navBtnBg};color:${c.navBtnText};">📎 Xem tệp: ${escapeHtml(s.fileName || 'tệp đính kèm')}</button>`;
}

// Nội dung chính của 1 slide theo đúng kind (đặt lúc Tổng Hợp — xem mergeReportPeriod() ở
// lib/recordActions.js): TASKS/PLAN ra bảng, NUMBERS/OTHER/FILE ra text + tệp, COVER/DEPT chỉ có tiêu
// đề (không có thân) — dùng chung cho cả renderPrSlideshowSlide() lẫn downloadPrPdf(). "colors" truyền
// xuống buildPrTaskTableHTML/buildPrFileBlockHTML để cả bảng lẫn khung tệp đổi đúng theo mẫu đang chọn.
function buildPrSlideBodyHTML(s, colors) {
  const c = colors || getPrSlideTemplateColors(prSlideshowTemplate);
  if (s.kind === 'TASKS') return buildPrTaskTableHTML(s.items, 'progress', 'Tiến độ', c);
  if (s.kind === 'PLAN') return buildPrTaskTableHTML(s.items, 'plan', 'Kế hoạch tiếp theo', c);
  if (s.kind === 'NUMBERS' || s.kind === 'OTHER' || s.kind === 'FILE' || s.kind === 'TASK_STATS') {
    const textHTML = s.text ? `<div style="white-space:pre-wrap;font-size:16px;line-height:1.7;color:${c.bodyTextColor};">${escapeHtml(s.text)}</div>` : '';
    const fileHTML = buildPrFileBlockHTML(s, c);
    return (textHTML + fileHTML) || `<p style="font-style:italic;color:#9ca3af;">Không có nội dung.</p>`;
  }
  if (s.kind === 'PPTX_SLIDE') return buildPrPptxSlideBodyHTML(s, c);
  return ''; // COVER / DEPT — chỉ có tiêu đề
}

// Thân 1 trang lấy từ tệp .pptx tải lên (kind PPTX_SLIDE) — bodyLines là các dòng text ĐỌC ĐƯỢC và
// SỬA ĐƯỢC (xem renderPrAggCompilation() ở khối Tổng Hợp), images là ảnh CHỈ ĐỌC (ảnh gốc nhúng trong
// slide, hoặc bảng/đồ thị đã được vẽ lại thành ảnh — xem parser.js: drawTableImage()/drawChartImage() —
// vì bảng/đồ thị PowerPoint không sửa lại được trực tiếp trên trình duyệt, chỉ text mới sửa được, đúng
// theo phương án đã chọn).
function buildPrPptxSlideBodyHTML(s, c) {
  const linesHTML = (s.bodyLines || []).length
    ? `<ul style="margin:0;padding-left:1.25em;font-size:16px;line-height:1.8;color:${c.bodyTextColor};">
        ${(s.bodyLines || []).map(l => `<li>${escapeHtml(l)}</li>`).join('')}
      </ul>`
    : '';
  const imagesHTML = (s.images || []).length
    ? `<div class="flex flex-wrap gap-3 justify-center mt-3">
        ${(s.images || []).map(im => `<img src="${im.dataUrl}" class="max-h-72 max-w-full" style="border-radius:6px;border:1px solid ${c.tableBorder};" oncontextmenu="return false;">`).join('')}
      </div>`
    : '';
  return (linesHTML + imagesHTML) || `<p style="font-style:italic;color:#9ca3af;">Không có nội dung.</p>`;
}

// Dựng nội dung 1 slide (tiêu đề + nguồn + thân) theo màu "c" của mẫu đang chọn — dùng CHUNG cho khung
// trình chiếu (renderPrSlideshowSlide, gắn thẳng vào #prSlideshowBody) lẫn khung dựng ẩn để chụp ảnh xuất
// PDF thật (downloadPrPdf bên dưới), đảm bảo file PDF tải về giống HỆT những gì đã xem ở trình chiếu —
// không viết lại giao diện 2 lần. Trang bìa (kind COVER) và slide chia phòng ban (kind DEPT, xem
// mergeReportPeriod() ở lib/recordActions.js — mỗi phòng đúng 1 slide, đứng trước hết nội dung của
// phòng đó) đều có bố cục riêng — tiêu đề lớn căn giữa, để rõ ràng khi họp nhiều phòng cần chuyển
// nhanh từ phòng này sang phòng khác. Cover có thêm gạch chân màu nhấn (coverAccentColor) — đúng phong
// cách trang bìa của mẫu PowerPoint công ty; mẫu DEFAULT có coverAccentColor='transparent' nên gạch
// chân tự ẩn, không ảnh hưởng giao diện cũ.
function buildPrSlideScreenHTML(s, c) {
  const showSource = s.sourceCreatorName && s.kind !== 'DEPT';
  const isCover = s.kind === 'COVER';
  const isDept = s.kind === 'DEPT';
  // PPTX_SLIDE (trang lấy từ tệp .pptx tải lên, xem parsePptxToSlideContents()) tiêu đề KHÔNG bắt
  // buộc — nhiều slide gốc (bảng/đồ thị/ảnh thuần) không có ô tiêu đề nào, để trống thay vì hiện tiêu
  // đề rỗng chiếm chỗ.
  const titleHTML = (s.kind === 'PPTX_SLIDE' && !s.title) ? '' : isCover
    ? `<div class="text-center">
        <h2 class="text-3xl md:text-6xl font-extrabold" style="color:${c.coverTitleColor};">${escapeHtml(s.title)}</h2>
        ${c.coverAccentColor !== 'transparent' ? `<div class="mx-auto mt-4" style="width:120px;height:4px;background:${c.coverAccentColor};border-radius:2px;"></div>` : ''}
      </div>`
    : isDept
    ? `<h2 class="text-3xl md:text-5xl font-extrabold text-center" style="color:${c.sectionTitleColor};">${escapeHtml(s.title)}</h2>`
    : `<h2 class="text-2xl md:text-4xl font-bold" style="color:${c.sectionTitleColor};">${escapeHtml(s.title)}</h2>`;
  return `
    <div class="max-w-4xl mx-auto space-y-6${(isCover || isDept) ? ' flex flex-col items-center justify-center min-h-full text-center' : ''}">
      ${titleHTML}
      ${showSource ? `<div class="text-sm" style="color:${c.sourceLabelColor};">${escapeHtml(s.sourceCreatorName)}${s.sourceDept ? ` — ${escapeHtml(s.sourceDept)}` : ''}</div>` : ''}
      ${buildPrSlideBodyHTML(s, c)}
    </div>
  `;
}

// Áp nền của mẫu (màu đặc, mẫu cũ KHÔNG có bgImageUrl — hoặc ảnh phủ kín (cover), mẫu mới CÓ bgImageUrl,
// xem getPrSlideTemplateColors()) lên 1 khung ngoài cùng — dùng chung cho khung trình chiếu thật
// (#prSlideshowModal) lẫn khung dựng ẩn để xuất PDF (stage ở downloadPrPdf()) để 2 nơi luôn khớp nhau.
function applyPrTemplateBackground(el, c) {
  el.style.backgroundColor = c.pageBg;
  if (c.bgImageUrl) {
    el.style.backgroundImage = `url("${c.bgImageUrl}")`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    el.style.backgroundRepeat = 'no-repeat';
  } else {
    el.style.backgroundImage = 'none';
  }
}

// Tải trước 1 ảnh vào cache trình duyệt trước khi html2canvas chụp — background-image CSS không có sự
// kiện "đã tải xong" để chờ như thẻ <img>, nên phải tự tải trước bằng Image() (xem downloadPrPdf()).
function preloadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve();
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

// Áp màu theo mẫu đang chọn của kỳ (prSlideshowTemplate) lên cả khung modal (nền), nút điều hướng và
// thân slide.
function renderPrSlideshowSlide() {
  const s = prSlideshowSlides[prSlideshowIndex];
  if (!s) return;
  const c = getPrSlideTemplateColors(prSlideshowTemplate);
  applyPrTemplateBackground(document.getElementById('prSlideshowModal'), c);
  const prevBtn = document.getElementById('prSlideshowPrevBtn');
  const nextBtn = document.getElementById('prSlideshowNextBtn');
  if (prevBtn) { prevBtn.style.background = c.navBtnBg; prevBtn.style.color = c.navBtnText; }
  if (nextBtn) { nextBtn.style.background = c.navBtnBg; nextBtn.style.color = c.navBtnText; }
  document.getElementById('prSlideshowCounter').innerText = `${prSlideshowIndex + 1} / ${prSlideshowSlides.length}`;
  const bodyEl = document.getElementById('prSlideshowBody');
  bodyEl.style.color = c.bodyTextColor;
  bodyEl.innerHTML = buildPrSlideScreenHTML(s, c);
}

function prSlideshowNav(dir) {
  if (prSlideshowMode === 'PDF') {
    const total = prPdfFsDoc?.numPages || 0;
    const target = prSlideshowIndex + dir;
    if (target < 0 || target >= total) return;
    prSlideshowIndex = target;
    renderPrPdfFsPage();
    return;
  }
  const target = prSlideshowIndex + dir;
  if (target < 0 || target >= prSlideshowSlides.length) return;
  prSlideshowIndex = target;
  renderPrSlideshowSlide();
}

function closePrSlideshow() {
  document.getElementById('prSlideshowModal').classList.add('hidden');
  prSlideshowSlides = [];
  prPdfFsDoc = null;
  prSlideshowMode = 'SLIDES';
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

document.addEventListener('keydown', (ev) => {
  if (document.getElementById('prSlideshowModal')?.classList.contains('hidden')) return;
  if (ev.key === 'ArrowRight') prSlideshowNav(1);
  else if (ev.key === 'ArrowLeft') prSlideshowNav(-1);
  else if (ev.key === 'Escape') closePrSlideshow();
});

// ============ XUẤT PDF THẬT — chụp từng slide (dựng bằng ĐÚNG buildPrSlideScreenHTML() dùng cho trình
// chiếu, xem ở trên) thành ảnh bằng html2canvas rồi ghép vào 1 file .pdf nhiều trang bằng jsPDF, cả 2 thư
// viện tự lưu trên server qua /vendor/jspdf, /vendor/html2canvas (xem server.js) — không qua CDN. Tải
// script kiểu lười (chỉ khi bấm "Tải PDF" lần đầu) vì file khá nặng và không phải ai cũng dùng tính năng
// này. Thay cho cách cũ dùng window.print() qua iframe ẩn (chỉ mở hộp thoại in của trình duyệt, người
// dùng phải tự chọn "Save as PDF" — không phải thao tác tải file thật). ============
let prPdfLibsPromise = null;
function loadPrPdfLibs() {
  if (prPdfLibsPromise) return prPdfLibsPromise;
  const loadScript = (src) => new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Không tải được thư viện xuất PDF (${src})`));
    document.head.appendChild(el);
  });
  prPdfLibsPromise = Promise.all([
    loadScript('/vendor/html2canvas/html2canvas.min.js'),
    loadScript('/vendor/jspdf/jspdf.umd.min.js')
  ]).catch(err => { prPdfLibsPromise = null; throw err; });
  return prPdfLibsPromise;
}

const PR_PDF_SLIDE_WIDTH = 1280;
const PR_PDF_SLIDE_HEIGHT = 720; // Khung 16:9 chuẩn PowerPoint — mỗi slide ra đúng 1 trang PDF.

async function downloadPrPdf(periodId, btnEl) {
  const period = DB.reportPeriods.find(p => p.id === periodId);
  if (!period || period.compilation?.status !== 'PUBLISHED') return alert('Kỳ báo cáo này chưa phát hành.');

  const originalLabel = btnEl ? btnEl.innerHTML : '';
  if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = '⏳ Đang tạo PDF...'; }

  const stage = document.createElement('div');
  try {
    await loadPrPdfLibs();
    const c = getPrSlideTemplateColors(period.slideTemplate === 'ORANGE_GOLD' ? 'ORANGE_GOLD' : 'DEFAULT');
    const slides = period.compilation.slides;
    if (!slides.length) return alert('Kỳ báo cáo này chưa có slide nào.');

    // Dựng ẩn ngoài màn hình (không dùng display:none — html2canvas không chụp được phần tử display:none)
    // nhưng vẫn nằm trong DOM chính nên kế thừa đúng Tailwind + font của trang.
    stage.style.cssText = `position:fixed;left:-10000px;top:0;width:${PR_PDF_SLIDE_WIDTH}px;height:${PR_PDF_SLIDE_HEIGHT}px;overflow:hidden;color:${c.bodyTextColor};box-sizing:border-box;padding:56px;font-family:Arial,'Segoe UI',sans-serif;`;
    document.body.appendChild(stage);
    applyPrTemplateBackground(stage, c);
    await preloadImage(c.bgImageUrl);

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'px', format: [PR_PDF_SLIDE_WIDTH, PR_PDF_SLIDE_HEIGHT], compress: true });

    for (let i = 0; i < slides.length; i++) {
      stage.innerHTML = buildPrSlideScreenHTML(slides[i], c);
      // Đợi mọi ảnh đính kèm trong slide tải xong trước khi chụp — html2canvas chụp ngay trạng thái DOM
      // hiện tại, ảnh <img> (tệp NUMBERS/OTHER/FILE, xem buildPrFileBlockHTML()) chưa load xong sẽ ra
      // khoảng trống trên PDF.
      const imgs = Array.from(stage.querySelectorAll('img'));
      await Promise.all(imgs.map(img => img.complete ? Promise.resolve() : new Promise(res => { img.onload = img.onerror = res; })));

      const canvas = await window.html2canvas(stage, { backgroundColor: c.pageBg, scale: 2, useCORS: true, logging: false });
      const imgData = canvas.toDataURL('image/jpeg', 0.92);
      if (i > 0) doc.addPage([PR_PDF_SLIDE_WIDTH, PR_PDF_SLIDE_HEIGHT], 'landscape');
      doc.addImage(imgData, 'JPEG', 0, 0, PR_PDF_SLIDE_WIDTH, PR_PDF_SLIDE_HEIGHT);
    }

    const safeName = (period.name || 'BaoCao').replace(/[\\/:*?"<>|]+/g, '_');
    doc.save(`${safeName}.pdf`);
    logSystemAction('PERIODIC_REPORT', 'DOWNLOAD_PDF', `Tải PDF kỳ báo cáo [${period.name}]`, 'SUCCESS', String(period.id));
  } catch (err) {
    console.error('Lỗi xuất PDF báo cáo định kỳ:', err);
    alert('❌ Không tạo được file PDF: ' + err.message);
  } finally {
    stage.remove();
    if (btnEl) { btnEl.disabled = false; btnEl.innerHTML = originalLabel; }
  }
}

