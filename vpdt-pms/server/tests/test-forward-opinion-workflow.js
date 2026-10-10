// server/tests/test-forward-opinion-workflow.js
//
// Test hồi quy cho tính năng "Chuyển Tiếp Xin Ý Kiến" (forwardThreads[]) — routes/workflow.js
// POST /:module/:id/forward|/forward-reply, chỉ áp dụng cho submissions/contracts. Mirror đúng khuôn
// test-workflow-moduleaccess-gate.js: mount routes/workflow.js THẬT qua express(), stub lib/auth +
// lib/appData + lib/recordStore (in-memory) + lib/taskStore + lib/systemLogStore + lib/notifications,
// KHÔNG stub lib/workflowEngine/lib/recordViewScope/lib/createValidation (logic thật). Dùng
// item.effectiveSteps/effectiveApprovers (nhánh "đã snapshot lúc tạo" của resolveSubmissionWorkflow()/
// resolveContractApprovalWorkflow(), lib/workflowEngine.js) để khỏi phải dựng đủ deptWorkflows/workflows
// giả — đơn giản hoá fixture mà vẫn đi qua ĐÚNG đường code thật.
//
// Chạy: node server/tests/test-forward-opinion-workflow.js
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

const APPROVER = { username: 'gd1', name: 'Giám Đốc', dept: 'Phòng A', perms: {}, active: true };
const FORWARDED_TO = { username: 'nv2', name: 'Nhân Viên 2', dept: 'Phòng B', perms: {}, active: true };
const FORWARDED_TO_2 = { username: 'nv3', name: 'Nhân Viên 3', dept: 'Phòng B', perms: {}, active: true };
const OUTSIDER = { username: 'nv4', name: 'Người Ngoài Cuộc', dept: 'Phòng C', perms: {}, active: true };
const CREATOR = { username: 'nv1', name: 'Người Trình', dept: 'Phòng A', perms: {}, active: true };
const USERS = [APPROVER, FORWARDED_TO, FORWARDED_TO_2, OUTSIDER, CREATOR];

let CURRENT_USERNAME = APPROVER.username;
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

const APP_DATA = { users: USERS };
stubModule('lib/appData', {
  getAllAppData: async () => APP_DATA,
  getAppDataValue: async () => ({}),
  withLockedAppDataValue: async (_k, fn) => fn([])
});

let RECORDS;
function resetRecords() {
  RECORDS = {
    submissions: [{
      id: 1, dept: 'Phòng A', status: 'PENDING', currentStep: 1, code: 'TT-2026-0001', title: 'Tờ trình test',
      creator: CREATOR.username, creatorName: CREATOR.name, history: [], forwardThreads: [],
      effectiveSteps: [{ order: 1, name: 'Bước 1' }],
      effectiveApprovers: { 1: [APPROVER.username] }
    }],
    contracts: [{
      id: 2, dept: 'Phòng A', approvalStatus: 'PENDING', currentStep: 1, code: 'HD-2026-0001', title: 'Hợp đồng test',
      creator: CREATOR.username, creatorName: CREATOR.name, history: [], forwardThreads: [],
      effectiveSteps: [{ order: 1, name: 'Bước 1' }],
      effectiveApprovers: { 1: [APPROVER.username] }
    }]
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
  insertRecord: async (c, rec) => rec
});
stubModule('lib/taskStore', { insertTask: async () => {} });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
const sentNotifications = [];
stubModule('lib/notifications', {
  notifyUsers: async (usernames, type, title, message, linkTo) => { sentNotifications.push({ usernames, type, title, message, linkTo }); }
});

