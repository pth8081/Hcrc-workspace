// ==========================================
// NHÓM PHÂN QUYỀN (PERMISSION GROUPS)
// Tái sử dụng ĐÚNG 1 bộ form/checkbox vật lý (khối 0-9) cho cả Người dùng lẫn Nhóm phân quyền,
// chuyển đổi qua lại bằng toggleUserPermFormMode() thay vì nhân đôi ~30 checkbox.
// ==========================================
function toggleUserPermFormMode(mode) {
  permFormMode = mode;
  document.getElementById('userIdentityFields').classList.toggle('hidden', mode !== 'USER');
  document.getElementById('groupIdentityFields').classList.toggle('hidden', mode !== 'GROUP');
  // Ẩn field nào thì bỏ luôn "required" của field đó — display:none không tự loại field khỏi việc
  // kiểm tra hợp lệ của trình duyệt, nếu không submit ở chế độ còn lại sẽ bị chặn ngầm.
  // uPassword KHÔNG nằm trong danh sách này — để trống khi SỬA user nghĩa là giữ nguyên mật khẩu cũ
  // (server không còn gửi mật khẩu hiện tại về để hiển thị lại), chỉ bắt buộc nhập khi TẠO MỚI, việc
  // này được kiểm tra riêng trong saveUser() vì phụ thuộc editUserId chứ không phải mode USER/GROUP.
  // uDept/uStore KHÔNG nằm trong danh sách này — chỉ 1 trong 2 field hiện tại 1 thời điểm (tuỳ Vị Trí,
  // xem onUserPosTypeChange()), required tĩnh sẽ chặn submit nhầm ở field đang ẩn; kiểm tra bắt buộc dồn
  // hết vào readUserFormState() (đọc đúng field đang hiện theo posType).
  ['uUsername', 'uFullName', 'uEmail', 'uPhone'].forEach(id => {
    document.getElementById(id).required = (mode === 'USER');
  });
  document.getElementById('btnSavePermForm').innerText = mode === 'GROUP' ? 'Lưu Nhóm Phân Quyền' : 'Lưu Người Dùng & Phân Quyền';
  document.getElementById('btnAddToStagingList').classList.toggle('hidden', mode !== 'USER');
  document.getElementById('pendingNewUsersSection').classList.toggle('hidden', mode !== 'USER' || pendingNewUsers.length === 0);
  if (mode === 'GROUP') updatePermGroupNote(false);
}

// Chỉ hiện/ẩn dòng ghi chú — khối checkbox KHÔNG còn bị khoá (disabled) khi chọn nhóm nữa, cho phép
// tick thêm/bớt tuỳ chỉnh riêng trên nền quyền của nhóm (xem diffPerms()/mergePerms() + saveUser()).
function updatePermGroupNote(hasGroup) {
  document.getElementById('permGroupInfoNote').classList.toggle('hidden', !hasGroup);
}

function currentEditingUserGroupIds() {
  return [...document.querySelectorAll('.u-perm-group-cb:checked')].map(cb => cb.value);
}

// Gán được NHIỀU nhóm phân quyền cùng lúc cho 1 người (trước đây chỉ 1 nhóm duy nhất) — quyền nền hiển
// thị lên cây quyền là quyền GỘP của TẤT CẢ nhóm đang tick (xem mergeGroupsBasePerms()), permOverrides
// vẫn tính là phần khác biệt so với quyền gộp này (xem readUserFormState()).
function onUserPermGroupsChange() {
  const groupIds = currentEditingUserGroupIds();
  if (groupIds.length) {
    const groups = groupIds.map(id => DB.permGroups.find(g => g.id === id)).filter(Boolean);
    populatePermsForm(mergeGroupsBasePerms(groups.map(g => g.perms)));
    updatePermGroupNote(true);
  } else {
    updatePermGroupNote(false);
  }
}

function renderUPermGroupsChecklist(selectedIds) {
  const wrap = document.getElementById('uPermGroupsChecklist');
  if (!wrap) return;
  const selected = new Set(selectedIds || []);
  if (!DB.permGroups.length) {
    wrap.innerHTML = `<div class="text-[11px] text-gray-400 italic">Chưa có nhóm phân quyền nào — bấm "+ Tạo Nhóm Phân Quyền Mới" để tạo.</div>`;
    return;
  }
  wrap.innerHTML = DB.permGroups.map(g => `
    <label class="flex items-center gap-1.5 text-gray-700 cursor-pointer">
      <input type="checkbox" class="u-perm-group-cb" value="${escapeHtml(g.id)}" data-op-change="onUserPermGroupsChange" ${selected.has(g.id) ? 'checked' : ''}>
      <span>${escapeHtml(g.name)}</span>
    </label>
  `).join('');
}

