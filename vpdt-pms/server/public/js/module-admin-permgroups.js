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

  // baseline: permGroupsSnapshot — cùng cơ chế thử-lại-1-lần-sau-409 vốn chỉ có ở "users" (10/2026, "Item
  // 6" đợt golive: tổng quát hoá retryArraySaveAfterConflict() sang "permGroups" — nhiều admin cùng sửa
  // các nhóm KHÁC nhau gần như đồng thời trước đây vẫn bị 409 giả vì cùng 1 version dùng chung cho cả
  // collection, y hệt triệu chứng "users" đã vá — xem syncStorageOnce()/core.js).
  const savedGroups = await syncStorage('permGroups', { baseline: permGroupsSnapshot });
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

  const savedGroups = await syncStorage('permGroups', { baseline: permGroupsSnapshot });
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
// phải boolean khác (approverAuthLevel là chuỗi enum, uploadDepts là mảng phẳng) CỐ Ý bỏ ngoài ma trận:
// 1 ô Excel gõ sai không có cách nào validate thành 1 danh sách phòng ban hợp lệ, rủi ro cao hơn lợi
// ích — vẫn phải sửa tay từng người/nhóm cho các phần này như cũ.
//
// 2 sheet Người Dùng/Nhóm Phân Quyền XUẤT RA 2 FILE .xlsx RIÊNG (không phải 2 sheet trong 1 workbook)
// — server (lib/xlsxSafeRead.js streamFirstSheetRows()) CHỈ đọc được sheet ĐẦU TIÊN của mọi file upload
// (giới hạn an toàn dùng chung cho 7 luồng import Excel khác, không nới riêng cho tính năng này), tách
// file cũng rõ ràng hơn cho người dùng (2 khái niệm khác hẳn nhau: 1 dòng = 1 người vs 1 dòng = 1 nhóm).
const PERM_MATRIX_MULTI_SEP = ';'; // phân cách nhiều giá trị trong 1 ô (Nhóm Phân Quyền/Báo Cáo - Mục Bổ Sung)
const PERM_MATRIX_COL_PREFIX = 'Q_';

