// server/tests/test-purchasing-calculate-date-format.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): POST /terms/:id/calculate (routes/purchasing.js) trước
// đây KHÔNG ép định dạng periodStart/periodEnd — client cũ dùng prompt() tự do nên chuỗi ngày sai định
// dạng (VD "20/9/2026", rỗng-khoảng-trắng, chữ tuỳ ý...) vẫn lọt qua rồi mới vỡ khó hiểu ở tầng
// new Date(...)/SQL (Invalid Date). Nay ép đúng /^\d{4}-\d{2}-\d{2}$/ như mọi nơi khác trong hệ thống,
// báo lỗi 400 rõ ràng ngay tại route thay vì để lỗi mập mờ rơi xuống tầng dưới. Client cũng đã đổi từ
// prompt() sang <input type="date"> (module-muahang.js, calculateMhTerm/submitMhCalcTerm) để trình duyệt
// tự ép định dạng — bài test này xác nhận lớp chặn phía SERVER (không phụ thuộc client).
//
// Test này KHÔNG mở trình duyệt — boot thẳng routes/purchasing.js thật, chỉ giả lập tầng lưu trữ/xác thực,
// cùng khuôn tests/test-purchasing-rebate-calculate-period.js.
//
// Chạy: node server/tests/test-purchasing-calculate-date-format.js
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
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

async function main() {
  console.log('== POST /api/purchasing/terms/:id/calculate phải ép định dạng YYYY-MM-DD cho periodStart/periodEnd ==');

  const STORE = {
    vendors: [{ id: 1, vendorCode: 'NCC001', name: 'Nhà Cung Cấp Test' }],
    rebateTerms: [
      { id: 10, termCode: 'DK-001', vendorId: 1, status: 'ACTIVE', tierMode: 'PERCENT', tiers: [{ minAmount: 0, rate: 5 }], effectiveFrom: '2026-01-01', effectiveTo: null }
    ],
    rebateCalculations: []
  };
  let nextId = 1000;
  stubModule('lib/recordStore', {
    getAllForCollection: async (c) => (STORE[c] || []).slice(),
    insertRecord: async (c, record) => { const item = { ...record, id: nextId++ }; (STORE[c] = STORE[c] || []).push(item); return item; },
    withLockedRecordForCollection: async () => { throw new Error('không dùng trong bài test này'); },
    withAppLock: async (key, fn) => fn()
  });
  stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
  stubModule('lib/vendorPurchaseStore', {
    queryPurchaseTransactionsForVendor: async () => [{ amount: 100000000, isReturn: false }],
    queryPurchaseTransactionsForExport: async () => [],
    bulkInsertPurchaseTransactions: async () => ({ inserted: 0, skipped: 0 }),
    insertPurchaseSyncLog: async () => {},
    getRecentPurchaseSyncLogs: async () => [],
    getLastSuccessfulSyncStart: async () => null
  });
  const MANAGER = { username: 'qlmuahang', name: 'Quản Lý Mua Hàng', dept: 'Mua Hàng', perms: { rebateTermManage: true }, active: true };
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const fresh = req.headers['x-demo-user'] === MANAGER.username ? MANAGER : null;
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh; req.allUsers = [MANAGER];
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });

  const purchasingRoutes = require('../routes/purchasing');
  const app = express();
  app.use(express.json());
  app.use('/api/purchasing', purchasingRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  async function calc(periodStart, periodEnd) {
    const res = await fetch(`http://127.0.0.1:${port}/api/purchasing/terms/10/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-demo-user': MANAGER.username },
      body: JSON.stringify({ periodStart, periodEnd })
    });
    let body = null;
    try { body = await res.json(); } catch (e) {}
    return { status: res.status, body };
  }

  await test('periodStart/periodEnd đúng YYYY-MM-DD -> tính bình thường (không bị chặn nhầm)', async () => {
    const res = await calc('2026-01-01', '2026-06-30');
    assert.strictEqual(res.status, 200, `Phải tính thành công — thực tế: ${JSON.stringify(res.body)}`);
  });

  await test('LỖI ĐÃ VÁ: periodStart kiểu dd/mm/yyyy -> bị từ chối 400, không lọt xuống tầng dưới', async () => {
    const res = await calc('01/06/2026', '2026-06-30');
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('YYYY-MM-DD'), `Thông báo lỗi phải nêu rõ định dạng đúng — thực tế: ${res.body.error}`);
  });

  await test('LỖI ĐÃ VÁ: periodEnd là chữ tuỳ ý -> bị từ chối 400', async () => {
    const res = await calc('2026-01-01', 'không phải ngày');
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('YYYY-MM-DD'), `Thông báo lỗi phải nêu rõ định dạng đúng — thực tế: ${res.body.error}`);
  });

  await test('LỖI ĐÃ VÁ: chuỗi rỗng-khoảng-trắng -> bị từ chối 400 (không đi qua nhánh "thiếu kỳ tính" vì truthy)', async () => {
    const res = await calc('   ', '2026-06-30');
    assert.strictEqual(res.status, 400);
  });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
