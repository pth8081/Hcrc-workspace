// server/tests/test-purchasing-manual-import-lock.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #6):
// POST /api/purchasing/manual-import KHÔNG có khoá chống chạy chồng, khác hẳn POST /sync (đã có
// withAppLock('purchasing_dsmart_sync') — xem tests/test-purchasing-sync-lock-and-items.js). Cả 2 route
// cùng ghi vào bulkInsertPurchaseTransactions() nên chịu ĐÚNG rủi ro đâm nhau ở UNIQUE index
// (SourceSystem, SourceRefId) nếu chạy chồng — HOẶC giữa 2 lượt /manual-import, HOẶC giữa 1 lượt
// /manual-import và 1 lượt /sync đang chạy. Đã vá: bọc /manual-import trong CÙNG khoá
// 'purchasing_dsmart_sync' với /sync.
//
// Cùng khuôn tests/test-purchasing-sync-lock-and-items.js — router THẬT (routes/purchasing.js), file
// .xlsx THẬT (dựng qua exceljs) tải lên qua multipart thật.
//
// Chạy: node server/tests/test-purchasing-manual-import-lock.js
'use strict';
const http = require('http');
const path = require('path');
const assert = require('assert');
const ExcelJS = require('exceljs');

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

const { HttpError } = require('../lib/httpErrors');
const heldLocks = new Set();
let maxConcurrentInLock = 0, currentInLock = 0;
const lockCallLog = [];
stubModule('lib/recordStore', {
  getAllForCollection: async () => [],
  insertRecord: async (c, r) => r,
  withLockedRecordForCollection: async (c, id, fn) => fn({ id }),
  withAppLock: async (key, fn) => {
    lockCallLog.push(key);
    if (heldLocks.has(key)) throw new HttpError(409, 'Hệ thống đang bận xử lý một yêu cầu trùng — vui lòng thử lại.');
    heldLocks.add(key);
    currentInLock++; maxConcurrentInLock = Math.max(maxConcurrentInLock, currentInLock);
    try {
      // Trễ nhân tạo để mở cửa sổ đua thật giữa 2 lượt gọi gần như đồng thời — mirror khuôn
      // test-purchasing-sync-lock-and-items.js (fake DSmart trả chậm 250ms).
      await new Promise((r) => setTimeout(r, 60));
      return await fn();
    } finally { currentInLock--; heldLocks.delete(key); }
  }
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

let insertedRowBatches = [];
stubModule('lib/vendorPurchaseStore', {
  bulkInsertPurchaseTransactions: async (rows) => {
    insertedRowBatches.push(rows);
    return { rowsInserted: rows.length, rowsUpdated: 0, rowsSkippedDuplicate: 0 };
  },
  queryPurchaseTransactionsForVendor: async () => [],
  queryPurchaseTransactionsForExport: async () => [],
  insertPurchaseSyncLog: async () => {},
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
  app.use('/api/purchasing', purchasingRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function buildValidXlsxBuffer() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Giao Dịch Mua Hàng');
  sheet.columns = [
    { header: 'Mã NCC (*)', key: 'vendorCode' }, { header: 'Mã Siêu Thị (*)', key: 'storeCode' },
    { header: 'Định Dạng (MART/MINIMART)', key: 'storeFormat' }, { header: 'Mã Ngành Hàng', key: 'categoryCode' },
    { header: 'Ngày Mua (YYYY-MM-DD) (*)', key: 'purchaseDate' }, { header: 'Số Tiền (*)', key: 'amount' },
    { header: 'Hàng Trả Lại (Có/Không)', key: 'isReturn' }
  ];
  sheet.addRow({ vendorCode: 'NCC01', storeCode: 'ST01', storeFormat: 'MART', categoryCode: 'FOOD', purchaseDate: '2026-09-01', amount: 1000000, isReturn: 'Không' });
  return wb.xlsx.writeBuffer();
}

async function callManualImport(buffer) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'test.xlsx');
  const res = await fetch(`http://127.0.0.1:${PORT}/api/purchasing/manual-import`, { method: 'POST', body: form });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}

async function main() {
  console.log('== routes/purchasing.js POST /manual-import — khoá chống chạy chồng (dùng chung khoá với /sync) ==');
  const server = await startApp();
  try {
    await test('LỖI ĐÃ VÁ: 2 lượt /manual-import gửi CÙNG LÚC -> KHÔNG bao giờ chạy chồng (đúng 1 lượt tại 1 thời điểm)', async () => {
      insertedRowBatches = []; heldLocks.clear(); maxConcurrentInLock = 0; lockCallLog.length = 0;
      const buf = await buildValidXlsxBuffer();
      const [a, b] = await Promise.all([callManualImport(buf), callManualImport(buf)]);
      assert.strictEqual(maxConcurrentInLock, 1, `Có ${maxConcurrentInLock} lượt nhập file chạy song song — thiếu khoá`);
      const statuses = [a.status, b.status].sort();
      assert.deepStrictEqual(statuses, [200, 409], `Phải có đúng 1 lượt 200 + 1 lượt 409, nhận ${JSON.stringify(statuses)} — ${JSON.stringify([a.body, b.body])}`);
      assert.strictEqual(insertedRowBatches.length, 1, 'Chỉ đúng 1 lượt được ghi dữ liệu xuống bảng giao dịch');
    });

    await test('Khoá dùng ĐÚNG "purchasing_dsmart_sync" — CHUNG với /sync (không phải khoá riêng biệt)', () => {
      assert(lockCallLog.length >= 1, JSON.stringify(lockCallLog));
      assert(lockCallLog.every(k => k === 'purchasing_dsmart_sync'), `Khoá phải là 'purchasing_dsmart_sync' (chung với /sync), nhận ${JSON.stringify(lockCallLog)}`);
    });

    await test('Lượt /manual-import đơn lẻ (không trùng) vẫn hoạt động bình thường như cũ', async () => {
      insertedRowBatches = []; heldLocks.clear();
      const buf = await buildValidXlsxBuffer();
      const r = await callManualImport(buf);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.rowsInserted, 1);
    });
  } finally {
    server.close();
  }

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
