// server/tests/test-operation-order-po-race.js
//
// Regression test cho race condition ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026) ở tạo mới Vận Hành > Đặt
// Hàng (POST /api/create/operationOrders): check trùng Số Đơn NCC (poNumber, lib/createValidation.js
// CREATE_MODULE_CONFIGS.operationOrders.extraValidate) trước đây chỉ so khớp trên 1 SNAPSHOT
// (collection) đọc TRƯỚC khi ghi — không có getLockKey nào bọc quanh nên đi qua createForCollection()
// thường (không khoá). 2 request tạo đơn hàng gần như đồng thời, CÙNG orderLocationType + CÙNG poNumber
// (VD double-click, hoặc đọc trùng 1 phiếu PDF NCC gửi 2 lần) đều đọc được collection "chưa có đơn nào
// trùng số" TRƯỚC khi cái nào kịp ghi, cả 2 đều qua được check dupe rồi cùng tạo — vi phạm bất biến "1
// poNumber/orderLocationType chỉ ứng với 1 đơn đang hiệu lực".
// Đã vá: thêm getLockKey (`operation_order_po:<orderLocationType>:<poNumber>`) vào CREATE_MODULE_CONFIGS.
// operationOrders — routes/create.js tự động chuyển sang createForCollectionSerialized() (sp_getapplock,
// lib/recordStore.js), bọc TOÀN BỘ đọc-kiểm tra-ghi (validateAndPrepareCreate() chạy trong builderFn,
// bên trong khoá) thay vì createForCollection() không khoá.
//
// Test này gọi thẳng router THẬT (routes/create.js) với lib/recordStore giả lập bằng 1 hàng đợi mutex
// THẬT theo lockKey (mirror ĐÚNG khuôn withFakeAppLock() ở tests/test-audit-budgetlines-race.js /
// tests/test-payment-source-race.js) + 1 cửa sổ "nhường lượt" (setTimeout) chèn giữa đọc collection và
// bước tạo bản ghi, để buộc 2 request bắn GẦN NHƯ ĐỒNG THỜI (Promise.all) phải thực sự tranh chấp cùng
// 1 cửa sổ thời gian — nếu bản vá bị hoàn tác (bỏ getLockKey), test này sẽ FAIL (phát hiện 2 đơn hàng
// cùng trỏ 1 Số Đơn NCC + cùng orderLocationType).
//
// Chạy: node server/tests/test-operation-order-po-race.js
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

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Vận Hành', perms: { admin: true, operationOrderCreate: true }, active: true };
const VH2 = { username: 'vh2', name: 'Nhân Viên Vận Hành 2', dept: 'Vận Hành', perms: { operationOrderCreate: true }, active: true };
const USERS = [ADMIN, VH2];

let RECORDS = { operationOrders: [] };
function resetRecords() {
  RECORDS = { operationOrders: [] };
}
resetRecords();

// ===== Hàng đợi mutex THẬT theo lockKey (mirror withFakeAppLock() ở test-audit-budgetlines-race.js) =====
const lockChains = new Map();
async function withFakeAppLock(lockKeyOrKeys, fn) {
  const keys = Array.isArray(lockKeyOrKeys) ? lockKeyOrKeys : [lockKeyOrKeys];
  for (const key of keys) {
    const prev = lockChains.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    lockChains.set(key, prev.then(() => current));
    await prev;
    try { return await fn(); } finally { release(); }
  }
}
const DELAY_MS = 25;
function yieldTurn() { return new Promise((resolve) => setTimeout(resolve, DELAY_MS)); }

