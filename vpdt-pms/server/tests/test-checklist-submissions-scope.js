// server/tests/test-checklist-submissions-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau Bước 8d: checklistSubmissions tách riêng khỏi
// vòng lặp tải chung qua loadChecklistSubmissionsScoped() — canViewChecklistSubmission()
// (lib/recordViewScope.js) có 3 nhánh (admin/checklistTemplateManage/checklistReportView xem HẾT; chính
// người nộp xem bài của mình; người posType STORE xem bài CHƯA NHÁP của ĐÚNG siêu thị mình) nên phải tải
// 2 lượt (SubmittedByUsername, StoreCode) rồi gộp+khử trùng ở Node — khác paymentRequests/
// trainingDocumentProgress (chỉ 1 điều kiện phẳng). Test này stub lib/recordStore với
// getForCollectionByColumnCached() lọc đúng theo TỪNG CỘT (mô phỏng hành vi SQL thật), mount THẲNG
// routes/data.js qua HTTP để xác nhận đúng nghiệp vụ 3 nhánh + gộp/khử trùng + an toàn khi tầng dưới lỗi.
//
// Chạy: node server/tests/test-checklist-submissions-scope.js
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

const STORE_MGR_A = { username: 'gdA', name: 'Giám Đốc Siêu Thị A', dept: 'Siêu Thị A', posType: 'STORE', perms: {}, active: true };
const STORE_MGR_B = { username: 'gdB', name: 'Giám Đốc Siêu Thị B', dept: 'Siêu Thị B', posType: 'STORE', perms: {}, active: true };
const OFFICE_USER = { username: 'nvvp', name: 'Nhân Viên Văn Phòng', dept: 'Phòng Kiểm Soát', posType: 'OFFICE', perms: {}, active: true };
const AUDITOR = { username: 'kiemtra1', name: 'Kiểm Tra Viên', dept: 'Phòng Kiểm Soát', posType: 'OFFICE', perms: { checklistReportView: true }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const USERS = [STORE_MGR_A, STORE_MGR_B, OFFICE_USER, AUDITOR, ADMIN];

let ALL_SUBMISSIONS;
function resetData() {
  ALL_SUBMISSIONS = [
    { id: 1, submittedByUsername: 'nvvp', storeCode: 'Siêu Thị A', status: 'SUBMITTED' }, // nvvp tự nộp cho A (kiểm tra viên đi tận nơi)
    { id: 2, submittedByUsername: 'gdA', storeCode: 'Siêu Thị A', status: 'DRAFT' },       // nháp của A, chưa nộp
    { id: 3, submittedByUsername: 'gdA', storeCode: 'Siêu Thị A', status: 'SUBMITTED' },   // đã nộp của A
    { id: 4, submittedByUsername: 'gdB', storeCode: 'Siêu Thị B', status: 'SUBMITTED' }    // của B, không liên quan A
  ];
}
resetData();

let byColumnCalls = [];
let fullLoadCallCount = 0;

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: {}, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['checklistSubmissions']),
  getAllForCollectionCached: async (collection) => {
    if (collection !== 'checklistSubmissions') return [];
    fullLoadCallCount++;
    return ALL_SUBMISSIONS.map(r => ({ ...r }));
  },
  // routes/data.js LUÔN gọi nhánh paymentRequests/trainingDocumentProgress bất kể test này không quan
  // tâm — chỉ cần không throw.
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async (collection, column, value) => {
    if (collection !== 'checklistSubmissions') return [];
    byColumnCalls.push(`${column}=${value}`);
    const jsField = column === 'SubmittedByUsername' ? 'submittedByUsername' : 'storeCode';
    return ALL_SUBMISSIONS.filter(r => r[jsField] === value).map(r => ({ ...r }));
  }
});

