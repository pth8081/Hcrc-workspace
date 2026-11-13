// server/tests/test-workflow-any-approver-config.js
//
// Tính năng MỚI (11/2026, theo yêu cầu người dùng): "ở các bước trong quy trình, cho phép cấu hình —
// nếu có nhiều người ở bước đó, cho phép MỘT TRONG NHỮNG NGƯỜI đó phê duyệt là có thể qua (thay vì bắt
// buộc tất cả — "đồng phê duyệt" hiện tại). Phải ĐỘNG: admin chọn bật ở ĐÚNG bước nào thì bước đó mới
// hoạt động như vậy, bước nào không chọn thì vẫn giữ nguyên hành vi cũ".
//
// Cơ chế: mỗi cấu hình quy trình theo phòng ban (VD paymentDeptWorkflows[dept]) có thêm field MỚI
// `coApprovalMode` (map {stepOrder: 'ANY'}, thiếu/khác 'ANY' = 'ALL' = hành vi ĐỒNG PHÊ DUYỆT cũ) —
// flatWorkflowConfigToSteps() (lib/workflowEngine.js) gắn thẳng thành steps[i].anyApprover, rồi
// applyWorkflowAction() đọc steps[currentStep-1]?.anyApprover truyền vào isStepApprovalComplete() để
// quyết định dùng .some() (chỉ cần 1 người) hay .every() (cần đủ tất cả, mặc định).
//
// PHASE 1 (module ĐÃ wire): docs/carRegs/officeReqs/vppRegistrations/contractsSignedFile/itPriceApprovals
// (RETAIL)/budgetEntries/paymentRequests — tất cả đi qua flatWorkflowConfigToSteps() TRỰC TIẾP, không
// snapshot/mixed-approval-rule. Test này dùng paymentRequests làm đại diện (dựng lại ĐÚNG khuôn harness
// đã có ở tests/test-audit-round2-cluster6.js, mục [3]).
//
// Chạy: node server/tests/test-workflow-any-approver-config.js
'use strict';
const assert = require('assert');
const express = require('express');

let passed = 0, failed = 0;
async function run(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`);
  }
}

function stubModule(relPath, exportsObj) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, children: [], paths: [], exports: exportsObj };
  return resolved;
}

const APP_DATA = {
  deptWorkflows: {}, submissionDeptWorkflows: {}, carDeptWorkflows: {}, officeDeptWorkflows: {},
  workflows: [
    { id: 'WF_1STEP', name: '1 bước', steps: [{ order: 1, name: 'Duyệt' }] },
    { id: 'WF_2STEP', name: '2 bước', steps: [{ order: 1, name: 'Trưởng phòng' }, { order: 2, name: 'Giám đốc' }] }
  ],
  paymentDeptWorkflows: {}
};
stubModule('../lib/appData', {
  getAllAppData: async () => APP_DATA,
  getAppDataValue: async (key) => (key === 'submissionTypes' ? [] : {}),
  getAppDataValueCached: async () => ({}),
  withLockedAppDataValue: async (_k, fn) => fn([]),
  invalidateAppDataCache: () => {}
});

const PAYMENT_REQUESTS = new Map();
stubModule('../lib/recordStore', {
  getAllForCollection: async () => [],
  getAllForCollectionCached: async () => [],
  getTrashItems: async () => [],
  getAllTrashItemsCached: async () => [],
  withLockedRecordForCollection: async (collection, id, mutator) => {
    if (collection !== 'paymentRequests') throw new Error(`Bản giả chưa hỗ trợ collection: ${collection}`);
    const item = PAYMENT_REQUESTS.get(Number(id));
    if (!item) { const e = new Error('Không tìm thấy hồ sơ'); e.status = 404; throw e; }
    const copy = JSON.parse(JSON.stringify(item));
    const updated = await mutator(copy);
    PAYMENT_REQUESTS.set(Number(id), updated);
    return updated;
  },
  createForCollection: async () => { throw new Error('không dùng trong bộ test này'); },
  createForCollectionSerialized: async () => { throw new Error('không dùng trong bộ test này'); },
  insertRecord: async () => { throw new Error('không dùng trong bộ test này'); },
  withLockedRecordById: async () => { throw new Error('không dùng trong bộ test này'); },
  deleteRecordForCollection: async () => { throw new Error('không dùng trong bộ test này'); },
  withAppLock: async (_k, fn) => fn(),
  MIGRATED_COLLECTIONS: new Set(['paymentRequests'])
});
stubModule('../db', {
  sql: { NVarChar: (n) => ({ type: 'nvarchar', n }), BigInt: { type: 'bigint' }, Int: { type: 'int' }, MAX: 'max', DateTime2: { type: 'datetime2' }, Transaction: class {}, Request: class {} },
  getPool: async () => ({ request() { const req = { input: () => req, query: async () => ({ recordset: [] }) }; return req; } })
});

let CURRENT_USER = null;
stubModule('../lib/auth', {
  requireAuth: (req, _res, next) => { req.freshUser = CURRENT_USER; req.allUsers = [CURRENT_USER]; next(); },
  blockIfMustChangePassword: (_req, _res, next) => next()
});

const workflowRouter = require('../routes/workflow');
const app = express();
app.use(express.json());
app.use('/api/workflow', workflowRouter);

async function withServer(fn) {
  const server = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(res => server.close(res)); }
}

const KETOAN1 = { username: 'ketoan1', name: 'Kế Toán 1', dept: 'Phòng Kế Toán', perms: { paymentManage: true, approverAuthLevel: 'NONE' } };
const KETOAN2 = { username: 'ketoan2', name: 'Kế Toán 2', dept: 'Phòng Kế Toán', perms: { paymentManage: true, approverAuthLevel: 'NONE' } };
const GIAMDOC = { username: 'giamdoc', name: 'Giám Đốc', dept: 'Phòng Kế Toán', perms: { paymentManage: true, approverAuthLevel: 'NONE' } };

function seed(id, overrides) {
  PAYMENT_REQUESTS.set(id, {
    id, code: `TT-${id}`, title: 'Thanh toán test', amount: 1000000, dept: 'Phòng Kế Toán',
    status: 'PENDING', currentStep: 1, history: [], installments: [{ amount: 1000000, confirmed: false }],
    ...overrides
  });
}
async function approve(id, user) {
  CURRENT_USER = user;
  return withServer(async (base) => {
    const res = await fetch(`${base}/api/workflow/paymentRequests/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  });
}

