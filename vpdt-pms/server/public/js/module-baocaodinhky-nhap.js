// ==========================================
// BÁO CÁO ĐỊNH KỲ (module con "Điều Hành") — kỳ báo cáo (thường theo tuần) -> nhân viên nhập/gửi báo
// cáo -> người có quyền reportAggregate (CHUNG cho mọi kỳ, không riêng ai tạo kỳ đó) chọn + sắp thứ
// tự + merge -> sửa từng phần tự do -> phát hành (trình chiếu toàn màn hình / xuất PDF). Cùng khuôn
// "kỳ + hồ sơ từng người" như Văn Phòng Phẩm ở trên (xem lib/createValidation.js/recordActions.js).
// ==========================================
let activePeriodicReportSubTab = 'ENTRY';
let prEntryDraftId = null;
// Tệp PDF (đã ghép) của bản nháp đang sửa — giữ lại nếu người dùng không chọn tệp mới khi lưu nháp
// tiếp, giống mô hình "sửa hồ sơ không bắt buộc chọn lại file" của Hợp đồng (xem openEditContract()).
// null nếu đang tạo báo cáo mới, chưa từng chọn tệp, hoặc báo cáo CŨ nộp bằng .pptx (đã bỏ hình thức
// này — xem onPrEntryPeriodChange(), không còn đường tái sử dụng tệp .pptx cũ ở form nhập nữa, chỉ còn
// xem/đối chiếu lại được ở phần Tổng Hợp/Trình Chiếu).
let prEntryExistingFile = null; // { fileUrl, fileName, fileType, parsedSlides } | null
// Tệp PDF VỪA ghép ở ô chọn file (chưa tải lên server) — chỉ thực sự tải file lên server lúc bấm Lưu
// Nháp/Gửi (tránh tải lên nhiều lần nếu người dùng đổi ý chọn lại tệp khác trước khi lưu).
let prEntryPendingFile = null; // { file, parsedSlides: [] } | null
let prAggCurrentPeriodId = null;
let prAggSelectedIds = [];
let prAggPendingSlides = null;
// Tổng Hợp bằng Ghép File PDF (entryType 'PDF') — TÁCH RIÊNG hoàn toàn khỏi 3 biến trên (dựng
// period.pdfCompilation, không phải period.compilation). prAggPdfPages là mảng TRANG thật (không phải
// mảng entry) — mỗi phần tử { sourceEntryId, sourceDept, sourceCreatorName, sourceFileName,
// sourcePageIndex, dataUrl } — dataUrl là ảnh thumbnail render bằng pdf.js NGAY TRONG trình duyệt, chỉ
// dùng để hiển thị (server không nhận/lưu dataUrl này). prAggPdfEntryPagesCache cache lại danh sách
// dataUrl từng trang theo entryId (Promise trong lúc đang tải) để không phải render lại khi tick/bỏ tick
// qua lại nhiều lần.
let prAggPdfSelectedIds = [];
let prAggPdfPages = [];
let prAggPdfDragFromIndex = null;
let prAggPdfEntryPagesCache = new Map();
let prSlideshowSlides = [];
let prSlideshowIndex = 0;
let prSlideshowTemplate = 'DEFAULT';

function canManageReportPeriodsClient(user) {
  return !!(user?.perms?.admin || user?.perms?.reportManage);
}
// canAggregateReportsClient() da chuyen sang core.js (Ha tang: nap module theo cum, dot 7) -
// buildDashboardCards() (core-dashboard.js, luon nap san) goi thang ham nay o MOI lan mo trang chu.
function canCreateReportEntryClient(user) {
  return !!(user?.perms?.admin || user?.perms?.reportEntryCreate);
}

// Kỳ coi là ĐANG MỞ (còn nhận nhập liệu) nếu status=OPEN VÀ chưa qua endTime — khớp đúng điều kiện
// server (xem lib/createValidation.js CREATE_MODULE_CONFIGS.reportEntries + isReportPeriodClosed()
// trong lib/recordActions.js).
function reportPeriodIsOpen(p) {
  if (p.status !== 'OPEN') return false;
  if (!p.endTime) return true;
  return Date.now() <= new Date(p.endTime).getTime();
}
function reportPeriodIsClosed(p) { return !reportPeriodIsOpen(p); }

function reportPeriodDeptAllowed(p, dept) {
  const scope = p.deptScope || {};
  return !!scope.all || (Array.isArray(scope.depts) && scope.depts.includes(dept));
}

function reportPeriodDeptLabel(p) {
  const scope = p.deptScope || {};
  if (scope.all) return 'Tất cả phòng ban';
  return (scope.depts || []).join(', ') || '(chưa chọn)';
}

function formatDateTimeVN(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('vi-VN'); } catch { return iso; }
}

// Hiển thị deadline dd/mm/yyyy quen thuộc dù lưu nội bộ theo chuẩn ISO yyyy-mm-dd (từ <input
// type="date">) — dữ liệu deadline cũ (nhập tự do trước khi đổi sang ô lịch) không đúng chuẩn ISO thì
// hiện nguyên chuỗi đã lưu, không có gì để quy đổi.
function formatDateVN(value) {
  const str = String(value || '').trim();
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : str;
}

