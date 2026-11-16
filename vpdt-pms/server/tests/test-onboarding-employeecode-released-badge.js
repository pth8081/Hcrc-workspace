// server/tests/test-onboarding-employeecode-released-badge.js
//
// LOI DA VA (12/2026, nguoi dung bao 2 quy trinh Onboarding cua 2 NGUOI KHAC NHAU cung hien 1 Ma Nhan
// Vien, tuong nham la loi trung ma): cleanupDraftProfileOnOnboardingClosed() (routes/records.js) tu
// XOA ho so Nhap dat cho khi 1 quy trinh Onboarding bi Huy, GIAI PHONG lai Ma Nhan Vien do cho nguoi
// khac dung (tinh nang CO CHU DICH, khong phai bug) - nhung danh sach "Quy Trinh" khong he bao hieu gi,
// khien quy trinh CU (da Huy) va quy trinh MOI (dang hoat dong) nhin nhu dang TRUNG ma that.
//
// Da va: danh dau employeeCodeReleased=true len CHINH quy trinh vua bi Huy (khi ma cua no duoc giai
// phong) - client (module-hrlifecycle.js) hien badge "⚠️ Mã đã dùng lại" canh Ma Nhan Vien cua quy trinh
// CU do. KHONG doi gia tri employeeCode that (khong anh huong bat ky noi nao dang tra cuu theo dung ma).
//
// Khuon giong tests/test-onboarding-cancel-labor-contract-cleanup.js (dung Express app THAT mount
// routes/create.js + routes/records.js, thay tang luu tru bang in-memory).
//
// Chay: node server/tests/test-onboarding-employeecode-released-badge.js
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

const STORE = { laborContracts: [], hrProcesses: [], itSupportTickets: [] };
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
    hrTaskTemplates: [
      { id: 99, processType: 'ONBOARDING', taskName: 'Việc khác chưa xong', department: 'HR', stage: 'TRAINING', isRequired: true, isActive: true, displayOrder: 1, dueDaysOffset: 5 }
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
    await test('Huỷ Onboarding -> giải phóng mã + đánh dấu employeeCodeReleased=true trên CHÍNH quy trình đã huỷ', async () => {
      resetAppData(); STORE.hrProcesses = [];
      const createdA = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload({ fullName: 'Trần Thị Huyền' }));
      assert.strictEqual(createdA.status, 200, JSON.stringify(createdA.json));
      const codeA = createdA.json.item.employeeCode;
      assert.ok(codeA, 'Phải tự sinh được Mã Nhân Viên');

      const cancelRes = await call('onb1', 'POST', `/api/records/hrProcesses/${createdA.json.item.id}/cancel`, { reason: 'Ứng viên không tới nhận việc' });
      assert.strictEqual(cancelRes.status, 200, JSON.stringify(cancelRes.json));
      assert.strictEqual(cancelRes.json.item.employeeCodeReleased, true, 'Quy trình vừa huỷ phải được đánh dấu employeeCodeReleased để client hiện badge cảnh báo');
      assert.strictEqual(cancelRes.json.item.employeeCode, codeA, 'KHÔNG được đổi giá trị employeeCode thật — chỉ thêm cờ hiển thị');

      const profileStillThere = (APP_DATA.employeeProfiles || []).find(p => p.employeeCode === codeA);
      assert.strictEqual(profileStillThere, undefined, 'Hồ sơ Nháp phải được dọn (giải phóng mã) như thiết kế cũ, không bị thay đổi bởi bản vá này');

      const createdB = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload({ fullName: 'Quách Đình Huế' }));
      assert.strictEqual(createdB.status, 200, JSON.stringify(createdB.json));
      assert.strictEqual(createdB.json.item.employeeCode, codeA, 'Mã được giải phóng phải tái sử dụng được cho người mới (đúng thiết kế đã có từ trước)');
      assert.strictEqual(createdB.json.item.employeeCodeReleased, undefined, 'Quy trình MỚI (đang hoạt động) KHÔNG được tự mang cờ employeeCodeReleased của quy trình cũ');

      const freshA = STORE.hrProcesses.find(p => p.id === createdA.json.item.id);
      assert.strictEqual(freshA.employeeCodeReleased, true, 'Quy trình CŨ (đã huỷ) vẫn phải giữ nguyên cờ cảnh báo trong danh sách');
    });

    await test('Xoá hẳn quy trình Onboarding (không qua Huỷ) — không crash dù bản ghi hrProcesses không còn tồn tại để đánh dấu', async () => {
      resetAppData(); STORE.hrProcesses = [];
      const created = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload({ fullName: 'Ứng Viên Xoá Hẳn' }));
      assert.strictEqual(created.status, 200, JSON.stringify(created.json));
      const codeDel = created.json.item.employeeCode;

      const delRes = await call('admin', 'POST', `/api/records/hrProcesses/${created.json.item.id}/delete`, {});
      assert.strictEqual(delRes.status, 200, JSON.stringify(delRes.json));
      assert.strictEqual(STORE.hrProcesses.find(p => p.id === created.json.item.id), undefined, 'Bản ghi phải bị xoá hẳn như cũ');

      const createdNext = await call('onb1', 'POST', '/api/create/hrProcesses', onboardingPayload({ fullName: 'Người Kế Tiếp' }));
      assert.strictEqual(createdNext.status, 200, JSON.stringify(createdNext.json));
      assert.strictEqual(createdNext.json.item.employeeCode, codeDel, 'Mã vẫn được giải phóng/tái sử dụng bình thường ở nhánh Xoá (hành vi cũ không đổi)');
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => { console.error('FATAL:', err.stack || err); process.exitCode = 1; });
