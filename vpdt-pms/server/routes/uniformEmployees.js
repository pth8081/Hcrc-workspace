// routes/uniformEmployees.js — Sub-tab "Quản Lý Nhân Viên Siêu Thị" (Đồng Phục, mục 4 kế hoạch): tạo/
// khoá tài khoản nhân viên SIÊU THỊ dành riêng cho Hành Chính cấp HO (uniformManage/admin) — KHÔNG đi
// qua POST /api/data/users (khoá cứng isCurrentlyAdmin() thật, uniformManage không đủ quyền qua đường
// đó, xem routes/data.js) nên cần route riêng. Form rút gọn có ĐÚNG 1 ô chọn quyền: client gửi lên
// "groupId" (không gửi field perms nào khác) — route này LUÔN re-validate groupId trỏ tới 1 Nhóm Phân
// Quyền (permGroups) có tồn tại thật VÀ group.scope==='STORE', rồi mới tính perms từ đúng group đó
// (mergeGroupsBasePermsServer/mergePermsServer, xem duplicate 2 hàm này ngay bên dưới). Nhóm scope STORE
// chỉ có thể được tạo/gắn cờ bởi 1 Admin thật (toàn bộ mục "Hệ Thống" > "Nhóm Phân Quyền" yêu cầu
// perms.admin ở client, xem public/index.html), nên đây là cơ chế đảm bảo: không tài khoản nào tạo qua
// route này có được quyền ngoài những gì 1 Admin đã chủ động gắn cho 1 nhóm scope STORE.
const express = require('express');
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { hashPassword, requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { validatePasswordStrength } = require('../lib/passwordPolicy');
const { isCurrentlyAdminOrUniformManage } = require('../lib/adminAuth');
const { HttpError } = require('../lib/httpErrors');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

// mergePermsServer()/mergeGroupsBasePermsServer(): DUPLICATED verbatim từ routes/data.js — theo đúng quy
// ước đã dùng ở đó cho các hàm pure nhỏ này (comment ngay phía trên bản gốc: "khớp Y HỆT ... PHẢI giữ
// giống hệt nếu sửa 1 bên"), thay vì import chéo giữa 2 route file độc lập. PHẢI giữ đồng bộ cả 3 nơi
// (routes/data.js, public/index.html mergePerms()/mergeGroupsBasePerms(), và đây) nếu sửa logic gộp quyền.
function mergePermsServer(basePerms, overrides) {
  return { ...(basePerms || {}), ...(overrides || {}) };
}

const APPROVER_AUTH_LEVEL_RANK_SERVER = { NONE: 0, PASSWORD: 1, PIN: 2, WEBAUTHN: 3 };

function mergeGroupsBasePermsServer(groupsPerms) {
  const list = (groupsPerms || []).filter(Boolean);
  if (!list.length) return {};
  const keys = new Set();
  list.forEach(p => Object.keys(p || {}).forEach(k => keys.add(k)));
  const result = {};
  keys.forEach(key => {
    const values = list.map(p => p?.[key]);
    if (key === 'approverAuthLevel') {
      result[key] = values.reduce((best, v) =>
        (APPROVER_AUTH_LEVEL_RANK_SERVER[v] || 0) > (APPROVER_AUTH_LEVEL_RANK_SERVER[best] || 0) ? v : best, 'NONE');
      return;
    }
    const sample = values.find(v => v !== undefined && v !== null);
    if (typeof sample === 'boolean') {
      result[key] = values.some(v => v === true);
    } else if (sample && typeof sample === 'object' && !Array.isArray(sample) && ('all' in sample || 'depts' in sample)) {
      result[key] = { all: values.some(v => v?.all === true), depts: [...new Set(values.flatMap(v => v?.depts || []))] };
    } else {
      result[key] = values[values.length - 1];
    }
  });
  return result;
}

function sendErr(res, err, label) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(`${label} lỗi:`, err.message);
  res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
}

