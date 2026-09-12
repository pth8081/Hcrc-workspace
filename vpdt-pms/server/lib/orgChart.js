// lib/orgChart.js — Cơ Cấu Tổ Chức v2 (cây tổ chức CÓ VERSIONING) + Cấu Hình Luồng Đánh Giá KPI Theo
// Vị Trí. Thay hẳn bản v1 (cây suy ra trực tiếp từ user.managerUsername + DB.kpiEvaluatorConfig — map
// phẳng dept×jobTitle -> chức danh người đánh giá, KHÔNG có lịch sử/version nào) theo 2 tài liệu thiết
// kế mới (Cơ Cấu Tổ Chức Versioned & KPI Evaluation Flow; Công & Phép v2 — phần Công & Phép KHÔNG làm
// ở đợt này, chỉ làm phần Cơ Cấu Tổ Chức + KPI Flow theo quyết định đã xác nhận với người dùng).
//
// ĐIỀU CHỈNH so với tài liệu gốc (thiết kế cho SQL Server chuẩn hoá) cho khớp kiến trúc JSON-blob của
// app này (dbo.AppData, không có bảng OrgNodes/PositionAssignments riêng) — đã xác nhận với người dùng:
//   1. KHÔNG dựng bảng Positions/PositionAssignments có lịch sử gán người theo ngày (model đó CHƯA
//      TỪNG tồn tại trong code, tài liệu giả định nhầm là đã có sẵn) — "ai đang giữ 1 vị trí (node loại
//      POSITION)" được SUY RA ĐỘNG tại thời điểm xem, bằng cách so khớp user.dept + user.jobTitle với
//      (departmentRef suy từ node cha gần nhất, jobTitle) của chính node đó — ĐÚNG quy ước đã dùng sẵn
//      trong toàn hệ thống (workflowParticipatingPositions, kpiEvaluatorConfig bản cũ).
//   2. user.managerUsername (field phẳng, đã dùng ở RẤT NHIỀU nơi khác — isManagerOf()/Task/Vận Hành
//      "trưởng phòng xem việc nhân viên", các lớp duyệt "Quản Lý Trực Tiếp" ở Văn Bản Trình/Hợp Đồng...)
//      KHÔNG bị thay thế/xoá — nó trở thành 1 "materialized view" được TỰ ĐỘNG TÍNH LẠI mỗi khi áp dụng
//      1 version cây tổ chức mới (xem applyVersion() bên dưới): quản lý trực tiếp của 1 nhân viên = ai
//      đang giữ vị trí CHA của vị trí nhân viên đó trong cây vừa áp dụng. Nhờ vậy MỌI module khác đang
//      đọc thẳng user.managerUsername tiếp tục hoạt động không cần sửa gì, chỉ được cập nhật đúng hơn.
//   3. KHÔNG đổi DB.depts (mảng chuỗi phẳng) thành nguồn động toàn hệ thống (tài liệu gốc mục 3.6) — rủi
//      ro quá lớn (hàng chục dropdown "Phòng Ban" ở các module khác đang đọc thẳng DB.depts), việc này
//      NGOÀI PHẠM VI đợt này. Node loại DEPARTMENT trong cây có thể (không bắt buộc) gắn `departmentRef`
//      trỏ tới 1 giá trị có sẵn trong DB.depts/DB.stores để dùng làm căn cứ so khớp user.dept — các node
//      nhóm thuần tuý (VD "Khối Kinh Doanh") không cần departmentRef.
//   4. Không có bảng PositionAssignments riêng nên KHÔNG có JobTitles.RequiresDept catalog riêng — mỗi
//      node loại POSITION tự mang cờ `requiresDept` (mặc định true, false cho vị trí kiểu Tổng Giám Đốc
//      không thuộc phòng ban nào).
//   5. `posType` ('HO'|'STORE', TUỲ CHỌN — null nếu chưa gán) trên mỗi node POSITION — bổ sung sau khi
//      phát hiện module Công & Phép (lib/attendance.js::resolveWorkModelForEmployeeCode()) xác định mô
//      hình chấm công (OFFICE_HOURS/SHIFT_BASED) dựa vào user.posType, mà cơ chế "Gán/Đổi Chức Vụ" ở Hồ
//      Sơ Nhân Sự (lib/employeeProfile.js::applyPositionAssignment()) lại chỉ đồng bộ dept/jobTitle
//      xuống tài khoản liên kết — nếu không có field này, đổi chức vụ giữa vị trí Văn phòng/Siêu Thị sẽ
//      không tự cập nhật đúng mô hình chấm công. TUỲ CHỌN (không bắt buộc như jobTitle) để không phá vỡ
//      các node POSITION đã tạo trước khi có field này (giữ null, applyPositionAssignment() bỏ qua đồng
//      bộ posType nếu node chưa gán) — HR/admin vào Cơ Cấu Tổ Chức sửa từng vị trí để bổ sung dần.
//
// Toàn bộ version lưu chung 1 khoá DB.orgChartVersions (AppData, KHÔNG qua dbo.Records — số version
// luôn nhỏ, quản lý/sửa node hoàn toàn qua các hàm ở đây, không cần tìm kiếm/phân trang/optimistic-
// concurrency ở mức từng version như các "hồ sơ nghiệp vụ" thật).
const { randomUUID } = require('crypto');
const { HttpError } = require('./httpErrors');
const { assertNoManagerCycle } = require('./recordViewScope');

