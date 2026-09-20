// server/tests/test-workflow-moduleaccess-gate.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #14):
// đường DUYỆT (POST /api/workflow/:module/:id/:action, routes/workflow.js — dùng chung cho MỌI module
// trong MODULE_CONFIGS) và các route hành động ở routes/records.js (operationOrders receive-goods/
// cancel-receipt, budgetLines/*) TRƯỚC ĐÂY hoàn toàn KHÔNG kiểm hasModuleAccessServer() ("Khối 0",
// user.perms.moduleAccess) — admin tắt hẳn 1 module cho 1 tài khoản cụ thể chỉ ẩn được tab ở giao diện,
// gọi thẳng API vẫn Duyệt/Từ chối/thao tác được bình thường nếu tài khoản đó còn nằm trong danh sách
// approver theo dept-workflow (1 lớp KHÁC hẳn moduleAccess). Đã vá: mirror ĐÚNG nguyên tắc "Khối 0 chặn
// trước tiên" đã áp dụng cho TẠO/ĐỌC (xem test-module-access-gate-create.js/test-module-access-gate.js).
//
// Dùng module 'docs' (đơn giản nhất trong MODULE_CONFIGS) cho route generic, và 'operationOrders'/
// 'budgetLines' (dbKey thật, dùng chung khoá moduleAccess 'vanHanh'/'budget') cho routes/records.js.
// lib/recordViewScope.js (hasModuleAccessServer thật) KHÔNG bị stub — kiểm đúng hàm thật.
//
// Chạy: node server/tests/test-workflow-moduleaccess-gate.js
'use strict';
const http = require('http');
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

const APPROVER_DOC_OFF = { username: 'gd1', name: 'Giám Đốc (tắt module Tài Liệu)', dept: 'Phòng A', perms: { moduleAccess: { doc: false } }, active: true };
const APPROVER_DOC_ON = { username: 'gd2', name: 'Giám Đốc (module bật)', dept: 'Phòng A', perms: {}, active: true };
const APPROVER_VANHANH_OFF = { username: 'gd3', name: 'Giám Đốc (tắt module Vận Hành)', dept: 'Siêu Thị A', perms: { moduleAccess: { vanHanh: false }, operationOrderReceiptManageHO: true, operationOrderReceiptManageStore: { all: true, depts: [] } }, active: true };
const APPROVER_BUDGET_OFF = { username: 'ql1', name: 'Quản Lý (tắt module Ngân Sách)', dept: 'Phòng A', perms: { moduleAccess: { budget: false }, budgetManage: true }, active: true };
const USERS = [APPROVER_DOC_OFF, APPROVER_DOC_ON, APPROVER_VANHANH_OFF, APPROVER_BUDGET_OFF];

let CURRENT_USERNAME = APPROVER_DOC_OFF.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find((u) => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const APP_DATA = {
  deptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approvers: { 1: [APPROVER_DOC_OFF.username, APPROVER_DOC_ON.username] } } },
  workflows: [{ id: 'WF_1STEP', name: '1 bước', steps: [{ order: 1, name: 'Duyệt' }] }]
};
stubModule('lib/appData', {
  getAllAppData: async () => APP_DATA,
  getAppDataValue: async () => ({}),
  withLockedAppDataValue: async (_k, fn) => fn([])
});

let RECORDS;
function resetRecords() {
  RECORDS = {
    docs: [{ id: 1, dept: 'Phòng A', status: 'PENDING', currentStep: 1, history: [], creator: 'nv1' }],
    operationOrders: [{ id: 2, dept: 'Siêu Thị A', status: 'AWAITING_RECEIPT', orderLocationType: 'STORE', history: [], items: [] }],
    budgetLines: [{ id: 3, dept: 'Phòng A', stage: 'PROPOSED', status: 'SUBMITTED', history: [] }]
  };
}
resetRecords();
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(RECORDS)),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex((x) => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    const updated = await mutatorFn(list[idx]);
    list[idx] = updated;
    return updated;
  },
  withAppLock: async (key, fn) => fn(),
  createForCollection: async () => { throw new Error('không dùng ở test này'); },
  deleteRecordForCollection: async () => { throw new Error('không dùng ở test này'); },
  getTrashItems: async () => []
});
stubModule('lib/taskStore', { insertTask: async () => {} });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

const express = require('express');
const workflowRoutes = require('../routes/workflow');
const recordsRoutes = require('../routes/records');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/workflow', workflowRoutes);
  app.use('/api/records', recordsRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}
async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function main() {
  console.log('== Khối 0 (moduleAccess) chặn đường Duyệt/hành động — routes/workflow.js + routes/records.js ==');
  const server = await startApp();
  try {
    await test('LỖI ĐÃ VÁ: approver hợp lệ theo dept-workflow nhưng moduleAccess.doc=false -> POST /api/workflow/docs/:id/approve bị chặn 403', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/docs/1/approve', { comment: '' }, APPROVER_DOC_OFF);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
      assert.strictEqual(RECORDS.docs[0].status, 'PENDING', 'Hồ sơ KHÔNG được duyệt khi bị chặn ở Khối 0');
    });

    await test('Approver CÙNG dept-workflow nhưng module KHÔNG bị tắt -> vẫn duyệt được bình thường (không phá hành vi cũ)', async () => {
      resetRecords();
      // Chỉ đúng 1 approver ở bước này (khác kịch bản trên có 2 approver -> cần ĐỦ cả 2 mới hoàn tất
      // bước, không liên quan gì tới phần đang test) — cô lập đúng biến cần kiểm (moduleAccess).
      APP_DATA.deptWorkflows['Phòng A'].approvers[1] = [APPROVER_DOC_ON.username];
      const r = await api('POST', '/api/workflow/docs/1/approve', { comment: '' }, APPROVER_DOC_ON);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(RECORDS.docs[0].status, 'APPROVED');
      APP_DATA.deptWorkflows['Phòng A'].approvers[1] = [APPROVER_DOC_OFF.username, APPROVER_DOC_ON.username];
    });

    await test('LỖI ĐÃ VÁ: moduleAccess.vanHanh=false -> POST /api/records/operationOrders/:id/receive-goods bị chặn 403', async () => {
      resetRecords();
      const r = await api('POST', '/api/records/operationOrders/2/receive-goods', {}, APPROVER_VANHANH_OFF);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
      assert.strictEqual(RECORDS.operationOrders[0].status, 'AWAITING_RECEIPT', 'Hồ sơ KHÔNG được xác nhận nhập hàng khi bị chặn ở Khối 0');
    });

    await test('LỖI ĐÃ VÁ: moduleAccess.budget=false -> POST /api/records/budgetLines/:id/approve bị chặn 403', async () => {
      resetRecords();
      const r = await api('POST', '/api/records/budgetLines/3/approve', {}, APPROVER_BUDGET_OFF);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
      assert.strictEqual(RECORDS.budgetLines[0].status, 'SUBMITTED', 'Hồ sơ KHÔNG được duyệt khi bị chặn ở Khối 0');
    });

    await test('Không cấu hình moduleAccess (undefined) -> KHÔNG bị chặn (mặc định mở, đúng hành vi hasModuleAccessServer() hiện có)', async () => {
      resetRecords();
      const NO_MODULE_ACCESS_CONFIG = { username: 'gd2', name: 'Giám Đốc (module bật)', dept: 'Phòng A', perms: {}, active: true };
      const r = await api('POST', '/api/workflow/docs/1/approve', { comment: '' }, NO_MODULE_ACCESS_CONFIG);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    });
  } finally {
    server.close();
  }

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
