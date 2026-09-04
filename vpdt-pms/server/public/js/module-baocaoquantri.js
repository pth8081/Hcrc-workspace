// ==========================================
// MODULE BÁO CÁO QUẢN TRỊ (REPORTS MODULE)
// ==========================================

// Parse ngược chuỗi "HH:MM:SS D/M/YYYY" do new Date().toLocaleString('vi-VN') sinh ra (định dạng cố
// định của locale này) — cần thiết vì Date() không tự parse lại được chuỗi theo locale vi-VN.
function parseVNDateTime(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split(' ');
  if (parts.length !== 2) return null;
  const [timePart, datePart] = parts;
  const timeBits = timePart.split(':').map(Number);
  const dateBits = datePart.split('/').map(Number);
  if (dateBits.length !== 3 || dateBits.some(isNaN)) return null;
  const [h, mi, s] = timeBits;
  const [d, mo, y] = dateBits;
  const dt = new Date(y, mo - 1, d, h || 0, mi || 0, s || 0);
  return isNaN(dt.getTime()) ? null : dt;
}

function formatHoursLabel(h) {
  if (h === null || h === undefined) return 'Chưa có dữ liệu';
  if (h < 24) return `${h.toFixed(1)} giờ`;
  return `${(h / 24).toFixed(1)} ngày`;
}

// Thanh tỷ lệ ngang dùng chung cho mọi báo cáo — không cần thêm thư viện biểu đồ ngoài, giữ trang nhẹ.
function buildStatBarHTML(label, value, max, colorClass) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return `
    <div>
      <div class="flex justify-between mb-0.5 text-xs"><span class="font-semibold text-gray-700">${escapeHtml(label)}</span><span class="font-bold text-gray-800">${(value || 0).toLocaleString('vi-VN')}</span></div>
      <div class="w-full bg-gray-100 rounded h-2.5 overflow-hidden"><div class="${colorClass} h-2.5 rounded" style="width:${pct}%"></div></div>
    </div>
  `;
}

// Thống kê dùng chung cho 4 module có luồng phê duyệt nhiều bước (Tài liệu/Văn bản trình/Xe/Văn
// phòng) — đều có chung cấu trúc {status, dept, createdAt, history[]}. Trả về số lượng theo trạng
// thái/phòng ban + thời gian xử lý trung bình mỗi bước và mỗi hồ sơ hoàn tất (tính từ history[]).
function computeApprovalStats(records, deptFilter, fromDate, toDate) {
  const filtered = records.filter(r =>
    (!deptFilter || r.dept === deptFilter) && isInDateRange(r.createdAt, fromDate, toDate)
  );

  const stats = { total: filtered.length, pending: 0, approved: 0, rejected: 0, byDept: {} };
  const stepDurationsHours = [];
  const completionDurationsHours = [];

  filtered.forEach(r => {
    if (r.status === 'PENDING') stats.pending++;
    else if (r.status === 'APPROVED') stats.approved++;
    else if (r.status === 'REJECTED') stats.rejected++;

    stats.byDept[r.dept] = (stats.byDept[r.dept] || 0) + 1;

    const created = parseVNDateTime(r.createdAt);
    let prevTime = created;
    (r.history || []).forEach(h => {
      if (h.action !== 'APPROVED' && h.action !== 'REJECTED') return;
      const t = parseVNDateTime(h.time);
      if (prevTime && t && t >= prevTime) stepDurationsHours.push((t - prevTime) / 3600000);
      prevTime = t || prevTime;
    });

    if ((r.status === 'APPROVED' || r.status === 'REJECTED') && created) {
      const finalEntry = [...(r.history || [])].reverse().find(h => h.action === 'APPROVED' || h.action === 'REJECTED');
      const finalTime = finalEntry ? parseVNDateTime(finalEntry.time) : null;
      if (finalTime && finalTime >= created) completionDurationsHours.push((finalTime - created) / 3600000);
    }
  });

  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
  stats.avgStepHours = avg(stepDurationsHours);
  stats.avgCompletionHours = avg(completionDurationsHours);
  return stats;
}

function resetReportsFilters() {
  document.getElementById('reportsFromDate').value = '';
  document.getElementById('reportsToDate').value = '';
  document.getElementById('reportsDeptFilter').value = '';
  renderReports();
}