// POST /api/uniform/employees — tạo tài khoản nhân viên siêu thị. Gate: perms.admin || perms.uniformManage
// (re-fetch fresh, xem isCurrentlyAdminOrUniformManage() ở lib/adminAuth.js).
router.post('/employees', async (req, res) => {
  try {
    const allowed = await isCurrentlyAdminOrUniformManage(req.user.username);
    if (!allowed) return res.status(403).json({ error: 'Bạn không có quyền tạo tài khoản nhân viên siêu thị' });

    const { username, password, fullName, email, phone, dept, jobTitle, groupId } = req.body || {};
    const uUsername = typeof username === 'string' ? username.trim() : '';
    const uFullName = typeof fullName === 'string' ? fullName.trim() : '';
    const uEmail = typeof email === 'string' ? email.trim() : '';
    const uPhone = typeof phone === 'string' ? phone.trim() : '';
    const uDept = typeof dept === 'string' ? dept.trim() : '';
    const uJobTitle = typeof jobTitle === 'string' ? jobTitle.trim() : '';
    const uGroupId = typeof groupId === 'string' ? groupId.trim() : '';

    if (!uUsername || !/^[a-zA-Z0-9_.]{3,50}$/.test(uUsername)) {
      return res.status(400).json({ error: 'Tên đăng nhập không hợp lệ (chỉ chữ/số/dấu gạch dưới/dấu chấm, 3-50 ký tự)' });
    }
    if (!uFullName) return res.status(400).json({ error: 'Thiếu Họ và Tên' });
    if (!uEmail) return res.status(400).json({ error: 'Thiếu Email' });
    if (!uPhone) return res.status(400).json({ error: 'Thiếu Số điện thoại' });
    if (!uDept) return res.status(400).json({ error: 'Vui lòng chọn Siêu Thị' });
    if (!uGroupId) return res.status(400).json({ error: 'Vui lòng chọn Nhóm Quyền' });

    const passwordError = validatePasswordStrength(password);
    if (passwordError) return res.status(400).json({ error: passwordError });

    const [stores, storeJobTitles, users, permGroups] = await Promise.all([
      getAppDataValue('stores'),
      getAppDataValue('storeJobTitles'),
      getAppDataValue('users'),
      getAppDataValue('permGroups')
    ]);
    if (!(stores || []).includes(uDept)) {
      return res.status(400).json({ error: `Siêu thị không hợp lệ: ${uDept}` });
    }
    if (uJobTitle) {
      const titleEntry = (storeJobTitles || []).find(t => t.label === uJobTitle);
      if (!titleEntry) return res.status(400).json({ error: `Chức danh không hợp lệ: ${uJobTitle}` });
      if (titleEntry.restrictedFromSelfService) {
        return res.status(400).json({ error: `Chức danh "${uJobTitle}" không được phép tự tạo tài khoản qua form này` });
      }
    }
    // Nhóm phải TỒN TẠI THẬT và có scope==='STORE' — chặn cứng mọi group thường (dùng cho HO, không tag
    // STORE) hoặc id không có thật, kể cả khi client cố gửi thẳng 1 groupId bất kỳ qua ngoài UI.
    const group = (permGroups || []).find(g => g.id === uGroupId);
    if (!group || group.scope !== 'STORE') {
      return res.status(400).json({ error: 'Nhóm quyền không hợp lệ hoặc không dành cho Siêu Thị' });
    }
    if ((users || []).some(u => u.username === uUsername)) {
      return res.status(400).json({ error: `Tên đăng nhập "${uUsername}" đã tồn tại` });
    }

    const passHash = await hashPassword(password);
    const computedPerms = mergePermsServer(mergeGroupsBasePermsServer([group.perms]), null);
    let newRecord;
    await withLockedAppDataValue('users', (list) => {
      const arr = Array.isArray(list) ? list : [];
      if (arr.some(u => u.username === uUsername)) {
        throw new HttpError(400, `Tên đăng nhập "${uUsername}" đã tồn tại`);
      }
      let id = Date.now();
      while (arr.some(u => u.id === id)) id += 1;
      newRecord = {
        id, username: uUsername, pass: passHash, name: uFullName, email: uEmail, phone: uPhone,
        dept: uDept, jobTitle: uJobTitle || '', posType: 'STORE', startDate: '',
        active: true, mustChangePassword: true, groupIds: [group.id], perms: computedPerms
      };
      return [...arr, newRecord];
    });

    const { pass, ...safeRecord } = newRecord;
    res.json({ ok: true, user: safeRecord });
  } catch (err) {
    sendErr(res, err, 'POST /api/uniform/employees');
  }
});

// PATCH /api/uniform/employees/:id/active — CHỈ nhận {active:false} (khoá 1 chiều — mở lại phải qua
// màn Người Dùng đầy đủ của Admin, theo đúng xác nhận của người dùng). Validate lại record đích có
// posType==='STORE' trước khi cho khoá, chặn route hẹp này bị lợi dụng để khoá nhầm tài khoản HO/admin.
router.patch('/employees/:id/active', async (req, res) => {
  try {
    const allowed = await isCurrentlyAdminOrUniformManage(req.user.username);
    if (!allowed) return res.status(403).json({ error: 'Bạn không có quyền khoá tài khoản nhân viên siêu thị' });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });
    if (req.body?.active !== false) {
      return res.status(400).json({ error: 'Route này chỉ dùng để KHOÁ tài khoản (active:false) — mở khoá lại vui lòng dùng màn Người Dùng (Quản Trị)' });
    }
    if (req.user.username && id) {
      // Chặn tự khoá chính mình qua route này — cùng lý do prepareUsersForSave() ở routes/data.js.
      const self = (await getAppDataValue('users') || []).find(u => u.id === id);
      if (self && self.username === req.user.username) {
        return res.status(400).json({ error: 'Không thể tự khoá (vô hiệu hoá) chính tài khoản đang đăng nhập.' });
      }
    }

    let updated;
    await withLockedAppDataValue('users', (list) => {
      const arr = Array.isArray(list) ? list : [];
      const idx = arr.findIndex(u => u.id === id);
      if (idx === -1) throw new HttpError(404, 'Không tìm thấy tài khoản');
      const target = arr[idx];
      if (target.posType !== 'STORE') {
        throw new HttpError(403, 'Route này chỉ dùng để khoá tài khoản nhân viên siêu thị (posType STORE)');
      }
      updated = { ...target, active: false };
      const next = [...arr];
      next[idx] = updated;
      return next;
    });

    const { pass, ...safeRecord } = updated;
    res.json({ ok: true, user: safeRecord });
  } catch (err) {
    sendErr(res, err, 'PATCH /api/uniform/employees/:id/active');
  }
});

module.exports = router;
