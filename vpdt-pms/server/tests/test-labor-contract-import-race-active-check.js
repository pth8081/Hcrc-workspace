// server/tests/test-labor-contract-import-race-active-check.js
//
// Regression test cho Thấp#4 (đợt rà soát chuyên sâu v25.1→v25.70): routes/records.js
// POST /laborContracts/apply-import và POST /laborContracts/apply-create-import (nhánh overwrite) đọc
// "peek" KHÔNG khoá (getAllForCollection) để tìm hợp đồng ACTIVE theo employeeCode, RỒI MỚI khoá bằng
// target.id đã chụp từ bước peek đó. Giữa 2 bước này, hợp đồng có thể vừa bị đóng (TERMINATED/EXPIRED/
// SUPERSEDED) bởi 1 thao tác khác — applyManualEdit() không tự kiểm trạng thái, nên nếu không re-check
// NGAY TRONG khoá thì sẽ âm thầm sửa field lên 1 hợp đồng không còn hiệu lực. Test này giả lập race đó
// bằng cách cho "peek" trả về snapshot CŨ (còn ACTIVE) trong khi bản ghi thật trong STORE đã bị đóng
// trước khi khoá chạy, xác nhận route phải skip rõ ràng thay vì áp field mới lên bản ghi đã đóng.
'use strict';

const assert = require('assert');
const path = require('path');
const express = require('express');
const http = require('http');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

