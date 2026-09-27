// server/tests/test-labor-contract-allowances.js
//
// Regression test cho 7 khoản Phụ Cấp/Hỗ Trợ mới thêm vào Hợp Đồng Lao Động (GĐ1, 10/2026 — đối chiếu
// file Excel quản lý thủ công của bộ phận Nhân Sự, xem lib/laborContract.js::ALLOWANCE_FIELDS). Cùng
// khuôn tests/test-labor-contract.js (Phần B: HTTP thật qua routes/create.js + routes/records.js với
// recordStore in-memory) — chỉ tập trung đúng các field mới, không lặp lại các test vòng đời đã có.
'use strict';

const assert = require('assert');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

// ===================== Phần A: lib/laborContract.js thuần =====================
async function partA() {
  console.log('\n== Phần A: lib/laborContract.js (thuần) — ALLOWANCE_FIELDS ==');
  const laborContract = require('../lib/laborContract');

  await test('defaultContract() khởi tạo cả 7 khoản phụ cấp = null', () => {
    const c = laborContract.defaultContract();
    for (const f of laborContract.ALLOWANCE_FIELDS) {
      assert.strictEqual(c[f], null, `${f} phải mặc định null`);
    }
    assert.strictEqual(laborContract.ALLOWANCE_FIELDS.length, 7);
  });

  await test('applyManualEdit() chấp nhận số hợp lệ cho từng khoản phụ cấp', () => {
    const contract = { status: 'ACTIVE', history: [], responsibilityAllowance: null };
    laborContract.applyManualEdit(contract, { responsibilityAllowance: '500000' }, 'hr1', 'HR One');
    assert.strictEqual(contract.responsibilityAllowance, 500000);
  });

  await test('applyManualEdit() chặn giá trị âm cho phụ cấp (giống baseSalary)', () => {
    const contract = { status: 'ACTIVE', history: [], lunchAllowance: null };
    assert.throws(() => laborContract.applyManualEdit(contract, { lunchAllowance: '-1000' }, 'hr1', 'HR One'), /không hợp lệ/);
  });

  await test('applyManualEdit() chấp nhận gửi rỗng/null để xoá phụ cấp (tuỳ chọn)', () => {
    const contract = { status: 'ACTIVE', history: [], phoneAllowance: 200000 };
    laborContract.applyManualEdit(contract, { phoneAllowance: '' }, 'hr1', 'HR One');
    assert.strictEqual(contract.phoneAllowance, null);
  });

  await test('applyManualEdit() ghi đúng 1 dòng lịch sử khi phụ cấp thực sự đổi giá trị (dùng đúng nhãn tiếng Việt)', () => {
    const contract = { status: 'ACTIVE', history: [], hazardAllowance: null };
    laborContract.applyManualEdit(contract, { hazardAllowance: '300000' }, 'hr1', 'HR One');
    assert.strictEqual(contract.history.length, 1);
    assert.strictEqual(contract.history[0].action, 'MANUAL_EDIT');
    assert.ok(/Phụ cấp độc hại nặng nhọc/.test(contract.history[0].detail), contract.history[0].detail);
    assert.ok(/300000/.test(contract.history[0].detail), contract.history[0].detail);
  });
}

