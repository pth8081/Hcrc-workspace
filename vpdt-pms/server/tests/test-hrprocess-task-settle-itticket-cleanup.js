// server/tests/test-hrprocess-task-settle-itticket-cleanup.js
//
// LOI DA VA (re-audit lan 5, muc Trung Binh, #140 "skip/complete-task/auto-COMPLETED khong don ticket
// IT con"): completeHrTask()/skipHrTask() (lib/recordActions.js, qua POST /hrProcesses/:id/complete-task
// va /skip-task) danh dau 1 task DONE/SKIPPED TRUC TIEP (khong qua chinh ticket Ho Tro IT da tu sinh tu
// task do — createItTicketForHrTask(), sourceType==='HR_PROCESS_TASK') nhung KHONG dung gi toi ticket do
// — ticket con TODO/DOING van "song" vinh vien trong hang cho IT du viec da xong/bi bo qua qua duong
// khac, ke ca khi dieu do khien TOAN BO quy trinh auto-chuyen COMPLETED (computeHrProcessProgress()).
//
// Khuon giong tests/test-hrprocess-cancel-itticket-cleanup.js (dung Express app THAT mount routes/
// create.js + routes/records.js, tang luu tru in-memory) nhung kiem CHIEU "xu ly 1 TASK truc tiep",
// khac han chieu "huy/xoa CA QUY TRINH" da co o file kia.
//
// Chay: node server/tests/test-hrprocess-task-settle-itticket-cleanup.js
'use strict';