// Nhãn tiếng Việt cho cột Ma Trận Phân Quyền (theo yêu cầu người dùng 10/2026: "đổi tên cột thành tiếng
// Việt ứng với hệ thống đang hiển thị") — trích XUẤT MÁY (không gõ tay) từ đúng nhãn checkbox thật ở cây
// phân quyền (fragments/systemSection.html, ghép "Tên khối — Nhãn checkbox") + BUSINESS_MODULES
// (core.js, cho các cột moduleAccess.*), đảm bảo khớp Y HỆT những gì admin thấy khi tick tay ở màn Sửa
// Người Dùng/Sửa Nhóm Phân Quyền. LƯU Ý: đây là 1 BẢN CHỤP tĩnh — nếu sau này thêm quyền mới hoặc đổi
// nhãn checkbox trong systemSection.html, khoá đó tạm thời xuất ra dạng "Q_<khoá>" cũ (vẫn hoạt động
// bình thường, chỉ không có nhãn tiếng Việt) cho tới khi có người bổ sung 1 dòng tương ứng vào đây.
const PERM_KEY_VN_LABELS = {
  "admin": "Hệ Thống & Chung — Quyền Admin (Trang quản trị)",
  "approverAuthLevel": "Hệ Thống & Chung — 🔐 Xác thực bổ sung khi bấm Duyệt",
  "budgetAggregate": "Ngân Sách — 📊 Tổng hợp (xem Tổng Hợp Theo Phòng, mọi phòng ban)",
  "budgetCreate": "Ngân Sách — 📝 Xem, tạo ngân sách (xem/nhập/sửa Phê Duyệt & Thực Hiện + Tổng Hợp — đúng phòng ban mình)",
  "budgetManage": "Ngân Sách — 📅 Quản lý (xem MỌI phòng ban + Tổng Hợp Toàn Công Ty, không sửa được ngân sách phòng khác; tạo/đóng/mở kỳ, quản lý mẫu)",
  "budgetReportView": "Ngân Sách — 📊 Xem Báo Cáo (không kèm quyền quản lý/tổng hợp/tạo ở trên)",
  "canBeApprover": "Hệ Thống & Chung — ✅ Có thể được chọn làm người duyệt",
  "canViewReports": "Hệ Thống & Chung — 📊 Được xem Báo cáo quản trị",
  "carCreate.all": "Đăng Ký Xe — Tạo mới",
  "carDispatch": "Đăng Ký Xe — 🚘 Người Điều Hành Xe (được nhập lái xe/loại xe/biển số ở mục \"Phần Dành Cho Phòng Hành Chính\" khi đến lượt phê duyệt — người khác trong luồng duyệt không có quyền này thì không thấy/không sửa được mục đó)",
  "carDownload.all": "Đăng Ký Xe — Tải xuống",
  "carReportView": "Đăng Ký Xe — 📊 Xem Báo Cáo Đăng Ký Xe (toàn công ty, không kèm quyền Xem ở bảng trên)",
  "carView.all": "Đăng Ký Xe — Xem",
  "checklistExecute": "Checklist Đánh Giá Siêu Thị — ✅ Quyền Thực Hiện Checklist (Checklist Thường, đúng siêu thị đang gán)",
  "checklistExecuteScope.all": "Checklist Đánh Giá Siêu Thị — ✅ Quyền Thực Hiện Checklist — ALL (không gắn siêu thị, thực hiện được mọi siêu thị)",
  "checklistReportView": "Checklist Đánh Giá Siêu Thị — 📊 Quyền Báo Cáo Checklist (xem báo cáo Checklist Thường mọi siêu thị)",
  "checklistAtvstpExecute": "Checklist Đánh Giá Siêu Thị — 🥗 Quyền Thực Hiện ATVSTP (Kiểm Soát, mọi siêu thị)",
  "checklistAtvstpReportView": "Checklist Đánh Giá Siêu Thị — 🥗 Quyền Báo Cáo ATVSTP (Dashboard VSATTP, mọi siêu thị)",
  "contractCreate.all": "Hợp Đồng & Giấy Phép — Tạo mới",
  "contractDownload.all": "Hợp Đồng & Giấy Phép — Tải xuống",
  "contractImportSigned": "Hợp Đồng & Giấy Phép — 📥 Nhập Hợp Đồng / Phụ Lục ĐÃ KÝ (sub-tab \"Quản Lý HĐ\")",
  "docDownload.all": "Tài Liệu — Tải Tài Liệu",
  "hrAttendanceManage": "Nhân Sự — ⏱️ Quản Lý Chấm Công & Phép Năm (HR)",
  "hrContractManage": "Nhân Sự — 📝 Quản Lý Hợp Đồng Lao Động (HR)",
  "hrLeaveApprove": "Nhân Sự — ✅ Duyệt Đơn Nghỉ Phép (quản lý trực tiếp)",
  "hrOffboardingManage": "Nhân Sự — 🚪 Quản Lý Offboarding",
  "hrOnboardingManage": "Nhân Sự — 🆕 Quản Lý Onboarding",
  "hrPayrollApprove": "Nhân Sự — ✅ Duyệt Lương (tách biệt Lập/Tính)",
  "hrPayrollManage": "Nhân Sự — 💰 Lập/Tính Lương (Kế Toán/HR)",
  "hrProcessManage": "Nhân Sự — ✅ Toàn Quyền Thao Tác Mọi Quy Trình Onboarding/Offboarding (hoàn thành/bỏ qua task, huỷ/giao lại quy trình của người khác — kể cả task quyết định thử việc/chấm dứt hợp đồng)",
  "hrProfileCreate": "Nhân Sự — ➕ Tạo Mới Hồ Sơ Nhân Sự (tay + Excel hàng loạt)",
  "hrProfileEdit": "Nhân Sự — ✏️ Sửa Hồ Sơ Nhân Sự (đã có sẵn — không tự tạo hồ sơ mới nếu chưa tick \"Tạo Mới\")",
  "hrProfileFullView": "Nhân Sự — 👁️ Xem Toàn Bộ Hồ Sơ Nhân Sự (không giới hạn như quản lý trực tiếp, không sửa được)",
  "hrProfileManage": "Nhân Sự — 🗂️ Quản Lý Hồ Sơ Nhân Sự (HR — xem/sửa đầy đủ, liên kết tài khoản)",
  "hrProfileView": "Nhân Sự — 👁️ Xem Hồ Sơ Nhân Sự Cấp Dưới (quản lý trực tiếp)",
  "hrReportView": "Nhân Sự — 📊 Xem Báo Cáo Nhân Sự (không kèm 2 quyền Quản Lý ở trên)",
  "hrShiftRosterManage": "Nhân Sự — 📅 Lập Lịch Phân Ca (Quản Lý Siêu Thị)",
  "hrShiftSwapApprove": "Nhân Sự — 🔁 Duyệt Đổi Ca (Quản Lý Siêu Thị)",
  "hrTaskTemplateManage": "Nhân Sự — 📋 Quản Lý Checklist Mẫu (Onboarding/Offboarding)",
  "hrViewAll": "Nhân Sự — 👁️ Xem Toàn Bộ Quy Trình Onboarding/Offboarding (CHỈ xem tiến độ, KHÔNG thao tác được task/quy trình — cần thêm \"Toàn Quyền Thao Tác\" ở trên nếu muốn ghi)",
  "internalNewsCreate": "Truyền Thông Nội Bộ — 📰 Đăng Nhịp Sống HCRC",
  "internalPostApprove": "Truyền Thông Nội Bộ — ✅ Duyệt bài \"Góc chia sẻ\" (toàn công ty)",
  "internalRecruitmentCreate": "Truyền Thông Nội Bộ — 💼 Đăng Tuyển dụng",
  "itManage": "Hỗ Trợ IT — 🛠️ Đội Hỗ Trợ IT (nhận xử lý ticket Hỗ Trợ Yêu Cầu)",
  "itPriceEmergencyRejectApproveRetail": "Mua Hàng — 🚨 Phê duyệt từ chối khẩn cấp Bán Lẻ",
  "itPriceEmergencyRejectApproveWholesale": "Vận Hành — 🚨 Phê duyệt từ chối khẩn cấp Bán Buôn",
  "itPriceProposeCreateRetail": "Mua Hàng — 🏷️ Đề xuất duyệt giá Bán Lẻ",
  "itPriceProposeCreateWholesale": "Vận Hành — 🏷️ Đề xuất duyệt giá Bán Buôn",
  "itPriceSupport": "Hỗ Trợ IT — 💲 Hỗ trợ giá Bán Buôn/Bán Lẻ (áp giá sau khi duyệt, xem toàn bộ Phê Duyệt Giá)",
  "itServiceRenewalManage": "Hỗ Trợ IT — 🔔 Sử dụng Gia Hạn Dịch Vụ",
  "kpiFlowConfigManage": "Nhân Sự — 🎯 Cấu Hình Luồng Đánh Giá KPI",
  "licenseApprove": "Giấy Phép — ✔️ Duyệt Giấy Phép (kể cả Gia Hạn/Thu Hồi)",
  "licenseCreate": "Giấy Phép — 📤 Tạo / Tải Lên Giấy Phép",
  "licenseView": "Giấy Phép — 👁️ Xem / Tải Giấy Phép",
  "meetingApprove": "Phòng Họp — ✅ Phê duyệt phòng họp (toàn công ty)",
  "meetingBookScope.all": "Phòng Họp — Đăng ký (book)",
  "meetingCancel": "Phòng Họp — ❌ Người quản lý phòng họp (hủy được lịch của TẤT CẢ mọi người — ai cũng tự hủy được lịch do chính mình đặt, không cần quyền này)",
  "meetingReportView": "Phòng Họp — 📊 Xem Báo Cáo Phòng Họp (toàn công ty, không kèm quyền duyệt/hủy)",
  "meetingView.all": "Phòng Họp — Xem",
  "minutesCreate": "Biên Bản Họp & 📋 Công Việc — ✅ Tạo mới (lập) biên bản",
  "minutesDownload": "Biên Bản Họp & 📋 Công Việc — ⬇️ Tải tất cả biên bản",
  "minutesEdit": "Biên Bản Họp & 📋 Công Việc — ✏️ Sửa tất cả biên bản",
  "minutesView": "Biên Bản Họp & 📋 Công Việc — 👁️ Xem tất cả biên bản",
  "moduleAccess.budget": "Quyền Vào Module — Tổng Hợp > Ngân Sách",
  // 4 entry budget* bên dưới + hàng loạt entry tab/subtab khác trong khối này: Mục 0 — đợt "không bỏ qua
  // bất kỳ subtab nào" (10/2026, xem BUSINESS_MODULES core.js) — mở rộng checkbox xuống tới MỌI tab/
  // subtab còn thiếu trên toàn hệ thống, không chỉ những module đã làm ở đợt trước.
  "moduleAccess.budgetApprove": "Quyền Vào Module — Tổng Hợp > Ngân Sách > Phê Duyệt",
  "moduleAccess.budgetPropose": "Quyền Vào Module — Tổng Hợp > Ngân Sách > Đề Xuất",
  "moduleAccess.budgetReport": "Quyền Vào Module — Tổng Hợp > Ngân Sách > Báo Cáo",
  "moduleAccess.budgetUsed": "Quyền Vào Module — Tổng Hợp > Ngân Sách > Sử Dụng",
  "moduleAccess.car": "Quyền Vào Module — Hành Chính > Đăng Ký Xe",
  "moduleAccess.carCalendar": "Quyền Vào Module — Hành Chính > Đăng Ký Xe > Lịch Xe",
  "moduleAccess.carDriver": "Quyền Vào Module — Hành Chính > Đăng Ký Xe > Lái Xe",
  "moduleAccess.carReg": "Quyền Vào Module — Hành Chính > Đăng Ký Xe > Đăng Ký",
  "moduleAccess.carReport": "Quyền Vào Module — Hành Chính > Đăng Ký Xe > Báo Cáo",
  "moduleAccess.checklist": "Quyền Vào Module — Checklist Đánh Giá Siêu Thị",
  "moduleAccess.checklistExecute": "Quyền Vào Module — Checklist Đánh Giá Siêu Thị > Thực Hiện",
  "moduleAccess.checklistReport": "Quyền Vào Module — Checklist Đánh Giá Siêu Thị > Báo Cáo",
  "moduleAccess.checklistReportGeneral": "Quyền Vào Module — Checklist Đánh Giá Siêu Thị > Báo Cáo > Tổng Hợp",
  "moduleAccess.checklistReportVsattp": "Quyền Vào Module — Checklist Đánh Giá Siêu Thị > Báo Cáo > VSATTP",
  "moduleAccess.checklistResult": "Quyền Vào Module — Checklist Đánh Giá Siêu Thị > Kết Quả",
  "moduleAccess.contract": "Quyền Vào Module — Hợp Đồng",
  "moduleAccess.contractApproval": "Quyền Vào Module — Hợp Đồng > Phê Duyệt",
  "moduleAccess.contractManage": "Quyền Vào Module — Hợp Đồng > Quản Lý HĐ",
  "moduleAccess.doc": "Quyền Vào Module — Tài Liệu",
  "moduleAccess.hanhchinh": "Quyền Vào Module — Hành Chính",
  "moduleAccess.hr": "Quyền Vào Module — Nhân Sự",
  "moduleAccess.hrAttendance": "Quyền Vào Module — Nhân Sự > Công & Phép",
  "moduleAccess.hrAttendanceApproveTab": "Quyền Vào Module — Nhân Sự > Công & Phép > Duyệt Đơn",
  "moduleAccess.hrAttendanceManageTab": "Quyền Vào Module — Nhân Sự > Công & Phép > Quản Lý",
  "moduleAccess.hrAttendanceRosterTab": "Quyền Vào Module — Nhân Sự > Công & Phép > Lịch Trực/Ca",
  "moduleAccess.hrAttendanceSelf": "Quyền Vào Module — Nhân Sự > Công & Phép > Của Tôi",
  "moduleAccess.hrContract": "Quyền Vào Module — Nhân Sự > Hợp Đồng Lao Động",
  "moduleAccess.hrLifecycle": "Quyền Vào Module — Nhân Sự > Onboarding / Offboarding",
  "moduleAccess.hrLifecycleList": "Quyền Vào Module — Nhân Sự > Onboarding / Offboarding > Danh Sách Quy Trình",
  "moduleAccess.hrLifecycleMyTasks": "Quyền Vào Module — Nhân Sự > Onboarding / Offboarding > Việc Của Tôi",
  "moduleAccess.hrLifecycleTemplates": "Quyền Vào Module — Nhân Sự > Onboarding / Offboarding > Checklist Mẫu",
  "moduleAccess.hrPayroll": "Quyền Vào Module — Nhân Sự > Lương",
  "moduleAccess.hrPayrollManageTab": "Quyền Vào Module — Nhân Sự > Lương > Quản Lý Kỳ Lương",
  "moduleAccess.hrPayrollSelf": "Quyền Vào Module — Nhân Sự > Lương > Phiếu Lương Của Tôi",
  "moduleAccess.hrProfile": "Quyền Vào Module — Nhân Sự > Hồ Sơ Nhân Sự",
  "moduleAccess.hrProfileManageTab": "Quyền Vào Module — Nhân Sự > Hồ Sơ Nhân Sự > Quản Lý",
  "moduleAccess.hrProfileMe": "Quyền Vào Module — Nhân Sự > Hồ Sơ Nhân Sự > Hồ Sơ Của Tôi",
  "moduleAccess.hrProfileOnboardingQueue": "Quyền Vào Module — Nhân Sự > Hồ Sơ Nhân Sự > Hồ Sơ Onboarding",
  "moduleAccess.hrReport": "Quyền Vào Module — Nhân Sự > Báo Cáo",
  "moduleAccess.internal": "Quyền Vào Module — Truyền Thông Nội Bộ",
  // 5 entry internalNews/internalQna/internalRecruitment/internalShare/internalTraining + 9 entry
  // trainingLms* bên dưới: Mục 0 — CẤP 3/4 "tab con"/"tab cháu" (10/2026, xem BUSINESS_MODULES core.js).
  "moduleAccess.internalNews": "Quyền Vào Module — Truyền Thông Nội Bộ > Tin Tức (Nhịp Sống HCRC)",
  "moduleAccess.internalQna": "Quyền Vào Module — Truyền Thông Nội Bộ > HCRC Đồng Hành",
  "moduleAccess.internalRecruitment": "Quyền Vào Module — Truyền Thông Nội Bộ > Tuyển Dụng",
  "moduleAccess.internalRecruitmentJobs": "Quyền Vào Module — Truyền Thông Nội Bộ > Tuyển Dụng > Tin Tuyển Dụng",
  "moduleAccess.internalRecruitmentManage": "Quyền Vào Module — Truyền Thông Nội Bộ > Tuyển Dụng > Quản Lý Ứng Viên",
  "moduleAccess.internalRecruitmentMyReferrals": "Quyền Vào Module — Truyền Thông Nội Bộ > Tuyển Dụng > Giới Thiệu Của Tôi",
  "moduleAccess.internalShare": "Quyền Vào Module — Truyền Thông Nội Bộ > Góc Chia Sẻ",
  "moduleAccess.internalTraining": "Quyền Vào Module — Truyền Thông Nội Bộ > Đào Tạo",
  "moduleAccess.itSupport": "Quyền Vào Module — Hỗ Trợ IT",
  "moduleAccess.itSupportPrice": "Quyền Vào Module — Hỗ Trợ IT > Phê Duyệt Giá",
  "moduleAccess.itSupportRenewal": "Quyền Vào Module — Hỗ Trợ IT > Gia Hạn Dịch Vụ",
  "moduleAccess.itSupportTicket": "Quyền Vào Module — Hỗ Trợ IT > Ticket",
  "moduleAccess.license": "Quyền Vào Module — Hành Chính > Giấy Phép",
  "moduleAccess.meeting": "Quyền Vào Module — Hành Chính > Đặt Phòng Họp",
  "moduleAccess.meetingCalendar": "Quyền Vào Module — Hành Chính > Đặt Phòng Họp > Lịch",
  "moduleAccess.meetingRegister": "Quyền Vào Module — Hành Chính > Đặt Phòng Họp > Đăng Ký",
  "moduleAccess.meetingReport": "Quyền Vào Module — Hành Chính > Đặt Phòng Họp > Báo Cáo",
  "moduleAccess.minutes": "Quyền Vào Module — Biên Bản Họp",
  "moduleAccess.muaHang": "Quyền Vào Module — Mua Hàng",
  "moduleAccess.muaHangBas": "Quyền Vào Module — Mua Hàng > BAS",
  "moduleAccess.muaHangBasSync": "Quyền Vào Module — Mua Hàng > BAS > Đồng Bộ DSmart",
  "moduleAccess.muaHangBasTerm": "Quyền Vào Module — Mua Hàng > BAS > Điều Khoản",
  "moduleAccess.muaHangBasVendor": "Quyền Vào Module — Mua Hàng > BAS > Nhà Cung Cấp",
  "moduleAccess.muaHangItprice": "Quyền Vào Module — Mua Hàng > Phê Duyệt Giá Bán Lẻ",
  "moduleAccess.muaHangReport": "Quyền Vào Module — Mua Hàng > Báo Cáo",
  "moduleAccess.nghiepVu": "Quyền Vào Module — Nghiệp Vụ",
  "moduleAccess.office": "Quyền Vào Module — Tổng Hợp",
  "moduleAccess.officeMuaBan": "Quyền Vào Module — Tổng Hợp > Mua Bán",
  "moduleAccess.officeSuaChua": "Quyền Vào Module — Tổng Hợp > Sửa Chữa",
  "moduleAccess.orgChart": "Quyền Vào Module — Nhân Sự > Cơ Cấu Tổ Chức",
  "moduleAccess.orgChartDiagram": "Quyền Vào Module — Nhân Sự > Cơ Cấu Tổ Chức > Sơ Đồ",
  "moduleAccess.orgChartKpi": "Quyền Vào Module — Nhân Sự > Cơ Cấu Tổ Chức > KPI",
  "moduleAccess.orgChartTree": "Quyền Vào Module — Nhân Sự > Cơ Cấu Tổ Chức > Cây",
  // Mục 0 (10/2026): "payment" TRƯỚC ĐÂY vắng mặt khỏi BUSINESS_MODULES — xem chú thích đầy đủ tại entry
  // 'payment' trong BUSINESS_MODULES (core.js)/canAccessPaymentModule().
  "moduleAccess.payment": "Quyền Vào Module — Tổng Hợp > Thanh Toán",
  "moduleAccess.paymentApproveTab": "Quyền Vào Module — Tổng Hợp > Thanh Toán > Phê Duyệt",
  "moduleAccess.paymentCreateTab": "Quyền Vào Module — Tổng Hợp > Thanh Toán > Tạo Đề Nghị",
  "moduleAccess.paymentManageTab": "Quyền Vào Module — Tổng Hợp > Thanh Toán > Quản Lý",
  "moduleAccess.periodicReport": "Quyền Vào Module — Báo Cáo Định Kỳ",
  "moduleAccess.periodicReportAggregate": "Quyền Vào Module — Báo Cáo Định Kỳ > Tổng Hợp",
  "moduleAccess.periodicReportEntry": "Quyền Vào Module — Báo Cáo Định Kỳ > Nhập Báo Cáo",
  "moduleAccess.periodicReportPeriods": "Quyền Vào Module — Báo Cáo Định Kỳ > Quản Lý Kỳ",
  "moduleAccess.periodicReportPublished": "Quyền Vào Module — Báo Cáo Định Kỳ > Đã Công Bố",
  "moduleAccess.reports": "Quyền Vào Module — Báo Cáo",
  "moduleAccess.submission": "Quyền Vào Module — Văn Bản Trình / Tờ Trình",
  "moduleAccess.task": "Quyền Vào Module — Công Việc",
  "moduleAccess.trainingLmsClasses": "Quyền Vào Module — Truyền Thông Nội Bộ > Đào Tạo > Lớp Học",
  "moduleAccess.trainingLmsCourses": "Quyền Vào Module — Truyền Thông Nội Bộ > Đào Tạo > Chương Trình",
  "moduleAccess.trainingLmsDashboard": "Quyền Vào Module — Truyền Thông Nội Bộ > Đào Tạo > Dashboard",
  "moduleAccess.trainingLmsDocs": "Quyền Vào Module — Truyền Thông Nội Bộ > Đào Tạo > Kho Tài Liệu",
  "moduleAccess.trainingLmsMyRegs": "Quyền Vào Module — Truyền Thông Nội Bộ > Đào Tạo > Đăng Ký Của Tôi",
  "moduleAccess.trainingLmsOnboarding": "Quyền Vào Module — Truyền Thông Nội Bộ > Đào Tạo > Lộ Trình Tân Binh",
  "moduleAccess.trainingLmsPaths": "Quyền Vào Module — Truyền Thông Nội Bộ > Đào Tạo > Lộ Trình Thăng Tiến",
  "moduleAccess.trainingLmsPlans": "Quyền Vào Module — Truyền Thông Nội Bộ > Đào Tạo > Kế Hoạch Đào Tạo",
  "moduleAccess.trainingLmsTests": "Quyền Vào Module — Truyền Thông Nội Bộ > Đào Tạo > Ngân Hàng Câu Hỏi",
  "moduleAccess.uniform": "Quyền Vào Module — Hành Chính > Đồng Phục",
  "moduleAccess.uniformDashboard": "Quyền Vào Module — Hành Chính > Đồng Phục > Dashboard",
  "moduleAccess.uniformPeriods": "Quyền Vào Module — Hành Chính > Đồng Phục > Kỳ Cấp Phát",
  "moduleAccess.uniformStock": "Quyền Vào Module — Hành Chính > Đồng Phục > Tồn Kho",
  "moduleAccess.uniformStore": "Quyền Vào Module — Hành Chính > Đồng Phục > Xác Nhận/Cấp Phát",
  "moduleAccess.vanHanh": "Quyền Vào Module — Vận Hành",
  // entry vanHanh* bên dưới: Mục 0 — CẤP 3 "tab con" của Vận Hành > Siêu Thị/Đơn Hàng (10/2026) — fix
  // trực tiếp lỗi "cấp quyền Công Việc/Nghiệm Thu lại thấy được cả Báo Cáo", xem canAccessOperationSubTab()
  // core.js; vanHanhOrders*/vanHanhStoreGroup/vanHanhItpriceTab/vanHanhStoreOpen/vanHanhRepair thêm ở đợt
  // "không bỏ qua bất kỳ subtab nào" để phủ hết 3 tab cấp 1 + 6 tab cấp 2 còn thiếu.
  "moduleAccess.vanHanhAcceptance": "Quyền Vào Module — Vận Hành > Siêu Thị > Nghiệm Thu",
  "moduleAccess.vanHanhEstimate": "Quyền Vào Module — Vận Hành > Siêu Thị > Dự Toán",
  "moduleAccess.vanHanhExecution": "Quyền Vào Module — Vận Hành > Siêu Thị > Công Việc",
  "moduleAccess.vanHanhItpriceTab": "Quyền Vào Module — Vận Hành > Phê Duyệt Giá Bán Buôn",
  "moduleAccess.vanHanhOrders": "Quyền Vào Module — Vận Hành > Đơn Hàng",
  "moduleAccess.vanHanhOrdersHo": "Quyền Vào Module — Vận Hành > Đơn Hàng > HO",
  "moduleAccess.vanHanhOrdersReceipt": "Quyền Vào Module — Vận Hành > Đơn Hàng > Duyệt Nhập/Hủy",
  "moduleAccess.vanHanhOrdersReport": "Quyền Vào Module — Vận Hành > Đơn Hàng > Báo Cáo",
  "moduleAccess.vanHanhOrdersStore": "Quyền Vào Module — Vận Hành > Đơn Hàng > Siêu Thị",
  "moduleAccess.vanHanhRepair": "Quyền Vào Module — Vận Hành > Siêu Thị > Sửa Chữa",
  "moduleAccess.vanHanhReport": "Quyền Vào Module — Vận Hành > Siêu Thị > Báo Cáo",
  "moduleAccess.vanHanhStoreGroup": "Quyền Vào Module — Vận Hành > Siêu Thị",
  "moduleAccess.vanHanhStoreOpen": "Quyền Vào Module — Vận Hành > Siêu Thị > Mở Mới",
  "moduleAccess.vpp": "Quyền Vào Module — Hành Chính > Văn Phòng Phẩm",
  "moduleAccess.vppPeriods": "Quyền Vào Module — Hành Chính > Văn Phòng Phẩm > Kỳ",
  "moduleAccess.vppRegister": "Quyền Vào Module — Hành Chính > Văn Phòng Phẩm > Đăng Ký",
  "moduleAccess.vppReports": "Quyền Vào Module — Hành Chính > Văn Phòng Phẩm > Báo Cáo",
  "nghiepVuViewAll": "Nghiệp Vụ & Báo Cáo — 👁️ Xem Toàn Bộ Mục Nghiệp Vụ (bỏ qua giới hạn theo quyền module)",
  "nhanSuManage": "Nhân Sự — 🤝 Quản lý Nhân Sự (quản lý & phản hồi ý kiến)",
  "officeBuy": "Văn Phòng (Mua/Sửa) — 🛒 Mua Bán",
  "officeCreate.all": "Văn Phòng (Mua/Sửa) — Tạo mới",
  "officeDownload.all": "Văn Phòng (Mua/Sửa) — Tải xuống",
  "officeFix": "Văn Phòng (Mua/Sửa) — 🔧 Sửa Chữa",
  "officeView.all": "Văn Phòng (Mua/Sửa) — Xem",
  "onboardingEvaluate": "Đào Tạo — 🆕 Đánh Giá Tân Binh (Giai đoạn 3, theo đơn vị)",
  "operationOrderCreate": "Vận Hành — 📦 Tạo/Gửi Đơn Hàng",
  "operationOrderReceiptManageHO": "Vận Hành — 🏢 Quyền Phê Duyệt Đặt Hàng HO",
  "operationOrderReceiptManageStore.all": "Vận Hành — Quyền Phê Duyệt Đặt Hàng Siêu Thị",
  "operationOrderReportView": "Vận Hành — 📊 Xem Báo Cáo Đơn Hàng",
  "operationRecordManageAll": "Vận Hành — 🏬 Quản Lý Hồ Sơ Siêu Thị (Toàn Quyền — Không Phân Biệt Người Tạo)",
  "operationRecordViewAll": "Vận Hành — 👁️ Xem + Tải Tệp Toàn Bộ Hồ Sơ Siêu Thị (Không Phân Biệt Phòng Ban, KHÔNG có quyền sửa)",
  "operationRepairCreate": "Vận Hành — 🔧 Tạo Đề Xuất Sửa Chữa Siêu Thị (+ Toàn Quyền Trên Hồ Sơ Của Mình)",
  "operationStoreOpenCreate": "Vận Hành — 🏬 Tạo Đề Xuất Mở Mới Siêu Thị (+ Toàn Quyền Trên Hồ Sơ Của Mình)",
  "operationStoreReportView": "Vận Hành — 📊 Xem Báo Cáo QLDA/Siêu Thị (Mở Mới + Sửa Chữa)",
  "orgChartManage": "Nhân Sự — 🌳 Quản Lý Cơ Cấu Tổ Chức",
  "paymentConfirm": "Thanh Toán — ✅ Xác nhận thanh toán (toàn công ty)",
  "paymentManage": "Thanh Toán — 💰 Quản lý Thanh Toán (toàn công ty)",
  "rebateApprove": "Mua Hàng > BAS — ✅ Phê Duyệt (dự phòng Giai đoạn 2 — Sổ Cái)",
  "rebateReconcile": "Mua Hàng > BAS — 🔄 Đối Chiếu (dự phòng Giai đoạn 2 — Sổ Cái)",
  "rebateTermActivate": "Mua Hàng > BAS — ▶️ Kích Hoạt Điều Khoản (tách biệt khỏi Quản Lý)",
  "rebateTermManage": "Mua Hàng > BAS — 🛠️ Quản Lý NCC & Điều Khoản (tạo/sửa/nhân bản/lưu trữ/đồng bộ DSmart/tính ước tính)",
  "rebateViewReport": "Mua Hàng > BAS — 📊 Xem Báo Cáo Mua Hàng (tab Báo Cáo trong module này — cũng là điều kiện đủ để vào được module)",
  "reportAggregate": "Báo Cáo Định Kỳ — ✅ Tổng hợp báo cáo (chọn, merge, sửa, phát hành)",
  "reportEntryCreate": "Báo Cáo Định Kỳ — ✅ Nộp báo cáo (đúng phòng ban mình)",
  "reportManage": "Báo Cáo Định Kỳ — ✅ Quản lý kỳ báo cáo (tạo/đóng kỳ sớm)",
  "reportViewAll": "Nghiệp Vụ & Báo Cáo — 👁️ Xem Toàn Bộ Tab Báo Cáo (bỏ qua giới hạn theo quyền module)",
  "submissionCreate.all": "Văn Bản Trình — Tạo mới",
  "submissionDownload.all": "Văn Bản Trình — Tải xuống",
  "taskDelete": "Biên Bản Họp & 📋 Công Việc — 🗑️ Xóa tất cả công việc",
  "taskDownload": "Biên Bản Họp & 📋 Công Việc — ⬇️ Tải phiếu giao việc",
  "taskEdit": "Biên Bản Họp & 📋 Công Việc — ✏️ Tạo mới & Sửa tất cả công việc",
  "taskView": "Biên Bản Họp & 📋 Công Việc — 👁️ Xem tất cả công việc",
  "trainingInstruct": "Đào Tạo — 👨‍🏫 Giảng viên (theo lớp được gán)",
  "trainingManage": "Đào Tạo — 🎓 Quản lý Đào Tạo (toàn quyền)",
  "uniformApprove": "Đồng Phục — ✔️ Duyệt Kỳ Cấp Phát / Điều Chuyển Kho",
  "uniformManage": "Đồng Phục — 📦 Hành Chính (tạo kỳ cấp phát, phân bổ xuống siêu thị)",
  "uniformStoreManage": "Đồng Phục — ✅ Giám Đốc Siêu Thị (xác nhận nhận, cấp phát, báo Hỏng/Hủy, thu hồi từ nhân viên)",
  "uploadAll": "Tài Liệu — Tải lên",
  "vppManage": "Văn Phòng Phẩm — ✅ Quản lý (tạo/kết thúc kỳ, báo cáo tổng hợp)",
  "vppRegisterCreate": "Văn Phòng Phẩm — 📝 Người đăng ký (uỷ quyền đăng ký cho phòng mình)",
  "vppReportView": "Văn Phòng Phẩm — 📊 Xem Báo Cáo (không kèm quyền cấu hình Kỳ Đăng Ký)"
};
// Chiều ngược lại (nhãn -> khoá) để đọc lại đúng cột khi import — cùng 1 bảng tĩnh ở trên nên LUÔN khớp
// chính xác với bất kỳ nhãn nào ma trận từng xuất ra (không cần dò mờ/so khớp gần đúng).
const PERM_VN_LABEL_TO_KEY = Object.fromEntries(Object.entries(PERM_KEY_VN_LABELS).map(([k, v]) => [v, k]));
// Tên cột hiện ra cho 1 khoá quyền khi xuất Excel — có nhãn tiếng Việt thì dùng nhãn đó, không có (quyền
// hiếm/đã lỗi thời, xem chú thích PERM_KEY_VN_LABELS) thì vẫn dùng dạng "Q_<khoá>" cũ, không mất cột.
function permMatrixColumnHeader(key) {
  return PERM_KEY_VN_LABELS[key] || (PERM_MATRIX_COL_PREFIX + key);
}
// Ngược lại — từ 1 tên cột Excel (nhãn tiếng Việt HOẶC dạng "Q_<khoá>" cũ, để đọc được cả file xuất từ
// bản trước) suy ra đúng khoá quyền dot-path; trả về null nếu không phải cột quyền (VD Username/HoTen).
function resolvePermMatrixColumnKey(header) {
  if (Object.prototype.hasOwnProperty.call(PERM_VN_LABEL_TO_KEY, header)) return PERM_VN_LABEL_TO_KEY[header];
  if (header.startsWith(PERM_MATRIX_COL_PREFIX)) return header.slice(PERM_MATRIX_COL_PREFIX.length);
  return null;
}

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

