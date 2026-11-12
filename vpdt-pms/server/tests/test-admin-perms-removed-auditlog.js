// server/tests/test-admin-perms-removed-auditlog.js
//
// LỖI THẬT RẤT NGHIÊM TRỌNG đã vá (11/2026, người dùng báo TRỰC TIẾP "tôi dùng quyền admin, tôi sửa
// quyền của tôi, add tôi vào 1 nhóm quyền khác, thì nó bị mất quyền admin luôn — mấy lần tôi bị rồi"):
// gốc rễ ở client (onUserPermGroupsChange()/module-admin-permgroups.js vẽ lại cây checkbox theo quyền
// nền của Nhóm vừa tick, âm thầm bỏ tick "👑 Quản Trị Viên (Admin)" nếu Nhóm không có admin:true) đã vá ở
// module-admin-permgroups.js + saveUser() (module-admin-submissiongroups.js, xem test-admin-users-permgroups.js
// scenario (h3) cho 2 lớp vá đó). File này kiểm LƯỚI AN TOÀN cuối cùng ở phía SERVER
// (POST /api/data/users, routes/data.js): BẤT KỲ tài khoản nào (trừ "admin" gốc, đã khoá cứng tuyệt đối)
// chuyển từ perms.admin=true sang false sau 1 lượt lưu "users" đều phải để lại ĐÚNG 1 dòng Nhật Ký Hệ
// Thống mức WARNING (actionType 'ADMIN_PERMS_REMOVED') — để admin còn lại tra lại được dấu vết dù lớp vá
// client bị bỏ qua (request tự soạn, JS lỗi...).
//
// KIẾN TRÚC: giống hệt test-permgroup-dangling-groupids.js — mount THẬT routes/data.js, chỉ stub tầng
// lưu trữ (lib/appData) + xác thực (lib/auth) + Nhật Ký Hệ Thống (bắt lại lời gọi thay vì no-op).
//
// Chạy: node server/tests/test-admin-perms-removed-auditlog.js
'use strict';
const http = require('http');
const path = require('path');
const express = require('express');
const { createRunner, assert, assertEqual } = require('./testHarness');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true, pass: 'hashed' };
const ADMIN2 = { id: 2, username: 'quantri2', name: 'Quản Trị Viên Thứ 2', dept: 'Phòng IT', perms: { admin: true }, active: true, pass: 'hashed' };
const STAFF = { id: 3, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: {}, active: true, pass: 'hashed' };

let APP_DATA;
function resetData() {
  APP_DATA = {
    users: [{ ...ADMIN }, { ...ADMIN2 }, { ...STAFF }],
    permGroups: [{ id: 'G_A', perms: { moduleAccess: { doc: true }, hrAttendanceManage: true } }],
    depts: ['Phòng A', 'Phòng IT'],
    employeeProfiles: [],
    submissionApprovalGroups: [], submissionApprovalLevels: [],
    contractApprovalGroups: [], contractApprovalLevels: []
  };
}
resetData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAppDataValueWithVersion: async (key) => ({ value: key in APP_DATA ? APP_DATA[key] : null, version: 'v-0' }),
  getAllAppDataWithVersionsCached: async () => ({ data: { ...APP_DATA }, versions: {} }),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: 'v-1' }; },
  withLockedAppDataValue: async (key, mutatorFn) => {
    if (!(key in APP_DATA)) APP_DATA[key] = [];
    const next = await mutatorFn(APP_DATA[key]);
    APP_DATA[key] = next;
    return next;
  }
});
let LOGGED_CALLS = [];
stubModule('lib/systemLogStore', {
  insertSystemLog: async (entry) => { LOGGED_CALLS.push(entry); },
  clearAllSystemLogs: async () => {},
  getRecentSystemLogs: async () => []
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [], cascadeUsernameChangesToTaskAssignedBy: async () => 0 });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [], cascadeUsernameChangesToWorkItemAssignment: async () => 0 });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(),
  getAllForCollectionCached: async () => [],
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async () => [],
  renameFieldValueInCollection: async () => {}
});

