// server/tests/test-notifications-data-route-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau LỚP 3A (task #187 — dọn dẹp tiếp theo LỚP 2,
// task #133): notifications từng được tải riêng qua where.Username (LỚP 2) rồi lọc lại bằng
// filterNotificationsForUser() — nhưng client KHÔNG hề đọc DB.notifications ở đâu cả (chuông thông báo
// header luôn dùng GET /api/notifications riêng, xem routes/notifications.js), nên field này hoàn toàn
// thừa kể từ khi notifications được migrate sang MIGRATED_COLLECTIONS. Giờ bỏ hẳn nhánh fetch/gán/lọc
// riêng cho notifications khỏi GET /api/data — test này xác nhận response KHÔNG còn field notifications
// nữa (dù bảng/collection notifications vẫn tồn tại bình thường, chỉ không đi qua route này).
//
// Chạy: node server/tests/test-notifications-data-route-scope.js
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

const USER_A = { username: 'nva', name: 'Nhân Viên A', dept: 'Phòng Kinh Doanh', perms: {}, active: true };
const ALL_USERS_LIST = [USER_A];

let APP_DATA;
function resetData() { APP_DATA = { users: ALL_USERS_LIST.map(u => ({ ...u })) }; }
resetData();

let fullLoadCallCount = 0;
let byUsernameCallCount = 0;

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['notifications']),
  getAllForCollectionCached: async (collection) => {
    if (collection === 'notifications') fullLoadCallCount++;
    return [];
  },
  getForCollectionByDeptCached: async () => [],
  getForCollectionByColumnCached: async () => [],
  getForCollectionByUsernameCached: async (collection) => {
    if (collection === 'notifications') byUsernameCallCount++;
    return [];
  }
});

let CURRENT_USERNAME = USER_A.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = ALL_USERS_LIST.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p,
  isBcryptHash: () => false,
  validatePin: () => true
});

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

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('GET /api/data: KHÔNG còn field notifications trong response (đã bỏ hẳn ở Lớp 3a, client không đọc)', async () => {
      resetData(); fullLoadCallCount = 0; byUsernameCallCount = 0;
      const res = await api('GET', '/api/data', undefined, USER_A);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual(Object.prototype.hasOwnProperty.call(res.body, 'notifications'), false, 'response KHÔNG được có field notifications nữa');
      assertEqual(fullLoadCallCount, 0, 'KHÔNG được tải notifications company-wide');
      assertEqual(byUsernameCallCount, 0, 'KHÔNG được tải notifications qua where.Username nữa — route đã bỏ hẳn nhánh này');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
