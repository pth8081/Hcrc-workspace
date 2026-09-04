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

// Dựng bảng "Nhân sự theo phòng ban" — CHỈ dựng 1 lần khi mở form (mỗi dòng input tự có handler riêng
// onVppHeadcountInput() để chỉ cập nhật đúng ô "Ngân Sách Phòng Ban" của dòng đó, KHÔNG render lại cả
// bảng mỗi lần gõ — tránh mất focus/con trỏ đang gõ dở giữa chừng).
function renderVppDeptHeadcountTable() {
  const tbody = document.getElementById('vppDeptHeadcountBody');
  if (!tbody) return;
  const budget = getMoneyValue(document.getElementById('vppNewPeriodBudget'));
  tbody.innerHTML = DB.depts.map(dept => {
    const headcount = vppActiveHeadcountForDept(dept);
    const deptBudget = budget * headcount;
    return `
      <tr data-vpp-dept="${escapeHtml(dept)}">
        <td class="border p-1.5">${escapeHtml(dept)}</td>
        <td class="border p-1"><input type="number" min="0" step="1" value="${headcount}" data-op-input="onVppHeadcountInput" data-arg-el="0" class="vpp-headcount-input w-24 border p-1 rounded text-xs text-center"></td>
        <td class="border p-1.5 text-right font-semibold text-orange-700 vpp-dept-budget-cell">${budget > 0 ? deptBudget.toLocaleString('vi-VN') + ' đ' : '—'}</td>
      </tr>`;
  }).join('');
}

// Đổi "Ngân sách / người" -> cập nhật lại cột "Ngân Sách Phòng Ban" của MỌI dòng đang có, giữ nguyên
// số nhân sự đã sửa tay (không render lại toàn bảng).
function onVppBudgetInput() {
  const budget = getMoneyValue(document.getElementById('vppNewPeriodBudget'));
  document.querySelectorAll('#vppDeptHeadcountBody tr').forEach(tr => {
    const hcInput = tr.querySelector('.vpp-headcount-input');
    const cell = tr.querySelector('.vpp-dept-budget-cell');
    if (!hcInput || !cell) return;
    const headcount = Math.max(0, Math.round(Number(hcInput.value) || 0));
    cell.textContent = budget > 0 ? `${(budget * headcount).toLocaleString('vi-VN')} đ` : '—';
  });
}