function renderPermGroupsList() {
  renderUPermGroupsChecklist(currentEditingUserGroupIds());
  const tbody = document.getElementById('permGroupsTableBody');
  if (!tbody) return;
  if (DB.permGroups.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center p-3 text-gray-500 italic">Chưa có nhóm phân quyền nào.</td></tr>`;
    return;
  }
  tbody.innerHTML = DB.permGroups.map(g => {
    const memberCount = DB.users.filter(u => (u.groupIds || []).includes(g.id)).length;
    return `
    <tr class="border-b hover:bg-gray-50">
      <td class="border p-2 font-bold text-gray-800">${escapeHtml(g.name)}${g.scope === 'STORE' ? '<span class="inline-block bg-teal-100 text-teal-700 text-[10px] font-bold px-1.5 py-0.5 rounded ml-1">🏪 Siêu Thị</span>' : ''}</td>
      <td class="border p-2 text-gray-600">${escapeHtml(g.description || '-')}</td>
      <td class="border p-2 text-center">${memberCount}</td>
      <td class="border p-2 text-center">
        <button data-op="editPermGroup" data-arg0="${g.id}" class="text-blue-600 font-bold hover:underline mr-2">Sửa</button>
        <button data-op="deletePermGroup" data-arg0="${g.id}" class="text-red-600 font-bold hover:underline">Xóa</button>
      </td>
    </tr>`;
  }).join('');
}

// Khối chọn nhiều thành viên cho 1 nhóm phân quyền, cùng khuôn multi-select đang dùng cho Nhóm Phê
// Duyệt Trình/HĐ (renderPeopleMultiSelect()) — cho phép thêm/bớt hàng loạt người ngay tại màn hình
// Nhóm thay vì phải vào sửa từng người một, giống cách quản lý thành viên nhóm trong AD.
function renderGroupMembersPicker(initialSelected) {
  // Loại tài khoản "admin" khỏi danh sách ứng viên — gán vào nhóm phân quyền cũng là 1 cách gián tiếp
  // đổi quyền của tài khoản này (savePermGroup() sẽ ghi đè u.perms theo quyền nhóm), trong khi tài
  // khoản "admin" phải luôn toàn quyền, không ai sửa được (xem setAdminAccountPermsLocked()).
  // Tài khoản đã khoá không hiện trong nguồn tìm-để-thêm-mới nữa (Yêu cầu 1) — thành viên đã gán từ
  // trước (initialSelected) không bị ảnh hưởng, vẫn hiện đúng qua renderPeopleMultiSelect()/renderChips().
  const candidates = DB.users.filter(u => u.username !== 'admin' && u.active !== false).map(u => ({ username: u.username, name: u.name, dept: u.dept }));
  renderPeopleMultiSelect('groupMembersPicker', candidates, initialSelected || [], 'group-member-toggle', {});
}

