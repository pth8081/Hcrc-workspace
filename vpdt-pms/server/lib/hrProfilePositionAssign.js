// lib/hrProfilePositionAssign.js — assignPositionToProfile() (10/2026, theo yêu cầu người dùng: di trú
// 500 nhân viên, cần "Gán Chức Vụ hàng loạt qua Excel" để điền nốt Cấp Bậc + chuỗi Quản Lý Trực Tiếp,
// 2 trường DUY NHẤT còn lại trong 84 trường chưa có đường nhập hàng loạt) — TÁCH NGUYÊN VẸN (copy,
// KHÔNG đổi hành vi) từ routes/employeeProfile.js::POST /by-code/:employeeCode/set-position, để route
// đó VÀ route nhập Excel hàng loạt mới (routes/employeeProfile.js POST /position-assign-apply) đều gọi
// ĐÚNG 1 hàm, không viết lại business rule nào (applyPositionAssignment(), lib/employeeProfile.js).
//
// LỖI ĐÃ VÁ — NGỪNG ĐỒNG BỘ XUỐNG "users" (11/2026, báo cáo người dùng trực tiếp, QUYẾT ĐỊNH ĐẢO NGƯỢC
// thiết kế cũ): trước đây hàm này, NGAY sau khi lưu Hồ Sơ Nhân Sự, còn ghi ĐÈ TRỰC TIẾP dept/jobTitle/
// posType của tài khoản liên kết + TỰ ĐỘNG tính lại toàn bộ perms (qua recomputeEffectivePerms(), đúng
// cơ chế "Phân quyền theo chức danh" — permGroup.jobTitles[] khớp chuỗi). Người dùng báo cáo thực tế
// (11/2026): tài khoản "anh.dp" bị tự đổi chức danh sang "Trưởng Phòng Công Nghệ Thông Tin" NGAY sau khi
// HR bấm Gán Chức Vụ trong Hồ Sơ Nhân Sự, ảnh hưởng tới quy trình/phân quyền đang được tự cấu hình riêng
// ở màn Phân Quyền — yêu cầu RÕ RÀNG: "chặn TOÀN BỘ" (dept+jobTitle+posType+perms), KHÔNG để bất kỳ
// thông tin nào từ Hồ Sơ Nhân Sự tự động áp xuống tài khoản nữa. Từ nay: assignPositionToProfile() CHỈ
// còn ghi vào employeeProfiles (hồ sơ/lịch sử chức vụ cho mục đích Nhân Sự) — KHÔNG đụng tới collection
// "users" dưới bất kỳ hình thức nào nữa.
//
// HỆ QUẢ CẦN BIẾT (đã nêu rõ với người dùng, được xác nhận chấp nhận đánh đổi):
// - "Phân quyền theo chức danh" (permGroup.jobTitles[] tự khớp) KHÔNG còn tự kích hoạt qua đường Gán
//   Chức Vụ/Nhập Excel hàng loạt nữa — chỉ còn áp dụng khi admin tự lưu lại tài khoản đó qua đúng màn
//   Phân Quyền (prepareUsersForSave()/syncUsersWithPermGroupsChange(), routes/data.js).
// - Phê duyệt "Theo vị trí" (resolvePositionApprovers(), lib/positionApprovers.js) đọc jobTitle/dept của
//   TÀI KHOẢN (users.*), KHÔNG còn tự bám theo chức vụ mới nhất ghi trong Hồ Sơ Nhân Sự nữa — đổi chức vụ
//   ở Hồ Sơ Nhân Sự xong vẫn phải tự vào Phân Quyền cập nhật tay nếu muốn luồng duyệt theo đúng vị trí
//   mới. Hồ Sơ Nhân Sự và Phân Quyền từ nay là 2 nguồn ĐỘC LẬP, không còn đồng bộ 1 chiều như trước.
'use strict';

const { HttpError } = require('./httpErrors');
const { getAppDataValue, withLockedAppDataValue } = require('./appData');
const { assertPayloadFileUrlsOwnedByUser } = require('./uploadedFiles');
const employeeProfile = require('./employeeProfile');
const orgChart = require('./orgChart');

// assignPositionToProfile(employeeCode, positionKey, freshUser, {effectiveDate, note, fileUrl, fileName})
// — gán/đổi chức vụ cho 1 hồ sơ ĐÃ CÓ (theo employeeCode). CHỈ mutate employeeProfiles — KHÔNG còn đồng
// bộ gì xuống tài khoản VPDT liên kết (xem chú thích đầu file). Trả về profile đã cập nhật.
async function assignPositionToProfile(employeeCode, positionKey, freshUser, options) {
  const { effectiveDate, note, fileUrl, fileName } = options || {};
  const orgChartVersions = (await getAppDataValue('orgChartVersions')) || [];
  const applied = orgChart.getAppliedVersion(orgChartVersions);
  let updated;
  await withLockedAppDataValue('employeeProfiles', async (list) => {
    const profile = employeeProfile.findProfile(list, employeeCode);
    if (!profile) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    employeeProfile.applyPositionAssignment(profile, applied, positionKey, effectiveDate || null, freshUser.username, freshUser.name, note, fileUrl, fileName);
    await assertPayloadFileUrlsOwnedByUser({ fileUrl }, freshUser);
    updated = profile;
    return list;
  });
  return updated;
}

module.exports = { assignPositionToProfile };