const NODE_TYPES = new Set(['COMPANY', 'DEPARTMENT', 'POSITION']);
const POS_TYPES = new Set(['HO', 'STORE']);

function findVersion(list, versionId) {
  return (list || []).find(v => v.id === versionId) || null;
}
function getAppliedVersion(list) {
  return (list || []).find(v => v.status === 'APPLIED') || null;
}
function requireVersion(list, versionId) {
  const v = findVersion(list, versionId);
  if (!v) throw new HttpError(404, 'Không tìm thấy phiên bản cơ cấu tổ chức');
  return v;
}
function requireDraft(version) {
  if (version.status !== 'DRAFT') throw new HttpError(400, 'Chỉ sửa được bản nháp (DRAFT) — bản đã áp dụng/lưu trữ chỉ xem, không sửa được nữa');
}
function nextNodeId(version) {
  return (version.nodes || []).reduce((max, n) => Math.max(max, n.nodeId), 0) + 1;
}
function deepClone(v) {
  return JSON.parse(JSON.stringify(v == null ? null : v));
}

// Node cha gần nhất loại DEPARTMENT (đi ngược parentNodeId) — dùng để suy "phòng ban thật" của 1 vị trí
// (cho tên hiển thị lẫn so khớp user.dept). Trả null nếu không có (VD TGĐ đứng ngay dưới COMPANY).
function findNearestDeptAncestor(version, node) {
  let cur = node;
  const byId = new Map((version.nodes || []).map(n => [n.nodeId, n]));
  let steps = 0;
  while (cur && cur.parentNodeId != null && steps < 100) {
    cur = byId.get(cur.parentNodeId);
    if (cur && cur.nodeType === 'DEPARTMENT') return cur;
    steps++;
  }
  return null;
}

// Tên hiển thị: "<Chức danh> <Tên phòng ban chứa node>" nếu requiresDept, ngược lại chỉ "<Chức danh>"
// (VD Tổng Giám Đốc). Node DEPARTMENT/COMPANY dùng đúng tên admin tự gõ, không tự sinh gì.
function buildNodeDisplayName(version, node) {
  if (node.nodeType !== 'POSITION') return node.nodeName;
  if (node.requiresDept === false) return node.jobTitle;
  const deptNode = findNearestDeptAncestor(version, node);
  return deptNode ? `${node.jobTitle} ${deptNode.nodeName}` : node.jobTitle;
}