// Tên sheet cho quyền chưa có nhãn tiếng Việt (vẫn hiện cột dạng Q_<khoá> cũ, xem permMatrixColumnHeader())
// — gom hết vào 1 sheet riêng thay vì lỗi/rải rác khi không tách được theo tiền tố " — ".
const PERM_MATRIX_UNLABELED_SHEET = 'Khác (chưa có nhãn)';

// permMatrixColumnGroup(key) — suy ra tên "khối quyền" (= tên sheet khi xuất, 10/2026) từ đúng phần đầu
// nhãn tiếng Việt (PERM_KEY_VN_LABELS, khuôn "<Tên khối> — <mô tả>" áp dụng nhất quán cho toàn bộ quyền
// đã có nhãn) — tái dùng thẳng bảng nhãn có sẵn, KHÔNG dựng thêm 1 bảng ánh xạ khoá->khối riêng (sẽ lệch
// dần với cây quyền thật y hệt lý do PERM_KEY_VN_LABELS được trích xuất bằng script thay vì gõ tay).
function permMatrixColumnGroup(key) {
  const label = PERM_KEY_VN_LABELS[key];
  if (!label) return PERM_MATRIX_UNLABELED_SHEET;
  const sepIdx = label.indexOf(' — ');
  return sepIdx === -1 ? PERM_MATRIX_UNLABELED_SHEET : label.slice(0, sepIdx);
}

