// server/tests/test-it-approval-deadline-reminder.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): jobs/itApprovalDeadlineReminder.js — 3 luồng "đang chờ
// xử lý" của Hỗ Trợ IT/Phê Duyệt Giá (leo thang phê duyệt ticket, yêu cầu bổ sung, từ chối khẩn cấp)
// trước đây chỉ có badge chờ trên giao diện, KHÔNG job nào chủ động nhắc khi treo quá lâu.
//
// Giả lập db/lib/recordStore/mailer/systemLogStore — cùng khuôn tests/test-payment-deadline-reminder.js.
//
// Chạy: node server/tests/test-it-approval-deadline-reminder.js
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
  console.log('== jobs/itApprovalDeadlineReminder.js (recordStore/mailer/systemLogStore giả) ==');

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
  stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
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

  APP_DATA.users = [
    { username: 'approver1', name: 'Người Phê Duyệt 1', email: 'approver1@test.vn', active: true, perms: {} },
    { username: 'nv1', name: 'Người Đề Xuất', email: 'nv1@test.vn', active: true, perms: {} },
    { username: 'kt_emergency', name: 'Người Duyệt Khẩn Cấp Bán Lẻ', email: 'kt_emergency@test.vn', active: true, perms: { itPriceEmergencyRejectApproveRetail: true } }
  ];

  STORE.itSupportTickets = [
    // Ticket 1: escalated 3 ngày trước (vượt ngưỡng 2) -> phải nhắc approver1.
    { id: 1, code: 'IT-001', title: 'Cài lại máy in', approvalStatus: 'PENDING', approvalApprover: 'approver1', approvalApproverName: 'Người Phê Duyệt 1', approvalReason: 'Cần ý kiến trưởng phòng', escalatedAt: vnDateTimeAgo(3), approvalReminderSent: false },
    // Ticket 2: escalated chỉ 1 ngày trước (chưa vượt ngưỡng) -> chưa nhắc.
    { id: 2, code: 'IT-002', title: 'Cấp quyền phần mềm', approvalStatus: 'PENDING', approvalApprover: 'approver1', approvalApproverName: 'Người Phê Duyệt 1', approvalReason: 'Xin duyệt', escalatedAt: vnDateTimeAgo(1), approvalReminderSent: false },
    // Ticket 3: đã APPROVED -> hoàn toàn bỏ qua.
    { id: 3, code: 'IT-003', title: 'Đã xong', approvalStatus: 'APPROVED', approvalApprover: 'approver1', escalatedAt: vnDateTimeAgo(10), approvalReminderSent: false }
  ];

  STORE.itPriceApprovals = [
    // Item 4: yêu cầu bổ sung treo 3 ngày -> phải nhắc creator (nv1).
    {
      id: 4, code: 'PG-001', creator: 'nv1', creatorName: 'Người Đề Xuất', priceType: 'RETAIL', status: 'APPROVED',
      infoRequests: [{ id: 100, requestedBy: 'it1', requestedByName: 'IT 1', reason: 'Thiếu file gốc', requestedAt: vnDateTimeAgo(3), response: null, respondedAt: null, byRole: 'it', reminderSent: false }]
    },
    // Item 5: yêu cầu từ chối khẩn cấp treo 3 ngày, priceType RETAIL -> phải nhắc kt_emergency.
    {
      id: 5, code: 'PG-002', creator: 'nv1', creatorName: 'Người Đề Xuất', priceType: 'RETAIL', status: 'APPROVED',
      emergencyRejectStatus: 'PENDING', emergencyRejectReason: 'Sai đơn giá', emergencyRejectRequestedBy: 'ql1', emergencyRejectRequestedByName: 'Quản Lý 1', emergencyRejectRequestedAt: vnDateTimeAgo(3), emergencyRejectReminderSent: false
    }
  ];

  const { checkItApprovalDeadlineReminders } = require('../jobs/itApprovalDeadlineReminder');

  await test('Ticket leo thang treo quá 2 ngày -> nhắc đúng approver', async () => {
    await checkItApprovalDeadlineReminders();
    const mails = sentMails.filter(m => m.subject.includes('IT-001'));
    assert.ok(mails.some(m => m.to.includes('approver1@test.vn')), 'Phải nhắc approver1');
  });

  await test('Ticket leo thang MỚI 1 ngày (chưa vượt ngưỡng) -> KHÔNG bị nhắc', () => {
    const mails = sentMails.filter(m => m.subject.includes('IT-002'));
    assert.strictEqual(mails.length, 0);
  });

  await test('Ticket đã APPROVED -> hoàn toàn không xử lý', () => {
    const t3 = STORE.itSupportTickets.find(t => t.id === 3);
    assert.strictEqual(t3.approvalReminderSent, false);
  });

  await test('Sau khi nhắc, approvalReminderSent=true (không nhắc lại lần sau)', async () => {
    const t1 = STORE.itSupportTickets.find(t => t.id === 1);
    assert.strictEqual(t1.approvalReminderSent, true);
    const mailCountBefore = sentMails.length;
    await checkItApprovalDeadlineReminders();
    assert.strictEqual(sentMails.filter(m => m.subject.includes('IT-001')).length, 1, 'Không được gửi thêm lần 2');
  });

  await test('Yêu cầu bổ sung Phê Duyệt Giá treo quá lâu -> nhắc đúng creator (người đề xuất)', () => {
    const mails = sentMails.filter(m => m.subject.includes('PG-001'));
    assert.ok(mails.some(m => m.to.includes('nv1@test.vn')), 'Phải nhắc người đề xuất nv1');
    const item4 = STORE.itPriceApprovals.find(i => i.id === 4);
    assert.strictEqual(item4.infoRequests[0].reminderSent, true);
  });

  await test('Yêu cầu từ chối khẩn cấp treo quá lâu (RETAIL) -> nhắc đúng người giữ quyền duyệt khẩn cấp Bán Lẻ', () => {
    const mails = sentMails.filter(m => m.subject.includes('PG-002'));
    assert.ok(mails.some(m => m.to.includes('kt_emergency@test.vn')), 'Phải nhắc kt_emergency (itPriceEmergencyRejectApproveRetail)');
    const item5 = STORE.itPriceApprovals.find(i => i.id === 5);
    assert.strictEqual(item5.emergencyRejectReminderSent, true);
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