// Sửa tay 1 dòng "Số Nhân Sự" -> chỉ cập nhật đúng ô "Ngân Sách Phòng Ban" của dòng đó.
function onVppHeadcountInput(input) {
  const budget = getMoneyValue(document.getElementById('vppNewPeriodBudget'));
  const headcount = Math.max(0, Math.round(Number(input.value) || 0));
  const cell = input.closest('tr')?.querySelector('.vpp-dept-budget-cell');
  if (cell) cell.textContent = budget > 0 ? `${(budget * headcount).toLocaleString('vi-VN')} đ` : '—';
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
  if ((subTab === 'PERIODS' || subTab === 'REPORTS') && !canManageVpp(currentUser)) subTab = 'REGISTER';
  activeVppSubTab = subTab;

  document.getElementById('btnVppSubPeriods').classList.toggle('hidden', !canManageVpp(currentUser));
  document.getElementById('btnVppSubReports').classList.toggle('hidden', !canManageVpp(currentUser));

  document.getElementById('vppSubRegister').classList.toggle('hidden', subTab !== 'REGISTER');
  document.getElementById('vppSubPeriods').classList.toggle('hidden', subTab !== 'PERIODS');
  document.getElementById('vppSubReports').classList.toggle('hidden', subTab !== 'REPORTS');

  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-orange-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnVppSubRegister').className = subTab === 'REGISTER' ? activeCls : inactiveCls;
  document.getElementById('btnVppSubPeriods').className = subTab === 'PERIODS' ? activeCls : inactiveCls;
  document.getElementById('btnVppSubReports').className = subTab === 'REPORTS' ? activeCls : inactiveCls;

  if (subTab === 'REGISTER') { renderVppRegPeriodOptions(); renderVppRegistrations(); }
  if (subTab === 'PERIODS') { renderVppPeriods(); renderVppDeptHeadcountTable(); }
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

function onVppRegPeriodChange() {
  const periodId = Number(document.getElementById('vppRegPeriodSelect').value);
  const wrap = document.getElementById('vppRegItemsWrap');
  const noteEl = document.getElementById('vppRegAlreadySentNote');
  vppFormDraftId = null;
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

function collectVppRegFormItems(period) {
  return period.catalogItems
    .map((it, idx) => ({ name: it.name, qty: Number(document.getElementById(`vppItemQty_${idx}`)?.value) || 0 }))
    .filter(it => it.qty > 0);
}

// Hiện tổng tiền đang chọn realtime mỗi khi đổi số lượng — so với "Ngân sách / người" của kỳ (nếu
// kỳ có đặt ngân sách). CHỈ hiển thị cảnh báo ở đây, việc CHẶN thật sự nằm ở lúc bấm "Gửi phê duyệt"
// (xem submitVppRegDraftAction()) — cho phép lưu Nháp thoải mái trong lúc còn đang cân nhắc.
function updateVppRegTotalDisplay() {
  const periodId = Number(document.getElementById('vppRegPeriodSelect').value);
  const period = DB.vppPeriods.find(p => p.id === periodId);
  const wrap = document.getElementById('vppRegTotalWrap');
  if (!period || !wrap) return;
  const items = period.catalogItems
    .map((it, idx) => ({ price: it.price, qty: Number(document.getElementById(`vppItemQty_${idx}`)?.value) || 0 }))
    .filter(it => it.qty > 0);
  const total = vppCalcItemsTotal(items);
  const budget = period.perPersonBudget;
  const overBudget = budget > 0 && total > budget;
  wrap.innerHTML = `Tổng tiền đã chọn: <span class="${overBudget ? 'text-red-600' : 'text-gray-800'}">${total.toLocaleString('vi-VN')} đ</span>` +
    (budget > 0 ? ` / Ngân sách: ${budget.toLocaleString('vi-VN')} đ` : '') +
    (overBudget ? ' <span class="text-red-600">⚠️ Vượt ngân sách — vui lòng giảm bớt số lượng trước khi gửi phê duyệt.</span>' : '');
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
  // Chặn Gửi khi vượt ngân sách/người của kỳ — kiểm tra ngay ở client cho phản hồi tức thì, server
  // vẫn tự kiểm tra lại (submitVppRegistration() ở lib/recordActions.js) nên không tin riêng bước này.
  const period = DB.vppPeriods.find(p => p.id === r.periodId);
  if (period?.perPersonBudget > 0) {
    const total = vppCalcItemsTotal(r.items);
    if (total > period.perPersonBudget) {
      return alert(`⛔ Tổng tiền đăng ký (${total.toLocaleString('vi-VN')} đ) vượt quá ngân sách được cấp cho 1 người (${period.perPersonBudget.toLocaleString('vi-VN')} đ) — vui lòng sửa nháp và giảm bớt số lượng trước khi gửi.`);
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
      const approvers = wfConfig.approvers?.[1] || [];
      if (approvers.length) {
        notifyUsersByEmail('VPP', 'NOTIFY_APPROVAL_NEEDED', updatedReg.code, approvers,
          `[VPDT] Đăng ký Văn phòng phẩm ${updatedReg.code} cần bạn phê duyệt`,
          `Đăng ký Văn phòng phẩm kỳ "${updatedReg.periodName}" của ${updatedReg.creatorName} đang chờ bạn phê duyệt.`);
      }
    }
  });
}

function vppRegStatusBadge(r) {
  if (r.status === 'DRAFT') return `<span class="px-2 py-0.5 bg-gray-200 text-gray-700 rounded font-bold text-xs">📝 Nháp</span>`;
  if (r.status === 'APPROVED') return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã phê duyệt</span>`;
  if (r.status === 'REJECTED') return `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Từ chối</span>`;
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
    { key: 'REJECTED', label: 'Từ Chối', count: scopedVppRegs.filter(r => r.status === 'REJECTED').length, colorClass: 'border-l-red-500' }
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
    const currentStepApprovers = wfConfig.approvers?.[r.currentStep] || [];
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
    case 'delete': deleteVppRegAction(id); break;
  }
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

  const currentStepApprovers = wfConfig.approvers?.[r.currentStep] || [];
  const canApprove = (r.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, r.history, r.currentStep);
  const actionBtns = document.getElementById('vppRegModalActionBtns');
  if (canApprove) {
    actionBtns.innerHTML = `
      <button data-op="confirmProcessVppReg" data-arg0="REJECT" class="bg-red-600 text-white px-4 py-1.5 rounded font-bold hover:bg-red-700 text-xs">❌ Từ Chối</button>
      <button data-op="confirmProcessVppReg" data-arg0="REQUEST_CHANGES" class="bg-amber-500 text-white px-4 py-1.5 rounded font-bold hover:bg-amber-600 text-xs">🔄 Yêu Cầu Bổ Sung</button>
      <button data-op="confirmProcessVppReg" data-arg0="APPROVE" class="bg-green-600 text-white px-5 py-1.5 rounded font-bold hover:bg-green-700 text-xs">✅ Phê Duyệt & Chuyển Bước</button>
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
  const titleMap = { APPROVE: '✅ Xác Nhận Phê Duyệt', REJECT: '❌ Xác Nhận Từ Chối', REQUEST_CHANGES: '🔄 Xác Nhận Yêu Cầu Bổ Sung' };
  const labelMap = { APPROVE: 'Phê Duyệt', REJECT: 'Từ Chối', REQUEST_CHANGES: 'Yêu Cầu Bổ Sung' };
  const actionTextMap = { APPROVE: 'phê duyệt', REJECT: 'từ chối', REQUEST_CHANGES: 'yêu cầu bổ sung/chỉnh sửa (đưa hồ sơ về nháp để người đăng ký sửa lại)' };
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
    event.target.value = '';
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
  const payload = {
    code: `VPP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-5)}`,
    name, startDate: startDate || '', endDate: endDate || '',
    catalogItems: vppPendingCatalog.items,
    catalogFileUrl: vppPendingCatalog.fileUrl, catalogFileName: vppPendingCatalog.fileName,
    perPersonBudget, deptHeadcounts: collectVppDeptHeadcounts(),
    createdAt: new Date().toLocaleString('vi-VN')
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

  document.getElementById('vppNewPeriodName').value = '';
  document.getElementById('vppNewPeriodStart').value = '';
  document.getElementById('vppNewPeriodEnd').value = '';
  document.getElementById('vppNewPeriodBudget').value = '100.000'; // mặc định ban đầu 100.000đ/người, admin vẫn sửa được ở lượt tạo kỳ tiếp theo
  document.getElementById('vppCatalogFileInput').value = '';
  document.getElementById('vppCatalogPreviewWrap').classList.add('hidden');
  document.getElementById('vppCatalogStatus').innerText = '';
  vppPendingCatalog = null;
  renderVppPeriods();
  renderVppDeptHeadcountTable();
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
    const primaryBtnHTML = `<span class="text-gray-400 italic text-[11px]">—</span>`;
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
  // "Đã Dùng" chỉ tính tổng tiền của các đăng ký ĐÃ DUYỆT (khớp đúng nghiệp vụ file xuất Excel ở
  // lib/vppExport.js — chỉ hồ sơ đã duyệt mới coi là chi tiêu thật). "Ngân Sách Phòng Ban" =
  // ngân sách/người (period.perPersonBudget) × số nhân sự đã chốt cho phòng đó lúc tạo kỳ
  // (period.deptHeadcounts) — chỉ mang tính tham khảo, KHÔNG dùng để chặn đăng ký (mức chặn áp
  // riêng cho từng cá nhân, xem submitVppRegDraftAction()/server).
  const byDept = {};
  regs.forEach(r => {
    if (!byDept[r.dept]) byDept[r.dept] = { total: 0, pending: 0, approved: 0, rejected: 0, used: 0 };
    byDept[r.dept].total++;
    if (r.status === 'PENDING') byDept[r.dept].pending++;
    else if (r.status === 'APPROVED') { byDept[r.dept].approved++; byDept[r.dept].used += vppCalcItemsTotal(r.items); }
    else if (r.status === 'REJECTED') byDept[r.dept].rejected++;
  });
  const deptRows = Object.entries(byDept);
  const hasBudget = !!(period?.perPersonBudget > 0);
  byDeptBody.innerHTML = deptRows.length
    ? deptRows.map(([dept, s]) => {
        const headcount = period?.deptHeadcounts?.[dept] || 0;
        const deptBudget = hasBudget ? period.perPersonBudget * headcount : null;
        const remain = deptBudget != null ? deptBudget - s.used : null;
        return `
        <tr>
          <td class="border p-2 font-semibold">${escapeHtml(dept)}</td>
          <td class="border p-2 text-center">${s.total}</td>
          <td class="border p-2 text-center text-indigo-700">${s.pending}</td>
          <td class="border p-2 text-center text-green-700">${s.approved}</td>
          <td class="border p-2 text-center text-red-700">${s.rejected}</td>
          <td class="border p-2 text-right">${deptBudget != null ? deptBudget.toLocaleString('vi-VN') + ' đ' : '—'}</td>
          <td class="border p-2 text-right">${s.used.toLocaleString('vi-VN')} đ</td>
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

  // Ý kiến chỉ đạo của người phê duyệt cuối cùng — bản ghi APPROVED gần nhất trong lịch sử xử lý.
  const finalApprovalEntry = [...(o.history || [])].reverse().find(h => h.action === 'APPROVED');
  let finalCommentHTML = '';
  if (finalApprovalEntry && finalApprovalEntry.comment) {
    finalCommentHTML = `
      <div class="as-section-title">Ý Kiến Chỉ Đạo Của Người Phê Duyệt Cuối Cùng</div>
      <div class="as-comment-box">
        <p>"${escapeHtml(finalApprovalEntry.comment)}"</p>
        <div class="as-comment-meta">— ${escapeHtml(finalApprovalEntry.approver)}, ${escapeHtml(finalApprovalEntry.time)}</div>
      </div>
    `;
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
          <td colspan="6" class="as-items-right" style="font-weight:bold;">Tổng Cộng (chưa VAT):</td>
          <td class="as-items-right" style="font-weight:bold;">${(o.amount || 0).toLocaleString('vi-VN')}</td>
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
    ${finalCommentHTML}
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
    ${finalCommentHTML}
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

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Phiếu Phê Duyệt Đề Xuất Văn Phòng - ${escapeHtml(o.code)}</title></head><body>${buildOfficeApprovalSlipHTML(o)}</body></html>`;
  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `PhieuPheDuyet_${o.code}.html`;
  link.click();
  URL.revokeObjectURL(url);
}