// buildPermMatrixSheets(cols, identityColumns, entities, identityRowFn, entityPerms) — dùng chung cho cả
// downloadPermMatrixUsers()/downloadPermMatrixGroups(): tách `cols` (danh sách khoá quyền boolean) thành
// nhiều sheet theo permMatrixColumnGroup(), mỗi sheet = identityColumns (LẶP LẠI ở MỌI sheet theo yêu cầu
// người dùng — mở riêng sheet nào cũng biết đang xem quyền của ai) + đúng phần cột quyền của khối đó.
function buildPermMatrixSheets(cols, identityColumns, entities, identityRowFn, entityPerms) {
  const groups = new Map(); // tên khối -> mảng khoá quyền thuộc khối đó
  cols.forEach(c => {
    const g = permMatrixColumnGroup(c);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  });
  // Sắp xếp ổn định theo tên khối (bảng chữ cái), đẩy sheet "Khác (chưa có nhãn)" xuống cuối cùng.
  const groupNames = [...groups.keys()].sort((a, b) => {
    if (a === PERM_MATRIX_UNLABELED_SHEET) return 1;
    if (b === PERM_MATRIX_UNLABELED_SHEET) return -1;
    return a.localeCompare(b, 'vi');
  });

  const flatByEntity = entities.map(e => flattenPermsForMatrix(entityPerms(e) || {}));

  return groupNames.map(groupName => {
    const groupCols = groups.get(groupName);
    const columns = [...identityColumns, ...groupCols.map(c => ({ header: permMatrixColumnHeader(c), key: PERM_MATRIX_COL_PREFIX + c, width: 24 }))];
    const rows = entities.map((e, idx) => {
      const row = identityRowFn(e);
      groupCols.forEach(c => { row[PERM_MATRIX_COL_PREFIX + c] = flatByEntity[idx][c] === true ? 'Y' : 'N'; });
      return row;
    });
    return { sheetName: groupName, columns, rows };
  });
}

