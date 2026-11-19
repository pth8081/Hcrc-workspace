// public/js/module-itsupport-dsmartprice.js — Hỗ Trợ IT > "💰 Cài Đặt Giá Bán Buôn" (12/2026), client
// cho routes/dsmartWholesalePrice.js. Xem chú thích mô hình dữ liệu đầy đủ ở route đó — tóm tắt: CSPRICE
// (DSmart16 Trung Tâm) là bảng lịch sử giá theo thời gian, "Thêm Giá Mới" = INSERT dòng mới, "Sửa" =
// UPDATE đúng dòng CHƯA xoá, "Xoá" = DELETE thật, "Dùng Lại" (từ dòng đã xoá) = INSERT dòng mới.
let _dsmartPriceEntries = [];
let _dsmartPriceUploadRows = null;
let _dsmartPriceUploadFileName = null;
let _dsmartPriceUploadFilterCollapsed = true;
let _dsmartPriceMgFilterCollapsed = true;
let _dsmartPriceHistoryFilterCollapsed = true;
let _dsmartPriceEditingId = null;
let _dsmartPriceReusingEntry = null;

async function initDsmartPriceTab() {
  document.getElementById('btnDsmartPriceConfig').classList.toggle('hidden', !currentUser?.perms?.admin);
  document.getElementById('dsmartPriceConnStatus').innerText = 'Xem "⚙️ Cấu Hình Kết Nối" (Admin) để kiểm tra/đổi thông tin kết nối DSmart16 Trung Tâm.';
  applyDsmartPriceUploadFilterState();
  applyDsmartPriceMgFilterState();
  applyDsmartPriceHistoryFilterState();
  await loadDsmartPriceAutoDeleteConfig();
  await Promise.all([renderDsmartPriceEntries(), renderDsmartPriceHistory()]);
}

// ===================== 1. Thêm Giá Mới =====================
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

