// module-conghop.js — Nhân Sự > Công & Phép (Đợt 3/4 module Nhân Sự, Phần E tài liệu thiết kế gốc). Xem
// lib/attendance.js đầu file phía server cho toàn bộ điều chỉnh so với tài liệu gốc. 4 khối con, ẩn/hiện
// theo quyền (renderHrAttendanceModule()):
//   SELF    - "Của Tôi": mở cho MỌI người có module "hr" (canAccessHrAttendanceModule() ở core.js) — tự
//             xem chấm công/phép năm/nộp đơn nghỉ phép/lịch phân ca của CHÍNH MÌNH.
//   APPROVE - "Duyệt Nghỉ Phép": quản lý trực tiếp có quyền hrLeaveApprove (+ HR/admin).
//   ROSTER  - "Phân Ca Siêu Thị": Quản Lý Siêu Thị (hrShiftRosterManage lập lịch / hrShiftSwapApprove
//             duyệt đổi ca — 2 quyền độc lập, 1 người có thể chỉ có 1 trong 2) + HR/admin (cả 2).
//   MANAGE  - "Quản Lý & Cấu Hình": HR (hrAttendanceManage) — chấm công toàn công ty, phép năm, cấu hình
//             giờ hành chính/ngày lễ/mẫu ca, API key máy chấm công.
// Toàn bộ collection dbo.Records (attendanceRecords/leaveBalances/leaveRequests/shiftRoster/
// shiftSwapRequests) đã được SERVER lọc quyền xem sẵn trong GET /api/data (xem routes/data.js) — client
// chỉ cần lọc thêm theo "của tôi" (so DB.myEmployeeCode) hoặc hiển thị nguyên những gì server đã trả về,
// KHÔNG cần tự lọc lại quyền xem (đã đúng phạm vi từ server).
const HAC_LEAVE_TYPE_LABELS = { ANNUAL: 'Phép năm', UNPAID: 'Nghỉ không lương', SICK: 'Nghỉ ốm' };
const HAC_LEAVE_STATUS_LABELS = {
  PENDING: '<span class="text-amber-600 font-bold">⏳ Chờ duyệt</span>',
  APPROVED: '<span class="text-green-700 font-bold">✅ Đã duyệt</span>',
  REJECTED: '<span class="text-red-600 font-bold">⛔ Từ chối</span>',
  CANCELLED: '<span class="text-gray-400 font-bold">🚫 Đã huỷ</span>'
};
const HAC_RECORD_TYPE_LABELS = {
  WORK: 'Đi làm', LEAVE_PAID: 'Nghỉ phép năm', LEAVE_UNPAID: 'Nghỉ không lương',
  SICK_LEAVE: 'Nghỉ ốm', BUSINESS_TRIP: 'Công tác', OVERTIME: 'Tăng ca'
};
const HAC_ROSTER_STATUS_LABELS = {
  SCHEDULED: '<span class="text-green-700 font-bold">Đã xếp lịch</span>',
  SWAPPED: '<span class="text-blue-700 font-bold">Đã đổi ca</span>',
  CANCELLED: '<span class="text-gray-400 font-bold">Đã huỷ</span>'
};
const HAC_SWAP_STATUS_LABELS = {
  PENDING: '<span class="text-amber-600 font-bold">⏳ Chờ duyệt</span>',
  APPROVED: '<span class="text-green-700 font-bold">✅ Đã duyệt</span>',
  REJECTED: '<span class="text-red-600 font-bold">⛔ Từ chối</span>'
};

let activeHrAttendanceView = 'SELF';

function canManageHacAttendance(user) { return !!(user?.perms?.admin || user?.perms?.hrAttendanceManage); }
function canApproveHacLeave(user) { return !!(user?.perms?.admin || user?.perms?.hrAttendanceManage || user?.perms?.hrLeaveApprove); }
function canManageHacRoster(user) { return !!(user?.perms?.admin || user?.perms?.hrAttendanceManage || user?.perms?.hrShiftRosterManage); }
function canApproveHacSwap(user) { return !!(user?.perms?.admin || user?.perms?.hrAttendanceManage || user?.perms?.hrShiftSwapApprove); }
// SHIFT_BASED cho CHÍNH người xem — dùng luôn currentUser.posType (đúng ĐÚNG khuôn
// resolveWorkModelForEmployeeCode() phía server áp dụng cho tài khoản đã liên kết, xem lib/attendance.js).
function hacMyWorkModel() { return currentUser?.posType === 'STORE' ? 'SHIFT_BASED' : 'OFFICE_HOURS'; }

function renderHrAttendanceModule() {
  document.getElementById('btnHacViewApprove').classList.toggle('hidden', !canApproveHacLeave(currentUser));
  document.getElementById('btnHacViewRoster').classList.toggle('hidden', !(canManageHacRoster(currentUser) || canApproveHacSwap(currentUser)));
  document.getElementById('btnHacViewManage').classList.toggle('hidden', !canManageHacAttendance(currentUser));
  if (activeHrAttendanceView === 'APPROVE' && !canApproveHacLeave(currentUser)) activeHrAttendanceView = 'SELF';
  if (activeHrAttendanceView === 'ROSTER' && !(canManageHacRoster(currentUser) || canApproveHacSwap(currentUser))) activeHrAttendanceView = 'SELF';
  if (activeHrAttendanceView === 'MANAGE' && !canManageHacAttendance(currentUser)) activeHrAttendanceView = 'SELF';
  setHrAttendanceView(activeHrAttendanceView);
}

