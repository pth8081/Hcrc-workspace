// ==========================================
// VĂN PHÒNG PHẨM — kỳ đăng ký (vppPeriods) + đăng ký của nhân viên (vppRegistrations). 3 sub-tab:
// Đăng Ký (ai cũng vào được) / Kỳ Đăng Ký + Báo Cáo Tổng Hợp (chỉ vppManage/admin).
// ==========================================
function canManageVpp(user) {
  return !!(user?.perms?.admin || user?.perms?.vppManage);
}

// Tổng tiền của 1 đăng ký (dùng chung cho form đăng ký hiện tổng realtime + báo cáo Tổng Hợp Theo
// Phòng Ban) — items đã snapshot đúng đơn giá của danh mục kỳ tại thời điểm chọn, mặt hàng chưa có
// đơn giá (price=null) coi như 0đ, không làm hỏng tổng của các mặt hàng khác.
function vppCalcItemsTotal(items) {
  return (items || []).reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
}

// Số nhân sự đang hoạt động (chưa bị khoá) của 1 phòng ban — dùng làm giá trị GỢI Ý ban đầu cho bảng
// "Nhân sự theo phòng ban" lúc tạo kỳ, admin vẫn sửa tay lại được (xem renderVppDeptHeadcountTable()).
function vppActiveHeadcountForDept(dept) {
  return DB.users.filter(u => u.dept === dept && u.active !== false && !isUserVppExcluded(u)).length;
}

// Mirror CHÍNH XÁC resolveVppDeptBudget() ở lib/vppCatalog.js (server) — CHỈ dùng để HIỂN THỊ ở báo cáo
// "Tổng Hợp Theo Phòng Ban" (renderVppReports()), KHÔNG phải nơi chặn thật (chặn thật luôn tính lại ở
// server dưới khoá vpp_dept_budget:<periodId>:<dept>, xem submitVppRegistration()/routes/records.js).
function vppResolveDeptBudgetClient(period, dept) {
  const rateOverride = period?.deptBudgetRates?.[dept];
  const rate = (typeof rateOverride === 'number' && rateOverride > 0) ? rateOverride : (Number(period?.perPersonBudget) || 0);
  const headcount = Number(period?.deptHeadcounts?.[dept]) || 0;
  return { rate, headcount, totalBudget: rate * headcount };
}

// TỪ v22.8: mức/người riêng theo phòng ban đổi cách nhập — thay vì 1 dòng/1 ô "Mức/Người" trong bảng
// (cồng kềnh khi nhiều phòng ban, mỗi lần đổi phải sửa từng ô), admin chọn 1 trong 2 chế độ:
// - DEFAULT (mặc định): 1 mức chung áp dụng TOÀN CÔNG TY, y hệt hành vi trước v22.5.
// - GROUPS: định nghĩa nhiều "Nhóm mức riêng" (vppRateGroups), mỗi nhóm gồm 1 mức tiền + chọn NHIỀU
//   phòng ban áp dụng (renderMultiSelectDropdown() dùng chung, core.js) — phòng chưa vào nhóm nào dùng
//   mức mặc định. Lúc Lưu, collectVppDeptBudgetRates() vẫn "xoè" ra ĐÚNG khuôn dữ liệu cũ
//   {dept: rate} (period.deptBudgetRates) — server (resolveVppDeptBudget(), lib/vppCatalog.js) và mọi
//   nơi đọc lại period đã lưu (báo cáo, resolveVppDeptBudget ở client...) KHÔNG cần sửa gì cả.
let vppRateMode = 'DEFAULT';
let vppRateGroups = []; // { id, rate, depts: [] } — chỉ tồn tại trong lúc điền form "Tạo Kỳ Đăng Ký Mới"
let vppRateGroupNextId = 1;

// Màu riêng cho từng nhóm (viền/nền card + chip multi-select + màu chữ ở bảng xem trước) — lặp vòng nếu
// nhiều hơn 5 nhóm, chỉ để phân biệt trực quan, không mang ý nghĩa nghiệp vụ gì.
const VPP_RATE_GROUP_COLORS = [
  { border: 'border-indigo-200', bg: 'bg-indigo-50', title: 'text-indigo-800', chip: 'bg-indigo-100 text-indigo-700', hover: 'hover:bg-indigo-50', text: 'text-indigo-700' },
  { border: 'border-emerald-200', bg: 'bg-emerald-50', title: 'text-emerald-800', chip: 'bg-emerald-100 text-emerald-700', hover: 'hover:bg-emerald-50', text: 'text-emerald-700' },
  { border: 'border-amber-200', bg: 'bg-amber-50', title: 'text-amber-800', chip: 'bg-amber-100 text-amber-700', hover: 'hover:bg-amber-50', text: 'text-amber-700' },
  { border: 'border-sky-200', bg: 'bg-sky-50', title: 'text-sky-800', chip: 'bg-sky-100 text-sky-700', hover: 'hover:bg-sky-50', text: 'text-sky-700' },
  { border: 'border-rose-200', bg: 'bg-rose-50', title: 'text-rose-800', chip: 'bg-rose-100 text-rose-700', hover: 'hover:bg-rose-50', text: 'text-rose-700' }
];
function vppRateGroupColor(idx) { return VPP_RATE_GROUP_COLORS[idx % VPP_RATE_GROUP_COLORS.length]; }

function setVppRateMode(mode) {
  vppRateMode = mode;
  const activeCls = 'flex-1 py-2 bg-orange-600 text-white';
  const inactiveCls = 'flex-1 py-2 bg-gray-100 text-gray-600';
  document.getElementById('btnVppRateModeDefault').className = mode === 'DEFAULT' ? activeCls : inactiveCls;
  document.getElementById('btnVppRateModeGroups').className = mode === 'GROUPS' ? activeCls : inactiveCls;
  document.getElementById('vppRateGroupsWrap').classList.toggle('hidden', mode !== 'GROUPS');
  document.getElementById('vppDefaultRateLabel').textContent = mode === 'GROUPS'
    ? 'Mức mặc định (VNĐ) — áp dụng cho phòng ban CHƯA chọn ở nhóm nào bên dưới'
    : 'Mức/Người (VNĐ) — áp dụng cho TẤT CẢ phòng ban (tuỳ chọn, để trống = không giới hạn)';
  if (mode === 'GROUPS' && !vppRateGroups.length) addVppRateGroup();
  renderVppDeptHeadcountTable();
}

// Tập hợp phòng ban đã thuộc nhóm KHÁC (khác excludeId) — dùng để loại khỏi danh sách tìm-chọn của 1
// nhóm, đảm bảo "mỗi phòng ban chỉ thuộc ĐÚNG 1 nhóm" ngay từ lúc chọn (không cần validate sau).
function vppRateGroupAssignedDepts(excludeId) {
  const set = new Set();
  vppRateGroups.forEach(g => { if (g.id !== excludeId) g.depts.forEach(d => set.add(d)); });
  return set;
}

function addVppRateGroup() {
  vppRateGroups.push({ id: vppRateGroupNextId++, rate: 0, depts: [] });
  renderVppRateGroupsList();
}

function removeVppRateGroup(id) {
  vppRateGroups = vppRateGroups.filter(g => g.id !== Number(id));
  renderVppRateGroupsList();
  renderVppDeptHeadcountTable();
}

function onVppRateGroupRateInput(id, input) {
  const g = vppRateGroups.find(x => x.id === Number(id));
  if (g) g.rate = getMoneyValue(input);
  renderVppDeptHeadcountTable();
}

function renderVppRateGroupsList() {
  const wrap = document.getElementById('vppRateGroupsList');
  if (!wrap) return;
  wrap.innerHTML = vppRateGroups.map((g, idx) => {
    const c = vppRateGroupColor(idx);
    return `
      <div class="border-2 ${c.border} ${c.bg} rounded-lg p-3 space-y-2">
        <div class="flex justify-between items-center">
          <span class="font-bold ${c.title} text-xs">🏷️ Nhóm mức riêng #${idx + 1}</span>
          <button type="button" data-op="removeVppRateGroup" data-arg0="${g.id}" class="text-red-500 text-xs font-bold hover:underline">🗑️ Xoá nhóm</button>
        </div>
        <div>
          <label class="block text-[11px] font-semibold text-gray-600 mb-1">Mức/Người (VNĐ) cho nhóm này</label>
          <input type="text" inputmode="numeric" value="${g.rate > 0 ? g.rate.toLocaleString('vi-VN') : ''}" placeholder="VD: 150.000" data-op-input="onVppRateGroupRateInput" data-arg0="${g.id}" data-arg-el="1" class="w-full border p-2 rounded font-bold money-input bg-white">
        </div>
        <div>
          <label class="block text-[11px] font-semibold text-gray-600 mb-1">Áp dụng cho các phòng ban (chọn nhiều)</label>
          <div id="vppRateGroupDeptSelect_${g.id}"></div>
        </div>
      </div>
    `;
  }).join('');
  vppRateGroups.forEach((g, idx) => {
    const c = vppRateGroupColor(idx);
    const excluded = vppRateGroupAssignedDepts(g.id);
    const availableDepts = DB.depts.filter(d => !excluded.has(d));
    renderMultiSelectDropdown(`vppRateGroupDeptSelect_${g.id}`, availableDepts, g.depts, {
      placeholder: 'Tìm phòng ban để thêm...', emptyText: 'Chưa chọn phòng ban nào.',
      chipClass: c.chip, hoverClass: c.hover,
      onChange: (values) => { g.depts = values; renderVppDeptHeadcountTable(); }
    });
  });
}

// Mức áp dụng thật sự cho 1 phòng ban theo chế độ đang chọn — trả kèm groupIdx (-1 = đang dùng mức mặc
// định, KHÔNG thuộc nhóm nào) để renderVppDeptHeadcountTable() tô màu đúng nhóm ở bảng xem trước.
function vppEffectiveDeptRate(dept) {
  const defaultRate = getMoneyValue(document.getElementById('vppNewPeriodBudget'));
  if (vppRateMode === 'GROUPS') {
    const idx = vppRateGroups.findIndex(g => g.depts.includes(dept));
    if (idx !== -1 && vppRateGroups[idx].rate > 0) return { rate: vppRateGroups[idx].rate, groupIdx: idx };
  }
  return { rate: defaultRate, groupIdx: -1 };
}

