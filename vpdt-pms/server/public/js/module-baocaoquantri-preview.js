// ==========================================
// "1. Tạo Báo Cáo Theo Yêu Cầu" — xem trước dạng văn bản trước khi xuất Excel/in. TÁI DÙNG NGUYÊN dữ
// liệu đã lọc + đã chọn cột ở khối "🔍 Tra Cứu Chi Tiết" ngay bên dưới (reportDetailContext/
// reportDetailFilterValues/reportDetailSelectedCols) — không tính lại/không tạo nguồn dữ liệu thứ 2,
// đảm bảo bản xem trước LUÔN khớp đúng file Excel/bản in cuối cùng (dùng lại thẳng
// exportReportDetailExcel() có sẵn để xuất, không viết logic xuất riêng).
// ==========================================
let currentReportPreviewModuleKey = null;

function buildReportPreviewLauncherHTML(moduleKey) {
  return `
    <div class="bg-indigo-50 border border-indigo-200 rounded p-3 text-xs flex items-center justify-between gap-2 flex-wrap">
      <div>
        <div class="font-bold text-indigo-900 text-sm">🖨️ 1. Tạo Báo Cáo Theo Yêu Cầu</div>
        <div class="text-indigo-700 text-[11px] mt-0.5">Xem trước dạng văn bản (đúng cột/điều kiện đang chọn ở khối "🔍 2. Tra Cứu Chi Tiết" bên dưới) trước khi xuất Excel hoặc in.</div>
      </div>
      <button type="button" data-op="showReportPreview" data-arg0="${moduleKey}" class="bg-indigo-600 text-white px-3 py-1.5 rounded font-bold text-xs hover:bg-indigo-700 whitespace-nowrap shrink-0">👁️ Xem Trước & Xuất</button>
    </div>
  `;
}

