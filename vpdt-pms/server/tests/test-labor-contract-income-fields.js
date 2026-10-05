// server/tests/test-labor-contract-income-fields.js
//
// Regression test cho đợt "báo cáo rà soát mẫu Excel mới" (10/2026): 3 khoản thu nhập mới
// (socialInsuranceSalary/productivityBonus/otherIncome, xem lib/laborContract.js::INCOME_FIELDS)
// + probationSalaryRate (85/100%) thêm vào Hợp Đồng Lao Động, CÙNG khuôn
// tests/test-labor-contract-allowances.js (Phần A: lib/laborContract.js thuần, Phần B: HTTP thật qua
// routes/create.js + routes/records.js với recordStore in-memory).
'use strict';

const assert = require('assert');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

// ===================== Phần A: lib/laborContract.js thuần =====================
async function partA() {
  console.log('\n== Phần A: lib/laborContract.js (thuần) — INCOME_FIELDS + probationSalaryRate ==');
  const laborContract = require('../lib/laborContract');

  await test('module.exports có đủ INCOME_FIELDS/INCOME_FIELD_LABELS/PROBATION_SALARY_RATES (LỖI ĐÃ VÁ — trước đây thiếu export)', () => {
    assert.deepStrictEqual(laborContract.INCOME_FIELDS, ['socialInsuranceSalary', 'productivityBonus', 'otherIncome']);
    assert.strictEqual(typeof laborContract.INCOME_FIELD_LABELS.socialInsuranceSalary, 'string');
    assert.ok(laborContract.PROBATION_SALARY_RATES.has(85) && laborContract.PROBATION_SALARY_RATES.has(100));
  });

  await test('defaultContract() khởi tạo cả 3 khoản thu nhập + probationSalaryRate = null', () => {
    const c = laborContract.defaultContract();
    for (const f of laborContract.INCOME_FIELDS) {
      assert.strictEqual(c[f], null, `${f} phải mặc định null`);
    }
    assert.strictEqual(c.probationSalaryRate, null);
  });

  await test('applyManualEdit() chấp nhận số hợp lệ cho từng khoản thu nhập', () => {
    const contract = { status: 'ACTIVE', history: [], socialInsuranceSalary: null };
    laborContract.applyManualEdit(contract, { socialInsuranceSalary: '8000000' }, 'hr1', 'HR One');
    assert.strictEqual(contract.socialInsuranceSalary, 8000000);
  });

  await test('applyManualEdit() chặn giá trị âm cho khoản thu nhập (giống baseSalary/phụ cấp)', () => {
    const contract = { status: 'ACTIVE', history: [], productivityBonus: null };
    assert.throws(() => laborContract.applyManualEdit(contract, { productivityBonus: '-1000' }, 'hr1', 'HR One'), /không hợp lệ/);
  });

  await test('applyManualEdit() chấp nhận probationSalaryRate=85 hoặc 100', () => {
    const contract = { status: 'ACTIVE', history: [], probationSalaryRate: null };
    laborContract.applyManualEdit(contract, { probationSalaryRate: '85' }, 'hr1', 'HR One');
    assert.strictEqual(contract.probationSalaryRate, 85);
    laborContract.applyManualEdit(contract, { probationSalaryRate: '100' }, 'hr1', 'HR One');
    assert.strictEqual(contract.probationSalaryRate, 100);
  });

  await test('applyManualEdit() chặn probationSalaryRate khác 85/100 (VD 90)', () => {
    const contract = { status: 'ACTIVE', history: [], probationSalaryRate: null };
    assert.throws(() => laborContract.applyManualEdit(contract, { probationSalaryRate: '90' }, 'hr1', 'HR One'), /85 hoặc 100/);
  });

  await test('applyManualEdit() chấp nhận gửi rỗng để xoá khoản thu nhập/probationSalaryRate (tuỳ chọn)', () => {
    const contract = { status: 'ACTIVE', history: [], otherIncome: 500000, probationSalaryRate: 85 };
    laborContract.applyManualEdit(contract, { otherIncome: '', probationSalaryRate: '' }, 'hr1', 'HR One');
    assert.strictEqual(contract.otherIncome, null);
    assert.strictEqual(contract.probationSalaryRate, null);
  });
}

// ===================== Phần B: HTTP thật qua routes/create.js + routes/records.js =====================
async function partB() {
  console.log('\n== Phần B: HTTP thật (Express + recordStore in-memory) — INCOME_FIELDS + probationSalaryRate ==');
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
    await test('POST /api/create/laborContracts — tạo tay kèm đủ 3 khoản thu nhập + probationSalaryRate, lưu đúng số (Number, không phải string)', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV4001', contractType: 'PROBATION', startDate: '2026-01-01', endDate: '2026-02-28',
        baseSalary: '10000000', socialInsuranceSalary: '8000000', productivityBonus: '1000000', otherIncome: '500000',
        probationSalaryRate: '85'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.socialInsuranceSalary, 8000000);
      assert.strictEqual(r.json.item.productivityBonus, 1000000);
      assert.strictEqual(r.json.item.otherIncome, 500000);
      assert.strictEqual(r.json.item.probationSalaryRate, 85);
      created = r.json.item;
    });

    await test('POST /api/create/laborContracts — không gửi field nào -> mặc định null (tuỳ chọn, không bắt buộc)', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV4001', contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31', baseSalary: '10000000'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.socialInsuranceSalary, null);
      assert.strictEqual(r.json.item.probationSalaryRate, null);
    });

    await test('POST /api/create/laborContracts — khoản thu nhập âm bị chặn 400 (extraValidate, giống phụ cấp)', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV4001', contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31',
        baseSalary: '10000000', otherIncome: '-50000'
      });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
    });

    await test('POST /api/create/laborContracts — probationSalaryRate khác 85/100 bị chặn 400 (VD 90)', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV4001', contractType: 'PROBATION', startDate: '2026-01-01', endDate: '2026-02-28',
        baseSalary: '10000000', probationSalaryRate: '90'
      });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.ok(/85 hoặc 100/.test(r.json.error), JSON.stringify(r.json));
    });

    await test('POST /api/records/laborContracts/:id/edit — sửa khoản thu nhập qua route sửa tay, KHÔNG đụng baseSalary', async () => {
      const r = await call('hr1', 'POST', `/api/records/laborContracts/${created.id}/edit`, { productivityBonus: '999000' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.productivityBonus, 999000);
      assert.strictEqual(r.json.item.baseSalary, 10000000, 'Sửa riêng khoản thu nhập không được đụng tới Lương cơ bản');
    });

    await test('POST /api/records/laborContracts/:id/edit — người không có quyền vẫn bị chặn 403 (giống mọi field khác)', async () => {
      const r = await call('emp1', 'POST', `/api/records/laborContracts/${created.id}/edit`, { otherIncome: '100000' });
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