// "Ai hiện đang giữ vị trí này" — so khớp ĐỘNG user.dept (qua departmentRef của phòng ban chứa node,
// nếu node.requiresDept) + user.jobTitle (đúng chuỗi jobTitle của node), đang active. Vị trí không
// requiresDept (VD TGĐ) chỉ so khớp jobTitle, không so dept.
function resolvePositionOccupants(version, node, users) {
  if (!node || node.nodeType !== 'POSITION') return [];
  const deptNode = node.requiresDept !== false ? findNearestDeptAncestor(version, node) : null;
  const deptRef = deptNode?.departmentRef || null;
  return (users || []).filter(u => {
    if (u.active === false) return false;
    if (u.jobTitle !== node.jobTitle) return false;
    if (node.requiresDept !== false && deptRef && u.dept !== deptRef) return false;
    return true;
  }).map(u => ({ username: u.username, name: u.name }));
}

// Vị trí (node POSITION) khớp đúng dept+jobTitle hiện tại của 1 user — ngược lại resolvePositionOccupants().
function findPositionNodeForUser(version, user) {
  if (!user?.jobTitle) return null;
  return (version.nodes || []).find(n => {
    if (n.nodeType !== 'POSITION') return false;
    if (n.jobTitle !== user.jobTitle) return false;
    if (n.requiresDept === false) return true;
    const deptNode = findNearestDeptAncestor(version, n);
    return !!deptNode?.departmentRef && deptNode.departmentRef === user.dept;
  }) || null;
}

// ===== CRUD node (chỉ khi version.status==='DRAFT') =====

function addNode(version, { parentNodeId, nodeType, nodeName, departmentRef, jobTitle, requiresDept, posType, displayOrder }) {
  requireDraft(version);
  if (!NODE_TYPES.has(nodeType)) throw new HttpError(400, 'Loại node không hợp lệ');
  const isRoot = parentNodeId == null;
  if (isRoot && (version.nodes || []).some(n => n.parentNodeId == null)) {
    throw new HttpError(400, 'Cây đã có gốc — chỉ thêm được node con (chọn 1 node cha)');
  }
  if (!isRoot && !(version.nodes || []).some(n => n.nodeId === parentNodeId)) {
    throw new HttpError(400, 'Không tìm thấy node cha');
  }
  if (nodeType === 'POSITION') {
    if (!jobTitle || !jobTitle.trim()) throw new HttpError(400, 'Vui lòng nhập Chức Danh cho vị trí');
    if (posType !== undefined && posType !== null && !POS_TYPES.has(posType)) throw new HttpError(400, 'Vị Trí Làm Việc (posType) không hợp lệ — chỉ nhận HO hoặc STORE');
  } else if (!nodeName || !nodeName.trim()) {
    throw new HttpError(400, 'Vui lòng nhập tên cho node');
  }
  const node = {
    nodeId: nextNodeId(version),
    parentNodeId: isRoot ? null : parentNodeId,
    nodeType,
    departmentRef: nodeType === 'DEPARTMENT' ? (departmentRef || null) : null,
    jobTitle: nodeType === 'POSITION' ? jobTitle.trim() : null,
    requiresDept: nodeType === 'POSITION' ? (requiresDept !== false) : null,
    posType: nodeType === 'POSITION' ? (POS_TYPES.has(posType) ? posType : null) : null,
    nodeName: nodeType === 'POSITION' ? null : nodeName.trim(),
    positionKey: nodeType === 'POSITION' ? randomUUID() : null,
    displayOrder: Number.isFinite(displayOrder) ? displayOrder : (version.nodes || []).length
  };
  version.nodes = [...(version.nodes || []), node];
  return node;
}

function isDescendant(version, nodeId, maybeAncestorId) {
  const byId = new Map((version.nodes || []).map(n => [n.nodeId, n]));
  let cur = byId.get(nodeId);
  let steps = 0;
  while (cur && cur.parentNodeId != null && steps < 200) {
    if (cur.parentNodeId === maybeAncestorId) return true;
    cur = byId.get(cur.parentNodeId);
    steps++;
  }
  return false;
}