// Báo Cáo — 1 module ngoài duy nhất, bên trong đào dần theo đúng cấu trúc thật của BUSINESS_MODULES:
// chọn "Tổng Hợp" (đa chiều, xếp đầu) hoặc 1 module lớn → module lớn nào có "children" (module con
// thật, vd Hành Chính/Tổng Hợp) thì hiện thêm 1 hàng chọn cấp 2 để vào đúng màn báo cáo module con đó.
// Module không có children vào thẳng màn báo cáo, không qua bước thừa (khớp yêu cầu: module 1 màn thì
// không cần "chọn tab" giả). Đợt này đào tới đúng cấp "module con" — CHƯA đào tiếp xuống từng tab/sub-
// tab bên trong 1 module con (vd Đồng Phục Kỳ Cấp Phát/Điều Chuyển Kho vẫn gộp 1 báo cáo như cũ) vì cần
// kiểm chứng thêm field dữ liệu riêng từng tab trước khi tách an toàn — làm tiếp ở đợt sau nếu cần.
let reportsNavL1 = 'SUMMARY';
let reportsNavL2 = null;
const REPORT_NAV_TREE = [
  { key: 'SUMMARY', label: '📊 Tổng Hợp' },
  { key: 'doc', label: '📂 Tài Liệu' },
  { key: 'submission', label: '📜 Văn Bản Trình' },
  { key: 'task', label: '✅ Công Việc' },
  { key: 'contract', label: '📄 Hợp Đồng' },
  { key: 'minutes', label: '📝 Biên Bản Họp' },
  { key: 'itSupport', label: '🖥️ Hỗ Trợ IT' },
  { key: 'periodicReport', label: '📅 Báo Cáo Định Kỳ' },
  { key: 'internal', label: '📣 Truyền Thông Nội Bộ' },
  {
    key: 'hanhchinh', label: '🏢 Hành Chính', children: [
      { key: 'meeting', label: '📅 Phòng Họp' },
      { key: 'car', label: '🚗 Đăng Ký Xe' },
      { key: 'vpp', label: '🖇️ Văn Phòng Phẩm' },
      { key: 'uniform', label: '👕 Đồng Phục' },
      { key: 'license', label: '🪪 Giấy Phép' }
    ]
  },
  {
    key: 'office', label: '🛒 Tổng Hợp', children: [
      { key: 'office', label: '🛒 Mua Bán/Sửa Chữa' },
      { key: 'payment', label: '💰 Thanh Toán' },
      { key: 'budget', label: '📊 Ngân Sách' }
    ]
  }
];

// Node cấp 1 hiện được nếu là "Tổng Hợp", hoặc còn quyền vào module đó, hoặc (với node có children)
// còn ÍT NHẤT 1 module con bên trong còn quyền — ẩn hẳn node cha nếu tắt sạch mọi module con của nó.
function isReportNavNodeVisible(node) {
  if (node.key === 'SUMMARY') return true;
  if (node.children) return node.children.some(c => hasModuleAccess(currentUser, c.key));
  return hasModuleAccess(currentUser, node.key);
}

function findReportNavNode(key) {
  return REPORT_NAV_TREE.find(n => n.key === key);
}

// Trả về key module đang thật sự hiển thị báo cáo — node cấp 1 có children thì LUÔN cần node cấp 2
// (không có báo cáo riêng cho chính node cha, khớp BUSINESS_MODULES "hanhchinh"/"office" vốn không có
// màn hình riêng, chỉ là điểm gộp nav).
function getActiveReportLeafKey() {
  const node = findReportNavNode(reportsNavL1);
  if (node && node.children) return reportsNavL2;
  return reportsNavL1;
}

function renderReportsNavPicker() {
  const l1Bar = document.getElementById('reportsNavL1Bar');
  const l2Wrap = document.getElementById('reportsNavL2Wrap');
  const l2Bar = document.getElementById('reportsNavL2Bar');
  if (!l1Bar || !l2Wrap || !l2Bar) return;

  l1Bar.innerHTML = REPORT_NAV_TREE.filter(isReportNavNodeVisible).map(n => {
    const cls = n.key === reportsNavL1
      ? 'px-3 py-1.5 rounded text-xs font-bold bg-sky-700 text-white'
      : 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
    return `<button type="button" data-op="selectReportsNavL1" data-arg0="${n.key}" class="${cls}">${n.label}</button>`;
  }).join('');

  const activeNode = findReportNavNode(reportsNavL1);
  if (activeNode && activeNode.children) {
    l2Wrap.classList.remove('hidden');
    l2Bar.innerHTML = activeNode.children.filter(c => hasModuleAccess(currentUser, c.key)).map(c => {
      const cls = c.key === reportsNavL2
        ? 'px-3 py-1 rounded text-xs font-bold bg-indigo-600 text-white'
        : 'px-3 py-1 rounded text-xs font-bold bg-gray-100 text-gray-700';
      return `<button type="button" data-op="selectReportsNavL2" data-arg0="${c.key}" class="${cls}">${c.label}</button>`;
    }).join('');
  } else {
    l2Wrap.classList.add('hidden');
    l2Bar.innerHTML = '';
  }
}

function selectReportsNavL1(key) {
  window.scrollTo({ top: 0, behavior: 'auto' }); // Tránh "bay xuống cuối" khi đổi lựa chọn — xem setSystemSubTab().
  reportsNavL1 = key;
  const node = findReportNavNode(key);
  // Vào 1 module có children luôn cần chọn sẵn 1 module con để có báo cáo để xem ngay (không bắt
  // người dùng phải tự bấm thêm 1 lần nữa mới thấy nội dung) — ưu tiên module con đầu tiên còn quyền.
  reportsNavL2 = (node && node.children) ? (node.children.find(c => hasModuleAccess(currentUser, c.key))?.key || null) : null;
  repopulateReportsDeptFilterOptions(getActiveReportLeafKey());
  renderReports();
}

