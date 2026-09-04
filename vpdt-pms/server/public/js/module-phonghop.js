// ==========================================
// 5. MODULE PHÒNG HỌP (MEETING MODULE)
// ==========================================

// Tìm 1 lịch đã có (chưa Hủy) cùng phòng có khung giờ giao nhau với [startTime, endTime) — tính cả
// lịch Đang chờ duyệt lẫn Đã duyệt là đang "chiếm chỗ", để chặn ngay từ lúc đăng ký thay vì để dồn
// nhiều yêu cầu trùng giờ về cho người phê duyệt. excludeId dùng khi kiểm tra lại 1 lịch đang sửa.
function findMeetingConflict(room, startTime, endTime, excludeId) {
  const newStart = new Date(startTime).getTime();
  const newEnd = new Date(endTime).getTime();
  return DB.meetings.find(m => {
    if (excludeId && m.id === excludeId) return false;
    if (m.status === 'CANCELLED') return false;
    if (m.room !== room) return false;
    const mStart = new Date(m.startTime).getTime();
    const mEnd = new Date(m.endTime).getTime();
    return newStart < mEnd && mStart < newEnd;
  });
}

function toDatetimeLocalValue(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Khung giờ 07:00 - 19:00, mỗi ô 30 phút, dùng cho lưới Lịch Họp.
function generateMeetingTimeSlots() {
  const slots = [];
  for (let h = 7; h < 19; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}

function setMeetingSubTab(subTab) {
  window.scrollTo({ top: 0, behavior: 'auto' }); // Tránh "bay xuống cuối" khi đổi tab con — xem setSystemSubTab().
  activeMeetingSubTab = subTab;
  const btnRegister = document.getElementById('btnMeetingSubRegister');
  const btnCalendar = document.getElementById('btnMeetingSubCalendar');
  if (btnRegister) btnRegister.className = subTab === 'REGISTER' ? 'px-3 py-1 rounded text-xs font-bold bg-emerald-700 text-white' : 'px-3 py-1 rounded text-xs font-bold bg-gray-200 text-gray-700';
  if (btnCalendar) btnCalendar.className = subTab === 'CALENDAR' ? 'px-3 py-1 rounded text-xs font-bold bg-emerald-700 text-white' : 'px-3 py-1 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('meetingRegisterTabContent').classList.toggle('hidden', subTab !== 'REGISTER');
  document.getElementById('meetingCalendarTabContent').classList.toggle('hidden', subTab !== 'CALENDAR');
  if (subTab === 'CALENDAR') renderMeetingCalendar();
}

// Lưới xem nhanh phòng trống/bận theo ngày — bấm đơn 1 ô: ô trắng đặt nhanh 1 tiếng, ô đỏ xem thông
// tin lịch đang chiếm chỗ. Ngoài ra hỗ trợ chọn NHIỀU ô liên tiếp trong CÙNG 1 cột phòng kiểu Outlook
// (kéo chuột, hoặc bấm 1 ô rồi giữ Shift bấm ô thứ 2) để đổ sẵn đúng khoảng thời gian dài hơn sang tab
// Đăng Ký — xem wireMeetingCalendarSelection() ngay dưới.
let meetingCalCurrentDate = null;
let meetingCalSlots = [];
let meetingCalDrag = null;            // { roomIdx, anchorRow, currentRow } khi đang giữ chuột kéo chọn
let meetingCalLastClickedSlot = null; // { roomIdx, rowIdx } của lần bấm gần nhất, dùng cho Shift+bấm

function renderMeetingCalendar() {
  const dateInput = document.getElementById('meetingCalDate');
  if (!dateInput) return;
  if (!dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  const dateStr = dateInput.value;
  const grid = document.getElementById('meetingCalendarGrid');
  if (!grid) return;

  // Bấm 1 ô (không giữ Shift) tự nhảy sang tab Đăng Ký ngay (xem handleMeetingSingleSlotClick) — vì
  // vậy CHỈ xoá "ô bấm gần nhất" khi thật sự đổi NGÀY xem (không đổi khi chỉ qua lại giữa 2 tab con
  // Đăng Ký/Lịch Họp cùng ngày). Nhờ vậy vẫn giữ Shift+bấm được: bấm ô A (nhảy sang Đăng Ký) -> quay
  // lại tab Lịch Họp -> giữ Shift bấm ô B -> chọn đúng khoảng A-B, dù có nhảy tab ở giữa.
  if (meetingCalCurrentDate !== dateStr) meetingCalLastClickedSlot = null;
  meetingCalCurrentDate = dateStr;
  meetingCalDrag = null;
  const slots = generateMeetingTimeSlots();
  meetingCalSlots = slots;

  let html = '<div class="overflow-x-auto"><table class="w-full border-collapse border text-xs bg-white select-none">';
  html += '<thead><tr class="bg-gray-100"><th class="border p-2 w-16">Giờ</th>' +
    MEETING_ROOMS.map(r => `<th class="border p-2">${escapeHtml(r.short)}</th>`).join('') + '</tr></thead><tbody>';

  slots.forEach((slot, rowIdx) => {
    const slotStart = new Date(`${dateStr}T${slot}:00`);
    const slotEnd = new Date(slotStart.getTime() + 30 * 60000);
    html += `<tr><td class="border p-1 text-center text-gray-500 font-mono">${slot}</td>`;
    MEETING_ROOMS.forEach((r, ridx) => {
      const booking = DB.meetings.find(m => {
        if (m.status === 'CANCELLED') return false;
        if (m.room !== r.name) return false;
        const mStart = new Date(m.startTime);
        const mEnd = new Date(m.endTime);
        return slotStart < mEnd && mStart < slotEnd;
      });
      if (booking) {
        html += `<td class="meeting-cell border p-1 h-6 text-center bg-red-500 hover:bg-red-600 cursor-pointer" data-room-idx="${ridx}" data-row-idx="${rowIdx}" data-booking-id="${booking.id}" title="${escapeHtml(booking.title)} — bấm để xem, kéo/Shift+bấm để chọn khoảng"></td>`;
      } else {
        html += `<td class="meeting-cell border p-1 h-6 text-center bg-white hover:bg-emerald-50 cursor-pointer" data-room-idx="${ridx}" data-row-idx="${rowIdx}" title="Còn trống — bấm để đặt, kéo hoặc giữ Shift+bấm để chọn nhiều khung giờ liên tiếp"></td>`;
      }
    });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  grid.innerHTML = html;
  wireMeetingCalendarSelection(grid);
}

// Gắn sự kiện chọn ô — chỉ 1 lần cho mỗi lần tạo mới #meetingCalendarGrid (bản thân div này không bị
// thay thế khi chỉ đổi ngày, chỉ innerHTML bên trong đổi, nên guard bằng cờ trên chính node là đủ,
// không lo gắn trùng listener qua các lần đổi ngày).
function wireMeetingCalendarSelection(grid) {
  if (grid._meetingSelectionWired) return;
  grid._meetingSelectionWired = true;

  grid.addEventListener('mousedown', (e) => {
    const cell = e.target.closest('.meeting-cell');
    if (!cell || e.button !== 0) return;
    e.preventDefault(); // tránh bôi đen text khi kéo qua nhiều ô
    const roomIdx = parseInt(cell.dataset.roomIdx, 10);
    const rowIdx = parseInt(cell.dataset.rowIdx, 10);

    if (e.shiftKey && meetingCalLastClickedSlot && meetingCalLastClickedSlot.roomIdx === roomIdx) {
      finalizeMeetingSlotSelection(roomIdx, meetingCalLastClickedSlot.rowIdx, rowIdx);
      meetingCalLastClickedSlot = { roomIdx, rowIdx };
      return;
    }
    meetingCalDrag = { roomIdx, anchorRow: rowIdx, currentRow: rowIdx };
    highlightMeetingDragRange(grid);
  });

  grid.addEventListener('mouseover', (e) => {
    if (!meetingCalDrag) return;
    const cell = e.target.closest('.meeting-cell');
    if (!cell) return;
    const roomIdx = parseInt(cell.dataset.roomIdx, 10);
    if (roomIdx !== meetingCalDrag.roomIdx) return; // chỉ chọn trong cùng 1 cột phòng
    const rowIdx = parseInt(cell.dataset.rowIdx, 10);
    if (rowIdx === meetingCalDrag.currentRow) return;
    meetingCalDrag.currentRow = rowIdx;
    highlightMeetingDragRange(grid);
  });

  // Gắn ở document (không chỉ ở grid) để vẫn chốt được lựa chọn nếu người dùng nhả chuột ngoài lưới.
  document.addEventListener('mouseup', () => {
    if (!meetingCalDrag) return;
    const { roomIdx, anchorRow, currentRow } = meetingCalDrag;
    meetingCalDrag = null;
    highlightMeetingDragRange(grid);
    meetingCalLastClickedSlot = { roomIdx, rowIdx: currentRow };
    if (anchorRow === currentRow) {
      handleMeetingSingleSlotClick(roomIdx, anchorRow);
    } else {
      finalizeMeetingSlotSelection(roomIdx, anchorRow, currentRow);
    }
  });
}

function highlightMeetingDragRange(grid) {
  if (!grid) grid = document.getElementById('meetingCalendarGrid');
  if (!grid) return;
  const active = meetingCalDrag;
  const lo = active ? Math.min(active.anchorRow, active.currentRow) : -1;
  const hi = active ? Math.max(active.anchorRow, active.currentRow) : -1;
  grid.querySelectorAll('.meeting-cell').forEach(cell => {
    const inRange = !!active && parseInt(cell.dataset.roomIdx, 10) === active.roomIdx &&
      parseInt(cell.dataset.rowIdx, 10) >= lo && parseInt(cell.dataset.rowIdx, 10) <= hi;
    cell.classList.toggle('ring-2', inRange);
    cell.classList.toggle('ring-inset', inRange);
    cell.classList.toggle('ring-emerald-600', inRange);
  });
}

// Bấm đơn (không kéo, không Shift) đúng 1 ô — giữ nguyên hành vi cũ: ô đỏ xem thông tin, ô trắng đặt
// nhanh 1 tiếng.
function handleMeetingSingleSlotClick(roomIdx, rowIdx) {
  const grid = document.getElementById('meetingCalendarGrid');
  const cell = grid && grid.querySelector(`.meeting-cell[data-room-idx="${roomIdx}"][data-row-idx="${rowIdx}"]`);
  if (cell && cell.dataset.bookingId) {
    showMeetingSlotInfo(parseInt(cell.dataset.bookingId, 10));
    return;
  }
  const slot = meetingCalSlots[rowIdx];
  if (!slot) return;
  quickBookMeetingSlot(roomIdx, meetingCalCurrentDate, slot);
}

function showMeetingSlotInfo(id) {
  const m = DB.meetings.find(x => x.id === id);
  if (!m) return;
  const statusLabel = { PENDING: 'Đang chờ duyệt', APPROVED: 'Đã duyệt', CANCELLED: 'Đã hủy' }[m.status] || m.status;
  alert(`📅 ${m.title}\nMã: ${m.code}\nPhòng: ${m.room}\nNgười đặt: ${m.creatorName} (${m.dept})\nThời gian: ${m.startTime} ➔ ${m.endTime}\nTrạng thái: ${statusLabel}`);
}

// Bấm 1 ô trống trên lưới -> chuyển sang tab Đăng Ký, đổ sẵn phòng/ngày/giờ (mặc định 1 tiếng),
// người dùng vẫn xem/sửa lại trước khi gửi — không tự động đặt lịch ngay.
function quickBookMeetingSlot(roomIdx, dateStr, slot) {
  const room = MEETING_ROOMS[roomIdx];
  if (!room) return;
  setMeetingSubTab('REGISTER');
  document.getElementById('meetingRoom').value = room.name;
  const startDate = new Date(`${dateStr}T${slot}:00`);
  document.getElementById('meetingStartTime').value = toDatetimeLocalValue(startDate);
  const endDate = new Date(startDate.getTime() + 60 * 60000);
  document.getElementById('meetingEndTime').value = toDatetimeLocalValue(endDate);
  document.querySelector('#meetingRegisterTabContent form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Chọn nhiều ô liên tiếp trong cùng 1 cột phòng (kéo chuột hoặc Shift+bấm) -> chuyển sang tab Đăng Ký,
// đổ sẵn phòng/ngày + khoảng giờ đúng bằng khoảng đã chọn (không cố định 1 tiếng như bấm đơn).
function finalizeMeetingSlotSelection(roomIdx, rowA, rowB) {
  const room = MEETING_ROOMS[roomIdx];
  if (!room) return;
  const lo = Math.min(rowA, rowB);
  const hi = Math.max(rowA, rowB);
  const startSlot = meetingCalSlots[lo];
  const endSlotStart = meetingCalSlots[hi];
  if (!startSlot || !endSlotStart) return;
  setMeetingSubTab('REGISTER');
  document.getElementById('meetingRoom').value = room.name;
  const startDate = new Date(`${meetingCalCurrentDate}T${startSlot}:00`);
  const endDate = new Date(new Date(`${meetingCalCurrentDate}T${endSlotStart}:00`).getTime() + 30 * 60000);
  document.getElementById('meetingStartTime').value = toDatetimeLocalValue(startDate);
  document.getElementById('meetingEndTime').value = toDatetimeLocalValue(endDate);
  document.querySelector('#meetingRegisterTabContent form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function submitMeetingReq(e) {
  e.preventDefault();
  const code = document.getElementById('meetingCode').value.trim();
  const dept = document.getElementById('meetingDept').value;
  const room = document.getElementById('meetingRoom').value;
  const title = document.getElementById('meetingTitle').value.trim();
  const attendees = parseInt(document.getElementById('meetingAttendees').value, 10) || 1;
  const startTime = document.getElementById('meetingStartTime').value;
  const endTime = document.getElementById('meetingEndTime').value;
  const equipment = document.getElementById('meetingEquipment').value.trim();
  const agenda = document.getElementById('meetingAgenda').value.trim();

  if (DB.meetings.some(m => m.code === code)) {
    return alert('Mã phiếu đặt phòng họp đã tồn tại!');
  }

  if (new Date(startTime) >= new Date(endTime)) {
    return alert('⛔ Thời gian bắt đầu phải trước thời gian kết thúc!');
  }

  const conflict = findMeetingConflict(room, startTime, endTime, null);
  if (conflict) {
    const conflictStatusLabel = conflict.status === 'APPROVED' ? 'Đã duyệt' : 'Đang chờ duyệt';
    return alert(`⛔ Phòng "${room}" đã có lịch trùng khung giờ này!\n\nLịch trùng: ${conflict.code} - ${conflict.title}\nThời gian: ${conflict.startTime} ➔ ${conflict.endTime}\nTrạng thái: ${conflictStatusLabel}\n\nVui lòng chọn phòng khác hoặc đổi khung giờ.`);
  }

  let customData;
  try {
    customData = await collectDynamicFieldsData('MEETING_ROOM');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const meetingPayload = {
    code: code,
    dept: dept,
    room: room,
    title: title,
    attendees: attendees,
    startTime: startTime,
    endTime: endTime,
    equipment: equipment,
    agenda: agenda,
    customData: customData,
    createdAt: new Date().toLocaleString('vi-VN'),
    status: 'PENDING'
  };

  let newMeeting;
  try {
    const result = await callCreateAction('meetings', meetingPayload);
    newMeeting = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.meetings.unshift(newMeeting);
  logSystemAction('MEETING', 'CREATE_MEETING', `Đặt lịch phòng họp [${code} - ${room}]`, 'SUCCESS', code);

  const meetingApprovers = getMeetingApproverUsernames();
  if (meetingApprovers.length) {
    notifyUsersByEmail('MEETING', 'NOTIFY_APPROVAL_NEEDED', code, meetingApprovers,
      `[VPDT] Lịch phòng họp ${code} cần bạn phê duyệt`,
      `Lịch đặt phòng "${room}" (${code}) do ${currentUser.name} đăng ký đang chờ bạn phê duyệt.`);
  }

  alert('✅ Đã gửi đăng ký lịch phòng họp thành công!');
  e.target.reset();
  document.getElementById('meetingCode').value = generateMeetingCode();
  renderMeetings();
}

function onMeetingFilterChange() {
  resetListPage('meeting');
  renderMeetings();
}

function filterMeetingByCard(status) {
  applyDashboardCardFilter({ filterStatusMeeting: status }, 'meeting', renderMeetings);
}

function renderMeetings() {
  const tbody = document.getElementById('meetingTableBody');
  if (!tbody) return;

  const deptFilter = document.getElementById('filterDeptMeeting')?.value || '';
  const statusFilter = document.getElementById('filterStatusMeeting')?.value || '';
  const fromDate = document.getElementById('filterFromDateMeeting')?.value || '';
  const toDate = document.getElementById('filterToDateMeeting')?.value || '';
  const keyword = (document.getElementById('filterKeywordMeeting')?.value || '').trim();

  // CẬP NHẬT: lọc theo phạm vi Xem (meetingView) thay vì hiển thị lịch họp của mọi phòng ban.
  // Người có quyền Phê duyệt/Hủy lịch họp (vai trò quản lý phòng họp dùng chung toàn công ty)
  // vẫn cần thấy mọi lịch để xử lý, nên được xem toàn bộ bất kể phạm vi phòng ban.
  const canViewMeeting = m => scopeAllows(currentUser, currentUser.perms?.meetingView, m.dept) ||
    m.creator === currentUser.username ||
    canApproveMeeting(currentUser) || canCancelMeeting(currentUser);

  const scopedMeetings = DB.meetings.filter(canViewMeeting);
  const meetingDashCards = [
    { key: '', label: 'Tổng Lịch Họp', count: scopedMeetings.length, colorClass: 'border-l-blue-500' },
    { key: 'PENDING', label: 'Đang Chờ Duyệt', count: scopedMeetings.filter(m => m.status === 'PENDING').length, colorClass: 'border-l-yellow-500' },
    { key: 'APPROVED', label: 'Đã Duyệt Lịch', count: scopedMeetings.filter(m => m.status === 'APPROVED').length, colorClass: 'border-l-green-500' },
    { key: 'CANCELLED', label: 'Đã Hủy Lịch', count: scopedMeetings.filter(m => m.status === 'CANCELLED').length, colorClass: 'border-l-red-500' }
  ];
  document.getElementById('meetingDashboardCards').innerHTML = buildDashboardCardsHTML(meetingDashCards, statusFilter, 'filterMeetingByCard');

  const visibleMeetings = DB.meetings.filter(m => {
    if (!canViewMeeting(m)) return false;

    if (deptFilter && m.dept !== deptFilter) return false;
    if (statusFilter && m.status !== statusFilter) return false;
    if (!isInDateRange(m.createdAt, fromDate, toDate)) return false;
    if (!matchesKeywordFields([m.code, m.title, m.creatorName], keyword)) return false;

    return true;
  });

  document.getElementById('paginationContainer_meeting').innerHTML = buildPaginationBoxHTML('meeting', 'renderMeetings');
  const pageMeetings = paginateList('meeting', visibleMeetings, 'renderMeetings', 'lịch họp');

  if (pageMeetings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-gray-500 italic">Không tìm thấy lịch họp phù hợp.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageMeetings.map(m => {
    let statusBadge = '';
    if (m.status === 'APPROVED') statusBadge = `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã duyệt lịch</span>`;
    else if (m.status === 'CANCELLED') statusBadge = `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Đã hủy lịch</span>`;
    else statusBadge = `<span class="px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded font-bold text-xs">⏳ Đang chờ duyệt</span>`;

    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2 font-mono font-bold text-emerald-800">${escapeHtml(m.code)}<br><span class="text-xs font-normal text-gray-600">${escapeHtml(m.room)}</span></td>
        <td class="border p-2">
          <div class="font-bold text-gray-800">${escapeHtml(m.title)}</div>
          <div class="text-xs text-gray-500">Số người: ${m.attendees} | Thiết bị: ${escapeHtml(m.equipment || 'Không')}</div>
        </td>
        <td class="border p-2 text-xs">${escapeHtml(m.startTime)}<br>➔ ${escapeHtml(m.endTime)}</td>
        <td class="border p-2">${escapeHtml(m.dept)} (${escapeHtml(m.creatorName)})</td>
        <td class="border p-2">${statusBadge}</td>
        <td class="border p-2 text-center space-x-1">
          ${(() => {
            const canApprove = canApproveMeeting(currentUser) && m.status === 'PENDING';
            const canCancel = canCancelMeeting(currentUser, m) && m.status !== 'CANCELLED';
            if (canApprove) {
              const primaryBtnHTML = `<button data-op="approveMeeting" data-arg0="${m.id}" class="bg-emerald-600 text-white px-2 py-1 rounded text-xs hover:bg-emerald-700 font-bold">Duyệt</button>`;
              return buildActionCell(m.id, primaryBtnHTML, canCancel ? [{ value: 'cancel', label: 'Hủy' }] : [], 'runMeetingAction');
            }
            if (canCancel) {
              return `<button data-op="runMeetingAction" data-arg0="${m.id}" data-arg1="cancel" class="bg-red-600 text-white px-2 py-1 rounded text-xs hover:bg-red-700 font-bold">Hủy</button>`;
            }
            return '';
          })()}
        </td>
      </tr>
    `;
  }).join('');
}

// Hàm điều phối cho khối "Thao Tác" của Phòng họp (xem buildActionCell()).
function runMeetingAction(id, action) {
  switch (action) {
    case 'approve': approveMeeting(id); break;
    case 'cancel': cancelMeeting(id); break;
  }
}

async function approveMeeting(id) {
  const m = DB.meetings.find(item => item.id === id);
  if (!m) return;

  let updated;
  try {
    const result = await callMeetingAction(id, 'approve');
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.meetings.findIndex(item => item.id === id);
  if (idx !== -1) DB.meetings[idx] = updated;
  logSystemAction('MEETING', 'APPROVE_MEETING', `Phê duyệt đặt phòng họp [${updated.code}]`, 'SUCCESS', updated.code);
  notifyUsersByEmail('MEETING', 'NOTIFY_APPROVED', updated.code, [updated.creator],
    `[VPDT] Lịch phòng họp ${updated.code} đã được phê duyệt`,
    `Lịch đặt phòng "${updated.room}" (${updated.code}) của bạn đã được phê duyệt.`);
  renderMeetings();
  refreshApprovalSurfaces();
}

async function cancelMeeting(id) {
  const m = DB.meetings.find(item => item.id === id);
  if (!m) return;

  let updated;
  try {
    const result = await callMeetingAction(id, 'cancel');
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const idx = DB.meetings.findIndex(item => item.id === id);
  if (idx !== -1) DB.meetings[idx] = updated;
  logSystemAction('MEETING', 'CANCEL_MEETING', `Hủy lịch phòng họp [${updated.code}]`, 'SUCCESS', updated.code);
  notifyUsersByEmail('MEETING', 'NOTIFY_REJECTED', updated.code, [updated.creator],
    `[VPDT] Lịch phòng họp ${updated.code} đã bị hủy`,
    `Lịch đặt phòng "${updated.room}" (${updated.code}) của bạn đã bị hủy.`);
  renderMeetings();
}