async function main() {
  await run('REGRESSION — CHƯA cấu hình coApprovalMode (mặc định ALL): 1/2 người duyệt -> vẫn PENDING, chưa đủ', async () => {
    APP_DATA.paymentDeptWorkflows['Phòng Kế Toán'] = { workflowId: 'WF_1STEP', approvers: { 1: ['ketoan1', 'ketoan2'] } };
    seed(1);
    const res = await approve(1, KETOAN1);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.item.status, 'PENDING', 'ĐỒNG PHÊ DUYỆT cũ: 1 người chưa đủ, phải GIỮ NGUYÊN hành vi cũ');
    assert.strictEqual(res.body.item.currentStep, 1);
  });

  await run('REGRESSION: người thứ 2 duyệt nốt -> ĐỦ cả 2, chuyển APPROVED', async () => {
    const res = await approve(1, KETOAN2);
    assert.strictEqual(res.body.item.status, 'APPROVED');
  });

  await run('coApprovalMode[1]="ANY" + 2 approver: CHỈ 1 người duyệt -> ĐỦ NGAY, chuyển APPROVED', async () => {
    APP_DATA.paymentDeptWorkflows['Phòng Kế Toán'] = {
      workflowId: 'WF_1STEP', approvers: { 1: ['ketoan1', 'ketoan2'] }, coApprovalMode: { 1: 'ANY' }
    };
    seed(2);
    const res = await approve(2, KETOAN1);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.item.status, 'APPROVED', 'anyApprover=true: 1 trong 2 người duyệt phải ĐỦ ngay, không cần người còn lại');
    assert.strictEqual(res.body.item.history.length, 1, 'chỉ 1 lượt duyệt được ghi (người thứ 2 KHÔNG tự động bị coi là đã duyệt)');
    assert.strictEqual(res.body.item.history[0].username, 'ketoan1');
  });

  await run('coApprovalMode[1]="ANY": người KHÔNG thuộc danh sách approver vẫn bị chặn (canApproveStep không đổi)', async () => {
    seed(3);
    const outsider = { username: 'outsider', name: 'Người Ngoài', dept: 'Phòng Kế Toán', perms: { paymentManage: true, approverAuthLevel: 'NONE' } };
    const res = await approve(3, outsider);
    assert.strictEqual(res.status, 403, 'anyApprover KHÔNG nới lỏng canApproveStep() — vẫn phải có tên trong approvers[step]');
  });

  await run('2 BƯỚC, bước 1 ANY (2 approver) + bước 2 mặc định ALL (1 approver): 1 người duyệt bước 1 -> chuyển NGAY bước 2', async () => {
    APP_DATA.paymentDeptWorkflows['Phòng Kế Toán'] = {
      workflowId: 'WF_2STEP',
      approvers: { 1: ['ketoan1', 'ketoan2'], 2: ['giamdoc'] },
      coApprovalMode: { 1: 'ANY' }
    };
    seed(4);
    const res = await approve(4, KETOAN2);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.item.status, 'PENDING', 'còn bước 2 (Giám đốc) chưa duyệt');
    assert.strictEqual(res.body.item.currentStep, 2, 'anyApprover=true ở bước 1: 1/2 người duyệt phải ĐỦ để chuyển sang bước 2 NGAY, không cần người còn lại của bước 1');
  });

  await run('...Giám đốc duyệt nốt bước 2 (ALL mặc định, chỉ 1 approver nên không khác gì) -> APPROVED hoàn tất', async () => {
    const res = await approve(4, GIAMDOC);
    assert.strictEqual(res.body.item.status, 'APPROVED');
    assert.strictEqual(res.body.item.history.length, 2, 'đúng 2 lượt duyệt: ketoan2 (bước 1) + giamdoc (bước 2)');
  });

  await run('coApprovalMode[1]="ALL" (ghi tường minh, không phải thiếu field) -> hành vi giống hệt mặc định, vẫn cần đủ cả 2', async () => {
    APP_DATA.paymentDeptWorkflows['Phòng Kế Toán'] = {
      workflowId: 'WF_1STEP', approvers: { 1: ['ketoan1', 'ketoan2'] }, coApprovalMode: { 1: 'ALL' }
    };
    seed(5);
    const res = await approve(5, KETOAN1);
    assert.strictEqual(res.body.item.status, 'PENDING', 'coApprovalMode="ALL" tường minh phải giống hệt mặc định (thiếu field) — vẫn cần đủ 2 người');
  });

  console.log(`\n${passed}/${passed + failed} scenarios passed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => { console.error('FATAL:', err); process.exitCode = 1; });