function startCreateGroup() {
  editingGroupId = null;
  resetUserForm();
  toggleUserPermFormMode('GROUP');
  document.getElementById('gGroupName').value = '';
  document.getElementById('gGroupDesc').value = '';
  document.getElementById('gGroupStoreScope').checked = false;
  renderGroupMembersPicker([]);
  document.getElementById('gGroupName').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function editPermGroup(id) {
  const group = DB.permGroups.find(g => g.id === id);
  if (!group) return;
  editingGroupId = id;
  toggleUserPermFormMode('GROUP');
  document.getElementById('gGroupName').value = group.name;
  document.getElementById('gGroupDesc').value = group.description || '';
  document.getElementById('gGroupStoreScope').checked = group.scope === 'STORE';
  populatePermsForm(group.perms);
  const currentMembers = DB.users.filter(u => (u.groupIds || []).includes(id)).map(u => u.username);
  renderGroupMembersPicker(currentMembers);
  document.getElementById('gGroupName').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Trước đây savePermGroup()/deletePermGroup() mutate thẳng DB.permGroups/DB.users rồi gọi syncStorage()
// KHÔNG await/kiểm tra kết quả trả về (khác saveUser()/importUsersExcel() đã chụp snapshot + await +
// rollback đúng chuẩn) — báo "✅ Đã lưu"/render UI thành công NGAY dù server sau đó từ chối (409 do
// version users/permGroups vừa bị đổi bởi thao tác khác), khiến admin tin đã đổi/gỡ quyền cho ai đó
// trong khi quyền hiệu lực thật trên server chưa hề đổi — chỉ lộ ra sau khi tải lại trang.
async function savePermGroup(e) {
  e.preventDefault();
  const name = document.getElementById('gGroupName').value.trim();
  if (!name) return alert('Vui lòng nhập Tên Nhóm Phân Quyền!');
  const perms = collectPermsFromForm();
  const storeScope = document.getElementById('gGroupStoreScope').checked;
  const selectedMembers = new Set([...document.querySelectorAll('input.group-member-toggle:checked')].map(cb => cb.value));
  const permGroupsSnapshot = JSON.parse(JSON.stringify(DB.permGroups));
  const usersSnapshot = JSON.parse(JSON.stringify(DB.users));

  let group;
  if (editingGroupId) {
    group = DB.permGroups.find(g => g.id === editingGroupId);
    if (!group) return;
    group.name = name;
    group.description = document.getElementById('gGroupDesc').value.trim();
    group.perms = perms;
    group.scope = storeScope ? 'STORE' : undefined;
  } else {
    group = {
      id: 'grp_' + Date.now(),
      name,
      description: document.getElementById('gGroupDesc').value.trim(),
      perms,
      scope: storeScope ? 'STORE' : undefined
    };
    DB.permGroups.push(group);
  }

  // Nhóm là "vai trò" (role) — sửa quyền của nhóm phải cập nhật NGAY cho mọi thành viên đang gán,
  // NHƯNG vẫn giữ nguyên phần quyền tuỳ chỉnh riêng (permOverrides) từng người đã được cấp thêm/bớt
  // trên nền quyền của nhóm (xem diffPerms()/mergePerms() + saveUser()). Đồng thời áp luôn kết quả
  // thêm/bớt hàng loạt từ khối "Thành Viên Nhóm" (xem renderGroupMembersPicker()) — 1 người giờ THUỘC
  // ĐƯỢC NHIỀU nhóm cùng lúc (mergeGroupsBasePerms()), nên thêm/bớt CHỈ ĐÚNG NHÓM ĐANG SỬA khỏi
  // groupIds của họ, không đụng tới các nhóm khác họ đang có; người bị bỏ chọn khỏi nhóm này thì mất
  // đúng phần đóng góp của nhóm này (permOverrides reset về rỗng vì "nền" đã đổi, khớp hành vi
  // deletePermGroup() hiện có).
  let membersUpdated = 0;
  DB.users.forEach(u => {
    const shouldBeMember = selectedMembers.has(u.username);
    const currentGroupIds = u.groupIds || [];
    const wasMember = currentGroupIds.includes(group.id);
    if (!shouldBeMember && !wasMember) return;

    if (shouldBeMember && !wasMember) {
      u.groupIds = [...currentGroupIds, group.id];
      u.permOverrides = null;
    } else if (!shouldBeMember && wasMember) {
      u.groupIds = currentGroupIds.filter(gid => gid !== group.id);
      u.permOverrides = null;
    }
    const userGroups = (u.groupIds || []).map(gid => gid === group.id ? group : DB.permGroups.find(x => x.id === gid)).filter(Boolean);
    u.perms = userGroups.length ? mergePerms(mergeGroupsBasePerms(userGroups.map(g => g.perms)), u.permOverrides) : u.perms;
    membersUpdated++;
  });

  const savedGroups = await syncStorage('permGroups');
  const savedUsers = membersUpdated > 0 ? await syncStorage('users') : true;
  if (!savedGroups || !savedUsers) {
    DB.permGroups = permGroupsSnapshot;
    DB.users = usersSnapshot;
    renderPermGroupsList();
    renderUsers();
    return;
  }
  logSystemAction('USER_MGM', 'SAVE_PERM_GROUP', `Lưu nhóm phân quyền [${name}]${membersUpdated ? `, cập nhật ${membersUpdated} thành viên` : ''}`, 'SUCCESS', name);
  alert(`✅ Đã lưu nhóm phân quyền!${membersUpdated ? ` Đã cập nhật ${membersUpdated} thành viên.` : ''}`);

  cancelPermFormEdit();
  renderPermGroupsList();
  renderUsers();
}

async function deletePermGroup(id) {
  const group = DB.permGroups.find(g => g.id === id);
  if (!group) return;
  const memberCount = DB.users.filter(u => (u.groupIds || []).includes(id)).length;
  const msg = memberCount > 0
    ? `Nhóm "${group.name}" đang có ${memberCount} thành viên. Xóa nhóm sẽ gỡ các thành viên này khỏi nhóm (những nhóm khác họ đang có không bị ảnh hưởng; quyền hiện tại từ các nhóm còn lại trở thành quyền riêng, không còn tự động cập nhật theo nhóm này nữa). Tiếp tục xóa?`
    : `Bạn có chắc chắn muốn xóa nhóm phân quyền "${group.name}"?`;
  if (!confirm(msg)) return;

  const permGroupsSnapshot = JSON.parse(JSON.stringify(DB.permGroups));
  const usersSnapshot = JSON.parse(JSON.stringify(DB.users));
  DB.users.forEach(u => {
    if ((u.groupIds || []).includes(id)) {
      u.groupIds = u.groupIds.filter(gid => gid !== id);
      u.permOverrides = null;
      const remainingGroups = u.groupIds.map(gid => DB.permGroups.find(g => g.id === gid)).filter(Boolean);
      u.perms = remainingGroups.length ? mergeGroupsBasePerms(remainingGroups.map(g => g.perms)) : u.perms;
    }
  });
  DB.permGroups = DB.permGroups.filter(g => g.id !== id);

  const savedGroups = await syncStorage('permGroups');
  const savedUsers = memberCount > 0 ? await syncStorage('users') : true;
  if (!savedGroups || !savedUsers) {
    DB.permGroups = permGroupsSnapshot;
    DB.users = usersSnapshot;
    renderPermGroupsList();
    renderUsers();
    return;
  }
  logSystemAction('USER_MGM', 'DELETE_PERM_GROUP', `Xóa nhóm phân quyền [${group.name}]`, 'SUCCESS', group.name);
  renderPermGroupsList();
  renderUsers();
}

