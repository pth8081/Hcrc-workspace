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

function saveDept(e) {
  e.preventDefault();
  const name = document.getElementById('txtDeptName').value.trim();
  if (DB.depts.includes(name)) return alert('Phòng ban đã tồn tại!');
  DB.depts.push(name);
  syncStorage('depts');
  logSystemAction('USER_MGM', 'ADD_DEPT', `Thêm phòng ban mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtDeptName').value = '';
  renderDeptList();
  populateDropdowns();
}

function deleteDept(name) {
  if (!confirmCatalogValueDeletion('phòng ban', name, 'Viết tắt phòng ban (dùng sinh Mã Tài Liệu) của phòng này cũng bị xoá theo.')) return;
  DB.depts = DB.depts.filter(d => d !== name);
  delete DB.deptAbbrs[name];
  // Khối/Ban (10/2026) — dọn luôn tên Phòng Ban vừa xoá khỏi mọi deptGroups[].depts[] đang gán, tránh
  // hiện "ma" (Phòng Ban đã xoá nhưng vẫn liệt kê là con của 1 Khối/Ban).
  const affectedGroups = DB.deptGroups.filter(g => g.depts.includes(name));
  if (affectedGroups.length) {
    affectedGroups.forEach(g => { g.depts = g.depts.filter(d => d !== name); });
    syncStorage('deptGroups');
  }
  syncStorage('depts');
  syncStorage('deptAbbrs');
  logSystemAction('USER_MGM', 'DELETE_DEPT', `Xóa phòng ban [${name}]`, 'SUCCESS', name);
  renderDeptList();
  renderDeptGroupList();
  populateDropdowns();
}

// Viết tắt Phòng ban (dùng sinh Mã Tài Liệu, xem generateDocCode()) — tự suy ra mặc định nếu admin
// chưa từng sửa, áp dụng ngay không cần duyệt.
function updateDeptAbbr(name, value) {
  const abbr = (value || '').trim().toUpperCase();
  if (!abbr) delete DB.deptAbbrs[name];
  else DB.deptAbbrs[name] = abbr;
  syncStorage('deptAbbrs');
  logSystemAction('USER_MGM', 'UPDATE_DEPT_ABBR', `Cập nhật viết tắt phòng ban [${name}] = "${abbr}"`, 'SUCCESS', name);
}

function renderDeptList() {
  const ul = document.getElementById('deptList');
  if (!ul) return;
  ul.innerHTML = DB.depts.map(d => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(d)}</span>
      <input value="${escapeHtml(getDeptAbbr(d))}" data-op-change="updateDeptAbbr" data-arg0="${escapeHtml(d)}" data-arg-value="1" title="Viết tắt (dùng sinh Mã Tài Liệu)" class="w-16 border rounded px-1 py-0.5 text-center text-[11px] font-mono uppercase">
      <button data-op="renameDept" data-arg0="${escapeHtml(d)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="moveDeptToStore" data-arg0="${escapeHtml(d)}" title="Chuyển sang Danh Mục Siêu Thị" class="text-orange-600 font-bold hover:underline whitespace-nowrap">Chuyển</button>
      <button data-op="deleteDept" data-arg0="${escapeHtml(d)}" class="text-red-500 font-bold hover:underline">Xóa</button>
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
function saveDeptGroup(e) {
  e.preventDefault();
  const name = document.getElementById('txtDeptGroupName').value.trim();
  if (!name) return;
  if (DB.deptGroups.some(g => g.name === name)) return alert('Khối/Ban đã tồn tại!');
  const nextId = DB.deptGroups.reduce((max, g) => Math.max(max, g.id || 0), 0) + 1;
  DB.deptGroups.push({ id: nextId, name, depts: [] });
  syncStorage('deptGroups');
  logSystemAction('USER_MGM', 'ADD_DEPT_GROUP', `Thêm Khối/Ban mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtDeptGroupName').value = '';
  renderDeptGroupList();
  populateDropdowns();
}

function renameDeptGroup(id) {
  const g = DB.deptGroups.find(x => x.id === id);
  if (!g) return;
  const newName = String(prompt(`Nhập tên mới cho Khối/Ban "${g.name}":`, g.name) || '').trim();
  if (!newName || newName === g.name) return;
  if (DB.deptGroups.some(x => x.id !== id && x.name === newName)) return alert('Tên Khối/Ban đã tồn tại!');
  g.name = newName;
  syncStorage('deptGroups');
  logSystemAction('USER_MGM', 'RENAME_DEPT_GROUP', `Đổi tên Khối/Ban → [${newName}]`, 'SUCCESS', newName);
  renderDeptGroupList();
  populateDropdowns();
}

function deleteDeptGroup(id) {
  const g = DB.deptGroups.find(x => x.id === id);
  if (!g) return;
  if (!confirm(`Xoá Khối/Ban "${g.name}"?\n\nNgười dùng/màn Phân Quyền đang lọc theo Khối này sẽ tự coi như "để trống" (hiện lại toàn bộ Phòng Ban) — KHÔNG xoá Phòng Ban con, chỉ mất liên kết nhóm.`)) return;
  DB.deptGroups = DB.deptGroups.filter(x => x.id !== id);
  syncStorage('deptGroups');
  logSystemAction('USER_MGM', 'DELETE_DEPT_GROUP', `Xóa Khối/Ban [${g.name}]`, 'SUCCESS', g.name);
  renderDeptGroupList();
  populateDropdowns();
}

// Đổi danh sách Phòng Ban con của 1 Khối/Ban — đọc giá trị hiện có trong widget renderMultiSelectDropdown()
// bằng getMultiSelectValues() khi bấm nút "💾 Lưu Phòng Ban" (KHÔNG dùng callback onChange live-save vì
// renderMultiSelectDropdown() tự bắn onChange ngay cả lúc SETUP với initialSelected — live-save sẽ gọi
// ngược lại renderDeptGroupList() ngay trong lúc đang dựng DOM, cùng lý do khiến khối
// renderOperationOrderReceiptScopeCheckboxes() cũng chỉ đọc giá trị lúc submit form, không live-save).
function saveDeptGroupChildren(id) {
  const g = DB.deptGroups.find(x => x.id === id);
  if (!g) return;
  g.depts = getMultiSelectValues(`deptGroupChildren_${id}`);
  syncStorage('deptGroups');
  logSystemAction('USER_MGM', 'UPDATE_DEPT_GROUP_CHILDREN', `Cập nhật Phòng Ban con của Khối/Ban [${g.name}]: ${g.depts.join(', ') || '(rỗng)'}`, 'SUCCESS', g.name);
  populateDropdowns();
  alert(`✅ Đã lưu ${g.depts.length} Phòng Ban thuộc Khối/Ban "${g.name}".`);
}

function renderDeptGroupList() {
  const wrap = document.getElementById('deptGroupListWrap');
  if (!wrap) return;
  wrap.innerHTML = (DB.deptGroups || []).map(g => `
    <div class="bg-white rounded border p-2.5 space-y-1.5">
      <div class="flex items-center justify-between gap-2">
        <span class="font-semibold text-xs">${escapeHtml(g.name)} <span class="text-gray-400 font-normal">(${g.depts.length} phòng ban)</span></span>
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
  `).join('') || '<p class="text-[11px] text-gray-400 italic">Chưa có Khối/Ban nào.</p>';
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
function addStoreToCatalog(name) {
  if (!name) return false;
  if (DB.stores.includes(name)) { alert('Siêu thị đã tồn tại!'); return false; }
  DB.stores.push(name);
  syncStorage('stores');
  logSystemAction('USER_MGM', 'ADD_STORE', `Thêm siêu thị mới [${name}]`, 'SUCCESS', name);
  return true;
}

function saveStore(e) {
  e.preventDefault();
  const name = document.getElementById('txtStoreName').value.trim();
  if (!name) return;
  if (!addStoreToCatalog(name)) return;
  document.getElementById('txtStoreName').value = '';
  renderStoreList();
  populateDropdowns();
}

// "+ Thêm siêu thị mới" ngay tại ô "Siêu Thị" của form Người Dùng — gõ tên mới, tự thêm vào Danh Mục
// Siêu Thị (addStoreToCatalog() ở trên) + populateDropdowns() nạp lại toàn bộ dropdown (kể cả #uStore)
// + tự CHỌN LUÔN giá trị vừa thêm, không phải rời form đi Quản Lý Danh Mục thêm trước rồi quay lại.
function promptAddStoreInline() {
  const name = String(prompt('Tên siêu thị mới:') || '').trim();
  if (!name) return;
  if (!addStoreToCatalog(name)) return;
  populateDropdowns();
  document.getElementById('uStore').value = name;
}

function deleteStore(name) {
  if (!confirmCatalogValueDeletion('siêu thị', name)) return;
  DB.stores = DB.stores.filter(s => s !== name);
  syncStorage('stores');
  logSystemAction('USER_MGM', 'DELETE_STORE', `Xóa siêu thị [${name}]`, 'SUCCESS', name);
  renderStoreList();
  populateDropdowns();
}

function renderStoreList() {
  const ul = document.getElementById('storeList');
  if (!ul) return;
  const types = DB.storeTypes || {};
  ul.innerHTML = DB.stores.map(s => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(s)}</span>
      <select data-op-change="setStoreType" data-arg0="${escapeHtml(s)}" data-arg-value="1" class="border rounded text-[11px] p-0.5">
        <option value="" ${!types[s] ? 'selected' : ''}>— Chưa phân loại —</option>
        <option value="ST" ${types[s] === 'ST' ? 'selected' : ''}>Siêu Thị</option>
        <option value="CH" ${types[s] === 'CH' ? 'selected' : ''}>Cửa Hàng</option>
      </select>
      <button data-op="renameStore" data-arg0="${escapeHtml(s)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteStore" data-arg0="${escapeHtml(s)}" class="text-red-500 font-bold hover:underline">Xóa</button>
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
    const newCount = data.items.filter(it => it.isNew).length;
    statusEl.innerText = `✅ Đọc file "${data.fileName}": ${newCount}/${data.items.length} siêu thị MỚI (còn lại đã có sẵn trong danh mục).`;
    document.getElementById('storeImportPreviewBody').innerHTML = data.items.map(it => `<tr>
      <td class="p-1">${escapeHtml(it.name)}</td>
      <td class="p-1">${it.isNew ? '<span class="text-emerald-600">✅ Mới</span>' : '<span class="text-gray-400">— Đã có</span>'}</td>
    </tr>`).join('');
    document.getElementById('storeImportPreviewWrap').classList.remove('hidden');
    if (newCount > 0) document.getElementById('storeImportConfirmBtn').classList.remove('hidden');
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
  }
}

async function confirmStoreImport() {
  const newNames = storeImportPreviewItems.filter(it => it.isNew).map(it => it.name);
  if (!newNames.length) return;
  DB.stores = [...DB.stores, ...newNames];
  const saved = await syncStorage('stores');
  if (!saved) { DB.stores = DB.stores.filter(s => !newNames.includes(s)); return; }
  logSystemAction('USER_MGM', 'IMPORT_STORES', `Import Excel: thêm ${newNames.length} siêu thị mới`, 'SUCCESS', String(newNames.length));
  alert(`✅ Đã thêm ${newNames.length} siêu thị mới vào Danh Mục Siêu Thị.`);
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
function moveDeptToStore(name) {
  if (DB.stores.includes(name)) return alert('Tên này đã có trong Danh Mục Siêu Thị!');
  if (!confirm(`Chuyển "${name}" từ Danh Mục Phòng Ban sang Danh Mục Siêu Thị?\n\nCác user/bản ghi đang thuộc phòng ban này sẽ KHÔNG bị ảnh hưởng — chỉ đổi nơi hiển thị trong danh mục quản lý.`)) return;
  DB.depts = DB.depts.filter(d => d !== name);
  DB.stores.push(name);
  syncStorage('depts');
  syncStorage('stores');
  logSystemAction('USER_MGM', 'MOVE_DEPT_TO_STORE', `Chuyển [${name}] từ Danh Mục Phòng Ban sang Danh Mục Siêu Thị`, 'SUCCESS', name);
  renderDeptList();
  renderStoreList();
  populateDropdowns();
}

// Danh sách Chức Danh — cùng mô hình với Phòng Ban/Phân Loại Tài Liệu ở trên (danh sách chuỗi phẳng,
// admin tự thêm/xóa). Không kiểm tra ai đang dùng chức danh sắp xóa (giống hệt xóa Phòng Ban) — chân
// ký của các hồ sơ đã tạo trước đó chỉ đơn giản không còn hiện chức danh nếu người đó bị gỡ khỏi danh
// sách sau này, không phá vỡ dữ liệu cũ.
function saveJobTitle(e) {
  e.preventDefault();
  const name = document.getElementById('txtJobTitleName').value.trim();
  if (DB.jobTitles.includes(name)) return alert('Chức danh đã tồn tại!');
  DB.jobTitles.push(name);
  syncStorage('jobTitles');
  logSystemAction('USER_MGM', 'ADD_JOB_TITLE', `Thêm chức danh mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtJobTitleName').value = '';
  renderJobTitleList();
  populateDropdowns();
}

function deleteJobTitle(name) {
  if (!confirmCatalogValueDeletion('chức danh', name, 'Chức danh này có thể đang được dùng ở bước duyệt "Theo vị trí"/"Quy Trình Đặt Hàng Siêu Thị" và ở chính hồ sơ tài khoản người dùng.')) return;
  DB.jobTitles = DB.jobTitles.filter(t => t !== name);
  syncStorage('jobTitles');
  logSystemAction('USER_MGM', 'DELETE_JOB_TITLE', `Xóa chức danh [${name}]`, 'SUCCESS', name);
  renderJobTitleList();
  populateDropdowns();
}

function renderJobTitleList() {
  const ul = document.getElementById('jobTitleList');
  if (!ul) return;
  ul.innerHTML = DB.jobTitles.map(t => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(t)}</span>
      <button data-op="renameJobTitle" data-arg0="${escapeHtml(t)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteJobTitle" data-arg0="${escapeHtml(t)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}

async function renameJobTitle(name) {
  const ok = await renameCatalogEntryClient('jobTitles', name, 'Danh Sách Chức Danh');
  if (ok) { renderJobTitleList(); populateDropdowns(); }
}

// ===== Danh Sách Chức Danh (Siêu Thị) — DB.storeJobTitles, {label}[] (mục 4a) — TÁCH khỏi DB.jobTitles
// (Khối Văn Phòng/HO), dùng cho field "Chức danh" của user posType==='STORE' ở form Người Dùng đầy đủ.
// Trước đây còn cờ restrictedFromSelfService (khoá 1 chức danh khỏi form rút gọn "Quản Lý Nhân Viên Siêu
// Thị" ở Đồng Phục) — cờ này đã bị xoá cùng sub-tab đó (gỡ hẳn, xem VERSION.md); danh mục chỉ còn 1 field
// {label}. =====
function saveStoreJobTitle(e) {
  e.preventDefault();
  const label = document.getElementById('txtStoreJobTitleName').value.trim();
  if (!label) return;
  if (DB.storeJobTitles.some(t => t.label === label)) return alert('Chức danh đã tồn tại!');
  DB.storeJobTitles.push({ label });
  syncStorage('storeJobTitles');
  logSystemAction('USER_MGM', 'ADD_STORE_JOB_TITLE', `Thêm chức danh siêu thị mới [${label}]`, 'SUCCESS', label);
  document.getElementById('txtStoreJobTitleName').value = '';
  renderStoreJobTitleList();
  populateDropdowns();
}

function deleteStoreJobTitle(label) {
  if (!confirmCatalogValueDeletion('chức danh siêu thị', label, 'Chức danh này có thể đang được dùng ở bước duyệt "Theo vị trí"/"Quy Trình Đặt Hàng Siêu Thị" và ở chính hồ sơ tài khoản người dùng.')) return;
  DB.storeJobTitles = DB.storeJobTitles.filter(t => t.label !== label);
  syncStorage('storeJobTitles');
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
  ul.innerHTML = (DB.storeJobTitles || []).map(t => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(t.label)}</span>
      <button data-op="renameStoreJobTitle" data-arg0="${escapeHtml(t.label)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteStoreJobTitle" data-arg0="${escapeHtml(t.label)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
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
function addPositionTypeEntry(e) {
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
  syncStorage('positionTypes');
  logSystemAction('USER_MGM', 'ADD_POSITION_TYPE_ENTRY', `Thêm ${field === 'locations' ? 'địa điểm' : 'chức danh'} [${value}] vào Vị Trí Làm Việc [${t.label}]`, 'SUCCESS', value);
  input.value = '';
  renderPositionTypeList();
  populateDropdowns();
}
function deletePositionTypeEntry(key, field, value) {
  if (!confirmCatalogValueDeletion(field === 'locations' ? 'địa điểm' : 'chức danh', value, 'Tài khoản/hồ sơ đang dùng giá trị này (nếu có) sẽ thành tham chiếu treo.')) return;
  const t = DB.positionTypes.find(x => x.key === key);
  if (!t) return;
  t[field] = (t[field] || []).filter(v => v !== value);
  syncStorage('positionTypes');
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

function renderPositionTypeList() {
  const wrap = document.getElementById('positionTypeList');
  if (!wrap) return;
  wrap.innerHTML = (DB.positionTypes || []).map(t => {
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
        <span class="font-semibold text-xs">${escapeHtml(t.label)}</span>
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

function saveTrainingCategory(e) {
  e.preventDefault();
  const name = document.getElementById('txtTrainingCategoryName').value.trim();
  if (DB.trainingCategories.includes(name)) return alert('Loại đào tạo đã tồn tại!');
  DB.trainingCategories.push(name);
  syncStorage('trainingCategories');
  logSystemAction('USER_MGM', 'ADD_TRAINING_CATEGORY', `Thêm loại đào tạo mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtTrainingCategoryName').value = '';
  renderTrainingCategoryList();
  syncTrainingCategorySelectsIfLoaded();
}

function deleteTrainingCategory(name) {
  if (!confirmCatalogValueDeletion('loại đào tạo', name)) return;
  DB.trainingCategories = DB.trainingCategories.filter(t => t !== name);
  syncStorage('trainingCategories');
  logSystemAction('USER_MGM', 'DELETE_TRAINING_CATEGORY', `Xóa loại đào tạo [${name}]`, 'SUCCESS', name);
  renderTrainingCategoryList();
  syncTrainingCategorySelectsIfLoaded();
}

function renderTrainingCategoryList() {
  const ul = document.getElementById('trainingCategoryList');
  if (!ul) return;
  ul.innerHTML = DB.trainingCategories.map(t => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(t)}</span>
      <button data-op="renameTrainingCategory" data-arg0="${escapeHtml(t)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteTrainingCategory" data-arg0="${escapeHtml(t)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}

async function renameTrainingCategory(name) {
  const ok = await renameCatalogEntryClient('trainingCategories', name, 'Danh Mục Loại Đào Tạo');
  if (ok) { renderTrainingCategoryList(); syncTrainingCategorySelectsIfLoaded(); }
}

// SENSITIVE_CATEGORY_LABELS/SENSITIVE_CATEGORY_SEVERE da chuyen sang core.js (Ha tang: nap module theo
// cum, dot 7) - getMyPendingApprovals() (core-approvalhub.js, luon nap san) goi thang 2 hang so nay.

function saveSensitiveKeyword(e) {
  e.preventDefault();
  const term = document.getElementById('txtSensitiveKeywordTerm').value.trim();
  const category = document.getElementById('selSensitiveKeywordCategory').value;
  if (DB.sensitiveKeywords.some(k => k.term.toLowerCase() === term.toLowerCase() && k.category === category)) {
    return alert('Từ khoá này đã có trong danh sách!');
  }
  const nextId = (Math.max(0, ...DB.sensitiveKeywords.map(k => k.id)) || 0) + 1;
  DB.sensitiveKeywords.push({ id: nextId, term, category });
  syncStorage('sensitiveKeywords');
  logSystemAction('USER_MGM', 'ADD_SENSITIVE_KEYWORD', `Thêm từ khoá nhạy cảm [${term}] (${SENSITIVE_CATEGORY_LABELS[category]})`, 'SUCCESS', term);
  document.getElementById('txtSensitiveKeywordTerm').value = '';
  renderSensitiveKeywordList();
}

function deleteSensitiveKeyword(id) {
  const kw = DB.sensitiveKeywords.find(k => k.id === id);
  if (!kw || !confirm(`Xóa từ khoá "${kw.term}"?`)) return;
  DB.sensitiveKeywords = DB.sensitiveKeywords.filter(k => k.id !== id);
  syncStorage('sensitiveKeywords');
  logSystemAction('USER_MGM', 'DELETE_SENSITIVE_KEYWORD', `Xóa từ khoá nhạy cảm [${kw.term}]`, 'SUCCESS', kw.term);
  renderSensitiveKeywordList();
}

function renderSensitiveKeywordList() {
  const ul = document.getElementById('sensitiveKeywordList');
  if (!ul) return;
  ul.innerHTML = DB.sensitiveKeywords.map(k => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
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

function saveCat(e) {
  e.preventDefault();
  const name = document.getElementById('txtCatName').value.trim();
  if (DB.cats.includes(name)) return alert('Loại tài liệu đã tồn tại!');
  DB.cats.push(name);
  syncStorage('cats');
  logSystemAction('USER_MGM', 'ADD_CAT', `Thêm loại tài liệu mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtCatName').value = '';
  renderCatList();
  populateDropdowns();
}

function deleteCat(name) {
  if (!confirmCatalogValueDeletion('loại tài liệu', name, 'Viết tắt loại tài liệu (dùng sinh Mã Tài Liệu) của loại này cũng bị xoá theo.')) return;
  DB.cats = DB.cats.filter(c => c !== name);
  delete DB.docCatAbbrs[name];
  syncStorage('cats');
  syncStorage('docCatAbbrs');
  logSystemAction('USER_MGM', 'DELETE_CAT', `Xóa loại tài liệu [${name}]`, 'SUCCESS', name);
  renderCatList();
  populateDropdowns();
}

// Viết tắt Phân loại tài liệu (dùng sinh Mã Tài Liệu, xem generateDocCode()) — tự suy ra mặc định nếu
// admin chưa từng sửa, áp dụng ngay không cần duyệt.
function updateCatAbbr(name, value) {
  const abbr = (value || '').trim().toUpperCase();
  if (!abbr) delete DB.docCatAbbrs[name];
  else DB.docCatAbbrs[name] = abbr;
  syncStorage('docCatAbbrs');
  logSystemAction('USER_MGM', 'UPDATE_CAT_ABBR', `Cập nhật viết tắt phân loại tài liệu [${name}] = "${abbr}"`, 'SUCCESS', name);
}

function renderCatList() {
  const ul = document.getElementById('catList');
  if (!ul) return;
  ul.innerHTML = DB.cats.map(c => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(c)}</span>
      <input value="${escapeHtml(getDocCatAbbr(c))}" data-op-change="updateCatAbbr" data-arg0="${escapeHtml(c)}" data-arg-value="1" title="Viết tắt (dùng sinh Mã Tài Liệu)" class="w-16 border rounded px-1 py-0.5 text-center text-[11px] font-mono uppercase">
      <button data-op="renameCat" data-arg0="${escapeHtml(c)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteCat" data-arg0="${escapeHtml(c)}" class="text-red-500 font-bold hover:underline">Xóa</button>
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
function updateContractTypeAbbr(name, value) {
  const abbr = (value || '').trim().toUpperCase();
  if (!abbr) delete DB.contractTypeAbbrs[name];
  else DB.contractTypeAbbrs[name] = abbr;
  syncStorage('contractTypeAbbrs');
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
      <input value="${escapeHtml(getContractTypeAbbr(t))}" data-op-change="updateContractTypeAbbr" data-arg0="${escapeHtml(t)}" data-arg-value="1" title="Viết tắt (dùng sinh Mã Hợp Đồng)" class="w-16 border rounded px-1 py-0.5 text-center text-[11px] font-mono uppercase">
      <button data-op="renameContractType" data-arg0="${escapeHtml(t)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
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

function renderModuleAccessCheckboxes(containerId = 'moduleAccessCheckboxes', prefix = 'pModuleAccess') {
  const el = document.getElementById(containerId);
  if (!el) return;
  // Module con (field "parent", vd Xe/Phòng họp/VPP thuộc "hanhchinh") render LỒNG dưới đúng module
  // cha thay vì liệt kê ngang hàng — vẫn là checkbox pModuleAccess_<key> ĐẦY ĐỦ, nên
  // readModuleAccessFromForm()/populateModuleAccessForm() không cần đổi gì (đã lặp qua toàn bộ mảng
  // phẳng sẵn).
  const topLevel = BUSINESS_MODULES.filter(m => !m.parent);
  el.innerHTML = topLevel.map(m => {
    const childModules = BUSINESS_MODULES.filter(c => c.parent === m.key);
    return `
    <div class="bg-slate-50 px-2 py-1 rounded border">
      <label class="flex items-center gap-1.5 text-gray-700 cursor-pointer">
        <input type="checkbox" id="${prefix}_${m.key}" checked>
        <span>${escapeHtml(m.label)}</span>
      </label>
      ${buildModuleTabNotesHTML(m.key)}
      ${childModules.length ? `
        <div class="pl-4 mt-1 space-y-0.5 border-l-2 border-slate-200">
          ${childModules.map(c => `
            <label class="flex items-center gap-1.5 text-gray-600 text-[11px] cursor-pointer">
              <input type="checkbox" id="${prefix}_${c.key}" checked>
              <span>${escapeHtml(c.label)}</span>
            </label>
            ${buildModuleTabNotesHTML(c.key)}
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
  }).join('');
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
  { tbody: 'pDocDeptTableBody', cols: ['pUpload', 'pViewDraft', 'pViewApproved', 'pDocDownload'] },
  { tbody: 'pSubDeptTableBody', cols: ['pSubView', 'pSubCreate', 'pSubDownload'] },
  { tbody: 'pContractDeptTableBody', cols: ['pContractView', 'pContractCreate', 'pContractDownload'] },
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
  // checklistAuditScope (Checklist Đánh Giá Siêu Thị) — cùng lý do gọi kèm tại đây, nhưng nguồn là
  // DB.stores (siêu thị), KHÔNG phải DB.depts, và KHÔNG có mục 'HO' đặc biệt.
  renderChecklistAuditScopeCheckboxes();
  // checklistReportViewScope/checklistStoreSelfExecuteScope (10/2026) — cùng lý do gọi kèm tại đây,
  // nguồn DB.checklistTemplates (mẫu checklist), không phải siêu thị/phòng ban.
  renderChecklistReportViewScopeCheckboxes();
  renderChecklistStoreSelfExecuteScopeCheckboxes();
  // Khối/Ban → lọc bảng checkbox Phòng Ban (10/2026) — nạp lại danh sách Khối/Ban cho ô lọc dùng CHUNG
  // cho cả 6 bảng PERM_DEPT_TABLES rồi áp lại đúng bộ lọc đang chọn (nếu có) lên các dòng vừa render lại
  // ở trên (giữ nguyên trạng thái ẩn/hiện qua mỗi lần renderDeptCheckboxes() chạy lại).
  populatePermDeptKhoiBanFilterOptions();
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
    emptyText: 'Chưa chọn siêu thị nào (tick "ALL" nếu áp dụng mọi siêu thị).'
  });
}

// checklistAuditScope (Checklist Đánh Giá Siêu Thị — phạm vi siêu thị của kiểm soát viên CONTROL_AUDIT,
// xem lib/checklist.js) — mirror ĐÚNG khuôn renderOperationOrderReceiptScopeCheckboxes()/
// toggleOperationOrderReceiptScopeGroup()/setOperationOrderReceiptScopeCheckboxes() ở trên, nhưng nguồn
// DB.stores (không có mục 'HO' đặc biệt — checklist Kiểm Soát chỉ áp dụng cho siêu thị). Container ĐỔI
// TÊN từ pChecklistAuditScopeStoreContainer -> pChecklistAuditScopeDeptContainer (10/2026, cùng đợt đổi
// sang widget) để khớp đúng quy ước "<ALL id không có 'All'>DeptContainer" mà computePermTreeNodeCount()
// tự suy ra — trước đây LỆCH tên (bug âm thầm cũ: badge "đã cấp X/Y" không đếm được phạm vi Kiểm Soát đã
// chọn, dù dữ liệu lưu/đọc vẫn đúng qua scopeFromForm() theo prefix riêng) — tiện sửa luôn.
function renderChecklistAuditScopeCheckboxes() {
  renderMultiSelectDropdown('pChecklistAuditScopeDeptContainer', DB.stores || [], [], {
    placeholder: '🔍 Tìm siêu thị để thêm vào phạm vi kiểm soát...',
    emptyText: 'Chưa chọn siêu thị nào (tick "ALL" nếu kiểm soát mọi siêu thị).',
    chipClass: 'bg-rose-100 text-rose-700', hoverClass: 'hover:bg-rose-50'
  });
}
function toggleChecklistAuditScopeGroup() {
  const isAll = document.getElementById('pChecklistAuditScopeAll').checked;
  document.getElementById('pChecklistAuditScopeDeptContainer')?.classList.toggle('opacity-40', isAll);
  document.getElementById('pChecklistAuditScopeDeptContainer')?.classList.toggle('pointer-events-none', isAll);
}
function setChecklistAuditScopeCheckboxes(scopeKeyList) {
  renderMultiSelectDropdown('pChecklistAuditScopeDeptContainer', DB.stores || [], Array.isArray(scopeKeyList) ? scopeKeyList : [], {
    placeholder: '🔍 Tìm siêu thị để thêm vào phạm vi kiểm soát...',
    emptyText: 'Chưa chọn siêu thị nào (tick "ALL" nếu kiểm soát mọi siêu thị).',
    chipClass: 'bg-rose-100 text-rose-700', hoverClass: 'hover:bg-rose-50'
  });
}

// checklistReportViewScope/checklistStoreSelfExecuteScope (10/2026, yêu cầu người dùng): phạm vi theo
// MẪU checklist (không phải siêu thị) cho 2 quyền "📊 Xem Báo Cáo Checklist"/"✅ Đánh Giá Checklist (Tự
// Đánh Giá)" — mirror ĐÚNG khuôn renderChecklistAuditScopeCheckboxes() ở trên nhưng nguồn
// DB.checklistTemplates thay vì DB.stores, value là templateId ÉP CHUỖI (xem lib/checklist.js::
// getChecklistReportViewScope()/getChecklistStoreSelfExecuteScope() — field lưu vẫn tên 'depts' để tái
// dùng cơ chế union theo tên field, chỉ nội dung là template id).
// kind: 'REPORT' liệt kê MỌI mẫu (cả 2 loại QA/Trừ Điểm, mọi trạng thái — báo cáo có thể cần tra cứu cả
// mẫu đã Lưu Trữ); kind: 'SELF' CHỈ liệt kê mẫu templateType==='STORE_SELF' (đúng phạm vi quyền này thật
// sự dùng tới, theo xác nhận người dùng — tránh chọn nhầm mẫu Kiểm Soát không áp dụng được).
function checklistTemplateScopeItems(kind) {
  const kindLabel = { QA: 'QA', DEDUCTION: 'Trừ Điểm' };
  return (DB.checklistTemplates || [])
    .filter(t => kind !== 'SELF' || t.templateType === 'STORE_SELF')
    .map(t => ({ value: String(t.id), label: `${t.templateName} (${kindLabel[t.templateKind] || 'QA'})` }));
}
function renderChecklistReportViewScopeCheckboxes() {
  renderMultiSelectDropdown('pChecklistReportViewScopeDeptContainer', checklistTemplateScopeItems('REPORT'), [], {
    placeholder: '🔍 Tìm mẫu checklist để thêm vào phạm vi xem báo cáo...',
    emptyText: 'Chưa chọn mẫu nào (tick "ALL" nếu xem báo cáo mọi mẫu).',
    chipClass: 'bg-rose-100 text-rose-700', hoverClass: 'hover:bg-rose-50'
  });
}
function toggleChecklistReportViewScopeGroup() {
  const isAll = document.getElementById('pChecklistReportViewScopeAll').checked;
  document.getElementById('pChecklistReportViewScopeDeptContainer')?.classList.toggle('opacity-40', isAll);
  document.getElementById('pChecklistReportViewScopeDeptContainer')?.classList.toggle('pointer-events-none', isAll);
}
function setChecklistReportViewScopeCheckboxes(scopeKeyList) {
  renderMultiSelectDropdown('pChecklistReportViewScopeDeptContainer', checklistTemplateScopeItems('REPORT'), Array.isArray(scopeKeyList) ? scopeKeyList : [], {
    placeholder: '🔍 Tìm mẫu checklist để thêm vào phạm vi xem báo cáo...',
    emptyText: 'Chưa chọn mẫu nào (tick "ALL" nếu xem báo cáo mọi mẫu).',
    chipClass: 'bg-rose-100 text-rose-700', hoverClass: 'hover:bg-rose-50'
  });
}
function renderChecklistStoreSelfExecuteScopeCheckboxes() {
  renderMultiSelectDropdown('pChecklistStoreSelfExecuteScopeDeptContainer', checklistTemplateScopeItems('SELF'), [], {
    placeholder: '🔍 Tìm mẫu checklist để giới hạn Tự Đánh Giá...',
    emptyText: 'Chưa chọn mẫu nào (tick "ALL" nếu Tự Đánh Giá được mọi mẫu).',
    chipClass: 'bg-rose-100 text-rose-700', hoverClass: 'hover:bg-rose-50'
  });
}
function toggleChecklistStoreSelfExecuteScopeGroup() {
  const isAll = document.getElementById('pChecklistStoreSelfExecuteScopeAll').checked;
  document.getElementById('pChecklistStoreSelfExecuteScopeDeptContainer')?.classList.toggle('opacity-40', isAll);
  document.getElementById('pChecklistStoreSelfExecuteScopeDeptContainer')?.classList.toggle('pointer-events-none', isAll);
}
function setChecklistStoreSelfExecuteScopeCheckboxes(scopeKeyList) {
  renderMultiSelectDropdown('pChecklistStoreSelfExecuteScopeDeptContainer', checklistTemplateScopeItems('SELF'), Array.isArray(scopeKeyList) ? scopeKeyList : [], {
    placeholder: '🔍 Tìm mẫu checklist để giới hạn Tự Đánh Giá...',
    emptyText: 'Chưa chọn mẫu nào (tick "ALL" nếu Tự Đánh Giá được mọi mẫu).',
    chipClass: 'bg-rose-100 text-rose-700', hoverClass: 'hover:bg-rose-50'
  });
}

// scopeFromForm() — CHUYỂN sang public/js/core.js (file luôn nạp EAGER) — xem chú thích ở đó.

