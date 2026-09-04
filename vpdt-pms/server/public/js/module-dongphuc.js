// ==========================================
// ĐỒNG PHỤC — module con Hành Chính: Hành Chính (uniformManage) tạo "kỳ cấp phát" phân bổ đồng phục
// xuống từng siêu thị; Giám Đốc Siêu Thị (uniformStoreManage) xác nhận đã nhận rồi cấp cho nhân viên.
// "Kho" KHÔNG lưu thành bảng riêng — luôn tính động từ allocations đã CONFIRMED trừ đi uniformIssuances
// (xem computeUniformStock() ở lib/recordActions.js, hàm computeUniformStockClient() dưới đây là bản
// mirror phía client để hiển thị tức thời không cần gọi lại server).
// ==========================================
let activeUniformSubTab = 'STOCK';
let uniformAllocBlocks = [];
let uniformIssueItems = [];
let uniformStoreEmployeesCache = [];

function canManageUniform(user) {
  return !!(user?.perms?.admin || user?.perms?.uniformManage);
}
function canManageUniformStore(user) {
  return !!(user?.perms?.admin || user?.perms?.uniformStoreManage);
}
// uniformApprove (Phase 2) — duyệt/từ chối kỳ cấp phát VÀ điều chuyển kho (DÙNG CHUNG 1 quyền, không
// tách riêng — xem lib/recordActions.js canApproveUniform()/canApproveUniformTransfer()).
// uniformManage được GỘP thêm năng lực này (khớp canApproveUniform() server) — người tạo kỳ tự duyệt
// được kỳ mình tạo, không cần cấp thêm quyền uniformApprove riêng.
function canApproveUniformClient(user) {
  return !!(user?.perms?.admin || user?.perms?.uniformApprove || user?.perms?.uniformManage);
}

function setUniformSubTab(subTab) {
  window.scrollTo({ top: 0, behavior: 'auto' }); // Tránh "bay xuống cuối" khi đổi tab con — xem setSystemSubTab().
  const canHc = canManageUniform(currentUser);
  const canStore = canManageUniformStore(currentUser);
  const canApprove = canApproveUniformClient(currentUser);
  // Phase 2: uniformApprove (không kèm uniformManage/uniformStoreManage) vẫn cần vào ĐƯỢC tab "Kỳ Cấp
  // Phát" (duyệt/từ chối kỳ) và "Xác Nhận/Cấp Phát" (duyệt/từ chối điều chuyển kho) — nếu không, người
  // chỉ giữ quyền duyệt sẽ không bao giờ tới được màn duyệt (2 nút bấm tab này trước đây CHỈ hiện cho
  // canHc/canStore, xem canAccessUniformModule() đã mở quyền vào MODULE nhưng chưa mở quyền vào TAB).
  const canSeePeriods = canHc || canApprove;
  const canSeeStore = canStore || canApprove;
  if (subTab === 'PERIODS' && !canSeePeriods) subTab = canSeeStore ? 'STORE' : 'STOCK';
  if (subTab === 'STORE' && !canSeeStore) subTab = canSeePeriods ? 'PERIODS' : 'STOCK';
  // EMPLOYEES (mục 4b) — CHỈ dành cho HO (canHc), không có nhánh dự phòng nào khác (khác PERIODS/STORE
  // ở trên vốn còn approver-only truy cập được) — không đủ quyền thì rơi về STOCK (mở cho mọi người
  // trong module, xem canAccessUniformModule()).
  if (subTab === 'EMPLOYEES' && !canHc) subTab = 'STOCK';
  activeUniformSubTab = subTab;

  document.getElementById('uniformSubPeriods').classList.toggle('hidden', subTab !== 'PERIODS');
  document.getElementById('uniformSubStore').classList.toggle('hidden', subTab !== 'STORE');
  document.getElementById('uniformSubStock').classList.toggle('hidden', subTab !== 'STOCK');
  document.getElementById('uniformSubDashboard').classList.toggle('hidden', subTab !== 'DASHBOARD');
  document.getElementById('uniformSubEmployees').classList.toggle('hidden', subTab !== 'EMPLOYEES');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-teal-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnUniformSubPeriods').className = (subTab === 'PERIODS' ? activeCls : inactiveCls) + (canSeePeriods ? '' : ' hidden');
  document.getElementById('btnUniformSubStore').className = (subTab === 'STORE' ? activeCls : inactiveCls) + (canSeeStore ? '' : ' hidden');
  document.getElementById('btnUniformSubStock').className = subTab === 'STOCK' ? activeCls : inactiveCls;
  document.getElementById('btnUniformSubDashboard').className = subTab === 'DASHBOARD' ? activeCls : inactiveCls;
  // "Quản Lý Nhân Viên Siêu Thị" (mục 4b) — CHỈ dành cho HO (canHc, gate y hệt sub-tab PERIODS hiện
  // tại) — KHÔNG mở thêm cho uniformStoreManage/canApprove (họ tự có màn "Xác Nhận/Cấp Phát" riêng đúng
  // phạm vi siêu thị mình, không cần/không nên tạo tài khoản cho siêu thị khác).
  document.getElementById('btnUniformSubEmployees').className = (subTab === 'EMPLOYEES' ? activeCls : inactiveCls) + (canHc ? '' : ' hidden');

  if (subTab === 'PERIODS') {
    renderUniformCatalogList(); resetUniformPeriodForm(); renderUniformPeriodsList();
    // Form "Tạo Kỳ Cấp Phát" chỉ dành cho uniformManage/admin — approver-only vào tab này CHỈ để
    // duyệt/từ chối, không tạo kỳ mới được (server cũng chặn nếu cố gọi thẳng API).
    document.getElementById('uniformCreatePeriodBlock')?.classList.toggle('hidden', !canHc);
  }
  if (subTab === 'STORE') {
    renderUniformPendingAllocations(); renderUniformIssueEmployeeOptions(); resetUniformIssueForm(); renderUniformIssuancesTable();
    renderUniformHoldingsTable(); resetUniformAdjustForms(); renderUniformAdjustmentsTable();
    resetUniformTransferForm(); renderUniformTransferApprovalQueue(); renderUniformTransfersTable();
  }
  if (subTab === 'STOCK') { renderUniformStockStoreFilterOptions(); renderUniformStock(); }
  if (subTab === 'DASHBOARD') { renderUniformDashboard(); }
  if (subTab === 'EMPLOYEES') { resetUniformEmployeeCreateForm(); renderUniformEmployeesList(); }
}

// ============ Quản Lý Nhân Viên Siêu Thị (mục 4b) — HO (uniformManage/admin) tạo/khoá tài khoản nhân
// viên CHO các siêu thị, đi qua route riêng POST/PATCH /api/uniform/employees (routes/uniformEmployees.js
// — KHÔNG qua POST /api/data/users vì route đó khoá cứng isCurrentlyAdmin() thật, uniformManage không đủ
// quyền). Form rút gọn KHÔNG có ô chọn Vị Trí (ngầm định STORE) — nhưng có ĐÚNG 1 ô chọn quyền: dropdown
// "Nhóm Quyền" (ueGroupId), bắt buộc chọn 1 trong các nhóm phân quyền scope==='STORE' (xem
// populateUniformEmployeeGroupOptions()). Server luôn ép posType:'STORE' và re-validate lại group.scope
// trước khi gán perms — client không gửi field perms nào cả. ============
function populateUniformEmployeeGroupOptions() {
  const sel = document.getElementById('ueGroupId');
  if (!sel) return;
  const storeGroups = (DB.permGroups || []).filter(g => g.scope === 'STORE');
  sel.innerHTML = '<option value="">-- Chọn Nhóm Quyền --</option>' +
    storeGroups.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('');
  // Pre-chọn nhóm mặc định (nếu có) hoặc nhóm đầu tiên, để giảm thao tác — admin vẫn đổi được.
  if (storeGroups.some(g => g.id === 'grp_store_default')) sel.value = 'grp_store_default';
  else if (storeGroups.length) sel.value = storeGroups[0].id;
}

function resetUniformEmployeeCreateForm() {
  const form = document.querySelector('#uniformSubEmployees form');
  if (form) form.reset();
  const storeSel = document.getElementById('ueStore');
  if (storeSel) {
    storeSel.innerHTML = '<option value="">-- Chọn Siêu Thị --</option>' +
      (DB.stores || []).map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  }
  const jobTitleSel = document.getElementById('ueJobTitle');
  if (jobTitleSel) {
    // Chức danh bị đánh dấu "Khoá tự tạo" (restrictedFromSelfService) KHÔNG hiện ở đây — hạn chế đó chỉ
    // áp dụng cho đúng form rút gọn này (form Người Dùng đầy đủ của Admin vẫn chọn được mọi chức danh).
    const options = (DB.storeJobTitles || []).filter(t => !t.restrictedFromSelfService);
    jobTitleSel.innerHTML = '<option value="">-- Chưa gán chức danh --</option>' +
      options.map(t => `<option value="${escapeHtml(t.label)}">${escapeHtml(t.label)}</option>`).join('');
  }
  populateUniformEmployeeGroupOptions();
}

async function submitUniformEmployeeCreate(e) {
  e.preventDefault();
  const groupId = document.getElementById('ueGroupId').value;
  if (!groupId) return alert('Vui lòng chọn Nhóm Quyền!');
  const payload = {
    username: document.getElementById('ueUsername').value.trim(),
    password: document.getElementById('uePassword').value,
    fullName: document.getElementById('ueFullName').value.trim(),
    email: document.getElementById('ueEmail').value.trim(),
    phone: document.getElementById('uePhone').value.trim(),
    dept: document.getElementById('ueStore').value,
    jobTitle: document.getElementById('ueJobTitle').value,
    groupId
  };
  try {
    const res = await fetch('/api/uniform/employees', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    DB.users.push(body.user);
    logSystemAction('USER_MGM', 'CREATE_UNIFORM_EMPLOYEE', `Tạo tài khoản nhân viên siêu thị [${body.user.username}] (${body.user.dept})`, 'SUCCESS', body.user.username);
    alert(`✅ Đã tạo tài khoản "${body.user.username}" cho siêu thị "${body.user.dept}"!`);
    resetUniformEmployeeCreateForm();
    renderUniformEmployeesList();
  } catch (err) {
    alert(`⛔ Lỗi tạo tài khoản: ${err.message}`);
  }
}

function renderUniformEmployeesList() {
  const tbody = document.getElementById('ueEmployeesTableBody');
  if (!tbody) return;
  const showInactive = !!document.getElementById('ueShowInactive')?.checked;
  const query = (document.getElementById('ueSearchInput')?.value || '').trim().toLowerCase();
  let rows = (DB.users || []).filter(u => u.posType === 'STORE');
  if (!showInactive) rows = rows.filter(u => u.active !== false);
  if (query) {
    rows = rows.filter(u =>
      (u.name || '').toLowerCase().includes(query) ||
      (u.username || '').toLowerCase().includes(query) ||
      (u.dept || '').toLowerCase().includes(query)
    );
  }
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-gray-400 italic p-3">Không có nhân viên siêu thị nào khớp.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(u => {
    const group = (DB.permGroups || []).find(g => g.id === (u.groupIds || [])[0]);
    return `
    <tr class="${u.active === false ? 'opacity-50' : ''}">
      <td class="border p-1.5">${escapeHtml(u.username)}</td>
      <td class="border p-1.5">${escapeHtml(u.name || '')}</td>
      <td class="border p-1.5">${escapeHtml(u.dept || '')}</td>
      <td class="border p-1.5">${escapeHtml(u.jobTitle || '—')}</td>
      <td class="border p-1.5">${escapeHtml(group ? group.name : '—')}</td>
      <td class="border p-1.5">${u.active === false ? '<span class="text-red-600 font-semibold">🔒 Đã khoá</span>' : '<span class="text-emerald-600 font-semibold">✅ Hoạt động</span>'}</td>
      <td class="border p-1.5 text-center">
        ${u.active === false ? '' : `<button type="button" data-op="lockUniformEmployeeAction" data-arg0="${u.id}" class="text-red-500 font-bold hover:underline">🔒 Khoá</button>`}
      </td>
    </tr>
  `;
  }).join('');
}