function setPeriodicReportSubTab(subTab) {
  window.scrollTo({ top: 0, behavior: 'auto' }); // Tránh "bay xuống cuối" khi đổi tab con — xem setSystemSubTab().
  if (subTab === 'PERIODS' && !canManageReportPeriodsClient(currentUser)) subTab = 'ENTRY';
  if (subTab === 'AGGREGATE' && !canAggregateReportsClient(currentUser)) subTab = 'ENTRY';
  activePeriodicReportSubTab = subTab;

  document.getElementById('btnPRSubPeriods').classList.toggle('hidden', !canManageReportPeriodsClient(currentUser));
  document.getElementById('btnPRSubAggregate').classList.toggle('hidden', !canAggregateReportsClient(currentUser));

  document.getElementById('prSubEntry').classList.toggle('hidden', subTab !== 'ENTRY');
  document.getElementById('prSubPeriods').classList.toggle('hidden', subTab !== 'PERIODS');
  document.getElementById('prSubAggregate').classList.toggle('hidden', subTab !== 'AGGREGATE');
  document.getElementById('prSubPublished').classList.toggle('hidden', subTab !== 'PUBLISHED');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-sky-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnPRSubEntry').className = subTab === 'ENTRY' ? activeCls : inactiveCls;
  document.getElementById('btnPRSubPeriods').className = subTab === 'PERIODS' ? activeCls : inactiveCls;
  document.getElementById('btnPRSubAggregate').className = subTab === 'AGGREGATE' ? activeCls : inactiveCls;
  document.getElementById('btnPRSubPublished').className = subTab === 'PUBLISHED' ? activeCls : inactiveCls;

  if (subTab === 'ENTRY') { renderPrEntryPeriodOptions(); renderPrEntryTable(); }
  if (subTab === 'PERIODS') { renderReportDeptCheckboxes(); renderPrPeriodsTable(); }
  if (subTab === 'AGGREGATE') { renderPrAggPeriodOptions(); }
  if (subTab === 'PUBLISHED') { renderPrPublishedTable(); }
}

// ============ NHẬP BÁO CÁO (chỉ người có quyền reportEntryCreate, nộp cho ĐÚNG phòng ban mình) ============
function findOwnReportEntryForPeriod(periodId) {
  return DB.reportEntries.find(e => e.periodId === periodId && e.creator === currentUser.username);
}

function renderPrEntryPeriodOptions() {
  const canCreate = canCreateReportEntryClient(currentUser);
  document.getElementById('prEntryNoCreatePermNote').classList.toggle('hidden', canCreate);
  document.getElementById('prEntryFormBox').classList.toggle('hidden', !canCreate);
  if (!canCreate) return;

  const sel = document.getElementById('prEntryPeriodSelect');
  const openPeriods = DB.reportPeriods.filter(p => reportPeriodIsOpen(p) && reportPeriodDeptAllowed(p, currentUser.dept));
  sel.innerHTML = `<option value="">-- Chọn kỳ báo cáo --</option>` +
    openPeriods.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (hạn ${formatDateTimeVN(p.endTime)})</option>`).join('');
  document.getElementById('prEntryNoPeriodNote').classList.toggle('hidden', openPeriods.length > 0);
  document.getElementById('prEntryFormWrap').classList.add('hidden');
  document.getElementById('prEntryAlreadySentNote').classList.add('hidden');
  prEntryDraftId = null;
  sel.value = '';
}

// Bảng dòng động dùng chung cho Công Việc/Kế Hoạch — mỗi dòng: Mục lớn, Nội dung, [Tiến độ|Kế hoạch
// tiếp theo], Deadline, Hỗ trợ — khớp đúng cột trong slide PowerPoint mẫu. progressField đổi tên field
// lưu trong data ('progress' cho bảng Công Việc Tuần Này | 'plan' cho bảng Kế Hoạch Tiếp Theo),
// progressLabel đổi nhãn hiện trên form. removeFnName (mặc định removePrItemRow) cho phép khung sửa
// slide ở Tổng Hợp gắn hàm xoá RIÊNG có đồng bộ lại prAggPendingSlides (xem syncPrAggSlideItems() +
// removePrAggItemRow() ở khối Tổng Hợp) — form Nhập Báo Cáo dùng thẳng bản mặc định vì chỉ đọc field
// lúc bấm Lưu/Gửi, không cần đồng bộ theo từng phím gõ.
// Deadline lưu dạng chuỗi tự do (lịch sử có thể có dữ liệu cũ không đúng chuẩn ISO, gõ tay kiểu
// dd/mm/yyyy hoặc khác) nhưng ô nhập giờ là <input type="date"> (chuẩn ISO yyyy-mm-dd) — quy đổi
// dd/mm/yyyy quen thuộc sang ISO để vẫn tự điền lại được khi mở sửa nháp cũ; chuỗi khác không nhận
// dạng được thì để trống ô (không có cách nào giữ nguyên chuỗi tự do trong ô kiểu date của trình duyệt).
function toIsoDateForInput(deadline) {
  const str = String(deadline || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

function renderPrItemsTable(containerId, items, progressField, progressLabel, removeFnName) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const removeFn = removeFnName || 'removePrItemRow';
  container.innerHTML = (items || []).map((it, idx) => `
    <div class="border rounded p-2 bg-gray-50 space-y-1" data-pr-item-row="${idx}">
      <div class="flex justify-between items-center">
        <span class="text-[11px] font-bold text-gray-500">Dòng ${idx + 1}</span>
        <button type="button" data-op="${removeFn}" data-arg0="${escapeHtml(containerId)}" data-arg1="${idx}" data-arg2="${escapeHtml(progressField)}" data-arg3="${escapeHtml(progressLabel)}" class="text-red-500 text-[11px] font-bold hover:underline">✕ Xoá dòng</button>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-4 gap-1">
        <input placeholder="Mục lớn (VD: I)" value="${escapeHtml(it.group || '')}" class="pr-item-group border p-1 rounded text-xs">
        <input placeholder="Nội dung công việc" value="${escapeHtml(it.content || '')}" class="pr-item-content border p-1 rounded text-xs md:col-span-2">
        <input type="date" value="${escapeHtml(toIsoDateForInput(it.deadline))}" class="pr-item-deadline border p-1 rounded text-xs">
      </div>
      <textarea placeholder="${escapeHtml(progressLabel)}" class="pr-item-progress w-full border p-1 rounded text-xs h-10">${escapeHtml(it[progressField] || '')}</textarea>
      <textarea placeholder="Hỗ trợ cần" class="pr-item-support w-full border p-1 rounded text-xs h-8">${escapeHtml(it.support || '')}</textarea>
    </div>
  `).join('') || '<p class="text-gray-400 italic text-[11px]">Chưa có mục nào — bấm "+ Thêm..." ở trên nếu cần.</p>';
}

function collectPrItemsTable(containerId, progressField) {
  return [...document.querySelectorAll(`#${containerId} [data-pr-item-row]`)].map(row => ({
    group: row.querySelector('.pr-item-group').value.trim(),
    content: row.querySelector('.pr-item-content').value.trim(),
    [progressField]: row.querySelector('.pr-item-progress').value.trim(),
    deadline: row.querySelector('.pr-item-deadline').value,
    support: row.querySelector('.pr-item-support').value.trim()
  }));
}

