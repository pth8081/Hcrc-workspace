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

  const canManageTree = !!(currentUser.perms?.admin || currentUser.perms?.orgChartManage);
  document.getElementById('btnOrgChartCreateDraft').classList.toggle('hidden', !canManageTree);

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
  const canManageTree = !!(currentUser.perms?.admin || currentUser.perms?.orgChartManage);
  const isDraft = _ocCurrentVersion.status === 'DRAFT';
  const isArchived = _ocCurrentVersion.status === 'ARCHIVED';
  document.getElementById('btnOrgChartRenameVersion').classList.toggle('hidden', !(isDraft && canManageTree));
  document.getElementById('btnOrgChartValidateVersion').classList.toggle('hidden', !(isDraft && canManageTree));
  document.getElementById('btnOrgChartApplyVersion').classList.toggle('hidden', !(isDraft && canManageTree));
  // LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): trước đây không có cách nào xoá bản nháp không dùng
  // nữa — chỉ hiện với DRAFT (khớp deleteVersion() ở lib/orgChart.js, APPLIED/ARCHIVED phải giữ lịch sử).
  document.getElementById('btnOrgChartDeleteVersion').classList.toggle('hidden', !(isDraft && canManageTree));
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
  const canEdit = version.status === 'DRAFT' && !!(currentUser.perms?.admin || currentUser.perms?.orgChartManage);
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

// ===== "🖼️ Sơ Đồ Trực Quan" (yêu cầu nghiệp vụ 10/2026) — vẽ sơ đồ hình ảnh CHỈ tới cấp Phòng Ban
// (không đưa Vị Trí vào hình, theo đúng yêu cầu người dùng — Vị Trí vẫn xem đủ ở tab Cây), xem/tải về
// PNG-SVG. Dùng ĐÚNG version đang xem ở dropdown (_ocCurrentVersion), giống tab Cây — không giới hạn
// chỉ version APPLIED. SVG dựng bằng CHUỖI HTML nội suy (mirror renderNVFlow()/nvRoundedNode() ở
// module-nghiepvu.js — màu tô qua thuộc tính fill/stroke trực tiếp trên thẻ SVG, KHÔNG phải style="..."
// nên không vướng CSP style-src) thay vì createElementNS(), khớp đúng quy ước SVG duy nhất đã có sẵn
// trong toàn bộ client.
function ocBuildDepartmentTree(nodes) {
  const list = nodes || [];
  const byId = new Map(list.map(n => [n.nodeId, n]));
  const root = list.find(n => n.nodeType === 'COMPANY') || list.find(n => n.parentNodeId == null);
  if (!root) return null;
  // Tìm tổ tiên gần nhất là DEPARTMENT/COMPANY, BỎ QUA mọi node POSITION nằm giữa (VD "Tổng Giám Đốc"
  // là POSITION đứng giữa Công Ty và các Phòng Ban) — mirror ý tưởng ocFindNearestDeptAncestor() ở trên,
  // chỉ khác là áp dụng đệ quy cho MỌI Phòng Ban thay vì chỉ tìm 1 lần cho 1 node.
  function nearestDeptOrCompanyAncestorId(node) {
    let cur = byId.get(node.parentNodeId);
    let steps = 0;
    while (cur && steps < 100) {
      if (cur.nodeType === 'DEPARTMENT' || cur.nodeType === 'COMPANY') return cur.nodeId;
      cur = byId.get(cur.parentNodeId);
      steps++;
    }
    return null;
  }
  const treeRoot = { id: root.nodeId, type: 'COMPANY', name: root.nodeName, children: [] };
  const byTreeId = new Map([[root.nodeId, treeRoot]]);
  const depts = list.filter(n => n.nodeType === 'DEPARTMENT');
  depts.forEach(n => byTreeId.set(n.nodeId, { id: n.nodeId, type: 'DEPARTMENT', name: n.nodeName, children: [] }));
  depts.forEach(n => {
    const parentId = nearestDeptOrCompanyAncestorId(n);
    const parentTreeNode = (parentId != null && byTreeId.get(parentId)) || treeRoot;
    parentTreeNode.children.push(byTreeId.get(n.nodeId));
  });
  return treeRoot;
}

