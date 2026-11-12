// server/tests/test-shelf-any-store-access.js
//
// Tính năng MỚI (11/2026, theo yêu cầu người dùng "cho tôi một cái phân quyền được phép chọn siêu thị...
// chọn siêu thị thì tự động sẽ nhảy sang siêu thị đấy") — quyền shelfAnyStoreAccess ("🔑 Được Chọn Siêu
// Thị Bất Kỳ Để Thao Tác Kiểm Soát Hàng Hóa"): người được cấp quyền này gửi kèm header
// X-Shelf-Store-Override ở mọi request Kiểm Soát Hàng Hóa để tạm đổi "siêu thị áp dụng" sang 1 siêu thị
// bất kỳ trong DB.stores — xem getShelfEffectiveUser()/getShelfEffectiveUserFromReq()
// (lib/shelfStockEdit.js), routes/create.js (3 moduleKey shelfLocations/shelfRecords/
// shelfStockThresholds) và canViewShelfScopedItem() (lib/recordViewScope.js).
//
// Chạy: node server/tests/test-shelf-any-store-access.js
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

async function testGetShelfEffectiveUser() {
  console.log('== lib/shelfStockEdit.js — getShelfEffectiveUser() (hàm thuần, không I/O) ==');
  const { getShelfEffectiveUser } = require('../lib/shelfStockEdit');
  const { HttpError } = require('../lib/httpErrors');
  const STORES = ['Siêu Thị A', 'Siêu Thị B'];
  const admin = { username: 'admin1', dept: 'Siêu Thị A', perms: { admin: true } };
  const anyStoreUser = { username: 'nv1', dept: 'Siêu Thị A', perms: { shelfAnyStoreAccess: true, shelfRecordCreate: true } };
  const normalUser = { username: 'nv2', dept: 'Siêu Thị A', perms: { shelfRecordCreate: true } };

  await test('Không có header override -> trả về NGUYÊN user (cùng reference, không đổi gì)', async () => {
    const eff = getShelfEffectiveUser(normalUser, undefined, STORES);
    assert.strictEqual(eff, normalUser);
  });
  await test('Header override rỗng ("") -> trả về NGUYÊN user, không throw', async () => {
    const eff = getShelfEffectiveUser(anyStoreUser, '', STORES);
    assert.strictEqual(eff, anyStoreUser);
  });
  await test('admin + override hợp lệ -> dept đổi sang siêu thị override, giữ nguyên username/perms', async () => {
    const eff = getShelfEffectiveUser(admin, 'Siêu Thị B', STORES);
    assert.strictEqual(eff.dept, 'Siêu Thị B');
    assert.strictEqual(eff.username, 'admin1');
    assert.strictEqual(eff.perms, admin.perms);
  });
  await test('shelfAnyStoreAccess + override hợp lệ -> dept đổi đúng siêu thị override', async () => {
    const eff = getShelfEffectiveUser(anyStoreUser, 'Siêu Thị B', STORES);
    assert.strictEqual(eff.dept, 'Siêu Thị B');
  });
  await test('override === dept hiện tại -> trả về NGUYÊN user (không tạo clone thừa)', async () => {
    const eff = getShelfEffectiveUser(anyStoreUser, 'Siêu Thị A', STORES);
    assert.strictEqual(eff, anyStoreUser);
  });
  await test('KHÔNG có quyền shelfAnyStoreAccess/admin mà vẫn gửi header -> throw HttpError 403 (lỗi RÕ, không âm thầm bỏ qua)', async () => {
    assert.throws(() => getShelfEffectiveUser(normalUser, 'Siêu Thị B', STORES), (err) => err instanceof HttpError && err.status === 403);
  });
  await test('Siêu thị override KHÔNG có trong danh mục (DB.stores) -> throw HttpError 400', async () => {
    assert.throws(() => getShelfEffectiveUser(anyStoreUser, 'Siêu Thị Không Tồn Tại', STORES), (err) => err instanceof HttpError && err.status === 400);
  });
}

