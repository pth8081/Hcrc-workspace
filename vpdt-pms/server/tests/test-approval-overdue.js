// server/tests/test-approval-overdue.js
//
// Test hồi quy cho tính năng "Quá Hạn Xử Lý" (11/2026):
//  1. lib/approvalOverdue.js::computeApprovalOverdueStatus() — hàm tính THUẦN, dùng chung giữa
//     jobs/approvalOverdueReminder.js (server) và badge hiển thị (public/js/core.js, mirror logic).
//  2. jobs/approvalOverdueReminder.js — khuôn test y hệt tests/test-payment-deadline-reminder.js: giả
//     lập lib/recordStore + lib/systemLogStore + lib/mailer + lib/emailCrypto + db bằng dữ liệu
//     in-memory, dùng item.effectiveSteps/effectiveApprovers (nhánh snapshot của resolveSubmissionWorkflow()/
//     resolveContractApprovalWorkflow(), lib/workflowEngine.js) để khỏi cần dựng deptWorkflows thật.
//
// Chạy: node server/tests/test-approval-overdue.js
'use strict';
const path = require('path');
const assert = require('assert');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

function vnDateTimeStr(date) {
  return date.toLocaleString('vi-VN', { hour12: false });
}
function daysAgoStr(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return vnDateTimeStr(d);
}

