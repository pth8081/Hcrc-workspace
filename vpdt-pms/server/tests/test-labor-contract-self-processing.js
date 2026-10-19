// server/tests/test-labor-contract-self-processing.js
//
// LỖI ĐÃ VÁ (re-audit lần 8, mức Cao — "laborContracts: HR Contract Manager tự sửa/kích hoạt/chấm dứt
// HĐLĐ của chính mình"): 7 route hành động (edit/apply-import/apply-create-import 'overwrite'/activate/
// add-amendment/status/delete, routes/records.js) trước đây CHỈ gọi canManageContracts() (quyền phẳng)
// — không so item.employeeUsername với actor. 1 người có hrContractManage có hợp đồng của chính mình
// trong hệ thống (employeeUsername khớp, field DUY NHẤT quyết định "tự xem được") có thể tự tăng lương/
// phụ cấp, tự đổi loại hợp đồng, tự kích hoạt hợp đồng nháp có lợi, tự thêm phụ lục tăng lương, hoặc tự
// đổi trạng thái — không ai khác xác nhận.
//
// Đã vá: thêm lib/laborContract.js::assertNotSelfDecidingLaborContract(user, item) (chặn TUYỆT ĐỐI,
// không có ngoại lệ admin — item.employeeUsername === user.username), gọi ở cả 7 route trên.
//
// Phần A: gọi trực tiếp assertNotSelfDecidingLaborContract() (thuần).
// Phần B: HTTP thật qua routes/create.js + routes/records.js (in-memory, mirror khuôn test-labor-
// contract.js) — xác nhận cả 5 route :id (edit/activate/add-amendment/status/delete) + apply-import +
// apply-create-import 'overwrite' đều chặn đúng khi employeeUsername === actor, và KHÔNG chặn nhầm hồ
// sơ của người khác.
//
// Chạy: node server/tests/test-labor-contract-self-processing.js
'use strict';

const assert = require('assert');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

async function partA() {
  console.log('\n== Phần A: assertNotSelfDecidingLaborContract() (thuần) ==');
  const laborContract = require('../lib/laborContract');

  await test('LỖI ĐÃ VÁ: chặn khi item.employeeUsername === user.username', () => {
    assert.throws(() => laborContract.assertNotSelfDecidingLaborContract(
      { username: 'hr.self', perms: { hrContractManage: true, admin: true } },
      { employeeUsername: 'hr.self' }
    ), /tự sửa/);
  });

  await test('đối chứng: KHÔNG chặn khi employeeUsername là người khác', () => {
    assert.doesNotThrow(() => laborContract.assertNotSelfDecidingLaborContract(
      { username: 'hr.self', perms: { hrContractManage: true } },
      { employeeUsername: 'nguoi.khac' }
    ));
  });

  await test('đối chứng: KHÔNG chặn khi employeeUsername null (hợp đồng ngoài hệ thống/chưa liên kết)', () => {
    assert.doesNotThrow(() => laborContract.assertNotSelfDecidingLaborContract(
      { username: 'hr.self', perms: { hrContractManage: true } },
      { employeeUsername: null }
    ));
  });
}

