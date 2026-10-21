// server/tests/test-labor-contract-types-catalog.js
//
// Regression test cho danh mục "Loại HĐLĐ" tự cấu hình (11/2026, theo yêu cầu người dùng — "loại hợp
// đồng Dự kiến đang chưa có trong danh mục, cho vào danh mục cho chuẩn", dùng CHUNG cho CẢ "Loại HĐLĐ
// Dự Kiến" (hrProcesses.plannedContractType, Onboarding) lẫn "Loại Hợp Đồng" thật
// (laborContracts.contractType) — xem defaults.js::laborContractTypes).
//
// 3 phần:
//   A) lib/createValidation.js::assertLaborContractTypesSafeToSave() thuần — chặn xoá mã hệ thống +
//      chặn xoá loại đang dùng (hrProcesses/laborContracts), cho phép xoá loại tuỳ biến KHÔNG dùng.
//   B) lib/laborContract.js::applyManualEdit() — tham số thứ 5 (extraValidTypeIds) tuỳ chọn: không
//      truyền vẫn giữ ĐÚNG hành vi cũ (chỉ 3 mã hệ thống); truyền thêm id tuỳ biến thì chấp nhận.
//   C) HTTP thật (Express + recordStore in-memory, cùng khuôn test-labor-contract-income-fields.js) —
//      POST /api/create/laborContracts VÀ POST /api/create/hrProcesses chấp nhận loại tuỳ biến đã khai
//      báo trong appData.laborContractTypes, vẫn từ chối loại KHÔNG có trong danh mục; luật "tối đa 2
//      lần gia hạn Xác Định Thời Hạn" vẫn CHỈ áp cho đúng mã FIXED_TERM hệ thống, không áp cho loại tự
//      thêm.
//
// Chạy: node server/tests/test-labor-contract-types-catalog.js
'use strict';

const assert = require('assert');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

const CUSTOM_TYPE = { id: 'CUSTOM_SEASONAL', label: 'Hợp đồng thời vụ', isSystemDefault: false, order: 3 };
const CATALOG = [
  { id: 'PROBATION', label: 'Thử việc', isSystemDefault: true, order: 0 },
  { id: 'FIXED_TERM', label: 'Xác định thời hạn', isSystemDefault: true, order: 1 },
  { id: 'INDEFINITE', label: 'Vô thời hạn', isSystemDefault: true, order: 2 },
  CUSTOM_TYPE
];

// ===================== Phần A: assertLaborContractTypesSafeToSave() thuần =====================
async function partA() {
  console.log('\n== Phần A: lib/createValidation.js::assertLaborContractTypesSafeToSave() (thuần) ==');
  const { assertLaborContractTypesSafeToSave } = require('../lib/createValidation');

  await test('Xoá 1 trong 3 mã hệ thống -> chặn 400, dù không ai đang dùng', () => {
    const next = CATALOG.filter(t => t.id !== 'FIXED_TERM');
    assert.throws(() => assertLaborContractTypesSafeToSave(next, CATALOG, [], []), /mặc định hệ thống/);
  });

  await test('Xoá loại tuỳ biến ĐANG được hrProcesses.plannedContractType tham chiếu -> chặn 400', () => {
    const next = CATALOG.filter(t => t.id !== 'CUSTOM_SEASONAL');
    const hrProcesses = [{ id: 1, plannedContractType: 'CUSTOM_SEASONAL' }];
    assert.throws(() => assertLaborContractTypesSafeToSave(next, CATALOG, hrProcesses, []), /tham chiếu/);
  });

  await test('Xoá loại tuỳ biến ĐANG được laborContracts.contractType tham chiếu -> chặn 400', () => {
    const next = CATALOG.filter(t => t.id !== 'CUSTOM_SEASONAL');
    const laborContracts = [{ id: 1, contractType: 'CUSTOM_SEASONAL' }];
    assert.throws(() => assertLaborContractTypesSafeToSave(next, CATALOG, [], laborContracts), /tham chiếu/);
  });

  await test('Xoá loại tuỳ biến KHÔNG ai dùng -> cho phép (không throw)', () => {
    const next = CATALOG.filter(t => t.id !== 'CUSTOM_SEASONAL');
    assert.doesNotThrow(() => assertLaborContractTypesSafeToSave(next, CATALOG, [], []));
  });

  await test('Chỉ ĐỔI LABEL (giữ nguyên mọi id) -> không throw, không cần đối chiếu tham chiếu gì', () => {
    const next = CATALOG.map(t => (t.id === 'CUSTOM_SEASONAL' ? { ...t, label: 'Hợp đồng mùa vụ' } : t));
    assert.doesNotThrow(() => assertLaborContractTypesSafeToSave(next, CATALOG, [{ plannedContractType: 'CUSTOM_SEASONAL' }], []));
  });

  await test('Thêm loại MỚI (không xoá gì) -> không throw', () => {
    const next = [...CATALOG, { id: 'CUSTOM_PARTTIME', label: 'Bán thời gian', isSystemDefault: false, order: 4 }];
    assert.doesNotThrow(() => assertLaborContractTypesSafeToSave(next, CATALOG, [], []));
  });
}

