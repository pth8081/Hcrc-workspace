// ==========================================
// DANH SÁCH NGƯỜI DÙNG MỚI CHỜ LƯU — cho phép admin điền form nhiều lần, mỗi lần bấm "+ Thêm Vào
// Danh Sách" để xếp vào hàng chờ (KHÔNG gọi server), rồi bấm "Lưu Tất Cả Danh Sách" 1 lần duy nhất để
// gửi tất cả lên server cùng lúc — tiện khi cần tạo nhiều tài khoản cùng lúc (vd. nhân viên mới hàng
// loạt) thay vì phải chờ round-trip lưu từng người một.
// ==========================================

// Bọc an toàn TOÀN BỘ việc dựng ô "Vị Trí Kiêm Nhiệm" — wfPositionPairPickerItems()/encodeWfPositionPair()
// (module-admin-specialperm.js, cụm nạp lười "admin-specialperm") bình thường LUÔN sẵn sàng vì
// switchTab('system') nạp cụm này ngay khi vào Hệ Thống (xem MODULE_LOAD_GROUPS.hethong-tabs.deps ở
// core.js), nhưng bọc try/catch quanh CẢ hàm (không chỉ riêng wfPositionPairPickerItems()) để NẾU vì bất
// kỳ lý do gì (trang bị cache cũ/JS lỗi ở module khác cùng cụm...) các hàm này chưa sẵn sàng, admin thấy
// rõ dòng chữ báo lỗi NGAY TRONG ô thay vì 1 ô trống khó hiểu không biết đang lỗi gì — xem phản hồi thực
// tế từ người dùng: ô hiện trống trơn, không chọn được vị trí nào.
function renderSecondaryPositionsWidget(existingPositions) {
  try {
    const items = wfPositionPairPickerItems();
    const initialSelected = (existingPositions || []).map(encodeWfPositionPair);
    renderMultiSelectDropdown('uSecondaryPositionsMultiSelect', items, initialSelected, {
      placeholder: '🔍 Tìm "Chức danh — Phòng ban" để thêm...',
      emptyText: 'Chưa gán Vị Trí Kiêm Nhiệm nào.'
    });
  } catch (err) {
    console.error('renderSecondaryPositionsWidget() lỗi:', err);
    renderMultiSelectDropdown('uSecondaryPositionsMultiSelect', [], [], {
      placeholder: '🔍 Tìm "Chức danh — Phòng ban" để thêm...',
      emptyText: '⛔ Không tải được danh mục vị trí — tải lại trang (F5) rồi thử lại.'
    });
  }
}
function addUserToStagingList() {
  const editId = document.getElementById('editUserId').value;
  if (editId) return alert('⛔ Đang sửa 1 người dùng có sẵn — không thể thêm vào danh sách chờ. Bấm "Hủy" trước nếu muốn tạo người dùng mới.');
  const state = readUserFormState();
  if (!state) return;
  const newUser = buildNewUserFromState(state);
  if (!newUser) return;
  pendingNewUsers.push(newUser);
  // BUG THẬT đã sửa: hàm này KHÔNG hề báo thành công (khác MỌI thao tác lưu khác trong cùng file —
  // saveUser()/deleteUser()/toggleUserActive()/commitPendingNewUsers() đều alert "✅ ..." sau khi xong)
  // — chỉ âm thầm resetUserForm() (XOÁ TRẮNG toàn bộ form admin vừa điền) rồi cuộn xuống 1 bảng nhỏ bên
  // dưới. Từ góc nhìn admin, bấm "+ Thêm Vào Danh Sách" xong thấy form MÌNH VỪA ĐIỀN biến mất trắng
  // trơn mà KHÔNG có bất kỳ xác nhận nào — đúng cảm giác "bấm không ăn thua gì"/"không thêm được vào
  // danh sách" như người dùng phản ánh, dù thực ra ĐÃ thêm thành công vào pendingNewUsers. Thêm 1 alert
  // xác nhận rõ ràng, nêu tên người vừa thêm + tổng số đang chờ, khớp đúng quy ước UX của mọi nút lưu
  // khác trong màn này.
  alert(`✅ Đã thêm "${newUser.username}" vào danh sách chờ lưu (hiện có ${pendingNewUsers.length} người). Điền tiếp người khác hoặc bấm "Lưu Tất Cả Danh Sách" khi xong.`);
  resetUserForm();
  renderPendingNewUsersList();
  document.getElementById('pendingNewUsersSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderPendingNewUsersList() {
  const section = document.getElementById('pendingNewUsersSection');
  const tbody = document.getElementById('pendingNewUsersTableBody');
  const countEl = document.getElementById('pendingNewUsersCount');
  if (!section || !tbody) return;
  section.classList.toggle('hidden', permFormMode !== 'USER' || pendingNewUsers.length === 0);
  if (countEl) countEl.textContent = pendingNewUsers.length;
  tbody.innerHTML = pendingNewUsers.map((u, idx) => {
    const groups = (u.groupIds || []).map(id => DB.permGroups.find(g => g.id === id)).filter(Boolean);
    return `
    <tr class="border-b hover:bg-gray-50">
      <td class="border p-1.5 font-mono">${escapeHtml(u.username)}</td>
      <td class="border p-1.5">${escapeHtml(u.name)}</td>
      <td class="border p-1.5">${escapeHtml(u.dept)}</td>
      <td class="border p-1.5">${groups.length ? groups.map(g => escapeHtml(g.name)).join(', ') : '(quyền riêng)'}</td>
      <td class="border p-1.5 text-center">
        <button type="button" data-op="editPendingNewUser" data-arg0="${idx}" class="text-blue-600 font-bold hover:underline mr-2">Sửa</button>
        <button type="button" data-op="removePendingNewUser" data-arg0="${idx}" class="text-red-600 font-bold hover:underline">Xóa</button>
      </td>
    </tr>`;
  }).join('');
}

function removePendingNewUser(idx) {
  pendingNewUsers.splice(idx, 1);
  renderPendingNewUsersList();
}

// Gỡ 1 người khỏi danh sách chờ và đổ lại thông tin lên form để sửa — bấm "+ Thêm Vào Danh Sách" lại
// để đưa trở lại hàng chờ sau khi sửa xong (giống hệt cách editPermGroup() đổ dữ liệu lên form dùng
// chung populatePermsForm()).
function editPendingNewUser(idx) {
  const u = pendingNewUsers[idx];
  if (!u) return;
  pendingNewUsers.splice(idx, 1);
  renderPendingNewUsersList();

  toggleUserPermFormMode('USER');
  document.getElementById('editUserId').value = '';
  document.getElementById('uUsername').value = u.username;
  document.getElementById('uPassword').value = u.pass;
  document.getElementById('uFullName').value = u.name;
  document.getElementById('uEmail').value = u.email || '';
  document.getElementById('uPhone').value = u.phone || '';
  const inferredPosType = u.posType || (DB.stores.includes(u.dept) ? 'STORE' : 'HO');
  document.getElementById('uPosType').value = inferredPosType;
  onUserPosTypeChange();
  if (inferredPosType === 'STORE') document.getElementById('uStore').value = u.dept;
  else document.getElementById('uDept').value = u.dept;
  document.getElementById('uJobTitle').value = u.jobTitle || '';
  renderSecondaryPositionsWidget(u.secondaryPositions);
  document.getElementById('uIsDriver').checked = !!u.isDriver;
  document.getElementById('uStartDate').value = u.startDate || '';
  renderUPermGroupsChecklist(u.groupIds || []);
  populatePermsForm(u.perms);
  document.getElementById('uPin').value = u.pin || '';
  // Hàng chờ (chưa lưu lên server) chưa có tài khoản thật nào để tra thiết bị vân tay — ẩn khối này
  // (khớp resetUserForm(), đối lập editUser() vốn hiện lại khi sửa user ĐÃ có tài khoản thật).
  document.getElementById('uWebauthnWrap').classList.add('hidden');
  document.getElementById('uWebauthnListWrap').innerHTML = '';
  document.getElementById('uTotpWrap').classList.add('hidden');
  document.getElementById('uTotpStatusWrap').innerHTML = '';
  updatePermGroupNote((u.groupIds || []).length > 0);
  document.getElementById('uUsername').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function commitPendingNewUsers() {
  if (pendingNewUsers.length === 0) return;
  // Kiểm tra lại lần cuối phòng trường hợp có người khác đã tạo trùng username trong lúc mình đang
  // xếp danh sách — server (prepareUsersForSave) vẫn xác minh/hash lại toàn bộ 1 lần nữa khi ghi.
  const dupWithExisting = pendingNewUsers.filter(u => DB.users.some(existing => existing.username === u.username));
  if (dupWithExisting.length) {
    return alert(`⛔ Tên đăng nhập đã tồn tại trong hệ thống: ${dupWithExisting.map(u => u.username).join(', ')} — vui lòng sửa lại trong danh sách trước khi lưu.`);
  }
  if (!confirm(`Lưu ${pendingNewUsers.length} người dùng mới trong danh sách?`)) return;

  // Chờ server xác nhận thật rồi mới báo thành công/xoá danh sách chờ — cùng lỗi đã vá ở saveUser():
  // trước đây gọi syncStorage() KHÔNG await, báo "Đã lưu..." ngay và xoá pendingNewUsers bất kể server
  // có từ chối sau đó (409 xung đột version, hoặc 400 do 1 user trong lô mật khẩu yếu — server từ chối
  // NGUYÊN mảng). Người dùng tưởng đã lưu xong, mất trắng danh sách chờ không phục hồi được.
  const usersSnapshot = JSON.parse(JSON.stringify(DB.users));
  DB.users.push(...pendingNewUsers);
  const saved = await syncStorage('users', { usersBaseline: usersSnapshot });
  if (!saved) {
    DB.users = usersSnapshot;
    return;
  }
  const names = pendingNewUsers.map(u => u.username).join(', ');
  logSystemAction('USER_MGM', 'SAVE_USER_BATCH', `Lưu danh sách ${pendingNewUsers.length} người dùng mới [${names}]`, 'SUCCESS', names);
  alert(`✅ Đã lưu ${pendingNewUsers.length} người dùng mới!`);
  pendingNewUsers = [];
  renderPendingNewUsersList();
  resetUserForm();
  renderUsers();
  renderPermGroupsList();
}

function resetUserForm() {
  setAdminAccountPermsLocked(false);
  document.getElementById('editUserId').value = '';
  document.getElementById('uUsername').value = '';
  document.getElementById('uPassword').value = '';
  document.getElementById('uFullName').value = '';
  document.getElementById('uEmail').value = '';
  document.getElementById('uPhone').value = '';
  document.getElementById('uPosType').value = 'HO';
  onUserPosTypeChange();
  document.getElementById('uJobTitle').value = '';
  renderSecondaryPositionsWidget([]);
  document.getElementById('uIsDriver').checked = false;
  document.getElementById('uStartDate').value = '';
  renderUPermGroupsChecklist([]);
  updatePermGroupNote(false);
  // CẬP NHẬT: mặc định AN TOÀN cho user mới — không bật sẵn quyền xem/tạo liên phòng ban nào ở
  // module nào cả (trước đây hầu hết module nghiệp vụ được bật sẵn = toàn công ty, xem phân tích ở
  // defaultNewUserPerms()). Mỗi người vẫn luôn thao tác được trong phòng ban của chính mình.
  const defaults = defaultNewUserPerms();
  // Render trước 2 khối checkbox tạo động (module con lồng trong mục 0, checkbox phòng ban) rồi mới
  // đổ giá trị mặc định lên — nếu render sau sẽ ghi đè lại checkedByDefault, mất giá trị vừa gán.
  renderDeptCheckboxes();
  renderModuleAccessCheckboxes();
  document.getElementById('pAdmin').checked = defaults.admin;
  document.getElementById('pCanBeApprover').checked = !!defaults.canBeApprover;
  document.getElementById('pApproverAuthLevel').value = defaults.approverAuthLevel || 'NONE';
  document.getElementById('uPin').value = '';
  onApproverAuthLevelChange();
  document.getElementById('uWebauthnWrap').classList.add('hidden');
  document.getElementById('uWebauthnListWrap').innerHTML = '';
  document.getElementById('uTotpWrap').classList.add('hidden');
  document.getElementById('uTotpStatusWrap').innerHTML = '';
  document.getElementById('pCanViewReports').checked = !!defaults.canViewReports;
  document.getElementById('pInternalNewsCreate').checked = !!defaults.internalNewsCreate;
  document.getElementById('pInternalRecruitmentCreate').checked = !!defaults.internalRecruitmentCreate;
  document.getElementById('pTrainingManage').checked = !!defaults.trainingManage;
  document.getElementById('pTrainingInstruct').checked = !!defaults.trainingInstruct;
  document.getElementById('pOnboardingEvaluate').checked = !!defaults.onboardingEvaluate;
  document.getElementById('pInternalPostApprove').checked = !!defaults.internalPostApprove;
  document.getElementById('pContractApprove').checked = !!defaults.contractApprove;
  document.getElementById('pPaymentManage').checked = !!defaults.paymentManage;
  document.getElementById('pVppManage').checked = !!defaults.vppManage;
  document.getElementById('pVppRegisterCreate').checked = !!defaults.vppRegisterCreate;
  document.getElementById('pReportManage').checked = !!defaults.reportManage;
  document.getElementById('pReportAggregate').checked = !!defaults.reportAggregate;
  document.getElementById('pReportEntryCreate').checked = !!defaults.reportEntryCreate;
  document.getElementById('pMeetingApprove').checked = defaults.meetingApprove;
  document.getElementById('pMeetingCancel').checked = defaults.meetingCancel;
  document.getElementById('pCarDispatch').checked = !!defaults.carDispatch;
  document.getElementById('pOfficeBuy').checked = defaults.officeBuy;
  document.getElementById('pOfficeFix').checked = defaults.officeFix;
  document.getElementById('pMinutesCreate').checked = !!defaults.minutesCreate;
  document.getElementById('pMinutesView').checked = !!defaults.minutesView;
  document.getElementById('pMinutesEdit').checked = !!defaults.minutesEdit;
  document.getElementById('pMinutesDownload').checked = !!defaults.minutesDownload;
  document.getElementById('pTaskView').checked = !!defaults.taskView;
  document.getElementById('pTaskEdit').checked = !!defaults.taskEdit;
  document.getElementById('pTaskDelete').checked = !!defaults.taskDelete;
  document.getElementById('pTaskDownload').checked = !!defaults.taskDownload;
  document.getElementById('pItPriceProposeCreate').checked = !!defaults.itPriceProposeCreate;
  document.getElementById('pItManage').checked = !!defaults.itManage;
  document.getElementById('pItPriceEmergencyRejectApprove').checked = !!defaults.itPriceEmergencyRejectApprove;
  document.getElementById('pUniformManage').checked = !!defaults.uniformManage;
  document.getElementById('pUniformApprove').checked = !!defaults.uniformApprove;
  document.getElementById('pUniformStoreManage').checked = !!defaults.uniformStoreManage;
  document.getElementById('pBudgetManage').checked = !!defaults.budgetManage;
  document.getElementById('pBudgetCreate').checked = !!defaults.budgetCreate;
  document.getElementById('pBudgetAggregate').checked = !!defaults.budgetAggregate;
  document.getElementById('pLicenseCreate').checked = !!defaults.licenseCreate;
  document.getElementById('pLicenseApprove').checked = !!defaults.licenseApprove;
  document.getElementById('pLicenseView').checked = !!defaults.licenseView;
  // BUG THẬT đã sửa (phát hiện qua báo lỗi "tạo user mới bị dính quyền lạ"): 11 checkbox Nhân Sự thêm ở
  // các đợt "Nhân Sự Đợt 1-4" (Hồ Sơ/Hợp Đồng/Công & Phép/Onboarding-Offboarding) CHƯA TỪNG được thêm
  // vào đây — trong khi collectPermsFromForm()/populatePermsForm() (module-admin-permtree.js) đã đọc/
  // ghi đủ cả 11 field này từ lâu. Hậu quả: editUser() tick đúng các ô này theo user ĐANG SỬA (đúng),
  // nhưng sau khi "Hủy"/lưu xong quay lại tạo NGƯỜI DÙNG MỚI (resetUserForm()), các ô này VẪN GIỮ
  // NGUYÊN trạng thái tick của lần sửa TRƯỚC ĐÓ (không có dòng nào ở đây đụng tới, khác MỌI checkbox
  // quyền khác trong hàm này) — người dùng MỚI tạo ra ÂM THẦM thừa hưởng quyền Nhân Sự (xem hồ sơ/hợp
  // đồng/lương/chấm công cấp dưới...) của bất kỳ ai admin vừa xem/sửa trước đó trong CÙNG phiên, dù
  // admin không hề tick các ô này cho người mới — đã xác minh lại bằng kịch bản thực tế (sửa 1 user có
  // hrProfileManage/hrContractManage/hrAttendanceManage=true, rồi tạo user mới ngay sau đó KHÔNG đụng
  // tới các ô này -> user mới vẫn được gán permOverrides y hệt 3 quyền đó).
  document.getElementById('pHrOnboardingManage').checked = !!defaults.hrOnboardingManage;
  document.getElementById('pHrOffboardingManage').checked = !!defaults.hrOffboardingManage;
  document.getElementById('pHrTaskTemplateManage').checked = !!defaults.hrTaskTemplateManage;
  document.getElementById('pHrViewAll').checked = !!defaults.hrViewAll;
  document.getElementById('pHrProfileView').checked = !!defaults.hrProfileView;
  document.getElementById('pHrProfileManage').checked = !!defaults.hrProfileManage;
  document.getElementById('pHrContractManage').checked = !!defaults.hrContractManage;
  document.getElementById('pHrAttendanceManage').checked = !!defaults.hrAttendanceManage;
  document.getElementById('pHrLeaveApprove').checked = !!defaults.hrLeaveApprove;
  document.getElementById('pHrShiftRosterManage').checked = !!defaults.hrShiftRosterManage;
  document.getElementById('pHrShiftSwapApprove').checked = !!defaults.hrShiftSwapApprove;
  document.getElementById('pNhanSuManage').checked = !!defaults.nhanSuManage;
  document.getElementById('pOrgChartManage').checked = !!defaults.orgChartManage;
  document.getElementById('pKpiFlowConfigManage').checked = !!defaults.kpiFlowConfigManage;
  document.getElementById('pOperationOrderCreate').checked = !!defaults.operationOrderCreate;
  document.getElementById('pOperationStoreOpenCreate').checked = !!defaults.operationStoreOpenCreate;
  document.getElementById('pOperationRepairCreate').checked = !!defaults.operationRepairCreate;
  document.getElementById('pOperationRecordManageAll').checked = !!defaults.operationRecordManageAll;
  // operationOrderReceiptManage — reset tường minh về rỗng cho user MỚI (cùng lý do 11 checkbox Nhân Sự
  // ở trên: tránh "dính" trạng thái tick còn sót lại từ lần sửa user KHÁC trước đó trong cùng phiên).
  document.getElementById('pOperationOrderReceiptAll').checked = !!defaults.operationOrderReceiptManage?.all;
  toggleOperationOrderReceiptScopeGroup();

  [
    'pUploadAll', 'pViewDraftAll', 'pViewApprovedAll', 'pDocDownloadAll',
    'pSubViewAll', 'pSubCreateAll', 'pSubDownloadAll',
    'pContractViewAll', 'pContractCreateAll', 'pContractDownloadAll',
    'pMeetingViewAll', 'pMeetingBookAll',
    'pCarViewAll', 'pCarCreateAll', 'pCarDownloadAll',
    'pOfficeViewAll', 'pOfficeCreateAll', 'pOfficeDownloadAll'
  ].forEach(id => {
    const cb = document.getElementById(id);
    if (cb) { cb.checked = false; }
  });

  populateModuleAccessForm(defaults.moduleAccess);

  refreshPermTreeBadges();
}

// Tài khoản "admin" mặc định (id=1, xem defaults.js) LUÔN toàn quyền và KHÔNG cho sửa quyền qua form
// — khoá khối cây phân quyền + dropdown Nhóm Phân Quyền (chọn nhóm cũng là 1 cách gián tiếp đổi quyền)
// khi đang sửa đúng tài khoản này. Đây chỉ là lớp UI cho rõ ràng/dễ hiểu — chốt chặn thật sự nằm ở
// server (routes/data.js prepareUsersForSave), nên kể cả bỏ qua lớp này bằng cách nào đó cũng không
// đổi được quyền admin thật sự.
function setAdminAccountPermsLocked(locked) {
  document.getElementById('adminPermsLockedNote')?.classList.toggle('hidden', !locked);
  document.querySelectorAll('#uPermGroupsChecklist input[type=checkbox]').forEach(el => { el.disabled = locked; });
  document.querySelectorAll('#permFieldsContainer input, #permFieldsContainer select').forEach(el => { el.disabled = locked; });
}

function editUser(id) {
  const user = DB.users.find(u => u.id === id);
  if (!user) return;

  editingGroupId = null;
  toggleUserPermFormMode('USER');

  document.getElementById('editUserId').value = user.id;
  document.getElementById('uUsername').value = user.username;
  document.getElementById('uPassword').value = ''; // server không gửi mật khẩu hiện tại về — để trống = giữ nguyên
  document.getElementById('uFullName').value = user.name;
  document.getElementById('uEmail').value = user.email || '';
  document.getElementById('uPhone').value = user.phone || '';
  // User cũ chưa từng có posType (tạo trước khi có tính năng này): suy luận theo DB.stores hiện có —
  // nếu tên dept của họ đã được admin chuyển/thêm vào Danh Mục Siêu Thị thì coi là Siêu Thị, ngược lại
  // mặc định HO. Không cần chạy migrate dữ liệu hàng loạt cho user cũ.
  const inferredPosType = user.posType || (DB.stores.includes(user.dept) ? 'STORE' : 'HO');
  document.getElementById('uPosType').value = inferredPosType;
  onUserPosTypeChange();
  if (inferredPosType === 'STORE') document.getElementById('uStore').value = user.dept;
  else document.getElementById('uDept').value = user.dept;
  document.getElementById('uJobTitle').value = user.jobTitle || '';
  renderSecondaryPositionsWidget(user.secondaryPositions);
  document.getElementById('uIsDriver').checked = !!user.isDriver;
  document.getElementById('uStartDate').value = user.startDate || '';
  // User cũ chưa từng có groupIds (tạo trước khi có tính năng multi-select, chỉ có groupId đơn) — quy
  // đổi tạm sang mảng 1 phần tử để form luôn hiển thị đúng (initDatabase() đã tự động di trú DB.users
  // khi tải dữ liệu, đây chỉ là lớp phòng vệ bổ sung).
  const userGroupIds = user.groupIds || (user.groupId ? [user.groupId] : []);
  renderUPermGroupsChecklist(userGroupIds);

  // Perms của user cũ (nếu chưa từng được di trú vì lý do nào đó) sẽ được quy đổi tạm thời ở đây để
  // form luôn đọc đúng cấu trúc mới — initDatabase() đã tự động lưu lại bản di trú nên trường hợp
  // này thực tế chỉ là lớp phòng vệ bổ sung.
  populatePermsForm(user.perms);
  updatePermGroupNote(userGroupIds.length > 0);
  setAdminAccountPermsLocked(user.username === 'admin');

  // Chỉ hiện khi SỬA user đã tồn tại (có tài khoản thật để tra thiết bị) — resetUserForm()/
  // editPendingNewUser() (tạo mới/sửa hàng chờ) ẩn lại khối này vì chưa có tài khoản nào cả.
  document.getElementById('uWebauthnWrap').classList.remove('hidden');
  renderAdminWebauthnDeviceList(user.username);

  // TOTP chỉ áp dụng cho tài khoản ĐANG có quyền admin (xem lib/totp.js) — khác khối vân tay ở trên,
  // không hiện cho user thường dù cũng là "sửa user đã tồn tại".
  const isTargetAdmin = !!user.perms?.admin;
  document.getElementById('uTotpWrap').classList.toggle('hidden', !isTargetAdmin);
  if (isTargetAdmin) renderAdminTotpStatus(user.username);
  else document.getElementById('uTotpStatusWrap').innerHTML = '';

  // Cuộn tới + chớp sáng khối form — bấm "Sửa" 1 người dùng ở cuối danh sách dài trước đây populate
  // form xong lặng lẽ, không có gì báo cho admin biết thao tác đã có tác dụng nếu form đang ở ngoài
  // màn hình (cùng lý do UX đã áp dụng cho jumpToPermField() ở core.js).
  const formEl = document.getElementById('adminSubPerms');
  if (formEl) {
    formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    formEl.classList.remove('admin-form-jump-highlight');
    void formEl.offsetWidth; // ép reflow để restart animation nếu bấm "Sửa" liên tiếp nhiều người khác nhau
    formEl.classList.add('admin-form-jump-highlight');
  }
}

async function deleteUser(id) {
  const u = DB.users.find(item => item.id === id);
  if (!u) return;
  // Cảnh báo NGAY khi thao tác này sẽ xoá đi tài khoản admin CUỐI CÙNG — trước đây chỉ biết được điều
  // này khi server từ chối (400 "...không còn tài khoản nào có quyền Quản Trị Viên") SAU khi đã bấm xác
  // nhận xoá, thông báo lỗi đó chung chung không nói rõ nguyên nhân là do đây là admin cuối cùng.
  const remainingAdmins = DB.users.filter(x => x.id !== id && x.perms?.admin).length;
  if (u.perms?.admin && remainingAdmins === 0) {
    return alert('⛔ Không thể xoá: đây là tài khoản Quản Trị Viên (Admin) DUY NHẤT còn lại — hệ thống bắt buộc phải còn ít nhất 1 tài khoản Admin. Hãy gán quyền Admin cho 1 tài khoản khác trước khi xoá tài khoản này.');
  }
  if (!confirm(`Bạn có chắc chắn muốn xóa người dùng "${u.username}" (${u.name})?`)) return;
  const usersSnapshot = JSON.parse(JSON.stringify(DB.users));
  DB.users = DB.users.filter(item => item.id !== id);
  const saved = await syncStorage('users', { usersBaseline: usersSnapshot });
  if (!saved) {
    DB.users = usersSnapshot;
    renderUsers();
    return;
  }
  logSystemAction('USER_MGM', 'DELETE_USER', `Xóa người dùng [${u.username}]`, 'SUCCESS', u.username);
  renderUsers();
  renderPermGroupsList();
}

// Vô hiệu hóa / Kích hoạt lại tài khoản — dùng khi nhân viên nghỉ việc: khác Xóa (mất hẳn dữ liệu +
// username có thể bị người khác chiếm lại sau này), vô hiệu hóa GIỮ NGUYÊN toàn bộ lịch sử hồ sơ đã
// tạo/duyệt của người đó, chỉ chặn truy cập hệ thống. Có hiệu lực NGAY LẬP TỨC kể cả phiên đang mở sẵn
// (server tự kiểm tra lại trạng thái active ở MỌI request, xem lib/auth.js requireAuth) — không cần
// đợi họ tự đăng xuất hay JWT hết hạn (tới 8 tiếng).
async function toggleUserActive(id) {
  const u = DB.users.find(item => item.id === id);
  if (!u) return;
  const willActivate = u.active === false;

  if (!willActivate && u.username === currentUser.username) {
    return alert('⛔ Không thể tự vô hiệu hóa chính tài khoản đang đăng nhập!');
  }

  const verb = willActivate ? 'mở khóa' : 'khóa';
  if (!confirm(`Bạn có chắc chắn muốn ${verb} tài khoản "${u.username}" (${u.name})?${willActivate ? '' : '\n\nSau khi khóa, người này sẽ KHÔNG đăng nhập được nữa và mọi phiên đang mở sẵn (nếu có) sẽ bị chặn ngay ở lần thao tác tiếp theo.'}`)) return;

  // Yêu cầu 2: cảnh báo (không chặn cứng) nếu tài khoản sắp khoá đang là NGƯỜI DUYỆT được chỉ định tên
  // ở bước hiện tại của 1+ hồ sơ đang chờ — chặn cứng sẽ khiến admin không khoá được 1 tài khoản nghỉ
  // việc chỉ vì 1 quy trình cấu hình lỏng lẻo, hậu quả tệ hơn cảnh báo bị bỏ qua (xem findPendingApprovalsForUsername()).
  if (!willActivate) {
    const pendingApprovals = findPendingApprovalsForUsername(u.username);
    if (pendingApprovals.length) {
      const lines = pendingApprovals.slice(0, 10).map(p => `• ${p.typeLabel} ${p.code || ''} — ${p.title} (${p.stepLabel})`).join('\n');
      const more = pendingApprovals.length > 10 ? `\n...và ${pendingApprovals.length - 10} hồ sơ khác.` : '';
      if (!confirm(`⚠️ Tài khoản "${u.username}" hiện đang là NGƯỜI DUYỆT của ${pendingApprovals.length} hồ sơ đang chờ xử lý:\n\n${lines}${more}\n\nSau khi khoá, các hồ sơ này sẽ KẸT LẠI (không ai duyệt được đến khi admin đổi người duyệt trong Quy Trình & Phê Duyệt). Vẫn muốn khoá?`)) return;
    }
  }

  // await + kiểm tra saved trước khi ghi log — trước đây gọi syncStorage() không await rồi ghi log
  // 'SUCCESS' ngay lập tức, nên nếu server từ chối lưu (VD xung đột version), Nhật ký hệ thống vẫn ghi
  // nhận đã khoá/mở khóa thành công dù trạng thái tài khoản thực tế KHÔNG đổi — khớp đúng khuôn
  // deleteUser() ở trên (đảo lại DB.users nếu lưu thất bại, chỉ ghi log khi saved === true).
  const prevActive = u.active;
  // usersSnapshot (toàn mảng, không chỉ prevActive) — cần cho cơ chế "refetch + áp lại + thử lưu lại 1
  // lần" khi 409 (xem retryUsersSaveAfterConflict() ở core.js), không chỉ để phục hồi u.active như trước.
  const usersSnapshot = JSON.parse(JSON.stringify(DB.users));
  u.active = willActivate;
  const saved = await syncStorage('users', { usersBaseline: usersSnapshot });
  if (!saved) {
    u.active = prevActive;
    renderUsers();
    return;
  }
  logSystemAction('USER_MGM', willActivate ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
    `${willActivate ? 'Mở khóa' : 'Khóa'} người dùng [${u.username}]`, 'SUCCESS', u.username);
  renderUsers();
}

// Tóm tắt nhanh các module người dùng có thể Xem/Tạo — dùng cho danh sách người dùng ở Module
// Quản trị. Trước đây đếm số field "truthy" trong perms, dễ gây hiểu nhầm vì mảng/đối tượng rỗng
// vẫn được coi là truthy dù không thực sự cấp quyền gì.
function summarizeUserPerms(perms) {
  if (perms.admin) return '<span class="text-purple-700 font-bold">[ADMIN — Toàn quyền hệ thống]</span>';
  const hasScope = (scope) => !!(scope?.all || (scope?.depts || []).length > 0);
  const parts = [];
  if (perms.uploadAll || (perms.uploadDepts || []).length) parts.push('📄 Tài liệu');
  if (hasScope(perms.submissionView) || hasScope(perms.submissionCreate)) parts.push('📜 Tờ trình');
  if (hasScope(perms.contractView) || hasScope(perms.contractCreate)) parts.push('📄 Hợp đồng');
  if (perms.contractApprove) parts.push('📄 Hợp đồng (duyệt)');
  if (perms.paymentManage) parts.push('💰 Thanh toán');
  if (perms.vppManage) parts.push('🖇️ Quản lý VPP');
  if (perms.vppRegisterCreate) parts.push('📝 Người đăng ký VPP');
  if (perms.reportManage || perms.reportAggregate || perms.reportEntryCreate) parts.push('📅 Báo cáo định kỳ');
  if (hasScope(perms.meetingView) || hasScope(perms.meetingBookScope) || perms.meetingApprove || perms.meetingCancel) parts.push('📅 Phòng họp');
  if (hasScope(perms.carView) || hasScope(perms.carCreate)) parts.push('🚗 Xe');
  if (perms.carDispatch) parts.push('🚘 Điều hành xe');
  if ((hasScope(perms.officeView) || hasScope(perms.officeCreate)) && (perms.officeBuy || perms.officeFix)) parts.push('🏢 VP');
  if (perms.minutesCreate) parts.push('📝 Biên bản họp');
  if (perms.canViewReports) parts.push('📊 Báo cáo');
  if (perms.internalNewsCreate || perms.internalRecruitmentCreate) parts.push('📣 Truyền thông (đăng bài)');
  if (perms.internalPostApprove) parts.push('📣 Truyền thông (duyệt Góc chia sẻ)');
  if (perms.trainingManage) parts.push('🎓 Đào Tạo (quản lý toàn bộ)');
  else if (perms.trainingInstruct) parts.push('🎓 Đào Tạo (giảng viên lớp được gán)');
  if (perms.onboardingEvaluate && !perms.trainingManage) parts.push('🆕 Đánh Giá Tân Binh (đơn vị mình)');
  return parts.length ? parts.join(', ') : '<span class="text-gray-400 italic">Chưa cấp quyền module nào</span>';
}

function onUserFilterChange() {
  resetListPage('user');
  renderUsers();
}

function renderUsers() {
  const tbody = document.getElementById('userTableBody');
  if (!tbody) return;

  const keyword = (document.getElementById('filterUserKeyword')?.value || '').toLowerCase().trim();
  const filtered = DB.users.filter(u => {
    if (!keyword) return true;
    return (u.username || '').toLowerCase().includes(keyword)
      || (u.name || '').toLowerCase().includes(keyword)
      || (u.dept || '').toLowerCase().includes(keyword);
  });

  const paginationEl = document.getElementById('paginationContainer_user');
  if (paginationEl) paginationEl.innerHTML = buildPaginationBoxHTML('user', 'renderUsers');
  const pageUsers = paginateList('user', filtered, 'renderUsers', 'người dùng');

  tbody.innerHTML = pageUsers.map(u => {
    const groups = (u.groupIds || []).map(id => DB.permGroups.find(g => g.id === id)).filter(Boolean);
    const hasOverrides = groups.length && u.permOverrides && Object.keys(u.permOverrides).length > 0;
    const isInactive = u.active === false;
    return `
    <tr id="userRow_${u.id}" class="hover:bg-gray-50 border-b${isInactive ? ' bg-gray-50 opacity-60' : ''}">
      <td class="border p-2 font-bold font-mono text-purple-700">
        ${escapeHtml(u.username)}
        ${isInactive ? '<span class="ml-1 inline-block bg-gray-400 text-white text-[10px] font-bold px-1.5 py-0.5 rounded align-middle">🔒 Đã khóa</span>' : ''}
        ${u.mustChangePassword ? '<span class="ml-1 inline-block bg-amber-400 text-white text-[10px] font-bold px-1.5 py-0.5 rounded align-middle">🔑 Chưa đổi mật khẩu tạm</span>' : ''}
      </td>
      <td class="border p-2 font-semibold">${escapeHtml(u.name)}</td>
      <td class="border p-2 text-xs">✉️ ${escapeHtml(u.email || 'N/A')}<br>📞 ${escapeHtml(u.phone || 'N/A')}</td>
      <td class="border p-2">${escapeHtml(u.dept)}</td>
      <td class="border p-2 text-xs">
        ${groups.map(g => `<span class="inline-block bg-purple-100 text-purple-700 font-bold px-1.5 py-0.5 rounded mb-1 mr-1">🗂️ ${escapeHtml(g.name)}</span>`).join('')}
        ${hasOverrides ? `<span class="inline-block bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded mb-1 ml-1">+ tuỳ chỉnh riêng</span>` : ''}
        ${groups.length ? '<br>' : ''}
        ${summarizeUserPerms(u.perms)}
      </td>
      <td class="border p-2 text-center space-x-1">
        <button data-op="editUser" data-arg0="${u.id}" class="text-blue-600 font-bold hover:underline">Sửa</button>
        <button data-op="deleteUser" data-arg0="${u.id}" class="text-red-600 font-bold hover:underline">Xóa</button>
        <button data-op="toggleUserActive" data-arg0="${u.id}" class="${isInactive ? 'text-emerald-600' : 'text-amber-600'} font-bold hover:underline">${isInactive ? 'Mở' : 'Khóa'}</button>
      </td>
    </tr>
  `;
  }).join('');
}

// downloadXlsxFromServer() — CHUYỂN sang public/js/core.js (file luôn nạp EAGER) — xem chú thích ở đó.
// Trước đây định nghĩa Ở ĐÂY (cụm lazy-load "admin-permgroups") khiến module-vanhanh.js/module-dongphuc.js/
// module-hcrcdonghanh.js/module-logsystem-trash.js/module-baocaoquantri(-preview).js phải nạp kéo theo
// TOÀN BỘ cụm "admin-permgroups" (315KB/82KB gzip, kéo theo luôn module Đào Tạo 205KB không liên quan
// qua vòng phụ thuộc SCC) chỉ vì gọi thẳng hàm này không qua ensureFnReady().

function downloadUserTemplate() {
  downloadXlsxFromServer('user_template.xlsx', 'Mẫu Người Dùng',
    [
      { header: 'username', key: 'username', width: 16 },
      { header: 'pass', key: 'pass', width: 14 },
      { header: 'name', key: 'name', width: 22 },
      { header: 'email', key: 'email', width: 24 },
      { header: 'phone', key: 'phone', width: 14 },
      { header: 'dept', key: 'dept', width: 20 }
    ],
    [{ username: 'user1', pass: '123456', name: 'Nguyen Van One', email: 'user1@company.com', phone: '0901234567', dept: 'Phong Nhan Su' }]
  );
}

// KHÔNG export cột mật khẩu — server không còn gửi mật khẩu (dù đã hash) về trình duyệt cho bất kỳ
// ai, kể cả admin, nên không có gì để xuất ra đây nữa (và không nên có, dù là hash).
function exportUsersExcel() {
  const columns = [
    { header: 'username', key: 'username', width: 16 },
    { header: 'name', key: 'name', width: 22 },
    { header: 'email', key: 'email', width: 24 },
    { header: 'phone', key: 'phone', width: 14 },
    { header: 'dept', key: 'dept', width: 20 },
    { header: 'jobTitle', key: 'jobTitle', width: 20 }
  ];
  const rows = DB.users.map(u => ({ username: u.username, name: u.name, email: u.email || '', phone: u.phone || '', dept: u.dept, jobTitle: u.jobTitle || '' }));
  downloadXlsxFromServer('dms_users_export.xlsx', 'Người Dùng', columns, rows);
}

async function importUsersExcel(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  evt.target.value = ''; // cho phép chọn lại đúng cùng 1 file lần sau nếu cần import lại

  const formData = new FormData();
  formData.append('file', file);
  let rows;
  try {
    const res = await fetch('/api/admin/users/import-xlsx', { method: 'POST', body: formData });
    if (res.status === 401) return handleSessionExpired();
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return alert(body.error || 'Không đọc được nội dung file Excel');
    rows = body.rows;
  } catch (e) {
    return alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }

  // Chờ server xác nhận thật rồi mới báo thành công — cùng lỗi đã vá ở commitPendingNewUsers(): route
  // import-xlsx chỉ PARSE file (comment routes/adminExport.js xác nhận không ghi DB), việc ghi thật vẫn
  // đi qua syncStorage('users') như bình thường — trước đây gọi không await, báo "Đã import thành
  // công..." ngay bất kể server sau đó có từ chối (400 do 1 dòng thiếu/sai mật khẩu — từ chối NGUYÊN
  // mảng, hoặc 409 xung đột version).
  const usersSnapshot = JSON.parse(JSON.stringify(DB.users));
  let count = 0;
  // BUG THẬT đã sửa: id trước đây dùng `Date.now() + Math.random()` — ra 1 SỐ THẬP PHÂN (vd
  // 1735000000000.4837), khác hẳn kiểu id nguyên dùng ở MỌI đường tạo user khác trong file này
  // (`Date.now() + pendingNewUsers.length` ở buildNewUserFromState(), số NGUYÊN). Hậu quả: nút Sửa/Khoá/
  // Xoá trên mỗi dòng gọi editUser(id)/deleteUser(id)/toggleUserActive(id) với `id` đọc từ
  // `data-arg0="${user.id}"` qua cspCoerceArg() (core.js) — hàm này CHỈ ép chuỗi có dạng SỐ NGUYÊN
  // (`/^-?\d+$/`) sang kiểu Number, chuỗi có dấu chấm thập phân (id của user import Excel) bị BỎ QUA,
  // giữ nguyên dạng STRING. So sánh `u.id === id` trong editUser()/deleteUser()/toggleUserActive() giữa
  // NUMBER (u.id thật) và STRING (id truyền vào) luôn cho kết quả false (strict equality, không ép kiểu)
  // — cả 3 nút ÂM THẦM không làm gì (không lỗi, không thông báo) cho BẤT KỲ user nào tạo qua import Excel,
  // trong khi user tạo qua form/staging (id nguyên) vẫn hoạt động bình thường — đúng triệu chứng người
  // dùng phản ánh. Đổi sang cùng khuôn số NGUYÊN như mọi nơi khác (`Date.now() + count`, count là thứ tự
  // dòng đã thêm thành công trong đợt import này, bắt đầu từ 0 — cùng cách buildNewUserFromState() dùng
  // `pendingNewUsers.length`).
  rows.forEach(({ username, pass, name, email, phone, dept, jobTitle }) => {
    if (!DB.users.some(u => u.username === username)) {
      DB.users.push({
        id: Date.now() + count,
        username, pass, name, email, phone, dept, jobTitle: jobTitle || null,
        perms: defaultNewUserPerms()
      });
      count++;
    }
  });
  const saved = await syncStorage('users', { usersBaseline: usersSnapshot });
  if (!saved) {
    DB.users = usersSnapshot;
    return;
  }
  alert(`✅ Đã import thành công ${count} người dùng mới!`);
  renderUsers();
}