function selectReportsNavL2(key) {
  window.scrollTo({ top: 0, behavior: 'auto' });
  reportsNavL2 = key;
  repopulateReportsDeptFilterOptions(getActiveReportLeafKey());
  renderReports();
}

// #reportsDeptFilter mặc định liệt kê DB.depts (khối văn phòng, xem populateDropdowns() ~dòng 10345) —
// module Đồng Phục dùng "dept" = TÊN SIÊU THỊ (DB.stores, TÁCH RIÊNG khỏi DB.depts, xem
// lib/createValidation.js uniformPeriods), nên đổi sang danh mục Siêu Thị khi mở tab báo cáo này (và
// đổi LẠI DB.depts khi rời tab, không ảnh hưởng các module khác) — nếu không, dropdown không có lựa
// chọn nào khớp được uniformIssuances.dept nên bộ lọc "theo siêu thị" coi như không dùng được dù
// getRecords()/renderUniformReportExtra() bên dưới đã sẵn sàng lọc đúng theo giá trị chọn.
function repopulateReportsDeptFilterOptions(key) {
  const el = document.getElementById('reportsDeptFilter');
  if (!el) return;
  const prevValue = el.value;
  const source = key === 'uniform' ? (DB.stores || []) : (DB.depts || []);
  const label = key === 'uniform' ? '-- Tất cả siêu thị --' : '-- Tất cả phòng ban --';
  el.innerHTML = `<option value="">${label}</option>` + source.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  if (source.includes(prevValue)) el.value = prevValue; // giữ lựa chọn cũ nếu còn hợp lệ ở danh mục mới
}

function renderReports() {
  const container = document.getElementById('reportsContent');
  if (!container) return;
  renderReportsNavPicker();
  const leafKey = getActiveReportLeafKey();
  if (!leafKey || leafKey === 'SUMMARY') { renderReportsSummary(container); return; }
  renderModuleReport(leafKey, container);
}

