// lib/permGroupMerge.js — tách từ routes/data.js (11/2026, theo yêu cầu TRỰC TIẾP của người dùng: "phân
// quyền theo chức danh", gom tất cả Trưởng Phòng/Giám Đốc/Phó Giám Đốc/Tổng Giám Đốc/Giám Đốc Siêu Thị...
// vào 1 Nhóm Phân Quyền mà KHÔNG phải gắn tay từng người). Tách riêng ra file lib/ (thay vì để nguyên
// trong routes/data.js) để lib/hrProfilePositionAssign.js (điểm ghi "users" DUY NHẤT bỏ qua
// prepareUsersForSave() — xem chú thích ở đó) cũng gọi được ĐÚNG 1 bộ hàm này, không viết lại logic.
'use strict';

// ===== Phần CŨ (nguyên vẹn, chỉ DỜI CHỖ — không đổi hành vi): mergePermsServer()/mergeGroupsBasePermsServer() =====
// Áp phần quyền tuỳ chỉnh riêng (overrides) lên trên nền quyền của nhóm -> quyền hiệu lực thực tế —
// khớp Y HỆT mergePerms() ở public/js/core.js (2 cài đặt độc lập, client không import chung được với
// server). PHẢI giữ giống hệt nếu sửa 1 bên.
function mergePermsServer(basePerms, overrides) {
  return { ...(basePerms || {}), ...(overrides || {}) };
}

const APPROVER_AUTH_LEVEL_RANK_SERVER = { NONE: 0, PASSWORD: 1, PIN: 2, WEBAUTHN: 3 };

// Gộp quyền NỀN của NHIỀU nhóm phân quyền — khớp Y HỆT mergeGroupsBasePerms() ở public/js/core.js
// (2 cài đặt độc lập, PHẢI giữ giống hệt nếu sửa 1 bên). Kết hợp theo kiểu dữ liệu từng trường: boolean
// OR, scope {all,depts} hợp (union), approverAuthLevel lấy mức CAO NHẤT trong các nhóm.
const DEPRECATED_PERM_KEYS = new Set(['submissionView', 'contractView', 'carView', 'officeView']);
function mergeGroupsBasePermsServer(groupsPerms) {
  const list = (groupsPerms || []).filter(Boolean);
  if (!list.length) return {};
  const keys = new Set();
  list.forEach(p => Object.keys(p || {}).forEach(k => keys.add(k)));
  DEPRECATED_PERM_KEYS.forEach(k => keys.delete(k));
  const result = {};
  keys.forEach(key => {
    const values = list.map(p => p?.[key]);
    if (key === 'approverAuthLevel') {
      result[key] = values.reduce((best, v) =>
        (APPROVER_AUTH_LEVEL_RANK_SERVER[v] || 0) > (APPROVER_AUTH_LEVEL_RANK_SERVER[best] || 0) ? v : best, 'NONE');
      return;
    }
    if (key === 'moduleAccess') {
      const subKeys = new Set();
      values.forEach(v => { if (v && typeof v === 'object') Object.keys(v).forEach(k => subKeys.add(k)); });
      const merged = {};
      subKeys.forEach(k => {
        merged[k] = values.some(v => (v && typeof v === 'object') ? v[k] !== false : true);
      });
      result[key] = merged;
      return;
    }
    const sample = values.find(v => v !== undefined && v !== null);
    if (typeof sample === 'boolean') {
      result[key] = values.some(v => v === true);
    } else if (sample && typeof sample === 'object' && !Array.isArray(sample) && ('all' in sample || 'depts' in sample)) {
      result[key] = { all: values.some(v => v?.all === true), depts: [...new Set(values.flatMap(v => v?.depts || []))] };
    } else if (Array.isArray(sample)) {
      result[key] = [...new Set(values.flatMap(v => Array.isArray(v) ? v : []))];
    } else {
      result[key] = values[values.length - 1];
    }
  });
  return result;
}

// ===== Phần MỚI: khớp Nhóm Phân Quyền theo CHỨC DANH (permGroup.jobTitles[]) =====
// `permGroup.jobTitles` — mảng chuỗi chức danh THÔ (VD ["Trưởng Phòng","Giám Đốc","Giám Đốc Siêu
// Thị"]), admin chọn tay qua picker ở màn Nhóm Phân Quyền (module-admin-permgroups.js). KHÔNG phân biệt
// phòng ban/siêu thị/HO — đúng yêu cầu người dùng "gom TẤT CẢ người giữ đúng chức danh đó, bất kể làm ở
// đâu". So khớp CHUỖI THÔ với jobTitle CHÍNH (u.jobTitle) HOẶC bất kỳ "Vị Trí Kiêm Nhiệm"
// (u.secondaryPositions[].jobTitle) — cùng cách các cơ chế "Theo vị trí"/mode JOBTITLE khác trong hệ
// thống đã xét kiêm nhiệm (lib/positionApprovers.js, lib/workflowEngine.js).
function userMatchesPermGroupJobTitles(user, jobTitles) {
  if (!user || !Array.isArray(jobTitles) || !jobTitles.length) return false;
  const set = new Set(jobTitles);
  if (user.jobTitle && set.has(user.jobTitle)) return true;
  return (user.secondaryPositions || []).some(p => p && set.has(p.jobTitle));
}

// ID các nhóm user TỰ ĐỘNG khớp theo chức danh (KHÔNG phải nhóm gán tay qua u.groupIds) — dùng để HỢP
// (union) thêm vào groupIds tường minh ngay tại điểm TÍNH quyền hiệu lực. KHÔNG BAO GIỜ ghi các id này
// ngược lại vào u.groupIds (field đó giữ nguyên nghĩa "gán tay tường minh", được đọc/sửa trực tiếp ở
// hàng chục chỗ phía client — xem renderGroupMembersPicker()/savePermGroup() ở module-admin-permgroups.js).
function computeAutoMatchedGroupIds(user, permGroups) {
  return (permGroups || [])
    .filter(g => g && userMatchesPermGroupJobTitles(user, g.jobTitles))
    .map(g => g.id);
}

