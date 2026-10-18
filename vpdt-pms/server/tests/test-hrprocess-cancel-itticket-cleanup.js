// server/tests/test-hrprocess-cancel-itticket-cleanup.js
//
// LOI DA VA (dot re-audit lan 3, muc Trung Binh): ticket Ho Tro IT sinh ra tu 1 task nhan IT trong quy
// trinh Onboarding/Offboarding (sourceType==='HR_PROCESS_TASK', createItTicketForHrTask() — lib/
// recordActions.js) truoc day KHONG he duoc dong lai khi huy (POST /hrProcesses/:id/cancel) hoac xoa
// han (POST /hrProcesses/:id/delete) quy trinh nguon — ticket con TODO/DOING van "song" vinh vien
// trong hang cho IT du ho so nhan su lien quan da khong con ap dung.
//
// Khuon giong tests/test-onboarding-cancel-labor-contract-cleanup.js / test-audit-nhansu-onboarding-
// contract.js (dung Express app THAT mount routes/create.js + routes/records.js, tang luu tru in-memory).
//
// Chay: node server/tests/test-hrprocess-cancel-itticket-cleanup.js
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
  { username: 'admin', name: 'Quản Trị Viên', dept: 'Nhân Sự', perms: { admin: true }, active: true },
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
      { id: 2, processType: 'ONBOARDING', taskName: 'Việc khác chưa xong', department: 'HR', stage: 'FIRST_DAY', isRequired: true, isActive: true, displayOrder: 2, dueDaysOffset: 0 },
      { id: 50, processType: 'OFFBOARDING', taskName: 'Vô hiệu hoá tài khoản', department: 'IT', stage: 'ASSET_REVOKE', isRequired: true, isActive: true, displayOrder: 1, dueDaysOffset: 0 },
      { id: 51, processType: 'OFFBOARDING', taskName: 'Việc khác chưa xong', department: 'HR', stage: 'SETTLEMENT', isRequired: true, isActive: true, displayOrder: 2, dueDaysOffset: 0 }
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

