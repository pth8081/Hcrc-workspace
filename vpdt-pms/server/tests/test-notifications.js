// server/tests/test-notifications.js
//
// Regression test cho routes/notifications.js sau Bước 8a: GET /api/notifications và
// POST /api/notifications/mark-all-read chuyển từ getAllForCollection('notifications') (quét NGUYÊN
// bảng, mọi người dùng) sang queryDedicatedRecords() lọc where.Username NGAY Ở SQL. Test này KHÔNG
// dùng mock SQL engine đầy đủ như test-query-dedicated-records.js (đã xác nhận riêng đúng shape SQL) —
// stub queryDedicatedRecords() bằng 1 bản lọc/sắp/phân trang tối giản trên mảng RECORDS.notifications
// trong bộ nhớ (cùng khuôn stubModule('lib/recordStore', ...) ở test-payroll.js), tập trung xác nhận
// ĐÚNG NGHIỆP VỤ của route: mỗi người chỉ thấy thông báo của mình (IDOR-safe), unreadCount phải là số
// THẬT (không bị giới hạn bởi trang 100 bản ghi mới nhất — lỗi có sẵn đã sửa trong đợt này), và
// mark-all-read chỉ đụng đúng thông báo chưa đọc CỦA NGƯỜI GỌI.
//
// Chạy: node server/tests/test-notifications.js
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

const USER_A = { username: 'nva', name: 'Nguyễn Văn A', dept: 'Phòng Kinh Doanh', perms: {}, active: true };
const USER_B = { username: 'ntb', name: 'Nguyễn Thị B', dept: 'Phòng Kế Toán', perms: {}, active: true };
const USERS = [USER_A, USER_B];

let RECORDS;
function resetRecords() { RECORDS = { notifications: [] }; }
resetRecords();

// Chỉ cần đủ 2 cột thật sự dùng trong routes/notifications.js (Username/IsRead) — khớp
// DEDICATED_TABLES.notifications.columns ở lib/recordStore.js, không cần mọi cột cho mọi collection.
function fakeQueryDedicatedRecords(collection, opts) {
  opts = opts || {};
  const where = opts.where || {};
  const rows = RECORDS[collection] || [];
  const colToField = { Username: 'username', IsRead: 'isRead' };
  let filtered = rows.filter(r => Object.entries(where).every(([col, val]) => {
    if (val == null) return true;
    const field = colToField[col];
    return field ? r[field] === val : true; // cột lạ bỏ qua âm thầm, khớp đúng hành vi thật
  }));
  filtered = filtered.slice().sort((a, b) => b.id - a.id);
  const total = filtered.length;
  let items = filtered;
  if (opts.page != null && opts.pageSize != null) {
    const offset = (opts.page - 1) * opts.pageSize;
    items = filtered.slice(offset, offset + opts.pageSize);
  }
  return Promise.resolve({ items: items.map(r => ({ ...r })), total });
}

stubModule('lib/recordStore', {
  queryDedicatedRecords: (collection, opts) => fakeQueryDedicatedRecords(collection, opts),
  withLockedRecordForCollection: async (collection, id, mutatorFn) => {
    const list = RECORDS[collection] || [];
    const idx = list.findIndex(r => r.id === id);
    if (idx === -1) { const err = new Error('Không tìm thấy bản ghi'); err.statusCode = 404; throw err; }
    const updated = await mutatorFn(list[idx]);
    list[idx] = updated;
    return updated;
  }
});

let CURRENT_USERNAME = USER_A.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const { createRunner, assertEqual, assert } = require('./testHarness');
const notificationsRoutes = require('../routes/notifications');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationsRoutes);
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

