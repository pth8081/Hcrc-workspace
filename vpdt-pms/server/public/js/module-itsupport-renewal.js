// ==========================================
// GIA HẠN DỊCH VỤ CNTT — module con của Hỗ Trợ IT, CHỈ đội IT (itManage/admin) thấy được (khác Phê
// Duyệt Giá/Hỗ Trợ Yêu Cầu mở cho toàn bộ nhân viên). Danh mục nội bộ đội IT tự quản lý cho chính
// mình, KHÔNG qua bước duyệt nào (khác Giấy Phép — hồ sơ pháp lý cần người khác duyệt), cùng khuôn
// dashboard/hiệu lực/nhắc email như Giấy Phép nhưng bỏ hẳn phần status/lifecycleStatus/version (xem
// lib/createValidation.js itServiceRenewals.extraValidate).
// ==========================================
// IT_RENEWAL_CATEGORY_SUGGESTIONS: TRƯỚC ĐÂY hằng số cố định gõ cứng ngay tại đây (gợi ý tự học kết hợp
// mọi giá trị đã có sẵn trên bản ghi), đợt audit "form-fields-6" chuyển hẳn thành danh mục admin-editable
// DB.itRenewalCategories (cùng khuôn licenseTypes — ADMIN_ONLY_KEYS + tự học thêm khi ai gõ loại mới,
// xem defaults.js + renderItRenewalCategoryList()/saveItRenewalCategory()/deleteItRenewalCategory() bên
// dưới + learnItRenewalCategory() ở routes/create.js). Không xoá hẳn khỏi renderItServiceRenewals() việc
// gộp thêm mọi giá trị ĐANG dùng trên bản ghi (dù không/không còn trong danh mục) — phòng trường hợp
// admin lỡ xoá 1 danh mục đang được gán cho bản ghi cũ, dropdown lọc vẫn hiện đúng để lọc lại được.

// Tình trạng hiệu lực — cùng khuôn computeLicenseLifecycleState() nhưng không có RENEWING/REVOKED (module
// này không có khái niệm thu hồi/đánh dấu đang gia hạn, chỉ có ngày hết hạn).
function computeItRenewalLifecycleState(item) {
  if (!item || !item.expiryDate) return null;
  const expiry = new Date(item.expiryDate);
  if (isNaN(expiry.getTime())) return 'VALID';
  const now = new Date();
  const startExpiry = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((startExpiry - startNow) / 86400000);
  if (diffDays < 0) return 'EXPIRED';
  if (diffDays <= 30) return 'EXPIRING';
  return 'VALID';
}
const IT_RENEWAL_LIFECYCLE_LABELS = {
  VALID: { label: '🟢 Còn hiệu lực', cls: 'bg-green-100 text-green-800' },
  EXPIRING: { label: '🟡 Sắp hết hạn', cls: 'bg-yellow-100 text-yellow-800' },
  EXPIRED: { label: '🔴 Hết hạn', cls: 'bg-red-100 text-red-800' }
};

function filterItServiceRenewalByCard(key) {
  const map = {
    __ALL__: { filterItRenewalLifecycle: '' },
    EXPIRING: { filterItRenewalLifecycle: 'EXPIRING' },
    EXPIRED: { filterItRenewalLifecycle: 'EXPIRED' }
  };
  const cfg = map[key] || {};
  Object.entries(cfg).forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.value = val; });
  const box = document.querySelector('#itSubRenewal .filter-box-details');
  if (box) box.open = true;
  onItServiceRenewalFilterChange();
}
function onItServiceRenewalFilterChange() {
  resetListPage('itRenewal');
  renderItServiceRenewals();
}

