// ==========================================
// NHÓM PHÊ DUYỆT TRÌNH (Văn bản trình) — 3 nhóm CỐ ĐỊNH (SUBMISSION_APPROVAL_LAYERS), admin chỉ gán
// thành viên, không tạo/xoá nhóm mới. Người trình tick chọn nhóm nào khi tạo tờ trình thì nhóm đó
// được cộng thêm làm 1 bước phê duyệt bổ sung ở cuối quy trình phòng ban (xem
// buildEffectiveSubmissionWorkflow()).
// ==========================================
function renderSubmissionApprovalGroups() {
  const container = document.getElementById('submissionApprovalGroupsContainer');
  if (!container) return;

  container.innerHTML = SUBMISSION_APPROVAL_LAYERS.map(layer => `
    <div class="bg-slate-50 p-3 rounded border space-y-2">
      <div class="font-bold text-gray-800 text-xs">${escapeHtml(layer.label)}</div>
      <div id="submissionApprovalGroupPicker_${layer.key}"></div>
      <button type="button" data-op="saveSubmissionApprovalGroup" data-arg0="${layer.key}" class="w-full bg-rose-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-rose-700">Lưu Thành Viên</button>
    </div>
  `).join('');

  SUBMISSION_APPROVAL_LAYERS.forEach(layer => {
    const members = DB.submissionApprovalGroups[layer.key] || [];
    // Tài khoản đã khoá không hiện trong nguồn tìm-để-thêm-mới nữa (Yêu cầu 1) — thành viên đã gán từ
    // trước (members) không bị ảnh hưởng, vẫn hiện đúng qua renderChips().
    renderPeopleMultiSelect(`submissionApprovalGroupPicker_${layer.key}`, DB.users.filter(u => u.active !== false), members, '', { 'data-layer': layer.key });
  });
}

function saveSubmissionApprovalGroup(layerKey) {
  // PHẢI scope theo #submissionApprovalGroupsContainer — checkbox ẩn của widget chọn người ở form
  // TẠO tờ trình (subLayerMemberPicker_*) cũng mang cùng data-layer="${layerKey}" (chỉ khác ở việc có
  // class "sub-layer-member" hay không); cả 2 khối này luôn cùng tồn tại trong DOM (SPA 1 trang, tab
  // ẩn bằng CSS chứ không gỡ khỏi DOM) nên querySelectorAll không scope sẽ vô tình gộp cả người đang
  // được chọn dở trong form tạo tờ trình vào danh sách thành viên nhóm do admin lưu.
  const checkboxes = document.querySelectorAll(`#submissionApprovalGroupsContainer input[data-layer="${layerKey}"]`);
  const members = [];
  checkboxes.forEach(cb => { if (cb.checked) members.push(cb.value); });

  DB.submissionApprovalGroups[layerKey] = members;
  syncStorage('submissionApprovalGroups');

  const layer = SUBMISSION_APPROVAL_LAYERS.find(l => l.key === layerKey);
  logSystemAction('SUBMISSION', 'SAVE_APPROVAL_GROUP', `Cập nhật nhóm phê duyệt trình [${layer?.label}]: ${members.length} thành viên`, 'SUCCESS', layerKey);
  alert(`✅ Đã lưu thành viên nhóm "${layer?.label}"!`);
}

// Nhóm Phê Duyệt HĐ (Hợp Đồng) — cùng khuôn renderSubmissionApprovalGroups()/saveSubmissionApprovalGroup()
// ở trên nhưng dữ liệu RIÊNG (DB.contractApprovalGroups, KHÔNG dùng chung DB.submissionApprovalGroups).
function renderContractApprovalGroups() {
  const container = document.getElementById('contractApprovalGroupsContainer');
  if (!container) return;

  container.innerHTML = CONTRACT_APPROVAL_LAYERS.map(layer => `
    <div class="bg-slate-50 p-3 rounded border space-y-2">
      <div class="font-bold text-gray-800 text-xs">${escapeHtml(layer.label)}</div>
      <div id="contractApprovalGroupPicker_${layer.key}"></div>
      <button type="button" data-op="saveContractApprovalGroup" data-arg0="${layer.key}" class="w-full bg-rose-600 text-white px-2 py-1 rounded text-[11px] font-bold hover:bg-rose-700">Lưu Thành Viên</button>
    </div>
  `).join('');

  CONTRACT_APPROVAL_LAYERS.forEach(layer => {
    const members = DB.contractApprovalGroups[layer.key] || [];
    // Tài khoản đã khoá không hiện trong nguồn tìm-để-thêm-mới nữa (Yêu cầu 1) — thành viên đã gán từ
    // trước (members) không bị ảnh hưởng, vẫn hiện đúng qua renderChips().
    renderPeopleMultiSelect(`contractApprovalGroupPicker_${layer.key}`, DB.users.filter(u => u.active !== false), members, '', { 'data-layer': layer.key });
  });
}