function editNode(version, nodeId, patch) {
  requireDraft(version);
  const node = (version.nodes || []).find(n => n.nodeId === nodeId);
  if (!node) throw new HttpError(404, 'Không tìm thấy node');
  if (patch.parentNodeId !== undefined && patch.parentNodeId !== node.parentNodeId) {
    if (patch.parentNodeId === nodeId) throw new HttpError(400, 'Không thể chọn chính node này làm cha');
    if (patch.parentNodeId != null) {
      if (!(version.nodes || []).some(n => n.nodeId === patch.parentNodeId)) throw new HttpError(400, 'Không tìm thấy node cha mới');
      if (isDescendant(version, patch.parentNodeId, nodeId) || patch.parentNodeId === nodeId) {
        throw new HttpError(400, 'Không thể chuyển node vào bên dưới chính nhánh con của nó (tạo vòng lặp)');
      }
    }
    node.parentNodeId = patch.parentNodeId;
  }
  if (node.nodeType === 'POSITION') {
    if (patch.jobTitle !== undefined) {
      if (!patch.jobTitle || !patch.jobTitle.trim()) throw new HttpError(400, 'Chức Danh không được để trống');
      node.jobTitle = patch.jobTitle.trim();
    }
    if (patch.requiresDept !== undefined) node.requiresDept = !!patch.requiresDept;
    if (patch.posType !== undefined) {
      if (patch.posType !== null && !POS_TYPES.has(patch.posType)) throw new HttpError(400, 'Vị Trí Làm Việc (posType) không hợp lệ — chỉ nhận HO hoặc STORE');
      node.posType = patch.posType || null;
    }
  } else if (patch.nodeName !== undefined) {
    if (!patch.nodeName || !patch.nodeName.trim()) throw new HttpError(400, 'Tên không được để trống');
    node.nodeName = patch.nodeName.trim();
  }
  if (node.nodeType === 'DEPARTMENT' && patch.departmentRef !== undefined) {
    node.departmentRef = patch.departmentRef || null;
  }
  if (patch.displayOrder !== undefined && Number.isFinite(patch.displayOrder)) node.displayOrder = patch.displayOrder;
  return node;
}

// Xoá node + TOÀN BỘ nhánh con (cascade) — chặn nếu bất kỳ node POSITION nào trong nhánh đang có người
// giữ (resolvePositionOccupants), đúng luật tài liệu gốc mục 6 (DELETE /api/org/nodes/:id). Dọn luôn
// mọi dòng kpiFlow tham chiếu tới các nodeId bị xoá (evaluator hoặc evaluatee).
function deleteNodeCascade(version, nodeId, users) {
  requireDraft(version);
  const byId = new Map((version.nodes || []).map(n => [n.nodeId, n]));
  if (!byId.has(nodeId)) throw new HttpError(404, 'Không tìm thấy node');
  const toDelete = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of version.nodes) {
      if (n.parentNodeId != null && toDelete.has(n.parentNodeId) && !toDelete.has(n.nodeId)) {
        toDelete.add(n.nodeId);
        changed = true;
      }
    }
  }
  const heldPositions = [];
  for (const id of toDelete) {
    const n = byId.get(id);
    if (n?.nodeType === 'POSITION') {
      const occ = resolvePositionOccupants(version, n, users);
      if (occ.length) heldPositions.push({ node: n, occupants: occ });
    }
  }
  if (heldPositions.length) {
    const names = heldPositions.map(h => `"${buildNodeDisplayName(version, h.node)}" (${h.occupants.map(o => o.name).join(', ')})`).join('; ');
    throw new HttpError(400, `Không thể xoá — vẫn còn nhân viên đang giữ vị trí: ${names}. Vui lòng chuyển nhân viên sang vị trí/phòng ban khác trước.`);
  }
  version.nodes = version.nodes.filter(n => !toDelete.has(n.nodeId));
  version.kpiFlow = (version.kpiFlow || []).filter(f => !toDelete.has(f.evaluatorNodeId) && !toDelete.has(f.evaluateeNodeId));
  return [...toDelete];
}

