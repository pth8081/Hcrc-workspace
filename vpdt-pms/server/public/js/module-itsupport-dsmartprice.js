// public/js/module-itsupport-dsmartprice.js — Hỗ Trợ IT > "💰 Cài Đặt Giá Bán Buôn" (12/2026), client
// cho routes/dsmartWholesalePrice.js. Xem chú thích mô hình dữ liệu đầy đủ ở route đó — tóm tắt (ĐÃ SỬA
// LẦN 5): CSPRICE chỉ cho phép 1 dòng/1 cặp (CUST_ID, SKU_ID), "Thêm Giá Mới" = INSERT nếu CHƯA có dòng,
// tự GHI ĐÈ nếu ĐÃ có dòng (không báo lỗi trùng khoá), "Sửa" = UPDATE đúng dòng CHƯA xoá, "Xoá" = DELETE
// thật, "Dùng Lại" (từ dòng đã xoá) = INSERT (hoặc tự ghi đè nếu lúc này đã có dòng khác).
let _dsmartPriceEntries = [];
let _dsmartPriceUploadRows = null;
let _dsmartPriceUploadFileName = null;
let _dsmartPriceAddFormCollapsed = true;
let _dsmartPriceUploadFilterCollapsed = true;
let _dsmartPriceMgFilterCollapsed = true;
let _dsmartPriceHistoryFilterCollapsed = true;
let _dsmartPriceEditingId = null;
let _dsmartPriceReusingEntry = null;
let _dsmartStoreConnSectionCollapsed = true;
let _dsmartStoreConnList = [];
let _dsmartStoreConnEditingId = null; // null = đang Thêm mới, có giá trị = đang Sửa
let _dsmartStoreConnImportRows = null;
let _dsmartStoreConnImportFileName = null;
let _dsmartConnStatusSectionCollapsed = true;
let _dsmartConnStatusLoaded = false; // chỉ tự gọi GET /connections/status LẦN ĐẦU mở khung, các lần mở lại sau không tự gọi lại (dùng nút "🔄 Kiểm Tra Lại Tất Cả")
// _dsmartPriceStoreOptions (12/2026, ô chọn "🏬 Áp Dụng Cho Siêu Thị") — danh sách RÚT GỌN (chỉ
// id/storeCode/storeName) các siêu thị ĐANG BẬT, nạp qua GET /store-connections/options (KHÔNG cần
// quyền admin, khác GET /store-connections đầy đủ chỉ admin xem được) — dùng cho CẢ 2 ô chọn: "1. Thêm
// Giá Mới" (#dsmartPriceApplyStoreMultiSelect) và "↩️ Dùng Lại" (#dsmartPriceReuseStoreMultiSelect).
let _dsmartPriceStoreOptions = [];

async function initDsmartPriceTab() {
  const isAdmin = !!currentUser?.perms?.admin;
  document.getElementById('btnDsmartPriceConfig').classList.toggle('hidden', !isAdmin);
  document.getElementById('btnDsmartStoreConnToggle').classList.toggle('hidden', !isAdmin);
  document.getElementById('btnDsmartConnStatusToggle').classList.toggle('hidden', !isAdmin);
  document.getElementById('dsmartPriceConnStatus').innerText = 'Xem "⚙️ Cấu Hình Kết Nối" (Admin) để kiểm tra/đổi thông tin kết nối DSmart16 Trung Tâm.';
  applyDsmartPriceAddFormState();
  applyDsmartPriceUploadFilterState();
  applyDsmartPriceMgFilterState();
  applyDsmartPriceHistoryFilterState();
  await loadDsmartPriceAutoDeleteConfig();
  const tasks = [renderDsmartPriceEntries(), renderDsmartPriceHistory(), loadDsmartPriceStoreOptions()];
  if (isAdmin) tasks.push(renderDsmartStoreConnList());
  await Promise.all(tasks);
}

// loadDsmartPriceStoreOptions()/renderDsmartPriceApplyStoreMultiSelect()/resolveDsmartPriceTargetStoreIds()
// (12/2026, theo yêu cầu người dùng — xem chú thích đầy đủ tại GET /store-connections/options,
// routes/dsmartWholesalePrice.js, và fanOutToStores(), lib/dsmartSqlClient.js).
async function loadDsmartPriceStoreOptions() {
  try {
    const res = await fetch('/api/dsmart-price/store-connections/options');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    _dsmartPriceStoreOptions = data.items || [];
  } catch (err) {
    _dsmartPriceStoreOptions = [];
    console.error('Không tải được danh sách siêu thị để chọn:', err.message);
  }
  renderDsmartPriceApplyStoreMultiSelect();
}
function renderDsmartPriceApplyStoreMultiSelect() {
  const items = _dsmartPriceStoreOptions.map(s => ({ value: s.id, label: `${s.storeCode} - ${s.storeName}` }));
  const allIds = items.map(it => it.value);
  renderMultiSelectDropdown('dsmartPriceApplyStoreMultiSelect', items, allIds, {
    placeholder: 'Tìm siêu thị...',
    emptyText: items.length ? 'Chưa chọn siêu thị nào — CHỈ ghi ở DSmart16 Trung Tâm, KHÔNG đồng bộ xuống siêu thị nào.' : 'Chưa cấu hình/bật siêu thị nào ở "🏬 Kết Nối Siêu Thị" — sẽ CHỈ ghi ở DSmart16 Trung Tâm.',
    allToggle: true
  });
}
// resolveDsmartPriceTargetStoreIds(containerId): đọc lựa chọn hiện tại của 1 ô renderMultiSelectDropdown()
// chọn siêu thị -> trả về giá trị gửi lên server cho POST /apply. Chọn ĐỦ TẤT CẢ (hoặc KHÔNG đổi gì, mặc
// định đã chọn sẵn hết) -> trả null (fan-out LINH ĐỘNG theo đúng danh sách Enabled hiện tại mỗi lần ghi,
// GIỮ NGUYÊN hành vi mặc định trước khi có tính năng này — tự nhận siêu thị MỚI thêm sau này mà không cần
// sửa lại từng dòng giá cũ). Chọn 1 PHẦN (kể cả rỗng = không siêu thị nào) -> trả mảng id đã chọn, ĐÓNG
// BĂNG lại trên entry để "Sửa"/"Xoá"/job tự động áp dụng lịch sau này nhắm đúng y hệt các siêu thị đó.
function resolveDsmartPriceTargetStoreIds(containerId) {
  const selected = getMultiSelectValues(containerId);
  const allIds = _dsmartPriceStoreOptions.map(s => s.id);
  if (!allIds.length || selected.length === allIds.length) return null;
  return selected;
}

// ===================== 🏬 Kết Nối Siêu Thị (Fan-Out) — CHỈ admin =====================
function toggleDsmartStoreConnSection() {
  _dsmartStoreConnSectionCollapsed = !_dsmartStoreConnSectionCollapsed;
  document.getElementById('dsmartStoreConnSection').classList.toggle('hidden', _dsmartStoreConnSectionCollapsed);
}

// ===================== 📡 Giám Sát Kết Nối (HO + Siêu Thị) — CHỈ admin =====================
// toggleDsmartConnStatusSection()/refreshDsmartConnStatus() (12/2026, theo yêu cầu người dùng: "theo dõi
// việc kết nối đến các máy siêu thị và máy HO... để tôi vào tôi mở ra tôi xem là cái trạng thái nó đang
// kết nối hoặc không kết nối") — gọi GET /api/dsmart-price/connections/status (HO + TỪNG siêu thị đã
// khai báo ở "🏬 Kết Nối Siêu Thị", song song). Tự tải đúng 1 LẦN khi mở khung lần đầu (_dsmartConnStatusLoaded),
// các lần mở lại sau đó không tự gọi lại — người dùng tự bấm "🔄 Kiểm Tra Lại Tất Cả" khi muốn làm mới.
function toggleDsmartConnStatusSection() {
  _dsmartConnStatusSectionCollapsed = !_dsmartConnStatusSectionCollapsed;
  document.getElementById('dsmartConnStatusSection').classList.toggle('hidden', _dsmartConnStatusSectionCollapsed);
  if (!_dsmartConnStatusSectionCollapsed && !_dsmartConnStatusLoaded) {
    _dsmartConnStatusLoaded = true;
    refreshDsmartConnStatus();
  }
}

function dsmartConnStatusRowHtml(label, hostInfo, row) {
  let statusBadge, detail;
  if (row.disabled) {
    statusBadge = `<span class="bg-gray-100 text-gray-500 text-[10.5px] font-bold px-2 py-0.5 rounded-full">⏸️ Đang Tắt</span>`;
    detail = '—';
  } else if (row.ok === true) {
    statusBadge = `<span class="bg-emerald-50 text-emerald-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">🟢 Đang kết nối</span>`;
    detail = '—';
  } else {
    const isNoPw = /mật khẩu/i.test(row.error || '');
    statusBadge = isNoPw
      ? `<span class="bg-amber-50 text-amber-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">⚠️ Thiếu Mật Khẩu</span>`
      : `<span class="bg-red-50 text-red-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">🔴 Không kết nối</span>`;
    detail = escapeHtml(row.error || 'Lỗi không xác định');
  }
  return `<tr>
    <td class="p-1.5 font-semibold">${escapeHtml(label)}</td>
    <td class="p-1.5 text-gray-500">${escapeHtml(hostInfo)}</td>
    <td class="p-1.5">${statusBadge}</td>
    <td class="p-1.5 text-right">${row.ms != null ? `${row.ms} ms` : '—'}</td>
    <td class="p-1.5 text-red-600">${detail}</td>
  </tr>`;
}

async function refreshDsmartConnStatus() {
  const btn = document.getElementById('btnDsmartConnStatusRefresh');
  const body = document.getElementById('dsmartConnStatusBody');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang kiểm tra...'; }
  body.innerHTML = `<tr><td colspan="5" class="p-3 text-center text-gray-400 italic">Đang kiểm tra...</td></tr>`;
  try {
    const res = await fetch('/api/dsmart-price/connections/status');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    const rows = [dsmartConnStatusRowHtml('🏢 HO (DSmart16 Trung Tâm)', '—', data.ho)]
      .concat((data.stores || []).map(s => dsmartConnStatusRowHtml(`🏬 ${s.storeCode} - ${s.storeName}`, `${s.host}:${s.port}/${s.database}`, s)));
    // storesError (12/2026, vá lỗi THẬT): lỗi đọc danh sách siêu thị (VD thiếu bảng CSDL) KHÔNG còn làm
    // mất luôn dòng HO ở trên — hiện thêm 1 dòng cảnh báo riêng, HO vẫn hiện đúng kết quả của nó.
    if (data.storesError) {
      rows.push(`<tr><td colspan="5" class="p-3 text-center text-red-500">⛔ Không đọc được danh sách siêu thị: ${escapeHtml(data.storesError)}</td></tr>`);
    }
    body.innerHTML = rows.join('');
    const checkedAtEl = document.getElementById('dsmartConnStatusCheckedAt');
    if (checkedAtEl) checkedAtEl.textContent = data.checkedAt ? `Kiểm tra lúc ${new Date(data.checkedAt).toLocaleString('vi-VN')}` : '';
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" class="p-3 text-center text-red-500">⛔ ${escapeHtml(err.message)}</td></tr>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Kiểm Tra Lại Tất Cả'; }
  }
}

