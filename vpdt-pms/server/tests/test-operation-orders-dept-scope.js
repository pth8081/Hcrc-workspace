// server/tests/test-operation-orders-dept-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau Bước 8e: operationOrders tách riêng khỏi vòng
// lặp tải chung. canViewOperationOrder() (lib/recordViewScope.js) có nhánh OR "đang là người duyệt theo
// TIER giá trị đơn hàng" (không theo phòng ban) — routes/data.js dùng
// isApproverForAnyOperationOrderTier(user, data) để quyết định TRƯỚC khi tải: nếu user là approver ở
// BẤT KỲ tier nào (operationOrderStoreTierWorkflows/operationOrderHOTierWorkflows), tải company-wide
// (như admin); còn lại tải qua where.Dept ở SQL. Đây là kịch bản CÓ RỦI RO NGHIỆP VỤ THẬT nếu sai (người
// duyệt không thấy đơn hàng cần duyệt), nên test kỹ cả 2 chiều: người duyệt PHẢI thấy đủ, người thường
// KHÔNG được tải thừa.
//
// Chạy: node server/tests/test-operation-orders-dept-scope.js
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

const REGULAR_A = { username: 'nva', name: 'Nhân Viên A', dept: 'Siêu Thị A', perms: {}, active: true };
const REGULAR_B = { username: 'ntb', name: 'Nhân Viên B', dept: 'Siêu Thị B', perms: {}, active: true };
// gd1 là người duyệt tier "LT10M" (STORE) trong cấu hình bên dưới — KHÔNG có quyền admin/perm đặc biệt nào,
// chỉ được liệt kê tên trong operationOrderStoreTierWorkflows.
const TIER_APPROVER = { username: 'gd1', name: 'Giám Đốc Vùng', dept: 'Siêu Thị A', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const USERS = [REGULAR_A, REGULAR_B, TIER_APPROVER, ADMIN];

// Cấu hình tier: mọi đơn hàng dưới đây đều dùng orderLocationType 'STORE' + amount <= 10 triệu -> rơi
// đúng tier 'LT10M' (xem OPERATION_ORDER_STORE_TIERS ở lib/workflowEngine.js) — gd1 là approver của tier
// đó. Không cần khai "workflows" (flatWorkflowConfigToSteps() tự rơi về mặc định 1 bước "Duyệt" khi
// không tìm thấy workflowId tương ứng).
const APP_DATA = {
  operationOrderStoreTierWorkflows: {
    LT10M: { approvers: { 1: ['gd1'] } }
  },
  operationOrderHOTierWorkflows: {}
};

let ALL_ORDERS;
function resetData() {
  ALL_ORDERS = [
    { id: 1, dept: 'Siêu Thị A', orderLocationType: 'STORE', amount: 1000000 },
    { id: 2, dept: 'Siêu Thị B', orderLocationType: 'STORE', amount: 2000000 },
    { id: 3, dept: 'Siêu Thị A', orderLocationType: 'STORE', amount: 3000000 }
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
  MIGRATED_COLLECTIONS: new Set(['operationOrders']),
  getAllForCollectionCached: async (collection) => {
    if (collection !== 'operationOrders') return [];
    fullLoadCallCount++;
    return ALL_ORDERS.map(r => ({ ...r }));
  },
  getForCollectionByDeptCached: async (collection, dept) => {
    if (collection !== 'operationOrders') return [];
    byDeptCallCount++;
    return ALL_ORDERS.filter(r => r.dept === dept).map(r => ({ ...r }));
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
    await run.run('Nhân viên thường (không phải approver tier nào): chỉ nhận đơn hàng ĐÚNG siêu thị mình, tải qua where.Dept', async () => {
      resetData(); byDeptCallCount = 0; fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, REGULAR_A);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.operationOrders || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,3', 'Siêu Thị A (nva) phải thấy đúng 2 đơn hàng của siêu thị mình');
      assertEqual(fullLoadCallCount, 0, 'người thường KHÔNG được tải toàn bộ company-wide');
      assert(byDeptCallCount >= 1, 'phải đi qua nhánh tải theo-phòng-ban');
    });

    await run.run('Người duyệt tier LT10M (gd1, KHÔNG phải admin): PHẢI thấy đơn hàng của MỌI siêu thị (không chỉ siêu thị mình) — quan trọng nhất, tránh lỗi "người duyệt không thấy hồ sơ cần duyệt"', async () => {
      resetData(); byDeptCallCount = 0; fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, TIER_APPROVER);
      const ids = (res.body.operationOrders || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3', 'gd1 (approver tier 2) phải thấy ĐỦ cả 3 đơn hàng, kể cả của Siêu Thị B');
      assertEqual(byDeptCallCount, 0, 'người duyệt tier KHÔNG được đi qua nhánh theo-phòng-ban (sẽ thiếu dữ liệu)');
      assert(fullLoadCallCount >= 1, 'người duyệt tier phải tải theo nhánh company-wide');
    });

    await run.run('admin: vẫn nhận ĐỦ toàn công ty', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      const ids = (res.body.operationOrders || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3', 'admin phải thấy đủ cả 3 đơn hàng');
    });

    await run.run('Nhân viên Siêu Thị B: chỉ thấy đơn hàng của B, không lộ chéo sang A', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, REGULAR_B);
      const ids = (res.body.operationOrders || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '2', 'B chỉ thấy đúng đơn hàng của Siêu Thị B');
    });

    await run.run('dù nhánh tải theo-phòng-ban trả THỪA (giả lập lỗi tầng dưới), filterOperationOrdersForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData();
      stubModule('lib/recordStore', {
        MIGRATED_COLLECTIONS: new Set(['operationOrders']),
        getAllForCollectionCached: async () => ALL_ORDERS.map(r => ({ ...r })),
        getForCollectionByDeptCached: async () => ALL_ORDERS.map(r => ({ ...r })), // CỐ Ý trả thừa mọi siêu thị
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
      const ids = (body.operationOrders || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,3', 'dù tầng tải trả thừa, filterOperationOrdersForUser() vẫn phải chốt đúng còn 2 đơn hàng của A');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
