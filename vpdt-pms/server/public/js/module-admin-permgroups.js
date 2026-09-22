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
      <td class="border p-2 font-bold text-gray-800">${escapeHtml(g.name)}</td>
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

// Ma Trận Phân Quyền (10/2026) — Nhóm Phân Quyền giờ CŨNG mở thêm được từng tab Báo Cáo cụ thể cho
// TOÀN BỘ thành viên nhóm (group.reportExtraKeys), không còn CHỈ gán được từng người một qua
// uReportExtraKeysMultiSelect (module-admin-userstaging.js) — xem getEffectiveReportExtraKeys()
// (core.js) gộp reportExtraKeys của người dùng VÀ mọi nhóm họ thuộc. Cùng khuôn
// renderNVReportExtraKeysWidgets() (chỉ khác nguồn state là group.reportExtraKeys thay vì
// user.reportExtraKeys, và không đụng tới widget Nghiệp Vụ — nhóm phân quyền không có khái niệm mở
// thêm mục Nghiệp Vụ, chỉ có ở cấp người dùng).
async function renderGroupReportExtraKeysWidget(group) {
  try {
    await loadModuleGroup('baocaoquantri-preview');
    const seen = new Set();
    const items = [];
    (typeof REPORT_NAV_TREE !== 'undefined' ? REPORT_NAV_TREE : []).forEach(n => {
      if (n.key === 'SUMMARY') return;
      (n.children || [n]).forEach(c => { if (!seen.has(c.key)) { seen.add(c.key); items.push({ value: c.key, label: c.label }); } });
    });
    renderMultiSelectDropdown('pgReportExtraKeysMultiSelect', items, group?.reportExtraKeys || [], {
      placeholder: '🔍 Tìm tab Báo Cáo để mở thêm cho cả nhóm...',
      emptyText: 'Chưa mở thêm tab nào cho nhóm này.'
    });
  } catch (err) {
    console.error('renderGroupReportExtraKeysWidget() lỗi:', err);
  }
}