// ===== Validate trước khi áp dụng =====

function computeValidationIssues(candidate, appliedVersion, users) {
  const issues = [];
  const byId = new Map((candidate.nodes || []).map(n => [n.nodeId, n]));
  // 1) Node mồ côi (parentNodeId trỏ tới node không tồn tại).
  for (const n of candidate.nodes || []) {
    if (n.parentNodeId != null && !byId.has(n.parentNodeId)) {
      issues.push(`Node "${buildNodeDisplayName(candidate, n)}" có node cha không tồn tại`);
    }
  }
  // 2) Vị trí (POSITION) đã bị xoá so với bản đang áp dụng nhưng vẫn có người giữ.
  if (appliedVersion) {
    const candidateKeys = new Set((candidate.nodes || []).filter(n => n.nodeType === 'POSITION').map(n => n.positionKey));
    for (const n of appliedVersion.nodes || []) {
      if (n.nodeType !== 'POSITION' || candidateKeys.has(n.positionKey)) continue;
      const occ = resolvePositionOccupants(appliedVersion, n, users);
      if (occ.length) {
        issues.push(`Vị trí "${buildNodeDisplayName(appliedVersion, n)}" bị xoá khỏi bản nháp nhưng vẫn có người giữ: ${occ.map(o => o.name).join(', ')}`);
      }
    }
  }
  // 3) Tối đa 1 "Trưởng phòng" đang giữ (có người) mỗi phòng ban — quy ước dựa theo chuỗi Chức Danh
  //    (không có catalog JobTitles.Level riêng ở bản rút gọn này).
  const byDept = new Map();
  for (const n of candidate.nodes || []) {
    if (n.nodeType !== 'POSITION' || !/trưởng phòng/i.test(n.jobTitle || '')) continue;
    const deptNode = findNearestDeptAncestor(candidate, n);
    const key = deptNode ? deptNode.nodeId : `__root_${n.nodeId}`;
    if (!byDept.has(key)) byDept.set(key, []);
    byDept.get(key).push(n);
  }
  for (const [, nodesOfDept] of byDept) {
    if (nodesOfDept.length <= 1) continue;
    const withOccupant = nodesOfDept.filter(n => resolvePositionOccupants(candidate, n, users).length > 0);
    if (withOccupant.length > 1) {
      const deptNode = findNearestDeptAncestor(candidate, nodesOfDept[0]);
      issues.push(`Phòng "${deptNode?.nodeName || ''}" có nhiều hơn 1 "Trưởng phòng" đang có người giữ — kiểm tra lại cây`);
    }
  }
  return issues;
}

// ===== Seed KPI Flow (auto, chỉ điền chỗ trống — giữ nguyên mọi dòng đã có, kể cả thủ công) =====
function seedKpiFlowGaps(version) {
  version.kpiFlow = version.kpiFlow || [];
  const existing = new Set(version.kpiFlow.map(f => `${f.evaluatorNodeId}:${f.evaluateeNodeId}`));
  const byId = new Map((version.nodes || []).map(n => [n.nodeId, n]));
  let added = 0;
  for (const n of version.nodes || []) {
    if (n.nodeType !== 'POSITION' || n.parentNodeId == null) continue;
    const parent = byId.get(n.parentNodeId);
    if (!parent || parent.nodeType !== 'POSITION') continue;
    const key = `${parent.nodeId}:${n.nodeId}`;
    if (existing.has(key)) continue;
    version.kpiFlow.push({
      id: Date.now() + added, evaluatorNodeId: parent.nodeId, evaluateeNodeId: n.nodeId,
      isAutoFromHierarchy: true, createdBy: 'SYSTEM', createdAt: new Date().toISOString()
    });
    existing.add(key);
    added++;
  }
  return added;
}

// ===== Bootstrap / Clone / Apply =====

