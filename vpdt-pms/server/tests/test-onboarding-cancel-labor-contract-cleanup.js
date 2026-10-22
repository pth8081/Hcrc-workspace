// server/tests/test-onboarding-cancel-labor-contract-cleanup.js
//
// LOI DA VA (dot re-audit lan 3, muc Cao): templateId=1 ("Gui thu moi nhan viec & hop dong lao dong")
// hoan thanh tu tao 1 Hop Dong Lao Dong DRAFT gan hrProcessId (buildProbationDraftPayload(), lib/
// laborContract.js); templateId=7 kich hoat DRAFT -> ACTIVE. Huy (POST /hrProcesses/:id/cancel) hoac
// xoa (POST /hrProcesses/:id/delete) quy trinh Onboarding SAU 1 trong 2 moc nay truoc day KHONG dong
// hop dong da tu sinh, de lai "mo coi" o DRAFT hoac ACTIVE. Neu employeeCode cua ung vien bi huy sau do
// duoc TAI SU DUNG cho nguoi moi, findActiveContractByEmployeeCode() (dung cho payroll) se nhan NHAM
// hop dong ACTIVE "mo coi" cua NGUOI CU lam hop dong cua nguoi MOI -> tinh luong sai doi tuong.
//
// Khuon giong tests/test-audit-nhansu-onboarding-contract.js (dung Express app THAT mount routes/
// create.js + routes/records.js, thay tang luu tru bang in-memory).
//
// Chay: node server/tests/test-onboarding-cancel-labor-contract-cleanup.js
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

const STORE = { laborContracts: [], hrProcesses: [] };
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
  // LỖI ĐÃ VÁ (re-audit lần 5, mức Cao): route /hrProcesses/:id/delete nay gác THÊM quyền Nhân Sự phù
  // hợp (hrOnboardingProcessManage/hrOffboardingProcessManage/hrOnboardingManage/hrOffboardingManage) CỘNG THÊM admin — admin chung không
  // còn đủ 1 mình (xem assertHrProcessDeletePermission() ở routes/records.js) — thêm hrOnboardingProcessManage/hrOffboardingProcessManage
  // vào fixture này để kịch bản "XOÁ (admin)" ngay dưới vẫn tạo được dữ liệu test như trước.
  { username: 'admin', name: 'Quản Trị Viên', dept: 'Nhân Sự', perms: { admin: true, hrOnboardingProcessManage: true, hrOffboardingProcessManage: true }, active: true },
  { username: 'onb1', name: 'Phụ Trách Onboarding', dept: 'Nhân Sự', perms: { hrOnboardingManage: true }, active: true }
];

