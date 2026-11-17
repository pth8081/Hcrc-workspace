// server/tests/test-terminate-probation.js
//
// "✏️ Chấm Dứt Thử Việc" (MỚI 11/2026, theo yêu cầu TRỰC TIẾP người dùng, xác nhận qua AskUserQuestion:
// 1 nút GỘP đặt ở CẢ 2 nơi — màn Hợp Đồng Lao Động VÀ màn Quy Trình Onboarding). Test cả 2 điểm vào:
//   POST /api/records/laborContracts/:id/terminate-probation (màn Hợp Đồng Lao Động, biết contractId)
//   POST /api/records/hrProcesses/:id/terminate-probation (màn Onboarding, chỉ biết hrProcessId, route
//     tự tra lại contractId qua findLatestContractForProcess() rồi gọi lại CÙNG handler)
// Cả 2 phải cho ra ĐÚNG 3 hiệu ứng: (1) đóng hợp đồng Thử Việc, (2) huỷ Onboarding liên kết nếu còn
// IN_PROGRESS, (3) chuyển employeeProfiles sang INACTIVE ngay (không cần qua Offboarding).
//
// Khuôn giống tests/test-onboarding-cancel-labor-contract-cleanup.js (Express app THẬT mount routes/
// create.js + routes/records.js, thay tầng lưu trữ bằng in-memory).
//
// Chạy: node server/tests/test-terminate-probation.js
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
  { username: 'onb1', name: 'Phụ Trách Onboarding', dept: 'Nhân Sự', perms: { hrOnboardingManage: true, hrOffboardingManage: true }, active: true },
  { username: 'hrc1', name: 'Phụ Trách Hợp Đồng', dept: 'Nhân Sự', perms: { hrContractManage: true }, active: true },
  { username: 'emp1', name: 'Nhân Viên Thường', dept: 'Kinh Doanh', perms: {}, active: true }
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
      { id: 1, processType: 'ONBOARDING', taskName: 'Gửi thư mời nhận việc & hợp đồng lao động', department: 'HR', stage: 'PRE_BOARDING', isRequired: true, isActive: true, displayOrder: 1, dueDaysOffset: 0 },
      { id: 7, processType: 'ONBOARDING', taskName: 'Đón tiếp, ký hợp đồng chính thức', department: 'HR', stage: 'FIRST_DAY', isRequired: true, isActive: true, displayOrder: 2, dueDaysOffset: 0 },
      { id: 99, processType: 'ONBOARDING', taskName: 'Việc khác chưa xong', department: 'HR', stage: 'TRAINING', isRequired: true, isActive: true, displayOrder: 3, dueDaysOffset: 5 }
    ],
    formTemplates: [],
    employeeProfiles: [],
    orgChartVersions: [{
      id: 'v1', status: 'APPLIED',
      nodes: [
        { nodeId: 1, parentNodeId: null, nodeType: 'DEPARTMENT', nodeName: 'Kinh Doanh', departmentRef: 'Kinh Doanh' },
        { nodeId: 2, parentNodeId: 1, nodeType: 'POSITION', jobTitle: 'Nhân Viên', requiresDept: true, positionKey: 'pos-kd-nv' }
      ]
    }]
  };
}
resetAppData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAllAppData: async () => APP_DATA,
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

