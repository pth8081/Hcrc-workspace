// lib/headcountReport.js — Báo Cáo Định Biên Nhân Sự (10/2026, theo yêu cầu người dùng "biết được định
// biên nhân sự hiện tại, định biên nhân sự cần tuyển", đối chiếu mẫu Excel "Bao_cao theo dinh bien").
//
// Quyết định thiết kế đã xác nhận với người dùng (xem doc phân tích "Rà Soát Hồ Sơ Nhân Sự HCRC", Phần 5,
// Phương án A): KHÔNG dựng collection/bảng mới — "Định biên" (headcountQuota) là 1 field TUỲ CHỌN trực
// tiếp trên node POSITION của Cơ Cấu Tổ Chức (xem lib/orgChart.js::addNode()/editNode()), sửa qua đúng
// màn Cơ Cấu Tổ Chức hiện có. "Thực tế" KHÔNG lưu gì thêm — tính ĐỘNG mỗi lần xem, từ 2 nguồn đã có sẵn:
//   - employeeProfiles.positionKey (nguồn CHÍNH THỨC "ai đang giữ vị trí nào", xem
//     applyPositionAssignment() ở lib/employeeProfile.js) — status ACTIVE/ON_LEAVE được tính là 1 chỗ
//     đang chiếm (status INACTIVE/DRAFT thì KHÔNG, đã nghỉ hẳn hoặc chưa chính thức vào làm).
//   - hrProcesses (processType OFFBOARDING, status IN_PROGRESS) — hồ sơ ĐANG bàn giao nghỉ việc (profile
//     vẫn còn ACTIVE/ON_LEAVE ở bước này, chỉ chuyển INACTIVE khi quy trình COMPLETED, xem
//     applyProcessCompletion() ở lib/employeeProfile.js) — tách riêng khỏi "Đang làm việc" theo đúng mẫu.
// users[].secondaryPositions[] ("Vị Trí Kiêm Nhiệm", xem lib/positionApprovers.js, khớp theo đúng cặp
// (dept, jobTitle) của node, tính hệ số 0.5) — 11/2026 ĐỢT 3 (theo phản hồi người dùng xem ảnh demo: "cột
// thực tế bạn ko nên cộng kiêm nhiệm vào... kiêm nhiệm chỉ có ở hồ sơ nhân sự nên cột thực tế là cột không
// có kiêm nhiệm") — ĐỔI QUYẾT ĐỊNH so với 2 đợt trước: Kiêm Nhiệm KHÔNG còn cộng vào "Thực Tế" (actualTotal)
// NỮA, chỉ còn là 1 cột RIÊNG (`secondary`) hoàn toàn tách biệt, không ảnh hưởng Thực Tế/Chênh Lệch.
// "Thai sản/nghỉ ốm": hệ thống hiện CHỈ có 1 trạng thái ON_LEAVE gộp chung (không phân biệt được 2 lý do
// riêng — đã nêu rõ với người dùng ở doc phân tích), nên cột này = toàn bộ profile ON_LEAVE tại vị trí.
const ExcelJS = require('exceljs');
const { findNearestDeptAncestor, buildNodeDisplayName } = require('./orgChart');

const ACTIVE_LIKE_STATUSES = new Set(['ACTIVE', 'ON_LEAVE']);

