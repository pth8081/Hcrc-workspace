// module-luong.js — Nhân Sự > Lương (Module Lương, xem lib/payroll.js đầu file phía server cho toàn bộ
// điều chỉnh so với tài liệu gốc). Đi qua route RIÊNG /api/payroll/* (KHÔNG qua GET /api/data chung —
// payslips ẩn hoàn toàn khỏi route đó với người không có hrPayrollManage/hrPayrollApprove, xem
// lib/recordViewScope.js) — module này tự fetch trực tiếp, KHÔNG dùng DB.payslips cho tab "Của Tôi"
// (route /my-payslips* tự suy employeeCode từ session, IDOR-safe). DB.payrollPeriods VẪN dùng được cho
// tab "Quản Lý" (đã sync sẵn qua GET /api/data cho đúng người có quyền xem, xem filterPayrollPeriodsForUser).
let hrpActiveView = 'SELF';
let hrpMyPayslipsCache = [];
let hrpCurrentPayslipView = null; // { payslip, period } đang mở trong hrpPayslipViewModal
let hrpCurrentPeriodDetail = null; // periodId đang mở trong hrpPeriodDetailModal
let hrpRateConfigCache = null;

const HRP_STATUS_LABELS = {
  DRAFT: '📝 Nháp', PENDING_APPROVAL: '⏳ Chờ Duyệt', APPROVED: '✅ Đã Duyệt',
  FINALIZED: '🔒 Đã Chốt', PUBLISHED: '📢 Đã Công Bố'
};