const OC_DIAGRAM_SLOT_W = 196, OC_DIAGRAM_LEVEL_H = 118, OC_DIAGRAM_MARGIN = 40;
const OC_DIAGRAM_BOX_W = { COMPANY: 240, DEPARTMENT: 178 };
const OC_DIAGRAM_BOX_H = { COMPANY: 62, DEPARTMENT: 50 };
const OC_DIAGRAM_FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif"; // KHÔNG dùng web font — canvas
// rasterize SVG lúc xuất PNG không chắc tải được font ngoài (xem downloadOrgChartDiagramPng()).

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

function ocDiagramAssignXY(node, depth, cursorRef) {
  node._depth = depth;
  node._y = OC_DIAGRAM_MARGIN + depth * OC_DIAGRAM_LEVEL_H;
  if (!node.children.length) {
    node._x = cursorRef.x + OC_DIAGRAM_SLOT_W / 2;
    cursorRef.x += OC_DIAGRAM_SLOT_W;
    return;
  }
  node.children.forEach(c => ocDiagramAssignXY(c, depth + 1, cursorRef));
  const first = node.children[0], last = node.children[node.children.length - 1];
  node._x = (first._x + last._x) / 2;
}

// Chiều cao THÊM cho mỗi dòng tên vượt quá 1 dòng (dòng 2 trở đi) — 1 dòng vẫn giữ NGUYÊN
// OC_DIAGRAM_BOX_H[node.type] như trước (không đổi hành vi cho tên ngắn, đa số trường hợp thật tế).
const OC_DIAGRAM_EXTRA_LINE_H = 16;
// Padding ngang trong khung + số ký tự coi như "chiếm chỗ" bởi icon 🏢/📁 đứng đầu dòng 1 (emoji rộng
// hơn ký tự thường ~1.5-2 lần) — trừ vào ngân sách ký tự ước lượng cho AN TOÀN thay vì tính riêng từng
// dòng (đơn giản hoá, chấp nhận dòng 2 hơi rộng rãi hơn cần thiết một chút).
const OC_DIAGRAM_TEXT_PAD_X = 12;
const OC_DIAGRAM_ICON_CHARS = 2.5;

function ocPrepareNodeLines(node) {
  const isCompany = node.type === 'COMPANY';
  const fontSize = isCompany ? 15 : 12.5;
  const maxChars = ocEstimateMaxChars(OC_DIAGRAM_BOX_W[node.type], fontSize, OC_DIAGRAM_TEXT_PAD_X) - OC_DIAGRAM_ICON_CHARS;
  node._nameLines = ocWrapLines(node.name, maxChars);
  node._h = OC_DIAGRAM_BOX_H[node.type] + Math.max(0, node._nameLines.length - 1) * OC_DIAGRAM_EXTRA_LINE_H;
}

