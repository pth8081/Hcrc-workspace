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
  if (subTab === 'CALENDAR') {
    renderCarScheduleCalendar();      // vẽ ngay bằng dữ liệu đang có (không để màn trắng khi chờ mạng)
    refreshCarBusySlots(true);        // rồi nạp lại lái xe bận TOÀN CÔNG TY và vẽ lại (LỖI ĐÃ VÁ, rà soát chuyên sâu 2)
  }
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

// LỖI ĐÃ VÁ (rà soát chuyên sâu 2, cụm "Hành Chính", mức Trung bình): TOÀN BỘ lưới "Lịch Xe"
// (computeCarDaySummary()/renderCarScheduleCalendarDayView() bên dưới, cả view Ngày/Tuần/Tháng) trước
// đây đọc THẲNG DB.carRegs — mảng này ĐÃ bị server lọc theo carView (mặc định hẹp theo phòng ban, xem
// lib/recordViewScope.js). Người dùng phạm vi hẹp vì thế thấy lái xe "Trống" giả ở đúng những khung giờ
// phòng ban khác đã đăng ký. carBusySlots = dữ liệu CHIẾM CHỖ toàn công ty lấy từ GET
// /api/records/carRegs/busy-slots (chỉ id/lái xe/giờ/trạng thái, KHÔNG có điểm đến/mã phiếu/phòng ban của
// phiếu phòng ban khác — xem routes/records.js). Mirror ĐÚNG khuôn meetingBusySlots/
// refreshMeetingBusySlots()/getMeetingOccupancyList() (module-phonghop.js) đã vá cho Phòng Họp.
let carBusySlots = [];
let carBusySlotsPromise = null; // lượt nạp ĐANG CHẠY (nếu có) — xem refreshCarBusySlots()

async function refreshCarBusySlots(rerender) {
  if (!carBusySlotsPromise) {
    carBusySlotsPromise = (async () => {
      try {
        carBusySlots = await fetchCarBusySlots();
      } catch (err) {
        console.warn('Không tải được dữ liệu lái xe trống/bận:', err.message);
      } finally {
        carBusySlotsPromise = null;
      }
    })();
  }
  await carBusySlotsPromise;
  if (rerender) renderCarScheduleCalendar();
}

// Danh sách "đang chiếm chỗ" DÙNG CHUNG cho lưới Lịch Xe. Ghép carBusySlots (toàn công ty, không có chi
// tiết) với DB.carRegs (chỉ những phiếu mình được phép xem, có đủ điểm đến/mã phiếu) theo id — phiếu của
// chính phòng mình vẫn hiện đầy đủ chi tiết như trước, phiếu phòng ban khác chỉ hiện "đang bận". Chưa nạp
// được busy-slots thì rơi về đúng DB.carRegs như hành vi cũ.
function getCarOccupancyList() {
  const visibleById = new Map(DB.carRegs.map(c => [c.id, c]));
  if (!carBusySlots.length) return [...visibleById.values()].filter(isCarRegOccupying);
  const merged = [];
  carBusySlots.forEach(s => {
    const local = visibleById.get(s.id);
    // Phiếu vừa bị huỷ/từ chối ngay trong phiên này (DB.carRegs đã cập nhật, busy-slots còn là ảnh cũ)
    // -> nhả chỗ.
    if (local && !isCarRegOccupying(local)) return;
    merged.push(local || s);
  });
  // Phiếu mình vừa tạo/duyệt ở phiên này nhưng busy-slots chưa kịp nạp lại -> vẫn phải tính là đang chiếm
  // chỗ.
  const busyIds = new Set(carBusySlots.map(s => s.id));
  visibleById.forEach((c, id) => { if (!busyIds.has(id) && isCarRegOccupying(c)) merged.push(c); });
  return merged;
}