function addPrItemRow(containerId, progressField, progressLabel, removeFnName) {
  const current = collectPrItemsTable(containerId, progressField);
  current.push({ group: '', content: '', [progressField]: '', deadline: '', support: '' });
  renderPrItemsTable(containerId, current, progressField, progressLabel, removeFnName);
}

function removePrItemRow(containerId, idx, progressField, progressLabel, removeFnName) {
  const current = collectPrItemsTable(containerId, progressField);
  current.splice(idx, 1);
  renderPrItemsTable(containerId, current, progressField, progressLabel, removeFnName);
}

// Chọn nhiều file PDF ở form Nhập Báo Cáo — ghép TẤT CẢ file đã chọn thành 1 blob PDF DUY NHẤT ngay
// trong trình duyệt bằng pdf-lib (PDFDocument.create() + copyPages() từng nguồn + save()) — giữ nguyên
// vẹn từng trang gốc. Lưu tạm vào prEntryPendingFile — chỉ thực sự tải lên server lúc bấm Lưu Nháp/Gửi.
async function onPrEntryPdfFilesChange(event) {
  const files = Array.from(event.target.files || []);
  const statusEl = document.getElementById('prEntryPdfStatus');
  prEntryPendingFile = null;
  if (!files.length) { statusEl.classList.add('hidden'); return; }

  statusEl.className = 'text-xs mt-2 p-2 rounded border bg-gray-50 text-gray-600 border-gray-200';
  statusEl.innerText = `⏳ Đang ghép ${files.length} tệp PDF...`;
  statusEl.classList.remove('hidden');
  try {
    await loadVendorScript('/vendor/pdf-lib/pdf-lib.min.js');
    const PDFLib = window.PDFLib;
    const merged = await PDFLib.PDFDocument.create();
    let pageCount = 0;
    for (const f of files) {
      const bytes = await f.arrayBuffer();
      const srcDoc = await PDFLib.PDFDocument.load(bytes);
      const copiedPages = await merged.copyPages(srcDoc, srcDoc.getPageIndices());
      copiedPages.forEach((p) => merged.addPage(p));
      pageCount += srcDoc.getPageCount();
    }
    if (!pageCount) throw new Error('Không đọc được trang nào từ các tệp đã chọn');
    const mergedBytes = await merged.save();
    const mergedFile = new File([mergedBytes], `bao-cao-ghep-${Date.now()}.pdf`, { type: 'application/pdf' });
    prEntryPendingFile = { file: mergedFile, parsedSlides: [] };
    statusEl.className = 'text-xs mt-2 p-2 rounded border bg-emerald-50 text-emerald-800 border-emerald-200';
    statusEl.innerText = `✅ Đã ghép ${files.length} tệp (${pageCount} trang) thành 1 tệp PDF duy nhất.`;
  } catch (err) {
    statusEl.className = 'text-xs mt-2 p-2 rounded border bg-red-50 text-red-700 border-red-200';
    statusEl.innerText = `⛔ Không ghép được: ${err.message}`;
    event.target.value = '';
  }
}