async function main() {
  console.log('== Quá Hạn Xử Lý: lib/approvalOverdue.js + jobs/approvalOverdueReminder.js ==');

  // --- Phần 1: computeApprovalOverdueStatus() (hàm thuần, không cần stub gì) ---
  const { computeApprovalOverdueStatus } = require('../lib/approvalOverdue');
  const SUB_CONFIG = { statusField: 'status', currentStepField: 'currentStep', historyField: 'history' };
  const CONTRACT_CONFIG = { statusField: 'approvalStatus', currentStepField: 'currentStep', historyField: 'history' };

  await test('Chờ 8 ngày ở bước 1, ngưỡng [3,5,7] -> OVERDUE (vượt ngưỡng lớn nhất)', () => {
    const item = { status: 'PENDING', currentStep: 1, createdAt: daysAgoStr(8), history: [] };
    const st = computeApprovalOverdueStatus(item, SUB_CONFIG, [3, 5, 7]);
    assert.ok(st);
    assert.strictEqual(st.level, 'OVERDUE');
    assert.strictEqual(st.threshold, 7);
  });

  await test('Chờ 4 ngày ở bước 1, ngưỡng [3,5,7] -> APPROACHING (chỉ vượt ngưỡng nhỏ nhất)', () => {
    const item = { status: 'PENDING', currentStep: 1, createdAt: daysAgoStr(4), history: [] };
    const st = computeApprovalOverdueStatus(item, SUB_CONFIG, [3, 5, 7]);
    assert.ok(st);
    assert.strictEqual(st.level, 'APPROACHING');
    assert.strictEqual(st.threshold, 3);
  });

  await test('Chờ 2 ngày (chưa tới ngưỡng nhỏ nhất) -> null', () => {
    const item = { status: 'PENDING', currentStep: 1, createdAt: daysAgoStr(2), history: [] };
    const st = computeApprovalOverdueStatus(item, SUB_CONFIG, [3, 5, 7]);
    assert.strictEqual(st, null);
  });

  await test('Mảng ngưỡng RỖNG -> tính năng TẮT, luôn trả null dù chờ rất lâu', () => {
    const item = { status: 'PENDING', currentStep: 1, createdAt: daysAgoStr(100), history: [] };
    const st = computeApprovalOverdueStatus(item, SUB_CONFIG, []);
    assert.strictEqual(st, null);
  });

  await test('Hồ sơ KHÔNG còn PENDING (đã duyệt xong) -> null dù thời gian tạo rất lâu', () => {
    const item = { status: 'APPROVED', currentStep: 2, createdAt: daysAgoStr(100), history: [] };
    const st = computeApprovalOverdueStatus(item, SUB_CONFIG, [3, 5, 7]);
    assert.strictEqual(st, null);
  });

  await test('Phụ lục hợp đồng (isAddendum) -> null, không áp dụng quá hạn', () => {
    const item = { approvalStatus: 'PENDING', currentStep: 1, createdAt: daysAgoStr(100), history: [], isAddendum: true };
    const st = computeApprovalOverdueStatus(item, CONTRACT_CONFIG, [3, 5, 7]);
    assert.strictEqual(st, null);
  });

  await test('Bước 2 -> đồng hồ chờ tính từ thời điểm bước 1 ĐƯỢC DUYỆT, không phải từ createdAt', () => {
    const item = {
      status: 'PENDING', currentStep: 2, createdAt: daysAgoStr(100),
      history: [{ step: 1, action: 'APPROVED', time: daysAgoStr(4), invalidated: false }]
    };
    const st = computeApprovalOverdueStatus(item, SUB_CONFIG, [3, 5, 7]);
    assert.ok(st);
    assert.strictEqual(st.level, 'APPROACHING');
    assert.strictEqual(st.daysWaited, 4);
  });

  await test('Co-approval (nhiều mục APPROVED cùng bước) -> lấy mục CUỐI CÙNG làm mốc bắt đầu', () => {
    const item = {
      status: 'PENDING', currentStep: 2, createdAt: daysAgoStr(100),
      history: [
        { step: 1, action: 'APPROVED', time: daysAgoStr(9), invalidated: false },
        { step: 1, action: 'APPROVED', time: daysAgoStr(4), invalidated: false }
      ]
    };
    const st = computeApprovalOverdueStatus(item, SUB_CONFIG, [3, 5, 7]);
    assert.strictEqual(st.daysWaited, 4, 'Phải lấy mốc gần nhất (4 ngày), không phải mốc đầu tiên (9 ngày)');
  });

  await test('Mục APPROVED đã invalidated (bị huỷ hiệu lực) -> bị loại khi tìm mốc, rơi về fallback createdAt', () => {
    const item = {
      status: 'PENDING', currentStep: 2, createdAt: daysAgoStr(100),
      history: [{ step: 1, action: 'APPROVED', time: daysAgoStr(9), invalidated: true }]
    };
    const st = computeApprovalOverdueStatus(item, SUB_CONFIG, [3, 5, 7]);
    assert.ok(st, 'Không còn mục APPROVED hợp lệ ở bước trước -> fallback về createdAt (100 ngày) -> vẫn tính được, chỉ không dùng mốc bước trước');
    assert.strictEqual(st.level, 'OVERDUE');
    assert.strictEqual(st.daysWaited, 100);
  });

  // --- Phần 2: jobs/approvalOverdueReminder.js (stub recordStore/systemLogStore/mailer/emailCrypto/db) ---
  const STORE = { submissions: [], contracts: [] };
  const APP_DATA = {
    emailConfig: {
      enabled: true, smtpHost: 'smtp.test', smtpPort: 587, senderEmail: 'system@test.vn',
      submissionOverdueDays: [3, 5, 7], submissionOverdueCcEmails: [],
      contractOverdueDays: [], contractOverdueCcEmails: []
    },
    users: [
      { username: 'gd1', name: 'Giám Đốc', email: 'gd1@test.vn', active: true, perms: {} },
      { username: 'nv1', name: 'Người Trình', email: 'nv1@test.vn', active: true, perms: {} }
    ]
  };
  stubModule('lib/recordStore', {
    getAllForCollection: async (c) => (STORE[c] || []).slice(),
    withLockedRecordById: async (c, id, mutatorFn) => {
      const arr = STORE[c] || [];
      const idx = arr.findIndex(x => x.id === id);
      if (idx === -1) throw new Error('Không tìm thấy bản ghi');
      arr[idx] = await mutatorFn(arr[idx]);
      return arr[idx];
    }
  });
  const loggedCalls = [];
  stubModule('lib/systemLogStore', { insertSystemLog: async (entry) => { loggedCalls.push(entry); } });
  const sentMails = [];
  stubModule('lib/mailer', {
    sendMail: async ({ to, subject }) => { sentMails.push({ to, subject }); return { sent: to, failed: [], simulated: false, host: 'smtp.test', port: 587 }; },
    resolveEncryption: () => 'STARTTLS',
    resolveGraphOption: () => null,
    resolveEwsOption: () => null
  });
  stubModule('lib/emailCrypto', { decryptSecret: (s) => s });
  stubModule('lib/appData', { getAllAppData: async () => APP_DATA });
  stubModule('db', { getPool: async () => ({}) });

  STORE.submissions = [
    // Sub 1: chờ 8 ngày ở bước 1 (vượt ngưỡng 7, cao nhất) -> phải nhắc approver bước 1 (gd1) + creator (nv1).
    {
      id: 1, code: 'TT-2026-0001', title: 'Tờ trình quá hạn', status: 'PENDING', currentStep: 1,
      creator: 'nv1', createdAt: daysAgoStr(8), history: [], overdueNotified: null,
      effectiveSteps: [{ order: 1, name: 'Bước 1' }], effectiveApprovers: { 1: ['gd1'] }
    },
    // Sub 2: chờ 2 ngày (chưa tới ngưỡng) -> hoàn toàn không đụng tới.
    {
      id: 2, code: 'TT-2026-0002', title: 'Tờ trình còn sớm', status: 'PENDING', currentStep: 1,
      creator: 'nv1', createdAt: daysAgoStr(2), history: [], overdueNotified: null,
      effectiveSteps: [{ order: 1, name: 'Bước 1' }], effectiveApprovers: { 1: ['gd1'] }
    }
  ];

  const { checkApprovalOverdueReminders } = require('../jobs/approvalOverdueReminder');

  await test('Job: tờ trình quá hạn -> gửi email cho approver bước hiện tại + người trình, ghi log SUCCESS', async () => {
    await checkApprovalOverdueReminders();
    const mails = sentMails.filter(m => m.subject.includes('TT-2026-0001'));
    assert.ok(mails.length >= 1, 'Phải gửi ít nhất 1 email cho tờ trình quá hạn');
    assert.ok(mails.some(m => m.to.includes('gd1@test.vn')), 'Approver bước hiện tại phải nhận được nhắc');
    assert.ok(mails.some(m => m.to.includes('nv1@test.vn')), 'Người trình phải nhận được nhắc');
    const logs = loggedCalls.filter(l => l.targetObject === 'TT-2026-0001');
    assert.ok(logs.some(l => l.status === 'SUCCESS'));
    const sub1 = STORE.submissions.find(s => s.id === 1);
    assert.deepStrictEqual(sub1.overdueNotified.thresholds.sort((a, b) => a - b), [3, 5, 7], 'Phải đánh dấu TẤT CẢ ngưỡng đã vượt qua');
    assert.strictEqual(sub1.overdueNotified.step, 1);
  });

  await test('Tờ trình còn sớm (chưa tới ngưỡng) -> không gửi email, không đụng overdueNotified', () => {
    const mails = sentMails.filter(m => m.subject.includes('TT-2026-0002'));
    assert.strictEqual(mails.length, 0);
    const sub2 = STORE.submissions.find(s => s.id === 2);
    assert.strictEqual(sub2.overdueNotified, null);
  });

  await test('Chạy lại lần 2 ngay sau đó -> KHÔNG gửi lại email cho đúng ngưỡng đã nhắc (idempotent)', async () => {
    const mailCountBefore = sentMails.length;
    await checkApprovalOverdueReminders();
    assert.strictEqual(sentMails.length, mailCountBefore, 'Đã nhắc đủ cả 3 ngưỡng rồi thì chạy lại không được gửi thêm');
  });

  await test('Hồ sơ ĐỔI SANG BƯỚC MỚI -> đồng hồ chờ RESET, overdueNotified cũ của bước trước không còn hiệu lực', async () => {
    const sub1 = STORE.submissions.find(s => s.id === 1);
    sub1.currentStep = 2;
    sub1.history = [{ step: 1, action: 'APPROVED', time: daysAgoStr(9), invalidated: false }];
    sub1.effectiveApprovers = { 1: ['gd1'], 2: ['gd1'] };
    const mailCountBefore = sentMails.length;
    await checkApprovalOverdueReminders();
    assert.ok(sentMails.length > mailCountBefore, 'Bước mới chưa từng được nhắc -> phải gửi lại dù overdueNotified cũ vẫn còn field');
    const updated = STORE.submissions.find(s => s.id === 1);
    assert.strictEqual(updated.overdueNotified.step, 2, 'Field theo dõi phải cập nhật sang step mới');
  });

  await test('Gửi email thất bại toàn bộ -> KHÔNG đánh dấu overdueNotified, lần sau tự thử lại', async () => {
    STORE.submissions.push({
      id: 3, code: 'TT-2026-0003', title: 'Thử SMTP lỗi', status: 'PENDING', currentStep: 1,
      creator: 'nv1', createdAt: daysAgoStr(8), history: [], overdueNotified: null,
      effectiveSteps: [{ order: 1, name: 'Bước 1' }], effectiveApprovers: { 1: ['gd1'] }
    });
    stubModule('lib/mailer', {
      sendMail: async () => { throw new Error('Mất kết nối SMTP giả lập'); },
      resolveEncryption: () => 'STARTTLS', resolveGraphOption: () => null, resolveEwsOption: () => null
    });
    delete require.cache[require.resolve('../jobs/approvalOverdueReminder')];
    const { checkApprovalOverdueReminders: retryJob } = require('../jobs/approvalOverdueReminder');
    await retryJob();
    const sub3 = STORE.submissions.find(s => s.id === 3);
    assert.strictEqual(sub3.overdueNotified, null, 'Gửi thất bại toàn bộ thì KHÔNG được đánh dấu đã nhắc');
    const logs = loggedCalls.filter(l => l.targetObject === 'TT-2026-0003');
    assert.ok(logs.some(l => l.status === 'WARNING'), 'Phải ghi log WARNING khi gửi thất bại');
  });

  await test('Module contracts chưa cấu hình ngưỡng (mảng rỗng) -> bỏ qua hoàn toàn, không lỗi', async () => {
    STORE.contracts = [{
      id: 10, code: 'HD-2026-0001', title: 'Hợp đồng test', approvalStatus: 'PENDING', currentStep: 1,
      creator: 'nv1', createdAt: daysAgoStr(100), history: [], overdueNotified: null,
      effectiveSteps: [{ order: 1, name: 'Bước 1' }], effectiveApprovers: { 1: ['gd1'] }
    }];
    const mailCountBefore = sentMails.length;
    delete require.cache[require.resolve('../jobs/approvalOverdueReminder')];
    const { checkApprovalOverdueReminders: job2 } = require('../jobs/approvalOverdueReminder');
    await job2();
    assert.strictEqual(sentMails.filter(m => m.subject.includes('HD-2026-0001')).length, 0);
    assert.strictEqual(mailCountBefore <= sentMails.length, true);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