let CURRENT_USER = ADMIN;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = (APP_DATA.users || []).find(u => u.username === CURRENT_USER.username) || CURRENT_USER;
    req.user = { username: fresh.username, name: fresh.name, admin: !!fresh.perms?.admin };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => `hashed:${p}`,
  isBcryptHash: (v) => typeof v === 'string' && v.startsWith('hashed'),
  validatePin: () => null
});

const dataRoutes = require('../routes/data');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USER = asUser;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('Tài khoản admin KHÁC "admin" gốc mất perms.admin (true -> false) sau khi lưu -> ghi ĐÚNG 1 dòng Nhật Ký Hệ Thống mức WARNING', async () => {
      resetData();
      LOGGED_CALLS = [];
      const res = await api('POST', '/api/data/users', [
        { ...ADMIN },
        { id: 2, username: 'quantri2', name: 'Quản Trị Viên Thứ 2', dept: 'Phòng IT', perms: { admin: false }, active: true },
        { ...STAFF }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      const saved = APP_DATA.users.find(u => u.id === 2);
      assert(!saved.perms.admin, 'xác nhận perms.admin thật sự đã về false (tiền đề của test)');
      const adminRemovedLogs = LOGGED_CALLS.filter(l => l.actionType === 'ADMIN_PERMS_REMOVED');
      assertEqual(adminRemovedLogs.length, 1, `phải ghi ĐÚNG 1 dòng nhật ký ADMIN_PERMS_REMOVED, thực tế: ${JSON.stringify(LOGGED_CALLS)}`);
      assertEqual(adminRemovedLogs[0].status, 'WARNING', 'mức độ phải là WARNING');
      assertEqual(adminRemovedLogs[0].targetObject, 'quantri2', 'phải nêu đúng tài khoản bị gỡ quyền');
      assert(/quantri2/.test(adminRemovedLogs[0].description) && /admin/i.test(adminRemovedLogs[0].description), 'mô tả phải nêu rõ tài khoản + từ "Admin"');
    });

    await run.run('Tài khoản "admin" GỐC KHÔNG bao giờ mất perms.admin (đã khoá cứng từ trước) -> KHÔNG ghi nhật ký (không có gì để ghi)', async () => {
      resetData();
      LOGGED_CALLS = [];
      const res = await api('POST', '/api/data/users', [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: false }, active: true }, // cố tình gửi admin:false
        { ...ADMIN2 }, { ...STAFF }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được (server tự ép lại admin:true, không lỗi)');
      const saved = APP_DATA.users.find(u => u.id === 1);
      assertEqual(saved.perms.admin, true, 'tài khoản "admin" gốc vẫn PHẢI còn admin:true (ép cứng, không đổi được)');
      const adminRemovedLogs = LOGGED_CALLS.filter(l => l.actionType === 'ADMIN_PERMS_REMOVED');
      assertEqual(adminRemovedLogs.length, 0, 'không có gì bị gỡ thật nên không cần ghi nhật ký');
    });

    await run.run('Sửa thông tin KHÁC (không đụng tới perms.admin) của 1 tài khoản admin -> KHÔNG ghi nhật ký (tránh nhiễu)', async () => {
      resetData();
      LOGGED_CALLS = [];
      const res = await api('POST', '/api/data/users', [
        { ...ADMIN },
        { id: 2, username: 'quantri2', name: 'Quản Trị Viên Thứ 2 (đã đổi tên)', dept: 'Phòng IT', perms: { admin: true }, active: true },
        { ...STAFF }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      const saved = APP_DATA.users.find(u => u.id === 2);
      assertEqual(saved.perms.admin, true, 'vẫn còn admin:true, không hề bị gỡ');
      const adminRemovedLogs = LOGGED_CALLS.filter(l => l.actionType === 'ADMIN_PERMS_REMOVED');
      assertEqual(adminRemovedLogs.length, 0, 'không có gì bị gỡ thì không được ghi nhật ký oan');
    });

    run.summary();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
