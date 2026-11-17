// routes/hrUsernameMapping.js — "🆔 Mã NV ↔ Tài Khoản" (11/2026, theo yêu cầu người dùng, admin-only —
// xem chú thích đầy đủ ở lib/hrUsernameMapping.js). Cùng khuôn routes/userAudit.js (gác isCurrentlyAdmin()
// cho CẢ đọc lẫn ghi, đọc thẳng DB không qua cache nào — độ trễ tuyệt đối bằng 0 cho thao tác tạo tài
// khoản hàng loạt).
'use strict';
const express = require('express');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { isCurrentlyAdmin } = require('../lib/adminAuth');
const { getAllAppData, getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { getAllForCollection } = require('../lib/recordStore');
const { computeUsernameMappingReport, prepareBulkCreateAccounts, linkCreatedAccountsToProfiles } = require('../lib/hrUsernameMapping');
const { prepareUsersForSave } = require('./data');
const { insertSystemLog } = require('../lib/systemLogStore');
const { sendCatchError } = require('../lib/errorResponse');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

async function requireAdmin(req, res) {
  const allowed = await isCurrentlyAdmin(req.user.username);
  if (!allowed) {
    res.status(403).json({ error: 'Chỉ Quản Trị Viên mới dùng được chức năng này' });
    return false;
  }
  return true;
}

// appData dùng cho computeUsernameMappingReport()/prepareBulkCreateAccounts() cần thêm "hrProcesses"
// (MIGRATED_COLLECTIONS — KHÔNG có sẵn trong getAllAppData(), xem chú thích tại lib/hrUsernameMapping.js)
// để resolveProfileDisplayName() tra tên hiển thị qua processId cho hồ sơ CHƯA liên kết tài khoản nào.
async function buildAppDataWithHrProcesses() {
  const appData = await getAllAppData();
  appData.hrProcesses = await getAllForCollection('hrProcesses');
  return appData;
}

router.get('/', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const appData = await buildAppDataWithHrProcesses();
    const report = computeUsernameMappingReport(appData);
    res.json(report);
  } catch (err) { sendCatchError(res, err, 'GET /api/admin/username-mapping'); }
});

// POST /bulk-create-accounts — body: { selections: [{employeeCode, dept, jobTitle, phone, email}], groupIds: [number] }.
// 2 bước khoá TÁCH RIÊNG (cùng khuôn POST /by-code/:employeeCode/link-account, routes/employeeProfile.js):
// (1) khoá 'users' — tạo mới qua ĐÚNG prepareUsersForSave() (hash mật khẩu, mustChangePassword tự động,
// tính quyền từ groupIds, chặn trùng username/id...), (2) khoá 'employeeProfiles' NGAY SAU KHI (1) đã ghi
// THÀNH CÔNG — liên kết employeeProfiles.username cho đúng các Mã NV vừa tạo tài khoản. Đọc lại
// employeeProfiles/users MỚI NHẤT ngay trong callback khoá (1), KHÔNG dùng lại snapshot đã đọc ở trên,
// giảm tối đa cửa sổ race với 1 request khác đang xử lý đồng thời.
router.post('/bulk-create-accounts', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const selections = Array.isArray(req.body?.selections) ? req.body.selections : [];
    // permGroups.id luôn là CHUỖI ("grp_<timestamp>", xem chú thích đầy đủ ở prepareBulkCreateAccounts())
    // — KHÔNG ép Number() như 1 số route khác (groupIds ở đây có nguồn gốc KHÁC, không phải số thứ tự).
    const groupIds = Array.isArray(req.body?.groupIds)
      ? req.body.groupIds.filter(g => typeof g === 'string' && g.trim())
      : [];

    let created = [];
    let skipped = [];
    let toLinkCodes = [];
    await withLockedAppDataValue('users', async (freshUsers) => {
      const usersArr = Array.isArray(freshUsers) ? freshUsers : [];
      const freshProfiles = (await getAppDataValue('employeeProfiles')) || [];
      const hrProcesses = await getAllForCollection('hrProcesses');
      const nextId = usersArr.reduce((max, u) => Math.max(max, Number(u.id) || 0), 0) + 1;
      const prepared = prepareBulkCreateAccounts(selections, { users: usersArr, employeeProfiles: freshProfiles, hrProcesses }, nextId, groupIds);
      skipped = prepared.skipped;
      if (!prepared.toCreate.length) return usersArr; // không ghi gì nếu không có dòng nào hợp lệ
      const merged = [...usersArr, ...prepared.toCreate];
      const result = await prepareUsersForSave(merged, req.user.username);
      created = prepared.toCreate.map(u => ({ employeeCode: u.username, name: u.name }));
      toLinkCodes = prepared.toLinkCodes;
      return result;
    });

    let linkFailures = [];
    if (toLinkCodes.length) {
      await withLockedAppDataValue('employeeProfiles', (list) => {
        const arr = Array.isArray(list) ? list : [];
        linkFailures = linkCreatedAccountsToProfiles(arr, toLinkCodes, req.user.username);
        return arr;
      });
    }
    // Hồ sơ nào lỡ không liên kết được (cực hiếm — đã kiểm trùng trước đó) vẫn GIỮ tài khoản vừa tạo
    // (không rollback 'users', tránh phức tạp hoá giao dịch 2 pha cho 1 trường hợp gần như không xảy
    // ra) — chỉ báo rõ cho Admin để tự vào liên kết tay qua "Liên Kết Tài Khoản" sẵn có.
    if (linkFailures.length) {
      const byCode = new Set(linkFailures.map(f => f.employeeCode));
      created = created.filter(c => !byCode.has(c.employeeCode));
      skipped = [...skipped, ...linkFailures.map(f => ({ employeeCode: f.employeeCode, name: f.employeeCode, reason: `Tài khoản đã tạo nhưng LIÊN KẾT hồ sơ thất bại (${f.reason}) — vào "Hồ Sơ Nhân Sự" tự liên kết tay.` }))];
    }

    if (created.length) {
      insertSystemLog({
        username: req.user.username, fullName: req.freshUser?.name || req.user.username, ipAddress: req.ip,
        module: 'CONFIG', actionType: 'BULK_CREATE_USERS_FROM_HR_PROFILE',
        targetObject: created.map(c => c.employeeCode).join(', '),
        description: `Tạo hàng loạt ${created.length} tài khoản đăng nhập từ Hồ Sơ Nhân Sự (Tên đăng nhập = Mã Nhân Viên): ${created.map(c => c.employeeCode).join(', ')}`,
        status: 'SUCCESS'
      }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (Mã NV ↔ Tài Khoản):', e.message));
    }

    res.json({ ok: true, created, skipped });
  } catch (err) { sendCatchError(res, err, 'POST /api/admin/username-mapping/bulk-create-accounts'); }
});

module.exports = router;
