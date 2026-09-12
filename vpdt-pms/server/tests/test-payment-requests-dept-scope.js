// server/tests/test-payment-requests-dept-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau Bước 8b: paymentRequests tách riêng khỏi vòng
// lặp tải chung (getAllForCollectionCached() company-wide) — người có admin/paymentManage vẫn tải toàn
// bộ như cũ, còn lại tải qua getForCollectionByDeptCached() (lọc where.Dept ngay ở SQL, lib/recordStore.js
// Bước 8b). Test này stub lib/appData/lib/recordStore/lib/taskStore/lib/operationWorkItemStore/lib/auth
// (cùng khuôn stubModule() ở tests/test-payroll.js/test-notifications.js) rồi mount THẲNG router thật
// (routes/data.js) qua HTTP — xác nhận đúng NGHIỆP VỤ của nhánh mới: người thường chỉ nhận đúng phòng ban
// mình (không lộ phòng ban khác), admin/paymentManage vẫn nhận đủ toàn công ty (không mất dữ liệu).
//
// Chạy: node server/tests/test-payment-requests-dept-scope.js
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

const REGULAR_A = { username: 'nva', name: 'Nhân Viên A', dept: 'Phòng Kinh Doanh', perms: {}, active: true };
const REGULAR_B = { username: 'ntb', name: 'Nhân Viên B', dept: 'Phòng Kế Toán', perms: {}, active: true };
const PAYMENT_MGR = { username: 'ketoan1', name: 'Kế Toán Trưởng', dept: 'Phòng Kế Toán', perms: { paymentManage: true }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const USERS = [REGULAR_A, REGULAR_B, PAYMENT_MGR, ADMIN];

// paymentRequests toàn công ty (mô phỏng bảng thật dbo.PaymentRequests) — nguồn DUY NHẤT cho cả 2 nhánh
// tải (getAllForCollectionCached giả lập trả NGUYÊN mảng; getForCollectionByDeptCached giả lập tự lọc
// theo dept, đúng khớp hành vi thật của SQL where.Dept).
let ALL_PAYMENT_REQUESTS;
function resetData() {
  ALL_PAYMENT_REQUESTS = [
    { id: 1, dept: 'Phòng Kinh Doanh', amount: 1000000, status: 'PENDING' },
    { id: 2, dept: 'Phòng Kế Toán', amount: 2000000, status: 'APPROVED' },
    { id: 3, dept: 'Phòng Kinh Doanh', amount: 3000000, status: 'PAID' }
  ];
}
resetData();

let byDeptCallCount = 0;
let fullLoadCallCount = 0;

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: {}, versions: {} })
});

stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });

stubModule('lib/recordStore', {
  // MIGRATED_COLLECTIONS CHỈ chứa paymentRequests cho test này — routes/data.js filter nó ra khỏi
  // migratedList (Bước 8b), nên vòng lặp tải chung ("getAllForCollectionCached(collection)" áp cho các
  // collection KHÁC) sẽ chạy trên danh sách RỖNG, không cần giả lập thêm gì cho 54 collection còn lại.
  MIGRATED_COLLECTIONS: new Set(['paymentRequests']),
  getAllForCollectionCached: async (collection) => {
    if (collection !== 'paymentRequests') return [];
    fullLoadCallCount++;
    return ALL_PAYMENT_REQUESTS.map(r => ({ ...r }));
  },
  getForCollectionByDeptCached: async (collection, dept) => {
    if (collection !== 'paymentRequests') return [];
    byDeptCallCount++;
    return ALL_PAYMENT_REQUESTS.filter(r => r.dept === dept).map(r => ({ ...r }));
  },
  // routes/data.js (Bước 8c) LUÔN gọi nhánh trainingDocumentProgress bất kể test này không quan tâm tới
  // collection đó — chỉ cần không throw, trả rỗng là đủ (không ảnh hưởng các assertion về paymentRequests).
  getForCollectionByUsernameCached: async () => []
});

let CURRENT_USERNAME = REGULAR_A.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
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
    await run.run('GET /api/data: người thường (không paymentManage) chỉ nhận paymentRequests ĐÚNG phòng ban mình', async () => {
      resetData(); byDeptCallCount = 0; fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, REGULAR_A);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.paymentRequests || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,3', 'Phòng Kinh Doanh (A) phải thấy đúng 2 hồ sơ của phòng mình');
      assert(res.body.paymentRequests.every(r => r.dept === 'Phòng Kinh Doanh'), 'không được lẫn hồ sơ phòng khác');
      assert(byDeptCallCount >= 1, 'phải đi qua nhánh tải theo-phòng-ban (getForCollectionByDeptCached)');
      assertEqual(fullLoadCallCount, 0, 'người thường KHÔNG được tải toàn bộ company-wide');
    });

    await run.run('GET /api/data: người thường phòng khác (B) không thấy hồ sơ của A, không lộ chéo phòng ban', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, REGULAR_B);
      const ids = (res.body.paymentRequests || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '2', 'Phòng Kế Toán (B) chỉ thấy đúng 1 hồ sơ của phòng mình');
    });

    await run.run('GET /api/data: paymentManage vẫn nhận ĐỦ toàn công ty (không mất dữ liệu so với trước)', async () => {
      resetData(); byDeptCallCount = 0; fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, PAYMENT_MGR);
      const ids = (res.body.paymentRequests || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3', 'paymentManage phải thấy đủ cả 3 hồ sơ, mọi phòng ban');
      assertEqual(byDeptCallCount, 0, 'paymentManage KHÔNG được đi qua nhánh theo-phòng-ban');
      assert(fullLoadCallCount >= 1, 'paymentManage phải tải theo nhánh company-wide như cũ');
    });

    await run.run('GET /api/data: admin vẫn nhận ĐỦ toàn công ty', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      const ids = (res.body.paymentRequests || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3', 'admin phải thấy đủ cả 3 hồ sơ');
    });

    await run.run('GET /api/data: dù nhánh tải theo-phòng-ban trả THỪA (giả lập lỗi tầng dưới), filterPaymentRequestsForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData();
      // Giả lập 1 tình huống getForCollectionByDeptCached() lỡ trả THỪA (như thể where.Dept không được áp
      // đúng) — xác nhận filterPaymentRequestsForUser() ở routes/data.js vẫn lọc lại đúng, không tin
      // riêng nhánh tải SQL.
      stubModule('lib/recordStore', {
        MIGRATED_COLLECTIONS: new Set(['paymentRequests']),
        getAllForCollectionCached: async () => ALL_PAYMENT_REQUESTS.map(r => ({ ...r })),
        getForCollectionByDeptCached: async () => ALL_PAYMENT_REQUESTS.map(r => ({ ...r })), // CỐ Ý trả thừa mọi phòng ban
        getForCollectionByUsernameCached: async () => []
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
      CURRENT_USERNAME = REGULAR_A.username;
      const res = await fetch(`http://127.0.0.1:${port2}/api/data`);
      const body = await res.json();
      server2.close();
      const ids = (body.paymentRequests || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,3', 'dù tầng tải trả thừa, filterPaymentRequestsForUser() vẫn phải chốt đúng còn 2 hồ sơ của A');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
