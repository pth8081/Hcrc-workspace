// server/tests/test-payment-deadline-reminder.js
//
// Test hồi quy cho jobs/paymentDeadlineReminder.js — LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 3, 9/2026):
// paymentRequests đã duyệt (APPROVED) có từng ĐỢT sắp/đã quá hạn thanh toán nhưng KHÔNG job nào chủ
// động nhắc — chỉ có badge cảnh báo trên giao diện. Giả lập lib/recordStore + lib/systemLogStore +
// lib/mailer + db bằng dữ liệu in-memory (KHÔNG cần SQL Server/SMTP thật) — cùng khuôn
// tests/test-report-period-deadline-reminder.js.
//
// Chạy: node server/tests/test-payment-deadline-reminder.js
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

async function main() {
  console.log('== jobs/paymentDeadlineReminder.js (recordStore/mailer/systemLogStore giả) ==');

  const STORE = { paymentRequests: [] };
  const APP_DATA = {
    emailConfig: { enabled: true, smtpHost: 'smtp.test', smtpPort: 587, senderEmail: 'system@test.vn' },
    users: []
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
  stubModule('lib/systemLogStore', {
    insertSystemLog: async (entry) => { loggedCalls.push(entry); }
  });
  const sentMails = [];
  stubModule('lib/mailer', {
    sendMail: async ({ to, subject }) => { sentMails.push({ to, subject }); return { sent: to, failed: [], simulated: false, host: 'smtp.test', port: 587 }; },
    resolveEncryption: () => 'STARTTLS'
  });
  stubModule('lib/emailCrypto', { decryptSecret: (s) => s });
  stubModule('db', {
    getPool: async () => ({
      request: () => {
        let key = null;
        const req = {
          input: (name, type, value) => { key = value; return req; },
          query: async () => {
            const value = APP_DATA[key];
            return { recordset: value === undefined ? [] : [{ DataValue: JSON.stringify(value) }] };
          }
        };
        return req;
      }
    }),
    sql: { NVarChar: () => 'NVARCHAR' }
  });

  const todayPlus = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  APP_DATA.users = [
    { username: 'nv1', name: 'Người Tạo Đề Nghị', email: 'nv1@test.vn', active: true, perms: {} },
    { username: 'kt1', name: 'Kế Toán 1', email: 'kt1@test.vn', active: true, perms: { paymentManage: true } },
    { username: 'kt2', name: 'Kế Toán 2 (không email)', email: '', active: true, perms: { paymentManage: true } }
  ];

  function makeInstallment(overrides) {
    return Object.assign({ description: '', amount: 1000000, dueDate: todayPlus(2), confirmed: false, confirmedAt: null, confirmedBy: null, notifiedThresholds: [] }, overrides);
  }

  STORE.paymentRequests = [
    // PR 1: APPROVED, đợt 1 còn 2 ngày (vượt ngưỡng 3) -> phải nhắc creator + kế toán có email.
    { id: 1, title: 'Thanh toán mua bàn ghế', status: 'APPROVED', createdBy: 'nv1', createdByName: 'Người Tạo Đề Nghị',
      installments: [makeInstallment({ description: 'Đợt 1', dueDate: todayPlus(2) })] },
    // PR 2: APPROVED, đợt ĐÃ confirmed -> không nhắc dù dueDate đã quá hạn từ lâu.
    { id: 2, title: 'Thanh toán đã xong đợt 1', status: 'APPROVED', createdBy: 'nv1', createdByName: 'Người Tạo Đề Nghị',
      installments: [makeInstallment({ description: 'Đợt 1', dueDate: todayPlus(-10), confirmed: true, confirmedAt: '08:00:00 1/1/2026', confirmedBy: 'kt1' })] },
    // PR 3: còn PENDING (chưa duyệt) -> hoàn toàn bỏ qua dù có đợt sắp đến hạn.
    { id: 3, title: 'Đang chờ duyệt', status: 'PENDING', createdBy: 'nv1', createdByName: 'Người Tạo Đề Nghị',
      installments: [makeInstallment({ description: 'Đợt 1', dueDate: todayPlus(1) })] },
    // PR 4: APPROVED, đợt còn 10 ngày -> chưa vượt ngưỡng nào.
    { id: 4, title: 'Còn lâu mới tới hạn', status: 'APPROVED', createdBy: 'nv1', createdByName: 'Người Tạo Đề Nghị',
      installments: [makeInstallment({ description: 'Đợt 1', dueDate: todayPlus(10) })] }
  ];

  const { checkPaymentDeadlineReminders } = require('../jobs/paymentDeadlineReminder');

  await test('Đợt APPROVED sắp đến hạn (còn 2 ngày, vượt ngưỡng 3) -> nhắc creator + kế toán có email', async () => {
    await checkPaymentDeadlineReminders();
    const mails = sentMails.filter(m => m.subject.includes('mua bàn ghế'));
    assert.ok(mails.some(m => m.to.includes('nv1@test.vn')), 'Người tạo đề nghị phải nhận được nhắc hạn');
    assert.ok(mails.some(m => m.to.includes('kt1@test.vn')), 'Kế toán giữ quyền paymentManage phải nhận được nhắc hạn');
  });

  await test('Kế toán không có email -> không nằm trong danh sách gửi, không gây lỗi', () => {
    const mails = sentMails.filter(m => m.subject.includes('mua bàn ghế'));
    assert.ok(!mails.some(m => m.to.includes('')), 'Không được có địa chỉ rỗng trong danh sách gửi');
  });

  await test('Đợt ĐÃ confirmed (dù quá hạn từ lâu) -> KHÔNG bị nhắc', () => {
    const mails = sentMails.filter(m => m.subject.includes('đã xong đợt 1'));
    assert.strictEqual(mails.length, 0, 'Đợt đã xác nhận thanh toán rồi thì không cần nhắc nữa');
  });

  await test('Đề nghị còn PENDING (chưa duyệt) -> hoàn toàn không xử lý', () => {
    const mails = sentMails.filter(m => m.subject.includes('Đang chờ duyệt'));
    assert.strictEqual(mails.length, 0, 'Chỉ xử lý status APPROVED — PENDING chưa "chờ thanh toán" thật sự');
    const pr3 = STORE.paymentRequests.find(p => p.id === 3);
    assert.deepStrictEqual(pr3.installments[0].notifiedThresholds, [], 'notifiedThresholds phải giữ nguyên rỗng');
  });

  await test('Đợt còn 10 ngày (chưa vượt ngưỡng nào) -> hoàn toàn không đụng tới', () => {
    const pr4 = STORE.paymentRequests.find(p => p.id === 4);
    assert.deepStrictEqual(pr4.installments[0].notifiedThresholds, [], 'Chưa tới ngưỡng nhắc nào thì notifiedThresholds phải giữ nguyên rỗng');
  });

  await test('Chạy lại lần 2 ngay sau đó -> KHÔNG gửi lại email cho đúng ngưỡng đã nhắc (idempotent)', async () => {
    const mailCountBefore = sentMails.length;
    await checkPaymentDeadlineReminders();
    assert.strictEqual(sentMails.length, mailCountBefore, 'Ngưỡng đã nhắc rồi thì chạy lại không được gửi thêm email nào nữa');
  });

  await test('Đợt rơi tiếp vào ngưỡng gần hơn (còn 0 ngày) -> lại nhắc thêm 1 lần cho ngưỡng mới', async () => {
    const pr1 = STORE.paymentRequests.find(p => p.id === 1);
    pr1.installments[0].dueDate = todayPlus(0);
    const mailCountBefore = sentMails.length;
    await checkPaymentDeadlineReminders();
    assert.ok(sentMails.length > mailCountBefore, 'Ngưỡng 0 (đến hạn hôm nay) là ngưỡng mới, chưa từng nhắc -> phải gửi thêm');
    assert.deepStrictEqual(pr1.installments[0].notifiedThresholds.sort(), [0, 1, 3], 'Phải cộng dồn TẤT CẢ ngưỡng đã vượt qua (3, 1 và 0 — nhảy từ diffDays=2 xuống 0 vượt luôn cả ngưỡng 1)');
  });

  await test('Gửi email thất bại toàn bộ -> KHÔNG đánh dấu đã nhắc, lần sau tự thử lại', async () => {
    STORE.paymentRequests.push({
      id: 5, title: 'Thử SMTP lỗi', status: 'APPROVED', createdBy: 'nv1', createdByName: 'Người Tạo Đề Nghị',
      installments: [makeInstallment({ description: 'Đợt 1', dueDate: todayPlus(1) })]
    });
    const originalSendMail = require('../lib/mailer').sendMail;
    stubModule('lib/mailer', {
      sendMail: async () => { throw new Error('Mất kết nối SMTP giả lập'); },
      resolveEncryption: () => 'STARTTLS'
    });
    delete require.cache[require.resolve('../jobs/paymentDeadlineReminder')];
    const { checkPaymentDeadlineReminders: retryJob } = require('../jobs/paymentDeadlineReminder');
    await retryJob();
    const pr5 = STORE.paymentRequests.find(p => p.id === 5);
    assert.deepStrictEqual(pr5.installments[0].notifiedThresholds, [], 'Gửi thất bại toàn bộ thì KHÔNG được đánh dấu đã nhắc');
    const logs = loggedCalls.filter(l => l.targetObject === 'Thử SMTP lỗi');
    assert.ok(logs.some(l => l.status === 'WARNING'), 'Phải ghi log WARNING khi gửi thất bại');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