let CURRENT_USERNAME = STORE_MGR_A.username;
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
    await run.run('GD Siêu Thị A: thấy bài của MÌNH (kể cả DRAFT) + bài CHƯA NHÁP của người khác nộp cho SIÊU THỊ A, không thấy của B', async () => {
      resetData(); byColumnCalls = []; fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, STORE_MGR_A);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.checklistSubmissions || []).map(r => r.id).sort();
      // id1 (nvvp nộp cho A, SUBMITTED) + id2 (DRAFT của chính gdA) + id3 (SUBMITTED của chính gdA) — id4 (của B) KHÔNG được lộ.
      assertEqual(ids.join(','), '1,2,3', 'phải gộp đúng: bài của mình (kể cả DRAFT) + bài chưa nháp của siêu thị mình, khử trùng, không lộ của B');
      assertEqual(fullLoadCallCount, 0, 'người thường KHÔNG được tải toàn bộ company-wide');
      assert(byColumnCalls.includes('SubmittedByUsername=gdA'), 'phải có lượt tải theo SubmittedByUsername');
      assert(byColumnCalls.includes('StoreCode=Siêu Thị A'), 'phải có lượt tải theo StoreCode (posType STORE)');
    });

    await run.run('GD Siêu Thị B: chỉ thấy bài liên quan Siêu Thị B, không lộ chéo sang A', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, STORE_MGR_B);
      const ids = (res.body.checklistSubmissions || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '4', 'B chỉ thấy đúng bài của Siêu Thị B');
    });

    await run.run('Nhân viên văn phòng (posType OFFICE, không quyền quản lý): CHỈ thấy bài do CHÍNH MÌNH nộp, không tự động thấy theo dept/siêu thị nào', async () => {
      resetData(); byColumnCalls = [];
      const res = await api('GET', '/api/data', undefined, OFFICE_USER);
      const ids = (res.body.checklistSubmissions || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1', 'nvvp chỉ thấy đúng bài do mình nộp (id1), không có nhánh StoreCode vì không phải posType STORE');
      assert(!byColumnCalls.some(c => c.startsWith('StoreCode=')), 'người không phải posType STORE KHÔNG được có lượt tải theo StoreCode');
    });

    await run.run('checklistReportView: nhận ĐỦ toàn bộ bài nộp (mọi siêu thị, kể cả DRAFT)', async () => {
      resetData(); fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, AUDITOR);
      const ids = (res.body.checklistSubmissions || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'checklistReportView phải thấy đủ cả 4 bài, mọi siêu thị, kể cả DRAFT');
      assert(fullLoadCallCount >= 1, 'checklistReportView phải tải theo nhánh company-wide như cũ');
    });

    await run.run('admin: nhận ĐỦ toàn bộ bài nộp', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      const ids = (res.body.checklistSubmissions || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'admin phải thấy đủ cả 4 bài');
    });

    await run.run('dù nhánh tải trả THỪA (giả lập lỗi tầng dưới), filterChecklistSubmissionsForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData();
      stubModule('lib/recordStore', {
        MIGRATED_COLLECTIONS: new Set(['checklistSubmissions']),
        // Chỉ trả thừa cho ĐÚNG checklistSubmissions — collection khác (docs/submissions/attendanceRecords...
        // cũng gọi các hàm này KHÔNG điều kiện ở routes/data.js) phải trả đúng rỗng, tránh vô tình "nhồi"
        // dữ liệu sai hình dạng khiến canViewDoc()/canViewSubmission() (đọc appData thật qua
        // getAppDataValue(), KHÔNG stub ở test này) ném lỗi ngoài ý muốn.
        getAllForCollectionCached: async (collection) => (collection === 'checklistSubmissions' ? ALL_SUBMISSIONS.map(r => ({ ...r })) : []),
        getForCollectionByDeptCached: async () => [],
        getForCollectionByUsernameCached: async () => [],
        getForCollectionByColumnCached: async (collection) => (collection === 'checklistSubmissions' ? ALL_SUBMISSIONS.map(r => ({ ...r })) : []) // CỐ Ý trả thừa mọi siêu thị
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
      CURRENT_USERNAME = STORE_MGR_A.username;
      const res = await fetch(`http://127.0.0.1:${port2}/api/data`);
      const body = await res.json();
      server2.close();
      const ids = (body.checklistSubmissions || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3', 'dù tầng tải trả thừa (kể cả bài của B), filterChecklistSubmissionsForUser() vẫn phải chốt đúng phạm vi của A');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
