// server/tests/test-labor-contract.js
//
// Test hồi quy cho module "Hợp Đồng Lao Động" (Đợt 2/4 module Nhân Sự, Phần D tài liệu thiết kế gốc).
// 2 phần:
//   A) Gọi TRỰC TIẾP lib/laborContract.js (thuần, không cần HTTP) — luật vòng đời (probation draft ->
//      activate -> post-probation decision -> next contract/terminate, offboarding termination).
//   B) Dựng 1 Express app THẬT mount routes/create.js + routes/records.js (chỉ phần laborContracts),
//      lib/recordStore.js THẬT nhưng thay getPool()/db bằng 1 mảng in-memory (không cần SQL Server thật)
//      — xác nhận API tạo tay + sửa/kích hoạt/đóng/bổ sung/xoá qua đúng đường HTTP, đúng quyền
//      hrContractManage/admin.
//
// Chạy: node server/tests/test-labor-contract.js
'use strict';

const assert = require('assert');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

// ===================== Phần A: lib/laborContract.js thuần =====================
async function partA() {
  console.log('\n== Phần A: lib/laborContract.js (thuần) ==');
  const laborContract = require('../lib/laborContract');

  await test('buildProbationDraftPayload() tạo đúng bản nháp PROBATION, idempotent nếu đã có', () => {
    const hrProcess = { id: 100, employeeCode: 'NV3001', startDate: '2026-01-05', targetEndDate: '2026-03-06', employeeDept: 'Kinh Doanh' };
    const list = [];
    const draft = laborContract.buildProbationDraftPayload(hrProcess, list);
    assert.strictEqual(draft.contractType, 'PROBATION');
    assert.strictEqual(draft.status, 'DRAFT');
    assert.strictEqual(draft.employeeCode, 'NV3001');
    assert.strictEqual(draft.hrProcessId, 100);
    assert.strictEqual(draft.code, 'HDLD-NV3001-1');
    // Idempotent: nếu đã tồn tại 1 hợp đồng cho process này -> trả về null (không tạo trùng)
    list.push(Object.assign({ id: 1 }, draft));
    const draft2 = laborContract.buildProbationDraftPayload(hrProcess, list);
    assert.strictEqual(draft2, null, 'Không được tạo trùng bản nháp cho cùng 1 quy trình');
  });

  await test('applyActivateProbation() DRAFT -> ACTIVE, idempotent nếu đã ACTIVE', () => {
    const contract = { status: 'DRAFT', history: [], startDate: null };
    const hrProcess = { startDate: '2026-01-06' };
    laborContract.applyActivateProbation(contract, hrProcess);
    assert.strictEqual(contract.status, 'ACTIVE');
    assert.strictEqual(contract.startDate, '2026-01-06');
    assert.strictEqual(contract.history.length, 1);
    laborContract.applyActivateProbation(contract, hrProcess); // gọi lại lần 2
    assert.strictEqual(contract.history.length, 1, 'Không kích hoạt lại lần 2 (idempotent)');
  });

  await test('applyPostProbationDecision(SIGN_OFFICIAL) đóng PROBATION -> SUPERSEDED, tạo FIXED_TERM DRAFT renewalIndex=1', () => {
    const contract = { id: 1, employeeCode: 'NV3001', hrProcessId: 100, contractType: 'PROBATION', renewalIndex: 0, status: 'ACTIVE', history: [], dept: 'Kinh Doanh' };
    const list = [contract];
    const { closedContract, nextContractPayload } = laborContract.applyPostProbationDecision(contract, 'SIGN_OFFICIAL', list, 'hr1');
    assert.strictEqual(closedContract.status, 'SUPERSEDED');
    assert(nextContractPayload, 'Phải tạo hợp đồng kế tiếp');
    assert.strictEqual(nextContractPayload.contractType, 'FIXED_TERM');
    assert.strictEqual(nextContractPayload.renewalIndex, 1);
    assert.strictEqual(nextContractPayload.status, 'DRAFT');
    assert.strictEqual(nextContractPayload.endDate, null, 'HR điền ngày hết hạn cụ thể sau, chưa có sẵn');
  });

  await test('applyPostProbationDecision(TERMINATE) đóng PROBATION -> TERMINATED, không tạo hợp đồng kế tiếp', () => {
    const contract = { id: 2, employeeCode: 'NV3002', hrProcessId: 101, contractType: 'PROBATION', renewalIndex: 0, status: 'ACTIVE', history: [] };
    const { closedContract, nextContractPayload } = laborContract.applyPostProbationDecision(contract, 'TERMINATE', [contract], 'hr1');
    assert.strictEqual(closedContract.status, 'TERMINATED');
    assert.strictEqual(nextContractPayload, null);
  });

  await test('applyPostProbationDecision từ chối hợp đồng không ACTIVE (đã xử lý trước đó)', () => {
    const contract = { id: 3, status: 'SUPERSEDED', history: [] };
    assert.throws(() => laborContract.applyPostProbationDecision(contract, 'SIGN_OFFICIAL', [contract], 'hr1'), /đang hiệu lực/);
  });

  await test('applyPostProbationDecision từ chối quyết định không hợp lệ', () => {
    const contract = { id: 4, status: 'ACTIVE', history: [] };
    assert.throws(() => laborContract.applyPostProbationDecision(contract, 'EXTEND', [contract], 'hr1'), /không hợp lệ/);
  });

  await test('applyManualEdit() không tự đổi renewalIndex (chỉ đổi qua service riêng)', () => {
    const contract = { id: 5, contractType: 'FIXED_TERM', renewalIndex: 2, status: 'ACTIVE', history: [], startDate: '2026-01-01', endDate: '2026-06-01' };
    laborContract.applyManualEdit(contract, { baseSalary: '15000000' }, 'hr1');
    assert.strictEqual(contract.renewalIndex, 2, 'applyManualEdit không được tự đổi renewalIndex');
    assert.strictEqual(contract.baseSalary, 15000000);
  });

  await test('applyOffboardingTermination() đóng hợp đồng ACTIVE khi Offboarding hoàn tất', () => {
    const contract = { status: 'ACTIVE', history: [] };
    laborContract.applyOffboardingTermination(contract, { lastWorkingDate: '2026-05-01' });
    assert.strictEqual(contract.status, 'TERMINATED');
    assert.strictEqual(contract.terminationDate, '2026-05-01');
  });

  await test('applyActivateManual() chặn kích hoạt khi thiếu endDate (FIXED_TERM)', () => {
    const contract = { status: 'DRAFT', contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: null, history: [] };
    assert.throws(() => laborContract.applyActivateManual(contract, 'hr1'), /Ngày hết hạn/);
  });

  await test('applyActivateManual() cho phép kích hoạt INDEFINITE không cần endDate', () => {
    const contract = { status: 'DRAFT', contractType: 'INDEFINITE', startDate: '2026-01-01', endDate: null, history: [] };
    laborContract.applyActivateManual(contract, 'hr1');
    assert.strictEqual(contract.status, 'ACTIVE');
  });

  await test('addAmendment() thêm đúng 1 phần tử, validate thiếu trường bắt buộc', () => {
    const contract = { amendments: [], history: [] };
    assert.throws(() => laborContract.addAmendment(contract, {}, 'hr1', 'HR One'), /Loại thay đổi/);
    laborContract.addAmendment(contract, { amendmentType: 'Tăng lương', effectiveDate: '2026-02-01', oldValue: '10tr', newValue: '12tr' }, 'hr1', 'HR One');
    assert.strictEqual(contract.amendments.length, 1);
    assert.strictEqual(contract.amendments[0].amendmentType, 'Tăng lương');
  });

  await test('canManageContracts() chỉ true với hrContractManage hoặc admin', () => {
    assert.strictEqual(laborContract.canManageContracts({ perms: {} }), false);
    assert.strictEqual(laborContract.canManageContracts({ perms: { hrContractManage: true } }), true);
    assert.strictEqual(laborContract.canManageContracts({ perms: { admin: true } }), true);
  });
}

