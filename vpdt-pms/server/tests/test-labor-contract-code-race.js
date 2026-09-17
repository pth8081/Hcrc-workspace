// server/tests/test-labor-contract-code-race.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026, mức Trung bình):
// generateContractCode() (lib/laborContract.js) sinh mã kiểu "HDLD-<employeeCode>-<đếm số hợp đồng đã
// có của người đó>+1" — thuần đếm 1 SNAPSHOT collection đọc lúc gọi, KHÔNG có khoá/retry nào đứng sau.
// 2 request "Tạo tay hợp đồng" gần như đồng thời CHO CÙNG 1 employeeCode (HR double-click, hoặc 2 người
// cùng thao tác 1 nhân viên) trước đây đều đếm được CÙNG số lượng hợp đồng hiện có, cùng sinh ra CÙNG 1
// mã "HDLD-...-N" — 2 hợp đồng trùng mã.
// Đã vá: thêm getLockKey (`labor_contract_code:<employeeCode>`) vào CREATE_MODULE_CONFIGS.laborContracts
// (lib/createValidation.js) — routes/create.js tự chuyển sang createForCollectionSerialized() (sp_getapplock),
// bọc TOÀN BỘ đọc-sinh mã-ghi thay vì createForCollection() không khoá.
//
// Test này gọi thẳng router THẬT (routes/create.js) với lib/recordStore giả lập bằng 1 hàng đợi mutex
// THẬT theo lockKey (mirror ĐÚNG khuôn withFakeAppLock() ở các test race condition khác trong session
// này — tests/test-operation-order-po-race.js/test-payment-source-race.js) + 1 cửa sổ "nhường lượt" chèn
// giữa đọc collection và bước sinh mã/ghi, để buộc 2 request bắn GẦN NHƯ ĐỒNG THỜI (Promise.all) phải
// thực sự tranh chấp cùng 1 cửa sổ thời gian — nếu bản vá bị hoàn tác, test này sẽ FAIL (phát hiện 2 hợp
// đồng trùng mã cho cùng 1 nhân viên).
//
// Chạy: node server/tests/test-labor-contract-code-race.js
'use strict';

const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

const HR1 = { username: 'hr1', name: 'Nhân Sự Một', dept: 'Nhân Sự', perms: { hrContractManage: true }, active: true };
const HR2 = { username: 'hr2', name: 'Nhân Sự Hai', dept: 'Nhân Sự', perms: { hrContractManage: true }, active: true };
const USERS = [HR1, HR2];
const EMPLOYEE_PROFILES = [{ employeeCode: 'NV5001', status: 'ACTIVE', username: null, processId: null }];

let RECORDS = { laborContracts: [] };
let nextId = 1;
function resetRecords() { RECORDS = { laborContracts: [] }; nextId = 1; }

const lockChains = new Map();
async function withFakeAppLock(lockKeyOrKeys, fn) {
  const keys = Array.isArray(lockKeyOrKeys) ? lockKeyOrKeys : [lockKeyOrKeys];
  for (const key of keys) {
    const prev = lockChains.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    lockChains.set(key, prev.then(() => current));
    await prev;
    try { return await fn(); } finally { release(); }
  }
}
const DELAY_MS = 25;
function yieldTurn() { return new Promise((resolve) => setTimeout(resolve, DELAY_MS)); }

stubModule('lib/appData', {
  getAllAppData: async () => ({ users: USERS, employeeProfiles: EMPLOYEE_PROFILES, depts: ['Nhân Sự'], stores: [] }),
  withLockedAppDataValue: async (key, fn) => fn([])
});
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['laborContracts']),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  getTrashItems: async () => [],
  createForCollection: async (c, builderFn) => {
    const record = await builderFn((RECORDS[c] || []).slice());
    RECORDS[c].push(record);
    return record;
  },
  // Cửa sổ đọc-rồi-ghi CỐ Ý chèn NGAY SAU khi khoá được cấp (mirror đúng chỗ createForCollectionSerialized
  // thật đọc collection RỒI mới await builderFn ghi) — nhường lượt cho request song song thứ 2 chờ đúng
  // lúc này nếu KHÔNG có khoá chung bọc quanh (bản vá bị hoàn tác).
  createForCollectionSerialized: (c, lockKey, builderFn) => withFakeAppLock(lockKey, async () => {
    const existing = (RECORDS[c] || []).slice();
    await yieldTurn();
    const record = await builderFn(existing);
    RECORDS[c].push(record);
    return record;
  }),
  withAppLock: async (key, fn) => withFakeAppLock(key, fn)
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
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
    headers: { 'Content-Type': 'application/json', 'x-test-user': asUser.username },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

function contractPayload(overrides) {
  return Object.assign({
    employeeCode: 'NV5001', contractType: 'INDEFINITE', startDate: '2026-01-01', baseSalary: '10000000'
  }, overrides);
}

async function main() {
  const server = await startApp();
  try {
    // ===== Kịch bản 1: 2 request tạo hợp đồng gần như đồng thời CHO CÙNG 1 nhân viên =====
    resetRecords();
    const [r1, r2] = await Promise.all([
      api(server, 'POST', '/api/create/laborContracts', contractPayload(), HR1),
      api(server, 'POST', '/api/create/laborContracts', contractPayload(), HR2)
    ]);
    check('CẢ 2 request đều phải thành công (không loại trừ nhau — khác race của findings khác, ở đây không có gì SAI về nghiệp vụ khi tạo 2 hợp đồng cho 1 người, chỉ cần MÃ không trùng)',
      r1.status === 200 && r2.status === 200, { r1, r2 });
    const codes = RECORDS.laborContracts.map(c => c.code);
    check('KHÔNG được có 2 hợp đồng trùng mã (LỖI ĐÃ VÁ — race condition sinh mã)',
      new Set(codes).size === codes.length && codes.length === 2, { codes });
    check('2 mã sinh ra phải đúng "HDLD-NV5001-1" và "HDLD-NV5001-2" (thứ tự bất kỳ)',
      codes.includes('HDLD-NV5001-1') && codes.includes('HDLD-NV5001-2'), { codes });

    // ===== Kịch bản 2: 2 request tạo hợp đồng cho 2 NHÂN VIÊN KHÁC NHAU vẫn chạy song song bình thường
    // (không bị khoá chung theo employeeCode chặn nhầm nhau). =====
    resetRecords();
    EMPLOYEE_PROFILES.push({ employeeCode: 'NV5002', status: 'ACTIVE', username: null, processId: null });
    const [r3, r4] = await Promise.all([
      api(server, 'POST', '/api/create/laborContracts', contractPayload({ employeeCode: 'NV5001' }), HR1),
      api(server, 'POST', '/api/create/laborContracts', contractPayload({ employeeCode: 'NV5002' }), HR2)
    ]);
    check('2 hợp đồng KHÁC nhân viên vẫn tạo đồng thời bình thường (không bị khoá chung chặn nhầm)',
      r3.status === 200 && r4.status === 200 && RECORDS.laborContracts.length === 2, { r3Status: r3.status, r4Status: r4.status });
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