function downloadPermMatrixUsers() {
  const cols = collectPermMatrixColumns(DB.users.map(u => u.perms || {}));
  const identityColumns = [
    { header: 'Username', key: 'Username', width: 16 },
    { header: 'HoTen', key: 'HoTen', width: 22 },
    { header: 'PhongBan', key: 'PhongBan', width: 20 },
    { header: 'NhomPhanQuyen', key: 'NhomPhanQuyen', width: 26 },
    { header: 'BaoCao_MucBoSung', key: 'BaoCao_MucBoSung', width: 26 }
  ];
  const identityRow = (u) => ({
    Username: u.username,
    HoTen: u.name || '',
    PhongBan: u.dept || '',
    NhomPhanQuyen: (u.groupIds || []).map(gid => DB.permGroups.find(g => g.id === gid)?.name).filter(Boolean).join(PERM_MATRIX_MULTI_SEP),
    BaoCao_MucBoSung: (u.reportExtraKeys || []).join(PERM_MATRIX_MULTI_SEP)
  });
  const sheets = buildPermMatrixSheets(cols, identityColumns, DB.users, identityRow, u => u.perms);
  downloadMultiSheetXlsxFromServer('ma_tran_phan_quyen_nguoi_dung.xlsx', sheets);
}

function downloadPermMatrixGroups() {
  const cols = collectPermMatrixColumns(DB.permGroups.map(g => g.perms || {}));
  const identityColumns = [
    { header: 'TenNhom', key: 'TenNhom', width: 22 },
    { header: 'MoTa', key: 'MoTa', width: 26 },
    { header: 'BaoCao_MucBoSung', key: 'BaoCao_MucBoSung', width: 26 }
  ];
  const identityRow = (g) => ({
    TenNhom: g.name,
    MoTa: g.description || '',
    BaoCao_MucBoSung: (g.reportExtraKeys || []).join(PERM_MATRIX_MULTI_SEP)
  });
  const sheets = buildPermMatrixSheets(cols, identityColumns, DB.permGroups, identityRow, g => g.perms);
  downloadMultiSheetXlsxFromServer('ma_tran_phan_quyen_nhom.xlsx', sheets);
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
  const unrecognizedCells = [];
  Object.keys(row).forEach(header => {
    const path = resolvePermMatrixColumnKey(header);
    if (path == null) return;
    // Chấp nhận cả 'Y' (chuẩn mới, xem buildPermMatrixSheets()) lẫn 'TRUE' (file export từ bản cũ trước
    // khi đổi sang Y/N) để không làm hỏng việc nhập lại các file người dùng đã tải về trước đó. Ô trống
    // hợp lệ hiểu là N (không tick). Bất kỳ giá trị nào KHÁC 5 dạng này (gõ nhầm "x"/"Có"/"yes"...) vẫn
    // được coi an toàn là N (không tự bật quyền từ giá trị lạ) NHƯNG phải gắn cờ cảnh báo để hiện rõ ở
    // bảng xem trước — trước đây bị âm thầm quy thành N không có cảnh báo gì, dễ khiến admin tưởng nhầm
    // đã tick "Y" trong khi gõ sai chính tả, vô tình tắt quyền mà không hay biết (theo yêu cầu người dùng
    // "đảm bảo không bị lỗi khi import file phân quyền", 9/2026).
    const rawVal = String(row[header] || '').trim().toUpperCase();
    const newVal = rawVal === 'Y' || rawVal === 'TRUE';
    if (rawVal && rawVal !== 'Y' && rawVal !== 'N' && rawVal !== 'TRUE' && rawVal !== 'FALSE') {
      unrecognizedCells.push({ header, raw: row[header] });
    }
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
    const path = resolvePermMatrixColumnKey(header);
    if (path == null) return;
    const oldVal = flatOld[path] === true;
    const finalVal = flatNew[path] === true;
    if (finalVal !== oldVal) changes.push({ label: `Quyền: ${PERM_KEY_VN_LABELS[path] || path}`, oldValue: oldVal ? 'Y' : 'N', newValue: finalVal ? 'Y' : 'N' });
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

  return { changes, newPerms, newPermOverrides, newGroupIds, newReportExtraKeys, unrecognizedCells };
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
    // Dòng có ô giá trị lạ (không phải Y/N/TRUE/FALSE/trống) KHÔNG được tự tick sẵn — bắt admin phải đọc
    // rõ cảnh báo ở bảng xem trước rồi tự quyết định trước khi áp dụng, tránh vô tình tắt nhầm quyền chỉ
    // vì gõ sai chính tả trong Excel (xem chú thích ở buildPermMatrixRowChanges()).
    const hasUnrecognized = !!diff?.unrecognizedCells?.length;
    return {
      _idx: idx, identifier, found: !!target, duplicateInFile: !!r.duplicateInFile, diff, isProtectedAdmin,
      include: !isProtectedAdmin && !!target && !r.duplicateInFile && !!diff?.changes.length && !hasUnrecognized,
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
    const unrecognized = it.diff?.unrecognizedCells || [];
    let note;
    if (it.isProtectedAdmin) note = '⛔ Tài khoản admin gốc luôn giữ toàn quyền — bỏ qua';
    else if (!it.found) note = `⛔ Không tìm thấy ${idLabel} này trong hệ thống`;
    else if (it.duplicateInFile) note = '⚠️ Trùng dòng khác trong file này';
    else if (!changeCount) note = 'Không có thay đổi';
    else note = `${changeCount} thay đổi`;
    if (unrecognized.length) note += `<br><span class="text-red-600">⚠️ ${unrecognized.length} ô giá trị lạ (coi là N) — tự kiểm tra kỹ trước khi tick áp dụng</span>`;
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

  const savedGroups = permMatrixImportKind === 'groups' ? await syncStorage('permGroups', { baseline: groupsSnapshot }) : true;
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

// ==========================================
// MA TRẬN PHÂN QUYỀN — SỬA NHANH TRÊN WEB (10/2026, theo yêu cầu người dùng: "phải vào từng module mở
// ra... có cách chọn dạng bảng nhanh hơn không, gọn và trực quan hơn"). Tái dùng NGUYÊN VẸN toàn bộ hạ
// tầng Ma Trận đã có ở TRÊN (collectPermMatrixColumns()/permMatrixColumnGroup()/PERM_KEY_VN_LABELS/
// buildPermMatrixRowChanges()) — CHỈ khác nguồn "row" đọc trực tiếp từ checkbox trên trang thay vì đọc
// từ file Excel đã upload. KHÔNG sửa/đụng tới bất kỳ hàm Excel hiện có nào ở trên (downloadPermMatrixUsers/
// Groups, onPermMatrixImportFileChange, confirmPermMatrixImport...) — 2 đường hoàn toàn độc lập, chỉ dùng
// CHUNG tầng đọc/diff (buildPermMatrixRowChanges), khác hẳn tầng nguồn dữ liệu + tầng ghi, nên không có
// rủi ro sửa đường này làm hỏng đường Excel đang hoạt động.
//
// PHẠM VI CỐ Ý THU HẸP so với Excel: chỉ tick được các cột quyền BOOLEAN thuộc ĐÚNG 1 "khối" quyền đang
// chọn (permMatrixColumnGroup()) tại 1 thời điểm — KHÔNG đổi Nhóm Phân Quyền/Báo Cáo-Mục Bổ Sung qua bảng
// này (2 việc đó vẫn làm qua form Sửa Người Dùng/Nhóm hoặc Excel như cũ). Giữ bảng đủ gọn để hiện hết
// trên 1 màn hình, đúng tinh thần "gọn, trực quan" — không cố nhồi hết ~130-150 cột vào 1 bảng.
let pmQuickEditKind = 'users'; // 'users' | 'groups'
let pmQuickEditGroupKey = null; // tên "khối" quyền đang chọn (permMatrixColumnGroup())

function pmQuickEditEntities() {
  return pmQuickEditKind === 'users' ? DB.users : DB.permGroups;
}

function pmQuickEditAllGroupNames() {
  const entities = pmQuickEditEntities();
  const cols = collectPermMatrixColumns(entities.map(e => e.perms || {}));
  const names = new Set();
  cols.forEach(c => names.add(permMatrixColumnGroup(c)));
  return [...names].sort((a, b) => {
    if (a === PERM_MATRIX_UNLABELED_SHEET) return 1;
    if (b === PERM_MATRIX_UNLABELED_SHEET) return -1;
    return a.localeCompare(b, 'vi');
  });
}

function togglePermMatrixQuickEdit() {
  const wrap = document.getElementById('permMatrixQuickEditWrap');
  if (!wrap) return;
  const willShow = wrap.classList.contains('hidden');
  wrap.classList.toggle('hidden');
  if (!willShow) return;
  pmQuickEditKind = 'users';
  const kindUsersCb = document.getElementById('pmQuickEditKindUsers');
  if (kindUsersCb) kindUsersCb.checked = true;
  pmQuickEditGroupKey = null;
  renderPmQuickEditGroupSelect();
  renderPmQuickEditPicker();
  renderPmQuickEditTable();
}

function setPmQuickEditKind(kind) {
  pmQuickEditKind = kind === 'groups' ? 'groups' : 'users';
  pmQuickEditGroupKey = null;
  renderPmQuickEditGroupSelect();
  renderPmQuickEditPicker();
  renderPmQuickEditTable();
}

// Ô chọn người/nhóm (10/2026, theo phản ánh người dùng "chuyển thành dropdown + searchable + multi
// choice ... phân quyền ma trận thay vì từng người một") — tái dùng NGUYÊN renderMultiSelectDropdown()
// (core.js, cùng widget đang dùng cho renderUserBulkPeoplePicker() ở khối "Gán/Gỡ Nhóm Hàng Loạt" ngay
// dưới file này) thay cho ô gõ chữ lọc cũ (so khớp chuỗi con, không "ghim" được danh sách cụ thể).
// Đọc lại lựa chọn hiện có (nếu widget đã khởi tạo từ trước) để KHÔNG mất lựa chọn khi đổi "Khối quyền"
// (renderPmQuickEditTable() gọi lại mỗi lần đổi khối, không đụng tới picker) — chỉ loại bỏ đúng những
// giá trị không còn hợp lệ (VD đổi "Người Dùng" <-> "Nhóm Phân Quyền", 2 tập giá trị khác hẳn nhau).
function renderPmQuickEditPicker() {
  const containerId = 'pmQuickEditPicker';
  const container = document.getElementById(containerId);
  if (!container) return;
  const prevSelected = container._gmsSelected ? [...container._gmsSelected] : [];
  const entities = pmQuickEditEntities();
  const items = pmQuickEditKind === 'users'
    ? entities.filter(e => e.username !== 'admin').map(e => ({ value: e.username, label: `${e.name} (${e.username}) — ${e.dept || ''}` }))
    : entities.map(e => ({ value: e.name, label: e.description ? `${e.name} — ${e.description}` : e.name }));
  const validSelected = prevSelected.filter(key => items.some(it => it.value === key));
  renderMultiSelectDropdown(containerId, items, validSelected, {
    placeholder: pmQuickEditKind === 'users'
      ? '🔍 Gõ tên/username/phòng ban để thêm người (để trống = hiện tất cả)...'
      : '🔍 Gõ tên nhóm để thêm (để trống = hiện tất cả)...',
    emptyText: 'Chưa chọn ai — bảng dưới đang hiện tất cả.',
    onChange: () => renderPmQuickEditTable()
  });
}

function renderPmQuickEditGroupSelect() {
  const sel = document.getElementById('pmQuickEditGroupSelect');
  if (!sel) return;
  const groupNames = pmQuickEditAllGroupNames();
  if (!pmQuickEditGroupKey || !groupNames.includes(pmQuickEditGroupKey)) pmQuickEditGroupKey = groupNames[0] || null;
  sel.innerHTML = groupNames.length
    ? groupNames.map(g => `<option value="${escapeHtml(g)}" ${g === pmQuickEditGroupKey ? 'selected' : ''}>${escapeHtml(g)}</option>`).join('')
    : '<option value="">-- Chưa có quyền nào --</option>';
}

function onPmQuickEditGroupChange() {
  pmQuickEditGroupKey = document.getElementById('pmQuickEditGroupSelect')?.value || null;
  renderPmQuickEditTable();
}

// Cột quyền thuộc ĐÚNG khối đang chọn, sắp theo bảng chữ cái nhãn để dễ dò.
function pmQuickEditColumnsForGroup() {
  if (!pmQuickEditGroupKey) return [];
  const entities = pmQuickEditEntities();
  const cols = collectPermMatrixColumns(entities.map(e => e.perms || {}));
  return cols.filter(c => permMatrixColumnGroup(c) === pmQuickEditGroupKey)
    .sort((a, b) => permMatrixColumnHeader(a).localeCompare(permMatrixColumnHeader(b), 'vi'));
}

// Header NGANG (10/2026, theo yêu cầu người dùng "quy ngang cho dễ nhìn" thay vì xoay dọc
// writing-mode:vertical-rl trước đây) — mọi cột trong bảng đang hiện đều CÙNG 1 khối quyền
// (pmQuickEditGroupKey) nên tiền tố "<Tên khối> — " ở đầu nhãn là thừa, bỏ đi để text ngắn lại
// đáng kể (VD "Báo Cáo Định Kỳ — Tổng hợp báo cáo..." -> chỉ còn "Tổng hợp báo cáo..."), giúp cột
// đủ hẹp để hiện ngang mà vẫn đọc được, không cần xoay chữ.
function pmQuickEditColumnShortLabel(key) {
  const full = permMatrixColumnHeader(key);
  const prefix = `${pmQuickEditGroupKey} — `;
  return full.startsWith(prefix) ? full.slice(prefix.length) : full;
}

function renderPmQuickEditTable() {
  const thead = document.getElementById('pmQuickEditTableHead');
  const tbody = document.getElementById('pmQuickEditTableBody');
  const status = document.getElementById('pmQuickEditStatus');
  if (!thead || !tbody) return;
  const cols = pmQuickEditColumnsForGroup();
  if (!pmQuickEditGroupKey || !cols.length) {
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td class="p-2 text-gray-400 italic">Chưa có quyền dạng bật/tắt nào để sửa nhanh.</td></tr>`;
    if (status) status.innerText = '';
    return;
  }
  // Ô chọn người/nhóm (renderPmQuickEditPicker()) thay cho ô gõ chữ lọc cũ — KHÔNG chọn ai (mảng rỗng)
  // = hiện TẤT CẢ như hành vi gốc, chọn cụ thể ai thì bảng chỉ còn đúng những người đó, ĐÚNG thứ tự đã
  // bấm chọn (không phải thứ tự gốc trong DB.users/DB.permGroups) để dễ đối chiếu với chip đang hiện.
  const selectedKeys = getMultiSelectValues('pmQuickEditPicker');
  const allEntities = pmQuickEditEntities();
  const entities = selectedKeys.length
    ? selectedKeys.map(key => allEntities.find(e => (pmQuickEditKind === 'users' ? e.username : e.name) === key)).filter(Boolean)
    : allEntities;

  // Nút ✓/✗ đầu mỗi cột (10/2026, theo yêu cầu người dùng "phân quyền ma trận thay vì từng người một") —
  // bật/tắt 1 quyền cho TOÀN BỘ người đang hiện trong bảng (đã thu hẹp qua ô chọn ở trên, nếu có) chỉ
  // bằng 1 click, xem togglePmQuickEditColumn() — chỉ đổi checkbox trên DOM, vẫn phải bấm "💾 Lưu Thay
  // Đổi" như cũ để ghi thật xuống server (savePmQuickEdit() không đổi gì, vẫn đọc nguyên bộ checkbox này).
  thead.innerHTML = `<tr class="bg-gray-100 text-left">
    <th class="border p-1.5 sticky left-0 top-0 bg-gray-100 z-20">${pmQuickEditKind === 'users' ? 'Người Dùng' : 'Nhóm'}</th>
    ${cols.map(c => `<th class="border p-1 text-center align-top text-[11px] leading-tight sticky top-0 bg-gray-100 z-10 min-w-[110px] max-w-[170px]">
      <button type="button" data-op="togglePmQuickEditColumn" data-arg0="${escapeHtml(c)}" class="block w-full text-[11px] leading-none mb-1 px-1 py-0.5 rounded border border-purple-200 bg-white hover:bg-purple-100 font-bold text-purple-700" title="Bật/tắt quyền này cho toàn bộ người đang hiện trong bảng">✓/✗ tất cả</button>
      ${escapeHtml(pmQuickEditColumnShortLabel(c))}</th>`).join('')}
  </tr>`;

  if (!entities.length) {
    tbody.innerHTML = `<tr><td class="p-2 text-gray-400 italic" colspan="${cols.length + 1}">Không có ${pmQuickEditKind === 'users' ? 'người dùng' : 'nhóm'} nào trong lựa chọn hiện tại.</td></tr>`;
  } else {
    const flatByEntity = entities.map(e => flattenPermsForMatrix(e.perms || {}));
    tbody.innerHTML = entities.map((e, idx) => {
      const isProtectedAdmin = pmQuickEditKind === 'users' && e.username === 'admin';
      const entityKey = pmQuickEditKind === 'users' ? e.username : e.name;
      const label = pmQuickEditKind === 'users'
        ? `<span class="font-mono font-bold text-purple-700">${escapeHtml(e.username)}</span><br><span class="text-gray-500">${escapeHtml(e.name || '')}</span>`
        : `<span class="font-bold">${escapeHtml(e.name)}</span>`;
      return `<tr class="border-t hover:bg-gray-50${isProtectedAdmin ? ' bg-gray-50 opacity-50' : ''}">
        <td class="border p-1.5 sticky left-0 bg-white whitespace-nowrap">${label}${isProtectedAdmin ? '<br><span class="text-[10px] text-gray-400">⛔ Luôn toàn quyền</span>' : ''}</td>
        ${cols.map(c => `<td class="border p-1 text-center"><input type="checkbox" data-pm-quick-cell data-entity="${escapeHtml(entityKey)}" data-key="${escapeHtml(c)}" ${flatByEntity[idx][c] === true ? 'checked' : ''} ${isProtectedAdmin ? 'disabled' : ''}></td>`).join('')}
      </tr>`;
    }).join('');
  }
  if (status) status.innerText = `${entities.length} ${pmQuickEditKind === 'users' ? 'người dùng' : 'nhóm'} × ${cols.length} quyền trong khối "${pmQuickEditGroupKey}"` +
    (selectedKeys.length ? ` — đang thu hẹp theo ${selectedKeys.length} lựa chọn.` : ' (chưa chọn ai = hiện tất cả).');
}

// Bật/tắt 1 quyền cho TOÀN BỘ người đang hiện trong bảng (đã thu hẹp qua renderPmQuickEditPicker() ở
// trên, nếu có) chỉ bằng 1 click — đúng tinh thần "phân quyền ma trận hàng loạt thay vì từng người một"
// người dùng yêu cầu (10/2026). Nếu MỌI ô đang hiện đã tick sẵn thì bỏ tick hết (toggle "tắt cả"), ngược
// lại tick hết (kể cả khi đang ở trạng thái hỗn hợp — ưu tiên "bật cả" để 1 click luôn cho kết quả đồng
// nhất, dễ đoán hơn thay vì tuỳ thuộc ô nào đang hiện trước). CHỈ đổi checkbox trên DOM — cùng 1 bước với
// tick tay từng ô, chưa ghi gì xuống server; vẫn phải bấm "💾 Lưu Thay Đổi" (savePmQuickEdit() đọc lại
// ĐÚNG bộ checkbox này, không cần sửa gì thêm ở đó). Bỏ qua ô "admin" gốc luôn bị disabled (không đổi).
function togglePmQuickEditColumn(colKey) {
  const wrap = document.getElementById('permMatrixQuickEditWrap');
  if (!wrap) return;
  const cells = [...wrap.querySelectorAll('input[data-pm-quick-cell]')].filter(cb => cb.getAttribute('data-key') === colKey && !cb.disabled);
  if (!cells.length) return;
  const allChecked = cells.every(cb => cb.checked);
  cells.forEach(cb => { cb.checked = !allChecked; });
}

// Đọc lại toàn bộ ô đã tick trên bảng đang hiện -> dựng đúng cấu trúc "row" mà buildPermMatrixRowChanges()
// (Excel) đã hiểu sẵn (header tiếng Việt -> 'Y'/'N'), rồi tái dùng NGUYÊN hàm đó để tính diff — không viết
// lại logic diff/merge-nhóm/override 1 lần nữa ở đây (rủi ro lệch với đường Excel nếu viết tay 2 lần).
async function savePmQuickEdit() {
  if (!currentUser?.perms?.admin) return alert('⛔ Chỉ Quản Trị Viên mới được sửa Ma Trận Phân Quyền!');
  const wrap = document.getElementById('permMatrixQuickEditWrap');
  if (!wrap) return;
  const cells = [...wrap.querySelectorAll('input[data-pm-quick-cell]')];
  const byEntity = new Map();
  cells.forEach(cb => {
    const entityKey = cb.getAttribute('data-entity');
    const permKey = cb.getAttribute('data-key');
    if (!byEntity.has(entityKey)) byEntity.set(entityKey, {});
    byEntity.get(entityKey)[permMatrixColumnHeader(permKey)] = cb.checked ? 'Y' : 'N';
  });

  const kind = pmQuickEditKind;
  const entries = [];
  byEntity.forEach((row, entityKey) => {
    const target = kind === 'users' ? DB.users.find(u => u.username === entityKey) : DB.permGroups.find(g => g.name === entityKey);
    if (!target || (kind === 'users' && target.username === 'admin')) return;
    const diff = buildPermMatrixRowChanges(kind, target, row);
    if (diff.changes.length) entries.push({ target, diff });
  });

  if (!entries.length) return alert('Không có thay đổi nào để lưu.');
  const kindLabel = kind === 'users' ? 'người dùng' : 'nhóm phân quyền';
  if (!confirm(`Xác nhận lưu thay đổi quyền cho ${entries.length} ${kindLabel}?`)) return;

  const usersSnapshot = JSON.parse(JSON.stringify(DB.users));
  const groupsSnapshot = JSON.parse(JSON.stringify(DB.permGroups));
  let usersTouched = false;

  if (kind === 'users') {
    entries.forEach(({ target, diff }) => {
      target.perms = diff.newPerms;
      target.permOverrides = diff.newPermOverrides;
      usersTouched = true;
    });
  } else {
    const changedGroupIds = new Set();
    entries.forEach(({ target, diff }) => {
      target.perms = diff.newPerms;
      changedGroupIds.add(target.id);
    });
    // Cùng luật savePermGroup()/confirmPermMatrixImport(): sửa quyền NHÓM phải cập nhật NGAY cho mọi
    // thành viên đang gán, giữ nguyên permOverrides riêng từng người trên nền mới.
    DB.users.forEach(u => {
      if (!(u.groupIds || []).some(gid => changedGroupIds.has(gid))) return;
      const userGroups = (u.groupIds || []).map(gid => DB.permGroups.find(g => g.id === gid)).filter(Boolean);
      if (userGroups.length) { u.perms = mergePerms(mergeGroupsBasePerms(userGroups.map(g => g.perms)), u.permOverrides); usersTouched = true; }
    });
  }

  const savedGroups = kind === 'groups' ? await syncStorage('permGroups', { baseline: groupsSnapshot }) : true;
  const savedUsers = (kind === 'users' || usersTouched) ? await syncStorage('users', { usersBaseline: usersSnapshot }) : true;
  if (!savedGroups || !savedUsers) {
    DB.users = usersSnapshot;
    DB.permGroups = groupsSnapshot;
    renderUsers();
    renderPermGroupsList();
    renderPmQuickEditTable();
    return;
  }
  logSystemAction('USER_MGM', 'QUICK_EDIT_PERM_MATRIX', `Sửa nhanh Ma Trận Phân Quyền trên web (${kindLabel}, khối "${pmQuickEditGroupKey}") — ${entries.length} thay đổi`, 'SUCCESS');
  alert(`✅ Đã lưu thay đổi cho ${entries.length} ${kindLabel}!`);
  renderUsers();
  renderPermGroupsList();
  renderPmQuickEditTable();
}

// ==========================================
// GÁN/GỠ NHÓM PHÂN QUYỀN HÀNG LOẠT từ danh sách Người Dùng (10/2026, theo yêu cầu người dùng "chọn
// nhiều người rồi gán nhóm 1 lần" thay vì phải mở form từng người) — tái dùng ĐÚNG công thức
// savePermGroup() dùng cho việc thêm/bớt thành viên NHÓM (mergeGroupsBasePerms() tính lại quyền nền,
// permOverrides reset khi đổi tập nhóm — xem chú thích tại đó), chỉ khác chiều thao tác: ở đây chọn
// NHIỀU NGƯỜI trước rồi mới chọn 1 NHÓM để áp, còn renderGroupMembersPicker() (màn Sửa Nhóm) chọn 1
// NHÓM trước rồi chọn NHIỀU NGƯỜI.
//
// LỖI ĐÃ VÁ (10/2026, phản ánh người dùng muốn ô "dropdown + searchable + multiple choice") — trước
// đây chọn người bằng tick checkbox TỪNG DÒNG trong bảng Người Dùng có phân trang: đổi trang/gõ lọc
// lại là MẤT HẾT lựa chọn cũ, không chọn được người nằm khác trang cùng lúc. Nay đổi sang ô tìm-kiếm-
// gõ-chọn-nhiều-người (renderMultiSelectDropdown(), core.js — cùng widget đang dùng cho Khối/Chức
// Danh/Vị Trí Tham Gia Quy Trình) — gõ tên/username/phòng ban để tìm, chọn được BẤT KỲ ai trong TOÀN
// BỘ danh sách bất kể đang ở trang/bộ lọc nào, lựa chọn hiện dạng chip, không phụ thuộc bảng bên dưới.
function renderUserBulkPeoplePicker() {
  const containerId = 'userBulkPeoplePicker';
  const container = document.getElementById(containerId);
  if (!container) return;
  // Giữ lại lựa chọn đang có (nếu widget đã khởi tạo từ trước) khi danh sách người dùng đổi (thêm/xoá/
  // import Excel...) — chỉ loại bỏ đúng những username không còn tồn tại nữa, không reset sạch toàn bộ.
  const prevSelected = container._gmsSelected ? [...container._gmsSelected] : [];
  const items = DB.users.filter(u => u.username !== 'admin').map(u => ({ value: u.username, label: `${u.name} (${u.username}) - ${u.dept}` }));
  const validSelected = prevSelected.filter(username => items.some(it => it.value === username));
  renderMultiSelectDropdown(containerId, items, validSelected, {
    placeholder: '🔍 Tìm theo tên/username/phòng ban để chọn người dùng...',
    emptyText: 'Chưa chọn người dùng nào.',
    onChange: onUserBulkPeopleSelectChange
  });
  onUserBulkPeopleSelectChange(validSelected);
}
function onUserBulkPeopleSelectChange(selectedUsernames) {
  const count = (selectedUsernames || []).length;
  const bar = document.getElementById('userBulkActionBar');
  if (bar) bar.classList.toggle('hidden', count === 0);
  const label = document.getElementById('userBulkSelectedCount');
  if (label) label.innerText = String(count);
}
function renderUserBulkGroupSelect() {
  const sel = document.getElementById('userBulkGroupSelect');
  if (!sel) return;
  sel.innerHTML = DB.permGroups.length
    ? DB.permGroups.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('')
    : '<option value="">-- Chưa có nhóm phân quyền nào --</option>';
}

async function applyUserBulkGroupAction(mode) { // mode: 'ADD' | 'REMOVE'
  const usernames = getMultiSelectValues('userBulkPeoplePicker');
  if (!usernames.length) return alert('Chưa chọn người dùng nào.');
  const groupId = document.getElementById('userBulkGroupSelect')?.value;
  const group = DB.permGroups.find(g => g.id === groupId);
  if (!group) return alert('Vui lòng chọn Nhóm Phân Quyền.');

  const targets = DB.users.filter(u => usernames.includes(u.username) && u.username !== 'admin');
  const skippedAdmin = usernames.length !== targets.length;
  if (!targets.length) return alert('Không có người dùng hợp lệ để áp dụng (tài khoản admin gốc luôn được bỏ qua).');

  const actionLabel = mode === 'ADD' ? `gán vào nhóm "${group.name}"` : `gỡ khỏi nhóm "${group.name}"`;
  if (!confirm(`Xác nhận ${actionLabel} cho ${targets.length} người dùng đã chọn?${skippedAdmin ? '\n(Tài khoản admin gốc luôn được bỏ qua.)' : ''}`)) return;

  const usersSnapshot = JSON.parse(JSON.stringify(DB.users));
  let changed = 0;
  targets.forEach(u => {
    const currentGroupIds = u.groupIds || [];
    const isMember = currentGroupIds.includes(group.id);
    if (mode === 'ADD' && isMember) return;
    if (mode === 'REMOVE' && !isMember) return;
    u.groupIds = mode === 'ADD' ? [...currentGroupIds, group.id] : currentGroupIds.filter(gid => gid !== group.id);
    u.permOverrides = null; // đổi tập nhóm -> reset override riêng, khớp đúng luật savePermGroup()
    const userGroups = (u.groupIds || []).map(gid => DB.permGroups.find(g => g.id === gid)).filter(Boolean);
    u.perms = userGroups.length ? mergeGroupsBasePerms(userGroups.map(g => g.perms)) : u.perms;
    changed++;
  });

  if (!changed) return alert('Không có thay đổi nào (tất cả đã ở đúng trạng thái).');

  const savedUsers = await syncStorage('users', { usersBaseline: usersSnapshot });
  if (!savedUsers) { DB.users = usersSnapshot; renderUsers(); return; }
  logSystemAction('USER_MGM', `BULK_${mode}_PERM_GROUP`, `${mode === 'ADD' ? 'Gán' : 'Gỡ'} nhóm phân quyền [${group.name}] hàng loạt — ${changed} người dùng`, 'SUCCESS', group.name);
  alert(`✅ Đã ${mode === 'ADD' ? 'gán' : 'gỡ'} ${changed} người dùng ${mode === 'ADD' ? 'vào' : 'khỏi'} nhóm "${group.name}"!`);
  gmsClear('userBulkPeoplePicker');
  onUserBulkPeopleSelectChange([]);
  renderUsers();
}