let CURRENT_USER = 'onb1';
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
    processType: 'ONBOARDING', fullName: 'Ứng Viên Thử Việc', employeePosType: 'HO',
    employeeDept: 'Kinh Doanh', employeeJobTitle: 'Nhân Viên',
    email: 'ungvien@congty.vn', phone: '0900000000', startDate: '2026-11-02'
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
      method, headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null; try { json = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, json };
  }

  // setupActiveProbation() — tạo Onboarding -> hoàn thành task1 (tạo hợp đồng DRAFT) -> hoàn thành task7
  // (kích hoạt ACTIVE) -> tự chuyển hồ sơ employeeProfiles sang ACTIVE (mô phỏng đã qua bước HR "Xác
  // Nhận" ở hàng đợi Onboarding — ngoài phạm vi test này, seed trực tiếp cho gọn) — trả về {processId,
  // contractId, employeeCode}.
  async function setupActiveProbation() {
    resetAppData(); STORE.hrProcesses = []; STORE.laborContracts = [];
    const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
    assert.strictEqual(created.status, 200, JSON.stringify(created.json));
    const processId = created.json.item.id;
    const employeeCode = created.json.item.employeeCode;
    const task1 = created.json.item.tasks.find(t => t.templateId === 1);
    const task7 = created.json.item.tasks.find(t => t.templateId === 7);
    await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/complete-task`, { taskId: task1.taskId });
    await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/complete-task`, { taskId: task7.taskId });
    assert.strictEqual(STORE.laborContracts[0].status, 'ACTIVE', 'tiền đề: hợp đồng Thử Việc phải đang ACTIVE');
    const profile = APP_DATA.employeeProfiles.find(p => p.employeeCode === employeeCode);
    assert.ok(profile, 'tiền đề: phải có hồ sơ DRAFT tự đặt chỗ');
    profile.status = 'ACTIVE';
    return { processId, contractId: STORE.laborContracts[0].id, employeeCode };
  }

  try {
    await test('[Entry 1: /laborContracts/:id/terminate-probation] Đủ quyền + đang ACTIVE -> đóng hợp đồng + huỷ Onboarding + chuyển hồ sơ INACTIVE', async () => {
      const { processId, contractId, employeeCode } = await setupActiveProbation();
      const r = await call('hrc1', 'POST', `/api/records/laborContracts/${contractId}/terminate-probation`, { reason: 'Không đạt yêu cầu thử việc' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.status, 'TERMINATED', 'hợp đồng phải TERMINATED');
      assert.strictEqual(r.json.item.terminationReason, 'Không đạt yêu cầu thử việc');
      assert.ok(r.json.hrProcess, 'phải trả về hrProcess vừa huỷ');
      assert.strictEqual(r.json.hrProcess.status, 'CANCELLED');
      assert.strictEqual(r.json.profile.status, 'INACTIVE');
      assert.strictEqual(STORE.hrProcesses.find(p => p.id === processId).status, 'CANCELLED', 'STORE thật phải phản ánh đúng');
      assert.strictEqual(APP_DATA.employeeProfiles.find(p => p.employeeCode === employeeCode).status, 'INACTIVE');
    });

    await test('[Entry 2: /hrProcesses/:id/terminate-probation] Alias từ màn Onboarding — tự tra đúng hợp đồng, cùng 3 hiệu ứng', async () => {
      const { processId, employeeCode } = await setupActiveProbation();
      const r = await call('hrc1', 'POST', `/api/records/hrProcesses/${processId}/terminate-probation`, { reason: 'Nghỉ ngang giữa thử việc' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.status, 'TERMINATED', 'item ở route này là HỢP ĐỒNG (khác collection với hrProcesses)');
      assert.strictEqual(r.json.hrProcess.id, processId);
      assert.strictEqual(r.json.hrProcess.status, 'CANCELLED');
      assert.strictEqual(r.json.profile.status, 'INACTIVE');
      assert.strictEqual(APP_DATA.employeeProfiles.find(p => p.employeeCode === employeeCode).status, 'INACTIVE');
    });

    await test('Onboarding ĐÃ Hoàn Tất/Đã Huỷ từ trước -> vẫn đóng hợp đồng + chuyển hồ sơ, KHÔNG đụng lại quy trình (idempotent, không hồi tố)', async () => {
      const { processId, contractId } = await setupActiveProbation();
      // Giả lập quy trình đã bị huỷ TRƯỚC đó bởi 1 hành động khác (không qua route này).
      const idx = STORE.hrProcesses.findIndex(p => p.id === processId);
      STORE.hrProcesses[idx] = Object.assign({}, STORE.hrProcesses[idx], { status: 'CANCELLED', cancelReason: 'Lý do khác trước đó' });
      const r = await call('hrc1', 'POST', `/api/records/laborContracts/${contractId}/terminate-probation`, { reason: 'Chấm dứt thử việc' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.status, 'TERMINATED');
      assert.ok(!r.json.hrProcess, 'KHÔNG được trả hrProcess (quy trình đã Đã Huỷ từ trước, không cascade lại)');
      assert.strictEqual(STORE.hrProcesses[idx].cancelReason, 'Lý do khác trước đó', 'KHÔNG được ghi đè lý do huỷ cũ');
    });

    await test('Hợp đồng KHÔNG phải loại Thử Việc (PROBATION) -> 400', async () => {
      const { contractId } = await setupActiveProbation();
      const idx = STORE.laborContracts.findIndex(c => c.id === contractId);
      STORE.laborContracts[idx].contractType = 'FIXED_TERM';
      const r = await call('hrc1', 'POST', `/api/records/laborContracts/${contractId}/terminate-probation`, { reason: 'x' });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.ok(/Thử Việc/.test(r.json.error));
    });

    await test('Hợp đồng đã TERMINATED từ trước -> 409 (không xử lý lại)', async () => {
      const { contractId } = await setupActiveProbation();
      await call('hrc1', 'POST', `/api/records/laborContracts/${contractId}/terminate-probation`, { reason: 'Lần 1' });
      const r = await call('hrc1', 'POST', `/api/records/laborContracts/${contractId}/terminate-probation`, { reason: 'Lần 2' });
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
    });

    await test('Thiếu lý do -> 400, KHÔNG đụng gì tới hợp đồng/quy trình/hồ sơ', async () => {
      const { contractId } = await setupActiveProbation();
      const r = await call('hrc1', 'POST', `/api/records/laborContracts/${contractId}/terminate-probation`, { reason: '' });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.strictEqual(STORE.laborContracts.find(c => c.id === contractId).status, 'ACTIVE', 'hợp đồng KHÔNG bị đụng');
    });

    await test('Người KHÔNG có hrContractManage -> 403', async () => {
      const { contractId, processId } = await setupActiveProbation();
      const r1 = await call('emp1', 'POST', `/api/records/laborContracts/${contractId}/terminate-probation`, { reason: 'x' });
      assert.strictEqual(r1.status, 403, JSON.stringify(r1.json));
      const r2 = await call('emp1', 'POST', `/api/records/hrProcesses/${processId}/terminate-probation`, { reason: 'x' });
      assert.strictEqual(r2.status, 403, JSON.stringify(r2.json));
    });

    await test('Tự chấm dứt hợp đồng của CHÍNH MÌNH (employeeUsername khớp actor) -> 403 (assertNotSelfDecidingLaborContract)', async () => {
      const { contractId } = await setupActiveProbation();
      const idx = STORE.laborContracts.findIndex(c => c.id === contractId);
      STORE.laborContracts[idx].employeeUsername = 'hrc1';
      const r = await call('hrc1', 'POST', `/api/records/laborContracts/${contractId}/terminate-probation`, { reason: 'x' });
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
      assert.strictEqual(STORE.laborContracts[idx].status, 'ACTIVE', 'KHÔNG được đụng tới khi bị chặn tự quyết');
    });

    await test('[Alias] processType OFFBOARDING -> 400', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.laborContracts = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', {
        processType: 'OFFBOARDING', employeeUsername: 'emp1', lastWorkingDate: '2026-12-01'
      });
      assert.strictEqual(created.status, 200, JSON.stringify(created.json));
      const r = await call('hrc1', 'POST', `/api/records/hrProcesses/${created.json.item.id}/terminate-probation`, { reason: 'x' });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
    });

    await test('[Alias] Onboarding CHƯA có hợp đồng Thử Việc nào (chưa hoàn thành task1) -> 404', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.laborContracts = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const r = await call('hrc1', 'POST', `/api/records/hrProcesses/${created.json.item.id}/terminate-probation`, { reason: 'x' });
      assert.strictEqual(r.status, 404, JSON.stringify(r.json));
    });

    await test('hợp đồng DRAFT (chưa kích hoạt) vẫn chấm dứt được (ứng viên nghỉ ngang trước ngày đi làm)', async () => {
      resetAppData(); STORE.hrProcesses = []; STORE.laborContracts = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload());
      const processId = created.json.item.id;
      const employeeCode = created.json.item.employeeCode;
      const task1 = created.json.item.tasks.find(t => t.templateId === 1);
      await call('onb1', 'POST', `/api/records/hrProcesses/${processId}/complete-task`, { taskId: task1.taskId });
      assert.strictEqual(STORE.laborContracts[0].status, 'DRAFT');
      const profile = APP_DATA.employeeProfiles.find(p => p.employeeCode === employeeCode);
      profile.status = 'ACTIVE';
      const r = await call('hrc1', 'POST', `/api/records/laborContracts/${STORE.laborContracts[0].id}/terminate-probation`, { reason: 'Nghỉ ngang trước ngày đi làm' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.status, 'TERMINATED');
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