let idSeq = 1;
function seedNotification(username, isRead) {
  const n = { id: idSeq++, username, isRead: !!isRead, type: 'TEST', title: 'T', message: 'M', linkTo: null };
  RECORDS.notifications.push(n);
  return n;
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('GET /: chỉ trả thông báo của CHÍNH NGƯỜI GỌI, không lộ của người khác (IDOR-safe)', async () => {
      resetRecords();
      seedNotification('nva', false);
      seedNotification('nva', true);
      seedNotification('ntb', false); // của B, KHÔNG được xuất hiện khi A gọi

      const res = await api('GET', '/api/notifications', undefined, USER_A);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual(res.body.notifications.length, 2, 'A phải thấy đúng 2 thông báo của mình');
      assert(res.body.notifications.every(n => n.username === 'nva'), 'không được lẫn thông báo của B');
    });

    await run.run('GET /: sắp mới nhất trước (id giảm dần), khớp filterNotificationsForUser().sort()', async () => {
      resetRecords();
      const n1 = seedNotification('nva', false);
      const n2 = seedNotification('nva', false);
      const n3 = seedNotification('nva', false);

      const res = await api('GET', '/api/notifications', undefined, USER_A);
      assertEqual(res.body.notifications.map(n => n.id).join(','), [n3.id, n2.id, n1.id].join(','), 'phải sắp mới nhất trước');
    });

    await run.run('GET /: unreadCount là số THẬT, KHÔNG bị giới hạn bởi trang 100 bản ghi mới nhất (lỗi đã sửa)', async () => {
      resetRecords();
      // 120 thông báo CHƯA ĐỌC cho A -> vượt quá pageSize:100 của khối "notifications" trả về, nhưng
      // unreadCount PHẢI vẫn là 120 (đếm bằng truy vấn riêng, không suy từ mảng đã cắt 100 phần tử).
      for (let i = 0; i < 120; i++) seedNotification('nva', false);
      seedNotification('nva', true); // 1 cái đã đọc, không tính vào unreadCount

      const res = await api('GET', '/api/notifications', undefined, USER_A);
      assertEqual(res.body.notifications.length, 100, 'khối thông báo hiển thị vẫn giới hạn 100 bản ghi mới nhất');
      assertEqual(res.body.unreadCount, 120, 'unreadCount phải đếm ĐỦ 120, không bị cắt còn tối đa 100');
    });

    await run.run('GET /: unreadCount không tính nhầm thông báo CỦA NGƯỜI KHÁC', async () => {
      resetRecords();
      seedNotification('nva', false); // A: 1 chưa đọc
      seedNotification('ntb', false); // B: 1 chưa đọc, không được cộng vào unreadCount của A
      seedNotification('ntb', false);

      const res = await api('GET', '/api/notifications', undefined, USER_A);
      assertEqual(res.body.unreadCount, 1, 'unreadCount của A không được cộng thông báo của B');
    });

    await run.run('POST /mark-all-read: chỉ đánh dấu đã đọc thông báo CHƯA ĐỌC của người gọi, không đụng của người khác', async () => {
      resetRecords();
      const a1 = seedNotification('nva', false);
      const a2 = seedNotification('nva', false);
      const aRead = seedNotification('nva', true);
      const b1 = seedNotification('ntb', false);

      const res = await api('POST', '/api/notifications/mark-all-read', {}, USER_A);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual(res.body.count, 2, 'phải đánh dấu đúng 2 thông báo chưa đọc của A');
      assert(RECORDS.notifications.find(n => n.id === a1.id).isRead, 'a1 phải chuyển thành đã đọc');
      assert(RECORDS.notifications.find(n => n.id === a2.id).isRead, 'a2 phải chuyển thành đã đọc');
      assert(RECORDS.notifications.find(n => n.id === aRead.id).isRead, 'aRead vẫn còn đã đọc (không đổi)');
      assert(!RECORDS.notifications.find(n => n.id === b1.id).isRead, 'thông báo của B KHÔNG được đụng tới');
    });

    await run.run('PATCH /:id/read: vẫn chặn đánh dấu đã đọc hộ thông báo của người khác (không đổi hành vi cũ)', async () => {
      resetRecords();
      const b1 = seedNotification('ntb', false);

      const res = await api('PATCH', `/api/notifications/${b1.id}/read`, {}, USER_A);
      assertEqual(res.status, 403, 'A không được đánh dấu đã đọc thông báo của B');
      assert(!RECORDS.notifications.find(n => n.id === b1.id).isRead, 'thông báo của B phải vẫn CHƯA đọc');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
