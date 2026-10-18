// server/tests/test-offboarding-duplicate-process-race.js
//
// LOI DA VA (re-audit lan 5, muc Thap, #143 "Offboarding khong chan tao trung quy trinh"): tao quy
// trinh OFFBOARDING (POST /api/create/hrProcesses, processType=OFFBOARDING) truoc day KHONG kiem tra
// nhan vien da co 1 quy trinh Offboarding khac dang IN_PROGRESS hay chua — 2 nguoi Nhan Su (hoac 1
// nguoi bam 2 lan) deu tao duoc quy trinh Offboarding CHO CUNG 1 NHAN VIEN, sinh 2 bo tasks[]/ticket IT
// trung lap hoan toan. Khac han ONBOARDING — da co co che rieng chong trung CCCD tu goc
// (createOnboardingProcessRecord(), tach khoi duong chung nay).
//
// Da va: them check logic trong extraValidate() (lib/createValidation.js, CREATE_MODULE_CONFIGS.
// hrProcesses) doi chieu voi `collection` (tham so thu 2, CHINH la existingCollection ma routes/
// create.js/lib/recordStore.js doc) + them getLockKey theo employeeUsername de hrProcesses di qua
// createForCollectionSerialized() (khoa THAT, doc FRESH SAU KHI giu khoa) — dong ca khe ho logic
// (sequential) lan khe ho race thuc su (2 request gan nhu dong thoi).
//
// Test nay mirror DUNG khuon tests/test-onboarding-nationalid-race.js (hang doi mutex THAT theo
// lockKey, goi thang router THAT routes/create.js) nhung ap dung cho OFFBOARDING/employeeUsername thay
// vi ONBOARDING/nationalId.
//
// Chay: node server/tests/test-offboarding-duplicate-process-race.js
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

const HR1 = { username: 'hr1', name: 'Nhân Sự 1', dept: 'Nhân Sự', perms: { hrOffboardingManage: true }, active: true };
const HR2 = { username: 'hr2', name: 'Nhân Sự 2', dept: 'Nhân Sự', perms: { hrOffboardingManage: true }, active: true };
const NV_A = { username: 'nv.a', name: 'Nguyễn Văn A', dept: 'Kinh Doanh', jobTitle: 'Nhân Viên', email: 'a@congty.vn', perms: {}, active: true };
const NV_B = { username: 'nv.b', name: 'Trần Văn B', dept: 'Kinh Doanh', jobTitle: 'Nhân Viên', email: 'b@congty.vn', perms: {}, active: true };
const USERS = [HR1, HR2, NV_A, NV_B];

stubModule('lib/appData', {
  getAllAppData: async () => ({
    users: USERS, depts: ['Nhân Sự', 'Kinh Doanh'], stores: [], jobTitles: ['Nhân Viên'],
    storeJobTitles: [], hrTaskTemplates: [], formTemplates: {}, employeeProfiles: []
  }),
  getAppDataValue: async (key) => null,
  withLockedAppDataValue: async (key, fn) => fn(null)
});

