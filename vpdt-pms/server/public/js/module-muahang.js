// public/js/module-muahang.js — Module TOP-LEVEL "🛒 Mua Hàng" > BAS (Basis — Cơ Sở Tính Chiết Khấu/
// Thưởng NCC), v23.30. Mirror kiến trúc module-checklist.js: file KHÔNG đọc DB.* cho vendors/rebateTerms/
// rebateCalculations (3 collection này CHỦ Ý bị loại khỏi GET /api/data chung — dữ liệu điều khoản/số
// tiền chiết khấu với NCC, xem chú thích routes/data.js) — tự fetch qua routes/purchasing.js riêng, lưu
// vào 4 biến module-scope bên dưới. 2 tab nội bộ: BAS (quản lý NCC/Điều Khoản/đồng bộ DSmart/tính ước
// tính, rebateTermManage/rebateTermActivate) / Báo Cáo (đọc RebateCalculations, rebateViewReport).

let mhSubTab = 'BAS';
// Sub-tab con BÊN TRONG tab BAS (theo yêu cầu người dùng 10/2026) — tách 3 khối Nhà Cung Cấp/Điều Khoản/
// Đồng Bộ DSmart trước đây xếp chồng dọc trong cùng 1 màn thành 3 tab riêng, mirror ĐÚNG khuôn
// setPurchasingSubTab() ở trên (chỉ ẩn/hiện panel + đổi màu nút, KHÔNG lazy-load lại — cả 3 panel vẫn
// được renderMhBasTab() render dữ liệu ngay khi mở BAS, y hệt trước khi tách tab).
let mhBasSubTab = 'VENDOR';
let mhVendors = [], mhTerms = [], mhCalculations = [], mhSyncLogs = [];
let mhDataLoaded = false;
let mhEditingVendorId = null;
let mhEditingTermId = null;
let mhTierRows = []; // {fromAmount, ratePct}
let mhScopeRows = []; // {scopeType, scopeValue}

const MH_TERM_TYPE_LABELS = {
  VOLUME_REBATE: 'Chiết Khấu Theo Doanh Số', GROWTH_REBATE: 'Chiết Khấu Theo Tăng Trưởng',
  TRADE_SPEND: 'Trade Spend', LISTING_FEE: 'Phí Lên Kệ', EARLY_PAYMENT: 'Chiết Khấu Thanh Toán Sớm',
  DAMAGE_ALLOWANCE: 'Bù Hao Hụt', NEW_STORE_SUPPORT: 'Hỗ Trợ Mở Siêu Thị Mới'
};
const MH_STATUS_LABELS = { DRAFT: 'Nháp', ACTIVE: 'Đang Hoạt Động', EXPIRED: 'Hết Hạn', ARCHIVED: 'Lưu Trữ' };
const MH_STATUS_CLASS = {
  DRAFT: 'bg-gray-200 text-gray-700', ACTIVE: 'bg-emerald-100 text-emerald-800',
  EXPIRED: 'bg-amber-100 text-amber-800', ARCHIVED: 'bg-gray-300 text-gray-600'
};