// Thống kê dùng chung cho mọi tab module con (trừ "Tổng Hợp") — tổng số hồ sơ trong khoảng lọc, tình
// trạng phê duyệt (nếu module có statusOf) và khối lượng theo phòng ban (trừ khi deptBreakdown:false —
// dùng cho các module không có field dept đáng tin, vd Công Việc/Truyền Thông Nội Bộ).
const REPORT_MODULE_CONFIGS = {
  doc: {
    title: '📂 Báo Cáo Tài Liệu',
    getRecords: (dept, from, to) => DB.docs.filter(r => (!dept || r.dept === dept) && isInDateRange(r.createdAt, from, to))
    , statusOf: r => r.status
  },
  submission: {
    title: '📜 Báo Cáo Văn Bản Trình',
    getRecords: (dept, from, to) => DB.submissions.filter(r => (!dept || r.dept === dept) && isInDateRange(r.createdAt, from, to)),
    statusOf: r => r.status
  },
  car: {
    title: '🚗 Báo Cáo Đăng Ký Xe',
    getRecords: (dept, from, to) => DB.carRegs.filter(r => (!dept || r.dept === dept) && isInDateRange(r.createdAt, from, to)),
    statusOf: r => r.status
  },
  office: {
    title: '🛒 Báo Cáo Văn Phòng Tổng Hợp',
    getRecords: (dept, from, to) => DB.officeReqs.filter(r => (!dept || r.dept === dept) && isInDateRange(r.createdAt, from, to)),
    statusOf: r => r.status,
    renderExtra: renderOfficeReportExtra,
    extraRows: records => {
      const bySubType = { MUA_BAN: 0, SUA_CHUA: 0 };
      records.filter(o => o.status === 'APPROVED').forEach(o => { bySubType[o.subType] = (bySubType[o.subType] || 0) + (o.amount || 0); });
      return [['Dự toán Mua sắm (VNĐ)', bySubType.MUA_BAN], ['Dự toán Sửa chữa (VNĐ)', bySubType.SUA_CHUA]];
    }
  },
  contract: {
    title: '📄 Báo Cáo Hợp Đồng',
    getRecords: (dept, from, to) => DB.contracts.filter(r => (!dept || r.dept === dept) && isInDateRange(r.createdAt, from, to)),
    statusOf: r => r.approvalStatus,
    renderExtra: renderContractReportExtra,
    extraRows: records => {
      const approved = records.filter(c => c.approvalStatus === 'APPROVED');
      const rawNow = new Date();
      const now = new Date(rawNow.getFullYear(), rawNow.getMonth(), rawNow.getDate());
      const activeValue = approved.filter(c => new Date(c.endDate) >= now).reduce((s, c) => s + (c.amount || 0), 0);
      const expiredValue = approved.filter(c => new Date(c.endDate) < now).reduce((s, c) => s + (c.amount || 0), 0);
      return [['Giá trị Hợp đồng còn hiệu lực (VNĐ)', activeValue], ['Giá trị Hợp đồng đã hết hạn (VNĐ)', expiredValue]];
    }
  },
  minutes: {
    title: '📝 Báo Cáo Biên Bản Họp',
    getRecords: (dept, from, to) => DB.meetingMinutes.filter(r => (!dept || r.dept === dept) && isInDateRange(r.createdAt, from, to))
  },
  meeting: {
    title: '🏢 Báo Cáo Phòng Họp',
    getRecords: (dept, from, to) => DB.meetings.filter(r => (!dept || r.dept === dept) && isInDateRange(r.createdAt, from, to)),
    statusOf: r => r.status,
    statusBuckets: [['PENDING', 'Đang chờ', 'bg-yellow-500'], ['APPROVED', 'Đã duyệt', 'bg-green-500'], ['CANCELLED', 'Đã huỷ', 'bg-red-500']]
  },
  vpp: {
    title: '🖇️ Báo Cáo Văn Phòng Phẩm',
    getRecords: (dept, from, to) => DB.vppRegistrations.filter(r => (!dept || r.dept === dept) && isInDateRange(r.createdAt, from, to)),
    statusOf: r => r.status,
    statusBuckets: [['NHAP', 'Nháp', 'bg-gray-400'], ['PENDING', 'Đang chờ', 'bg-yellow-500'], ['APPROVED', 'Đã duyệt', 'bg-green-500'], ['REJECTED', 'Từ chối', 'bg-red-500']]
  },
  internal: {
    title: '📣 Báo Cáo Truyền Thông Nội Bộ',
    // Kênh toàn công ty, không lọc theo phòng ban (khớp hành vi Góc chia sẻ hiện tại — ai cũng xem được).
    // Loại bài PENDING/REJECTED (chỉ xảy ra ở Góc chia sẻ, xem canViewInternalPost() ở lib/recordViewScope.js)
    // — chưa từng công khai thật sự, tính vào báo cáo sẽ thổi phồng số liệu hoạt động.
    getRecords: (dept, from, to) => DB.internalPosts.filter(r => r.status !== 'PENDING' && r.status !== 'REJECTED' && isInDateRange(r.createdAt, from, to)),
    deptBreakdown: false,
    renderExtra: renderInternalReportExtra
  },
  uniform: {
    title: '👕 Báo Cáo Đồng Phục',
    // uniformIssuances (cấp cho nhân viên) là bản ghi phẳng duy nhất khớp khuôn getRecords()/dept/
    // createdAt chung — kỳ cấp phát (uniformPeriods) chứa allocations[] lồng nhau nên không đưa vào
    // records chính, thay vào đó renderUniformReportExtra() bên dưới tự tính thêm số liệu phân bổ/tồn
    // kho (dùng chung logic computeUniformStockClient() ở phần module Đồng Phục phía trên).
    getRecords: (dept, from, to) => DB.uniformIssuances.filter(r => (!dept || r.dept === dept) && isInDateRange(r.createdAt, from, to)),
    renderExtra: renderUniformReportExtra,
    extraRows: records => {
      const totalIssuedQty = records.reduce((sum, r) => sum + (r.items || []).reduce((s, it) => s + (it.qty || 0), 0), 0);
      return [['Tổng SL đã cấp cho nhân viên (trong khoảng lọc)', totalIssuedQty]];
    }
  },
  task: {
    title: '✅ Báo Cáo Công Việc',
    // Công việc không có field phòng ban đáng tin (giao theo người, không theo phòng ban) — không lọc/không xếp theo phòng ban, khớp renderReportsSummary() hiện tại.
    getRecords: (dept, from, to) => DB.tasks.filter(t => isInDateRange(t.createdAt, from, to)),
    deptBreakdown: false,
    statusOf: t => t.status,
    statusBuckets: [['TODO', 'Chưa bắt đầu', 'bg-gray-500'], ['DOING', 'Đang thực hiện', 'bg-blue-500'], ['DONE', 'Hoàn thành', 'bg-green-500'], ['CANCELLED', 'Đã huỷ', 'bg-red-500']],
    renderExtra: renderTaskReportExtra
  },
  // 5 module dưới đây (license/payment/budget/itSupport/periodicReport) TRƯỚC ĐỢT NÀY chưa hề có báo
  // cáo nào cả — bổ sung theo đúng khuôn getRecords(dept,from,to) chung, mỗi cái ở đúng 1 cấp (module
  // con thật, không tách sâu thêm xuống từng tab con bên trong — vd Đồng Phục Kỳ Cấp Phát/Điều Chuyển
  // Kho vẫn gộp qua "uniform" như cũ) để tránh đoán sai tên field khi chưa kiểm chứng kỹ từng tab con.
  license: {
    title: '🪪 Báo Cáo Giấy Phép',
    // rootLicenseId == null: chỉ tính hồ sơ GỐC, không tính từng bản gia hạn/sửa đổi con (khớp cách
    // renderLicenseDashboard() đếm "Tổng" — xem getLicenseFamilyLatest()).
    getRecords: (dept, from, to) => DB.licenses.filter(r => r.rootLicenseId == null && (!dept || r.dept === dept) && isInDateRange(r.createdAt, from, to)),
    statusOf: r => r.status
  },
  payment: {
    title: '💰 Báo Cáo Thanh Toán',
    getRecords: (dept, from, to) => DB.paymentRequests.filter(r => (!dept || r.dept === dept) && isInDateRange(r.createdAt, from, to)),
    statusOf: r => r.status,
    statusBuckets: [['PENDING', 'Đang chờ duyệt', 'bg-yellow-500'], ['NEED_INFO', 'Chờ bổ sung', 'bg-orange-500'], ['APPROVED', 'Đã duyệt', 'bg-cyan-500'], ['PAID', 'Đã thanh toán', 'bg-green-500'], ['REJECTED', 'Từ chối', 'bg-red-500']]
  },
  budget: {
    title: '📊 Báo Cáo Ngân Sách',
    getRecords: (dept, from, to) => DB.budgetPeriods.filter(r => (!dept || r.dept === dept) && isInDateRange(r.createdAt, from, to))
  },
  itSupport: {
    title: '🖥️ Báo Cáo Hỗ Trợ IT',
    getRecords: (dept, from, to) => DB.itSupportTickets.filter(r => (!dept || r.dept === dept) && isInDateRange(r.createdAt, from, to)),
    statusOf: r => r.status,
    statusBuckets: [['TODO', 'Chưa xử lý', 'bg-gray-500'], ['DOING', 'Đang xử lý', 'bg-blue-500'], ['DONE', 'Hoàn thành', 'bg-green-500'], ['CANCELLED', 'Đã huỷ', 'bg-red-500']]
  },
  periodicReport: {
    title: '📅 Báo Cáo Định Kỳ (Kỳ Báo Cáo)',
    getRecords: (dept, from, to) => DB.reportPeriods.filter(r => (!dept || r.dept === dept) && isInDateRange(r.createdAt, from, to))
  }
};