function startCreateGroup() {
  editingGroupId = null;
  resetUserForm();
  toggleUserPermFormMode('GROUP');
  document.getElementById('gGroupName').value = '';
  document.getElementById('gGroupDesc').value = '';
  renderGroupMembersPicker([]);
  renderGroupReportExtraKeysWidget(null);
  document.getElementById('gGroupName').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function editPermGroup(id) {
  const group = DB.permGroups.find(g => g.id === id);
  if (!group) return;
  editingGroupId = id;
  toggleUserPermFormMode('GROUP');
  document.getElementById('gGroupName').value = group.name;
  document.getElementById('gGroupDesc').value = group.description || '';
  populatePermsForm(group.perms);
  const currentMembers = DB.users.filter(u => (u.groupIds || []).includes(id)).map(u => u.username);
  renderGroupMembersPicker(currentMembers);
  renderGroupReportExtraKeysWidget(group);
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
  const reportExtraKeys = getMultiSelectValues('pgReportExtraKeysMultiSelect');
  const selectedMembers = new Set([...document.querySelectorAll('input.group-member-toggle:checked')].map(cb => cb.value));
  const permGroupsSnapshot = JSON.parse(JSON.stringify(DB.permGroups));
  const usersSnapshot = JSON.parse(JSON.stringify(DB.users));

  // group.scope (VD 'STORE') — field cũ chỉ phục vụ sub-tab "Quản Lý Nhân Viên Siêu Thị" (Đồng Phục,
  // đã gỡ hẳn, xem VERSION.md); form này không còn đọc/ghi field đó nữa — nhóm cũ nào đã có sẵn giá trị
  // này (dữ liệu lịch sử) vẫn giữ nguyên, chỉ đơn giản không hiển thị/chỉnh sửa được ở đây nữa.
  let group;
  if (editingGroupId) {
    group = DB.permGroups.find(g => g.id === editingGroupId);
    if (!group) return;
    group.name = name;
    group.description = document.getElementById('gGroupDesc').value.trim();
    group.perms = perms;
    group.reportExtraKeys = reportExtraKeys;
  } else {
    group = {
      id: 'grp_' + Date.now(),
      name,
      description: document.getElementById('gGroupDesc').value.trim(),
      perms,
      reportExtraKeys
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
  const savedUsers = membersUpdated > 0 ? await syncStorage('users', { usersBaseline: usersSnapshot }) : true;
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
  const savedUsers = memberCount > 0 ? await syncStorage('users', { usersBaseline: usersSnapshot }) : true;
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

// ==========================================
// MA TRẬN PHÂN QUYỀN — xuất/nhập hàng loạt qua Excel (10/2026)
// Theo yêu cầu người dùng: rà soát Báo Cáo + phân quyền chi tiết theo từng module, cho phép import 1
// "bảng ma trận phân quyền" để gán quyền hàng loạt cho nhiều người/nhóm cùng lúc.
//
// THIẾT KẾ CỐT LÕI: KHÔNG hard-code danh sách ~130-150 khoá quyền ở đây — cột của ma trận = MỌI khoá
// có giá trị BOOLEAN đang tồn tại thật trong DB.users[].perms/DB.permGroups[].perms tại thời điểm xuất
// (flatten theo dot-path, VD "moduleAccess.hanhchinh.car"), nên KHÔNG BAO GIỜ lệch với cây quyền thật
// (collectPermsFromForm(), module-admin-permtree.js) khi hệ thống thêm quyền mới sau này — không cần
// đồng bộ tay. Các quyền dạng PHẠM VI {all, depts:[...]} (submissionView/carView/contractView...) chỉ
// xuất được phần "all" (Toàn Bộ Phòng Ban, boolean) — phần "depts" (mảng cụ thể) và các trường không
// phải boolean khác (approverAuthLevel là chuỗi enum, uploadDepts/viewDraftDepts/viewApprovedDepts là
// mảng phẳng) CỐ Ý bỏ ngoài ma trận: 1 ô Excel gõ sai không có cách nào validate thành 1 danh sách
// phòng ban hợp lệ, rủi ro cao hơn lợi ích — vẫn phải sửa tay từng người/nhóm cho các phần này như cũ.
//
// 2 sheet Người Dùng/Nhóm Phân Quyền XUẤT RA 2 FILE .xlsx RIÊNG (không phải 2 sheet trong 1 workbook)
// — server (lib/xlsxSafeRead.js streamFirstSheetRows()) CHỈ đọc được sheet ĐẦU TIÊN của mọi file upload
// (giới hạn an toàn dùng chung cho 7 luồng import Excel khác, không nới riêng cho tính năng này), tách
// file cũng rõ ràng hơn cho người dùng (2 khái niệm khác hẳn nhau: 1 dòng = 1 người vs 1 dòng = 1 nhóm).
const PERM_MATRIX_MULTI_SEP = ';'; // phân cách nhiều giá trị trong 1 ô (Nhóm Phân Quyền/Báo Cáo - Mục Bổ Sung)
const PERM_MATRIX_COL_PREFIX = 'Q_';

function flattenPermsForMatrixInto(obj, prefix, out) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { if (prefix) out[prefix] = obj; return; }
  Object.keys(obj).forEach(k => {
    const path = prefix ? `${prefix}.${k}` : k;
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) flattenPermsForMatrixInto(v, path, out);
    else out[path] = v;
  });
}
function flattenPermsForMatrix(perms) {
  const out = {};
  flattenPermsForMatrixInto(perms || {}, '', out);
  return out;
}
// Ghi giá trị vào ĐÚNG vị trí lồng nhau theo dot-path (ngược lại flattenPermsForMatrix()) — tự tạo các
// object cha còn thiếu dọc đường, KHÔNG đụng tới các nhánh khác của object đích.
function setPermMatrixDeep(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null || Array.isArray(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// Gom TOÀN BỘ khoá BOOLEAN xuất hiện trong 1 danh sách perms (của users hoặc permGroups) — loại hẳn
// khoá nào có dù chỉ 1 lần giá trị KHÔNG PHẢI boolean (chuỗi/mảng/số) ở BẤT KỲ người/nhóm nào, tránh ma
// trận lẫn cột "an toàn" (boolean) với cột "nguy hiểm nếu gõ sai" (VD mảng phòng ban) chỉ vì 1 người
// đang có sẵn kiểu dữ liệu khác biệt (dữ liệu lịch sử/di trú).
function collectPermMatrixColumns(permsList) {
  const seenNonBoolean = new Set();
  const seenBoolean = new Set();
  permsList.forEach(perms => {
    const flat = flattenPermsForMatrix(perms);
    Object.keys(flat).forEach(k => {
      const v = flat[k];
      if (v === undefined || v === null) return;
      if (typeof v === 'boolean') seenBoolean.add(k); else seenNonBoolean.add(k);
    });
  });
  return [...seenBoolean].filter(k => !seenNonBoolean.has(k)).sort();
}

function downloadPermMatrixUsers() {
  const cols = collectPermMatrixColumns(DB.users.map(u => u.perms || {}));
  const columns = [
    { header: 'Username', key: 'Username', width: 16 },
    { header: 'HoTen', key: 'HoTen', width: 22 },
    { header: 'PhongBan', key: 'PhongBan', width: 20 },
    { header: 'NhomPhanQuyen', key: 'NhomPhanQuyen', width: 26 },
    { header: 'BaoCao_MucBoSung', key: 'BaoCao_MucBoSung', width: 26 },
    ...cols.map(c => ({ header: PERM_MATRIX_COL_PREFIX + c, key: PERM_MATRIX_COL_PREFIX + c, width: 14 }))
  ];
  const rows = DB.users.map(u => {
    const flat = flattenPermsForMatrix(u.perms || {});
    const row = {
      Username: u.username,
      HoTen: u.name || '',
      PhongBan: u.dept || '',
      NhomPhanQuyen: (u.groupIds || []).map(gid => DB.permGroups.find(g => g.id === gid)?.name).filter(Boolean).join(PERM_MATRIX_MULTI_SEP),
      BaoCao_MucBoSung: (u.reportExtraKeys || []).join(PERM_MATRIX_MULTI_SEP)
    };
    cols.forEach(c => { row[PERM_MATRIX_COL_PREFIX + c] = flat[c] === true ? 'TRUE' : 'FALSE'; });
    return row;
  });
  downloadXlsxFromServer('ma_tran_phan_quyen_nguoi_dung.xlsx', 'Người Dùng', columns, rows);
}

function downloadPermMatrixGroups() {
  const cols = collectPermMatrixColumns(DB.permGroups.map(g => g.perms || {}));
  const columns = [
    { header: 'TenNhom', key: 'TenNhom', width: 22 },
    { header: 'MoTa', key: 'MoTa', width: 26 },
    { header: 'BaoCao_MucBoSung', key: 'BaoCao_MucBoSung', width: 26 },
    ...cols.map(c => ({ header: PERM_MATRIX_COL_PREFIX + c, key: PERM_MATRIX_COL_PREFIX + c, width: 14 }))
  ];
  const rows = DB.permGroups.map(g => {
    const flat = flattenPermsForMatrix(g.perms || {});
    const row = {
      TenNhom: g.name,
      MoTa: g.description || '',
      BaoCao_MucBoSung: (g.reportExtraKeys || []).join(PERM_MATRIX_MULTI_SEP)
    };
    cols.forEach(c => { row[PERM_MATRIX_COL_PREFIX + c] = flat[c] === true ? 'TRUE' : 'FALSE'; });
    return row;
  });
  downloadXlsxFromServer('ma_tran_phan_quyen_nhom.xlsx', 'Nhóm Phân Quyền', columns, rows);
}

// So sánh 1 dòng Excel đã đọc được (row, {tênCột: chuỗi}) với perms/groupIds/reportExtraKeys HIỆN TẠI
// của 1 người/nhóm — trả về danh sách thay đổi (chỉ những gì THỰC SỰ khác) + trạng thái perms/groupIds/
// reportExtraKeys MỚI đã tính sẵn, để confirmPermMatrixImport() áp thẳng khi admin xác nhận.
function buildPermMatrixRowChanges(kind, target, row) {
  const changes = [];
  const flatOld = flattenPermsForMatrix(target.perms || {});

  // Cột Nhóm Phân Quyền (chỉ áp dụng cho sheet Người Dùng) phải tính TRƯỚC quyền — đổi nhóm cho 1 người
  // phải kéo theo đúng quyền NỀN mới của nhóm đó (mergeGroupsBasePerms(), giống onUserPermGroupsChange()/
  // saveUser()), KHÔNG chỉ áp thẳng literal từng cột Q_ (nếu không, đổi Nhóm Phân Quyền qua Excel mà quên
  // tick thêm đúng mọi cột Q_ mà nhóm mới đó cấp sẽ khiến người được gán nhóm KHÔNG thực sự có đủ quyền
  // của nhóm — sai lệch nghiêm trọng vì đây là màn phân quyền).
  let newGroupIds = target.groupIds || [];
  if (kind === 'users' && row.NhomPhanQuyen !== undefined) {
    const names = (row.NhomPhanQuyen || '').split(PERM_MATRIX_MULTI_SEP).map(s => s.trim()).filter(Boolean);
    const ids = names.map(n => DB.permGroups.find(g => g.name === n)?.id).filter(Boolean);
    const oldNames = (target.groupIds || []).map(gid => DB.permGroups.find(g => g.id === gid)?.name).filter(Boolean);
    if (JSON.stringify([...oldNames].sort()) !== JSON.stringify([...names].sort())) {
      changes.push({ label: 'Nhóm Phân Quyền', oldValue: oldNames.join(', ') || '(không có)', newValue: names.join(', ') || '(không có)' });
    }
    newGroupIds = ids;
  }

  // formPerms: bản nháp phản ánh ĐÚNG literal từng cột Q_ trong dòng Excel (đè lên nền quyền hiện có,
  // các trường KHÔNG có trong ma trận như approverAuthLevel/docDownload.depts giữ nguyên).
  const formPerms = JSON.parse(JSON.stringify(target.perms || {}));
  Object.keys(row).forEach(header => {
    if (!header.startsWith(PERM_MATRIX_COL_PREFIX)) return;
    const path = header.slice(PERM_MATRIX_COL_PREFIX.length);
    const newVal = String(row[header] || '').trim().toUpperCase() === 'TRUE';
    setPermMatrixDeep(formPerms, path, newVal);
  });

  // Cùng công thức mergePerms(mergeGroupsBasePerms(...), diffPerms(...)) mà saveUser()/savePermGroup()
  // dùng: quyền nền lấy theo nhóm MỚI (sau khi đổi ở trên), phần khác biệt so với nền đó mới là
  // "override" riêng của người này — đảm bảo quyền hiệu lực CUỐI CÙNG luôn đủ đúng phần nhóm mới cấp,
  // dù cột Q_ tương ứng trong Excel vẫn còn giá trị cũ (chưa kịp cập nhật tay theo nhóm mới).
  const newGroups = (kind === 'users' ? newGroupIds : []).map(gid => DB.permGroups.find(g => g.id === gid)).filter(Boolean);
  const groupBase = newGroups.length ? mergeGroupsBasePerms(newGroups.map(g => g.perms)) : null;
  const newPermOverrides = groupBase ? diffPerms(formPerms, groupBase) : null;
  const newPerms = groupBase ? mergePerms(groupBase, newPermOverrides) : formPerms;

  const flatNew = flattenPermsForMatrix(newPerms);
  Object.keys(row).forEach(header => {
    if (!header.startsWith(PERM_MATRIX_COL_PREFIX)) return;
    const path = header.slice(PERM_MATRIX_COL_PREFIX.length);
    const oldVal = flatOld[path] === true;
    const finalVal = flatNew[path] === true;
    if (finalVal !== oldVal) changes.push({ label: `Quyền: ${path}`, oldValue: oldVal ? 'TRUE' : 'FALSE', newValue: finalVal ? 'TRUE' : 'FALSE' });
  });

  let newReportExtraKeys = target.reportExtraKeys || [];
  if (row.BaoCao_MucBoSung !== undefined) {
    const keys = (row.BaoCao_MucBoSung || '').split(PERM_MATRIX_MULTI_SEP).map(s => s.trim()).filter(Boolean);
    const oldKeys = target.reportExtraKeys || [];
    if (JSON.stringify([...oldKeys].sort()) !== JSON.stringify([...keys].sort())) {
      changes.push({ label: 'Báo Cáo - Mục Bổ Sung', oldValue: oldKeys.join(', ') || '(không có)', newValue: keys.join(', ') || '(không có)' });
    }
    newReportExtraKeys = keys;
  }

  return { changes, newPerms, newPermOverrides, newGroupIds, newReportExtraKeys };
}

let permMatrixImportKind = null; // 'users' | 'groups'
let permMatrixImportRows = [];

async function onPermMatrixImportFileChange(evt, kind) {
  const file = evt.target.files[0];
  if (!file) return;
  evt.target.value = ''; // cho phép chọn lại đúng cùng 1 file lần sau nếu cần import lại
  if (!currentUser?.perms?.admin) return alert('⛔ Chỉ Quản Trị Viên mới được import Ma Trận Phân Quyền!');

  const formData = new FormData();
  formData.append('file', file);
  let rows;
  try {
    const res = await fetch('/api/admin/perm-matrix/import-xlsx', { method: 'POST', body: formData });
    if (res.status === 401) return handleSessionExpired();
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return alert(body.error || 'Không đọc được nội dung file Excel');
    rows = body.rows;
  } catch (e) {
    return alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }

  permMatrixImportKind = kind;
  const idCol = kind === 'users' ? 'Username' : 'TenNhom';
  permMatrixImportRows = rows.map((r, idx) => {
    const identifier = (r[idCol] || '').trim();
    const target = kind === 'users'
      ? DB.users.find(u => String(u.username).trim().toLowerCase() === identifier.toLowerCase())
      : DB.permGroups.find(g => String(g.name).trim() === identifier);
    const diff = target ? buildPermMatrixRowChanges(kind, target, r) : null;
    // Tài khoản "admin" gốc luôn bị confirmPermMatrixImport() bỏ qua khi áp dụng (không ai được đổi
    // quyền tài khoản này qua Ma Trận) — báo rõ ngay ở bảng xem trước thay vì để checkbox tick sẵn
    // (trông như sẽ áp dụng) rồi lặng lẽ không có tác dụng gì lúc bấm Xác Nhận.
    const isProtectedAdmin = kind === 'users' && identifier.toLowerCase() === 'admin';
    return {
      _idx: idx, identifier, found: !!target, duplicateInFile: !!r.duplicateInFile, diff, isProtectedAdmin,
      include: !isProtectedAdmin && !!target && !r.duplicateInFile && !!diff?.changes.length,
    };
  });
  renderPermMatrixImportPreview();
}

function renderPermMatrixImportPreview() {
  const items = permMatrixImportRows;
  const idLabel = permMatrixImportKind === 'users' ? 'username' : 'tên nhóm';
  const applicable = items.filter(it => !it.isProtectedAdmin && it.found && !it.duplicateInFile && it.diff?.changes.length).length;
  document.getElementById('permMatrixImportStatus').innerText = `Đọc được ${items.length} dòng, ${applicable} dòng có thay đổi để áp dụng.`;
  document.getElementById('permMatrixImportPreviewBody').innerHTML = items.map(it => {
    const changeCount = it.diff ? it.diff.changes.length : 0;
    let note;
    if (it.isProtectedAdmin) note = '⛔ Tài khoản admin gốc luôn giữ toàn quyền — bỏ qua';
    else if (!it.found) note = `⛔ Không tìm thấy ${idLabel} này trong hệ thống`;
    else if (it.duplicateInFile) note = '⚠️ Trùng dòng khác trong file này';
    else if (!changeCount) note = 'Không có thay đổi';
    else note = `${changeCount} thay đổi`;
    const checkable = !it.isProtectedAdmin && it.found && !it.duplicateInFile && changeCount > 0;
    const detail = changeCount ? it.diff.changes.map(c => `${escapeHtml(c.label)}: ${escapeHtml(String(c.oldValue))} → ${escapeHtml(String(c.newValue))}`).join('<br>') : '';
    return `<tr class="border-t align-top${checkable ? '' : ' bg-gray-50 text-gray-400'}">
      <td class="p-1.5">${checkable ? `<input type="checkbox" data-op-change="onPermMatrixImportRowToggle" data-arg0="${it._idx}" ${it.include ? 'checked' : ''}>` : ''}</td>
      <td class="p-1.5 font-semibold">${escapeHtml(it.identifier)}</td>
      <td class="p-1.5">${note}</td>
      <td class="p-1.5 text-[11px]">${detail}</td>
    </tr>`;
  }).join('');
  document.getElementById('permMatrixImportPreviewWrap').classList.remove('hidden');
}
function onPermMatrixImportRowToggle(idxStr) {
  const it = permMatrixImportRows.find(x => x._idx === Number(idxStr));
  if (it) it.include = !it.include;
}
function cancelPermMatrixImport() {
  permMatrixImportRows = [];
  permMatrixImportKind = null;
  document.getElementById('permMatrixImportPreviewWrap').classList.add('hidden');
  document.getElementById('permMatrixImportPreviewBody').innerHTML = '';
}

async function confirmPermMatrixImport() {
  if (!currentUser?.perms?.admin) return alert('⛔ Chỉ Quản Trị Viên mới được áp dụng Ma Trận Phân Quyền!');
  const toApply = permMatrixImportRows.filter(it => it.include && it.diff && it.diff.changes.length);
  if (!toApply.length) return alert('Chưa chọn dòng nào để áp dụng.');
  const kindLabel = permMatrixImportKind === 'users' ? 'người dùng' : 'nhóm phân quyền';
  if (!confirm(`Xác nhận áp dụng thay đổi quyền cho ${toApply.length} ${kindLabel}?`)) return;

  const usersSnapshot = JSON.parse(JSON.stringify(DB.users));
  const groupsSnapshot = JSON.parse(JSON.stringify(DB.permGroups));
  let usersTouched = false;

  if (permMatrixImportKind === 'users') {
    toApply.forEach(it => {
      const u = DB.users.find(x => String(x.username).trim().toLowerCase() === it.identifier.toLowerCase());
      if (!u || u.username === 'admin') return; // tài khoản admin gốc luôn toàn quyền, không cho đổi qua đây (khớp saveUser())
      u.perms = it.diff.newPerms;
      u.groupIds = it.diff.newGroupIds;
      // newPermOverrides = diffPerms(formPerms, groupBase) đã tính sẵn ở buildPermMatrixRowChanges() —
      // giữ đúng phần "khác biệt so với nền nhóm" (null nếu không thuộc nhóm nào), khớp CHÍNH XÁC bất
      // biến mergePerms(mergeGroupsBasePerms(...), permOverrides) mà saveUser()/onUserPermGroupsChange()
      // dùng — để lần sau admin sửa nhóm/quyền qua form thường, phần tuỳ chỉnh riêng từ đợt import này
      // không bị mất.
      u.permOverrides = it.diff.newPermOverrides;
      u.reportExtraKeys = it.diff.newReportExtraKeys;
      usersTouched = true;
    });
  } else {
    const changedGroupIds = new Set();
    toApply.forEach(it => {
      const g = DB.permGroups.find(x => String(x.name).trim() === it.identifier);
      if (!g) return;
      g.perms = it.diff.newPerms;
      g.reportExtraKeys = it.diff.newReportExtraKeys;
      changedGroupIds.add(g.id);
    });
    // Nhóm là "vai trò" (role) — sửa quyền nhóm qua ma trận cũng phải cập nhật NGAY cho mọi thành viên
    // đang gán, cùng đúng luật savePermGroup() (giữ nguyên permOverrides riêng từng người trên nền mới).
    DB.users.forEach(u => {
      const memberOfChanged = (u.groupIds || []).some(gid => changedGroupIds.has(gid));
      if (!memberOfChanged) return;
      const userGroups = (u.groupIds || []).map(gid => DB.permGroups.find(g => g.id === gid)).filter(Boolean);
      if (userGroups.length) { u.perms = mergePerms(mergeGroupsBasePerms(userGroups.map(g => g.perms)), u.permOverrides); usersTouched = true; }
    });
  }

  const savedGroups = permMatrixImportKind === 'groups' ? await syncStorage('permGroups') : true;
  const savedUsers = (permMatrixImportKind === 'users' || usersTouched) ? await syncStorage('users', { usersBaseline: usersSnapshot }) : true;
  if (!savedGroups || !savedUsers) {
    DB.users = usersSnapshot;
    DB.permGroups = groupsSnapshot;
    renderUsers();
    renderPermGroupsList();
    return;
  }
  logSystemAction('USER_MGM', 'IMPORT_PERM_MATRIX', `Nhập Ma Trận Phân Quyền (${kindLabel}) — ${toApply.length} dòng`, 'SUCCESS');
  alert(`✅ Đã áp dụng thay đổi cho ${toApply.length} ${kindLabel}!`);
  cancelPermMatrixImport();
  renderUsers();
  renderPermGroupsList();
}

