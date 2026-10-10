// lib/headcountReport.js — Báo Cáo Định Biên Nhân Sự (10/2026, theo yêu cầu người dùng "biết được định
// biên nhân sự hiện tại, định biên nhân sự cần tuyển", đối chiếu mẫu Excel "Bao_cao theo dinh bien").
//
// Quyết định thiết kế đã xác nhận với người dùng (xem doc phân tích "Rà Soát Hồ Sơ Nhân Sự HCRC", Phần 5,
// Phương án A): KHÔNG dựng collection/bảng mới — "Định biên" (headcountQuota) là 1 field TUỲ CHỌN trực
// tiếp trên node POSITION của Cơ Cấu Tổ Chức (xem lib/orgChart.js::addNode()/editNode()), sửa qua đúng
// màn Cơ Cấu Tổ Chức hiện có. "Thực tế" KHÔNG lưu gì thêm — tính ĐỘNG mỗi lần xem, từ 3 nguồn đã có sẵn:
//   - employeeProfiles.positionKey (nguồn CHÍNH THỨC "ai đang giữ vị trí nào", xem
//     applyPositionAssignment() ở lib/employeeProfile.js) — status ACTIVE/ON_LEAVE được tính là 1 chỗ
//     đang chiếm (status INACTIVE/DRAFT thì KHÔNG, đã nghỉ hẳn hoặc chưa chính thức vào làm).
//   - hrProcesses (processType OFFBOARDING, status IN_PROGRESS) — hồ sơ ĐANG bàn giao nghỉ việc (profile
//     vẫn còn ACTIVE/ON_LEAVE ở bước này, chỉ chuyển INACTIVE khi quy trình COMPLETED, xem
//     applyProcessCompletion() ở lib/employeeProfile.js) — tách riêng khỏi "Đang làm việc" theo đúng mẫu.
//   - users[].secondaryPositions[] ("Vị Trí Kiêm Nhiệm", xem lib/positionApprovers.js) — khớp theo đúng
//     cặp (dept, jobTitle) của node, tính hệ số 0.5 theo đúng mẫu Excel.
// "Thai sản/nghỉ ốm": hệ thống hiện CHỈ có 1 trạng thái ON_LEAVE gộp chung (không phân biệt được 2 lý do
// riêng — đã nêu rõ với người dùng ở doc phân tích), nên cột này = toàn bộ profile ON_LEAVE tại vị trí.
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
  const actualTotal = active + onLeave + offboarding + secondary;
  const quota = node.headcountQuota;
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
    rows[rowIndex].variance = displayAgg.hasAnyQuota ? (displayAgg.quota - displayAgg.actualTotal) : null;
    return agg;
  }

  const root = nodes.find(n => n.parentNodeId == null);
  if (root) visit(root, 0);
  return { rows };
}

module.exports = { computeHeadcountReport };