// ===================== Phần B: applyManualEdit() tham số extraValidTypeIds =====================
async function partB() {
  console.log('\n== Phần B: lib/laborContract.js::applyManualEdit() — extraValidTypeIds (thuần) ==');
  const laborContract = require('../lib/laborContract');

  await test('Không truyền extraValidTypeIds (4 tham số, ĐÚNG khuôn cũ) -> vẫn chấp nhận 3 mã hệ thống', () => {
    const contract = { status: 'ACTIVE', history: [], contractType: 'PROBATION' };
    laborContract.applyManualEdit(contract, { contractType: 'FIXED_TERM' }, 'hr1', 'HR One');
    assert.strictEqual(contract.contractType, 'FIXED_TERM');
  });

  await test('Không truyền extraValidTypeIds -> từ chối loại tuỳ biến (giữ ĐÚNG hành vi cũ, không bị nới lỏng ngoài ý muốn)', () => {
    const contract = { status: 'ACTIVE', history: [], contractType: 'PROBATION' };
    assert.throws(() => laborContract.applyManualEdit(contract, { contractType: 'CUSTOM_SEASONAL' }, 'hr1', 'HR One'), /không hợp lệ/);
  });

  await test('Truyền extraValidTypeIds có "CUSTOM_SEASONAL" -> chấp nhận', () => {
    const contract = { status: 'ACTIVE', history: [], contractType: 'PROBATION' };
    laborContract.applyManualEdit(contract, { contractType: 'CUSTOM_SEASONAL' }, 'hr1', 'HR One', ['CUSTOM_SEASONAL']);
    assert.strictEqual(contract.contractType, 'CUSTOM_SEASONAL');
  });

  await test('Truyền extraValidTypeIds nhưng gõ loại KHÔNG có trong đó -> vẫn chặn 400', () => {
    const contract = { status: 'ACTIVE', history: [], contractType: 'PROBATION' };
    assert.throws(() => laborContract.applyManualEdit(contract, { contractType: 'KHONG_TON_TAI' }, 'hr1', 'HR One', ['CUSTOM_SEASONAL']), /không hợp lệ/);
  });
}

