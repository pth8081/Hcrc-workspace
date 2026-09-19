// server/tests/test-report-period-deadline-reminder.js
//
// Test hồi quy cho jobs/reportPeriodDeadlineReminder.js — LỖI ĐÃ VÁ (rà soát chuyên sâu Điều Hành,
// 9/2026): tài liệu Nghiệp Vụ tuyên bố "hệ thống tự nhắc các phòng ban chưa nộp khi gần tới hạn kỳ báo
// cáo" nhưng chưa từng cài đặt job này. Giả lập lib/recordStore + lib/systemLogStore + lib/mailer bằng
// dữ liệu in-memory (KHÔNG cần SQL Server/SMTP thật) — cùng khuôn tests/test-leave-balance-year-rollover.js.
//
// Chạy: node server/tests/test-report-period-deadline-reminder.js
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
  console.log('== jobs/reportPeriodDeadlineReminder.js (recordStore/mailer/systemLogStore giả) ==');

  const STORE = { reportPeriods: [], reportEntries: [] };
  const APP_DATA = {
    emailConfig: { enabled: true, smtpHost: 'smtp.test', smtpPort: 587, senderEmail: 'system@test.vn' },
    users: [],
    depts: ['Phòng Kinh Doanh', 'Phòng Kế Toán', 'Phòng Nhân Sự']
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
  // db.js thật sẽ cố kết nối SQL Server thật — job này còn cần đọc emailConfig/users/depts trực tiếp
  // qua getPool()+SQL text (giống các job khác), nên giả lập luôn getPool() trả về 1 "pool" giả biết
  // trả lời đúng 3 khoá DataKey trên, không đụng gì tới recordStore ở trên (2 đường đọc riêng biệt,
  // đúng kiến trúc hiện tại của các job nhắc hạn khác).
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

  const currentYear = new Date().getFullYear();
  const todayPlus = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString();
  };

  APP_DATA.users = [
    { username: 'kd1', name: 'NV Kinh Doanh', dept: 'Phòng Kinh Doanh', email: 'kd1@test.vn', active: true, perms: { reportEntryCreate: true } },
    { username: 'kt1', name: 'NV Kế Toán', dept: 'Phòng Kế Toán', email: 'kt1@test.vn', active: true, perms: { reportEntryCreate: true } },
    { username: 'ns1', name: 'NV Nhân Sự', dept: 'Phòng Nhân Sự', email: 'ns1@test.vn', active: true, perms: {} } // KHÔNG có reportEntryCreate
  ];

  STORE.reportPeriods = [
    // Kỳ 1: còn 2 ngày -> vượt ngưỡng 3, Kinh Doanh ĐÃ nộp (SUBMITTED), Kế Toán CHƯA nộp -> chỉ nhắc Kế Toán.
    { id: 1, name: 'Báo cáo Tuần 1', status: 'OPEN', endTime: todayPlus(2), deptScope: { all: false, depts: ['Phòng Kinh Doanh', 'Phòng Kế Toán'] }, notifiedDeadlineThresholds: [] },
    // Kỳ 2: đã quá hạn 1 ngày (ngưỡng 0) -> deptScope.all -> Nhân Sự chưa nộp nhưng KHÔNG ai của Nhân Sự
    // có quyền reportEntryCreate -> vẫn ghi log WARNING, không throw lỗi làm hỏng cả job.
    { id: 2, name: 'Báo cáo Tuần 2', status: 'OPEN', endTime: todayPlus(-1), deptScope: { all: true }, notifiedDeadlineThresholds: [] },
    // Kỳ 3: còn 10 ngày -> CHƯA vượt ngưỡng nào -> không đụng gì tới.
    { id: 3, name: 'Báo cáo Tuần 3', status: 'OPEN', endTime: todayPlus(10), deptScope: { all: true }, notifiedDeadlineThresholds: [] },
    // Kỳ 4: đã CLOSED -> bỏ qua hoàn toàn dù endTime gần.
    { id: 4, name: 'Báo cáo Tuần 4 (đã đóng)', status: 'CLOSED', endTime: todayPlus(0), deptScope: { all: true }, notifiedDeadlineThresholds: [] }
  ];
  STORE.reportEntries = [
    { id: 100, periodId: 1, dept: 'Phòng Kinh Doanh', creator: 'kd1', status: 'SUBMITTED' }
  ];

  const { checkReportPeriodDeadlineReminders } = require('../jobs/reportPeriodDeadlineReminder');

  await test('Kỳ còn 2 ngày, phòng ĐÃ nộp KHÔNG bị nhắc, phòng CHƯA nộp bị nhắc đúng người có quyền nộp', async () => {
    await checkReportPeriodDeadlineReminders();
    const tuan1Mails = sentMails.filter(m => m.subject.includes('Tuần 1'));
    assert.ok(!tuan1Mails.some(m => m.to.includes('kd1@test.vn')), 'Phòng Kinh Doanh đã nộp SUBMITTED cho kỳ Tuần 1 -> KHÔNG được nhắc ở kỳ đó');
    assert.ok(tuan1Mails.some(m => m.to.includes('kt1@test.vn')), 'Phòng Kế Toán chưa nộp kỳ Tuần 1 -> phải nhắc đúng người có quyền reportEntryCreate của phòng đó');
  });

  await test('Kỳ đã quá hạn (ngưỡng 0), phòng chưa nộp nhưng không ai đủ quyền -> ghi log WARNING, không crash', async () => {
    const logs = loggedCalls.filter(l => l.targetObject && l.targetObject.includes('Phòng Nhân Sự'));
    assert.ok(logs.length > 0, 'Phải có log cho Phòng Nhân Sự dù không gửi được email nào');
    assert.strictEqual(logs[0].status, 'WARNING', 'Không có người nhận hợp lệ -> log phải là WARNING');
    const ns1Mail = sentMails.find(m => m.to.includes('ns1@test.vn'));
    assert.ok(!ns1Mail, 'ns1 không có quyền reportEntryCreate -> không được coi là người nhận hợp lệ');
  });

  await test('Kỳ còn 10 ngày (chưa vượt ngưỡng nào) -> hoàn toàn không đụng tới', () => {
    const period3 = STORE.reportPeriods.find(p => p.id === 3);
    assert.deepStrictEqual(period3.notifiedDeadlineThresholds, [], 'Kỳ chưa tới ngưỡng nhắc nào thì notifiedDeadlineThresholds phải giữ nguyên rỗng');
  });

  await test('Kỳ đã CLOSED -> bỏ qua hoàn toàn dù endTime gần/đã qua', () => {
    const period4 = STORE.reportPeriods.find(p => p.id === 4);
    assert.deepStrictEqual(period4.notifiedDeadlineThresholds, [], 'Kỳ CLOSED không được xử lý dù endTime trùng hôm nay');
  });

  await test('Chạy lại lần 2 ngay sau đó -> KHÔNG gửi lại email cho đúng ngưỡng đã nhắc (idempotent)', async () => {
    const mailCountBefore = sentMails.length;
    await checkReportPeriodDeadlineReminders();
    assert.strictEqual(sentMails.length, mailCountBefore, 'Ngưỡng đã nhắc rồi thì chạy lại không được gửi thêm email nào nữa');
  });

  await test('Phòng ban ĐÃ nộp bù kịp thời sau đó -> lần chạy tiếp theo (ngưỡng MỚI) không còn bị nhắc nữa', async () => {
    // Kế Toán nộp bù (SUBMITTED) cho kỳ 1, rồi giả lập kỳ 1 rơi thêm vào ngưỡng 1 ngày (còn 1 ngày).
    STORE.reportEntries.push({ id: 101, periodId: 1, dept: 'Phòng Kế Toán', creator: 'kt1', status: 'SUBMITTED' });
    const period1 = STORE.reportPeriods.find(p => p.id === 1);
    period1.endTime = todayPlus(1);
    const mailCountBefore = sentMails.length;
    await checkReportPeriodDeadlineReminders();
    const kt1TuanMotMailsAfter = sentMails.filter(m => m.subject.includes('Tuần 1') && m.to.includes('kt1@test.vn'));
    assert.strictEqual(kt1TuanMotMailsAfter.length, 1, 'Kế Toán đã nộp bù kỳ Tuần 1 rồi -> không bị nhắc thêm lần nữa dù kỳ rơi vào ngưỡng mới (1 ngày)');
    assert.ok(period1.notifiedDeadlineThresholds.includes(1), 'Ngưỡng 1 ngày phải được đánh dấu đã xử lý dù không có phòng nào cần nhắc nữa');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