const express = require('express');
const workflowRoutes = require('../routes/workflow');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/workflow', workflowRoutes);
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
  console.log('== Chuyển Tiếp Xin Ý Kiến — POST /api/workflow/:module/:id/forward|/forward-reply ==');
  const server = await startApp();
  try {
    await test('Approver bước hiện tại chuyển tiếp cho 1 người -> 200, tạo đúng 1 node', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username], message: 'Nhờ xem giúp' }, APPROVER);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.createdNodes.length, 1);
      const node = r.body.item.forwardThreads[0];
      assert.strictEqual(node.forwardedBy, APPROVER.username);
      assert.strictEqual(node.forwardedTo, FORWARDED_TO.username);
      assert.strictEqual(node.step, 1);
      assert.strictEqual(node.parentNodeId, null);
      assert.strictEqual(node.message, 'Nhờ xem giúp');
      assert.ok(sentNotifications.some(n => n.usernames.includes(FORWARDED_TO.username)), 'Phải tạo thông báo trong app cho người được chuyển tiếp');
    });

    await test('Chuyển tiếp CÙNG LÚC cho nhiều người (multi-select) -> tạo đúng nhiều node độc lập', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username, FORWARDED_TO_2.username] }, APPROVER);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.createdNodes.length, 2);
      const sub = RECORDS.submissions.find(s => s.id === 1);
      assert.strictEqual(sub.forwardThreads.length, 2);
      const targets = sub.forwardThreads.map(n => n.forwardedTo).sort();
      assert.deepStrictEqual(targets, [FORWARDED_TO.username, FORWARDED_TO_2.username].sort());
    });

    await test('Người KHÔNG phải approver bước hiện tại chuyển tiếp -> 403', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, OUTSIDER);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
      assert.strictEqual(RECORDS.submissions[0].forwardThreads.length, 0);
    });

    await test('Chuyển tiếp cho chính mình -> 400', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [APPROVER.username] }, APPROVER);
      assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    });

    await test('Module không hỗ trợ (vd carRegs) -> 400', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/carRegs/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    });

    await test('Chuyển Tiếp Tiếp (continuation) — người được chuyển tiếp forward tiếp cho người khác -> node con đúng step/parentNodeId', async () => {
      resetRecords();
      const r1 = await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      const parentId = r1.body.item.forwardThreads[0].id;
      const r2 = await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO_2.username], parentNodeId: parentId }, FORWARDED_TO);
      assert.strictEqual(r2.status, 200, JSON.stringify(r2.body));
      const childNode = r2.body.item.forwardThreads.find(n => n.parentNodeId === parentId);
      assert.ok(childNode, 'Phải có node con trỏ đúng parentNodeId');
      assert.strictEqual(childNode.forwardedBy, FORWARDED_TO.username);
      assert.strictEqual(childNode.forwardedTo, FORWARDED_TO_2.username);
      assert.strictEqual(childNode.step, 1, 'Node con kế thừa đúng step của node cha');
    });

    await test('Chuyển Tiếp Tiếp bởi người KHÔNG phải forwardedTo của node cha -> 403', async () => {
      resetRecords();
      const r1 = await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      const parentId = r1.body.item.forwardThreads[0].id;
      const r2 = await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO_2.username], parentNodeId: parentId }, OUTSIDER);
      assert.strictEqual(r2.status, 403, JSON.stringify(r2.body));
    });

    await test('Forward-reply — đúng người được chuyển tiếp trả lời -> 200, node.reply được ghi', async () => {
      resetRecords();
      const r1 = await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      const nodeId = r1.body.item.forwardThreads[0].id;
      const r2 = await api('POST', '/api/workflow/submissions/1/forward-reply', { nodeId, comment: 'Đã xem, ổn' }, FORWARDED_TO);
      assert.strictEqual(r2.status, 200, JSON.stringify(r2.body));
      const node = r2.body.item.forwardThreads.find(n => n.id === nodeId);
      assert.strictEqual(node.reply.comment, 'Đã xem, ổn');
      assert.ok(node.reply.repliedAt);
      assert.ok(sentNotifications.some(n => n.usernames.includes(APPROVER.username) && n.type === 'FORWARD_OPINION_REPLIED'), 'Phải báo lại cho người đã chuyển tiếp');
    });

    await test('Forward-reply bởi người KHÔNG phải forwardedTo -> 403', async () => {
      resetRecords();
      const r1 = await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      const nodeId = r1.body.item.forwardThreads[0].id;
      const r2 = await api('POST', '/api/workflow/submissions/1/forward-reply', { nodeId, comment: 'Giả mạo' }, OUTSIDER);
      assert.strictEqual(r2.status, 403, JSON.stringify(r2.body));
    });

    await test('Forward-reply lần 2 cho node ĐÃ trả lời -> 409', async () => {
      resetRecords();
      const r1 = await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      const nodeId = r1.body.item.forwardThreads[0].id;
      await api('POST', '/api/workflow/submissions/1/forward-reply', { nodeId, comment: 'Lần 1' }, FORWARDED_TO);
      const r2 = await api('POST', '/api/workflow/submissions/1/forward-reply', { nodeId, comment: 'Lần 2' }, FORWARDED_TO);
      assert.strictEqual(r2.status, 409, JSON.stringify(r2.body));
    });

    await test('Forward-reply rỗng (không comment, không file) -> 400', async () => {
      resetRecords();
      const r1 = await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      const nodeId = r1.body.item.forwardThreads[0].id;
      const r2 = await api('POST', '/api/workflow/submissions/1/forward-reply', { nodeId, comment: '' }, FORWARDED_TO);
      assert.strictEqual(r2.status, 400, JSON.stringify(r2.body));
    });

    await test('Hợp đồng (contracts) — cùng quy trình forward hoạt động đúng như submissions', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/contracts/2/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.item.forwardThreads[0].forwardedTo, FORWARDED_TO.username);
    });

    await test('isForwardThreadParticipant() (lib/recordViewScope.js) — forwardedTo xem được hồ sơ dù khác phòng ban', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      const sub = r.body.item;
      const { canViewSubmission } = require('../lib/recordViewScope');
      assert.ok(canViewSubmission(FORWARDED_TO, sub, APP_DATA), 'Người được chuyển tiếp (khác phòng ban) phải xem được hồ sơ');
      assert.ok(!canViewSubmission(OUTSIDER, sub, APP_DATA), 'Người ngoài cuộc không liên quan KHÔNG được xem thêm nhờ tính năng này');
    });
  } finally {
    server.close();
  }

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