function saveContractApprovalGroup(layerKey) {
  // PHẢI scope theo #contractApprovalGroupsContainer — cùng lý do saveSubmissionApprovalGroup() ở trên
  // (widget chọn người ở form TẠO hợp đồng, contractLayerMemberPicker_*, cũng mang data-layer trùng key).
  const checkboxes = document.querySelectorAll(`#contractApprovalGroupsContainer input[data-layer="${layerKey}"]`);
  const members = [];
  checkboxes.forEach(cb => { if (cb.checked) members.push(cb.value); });

  DB.contractApprovalGroups[layerKey] = members;
  syncStorage('contractApprovalGroups');

  const layer = CONTRACT_APPROVAL_LAYERS.find(l => l.key === layerKey);
  logSystemAction('CONTRACT', 'SAVE_APPROVAL_GROUP', `Cập nhật nhóm phê duyệt HĐ [${layer?.label}]: ${members.length} thành viên`, 'SUCCESS', layerKey);
  alert(`✅ Đã lưu thành viên nhóm "${layer?.label}"!`);
}

function cancelPermFormEdit() {
  editingGroupId = null;
  toggleUserPermFormMode('USER');
  resetUserForm();
  document.getElementById('gGroupStoreScope').checked = false;
}

// Đọc + xác thực phần DỮ LIỆU CHUNG của form Người dùng (dùng cho cả sửa người có sẵn, lưu ngay 1
// người mới, và thêm 1 người mới vào danh sách chờ — xem saveUser()/addUserToStagingList()). Trả về
// null (đã tự alert lý do) nếu có lỗi.
// Vị Trí (HO/Siêu Thị) — chọn HO hiện select Phòng Ban (nguồn DB.depts) + ẩn Siêu Thị, chọn Siêu Thị
// thì ngược lại. Dù chọn nguồn nào, chỉ 1 giá trị chuỗi duy nhất được ghi vào user.dept khi lưu (xem
// readUserFormState()) — mọi workflow/quyền scope hiện có dùng user.dept làm khoá tra cứu không cần
// biết/quan tâm giá trị đó đến từ danh mục nào.
function onUserPosTypeChange() {
  const posType = document.getElementById('uPosType').value;
  document.getElementById('uDeptFieldWrap').classList.toggle('hidden', posType !== 'HO');
  document.getElementById('uStoreFieldWrap').classList.toggle('hidden', posType !== 'STORE');
  populateUserJobTitleOptions(posType);
}

// Chức Danh (uJobTitle) phụ thuộc Vị Trí (uPosType, mục 4a) — HO dùng DB.jobTitles (Khối Văn Phòng),
// Siêu Thị dùng DB.storeJobTitles (mảng {label, restrictedFromSelfService}). KHÔNG lọc
// restrictedFromSelfService ở đây — hạn chế đó chỉ áp dụng cho form RÚT GỌN "Quản Lý Nhân Viên Siêu
// Thị" (mục 4b); form Người Dùng đầy đủ này do Admin/uniformManage thao tác nên vẫn chọn được mọi chức
// danh siêu thị, kể cả chức danh đã bị khoá tự tạo. Tách khỏi populateDropdowns() (logic tĩnh cũ) để
// gọi lại được riêng mỗi khi đổi Vị Trí, không cần render lại toàn bộ dropdown khác của trang.
function populateUserJobTitleOptions(posType) {
  const uJobTitle = document.getElementById('uJobTitle');
  if (!uJobTitle) return;
  const current = uJobTitle.value;
  const options = posType === 'STORE' ? (DB.storeJobTitles || []).map(t => t.label) : (DB.jobTitles || []);
  uJobTitle.innerHTML = '<option value="">-- Chưa gán --</option>' + options.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  if (options.includes(current)) uJobTitle.value = current;
}