function renderDsmartPriceUploadPreview() {
  if (!_dsmartPriceUploadRows) return;
  const custKw = (document.getElementById('dsmartPriceUploadFilterCust')?.value || '').trim().toLowerCase();
  const skuKw = (document.getElementById('dsmartPriceUploadFilterSku')?.value || '').trim().toLowerCase();
  const filtered = _dsmartPriceUploadRows.filter(r =>
    (!custKw || r.custId.toLowerCase().includes(custKw)) && (!skuKw || r.skuId.toLowerCase().includes(skuKw)));
  const validCount = _dsmartPriceUploadRows.filter(r => !r.errors.length).length;
  const overlapCount = _dsmartPriceUploadRows.filter(r => r.hasOverlap).length;
  document.getElementById('dsmartPriceUploadStats').innerText =
    `${_dsmartPriceUploadRows.length} dòng trong file — ${validCount} hợp lệ` + (overlapCount ? `, ${overlapCount} trùng khoảng ngày với dòng đã có` : '');
  document.getElementById('dsmartPriceUploadPreviewBody').innerHTML = filtered.map((r, i) => {
    let statusHtml;
    if (r.errors.length) statusHtml = `<span class="bg-red-50 text-red-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">⛔ ${escapeHtml(r.errors.join('; '))}</span>`;
    else if (r.hasOverlap) statusHtml = `<span class="bg-amber-50 text-amber-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">⚠️ Đã có dòng cùng khoảng ngày</span>`;
    else statusHtml = `<span class="bg-emerald-50 text-emerald-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">✅ Sẽ thêm mới</span>`;
    return `<tr class="${r.errors.length ? 'bg-red-50' : r.hasOverlap ? 'bg-amber-50' : ''}">
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
  if (!confirm(`Xác nhận THÊM ${validRows.length} dòng giá MỚI vào CSPRICE (DSmart16 Trung Tâm)? Thao tác này ghi trực tiếp vào hệ thống bán hàng thật.`)) return;
  const btn = document.getElementById('btnDsmartPriceApplyUpload');
  btn.disabled = true;
  try {
    const res = await fetch('/api/dsmart-price/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: validRows, sourceFileName: _dsmartPriceUploadFileName, sourceAction: 'UPLOAD' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    alert(`✅ Đã thêm ${data.successCount}/${validRows.length} dòng thành công` + (data.failCount ? `, ${data.failCount} dòng lỗi (xem console)` : ''));
    if (data.failCount) console.error('Dòng lỗi khi thêm giá DSmart:', data.results.filter(r => !r.success));
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
  const onlyExpired = document.getElementById('dsmartPriceMgOnlyExpired')?.checked;
  const custKw = (document.getElementById('dsmartPriceMgFilterCust')?.value || '').trim().toLowerCase();
  const skuKw = (document.getElementById('dsmartPriceMgFilterSku')?.value || '').trim().toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  let list = [..._dsmartPriceEntries].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  if (onlyExpired) list = list.filter(e => e.status === 'DELETED' || e.toDate < today);
  if (custKw) list = list.filter(e => e.custId.toLowerCase().includes(custKw));
  if (skuKw) list = list.filter(e => e.skuId.toLowerCase().includes(skuKw));

  document.getElementById('dsmartPriceEntriesBody').innerHTML = list.map(e => {
    const isActive = e.status === 'ACTIVE';
    const isExpiredNotDeleted = isActive && e.toDate < today;
    const note = isActive
      ? `Nộp ${dsmartPriceFmtDate((e.createdAt || '').slice(0, 10))} bởi ${escapeHtml(e.createdBy || '—')}`
      : `Xoá bởi ${escapeHtml(e.deletedBy || 'hệ thống tự động')}`;
    const actions = isActive
      ? `<button type="button" data-op="startDsmartPriceEdit" data-arg0="${e.id}" class="bg-white border text-gray-700 text-[10.5px] font-bold px-2 py-0.5 rounded">✏️ Sửa</button>`
        + (e.toDate >= today && e.frDate <= today ? `<span class="block text-[9.5px] text-red-600 mt-0.5">⚠️ Giá đang áp dụng tại quầy</span>` : '')
      : `<button type="button" data-op="startDsmartPriceReuse" data-arg0="${e.id}" class="bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10.5px] font-bold px-2 py-0.5 rounded">↩️ Dùng Lại</button>`;
    return `<tr class="${isActive ? '' : 'opacity-60'}">
      <td class="p-1.5">${isExpiredNotDeleted ? `<input type="checkbox" class="dsmartPriceDeleteCheck" value="${e.id}" checked>` : ''}</td>
      <td class="p-1.5">${escapeHtml(e.custId)}</td>
      <td class="p-1.5">${escapeHtml(e.skuId)}</td>
      <td class="p-1.5 text-right">${Number(e.price).toLocaleString('vi-VN')}</td>
      <td class="p-1.5">${dsmartPriceFmtDate(e.frDate)} → ${dsmartPriceFmtDate(e.toDate)}</td>
      <td class="p-1.5">${dsmartPriceEntryStatusBadge(e)}</td>
      <td class="p-1.5 text-gray-400">${note}</td>
      <td class="p-1.5">${actions}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="8" class="p-3 text-center text-gray-400 italic">Không có dòng nào khớp</td></tr>`;
  document.getElementById('dsmartPriceEditForm').classList.add('hidden');
  _dsmartPriceEditingId = null;
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
    alert('✅ Đã sửa giá thành công');
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
      <button type="button" data-op="saveDsmartPriceReuse" class="bg-green-600 text-white px-3 py-1 rounded text-xs font-bold">✅ Thêm Giá Mới</button>
      <button type="button" data-op="cancelDsmartPriceReuse" class="bg-white border px-3 py-1 rounded text-xs font-semibold">Huỷ</button>
    </div>`;
  form.classList.remove('hidden');
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
      body: JSON.stringify({ rows: [{ custId: _dsmartPriceReusingEntry.custId, skuId: _dsmartPriceReusingEntry.skuId, price, frDate, toDate }], sourceAction: 'REUSE' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    if (!data.successCount) throw new Error(data.results?.[0]?.error || 'Ghi thất bại');
    alert('✅ Đã thêm giá mới thành công');
    cancelDsmartPriceReuse();
    await Promise.all([renderDsmartPriceEntries(), renderDsmartPriceHistory()]);
  } catch (err) { alert('⛔ ' + err.message); }
}

// ----- Xoá hàng loạt (tick chọn các dòng Đã hết hạn) -----
async function applyDsmartPriceDeleteSelected() {
  const ids = Array.from(document.querySelectorAll('.dsmartPriceDeleteCheck:checked')).map(el => Number(el.value));
  if (!ids.length) return alert('⛔ Chưa chọn dòng nào để xoá');
  if (!confirm(`Xác nhận XOÁ THẬT ${ids.length} dòng khỏi CSPRICE (DSmart16 Trung Tâm)? Không thể hoàn tác.`)) return;
  let success = 0, fail = 0;
  for (const id of ids) {
    try {
      const res = await fetch(`/api/dsmart-price/entries/${id}/delete`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      success++;
    } catch (err) { fail++; console.error(`Xoá dòng ID=${id} lỗi:`, err.message); }
  }
  alert(`✅ Đã xoá ${success}/${ids.length} dòng` + (fail ? `, ${fail} dòng lỗi (xem console)` : ''));
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

function dsmartPriceHistoryActionBadge(h) {
  if (h.action === 'DELETE' && h.mode === 'AUTO') return `<span class="bg-red-50 text-red-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">🔁 Tự động xoá hết hạn</span>`;
  if (h.action === 'DELETE') return `<span class="bg-red-50 text-red-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">🗑️ Xoá giá hết hạn</span>`;
  if (h.action === 'UPDATE') return `<span class="bg-sky-50 text-sky-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">✏️ Sửa giá</span>`;
  return `<span class="bg-indigo-50 text-indigo-700 text-[10.5px] font-bold px-2 py-0.5 rounded-full">${h.mode === 'REUSE' ? '↩️ Dùng lại' : '➕ Thêm giá'}</span>`;
}
function dsmartPriceHistoryDetail(h) {
  if (h.action === 'INSERT') return h.sourceFileName ? escapeHtml(h.sourceFileName) : 'Dùng lại từ dòng đã xoá';
  if (h.action === 'UPDATE') return `${Number(h.oldPrice).toLocaleString('vi-VN')} → ${Number(h.newPrice).toLocaleString('vi-VN')}`;
  return h.mode === 'AUTO' ? 'Tự động theo giờ đã đặt' : 'Tick tay';
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
    document.getElementById('dsmartPriceConfigModal').classList.remove('hidden');
  } catch (err) { alert('⛔ ' + err.message); }
}
function closeDsmartPriceConfigModal() { document.getElementById('dsmartPriceConfigModal').classList.add('hidden'); }

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