// Khoá 1 CHIỀU (route server chỉ nhận active:false, xem PATCH /api/uniform/employees/:id/active) — mở
// khoá lại phải qua màn Người Dùng đầy đủ của Admin (toggleUserActive()), đúng xác nhận của người dùng.
async function lockUniformEmployeeAction(id) {
  const u = DB.users.find(x => x.id === id);
  if (!u) return;
  if (!confirm(`Khoá tài khoản "${u.username}" (${u.name})?\n\nSau khi khoá, người này sẽ KHÔNG đăng nhập được nữa. Muốn mở khoá lại phải nhờ Admin thực hiện ở màn Người Dùng (Hệ Thống → Quản Trị).`)) return;
  try {
    const res = await fetch(`/api/uniform/employees/${id}/active`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    const idx = DB.users.findIndex(x => x.id === id);
    if (idx !== -1) DB.users[idx] = body.user;
    logSystemAction('USER_MGM', 'DEACTIVATE_UNIFORM_EMPLOYEE', `Khoá nhân viên siêu thị [${u.username}]`, 'SUCCESS', u.username);
    renderUniformEmployeesList();
  } catch (err) {
    alert(`⛔ Lỗi khoá tài khoản: ${err.message}`);
  }
}

// Mã SKU (Phase 2) — sinh 1 LẦN lúc Giám Đốc Siêu Thị xác nhận nhận LẦN ĐẦU 1 (mặt hàng,size), lưu
// trong DB.uniformCatalog[].codesBySize[size] (mirror backfillUniformSkuCodes() ở
// lib/recordActions.js) — TÁI SỬ DỤNG cho mọi siêu thị/kỳ khác xác nhận cùng (mặt hàng,size) sau đó.
// Trả về '' nếu chưa từng được xác nhận ở đâu cả (chưa sinh mã).
function uniformSkuFor(name, size) {
  const entry = (DB.uniformCatalog || []).find(c => c.name === name);
  return entry?.codesBySize?.[size || ''] || '';
}
// Định dạng hiển thị CHUẨN "loại — cỡ — mã" dùng chung mọi nơi liệt kê đồng phục (danh mục, dropdown
// cấp phát, bảng tồn kho, bảng đang giữ) — mã bỏ qua nếu chưa sinh (kỳ chưa từng được xác nhận).
function formatUniformLabel(name, size, code) {
  const parts = [name, size || '—'];
  if (code) parts.push(code);
  return parts.map(escapeHtml).join(' — ');
}

function uniformItemsSummary(items) {
  return (items || []).map(it => {
    const code = uniformSkuFor(it.name, it.size);
    return `${formatUniformLabel(it.name, it.size, code)}: ${it.qty}`;
  }).join(', ') || '—';
}

// ============ Danh Mục Đồng Phục (Quản Trị Viên / Hành Chính thêm/sửa/xoá — xem ADMIN_ONLY_KEYS +
// isCurrentlyAdminOrUniformManage() ở routes/data.js) ============
function renderUniformCatalogList() {
  const wrap = document.getElementById('uniformCatalogListWrap');
  const form = document.getElementById('uniformCatalogAdminForm');
  if (!wrap) return;
  const canEdit = !!currentUser.perms?.admin || canManageUniform(currentUser);
  if (form) form.classList.toggle('hidden', !canEdit);
  const catalog = DB.uniformCatalog || [];
  if (!catalog.length) {
    wrap.innerHTML = `<div class="text-xs text-gray-500 italic bg-white p-3 rounded border">Chưa có mặt hàng nào trong danh mục.</div>`;
    return;
  }
  wrap.innerHTML = catalog.map(c => `
    <div class="bg-white p-2.5 rounded border flex items-center justify-between gap-2 flex-wrap">
      <div>
        <span class="font-bold text-slate-800 text-xs">${escapeHtml(c.name)}</span>
        <div class="text-[11px] text-gray-500 mt-0.5">
          ${(c.sizes || []).map(s => `<span class="inline-block mr-2">${escapeHtml(s)}${c.codesBySize?.[s] ? ` <span class="text-cyan-700 font-mono">(${escapeHtml(c.codesBySize[s])})</span>` : ' <span class="italic">(chưa có mã)</span>'}</span>`).join('') || 'Không có size'}
        </div>
      </div>
      ${canEdit ? `<button type="button" data-op="deleteUniformCatalogItem" data-arg0="${c.id}" class="text-red-600 hover:text-red-800 text-xs font-bold">🗑️ Xóa</button>` : ''}
    </div>
  `).join('');
}

function saveUniformCatalogItem() {
  const name = document.getElementById('uniformCatalogName').value.trim();
  const sizesRaw = document.getElementById('uniformCatalogSizes').value.trim();
  if (!name) return alert('Vui lòng nhập tên đồng phục!');
  const sizes = sizesRaw.split(',').map(s => s.trim()).filter(Boolean);
  if (!sizes.length) return alert('Vui lòng nhập ít nhất 1 size (cách nhau bằng dấu phẩy)!');
  if ((DB.uniformCatalog || []).some(c => c.name === name)) return alert('Mặt hàng này đã có trong danh mục!');
  const nextId = (Math.max(0, ...(DB.uniformCatalog || []).map(c => c.id)) || 0) + 1;
  DB.uniformCatalog = [...(DB.uniformCatalog || []), { id: nextId, name, sizes, codesBySize: {} }];
  syncStorage('uniformCatalog');
  logSystemAction('UNIFORM', 'ADD_UNIFORM_CATALOG', `Thêm mặt hàng vào Danh Mục Đồng Phục [${name}]`, 'SUCCESS', name);
  document.getElementById('uniformCatalogName').value = '';
  document.getElementById('uniformCatalogSizes').value = '';
  renderUniformCatalogList();
}

function deleteUniformCatalogItem(id) {
  const item = (DB.uniformCatalog || []).find(c => c.id === id);
  if (!item) return;
  if (!confirm(`Xóa mặt hàng "${item.name}" khỏi Danh Mục Đồng Phục? Các kỳ cấp phát đã tạo trước đó vẫn giữ nguyên dữ liệu, chỉ không còn chọn được mặt hàng này cho kỳ mới.`)) return;
  DB.uniformCatalog = (DB.uniformCatalog || []).filter(c => c.id !== id);
  syncStorage('uniformCatalog');
  logSystemAction('UNIFORM', 'DELETE_UNIFORM_CATALOG', `Xóa mặt hàng khỏi Danh Mục Đồng Phục [${item.name}]`, 'SUCCESS', item.name);
  renderUniformCatalogList();
}

// ============ Kỳ Cấp Phát (Hành Chính — uniformManage) ============
function resetUniformPeriodForm() {
  document.getElementById('uniformPeriodName').value = '';
  document.getElementById('uniformPeriodNote').value = '';
  uniformAllocBlocks = [];
  renderUniformAllocationBlocks();
}

function addUniformAllocationBlock() {
  uniformAllocBlocks.push({ dept: '', items: [{ name: '', size: '', qty: 0 }] });
  renderUniformAllocationBlocks();
}

function removeUniformAllocationBlock(idx) {
  uniformAllocBlocks.splice(idx, 1);
  renderUniformAllocationBlocks();
}

function updateUniformAllocDept(idx, value) {
  if (!uniformAllocBlocks[idx]) return;
  uniformAllocBlocks[idx].dept = value;
}

// Ô nhập-tìm-kiếm siêu thị (thay dropdown vì DB.stores có thể rất dài) — chỉ chấp nhận đúng 1 tên siêu
// thị có thật trong DB.stores (gõ tự do không khớp -> để trống, validation lúc Tạo Kỳ Cấp Phát sẽ bắt).
function resolveUniformAllocDeptInput(blockIdx, rawValue) {
  const match = (DB.stores || []).find(s => s === rawValue.trim());
  updateUniformAllocDept(blockIdx, match || '');
  renderUniformAllocationBlocks();
}

function addUniformAllocItemRow(blockIdx) {
  if (!uniformAllocBlocks[blockIdx]) return;
  uniformAllocBlocks[blockIdx].items.push({ name: '', size: '', qty: 0 });
  renderUniformAllocationBlocks();
}

function removeUniformAllocItemRow(blockIdx, itemIdx) {
  if (!uniformAllocBlocks[blockIdx]) return;
  uniformAllocBlocks[blockIdx].items.splice(itemIdx, 1);
  renderUniformAllocationBlocks();
}

function updateUniformAllocItemField(blockIdx, itemIdx, field, value) {
  const item = uniformAllocBlocks[blockIdx]?.items?.[itemIdx];
  if (!item) return;
  item[field] = field === 'qty' ? (parseFloat(value) || 0) : value;
  // Đổi mặt hàng thì size cũ (thuộc mặt hàng khác trong Danh Mục Đồng Phục) không còn hợp lệ nữa — reset
  // rồi render lại để dropdown Size chỉ hiện đúng size của mặt hàng vừa chọn.
  if (field === 'name') {
    item.size = '';
    renderUniformAllocationBlocks();
  }
}

function renderUniformAllocationBlocks() {
  const wrap = document.getElementById('uniformAllocBlocksWrap');
  if (!wrap) return;
  const chosenDepts = uniformAllocBlocks.map(b => b.dept).filter(Boolean);
  wrap.innerHTML = uniformAllocBlocks.map((block, bIdx) => `
    <div class="bg-white p-3 rounded border space-y-2">
      <div class="flex items-center justify-between gap-2">
        <input value="${escapeHtml(block.dept)}" data-sdd-list="uniformAllocStoreDatalist_${bIdx}" autocomplete="off" data-op-change="resolveUniformAllocDeptInput" data-arg0="${bIdx}" data-arg-value="1" placeholder="Gõ tên siêu thị để tìm..." class="border p-1.5 rounded text-xs bg-white flex-1">
        <div id="uniformAllocStoreDatalist_${bIdx}" class="hidden sdd-dropdown" data-sdd-dropdown></div>
        <button type="button" data-op="removeUniformAllocationBlock" data-arg0="${bIdx}" class="text-red-600 hover:text-red-800 text-xs font-bold whitespace-nowrap">✕ Bỏ siêu thị này</button>
      </div>
      <table class="w-full text-xs border-collapse">
        <thead><tr class="bg-gray-100 text-left">
          <th class="border p-1">Tên Đồng Phục</th>
          <th class="border p-1 w-24">Size</th>
          <th class="border p-1 w-24">Số Lượng</th>
          <th class="border p-1 w-10"></th>
        </tr></thead>
        <tbody>
          ${block.items.map((it, iIdx) => {
            const catEntry = (DB.uniformCatalog || []).find(c => c.name === it.name);
            const sizes = catEntry ? (catEntry.sizes || []) : [];
            return `
            <tr>
              <td class="border p-1">
                <select data-op-change="updateUniformAllocItemField" data-arg0="${bIdx}" data-arg1="${iIdx}" data-arg2="name" data-arg-value="3" class="w-full border-0 p-1 text-xs bg-white">
                  <option value="">-- Chọn mặt hàng --</option>
                  ${(DB.uniformCatalog || []).map(c => `<option value="${escapeHtml(c.name)}" ${c.name === it.name ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
                </select>
              </td>
              <td class="border p-1">
                <select data-op-change="updateUniformAllocItemField" data-arg0="${bIdx}" data-arg1="${iIdx}" data-arg2="size" data-arg-value="3" class="w-full border-0 p-1 text-xs bg-white" ${sizes.length ? '' : 'disabled'}>
                  <option value="">-- Size --</option>
                  ${sizes.map(s => `<option value="${escapeHtml(s)}" ${s === it.size ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('')}
                </select>
              </td>
              <td class="border p-1"><input type="number" min="0" value="${it.qty}" data-op-input="updateUniformAllocItemField" data-arg0="${bIdx}" data-arg1="${iIdx}" data-arg2="qty" data-arg-value="3" class="w-full border-0 p-1 text-xs"></td>
              <td class="border p-1 text-center"><button type="button" data-op="removeUniformAllocItemRow" data-arg0="${bIdx}" data-arg1="${iIdx}" class="text-red-500 hover:text-red-700">✕</button></td>
            </tr>
          `; }).join('')}
        </tbody>
      </table>
      <button type="button" data-op="addUniformAllocItemRow" data-arg0="${bIdx}" class="text-teal-700 text-xs font-bold hover:underline">+ Thêm dòng mặt hàng</button>
    </div>
  `).join('');
  uniformAllocBlocks.forEach((block, bIdx) => {
    sddSetOptions(`uniformAllocStoreDatalist_${bIdx}`, DB.stores.filter(d => d === block.dept || !chosenDepts.includes(d)));
  });
}

async function submitUniformPeriod() {
  const name = document.getElementById('uniformPeriodName').value.trim();
  if (!name) return alert('Vui lòng nhập tên kỳ cấp phát!');
  if (!uniformAllocBlocks.length) return alert('Vui lòng thêm ít nhất 1 siêu thị để phân bổ!');

  const allocations = [];
  for (const block of uniformAllocBlocks) {
    if (!block.dept) return alert('Vui lòng chọn siêu thị cho tất cả các dòng phân bổ đã thêm!');
    const items = block.items.filter(it => (it.name || '').trim() && it.qty > 0);
    if (!items.length) return alert(`Vui lòng nhập ít nhất 1 mặt hàng hợp lệ (có tên + số lượng > 0) cho siêu thị "${block.dept}"!`);
    allocations.push({ dept: block.dept, items });
  }
  const depts = allocations.map(a => a.dept);
  if (new Set(depts).size !== depts.length) return alert('Mỗi siêu thị chỉ được xuất hiện 1 lần trong 1 kỳ cấp phát!');

  const payload = {
    name,
    note: document.getElementById('uniformPeriodNote').value.trim(),
    allocations,
    createdAt: new Date().toLocaleString('vi-VN')
  };

  let newPeriod;
  try {
    const result = await callCreateAction('uniformPeriods', payload);
    newPeriod = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.uniformPeriods.unshift(newPeriod);
  logSystemAction('UNIFORM', 'CREATE_UNIFORM_PERIOD', `Tạo kỳ cấp phát đồng phục [${newPeriod.name}]`, 'SUCCESS', newPeriod.name);
  alert('✅ Đã tạo kỳ cấp phát đồng phục!');
  resetUniformPeriodForm();
  renderUniformPeriodsList();
}

function uniformAllocStatusBadge(status) {
  if (status === 'CONFIRMED') return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-[11px]">✅ Đã xác nhận</span>`;
  return `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-[11px]">⏳ Chờ xác nhận</span>`;
}

// Cổng duyệt Ở CẤP KỲ (Phase 2) — mirror uniformAllocStatusBadge() ở trên nhưng cho field approvalStatus
// của CẢ KỲ (không phải per-allocation). Kỳ tạo trước Phase 2 (approvalStatus rỗng) coi như đã duyệt.
function uniformPeriodApprovalBadge(period) {
  const status = period.approvalStatus;
  if (!status || status === 'APPROVED') return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-[11px]">✔️ Đã duyệt</span>`;
  if (status === 'REJECTED') return `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-[11px]">⛔ Đã từ chối</span>`;
  return `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-[11px]">⏳ Chờ duyệt</span>`;
}

function filterUniformPeriodByCard(status) {
  applyDashboardCardFilter({ filterStatusUniformPeriod: status }, null, renderUniformPeriodsList);
}

function renderUniformPeriodsList() {
  const wrap = document.getElementById('uniformPeriodsListWrap');
  if (!wrap) return;
  const statusFilter = document.getElementById('filterStatusUniformPeriod')?.value || '';
  const uniformPeriodDashCards = [
    { key: '', label: 'Tổng Kỳ Cấp Phát', count: DB.uniformPeriods.length, colorClass: 'border-l-blue-500' },
    { key: 'PENDING_APPROVAL', label: 'Đang Chờ Duyệt', count: DB.uniformPeriods.filter(p => p.approvalStatus === 'PENDING_APPROVAL').length, colorClass: 'border-l-yellow-500' },
    { key: 'APPROVED', label: 'Đã Duyệt', count: DB.uniformPeriods.filter(p => !p.approvalStatus || p.approvalStatus === 'APPROVED').length, colorClass: 'border-l-green-500' },
    { key: 'REJECTED', label: 'Từ Chối', count: DB.uniformPeriods.filter(p => p.approvalStatus === 'REJECTED').length, colorClass: 'border-l-red-500' }
  ];
  const dashEl = document.getElementById('uniformPeriodDashboardCards');
  if (dashEl) dashEl.innerHTML = buildDashboardCardsHTML(uniformPeriodDashCards, statusFilter, 'filterUniformPeriodByCard');

  const filteredPeriods = DB.uniformPeriods.filter(p => !statusFilter || (statusFilter === 'APPROVED' ? (!p.approvalStatus || p.approvalStatus === 'APPROVED') : p.approvalStatus === statusFilter));
  if (!filteredPeriods.length) {
    wrap.innerHTML = `<div class="text-center p-6 text-gray-500 italic bg-white rounded border">Chưa có kỳ cấp phát nào.</div>`;
    return;
  }
  const canApprove = canApproveUniformClient(currentUser);
  wrap.innerHTML = filteredPeriods.map(p => `
    <div class="bg-white rounded border overflow-hidden">
      <div class="flex items-center justify-between gap-2 p-3 bg-gray-50 border-b flex-wrap">
        <div>
          <div class="font-bold text-teal-800 text-sm">${escapeHtml(p.name)} ${uniformPeriodApprovalBadge(p)}</div>
          <div class="text-[11px] text-gray-500">Tạo bởi ${escapeHtml(p.creatorName || p.creator || '')} lúc ${escapeHtml(p.createdAt || '')}${p.note ? ` — ${escapeHtml(p.note)}` : ''}</div>
          ${p.approvalStatus === 'REJECTED' && p.rejectReason ? `<div class="text-[11px] text-red-600 mt-0.5">Lý do từ chối: ${escapeHtml(p.rejectReason)}</div>` : ''}
          ${p.approvalStatus === 'APPROVED' ? `<div class="text-[11px] text-green-700 mt-0.5">Duyệt bởi ${escapeHtml(p.approvedByName || '')} lúc ${escapeHtml(p.approvedAt || '')}</div>` : ''}
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          ${(canApprove && p.approvalStatus === 'PENDING_APPROVAL') ? `
            <button type="button" data-op="approveUniformPeriodAction" data-arg0="${p.id}" class="bg-emerald-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-emerald-700">✔️ Duyệt</button>
            <button type="button" data-op="rejectUniformPeriodAction" data-arg0="${p.id}" class="bg-red-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-red-700">✕ Từ Chối</button>
          ` : ''}
          ${currentUser.perms?.admin ? `<button type="button" data-op="deleteUniformPeriodAction" data-arg0="${p.id}" class="text-red-600 hover:text-red-800 text-xs font-bold">🗑️ Xóa</button>` : ''}
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead><tr class="bg-gray-100 text-left">
            <th class="border p-2">Siêu Thị</th>
            <th class="border p-2">Mặt Hàng Phân Bổ</th>
            <th class="border p-2">Trạng Thái</th>
            <th class="border p-2">Người Xác Nhận</th>
          </tr></thead>
          <tbody>
            ${(p.allocations || []).map(a => `
              <tr>
                <td class="border p-2 font-semibold">${escapeHtml(a.dept)}</td>
                <td class="border p-2">${uniformItemsSummary(a.items)}</td>
                <td class="border p-2">${uniformAllocStatusBadge(a.status)}</td>
                <td class="border p-2 text-[11px]">${a.status === 'CONFIRMED' ? `${escapeHtml(a.confirmedByName || '')} — ${escapeHtml(a.confirmedAt || '')}` : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `).join('');
}

function approveUniformPeriodAction(periodId) {
  showConfirmModal({
    title: 'Duyệt Kỳ Cấp Phát',
    bodyHTML: 'Duyệt kỳ cấp phát này? Sau khi duyệt, Giám Đốc các Siêu Thị liên quan mới bắt đầu xác nhận được phần phân bổ của mình.',
    confirmLabel: 'Duyệt',
    onConfirm: async () => {
      let result;
      try {
        result = await callRecordAction('uniformPeriods', periodId, 'approve', {});
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.uniformPeriods.findIndex(x => x.id === periodId);
      if (idx !== -1) DB.uniformPeriods[idx] = result.item;
      logSystemAction('UNIFORM', 'APPROVE_UNIFORM_PERIOD', `Duyệt kỳ cấp phát đồng phục [${result.item.name}]`, 'SUCCESS', result.item.name);
      alert('✅ Đã duyệt kỳ cấp phát!');
      renderUniformPeriodsList();
    }
  });
}

function rejectUniformPeriodAction(periodId) {
  showConfirmModal({
    title: 'Từ Chối Kỳ Cấp Phát',
    bodyHTML: `
      <div class="space-y-2">
        <div class="text-xs text-gray-600">Từ chối là QUYẾT ĐỊNH CUỐI CÙNG — kỳ này sẽ không bao giờ xác nhận được nữa sau khi từ chối.</div>
        <div>
          <label class="block font-semibold text-gray-600 mb-1 text-xs">Lý Do</label>
          <textarea id="uniformPeriodRejectReason" rows="2" class="w-full border p-1.5 rounded text-xs" placeholder="Không bắt buộc..."></textarea>
        </div>
      </div>
    `,
    confirmLabel: 'Từ Chối',
    onConfirm: async () => {
      const reason = document.getElementById('uniformPeriodRejectReason').value.trim();
      let result;
      try {
        result = await callRecordAction('uniformPeriods', periodId, 'reject', { reason });
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.uniformPeriods.findIndex(x => x.id === periodId);
      if (idx !== -1) DB.uniformPeriods[idx] = result.item;
      logSystemAction('UNIFORM', 'REJECT_UNIFORM_PERIOD', `Từ chối kỳ cấp phát đồng phục [${result.item.name}]`, 'SUCCESS', result.item.name);
      alert('✅ Đã từ chối kỳ cấp phát!');
      renderUniformPeriodsList();
    }
  });
}

function deleteUniformPeriodAction(id) {
  const p = DB.uniformPeriods.find(x => x.id === id);
  if (!p) return;
  deleteRecordAdminOnly('uniformPeriods', id, `kỳ cấp phát đồng phục ${p.name}`, () => {
    DB.uniformPeriods = DB.uniformPeriods.filter(x => x.id !== id);
    logSystemAction('UNIFORM', 'DELETE_UNIFORM_PERIOD', `Xóa kỳ cấp phát đồng phục [${p.name}]`, 'SUCCESS', p.name);
    renderUniformPeriodsList();
    renderUniformStock();
  });
}

// ============ Xác Nhận / Cấp Phát (Giám Đốc Siêu Thị — uniformStoreManage) ============
function renderUniformPendingAllocations() {
  const wrap = document.getElementById('uniformPendingAllocList');
  const noNote = document.getElementById('uniformNoPendingAllocNote');
  if (!wrap) return;
  const pending = [];
  for (const p of DB.uniformPeriods) {
    // Cổng duyệt Ở CẤP KỲ (Phase 2) — kỳ chưa/không được duyệt thì KHÔNG hiện ra để xác nhận, kể cả
    // với admin/uniformManage (server đã lọc cho uniformStoreManage thuần, đây là phòng thủ thêm cho
    // trường hợp 1 tài khoản vừa admin/uniformManage vừa đang đứng vai trò Giám Đốc Siêu Thị của mình).
    if (p.approvalStatus && p.approvalStatus !== 'APPROVED') continue;
    for (const a of (p.allocations || [])) {
      if (a.dept === currentUser.dept && a.status === 'PENDING_CONFIRM') pending.push({ period: p, alloc: a });
    }
  }
  noNote.classList.toggle('hidden', pending.length > 0);
  wrap.innerHTML = pending.map(({ period, alloc }) => `
    <div class="bg-white p-3 rounded border flex items-center justify-between gap-2 flex-wrap">
      <div>
        <div class="font-bold text-amber-900 text-xs">${escapeHtml(period.name)}</div>
        <div class="text-[11px] text-gray-600">${uniformItemsSummary(alloc.items)}</div>
      </div>
      <button type="button" data-op="confirmUniformAllocationAction" data-arg0="${period.id}" data-arg1="${alloc.id}" class="bg-amber-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-amber-700">✅ Xác Nhận Đã Nhận</button>
    </div>
  `).join('');
}

function confirmUniformAllocationAction(periodId, allocationId) {
  showConfirmModal({
    title: 'Xác Nhận Nhận Đồng Phục',
    bodyHTML: 'Bạn xác nhận siêu thị đã nhận đủ số lượng đồng phục này từ Hành Chính? Sau khi xác nhận, số lượng sẽ được tính vào tồn kho để cấp cho nhân viên.',
    confirmLabel: 'Xác Nhận',
    onConfirm: async () => {
      let result;
      try {
        result = await callRecordAction('uniformPeriods', periodId, 'confirm-allocation', { allocationId });
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.uniformPeriods.findIndex(x => x.id === periodId);
      if (idx !== -1) DB.uniformPeriods[idx] = result.item;
      // Phase 2: server có thể trả kèm uniformCatalog đã cập nhật (SKU vừa sinh/tái sử dụng cho phần
      // vừa xác nhận) — cập nhật ngay để hiện mã mới mà không cần tải lại trang, xem routes/records.js.
      if (result.uniformCatalog) DB.uniformCatalog = result.uniformCatalog;
      logSystemAction('UNIFORM', 'CONFIRM_UNIFORM_ALLOC', `Xác nhận nhận đồng phục kỳ [${result.item.name}]`, 'SUCCESS', result.item.name);
      renderUniformPendingAllocations();
      renderUniformStock();
    }
  });
}

// Danh sách nhân viên siêu thị mình dùng chung cho 2 ô nhập-tìm-kiếm nhân viên (Cấp Phát + Thu Hồi) —
// thay dropdown vì 1 siêu thị có thể có rất nhiều nhân viên. Option hiển thị "Tên (tài_khoản)" để gõ
// tìm được theo cả tên lẫn tài khoản (resolveUniformEmployeeInput() khớp lại nguyên cụm này).
function renderUniformIssueEmployeeOptions() {
  const employees = (DB.users || []).filter(u => u.dept === currentUser.dept && u.posType !== 'HO' && u.active !== false);
  sddSetOptions('uniformStoreEmployeesDatalist', employees.map(u => `${u.name} (${u.username})`));
  uniformStoreEmployeesCache = employees;
}

// Khớp text đang gõ trong ô #inputId (định dạng "Tên (tài_khoản)") với đúng 1 nhân viên còn hiệu lực
// của siêu thị mình -> ghi username vào input ẩn #hiddenId; không khớp (gõ tự do/chưa chọn xong) thì để
// trống, validation lúc submit sẽ bắt lỗi "chưa chọn nhân viên".
function resolveUniformEmployeeInput(inputId, hiddenId) {
  const raw = document.getElementById(inputId).value;
  const m = raw.match(/\(([^()]+)\)\s*$/);
  const username = m ? m[1].trim() : '';
  const found = (uniformStoreEmployeesCache || []).some(u => u.username === username);
  document.getElementById(hiddenId).value = found ? username : '';
}

// Wrapper cho ô "Nhân Viên" ở khối Thu Hồi Từ Nhân Viên — oninput gốc gọi 2 hàm liền
// (resolveUniformEmployeeInput rồi renderUniformAdjEmpItemOptions để nạp lại dropdown mặt hàng theo
// đúng nhân viên vừa gõ) nhưng data-op-seq chỉ được xử lý ở sự kiện click, không có ở input, nên gộp
// thành 1 hàm để dùng với data-op-input.
function resolveUniformAdjEmpEmployeeInputAndRefresh(inputId, hiddenId) {
  resolveUniformEmployeeInput(inputId, hiddenId);
  renderUniformAdjEmpItemOptions();
}

function resetUniformIssueForm() {
  document.getElementById('uniformIssueEmployee').value = '';
  document.getElementById('uniformIssueEmployeeUsername').value = '';
  document.getElementById('uniformIssueCode').value = '';
  document.getElementById('uniformIssueNote').value = '';
  uniformIssueItems = [{ name: '', size: '', qty: 0 }];
  renderUniformIssueItems();
}

function addUniformIssueItemRow() {
  uniformIssueItems.push({ name: '', size: '', qty: 0 });
  renderUniformIssueItems();
}

function removeUniformIssueItemRow(idx) {
  uniformIssueItems.splice(idx, 1);
  renderUniformIssueItems();
}

function updateUniformIssueItemField(idx, field, value) {
  if (!uniformIssueItems[idx]) return;
  uniformIssueItems[idx][field] = field === 'qty' ? (parseFloat(value) || 0) : value;
}

// Chọn mặt hàng CHỌN được 1 dòng "tên|||size" duy nhất từ ĐÚNG những gì siêu thị đang có tồn kho > 0
// (đã được Hành Chính phân bổ VÀ Giám Đốc Siêu Thị xác nhận) — không còn 2 ô tên/size gõ tự do như
// trước (dễ gõ sai lệch với đúng dữ liệu đã phân bổ, xem computeUniformStockClient()).
function updateUniformIssueItemNameSize(idx, value) {
  if (!uniformIssueItems[idx]) return;
  const sep = value.indexOf('|||');
  uniformIssueItems[idx].name = sep === -1 ? '' : value.slice(0, sep);
  uniformIssueItems[idx].size = sep === -1 ? '' : value.slice(sep + 3);
}

function renderUniformIssueItems() {
  const wrap = document.getElementById('uniformIssueItemsWrap');
  if (!wrap) return;
  const stock = computeUniformStockClient(currentUser.dept);
  const options = Array.from(stock.values()).filter(r => r.stock > 0).sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.size.localeCompare(b.size, 'vi'));
  wrap.innerHTML = `
    <table class="w-full text-xs border-collapse bg-white">
      <thead><tr class="bg-gray-100 text-left">
        <th class="border p-1">Đồng Phục — Size (còn tồn kho)</th>
        <th class="border p-1 w-24">Số Lượng</th>
        <th class="border p-1 w-10"></th>
      </tr></thead>
      <tbody>
        ${uniformIssueItems.map((it, idx) => {
          const currentKey = `${it.name}|||${it.size || ''}`;
          return `
          <tr>
            <td class="border p-1">
              <select data-op-change="updateUniformIssueItemNameSize" data-arg0="${idx}" data-arg-value="1" class="w-full border-0 p-1 text-xs bg-white">
                <option value="">-- Chọn mặt hàng --</option>
                ${options.map(o => {
                  const key = `${o.name}|||${o.size}`;
                  const code = uniformSkuFor(o.name, o.size);
                  return `<option value="${escapeHtml(key)}" ${key === currentKey ? 'selected' : ''}>${formatUniformLabel(o.name, o.size, code)} (còn ${o.stock})</option>`;
                }).join('')}
              </select>
            </td>
            <td class="border p-1"><input type="number" min="0" value="${it.qty}" data-op-input="updateUniformIssueItemField" data-arg0="${idx}" data-arg1="qty" data-arg-value="2" class="w-full border-0 p-1 text-xs"></td>
            <td class="border p-1 text-center"><button type="button" data-op="removeUniformIssueItemRow" data-arg0="${idx}" class="text-red-500 hover:text-red-700">✕</button></td>
          </tr>
        `; }).join('')}
      </tbody>
    </table>
    ${!options.length ? `<p class="text-xs text-gray-500 italic mt-1">Siêu thị chưa có tồn kho đồng phục nào (chưa xác nhận nhận, hoặc đã cấp/hỏng/hủy/mất hết).</p>` : ''}
  `;
}

async function callCreateUniformIssuance(payload) {
  const res = await fetch('/api/records/uniformIssuances/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  if (res.status === 401) {
    handleSessionExpired();
    throw new Error('Phiên đăng nhập đã hết hạn');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return body; // { ok, item }
}

async function submitUniformIssuance() {
  const employeeUsername = document.getElementById('uniformIssueEmployeeUsername').value;
  if (!employeeUsername) return alert('Vui lòng chọn nhân viên nhận đồng phục!');
  const items = uniformIssueItems.filter(it => (it.name || '').trim() && it.qty > 0);
  if (!items.length) return alert('Vui lòng nhập ít nhất 1 mặt hàng hợp lệ (có tên + số lượng > 0)!');

  const payload = {
    code: document.getElementById('uniformIssueCode').value.trim(),
    employeeUsername,
    items,
    note: document.getElementById('uniformIssueNote').value.trim()
  };

  let newIssuance;
  try {
    const result = await callCreateUniformIssuance(payload);
    newIssuance = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.uniformIssuances.unshift(newIssuance);
  logSystemAction('UNIFORM', 'CREATE_UNIFORM_ISSUANCE', `Cấp đồng phục cho nhân viên [${newIssuance.employeeName}]`, 'SUCCESS', newIssuance.code || '');
  alert('✅ Đã cấp đồng phục cho nhân viên!');
  resetUniformIssueForm();
  renderUniformIssuancesTable();
  // Cấp phát xong -> nhân viên vừa nhận phải hiện NGAY trong bảng "Đang Giữ" và dropdown "Đồng Phục —
  // Size" của "Báo Hỏng/Hủy (Từ Kho)" phải cập nhật lại đúng tồn kho còn lại (trước đây thiếu 2 dòng
  // này, phải chuyển tab qua lại mới thấy đúng dữ liệu).
  renderUniformHoldingsTable();
  renderUniformAdjStockItemOptions();
  renderUniformStock();
}

function renderUniformIssuancesTable() {
  const tbody = document.getElementById('uniformIssuancesTableBody');
  if (!tbody) return;
  const rows = DB.uniformIssuances.filter(x => x.dept === currentUser.dept);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center p-6 text-gray-500 italic">Chưa có phiếu cấp phát nào.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr class="hover:bg-gray-50 border-b">
      <td class="border p-2">${escapeHtml(r.code || '—')}</td>
      <td class="border p-2">${escapeHtml(r.employeeName || '')}</td>
      <td class="border p-2">${uniformItemsSummary(r.items)}</td>
      <td class="border p-2">${escapeHtml(r.createdAt || '')}</td>
      <td class="border p-2">${escapeHtml(r.creatorName || '')}</td>
    </tr>
  `).join('');
}

// ============ Đồng Phục Nhân Viên Đang Giữ (thao tác nhanh Thu Hồi/Báo Hỏng/Báo Mất theo từng dòng) ====
// Mirror computeAllEmployeeUniformHoldings() ở lib/recordActions.js — hệ thống chỉ track tổng số 1
// (nhân viên × mặt hàng × size) đang giữ, KHÔNG track "phiếu nào cấp phần nào chưa bị thu hồi" — nên
// gộp theo đúng 3 chiều này (không theo từng phiếu cấp riêng lẻ) là đúng khớp cách dữ liệu được tính.
function computeAllEmployeeUniformHoldingsClient(storeDept) {
  const held = new Map();
  const keyOf = (empUsername, name, size) => `${empUsername}|||${name}|||${size || ''}`;
  const bump = (empUsername, empName, name, size, delta) => {
    const key = keyOf(empUsername, name, size);
    if (!held.has(key)) held.set(key, { employeeUsername: empUsername, employeeName: empName, name, size: size || '', held: 0 });
    held.get(key).held += delta;
  };
  for (const issuance of DB.uniformIssuances) {
    if (issuance.dept !== storeDept) continue;
    for (const it of (issuance.items || [])) bump(issuance.employeeUsername, issuance.employeeName, it.name, it.size, it.qty);
  }
  for (const adj of (DB.uniformStockAdjustments || [])) {
    if (adj.dept !== storeDept || adj.source !== 'EMPLOYEE') continue;
    bump(adj.employeeUsername, adj.employeeName, adj.itemName, adj.size, -adj.qty);
  }
  return Array.from(held.values()).filter(r => r.held > 0).sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'vi'));
}

let uniformHoldingsCache = [];
function renderUniformHoldingsTable() {
  const tbody = document.getElementById('uniformHoldingsTableBody');
  if (!tbody) return;
  uniformHoldingsCache = computeAllEmployeeUniformHoldingsClient(currentUser.dept);
  if (!uniformHoldingsCache.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center p-6 text-gray-500 italic">Không có nhân viên nào đang giữ đồng phục.</td></tr>`;
    return;
  }
  tbody.innerHTML = uniformHoldingsCache.map((h, idx) => `
    <tr class="hover:bg-gray-50 border-b">
      <td class="border p-2">${escapeHtml(h.employeeName)}</td>
      <td class="border p-2">${escapeHtml(h.name)}</td>
      <td class="border p-2">${escapeHtml(h.size || '—')}${uniformSkuFor(h.name, h.size) ? ` <span class="text-[10px] text-cyan-700 font-mono">(${escapeHtml(uniformSkuFor(h.name, h.size))})</span>` : ''}</td>
      <td class="border p-2 text-right font-bold">${h.held.toLocaleString('vi-VN')}</td>
      <td class="border p-2 text-center space-x-1 whitespace-nowrap">
        <button type="button" data-op="openUniformHoldingActionModal" data-arg0="${idx}" data-arg1="TON" class="bg-emerald-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-emerald-700">↩️ Thu Hồi</button>
        <button type="button" data-op="openUniformHoldingActionModal" data-arg0="${idx}" data-arg1="HONG" class="bg-rose-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-rose-700">🔴 Báo Hỏng</button>
        <button type="button" data-op="openUniformHoldingActionModal" data-arg0="${idx}" data-arg1="MAT" class="bg-slate-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-slate-700">❓ Báo Mất</button>
      </td>
    </tr>
  `).join('');
}

function openUniformHoldingActionModal(idx, outcome) {
  const h = uniformHoldingsCache[idx];
  if (!h) return;
  const outcomeLabel = { TON: 'Thu Hồi (Về Tồn Kho)', HONG: 'Báo Hỏng', MAT: 'Báo Mất' }[outcome];
  showConfirmModal({
    title: `${outcomeLabel} — ${h.employeeName}`,
    bodyHTML: `
      <div class="space-y-3">
        <div class="text-xs text-gray-600">${escapeHtml(h.name)}${h.size ? ` (size ${escapeHtml(h.size)})` : ''} — đang giữ <b>${h.held}</b>.</div>
        <div>
          <label class="block font-semibold text-gray-600 mb-1 text-xs">Số Lượng <span class="text-red-500">*</span></label>
          <input id="uniformHoldingActionQty" type="number" min="1" max="${h.held}" value="${h.held}" class="w-full border p-1.5 rounded text-xs">
        </div>
        <div>
          <label class="block font-semibold text-gray-600 mb-1 text-xs">Lý Do <span class="text-red-500">*</span></label>
          <textarea id="uniformHoldingActionReason" rows="2" class="w-full border p-1.5 rounded text-xs" placeholder="Bắt buộc nhập lý do..."></textarea>
        </div>
      </div>
    `,
    confirmLabel: outcomeLabel,
    onConfirm: async () => {
      const qty = parseFloat(document.getElementById('uniformHoldingActionQty').value);
      const reason = document.getElementById('uniformHoldingActionReason').value.trim();
      if (!qty || qty <= 0) return alert('Vui lòng nhập số lượng hợp lệ (> 0)!');
      if (!reason) return alert('Vui lòng nhập lý do (bắt buộc)!');
      let newAdj;
      try {
        const result = await callCreateUniformStockAdjustment({
          source: 'EMPLOYEE', outcome, employeeUsername: h.employeeUsername, itemName: h.name, size: h.size, qty, reason
        });
        newAdj = result.item;
      } catch (err) { return alert(`⛔ ${err.message}`); }
      DB.uniformStockAdjustments.unshift(newAdj);
      logSystemAction('UNIFORM', 'CREATE_UNIFORM_STOCK_ADJUSTMENT', `${outcomeLabel} [${newAdj.itemName}] của ${h.employeeName}`, 'SUCCESS', newAdj.itemName);
      alert('✅ Đã ghi nhận thao tác!');
      renderUniformHoldingsTable();
      renderUniformAdjustmentsTable();
      renderUniformAdjStockItemOptions();
      renderUniformStock();
    }
  });
}

// ============ Hỏng / Hủy / Thu Hồi (Giám Đốc Siêu Thị — uniformStoreManage) ============
// Dropdown "Đồng Phục — Size" cho "Báo Hỏng/Hủy (Từ Kho)" — giới hạn CHÍNH XÁC những gì siêu thị đang
// có tồn kho > 0 (đã được Hành Chính phân bổ VÀ Giám Đốc Siêu Thị xác nhận), cùng khuôn dữ liệu
// (computeUniformStockClient()) + cùng định dạng nhãn (formatUniformLabel()) với dropdown "Cấp Đồng
// Phục Cho Nhân Viên" ở renderUniformIssueItems() — KHÔNG còn 2 ô tên/size gõ tự do (không đối chiếu
// được với Danh Mục Đồng Phục, dễ gõ sai lệch với đúng dữ liệu đã phân bổ).
function renderUniformAdjStockItemOptions() {
  const sel = document.getElementById('uniformAdjStockItemSize');
  if (!sel) return;
  const prevValue = sel.value;
  const stock = computeUniformStockClient(currentUser.dept);
  const options = Array.from(stock.values()).filter(r => r.stock > 0).sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.size.localeCompare(b.size, 'vi'));
  sel.innerHTML = '<option value="">-- Chọn mặt hàng --</option>' +
    options.map(o => {
      const key = `${o.name}|||${o.size}`;
      const code = uniformSkuFor(o.name, o.size);
      return `<option value="${escapeHtml(key)}">${formatUniformLabel(o.name, o.size, code)} (còn ${o.stock})</option>`;
    }).join('');
  if (options.some(o => `${o.name}|||${o.size}` === prevValue)) sel.value = prevValue;
}

function resetUniformAdjustForms() {
  renderUniformAdjStockItemOptions();
  document.getElementById('uniformAdjStockQty').value = '';
  document.getElementById('uniformAdjStockReason').value = '';
  const stockOutcomeDefault = document.querySelector('input[name="uniformAdjStockOutcome"][value="HONG"]');
  if (stockOutcomeDefault) stockOutcomeDefault.checked = true;

  document.getElementById('uniformAdjEmpEmployee').value = '';
  document.getElementById('uniformAdjEmpEmployeeUsername').value = '';
  renderUniformAdjEmpItemOptions();
  document.getElementById('uniformAdjEmpQty').value = '';
  document.getElementById('uniformAdjEmpReason').value = '';
  const empOutcomeDefault = document.querySelector('input[name="uniformAdjEmpOutcome"][value="TON"]');
  if (empOutcomeDefault) empOutcomeDefault.checked = true;
}

// Chọn nhân viên xong mới hiện dropdown mặt hàng — giới hạn CHÍNH XÁC những gì nhân viên đó đang giữ
// (computeAllEmployeeUniformHoldingsClient()), không còn 2 ô tên/size gõ tự do như trước.
function renderUniformAdjEmpItemOptions() {
  const sel = document.getElementById('uniformAdjEmpItemSize');
  const hint = document.getElementById('uniformAdjEmpHeldHint');
  if (!sel) return;
  const employeeUsername = document.getElementById('uniformAdjEmpEmployeeUsername').value;
  if (!employeeUsername) {
    sel.innerHTML = '<option value="">-- Chọn nhân viên trước --</option>';
    if (hint) hint.textContent = '';
    return;
  }
  const holdings = computeAllEmployeeUniformHoldingsClient(currentUser.dept).filter(h => h.employeeUsername === employeeUsername);
  if (!holdings.length) {
    sel.innerHTML = '<option value="">-- Nhân viên này không đang giữ mặt hàng nào --</option>';
    if (hint) hint.textContent = '';
    return;
  }
  sel.innerHTML = '<option value="">-- Chọn mặt hàng --</option>' +
    holdings.map(h => `<option value="${escapeHtml(h.name)}|||${escapeHtml(h.size)}" data-held="${h.held}">${escapeHtml(h.name)}${h.size ? ` - ${escapeHtml(h.size)}` : ''} (đang giữ ${h.held})</option>`).join('');
  onUniformAdjEmpItemSizeChange();
}

function onUniformAdjEmpItemSizeChange() {
  const sel = document.getElementById('uniformAdjEmpItemSize');
  const hint = document.getElementById('uniformAdjEmpHeldHint');
  const opt = sel?.selectedOptions?.[0];
  const held = opt ? Number(opt.dataset.held || 0) : 0;
  if (hint) hint.textContent = (opt && opt.value) ? `(đang giữ ${held})` : '';
  const qtyInput = document.getElementById('uniformAdjEmpQty');
  if (qtyInput) qtyInput.max = held || '';
}

async function callCreateUniformStockAdjustment(payload) {
  const res = await fetch('/api/records/uniformStockAdjustments/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  if (res.status === 401) {
    handleSessionExpired();
    throw new Error('Phiên đăng nhập đã hết hạn');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return body; // { ok, item }
}

async function submitUniformStockAdjustment(source) {
  const prefix = source === 'EMPLOYEE' ? 'uniformAdjEmp' : 'uniformAdjStock';
  // Cả 2 nguồn giờ ĐỀU chọn "Mặt Hàng — Size" từ dropdown (không còn gõ tự do) — cùng khuôn giá trị
  // "tên|||size" với dropdown "Cấp Đồng Phục Cho Nhân Viên", đồng nhất tên gọi/cách chọn xuyên suốt
  // module Đồng Phục.
  const combo = document.getElementById(`${prefix}ItemSize`).value;
  const sep = combo.indexOf('|||');
  const itemName = sep === -1 ? '' : combo.slice(0, sep);
  const size = sep === -1 ? '' : combo.slice(sep + 3);
  const qty = parseFloat(document.getElementById(`${prefix}Qty`).value);
  const reason = document.getElementById(`${prefix}Reason`).value.trim();
  const outcome = document.querySelector(`input[name="${prefix}Outcome"]:checked`)?.value || '';

  if (!itemName) return alert('Vui lòng chọn đồng phục — size!');
  if (!qty || qty <= 0) return alert('Vui lòng nhập số lượng hợp lệ (> 0)!');
  if (!reason) return alert('Vui lòng nhập lý do (bắt buộc)!');

  const payload = { source, outcome, itemName, size, qty, reason };
  if (source === 'EMPLOYEE') {
    const employeeUsername = document.getElementById('uniformAdjEmpEmployeeUsername').value;
    if (!employeeUsername) return alert('Vui lòng chọn nhân viên!');
    payload.employeeUsername = employeeUsername;
  }

  let newAdj;
  try {
    const result = await callCreateUniformStockAdjustment(payload);
    newAdj = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.uniformStockAdjustments.unshift(newAdj);
  logSystemAction('UNIFORM', 'CREATE_UNIFORM_STOCK_ADJUSTMENT', `${source === 'EMPLOYEE' ? 'Thu hồi từ nhân viên' : 'Báo hỏng/hủy từ kho'} [${newAdj.itemName}]`, 'SUCCESS', newAdj.itemName);
  alert('✅ Đã ghi nhận thao tác!');
  resetUniformAdjustForms();
  renderUniformAdjustmentsTable();
  // Thao tác EMPLOYEE đổi số đang giữ của nhân viên -> phải làm mới lại bảng "Đang Giữ" ngay (trước đây
  // thiếu dòng này khiến bảng hiện "Không có nhân viên nào đang giữ đồng phục" dù dữ liệu đã đổi, phải
  // đợi chuyển tab qua lại mới thấy đúng).
  renderUniformHoldingsTable();
  renderUniformStock();
}

function uniformAdjOutcomeLabel(outcome) {
  if (outcome === 'HONG') return '🔴 Hỏng';
  if (outcome === 'HUY') return '⚫ Hủy';
  if (outcome === 'MAT') return '❓ Mất';
  return '🟢 Về tồn kho';
}

function renderUniformAdjustmentsTable() {
  const tbody = document.getElementById('uniformAdjustmentsTableBody');
  if (!tbody) return;
  const rows = DB.uniformStockAdjustments.filter(x => x.dept === currentUser.dept);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center p-6 text-gray-500 italic">Chưa có thao tác nào.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr class="hover:bg-gray-50 border-b">
      <td class="border p-2">${escapeHtml(r.createdAt || '')}</td>
      <td class="border p-2">${r.source === 'EMPLOYEE' ? 'Thu hồi từ NV' : 'Từ kho'}</td>
      <td class="border p-2">${escapeHtml(r.itemName)}${r.size ? ` (${escapeHtml(r.size)})` : ''}</td>
      <td class="border p-2 text-right">${r.qty.toLocaleString('vi-VN')}</td>
      <td class="border p-2">${uniformAdjOutcomeLabel(r.outcome)}</td>
      <td class="border p-2">${escapeHtml(r.employeeName || '—')}</td>
      <td class="border p-2">${escapeHtml(r.reason || '')}</td>
      <td class="border p-2">${escapeHtml(r.creatorName || '')}</td>
    </tr>
  `).join('');
}

// ============ Kho Đồng Phục (xem — computed, không lưu bảng riêng) ============
// Mirror computeUniformStock() ở lib/recordActions.js — chỉ tính từ allocations đã CONFIRMED trừ đi
// uniformIssuances (đã trừ phần thu hồi) và trừ luôn hỏng/hủy, để hiển thị tức thời phía client mà
// không cần gọi thêm API riêng cho tồn kho.
// Mirror computeUniformStock() ở lib/recordActions.js (Phase 2 — có thêm transferOut/transferIn từ
// DB.uniformTransfers ĐÃ APPROVED, xem giải thích công thức ở đó).
function computeUniformStockClient(storeDept) {
  const stock = new Map();
  const keyOf = (name, size) => `${name}|||${size || ''}`;
  const bump = (name, size, field, qty) => {
    const key = keyOf(name, size);
    if (!stock.has(key)) stock.set(key, { name, size: size || '', allocated: 0, issued: 0, recalled: 0, hong: 0, huy: 0, mat: 0, transferOut: 0, transferIn: 0 });
    stock.get(key)[field] += qty;
  };
  for (const period of DB.uniformPeriods) {
    for (const alloc of (period.allocations || [])) {
      if (alloc.dept !== storeDept || alloc.status !== 'CONFIRMED') continue;
      for (const it of (alloc.items || [])) bump(it.name, it.size, 'allocated', it.qty);
    }
  }
  for (const issuance of DB.uniformIssuances) {
    if (issuance.dept !== storeDept) continue;
    for (const it of (issuance.items || [])) bump(it.name, it.size, 'issued', it.qty);
  }
  for (const adj of (DB.uniformStockAdjustments || [])) {
    if (adj.dept !== storeDept) continue;
    if (adj.source === 'EMPLOYEE') bump(adj.itemName, adj.size, 'recalled', adj.qty);
    if (adj.outcome === 'HONG') bump(adj.itemName, adj.size, 'hong', adj.qty);
    if (adj.outcome === 'HUY') bump(adj.itemName, adj.size, 'huy', adj.qty);
    if (adj.outcome === 'MAT') bump(adj.itemName, adj.size, 'mat', adj.qty);
  }
  for (const t of (DB.uniformTransfers || [])) {
    if (t.status !== 'APPROVED') continue;
    if (t.sourceDept === storeDept) bump(t.itemName, t.size, 'transferOut', t.qty);
    if (t.targetDept === storeDept) bump(t.itemName, t.size, 'transferIn', t.qty);
  }
  for (const row of stock.values()) row.stock = row.allocated - (row.issued - row.recalled) - row.hong - row.huy - row.mat - row.transferOut + row.transferIn;
  return stock;
}

// Mirror computeUniformStockBreakdown() ở lib/recordActions.js — tách "tồn kho" thành "mới" (chưa từng
// cấp cho ai) / "đã sử dụng" (đã cấp rồi được thu hồi TỐT về kho, outcome TON) để hiển thị ở Kho/Tổng
// Quan, đồng thời PHẢN ÁNH chính sách "ưu tiên xài hàng đã sử dụng trước" (xem giải thích đầy đủ ở bản
// server). newStock + usedStock LUÔN = row.stock của computeUniformStockClient() ở trên.
function computeUniformStockBreakdownClient(storeDept) {
  const pools = new Map();
  const events = [];
  const keyOf = (name, size) => `${name}|||${size || ''}`;
  const getPool = (name, size) => {
    const key = keyOf(name, size);
    if (!pools.has(key)) pools.set(key, { name, size: size || '', newStock: 0, usedStock: 0 });
    return pools.get(key);
  };
  const timeOf = (str) => { const d = parseVNDateTime(str); return d ? d.getTime() : 0; };

  for (const period of (DB.uniformPeriods || [])) {
    for (const alloc of (period.allocations || [])) {
      if (alloc.dept !== storeDept || alloc.status !== 'CONFIRMED') continue;
      // Dùng alloc.id (Date.now() lúc TẠO kỳ, mili-giây) thay vì parse alloc.confirmedAt (nowVN(), chỉ
      // chính xác tới GIÂY) — xem giải thích đầy đủ ở bản server computeUniformStockBreakdown().
      const t = alloc.id;
      for (const it of (alloc.items || [])) events.push({ t, type: 'ALLOC', name: it.name, size: it.size, qty: it.qty });
    }
  }
  for (const issuance of (DB.uniformIssuances || [])) {
    if (issuance.dept !== storeDept) continue;
    const t = issuance.id;
    for (const it of (issuance.items || [])) events.push({ t, type: 'ISSUE', name: it.name, size: it.size, qty: it.qty });
  }
  for (const adj of (DB.uniformStockAdjustments || [])) {
    if (adj.dept !== storeDept) continue;
    const t = adj.id;
    if (adj.source === 'EMPLOYEE' && adj.outcome === 'TON') {
      events.push({ t, type: 'RETURN_GOOD', name: adj.itemName, size: adj.size, qty: adj.qty });
    } else if (adj.source === 'STOCK') {
      events.push({ t, type: 'STOCK_LOSS', name: adj.itemName, size: adj.size, qty: adj.qty });
    }
  }
  for (const tr of (DB.uniformTransfers || [])) {
    if (tr.status !== 'APPROVED') continue;
    const t = timeOf(tr.approvedAt);
    if (tr.sourceDept === storeDept) events.push({ t, type: 'TRANSFER_OUT', name: tr.itemName, size: tr.size, qty: tr.qty });
    if (tr.targetDept === storeDept) events.push({ t, type: 'TRANSFER_IN', name: tr.itemName, size: tr.size, qty: tr.qty });
  }

  events.sort((a, b) => a.t - b.t);
  for (const ev of events) {
    const pool = getPool(ev.name, ev.size);
    if (ev.type === 'ALLOC' || ev.type === 'TRANSFER_IN') {
      pool.newStock += ev.qty;
    } else if (ev.type === 'TRANSFER_OUT') {
      pool.newStock -= ev.qty;
    } else if (ev.type === 'RETURN_GOOD') {
      pool.usedStock += ev.qty;
    } else if (ev.type === 'ISSUE') {
      const fromUsed = Math.min(ev.qty, pool.usedStock);
      pool.usedStock -= fromUsed;
      pool.newStock -= (ev.qty - fromUsed);
    } else if (ev.type === 'STOCK_LOSS') {
      const fromNew = Math.min(ev.qty, pool.newStock);
      pool.newStock -= fromNew;
      pool.usedStock -= (ev.qty - fromNew);
    }
  }
  return pools;
}

// ============ Chi Tiết Theo Kỳ (Phase 2) — mirror UX expand/collapse "Chi Tiết Tài Liệu" của module
// Tài Liệu: bấm 1 dòng tồn kho để xem SL Đã Nhận đến từ (những) kỳ cấp phát nào — tính HOÀN TOÀN phía
// trình duyệt từ DB.uniformPeriods đã tải sẵn, KHÔNG gọi thêm API nào. Chỉ gộp allocations ĐÃ CONFIRMED
// (đúng khớp "allocated" trong computeUniformStockClient() ở trên).
const uniformStockExpandedKeys = new Set();
function uniformStockRowKey(dept, name, size) { return `${dept}|||${name}|||${size || ''}`; }
function uniformPeriodBreakdownFor(dept, name, size) {
  const rows = [];
  for (const period of DB.uniformPeriods) {
    for (const alloc of (period.allocations || [])) {
      if (alloc.dept !== dept || alloc.status !== 'CONFIRMED') continue;
      for (const it of (alloc.items || [])) {
        if (it.name === name && (it.size || '') === (size || '')) {
          rows.push({ periodName: period.name, qty: it.qty, confirmedAt: alloc.confirmedAt, confirmedByName: alloc.confirmedByName });
        }
      }
    }
  }
  return rows;
}
function toggleUniformStockDetail(dept, name, size) {
  const key = uniformStockRowKey(dept, name, size);
  if (uniformStockExpandedKeys.has(key)) uniformStockExpandedKeys.delete(key);
  else uniformStockExpandedKeys.add(key);
  renderUniformStock();
}

function renderUniformStockStoreFilterOptions() {
  const wrap = document.getElementById('uniformStockStoreFilterWrap');
  const datalist = document.getElementById('uniformStoresFilterDatalist');
  if (!wrap || !datalist) return;
  if (!canManageUniform(currentUser)) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const depts = [...new Set((DB.uniformPeriods || []).flatMap(p => (p.allocations || []).map(a => a.dept)))].sort();
  sddSetOptions('uniformStoresFilterDatalist', depts);
}

// Ô lọc siêu thị là ô nhập-tìm-kiếm (thay dropdown vì danh sách siêu thị có thể rất dài) — khớp
// SUBSTRING không phân biệt hoa/thường, không cần gõ đúng tuyệt đối như dropdown trước đây.
function renderUniformStock() {
  const tbody = document.getElementById('uniformStockTableBody');
  if (!tbody) return;
  const canHc = canManageUniform(currentUser);
  const filterVal = (document.getElementById('uniformStockStoreFilter')?.value || '').trim().toLowerCase();
  const allStoreDepts = [...new Set((DB.uniformPeriods || []).flatMap(p => (p.allocations || []).map(a => a.dept)))].sort();
  const targetDepts = canHc ? (filterVal ? allStoreDepts.filter(d => d.toLowerCase().includes(filterVal)) : allStoreDepts) : [currentUser.dept];

  const rows = [];
  for (const dept of targetDepts) {
    const stock = computeUniformStockClient(dept);
    const breakdown = computeUniformStockBreakdownClient(dept);
    for (const row of stock.values()) {
      const pool = breakdown.get(`${row.name}|||${row.size || ''}`);
      rows.push({ dept, ...row, newStock: pool ? pool.newStock : 0, usedStock: pool ? pool.usedStock : 0 });
    }
  }
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center p-6 text-gray-500 italic">Chưa có dữ liệu tồn kho.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const key = uniformStockRowKey(r.dept, r.name, r.size);
    const expanded = uniformStockExpandedKeys.has(key);
    const code = uniformSkuFor(r.name, r.size);
    const periodBreakdown = expanded ? uniformPeriodBreakdownFor(r.dept, r.name, r.size) : [];
    const netTransfer = r.transferIn - r.transferOut;
    return `
    <tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-semibold">${escapeHtml(r.dept)}</td>
      <td class="border p-2">
        <button type="button" data-op="toggleUniformStockDetail" data-arg0="${escapeHtml(r.dept)}" data-arg1="${escapeHtml(r.name)}" data-arg2="${escapeHtml(r.size || '')}" class="text-teal-700 hover:underline font-semibold">${expanded ? '▾' : '▸'} ${escapeHtml(r.name)}</button>
        ${code ? `<span class="block text-[10px] text-cyan-700 font-mono">${escapeHtml(code)}</span>` : ''}
      </td>
      <td class="border p-2">${escapeHtml(r.size || '—')}</td>
      <td class="border p-2 text-right">${r.allocated.toLocaleString('vi-VN')}</td>
      <td class="border p-2 text-right">${r.issued.toLocaleString('vi-VN')}</td>
      <td class="border p-2 text-right ${r.hong > 0 ? 'text-rose-600 font-bold' : ''}">${r.hong.toLocaleString('vi-VN')}</td>
      <td class="border p-2 text-right ${r.huy > 0 ? 'text-gray-600 font-bold' : ''}">${r.huy.toLocaleString('vi-VN')}</td>
      <td class="border p-2 text-right ${r.mat > 0 ? 'text-orange-600 font-bold' : ''}">${r.mat.toLocaleString('vi-VN')}</td>
      <td class="border p-2 text-right text-emerald-700">${r.newStock.toLocaleString('vi-VN')}</td>
      <td class="border p-2 text-right text-amber-700">${r.usedStock.toLocaleString('vi-VN')}</td>
      <td class="border p-2 text-right font-bold ${r.stock <= 0 ? 'text-red-600' : 'text-green-700'}">${r.stock.toLocaleString('vi-VN')}${netTransfer !== 0 ? `<span class="block text-[10px] font-normal text-cyan-700">${netTransfer > 0 ? '+' : ''}${netTransfer} điều chuyển</span>` : ''}</td>
    </tr>
    ${expanded ? `
    <tr class="bg-teal-50/40">
      <td class="border p-2" colspan="11">
        <div class="text-[11px] text-gray-700">
          <div class="font-bold text-teal-800 mb-1">📋 Chi tiết theo kỳ cấp phát (đã xác nhận):</div>
          ${periodBreakdown.length ? `
            <table class="w-full border-collapse text-[11px]">
              <thead><tr class="text-left text-gray-500"><th class="p-1">Kỳ Cấp Phát</th><th class="p-1 text-right">SL</th><th class="p-1">Xác Nhận Bởi</th><th class="p-1">Lúc</th></tr></thead>
              <tbody>
                ${periodBreakdown.map(b => `<tr><td class="p-1">${escapeHtml(b.periodName)}</td><td class="p-1 text-right">${b.qty}</td><td class="p-1">${escapeHtml(b.confirmedByName || '')}</td><td class="p-1">${escapeHtml(b.confirmedAt || '')}</td></tr>`).join('')}
              </tbody>
            </table>
          ` : `<div class="italic text-gray-500">Không có dữ liệu.</div>`}
        </div>
      </td>
    </tr>
    ` : ''}
    `;
  }).join('');
}

// ============ Điều Chuyển Kho Giữa Các Siêu Thị (uniformTransfers, Phase 2) ============
// Yêu cầu: uniformStoreManage (nguồn = siêu thị mình). Duyệt/Từ chối: uniformApprove/admin (DÙNG CHUNG
// quyền duyệt kỳ cấp phát — canApproveUniformClient() ở trên). Lịch sử: lọc theo canViewUniformTransferClient()
// (mirror lib/recordViewScope.js canViewUniformTransfer() — server đã lọc DB.uniformTransfers trước khi
// gửi về, hàm này chỉ để phòng thủ thêm + tái dùng cho phần đếm/hiển thị phía client).
function canViewUniformTransferClient(user, item) {
  if (!user) return false;
  if (user.perms?.admin || user.perms?.uniformManage || user.perms?.uniformApprove) return true;
  return !!(user.perms?.uniformStoreManage && (item.sourceDept === user.dept || item.targetDept === user.dept));
}

function resetUniformTransferForm() {
  const formWrap = document.getElementById('uniformTransferRequestForm');
  if (!formWrap) return;
  const canRequest = canManageUniformStore(currentUser);
  formWrap.classList.toggle('hidden', !canRequest);
  if (!canRequest) return;

  const targetDatalist = document.getElementById('uniformTransferTargetDeptDatalist');
  if (targetDatalist) {
    sddSetOptions('uniformTransferTargetDeptDatalist', (DB.stores || []).filter(s => s !== currentUser.dept));
  }
  document.getElementById('uniformTransferTargetDept').value = '';

  const stock = computeUniformStockClient(currentUser.dept);
  const options = Array.from(stock.values()).filter(r => r.stock > 0).sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.size.localeCompare(b.size, 'vi'));
  const sel = document.getElementById('uniformTransferItemSize');
  if (sel) {
    sel.innerHTML = '<option value="">-- Chọn mặt hàng --</option>' +
      options.map(o => {
        const code = uniformSkuFor(o.name, o.size);
        return `<option value="${escapeHtml(o.name)}|||${escapeHtml(o.size)}">${formatUniformLabel(o.name, o.size, code)} (còn ${o.stock})</option>`;
      }).join('');
  }
  document.getElementById('uniformTransferQty').value = '';
  document.getElementById('uniformTransferReason').value = '';

  const approveWrap = document.getElementById('uniformTransferApprovalWrap');
  if (approveWrap) approveWrap.classList.toggle('hidden', !canApproveUniformClient(currentUser));
}

async function callCreateUniformTransfer(payload) {
  const res = await fetch('/api/records/uniformTransfers/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  if (res.status === 401) {
    handleSessionExpired();
    throw new Error('Phiên đăng nhập đã hết hạn');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return body; // { ok, item }
}

async function submitUniformTransfer() {
  const targetDept = document.getElementById('uniformTransferTargetDept').value.trim();
  const combo = document.getElementById('uniformTransferItemSize').value;
  const sep = combo.indexOf('|||');
  const itemName = sep === -1 ? '' : combo.slice(0, sep);
  const size = sep === -1 ? '' : combo.slice(sep + 3);
  const qty = parseFloat(document.getElementById('uniformTransferQty').value);
  const reason = document.getElementById('uniformTransferReason').value.trim();

  if (!targetDept || !(DB.stores || []).includes(targetDept)) return alert('Vui lòng chọn đúng 1 siêu thị nhận có trong Danh Mục Siêu Thị!');
  if (!itemName) return alert('Vui lòng chọn mặt hàng cần điều chuyển!');
  if (!qty || qty <= 0) return alert('Vui lòng nhập số lượng hợp lệ (> 0)!');
  if (!reason) return alert('Vui lòng nhập lý do điều chuyển!');

  let newTransfer;
  try {
    const result = await callCreateUniformTransfer({ targetDept, itemName, size, qty, reason });
    newTransfer = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.uniformTransfers.unshift(newTransfer);
  logSystemAction('UNIFORM', 'CREATE_UNIFORM_TRANSFER', `Yêu cầu điều chuyển [${newTransfer.itemName}] từ ${newTransfer.sourceDept} sang ${newTransfer.targetDept}`, 'SUCCESS', newTransfer.itemName);
  alert('✅ Đã gửi yêu cầu điều chuyển kho, chờ duyệt!');
  resetUniformTransferForm();
  renderUniformTransfersTable();
}

function uniformTransferStatusBadge(status) {
  if (status === 'APPROVED') return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-[11px]">✔️ Đã duyệt</span>`;
  if (status === 'REJECTED') return `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-[11px]">⛔ Đã từ chối</span>`;
  return `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-[11px]">⏳ Chờ duyệt</span>`;
}

function renderUniformTransferApprovalQueue() {
  const wrap = document.getElementById('uniformTransferApprovalList');
  const noNote = document.getElementById('uniformTransferNoPendingNote');
  const box = document.getElementById('uniformTransferApprovalWrap');
  if (!wrap || !box) return;
  const canApprove = canApproveUniformClient(currentUser);
  box.classList.toggle('hidden', !canApprove);
  if (!canApprove) return;
  const pending = (DB.uniformTransfers || []).filter(t => t.status === 'PENDING_APPROVAL');
  noNote.classList.toggle('hidden', pending.length > 0);
  wrap.innerHTML = pending.map(t => `
    <div class="bg-white p-3 rounded border flex items-center justify-between gap-2 flex-wrap">
      <div class="text-xs">
        <div class="font-bold text-cyan-900">${escapeHtml(t.sourceDept)} → ${escapeHtml(t.targetDept)}</div>
        <div class="text-gray-600">${formatUniformLabel(t.itemName, t.size, uniformSkuFor(t.itemName, t.size))}: ${t.qty} — ${escapeHtml(t.reason)}</div>
        <div class="text-[11px] text-gray-400">Yêu cầu bởi ${escapeHtml(t.requestedByName || '')} lúc ${escapeHtml(t.requestedAt || '')}</div>
      </div>
      <div class="flex gap-2">
        <button type="button" data-op="approveUniformTransferAction" data-arg0="${t.id}" class="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-emerald-700">✔️ Duyệt</button>
        <button type="button" data-op="rejectUniformTransferAction" data-arg0="${t.id}" class="bg-red-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-red-700">✕ Từ Chối</button>
      </div>
    </div>
  `).join('');
}

function approveUniformTransferAction(id) {
  showConfirmModal({
    title: 'Duyệt Điều Chuyển Kho',
    bodyHTML: 'Duyệt yêu cầu điều chuyển này? Tồn kho siêu thị nguồn sẽ giảm và siêu thị đích sẽ tăng ngay lập tức.',
    confirmLabel: 'Duyệt',
    onConfirm: async () => {
      let result;
      try {
        result = await callRecordAction('uniformTransfers', id, 'approve', {});
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.uniformTransfers.findIndex(x => x.id === id);
      if (idx !== -1) DB.uniformTransfers[idx] = result.item;
      logSystemAction('UNIFORM', 'APPROVE_UNIFORM_TRANSFER', `Duyệt điều chuyển [${result.item.itemName}] ${result.item.sourceDept} → ${result.item.targetDept}`, 'SUCCESS', result.item.itemName);
      alert('✅ Đã duyệt điều chuyển kho!');
      renderUniformTransferApprovalQueue();
      renderUniformTransfersTable();
      renderUniformStock();
      renderUniformIssueItems();
    }
  });
}

function rejectUniformTransferAction(id) {
  showConfirmModal({
    title: 'Từ Chối Điều Chuyển Kho',
    bodyHTML: `
      <div class="space-y-2">
        <div class="text-xs text-gray-600">Từ chối là QUYẾT ĐỊNH CUỐI CÙNG cho yêu cầu này.</div>
        <div>
          <label class="block font-semibold text-gray-600 mb-1 text-xs">Lý Do</label>
          <textarea id="uniformTransferRejectReason" rows="2" class="w-full border p-1.5 rounded text-xs" placeholder="Không bắt buộc..."></textarea>
        </div>
      </div>
    `,
    confirmLabel: 'Từ Chối',
    onConfirm: async () => {
      const reason = document.getElementById('uniformTransferRejectReason').value.trim();
      let result;
      try {
        result = await callRecordAction('uniformTransfers', id, 'reject', { reason });
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.uniformTransfers.findIndex(x => x.id === id);
      if (idx !== -1) DB.uniformTransfers[idx] = result.item;
      logSystemAction('UNIFORM', 'REJECT_UNIFORM_TRANSFER', `Từ chối điều chuyển [${result.item.itemName}] ${result.item.sourceDept} → ${result.item.targetDept}`, 'SUCCESS', result.item.itemName);
      alert('✅ Đã từ chối điều chuyển kho!');
      renderUniformTransferApprovalQueue();
      renderUniformTransfersTable();
    }
  });
}

function filterUniformTransferByCard(status) {
  applyDashboardCardFilter({ filterStatusUniformTransfer: status }, null, renderUniformTransfersTable);
}

function renderUniformTransfersTable() {
  const tbody = document.getElementById('uniformTransfersTableBody');
  if (!tbody) return;
  const statusFilter = document.getElementById('filterStatusUniformTransfer')?.value || '';
  const scopedTransfers = (DB.uniformTransfers || []).filter(t => canViewUniformTransferClient(currentUser, t));

  const uniformTransferDashCards = [
    { key: '', label: 'Tổng Yêu Cầu', count: scopedTransfers.length, colorClass: 'border-l-blue-500' },
    { key: 'PENDING_APPROVAL', label: 'Đang Chờ Duyệt', count: scopedTransfers.filter(t => t.status === 'PENDING_APPROVAL').length, colorClass: 'border-l-yellow-500' },
    { key: 'APPROVED', label: 'Đã Duyệt', count: scopedTransfers.filter(t => t.status === 'APPROVED').length, colorClass: 'border-l-green-500' },
    { key: 'REJECTED', label: 'Từ Chối', count: scopedTransfers.filter(t => t.status === 'REJECTED').length, colorClass: 'border-l-red-500' }
  ];
  const dashEl = document.getElementById('uniformTransferDashboardCards');
  if (dashEl) dashEl.innerHTML = buildDashboardCardsHTML(uniformTransferDashCards, statusFilter, 'filterUniformTransferByCard');

  const rows = scopedTransfers.filter(t => !statusFilter || t.status === statusFilter);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center p-6 text-gray-500 italic">Chưa có yêu cầu điều chuyển nào.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(t => `
    <tr class="hover:bg-gray-50 border-b">
      <td class="border p-2">${escapeHtml(t.requestedAt || '')}</td>
      <td class="border p-2">${escapeHtml(t.sourceDept)}</td>
      <td class="border p-2">${escapeHtml(t.targetDept)}</td>
      <td class="border p-2">${formatUniformLabel(t.itemName, t.size, uniformSkuFor(t.itemName, t.size))}</td>
      <td class="border p-2 text-right">${t.qty.toLocaleString('vi-VN')}</td>
      <td class="border p-2">${uniformTransferStatusBadge(t.status)}${t.status === 'REJECTED' && t.rejectReason ? `<div class="text-[10px] text-red-600">${escapeHtml(t.rejectReason)}</div>` : ''}</td>
      <td class="border p-2">${escapeHtml(t.requestedByName || '')}</td>
      <td class="border p-2">${t.approvedByName ? `${escapeHtml(t.approvedByName)} — ${escapeHtml(t.approvedAt || '')}` : '—'}</td>
    </tr>
  `).join('');
}

// ============ Tổng Quan (Dashboard, Phase 2) ============
// uniformManage/admin xem TẤT CẢ siêu thị gộp lại + bảng theo từng siêu thị; uniformStoreManage CHỈ
// xem đúng siêu thị mình (cùng quy ước scoping theo dept của mọi nơi khác trong module — không phát
// minh cơ chế mới). Tái sử dụng NGUYÊN VẸN computeUniformStockClient() — không có công thức tính mới.
function renderUniformDashboard() {
  const canHc = canManageUniform(currentUser);
  const allStoreDepts = [...new Set((DB.uniformPeriods || []).flatMap(p => (p.allocations || []).map(a => a.dept)))].sort();
  const targetDepts = canHc ? allStoreDepts : [currentUser.dept];

  let totalStock = 0, totalIssued = 0, totalDamaged = 0, totalLost = 0;
  const byItem = new Map(); // name -> { stock, issued }
  const bySize = new Map(); // size -> { stock, issued }
  const byStore = new Map(); // dept -> { stock, issued, damaged, lost, newStock, usedStock }

  for (const dept of targetDepts) {
    const stock = computeUniformStockClient(dept);
    const breakdown = computeUniformStockBreakdownClient(dept);
    let storeStock = 0, storeIssued = 0, storeDamaged = 0, storeLost = 0, storeNew = 0, storeUsed = 0;
    for (const row of stock.values()) {
      totalStock += row.stock; totalIssued += row.issued; totalDamaged += (row.hong + row.huy); totalLost += row.mat;
      storeStock += row.stock; storeIssued += row.issued; storeDamaged += (row.hong + row.huy); storeLost += row.mat;
      const pool = breakdown.get(`${row.name}|||${row.size || ''}`);
      storeNew += pool ? pool.newStock : 0;
      storeUsed += pool ? pool.usedStock : 0;

      if (!byItem.has(row.name)) byItem.set(row.name, { stock: 0, issued: 0 });
      byItem.get(row.name).stock += row.stock;
      byItem.get(row.name).issued += row.issued;

      const sizeKey = row.size || '(không size)';
      if (!bySize.has(sizeKey)) bySize.set(sizeKey, { stock: 0, issued: 0 });
      bySize.get(sizeKey).stock += row.stock;
      bySize.get(sizeKey).issued += row.issued;
    }
    byStore.set(dept, { stock: storeStock, issued: storeIssued, damaged: storeDamaged, lost: storeLost, newStock: storeNew, usedStock: storeUsed });
  }

  document.getElementById('uniformDashStatStock').textContent = totalStock.toLocaleString('vi-VN');
  document.getElementById('uniformDashStatIssued').textContent = totalIssued.toLocaleString('vi-VN');
  document.getElementById('uniformDashStatDamaged').textContent = totalDamaged.toLocaleString('vi-VN');
  document.getElementById('uniformDashStatLost').textContent = totalLost.toLocaleString('vi-VN');

  const itemBody = document.getElementById('uniformDashByItemBody');
  const itemRows = [...byItem.entries()].sort((a, b) => a[0].localeCompare(b[0], 'vi'));
  itemBody.innerHTML = itemRows.length ? itemRows.map(([name, v]) => `
    <tr><td class="border p-1.5">${escapeHtml(name)}</td><td class="border p-1.5 text-right">${v.stock.toLocaleString('vi-VN')}</td><td class="border p-1.5 text-right">${v.issued.toLocaleString('vi-VN')}</td></tr>
  `).join('') : `<tr><td colspan="3" class="text-center p-3 text-gray-500 italic">Chưa có dữ liệu.</td></tr>`;

  const sizeBody = document.getElementById('uniformDashBySizeBody');
  const sizeRows = [...bySize.entries()].sort((a, b) => a[0].localeCompare(b[0], 'vi'));
  sizeBody.innerHTML = sizeRows.length ? sizeRows.map(([size, v]) => `
    <tr><td class="border p-1.5">${escapeHtml(size)}</td><td class="border p-1.5 text-right">${v.stock.toLocaleString('vi-VN')}</td><td class="border p-1.5 text-right">${v.issued.toLocaleString('vi-VN')}</td></tr>
  `).join('') : `<tr><td colspan="3" class="text-center p-3 text-gray-500 italic">Chưa có dữ liệu.</td></tr>`;

  const storeWrap = document.getElementById('uniformDashByStoreWrap');
  storeWrap.classList.toggle('hidden', !canHc);
  if (canHc) {
    const storeBody = document.getElementById('uniformDashByStoreBody');
    const storeRows = [...byStore.entries()].sort((a, b) => a[0].localeCompare(b[0], 'vi'));
    storeBody.innerHTML = storeRows.length ? storeRows.map(([dept, v]) => `
      <tr>
        <td class="border p-1.5 font-semibold">${escapeHtml(dept)}</td>
        <td class="border p-1.5 text-right text-emerald-700">${v.newStock.toLocaleString('vi-VN')}</td>
        <td class="border p-1.5 text-right text-amber-700">${v.usedStock.toLocaleString('vi-VN')}</td>
        <td class="border p-1.5 text-right font-semibold">${v.stock.toLocaleString('vi-VN')}</td>
        <td class="border p-1.5 text-right">${v.issued.toLocaleString('vi-VN')}</td>
        <td class="border p-1.5 text-right">${v.damaged.toLocaleString('vi-VN')}</td>
        <td class="border p-1.5 text-right">${v.lost.toLocaleString('vi-VN')}</td>
      </tr>
    `).join('') : `<tr><td colspan="7" class="text-center p-3 text-gray-500 italic">Chưa có dữ liệu.</td></tr>`;
    uniformDashByStoreCache = storeRows;
  }
}

// Xuất Excel bảng "Theo Siêu Thị" ở Tổng Quan — cùng cơ chế chung downloadXlsxFromServer() đã dùng cho
// mọi màn xuất Excel khác trong app (vd exportTrainingResultsExcel()), KHÔNG có route riêng. Dùng lại
// cache đã tính sẵn lúc renderUniformDashboard() thay vì tính lại (bảng chỉ hiện cho canManageUniform
// nên cache luôn khớp đúng những gì đang hiển thị trên màn hình khi bấm nút).
let uniformDashByStoreCache = [];
async function exportUniformDashByStoreExcel() {
  if (!uniformDashByStoreCache.length) return alert('Chưa có dữ liệu để xuất.');
  const rows = uniformDashByStoreCache.map(([dept, v]) => ({
    sieuThi: dept, moi: v.newStock, daSuDung: v.usedStock, tongTonKho: v.stock, daCap: v.issued, hongHuy: v.damaged, mat: v.lost
  }));
  await downloadXlsxFromServer(
    `DongPhuc_TheoSieuThi_${nowVN().split(' ')[1].replace(/\//g, '-')}.xlsx`,
    'Đồng Phục Theo Siêu Thị',
    [
      { header: 'Siêu Thị', key: 'sieuThi', width: 24 },
      { header: 'Mới', key: 'moi', width: 12 },
      { header: 'Đã Sử Dụng', key: 'daSuDung', width: 14 },
      { header: 'Tổng Tồn Kho', key: 'tongTonKho', width: 14 },
      { header: 'Đã Cấp', key: 'daCap', width: 12 },
      { header: 'Hỏng/Hủy', key: 'hongHuy', width: 12 },
      { header: 'Mất', key: 'mat', width: 10 }
    ],
    rows
  );
}

