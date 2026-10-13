// lib/hrProfilePositionAssign.js — assignPositionToProfile() (10/2026, theo yêu cầu người dùng: di trú
// 500 nhân viên, cần "Gán Chức Vụ hàng loạt qua Excel" để điền nốt Cấp Bậc + chuỗi Quản Lý Trực Tiếp,
// 2 trường DUY NHẤT còn lại trong 84 trường chưa có đường nhập hàng loạt) — TÁCH NGUYÊN VẸN (copy,
// KHÔNG đổi hành vi) từ routes/employeeProfile.js::POST /by-code/:employeeCode/set-position, để route
// đó VÀ route nhập Excel hàng loạt mới (routes/employeeProfile.js POST /position-assign-apply) đều gọi
// ĐÚNG 1 hàm, không viết lại business rule nào (applyPositionAssignment(), lib/employeeProfile.js).
'use strict';

const { HttpError } = require('./httpErrors');
const { getAppDataValue, withLockedAppDataValue } = require('./appData');
const { assertPayloadFileUrlsOwnedByUser } = require('./uploadedFiles');
const employeeProfile = require('./employeeProfile');
const orgChart = require('./orgChart');

// assignPositionToProfile(employeeCode, positionKey, freshUser, {effectiveDate, note, fileUrl, fileName})
// — gán/đổi chức vụ cho 1 hồ sơ ĐÃ CÓ (theo employeeCode), đồng bộ ghi đè dept/jobTitle/posType xuống
// tài khoản VPDT liên kết (nếu có) NGAY sau khi ghi hồ sơ xong — y hệt route tạo tay. Trả về profile đã
// cập nhật.
async function assignPositionToProfile(employeeCode, positionKey, freshUser, options) {
  const { effectiveDate, note, fileUrl, fileName } = options || {};
  const orgChartVersions = (await getAppDataValue('orgChartVersions')) || [];
  const applied = orgChart.getAppliedVersion(orgChartVersions);
  let updated, syncTarget = null;
  await withLockedAppDataValue('employeeProfiles', async (list) => {
    const profile = employeeProfile.findProfile(list, employeeCode);
    if (!profile) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    const result = employeeProfile.applyPositionAssignment(profile, applied, positionKey, effectiveDate || null, freshUser.username, freshUser.name, note, fileUrl, fileName);
    await assertPayloadFileUrlsOwnedByUser({ fileUrl }, freshUser);
    updated = profile;
    if (profile.username) syncTarget = { username: profile.username, jobTitle: result.jobTitle, dept: result.dept, posType: result.posType };
    return list;
  });
  if (syncTarget) {
    await withLockedAppDataValue('users', (list) => (list || []).map(u =>
      u.username === syncTarget.username ? { ...u, jobTitle: syncTarget.jobTitle, dept: syncTarget.dept, ...(syncTarget.posType ? { posType: syncTarget.posType } : {}) } : u
    ));
  }
  return updated;
}

module.exports = { assignPositionToProfile };