// Dựng bảng "Nhân sự theo phòng ban" — gọi lại mỗi khi đổi chế độ/mức mặc định/nhóm (không còn ô Mức/
// Người sửa tay ngay trong bảng như trước v22.8 nên render lại toàn bộ không lo mất focus đang gõ dở ở
// CHỖ KHÁC — chỉ giữ lại đúng giá trị Số Nhân Sự đã sửa tay trước đó, không reset về gợi ý ban đầu).
function renderVppDeptHeadcountTable() {
  const tbody = document.getElementById('vppDeptHeadcountBody');
  if (!tbody) return;
  const prevHeadcounts = {};
  tbody.querySelectorAll('tr').forEach(tr => {
    const dept = tr.dataset.vppDept;
    const hc = tr.querySelector('.vpp-headcount-input')?.value;
    if (dept !== undefined) prevHeadcounts[dept] = hc;
  });
  tbody.innerHTML = DB.depts.map(dept => {
    const headcount = dept in prevHeadcounts ? Math.max(0, Math.round(Number(prevHeadcounts[dept]) || 0)) : vppActiveHeadcountForDept(dept);
    const { rate, groupIdx } = vppEffectiveDeptRate(dept);
    const deptBudget = rate * headcount;
    const rateColorCls = groupIdx === -1 ? 'text-gray-500 font-normal' : `font-bold ${vppRateGroupColor(groupIdx).text}`;
    return `
      <tr data-vpp-dept="${escapeHtml(dept)}">
        <td class="border p-1.5">${escapeHtml(dept)}</td>
        <td class="border p-1"><input type="number" min="0" step="1" value="${headcount}" data-op-input="onVppHeadcountInput" data-arg-el="0" class="vpp-headcount-input w-24 border p-1 rounded text-xs text-center"></td>
        <td class="border p-1.5 text-right text-xs ${rateColorCls}">${rate > 0 ? rate.toLocaleString('vi-VN') : '—'}</td>
        <td class="border p-1.5 text-right font-semibold text-orange-700 vpp-dept-budget-cell">${rate > 0 ? deptBudget.toLocaleString('vi-VN') + ' đ' : '—'}</td>
      </tr>`;
  }).join('');
}

// Sửa tay 1 dòng "Số Nhân Sự" -> chỉ cập nhật đúng ô "Ngân Sách Phòng Ban" của dòng đó.
function onVppHeadcountInput(input) {
  const tr = input.closest('tr');
  const { rate } = vppEffectiveDeptRate(tr?.dataset.vppDept);
  const headcount = Math.max(0, Math.round(Number(input.value) || 0));
  const cell = tr?.querySelector('.vpp-dept-budget-cell');
  if (cell) cell.textContent = rate > 0 ? `${(rate * headcount).toLocaleString('vi-VN')} đ` : '—';
}

// Đọc lại bảng "Nhân sự theo phòng ban" thành {dept: headcount} để gửi lên server lúc Tạo Kỳ Đăng Ký.
function collectVppDeptHeadcounts() {
  const out = {};
  document.querySelectorAll('#vppDeptHeadcountBody tr').forEach(tr => {
    const dept = tr.dataset.vppDept;
    const hcInput = tr.querySelector('.vpp-headcount-input');
    if (!dept || !hcInput) return;
    const n = Math.max(0, Math.round(Number(hcInput.value) || 0));
    if (n > 0) out[dept] = n;
  });
  return out;
}

// "Xoè" vppRateGroups (chế độ GROUPS) thành {dept: mức/người RIÊNG} — ĐÚNG khuôn dữ liệu cũ
// (period.deptBudgetRates) mà server (resolveVppDeptBudget(), lib/vppCatalog.js) đã đọc từ trước v22.8,
// không cần sửa gì phía server. Chế độ DEFAULT trả về {} (rỗng) — mọi phòng dùng thẳng
// period.perPersonBudget, khớp hành vi trước v22.5.
function collectVppDeptBudgetRates() {
  const out = {};
  if (vppRateMode === 'GROUPS') {
    vppRateGroups.forEach(g => {
      if (g.rate > 0) g.depts.forEach(dept => { out[dept] = g.rate; });
    });
  }
  return out;
}

// Kỳ coi là ĐANG MỞ nếu status=OPEN VÀ (không đặt ngày kết thúc HOẶC chưa qua ngày kết thúc) — khớp
// đúng điều kiện server kiểm tra ở lib/createValidation.js CREATE_MODULE_CONFIGS.vppRegistrations.
function vppPeriodIsOpen(p) {
  if (p.status !== 'OPEN') return false;
  if (!p.endDate) return true;
  const todayStr = new Date().toISOString().slice(0, 10);
  return todayStr <= p.endDate;
}

function setVppSubTab(subTab) {
  window.scrollTo({ top: 0, behavior: 'auto' }); // Tránh "bay xuống cuối" khi đổi tab con — xem setSystemSubTab().
  // "📊 Báo Cáo" giờ TÁCH RIÊNG khỏi "🗓️ Kỳ" (10/2026, đợt "checkbox phân quyền Báo Cáo theo module/tab/
  // sub-tab") — canSeeReports cộng thêm vppReportView (quyền CHỈ XEM báo cáo, KHÔNG kèm cấu hình Kỳ)
  // song song canManageVpp(), KHÔNG sửa hàm đó (dùng chung cho hành động quản lý/cấu hình thật ở nơi
  // khác) — xem canViewVppRegistration() ở lib/recordViewScope.js cho phần bypass dữ liệu tương ứng.
  const canSeeReports = canManageVpp(currentUser) || !!currentUser?.perms?.vppReportView;
  if (subTab === 'PERIODS' && !canManageVpp(currentUser)) subTab = 'REGISTER';
  if (subTab === 'REPORTS' && !canSeeReports) subTab = 'REGISTER';
  activeVppSubTab = subTab;

  document.getElementById('vppSubRegister').classList.toggle('hidden', subTab !== 'REGISTER');
  document.getElementById('vppSubPeriods').classList.toggle('hidden', subTab !== 'PERIODS');
  document.getElementById('vppSubReports').classList.toggle('hidden', subTab !== 'REPORTS');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-orange-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnVppSubRegister').className = subTab === 'REGISTER' ? activeCls : inactiveCls;
  // Gộp tô màu active/inactive + ẩn/hiện theo quyền trong ĐÚNG 1 lần gán className (KHÔNG tách riêng
  // classList.toggle('hidden',...) rồi gán className đè lên sau — sẽ xoá mất class "hidden" vừa toggle,
  // cùng lỗi đã bắt được ở setMeetingSubTab(), module-phonghop.js).
  document.getElementById('btnVppSubPeriods').className = (subTab === 'PERIODS' ? activeCls : inactiveCls) + (canManageVpp(currentUser) ? '' : ' hidden');
  document.getElementById('btnVppSubReports').className = (subTab === 'REPORTS' ? activeCls : inactiveCls) + (canSeeReports ? '' : ' hidden');

  if (subTab === 'REGISTER') { renderVppRegPeriodOptions(); renderVppRegistrations(); }
  if (subTab === 'PERIODS') { renderVppPeriods(); renderVppDeptHeadcountTable(); renderDynamicInputsForModule('VPP', 'dynamicFieldsContainer_VPP'); }
  if (subTab === 'REPORTS') { renderVppReportPeriodOptions(); renderVppReports(); }
}

// ============ ĐĂNG KÝ (mọi nhân viên) ============
function renderVppRegPeriodOptions() {
  const sel = document.getElementById('vppRegPeriodSelect');
  const noPerm = !canRegisterVpp(currentUser);
  document.getElementById('vppRegNoPermNote').classList.toggle('hidden', !noPerm);
  const excluded = !noPerm && isUserVppExcluded(currentUser);
  document.getElementById('vppRegExcludedNote').classList.toggle('hidden', !excluded);
  sel.disabled = noPerm || excluded;
  if (noPerm || excluded) {
    sel.innerHTML = '';
    document.getElementById('vppRegNoPeriodNote').classList.add('hidden');
    document.getElementById('vppRegItemsWrap').classList.add('hidden');
    document.getElementById('vppRegAlreadySentNote').classList.add('hidden');
    vppFormDraftId = null;
    return;
  }
  const openPeriods = DB.vppPeriods.filter(vppPeriodIsOpen);
  sel.innerHTML = `<option value="">-- Chọn kỳ đăng ký --</option>` +
    openPeriods.map(p => `<option value="${p.id}">${escapeHtml(p.name)}${p.endDate ? ` (hạn ${escapeHtml(p.endDate)})` : ''}</option>`).join('');
  document.getElementById('vppRegNoPeriodNote').classList.toggle('hidden', openPeriods.length > 0);
  document.getElementById('vppRegItemsWrap').classList.add('hidden');
  document.getElementById('vppRegAlreadySentNote').classList.add('hidden');
  vppFormDraftId = null;
  sel.value = '';
}

