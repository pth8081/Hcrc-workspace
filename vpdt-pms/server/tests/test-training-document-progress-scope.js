// server/tests/test-training-document-progress-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau Bước 8c: trainingDocumentProgress tách riêng
// khỏi vòng lặp tải chung — người có admin/trainingManage vẫn tải toàn bộ như cũ, còn lại tải qua
// getForCollectionByUsernameCached() (lọc where.Username ngay ở SQL, lib/recordStore.js Bước 8b/8c).
// Cùng khuôn tests/test-payment-requests-dept-scope.js: stub lib/appData/lib/recordStore/lib/taskStore/
// lib/operationWorkItemStore/lib/auth rồi mount THẲNG router thật (routes/data.js) qua HTTP.
//
// Chạy: node server/tests/test-training-document-progress-scope.js
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
const TRAINING_MGR = { username: 'daotao1', name: 'Quản Lý Đào Tạo', dept: 'Phòng Nhân Sự', perms: { trainingManage: true }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const USERS = [REGULAR_A, REGULAR_B, TRAINING_MGR, ADMIN];

let ALL_PROGRESS;
function resetData() {
  ALL_PROGRESS = [
    { id: 1, username: 'nva', docId: 100, secondsWatched: 120 },
    { id: 2, username: 'ntb', docId: 100, secondsWatched: 45 },
    { id: 3, username: 'nva', docId: 200, secondsWatched: 300 }
  ];
}
resetData();

let byUsernameCallCount = 0;
let fullLoadCallCount = 0;

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: {}, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['trainingDocumentProgress']),
  getAllForCollectionCached: async (collection) => {
    if (collection !== 'trainingDocumentProgress') return [];
    fullLoadCallCount++;
    return ALL_PROGRESS.map(r => ({ ...r }));
  },
  // routes/data.js (Bước 8b) LUÔN gọi nhánh paymentRequests bất kể test này không quan tâm — chỉ cần
  // không throw.
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async (collection, username) => {
    if (collection !== 'trainingDocumentProgress') return [];
    byUsernameCallCount++;
    return ALL_PROGRESS.filter(r => r.username === username).map(r => ({ ...r }));
  }
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
    await run.run('GET /api/data: người thường (không trainingManage) chỉ nhận tiến độ đọc tài liệu của CHÍNH MÌNH', async () => {
      resetData(); byUsernameCallCount = 0; fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, REGULAR_A);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.trainingDocumentProgress || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,3', 'A phải thấy đúng 2 bản ghi tiến độ của mình');
      assert(res.body.trainingDocumentProgress.every(r => r.username === 'nva'), 'không được lẫn tiến độ của người khác');
      assert(byUsernameCallCount >= 1, 'phải đi qua nhánh tải theo-username (getForCollectionByUsernameCached)');
      assertEqual(fullLoadCallCount, 0, 'người thường KHÔNG được tải toàn bộ company-wide');
    });

    await run.run('GET /api/data: người thường khác (B) không thấy tiến độ của A, không lộ chéo người dùng (IDOR-safe)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, REGULAR_B);
      const ids = (res.body.trainingDocumentProgress || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '2', 'B chỉ thấy đúng 1 bản ghi tiến độ của mình');
    });

    await run.run('GET /api/data: trainingManage vẫn nhận ĐỦ tiến độ của MỌI người (không mất dữ liệu so với trước)', async () => {
      resetData(); byUsernameCallCount = 0; fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, TRAINING_MGR);
      const ids = (res.body.trainingDocumentProgress || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3', 'trainingManage phải thấy đủ cả 3 bản ghi, mọi người dùng');
      assertEqual(byUsernameCallCount, 0, 'trainingManage KHÔNG được đi qua nhánh theo-username');
      assert(fullLoadCallCount >= 1, 'trainingManage phải tải theo nhánh company-wide như cũ');
    });

    await run.run('GET /api/data: admin vẫn nhận ĐỦ tiến độ của MỌI người', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      const ids = (res.body.trainingDocumentProgress || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3', 'admin phải thấy đủ cả 3 bản ghi');
    });

    await run.run('GET /api/data: dù nhánh tải theo-username trả THỪA (giả lập lỗi tầng dưới), filterTrainingDocumentProgressForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData();
      stubModule('lib/recordStore', {
        MIGRATED_COLLECTIONS: new Set(['trainingDocumentProgress']),
        getAllForCollectionCached: async () => ALL_PROGRESS.map(r => ({ ...r })),
        getForCollectionByDeptCached: async () => [],
        getForCollectionByUsernameCached: async () => ALL_PROGRESS.map(r => ({ ...r })) // CỐ Ý trả thừa của MỌI người
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
      const ids = (body.trainingDocumentProgress || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,3', 'dù tầng tải trả thừa, filterTrainingDocumentProgressForUser() vẫn phải chốt đúng còn 2 bản ghi của A');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
