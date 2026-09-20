// server/tests/test-purchasing-sync-row-validation.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #7):
// POST /api/purchasing/sync (routes/purchasing.js) TRƯỚC ĐÂY bê thẳng field từ items DSmart vào
// bulkInsertPurchaseTransactions() theo lô 200 dòng dù VendorCode/StoreCode/PurchaseDate/Amount là cột
// NOT NULL (sql/schema.sql) — 1 item DSmart thiếu field sẽ làm SQL báo lỗi constraint cho CẢ LÔ đó. Nay
// validate TỪNG DÒNG trước khi đưa vào batch insert — dòng lỗi bị SKIP + ghi vào rowErrors trả về trong
// response, các dòng khác vẫn được nạp bình thường (cùng khuôn cô lập lỗi đã có ở
// parsePurchaseTransactionImportXlsx(), lib/purchasingManualImport.js).
//
// Cùng khuôn tests/test-purchasing-sync-lock-and-items.js: router THẬT (routes/purchasing.js) + server
// HTTP cục bộ giả lập DSmart.
//
// Chạy: node server/tests/test-purchasing-sync-row-validation.js
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

const MANAGER = { username: 'mh1', name: 'Nhân Viên Mua Hàng', dept: 'Phòng Mua Hàng', perms: { rebateTermManage: true }, active: true };

stubModule('lib/recordStore', {
  getAllForCollection: async () => [],
  insertRecord: async (c, r) => r,
  withLockedRecordForCollection: async (c, id, fn) => fn({ id }),
  withAppLock: async (key, fn) => fn()
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

const syncLogs = [];
let insertedRows = [];
stubModule('lib/vendorPurchaseStore', {
  bulkInsertPurchaseTransactions: async (rows) => {
    insertedRows = rows;
    return { rowsInserted: rows.length, rowsUpdated: 0, rowsSkippedDuplicate: 0 };
  },
  queryPurchaseTransactionsForVendor: async () => [],
  queryPurchaseTransactionsForExport: async () => [],
  insertPurchaseSyncLog: async (log) => { syncLogs.push(log); },
  getRecentPurchaseSyncLogs: async () => [],
  getLastSuccessfulSyncStart: async () => null
});
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
function startFakeDsmart(items) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items, hasMore: false }));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
async function callSync() {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/purchasing/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}

async function main() {
  console.log('== routes/purchasing.js POST /sync — validate từng dòng, cô lập lỗi (không hỏng cả lượt) ==');

  const items = [
    { refId: 'OK1', vendorCode: 'NCC01', storeCode: 'ST01', purchaseDate: '2026-09-01', amount: 1000000 },
    { refId: 'MISSING-VENDOR', vendorCode: '', storeCode: 'ST01', purchaseDate: '2026-09-01', amount: 1000000 },
    { refId: 'MISSING-STORE', vendorCode: 'NCC01', storeCode: '', purchaseDate: '2026-09-01', amount: 1000000 },
    { refId: 'BAD-DATE', vendorCode: 'NCC01', storeCode: 'ST01', purchaseDate: 'not-a-date', amount: 1000000 },
    { refId: 'BAD-AMOUNT', vendorCode: 'NCC01', storeCode: 'ST01', purchaseDate: '2026-09-01', amount: 'oops' },
    { refId: 'NEG-AMOUNT', vendorCode: 'NCC01', storeCode: 'ST01', purchaseDate: '2026-09-01', amount: -500 },
    { refId: 'OK2', vendorCode: 'NCC02', storeCode: 'ST02', purchaseDate: '2026-09-02', amount: 2000000 }
  ];
  const dsmart = await startFakeDsmart(items);
  process.env.DSMART_API_BASE_URL = `http://127.0.0.1:${dsmart.address().port}`;
  process.env.DSMART_API_KEY = 'test-key';

  const server = await startApp();
  try {
    await test('LỖI ĐÃ VÁ: lượt đồng bộ vẫn THÀNH CÔNG (200) dù có dòng lỗi, KHÔNG hỏng cả lượt', async () => {
      insertedRows = []; syncLogs.length = 0;
      const r = await callSync();
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    });

    await test('Chỉ đúng 2 dòng HỢP LỆ (OK1/OK2) được đưa vào bulkInsertPurchaseTransactions()', () => {
      assert.strictEqual(insertedRows.length, 2, JSON.stringify(insertedRows));
      assert.deepStrictEqual(insertedRows.map(r => r.sourceRefId).sort(), ['OK1', 'OK2']);
    });

    await test('rowErrors trả về ĐÚNG 5 dòng lỗi (thiếu vendorCode/storeCode/purchaseDate sai/amount sai/amount âm)', async () => {
      const r = await callSync();
      assert.strictEqual(r.body.rowErrors.length, 5, JSON.stringify(r.body.rowErrors));
      const refIds = r.body.rowErrors.map(e => e.refId).sort();
      assert.deepStrictEqual(refIds, ['BAD-AMOUNT', 'BAD-DATE', 'MISSING-STORE', 'MISSING-VENDOR', 'NEG-AMOUNT']);
    });

    await test('Nhật Ký Đồng Bộ ghi status PARTIAL (không phải SUCCESS thuần) khi có dòng lỗi bị bỏ qua', () => {
      const last = syncLogs[syncLogs.length - 1];
      assert.strictEqual(last.status, 'PARTIAL', JSON.stringify(last));
      assert(last.errorMessage && last.errorMessage.length > 0, 'errorMessage phải liệt kê các dòng lỗi');
    });

    await test('Toàn bộ item HỢP LỆ (không dòng lỗi nào) -> vẫn status SUCCESS như cũ (không đổi hành vi cũ)', async () => {
      dsmart.close();
      const dsmart2 = await startFakeDsmart([{ refId: 'ALL-OK', vendorCode: 'NCC01', storeCode: 'ST01', purchaseDate: '2026-09-01', amount: 1000 }]);
      process.env.DSMART_API_BASE_URL = `http://127.0.0.1:${dsmart2.address().port}`;
      syncLogs.length = 0;
      try {
        const r = await callSync();
        assert.strictEqual(r.status, 200, JSON.stringify(r.body));
        assert.strictEqual(r.body.rowErrors.length, 0);
        assert.strictEqual(syncLogs[syncLogs.length - 1].status, 'SUCCESS');
      } finally { dsmart2.close(); }
    });
  } finally {
    server.close();
    try { dsmart.close(); } catch (e) {}
  }

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