// Tổng hợp số chuyến (đang chiếm chỗ) theo từng lái xe cho 1 NGÀY cụ thể — dùng chung cho ô ngày ở cả
// chế độ Tuần lẫn Tháng, cùng khuôn computeMeetingDaySummary() (module-phonghop.js).
function computeCarDaySummary(dateStr, drivers) {
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999`);
  const dayTrips = getCarOccupancyList().filter(c => {
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
    const occupancy = getCarOccupancyList();
    slots.forEach(slot => {
      const slotStart = new Date(`${dateStr}T${slot}:00`);
      const slotEnd = new Date(slotStart.getTime() + 30 * 60000);
      html += `<tr><td class="border p-1 text-center text-gray-500 font-mono">${slot}</td>`;
      drivers.forEach(d => {
        // So sánh bằng Date đầy đủ (không chỉ giờ trong ngày) nên chuyến nhiều ngày tự động hiện đỏ ở
        // MỌI ngày nằm trong khoảng startTime-endTime, không chỉ ngày bắt đầu.
        const booking = occupancy.find(c => {
          if (c.assignedDriverUsername !== d.username) return false;
          const cStart = new Date(c.startTime);
          const cEnd = new Date(c.endTime);
          return slotStart < cEnd && cStart < slotEnd;
        });
        if (booking) {
          // booking.destination/code chỉ có với phiếu mình được phép xem — phiếu phòng ban khác (chỉ có
          // khung giờ, xem getCarOccupancyList()) hiện nhãn trung tính, KHÔNG lộ nội dung chuyến của họ.
          const bookingLabel = (booking.destination || booking.code) ? `${booking.destination || booking.code} — bấm để xem` : 'Lái xe đang bận (chuyến của đơn vị khác)';
          html += `<td class="car-cal-cell border p-1 h-6 text-center bg-red-500 hover:bg-red-600 cursor-pointer" data-car-id="${booking.id}" title="${escapeHtml(bookingLabel)}"></td>`;
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
  // Ô đỏ này có thể là phiếu phòng ban KHÁC (chỉ có trong carBusySlots, không có trong DB.carRegs đã lọc
  // theo carView của mình) — không lộ chi tiết, chỉ báo đang bận (mirror handleMeetingSingleSlotClick()
  // ở module-phonghop.js với lịch phòng ban khác).
  if (!c) return alert('🚗 Lái xe đang bận (chuyến của đơn vị khác — bạn không có quyền xem chi tiết).');
  const statusLabel = { PENDING: 'Đang chờ duyệt', APPROVED: 'Đã phê duyệt', IN_PROGRESS: 'LX Đã Xác Nhận Chuyến', DRAFT: 'Cần bổ sung — chờ sửa lại', AWAITING_EVALUATION: 'Chờ đánh giá', COMPLETED: 'Hoàn thành', CANCELLED: 'Đã hủy chuyến', REJECTED: 'Từ chối' }[c.status] || c.status;
  alert(`🚗 ${c.code}\nLái xe: ${c.assignedDriver || ''}\nBiển số: ${c.assignedPlate || '(chưa gán)'}\nĐiểm đến: ${c.destination || ''}\nThời gian: ${c.startTime} ➔ ${c.endTime}\nTrạng thái: ${statusLabel}`);
}

// ============ Lái Xe (tự xác nhận chuyến được phân công) ============
function renderCarDriverTab() {
  const wrap = document.getElementById('carDriverListWrap');
  const noneNote = document.getElementById('carDriverNoneNote');
  if (!wrap) return;
  // APPROVED (chưa xác nhận) + IN_PROGRESS (đã xác nhận, chưa kết thúc chuyến) — cả 2 trạng thái đều
  // cần hiện ở đây để lái xe còn thấy nút "Kết Thúc Chuyến" sau khi đã xác nhận (mục 2, yêu cầu nghiệp
  // vụ 9/2026: xác nhận nhận chuyến giờ chuyển status sang IN_PROGRESS thay vì giữ nguyên APPROVED).
  const myTrips = DB.carRegs.filter(c => c.assignedDriverUsername === currentUser.username && (c.status === 'APPROVED' || c.status === 'IN_PROGRESS'));
  noneNote.classList.toggle('hidden', myTrips.length > 0);
  // PHÁT HIỆN (theo phản hồi người dùng): lái xe trước đây chỉ thấy Mã/Phòng ban/Lộ trình/Thời gian/Xe
  // ở tab này — KHÔNG thấy "Người đặt xe" (người đăng ký chuyến) và không có lối nào mở được "Phiếu Phê
  // Duyệt" đầy đủ (vốn ĐÃ có sẵn — canAccessCarApprovalSlip()/viewCarApprovalSlip() ở core.js đã cho
  // phép ĐÚNG tài xế được gán xem/tải từ lâu, chỉ là nút "👁️ Xem Phiếu"/"⬇️ Tải" trước đây CHỈ nằm ở
  // dropdown "⋮ Khác" của bảng danh sách "🚗 Đăng Ký Xe" chung — tab lái xe thường không tự nghĩ tới mở
  // — nên dù CÓ quyền vẫn không biết/không tới được). Thêm thẳng "Người đặt xe" vào thân thẻ (xem nhanh,
  // không cần mở gì) + nút "👁️ Xem Phiếu" mở đúng Phiếu Phê Duyệt đầy đủ (có Người đăng ký/Người sử dụng
  // trực tiếp + SĐT/Lộ trình di chuyển đầy đủ/Mục đích/Nội dung chi tiết, xem buildCarApprovalSlipHTML()).
  wrap.innerHTML = myTrips.map(c => `
    <div class="bg-white p-3 rounded border space-y-1">
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div class="font-bold text-indigo-800 text-sm">${escapeHtml(c.code)} — ${escapeHtml(c.dept)}</div>
          <div class="text-xs text-gray-600">Người đặt xe: ${escapeHtml(c.creatorName || '')}</div>
          <div class="text-xs text-gray-600">${escapeHtml(c.destination)}</div>
          <div class="text-xs text-gray-500">${escapeHtml(c.startTime)} ➔ ${escapeHtml(c.endTime)} | Xe: ${escapeHtml(c.type)}${c.assignedPlate ? ` (${escapeHtml(c.assignedPlate)})` : ''}</div>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button type="button" data-op="viewCarApprovalSlip" data-arg0="${c.id}" class="bg-gray-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-700">👁️ Xem Phiếu</button>
          ${c.driverConfirmed
            ? `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-[11px]">✅ Đã xác nhận lúc ${escapeHtml(c.driverConfirmedAt || '')}</span>
               <button type="button" data-op="endCarTripAction" data-arg0="${c.id}" class="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-emerald-700">🏁 Kết Thúc Chuyến</button>`
            : `<button type="button" data-op="confirmCarDriverAssignmentAction" data-arg0="${c.id}" class="bg-indigo-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-indigo-700">✅ Xác Nhận Đăng Ký</button>`
          }
        </div>
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
      logSystemAction('CAR', 'END_TRIP', `Kết thúc chuyến đăng ký xe [${result.item.code}] — ${km}km`, 'SUCCESS', result.item.code);
      alert('✅ Đã kết thúc chuyến! Chờ người đăng ký Đánh Giá để phiếu hoàn thành.');
      // Gọi được từ CẢ sub-tab "Lái Xe" (tài xế đội nhà) LẪN dòng danh sách (phiếu Taxi — LỖI ĐÃ VÁ
      // 10/2026, xem runCarAction case 'endTrip') nên vẽ lại cả 2 chỗ, chỗ nào không mở thì tự no-op.
      renderCarDriverTab();
      renderCarRegs();
    }
  });
}

// ============ "Hủy chuyến" / "Đổi tài xế-xe" SAU KHI ĐÃ DUYỆT (Fix 4, đợt rà soát nghiệp vụ) ============
// Mirror ĐÚNG canCancelCarReg() ở lib/recordActions.js — chỉ dùng để ẩn/hiện nút, server LUÔN tự kiểm
// tra lại (không tin riêng lớp UI này). SỬA (theo yêu cầu người dùng 9/2026): bỏ carDispatch (Người
// Điều Hành Xe) khỏi quyền huỷ — chỉ admin/chính người đăng ký, xem chú thích đầy đủ ở canCancelCarReg().
function canCancelCarRegClient(c) {
  if (currentUser?.perms?.admin) return true;
  return !!(c && c.creator === currentUser?.username);
}
function canDispatchCarClient() {
  return !!(currentUser?.perms?.admin || currentUser?.perms?.carDispatch);
}

// Mirror ĐÚNG canChangeCarRegRoute() ở lib/recordActions.js — chỉ dùng để ẩn/hiện nút, server LUÔN tự
// kiểm tra lại. Cùng nhóm quyền với canCancelCarRegClient() (chỉ admin/chính người đăng ký).
function canChangeCarRegRouteClient(c) {
  if (currentUser?.perms?.admin) return true;
  return !!(c && c.creator === currentUser?.username);
}

