// ==========================================
// 10. ADMIN MANAGEMENT (USER, DEPT, CAT)
// ==========================================
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
  if (!confirm(`Xóa phòng ban ${name}?`)) return;
  DB.depts = DB.depts.filter(d => d !== name);
  delete DB.deptAbbrs[name];
  syncStorage('depts');
  syncStorage('deptAbbrs');
  logSystemAction('USER_MGM', 'DELETE_DEPT', `Xóa phòng ban [${name}]`, 'SUCCESS', name);
  renderDeptList();
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
      <button data-op="moveDeptToStore" data-arg0="${escapeHtml(d)}" title="Chuyển sang Danh Mục Siêu Thị" class="text-orange-600 font-bold hover:underline whitespace-nowrap">Chuyển</button>
      <button data-op="deleteDept" data-arg0="${escapeHtml(d)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}

// ===== Danh Mục Siêu Thị (DB.stores) — TÁCH RIÊNG khỏi DB.depts (xem defaults.js), cùng khuôn CRUD
// đơn giản với Phòng Ban ở trên (không kiểm tra usage trước khi xóa) — dùng cho Vị Trí "Siêu Thị" ở
// form Người Dùng và module Đồng Phục (xem renderUniformAllocationBlocks()). =====
function saveStore(e) {
  e.preventDefault();
  const name = document.getElementById('txtStoreName').value.trim();
  if (!name) return;
  if (DB.stores.includes(name)) return alert('Siêu thị đã tồn tại!');
  DB.stores.push(name);
  syncStorage('stores');
  logSystemAction('USER_MGM', 'ADD_STORE', `Thêm siêu thị mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtStoreName').value = '';
  renderStoreList();
  populateDropdowns();
}

function deleteStore(name) {
  if (!confirm(`Xóa siêu thị ${name}?`)) return;
  DB.stores = DB.stores.filter(s => s !== name);
  syncStorage('stores');
  logSystemAction('USER_MGM', 'DELETE_STORE', `Xóa siêu thị [${name}]`, 'SUCCESS', name);
  renderStoreList();
  populateDropdowns();
}

function renderStoreList() {
  const ul = document.getElementById('storeList');
  if (!ul) return;
  ul.innerHTML = DB.stores.map(s => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(s)}</span>
      <button data-op="renameStore" data-arg0="${escapeHtml(s)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteStore" data-arg0="${escapeHtml(s)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
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
  if (!confirm(`Xóa chức danh ${name}?`)) return;
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

// ===== Danh Sách Chức Danh (Siêu Thị) — DB.storeJobTitles, {label, restrictedFromSelfService}[] (mục
// 4a) — TÁCH khỏi DB.jobTitles (Khối Văn Phòng/HO) vì cần thêm cờ "Không dùng được cho tự tạo tài
// khoản" (VD "Giám Đốc Siêu Thị"), dùng cho form rút gọn "Quản Lý Nhân Viên Siêu Thị" (Đồng Phục). =====
function saveStoreJobTitle(e) {
  e.preventDefault();
  const label = document.getElementById('txtStoreJobTitleName').value.trim();
  if (!label) return;
  if (DB.storeJobTitles.some(t => t.label === label)) return alert('Chức danh đã tồn tại!');
  const restricted = document.getElementById('chkStoreJobTitleRestricted').checked;
  DB.storeJobTitles.push({ label, restrictedFromSelfService: restricted });
  syncStorage('storeJobTitles');
  logSystemAction('USER_MGM', 'ADD_STORE_JOB_TITLE', `Thêm chức danh siêu thị mới [${label}]`, 'SUCCESS', label);
  document.getElementById('txtStoreJobTitleName').value = '';
  document.getElementById('chkStoreJobTitleRestricted').checked = false;
  renderStoreJobTitleList();
  populateDropdowns();
}

function deleteStoreJobTitle(label) {
  if (!confirm(`Xóa chức danh siêu thị "${label}"?`)) return;
  DB.storeJobTitles = DB.storeJobTitles.filter(t => t.label !== label);
  syncStorage('storeJobTitles');
  logSystemAction('USER_MGM', 'DELETE_STORE_JOB_TITLE', `Xóa chức danh siêu thị [${label}]`, 'SUCCESS', label);
  renderStoreJobTitleList();
  populateDropdowns();
}

function toggleStoreJobTitleRestricted(label, checked) {
  const entry = DB.storeJobTitles.find(t => t.label === label);
  if (!entry) return;
  entry.restrictedFromSelfService = checked;
  syncStorage('storeJobTitles');
  logSystemAction('USER_MGM', 'UPDATE_STORE_JOB_TITLE', `Đổi cờ "Không dùng được cho tự tạo tài khoản" của chức danh siêu thị [${label}] = ${checked}`, 'SUCCESS', label);
}
// CSP: onchange checkbox chỉ truyền được phần tử qua data-arg-el (không có slot "this.checked" — xem
// cspReadArgSlot), nên tách riêng wrapper đọc .checked từ phần tử rồi mới gọi hàm lõi ở trên.
function toggleStoreJobTitleRestrictedFromCheckbox(label, checkboxEl) {
  toggleStoreJobTitleRestricted(label, checkboxEl.checked);
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
      <label class="flex items-center gap-1 text-[10px] text-gray-500 whitespace-nowrap" title="Chức danh này sẽ KHÔNG hiện trong form tự tạo tài khoản ở sub-tab Quản Lý Nhân Viên Siêu Thị (Đồng Phục)">
        <input type="checkbox" ${t.restrictedFromSelfService ? 'checked' : ''} data-op-change="toggleStoreJobTitleRestrictedFromCheckbox" data-arg0="${escapeHtml(t.label)}" data-arg-el="1">
        Khoá tự tạo
      </label>
      <button data-op="renameStoreJobTitle" data-arg0="${escapeHtml(t.label)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteStoreJobTitle" data-arg0="${escapeHtml(t.label)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
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
  populateTrainingCategorySelects();
}

function deleteTrainingCategory(name) {
  if (!confirm(`Xóa loại đào tạo ${name}?`)) return;
  DB.trainingCategories = DB.trainingCategories.filter(t => t !== name);
  syncStorage('trainingCategories');
  logSystemAction('USER_MGM', 'DELETE_TRAINING_CATEGORY', `Xóa loại đào tạo [${name}]`, 'SUCCESS', name);
  renderTrainingCategoryList();
  populateTrainingCategorySelects();
}

function renderTrainingCategoryList() {
  const ul = document.getElementById('trainingCategoryList');
  if (!ul) return;
  ul.innerHTML = DB.trainingCategories.map(t => `
    <li class="p-2 flex justify-between items-center hover:bg-gray-50">
      <span>${escapeHtml(t)}</span>
      <button data-op="deleteTrainingCategory" data-arg0="${escapeHtml(t)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}

const SENSITIVE_CATEGORY_LABELS = { TUC_TIU: 'Tục tĩu', TIEU_CUC: 'Tiêu cực', CUC_DOAN: 'Cực đoan', PHAN_DONG: 'Phản động nhà nước' };
// CUC_DOAN/PHAN_DONG hiện nổi bật hơn (đỏ đậm) trong màn Phê Duyệt — cần người kiểm duyệt xử lý ngay,
// khác 2 nhóm còn lại (vàng, xử lý khi rảnh) — xem getMyPendingApprovals()/renderInternalNewsCard().
const SENSITIVE_CATEGORY_SEVERE = new Set(['CUC_DOAN', 'PHAN_DONG']);

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
    <li class="p-2 flex justify-between items-center hover:bg-gray-50">
      <span>${escapeHtml(k.term)} <span class="text-[10px] px-1.5 py-0.5 rounded-full ${SENSITIVE_CATEGORY_SEVERE.has(k.category) ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}">${SENSITIVE_CATEGORY_LABELS[k.category] || k.category}</span></span>
      <button data-op="deleteSensitiveKeyword" data-arg0="${k.id}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
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
  if (!confirm(`Xóa loại tài liệu ${name}?`)) return;
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
      <button data-op="deleteCat" data-arg0="${escapeHtml(c)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}

// Viết tắt Loại Pháp Lý hợp đồng (dùng sinh Mã Hợp Đồng, xem generateContractCode()) — tự suy ra mặc
// định nếu admin chưa từng sửa, áp dụng ngay không cần duyệt. Danh sách DB.contractTypes tự thêm/bớt
// ở màn Biểu Mẫu (không có nút Thêm/Xóa riêng ở đây, chỉ chỉnh viết tắt).
function updateContractTypeAbbr(name, value) {
  const abbr = (value || '').trim().toUpperCase();
  if (!abbr) delete DB.contractTypeAbbrs[name];
  else DB.contractTypeAbbrs[name] = abbr;
  syncStorage('contractTypeAbbrs');
  logSystemAction('USER_MGM', 'UPDATE_CONTRACT_TYPE_ABBR', `Cập nhật viết tắt loại hợp đồng [${name}] = "${abbr}"`, 'SUCCESS', name);
}

function renderContractTypeAbbrList() {
  const ul = document.getElementById('contractTypeAbbrList');
  if (!ul) return;
  ul.innerHTML = DB.contractTypes.map(t => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(t)}</span>
      <input value="${escapeHtml(getContractTypeAbbr(t))}" data-op-change="updateContractTypeAbbr" data-arg0="${escapeHtml(t)}" data-arg-value="1" title="Viết tắt (dùng sinh Mã Hợp Đồng)" class="w-16 border rounded px-1 py-0.5 text-center text-[11px] font-mono uppercase">
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

function renderDeptCheckboxes() {
  const groups = [
    { container: 'pUploadDeptContainer', prefix: 'pUploadDept' },
    { container: 'pViewDraftDeptContainer', prefix: 'pViewDraftDept' },
    { container: 'pViewApprovedDeptContainer', prefix: 'pViewApprovedDept' },
    { container: 'pDocDownloadDeptContainer', prefix: 'pDocDownloadDept' },
    { container: 'pSubViewDeptContainer', prefix: 'pSubViewDept' },
    { container: 'pSubCreateDeptContainer', prefix: 'pSubCreateDept' },
    { container: 'pSubDownloadDeptContainer', prefix: 'pSubDownloadDept' },
    { container: 'pContractViewDeptContainer', prefix: 'pContractViewDept' },
    { container: 'pContractCreateDeptContainer', prefix: 'pContractCreateDept' },
    { container: 'pContractDownloadDeptContainer', prefix: 'pContractDownloadDept' },
    { container: 'pMeetingViewDeptContainer', prefix: 'pMeetingViewDept' },
    { container: 'pMeetingBookDeptContainer', prefix: 'pMeetingBookDept' },
    { container: 'pCarViewDeptContainer', prefix: 'pCarViewDept' },
    { container: 'pCarCreateDeptContainer', prefix: 'pCarCreateDept' },
    { container: 'pCarDownloadDeptContainer', prefix: 'pCarDownloadDept' },
    { container: 'pOfficeViewDeptContainer', prefix: 'pOfficeViewDept' },
    { container: 'pOfficeCreateDeptContainer', prefix: 'pOfficeCreateDept' },
    { container: 'pOfficeDownloadDeptContainer', prefix: 'pOfficeDownloadDept' }
  ];

  groups.forEach(g => {
    const el = document.getElementById(g.container);
    if (!el) return;
    el.innerHTML = DB.depts.map((d, idx) => `
      <label class="flex items-center gap-1 text-gray-700 cursor-pointer">
        <input type="checkbox" id="${g.prefix}_${idx}" value="${escapeHtml(d)}">
        <span class="truncate">${escapeHtml(d)}</span>
      </label>
    `).join('');
  });
}

function toggleScopeGroup(allCheckId, deptCheckPrefix) {
  const isAll = document.getElementById(allCheckId).checked;
  DB.depts.forEach((_, idx) => {
    const cb = document.getElementById(`${deptCheckPrefix}_${idx}`);
    if (cb) cb.disabled = isAll;
  });
}

// Đọc 1 nhóm quyền theo phòng ban ({all, depts}) từ cặp checkbox ALL + danh sách phòng ban trên form.
function scopeFromForm(allId, deptPrefix) {
  return {
    all: document.getElementById(allId).checked,
    depts: Array.from(document.querySelectorAll(`[id^="${deptPrefix}_"]:checked`)).map(cb => cb.value)
  };
}