async function hrpApiCall(method, path, body) {
  const res = await fetch(path, {
    method, credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) { handleSessionExpired(); throw new Error('Phiên đăng nhập đã hết hạn'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi máy chủ (HTTP ${res.status})`);
  return data;
}

function fmtMoney(n) {
  return Math.round(Number(n) || 0).toLocaleString('vi-VN') + 'đ';
}

function renderHrPayrollModule() {
  const canManage = !!(currentUser?.perms?.admin || currentUser?.perms?.hrPayrollManage);
  const canApprove = !!(currentUser?.perms?.admin || currentUser?.perms?.hrPayrollApprove);
  document.getElementById('btnHrpViewManage').classList.toggle('hidden', !(canManage || canApprove));
  document.getElementById('btnHrpCreatePeriod').classList.toggle('hidden', !canManage);
  document.getElementById('btnHrpRateConfig').classList.toggle('hidden', !(canManage || canApprove));
  setHrPayrollView(hrpActiveView);
}

function setHrPayrollView(view) {
  hrpActiveView = view;
  document.getElementById('btnHrpViewSelf').classList.toggle('bg-emerald-600', view === 'SELF');
  document.getElementById('btnHrpViewSelf').classList.toggle('text-white', view === 'SELF');
  document.getElementById('btnHrpViewManage').classList.toggle('bg-emerald-600', view === 'MANAGE');
  document.getElementById('btnHrpViewManage').classList.toggle('text-white', view === 'MANAGE');
  document.getElementById('hrpViewSelf').classList.toggle('hidden', view !== 'SELF');
  document.getElementById('hrpViewManage').classList.toggle('hidden', view !== 'MANAGE');
  if (view === 'SELF') loadHrpMyPayslips();
  else renderHrpPeriodsTable();
}

// ===== "Phiếu Lương Của Tôi" =====
async function loadHrpMyPayslips() {
  const tbody = document.getElementById('hrpSelfTableBody');
  try {
    const data = await hrpApiCall('GET', '/api/payroll/my-payslips');
    hrpMyPayslipsCache = data.payslips || [];
    document.getElementById('hrpSelfNoProfile').classList.add('hidden');
    document.getElementById('hrpSelfEmpty').classList.toggle('hidden', hrpMyPayslipsCache.length > 0);
    tbody.innerHTML = hrpMyPayslipsCache.map(p => `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-2">Tháng ${p.periodMonth}/${p.periodYear}</td>
        <td class="p-2 text-right font-bold">${fmtMoney(p.netPay)}</td>
        <td class="p-2 text-center">${p.viewedByEmployeeAt ? '✅' : '🆕'}</td>
        <td class="p-2 text-right"><button type="button" data-op="openHrpPayslipViewModal" data-arg0="${p.periodId}" class="bg-blue-600 text-white px-2 py-1 rounded text-[11px] hover:bg-blue-700">Xem</button></td>
      </tr>
    `).join('');
  } catch (err) {
    if (/hồ sơ nhân sự/i.test(err.message)) {
      document.getElementById('hrpSelfNoProfile').classList.remove('hidden');
      document.getElementById('hrpSelfEmpty').classList.add('hidden');
      tbody.innerHTML = '';
    } else {
      alert('⛔ ' + err.message);
    }
  }
}

async function openHrpPayslipViewModal(periodId) {
  try {
    const data = await hrpApiCall('GET', `/api/payroll/my-payslips/${periodId}`);
    hrpCurrentPayslipView = data;
    const { payslip, period } = data;
    document.getElementById('hrpPvTitle').textContent = `Phiếu Lương — ${period.periodName}`;
    const incomeRows = (payslip.details || []).filter(d => d.componentCode && !['SOCIAL_INSURANCE', 'HEALTH_INSURANCE', 'UNEMPLOYMENT_INSURANCE', 'PERSONAL_INCOME_TAX', 'ADVANCE_DEDUCT', 'PENALTY_DEDUCT', 'UNPAID_LEAVE_DEDUCT'].includes(d.componentCode));
    const deductionRows = (payslip.details || []).filter(d => ['SOCIAL_INSURANCE', 'HEALTH_INSURANCE', 'UNEMPLOYMENT_INSURANCE', 'PERSONAL_INCOME_TAX', 'ADVANCE_DEDUCT', 'PENALTY_DEDUCT', 'UNPAID_LEAVE_DEDUCT'].includes(d.componentCode));
    const rowHtml = (label, amount) => `<div class="flex justify-between py-1 border-b text-xs"><span>${escapeHtml(label)}</span><span>${fmtMoney(amount)}</span></div>`;
    document.getElementById('hrpPvContent').innerHTML = `
      <div class="text-xs text-gray-500 mb-2">Ngày công thực tế: ${payslip.workDays}/${payslip.standardDays}</div>
      <div class="font-bold text-xs text-gray-700 mt-2 mb-1">Thu Nhập</div>
      ${incomeRows.map(d => rowHtml(HRP_COMPONENT_LABELS[d.componentCode] || d.componentCode, d.amount)).join('') || '<p class="text-[11px] text-gray-400">Không có dòng thu nhập.</p>'}
      <div class="font-bold text-xs text-gray-700 mt-3 mb-1">Khấu Trừ</div>
      ${deductionRows.map(d => rowHtml(HRP_COMPONENT_LABELS[d.componentCode] || d.componentCode, d.amount)).join('') || '<p class="text-[11px] text-gray-400">Không có dòng khấu trừ.</p>'}
      <div class="flex justify-between py-2 mt-2 border-t-2 border-gray-800 font-bold text-sm"><span>Thực Lĩnh</span><span>${fmtMoney(payslip.netPay)}</span></div>
    `;
    document.getElementById('hrpPayslipViewModal').classList.remove('hidden');
  } catch (err) { alert('⛔ ' + err.message); }
}
function closeHrpPayslipViewModal() { document.getElementById('hrpPayslipViewModal').classList.add('hidden'); }

async function exportHrpPayslipPdf() {
  if (!hrpCurrentPayslipView) return;
  try {
    await Promise.all([loadVendorScript('/vendor/html2canvas/html2canvas.min.js'), loadVendorScript('/vendor/jspdf/jspdf.umd.min.js')]);
    const content = document.getElementById('hrpPvContent');
    const canvas = await window.html2canvas(content, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
    const { jsPDF } = window.jspdf;
    const pageW = 595, margin = 30;
    const imgW = pageW - margin * 2;
    const imgH = (canvas.height * imgW) / canvas.width;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'px', format: [pageW, imgH + margin * 2 + 40] });
    doc.setFontSize(12);
    doc.text(document.getElementById('hrpPvTitle').textContent, margin, margin);
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin + 20, imgW, imgH);
    doc.save(`PhieuLuong_${hrpCurrentPayslipView.period.periodMonth}_${hrpCurrentPayslipView.period.periodYear}.pdf`);
  } catch (err) { alert('⛔ Không xuất được PDF: ' + err.message); }
}

const HRP_COMPONENT_LABELS = {
  BASIC_SALARY: 'Lương cơ bản', ALLOWANCE_LUNCH: 'Phụ cấp ăn trưa', ALLOWANCE_PHONE: 'Phụ cấp điện thoại',
  ALLOWANCE_POSITION: 'Phụ cấp chức vụ', ALLOWANCE_NIGHT_SHIFT: 'Phụ cấp ca đêm', ALLOWANCE_HOLIDAY: 'Phụ cấp ngày lễ',
  OT_150: 'Làm thêm giờ 150%', OT_200: 'Làm thêm giờ 200%', OT_300: 'Làm thêm giờ 300%',
  KPI_BONUS: 'Thưởng KPI', BONUS_OTHER: 'Thưởng khác', SOCIAL_INSURANCE: 'BHXH', HEALTH_INSURANCE: 'BHYT',
  UNEMPLOYMENT_INSURANCE: 'BHTN', PERSONAL_INCOME_TAX: 'Thuế TNCN', ADVANCE_DEDUCT: 'Khấu trừ tạm ứng',
  PENALTY_DEDUCT: 'Khấu trừ phạt', UNPAID_LEAVE_DEDUCT: 'Trừ nghỉ không lương'
};
const HRP_MANUAL_COMPONENTS = ['ALLOWANCE_LUNCH', 'ALLOWANCE_PHONE', 'ALLOWANCE_POSITION', 'ALLOWANCE_NIGHT_SHIFT', 'ALLOWANCE_HOLIDAY', 'KPI_BONUS', 'BONUS_OTHER', 'ADVANCE_DEDUCT', 'PENALTY_DEDUCT'];

// ===== "Quản Lý Kỳ Lương" =====
function getHrpPeriodList() { return (DB.payrollPeriods || []).slice().sort((a, b) => (b.periodYear - a.periodYear) || (b.periodMonth - a.periodMonth)); }

function hrpApplyPeriodUpdate(item) {
  DB.payrollPeriods = DB.payrollPeriods || [];
  const idx = DB.payrollPeriods.findIndex(p => p.id === item.id);
  if (idx >= 0) DB.payrollPeriods[idx] = item; else DB.payrollPeriods.unshift(item);
}

function hrpPeriodActionButtons(p) {
  const canManage = !!(currentUser?.perms?.admin || currentUser?.perms?.hrPayrollManage);
  const canApprove = !!(currentUser?.perms?.admin || currentUser?.perms?.hrPayrollApprove);
  const btns = [`<button type="button" data-op="openHrpPeriodDetailModal" data-arg0="${p.id}" class="bg-blue-600 text-white px-2 py-1 rounded text-[11px] hover:bg-blue-700">Chi Tiết</button>`];
  if (canManage && p.status === 'DRAFT') btns.push(`<button type="button" data-op="hrpCalculate" data-arg0="${p.id}" class="bg-emerald-600 text-white px-2 py-1 rounded text-[11px] hover:bg-emerald-700">Tính Lương</button>`);
  if (canManage && p.status === 'DRAFT' && p.employeeCount > 0) btns.push(`<button type="button" data-op="hrpSubmit" data-arg0="${p.id}" class="bg-indigo-600 text-white px-2 py-1 rounded text-[11px] hover:bg-indigo-700">Gửi Duyệt</button>`);
  if (canApprove && p.status === 'PENDING_APPROVAL') btns.push(`<button type="button" data-op="hrpApprove" data-arg0="${p.id}" class="bg-emerald-600 text-white px-2 py-1 rounded text-[11px] hover:bg-emerald-700">Duyệt</button>`);
  if (canApprove && p.status === 'PENDING_APPROVAL') btns.push(`<button type="button" data-op="hrpReject" data-arg0="${p.id}" class="bg-red-600 text-white px-2 py-1 rounded text-[11px] hover:bg-red-700">Từ Chối</button>`);
  if ((canManage || canApprove) && p.status === 'APPROVED') btns.push(`<button type="button" data-op="hrpFinalize" data-arg0="${p.id}" class="bg-gray-700 text-white px-2 py-1 rounded text-[11px] hover:bg-gray-800">Chốt</button>`);
  if ((canManage || canApprove) && p.status === 'FINALIZED') btns.push(`<button type="button" data-op="hrpPublish" data-arg0="${p.id}" class="bg-purple-600 text-white px-2 py-1 rounded text-[11px] hover:bg-purple-700">Công Bố</button>`);
  if (canManage && ['FINALIZED', 'PUBLISHED'].includes(p.status)) btns.push(`<button type="button" data-op="openHrpReopenModal" data-arg0="${p.id}" class="bg-amber-600 text-white px-2 py-1 rounded text-[11px] hover:bg-amber-700">Mở Lại</button>`);
  return btns.join(' ');
}

function renderHrpPeriodsTable() {
  const list = getHrpPeriodList();
  const tbody = document.getElementById('hrpPeriodsTableBody');
  document.getElementById('hrpPeriodsEmpty').classList.toggle('hidden', list.length > 0);
  tbody.innerHTML = list.map(p => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2">${escapeHtml(p.periodName)}</td>
      <td class="p-2 text-center">${HRP_STATUS_LABELS[p.status] || p.status}</td>
      <td class="p-2 text-right">${p.employeeCount || 0}</td>
      <td class="p-2 text-right">${fmtMoney(p.totalNet)}</td>
      <td class="p-2 text-right whitespace-nowrap">${hrpPeriodActionButtons(p)}</td>
    </tr>
  `).join('');
}

function toggleHrpCreatePeriodForm() {
  const form = document.getElementById('hrpCreatePeriodForm');
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden')) {
    const now = new Date();
    document.getElementById('hrpNewMonth').value = String(now.getMonth() + 1);
    document.getElementById('hrpNewYear').value = String(now.getFullYear());
    document.getElementById('hrpNewName').value = '';
  }
}

async function submitHrpCreatePeriod(e) {
  e.preventDefault();
  try {
    const payload = {
      periodMonth: Number(document.getElementById('hrpNewMonth').value),
      periodYear: Number(document.getElementById('hrpNewYear').value),
      periodName: document.getElementById('hrpNewName').value.trim() || undefined
    };
    const result = await callCreateAction('payrollPeriods', payload);
    hrpApplyPeriodUpdate(result.item);
    document.getElementById('hrpCreatePeriodForm').classList.add('hidden');
    renderHrpPeriodsTable();
  } catch (err) { alert('⛔ ' + err.message); }
}

async function hrpCalculate(id) {
  const period = (DB.payrollPeriods || []).find(p => p.id === Number(id));
  if (period?.employeeCount > 0 && !confirm('Kỳ lương này đã có dữ liệu tính lương trước đó — tính lại sẽ GHI ĐÈ toàn bộ (kể cả các dòng đã điều chỉnh tay). Tiếp tục?')) return;
  try {
    const result = await hrpApiCall('POST', `/api/payroll/periods/${id}/calculate`);
    hrpApplyPeriodUpdate(result.item);
    renderHrpPeriodsTable();
    let msg = `✅ Đã tính lương cho ${result.item.employeeCount} nhân viên.`;
    if (result.skipped?.length) msg += `\n⚠️ Bỏ qua ${result.skipped.length} người:\n` + result.skipped.map(s => `- ${s.employeeCode}: ${s.reason}`).join('\n');
    alert(msg);
  } catch (err) { alert('⛔ ' + err.message); }
}

async function hrpSubmit(id) {
  if (!confirm('Gửi duyệt kỳ lương này? Sau khi gửi sẽ không điều chỉnh được nữa (trừ khi bị từ chối).')) return;
  try { hrpApplyPeriodUpdate((await hrpApiCall('POST', `/api/payroll/periods/${id}/submit`)).item); renderHrpPeriodsTable(); }
  catch (err) { alert('⛔ ' + err.message); }
}
async function hrpApprove(id) {
  if (!confirm('Duyệt kỳ lương này?')) return;
  try { hrpApplyPeriodUpdate((await hrpApiCall('POST', `/api/payroll/periods/${id}/approve`)).item); renderHrpPeriodsTable(); }
  catch (err) { alert('⛔ ' + err.message); }
}
async function hrpReject(id) {
  const reason = prompt('Lý do từ chối (kỳ lương sẽ trở về Nháp để rà soát lại):');
  if (reason === null) return;
  try { hrpApplyPeriodUpdate((await hrpApiCall('POST', `/api/payroll/periods/${id}/reject`, { reason })).item); renderHrpPeriodsTable(); }
  catch (err) { alert('⛔ ' + err.message); }
}
async function hrpFinalize(id) {
  if (!confirm('Chốt kỳ lương này? Sau khi chốt sẽ khoá hoàn toàn, chỉ mở lại được khi có lý do.')) return;
  try { hrpApplyPeriodUpdate((await hrpApiCall('POST', `/api/payroll/periods/${id}/finalize`)).item); renderHrpPeriodsTable(); }
  catch (err) { alert('⛔ ' + err.message); }
}
async function hrpPublish(id) {
  if (!confirm('Công bố kỳ lương này? Toàn bộ nhân viên có phiếu lương trong kỳ sẽ nhận được thông báo trong app.')) return;
  try {
    const result = await hrpApiCall('POST', `/api/payroll/periods/${id}/publish`);
    hrpApplyPeriodUpdate(result.item);
    renderHrpPeriodsTable();
    alert(`✅ Đã công bố — ${result.notified} nhân viên nhận được thông báo.`);
  } catch (err) { alert('⛔ ' + err.message); }
}

let hrpReopenTargetId = null;
function openHrpReopenModal(id) {
  hrpReopenTargetId = Number(id);
  document.getElementById('hrpReopenReason').value = '';
  document.getElementById('hrpReopenModal').classList.remove('hidden');
}
function closeHrpReopenModal() { document.getElementById('hrpReopenModal').classList.add('hidden'); }
async function submitHrpReopen() {
  const reason = document.getElementById('hrpReopenReason').value.trim();
  if (!reason) return alert('⛔ Vui lòng nhập lý do mở lại.');
  try {
    const result = await hrpApiCall('POST', `/api/payroll/periods/${hrpReopenTargetId}/reopen`, { reason });
    hrpApplyPeriodUpdate(result.item);
    renderHrpPeriodsTable();
    closeHrpReopenModal();
  } catch (err) { alert('⛔ ' + err.message); }
}

// ===== Chi tiết 1 kỳ lương (danh sách payslip trong kỳ, điều chỉnh tay) =====
async function openHrpPeriodDetailModal(id) {
  hrpCurrentPeriodDetail = Number(id);
  const period = (DB.payrollPeriods || []).find(p => p.id === hrpCurrentPeriodDetail);
  if (!period) return;
  document.getElementById('hrpPdTitle').textContent = period.periodName;
  document.getElementById('hrpPdStatusBadge').textContent = HRP_STATUS_LABELS[period.status] || period.status;
  document.getElementById('hrpPdActions').innerHTML = hrpPeriodActionButtons(period);
  await hrpRenderPeriodDetailTable();
  document.getElementById('hrpPeriodDetailModal').classList.remove('hidden');
}
function closeHrpPeriodDetailModal() { document.getElementById('hrpPeriodDetailModal').classList.add('hidden'); }

async function hrpRenderPeriodDetailTable() {
  try {
    const data = await hrpApiCall('GET', `/api/payroll/periods/${hrpCurrentPeriodDetail}/payslips`);
    const period = (DB.payrollPeriods || []).find(p => p.id === hrpCurrentPeriodDetail);
    const editable = period?.status === 'DRAFT';
    document.getElementById('hrpPdTableBody').innerHTML = (data.payslips || []).map(ps => `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-2 font-mono">${escapeHtml(ps.employeeCode)}</td>
        <td class="p-2 text-right">${ps.workDays}/${ps.standardDays}</td>
        <td class="p-2 text-right">${fmtMoney(ps.grossIncome)}</td>
        <td class="p-2 text-right">${fmtMoney(ps.totalDeduction)}</td>
        <td class="p-2 text-right font-bold">${fmtMoney(ps.netPay)}</td>
        <td class="p-2 text-right">${editable ? `<button type="button" data-op="openHrpAdjustDetailModal" data-arg0="${ps.id}" class="bg-amber-600 text-white px-2 py-1 rounded text-[11px] hover:bg-amber-700">Điều Chỉnh</button>` : ''}</td>
      </tr>
    `).join('');
  } catch (err) { alert('⛔ ' + err.message); }
}

let hrpAdjustTargetPayslipId = null;
async function openHrpAdjustDetailModal(payslipId) {
  hrpAdjustTargetPayslipId = Number(payslipId);
  const data = await hrpApiCall('GET', `/api/payroll/periods/${hrpCurrentPeriodDetail}/payslips`);
  const payslip = (data.payslips || []).find(p => p.id === hrpAdjustTargetPayslipId);
  if (!payslip) return;
  document.getElementById('hrpAdjEmployeeCode').textContent = payslip.employeeCode;
  const manualRows = (payslip.details || []).filter(d => d.isManualAdjustment);
  document.getElementById('hrpAdjExistingRows').innerHTML = manualRows.length
    ? manualRows.map(d => `<div class="text-xs flex justify-between border-b py-1"><span>${escapeHtml(HRP_COMPONENT_LABELS[d.componentCode] || d.componentCode)}${d.note ? ' — ' + escapeHtml(d.note) : ''}</span><span>${fmtMoney(d.amount)}</span></div>`).join('')
    : '<p class="text-[11px] text-gray-400">Chưa có dòng điều chỉnh tay nào.</p>';
  document.getElementById('hrpAdjComponent').innerHTML = HRP_MANUAL_COMPONENTS.map(c => `<option value="${c}">${escapeHtml(HRP_COMPONENT_LABELS[c])}</option>`).join('');
  document.getElementById('hrpAdjAmount').value = '';
  document.getElementById('hrpAdjNote').value = '';
  document.getElementById('hrpAdjustDetailModal').classList.remove('hidden');
}
function closeHrpAdjustDetailModal() { document.getElementById('hrpAdjustDetailModal').classList.add('hidden'); }

async function submitHrpAdjustDetail() {
  try {
    const componentCode = document.getElementById('hrpAdjComponent').value;
    const amount = Number(document.getElementById('hrpAdjAmount').value);
    const note = document.getElementById('hrpAdjNote').value.trim();
    if (!Number.isFinite(amount)) return alert('⛔ Số tiền không hợp lệ');
    await hrpApiCall('PATCH', `/api/payroll/payslips/${hrpAdjustTargetPayslipId}/details`, { componentCode, amount, note });
    closeHrpAdjustDetailModal();
    await hrpRenderPeriodDetailTable();
  } catch (err) { alert('⛔ ' + err.message); }
}

// ===== Cấu hình % BHXH/BHYT/BHTN/thuế/ngày công chuẩn =====
async function openHrpRateConfigModal() {
  try {
    const data = await hrpApiCall('GET', '/api/payroll/rate-config');
    hrpRateConfigCache = data.config;
    const c = data.config;
    document.getElementById('hrpRcBhxhPercent').value = c.bhxhPercent;
    document.getElementById('hrpRcBhytPercent').value = c.bhytPercent;
    document.getElementById('hrpRcBhtnPercent').value = c.bhtnPercent;
    document.getElementById('hrpRcBhxhCap').value = c.bhxhCap;
    document.getElementById('hrpRcPersonalDeduction').value = c.personalDeduction;
    document.getElementById('hrpRcDependentDeduction').value = c.dependentDeduction;
    document.getElementById('hrpRcStandardWorkDaysHo').value = c.standardWorkDaysHo;
    document.getElementById('hrpRcStandardWorkDaysStore').value = c.standardWorkDaysStore;
    document.getElementById('hrpRcStandardHoursPerDay').value = c.standardHoursPerDay;
    document.getElementById('hrpRcOtMultiplierNormal').value = c.otMultiplierNormal;
    document.getElementById('hrpRcOtMultiplierWeekend').value = c.otMultiplierWeekend;
    document.getElementById('hrpRcOtMultiplierHoliday').value = c.otMultiplierHoliday;
    document.getElementById('hrpRateConfigModal').classList.remove('hidden');
  } catch (err) { alert('⛔ ' + err.message); }
}
function closeHrpRateConfigModal() { document.getElementById('hrpRateConfigModal').classList.add('hidden'); }

async function submitHrpRateConfig() {
  try {
    const payload = Object.assign({}, hrpRateConfigCache, {
      bhxhPercent: Number(document.getElementById('hrpRcBhxhPercent').value),
      bhytPercent: Number(document.getElementById('hrpRcBhytPercent').value),
      bhtnPercent: Number(document.getElementById('hrpRcBhtnPercent').value),
      bhxhCap: Number(document.getElementById('hrpRcBhxhCap').value),
      personalDeduction: Number(document.getElementById('hrpRcPersonalDeduction').value),
      dependentDeduction: Number(document.getElementById('hrpRcDependentDeduction').value),
      standardWorkDaysHo: Number(document.getElementById('hrpRcStandardWorkDaysHo').value),
      standardWorkDaysStore: Number(document.getElementById('hrpRcStandardWorkDaysStore').value),
      standardHoursPerDay: Number(document.getElementById('hrpRcStandardHoursPerDay').value),
      otMultiplierNormal: Number(document.getElementById('hrpRcOtMultiplierNormal').value),
      otMultiplierWeekend: Number(document.getElementById('hrpRcOtMultiplierWeekend').value),
      otMultiplierHoliday: Number(document.getElementById('hrpRcOtMultiplierHoliday').value)
    });
    const result = await hrpApiCall('PUT', '/api/payroll/rate-config', payload);
    hrpRateConfigCache = result.config;
    closeHrpRateConfigModal();
    alert('✅ Đã lưu cấu hình lương.');
  } catch (err) { alert('⛔ ' + err.message); }
}