const HAC_VIEW_IDS = { SELF: 'Self', APPROVE: 'Approve', ROSTER: 'Roster', MANAGE: 'Manage' };
function setHrAttendanceView(view) {
  activeHrAttendanceView = view;
  Object.entries(HAC_VIEW_IDS).forEach(([v, id]) => {
    document.getElementById(`hacView${id}`).classList.toggle('hidden', v !== view);
    const btn = document.getElementById(`btnHacView${id}`);
    if (!btn) return;
    btn.classList.toggle('bg-teal-600', v === view);
    btn.classList.toggle('text-white', v === view);
    btn.classList.toggle('bg-gray-100', v !== view);
    btn.classList.toggle('text-gray-700', v !== view);
  });
  if (view === 'SELF') renderHacSelfView();
  else if (view === 'APPROVE') renderHacApproveView();
  else if (view === 'ROSTER') renderHacRosterView();
  else if (view === 'MANAGE') renderHacManageView();
}

// ===================== "Của Tôi" =====================
function renderHacSelfView() {
  const myCode = DB.myEmployeeCode;
  document.getElementById('hacSelfNoProfile').classList.toggle('hidden', !!myCode);
  document.getElementById('hacSelfBody').classList.toggle('hidden', !myCode);
  if (!myCode) return;

  const workModel = hacMyWorkModel();
  document.getElementById('hacSelfWorkModel').textContent = workModel === 'SHIFT_BASED' ? '🏬 Siêu Thị (theo ca)' : '🏢 Văn Phòng (giờ hành chính)';

  const year = new Date().getFullYear();
  const balance = (DB.leaveBalances || []).find(b => b.employeeCode === myCode && b.year === year);
  document.getElementById('hacSelfLeaveBalance').textContent = balance
    ? `${(balance.totalDays - balance.usedDays).toFixed(1)} / ${balance.totalDays} ngày`
    : 'Chưa có dữ liệu';

  const since = new Date(); since.setDate(since.getDate() - 30);
  const sinceStr = since.toISOString().slice(0, 10);
  const attList = (DB.attendanceRecords || [])
    .filter(r => r.employeeCode === myCode && r.workDate >= sinceStr)
    .sort((a, b) => b.workDate.localeCompare(a.workDate));
  const attBody = document.getElementById('hacSelfAttendanceBody');
  document.getElementById('hacSelfAttendanceEmpty').classList.toggle('hidden', attList.length > 0);
  attBody.innerHTML = attList.map(r => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2">${escapeHtml(r.workDate)}</td>
      <td class="p-2">${escapeHtml(HAC_RECORD_TYPE_LABELS[r.recordType] || r.recordType)}</td>
      <td class="p-2">${r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
      <td class="p-2">${r.checkOutTime ? new Date(r.checkOutTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
      <td class="p-2">${r.hoursWorked != null ? r.hoursWorked : '—'}</td>
      <td class="p-2 text-gray-500">${escapeHtml(r.note || '')}${r.isLate ? ' <span class="text-amber-600 font-bold">(Trễ)</span>' : ''}${r.isEarlyLeave ? ' <span class="text-amber-600 font-bold">(Về sớm)</span>' : ''}</td>
    </tr>
  `).join('');

  const lrList = (DB.leaveRequests || []).filter(r => r.employeeCode === myCode).sort((a, b) => b.fromDate.localeCompare(a.fromDate));
  const lrBody = document.getElementById('hacSelfLeaveRequestBody');
  document.getElementById('hacSelfLeaveRequestEmpty').classList.toggle('hidden', lrList.length > 0);
  lrBody.innerHTML = lrList.map(r => {
    const canCancel = r.status === 'PENDING' || (r.status === 'APPROVED' && r.fromDate > new Date().toISOString().slice(0, 10));
    return `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2">${escapeHtml(HAC_LEAVE_TYPE_LABELS[r.leaveType] || r.leaveType)}</td>
      <td class="p-2">${escapeHtml(r.fromDate)}</td>
      <td class="p-2">${escapeHtml(r.toDate)}</td>
      <td class="p-2">${r.daysCount}</td>
      <td class="p-2">${HAC_LEAVE_STATUS_LABELS[r.status] || escapeHtml(r.status)}</td>
      <td class="p-2">${canCancel ? `<button type="button" data-op="cancelHacLeaveRequest" data-arg0="${r.id}" class="bg-gray-200 text-gray-700 px-2 py-1 rounded text-[11px] font-bold hover:bg-gray-300">Huỷ Đơn</button>` : ''}</td>
    </tr>
  `; }).join('');

  const rosterWrap = document.getElementById('hacSelfRosterWrap');
  rosterWrap.classList.toggle('hidden', workModel !== 'SHIFT_BASED');
  if (workModel === 'SHIFT_BASED') {
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date(); until.setDate(until.getDate() + 14);
    const untilStr = until.toISOString().slice(0, 10);
    const rosterList = (DB.shiftRoster || [])
      .filter(r => r.employeeCode === myCode && r.workDate >= today && r.workDate <= untilStr && r.status !== 'CANCELLED')
      .sort((a, b) => a.workDate.localeCompare(b.workDate));
    const rosterBody = document.getElementById('hacSelfRosterBody');
    document.getElementById('hacSelfRosterEmpty').classList.toggle('hidden', rosterList.length > 0);
    rosterBody.innerHTML = rosterList.map(r => {
      const tpl = (DB.shiftTemplates || []).find(t => t.id === r.shiftTemplateId);
      const hasPendingSwap = (DB.shiftSwapRequests || []).some(s => s.requesterRosterId === r.id && s.status === 'PENDING');
      return `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-2">${escapeHtml(r.workDate)}</td>
        <td class="p-2">${escapeHtml(tpl ? `${tpl.shiftCode} - ${tpl.shiftName}` : '—')}</td>
        <td class="p-2">${escapeHtml(tpl ? `${tpl.startTime}-${tpl.endTime}` : '—')}</td>
        <td class="p-2">${escapeHtml(r.storeCode || '')}</td>
        <td class="p-2">${HAC_ROSTER_STATUS_LABELS[r.status] || escapeHtml(r.status)}</td>
        <td class="p-2">${hasPendingSwap ? '<span class="text-gray-400 text-[11px]">Đang chờ duyệt đổi ca</span>' : `<button type="button" data-op="openHacSwapRequestModal" data-arg0="${r.id}" class="bg-teal-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-teal-700">🔄 Xin Đổi Ca</button>`}</td>
      </tr>
    `; }).join('');
  }
}

function openHacLeaveRequestModal() {
  document.getElementById('hacLeaveRequestForm').reset();
  document.getElementById('hacLeaveRequestModal').classList.remove('hidden');
}
function closeHacLeaveRequestModal() { document.getElementById('hacLeaveRequestModal').classList.add('hidden'); }

async function submitHacLeaveRequest(e) {
  e.preventDefault();
  const leaveType = document.getElementById('hacLrType').value;
  const fromDate = document.getElementById('hacLrFromDate').value;
  const toDate = document.getElementById('hacLrToDate').value;
  if (!fromDate || !toDate) return alert('⛔ Vui lòng chọn đủ Từ Ngày/Đến Ngày.');
  const reason = document.getElementById('hacLrReason').value.trim();
  try {
    await callCreateAction('leaveRequests', { leaveType, fromDate, toDate, reason });
    closeHacLeaveRequestModal();
    alert('✅ Đã gửi đơn nghỉ phép, chờ quản lý trực tiếp/HR duyệt.');
    await initDatabase(currentUser);
    renderHacSelfView();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

async function cancelHacLeaveRequest(id) {
  if (!confirm('Huỷ đơn nghỉ phép này?')) return;
  try {
    const result = await callRecordAction('leaveRequests', id, 'cancel', {});
    hacApplyLeaveRequestUpdate(result.item);
    renderHacSelfView();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

function openHacSwapRequestModal(rosterId) {
  const roster = (DB.shiftRoster || []).find(r => r.id === Number(rosterId));
  if (!roster) return;
  const tpl = (DB.shiftTemplates || []).find(t => t.id === roster.shiftTemplateId);
  document.getElementById('hacSwapRequestForm').reset();
  document.getElementById('hacSwapRosterId').value = rosterId;
  document.getElementById('hacSwapRosterInfo').textContent = `Ca ngày ${roster.workDate} — ${tpl ? `${tpl.shiftCode} (${tpl.startTime}-${tpl.endTime})` : ''} tại ${roster.storeCode}`;
  document.getElementById('hacSwapRequestModal').classList.remove('hidden');
}
function closeHacSwapRequestModal() { document.getElementById('hacSwapRequestModal').classList.add('hidden'); }

async function submitHacSwapRequest(e) {
  e.preventDefault();
  const requesterRosterId = Number(document.getElementById('hacSwapRosterId').value);
  const targetEmployeeCode = document.getElementById('hacSwapTargetEmployeeCode').value.trim();
  if (!targetEmployeeCode) return alert('⛔ Vui lòng nhập Mã Nhân Viên nhận ca thay.');
  const reason = document.getElementById('hacSwapReason').value.trim();
  try {
    await callCreateAction('shiftSwapRequests', { requesterRosterId, targetEmployeeCode, reason });
    closeHacSwapRequestModal();
    alert('✅ Đã gửi yêu cầu đổi ca, chờ Quản Lý Siêu Thị/HR duyệt.');
    await initDatabase(currentUser);
    renderHacSelfView();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// ===================== "Duyệt Nghỉ Phép" =====================
function renderHacApproveView() {
  const myCode = DB.myEmployeeCode;
  const list = (DB.leaveRequests || []).filter(r => r.status === 'PENDING' && r.employeeCode !== myCode);
  const body = document.getElementById('hacApproveLeaveBody');
  document.getElementById('hacApproveLeaveEmpty').classList.toggle('hidden', list.length > 0);
  body.innerHTML = list.map(r => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2 font-mono">${escapeHtml(r.employeeCode)}</td>
      <td class="p-2">${escapeHtml(HAC_LEAVE_TYPE_LABELS[r.leaveType] || r.leaveType)}</td>
      <td class="p-2">${escapeHtml(r.fromDate)}</td>
      <td class="p-2">${escapeHtml(r.toDate)}</td>
      <td class="p-2">${r.daysCount}</td>
      <td class="p-2 text-gray-600">${escapeHtml(r.reason || '')}</td>
      <td class="p-2 space-x-1">
        <button type="button" data-op="approveHacLeaveRequest" data-arg0="${r.id}" class="bg-teal-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-teal-700">Duyệt</button>
        <button type="button" data-op="rejectHacLeaveRequest" data-arg0="${r.id}" class="bg-red-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-red-700">Từ Chối</button>
      </td>
    </tr>
  `).join('');
}

function hacApplyLeaveRequestUpdate(item) {
  DB.leaveRequests = DB.leaveRequests || [];
  const idx = DB.leaveRequests.findIndex(r => r.id === item.id);
  if (idx >= 0) DB.leaveRequests[idx] = item; else DB.leaveRequests.unshift(item);
}

async function approveHacLeaveRequest(id) {
  if (!confirm('Duyệt đơn nghỉ phép này?')) return;
  try {
    const result = await callRecordAction('leaveRequests', id, 'approve', {});
    hacApplyLeaveRequestUpdate(result.item);
    await initDatabase(currentUser);
    renderHacApproveView();
    alert('✅ Đã duyệt đơn nghỉ phép.');
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}
async function rejectHacLeaveRequest(id) {
  const reason = prompt('Lý do từ chối:');
  if (reason === null) return;
  try {
    const result = await callRecordAction('leaveRequests', id, 'reject', { reason });
    hacApplyLeaveRequestUpdate(result.item);
    renderHacApproveView();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// ===================== "Phân Ca Siêu Thị" =====================
function renderHacRosterView() {
  const showManage = canManageHacRoster(currentUser);
  const showSwap = canApproveHacSwap(currentUser);
  document.getElementById('hacRosterManageWrap').classList.toggle('hidden', !showManage);
  document.getElementById('hacSwapApproveWrap').classList.toggle('hidden', !showSwap);

  if (showManage) {
    const list = [...(DB.shiftRoster || [])].sort((a, b) => b.workDate.localeCompare(a.workDate));
    const body = document.getElementById('hacRosterBody');
    document.getElementById('hacRosterEmpty').classList.toggle('hidden', list.length > 0);
    body.innerHTML = list.map(r => {
      const tpl = (DB.shiftTemplates || []).find(t => t.id === r.shiftTemplateId);
      const canCancel = r.status !== 'CANCELLED' && (currentUser.perms?.admin || currentUser.perms?.hrAttendanceManage || (currentUser.perms?.hrShiftRosterManage && r.storeCode === currentUser.dept));
      return `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-2 font-mono">${escapeHtml(r.employeeCode)}</td>
        <td class="p-2">${escapeHtml(r.workDate)}</td>
        <td class="p-2">${escapeHtml(tpl ? `${tpl.shiftCode} (${tpl.startTime}-${tpl.endTime})` : '—')}</td>
        <td class="p-2">${escapeHtml(r.storeCode || '')}</td>
        <td class="p-2">${HAC_ROSTER_STATUS_LABELS[r.status] || escapeHtml(r.status)}</td>
        <td class="p-2">${canCancel ? `<button type="button" data-op="cancelHacRoster" data-arg0="${r.id}" class="bg-gray-200 text-gray-700 px-2 py-1 rounded text-[11px] font-bold hover:bg-gray-300">Huỷ</button>` : ''}</td>
      </tr>
    `; }).join('');
  }

  if (showSwap) {
    const list = (DB.shiftSwapRequests || []).filter(s => s.status === 'PENDING');
    const body = document.getElementById('hacSwapBody');
    document.getElementById('hacSwapEmpty').classList.toggle('hidden', list.length > 0);
    body.innerHTML = list.map(s => {
      const roster = (DB.shiftRoster || []).find(r => r.id === s.requesterRosterId);
      const tpl = roster ? (DB.shiftTemplates || []).find(t => t.id === roster.shiftTemplateId) : null;
      return `
      <tr class="border-b hover:bg-gray-50">
        <td class="p-2 font-mono">${escapeHtml(s.requesterEmployeeCode)}</td>
        <td class="p-2">${roster ? escapeHtml(`${roster.workDate} — ${tpl ? tpl.shiftCode : ''} (${roster.storeCode})`) : '(đã bị xoá)'}</td>
        <td class="p-2 font-mono">${escapeHtml(s.targetEmployeeCode)}</td>
        <td class="p-2 text-gray-600">${escapeHtml(s.reason || '')}</td>
        <td class="p-2 space-x-1">
          <button type="button" data-op="approveHacSwapRequest" data-arg0="${s.id}" class="bg-teal-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-teal-700">Duyệt</button>
          <button type="button" data-op="rejectHacSwapRequest" data-arg0="${s.id}" class="bg-red-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-red-700">Từ Chối</button>
        </td>
      </tr>
    `; }).join('');
  }
}

function hacApplyRosterUpdate(item) {
  DB.shiftRoster = DB.shiftRoster || [];
  const idx = DB.shiftRoster.findIndex(r => r.id === item.id);
  if (idx >= 0) DB.shiftRoster[idx] = item; else DB.shiftRoster.unshift(item);
}
function hacApplySwapUpdate(item) {
  DB.shiftSwapRequests = DB.shiftSwapRequests || [];
  const idx = DB.shiftSwapRequests.findIndex(s => s.id === item.id);
  if (idx >= 0) DB.shiftSwapRequests[idx] = item; else DB.shiftSwapRequests.unshift(item);
}

function openHacRosterModal() {
  document.getElementById('hacRosterForm').reset();
  const sel = document.getElementById('hacRosterShiftTemplateId');
  sel.innerHTML = (DB.shiftTemplates || []).filter(t => t.isActive !== false)
    .map(t => `<option value="${t.id}">${escapeHtml(t.shiftCode)} — ${escapeHtml(t.shiftName)} (${escapeHtml(t.startTime)}-${escapeHtml(t.endTime)})</option>`).join('');
  sddSetOptions('hacRosterStoreDatalist', DB.stores || []);
  if (currentUser?.posType === 'STORE') document.getElementById('hacRosterStoreCode').value = currentUser.dept || '';
  document.getElementById('hacRosterModal').classList.remove('hidden');
}
function closeHacRosterModal() { document.getElementById('hacRosterModal').classList.add('hidden'); }

async function submitHacRoster(e) {
  e.preventDefault();
  const employeeCode = document.getElementById('hacRosterEmployeeCode').value.trim();
  const workDate = document.getElementById('hacRosterWorkDate').value;
  const shiftTemplateId = Number(document.getElementById('hacRosterShiftTemplateId').value);
  const storeCode = document.getElementById('hacRosterStoreCode').value.trim();
  if (!employeeCode || !workDate || !shiftTemplateId || !storeCode) return alert('⛔ Vui lòng điền đủ thông tin.');
  try {
    await callCreateAction('shiftRoster', { employeeCode, workDate, shiftTemplateId, storeCode });
    closeHacRosterModal();
    await initDatabase(currentUser);
    renderHacRosterView();
    alert('✅ Đã phân ca.');
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

async function cancelHacRoster(id) {
  if (!confirm('Huỷ dòng phân ca này?')) return;
  try {
    const result = await callRecordAction('shiftRoster', id, 'cancel', {});
    hacApplyRosterUpdate(result.item);
    renderHacRosterView();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

async function approveHacSwapRequest(id) {
  if (!confirm('Duyệt yêu cầu đổi ca này?')) return;
  try {
    const result = await callRecordAction('shiftSwapRequests', id, 'approve', {});
    hacApplySwapUpdate(result.item);
    await initDatabase(currentUser);
    renderHacRosterView();
    alert('✅ Đã duyệt đổi ca.');
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}
async function rejectHacSwapRequest(id) {
  if (!confirm('Từ chối yêu cầu đổi ca này?')) return;
  try {
    const result = await callRecordAction('shiftSwapRequests', id, 'reject', {});
    hacApplySwapUpdate(result.item);
    renderHacRosterView();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// ===================== "Quản Lý & Cấu Hình" =====================
function renderHacManageView() {
  renderHacManageAttendanceTable();
  renderHacManageLeaveBalanceTable();
  renderHacHoConfigForm();
  renderHacHolidayTable();
  renderHacShiftTemplateTable();
  renderAttendanceClockApiKeysTable();
}

function renderHacManageAttendanceTable() {
  const filter = (document.getElementById('hacMgrFilterEmployeeCode')?.value || '').trim().toLowerCase();
  let list = [...(DB.attendanceRecords || [])].sort((a, b) => b.workDate.localeCompare(a.workDate));
  if (filter) list = list.filter(r => (r.employeeCode || '').toLowerCase().includes(filter));
  list = list.slice(0, 300);
  const body = document.getElementById('hacMgrAttendanceBody');
  document.getElementById('hacMgrAttendanceEmpty').classList.toggle('hidden', list.length > 0);
  body.innerHTML = list.map(r => {
    const flags = [r.isLate ? 'Trễ' : '', r.isEarlyLeave ? 'Về sớm' : '', r.isHolidayWork ? 'Lễ' : '', r.isWeekendWork ? 'CT' : ''].filter(Boolean).join(', ');
    return `
    <tr class="border-b hover:bg-gray-50 cursor-pointer" data-op="openHacEditAttendanceModal" data-arg0="${r.id}">
      <td class="p-2 font-mono">${escapeHtml(r.employeeCode)}</td>
      <td class="p-2">${escapeHtml(r.workDate)}</td>
      <td class="p-2">${escapeHtml(HAC_RECORD_TYPE_LABELS[r.recordType] || r.recordType)}</td>
      <td class="p-2">${r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
      <td class="p-2">${r.checkOutTime ? new Date(r.checkOutTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
      <td class="p-2">${r.hoursWorked != null ? r.hoursWorked : '—'}</td>
      <td class="p-2 text-amber-600 font-bold">${escapeHtml(flags)}</td>
      <td class="p-2"><button type="button" data-op="openHacEditAttendanceModal" data-arg0="${r.id}" class="bg-slate-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-slate-700">Sửa</button></td>
    </tr>
  `; }).join('');
}

function hacApplyAttendanceUpdate(item) {
  DB.attendanceRecords = DB.attendanceRecords || [];
  const idx = DB.attendanceRecords.findIndex(r => r.id === item.id);
  if (idx >= 0) DB.attendanceRecords[idx] = item; else DB.attendanceRecords.unshift(item);
}

function openHacManualAttendanceModal() {
  document.getElementById('hacManualAttendanceForm').reset();
  document.getElementById('hacManualAttendanceModal').classList.remove('hidden');
}
function closeHacManualAttendanceModal() { document.getElementById('hacManualAttendanceModal').classList.add('hidden'); }

async function submitHacManualAttendance(e) {
  e.preventDefault();
  const employeeCode = document.getElementById('hacManAttEmployeeCode').value.trim();
  const workDate = document.getElementById('hacManAttWorkDate').value;
  if (!employeeCode || !workDate) return alert('⛔ Vui lòng nhập Mã Nhân Viên và Ngày.');
  const recordTypeInput = document.getElementById('hacManAttRecordType').value;
  const checkInRaw = document.getElementById('hacManAttCheckIn').value;
  const checkOutRaw = document.getElementById('hacManAttCheckOut').value;
  const noteInput = document.getElementById('hacManAttNote').value.trim();
  try {
    await callCreateAction('attendanceRecords', {
      employeeCode, workDate, recordTypeInput,
      checkInTimeInput: checkInRaw ? new Date(checkInRaw).toISOString() : null,
      checkOutTimeInput: checkOutRaw ? new Date(checkOutRaw).toISOString() : null,
      noteInput
    });
    closeHacManualAttendanceModal();
    await initDatabase(currentUser);
    renderHacManageAttendanceTable();
    alert('✅ Đã bổ sung bản ghi công.');
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

function openHacEditAttendanceModal(id) {
  const r = (DB.attendanceRecords || []).find(x => x.id === Number(id));
  if (!r) return;
  document.getElementById('hacEditAttId').value = r.id;
  document.getElementById('hacEditAttRecordType').value = r.recordType;
  document.getElementById('hacEditAttCheckIn').value = r.checkInTime ? r.checkInTime.slice(0, 16) : '';
  document.getElementById('hacEditAttCheckOut').value = r.checkOutTime ? r.checkOutTime.slice(0, 16) : '';
  document.getElementById('hacEditAttNote').value = '';
  document.getElementById('hacEditAttendanceModal').classList.remove('hidden');
}
function closeHacEditAttendanceModal() { document.getElementById('hacEditAttendanceModal').classList.add('hidden'); }

async function submitHacEditAttendance(e) {
  e.preventDefault();
  const id = Number(document.getElementById('hacEditAttId').value);
  const recordType = document.getElementById('hacEditAttRecordType').value;
  const checkInRaw = document.getElementById('hacEditAttCheckIn').value;
  const checkOutRaw = document.getElementById('hacEditAttCheckOut').value;
  const note = document.getElementById('hacEditAttNote').value.trim();
  try {
    const result = await callRecordAction('attendanceRecords', id, 'edit', {
      recordType,
      checkInTime: checkInRaw ? new Date(checkInRaw).toISOString() : null,
      checkOutTime: checkOutRaw ? new Date(checkOutRaw).toISOString() : null,
      note
    });
    hacApplyAttendanceUpdate(result.item);
    closeHacEditAttendanceModal();
    renderHacManageAttendanceTable();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

async function deleteHacAttendanceRecord() {
  const id = Number(document.getElementById('hacEditAttId').value);
  if (!confirm('Xoá vĩnh viễn bản ghi công này?')) return;
  try {
    await callRecordAction('attendanceRecords', id, 'delete', {});
    DB.attendanceRecords = (DB.attendanceRecords || []).filter(r => r.id !== id);
    closeHacEditAttendanceModal();
    renderHacManageAttendanceTable();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

function renderHacManageLeaveBalanceTable() {
  const list = [...(DB.leaveBalances || [])].sort((a, b) => b.year - a.year || (a.employeeCode || '').localeCompare(b.employeeCode || ''));
  const body = document.getElementById('hacMgrLeaveBalanceBody');
  document.getElementById('hacMgrLeaveBalanceEmpty').classList.toggle('hidden', list.length > 0);
  body.innerHTML = list.map(b => `
    <tr class="border-b hover:bg-gray-50 cursor-pointer" data-op="openHacAdjustLeaveBalanceModal" data-arg0="${b.id}">
      <td class="p-2 font-mono">${escapeHtml(b.employeeCode)}</td>
      <td class="p-2">${b.year}</td>
      <td class="p-2">${b.totalDays}</td>
      <td class="p-2">${b.usedDays}</td>
      <td class="p-2 font-bold">${(b.totalDays - b.usedDays).toFixed(1)}</td>
      <td class="p-2"><button type="button" data-op="openHacAdjustLeaveBalanceModal" data-arg0="${b.id}" class="bg-slate-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-slate-700">Sửa</button></td>
    </tr>
  `).join('');
}

function hacApplyLeaveBalanceUpdate(item) {
  DB.leaveBalances = DB.leaveBalances || [];
  const idx = DB.leaveBalances.findIndex(b => b.id === item.id);
  if (idx >= 0) DB.leaveBalances[idx] = item; else DB.leaveBalances.unshift(item);
}

function openHacLeaveBalanceModal() {
  document.getElementById('hacLeaveBalanceForm').reset();
  document.getElementById('hacLbYear').value = new Date().getFullYear();
  document.getElementById('hacLeaveBalanceModal').classList.remove('hidden');
}
function closeHacLeaveBalanceModal() { document.getElementById('hacLeaveBalanceModal').classList.add('hidden'); }

async function submitHacLeaveBalance(e) {
  e.preventDefault();
  const employeeCode = document.getElementById('hacLbEmployeeCode').value.trim();
  const year = Number(document.getElementById('hacLbYear').value);
  const totalDays = Number(document.getElementById('hacLbTotalDays').value);
  if (!employeeCode || !year || !Number.isFinite(totalDays)) return alert('⛔ Vui lòng điền đủ thông tin.');
  try {
    await callCreateAction('leaveBalances', { employeeCode, year, totalDays });
    closeHacLeaveBalanceModal();
    await initDatabase(currentUser);
    renderHacManageLeaveBalanceTable();
    alert('✅ Đã tạo bảng phép năm.');
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

function openHacAdjustLeaveBalanceModal(id) {
  const b = (DB.leaveBalances || []).find(x => x.id === Number(id));
  if (!b) return;
  document.getElementById('hacAdjLbId').value = b.id;
  document.getElementById('hacAdjLbTotalDays').value = b.totalDays;
  document.getElementById('hacAdjLbUsedDays').value = b.usedDays;
  document.getElementById('hacAdjustLeaveBalanceModal').classList.remove('hidden');
}
function closeHacAdjustLeaveBalanceModal() { document.getElementById('hacAdjustLeaveBalanceModal').classList.add('hidden'); }

async function submitHacAdjustLeaveBalance(e) {
  e.preventDefault();
  const id = Number(document.getElementById('hacAdjLbId').value);
  const totalDays = document.getElementById('hacAdjLbTotalDays').value;
  const usedDays = document.getElementById('hacAdjLbUsedDays').value;
  try {
    const result = await callRecordAction('leaveBalances', id, 'adjust', {
      totalDays: totalDays === '' ? undefined : Number(totalDays),
      usedDays: usedDays === '' ? undefined : Number(usedDays)
    });
    hacApplyLeaveBalanceUpdate(result.item);
    closeHacAdjustLeaveBalanceModal();
    renderHacManageLeaveBalanceTable();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

async function deleteHacLeaveBalance() {
  const id = Number(document.getElementById('hacAdjLbId').value);
  if (!confirm('Xoá vĩnh viễn bảng phép năm này?')) return;
  try {
    await callRecordAction('leaveBalances', id, 'delete', {});
    DB.leaveBalances = (DB.leaveBalances || []).filter(b => b.id !== id);
    closeHacAdjustLeaveBalanceModal();
    renderHacManageLeaveBalanceTable();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

function renderHacHoConfigForm() {
  const cfg = DB.attendanceHoConfig || {};
  document.getElementById('hacCfgStartTime').value = cfg.startTime || '08:00';
  document.getElementById('hacCfgEndTime').value = cfg.endTime || '17:00';
  document.getElementById('hacCfgBreakMinutes').value = cfg.breakMinutes ?? 60;
  document.getElementById('hacCfgLateGrace').value = cfg.lateGraceMinutes ?? 0;
}

async function submitHacHoConfig(e) {
  e.preventDefault();
  DB.attendanceHoConfig = {
    startTime: document.getElementById('hacCfgStartTime').value || '08:00',
    endTime: document.getElementById('hacCfgEndTime').value || '17:00',
    breakMinutes: Number(document.getElementById('hacCfgBreakMinutes').value) || 0,
    standardHoursPerDay: DB.attendanceHoConfig?.standardHoursPerDay || 8,
    lateGraceMinutes: Number(document.getElementById('hacCfgLateGrace').value) || 0
  };
  const ok = await syncStorage('attendanceHoConfig');
  if (ok) alert('✅ Đã lưu cấu hình giờ hành chính.');
}

function renderHacHolidayTable() {
  const list = [...(DB.publicHolidays || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const body = document.getElementById('hacHolidayBody');
  document.getElementById('hacHolidayEmpty').classList.toggle('hidden', list.length > 0);
  body.innerHTML = list.map((h, idx) => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2">${escapeHtml(h.date)}</td>
      <td class="p-2">${escapeHtml(h.name)}</td>
      <td class="p-2"><button type="button" data-op="deleteHacHoliday" data-arg0="${idx}" class="bg-gray-200 text-gray-700 px-2 py-1 rounded text-[11px] font-bold hover:bg-gray-300">Xoá</button></td>
    </tr>
  `).join('');
}

function openHacHolidayModal() {
  document.getElementById('hacHolidayForm').reset();
  document.getElementById('hacHolidayModal').classList.remove('hidden');
}
function closeHacHolidayModal() { document.getElementById('hacHolidayModal').classList.add('hidden'); }

async function submitHacHoliday(e) {
  e.preventDefault();
  const date = document.getElementById('hacHolidayDate').value;
  const name = document.getElementById('hacHolidayName').value.trim();
  if (!date || !name) return alert('⛔ Vui lòng nhập đủ Ngày và Tên ngày lễ.');
  if ((DB.publicHolidays || []).some(h => h.date === date)) return alert('⛔ Ngày này đã có trong danh mục.');
  DB.publicHolidays = [...(DB.publicHolidays || []), { date, name }];
  const ok = await syncStorage('publicHolidays');
  if (ok) { closeHacHolidayModal(); renderHacHolidayTable(); }
}

async function deleteHacHoliday(idx) {
  if (!confirm('Xoá ngày lễ này?')) return;
  DB.publicHolidays = (DB.publicHolidays || []).filter((_, i) => i !== Number(idx));
  const ok = await syncStorage('publicHolidays');
  if (ok) renderHacHolidayTable();
}

function renderHacShiftTemplateTable() {
  const list = [...(DB.shiftTemplates || [])].sort((a, b) => (a.shiftCode || '').localeCompare(b.shiftCode || ''));
  const body = document.getElementById('hacShiftTemplateBody');
  document.getElementById('hacShiftTemplateEmpty').classList.toggle('hidden', list.length > 0);
  body.innerHTML = list.map(t => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2 font-mono">${escapeHtml(t.shiftCode)}</td>
      <td class="p-2">${escapeHtml(t.shiftName)}${t.isNightShift ? ' 🌙' : ''}</td>
      <td class="p-2">${escapeHtml(t.startTime)} - ${escapeHtml(t.endTime)}</td>
      <td class="p-2">${t.standardHours}</td>
      <td class="p-2">${t.isActive === false ? '<span class="text-gray-400 font-bold">Ngừng dùng</span>' : '<span class="text-green-700 font-bold">Đang dùng</span>'}</td>
      <td class="p-2"><button type="button" data-op="toggleHacShiftTemplateActive" data-arg0="${t.id}" class="bg-gray-200 text-gray-700 px-2 py-1 rounded text-[11px] font-bold hover:bg-gray-300">${t.isActive === false ? 'Bật lại' : 'Ngừng dùng'}</button></td>
    </tr>
  `).join('');
}

function openHacShiftTemplateModal() {
  document.getElementById('hacShiftTemplateForm').reset();
  document.getElementById('hacShiftTemplateModal').classList.remove('hidden');
}
function closeHacShiftTemplateModal() { document.getElementById('hacShiftTemplateModal').classList.add('hidden'); }

async function submitHacShiftTemplate(e) {
  e.preventDefault();
  const shiftCode = document.getElementById('hacStShiftCode').value.trim().toUpperCase();
  const shiftName = document.getElementById('hacStShiftName').value.trim();
  const startTime = document.getElementById('hacStStartTime').value;
  const endTime = document.getElementById('hacStEndTime').value;
  const standardHours = Number(document.getElementById('hacStStandardHours').value);
  if (!shiftCode || !shiftName || !startTime || !endTime || !Number.isFinite(standardHours)) return alert('⛔ Vui lòng điền đủ thông tin.');
  if ((DB.shiftTemplates || []).some(t => t.shiftCode === shiftCode)) return alert('⛔ Mã Ca này đã tồn tại.');
  const breakMinutes = Number(document.getElementById('hacStBreakMinutes').value) || 0;
  const isNightShift = document.getElementById('hacStIsNightShift').checked;
  const nextId = ((DB.shiftTemplates || []).reduce((m, t) => Math.max(m, Number(t.id) || 0), 0)) + 1;
  DB.shiftTemplates = [...(DB.shiftTemplates || []), { id: nextId, shiftCode, shiftName, startTime, endTime, breakMinutes, isNightShift, standardHours, isActive: true }];
  const ok = await syncStorage('shiftTemplates');
  if (ok) { closeHacShiftTemplateModal(); renderHacShiftTemplateTable(); }
}

async function toggleHacShiftTemplateActive(id) {
  DB.shiftTemplates = (DB.shiftTemplates || []).map(t => t.id === Number(id) ? { ...t, isActive: t.isActive === false } : t);
  const ok = await syncStorage('shiftTemplates');
  if (ok) renderHacShiftTemplateTable();
}

// ---------- API Key Máy Chấm Công (routes/attendanceClockAdmin.js) — mirror ĐÚNG khuôn API Xác Thực
// Ngoài (module-hethong-tabs.js), tách riêng endpoint/collection theo lib/attendance.js đầu file. ----------
function renderAttendanceClockApiKeysTable() {
  const tbody = document.getElementById('hacClockKeyBody');
  if (!tbody) return;
  const list = [...(DB.attendanceClockApiKeys || [])].sort((a, b) => (b.id || 0) - (a.id || 0));
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-3 text-center text-gray-400 italic">Chưa có API key nào</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(k => `
    <tr class="border-b hover:bg-gray-50">
      <td class="py-1.5 px-2 font-semibold">${escapeHtml(k.name)}</td>
      <td class="py-1.5 px-2 font-mono text-gray-500">${escapeHtml(k.keyPrefix)}…</td>
      <td class="py-1.5 px-2">${Array.isArray(k.allowedIps) && k.allowedIps.length ? `<span class="font-mono">${k.allowedIps.map(escapeHtml).join(', ')}</span>` : `<span class="text-gray-400 italic">Mọi IP</span>`}</td>
      <td class="py-1.5 px-2">${k.active === false ? `<span class="text-red-600 font-bold">Đã thu hồi</span>` : `<span class="text-green-700 font-bold">Đang hoạt động</span>`}</td>
      <td class="py-1.5 px-2">${k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('vi-VN') : '<span class="text-gray-400 italic">Chưa dùng</span>'}</td>
      <td class="py-1.5 px-2">${k.active === false ? '' : `<button type="button" data-op="revokeAttendanceClockApiKeyAction" data-arg0="${k.id}" class="bg-red-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-red-700">Thu hồi</button>`}</td>
    </tr>
  `).join('');
}

async function createAttendanceClockApiKeyAction(e) {
  e.preventDefault();
  const nameInput = document.getElementById('hacClockKeyName');
  const name = nameInput.value.trim();
  if (!name) return;
  const allowedIps = document.getElementById('hacClockKeyAllowedIps').value;
  try {
    const res = await fetch('/api/admin/attendance-clock-api-keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, allowedIps })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    const { apiKey, ...record } = body;
    DB.attendanceClockApiKeys = [...(DB.attendanceClockApiKeys || []), record];
    nameInput.value = '';
    document.getElementById('hacClockKeyAllowedIps').value = '';
    renderAttendanceClockApiKeysTable();
    document.getElementById('hacClockKeyRevealValue').textContent = apiKey;
    document.getElementById('hacClockKeyRevealBox').classList.remove('hidden');
  } catch (err) {
    alert(`⛔ Lỗi tạo API key: ${err.message}`);
  }
}

function closeHacClockKeyRevealBox() { document.getElementById('hacClockKeyRevealBox').classList.add('hidden'); }

async function copyAttendanceClockApiKeyReveal() {
  const value = document.getElementById('hacClockKeyRevealValue').textContent;
  try {
    await navigator.clipboard.writeText(value);
    alert('✅ Đã sao chép API key vào bộ nhớ tạm.');
  } catch (err) {
    alert('⛔ Không tự sao chép được — vui lòng bôi đen và sao chép thủ công.');
  }
}

async function revokeAttendanceClockApiKeyAction(id) {
  const target = (DB.attendanceClockApiKeys || []).find(k => k.id === id);
  const name = target ? target.name : '';
  if (!confirm(`Thu hồi API key "${name}"? Máy chấm công đang dùng key này sẽ KHÔNG thể gửi dữ liệu được nữa (không thể hoàn tác).`)) return;
  try {
    const res = await fetch(`/api/admin/attendance-clock-api-keys/${id}/revoke`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    DB.attendanceClockApiKeys = (DB.attendanceClockApiKeys || []).map(k => k.id === id ? { ...k, active: false } : k);
    renderAttendanceClockApiKeysTable();
  } catch (err) {
    alert(`⛔ Lỗi thu hồi API key: ${err.message}`);
  }
}