// ===== Hàng đợi mutex THẬT theo lockKey (mirror withFakeAppLock() ở test-operation-order-po-race.js /
// test-onboarding-nationalid-race.js) =====
const lockChains = new Map();
async function withFakeLock(lockKey, fn) {
  const prev = lockChains.get(lockKey) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  lockChains.set(lockKey, prev.then(() => current));
  await prev;
  try { return await fn(); } finally { release(); }
}
const DELAY_MS = 20;
function yieldTurn() { return new Promise((resolve) => setTimeout(resolve, DELAY_MS)); }

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
  // Mirror ĐÚNG lib/recordStore.js thật: giữ khoá XONG mới đọc "existing" (ở đây là RECORDS[c]) rồi mới
  // gọi builderFn — chính cơ chế bản vá dựa vào để check trùng luôn thấy đúng dữ liệu mới nhất.
  createForCollectionSerialized: async (c, lockKey, builderFn) => withFakeLock(`record:${lockKey}`, async () => {
    await yieldTurn();
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
const recordRoutes = require('../routes/records');

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  app.use('/api/records', recordRoutes);
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

async function main() {
  const server = await startApp();
  try {
    resetRecords();

    await (async () => {
      const r1 = await api(server, 'POST', '/api/create/hrProcesses', offboardingPayload(), HR1);
      console.log('  (chuẩn bị) tạo lần 1:', r1.status === 200 ? 'OK' : JSON.stringify(r1.body));
    })();

    const r2 = await api(server, 'POST', '/api/create/hrProcesses', offboardingPayload(), HR2);
    check('LỖI ĐÃ VÁ: tạo OFFBOARDING lần 2 cho CÙNG 1 nhân viên khi lần 1 còn IN_PROGRESS -> bị chặn 409',
      r2.status === 409 && /đang thực hiện/.test(r2.body?.error || ''), r2.body);
    check('vẫn CHỈ 1 bản ghi hrProcesses được tạo (không trùng)', RECORDS.hrProcesses.length === 1, RECORDS.hrProcesses);

    resetRecords();
    // Bắn GẦN NHƯ ĐỒNG THỜI: 2 nhân viên HR khác nhau cùng tạo Offboarding cho CÙNG 1 nhân viên (nv.a).
    const [ra, rb] = await Promise.all([
      api(server, 'POST', '/api/create/hrProcesses', offboardingPayload(), HR1),
      api(server, 'POST', '/api/create/hrProcesses', offboardingPayload(), HR2)
    ]);
    const bothSucceeded = ra.status === 200 && rb.status === 200;
    check('LỖI ĐÃ VÁ (race thật): KHÔNG được cả 2 request OFFBOARDING cho CÙNG 1 nhân viên cùng thành công',
      !bothSucceeded, { raStatus: ra.status, rbStatus: rb.status });
    check('LỖI ĐÃ VÁ (race thật): chỉ CHÍNH XÁC 1 bản ghi hrProcesses được tạo cho nhân viên này',
      RECORDS.hrProcesses.filter(p => p.employeeUsername === 'nv.a').length === 1,
      RECORDS.hrProcesses);
    const losingSide = ra.status === 200 ? rb : ra;
    check('request thua cuộc bị chặn đúng 409 "đang thực hiện"', losingSide.status === 409 && /đang thực hiện/.test(losingSide.body?.error || ''), losingSide.body);

    resetRecords();
    // Đối chứng: 2 Offboarding cho 2 NHÂN VIÊN KHÁC NHAU vẫn tạo đồng thời bình thường, không bị khoá
    // chung "vô tình" chặn nhầm 2 request không liên quan.
    const [rc, rd] = await Promise.all([
      api(server, 'POST', '/api/create/hrProcesses', offboardingPayload({ employeeUsername: 'nv.a' }), HR1),
      api(server, 'POST', '/api/create/hrProcesses', offboardingPayload({ employeeUsername: 'nv.b' }), HR2)
    ]);
    check('2 Offboarding cho 2 NHÂN VIÊN KHÁC NHAU vẫn tạo đồng thời bình thường (không bị khoá chung chặn nhầm)',
      rc.status === 200 && rd.status === 200 && RECORDS.hrProcesses.length === 2,
      { rcStatus: rc.status, rdStatus: rd.status, count: RECORDS.hrProcesses.length });

    resetRecords();
    // Đối chứng: quy trình CŨ đã CANCELLED (không còn IN_PROGRESS) -> tạo quy trình Offboarding MỚI cho
    // ĐÚNG nhân viên đó vẫn được (nhân viên tuyển lại rồi nghỉ việc lần sau là tình huống hợp lệ).
    const r3 = await api(server, 'POST', '/api/create/hrProcesses', offboardingPayload(), HR1);
    check('tạo lần 1 thành công', r3.status === 200, r3.body);
    RECORDS.hrProcesses[0].status = 'CANCELLED';
    const r4 = await api(server, 'POST', '/api/create/hrProcesses', offboardingPayload(), HR2);
    check('quy trình CŨ đã CANCELLED -> tạo quy trình MỚI cho cùng nhân viên KHÔNG bị chặn (không mất chức năng hợp lệ)',
      r4.status === 200, r4.body);
    check('có đúng 2 bản ghi (1 CANCELLED + 1 IN_PROGRESS mới)', RECORDS.hrProcesses.length === 2, RECORDS.hrProcesses);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  if (fail) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