// Hiện gợi ý "đã có tệp X" cho 1 ô file input khi sửa tiếp báo cáo nháp — không chọn tệp mới thì giữ
// nguyên tệp cũ (existingMeta), giống openEditContract() không bắt buộc chọn lại file khi sửa.
function showPrExistingFileHint(hintId, meta) {
  const el = document.getElementById(hintId);
  if (!el) return;
  if (meta?.fileUrl) {
    el.innerText = `📎 Đã có tệp: ${meta.fileName || 'tệp đính kèm'} (không chọn tệp mới = giữ nguyên)`;
    el.classList.remove('hidden');
  } else {
    el.innerText = '';
    el.classList.add('hidden');
  }
}

function onPrEntryPeriodChange() {
  const periodId = Number(document.getElementById('prEntryPeriodSelect').value);
  const wrap = document.getElementById('prEntryFormWrap');
  const noteEl = document.getElementById('prEntryAlreadySentNote');
  prEntryDraftId = null;
  prEntryExistingFile = null;
  prEntryPendingFile = null;
  if (!periodId) { wrap.classList.add('hidden'); noteEl.classList.add('hidden'); return; }
  const period = DB.reportPeriods.find(p => p.id === periodId);
  if (!period) { wrap.classList.add('hidden'); noteEl.classList.add('hidden'); return; }

  const existing = findOwnReportEntryForPeriod(periodId);
  if (existing && existing.status !== 'DRAFT') {
    wrap.classList.add('hidden');
    noteEl.innerHTML = '⏳ Bạn đã gửi báo cáo ở kỳ này — xem chi tiết trong danh sách bên dưới. Báo cáo đã gửi không sửa lại được nữa.';
    noteEl.classList.remove('hidden');
    return;
  }
  noteEl.classList.add('hidden');

  prEntryDraftId = existing ? existing.id : null; // existing (nếu có) chắc chắn đang DRAFT ở nhánh này
  document.getElementById('prEntryTitle').value = existing?.title || '';
  document.getElementById('prEntryPdfFiles').value = '';
  document.getElementById('prEntryPdfStatus').classList.add('hidden');

  // Chỉ còn hình thức PDF — bản nháp CŨ lỡ dở nộp bằng .pptx (đã bỏ hình thức này) không còn tệp nào để
  // giữ lại tiếp tục, bắt buộc chọn tệp PDF mới (rất hiếm gặp: chỉ ảnh hưởng đúng 1 bản NHÁP chưa gửi
  // tạo trước khi tính năng này bị gỡ, dữ liệu .pptx cũ không mất, chỉ không dùng lại được ở form này).
  prEntryExistingFile = (existing?.fileUrl && existing.entryType === 'PDF')
    ? { fileUrl: existing.fileUrl, fileName: existing.fileName, fileType: existing.fileType, parsedSlides: existing.parsedSlides || [] }
    : null;
  showPrExistingFileHint('prEntryPdfExisting', prEntryExistingFile);

  wrap.classList.remove('hidden');

  const submitBtn = document.getElementById('btnPrEntrySubmit');
  submitBtn.classList.toggle('hidden', !prEntryDraftId);
  submitBtn.onclick = () => submitPrEntryAction(prEntryDraftId, true);
}

// Tải tệp cho 1 ô (nếu người dùng chọn tệp mới) — không chọn gì thì giữ nguyên tệp cũ (existingMeta,
// null khi tạo mới/mục chưa có tệp trước đó). Trả về {fileUrl,fileName,fileType} hoặc null cả 3.
async function uploadPrOptionalFile(inputId, existingMeta) {
  const input = document.getElementById(inputId);
  const file = input?.files?.[0];
  if (!file) return existingMeta ? { fileUrl: existingMeta.fileUrl, fileName: existingMeta.fileName, fileType: existingMeta.fileType } : { fileUrl: null, fileName: null, fileType: null };
  const uploaded = await uploadFileToServer(file, 'periodicReport');
  return { fileUrl: uploaded.fileUrl, fileName: uploaded.fileName, fileType: uploaded.fileType };
}

