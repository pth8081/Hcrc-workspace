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

async function initDsmartPriceTab() {
  document.getElementById('btnDsmartPriceConfig').classList.toggle('hidden', !currentUser?.perms?.admin);
  document.getElementById('dsmartPriceConnStatus').innerText = 'Xem "⚙️ Cấu Hình Kết Nối" (Admin) để kiểm tra/đổi thông tin kết nối DSmart16 Trung Tâm.';
  applyDsmartPriceAddFormState();
  applyDsmartPriceUploadFilterState();
  applyDsmartPriceMgFilterState();
  applyDsmartPriceHistoryFilterState();
  await loadDsmartPriceAutoDeleteConfig();
  await Promise.all([renderDsmartPriceEntries(), renderDsmartPriceHistory()]);
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
  const btn = document.getElementById('btnDsmartPriceApplyUpload');
  btn.disabled = true;
  try {
    const res = await fetch('/api/dsmart-price/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: validRows, sourceFileName: _dsmartPriceUploadFileName, sourceAction: 'UPLOAD' })
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
    if (data.failCount) {
      const failedRows = data.results.filter(r => !r.success);
      const errLines = failedRows.slice(0, 5).map(r => `• ${r.custId}/${r.skuId}: ${r.error}`).join('\n');
      const moreNote = failedRows.length > 5 ? `\n... và ${failedRows.length - 5} dòng lỗi khác (xem console để biết đầy đủ)` : '';
      alert(`✅ Đã thêm ${data.successCount}/${validRows.length} dòng thành công${overwriteNote}, ${data.failCount} dòng lỗi:\n${errLines}${moreNote}`);
      console.error('Dòng lỗi khi thêm giá DSmart:', failedRows);
    } else {
      alert(`✅ Đã thêm ${data.successCount}/${validRows.length} dòng thành công${overwriteNote}`);
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
  const onlyExpired = document.getElementById('dsmartPriceMgOnlyExpired')?.checked;
  const custKw = (document.getElementById('dsmartPriceMgFilterCust')?.value || '').trim().toLowerCase();
  const skuKw = (document.getElementById('dsmartPriceMgFilterSku')?.value || '').trim().toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  let list = [..._dsmartPriceEntries].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
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
    alert('✅ Đã xoá thành công');
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
    alert(data.results?.[0]?.overwritten ? '✅ Đã GHI ĐÈ giá hiện có thành công (đã có dòng khác cho đúng Mã Khách B2B/Mã Sản Phẩm này)' : '✅ Đã thêm giá mới thành công');
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
  for (const id of ids) {
    try {
      const res = await fetch(`/api/dsmart-price/entries/${id}/delete`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      success++;
    } catch (err) { failMsgs.push(err.message); console.error(`Xoá dòng ID=${id} lỗi:`, err.message); }
  }
  // Cùng lý do đã vá ở applyDsmartPriceUpload() ngay trên (12/2026) — hiện THẲNG lỗi thật, không chỉ "xem
  // console" (không dùng được trên mobile).
  if (failMsgs.length) {
    const errLines = failMsgs.slice(0, 5).map(m => `• ${m}`).join('\n');
    const moreNote = failMsgs.length > 5 ? `\n... và ${failMsgs.length - 5} dòng lỗi khác (xem console để biết đầy đủ)` : '';
    alert(`✅ Đã xoá ${success}/${ids.length} dòng, ${failMsgs.length} dòng lỗi:\n${errLines}${moreNote}`);
  } else {
    alert(`✅ Đã xoá ${success}/${ids.length} dòng`);
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
