// server/tests/test-hr-profile.js
//
// Regression test cho "Nhân Sự > Hồ Sơ Nhân Sự" (Đợt 1/4 module Nhân Sự) — xem
// lib/employeeProfile.js/routes/employeeProfile.js. Cùng khuôn tests/test-orgchart-v2.js (dedicated
// router — không đi qua GET /api/data chung, không cần mock trong tests/testHarness.js):
//
//   PHẦN A (server, chạy thẳng express router THẬT routes/employeeProfile.js — KHÔNG mở Playwright,
//   chỉ giả lập tầng lưu trữ lib/appData + middleware xác thực lib/auth):
//     1. GET /me — 404 nếu tài khoản chưa liên kết hồ sơ nào; 200 + đủ field (kể cả nhạy cảm) nếu đã
//        liên kết (chính chủ luôn xem đủ).
//     2. PATCH /me — chính chủ sửa được SELF_EDITABLE_FIELDS; gửi kèm field HR-only (nationalId) bị
//        server ÂM THẦM bỏ qua (không lỗi, nhưng không đổi giá trị — applyProfileEdit() chỉ nhận field
//        trong allowedFields truyền vào).
//     3. GET / — chỉ hrProfileManage/admin; nhân viên thường/quản lý trực tiếp (chỉ hrProfileView) bị 403.
//     4. GET /by-code/:code — hrProfileManage/admin xem ĐẦY ĐỦ; quản lý trực tiếp (hrProfileView, đúng
//        cây quản lý qua managerUsername) xem BẢN GIỚI HẠN (không có nationalId/dependents/...); người
//        không liên quan (không phải quản lý, không có quyền) -> 404 (không lộ "có hồ sơ nhưng không có
//        quyền" khác với "không tồn tại").
//     5. PATCH /by-code/:code — chỉ hrProfileManage/admin; sửa được CẢ field HR-only (nationalId).
//     6. PATCH /by-code/:code/status — chỉ hrProfileManage/admin; chỉ chuyển ACTIVE<->ON_LEAVE (DRAFT/
//        INACTIVE bị chặn, xem assertValidManualStatusTransition()).
//     7. POST /by-code/:code/link-account — chỉ hrProfileManage/admin; chặn liên kết trùng (2 hồ sơ cùng
//        1 username, hoặc hồ sơ đã có username rồi liên kết lại).
//     8. GET /by-username/:username — CÙNG quyền/hành vi như /by-code (chỉ khác điểm tra cứu) — dùng cho
//        quản lý trực tiếp không có hrProfileManage (không gọi được GET / để tự tra employeeCode).
//
//   PHẦN B (gọi thẳng các hàm THẬT trong lib/employeeProfile.js qua require()):
//     9. ensureDraftProfile(): tạo DRAFT mới, idempotent (gọi lại không tạo trùng).
//    10. applyProcessCompletion(): ONBOARDING hoàn tất -> ACTIVE (tra theo employeeCode); OFFBOARDING
//        hoàn tất -> INACTIVE (tra theo employeeUsername).
//    11. linkAccount(): gán username hợp lệ; lỗi nếu hồ sơ không tồn tại/đã liên kết/username đã dùng.
//    12. assertValidManualStatusTransition(): DRAFT/INACTIVE không chuyển tay được; ACTIVE<->ON_LEAVE OK.
//
// Chạy: node server/tests/test-hr-profile.js
const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const HR_MGR = { username: 'hr1', name: 'Nhân Sự Trưởng', dept: 'Phòng Nhân Sự', perms: { hrProfileManage: true }, active: true };
// Quản lý trực tiếp của EMP1 (managerUsername trỏ đúng) — chỉ có hrProfileView (KHÔNG có hrProfileManage).
const DIRECT_MGR = { username: 'mgr1', name: 'Trưởng Phòng KD', dept: 'Phòng Kinh Doanh', perms: { hrProfileView: true }, active: true };
const EMP1 = { username: 'emp1', name: 'Nhân Viên Một', dept: 'Phòng Kinh Doanh', managerUsername: 'mgr1', perms: {}, active: true };
const OUTSIDER = { username: 'nv2', name: 'Người Ngoài Cuộc', dept: 'Kế Toán', managerUsername: null, perms: {}, active: true };
let USERS = [ADMIN, HR_MGR, DIRECT_MGR, EMP1, OUTSIDER];