// "Lưu Nháp" — tạo hồ sơ NHÁP mới (lần đầu) hoặc cập nhật NHÁP đã có (sửa tiếp), tuỳ prEntryDraftId.
// Chưa gửi — phải bấm "Gửi Báo Cáo" riêng mới chốt (không sửa lại được nữa).
async function savePrEntryDraft() {
  const periodId = Number(document.getElementById('prEntryPeriodSelect').value);
  if (!periodId) return alert('Vui lòng chọn kỳ báo cáo!');
  const period = DB.reportPeriods.find(p => p.id === periodId);
  if (!period) return alert('Không tìm thấy kỳ báo cáo!');
  const title = document.getElementById('prEntryTitle').value.trim();
  if (!title) return alert('Vui lòng nhập tiêu đề báo cáo!');

  const payload = { periodId, title, entryType: 'PDF' };
  try {
    if (prEntryPendingFile) {
      const uploaded = await uploadFileToServer(prEntryPendingFile.file, 'periodicReport');
      payload.fileUrl = uploaded.fileUrl; payload.fileName = uploaded.fileName; payload.fileType = uploaded.fileType;
      payload.parsedSlides = prEntryPendingFile.parsedSlides;
    } else if (prEntryExistingFile) {
      payload.fileUrl = prEntryExistingFile.fileUrl; payload.fileName = prEntryExistingFile.fileName; payload.fileType = prEntryExistingFile.fileType;
      payload.parsedSlides = prEntryExistingFile.parsedSlides;
    } else {
      return alert('Vui lòng chọn ít nhất 1 tệp báo cáo PDF cần tải lên!');
    }
  } catch (err) {
    return alert(`⛔ Tải tệp lên thất bại: ${err.message}`);
  }

  let savedEntry;
  try {
    if (prEntryDraftId) {
      const result = await callRecordAction('reportEntries', prEntryDraftId, 'update', payload);
      savedEntry = result.item;
    } else {
      payload.createdAt = new Date().toLocaleString('vi-VN');
      const result = await callCreateAction('reportEntries', payload);
      savedEntry = result.item;
    }
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.reportEntries.findIndex(e => e.id === savedEntry.id);
  if (idx !== -1) DB.reportEntries[idx] = savedEntry; else DB.reportEntries.unshift(savedEntry);
  prEntryDraftId = savedEntry.id;
  logSystemAction('PERIODIC_REPORT', 'SAVE_REPORT_ENTRY_DRAFT', `Lưu nháp báo cáo kỳ [${period.name}]`, 'SUCCESS', String(savedEntry.id));
  alert('✅ Đã lưu nháp — bạn có thể sửa tiếp hoặc bấm "Gửi Báo Cáo" khi đã hoàn tất.');
  renderPrEntryTable();
  onPrEntryPeriodChange();

  const submitBtn = document.getElementById('btnPrEntrySubmit');
  submitBtn.classList.remove('hidden');
  submitBtn.onclick = () => submitPrEntryAction(prEntryDraftId, true);
}

function submitPrEntry() { submitPrEntryAction(prEntryDraftId, true); }

// fromForm=true khi bấm từ form nhập liệu (ẩn form đi sau khi gửi xong); false khi bấm trực tiếp từ
// dropdown thao tác ở danh sách (không đụng tới form).
async function submitPrEntryAction(entryId, fromForm) {
  if (!entryId) return;
  const e = DB.reportEntries.find(x => x.id === entryId);
  if (!e) return;
  showConfirmModal({
    title: '📤 Xác Nhận Gửi Báo Cáo',
    bodyHTML: `<p>Gửi báo cáo <b>${escapeHtml(e.title)}</b> cho kỳ <b>${escapeHtml(e.periodName)}</b>? Sau khi gửi sẽ không sửa lại được nữa.</p>`,
    confirmLabel: 'Gửi Báo Cáo',
    onConfirm: async () => {
      let result;
      try {
        result = await callRecordAction('reportEntries', entryId, 'submit', {});
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const updated = result.item;
      const idx = DB.reportEntries.findIndex(x => x.id === entryId);
      if (idx !== -1) DB.reportEntries[idx] = updated;

      logSystemAction('PERIODIC_REPORT', 'SUBMIT_REPORT_ENTRY', `Gửi báo cáo [${updated.title}]`, 'SUCCESS', String(updated.id));
      alert('✅ Đã gửi báo cáo!');
      if (fromForm) { document.getElementById('prEntryFormWrap').classList.add('hidden'); prEntryDraftId = null; onPrEntryPeriodChange(); }
      renderPrEntryTable();
    }
  });
}

function prEntryStatusBadge(e) {
  if (e.status === 'DRAFT') return `<span class="px-2 py-0.5 bg-gray-200 text-gray-700 rounded font-bold text-xs">📝 Nháp</span>`;
  return `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-xs">✅ Đã gửi</span>`;
}

// Phạm vi xem: reportManage/reportAggregate/admin xem MỌI phòng ban. Còn lại xem được báo cáo ĐÃ GỬI
// (status !== 'DRAFT') của TOÀN BỘ phòng ban mình (không riêng của mình) — bản nháp (chưa gửi, còn
// đang soạn dở) chỉ chính người tạo nháp đó mới thấy, đồng nghiệp cùng phòng chưa thấy được.
function renderPrEntryTable() {
  const tbody = document.getElementById('prEntryTableBody');
  if (!tbody) return;
  const canSeeAll = canManageReportPeriodsClient(currentUser) || canAggregateReportsClient(currentUser);
  const visible = DB.reportEntries.filter(e =>
    canSeeAll || e.creator === currentUser.username || (e.dept === currentUser.dept && e.status !== 'DRAFT')
  );
  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center p-6 text-gray-500 italic">Chưa có báo cáo nào.</td></tr>`;
    return;
  }
  tbody.innerHTML = visible.map(e => {
    const isOwnDraft = e.status === 'DRAFT' && e.creator === currentUser.username;
    let primaryBtnHTML;
    const secondaryOptions = [];
    if (isOwnDraft) {
      primaryBtnHTML = `<button data-op="editPrEntryDraft" data-arg0="${e.id}" class="px-2.5 py-1 bg-gray-600 text-white rounded text-xs hover:opacity-90 font-bold">✏️ Sửa Nháp</button>`;
      secondaryOptions.push({ value: 'submit', label: '📤 Gửi Báo Cáo' });
    } else {
      primaryBtnHTML = `<span class="text-gray-400 italic text-[11px]">${escapeHtml(e.creatorName)} (${escapeHtml(e.dept)})</span>`;
    }
    if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2">${escapeHtml(e.periodName || '')}</td>
        <td class="border p-2 text-xs">${formatDateTimeVN(e.periodEndTime)}</td>
        <td class="border p-2">${escapeHtml(e.title)}${e.entryType === 'PDF' ? ' <span class="text-[10px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5 align-middle">PDF</span>' : ''}</td>
        <td class="border p-2">${prEntryStatusBadge(e)}</td>
        <td class="border p-2 text-center space-x-1">${buildActionCell(e.id, primaryBtnHTML, secondaryOptions, 'runPrEntryAction')}</td>
      </tr>
    `;
  }).join('');
}

function runPrEntryAction(id, action) {
  switch (action) {
    case 'submit': submitPrEntryAction(id, false); break;
    case 'delete': deletePrEntryAction(id); break;
  }
}

function editPrEntryDraft(id) {
  const e = DB.reportEntries.find(x => x.id === id);
  if (!e) return;
  setPeriodicReportSubTab('ENTRY');
  document.getElementById('prEntryPeriodSelect').value = String(e.periodId);
  onPrEntryPeriodChange();
}

function deletePrEntryAction(id) {
  deleteRecordAdminOnly('reportEntries', id, 'báo cáo', () => {
    DB.reportEntries = DB.reportEntries.filter(x => x.id !== id);
    renderPrEntryTable();
  });
}

// ============ KỲ BÁO CÁO (quản lý — chỉ reportManage/admin) ============
function renderReportDeptCheckboxes() {
  const el = document.getElementById('prPeriodDeptContainer');
  if (!el) return;
  el.innerHTML = DB.depts.map((d, idx) => `
    <label class="flex items-center gap-1 text-gray-700 cursor-pointer text-xs">
      <input type="checkbox" id="prPeriodDept_${idx}" value="${escapeHtml(d)}">
      <span class="truncate">${escapeHtml(d)}</span>
    </label>
  `).join('');
}

async function createReportPeriod(e) {
  e.preventDefault();
  const name = document.getElementById('prPeriodName').value.trim();
  const endTimeLocal = document.getElementById('prPeriodEndTime').value;
  if (!name) return alert('Vui lòng nhập tên kỳ báo cáo!');
  if (!endTimeLocal) return alert('Vui lòng chọn hạn chót nộp báo cáo!');
  const endTime = new Date(endTimeLocal).toISOString();
  if (new Date(endTime).getTime() <= Date.now()) return alert('Hạn chót nộp báo cáo phải ở trong tương lai!');

  const deptScope = {
    all: document.getElementById('prPeriodDeptAll').checked,
    depts: Array.from(document.querySelectorAll('[id^="prPeriodDept_"]:checked')).map(cb => cb.value)
  };
  if (!deptScope.all && !deptScope.depts.length) return alert('Vui lòng chọn ít nhất 1 phòng ban áp dụng, hoặc chọn "Tất cả phòng ban"!');

  const payload = { name, endTime, deptScope, createdAt: new Date().toLocaleString('vi-VN') };
  let newPeriod;
  try {
    const result = await callCreateAction('reportPeriods', payload);
    newPeriod = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.reportPeriods.unshift(newPeriod);
  logSystemAction('PERIODIC_REPORT', 'CREATE_REPORT_PERIOD', `Tạo kỳ báo cáo [${newPeriod.name}]`, 'SUCCESS', String(newPeriod.id));
  alert('✅ Đã tạo kỳ báo cáo mới!');

  document.getElementById('prPeriodName').value = '';
  document.getElementById('prPeriodEndTime').value = '';
  document.getElementById('prPeriodDeptAll').checked = false;
  renderReportDeptCheckboxes();
  renderPrPeriodsTable();
}

function prPeriodStatusBadge(p) {
  if (reportPeriodIsOpen(p)) return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">🟢 Đang mở</span>`;
  if (p.compilation?.status === 'PUBLISHED') return `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-xs">📣 Đã phát hành</span>`;
  if (p.compilation?.status === 'MERGED') return `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-xs">🧩 Đã tổng hợp</span>`;
  return `<span class="px-2 py-0.5 bg-gray-200 text-gray-700 rounded font-bold text-xs">🔒 Đã kết thúc</span>`;
}

function renderPrPeriodsTable() {
  const tbody = document.getElementById('prPeriodsTableBody');
  if (!tbody) return;
  if (!DB.reportPeriods.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center p-6 text-gray-500 italic">Chưa có kỳ báo cáo nào.</td></tr>`;
    return;
  }
  tbody.innerHTML = DB.reportPeriods.map(p => {
    const isOpen = reportPeriodIsOpen(p);
    const secondaryOptions = [];
    if (isOpen) secondaryOptions.push({ value: 'close', label: '🔒 Đóng Kỳ Sớm' });
    if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
    const primaryBtnHTML = `<span class="text-gray-400 italic text-[11px]">—</span>`;
    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2 font-bold text-sky-800">${escapeHtml(p.name)}</td>
        <td class="border p-2 text-xs">${escapeHtml(reportPeriodDeptLabel(p))}</td>
        <td class="border p-2 text-xs">${formatDateTimeVN(p.endTime)}</td>
        <td class="border p-2">${prPeriodStatusBadge(p)}</td>
        <td class="border p-2 text-center space-x-1">${buildActionCell(p.id, primaryBtnHTML, secondaryOptions, 'runPrPeriodAction')}</td>
      </tr>
    `;
  }).join('');
}

function runPrPeriodAction(id, action) {
  switch (action) {
    case 'close': closePrPeriodAction(id); break;
    case 'delete': deletePrPeriodAction(id); break;
  }
}

function closePrPeriodAction(id) {
  const p = DB.reportPeriods.find(x => x.id === id);
  if (!p) return;
  showConfirmModal({
    title: 'Đóng Kỳ Báo Cáo Sớm',
    bodyHTML: `Bạn có chắc chắn muốn đóng kỳ <b>${escapeHtml(p.name)}</b>? Sau khi đóng, không ai nộp/sửa báo cáo thêm được nữa.`,
    confirmLabel: 'Đóng Kỳ',
    onConfirm: async () => {
      let result;
      try {
        result = await callRecordAction('reportPeriods', id, 'close', {});
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const updated = result.item;
      const idx = DB.reportPeriods.findIndex(x => x.id === id);
      if (idx !== -1) DB.reportPeriods[idx] = updated;
      logSystemAction('PERIODIC_REPORT', 'CLOSE_REPORT_PERIOD', `Đóng sớm kỳ báo cáo [${updated.name}]`, 'SUCCESS', String(updated.id));
      alert('✅ Đã đóng kỳ báo cáo!');
      renderPrPeriodsTable();
    }
  });
}

function deletePrPeriodAction(id) {
  deleteRecordAdminOnly('reportPeriods', id, 'kỳ báo cáo', () => {
    DB.reportPeriods = DB.reportPeriods.filter(x => x.id !== id);
    renderPrPeriodsTable();
  });
}

// ============ TỔNG HỢP (reportAggregate/admin — tổng hợp được MỌI kỳ, không riêng kỳ mình tạo) ============
function renderPrAggPeriodOptions() {
  const sel = document.getElementById('prAggPeriodSelect');
  const closedPeriods = DB.reportPeriods.filter(reportPeriodIsClosed);
  sel.innerHTML = `<option value="">-- Chọn kỳ --</option>` +
    closedPeriods.map(p => {
      const tag = p.compilation?.status === 'PUBLISHED' ? ' (đã phát hành)' : p.compilation?.status === 'MERGED' ? ' (đã tổng hợp)' : '';
      return `<option value="${p.id}">${escapeHtml(p.name)}${tag}</option>`;
    }).join('');
  document.getElementById('prAggNoPeriodNote').classList.toggle('hidden', closedPeriods.length > 0);
  document.getElementById('prAggWrap').classList.add('hidden');
  prAggCurrentPeriodId = null;
  sel.value = '';
}

function onPrAggPeriodChange() {
  const periodId = Number(document.getElementById('prAggPeriodSelect').value);
  const wrap = document.getElementById('prAggWrap');
  if (!periodId) { wrap.classList.add('hidden'); prAggCurrentPeriodId = null; return; }
  const period = DB.reportPeriods.find(p => p.id === periodId);
  if (!period) { wrap.classList.add('hidden'); return; }

  prAggCurrentPeriodId = periodId;
  // Khởi tạo lại thứ tự đã chọn + bản đang sửa từ bản tổng hợp hiện có (nếu có), không mất lựa chọn cũ.
  prAggSelectedIds = (period.compilation?.slides || []).map(s => s.sourceEntryId).filter(id => id != null);
  prAggPendingSlides = period.compilation ? period.compilation.slides.map(s => ({ ...s })) : null;
  wrap.classList.remove('hidden');
  renderPrAggEntriesList();
  renderPrAggOrderList();
  renderPrAggCompilation();
  renderPrAggPdfSection();
  renderPrTaskCompilation();
}

// entryType==='PDF' tổng hợp RIÊNG qua getPrAggPdfPeriodEntries()/renderPrAggPdfSection() bên dưới (dựng
// period.pdfCompilation, tách hẳn khỏi period.compilation) — loại khỏi checklist PPTX ở đây để không sinh
// slide DEPT trống (mirror fix ở mergeReportPeriod(), lib/recordActions.js).
function getPrAggPeriodEntries() {
  return DB.reportEntries.filter(e => e.periodId === prAggCurrentPeriodId && e.status === 'SUBMITTED' && e.entryType !== 'PDF');
}

function getPrAggPdfPeriodEntries() {
  return DB.reportEntries.filter(e => e.periodId === prAggCurrentPeriodId && e.status === 'SUBMITTED' && e.entryType === 'PDF');
}

function renderPrAggEntriesList() {
  const el = document.getElementById('prAggEntriesList');
  const entries = getPrAggPeriodEntries();
  if (!entries.length) {
    el.innerHTML = `<div class="text-xs text-gray-400 italic">Chưa có báo cáo nào được gửi trong kỳ này.</div>`;
    return;
  }
  el.innerHTML = entries.map(e => `
    <label class="flex items-center gap-2 text-xs p-1.5 rounded hover:bg-sky-50 cursor-pointer">
      <input type="checkbox" data-op-change="onPrAggEntryCheckboxChange" data-arg0="${e.id}" data-arg-el="1" ${prAggSelectedIds.includes(e.id) ? 'checked' : ''}>
      <span class="font-semibold text-gray-700">${escapeHtml(e.title)}</span>
      <span class="text-gray-400">— ${escapeHtml(e.creatorName)} (${escapeHtml(e.dept)})</span>
    </label>
  `).join('');
}

function togglePrAggEntry(entryId, checked) {
  if (checked) {
    if (!prAggSelectedIds.includes(entryId)) prAggSelectedIds.push(entryId);
  } else {
    prAggSelectedIds = prAggSelectedIds.filter(id => id !== entryId);
  }
  renderPrAggEntriesList();
  renderPrAggOrderList();
}

// Wrapper CSP-safe cho checkbox onchange="togglePrAggEntry(id, this.checked)" cũ — data-arg-el nhận
// thẳng phần tử checkbox để đọc .checked (không có slot data-arg cho this.checked).
function onPrAggEntryCheckboxChange(entryId, el) { togglePrAggEntry(entryId, el.checked); }
// Wrapper cho nút ✕ bỏ chọn ở khối "Thứ tự đã chọn" — tương đương onclick="togglePrAggEntry(id, false)"
// cũ, tách riêng vì tham số boolean literal "false" bị cspCoerceArg() giữ nguyên dạng chuỗi (chỉ số
// nguyên mới coerce được), chuỗi "false" lại truthy trong JS nên không dùng data-argN trực tiếp được.
function untogglePrAggEntry(entryId) { togglePrAggEntry(entryId, false); }

function movePrAggEntry(idx, dir) {
  const target = idx + dir;
  if (target < 0 || target >= prAggSelectedIds.length) return;
  [prAggSelectedIds[idx], prAggSelectedIds[target]] = [prAggSelectedIds[target], prAggSelectedIds[idx]];
  renderPrAggOrderList();
}

function renderPrAggOrderList() {
  const el = document.getElementById('prAggOrderList');
  const byId = new Map(getPrAggPeriodEntries().map(e => [e.id, e]));
  if (!prAggSelectedIds.length) {
    el.innerHTML = `<div class="text-xs text-gray-400 italic">Chưa chọn báo cáo nào.</div>`;
    return;
  }
  el.innerHTML = prAggSelectedIds.map((id, idx) => {
    const e = byId.get(id);
    if (!e) return '';
    return `
      <div class="flex items-center gap-2 text-xs p-1.5 rounded border bg-sky-50/60">
        <span class="font-bold text-sky-700 w-5 text-center">${idx + 1}</span>
        <span class="flex-1 truncate">${escapeHtml(e.title)} <span class="text-gray-400">— ${escapeHtml(e.creatorName)}</span></span>
        <button type="button" data-op="movePrAggEntry" data-arg0="${idx}" data-arg1="-1" class="px-1.5 py-0.5 bg-gray-200 rounded hover:bg-gray-300" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" data-op="movePrAggEntry" data-arg0="${idx}" data-arg1="1" class="px-1.5 py-0.5 bg-gray-200 rounded hover:bg-gray-300" ${idx === prAggSelectedIds.length - 1 ? 'disabled' : ''}>▼</button>
        <button type="button" data-op="untogglePrAggEntry" data-arg0="${id}" class="px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded hover:bg-rose-200">✕</button>
      </div>
    `;
  }).join('');
}

async function mergeReportPeriodAction() {
  if (!prAggCurrentPeriodId) return;
  if (!prAggSelectedIds.length) return alert('Vui lòng chọn ít nhất 1 báo cáo để tổng hợp!');
  const period = DB.reportPeriods.find(p => p.id === prAggCurrentPeriodId);
  if (!period) return;
  if (period.compilation?.status === 'PUBLISHED') {
    return alert('⛔ Bản tổng hợp đã phát hành — vui lòng "Hủy phát hành" trước khi tổng hợp lại.');
  }
  let result;
  try {
    result = await callRecordAction('reportPeriods', prAggCurrentPeriodId, 'merge', { entryIds: prAggSelectedIds });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const updated = result.item;
  const idx = DB.reportPeriods.findIndex(p => p.id === updated.id);
  if (idx !== -1) DB.reportPeriods[idx] = updated;
  prAggPendingSlides = updated.compilation.slides.map(s => ({ ...s }));
  logSystemAction('PERIODIC_REPORT', 'MERGE_REPORT_PERIOD', `Tổng hợp kỳ báo cáo [${updated.name}]: ${prAggSelectedIds.length} báo cáo`, 'SUCCESS', String(updated.id));
  alert('✅ Đã tổng hợp — bạn có thể sửa lại từng phần trước khi phát hành.');
  renderPrAggCompilation();
  renderPrPeriodsTable();
}