function readUserFormState() {
  const editId = document.getElementById('editUserId').value;
  const username = document.getElementById('uUsername').value.trim();
  const pass = document.getElementById('uPassword').value.trim();
  const pin = document.getElementById('uPin').value.trim();
  const name = document.getElementById('uFullName').value.trim();
  const email = document.getElementById('uEmail').value.trim();
  const phone = document.getElementById('uPhone').value.trim();
  const posType = document.getElementById('uPosType').value;
  const dept = posType === 'STORE' ? document.getElementById('uStore').value : document.getElementById('uDept').value;
  if (!dept) { alert(posType === 'STORE' ? 'Vui lòng chọn Siêu Thị!' : 'Vui lòng chọn Phòng Ban!'); return null; }
  const jobTitle = document.getElementById('uJobTitle').value || null;
  const isDriver = !!document.getElementById('uIsDriver')?.checked;
  const startDate = document.getElementById('uStartDate').value || '';
  const groupIds = currentEditingUserGroupIds();

  // Nếu gán vào (một hoặc nhiều) nhóm phân quyền: khối checkbox trên form KHÔNG còn bị khoá, cho phép
  // tick thêm/bớt tuỳ chỉnh riêng trên nền quyền GỘP của các nhóm (xem mergeGroupsBasePerms()). Chỉ lưu
  // lại PHẦN KHÁC BIỆT so với nền đó (permOverrides), không lưu y nguyên toàn bộ như trước — nhờ vậy
  // khi 1 trong các nhóm đổi quyền sau này (savePermGroup()) vẫn tự động cập nhật đúng cho người này mà
  // không mất phần tuỳ chỉnh riêng.
  const groups = groupIds.map(id => DB.permGroups.find(g => g.id === id)).filter(Boolean);
  const basePerms = groups.length ? mergeGroupsBasePerms(groups.map(g => g.perms)) : null;
  const formPerms = collectPermsFromForm();
  const permOverrides = basePerms ? diffPerms(formPerms, basePerms) : null;
  const perms = basePerms ? mergePerms(basePerms, permOverrides) : formPerms;

  // Mã PIN kiểm tra sơ bộ ở client (server vẫn xác minh lại) — chỉ ép buộc khi thực sự nhập giá trị
  // mới, để trống = giữ nguyên PIN cũ (khớp hành vi mật khẩu ở trên).
  if (pin && !/^\d{4,}$/.test(pin)) { alert('Mã PIN phải là dãy số, tối thiểu 4 chữ số!'); return null; }
  if (perms.approverAuthLevel === 'PIN' && !editId && !pin) {
    alert('Vui lòng nhập mã PIN cho người dùng mới đang chọn mức xác thực "Yêu cầu nhập mã PIN"!');
    return null;
  }

  return { editId, username, pass, pin, name, email, phone, posType, dept, jobTitle, isDriver, startDate, groupIds, perms, permOverrides };
}

// Dựng 1 bản ghi người dùng MỚI từ state đã đọc — dùng chung cho lưu ngay (saveUser()) lẫn thêm vào
// danh sách chờ (addUserToStagingList()). Kiểm tra trùng username với CẢ DB.users lẫn danh sách chờ
// hiện tại (tránh 2 người trong cùng danh sách trùng tên đăng nhập nhau).
function buildNewUserFromState(state) {
  const { username, pass, pin, name, email, phone, posType, dept, jobTitle, isDriver, startDate, groupIds, perms, permOverrides } = state;
  if (!pass) { alert('Vui lòng nhập mật khẩu cho người dùng mới!'); return null; }
  if (DB.users.some(u => u.username === username)) { alert('Tên đăng nhập đã tồn tại!'); return null; }
  if (pendingNewUsers.some(u => u.username === username)) { alert('Tên đăng nhập đã có trong danh sách chờ lưu!'); return null; }
  return {
    id: Date.now() + pendingNewUsers.length,
    username, pass, ...(pin && { pin }), name, email, phone, posType, dept, jobTitle, isDriver, startDate, perms, groupIds, permOverrides
  };
}