async function testCanViewShelfScopedItem() {
  console.log('\n== lib/recordViewScope.js — canViewShelfScopedItem(): shelfAnyStoreAccess XEM được MỌI siêu thị ==');
  const { canViewShelfLocation, canViewShelfRecord, canViewShelfStockThreshold } = require('../lib/recordViewScope');
  const anyStoreUser = { username: 'nv1', dept: 'Siêu Thị A', perms: { shelfAnyStoreAccess: true } };
  const normalUser = { username: 'nv2', dept: 'Siêu Thị A', perms: { shelfRecordCreate: true } };
  const itemOtherStore = { dept: 'Siêu Thị B' };
  await test('shelfAnyStoreAccess -> canViewShelfLocation() TRUE dù item thuộc siêu thị khác', async () => {
    assert.strictEqual(canViewShelfLocation(anyStoreUser, itemOtherStore), true);
  });
  await test('shelfAnyStoreAccess -> canViewShelfRecord()/canViewShelfStockThreshold() cũng TRUE', async () => {
    assert.strictEqual(canViewShelfRecord(anyStoreUser, itemOtherStore), true);
    assert.strictEqual(canViewShelfStockThreshold(anyStoreUser, itemOtherStore), true);
  });
  await test('đối chứng: user THƯỜNG (không shelfAnyStoreAccess/shelfReportView) KHÔNG xem được siêu thị khác', async () => {
    assert.strictEqual(canViewShelfLocation(normalUser, itemOtherStore), false);
  });
}

