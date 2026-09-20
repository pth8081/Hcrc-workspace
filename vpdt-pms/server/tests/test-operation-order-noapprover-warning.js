// server/tests/test-operation-order-noapprover-warning.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026, mức Trung bình): lọc approver theo đúng
// siêu thị của đơn "Đặt Hàng Tại Siêu Thị" có thể vô tình lọc RỖNG danh sách duyệt bước 1 nếu admin cấu
// hình 1 dòng "Quy Trình Hỗn Hợp" (operationOrderStoreMixedApprovalRules, xem lib/workflowEngine.js
// resolveOperationOrderStoreMixedApprovers() — đợt "Quy Trình Hỗn Hợp" 10/2026 đã thay hẳn cơ chế cũ
// filterOperationOrderStoreApprovers()) nhưng người/chức danh đó KHÔNG áp dụng cho đúng siêu thị vừa đặt
// hàng — hồ sơ vẫn tạo được, rơi vào PENDING, nhưng không một người duyệt "thường" nào thấy được để xử
// lý (chỉ admin bypass mới duyệt được) — trước đây KHÔNG có cảnh báo gì, đơn "treo" âm thầm.
// Đã vá: routes/create.js sau khi tạo THÀNH CÔNG 1 operationOrders STORE, tự tính lại danh sách approver
// bước 1 (dùng đúng MODULE_CONFIGS.operationOrders.resolveWfConfig() — cùng hàm applyWorkflowAction()
// dùng khi duyệt, không viết lại luật riêng) — nếu rỗng thì trả kèm `warning` cho client + ghi 1 dòng
// Nhật Ký Hệ Thống mức WARNING, KHÔNG chặn việc tạo đơn.
//
// Test này gọi thẳng router THẬT (routes/create.js) với lib/appData/lib/recordStore/lib/systemLogStore
// đều giả lập tối thiểu.
//
// Chạy: node server/tests/test-operation-order-noapprover-warning.js
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

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

// gd.a: Giám Đốc Siêu Thị A — CHỈ được cấu hình ở Quy Trình Hỗn Hợp phụ trách ĐÚNG "Siêu Thị A" (dòng
// PERSON mode, stores=['Siêu Thị A'], xem APP_DATA bên dưới) -> đơn STORE của Siêu Thị B sẽ lọc approver
// bước 1 về RỖNG (kịch bản lỗi).
const GD_A = { username: 'gd.a', name: 'Giám Đốc Siêu Thị A', dept: 'Siêu Thị A', perms: { operationOrderCreate: true }, active: true };
const GD_B = { username: 'gd.b', name: 'Giám Đốc Siêu Thị B', dept: 'Siêu Thị B', perms: { operationOrderCreate: true }, active: true };
const CREATOR_B = { username: 'nv.b', name: 'Nhân Viên Siêu Thị B', dept: 'Siêu Thị B', perms: { operationOrderCreate: true }, active: true };
const USERS = [GD_A, GD_B, CREATOR_B];

const APP_DATA = {
  users: USERS,
  // workflowId vẫn cần (xác định SỐ BƯỚC/tên bước) — approvers/approverMode/approversByPosition của tier
  // KHÔNG còn được đọc cho STORE nữa (xem resolveOperationOrderWorkflow(), lib/workflowEngine.js).
  operationOrderStoreTierWorkflows: {
    LT10M: { workflowId: 'WF_1STEP' }
  },
  operationOrderHOTierWorkflows: {},
  workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
  // Quy Trình Hỗn Hợp: 1 dòng PERSON mode duy nhất, CHỈ áp dụng "Siêu Thị A" (ngoại lệ, stores có giá
  // trị) — mirror đúng kịch bản gốc "approver duy nhất không khớp siêu thị của đơn -> lọc rỗng".
  operationOrderStoreMixedApprovalRules: [
    { id: 1, step: 1, mode: 'PERSON', username: GD_A.username, stores: ['Siêu Thị A'] }
  ]
};

const systemLogEntries = [];
stubModule('lib/appData', {
  getAllAppData: async () => JSON.parse(JSON.stringify(APP_DATA)),
  withLockedAppDataValue: async (key, fn) => fn([])
});
stubModule('lib/systemLogStore', {
  insertSystemLog: async (entry) => { systemLogEntries.push(entry); }
});

let RECORDS = { operationOrders: [] };
function resetRecords() { RECORDS = { operationOrders: [] }; }

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['operationOrders']),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  getTrashItems: async () => [],
  createForCollection: async (c, builderFn) => {
    const record = await builderFn((RECORDS[c] || []).slice());
    RECORDS[c].push(record);
    return record;
  },
  createForCollectionSerialized: async (c, lockKey, builderFn) => {
    const record = await builderFn((RECORDS[c] || []).slice());
    RECORDS[c].push(record);
    return record;
  },
  withAppLock: async (key, fn) => fn()
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const username = req.headers['x-test-user'];
    const fresh = USERS.find((u) => u.username === username);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const createRoutes = require('../routes/create');

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function api(server, method, urlPath, body, asUser) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-test-user': asUser.username },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

function orderPayload(overrides) {
  return Object.assign({
    title: 'Đặt hàng NCC cảnh báo approver', orderLocationType: 'STORE',
    items: [{ name: 'Hàng A', qty: 1, unitPrice: 1000000 }] // amount = 1tr -> tier LT10M
  }, overrides);
}