function bootstrapFirstVersion(list, versionName, actingUsername) {
  if ((list || []).length) throw new HttpError(400, 'Đã có phiên bản cơ cấu tổ chức — dùng chức năng "Tạo bản nháp mới" thay vì khởi tạo lại');
  const version = {
    id: Date.now(), versionName: versionName || 'Cơ cấu tổ chức', status: 'DRAFT',
    effectiveDate: null, clonedFromVersionId: null,
    nodes: [{ nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', departmentRef: null, jobTitle: null, requiresDept: null, posType: null, positionKey: null, displayOrder: 0 }],
    kpiFlow: [], createdBy: actingUsername, createdAt: new Date().toISOString(), appliedBy: null, appliedAt: null
  };
  return version;
}

function cloneVersion(list, sourceVersionId, versionName, actingUsername) {
  const source = requireVersion(list, sourceVersionId);
  return {
    id: Date.now(), versionName: versionName || `${source.versionName} (bản sao)`, status: 'DRAFT',
    effectiveDate: null, clonedFromVersionId: source.id,
    nodes: deepClone(source.nodes || []), kpiFlow: deepClone(source.kpiFlow || []),
    createdBy: actingUsername, createdAt: new Date().toISOString(), appliedBy: null, appliedAt: null
  };
}

// Áp dụng 1 version DRAFT: validate lại LẦN CUỐI (phòng thủ — client đã gọi /validate trước, nhưng dữ
// liệu users/version có thể đã đổi giữa 2 lượt gọi), lưu trữ version đang APPLIED (nếu có) -> ARCHIVED,
// version này -> APPLIED, seed kpiFlow còn thiếu. KHÔNG tính lại managerUsername ở đây (cần khoá riêng
// bảng "users" — xem computeManagerUsernameUpdates() + route gọi 2 bước ở routes/orgChart.js).
function applyVersionInPlace(list, versionId, users, actingUsername) {
  const version = requireVersion(list, versionId);
  requireDraft(version);
  const applied = getAppliedVersion(list);
  const issues = computeValidationIssues(version, applied, users);
  if (issues.length) throw new HttpError(400, `Không thể áp dụng — còn lỗi cần xử lý: ${issues.join(' | ')}`);
  if (applied) applied.status = 'ARCHIVED';
  version.status = 'APPLIED';
  version.effectiveDate = new Date().toISOString().slice(0, 10);
  version.appliedBy = actingUsername;
  version.appliedAt = new Date().toISOString();
  seedKpiFlowGaps(version);
  return version;
}

// Tính danh sách managerUsername mới cho TỪNG user active, dựa theo node CHA của vị trí họ đang giữ
// trong `appliedVersion`. Trả { changes: [{username, managerUsername}], unresolved: [{username,name,reason}] }
// — "unresolved" là các trường hợp KHÔNG tự tin gán được (0 hoặc >1 người giữ đúng vị trí cha), giữ
// nguyên managerUsername hiện tại của họ, KHÔNG suy đoán bừa.
function computeManagerUsernameUpdates(appliedVersion, users) {
  const byId = new Map((appliedVersion.nodes || []).map(n => [n.nodeId, n]));
  const changes = [];
  const unresolved = [];
  for (const u of users || []) {
    if (u.active === false) continue;
    const node = findPositionNodeForUser(appliedVersion, u);
    if (!node || node.parentNodeId == null) continue; // không khớp vị trí nào trong cây, hoặc là gốc -> bỏ qua, giữ nguyên
    const parent = byId.get(node.parentNodeId);
    if (!parent || parent.nodeType !== 'POSITION') continue; // cha không phải 1 vị trí (VD phòng ban gộp) -> không suy ra được người cụ thể
    const occupants = resolvePositionOccupants(appliedVersion, parent, users).filter(o => o.username !== u.username);
    if (occupants.length !== 1) {
      unresolved.push({ username: u.username, name: u.name, reason: occupants.length === 0 ? 'Chưa có ai giữ vị trí quản lý cấp trên' : 'Có nhiều hơn 1 người cùng giữ vị trí quản lý cấp trên' });
      continue;
    }
    if (u.managerUsername !== occupants[0].username) changes.push({ username: u.username, managerUsername: occupants[0].username });
  }
  return { changes, unresolved };
}

function applyManagerUsernameUpdates(currentUsers, changes) {
  if (!changes.length) return currentUsers;
  const byUsername = new Map(currentUsers.map(u => [u.username, u]));
  for (const c of changes) {
    const target = byUsername.get(c.username);
    if (target) target.managerUsername = c.managerUsername;
  }
  assertNoManagerCycle(currentUsers); // phòng thủ — cấu trúc cây vốn phi chu trình nên về lý thuyết không xảy ra
  return currentUsers;
}

// ===== KPI Evaluation Flow (chỉ thao tác trên version đang APPLIED) =====

function addKpiFlowRow(appliedVersion, evaluatorNodeId, evaluateeNodeId, actingUsername) {
  const byId = new Map((appliedVersion.nodes || []).map(n => [n.nodeId, n]));
  const evaluator = byId.get(evaluatorNodeId);
  const evaluatee = byId.get(evaluateeNodeId);
  if (!evaluator || evaluator.nodeType !== 'POSITION') throw new HttpError(400, 'Không tìm thấy vị trí đánh giá');
  if (!evaluatee || evaluatee.nodeType !== 'POSITION') throw new HttpError(400, 'Không tìm thấy vị trí được đánh giá');
  if (evaluatorNodeId === evaluateeNodeId) throw new HttpError(400, 'Vị trí không thể tự đánh giá chính mình');
  appliedVersion.kpiFlow = appliedVersion.kpiFlow || [];
  if (appliedVersion.kpiFlow.some(f => f.evaluatorNodeId === evaluatorNodeId && f.evaluateeNodeId === evaluateeNodeId)) {
    throw new HttpError(400, 'Quan hệ đánh giá này đã tồn tại');
  }
  const row = { id: Date.now(), evaluatorNodeId, evaluateeNodeId, isAutoFromHierarchy: false, createdBy: actingUsername, createdAt: new Date().toISOString() };
  appliedVersion.kpiFlow.push(row);
  return row;
}

function removeKpiFlowRow(appliedVersion, flowRowId) {
  const before = (appliedVersion.kpiFlow || []).length;
  appliedVersion.kpiFlow = (appliedVersion.kpiFlow || []).filter(f => f.id !== flowRowId);
  if (appliedVersion.kpiFlow.length === before) throw new HttpError(404, 'Không tìm thấy quan hệ đánh giá này');
}

// Tra cứu ĐẦY ĐỦ "ai hiện đánh giá KPI cho user này" theo version đang APPLIED — thay resolveKpiEvaluatorForUser()
// bản cũ (dept×jobTitle map phẳng): giờ tra theo ĐÚNG node vị trí + kpiFlow (hỗ trợ ma trận nhiều người
// đánh giá 1 vị trí, và các quan hệ thủ công không theo cây báo cáo hành chính).
function resolveKpiEvaluatorsForUser(appliedVersion, user, users) {
  if (!appliedVersion) return null;
  const node = findPositionNodeForUser(appliedVersion, user);
  if (!node) return null;
  const byId = new Map((appliedVersion.nodes || []).map(n => [n.nodeId, n]));
  const rows = (appliedVersion.kpiFlow || []).filter(f => f.evaluateeNodeId === node.nodeId);
  const evaluatorGroups = rows.map(row => {
    const evalNode = byId.get(row.evaluatorNodeId);
    return {
      positionName: evalNode ? buildNodeDisplayName(appliedVersion, evalNode) : '',
      isAutoFromHierarchy: row.isAutoFromHierarchy,
      evaluators: evalNode ? resolvePositionOccupants(appliedVersion, evalNode, users) : []
    };
  });
  return { positionName: buildNodeDisplayName(appliedVersion, node), evaluatorGroups };
}

// So sánh 2 version (dùng cho màn xem 1 bản ARCHIVED — "So sánh với bản đang áp dụng") — so theo
// positionKey (POSITION) / (parentNodeId cũ có thể lệch số nhưng ta chỉ so sánh CÙNG 1 cây theo id nếu
// clone giữ nguyên nodeId; với 2 version bất kỳ không có quan hệ clone trực tiếp, so theo tên hiển thị
// là đủ dùng cho mục đích xem nhanh, không cần chính xác tuyệt đối).
function diffVersions(base, other) {
  const baseByKey = new Map((base.nodes || []).map(n => [n.positionKey || `name:${n.nodeName}:${n.parentNodeId}`, n]));
  const otherByKey = new Map((other.nodes || []).map(n => [n.positionKey || `name:${n.nodeName}:${n.parentNodeId}`, n]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, n] of otherByKey) {
    if (!baseByKey.has(key)) added.push(buildNodeDisplayName(other, n));
  }
  for (const [key, n] of baseByKey) {
    if (!otherByKey.has(key)) removed.push(buildNodeDisplayName(base, n));
  }
  for (const [key, n] of otherByKey) {
    const b = baseByKey.get(key);
    if (!b) continue;
    const nameA = buildNodeDisplayName(base, b);
    const nameB = buildNodeDisplayName(other, n);
    if (nameA !== nameB || b.parentNodeId !== n.parentNodeId) changed.push(`${nameA} -> ${nameB}`);
  }
  return { added, removed, changed };
}

// PHÁT HIỆN THIẾU ở đợt audit chuyên sâu lần 2: đổi tên phòng ban/siêu thị/chức danh ở Danh Mục (Quản
// Trị > Đổi Tên Danh Mục) trước đây KHÔNG cascade sang orgChartVersions[].nodes[].departmentRef/
// .jobTitle — cây tổ chức vẫn hiển thị/so khớp "ai đang giữ vị trí" (resolvePositionOccupants(), dựa vào
// user.dept/user.jobTitle) theo TÊN CŨ cho tới khi admin tự tay sửa lại từng node. Cascade CẢ MỌI
// version (không chỉ version đang áp dụng) vì admin có thể quay lại dùng tiếp 1 version cũ sau này. Gọi
// từ lib/catalogRename.js — 2 hàm THUẦN (không tự khoá/đọc AppData) để giữ đúng quy ước của file này
// (mọi thao tác ghi AppData đều do routes/orgChart.js hoặc caller tự bọc withLockedAppDataValue).
function renameDepartmentRefInAllVersions(versions, oldValue, newValue) {
  return (versions || []).map(v => ({
    ...v,
    nodes: (v.nodes || []).map(n => (n.departmentRef === oldValue ? { ...n, departmentRef: newValue } : n))
  }));
}

// isStore=false -> jobTitles (Khối Văn Phòng, node.posType !== 'STORE', khớp đúng luật cascadeJobTitleRename()
// ở lib/catalogRename.js); isStore=true -> storeJobTitles (Siêu Thị, node.posType === 'STORE').
function renameJobTitleInAllVersions(versions, oldValue, newValue, isStore) {
  return (versions || []).map(v => ({
    ...v,
    nodes: (v.nodes || []).map(n => {
      const matchesScope = isStore ? n.posType === 'STORE' : n.posType !== 'STORE';
      return (n.jobTitle === oldValue && matchesScope) ? { ...n, jobTitle: newValue } : n;
    })
  }));
}

module.exports = {
  findVersion, getAppliedVersion, requireVersion, requireDraft,
  buildNodeDisplayName, findNearestDeptAncestor, resolvePositionOccupants, findPositionNodeForUser,
  addNode, editNode, deleteNodeCascade,
  computeValidationIssues, seedKpiFlowGaps,
  bootstrapFirstVersion, cloneVersion, applyVersionInPlace,
  computeManagerUsernameUpdates, applyManagerUsernameUpdates,
  addKpiFlowRow, removeKpiFlowRow, resolveKpiEvaluatorsForUser, diffVersions,
  renameDepartmentRefInAllVersions, renameJobTitleInAllVersions
};