async function renderDsmartStoreConnList() {
  try {
    const res = await fetch('/api/dsmart-price/store-connections');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    _dsmartStoreConnList = data.items || [];
  } catch (err) {
    document.getElementById('dsmartStoreConnBody').innerHTML = `<tr><td colspan="5" class="p-3 text-center text-red-500">⛔ ${escapeHtml(err.message)}</td></tr>`;
    return;
  }
  document.getElementById('dsmartStoreConnBody').innerHTML = _dsmartStoreConnList.map(s => `
    <tr>
      <td class="p-1.5 font-semibold">${escapeHtml(s.storeCode)}</td>
      <td class="p-1.5">${escapeHtml(s.storeName)}</td>
      <td class="p-1.5 text-gray-500">${escapeHtml(s.host)}:${s.port}/${escapeHtml(s.database)}</td>
      <td class="p-1.5"><input type="checkbox" ${s.enabled ? 'checked' : ''} data-op-change="toggleDsmartStoreConnEnabled" data-arg0="${s.id}" data-arg-el="1"></td>
      <td class="p-1.5 space-x-1 whitespace-nowrap">
        <button type="button" data-op="testDsmartStoreConn" data-arg0="${s.id}" class="bg-teal-50 border border-teal-300 text-teal-700 text-[10.5px] font-bold px-2 py-0.5 rounded">🔌 Kiểm Tra</button>
        <button type="button" data-op="startDsmartStoreConnEdit" data-arg0="${s.id}" class="bg-white border text-gray-700 text-[10.5px] font-bold px-2 py-0.5 rounded">✏️ Sửa</button>
        <button type="button" data-op="deleteDsmartStoreConn" data-arg0="${s.id}" class="bg-red-50 border border-red-300 text-red-700 text-[10.5px] font-bold px-2 py-0.5 rounded">🗑️ Xoá</button>
      </td>
    </tr>`).join('') || `<tr><td colspan="5" class="p-3 text-center text-gray-400 italic">Chưa cấu hình kết nối siêu thị nào — Thêm/Sửa/Xoá giá sẽ chỉ áp dụng ở DSmart16 Trung Tâm.</td></tr>`;
}

function dsmartStoreConnFormHtml(existing) {
  const isEdit = !!existing;
  return `
    <div class="text-xs font-bold text-gray-800 mb-2">${isEdit ? '✏️ Sửa' : '➕ Thêm'} Kết Nối Siêu Thị</div>
    <div class="flex flex-wrap gap-2 items-end">
      <div><label class="block text-[10px] text-gray-500 mb-0.5">Mã Siêu Thị</label><input id="dsmartStoreConnCode" value="${isEdit ? escapeHtml(existing.storeCode) : ''}" class="w-24 border rounded p-1 text-xs"></div>
      <div><label class="block text-[10px] text-gray-500 mb-0.5">Tên Siêu Thị</label><input id="dsmartStoreConnName" value="${isEdit ? escapeHtml(existing.storeName) : ''}" class="w-36 border rounded p-1 text-xs"></div>
      <div><label class="block text-[10px] text-gray-500 mb-0.5">Host</label><input id="dsmartStoreConnHost" value="${isEdit ? escapeHtml(existing.host) : ''}" class="w-32 border rounded p-1 text-xs"></div>
      <div><label class="block text-[10px] text-gray-500 mb-0.5">Port</label><input id="dsmartStoreConnPort" type="number" value="${isEdit ? existing.port : 1433}" class="w-16 border rounded p-1 text-xs"></div>
      <div><label class="block text-[10px] text-gray-500 mb-0.5">Tên CSDL</label><input id="dsmartStoreConnDatabase" value="${isEdit ? escapeHtml(existing.database) : ''}" class="w-28 border rounded p-1 text-xs"></div>
      <div><label class="block text-[10px] text-gray-500 mb-0.5">Tài khoản SQL</label><input id="dsmartStoreConnUser" value="${isEdit ? escapeHtml(existing.user) : ''}" class="w-28 border rounded p-1 text-xs"></div>
      <div><label class="block text-[10px] text-gray-500 mb-0.5">Mật khẩu${isEdit ? ' (để trống=giữ cũ)' : ''}</label><input id="dsmartStoreConnPassword" type="password" class="w-28 border rounded p-1 text-xs"></div>
      <button type="button" data-op="saveDsmartStoreConn" class="bg-green-600 text-white px-3 py-1 rounded text-xs font-bold">💾 Lưu</button>
      <button type="button" data-op="cancelDsmartStoreConnForm" class="bg-white border px-3 py-1 rounded text-xs font-semibold">Huỷ</button>
    </div>`;
}

function toggleDsmartStoreConnAddForm() {
  _dsmartStoreConnEditingId = null;
  const wrap = document.getElementById('dsmartStoreConnFormWrap');
  const willShow = wrap.classList.contains('hidden');
  wrap.innerHTML = willShow ? dsmartStoreConnFormHtml(null) : '';
  wrap.classList.toggle('hidden', !willShow);
}

function startDsmartStoreConnEdit(id) {
  id = Number(id);
  const existing = _dsmartStoreConnList.find(s => s.id === id);
  if (!existing) return;
  _dsmartStoreConnEditingId = id;
  const wrap = document.getElementById('dsmartStoreConnFormWrap');
  wrap.innerHTML = dsmartStoreConnFormHtml(existing);
  wrap.classList.remove('hidden');
}

function cancelDsmartStoreConnForm() {
  _dsmartStoreConnEditingId = null;
  const wrap = document.getElementById('dsmartStoreConnFormWrap');
  wrap.classList.add('hidden');
  wrap.innerHTML = '';
}

async function saveDsmartStoreConn() {
  const storeCode = document.getElementById('dsmartStoreConnCode').value.trim();
  const storeName = document.getElementById('dsmartStoreConnName').value.trim();
  const host = document.getElementById('dsmartStoreConnHost').value.trim();
  const port = Number(document.getElementById('dsmartStoreConnPort').value) || 1433;
  const database = document.getElementById('dsmartStoreConnDatabase').value.trim();
  const user = document.getElementById('dsmartStoreConnUser').value.trim();
  const password = document.getElementById('dsmartStoreConnPassword').value;
  if (!storeCode || !storeName || !host || !database || !user) return alert('⛔ Thiếu Mã Siêu Thị/Tên/Host/Tên CSDL/Tài khoản');
  if (!_dsmartStoreConnEditingId && !password) return alert('⛔ Thiếu mật khẩu (bắt buộc khi thêm kết nối mới)');
  try {
    const isEdit = !!_dsmartStoreConnEditingId;
    const existing = isEdit ? _dsmartStoreConnList.find(s => s.id === _dsmartStoreConnEditingId) : null;
    const url = isEdit ? `/api/dsmart-price/store-connections/${_dsmartStoreConnEditingId}` : '/api/dsmart-price/store-connections';
    const res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeCode, storeName, host, port, database, user, password: password || undefined, enabled: isEdit ? existing.enabled : true })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    alert(isEdit ? '✅ Đã sửa kết nối siêu thị' : '✅ Đã thêm kết nối siêu thị');
    cancelDsmartStoreConnForm();
    await renderDsmartStoreConnList();
  } catch (err) { alert('⛔ ' + err.message); }
}

async function deleteDsmartStoreConn(id) {
  id = Number(id);
  const existing = _dsmartStoreConnList.find(s => s.id === id);
  if (!existing) return;
  if (!confirm(`Xác nhận xoá kết nối siêu thị "${existing.storeName}" (${existing.storeCode})? Các lần Thêm/Sửa/Xoá giá SAU đó sẽ không còn đồng bộ xuống siêu thị này nữa.`)) return;
  try {
    const res = await fetch(`/api/dsmart-price/store-connections/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    await renderDsmartStoreConnList();
  } catch (err) { alert('⛔ ' + err.message); }
}

async function toggleDsmartStoreConnEnabled(id, el) {
  id = Number(id);
  const existing = _dsmartStoreConnList.find(s => s.id === id);
  if (!existing) return;
  const enabled = el.checked;
  try {
    const res = await fetch(`/api/dsmart-price/store-connections/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeCode: existing.storeCode, storeName: existing.storeName, host: existing.host, port: existing.port, database: existing.database, user: existing.user, enabled })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    await renderDsmartStoreConnList();
  } catch (err) {
    el.checked = !enabled; // hoàn tác trạng thái tick nếu lưu lỗi
    alert('⛔ ' + err.message);
  }
}