const assert = require('assert');
const path = require('path');
const http = require('http');
const express = require('express');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.stack || err.message}`); }
}

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const STORE = { hrProcesses: [], itSupportTickets: [] };
let nextId = 1;
const TRASH = [];

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(STORE)),
  getAllForCollection: async (c) => (STORE[c] || []).slice(),
  getAllForCollectionCached: async (c) => (STORE[c] || []).slice(),
  getTrashItems: async () => TRASH,
  withAppLock: async (key, fn) => fn(),
  createForCollection: async (c, builderFn) => {
    const draft = await builderFn((STORE[c] || []).slice());
    const item = Object.assign({ id: nextId++ }, draft);
    STORE[c] = STORE[c] || []; STORE[c].push(item);
    return item;
  },
  createForCollectionSerialized: async (c, lockKey, builderFn) => {
    const draft = await builderFn((STORE[c] || []).slice());
    const item = Object.assign({ id: nextId++ }, draft);
    STORE[c] = STORE[c] || []; STORE[c].push(item);
    return item;
  },
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = STORE[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    list[idx] = await mutatorFn(list[idx]);
    return list[idx];
  },
  deleteRecordForCollection: async (c, id, checkFn) => {
    const list = STORE[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    if (checkFn) await checkFn(list[idx]);
    list.splice(idx, 1);
  }
});

const SYSTEM_LOGS = [];
stubModule('lib/systemLogStore', {
  insertSystemLog: async (entry) => { SYSTEM_LOGS.push(entry); return entry; },
  querySystemLogs: async () => ({ items: [], total: 0 })
});

const USERS = [
  { username: 'admin', name: 'Quản Trị Viên', dept: 'Nhân Sự', perms: { admin: true, hrOnboardingProcessManage: true, hrOffboardingProcessManage: true }, active: true },
  { username: 'onb1', name: 'Phụ Trách Onboarding', dept: 'Nhân Sự', perms: { hrOnboardingManage: true }, active: true },
  { username: 'off1', name: 'Phụ Trách Offboarding', dept: 'Nhân Sự', perms: { hrOffboardingManage: true }, active: true },
  { username: 'it1', name: 'Nhân Viên IT', dept: 'IT', perms: { itManage: true }, active: true },
  { username: 'nv.a', name: 'Nguyễn Văn A', dept: 'Kinh Doanh', perms: {}, active: true }
];

let APP_DATA;
function resetAppData() {
  APP_DATA = {
    users: USERS,
    depts: ['Nhân Sự', 'Kinh Doanh'],
    stores: ['Siêu Thị 1'],
    jobTitles: ['Nhân Viên', 'Trưởng Phòng'],
    storeJobTitles: [{ label: 'Nhân Viên Bán Hàng' }],
    hrTaskTemplates: [
      { id: 1, processType: 'ONBOARDING', taskName: 'Cấp tài khoản/máy tính', department: 'IT', stage: 'PRE_BOARDING', isRequired: true, isActive: true, displayOrder: 1, dueDaysOffset: 0 },
      { id: 2, processType: 'ONBOARDING', taskName: 'Việc khác chưa xong', department: 'HR', stage: 'FIRST_DAY', isRequired: true, isActive: true, displayOrder: 2, dueDaysOffset: 0 }
    ],
    formTemplates: [],
    employeeProfiles: []
  };
}
resetAppData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAllAppData: async () => APP_DATA,
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

let CURRENT_USER = 'admin';
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USER);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const createRoutes = require('../routes/create');
const recordRoutes = require('../routes/records');

function onboardingPayload(overrides) {
  return Object.assign({
    processType: 'ONBOARDING',
    fullName: 'Ứng Viên Mới',
    employeePosType: 'HO',
    employeeDept: 'Kinh Doanh',
    employeeJobTitle: 'Nhân Viên',
    email: 'ungvien@congty.vn',
    phone: '0900000000',
    startDate: '2026-11-02'
  }, overrides || {});
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  app.use('/api/records', recordRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, method, urlPath, body) {
    CURRENT_USER = username;
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null; try { json = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, json };
  }

  try {
    await test('LỖI ĐÃ VÁ: complete-task TRỰC TIẾP cho task đã có ticket IT còn TODO -> ticket tự huỷ (CANCELLED)', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.itSupportTickets = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      const itTask = created.json.item.tasks.find(t => t.templateId === 1);
      const rt = await call('it1', 'POST', `/api/records/hrProcesses/${processId}/create-it-ticket`, { taskId: itTask.taskId });
      assert.strictEqual(rt.status, 200, JSON.stringify(rt.json));
      const ticketId = rt.json.ticket.id;
      assert.strictEqual(STORE.itSupportTickets.find(t => t.id === ticketId).status, 'TODO');

      const rc = await call('it1', 'POST', `/api/records/hrProcesses/${processId}/complete-task`, { taskId: itTask.taskId });
      assert.strictEqual(rc.status, 200, JSON.stringify(rc.json));
      const ticket = STORE.itSupportTickets.find(t => t.id === ticketId);
      assert.strictEqual(ticket.status, 'CANCELLED', 'LỖI ĐÃ VÁ: ticket IT phải tự huỷ khi task sinh ra nó được đánh dấu hoàn thành TRỰC TIẾP, không còn kẹt TODO vĩnh viễn');
      assert.ok(ticket.comments.some(c => c.content.includes('đánh dấu hoàn thành trực tiếp')), 'phải có comment hệ thống giải thích lý do tự huỷ');
    });

    await test('LỖI ĐÃ VÁ: skip-task TRỰC TIẾP cho task đã có ticket IT còn DOING -> ticket tự huỷ, comment nói "bỏ qua"', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.itSupportTickets = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      const itTask = created.json.item.tasks.find(t => t.templateId === 1);
      const rt = await call('it1', 'POST', `/api/records/hrProcesses/${processId}/create-it-ticket`, { taskId: itTask.taskId });
      const ticketId = rt.json.ticket.id;
      const rclaim = await call('it1', 'POST', `/api/records/itSupportTickets/${ticketId}/claim`, {});
      assert.strictEqual(rclaim.status, 200, JSON.stringify(rclaim.json));
      assert.strictEqual(STORE.itSupportTickets.find(t => t.id === ticketId).status, 'DOING');

      // admin có hrOnboardingProcessManage/hrOffboardingProcessManage: true -> thoả canManageHrProcess() (bắt buộc để bỏ qua task bắt buộc)
      // VÀ canActOnHrTask() (bắt buộc để hành động trên task nhãn IT).
      const rs = await call('admin', 'POST', `/api/records/hrProcesses/${processId}/skip-task`, { taskId: itTask.taskId, reason: 'Nhân viên tự chuẩn bị máy cá nhân, không cần IT cấp' });
      assert.strictEqual(rs.status, 200, JSON.stringify(rs.json));
      const ticket = STORE.itSupportTickets.find(t => t.id === ticketId);
      assert.strictEqual(ticket.status, 'CANCELLED', 'LỖI ĐÃ VÁ: ticket IT phải tự huỷ khi task bị bỏ qua TRỰC TIẾP');
      assert.ok(ticket.comments.some(c => c.content.includes('đánh dấu bỏ qua trực tiếp')), 'nội dung comment phải đúng ngữ cảnh "bỏ qua", khác với complete-task ("hoàn thành")');
    });

    await test('auto-COMPLETED: hoàn thành task CUỐI khiến CẢ quy trình tự chuyển COMPLETED -> ticket IT của chính task đó vẫn được dọn', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.itSupportTickets = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      const hrTask = created.json.item.tasks.find(t => t.templateId === 2);
      const itTask = created.json.item.tasks.find(t => t.templateId === 1);
      const rt = await call('it1', 'POST', `/api/records/hrProcesses/${processId}/create-it-ticket`, { taskId: itTask.taskId });
      const ticketId = rt.json.ticket.id;

      // Hoàn thành task HR trước — quy trình vẫn IN_PROGRESS (còn task IT chưa xong).
      const r1 = await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/complete-task`, { taskId: hrTask.taskId });
      assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
      assert.strictEqual(r1.json.item.status, 'IN_PROGRESS');
      assert.strictEqual(STORE.itSupportTickets.find(t => t.id === ticketId).status, 'TODO', 'ticket của task CHƯA xử lý xong phải giữ nguyên TODO, không bị đụng tới khi task khác hoàn thành');

      // Hoàn thành task IT (có ticket) TRỰC TIẾP -> toàn bộ quy trình auto COMPLETED + ticket phải tự huỷ.
      const r2 = await call('it1', 'POST', `/api/records/hrProcesses/${processId}/complete-task`, { taskId: itTask.taskId });
      assert.strictEqual(r2.status, 200, JSON.stringify(r2.json));
      assert.strictEqual(r2.json.item.status, 'COMPLETED', 'quy trình phải auto-chuyển COMPLETED khi mọi task bắt buộc đã DONE');
      assert.strictEqual(STORE.itSupportTickets.find(t => t.id === ticketId).status, 'CANCELLED', 'LỖI ĐÃ VÁ: ticket phải được dọn dù task hoàn thành khiến CẢ quy trình auto-COMPLETED trong cùng 1 lượt gọi');
    });

    await test('ticket ĐÃ DONE từ trước (IT đã xử lý xong) khi task được complete-task trực tiếp -> KHÔNG bị đụng lại (idempotent)', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.itSupportTickets = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      const itTask = created.json.item.tasks.find(t => t.templateId === 1);
      const rt = await call('it1', 'POST', `/api/records/hrProcesses/${processId}/create-it-ticket`, { taskId: itTask.taskId });
      const ticketId = rt.json.ticket.id;
      await call('it1', 'POST', `/api/records/itSupportTickets/${ticketId}/claim`, {});
      await call('it1', 'POST', `/api/records/itSupportTickets/${ticketId}/update-status`, { status: 'DONE', resolutionNote: 'Đã cấp máy' });
      const commentsBefore = STORE.itSupportTickets.find(t => t.id === ticketId).comments.length;

      // applyItTicketCompletionToHrProcessTask() (đường ticket DONE) đã tự đánh DONE task tương ứng —
      // complete-task gọi lại SẼ bị chặn 409 "đã hoàn thành rồi" (hành vi pre-existing, không phải phần
      // đang vá) — vẫn xác nhận idempotent: ticket giữ nguyên DONE, không bị ghi đè thành CANCELLED.
      const rc = await call('it1', 'POST', `/api/records/hrProcesses/${processId}/complete-task`, { taskId: itTask.taskId });
      assert.strictEqual(rc.status, 409, JSON.stringify(rc.json));
      const ticket = STORE.itSupportTickets.find(t => t.id === ticketId);
      assert.strictEqual(ticket.status, 'DONE', 'giữ nguyên DONE, không ghi đè kết quả xử lý thật của IT');
      assert.strictEqual(ticket.comments.length, commentsBefore, 'không thêm comment hệ thống vào ticket đã DONE');
    });

    await test('complete-task cho task KHÔNG có ticket IT liên kết -> không lỗi, không ảnh hưởng', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.itSupportTickets = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      const hrTask = created.json.item.tasks.find(t => t.templateId === 2);
      const rc = await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/complete-task`, { taskId: hrTask.taskId });
      assert.strictEqual(rc.status, 200, JSON.stringify(rc.json));
      assert.strictEqual(STORE.itSupportTickets.length, 0);
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
