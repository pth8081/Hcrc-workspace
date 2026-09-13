// server/tests/test-user-username-uniqueness.js
//
// USER-BULK-02: routes/data.js prepareUsersForSave() (điểm ghi duy nhất cho collection "users", xem
// POST /api/data/users) trước đây chỉ khớp bản ghi theo "id", KHÔNG hề kiểm tra "username" có bị trùng
// giữa nhiều tài khoản hay không — trong khi mọi chỗ đăng nhập/đặt lại mật khẩu/khoá tài khoản
// (routes/auth.js, hàng chục chỗ `users.find(u => u.username === username)`) đều chỉ thấy được tài
// khoản ĐỨNG TRƯỚC trong mảng, khiến tài khoản trùng username còn lại thành "tài khoản ma" không ai
// đăng nhập/quản lý được và hành vi phụ thuộc thứ tự mảng (không dự đoán được qua các lần lưu).
//
// Chạy: node server/tests/test-user-username-uniqueness.js
'use strict';
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

const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const NV1 = { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: {}, active: true };

let APP_DATA;
function resetData() {
  APP_DATA = { users: [{ ...ADMIN }, { ...NV1 }], permGroups: [] };
}
resetData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => APP_DATA[key],
  getAppDataValueWithVersion: async (key) => ({ value: APP_DATA[key], version: '1' }),
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} }),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: '2' }; },
  withLockedAppDataValue: async (key, fn) => { const result = await fn(APP_DATA[key]); APP_DATA[key] = result; return result; }
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => { req.user = { username: 'admin' }; req.freshUser = ADMIN; next(); },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p,
  isBcryptHash: () => false,
  validatePin: () => null
});
stubModule('lib/adminAuth', {
  isCurrentlyAdmin: async () => true,
  isCurrentlyAdminOrUniformManage: async () => true
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', { MIGRATED_COLLECTIONS: new Set(), getAllForCollectionCached: async () => [], getForCollectionByDeptCached: async () => [], getForCollectionByUsernameCached: async () => [], getForCollectionByColumnCached: async () => [] });

const express = require('express');
const { createRunner, assertEqual } = require('./testHarness');
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

async function api(method, urlPath, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
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
    await run.run('USER-BULK-02: 2 tài khoản khác id nhưng CÙNG username -> 400, không ghi gì', async () => {
      resetData();
      const payload = [
        { ...ADMIN },
        { ...NV1 },
        { id: 3, username: 'nv1', name: 'Nhân Viên 3 (trùng username với nv1)', dept: 'Phòng B', perms: {}, active: true }
      ];
      const res = await api('POST', '/api/data/users', payload);
      assertEqual(res.status, 400, 'phải bị chặn 400 khi có 2 tài khoản trùng username');
      assertEqual(/nv1/.test(res.body.error) && /trùng/.test(res.body.error), true, `thông báo lỗi phải nêu đúng username trùng, got: ${JSON.stringify(res.body)}`);
      assertEqual(APP_DATA.users.length, 2, 'KHÔNG được ghi đè "users" khi request bị chặn');
    });

    await run.run('USER-BULK-02: username khác nhau hoàn toàn -> vẫn lưu bình thường (không bị chặn oan)', async () => {
      resetData();
      const payload = [
        { ...ADMIN },
        { ...NV1 },
        { id: 3, username: 'nv3', name: 'Nhân Viên 3', dept: 'Phòng B', perms: {}, active: true }
      ];
      const res = await api('POST', '/api/data/users', payload);
      assertEqual(res.status, 200, `phải lưu thành công khi username không trùng nhau, got: ${JSON.stringify(res.body)}`);
      assertEqual(APP_DATA.users.length, 3, 'phải ghi đủ 3 tài khoản');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