async function testDsmartStoreConn(id) {
  id = Number(id);
  try {
    const res = await fetch(`/api/dsmart-price/store-connections/${id}/test-connection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    alert(`✅ Kết nối thành công (${data.ms}ms)`);
  } catch (err) { alert('⛔ ' + err.message); }
}

// toggleDsmartStoreConnImportForm()/onDsmartStoreConnImportFileChange()/applyDsmartStoreConnImport()
// (12/2026, theo yêu cầu người dùng: "vì nó sẽ có rất nhiều siêu thị thì cho phép tôi có tải file mẫu
// và upload file mẫu được không") — cùng khuôn "1. Thêm Giá Mới" (file mẫu cố định cột, xem trước
// THÊM MỚI/SỬA trước khi ghi thật) ngay dưới, qua lib/dsmartStoreConnectionFileParser.js + 3 route
// /store-connections/template|preview|import ở routes/dsmartWholesalePrice.js.
function toggleDsmartStoreConnImportForm() {
  const wrap = document.getElementById('dsmartStoreConnImportFormWrap');
  const willShow = wrap.classList.contains('hidden');
  wrap.classList.toggle('hidden', !willShow);
  if (willShow) return;
  // Đóng lại: dọn trạng thái xem trước cũ, không để sót dữ liệu (kể cả mật khẩu chữ thường) trong biến JS.
  _dsmartStoreConnImportRows = null;
  _dsmartStoreConnImportFileName = null;
  document.getElementById('dsmartStoreConnImportPreviewWrap').classList.add('hidden');
  clearSingleFileInput('dsmartStoreConnImportFileInput', 'dsmartStoreConnImportFileName');
}

function clickDsmartStoreConnImportFileInput() { document.getElementById('dsmartStoreConnImportFileInput').click(); }

async function onDsmartStoreConnImportFileChange(event) {
  onSingleFileChosen(event.target, 'dsmartStoreConnImportFileName');
  const file = event.target.files[0];
  _dsmartStoreConnImportRows = null;
  _dsmartStoreConnImportFileName = null;
  document.getElementById('dsmartStoreConnImportPreviewWrap').classList.add('hidden');
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/dsmart-price/store-connections/preview', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    _dsmartStoreConnImportRows = data.rows;
    _dsmartStoreConnImportFileName = data.fileName;
    document.getElementById('dsmartStoreConnImportPreviewWrap').classList.remove('hidden');
    renderDsmartStoreConnImportPreview();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

function dsmartStoreConnImportModeBadge(r) {
  if (r.errors.length) return `<span class="bg-red-50 text-red-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">⛔ ${escapeHtml(r.errors.join('; '))}</span>`;
  if (r.mode === 'UPDATE') return `<span class="bg-amber-50 text-amber-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">✏️ Sẽ SỬA (đã có Mã Siêu Thị)</span>`;
  return `<span class="bg-emerald-50 text-emerald-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">✅ Sẽ thêm mới</span>`;
}

function renderDsmartStoreConnImportPreview() {
  if (!_dsmartStoreConnImportRows) return;
  const validCount = _dsmartStoreConnImportRows.filter(r => !r.errors.length).length;
  const createCount = _dsmartStoreConnImportRows.filter(r => r.mode === 'CREATE').length;
  const updateCount = _dsmartStoreConnImportRows.filter(r => r.mode === 'UPDATE').length;
  document.getElementById('dsmartStoreConnImportStats').innerText =
    `${_dsmartStoreConnImportRows.length} dòng trong file — ${validCount} hợp lệ (${createCount} thêm mới, ${updateCount} sửa)`;
  document.getElementById('dsmartStoreConnImportPreviewBody').innerHTML = _dsmartStoreConnImportRows.map((r, i) => `
    <tr class="${r.errors.length ? 'bg-red-50' : r.mode === 'UPDATE' ? 'bg-amber-50' : ''}">
      <td class="p-1.5 text-gray-400">${i + 1}</td>
      <td class="p-1.5 font-semibold">${escapeHtml(r.storeCode)}</td>
      <td class="p-1.5">${escapeHtml(r.storeName)}</td>
      <td class="p-1.5 text-gray-500">${escapeHtml(r.host)}:${r.port}/${escapeHtml(r.database)}</td>
      <td class="p-1.5">${escapeHtml(r.user)}</td>
      <td class="p-1.5">${dsmartStoreConnImportModeBadge(r)}</td>
    </tr>`).join('') || `<tr><td colspan="6" class="p-3 text-center text-gray-400 italic">Không có dòng nào</td></tr>`;
}

async function applyDsmartStoreConnImport() {
  if (!_dsmartStoreConnImportRows) return;
  const validRows = _dsmartStoreConnImportRows.filter(r => !r.errors.length);
  if (!validRows.length) return alert('⛔ Không có dòng hợp lệ nào để nhập');
  const createCount = validRows.filter(r => r.mode === 'CREATE').length;
  const updateCount = validRows.filter(r => r.mode === 'UPDATE').length;
  if (!confirm(`Xác nhận NHẬP ${validRows.length} dòng kết nối siêu thị (${createCount} thêm mới, ${updateCount} sửa)? Mật khẩu từng dòng sẽ được mã hoá ngay khi lưu vào hệ thống.`)) return;
  const btn = document.getElementById('btnDsmartStoreConnApplyImport');
  btn.disabled = true;
  try {
    const res = await fetch('/api/dsmart-price/store-connections/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: validRows, sourceFileName: _dsmartStoreConnImportFileName })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    if (data.failCount) {
      const failedRows = data.results.filter(r => !r.success);
      const errLines = failedRows.slice(0, 5).map(r => `• ${r.storeCode}: ${r.error}`).join('\n');
      const moreNote = failedRows.length > 5 ? `\n... và ${failedRows.length - 5} dòng lỗi khác (xem console)` : '';
      alert(`✅ Đã nhập ${data.successCount}/${validRows.length} dòng thành công, ${data.failCount} dòng lỗi:\n${errLines}${moreNote}`);
      console.error('Dòng lỗi khi nhập kết nối siêu thị:', failedRows);
    } else {
      alert(`✅ Đã nhập ${data.successCount}/${validRows.length} dòng thành công`);
    }
    _dsmartStoreConnImportRows = null;
    _dsmartStoreConnImportFileName = null;
    document.getElementById('dsmartStoreConnImportPreviewWrap').classList.add('hidden');
    clearSingleFileInput('dsmartStoreConnImportFileInput', 'dsmartStoreConnImportFileName');
    await renderDsmartStoreConnList();
  } catch (err) {
    alert('⛔ ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

// ===================== 1. Thêm Giá Mới =====================
// Thu gọn mặc định (12/2026, theo yêu cầu người dùng: "ấn nút Thêm Giá Mới mới mở ra") — cùng khuôn
// toggle đã dùng cho 3 bộ lọc bên dưới trong CHÍNH file này, không cần gác quyền riêng ở đây (cả màn đã
// gác itSupportPriceWriteDsmart từ server, xem initDsmartPriceTab() không có bước kiểm tra quyền nào
// khác ngoài #btnDsmartPriceConfig vốn chỉ dành riêng cho admin).
function applyDsmartPriceAddFormState() {
  document.getElementById('dsmartPriceAddFormWrap').classList.toggle('hidden', _dsmartPriceAddFormCollapsed);
  const btn = document.getElementById('btnDsmartPriceAddToggle');
  if (btn) btn.textContent = _dsmartPriceAddFormCollapsed ? '➕ Thêm Giá Mới' : '✕ Đóng';
}
function toggleDsmartPriceAddForm() { _dsmartPriceAddFormCollapsed = !_dsmartPriceAddFormCollapsed; applyDsmartPriceAddFormState(); }

function clickDsmartPriceFileInput() { document.getElementById('dsmartPriceFileInput').click(); }

function applyDsmartPriceUploadFilterState() {
  document.getElementById('dsmartPriceUploadFilterPanel').classList.toggle('hidden', _dsmartPriceUploadFilterCollapsed);
  const btn = document.getElementById('btnToggleDsmartPriceUploadFilter');
  if (btn) btn.textContent = _dsmartPriceUploadFilterCollapsed ? '🔍 Hiện Bộ Lọc' : '➖ Ẩn Bộ Lọc';
}
function toggleDsmartPriceUploadFilter() { _dsmartPriceUploadFilterCollapsed = !_dsmartPriceUploadFilterCollapsed; applyDsmartPriceUploadFilterState(); }

async function onDsmartPriceFileChange(event) {
  onSingleFileChosen(event.target, 'dsmartPriceFileName');
  const file = event.target.files[0];
  _dsmartPriceUploadRows = null;
  _dsmartPriceUploadFileName = null;
  document.getElementById('dsmartPriceUploadPreviewWrap').classList.add('hidden');
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/dsmart-price/preview', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    _dsmartPriceUploadRows = data.rows;
    _dsmartPriceUploadFileName = data.fileName;
    document.getElementById('dsmartPriceUploadPreviewWrap').classList.remove('hidden');
    renderDsmartPriceUploadPreview();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

function dsmartPriceFmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// dsmartPriceFmtDateTime(iso) (12/2026, cờ retry lastAutoDeleteAt/lastAutoApplyAt) — khác dsmartPriceFmtDate()
// ở trên (chỉ nhận chuỗi NGÀY "yyyy-mm-dd" thuần), hàm này nhận TIMESTAMP ISO đầy đủ (new Date().toISOString())
// và hiện kèm giờ:phút theo giờ máy người xem (đủ để biết "lần thử gần nhất" cách đây bao lâu).
function dsmartPriceFmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// dsmartPriceStoreResultsSummary()/dsmartPriceAggregateStoreSummary() (12/2026, FAN-OUT) — tóm tắt kết
// quả đồng bộ xuống TỪNG siêu thị để nối thêm vào alert sau Thêm/Sửa/Xoá giá — xem fanOutToStores()/
// lib/dsmartSqlClient.js. storeResults rỗng (không phải undefined) nghĩa là ĐÃ fan-out nhưng chưa cấu
// hình siêu thị nào (khác hẳn undefined = route cũ/stub test không trả field này).
function dsmartPriceStoreResultsSummary(storeResults, storeFanOutError) {
  if (storeFanOutError) return `\n⚠️ Đồng bộ siêu thị: ${storeFanOutError}`;
  if (!storeResults) return '';
  if (!storeResults.length) return '\n(Chưa cấu hình kết nối siêu thị nào — chỉ ghi ở DSmart16 Trung Tâm)';
  const failed = storeResults.filter(r => !r.ok);
  if (!failed.length) return `\n✅ Đồng bộ ${storeResults.length}/${storeResults.length} siêu thị thành công`;
  const lines = failed.slice(0, 5).map(r => `• ${r.storeCode} (${r.storeName}): ${r.error}`).join('\n');
  const more = failed.length > 5 ? `\n... và ${failed.length - 5} siêu thị lỗi khác (xem console)` : '';
  if (failed.length > 5) console.error('Siêu thị đồng bộ lỗi:', failed);
  return `\n⚠️ Đồng bộ siêu thị: ${storeResults.length - failed.length}/${storeResults.length} thành công, ${failed.length} lỗi:\n${lines}${more}`;
}

// dsmartPriceAggregateStoreSummary(results): dùng cho thao tác NHIỀU dòng cùng lúc (Thêm hàng loạt qua
// file, Xoá hàng loạt) — gộp storeResults của TẤT CẢ dòng thành công thành 1 dòng tóm tắt theo SIÊU THỊ
// (không lặp lại y nguyên từng dòng, dễ rối nếu có nhiều dòng cùng lỗi 1 siêu thị).
function dsmartPriceAggregateStoreSummary(perRowResults) {
  const flat = perRowResults.filter(r => r.success).flatMap(r => r.storeResults || []);
  const fanOutErrorCount = perRowResults.filter(r => r.success && r.storeFanOutError).length;
  if (!flat.length && !fanOutErrorCount) return '';
  const failed = flat.filter(s => !s.ok);
  let line = `\nĐồng bộ siêu thị: ${flat.length - failed.length}/${flat.length} lượt ghi thành công`;
  if (failed.length) {
    const byStore = new Map();
    for (const f of failed) {
      if (!byStore.has(f.storeCode)) byStore.set(f.storeCode, { storeName: f.storeName, count: 0, error: f.error });
      byStore.get(f.storeCode).count++;
    }
    const lines = [...byStore.entries()].slice(0, 5).map(([code, v]) => `• ${code} (${v.storeName}): ${v.count} lượt lỗi — ${v.error}`).join('\n');
    line += `\n${lines}`;
  }
  if (fanOutErrorCount) line += `\n⚠️ ${fanOutErrorCount} dòng không đọc được danh sách kết nối siêu thị`;
  return line;
}

function renderDsmartPriceUploadPreview() {
  if (!_dsmartPriceUploadRows) return;
  const custKw = (document.getElementById('dsmartPriceUploadFilterCust')?.value || '').trim().toLowerCase();
  const skuKw = (document.getElementById('dsmartPriceUploadFilterSku')?.value || '').trim().toLowerCase();
  const filtered = _dsmartPriceUploadRows.filter(r =>
    (!custKw || r.custId.toLowerCase().includes(custKw)) && (!skuKw || r.skuId.toLowerCase().includes(skuKw)));
  const validCount = _dsmartPriceUploadRows.filter(r => !r.errors.length).length;
  const overlapCount = _dsmartPriceUploadRows.filter(r => r.hasOverlap).length;
  // custIdNeverSeen (12/2026, LỖI THẬT PRODUCTION — xem routes/dsmartWholesalePrice.js::annotateNewCustIds()):
  // cảnh báo MỀM nếu Mã Khách B2B CHƯA TỪNG có trong CSPRICE thật — dễ là nhập nhầm mã khách, khiến giá
  // KHÔNG BAO GIỜ áp đúng chỗ (phiếu bán buôn tra giá khoá chặt theo CUST_ID, không liên quan gì tới mã
  // khác). KHÔNG chặn cứng (khách hàng MỚI hoàn toàn vẫn hợp lệ) — chỉ nhắc kiểm tra kỹ + bắt xác nhận
  // thêm 1 bước trước khi Ghi (applyDsmartPriceUpload()).
  const newCustCount = _dsmartPriceUploadRows.filter(r => r.custIdNeverSeen).length;
  document.getElementById('dsmartPriceUploadStats').innerText =
    `${_dsmartPriceUploadRows.length} dòng trong file — ${validCount} hợp lệ`
    + (overlapCount ? `, ${overlapCount} dòng SẼ GHI ĐÈ giá đang có (trùng Mã Khách B2B + Mã Sản Phẩm)` : '')
    + (newCustCount ? `, ⚠️ ${newCustCount} dòng có Mã Khách B2B CHƯA TỪNG xuất hiện trong DSmart — kiểm tra kỹ trước khi Ghi!` : '');
  document.getElementById('dsmartPriceUploadPreviewBody').innerHTML = filtered.map((r, i) => {
    let statusHtml;
    if (r.errors.length) statusHtml = `<span class="bg-red-50 text-red-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">⛔ ${escapeHtml(r.errors.join('; '))}</span>`;
    else if (r.custIdNeverSeen) statusHtml = `<span class="bg-purple-50 text-purple-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">🆕 Mã Khách B2B CHƯA từng có trong DSmart — kiểm tra lại!</span>`;
    else if (r.hasOverlap) statusHtml = `<span class="bg-amber-50 text-amber-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">⚠️ Sẽ GHI ĐÈ giá đang có</span>`;
    else statusHtml = `<span class="bg-emerald-50 text-emerald-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">✅ Sẽ thêm mới</span>`;
    return `<tr class="${r.errors.length ? 'bg-red-50' : r.custIdNeverSeen ? 'bg-purple-50' : r.hasOverlap ? 'bg-amber-50' : ''}">
      <td class="p-1.5 text-gray-400">${i + 1}</td>
      <td class="p-1.5">${escapeHtml(r.custId)}</td>
      <td class="p-1.5">${escapeHtml(r.skuId)}</td>
      <td class="p-1.5 text-right font-bold">${r.price != null ? Number(r.price).toLocaleString('vi-VN') : '—'}</td>
      <td class="p-1.5">${dsmartPriceFmtDate(r.frDate)}</td>
      <td class="p-1.5">${dsmartPriceFmtDate(r.toDate)}</td>
      <td class="p-1.5">${statusHtml}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="p-3 text-center text-gray-400 italic">Không có dòng nào khớp bộ lọc</td></tr>`;
}

async function applyDsmartPriceUpload() {
  if (!_dsmartPriceUploadRows) return;
  const validRows = _dsmartPriceUploadRows.filter(r => !r.errors.length);
  if (!validRows.length) return alert('⛔ Không có dòng hợp lệ nào để ghi');
  // Cảnh báo RIÊNG, thêm 1 lớp xác nhận trước khi hỏi xác nhận chung (12/2026, LỖI THẬT PRODUCTION — xem
  // chú thích đầy đủ tại routes/dsmartWholesalePrice.js::annotateNewCustIds()): nêu THẲNG danh sách Mã
  // Khách B2B chưa từng có trong DSmart để người dùng tự soát lại trước khi ghi thật — chỉ cảnh báo, không
  // chặn cứng (khách hàng MỚI hoàn toàn vẫn là tình huống hợp lệ, người dùng tự quyết định tiếp tục).
  const newCustIds = [...new Set(validRows.filter(r => r.custIdNeverSeen).map(r => r.custId))];
  if (newCustIds.length) {
    const shown = newCustIds.slice(0, 10).join(', ');
    const moreNote = newCustIds.length > 10 ? `, ... và ${newCustIds.length - 10} mã khác` : '';
    if (!confirm(`⚠️ ${newCustIds.length} Mã Khách B2B sau CHƯA TỪNG xuất hiện trong CSPRICE (DSmart16 Trung Tâm) trước đây:\n${shown}${moreNote}\n\nNếu đây KHÔNG đúng là mã khách THẬT của siêu thị/khách hàng cần đổi giá, giá sẽ KHÔNG áp dụng đúng chỗ. Bạn có CHẮC CHẮN các mã khách trên là ĐÚNG không?`)) return;
  }
  if (!confirm(`Xác nhận THÊM ${validRows.length} dòng giá MỚI vào CSPRICE (DSmart16 Trung Tâm)? Thao tác này ghi trực tiếp vào hệ thống bán hàng thật.`)) return;
  const schedule = !!document.getElementById('dsmartPriceScheduleApply')?.checked;
  const btn = document.getElementById('btnDsmartPriceApplyUpload');
  btn.disabled = true;
  try {
    const res = await fetch('/api/dsmart-price/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: validRows, sourceFileName: _dsmartPriceUploadFileName, sourceAction: 'UPLOAD', schedule, targetStoreIds: resolveDsmartPriceTargetStoreIds('dsmartPriceApplyStoreMultiSelect') })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    // LỖI THẬT đã vá (12/2026, người dùng báo "Team IT của tôi vừa up giá ghi vào dsmart nhưng lỗi" kèm
    // ảnh chụp MOBILE — alert cũ chỉ ghi "xem console", nhưng trên điện thoại KHÔNG có cách nào mở
    // DevTools để xem console, nên lỗi THẬT (server đã trả về đủ trong data.results[].error — xem
    // routes/dsmartWholesalePrice.js POST /apply) bị giấu kín hoàn toàn, người dùng chỉ thấy "0/1 dòng
    // thành công" mà không biết VÌ SAO). Nay hiện THẲNG nội dung lỗi thật của từng dòng ngay trong alert
    // (tối đa 5 dòng đầu, đủ cho hầu hết lượt upload thực tế — ít khi upload hàng trăm dòng lỗi cùng lúc)
    // — vẫn console.error() đầy đủ cho ai có DevTools, nhưng KHÔNG còn là cách DUY NHẤT để biết lý do.
    const overwrittenCount = data.results.filter(r => r.success && r.overwritten).length;
    const overwriteNote = overwrittenCount ? ` (trong đó ${overwrittenCount} dòng GHI ĐÈ giá đã có)` : '';
    const scheduledNote = data.scheduledCount ? ` (trong đó ${data.scheduledCount} dòng ĐÃ LÊN LỊCH, chưa áp dụng ngay — xem mục "2b. Giá Đã Lên Lịch")` : '';
    const storeNote = dsmartPriceAggregateStoreSummary(data.results);
    if (data.failCount) {
      const failedRows = data.results.filter(r => !r.success);
      const errLines = failedRows.slice(0, 5).map(r => `• ${r.custId}/${r.skuId}: ${r.error}`).join('\n');
      const moreNote = failedRows.length > 5 ? `\n... và ${failedRows.length - 5} dòng lỗi khác (xem console để biết đầy đủ)` : '';
      alert(`✅ Đã thêm ${data.successCount}/${validRows.length} dòng thành công${overwriteNote}${scheduledNote}, ${data.failCount} dòng lỗi:\n${errLines}${moreNote}${storeNote}`);
      console.error('Dòng lỗi khi thêm giá DSmart:', failedRows);
    } else {
      alert(`✅ Đã thêm ${data.successCount}/${validRows.length} dòng thành công${overwriteNote}${scheduledNote}${storeNote}`);
    }
    _dsmartPriceUploadRows = null;
    document.getElementById('dsmartPriceUploadPreviewWrap').classList.add('hidden');
    clearSingleFileInput('dsmartPriceFileInput', 'dsmartPriceFileName');
    await Promise.all([renderDsmartPriceEntries(), renderDsmartPriceHistory()]);
  } catch (err) {
    alert('⛔ ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

// ===================== 2. Quản Lý Giá Đã Hết Hạn =====================
function applyDsmartPriceMgFilterState() {
  document.getElementById('dsmartPriceMgFilterPanel').classList.toggle('hidden', _dsmartPriceMgFilterCollapsed);
  const btn = document.getElementById('btnToggleDsmartPriceMgFilter');
  if (btn) btn.textContent = _dsmartPriceMgFilterCollapsed ? '🔍 Hiện Bộ Lọc' : '➖ Ẩn Bộ Lọc';
}
function toggleDsmartPriceMgFilter() { _dsmartPriceMgFilterCollapsed = !_dsmartPriceMgFilterCollapsed; applyDsmartPriceMgFilterState(); }

// dsmartPriceRetryErrorBadge(error, at) (12/2026, theo yêu cầu người dùng: "nếu bị lỗi mạng ấy, thì cho
// phép chạy lại, try to set lại đến lúc nào xong thì thôi... có cái cờ kiểm tra trạng thái") — hiện rõ
// lần thử tự động gần nhất bị lỗi gì (job vẫn tự thử lại ở lượt chạy kế tiếp, 10 phút sau, không cần thao
// tác gì thêm) — dùng chung cho cả "2. Quản Lý Giá Đã Hết Hạn" (lastAutoDeleteError/At) và "2b. Giá Đã
// Lên Lịch" (lastAutoApplyError/At).
function dsmartPriceRetryErrorBadge(error, at) {
  if (!error) return '';
  const atText = at ? dsmartPriceFmtDateTime(at) : '';
  return `<div class="mt-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">⚠️ Lần thử gần nhất lỗi${atText ? ` lúc ${atText}` : ''}: ${escapeHtml(error)} — đang tự động thử lại</div>`;
}

function dsmartPriceEntryStatusBadge(e) {
  if (e.status === 'DELETED') return `<span class="bg-gray-100 text-gray-600 text-[10.5px] font-bold px-2 py-0.5 rounded-full">🗑️ Đã xoá ${dsmartPriceFmtDate((e.deletedAt || '').slice(0, 10))}</span>`;
  const today = new Date().toISOString().slice(0, 10);
  if (e.toDate < today) {
    const days = Math.round((new Date(today) - new Date(e.toDate)) / 86400000);
    return `<span class="bg-red-50 text-red-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">⏰ Đã hết hạn ${days} ngày</span>`;
  }
  if (e.frDate > today) return `<span class="bg-blue-50 text-blue-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">🔵 Sắp áp dụng</span>`;
  return `<span class="bg-emerald-50 text-emerald-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">🟢 Đang áp dụng</span>`;
}

// onDsmartPriceEntriesFilterChange() (12/2026, theo yêu cầu người dùng "nhớ phân trang ở hai mục Quản
// Lý lịch sử và Lịch sử thao tác") — đổi bất kỳ bộ lọc nào ở mục "2. Quản Lý Giá Đã Hết Hạn" phải tự
// lùi về trang 1 (nếu không, đang đứng trang 3 rồi gõ lọc còn 1 trang sẽ thấy bảng trống khó hiểu) —
// cùng khuôn onUserFilterChange() (module-admin-userstaging.js).
function onDsmartPriceEntriesFilterChange() {
  resetListPage('dsmartPriceEntries');
  renderDsmartPriceEntries();
}
async function renderDsmartPriceEntries() {
  try {
    const res = await fetch('/api/dsmart-price/entries');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    _dsmartPriceEntries = data.items || [];
  } catch (err) {
    document.getElementById('dsmartPriceEntriesBody').innerHTML = `<tr><td colspan="8" class="p-3 text-center text-red-500">⛔ ${escapeHtml(err.message)}</td></tr>`;
    return;
  }
  renderDsmartPriceScheduled();
  const onlyExpired = document.getElementById('dsmartPriceMgOnlyExpired')?.checked;
  const custKw = (document.getElementById('dsmartPriceMgFilterCust')?.value || '').trim().toLowerCase();
  const skuKw = (document.getElementById('dsmartPriceMgFilterSku')?.value || '').trim().toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  // Mục này CHỈ quản lý dòng ACTIVE (đang thật trong CSPRICE)/DELETED (đã xoá) — dòng SCHEDULED (chưa ghi
  // gì, xem mục "2b. Giá Đã Lên Lịch")/CANCELLED (đã hủy lịch) KHÔNG thuộc phạm vi mục này (12/2026, FAN-
  // OUT + Lên Lịch Áp Giá — nếu không loại trừ, badge/nút "Sửa"/"Dùng Lại" ở dưới sẽ hiểu sai 2 trạng thái
  // mới này vì chúng chưa từng tồn tại khi logic đó được viết).
  let list = [..._dsmartPriceEntries].filter(e => e.status === 'ACTIVE' || e.status === 'DELETED')
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (onlyExpired) list = list.filter(e => e.status === 'DELETED' || e.toDate < today);
  if (custKw) list = list.filter(e => e.custId.toLowerCase().includes(custKw));
  if (skuKw) list = list.filter(e => e.skuId.toLowerCase().includes(skuKw));

  // Phân trang (12/2026, theo yêu cầu người dùng) — dùng chung paginateList()/buildPaginationBoxHTML()
  // (core.js). CHÚ Ý: checkbox chọn dòng để "🗑️ Áp Dụng Xoá Đã Chọn" chỉ còn tác dụng trên các dòng đang
  // hiện ở TRANG hiện tại (đúng hành vi chuẩn mọi bảng phân trang khác trong hệ thống — không giữ lựa
  // chọn xuyên trang, khác hẳn renderUserBulkPeoplePicker() vốn CHỦ Ý dùng ô chọn-nhiều-người riêng
  // không phụ thuộc bảng, xem module-admin-permgroups.js).
  document.getElementById('paginationContainer_dsmartPriceEntries').innerHTML = buildPaginationBoxHTML('dsmartPriceEntries', 'renderDsmartPriceEntries');
  list = paginateList('dsmartPriceEntries', list, 'renderDsmartPriceEntries', 'dòng giá');

  document.getElementById('dsmartPriceEntriesBody').innerHTML = list.map(e => {
    const isActive = e.status === 'ACTIVE';
    const isExpiredNotDeleted = isActive && e.toDate < today;
    const note = isActive
      ? `Nộp ${dsmartPriceFmtDate((e.createdAt || '').slice(0, 10))} bởi ${escapeHtml(e.createdBy || '—')}`
      : `Xoá bởi ${escapeHtml(e.deletedBy || 'hệ thống tự động')}`;
    // Nút "🗑️ Xoá" cho dòng ĐANG ACTIVE (12/2026, theo yêu cầu người dùng — trước đây dòng active CHỈ có
    // nút Sửa, không có cách nào xoá sớm được dù chưa hết hạn, phải đợi qua Ngày Kết Thúc mới tick xoá
    // hàng loạt được ở mục 2) — xác nhận 2 LỚP nếu giá đang THẬT SỰ áp dụng tại quầy (FR_DATE<=hôm nay<=
    // TO_DATE), chỉ 1 lớp nếu chưa tới hiệu lực (🔵 Sắp áp dụng, chưa ai dùng thật).
    const actions = isActive
      ? `<button type="button" data-op="startDsmartPriceEdit" data-arg0="${e.id}" class="bg-white border text-gray-700 text-[10.5px] font-bold px-2 py-0.5 rounded">✏️ Sửa</button>`
        + ` <button type="button" data-op="deleteDsmartPriceActiveEntry" data-arg0="${e.id}" class="bg-red-50 border border-red-300 text-red-700 text-[10.5px] font-bold px-2 py-0.5 rounded">🗑️ Xoá</button>`
        + (e.toDate >= today && e.frDate <= today ? `<span class="block text-[9.5px] text-red-600 mt-0.5">⚠️ Giá đang áp dụng tại quầy</span>` : '')
      : `<button type="button" data-op="startDsmartPriceReuse" data-arg0="${e.id}" class="bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10.5px] font-bold px-2 py-0.5 rounded">↩️ Dùng Lại</button>`;
    return `<tr class="${isActive ? '' : 'opacity-60'}">
      <td class="p-1.5">${isExpiredNotDeleted ? `<input type="checkbox" class="dsmartPriceDeleteCheck" value="${e.id}" data-op-change="updateDsmartPriceDeleteSelectedButtonState" checked>` : ''}</td>
      <td class="p-1.5">${escapeHtml(e.custId)}</td>
      <td class="p-1.5">${escapeHtml(e.skuId)}</td>
      <td class="p-1.5 text-right">${Number(e.price).toLocaleString('vi-VN')}</td>
      <td class="p-1.5">${dsmartPriceFmtDate(e.frDate)} → ${dsmartPriceFmtDate(e.toDate)}</td>
      <td class="p-1.5">${dsmartPriceEntryStatusBadge(e)}</td>
      <td class="p-1.5 text-gray-400">${note}${dsmartPriceRetryErrorBadge(e.lastAutoDeleteError, e.lastAutoDeleteAt)}</td>
      <td class="p-1.5">${actions}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="p-3 text-center text-gray-400 italic">Không có dòng nào khớp</td></tr>`;
  document.getElementById('dsmartPriceEditForm').classList.add('hidden');
  _dsmartPriceEditingId = null;
  updateDsmartPriceDeleteSelectedButtonState();
}

// updateDsmartPriceDeleteSelectedButtonState() (12/2026, theo phản hồi người dùng — nút "🗑️ Áp Dụng Xoá
// Đã Chọn" lúc nào cũng hiện sẵn dù KHÔNG có ô tích nào trên trang (ô tích CHỈ hiện cho dòng Đang Active
// nhưng ĐÃ QUA Ngày Kết Thúc — xem renderDsmartPriceEntries() — rất dễ gặp 0 dòng đủ điều kiện ở trang
// hiện tại, VD lọc "Chỉ hiện Đã hết hạn" chưa bật hoặc mọi dòng đang hiện đều chưa hết hạn/đã xoá rồi),
// gây cảm giác nút "trống", không rõ có thao tác được không. Giờ tự làm mờ + khoá nút khi KHÔNG có ô tích
// nào, và luôn hiện rõ số dòng đang chọn/tổng số đủ điều kiện ngay trên nút — gọi lại mỗi lần render bảng
// VÀ mỗi lần người dùng tự tích/bỏ tích 1 ô (qua data-op-change ở trên).
function updateDsmartPriceDeleteSelectedButtonState() {
  const btn = document.getElementById('btnDsmartPriceDeleteSelected');
  if (!btn) return;
  const total = document.querySelectorAll('.dsmartPriceDeleteCheck').length;
  const checked = document.querySelectorAll('.dsmartPriceDeleteCheck:checked').length;
  btn.disabled = total === 0;
  btn.classList.toggle('opacity-50', total === 0);
  btn.classList.toggle('cursor-not-allowed', total === 0);
  btn.textContent = total === 0
    ? '🗑️ Áp Dụng Xoá Đã Chọn (không có dòng nào đã hết hạn ở trang này)'
    : `🗑️ Áp Dụng Xoá Đã Chọn (${checked}/${total})`;
}

// ===================== 2b. Giá Đã Lên Lịch (chưa áp dụng) =====================
// renderDsmartPriceScheduled() (12/2026, "Lên Lịch Áp Giá") — tái dùng NGUYÊN _dsmartPriceEntries đã
// fetch trong renderDsmartPriceEntries() (gọi NGAY SAU khi fetch xong ở đó), không fetch lại GET /entries
// lần 2 — dòng SCHEDULED chỉ hiện ở ĐÚNG mục này, không lẫn vào mục "2. Quản Lý Giá Đã Hết Hạn" phía trên.
function renderDsmartPriceScheduled() {
  const list = _dsmartPriceEntries.filter(e => e.status === 'SCHEDULED').sort((a, b) => (a.frDate || '').localeCompare(b.frDate || ''));
  const countEl = document.getElementById('dsmartPriceScheduledCount');
  if (countEl) countEl.textContent = list.length ? `(${list.length})` : '';
  document.getElementById('dsmartPriceScheduledBody').innerHTML = list.map(e => `
    <tr>
      <td class="p-1.5">${escapeHtml(e.custId)}</td>
      <td class="p-1.5">${escapeHtml(e.skuId)}</td>
      <td class="p-1.5 text-right">${Number(e.price).toLocaleString('vi-VN')}</td>
      <td class="p-1.5">${dsmartPriceFmtDate(e.frDate)} → ${dsmartPriceFmtDate(e.toDate)}</td>
      <td class="p-1.5 text-gray-400">Tạo ${dsmartPriceFmtDate((e.createdAt || '').slice(0, 10))} bởi ${escapeHtml(e.createdBy || '—')}${dsmartPriceRetryErrorBadge(e.lastAutoApplyError, e.lastAutoApplyAt)}</td>
      <td class="p-1.5"><button type="button" data-op="cancelDsmartPriceSchedule" data-arg0="${e.id}" class="bg-red-50 border border-red-300 text-red-700 text-[10.5px] font-bold px-2 py-0.5 rounded">❌ Hủy Lịch</button></td>
    </tr>`).join('') || `<tr><td colspan="6" class="p-3 text-center text-gray-400 italic">Không có dòng nào đang chờ áp dụng</td></tr>`;
}

async function cancelDsmartPriceSchedule(id) {
  id = Number(id);
  const entry = _dsmartPriceEntries.find(e => e.id === id);
  if (!entry) return;
  if (!confirm(`Xác nhận hủy lịch áp giá ${escapeHtml(entry.custId)}/${escapeHtml(entry.skuId)}? Dòng này CHƯA từng ghi gì vào CSPRICE, hủy xong sẽ mất hẳn — cần Thêm Giá Mới lại từ đầu nếu muốn áp dụng.`)) return;
  try {
    const res = await fetch(`/api/dsmart-price/entries/${id}/cancel-schedule`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    await renderDsmartPriceEntries();
  } catch (err) { alert('⛔ ' + err.message); }
}

// ----- Sửa (UPDATE dòng chưa xoá) -----
function startDsmartPriceEdit(id) {
  id = Number(id);
  const entry = _dsmartPriceEntries.find(e => e.id === id);
  if (!entry) return;
  _dsmartPriceEditingId = id;
  _dsmartPriceReusingEntry = null;
  document.getElementById('dsmartPriceReuseForm').classList.add('hidden');
  const form = document.getElementById('dsmartPriceEditForm');
  form.innerHTML = `
    <div class="text-xs font-bold text-sky-800 mb-2">✏️ Đang sửa dòng: ${escapeHtml(entry.custId)} / ${escapeHtml(entry.skuId)} — cập nhật đúng dòng này trong DSmart</div>
    <div class="flex flex-wrap gap-3 items-end">
      <div><label class="block text-[10px] text-gray-500 mb-0.5">Giá mới</label><input id="dsmartPriceEditPrice" type="number" value="${entry.price}" class="w-28 border rounded p-1 text-xs"></div>
      <div><label class="block text-[10px] text-gray-500 mb-0.5">Ngày bắt đầu</label><input id="dsmartPriceEditFrDate" type="date" value="${entry.frDate}" class="border rounded p-1 text-xs"></div>
      <div><label class="block text-[10px] text-gray-500 mb-0.5">Ngày kết thúc</label><input id="dsmartPriceEditToDate" type="date" value="${entry.toDate}" class="border rounded p-1 text-xs"></div>
      <button type="button" data-op="saveDsmartPriceEdit" class="bg-green-600 text-white px-3 py-1 rounded text-xs font-bold">💾 Lưu (ghi đè DSmart)</button>
      <button type="button" data-op="cancelDsmartPriceEdit" class="bg-white border px-3 py-1 rounded text-xs font-semibold">Huỷ</button>
    </div>`;
  form.classList.remove('hidden');
}
function cancelDsmartPriceEdit() { _dsmartPriceEditingId = null; document.getElementById('dsmartPriceEditForm').classList.add('hidden'); }

async function saveDsmartPriceEdit() {
  if (!_dsmartPriceEditingId) return;
  const price = Number(document.getElementById('dsmartPriceEditPrice').value);
  const frDate = document.getElementById('dsmartPriceEditFrDate').value;
  const toDate = document.getElementById('dsmartPriceEditToDate').value;
  if (!Number.isFinite(price) || price < 0 || !frDate || !toDate || frDate > toDate) return alert('⛔ Giá/ngày không hợp lệ');
  if (!confirm('Xác nhận GHI ĐÈ giá/ngày của đúng dòng này trong DSmart16 Trung Tâm?')) return;
  try {
    const res = await fetch(`/api/dsmart-price/entries/${_dsmartPriceEditingId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price, frDate, toDate })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    alert('✅ Đã sửa giá thành công' + dsmartPriceStoreResultsSummary(data.storeResults, data.storeFanOutError));
    await Promise.all([renderDsmartPriceEntries(), renderDsmartPriceHistory()]);
  } catch (err) { alert('⛔ ' + err.message); }
}