function buildChildrenMap(nodes) {
  const byParent = new Map();
  for (const n of nodes || []) {
    const key = n.parentNodeId == null ? '__root' : n.parentNodeId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  for (const list of byParent.values()) list.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  return byParent;
}

// Vị trí (POSITION) kiêm nhiệm khớp node: user.secondaryPositions[] có đúng cặp (dept, jobTitle) của
// chính node này — dept lấy từ departmentRef của phòng ban cha gần nhất (node không requiresDept thì
// không khớp kiêm nhiệm theo dept, chỉ theo jobTitle).
function countSecondaryHolders(version, node, users) {
  const deptNode = node.requiresDept !== false ? findNearestDeptAncestor(version, node) : null;
  const deptRef = deptNode?.departmentRef || null;
  let count = 0;
  for (const u of users || []) {
    if (u.active === false) continue;
    const matched = (u.secondaryPositions || []).some(sp => {
      if (sp.jobTitle !== node.jobTitle) return false;
      if (node.requiresDept === false) return true;
      return !!deptRef && sp.dept === deptRef;
    });
    if (matched) count++;
  }
  return count;
}

function computePositionStats(version, node, employeeProfiles, offboardingUsernames, users) {
  let active = 0, onLeave = 0, offboarding = 0;
  for (const p of employeeProfiles || []) {
    if (!p || p.positionKey !== node.positionKey) continue;
    if (!ACTIVE_LIKE_STATUSES.has(p.status)) continue;
    if (p.username && offboardingUsernames.has(p.username)) { offboarding++; continue; }
    if (p.status === 'ON_LEAVE') { onLeave++; continue; }
    active++;
  }
  const secondary = countSecondaryHolders(version, node, users) * 0.5;
  // Thực Tế (actualTotal) KHÔNG gồm Kiêm Nhiệm (11/2026 ĐỢT 3, theo phản hồi người dùng xem ảnh demo:
  // "cột thực tế bạn ko nên cộng kiêm nhiệm vào. Báo cáo định biên lấy từ cấu hình định biên nhân sự mà
  // trên cấu hình này ko có kiêm nhiệm, kiêm nhiệm chỉ có ở hồ sơ nhân sự nên cột thực tế là cột không có
  // kiêm nhiệm") — ĐỔI QUYẾT ĐỊNH so với đợt trước (khi đó GIỮ actualTotal gồm cả Kiêm Nhiệm, chỉ sửa
  // variance riêng) — nay actualTotal chỉ còn active+onLeave+offboarding, Kiêm Nhiệm hoàn toàn tách biệt
  // (cột riêng, cộng tổng riêng để báo cáo, không cộng vào Thực Tế/Chênh Lệch nữa).
  const actualTotal = active + onLeave + offboarding;
  const quota = node.headcountQuota;
  // Chênh Lệch = Định Biên - Thực Tế, ĐƠN GIẢN/NHẤT QUÁN trở lại (Thực Tế đã không còn chứa Kiêm Nhiệm
  // nên không cần công thức riêng như đợt trước nữa).
  const variance = quota == null ? null : quota - actualTotal;
  return { active, onLeave, offboarding, secondary, actualTotal, quota, variance };
}

const EMPTY_STATS = { active: 0, onLeave: 0, offboarding: 0, secondary: 0, actualTotal: 0, quota: 0, variance: 0 };

function addStats(a, b) {
  return {
    active: a.active + b.active,
    onLeave: a.onLeave + b.onLeave,
    offboarding: a.offboarding + b.offboarding,
    secondary: a.secondary + b.secondary,
    actualTotal: a.actualTotal + b.actualTotal,
    quota: (a.quota || 0) + (b.quota || 0),
    hasAnyQuota: !!a.hasAnyQuota || !!b.hasAnyQuota
  };
}

// Trả về { rows } — mảng phẳng (DFS, giữ nguyên thứ tự hiển thị cây) gồm cả node DEPARTMENT/COMPANY
// (dòng cộng dồn, không có jobTitle/positionKey riêng) lẫn node POSITION (dòng lá, đủ breakdown).
function computeHeadcountReport(version, employeeProfiles, hrProcesses, users) {
  const nodes = version?.nodes || [];
  const childrenByParent = buildChildrenMap(nodes);
  const offboardingUsernames = new Set(
    (hrProcesses || [])
      .filter(h => h?.processType === 'OFFBOARDING' && h?.status === 'IN_PROGRESS' && h.employeeUsername)
      .map(h => h.employeeUsername)
  );
  const rows = [];

  function visit(node, level) {
    if (node.nodeType === 'POSITION') {
      const stats = computePositionStats(version, node, employeeProfiles, offboardingUsernames, users);
      rows.push({
        nodeId: node.nodeId, nodeType: 'POSITION', level,
        displayName: buildNodeDisplayName(version, node),
        jobTitle: node.jobTitle, jobGrade: node.jobGrade || '', positionKey: node.positionKey,
        quota: stats.quota, active: stats.active, onLeave: stats.onLeave, offboarding: stats.offboarding,
        secondary: stats.secondary, actualTotal: stats.actualTotal, variance: stats.variance
      });
      return { ...stats, hasAnyQuota: stats.quota != null };
    }
    const children = childrenByParent.get(node.nodeId) || [];
    // agg: LUÔN cộng dồn ĐẦY ĐỦ toàn bộ nhánh con (kể cả khi node này bật headcountSelfOnly) — đây là
    // giá trị trả LÊN node CHA (và cuối cùng lên Công Ty), không bao giờ bị ảnh hưởng bởi cờ
    // headcountSelfOnly của bất kỳ node con nào — Công Ty/các Ban khác vẫn đúng như cũ.
    // ownAgg: CHỈ cộng các con TRỰC TIẾP loại POSITION (không đệ quy xuống DEPARTMENT con) — dùng làm
    // dòng HIỂN THỊ của CHÍNH node này khi headcountSelfOnly bật (VD "Ban Tổng Giám Đốc": chỉ tính TGĐ +
    // Phó TGĐ gắn trực tiếp, không cộng luôn các Ban khác nằm dưới nó trong sơ đồ).
    let agg = { ...EMPTY_STATS, hasAnyQuota: false };
    let ownAgg = { ...EMPTY_STATS, hasAnyQuota: false };
    const rowIndex = rows.length;
    rows.push({
      nodeId: node.nodeId, nodeType: node.nodeType, level,
      displayName: node.nodeName, jobTitle: '', jobGrade: '', positionKey: null,
      quota: 0, active: 0, onLeave: 0, offboarding: 0, secondary: 0, actualTotal: 0, variance: 0
    });
    for (const child of children) {
      const childAgg = visit(child, level + 1);
      agg = addStats(agg, childAgg);
      if (child.nodeType === 'POSITION') ownAgg = addStats(ownAgg, childAgg);
    }
    const displayAgg = node.headcountSelfOnly ? ownAgg : agg;
    rows[rowIndex].quota = displayAgg.hasAnyQuota ? displayAgg.quota : null;
    rows[rowIndex].active = displayAgg.active;
    rows[rowIndex].onLeave = displayAgg.onLeave;
    rows[rowIndex].offboarding = displayAgg.offboarding;
    rows[rowIndex].secondary = displayAgg.secondary;
    rows[rowIndex].actualTotal = displayAgg.actualTotal;
    // CÙNG quyết định 11/2026 ĐỢT 3 ở computePositionStats() — actualTotal cộng dồn đã KHÔNG còn chứa
    // Kiêm Nhiệm (secondary) nữa nên variance cộng dồn trở lại ĐƠN GIẢN "quota - actualTotal".
    rows[rowIndex].variance = displayAgg.hasAnyQuota ? (displayAgg.quota - displayAgg.actualTotal) : null;
    return agg;
  }

  const root = nodes.find(n => n.parentNodeId == null);
  if (root) visit(root, 0);
  return { rows };
}

// ===== Dạng BẢNG PHẲNG theo mẫu Excel định biên của người dùng (11/2026, theo yêu cầu người dùng gửi
// kèm ảnh file mẫu thật đang dùng) — KHÁC HẲN computeHeadcountReport() ở trên (cây thụt lề 1 cột
// "Cấp/Tên"): bảng này tách riêng "BAN/PHÒNG" (cấp 1, đánh số La Mã I/II...) / "BAN/PHÒNG/BỘ PHẬN" (cấp
// 2, đánh "I.1/I.2...") / "BỘ PHẬN/NHÓM" (cấp 3 trở lên, gộp tên nối bằng " > ", KHÔNG đánh số La Mã
// riêng — layout chỉ cố định 3 cột đường dẫn), cộng thêm "Mã vị trí" tự sinh (VT1, VT2... — mã nội bộ
// thật positionKey là UUID dài không hiển thị được) và viết tắt Phòng Ban lấy từ danh mục đã có sẵn
// (AppData.deptAbbrs, khớp theo node.departmentRef). TÁI DÙNG NGUYÊN hàm computeHeadcountReport() ở trên
// để lấy Định Biên/Thực Tế/Chênh Lệch mỗi node (tôn trọng ĐÚNG headcountSelfOnly) — chỉ XẾP LẠI thành
// bảng phẳng, không tính lại bất kỳ con số nào, tránh 2 nơi lệch nhau.
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'];
function toRoman(n) { return ROMAN[n - 1] || String(n); }

function buildFlatChildrenMap(nodes) {
  const byParent = new Map();
  for (const n of nodes || []) {
    const key = n.parentNodeId == null ? '__root' : n.parentNodeId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  }
  for (const list of byParent.values()) list.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  return byParent;
}
function abbrForNode(node, deptAbbrs) {
  if (!node.departmentRef) return '';
  return (deptAbbrs || {})[node.departmentRef] || '';
}
// Gom toàn bộ Vị Trí thuộc 1 "bucket" (nhóm cấp 2 đang mở, hoặc cấp 1 nếu Vị Trí nằm thẳng dưới cấp 1) —
// gặp DEPARTMENT cấp 3 trở lên thì CHỈ gộp tên vào extraPathParts (cột "BỘ PHẬN/NHÓM"), không tạo bucket
// STT mới, không đánh số La Mã riêng — tiếp tục cộng dồn vào ĐÚNG bucket đang mở.
function collectPositionsInBucket(node, childrenByParent, extraPathParts, out) {
  const children = childrenByParent.get(node.nodeId) || [];
  for (const child of children) {
    if (child.nodeType === 'POSITION') out.push({ position: child, extraPath: extraPathParts.join(' > ') });
    else collectPositionsInBucket(child, childrenByParent, [...extraPathParts, child.nodeName], out);
  }
}

function buildFlatGroupedHeadcountReport(version, employeeProfiles, hrProcesses, users, deptAbbrs) {
  const { rows: statRows } = computeHeadcountReport(version, employeeProfiles, hrProcesses, users);
  const statsByNodeId = new Map(statRows.map(r => [r.nodeId, r]));
  const nodes = version?.nodes || [];
  const childrenByParent = buildFlatChildrenMap(nodes);
  const root = nodes.find(n => n.parentNodeId == null);
  const rows = [];
  if (!root) return { rootLabel: '', rootAbbr: '', rootStats: null, rows };

  let positionCounter = 0;
  const nextCode = () => 'VT' + (++positionCounter);

  function pushPositionRow(stt, banPhong, banPhongBoPhan, boPhanNhom, posNode) {
    const s = statsByNodeId.get(posNode.nodeId) || {};
    rows.push({
      kind: 'POSITION', nodeId: posNode.nodeId, stt, banPhong, banPhongBoPhan, boPhanNhom,
      chucDanh: posNode.jobTitle, capBac: posNode.jobGrade || '', maViTri: nextCode(),
      quota: s.quota, actualTotal: s.actualTotal, variance: s.variance,
      active: s.active, onLeave: s.onLeave, offboarding: s.offboarding, secondary: s.secondary
    });
  }
  function pushGroupRow(kind, sttLabel, deptNode) {
    const s = statsByNodeId.get(deptNode.nodeId) || {};
    rows.push({
      kind, nodeId: deptNode.nodeId, sttLabel, label: deptNode.nodeName, abbr: abbrForNode(deptNode, deptAbbrs),
      quota: s.quota, actualTotal: s.actualTotal, variance: s.variance,
      active: s.active, onLeave: s.onLeave, offboarding: s.offboarding, secondary: s.secondary
    });
  }

  const rootChildren = childrenByParent.get(root.nodeId) || [];
  const rootLevelPositions = rootChildren.filter(c => c.nodeType === 'POSITION');
  const rootLevelDepts = rootChildren.filter(c => c.nodeType === 'DEPARTMENT');

  if (rootLevelPositions.length) {
    const label = `(Trực thuộc ${root.nodeName || 'Công Ty'})`;
    let stt = 0;
    for (const pos of rootLevelPositions) { stt++; pushPositionRow(stt, label, label, '', pos); }
  }

  let g1 = 0;
  for (const dept1 of rootLevelDepts) {
    g1++;
    const roman1 = toRoman(g1);
    pushGroupRow('GROUP1', roman1, dept1);

    const dept1Children = childrenByParent.get(dept1.nodeId) || [];
    const positionsUnderDept1 = dept1Children.filter(c => c.nodeType === 'POSITION');
    const subDepts = dept1Children.filter(c => c.nodeType === 'DEPARTMENT');

    if (positionsUnderDept1.length) {
      let stt = 0;
      for (const pos of positionsUnderDept1) { stt++; pushPositionRow(stt, dept1.nodeName, dept1.nodeName, '', pos); }
    }

    let g2 = 0;
    for (const dept2 of subDepts) {
      g2++;
      pushGroupRow('GROUP2', `${roman1}.${g2}`, dept2);
      const bucket = [];
      collectPositionsInBucket(dept2, childrenByParent, [], bucket);
      let stt = 0;
      for (const item of bucket) { stt++; pushPositionRow(stt, dept1.nodeName, dept2.nodeName, item.extraPath, item.position); }
    }
  }

  const rootStats = statsByNodeId.get(root.nodeId) || {};
  return { rootLabel: root.nodeName, rootAbbr: abbrForNode(root, deptAbbrs), rootStats, rows };
}

// Xuất Excel đúng layout bảng phẳng ở trên (dùng ExcelJS trực tiếp — không qua buildGenericWorkbook() vì
// cần tô màu/đậm chữ riêng theo từng loại dòng, khác khuôn 1-màu của hàm dùng chung đó).
function buildFlatHeadcountReportWorkbook(report) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Định Biên Nhân Sự');
  sheet.columns = [
    { header: 'STT', key: 'stt', width: 8 },
    { header: 'BAN/PHÒNG', key: 'banPhong', width: 26 },
    { header: 'BAN/PHÒNG/BỘ PHẬN', key: 'banPhongBoPhan', width: 26 },
    { header: 'BỘ PHẬN/NHÓM', key: 'boPhanNhom', width: 20 },
    { header: 'CHỨC DANH', key: 'chucDanh', width: 32 },
    { header: 'CẤP BẬC', key: 'capBac', width: 10 },
    { header: 'Mã vị trí', key: 'maViTri', width: 10 },
    { header: 'Định biên', key: 'quota', width: 10 },
    { header: 'Thực tế', key: 'actualTotal', width: 10 },
    // 3 cột breakdown MỚI (11/2026, theo yêu cầu người dùng). "Kiêm Nhiệm" KHÔNG nằm trong "Thực tế"/
    // "Chênh lệch" (11/2026 ĐỢT 3 — xem computePositionStats()), chỉ là cột riêng để tham khảo/báo cáo.
    { header: 'Kiêm Nhiệm', key: 'secondary', width: 10 },
    { header: 'Đang Bàn Giao Nghỉ Việc', key: 'offboarding', width: 14 },
    { header: 'Thai Sản/Nghỉ Ốm', key: 'onLeave', width: 12 },
    { header: 'Chênh lệch', key: 'variance', width: 10 }
  ];
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = { bottom: { style: 'thin' } };
  });
  header.height = 30;

  const FILL_ROOT = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  const FILL_GROUP = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE68A' } };

  const rRoot = sheet.addRow({
    stt: 'A', banPhong: report.rootLabel, banPhongBoPhan: report.rootAbbr || '',
    quota: report.rootStats?.quota ?? '', actualTotal: report.rootStats?.actualTotal,
    secondary: report.rootStats?.secondary, offboarding: report.rootStats?.offboarding, onLeave: report.rootStats?.onLeave,
    variance: report.rootStats?.variance ?? ''
  });
  rRoot.eachCell(c => { c.fill = FILL_ROOT; c.font = { bold: true }; });

  for (const r of report.rows) {
    if (r.kind === 'GROUP1' || r.kind === 'GROUP2') {
      const row = sheet.addRow({
        stt: r.sttLabel, banPhong: r.label, banPhongBoPhan: r.abbr || '',
        quota: r.quota == null ? '' : r.quota, actualTotal: r.actualTotal,
        secondary: r.secondary, offboarding: r.offboarding, onLeave: r.onLeave,
        variance: r.variance == null ? '' : r.variance
      });
      row.eachCell(c => { c.fill = FILL_GROUP; });
      sheet.getCell(`B${row.number}`).font = r.kind === 'GROUP1' ? { bold: true, color: { argb: 'FFDC2626' } } : { bold: true, color: { argb: 'FF111827' } };
      // H=Định biên, I=Thực tế, J=Kiêm Nhiệm, K=Đang Bàn Giao Nghỉ Việc, L=Thai Sản/Nghỉ Ốm, M=Chênh lệch.
      ['H', 'I', 'J', 'K', 'L', 'M'].forEach(col => { sheet.getCell(`${col}${row.number}`).font = { bold: true }; });
    } else {
      const row = sheet.addRow({
        stt: r.stt, banPhong: r.banPhong, banPhongBoPhan: r.banPhongBoPhan, boPhanNhom: r.boPhanNhom,
        chucDanh: r.chucDanh, capBac: r.capBac, maViTri: r.maViTri,
        quota: r.quota == null ? '' : r.quota, actualTotal: r.actualTotal,
        secondary: r.secondary, offboarding: r.offboarding, onLeave: r.onLeave,
        variance: r.variance == null ? '' : r.variance
      });
      sheet.getCell(`G${row.number}`).font = { italic: true, color: { argb: 'FF2563EB' } };
      sheet.getCell(`H${row.number}`).font = { bold: true, color: { argb: 'FF1D4ED8' } };
    }
  }
  sheet.eachRow(row => row.eachCell(c => {
    c.border = { ...(c.border || {}), left: { style: 'thin', color: { argb: 'FFD1D5DB' } }, right: { style: 'thin', color: { argb: 'FFD1D5DB' } }, top: { style: 'thin', color: { argb: 'FFD1D5DB' } }, bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } } };
  }));
  return wb;
}

module.exports = { computeHeadcountReport, buildFlatGroupedHeadcountReport, buildFlatHeadcountReportWorkbook };