async function mhApi(path, method, payload) {
  const res = await fetch(path, {
    method: method || 'GET',
    headers: method && method !== 'GET' ? { 'Content-Type': 'application/json' } : undefined,
    body: method && method !== 'GET' ? JSON.stringify(payload || {}) : undefined
  });
  if (res.status === 401) { handleSessionExpired(); throw new Error('Phiên đăng nhập đã hết hạn'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return body;
}

async function loadMhData(force) {
  if (mhDataLoaded && !force) return;
  const [vendorsRes, termsRes, calcRes, syncRes] = await Promise.all([
    mhApi('/api/purchasing/vendors').catch(() => ({ items: [] })),
    mhApi('/api/purchasing/terms').catch(() => ({ items: [] })),
    mhApi('/api/purchasing/calculations').catch(() => ({ items: [] })),
    mhApi('/api/purchasing/sync-logs').catch(() => ({ items: [] }))
  ]);
  mhVendors = vendorsRes.items || [];
  mhTerms = termsRes.items || [];
  mhCalculations = calcRes.items || [];
  mhSyncLogs = syncRes.items || [];
  mhDataLoaded = true;
}

async function renderPurchasingModule() {
  const canBas = canManageVendorsClient(currentUser) || canManageTermsClient(currentUser) || canActivateTermClient(currentUser);
  const canReport = canViewPurchasingReportClient(currentUser);
  document.getElementById('btnMhSubBas').classList.toggle('hidden', !canBas);
  document.getElementById('btnMhSubReport').classList.toggle('hidden', !canReport);
  if (!(mhSubTab === 'BAS' && canBas) && !(mhSubTab === 'REPORT' && canReport)) {
    mhSubTab = canBas ? 'BAS' : 'REPORT';
  }
  try {
    await loadMhData(false);
  } catch (err) {
    alert('⛔ Không tải được dữ liệu Mua Hàng: ' + err.message);
  }
  setPurchasingSubTab(mhSubTab);
}

function setPurchasingSubTab(tab) {
  mhSubTab = tab;
  // "ITPRICE" (Phê Duyệt Giá Bán Lẻ, 10/2026) thêm vào chung vòng lặp ẩn/hiện panel + tô màu nút —
  // #mhSubItprice khớp đúng khuôn dựng id `mhSub${Titlecase}` (ITPRICE -> "Itprice") của 2 mục cũ.
  ['BAS', 'REPORT', 'ITPRICE'].forEach(t => {
    const wrap = document.getElementById(`mhSub${t.charAt(0) + t.slice(1).toLowerCase()}`);
    if (wrap) wrap.classList.toggle('hidden', t !== tab);
    const btn = document.getElementById(`btnMhSub${t.charAt(0) + t.slice(1).toLowerCase()}`);
    if (btn) {
      btn.classList.toggle('bg-emerald-700', t === tab);
      btn.classList.toggle('text-white', t === tab);
      btn.classList.toggle('bg-gray-200', t !== tab);
      btn.classList.toggle('text-gray-700', t !== tab);
    }
  });
  if (tab === 'BAS') renderMhBasTab();
  else if (tab === 'REPORT') renderMhReportTab();
  else if (tab === 'ITPRICE') enterMuaHangItPriceForm();
}

// ===================== BAS tab =====================
function renderMhBasTab() {
  const canManageV = canManageVendorsClient(currentUser);
  const canManageT = canManageTermsClient(currentUser);
  document.getElementById('btnMhVendorNew').classList.toggle('hidden', !canManageV);
  document.getElementById('btnMhTermNew').classList.toggle('hidden', !canManageT);
  document.getElementById('btnMhSync').classList.toggle('hidden', !canManageT);
  document.getElementById('mhManualImportWrap').classList.toggle('hidden', !canManageT);
  renderMhVendorList();
  renderMhTermList();
  renderMhSyncLogList();
  setMhBasSubTab(mhBasSubTab);
}

function setMhBasSubTab(tab) {
  mhBasSubTab = tab;
  ['VENDOR', 'TERM', 'SYNC'].forEach(t => {
    const panelId = t === 'VENDOR' ? 'mhBasSubVendor' : t === 'TERM' ? 'mhBasSubTerm' : 'mhBasSubSync';
    document.getElementById(panelId).classList.toggle('hidden', t !== tab);
    const btnId = t === 'VENDOR' ? 'btnMhBasSubVendor' : t === 'TERM' ? 'btnMhBasSubTerm' : 'btnMhBasSubSync';
    const btn = document.getElementById(btnId);
    btn.classList.toggle('bg-emerald-700', t === tab);
    btn.classList.toggle('text-white', t === tab);
    btn.classList.toggle('bg-gray-200', t !== tab);
    btn.classList.toggle('text-gray-700', t !== tab);
  });
}

function renderMhVendorList() {
  const wrap = document.getElementById('mhVendorListWrap');
  if (!mhVendors.length) { wrap.innerHTML = '<div class="text-xs text-gray-400 italic">Chưa có Nhà Cung Cấp nào.</div>'; return; }
  const canManageV = canManageVendorsClient(currentUser);
  wrap.innerHTML = `<div class="overflow-x-auto"><table class="w-full text-xs border-collapse">
    <thead><tr class="bg-gray-50 text-left text-gray-600">
      <th class="p-2 border-b">Mã NCC</th><th class="p-2 border-b">Tên NCC</th><th class="p-2 border-b">MST</th>
      <th class="p-2 border-b">Người Phụ Trách</th><th class="p-2 border-b">Trạng Thái</th><th class="p-2 border-b"></th>
    </tr></thead>
    <tbody>${mhVendors.map(v => `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-2 font-mono">${escapeHtml(v.vendorCode)}</td>
        <td class="p-2">${escapeHtml(v.vendorName)}</td>
        <td class="p-2">${escapeHtml(v.taxCode || '')}</td>
        <td class="p-2">${escapeHtml(v.contactOwnerUsername || '')}</td>
        <td class="p-2"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${v.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-600'}">${v.status === 'ACTIVE' ? 'Hoạt Động' : 'Ngừng'}</span></td>
        <td class="p-2 text-right whitespace-nowrap">
          ${canManageV ? `<button type="button" data-op="openMhVendorForm" data-arg0="${v.id}" class="text-indigo-600 hover:underline mr-2">✏️ Sửa</button>
          <button type="button" data-op="toggleMhVendorStatus" data-arg0="${v.id}" class="text-amber-600 hover:underline">${v.status === 'ACTIVE' ? '⏸️ Ngừng' : '▶️ Mở Lại'}</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

function openMhVendorForm(id) {
  mhEditingVendorId = id ? Number(id) : null;
  const v = mhEditingVendorId ? mhVendors.find(x => x.id === mhEditingVendorId) : null;
  document.getElementById('mhVendorFormTitle').textContent = v ? `Sửa NCC ${v.vendorCode}` : 'Thêm Nhà Cung Cấp';
  document.getElementById('mhVendorCode').value = v ? v.vendorCode : '';
  document.getElementById('mhVendorCode').disabled = !!v;
  document.getElementById('mhVendorName').value = v ? v.vendorName : '';
  document.getElementById('mhVendorTaxCode').value = v ? (v.taxCode || '') : '';
  document.getElementById('mhVendorOwner').value = v ? (v.contactOwnerUsername || '') : '';
  document.getElementById('mhVendorFormWrap').classList.remove('hidden');
}
function closeMhVendorForm() {
  document.getElementById('mhVendorFormWrap').classList.add('hidden');
  mhEditingVendorId = null;
}
async function submitMhVendorForm(e) {
  e.preventDefault();
  const payload = {
    vendorCode: document.getElementById('mhVendorCode').value.trim(),
    vendorName: document.getElementById('mhVendorName').value.trim(),
    taxCode: document.getElementById('mhVendorTaxCode').value.trim(),
    contactOwnerUsername: document.getElementById('mhVendorOwner').value.trim() || null
  };
  try {
    let result;
    if (mhEditingVendorId) {
      result = await mhApi(`/api/purchasing/vendors/${mhEditingVendorId}/edit`, 'POST', payload);
    } else {
      result = await mhApi('/api/create/vendors', 'POST', payload);
    }
    const idx = mhVendors.findIndex(v => v.id === result.item.id);
    if (idx >= 0) mhVendors[idx] = result.item; else mhVendors.unshift(result.item);
    closeMhVendorForm();
    renderMhVendorList();
    populateMhTermVendorSelect();
    alert('✅ Đã lưu Nhà Cung Cấp.');
  } catch (err) { alert('⛔ ' + err.message); }
}
async function toggleMhVendorStatus(id) {
  const v = mhVendors.find(x => x.id === Number(id));
  if (!v) return;
  const action = v.status === 'ACTIVE' ? 'deactivate' : 'activate';
  if (!confirm(`${v.status === 'ACTIVE' ? 'Ngừng hoạt động' : 'Mở lại'} NCC "${v.vendorCode}"?`)) return;
  try {
    const result = await mhApi(`/api/purchasing/vendors/${v.id}/${action}`, 'POST', {});
    const idx = mhVendors.findIndex(x => x.id === v.id);
    if (idx >= 0) mhVendors[idx] = result.item;
    renderMhVendorList();
  } catch (err) { alert('⛔ ' + err.message); }
}

function populateMhTermVendorSelect() {
  const sel = document.getElementById('mhTermVendorId');
  if (!sel) return;
  const activeVendors = mhVendors.filter(v => v.status === 'ACTIVE');
  sel.innerHTML = activeVendors.map(v => `<option value="${v.id}">${escapeHtml(v.vendorCode)} — ${escapeHtml(v.vendorName)}</option>`).join('')
    || '<option value="">-- Chưa có NCC hoạt động --</option>';
}

function renderMhTermList() {
  const wrap = document.getElementById('mhTermListWrap');
  if (!mhTerms.length) { wrap.innerHTML = '<div class="text-xs text-gray-400 italic">Chưa có Điều Khoản nào.</div>'; return; }
  const canManageT = canManageTermsClient(currentUser);
  const canActivate = canActivateTermClient(currentUser);
  const vendorByIdName = id => (mhVendors.find(v => v.id === id) || {}).vendorCode || `#${id}`;
  wrap.innerHTML = `<div class="overflow-x-auto"><table class="w-full text-xs border-collapse">
    <thead><tr class="bg-gray-50 text-left text-gray-600">
      <th class="p-2 border-b">Mã ĐK</th><th class="p-2 border-b">Tên</th><th class="p-2 border-b">NCC</th>
      <th class="p-2 border-b">Loại</th><th class="p-2 border-b">Kỳ Hiệu Lực</th><th class="p-2 border-b">v</th>
      <th class="p-2 border-b">Trạng Thái</th><th class="p-2 border-b"></th>
    </tr></thead>
    <tbody>${mhTerms.map(t => `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-2 font-mono">${escapeHtml(t.termCode)}</td>
        <td class="p-2">${escapeHtml(t.termName)}</td>
        <td class="p-2 font-mono">${escapeHtml(vendorByIdName(t.vendorId))}</td>
        <td class="p-2">${escapeHtml(MH_TERM_TYPE_LABELS[t.termType] || t.termType)}</td>
        <td class="p-2 whitespace-nowrap">${escapeHtml(t.effectiveFrom || '')} → ${escapeHtml(t.effectiveTo || '∞')}</td>
        <td class="p-2 text-center">${t.version || 1}</td>
        <td class="p-2"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${MH_STATUS_CLASS[t.status] || ''}">${MH_STATUS_LABELS[t.status] || t.status}</span></td>
        <td class="p-2 text-right whitespace-nowrap space-x-2">
          ${t.status === 'DRAFT' && canManageT ? `<button type="button" data-op="openMhTermForm" data-arg0="${t.id}" class="text-indigo-600 hover:underline">✏️ Sửa</button>` : ''}
          ${t.status === 'DRAFT' && canActivate ? `<button type="button" data-op="activateMhTerm" data-arg0="${t.id}" class="text-emerald-600 hover:underline">▶️ Kích Hoạt</button>` : ''}
          ${(t.status === 'ACTIVE' || t.status === 'EXPIRED' || t.status === 'ARCHIVED') && canManageT ? `<button type="button" data-op="cloneMhTerm" data-arg0="${t.id}" class="text-sky-600 hover:underline">📄 Nhân Bản</button>` : ''}
          ${t.status === 'ACTIVE' && canManageT ? `<button type="button" data-op="expireMhTerm" data-arg0="${t.id}" class="text-amber-600 hover:underline">⏳ Hết Hạn</button>` : ''}
          ${(t.status === 'DRAFT' || t.status === 'ACTIVE') && canManageT ? `<button type="button" data-op="archiveMhTerm" data-arg0="${t.id}" class="text-gray-500 hover:underline">🗄️ Lưu Trữ</button>` : ''}
          ${t.status === 'ACTIVE' && canManageT ? `<button type="button" data-op="calculateMhTerm" data-arg0="${t.id}" class="text-fuchsia-600 hover:underline">🧮 Tính Ước Tính</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

// LỖI ĐÃ VÁ (người dùng phản ánh, 9/2026): ô "Từ số tiền" thiếu class "money-input" — không tự chèn dấu
// chấm phân cách hàng nghìn khi gõ như MỌI ô nhập tiền khác trong hệ thống (VD unitPrice/amount ở Vận
// Hành, voDiscountAmount...), gõ số lớn (VD 500000000) rất khó đọc/dễ gõ nhầm số 0. Nay dùng đúng
// formatMoneyDisplay() (core.js) khi render + class "money-input" (tự format khi gõ qua listener chung
// document 'input', xem core.js) — value hiển thị có dấu chấm ngay từ lúc mở form Sửa, không chỉ sau khi
// gõ thêm ký tự.
function mhRenderTierRows() {
  document.getElementById('mhTierRowsWrap').innerHTML = mhTierRows.map((r, idx) => `
    <div class="flex items-center gap-2">
      <span class="text-[11px] text-gray-500 w-6">#${idx + 1}</span>
      <input type="text" inputmode="numeric" placeholder="Từ số tiền (VNĐ)" value="${escapeHtml(formatMoneyDisplay(r.fromAmount ?? ''))}" data-op-input="mhUpdateTierField" data-arg0="${idx}" data-arg1="fromAmount" data-arg-value="2" class="flex-1 border rounded px-2 py-1 text-xs money-input">
      <input type="text" inputmode="decimal" placeholder="Tỷ lệ %" value="${escapeHtml(r.ratePct ?? '')}" data-op-input="mhUpdateTierField" data-arg0="${idx}" data-arg1="ratePct" data-arg-value="2" class="w-24 border rounded px-2 py-1 text-xs">
      <button type="button" data-op="mhRemoveTierRow" data-arg0="${idx}" class="text-red-500 text-xs">✕</button>
    </div>`).join('') || '<div class="text-[11px] text-gray-400 italic">Chưa có bậc nào — bấm "+ Thêm Bậc".</div>';
}
function mhAddTierRow() { mhTierRows.push({ fromAmount: '', ratePct: '' }); mhRenderTierRows(); }
function mhRemoveTierRow(idx) { mhTierRows.splice(Number(idx), 1); mhRenderTierRows(); }
function mhUpdateTierField(idx, field, value) {
  if (!mhTierRows[idx]) return;
  // fromAmount lưu số THẬT ngay lúc gõ (mirror updateOperationOrderItemField() ở module-vanhanh.js) —
  // value đến đây có thể đã lẫn dấu chấm hiển thị (formatMoneyDisplay chạy sau trong cùng sự kiện
  // 'input'), replace(/\D/g, '') bóc sạch mọi ký tự không phải số trước khi lưu.
  if (field === 'fromAmount') mhTierRows[idx].fromAmount = Number(String(value || '').replace(/\D/g, '')) || 0;
  else mhTierRows[idx][field] = value;
}

function mhRenderScopeRows() {
  document.getElementById('mhScopeRowsWrap').innerHTML = mhScopeRows.map((r, idx) => `
    <div class="flex items-center gap-2">
      <select data-op-change="mhUpdateScopeField" data-arg0="${idx}" data-arg1="scopeType" data-arg-value="2" class="border rounded px-2 py-1 text-xs">
        <option value="STORE_FORMAT" ${r.scopeType === 'STORE_FORMAT' ? 'selected' : ''}>Định Dạng Siêu Thị</option>
        <option value="STORE" ${r.scopeType === 'STORE' ? 'selected' : ''}>Siêu Thị</option>
        <option value="CATEGORY" ${r.scopeType === 'CATEGORY' ? 'selected' : ''}>Ngành Hàng</option>
      </select>
      <input type="text" placeholder="Giá trị (mã)" value="${escapeHtml(r.scopeValue || '')}" data-op-input="mhUpdateScopeField" data-arg0="${idx}" data-arg1="scopeValue" data-arg-value="2" class="flex-1 border rounded px-2 py-1 text-xs">
      <button type="button" data-op="mhRemoveScopeRow" data-arg0="${idx}" class="text-red-500 text-xs">✕</button>
    </div>`).join('') || '<div class="text-[11px] text-gray-400 italic">Không giới hạn phạm vi (áp dụng toàn hệ thống).</div>';
}
function mhAddScopeRow() { mhScopeRows.push({ scopeType: 'STORE_FORMAT', scopeValue: '' }); mhRenderScopeRows(); }
function mhRemoveScopeRow(idx) { mhScopeRows.splice(Number(idx), 1); mhRenderScopeRows(); }
function mhUpdateScopeField(idx, field, value) {
  if (mhScopeRows[idx]) mhScopeRows[idx][field] = value;
}

function openMhTermForm(id) {
  mhEditingTermId = id ? Number(id) : null;
  const t = mhEditingTermId ? mhTerms.find(x => x.id === mhEditingTermId) : null;
  if (mhEditingTermId && (!t || t.status !== 'DRAFT')) { alert('⛔ Chỉ sửa được điều khoản đang ở trạng thái Nháp.'); return; }
  populateMhTermVendorSelect();
  document.getElementById('mhTermFormTitle').textContent = t ? `Sửa Điều Khoản ${t.termCode}` : 'Tạo Điều Khoản Chiết Khấu';
  document.getElementById('mhTermVendorId').value = t ? t.vendorId : '';
  document.getElementById('mhTermVendorId').disabled = !!t;
  document.getElementById('mhTermCode').value = t ? t.termCode : '';
  document.getElementById('mhTermCode').disabled = !!t;
  document.getElementById('mhTermName').value = t ? t.termName : '';
  document.getElementById('mhTermType').value = t ? t.termType : 'VOLUME_REBATE';
  document.getElementById('mhTermCalcBasis').value = t ? t.calcBasis : 'PURCHASE_VALUE';
  document.getElementById('mhTermTierMode').value = t ? t.tierMode : 'GRADUATED';
  document.getElementById('mhTermPeriodType').value = t ? t.periodType : 'MONTHLY';
  document.getElementById('mhTermFrom').value = t ? t.effectiveFrom : '';
  document.getElementById('mhTermTo').value = t ? (t.effectiveTo || '') : '';
  document.getElementById('mhTermRetroactive').checked = !!(t && t.isRetroactive);
  mhTierRows = t ? (t.tiers || []).map(r => ({ fromAmount: String(r.fromAmount), ratePct: String(r.ratePct) })) : [{ fromAmount: '0', ratePct: '' }];
  mhScopeRows = t ? (t.scopes || []).map(r => ({ ...r })) : [];
  mhRenderTierRows();
  mhRenderScopeRows();
  document.getElementById('mhTermFormWrap').classList.remove('hidden');
}
function closeMhTermForm() {
  document.getElementById('mhTermFormWrap').classList.add('hidden');
  document.getElementById('mhTermVendorId').disabled = false;
  document.getElementById('mhTermCode').disabled = false;
  mhEditingTermId = null;
}
async function submitMhTermForm(e) {
  e.preventDefault();
  // LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): trước đây dùng Number(r.ratePct) thẳng — gõ kiểu Việt
  // "12,5" (dấu phẩy thập phân) ra NaN -> JSON.stringify() thành null -> server Number(null)=0 (hữu hạn,
  // qua được validateTiers() vì 0 nằm trong 0-100) -> ÂM THẦM lưu Tỷ Lệ % = 0% thay vì 12.5% người dùng
  // định nhập, không có cảnh báo gì. Nay chuẩn hoá dấu phẩy->chấm như các nơi khác (module-itsupport-price.js,
  // module-hopdong.js...) VÀ chặn ngay ở client nếu vẫn không phải số hợp lệ, không để lọt xuống server.
  const tiers = mhTierRows.map(r => ({ fromAmount: Number(String(r.fromAmount).replace(/\D/g, '')), ratePct: parseFloat(String(r.ratePct).replace(',', '.')) }));
  const invalidTier = tiers.find(t => !Number.isFinite(t.ratePct) || t.ratePct < 0 || t.ratePct > 100);
  if (invalidTier) return alert('⛔ Tỷ lệ % mỗi bậc phải là số hợp lệ trong khoảng 0-100 (dùng dấu , hoặc . cho phần thập phân).');
  const scopes = mhScopeRows.filter(r => r.scopeValue && r.scopeValue.trim()).map(r => ({ scopeType: r.scopeType, scopeValue: r.scopeValue.trim() }));
  const payload = {
    vendorId: Number(document.getElementById('mhTermVendorId').value),
    termCode: document.getElementById('mhTermCode').value.trim(),
    termName: document.getElementById('mhTermName').value.trim(),
    termType: document.getElementById('mhTermType').value,
    calcBasis: document.getElementById('mhTermCalcBasis').value,
    tierMode: document.getElementById('mhTermTierMode').value,
    periodType: document.getElementById('mhTermPeriodType').value,
    effectiveFrom: document.getElementById('mhTermFrom').value,
    effectiveTo: document.getElementById('mhTermTo').value || null,
    isRetroactive: document.getElementById('mhTermRetroactive').checked,
    tiers, scopes
  };
  try {
    const result = mhEditingTermId
      ? await mhApi(`/api/purchasing/terms/${mhEditingTermId}/edit`, 'POST', payload)
      : await mhApi('/api/create/rebateTerms', 'POST', payload);
    const idx = mhTerms.findIndex(t => t.id === result.item.id);
    if (idx >= 0) mhTerms[idx] = result.item; else mhTerms.unshift(result.item);
    closeMhTermForm();
    renderMhTermList();
    alert(mhEditingTermId ? '✅ Đã lưu thay đổi điều khoản.' : '✅ Đã tạo Điều Khoản (trạng thái Nháp) — bấm "Kích Hoạt" khi sẵn sàng áp dụng.');
  } catch (err) { alert('⛔ ' + err.message); }
}

function mhApplyTermUpdate(item) {
  const idx = mhTerms.findIndex(t => t.id === item.id);
  if (idx >= 0) mhTerms[idx] = item; else mhTerms.unshift(item);
  renderMhTermList();
}
async function activateMhTerm(id) {
  if (!confirm('Kích hoạt điều khoản này? Sau khi kích hoạt sẽ không sửa trực tiếp được nữa (phải Nhân Bản để sửa).')) return;
  try { mhApplyTermUpdate((await mhApi(`/api/purchasing/terms/${id}/activate`, 'POST', {})).item); alert('✅ Đã kích hoạt.'); }
  catch (err) { alert('⛔ ' + err.message); }
}
async function archiveMhTerm(id) {
  if (!confirm('Lưu trữ điều khoản này? Điều khoản sẽ không còn áp dụng được nữa.')) return;
  try { mhApplyTermUpdate((await mhApi(`/api/purchasing/terms/${id}/archive`, 'POST', {})).item); }
  catch (err) { alert('⛔ ' + err.message); }
}
async function expireMhTerm(id) {
  if (!confirm('Đánh dấu điều khoản này đã hết hạn?')) return;
  try { mhApplyTermUpdate((await mhApi(`/api/purchasing/terms/${id}/expire`, 'POST', {})).item); }
  catch (err) { alert('⛔ ' + err.message); }
}
async function cloneMhTerm(id) {
  if (!confirm('Nhân bản điều khoản này thành 1 bản Nháp mới (version kế tiếp) để sửa?')) return;
  try { mhApplyTermUpdate((await mhApi(`/api/purchasing/terms/${id}/clone`, 'POST', {})).item); alert('✅ Đã nhân bản — sửa trên bản Nháp mới.'); }
  catch (err) { alert('⛔ ' + err.message); }
}
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): trước đây dùng prompt() nhập tay periodStart/periodEnd —
// không có picker, dễ gõ sai định dạng (chỉ phát hiện khi server trả lỗi khó hiểu). Nay dùng
// showConfirmModal() có sẵn với 2 input type="date" (trình duyệt tự ép đúng YYYY-MM-DD).
function calculateMhTerm(id) {
  showConfirmModal({
    title: '📊 Tính Ước Tính Chiết Khấu',
    bodyHTML: `
      <div class="space-y-3 text-sm">
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">Từ ngày</label>
          <input type="date" id="mhCalcPeriodStart" class="border rounded p-2 w-full">
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-600 mb-1">Đến ngày</label>
          <input type="date" id="mhCalcPeriodEnd" class="border rounded p-2 w-full">
        </div>
      </div>`,
    confirmLabel: 'Tính Ước Tính',
    onConfirm: () => submitMhCalcTerm(id)
  });
}
async function submitMhCalcTerm(id) {
  const periodStart = document.getElementById('mhCalcPeriodStart')?.value || '';
  const periodEnd = document.getElementById('mhCalcPeriodEnd')?.value || '';
  if (!periodStart || !periodEnd) return alert('⛔ Vui lòng chọn đủ Từ ngày và Đến ngày.');
  try {
    const result = await mhApi(`/api/purchasing/terms/${id}/calculate`, 'POST', { periodStart, periodEnd });
    mhCalculations.unshift(result.item);
    alert(`✅ Đã tính: Doanh số căn cứ ${Number(result.item.basisAmount).toLocaleString('vi-VN')}đ → Ước tính chiết khấu ${Number(result.item.rebateAmount).toLocaleString('vi-VN')}đ. Xem chi tiết ở tab Báo Cáo.`);
  } catch (err) { alert('⛔ ' + err.message); }
}

async function triggerDSmartSync() {
  if (!confirm('Đồng bộ dữ liệu mua hàng từ DSmart ngay bây giờ? Có thể mất vài chục giây tuỳ khối lượng dữ liệu.')) return;
  const btn = document.getElementById('btnMhSync');
  btn.disabled = true; btn.textContent = '⏳ Đang đồng bộ...';
  try {
    const result = await mhApi('/api/purchasing/sync', 'POST', {});
    // LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #7): server nay tự cô lập từng
    // dòng lỗi (thiếu vendorCode/storeCode/purchaseDate/amount không hợp lệ) thay vì làm hỏng cả lượt —
    // hiện rõ cho người bấm biết có dòng nào bị bỏ qua, cùng khuôn cảnh báo rowErrors của Nhập File thủ công.
    let msg = `✅ Đồng bộ xong: ${result.rowsFetched} dòng lấy về, ${result.rowsInserted} dòng mới, ${result.rowsSkippedDuplicate} dòng trùng bỏ qua.`;
    if (result.rowErrors && result.rowErrors.length) {
      msg += `\n⚠️ ${result.rowErrors.length} dòng lỗi từ DSmart (đã bỏ qua, các dòng khác vẫn được nạp bình thường):\n` + result.rowErrors.slice(0, 10).map(e => e.message).join('\n');
      if (result.rowErrors.length > 10) msg += `\n... và ${result.rowErrors.length - 10} dòng lỗi khác.`;
    }
    alert(msg);
    const syncRes = await mhApi('/api/purchasing/sync-logs');
    mhSyncLogs = syncRes.items || [];
    renderMhSyncLogList();
  } catch (err) { alert('⛔ ' + err.message); }
  finally { btn.disabled = false; btn.textContent = '🔄 Đồng Bộ Ngay'; }
}

function renderMhSyncLogList() {
  const wrap = document.getElementById('mhSyncLogWrap');
  if (!mhSyncLogs.length) { wrap.innerHTML = '<div class="text-gray-400 italic">Chưa có lượt đồng bộ nào.</div>'; return; }
  wrap.innerHTML = `<table class="w-full border-collapse"><thead><tr class="bg-gray-50 text-left text-gray-600">
    <th class="p-1.5 border-b">Bắt Đầu</th><th class="p-1.5 border-b">Kết Thúc</th><th class="p-1.5 border-b">Nguồn</th><th class="p-1.5 border-b">Trạng Thái</th>
    <th class="p-1.5 border-b">Lấy Về</th><th class="p-1.5 border-b">Thêm Mới</th><th class="p-1.5 border-b">Người Chạy</th></tr></thead>
    <tbody>${mhSyncLogs.slice(0, 20).map(l => `<tr class="border-b">
      <td class="p-1.5 whitespace-nowrap">${l.startedAt ? new Date(l.startedAt).toLocaleString('vi-VN') : ''}</td>
      <td class="p-1.5 whitespace-nowrap">${l.finishedAt ? new Date(l.finishedAt).toLocaleString('vi-VN') : ''}</td>
      <td class="p-1.5">${l.sourceSystem === 'MANUAL' ? '📤 Thủ công' : '🔄 DSmart'}</td>
      <td class="p-1.5"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${l.status === 'SUCCESS' ? 'bg-emerald-100 text-emerald-800' : l.status === 'FAILED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}">${escapeHtml(l.status)}</span></td>
      <td class="p-1.5">${l.rowsFetched ?? ''}</td><td class="p-1.5">${l.rowsInserted ?? ''}</td><td class="p-1.5">${escapeHtml(l.triggeredBy || '')}</td>
    </tr>`).join('')}</tbody></table>`;
}

async function onMhManualImportFileChange(event) {
  const file = event.target.files[0];
  const statusEl = document.getElementById('mhManualImportStatus');
  const input = event.target;
  if (!file) { statusEl.textContent = ''; return; }
  if (!confirm(`Nhập file "${file.name}" vào dữ liệu mua hàng ngay bây giờ?`)) { input.value = ''; return; }
  statusEl.textContent = '⏳ Đang nhập file...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/purchasing/manual-import', { method: 'POST', body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    let msg = `✅ Nhập xong: ${data.rowsFetched} dòng hợp lệ, ${data.rowsInserted} dòng mới, ${data.rowsSkippedDuplicate} dòng trùng bỏ qua.`;
    if (data.rowErrors && data.rowErrors.length) {
      msg += `\n⚠️ ${data.rowErrors.length} dòng lỗi (đã bỏ qua, các dòng khác vẫn được nhập):\n` + data.rowErrors.slice(0, 10).map(e => e.message).join('\n');
      if (data.rowErrors.length > 10) msg += `\n... và ${data.rowErrors.length - 10} dòng lỗi khác.`;
    }
    alert(msg);
    const syncRes = await mhApi('/api/purchasing/sync-logs');
    mhSyncLogs = syncRes.items || [];
    renderMhSyncLogList();
  } catch (err) {
    alert('⛔ ' + err.message);
  } finally {
    statusEl.textContent = '';
    input.value = '';
  }
}

// LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao — phát hiện #4): TRƯỚC ĐÂY gọi GET
// /api/purchasing/manual-import-export KHÔNG kèm sourceSystem -> route mặc định xuất MỌI nguồn (cả
// 🔄 DSmart lẫn 📤 Thủ công). Nút "📊 Xuất File" ở đây CHỈ phục vụ ĐÚNG 1 mục đích: "xuất để sửa/bổ sung
// rồi tải lên lại qua Nhập File" — mà Nhập File LUÔN ghi dữ liệu tải lên với sourceSystem='MANUAL' (xem
// onMhManualImportFileChange() + parsePurchaseTransactionImportXlsx(), lib/purchasingManualImport.js).
// Nếu file xuất ra có LẪN dòng DSmart rồi tải ngược lại, dòng đó biến thành 1 bản ghi 'MANUAL' MỚI hoàn
// toàn (khoá dedup khác hẳn dòng DSmart gốc — buildManualSourceRefId() không liên quan gì tới sourceRefId
// gốc của DSmart) -> NHÂN ĐÔI giao dịch, tính chiết khấu gấp đôi. Luôn ép sourceSystem=MANUAL ở đây — nếu
// sau này cần 1 nút "Xuất TOÀN BỘ để xem/báo cáo" riêng (không dùng để nhập lại), phải thêm 1 nút/luồng
// MỚI tách biệt, không dùng chung nút này.
async function exportMhManualData() {
  const from = document.getElementById('mhExportFrom').value;
  const to = document.getElementById('mhExportTo').value;
  if (!from || !to) { alert('⛔ Chọn khoảng Từ Ngày / Đến Ngày trước khi xuất file'); return; }
  window.open(`/api/purchasing/manual-import-export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&sourceSystem=MANUAL`, '_blank');
}

// ===================== Báo Cáo tab (nội bộ Mua Hàng) =====================
function renderMhReportTab() {
  const vendorSel = document.getElementById('mhReportVendorFilter');
  if (vendorSel.options.length <= 1) {
    vendorSel.innerHTML = '<option value="">-- Tất cả --</option>' + mhVendors.map(v => `<option value="${v.id}">${escapeHtml(v.vendorCode)} — ${escapeHtml(v.vendorName)}</option>`).join('');
  }
  const vendorId = vendorSel.value ? Number(vendorSel.value) : null;
  const from = document.getElementById('mhReportFrom').value;
  const to = document.getElementById('mhReportTo').value;
  let rows = mhCalculations.slice();
  if (vendorId) rows = rows.filter(c => c.vendorId === vendorId);
  if (from) rows = rows.filter(c => c.periodEnd >= from);
  if (to) rows = rows.filter(c => c.periodStart <= to);

  const totalBasis = rows.reduce((s, c) => s + Number(c.basisAmount || 0), 0);
  const totalRebate = rows.reduce((s, c) => s + Number(c.rebateAmount || 0), 0);
  document.getElementById('mhReportSummaryWrap').innerHTML = `
    <div class="bg-emerald-50 border border-emerald-200 rounded p-3">
      <div class="text-[11px] text-emerald-700 font-bold">Số Lượt Tính</div>
      <div class="text-xl font-bold text-emerald-900">${rows.length}</div>
    </div>
    <div class="bg-sky-50 border border-sky-200 rounded p-3">
      <div class="text-[11px] text-sky-700 font-bold">Tổng Doanh Số Căn Cứ</div>
      <div class="text-xl font-bold text-sky-900">${totalBasis.toLocaleString('vi-VN')}đ</div>
    </div>
    <div class="bg-fuchsia-50 border border-fuchsia-200 rounded p-3">
      <div class="text-[11px] text-fuchsia-700 font-bold">Tổng Ước Tính Chiết Khấu</div>
      <div class="text-xl font-bold text-fuchsia-900">${totalRebate.toLocaleString('vi-VN')}đ</div>
    </div>`;

  const vendorByIdName = id => (mhVendors.find(v => v.id === id) || {}).vendorCode || `#${id}`;
  document.getElementById('mhReportTableWrap').innerHTML = rows.length ? `<table class="w-full text-xs border-collapse">
    <thead><tr class="bg-gray-50 text-left text-gray-600">
      <th class="p-2 border-b">NCC</th><th class="p-2 border-b">Điều Khoản</th><th class="p-2 border-b">Kỳ</th>
      <th class="p-2 border-b text-right">Doanh Số Căn Cứ</th><th class="p-2 border-b text-right">Ước Tính Chiết Khấu</th>
      <th class="p-2 border-b">Người Tính</th><th class="p-2 border-b">Lúc</th>
    </tr></thead>
    <tbody>${rows.map(c => `<tr class="border-b hover:bg-gray-50">
      <td class="p-2 font-mono">${escapeHtml(vendorByIdName(c.vendorId))}</td>
      <td class="p-2 font-mono">${escapeHtml(c.termCode || '')}</td>
      <td class="p-2 whitespace-nowrap">${escapeHtml(c.periodStart)} → ${escapeHtml(c.periodEnd)}</td>
      <td class="p-2 text-right">${Number(c.basisAmount).toLocaleString('vi-VN')}đ</td>
      <td class="p-2 text-right font-bold text-fuchsia-700">${Number(c.rebateAmount).toLocaleString('vi-VN')}đ</td>
      <td class="p-2">${escapeHtml(c.calculatedByName || c.calculatedBy || '')}</td>
      <td class="p-2 whitespace-nowrap">${c.id ? new Date(c.id).toLocaleString('vi-VN') : ''}</td>
    </tr>`).join('')}</tbody></table>` : '<div class="text-xs text-gray-400 italic">Chưa có số liệu ước tính nào khớp bộ lọc.</div>';
}

// ===== "💲 Phê Duyệt Giá Bán Lẻ" (itPriceApprovals, priceType=RETAIL) — 10/2026, chuyển từ Hỗ Trợ IT
// sang Mua Hàng theo yêu cầu người dùng. Form nhỏ hơn hẳn Bán Buôn (module-vanhanh.js) — không tier/đơn
// vị áp dụng/siêu thị đề xuất/ngày hiệu lực, tự gắn storeScope=ALL + ngày áp dụng=hôm nay + hết hiệu
// lực=Vĩnh viễn (mirror ĐÚNG nhánh RETAIL cũ của submitItPriceApproval() ở module-itsupport-price.js).
// Danh sách đầy đủ + Duyệt/Từ chối/Yêu Cầu Bổ Sung/Từ Chối Khẩn nay sống NGAY TẠI ĐÂY (yêu cầu người
// dùng đợt sau: "phê duyệt/từ chối/bổ sung/phê duyệt khẩn cấp làm tại 2 tab phê duyệt giá") — modal
// "Chi tiết" mở với context='APPROVAL' (xem buildItPriceRowHtml()/openItPriceModal() ở
// module-itsupport-price.js). Hỗ Trợ IT giờ CHỈ còn hiển thị để hỗ trợ/áp giá (context='SUPPORT').
let mhItPricePendingFile = null;

// Bắt buộc set activeItPriceSubTab='RETAIL' TRƯỚC khi generateItPriceCode() (module-tailieu.js) — biến
// này DÙNG CHUNG với Hỗ Trợ IT (list-filter)/Vận Hành (form Bán Buôn), nếu không set lại ở đây mã tự
// sinh có thể mang hậu tố sai (BB) nếu người dùng vừa ghé qua 1 trong 2 nơi kia trước đó cùng phiên.
function enterMuaHangItPriceForm() {
  activeItPriceSubTab = 'RETAIL';
  const canCreate = canProposeItPriceType(currentUser, 'RETAIL');
  const formEl = document.getElementById('mhItPriceCreateForm');
  if (formEl) formEl.classList.toggle('hidden', !canCreate);
  const noPermNote = document.getElementById('mhItPriceNoCreatePermNote');
  if (noPermNote) noPermNote.classList.toggle('hidden', canCreate);
  if (canCreate) {
    const codeEl = document.getElementById('mhItPriceCode');
    if (codeEl) codeEl.value = generateItPriceCode();
    const deptEl = document.getElementById('mhItPriceDeptDisplay');
    if (deptEl) deptEl.value = currentUser.dept;
    mhItPricePendingFile = null;
    document.getElementById('mhItPriceFileStatus').innerText = '';
    document.getElementById('mhItPriceFilePreviewWrap').classList.add('hidden');
    populateMhItPriceRetailZoneSelect();
    renderMhItPriceMasterListSelect();
  }
  renderDynamicInputsForModule('IT_PRICE_RETAIL', 'dynamicFieldsContainer_IT_PRICE_RETAIL_MH');
  // renderMhItPriceList() (module-itsupport-price.js) — danh sách đề xuất Bán Lẻ CỦA TÔI/tôi cần duyệt,
  // hiện NGAY tại đây (10/2026, yêu cầu người dùng) — gọi lại mỗi lần vào tab để chắc chắn khớp dữ liệu
  // mới nhất, dù hàm này cũng tự chạy theo mọi thay đổi itPriceApprovals (xem renderItPriceApprovals()).
  renderMhItPriceList();
}

function renderMhItPriceMasterListSelect() {
  const wrap = document.getElementById('mhItPriceMasterListSelectWrap');
  const select = document.getElementById('mhItPriceMasterListSelect');
  if (!wrap || !select) return;
  const lists = (DB.itPriceMasterLists || []).filter(m => !m.priceType || m.priceType === 'RETAIL');
  wrap.classList.toggle('hidden', lists.length === 0);
  if (!lists.length) return;
  const prevValue = select.value;
  select.innerHTML = `<option value="">-- Chọn Mẫu Giá Phê Duyệt --</option>` +
    lists.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${(m.columns || []).length} cột)</option>`).join('');
  if (lists.some(m => String(m.id) === prevValue)) select.value = prevValue;
  updateMhItPriceMasterListDownloadLink();
}

function updateMhItPriceMasterListDownloadLink() {
  const link = document.getElementById('mhItPriceMasterListDownloadLink');
  if (!link) return;
  const masterListId = document.getElementById('mhItPriceMasterListSelect')?.value;
  const list = masterListId ? (DB.itPriceMasterLists || []).find(m => String(m.id) === masterListId) : null;
  if (!list) { link.classList.add('hidden'); return; }
  link.href = attachmentDownloadUrl(list.fileUrl, null, list.fileName);
  link.classList.remove('hidden');
}

async function parseMhItPriceFileForPreview(file) {
  const statusEl = document.getElementById('mhItPriceFileStatus');
  statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  const masterListId = document.getElementById('mhItPriceMasterListSelect')?.value;
  if (masterListId) formData.append('masterListId', masterListId);
  try {
    const res = await fetch('/api/it-price/parse-file', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    mhItPricePendingFile = data;
    statusEl.innerText = `✅ Đọc thành công ${data.items.length} dòng giá từ file "${data.fileName}".`;
    renderMhItPriceFilePreview(data);
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
  }
}

function renderMhItPriceFilePreview(data) {
  const columnLabels = data.columnLabels && data.columnLabels.length ? data.columnLabels : [{ key: 'c0', label: 'Dữ liệu' }];
  document.getElementById('mhItPriceFilePreviewCount').innerText = data.items.length;
  document.getElementById('mhItPriceFilePreviewHead').innerHTML = `<tr>${columnLabels.map(col =>
    `<th class="border p-1">${escapeHtml(col.label)}</th>`
  ).join('')}</tr>`;
  document.getElementById('mhItPriceFilePreviewBody').innerHTML = data.items.map(it => `<tr>${columnLabels.map(col =>
    `<td class="border p-1">${escapeHtml(it.values?.[col.key] || '')}</td>`
  ).join('')}</tr>`).join('');
  document.getElementById('mhItPriceFilePreviewWrap').classList.remove('hidden');
}

async function onMhItPriceFileChange(event) {
  onSingleFileChosen(event.target, 'mhItPriceFileChip');
  const file = event.target.files[0];
  mhItPricePendingFile = null;
  document.getElementById('mhItPriceFilePreviewWrap').classList.add('hidden');
  const statusEl = document.getElementById('mhItPriceFileStatus');
  if (!file) { statusEl.innerText = ''; return; }
  await parseMhItPriceFileForPreview(file);
  if (!mhItPricePendingFile) clearSingleFileInput('mhItPriceFileInput', 'mhItPriceFileChip');
}

async function onMhItPriceMasterListChange() {
  updateMhItPriceMasterListDownloadLink();
  const fileInput = document.getElementById('mhItPriceFileInput');
  const file = fileInput?.files?.[0];
  if (!file) return;
  await parseMhItPriceFileForPreview(file);
}

async function submitMhItPriceApproval(e) {
  e.preventDefault();
  activeItPriceSubTab = 'RETAIL';
  const code = document.getElementById('mhItPriceCode').value.trim();
  if (DB.itPriceApprovals.some(p => p.code === code)) return alert('Mã đề xuất đã tồn tại!');
  if (!mhItPricePendingFile) return alert('Vui lòng chọn tệp bảng giá (.xlsx) cần duyệt!');
  const masterListId = document.getElementById('mhItPriceMasterListSelect')?.value || null;
  if ((DB.itPriceMasterLists || []).length && !masterListId) {
    return alert('⛔ Vui lòng chọn Mẫu Giá Phê Duyệt trước khi gửi đề xuất.');
  }
  const priceZone = document.getElementById('mhItPriceRetailZone').value;
  const extraFilesInput = document.getElementById('mhItPriceExtraFiles');
  let extraFiles = [];
  if (extraFilesInput.files && extraFilesInput.files.length > 0) {
    try {
      extraFiles = await Promise.all(Array.from(extraFilesInput.files).map(f => uploadFileToServer(f, 'itPrice')));
    } catch (err) {
      return alert(`⛔ Tải tài liệu bổ sung thất bại: ${err.message}`);
    }
  }
  let customData;
  try {
    customData = await collectDynamicFieldsData('IT_PRICE_RETAIL');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const payload = {
    code,
    priceType: 'RETAIL',
    priceTier: null,
    wholesaleApplyUnit: null,
    priceZone: priceZone || null,
    masterListId: masterListId ? Number(masterListId) : null,
    files: [{
      fileUrl: mhItPricePendingFile.fileUrl, fileName: mhItPricePendingFile.fileName,
      items: mhItPricePendingFile.items, columnLabels: mhItPricePendingFile.columnLabels
    }],
    extraFiles,
    reason: document.getElementById('mhItPriceReason').value.trim(),
    storeScope: { mode: 'ALL', stores: [] },
    effectiveDate: new Date().toLocaleDateString('en-CA'),
    expiryMode: 'PERMANENT',
    expiryDate: null,
    createdAt: new Date().toLocaleString('vi-VN'),
    customData
  };

  let newItem;
  try {
    const result = await callCreateAction('itPriceApprovals', payload);
    newItem = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.itPriceApprovals.unshift(newItem);
  logSystemAction('IT_SUPPORT', 'CREATE_IT_PRICE_APPROVAL', `Tạo đề xuất duyệt giá [${code}]`, 'SUCCESS', code);

  const wfConfig = resolveItPriceWorkflowConfigForItemClient(newItem);
  const firstStepApprovers = resolveEffectiveStepApprovers(wfConfig, 1);
  if (firstStepApprovers.length) {
    notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_APPROVAL_NEEDED', code, firstStepApprovers,
      `[VPDT] Đề xuất duyệt giá ${code} cần bạn phê duyệt`,
      `Đề xuất duyệt giá (${code}) do ${currentUser.name} đề xuất đang chờ bạn phê duyệt.`);
  }
  alert('✅ Đã gửi đề xuất duyệt giá thành công!');
  resetMhItPriceForm();
}

// "🔍 Xem Quy Trình" cho form Bán Lẻ (Mua Hàng, 10/2026) — mirror ĐÚNG nhánh RETAIL của
// previewItPriceWorkflow() ở module-itsupport-price.js (dùng chung
// resolveItPriceDeptWorkflowConfigClient()/openGenericWorkflowPreviewModal(), không viết logic riêng),
// chỉ đổi id đọc field (mhItPriceDeptDisplay thay vì itPriceDeptDisplay chung cũ).
function previewMhItPriceWorkflow() {
  const dept = document.getElementById('mhItPriceDeptDisplay').value;
  if (!dept) return alert('Tài khoản của bạn chưa được gán phòng ban nên chưa xác định được quy trình phê duyệt!');
  openGenericWorkflowPreviewModal(
    '🔍 Xem Trước Quy Trình Phê Duyệt Giá Bán Lẻ',
    `Phòng ban: ${dept}`,
    resolveItPriceDeptWorkflowConfigClient(dept, 'RETAIL'),
    `Phòng ban "${dept}" chưa được cấu hình quy trình phê duyệt giá Bán Lẻ.`
  );
}

function resetMhItPriceForm() {
  const formEl = document.getElementById('mhItPriceCreateForm');
  if (!formEl) return;
  formEl.reset();
  activeItPriceSubTab = 'RETAIL';
  mhItPricePendingFile = null;
  document.getElementById('mhItPriceFileStatus').innerText = '';
  document.getElementById('mhItPriceFilePreviewWrap').classList.add('hidden');
  document.getElementById('mhItPriceCode').value = generateItPriceCode();
  document.getElementById('mhItPriceDeptDisplay').value = currentUser.dept;
  document.getElementById('mhItPriceRetailZone').value = '';
  renderMhItPriceMasterListSelect();
  clearSingleFileInput('mhItPriceFileInput', 'mhItPriceFileChip');
  clearMultiFileInput('mhItPriceExtraFiles', 'mhItPriceExtraFilesChip');
}