async function testCreateRouteOverride() {
  console.log('\n== routes/create.js — POST /api/create/shelfRecords với header X-Shelf-Store-Override ==');
  const STORE = { shelfRecords: [], shelfLocations: [{ id: 1, dept: 'Siêu Thị A', code: 'QA1', name: 'Quầy A1', active: true }, { id: 2, dept: 'Siêu Thị B', code: 'QB1', name: 'Quầy B1', active: true }] };
  let nextId = 1;
  stubModule('lib/recordStore', {
    MIGRATED_COLLECTIONS: new Set(),
    getAllForCollection: async (c) => (STORE[c] || []).slice(),
    getAllForCollectionCached: async (c) => (STORE[c] || []).slice(),
    getTrashItems: async () => [],
    withAppLock: async (key, fn) => fn(),
    createForCollection: async (c, builderFn) => {
      const draft = await builderFn((STORE[c] || []).slice());
      const item = Object.assign({ id: nextId++ }, draft);
      STORE[c].push(item);
      return item;
    },
    createForCollectionSerialized: async (c, lockKey, builderFn) => {
      const draft = await builderFn((STORE[c] || []).slice());
      const item = Object.assign({ id: nextId++ }, draft);
      STORE[c].push(item);
      return item;
    },
    withLockedRecordForCollection: async (c, id, mutatorFn) => {
      const list = STORE[c] || [];
      const idx = list.findIndex(x => x.id === Number(id));
      if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
      list[idx] = await mutatorFn(list[idx]);
      return list[idx];
    }
  });
  stubModule('lib/systemLogStore', { insertSystemLog: async () => {}, querySystemLogs: async () => ({ items: [], total: 0 }) });

  const USERS = [
    { username: 'nvAny', name: 'NV Có Quyền Đặc Biệt', dept: 'Siêu Thị A', perms: { shelfRecordCreate: true, shelfAnyStoreAccess: true }, active: true },
    { username: 'nvNormal', name: 'NV Thường', dept: 'Siêu Thị A', perms: { shelfRecordCreate: true }, active: true },
    { username: 'admin1', name: 'Admin', dept: 'Siêu Thị A', perms: { admin: true }, active: true }
  ];
  let APP_DATA;
  function resetAppData() {
    APP_DATA = { users: USERS, depts: [], stores: ['Siêu Thị A', 'Siêu Thị B'], formTemplates: [] };
    STORE.shelfRecords = []; nextId = 1;
  }
  resetAppData();
  stubModule('lib/appData', {
    getAppDataValue: async (key) => (APP_DATA[key] !== undefined ? APP_DATA[key] : null),
    getAppDataValueCached: async (key) => (APP_DATA[key] !== undefined ? APP_DATA[key] : null),
    getAllAppData: async () => Object.assign({}, APP_DATA, { shelfLocations: STORE.shelfLocations }),
    withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
  });
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

  const createRoutes = require('../routes/create');
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, body, overrideDept) {
    const headers = { 'x-demo-user': username, 'Content-Type': 'application/json' };
    // encodeURIComponent() — mô phỏng ĐÚNG hành vi client thật (shelfFetch()/callCreateAction(),
    // module-vanhanh.js/core.js): header HTTP không nhận thẳng được tên siêu thị tiếng Việt có dấu.
    if (overrideDept !== undefined) headers['X-Shelf-Store-Override'] = encodeURIComponent(overrideDept);
    const res = await fetch(`${base}/api/create/shelfRecords`, { method: 'POST', headers, body: JSON.stringify(body) });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }
  const basePayload = { shelfLocationId: 2, productName: 'Sản Phẩm B', quantity: 5, clientRecordId: '' };

  try {
    await test('nvAny (shelfAnyStoreAccess) + header="Siêu Thị B" -> record.dept = "Siêu Thị B" (KHÔNG phải dept thật)', async () => {
      resetAppData();
      const r = await call('nvAny', basePayload, 'Siêu Thị B');
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.dept, 'Siêu Thị B');
      assert.strictEqual(r.json.item.creator, 'nvAny', 'creator vẫn là người THẬT tạo, không đổi theo override');
    });
    await test('nvAny KHÔNG gửi header -> vẫn tạo ở ĐÚNG dept thật của mình (không regression)', async () => {
      resetAppData();
      const r = await call('nvAny', { ...basePayload, shelfLocationId: 1 });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.dept, 'Siêu Thị A');
    });
    await test('nvNormal (CÓ shelfRecordCreate, KHÔNG có shelfAnyStoreAccess) gửi header -> 403, không tạo được gì', async () => {
      resetAppData();
      const r = await call('nvNormal', basePayload, 'Siêu Thị B');
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
      assert.strictEqual(STORE.shelfRecords.length, 0);
    });
    await test('nvNormal KHÔNG gửi header -> vẫn tạo bình thường ở dept mình (không bị ảnh hưởng bởi tính năng mới)', async () => {
      resetAppData();
      const r = await call('nvNormal', { ...basePayload, shelfLocationId: 1 });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.dept, 'Siêu Thị A');
    });
    await test('admin + header="Siêu Thị B" -> cũng tạo đúng ở "Siêu Thị B" (admin luôn được override)', async () => {
      resetAppData();
      const r = await call('admin1', basePayload, 'Siêu Thị B');
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.dept, 'Siêu Thị B');
    });
    await test('nvAny + header = siêu thị KHÔNG có trong danh mục -> 400, không tạo được gì', async () => {
      resetAppData();
      const r = await call('nvAny', basePayload, 'Siêu Thị Ma');
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.strictEqual(STORE.shelfRecords.length, 0);
    });
    await test('SHELF_ANY_STORE_MODULE_KEYS CHỈ đúng 3 moduleKey (không rò rỉ sang ~45 module khác dùng chung routes/create.js)', async () => {
      const src = require('fs').readFileSync(path.join(__dirname, '..', 'routes', 'create.js'), 'utf8');
      const m = src.match(/SHELF_ANY_STORE_MODULE_KEYS = new Set\((\[[^\]]*\])\)/);
      assert.ok(m, 'phải tìm thấy khai báo SHELF_ANY_STORE_MODULE_KEYS');
      const keys = JSON.parse(m[1].replace(/'/g, '"'));
      assert.deepStrictEqual(keys.sort(), ['shelfLocations', 'shelfRecords', 'shelfStockThresholds'].sort());
    });
  } finally {
    server.close();
  }
}

async function main() {
  await testGetShelfEffectiveUser();
  await testCanViewShelfScopedItem();
  await testCreateRouteOverride();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