// Tính lại {groupIds (tường minh, KHÔNG đổi), jobTitleGroupIds (cache server-managed — id các nhóm user
// ĐANG khớp theo chức danh TẠI LẦN TÍNH NÀY, xem lý do bên dưới), perms (hiệu lực, = quyền nền của
// groupIds tường minh HỢP groupIds khớp chức danh + permOverrides)} cho 1 user — DÙNG CHUNG cho MỌI điểm
// ghi "users" có thể làm thay đổi jobTitle/secondaryPositions/groupIds/permOverrides/permGroups:
// - prepareUsersForSave() (routes/data.js — mọi lượt lưu "users" qua form Sửa tay/Nhập Excel/Đặt Lại
//   Mật Khẩu Hàng Loạt).
// - syncUsersWithPermGroupsChange() (routes/data.js — mọi lượt lưu "permGroups", kể cả KHÔNG đụng tới
//   "users" trong cùng request, VD admin chỉ sửa tiêu chí jobTitles của 1 nhóm).
// - assignPositionToProfile() (lib/hrProfilePositionAssign.js — "Gán Chức Vụ"/Nhập Excel Gán Chức Vụ
//   hàng loạt, điểm ghi TRỰC TIẾP collection "users" DUY NHẤT bỏ qua prepareUsersForSave(), xem chú
//   thích đầy đủ ở đó — ĐÂY CHÍNH LÀ nơi jobTitle thực sự đổi cho 1 nhân viên, nên PHẢI gọi hàm này
//   ngay sau khi set jobTitle mới, nếu không quyền theo-chức-danh sẽ không bao giờ tự cập nhật).
// Tài khoản "admin" mặc định KHÔNG đi qua hàm này (luôn ép cứng perms:{admin:true}, groupIds:[] ở
// chính điểm gọi — xem isProtectedAdminRecord ở prepareUsersForSave()).
//
// `jobTitleGroupIds` LÝ DO cần lưu lại (KHÔNG thể suy luận lại từ hư không mỗi lần): nếu 1 user hiện
// KHÔNG còn khớp chức danh nhóm nào (autoGroupIds rỗng) VÀ KHÔNG có groupIds tường minh, ta KHÔNG THỂ
// phân biệt 2 trường hợp chỉ nhìn vào bản ghi hiện tại — "user này CHƯA BAO GIỜ liên quan gì tới nhóm
// phân quyền nào" (phải GIỮ NGUYÊN perms tuỳ chỉnh riêng hiện có, hành vi CŨ) hay "user này VỪA MỚI MẤT
// khớp chức danh nhóm nào đó (chức danh đổi, hoặc nhóm vừa gỡ tiêu chí)" (PHẢI reset perms về {} + áp lại
// permOverrides, không được giữ quyền "thừa kế" từ nhóm cũ không còn áp dụng nữa). `jobTitleGroupIds`
// (cache nhóm khớp TẠI LẦN TÍNH TRƯỚC, server tự ghi, KHÔNG BAO GIỜ tin giá trị client gửi) là tín hiệu
// phân biệt 2 trường hợp đó — khác "treo" (xem syncUsersWithPermGroupsChange()), đây không cần user tự
// soạn request mới xảy ra lỗi: CHỈ CẦN admin bớt 1 chức danh khỏi tiêu chí nhóm là đủ kích hoạt.
function recomputeEffectivePerms(user, permGroups) {
  const explicitGroupIds = user.groupIds || (user.groupId ? [user.groupId] : []);
  const autoGroupIds = computeAutoMatchedGroupIds(user, permGroups);
  const effectiveGroupIds = [...new Set([...explicitGroupIds, ...autoGroupIds])];
  const hadAnyGroupBefore = explicitGroupIds.length > 0 || (user.jobTitleGroupIds || []).length > 0;
  if (!effectiveGroupIds.length && !hadAnyGroupBefore) {
    return { groupIds: explicitGroupIds, jobTitleGroupIds: autoGroupIds, perms: user.perms };
  }
  const permGroupsById = new Map((permGroups || []).map(g => [g.id, g.perms]));
  const groupsPerms = effectiveGroupIds.map(id => permGroupsById.get(id)).filter(Boolean);
  return {
    groupIds: explicitGroupIds,
    jobTitleGroupIds: autoGroupIds,
    perms: mergePermsServer(mergeGroupsBasePermsServer(groupsPerms), user.permOverrides)
  };
}

// Sanitize permGroup.jobTitles khi ghi collection "permGroups" (điểm ghi DUY NHẤT, xem routes/data.js) —
// cùng mức độ nhẹ với sanitizeSecondaryPositions()/sanitizeExtraKeys() (routes/data.js): không cần đối
// chiếu whitelist đúng chức danh thật đang có trong danh mục (chức danh lạ/đã đổi tên chỉ đơn giản không
// khớp ai, không mở ra rủi ro gì — cùng triết lý sanitizeExtraKeys()), chỉ chặn kiểu dữ liệu rác.
function sanitizePermGroupJobTitles(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim().slice(0, 200)))].slice(0, 200);
}

module.exports = {
  mergePermsServer,
  mergeGroupsBasePermsServer,
  userMatchesPermGroupJobTitles,
  computeAutoMatchedGroupIds,
  recomputeEffectivePerms,
  sanitizePermGroupJobTitles
};
