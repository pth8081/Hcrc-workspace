// ==========================================
// 6. MODULE ĐĂNG KÝ XE (CAR REGISTRATION MODULE)
// ==========================================
async function submitCarReq(e) {
  e.preventDefault();
  const code = document.getElementById('carCode').value.trim();
  const dept = document.getElementById('carDept').value;
  const type = document.getElementById('carType').value;
  const passengers = document.getElementById('carPassengers').value.trim();
  const directUser = document.getElementById('carDirectUser').value.trim();
  const directUserPhone = document.getElementById('carDirectUserPhone').value.trim();
  const purpose = document.getElementById('carPurpose').value;
  const km = parseFloat(document.getElementById('carKm').value) || 0;
  const startTime = document.getElementById('carStartTime').value;
  const endTime = document.getElementById('carEndTime').value;
  const routePoints = carRoutePoints.map(p => p.trim()).filter(Boolean);
  const destination = routePoints.join(' → ');
  const reason = document.getElementById('carReason').value.trim();

  if (routePoints.length < 2) {
    return alert('Vui lòng nhập ít nhất Điểm xuất phát và 1 điểm đến!');
  }
  if (DB.carRegs.some(c => c.code === code)) {
    return alert('Mã phiếu đăng ký xe đã tồn tại!');
  }

  let customData;
  try {
    customData = await collectDynamicFieldsData('CAR');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const carPayload = {
    code: code,
    dept: dept,
    type: type,
    passengers: passengers,
    // Người sử dụng trực tiếp có thể khác người đăng ký; để trống = chính người đăng ký.
    directUser: directUser || currentUser.name,
    directUserPhone: directUserPhone || currentUser.phone || '',
    purpose: purpose,
    km: km,
    startTime: startTime,
    endTime: endTime,
    routePoints: routePoints,
    destination: destination,
    reason: reason,
    customData: customData,
    registrantPhone: currentUser.phone || '',
    createdAt: new Date().toLocaleString('vi-VN'),
    status: 'PENDING',
    currentStep: 1,
    history: [],
    // Do Phòng Hành Chính điền khi xử lý duyệt (xem openCarProcessModal/processCarReg) — KHÔNG
    // thu thập ở bước đăng ký vì người đăng ký thường chưa biết xe/lái xe cụ thể sẽ được xếp.
    assignedDriver: '',
    assignedVehicleType: '',
    assignedPlate: '',
    assignedTaxiCompany: ''
  };

  let newCar;
  try {
    const result = await callCreateAction('carRegs', carPayload);
    newCar = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.carRegs.unshift(newCar);
  logSystemAction('CAR', 'CREATE_CAR_REG', `Tạo phiếu đăng ký xe [${code} - ${destination}]`, 'SUCCESS', code);

  const newCarWfConfig = DB.carDeptWorkflows[dept];
  const newCarApprovers = resolveEffectiveStepApprovers(newCarWfConfig, 1);
  if (newCarApprovers.length) {
    notifyUsersByEmail('CAR', 'NOTIFY_APPROVAL_NEEDED', code, newCarApprovers,
      `[VPDT] Đăng ký xe ${code} cần bạn phê duyệt`,
      `Phiếu đăng ký xe "${destination}" (${code}) do ${currentUser.name} đăng ký đang chờ bạn phê duyệt.`);
  }

  alert('✅ Đã gửi phiếu đăng ký xe thành công!');
  resetCarRegForm();
  renderCarRegs();
}

// Xem trước quy trình duyệt phiếu đăng ký xe theo Đơn Vị đang chọn — cùng khuôn
// previewContractApprovalWorkflow() (module-vanbantrinh.js), chỉ khác map tra cứu.
function previewCarWorkflow() {
  const dept = document.getElementById('carDept').value;
  if (!dept) return alert('Vui lòng chọn Đơn Vị (Phòng/Ban/Bộ phận) trước khi xem quy trình!');
  openGenericWorkflowPreviewModal(
    '🔍 Xem Trước Quy Trình Phê Duyệt Đăng Ký Xe',
    `Phòng ban: ${dept}`,
    DB.carDeptWorkflows[dept],
    `Phòng ban "${dept}" chưa được cấu hình quy trình phê duyệt đăng ký xe.`
  );
}

// resetCarRegForm() — nút "↺ Làm Mới" (data-op="confirmAndResetForm" data-arg1="resetCarRegForm", xem
// core.js) VÀ luồng gửi phiếu thành công ở trên (trước đây 3 dòng reset viết thẳng tại chỗ gọi, factor
// ra đây tránh 2 nơi lệch nhau). form.reset() gốc không tự sinh lại mã lẫn không tự trắng "Lộ Trình Di
// Chuyển" (mảng JS carRoutePoints, không phải input thường nên form.reset() không đụng tới) — phải gọi
// resetCarRoutePoints() + sinh lại mã tường minh ngay sau reset(). Không có ô tải tệp nào ở form này.
function resetCarRegForm() {
  const formEl = document.getElementById('carForm');
  if (formEl) formEl.reset();
  resetCarRoutePoints();
  document.getElementById('carCode').value = generateCarCode();
}

// ============ Lộ Trình Di Chuyển nhiều điểm (thay 1 ô text tự do) ============
function resetCarRoutePoints() {
  carRoutePoints = ['', ''];
  renderCarRoutePoints();
}

function addCarRoutePoint() {
  carRoutePoints.push('');
  renderCarRoutePoints();
}

function removeCarRoutePoint(idx) {
  if (carRoutePoints.length <= 2) return; // luôn giữ tối thiểu Điểm xuất phát + 1 điểm đến
  carRoutePoints.splice(idx, 1);
  renderCarRoutePoints();
}

function updateCarRoutePoint(idx, value) {
  carRoutePoints[idx] = value;
  document.getElementById('carDestination').value = carRoutePoints.map(p => p.trim()).filter(Boolean).join(' → ');
}

function renderCarRoutePoints() {
  const wrap = document.getElementById('carRoutePointsWrap');
  if (!wrap) return;
  wrap.innerHTML = carRoutePoints.map((p, idx) => `
    <div class="flex items-center gap-2">
      <span class="text-xs text-gray-500 w-24 shrink-0">${idx === 0 ? 'Điểm xuất phát' : `Điểm ${idx}`}</span>
      <input value="${escapeHtml(p)}" data-op-input="updateCarRoutePoint" data-arg0="${idx}" data-arg-value="1" placeholder="${idx === 0 ? 'VD: Hội An' : 'VD: Đà Nẵng'}" class="flex-1 border p-1.5 rounded text-xs">
      ${carRoutePoints.length > 2 ? `<button type="button" data-op="removeCarRoutePoint" data-arg0="${idx}" class="text-red-500 hover:text-red-700 text-xs font-bold">✕</button>` : ''}
    </div>
  `).join('');
  document.getElementById('carDestination').value = carRoutePoints.map(p => p.trim()).filter(Boolean).join(' → ');
}

function setCarSubTab(subTab) {
  window.scrollTo({ top: 0, behavior: 'auto' }); // Tránh "bay xuống cuối" khi đổi tab con — xem setSystemSubTab().
  // "📊 Báo Cáo" CHỈ hiện cho người quản lý (canSeeCarReportClient(), xem core.js) — chặn cả trường hợp
  // subTab='REPORT' được truyền vào khi KHÔNG có quyền (URL/gọi hàm trực tiếp), lùi về REG thay vì hiện
  // trắng — cùng khuôn setMeetingSubTab() (module-phonghop.js).
  const canSeeReport = canSeeCarReportClient(currentUser);
  if (subTab === 'REPORT' && !canSeeReport) subTab = 'REG';

  activeCarSubTab = subTab;
  document.getElementById('carSubReg').classList.toggle('hidden', subTab !== 'REG');
  document.getElementById('carSubCalendar').classList.toggle('hidden', subTab !== 'CALENDAR');
  document.getElementById('carSubDriver').classList.toggle('hidden', subTab !== 'DRIVER');
  document.getElementById('carSubReport').classList.toggle('hidden', subTab !== 'REPORT');
  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-indigo-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnCarSubReg').className = subTab === 'REG' ? activeCls : inactiveCls;
  document.getElementById('btnCarSubCalendar').className = subTab === 'CALENDAR' ? activeCls : inactiveCls;
  document.getElementById('btnCarSubDriver').className = subTab === 'DRIVER' ? activeCls : inactiveCls;
  // Gộp ẩn/hiện theo quyền + tô màu active trong ĐÚNG 1 lần gán className — tránh đúng bug đã sửa ở
  // setMeetingSubTab() (gán className riêng sau đó xoá mất class "hidden" vừa toggle).
  const btnReport = document.getElementById('btnCarSubReport');
  if (btnReport) btnReport.className = (subTab === 'REPORT' ? activeCls : inactiveCls) + (canSeeReport ? '' : ' hidden');
  if (subTab === 'REG') {
    renderDynamicInputsForModule('CAR', 'dynamicFieldsContainer_CAR');
    renderCarRegs();
    document.getElementById('carCode').value = generateCarCode();
    if (!carRoutePoints.length) resetCarRoutePoints(); else renderCarRoutePoints();
  }
  if (subTab === 'CALENDAR') renderCarScheduleCalendar();
  if (subTab === 'DRIVER') renderCarDriverTab();
  if (subTab === 'REPORT') renderCarReportTab();
}

// ============ Sub-tab "Lịch Xe" — lưới CHỈ XEM lịch trống/bận của lái xe (giống Lịch Họp ở
// module-phonghop.js, nhưng KHÔNG có tương tác đặt lịch/kéo chọn — phương án đã xác nhận với người
// dùng: đây chỉ là màn xem, biển số/lái xe cụ thể vẫn do Phòng Hành Chính phân công khi xử lý duyệt). ============

// Khung giờ 07:00 - 19:00, mỗi ô 30 phút — BẢN SAO của generateMeetingTimeSlots() (module-phonghop.js):
// nhóm tải module "dangkyxe" KHÔNG có dependency lên nhóm "phonghop" (xem MODULE_LOAD_GROUPS ở
// public/js/core.js) nên vào thẳng tab Đăng Ký Xe (không qua tab Phòng Họp trước) sẽ không có sẵn hàm
// generateMeetingTimeSlots() — tách riêng 1 bản cho module Xe để không phụ thuộc thứ tự nạp module.
function generateCarTimeSlots() {
  const slots = [];
  for (let h = 7; h < 19; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}

// carCalViewMode (mới, giống meetingCalViewMode ở module-phonghop.js) — "Lịch Xe" giờ có 3 chế độ: DAY
// (lưới giờ chi tiết theo lái xe, hành vi CŨ giữ nguyên y hệt — chỉ xem, bấm ô đỏ xem thông tin),
// WEEK/MONTH (mới, chỉ xem TỔNG QUAN — mỗi ô ngày hiện số chuyến đã có theo từng lái xe, bấm vào 1 ô
// ngày bất kỳ nhảy về chế độ DAY của ngày đó). Mục đích: xem trống/bận của lái xe xa hơn 1 ngày mà
// không phải dò từng ngày một qua ô chọn ngày.
let carCalViewMode = 'DAY';

function setCarCalViewMode(mode) {
  carCalViewMode = mode;
  ['DAY', 'WEEK', 'MONTH'].forEach(m => {
    const btn = document.getElementById(`btnCarCalView${m}`);
    if (!btn) return;
    btn.classList.toggle('bg-indigo-700', m === mode);
    btn.classList.toggle('text-white', m === mode);
    btn.classList.toggle('bg-gray-200', m !== mode);
    btn.classList.toggle('text-gray-700', m !== mode);
  });
  const hint = document.getElementById('carCalDayHint');
  if (hint) hint.classList.toggle('hidden', mode !== 'DAY');
  renderCarScheduleCalendar();
}

// Nhảy ngày/tuần/tháng (nút ◀ ▶) — bước nhảy tuỳ theo chế độ đang xem, cùng khuôn shiftMeetingCalDate().
function shiftCarCalDate(delta) {
  delta = Number(delta);
  const dateInput = document.getElementById('carCalDate');
  if (!dateInput || !dateInput.value) return;
  const d = new Date(`${dateInput.value}T00:00:00`);
  if (carCalViewMode === 'DAY') d.setDate(d.getDate() + delta);
  else if (carCalViewMode === 'WEEK') d.setDate(d.getDate() + delta * 7);
  else d.setMonth(d.getMonth() + delta);
  dateInput.value = carCalTodayStrOf(d);
  renderCarScheduleCalendar();
}

function carCalTodayStrOf(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function carCalTodayStr() { return carCalTodayStrOf(new Date()); }

function jumpCarCalToToday() {
  document.getElementById('carCalDate').value = carCalTodayStr();
  renderCarScheduleCalendar();
}

// Bấm 1 ô ngày ở chế độ Tuần/Tháng -> nhảy thẳng về chế độ Ngày của đúng ngày đó để xem chi tiết.
function jumpCarCalToDay(dateStr) {
  document.getElementById('carCalDate').value = dateStr;
  setCarCalViewMode('DAY');
}

// "Đang chiếm chỗ" như findCarPlateConflict() (lib/workflowEngine.js): mọi trạng thái TRỪ REJECTED/
// CANCELLED đều tính là bận (PENDING/APPROVED/DRAFT), không chỉ APPROVED.
function isCarRegOccupying(c) {
  return c.status !== 'REJECTED' && c.status !== 'CANCELLED';
}

// Tổng hợp số chuyến (đang chiếm chỗ) theo từng lái xe cho 1 NGÀY cụ thể — dùng chung cho ô ngày ở cả
// chế độ Tuần lẫn Tháng, cùng khuôn computeMeetingDaySummary() (module-phonghop.js).
function computeCarDaySummary(dateStr, drivers) {
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999`);
  const dayTrips = DB.carRegs.filter(c => {
    if (!isCarRegOccupying(c)) return false;
    const cStart = new Date(c.startTime), cEnd = new Date(c.endTime);
    return cStart <= dayEnd && cEnd >= dayStart;
  });
  const byDriver = drivers.map(d => ({
    username: d.username,
    name: d.name,
    count: dayTrips.filter(c => c.assignedDriverUsername === d.username).length
  }));
  return { totalCount: dayTrips.length, byDriver };
}

function renderCarScheduleCalendar() {
  const dateInput = document.getElementById('carCalDate');
  if (!dateInput) return;
  if (!dateInput.value) dateInput.value = carCalTodayStr();
  document.getElementById('carCalendarGrid').classList.toggle('hidden', carCalViewMode !== 'DAY');
  document.getElementById('carCalendarWeekGrid').classList.toggle('hidden', carCalViewMode !== 'WEEK');
  document.getElementById('carCalendarMonthGrid').classList.toggle('hidden', carCalViewMode !== 'MONTH');
  if (carCalViewMode === 'WEEK') return renderCarScheduleCalendarWeekView(dateInput.value);
  if (carCalViewMode === 'MONTH') return renderCarScheduleCalendarMonthView(dateInput.value);
  renderCarScheduleCalendarDayView(dateInput.value);
}

function renderCarScheduleCalendarDayView(dateStr) {
  const grid = document.getElementById('carCalendarGrid');
  if (!grid) return;

  // Cùng nguồn dữ liệu populateCarDriversDatalist() ở module-bienbanhop.js — KHÔNG tự tạo truy vấn lái
  // xe mới, tránh 2 nơi định nghĩa "ai là lái xe" khác nhau.
  const drivers = DB.users.filter(u => u.active !== false && u.isDriver);
  const slots = generateCarTimeSlots();

  let html = '<div class="overflow-x-auto"><table class="w-full border-collapse border text-xs bg-white">';
  html += '<thead><tr class="bg-gray-100"><th class="border p-2 w-16">Giờ</th>' +
    drivers.map(d => `<th class="border p-2">${escapeHtml(d.name)}</th>`).join('') + '</tr></thead><tbody>';

  if (!drivers.length) {
    html += `<tr><td colspan="${1 + drivers.length}" class="border p-3 text-center text-gray-500 italic">Chưa có lái xe nào được đánh dấu "Lái xe" trong Quản Lý Người Dùng.</td></tr>`;
  } else {
    slots.forEach(slot => {
      const slotStart = new Date(`${dateStr}T${slot}:00`);
      const slotEnd = new Date(slotStart.getTime() + 30 * 60000);
      html += `<tr><td class="border p-1 text-center text-gray-500 font-mono">${slot}</td>`;
      drivers.forEach(d => {
        // So sánh bằng Date đầy đủ (không chỉ giờ trong ngày) nên chuyến nhiều ngày tự động hiện đỏ ở
        // MỌI ngày nằm trong khoảng startTime-endTime, không chỉ ngày bắt đầu.
        const booking = DB.carRegs.find(c => {
          if (!isCarRegOccupying(c)) return false;
          if (c.assignedDriverUsername !== d.username) return false;
          const cStart = new Date(c.startTime);
          const cEnd = new Date(c.endTime);
          return slotStart < cEnd && cStart < slotEnd;
        });
        if (booking) {
          html += `<td class="car-cal-cell border p-1 h-6 text-center bg-red-500 hover:bg-red-600 cursor-pointer" data-car-id="${booking.id}" title="${escapeHtml(booking.destination || booking.code || '')} — bấm để xem"></td>`;
        } else {
          html += `<td class="border p-1 h-6 text-center bg-white hover:bg-emerald-50"></td>`;
        }
      });
      html += '</tr>';
    });
  }
  html += '</tbody></table></div>';
  grid.innerHTML = html;
  wireCarCalendarClick(grid);
}

const CAR_CAL_WEEKDAY_LABELS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];

// Trả về 7 Date của tuần (bắt đầu Thứ 2) chứa dateStr — cùng khuôn getMeetingCalWeekDates().
function getCarCalWeekDates(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay(); // 0=CN,1=T2..6=T7
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(monday);
    dt.setDate(monday.getDate() + i);
    return dt;
  });
}

function renderCarScheduleCalendarWeekView(dateStr) {
  const grid = document.getElementById('carCalendarWeekGrid');
  if (!grid) return;
  const todayStr = carCalTodayStr();
  const weekDates = getCarCalWeekDates(dateStr);
  const drivers = DB.users.filter(u => u.active !== false && u.isDriver);
  const html = `
    <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
      ${weekDates.map((dt, i) => {
        const dStr = carCalTodayStrOf(dt);
        const summary = computeCarDaySummary(dStr, drivers);
        const isToday = dStr === todayStr;
        return `
        <div data-op="jumpCarCalToDay" data-arg0="${dStr}" class="border rounded p-2 bg-white cursor-pointer hover:bg-indigo-50 hover:border-indigo-400 ${isToday ? 'ring-2 ring-indigo-500' : ''}">
          <div class="text-center font-bold text-gray-700">${CAR_CAL_WEEKDAY_LABELS[i]}</div>
          <div class="text-center text-gray-500 mb-1.5">${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}</div>
          <div class="space-y-1">
            ${drivers.length ? drivers.map(d => {
              const c = summary.byDriver.find(x => x.username === d.username)?.count || 0;
              return `<div class="px-1.5 py-1 rounded ${c > 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}"><div class="leading-tight break-words">${escapeHtml(d.name)}</div><div class="font-bold">${c > 0 ? c + ' chuyến' : 'Trống'}</div></div>`;
            }).join('') : '<div class="text-gray-400 italic text-center">Chưa có lái xe</div>'}
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
  grid.innerHTML = html;
}

// Trả về đúng 42 ô (6 tuần x 7 ngày, bắt đầu Thứ 2) phủ trọn tháng của dateStr — cùng khuôn
// getMeetingCalMonthGridDates().
function getCarCalMonthGridDates(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const year = d.getFullYear(), month = d.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const firstDay = firstOfMonth.getDay();
  const startOffset = firstDay === 0 ? 6 : firstDay - 1;
  const gridStart = new Date(year, month, 1 - startOffset);
  return { month, cells: Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i)) };
}

function renderCarScheduleCalendarMonthView(dateStr) {
  const grid = document.getElementById('carCalendarMonthGrid');
  if (!grid) return;
  const todayStr = carCalTodayStr();
  const drivers = DB.users.filter(u => u.active !== false && u.isDriver);
  const { month, cells } = getCarCalMonthGridDates(dateStr);
  const html = `
    <div class="bg-white border rounded overflow-hidden">
      <div class="grid grid-cols-7 bg-gray-100 text-center font-bold text-gray-600">
        ${CAR_CAL_WEEKDAY_LABELS.map(l => `<div class="p-1.5 border">${l}</div>`).join('')}
      </div>
      <div class="grid grid-cols-7">
        ${cells.map(dt => {
          const dStr = carCalTodayStrOf(dt);
          const inMonth = dt.getMonth() === month;
          const isToday = dStr === todayStr;
          const summary = computeCarDaySummary(dStr, drivers);
          return `
          <div data-op="jumpCarCalToDay" data-arg0="${dStr}" class="border p-1 min-h-[52px] cursor-pointer hover:bg-indigo-50 ${inMonth ? '' : 'opacity-40'} ${isToday ? 'ring-2 ring-indigo-500 ring-inset' : ''}">
            <div class="font-bold text-gray-700">${dt.getDate()}</div>
            ${summary.totalCount > 0 ? `<div class="text-red-600 font-bold">${summary.totalCount} chuyến</div>` : '<div class="text-emerald-600">Trống</div>'}
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
  grid.innerHTML = html;
}

// Gắn sự kiện click 1 lần cho mỗi lần tạo mới #carCalendarGrid (giữ nguyên khi chỉ đổi ngày, chỉ
// innerHTML bên trong đổi) — chỉ cần lắng nghe click ô đỏ để xem thông tin, KHÔNG cần mousedown/mouseover/
// mouseup kiểu kéo-chọn như wireMeetingCalendarSelection() vì đây là lưới chỉ-xem.
function wireCarCalendarClick(grid) {
  if (grid._carCalWired) return;
  grid._carCalWired = true;
  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.car-cal-cell');
    if (!cell) return;
    showCarScheduleSlotInfo(parseInt(cell.dataset.carId, 10));
  });
}

function showCarScheduleSlotInfo(id) {
  const c = DB.carRegs.find(x => x.id === id);
  if (!c) return;
  const statusLabel = { PENDING: 'Đang chờ duyệt', APPROVED: 'Đã phê duyệt', DRAFT: 'Cần bổ sung — chờ sửa lại', AWAITING_EVALUATION: 'Chờ đánh giá', COMPLETED: 'Hoàn thành' }[c.status] || c.status;
  alert(`🚗 ${c.code}\nLái xe: ${c.assignedDriver || ''}\nBiển số: ${c.assignedPlate || '(chưa gán)'}\nĐiểm đến: ${c.destination || ''}\nThời gian: ${c.startTime} ➔ ${c.endTime}\nTrạng thái: ${statusLabel}`);
}

// ============ Lái Xe (tự xác nhận chuyến được phân công) ============
function renderCarDriverTab() {
  const wrap = document.getElementById('carDriverListWrap');
  const noneNote = document.getElementById('carDriverNoneNote');
  if (!wrap) return;
  const myTrips = DB.carRegs.filter(c => c.assignedDriverUsername === currentUser.username && c.status === 'APPROVED');
  noneNote.classList.toggle('hidden', myTrips.length > 0);
  wrap.innerHTML = myTrips.map(c => `
    <div class="bg-white p-3 rounded border space-y-1">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div class="font-bold text-indigo-800 text-sm">${escapeHtml(c.code)} — ${escapeHtml(c.dept)}</div>
          <div class="text-xs text-gray-600">${escapeHtml(c.destination)}</div>
          <div class="text-xs text-gray-500">${escapeHtml(c.startTime)} ➔ ${escapeHtml(c.endTime)} | Xe: ${escapeHtml(c.type)}${c.assignedPlate ? ` (${escapeHtml(c.assignedPlate)})` : ''}</div>
        </div>
        ${c.driverConfirmed
          ? `<div class="flex items-center gap-2 flex-wrap">
               <span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-[11px]">✅ Đã xác nhận lúc ${escapeHtml(c.driverConfirmedAt || '')}</span>
               <button type="button" data-op="endCarTripAction" data-arg0="${c.id}" class="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-emerald-700">🏁 Kết Thúc Chuyến</button>
             </div>`
          : `<button type="button" data-op="confirmCarDriverAssignmentAction" data-arg0="${c.id}" class="bg-indigo-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-indigo-700">✅ Xác Nhận Đăng Ký</button>`
        }
      </div>
    </div>
  `).join('');
}

function confirmCarDriverAssignmentAction(carId) {
  showConfirmModal({
    title: 'Xác Nhận Đăng Ký Xe',
    bodyHTML: '<p>Bạn xác nhận đã nắm thông tin và sẽ thực hiện chuyến đi này?</p>',
    confirmLabel: 'Xác Nhận',
    onConfirm: async () => {
      let result;
      try {
        result = await callRecordAction('carRegs', carId, 'confirm-driver', {});
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.carRegs.findIndex(x => x.id === carId);
      if (idx !== -1) DB.carRegs[idx] = result.item;
      logSystemAction('CAR', 'CONFIRM_DRIVER', `Lái xe xác nhận đăng ký [${result.item.code}]`, 'SUCCESS', result.item.code);
      renderCarDriverTab();
    }
  });
}

// "Kết Thúc Chuyến" — CHỈ hiện sau khi lái xe đã "Xác Nhận Đăng Ký" (driverConfirmed, xem
// renderCarDriverTab()) — bắt buộc nhập số km đã đi thực tế, chuyển phiếu sang chờ người đăng ký
// Đánh Giá (endCarTripAction() -> xem evaluateCarRegAction() ở dưới cho phía người đăng ký). Dùng
// window.prompt() cho ô nhập km, mirror ĐÚNG khuôn openCancelCarRegModal() (prompt lý do trước, rồi
// mới showConfirmModal xác nhận lần cuối) — không dựng modal riêng.
function endCarTripAction(carId) {
  const c = DB.carRegs.find(x => x.id === carId);
  if (!c) return;
  const kmStr = prompt('Nhập số km đã đi thực tế cho chuyến này:', '');
  if (kmStr === null) return; // bấm Hủy ở hộp prompt -> bỏ ngang
  const km = parseFloat(String(kmStr).trim().replace(',', '.'));
  if (!Number.isFinite(km) || km < 0) return alert('⛔ Số km không hợp lệ, vui lòng thử lại!');
  showConfirmModal({
    title: '🏁 Xác Nhận Kết Thúc Chuyến',
    bodyHTML: `<p>Kết thúc chuyến đăng ký xe <b>${escapeHtml(c.code)}</b> — <i>${escapeHtml(c.destination)}</i> với số km đã đi: <b>${km} km</b>?</p><p class="mt-2 text-gray-600 text-xs italic">Người đăng ký sẽ cần Đánh Giá xác nhận trước khi phiếu này được tính là hoàn thành.</p>`,
    confirmLabel: 'Kết Thúc Chuyến',
    onConfirm: async () => {
      let result;
      try {
        result = await callRecordAction('carRegs', carId, 'end-trip', { km });
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.carRegs.findIndex(x => x.id === carId);
      if (idx !== -1) DB.carRegs[idx] = result.item;
      logSystemAction('CAR', 'END_TRIP', `Lái xe kết thúc chuyến [${result.item.code}] — ${km}km`, 'SUCCESS', result.item.code);
      alert('✅ Đã kết thúc chuyến! Chờ người đăng ký Đánh Giá để phiếu hoàn thành.');
      renderCarDriverTab();
    }
  });
}

// ============ "Hủy chuyến" / "Đổi tài xế-xe" SAU KHI ĐÃ DUYỆT (Fix 4, đợt rà soát nghiệp vụ) ============
// Mirror ĐÚNG canCancelCarReg()/quyền carDispatch ở lib/recordActions.js — chỉ dùng để ẩn/hiện nút,
// server LUÔN tự kiểm tra lại (không tin riêng lớp UI này).
function canCancelCarRegClient(c) {
  if (currentUser?.perms?.admin || currentUser?.perms?.carDispatch) return true;
  return !!(c && c.creator === currentUser?.username);
}
function canDispatchCarClient() {
  return !!(currentUser?.perms?.admin || currentUser?.perms?.carDispatch);
}

// Dùng chung cho cả nút ở dòng danh sách (secondaryOptions) LẪN nút bên trong modal xử lý
// (openCarProcessModal(), khi status đã APPROVED) — reason KHÔNG bắt buộc (mirror đúng Phòng Họp,
// canCancelMeeting()/routes/meetingActions.js action "cancel" cũng không đòi lý do).
function openCancelCarRegModal(id) {
  const c = DB.carRegs.find(x => x.id === id);
  if (!c) return;
  const reason = prompt('Lý do hủy chuyến (không bắt buộc):', '');
  if (reason === null) return; // bấm Hủy ở hộp prompt -> bỏ ngang, không mở tiếp modal xác nhận
  showConfirmModal({
    title: '🚫 Xác Nhận Hủy Chuyến',
    bodyHTML: `<p>Hủy chuyến đăng ký xe <b>${escapeHtml(c.code)}</b> — <i>${escapeHtml(c.destination)}</i>?</p>${reason.trim() ? `<p class="mt-2 italic text-gray-600">Lý do: "${escapeHtml(reason.trim())}"</p>` : ''}<p class="mt-2 text-red-600 font-semibold">Chuyến đã hủy không thể phục hồi lại.</p>`,
    confirmLabel: 'Hủy Chuyến',
    onConfirm: async () => {
      let result;
      try {
        result = await callRecordAction('carRegs', id, 'cancel', { reason: reason.trim() });
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.carRegs.findIndex(x => x.id === id);
      if (idx !== -1) DB.carRegs[idx] = result.item;
      logSystemAction('CAR', 'CANCEL_TRIP', `Hủy chuyến đăng ký xe [${result.item.code}]`, 'SUCCESS', result.item.code);
      alert('✅ Đã hủy chuyến đăng ký xe!');
      closeCarProcessModal();
      renderCarRegs();
      refreshApprovalSurfaces();
    }
  });
}

// "Đổi tài xế-xe" — CHỈ mở được từ trong openCarProcessModal() (carDispatchSection, cùng 3 ô lái
// xe/loại xe/BKS đã dùng để phân công lúc duyệt — TÁI DÙNG nguyên UI đó, không dựng form riêng) — đọc
// currentProcessingCarId (biến toàn cục đã có sẵn của modal này, mirror đúng confirmProcessCarReg()).
function confirmCarReassign() {
  if (!currentProcessingCarId) return;
  const c = DB.carRegs.find(item => item.id === currentProcessingCarId);
  if (!c) return;
  const carAssignedDriverText = document.getElementById('carAssignedDriver').value.trim();
  const assignedDriverUsername = document.getElementById('carAssignedDriverUsername').value;
  if (carAssignedDriverText && !assignedDriverUsername) {
    return alert('Vui lòng chọn đúng lái xe từ danh sách gợi ý (gõ tên hoặc tài khoản để tìm)!');
  }
  const assignedVehicleType = document.getElementById('carAssignedVehicleType').value.trim();
  const assignedPlate = document.getElementById('carAssignedPlate').value.trim();
  const assignedTaxiCompany = document.getElementById('carAssignedTaxiCompany').value.trim();
  const comment = document.getElementById('txtCarComment').value.trim();
  showConfirmModal({
    title: '🔁 Xác Nhận Đổi Tài Xế-Xe',
    bodyHTML: `<p>Cập nhật phân công xe/lái xe cho chuyến <b>${escapeHtml(c.code)}</b> — <i>${escapeHtml(c.destination)}</i>?</p>`,
    confirmLabel: 'Cập Nhật',
    onConfirm: async () => {
      let result;
      try {
        result = await callRecordAction('carRegs', c.id, 'reassign', { assignedDriverUsername, assignedVehicleType, assignedPlate, assignedTaxiCompany, comment });
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.carRegs.findIndex(x => x.id === c.id);
      if (idx !== -1) DB.carRegs[idx] = result.item;
      logSystemAction('CAR', 'REASSIGN', `Đổi tài xế-xe cho phiếu [${result.item.code}]`, 'SUCCESS', result.item.code);
      alert('✅ Đã cập nhật tài xế-xe!');
      closeCarProcessModal();
      renderCarRegs();
    }
  });
}

// ===== Danh Mục "Loại Xe Cụ Thể" (DB.carVehicleTypes) — Đăng Ký Xe > Phần Dành Cho Phòng Hành Chính,
// xem defaults.js. Mỗi mục thường (isTaxi:false) gắn 1 biển số cố định (bienSo) để tự động điền BKS khi
// chọn (xem onCarAssignedVehicleTypeChange() ở trên); mục Taxi (isTaxi:true) không có biển số cố định,
// form đổi sang hiện ô "Hãng Taxi" (DB.carTaxiCompanies, ngay dưới đây) thay vì tự điền biển số. =====
function saveCarVehicleType(e) {
  e.preventDefault();
  const name = document.getElementById('txtCarVehicleTypeName').value.trim();
  const bienSo = document.getElementById('txtCarVehicleTypeBienSo').value.trim();
  const isTaxi = document.getElementById('chkCarVehicleTypeIsTaxi').checked;
  if (!name) return;
  if (DB.carVehicleTypes.some(t => t.name === name)) return alert('Loại xe đã tồn tại!');
  const nextId = DB.carVehicleTypes.reduce((max, t) => Math.max(max, t.id || 0), 0) + 1;
  DB.carVehicleTypes.push({ id: nextId, name, bienSo: isTaxi ? '' : bienSo, isTaxi });
  syncStorage('carVehicleTypes');
  logSystemAction('USER_MGM', 'ADD_CAR_VEHICLE_TYPE', `Thêm loại xe cụ thể mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtCarVehicleTypeName').value = '';
  document.getElementById('txtCarVehicleTypeBienSo').value = '';
  document.getElementById('chkCarVehicleTypeIsTaxi').checked = false;
  renderCarVehicleTypeList();
  populateDropdowns();
}

function deleteCarVehicleType(id) {
  const t = DB.carVehicleTypes.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`Xóa loại xe "${t.name}"?`)) return;
  DB.carVehicleTypes = DB.carVehicleTypes.filter(x => x.id !== id);
  syncStorage('carVehicleTypes');
  logSystemAction('USER_MGM', 'DELETE_CAR_VEHICLE_TYPE', `Xóa loại xe cụ thể [${t.name}]`, 'SUCCESS', t.name);
  renderCarVehicleTypeList();
  populateDropdowns();
}

function renderCarVehicleTypeList() {
  const ul = document.getElementById('carVehicleTypeList');
  if (!ul) return;
  ul.innerHTML = (DB.carVehicleTypes || []).map(t => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(t.name)} ${t.isTaxi ? '<span class="text-amber-600 font-bold">(Taxi)</span>' : (t.bienSo ? `<span class="text-gray-500">— BKS ${escapeHtml(t.bienSo)}</span>` : '')}</span>
      <button data-op="editCarVehicleType" data-arg0="${t.id}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteCarVehicleType" data-arg0="${t.id}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}

// BUG THẬT đã sửa (rà soát "tất cả các danh mục đều phải sửa được"): trước đây gõ nhầm tên/BKS hoặc
// đánh dấu nhầm cờ Taxi phải xoá hẳn rồi thêm lại (mất id cũ, phiếu Đăng Ký Xe cũ vẫn giữ nguyên tên cũ
// dạng chuỗi hiển thị — KHÔNG bị ảnh hưởng gì vì carRegs.assignedVehicleType lưu tên tại thời điểm chọn,
// không tham chiếu ngược lại theo id). 3 prompt() tuần tự (tên/cờ Taxi/BKS) — khớp UX renameStore()...
// nhưng gộp cả nhóm field object trong 1 lượt sửa thay vì chỉ 1 chuỗi đơn.
async function editCarVehicleType(id) {
  const t = DB.carVehicleTypes.find(x => x.id === id);
  if (!t) return;
  const newName = prompt('Tên loại xe:', t.name);
  if (newName === null) return;
  const trimmedName = newName.trim();
  if (!trimmedName) return alert('⛔ Tên loại xe không được để trống.');
  if (DB.carVehicleTypes.some(x => x.id !== id && x.name === trimmedName)) return alert('⛔ Loại xe này đã tồn tại!');

  const isTaxi = confirm('Đây có phải Xe Taxi không?\n(OK = Có — ẩn ô Biển Số Cố Định; Hủy = Không — hiện ô Biển Số Cố Định)');
  let bienSo = '';
  if (!isTaxi) {
    const bienSoInput = prompt('Biển kiểm soát cố định (để trống nếu không cố định):', t.bienSo || '');
    if (bienSoInput === null) return;
    bienSo = bienSoInput.trim();
  }

  if (trimmedName === t.name && isTaxi === t.isTaxi && bienSo === (t.bienSo || '')) return;
  const snapshot = DB.carVehicleTypes.map(x => ({ ...x }));
  DB.carVehicleTypes = DB.carVehicleTypes.map(x => (x.id === id ? { ...x, name: trimmedName, isTaxi, bienSo } : x));
  const saved = await syncStorage('carVehicleTypes');
  if (!saved) { DB.carVehicleTypes = snapshot; renderCarVehicleTypeList(); return; }
  logSystemAction('USER_MGM', 'EDIT_CAR_VEHICLE_TYPE', `Sửa loại xe cụ thể [${t.name}] → [${trimmedName}]`, 'SUCCESS', trimmedName);
  renderCarVehicleTypeList();
  populateDropdowns();
}

// ===== Danh Mục "Hãng Taxi" (DB.carTaxiCompanies) — danh sách phẳng thuần, mirror DB.stores (không
// cần key ổn định — tên hãng chính là giá trị lưu thẳng vào carRegs.assignedTaxiCompany). =====
function saveCarTaxiCompany(e) {
  e.preventDefault();
  const name = document.getElementById('txtCarTaxiCompanyName').value.trim();
  if (!name) return;
  if (DB.carTaxiCompanies.includes(name)) return alert('Hãng taxi đã tồn tại!');
  DB.carTaxiCompanies.push(name);
  syncStorage('carTaxiCompanies');
  logSystemAction('USER_MGM', 'ADD_CAR_TAXI_COMPANY', `Thêm hãng taxi mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtCarTaxiCompanyName').value = '';
  renderCarTaxiCompanyList();
  populateDropdowns();
}

function deleteCarTaxiCompany(name) {
  if (!confirm(`Xóa hãng taxi "${name}"?`)) return;
  DB.carTaxiCompanies = DB.carTaxiCompanies.filter(x => x !== name);
  syncStorage('carTaxiCompanies');
  logSystemAction('USER_MGM', 'DELETE_CAR_TAXI_COMPANY', `Xóa hãng taxi [${name}]`, 'SUCCESS', name);
  renderCarTaxiCompanyList();
  populateDropdowns();
}

function renderCarTaxiCompanyList() {
  const ul = document.getElementById('carTaxiCompanyList');
  if (!ul) return;
  ul.innerHTML = (DB.carTaxiCompanies || []).map(name => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(name)}</span>
      <button data-op="renameCarTaxiCompany" data-arg0="${escapeHtml(name)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteCarTaxiCompany" data-arg0="${escapeHtml(name)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}
async function renameCarTaxiCompany(name) {
  const ok = await renameCatalogEntryClient('carTaxiCompanies', name, 'Danh Mục Hãng Taxi');
  if (ok) { renderCarTaxiCompanyList(); populateDropdowns(); }
}

function onCarFilterChange() {
  resetListPage('car');
  renderCarRegs();
}

function filterCarByCard(status) {
  applyDashboardCardFilter({ filterStatusCar: status }, 'car', renderCarRegs);
}

function renderCarRegs() {
  const tbody = document.getElementById('carTableBody');
  if (!tbody) return;

  const deptFilter = document.getElementById('filterDeptCar')?.value || '';
  const statusFilter = document.getElementById('filterStatusCar')?.value || '';
  const fromDate = document.getElementById('filterFromDateCar')?.value || '';
  const toDate = document.getElementById('filterToDateCar')?.value || '';
  const keyword = (document.getElementById('filterKeywordCar')?.value || '').trim();

  // CẬP NHẬT: lọc theo phạm vi Xem (carView) thay vì hiển thị đăng ký xe của mọi phòng ban.
  const canViewCar = c => scopeAllows(currentUser, currentUser.perms?.carView, c.dept) ||
    c.creator === currentUser.username ||
    isApproverForDeptWorkflow(DB.carDeptWorkflows[c.dept], currentUser.username);

  const scopedCarRegs = DB.carRegs.filter(canViewCar);
  const carDashCards = [
    { key: '', label: 'Tổng Đăng Ký', count: scopedCarRegs.length, colorClass: 'border-l-blue-500' },
    { key: 'PENDING', label: 'Đang Chờ Duyệt', count: scopedCarRegs.filter(c => c.status === 'PENDING').length, colorClass: 'border-l-yellow-500' },
    { key: 'APPROVED', label: 'Đã Phê Duyệt', count: scopedCarRegs.filter(c => c.status === 'APPROVED').length, colorClass: 'border-l-green-500' },
    { key: 'REJECTED', label: 'Bị Từ Chối', count: scopedCarRegs.filter(c => c.status === 'REJECTED').length, colorClass: 'border-l-red-500' },
    // CANCELLED — trạng thái KẾT THÚC mới (Fix 4, đợt rà soát nghiệp vụ: "Hủy chuyến" sau khi đã duyệt,
    // xem canCancelCarReg()/cancelCarReg() ở lib/recordActions.js).
    { key: 'CANCELLED', label: 'Đã Hủy Chuyến', count: scopedCarRegs.filter(c => c.status === 'CANCELLED').length, colorClass: 'border-l-slate-500' },
    // AWAITING_EVALUATION/COMPLETED — luồng "Kết Thúc Chuyến" (lái xe)/"Đánh Giá" (người đăng ký) MỚI,
    // xem endCarTrip()/evaluateCarTrip() ở lib/recordActions.js.
    { key: 'AWAITING_EVALUATION', label: '⏳ Chờ Đánh Giá', count: scopedCarRegs.filter(c => c.status === 'AWAITING_EVALUATION').length, colorClass: 'border-l-amber-500' },
    { key: 'COMPLETED', label: '✅ Hoàn Thành', count: scopedCarRegs.filter(c => c.status === 'COMPLETED').length, colorClass: 'border-l-emerald-600' }
  ];
  document.getElementById('carDashboardCards').innerHTML = buildDashboardCardsHTML(carDashCards, statusFilter, 'filterCarByCard');

  const visibleCarRegs = DB.carRegs.filter(c => {
    if (!canViewCar(c)) return false;

    if (deptFilter && c.dept !== deptFilter) return false;
    if (statusFilter && c.status !== statusFilter) return false;
    if (!isInDateRange(c.createdAt, fromDate, toDate)) return false;
    if (!matchesKeywordFields([c.code, c.destination, c.creatorName], keyword)) return false;

    return true;
  });

  document.getElementById('paginationContainer_car').innerHTML = buildPaginationBoxHTML('car', 'renderCarRegs');
  const pageCarRegs = paginateList('car', visibleCarRegs, 'renderCarRegs', 'phiếu đăng ký');

  if (pageCarRegs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-gray-500 italic">Không tìm thấy phiếu đăng ký phù hợp.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageCarRegs.map(c => {
    const wfConfig = DB.carDeptWorkflows[c.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
    const wf = DB.workflows.find(w => w.id === wfConfig.workflowId) || { steps: [{ name: 'Sếp duyệt' }] };

    const currentStepApprovers = resolveEffectiveStepApprovers(wfConfig, c.currentStep);
    const canApprove = (c.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, c.history, c.currentStep);

    let statusBadge = '';
    if (c.status === 'APPROVED') statusBadge = `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã phê duyệt</span>`;
    else if (c.status === 'AWAITING_EVALUATION') statusBadge = `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-xs">⏳ Chờ đánh giá (${c.driverReportedKm ?? c.actualKm ?? 0} KM)</span>`;
    else if (c.status === 'COMPLETED') statusBadge = `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-xs">✅ Hoàn thành (${c.actualKm ?? 0} KM)</span>`;
    else if (c.status === 'REJECTED') statusBadge = `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Từ chối</span>`;
    else if (c.status === 'CANCELLED') statusBadge = `<span class="px-2 py-0.5 bg-slate-200 text-slate-700 rounded font-bold text-xs">🚫 Đã hủy chuyến</span>`;
    else if (c.status === 'DRAFT') statusBadge = `<span class="px-2 py-0.5 bg-orange-100 text-orange-800 rounded font-bold text-xs">✏️ Cần bổ sung — chờ sửa lại</span>`;
    else statusBadge = `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-xs">⏳ Bước ${c.currentStep}/${wf.steps.length}${escapeHtml(getStepApprovalProgressText(currentStepApprovers, c.history, c.currentStep))}</span>`;

    // assignedPlate/assignedDriver: do Phòng Hành Chính điền lúc xử lý duyệt (xem processCarReg()).
    // Fallback plate/driver: giữ tương thích bản ghi cũ trước khi tách 2 trường này ra khỏi form đăng ký.
    const displayPlate = c.assignedPlate || c.plate || (c.assignedTaxiCompany ? `Taxi ${c.assignedTaxiCompany}` : '');
    const displayDriver = c.assignedDriver || c.driver || '';
    // canDL/viewSlip: hồ sơ đã qua APPROVED thì luôn xem/tải được phiếu, bất kể đã Kết Thúc Chuyến/Đánh
    // Giá xong hay chưa (AWAITING_EVALUATION/COMPLETED vẫn là "đã phê duyệt", chỉ thêm bước sau đó).
    const isPostApproval = c.status === 'APPROVED' || c.status === 'AWAITING_EVALUATION' || c.status === 'COMPLETED';
    const canDL = isPostApproval && canDownloadFile(currentUser, 'car', c.dept, c.creator);

    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2 font-mono font-bold text-indigo-800">${escapeHtml(c.code)}</td>
        <td class="border p-2">${escapeHtml(c.dept)}<br><span class="text-xs text-gray-500">${escapeHtml(c.creatorName)}</span></td>
        <td class="border p-2">
          <div class="font-bold">${escapeHtml(c.type)} ${displayPlate ? `(${escapeHtml(displayPlate)})` : '<span class="text-gray-400 font-normal">(Chưa xếp)</span>'}</div>
          <div class="text-xs text-gray-500">Lái xe: ${displayDriver ? escapeHtml(displayDriver) : 'Chưa phân công'} | ${c.km} KM</div>
        </td>
        <td class="border p-2 text-xs">${escapeHtml(c.destination)}<br><span class="text-gray-400">${escapeHtml(c.startTime)} ➔ ${escapeHtml(c.endTime)}</span></td>
        <td class="border p-2 text-xs">${escapeHtml(c.purpose || c.reason)}</td>
        <td class="border p-2">${statusBadge}</td>
        <td class="border p-2 text-center space-x-1">
          ${(() => {
            const primaryBtnHTML = canApprove
              ? `<button data-op="runCarAction" data-arg0="${c.id}" data-arg1="process" class="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs hover:opacity-90 font-bold">✍️ Xử lý / Duyệt</button>`
              : `<button data-op="runCarAction" data-arg0="${c.id}" data-arg1="process" class="px-2.5 py-1 bg-gray-600 text-white rounded text-xs hover:opacity-90 font-bold">👁️ Xem chi tiết</button>`;
            const secondaryOptions = [];
            if (isPostApproval) {
              secondaryOptions.push({ value: 'viewSlip', label: '👁️ Xem Phiếu' });
              if (canDL) secondaryOptions.push({ value: 'downloadSlip', label: '⬇️ Tải' });
            }
            if (c.status === 'APPROVED') {
              // Fix 4 (đợt rà soát nghiệp vụ, người dùng xác nhận "Thêm nút Hủy/Đổi sau duyệt") — trước
              // đây 1 phiếu đã APPROVED là ngõ cụt, chỉ admin xóa cứng được. "Đổi Tài Xế-Xe" mở modal xử
              // lý sẵn có (đã có UI phân công) để tái dùng, "Hủy Chuyến" mở thẳng modal xác nhận riêng.
              if (canDispatchCarClient()) secondaryOptions.push({ value: 'reassign', label: '🔁 Đổi Tài Xế-Xe' });
              if (canCancelCarRegClient(c)) secondaryOptions.push({ value: 'cancelTrip', label: '🚫 Hủy Chuyến' });
            }
            // "Đánh Giá" — CHỈ người đăng ký phiếu (creator), bắt buộc để phiếu hoàn thành, xem
            // canEvaluateCarTrip()/evaluateCarTrip() ở lib/recordActions.js.
            if (c.status === 'AWAITING_EVALUATION' && c.creator === currentUser.username) {
              secondaryOptions.push({ value: 'evaluate', label: '⭐ Đánh Giá (bắt buộc)' });
            }
            // "Sửa & Gửi Lại" — chỉ chính người tạo phiếu, chỉ khi đang cần bổ sung (NHÁP do
            // REQUEST_CHANGES, xem confirmProcessCarReg('REQUEST_CHANGES')/openBosungEditModal()).
            if (c.status === 'DRAFT' && c.creator === currentUser.username) {
              secondaryOptions.push({ value: 'editDraft', label: '✏️ Sửa & Gửi Lại' });
            }
            if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
            return buildActionCell(c.id, primaryBtnHTML, secondaryOptions, 'runCarAction');
          })()}
        </td>
      </tr>
    `;
  }).join('');
}

// Hàm điều phối cho khối "Thao Tác" của Đăng ký xe (xem buildActionCell()).
function runCarAction(id, action) {
  switch (action) {
    case 'process': openCarProcessModal(id); break;
    case 'viewSlip': viewCarApprovalSlip(id); break;
    case 'downloadSlip': downloadCarApprovalSlip(id); break;
    case 'editDraft': openBosungEditModal('carRegs', id); break;
    case 'delete': deleteCarRegAction(id); break;
    // Fix 4 — "Hủy chuyến"/"Đổi tài xế-xe" reachable trực tiếp từ dòng danh sách (row bấm "⋮" ->
    // secondaryOptions ở trên), KHÔNG bắt buộc phải mở modal "Xử lý/Duyệt" trước.
    case 'reassign': openCarProcessModal(id); break;
    case 'cancelTrip': openCancelCarRegModal(id); break;
    case 'evaluate': openEvaluateCarTripModal(id); break;
  }
}

// ============ "Đánh Giá" (người đăng ký phiếu) — bắt buộc để phiếu hoàn thành sau khi lái xe Kết
// Thúc Chuyến. Cho phép chỉnh lại số km lái xe đã nhập (driverReportedKm giữ nguyên làm audit trail ở
// lib/recordActions.js, chỉ actualKm bị ghi đè) + nhận xét không bắt buộc — xem evaluateCarTrip(). ============
function openEvaluateCarTripModal(id) {
  const c = DB.carRegs.find(x => x.id === id);
  if (!c) return;
  showConfirmModal({
    title: '⭐ Đánh Giá Chuyến Đăng Ký Xe',
    bodyHTML: `
      <p>Chuyến <b>${escapeHtml(c.code)}</b> — <i>${escapeHtml(c.destination)}</i> đã được lái xe kết thúc.</p>
      <p class="text-xs text-gray-500 mt-1">Số km lái xe báo cáo: <b>${c.driverReportedKm ?? c.actualKm ?? 0} km</b> (${escapeHtml(c.tripEndedAt || '')})</p>
      <div class="mt-3">
        <label class="block text-xs font-semibold text-gray-700 mb-1">Số km thực tế (có thể chỉnh lại nếu cần)</label>
        <input type="number" min="0" step="0.1" id="evalCarKmInput" value="${c.actualKm ?? c.driverReportedKm ?? 0}" class="w-full border p-2 rounded text-sm">
      </div>
      <div class="mt-3">
        <label class="block text-xs font-semibold text-gray-700 mb-1">Nhận xét (không bắt buộc)</label>
        <textarea id="evalCarCommentInput" rows="2" class="w-full border p-2 rounded text-sm" placeholder="Nhận xét về chuyến đi (nếu có)..."></textarea>
      </div>
      <p class="mt-2 text-xs text-red-600 font-semibold">Sau khi Đánh Giá, phiếu này sẽ được tính là Hoàn Thành và không thể chỉnh sửa lại.</p>
    `,
    confirmLabel: 'Xác Nhận Đánh Giá',
    onConfirm: async () => {
      const km = parseFloat(document.getElementById('evalCarKmInput')?.value);
      if (!Number.isFinite(km) || km < 0) return alert('⛔ Số km không hợp lệ, vui lòng thử lại!');
      const comment = (document.getElementById('evalCarCommentInput')?.value || '').trim();
      let result;
      try {
        result = await callRecordAction('carRegs', id, 'evaluate', { km, comment });
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.carRegs.findIndex(x => x.id === id);
      if (idx !== -1) DB.carRegs[idx] = result.item;
      logSystemAction('CAR', 'EVALUATE_TRIP', `Đánh giá chuyến đăng ký xe [${result.item.code}] — ${km}km`, 'SUCCESS', result.item.code);
      alert('✅ Đã đánh giá! Phiếu đăng ký xe đã hoàn thành.');
      renderCarRegs();
    }
  });
}

function deleteCarRegAction(id) {
  const c = DB.carRegs.find(x => x.id === id);
  if (!c) return;
  deleteRecordAdminOnly('carRegs', id, `phiếu đăng ký xe ${c.code}`, () => {
    DB.carRegs = DB.carRegs.filter(x => x.id !== id);
    logSystemAction('CAR', 'DELETE_CAR_REG', `Xóa phiếu đăng ký xe [${c.code} - ${c.destination}]`, 'SUCCESS', c.code);
    renderCarRegs();
  });
}

// Khớp regex resolveAttendeeAccountInput() ở trên — cùng định dạng "Tên — Phòng (tài_khoản)" của
// <datalist id="systemUsersDatalist">. Lái xe bắt buộc là 1 tài khoản hệ thống có thật (gõ tự do không
// khớp -> để trống, submit sẽ bị chặn "Vui lòng chọn lái xe").
function resolveCarAssignedDriverInput(rawValue) {
  const m = rawValue.match(/^(.*) — .*\(([^()]+)\)$/);
  document.getElementById('carAssignedDriverUsername').value = m ? m[2].trim() : '';
}

// Chọn "Loại xe cụ thể" (#carAssignedVehicleType, select, xem DB.carVehicleTypes) -> mục thường
// (isTaxi:false) tự động điền BKS cố định + ẩn ô "Hãng Taxi"; mục Taxi (isTaxi:true) ẩn ô BKS + hiện
// "Hãng Taxi" thay vào. userTriggered=false khi gọi lại lúc mở modal (openCarProcessModal()) — CHỈ để
// đồng bộ đúng ẩn/hiện theo giá trị đã lưu của phiếu, KHÔNG được ghi đè BKS/Hãng Taxi đã có sẵn (khác
// lúc người dùng TỰ TAY đổi lựa chọn, lúc đó auto-fill/xóa field đối lập mới đúng ý).
function onCarAssignedVehicleTypeChange(userTriggered = true) {
  const sel = document.getElementById('carAssignedVehicleType');
  if (!sel) return;
  const selectedType = (DB.carVehicleTypes || []).find(t => t.name === sel.value);
  const isTaxi = !!selectedType?.isTaxi;
  document.getElementById('carAssignedPlateWrap').classList.toggle('hidden', isTaxi);
  document.getElementById('carAssignedTaxiCompanyWrap').classList.toggle('hidden', !isTaxi);
  if (!userTriggered) return;
  if (isTaxi) {
    document.getElementById('carAssignedPlate').value = '';
  } else {
    document.getElementById('carAssignedTaxiCompany').value = '';
    document.getElementById('carAssignedPlate').value = selectedType?.bienSo || '';
  }
}

function openCarProcessModal(carId) {
  currentProcessingCarId = carId;
  const c = DB.carRegs.find(item => item.id === carId);
  if (!c) return;

  const wfConfig = DB.carDeptWorkflows[c.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const wf = DB.workflows.find(w => w.id === wfConfig.workflowId) || { steps: [{ name: 'Sếp duyệt' }] };

  document.getElementById('carModalTitle').innerText = `🚗 Xử Lý Đăng Ký Xe: ${c.code}`;
  document.getElementById('carModalSub').innerText = `Đơn vị: ${c.dept} | Người đăng ký: ${c.creatorName} | Lộ trình: ${c.destination}`;

  const detailsHTML = `
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div><b>Loại xe đăng ký:</b> ${escapeHtml(c.type)}</div>
      <div><b>Số KM dự kiến (2 chiều):</b> ${c.km} km</div>
      <div><b>Số người sử dụng:</b> ${escapeHtml(c.passengers || '')}</div>
      <div><b>Người sử dụng trực tiếp:</b> ${escapeHtml(c.directUser || c.creatorName)} ${c.directUserPhone ? `(SĐT: ${escapeHtml(c.directUserPhone)})` : ''}</div>
      <div><b>Mục đích sử dụng:</b> ${escapeHtml(c.purpose || '')}</div>
      <div><b>Thời gian sử dụng:</b> ${escapeHtml(c.startTime)} ➔ ${escapeHtml(c.endTime)}</div>
      <div class="col-span-2"><b>Nội dung chi tiết:</b> <p class="bg-white p-2 rounded border mt-1">${escapeHtml(c.reason)}</p></div>
    </div>
  `;
  document.getElementById('carModalDetails').innerHTML = detailsHTML;

  populateCarDriversDatalist();
  const assignedDriverUser = c.assignedDriverUsername ? DB.users.find(u => u.username === c.assignedDriverUsername) : null;
  document.getElementById('carAssignedDriver').value = assignedDriverUser
    ? `${assignedDriverUser.name} — ${assignedDriverUser.dept || 'Chưa rõ phòng'} (${assignedDriverUser.username})`
    : '';
  document.getElementById('carAssignedDriverUsername').value = c.assignedDriverUsername || '';
  populateCarAssignedVehicleTypeSelect();
  populateCarTaxiCompanySelect();
  document.getElementById('carAssignedVehicleType').value = c.assignedVehicleType || '';
  document.getElementById('carAssignedPlate').value = c.assignedPlate || c.plate || '';
  document.getElementById('carAssignedTaxiCompany').value = c.assignedTaxiCompany || '';
  document.getElementById('txtCarComment').value = '';
  // false — chỉ đồng bộ ẩn/hiện ô BKS/Hãng Taxi đúng theo giá trị ĐÃ LƯU của phiếu, KHÔNG được tự ý xoá/
  // điền lại BKS hay Hãng Taxi đã có sẵn (khác lúc người dùng TỰ TAY đổi lựa chọn trong lúc modal đang mở
  // — lúc đó auto-fill/xoá field đối lập mới đúng ý, xem onCarAssignedVehicleTypeChange()).
  onCarAssignedVehicleTypeChange(false);

  // "Phần Dành Cho Phòng Hành Chính" (phân công lái xe/loại xe/BKS) chỉ hiện cho "Người Điều Hành Xe"
  // (perms.carDispatch) — người khác trong luồng duyệt vẫn Duyệt/Từ chối bình thường ở nút bên dưới,
  // chỉ không thấy/không sửa được mục phân công này (server cũng tự bỏ qua nếu client bị can thiệp cố
  // gửi kèm các field này, xem applyWorkflowAction() ở lib/workflowEngine.js).
  const canDispatchCar = !!(currentUser.perms?.admin || currentUser.perms?.carDispatch);
  document.getElementById('carDispatchSection').classList.toggle('hidden', !canDispatchCar);

  const historyHTML = (c.history || []).map(h => `
    <div class="bg-white p-2 rounded border text-xs space-y-1">
      <div class="flex justify-between font-bold text-gray-700">
        <span>${escapeHtml(h.approver)} (${escapeHtml(h.username)})</span>
        <span class="text-gray-400 font-normal">${escapeHtml(h.time)}</span>
      </div>
      <div class="text-gray-600">Hành động: <span class="font-bold text-blue-600">${escapeHtml(h.action)}</span> — Bước ${h.step}${h.stepName ? ` (${escapeHtml(h.stepName)})` : ''}</div>
      ${h.assignedDriver || h.assignedPlate || h.assignedTaxiCompany ? `<div class="text-gray-700">🚘 Phân công: ${escapeHtml(h.assignedDriver || '')} ${h.assignedPlate ? `- BKS ${escapeHtml(h.assignedPlate)}` : ''} ${h.assignedTaxiCompany ? `- Hãng Taxi ${escapeHtml(h.assignedTaxiCompany)}` : ''}</div>` : ''}
      ${h.comment ? `<div class="text-gray-800 bg-amber-50 p-1.5 rounded border italic">"${escapeHtml(h.comment)}"</div>` : ''}
    </div>
  `).join('');
  document.getElementById('carModalHistory').innerHTML = historyHTML || '<div class="text-gray-400 italic">Chưa có lịch sử xử lý.</div>';

  const currentStepApprovers = resolveEffectiveStepApprovers(wfConfig, c.currentStep);
  const canApprove = (c.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, c.history, c.currentStep);

  const actionBtns = document.getElementById('carModalActionBtns');
  if (canApprove) {
    const stepActionLabel = resolveStepActionLabel(wf, c.currentStep);
    actionBtns.innerHTML = `
      <button data-op="confirmProcessCarReg" data-arg0="REJECT" class="bg-red-600 text-white px-4 py-1.5 rounded font-bold hover:bg-red-700 text-xs">❌ Từ Chối</button>
      <button data-op="confirmProcessCarReg" data-arg0="REQUEST_CHANGES" class="bg-amber-500 text-white px-4 py-1.5 rounded font-bold hover:bg-amber-600 text-xs">🔄 Bổ Sung</button>
      <button data-op="confirmProcessCarReg" data-arg0="APPROVE" class="bg-green-600 text-white px-5 py-1.5 rounded font-bold hover:bg-green-700 text-xs">✅ ${escapeHtml(stepActionLabel)} & Chuyển Bước</button>
    `;
  } else if (c.status === 'APPROVED' && (canDispatchCar || canCancelCarRegClient(c))) {
    // Fix 4 — phiếu đã APPROVED KHÔNG còn nút Duyệt/Từ chối nào (quy trình đã xong), nhưng vẫn có thể
    // "Đổi Tài Xế-Xe" (canDispatchCar — TÁI DÙNG nguyên carDispatchSection ở trên, không dựng form
    // riêng) và/hoặc "Hủy Chuyến" (chính người tạo HOẶC canDispatchCar, mirror canCancelCarReg() ở
    // server) thay vì chỉ hiện dòng "chỉ có quyền xem" như trước đây.
    const btns = [];
    if (canDispatchCar) btns.push(`<button data-op="confirmCarReassign" class="bg-indigo-600 text-white px-4 py-1.5 rounded font-bold hover:bg-indigo-700 text-xs">🔁 Đổi Tài Xế-Xe</button>`);
    if (canCancelCarRegClient(c)) btns.push(`<button data-op="openCancelCarRegModal" data-arg0="${c.id}" class="bg-red-600 text-white px-4 py-1.5 rounded font-bold hover:bg-red-700 text-xs">🚫 Hủy Chuyến</button>`);
    actionBtns.innerHTML = btns.join(' ');
  } else {
    actionBtns.innerHTML = `<span class="text-gray-500 italic text-xs">Bạn chỉ có quyền xem thông tin đăng ký này.</span>`;
  }

  document.getElementById('carProcessModal').classList.remove('hidden');
}

function closeCarProcessModal() {
  document.getElementById('carProcessModal').classList.add('hidden');
  currentProcessingCarId = null;
}

function confirmProcessCarReg(actionType) {
  const comment = document.getElementById('txtCarComment').value.trim();
  if ((actionType === 'REJECT' || actionType === 'REQUEST_CHANGES') && !comment) {
    return alert(actionType === 'REJECT' ? 'Vui lòng nhập lý do từ chối!' : 'Vui lòng nhập lý do cần bổ sung!');
  }
  const isApprove = actionType === 'APPROVE';
  // Nhãn hành động của APPROVE ăn theo cấu hình riêng của ĐÚNG bước hiện tại (resolveStepActionLabel() —
  // mặc định "Phê Duyệt" nếu bước chưa cấu hình riêng) — REJECT/REQUEST_CHANGES luôn giữ nguyên nhãn cũ.
  const c = DB.carRegs.find(item => item.id === currentProcessingCarId);
  const wfConfig = c ? (DB.carDeptWorkflows[c.dept] || { workflowId: 'WF_1STEP' }) : {};
  const wf = DB.workflows.find(w => w.id === wfConfig.workflowId) || { steps: [] };
  const approveLabel = c ? resolveStepActionLabel(wf, c.currentStep) : 'Phê Duyệt';
  const titleMap = { APPROVE: `✅ Xác Nhận ${approveLabel}`, REJECT: '❌ Xác Nhận Từ Chối', REQUEST_CHANGES: '🔄 Xác Nhận Yêu Cầu Bổ Sung' };
  const labelMap = { APPROVE: approveLabel, REJECT: 'Từ Chối', REQUEST_CHANGES: 'Yêu Cầu Bổ Sung' };
  const actionTextMap = { APPROVE: `${approveLabel.toLowerCase()} và chuyển bước`, REJECT: 'từ chối', REQUEST_CHANGES: 'yêu cầu bổ sung (đưa phiếu về nháp để người đăng ký sửa lại)' };
  showConfirmModal({
    title: titleMap[actionType],
    bodyHTML: `<p>Bạn có chắc chắn muốn <b>${actionTextMap[actionType]}</b> đăng ký xe này?</p>${comment ? `<p class="mt-2 italic text-gray-600">Ý kiến: "${escapeHtml(comment)}"</p>` : ''}`,
    confirmLabel: labelMap[actionType],
    onConfirm: () => {
      if (isApprove) withApprovalAuth(() => processCarReg('APPROVE'));
      else processCarReg(actionType);
    }
  });
}

async function processCarReg(actionType) {
  if (!currentProcessingCarId) return;
  const c = DB.carRegs.find(item => item.id === currentProcessingCarId);
  if (!c) return;

  const comment = document.getElementById('txtCarComment').value.trim();
  if ((actionType === 'REJECT' || actionType === 'REQUEST_CHANGES') && !comment) {
    return alert(actionType === 'REJECT' ? 'Vui lòng nhập lý do từ chối!' : 'Vui lòng nhập lý do cần bổ sung!');
  }

  // Bất kỳ bước nào cũng có thể điền/điều chỉnh thông tin phân công xe (thường do Phòng Hành Chính
  // thực hiện ở bước cuối) — gửi kèm cùng request duyệt/từ chối, ghi nhận ngay khi có nhập. Lái xe bắt
  // buộc là 1 tài khoản hệ thống có thật — nếu ô còn text nhưng chưa khớp được tài khoản (gõ tự do,
  // chưa chọn xong từ gợi ý) thì chặn ngay ở đây, không gửi lên server. KHÔNG áp dụng cho REQUEST_CHANGES
  // (hồ sơ về NHÁP, chưa tới lúc phân công xe).
  // Chỉ "Người Điều Hành Xe" (perms.carDispatch) mới gửi kèm các field phân công này — người khác
  // trong luồng duyệt không thấy mục này (xem toggle ẩn/hiện ở openCarProcessModal()) nên không có gì
  // để gửi; server cũng tự bỏ qua nếu thiếu quyền dù client có bị can thiệp cố gửi kèm.
  const canDispatchCar = !!(currentUser.perms?.admin || currentUser.perms?.carDispatch);
  let extraFields = {};
  if (actionType !== 'REQUEST_CHANGES' && canDispatchCar) {
    const carAssignedDriverText = document.getElementById('carAssignedDriver').value.trim();
    const carAssignedDriverUsername = document.getElementById('carAssignedDriverUsername').value;
    if (carAssignedDriverText && !carAssignedDriverUsername) {
      return alert('Vui lòng chọn đúng lái xe từ danh sách gợi ý (gõ tên hoặc tài khoản để tìm)!');
    }
    extraFields = {
      assignedDriverUsername: carAssignedDriverUsername,
      assignedVehicleType: document.getElementById('carAssignedVehicleType').value.trim(),
      assignedPlate: document.getElementById('carAssignedPlate').value.trim(),
      assignedTaxiCompany: document.getElementById('carAssignedTaxiCompany').value.trim()
    };
  }

  const actionUrlMap = { APPROVE: 'approve', REJECT: 'reject', REQUEST_CHANGES: 'request-changes' };
  let result;
  try {
    result = await callWorkflowAction('carRegs', c.id, actionUrlMap[actionType], { comment, extraFields });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }

  const updatedCar = result.item;
  const transition = result.transition;
  const idx = DB.carRegs.findIndex(item => item.id === c.id);
  if (idx !== -1) DB.carRegs[idx] = updatedCar;

  let msg = '✅ Đã cập nhật trạng thái đăng ký xe!';

  if (transition.type === 'REQUEST_CHANGES') {
    notifyUsersByEmail('CAR', 'NOTIFY_REQUEST_CHANGES', updatedCar.code, [updatedCar.creator],
      `[VPDT] Đăng ký xe ${updatedCar.code} cần bổ sung/chỉnh sửa`,
      `Phiếu đăng ký xe "${updatedCar.destination}" (${updatedCar.code}) của bạn cần được sửa lại. Lý do: ${comment}. Vui lòng vào mục Đăng Ký Xe để sửa và gửi lại.`);
    msg = '✅ Đã yêu cầu bổ sung — hồ sơ đã chuyển về NHÁP để người đăng ký sửa lại!';
  } else if (transition.type === 'REJECTED') {
    notifyUsersByEmail('CAR', 'NOTIFY_REJECTED', updatedCar.code, [updatedCar.creator],
      `[VPDT] Đăng ký xe ${updatedCar.code} bị từ chối`,
      `Phiếu đăng ký xe "${updatedCar.destination}" (${updatedCar.code}) của bạn đã bị từ chối. Lý do: ${comment}`);
  } else if (transition.type === 'ADVANCED') {
    msg = getStepAdvanceMessage(transition.stepApprovers);
    if (transition.nextApprovers.length) {
      notifyUsersByEmail('CAR', 'NOTIFY_APPROVAL_NEEDED', updatedCar.code, transition.nextApprovers,
        `[VPDT] Đăng ký xe ${updatedCar.code} cần bạn phê duyệt`,
        `Phiếu đăng ký xe "${updatedCar.destination}" (${updatedCar.code}) đang chờ bạn phê duyệt ở bước "${transition.nextStepName}".`);
    }
  } else if (transition.type === 'COMPLETED') {
    msg = '✅ Phê duyệt đăng ký xe thành công!';
    notifyUsersByEmail('CAR', 'NOTIFY_APPROVED', updatedCar.code, [updatedCar.creator],
      `[VPDT] Đăng ký xe ${updatedCar.code} đã được phê duyệt`,
      `Phiếu đăng ký xe "${updatedCar.destination}" (${updatedCar.code}) của bạn đã được phê duyệt hoàn tất.`);
  } else if (transition.type === 'PARTIAL_APPROVE') {
    msg = '✅ Đã ghi nhận phê duyệt của bạn — đang chờ các đồng phê duyệt còn lại ở bước này.';
  }

  logSystemAction('CAR', `PROCESS_${actionType}`, `Xử lý đăng ký xe [${updatedCar.code}]: ${actionType}`, 'SUCCESS', updatedCar.code);
  alert(msg);
  closeCarProcessModal();
  renderCarRegs();
  refreshApprovalSurfaces();
}


// ==========================================
// ĐĂNG KÝ XE > "📊 Báo Cáo" — sub-tab MỚI ngay trong module Đăng Ký Xe (chỉ người quản lý, xem
// canSeeCarReportClient() ở core.js), cùng khuôn "📊 Báo Cáo" của Phòng Họp (renderMeetingReportTab(),
// module-phonghop.js) — viết lại 1 bản thanh tỷ lệ ngang RIÊNG (buildCarReportBarHTML()) vì nhóm tải
// module "dangkyxe" KHÔNG có dependency lên nhóm "phonghop" (xem MODULE_LOAD_GROUPS ở core.js).
// ==========================================
function buildCarReportBarHTML(label, value, max, colorClass) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return `
    <div>
      <div class="flex justify-between mb-0.5 text-xs"><span class="font-semibold text-gray-700">${escapeHtml(label)}</span><span class="font-bold text-gray-800">${(value || 0).toLocaleString('vi-VN')}</span></div>
      <div class="w-full bg-gray-100 rounded h-2.5 overflow-hidden"><div class="${colorClass} h-2.5 rounded" data-style="width:${pct}%"></div></div>
    </div>
  `;
}

// ISO-8601 week number — chỉ dùng để NHÓM/HIỂN THỊ nhãn "Tuần N/YYYY" cho biểu đồ xu hướng, không cần
// tuyệt đối chuẩn ISO cho mọi trường hợp biên (đủ ổn định để nhóm nhất quán xuyên suốt 1 năm).
function isoWeekOf(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

// Nhóm theo kỳ (Ngày/Tuần/Tháng/Quý/Năm) từ startTime (thời điểm ĐI thật, không phải lúc tạo phiếu) —
// thay thế groupCarRegsByMonth() cũ (chỉ nhóm theo tháng) — v23.4, yêu cầu người dùng "biểu đồ đăng ký
// xe theo tháng/tuần/quý/năm (lựa chọn filter)". Chỉ nhận danh sách ĐÃ LỌC SẴN theo trạng thái Đã Duyệt.
function groupCarRegsByPeriod(approvedList, granularity) {
  const buckets = {};
  approvedList.forEach(c => {
    const d = new Date(c.startTime);
    if (isNaN(d.getTime())) return;
    let key, label;
    if (granularity === 'DAY') {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      label = `${String(d.getDate()).padStart(2, '0')}/${d.getMonth() + 1}`;
    } else if (granularity === 'WEEK') {
      const { year, week } = isoWeekOf(d);
      key = `${year}-W${String(week).padStart(2, '0')}`;
      label = `Tuần ${week}/${year}`;
    } else if (granularity === 'QUARTER') {
      const q = Math.floor(d.getMonth() / 3) + 1;
      key = `${d.getFullYear()}-Q${q}`;
      label = `Quý ${q}/${d.getFullYear()}`;
    } else if (granularity === 'YEAR') {
      key = `${d.getFullYear()}`;
      label = `Năm ${d.getFullYear()}`;
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      label = `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
    }
    if (!buckets[key]) buckets[key] = { key, label, count: 0, km: 0 };
    buckets[key].count++;
    buckets[key].km += Number(c.km) || 0;
  });
  return Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key));
}
// Giữ tên cũ (mirror gọi từ nơi khác nếu có) — mặc định THÁNG, tương đương hành vi trước v23.4.
function groupCarRegsByMonth(approvedList) { return groupCarRegsByPeriod(approvedList, 'MONTH'); }

// Vẽ SVG cột (số chuyến) + đường (số KM) — hand-rolled, không phụ thuộc thư viện ngoài, cùng tinh thần
// renderNVFlow() (module-nghiepvu.js)/biểu đồ Ngân Sách. Tự co giãn theo số kỳ (buckets.length).
function renderCarReportTrendSVG(buckets) {
  if (!buckets.length) return '<div class="text-xs text-gray-400 italic p-3">Chưa có phiếu nào đã duyệt trong khoảng lọc này.</div>';
  const barW = 46, gapX = 34, marginX = 30, chartH = 150, topPad = 34, bottomPad = 36;
  const totalW = marginX * 2 + buckets.length * (barW + gapX) - gapX;
  const height = topPad + chartH + bottomPad;
  const maxCount = Math.max(1, ...buckets.map(b => b.count));
  const maxKm = Math.max(1, ...buckets.map(b => b.km));
  const xs = buckets.map((_, i) => marginX + i * (barW + gapX));
  const barY = (c) => topPad + chartH - (c / maxCount) * chartH;
  const lineY = (km) => topPad + chartH - (km / maxKm) * chartH;

  let svg = '';
  buckets.forEach((b, i) => {
    const y = barY(b.count), h = topPad + chartH - y;
    svg += `<rect x="${xs[i]}" y="${y}" width="${barW}" height="${h}" rx="4" fill="#6366f1"/>`;
    svg += `<text x="${xs[i] + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="11" font-weight="700" fill="#111827">${b.count}</text>`;
    svg += `<text x="${xs[i] + barW / 2}" y="${topPad + chartH + 16}" text-anchor="middle" font-size="10" fill="#6b7280">${escapeHtml(b.label)}</text>`;
  });
  const linePoints = buckets.map((b, i) => `${xs[i] + barW / 2},${lineY(b.km)}`).join(' ');
  svg += `<polyline points="${linePoints}" fill="none" stroke="#059669" stroke-width="2.5"/>`;
  buckets.forEach((b, i) => {
    const cx = xs[i] + barW / 2, cy = lineY(b.km);
    svg += `<circle cx="${cx}" cy="${cy}" r="3.5" fill="#059669"/>`;
    svg += `<text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="9.5" fill="#059669">${Math.round(b.km * 10) / 10}km</text>`;
  });
  svg += `<rect x="${totalW - 160}" y="0" width="10" height="10" fill="#6366f1"/><text x="${totalW - 146}" y="9" font-size="10" fill="#6b7280">Số chuyến (cột)</text>`;
  svg += `<line x1="${totalW - 160}" y1="22" x2="${totalW - 150}" y2="22" stroke="#059669" stroke-width="2.5"/><text x="${totalW - 146}" y="26" font-size="10" fill="#6b7280">Số KM (đường)</text>`;

  return `<svg viewBox="0 0 ${totalW} ${height}" role="img" aria-label="Biểu đồ xu hướng đăng ký xe" class="car-report-trend-svg">${svg}</svg>`;
}

let carReportGranularity = 'MONTH';
function setCarReportGranularity(g) { carReportGranularity = g; renderCarReportTab(); }

function onCarReportFilterChange() { renderCarReportTab(); }

function renderCarReportTab() {
  const summaryEl = document.getElementById('carReportSummaryCards');
  if (!summaryEl) return;
  const fromDate = document.getElementById('carReportFromDate')?.value || '';
  const toDate = document.getElementById('carReportToDate')?.value || '';

  // Lọc theo ngày ĐI (startTime) — đúng câu hỏi "phòng ban/lái xe nào dùng nhiều trong khoảng này",
  // khác bộ lọc "Từ Khóa/Trạng Thái" ở tab Đăng Ký (lọc Danh Sách theo ngày TẠO phiếu).
  const filtered = DB.carRegs.filter(c => isInDateRange(c.startTime, fromDate, toDate));
  const approved = filtered.filter(c => c.status === 'APPROVED' || c.status === 'AWAITING_EVALUATION' || c.status === 'COMPLETED');
  const pending = filtered.filter(c => c.status === 'PENDING');
  const rejected = filtered.filter(c => c.status === 'REJECTED');
  const totalKm = Math.round(approved.reduce((sum, c) => sum + (Number(c.km) || 0), 0) * 10) / 10;

  summaryEl.innerHTML = [
    { label: 'Tổng Số Phiếu', value: filtered.length, colorClass: 'text-blue-700' },
    { label: 'Đã Duyệt', value: approved.length, colorClass: 'text-green-700' },
    { label: 'Đang Chờ Duyệt', value: pending.length, colorClass: 'text-yellow-700' },
    { label: 'Bị Từ Chối', value: rejected.length, colorClass: 'text-red-700' },
    { label: 'Tổng Số KM (đã duyệt)', value: totalKm, colorClass: 'text-emerald-700' }
  ].map(c => `
    <div class="border rounded-lg p-2 text-center bg-white">
      <div class="text-[11px] text-gray-500 font-semibold">${escapeHtml(c.label)}</div>
      <div class="text-lg font-bold ${c.colorClass}">${c.value.toLocaleString('vi-VN')}</div>
    </div>
  `).join('');

  // Theo Phòng Ban (chỉ phiếu ĐÃ DUYỆT) — sắp giảm dần theo số phiếu.
  const byDeptMap = {};
  approved.forEach(c => { const dept = c.dept || '(Không rõ)'; byDeptMap[dept] = (byDeptMap[dept] || 0) + 1; });
  const byDept = Object.entries(byDeptMap).map(([dept, count]) => ({ dept, count })).sort((a, b) => b.count - a.count);
  const maxDeptCount = Math.max(1, ...byDept.map(d => d.count));
  const deptBarsEl = document.getElementById('carReportDeptBars');
  if (deptBarsEl) {
    deptBarsEl.innerHTML = byDept.length
      ? byDept.map(d => buildCarReportBarHTML(d.dept, d.count, maxDeptCount, 'bg-sky-500')).join('')
      : '<div class="text-xs text-gray-400 italic">Chưa có phiếu nào đã duyệt trong khoảng lọc này.</div>';
  }

  // Theo Lái Xe (chỉ phiếu ĐÃ DUYỆT có phân công lái xe) — duyệt HẾT danh sách lái xe hiện có (kể cả
  // lái xe chưa có chuyến nào trong khoảng lọc) để thấy rõ ai đang KHÔNG được phân công, không chỉ
  // những lái xe có dữ liệu.
  const drivers = DB.users.filter(u => u.active !== false && u.isDriver);
  const byDriver = drivers.map(d => {
    const trips = approved.filter(c => c.assignedDriverUsername === d.username);
    return { name: d.name, count: trips.length, km: Math.round(trips.reduce((s, c) => s + (Number(c.km) || 0), 0) * 10) / 10 };
  }).sort((a, b) => b.count - a.count);
  const maxDriverCount = Math.max(1, ...byDriver.map(d => d.count));
  const driverBarsEl = document.getElementById('carReportDriverBars');
  if (driverBarsEl) {
    driverBarsEl.innerHTML = byDriver.length
      ? byDriver.map(d => buildCarReportBarHTML(`${d.name} (${d.km} km)`, d.count, maxDriverCount, 'bg-emerald-500')).join('')
      : '<div class="text-xs text-gray-400 italic">Chưa có lái xe nào được đánh dấu "Lái xe" trong Quản Lý Người Dùng.</div>';
  }

  // Xu hướng theo kỳ (Ngày/Tuần/Tháng/Quý/Năm, chọn qua carReportGranularity) — phiếu đã duyệt, nhóm
  // theo ngày ĐI (startTime). Pill filter render lại mỗi lần (rẻ, danh sách kỳ cố định 5 mục).
  const granOptions = [['DAY', 'Ngày'], ['WEEK', 'Tuần'], ['MONTH', 'Tháng'], ['QUARTER', 'Quý'], ['YEAR', 'Năm']];
  const pillBarEl = document.getElementById('carReportTrendPills');
  if (pillBarEl) {
    pillBarEl.innerHTML = granOptions.map(([g, label]) => `
      <button type="button" data-op="setCarReportGranularity" data-arg0="${g}" class="px-3 py-1 rounded-full text-[11px] font-bold ${g === carReportGranularity ? 'bg-indigo-700 text-white' : 'bg-indigo-50 text-indigo-700'}">${label}</button>
    `).join('');
  }
  const trendBuckets = groupCarRegsByPeriod(approved, carReportGranularity);
  const trendEl = document.getElementById('carReportTrendChart');
  if (trendEl) trendEl.innerHTML = renderCarReportTrendSVG(trendBuckets);

  // Lịch Sử Đánh Giá Chuyến — người ĐĂNG KÝ xác nhận sau khi lái xe kết thúc (evaluatedBy/evaluatedAt/
  // evaluationComment/actualKm, xem evaluateCarTrip() ở lib/recordActions.js) — dữ liệu đã có sẵn từ
  // trước, CHỈ CHƯA có màn hiển thị (yêu cầu người dùng: "báo cáo ai đánh giá lái xe nào, phiếu nào").
  const evaluated = filtered.filter(c => c.evaluatedAt).sort((a, b) => (b.evaluatedAt || '').localeCompare(a.evaluatedAt || ''));
  const evalBodyEl = document.getElementById('carReportEvalBody');
  if (evalBodyEl) {
    evalBodyEl.innerHTML = evaluated.length ? evaluated.map(c => `
      <tr class="border-t">
        <td class="p-1.5 font-bold">${escapeHtml(c.code)}</td>
        <td class="p-1.5">${escapeHtml(c.assignedDriver || '(chưa gán)')}</td>
        <td class="p-1.5">${escapeHtml(c.evaluatedByName || c.evaluatedBy || '')}</td>
        <td class="p-1.5">${escapeHtml(c.evaluatedAt || '')}</td>
        <td class="p-1.5 text-right">${Number(c.actualKm ?? c.km ?? 0).toLocaleString('vi-VN')} km</td>
        <td class="p-1.5">${c.evaluationComment ? escapeHtml(c.evaluationComment) : '<span class="text-gray-400 italic">Chưa có nhận xét</span>'}</td>
      </tr>
    `).join('') : `<tr><td colspan="6" class="text-center p-3 text-gray-400 italic">Chưa có phiếu nào được đánh giá trong khoảng lọc này.</td></tr>`;
  }

  // Lịch Sử Xác Nhận Của Lái Xe — nhận chuyến (driverConfirmed/driverConfirmedAt) -> kết thúc chuyến
  // (tripEndedAt) -> báo KM (driverReportedKm), xem confirmCarDriverTrip()/endCarTrip() ở module này.
  const confirmed = filtered.filter(c => c.driverConfirmedAt).sort((a, b) => (b.driverConfirmedAt || '').localeCompare(a.driverConfirmedAt || ''));
  const confirmBodyEl = document.getElementById('carReportConfirmBody');
  if (confirmBodyEl) {
    confirmBodyEl.innerHTML = confirmed.length ? confirmed.map(c => `
      <tr class="border-t">
        <td class="p-1.5 font-bold">${escapeHtml(c.code)}</td>
        <td class="p-1.5">${escapeHtml(c.assignedDriver || '(chưa gán)')}</td>
        <td class="p-1.5">${escapeHtml(c.driverConfirmedAt || '')}</td>
        <td class="p-1.5">${c.tripEndedAt ? escapeHtml(c.tripEndedAt) : '<span class="text-blue-600 font-bold">Chưa kết thúc</span>'}</td>
        <td class="p-1.5 text-right">${c.driverReportedKm != null ? Number(c.driverReportedKm).toLocaleString('vi-VN') + ' km' : '—'}</td>
      </tr>
    `).join('') : `<tr><td colspan="5" class="text-center p-3 text-gray-400 italic">Chưa có lái xe nào xác nhận chuyến trong khoảng lọc này.</td></tr>`;
  }
}