function ocRenderDepartmentDiagram(root) {
  ocDiagramAssignXY(root, 0, { x: OC_DIAGRAM_MARGIN });
  let maxDepth = 0, maxX = 0;
  (function scan(n) {
    ocPrepareNodeLines(n);
    maxDepth = Math.max(maxDepth, n._depth);
    maxX = Math.max(maxX, n._x + OC_DIAGRAM_BOX_W[n.type] / 2);
    n.children.forEach(scan);
  })(root);
  const width = Math.round(maxX + OC_DIAGRAM_MARGIN);
  // Chiều cao tổng: cộng dồn phần "vượt chuẩn" (so với 1 dòng) của node CAO NHẤT ở mỗi cấp, để khung
  // hình luôn đủ chỗ cho tên dài xuống 2 dòng mà không bị cấp dưới đè lên (trước đây LUÔN cố định
  // (maxDepth+1)*LEVEL_H, không tính blaị tên dài nào từng làm khung cao hơn 1 dòng).
  const extraHByDepth = new Array(maxDepth + 1).fill(0);
  (function scanExtra(n) {
    extraHByDepth[n._depth] = Math.max(extraHByDepth[n._depth], n._h - OC_DIAGRAM_BOX_H[n.type]);
    n.children.forEach(scanExtra);
  })(root);
  const totalExtraH = extraHByDepth.reduce((a, b) => a + b, 0);
  const height = Math.round(OC_DIAGRAM_MARGIN + (maxDepth + 1) * OC_DIAGRAM_LEVEL_H + totalExtraH + 16);

  let linesSvg = '', nodesSvg = '';
  function drawConnectors(node) {
    if (!node.children.length) return;
    const pBottom = node._y + node._h / 2;
    const busY = pBottom + (OC_DIAGRAM_LEVEL_H - node._h / 2 - node.children[0]._h / 2) / 2;
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
  drawConnectors(root);

  function drawNode(node) {
    const w = OC_DIAGRAM_BOX_W[node.type], h = node._h;
    const x = node._x - w / 2, y = node._y - h / 2;
    const nameLines = node._nameLines;
    if (node.type === 'COMPANY') {
      nodesSvg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#0d3b3a"/>`;
      // Khối 2 dòng cố định (tên + "Trụ sở chính") CĂN GIỮA quanh tâm — tên xuống thêm dòng nào thì cả
      // khối dời lên theo (mirror cách nvRoundedNode() căn giữa label+sub ở module-nghiepvu.js).
      const totalLines = nameLines.length + 1;
      const blockTop = node._y - (totalLines - 1) * 9.5;
      nameLines.forEach((line, i) => {
        const icon = i === 0 ? '🏢 ' : '';
        nodesSvg += `<text x="${node._x}" y="${blockTop + i * 19}" text-anchor="middle" font-family="${OC_DIAGRAM_FONT}" font-size="15" font-weight="700" fill="#f2fbf9">${icon}${escapeHtml(line)}</text>`;
      });
      nodesSvg += `<text x="${node._x}" y="${blockTop + nameLines.length * 19}" text-anchor="middle" font-family="${OC_DIAGRAM_FONT}" font-size="10.5" fill="#a9d6cd">Trụ sở chính</text>`;
    } else {
      nodesSvg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#e3f4f1" stroke="#0f766e" stroke-width="1.5"/>`;
      const blockTop = node._y - (nameLines.length - 1) * 8 + 5;
      nameLines.forEach((line, i) => {
        const icon = i === 0 ? '📁 ' : '';
        nodesSvg += `<text x="${node._x}" y="${blockTop + i * 16}" text-anchor="middle" font-family="${OC_DIAGRAM_FONT}" font-size="12.5" font-weight="700" fill="#0d3b3a">${icon}${escapeHtml(line)}</text>`;
      });
    }
    node.children.forEach(drawNode);
  }
  drawNode(root);

  const svgHTML = `<svg id="orgChartDiagramSvg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Sơ đồ tổ chức theo cấp Phòng Ban">${linesSvg}${nodesSvg}</svg>`;
  return { svgHTML, width, height };
}

function renderOrgChartDiagramTab() {
  const container = document.getElementById('orgChartDiagramContainer');
  const version = _ocCurrentVersion;
  if (!version) { container.innerHTML = ''; return; }
  const root = ocBuildDepartmentTree(version.nodes || []);
  if (!root) { container.innerHTML = '<p class="text-xs text-gray-400 italic">Không tìm thấy node gốc Công Ty.</p>'; return; }
  container.innerHTML = ocRenderDepartmentDiagram(root).svgHTML;
}

// Tên file gợi ý từ tên phiên bản (bỏ dấu, chỉ chữ-số-gạch ngang) — mirror pattern slugify đã dùng ở
// nhiều nơi khác trong hệ thống (VD slugifyKey() ở routes/positionTypes.js).
function ocDiagramFilenameBase() {
  const name = (_ocCurrentVersion?.versionName || 'so-do-to-chuc').trim();
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return slug || 'so-do-to-chuc';
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
      const nameOrTitle = it.nodeType === 'POSITION' ? it.jobTitle : it.nodeName;
      return `<tr class="${it.valid ? '' : 'bg-red-50'}">
        <td class="p-1 font-mono">${escapeHtml(it.nodeKey)}</td>
        <td class="p-1 font-mono">${escapeHtml(it.parentKey || '')}</td>
        <td class="p-1">${escapeHtml(it.nodeTypeLabel || '')}</td>
        <td class="p-1">${escapeHtml(nameOrTitle || '')}</td>
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
async function applyOrgChartVersionClick() {
  if (!_ocCurrentVersion) return;
  if (!confirm(`Áp dụng phiên bản "${_ocCurrentVersion.versionName}"? Phiên bản đang áp dụng hiện tại (nếu có) sẽ chuyển sang Lưu Trữ.`)) return;
  let result;
  try {
    result = await orgChartApiCall('POST', `/api/org-chart/versions/${_ocCurrentVersion.id}/apply`, {});
  } catch (err) { return alert(`⛔ ${err.message}`); }
  // Yêu cầu nghiệp vụ (10/2026): Áp Dụng xong tự chuyển sang sub-tab "🖼️ Sơ Đồ Trực Quan" để thấy ngay
  // sơ đồ cấp Phòng Ban vừa cập nhật, không phải tự bấm qua — đặt TRƯỚC renderOrgChartModule() vì hàm đó
  // tự gọi setOrgChartSubTab(activeOrgChartSubTab) ở bước cuối.
  activeOrgChartSubTab = 'DIAGRAM';
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
  const select = document.getElementById('orgChartNodeDeptRefSelect');
  const options = ['-- Không liên kết phòng ban thật --', ...(DB.depts || []), ...(DB.stores || [])];
  select.innerHTML = options.map(d => `<option value="${d.startsWith('--') ? '' : escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  select.value = selectedValue || '';
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
  ocPopulateNodeDeptRefSelect('');
  ocPopulateJobTitleDatalist();
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
  } else {
    ocPopulateJobTitleDatalist();
    document.getElementById('orgChartNodeNameInput').value = node.nodeName || '';
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
    payload.departmentRef = document.getElementById('orgChartNodeDeptRefSelect').value || null;
    if (!payload.nodeName) return alert('⛔ Vui lòng nhập Tên Hiển Thị.');
  }
  try {
    if (orgChartNodeModalMode === 'ADD') {
      payload.parentNodeId = orgChartNodeModalParentId;
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
  } catch (err) { return alert(`⛔ ${err.message}`); }
  await loadOrgChartCurrentVersion(_ocCurrentVersion.id);
  renderOrgChartTree();
}

// ===== Báo Cáo Định Biên Nhân Sự (10/2026) =====
function ocFmtNum(n) {
  if (n == null) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
function renderOrgChartHeadcountTable(rows) {
  const tbody = document.getElementById('orgChartHeadcountTableBody');
  const LEVEL_CLS = { 0: 'font-bold bg-teal-50', 1: 'font-bold bg-gray-50' };
  tbody.innerHTML = rows.map(r => {
    const indent = '&nbsp;'.repeat(r.level * 4);
    const rowCls = r.nodeType === 'POSITION' ? '' : (LEVEL_CLS[r.level] || 'font-semibold');
    const varianceCls = r.variance == null ? '' : r.variance > 0 ? 'text-amber-700 font-bold' : r.variance < 0 ? 'text-red-600 font-bold' : '';
    return `<tr class="border-t ${rowCls}">
      <td class="p-1.5">${indent}${r.nodeType === 'POSITION' ? '💺 ' : r.nodeType === 'DEPARTMENT' ? '🏢 ' : ''}${escapeHtml(r.displayName || '')}</td>
      <td class="p-1.5">${escapeHtml(r.jobTitle || '')}</td>
      <td class="p-1.5">${escapeHtml(r.jobGrade || '')}</td>
      <td class="p-1.5 text-right">${r.quota == null ? '—' : r.quota}</td>
      <td class="p-1.5 text-right">${ocFmtNum(r.actualTotal)}</td>
      <td class="p-1.5 text-right ${varianceCls}">${r.variance == null ? '—' : r.variance}</td>
      <td class="p-1.5 text-right">${r.active}</td>
      <td class="p-1.5 text-right">${r.offboarding}</td>
      <td class="p-1.5 text-right">${r.onLeave}</td>
      <td class="p-1.5 text-right">${ocFmtNum(r.secondary)}</td>
    </tr>`;
  }).join('');
}
async function openOrgChartHeadcountModal() {
  if (!_ocCurrentVersion) return;
  document.getElementById('btnOrgChartHeadcountExportXlsx').href = `/api/org-chart/versions/${_ocCurrentVersion.id}/headcount-report/export-xlsx`;
  document.getElementById('orgChartHeadcountModal').classList.remove('hidden');
  document.getElementById('orgChartHeadcountTableBody').innerHTML = '<tr><td colspan="10" class="p-2 text-center text-gray-400">Đang tải...</td></tr>';
  try {
    const { rows } = await orgChartApiCall('GET', `/api/org-chart/versions/${_ocCurrentVersion.id}/headcount-report`);
    renderOrgChartHeadcountTable(rows);
  } catch (err) {
    document.getElementById('orgChartHeadcountTableBody').innerHTML = `<tr><td colspan="10" class="p-2 text-center text-red-600">⛔ ${escapeHtml(err.message)}</td></tr>`;
  }
}
function closeOrgChartHeadcountModal() {
  document.getElementById('orgChartHeadcountModal').classList.add('hidden');
}

// ===== Tab "Cấu Hình Đánh Giá KPI" — chỉ thao tác trên version đang APPLIED =====
async function renderOrgChartKpiFlowTab() {
  const container = document.getElementById('orgChartKpiFlowContainer');
  if (!_ocAppliedVersion) {
    container.innerHTML = '<p class="text-xs text-gray-400 italic">Chưa có phiên bản nào đang áp dụng.</p>';
    document.getElementById('orgChartKpiEvaluatorSelect').innerHTML = '';
    document.getElementById('orgChartKpiEvaluateeSelect').innerHTML = '';
    return;
  }
  const canManageKpiFlow = !!(currentUser.perms?.admin || currentUser.perms?.orgChartManage || currentUser.perms?.kpiFlowConfigManage);
  const positionNodes = (_ocAppliedVersion.nodes || []).filter(n => n.nodeType === 'POSITION');
  const optionsHtml = positionNodes
    .map(n => ({ id: n.nodeId, label: ocBuildNodeDisplayName(_ocAppliedVersion.nodes, n) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'vi'))
    .map(o => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('');
  document.getElementById('orgChartKpiEvaluatorSelect').innerHTML = optionsHtml;
  document.getElementById('orgChartKpiEvaluateeSelect').innerHTML = optionsHtml;
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
  const evaluatorNodeId = Number(document.getElementById('orgChartKpiEvaluatorSelect').value);
  const evaluateeNodeId = Number(document.getElementById('orgChartKpiEvaluateeSelect').value);
  try {
    await orgChartApiCall('POST', '/api/org-chart/kpi-flow', { evaluatorNodeId, evaluateeNodeId });
  } catch (err) { return alert(`⛔ ${err.message}`); }
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