// ===================== Phần C: HTTP thật (Express + recordStore in-memory) =====================
async function partC() {
  console.log('\n== Phần C: HTTP thật — POST /api/create/laborContracts + /api/create/hrProcesses chấp nhận loại tuỳ biến ==');
  const path = require('path');
  const express = require('express');
  const http = require('http');

  const STORE = { laborContracts: [], hrProcesses: [] };
  let nextId = 1;
  function stubModule(relPath, exportsObj) {
    const full = require.resolve(path.join(__dirname, '..', relPath));
    require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
    return exportsObj;
  }
  stubModule('lib/recordStore', {
    MIGRATED_COLLECTIONS: new Set(['laborContracts', 'hrProcesses']),
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
    { username: 'hr1', name: 'Nhân Sự Một', dept: 'Nhân Sự', perms: { hrContractManage: true, hrOnboardingManage: true }, active: true }
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
  const EMPLOYEE_PROFILES = [{ employeeCode: 'NV5001', status: 'ACTIVE', username: null, processId: null }];
  stubModule('lib/appData', {
    getAppDataValue: async (key) => {
      if (key === 'users') return USERS;
      if (key === 'employeeProfiles') return EMPLOYEE_PROFILES;
      if (key === 'laborContractTypes') return CATALOG;
      return null;
    },
    getAllAppData: async () => ({ users: USERS, employeeProfiles: EMPLOYEE_PROFILES, depts: ['Nhân Sự'], stores: [], jobTitles: ['NV'], laborContractTypes: CATALOG, hrTaskTemplates: [] }),
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
    await test('POST /api/create/laborContracts — contractType = loại TUỲ BIẾN có trong danh mục -> tạo thành công (trước đây sẽ bị 400)', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV5001', contractType: 'CUSTOM_SEASONAL', startDate: '2026-01-01', endDate: '2026-06-30', baseSalary: '10000000'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.contractType, 'CUSTOM_SEASONAL');
    });

    await test('POST /api/create/laborContracts — contractType KHÔNG có trong danh mục -> vẫn chặn 400', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV5001', contractType: 'KHONG_TON_TAI', startDate: '2026-01-01', endDate: '2026-06-30', baseSalary: '10000000'
      });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
    });

    await test('POST /api/create/laborContracts — contractType=FIXED_TERM + renewalIndex=3 -> VẪN chặn 400 (luật pháp luật không đổi)', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV5001', contractType: 'FIXED_TERM', renewalIndex: 3, startDate: '2026-01-01', endDate: '2026-06-30', baseSalary: '10000000'
      });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.ok(/tối đa 2 lần/.test(r.json.error), r.json.error);
    });

    await test('POST /api/create/laborContracts — contractType=CUSTOM_SEASONAL + renewalIndex=5 -> KHÔNG áp giới hạn gia hạn (theo đúng xác nhận người dùng "để tự do")', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV5001', contractType: 'CUSTOM_SEASONAL', renewalIndex: 5, startDate: '2026-01-01', endDate: '2026-06-30', baseSalary: '10000000'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.renewalIndex, 5);
    });

    await test('POST /api/create/hrProcesses — plannedContractType = loại TUỲ BIẾN -> chấp nhận (Onboarding "dự kiến", nhân viên mới nên để trống Mã Nhân Viên)', async () => {
      const r = await call('hr1', 'POST', '/api/create/hrProcesses', {
        processType: 'ONBOARDING', employeePosType: 'HO', fullName: 'Nguyễn Văn Mới', employeeDept: 'Nhân Sự', employeeJobTitle: 'NV',
        phone: '0909123456', startDate: '2026-02-01', plannedContractType: 'CUSTOM_SEASONAL'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.plannedContractType, 'CUSTOM_SEASONAL');
    });

    await test('POST /api/create/hrProcesses — plannedContractType KHÔNG có trong danh mục -> chặn 400', async () => {
      const r = await call('hr1', 'POST', '/api/create/hrProcesses', {
        processType: 'ONBOARDING', fullName: 'Nguyễn Văn Khác', dept: 'Nhân Sự', jobTitle: 'NV',
        startDate: '2026-02-01', plannedContractType: 'KHONG_TON_TAI'
      });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
    });
  } finally {
    server.close();
  }
}

(async () => {
  await partA();
  await partB();
  await partC();
  console.log(failed ? `\n${passed}/${passed + failed} passed, ${failed} FAILED` : `\n==== ${passed}/${passed} passed ====`);
  if (failed) process.exitCode = 1;
})();
