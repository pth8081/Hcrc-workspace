// server/tests/test-budget-lines-dept-scope.js
//
// Regression test cho GET /api/data/lazy/budget (routes/data.js) — budgetLines (Ngân Sách 2.0) tải qua
// loadBudgetLinesScoped() trong nhóm lazy-load 'budget' (LAZY_DATA_GROUPS.budget.collections).
// canViewBudgetLine() (lib/recordViewScope.js) có nhánh "chính người tạo" (createdBy, vì Khối Phòng Ban
// là lựa chọn TỰ DO không ràng forceOwnDept — xem CREATE_MODULE_CONFIGS.budgetLines) + "phòng ban mình"
// (deptAutoViewOn) + 4-state deptViewScopeConfig['budget'] qua extraViewScopeAllows().
//
// LỖI ĐÃ VÁ (rà soát v24.74→v24.81, 11/2026, mức Trung bình): deptViewScopeConfig['budget']
// (extraViewers/managerCanView) đã được canViewBudgetLine() đọc từ v24.74 nhưng CHƯA từng được
// loadBudgetLinesScoped() đọc ở lớp SQL pre-filter — xem chú thích đầy đủ tại loadBudgetLinesScoped()
// (routes/data.js).
//
// Chạy: node server/tests/test-budget-lines-dept-scope.js
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