let APP_DATA;
function resetAppData() {
  APP_DATA = { users: USERS, employeeProfiles: [] };
}
resetAppData();

let PORT = 0;
let CURRENT_USERNAME = ADMIN.username;

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAllAppData: async () => APP_DATA,
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');
const employeeProfileRoutes = require('../routes/employeeProfile');
const employeeProfile = require('../lib/employeeProfile');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/hr-profile', employeeProfileRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

function seedLinkedProfile(overrides) {
  const profile = Object.assign(employeeProfile.defaultProfile('NV001'), {
    username: 'emp1', status: 'ACTIVE'
  }, overrides || {});
  APP_DATA.employeeProfiles.push(profile);
  return profile;
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('GET /me — 404 nếu chưa liên kết hồ sơ nào', async () => {
      resetAppData();
      const res = await api('GET', '/api/hr-profile/me', undefined, EMP1);
      assertEqual(res.status, 404, 'Chưa liên kết hồ sơ -> 404');
    });

    await run.run('GET /me — chính chủ xem ĐỦ (kể cả field nhạy cảm) khi đã liên kết', async () => {
      resetAppData();
      seedLinkedProfile({ nationalId: '079123456789' });
      const res = await api('GET', '/api/hr-profile/me', undefined, EMP1);
      assertEqual(res.status, 200, 'Đã liên kết -> 200');
      assertEqual(res.body.profile.nationalId, '079123456789', 'Chính chủ phải xem được field nhạy cảm');
    });

    await run.run('PATCH /me — chính chủ sửa SELF_EDITABLE_FIELDS, field HR-only bị bỏ qua', async () => {
      resetAppData();
      seedLinkedProfile({ nationalId: '079123456789' });
      const res = await api('PATCH', '/api/hr-profile/me',
        { permanentAddress: '123 Đường ABC', nationalId: '000000000000' }, EMP1);
      assertEqual(res.status, 200, 'Chính chủ sửa hồ sơ mình phải thành công');
      assertEqual(res.body.profile.permanentAddress, '123 Đường ABC', 'Địa chỉ phải được cập nhật');
      assertEqual(res.body.profile.nationalId, '079123456789', 'nationalId (HR-only) KHÔNG được đổi qua PATCH /me');
    });

    await run.run('GET / — chỉ hrProfileManage/admin, chặn quản lý trực tiếp/nhân viên thường', async () => {
      resetAppData();
      seedLinkedProfile({});
      for (const u of [ADMIN, HR_MGR]) {
        const ok = await api('GET', '/api/hr-profile', undefined, u);
        assertEqual(ok.status, 200, `${u.username} phải xem được danh sách`);
      }
      const deniedMgr = await api('GET', '/api/hr-profile', undefined, DIRECT_MGR);
      assertEqual(deniedMgr.status, 403, 'Quản lý trực tiếp (chỉ hrProfileView) không được xem danh sách đầy đủ');
      const deniedEmp = await api('GET', '/api/hr-profile', undefined, EMP1);
      assertEqual(deniedEmp.status, 403, 'Nhân viên thường không được xem danh sách');
    });

    await run.run('GET /by-code/:code — HR/admin xem đủ; quản lý trực tiếp xem giới hạn; người ngoài 404', async () => {
      resetAppData();
      seedLinkedProfile({ nationalId: '079123456789', dependents: [{ id: 'd1', fullName: 'Con A', relationship: 'Con' }] });

      const full = await api('GET', '/api/hr-profile/by-code/NV001', undefined, HR_MGR);
      assertEqual(full.status, 200, 'HR phải xem được hồ sơ');
      assertEqual(full.body.profile.nationalId, '079123456789', 'HR phải xem được field nhạy cảm');

      const limited = await api('GET', '/api/hr-profile/by-code/NV001', undefined, DIRECT_MGR);
      assertEqual(limited.status, 200, 'Quản lý trực tiếp đúng cây quản lý phải xem được bản giới hạn');
      assertEqual('nationalId' in limited.body.profile, false, 'Bản giới hạn KHÔNG được có nationalId');
      assertEqual('dependents' in limited.body.profile, false, 'Bản giới hạn KHÔNG được có dependents');

      const outsider = await api('GET', '/api/hr-profile/by-code/NV001', undefined, OUTSIDER);
      assertEqual(outsider.status, 404, 'Người không liên quan phải bị 404 (không phân biệt lý do)');
    });

    await run.run('PATCH /by-code/:code — chỉ HR/admin, sửa được cả field HR-only', async () => {
      resetAppData();
      seedLinkedProfile({});
      const deniedMgr = await api('PATCH', '/api/hr-profile/by-code/NV001', { nationalId: '079999999999' }, DIRECT_MGR);
      assertEqual(deniedMgr.status, 403, 'Quản lý trực tiếp không được sửa hồ sơ người khác');
      const ok = await api('PATCH', '/api/hr-profile/by-code/NV001', { nationalId: '079999999999' }, HR_MGR);
      assertEqual(ok.status, 200, 'HR sửa hồ sơ phải thành công');
      assertEqual(ok.body.profile.nationalId, '079999999999', 'HR phải sửa được field HR-only');
    });

    await run.run('PATCH /by-code/:code/status — chỉ chuyển tay ACTIVE<->ON_LEAVE, chặn DRAFT/INACTIVE', async () => {
      resetAppData();
      seedLinkedProfile({ status: 'ACTIVE' });
      const toLeave = await api('PATCH', '/api/hr-profile/by-code/NV001/status', { status: 'ON_LEAVE' }, HR_MGR);
      assertEqual(toLeave.status, 200, 'ACTIVE -> ON_LEAVE phải thành công');
      const toDraft = await api('PATCH', '/api/hr-profile/by-code/NV001/status', { status: 'DRAFT' }, HR_MGR);
      assertEqual(toDraft.status, 400, 'Không được chuyển tay sang DRAFT');

      resetAppData();
      seedLinkedProfile({ status: 'INACTIVE' });
      const fromInactive = await api('PATCH', '/api/hr-profile/by-code/NV001/status', { status: 'ACTIVE' }, HR_MGR);
      assertEqual(fromInactive.status, 400, 'Hồ sơ đã INACTIVE không đổi trạng thái tay được');
    });

    await run.run('POST /by-code/:code/link-account — chặn liên kết trùng', async () => {
      resetAppData();
      APP_DATA.employeeProfiles.push(employeeProfile.defaultProfile('NV002'));
      const denied = await api('POST', '/api/hr-profile/by-code/NV002/link-account', { username: 'emp1' }, DIRECT_MGR);
      assertEqual(denied.status, 403, 'Chỉ HR/admin mới liên kết tài khoản');
      const ok = await api('POST', '/api/hr-profile/by-code/NV002/link-account', { username: 'emp1' }, HR_MGR);
      assertEqual(ok.status, 200, 'Liên kết hợp lệ phải thành công');
      const dupSameProfile = await api('POST', '/api/hr-profile/by-code/NV002/link-account', { username: 'nv2' }, HR_MGR);
      assertEqual(dupSameProfile.status, 400, 'Hồ sơ đã liên kết rồi không liên kết lại được');

      APP_DATA.employeeProfiles.push(employeeProfile.defaultProfile('NV003'));
      const dupUsername = await api('POST', '/api/hr-profile/by-code/NV003/link-account', { username: 'emp1' }, HR_MGR);
      assertEqual(dupUsername.status, 400, 'username đã được hồ sơ khác liên kết rồi không dùng lại được');
    });

    await run.run('GET /by-username/:username — cùng quyền/hành vi như /by-code (đường tra cứu khác)', async () => {
      resetAppData();
      seedLinkedProfile({ nationalId: '079123456789' });
      const limited = await api('GET', '/api/hr-profile/by-username/emp1', undefined, DIRECT_MGR);
      assertEqual(limited.status, 200, 'Quản lý trực tiếp phải tra được theo username');
      assertEqual('nationalId' in limited.body.profile, false, 'Vẫn phải là bản giới hạn (không có nationalId)');
      const outsider = await api('GET', '/api/hr-profile/by-username/emp1', undefined, OUTSIDER);
      assertEqual(outsider.status, 404, 'Người không liên quan vẫn bị 404 qua đường tra cứu này');
      const notFound = await api('GET', '/api/hr-profile/by-username/khong-ton-tai', undefined, HR_MGR);
      assertEqual(notFound.status, 404, 'username không liên kết hồ sơ nào -> 404');
    });

  } finally {
    server.close();
  }

  // ===== PHẦN B: gọi thẳng hàm THẬT trong lib/employeeProfile.js =====
  await run.run('ensureDraftProfile(): tạo DRAFT mới, idempotent', () => {
    let list = [];
    list = employeeProfile.ensureDraftProfile(list, 'NV100', 'proc-1', 'hr1');
    assertEqual(list.length, 1, 'Phải tạo đúng 1 hồ sơ mới');
    assertEqual(list[0].status, 'DRAFT', 'Hồ sơ mới phải ở trạng thái DRAFT');
    list = employeeProfile.ensureDraftProfile(list, 'NV100', 'proc-2', 'hr1');
    assertEqual(list.length, 1, 'Gọi lại với cùng employeeCode KHÔNG được tạo trùng');
  });

  await run.run('applyProcessCompletion(): ONBOARDING -> ACTIVE (theo employeeCode), OFFBOARDING -> INACTIVE (theo employeeUsername)', () => {
    let list = [employeeProfile.defaultProfile('NV200')];
    list = employeeProfile.applyProcessCompletion(list, { processType: 'ONBOARDING', employeeCode: 'NV200' });
    assertEqual(list[0].status, 'ACTIVE', 'ONBOARDING hoàn tất phải chuyển ACTIVE');

    list = [Object.assign(employeeProfile.defaultProfile('NV201'), { username: 'emp1', status: 'ACTIVE' })];
    list = employeeProfile.applyProcessCompletion(list, { processType: 'OFFBOARDING', employeeUsername: 'emp1' });
    assertEqual(list[0].status, 'INACTIVE', 'OFFBOARDING hoàn tất phải chuyển INACTIVE');
  });

  await run.run('linkAccount(): gán hợp lệ; lỗi nếu hồ sơ không tồn tại/đã liên kết/username trùng', () => {
    let list = [employeeProfile.defaultProfile('NV300'), employeeProfile.defaultProfile('NV301')];
    const profile = employeeProfile.linkAccount(list, 'NV300', 'emp1', 'hr1');
    assertEqual(profile.username, 'emp1', 'Phải gán đúng username');

    let threwNotFound = false;
    try { employeeProfile.linkAccount(list, 'NV999', 'emp2', 'hr1'); } catch (e) { threwNotFound = true; assertIncludes(e.message, 'Không tìm thấy'); }
    assertEqual(threwNotFound, true, 'Hồ sơ không tồn tại phải throw');

    let threwAlreadyLinked = false;
    try { employeeProfile.linkAccount(list, 'NV300', 'emp2', 'hr1'); } catch (e) { threwAlreadyLinked = true; assertIncludes(e.message, 'đã liên kết'); }
    assertEqual(threwAlreadyLinked, true, 'Hồ sơ đã liên kết rồi phải throw khi liên kết lại');

    let threwDupUsername = false;
    try { employeeProfile.linkAccount(list, 'NV301', 'emp1', 'hr1'); } catch (e) { threwDupUsername = true; assertIncludes(e.message, 'đã được liên kết'); }
    assertEqual(threwDupUsername, true, 'username đã dùng ở hồ sơ khác phải throw');
  });

  await run.run('assertValidManualStatusTransition(): chỉ ACTIVE<->ON_LEAVE, chặn DRAFT/INACTIVE', () => {
    employeeProfile.assertValidManualStatusTransition('ACTIVE', 'ON_LEAVE'); // không throw
    employeeProfile.assertValidManualStatusTransition('ON_LEAVE', 'ACTIVE'); // không throw

    let threwFromDraft = false;
    try { employeeProfile.assertValidManualStatusTransition('DRAFT', 'ACTIVE'); } catch (e) { threwFromDraft = true; }
    assertEqual(threwFromDraft, true, 'Không chuyển tay được từ DRAFT');

    let threwFromInactive = false;
    try { employeeProfile.assertValidManualStatusTransition('INACTIVE', 'ACTIVE'); } catch (e) { threwFromInactive = true; }
    assertEqual(threwFromInactive, true, 'Không chuyển tay được từ INACTIVE');

    let threwToDraft = false;
    try { employeeProfile.assertValidManualStatusTransition('ACTIVE', 'DRAFT'); } catch (e) { threwToDraft = true; }
    assertEqual(threwToDraft, true, 'Không chuyển tay SANG DRAFT');
  });

  run.summary();
}

main().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
