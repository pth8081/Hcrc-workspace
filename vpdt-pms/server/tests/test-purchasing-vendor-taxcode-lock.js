// server/tests/test-purchasing-vendor-taxcode-lock.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Thấp — phát hiện #12):
// POST /api/purchasing/vendors/:id/edit TRƯỚC ĐÂY đọc getAllForCollection('vendors') + kiểm trùng Mã Số
// Thuế NGOÀI khoá ghi, rồi mới withLockedRecordForCollection() — đọc XONG mới khoá nên 2 request sửa 2
// NCC KHÁC NHAU thành CÙNG 1 taxCode gần như đồng thời đều đọc được "chưa ai trùng MST" trước khi cái
// nào kịp ghi, cả 2 đều qua rồi cùng ghi -> 2 NCC trùng MST (KHÔNG có UNIQUE INDEX cấp DB cho TaxCode vì
// field optional). Đã vá: bọc TOÀN BỘ đọc-kiểm tra-ghi trong 1 khoá chung withAppLock('vendors_write').
//
// Cùng khuôn tests/test-purchasing-manual-import-lock.js — withAppLock giả lập có tuần tự hoá THẬT (chờ
// thay vì 409 ngay), trễ nhân tạo để mở cửa sổ đua thật.
//
// Chạy: node server/tests/test-purchasing-vendor-taxcode-lock.js
'use strict';
const http = require('http');
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

const MANAGER = { username: 'mh1', name: 'NV Mua Hàng', dept: 'Phòng Mua Hàng', perms: { rebateTermManage: true }, active: true };

let STORE;
function resetStore() {
  STORE = {
    vendors: [
      { id: 1, vendorCode: 'NCC01', vendorName: 'NCC Một', taxCode: '', status: 'ACTIVE' },
      { id: 2, vendorCode: 'NCC02', vendorName: 'NCC Hai', taxCode: '', status: 'ACTIVE' }
    ]
  };
}
resetStore();

const { HttpError } = require('../lib/httpErrors');
const lockQueues = new Map();
const recordedKeys = [];
function fakeWithAppLock(key, fn) {
  const primaryKey = Array.isArray(key) ? key.join('|') : key;
  recordedKeys.push(primaryKey);
  const prev = lockQueues.get(primaryKey) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  lockQueues.set(primaryKey, prev.then(() => gate));
  return prev.then(async () => {
    // Trễ nhân tạo nhỏ để mở cửa sổ đua thật giữa lúc đọc "chưa ai trùng MST" và lúc ghi — nếu route
    // KHÔNG khoá đúng (đọc ngoài khoá), 2 request sẽ cùng lọt qua đúng cửa sổ này.
    try { await new Promise((r) => setTimeout(r, 30)); return await fn(); } finally { release(); }
  });
}
stubModule('lib/recordStore', {
  getAllForCollection: async (c) => (STORE[c] || []).slice(),
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = STORE[c] || [];
    const idx = list.findIndex((x) => x.id === Number(id));
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy bản ghi');
    const result = await mutatorFn(list[idx]);
    list[idx] = result;
    return result;
  },
  withAppLock: fakeWithAppLock,
  getTrashItems: async () => []
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
stubModule('lib/auth', {
  requireAuth: (req, res, next) => { req.user = { username: MANAGER.username, name: MANAGER.name }; req.freshUser = MANAGER; next(); },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const purchasingRoutes = require('../routes/purchasing');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/purchasing', purchasingRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}
async function api(urlPath, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function main() {
  console.log('== POST /api/purchasing/vendors/:id/edit — kiểm trùng MST BÊN TRONG khoá ghi ==');
  const server = await startApp();
  try {
    await test('LỖI ĐÃ VÁ: 2 NCC KHÁC NHAU sửa CÙNG 1 taxCode gần như đồng thời -> chỉ 1 lượt thành công, KHÔNG được cả 2 cùng trùng MST', async () => {
      resetStore();
      lockQueues.clear(); recordedKeys.length = 0;
      const [a, b] = await Promise.all([
        api('/api/purchasing/vendors/1/edit', { vendorCode: 'NCC01', vendorName: 'NCC Một', taxCode: '0123456789' }),
        api('/api/purchasing/vendors/2/edit', { vendorCode: 'NCC02', vendorName: 'NCC Hai', taxCode: '0123456789' })
      ]);
      const statuses = [a.status, b.status].sort();
      assert.deepStrictEqual(statuses, [200, 409],
        `Phải có đúng 1 lượt 200 + 1 lượt 409 (trùng MST), nhận ${JSON.stringify(statuses)} — ${JSON.stringify([a.body, b.body])}`);
      const withTaxCode = STORE.vendors.filter((v) => v.taxCode === '0123456789');
      assert.strictEqual(withTaxCode.length, 1, `Chỉ đúng 1 NCC được gán MST này, nhận ${withTaxCode.length}: ${JSON.stringify(withTaxCode)}`);
    });

    await test('Cả 2 request dùng CHUNG khoá "vendors_write" (đúng điều kiện để tuần tự hoá thật)', () => {
      assert(recordedKeys.length >= 2, JSON.stringify(recordedKeys));
      assert(recordedKeys.every((k) => k === 'vendors_write'), JSON.stringify(recordedKeys));
    });

    await test('Sửa NCC với MST KHÔNG trùng ai -> vẫn hoạt động bình thường như cũ', async () => {
      resetStore();
      const r = await api('/api/purchasing/vendors/1/edit', { vendorCode: 'NCC01', vendorName: 'NCC Một Mới', taxCode: '9999999999' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(STORE.vendors[0].taxCode, '9999999999');
    });
  } finally {
    server.close();
  }

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