function renderModuleReport(moduleKey, container) {
  const config = REPORT_MODULE_CONFIGS[moduleKey];
  if (!config) { container.innerHTML = ''; return; }
  const fromDate = document.getElementById('reportsFromDate')?.value || '';
  const toDate = document.getElementById('reportsToDate')?.value || '';
  const deptFilter = document.getElementById('reportsDeptFilter')?.value || '';
  const records = config.getRecords(deptFilter, fromDate, toDate);

  const totalHTML = `
    <div class="bg-white p-4 rounded border">
      <div class="text-2xl font-bold text-sky-700">${records.length.toLocaleString('vi-VN')}</div>
      <div class="text-xs text-gray-600 mt-1">Tổng số hồ sơ trong khoảng đã chọn</div>
    </div>
  `;

  let statusHTML = '';
  if (config.statusOf) {
    const buckets = config.statusBuckets || [['PENDING', 'Đang chờ duyệt', 'bg-yellow-500'], ['APPROVED', 'Đã phê duyệt', 'bg-green-500'], ['REJECTED', 'Bị từ chối', 'bg-red-500']];
    const counts = {};
    buckets.forEach(([key]) => { counts[key] = 0; });
    records.forEach(r => { const s = config.statusOf(r); if (s in counts) counts[s]++; });
    statusHTML = `
      <div class="bg-white p-4 rounded border">
        <h4 class="font-bold text-gray-800 mb-3">⏳ Tình Trạng</h4>
        <div class="space-y-2">${buckets.map(([key, label, color]) => buildStatBarHTML(label, counts[key], records.length, color)).join('')}</div>
      </div>
    `;
  }

  let deptHTML = '';
  if (config.deptBreakdown !== false) {
    const deptTotals = {};
    records.forEach(r => { if (r.dept) deptTotals[r.dept] = (deptTotals[r.dept] || 0) + 1; });
    const deptEntries = Object.entries(deptTotals).sort((a, b) => b[1] - a[1]);
    if (deptEntries.length) {
      const maxDept = Math.max(1, ...deptEntries.map(e => e[1]));
      deptHTML = `
        <div class="bg-white p-4 rounded border">
          <h4 class="font-bold text-gray-800 mb-3">🏢 Khối Lượng Theo Phòng Ban</h4>
          <div class="space-y-2">${deptEntries.map(([d, c]) => buildStatBarHTML(d, c, maxDept, 'bg-sky-500')).join('')}</div>
        </div>
      `;
    }
  }

  const extraHTML = config.renderExtra ? config.renderExtra(records) : '';
  // detailHTML PHẢI render trước previewLauncherHTML — renderReportDetailSection() là nơi gán
  // reportDetailContext/reportDetailSelectedCols[moduleKey] mà buildReportPreviewLauncherHTML() (qua
  // nút "Xem Trước") sẽ đọc lại khi bấm; thứ tự HIỂN THỊ trên trang (Mục 1 trước Mục 2, xem dưới) không
  // liên quan gì tới thứ tự GỌI HÀM ở đây.
  const detailHTML = renderReportDetailSection(moduleKey, records, config);
  const previewLauncherHTML = buildReportPreviewLauncherHTML(moduleKey);

  container.innerHTML = `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      ${totalHTML}
      ${statusHTML}
      ${deptHTML}
    </div>
    ${extraHTML}
    ${previewLauncherHTML}
    ${detailHTML}
  `;
}