async function saveUser(e) {
  e.preventDefault();
  if (permFormMode === 'GROUP') return savePermGroup(e); // form đang ở chế độ Nhóm — xem savePermGroup()

  const state = readUserFormState();
  if (!state) return;
  const { editId, username, pass, pin, name, email, phone, posType, dept, jobTitle, isDriver, startDate, groupIds, perms, permOverrides } = state;

  // Chụp lại nguyên trạng DB.users TRƯỚC khi sửa trực tiếp trong mảng bên dưới — nếu server từ chối
  // lưu (409/400), phục hồi lại đúng bằng bản chụp này rồi render lại, tránh để "user"/DB.users bị sửa
  // dở trong bộ nhớ trình duyệt (đã đổi nhưng chưa từng được server chấp nhận) mà giao diện không hề
  // phản ánh đúng cho tới lần tải lại trang tiếp theo.
  const usersSnapshot = JSON.parse(JSON.stringify(DB.users));

  if (editId) {
    const user = DB.users.find(u => u.id === parseInt(editId, 10));
    if (user) {
      user.username = username;
      // Để trống ô mật khẩu/PIN khi sửa = giữ nguyên giá trị hiện tại (server không bao giờ gửi mật
      // khẩu/PIN thật về trình duyệt để hiển thị lại, nên chỉ gửi khi admin thực sự nhập giá trị mới).
      if (pass) user.pass = pass;
      if (pin) user.pin = pin; else delete user.pin;
      user.name = name;
      user.email = email;
      user.phone = phone;
      user.posType = posType;
      user.dept = dept;
      user.jobTitle = jobTitle;
      user.isDriver = isDriver;
      user.startDate = startDate;
      // Tài khoản "admin" luôn toàn quyền, không cho sửa qua form (khối cây phân quyền đã bị khoá ở
      // editUser() khi mở form sửa đúng tài khoản này) — ép lại đây phòng trường hợp form vẫn đọc được
      // giá trị khác đi (vd DevTools bỏ qua thuộc tính disabled); server cũng ép lại lần nữa khi ghi
      // (routes/data.js) nên đây chỉ là lớp phòng vệ bổ sung, không phải chốt chặn duy nhất.
      user.perms = username === 'admin' ? { admin: true } : perms;
      user.groupIds = username === 'admin' ? [] : groupIds;
      user.permOverrides = username === 'admin' ? null : permOverrides;
    }
  } else {
    // Tạo mới ngay lập tức, lưu 1 người — nếu muốn gộp nhiều người rồi lưu 1 lần, dùng "+ Thêm Vào
    // Danh Sách" / "Lưu Tất Cả Danh Sách" (xem addUserToStagingList()/commitPendingNewUsers()).
    const newUser = buildNewUserFromState(state);
    if (!newUser) return;
    DB.users.push(newUser);
  }

  // Chờ server xác nhận đã lưu thật rồi mới báo thành công/dọn form — trước đây gọi syncStorage() rồi
  // báo "✅ Đã lưu..." và render lại danh sách NGAY LẬP TỨC (không đợi phản hồi), nên nếu server từ
  // chối sau đó (409 xung đột phiên bản, hoặc 400 "hệ thống sẽ không còn admin nào") người dùng đã
  // thấy thông báo thành công + giao diện coi như đã lưu xong, chỉ có thêm 1 alert lỗi hiện SAU đó gây
  // rối chứ không sửa lại được ấn tượng sai ban đầu.
  const saved = await syncStorage('users');
  if (!saved) {
    DB.users = usersSnapshot;
    renderUsers();
    return;
  }
  logSystemAction('USER_MGM', 'SAVE_USER', `Lưu thông tin người dùng [${username}]`, 'SUCCESS', username);
  alert('✅ Đã lưu thông tin người dùng và phân quyền!');
  resetUserForm();
  renderUsers();
  renderPermGroupsList();
}