function buildReportPreviewDocumentHTML(moduleKey) {
  const ctx = reportDetailContext;
  if (!ctx || ctx.moduleKey !== moduleKey) return { error: 'Chưa có dữ liệu — vui lòng thử lại.' };
  const config = ctx.config;
  const selectedKeys = reportDetailSelectedCols[moduleKey] || [];
  const cols = selectedKeys.map(k => ctx.columns.find(c => c.key === k)).filter(Boolean);
  if (!cols.length) return { error: 'Vui lòng chọn ít nhất 1 trường ở khối "🔍 Tra Cứu Chi Tiết" bên dưới trước khi xem trước.' };
  const filtered = applyReportDetailFilters(ctx.records, ctx.columns, reportDetailFilterValues[moduleKey]);

  const fromDate = document.getElementById('reportsFromDate')?.value || '';
  const toDate = document.getElementById('reportsToDate')?.value || '';
  const deptFilter = document.getElementById('reportsDeptFilter')?.value || '';
  const rangeLabel = (fromDate || toDate) ? `Từ ${fromDate ? formatDateVN(fromDate) : '...'} đến ${toDate ? formatDateVN(toDate) : '...'}` : 'Toàn bộ thời gian';
  const deptLabel = deptFilter ? `Phòng ban/Siêu thị: ${deptFilter}` : 'Tất cả phòng ban/siêu thị';

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color:#111;">
      <h2 style="margin:0 0 4px;">${escapeHtml(config.title || 'Báo Cáo')}</h2>
      <div style="font-size:12px;color:#555;margin-bottom:2px;">${escapeHtml(rangeLabel)} — ${escapeHtml(deptLabel)}</div>
      <div style="font-size:12px;color:#555;margin-bottom:12px;">Xuất lúc: ${new Date().toLocaleString('vi-VN')} — Tổng số dòng: ${filtered.length.toLocaleString('vi-VN')}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr>${cols.map(c => `<th style="border:1px solid #999;padding:4px 6px;background:#eef2ff;text-align:left;">${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${filtered.length ? filtered.map(r => `<tr>${cols.map(c => `<td style="border:1px solid #ccc;padding:4px 6px;">${escapeHtml(formatReportDetailValue(c, c.getValue(r)))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" style="text-align:center;padding:16px;color:#888;font-style:italic;">Không có hồ sơ nào khớp bộ lọc.</td></tr>`}</tbody>
      </table>
    </div>
  `;
  return { html };
}

function showReportPreview(moduleKey) {
  const built = buildReportPreviewDocumentHTML(moduleKey);
  if (built.error) { alert(built.error); return; }
  currentReportPreviewModuleKey = moduleKey;
  document.getElementById('reportPreviewModalBody').innerHTML = built.html;
  document.getElementById('reportPreviewModal').classList.remove('hidden');
}

function closeReportPreviewModal() {
  document.getElementById('reportPreviewModal').classList.add('hidden');
  currentReportPreviewModuleKey = null;
}

function printReportPreview() {
  const bodyHTML = document.getElementById('reportPreviewModalBody')?.innerHTML || '';
  const fullHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>In báo cáo</title></head><body>${bodyHTML}</body></html>`;
  printHtmlViaHiddenIframe(fullHTML);
}

// Xuất Excel từ màn xem trước — dùng thẳng exportReportDetailExcel() có sẵn (cùng module/cùng bộ lọc/
// cùng cột đã chọn — đảm bảo file tải về khớp đúng những gì vừa xem trước, không viết logic xuất riêng).
function exportReportPreviewExcel() {
  if (!currentReportPreviewModuleKey) return;
  exportReportDetailExcel(currentReportPreviewModuleKey);
}

function renderReportDetailSection(moduleKey, records, config) {
  const columns = buildReportDetailColumns(moduleKey, records, config);
  reportDetailContext = { moduleKey, records, columns, config };
  if (!reportDetailFilterValues[moduleKey]) reportDetailFilterValues[moduleKey] = {};
  // Chỉ gán mặc định khi CHƯA từng gán VÀ đang có ít nhất 1 cột — tránh trường hợp lần render đầu tiên
  // rơi vào đúng lúc records rỗng (vd bộ lọc ngày/phòng ban ở trên đang không khớp hồ sơ nào) khiến
  // columns = [] rồi gán reportDetailSelectedCols[moduleKey] = [] (mảng rỗng vẫn là giá trị truthy
  // trong JS) — khoá cứng "chưa gán" mãi mãi, khiến module đó không bao giờ tự chọn lại cột mặc định
  // dù sau đó records đã có dữ liệu thật.
  if (!reportDetailSelectedCols[moduleKey] && columns.length) reportDetailSelectedCols[moduleKey] = columns.slice(0, 6).map(c => c.key);
  const selectedSet = new Set(reportDetailSelectedCols[moduleKey] || []);

  if (!columns.length) return '';

  return `
    <details class="bg-white rounded border text-xs">
      <summary class="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 rounded">
        <span class="font-bold text-gray-800 text-sm">🔍 2. Tra Cứu Chi Tiết</span>
        <span class="text-[11px] text-gray-500">Lọc theo nhiều điều kiện + tự chọn cột hiển thị</span>
      </summary>
      <div class="p-3 pt-0 space-y-3">
        <div>
          <div class="flex items-center justify-between mb-1">
            <span class="font-semibold text-gray-600 text-[11px]">Điều kiện lọc</span>
            <button type="button" data-op="resetReportDetailFilters" data-arg0="${moduleKey}" class="text-[11px] text-gray-500 hover:underline">Đặt lại bộ lọc</button>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
            ${columns.map(c => `
              <div>
                <label class="block text-[10px] text-gray-500 mb-0.5">${escapeHtml(c.label)}</label>
                ${buildReportDetailFilterControlHTML(moduleKey, c)}
              </div>
            `).join('')}
          </div>
        </div>
        <div>
          <span class="font-semibold text-gray-600 text-[11px] block mb-1">Trường hiển thị / xuất Excel</span>
          <div class="flex flex-wrap gap-x-3 gap-y-1 border rounded p-2 bg-gray-50 max-h-24 overflow-y-auto">
            ${columns.map(c => `
              <label class="flex items-center gap-1 text-[11px] text-gray-700 cursor-pointer">
                <input type="checkbox" id="rdc_${moduleKey}_${c.key}" data-op-change="onReportDetailColumnToggleFromCheckbox" data-arg0="${moduleKey}" data-arg1="${c.key}" data-arg-el="2" ${selectedSet.has(c.key) ? 'checked' : ''}>
                <span>${escapeHtml(c.label)}</span>
              </label>
            `).join('')}
          </div>
        </div>
        <div class="flex justify-end">
          <button type="button" data-op="exportReportDetailExcel" data-arg0="${moduleKey}" class="text-[11px] bg-emerald-600 text-white px-3 py-1.5 rounded font-bold hover:bg-emerald-700">⬇️ Xuất Excel (chi tiết)</button>
        </div>
        <div id="reportDetailResultsWrap">${buildReportDetailResultsHTML(moduleKey)}</div>
      </div>
    </details>
  `;
}

function renderContractReportExtra(records) {
  // So theo NGÀY LỊCH (bỏ giờ/phút), khớp daysUntil() ở jobs/contractExpiryReminder.js — trước đây so
  // c.endDate (parse ra 0h) với "now" có giờ/phút thực tế, khiến hợp đồng hết hạn ĐÚNG hôm nay bị tính
  // nhầm "đã hết hạn" suốt cả ngày thay vì "còn hiệu lực"/"sắp hết hạn".
  // Chỉ tính giá trị/hạn hiệu lực trên hợp đồng ĐÃ DUYỆT — khớp cách renderReportsSummary() lọc
  // officeBySubType bên dưới (case "Chỉ cộng dồn đề nghị ĐÃ DUYỆT"). Trước đây cộng cả PENDING/
  // REJECTED, khiến giá trị hợp đồng còn hiệu lực/đã hết hạn bị thổi phồng bằng những hồ sơ chưa từng
  // được duyệt (thậm chí đã bị từ chối) — không phản ánh đúng cam kết tài chính thực tế.
  const approvedRecords = records.filter(c => c.approvalStatus === 'APPROVED');
  const rawNow = new Date();
  const now = new Date(rawNow.getFullYear(), rawNow.getMonth(), rawNow.getDate());
  const activeValue = approvedRecords.filter(c => new Date(c.endDate) >= now).reduce((s, c) => s + (c.amount || 0), 0);
  const expiredValue = approvedRecords.filter(c => new Date(c.endDate) < now).reduce((s, c) => s + (c.amount || 0), 0);
  const soon = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const expiringSoon = approvedRecords.filter(c => { const end = new Date(c.endDate); return end >= now && end <= soon; });
  return `
    <div class="bg-white p-4 rounded border">
      <h4 class="font-bold text-gray-800 mb-3">💰 Giá Trị Hợp Đồng</h4>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-center">
        <div class="bg-green-50 border border-green-200 rounded p-3">
          <div class="font-bold text-green-700">${activeValue.toLocaleString('vi-VN')} VNĐ</div>
          <div class="text-[11px] text-gray-500 mt-1">Còn hiệu lực</div>
        </div>
        <div class="bg-red-50 border border-red-200 rounded p-3">
          <div class="font-bold text-red-700">${expiredValue.toLocaleString('vi-VN')} VNĐ</div>
          <div class="text-[11px] text-gray-500 mt-1">Đã hết hạn</div>
        </div>
        <div class="bg-amber-50 border border-amber-200 rounded p-3">
          <div class="font-bold text-amber-700">${expiringSoon.length}</div>
          <div class="text-[11px] text-gray-500 mt-1">Sắp hết hạn (30 ngày tới)</div>
        </div>
      </div>
      ${expiringSoon.length ? `
        <div class="mt-3 overflow-x-auto">
          <table class="w-full border-collapse border text-xs">
            <thead><tr class="bg-gray-100"><th class="border p-2 text-left">Mã HĐ</th><th class="border p-2 text-left">Tên hợp đồng</th><th class="border p-2">Ngày hết hạn</th></tr></thead>
            <tbody>${expiringSoon.map(c => `<tr><td class="border p-2 font-mono">${escapeHtml(c.code)}</td><td class="border p-2">${escapeHtml(c.title)}</td><td class="border p-2 text-center">${escapeHtml(c.endDate)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;
}

function renderOfficeReportExtra(records) {
  // Chỉ cộng dồn đề xuất ĐÃ DUYỆT — khớp đúng cách renderReportsSummary() lọc officeBySubType (tab
  // "Tổng Hợp"), trước đây 2 nơi lệch nhau: tab "Tổng Hợp" chỉ cộng APPROVED còn tab riêng "Văn Phòng
  // Tổng Hợp" này cộng cả PENDING/REJECTED, khiến 2 tab cho ra 2 con số dự toán khác nhau cho cùng 1
  // khoảng thời gian/phòng ban lọc.
  const approvedRecords = records.filter(o => o.status === 'APPROVED');
  const bySubType = { MUA_BAN: 0, SUA_CHUA: 0 };
  approvedRecords.forEach(o => { bySubType[o.subType] = (bySubType[o.subType] || 0) + (o.amount || 0); });
  const max = Math.max(1, ...Object.values(bySubType));
  return `
    <div class="bg-white p-4 rounded border">
      <h4 class="font-bold text-gray-800 mb-3">💰 Dự Toán Theo Phân Hệ (VNĐ)</h4>
      <div class="space-y-2">
        ${buildStatBarHTML('Mua sắm', bySubType.MUA_BAN, max, 'bg-teal-500')}
        ${buildStatBarHTML('Sửa chữa', bySubType.SUA_CHUA, max, 'bg-amber-500')}
      </div>
    </div>
  `;
}

// Ước tính "đúng hạn" dựa trên thời điểm của mục lịch sử GẦN NHẤT so với hạn hoàn thành (Công Việc
// chưa lưu thời điểm hoàn thành riêng — xem t.history ở renderTaskDetail()) — đủ dùng làm chỉ báo xu
// hướng cho báo cáo, không phải số liệu tuyệt đối.
// records = uniformIssuances đã lọc theo dept/ngày (getRecords ở REPORT_MODULE_CONFIGS.uniform) — bảng
// tồn kho bên dưới KHÔNG áp bộ lọc ngày (tồn kho là ảnh chụp TẠI THỜI ĐIỂM HIỆN TẠI, không phải số
// liệu phát sinh trong khoảng ngày đã chọn), chỉ áp bộ lọc phòng ban nếu có chọn, dùng chung
// computeUniformStockClient() với màn hình module Đồng Phục để khỏi lệch logic.
function renderUniformReportExtra(records) {
  const totalIssuedQty = records.reduce((sum, r) => sum + (r.items || []).reduce((s, it) => s + (it.qty || 0), 0), 0);
  const deptFilter = document.getElementById('reportsDeptFilter')?.value || '';
  const storeDepts = deptFilter ? [deptFilter] : [...new Set((DB.uniformPeriods || []).flatMap(p => (p.allocations || []).map(a => a.dept)))].sort();

  const stockRows = [];
  for (const dept of storeDepts) {
    const stock = computeUniformStockClient(dept);
    for (const row of stock.values()) stockRows.push({ dept, ...row });
  }
  const totalAllocatedQty = stockRows.reduce((s, r) => s + r.allocated, 0);
  const totalStockQty = stockRows.reduce((s, r) => s + r.stock, 0);

  // Chi tiết theo NHÂN VIÊN (Phase 2) — nhân viên nào nhận mặt hàng/size/mã SKU nào, lọc theo ĐÚNG
  // records đã qua getRecords() (đã áp bộ lọc siêu thị + khoảng ngày ở trên) — không tính lại từ đầu.
  const employeeRows = [];
  for (const r of records) {
    for (const it of (r.items || [])) {
      employeeRows.push({ dept: r.dept, employeeName: r.employeeName, itemName: it.name, size: it.size, qty: it.qty, code: uniformSkuFor(it.name, it.size), createdAt: r.createdAt });
    }
  }
  employeeRows.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'vi'));

  return `
    <div class="bg-white p-4 rounded border space-y-3">
      <h4 class="font-bold text-gray-800 mb-1">👕 Đồng Phục — Cấp Phát & Tồn Kho</h4>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-center">
        <div class="bg-emerald-50 border border-emerald-200 rounded p-3">
          <div class="font-bold text-emerald-700">${totalIssuedQty.toLocaleString('vi-VN')}</div>
          <div class="text-[11px] text-gray-500 mt-1">Tổng SL đã cấp cho nhân viên (trong khoảng lọc)</div>
        </div>
        <div class="bg-sky-50 border border-sky-200 rounded p-3">
          <div class="font-bold text-sky-700">${totalAllocatedQty.toLocaleString('vi-VN')}</div>
          <div class="text-[11px] text-gray-500 mt-1">Tổng SL Hành Chính đã phân bổ (đã xác nhận, mọi thời điểm)</div>
        </div>
        <div class="bg-amber-50 border border-amber-200 rounded p-3">
          <div class="font-bold text-amber-700">${totalStockQty.toLocaleString('vi-VN')}</div>
          <div class="text-[11px] text-gray-500 mt-1">Tổng tồn kho hiện tại</div>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-xs">
          <thead><tr class="bg-gray-100 text-left">
            <th class="border p-2">Siêu Thị</th>
            <th class="border p-2">Mặt Hàng</th>
            <th class="border p-2">Size</th>
            <th class="border p-2 text-right">Đã Nhận</th>
            <th class="border p-2 text-right">Đã Cấp NV</th>
            <th class="border p-2 text-right">Tồn Kho</th>
          </tr></thead>
          <tbody>
            ${stockRows.length ? stockRows.map(r => `
              <tr>
                <td class="border p-2 font-semibold">${escapeHtml(r.dept)}</td>
                <td class="border p-2">${escapeHtml(r.name)}</td>
                <td class="border p-2">${escapeHtml(r.size || '—')}</td>
                <td class="border p-2 text-right">${r.allocated.toLocaleString('vi-VN')}</td>
                <td class="border p-2 text-right">${r.issued.toLocaleString('vi-VN')}</td>
                <td class="border p-2 text-right font-bold ${r.stock <= 0 ? 'text-red-600' : 'text-green-700'}">${r.stock.toLocaleString('vi-VN')}</td>
              </tr>
            `).join('') : `<tr><td colspan="6" class="text-center p-4 text-gray-500 italic">Chưa có dữ liệu tồn kho.</td></tr>`}
          </tbody>
        </table>
      </div>

      <h4 class="font-bold text-gray-800 mb-1 mt-4">🧍 Chi Tiết Theo Nhân Viên (khớp bộ lọc siêu thị/ngày ở trên)</h4>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-xs">
          <thead><tr class="bg-gray-100 text-left">
            <th class="border p-2">Nhân Viên</th>
            <th class="border p-2">Siêu Thị</th>
            <th class="border p-2">Mặt Hàng</th>
            <th class="border p-2">Size</th>
            <th class="border p-2">Mã SKU</th>
            <th class="border p-2 text-right">SL</th>
            <th class="border p-2">Ngày Cấp</th>
          </tr></thead>
          <tbody>
            ${employeeRows.length ? employeeRows.map(r => `
              <tr>
                <td class="border p-2">${escapeHtml(r.employeeName || '')}</td>
                <td class="border p-2">${escapeHtml(r.dept)}</td>
                <td class="border p-2">${escapeHtml(r.itemName)}</td>
                <td class="border p-2">${escapeHtml(r.size || '—')}</td>
                <td class="border p-2 font-mono text-cyan-700">${escapeHtml(r.code || '—')}</td>
                <td class="border p-2 text-right">${r.qty.toLocaleString('vi-VN')}</td>
                <td class="border p-2">${escapeHtml(r.createdAt || '')}</td>
              </tr>
            `).join('') : `<tr><td colspan="7" class="text-center p-4 text-gray-500 italic">Chưa có dữ liệu cấp phát trong khoảng đã lọc.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderTaskReportExtra(records) {
  const done = records.filter(t => t.status === 'DONE');
  let onTime = 0;
  const withDeadline = done.filter(t => t.deadline);
  withDeadline.forEach(t => {
    const lastEntry = (t.history || [])[(t.history || []).length - 1];
    const completedTime = lastEntry ? parseVNDateTime(lastEntry.time) : null;
    if (completedTime && completedTime <= new Date(t.deadline + 'T23:59:59')) onTime++;
  });
  const rate = withDeadline.length ? Math.round((onTime / withDeadline.length) * 100) : 0;
  return `
    <div class="bg-white p-4 rounded border">
      <h4 class="font-bold text-gray-800 mb-3">⏱️ Tỷ Lệ Hoàn Thành Đúng Hạn</h4>
      <div class="bg-gray-50 border rounded p-3 text-center">
        <div class="text-2xl font-bold ${rate >= 80 ? 'text-green-700' : rate >= 50 ? 'text-amber-700' : 'text-red-700'}">${rate}%</div>
        <div class="text-xs text-gray-600 mt-1">${onTime}/${withDeadline.length} công việc có hạn hoàn thành đúng hạn (trong ${done.length} đã hoàn thành)</div>
      </div>
      <p class="text-[10px] text-gray-400 italic mt-2">* Ước tính theo thời điểm cập nhật gần nhất trong lịch sử xử lý so với hạn hoàn thành.</p>
    </div>
  `;
}

function renderInternalReportExtra(records) {
  const byType = { NEWS: 0, TRAINING: 0, REWARD: 0, SHARE: 0 };
  records.forEach(p => { byType[p.type] = (byType[p.type] || 0) + 1; });
  const totalLikes = records.reduce((s, p) => s + (p.likes?.length || 0), 0);
  const totalComments = records.reduce((s, p) => s + (p.comments?.length || 0), 0);
  const max = Math.max(1, ...Object.values(byType));
  return `
    <div class="bg-white p-4 rounded border">
      <h4 class="font-bold text-gray-800 mb-3">📣 Theo Phân Hệ & Tương Tác</h4>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="space-y-2">
          ${buildStatBarHTML('Nhịp Sống HCRC', byType.NEWS, max, 'bg-fuchsia-500')}
          ${buildStatBarHTML('Đào tạo', byType.TRAINING, max, 'bg-indigo-500')}
          ${buildStatBarHTML('Khen thưởng', byType.REWARD, max, 'bg-amber-500')}
          ${buildStatBarHTML('Góc chia sẻ', byType.SHARE, max, 'bg-teal-500')}
        </div>
        <div class="grid grid-cols-2 gap-3 content-start">
          <div class="bg-gray-50 border rounded p-3 text-center">
            <div class="text-xl font-bold text-rose-700">${totalLikes.toLocaleString('vi-VN')}</div>
            <div class="text-[11px] text-gray-500 mt-1">Lượt thích</div>
          </div>
          <div class="bg-gray-50 border rounded p-3 text-center">
            <div class="text-xl font-bold text-sky-700">${totalComments.toLocaleString('vi-VN')}</div>
            <div class="text-[11px] text-gray-500 mt-1">Bình luận</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function exportModuleReportExcel(moduleKey) {
  const config = REPORT_MODULE_CONFIGS[moduleKey];
  if (!config) return;
  const fromDate = document.getElementById('reportsFromDate')?.value || '';
  const toDate = document.getElementById('reportsToDate')?.value || '';
  const deptFilter = document.getElementById('reportsDeptFilter')?.value || '';
  const records = config.getRecords(deptFilter, fromDate, toDate);

  const rows = [['Tổng số hồ sơ', records.length]];
  if (config.statusOf) {
    const buckets = config.statusBuckets || [['PENDING', 'Đang chờ duyệt'], ['APPROVED', 'Đã phê duyệt'], ['REJECTED', 'Bị từ chối']];
    const counts = {};
    buckets.forEach(([key]) => { counts[key] = 0; });
    records.forEach(r => { const s = config.statusOf(r); if (s in counts) counts[s]++; });
    buckets.forEach(([key, label]) => rows.push([label, counts[key]]));
  }
  // Trước đây file xuất chỉ có số lượng hồ sơ theo trạng thái — bỏ sót hoàn toàn số liệu tài chính
  // (config.renderExtra) dù màn hình renderModuleReport() cùng tab đã hiển thị (VD "💰 Giá Trị Hợp
  // Đồng"/"💰 Dự Toán Theo Phân Hệ") — người xem tab Hợp Đồng/Văn Phòng Tổng Hợp bấm xuất Excel ngay
  // trên tab đó không nhận được số tiền nào để đối chiếu.
  if (config.extraRows) rows.push(...config.extraRows(records));

  const columns = [
    { header: 'Chỉ số', key: 'label', width: 40 },
    { header: 'Giá trị', key: 'value', width: 20 }
  ];
  const dataRows = rows.map(([label, value]) => ({ label, value }));
  const sheetName = config.title.replace(/[^\w ]/g, '').trim().slice(0, 31) || 'BaoCao';
  downloadXlsxFromServer(`BaoCao_${moduleKey}_${new Date().toISOString().slice(0, 10)}.xlsx`, sheetName, columns, dataRows);
}

function renderReportsSummary(container) {
  const fromDate = document.getElementById('reportsFromDate')?.value || '';
  const toDate = document.getElementById('reportsToDate')?.value || '';
  const deptFilter = document.getElementById('reportsDeptFilter')?.value || '';
  // "Tổng Hợp" gộp số liệu của NHIỀU module cùng lúc trong 1 màn — không tự ẩn/hiện được cả tab như các
  // tab con khác (xem renderReportsNavPicker()), nên phải lọc riêng TỪNG khối bên dưới theo đúng module
  // đang bật ở mục 0, tái dùng thẳng hasModuleAccess() — nếu không, người tắt module ở mục 0 (vd không
  // được vào Hợp Đồng) vẫn thấy được số lượng/giá trị Hợp Đồng lộ ra qua tab Tổng Hợp này.
  const canSee = (key) => hasModuleAccess(currentUser, key);

  const docStats = computeApprovalStats(DB.docs, deptFilter, fromDate, toDate);
  const subStats = computeApprovalStats(DB.submissions, deptFilter, fromDate, toDate);
  const carStats = computeApprovalStats(DB.carRegs, deptFilter, fromDate, toDate);
  const offStats = computeApprovalStats(DB.officeReqs, deptFilter, fromDate, toDate);
  const approvalModules = [['doc', 'Tài liệu', docStats], ['submission', 'Văn bản trình', subStats], ['car', 'Đăng ký xe', carStats], ['office', 'Văn phòng', offStats]]
    .filter(([key]) => canSee(key));

  const inScope = (r) => (!deptFilter || r.dept === deptFilter) && isInDateRange(r.createdAt, fromDate, toDate);
  const visibleContracts = DB.contracts.filter(inScope);
  const visibleMeetings = DB.meetings.filter(inScope);
  const visibleMinutes = DB.meetingMinutes.filter(inScope);
  const visibleCars = DB.carRegs.filter(inScope);
  const visibleOffice = DB.officeReqs.filter(inScope);
  const visibleTasks = DB.tasks.filter(t => isInDateRange(t.createdAt, fromDate, toDate));

  // --- Tổng quan ---
  const overviewItems = [
    ['doc', '📂 Tài liệu', docStats.total], ['submission', '📜 Văn bản trình', subStats.total],
    ['car', '🚗 Đăng ký xe', carStats.total], ['office', '🏢 Văn phòng', offStats.total],
    ['contract', '📄 Hợp đồng', visibleContracts.length], ['meeting', '📅 Phòng họp', visibleMeetings.length],
    ['minutes', '📝 Biên bản họp', visibleMinutes.length], ['task', '✅ Công việc', visibleTasks.length]
  ].filter(([key]) => canSee(key));
  const overviewHTML = `
    <div class="bg-white p-4 rounded border">
      <h4 class="font-bold text-gray-800 mb-3">📈 Tổng Quan Số Lượng Hồ Sơ</h4>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        ${overviewItems.map(([, label, val]) => `
          <div class="bg-gray-50 border rounded p-3 text-center">
            <div class="text-2xl font-bold text-sky-700">${val.toLocaleString('vi-VN')}</div>
            <div class="text-xs text-gray-600 mt-1">${label}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // --- Tình trạng phê duyệt ---
  const approvalHTML = approvalModules.length ? `
    <div class="bg-white p-4 rounded border">
      <h4 class="font-bold text-gray-800 mb-3">⏳ Tình Trạng Phê Duyệt Theo Module</h4>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        ${approvalModules.map(([, name, s]) => `
          <div class="border rounded p-3 space-y-2">
            <div class="font-semibold text-gray-700 text-sm mb-1">${escapeHtml(name)} (${s.total})</div>
            ${buildStatBarHTML('Đang chờ duyệt', s.pending, s.total, 'bg-yellow-500')}
            ${buildStatBarHTML('Đã phê duyệt', s.approved, s.total, 'bg-green-500')}
            ${buildStatBarHTML('Bị từ chối', s.rejected, s.total, 'bg-red-500')}
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  // --- Khối lượng theo phòng ban ---
  const deptTotals = {};
  approvalModules.forEach(([, , s]) => {
    Object.entries(s.byDept).forEach(([d, c]) => { deptTotals[d] = (deptTotals[d] || 0) + c; });
  });
  const deptEntries = Object.entries(deptTotals).sort((a, b) => b[1] - a[1]);
  const maxDeptTotal = Math.max(1, ...deptEntries.map(e => e[1]));
  const deptHTML = deptEntries.length ? `
    <div class="bg-white p-4 rounded border">
      <h4 class="font-bold text-gray-800 mb-3">🏢 Khối Lượng Hồ Sơ Theo Phòng Ban</h4>
      <div class="space-y-2">
        ${deptEntries.map(([d, c]) => buildStatBarHTML(d, c, maxDeptTotal, 'bg-sky-500')).join('')}
      </div>
    </div>
  ` : '';

  // --- Tài chính ---
  // So theo NGÀY LỊCH (bỏ giờ/phút), khớp bản vá ở renderContractReportExtra() (tab "Hợp Đồng" riêng)
  // — trước đây tab "Tổng Hợp" này vẫn dùng "now" nguyên giờ/phút thực tế, khiến 1 hợp đồng hết hạn
  // ĐÚNG hôm nay bị 2 tab của cùng module Báo Cáo cho ra 2 kết quả khác nhau (còn hiệu lực/đã hết hạn).
  const rawNow = new Date();
  const now = new Date(rawNow.getFullYear(), rawNow.getMonth(), rawNow.getDate());
  // Chỉ tính giá trị trên hợp đồng ĐÃ DUYỆT — khớp đúng cách officeBySubType lọc APPROVED ngay dưới
  // đây; trước đây visibleContracts (mọi trạng thái: PENDING/APPROVED/REJECTED) được cộng thẳng, thổi
  // phồng "Giá trị Hợp đồng" bằng những hồ sơ chưa từng được duyệt.
  const approvedContracts = visibleContracts.filter(c => c.approvalStatus === 'APPROVED');
  const activeContractValue = approvedContracts.filter(c => new Date(c.endDate) >= now).reduce((sum, c) => sum + (c.amount || 0), 0);
  const expiredContractValue = approvedContracts.filter(c => new Date(c.endDate) < now).reduce((sum, c) => sum + (c.amount || 0), 0);

  // Chỉ cộng dồn đề nghị ĐÃ DUYỆT — trước đây cộng cả PENDING/REJECTED, khiến 1 đề nghị Đầu Tư bị từ
  // chối vẫn cộng vào cột dự toán, trông như đã được duyệt/chi thực tế.
  const officeBySubType = { MUA_BAN: 0, SUA_CHUA: 0 };
  visibleOffice.filter(o => o.status === 'APPROVED').forEach(o => { officeBySubType[o.subType] = (officeBySubType[o.subType] || 0) + (o.amount || 0); });
  const maxOfficeAmount = Math.max(1, ...Object.values(officeBySubType));

  // 2 nửa độc lập (Hợp Đồng / Văn Phòng) — ẩn riêng từng nửa theo đúng module đang bật, đổi lưới về 1
  // cột nếu chỉ còn 1 nửa, ẩn hẳn cả khối nếu tắt cả 2.
  const canSeeContract = canSee('contract'), canSeeOffice = canSee('office');
  const financeContractHTML = canSeeContract ? `
        <div>
          <div class="text-xs font-semibold text-gray-600 mb-2">Giá trị Hợp đồng (${visibleContracts.length} hợp đồng)</div>
          <div class="grid grid-cols-2 gap-2 text-center">
            <div class="bg-green-50 border border-green-200 rounded p-2">
              <div class="font-bold text-green-700">${activeContractValue.toLocaleString('vi-VN')} VNĐ</div>
              <div class="text-[11px] text-gray-500">Còn hiệu lực</div>
            </div>
            <div class="bg-red-50 border border-red-200 rounded p-2">
              <div class="font-bold text-red-700">${expiredContractValue.toLocaleString('vi-VN')} VNĐ</div>
              <div class="text-[11px] text-gray-500">Đã hết hạn</div>
            </div>
          </div>
        </div>
  ` : '';
  const financeOfficeHTML = canSeeOffice ? `
        <div>
          <div class="text-xs font-semibold text-gray-600 mb-2">Dự toán Văn phòng theo phân hệ (VNĐ)</div>
          <div class="space-y-2">
            ${buildStatBarHTML('Mua sắm', officeBySubType.MUA_BAN, maxOfficeAmount, 'bg-teal-500')}
            ${buildStatBarHTML('Sửa chữa', officeBySubType.SUA_CHUA, maxOfficeAmount, 'bg-amber-500')}
          </div>
        </div>
  ` : '';
  const financeHTML = (canSeeContract || canSeeOffice) ? `
    <div class="bg-white p-4 rounded border">
      <h4 class="font-bold text-gray-800 mb-3">💰 Tài Chính</h4>
      <div class="grid grid-cols-1 ${(canSeeContract && canSeeOffice) ? 'md:grid-cols-2' : ''} gap-4">
        ${financeContractHTML}${financeOfficeHTML}
      </div>
    </div>
  ` : '';

  // --- Vận hành ---
  // Chỉ cộng dồn km của chuyến ĐÃ DUYỆT — trước đây cộng cả PENDING/REJECTED, khiến 1 chuyến bị từ
  // chối vẫn tính vào "Tổng số km đăng ký xe" dù chuyến đó không thực sự diễn ra.
  const approvedCars = visibleCars.filter(c => c.status === 'APPROVED');
  const totalKm = approvedCars.reduce((sum, c) => sum + (c.km || 0), 0);
  const meetingApproved = visibleMeetings.filter(m => m.status === 'APPROVED').length;
  const meetingPending = visibleMeetings.filter(m => m.status === 'PENDING').length;
  const meetingCancelled = visibleMeetings.filter(m => m.status === 'CANCELLED').length;

  const canSeeCar = canSee('car'), canSeeMeeting = canSee('meeting');
  const opsCarHTML = canSeeCar ? `
        <div class="bg-gray-50 border rounded p-3 text-center">
          <div class="text-2xl font-bold text-indigo-700">${totalKm.toLocaleString('vi-VN')} km</div>
          <div class="text-xs text-gray-600 mt-1">Tổng số km đăng ký xe (${approvedCars.length} chuyến đã duyệt)</div>
        </div>
  ` : '';
  const opsMeetingHTML = canSeeMeeting ? `
        <div class="space-y-2">
          <div class="text-xs font-semibold text-gray-600 mb-1">Lịch phòng họp (${visibleMeetings.length})</div>
          ${buildStatBarHTML('Đã duyệt', meetingApproved, visibleMeetings.length, 'bg-green-500')}
          ${buildStatBarHTML('Đang chờ', meetingPending, visibleMeetings.length, 'bg-yellow-500')}
          ${buildStatBarHTML('Đã huỷ', meetingCancelled, visibleMeetings.length, 'bg-red-500')}
        </div>
  ` : '';
  const operationsHTML = (canSeeCar || canSeeMeeting) ? `
    <div class="bg-white p-4 rounded border">
      <h4 class="font-bold text-gray-800 mb-3">🚗 Vận Hành</h4>
      <div class="grid grid-cols-1 ${(canSeeCar && canSeeMeeting) ? 'md:grid-cols-2' : ''} gap-4">
        ${opsCarHTML}${opsMeetingHTML}
      </div>
    </div>
  ` : '';

  // --- Hiệu suất xử lý --- (đã lọc sẵn theo approvalModules ở trên, tự động khớp module đang bật)
  const perfHTML = approvalModules.length ? `
    <div class="bg-white p-4 rounded border">
      <h4 class="font-bold text-gray-800 mb-3">⚡ Hiệu Suất Xử Lý (trung bình)</h4>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse border text-xs">
          <thead><tr class="bg-gray-100"><th class="border p-2 text-left">Module</th><th class="border p-2">Thời gian / bước duyệt</th><th class="border p-2">Thời gian hoàn tất hồ sơ</th></tr></thead>
          <tbody>
            ${approvalModules.map(([, name, s]) => `
              <tr><td class="border p-2 font-semibold">${escapeHtml(name)}</td><td class="border p-2 text-center">${formatHoursLabel(s.avgStepHours)}</td><td class="border p-2 text-center">${formatHoursLabel(s.avgCompletionHours)}</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  ` : '';

  // --- Công việc & chỉ đạo --- (cả khối gắn liền module "task" — ẩn hẳn nếu tắt module Công Việc)
  const taskByStatus = { TODO: 0, DOING: 0, DONE: 0, CANCELLED: 0 };
  const taskBySource = { SUBMISSION: 0, MEETING_MINUTES: 0, MANUAL: 0 };
  let overdueTasks = 0;
  const todayStr = new Date().toISOString().slice(0, 10);
  visibleTasks.forEach(t => {
    taskByStatus[t.status] = (taskByStatus[t.status] || 0) + 1;
    taskBySource[t.sourceType] = (taskBySource[t.sourceType] || 0) + 1;
    if (t.deadline && t.deadline < todayStr && t.status !== 'DONE' && t.status !== 'CANCELLED') overdueTasks++;
  });

  const tasksHTML = canSee('task') ? `
    <div class="bg-white p-4 rounded border">
      <h4 class="font-bold text-gray-800 mb-3">✅ Công Việc & Chỉ Đạo</h4>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="space-y-2">
          <div class="text-xs font-semibold text-gray-600 mb-1">Theo trạng thái (${visibleTasks.length} công việc, <span class="text-red-600 font-bold">${overdueTasks} quá hạn</span>)</div>
          ${buildStatBarHTML('Chưa bắt đầu', taskByStatus.TODO, visibleTasks.length, 'bg-gray-500')}
          ${buildStatBarHTML('Đang thực hiện', taskByStatus.DOING, visibleTasks.length, 'bg-blue-500')}
          ${buildStatBarHTML('Hoàn thành', taskByStatus.DONE, visibleTasks.length, 'bg-green-500')}
          ${buildStatBarHTML('Đã huỷ', taskByStatus.CANCELLED, visibleTasks.length, 'bg-red-500')}
        </div>
        <div class="space-y-2">
          <div class="text-xs font-semibold text-gray-600 mb-1">Theo nguồn gốc</div>
          ${buildStatBarHTML('Văn bản trình', taskBySource.SUBMISSION, visibleTasks.length, 'bg-violet-500')}
          ${buildStatBarHTML('Biên bản họp', taskBySource.MEETING_MINUTES, visibleTasks.length, 'bg-rose-500')}
          ${buildStatBarHTML('Giao trực tiếp', taskBySource.MANUAL, visibleTasks.length, 'bg-slate-500')}
        </div>
      </div>
    </div>
  ` : '';

  container.innerHTML = overviewHTML + approvalHTML + deptHTML + financeHTML + operationsHTML + perfHTML + tasksHTML;
}

// Nút "Xuất Báo Cáo Excel" dùng chung cho mọi tab — Tổng Hợp xuất đủ mọi chỉ số như trước
// (exportReportsSummaryExcel giữ nguyên logic cũ), các tab module xuất đúng phạm vi module đó
// (exportModuleReportExcel(), xem REPORT_MODULE_CONFIGS phía trên).
function exportReportsExcel() {
  const leafKey = getActiveReportLeafKey();
  if (leafKey && leafKey !== 'SUMMARY') { exportModuleReportExcel(leafKey); return; }
  exportReportsSummaryExcel();
}

function exportReportsSummaryExcel() {
  const fromDate = document.getElementById('reportsFromDate')?.value || '';
  const toDate = document.getElementById('reportsToDate')?.value || '';
  const deptFilter = document.getElementById('reportsDeptFilter')?.value || '';

  const docStats = computeApprovalStats(DB.docs, deptFilter, fromDate, toDate);
  const subStats = computeApprovalStats(DB.submissions, deptFilter, fromDate, toDate);
  const carStats = computeApprovalStats(DB.carRegs, deptFilter, fromDate, toDate);
  const offStats = computeApprovalStats(DB.officeReqs, deptFilter, fromDate, toDate);

  const inScope = (r) => (!deptFilter || r.dept === deptFilter) && isInDateRange(r.createdAt, fromDate, toDate);
  const visibleContracts = DB.contracts.filter(inScope);
  const visibleCars = DB.carRegs.filter(inScope);
  const visibleOffice = DB.officeReqs.filter(inScope);
  // Khớp đúng 2 bản vá đã áp cho renderReportsSummary() (phần hiển thị màn hình cùng số liệu này) —
  // trước đây hàm xuất Excel không lọc APPROVED (cộng cả PENDING/REJECTED, thổi phồng "Giá trị Hợp
  // đồng còn hiệu lực") và so ngày nguyên giờ/phút thực tế thay vì theo ngày lịch.
  const approvedContracts = visibleContracts.filter(c => c.approvalStatus === 'APPROVED');
  const rawNow = new Date();
  const now = new Date(rawNow.getFullYear(), rawNow.getMonth(), rawNow.getDate());
  const activeContractValue = approvedContracts.filter(c => new Date(c.endDate) >= now).reduce((sum, c) => sum + (c.amount || 0), 0);
  // Trước đây file xuất chỉ có "Giá trị Hợp đồng còn hiệu lực" — thiếu hẳn "Đã hết hạn", dự toán Văn
  // phòng theo 3 phân hệ, và tổng km đăng ký xe dù màn hình renderReportsSummary() cùng tab đã hiển
  // thị đủ 5 chỉ số này — người xuất báo cáo nhận file thiếu số liệu so với những gì vừa xem trên màn hình.
  const expiredContractValue = approvedContracts.filter(c => new Date(c.endDate) < now).reduce((sum, c) => sum + (c.amount || 0), 0);
  const officeBySubType = { MUA_BAN: 0, SUA_CHUA: 0 };
  visibleOffice.filter(o => o.status === 'APPROVED').forEach(o => { officeBySubType[o.subType] = (officeBySubType[o.subType] || 0) + (o.amount || 0); });
  const totalKm = visibleCars.filter(c => c.status === 'APPROVED').reduce((sum, c) => sum + (c.km || 0), 0);

  // Khớp đúng bản vá module-access ở renderReportsSummary() (cùng số liệu, cùng màn hình) — mỗi nhóm
  // dòng chỉ xuất nếu module tương ứng đang bật ở mục 0, không thì file Excel lộ số liệu màn hình đã ẩn.
  const canSee = (key) => hasModuleAccess(currentUser, key);
  const rows = [
    ...(canSee('doc') ? [['Tổng Tài liệu', docStats.total], ['Tài liệu - Đang chờ', docStats.pending], ['Tài liệu - Đã duyệt', docStats.approved], ['Tài liệu - Từ chối', docStats.rejected]] : []),
    ...(canSee('submission') ? [['Tổng Văn bản trình', subStats.total], ['Văn bản trình - Đang chờ', subStats.pending], ['Văn bản trình - Đã duyệt', subStats.approved], ['Văn bản trình - Từ chối', subStats.rejected]] : []),
    ...(canSee('car') ? [['Tổng Đăng ký xe', carStats.total], ['Đăng ký xe - Đang chờ', carStats.pending], ['Đăng ký xe - Đã duyệt', carStats.approved], ['Đăng ký xe - Từ chối', carStats.rejected]] : []),
    ...(canSee('office') ? [['Tổng Văn phòng', offStats.total], ['Văn phòng - Đang chờ', offStats.pending], ['Văn phòng - Đã duyệt', offStats.approved], ['Văn phòng - Từ chối', offStats.rejected]] : []),
    ...(canSee('contract') ? [['Tổng Hợp đồng', visibleContracts.length], ['Giá trị Hợp đồng còn hiệu lực (VNĐ)', activeContractValue], ['Giá trị Hợp đồng đã hết hạn (VNĐ)', expiredContractValue]] : []),
    ...(canSee('office') ? [['Dự toán Văn phòng - Mua sắm (VNĐ)', officeBySubType.MUA_BAN], ['Dự toán Văn phòng - Sửa chữa (VNĐ)', officeBySubType.SUA_CHUA]] : []),
    ...(canSee('car') ? [['Tổng số km đăng ký xe (đã duyệt)', totalKm]] : [])
  ];

  const columns = [
    { header: 'Chỉ số', key: 'label', width: 40 },
    { header: 'Giá trị', key: 'value', width: 20 }
  ];
  const dataRows = rows.map(([label, value]) => ({ label, value }));
  downloadXlsxFromServer(`BaoCaoQuanTri_${new Date().toISOString().slice(0, 10)}.xlsx`, 'Báo Cáo Quản Trị', columns, dataRows);
}

