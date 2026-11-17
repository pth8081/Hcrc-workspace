// lib/hrUsernameMapping.js — "🆔 Mã NV ↔ Tài Khoản" (11/2026, theo yêu cầu người dùng — admin-only,
// quy tắc hệ thống: Tên Đăng Nhập LUÔN được tạo trùng Mã Nhân Viên). 3 nhóm cho mỗi hồ sơ Hồ Sơ Nhân Sự
// đang THẬT SỰ làm việc (ACTIVE/ON_LEAVE — hồ sơ Nháp/Đã nghỉ việc không có ý nghĩa để tạo/đối chiếu tài
// khoản đăng nhập):
//   MATCHED  — đã liên kết tài khoản, username === employeeCode (đúng quy tắc, không cần làm gì).
//   MISMATCH — đã liên kết tài khoản NHƯNG username khác employeeCode (dữ liệu cũ/gõ sai trước khi có
//              quy tắc này — CHỈ hiển thị để Admin tự rà/sửa TAY, KHÔNG có thao tác hàng loạt cho nhóm
//              này: "sửa cho khớp" ở đây là ĐỔI TÊN ĐĂNG NHẬP của 1 tài khoản đang hoạt động thật, rủi ro
//              cao vì username là định danh tham chiếu ở rất nhiều collection khác (managerUsername,
//              assignedToUsername, creator, approvers...) — xem thêm chú thích ở
//              auditEmployeeCodeUsernameMismatch(), lib/hrProfileAudit.js, cảnh báo y hệt nhưng ở màn HR
//              thường dùng, không admin-only, không có hành động hàng loạt nào).
//   MISSING  — CHƯA liên kết tài khoản nào — nhóm DUY NHẤT cho phép Admin chọn + "Tạo Hàng Loạt" ở đây.
'use strict';

const { resolveProfileDisplayName, linkAccount } = require('./employeeProfile');
const { findUserByUsernameCI } = require('./auth');
const { HttpError } = require('./httpErrors');

// Hồ sơ Nháp (ứng viên Onboarding chưa Xác Nhận) và Đã nghỉ việc KHÔNG hiện ở màn này — tạo/đối chiếu
// tài khoản đăng nhập cho 2 nhóm đó không có ý nghĩa nghiệp vụ (xem mockup đã người dùng xác nhận).
const ELIGIBLE_STATUSES = new Set(['ACTIVE', 'ON_LEAVE']);

// Mật khẩu mặc định cho tài khoản tạo hàng loạt — bắt buộc đổi ngay lần đăng nhập đầu (server tự đặt
// mustChangePassword=true khi thấy "pass" plaintext cho tài khoản MỚI, xem prepareUsersForSave() ở
// routes/data.js — KHÔNG cần tự set cờ này ở đây, dùng lại ĐÚNG cơ chế có sẵn).
const DEFAULT_PASSWORD = 'Brg@123456';
const MAX_BULK_CREATE = 200;

function mappingStatusFor(profile) {
  if (!profile.username) return 'MISSING';
  return profile.username === profile.employeeCode ? 'MATCHED' : 'MISMATCH';
}

// computeUsernameMappingReport(appData) — appData cần users/employeeProfiles (đủ qua getAllAppData(),
// cả 2 đều là AppData blob, KHÔNG phải MIGRATED_COLLECTIONS) + hrProcesses (collection riêng, caller tự
// getAllForCollection('hrProcesses') rồi gắn vào appData — dùng cho resolveProfileDisplayName() tra tên
// hiển thị qua processId khi hồ sơ chưa liên kết tài khoản nào, xem employeeProfile.js).
function computeUsernameMappingReport(appData) {
  const profiles = (appData.employeeProfiles || []).filter(p => p && ELIGIBLE_STATUSES.has(p.status));
  const rows = profiles.map(p => {
    const name = resolveProfileDisplayName(p, appData.users, appData.hrProcesses) || '';
    return {
      employeeCode: p.employeeCode,
      // thiếu Họ Tên (hồ sơ tạo tay không qua Onboarding, không processId) — vẫn hiện dòng, dùng tạm Mã
      // NV làm nhãn thay vì để trống, đỡ nhầm "không có ai" trên danh sách.
      name: name || p.employeeCode,
      hasName: !!name,
      dept: p.dept || null, jobTitle: p.jobTitle || null, posType: p.posType || null,
      status: mappingStatusFor(p),
      currentUsername: p.username || null
    };
  }).sort((a, b) => a.employeeCode.localeCompare(b.employeeCode));
  const stats = {
    total: rows.length,
    matched: rows.filter(r => r.status === 'MATCHED').length,
    mismatch: rows.filter(r => r.status === 'MISMATCH').length,
    missing: rows.filter(r => r.status === 'MISSING').length
  };
  return { rows, stats };
}