// ==========================================
// TRA CỨU CHI TIẾT — lọc đa chiều theo TỪNG TRƯỜNG/trạng thái thực tế có trong dữ liệu module (không
// hardcode danh sách trường cho từng module, tự suy ra từ chính bản ghi trong `records` đã được
// getRecords() lọc theo ngày/phòng ban ở trên) + tự chọn cột hiển thị/xuất Excel. Đặt NGAY DƯỚI khối
// thống kê (tổng số/tình trạng/theo phòng ban), KHÔNG thay thế — chỉ bổ sung khả năng xem/lọc từng hồ
// sơ đơn lẻ thay vì chỉ số tổng hợp.
// Kiến trúc: renderReportDetailSection() vẽ TOÀN BỘ khối (bộ lọc + bảng chọn cột + bảng kết quả) khi
// đổi tab/đổi bộ lọc trên cùng (ngày/phòng ban) — lúc đó rebuild input cũng không sao vì người dùng vừa
// thao tác 1 control khác (mất focus ô lọc chi tiết không đáng kể). Khi gõ/chọn NGAY TRONG bộ lọc chi
// tiết, chỉ gọi renderReportDetailResultsOnly() để thay mỗi phần bảng kết quả (#reportDetailResultsWrap),
// giữ nguyên các input lọc để không mất focus/con trỏ đang gõ dở (theo đúng khuôn renderApprovalHub()
// đọc input.value trực tiếp thay vì render lại input đó).
let reportDetailContext = { moduleKey: null, records: [], columns: [], config: null };
const reportDetailFilterValues = {}; // moduleKey -> { [colKey]: string | {min,max} | {from,to} }
const reportDetailSelectedCols = {}; // moduleKey -> string[] (thứ tự cột đang hiển thị/xuất)

// Nhãn tiếng Việt cho các trường thường gặp ở nhiều module — trường lạ không có trong danh sách này sẽ
// tự tách theo chữ hoa (humanizeReportFieldKey) thay vì làm hỏng cả bảng.
const REPORT_FIELD_LABELS = {
  code: 'Mã hồ sơ', title: 'Tiêu đề', name: 'Tên', dept: 'Phòng ban', __status: 'Trạng thái',
  status: 'Trạng thái', approvalStatus: 'Trạng thái duyệt', paymentStatus: 'Trạng thái thanh toán',
  subType: 'Phân hệ', type: 'Loại', amount: 'Số tiền', createdAt: 'Ngày tạo', createdBy: 'Người tạo',
  startDate: 'Ngày bắt đầu', endDate: 'Ngày kết thúc', deadline: 'Hạn hoàn thành', room: 'Phòng họp',
  driverName: 'Người lái xe', plateNumber: 'Biển số xe', destination: 'Điểm đến', purpose: 'Mục đích',
  assignee: 'Người phụ trách', reason: 'Lý do', note: 'Ghi chú', content: 'Nội dung', qty: 'Số lượng',
  quantity: 'Số lượng', price: 'Đơn giá', jobTitle: 'Chức danh', username: 'Tài khoản', fullName: 'Họ tên'
};

function humanizeReportFieldKey(key) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^_+/, '');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// Các trường KHÔNG đưa vào bộ lọc/bảng chi tiết — object/array lồng nhau (lịch sử, file đính kèm, mặt
// hàng...) không phải kiểu dữ liệu đơn (scalar) nên tự động bị loại ở buildReportDetailColumns() (chỉ
// nhận string/number/boolean), danh sách dưới đây chỉ để loại thêm vài trường scalar nhưng không có ý
// nghĩa lọc/hiển thị (id nội bộ, url file...).
const REPORT_FIELD_EXCLUDE_KEYS = new Set(['id', 'password', 'passwordHash', 'fileUrl', 'pdfFileUrl', 'avatarUrl', 'photoUrl', 'signatureUrl']);

function inferReportFieldType(key, values) {
  const nonNull = values.filter(v => v !== null && v !== undefined && v !== '');
  if (!nonNull.length) return 'text';
  if (nonNull.every(v => typeof v === 'boolean')) return 'select';
  if (nonNull.every(v => typeof v === 'number')) return 'number';
  if (/status$/i.test(key)) return 'select';
  if (/(date|at)$/i.test(key) && nonNull.every(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v))) return 'date';
  const uniq = new Set(nonNull.map(String));
  if (uniq.size > 0 && uniq.size <= 15 && uniq.size < nonNull.length) return 'select';
  return 'text';
}