// LƯU Ý: budgetCreate TỰ NÓ đã cho tải company-wide ở loadBudgetLinesScoped() (hành vi CŨ, không phải
// phần vừa vá — xem "Ngân sách 2.0 CỐ Ý bỏ forceOwnDept" ở canViewBudgetLine()), nên REGULAR_A ở đây
// KHÔNG có quyền đó để đúng là kịch bản "người thường, chỉ thấy đúng phòng ban mình".
const REGULAR_A = { username: 'nva', name: 'Nhân Viên A', dept: 'Phòng A', perms: {}, active: true };
const REGULAR_B = { username: 'ntb', name: 'Nhân Viên B', dept: 'Phòng B', perms: {}, active: true };
const BUDGET_MGR = { username: 'ketoan1', name: 'Quản Lý Ngân Sách', dept: 'Phòng Kế Toán', perms: { budgetManage: true }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
// MANAGED_CREATOR_BUDGET: dùng RIÊNG cho kịch bản deptViewScopeConfig.budget.managerCanView dưới (được
// REGULAR_A quản lý trực tiếp qua managerUsername) — managerCanView chỉ cấp quyền xem theo QUAN HỆ QUẢN
// LÝ với NGƯỜI TẠO từng dòng cụ thể (item.createdBy), không phải cấp quyền xem toàn công ty.
const MANAGED_CREATOR_BUDGET = { username: 'nv_cap_duoi_budget', name: 'NV Cấp Dưới Của A (Ngân Sách)', dept: 'Phòng C', perms: { budgetCreate: true }, managerUsername: 'nva', active: true };
const USERS = [REGULAR_A, REGULAR_B, BUDGET_MGR, ADMIN, MANAGED_CREATOR_BUDGET];

// isManagerOf()/extraViewScopeAllows() (lib/recordViewScope.js) đọc appData.users để tra managerUsername
// theo quan hệ quản lý-nhân viên — APP_DATA dùng object mutable để các kịch bản sau tự gán/xoá
// deptViewScopeConfig.
const APP_DATA = { users: USERS };

let ALL_LINES;
function resetData() {
  ALL_LINES = [
    { id: 1, dept: 'Phòng A', createdBy: 'nva' },
    { id: 2, dept: 'Phòng B', createdBy: 'ntb' },
    { id: 3, dept: 'Phòng C', createdBy: 'other1' }
  ];
}
resetData();

let byDeptCallCount = 0;
let fullLoadCallCount = 0;

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['budgetLines']),
  getAllForCollectionCached: async (collection) => {
    if (collection !== 'budgetLines') return [];
    fullLoadCallCount++;
    return ALL_LINES.map(r => ({ ...r }));
  },
  getForCollectionByDeptCached: async (collection, dept) => {
    if (collection !== 'budgetLines') return [];
    byDeptCallCount++;
    return ALL_LINES.filter(r => r.dept === dept).map(r => ({ ...r }));
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
    await run.run('GET /api/data/lazy/budget: nhân viên thường (không budgetCreate/budgetManage) chỉ nhận dòng ĐÚNG phòng ban mình', async () => {
      resetData(); byDeptCallCount = 0; fullLoadCallCount = 0;
      const res = await api('GET', '/api/data/lazy/budget', undefined, REGULAR_A);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.budgetLines || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1', 'Phòng A (nva) chỉ thấy đúng dòng của phòng mình');
      assertEqual(fullLoadCallCount, 0, 'người thường KHÔNG được tải toàn bộ company-wide');
      assert(byDeptCallCount >= 1, 'phải đi qua nhánh tải theo-phòng-ban');
    });

    await run.run('GET /api/data/lazy/budget: budgetManage vẫn nhận ĐỦ toàn công ty', async () => {
      resetData(); fullLoadCallCount = 0;
      const res = await api('GET', '/api/data/lazy/budget', undefined, BUDGET_MGR);
      const ids = (res.body.budgetLines || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3', 'budgetManage phải thấy đủ cả 3 dòng');
      assert(fullLoadCallCount >= 1, 'budgetManage phải tải theo nhánh company-wide');
    });

    await run.run('GET /api/data/lazy/budget: admin vẫn nhận ĐỦ toàn công ty', async () => {
      resetData();
      const res = await api('GET', '/api/data/lazy/budget', undefined, ADMIN);
      const ids = (res.body.budgetLines || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3', 'admin phải thấy đủ cả 3 dòng');
    });

    await run.run('GET /api/data/lazy/budget: deptViewScopeConfig.budget.extraViewers=[ntb] -> B nhận ĐỦ toàn công ty dù KHÔNG có budgetManage', async () => {
      resetData(); byDeptCallCount = 0; fullLoadCallCount = 0;
      APP_DATA.deptViewScopeConfig = { budget: { mode: 'DEPT', extraViewers: [REGULAR_B.username], managerCanView: false } };
      const res = await api('GET', '/api/data/lazy/budget', undefined, REGULAR_B);
      const ids = (res.body.budgetLines || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3', 'extraViewers phải thấy đủ cả 3 dòng, mọi phòng ban');
      assert(fullLoadCallCount >= 1, 'extraViewers phải đi qua nhánh tải company-wide, giống budgetManage');
      delete APP_DATA.deptViewScopeConfig;
    });

    await run.run('GET /api/data/lazy/budget: deptViewScopeConfig.budget.managerCanView=true -> quản lý của người tạo dòng nhận thêm dòng của cấp dưới, không phải mọi user thường', async () => {
      resetData(); byDeptCallCount = 0; fullLoadCallCount = 0;
      // Dòng #4 riêng (createdBy) của MANAGED_CREATOR_BUDGET — người mà REGULAR_A quản lý trực tiếp.
      ALL_LINES.push({ id: 4, dept: 'Phòng C', createdBy: MANAGED_CREATOR_BUDGET.username });
      APP_DATA.deptViewScopeConfig = { budget: { mode: 'DEPT', extraViewers: [], managerCanView: true } };
      const res = await api('GET', '/api/data/lazy/budget', undefined, REGULAR_A);
      const ids = (res.body.budgetLines || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,4', 'A (quản lý của nv_cap_duoi_budget) phải thấy #1 (phòng mình) + #4 (của cấp dưới) qua managerCanView, KHÔNG thấy #2/#3');
      assert(fullLoadCallCount >= 1, 'managerCanView phải đi qua nhánh tải company-wide ở lớp SQL pre-filter');
      delete APP_DATA.deptViewScopeConfig;
    });

    await run.run('dù nhánh tải theo-phòng-ban trả THỪA (giả lập lỗi tầng dưới), filterBudgetLinesForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData();
      stubModule('lib/recordStore', {
        MIGRATED_COLLECTIONS: new Set(['budgetLines']),
        getAllForCollectionCached: async (collection) => (collection === 'budgetLines' ? ALL_LINES.map(r => ({ ...r })) : []),
        getForCollectionByDeptCached: async (collection) => (collection === 'budgetLines' ? ALL_LINES.map(r => ({ ...r })) : []), // CỐ Ý trả thừa mọi phòng ban
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
      const res = await fetch(`http://127.0.0.1:${port2}/api/data/lazy/budget`);
      const body = await res.json();
      server2.close();
      const ids = (body.budgetLines || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1', 'dù tầng tải trả thừa, filterBudgetLinesForUser() vẫn phải chốt đúng còn dòng của Phòng A');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