// applyBulkCreateAccounts(selections, appData) — appData cần users/employeeProfiles MỚI NHẤT (caller
// đọc lại NGAY TRƯỚC khi khoá ghi, xem routes/hrUsernameMapping.js). selections: mảng
// { employeeCode, dept, jobTitle, phone, email } do Admin xác nhận ở màn "Xác Nhận" (gợi ý sẵn từ Hồ Sơ
// Nhân Sự nhưng admin sửa tự do) — 4 field này CHỈ ghi vào tài khoản MỚI, KHÔNG đụng employeeProfiles
// (xem callout đã xác nhận với người dùng ở mockup). Trả về { toCreate: [user object mới], toLinkCodes:
// [employeeCode], skipped: [{employeeCode, name, reason}] } — KHÔNG tự ghi gì (caller chịu trách nhiệm
// khoá-ghi 'users' rồi 'employeeProfiles', xem route). groupIds (TUỲ CHỌN, mảng id Nhóm Phân Quyền
// dạng CHUỖI — permGroups.id luôn là chuỗi "grp_<timestamp>", KHÔNG phải số, xem
// module-admin-permgroups.js startCreateGroup() — KHÔNG được ép Number() ở đây/route) áp dụng CHUNG cho
// MỌI tài khoản tạo trong lượt này; để trống/không gửi = không gán quyền nào (an toàn nhất, Admin tự
// cấu hình sau) — prepareUsersForSave() (routes/data.js) tự tính lại "perms" thật từ groupIds này, cùng
// đường dùng cho mọi lượt lưu "users" khác, không viết lại logic tính quyền ở đây.
function prepareBulkCreateAccounts(selections, appData, nextIdStart, groupIds) {
  if (!Array.isArray(selections) || !selections.length) throw new HttpError(400, 'Chưa chọn hồ sơ nào để tạo tài khoản');
  if (selections.length > MAX_BULK_CREATE) throw new HttpError(400, `Chỉ tạo tối đa ${MAX_BULK_CREATE} tài khoản trong 1 lần`);

  const profiles = appData.employeeProfiles || [];
  const users = appData.users || [];
  const seenInBatch = new Set();
  const toCreate = [];
  const toLinkCodes = [];
  const skipped = [];
  let nextId = nextIdStart;

  for (const sel of selections) {
    const employeeCode = String(sel?.employeeCode || '').trim();
    const profile = profiles.find(p => p.employeeCode === employeeCode);
    const name = profile ? (resolveProfileDisplayName(profile, appData.users, appData.hrProcesses) || employeeCode) : employeeCode;
    if (!employeeCode) continue;
    if (seenInBatch.has(employeeCode)) {
      skipped.push({ employeeCode, name, reason: 'Trùng lặp trong cùng lượt tạo — chỉ dòng đầu tiên được xử lý.' });
      continue;
    }
    seenInBatch.add(employeeCode);
    if (!profile || !ELIGIBLE_STATUSES.has(profile.status)) {
      skipped.push({ employeeCode, name, reason: 'Không tìm thấy hồ sơ đang làm việc/nghỉ phép ứng với Mã Nhân Viên này (có thể đã đổi trạng thái) — tải lại danh sách rồi thử lại.' });
      continue;
    }
    if (profile.username) {
      skipped.push({ employeeCode, name, reason: `Hồ sơ này vừa được liên kết tài khoản "${profile.username}" (có thể do thao tác khác) — không tạo mới nữa.` });
      continue;
    }
    if (findUserByUsernameCI(users, employeeCode)) {
      skipped.push({ employeeCode, name, reason: `Mã Nhân Viên "${employeeCode}" đã trùng tên đăng nhập với 1 tài khoản khác đang hoạt động — cần xử lý thủ công.` });
      continue;
    }
    const dept = String(sel?.dept || '').trim() || null;
    const jobTitle = String(sel?.jobTitle || '').trim() || null;
    const phone = String(sel?.phone || '').trim() || null;
    const email = String(sel?.email || '').trim() || null;
    toCreate.push({
      id: nextId++,
      username: employeeCode,
      pass: DEFAULT_PASSWORD,
      name,
      email: email || '',
      phone: phone || '',
      posType: profile.posType || null,
      dept,
      jobTitle,
      perms: {},
      groupIds: Array.isArray(groupIds) ? groupIds.filter(g => typeof g === 'string' && g.trim()) : []
    });
    toLinkCodes.push(employeeCode);
  }

  return { toCreate, toLinkCodes, skipped };
}

// linkCreatedAccountsToProfiles(list, codes, actorUsername) — chạy TRONG withLockedAppDataValue('employeeProfiles', ...)
// NGAY SAU KHI đã ghi 'users' thành công (xem route) — dùng lại ĐÚNG linkAccount() hiện có (lib/employeeProfile.js),
// không viết lại logic liên kết. 1 mã lỡ thất bại (hiếm, đã kiểm tra kỹ ở prepareBulkCreateAccounts())
// KHÔNG chặn các mã còn lại — ghi lại lỗi để route trả về đủ cho Admin biết.
function linkCreatedAccountsToProfiles(list, codes, actorUsername) {
  const failures = [];
  for (const code of codes) {
    try { linkAccount(list, code, code, actorUsername); }
    catch (err) { failures.push({ employeeCode: code, reason: err.message }); }
  }
  return failures;
}

module.exports = {
  ELIGIBLE_STATUSES, DEFAULT_PASSWORD, MAX_BULK_CREATE,
  computeUsernameMappingReport, prepareBulkCreateAccounts, linkCreatedAccountsToProfiles
};