async function main() {
  console.log('== HTTP thật (Express + recordStore in-memory) — race "peek không khoá" khi import HĐLĐ ==');

  const STORE = { laborContracts: [] };
  // peekSnapshotOverride: khi != null, getAllForCollection('laborContracts') trả về snapshot NÀY thay vì
  // STORE thật — giả lập đúng tình huống "đọc xong rồi mới khoá": giữa lúc peek thấy ACTIVE và lúc khoá
  // chạy, bản ghi thật trong STORE đã bị đổi trạng thái bởi 1 thao tác khác.
  let peekSnapshotOverride = null;
  stubModule('lib/recordStore', {
    MIGRATED_COLLECTIONS: new Set(['laborContracts']),
    getAllForCollection: async (c) => (c === 'laborContracts' && peekSnapshotOverride) ? peekSnapshotOverride.slice() : STORE[c].slice(),
    getAllForCollectionCached: async (c) => STORE[c].slice(),
    getTrashItems: async () => [],
    withAppLock: async (key, fn) => fn(),
    createForCollection: async (c, builderFn) => { const draft = await builderFn(); const item = Object.assign({ id: STORE[c].length + 1 }, draft); STORE[c].push(item); return item; },
    createForCollectionSerialized: async (c, lockKey, builderFn) => { const draft = await builderFn(STORE[c].slice()); const item = Object.assign({ id: STORE[c].length + 1 }, draft); STORE[c].push(item); return item; },
    withLockedRecordForCollection: async (c, id, mutatorFn) => {
      // Mô phỏng đúng hành vi thật của lib/recordStore.js: mutatorFn luôn nhận bản ghi MỚI NHẤT trong
      // STORE (đọc lại theo id ngay trong khoá), KHÔNG phải snapshot đã chụp từ bước peek trước đó.
      const idx = STORE[c].findIndex(x => x.id === Number(id));
      if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
      const result = await mutatorFn(STORE[c][idx]);
      STORE[c][idx] = result;
      return result;
    },
    deleteRecordForCollection: async () => {}
  });

  const PROFILES = [{ employeeCode: 'NV9001', username: null, processId: null }];
  const USERS = [{ username: 'hr1', name: 'Nhân Sự Một', dept: 'Nhân Sự', perms: { hrContractManage: true }, active: true }];
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
  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key === 'users' ? USERS : null),
    getAllAppData: async () => ({ users: USERS, employeeProfiles: PROFILES, laborContracts: STORE.laborContracts, depts: [], stores: [], formTemplates: {} }),
    withLockedAppDataValue: async (key, fn) => fn(key === 'users' ? USERS : [])
  });

  const laborContract = require('../lib/laborContract');
  const recordRoutes = require('../routes/records');
  const app = express();
  app.use(express.json());
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
    STORE.laborContracts.push(laborContract.defaultContract({
      id: 1, employeeCode: 'NV9001', code: 'HDLD-NV9001-1', status: 'ACTIVE',
      contractType: 'PROBATION', startDate: '2026-01-01', endDate: '2026-04-01', baseSalary: 8000000
    }));

    await test('apply-import: hợp đồng vừa bị đóng giữa lúc peek và lúc khoá -> skip rõ ràng, KHÔNG sửa field', async () => {
      // Chụp snapshot "cũ" lúc còn ACTIVE để route dùng làm kết quả peek...
      peekSnapshotOverride = STORE.laborContracts.map(c => ({ ...c }));
      // ...rồi mô phỏng 1 thao tác khác đóng hẳn hợp đồng NGAY SAU bước peek (trước khi route khoá).
      STORE.laborContracts[0].status = 'TERMINATED';
      try {
        const r = await call('hr1', 'POST', '/api/records/laborContracts/apply-import', {
          items: [{ employeeCode: 'NV9001', fields: { baseSalary: 99999999 } }]
        });
        assert.strictEqual(r.status, 200, JSON.stringify(r.json));
        assert.strictEqual(r.json.updated.length, 0, 'KHÔNG được coi là đã cập nhật thành công');
        assert.strictEqual(r.json.skipped.length, 1);
        assert.strictEqual(r.json.skipped[0].employeeCode, 'NV9001');
        assert.ok(/không còn ở trạng thái ĐANG HIỆU LỰC/.test(r.json.skipped[0].reason), r.json.skipped[0].reason);
        assert.strictEqual(STORE.laborContracts[0].baseSalary, 8000000, 'field KHÔNG được áp lên hợp đồng đã đóng');
      } finally {
        peekSnapshotOverride = null;
      }
    });

    await test('apply-create-import (overwrite): hợp đồng vừa bị đóng giữa lúc peek và lúc khoá -> skip rõ ràng, KHÔNG sửa field', async () => {
      STORE.laborContracts[0].status = 'ACTIVE'; // phục hồi để test độc lập
      peekSnapshotOverride = STORE.laborContracts.map(c => ({ ...c }));
      STORE.laborContracts[0].status = 'SUPERSEDED';
      try {
        const r = await call('hr1', 'POST', '/api/records/laborContracts/apply-create-import', {
          items: [{ employeeCode: 'NV9001', action: 'overwrite', fields: { baseSalary: 123456789 } }]
        });
        assert.strictEqual(r.status, 200, JSON.stringify(r.json));
        assert.strictEqual(r.json.updated.length, 0, 'KHÔNG được coi là đã cập nhật thành công');
        assert.strictEqual(r.json.skipped.length, 1);
        assert.ok(/không còn ở trạng thái ĐANG HIỆU LỰC/.test(r.json.skipped[0].reason), r.json.skipped[0].reason);
        assert.strictEqual(STORE.laborContracts[0].baseSalary, 8000000, 'field KHÔNG được áp lên hợp đồng đã đóng');
      } finally {
        peekSnapshotOverride = null;
      }
    });

    await test('apply-import: đường thường (không race) vẫn áp field đúng như cũ — không phải regression', async () => {
      STORE.laborContracts[0].status = 'ACTIVE';
      const r = await call('hr1', 'POST', '/api/records/laborContracts/apply-import', {
        items: [{ employeeCode: 'NV9001', fields: { baseSalary: 15000000 } }]
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.updated.length, 1, JSON.stringify(r.json));
      assert.strictEqual(r.json.skipped.length, 0);
      assert.strictEqual(STORE.laborContracts[0].baseSalary, 15000000);
    });
  } finally {
    server.close();
  }
}

main().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}).catch(err => { console.error('Lỗi chạy test:', err); process.exit(1); });
