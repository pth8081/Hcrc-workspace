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

// ===== Sub-tab TREE / KPI =====
function setOrgChartSubTab(subTab) {
  activeOrgChartSubTab = subTab;
  document.getElementById('orgChartTreeView').classList.toggle('hidden', subTab !== 'TREE');
  document.getElementById('orgChartKpiView').classList.toggle('hidden', subTab !== 'KPI');
  const activeCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-teal-700 text-white';
  const inactiveCls = 'px-2.5 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700 hover:bg-gray-300';
  document.getElementById('btnOrgChartSubTree').className = subTab === 'TREE' ? activeCls : inactiveCls;
  document.getElementById('btnOrgChartSubKpi').className = subTab === 'KPI' ? activeCls : inactiveCls;
  if (subTab === 'TREE') renderOrgChartTree();
  else renderOrgChartKpiFlowTab();
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
function ocPopulateJobTitleDatalist() {
  const office = DB.jobTitles || [];
  const store = (DB.storeJobTitles || []).map(t => t.label).filter(Boolean);
  sddSetOptions('orgChartJobTitleDatalist', [...new Set([...office, ...store])].sort((a, b) => a.localeCompare(b, 'vi')).map(t => ({ label: t, value: t })));
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
  ocPopulateJobTitleDatalist();
  if (node.nodeType === 'POSITION') {
    document.getElementById('orgChartNodeJobTitleInput').value = node.jobTitle || '';
    document.getElementById('orgChartNodeRequiresDeptCheckbox').checked = node.requiresDept !== false;
  } else {
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
    if (!payload.jobTitle) return alert('⛔ Vui lòng nhập Chức Danh.');
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
