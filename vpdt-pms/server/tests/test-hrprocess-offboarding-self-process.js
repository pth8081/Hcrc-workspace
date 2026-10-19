// server/tests/test-hrprocess-offboarding-self-process.js
//
// LỖI ĐÃ VÁ (re-audit lần 8, mức Cao — "hrProcesses OFFBOARDING: tự tạo + tự xử lý quy trình nghỉ việc
// của chính mình"): trước đây employeeUsername được chọn tự do khi tạo quy trình OFFBOARDING, không
// chặn === chính người gọi API (lib/createValidation.js, CREATE_MODULE_CONFIGS.hrProcesses.extraValidate).
// Vì canManageHrProcess()/canActOnHrTask() (lib/recordActions.js) cho creator toàn quyền quản lý quy
// trình (huỷ/chỉ định người kế nhiệm/giao lại task) VÀ cho hrOffboardingManage/hrProcessManage toàn
// quyền xử lý task — 1 người có hrOffboardingManage tự tạo quy trình Offboarding cho chính mình rồi tự
// hoàn thành/bỏ qua mọi task, tự huỷ quy trình, tự chỉ định người kế nhiệm — không ai xác nhận độc lập.
//
// Đã vá: (1) chặn tạo ngay tại extraValidate() nếu employeeUsername === user.username; (2) chặn TUYỆT
// ĐỐI (không cho hrProcessManage/admin/creator bypass) ở canManageHrProcess()/canActOnHrTask() khi
// item.processType === 'OFFBOARDING' && item.employeeUsername === user.username — phòng cả dữ liệu cũ/
// đường gọi khác không đi qua extraValidate.
//
// Chạy: node server/tests/test-hrprocess-offboarding-self-process.js
'use strict';

const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

const HR1 = { username: 'hr1', name: 'Nhân Sự 1 (chuẩn bị nghỉ việc)', dept: 'Nhân Sự', perms: { hrOffboardingManage: true }, active: true };
const HR2 = { username: 'hr2', name: 'Nhân Sự 2', dept: 'Nhân Sự', perms: { hrOffboardingManage: true }, active: true };
const NV_A = { username: 'nv.a', name: 'Nguyễn Văn A', dept: 'Kinh Doanh', jobTitle: 'Nhân Viên', email: 'a@congty.vn', perms: {}, active: true };
const USERS = [HR1, HR2, NV_A];

stubModule('lib/appData', {
  getAllAppData: async () => ({
    users: USERS, depts: ['Nhân Sự', 'Kinh Doanh'], stores: [], jobTitles: ['Nhân Viên'],
    storeJobTitles: [], hrTaskTemplates: [], formTemplates: {}, employeeProfiles: []
  }),
  getAppDataValue: async (key) => null,
  withLockedAppDataValue: async (key, fn) => fn(null)
});

const lockChains = new Map();
async function withFakeLock(lockKey, fn) {
  const prev = lockChains.get(lockKey) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  lockChains.set(lockKey, prev.then(() => current));
  await prev;
  try { return await fn(); } finally { release(); }
}

let RECORDS;
let nextId = 1;
function resetRecords() { RECORDS = { hrProcesses: [] }; nextId = 1; lockChains.clear(); }
resetRecords();

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['hrProcesses']),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  getTrashItems: async () => [],
  createForCollection: async (c, builderFn) => {
    const draft = await builderFn((RECORDS[c] || []).slice());
    const record = Object.assign({ id: nextId++ }, draft);
    RECORDS[c] = RECORDS[c] || []; RECORDS[c].push(record);
    return record;
  },
  createForCollectionSerialized: async (c, lockKey, builderFn) => withFakeLock(`record:${lockKey}`, async () => {
    const draft = await builderFn((RECORDS[c] || []).slice());
    const record = Object.assign({ id: nextId++ }, draft);
    RECORDS[c] = RECORDS[c] || []; RECORDS[c].push(record);
    return record;
  }),
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    list[idx] = await mutatorFn(list[idx]);
    return list[idx];
  },
  withAppLock: async (key, fn) => withFakeLock(`applock:${key}`, fn)
});

