// ==========================================
// 10. ADMIN MANAGEMENT (USER, DEPT, CAT)
// ==========================================
// ===== Cảnh báo TRƯỚC KHI xoá 1 giá trị danh mục dùng chung (Quản Lý Danh Mục) =====
// PHÁT HIỆN (đợt audit chuyên sâu cụm "Hệ Thống/Admin/Cấu Hình", mức Trung bình): xoá 1 giá trị danh
// mục (Phòng Ban/Siêu Thị/Chức Danh/Loại Tài Liệu/Loại Đào Tạo...) KHÔNG kiểm tra tham chiếu ở bất kỳ
// đâu — hồ sơ cũ, cấu hình quy trình theo phòng ban, phạm vi quyền theo phòng ban, tài khoản người
// dùng... đều lưu giá trị này dưới dạng CHUỖI, nên sau khi xoá vẫn còn nguyên tham chiếu treo; và nếu
// sau này tạo lại đúng tên cũ thì toàn bộ cấu hình cũ "sống lại" âm thầm (có thể mở lại quyền/quy
// trình cho một tên trùng lặp mà admin không hề chủ ý). Kiểm tra tham chiếu triệt để cho MỌI danh mục
// là việc lớn, nằm ngoài phạm vi bản vá này — ở đây đưa ra CẢNH BÁO RÕ RÀNG (thay cho hộp thoại
// "Xóa X?" cụt lủn trước đây) để admin biết đúng hệ quả trước khi xác nhận, và nhắc dùng nút "✏️ Sửa"
// (đổi tên CÓ CASCADE qua routes/adminCatalog.js) khi chỉ muốn sửa tên gõ sai.
function confirmCatalogValueDeletion(kindLabel, value, extraNote) {
  return confirm(
    `Xoá ${kindLabel} "${value}"?\n\n` +
    `⚠️ Hệ thống KHÔNG kiểm tra được hết nơi đang dùng giá trị này: hồ sơ đã tạo, cấu hình quy trình/` +
    `phạm vi quyền theo phòng ban, tài khoản người dùng... vẫn giữ nguyên chuỗi "${value}" và sẽ thành ` +
    `tham chiếu treo (không còn chọn lại được trên dropdown). Nếu sau này tạo lại đúng tên cũ, các cấu ` +
    `hình cũ đó sẽ tự động có hiệu lực trở lại.\n\n` +
    `👉 Nếu chỉ muốn ĐỔI TÊN, hãy dùng nút "✏️ Sửa" (đổi tên có cập nhật dây chuyền toàn hệ thống) thay ` +
    `vì xoá rồi tạo lại.${extraNote ? `\n\n${extraNote}` : ''}\n\nVẫn tiếp tục xoá?`
  );
}

