// server/tests/test-hr-task-overdue-reminder.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng phản ánh "sao Onboarding lại gửi email lên tận Tổng Giám Đốc"):
// jobs/hrTaskOverdueReminder.js::resolveTaskRecipients() trước đây luôn OR thêm `u.perms?.admin` vào
// điều kiện nhận email cho việc chưa gán (department HR/ADMIN/IT/FINANCE) — bất kỳ tài khoản nào bật cờ
// "Admin - Toàn quyền quản trị" (vì lý do hoàn toàn khác, VD tài khoản Tổng Giám Đốc) đều tự động nhận
// email cho MỌI việc Onboarding/Offboarding chưa gán bị quá hạn trên toàn công ty, dù không có quyền
// chuyên môn phù hợp (hrOnboardingManage/hrOffboardingManage/itManage/paymentManage). Test này xác nhận:
// sau khi vá, người CHỈ có perms.admin (không có quyền chuyên môn đúng) KHÔNG còn nhận email, trong khi
// người có đúng quyền chuyên môn vẫn nhận như cũ — cho cả 2 processType (ONBOARDING/OFFBOARDING) và cả 3
// nhãn department (HR, IT, FINANCE). Đồng thời xác nhận KHÔNG đổi hành vi ở 2 nhánh không liên quan tới
// lỗi này: task đã có assignedToUsername riêng, và nhãn MANAGER (đi theo directManagerUsername cố định,
// chưa từng có đường lùi admin).
//
// Giả lập db/lib/recordStore/mailer/systemLogStore/emailCrypto/emailTemplate — cùng khuôn
// tests/test-it-approval-deadline-reminder.js.
//
// Chạy: node server/tests/test-hr-task-overdue-reminder.js
'use strict';
const path = require('path');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertSameSet(actualEmails, expectedEmails, label) {
  const a = [...actualEmails].sort();
  const e = [...expectedEmails].sort();
  assert(JSON.stringify(a) === JSON.stringify(e), `${label}: expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`);
}

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