stubModule('lib/appData', {
  getAllAppData: async () => ({ users: USERS }),
  withLockedAppDataValue: async (key, fn) => fn([])
});
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['operationOrders']),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  getTrashItems: async () => [],
  createForCollection: async (c, builderFn) => {
    const record = await builderFn((RECORDS[c] || []).slice());
    RECORDS[c].push(record);
    return record;
  },
  // Cửa sổ đọc-rồi-ghi CỐ Ý chèn NGAY SAU khi khoá được cấp (mirror đúng chỗ createForCollectionSerialized
  // thật — lib/recordStore.js — đọc collection RỒI mới await builderFn ghi) — nhường lượt cho request
  // song song thứ 2 chờ đúng lúc này nếu KHÔNG có khoá chung bọc quanh (bản vá bị hoàn tác).
  createForCollectionSerialized: (c, lockKey, builderFn) => withFakeAppLock(lockKey, async () => {
    const existing = (RECORDS[c] || []).slice();
    await yieldTurn();
    const record = await builderFn(existing);
    RECORDS[c].push(record);
    return record;
  }),
  withAppLock: async (key, fn) => withFakeAppLock(key, fn)
});
// Cần stub — routes/create.js (từ bản vá cảnh báo "chưa có người duyệt khớp siêu thị", xem
// tests/test-operation-order-noapprover-warning.js) tự gọi insertSystemLog() thật khi 1 đơn STORE lọc
// approver ra rỗng; fixture ở đây không cấu hình operationOrderStoreTierWorkflows nên LUÔN rơi vào
// nhánh đó — không stub sẽ khiến test này cố kết nối SQL Server thật (không liên quan gì tới race
// condition đang test ở file này).
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
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
    title: 'Đặt hàng NCC race test', orderLocationType: 'STORE', poNumber: 'PO-RACE-001',
    items: [{ name: 'Hàng A', qty: 1, unitPrice: 1000 }]
  }, overrides);
}

async function main() {
  const server = await startApp();
  try {
    resetRecords();

    // Bắn GẦN NHƯ ĐỒNG THỜI: 2 nhân viên khác nhau cùng gửi đơn hàng CÙNG poNumber + CÙNG
    // orderLocationType (VD double-click, hoặc đọc trùng 1 phiếu PDF NCC gửi 2 lần).
    const [r1, r2] = await Promise.all([
      api(server, 'POST', '/api/create/operationOrders', orderPayload(), ADMIN),
      api(server, 'POST', '/api/create/operationOrders', orderPayload(), VH2)
    ]);

    const matching = RECORDS.operationOrders.filter(o => o.orderLocationType === 'STORE' && o.poNumber === 'PO-RACE-001');

    check('KHÔNG được tạo 2 đơn hàng cùng trỏ 1 Số Đơn NCC + cùng orderLocationType (LỖI ĐÃ VÁ — race condition)',
      matching.length === 1,
      { r1Status: r1.status, r2Status: r2.status, matching });

    const bothSucceeded = r1.status === 200 && r2.status === 200;
    check('KHÔNG được cả 2 request tạo đơn hàng cùng thành công (loại trừ nhau)',
      !bothSucceeded, { r1Status: r1.status, r2Status: r2.status });

    const failed = r1.status === 200 ? r2 : r1;
    check('Request thua cuộc phải bị chặn 409 với đúng lý do "Số đơn NCC ... đã tồn tại"',
      failed.status === 409 && /Số đơn NCC/.test(failed.body?.error || ''),
      failed.body);

    // Kiểm chứng thêm: 2 đơn hàng KHÁC poNumber (không tranh chấp gì) vẫn tạo song song bình thường,
    // không bị khoá chung "vô tình" chặn nhầm 2 request không liên quan tới nhau.
    resetRecords();
    const [r3, r4] = await Promise.all([
      api(server, 'POST', '/api/create/operationOrders', orderPayload({ poNumber: 'PO-RACE-002' }), ADMIN),
      api(server, 'POST', '/api/create/operationOrders', orderPayload({ poNumber: 'PO-RACE-003' }), VH2)
    ]);
    check('2 đơn hàng KHÁC Số Đơn NCC vẫn tạo đồng thời bình thường (không bị khoá chung chặn nhầm)',
      r3.status === 200 && r4.status === 200 && RECORDS.operationOrders.length === 2,
      { r3Status: r3.status, r4Status: r4.status, count: RECORDS.operationOrders.length });
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