function offboardingPayload(overrides) {
  return Object.assign({
    processType: 'OFFBOARDING',
    employeeUsername: 'nv.a',
    lastWorkingDate: '2026-11-30'
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
    await test('ONBOARDING: huỷ quy trình sau khi tạo ticket IT (còn TODO) -> ticket tự huỷ (CANCELLED)', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.itSupportTickets = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      const itTask = created.json.item.tasks.find(t => t.templateId === 1);
      const rt = await call('it1', 'POST', `/api/records/hrProcesses/${processId}/create-it-ticket`, { taskId: itTask.taskId });
      assert.strictEqual(rt.status, 200, JSON.stringify(rt.json));
      const ticketId = rt.json.ticket.id;
      assert.strictEqual(STORE.itSupportTickets.find(t => t.id === ticketId).status, 'TODO');

      const rc = await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/cancel`, { reason: 'Ứng viên rút đơn' });
      assert.strictEqual(rc.status, 200, JSON.stringify(rc.json));
      assert.strictEqual(rc.json.itTicketsClosed, true, 'route phải báo cáo đã huỷ ticket mồ côi');
      assert.strictEqual(STORE.itSupportTickets.find(t => t.id === ticketId).status, 'CANCELLED', 'LỖI ĐÃ VÁ: ticket IT phải tự huỷ khi huỷ quy trình Onboarding, không còn "mồ côi" TODO');
    });

    await test('ONBOARDING: ticket đã được IT nhận xử lý (DOING) khi huỷ quy trình -> cũng tự huỷ', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.itSupportTickets = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      const itTask = created.json.item.tasks.find(t => t.templateId === 1);
      const rt = await call('it1', 'POST', `/api/records/hrProcesses/${processId}/create-it-ticket`, { taskId: itTask.taskId });
      const ticketId = rt.json.ticket.id;
      const rclaim = await call('it1', 'POST', `/api/records/itSupportTickets/${ticketId}/claim`, {});
      assert.strictEqual(rclaim.status, 200, JSON.stringify(rclaim.json));
      assert.strictEqual(STORE.itSupportTickets.find(t => t.id === ticketId).status, 'DOING');

      await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/cancel`, { reason: 'Huỷ' });
      assert.strictEqual(STORE.itSupportTickets.find(t => t.id === ticketId).status, 'CANCELLED');
    });

    await test('OFFBOARDING: huỷ quy trình sau khi tạo ticket IT (còn TODO) -> ticket tự huỷ (cùng cơ chế, KHÔNG riêng Onboarding)', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.itSupportTickets = [];
      const created = await call('off1', 'POST', '/api/create/hrProcesses', offboardingPayload());
      assert.strictEqual(created.status, 200, JSON.stringify(created.json));
      const processId = created.json.item.id;
      const itTask = created.json.item.tasks.find(t => t.templateId === 50);
      const rt = await call('it1', 'POST', `/api/records/hrProcesses/${processId}/create-it-ticket`, { taskId: itTask.taskId });
      assert.strictEqual(rt.status, 200, JSON.stringify(rt.json));
      const ticketId = rt.json.ticket.id;

      const rc = await call('off1', 'POST', `/api/records/hrProcesses/${processId}/cancel`, { reason: 'Nhân viên rút đơn nghỉ việc' });
      assert.strictEqual(rc.status, 200, JSON.stringify(rc.json));
      assert.strictEqual(rc.json.itTicketsClosed, true);
      assert.strictEqual(STORE.itSupportTickets.find(t => t.id === ticketId).status, 'CANCELLED', 'LỖI ĐÃ VÁ: áp dụng cho CẢ Offboarding, không chỉ riêng Onboarding');
    });

    await test('XOÁ (admin) quy trình -> cũng huỷ ticket mồ côi (cùng cơ chế /delete)', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.itSupportTickets = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      const itTask = created.json.item.tasks.find(t => t.templateId === 1);
      const rt = await call('it1', 'POST', `/api/records/hrProcesses/${processId}/create-it-ticket`, { taskId: itTask.taskId });
      const ticketId = rt.json.ticket.id;

      const rd = await call('admin', 'POST', `/api/records/hrProcesses/${processId}/delete`, {});
      assert.strictEqual(rd.status, 200, JSON.stringify(rd.json));
      assert.strictEqual(STORE.itSupportTickets.find(t => t.id === ticketId).status, 'CANCELLED');
    });

    await test('ticket ĐÃ DONE từ trước (IT đã xử lý xong) khi huỷ quy trình -> KHÔNG bị đụng lại (idempotent, không ghi đè kết quả xử lý thật)', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.itSupportTickets = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      const itTask = created.json.item.tasks.find(t => t.templateId === 1);
      const rt = await call('it1', 'POST', `/api/records/hrProcesses/${processId}/create-it-ticket`, { taskId: itTask.taskId });
      const ticketId = rt.json.ticket.id;
      await call('it1', 'POST', `/api/records/itSupportTickets/${ticketId}/claim`, {});
      const rdone = await call('it1', 'POST', `/api/records/itSupportTickets/${ticketId}/update-status`, { status: 'DONE', resolutionNote: 'Đã cấp máy' });
      assert.strictEqual(rdone.status, 200, JSON.stringify(rdone.json));
      const commentsBefore = STORE.itSupportTickets.find(t => t.id === ticketId).comments.length;

      const rc = await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/cancel`, { reason: 'Huỷ sau khi IT đã xong việc' });
      assert.strictEqual(rc.status, 200, JSON.stringify(rc.json));
      assert.strictEqual(rc.json.itTicketsClosed, false, 'ticket đã DONE không được coi là "đã huỷ" (không đụng tới)');
      const ticket = STORE.itSupportTickets.find(t => t.id === ticketId);
      assert.strictEqual(ticket.status, 'DONE', 'giữ nguyên DONE, không ghi đè kết quả xử lý thật của IT');
      assert.strictEqual(ticket.comments.length, commentsBefore, 'không thêm comment hệ thống vào ticket đã DONE');
    });

    await test('huỷ quy trình KHÔNG có ticket IT nào -> không lỗi, itTicketsClosed=false', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.itSupportTickets = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      const rc = await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/cancel`, { reason: 'Huỷ' });
      assert.strictEqual(rc.status, 200, JSON.stringify(rc.json));
      assert.strictEqual(rc.json.itTicketsClosed, false);
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