function daysAgoDateStr(days) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log('== jobs/hrTaskOverdueReminder.js (db/recordStore/mailer giả) — LỖI "email tới Admin không đúng chuyên môn" ==');

  const STORE = { hrProcesses: [] };
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
  let sentMails = [];
  stubModule('lib/mailer', {
    sendMail: async ({ to, subject }) => { sentMails.push({ to, subject }); return { sent: to, failed: [], simulated: false }; },
    resolveEncryption: () => 'STARTTLS',
    resolveGraphOption: () => null,
    resolveEwsOption: () => null,
    buildReminderEmailLink: () => '',
    buildReminderEmailUrl: () => ''
  });
  stubModule('lib/emailCrypto', { decryptSecret: (s) => s });
  stubModule('lib/emailTemplate', { buildNotificationEmailHtml: () => '<html></html>' });
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

  const { checkHrTaskOverdueReminders } = require('../jobs/hrTaskOverdueReminder');

  // 1 admin-only (LỖI CŨ: nhận được), 1 đúng quyền chuyên môn từng nhãn, 1 người không liên quan.
  APP_DATA.users = [
    { username: 'ceo_admin', name: 'Tổng Giám Đốc', email: 'ceo@test.vn', active: true, perms: { admin: true } },
    { username: 'hr_onb', name: 'NV Nhân Sự (Onboarding)', email: 'hr_onb@test.vn', active: true, perms: { hrOnboardingManage: true } },
    { username: 'hr_offb', name: 'NV Nhân Sự (Offboarding)', email: 'hr_offb@test.vn', active: true, perms: { hrOffboardingManage: true } },
    { username: 'it_mgr', name: 'NV IT', email: 'it_mgr@test.vn', active: true, perms: { itManage: true } },
    { username: 'finance_mgr', name: 'NV Tài Chính', email: 'finance_mgr@test.vn', active: true, perms: { paymentManage: true } },
    { username: 'direct_mgr', name: 'Trưởng Phòng Trực Tiếp', email: 'direct_mgr@test.vn', active: true, perms: {} },
    { username: 'assignee1', name: 'Người Được Gán Riêng', email: 'assignee1@test.vn', active: true, perms: {} },
    { username: 'bystander', name: 'Người Không Liên Quan', email: 'bystander@test.vn', active: true, perms: {} }
  ];

  function makeProcess(id, processType, tasks, extra) {
    return { id, processType, status: 'IN_PROGRESS', fullName: `NV Demo ${id}`, employeeCode: `BL${id}`, employeeUsername: `nv${id}`, tasks, ...extra };
  }

  STORE.hrProcesses = [
    makeProcess(1, 'ONBOARDING', [
      { taskId: 'o1', taskName: 'Tạo email công ty', department: 'HR', status: 'PENDING', dueDate: daysAgoDateStr(2), assignedToUsername: null }
    ]),
    makeProcess(2, 'OFFBOARDING', [
      { taskId: 'o2', taskName: 'Thu hồi tài sản', department: 'HR', status: 'PENDING', dueDate: daysAgoDateStr(2), assignedToUsername: null }
    ]),
    makeProcess(3, 'ONBOARDING', [
      { taskId: 'o3', taskName: 'Cấp tài khoản IT', department: 'IT', status: 'PENDING', dueDate: daysAgoDateStr(2), assignedToUsername: null }
    ]),
    makeProcess(4, 'OFFBOARDING', [
      { taskId: 'o4', taskName: 'Quyết toán lương', department: 'FINANCE', status: 'PENDING', dueDate: daysAgoDateStr(2), assignedToUsername: null }
    ]),
    makeProcess(5, 'ONBOARDING', [
      { taskId: 'o5', taskName: 'Việc đã gán riêng', department: 'HR', status: 'PENDING', dueDate: daysAgoDateStr(2), assignedToUsername: 'assignee1' }
    ]),
    makeProcess(6, 'ONBOARDING', [
      { taskId: 'o6', taskName: 'Bàn giao với quản lý trực tiếp', department: 'MANAGER', status: 'PENDING', dueDate: daysAgoDateStr(2), assignedToUsername: null }
    ], { directManagerUsername: 'direct_mgr' }),
    makeProcess(7, 'ONBOARDING', [
      { taskId: 'o7', taskName: 'Bàn giao quản lý (chưa chọn ai)', department: 'MANAGER', status: 'PENDING', dueDate: daysAgoDateStr(2), assignedToUsername: null }
    ], { directManagerUsername: null }),
    // Chưa quá hạn -> hoàn toàn bỏ qua.
    makeProcess(8, 'ONBOARDING', [
      { taskId: 'o8', taskName: 'Việc chưa tới hạn', department: 'HR', status: 'PENDING', dueDate: daysAgoDateStr(-5), assignedToUsername: null }
    ])
  ];

  await checkHrTaskOverdueReminders();

  const mailsFor = (subjectIncludes) => sentMails.filter(m => m.subject.includes(subjectIncludes));

  await test('LỖI ĐÃ VÁ: ONBOARDING + department HR chưa gán -> CHỈ hrOnboardingManage nhận, ceo_admin (chỉ perms.admin) KHÔNG nhận', async () => {
    const m = mailsFor('Tạo email công ty');
    assert(m.length === 1, `phải gửi đúng 1 email (gộp người nhận), thực tế ${m.length}`);
    assertSameSet(m[0].to, ['hr_onb@test.vn'], 'recipients HR/ONBOARDING');
  });

  await test('LỖI ĐÃ VÁ: OFFBOARDING + department HR chưa gán -> CHỈ hrOffboardingManage nhận, ceo_admin KHÔNG nhận', async () => {
    const m = mailsFor('Thu hồi tài sản');
    assert(m.length === 1, `phải gửi đúng 1 email, thực tế ${m.length}`);
    assertSameSet(m[0].to, ['hr_offb@test.vn'], 'recipients HR/OFFBOARDING');
  });

  await test('LỖI ĐÃ VÁ: department IT chưa gán -> CHỈ itManage nhận, ceo_admin KHÔNG nhận', async () => {
    const m = mailsFor('Cấp tài khoản IT');
    assert(m.length === 1, `phải gửi đúng 1 email, thực tế ${m.length}`);
    assertSameSet(m[0].to, ['it_mgr@test.vn'], 'recipients IT');
  });

  await test('LỖI ĐÃ VÁ: department FINANCE chưa gán -> CHỈ paymentManage nhận, ceo_admin KHÔNG nhận', async () => {
    const m = mailsFor('Quyết toán lương');
    assert(m.length === 1, `phải gửi đúng 1 email, thực tế ${m.length}`);
    assertSameSet(m[0].to, ['finance_mgr@test.vn'], 'recipients FINANCE');
  });

  await test('Không đổi hành vi: ceo_admin KHÔNG xuất hiện trong BẤT KỲ email nào ở toàn bộ lượt chạy', async () => {
    const allRecipients = sentMails.flatMap(m => m.to);
    assert(!allRecipients.includes('ceo@test.vn'), `ceo_admin không được xuất hiện, nhưng thấy trong: ${JSON.stringify(allRecipients)}`);
  });

  await test('Không đổi hành vi: task đã có assignedToUsername riêng -> CHỈ đúng người đó nhận (không liên quan tới fix)', async () => {
    const m = mailsFor('Việc đã gán riêng');
    assert(m.length === 1, `phải gửi đúng 1 email, thực tế ${m.length}`);
    assertSameSet(m[0].to, ['assignee1@test.vn'], 'recipients assignedToUsername');
  });

  await test('Không đổi hành vi: department MANAGER có directManagerUsername -> CHỈ đúng quản lý đó nhận', async () => {
    const m = mailsFor('Bàn giao với quản lý trực tiếp');
    assert(m.length === 1, `phải gửi đúng 1 email, thực tế ${m.length}`);
    assertSameSet(m[0].to, ['direct_mgr@test.vn'], 'recipients MANAGER');
  });

  await test('Không đổi hành vi: department MANAGER CHƯA chọn directManagerUsername -> KHÔNG gửi email cho ai (kể cả admin)', async () => {
    const m = mailsFor('Bàn giao quản lý (chưa chọn ai)');
    assert(m.length === 0, `không được gửi email nào, thực tế ${m.length}`);
  });

  await test('Không đổi hành vi: task chưa tới hạn (dueDate tương lai) -> hoàn toàn bỏ qua, không gửi email', async () => {
    const m = mailsFor('Việc chưa tới hạn');
    assert(m.length === 0, `không được gửi email nào, thực tế ${m.length}`);
  });

  await test('Task quá hạn đã chuyển trạng thái OVERDUE sau khi job chạy xong', async () => {
    const p1 = STORE.hrProcesses.find(p => p.id === 1);
    assert(p1.tasks[0].status === 'OVERDUE', `task phải chuyển OVERDUE, thực tế ${p1.tasks[0].status}`);
    const p8 = STORE.hrProcesses.find(p => p.id === 8);
    assert(p8.tasks[0].status === 'PENDING', 'task chưa tới hạn phải giữ nguyên PENDING');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