function buildReportDetailColumns(moduleKey, records, config) {
  const cols = [];
  const excludeRawKeys = new Set();
  if (config.statusOf) {
    const options = (config.statusBuckets || [['PENDING', 'Đang chờ duyệt'], ['APPROVED', 'Đã phê duyệt'], ['REJECTED', 'Bị từ chối']]).map(b => [b[0], b[1]]);
    cols.push({ key: '__status', label: REPORT_FIELD_LABELS.__status, type: 'select', options, getValue: r => config.statusOf(r) });
    excludeRawKeys.add('status'); excludeRawKeys.add('approvalStatus');
  }

  const sampleSize = Math.min(records.length, 300);
  const valuesByKey = {};
  for (let i = 0; i < sampleSize; i++) {
    const r = records[i];
    Object.keys(r).forEach(k => {
      if (excludeRawKeys.has(k) || REPORT_FIELD_EXCLUDE_KEYS.has(k) || k.startsWith('_')) return;
      const v = r[k];
      const t = typeof v;
      if (v !== null && v !== undefined && t !== 'string' && t !== 'number' && t !== 'boolean') return;
      (valuesByKey[k] = valuesByKey[k] || []).push(v);
    });
  }

  Object.keys(valuesByKey).forEach(k => {
    cols.push({ key: k, label: REPORT_FIELD_LABELS[k] || humanizeReportFieldKey(k), type: inferReportFieldType(k, valuesByKey[k]), getValue: r => r[k] });
  });

  cols.forEach(c => {
    if (c.type === 'select' && !c.options) {
      const uniq = [...new Set(records.map(r => c.getValue(r)).filter(v => v !== null && v !== undefined && v !== ''))].sort();
      c.options = uniq.map(v => [v, typeof v === 'boolean' ? (v ? 'Có' : 'Không') : String(v)]);
    }
  });

  const PRIORITY = ['code', '__status', 'title', 'name', 'dept', 'subType', 'type', 'amount', 'createdAt', 'startDate', 'endDate', 'deadline'];
  cols.sort((a, b) => {
    const ai = PRIORITY.indexOf(a.key), bi = PRIORITY.indexOf(b.key);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.label.localeCompare(b.label, 'vi');
  });
  return cols;
}

function formatReportDetailValue(col, v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  if (col.type === 'number') return Number(v).toLocaleString('vi-VN');
  return String(v);
}

function applyReportDetailFilters(records, columns, filters) {
  if (!filters) return records;
  return records.filter(r => columns.every(col => {
    const f = filters[col.key];
    if (col.type === 'number') {
      if (!f || ((f.min === undefined || f.min === '') && (f.max === undefined || f.max === ''))) return true;
      const num = col.getValue(r);
      if (typeof num !== 'number' || Number.isNaN(num)) return false;
      if (f.min !== undefined && f.min !== '' && num < parseFloat(f.min)) return false;
      if (f.max !== undefined && f.max !== '' && num > parseFloat(f.max)) return false;
      return true;
    }
    if (col.type === 'date') {
      if (!f || (!f.from && !f.to)) return true;
      const v = col.getValue(r);
      if (!v) return false;
      const vDate = String(v).slice(0, 10);
      if (f.from && vDate < f.from) return false;
      if (f.to && vDate > f.to) return false;
      return true;
    }
    if (!f) return true;
    const v = col.getValue(r);
    if (col.type === 'select') return String(v ?? '') === String(f);
    return String(v ?? '').toLowerCase().includes(String(f).toLowerCase());
  }));
}