async function main() {
  const server = await startApp();
  try {
    // ===== Kịch bản 1: đơn STORE của Siêu Thị B — approver duy nhất được cấu hình (gd.a, Quy Trình Hỗn
    // Hợp chỉ phụ trách "Siêu Thị A") không khớp Siêu Thị B -> lọc RỖNG -> PHẢI có warning. =====
    resetRecords();
    systemLogEntries.length = 0;
    const r1 = await api(server, 'POST', '/api/create/operationOrders', orderPayload({ }), CREATOR_B);
    check('Tạo đơn vẫn THÀNH CÔNG dù approver lọc rỗng (KHÔNG chặn tạo)', r1.status === 200, r1.body);
    check('Response PHẢI kèm warning đúng nội dung "chưa có người duyệt"',
      typeof r1.body?.warning === 'string' && /chưa có người duyệt/i.test(r1.body.warning), r1.body);
    check('Phải ghi đúng 1 dòng Nhật Ký Hệ Thống mức WARNING (CREATE_NO_APPROVER_WARNING)',
      systemLogEntries.length === 1 && systemLogEntries[0].status === 'WARNING' && systemLogEntries[0].actionType === 'CREATE_NO_APPROVER_WARNING',
      systemLogEntries);

    // ===== Kịch bản 2: đơn STORE của Siêu Thị A — approver gd.a khớp đúng dept -> KHÔNG warning. =====
    resetRecords();
    systemLogEntries.length = 0;
    const gdACreator = { ...GD_A }; // gd.a tự tạo đơn cho chính siêu thị mình
    const r2 = await api(server, 'POST', '/api/create/operationOrders', orderPayload({ }), gdACreator);
    check('Đơn Siêu Thị A (approver khớp dept) -> KHÔNG có warning',
      r2.status === 200 && (r2.body?.warning === null || r2.body?.warning === undefined), r2.body);
    check('KHÔNG ghi Nhật Ký Hệ Thống nào khi approver hợp lệ', systemLogEntries.length === 0, systemLogEntries);

    // ===== Kịch bản 3: đơn HO (không áp dụng filter theo siêu thị) -> KHÔNG bao giờ warning, kể cả khi
    // approver không có dept khớp gì (HO vốn không có khái niệm "siêu thị"). =====
    resetRecords();
    systemLogEntries.length = 0;
    const r3 = await api(server, 'POST', '/api/create/operationOrders', orderPayload({ orderLocationType: 'HO' }), CREATOR_B);
    check('Đơn HO -> KHÔNG bao giờ có warning (filter chỉ áp dụng cho STORE)',
      r3.status === 200 && (r3.body?.warning === null || r3.body?.warning === undefined), r3.body);

    // ===== Kịch bản 4 (BỔ SUNG, đợt audit chuyên sâu 12 cụm — mức Trung bình): quy trình NHIỀU BƯỚC,
    // bước 1 có người duyệt đầy đủ nhưng BƯỚC 2 chưa ai khớp. Bản vá đầu chỉ kiểm record.currentStep
    // (luôn = 1 lúc vừa tạo) nên trường hợp này lọt qua im lặng: đơn duyệt xong bước 1 rồi mới treo ở
    // bước 2, lúc đó người tạo đã quên hẳn đơn. Nay kiểm TẤT CẢ các bước của quy trình. =====
    resetRecords();
    systemLogEntries.length = 0;
    APP_DATA.workflows.push({ id: 'WF_2STEP', steps: [{ order: 1, name: 'GĐ Siêu Thị' }, { order: 2, name: 'Quản Lý Vùng' }] });
    APP_DATA.operationOrderStoreTierWorkflows.LT10M = { workflowId: 'WF_2STEP' };
    APP_DATA.operationOrderStoreMixedApprovalRules = [
      { id: 1, step: 1, mode: 'PERSON', username: GD_B.username, stores: ['Siêu Thị B'] }
      // KHÔNG có dòng nào cho bước 2 -> bước 2 không ai duyệt được.
    ];
    const r4 = await api(server, 'POST', '/api/create/operationOrders', orderPayload({}), CREATOR_B);
    check('LỖI ĐÃ VÁ: bước 1 có người duyệt nhưng BƯỚC 2 trống -> vẫn PHẢI cảnh báo (kiểm mọi bước, không chỉ bước hiện tại)',
      r4.status === 200 && typeof r4.body?.warning === 'string' && /chưa có người duyệt/i.test(r4.body.warning), r4.body);
    check('Cảnh báo nêu ĐÚNG bước đang thiếu người duyệt (Bước 2), không nêu nhầm bước 1',
      typeof r4.body?.warning === 'string' && r4.body.warning.includes('Bước 2') && !r4.body.warning.includes('Bước 1'), r4.body?.warning);
    check('Ghi đúng 1 dòng Nhật Ký Hệ Thống mức WARNING cho trường hợp thiếu người duyệt ở bước sau',
      systemLogEntries.length === 1 && systemLogEntries[0].status === 'WARNING', systemLogEntries);

    // Bước 1 VÀ bước 2 đều có người -> không cảnh báo gì (tránh cảnh báo oan sau khi mở rộng phạm vi kiểm).
    resetRecords();
    systemLogEntries.length = 0;
    APP_DATA.operationOrderStoreMixedApprovalRules = [
      { id: 1, step: 1, mode: 'PERSON', username: GD_B.username, stores: ['Siêu Thị B'] },
      { id: 2, step: 2, mode: 'PERSON', username: GD_A.username, stores: ['Siêu Thị B'] }
    ];
    const r5 = await api(server, 'POST', '/api/create/operationOrders', orderPayload({}), CREATOR_B);
    check('Quy trình 2 bước đủ người duyệt cả 2 bước -> KHÔNG cảnh báo oan',
      r5.status === 200 && (r5.body?.warning === null || r5.body?.warning === undefined), r5.body);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
