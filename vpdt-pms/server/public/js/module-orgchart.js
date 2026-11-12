// ==========================================
// 🌳 NHÂN SỰ — Cơ Cấu Tổ Chức v2 (cây có VERSIONING) + Cấu Hình Luồng Đánh Giá KPI Theo Vị Trí
// ==========================================
// Thay HẲN bản v1 (module-hcrcdonghanh.js — cây suy từ user.managerUsername, sửa qua picker/Excel-
// import, không lịch sử + DB.kpiEvaluatorConfig map phẳng dept×jobTitle) theo tài liệu thiết kế mới.
// Toàn bộ dữ liệu KHÔNG nằm sẵn trong DB.* (không giống các module khác) — luôn gọi API riêng
// routes/orgChart.js (xem lib/orgChart.js phía server để biết đầy đủ lý do điều chỉnh so với tài liệu
// gốc, VD KHÔNG dựng bảng Positions/PositionAssignments-có-lịch-sử, "ai giữ 1 vị trí" tra ĐỘNG theo
// dept+jobTitle hiện tại thay vì bảng gán người riêng).
//
// State module (KHÔNG lưu ở DB.*, chỉ giữ tạm trong phiên xem hiện tại):
//   _ocVersions        : mảng nhẹ [{id,versionName,status,...}] — GET /api/org-chart/versions
//   _ocCurrentVersion  : version ĐẦY ĐỦ (nodes+kpiFlow) đang được CHỌN xem trên dropdown
//   _ocAppliedVersion  : version ĐANG ÁP DỤNG đầy đủ (cache riêng — Tab KPI Flow luôn thao tác trên
//                        version này, KHÔNG phải version đang chọn xem ở dropdown, có thể khác nhau)
let _ocVersions = [];
let _ocCurrentVersion = null;
let _ocAppliedVersion = null;
let activeOrgChartSubTab = 'TREE';
let orgChartNodeModalMode = null; // 'ADD' | 'EDIT'
let orgChartNodeModalParentId = null;
let orgChartNodeModalEditingId = null;
// _ocDiagramNodes (11/2026): cây Phòng Ban/Siêu Thị RIÊNG cho tab "🖼️ Cây Sơ Đồ Tổ Chức" — mảng phẳng
// {id, parentNodeId, nodeName} từ GET /api/org-chart/diagram-nodes, HOÀN TOÀN TÁCH BIỆT khỏi
// _ocCurrentVersion.nodes (không versioning/DRAFT/APPLIED, sửa là lưu ngay).
let _ocDiagramNodes = [];

