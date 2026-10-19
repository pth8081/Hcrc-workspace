// server/tests/test-approval-extension-routes.js
//
// Test hồi quy cho tính năng "Gia Hạn Ngày Mong Muốn Phê Duyệt" (11/2026) — routes/workflow.js POST
// /:module/:id/extend-approval-deadline|request-approval-extension|confirm-approval-extension|
// reject-approval-extension, chỉ áp dụng cho submissions/contracts (dùng chung FORWARD_SUPPORTED_MODULES
// với tính năng Chuyển Tiếp Xin Ý Kiến). Mirror ĐÚNG khuôn test-forward-opinion-workflow.js: mount
// routes/workflow.js THẬT qua express(), stub lib/auth + lib/appData + lib/recordStore (in-memory) +
// lib/taskStore + lib/systemLogStore + lib/notifications, KHÔNG stub lib/workflowEngine (logic thật) —
// dùng item.effectiveSteps/effectiveApprovers (snapshot lúc tạo) để khỏi phải dựng đủ deptWorkflows giả.
//
// Chạy: node server/tests/test-approval-extension-routes.js
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
const OUTSIDER = { username: 'nv4', name: 'Người Ngoài Cuộc', dept: 'Phòng C', perms: {}, active: true };
const CREATOR = { username: 'nv1', name: 'Người Trình', dept: 'Phòng A', perms: {}, active: true };
const ADMIN_SELF = { username: 'admin1', name: 'Admin', dept: 'Phòng A', perms: { admin: true }, active: true };
const USERS = [APPROVER, FORWARDED_TO, OUTSIDER, CREATOR, ADMIN_SELF];

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
      desiredApprovalDate: null, pendingApprovalExtension: null, approvalDeadlineExtensions: [],
      overdueNotified: { step: 1, thresholds: [3, 5] },
      effectiveSteps: [{ order: 1, name: 'Bước 1' }],
      effectiveApprovers: { 1: [APPROVER.username] }
    }],
    contracts: [{
      id: 2, dept: 'Phòng A', approvalStatus: 'PENDING', currentStep: 1, code: 'HD-2026-0001', title: 'Hợp đồng test',
      creator: CREATOR.username, creatorName: CREATOR.name, history: [], forwardThreads: [],
      desiredApprovalDate: null, pendingApprovalExtension: null, approvalDeadlineExtensions: [],
      effectiveSteps: [{ order: 1, name: 'Bước 1' }],
      effectiveApprovers: { 1: [APPROVER.username] }
    }],
    carRegs: [{
      id: 3, dept: 'Phòng A', status: 'PENDING', currentStep: 1, code: 'XE-2026-0001', history: [],
      effectiveSteps: [{ order: 1, name: 'Bước 1' }], effectiveApprovers: { 1: [APPROVER.username] }
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
  console.log('== Gia Hạn Ngày Mong Muốn Phê Duyệt — 4 route extend/request/confirm/reject-approval-extension ==');
  const server = await startApp();
  try {
    await test('Approver bước hiện tại gia hạn TRỰC TIẾP -> 200, desiredApprovalDate cập nhật + log extension + reset overdueNotified', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/submissions/1/extend-approval-deadline',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Cần thêm thời gian xử lý' }, APPROVER);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.item.desiredApprovalDate, '2026-12-31');
      assert.strictEqual(r.body.item.approvalDeadlineExtensions.length, 1);
      assert.strictEqual(r.body.item.approvalDeadlineExtensions[0].appliedBy, APPROVER.username);
      assert.strictEqual(r.body.item.approvalDeadlineExtensions[0].viaRequestFrom, null);
      assert.strictEqual(r.body.item.overdueNotified, null, 'phải reset overdueNotified để job email nhắc lại từ đầu theo mốc mới');
    });

    await test('Gia hạn thiếu lý do -> 400', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/submissions/1/extend-approval-deadline',
        { newDesiredApprovalDate: '2026-12-31', reason: '' }, APPROVER);
      assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    });

    await test('Gia hạn ngày không hợp lệ -> 400', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/submissions/1/extend-approval-deadline',
        { newDesiredApprovalDate: 'not-a-date', reason: 'Lý do' }, APPROVER);
      assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    });

    await test('Gia hạn ra mốc SỚM HƠN mốc đã đặt trước đó -> 400', async () => {
      resetRecords();
      RECORDS.submissions[0].desiredApprovalDate = '2026-06-01';
      const r = await api('POST', '/api/workflow/submissions/1/extend-approval-deadline',
        { newDesiredApprovalDate: '2026-05-01', reason: 'Lý do' }, APPROVER);
      assert.strictEqual(r.status, 400, JSON.stringify(r.body));
    });

    await test('Người KHÔNG phải approver bước hiện tại gọi extend-approval-deadline -> 403', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/submissions/1/extend-approval-deadline',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, OUTSIDER);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
      assert.strictEqual(RECORDS.submissions[0].desiredApprovalDate, null);
    });

    await test('Người được Chuyển Tiếp Xin Ý Kiến KHÔNG thể gia hạn TRỰC TIẾP (chỉ approver thật mới được) -> 403', async () => {
      resetRecords();
      await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      const r = await api('POST', '/api/workflow/submissions/1/extend-approval-deadline',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, FORWARDED_TO);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    });

    await test('Người được Chuyển Tiếp Xin Ý Kiến ĐỀ NGHỊ gia hạn -> 200, ghi pendingApprovalExtension + báo cho approver thật', async () => {
      resetRecords();
      await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      const r = await api('POST', '/api/workflow/submissions/1/request-approval-extension',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Đang chờ bổ sung hồ sơ' }, FORWARDED_TO);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.item.desiredApprovalDate, null, 'CHƯA áp dụng ngay — chỉ là đề nghị chờ xác nhận');
      assert.strictEqual(r.body.item.pendingApprovalExtension.requestedBy, FORWARDED_TO.username);
      assert.strictEqual(r.body.item.pendingApprovalExtension.newDesiredApprovalDate, '2026-12-31');
      assert.ok(sentNotifications.some(n => n.usernames.includes(APPROVER.username) && n.type === 'APPROVAL_EXTENSION_REQUESTED'),
        'phải đẩy thông báo lên đúng người phê duyệt thật ở nhánh ngang');
    });

    await test('Người KHÔNG phải được chuyển tiếp (không có node nào) đề nghị gia hạn -> 403', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/submissions/1/request-approval-extension',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, OUTSIDER);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    });

    await test('Đã có 1 đề nghị đang chờ -> đề nghị thứ 2 bị chặn 409', async () => {
      resetRecords();
      await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      await api('POST', '/api/workflow/submissions/1/request-approval-extension',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Lần 1' }, FORWARDED_TO);
      const r2 = await api('POST', '/api/workflow/submissions/1/request-approval-extension',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Lần 2' }, FORWARDED_TO);
      assert.strictEqual(r2.status, 409, JSON.stringify(r2.body));
    });

    await test('Approver ĐỒNG Ý đề nghị (confirm) -> 200, desiredApprovalDate cập nhật đúng mốc đề nghị + xoá pending + log viaRequestFrom + báo lại người đề nghị', async () => {
      resetRecords();
      await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      await api('POST', '/api/workflow/submissions/1/request-approval-extension',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, FORWARDED_TO);
      const r = await api('POST', '/api/workflow/submissions/1/confirm-approval-extension', {}, APPROVER);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.item.desiredApprovalDate, '2026-12-31');
      assert.strictEqual(r.body.item.pendingApprovalExtension, null);
      assert.strictEqual(r.body.item.approvalDeadlineExtensions[0].viaRequestFrom, FORWARDED_TO.username);
      assert.strictEqual(r.body.item.overdueNotified, null);
      assert.ok(sentNotifications.some(n => n.usernames.includes(FORWARDED_TO.username) && n.type === 'APPROVAL_EXTENSION_CONFIRMED'));
    });

    await test('Approver TỪ CHỐI đề nghị (reject) -> 200, desiredApprovalDate KHÔNG đổi + xoá pending + báo lại người đề nghị', async () => {
      resetRecords();
      await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      await api('POST', '/api/workflow/submissions/1/request-approval-extension',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, FORWARDED_TO);
      const r = await api('POST', '/api/workflow/submissions/1/reject-approval-extension', { reason: 'Chưa đủ căn cứ' }, APPROVER);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.item.desiredApprovalDate, null);
      assert.strictEqual(r.body.item.pendingApprovalExtension, null);
      assert.ok(sentNotifications.some(n => n.usernames.includes(FORWARDED_TO.username) && n.type === 'APPROVAL_EXTENSION_REJECTED'));
    });

    await test('Confirm/reject khi KHÔNG có đề nghị đang chờ -> 404', async () => {
      resetRecords();
      const r1 = await api('POST', '/api/workflow/submissions/1/confirm-approval-extension', {}, APPROVER);
      assert.strictEqual(r1.status, 404, JSON.stringify(r1.body));
      const r2 = await api('POST', '/api/workflow/submissions/1/reject-approval-extension', {}, APPROVER);
      assert.strictEqual(r2.status, 404, JSON.stringify(r2.body));
    });

    await test('Người KHÔNG phải approver confirm/reject đề nghị -> 403', async () => {
      resetRecords();
      await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      await api('POST', '/api/workflow/submissions/1/request-approval-extension',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, FORWARDED_TO);
      const r = await api('POST', '/api/workflow/submissions/1/confirm-approval-extension', {}, OUTSIDER);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
      assert.ok(RECORDS.submissions[0].pendingApprovalExtension, 'đề nghị vẫn còn nguyên, không bị người lạ xử lý');
    });

    await test('Hồ sơ không còn PENDING -> cả 4 route đều chặn 409', async () => {
      resetRecords();
      RECORDS.submissions[0].status = 'APPROVED';
      const r1 = await api('POST', '/api/workflow/submissions/1/extend-approval-deadline', { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, APPROVER);
      assert.strictEqual(r1.status, 409, JSON.stringify(r1.body));
      const r2 = await api('POST', '/api/workflow/submissions/1/request-approval-extension', { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, FORWARDED_TO);
      assert.strictEqual(r2.status, 409, JSON.stringify(r2.body));
      RECORDS.submissions[0].pendingApprovalExtension = { id: 'x', requestedBy: FORWARDED_TO.username, newDesiredApprovalDate: '2026-12-31', reason: 'x' };
      const r3 = await api('POST', '/api/workflow/submissions/1/confirm-approval-extension', {}, APPROVER);
      assert.strictEqual(r3.status, 409, JSON.stringify(r3.body));
      const r4 = await api('POST', '/api/workflow/submissions/1/reject-approval-extension', {}, APPROVER);
      assert.strictEqual(r4.status, 409, JSON.stringify(r4.body));
    });

    await test('Module không hỗ trợ (vd carRegs) -> cả 4 route đều 400', async () => {
      resetRecords();
      const r1 = await api('POST', '/api/workflow/carRegs/3/extend-approval-deadline', { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, APPROVER);
      assert.strictEqual(r1.status, 400, JSON.stringify(r1.body));
      const r2 = await api('POST', '/api/workflow/carRegs/3/request-approval-extension', { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, APPROVER);
      assert.strictEqual(r2.status, 400, JSON.stringify(r2.body));
      const r3 = await api('POST', '/api/workflow/carRegs/3/confirm-approval-extension', {}, APPROVER);
      assert.strictEqual(r3.status, 400, JSON.stringify(r3.body));
      const r4 = await api('POST', '/api/workflow/carRegs/3/reject-approval-extension', {}, APPROVER);
      assert.strictEqual(r4.status, 400, JSON.stringify(r4.body));
    });

    await test('Hợp đồng (contracts) — cùng quy trình gia hạn trực tiếp hoạt động đúng như submissions', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/contracts/2/extend-approval-deadline',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, APPROVER);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.item.desiredApprovalDate, '2026-12-31');
    });

    // LỖI ĐÃ VÁ (re-audit lần 10, mục 7/14, mức Cao): 3 route extend/confirm/reject-approval-extension
    // chỉ gác qua canApproveStep() (TỰ ĐỘNG true với admin) mà KHÔNG gọi assertNotSelfDecidingWorkflowItem()
    // như mọi hành động APPROVE/REJECT thật khác trong applyWorkflowAction() — admin tự trình hồ sơ
    // (hoặc 1 approver KHÔNG-admin vô tình trùng với creator) vẫn tự gia hạn/tự xác nhận/tự từ chối đề
    // nghị gia hạn trên hồ sơ CHÍNH MÌNH tạo được, trái với quyết định "chặn admin tự duyệt ở TẤT CẢ
    // module" (CLAUDE.md, mục 11/2026).
    await test('[Vá #216] Admin là NGƯỜI TẠO hồ sơ tự gia hạn TRỰC TIẾP hồ sơ của chính mình -> 403 (không còn bypass qua canApproveStep)', async () => {
      resetRecords();
      RECORDS.submissions[0].creator = ADMIN_SELF.username;
      const r = await api('POST', '/api/workflow/submissions/1/extend-approval-deadline',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, ADMIN_SELF);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
      assert.strictEqual(RECORDS.submissions[0].desiredApprovalDate, null, 'không được áp dụng gia hạn');
    });

    await test('[Vá #216] Approver KHÔNG-admin trùng với người tạo hồ sơ tự gia hạn -> 403', async () => {
      resetRecords();
      RECORDS.submissions[0].creator = APPROVER.username;
      const r = await api('POST', '/api/workflow/submissions/1/extend-approval-deadline',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, APPROVER);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
    });

    await test('[Vá #216] Admin là người tạo hồ sơ tự XÁC NHẬN (confirm) đề nghị gia hạn trên hồ sơ của chính mình -> 403', async () => {
      resetRecords();
      RECORDS.submissions[0].creator = ADMIN_SELF.username;
      await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      await api('POST', '/api/workflow/submissions/1/request-approval-extension',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, FORWARDED_TO);
      const r = await api('POST', '/api/workflow/submissions/1/confirm-approval-extension', {}, ADMIN_SELF);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
      assert.ok(RECORDS.submissions[0].pendingApprovalExtension, 'đề nghị vẫn còn nguyên, chưa bị tự áp dụng');
    });

    await test('[Vá #216] Admin là người tạo hồ sơ tự TỪ CHỐI (reject) đề nghị gia hạn trên hồ sơ của chính mình -> 403', async () => {
      resetRecords();
      RECORDS.submissions[0].creator = ADMIN_SELF.username;
      await api('POST', '/api/workflow/submissions/1/forward', { targetUsernames: [FORWARDED_TO.username] }, APPROVER);
      await api('POST', '/api/workflow/submissions/1/request-approval-extension',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, FORWARDED_TO);
      const r = await api('POST', '/api/workflow/submissions/1/reject-approval-extension', { reason: 'x' }, ADMIN_SELF);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
      assert.ok(RECORDS.submissions[0].pendingApprovalExtension, 'đề nghị vẫn còn nguyên, chưa bị tự xử lý');
    });

    await test('[Vá #216] Admin KHÔNG phải người tạo hồ sơ vẫn gia hạn được bình thường (không chặn oan)', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/submissions/1/extend-approval-deadline',
        { newDesiredApprovalDate: '2026-12-31', reason: 'Lý do' }, ADMIN_SELF);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.item.desiredApprovalDate, '2026-12-31');
    });
  } finally {
    server.close();
  }

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