function buildReportDetailFilterControlHTML(moduleKey, col) {
  const base = `rdf_${moduleKey}_${col.key}`;
  const fv = (reportDetailFilterValues[moduleKey] && reportDetailFilterValues[moduleKey][col.key]) || null;
  if (col.type === 'select') {
    const cur = typeof fv === 'string' ? fv : '';
    return `<select id="${base}" data-op-change="onReportDetailFilterInput" data-arg0="${moduleKey}" data-arg1="${col.key}" data-arg2="select" class="w-full border p-1 rounded text-[11px] bg-white">
      <option value="">-- Tất cả --</option>
      ${col.options.map(([v, l]) => `<option value="${escapeHtml(String(v))}" ${cur === String(v) ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}
    </select>`;
  }
  if (col.type === 'number') {
    const min = (fv && fv.min !== undefined) ? fv.min : '';
    const max = (fv && fv.max !== undefined) ? fv.max : '';
    return `<div class="flex gap-1">
      <input type="number" id="${base}_min" value="${escapeHtml(String(min))}" data-op-input="onReportDetailFilterInput" data-arg0="${moduleKey}" data-arg1="${col.key}" data-arg2="number" placeholder="Từ" class="w-1/2 border p-1 rounded text-[11px]">
      <input type="number" id="${base}_max" value="${escapeHtml(String(max))}" data-op-input="onReportDetailFilterInput" data-arg0="${moduleKey}" data-arg1="${col.key}" data-arg2="number" placeholder="Đến" class="w-1/2 border p-1 rounded text-[11px]">
    </div>`;
  }
  if (col.type === 'date') {
    const from = (fv && fv.from) || '';
    const to = (fv && fv.to) || '';
    return `<div class="flex gap-1">
      <input type="date" id="${base}_from" value="${escapeHtml(from)}" data-op-change="onReportDetailFilterInput" data-arg0="${moduleKey}" data-arg1="${col.key}" data-arg2="date" class="w-1/2 border p-1 rounded text-[11px]">
      <input type="date" id="${base}_to" value="${escapeHtml(to)}" data-op-change="onReportDetailFilterInput" data-arg0="${moduleKey}" data-arg1="${col.key}" data-arg2="date" class="w-1/2 border p-1 rounded text-[11px]">
    </div>`;
  }
  const cur = typeof fv === 'string' ? fv : '';
  return `<input type="text" id="${base}" value="${escapeHtml(cur)}" data-op-input="onReportDetailFilterInput" data-arg0="${moduleKey}" data-arg1="${col.key}" data-arg2="text" placeholder="Tìm ${escapeHtml(col.label.toLowerCase())}..." class="w-full border p-1 rounded text-[11px]">`;
}

function onReportDetailFilterInput(moduleKey, colKey, type) {
  const base = `rdf_${moduleKey}_${colKey}`;
  reportDetailFilterValues[moduleKey] = reportDetailFilterValues[moduleKey] || {};
  if (type === 'number') {
    const min = document.getElementById(base + '_min')?.value ?? '';
    const max = document.getElementById(base + '_max')?.value ?? '';
    reportDetailFilterValues[moduleKey][colKey] = { min, max };
  } else if (type === 'date') {
    const from = document.getElementById(base + '_from')?.value ?? '';
    const to = document.getElementById(base + '_to')?.value ?? '';
    reportDetailFilterValues[moduleKey][colKey] = { from, to };
  } else {
    reportDetailFilterValues[moduleKey][colKey] = document.getElementById(base)?.value ?? '';
  }
  renderReportDetailResultsOnly(moduleKey);
}

function onReportDetailColumnToggle(moduleKey, colKey, checked) {
  const sel = reportDetailSelectedCols[moduleKey] || [];
  reportDetailSelectedCols[moduleKey] = checked ? [...sel.filter(k => k !== colKey), colKey] : sel.filter(k => k !== colKey);
  renderReportDetailResultsOnly(moduleKey);
}
function onReportDetailColumnToggleFromCheckbox(moduleKey, colKey, checkboxEl) {
  onReportDetailColumnToggle(moduleKey, colKey, checkboxEl.checked);
}

function resetReportDetailFilters(moduleKey) {
  reportDetailFilterValues[moduleKey] = {};
  const container = document.getElementById('reportsContent');
  if (container) renderModuleReport(moduleKey, container);
}

function buildReportDetailResultsHTML(moduleKey) {
  const ctx = reportDetailContext;
  if (!ctx || ctx.moduleKey !== moduleKey) return '';
  const filtered = applyReportDetailFilters(ctx.records, ctx.columns, reportDetailFilterValues[moduleKey]);
  const selectedKeys = reportDetailSelectedCols[moduleKey] || [];
  const selectedCols = selectedKeys.map(k => ctx.columns.find(c => c.key === k)).filter(Boolean);

  if (!selectedCols.length) {
    return `<p class="text-xs text-gray-500 italic p-3">Chọn ít nhất 1 trường ở trên để xem bảng kết quả.</p>`;
  }

  const MAX_ROWS = 500;
  const rowsToShow = filtered.slice(0, MAX_ROWS);
  return `
    <div class="text-[11px] text-gray-600 mb-1">Tìm thấy <span class="font-bold">${filtered.length.toLocaleString('vi-VN')}</span> hồ sơ khớp bộ lọc${filtered.length > MAX_ROWS ? ` (chỉ hiện ${MAX_ROWS} dòng đầu — xuất Excel để lấy đủ)` : ''}.</div>
    <div class="overflow-x-auto border rounded">
      <table class="w-full border-collapse text-[11px]">
        <thead><tr class="bg-gray-100 text-left">${selectedCols.map(c => `<th class="border p-1.5">${escapeHtml(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${rowsToShow.length ? rowsToShow.map(r => `<tr>${selectedCols.map(c => `<td class="border p-1.5">${escapeHtml(formatReportDetailValue(c, c.getValue(r)))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${selectedCols.length}" class="text-center p-4 text-gray-500 italic">Không có hồ sơ nào khớp bộ lọc.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

function renderReportDetailResultsOnly(moduleKey) {
  const wrap = document.getElementById('reportDetailResultsWrap');
  if (wrap) wrap.innerHTML = buildReportDetailResultsHTML(moduleKey);
}

function exportReportDetailExcel(moduleKey) {
  const ctx = reportDetailContext;
  if (!ctx || ctx.moduleKey !== moduleKey) return;
  const selectedKeys = reportDetailSelectedCols[moduleKey] || [];
  const cols = selectedKeys.map(k => ctx.columns.find(c => c.key === k)).filter(Boolean);
  if (!cols.length) return alert('Vui lòng chọn ít nhất 1 trường để xuất.');
  const filtered = applyReportDetailFilters(ctx.records, ctx.columns, reportDetailFilterValues[moduleKey]);
  const columns = cols.map(c => ({ header: c.label, key: c.key, width: 22 }));
  const dataRows = filtered.map(r => {
    const row = {};
    cols.forEach(c => { row[c.key] = formatReportDetailValue(c, c.getValue(r)); });
    return row;
  });
  downloadXlsxFromServer(`BaoCaoChiTiet_${moduleKey}_${new Date().toISOString().slice(0, 10)}.xlsx`, ('ChiTiet_' + moduleKey).slice(0, 31), columns, dataRows);
}

