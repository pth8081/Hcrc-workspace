// server/tests/test-it-approval-deadline-reminder-no-recipients.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Thấp — phát hiện #13):
// jobs/itApprovalDeadlineReminder.js::sendReminder() TRƯỚC ĐÂY trả về `!totalSendFailure`, mà
// totalSendFailure LUÔN false khi recipients.length === 0 (điều kiện đầu tiên đòi recipients.length > 0)
// -> hàm gọi coi "chưa có ai nhận" là "đã gửi thành công", set cờ *ReminderSent=true VĨNH VIỄN dù CHƯA
// TỪNG gửi được cho ai. Nếu người được leo thang/duyệt sau đó mới có email hợp lệ hoặc được kích hoạt
// lại, job sẽ KHÔNG BAO GIỜ thử nhắc lại. Đã vá: chỉ set cờ khi recipients.length > 0 THẬT SỰ.
//
// Kịch bản: 1 ticket leo thang tới 1 approver KHÔNG có email (hoặc không tồn tại/đã nghỉ việc) — chạy
// job 2 lần liên tiếp, rồi "sửa" approver có email hợp lệ và chạy lần 3 -> PHẢI gửi được ở lần 3 (chứng
// minh flag KHÔNG bị set=true ở 2 lần đầu).
//
// Chạy: node server/tests/test-it-approval-deadline-reminder-no-recipients.js
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

function vnDateTimeAgo(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toLocaleString('vi-VN');
}

async function main() {
  console.log('== jobs/itApprovalDeadlineReminder.js — KHÔNG set *ReminderSent nếu chưa có người nhận hợp lệ ==');

  const STORE = { itSupportTickets: [], itPriceApprovals: [] };
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
  const systemLogs = [];
  stubModule('lib/systemLogStore', { insertSystemLog: async (e) => { systemLogs.push(e); } });
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

  // approver1 KHÔNG có trong danh sách users (VD tài khoản đã bị xoá/username gõ sai lúc leo thang) ->
  // recipients rỗng ở lượt đầu.
  APP_DATA.users = [];

  STORE.itSupportTickets = [
    { id: 1, code: 'IT-NORECIPIENT', title: 'Ticket approver không có email', approvalStatus: 'PENDING', approvalApprover: 'approver_missing', approvalApproverName: 'Người Đã Nghỉ', approvalReason: 'Cần ý kiến', escalatedAt: vnDateTimeAgo(5), approvalReminderSent: false }
  ];

  const { checkItApprovalDeadlineReminders } = require('../jobs/itApprovalDeadlineReminder');

  await test('LỖI ĐÃ VÁ: lượt 1 — KHÔNG có approver hợp lệ -> KHÔNG gửi mail, approvalReminderSent PHẢI VẪN LÀ false (không bị set true oan)', async () => {
    await checkItApprovalDeadlineReminders();
    const t1 = STORE.itSupportTickets.find(t => t.id === 1);
    assert.strictEqual(sentMails.length, 0, 'Không được gửi mail nào khi không có người nhận hợp lệ');
    assert.strictEqual(t1.approvalReminderSent, false,
      'approvalReminderSent bị set=true dù CHƯA gửi được cho ai — đây chính là lỗi ĐÃ VÁ (sendReminder() cũ coi "0 người nhận" là "gửi thành công")');
  });

  await test('Ghi Nhật Ký Hệ Thống mức WARNING "chưa có người nhận hợp lệ" ở lượt 1', () => {
    const log = systemLogs.find(l => l.targetObject && l.targetObject.includes('IT-NORECIPIENT'));
    assert.ok(log, JSON.stringify(systemLogs));
    assert.strictEqual(log.status, 'WARNING');
    assert(/chưa có người nhận/i.test(log.description), log.description);
  });

  await test('Lượt 2 (vẫn chưa có approver hợp lệ) -> job VẪN THỬ LẠI (không bị "khoá" bởi flag sai ở lượt 1)', async () => {
    sentMails.length = 0;
    await checkItApprovalDeadlineReminders();
    const t1 = STORE.itSupportTickets.find(t => t.id === 1);
    assert.strictEqual(t1.approvalReminderSent, false, 'Vẫn phải là false — job phải tự thử lại lần sau, không bị coi là "đã nhắc xong"');
  });

  await test('LỖI ĐÃ VÁ: sau khi approver có email hợp lệ (VD được tạo lại/sửa email) -> job GỬI ĐƯỢC ở lượt kế tiếp và MỚI set reminderSent=true', async () => {
    APP_DATA.users = [{ username: 'approver_missing', name: 'Người Đã Nghỉ', email: 'approver-now-valid@test.vn', active: true, perms: {} }];
    sentMails.length = 0;
    await checkItApprovalDeadlineReminders();
    const t1 = STORE.itSupportTickets.find(t => t.id === 1);
    assert.strictEqual(sentMails.length, 1, `Phải gửi được đúng 1 mail ở lượt này, nhận ${JSON.stringify(sentMails)}`);
    assert.ok(sentMails[0].to.includes('approver-now-valid@test.vn'));
    assert.strictEqual(t1.approvalReminderSent, true, 'Giờ mới THẬT SỰ gửi được -> cờ mới được phép set true');
  });

  await test('Lượt kế tiếp nữa (đã reminderSent=true, approver vẫn hợp lệ) -> KHÔNG gửi lại (hành vi CŨ không đổi khi đã gửi thành công thật)', async () => {
    sentMails.length = 0;
    await checkItApprovalDeadlineReminders();
    assert.strictEqual(sentMails.length, 0, 'Không được gửi lại khi đã reminderSent=true thật sự');
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