let APP_DATA;
function resetAppData() {
  APP_DATA = {
    users: USERS,
    depts: ['Nhân Sự', 'Kinh Doanh'],
    stores: ['Siêu Thị 1'],
    jobTitles: ['Nhân Viên', 'Trưởng Phòng'],
    storeJobTitles: [{ label: 'Nhân Viên Bán Hàng' }],
    // templateId=1/7 khớp ĐÚNG mốc tạo/kích hoạt hợp đồng (xem syncLaborContractOnHrTaskEvent()); 99 là
    // 1 việc BẮT BUỘC khác CHƯA xong, giữ quy trình ở IN_PROGRESS (không tự COMPLETED) để còn test huỷ.
    hrTaskTemplates: [
      { id: 1, processType: 'ONBOARDING', taskName: 'Gửi thư mời nhận việc & hợp đồng lao động', department: 'HR', stage: 'PRE_BOARDING', isRequired: true, isActive: true, displayOrder: 1, dueDaysOffset: 0 },
      { id: 7, processType: 'ONBOARDING', taskName: 'Đón tiếp, ký hợp đồng chính thức', department: 'HR', stage: 'FIRST_DAY', isRequired: true, isActive: true, displayOrder: 2, dueDaysOffset: 0 },
      { id: 99, processType: 'ONBOARDING', taskName: 'Việc khác chưa xong', department: 'HR', stage: 'TRAINING', isRequired: true, isActive: true, displayOrder: 3, dueDaysOffset: 5 }
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
    await test('huỷ Onboarding SAU khi hợp đồng thử việc đã ACTIVE -> hợp đồng tự đóng (TERMINATED), không còn "mồ côi" ACTIVE', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.laborContracts = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      assert.strictEqual(created.status, 200, JSON.stringify(created.json));
      const processId = created.json.item.id;
      const task1 = created.json.item.tasks.find(t => t.templateId === 1);
      const task7 = created.json.item.tasks.find(t => t.templateId === 7);

      const r1 = await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/complete-task`, { taskId: task1.taskId });
      assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
      assert.strictEqual(STORE.laborContracts.length, 1, 'templateId=1 phải tự tạo 1 hợp đồng DRAFT');
      assert.strictEqual(STORE.laborContracts[0].status, 'DRAFT');

      const r7 = await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/complete-task`, { taskId: task7.taskId });
      assert.strictEqual(r7.status, 200, JSON.stringify(r7.json));
      assert.strictEqual(STORE.laborContracts[0].status, 'ACTIVE', 'templateId=7 phải kích hoạt DRAFT -> ACTIVE');
      assert.strictEqual(r7.json.item.status, 'IN_PROGRESS', 'còn task 99 bắt buộc chưa xong, quy trình phải còn IN_PROGRESS');

      const rc = await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/cancel`, { reason: 'Ứng viên rút đơn' });
      assert.strictEqual(rc.status, 200, JSON.stringify(rc.json));
      assert.strictEqual(rc.json.laborContractClosed, true, 'route phải báo cáo đã đóng hợp đồng mồ côi');
      assert.strictEqual(STORE.laborContracts[0].status, 'TERMINATED', 'LỖI ĐÃ VÁ: hợp đồng ACTIVE phải tự đóng khi huỷ Onboarding, không còn "mồ côi"');
      assert.strictEqual(STORE.laborContracts[0].hrProcessId, processId);
    });

    await test('huỷ Onboarding khi hợp đồng còn DRAFT (CHƯA kích hoạt) -> cũng tự đóng (TERMINATED), không để DRAFT mồ côi', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.laborContracts = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      const task1 = created.json.item.tasks.find(t => t.templateId === 1);
      await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/complete-task`, { taskId: task1.taskId });
      assert.strictEqual(STORE.laborContracts[0].status, 'DRAFT');

      const rc = await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/cancel`, { reason: 'Ứng viên rút đơn trước ngày làm' });
      assert.strictEqual(rc.status, 200, JSON.stringify(rc.json));
      assert.strictEqual(STORE.laborContracts[0].status, 'TERMINATED', 'hợp đồng DRAFT mồ côi cũng phải tự đóng, không để lơ lửng');
    });

    await test('huỷ Onboarding TRƯỚC KHI templateId=1 hoàn thành (chưa có hợp đồng nào) -> không lỗi, không tạo gì', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.laborContracts = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      const rc = await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/cancel`, { reason: 'Huỷ sớm' });
      assert.strictEqual(rc.status, 200, JSON.stringify(rc.json));
      assert.strictEqual(rc.json.laborContractClosed, false);
      assert.strictEqual(STORE.laborContracts.length, 0);
    });

    await test('XOÁ (admin) quy trình Onboarding sau khi hợp đồng đã ACTIVE -> cũng tự đóng (cùng cơ chế /delete)', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.laborContracts = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      const task1 = created.json.item.tasks.find(t => t.templateId === 1);
      const task7 = created.json.item.tasks.find(t => t.templateId === 7);
      await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/complete-task`, { taskId: task1.taskId });
      await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/complete-task`, { taskId: task7.taskId });
      assert.strictEqual(STORE.laborContracts[0].status, 'ACTIVE');

      const rd = await call('admin', 'POST', `/api/records/hrProcesses/${processId}/delete`, {});
      assert.strictEqual(rd.status, 200, JSON.stringify(rd.json));
      assert.strictEqual(STORE.laborContracts[0].status, 'TERMINATED', 'xoá hẳn quy trình cũng phải đóng hợp đồng mồ côi, không chỉ cancel mới xử lý');
    });

    await test('hợp đồng đã TERMINATED/SUPERSEDED từ trước (không phải DRAFT/ACTIVE) -> KHÔNG bị đụng lại (idempotent, không ghi đè lịch sử đã đóng)', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.laborContracts = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      STORE.laborContracts.push({ id: 9001, hrProcessId: processId, status: 'SUPERSEDED', history: [{ action: 'SUPERSEDED' }] });
      const rc = await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/cancel`, { reason: 'Huỷ' });
      assert.strictEqual(rc.status, 200, JSON.stringify(rc.json));
      assert.strictEqual(rc.json.laborContractClosed, false, 'SUPERSEDED không phải DRAFT/ACTIVE, không được coi là "đã đóng"');
      assert.strictEqual(STORE.laborContracts[0].status, 'SUPERSEDED', 'giữ nguyên, không ghi đè');
      assert.strictEqual(STORE.laborContracts[0].history.length, 1, 'không thêm dòng lịch sử nào vào hợp đồng đã đóng từ trước');
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