// ----- Xoá sớm dòng ĐANG ACTIVE (12/2026, theo yêu cầu người dùng) — trước đây mục "Quản Lý Giá Đã Hết
// Hạn" CHỈ cho tick xoá dòng đã QUA Ngày Kết Thúc, dòng còn hiệu lực chỉ Sửa được, không xoá sớm được dù
// cần (VD xoá dòng nhập nhầm/test). Xác nhận 2 LỚP riêng nếu giá đang THẬT SỰ áp dụng tại quầy ngay lúc
// này (an toàn hơn xoá hàng loạt — đây là xoá CHỦ Ý 1 dòng đang sống, không phải dọn dẹp dòng đã hết hạn).
async function deleteDsmartPriceActiveEntry(id) {
  id = Number(id);
  const entry = _dsmartPriceEntries.find(e => e.id === id);
  if (!entry) return;
  const today = new Date().toISOString().slice(0, 10);
  const isLiveNow = entry.frDate <= today && entry.toDate >= today;
  if (!confirm(`Xác nhận XOÁ THẬT giá ${escapeHtml(entry.custId)}/${escapeHtml(entry.skuId)} khỏi CSPRICE (DSmart16 Trung Tâm)? Không thể hoàn tác.`)) return;
  if (isLiveNow && !confirm('⚠️ XÁC NHẬN LẦN 2: giá này ĐANG ÁP DỤNG THẬT tại quầy ngay lúc này. Bạn CHẮC CHẮN muốn xoá ngay (không đợi hết hạn)?')) return;
  try {
    const res = await fetch(`/api/dsmart-price/entries/${id}/delete`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    alert('✅ Đã xoá thành công' + dsmartPriceStoreResultsSummary(data.storeResults, data.storeFanOutError));
    await Promise.all([renderDsmartPriceEntries(), renderDsmartPriceHistory()]);
  } catch (err) { alert('⛔ ' + err.message); }
}

// ----- Dùng Lại (INSERT dòng mới từ dữ liệu dòng đã xoá) -----
function startDsmartPriceReuse(id) {
  id = Number(id);
  const entry = _dsmartPriceEntries.find(e => e.id === id);
  if (!entry) return;
  _dsmartPriceReusingEntry = entry;
  _dsmartPriceEditingId = null;
  document.getElementById('dsmartPriceEditForm').classList.add('hidden');
  const form = document.getElementById('dsmartPriceReuseForm');
  form.innerHTML = `
    <div class="text-xs font-bold text-indigo-800 mb-2">📋 Dùng lại dòng đã xoá: ${escapeHtml(entry.custId)} / ${escapeHtml(entry.skuId)} — sẽ THÊM dòng MỚI (không đụng dòng đã xoá)</div>
    <div class="flex flex-wrap gap-3 items-end">
      <div><label class="block text-[10px] text-gray-500 mb-0.5">Mã Khách B2B</label><input value="${escapeHtml(entry.custId)}" disabled class="w-32 border rounded p-1 text-xs bg-gray-100"></div>
      <div><label class="block text-[10px] text-gray-500 mb-0.5">Mã Sản Phẩm</label><input value="${escapeHtml(entry.skuId)}" disabled class="w-32 border rounded p-1 text-xs bg-gray-100"></div>
      <div><label class="block text-[10px] text-gray-500 mb-0.5">Giá (điền sẵn, sửa được)</label><input id="dsmartPriceReusePrice" type="number" value="${entry.price}" class="w-28 border rounded p-1 text-xs"></div>
      <div><label class="block text-[10px] text-amber-700 font-bold mb-0.5">Ngày bắt đầu</label><input id="dsmartPriceReuseFrDate" type="date" class="border rounded p-1 text-xs"></div>
      <div><label class="block text-[10px] text-amber-700 font-bold mb-0.5">Ngày kết thúc</label><input id="dsmartPriceReuseToDate" type="date" class="border rounded p-1 text-xs"></div>
    </div>
    <div class="mt-2">
      <div class="text-[10px] font-bold text-sky-800 mb-0.5">🏬 Áp Dụng Cho Siêu Thị</div>
      <div id="dsmartPriceReuseStoreMultiSelect" class="w-full max-w-md"></div>
    </div>
    <div class="flex items-center gap-3 mt-2">
      <button type="button" data-op="saveDsmartPriceReuse" class="bg-green-600 text-white px-3 py-1 rounded text-xs font-bold">✅ Thêm Giá Mới</button>
      <button type="button" data-op="cancelDsmartPriceReuse" class="bg-white border px-3 py-1 rounded text-xs font-semibold">Huỷ</button>
    </div>`;
  form.classList.remove('hidden');
  const reuseItems = _dsmartPriceStoreOptions.map(s => ({ value: s.id, label: `${s.storeCode} - ${s.storeName}` }));
  renderMultiSelectDropdown('dsmartPriceReuseStoreMultiSelect', reuseItems, reuseItems.map(it => it.value), {
    placeholder: 'Tìm siêu thị...',
    emptyText: reuseItems.length ? 'Chưa chọn siêu thị nào — CHỈ ghi ở DSmart16 Trung Tâm.' : 'Chưa cấu hình/bật siêu thị nào.',
    allToggle: true
  });
}
function cancelDsmartPriceReuse() { _dsmartPriceReusingEntry = null; document.getElementById('dsmartPriceReuseForm').classList.add('hidden'); }

async function saveDsmartPriceReuse() {
  if (!_dsmartPriceReusingEntry) return;
  const price = Number(document.getElementById('dsmartPriceReusePrice').value);
  const frDate = document.getElementById('dsmartPriceReuseFrDate').value;
  const toDate = document.getElementById('dsmartPriceReuseToDate').value;
  if (!Number.isFinite(price) || price < 0 || !frDate || !toDate || frDate > toDate) return alert('⛔ Giá/ngày không hợp lệ');
  if (!confirm('Xác nhận THÊM dòng giá MỚI vào DSmart16 Trung Tâm?')) return;
  try {
    const res = await fetch('/api/dsmart-price/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{ custId: _dsmartPriceReusingEntry.custId, skuId: _dsmartPriceReusingEntry.skuId, price, frDate, toDate }], sourceAction: 'REUSE', targetStoreIds: resolveDsmartPriceTargetStoreIds('dsmartPriceReuseStoreMultiSelect') })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    if (!data.successCount) throw new Error(data.results?.[0]?.error || 'Ghi thất bại');
    const reuseStoreNote = dsmartPriceStoreResultsSummary(data.results?.[0]?.storeResults, data.results?.[0]?.storeFanOutError);
    alert((data.results?.[0]?.overwritten ? '✅ Đã GHI ĐÈ giá hiện có thành công (đã có dòng khác cho đúng Mã Khách B2B/Mã Sản Phẩm này)' : '✅ Đã thêm giá mới thành công') + reuseStoreNote);
    cancelDsmartPriceReuse();
    await Promise.all([renderDsmartPriceEntries(), renderDsmartPriceHistory()]);
  } catch (err) { alert('⛔ ' + err.message); }
}

// ----- Xoá hàng loạt (tick chọn các dòng Đã hết hạn) -----
async function applyDsmartPriceDeleteSelected() {
  const ids = Array.from(document.querySelectorAll('.dsmartPriceDeleteCheck:checked')).map(el => Number(el.value));
  if (!ids.length) return alert('⛔ Chưa chọn dòng nào để xoá');
  if (!confirm(`Xác nhận XOÁ THẬT ${ids.length} dòng khỏi CSPRICE (DSmart16 Trung Tâm)? Không thể hoàn tác.`)) return;
  let success = 0;
  const failMsgs = [];
  const allStoreResults = [];
  let fanOutErrorCount = 0;
  for (const id of ids) {
    try {
      const res = await fetch(`/api/dsmart-price/entries/${id}/delete`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      success++;
      if (data.storeResults) allStoreResults.push(...data.storeResults);
      if (data.storeFanOutError) fanOutErrorCount++;
    } catch (err) { failMsgs.push(err.message); console.error(`Xoá dòng ID=${id} lỗi:`, err.message); }
  }
  // Cùng lý do đã vá ở applyDsmartPriceUpload() ngay trên (12/2026) — hiện THẲNG lỗi thật, không chỉ "xem
  // console" (không dùng được trên mobile).
  let storeNote = '';
  if (allStoreResults.length) {
    const storeFailed = allStoreResults.filter(r => !r.ok);
    storeNote = `\nĐồng bộ siêu thị: ${allStoreResults.length - storeFailed.length}/${allStoreResults.length} lượt ghi thành công`;
    if (storeFailed.length) {
      const byStore = new Map();
      for (const f of storeFailed) {
        if (!byStore.has(f.storeCode)) byStore.set(f.storeCode, { storeName: f.storeName, count: 0, error: f.error });
        byStore.get(f.storeCode).count++;
      }
      storeNote += '\n' + [...byStore.entries()].slice(0, 5).map(([code, v]) => `• ${code} (${v.storeName}): ${v.count} lượt lỗi — ${v.error}`).join('\n');
    }
  }
  if (fanOutErrorCount) storeNote += `\n⚠️ ${fanOutErrorCount} dòng không đọc được danh sách kết nối siêu thị`;
  if (failMsgs.length) {
    const errLines = failMsgs.slice(0, 5).map(m => `• ${m}`).join('\n');
    const moreNote = failMsgs.length > 5 ? `\n... và ${failMsgs.length - 5} dòng lỗi khác (xem console để biết đầy đủ)` : '';
    alert(`✅ Đã xoá ${success}/${ids.length} dòng, ${failMsgs.length} dòng lỗi:\n${errLines}${moreNote}${storeNote}`);
  } else {
    alert(`✅ Đã xoá ${success}/${ids.length} dòng${storeNote}`);
  }
  await Promise.all([renderDsmartPriceEntries(), renderDsmartPriceHistory()]);
}

// ===================== Tự Động Xoá Khi Hết Hạn =====================
async function loadDsmartPriceAutoDeleteConfig() {
  try {
    const res = await fetch('/api/dsmart-price/auto-delete-config');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    document.getElementById('dsmartPriceAutoDeleteEnabled').checked = !!data.config.autoDeleteEnabled;
    document.getElementById('dsmartPriceAutoDeleteHour').value = data.config.autoDeleteHour;
    document.getElementById('dsmartPriceAutoDeleteMinute').value = data.config.autoDeleteMinute;
  } catch (err) { console.error('Không tải được Cấu Hình Tự Động Xoá:', err.message); }
}

async function saveDsmartPriceAutoDeleteConfig() {
  const autoDeleteEnabled = document.getElementById('dsmartPriceAutoDeleteEnabled').checked;
  const autoDeleteHour = Number(document.getElementById('dsmartPriceAutoDeleteHour').value);
  const autoDeleteMinute = Number(document.getElementById('dsmartPriceAutoDeleteMinute').value);
  try {
    const res = await fetch('/api/dsmart-price/auto-delete-config', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoDeleteEnabled, autoDeleteHour, autoDeleteMinute })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
  } catch (err) { alert('⛔ ' + err.message); }
}

// ===================== 3. Lịch Sử Thao Tác =====================
function applyDsmartPriceHistoryFilterState() {
  document.getElementById('dsmartPriceHistoryFilterPanel').classList.toggle('hidden', _dsmartPriceHistoryFilterCollapsed);
  const btn = document.getElementById('btnToggleDsmartPriceHistoryFilter');
  if (btn) btn.textContent = _dsmartPriceHistoryFilterCollapsed ? '🔍 Hiện Bộ Lọc' : '➖ Ẩn Bộ Lọc';
}
function toggleDsmartPriceHistoryFilter() { _dsmartPriceHistoryFilterCollapsed = !_dsmartPriceHistoryFilterCollapsed; applyDsmartPriceHistoryFilterState(); }

const DSMART_PRICE_ACTION_LABELS = {
  INSERT: '➕ Thêm giá', UPDATE: '✏️ Sửa giá', DELETE: '🗑️ Xoá giá'
};

// LỖI THẬT đã vá (12/2026, người dùng báo cột "Chi Tiết" hiện nhầm "Tick tay" ở dòng "+ Thêm giá") — Lần 5
// thêm 2 hành động/chế độ MỚI nhưng quên cập nhật 2 hàm dưới đây, khiến rơi vào nhánh mặc định dành cho
// Xoá tay: (1) `INSERT_OVERWRITE` (ghi đè giá do trùng CUST_ID+SKU_ID khi Thêm) — coi CÙNG nhóm với
// `INSERT` để Chi Tiết vẫn hiện đúng tên file/nguồn ghi, badge riêng "♻️ Ghi đè giá" để phân biệt Thêm mới
// thật sự; (2) `mode: 'AUTO_OVERWRITTEN'` (entry mirror CŨ bị tự động đánh dấu Xoá vì có entry khác ghi đè
// cùng cặp — xem routes/dsmartWholesalePrice.js) — ưu tiên hiện NGUYÊN VĂN `h.note` nếu có thay vì đoán
// theo mode, đúng ý nghĩa nhất cho người đọc lịch sử.
function dsmartPriceHistoryActionBadge(h) {
  if (h.action === 'DELETE' && h.mode === 'AUTO') return `<span class="bg-red-50 text-red-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">🔁 Tự động xoá hết hạn</span>`;
  if (h.action === 'DELETE' && h.mode === 'AUTO_OVERWRITTEN') return `<span class="bg-amber-50 text-amber-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">♻️ Bị ghi đè tự động</span>`;
  if (h.action === 'DELETE') return `<span class="bg-red-50 text-red-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">🗑️ Xoá giá hết hạn</span>`;
  if (h.action === 'UPDATE') return `<span class="bg-sky-50 text-sky-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">✏️ Sửa giá</span>`;
  if (h.action === 'INSERT_OVERWRITE') return `<span class="bg-amber-50 text-amber-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">♻️ Ghi đè giá</span>`;
  return `<span class="bg-indigo-50 text-indigo-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">${h.mode === 'REUSE' ? '↩️ Dùng lại' : '➕ Thêm giá'}</span>`;
}
function dsmartPriceHistoryDetail(h) {
  if (h.action === 'INSERT' || h.action === 'INSERT_OVERWRITE') return h.sourceFileName ? escapeHtml(h.sourceFileName) : 'Dùng lại từ dòng đã xoá';
  if (h.action === 'UPDATE') return `${Number(h.oldPrice).toLocaleString('vi-VN')} → ${Number(h.newPrice).toLocaleString('vi-VN')}`;
  if (h.note) return escapeHtml(h.note);
  return h.mode === 'AUTO' ? 'Tự động theo giờ đã đặt' : 'Tick tay';
}

// onDsmartPriceHistoryFilterChange() — cùng lý do/khuôn onDsmartPriceEntriesFilterChange() ở trên,
// riêng cho mục "3. Lịch Sử Thao Tác".
function onDsmartPriceHistoryFilterChange() {
  resetListPage('dsmartPriceHistory');
  renderDsmartPriceHistory();
}
async function renderDsmartPriceHistory() {
  let items;
  try {
    const res = await fetch('/api/dsmart-price/history');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    items = data.items || [];
  } catch (err) {
    document.getElementById('dsmartPriceHistoryBody').innerHTML = `<tr><td colspan="7" class="p-3 text-center text-red-500">⛔ ${escapeHtml(err.message)}</td></tr>`;
    return;
  }
  const custKw = (document.getElementById('dsmartPriceHistoryFilterCust')?.value || '').trim().toLowerCase();
  const skuKw = (document.getElementById('dsmartPriceHistoryFilterSku')?.value || '').trim().toLowerCase();
  let list = items;
  if (custKw) list = list.filter(h => h.custId.toLowerCase().includes(custKw));
  if (skuKw) list = list.filter(h => h.skuId.toLowerCase().includes(skuKw));

  // Phân trang (12/2026, theo yêu cầu người dùng) — cùng khuôn renderDsmartPriceEntries() ở trên.
  document.getElementById('paginationContainer_dsmartPriceHistory').innerHTML = buildPaginationBoxHTML('dsmartPriceHistory', 'renderDsmartPriceHistory');
  list = paginateList('dsmartPriceHistory', list, 'renderDsmartPriceHistory', 'dòng lịch sử');

  document.getElementById('dsmartPriceHistoryBody').innerHTML = list.map(h => {
    const canReuse = h.action === 'DELETE';
    const entry = canReuse ? _dsmartPriceEntries.find(e => e.id === h.entryId) : null;
    return `<tr>
      <td class="p-1.5">${h.at ? new Date(h.at).toLocaleString('vi-VN') : ''}</td>
      <td class="p-1.5">${escapeHtml(h.actor || 'Hệ thống (tự động)')}</td>
      <td class="p-1.5">${dsmartPriceHistoryActionBadge(h)}</td>
      <td class="p-1.5">${escapeHtml(h.custId)}</td>
      <td class="p-1.5">${escapeHtml(h.skuId)}</td>
      <td class="p-1.5 text-gray-500">${dsmartPriceHistoryDetail(h)}</td>
      <td class="p-1.5">${canReuse && entry ? `<button type="button" data-op="startDsmartPriceReuse" data-arg0="${h.entryId}" class="bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10.5px] font-bold px-2 py-0.5 rounded">↩️ Dùng Lại</button>` : ''}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="p-3 text-center text-gray-400 italic">Không có lịch sử nào khớp</td></tr>`;
}

// ===================== Cấu Hình Kết Nối (Admin) =====================
async function openDsmartPriceConfigModal() {
  try {
    const res = await fetch('/api/dsmart-price/config');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    document.getElementById('dsmartPriceCfgHost').value = data.config.host || '';
    document.getElementById('dsmartPriceCfgPort').value = data.config.port || 1433;
    document.getElementById('dsmartPriceCfgDatabase').value = data.config.database || '';
    document.getElementById('dsmartPriceCfgUser').value = data.config.user || '';
    document.getElementById('dsmartPriceCfgPassword').value = '';
    document.getElementById('dsmartPriceCfgPasswordHint').innerText = data.config.hasPassword ? '✅ Đã có mật khẩu lưu sẵn — để trống ô trên nếu không đổi.' : '⚠️ Chưa có mật khẩu nào được lưu.';
    const statusEl = document.getElementById('dsmartPriceCfgTestStatus');
    if (statusEl) { statusEl.className = 'text-xs'; statusEl.innerText = ''; }
    document.getElementById('dsmartPriceConfigModal').classList.remove('hidden');
  } catch (err) { alert('⛔ ' + err.message); }
}
function closeDsmartPriceConfigModal() { document.getElementById('dsmartPriceConfigModal').classList.add('hidden'); }

// testDsmartPriceConnection() — nút "🔌 Kiểm Tra Kết Nối" (12/2026, theo yêu cầu người dùng): dùng ĐÚNG
// giá trị đang gõ dở trên form (CHƯA cần bấm Lưu trước) để admin xác nhận kết nối được tới DSmart16
// Trung Tâm trước khi lưu thật — tránh lưu nhầm cấu hình sai rồi mới phát hiện lúc Thêm Giá Mới thật.
async function testDsmartPriceConnection() {
  const host = document.getElementById('dsmartPriceCfgHost').value.trim();
  const port = Number(document.getElementById('dsmartPriceCfgPort').value) || 1433;
  const database = document.getElementById('dsmartPriceCfgDatabase').value.trim();
  const user = document.getElementById('dsmartPriceCfgUser').value.trim();
  const password = document.getElementById('dsmartPriceCfgPassword').value;
  const statusEl = document.getElementById('dsmartPriceCfgTestStatus');
  const btn = document.getElementById('btnDsmartPriceTestConn');
  if (statusEl) { statusEl.className = 'text-xs text-gray-500'; statusEl.innerText = '⏳ Đang kiểm tra kết nối...'; }
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/dsmart-price/config/test-connection', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, database, user, password: password || null })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    if (statusEl) { statusEl.className = 'text-xs text-emerald-600 font-semibold'; statusEl.innerText = `✅ Kết nối thành công (${data.ms}ms)`; }
  } catch (err) {
    if (statusEl) { statusEl.className = 'text-xs text-red-600 font-semibold'; statusEl.innerText = '⛔ ' + err.message; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// testDsmartPriceSkuDefAccess() — nút "🔍 Kiểm Tra Quyền Đọc SKU_DEF" (12/2026, LỖI THẬT PRODUCTION LẦN 4:
// người dùng gửi mã nguồn phần mềm áp giá CŨ cho thấy CSPRICE cần tra thêm Đơn Vị Tính/Hệ Số Quy Đổi/Mã
// Thuế từ bảng dbo.SKU_DEF theo Mã Sản Phẩm — xem lib/dsmartSqlClient.js). SKU_DEF CÙNG CSDL DSmart16
// nhưng KHÁC bảng CSPRICE, cần quyền SELECT RIÊNG — nút này để đội IT tự xác nhận quyền đã đủ TRƯỚC khi
// thử ghi giá thật, dùng ĐÚNG giá trị đang gõ dở trên form, cùng khuôn testDsmartPriceConnection() ở trên.
async function testDsmartPriceSkuDefAccess() {
  const host = document.getElementById('dsmartPriceCfgHost').value.trim();
  const port = Number(document.getElementById('dsmartPriceCfgPort').value) || 1433;
  const database = document.getElementById('dsmartPriceCfgDatabase').value.trim();
  const user = document.getElementById('dsmartPriceCfgUser').value.trim();
  const password = document.getElementById('dsmartPriceCfgPassword').value;
  const statusEl = document.getElementById('dsmartPriceSkuDefAccessStatus');
  const btn = document.getElementById('btnDsmartPriceTestSkuDefAccess');
  if (statusEl) { statusEl.className = 'text-xs text-gray-500'; statusEl.innerText = '⏳ Đang kiểm tra quyền đọc SKU_DEF...'; }
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/dsmart-price/config/test-skudef-access', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, database, user, password: password || null })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    if (statusEl) { statusEl.className = 'text-xs text-emerald-600 font-semibold'; statusEl.innerText = `✅ Đọc được SKU_DEF (${data.ms}ms) — tài khoản đã đủ quyền để áp giá.`; }
  } catch (err) {
    if (statusEl) { statusEl.className = 'text-xs text-red-600 font-semibold'; statusEl.innerText = '⛔ ' + err.message; }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// inspectDsmartPriceCspriceTable() — nút "🔍 Kiểm Tra Cấu Trúc Bảng CSPRICE" (12/2026, LỖI THẬT
// PRODUCTION đã phát hiện 2 lần liên tiếp: lần 1 giả định "CSPRICE có cột ID tự tăng" SAI (lỗi "Invalid
// column name 'ID'."); lần 2 (ảnh chụp thật kết quả bấm nút này) xác nhận CSPRICE KHÔNG CÓ cột identity
// nào — hệ thống đã vá sang dùng "khoá tự nhiên" nhiều cột (xem lib/dsmartSqlClient.js). Nút này không
// cần bấm trước khi dùng bình thường — chỉ để đội IT/DBA TỰ XEM LẠI cấu trúc cột + mọi PRIMARY KEY/UNIQUE
// INDEX khai báo thật (nếu có) để đối chiếu với khoá tự nhiên hệ thống đang dùng, dùng ĐÚNG giá trị đang
// gõ dở trên form, cùng khuôn testDsmartPriceConnection() ở trên.
async function inspectDsmartPriceCspriceTable() {
  const host = document.getElementById('dsmartPriceCfgHost').value.trim();
  const port = Number(document.getElementById('dsmartPriceCfgPort').value) || 1433;
  const database = document.getElementById('dsmartPriceCfgDatabase').value.trim();
  const user = document.getElementById('dsmartPriceCfgUser').value.trim();
  const password = document.getElementById('dsmartPriceCfgPassword').value;
  const resultEl = document.getElementById('dsmartPriceInspectTableResult');
  const btn = document.getElementById('btnDsmartPriceInspectTable');
  if (resultEl) { resultEl.classList.remove('hidden'); resultEl.innerHTML = '⏳ Đang đọc cấu trúc bảng CSPRICE...'; }
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/dsmart-price/config/inspect-table', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, database, user, password: password || null })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    const naturalKeySet = new Set(data.naturalKeyColumns || []);
    const rows = (data.columns || []).map(c => `<tr class="${naturalKeySet.has(c.name) ? 'bg-emerald-50 font-bold' : ''}">
      <td class="pr-3">${escapeHtml(c.name)}${naturalKeySet.has(c.name) ? ' 🔑' : ''}</td>
      <td class="pr-3 text-gray-500">${escapeHtml(c.dataType)}</td>
      <td class="text-gray-500">${c.nullable ? 'NULL được' : 'NOT NULL'}</td>
    </tr>`).join('');
    // CSPRICE KHÔNG có cột ID tự tăng (identity) — hệ thống dùng "khoá tự nhiên" (naturalKeyColumns, 🔑
    // đánh dấu trong bảng dưới) để khớp đúng 1 dòng khi Sửa/Xoá, xem lib/dsmartSqlClient.js. Nếu CSPRICE có
    // khai báo PRIMARY KEY/UNIQUE INDEX thật (keyIndexes), hiện thêm để đội IT/DBA tự đối chiếu.
    const idNote = data.identityColumn
      ? `<div class="text-emerald-700 font-semibold mb-1">🔑 Cột ID tự tăng (identity) thật: <code>${escapeHtml(data.identityColumn)}</code>.</div>`
      : `<div class="text-amber-700 font-semibold mb-1">ℹ️ CSPRICE KHÔNG có cột ID tự tăng (identity) — hệ thống dùng khoá tự nhiên <code>${escapeHtml((data.naturalKeyColumns || []).join(' + '))}</code> (đánh dấu 🔑 bên dưới) để khớp đúng 1 dòng khi Sửa/Xoá.</div>`;
    const keyIndexes = Array.isArray(data.keyIndexes) ? data.keyIndexes : [];
    const idxNote = keyIndexes.length
      ? `<div class="text-gray-600 mb-1">PRIMARY KEY/UNIQUE INDEX khai báo thật trên CSPRICE: ${keyIndexes.map(idx => `<code>${escapeHtml(idx.name)}${idx.isPrimaryKey ? ' (PK)' : ''} = ${escapeHtml(idx.columns.join(' + '))}</code>`).join(', ')}</div>`
      : `<div class="text-gray-600 mb-1">Không có PRIMARY KEY/UNIQUE INDEX nào khai báo thật trên CSPRICE (bảng dùng ràng buộc duy nhất ở tầng ứng dụng, không khai báo trên CSDL).</div>`;
    if (resultEl) resultEl.innerHTML = `${idNote}${idxNote}<table class="w-full">${rows}</table>`;
  } catch (err) {
    if (resultEl) resultEl.innerHTML = `<span class="text-red-600 font-semibold">⛔ ${escapeHtml(err.message)}</span>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function saveDsmartPriceConfig() {
  const host = document.getElementById('dsmartPriceCfgHost').value.trim();
  const port = Number(document.getElementById('dsmartPriceCfgPort').value) || 1433;
  const database = document.getElementById('dsmartPriceCfgDatabase').value.trim();
  const user = document.getElementById('dsmartPriceCfgUser').value.trim();
  const password = document.getElementById('dsmartPriceCfgPassword').value;
  if (!host || !database || !user) return alert('⛔ Thiếu Host/Tên CSDL/Tài khoản');
  try {
    const res = await fetch('/api/dsmart-price/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, database, user, password: password || null })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    alert('✅ Đã lưu Cấu Hình Kết Nối');
    closeDsmartPriceConfigModal();
  } catch (err) { alert('⛔ ' + err.message); }
}