// ===================== Phần B: HTTP thật qua routes/create.js + routes/records.js =====================
async function partB() {
  console.log('\n== Phần B: HTTP thật (Express + recordStore in-memory) ==');
  const path = require('path');
  const express = require('express');
  const http = require('http');

  // In-memory thay cho dbo.Records — mirror ĐÚNG chữ ký các hàm lib/recordStore.js mà routes/create.js
  // và routes/records.js gọi tới, xem tests/demo-hr-profile.js đầu file cho khuôn "stub module qua
  // require.cache" tương tự.
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
    { username: 'emp1', name: 'Nhân Viên Thường', dept: 'Kinh Doanh', perms: {}, active: true },
    { username: 'admin', name: 'Quản Trị Viên', dept: 'Nhân Sự', perms: { admin: true }, active: true }
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
  // NV4001 có sẵn hồ sơ (happy path chọn từ Hồ Sơ Nhân Sự đúng đường thật — xem
  // lib/createValidation.js::laborContracts.extraValidate); NV4002/NV4003 KHÔNG có hồ sơ, dùng riêng cho
  // 2 test employeeCode-phải-tồn-tại-trong-Hồ-Sơ (thêm useExternalCode: true khi bypass) ở dưới.
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
    await test('POST /api/create/laborContracts — HR tạo hợp đồng tay thành công (happy path)', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV4001', contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31', baseSalary: '10000000'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.status, 'DRAFT');
      assert.strictEqual(r.json.item.code, 'HDLD-NV4001-1');
      created = r.json.item;
    });

    await test('POST /api/create/laborContracts — HDLD-04: FIXED_TERM với renewalIndex=3 (lần gia hạn thứ 3) BỊ CHẶN 400', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV4001', contractType: 'FIXED_TERM', renewalIndex: 3, startDate: '2026-01-01', endDate: '2026-12-31', baseSalary: '10000000'
      });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.ok(/Vô thời hạn/.test(r.json.error), JSON.stringify(r.json));
    });

    await test('POST /api/create/laborContracts — HDLD-04: FIXED_TERM với renewalIndex=2 (lần gia hạn thứ 2, còn hợp lệ) KHÔNG bị chặn', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV4001', contractType: 'FIXED_TERM', renewalIndex: 2, startDate: '2026-01-01', endDate: '2026-12-31', baseSalary: '10000000'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    });

    await test('POST /api/create/laborContracts — HDLD-04: renewalIndex=3 nhưng chọn đúng INDEFINITE thì KHÔNG bị chặn', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV4001', contractType: 'INDEFINITE', renewalIndex: 3, startDate: '2026-01-01', baseSalary: '10000000'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    });

    await test('POST /api/create/laborContracts — thiếu endDate cho FIXED_TERM bị chặn 400', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', { employeeCode: 'NV4002', contractType: 'FIXED_TERM', startDate: '2026-01-01' });
      assert.strictEqual(r.status, 400);
    });

    await test('POST /api/create/laborContracts — người không có hrContractManage bị chặn 403', async () => {
      const r = await call('emp1', 'POST', '/api/create/laborContracts', { employeeCode: 'NV4003', contractType: 'INDEFINITE', startDate: '2026-01-01' });
      assert.strictEqual(r.status, 403);
    });

    await test('POST /api/create/laborContracts — Mã Nhân Viên KHÔNG có trong Hồ Sơ Nhân Sự (không tick "Không lấy từ hồ sơ") bị chặn 400', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', { employeeCode: 'NV_NGOAI_HE_THONG', contractType: 'INDEFINITE', startDate: '2026-01-01' });
      assert.strictEqual(r.status, 400);
      assert.ok(/Hồ Sơ Nhân Sự/.test(r.json.error), JSON.stringify(r.json));
    });

    await test('POST /api/create/laborContracts — tick useExternalCode:true bỏ qua kiểm tra tồn tại trong Hồ Sơ Nhân Sự', async () => {
      const r = await call('hr1', 'POST', '/api/create/laborContracts', { employeeCode: 'NV_NGOAI_HE_THONG', useExternalCode: true, contractType: 'INDEFINITE', startDate: '2026-01-01' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.employeeCode, 'NV_NGOAI_HE_THONG');
      assert.strictEqual('useExternalCode' in r.json.item, false, 'useExternalCode chỉ điều khiển validate, không được lưu vào bản ghi');
    });

    await test('POST /api/records/laborContracts/:id/edit — HR sửa endDate/baseSalary', async () => {
      const r = await call('hr1', 'POST', `/api/records/laborContracts/${created.id}/edit`, { endDate: '2027-01-31', baseSalary: 12000000 });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.endDate, '2027-01-31');
      assert.strictEqual(r.json.item.baseSalary, 12000000);
    });

    await test('POST /api/records/laborContracts/:id/activate — kích hoạt DRAFT -> ACTIVE', async () => {
      const r = await call('hr1', 'POST', `/api/records/laborContracts/${created.id}/activate`, {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.status, 'ACTIVE');
    });

    await test('POST /api/records/laborContracts/:id/add-amendment — bổ sung thay đổi', async () => {
      const r = await call('hr1', 'POST', `/api/records/laborContracts/${created.id}/add-amendment`, { amendmentType: 'Đổi vị trí', effectiveDate: '2026-03-01' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.amendments.length, 1);
    });

    await test('POST /api/records/laborContracts/:id/status — người không có quyền bị chặn 403', async () => {
      const r = await call('emp1', 'POST', `/api/records/laborContracts/${created.id}/status`, { status: 'TERMINATED' });
      assert.strictEqual(r.status, 403);
    });

    await test('POST /api/records/laborContracts/:id/status — HR đóng hợp đồng (TERMINATED)', async () => {
      const r = await call('hr1', 'POST', `/api/records/laborContracts/${created.id}/status`, { status: 'TERMINATED', terminationReason: 'Nghỉ việc tự nguyện' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.status, 'TERMINATED');
    });

    await test('POST /api/records/laborContracts/:id/delete — chỉ admin mới xoá được', async () => {
      const r1 = await call('hr1', 'POST', `/api/records/laborContracts/${created.id}/delete`, {});
      assert.strictEqual(r1.status, 403, 'HR (không phải admin) không được xoá');
      const r2 = await call('admin', 'POST', `/api/records/laborContracts/${created.id}/delete`, {});
      assert.strictEqual(r2.status, 200, JSON.stringify(r2.json));
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