async function orgChartApiCall(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    throw new Error('Không thể kết nối tới máy chủ: ' + e.message);
  }
  if (res.status === 401) { handleSessionExpired(); throw new Error('Phiên đăng nhập đã hết hạn'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Có lỗi xảy ra');
  return json;
}

// ===== Khởi động module khi vào tab "Cơ Cấu Tổ Chức" (renderOrgChartModule(), gọi từ core.js
// _dispatchTabRender()) — luôn tải LẠI danh sách version mới nhất từ server (không cache lâu dài, dữ
// liệu do nhiều admin cùng sửa). =====
async function renderOrgChartModule() {
  // LỖI ĐÃ VÁ (rà soát chuyên sâu 10/2026, cùng lỗi vừa phát hiện ở Onboarding — module-hrlifecycle.js):
  // ô "🔍 Tra Cứu Người Đánh Giá Theo Nhân Viên" (orgChartKpiLookupInput) dùng chung #systemUsersDatalist
  // nhưng module này CHƯA TỪNG gọi populateSystemUsersDatalist() ở đâu cả — nếu Cơ Cấu Tổ Chức là module
  // ĐẦU TIÊN trong phiên chạm tới datalist dùng chung này, ô tìm kiếm trống ngay lần bấm đầu.
  populateSystemUsersDatalist();
  let data;
  try {
    data = await orgChartApiCall('GET', '/api/org-chart/versions');
  } catch (err) {
    document.getElementById('orgChartTreeContainer').innerHTML = `<p class="text-xs text-red-600">⛔ ${escapeHtml(err.message)}</p>`;
    return;
  }
  _ocVersions = data.versions || [];

  const bootstrapWrap = document.getElementById('orgChartBootstrapWrap');
  const versionBarWrap = document.getElementById('orgChartVersionBarWrap');
  const subTabsWrap = document.getElementById('orgChartSubTabsWrap');
  if (!_ocVersions.length) {
    bootstrapWrap.classList.remove('hidden');
    versionBarWrap.classList.add('hidden');
    subTabsWrap.classList.add('hidden');
    document.getElementById('orgChartTreeView').classList.add('hidden');
    document.getElementById('orgChartKpiView').classList.add('hidden');
    return;
  }
  bootstrapWrap.classList.add('hidden');
  versionBarWrap.classList.remove('hidden');
  subTabsWrap.classList.remove('hidden');

  // KHÔNG còn admin bypass (11/2026, mở rộng "Nhân Sự" — xem canManageHrFeedback() ở lib/recordActions.js).
  const canManageTree = !!(currentUser.perms?.orgChartManage);
  document.getElementById('btnOrgChartCreateDraft').classList.toggle('hidden', !canManageTree);
  document.getElementById('btnOrgChartCreateBlank').classList.toggle('hidden', !canManageTree);
  // "🗑️ Xoá Tất Cả Bản Nháp" (11/2026) — hiện khi có >=1 bản Nháp BẤT KỲ trong toàn danh sách (không
  // phụ thuộc bản đang xem như nút "Xoá Bản Nháp Này" ở loadOrgChartCurrentVersion()).
  document.getElementById('btnOrgChartDeleteAllDrafts').classList.toggle('hidden', !(canManageTree && _ocVersions.some(v => v.status === 'DRAFT')));

  populateOrgChartVersionSelect();
  const appliedMeta = _ocVersions.find(v => v.status === 'APPLIED');
  if (appliedMeta) {
    try { _ocAppliedVersion = (await orgChartApiCall('GET', `/api/org-chart/versions/${appliedMeta.id}`)).version; }
    catch (e) { _ocAppliedVersion = null; }
  } else {
    _ocAppliedVersion = null;
  }

  const select = document.getElementById('orgChartVersionSelect');
  const wantId = select.value ? Number(select.value) : (appliedMeta ? appliedMeta.id : _ocVersions[0].id);
  select.value = String(wantId);
  await loadOrgChartCurrentVersion(wantId);
  setOrgChartSubTab(activeOrgChartSubTab);
}

function populateOrgChartVersionSelect() {
  const select = document.getElementById('orgChartVersionSelect');
  const STATUS_LABEL = { DRAFT: '📝 Nháp', APPLIED: '✅ Đang áp dụng', ARCHIVED: '🗄️ Lưu trữ' };
  const current = select.value;
  select.innerHTML = _ocVersions
    .slice()
    .sort((a, b) => (a.status === 'APPLIED' ? -1 : b.status === 'APPLIED' ? 1 : b.id - a.id))
    .map(v => `<option value="${v.id}">${STATUS_LABEL[v.status] || v.status} — ${escapeHtml(v.versionName)}</option>`)
    .join('');
  if ([...select.options].some(o => o.value === current)) select.value = current;
}

async function onOrgChartVersionSelectChange() {
  const id = Number(document.getElementById('orgChartVersionSelect').value);
  await loadOrgChartCurrentVersion(id);
  setOrgChartSubTab(activeOrgChartSubTab);
}

async function loadOrgChartCurrentVersion(id) {
  try {
    _ocCurrentVersion = (await orgChartApiCall('GET', `/api/org-chart/versions/${id}`)).version;
  } catch (err) {
    alert(`⛔ ${err.message}`);
    return;
  }
  // KHÔNG còn admin bypass (11/2026, mở rộng "Nhân Sự" — xem canManageHrFeedback() ở lib/recordActions.js).
  const canManageTree = !!(currentUser.perms?.orgChartManage);
  const isDraft = _ocCurrentVersion.status === 'DRAFT';
  const isArchived = _ocCurrentVersion.status === 'ARCHIVED';
  document.getElementById('btnOrgChartRenameVersion').classList.toggle('hidden', !(isDraft && canManageTree));
  document.getElementById('btnOrgChartValidateVersion').classList.toggle('hidden', !(isDraft && canManageTree));
  document.getElementById('btnOrgChartApplyVersion').classList.toggle('hidden', !(isDraft && canManageTree));
  // Nút "✏️ Sửa Bản Đang Áp Dụng" + "✅ Áp Dụng (Giữ Nguyên Ngày)" (10/2026) — xem editAppliedOrgChartVersionClick()/
  // applyOrgChartVersionClick() + lib/orgChart.js::applyVersionInPlace() cho đầy đủ ngữ cảnh. Nút Sửa chỉ hiện khi
  // ĐANG XEM đúng version APPLIED (lối tắt tạo nháp từ đó); nút Áp Dụng Giữ Nguyên Ngày chỉ hiện khi bản nháp đang
  // xem được clone TRỰC TIẾP từ đúng version APPLIED hiện tại (clonedFromVersionId khớp) — nháp tạo kiểu khác (VD
  // nháp mới từ đầu, hoặc nháp đã lỡ clone từ 1 bản cũ hơn) vẫn chỉ thấy nút Áp Dụng thường (luôn đóng dấu ngày mới).
  const appliedMeta = _ocVersions.find(v => v.status === 'APPLIED');
  document.getElementById('btnOrgChartEditApplied').classList.toggle('hidden', !(_ocCurrentVersion.status === 'APPLIED' && canManageTree));
  document.getElementById('btnOrgChartApplyVersionKeepDate').classList.toggle('hidden', !(isDraft && canManageTree && appliedMeta && _ocCurrentVersion.clonedFromVersionId === appliedMeta.id));
  // LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): trước đây không có cách nào xoá bản nháp không dùng
  // nữa — chỉ hiện với DRAFT (khớp deleteVersion() ở lib/orgChart.js, APPLIED/ARCHIVED phải giữ lịch sử).
  document.getElementById('btnOrgChartDeleteVersion').classList.toggle('hidden', !(isDraft && canManageTree));
  // Xoá VĨNH VIỄN bản Lưu Trữ (10/2026, theo yêu cầu người dùng "lỡ Áp Dụng nhầm, muốn xoá hẳn tránh rác
  // dữ liệu") — quyền RIÊNG orgChartDeleteArchived, KHÔNG dùng canManageTree (xem lib/orgChart.js::
  // deleteArchivedVersion() + routes/orgChart.js::canDeleteArchived() phía server, đã gác lại đúng y hệt).
  document.getElementById('btnOrgChartDeleteArchivedVersion').classList.toggle('hidden', !(isArchived && currentUser.perms?.orgChartDeleteArchived));
  // Xuất Excel (10/2026) — luôn hiện cho ai xem được version (requireView() phía server), xuất ĐÚNG
  // version đang mở ở dropdown (không chỉ APPLIED). Nhập Excel chỉ HR/admin quản lý cây (canManageTree).
  document.getElementById('btnOrgChartExportXlsx').href = `/api/org-chart/versions/${id}/export-xlsx`;
  document.getElementById('btnOrgChartImportExcel').classList.toggle('hidden', !canManageTree);
  document.getElementById('btnOrgChartCompareVersion').classList.toggle('hidden', !(isArchived && _ocAppliedVersion));
  // Đợt 4 (vá gap #2 Phần A/B) — chỉ hiện khi đang xem ĐÚNG version APPLIED (nút thao tác trên chính
  // version đang xem, cùng logic isDraft/isArchived ở trên).
  document.getElementById('btnOrgChartRecomputeManagerUsernames').classList.toggle('hidden', !(_ocCurrentVersion.status === 'APPLIED' && canManageTree));
  const metaEl = document.getElementById('orgChartVersionMeta');
  const parts = [];
  if (_ocCurrentVersion.effectiveDate) parts.push(`Áp dụng từ: ${escapeHtml(_ocCurrentVersion.effectiveDate)}`);
  if (_ocCurrentVersion.createdBy) parts.push(`Tạo bởi: ${escapeHtml(_ocCurrentVersion.createdBy)}`);
  metaEl.innerText = parts.join(' — ');
  const badge = document.getElementById('orgChartVersionStatusBadge');
  const BADGE_CLS = { DRAFT: 'bg-gray-200 text-gray-700', APPLIED: 'bg-emerald-100 text-emerald-800', ARCHIVED: 'bg-slate-200 text-slate-600' };
  const BADGE_TXT = { DRAFT: '📝 Nháp — sửa được', APPLIED: '✅ Đang áp dụng', ARCHIVED: '🗄️ Lưu trữ — chỉ xem' };
  badge.className = `text-[11px] font-bold px-2 py-0.5 rounded-full ${BADGE_CLS[_ocCurrentVersion.status] || ''}`;
  badge.innerText = BADGE_TXT[_ocCurrentVersion.status] || _ocCurrentVersion.status;
}

// ===== Sub-tab TREE / DIAGRAM / KPI =====
function setOrgChartSubTab(subTab) {
  // Mục 0 (10/2026): AND thêm checkbox orgChartTree/Diagram/Kpi.
  const canTree = hasModuleAccess(currentUser, 'orgChartTree');
  const canDiagram = hasModuleAccess(currentUser, 'orgChartDiagram');
  const canKpi = hasModuleAccess(currentUser, 'orgChartKpi');
  const ocTabOrder = [['TREE', canTree], ['DIAGRAM', canDiagram], ['KPI', canKpi]];
  const curOcTab = ocTabOrder.find(([k]) => k === subTab);
  if (!curOcTab || !curOcTab[1]) {
    // LỖI ĐÃ VÁ (rà soát v24.74→v24.81, 11/2026, mức Cao — cùng lớp "stuck-fallback" đã vá ở
    // setItSupportSubTab() v24.77): trước đây `|| subTab` GIỮ NGUYÊN tab đang xin mở khi KHÔNG còn
    // sibling nào được phép (cả 3 checkbox orgChartTree/Diagram/Kpi đều bị tắt). Đổi về `null` — NẶNG
    // HƠN 2 nhánh render if/else-if khác (vẫn phải sửa thêm `else` cuối thành `else if` tường minh bên
    // dưới, vì `else` trần trước đây render KPI cho BẤT KỲ giá trị không phải TREE/DIAGRAM, kể cả `null`).
    const fallback = ocTabOrder.find(([, ok]) => ok);
    subTab = fallback ? fallback[0] : null;
  }
  activeOrgChartSubTab = subTab;
  document.getElementById('orgChartTreeView').classList.toggle('hidden', subTab !== 'TREE');
  document.getElementById('orgChartDiagramView').classList.toggle('hidden', subTab !== 'DIAGRAM');
  document.getElementById('orgChartKpiView').classList.toggle('hidden', subTab !== 'KPI');
  const activeCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-teal-700 text-white';
  const inactiveCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700 hover:bg-gray-300';
  document.getElementById('btnOrgChartSubTree').className = (subTab === 'TREE' ? activeCls : inactiveCls) + (canTree ? '' : ' hidden');
  document.getElementById('btnOrgChartSubDiagram').className = (subTab === 'DIAGRAM' ? activeCls : inactiveCls) + (canDiagram ? '' : ' hidden');
  document.getElementById('btnOrgChartSubKpi').className = (subTab === 'KPI' ? activeCls : inactiveCls) + (canKpi ? '' : ' hidden');
  if (subTab === 'TREE') renderOrgChartTree();
  else if (subTab === 'DIAGRAM') renderOrgChartDiagramTab();
  else if (subTab === 'KPI') renderOrgChartKpiFlowTab();
}

// ===== Suy diễn hiển thị/occupant — mirror ĐÚNG lib/orgChart.js (buildNodeDisplayName()/
// findNearestDeptAncestor()/resolvePositionOccupants()) để khỏi gọi API riêng cho từng node khi vẽ cây. =====
function ocFindNearestDeptAncestor(nodes, node) {
  const byId = new Map(nodes.map(n => [n.nodeId, n]));
  let cur = node, steps = 0;
  while (cur && cur.parentNodeId != null && steps < 100) {
    cur = byId.get(cur.parentNodeId);
    if (cur && cur.nodeType === 'DEPARTMENT') return cur;
    steps++;
  }
  return null;
}
function ocBuildNodeDisplayName(nodes, node) {
  if (node.nodeType !== 'POSITION') return node.nodeName;
  if (node.requiresDept === false) return node.jobTitle;
  const deptNode = ocFindNearestDeptAncestor(nodes, node);
  return deptNode ? `${node.jobTitle} ${deptNode.nodeName}` : node.jobTitle;
}
function ocResolvePositionOccupants(nodes, node, users) {
  if (!node || node.nodeType !== 'POSITION') return [];
  const deptNode = node.requiresDept !== false ? ocFindNearestDeptAncestor(nodes, node) : null;
  const deptRef = deptNode?.departmentRef || null;
  return (users || []).filter(u => {
    if (u.active === false) return false;
    if (u.jobTitle !== node.jobTitle) return false;
    if (node.requiresDept !== false && deptRef && u.dept !== deptRef) return false;
    return true;
  }).map(u => ({ username: u.username, name: u.name }));
}

// ===== Vẽ cây =====
function renderOrgChartTree() {
  const container = document.getElementById('orgChartTreeContainer');
  const version = _ocCurrentVersion;
  if (!version) { container.innerHTML = ''; return; }
  // KHÔNG còn admin bypass (11/2026, mở rộng "Nhân Sự" — xem canManageHrFeedback() ở lib/recordActions.js).
  const canEdit = version.status === 'DRAFT' && !!(currentUser.perms?.orgChartManage);
  const nodes = version.nodes || [];
  const roots = nodes.filter(n => n.parentNodeId == null).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  if (!roots.length) { container.innerHTML = '<p class="text-xs text-gray-400 italic">Cây trống.</p>'; return; }
  container.innerHTML = roots.map(n => ocBuildTreeNodeHtml(nodes, n, 0, canEdit, version)).join('');
}
function ocBuildTreeNodeHtml(nodes, node, depth, canEdit, version) {
  const indent = '&nbsp;'.repeat(depth * 4) + (depth > 0 ? '↳ ' : '');
  const icon = node.nodeType === 'COMPANY' ? '🏢' : node.nodeType === 'DEPARTMENT' ? '📁' : '💺';
  const label = ocBuildNodeDisplayName(nodes, node);
  let occupantsHtml = '';
  if (node.nodeType === 'POSITION' && (version.status === 'APPLIED' || version.status === 'ARCHIVED')) {
    const occ = ocResolvePositionOccupants(nodes, node, DB.users);
    occupantsHtml = occ.length
      ? ` <span class="text-[10px] text-teal-700">— ${occ.map(o => escapeHtml(o.name)).join(', ')}</span>`
      : ' <span class="text-[10px] text-amber-600">— chưa có ai giữ</span>';
  }
  const actions = canEdit ? `
    <button type="button" data-op="openOrgChartAddNodeModal" data-arg0="${node.nodeId}" class="text-[11px] px-1.5 py-0.5 bg-gray-200 rounded font-bold hover:bg-gray-300 ml-1">+ Thêm nhánh con</button>
    <button type="button" data-op="openOrgChartEditNodeModal" data-arg0="${node.nodeId}" class="text-[11px] px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded font-bold hover:bg-blue-200 ml-1">✏️ Sửa</button>
    <button type="button" data-op="deleteOrgChartNodeClick" data-arg0="${node.nodeId}" class="text-[11px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-bold hover:bg-red-200 ml-1">🗑️ Xoá</button>` : '';
  let html = `<div class="py-1 border-b border-gray-100 flex items-center flex-wrap gap-1">
    <span>${indent}${icon} <strong>${escapeHtml(label)}</strong>${occupantsHtml}</span>
    ${actions}
  </div>`;
  const children = nodes.filter(n => n.parentNodeId === node.nodeId).sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  children.forEach(c => { html += ocBuildTreeNodeHtml(nodes, c, depth + 1, canEdit, version); });
  return html;
}

// ===== "🖼️ Cây Sơ Đồ Tổ Chức" (11/2026, theo yêu cầu người dùng "tách cơ cấu tổ chức ra khỏi định
// biên" — demo đã xác nhận) — vẽ sơ đồ hình ảnh từ CÂY PHÒNG BAN/SIÊU THỊ RIÊNG (_ocDiagramNodes, xem
// loadOrgChartDiagramNodes()/lib/orgChartDiagramTree.js), HOÀN TOÀN TÁCH BIỆT khỏi orgChartVersions[].
// nodes (tab "🧩 Định Biên Nhân Sự") — không có khái niệm COMPANY/POSITION/định biên ở đây, mọi node
// đều là Phòng Ban/Siêu Thị cùng kiểu, có thể có NHIỀU node gốc song song (parentNodeId=null, vẽ thành
// rừng cây cạnh nhau, không bắt buộc đúng 1 "Công Ty" như cây Định Biên). SVG dựng bằng CHUỖI HTML nội
// suy (mirror renderNVFlow()/nvRoundedNode() ở module-nghiepvu.js — màu tô qua thuộc tính fill/stroke
// trực tiếp trên thẻ SVG, KHÔNG phải style="..." nên không vướng CSP style-src) thay vì createElementNS(),
// khớp đúng quy ước SVG duy nhất đã có sẵn trong toàn bộ client.
function ocBuildDiagramForest(nodesFlat) {
  const list = nodesFlat || [];
  const byTreeId = new Map(list.map(n => [n.id, { id: n.id, type: 'DEPARTMENT', name: n.nodeName, orientation: n.orientation === 'vertical' ? 'vertical' : 'horizontal', children: [] }]));
  const roots = [];
  list.forEach(n => {
    const treeNode = byTreeId.get(n.id);
    if (n.parentNodeId == null || !byTreeId.has(n.parentNodeId)) { roots.push(treeNode); return; }
    byTreeId.get(n.parentNodeId).children.push(treeNode);
  });
  return roots;
}

const OC_DIAGRAM_MARGIN = 40;
const OC_DIAGRAM_FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif"; // KHÔNG dùng web font — canvas
// rasterize SVG lúc xuất PNG không chắc tải được font ngoài (xem downloadOrgChartDiagramPng()).

// orientation (11/2026, theo yêu cầu người dùng "nhiều sơ đồ cần quay dọc mới đủ chỗ") — 'horizontal'
// (mặc định, khối nằm ngang, chữ đọc xuôi — hành vi gốc) hoặc 'vertical' (khối hẹp lại xếp được nhiều
// Phòng Ban cạnh nhau hơn trên cùng 1 hàng, CHỮ XOAY 90° đọc dọc theo chiều cao khối — dùng khi 1 cấp có
// quá nhiều Phòng Ban con khiến sơ đồ ngang quá rộng). Hằng số kích thước TÁCH RIÊNG 2 bộ (ngang/dọc)
// thay vì cố tính chung 1 công thức — 2 chiều có logic co giãn khung hoàn toàn khác nhau (ngang: khung
// RỘNG cố định, co chiều CAO theo số dòng xuống dòng; dọc: khung CAO co theo độ dài tên — không xuống
// dòng vì chữ đã xoay dọc theo đúng chiều "dài" của khung).
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo "chọn Ngang/Dọc đang áp dụng cho CẢ sơ đồ, chỉ muốn áp dụng đúng
// Phòng Ban đang thêm/sửa"): trước đây có 1 biến `_ocDiagramOrientation` TOÀN CỤC + nút "Chiều khối" duy
// nhất ở toolbar, đổi là đổi NGUYÊN sơ đồ. Giờ orientation LƯU THEO TỪNG NODE (`node.orientation`, xem
// lib/orgChartDiagramTree.js) — node tạo trước đợt sửa này chưa có field, coi như Ngang (khớp hành vi
// gốc). Mọi hàm layout/vẽ bên dưới đọc `node.orientation` thay vì biến global.
function ocNodeIsVertical(node) { return node?.orientation === 'vertical'; }

// Bộ hằng số NGANG (giữ nguyên hành vi gốc trước 11/2026).
const OC_DIAGRAM_H_SLOT_W = 196, OC_DIAGRAM_H_LEVEL_H = 118;
const OC_DIAGRAM_H_BOX_W = 178, OC_DIAGRAM_H_BOX_H = 50;
const OC_DIAGRAM_H_EXTRA_LINE_H = 16, OC_DIAGRAM_H_TEXT_PAD_X = 12, OC_DIAGRAM_H_ICON_CHARS = 2.5;

// Bộ hằng số DỌC (MỚI) — khung hẹp (OC_DIAGRAM_V_BOX_W) + CAO tối đa OC_DIAGRAM_V_MAX_H, chữ LUÔN 1
// dòng (xoay 90°, không xuống dòng — chiều cao khung co giãn thay cho việc xuống dòng), cắt "…" nếu tên
// vẫn dài hơn ngân sách ký tự ở chiều cao tối đa. Khoảng cách cấp (LEVEL_H) phải đủ lớn chứa khung cao
// nhất + đường nối, khoảng cách anh em (SLOT_W) hẹp lại nhiều so với ngang — đúng mục đích "xếp được
// nhiều Phòng Ban hơn trên 1 hàng".
const OC_DIAGRAM_V_SLOT_W = 66, OC_DIAGRAM_V_LEVEL_H = 300;
const OC_DIAGRAM_V_BOX_W = 46, OC_DIAGRAM_V_MIN_H = 80, OC_DIAGRAM_V_MAX_H = 260, OC_DIAGRAM_V_PAD_Y = 16;

function ocNodeSlotW(node) { return ocNodeIsVertical(node) ? OC_DIAGRAM_V_SLOT_W : OC_DIAGRAM_H_SLOT_W; }
function ocNodeBoxWidth(node) { return ocNodeIsVertical(node) ? OC_DIAGRAM_V_BOX_W : OC_DIAGRAM_H_BOX_W; }

// LỖI ĐÃ VÁ (người dùng báo "chữ tràn ra ngoài ô" — tên Phòng Ban dài như "BAN VẬN HÀNH KINH DOANH"
// tràn hẳn ra ngoài khung `rect` vì trước đây tên luôn vẽ 1 dòng `text-anchor="middle"` không kiểm tra
// độ dài, còn `rect` lại có width CỐ ĐỊNH theo loại node (OC_DIAGRAM_BOX_W). Cùng kỹ thuật xuống dòng
// theo SỐ KÝ TỰ ước lượng (không dùng canvas.measureText() — mirror nvWrapLines()/nvRoundedNode() ở
// module-nghiepvu.js NHƯNG viết LẠI riêng ở đây thay vì gọi thẳng hàm bên đó, vì 2 module được tải lười
// theo nhóm riêng (loadModuleGroup()) — không đảm bảo module-nghiepvu.js đã nạp khi sơ đồ này chạy) —
// tối đa 2 dòng, dòng 2 cắt bớt + "…" nếu vẫn còn quá dài, GIỐNG HỆT quy tắc nvWrapLines(). Số ký tự tối
// đa mỗi dòng ước lượng từ độ rộng ký tự trung bình của Arial 700 (bold) tại đúng cỡ chữ đang dùng —
// hệ số 7.6 tự đo bằng ảnh chụp thật (xem test-orgchart-diagram-textfit.js), KHÔNG suy đoán tay.
function ocWrapLines(text, maxChars) {
  if (!text) return [];
  const words = String(text).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (next.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) {
    lines[1] = lines[1].slice(0, Math.max(0, maxChars - 1)).replace(/\s+\S*$/, '') + '…';
    return lines.slice(0, 2);
  }
  return lines;
}
// Chiều rộng ký tự trung bình đo thật (Arial Bold): ~0.62 × cỡ chữ cho chữ hoa/số tiếng Việt thường gặp
// trong tên Phòng Ban (VIẾT HOA chiếm phần lớn) — nhân biên an toàn 8% (0.67) để KHÔNG lạc quan quá,
// tránh vẫn tràn nhẹ ở vài từ có nhiều ký tự rộng (M/W/Ô/Ư).
function ocEstimateMaxChars(boxWidth, fontSize, paddingX) {
  const avgCharW = fontSize * 0.67;
  return Math.max(4, Math.floor((boxWidth - paddingX * 2) / avgCharW));
}

// Gán _depth + _x (post-order: con trước, cha = trung điểm con) — KHÔNG gán _y ở đây nữa (xem
// ocComputeDepthY() bên dưới, tách riêng vì khoảng cách cấp giờ phụ thuộc chiều Ngang/Dọc của từng node
// ở 2 cấp liền kề, phải quét HẾT cây mới biết, không gán được ngay lúc duyệt depth-first này).
function ocDiagramAssignDepthAndX(node, depth, cursorRef) {
  node._depth = depth;
  if (!node.children.length) {
    const slotW = ocNodeSlotW(node);
    node._x = cursorRef.x + slotW / 2;
    cursorRef.x += slotW;
    return;
  }
  node.children.forEach(c => ocDiagramAssignDepthAndX(c, depth + 1, cursorRef));
  const first = node.children[0], last = node.children[node.children.length - 1];
  node._x = (first._x + last._x) / 2;
}

// depthY[d] = toạ độ Y chung cho MỌI node ở cấp d. Khoảng cách cấp d-1→d phải đủ RỘNG cho chiều "khó"
// nhất trong 2 cấp liền kề — chỉ cần 1 node Dọc ở cấp d-1 HOẶC d là phải dùng khoảng cách kiểu Dọc
// (OC_DIAGRAM_V_LEVEL_H, rộng hơn hẳn Ngang) để khung Dọc (cao hơn) không đè lên hàng kế — xem
// verticalAtDepth[]. Trả kèm verticalAtDepth để ocRenderDiagramForest() tính chiều cao ảnh cuối cùng.
function ocComputeDepthY(roots, maxDepth) {
  const verticalAtDepth = new Array(maxDepth + 1).fill(false);
  roots.forEach(root => {
    (function scan(n) {
      if (ocNodeIsVertical(n)) verticalAtDepth[n._depth] = true;
      n.children.forEach(scan);
    })(root);
  });
  const depthY = new Array(maxDepth + 1).fill(0);
  depthY[0] = OC_DIAGRAM_MARGIN;
  for (let d = 1; d <= maxDepth; d++) {
    const gap = (verticalAtDepth[d - 1] || verticalAtDepth[d]) ? OC_DIAGRAM_V_LEVEL_H : OC_DIAGRAM_H_LEVEL_H;
    depthY[d] = depthY[d - 1] + gap;
  }
  return { depthY, verticalAtDepth };
}

// Tính node._nameLines + node._h — NHÁNH NGANG: xuống dòng tối đa 2 dòng theo khung rộng cố định (hành
// vi gốc). NHÁNH DỌC (MỚI): LUÔN 1 dòng (chữ xoay 90° đọc dọc theo chiều cao khung, "xuống dòng" không
// còn ý nghĩa vì chữ không còn nằm ngang) — chiều cao khung co giãn theo ĐÚNG độ dài tên (ước lượng cùng
// công thức ký tự trung bình như nhánh ngang, chỉ đổi vai trò "khung rộng cố định, đo xem mấy dòng" ->
// "khung cao co giãn theo đúng 1 dòng dài bao nhiêu"), cắt "…" nếu vượt quá OC_DIAGRAM_V_MAX_H.
function ocPrepareNodeLines(node) {
  if (ocNodeIsVertical(node)) {
    const fontSize = 12.5;
    const avgCharH = fontSize * 0.67;
    const maxChars = Math.max(3, Math.floor((OC_DIAGRAM_V_MAX_H - OC_DIAGRAM_V_PAD_Y) / avgCharH));
    // LỖI ĐÃ VÁ (phát hiện qua demo thật): .length đếm NHẦM dài hơn hẳn độ dài hiển thị thật cho vài tên
    // Phòng Ban tiếng Việt (VD "BAN VẬN HÀNH KINH DOANH") tuỳ theo chuỗi đó đang ở dạng Unicode TỔ HỢP
    // (NFD — nguyên âm + dấu tách rời, VD "Ậ" = "A" + 2 dấu phụ, .length đếm thành 3 ký tự dù chỉ hiện
    // 1 chữ) hay DỰNG SẴN (NFC — "Ậ" là 1 ký tự duy nhất) — tuỳ nguồn nhập liệu, không kiểm soát được.
    // .normalize('NFC') ép về dạng dựng sẵn trước khi đếm, cho kết quả khớp đúng số ký tự NHÌN THẤY.
    const name = String(node.name || '').normalize('NFC');
    const label = name.length > maxChars ? name.slice(0, maxChars - 1).replace(/\s+\S*$/, '') + '…' : name;
    node._nameLines = [label];
    node._h = Math.round(Math.min(OC_DIAGRAM_V_MAX_H, Math.max(OC_DIAGRAM_V_MIN_H, label.length * avgCharH + OC_DIAGRAM_V_PAD_Y)));
  } else {
    const maxChars = ocEstimateMaxChars(OC_DIAGRAM_H_BOX_W, 12.5, OC_DIAGRAM_H_TEXT_PAD_X) - OC_DIAGRAM_H_ICON_CHARS;
    node._nameLines = ocWrapLines(node.name, maxChars);
    node._h = OC_DIAGRAM_H_BOX_H + Math.max(0, node._nameLines.length - 1) * OC_DIAGRAM_H_EXTRA_LINE_H;
  }
}

// Vẽ RỪNG CÂY (1 hoặc nhiều node gốc song song, xem ocBuildDiagramForest()) — mirror layout/vẽ của
// ocRenderDepartmentDiagram() bản cũ (đã xoá), chỉ khác: (1) nhận MẢNG root thay vì 1 root, cursor X
// chạy chung xuyên suốt mọi cây để các cây gốc không đè lên nhau; (2) MỌI node đều vẽ kiểu DEPARTMENT
// (📁, không còn khái niệm COMPANY/"Trụ sở chính" vì cây này không có node Công Ty); (3) MỖI NODE tự chọn
// chiều Ngang/Dọc RIÊNG (node.orientation, xem ocNodeIsVertical()) — không còn 1 chiều áp dụng chung cho
// cả sơ đồ như trước (LỖI ĐÃ VÁ 11/2026, xem chú thích ở khối orientation phía trên).
function ocRenderDiagramForest(roots) {
  if (!roots || !roots.length) return { svgHTML: '', width: 0, height: 0 };
  const cursor = { x: OC_DIAGRAM_MARGIN };
  roots.forEach(root => ocDiagramAssignDepthAndX(root, 0, cursor));
  let maxDepth = 0, maxX = 0;
  roots.forEach(root => {
    (function scan(n) {
      ocPrepareNodeLines(n);
      maxDepth = Math.max(maxDepth, n._depth);
      maxX = Math.max(maxX, n._x + ocNodeBoxWidth(n) / 2);
      n.children.forEach(scan);
    })(root);
  });
  const { depthY, verticalAtDepth } = ocComputeDepthY(roots, maxDepth);
  roots.forEach(root => {
    (function assignY(n) { n._y = depthY[n._depth]; n.children.forEach(assignY); })(root);
  });
  const width = Math.round(maxX + OC_DIAGRAM_MARGIN);
  // bottomPad: khoảng trống dưới hàng cuối cùng — dùng kiểu khoảng cách của CHÍNH cấp sâu nhất (mirror
  // công thức gốc (maxDepth+1)*levelH cho sơ đồ thuần 1 chiều, xem ocComputeDepthY()).
  const bottomPad = verticalAtDepth[maxDepth] ? OC_DIAGRAM_V_LEVEL_H : OC_DIAGRAM_H_LEVEL_H;
  // extraHByDepth — CHỈ cộng thêm cho node NGANG có nhiều hơn 1 dòng chữ (khung ngang có thể xuống dòng
  // không giới hạn trên) — node DỌC không cần vì OC_DIAGRAM_V_LEVEL_H đã đủ rộng rãi chứa khung cao nhất
  // (OC_DIAGRAM_V_MAX_H) + đường nối (hành vi gốc, giữ nguyên).
  const extraHByDepth = new Array(maxDepth + 1).fill(0);
  roots.forEach(root => {
    (function scanExtra(n) {
      if (!ocNodeIsVertical(n)) extraHByDepth[n._depth] = Math.max(extraHByDepth[n._depth], n._h - OC_DIAGRAM_H_BOX_H);
      n.children.forEach(scanExtra);
    })(root);
  });
  const totalExtraH = extraHByDepth.reduce((a, b) => a + b, 0);
  const height = Math.round(depthY[maxDepth] + bottomPad + totalExtraH + 16);

  let linesSvg = '', nodesSvg = '';
  function drawConnectors(node) {
    if (!node.children.length) return;
    const levelGap = depthY[node._depth + 1] - depthY[node._depth];
    const pBottom = node._y + node._h / 2;
    const busY = pBottom + (levelGap - node._h / 2 - node.children[0]._h / 2) / 2;
    linesSvg += `<line x1="${node._x}" y1="${pBottom}" x2="${node._x}" y2="${busY}" stroke="#9fb8b5" stroke-width="1.5"/>`;
    if (node.children.length > 1) {
      const firstX = node.children[0]._x, lastX = node.children[node.children.length - 1]._x;
      linesSvg += `<line x1="${firstX}" y1="${busY}" x2="${lastX}" y2="${busY}" stroke="#9fb8b5" stroke-width="1.5"/>`;
    }
    node.children.forEach(c => {
      const cTop = c._y - c._h / 2;
      linesSvg += `<line x1="${c._x}" y1="${busY}" x2="${c._x}" y2="${cTop}" stroke="#9fb8b5" stroke-width="1.5"/>`;
      drawConnectors(c);
    });
  }
  function drawNode(node) {
    const w = ocNodeBoxWidth(node), h = node._h;
    const x = node._x - w / 2, y = node._y - h / 2;
    nodesSvg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#e3f4f1" stroke="#0f766e" stroke-width="1.5"/>`;
    if (ocNodeIsVertical(node)) {
      // Chữ xoay -90° quanh đúng tâm khung (đọc từ dưới lên — quy ước phổ biến cho nhãn xoay dọc, VD
      // trục hoành biểu đồ) — dominant-baseline="middle" để canh giữa chữ theo trục đã xoay, giống hệt
      // text-anchor="middle" vốn canh giữa theo trục ngang bình thường.
      const label = node._nameLines[0] || '';
      nodesSvg += `<text x="${node._x}" y="${node._y}" text-anchor="middle" dominant-baseline="middle" font-family="${OC_DIAGRAM_FONT}" font-size="12.5" font-weight="700" fill="#0d3b3a" transform="rotate(-90 ${node._x} ${node._y})">📁 ${escapeHtml(label)}</text>`;
    } else {
      const nameLines = node._nameLines;
      const blockTop = node._y - (nameLines.length - 1) * 8 + 5;
      nameLines.forEach((line, i) => {
        const icon = i === 0 ? '📁 ' : '';
        nodesSvg += `<text x="${node._x}" y="${blockTop + i * 16}" text-anchor="middle" font-family="${OC_DIAGRAM_FONT}" font-size="12.5" font-weight="700" fill="#0d3b3a">${icon}${escapeHtml(line)}</text>`;
      });
    }
    node.children.forEach(drawNode);
  }
  roots.forEach(root => { drawConnectors(root); drawNode(root); });

  const svgHTML = `<svg id="orgChartDiagramSvg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Sơ đồ tổ chức theo Phòng Ban/Siêu Thị">${linesSvg}${nodesSvg}</svg>`;
  return { svgHTML, width, height };
}

// Đổi chiều vẽ sơ đồ (nút "↔️ Ngang"/"↕️ Dọc" ở toolbar) — vẽ lại NGAY, không cần gọi lại API.
// Chiều khối cho Phòng Ban SẮP THÊM (chỉ đổi style 2 nút ở form "➕ Thêm Phòng Ban", KHÔNG lưu/vẽ lại gì
// cả — giá trị này chỉ thật sự áp dụng khi bấm "➕ Thêm Vào Sơ Đồ", xem addOrgChartDiagramNodeClick()).
let _ocAddNodeOrientation = 'horizontal';
function setOrgChartAddNodeOrientation(mode) {
  _ocAddNodeOrientation = mode === 'vertical' ? 'vertical' : 'horizontal';
  const activeCls = 'flex-1 px-2.5 py-1.5 rounded text-xs font-bold bg-teal-700 text-white';
  const inactiveCls = 'flex-1 px-2.5 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700 hover:bg-gray-300';
  const hBtn = document.getElementById('btnOrgChartAddNodeOrientH');
  const vBtn = document.getElementById('btnOrgChartAddNodeOrientV');
  if (hBtn) hBtn.className = _ocAddNodeOrientation === 'horizontal' ? activeCls : inactiveCls;
  if (vBtn) vBtn.className = _ocAddNodeOrientation === 'vertical' ? activeCls : inactiveCls;
}

// Đổi chiều 1 Phòng Ban ĐÃ CÓ sẵn (nút ↔️/↕️ nhỏ cạnh mỗi dòng trong danh sách bên trái) — PATCH lưu
// ngay, CHỈ ảnh hưởng đúng node này (LỖI ĐÃ VÁ 11/2026, xem chú thích ocNodeIsVertical() ở trên).
async function setOrgChartDiagramNodeOrientationClick(nodeId, mode) {
  try {
    await orgChartApiCall('PATCH', `/api/org-chart/diagram-nodes/${nodeId}`, { orientation: mode === 'vertical' ? 'vertical' : 'horizontal' });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  await loadOrgChartDiagramNodes();
  renderOrgChartDiagramNodeList();
  renderOrgChartDiagramSvgOnly();
}

// Tải lại cây Phòng Ban/Siêu Thị RIÊNG từ server — gọi mỗi khi vào tab, hoặc sau khi thêm/sửa/xoá.
async function loadOrgChartDiagramNodes() {
  const result = await orgChartApiCall('GET', '/api/org-chart/diagram-nodes');
  _ocDiagramNodes = result.nodes || [];
}

// Dropdown "Thuộc vào" ở form thêm Phòng Ban — liệt kê lồng cấp theo thụt lề, option đầu = "(gốc)".
function renderOrgChartDiagramNodeParentSelect() {
  const sel = document.getElementById('orgChartDiagramNodeParentSelect');
  if (!sel) return;
  const byParent = new Map();
  (_ocDiagramNodes || []).forEach(n => {
    const key = n.parentNodeId == null ? 'root' : n.parentNodeId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  });
  const options = ['<option value="">(Không có — Phòng Ban gốc)</option>'];
  function addOptions(parentKey, depth) {
    (byParent.get(parentKey) || []).forEach(n => {
      options.push(`<option value="${n.id}">${'— '.repeat(depth)}${escapeHtml(n.nodeName)}</option>`);
      addOptions(n.id, depth + 1);
    });
  }
  addOptions('root', 0);
  sel.innerHTML = options.join('');
}

// Danh sách Phòng Ban đã thêm (khung trái) — lồng cấp theo thụt lề, kèm nút xoá nếu có quyền sửa.
function renderOrgChartDiagramNodeList() {
  const listEl = document.getElementById('orgChartDiagramNodeList');
  if (!listEl) return;
  const nodes = _ocDiagramNodes || [];
  if (!nodes.length) { listEl.innerHTML = '<p class="text-gray-400 italic">Chưa có Phòng Ban nào — thêm Phòng Ban đầu tiên ở trên.</p>'; return; }
  const canEdit = !!(currentUser.perms?.orgChartManage);
  const byParent = new Map();
  nodes.forEach(n => {
    const key = n.parentNodeId == null ? 'root' : n.parentNodeId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(n);
  });
  function rowsFor(parentKey, depth) {
    return (byParent.get(parentKey) || []).map(n => {
      const isV = n.orientation === 'vertical';
      // Nút đổi chiều RIÊNG cho đúng Phòng Ban này (LỖI ĐÃ VÁ 11/2026) — đang ở chiều nào thì nút đó tô
      // đậm, bấm nút còn lại để đổi, PATCH lưu ngay.
      const orient = canEdit ? `
        <button type="button" data-op="setOrgChartDiagramNodeOrientationClick" data-arg0="${n.id}" data-arg1="horizontal" title="Chiều Ngang" class="${!isV ? 'text-teal-700 font-bold' : 'text-gray-300'} hover:bg-teal-50 rounded px-1">↔️</button>
        <button type="button" data-op="setOrgChartDiagramNodeOrientationClick" data-arg0="${n.id}" data-arg1="vertical" title="Chiều Dọc" class="${isV ? 'text-teal-700 font-bold' : 'text-gray-300'} hover:bg-teal-50 rounded px-1">↕️</button>` : '';
      const del = canEdit ? `<button type="button" data-op="deleteOrgChartDiagramNodeClick" data-arg0="${n.id}" title="Xoá" class="text-red-600 hover:bg-red-50 rounded px-1.5 ml-1 font-bold">✕</button>` : '';
      return `<div class="flex items-center gap-1 py-1 border-b border-gray-50">
        <span class="text-gray-400">${'&nbsp;'.repeat(depth * 3)}${depth > 0 ? '└ ' : ''}</span>
        <span class="flex-1 font-semibold">${escapeHtml(n.nodeName)}</span>
        ${orient}
        ${del}
      </div>` + rowsFor(n.id, depth + 1);
    }).join('');
  }
  listEl.innerHTML = rowsFor('root', 0);
}

async function renderOrgChartDiagramTab() {
  const container = document.getElementById('orgChartDiagramContainer');
  const statusEl = document.getElementById('orgChartDiagramStatus');
  if (statusEl) statusEl.innerText = 'Đang tải…';
  try {
    await loadOrgChartDiagramNodes();
  } catch (err) {
    if (statusEl) statusEl.innerText = '';
    container.innerHTML = `<p class="text-xs text-red-600">⛔ ${escapeHtml(err.message)}</p>`;
    return;
  }
  if (statusEl) statusEl.innerText = '';
  renderOrgChartDiagramNodeParentSelect();
  renderOrgChartDiagramNodeList();
  setOrgChartAddNodeOrientation('horizontal');
  renderOrgChartDiagramSvgOnly();
}

// Chỉ vẽ lại SVG (không gọi lại API) — dùng sau mỗi lần thêm/xoá Phòng Ban để sơ đồ cập nhật NGAY.
function renderOrgChartDiagramSvgOnly() {
  const container = document.getElementById('orgChartDiagramContainer');
  const roots = ocBuildDiagramForest(_ocDiagramNodes);
  if (!roots.length) { container.innerHTML = '<p class="text-xs text-gray-400 italic">Chưa có Phòng Ban nào — thêm Phòng Ban đầu tiên ở khung bên trái.</p>'; return; }
  container.innerHTML = ocRenderDiagramForest(roots).svgHTML;
}

async function addOrgChartDiagramNodeClick() {
  const nameInput = document.getElementById('orgChartDiagramNodeNameInput');
  const parentSelect = document.getElementById('orgChartDiagramNodeParentSelect');
  const statusEl = document.getElementById('orgChartDiagramNodeFormStatus');
  if (statusEl) statusEl.innerText = '';
  const name = (nameInput.value || '').trim();
  if (!name) { if (statusEl) statusEl.innerText = 'Vui lòng nhập tên Phòng Ban/Siêu Thị'; nameInput.focus(); return; }
  const parentNodeId = parentSelect.value ? Number(parentSelect.value) : null;
  try {
    await orgChartApiCall('POST', '/api/org-chart/diagram-nodes', { nodeName: name, parentNodeId, orientation: _ocAddNodeOrientation });
  } catch (err) { if (statusEl) statusEl.innerText = `⛔ ${err.message}`; return; }
  nameInput.value = '';
  await loadOrgChartDiagramNodes();
  renderOrgChartDiagramNodeParentSelect();
  renderOrgChartDiagramNodeList();
  renderOrgChartDiagramSvgOnly();
  nameInput.focus();
}

async function deleteOrgChartDiagramNodeClick(nodeId) {
  if (!confirm('Xoá Phòng Ban này? (Phòng Ban con bên trong, nếu có, sẽ bị xoá theo)')) return;
  try {
    await orgChartApiCall('DELETE', `/api/org-chart/diagram-nodes/${nodeId}`);
  } catch (err) { return alert(`⛔ ${err.message}`); }
  await loadOrgChartDiagramNodes();
  renderOrgChartDiagramNodeParentSelect();
  renderOrgChartDiagramNodeList();
  renderOrgChartDiagramSvgOnly();
}

// Tên file gợi ý cố định (không còn gắn theo tên phiên bản — cây này không có khái niệm version).
function ocDiagramFilenameBase() {
  return 'cay-so-do-to-chuc';
}

function ocSerializeDiagramSvgWithBackground() {
  const svgEl = document.getElementById('orgChartDiagramSvg');
  if (!svgEl) return null;
  const w = parseFloat(svgEl.getAttribute('width'));
  const h = parseFloat(svgEl.getAttribute('height'));
  const clone = svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('x', '0'); bg.setAttribute('y', '0'); bg.setAttribute('width', String(w)); bg.setAttribute('height', String(h)); bg.setAttribute('fill', '#ffffff');
  clone.insertBefore(bg, clone.firstChild);
  return { xml: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone), w, h };
}

function downloadOrgChartDiagramSvg() {
  const data = ocSerializeDiagramSvgWithBackground();
  if (!data) return alert('⛔ Chưa có sơ đồ để tải — hãy chờ sơ đồ hiện ra trước.');
  const blob = new Blob([data.xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `SoDoToChuc_${ocDiagramFilenameBase()}.svg`;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadOrgChartDiagramPng() {
  const data = ocSerializeDiagramSvgWithBackground();
  if (!data) return alert('⛔ Chưa có sơ đồ để tải — hãy chờ sơ đồ hiện ra trước.');
  const statusEl = document.getElementById('orgChartDiagramStatus');
  if (statusEl) statusEl.innerText = 'Đang dựng ảnh…';
  try {
    const svgBlob = new Blob([data.xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    const scale = 2; // xuất ảnh @2x cho nét khi in/phóng to
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = data.w * scale;
    canvas.height = data.h * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, data.w, data.h);
    URL.revokeObjectURL(url);
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `SoDoToChuc_${ocDiagramFilenameBase()}.png`;
    link.click();
    if (statusEl) statusEl.innerText = '';
  } catch (err) {
    if (statusEl) statusEl.innerText = '';
    alert(`⛔ Không dựng được ảnh: ${err.message}`);
  }
}

// ===== Bootstrap / Clone / Rename / Validate / Apply =====
async function bootstrapOrgChartClick() {
  const name = document.getElementById('orgChartBootstrapNameInput').value.trim() || 'Cơ cấu tổ chức';
  try {
    await orgChartApiCall('POST', '/api/org-chart/bootstrap', { versionName: name });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  await renderOrgChartModule();
}
async function cloneOrgChartVersionClick() {
  const sourceId = (_ocVersions.find(v => v.status === 'APPLIED') || _ocCurrentVersion)?.id;
  if (!sourceId) return alert('⛔ Không có phiên bản nào để sao chép.');
  const sourceMeta = _ocVersions.find(v => v.id === sourceId);
  const name = prompt('Tên bản nháp mới:', `${sourceMeta?.versionName || ''} (bản sao)`);
  if (name === null) return;
  let result;
  try {
    result = await orgChartApiCall('POST', `/api/org-chart/versions/${sourceId}/clone`, { versionName: name.trim() });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  await renderOrgChartModule();
  document.getElementById('orgChartVersionSelect').value = String(result.version.id);
  await onOrgChartVersionSelectChange();
}
// Nút "✨ Tạo Bản Mới (Trống)" (11/2026, theo yêu cầu người dùng: "chỉ tạo được bản nháp, tức là lấy
// nguyên cái bản mà cuối cùng... thêm một tính năng tạo bản mới mà sạch luôn để mình có thể làm lại
// đầu") — KHÁC cloneOrgChartVersionClick() ở trên (LUÔN sao chép toàn bộ cây từ bản đang áp dụng): tạo 1
// bản Nháp HOÀN TOÀN TRỐNG (chỉ gốc "Công Ty", server tự dựng — xem lib/orgChart.js::createBlankVersion()).
// KHÔNG đụng/xoá bất kỳ version nào khác đang có — chỉ THÊM 1 bản Nháp mới vào danh sách.
async function createBlankOrgChartVersionClick() {
  if (!confirm('Tạo 1 bản Nháp HOÀN TOÀN TRỐNG (chỉ có gốc "Công Ty", KHÔNG sao chép dữ liệu từ bất kỳ bản nào) để xây lại cây từ đầu?\n\nCác bản/phiên bản khác đang có vẫn giữ nguyên, không bị ảnh hưởng.')) return;
  const name = prompt('Tên bản mới:', 'Cơ cấu tổ chức (bản mới)');
  if (name === null) return;
  let result;
  try {
    result = await orgChartApiCall('POST', '/api/org-chart/versions/blank', { versionName: name.trim() });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  await renderOrgChartModule();
  document.getElementById('orgChartVersionSelect').value = String(result.version.id);
  await onOrgChartVersionSelectChange();
}
// Nút "✏️ Sửa Bản Đang Áp Dụng" (10/2026, theo yêu cầu người dùng "trong kỳ chỉ cần chỉnh lại định biên,
// không phải sang kỳ mới") — chỉ là 1 lối tắt tiện lợi trên cloneOrgChartVersionClick() ở trên, KHÔNG
// cho sửa trực tiếp cây đang APPLIED (giữ nguyên bất biến DRAFT-mới-sửa-được). Luôn tự đặt tên gợi ý +
// tự chuyển sang bản nháp mới tạo, để người dùng sửa cây rồi dùng nút "Áp Dụng (Giữ Nguyên Ngày)" bên
// cạnh nút Áp Dụng thường — xem applyOrgChartVersionClick() và lib/orgChart.js::applyVersionInPlace().
async function editAppliedOrgChartVersionClick() {
  const appliedMeta = _ocVersions.find(v => v.status === 'APPLIED');
  if (!appliedMeta) return alert('⛔ Chưa có phiên bản nào đang áp dụng để sửa.');
  if (!confirm(`Tạo bản nháp từ phiên bản đang áp dụng "${appliedMeta.versionName}" để chỉnh sửa (giữ nguyên toàn bộ cây hiện tại)?`)) return;
  const name = `Chỉnh sửa – ${appliedMeta.versionName}`;
  let result;
  try {
    result = await orgChartApiCall('POST', `/api/org-chart/versions/${appliedMeta.id}/clone`, { versionName: name });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  await renderOrgChartModule();
  document.getElementById('orgChartVersionSelect').value = String(result.version.id);
  await onOrgChartVersionSelectChange();
}
// ===== Nhập Excel (10/2026, theo yêu cầu người dùng) — LUÔN tạo 1 bản Nháp MỚI, xem
// lib/orgChartImport.js đầu file cho lý do "tất-cả-hoặc-không-gì" khác hẳn các Excel Nhập khác. =====
let _ocImportParsed = null; // { items, fileErrors, valid } — kết quả /parse-import gần nhất
function openOrgChartImportModal() {
  _ocImportParsed = null;
  document.getElementById('orgChartImportFileInput').value = '';
  document.getElementById('orgChartImportStatus').innerText = '';
  document.getElementById('orgChartImportFileErrorsWrap').classList.add('hidden');
  document.getElementById('orgChartImportPreviewWrap').classList.add('hidden');
  document.getElementById('orgChartImportConfirmWrap').classList.add('hidden');
  document.getElementById('orgChartImportVersionNameInput').value = '';
  document.getElementById('orgChartImportModal').classList.remove('hidden');
}
function closeOrgChartImportModal() {
  document.getElementById('orgChartImportModal').classList.add('hidden');
}
async function onOrgChartImportFileChange(event) {
  const file = event.target.files[0];
  _ocImportParsed = null;
  document.getElementById('orgChartImportFileErrorsWrap').classList.add('hidden');
  document.getElementById('orgChartImportPreviewWrap').classList.add('hidden');
  document.getElementById('orgChartImportConfirmWrap').classList.add('hidden');
  const statusEl = document.getElementById('orgChartImportStatus');
  if (!file) { statusEl.innerText = ''; return; }
  statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/org-chart/parse-import', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    _ocImportParsed = data;
    statusEl.innerText = `✅ Đọc file "${data.fileName}": ${data.items.length} node, ${data.valid ? 'TẤT CẢ hợp lệ' : 'CÒN LỖI (xem bên dưới) — chưa tạo được bản nháp'}.`;
    const fileErrorsEl = document.getElementById('orgChartImportFileErrorsWrap');
    if (data.fileErrors.length) {
      document.getElementById('orgChartImportFileErrorsList').innerHTML = data.fileErrors.map(e => `<li>${escapeHtml(e)}</li>`).join('');
      fileErrorsEl.classList.remove('hidden');
    } else {
      fileErrorsEl.classList.add('hidden');
    }
    document.getElementById('orgChartImportPreviewBody').innerHTML = data.items.map(it => {
      const statusCell = it.valid ? '<span class="text-emerald-600">✅ Hợp lệ</span>' : `<span class="text-red-600">⛔ ${escapeHtml(it.errors.join('; '))}</span>`;
      const pathText = (it.levels || []).filter(Boolean).join(' > ') || (it.isPosition ? '(Trực thuộc Công Ty)' : '');
      const typeLabel = it.isPosition ? 'Vị Trí' : 'Phòng Ban';
      return `<tr class="${it.valid ? '' : 'bg-red-50'}">
        <td class="p-1">${escapeHtml(pathText)}</td>
        <td class="p-1">${typeLabel}</td>
        <td class="p-1">${escapeHtml(it.isPosition ? (it.jobTitle || '') : '')}</td>
        <td class="p-1">${it.isPosition && it.headcountQuota != null ? escapeHtml(String(it.headcountQuota)) : ''}</td>
        <td class="p-1">${statusCell}</td>
      </tr>`;
    }).join('');
    document.getElementById('orgChartImportPreviewWrap').classList.remove('hidden');
    document.getElementById('orgChartImportConfirmWrap').classList.toggle('hidden', !data.valid);
    if (data.valid) document.getElementById('orgChartImportVersionNameInput').value = `Cơ cấu tổ chức (nhập từ ${data.fileName})`;
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
  }
}
async function confirmOrgChartImport() {
  if (!_ocImportParsed || !_ocImportParsed.valid) return alert('Chưa có file hợp lệ để nhập.');
  const versionName = document.getElementById('orgChartImportVersionNameInput').value.trim();
  try {
    const result = await orgChartApiCall('POST', '/api/org-chart/import-confirm', { items: _ocImportParsed.items, versionName });
    alert(`✅ Đã tạo bản nháp mới "${result.version.versionName}" với ${result.version.nodes.length} node.`);
    closeOrgChartImportModal();
    await renderOrgChartModule();
    document.getElementById('orgChartVersionSelect').value = String(result.version.id);
    await onOrgChartVersionSelectChange();
  } catch (err) {
    alert(`⛔ ${err.message}`);
  }
}

// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): xoá hẳn 1 bản nháp (DRAFT) không dùng nữa (tạo thử/
// nhân bản nhầm) — server (deleteVersion(), lib/orgChart.js) tự chặn xoá APPLIED/ARCHIVED.
async function deleteOrgChartVersionClick() {
  if (!_ocCurrentVersion) return;
  if (!confirm(`Xoá hẳn bản nháp "${_ocCurrentVersion.versionName}"? Không thể hoàn tác.`)) return;
  try {
    await orgChartApiCall('POST', `/api/org-chart/versions/${_ocCurrentVersion.id}/delete`, {});
  } catch (err) { return alert(`⛔ ${err.message}`); }
  document.getElementById('orgChartVersionSelect').value = '';
  await renderOrgChartModule();
}
// "🗑️ Xoá Tất Cả Bản Nháp" (11/2026, theo yêu cầu người dùng "xóa tất cả các cái định biên này đi...
// làm lại từ đầu") — xoá hẳn TẤT CẢ bản Nháp cùng 1 lượt (tránh bấm "Xoá Bản Nháp Này" lần lượt khi có
// nhiều Nháp rác). KHÔNG đụng tới bản Đang Áp Dụng/Lưu Trữ — server (deleteAllDraftVersions(),
// lib/orgChart.js) tự chỉ lọc đúng DRAFT.
async function deleteAllOrgChartDraftsClick() {
  const draftCount = _ocVersions.filter(v => v.status === 'DRAFT').length;
  if (!draftCount) return;
  if (!confirm(`Xoá hẳn TẤT CẢ ${draftCount} bản Nháp hiện có? Không thể hoàn tác (bản Đang Áp Dụng/Lưu Trữ KHÔNG bị ảnh hưởng).`)) return;
  let result;
  try {
    result = await orgChartApiCall('POST', '/api/org-chart/versions/delete-all-drafts', {});
  } catch (err) { return alert(`⛔ ${err.message}`); }
  alert(`✅ Đã xoá ${result.deletedCount} bản Nháp.`);
  document.getElementById('orgChartVersionSelect').value = '';
  await renderOrgChartModule();
}
// Xoá VĨNH VIỄN 1 bản Lưu Trữ (ARCHIVED) — khác hẳn deleteOrgChartVersionClick() ở trên (chỉ DRAFT, 1
// lớp confirm()): đây là hành động KHÔNG HOÀN TÁC mất lịch sử, nên thêm hẳn lớp xác nhận thứ 2 — bắt gõ
// lại ĐÚNG tên phiên bản (không chỉ bấm OK) trước khi gọi API, server cũng đối chiếu lại y hệt (phòng khi
// có người tự gọi thẳng API bỏ qua UI — xem POST /versions/:id/delete-archived, routes/orgChart.js).
async function deleteArchivedOrgChartVersionClick() {
  if (!_ocCurrentVersion || _ocCurrentVersion.status !== 'ARCHIVED') return;
  const name = _ocCurrentVersion.versionName;
  if (!confirm(`⚠️ Xoá VĨNH VIỄN bản Lưu Trữ "${name}"? KHÔNG THỂ HOÀN TÁC — mất hẳn lịch sử phiên bản này (chỉ nên xoá bản bị áp dụng nhầm, không còn giá trị tham khảo).`)) return;
  const typed = prompt(`Để xác nhận, gõ lại ĐÚNG tên phiên bản: "${name}"`);
  if (typed === null) return;
  if (typed.trim() !== name) return alert('⛔ Tên gõ lại không khớp — đã huỷ thao tác xoá.');
  try {
    await orgChartApiCall('POST', `/api/org-chart/versions/${_ocCurrentVersion.id}/delete-archived`, { confirmVersionName: typed.trim() });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  document.getElementById('orgChartVersionSelect').value = '';
  await renderOrgChartModule();
}
async function renameOrgChartVersionClick() {
  if (!_ocCurrentVersion) return;
  const name = prompt('Tên phiên bản mới:', _ocCurrentVersion.versionName);
  if (name === null || !name.trim()) return;
  try {
    await orgChartApiCall('PATCH', `/api/org-chart/versions/${_ocCurrentVersion.id}`, { versionName: name.trim() });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  await renderOrgChartModule();
}
async function validateOrgChartVersionClick() {
  if (!_ocCurrentVersion) return;
  let result;
  try {
    result = await orgChartApiCall('POST', `/api/org-chart/versions/${_ocCurrentVersion.id}/validate`, {});
  } catch (err) { return alert(`⛔ ${err.message}`); }
  if (result.valid) alert('✅ Phiên bản hợp lệ, có thể áp dụng.');
  else alert(`⚠️ Còn ${result.issues.length} lỗi cần xử lý trước khi áp dụng:\n\n- ${result.issues.join('\n- ')}`);
}
// Tham số keepEffectiveDate: đến từ nút "✅ Áp Dụng (Giữ Nguyên Ngày — Sửa Trong Kỳ)"
// (data-arg0="1" ở orgChartSection.html → cspCoerceArg() ép thành Number 1) — nút Áp Dụng thường gọi
// hàm này KHÔNG truyền gì (undefined), giữ đúng hành vi cũ (luôn đóng dấu ngày hôm nay). Server
// (lib/orgChart.js::applyVersionInPlace()) tự kiểm tra lại điều kiện an toàn clonedFromVersionId —
// chỉ cần đổi nội dung confirm() ở đây cho đúng ngữ cảnh, không cần tự kiểm tra điều kiện phía client.
async function applyOrgChartVersionClick(keepEffectiveDate) {
  if (!_ocCurrentVersion) return;
  const confirmMsg = keepEffectiveDate
    ? `Áp dụng bản nháp "${_ocCurrentVersion.versionName}" và GIỮ NGUYÊN ngày "Áp dụng từ" của kỳ hiện tại (coi như chỉnh sửa trong kỳ, không phải kỳ mới)?`
    : `Áp dụng phiên bản "${_ocCurrentVersion.versionName}"? Phiên bản đang áp dụng hiện tại (nếu có) sẽ chuyển sang Lưu Trữ.`;
  if (!confirm(confirmMsg)) return;
  let result;
  try {
    result = await orgChartApiCall('POST', `/api/org-chart/versions/${_ocCurrentVersion.id}/apply`, { keepEffectiveDate: !!keepEffectiveDate });
  } catch (err) {
    // "🚨 Áp Dụng Cưỡng Chế" (11/2026, theo yêu cầu người dùng: thay thế HÀNG LOẠT cơ cấu tổ chức — VD cả
    // khối Siêu Thị/Cửa Hàng hàng trăm người giữ vị trí cùng lúc — đi xoá + "Buộc Gỡ & Xoá" từng node 1
    // như deleteOrgChartNodeClick() ở trên không khả thi ở quy mô này) — CHỈ đề xuất khi lỗi ĐÚNG do còn
    // người giữ vị trí bị xoá (không che các lỗi khác như node mồ côi/nhiều "Trưởng phòng" — những lỗi đó
    // VẪN phải tự sửa cây trước, không có cách "cưỡng chế" nào bỏ qua được) VÀ người dùng có ĐÚNG quyền
    // riêng orgChartForceUnassignDelete đã dùng cho "Buộc Gỡ & Xoá" từng node (KHÔNG có quyền mới nào).
    const isBlockedByOccupant = /bị xoá khỏi bản nháp nhưng vẫn có người giữ/.test(err.message || '');
    if (!isBlockedByOccupant || !currentUser.perms?.orgChartForceUnassignDelete) return alert(`⛔ ${err.message}`);
    const wantForce = confirm(`⛔ ${err.message}\n\nBạn có quyền "Buộc Gỡ & Xoá" — ÁP DỤNG CƯỠNG CHẾ, tự động gỡ chức vụ Hồ Sơ Nhân Sự của MỌI người đang giữ các vị trí bị xoá ở trên rồi áp dụng?\n\nLƯU Ý: chỉ gỡ được chức vụ gán qua Hồ Sơ Nhân Sự — tài khoản đăng nhập nào khớp đúng Chức Danh/Phòng Ban (nếu có) sẽ KHÔNG bị sửa, hệ thống sẽ báo danh sách để bạn tự sửa sau. Hành động KHÔNG hoàn tác được.`);
    if (!wantForce) return;
    try {
      result = await orgChartApiCall('POST', `/api/org-chart/versions/${_ocCurrentVersion.id}/apply`, { keepEffectiveDate: !!keepEffectiveDate, force: true });
    } catch (err2) { return alert(`⛔ ${err2.message}`); }
  }
  // Yêu cầu nghiệp vụ (11/2026, ĐẢO LẠI quyết định 10/2026): Áp Dụng cơ cấu + định biên KHÔNG còn tự
  // chuyển sang sub-tab "🖼️ Sơ Đồ Trực Quan" nữa — người dùng phản hồi việc tự nhảy sang sơ đồ ngay sau
  // khi Áp Dụng khiến 2 việc "làm cơ cấu/định biên" và "tạo sơ đồ" bị dính liền, muốn tách hẳn: Áp Dụng
  // xong vẫn ở ĐÚNG sub-tab đang xem (giữ nguyên activeOrgChartSubTab), chỉ khi người dùng TỰ bấm qua tab
  // Sơ Đồ Trực Quan thì mới xem/tạo sơ đồ (tab đó vẫn CHỈ vẽ tới cấp Phòng Ban/Công Ty, không đổi).
  await renderOrgChartModule();
  openOrgChartApplyResultModal(result);
}
// Đợt 4 (vá gap #2 Phần A/B) — đồng bộ lại managerUsername theo ĐÚNG cây version đang APPLIED mà KHÔNG
// cần tạo bản nháp + Áp dụng lại, dùng khi HR chỉ vừa đổi nhanh dept/jobTitle của 1-2 người (đề bạt
// thay 1 vị trí quản lý vừa nghỉ...) ở màn Sửa Người Dùng — trước đây managerUsername CHỈ tự đồng bộ
// lúc "Áp dụng phiên bản" (applyOrgChartVersionClick() ở trên), HR dễ quên phải tạo hẳn 1 version mới
// chỉ để refresh lại. Tái dùng ĐÚNG modal kết quả (openOrgChartApplyResultModal()) qua tham số summaryText.
async function recomputeManagerUsernamesClick() {
  if (!confirm('Đồng bộ lại Quản Lý Trực Tiếp cho toàn bộ nhân viên theo đúng cây tổ chức đang áp dụng hiện tại?')) return;
  let result;
  try {
    result = await orgChartApiCall('POST', '/api/org-chart/recompute-manager-usernames', {});
  } catch (err) { return alert(`⛔ ${err.message}`); }
  openOrgChartApplyResultModal(result, 'Đã đồng bộ lại Quản Lý Trực Tiếp theo đúng cây tổ chức đang áp dụng.');
}
function openOrgChartApplyResultModal(result, summaryText) {
  document.getElementById('orgChartApplyResultSummary').innerText =
    summaryText || `Đã áp dụng phiên bản "${result.version.versionName}" — có hiệu lực từ ${result.version.effectiveDate}.`;
  const unresolved = result.unresolvedManagerUsers || [];
  const listEl = document.getElementById('orgChartApplyResultUnresolved');
  if (!unresolved.length) {
    listEl.innerHTML = '<p class="text-xs text-emerald-700">✅ Đã tự động cập nhật Quản Lý Trực Tiếp cho toàn bộ nhân viên khớp được vị trí trong cây.</p>';
  } else {
    listEl.innerHTML = `<p class="text-xs text-amber-700 font-semibold">⚠️ ${unresolved.length} nhân viên KHÔNG tự xác định được quản lý trực tiếp mới, cần kiểm tra tay:</p>` +
      unresolved.map(u => `<div class="text-xs bg-amber-50 border border-amber-200 rounded p-1.5">${escapeHtml(u.name || u.username)} — ${escapeHtml(u.reason)}</div>`).join('');
  }
  // "🚨 Áp Dụng Cưỡng Chế" (11/2026) — khối báo cáo RIÊNG, chỉ hiện khi result.clearedProfiles/
  // accountsNeedingManualFix có dữ liệu (áp dụng thường không bao giờ có 2 field này).
  const forceWrap = document.getElementById('orgChartApplyResultForceWrap');
  const cleared = result.clearedProfiles || [];
  const needFix = result.accountsNeedingManualFix || [];
  if (!cleared.length && !needFix.length) {
    forceWrap.classList.add('hidden');
    forceWrap.innerHTML = '';
  } else {
    forceWrap.classList.remove('hidden');
    let html = '';
    if (cleared.length) {
      html += `<p class="text-xs text-emerald-700 font-semibold">✅ Đã tự động gỡ chức vụ ${cleared.length} hồ sơ Hồ Sơ Nhân Sự (vị trí đã bị xoá khỏi cơ cấu):</p>` +
        cleared.map(c => `<div class="text-xs bg-emerald-50 border border-emerald-200 rounded p-1.5">${escapeHtml(c.name)} — khỏi "${escapeHtml(c.positionLabel)}"</div>`).join('');
    }
    if (needFix.length) {
      html += `<p class="text-xs text-red-700 font-semibold mt-2">⛔ ${needFix.length} tài khoản ĐĂNG NHẬP vẫn khớp Chức Danh/Phòng Ban của vị trí đã xoá — hệ thống KHÔNG tự sửa, cần vào Hệ Thống → Quản Trị Người Dùng đổi Chức Danh/Phòng Ban của những tài khoản này:</p>` +
        needFix.map(a => `<div class="text-xs bg-red-50 border border-red-200 rounded p-1.5">${escapeHtml(a.name)} (${escapeHtml(a.username)}) — "${escapeHtml(a.positionLabel)}"</div>`).join('');
    }
    forceWrap.innerHTML = html;
  }
  document.getElementById('orgChartApplyResultModal').classList.remove('hidden');
}
function closeOrgChartApplyResultModal() {
  document.getElementById('orgChartApplyResultModal').classList.add('hidden');
}

// ===== So sánh với bản đang áp dụng (chỉ đọc) =====
function ocDiffKey(node) { return node.positionKey || `name:${node.nodeName}:${node.parentNodeId}`; }
function diffOrgChartTreesClient(baseNodes, otherNodes) {
  const baseByKey = new Map(baseNodes.map(n => [ocDiffKey(n), n]));
  const otherByKey = new Map(otherNodes.map(n => [ocDiffKey(n), n]));
  const added = [], removed = [], changed = [];
  for (const [key, n] of otherByKey) if (!baseByKey.has(key)) added.push(ocBuildNodeDisplayName(otherNodes, n));
  for (const [key, n] of baseByKey) if (!otherByKey.has(key)) removed.push(ocBuildNodeDisplayName(baseNodes, n));
  for (const [key, n] of otherByKey) {
    const b = baseByKey.get(key);
    if (!b) continue;
    const nameA = ocBuildNodeDisplayName(baseNodes, b), nameB = ocBuildNodeDisplayName(otherNodes, n);
    if (nameA !== nameB || b.parentNodeId !== n.parentNodeId) changed.push(`${nameA} -> ${nameB}`);
  }
  return { added, removed, changed };
}
async function compareOrgChartVersionClick() {
  if (!_ocCurrentVersion || !_ocAppliedVersion) return;
  const diff = diffOrgChartTreesClient(_ocAppliedVersion.nodes || [], _ocCurrentVersion.nodes || []);
  const body = document.getElementById('orgChartDiffModalBody');
  const section = (title, list, cls) => list.length
    ? `<div><h4 class="font-bold text-xs ${cls} mb-1">${title} (${list.length})</h4><ul class="text-xs space-y-0.5 list-disc list-inside">${list.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`
    : '';
  body.innerHTML = [
    section('➕ Thêm mới', diff.added, 'text-emerald-700'),
    section('➖ Đã xoá', diff.removed, 'text-red-700'),
    section('✏️ Đổi tên/chuyển cấp', diff.changed, 'text-blue-700')
  ].filter(Boolean).join('') || '<p class="text-xs text-gray-500 italic">Không có thay đổi nào.</p>';
  document.getElementById('orgChartDiffModal').classList.remove('hidden');
}
function closeOrgChartDiffModal() {
  document.getElementById('orgChartDiffModal').classList.add('hidden');
}

// ===== Modal Thêm/Sửa node =====
function ocPopulateNodeDeptRefSelect(selectedValue) {
  const input = document.getElementById('orgChartNodeDeptRefSelect');
  sddSetOptions('orgChartNodeDeptRefSelectDatalist', [...(DB.depts || []), ...(DB.stores || [])]);
  input.value = selectedValue || '';
}
// PHÁT HIỆN ở đợt audit chuyên sâu lần 2: trước đây LUÔN gộp chung jobTitles (Khối Văn Phòng) +
// storeJobTitles (Siêu Thị) bất kể posType của node đang sửa — trong khi node ĐÃ có field posType riêng
// để phân biệt (dùng đồng bộ mô hình chấm công, xem chú thích orgChartNodePosTypeSelect ở index.html),
// khiến gợi ý chức danh không khớp đúng danh mục của posType đã chọn (VD gợi ý "Nhân viên bán hàng" cho
// 1 vị trí Văn Phòng). posType rỗng/'' (chưa gán) vẫn gộp chung cả 2 — hợp lý vì chưa biết thuộc khối
// nào, không thể lọc bừa.
function ocPopulateJobTitleDatalist(posType) {
  const office = DB.jobTitles || [];
  const store = (DB.storeJobTitles || []).map(t => t.label).filter(Boolean);
  const options = posType === 'HO' ? office : posType === 'STORE' ? store : [...office, ...store];
  sddSetOptions('orgChartJobTitleDatalist', [...new Set(options)].sort((a, b) => a.localeCompare(b, 'vi')).map(t => ({ label: t, value: t })));
}
// Gọi lại khi người dùng đổi "Vị Trí Làm Việc" ngay trong modal (thêm/sửa) để gợi ý chức danh luôn khớp
// đúng khối vừa chọn, không cần đóng/mở lại modal.
function ocOnNodePosTypeChange() {
  ocPopulateJobTitleDatalist(document.getElementById('orgChartNodePosTypeSelect').value || '');
}
// Cấp Bậc (10/2026) — gợi ý từ DB.jobGrades (Quản Lý Danh Mục), KHÔNG ép phải khớp đúng 1 giá trị (cùng
// mức ràng buộc "mềm" như ocPopulateJobTitleDatalist() ở trên — gõ tự do vẫn lưu được).
function ocPopulateJobGradeDatalist() {
  sddSetOptions('orgChartJobGradeDatalist', (DB.jobGrades || []).map(g => ({ label: g, value: g })));
}
// Chức Danh ↔ Cấp Bậc (Gợi ý mặc định, 10/2026, theo yêu cầu người dùng): chọn/gõ xong 1 Chức Danh đã có
// cấu hình ở DB.jobTitleGradeDefaults (Quản Lý Danh Mục) thì tự điền ô "Cấp Bậc" — CHỈ điền khi ô đó
// đang RỖNG (không đè giá trị đã có, kể cả khi đang Sửa 1 node đã có Cấp Bậc khác từ trước); vẫn gõ/sửa
// tay được sau đó, đây thuần là GỢI Ý, không ép buộc (cùng mức ràng buộc "mềm" như sddSetOptions() ở
// trên). Đọc THẲNG DB.jobTitleGradeDefaults (không gọi hàm nào ở module-admin.js — cụm "orgchart-v2"
// không chắc đã nạp "admin-core", xem MODULE_LOAD_GROUPS).
function onOrgChartNodeJobTitleChange() {
  const jobTitle = (document.getElementById('orgChartNodeJobTitleInput').value || '').trim();
  const gradeInput = document.getElementById('orgChartNodeJobGradeInput');
  if (!gradeInput || gradeInput.value.trim() || !jobTitle) return;
  const match = (DB.jobTitleGradeDefaults || []).find(r => r.jobTitle === jobTitle);
  if (match) gradeInput.value = match.jobGrade;
}
function onOrgChartNodeTypeChange() {
  const type = document.getElementById('orgChartNodeTypeSelect').value;
  document.getElementById('orgChartNodeDeptFields').classList.toggle('hidden', type !== 'DEPARTMENT');
  document.getElementById('orgChartNodePositionFields').classList.toggle('hidden', type !== 'POSITION');
}
function openOrgChartAddNodeModal(parentNodeId) {
  orgChartNodeModalMode = 'ADD';
  orgChartNodeModalParentId = parentNodeId;
  orgChartNodeModalEditingId = null;
  const parentNode = (_ocCurrentVersion.nodes || []).find(n => n.nodeId === parentNodeId);
  document.getElementById('orgChartNodeModalTitle').innerText = '➕ Thêm Node Mới';
  document.getElementById('orgChartNodeModalParentInfo').innerText = `Thêm vào: ${parentNode ? ocBuildNodeDisplayName(_ocCurrentVersion.nodes, parentNode) : ''}`;
  document.getElementById('orgChartNodeTypeWrap').classList.remove('hidden');
  document.getElementById('orgChartNodeTypeSelect').value = 'DEPARTMENT';
  document.getElementById('orgChartNodeNameInput').value = '';
  document.getElementById('orgChartNodeJobTitleInput').value = '';
  document.getElementById('orgChartNodeRequiresDeptCheckbox').checked = true;
  document.getElementById('orgChartNodePosTypeSelect').value = '';
  document.getElementById('orgChartNodeJobGradeInput').value = '';
  document.getElementById('orgChartNodeHeadcountQuotaInput').value = '';
  document.getElementById('orgChartNodeHeadcountSelfOnlyCheckbox').checked = false;
  ocPopulateNodeDeptRefSelect('');
  ocPopulateJobTitleDatalist();
  ocPopulateJobGradeDatalist();
  onOrgChartNodeTypeChange();
  document.getElementById('orgChartNodeModal').classList.remove('hidden');
}
function openOrgChartEditNodeModal(nodeId) {
  const node = (_ocCurrentVersion.nodes || []).find(n => n.nodeId === nodeId);
  if (!node) return;
  orgChartNodeModalMode = 'EDIT';
  orgChartNodeModalEditingId = nodeId;
  orgChartNodeModalParentId = node.parentNodeId;
  document.getElementById('orgChartNodeModalTitle').innerText = `✏️ Sửa Node: ${ocBuildNodeDisplayName(_ocCurrentVersion.nodes, node)}`;
  document.getElementById('orgChartNodeModalParentInfo').innerText = '';
  document.getElementById('orgChartNodeTypeWrap').classList.add('hidden');
  document.getElementById('orgChartNodeTypeSelect').value = node.nodeType === 'POSITION' ? 'POSITION' : 'DEPARTMENT';
  if (node.nodeType === 'POSITION') {
    document.getElementById('orgChartNodeJobTitleInput').value = node.jobTitle || '';
    document.getElementById('orgChartNodeRequiresDeptCheckbox').checked = node.requiresDept !== false;
    document.getElementById('orgChartNodePosTypeSelect').value = node.posType || '';
    document.getElementById('orgChartNodeJobGradeInput').value = node.jobGrade || '';
    document.getElementById('orgChartNodeHeadcountQuotaInput').value = node.headcountQuota == null ? '' : node.headcountQuota;
    ocPopulateJobTitleDatalist(node.posType || ''); // SAU KHI đã biết posType — lọc đúng danh mục ngay khi mở
    ocPopulateJobGradeDatalist();
  } else {
    ocPopulateJobTitleDatalist();
    document.getElementById('orgChartNodeNameInput').value = node.nodeName || '';
    document.getElementById('orgChartNodeHeadcountSelfOnlyCheckbox').checked = !!node.headcountSelfOnly;
    ocPopulateNodeDeptRefSelect(node.departmentRef || '');
  }
  onOrgChartNodeTypeChange();
  document.getElementById('orgChartNodeModal').classList.remove('hidden');
}
function closeOrgChartNodeModal() {
  document.getElementById('orgChartNodeModal').classList.add('hidden');
  orgChartNodeModalMode = null;
}
async function saveOrgChartNodeClick() {
  if (!_ocCurrentVersion) return;
  const nodeType = document.getElementById('orgChartNodeTypeSelect').value;
  const payload = { nodeType };
  if (nodeType === 'POSITION') {
    payload.jobTitle = document.getElementById('orgChartNodeJobTitleInput').value.trim();
    payload.requiresDept = document.getElementById('orgChartNodeRequiresDeptCheckbox').checked;
    payload.posType = document.getElementById('orgChartNodePosTypeSelect').value || null;
    payload.jobGrade = document.getElementById('orgChartNodeJobGradeInput').value.trim() || null;
    const quotaRaw = document.getElementById('orgChartNodeHeadcountQuotaInput').value.trim();
    payload.headcountQuota = quotaRaw === '' ? null : Number(quotaRaw);
    if (!payload.jobTitle) return alert('⛔ Vui lòng nhập Chức Danh.');
    if (quotaRaw !== '' && (!Number.isFinite(payload.headcountQuota) || payload.headcountQuota < 0)) return alert('⛔ Định biên phải là số nguyên không âm.');
  } else {
    payload.nodeName = document.getElementById('orgChartNodeNameInput').value.trim();
    payload.departmentRef = document.getElementById('orgChartNodeDeptRefSelect').value.trim() || null;
    payload.headcountSelfOnly = document.getElementById('orgChartNodeHeadcountSelfOnlyCheckbox').checked;
    if (!payload.nodeName) return alert('⛔ Vui lòng nhập Tên Hiển Thị.');
    if (payload.departmentRef && ![...(DB.depts || []), ...(DB.stores || [])].includes(payload.departmentRef)) {
      return alert('⛔ "Liên kết Phòng Ban thật" không hợp lệ — vui lòng gõ và chọn đúng 1 gợi ý từ danh sách, hoặc bỏ trống.');
    }
  }
  try {
    if (orgChartNodeModalMode === 'ADD') {
      payload.parentNodeId = orgChartNodeModalParentId;
      // Thứ tự hiển thị (11/2026, theo yêu cầu người dùng — "add vào mục nào thì hiện NGAY trong mục
      // đó, đẩy các mục khác xuống"): CHỈ cho đúng luồng thêm 1 node qua modal này (bấm "+ Thêm nhánh
      // con") — xếp node mới làm con ĐẦU TIÊN của đúng node cha vừa chọn (nhỏ hơn mọi anh/chị em hiện
      // có), thay vì mặc định addNode() ở server (xếp CUỐI theo tổng số node toàn cây — vẫn giữ nguyên
      // cho luồng Nhập Excel hàng loạt ở lib/orgChartImport.js, không đụng tới). Trước đây node mới luôn
      // rơi xuống SAU TOÀN BỘ nhánh con khác đã có của cùng 1 cha (có thể rất dài, VD nhánh "Khối siêu
      // thị/Cửa hàng"), khiến người dùng tưởng nhầm nó "lọt ra ngoài" folder dù dữ liệu cha-con vẫn đúng.
      const siblingOrders = (_ocCurrentVersion.nodes || [])
        .filter(n => n.parentNodeId === orgChartNodeModalParentId)
        .map(n => n.displayOrder || 0);
      payload.displayOrder = siblingOrders.length ? Math.min(...siblingOrders) - 1 : 0;
      await orgChartApiCall('POST', `/api/org-chart/versions/${_ocCurrentVersion.id}/nodes`, payload);
    } else {
      delete payload.nodeType;
      await orgChartApiCall('PATCH', `/api/org-chart/versions/${_ocCurrentVersion.id}/nodes/${orgChartNodeModalEditingId}`, payload);
    }
  } catch (err) { return alert(`⛔ ${err.message}`); }
  closeOrgChartNodeModal();
  await loadOrgChartCurrentVersion(_ocCurrentVersion.id);
  renderOrgChartTree();
}
async function deleteOrgChartNodeClick(nodeId) {
  if (!_ocCurrentVersion) return;
  if (!confirm('Xoá node này (và toàn bộ nhánh con nếu có)?')) return;
  try {
    await orgChartApiCall('DELETE', `/api/org-chart/versions/${_ocCurrentVersion.id}/nodes/${nodeId}`);
  } catch (err) {
    // "🔧 Buộc Gỡ & Xoá" (11/2026, theo yêu cầu người dùng: "tự động remove tất cả người ra khỏi
    // vị trí này") — chỉ đề xuất khi lỗi ĐÚNG do còn người giữ vị trí (không che các lỗi khác) VÀ
    // người dùng có quyền riêng orgChartForceUnassignDelete (xem routes/orgChart.js::force-delete).
    const isBlockedByOccupant = /vẫn còn nhân viên đang giữ vị trí/.test(err.message || '');
    if (isBlockedByOccupant && currentUser.perms?.orgChartForceUnassignDelete) {
      const wantForce = confirm(`⛔ ${err.message}\n\nBạn có quyền "Buộc Gỡ & Xoá" — tự động gỡ chức vụ Hồ Sơ Nhân Sự của người đang giữ (nếu có) rồi xoá node này?\n\nLƯU Ý: chỉ gỡ được chức vụ gán qua Hồ Sơ Nhân Sự — nếu còn tài khoản đăng nhập khớp đúng Chức Danh/Phòng Ban thì vẫn bị chặn, hành động KHÔNG hoàn tác được.`);
      if (!wantForce) return;
      return forceDeleteOrgChartNodeClick(nodeId);
    }
    return alert(`⛔ ${err.message}`);
  }
  await loadOrgChartCurrentVersion(_ocCurrentVersion.id);
  renderOrgChartTree();
}
async function forceDeleteOrgChartNodeClick(nodeId) {
  if (!_ocCurrentVersion) return;
  let result;
  try {
    result = await orgChartApiCall('POST', `/api/org-chart/versions/${_ocCurrentVersion.id}/nodes/${nodeId}/force-delete`);
  } catch (err) { return alert(`⛔ ${err.message}`); }
  await loadOrgChartCurrentVersion(_ocCurrentVersion.id);
  renderOrgChartTree();
  const cleared = result?.clearedProfiles || [];
  if (cleared.length) {
    alert(`✅ Đã xoá node và tự động gỡ chức vụ ${cleared.length} hồ sơ:\n${cleared.map(c => `- ${c.name} khỏi "${c.positionLabel}"`).join('\n')}`);
  } else {
    alert('✅ Đã xoá node (không ai đang giữ vị trí nào trong nhánh này qua Hồ Sơ Nhân Sự).');
  }
}

// ===== Báo Cáo Định Biên Nhân Sự (10/2026, layout bảng phẳng theo mẫu Excel thật của người dùng từ
// 11/2026 — xem lib/headcountReport.js::buildFlatGroupedHeadcountReport()): STT | BAN/PHÒNG |
// BAN/PHÒNG/BỘ PHẬN | BỘ PHẬN/NHÓM | CHỨC DANH | CẤP BẬC | Mã vị trí | Định Biên | Thực Tế | Chênh Lệch,
// nhóm La Mã I/II.../II.1/II.2... — THAY THẾ hẳn layout cây thụt lề cũ (1 cột "Cấp/Tên").
function ocFmtNum(n) {
  if (n == null) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
function renderOrgChartHeadcountTable(report) {
  const tbody = document.getElementById('orgChartHeadcountTableBody');
  const varianceCls = (v) => v == null ? '' : v > 0 ? 'text-amber-700 font-bold' : v < 0 ? 'text-red-600 font-bold' : '';
  const rootRow = `<tr class="bg-gray-100 font-bold">
    <td class="p-1.5 text-center">A</td>
    <td class="p-1.5" colspan="2">${escapeHtml(report.rootLabel || '')}</td>
    <td class="p-1.5"></td><td class="p-1.5"></td><td class="p-1.5"></td><td class="p-1.5"></td>
    <td class="p-1.5 text-right">${report.rootStats?.quota == null ? '—' : report.rootStats.quota}</td>
    <td class="p-1.5 text-right">${ocFmtNum(report.rootStats?.actualTotal)}</td>
    <td class="p-1.5 text-right">${ocFmtNum(report.rootStats?.secondary)}</td>
    <td class="p-1.5 text-right">${ocFmtNum(report.rootStats?.offboarding)}</td>
    <td class="p-1.5 text-right">${ocFmtNum(report.rootStats?.onLeave)}</td>
    <td class="p-1.5 text-right ${varianceCls(report.rootStats?.variance)}">${report.rootStats?.variance == null ? '—' : report.rootStats.variance}</td>
  </tr>`;
  const bodyRows = (report.rows || []).map(r => {
    if (r.kind === 'GROUP1' || r.kind === 'GROUP2') {
      const nameCls = r.kind === 'GROUP1' ? 'font-bold text-red-600' : 'font-bold text-gray-900';
      return `<tr class="bg-amber-200">
        <td class="p-1.5 font-bold text-center">${escapeHtml(r.sttLabel)}</td>
        <td class="p-1.5 ${nameCls}" colspan="2">${escapeHtml(r.label)}${r.abbr ? ` <span class="font-normal text-gray-600">(${escapeHtml(r.abbr)})</span>` : ''}</td>
        <td class="p-1.5"></td><td class="p-1.5"></td><td class="p-1.5"></td><td class="p-1.5"></td>
        <td class="p-1.5 text-right font-bold">${r.quota == null ? '—' : r.quota}</td>
        <td class="p-1.5 text-right font-bold">${ocFmtNum(r.actualTotal)}</td>
        <td class="p-1.5 text-right font-bold">${ocFmtNum(r.secondary)}</td>
        <td class="p-1.5 text-right font-bold">${ocFmtNum(r.offboarding)}</td>
        <td class="p-1.5 text-right font-bold">${ocFmtNum(r.onLeave)}</td>
        <td class="p-1.5 text-right font-bold ${varianceCls(r.variance)}">${r.variance == null ? '—' : r.variance}</td>
      </tr>`;
    }
    return `<tr class="border-t">
      <td class="p-1.5 text-center text-gray-500">${r.stt}</td>
      <td class="p-1.5">${escapeHtml(r.banPhong || '')}</td>
      <td class="p-1.5">${escapeHtml(r.banPhongBoPhan || '')}</td>
      <td class="p-1.5">${escapeHtml(r.boPhanNhom || '')}</td>
      <td class="p-1.5">${escapeHtml(r.chucDanh || '')}</td>
      <td class="p-1.5 text-center">${escapeHtml(r.capBac || '')}</td>
      <td class="p-1.5 text-center italic text-blue-600">${escapeHtml(r.maViTri || '')}</td>
      <td class="p-1.5 text-right font-bold text-blue-700">${r.quota == null ? '—' : r.quota}</td>
      <td class="p-1.5 text-right">${ocFmtNum(r.actualTotal)}</td>
      <td class="p-1.5 text-right">${ocFmtNum(r.secondary)}</td>
      <td class="p-1.5 text-right">${ocFmtNum(r.offboarding)}</td>
      <td class="p-1.5 text-right">${ocFmtNum(r.onLeave)}</td>
      <td class="p-1.5 text-right ${varianceCls(r.variance)}">${r.variance == null ? '—' : r.variance}</td>
    </tr>`;
  }).join('');
  tbody.innerHTML = rootRow + bodyRows;
}
async function openOrgChartHeadcountModal() {
  if (!_ocCurrentVersion) return;
  document.getElementById('btnOrgChartHeadcountExportXlsx').href = `/api/org-chart/versions/${_ocCurrentVersion.id}/headcount-report/export-xlsx`;
  document.getElementById('btnOrgChartHeadcountTemplateXlsx').href = `/api/org-chart/versions/${_ocCurrentVersion.id}/headcount-template/export-xlsx`;
  document.getElementById('orgChartHeadcountModal').classList.remove('hidden');
  document.getElementById('orgChartHeadcountTableBody').innerHTML = '<tr><td colspan="13" class="p-2 text-center text-gray-400">Đang tải...</td></tr>';
  try {
    const report = await orgChartApiCall('GET', `/api/org-chart/versions/${_ocCurrentVersion.id}/headcount-report`);
    renderOrgChartHeadcountTable(report);
  } catch (err) {
    document.getElementById('orgChartHeadcountTableBody').innerHTML = `<tr><td colspan="13" class="p-2 text-center text-red-600">⛔ ${escapeHtml(err.message)}</td></tr>`;
  }
}
function closeOrgChartHeadcountModal() {
  document.getElementById('orgChartHeadcountModal').classList.add('hidden');
}

// ===== Nhập Định Biên hàng loạt (11/2026) — KHÁC hẳn "Nhập Excel" cả cây: chỉ cập nhật headcountQuota
// của Vị Trí ĐÃ CÓ qua lib/orgChartHeadcountImport.js, không tạo bản mới, chỉ áp dụng được lên bản Nháp
// (server tự chặn — xem orgChart.requireDraft() trong route). Khoan dung theo dòng (giống đa số Excel
// Nhập khác), KHÁC "Nhập Excel" cả cây (tất-cả-hoặc-không-gì) — nên không cần màn xem trước/xác nhận
// riêng, upload xong là áp dụng luôn, hiện kết quả (số dòng cập nhật + dòng bị bỏ qua) ngay trong modal.
function openOrgChartHeadcountImportModal() {
  document.getElementById('orgChartHeadcountImportFileInput').value = '';
  document.getElementById('orgChartHeadcountImportResult').innerHTML = '';
  document.getElementById('orgChartHeadcountImportModal').classList.remove('hidden');
}
function closeOrgChartHeadcountImportModal() {
  document.getElementById('orgChartHeadcountImportModal').classList.add('hidden');
}
async function submitOrgChartHeadcountImport() {
  if (!_ocCurrentVersion) return;
  const fileInput = document.getElementById('orgChartHeadcountImportFileInput');
  const file = fileInput.files[0];
  const resultEl = document.getElementById('orgChartHeadcountImportResult');
  if (!file) { resultEl.innerHTML = '<p class="text-red-600">⛔ Vui lòng chọn file.</p>'; return; }
  resultEl.innerHTML = '<p class="text-gray-400">⏳ Đang nhập...</p>';
  const formData = new FormData();
  formData.append('file', file);
  let data;
  try {
    const res = await fetch(`/api/org-chart/versions/${_ocCurrentVersion.id}/headcount-template/import`, { method: 'POST', body: formData });
    data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
  } catch (err) {
    resultEl.innerHTML = `<p class="text-red-600">⛔ ${escapeHtml(err.message)}</p>`;
    return;
  }
  let html = `<p class="text-emerald-700 font-semibold">✅ Đã cập nhật Định Biên cho ${data.updatedCount} Vị Trí.</p>`;
  if (data.errors.length) {
    html += `<p class="text-amber-700 font-semibold mt-1">⚠️ ${data.errors.length} dòng bị bỏ qua:</p>` +
      `<ul class="list-disc pl-4 text-amber-700">${data.errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
  }
  resultEl.innerHTML = html;
  fileInput.value = '';
  await loadOrgChartCurrentVersion(_ocCurrentVersion.id);
  await openOrgChartHeadcountModal();
}

// ===== Tab "Cấu Hình Đánh Giá KPI" — chỉ thao tác trên version đang APPLIED =====
// Ô "Vị Trí Đánh Giá (cấp trên)"/"Vị Trí Được Đánh Giá" (11/2026, theo yêu cầu người dùng — "tôi muốn
// theo kiểu dropdown + searchable + single choice để tôi dễ dàng tìm kiếm"): đổi từ <select> liệt kê
// toàn bộ Vị Trí (dễ dài, khó tìm khi cây lớn) sang ô tìm-kiếm-gõ-chọn chuẩn "sdd*" (xem CLAUDE.md — toàn
// hệ thống KHÔNG dùng <datalist> native). KHÁC các ô "sdd*" khác trong hệ thống ở 1 điểm: giá trị thật
// cần gửi lên server là nodeId (số), KHÔNG PHẢI chuỗi hiển thị — widget sdd* chỉ lưu CHUỖI nhãn vào ô
// input (xem core.js). Giải: mỗi lựa chọn vẫn hiển thị ĐÚNG tên vị trí (ocBuildNodeDisplayName) làm nhãn,
// chỉ phụ thêm " (#id)" cho những nhãn BỊ TRÙNG (2 Vị Trí khác nhau nhưng cùng 1 tên hiển thị, vẫn có thể
// xảy ra — VD 2 "Nhân viên" cùng 1 Phòng Ban) để LUÔN phân biệt được, còn trường hợp phổ biến (nhãn không
// trùng ai) giữ nguyên sạch sẽ không có số. Submit tra ngược nodeId từ ĐÚNG nhãn đã chọn qua
// ocResolveKpiPositionInput() — không khớp được (gõ tự do, không bấm chọn từ gợi ý) thì chặn rõ ràng,
// không gửi NaN lên server.
function ocBuildKpiPositionOptions() {
  const positionNodes = (_ocAppliedVersion?.nodes || []).filter(n => n.nodeType === 'POSITION');
  const items = positionNodes.map(n => ({ id: n.nodeId, label: ocBuildNodeDisplayName(_ocAppliedVersion.nodes, n) }));
  const labelCounts = new Map();
  items.forEach(it => labelCounts.set(it.label, (labelCounts.get(it.label) || 0) + 1));
  return items
    .map(it => ({ value: String(it.id), label: labelCounts.get(it.label) > 1 ? `${it.label} (#${it.id})` : it.label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'vi'));
}
// Tra ngược nodeId (số) từ ĐÚNG nhãn đang hiện trong ô input — chỉ khớp khi người dùng THẬT SỰ bấm chọn 1
// gợi ý (nhãn trùng khớp tuyệt đối với 1 lựa chọn đã nạp qua sddSetOptions()), gõ tự do không khớp trả về
// null để nơi gọi tự chặn rõ ràng.
function ocResolveKpiPositionInput(dropdownId, inputValue) {
  const dd = document.getElementById(dropdownId);
  const match = (dd?._sddItems || []).find(it => it.label === inputValue);
  return match ? Number(match.value) : null;
}
async function renderOrgChartKpiFlowTab() {
  const container = document.getElementById('orgChartKpiFlowContainer');
  const evaluatorInput = document.getElementById('orgChartKpiEvaluatorSelect');
  const evaluateeInput = document.getElementById('orgChartKpiEvaluateeSelect');
  if (!_ocAppliedVersion) {
    container.innerHTML = '<p class="text-xs text-gray-400 italic">Chưa có phiên bản nào đang áp dụng.</p>';
    sddSetOptions('orgChartKpiEvaluatorDatalist', []);
    sddSetOptions('orgChartKpiEvaluateeDatalist', []);
    evaluatorInput.value = ''; evaluateeInput.value = '';
    return;
  }
  // KHÔNG còn admin bypass (11/2026, mở rộng "Nhân Sự" — xem canManageHrFeedback() ở lib/recordActions.js).
  const canManageKpiFlow = !!(currentUser.perms?.orgChartManage || currentUser.perms?.kpiFlowConfigManage);
  const kpiPositionOptions = ocBuildKpiPositionOptions();
  sddSetOptions('orgChartKpiEvaluatorDatalist', kpiPositionOptions);
  sddSetOptions('orgChartKpiEvaluateeDatalist', kpiPositionOptions);
  document.getElementById('btnAddOrgChartKpiFlow').classList.toggle('hidden', !canManageKpiFlow);

  let result;
  try {
    result = await orgChartApiCall('GET', '/api/org-chart/kpi-flow');
  } catch (err) {
    container.innerHTML = `<p class="text-xs text-red-600">⛔ ${escapeHtml(err.message)}</p>`;
    return;
  }
  const rows = result.rows || [];
  if (!rows.length) {
    container.innerHTML = '<p class="text-xs text-gray-400 italic">Chưa có quan hệ đánh giá nào.</p>';
    return;
  }
  container.innerHTML = rows.map(r => {
    const tag = r.isAutoFromHierarchy
      ? '<span class="text-[10px] font-bold px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">Tự động</span>'
      : '<span class="text-[10px] font-bold px-1.5 py-0.5 bg-teal-100 text-teal-800 rounded">Tuỳ chỉnh</span>';
    const removeBtn = canManageKpiFlow
      ? `<button type="button" data-op="removeOrgChartKpiFlowClick" data-arg0="${r.id}" class="text-[11px] px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-bold hover:bg-red-200 ml-2">Gỡ</button>` : '';
    return `<div class="bg-white border rounded p-2 flex flex-wrap items-center justify-between gap-1 text-xs">
      <span>${tag} <strong>${escapeHtml(r.evaluatorName)}</strong> đánh giá <strong>${escapeHtml(r.evaluateeName)}</strong></span>
      ${removeBtn}
    </div>`;
  }).join('');
}
async function addOrgChartKpiFlowClick() {
  const evaluatorInput = document.getElementById('orgChartKpiEvaluatorSelect');
  const evaluateeInput = document.getElementById('orgChartKpiEvaluateeSelect');
  const evaluatorNodeId = ocResolveKpiPositionInput('orgChartKpiEvaluatorDatalist', evaluatorInput.value);
  const evaluateeNodeId = ocResolveKpiPositionInput('orgChartKpiEvaluateeDatalist', evaluateeInput.value);
  if (!evaluatorNodeId) return alert('⛔ Vui lòng gõ tìm và BẤM CHỌN đúng 1 "Vị Trí Đánh Giá (cấp trên)" từ danh sách gợi ý.');
  if (!evaluateeNodeId) return alert('⛔ Vui lòng gõ tìm và BẤM CHỌN đúng 1 "Vị Trí Được Đánh Giá" từ danh sách gợi ý.');
  try {
    await orgChartApiCall('POST', '/api/org-chart/kpi-flow', { evaluatorNodeId, evaluateeNodeId });
  } catch (err) { return alert(`⛔ ${err.message}`); }
  evaluatorInput.value = ''; evaluateeInput.value = '';
  renderOrgChartKpiFlowTab();
}
async function removeOrgChartKpiFlowClick(rowId) {
  if (!confirm('Gỡ quan hệ đánh giá này?')) return;
  try {
    await orgChartApiCall('DELETE', `/api/org-chart/kpi-flow/${rowId}`);
  } catch (err) { return alert(`⛔ ${err.message}`); }
  renderOrgChartKpiFlowTab();
}

// Tra cứu người đánh giá KPI theo nhân viên — nhận value dạng sdd "Tên — Phòng (username)".
async function onOrgChartKpiLookupInput(rawValue) {
  const resultEl = document.getElementById('orgChartKpiLookupResult');
  const m = String(rawValue || '').match(/\(([^()]+)\)\s*$/);
  if (!m) { resultEl.innerHTML = ''; return; }
  const username = m[1].trim();
  let data;
  try {
    data = await orgChartApiCall('GET', `/api/org-chart/kpi-evaluators/${encodeURIComponent(username)}`);
  } catch (err) { resultEl.innerHTML = `<p class="text-red-600">⛔ ${escapeHtml(err.message)}</p>`; return; }
  const result = data.result;
  if (!result) { resultEl.innerHTML = '<p class="text-amber-700">⚠️ Nhân viên này không khớp vị trí nào trong cây đang áp dụng.</p>'; return; }
  if (!result.evaluatorGroups.length) { resultEl.innerHTML = `<p class="text-gray-600">Vị trí: <strong>${escapeHtml(result.positionName)}</strong> — chưa cấu hình người đánh giá.</p>`; return; }
  resultEl.innerHTML = `<p class="text-gray-600 mb-1">Vị trí: <strong>${escapeHtml(result.positionName)}</strong></p>` +
    result.evaluatorGroups.map(g => {
      const names = g.evaluators.length ? g.evaluators.map(e => escapeHtml(e.name)).join(', ') : '<span class="text-amber-600">chưa có ai giữ vị trí này</span>';
      return `<div>— ${escapeHtml(g.positionName)}: ${names}</div>`;
    }).join('');
}