// ============ Danh Mục "Loại Dịch Vụ" ============
// Cùng khuôn saveLicenseType()/deleteLicenseType()/renderLicenseTypeList() (module-tailieu.js): flat
// array chuỗi phẳng, thêm/xoá tại chỗ — server tự học thêm giá trị mới mỗi khi tạo dịch vụ (xem
// learnItRenewalCategory() ở routes/create.js), ở đây chỉ để Admin chủ động thêm trước/dọn bớt.
// DỜI khối HTML sang "Hệ Thống → Quản Trị → 🗂️ Quản Lý Danh Mục" (yêu cầu người dùng 9/2026 — trước đó
// nằm lẫn trong màn nghiệp vụ "Gia Hạn Dịch Vụ", không đúng chỗ vì đây là danh mục cấu hình dùng chung,
// không phải thao tác nghiệp vụ; xem systemSection.html khối "📜 Quản Lý Danh Mục 'Loại Dịch Vụ'"). Màn
// đó đã admin-only sẵn (setSystemSubTab() chặn non-admin ngay từ đầu) nên renderItRenewalCategoryList()
// KHÔNG còn cần tự ẩn/hiện theo quyền admin như trước (trước đây khối này còn hiện lẫn ở màn "Gia Hạn
// Dịch Vụ" — nơi itServiceRenewalManage KHÔNG phải admin cũng vào được — nên phải tự ẩn/hiện riêng).
// Hàm JS vẫn giữ nguyên ở file này (không dời sang module-admin.js) — cùng cách bố trí priceZone
// (HTML ở Quản Lý Danh Mục, hàm JS vẫn ở module-itsupport-price.js, không phải module-admin.js).
function renderItRenewalCategoryList() {
  const ul = document.getElementById('itRenewalCategoryList');
  if (!ul) return;
  ul.innerHTML = (DB.itRenewalCategories || []).map(c => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(c)}</span>
      <button data-op="renameItRenewalCategory" data-arg0="${escapeHtml(c)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteItRenewalCategory" data-arg0="${escapeHtml(c)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}
// renameItRenewalCategory — 10/2026, thêm nút "✏️ Sửa" (trước đây chỉ Xoá, gõ sai tên phải xoá tạo
// lại từ đầu, mất liên kết với các bản ghi Gia Hạn CNTT đã gán loại dịch vụ đó). Đi qua đúng route
// rename-with-cascade dùng chung (POST /api/admin/renameCatalogEntry, xem lib/catalogRename.js
// CATALOG_HANDLERS.itRenewalCategories) thay vì tự ghi đè mảng qua POST /api/data/itRenewalCategories
// — cùng khuôn renameLicenseType()/renameCarTaxiCompany() (module-tailieu.js/module-dangkyxe.js).
//
// Gọi renderItRenewalCategoryList() TRỰC TIẾP (không chỉ qua renderItServiceRenewals() như trước) — sau
// khi dời khối HTML ra "Quản Lý Danh Mục", màn "Gia Hạn Dịch Vụ" (#itRenewalTableBody) có thể CHƯA
// TỪNG mở trong phiên (fragment itSupportSection chưa tải), khi đó renderItServiceRenewals() tự return
// sớm (guard `if (!tbody) return;`) và sẽ bỏ qua luôn renderItRenewalCategoryList() bên trong nó — danh
// sách vừa thêm/sửa/xoá không cập nhật trên màn Quản Lý Danh Mục đang đứng cho tới khi tải lại trang.
// Vẫn gọi thêm renderItServiceRenewals() (an toàn, tự no-op nếu tbody chưa có) để đồng bộ luôn 2
// datalist gợi ý + dropdown lọc của màn "Gia Hạn Dịch Vụ" nếu đang mở sẵn trong phiên.
async function renameItRenewalCategory(name) {
  const ok = await renameCatalogEntryClient('itRenewalCategories', name, 'Danh Mục Loại Dịch Vụ Gia Hạn CNTT');
  if (ok) { renderItRenewalCategoryList(); renderItServiceRenewals(); }
}
function saveItRenewalCategory(e) {
  e.preventDefault();
  const name = document.getElementById('txtItRenewalCategoryName').value.trim();
  if (!name) return;
  if ((DB.itRenewalCategories || []).includes(name)) return alert('Loại dịch vụ đã tồn tại!');
  DB.itRenewalCategories = [...(DB.itRenewalCategories || []), name];
  syncStorage('itRenewalCategories');
  logSystemAction('IT_SUPPORT', 'ADD_IT_RENEWAL_CATEGORY', `Thêm loại dịch vụ Gia Hạn CNTT mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtItRenewalCategoryName').value = '';
  renderItRenewalCategoryList();
  renderItServiceRenewals();
}
function deleteItRenewalCategory(name) {
  if (!confirm(`Xóa loại dịch vụ "${name}" khỏi danh mục?`)) return;
  DB.itRenewalCategories = (DB.itRenewalCategories || []).filter(c => c !== name);
  syncStorage('itRenewalCategories');
  logSystemAction('IT_SUPPORT', 'DELETE_IT_RENEWAL_CATEGORY', `Xóa loại dịch vụ Gia Hạn CNTT [${name}]`, 'SUCCESS', name);
  renderItRenewalCategoryList();
  renderItServiceRenewals();
}

function renderItServiceRenewals() {
  const tbody = document.getElementById('itRenewalTableBody');
  if (!tbody) return;

  renderItRenewalCategoryList();
  const categories = Array.from(new Set([...(DB.itRenewalCategories || []), ...DB.itServiceRenewals.map(x => x.category).filter(Boolean)]));
  sddSetOptions('itRenewalCategoryDatalist', categories);
  sddSetOptions('itRenewalEditCategoryDatalist', categories);
  const categorySelect = document.getElementById('filterItRenewalCategory');
  if (categorySelect) {
    const current = categorySelect.value;
    categorySelect.innerHTML = '<option value="">-- Tất cả --</option>' + categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    categorySelect.value = current;
  }

  const lifecycleFilter = document.getElementById('filterItRenewalLifecycle')?.value || '';
  const categoryFilter = document.getElementById('filterItRenewalCategory')?.value || '';
  const keyword = (document.getElementById('filterItRenewalKeyword')?.value || '').toLowerCase().trim();

  const dashCards = [
    { key: '__ALL__', label: 'Tổng Dịch Vụ', count: DB.itServiceRenewals.length, colorClass: 'border-l-blue-500' },
    { key: 'EXPIRING', label: 'Sắp Hết Hạn (≤30 ngày)', count: DB.itServiceRenewals.filter(x => computeItRenewalLifecycleState(x) === 'EXPIRING').length, colorClass: 'border-l-amber-500' },
    { key: 'EXPIRED', label: 'Đã Hết Hạn', count: DB.itServiceRenewals.filter(x => computeItRenewalLifecycleState(x) === 'EXPIRED').length, colorClass: 'border-l-red-500' }
  ];
  let activeCardKey = '__ALL__';
  if (lifecycleFilter === 'EXPIRING') activeCardKey = 'EXPIRING';
  else if (lifecycleFilter === 'EXPIRED') activeCardKey = 'EXPIRED';
  document.getElementById('itRenewalDashboardCards').innerHTML = buildDashboardCardsHTML(dashCards, activeCardKey, 'filterItServiceRenewalByCard');

  const filtered = DB.itServiceRenewals.filter(item => {
    if (lifecycleFilter && computeItRenewalLifecycleState(item) !== lifecycleFilter) return false;
    if (categoryFilter && item.category !== categoryFilter) return false;
    if (!matchesKeywordFields([item.name, item.vendor, item.responsible], keyword)) return false;
    return true;
  });

  document.getElementById('paginationContainer_itRenewal').innerHTML = buildPaginationBoxHTML('itRenewal', 'renderItServiceRenewals');
  const pageItems = paginateList('itRenewal', filtered, 'renderItServiceRenewals', 'dịch vụ');

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-gray-500 italic">Không tìm thấy dịch vụ phù hợp.</td></tr>`;
    return;
  }
  tbody.innerHTML = pageItems.map(item => buildItServiceRenewalRowHTML(item)).join('');
}

function buildItServiceRenewalRowHTML(item) {
  const lifecycleKey = computeItRenewalLifecycleState(item);
  const lifecycleBadge = lifecycleKey
    ? `<span class="px-2 py-1 rounded font-bold text-xs ${IT_RENEWAL_LIFECYCLE_LABELS[lifecycleKey].cls}">${escapeHtml(IT_RENEWAL_LIFECYCLE_LABELS[lifecycleKey].label)}</span>`
    : '<span class="text-gray-400 text-xs">—</span>';

  const secondaryOptions = [];
  if (item.fileUrl) secondaryOptions.push({ value: 'download', label: '⬇️ Tải tệp' });
  if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
  const primaryBtnHTML = `<button data-op="runItServiceRenewalAction" data-arg0="${item.id}" data-arg1="renew" class="px-2 py-1 bg-sky-700 text-white rounded text-xs hover:bg-sky-800 font-semibold" title="Gia hạn dịch vụ">🔄 Gia Hạn</button>`;
  secondaryOptions.unshift({ value: 'edit', label: '✏️ Sửa' });

  return `
    <tr class="hover:bg-gray-50 transition border-b">
      <td class="border p-2">
        <div class="font-bold text-gray-800">${escapeHtml(item.name)}</div>
        ${item.note ? `<div class="text-xs text-gray-500">${escapeHtml(item.note)}</div>` : ''}
      </td>
      <td class="border p-2 text-gray-700">${escapeHtml(item.category)}</td>
      <td class="border p-2 text-xs text-gray-600">${escapeHtml(item.vendor || '—')}<div class="text-gray-400">${escapeHtml(item.responsible || '')}</div></td>
      <td class="border p-2 text-xs text-gray-600">${escapeHtml(item.expiryDate)}</td>
      <td class="border p-2 text-center">${lifecycleBadge}</td>
      <td class="border p-2 text-right text-gray-700">${item.cost ? Number(item.cost).toLocaleString('vi-VN') + ' đ' : '—'}</td>
      <td class="border p-2 text-center space-x-1">${buildActionCell(item.id, primaryBtnHTML, secondaryOptions, 'runItServiceRenewalAction')}</td>
    </tr>
  `;
}

function runItServiceRenewalAction(id, action) {
  const item = DB.itServiceRenewals.find(x => x.id === id);
  if (!item) return;
  switch (action) {
    case 'renew': openItServiceRenewalRenewModal(id); break;
    case 'edit': openItServiceRenewalEditModal(id); break;
    case 'download': downloadItServiceRenewalFile(id); break;
    case 'delete': deleteItServiceRenewalAction(id); break;
  }
}

async function submitItServiceRenewal(e) {
  e.preventDefault();
  const name = document.getElementById('itRenewalName').value.trim();
  const category = document.getElementById('itRenewalCategory').value.trim();
  if (!name) return alert('Vui lòng nhập Tên dịch vụ!');
  if (!category) return alert('Vui lòng nhập Loại dịch vụ!');
  const expiryDate = document.getElementById('itRenewalExpiryDate').value;
  if (!expiryDate) return alert('Vui lòng nhập Ngày hết hạn!');
  const startDate = document.getElementById('itRenewalStartDate').value || null;
  if (startDate && new Date(expiryDate).getTime() < new Date(startDate).getTime()) {
    return alert('Ngày hết hạn phải sau Ngày bắt đầu!');
  }

  const fileInput = document.getElementById('itRenewalFile');
  const file = fileInput.files[0];
  let uploaded = null;
  if (file) {
    try {
      uploaded = await uploadFileToServer(file, 'itServiceRenewal');
    } catch (err) {
      return alert(`⛔ Tải tệp lên thất bại: ${err.message}`);
    }
  }

  let customData;
  try {
    customData = await collectDynamicFieldsData('IT_RENEWAL');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const costInput = document.getElementById('itRenewalCost');
  const payload = {
    name, category,
    vendor: document.getElementById('itRenewalVendor').value.trim(),
    responsible: document.getElementById('itRenewalResponsible').value.trim(),
    cost: costInput.value.trim() ? getMoneyValue(costInput) : null,
    startDate, expiryDate,
    note: document.getElementById('itRenewalNote').value.trim(),
    fileUrl: uploaded ? uploaded.fileUrl : null,
    fileName: uploaded ? uploaded.fileName : null,
    createdAt: new Date().toLocaleString('vi-VN'),
    customData
  };

  let newItem;
  try {
    newItem = (await callCreateAction('itServiceRenewals', payload)).item;
  } catch (err) {
    return alert('⛔ ' + err.message);
  }

  DB.itServiceRenewals.unshift(newItem);
  logSystemAction('IT_SERVICE_RENEWAL', 'CREATE_IT_RENEWAL', `Thêm dịch vụ CNTT cần theo dõi gia hạn [${name}]`, 'SUCCESS', name);
  alert('✅ Đã thêm dịch vụ vào danh mục theo dõi gia hạn!');
  resetItRenewalForm();
  renderItServiceRenewals();
}

// resetItRenewalForm() — nút "↺ Làm Mới" (khớp mẫu resetXxxForm dùng chung) VÀ tái dùng lại cho đúng
// phần dọn form sau khi thêm thành công ở trên (KHÔNG duplicate). itRenewalCategory là ô tìm-kiếm-gõ-
// chọn tự học (sdd*, xem CLAUDE.md) nhưng KHÔNG có input ẩn riêng lưu giá trị đã chọn (khác các picker
// người dùng khác trong hệ thống) — chính input.value LÀ giá trị thật, form.reset() gốc đã đủ xoá sạch.
// Chỉ cần đóng tường minh dropdown gợi ý nếu lỡ đang mở (phòng trường hợp hiếm bấm "Làm Mới" ngay khi
// dropdown còn hiện — bấm ra ngoài để đóng bình thường đã có sẵn ở document click listener của sdd*,
// đây chỉ là chặn thêm cho chắc).
function resetItRenewalForm() {
  const formEl = document.getElementById('itRenewalCreateForm');
  if (!formEl) return;
  formEl.reset();
  document.getElementById('itRenewalCategoryDatalist')?.classList.add('hidden');
  clearSingleFileInput('itRenewalFile', 'itRenewalFileChip');
}

function downloadItServiceRenewalFile(id) {
  const item = DB.itServiceRenewals.find(x => x.id === id);
  if (!item || !item.fileUrl) return;
  const a = document.createElement('a');
  a.href = attachmentDownloadUrl(item.fileUrl, null, item.fileName || item.name);
  a.download = item.fileName || item.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  logSystemAction('IT_SERVICE_RENEWAL', 'DOWNLOAD_IT_RENEWAL_FILE', `Tải tệp dịch vụ CNTT [${item.name}]`, 'SUCCESS', item.name);
}

function deleteItServiceRenewalAction(id) {
  const item = DB.itServiceRenewals.find(x => x.id === id);
  if (!item) return;
  deleteRecordAdminOnly('itServiceRenewals', id, `dịch vụ CNTT "${item.name}"`, () => {
    DB.itServiceRenewals = DB.itServiceRenewals.filter(x => x.id !== id);
    logSystemAction('IT_SERVICE_RENEWAL', 'DELETE_IT_RENEWAL', `Xóa dịch vụ CNTT [${item.name}]`, 'SUCCESS', item.name);
    renderItServiceRenewals();
  });
}

// ----- Modal "Gia Hạn" -----
function openItServiceRenewalRenewModal(id) {
  const item = DB.itServiceRenewals.find(x => x.id === id);
  if (!item) return;
  document.getElementById('itRenewalRenewId').value = id;
  document.getElementById('itRenewalRenewCurrentInfo').innerText = `${item.name} (${item.category}) — hiện đang hết hạn ngày ${item.expiryDate}`;
  document.getElementById('itRenewalRenewNewExpiryDate').value = '';
  document.getElementById('itRenewalRenewCost').value = item.cost ? Number(item.cost).toLocaleString('vi-VN') : '';
  document.getElementById('itRenewalRenewModal').classList.remove('hidden');
}
function closeItServiceRenewalRenewModal() {
  document.getElementById('itRenewalRenewModal').classList.add('hidden');
}
async function submitItServiceRenewalRenew() {
  const id = Number(document.getElementById('itRenewalRenewId').value);
  const item = DB.itServiceRenewals.find(x => x.id === id);
  if (!item) return;
  const newExpiryDate = document.getElementById('itRenewalRenewNewExpiryDate').value;
  if (!newExpiryDate) return alert('Vui lòng nhập Ngày hết hạn mới!');
  if (new Date(newExpiryDate).getTime() <= new Date(item.expiryDate).getTime()) {
    return alert('Ngày hết hạn mới phải sau ngày hết hạn hiện tại!');
  }
  const costInput = document.getElementById('itRenewalRenewCost');
  const payload = { newExpiryDate, cost: costInput.value.trim() ? getMoneyValue(costInput) : null };
  let updated;
  try {
    updated = (await callRecordAction('itServiceRenewals', id, 'renew', payload)).item;
  } catch (err) { return alert('⛔ ' + err.message); }
  Object.assign(item, updated);
  logSystemAction('IT_SERVICE_RENEWAL', 'RENEW_IT_RENEWAL', `Gia hạn dịch vụ CNTT [${item.name}] sang ${newExpiryDate}`, 'SUCCESS', item.name);
  closeItServiceRenewalRenewModal();
  renderItServiceRenewals();
}

// ----- Modal "Sửa" -----
function openItServiceRenewalEditModal(id) {
  const item = DB.itServiceRenewals.find(x => x.id === id);
  if (!item) return;
  document.getElementById('itRenewalEditId').value = id;
  document.getElementById('itRenewalEditName').value = item.name || '';
  document.getElementById('itRenewalEditCategory').value = item.category || '';
  document.getElementById('itRenewalEditVendor').value = item.vendor || '';
  document.getElementById('itRenewalEditResponsible').value = item.responsible || '';
  document.getElementById('itRenewalEditCost').value = item.cost ? Number(item.cost).toLocaleString('vi-VN') : '';
  document.getElementById('itRenewalEditStartDate').value = item.startDate || '';
  document.getElementById('itRenewalEditExpiryDate').value = item.expiryDate || '';
  document.getElementById('itRenewalEditNote').value = item.note || '';
  document.getElementById('itRenewalEditModal').classList.remove('hidden');
}
function closeItServiceRenewalEditModal() {
  document.getElementById('itRenewalEditModal').classList.add('hidden');
}
async function submitItServiceRenewalEdit() {
  const id = Number(document.getElementById('itRenewalEditId').value);
  const item = DB.itServiceRenewals.find(x => x.id === id);
  if (!item) return;
  const name = document.getElementById('itRenewalEditName').value.trim();
  const category = document.getElementById('itRenewalEditCategory').value.trim();
  if (!name) return alert('Vui lòng nhập Tên dịch vụ!');
  if (!category) return alert('Vui lòng nhập Loại dịch vụ!');
  const expiryDate = document.getElementById('itRenewalEditExpiryDate').value;
  if (!expiryDate) return alert('Vui lòng nhập Ngày hết hạn!');
  const startDate = document.getElementById('itRenewalEditStartDate').value || null;
  if (startDate && new Date(expiryDate).getTime() < new Date(startDate).getTime()) {
    return alert('Ngày hết hạn phải sau Ngày bắt đầu!');
  }
  const costInput = document.getElementById('itRenewalEditCost');
  const payload = {
    name, category,
    vendor: document.getElementById('itRenewalEditVendor').value.trim(),
    responsible: document.getElementById('itRenewalEditResponsible').value.trim(),
    cost: costInput.value.trim() ? getMoneyValue(costInput) : null,
    startDate, expiryDate,
    note: document.getElementById('itRenewalEditNote').value.trim()
  };
  let updated;
  try {
    updated = (await callRecordAction('itServiceRenewals', id, 'edit', payload)).item;
  } catch (err) { return alert('⛔ ' + err.message); }
  Object.assign(item, updated);
  logSystemAction('IT_SERVICE_RENEWAL', 'EDIT_IT_RENEWAL', `Sửa dịch vụ CNTT [${name}]`, 'SUCCESS', name);
  closeItServiceRenewalEditModal();
  renderItServiceRenewals();
}

