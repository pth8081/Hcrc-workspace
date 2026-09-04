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
    assignedPlate: ''
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
  const newCarApprovers = newCarWfConfig?.approvers?.[1] || [];
  if (newCarApprovers.length) {
    notifyUsersByEmail('CAR', 'NOTIFY_APPROVAL_NEEDED', code, newCarApprovers,
      `[VPDT] Đăng ký xe ${code} cần bạn phê duyệt`,
      `Phiếu đăng ký xe "${destination}" (${code}) do ${currentUser.name} đăng ký đang chờ bạn phê duyệt.`);
  }

  alert('✅ Đã gửi phiếu đăng ký xe thành công!');
  e.target.reset();
  resetCarRoutePoints();
  document.getElementById('carCode').value = generateCarCode();
  renderCarRegs();
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
  activeCarSubTab = subTab;
  document.getElementById('carSubReg').classList.toggle('hidden', subTab !== 'REG');
  document.getElementById('carSubDriver').classList.toggle('hidden', subTab !== 'DRIVER');
  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-indigo-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnCarSubReg').className = subTab === 'REG' ? activeCls : inactiveCls;
  document.getElementById('btnCarSubDriver').className = subTab === 'DRIVER' ? activeCls : inactiveCls;
  if (subTab === 'REG') {
    renderDynamicInputsForModule('CAR', 'dynamicFieldsContainer_CAR');
    renderCarRegs();
    document.getElementById('carCode').value = generateCarCode();
    if (!carRoutePoints.length) resetCarRoutePoints(); else renderCarRoutePoints();
  }
  if (subTab === 'DRIVER') renderCarDriverTab();
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
          ? `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-[11px]">✅ Đã xác nhận lúc ${escapeHtml(c.driverConfirmedAt || '')}</span>`
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
    { key: 'REJECTED', label: 'Bị Từ Chối', count: scopedCarRegs.filter(c => c.status === 'REJECTED').length, colorClass: 'border-l-red-500' }
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

    const currentStepApprovers = wfConfig.approvers ? (wfConfig.approvers[c.currentStep] || []) : [];
    const canApprove = (c.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, c.history, c.currentStep);

    let statusBadge = '';
    if (c.status === 'APPROVED') statusBadge = `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã phê duyệt</span>`;
    else if (c.status === 'REJECTED') statusBadge = `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Từ chối</span>`;
    else if (c.status === 'DRAFT') statusBadge = `<span class="px-2 py-0.5 bg-orange-100 text-orange-800 rounded font-bold text-xs">✏️ Cần bổ sung — chờ sửa lại</span>`;
    else statusBadge = `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-xs">⏳ Bước ${c.currentStep}/${wf.steps.length}${escapeHtml(getStepApprovalProgressText(currentStepApprovers, c.history, c.currentStep))}</span>`;

    // assignedPlate/assignedDriver: do Phòng Hành Chính điền lúc xử lý duyệt (xem processCarReg()).
    // Fallback plate/driver: giữ tương thích bản ghi cũ trước khi tách 2 trường này ra khỏi form đăng ký.
    const displayPlate = c.assignedPlate || c.plate || '';
    const displayDriver = c.assignedDriver || c.driver || '';
    const canDL = c.status === 'APPROVED' && canDownloadFile(currentUser, 'car', c.dept, c.creator);

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
            if (c.status === 'APPROVED') {
              secondaryOptions.push({ value: 'viewSlip', label: '👁️ Xem Phiếu' });
              if (canDL) secondaryOptions.push({ value: 'downloadSlip', label: '⬇️ Tải' });
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
  }
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
  document.getElementById('carAssignedVehicleType').value = c.assignedVehicleType || '';
  document.getElementById('carAssignedPlate').value = c.assignedPlate || c.plate || '';
  document.getElementById('txtCarComment').value = '';

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
      ${h.assignedDriver || h.assignedPlate ? `<div class="text-gray-700">🚘 Phân công: ${escapeHtml(h.assignedDriver || '')} ${h.assignedPlate ? `- BKS ${escapeHtml(h.assignedPlate)}` : ''}</div>` : ''}
      ${h.comment ? `<div class="text-gray-800 bg-amber-50 p-1.5 rounded border italic">"${escapeHtml(h.comment)}"</div>` : ''}
    </div>
  `).join('');
  document.getElementById('carModalHistory').innerHTML = historyHTML || '<div class="text-gray-400 italic">Chưa có lịch sử xử lý.</div>';

  const currentStepApprovers = wfConfig.approvers ? (wfConfig.approvers[c.currentStep] || []) : [];
  const canApprove = (c.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, c.history, c.currentStep);

  const actionBtns = document.getElementById('carModalActionBtns');
  if (canApprove) {
    actionBtns.innerHTML = `
      <button data-op="confirmProcessCarReg" data-arg0="REJECT" class="bg-red-600 text-white px-4 py-1.5 rounded font-bold hover:bg-red-700 text-xs">❌ Từ Chối</button>
      <button data-op="confirmProcessCarReg" data-arg0="REQUEST_CHANGES" class="bg-amber-500 text-white px-4 py-1.5 rounded font-bold hover:bg-amber-600 text-xs">🔄 Bổ Sung</button>
      <button data-op="confirmProcessCarReg" data-arg0="APPROVE" class="bg-green-600 text-white px-5 py-1.5 rounded font-bold hover:bg-green-700 text-xs">✅ Phê Duyệt & Chuyển Bước</button>
    `;
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
  const titleMap = { APPROVE: '✅ Xác Nhận Phê Duyệt', REJECT: '❌ Xác Nhận Từ Chối', REQUEST_CHANGES: '🔄 Xác Nhận Yêu Cầu Bổ Sung' };
  const labelMap = { APPROVE: 'Phê Duyệt', REJECT: 'Từ Chối', REQUEST_CHANGES: 'Yêu Cầu Bổ Sung' };
  const actionTextMap = { APPROVE: 'phê duyệt và chuyển bước', REJECT: 'từ chối', REQUEST_CHANGES: 'yêu cầu bổ sung (đưa phiếu về nháp để người đăng ký sửa lại)' };
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
      assignedPlate: document.getElementById('carAssignedPlate').value.trim()
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