// Phiếu được phân công đi TAXI (Loại xe cụ thể có cờ isTaxi trong DB.carVehicleTypes) — mirror ĐÚNG
// isTaxiCarReg()/canEndCarTrip() ở lib/recordActions.js (server LUÔN tự kiểm tra lại, 2 hàm này chỉ để
// ẩn/hiện nút). Taxi không có tài khoản lái xe nào nên 2 mốc "Kết Thúc Chuyến"/"Đánh Giá" do người đăng
// ký hoặc Người Điều Hành Xe tự thực hiện (LỖI ĐÃ VÁ 10/2026 — trước đây phiếu taxi kẹt ở APPROVED).
function isTaxiCarRegClient(c) {
  if (!c?.assignedVehicleType) return false;
  return !!(DB.carVehicleTypes || []).find(t => t.name === c.assignedVehicleType)?.isTaxi;
}
function canManageTaxiTripClient(c) {
  return !!(c && (c.creator === currentUser?.username || canDispatchCarClient()));
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

// ===== Danh Mục "Điều gì cần thay đổi?" (DB.carEvaluationIssues) — danh sách phẳng thuần, mirror
// carTaxiCompanies ở trên (đánh giá chuyến, xem openEvaluateCarTripModal()). =====
function saveCarEvaluationIssue(e) {
  e.preventDefault();
  const name = document.getElementById('txtCarEvaluationIssueName').value.trim();
  if (!name) return;
  if (DB.carEvaluationIssues.includes(name)) return alert('Lý do này đã tồn tại!');
  DB.carEvaluationIssues.push(name);
  syncStorage('carEvaluationIssues');
  logSystemAction('USER_MGM', 'ADD_CAR_EVALUATION_ISSUE', `Thêm lý do đánh giá chuyến mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtCarEvaluationIssueName').value = '';
  renderCarEvaluationIssueList();
}

function deleteCarEvaluationIssue(name) {
  if (!confirm(`Xóa lý do "${name}"?`)) return;
  DB.carEvaluationIssues = DB.carEvaluationIssues.filter(x => x !== name);
  syncStorage('carEvaluationIssues');
  logSystemAction('USER_MGM', 'DELETE_CAR_EVALUATION_ISSUE', `Xóa lý do đánh giá chuyến [${name}]`, 'SUCCESS', name);
  renderCarEvaluationIssueList();
}

function renderCarEvaluationIssueList() {
  const ul = document.getElementById('carEvaluationIssueList');
  if (!ul) return;
  ul.innerHTML = (DB.carEvaluationIssues || []).map(name => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(name)}</span>
      <button data-op="renameCarEvaluationIssue" data-arg0="${escapeHtml(name)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deleteCarEvaluationIssue" data-arg0="${escapeHtml(name)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}
async function renameCarEvaluationIssue(name) {
  const ok = await renameCatalogEntryClient('carEvaluationIssues', name, 'Danh Mục Lý Do Đánh Giá Chuyến Xe');
  if (ok) renderCarEvaluationIssueList();
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
    // IN_PROGRESS — trạng thái TRUNG GIAN mới (mục 2, yêu cầu nghiệp vụ 9/2026): lái xe đã xác nhận
    // nhận chuyến nhưng chưa kết thúc, xem confirmCarDriverAssignment()/endCarTrip() ở lib/recordActions.js.
    { key: 'IN_PROGRESS', label: '🚗 LX Đã Xác Nhận Chuyến', count: scopedCarRegs.filter(c => c.status === 'IN_PROGRESS').length, colorClass: 'border-l-indigo-500' },
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
    else if (c.status === 'IN_PROGRESS') statusBadge = `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-xs">🚗 LX Đã Xác Nhận Chuyến</span>`;
    else if (c.status === 'AWAITING_EVALUATION') statusBadge = `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-xs">⏳ Chờ đánh giá (${c.driverReportedKm ?? c.actualKm ?? 0} KM)</span>`;
    else if (c.status === 'COMPLETED') statusBadge = `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-xs">✅ Hoàn thành (${c.actualKm ?? 0} KM)</span>`;
    else if (c.status === 'REJECTED') statusBadge = `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Từ chối</span>`;
    else if (c.status === 'CANCELLED') statusBadge = `<span class="px-2 py-0.5 bg-slate-200 text-slate-700 rounded font-bold text-xs">🚫 Đã hủy chuyến</span>`;
    else if (c.status === 'DRAFT') statusBadge = `<span class="px-2 py-0.5 bg-orange-100 text-orange-800 rounded font-bold text-xs">✏️ Cần bổ sung — chờ sửa lại</span>`;
    else statusBadge = `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-xs">⏳ Bước ${c.currentStep}/${wf.steps.length}${escapeHtml(getStepApprovalProgressText(currentStepApprovers, c.history, c.currentStep))}</span>`;
    // Vừa "Đổi Lộ Trình" (hành động cuối cùng trong lịch sử là ROUTE_CHANGED, chưa ai duyệt lại vòng
    // mới) — thêm nhãn phụ để người duyệt/người đăng ký phân biệt với 1 phiếu PENDING bình thường,
    // tránh nhầm là hồ sơ mới chưa từng đổi gì. Xem changeCarRegRoute() ở lib/recordActions.js.
    if (c.status === 'PENDING' && (c.history || []).length && c.history[c.history.length - 1].action === 'ROUTE_CHANGED') {
      statusBadge += ` <span class="px-2 py-0.5 bg-cyan-100 text-cyan-800 rounded font-bold text-xs">🔄 Vừa đổi lộ trình</span>`;
    }

    // assignedPlate/assignedDriver: do Phòng Hành Chính điền lúc xử lý duyệt (xem processCarReg()).
    // Fallback plate/driver: giữ tương thích bản ghi cũ trước khi tách 2 trường này ra khỏi form đăng ký.
    const displayPlate = c.assignedPlate || c.plate || (c.assignedTaxiCompany ? `Taxi ${c.assignedTaxiCompany}` : '');
    const displayDriver = c.assignedDriver || c.driver || '';
    // canAccessSlip: hồ sơ đã qua APPROVED thì luôn xem/tải được phiếu, bất kể đã Kết Thúc Chuyến/Đánh
    // Giá xong hay chưa (IN_PROGRESS/AWAITING_EVALUATION/COMPLETED vẫn là "đã phê duyệt", chỉ thêm bước
    // sau đó — IN_PROGRESS là trạng thái trung gian mới, mục 2 yêu cầu nghiệp vụ 9/2026). Mục 4 (yêu
    // cầu nghiệp vụ 9/2026): dùng canAccessCarApprovalSlip() (core.js) THAY vì canDownloadFile() dùng
    // chung — chỉ người đăng ký/tài xế được gán/người duyệt/admin mới xem-tải được Phiếu, bỏ fallback
    // "cùng phòng ban" mặc định (riêng carRegs, không đổi canDownloadFile() cho module khác).
    const isPostApproval = c.status === 'APPROVED' || c.status === 'IN_PROGRESS' || c.status === 'AWAITING_EVALUATION' || c.status === 'COMPLETED';
    const canDL = isPostApproval && canAccessCarApprovalSlip(currentUser, c);

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
            if (canDL) {
              // Mục 4: "Xem Phiếu" trước đây không có lớp quyền riêng nào (chỉ cần isPostApproval) —
              // nay gộp chung điều kiện với "Tải" (canDL = canAccessCarApprovalSlip()).
              secondaryOptions.push({ value: 'viewSlip', label: '👁️ Xem Phiếu' });
              secondaryOptions.push({ value: 'downloadSlip', label: '⬇️ Tải' });
            }
            if (c.status === 'APPROVED' || c.status === 'IN_PROGRESS') {
              // Fix 4 (đợt rà soát nghiệp vụ, người dùng xác nhận "Thêm nút Hủy/Đổi sau duyệt") — trước
              // đây 1 phiếu đã APPROVED là ngõ cụt, chỉ admin xóa cứng được. "Đổi Tài Xế-Xe" mở modal xử
              // lý sẵn có (đã có UI phân công) để tái dùng, "Hủy Chuyến" mở thẳng modal xác nhận riêng.
              // IN_PROGRESS (mục 2) vẫn cho đổi/hủy tương tự APPROVED, mirror đúng điều kiện đã nới ở
              // reassignCarDispatch()/cancelCarReg() (lib/recordActions.js).
              if (canDispatchCarClient()) secondaryOptions.push({ value: 'reassign', label: '🔁 Đổi Tài Xế-Xe' });
              if (canCancelCarRegClient(c)) secondaryOptions.push({ value: 'cancelTrip', label: '🚫 Hủy Chuyến' });
            }
            // Mục 1 (yêu cầu nghiệp vụ 9/2026) — người đăng ký rút lại phiếu của chính mình khi CHƯA ai
            // duyệt gì cả (còn ở đúng bước 1), mirror ĐÚNG điều kiện ở openCarProcessModal().
            if (c.status === 'PENDING' && (c.currentStep || 1) <= 1 && canCancelCarRegClient(c)) {
              secondaryOptions.push({ value: 'cancelTrip', label: '🚫 Hủy Đăng Ký' });
            }
            // "Đổi Lộ Trình" (yêu cầu nghiệp vụ 10/2026) — CHÍNH người đăng ký/admin đổi Lộ Trình + Ngày
            // Kết Thúc, áp dụng CẢ TRƯỚC lẫn SAU khi đã duyệt (PENDING bất kỳ bước nào/APPROVED/
            // IN_PROGRESS — khác nút "Hủy Đăng Ký" ngay trên chỉ cho đúng bước 1). Sau khi lưu, hồ sơ tự
            // quay lại bước 1 duyệt lại từ đầu, xem changeCarRegRoute() ở lib/recordActions.js.
            if ((c.status === 'PENDING' || c.status === 'APPROVED' || c.status === 'IN_PROGRESS') && canChangeCarRegRouteClient(c)) {
              secondaryOptions.push({ value: 'changeRoute', label: '🔄 Đổi Lộ Trình' });
            }
            // "Kết Thúc Chuyến" cho phiếu đi TAXI (LỖI ĐÃ VÁ 10/2026): taxi không có tài xế hệ thống
            // nên sub-tab "Lái Xe" (renderCarDriverTab()) không bao giờ hiện phiếu này — trước đây
            // APPROVED là NGÕ CỤT, phiếu taxi không bao giờ hoàn thành được. Người đăng ký/Người Điều
            // Hành Xe tự kết thúc, mirror ĐÚNG canEndCarTrip() ở lib/recordActions.js.
            if (isTaxiCarRegClient(c) && (c.status === 'APPROVED' || c.status === 'IN_PROGRESS')
                && canManageTaxiTripClient(c)) {
              secondaryOptions.push({ value: 'endTrip', label: '🏁 Kết Thúc Chuyến (Taxi)' });
            }
            // "Đánh Giá" — người đăng ký phiếu (creator), bắt buộc để phiếu hoàn thành; riêng phiếu
            // Taxi thêm Người Điều Hành Xe/admin. LỖI ĐÃ VÁ (rà soát chuyên sâu 2, mức Cao): phiếu ĐỘI
            // NHÀ (không phải Taxi) giờ cũng cho admin/Người Điều Hành Xe đánh giá hộ NẾU người đăng ký
            // đã nghỉ việc/khoá tài khoản (creator.active===false) — tránh phiếu kẹt vĩnh viễn ở "Chờ
            // Đánh Giá". Mirror ĐÚNG canEvaluateCarTrip() ở lib/recordActions.js (server LUÔN tự kiểm
            // tra lại, đây chỉ ẩn/hiện nút).
            {
              const creatorInactive = DB.users.find(u => u.username === c.creator)?.active === false;
              const canEvaluateThis = c.creator === currentUser.username
                || (isTaxiCarRegClient(c) && canManageTaxiTripClient(c))
                || (creatorInactive && canDispatchCarClient());
              if (c.status === 'AWAITING_EVALUATION' && canEvaluateThis) {
                secondaryOptions.push({ value: 'evaluate', label: '⭐ Đánh Giá (bắt buộc)' });
              }
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
    case 'endTrip': endCarTripAction(id); break;
    case 'evaluate': openEvaluateCarTripModal(id); break;
    case 'changeRoute': openChangeCarRouteModal(id); break;
  }
}

// ============ "Đổi Lộ Trình" (yêu cầu nghiệp vụ 10/2026) — CHÍNH người đăng ký/admin chủ động đổi Lộ
// Trình (điểm xuất phát/điểm đến/thêm điểm) + Ngày Kết Thúc (+ Ngày/Giờ Xuất Phát NẾU chuyến chưa thực
// hiện — xem canEditStartTime ở openChangeCarRouteModal()) của 1 phiếu, kể cả TRƯỚC hay SAU khi đã phê
// duyệt. Sau khi lưu, hồ sơ tự quay lại bước 1 duyệt lại từ đầu (giống "Bổ Sung"), xem
// changeCarRegRoute() ở lib/recordActions.js. Dùng biến/hàm render RIÊNG (carRouteChangePoints/
// #carRouteChangeWrap) cho lộ trình mới thay vì tái dùng carRoutePoints/#carRoutePointsWrap của form
// Tạo — tránh xung đột trạng thái nếu cả 2 UI vô tình cùng mở. ============
let carRouteChangePoints = ['', ''];

function addCarRouteChangePoint() {
  carRouteChangePoints.push('');
  renderCarRouteChangePoints();
}

function removeCarRouteChangePoint(idx) {
  if (carRouteChangePoints.length <= 2) return; // luôn giữ tối thiểu Điểm xuất phát + 1 điểm đến
  carRouteChangePoints.splice(idx, 1);
  renderCarRouteChangePoints();
}

function updateCarRouteChangePoint(idx, value) {
  carRouteChangePoints[idx] = value;
}

function renderCarRouteChangePoints() {
  const wrap = document.getElementById('carRouteChangeWrap');
  if (!wrap) return;
  wrap.innerHTML = carRouteChangePoints.map((p, idx) => `
    <div class="flex items-center gap-2">
      <span class="text-xs text-gray-500 w-24 shrink-0">${idx === 0 ? 'Điểm xuất phát' : `Điểm ${idx}`}</span>
      <input value="${escapeHtml(p)}" data-op-input="updateCarRouteChangePoint" data-arg0="${idx}" data-arg-value="1" placeholder="${idx === 0 ? 'VD: Hội An' : 'VD: Đà Nẵng'}" class="flex-1 border p-1.5 rounded text-xs">
      ${carRouteChangePoints.length > 2 ? `<button type="button" data-op="removeCarRouteChangePoint" data-arg0="${idx}" class="text-red-500 hover:text-red-700 text-xs font-bold">✕</button>` : ''}
    </div>
  `).join('');
}

function openChangeCarRouteModal(id) {
  const c = DB.carRegs.find(x => x.id === id);
  if (!c) return;
  carRouteChangePoints = (Array.isArray(c.routePoints) && c.routePoints.length >= 2) ? c.routePoints.slice() : ['', ''];
  const willLoseAssignment = c.status === 'APPROVED' || c.status === 'IN_PROGRESS';
  // Ngày/Giờ Xuất Phát chỉ sửa được khi chuyến CHƯA THỰC HIỆN (PENDING/APPROVED — tài xế chưa xác nhận
  // nhận chuyến); IN_PROGRESS nghĩa là đã "đang thực hiện", giữ nguyên (server tự chặn lại nếu client cố
  // gửi giá trị khác — không tin riêng lớp UI này, xem changeCarRegRoute() ở lib/recordActions.js).
  const canEditStartTime = c.status === 'PENDING' || c.status === 'APPROVED';
  showConfirmModal({
    title: '🔄 Đổi Lộ Trình',
    bodyHTML: `
      <p class="text-xs text-gray-500 mb-2">Phiếu <b>${escapeHtml(c.code)}</b> — sau khi lưu, hồ sơ sẽ quay lại <b>bước 1</b> và phải được duyệt lại từ đầu${willLoseAssignment ? ' (phần xe/lái xe đã phân công sẽ bị xoá, Phòng Hành Chính cần phân công lại)' : ''}.</p>
      <div class="mb-2">
        <label class="block text-xs font-semibold text-gray-700 mb-1">Lộ Trình Di Chuyển</label>
        <div id="carRouteChangeWrap" class="space-y-1.5"></div>
        <button type="button" data-op="addCarRouteChangePoint" class="mt-1 text-xs text-indigo-600 hover:underline">+ Thêm điểm</button>
      </div>
      <div class="grid grid-cols-2 gap-3 mb-2">
        <div>
          <label class="block text-xs font-semibold text-gray-700 mb-1">Ngày/Giờ Xuất Phát${canEditStartTime ? '' : ' (đã bắt đầu)'}</label>
          ${canEditStartTime
            ? `<input type="datetime-local" id="ccrStartTime" value="${escapeHtml(c.startTime || '')}" class="w-full border p-2 rounded text-sm">`
            : `<input type="datetime-local" value="${escapeHtml(c.startTime || '')}" class="w-full border p-2 rounded text-sm bg-gray-100 text-gray-500" disabled>`}
        </div>
        <div>
          <label class="block text-xs font-semibold text-gray-700 mb-1">Ngày Kết Thúc mới</label>
          <input type="datetime-local" id="ccrEndTime" value="${escapeHtml(c.endTime || '')}" class="w-full border p-2 rounded text-sm">
        </div>
      </div>
      <div>
        <label class="block text-xs font-semibold text-gray-700 mb-1">Lý do đổi lộ trình (không bắt buộc)</label>
        <input id="ccrComment" class="w-full border p-2 rounded text-sm" placeholder="VD: khách hàng đổi điểm hẹn...">
      </div>
    `,
    confirmLabel: 'Lưu & Gửi Duyệt Lại',
    onConfirm: async () => {
      const routePoints = carRouteChangePoints.map(p => p.trim()).filter(Boolean);
      if (routePoints.length < 2) return alert('⛔ Vui lòng nhập ít nhất Điểm xuất phát và 1 điểm đến!');
      const endTime = document.getElementById('ccrEndTime').value;
      if (!endTime) return alert('⛔ Vui lòng nhập Ngày Kết Thúc mới!');
      const payload = { routePoints, endTime, comment: document.getElementById('ccrComment').value.trim() };
      if (canEditStartTime) {
        const startTime = document.getElementById('ccrStartTime').value;
        if (!startTime) return alert('⛔ Vui lòng nhập Ngày/Giờ Xuất Phát!');
        payload.startTime = startTime;
      }
      let result;
      try {
        result = await callRecordAction('carRegs', id, 'change-route', payload);
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.carRegs.findIndex(x => x.id === id);
      if (idx !== -1) DB.carRegs[idx] = result.item;
      logSystemAction('CAR', 'CHANGE_CAR_ROUTE', `Đổi lộ trình phiếu [${c.code}] — vào lại hàng chờ duyệt từ bước 1`, 'SUCCESS', c.code);
      alert('✅ Đã lưu lộ trình mới — hồ sơ đã vào lại hàng chờ duyệt từ bước 1!');
      renderCarRegs();
      refreshApprovalSurfaces();
    }
  });
  renderCarRouteChangePoints();
}

// ============ "Đánh Giá" (người đăng ký phiếu) — bắt buộc để phiếu hoàn thành sau khi lái xe Kết
// Thúc Chuyến. Cho phép chỉnh lại số km lái xe đã nhập (driverReportedKm giữ nguyên làm audit trail ở
// lib/recordActions.js, chỉ actualKm bị ghi đè) + nhận xét không bắt buộc — xem evaluateCarTrip(). ============
// Mức đánh giá (yêu cầu người dùng 9/2026): 1-5 sao ↔ nhãn cố định. 1-4 sao hiện thêm câu hỏi "Điều gì
// cần thay đổi?" (chọn nhiều từ DB.carEvaluationIssues, danh mục admin tự sửa — xem "🗂️ Quản Lý Danh
// Mục"); 1-2 sao BẮT BUỘC chọn ít nhất 1 lý do, 3-4 sao không bắt buộc, 5 sao ẩn hẳn câu hỏi. Server luôn
// tự validate lại độc lập (evaluateCarTrip() ở lib/recordActions.js) — chặn client bị can thiệp gửi dữ
// liệu sai quy tắc.
const CAR_EVAL_RATING_LABELS = { 1: 'Không hài lòng', 2: 'Chưa hài lòng', 3: 'Đạt yêu cầu', 4: 'Tốt', 5: 'Rất tốt' };
let carEvalSelectedRating = 0;

function carEvalStarHtml() {
  return [1, 2, 3, 4, 5].map(n => `
    <button type="button" data-op="setCarEvalRating" data-arg0="${n}" class="text-3xl leading-none px-0.5 focus:outline-none" data-car-eval-star="${n}">☆</button>
  `).join('');
}

function renderCarEvalStars() {
  document.querySelectorAll('[data-car-eval-star]').forEach(btn => {
    const n = Number(btn.getAttribute('data-car-eval-star'));
    btn.textContent = n <= carEvalSelectedRating ? '★' : '☆';
    btn.classList.toggle('text-amber-500', n <= carEvalSelectedRating);
    btn.classList.toggle('text-gray-300', n > carEvalSelectedRating);
  });
  const labelEl = document.getElementById('carEvalRatingLabel');
  if (labelEl) labelEl.textContent = carEvalSelectedRating ? `${carEvalSelectedRating} sao — ${CAR_EVAL_RATING_LABELS[carEvalSelectedRating]}` : 'Chưa chọn';
  const issuesWrap = document.getElementById('carEvalIssuesWrap');
  if (issuesWrap) issuesWrap.classList.toggle('hidden', !(carEvalSelectedRating >= 1 && carEvalSelectedRating <= 4));
  const requiredHint = document.getElementById('carEvalIssuesRequiredHint');
  if (requiredHint) requiredHint.classList.toggle('hidden', !(carEvalSelectedRating === 1 || carEvalSelectedRating === 2));
}

function setCarEvalRating(n) {
  carEvalSelectedRating = Number(n);
  renderCarEvalStars();
}

function openEvaluateCarTripModal(id) {
  const c = DB.carRegs.find(x => x.id === id);
  if (!c) return;
  carEvalSelectedRating = 0;
  const issuesHtml = (DB.carEvaluationIssues || []).map(issue => `
    <label class="flex items-center gap-1.5 text-xs py-0.5">
      <input type="checkbox" value="${escapeHtml(issue)}" data-car-eval-issue class="rounded">
      <span>${escapeHtml(issue)}</span>
    </label>
  `).join('') || '<p class="text-xs text-gray-400 italic">Chưa có danh mục lý do — liên hệ Quản Trị Viên.</p>';
  showConfirmModal({
    title: '⭐ Đánh Giá Chuyến Đăng Ký Xe',
    bodyHTML: `
      <p>Chuyến <b>${escapeHtml(c.code)}</b> — <i>${escapeHtml(c.destination)}</i> đã được lái xe kết thúc.</p>
      <p class="text-xs text-gray-500 mt-1">Số km lái xe báo cáo: <b>${c.driverReportedKm ?? c.actualKm ?? 0} km</b> (${escapeHtml(c.tripEndedAt || '')})</p>
      <div class="mt-3">
        <label class="block text-xs font-semibold text-gray-700 mb-1">Mức đánh giá chuyến đi <span class="text-red-500">*</span></label>
        <div>${carEvalStarHtml()}</div>
        <p id="carEvalRatingLabel" class="text-xs text-gray-600 font-semibold mt-0.5">Chưa chọn</p>
      </div>
      <div id="carEvalIssuesWrap" class="hidden mt-3 bg-amber-50 border border-amber-200 rounded p-2">
        <label class="block text-xs font-semibold text-gray-700 mb-1">Điều gì cần thay đổi? <span id="carEvalIssuesRequiredHint" class="hidden text-red-500">(bắt buộc chọn ít nhất 1 mục)</span></label>
        ${issuesHtml}
      </div>
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
      if (!carEvalSelectedRating) return alert('⛔ Vui lòng chọn mức đánh giá (sao) trước khi xác nhận!');
      const issues = [...document.querySelectorAll('[data-car-eval-issue]:checked')].map(el => el.value);
      if ((carEvalSelectedRating === 1 || carEvalSelectedRating === 2) && issues.length === 0) {
        return alert('⛔ Đánh giá 1-2 sao bắt buộc chọn ít nhất 1 lý do "Điều gì cần thay đổi?"!');
      }
      const km = parseFloat(document.getElementById('evalCarKmInput')?.value);
      if (!Number.isFinite(km) || km < 0) return alert('⛔ Số km không hợp lệ, vui lòng thử lại!');
      const comment = (document.getElementById('evalCarCommentInput')?.value || '').trim();
      let result;
      try {
        result = await callRecordAction('carRegs', id, 'evaluate', { km, comment, rating: carEvalSelectedRating, issues });
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.carRegs.findIndex(x => x.id === id);
      if (idx !== -1) DB.carRegs[idx] = result.item;
      logSystemAction('CAR', 'EVALUATE_TRIP', `Đánh giá chuyến đăng ký xe [${result.item.code}] — ${carEvalSelectedRating} sao, ${km}km`, 'SUCCESS', result.item.code);
      alert('✅ Đã đánh giá! Phiếu đăng ký xe đã hoàn thành.');
      renderCarRegs();
    }
  });
  renderCarEvalStars();
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
  // Mục 3 (yêu cầu nghiệp vụ 9/2026): xe Taxi không thuộc đội xe công ty -> không còn tài xế công ty
  // đi kèm nữa. Mirror ĐÚNG server (reassignCarDispatch()/applyWorkflowAction() ở lib/recordActions.js
  // và lib/workflowEngine.js) — chỉ là lớp hiển thị, server luôn tự xoá lại field này dù client bị can
  // thiệp cố gửi kèm.
  const driverInput = document.getElementById('carAssignedDriver');
  driverInput.disabled = isTaxi;
  driverInput.placeholder = isTaxi ? '— Không áp dụng (xe taxi) —' : 'Gõ tên hoặc tài khoản tài xế để tìm...';
  document.getElementById('carAssignedDriverWrap').classList.toggle('opacity-50', isTaxi);
  if (!userTriggered) return;
  if (isTaxi) {
    document.getElementById('carAssignedPlate').value = '';
    driverInput.value = '';
    document.getElementById('carAssignedDriverUsername').value = '';
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
  // Mục 1 (yêu cầu nghiệp vụ 9/2026): người đăng ký được rút lại phiếu của CHÍNH MÌNH khi chưa ai duyệt
  // gì cả (còn ở đúng bước 1) — mirror canCancelCarReg() ở server (creator/admin, ĐÃ bỏ carDispatch theo
  // yêu cầu người dùng đợt sau), nhưng GIỚI HẠN thêm điều kiện currentStep<=1 chỉ ở lớp hiển thị này
  // (server là nơi chặn thật).
  const canCancelAtStep1 = c.status === 'PENDING' && (c.currentStep || 1) <= 1 && canCancelCarRegClient(c);

  const actionBtns = document.getElementById('carModalActionBtns');
  if (canApprove) {
    const stepActionLabel = resolveStepActionLabel(wf, c.currentStep);
    const btns = [
      `<button data-op="confirmProcessCarReg" data-arg0="REJECT" class="bg-red-600 text-white px-4 py-1.5 rounded font-bold hover:bg-red-700 text-xs">❌ Từ Chối</button>`,
      `<button data-op="confirmProcessCarReg" data-arg0="REQUEST_CHANGES" class="bg-amber-500 text-white px-4 py-1.5 rounded font-bold hover:bg-amber-600 text-xs">🔄 Bổ Sung</button>`,
      `<button data-op="confirmProcessCarReg" data-arg0="APPROVE" class="bg-green-600 text-white px-5 py-1.5 rounded font-bold hover:bg-green-700 text-xs">✅ ${escapeHtml(stepActionLabel)} & Chuyển Bước</button>`
    ];
    // Người tạo có thể ĐỒNG THỜI là người duyệt bước 1 (đơn vị nhỏ) — vẫn cho rút lại phiếu thay vì
    // phải tự duyệt/từ chối phiếu của chính mình.
    if (canCancelAtStep1) btns.push(`<button data-op="openCancelCarRegModal" data-arg0="${c.id}" class="bg-red-600 text-white px-4 py-1.5 rounded font-bold hover:bg-red-700 text-xs">🚫 Hủy Đăng Ký</button>`);
    actionBtns.innerHTML = btns.join(' ');
  } else if ((c.status === 'APPROVED' || c.status === 'IN_PROGRESS') && (canDispatchCar || canCancelCarRegClient(c))) {
    // Fix 4 — phiếu đã APPROVED/IN_PROGRESS KHÔNG còn nút Duyệt/Từ chối nào (quy trình đã xong), nhưng
    // vẫn có thể "Đổi Tài Xế-Xe" (canDispatchCar — TÁI DÙNG nguyên carDispatchSection ở trên, không dựng
    // form riêng) và/hoặc "Hủy Chuyến" (CHỈ chính người tạo hoặc admin, mirror canCancelCarReg() ở
    // server — ĐÃ bỏ carDispatch theo yêu cầu người dùng đợt sau, Người Điều Hành Xe vẫn đổi được tài
    // xế-xe nhưng không tự huỷ chuyến được nữa) thay vì chỉ hiện dòng "chỉ có quyền xem" như trước đây.
    // IN_PROGRESS (mục 2) mirror đúng điều kiện đã nới ở reassignCarDispatch()/cancelCarReg().
    const btns = [];
    if (canDispatchCar) btns.push(`<button data-op="confirmCarReassign" class="bg-indigo-600 text-white px-4 py-1.5 rounded font-bold hover:bg-indigo-700 text-xs">🔁 Đổi Tài Xế-Xe</button>`);
    if (canCancelCarRegClient(c)) btns.push(`<button data-op="openCancelCarRegModal" data-arg0="${c.id}" class="bg-red-600 text-white px-4 py-1.5 rounded font-bold hover:bg-red-700 text-xs">🚫 Hủy Chuyến</button>`);
    actionBtns.innerHTML = btns.join(' ');
  } else if (canCancelAtStep1) {
    actionBtns.innerHTML = `<button data-op="openCancelCarRegModal" data-arg0="${c.id}" class="bg-red-600 text-white px-4 py-1.5 rounded font-bold hover:bg-red-700 text-xs">🚫 Hủy Đăng Ký</button>`;
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
  // escapeHtml(approveLabel) — actionLabel admin tự gõ, bodyHTML gán qua .innerHTML (showConfirmModal()).
  const actionTextMap = { APPROVE: `${escapeHtml(approveLabel.toLowerCase())} và chuyển bước`, REJECT: 'từ chối', REQUEST_CHANGES: 'yêu cầu bổ sung (đưa phiếu về nháp để người đăng ký sửa lại)' };
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

// LỖI ĐÃ VÁ (rà soát chuyên sâu 10/2026, mức Thấp): mọi con số KM ở tab Báo Cáo trước đây cộng dồn
// `c.km` — số KM DỰ KIẾN người đăng ký TỰ KHAI lúc tạo phiếu, không phải quãng đường thật — trong khi
// bảng "Lịch Sử Đánh Giá Chuyến" ngay bên dưới CÙNG MÀN lại hiện actualKm (số lái xe nhập lúc Kết Thúc
// Chuyến, người đăng ký có thể chỉnh lại lúc Đánh Giá, xem endCarTrip()/evaluateCarTrip() ở
// lib/recordActions.js). 2 khối số liệu cùng 1 màn mâu thuẫn nhau. Ưu tiên KM THỰC TẾ, chỉ rơi về KM dự
// kiến cho chuyến CHƯA kết thúc (chưa có actualKm) để không tụt về 0 giữa kỳ báo cáo.
function carRegReportKm(c) {
  const actual = Number(c?.actualKm);
  if (Number.isFinite(actual) && c.actualKm !== null && c.actualKm !== '') return actual;
  return Number(c?.km) || 0;
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
    buckets[key].km += carRegReportKm(c);
  });
  return Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key));
}
// Giữ tên cũ (mirror gọi từ nơi khác nếu có) — mặc định THÁNG, tương đương hành vi trước v23.4.
function groupCarRegsByMonth(approvedList) { return groupCarRegsByPeriod(approvedList, 'MONTH'); }

// Bảng số liệu Xu Hướng Theo Thời Gian (Số Chuyến & Số KM) — TRƯỚC ĐÂY là biểu đồ SVG cột+đường
// (renderCarReportTrendSVG(), hand-rolled), nhưng biểu đồ bị vỡ hình (chữ/cột chồng lấn, phóng to bất
// thường) trên máy người dùng thực tế — theo phản hồi người dùng (đợt 9/2026: "chỉ chỏ thông tin số km
// thay vì biểu đồ để cho nó gọn lại"), thay hẳn bằng bảng số liệu thuần văn bản, gọn và không phụ thuộc
// việc render SVG co giãn theo số kỳ (nguồn gốc lỗi vỡ hình).
function renderCarReportTrendStats(buckets) {
  if (!buckets.length) return '<div class="text-xs text-gray-400 italic p-3">Chưa có phiếu nào đã duyệt trong khoảng lọc này.</div>';
  const rows = buckets.map(b => `
    <tr class="border-b last:border-0">
      <td class="py-1.5 pr-3 text-gray-700">${escapeHtml(b.label)}</td>
      <td class="py-1.5 pr-3 text-right font-bold text-indigo-700">${b.count.toLocaleString('vi-VN')}</td>
      <td class="py-1.5 text-right font-bold text-emerald-700">${(Math.round(b.km * 10) / 10).toLocaleString('vi-VN')} km</td>
    </tr>
  `).join('');
  return `
    <table class="w-full text-xs">
      <thead>
        <tr class="border-b-2 border-gray-200 text-gray-500 font-semibold">
          <th class="py-1.5 pr-3 text-left">Kỳ</th>
          <th class="py-1.5 pr-3 text-right">Số Chuyến</th>
          <th class="py-1.5 text-right">Số KM</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
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
  const approved = filtered.filter(c => c.status === 'APPROVED' || c.status === 'IN_PROGRESS' || c.status === 'AWAITING_EVALUATION' || c.status === 'COMPLETED');
  const pending = filtered.filter(c => c.status === 'PENDING');
  const rejected = filtered.filter(c => c.status === 'REJECTED');
  const totalKm = Math.round(approved.reduce((sum, c) => sum + carRegReportKm(c), 0) * 10) / 10;

  // Chú thích phạm vi (LỖI ĐÃ VÁ 10/2026, mức Thấp): DB.carRegs đã được server lọc theo phạm vi xem của
  // chính người đang đăng nhập (filterCarRegsForUser()/canViewCarReg(), lib/recordViewScope.js) — người
  // chỉ duyệt/xem 1 vài phòng ban thấy số liệu THIẾU so với toàn công ty nhưng màn hình trước đây trình
  // bày y như số liệu tổng, không có dấu hiệu nào. Nêu rõ thay vì để hiểu nhầm.
  const seesAllCarRegs = !!(currentUser?.perms?.admin || currentUser?.perms?.carView?.all);
  const scopeNoteEl = document.getElementById('carReportScopeNote');
  if (scopeNoteEl) {
    scopeNoteEl.classList.toggle('hidden', seesAllCarRegs);
    if (!seesAllCarRegs) {
      const scopeDepts = (currentUser?.perms?.carView?.depts || []).join(', ');
      scopeNoteEl.textContent = 'ℹ️ Số liệu dưới đây tính theo PHẠM VI XEM của bạn'
        + (scopeDepts ? ` (${scopeDepts})` : '')
        + ', không phải toàn công ty — các phiếu ngoài phạm vi không được tính.';
    }
  }

  summaryEl.innerHTML = [
    { label: 'Tổng Số Phiếu', value: filtered.length, colorClass: 'text-blue-700' },
    { label: 'Đã Duyệt', value: approved.length, colorClass: 'text-green-700' },
    { label: 'Đang Chờ Duyệt', value: pending.length, colorClass: 'text-yellow-700' },
    { label: 'Bị Từ Chối', value: rejected.length, colorClass: 'text-red-700' },
    { label: 'Tổng Số KM (thực tế, đã duyệt)', value: totalKm, colorClass: 'text-emerald-700' }
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
    return { name: d.name, count: trips.length, km: Math.round(trips.reduce((s, c) => s + carRegReportKm(c), 0) * 10) / 10 };
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
  if (trendEl) trendEl.innerHTML = renderCarReportTrendStats(trendBuckets);

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
        <td class="p-1.5 whitespace-nowrap">${c.evaluationRating ? `<span class="text-amber-500">${'★'.repeat(c.evaluationRating)}${'☆'.repeat(5 - c.evaluationRating)}</span> <span class="text-gray-500">(${escapeHtml(CAR_EVAL_RATING_LABELS[c.evaluationRating] || '')})</span>` : '<span class="text-gray-400 italic">—</span>'}</td>
        <td class="p-1.5">${(c.evaluationIssues || []).length ? escapeHtml(c.evaluationIssues.join(', ')) : '<span class="text-gray-400 italic">—</span>'}</td>
        <td class="p-1.5">${c.evaluationComment ? escapeHtml(c.evaluationComment) : '<span class="text-gray-400 italic">Chưa có nhận xét</span>'}</td>
      </tr>
    `).join('') : `<tr><td colspan="8" class="text-center p-3 text-gray-400 italic">Chưa có phiếu nào được đánh giá trong khoảng lọc này.</td></tr>`;
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
