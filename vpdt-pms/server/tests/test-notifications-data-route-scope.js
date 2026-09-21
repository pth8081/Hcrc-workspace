// server/tests/test-notifications-data-route-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau LỚP 2 (task #133 — tối ưu tốc độ sau đăng
// nhập, đợt rà soát chuyên sâu vòng 2): notifications trước đây nằm trong vòng lặp tải chung
// (getAllForCollectionCached — company-wide, MỌI thông báo của MỌI người) rồi mới lọc còn đúng của
// mình ở filterNotificationsForUser() — nay tải qua where.Username NGAY Ở SQL
// (getForCollectionByUsernameCached), vì canViewNotification() (lib/notifications.js) chỉ có ĐÚNG 1
// điều kiện phẳng "item.username === user.username", KHÔNG có nhánh admin/quản lý xem hết nào — nên
// MỌI người dùng, kể cả admin, đều đi qua nhánh SQL hẹp này, không có nhánh company-wide nào cả.
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
const USER_B = { username: 'ntb', name: 'Nhân Viên B', dept: 'Phòng Kế Toán', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const ALL_USERS_LIST = [USER_A, USER_B, ADMIN];

let APP_DATA;
function resetData() { APP_DATA = { users: ALL_USERS_LIST.map(u => ({ ...u })) }; }
resetData();

let ALL_NOTIFICATIONS;
function resetRecords() {
  ALL_NOTIFICATIONS = [
    { id: 1, username: 'nva', isRead: false, type: 'TEST', title: 'A1', message: 'M', linkTo: null },
    { id: 2, username: 'ntb', isRead: false, type: 'TEST', title: 'B1', message: 'M', linkTo: null },
    { id: 3, username: 'nva', isRead: true, type: 'TEST', title: 'A2', message: 'M', linkTo: null }
  ];
}
resetRecords();

let fullLoadCallCount = 0;
let byColumnCalls = [];

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['notifications']),
  getAllForCollectionCached: async (collection) => {
    if (collection !== 'notifications') return [];
    fullLoadCallCount++;
    return ALL_NOTIFICATIONS.map(r => ({ ...r }));
  },
  getForCollectionByDeptCached: async () => [],
  getForCollectionByColumnCached: async (collection, column, value) => {
    if (collection !== 'notifications') return [];
    if (column === 'Username') {
      byColumnCalls.push(value);
      return ALL_NOTIFICATIONS.filter(r => r.username === value).map(r => ({ ...r }));
    }
    return [];
  },
  getForCollectionByUsernameCached: async (collection, username) => {
    if (collection !== 'notifications') return [];
    byColumnCalls.push(username);
    return ALL_NOTIFICATIONS.filter(r => r.username === username).map(r => ({ ...r }));
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
const { createRunner, assertEqual, assert } = require('./testHarness');
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
    await run.run('Nhân viên thường (nva): chỉ nhận thông báo ĐÚNG của mình, tải qua where.Username (không company-wide)', async () => {
      resetData(); resetRecords(); fullLoadCallCount = 0; byColumnCalls = [];
      const res = await api('GET', '/api/data', undefined, USER_A);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.notifications || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,3', 'nva phải thấy đúng 2 thông báo của mình (id 1, 3), không thấy id 2 của ntb');
      assertEqual(fullLoadCallCount, 0, 'KHÔNG được tải company-wide cho người dùng thường');
      assert(byColumnCalls.includes('nva'), 'phải gọi đúng where.Username=nva');
    });

    await run.run('Nhân viên khác (ntb): chỉ thấy thông báo của mình, không lộ chéo sang nva', async () => {
      resetData(); resetRecords();
      const res = await api('GET', '/api/data', undefined, USER_B);
      const ids = (res.body.notifications || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '2', 'ntb chỉ thấy đúng thông báo id 2 của mình');
    });

    await run.run('admin: KHÔNG có ngoại lệ "xem hết" — cũng chỉ thấy thông báo của CHÍNH MÌNH (canViewNotification không có nhánh admin), không tải company-wide', async () => {
      resetData(); resetRecords(); fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, ADMIN);
      const ids = (res.body.notifications || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '', 'admin không có thông báo nào của riêng mình trong dữ liệu test -> danh sách rỗng, KHÔNG lộ của nva/ntb');
      assertEqual(fullLoadCallCount, 0, 'admin cũng không được tải company-wide (đúng bản chất notifications: không có ai "xem hết")');
    });

    await run.run('dù nhánh tải trả THỪA (giả lập lỗi tầng dưới), filterNotificationsForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData(); resetRecords();
      stubModule('lib/recordStore', {
        MIGRATED_COLLECTIONS: new Set(['notifications']),
        getAllForCollectionCached: async (collection) => (collection === 'notifications' ? ALL_NOTIFICATIONS.map(r => ({ ...r })) : []),
        getForCollectionByDeptCached: async () => [],
        getForCollectionByColumnCached: async (collection) => (collection === 'notifications' ? ALL_NOTIFICATIONS.map(r => ({ ...r })) : []),
        // CỐ Ý trả thừa (mọi username) — collection khác vẫn phải trả đúng rỗng, tránh "nhồi" dữ liệu sai
        // hình dạng khiến canViewDoc()/canViewSubmission() (đọc appData thật, KHÔNG stub ở test này) lỗi.
        getForCollectionByUsernameCached: async (collection) => (collection === 'notifications' ? ALL_NOTIFICATIONS.map(r => ({ ...r })) : [])
      });
      delete require.cache[require.resolve('../routes/data')];
      const freshDataRoutes = require('../routes/data');
      const app2 = express();
      app2.use(express.json());
      app2.use('/api/data', freshDataRoutes);
      const server2 = await new Promise((resolve, reject) => {
        const s = http.createServer(app2);
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => resolve(s));
      });
      const port2 = server2.address().port;
      CURRENT_USERNAME = USER_A.username;
      const res = await fetch(`http://127.0.0.1:${port2}/api/data`);
      const body = await res.json();
      server2.close();
      const ids = (body.notifications || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,3', 'dù tầng tải trả thừa, filterNotificationsForUser() vẫn phải chốt đúng còn thông báo của chính nva');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