stubModule('lib/uploadedFiles', { assertPayloadFileUrlsOwnedByUser: async () => {} });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {}, querySystemLogs: async () => ({ items: [], total: 0 }) });

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const username = req.headers['x-test-user'];
    const fresh = USERS.find((u) => u.username === username);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const createRoutes = require('../routes/create');

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function api(server, method, urlPath, body, asUser) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: Object.assign({ 'x-test-user': asUser.username }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let payload = null; try { payload = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, body: payload };
}

function offboardingPayload(overrides) {
  return Object.assign({ processType: 'OFFBOARDING', employeeUsername: 'nv.a', lastWorkingDate: '2026-12-31' }, overrides || {});
}

async function runPartA_createRoute() {
  const server = await startApp();
  try {
    resetRecords();
    const selfAttempt = await api(server, 'POST', '/api/create/hrProcesses', offboardingPayload({ employeeUsername: HR1.username }), HR1);
    check('LỖI ĐÃ VÁ: HR1 tự tạo quy trình Offboarding cho CHÍNH MÌNH -> bị chặn 403',
      selfAttempt.status === 403 && /tự tạo/.test(selfAttempt.body?.error || ''), selfAttempt.body);
    check('không tạo ra bản ghi nào', RECORDS.hrProcesses.length === 0, RECORDS.hrProcesses);

    resetRecords();
    const otherAttempt = await api(server, 'POST', '/api/create/hrProcesses', offboardingPayload({ employeeUsername: 'nv.a' }), HR1);
    check('đối chứng: HR1 tạo Offboarding cho NGƯỜI KHÁC (nv.a) vẫn thành công bình thường', otherAttempt.status === 200, otherAttempt.body);
  } finally {
    server.close();
  }
}

function runPartB_permissionFunctions() {
  const { canManageHrProcess, canActOnHrTask } = require('../lib/recordActions');

  const selfOffboarding = { id: 1, processType: 'OFFBOARDING', employeeUsername: 'hr1', creator: 'hr2', status: 'IN_PROGRESS', tasks: [] };
  const otherOffboarding = { id: 2, processType: 'OFFBOARDING', employeeUsername: 'nv.a', creator: 'hr1', status: 'IN_PROGRESS', tasks: [] };
  const selfTask = { id: 101, department: 'HR', stage: 'ASSET_RETURN', status: 'PENDING' };

  const HR1_ADMIN = { username: 'hr1', perms: { hrOffboardingManage: true, hrProcessManage: true, admin: true } };

  check('LỖI ĐÃ VÁ: canManageHrProcess() chặn TUYỆT ĐỐI dù là creator + có hrProcessManage + admin, khi employeeUsername === chính mình',
    canManageHrProcess(HR1_ADMIN, selfOffboarding) === false);
  check('LỖI ĐÃ VÁ: canActOnHrTask() chặn TUYỆT ĐỐI dù có hrProcessManage + admin, khi employeeUsername === chính mình',
    canActOnHrTask(HR1_ADMIN, selfOffboarding, selfTask) === false);

  check('đối chứng: canManageHrProcess() vẫn cho phép xử lý quy trình Offboarding của NGƯỜI KHÁC (creator)',
    canManageHrProcess({ username: 'hr1', perms: { hrOffboardingManage: true } }, otherOffboarding) === true);
  check('đối chứng: canActOnHrTask() vẫn cho phép xử lý task HR của quy trình Offboarding NGƯỜI KHÁC (hrOffboardingManage)',
    canActOnHrTask({ username: 'hr1', perms: { hrOffboardingManage: true } }, otherOffboarding, selfTask) === true);

  // Đối chứng: ONBOARDING không có employeeUsername (luôn null) -> không bị ảnh hưởng bởi check mới.
  const onboarding = { id: 3, processType: 'ONBOARDING', employeeUsername: null, creator: 'hr1', status: 'IN_PROGRESS', tasks: [] };
  check('đối chứng: ONBOARDING (employeeUsername luôn null) không bị chặn nhầm bởi check tự-liên-quan mới',
    canManageHrProcess({ username: 'hr1', perms: { hrOnboardingManage: true } }, onboarding) === true);
}

async function main() {
  await runPartA_createRoute();
  runPartB_permissionFunctions();
  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  if (fail) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