// LỖI ĐÃ VÁ (cùng đợt rà soát "F5 mất cấu hình danh mục"): trước đây các hàm dưới đây mutate DB.depts/
// DB.deptAbbrs/DB.deptGroups rồi gọi syncStorage(key) KHÔNG await + KHÔNG rollback khi lưu thất bại
// (409 xung đột/mất mạng) — UI vẫn hiện như đã lưu xong, F5 mới lộ ra chưa hề lưu được. Nay await +
// rollback đúng khuôn addStoreToCatalog()/deleteStore() (đã vá đợt trước) cho cả nhóm depts/deptAbbrs/
// deptGroups.
async function saveDept(e) {
  e.preventDefault();
  const name = document.getElementById('txtDeptName').value.trim();
  if (DB.depts.includes(name)) return alert('Phòng ban đã tồn tại!');
  DB.depts.push(name);
  const saved = await syncStorage('depts');
  if (!saved) { DB.depts = DB.depts.filter(d => d !== name); return; }
  logSystemAction('USER_MGM', 'ADD_DEPT', `Thêm phòng ban mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtDeptName').value = '';
  renderDeptList();
  populateDropdowns();
}

async function deleteDept(name) {
  if (!confirmCatalogValueDeletion('phòng ban', name, 'Viết tắt phòng ban (dùng sinh Mã Tài Liệu) của phòng này cũng bị xoá theo.')) return;
  const prevDepts = [...DB.depts];
  const prevDeptAbbrs = { ...DB.deptAbbrs };
  const prevDeptGroups = DB.deptGroups.map(g => ({ ...g, depts: [...g.depts] }));
  DB.depts = DB.depts.filter(d => d !== name);
  delete DB.deptAbbrs[name];
  // Khối/Ban (10/2026) — dọn luôn tên Phòng Ban vừa xoá khỏi mọi deptGroups[].depts[] đang gán, tránh
  // hiện "ma" (Phòng Ban đã xoá nhưng vẫn liệt kê là con của 1 Khối/Ban).
  const affectedGroups = DB.deptGroups.filter(g => g.depts.includes(name));
  if (affectedGroups.length) affectedGroups.forEach(g => { g.depts = g.depts.filter(d => d !== name); });
  const [savedDepts, savedAbbrs, savedGroups] = await Promise.all([
    syncStorage('depts'), syncStorage('deptAbbrs'), affectedGroups.length ? syncStorage('deptGroups') : Promise.resolve(true)
  ]);
  if (!savedDepts || !savedAbbrs || !savedGroups) {
    DB.depts = prevDepts; DB.deptAbbrs = prevDeptAbbrs; DB.deptGroups = prevDeptGroups;
    renderDeptList(); renderDeptGroupList();
    return;
  }
  logSystemAction('USER_MGM', 'DELETE_DEPT', `Xóa phòng ban [${name}]`, 'SUCCESS', name);
  renderDeptList();
  renderDeptGroupList();
  populateDropdowns();
}

// Viết tắt Phòng ban (dùng sinh Mã Tài Liệu, xem generateDocCode()) — tự suy ra mặc định nếu admin
// chưa từng sửa, áp dụng ngay không cần duyệt.
async function updateDeptAbbr(name, value) {
  const prevAbbrs = { ...DB.deptAbbrs };
  const abbr = (value || '').trim().toUpperCase();
  if (!abbr) delete DB.deptAbbrs[name];
  else DB.deptAbbrs[name] = abbr;
  const saved = await syncStorage('deptAbbrs');
  if (!saved) { DB.deptAbbrs = prevAbbrs; renderDeptList(); return; }
  logSystemAction('USER_MGM', 'UPDATE_DEPT_ABBR', `Cập nhật viết tắt phòng ban [${name}] = "${abbr}"`, 'SUCCESS', name);
}

function renderDeptList() {
  const ul = document.getElementById('deptList');
  if (!ul) return;
  ul.innerHTML = renderCatalogBulkBarHtml('depts') + DB.depts.map(d => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      ${renderCatalogBulkCheckboxHtml('depts', d)}
      <span class="flex-1">${escapeHtml(d)}</span>
      <input value="${escapeHtml(getDeptAbbr(d))}" data-op-change="updateDeptAbbr" data-arg0="'${escapeHtml(d)}'" data-arg-value="1" title="Viết tắt (dùng sinh Mã Tài Liệu)" class="w-16 border rounded px-1 py-0.5 text-center text-[11px] font-mono uppercase">
      <button data-op="renameDept" data-arg0="'${escapeHtml(d)}'" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="moveDeptToStore" data-arg0="'${escapeHtml(d)}'" title="Chuyển sang Danh Mục Siêu Thị" class="text-orange-600 font-bold hover:underline whitespace-nowrap">Chuyển</button>
      <button data-op="deleteDept" data-arg0="'${escapeHtml(d)}'" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}

// BUG THẬT đã sửa (rà soát theo yêu cầu người dùng "trong danh mục bạn xử lý cho tất cả các danh mục
// đều phải sửa được thay vì phải xóa tạo lại như bây giờ") — trước đây Phòng Ban chỉ sửa được viết tắt
// (ô input inline) và "Chuyển" sang Siêu Thị, KHÔNG có cách nào đổi lại chính TÊN phòng ban nếu gõ sai
// lúc tạo mà không xoá-tạo-lại (mất hết cấu hình quyền/quy trình gắn theo tên đó). Dùng lại ĐÚNG route
// có cascade (routes/adminCatalog.js 'depts', xem lib/catalogRename.js::cascadeDeptRename()).
async function renameDept(name) {
  const ok = await renameCatalogEntryClient('depts', name, 'Danh Mục Phòng Ban');
  if (ok) { renderDeptList(); populateDropdowns(); }
}

// ===== Khối/Ban (DB.deptGroups, 10/2026 — yêu cầu người dùng "thêm cột Khối/Ban trước Phòng Ban, cho
// tạo được Khối/Ban trong danh mục, gán Phòng Ban con") — nhóm CHA của Phòng Ban, dùng để lọc ô "Phòng
// Ban" ở form Người Dùng (uKhoiBan/uDept, xem populateUserDeptOptions() ở core.js) và ở Phân Quyền (xem
// renderDeptCheckboxes() bên dưới). Mảng OBJECT {id, name, depts:[]} — id tự sinh client-side (mirror
// saveCarVehicleType() ở module-dangkyxe.js), KHÔNG có route cascade rename riêng như depts/stores vì
// user.khoiBan lưu THEO id bất biến, không theo tên — đổi tên chỉ là sửa field `name` tại chỗ. =====
async function saveDeptGroup(e) {
  e.preventDefault();
  const name = document.getElementById('txtDeptGroupName').value.trim();
  if (!name) return;
  if (DB.deptGroups.some(g => g.name === name)) return alert('Khối/Ban đã tồn tại!');
  const prevGroups = DB.deptGroups.map(g => ({ ...g, depts: [...g.depts] }));
  const nextId = DB.deptGroups.reduce((max, g) => Math.max(max, g.id || 0), 0) + 1;
  DB.deptGroups.push({ id: nextId, name, depts: [] });
  const saved = await syncStorage('deptGroups');
  if (!saved) { DB.deptGroups = prevGroups; return; }
  logSystemAction('USER_MGM', 'ADD_DEPT_GROUP', `Thêm Khối/Ban mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtDeptGroupName').value = '';
  renderDeptGroupList();
  populateDropdowns();
  refreshPermDeptGroupFilterAfterKhoiBanChange();
}

async function renameDeptGroup(id) {
  const g = DB.deptGroups.find(x => x.id === id);
  if (!g) return;
  const newName = String(prompt(`Nhập tên mới cho Khối/Ban "${g.name}":`, g.name) || '').trim();
  if (!newName || newName === g.name) return;
  if (DB.deptGroups.some(x => x.id !== id && x.name === newName)) return alert('Tên Khối/Ban đã tồn tại!');
  const prevName = g.name;
  g.name = newName;
  const saved = await syncStorage('deptGroups');
  if (!saved) { g.name = prevName; renderDeptGroupList(); return; }
  logSystemAction('USER_MGM', 'RENAME_DEPT_GROUP', `Đổi tên Khối/Ban → [${newName}]`, 'SUCCESS', newName);
  renderDeptGroupList();
  populateDropdowns();
  refreshPermDeptGroupFilterAfterKhoiBanChange();
}

async function deleteDeptGroup(id) {
  const g = DB.deptGroups.find(x => x.id === id);
  if (!g) return;
  if (!confirm(`Xoá Khối/Ban "${g.name}"?\n\nNgười dùng/màn Phân Quyền đang lọc theo Khối này sẽ tự coi như "để trống" (hiện lại toàn bộ Phòng Ban) — KHÔNG xoá Phòng Ban con, chỉ mất liên kết nhóm.`)) return;
  const prevGroups = DB.deptGroups.map(x => ({ ...x, depts: [...x.depts] }));
  DB.deptGroups = DB.deptGroups.filter(x => x.id !== id);
  const saved = await syncStorage('deptGroups');
  if (!saved) { DB.deptGroups = prevGroups; renderDeptGroupList(); return; }
  logSystemAction('USER_MGM', 'DELETE_DEPT_GROUP', `Xóa Khối/Ban [${g.name}]`, 'SUCCESS', g.name);
  renderDeptGroupList();
  populateDropdowns();
  refreshPermDeptGroupFilterAfterKhoiBanChange();
}

// Đổi danh sách Phòng Ban con của 1 Khối/Ban — đọc giá trị hiện có trong widget renderMultiSelectDropdown()
// bằng getMultiSelectValues() khi bấm nút "💾 Lưu Phòng Ban" (KHÔNG dùng callback onChange live-save vì
// renderMultiSelectDropdown() tự bắn onChange ngay cả lúc SETUP với initialSelected — live-save sẽ gọi
// ngược lại renderDeptGroupList() ngay trong lúc đang dựng DOM, cùng lý do khiến khối
// renderOperationOrderReceiptScopeCheckboxes() cũng chỉ đọc giá trị lúc submit form, không live-save).
async function saveDeptGroupChildren(id) {
  const g = DB.deptGroups.find(x => x.id === id);
  if (!g) return;
  const prevDepts = [...g.depts];
  g.depts = getMultiSelectValues(`deptGroupChildren_${id}`);
  const saved = await syncStorage('deptGroups');
  if (!saved) { g.depts = prevDepts; return; }
  logSystemAction('USER_MGM', 'UPDATE_DEPT_GROUP_CHILDREN', `Cập nhật Phòng Ban con của Khối/Ban [${g.name}]: ${g.depts.join(', ') || '(rỗng)'}`, 'SUCCESS', g.name);
  populateDropdowns();
  refreshPermDeptGroupFilterAfterKhoiBanChange();
  alert(`✅ Đã lưu ${g.depts.length} Phòng Ban thuộc Khối/Ban "${g.name}".`);
}

function renderDeptGroupList() {
  const wrap = document.getElementById('deptGroupListWrap');
  if (!wrap) return;
  wrap.innerHTML = renderObjectCatalogBulkBarHtml('deptGroups', 'div') + ((DB.deptGroups || []).map(g => `
    <div class="bg-white rounded border p-2.5 space-y-1.5">
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-xs flex items-center gap-2">${renderObjectCatalogBulkCheckboxHtml('deptGroups', g.id)}${escapeHtml(g.name)} <span class="text-gray-400 font-normal">(${g.depts.length} phòng ban)</span></span>
        <div class="flex gap-2 shrink-0">
          <button type="button" data-op="renameDeptGroup" data-arg0="${g.id}" class="text-blue-600 font-bold hover:underline text-xs whitespace-nowrap">✏️ Sửa tên</button>
          <button type="button" data-op="deleteDeptGroup" data-arg0="${g.id}" class="text-red-500 font-bold hover:underline text-xs">Xóa</button>
        </div>
      </div>
      <div id="deptGroupChildren_${g.id}"></div>
      <div class="flex justify-end">
        <button type="button" data-op="saveDeptGroupChildren" data-arg0="${g.id}" class="bg-purple-600 text-white text-[11px] font-bold px-2.5 py-1 rounded hover:bg-purple-700">💾 Lưu Phòng Ban</button>
      </div>
    </div>
  `).join('') || '<p class="text-[11px] text-gray-400 italic">Chưa có Khối/Ban nào.</p>');
  (DB.deptGroups || []).forEach(g => {
    renderMultiSelectDropdown(`deptGroupChildren_${g.id}`, DB.depts, g.depts, {
      placeholder: '🔍 Tìm Phòng Ban để gán vào Khối này...',
      emptyText: 'Chưa gán Phòng Ban nào.'
    });
  });
}

// ===== Danh Mục Siêu Thị (DB.stores) — TÁCH RIÊNG khỏi DB.depts (xem defaults.js), cùng khuôn CRUD
// đơn giản với Phòng Ban ở trên (không kiểm tra usage trước khi xóa) — dùng cho Vị Trí "Siêu Thị" ở
// form Người Dùng và module Đồng Phục (xem renderUniformAllocationBlocks()). =====
// Lõi thêm 1 siêu thị vào Danh Mục — TÁCH RIÊNG khỏi saveStore() (đọc thẳng ô #txtStoreName của màn
// Quản Lý Danh Mục) để dùng chung được cho nút "+ Thêm siêu thị mới" ngay tại form Người Dùng (Vị Trí
// "Siêu Thị", xem promptAddStoreInline() — theo yêu cầu người dùng 10/2026: đang tạo/sửa 1 người Siêu
// Thị mà siêu thị họ thuộc về CHƯA có trong Danh Mục thì không phải rời form đi thêm trước). Trả về
// true/false (đã tự alert lý do khi false) để caller biết có nên tiếp tục chọn giá trị đó hay không.
// LỖI ĐÃ VÁ (báo cáo thực tế "danh mục siêu thị không lưu được khi chọn siêu thị, cửa hàng"): trước đây
// KHÔNG await syncStorage('stores') và KHÔNG rollback DB.stores khi lưu thất bại (409 xung đột/mất mạng)
// — DB.stores/renderStoreList() vẫn hiện siêu thị vừa thêm/xoá như đã lưu xong (dù syncStorage() có tự
// alert lỗi ở nền), khiến F5 sau đó mới lộ ra là chưa hề lưu được lên server. Nay await + rollback đúng
// khuôn setStoreType() (đã làm đúng từ đầu) áp dụng cho cả add/xoá bên dưới.
async function addStoreToCatalog(name) {
  if (!name) return false;
  if (DB.stores.includes(name)) { alert('Siêu thị đã tồn tại!'); return false; }
  DB.stores.push(name);
  const saved = await syncStorage('stores');
  if (!saved) { DB.stores = DB.stores.filter(s => s !== name); return false; }
  logSystemAction('USER_MGM', 'ADD_STORE', `Thêm siêu thị mới [${name}]`, 'SUCCESS', name);
  return true;
}

async function saveStore(e) {
  e.preventDefault();
  const name = document.getElementById('txtStoreName').value.trim();
  if (!name) return;
  if (!(await addStoreToCatalog(name))) return;
  document.getElementById('txtStoreName').value = '';
  renderStoreList();
  populateDropdowns();
}

// "+ Thêm siêu thị mới" ngay tại ô "Siêu Thị" của form Người Dùng — gõ tên mới, tự thêm vào Danh Mục
// Siêu Thị (addStoreToCatalog() ở trên) + populateDropdowns() nạp lại toàn bộ dropdown (kể cả #uStore)
// + tự CHỌN LUÔN giá trị vừa thêm, không phải rời form đi Quản Lý Danh Mục thêm trước rồi quay lại.
async function promptAddStoreInline() {
  const name = String(prompt('Tên siêu thị mới:') || '').trim();
  if (!name) return;
  if (!(await addStoreToCatalog(name))) return;
  populateDropdowns();
  document.getElementById('uStore').value = name;
}

async function deleteStore(name) {
  if (!confirmCatalogValueDeletion('siêu thị', name)) return;
  const prevStores = [...DB.stores];
  DB.stores = DB.stores.filter(s => s !== name);
  const saved = await syncStorage('stores');
  if (!saved) { DB.stores = prevStores; renderStoreList(); return; }
  logSystemAction('USER_MGM', 'DELETE_STORE', `Xóa siêu thị [${name}]`, 'SUCCESS', name);
  renderStoreList();
  populateDropdowns();
}

function renderStoreList() {
  const ul = document.getElementById('storeList');
  if (!ul) return;
  const types = DB.storeTypes || {};
  ul.innerHTML = renderCatalogBulkBarHtml('stores') + DB.stores.map(s => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      ${renderCatalogBulkCheckboxHtml('stores', s)}
      <span class="flex-1">${escapeHtml(s)}</span>
      <select data-op-change="setStoreType" data-arg0="'${escapeHtml(s)}'" data-arg-value="1" class="border rounded text-[11px] p-0.5">
        <option value="" ${!types[s] ? 'selected' : ''}>— Chưa phân loại —</option>
        <option value="ST" ${types[s] === 'ST' ? 'selected' : ''}>Siêu Thị</option>
        <option value="CH" ${types[s] === 'CH' ? 'selected' : ''}>Cửa Hàng</option>
        <option value="WH" ${types[s] === 'WH' ? 'selected' : ''}>Kho</option>
      </select>
      <button data-op="renameStore" data-arg0="'${escapeHtml(s)}'" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteStore" data-arg0="'${escapeHtml(s)}'" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}

// setStoreType() — gán phân loại Siêu Thị (ST)/Cửa Hàng (CH) cho 1 tên trong Danh Mục Siêu Thị (10/2026,
// yêu cầu người dùng — phục vụ Dashboard "Báo Cáo Đánh Giá VSATTP" tách riêng Top 5/tỷ lệ vi phạm theo
// ST/CH, xem renderChecklistVsattpDashboard() ở module-checklist.js). DB.stores TỰ NÓ không đổi hình
// dạng — storeTypes là 1 catalog map RIÊNG { [tên]: 'ST'|'CH' }, xem chú thích đầy đủ ở defaults.js.
async function setStoreType(name, type) {
  const prev = { ...(DB.storeTypes || {}) };
  const next = { ...(DB.storeTypes || {}) };
  if (type) next[name] = type; else delete next[name];
  DB.storeTypes = next;
  const saved = await syncStorage('storeTypes');
  if (!saved) { DB.storeTypes = prev; renderStoreList(); return; }
  logSystemAction('USER_MGM', 'SET_STORE_TYPE', `Phân loại siêu thị [${name}] → [${type || 'Chưa phân loại'}]`, 'SUCCESS', name);
}

// Sửa (rename, CÓ CASCADE) 1 giá trị trong danh mục "stores"/"jobTitles"/"storeJobTitles" — gọi route
// server riêng POST /api/admin/renameCatalogEntry (routes/adminCatalog.js), KHÔNG dùng syncStorage()
// thường: route đó tự ghi danh mục + cascade cập nhật MỌI nơi khác đang lưu nguyên chuỗi cũ (xem
// lib/catalogRename.js — user.dept/jobTitle, docs/submissions/carRegs/officeReqs/vppRegistrations/
// itPriceApprovals/budgetEntries/uniformIssuances/uniformStockAdjustments/uniformTransfers.dept,
// contracts.dept+custodianDept, uniformPeriods[].allocations[].dept, vppExcludedJobTitles[]...).
// DB.<catalogKey> phía trình duyệt được cập nhật NGAY từ giá trị server trả về, nhưng các collection
// KHÁC (DB.docs, DB.users, DB.contracts...) đang có sẵn trong bộ nhớ vẫn giữ TÊN CŨ cho tới khi tải lại
// trang (server đã ghi đúng tên mới) — nhắc admin tải lại trang để thấy tên mới ở TOÀN BỘ màn hình.
async function renameCatalogEntryClient(catalogKey, oldValue, catalogLabel) {
  const newValue = prompt(`Nhập tên mới cho "${oldValue}" (${catalogLabel}):`, oldValue);
  if (newValue === null) return false;
  const trimmed = newValue.trim();
  if (!trimmed || trimmed === oldValue) return false;
  try {
    const res = await fetch('/api/admin/renameCatalogEntry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogKey, oldValue, newValue: trimmed })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    DB[catalogKey] = body.catalog;
    logSystemAction('USER_MGM', 'RENAME_CATALOG_ENTRY', `Đổi tên ${catalogLabel} [${oldValue}] → [${trimmed}]`, 'SUCCESS', trimmed);
    alert(`✅ Đã đổi tên "${oldValue}" thành "${trimmed}" (đã cập nhật mọi hồ sơ/tài khoản liên quan ở máy chủ).\n\nVui lòng TẢI LẠI TRANG để thấy tên mới hiển thị ở toàn bộ màn hình (các hồ sơ đang mở sẵn trong phiên này vẫn tạm hiện tên cũ cho tới khi tải lại).`);
    return true;
  } catch (err) {
    alert(`⛔ Lỗi đổi tên: ${err.message}`);
    return false;
  }
}

async function renameStore(name) {
  const ok = await renameCatalogEntryClient('stores', name, 'Danh Mục Siêu Thị');
  if (ok) { renderStoreList(); populateDropdowns(); }
}

// ---------- Import Excel Danh Mục Siêu Thị (mục 3b) — copy khuôn 2 bước của training-roster
// (onTrainingRosterFileChange()/addTrainingRosterFileFound()): đọc + xem trước (mới/trùng) NGAY khi
// chọn file (server đối chiếu với DB.stores hiện có, xem routes/storeCatalogImport.js), client tự merge
// phần "mới" vào DB.stores rồi gọi syncStorage('stores') có sẵn khi bấm Xác Nhận — KHÔNG có route
// "confirm add" riêng vì stores là mảng phẳng đơn giản. ----------
let storeImportPreviewItems = []; // kết quả gần nhất từ /api/stores/parse-import

const STORE_TYPE_LABEL_VI_CLIENT = { ST: 'Siêu Thị', CH: 'Cửa Hàng', WH: 'Kho' };

// 📤 Xuất Excel Danh Mục Siêu Thị (10/2026, theo yêu cầu người dùng — trước đây panel này CHỈ có "⬇️ Tải
// Mẫu"/"📥 Nhập Excel", chưa từng xuất được danh sách hiện có) — 2 cột Tên + Loại, dùng chung route
// generic POST /api/admin/export-xlsx (không cần route riêng, xem downloadXlsxFromServer() ở core.js).
async function exportStoreCatalogExcel() {
  const types = DB.storeTypes || {};
  const rows = (DB.stores || []).map(s => ({ name: s, type: STORE_TYPE_LABEL_VI_CLIENT[types[s]] || '' }));
  await downloadXlsxFromServer('DanhSachSieuThi.xlsx', 'Danh Sách Siêu Thị', [
    { key: 'name', header: 'Tên Siêu Thị' },
    { key: 'type', header: 'Loại' }
  ], rows);
}

async function onStoreImportFileChange(event) {
  const file = event.target.files[0];
  storeImportPreviewItems = [];
  document.getElementById('storeImportPreviewWrap').classList.add('hidden');
  document.getElementById('storeImportConfirmBtn').classList.add('hidden');
  const statusEl = document.getElementById('storeImportStatus');
  if (!file) { statusEl.innerText = ''; return; }

  statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/stores/parse-import', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    storeImportPreviewItems = data.items;
    const types = DB.storeTypes || {};
    const newCount = data.items.filter(it => it.isNew).length;
    // typeChangeCount — dòng có cột "Loại" điền khác giá trị đang lưu (kể cả siêu thị ĐÃ CÓ sẵn, theo
    // yêu cầu người dùng "để có thể import luôn mục này" — không chỉ áp dụng cho siêu thị MỚI).
    const typeChangeCount = data.items.filter(it => it.type && types[it.name] !== it.type).length;
    statusEl.innerText = `✅ Đọc file "${data.fileName}": ${newCount}/${data.items.length} siêu thị MỚI` +
      (typeChangeCount ? `, ${typeChangeCount} dòng sẽ cập nhật "Loại"` : '') + '.';
    document.getElementById('storeImportPreviewBody').innerHTML = data.items.map(it => `<tr>
      <td class="p-1">${escapeHtml(it.name)}</td>
      <td class="p-1">${it.type ? escapeHtml(STORE_TYPE_LABEL_VI_CLIENT[it.type] || it.type) : '<span class="text-gray-400">—</span>'}</td>
      <td class="p-1">${it.isNew ? '<span class="text-emerald-600">✅ Mới</span>' : '<span class="text-gray-400">— Đã có</span>'}</td>
    </tr>`).join('');
    document.getElementById('storeImportPreviewWrap').classList.remove('hidden');
    if (newCount > 0 || typeChangeCount > 0) document.getElementById('storeImportConfirmBtn').classList.remove('hidden');
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
  }
}

async function confirmStoreImport() {
  const newNames = storeImportPreviewItems.filter(it => it.isNew).map(it => it.name);
  const typeChanges = storeImportPreviewItems.filter(it => it.type && (DB.storeTypes || {})[it.name] !== it.type);
  if (!newNames.length && !typeChanges.length) return;
  const prevStores = [...DB.stores];
  const prevTypes = { ...(DB.storeTypes || {}) };
  if (newNames.length) DB.stores = [...DB.stores, ...newNames];
  if (typeChanges.length) {
    const nextTypes = { ...(DB.storeTypes || {}) };
    typeChanges.forEach(it => { nextTypes[it.name] = it.type; });
    DB.storeTypes = nextTypes;
  }
  const syncKeys = [];
  if (newNames.length) syncKeys.push('stores');
  if (typeChanges.length) syncKeys.push('storeTypes');
  const results = await Promise.all(syncKeys.map(k => syncStorage(k)));
  if (results.some(ok => !ok)) { DB.stores = prevStores; DB.storeTypes = prevTypes; return; }
  logSystemAction('USER_MGM', 'IMPORT_STORES', `Import Excel: thêm ${newNames.length} siêu thị mới, cập nhật Loại cho ${typeChanges.length} dòng`, 'SUCCESS', String(newNames.length));
  alert(`✅ Đã thêm ${newNames.length} siêu thị mới` + (typeChanges.length ? `, cập nhật "Loại" cho ${typeChanges.length} dòng` : '') + ' vào Danh Mục Siêu Thị.');
  storeImportPreviewItems = [];
  document.getElementById('storeImportFileInput').value = '';
  document.getElementById('storeImportStatus').innerText = '';
  document.getElementById('storeImportPreviewWrap').classList.add('hidden');
  document.getElementById('storeImportConfirmBtn').classList.add('hidden');
  renderStoreList();
  populateDropdowns();
}

// Chuyển 1 tên đang nằm trong Danh Mục Phòng Ban sang Danh Mục Siêu Thị — CHỈ đổi danh mục sở hữu cái
// tên (xóa khỏi DB.depts, thêm vào DB.stores GIỮ NGUYÊN chuỗi), KHÔNG đụng tới user.dept/item.dept của
// bất kỳ user hay bản ghi nào đã có — mọi workflow/quyền scope dùng dept làm khoá tra cứu vẫn hoạt động
// y hệt vì giá trị chuỗi không đổi, chỉ khác nơi hiển thị trong 2 danh mục quản lý.
async function moveDeptToStore(name) {
  if (DB.stores.includes(name)) return alert('Tên này đã có trong Danh Mục Siêu Thị!');
  if (!confirm(`Chuyển "${name}" từ Danh Mục Phòng Ban sang Danh Mục Siêu Thị?\n\nCác user/bản ghi đang thuộc phòng ban này sẽ KHÔNG bị ảnh hưởng — chỉ đổi nơi hiển thị trong danh mục quản lý.`)) return;
  const prevDepts = [...DB.depts], prevStores = [...DB.stores];
  DB.depts = DB.depts.filter(d => d !== name);
  DB.stores.push(name);
  // LỖI ĐÃ VÁ: 2 lượt syncStorage() độc lập trước đây không await/không rollback — nếu lượt "stores"
  // thất bại (409/mất mạng) sau khi "depts" đã lưu thành công, tên đó BIẾN MẤT khỏi cả 2 danh mục sau
  // F5 (đã xoá khỏi DB.depts thật, nhưng chưa hề thêm vào DB.stores thật). Await CẢ 2 + rollback ĐỦ CẢ
  // HAI về đúng trạng thái ban đầu nếu BẤT KỲ lượt nào thất bại, không để dở dang giữa chừng.
  const [savedDepts, savedStores] = await Promise.all([syncStorage('depts'), syncStorage('stores')]);
  if (!savedDepts || !savedStores) {
    DB.depts = prevDepts; DB.stores = prevStores;
    renderDeptList(); renderStoreList();
    return;
  }
  logSystemAction('USER_MGM', 'MOVE_DEPT_TO_STORE', `Chuyển [${name}] từ Danh Mục Phòng Ban sang Danh Mục Siêu Thị`, 'SUCCESS', name);
  renderDeptList();
  renderStoreList();
  populateDropdowns();
}

// Danh sách Chức Danh — cùng mô hình với Phòng Ban/Phân Loại Tài Liệu ở trên (danh sách chuỗi phẳng,
// admin tự thêm/xóa). Không kiểm tra ai đang dùng chức danh sắp xóa (giống hệt xóa Phòng Ban) — chân
// ký của các hồ sơ đã tạo trước đó chỉ đơn giản không còn hiện chức danh nếu người đó bị gỡ khỏi danh
// sách sau này, không phá vỡ dữ liệu cũ.
async function saveJobTitle(e) {
  e.preventDefault();
  const name = document.getElementById('txtJobTitleName').value.trim();
  if (DB.jobTitles.includes(name)) return alert('Chức danh đã tồn tại!');
  DB.jobTitles.push(name);
  const saved = await syncStorage('jobTitles');
  if (!saved) { DB.jobTitles = DB.jobTitles.filter(t => t !== name); return; }
  logSystemAction('USER_MGM', 'ADD_JOB_TITLE', `Thêm chức danh mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtJobTitleName').value = '';
  renderJobTitleList();
  populateDropdowns();
}

async function deleteJobTitle(name) {
  if (!confirmCatalogValueDeletion('chức danh', name, 'Chức danh này có thể đang được dùng ở bước duyệt "Theo vị trí"/"Quy Trình Đặt Hàng Siêu Thị" và ở chính hồ sơ tài khoản người dùng.')) return;
  const prevJobTitles = [...DB.jobTitles];
  DB.jobTitles = DB.jobTitles.filter(t => t !== name);
  const saved = await syncStorage('jobTitles');
  if (!saved) { DB.jobTitles = prevJobTitles; renderJobTitleList(); return; }
  logSystemAction('USER_MGM', 'DELETE_JOB_TITLE', `Xóa chức danh [${name}]`, 'SUCCESS', name);
  renderJobTitleList();
  populateDropdowns();
}

function renderJobTitleList() {
  const ul = document.getElementById('jobTitleList');
  if (!ul) return;
  ul.innerHTML = renderCatalogBulkBarHtml('jobTitles') + DB.jobTitles.map(t => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      ${renderCatalogBulkCheckboxHtml('jobTitles', t)}
      <span class="flex-1">${escapeHtml(t)}</span>
      <button data-op="renameJobTitle" data-arg0="'${escapeHtml(t)}'" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteJobTitle" data-arg0="'${escapeHtml(t)}'" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}

async function renameJobTitle(name) {
  const ok = await renameCatalogEntryClient('jobTitles', name, 'Danh Sách Chức Danh');
  if (ok) { renderJobTitleList(); populateDropdowns(); }
}

// ===== Các danh mục chuỗi phẳng dạng GỢI Ý (10/2026, theo yêu cầu người dùng): Cấp Bậc/Lý Do Nghỉ Việc/
// Loại Kỷ Luật/Đơn Vị (Pháp Nhân)/Đối Tượng Lao Động Đặc Biệt/Tình Trạng Làm Việc Hiện Tại/Nơi Cấp CCCD
// — cùng mô hình thêm/xoá/sửa như Phòng Ban/Chức Danh ở trên, viết CHUNG 1 bộ hàm thay vì lặp lại nhiều
// lần. "✏️ Sửa" (renameGenericSimpleCatalogEntry()) dùng renameCatalogEntryClient() KHÔNG cascade (xem
// simpleArrayCatalogHandler() ở lib/catalogRename.js) — các field tham chiếu dùng sdd widget cho phép gõ
// tự do, không ép khớp đúng 1 giá trị trong danh mục, nên sửa tên ở đây không ảnh hưởng dữ liệu cũ đã lưu.
const GENERIC_SIMPLE_CATALOGS = {
  jobGrades: { listId: 'jobGradeList', inputId: 'txtJobGradeName', label: 'cấp bậc', logPrefix: 'JOB_GRADE' },
  resignationReasons: { listId: 'resignationReasonList', inputId: 'txtResignationReasonName', label: 'lý do nghỉ việc', logPrefix: 'RESIGNATION_REASON' },
  disciplinaryTypes: { listId: 'disciplinaryTypeList', inputId: 'txtDisciplinaryTypeName', label: 'loại kỷ luật', logPrefix: 'DISCIPLINARY_TYPE' },
  // 4 danh mục MỚI (10/2026, mẫu Excel 90 trường "Template_Quan_ly_ho_so_nhan_su") — cùng khuôn 3 danh
  // mục trên (chuỗi phẳng, GỢI Ý qua sdd widget), dùng cho 4 field droplist mới ở Hồ Sơ Nhân Sự.
  legalEntities: { listId: 'legalEntityList', inputId: 'txtLegalEntityName', label: 'đơn vị (pháp nhân)', logPrefix: 'LEGAL_ENTITY' },
  specialLaborStatuses: { listId: 'specialLaborStatusList', inputId: 'txtSpecialLaborStatusName', label: 'đối tượng lao động đặc biệt', logPrefix: 'SPECIAL_LABOR_STATUS' },
  currentWorkStatusDetails: { listId: 'currentWorkStatusDetailList', inputId: 'txtCurrentWorkStatusDetailName', label: 'tình trạng làm việc hiện tại', logPrefix: 'CURRENT_WORK_STATUS_DETAIL' },
  nationalIdIssuePlaces: { listId: 'nationalIdIssuePlaceList', inputId: 'txtNationalIdIssuePlaceName', label: 'nơi cấp CCCD/CMND', logPrefix: 'NATIONAL_ID_ISSUE_PLACE' },
  // educationDegrees (10/2026, báo cáo rà soát mẫu Excel mới) — cùng khuôn các danh mục trên.
  educationDegrees: { listId: 'educationDegreeList', inputId: 'txtEducationDegreeName', label: 'bằng cấp', logPrefix: 'EDUCATION_DEGREE' }
};
// LỖI ĐÃ VÁ (10/2026, người dùng báo "Cấp Bậc/Lý Do Nghỉ Việc/Loại Kỷ Luật — không add được thông tin
// vào đâu"): 3 form này dùng data-op-submit="saveGenericSimpleCatalogEntry" data-arg0="'<key>'" (quy ước
// truyền tham số qua data-argN của cspCollectArgs(), xem core.js) — nhưng nhánh 'submit' của
// bindCspDelegation() KHÔNG hề gọi cspCollectArgs(), nó LUÔN gọi cứng fn(e) (chỉ truyền SubmitEvent),
// hoàn toàn bỏ qua data-arg0 (khác 3 nhánh click/change/input kia). Hậu quả: key nhận được chính là
// SubmitEvent, GENERIC_SIMPLE_CATALOGS[key] luôn undefined -> return sớm NGAY DÒNG ĐẦU, im lặng hoàn
// toàn (không alert, không fetch, không xoá input) — đúng với mô tả "không có tác dụng gì". Sửa TẠI
// ĐIỂM HẸP NHẤT (không đổi hành vi submit dùng chung cho ~70 form khác đang dựa vào đúng quy ước fn(e)
// hiện tại): nhận event thật, tự đọc key từ data-catalog-key đặt ngay trên <form> (e.target khi 'submit'
// chính là form) thay vì qua data-arg0/cspCollectArgs — xem 3 form tương ứng ở systemSection.html.
async function saveGenericSimpleCatalogEntry(e) {
  e.preventDefault();
  const key = e.target.dataset.catalogKey;
  const cfg = GENERIC_SIMPLE_CATALOGS[key];
  if (!cfg) return;
  const input = document.getElementById(cfg.inputId);
  const name = input.value.trim();
  if (!name) return;
  if ((DB[key] || []).includes(name)) return alert(`Giá trị "${name}" đã tồn tại trong danh mục ${cfg.label}!`);
  const prev = [...(DB[key] || [])];
  DB[key] = [...prev, name];
  const saved = await syncStorage(key);
  if (!saved) { DB[key] = prev; return; }
  logSystemAction('USER_MGM', `ADD_${cfg.logPrefix}`, `Thêm ${cfg.label} mới [${name}]`, 'SUCCESS', name);
  input.value = '';
  renderGenericSimpleCatalogList(key);
}
async function deleteGenericSimpleCatalogEntry(key, name) {
  const cfg = GENERIC_SIMPLE_CATALOGS[key];
  if (!cfg) return;
  if (!confirmCatalogValueDeletion(cfg.label, name)) return;
  const prev = [...(DB[key] || [])];
  DB[key] = prev.filter(v => v !== name);
  const saved = await syncStorage(key);
  if (!saved) { DB[key] = prev; renderGenericSimpleCatalogList(key); return; }
  logSystemAction('USER_MGM', `DELETE_${cfg.logPrefix}`, `Xóa ${cfg.label} [${name}]`, 'SUCCESS', name);
  renderGenericSimpleCatalogList(key);
}
function renderGenericSimpleCatalogList(key) {
  const cfg = GENERIC_SIMPLE_CATALOGS[key];
  if (!cfg) return;
  const ul = document.getElementById(cfg.listId);
  if (!ul) return;
  ul.innerHTML = renderCatalogBulkBarHtml(key) + (DB[key] || []).map(v => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      ${renderCatalogBulkCheckboxHtml(key, v)}
      <span class="flex-1">${escapeHtml(v)}</span>
      <button data-op="renameGenericSimpleCatalogEntry" data-arg0="'${escapeHtml(key)}'" data-arg1="'${escapeHtml(v)}'" class="text-blue-600 font-bold hover:underline">✏️ Sửa</button>
      <button data-op="deleteGenericSimpleCatalogEntry" data-arg0="'${escapeHtml(key)}'" data-arg1="'${escapeHtml(v)}'" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}
// renameGenericSimpleCatalogEntry (10/2026, rà soát "mọi danh mục đều phải có Sửa") — dùng CHUNG
// renameCatalogEntryClient() đã có (cùng hàm các danh mục khác đang dùng), tự đọc đúng label/key qua
// GENERIC_SIMPLE_CATALOGS — route server đã đăng ký 7 khoá này vào CATALOG_HANDLERS (không cascade, xem
// lib/catalogRename.js) + VALID_CATALOG_KEYS (routes/adminCatalog.js).
async function renameGenericSimpleCatalogEntry(key, name) {
  const cfg = GENERIC_SIMPLE_CATALOGS[key];
  if (!cfg) return;
  const ok = await renameCatalogEntryClient(key, name, cfg.label);
  if (ok) renderGenericSimpleCatalogList(key);
}
function renderJobGradeList() { renderGenericSimpleCatalogList('jobGrades'); }
function renderResignationReasonList() { renderGenericSimpleCatalogList('resignationReasons'); }
function renderDisciplinaryTypeList() { renderGenericSimpleCatalogList('disciplinaryTypes'); }
function renderLegalEntityList() { renderGenericSimpleCatalogList('legalEntities'); }
function renderSpecialLaborStatusList() { renderGenericSimpleCatalogList('specialLaborStatuses'); }
function renderCurrentWorkStatusDetailList() { renderGenericSimpleCatalogList('currentWorkStatusDetails'); }
function renderNationalIdIssuePlaceList() { renderGenericSimpleCatalogList('nationalIdIssuePlaces'); }
function renderEducationDegreeList() { renderGenericSimpleCatalogList('educationDegrees'); }

// ===== Danh Sách Chức Danh (Siêu Thị) — DB.storeJobTitles, {label}[] (mục 4a) — TÁCH khỏi DB.jobTitles
// (Khối Văn Phòng/HO), dùng cho field "Chức danh" của user posType==='STORE' ở form Người Dùng đầy đủ.
// Trước đây còn cờ restrictedFromSelfService (khoá 1 chức danh khỏi form rút gọn "Quản Lý Nhân Viên Siêu
// Thị" ở Đồng Phục) — cờ này đã bị xoá cùng sub-tab đó (gỡ hẳn, xem VERSION.md); danh mục chỉ còn 1 field
// {label}. =====
async function saveStoreJobTitle(e) {
  e.preventDefault();
  const label = document.getElementById('txtStoreJobTitleName').value.trim();
  if (!label) return;
  if (DB.storeJobTitles.some(t => t.label === label)) return alert('Chức danh đã tồn tại!');
  DB.storeJobTitles.push({ label });
  const saved = await syncStorage('storeJobTitles');
  if (!saved) { DB.storeJobTitles = DB.storeJobTitles.filter(t => t.label !== label); return; }
  logSystemAction('USER_MGM', 'ADD_STORE_JOB_TITLE', `Thêm chức danh siêu thị mới [${label}]`, 'SUCCESS', label);
  document.getElementById('txtStoreJobTitleName').value = '';
  renderStoreJobTitleList();
  populateDropdowns();
}

async function deleteStoreJobTitle(label) {
  if (!confirmCatalogValueDeletion('chức danh siêu thị', label, 'Chức danh này có thể đang được dùng ở bước duyệt "Theo vị trí"/"Quy Trình Đặt Hàng Siêu Thị" và ở chính hồ sơ tài khoản người dùng.')) return;
  const prevList = DB.storeJobTitles.map(t => ({ ...t }));
  DB.storeJobTitles = DB.storeJobTitles.filter(t => t.label !== label);
  const saved = await syncStorage('storeJobTitles');
  if (!saved) { DB.storeJobTitles = prevList; renderStoreJobTitleList(); return; }
  logSystemAction('USER_MGM', 'DELETE_STORE_JOB_TITLE', `Xóa chức danh siêu thị [${label}]`, 'SUCCESS', label);
  renderStoreJobTitleList();
  populateDropdowns();
}

async function renameStoreJobTitle(label) {
  const ok = await renameCatalogEntryClient('storeJobTitles', label, 'Danh Sách Chức Danh (Siêu Thị)');
  if (ok) { renderStoreJobTitleList(); populateDropdowns(); }
}

function renderStoreJobTitleList() {
  const ul = document.getElementById('storeJobTitleList');
  if (!ul) return;
  ul.innerHTML = renderObjectCatalogBulkBarHtml('storeJobTitles') + (DB.storeJobTitles || []).map(t => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      ${renderObjectCatalogBulkCheckboxHtml('storeJobTitles', t.label)}
      <span class="flex-1">${escapeHtml(t.label)}</span>
      <button data-op="renameStoreJobTitle" data-arg0="${escapeHtml(t.label)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteStoreJobTitle" data-arg0="${escapeHtml(t.label)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}

// ===== Chức Danh ↔ Cấp Bậc (Gợi ý mặc định, DB.jobTitleGradeDefaults — {jobTitle,jobGrade}[], UNIQUE
// theo jobTitle, 10/2026 theo yêu cầu người dùng): khi Thêm/Sửa Vị Trí ở Cơ Cấu Tổ Chức, chọn/gõ đúng 1
// chức danh đã có trong map này thì ô "Cấp Bậc" TỰ ĐIỀN cấp bậc mặc định — xem
// applyJobTitleGradeDefaultSuggestion() ở module-orgchart.js (đọc THẲNG mảng này, không gọi hàm nào ở
// đây — module-orgchart.js không chắc đã nạp module-admin.js, xem MODULE_LOAD_GROUPS). Vẫn GÕ TỰ DO/SỬA
// TAY được sau khi tự điền — đây chỉ là gợi ý, không phải nguồn sự thật duy nhất.
let editingJobTitleGradeDefaultOriginal = null; // chức danh đang sửa (null = đang ở chế độ Thêm mới)

function jtgdJobTitleOptions() {
  const office = (DB.jobTitles || []).map(t => ({ label: `${t} — HO/Khối VP`, value: t }));
  const store = (DB.storeJobTitles || []).map(t => t.label).filter(Boolean).map(t => ({ label: `${t} — Siêu Thị`, value: t }));
  return [...office, ...store];
}

// Ô "Chức Danh" hiện nhãn CÓ hậu tố nguồn (" — HO/Khối VP"/" — Siêu Thị", xem jtgdJobTitleOptions() trên)
// để phân biệt khi 2 danh mục trùng tên — PHẢI resolve về giá trị chức danh THUẦN (không hậu tố) trước
// khi lưu, nếu không DB.jobTitleGradeDefaults sẽ lưu nhầm nguyên chuỗi nhãn, không bao giờ khớp được
// jobTitle thật ở orgChartNodeJobTitleInput (applyJobTitleGradeDefaultSuggestion(), module-orgchart.js).
// Bắt buộc gõ-VÀ-CHỌN đúng 1 gợi ý có sẵn (không nhận free-text) — cùng khuôn
// mixedApprovalResolveJobTitleInput() (module-workflow.js).
function jtgdResolveJobTitleInput(rawValue) {
  const match = jtgdJobTitleOptions().find(o => o.label === String(rawValue || '').trim());
  return match ? match.value : null;
}

function cancelEditJobTitleGradeDefault() {
  editingJobTitleGradeDefaultOriginal = null;
  const jt = document.getElementById('txtJtgdJobTitle'); if (jt) jt.value = '';
  const jg = document.getElementById('txtJtgdJobGrade'); if (jg) jg.value = '';
  const btn = document.getElementById('btnJtgdSubmit'); if (btn) btn.innerText = 'Thêm';
  const cancelBtn = document.getElementById('btnJtgdCancelEdit'); if (cancelBtn) cancelBtn.classList.add('hidden');
}

function editJobTitleGradeDefault(jobTitle) {
  const row = (DB.jobTitleGradeDefaults || []).find(r => r.jobTitle === jobTitle);
  if (!row) return;
  editingJobTitleGradeDefaultOriginal = jobTitle;
  // Ô nhập hiện NHÃN có hậu tố nguồn (" — HO/Khối VP"/" — Siêu Thị") — prefill đúng nhãn đó, không phải
  // giá trị thuần đã lưu, nếu không jtgdResolveJobTitleInput() lúc Lưu sẽ không khớp được gợi ý nào.
  const opt = jtgdJobTitleOptions().find(o => o.value === row.jobTitle);
  document.getElementById('txtJtgdJobTitle').value = opt ? opt.label : row.jobTitle;
  document.getElementById('txtJtgdJobGrade').value = row.jobGrade;
  document.getElementById('btnJtgdSubmit').innerText = 'Lưu';
  document.getElementById('btnJtgdCancelEdit').classList.remove('hidden');
}

async function saveJobTitleGradeDefault(e) {
  e.preventDefault();
  const jobTitle = jtgdResolveJobTitleInput(document.getElementById('txtJtgdJobTitle').value);
  const jobGrade = document.getElementById('txtJtgdJobGrade').value.trim();
  if (!jobTitle) return alert('Gõ và CHỌN đúng 1 chức danh có sẵn trong danh sách gợi ý (HO/Khối VP hoặc Siêu Thị).');
  if (!jobGrade) return;
  const list = DB.jobTitleGradeDefaults || (DB.jobTitleGradeDefaults = []);
  const isEdit = editingJobTitleGradeDefaultOriginal != null;
  if (isEdit) {
    const idx = list.findIndex(r => r.jobTitle === editingJobTitleGradeDefaultOriginal);
    if (idx === -1) { cancelEditJobTitleGradeDefault(); renderJobTitleGradeDefaultList(); return; }
    // Đổi luôn tên chức danh (không chỉ cấp bậc) -> tự kiểm trùng với 1 dòng KHÁC (không phải chính nó).
    if (jobTitle !== editingJobTitleGradeDefaultOriginal && list.some(r => r.jobTitle === jobTitle)) {
      return alert(`Chức danh "${jobTitle}" đã có cấp bậc mặc định khác — sửa trực tiếp dòng đó thay vì tạo trùng.`);
    }
    const snapshot = list.map(r => ({ ...r }));
    list[idx] = { jobTitle, jobGrade };
    const saved = await syncStorage('jobTitleGradeDefaults');
    if (!saved) { DB.jobTitleGradeDefaults = snapshot; return; }
    logSystemAction('USER_MGM', 'UPDATE_JOB_TITLE_GRADE_DEFAULT', `Sửa cấp bậc mặc định [${jobTitle}] -> "${jobGrade}"`, 'SUCCESS', jobTitle);
  } else {
    if (list.some(r => r.jobTitle === jobTitle)) {
      return alert(`Chức danh "${jobTitle}" đã có cấp bậc mặc định — bấm "✏️ Sửa" ở dòng đó để đổi, không thêm trùng.`);
    }
    list.push({ jobTitle, jobGrade });
    const saved = await syncStorage('jobTitleGradeDefaults');
    if (!saved) { DB.jobTitleGradeDefaults = list.filter(r => r.jobTitle !== jobTitle); return; }
    logSystemAction('USER_MGM', 'ADD_JOB_TITLE_GRADE_DEFAULT', `Thêm cấp bậc mặc định [${jobTitle}] = "${jobGrade}"`, 'SUCCESS', jobTitle);
  }
  cancelEditJobTitleGradeDefault();
  renderJobTitleGradeDefaultList();
}

async function deleteJobTitleGradeDefault(jobTitle) {
  if (!confirm(`Xoá cấp bậc mặc định của chức danh "${jobTitle}"? (Chỉ xoá gợi ý tự điền — KHÔNG đổi cấp bậc đã lưu sẵn ở các vị trí Cơ Cấu Tổ Chức hiện có.)`)) return;
  const prevList = (DB.jobTitleGradeDefaults || []).map(r => ({ ...r }));
  DB.jobTitleGradeDefaults = prevList.filter(r => r.jobTitle !== jobTitle);
  const saved = await syncStorage('jobTitleGradeDefaults');
  if (!saved) { DB.jobTitleGradeDefaults = prevList; renderJobTitleGradeDefaultList(); return; }
  logSystemAction('USER_MGM', 'DELETE_JOB_TITLE_GRADE_DEFAULT', `Xoá cấp bậc mặc định [${jobTitle}]`, 'SUCCESS', jobTitle);
  if (editingJobTitleGradeDefaultOriginal === jobTitle) cancelEditJobTitleGradeDefault();
  renderJobTitleGradeDefaultList();
}

function renderJobTitleGradeDefaultList() {
  const ul = document.getElementById('jobTitleGradeDefaultList');
  if (!ul) return;
  sddSetOptions('jtgdJobTitleDatalist', jtgdJobTitleOptions());
  sddSetOptions('jtgdJobGradeDatalist', (DB.jobGrades || []).map(g => ({ label: g, value: g })));
  const list = (DB.jobTitleGradeDefaults || []).slice().sort((a, b) => a.jobTitle.localeCompare(b.jobTitle, 'vi'));
  ul.innerHTML = renderObjectCatalogBulkBarHtml('jobTitleGradeDefaults') + (list.length ? list.map(row => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      ${renderObjectCatalogBulkCheckboxHtml('jobTitleGradeDefaults', row.jobTitle)}
      <span class="flex-1"><b>${escapeHtml(row.jobTitle)}</b> → <span class="text-fuchsia-700 font-bold">${escapeHtml(row.jobGrade)}</span></span>
      <button data-op="editJobTitleGradeDefault" data-arg0="${escapeHtml(row.jobTitle)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteJobTitleGradeDefault" data-arg0="${escapeHtml(row.jobTitle)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('') : `<li class="p-3 text-center text-gray-400 italic text-xs">Chưa có cấu hình nào.</li>`);
}

// ===== Vị Trí Làm Việc (DB.positionTypes, 10/2026) — danh mục MỞ thay 2 giá trị cứng HO/STORE, xem
// defaults.js + routes/positionTypes.js. Khác 2 khối trên (mảng chuỗi/{label} phẳng, ghi qua
// syncStorage() thường + rename qua /api/admin/renameCatalogEntry): mỗi phần tử ở đây là 1 OBJECT
// {key,label,builtin,locations[],jobTitles[]} — CRUD (tạo/đổi tên nhãn/xoá 1 Vị Trí, thêm/xoá/đổi tên 1
// địa điểm hay chức danh CON của Vị Trí đó) đều đi qua route riêng /api/admin/position-types/* (đổi
// tên CÓ cascade, tạo/xoá server tự kiểm tra ràng buộc — không dùng syncStorage('positionTypes') trực
// tiếp như stores/depts, xem routes/positionTypes.js). =====
async function createPositionType(e) {
  e.preventDefault();
  const label = document.getElementById('txtPositionTypeName').value.trim();
  if (!label) return;
  try {
    const res = await fetch('/api/admin/position-types', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    DB.positionTypes = body.positionTypes;
    logSystemAction('USER_MGM', 'ADD_POSITION_TYPE', `Thêm Vị Trí Làm Việc mới [${label}]`, 'SUCCESS', label);
    document.getElementById('txtPositionTypeName').value = '';
    renderPositionTypeList();
    populateUserPosTypeOptions();
  } catch (err) {
    alert(`⛔ Không thể thêm Vị Trí Làm Việc: ${err.message}`);
  }
}

async function renamePositionTypeLabel(key, currentLabel) {
  const newLabel = String(prompt(`Nhập tên hiển thị mới cho "${currentLabel}":`, currentLabel) || '').trim();
  if (!newLabel || newLabel === currentLabel) return;
  try {
    const res = await fetch(`/api/admin/position-types/${encodeURIComponent(key)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: newLabel })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    DB.positionTypes = body.positionTypes;
    logSystemAction('USER_MGM', 'RENAME_POSITION_TYPE', `Đổi tên hiển thị Vị Trí Làm Việc [${currentLabel}] → [${newLabel}]`, 'SUCCESS', newLabel);
    renderPositionTypeList();
    populateUserPosTypeOptions();
  } catch (err) {
    alert(`⛔ Lỗi đổi tên: ${err.message}`);
  }
}

async function deletePositionType(key, label) {
  if (!confirm(`Xoá hẳn Vị Trí Làm Việc "${label}" (kèm toàn bộ danh sách Địa Điểm/Chức Danh riêng của Vị Trí này)?\n\nBị chặn nếu đang có tài khoản gán Vị Trí này.`)) return;
  try {
    const res = await fetch(`/api/admin/position-types/${encodeURIComponent(key)}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    DB.positionTypes = body.positionTypes;
    logSystemAction('USER_MGM', 'DELETE_POSITION_TYPE', `Xóa Vị Trí Làm Việc [${label}]`, 'SUCCESS', label);
    renderPositionTypeList();
    populateUserPosTypeOptions();
  } catch (err) {
    alert(`⛔ Không thể xoá: ${err.message}`);
  }
}

// Thêm/xoá 1 địa điểm hoặc chức danh con — KHÔNG cascade (thêm/xoá không đụng dữ liệu đã có ở nơi khác,
// cùng khuôn addStoreToCatalog()/deleteStore()) nên ghi thẳng qua syncStorage('positionTypes') như mọi
// danh mục mảng phẳng đơn giản khác, không cần route riêng.
// data-op-submit LUÔN gọi fn(e) — KHÔNG đọc data-arg0/arg1 như data-op/data-op-change (xem
// cspDispatchOp() ở core.js) — đọc trực tiếp qua e.target.dataset (thuộc tính data-* chuẩn HTML5) thay
// vì tham số vị trí.
async function addPositionTypeEntry(e) {
  const key = e.target.dataset.arg0;
  const field = e.target.dataset.arg1;
  const inputId = field === 'locations' ? `txtPositionTypeLocation_${key}` : `txtPositionTypeJobTitle_${key}`;
  const input = document.getElementById(inputId);
  const value = (input?.value || '').trim();
  if (!value) return;
  const t = DB.positionTypes.find(x => x.key === key);
  if (!t) return;
  const list = t[field] || (t[field] = []);
  if (list.includes(value)) return alert('Giá trị đã tồn tại!');
  list.push(value);
  const saved = await syncStorage('positionTypes');
  if (!saved) { t[field] = list.filter(v => v !== value); return; }
  logSystemAction('USER_MGM', 'ADD_POSITION_TYPE_ENTRY', `Thêm ${field === 'locations' ? 'địa điểm' : 'chức danh'} [${value}] vào Vị Trí Làm Việc [${t.label}]`, 'SUCCESS', value);
  input.value = '';
  renderPositionTypeList();
  populateDropdowns();
}
async function deletePositionTypeEntry(key, field, value) {
  if (!confirmCatalogValueDeletion(field === 'locations' ? 'địa điểm' : 'chức danh', value, 'Tài khoản/hồ sơ đang dùng giá trị này (nếu có) sẽ thành tham chiếu treo.')) return;
  const t = DB.positionTypes.find(x => x.key === key);
  if (!t) return;
  const prevList = [...(t[field] || [])];
  t[field] = prevList.filter(v => v !== value);
  const saved = await syncStorage('positionTypes');
  if (!saved) { t[field] = prevList; renderPositionTypeList(); return; }
  logSystemAction('USER_MGM', 'DELETE_POSITION_TYPE_ENTRY', `Xóa ${field === 'locations' ? 'địa điểm' : 'chức danh'} [${value}] khỏi Vị Trí Làm Việc [${t.label}]`, 'SUCCESS', value);
  renderPositionTypeList();
  populateDropdowns();
}
// Đổi tên 1 địa điểm/chức danh con — CÓ cascade (route riêng, xem routes/positionTypes.js).
async function renamePositionTypeEntry(key, field, oldValue) {
  const t = DB.positionTypes.find(x => x.key === key);
  const newValue = String(prompt(`Nhập tên mới cho "${oldValue}":`, oldValue) || '').trim();
  if (!newValue || newValue === oldValue) return;
  const endpoint = field === 'locations' ? 'locations' : 'job-titles';
  try {
    const res = await fetch(`/api/admin/position-types/${encodeURIComponent(key)}/${endpoint}/rename`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ oldValue, newValue })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    DB.positionTypes = body.positionTypes;
    logSystemAction('USER_MGM', 'RENAME_POSITION_TYPE_ENTRY', `Đổi tên ${field === 'locations' ? 'địa điểm' : 'chức danh'} [${oldValue}] → [${newValue}] (Vị Trí Làm Việc [${t?.label || key}])`, 'SUCCESS', newValue);
    renderPositionTypeList();
    populateDropdowns();
    alert(`✅ Đã đổi tên "${oldValue}" thành "${newValue}" (đã cập nhật mọi hồ sơ/tài khoản liên quan ở máy chủ).\n\nVui lòng TẢI LẠI TRANG để thấy tên mới hiển thị ở toàn bộ màn hình.`);
  } catch (err) {
    alert(`⛔ Lỗi đổi tên: ${err.message}`);
  }
}

// positionTypeBulkSelection — bulk-select-delete RIÊNG (không qua OBJECT_CATALOG_BULK_CONFIG ở core.js)
// vì positionTypes có cấu trúc LỒNG + REST riêng có kiểm tra ràng buộc (chặn xoá nếu đang gán tài
// khoản) + 2 mục builtin (HO/STORE, không được chọn/xoá) — xem chú thích đầy đủ tại
// OBJECT_CATALOG_BULK_CONFIG (core.js). CHỈ áp dụng ở cấp "Vị Trí" (không bulk-delete lồng sâu xuống
// từng Địa Điểm/Chức Danh con — các dòng đó đã có ✏️/Xóa đơn lẻ, số lượng thường rất ít không cần bulk).
const positionTypeBulkSelection = new Set();
function isPositionTypeBulkSelected(key) { return positionTypeBulkSelection.has(key); }
function togglePositionTypeBulkItem(key, el) {
  if (el.checked) positionTypeBulkSelection.add(key); else positionTypeBulkSelection.delete(key);
  renderPositionTypeList();
}
function togglePositionTypeBulkAll(el) {
  positionTypeBulkSelection.clear();
  if (el.checked) (DB.positionTypes || []).filter(t => !t.builtin).forEach(t => positionTypeBulkSelection.add(t.key));
  renderPositionTypeList();
}
function clearPositionTypeBulkSelection() {
  positionTypeBulkSelection.clear();
  renderPositionTypeList();
}
function renderPositionTypeBulkBarHtml() {
  const selectable = (DB.positionTypes || []).filter(t => !t.builtin);
  if (!selectable.length) return '';
  const allChecked = selectable.every(t => positionTypeBulkSelection.has(t.key));
  let html = '';
  if (positionTypeBulkSelection.size) {
    html += `<div class="flex items-center justify-between bg-amber-50 border border-amber-300 rounded px-2.5 py-1.5 mb-1 text-[11px]">
      <span class="font-semibold text-gray-700">Đã chọn ${positionTypeBulkSelection.size} Vị Trí Làm Việc</span>
      <div class="flex items-center gap-2">
        <button type="button" data-op="clearPositionTypeBulkSelection" class="text-gray-500 underline">Bỏ chọn</button>
        <button type="button" data-op="bulkDeletePositionTypes" class="bg-red-600 text-white px-2 py-1 rounded font-bold">🗑️ Xoá ${positionTypeBulkSelection.size} Mục Đã Chọn</button>
      </div>
    </div>`;
  }
  html += `<div class="flex items-center gap-2 px-2 py-1 text-[11px] text-gray-400 bg-white rounded border">
    <input type="checkbox" data-op-change="togglePositionTypeBulkAll" data-arg-el="0" ${allChecked ? 'checked' : ''}>
    <span class="italic">Chọn tất cả (trừ 2 Vị Trí mặc định HO/Siêu Thị)</span>
  </div>`;
  return html;
}
async function bulkDeletePositionTypes() {
  const keys = Array.from(positionTypeBulkSelection);
  if (!keys.length) return;
  const items = (DB.positionTypes || []).filter(t => keys.includes(t.key));
  if (!items.length) return;
  const labels = items.map(t => t.label);
  const preview = labels.slice(0, 8).join(', ') + (labels.length > 8 ? `... (+${labels.length - 8})` : '');
  if (!confirm(`Xoá ${items.length} Vị Trí Làm Việc đã chọn (kèm toàn bộ Địa Điểm/Chức Danh riêng của từng Vị Trí)?\n\n${preview}\n\nVị Trí nào đang có tài khoản gán sẽ TỰ ĐỘNG BỊ BỎ QUA (không xoá được), các Vị Trí còn lại vẫn xoá bình thường.`)) return;

  let okCount = 0;
  const failed = [];
  for (const t of items) {
    try {
      const res = await fetch(`/api/admin/position-types/${encodeURIComponent(t.key)}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      DB.positionTypes = body.positionTypes;
      okCount++;
    } catch (err) {
      failed.push(`${t.label} (${err.message})`);
    }
  }
  if (okCount) logSystemAction('USER_MGM', 'BULK_DELETE_POSITION_TYPE', `Xóa ${okCount} Vị Trí Làm Việc: ${labels.join(', ')}`, 'SUCCESS', String(okCount));
  positionTypeBulkSelection.clear();
  renderPositionTypeList();
  populateUserPosTypeOptions();
  if (failed.length) alert(`⚠️ ${failed.length}/${items.length} Vị Trí KHÔNG xoá được (đang có tài khoản gán Vị Trí đó):\n\n${failed.join('\n')}`);
}

function renderPositionTypeList() {
  const wrap = document.getElementById('positionTypeList');
  if (!wrap) return;
  wrap.innerHTML = renderPositionTypeBulkBarHtml() + (DB.positionTypes || []).map(t => {
    if (t.builtin) {
      return `
      <div class="bg-white rounded border p-2 flex items-center justify-between gap-2">
        <span class="font-semibold text-xs">${escapeHtml(t.label)} <span class="ml-1 inline-block bg-gray-200 text-gray-600 text-[10px] px-1.5 py-0.5 rounded">Mặc định — quản lý ở khối Phòng Ban/Siêu Thị/Chức Danh phía trên</span></span>
        <button data-op="renamePositionTypeLabel" data-arg0="${escapeHtml(t.key)}" data-arg1="${escapeHtml(t.label)}" class="text-blue-600 font-bold hover:underline text-xs whitespace-nowrap">✏️ Đổi tên hiển thị</button>
      </div>`;
    }
    const locRows = (t.locations || []).map(l => `
      <li class="p-1.5 flex justify-between items-center gap-2 hover:bg-gray-50">
        <span class="flex-1">${escapeHtml(l)}</span>
        <button data-op="renamePositionTypeEntry" data-arg0="${escapeHtml(t.key)}" data-arg1="locations" data-arg2="${escapeHtml(l)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️</button>
        <button data-op="deletePositionTypeEntry" data-arg0="${escapeHtml(t.key)}" data-arg1="locations" data-arg2="${escapeHtml(l)}" class="text-red-500 font-bold hover:underline">Xóa</button>
      </li>`).join('');
    const jobRows = (t.jobTitles || []).map(j => `
      <li class="p-1.5 flex justify-between items-center gap-2 hover:bg-gray-50">
        <span class="flex-1">${escapeHtml(j)}</span>
        <button data-op="renamePositionTypeEntry" data-arg0="${escapeHtml(t.key)}" data-arg1="jobTitles" data-arg2="${escapeHtml(j)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️</button>
        <button data-op="deletePositionTypeEntry" data-arg0="${escapeHtml(t.key)}" data-arg1="jobTitles" data-arg2="${escapeHtml(j)}" class="text-red-500 font-bold hover:underline">Xóa</button>
      </li>`).join('');
    return `
    <div class="bg-white rounded border p-2 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-xs flex items-center gap-2">
          <input type="checkbox" data-op-change="togglePositionTypeBulkItem" data-arg0="'${escapeHtml(t.key)}'" data-arg-el="1" ${isPositionTypeBulkSelected(t.key) ? 'checked' : ''} class="w-3.5 h-3.5 shrink-0">
          ${escapeHtml(t.label)}
        </span>
        <div class="flex gap-2 text-xs">
          <button data-op="renamePositionTypeLabel" data-arg0="${escapeHtml(t.key)}" data-arg1="${escapeHtml(t.label)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Đổi tên</button>
          <button data-op="deletePositionType" data-arg0="${escapeHtml(t.key)}" data-arg1="${escapeHtml(t.label)}" class="text-red-500 font-bold hover:underline">Xóa Vị Trí</button>
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div>
          <div class="text-[11px] font-semibold text-gray-500 mb-1">📍 Địa Điểm</div>
          <form data-op-submit="addPositionTypeEntry" data-arg0="${escapeHtml(t.key)}" data-arg1="locations" class="flex gap-1 mb-1">
            <input id="txtPositionTypeLocation_${escapeHtml(t.key)}" placeholder="Tên địa điểm mới..." class="border rounded px-1.5 py-1 text-[11px] flex-1">
            <button type="submit" class="bg-violet-600 text-white px-2 rounded text-[11px] font-bold hover:bg-violet-700">Thêm</button>
          </form>
          <ul class="divide-y text-[11px] max-h-28 overflow-y-auto border rounded">${locRows || '<li class="p-1.5 text-gray-400 italic">Chưa có địa điểm nào</li>'}</ul>
        </div>
        <div>
          <div class="text-[11px] font-semibold text-gray-500 mb-1">🎖️ Chức Danh</div>
          <form data-op-submit="addPositionTypeEntry" data-arg0="${escapeHtml(t.key)}" data-arg1="jobTitles" class="flex gap-1 mb-1">
            <input id="txtPositionTypeJobTitle_${escapeHtml(t.key)}" placeholder="Tên chức danh mới..." class="border rounded px-1.5 py-1 text-[11px] flex-1">
            <button type="submit" class="bg-violet-600 text-white px-2 rounded text-[11px] font-bold hover:bg-violet-700">Thêm</button>
          </form>
          <ul class="divide-y text-[11px] max-h-28 overflow-y-auto border rounded">${jobRows || '<li class="p-1.5 text-gray-400 italic">Chưa có chức danh nào</li>'}</ul>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ---------- Excel Vị Trí Làm Việc (10/2026) — nhánh BESPOKE, KHÔNG qua OBJECT_CATALOG_EXCEL_CONFIG (core.js):
// positionTypes có REST riêng (routes/positionTypes.js: server tự sinh key bất biến + kiểm trùng + chặn
// builtin) chứ không ghi đè cả mảng như các danh mục object khác, và 2 mục mặc định HO/STORE (builtin)
// phải bị LOẠI TRỪ khỏi cả Xuất lẫn Nhập. Tải Mẫu/parse: routes/objectCatalogImport.js +
// lib/positionTypesImport.js (server gắn sẵn `action` cho từng dòng: create/rename/update/none).
// Xác nhận Nhập: gọi TUẦN TỰ đúng endpoint hiện có (POST /api/admin/position-types tạo mới, PATCH /:key đổi
// tên hiển thị) -> tải lại DB.positionTypes + version mới nhất -> gộp THÊM Địa Điểm/Chức Danh mới (không
// xoá gì qua Excel) -> lưu ĐÚNG 1 LẦN qua syncStorage('positionTypes') như addPositionTypeEntry(). ----------
let positionTypesImportPreviewState = null; // {fileName, items, errors, totalRows} — kết quả parse gần nhất

const POSITION_TYPES_BUILTIN_KEYS_CLIENT = new Set(['HO', 'STORE']);

// Rows Xuất Excel — CHỈ Vị Trí tự thêm (loại builtin), khớp buildPositionTypesExportRows() ở server.
function buildPositionTypesExportRowsClient() {
  return (DB.positionTypes || []).filter(t => t && !t.builtin && !POSITION_TYPES_BUILTIN_KEYS_CLIENT.has(t.key)).map(t => ({
    label: t.label,
    locations: (t.locations || []).join('; '),
    jobTitles: (t.jobTitles || []).join('; ')
  }));
}

async function exportPositionTypesExcel() {
  await downloadXlsxFromServer('DanhMuc_ViTriLamViec.xlsx', 'Vị Trí Làm Việc', [
    { key: 'label', header: 'Tên Vị Trí' },
    { key: 'locations', header: 'Địa Điểm' },
    { key: 'jobTitles', header: 'Chức Danh' }
  ], buildPositionTypesExportRowsClient());
}

async function downloadPositionTypesTemplate() {
  await downloadFileFromServerGet('/api/admin/position-types/import-template', 'Mau_Vi_Tri_Lam_Viec.xlsx');
}

function positionTypesImportActionHtml(it) {
  const extra = [];
  if (it.newLocations?.length) extra.push(`+${it.newLocations.length} địa điểm`);
  if (it.newJobTitles?.length) extra.push(`+${it.newJobTitles.length} chức danh`);
  const extraTxt = extra.length ? ` (${escapeHtml(extra.join(', '))})` : '';
  if (it.action === 'create') return `<span class="text-emerald-600">✅ Tạo mới</span>${extraTxt}`;
  if (it.action === 'rename') return `<span class="text-blue-600">✏️ Đổi tên từ "${escapeHtml(it.existingLabel || '')}"</span>${extraTxt}`;
  if (it.action === 'update') return `<span class="text-blue-600">➕ Bổ sung</span>${extraTxt}`;
  return '<span class="text-gray-400">— Không đổi</span>';
}

function renderPositionTypesImportPreview() {
  const wrap = document.getElementById('positionTypesImportPreview');
  if (!wrap) return;
  const state = positionTypesImportPreviewState;
  if (!state) { wrap.innerHTML = ''; wrap.classList.add('hidden'); return; }
  const actionable = state.items.filter(it => it.action !== 'none').length;
  const errorsHtml = state.errors.length
    ? `<div class="border border-red-200 bg-red-50 rounded p-1.5 max-h-28 overflow-y-auto"><div class="font-bold text-red-700 mb-0.5">⚠️ ${state.errors.length} lỗi — các dòng này sẽ KHÔNG được nhập:</div><ul class="list-disc pl-4 text-red-700">${state.errors.map(e => `<li>${e.row ? `Dòng ${escapeHtml(String(e.row))}: ` : ''}${escapeHtml(e.message)}</li>`).join('')}</ul></div>`
    : '';
  const tableHtml = state.items.length
    ? `<div class="border rounded max-h-40 overflow-auto bg-white"><table class="w-full text-[11px]"><thead><tr class="bg-gray-100 text-left"><th class="p-1">Tên Vị Trí</th><th class="p-1">Địa Điểm</th><th class="p-1">Chức Danh</th><th class="p-1">Thao Tác</th></tr></thead><tbody>${state.items.map(it => `<tr class="border-t">
        <td class="p-1">${escapeHtml(it.label)}</td>
        <td class="p-1">${escapeHtml((it.locations || []).join('; '))}</td>
        <td class="p-1">${escapeHtml((it.jobTitles || []).join('; '))}</td>
        <td class="p-1">${positionTypesImportActionHtml(it)}</td>
      </tr>`).join('')}</tbody></table></div>`
    : '';
  wrap.innerHTML = `${errorsHtml}${tableHtml}
    <div class="flex gap-2">
      ${actionable ? `<button type="button" data-op="confirmPositionTypesImport" class="flex-1 bg-violet-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-violet-700">✅ Xác Nhận Nhập (${actionable} Vị Trí)</button>` : ''}
      <button type="button" data-op="cancelPositionTypesImport" class="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-300">Huỷ</button>
    </div>`;
  wrap.classList.remove('hidden');
}

async function onPositionTypesImportFileChange(event) {
  const file = event.target.files[0];
  event.target.value = '';
  const statusEl = document.getElementById('positionTypesImportStatus');
  positionTypesImportPreviewState = null;
  renderPositionTypesImportPreview();
  if (!file) { if (statusEl) statusEl.innerText = ''; return; }
  if (statusEl) statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/admin/position-types/parse-import', { method: 'POST', body: formData });
    if (res.status === 401) return handleSessionExpired();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    positionTypesImportPreviewState = { fileName: data.fileName || file.name, items: data.items || [], errors: data.errors || [], totalRows: data.totalRows || 0 };
    const count = (a) => positionTypesImportPreviewState.items.filter(it => it.action === a).length;
    if (statusEl) {
      statusEl.innerText = `📄 "${positionTypesImportPreviewState.fileName}": ${count('create')} tạo mới, ${count('rename')} đổi tên, ${count('update')} bổ sung, ${count('none')} không đổi` +
        (positionTypesImportPreviewState.errors.length ? `, ${positionTypesImportPreviewState.errors.length} lỗi` : '') + ' — kiểm tra rồi bấm Xác Nhận.';
    }
    renderPositionTypesImportPreview();
  } catch (err) {
    if (statusEl) statusEl.innerText = `⛔ ${err.message}`;
  }
}

function cancelPositionTypesImport() {
  positionTypesImportPreviewState = null;
  renderPositionTypesImportPreview();
  const statusEl = document.getElementById('positionTypesImportStatus');
  if (statusEl) statusEl.innerText = '';
}

async function positionTypesApiCall(url, method, payload) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function confirmPositionTypesImport() {
  const state = positionTypesImportPreviewState;
  const statusEl = document.getElementById('positionTypesImportStatus');
  if (!state) return;
  const todo = state.items.filter(it => it.action !== 'none');
  if (!todo.length) return;
  const failures = [];
  const applied = []; // {key, locations, jobTitles} — dòng đã tạo/đổi tên thành công (hoặc chỉ bổ sung)
  let created = 0, renamed = 0;
  // 1) Tạo mới / đổi tên hiển thị — TUẦN TỰ qua đúng route hiện có (server tự kiểm trùng/chặn builtin).
  for (const it of todo) {
    try {
      let key = it.existingKey;
      if (it.action === 'create') {
        const body = await positionTypesApiCall('/api/admin/position-types', 'POST', { label: it.label });
        DB.positionTypes = body.positionTypes;
        key = (body.positionTypes.find(t => t.key === it.key) || body.positionTypes.find(t => t.label === it.label))?.key || it.key;
        created++;
      } else if (it.action === 'rename') {
        const body = await positionTypesApiCall(`/api/admin/position-types/${encodeURIComponent(it.existingKey)}`, 'PATCH', { label: it.label });
        DB.positionTypes = body.positionTypes;
        renamed++;
      }
      applied.push({ key, locations: it.locations || [], jobTitles: it.jobTitles || [] });
    } catch (err) {
      failures.push(`"${it.label}": ${err.message}`);
    }
  }
  // 2) Tải lại bản mới nhất + version (các route trên vừa ghi positionTypes -> version cũ trong
  // DB._versions đã lỗi thời, lưu tiếp bằng version cũ sẽ bị 409 giả).
  try {
    const res = await fetch('/api/data/positionTypes');
    if (res.ok) {
      const fresh = await res.json();
      const etag = res.headers.get('ETag');
      if (Array.isArray(fresh)) DB.positionTypes = fresh;
      if (etag) DB._versions.positionTypes = etag;
    }
  } catch (e) { /* mất mạng — vẫn thử lưu với dữ liệu đang có, syncStorage() tự báo lỗi nếu xung đột */ }
  // 3) Gộp THÊM địa điểm/chức danh mới (không xoá), lưu ĐÚNG 1 LẦN.
  const prev = DB.positionTypes;
  let addedEntries = 0;
  // Builtin (HO/STORE) giữ NGUYÊN đối tượng — không thêm field locations/jobTitles vào 2 mục đó.
  const next = (DB.positionTypes || []).map(t => (t.builtin ? t : { ...t, locations: [...(t.locations || [])], jobTitles: [...(t.jobTitles || [])] }));
  applied.forEach(a => {
    const t = next.find(x => x.key === a.key && !x.builtin);
    if (!t) return;
    ['locations', 'jobTitles'].forEach(field => {
      const have = new Set(t[field].map(v => String(v).toLowerCase()));
      a[field].forEach(v => {
        if (have.has(String(v).toLowerCase())) return;
        have.add(String(v).toLowerCase());
        t[field].push(v);
        addedEntries++;
      });
    });
  });
  if (addedEntries) {
    DB.positionTypes = next;
    const ok = await syncStorage('positionTypes');
    if (!ok) { DB.positionTypes = prev; failures.push('Lưu Địa Điểm/Chức Danh mới thất bại'); addedEntries = 0; }
  }
  logSystemAction('USER_MGM', 'IMPORT_POSITION_TYPES', `Nhập Excel Vị Trí Làm Việc: tạo ${created}, đổi tên ${renamed}, thêm ${addedEntries} địa điểm/chức danh${failures.length ? `, ${failures.length} lỗi` : ''}`, failures.length ? 'WARNING' : 'SUCCESS', String(created));
  positionTypesImportPreviewState = null;
  renderPositionTypesImportPreview();
  renderPositionTypeList();
  populateUserPosTypeOptions();
  populateDropdowns();
  if (statusEl) statusEl.innerText = `✅ Đã tạo ${created}, đổi tên ${renamed} Vị Trí, thêm ${addedEntries} địa điểm/chức danh.` + (failures.length ? ` ⚠️ ${failures.length} lỗi.` : '');
  if (failures.length) alert(`⚠️ Một số dòng không nhập được:\n- ${failures.join('\n- ')}`);
}

// Cập nhật lại các dropdown chọn "Loại đào tạo" bên module Đào Tạo (module-internalcomms-daotao.js,
// cụm lazy-load RIÊNG, KHÔNG còn gộp chung cụm với admin.js — xem chú thích Hạ tầng: nạp module theo
// cụm ở core.js) sau khi thêm/xoá danh mục ở màn "Quản Trị > Quản Lý Danh Mục" này. Màn hình NÀY (nút
// bấm, danh sách renderTrainingCategoryList()) hoàn toàn tự thân trong admin.js, không cần daotao.js đã
// nạp hay chưa — chỉ CÁC DROPDOWN Ở NƠI KHÁC (module Đào Tạo, nếu đã từng mở trong phiên) mới cần đồng
// bộ ngay, nên dùng ensureFnReady() thay vì gọi thẳng populateTrainingCategorySelects() — tránh buộc
// admin.js phải kéo theo cả module Đào Tạo (205KB) chỉ để có sẵn 1 hàm ít khi thực sự cần gọi ngay lúc
// đó (đa số trường hợp module Đào Tạo còn chưa mở trong phiên nên các dropdown đó chưa hiện ra để cần
// đồng bộ gấp — lần sau người dùng mở module Đào Tạo, populateTrainingCategorySelects() tự chạy lại với
// dữ liệu mới nhất qua đường render bình thường của module đó).
function syncTrainingCategorySelectsIfLoaded() {
  ensureFnReady('populateTrainingCategorySelects').then(() => {
    if (typeof window.populateTrainingCategorySelects === 'function') window.populateTrainingCategorySelects();
  }).catch(() => { /* module Đào Tạo chưa từng mở/không tải được — bỏ qua, không ảnh hưởng màn hình này */ });
}

async function saveTrainingCategory(e) {
  e.preventDefault();
  const name = document.getElementById('txtTrainingCategoryName').value.trim();
  if (DB.trainingCategories.includes(name)) return alert('Loại đào tạo đã tồn tại!');
  DB.trainingCategories.push(name);
  const saved = await syncStorage('trainingCategories');
  if (!saved) { DB.trainingCategories = DB.trainingCategories.filter(t => t !== name); return; }
  logSystemAction('USER_MGM', 'ADD_TRAINING_CATEGORY', `Thêm loại đào tạo mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtTrainingCategoryName').value = '';
  renderTrainingCategoryList();
  syncTrainingCategorySelectsIfLoaded();
}

async function deleteTrainingCategory(name) {
  if (!confirmCatalogValueDeletion('loại đào tạo', name)) return;
  const prevList = [...DB.trainingCategories];
  DB.trainingCategories = DB.trainingCategories.filter(t => t !== name);
  const saved = await syncStorage('trainingCategories');
  if (!saved) { DB.trainingCategories = prevList; renderTrainingCategoryList(); return; }
  logSystemAction('USER_MGM', 'DELETE_TRAINING_CATEGORY', `Xóa loại đào tạo [${name}]`, 'SUCCESS', name);
  renderTrainingCategoryList();
  syncTrainingCategorySelectsIfLoaded();
}

function renderTrainingCategoryList() {
  const ul = document.getElementById('trainingCategoryList');
  if (!ul) return;
  ul.innerHTML = renderCatalogBulkBarHtml('trainingCategories') + DB.trainingCategories.map(t => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      ${renderCatalogBulkCheckboxHtml('trainingCategories', t)}
      <span class="flex-1">${escapeHtml(t)}</span>
      <button data-op="renameTrainingCategory" data-arg0="'${escapeHtml(t)}'" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteTrainingCategory" data-arg0="'${escapeHtml(t)}'" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}

async function renameTrainingCategory(name) {
  const ok = await renameCatalogEntryClient('trainingCategories', name, 'Danh Mục Loại Đào Tạo');
  if (ok) { renderTrainingCategoryList(); syncTrainingCategorySelectsIfLoaded(); }
}

// SENSITIVE_CATEGORY_LABELS/SENSITIVE_CATEGORY_SEVERE da chuyen sang core.js (Ha tang: nap module theo
// cum, dot 7) - getMyPendingApprovals() (core-approvalhub.js, luon nap san) goi thang 2 hang so nay.

async function saveSensitiveKeyword(e) {
  e.preventDefault();
  const term = document.getElementById('txtSensitiveKeywordTerm').value.trim();
  const category = document.getElementById('selSensitiveKeywordCategory').value;
  if (DB.sensitiveKeywords.some(k => k.term.toLowerCase() === term.toLowerCase() && k.category === category)) {
    return alert('Từ khoá này đã có trong danh sách!');
  }
  const nextId = (Math.max(0, ...DB.sensitiveKeywords.map(k => k.id)) || 0) + 1;
  DB.sensitiveKeywords.push({ id: nextId, term, category });
  const saved = await syncStorage('sensitiveKeywords');
  if (!saved) { DB.sensitiveKeywords = DB.sensitiveKeywords.filter(k => k.id !== nextId); return; }
  logSystemAction('USER_MGM', 'ADD_SENSITIVE_KEYWORD', `Thêm từ khoá nhạy cảm [${term}] (${SENSITIVE_CATEGORY_LABELS[category]})`, 'SUCCESS', term);
  document.getElementById('txtSensitiveKeywordTerm').value = '';
  renderSensitiveKeywordList();
}

async function deleteSensitiveKeyword(id) {
  const kw = DB.sensitiveKeywords.find(k => k.id === id);
  if (!kw || !confirm(`Xóa từ khoá "${kw.term}"?`)) return;
  const prevList = DB.sensitiveKeywords.map(k => ({ ...k }));
  DB.sensitiveKeywords = DB.sensitiveKeywords.filter(k => k.id !== id);
  const saved = await syncStorage('sensitiveKeywords');
  if (!saved) { DB.sensitiveKeywords = prevList; renderSensitiveKeywordList(); return; }
  logSystemAction('USER_MGM', 'DELETE_SENSITIVE_KEYWORD', `Xóa từ khoá nhạy cảm [${kw.term}]`, 'SUCCESS', kw.term);
  renderSensitiveKeywordList();
}

function renderSensitiveKeywordList() {
  const ul = document.getElementById('sensitiveKeywordList');
  if (!ul) return;
  ul.innerHTML = renderObjectCatalogBulkBarHtml('sensitiveKeywords') + DB.sensitiveKeywords.map(k => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      ${renderObjectCatalogBulkCheckboxHtml('sensitiveKeywords', k.id)}
      <span class="flex-1">${escapeHtml(k.term)} <span class="text-[10px] px-1.5 py-0.5 rounded-full ${SENSITIVE_CATEGORY_SEVERE.has(k.category) ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}">${SENSITIVE_CATEGORY_LABELS[k.category] || k.category}</span></span>
      <button data-op="editSensitiveKeyword" data-arg0="${k.id}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteSensitiveKeyword" data-arg0="${k.id}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}

// BUG THẬT đã sửa (rà soát "tất cả các danh mục đều phải sửa được"): trước đây chỉ Thêm/Xóa, gõ sai từ
// khoá hoặc chọn nhầm phân loại phải xoá hẳn rồi thêm lại. Sửa CẢ 2 field (term + category) — term qua
// prompt() (khớp UX renameCatalogEntryClient()); category qua 1 prompt() liệt kê số thứ tự (không phải
// <select> vì đây là hộp thoại prompt() thuần, không dựng modal riêng cho việc nhỏ này).
async function editSensitiveKeyword(id) {
  const kw = DB.sensitiveKeywords.find(k => k.id === id);
  if (!kw) return;
  const newTerm = prompt('Từ khoá:', kw.term);
  if (newTerm === null) return;
  const trimmedTerm = newTerm.trim();
  if (!trimmedTerm) return alert('⛔ Từ khoá không được để trống.');

  const categoryKeys = Object.keys(SENSITIVE_CATEGORY_LABELS);
  const menu = categoryKeys.map((k, i) => `${i + 1}. ${SENSITIVE_CATEGORY_LABELS[k]}`).join('\n');
  const currentIdx = categoryKeys.indexOf(kw.category);
  const choice = prompt(`Phân loại:\n${menu}`, String(currentIdx >= 0 ? currentIdx + 1 : 1));
  if (choice === null) return;
  const choiceIdx = parseInt(choice, 10) - 1;
  if (!Number.isInteger(choiceIdx) || choiceIdx < 0 || choiceIdx >= categoryKeys.length) {
    return alert('⛔ Số phân loại không hợp lệ.');
  }
  const newCategory = categoryKeys[choiceIdx];

  if (trimmedTerm === kw.term && newCategory === kw.category) return;
  if (DB.sensitiveKeywords.some(k => k.id !== id && k.term.toLowerCase() === trimmedTerm.toLowerCase() && k.category === newCategory)) {
    return alert('⛔ Từ khoá này đã có trong danh sách.');
  }
  const snapshot = DB.sensitiveKeywords.map(k => ({ ...k }));
  DB.sensitiveKeywords = DB.sensitiveKeywords.map(k => (k.id === id ? { ...k, term: trimmedTerm, category: newCategory } : k));
  const saved = await syncStorage('sensitiveKeywords');
  if (!saved) { DB.sensitiveKeywords = snapshot; renderSensitiveKeywordList(); return; }
  logSystemAction('USER_MGM', 'EDIT_SENSITIVE_KEYWORD', `Sửa từ khoá nhạy cảm [${kw.term}] → [${trimmedTerm}] (${SENSITIVE_CATEGORY_LABELS[newCategory]})`, 'SUCCESS', trimmedTerm);
  renderSensitiveKeywordList();
}

async function saveCat(e) {
  e.preventDefault();
  const name = document.getElementById('txtCatName').value.trim();
  if (DB.cats.includes(name)) return alert('Loại tài liệu đã tồn tại!');
  DB.cats.push(name);
  const saved = await syncStorage('cats');
  if (!saved) { DB.cats = DB.cats.filter(c => c !== name); return; }
  logSystemAction('USER_MGM', 'ADD_CAT', `Thêm loại tài liệu mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtCatName').value = '';
  renderCatList();
  populateDropdowns();
}

async function deleteCat(name) {
  if (!confirmCatalogValueDeletion('loại tài liệu', name, 'Viết tắt loại tài liệu (dùng sinh Mã Tài Liệu) của loại này cũng bị xoá theo.')) return;
  const prevCats = [...DB.cats];
  const prevAbbrs = { ...DB.docCatAbbrs };
  DB.cats = DB.cats.filter(c => c !== name);
  delete DB.docCatAbbrs[name];
  const [savedCats, savedAbbrs] = await Promise.all([syncStorage('cats'), syncStorage('docCatAbbrs')]);
  if (!savedCats || !savedAbbrs) {
    DB.cats = prevCats; DB.docCatAbbrs = prevAbbrs;
    renderCatList();
    return;
  }
  logSystemAction('USER_MGM', 'DELETE_CAT', `Xóa loại tài liệu [${name}]`, 'SUCCESS', name);
  renderCatList();
  populateDropdowns();
}

// Viết tắt Phân loại tài liệu (dùng sinh Mã Tài Liệu, xem generateDocCode()) — tự suy ra mặc định nếu
// admin chưa từng sửa, áp dụng ngay không cần duyệt.
async function updateCatAbbr(name, value) {
  const prevAbbrs = { ...DB.docCatAbbrs };
  const abbr = (value || '').trim().toUpperCase();
  if (!abbr) delete DB.docCatAbbrs[name];
  else DB.docCatAbbrs[name] = abbr;
  const saved = await syncStorage('docCatAbbrs');
  if (!saved) { DB.docCatAbbrs = prevAbbrs; renderCatList(); return; }
  logSystemAction('USER_MGM', 'UPDATE_CAT_ABBR', `Cập nhật viết tắt phân loại tài liệu [${name}] = "${abbr}"`, 'SUCCESS', name);
}

function renderCatList() {
  const ul = document.getElementById('catList');
  if (!ul) return;
  ul.innerHTML = renderCatalogBulkBarHtml('cats') + DB.cats.map(c => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      ${renderCatalogBulkCheckboxHtml('cats', c)}
      <span class="flex-1">${escapeHtml(c)}</span>
      <input value="${escapeHtml(getDocCatAbbr(c))}" data-op-change="updateCatAbbr" data-arg0="'${escapeHtml(c)}'" data-arg-value="1" title="Viết tắt (dùng sinh Mã Tài Liệu)" class="w-16 border rounded px-1 py-0.5 text-center text-[11px] font-mono uppercase">
      <button data-op="renameCat" data-arg0="'${escapeHtml(c)}'" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteCat" data-arg0="'${escapeHtml(c)}'" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}

// Cùng lý do renameDept() ở trên — dùng route có cascade riêng (cascadeCatRename() cập nhật docs.cat +
// dời key docCatAbbrs, xem lib/catalogRename.js).
async function renameCat(name) {
  const ok = await renameCatalogEntryClient('cats', name, 'Phân Loại Tài Liệu');
  if (ok) { renderCatList(); populateDropdowns(); }
}

// Viết tắt Loại Pháp Lý hợp đồng (dùng sinh Mã Hợp Đồng, xem generateContractCode()) — tự suy ra mặc
// định nếu admin chưa từng sửa, áp dụng ngay không cần duyệt. Danh sách DB.contractTypes tự THÊM/BỚT
// ở màn Biểu Mẫu (không có nút Thêm/Xóa riêng ở đây) — nhưng ĐỔI TÊN 1 lựa chọn ĐÃ CÓ thì PHẢI qua nút
// "✏️ Sửa" ngay dưới đây (renameContractType()), KHÔNG sửa trực tiếp trong danh sách lựa chọn ở Biểu
// Mẫu (saveCoreFieldOptionsList() ở core.js chỉ ghi đè thẳng mảng, không cascade contractTypeAbbrs/
// contracts.type — xem cascadeContractTypeRename() ở lib/catalogRename.js).
async function updateContractTypeAbbr(name, value) {
  const prevAbbrs = { ...DB.contractTypeAbbrs };
  const abbr = (value || '').trim().toUpperCase();
  if (!abbr) delete DB.contractTypeAbbrs[name];
  else DB.contractTypeAbbrs[name] = abbr;
  const saved = await syncStorage('contractTypeAbbrs');
  if (!saved) { DB.contractTypeAbbrs = prevAbbrs; renderContractTypeAbbrList(); return; }
  logSystemAction('USER_MGM', 'UPDATE_CONTRACT_TYPE_ABBR', `Cập nhật viết tắt loại hợp đồng [${name}] = "${abbr}"`, 'SUCCESS', name);
}

// LỖI ĐÃ VÁ (đợt rà soát chuyên sâu vòng 2, mức Thấp — "đổi tên Loại Pháp Lý HĐ không cascade
// contractTypeAbbrs/contracts.type"): cùng lý do renameCat()/renameDept() ở trên — dùng route có cascade
// riêng (cascadeContractTypeRename() dời key contractTypeAbbrs + cập nhật contracts.type của mọi hợp
// đồng đang mang tên cũ, xem lib/catalogRename.js) thay vì để admin tự sửa trực tiếp trong danh sách lựa
// chọn ở Biểu Mẫu (ghi đè thẳng, không cascade).
async function renameContractType(name) {
  const ok = await renameCatalogEntryClient('contractTypes', name, 'Loại Pháp Lý HĐ');
  if (ok) { renderContractTypeAbbrList(); populateDropdowns(); }
}

function renderContractTypeAbbrList() {
  const ul = document.getElementById('contractTypeAbbrList');
  if (!ul) return;
  ul.innerHTML = DB.contractTypes.map(t => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(t)}</span>
      <input value="${escapeHtml(getContractTypeAbbr(t))}" data-op-change="updateContractTypeAbbr" data-arg0="'${escapeHtml(t)}'" data-arg-value="1" title="Viết tắt (dùng sinh Mã Hợp Đồng)" class="w-16 border rounded px-1 py-0.5 text-center text-[11px] font-mono uppercase">
      <button data-op="renameContractType" data-arg0="'${escapeHtml(t)}'" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
    </li>
  `).join('');
}

// Vẽ danh sách checkbox "Quyền Truy Cập Module" (khối 0.) theo BUSINESS_MODULES — dùng lại cho cả
// form Người dùng (prefix 'p') lẫn form Nhóm phân quyền (prefix 'g') qua tham số containerId/prefix.
// Với module/module con có trong MODULE_TAB_MAP, in thêm các dòng ĐỌC (không phải checkbox mới) liệt
// kê tab con + quyền quyết định + nút "Đi tới" nhảy sang đúng khối 1-18 đang giữ checkbox thật — xem
// MODULE_TAB_MAP/jumpToPermField() phía trên. Trả về '' (không in gì) nếu module không có tab nào cần
// khai — đa số module chỉ cần đúng 1 checkbox "vào được module" là đủ, không phải module nào cũng có tab.
function buildModuleTabNotesHTML(moduleKey) {
  const tabs = MODULE_TAB_MAP[moduleKey];
  if (!tabs || !tabs.length) return '';
  return `
    <div class="mt-1 pl-3 space-y-1 border-l-2 border-violet-200">
      ${tabs.map(t => `
        <div class="flex items-center justify-between gap-2 bg-violet-50 rounded px-2 py-1">
          <span class="text-[10.5px] text-violet-800 leading-snug">
            🏷️ <b>${escapeHtml(t.label)}</b> — ${t.note ? t.note : `hiện ${t.any ? 'nếu có 1 trong' : 'theo quyền'}: ${t.fields.map(f => escapeHtml(f.label)).join(t.any ? ' hoặc ' : ', ')}`}
          </span>
          ${t.badgeKey ? `<button type="button" data-op="jumpToPermField" data-arg0="${escapeHtml(t.badgeKey)}" class="text-[10px] font-bold text-violet-700 hover:underline whitespace-nowrap shrink-0">Đi tới →</button>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

// Vẽ ĐỆ QUY 1 node + toàn bộ cháu con của nó (độ sâu bất kỳ) — TRƯỚC ĐÂY (tới trước đợt "Mục 0: Quyền
// Truy Cập Module" 10/2026) hàm cha chỉ vẽ ĐÚNG 2 tầng cứng (topLevel + đúng 1 lớp childModules), nên
// module con của module con (VD "trainingLmsDashboard" có parent "internalTraining", bản thân
// "internalTraining" lại có parent "internal" — cây 3 tầng) sẽ KHÔNG BAO GIỜ được vẽ ra dù đã có trong
// BUSINESS_MODULES. Đệ quy tới độ sâu bất kỳ để khớp đúng cây "slide bar > tab con > tab cháu" người
// dùng yêu cầu — vẫn giữ NGUYÊN id checkbox `${prefix}_${key}` ở mọi tầng, nên
// readModuleAccessFromForm()/populateModuleAccessForm()/defaultModuleAccess() không cần đổi gì (đã lặp
// phẳng qua BUSINESS_MODULES, không quan tâm độ sâu).
function renderModuleAccessNode(m, prefix, depth, wrapId) {
  const children = BUSINESS_MODULES.filter(c => c.parent === m.key);
  // Thu nhỏ dần cỡ chữ theo độ sâu (0: module gốc, 1: module con/tab con, 2+: tab cháu) — giúp phân biệt
  // trực quan đúng 3 cấp "slide bar / tab con / tab cháu" ngay trên cây, không cần đọc chú thích.
  const labelCls = depth === 0 ? 'text-gray-700' : (depth === 1 ? 'text-gray-600 text-[11px]' : 'text-gray-500 text-[10.5px] italic');
  // Cặp nút "Chọn tất cả"/"Bỏ chọn" riêng cho ĐÚNG module gốc (depth 0) — tick/bỏ tick toàn bộ module
  // con/cháu nằm trong khối #${wrapId} (xem toggleModuleAccessSubtree() ở dưới), theo yêu cầu người dùng
  // "chọn all tại từng module để mình có thể chọn nhanh".
  const subtreeTogglesHTML = depth === 0 ? `
    <span class="ml-auto flex gap-1.5 text-[10px] font-bold shrink-0">
      <button type="button" data-op="toggleModuleAccessSubtree" data-arg0="${wrapId}" data-arg1="true" class="text-emerald-700 hover:underline">Chọn tất cả</button>
      <button type="button" data-op="toggleModuleAccessSubtree" data-arg0="${wrapId}" data-arg1="false" class="text-gray-500 hover:underline">Bỏ chọn</button>
    </span>
  ` : '';
  return `
    <div class="flex items-center gap-1.5">
      <label class="flex items-center gap-1.5 ${labelCls} cursor-pointer">
        <input type="checkbox" id="${prefix}_${m.key}" checked>
        <span>${depth >= 2 ? '↳ ' : ''}${escapeHtml(m.label)}</span>
      </label>
      ${subtreeTogglesHTML}
    </div>
    ${buildModuleTabNotesHTML(m.key)}
    ${children.length ? `
      <div class="pl-4 mt-1 space-y-0.5 border-l-2 border-slate-200">
        ${children.map(c => renderModuleAccessNode(c, prefix, depth + 1, wrapId)).join('')}
      </div>
    ` : ''}
  `;
}
function renderModuleAccessCheckboxes(containerId = 'moduleAccessCheckboxes', prefix = 'pModuleAccess') {
  const el = document.getElementById(containerId);
  if (!el) return;
  const topLevel = BUSINESS_MODULES.filter(m => !m.parent);
  // Nút "Chọn tất cả module"/"Bỏ chọn tất cả" (toàn bộ cây, mọi module gốc + con/cháu) + cặp nút riêng
  // từng module gốc (renderModuleAccessNode() ở trên) — theo yêu cầu người dùng (10/2026) để tick/bỏ tick
  // nhanh thay vì phải bấm từng checkbox 1 trong cây ~118 dòng.
  const globalTogglesHTML = `
    <div class="col-span-full flex items-center gap-3 text-xs font-bold pb-1 mb-1 border-b border-slate-200">
      <span class="text-gray-500">Toàn bộ module:</span>
      <button type="button" data-op="toggleModuleAccessSubtree" data-arg0="${containerId}" data-arg1="true" class="text-emerald-700 hover:underline">✅ Chọn tất cả</button>
      <button type="button" data-op="toggleModuleAccessSubtree" data-arg0="${containerId}" data-arg1="false" class="text-gray-500 hover:underline">❌ Bỏ chọn tất cả</button>
    </div>
  `;
  el.innerHTML = globalTogglesHTML + topLevel.map(m => {
    const wrapId = `${containerId}_wrap_${m.key}`;
    return `
    <div id="${wrapId}" class="bg-slate-50 px-2 py-1 rounded border">
      ${renderModuleAccessNode(m, prefix, 0, wrapId)}
    </div>
  `;
  }).join('');
}

// Tick/bỏ tick HÀNG LOẠT mọi checkbox "0. Quyền Truy Cập Module" nằm TRONG phần tử #wrapId — dùng chung
// cho cả nút toàn cục (wrapId = containerId, toàn bộ cây) lẫn nút riêng từng module gốc (wrapId = khối
// module đó, xem renderModuleAccessCheckboxes()/renderModuleAccessNode() ở trên). checked truyền vào dạng
// chuỗi "true"/"false" (data-arg* luôn là chuỗi) — ép lại thành boolean thật trước khi gán.
function toggleModuleAccessSubtree(wrapId, checked) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const isChecked = checked === true || checked === 'true';
  wrap.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = isChecked; });
}

function readModuleAccessFromForm(prefix = 'pModuleAccess') {
  const ma = {};
  BUSINESS_MODULES.forEach(m => {
    const cb = document.getElementById(`${prefix}_${m.key}`);
    ma[m.key] = cb ? cb.checked : true;
  });
  return ma;
}

function populateModuleAccessForm(moduleAccess, prefix = 'pModuleAccess') {
  const ma = moduleAccess || defaultModuleAccess();
  BUSINESS_MODULES.forEach(m => {
    const cb = document.getElementById(`${prefix}_${m.key}`);
    if (cb) cb.checked = ma[m.key] !== false;
  });
}

// Bảng phòng ban theo module (thay lưới checkbox 2-4 cột cũ) — TRƯỚC ĐÂY mỗi loại quyền (Xem/Tạo mới/
// Tải Xuống...) là 1 cột hẹp riêng, LẶP LẠI toàn bộ danh sách phòng ban trong cột đó nên tên phòng ban
// dài bị "truncate" mất chữ (phản hồi người dùng 9/2026, cùng khuôn bug đã sửa cho danh sách Siêu Thị ở
// task "Phân Quyền: đổi danh sách siêu thị sang widget tìm-kiếm-gõ-chọn"). Giờ đổi bố cục: MỖI DÒNG là 1
// phòng ban (tên chỉ hiện ĐÚNG 1 LẦN, đủ rộng không bị cắt), MỖI CỘT là 1 loại quyền, checkbox nằm ở ô
// giao nhau — khớp <thead> tĩnh đã có sẵn trong systemSection.html (cột "ALL" nằm ngay trên tiêu đề
// cột). `cols` là "prefix ALL" (KHÔNG có hậu tố "Dept") — id checkbox từng dòng vẫn dựng đúng dạng
// `${prefix}Dept_${idx}` như trước (KHÔNG đổi định dạng, vẫn khớp `[id^="pUploadDept_"]` ở
// collectPermsFromForm()/setGroupCheckboxes() trong module-admin-permtree.js, chỉ đổi vị trí hiển thị
// trên DOM) — thêm data-scope-group="<prefix>" để computePermTreeNodeCount() (badge "đã cấp X/Y") tra
// được nhóm KHÔNG cần 1 container DOM riêng bọc đúng 1 cột (không còn khả thi vì các cột giờ nằm CHUNG 1
// hàng <tr>, xem chú thích tại đó).
const PERM_DEPT_TABLES = [
  { tbody: 'pDocDeptTableBody', cols: ['pUpload', 'pDocDownload'] },
  // LÀM GỌN (11/2026, "Việc D"): bỏ cột pSubView/pContractView ("Xem") — xem chú thích đầy đủ tại khối
  // 📜 3/📄 4 trong systemSection.html.
  { tbody: 'pSubDeptTableBody', cols: ['pSubCreate', 'pSubDownload'] },
  { tbody: 'pContractDeptTableBody', cols: ['pContractCreate', 'pContractDownload'] },
  { tbody: 'pMeetingDeptTableBody', cols: ['pMeetingView', 'pMeetingBook'] },
  { tbody: 'pCarDeptTableBody', cols: ['pCarView', 'pCarCreate', 'pCarDownload'] },
  { tbody: 'pOfficeDeptTableBody', cols: ['pOfficeView', 'pOfficeCreate', 'pOfficeDownload'] },
];

// Khối/Ban (10/2026) — tra Khối/Ban đầu tiên (nếu có) chứa Phòng Ban này, dùng để gắn data-dept-group
// lên từng dòng bảng checkbox Phân Quyền, phục vụ bộ lọc chung filterPermDeptTablesByKhoiBan() ngay dưới.
function deptGroupIdOf(deptName) {
  const g = (DB.deptGroups || []).find(x => (x.depts || []).includes(deptName));
  return g ? g.id : '';
}

function renderDeptCheckboxes() {
  PERM_DEPT_TABLES.forEach(t => {
    const el = document.getElementById(t.tbody);
    if (!el) return;
    el.innerHTML = DB.depts.map((d, idx) => `
      <tr class="border-b border-gray-100 last:border-0" data-dept-group="${deptGroupIdOf(d)}">
        <td class="py-1 pr-2 text-gray-700 whitespace-nowrap">${escapeHtml(d)}</td>
        ${t.cols.map(prefix => `<td class="text-center px-1"><input type="checkbox" id="${prefix}Dept_${idx}" data-scope-group="${prefix}" value="${escapeHtml(d)}"></td>`).join('')}
      </tr>
    `).join('');
  });
  // operationOrderReceiptManage — KHÔNG nằm trong `PERM_DEPT_TABLES` ở trên (cần chèn thêm mục 'HO' đặc biệt,
  // xem renderOperationOrderReceiptScopeCheckboxes()) nhưng vẫn phải tự render lại mỗi lần renderDeptCheckboxes()
  // chạy (DB.depts đổi thì danh sách siêu thị/phòng ban ở đây cũng phải đổi theo) — gọi kèm luôn tại đây
  // thay vì rải thêm lời gọi riêng ở từng nơi renderDeptCheckboxes() đang được gọi.
  renderOperationOrderReceiptScopeCheckboxes();
  // checklistExecuteScope (Checklist Đánh Giá Siêu Thị, 11/2026 LÀM GỌN) — cùng lý do gọi kèm tại đây,
  // nguồn là DB.stores (siêu thị), KHÔNG phải DB.depts, và KHÔNG có mục 'HO' đặc biệt.
  renderChecklistExecuteScopeCheckboxes();
  // Khối/Ban → lọc bảng checkbox Phòng Ban (10/2026) — nạp lại danh sách Khối/Ban cho ô lọc dùng CHUNG
  // cho cả 6 bảng PERM_DEPT_TABLES rồi áp lại đúng bộ lọc đang chọn (nếu có) lên các dòng vừa render lại
  // ở trên (giữ nguyên trạng thái ẩn/hiện qua mỗi lần renderDeptCheckboxes() chạy lại).
  populatePermDeptKhoiBanFilterOptions();
  filterPermDeptTablesByKhoiBan();
}

// LỖI ĐÃ VÁ (phát hiện qua rà soát CSP 9/2026, mức Thấp — UX, không phải CSP): thêm/xoá/đổi tên Khối/Ban
// hoặc gán lại Phòng Ban con (renderDeptGroupList()) trước đây KHÔNG cập nhật lại ngay ô lọc
// #permDeptKhoiBanFilter lẫn thuộc tính data-dept-group của từng dòng Phòng Ban trong bảng Phân Quyền —
// cả 2 đều CHỈ được nạp 1 LẦN DUY NHẤT lúc setSystemSubTab('ADMIN') gọi renderDeptCheckboxes() ngay lúc
// vào tab, nên đứng nguyên tab "⚙️ Quản Trị" thao tác Khối/Ban xong thì ô lọc/bảng vẫn thấy dữ liệu CŨ,
// phải rời tab rồi vào lại mới thấy đúng. Hàm RIÊNG này chỉ cập nhật lại đúng phần bị ảnh hưởng (options
// của ô lọc + thuộc tính data-dept-group trên từng <tr> đã có sẵn) — KHÔNG gọi lại renderDeptCheckboxes()
// (hàm đó dựng lại TOÀN BỘ <tr> từ đầu, sẽ xoá mất trạng thái tick checkbox đang dở của form Sửa Người
// Dùng nếu đang mở), nên an toàn gọi lại bất cứ lúc nào ngay sau khi Khối/Ban đổi.
function refreshPermDeptGroupFilterAfterKhoiBanChange() {
  populatePermDeptKhoiBanFilterOptions();
  PERM_DEPT_TABLES.forEach(t => {
    const el = document.getElementById(t.tbody);
    if (!el) return;
    el.querySelectorAll('tr').forEach(tr => {
      const cb = tr.querySelector('input[type="checkbox"]');
      if (!cb) return;
      tr.setAttribute('data-dept-group', deptGroupIdOf(cb.value));
    });
  });
  filterPermDeptTablesByKhoiBan();
}

function populatePermDeptKhoiBanFilterOptions() {
  const sel = document.getElementById('permDeptKhoiBanFilter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— Tất cả Khối/Ban —</option>' +
    (DB.deptGroups || []).map(g => `<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');
  if ((DB.deptGroups || []).some(g => String(g.id) === current)) sel.value = current;
}

// Lọc CẢ 6 bảng checkbox Phòng Ban (PERM_DEPT_TABLES) theo Khối/Ban đang chọn — CHỈ ẩn/hiện dòng bằng
// CSS (KHÔNG render lại <tbody>), nên KHÔNG ảnh hưởng trạng thái tick sẵn của checkbox (giữ đúng nguyên
// tắc scopeFromForm()/setGroupCheckboxes() đọc/ghi theo id `${prefix}Dept_${idx}` cố định — xem core.js/
// module-admin-permtree.js). Để trống bộ lọc = hiện lại toàn bộ, khớp hành vi cũ (không đổi gì).
function filterPermDeptTablesByKhoiBan() {
  const sel = document.getElementById('permDeptKhoiBanFilter');
  const khoiId = sel ? sel.value : '';
  PERM_DEPT_TABLES.forEach(t => {
    const el = document.getElementById(t.tbody);
    if (!el) return;
    el.querySelectorAll('tr').forEach(tr => {
      const rowGroup = tr.getAttribute('data-dept-group') || '';
      tr.classList.toggle('hidden', !!khoiId && rowGroup !== khoiId);
    });
  });
}

function toggleScopeGroup(allCheckId, deptCheckPrefix) {
  const isAll = document.getElementById(allCheckId).checked;
  DB.depts.forEach((_, idx) => {
    const cb = document.getElementById(`${deptCheckPrefix}_${idx}`);
    if (cb) cb.disabled = isAll;
  });
}

// "🧾 Duyệt Nhập/Hủy Đơn Hàng" — quyền RIÊNG, TÁCH thành 2 quyền độc lập từ đợt "Tách quyền Duyệt
// Nhập/Hủy Đơn Hàng HO/Siêu Thị" (10/2026): "HO" giờ là 1 checkbox đơn (pOperationOrderReceiptHO, xem
// systemSection.html) KHÔNG còn render động ở đây — hàm này giờ CHỈ liệt kê DB.stores (siêu thị) cho
// quyền operationOrderReceiptManageStore, không chèn mục 'HO' đặc biệt nữa.
// BUG THẬT đã sửa (rà soát theo yêu cầu người dùng 9/2026): trước đây đọc nhầm DB.depts (danh mục
// Phòng/Ban khối văn phòng) thay vì DB.stores (danh mục Siêu Thị thật) — đơn "Đặt Hàng Tại Siêu Thị" luôn
// gắn `dept` = TÊN SIÊU THỊ (xem forceOwnDept ở lib/createValidation.js), nên tick chọn tên phòng ban ở
// đây KHÔNG BAO GIỜ khớp được với đơn hàng thật — quyền giới hạn theo từng siêu thị coi như luôn vô hiệu.
//
// ĐỔI SANG WIDGET TÌM-KIẾM-GÕ-CHỌN (10/2026, rà soát tiếp theo): lưới checkbox 2-3 cột cũ khiến tên siêu
// thị dài bị "truncate" mất chữ, không nhìn/tìm được siêu thị cần chọn khi danh sách dài (phản hồi người
// dùng) — thay bằng renderMultiSelectDropdown()/getMultiSelectValues() (core.js, khuôn chip + tìm kiếm đã
// dùng cho itPriceStoreScopeStoresMultiSelect/Áp Dụng Nhanh...). Mirror ĐÚNG renderChecklistAuditScopeCheckboxes()
// (cũng dùng DB.stores) ngay bên dưới. Container giữ NGUYÊN id cũ (pOperationOrderReceiptDeptContainer) để
// computePermTreeNodeCount()/module-admin-permtree.js tra đúng theo quy ước "<ALL checkbox id không có
// 'All'>DeptContainer" sẵn có, không cần đổi gì thêm ở đó ngoài cách đọc _gmsSelected thay vì checkbox.
function renderOperationOrderReceiptScopeCheckboxes() {
  renderMultiSelectDropdown('pOperationOrderReceiptDeptContainer', DB.stores || [], [], {
    placeholder: '🔍 Tìm siêu thị để thêm vào phạm vi...',
    emptyText: 'Chưa chọn siêu thị nào (tick "ALL" nếu áp dụng mọi siêu thị).'
  });
}
function toggleOperationOrderReceiptScopeGroup() {
  const isAll = document.getElementById('pOperationOrderReceiptAll').checked;
  document.getElementById('pOperationOrderReceiptDeptContainer')?.classList.toggle('opacity-40', isAll);
  document.getElementById('pOperationOrderReceiptDeptContainer')?.classList.toggle('pointer-events-none', isAll);
}
// Render lại widget với đúng danh sách siêu thị ĐÃ CHỌN từ dữ liệu quyền đã lưu (gọi SAU
// renderOperationOrderReceiptScopeCheckboxes() rỗng ở renderDeptCheckboxes(), xem populatePermsForm()) —
// tên hàm giữ nguyên "setXxxCheckboxes" dù giờ không còn checkbox nào, tránh phải sửa lại mọi nơi gọi.
function setOperationOrderReceiptScopeCheckboxes(scopeKeyList) {
  renderMultiSelectDropdown('pOperationOrderReceiptDeptContainer', DB.stores || [], Array.isArray(scopeKeyList) ? scopeKeyList : [], {
    placeholder: '🔍 Tìm siêu thị để thêm vào phạm vi...',
    emptyText: 'Chưa chọn siêu thị nào (tick "ALL" nếu áp dụng mọi siêu thị).',
    // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 9/2026, mức Thấp): trước đây không truyền resolveMissingLabel —
    // nếu siêu thị đã XOÁ hẳn (không phải đổi tên, đổi tên đã cascade đúng qua renameDeptInUserPerms())
    // khỏi danh mục nhưng vẫn còn trong quyền đã cấp, chip hiện thẳng tên cũ không có dấu hiệu cảnh báo
    // "không còn tồn tại" như các nơi khác trong hệ thống đã làm (VD badge tài khoản bị khoá).
    resolveMissingLabel: (v) => `⛔ ${v} (đã xoá khỏi danh mục)`
  });
}

// checklistExecuteScope (Checklist Đánh Giá Siêu Thị — 11/2026 LÀM GỌN: THAY HẲN checklistAuditScope cũ,
// phạm vi siêu thị CHỈ còn dùng cho "Checklist Thường" (checklistExecute) của người KHÔNG có siêu thị
// gắn sẵn — xem lib/checklist.js::getChecklistExecuteScope()/resolveStoreCodeForSubmission(). Quyền
// ATVSTP (checklistAtvstpExecute/checklistAtvstpReportView) giờ PHẲNG, không còn scope theo siêu thị —
// đã bỏ hẳn renderChecklistAuditScopeCheckboxes() cũ. Mirror ĐÚNG khuôn
// renderOperationOrderReceiptScopeCheckboxes() ở trên, nguồn DB.stores.
function renderChecklistExecuteScopeCheckboxes() {
  renderMultiSelectDropdown('pChecklistExecuteScopeDeptContainer', DB.stores || [], [], {
    placeholder: '🔍 Tìm siêu thị để thêm vào phạm vi thực hiện...',
    emptyText: 'Chưa chọn siêu thị nào (tick "ALL" nếu thực hiện được mọi siêu thị).',
    chipClass: 'bg-rose-100 text-rose-700', hoverClass: 'hover:bg-rose-50'
  });
}
function toggleChecklistExecuteScopeGroup() {
  const isAll = document.getElementById('pChecklistExecuteScopeAll').checked;
  document.getElementById('pChecklistExecuteScopeDeptContainer')?.classList.toggle('opacity-40', isAll);
  document.getElementById('pChecklistExecuteScopeDeptContainer')?.classList.toggle('pointer-events-none', isAll);
}
function setChecklistExecuteScopeCheckboxes(scopeKeyList) {
  renderMultiSelectDropdown('pChecklistExecuteScopeDeptContainer', DB.stores || [], Array.isArray(scopeKeyList) ? scopeKeyList : [], {
    placeholder: '🔍 Tìm siêu thị để thêm vào phạm vi thực hiện...',
    emptyText: 'Chưa chọn siêu thị nào (tick "ALL" nếu thực hiện được mọi siêu thị).',
    chipClass: 'bg-rose-100 text-rose-700', hoverClass: 'hover:bg-rose-50',
    // Xem chú thích đầy đủ ở setOperationOrderReceiptScopeCheckboxes() (đợt rà soát chuyên sâu 9/2026, mức Thấp).
    resolveMissingLabel: (v) => `⛔ ${v} (đã xoá khỏi danh mục)`
  });
}

// scopeFromForm() — CHUYỂN sang public/js/core.js (file luôn nạp EAGER) — xem chú thích ở đó.