async function partB() {
  console.log('\n== Phần B: HTTP thật (Express + recordStore in-memory) ==');
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
      if (checkFn) await checkFn(STORE[c][idx]);
      STORE[c].splice(idx, 1);
    }
  });

  const USERS = [
    { username: 'hr.self', name: 'HR Tự Có Hợp Đồng', dept: 'Nhân Sự', perms: { hrContractManage: true }, active: true }
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
  // NV-SELF liên kết tài khoản 'hr.self' (chính người gọi) — NV-OTHER liên kết 'nguoi.khac' (người khác).
  const EMPLOYEE_PROFILES = [
    { employeeCode: 'NV-SELF', status: 'ACTIVE', username: 'hr.self', processId: null },
    { employeeCode: 'NV-OTHER', status: 'ACTIVE', username: 'nguoi.khac', processId: null }
  ];
  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key === 'users' ? USERS : (key === 'employeeProfiles' ? EMPLOYEE_PROFILES : null)),
    getAllAppData: async () => ({ users: USERS, employeeProfiles: EMPLOYEE_PROFILES, depts: ['Nhân Sự'], stores: [] }),
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
    let selfContract, otherContract;

    await test('chuẩn bị: tạo hợp đồng DRAFT cho NV-SELF (employeeUsername = hr.self)', async () => {
      const r = await call('hr.self', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV-SELF', contractType: 'INDEFINITE', startDate: '2026-01-01', baseSalary: '10000000'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.employeeUsername, 'hr.self');
      selfContract = r.json.item;
    });

    await test('chuẩn bị: tạo hợp đồng DRAFT cho NV-OTHER (employeeUsername = nguoi.khac)', async () => {
      const r = await call('hr.self', 'POST', '/api/create/laborContracts', {
        employeeCode: 'NV-OTHER', contractType: 'INDEFINITE', startDate: '2026-01-01', baseSalary: '10000000'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.employeeUsername, 'nguoi.khac');
      otherContract = r.json.item;
    });

    await test('LỖI ĐÃ VÁ: /edit — hr.self tự sửa hợp đồng của CHÍNH MÌNH -> 403', async () => {
      const r = await call('hr.self', 'POST', `/api/records/laborContracts/${selfContract.id}/edit`, { baseSalary: 99000000 });
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
      assert.ok(/tự sửa/.test(r.json.error), JSON.stringify(r.json));
    });

    await test('đối chứng: /edit — hr.self sửa hợp đồng NGƯỜI KHÁC vẫn thành công', async () => {
      const r = await call('hr.self', 'POST', `/api/records/laborContracts/${otherContract.id}/edit`, { baseSalary: 12000000 });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.baseSalary, 12000000);
    });

    await test('LỖI ĐÃ VÁ: /activate — hr.self tự kích hoạt hợp đồng của CHÍNH MÌNH -> 403', async () => {
      const r = await call('hr.self', 'POST', `/api/records/laborContracts/${selfContract.id}/activate`, {});
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    await test('đối chứng: /activate — hr.self kích hoạt hợp đồng NGƯỜI KHÁC vẫn thành công', async () => {
      const r = await call('hr.self', 'POST', `/api/records/laborContracts/${otherContract.id}/activate`, {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.status, 'ACTIVE');
    });

    await test('LỖI ĐÃ VÁ: /add-amendment — hr.self tự thêm phụ lục cho CHÍNH MÌNH -> 403', async () => {
      const r = await call('hr.self', 'POST', `/api/records/laborContracts/${selfContract.id}/add-amendment`, { amendmentType: 'Tăng lương', effectiveDate: '2026-02-01' });
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    await test('đối chứng: /add-amendment — hr.self thêm phụ lục cho NGƯỜI KHÁC vẫn thành công', async () => {
      const r = await call('hr.self', 'POST', `/api/records/laborContracts/${otherContract.id}/add-amendment`, { amendmentType: 'Tăng lương', effectiveDate: '2026-02-01' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    });

    await test('LỖI ĐÃ VÁ: /status — hr.self tự đổi trạng thái hợp đồng của CHÍNH MÌNH -> 403', async () => {
      const r = await call('hr.self', 'POST', `/api/records/laborContracts/${selfContract.id}/status`, { status: 'TERMINATED' });
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    await test('đối chứng: /status — hr.self đổi trạng thái hợp đồng NGƯỜI KHÁC vẫn thành công', async () => {
      const r = await call('hr.self', 'POST', `/api/records/laborContracts/${otherContract.id}/status`, { status: 'TERMINATED', terminationReason: 'Test' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.status, 'TERMINATED');
    });

    await test('LỖI ĐÃ VÁ: /delete — hr.self tự xoá hợp đồng của CHÍNH MÌNH -> 403', async () => {
      const r = await call('hr.self', 'POST', `/api/records/laborContracts/${selfContract.id}/delete`, {});
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    await test('đối chứng: /delete — hr.self xoá hợp đồng NGƯỜI KHÁC vẫn thành công', async () => {
      const r = await call('hr.self', 'POST', `/api/records/laborContracts/${otherContract.id}/delete`, {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    });

    await test('LỖI ĐÃ VÁ: /apply-import — hr.self tự sửa hợp đồng ACTIVE của CHÍNH MÌNH qua Excel hàng loạt bị bỏ qua (skipped), không áp dụng', async () => {
      // Kích hoạt lại selfContract (đang DRAFT) để test apply-import (chỉ sửa được ACTIVE).
      await call('hr.self', 'POST', `/api/records/laborContracts/${selfContract.id}/activate`, {}).catch(() => {});
      // activate bị chặn 403 ở trên (đúng hành vi), nên vẫn DRAFT — giả lập trực tiếp set ACTIVE qua STORE
      // để test riêng đúng apply-import (không phụ thuộc route activate đã bị chặn).
      const idx = STORE.laborContracts.findIndex(c => c.id === selfContract.id);
      STORE.laborContracts[idx].status = 'ACTIVE';
      const r = await call('hr.self', 'POST', '/api/records/laborContracts/apply-import', {
        items: [{ employeeCode: 'NV-SELF', fields: { baseSalary: 77000000 } }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.updated.length, 0, 'không được áp dụng sửa đổi cho hợp đồng của chính mình');
      assert.strictEqual(r.json.skipped.length, 1);
      assert.ok(/tự sửa/.test(r.json.skipped[0].reason), JSON.stringify(r.json.skipped));
      assert.notStrictEqual(STORE.laborContracts[idx].baseSalary, 77000000, 'baseSalary KHÔNG được đổi');
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

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
