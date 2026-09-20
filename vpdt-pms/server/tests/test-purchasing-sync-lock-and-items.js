// server/tests/test-purchasing-sync-lock-and-items.js
//
// 2 LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm — cụm "Mua Hàng BAS"):
//  1. (mức Cao) POST /api/purchasing/sync KHÔNG có khoá chống chạy chồng — chỉ rate-limit theo username
//     (6 lượt/15 phút/người) nên 2 người có quyền (hoặc 1 người mở 2 tab) bấm gần như cùng lúc là 2 lượt
//     đồng bộ CHẠY SONG SONG: cùng tính sinceDate từ cùng lần thành công gần nhất, cùng kéo về cùng tập
//     dòng rồi cùng ghi -> đâm UNIQUE index (SourceSystem, SourceRefId). Nay bọc withAppLock
//     ('purchasing_dsmart_sync'), đúng khuôn jobs/operationOrderApiSync.js ('dsmart16_sync').
//  2. (mức Trung bình) fetchAllPurchases() (lib/dsmartApiClient.js) concat THẲNG data.items không kiểm
//     kiểu -> DSmart trả thiếu/sai kiểu field `items` là chèn `undefined`/giá trị rác vào danh sách giao
//     dịch (TypeError ở bước map() phía route, hoặc ghi dòng rác xuống DB).
//
// Gọi router THẬT (routes/purchasing.js) qua http.createServer thật + server HTTP cục bộ đóng vai DSmart
// cho phần fetchAllPurchases() — cùng khuôn tests/test-operation-order-noapprover-warning.js và
// tests/test-dsmart-fetchall-max-pages.js.
//
// Chạy: node server/tests/test-purchasing-sync-lock-and-items.js
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

// ===== Giả lập tầng lưu trữ =====
// withAppLock giả lập sp_getapplock KHÔNG chờ: lượt thứ 2 vào khi khoá đang giữ -> ném HttpError 409
// (đúng loại lỗi mà lib/recordStore.js ném khi sp_getapplock trả về < 0).
const { HttpError } = require('../lib/httpErrors');
const heldLocks = new Set();
let maxConcurrentSyncs = 0, currentSyncs = 0;

stubModule('lib/recordStore', {
  getAllForCollection: async () => [],
  insertRecord: async (c, r) => r,
  withLockedRecordForCollection: async (c, id, fn) => fn({ id }),
  withAppLock: async (key, fn) => {
    if (heldLocks.has(key)) throw new HttpError(409, 'Hệ thống đang bận xử lý một yêu cầu trùng — vui lòng thử lại.');
    heldLocks.add(key);
    try { return await fn(); } finally { heldLocks.delete(key); }
  }
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

const syncLogs = [];
let insertedRowBatches = [];
stubModule('lib/vendorPurchaseStore', {
  bulkInsertPurchaseTransactions: async (rows) => {
    insertedRowBatches.push(rows);
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

// "DSmart" giả: 1 trang, trả chậm (để 2 lượt gọi chắc chắn chồng nhau nếu không có khoá).
function startFakeDsmart(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
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
  console.log('== routes/purchasing.js POST /sync — khoá chống chạy chồng + lib/dsmartApiClient.js items không phải mảng ==');

  const dsmart = await startFakeDsmart(async (req, res) => {
    currentSyncs++;
    maxConcurrentSyncs = Math.max(maxConcurrentSyncs, currentSyncs);
    await new Promise(r => setTimeout(r, 250)); // giả lập API ngoài chậm — cửa sổ đua thật
    currentSyncs--;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // storeCode/purchaseDate/amount đủ hợp lệ (từ bản vá #7, đợt audit chuyên sâu 12 cụm — items.map() nay
    // validate từng dòng TRƯỚC khi insert, xem tests/test-purchasing-sync-row-validation.js cho test
    // riêng phần đó) — file này CHỈ test hành vi KHOÁ, không phải row validation, nên fixture phải hợp lệ.
    res.end(JSON.stringify({ items: [{ refId: 'R1', vendorCode: 'NCC01', storeCode: 'ST01', purchaseDate: '2026-09-01', amount: 1000 }], hasMore: false }));
  });
  process.env.DSMART_API_BASE_URL = `http://127.0.0.1:${dsmart.address().port}`;
  process.env.DSMART_API_KEY = 'test-key';

  const server = await startApp();
  try {
    await test('LỖI ĐÃ VÁ: 2 lượt /sync gửi CÙNG LÚC -> KHÔNG bao giờ chạy chồng (đúng 1 lượt đồng bộ tại 1 thời điểm)', async () => {
      insertedRowBatches = []; syncLogs.length = 0; maxConcurrentSyncs = 0;
      const [a, b] = await Promise.all([callSync(), callSync()]);
      assert.strictEqual(maxConcurrentSyncs, 1,
        `Có ${maxConcurrentSyncs} lượt đồng bộ chạy song song — thiếu khoá withAppLock('purchasing_dsmart_sync')`);
      const statuses = [a.status, b.status].sort();
      assert.deepStrictEqual(statuses, [200, 409], `Phải có đúng 1 lượt 200 + 1 lượt 409, nhận ${JSON.stringify(statuses)}`);
      assert.strictEqual(insertedRowBatches.length, 1, 'Chỉ đúng 1 lượt được ghi dữ liệu xuống bảng giao dịch');
    });

    await test('Lượt bị chặn vì trùng khoá -> KHÔNG ghi nhật ký đồng bộ FAILED (lượt đó chưa hề bắt đầu)', async () => {
      assert.strictEqual(syncLogs.filter(l => l.status === 'FAILED').length, 0, JSON.stringify(syncLogs));
      assert.strictEqual(syncLogs.filter(l => l.status === 'SUCCESS').length, 1);
    });

    await test('Lượt /sync đơn lẻ (không trùng) vẫn chạy bình thường như cũ', async () => {
      insertedRowBatches = []; syncLogs.length = 0;
      const r = await callSync();
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.rowsFetched, 1);
      assert.strictEqual(r.body.rowsInserted, 1);
    });
  } finally {
    server.close();
    dsmart.close();
  }

  // ===== fetchAllPurchases(): data.items không phải mảng =====
  const { fetchAllPurchases } = require('../lib/dsmartApiClient');
  for (const [label, payload] of [
    ['thiếu hẳn field items', { hasMore: false }],
    ['items = null', { items: null, hasMore: false }],
    ['items = object (không phải mảng)', { items: { refId: 'X' }, hasMore: false }],
    ['items = chuỗi', { items: 'oops', hasMore: false }]
  ]) {
    await test(`LỖI ĐÃ VÁ: DSmart trả ${label} -> coi như trang RỖNG, KHÔNG chèn dòng rác/undefined`, async () => {
      const fake = await startFakeDsmart((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      });
      try {
        const result = await fetchAllPurchases({ baseUrl: `http://127.0.0.1:${fake.address().port}`, apiKey: 'k', pageSize: 10, maxPages: 3 });
        assert.deepStrictEqual(result.items, [], `items phải rỗng, nhận ${JSON.stringify(result.items)}`);
        assert.strictEqual(result.pagesFetched, 1);
        // Bước map() ở routes/purchasing.js phải chạy được trên kết quả này (trước đây ném TypeError).
        assert.doesNotThrow(() => result.items.map(it => ({ vendorCode: it.vendorCode })));
      } finally { fake.close(); }
    });
  }

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
