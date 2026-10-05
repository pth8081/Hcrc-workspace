// server/tests/test-budget-entries-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau Bước 8j: budgetEntries tách riêng khỏi vòng
// lặp tải chung qua loadBudgetEntriesScoped(). canViewBudgetEntry() (lib/recordViewScope.js) đơn giản
// nhất trong nhóm này — 3 nhánh: admin/budgetManage/budgetAggregate xem hết, phòng ban mình, người duyệt
// theo budgetDeptWorkflows (dept-keyed, 1 cấu hình duy nhất). KHÔNG có nhánh "chính người tạo".
//
// Chạy: node server/tests/test-budget-entries-scope.js
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

const REGULAR_A = { username: 'nva', name: 'Nhân Viên A', dept: 'Phòng A', perms: {}, active: true };
const APPROVER_B = { username: 'duyet_b', name: 'Người Duyệt Phòng B', dept: 'Phòng Z', perms: {}, active: true };
const BUDGET_MGR = { username: 'ketoan1', name: 'Quản Lý Ngân Sách', dept: 'Phòng Kế Toán', perms: { budgetManage: true }, active: true };
const BUDGET_AGG = { username: 'tonghop1', name: 'Người Xem Tổng Hợp', dept: 'Phòng Kế Toán', perms: { budgetAggregate: true }, active: true };
// BUDGET_REPORT_VIEWER/REGULAR_B/MANAGER_OF_B: thêm cho đợt vá Cao #2 (rà soát v24.74→v24.90, 10/2026) —
// loadBudgetEntriesScoped() trước đây thiếu HẲN budgetReportView + deptViewScopeConfig['budget']
// (extraViewers/managerCanView), khớp đúng gap đã vá ở loadBudgetLinesScoped() (test-budget-lines-dept-
// scope.js) nhưng chưa từng được mirror sang budgetEntries.
const BUDGET_REPORT_VIEWER = { username: 'baocao1', name: 'Người Xem Báo Cáo Ngân Sách', dept: 'Phòng Kế Toán', perms: { budgetReportView: true }, active: true };
const REGULAR_B = { username: 'nvb', name: 'Nhân Viên B', dept: 'Phòng B', perms: {}, active: true, managerUsername: 'qlb' };
const MANAGER_OF_B = { username: 'qlb', name: 'Quản Lý Của B', dept: 'Phòng Z', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const USERS = [REGULAR_A, APPROVER_B, BUDGET_MGR, BUDGET_AGG, BUDGET_REPORT_VIEWER, REGULAR_B, MANAGER_OF_B, ADMIN];

const APP_DATA = {
  budgetDeptWorkflows: {
    'Phòng B': { approvers: { 1: ['duyet_b'] } }
  },
  users: USERS
};

let ALL_ENTRIES;
function resetData() {
  ALL_ENTRIES = [
    { id: 1, dept: 'Phòng A', creator: 'nva' },
    { id: 2, dept: 'Phòng B', creator: 'duyet_b' },
    { id: 3, dept: 'Phòng C', creator: 'someone_else' },
    { id: 4, dept: 'Phòng C', creator: 'nvb' } // của REGULAR_B (nvb), phòng KHÁC phòng nvb (Phòng B) — chỉ managerCanView mới thấy được qua MANAGER_OF_B
  ];
  delete APP_DATA.deptViewScopeConfig;
}
resetData();

let fullLoadCallCount = 0;
let byDeptCalls = [];

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['budgetEntries']),
  getAllForCollectionCached: async (collection) => {
    if (collection !== 'budgetEntries') return [];
    fullLoadCallCount++;
    return ALL_ENTRIES.map(r => ({ ...r }));
  },
  getForCollectionByDeptCached: async (collection, dept) => {
    if (collection !== 'budgetEntries') return [];
    byDeptCalls.push(dept);
    return ALL_ENTRIES.filter(r => r.dept === dept).map(r => ({ ...r }));
  },
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async () => []
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
    await run.run('Nhân viên thường: chỉ thấy hồ sơ ngân sách ĐÚNG phòng ban mình', async () => {
      resetData(); byDeptCalls = []; fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, REGULAR_A);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.budgetEntries || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1', 'Phòng A (nva) chỉ thấy đúng hồ sơ của phòng mình');
      assertEqual(fullLoadCallCount, 0, 'người thường KHÔNG được tải toàn bộ company-wide');
    });

    await run.run('Người duyệt Phòng B: PHẢI thấy hồ sơ Phòng B dù không phải phòng mình', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, APPROVER_B);
      const ids = (res.body.budgetEntries || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '2', 'duyet_b phải thấy id2 (Phòng B, đang duyệt)');
    });

    await run.run('budgetManage: nhận ĐỦ toàn bộ', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, BUDGET_MGR);
      const ids = (res.body.budgetEntries || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'budgetManage phải thấy đủ cả 4 hồ sơ');
    });

    await run.run('budgetAggregate: nhận ĐỦ toàn bộ', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, BUDGET_AGG);
      const ids = (res.body.budgetEntries || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'budgetAggregate phải thấy đủ cả 4 hồ sơ');
    });

    await run.run('admin: nhận ĐỦ toàn bộ', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      const ids = (res.body.budgetEntries || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'admin phải thấy đủ cả 4 hồ sơ');
    });

    // --- Đợt vá Cao #2 (rà soát v24.74→v24.90, 10/2026) ---
    await run.run('budgetReportView: nhận ĐỦ toàn bộ dù KHÔNG có budgetManage/budgetAggregate (gap vừa vá)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, BUDGET_REPORT_VIEWER);
      const ids = (res.body.budgetEntries || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'budgetReportView phải thấy đủ cả 4 hồ sơ, giống budgetManage');
    });

    await run.run('deptViewScopeConfig.budget.extraViewers=[nvb] -> B nhận ĐỦ toàn công ty dù KHÔNG có quyền quản lý nào (gap vừa vá)', async () => {
      resetData();
      APP_DATA.deptViewScopeConfig = { budget: { mode: 'DEPT', extraViewers: [REGULAR_B.username], managerCanView: false } };
      const res = await api('GET', '/api/data', undefined, REGULAR_B);
      const ids = (res.body.budgetEntries || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'extraViewers phải thấy đủ cả 4 dòng, mọi phòng ban');
      delete APP_DATA.deptViewScopeConfig;
    });

    await run.run('deptViewScopeConfig.budget.managerCanView=true -> quản lý nhận thêm hồ sơ của cấp dưới (gap vừa vá)', async () => {
      resetData();
      APP_DATA.deptViewScopeConfig = { budget: { mode: 'DEPT', extraViewers: [], managerCanView: true } };
      const res = await api('GET', '/api/data', undefined, MANAGER_OF_B);
      const ids = (res.body.budgetEntries || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '4', 'qlb (quản lý của nvb) phải thấy #4 (của cấp dưới) qua managerCanView, KHÔNG thấy #1/#2/#3');
      delete APP_DATA.deptViewScopeConfig;
    });

    await run.run('dù nhánh tải trả THỪA (giả lập lỗi tầng dưới), filterBudgetEntriesForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData();
      stubModule('lib/recordStore', {
        MIGRATED_COLLECTIONS: new Set(['budgetEntries']),
        // Chỉ trả thừa cho ĐÚNG budgetEntries — collection khác (docs/submissions/attendanceRecords...
        // cũng gọi các hàm này KHÔNG điều kiện ở routes/data.js) phải trả đúng rỗng, tránh vô tình "nhồi"
        // dữ liệu sai hình dạng khiến canViewDoc()/canViewSubmission() (đọc appData thật qua
        // getAppDataValue(), KHÔNG stub ở test này) ném lỗi ngoài ý muốn.
        getAllForCollectionCached: async (collection) => (collection === 'budgetEntries' ? ALL_ENTRIES.map(r => ({ ...r })) : []),
        getForCollectionByDeptCached: async (collection) => (collection === 'budgetEntries' ? ALL_ENTRIES.map(r => ({ ...r })) : []), // CỐ Ý trả thừa
        getForCollectionByUsernameCached: async () => [],
        getForCollectionByColumnCached: async () => []
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
      const ids = (body.budgetEntries || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1', 'dù tầng tải trả thừa, filterBudgetEntriesForUser() vẫn phải chốt đúng còn hồ sơ của Phòng A');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