// ===================== Phần B: HTTP thật qua routes/create.js + routes/records.js =====================
async function partB() {
  console.log('\n== Phần B: HTTP thật (Express + recordStore in-memory) — ALLOWANCE_FIELDS ==');
  const path = require('path');
  const express = require('express');
  const http = require('http');

  const STORE = { laborContracts: [] };
  let nextId = 1;
  function stubModule(relPath, exportsObj) {
    const full = require.resolve(path.join(__dirname, '..', relPath));
    require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
    return exportsObj;
  }
  stubModule('lib/recordStore', {
    MIGRATED_COLLECTIONS: new Set(['laborContracts']),
    getAllForCollection: async (c) => STORE[c].slice(),
    getAllForCollectionCached: async (c) => STORE[c].slice(),
    getTrashItems: async () => [],
    withAppLock: async (key, fn) => fn(),
    createForCollection: async (c, builderFn) => {
      const draft = await builderFn();
      const item = Object.assign({ id: nextId++ }, draft);
      STORE[c].push(item);
      return item;
    },
    createForCollectionSerialized: async (c, lockKey, builderFn) => {
      const draft = await builderFn();
      const item = Object.assign({ id: nextId++ }, draft);
      STORE[c].push(item);
      return item;
    },
    withLockedRecordForCollection: async (c, id, mutatorFn) => {
      const idx = STORE[c].findIndex(x => x.id === Number(id));
      if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
      const result = await mutatorFn(STORE[c][idx]);
      STORE[c][idx] = result;
      return result;
    },
    deleteRecordForCollection: async (c, id, checkFn) => {
      const idx = STORE[c].findIndex(x => x.id === Number(id));
      if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
      if (checkFn) checkFn(STORE[c][idx]);
      STORE[c].splice(idx, 1);
    }
  });

  const USERS = [
    { username: 'hr1', name: 'Nhân Sự Một', dept: 'Nhân Sự', perms: { hrContractManage: true }, active: true },
    { username: 'emp1', name: 'Nhân Viên Thường', dept: 'Kinh Doanh', perms: {}, active: true }
  ];
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const username = req.headers['x-demo-user'];
      const fresh = USERS.find(u => u.username === username);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      req.allUsers = USERS;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  const EMPLOYEE_PROFILES = [{ employeeCode: 'NV4001', status: 'ACTIVE', username: null, processId: null }];
  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key === 'users' ? USERS : (key === 'employeeProfiles' ? EMPLOYEE_PROFILES : null)),
    getAllAppData: async () => ({ users: USERS, employeeProfiles: EMPLOYEE_PROFILES, depts: ['Nhân Sự', 'Kinh Doanh'], stores: [] }),
    withLockedAppDataValue: async (key, fn) => fn(key === 'users' ? USERS : [])
  });

  const createRoutes = require('../routes/create');
  const recordRoutes = require('../routes/records');
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  app.use('/api/records', recordRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, method, urlPath, body) {
    const res = await fetch(`${base}${urlPath}`, {
      method, headers: Object.assign({ 'x-demo-user': username }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  try {
    let created;
    await test('POST /api/create/laborContracts — tạo tay kèm đủ 7 khoản phụ cấp, lưu đúng số', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV4001', contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31',
        baseSalary: '10000000', responsibilityAllowance: '500000', concurrentAllowance: '200000',
        hazardAllowance: '300000', lunchAllowance: '730000', transportAllowance: '400000',
        phoneAllowance: '150000', otherAllowance: '0'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.responsibilityAllowance, 500000);
      assert.strictEqual(r.json.item.concurrentAllowance, 200000);
      assert.strictEqual(r.json.item.hazardAllowance, 300000);
      assert.strictEqual(r.json.item.lunchAllowance, 730000);
      assert.strictEqual(r.json.item.transportAllowance, 400000);
      assert.strictEqual(r.json.item.phoneAllowance, 150000);
      assert.strictEqual(r.json.item.otherAllowance, 0);
      created = r.json.item;
    });

    await test('POST /api/create/laborContracts — không gửi phụ cấp nào -> mặc định null (tuỳ chọn, không bắt buộc)', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV4001', contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31', baseSalary: '10000000'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.responsibilityAllowance, null);
      assert.strictEqual(r.json.item.otherAllowance, null);
    });

    await test('POST /api/create/laborContracts — phụ cấp âm bị chặn 400 (extraValidate)', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV4001', contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31',
        baseSalary: '10000000', transportAllowance: '-50000'
      });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.ok(/Hỗ trợ đi lại/.test(r.json.error), JSON.stringify(r.json));
    });

    await test('POST /api/records/laborContracts/:id/edit — sửa phụ cấp qua route sửa tay, KHÔNG đụng baseSalary', async () => {
      const r = await call('hr1', 'POST', `/api/records/laborContracts/${created.id}/edit`, { concurrentAllowance: '999000' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.concurrentAllowance, 999000);
      assert.strictEqual(r.json.item.baseSalary, 10000000, 'Sửa riêng phụ cấp không được đụng tới Lương cơ bản');
    });

    await test('POST /api/records/laborContracts/:id/edit — người không có quyền vẫn bị chặn 403 (giống mọi field khác)', async () => {
      const r = await call('emp1', 'POST', `/api/records/laborContracts/${created.id}/edit`, { otherAllowance: '100000' });
      assert.strictEqual(r.status, 403);
    });
  } finally {
    server.close();
  }
}

async function main() {
  await partA();
  await partB();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