// Bỏ dấu tiếng Việt để so khớp tìm kiếm không phân biệt hoa-thường/dấu — cùng cách xử lý "đ/Đ" độc lập
// (không phải d + dấu) như phía server (xem lib/vppCatalog.js normalizeHeader()).
function vppStripAccents(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Tìm hồ sơ đăng ký (khác REJECTED — REJECTED coi như kết thúc, cho đăng ký lại từ đầu) của CHÍNH
// người dùng hiện tại ở 1 kỳ — quyết định form ở trên hiển thị tạo mới trống, sửa tiếp NHÁP đã lưu,
// hay chỉ xem (đã Gửi/đã duyệt, không sửa qua form này được nữa).
function findOwnVppRegForPeriod(periodId) {
  return DB.vppRegistrations.find(r => r.periodId === periodId && r.creator === currentUser.username && r.status !== 'REJECTED');
}

// vppDeptBudgetStatus: cache trạng thái quỹ ngân sách CỦA PHÒNG BAN currentUser cho kỳ đang mở form
// (GET /api/vpp/dept-budget-status/:periodId — {rate, headcount, totalBudget, used, remaining}, `used`
// đã cộng dồn các đăng ký KHÁC cùng phòng đang PENDING/APPROVED, KHÔNG gồm chính bản nháp đang sửa) —
// nạp 1 LẦN mỗi khi mở/đổi kỳ (refreshVppDeptBudgetStatus() trong onVppRegPeriodChange() bên dưới), rồi
// updateVppRegTotalDisplay() đọc lại số đã cache này mỗi lần gõ số lượng (KHÔNG gọi lại API mỗi lần gõ).
// null = kỳ này chưa đặt ngân sách cho phòng (totalBudget=0) hoặc chưa tải xong/lỗi mạng.
let vppDeptBudgetStatus = null;

async function fetchVppDeptBudgetStatus(periodId) {
  try {
    const res = await fetch(`/api/vpp/dept-budget-status/${periodId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function refreshVppDeptBudgetStatus(periodId) {
  vppDeptBudgetStatus = periodId ? await fetchVppDeptBudgetStatus(periodId) : null;
  updateVppRegTotalDisplay();
}

async function onVppRegPeriodChange() {
  const periodId = Number(document.getElementById('vppRegPeriodSelect').value);
  const wrap = document.getElementById('vppRegItemsWrap');
  const noteEl = document.getElementById('vppRegAlreadySentNote');
  vppFormDraftId = null;
  vppDeptBudgetStatus = null;
  if (!periodId) { wrap.classList.add('hidden'); noteEl.classList.add('hidden'); return; }
  const period = DB.vppPeriods.find(p => p.id === periodId);
  if (!period) { wrap.classList.add('hidden'); noteEl.classList.add('hidden'); return; }

  const existing = findOwnVppRegForPeriod(periodId);
  if (existing && existing.status !== 'DRAFT') {
    wrap.classList.add('hidden');
    noteEl.innerHTML = existing.status === 'APPROVED'
      ? '✅ Bạn đã đăng ký ở kỳ này và đã được phê duyệt — xem chi tiết trong danh sách bên dưới.'
      : '⏳ Bạn đã gửi đăng ký ở kỳ này, đang chờ phê duyệt — xem chi tiết trong danh sách bên dưới. Nếu cần sửa lại nội dung, hãy chờ người duyệt bấm "Yêu cầu bổ sung" để đưa hồ sơ về nháp.';
    noteEl.classList.remove('hidden');
    return;
  }
  noteEl.classList.add('hidden');

  vppFormDraftId = existing ? existing.id : null; // existing (nếu có) chắc chắn đang DRAFT ở nhánh này
  const savedQtyByName = new Map((existing?.items || []).map(it => [it.name, it.qty]));

  document.getElementById('vppRegItemsTableBody').innerHTML = period.catalogItems.map((it, idx) => `
    <tr data-vpp-item-name="${escapeHtml(vppStripAccents(it.name))}">
      <td class="border p-2 text-gray-500">${escapeHtml(it.code || '')}</td>
      <td class="border p-2">${escapeHtml(it.name)}</td>
      <td class="border p-2 text-gray-500">${escapeHtml(it.origin || '')}</td>
      <td class="border p-2 text-gray-500">${escapeHtml(it.unit || '')}</td>
      <td class="border p-2 text-gray-500">${escapeHtml(it.spec || '')}</td>
      <td class="border p-2 text-right text-gray-500">${it.price != null ? Number(it.price).toLocaleString('vi-VN') : ''}</td>
      <td class="border p-1"><input type="number" min="0" step="1" id="vppItemQty_${idx}" value="${savedQtyByName.get(it.name) || ''}" data-op-input="updateVppRegTotalDisplay" class="w-full border p-1 rounded text-xs" placeholder="0"></td>
    </tr>
  `).join('');
  document.getElementById('vppRegItemSearch').value = '';
  document.getElementById('vppRegItemsNoMatch').classList.add('hidden');
  wrap.classList.remove('hidden');
  updateVppRegTotalDisplay();
  refreshVppDeptBudgetStatus(periodId); // async, tự cập nhật lại hiển thị khi tải xong (xem hàm ở trên)

  const submitBtn = document.getElementById('btnVppRegSubmitDraft');
  submitBtn.classList.toggle('hidden', !vppFormDraftId);
  submitBtn.onclick = () => submitVppRegDraftAction(vppFormDraftId, true);
}

// Lọc bảng chọn mặt hàng theo tên — chỉ ẩn/hiện dòng (KHÔNG re-render), giữ nguyên các ô Số lượng đã
// gõ dở, tránh mất dữ liệu khi người dùng vừa tìm kiếm vừa nhập số lượng xen kẽ.
function filterVppRegItemsTable() {
  const kw = vppStripAccents(document.getElementById('vppRegItemSearch').value.trim());
  const rows = [...document.querySelectorAll('#vppRegItemsTableBody tr')];
  let visibleCount = 0;
  rows.forEach(row => {
    const match = !kw || (row.dataset.vppItemName || '').includes(kw);
    row.classList.toggle('hidden', !match);
    if (match) visibleCount++;
  });
  document.getElementById('vppRegItemsNoMatch').classList.toggle('hidden', visibleCount > 0 || rows.length === 0);
}

// resetVppRegForm() — nút "↺ Làm Mới" của bảng chọn mặt hàng & số lượng. KHÔNG phải <form> thật (chỉ là
// 1 bảng cố định theo danh mục của kỳ, không có "thêm dòng" động như Mua Sắm/Sửa Chữa office) nên không
// gọi .reset() được — mỗi <input type=number> số lượng đã có value="..." (thuộc tính HTML thật, không
// chỉ property) đúng bằng số lượng đã lưu nháp (nếu có) tại thời điểm renderItemsTable(), nên gán lại
// input.value = input.defaultValue cho MỌI ô là đủ "quay về trạng thái mặc định" y hệt ý nghĩa
// form.reset() gốc — tự động lùi về ĐÚNG số lượng bản nháp đã lưu (nếu đang sửa tiếp nháp cũ) hoặc về 0
// (nếu đang chọn mới hoàn toàn), không xoá mất bản nháp đã lưu trên server.
function resetVppRegForm() {
  const wrap = document.getElementById('vppRegItemsWrap');
  if (!wrap) return;
  wrap.querySelectorAll('#vppRegItemsTableBody input[type="number"]').forEach(inp => { inp.value = inp.defaultValue || ''; });
  document.getElementById('vppRegItemSearch').value = '';
  filterVppRegItemsTable();
  updateVppRegTotalDisplay();
}

function collectVppRegFormItems(period) {
  return period.catalogItems
    .map((it, idx) => ({ name: it.name, qty: Number(document.getElementById(`vppItemQty_${idx}`)?.value) || 0 }))
    .filter(it => it.qty > 0);
}

// Hiện tổng tiền đang chọn realtime mỗi khi đổi số lượng — so với "Ngân sách / người" của kỳ (nếu
// kỳ có đặt ngân sách). CHỈ hiển thị cảnh báo ở đây, việc CHẶN thật sự nằm ở lúc bấm "Gửi phê duyệt"
// (xem submitVppRegDraftAction()) — cho phép lưu Nháp thoải mái trong lúc còn đang cân nhắc.
// TỪ v22.5: so với "Ngân sách phòng ban CÒN LẠI" (vppDeptBudgetStatus.remaining, đã trừ các đăng ký
// KHÁC cùng phòng đang chờ duyệt/đã duyệt — xem refreshVppDeptBudgetStatus()) thay vì mức trần riêng
// từng người như trước — không giới hạn số tiền của 1 người, chỉ cảnh báo khi phần CÒN LẠI của quỹ
// phòng không đủ cho lựa chọn hiện tại.
function updateVppRegTotalDisplay() {
  const periodId = Number(document.getElementById('vppRegPeriodSelect').value);
  const period = DB.vppPeriods.find(p => p.id === periodId);
  const wrap = document.getElementById('vppRegTotalWrap');
  if (!period || !wrap) return;
  const items = period.catalogItems
    .map((it, idx) => ({ price: it.price, qty: Number(document.getElementById(`vppItemQty_${idx}`)?.value) || 0 }))
    .filter(it => it.qty > 0);
  const total = vppCalcItemsTotal(items);
  const status = vppDeptBudgetStatus;
  const hasBudget = !!(status && status.totalBudget > 0);
  const overBudget = hasBudget && total > status.remaining;
  wrap.innerHTML = `Tổng tiền đã chọn: <span class="${overBudget ? 'text-red-600' : 'text-gray-800'}">${total.toLocaleString('vi-VN')} đ</span>` +
    (hasBudget ? ` / Ngân sách phòng ban còn lại: ${status.remaining.toLocaleString('vi-VN')} đ (trên tổng ${status.totalBudget.toLocaleString('vi-VN')} đ)` : '') +
    (overBudget ? ' <span class="text-red-600">⚠️ Vượt ngân sách còn lại của phòng ban — vui lòng giảm bớt số lượng trước khi gửi phê duyệt.</span>' : '');
}

// "Kết Thúc Chọn (Lưu Nháp)" — tạo hồ sơ NHÁP mới (lần đầu chọn) hoặc cập nhật lại NHÁP đã có (sửa
// tiếp), tuỳ vppFormDraftId. Chưa vào quy trình duyệt — phải bấm "Gửi phê duyệt" riêng mới chuyển bước.
async function saveVppRegDraft() {
  const periodId = Number(document.getElementById('vppRegPeriodSelect').value);
  if (!periodId) return alert('Vui lòng chọn kỳ đăng ký!');
  const period = DB.vppPeriods.find(p => p.id === periodId);
  if (!period) return alert('Không tìm thấy kỳ đăng ký!');

  const items = collectVppRegFormItems(period);
  if (!items.length) return alert('Vui lòng nhập số lượng cho ít nhất 1 mặt hàng!');

  let savedReg;
  try {
    if (vppFormDraftId) {
      const result = await callRecordAction('vppRegistrations', vppFormDraftId, 'update', { items });
      savedReg = result.item;
    } else {
      const payload = {
        code: `DK-VPP-${period.code || period.id}-${currentUser.username}-${Date.now()}`,
        periodId, items, createdAt: new Date().toLocaleString('vi-VN')
      };
      const result = await callCreateAction('vppRegistrations', payload);
      savedReg = result.item;
    }
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.vppRegistrations.findIndex(r => r.id === savedReg.id);
  if (idx !== -1) DB.vppRegistrations[idx] = savedReg; else DB.vppRegistrations.unshift(savedReg);
  vppFormDraftId = savedReg.id;
  logSystemAction('VPP', 'SAVE_VPP_REG_DRAFT', `Lưu nháp đăng ký Văn phòng phẩm kỳ [${period.name}]: ${items.length} mặt hàng`, 'SUCCESS', savedReg.code);
  alert('✅ Đã lưu nháp — bạn có thể sửa tiếp hoặc bấm "Gửi phê duyệt" khi đã chọn xong.');
  renderVppRegistrations();

  const submitBtn = document.getElementById('btnVppRegSubmitDraft');
  submitBtn.classList.remove('hidden');
  submitBtn.onclick = () => submitVppRegDraftAction(vppFormDraftId, true);
}

// "Gửi phê duyệt": NHÁP -> CHỜ DUYỆT. fromForm=true khi bấm từ form đăng ký (ẩn form đi sau khi gửi xong);
// false khi bấm trực tiếp từ dropdown thao tác ở danh sách (không đụng tới form).
async function submitVppRegDraftAction(regId, fromForm) {
  if (!regId) return;
  const r = DB.vppRegistrations.find(x => x.id === regId);
  if (!r) return;
  // Chặn Gửi khi vượt NGÂN SÁCH CÒN LẠI CỦA PHÒNG BAN (không còn theo từng người, xem
  // updateVppRegTotalDisplay()) — luôn TẢI LẠI số liệu mới nhất ngay trước khi gửi (không dùng cache cũ
  // từ lúc mở form, tránh báo sai nếu người khác cùng phòng vừa gửi thêm trong lúc này) để phản hồi
  // tức thì; server vẫn tự kiểm tra lại dưới khoá (submitVppRegistration() ở lib/recordActions.js +
  // withAppLock ở routes/records.js) nên không tin riêng bước này.
  const period = DB.vppPeriods.find(p => p.id === r.periodId);
  if (period) {
    const status = await fetchVppDeptBudgetStatus(period.id);
    const total = vppCalcItemsTotal(r.items);
    if (status && status.totalBudget > 0 && total > status.remaining) {
      return alert(
        `⛔ Ngân sách phòng "${r.dept}" không đủ — đã giữ chỗ ${status.used.toLocaleString('vi-VN')} đ / tổng ${status.totalBudget.toLocaleString('vi-VN')} đ ` +
        `(đăng ký đang chờ duyệt + đã duyệt khác của phòng), còn lại ${status.remaining.toLocaleString('vi-VN')} đ — đăng ký này (${total.toLocaleString('vi-VN')} đ) sẽ vượt quá. ` +
        `Vui lòng sửa nháp và giảm bớt số lượng trước khi gửi.`
      );
    }
  }
  showConfirmModal({
    title: '📤 Xác Nhận Gửi Phê Duyệt',
    bodyHTML: `<p>Gửi đăng ký Văn phòng phẩm kỳ <b>${escapeHtml(r.periodName)}</b> (${r.items.length} mặt hàng) để bắt đầu quy trình phê duyệt? Sau khi gửi sẽ không tự sửa được nữa.</p>`,
    confirmLabel: 'Gửi phê duyệt',
    onConfirm: async () => {
      let result;
      try {
        result = await callRecordAction('vppRegistrations', regId, 'submit', {});
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const updatedReg = result.item;
      const idx = DB.vppRegistrations.findIndex(x => x.id === regId);
      if (idx !== -1) DB.vppRegistrations[idx] = updatedReg;

      logSystemAction('VPP', 'SUBMIT_VPP_REG', `Gửi duyệt đăng ký Văn phòng phẩm [${updatedReg.code}]`, 'SUCCESS', updatedReg.code);
      alert('✅ Đã gửi đăng ký, đang chờ phê duyệt!');
      if (fromForm) { document.getElementById('vppRegItemsWrap').classList.add('hidden'); vppFormDraftId = null; onVppRegPeriodChange(); }
      renderVppRegistrations();

      const wfConfig = DB.vppDeptWorkflows[updatedReg.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
      const approvers = resolveEffectiveStepApprovers(wfConfig, 1);
      if (approvers.length) {
        notifyUsersByEmail('VPP', 'NOTIFY_APPROVAL_NEEDED', updatedReg.code, approvers,
          `[VPDT] Đăng ký Văn phòng phẩm ${updatedReg.code} cần bạn phê duyệt`,
          `Đăng ký Văn phòng phẩm kỳ "${updatedReg.periodName}" của ${updatedReg.creatorName} đang chờ bạn phê duyệt.`);
      }
    }
  });
}

// Xem trước quy trình duyệt đăng ký Văn phòng phẩm. Form đăng ký KHÔNG có ô chọn phòng ban nào (VPP
// forceOwnDept: true ở lib/createValidation.js — luôn là phòng của chính người đăng ký), nên khoá tra
// cứu lấy thẳng từ currentUser.dept thay vì đọc DOM.
function previewVppWorkflow() {
  const dept = currentUser?.dept;
  if (!dept) return alert('Tài khoản của bạn chưa được gán phòng ban nên chưa xác định được quy trình phê duyệt!');
  openGenericWorkflowPreviewModal(
    '🔍 Xem Trước Quy Trình Phê Duyệt Văn Phòng Phẩm',
    `Phòng ban: ${dept}`,
    DB.vppDeptWorkflows[dept],
    `Phòng ban "${dept}" chưa được cấu hình quy trình phê duyệt Văn phòng phẩm.`
  );
}

function vppRegStatusBadge(r) {
  if (r.status === 'DRAFT') return `<span class="px-2 py-0.5 bg-gray-200 text-gray-700 rounded font-bold text-xs">📝 Nháp</span>`;
  if (r.status === 'APPROVED') return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã phê duyệt</span>`;
  if (r.status === 'REJECTED') return `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Từ chối</span>`;
  if (r.status === 'CANCELLED') return `<span class="px-2 py-0.5 bg-slate-200 text-slate-700 rounded font-bold text-xs">🚫 Đã hủy</span>`;
  return `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-xs">⏳ Chờ duyệt</span>`;
}

function onVppFilterChange() {
  resetListPage('vppReg');
  renderVppRegistrations();
}

function filterVppByCard(status) {
  applyDashboardCardFilter({ filterStatusVpp: status }, 'vppReg', renderVppRegistrations);
}

function renderVppRegistrations() {
  const tbody = document.getElementById('vppRegTableBody');
  if (!tbody) return;

  const canManage = canManageVpp(currentUser);
  const statusFilter = document.getElementById('filterStatusVpp')?.value || '';
  const scopedVppRegs = DB.vppRegistrations.filter(r =>
    canManage || r.creator === currentUser.username || isApproverForDeptWorkflow(DB.vppDeptWorkflows[r.dept], currentUser.username));

  const vppDashCards = [
    { key: '', label: 'Tổng Đăng Ký', count: scopedVppRegs.length, colorClass: 'border-l-blue-500' },
    { key: 'PENDING', label: 'Đang Chờ Duyệt', count: scopedVppRegs.filter(r => r.status === 'PENDING').length, colorClass: 'border-l-yellow-500' },
    { key: 'APPROVED', label: 'Đã Phê Duyệt', count: scopedVppRegs.filter(r => r.status === 'APPROVED').length, colorClass: 'border-l-green-500' },
    { key: 'REJECTED', label: 'Từ Chối', count: scopedVppRegs.filter(r => r.status === 'REJECTED').length, colorClass: 'border-l-red-500' },
    { key: 'CANCELLED', label: 'Đã Hủy', count: scopedVppRegs.filter(r => r.status === 'CANCELLED').length, colorClass: 'border-l-slate-500' }
  ];
  const dashEl = document.getElementById('vppDashboardCards');
  if (dashEl) dashEl.innerHTML = buildDashboardCardsHTML(vppDashCards, statusFilter, 'filterVppByCard');

  const visible = scopedVppRegs.filter(r => !statusFilter || r.status === statusFilter);

  document.getElementById('paginationContainer_vppReg').innerHTML = buildPaginationBoxHTML('vppReg', 'renderVppRegistrations');
  const page = paginateList('vppReg', visible, 'renderVppRegistrations', 'đăng ký');

  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center p-6 text-gray-500 italic">Chưa có đăng ký nào.</td></tr>`;
    return;
  }

  tbody.innerHTML = page.map(r => {
    const wfConfig = DB.vppDeptWorkflows[r.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
    const currentStepApprovers = resolveEffectiveStepApprovers(wfConfig, r.currentStep);
    const canApprove = (r.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, r.history, r.currentStep);
    const isOwnDraft = r.status === 'DRAFT' && r.creator === currentUser.username;

    let primaryBtnHTML;
    const secondaryOptions = [];
    if (isOwnDraft) {
      primaryBtnHTML = `<button data-op="editVppRegDraft" data-arg0="${r.id}" class="px-2.5 py-1 bg-gray-600 text-white rounded text-xs hover:opacity-90 font-bold">✏️ Sửa Nháp</button>`;
      secondaryOptions.push({ value: 'submit', label: 'Gửi phê duyệt' });
    } else {
      primaryBtnHTML = canApprove
        ? `<button data-op="openVppRegModal" data-arg0="${r.id}" class="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs hover:opacity-90 font-bold">✍️ Xử lý / Duyệt</button>`
        : `<button data-op="openVppRegModal" data-arg0="${r.id}" class="px-2.5 py-1 bg-gray-600 text-white rounded text-xs hover:opacity-90 font-bold">👁️ Xem chi tiết</button>`;
    }
    // "Hủy đăng ký" — chỉ khi ĐANG chờ duyệt bước 1 (chưa ai duyệt gì), người tạo hoặc admin — mirror
    // canCancelOfficeReq() ở module-office.js/lib/recordActions.js.
    if (r.status === 'PENDING' && (r.currentStep || 1) <= 1 && (currentUser.perms?.admin || r.creator === currentUser.username)) {
      secondaryOptions.push({ value: 'cancelReg', label: '🚫 Hủy Đăng Ký' });
    }
    if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2">${escapeHtml(r.periodName || '')}</td>
        <td class="border p-2">${escapeHtml(r.creatorName)}<br><span class="text-xs text-gray-500">${escapeHtml(r.dept)}</span></td>
        <td class="border p-2 text-center">${r.items.length}</td>
        <td class="border p-2">${vppRegStatusBadge(r)}</td>
        <td class="border p-2 text-center space-x-1">${buildActionCell(r.id, primaryBtnHTML, secondaryOptions, 'runVppRegAction')}</td>
      </tr>
    `;
  }).join('');
}

// "Sửa Nháp" ở danh sách -> chọn đúng kỳ trong form phía trên rồi nạp lại nội dung NHÁP để sửa tiếp
// (dùng chung onVppRegPeriodChange() — form tự nhận ra đây là NHÁP của chính mình qua findOwnVppRegForPeriod()).
function editVppRegDraft(id) {
  const r = DB.vppRegistrations.find(x => x.id === id);
  if (!r) return;
  document.getElementById('vppRegPeriodSelect').value = String(r.periodId);
  onVppRegPeriodChange();
  document.getElementById('vppRegItemsWrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function runVppRegAction(id, action) {
  switch (action) {
    case 'submit': submitVppRegDraftAction(id, false); break;
    case 'cancelReg': openCancelVppRegModal(id); break;
    case 'delete': deleteVppRegAction(id); break;
  }
}

// "Hủy đăng ký" (PENDING bước 1) — mirror ĐÚNG openCancelOfficeReqModal() ở module-office.js. reason
// KHÔNG bắt buộc, cùng khuôn Đăng Ký Xe/Phòng Họp/Văn Phòng.
function openCancelVppRegModal(id) {
  const r = DB.vppRegistrations.find(x => x.id === id);
  if (!r) return;
  const reason = prompt('Lý do hủy đăng ký (không bắt buộc):', '');
  if (reason === null) return;
  showConfirmModal({
    title: '🚫 Xác Nhận Hủy Đăng Ký',
    bodyHTML: `<p>Hủy đăng ký Văn phòng phẩm <b>${escapeHtml(r.code)}</b> (${escapeHtml(r.periodName || '')})?</p>${reason.trim() ? `<p class="mt-2 italic text-gray-600">Lý do: "${escapeHtml(reason.trim())}"</p>` : ''}<p class="mt-2 text-red-600 font-semibold">Đăng ký đã hủy không thể phục hồi lại.</p>`,
    confirmLabel: 'Hủy Đăng Ký',
    onConfirm: async () => {
      let result;
      try {
        result = await callRecordAction('vppRegistrations', id, 'cancel', { reason: reason.trim() });
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.vppRegistrations.findIndex(x => x.id === id);
      if (idx !== -1) DB.vppRegistrations[idx] = result.item;
      logSystemAction('VPP', 'CANCEL_VPP_REG', `Hủy đăng ký Văn phòng phẩm [${result.item.code}]`, 'SUCCESS', result.item.code);
      alert('✅ Đã hủy đăng ký!');
      renderVppRegistrations();
      refreshApprovalSurfaces();
    }
  });
}

function deleteVppRegAction(id) {
  const r = DB.vppRegistrations.find(x => x.id === id);
  if (!r) return;
  deleteRecordAdminOnly('vppRegistrations', id, `đăng ký Văn phòng phẩm ${r.code}`, () => {
    DB.vppRegistrations = DB.vppRegistrations.filter(x => x.id !== id);
    logSystemAction('VPP', 'DELETE_VPP_REG', `Xóa đăng ký Văn phòng phẩm [${r.code}]`, 'SUCCESS', r.code);
    renderVppRegistrations();
  });
}

function openVppRegModal(regId) {
  currentProcessingVppRegId = regId;
  const r = DB.vppRegistrations.find(item => item.id === regId);
  if (!r) return;

  const wfConfig = DB.vppDeptWorkflows[r.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const wf = DB.workflows.find(w => w.id === wfConfig.workflowId) || { steps: [{ name: 'Sếp duyệt' }] };

  document.getElementById('vppRegModalTitle').innerText = `🖇️ Xử Lý Đăng Ký Văn Phòng Phẩm: ${r.code}`;
  document.getElementById('vppRegModalSub').innerText = `Kỳ: ${r.periodName} | Phòng ban: ${r.dept} | Người đăng ký: ${r.creatorName}`;

  const itemsTotal = r.items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
  document.getElementById('vppRegModalItems').innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full border-collapse border text-xs bg-white">
        <thead><tr class="bg-gray-100 text-left">
          <th class="border p-1">Mã hàng</th><th class="border p-1">Mặt hàng</th><th class="border p-1">Đơn vị</th>
          <th class="border p-1 text-center">Số lượng</th><th class="border p-1 text-right">Đơn giá</th><th class="border p-1 text-right">Thành tiền</th>
        </tr></thead>
        <tbody>
          ${r.items.map(it => `<tr>
            <td class="border p-1 text-gray-500">${escapeHtml(it.code || '')}</td>
            <td class="border p-1">${escapeHtml(it.name)}</td>
            <td class="border p-1">${escapeHtml(it.unit)}</td>
            <td class="border p-1 text-center">${it.qty}</td>
            <td class="border p-1 text-right">${it.price != null ? Number(it.price).toLocaleString('vi-VN') : ''}</td>
            <td class="border p-1 text-right">${it.price != null ? (it.price * it.qty).toLocaleString('vi-VN') : ''}</td>
          </tr>`).join('')}
        </tbody>
        ${itemsTotal ? `<tfoot><tr class="font-bold bg-gray-50"><td class="border p-1" colspan="5">Tổng cộng</td><td class="border p-1 text-right">${itemsTotal.toLocaleString('vi-VN')}</td></tr></tfoot>` : ''}
      </table>
    </div>
  `;
  document.getElementById('txtVppRegComment').value = '';

  const historyHTML = (r.history || []).map(h => `
    <div class="bg-white p-2 rounded border text-xs space-y-1">
      <div class="flex justify-between font-bold text-gray-700">
        <span>${escapeHtml(h.approver)} (${escapeHtml(h.username)})</span>
        <span class="text-gray-400 font-normal">${escapeHtml(h.time)}</span>
      </div>
      <div class="text-gray-600">Hành động: <span class="font-bold text-blue-600">${escapeHtml(h.action)}</span> — Bước ${h.step}${h.stepName ? ` (${escapeHtml(h.stepName)})` : ''}</div>
      ${h.comment ? `<div class="text-gray-800 bg-amber-50 p-1.5 rounded border italic">"${escapeHtml(h.comment)}"</div>` : ''}
    </div>
  `).join('');
  document.getElementById('vppRegModalHistory').innerHTML = historyHTML || '<div class="text-gray-400 italic">Chưa có lịch sử xử lý.</div>';

  const currentStepApprovers = resolveEffectiveStepApprovers(wfConfig, r.currentStep);
  const canApprove = (r.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, r.history, r.currentStep);
  const actionBtns = document.getElementById('vppRegModalActionBtns');
  if (canApprove) {
    const stepActionLabel = resolveStepActionLabel(wf, r.currentStep);
    actionBtns.innerHTML = `
      <button data-op="confirmProcessVppReg" data-arg0="REJECT" class="bg-red-600 text-white px-4 py-1.5 rounded font-bold hover:bg-red-700 text-xs">❌ Từ Chối</button>
      <button data-op="confirmProcessVppReg" data-arg0="REQUEST_CHANGES" class="bg-amber-500 text-white px-4 py-1.5 rounded font-bold hover:bg-amber-600 text-xs">🔄 Yêu Cầu Bổ Sung</button>
      <button data-op="confirmProcessVppReg" data-arg0="APPROVE" class="bg-green-600 text-white px-5 py-1.5 rounded font-bold hover:bg-green-700 text-xs">✅ ${escapeHtml(stepActionLabel)} & Chuyển Bước</button>
    `;
  } else {
    actionBtns.innerHTML = `<span class="text-gray-500 italic text-xs">Bạn chỉ có quyền xem thông tin đăng ký này.</span>`;
  }

  document.getElementById('vppRegModal').classList.remove('hidden');
}

function closeVppRegModal() {
  document.getElementById('vppRegModal').classList.add('hidden');
  currentProcessingVppRegId = null;
}

function confirmProcessVppReg(actionType) {
  const comment = document.getElementById('txtVppRegComment').value.trim();
  if (actionType === 'REJECT' && !comment) return alert('Vui lòng nhập lý do từ chối!');
  if (actionType === 'REQUEST_CHANGES' && !comment) return alert('Vui lòng nhập lý do cần bổ sung/chỉnh sửa!');
  const r = DB.vppRegistrations.find(item => item.id === currentProcessingVppRegId);
  const wfConfigForLabel = r ? (DB.vppDeptWorkflows[r.dept] || { workflowId: 'WF_1STEP' }) : {};
  const wfForLabel = DB.workflows.find(w => w.id === wfConfigForLabel.workflowId) || { steps: [] };
  const approveLabel = r ? resolveStepActionLabel(wfForLabel, r.currentStep) : 'Phê Duyệt';
  const titleMap = { APPROVE: `✅ Xác Nhận ${approveLabel}`, REJECT: '❌ Xác Nhận Từ Chối', REQUEST_CHANGES: '🔄 Xác Nhận Yêu Cầu Bổ Sung' };
  const labelMap = { APPROVE: approveLabel, REJECT: 'Từ Chối', REQUEST_CHANGES: 'Yêu Cầu Bổ Sung' };
  // escapeHtml(approveLabel) — actionLabel admin tự gõ, bodyHTML gán qua .innerHTML (showConfirmModal()).
  const actionTextMap = { APPROVE: escapeHtml(approveLabel.toLowerCase()), REJECT: 'từ chối', REQUEST_CHANGES: 'yêu cầu bổ sung/chỉnh sửa (đưa hồ sơ về nháp để người đăng ký sửa lại)' };
  showConfirmModal({
    title: titleMap[actionType],
    bodyHTML: `<p>Bạn có chắc chắn muốn <b>${actionTextMap[actionType]}</b> đăng ký này?</p>${comment ? `<p class="mt-2 italic text-gray-600">Ghi chú: "${escapeHtml(comment)}"</p>` : ''}`,
    confirmLabel: labelMap[actionType],
    // Xác thực lại (mật khẩu/OTP/PIN) trước khi Duyệt — chỉ áp cho APPROVE, khớp đúng phạm vi
    // withApprovalAuth() (không phải Từ chối/Yêu cầu bổ sung). Mở rộng ra VPP cùng đợt với Tài
    // Liệu/Hợp Đồng ở trên (trước đây chỉ 3/7 module dùng chung engine phê duyệt được bảo vệ).
    onConfirm: () => actionType === 'APPROVE' ? withApprovalAuth(() => processVppReg(actionType)) : processVppReg(actionType)
  });
}

async function processVppReg(actionType) {
  if (!currentProcessingVppRegId) return;
  const r = DB.vppRegistrations.find(item => item.id === currentProcessingVppRegId);
  if (!r) return;
  const comment = document.getElementById('txtVppRegComment').value.trim();
  const actionUrlMap = { APPROVE: 'approve', REJECT: 'reject', REQUEST_CHANGES: 'request-changes' };

  let result;
  try {
    result = await callWorkflowAction('vppRegistrations', r.id, actionUrlMap[actionType], { comment });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }

  const updatedReg = result.item;
  const idx = DB.vppRegistrations.findIndex(item => item.id === r.id);
  if (idx !== -1) DB.vppRegistrations[idx] = updatedReg;

  let msg = '✅ Đã cập nhật trạng thái đăng ký!';
  const transition = result.transition;
  if (transition.type === 'REQUEST_CHANGES') {
    notifyUsersByEmail('VPP', 'NOTIFY_REQUEST_CHANGES', updatedReg.code, [updatedReg.creator],
      `[VPDT] Đăng ký Văn phòng phẩm ${updatedReg.code} cần bổ sung/chỉnh sửa`,
      `Đăng ký Văn phòng phẩm của bạn cần được sửa lại. Lý do: ${comment}. Vui lòng vào mục Văn Phòng Phẩm để sửa và gửi lại.`);
    msg = '✅ Đã yêu cầu bổ sung — hồ sơ đã chuyển về NHÁP để người đăng ký sửa lại!';
  } else if (transition.type === 'REJECTED') {
    notifyUsersByEmail('VPP', 'NOTIFY_REJECTED', updatedReg.code, [updatedReg.creator],
      `[VPDT] Đăng ký Văn phòng phẩm ${updatedReg.code} bị từ chối`,
      `Đăng ký Văn phòng phẩm của bạn đã bị từ chối. Lý do: ${comment}`);
    msg = '✅ Đã từ chối đăng ký!';
  } else if (transition.type === 'ADVANCED') {
    msg = getStepAdvanceMessage(transition.stepApprovers);
    if (transition.nextApprovers.length) {
      notifyUsersByEmail('VPP', 'NOTIFY_APPROVAL_NEEDED', updatedReg.code, transition.nextApprovers,
        `[VPDT] Đăng ký Văn phòng phẩm ${updatedReg.code} cần bạn phê duyệt`,
        `Đăng ký Văn phòng phẩm của ${updatedReg.creatorName} đang chờ bạn phê duyệt ở bước "${transition.nextStepName}".`);
    }
  } else if (transition.type === 'COMPLETED') {
    msg = '✅ Phê duyệt đăng ký Văn phòng phẩm thành công!';
    notifyUsersByEmail('VPP', 'NOTIFY_APPROVED', updatedReg.code, [updatedReg.creator],
      `[VPDT] Đăng ký Văn phòng phẩm ${updatedReg.code} đã được phê duyệt`,
      `Đăng ký Văn phòng phẩm của bạn đã được phê duyệt hoàn tất.`);
  } else if (transition.type === 'PARTIAL_APPROVE') {
    msg = '✅ Đã ghi nhận phê duyệt của bạn — đang chờ các đồng phê duyệt còn lại ở bước này.';
  }

  logSystemAction('VPP', `PROCESS_${actionType}`, `Xử lý đăng ký Văn phòng phẩm [${updatedReg.code}]: ${actionType}`, 'SUCCESS', updatedReg.code);
  alert(msg);
  closeVppRegModal();
  renderVppRegistrations();
  refreshApprovalSurfaces();
}

// ============ KỲ ĐĂNG KÝ (quản lý — chỉ vppManage/admin) ============
let vppPendingCatalog = null; // { items, fileUrl, fileName } — kết quả đọc file gần nhất, chờ bấm "Tạo Kỳ Đăng Ký"

async function onVppCatalogFileChange(event) {
  // Input này đã có data-op-change nghiệp vụ riêng (đọc/xem trước danh mục) từ trước khi có mẫu chip
  // "📎 tên file [✕]" dùng chung (xem onSingleFileChosen()/core.js) — 1 input CHỈ nhận 1 data-op-change
  // duy nhất nên gọi trực tiếp ngay đây thay vì gắn thêm ở HTML, khớp cách xử lý itPriceFileInput (xem
  // module-itsupport-price.js onItPriceFileChange()).
  onSingleFileChosen(event.target, 'vppCatalogFileChip');
  const file = event.target.files[0];
  vppPendingCatalog = null;
  document.getElementById('vppCatalogPreviewWrap').classList.add('hidden');
  const statusEl = document.getElementById('vppCatalogStatus');
  if (!file) { statusEl.innerText = ''; return; }

  statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/vpp/parse-catalog', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    vppPendingCatalog = data;
    statusEl.innerText = `✅ Đọc thành công ${data.items.length} mặt hàng từ file "${data.fileName}".`;
    document.getElementById('vppCatalogPreviewCount').innerText = data.items.length;
    document.getElementById('vppCatalogPreviewBody').innerHTML = data.items.map(it => `<tr>
      <td class="border p-1 text-gray-500">${escapeHtml(it.code || '')}</td>
      <td class="border p-1">${escapeHtml(it.name)}</td>
      <td class="border p-1 text-gray-500">${escapeHtml(it.origin || '')}</td>
      <td class="border p-1 text-gray-500">${escapeHtml(it.unit || '')}</td>
      <td class="border p-1 text-gray-500">${escapeHtml(it.spec || '')}</td>
      <td class="border p-1 text-right text-gray-500">${it.price != null ? Number(it.price).toLocaleString('vi-VN') : ''}</td>
    </tr>`).join('');
    document.getElementById('vppCatalogPreviewWrap').classList.remove('hidden');
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
    clearSingleFileInput('vppCatalogFileInput', 'vppCatalogFileChip'); // dọn luôn chip — tệp vừa chọn bị xoá value, chip cũ hiện sai nếu không xoá theo (khớp lý do clearSingleFileInput() cần gọi tường minh, xem core.js).
  }
}

async function createVppPeriod() {
  const name = document.getElementById('vppNewPeriodName').value.trim();
  const startDate = document.getElementById('vppNewPeriodStart').value;
  const endDate = document.getElementById('vppNewPeriodEnd').value;
  if (!name) return alert('Vui lòng nhập tên kỳ đăng ký!');
  if (!vppPendingCatalog) return alert('Vui lòng tải lên file danh mục mặt hàng!');
  if (startDate && endDate && endDate < startDate) return alert('Ngày kết thúc phải sau ngày bắt đầu!');

  const budgetInput = document.getElementById('vppNewPeriodBudget');
  const perPersonBudget = budgetInput.value.trim() ? getMoneyValue(budgetInput) : null;
  let customData;
  try {
    customData = await collectDynamicFieldsData('VPP');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const payload = {
    code: `VPP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-5)}`,
    name, startDate: startDate || '', endDate: endDate || '',
    catalogItems: vppPendingCatalog.items,
    catalogFileUrl: vppPendingCatalog.fileUrl, catalogFileName: vppPendingCatalog.fileName,
    perPersonBudget, deptHeadcounts: collectVppDeptHeadcounts(), deptBudgetRates: collectVppDeptBudgetRates(),
    createdAt: new Date().toLocaleString('vi-VN'),
    customData
  };

  let newPeriod;
  try {
    const result = await callCreateAction('vppPeriods', payload);
    newPeriod = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.vppPeriods.unshift(newPeriod);
  logSystemAction('VPP', 'CREATE_VPP_PERIOD', `Tạo kỳ đăng ký Văn phòng phẩm [${newPeriod.name}]`, 'SUCCESS', newPeriod.code);
  alert('✅ Đã tạo kỳ đăng ký mới!');

  resetVppNewPeriodForm();
  renderVppPeriods();
}

// resetVppNewPeriodForm() — nút "↺ Làm Mới" (khớp mẫu resetXxxForm dùng chung) VÀ tái dùng lại cho đúng
// phần dọn form sau khi tạo kỳ thành công ở trên (KHÔNG duplicate). Không phải <form> thật (cùng lý do
// resetVppRegForm() ở trên — không có .reset() để gọi) nên set tay từng ô, GIỮ NGUYÊN mặc định
// "100.000" của Ngân sách/người (khớp value="100.000" gõ cứng sẵn trong HTML — không phải rỗng).
function resetVppNewPeriodForm() {
  document.getElementById('vppNewPeriodName').value = '';
  document.getElementById('vppNewPeriodStart').value = '';
  document.getElementById('vppNewPeriodEnd').value = '';
  document.getElementById('vppNewPeriodBudget').value = '100.000'; // mặc định ban đầu 100.000đ/người, admin vẫn sửa được ở lượt tạo kỳ tiếp theo
  document.getElementById('vppCatalogPreviewWrap').classList.add('hidden');
  document.getElementById('vppCatalogStatus').innerText = '';
  vppPendingCatalog = null;
  clearSingleFileInput('vppCatalogFileInput', 'vppCatalogFileChip');
  vppRateGroups = [];
  // PHÁT HIỆN ở đợt audit chuyên sâu lần 3: renderVppDeptHeadcountTable() CỐ TÌNH đọc lại giá trị "Số
  // Nhân Sự" đang có sẵn trong DOM (prevHeadcounts) để giữ nguyên chỉnh sửa tay khi đổi chế độ mức/nhóm
  // (setVppRateMode/addVppRateGroup/removeVppRateGroup) — nhưng "Làm Mới" gọi lại ĐÚNG hàm này nên cũng
  // vô tình giữ luôn số đã sửa tay thay vì tính lại từ nhân sự thật đang hoạt động. Xoá trắng bảng trước
  // để renderVppDeptHeadcountTable() không tìm thấy dòng cũ nào, buộc tính lại từ vppActiveHeadcountForDept().
  const headcountBody = document.getElementById('vppDeptHeadcountBody');
  if (headcountBody) headcountBody.innerHTML = '';
  setVppRateMode('DEFAULT'); // tự gọi lại renderVppDeptHeadcountTable()
}

function vppPeriodStatusBadge(p) {
  if (!vppPeriodIsOpen(p)) return `<span class="px-2 py-0.5 bg-gray-200 text-gray-700 rounded font-bold text-xs">🔒 Đã kết thúc</span>`;
  return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">🟢 Đang mở</span>`;
}

function renderVppPeriods() {
  const tbody = document.getElementById('vppPeriodsTableBody');
  if (!tbody) return;
  if (!DB.vppPeriods.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-gray-500 italic">Chưa có kỳ đăng ký nào.</td></tr>`;
    return;
  }
  tbody.innerHTML = DB.vppPeriods.map(p => {
    const regCount = DB.vppRegistrations.filter(r => r.periodId === p.id).length;
    const isOpen = vppPeriodIsOpen(p);
    const secondaryOptions = [];
    if (isOpen) secondaryOptions.push({ value: 'close', label: '🔒 Kết Thúc Kỳ' });
    if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
    const primaryBtnHTML = `<button data-op="downloadVppCatalogExport" data-arg0="${p.id}" class="px-2.5 py-1 bg-orange-600 text-white rounded text-xs hover:opacity-90 font-bold" title="Xuất danh mục mặt hàng của kỳ này ra Excel (để dùng lại làm cơ sở cho kỳ sau)">📤 Xuất Excel</button>`;
    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2 font-bold text-orange-800">${escapeHtml(p.name)}</td>
        <td class="border p-2 text-xs">${p.startDate ? escapeHtml(p.startDate) : '(không giới hạn)'} ➔ ${p.endDate ? escapeHtml(p.endDate) : '(không giới hạn)'}</td>
        <td class="border p-2 text-center">${p.catalogItems.length}</td>
        <td class="border p-2 text-center">${regCount}</td>
        <td class="border p-2">${vppPeriodStatusBadge(p)}</td>
        <td class="border p-2 text-center space-x-1">${buildActionCell(p.id, primaryBtnHTML, secondaryOptions, 'runVppPeriodAction')}</td>
      </tr>
    `;
  }).join('');
}

function runVppPeriodAction(id, action) {
  switch (action) {
    case 'close': closeVppPeriodAction(id); break;
    case 'delete': deleteVppPeriodAction(id); break;
  }
}

// Xuất lại danh mục mặt hàng đã chốt của 1 kỳ đăng ký ra Excel (cùng cột file mẫu "⬇️ Tải Mẫu Excel" ở
// trên) — để bộ phận hành chính lấy lại làm cơ sở cho kỳ sau, hoặc đối chiếu file gốc đã nộp. Cùng cách
// điều hướng bằng thẻ <a> tạm như downloadVppExport() bên dưới (kèm cookie phiên đăng nhập hiện có).
function downloadVppCatalogExport(periodId) {
  const a = document.createElement('a');
  a.href = `/api/vpp/export/catalog/${periodId}`;
  a.click();
}

function closeVppPeriodAction(id) {
  const p = DB.vppPeriods.find(x => x.id === id);
  if (!p) return;
  showConfirmModal({
    title: 'Kết Thúc Kỳ Đăng Ký',
    bodyHTML: `Bạn có chắc chắn muốn kết thúc kỳ <b>${escapeHtml(p.name)}</b>? Sau khi kết thúc, không ai đăng ký thêm được nữa.`,
    confirmLabel: 'Kết Thúc Kỳ',
    onConfirm: async () => {
      try {
        const result = await callRecordAction('vppPeriods', id, 'close', {});
        const idx = DB.vppPeriods.findIndex(x => x.id === id);
        if (idx !== -1) DB.vppPeriods[idx] = result.item;
      } catch (err) { return alert(`⛔ ${err.message}`); }
      logSystemAction('VPP', 'CLOSE_VPP_PERIOD', `Kết thúc kỳ đăng ký Văn phòng phẩm [${p.name}]`, 'SUCCESS', p.code);
      renderVppPeriods();
    }
  });
}

function deleteVppPeriodAction(id) {
  const p = DB.vppPeriods.find(x => x.id === id);
  if (!p) return;
  deleteRecordAdminOnly('vppPeriods', id, `kỳ đăng ký Văn phòng phẩm ${p.name}`, () => {
    DB.vppPeriods = DB.vppPeriods.filter(x => x.id !== id);
    logSystemAction('VPP', 'DELETE_VPP_PERIOD', `Xóa kỳ đăng ký Văn phòng phẩm [${p.name}]`, 'SUCCESS', p.code);
    renderVppPeriods();
  });
}

// ============ BÁO CÁO TỔNG HỢP (quản lý — chỉ vppManage/admin) ============
// Tải file Excel sinh trực tiếp từ DB hiện tại (xem routes/vppCatalog.js + lib/vppExport.js) — điều
// hướng bằng thẻ <a> tạm (kèm cookie phiên đăng nhập hiện có, không cần fetch+blob thủ công).
function downloadVppExport(kind) {
  const periodId = Number(document.getElementById('vppReportPeriodSelect').value);
  if (!periodId) return alert('Vui lòng chọn kỳ đăng ký để tải báo cáo!');
  const a = document.createElement('a');
  a.href = `/api/vpp/export/${kind}/${periodId}`;
  a.click();
}

function renderVppReportPeriodOptions() {
  const sel = document.getElementById('vppReportPeriodSelect');
  const prevValue = sel.value;
  sel.innerHTML = DB.vppPeriods.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  if (prevValue && DB.vppPeriods.some(p => String(p.id) === prevValue)) sel.value = prevValue;
}

function renderVppReports() {
  const periodId = Number(document.getElementById('vppReportPeriodSelect').value);
  const byDeptBody = document.getElementById('vppReportByDeptBody');
  const byItemBody = document.getElementById('vppReportByItemBody');
  if (!periodId) {
    byDeptBody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-gray-500 italic">Chưa có kỳ đăng ký nào để xem báo cáo.</td></tr>`;
    byItemBody.innerHTML = '';
    return;
  }
  const period = DB.vppPeriods.find(p => p.id === periodId);
  const regs = DB.vppRegistrations.filter(r => r.periodId === periodId);

  // Tổng hợp theo phòng ban — cùng kiểu reducer với computeApprovalStats() (Báo cáo quản trị).
  // TỪ v22.5: "Ngân Sách Phòng Ban" đọc mức/người RIÊNG của từng phòng (period.deptBudgetRates[dept],
  // rơi về period.perPersonBudget mặc định nếu phòng không có mức riêng — xem vppResolveDeptBudgetClient()
  // ngay dưới, mirror ĐÚNG resolveVppDeptBudget() server). "Đã Duyệt" (tiền) vẫn CHỈ tính đăng ký ĐÃ
  // DUYỆT (khớp file xuất Excel ở lib/vppExport.js — chỉ hồ sơ đã duyệt mới coi là chi tiêu THẬT). "Còn
  // Lại" giờ trừ luôn cả đăng ký ĐANG CHỜ DUYỆT (không chỉ đã duyệt) — khớp ĐÚNG số admin sẽ thấy khi hệ
  // thống CHẶN THẬT lúc nhân viên bấm "Gửi phê duyệt" (xem submitVppRegistration() ở lib/recordActions.js
  // — chặn theo tổng quỹ CẢ PHÒNG, gồm cả phần đang giữ chỗ chờ duyệt, không còn giới hạn theo từng người).
  const byDept = {};
  regs.forEach(r => {
    if (!byDept[r.dept]) byDept[r.dept] = { total: 0, pending: 0, approved: 0, rejected: 0, approvedMoney: 0, heldMoney: 0 };
    const s = byDept[r.dept];
    s.total++;
    if (r.status === 'PENDING') { s.pending++; s.heldMoney += vppCalcItemsTotal(r.items); }
    else if (r.status === 'APPROVED') { s.approved++; s.approvedMoney += vppCalcItemsTotal(r.items); s.heldMoney += vppCalcItemsTotal(r.items); }
    else if (r.status === 'REJECTED') s.rejected++;
  });
  const deptRows = Object.entries(byDept);
  byDeptBody.innerHTML = deptRows.length
    ? deptRows.map(([dept, s]) => {
        const { totalBudget } = vppResolveDeptBudgetClient(period, dept);
        const deptBudget = totalBudget > 0 ? totalBudget : null;
        const remain = deptBudget != null ? deptBudget - s.heldMoney : null;
        return `
        <tr>
          <td class="border p-2 font-semibold">${escapeHtml(dept)}</td>
          <td class="border p-2 text-center">${s.total}</td>
          <td class="border p-2 text-center text-indigo-700">${s.pending}</td>
          <td class="border p-2 text-center text-green-700">${s.approved}</td>
          <td class="border p-2 text-center text-red-700">${s.rejected}</td>
          <td class="border p-2 text-right">${deptBudget != null ? deptBudget.toLocaleString('vi-VN') + ' đ' : '—'}</td>
          <td class="border p-2 text-right">${s.approvedMoney.toLocaleString('vi-VN')} đ</td>
          <td class="border p-2 text-right font-semibold ${remain != null && remain < 0 ? 'text-red-700' : ''}">${remain != null ? remain.toLocaleString('vi-VN') + ' đ' : '—'}</td>
        </tr>
      `;
      }).join('')
    : `<tr><td colspan="8" class="text-center p-4 text-gray-500 italic">Chưa có đăng ký nào ở kỳ này.</td></tr>`;

  // Tổng hợp theo mặt hàng — gộp trùng tên (đã đảm bảo tên khớp chính xác vì chọn từ danh mục có sẵn),
  // cộng dồn số lượng từ TẤT CẢ đăng ký (chờ duyệt + đã duyệt), không tính bản bị từ chối.
  const byItem = {};
  regs.filter(r => r.status !== 'REJECTED').forEach(r => {
    r.items.forEach(it => {
      if (!byItem[it.name]) byItem[it.name] = { unit: it.unit, qty: 0 };
      byItem[it.name].qty += it.qty;
    });
  });
  const itemRows = Object.entries(byItem).sort((a, b) => b[1].qty - a[1].qty);
  byItemBody.innerHTML = itemRows.length
    ? itemRows.map(([name, s]) => `
        <tr>
          <td class="border p-2">${escapeHtml(name)}</td>
          <td class="border p-2 text-gray-500">${escapeHtml(s.unit)}</td>
          <td class="border p-2 text-center font-bold">${s.qty}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="3" class="text-center p-4 text-gray-500 italic">Chưa có mặt hàng nào được đăng ký.</td></tr>`;
}

// Dựng HTML "Phiếu Phê Duyệt Đề Xuất Văn Phòng" — dùng lại khung chung buildApprovalSlipShellHTML()
// giống hệt pattern đã áp dụng cho Đăng Ký Xe và Văn Bản Trình.
function buildOfficeApprovalSlipHTML(o) {
  const wfMap = getOfficeWorkflowMap(o.subType);
  const wfConfig = wfMap[o.dept] || { workflowId: 'WF_1STEP' };
  const wf = DB.workflows.find(w => w.id === wfConfig.workflowId) || { steps: [{ order: 1, name: 'Duyệt' }] };
  const signatureColumnsHTML = wf.steps.map(step => buildApprovalSignatureColumnHTML(step, o.history)).join('');

  let extraFieldsHTML = '';
  if (o.customData && Object.keys(o.customData).length > 0) {
    const rows = Object.keys(o.customData).map(k => `<tr><td class="as-label">${escapeHtml(k)}:</td><td>${escapeHtml(o.customData[k])}</td></tr>`).join('');
    extraFieldsHTML = `<div class="as-section-title">Thông Tin Bổ Sung</div><table class="as-field-table">${rows}</table>`;
  }

  // Phân hệ Mua Sắm dùng bảng nhiều hạng mục theo đúng bố cục Mẫu BM-TS01 (Phiếu Đề Nghị Mua Sắm
  // Tài Sản/Cung Cấp Trang Thiết Bị) do người dùng cung cấp — Sửa Chữa/Đầu Tư giữ nguyên 1 dòng vì
  // chưa có mẫu giấy riêng.
  const isMuaSam = Array.isArray(o.items);

  const itemsTableHTML = isMuaSam ? `
    <table class="as-items-table">
      <thead>
        <tr>
          <th>STT</th><th>Tên Tài Sản</th><th>Model</th><th>ĐVT</th><th>Số Lượng</th>
          <th>Đơn Giá</th><th>Thành Tiền</th><th>Ghi Chú</th>
        </tr>
      </thead>
      <tbody>
        ${o.items.map((it, idx) => `
          <tr>
            <td class="as-items-center">${idx + 1}</td>
            <td>${escapeHtml(it.name)}</td>
            <td>${escapeHtml(it.model || '')}</td>
            <td class="as-items-center">${escapeHtml(it.unit || '')}</td>
            <td class="as-items-right">${it.qty}</td>
            <td class="as-items-right">${(it.unitPrice || 0).toLocaleString('vi-VN')}</td>
            <td class="as-items-right">${(it.amount || 0).toLocaleString('vi-VN')}</td>
            <td>${escapeHtml(it.note || '')}</td>
          </tr>
        `).join('')}
        <tr>
          <td colspan="6" class="as-items-right" data-style="font-weight:bold;">Tổng Cộng (chưa VAT):</td>
          <td class="as-items-right" data-style="font-weight:bold;">${(o.amount || 0).toLocaleString('vi-VN')}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  ` : '';

  const bodyHTML = isMuaSam ? `
    <table class="as-field-table">
      <tr><td class="as-label">Ngày đề nghị:</td><td>${escapeHtml(o.createdAt || '')}</td></tr>
      <tr><td class="as-label">Họ tên người đề nghị:</td><td>${escapeHtml(o.creatorName || '')}</td></tr>
      <tr><td class="as-label">Phòng ban / đơn vị:</td><td>${escapeHtml(o.dept || '')}</td></tr>
      <tr><td class="as-label">Mục đích mua sắm / cung cấp tài sản:</td><td>${escapeHtml(o.reason || '')}</td></tr>
      <tr><td class="as-label">Thời gian cần sử dụng:</td><td>${escapeHtml(o.usageTime || '')}</td></tr>
    </table>
    <div class="as-section-title">Danh Sách Hạng Mục Đề Nghị Mua Sắm</div>
    ${itemsTableHTML}
    ${extraFieldsHTML}
  ` : `
    <table class="as-field-table">
      <tr><td class="as-label">Ngày tạo:</td><td>${escapeHtml(o.createdAt || '')}</td></tr>
      <tr><td class="as-label">Người tạo:</td><td>${escapeHtml(o.creatorName || '')}</td></tr>
      <tr><td class="as-label">Phòng ban:</td><td>${escapeHtml(o.dept || '')}</td></tr>
      <tr><td class="as-label">Phân hệ:</td><td>${escapeHtml(o.subType || '')}</td></tr>
      <tr><td class="as-label">Tên đề xuất:</td><td>${escapeHtml(o.title || '')}</td></tr>
      <tr><td class="as-label">Số lượng:</td><td>${escapeHtml(o.qty || '')}</td></tr>
      <tr><td class="as-label">Giá trị dự kiến:</td><td>${(o.amount || 0).toLocaleString('vi-VN')} VNĐ</td></tr>
      <tr><td class="as-label">Nhà cung cấp:</td><td>${escapeHtml(o.supplier || 'N/A')}</td></tr>
      <tr><td class="as-label">Lý do / Diễn giải:</td><td>${escapeHtml(o.reason || '')}</td></tr>
    </table>
    ${extraFieldsHTML}
  `;

  return buildApprovalSlipShellHTML({
    formCode: isMuaSam ? 'Mẫu: BM-TS01' : 'Đề Xuất Văn Phòng',
    title: isMuaSam ? 'Phiếu Đề Nghị Mua Sắm Tài Sản / Cung Cấp Trang Thiết Bị' : 'Phiếu Phê Duyệt Đề Xuất Văn Phòng',
    approvedNote: `✅ Đã phê duyệt hoàn tất trên Hệ thống Văn phòng điện tử — Mã: ${escapeHtml(o.code)}`,
    bodyHTML,
    requesterRoleLabel: 'Người đề nghị',
    requesterName: o.creatorName,
    requesterUsername: o.creator,
    requesterTime: `Đề nghị lúc: ${escapeHtml(o.createdAt || '')}`,
    signatureColumnsHTML,
    footerNote: 'Phiếu được lập và phê duyệt điện tử trên Hệ thống Văn phòng điện tử (VPĐT) — không cần chữ ký tay/con dấu bản cứng. Chữ ký các cấp theo đúng quy trình phê duyệt đã cấu hình cho phòng ban. Thông tin phê duyệt có thể tra cứu lại trên hệ thống.'
  });
}

function viewOfficeApprovalSlip(officeId) {
  const o = DB.officeReqs.find(x => x.id === officeId);
  if (!o) return;
  if (o.status !== 'APPROVED') return alert('Chỉ xem được Phiếu Phê Duyệt sau khi đề xuất đã được phê duyệt hoàn tất.');

  document.getElementById('viewModalTitle').innerText = `🏢 Phiếu Phê Duyệt Đề Xuất Văn Phòng (${o.code})`;
  document.getElementById('viewModalSub').innerText = `Phân hệ: ${o.subType} | Phòng ban: ${o.dept} | Người tạo: ${o.creatorName}`;
  document.getElementById('viewModalFooterInfo').innerText = 'Trạng thái: Đã phê duyệt hoàn tất';

  document.getElementById('viewModalContent').innerHTML = buildOfficeApprovalSlipHTML(o);
  document.getElementById('viewDocModal').classList.remove('hidden');
}

// Xem "Tài liệu ký" (bản cứng đã ký thật, tải lên qua submitSignedUpload() để mở nút Thanh Toán) — cùng
// mô hình viewContractSignedFile(), dùng chung openFileProtectedView() nên tự động có watermark.
function viewOfficeSignedFile(officeId) {
  const o = DB.officeReqs.find(x => x.id === officeId);
  if (!o || !o.signedFileUrl) return;
  openFileProtectedView({
    title: `📎 Tài Liệu Ký — ${o.title} (${o.code})`,
    sub: `Phân hệ: ${o.subType} | Phòng ban: ${o.dept} | Người tạo: ${o.creatorName}`,
    footerInfo: 'Bản đã ký chính thức, dùng để đối chiếu khi thanh toán.',
    fileSrc: o.signedFileUrl, fileType: o.signedFileType, fileName: o.signedFileName
  });
}

function downloadOfficeApprovalSlip(officeId) {
  const o = DB.officeReqs.find(x => x.id === officeId);
  if (!o) return;
  if (o.status !== 'APPROVED') return alert('Chỉ tải được Phiếu Phê Duyệt sau khi đề xuất đã được phê duyệt hoàn tất.');

  const fullHtml = standaloneHtmlRestoreStyles(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Phiếu Phê Duyệt Đề Xuất Văn Phòng - ${escapeHtml(o.code)}</title><style>${APPROVAL_SLIP_CSS}</style></head><body>${buildOfficeApprovalSlipHTML(o)}</body></html>`);
  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `PhieuPheDuyet_${o.code}.html`;
  link.click();
  URL.revokeObjectURL(url);
}

