// server/tests/test-purchasing-rebate-calculate-period.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu Vận Hành/Mua Hàng, 9/2026): POST /terms/:id/calculate (routes/purchasing.js,
// module BAS — Cơ Sở Tính Chiết Khấu/Thưởng NCC) trước đây chỉ kiểm tra term.status==='ACTIVE', KHÔNG
// đối chiếu kỳ tính (periodStart/periodEnd) với effectiveFrom/effectiveTo của điều khoản — chọn 1 kỳ bao
// trùm cả những tháng NGOÀI thời hạn hiệu lực thật vẫn tính ra số ước tính dựa trên TOÀN BỘ doanh số mua
// hàng trong khoảng đó, sai lệch với thoả thuận thật mà không cảnh báo gì. Điều khoản cũng KHÔNG có job
// tự động chuyển EXPIRED khi qua effectiveTo (chỉ admin tự đánh dấu) nên guard này là lớp bảo vệ DUY NHẤT.
//
// Test này KHÔNG mở trình duyệt Playwright — boot thẳng routes/purchasing.js thật, chỉ giả lập tầng lưu
// trữ (lib/recordStore) + xác thực (lib/auth) + lib/vendorPurchaseStore.queryPurchaseTransactionsForVendor
// (để không cần SQL Server thật) — cùng khuôn tests/test-training-bulk-register-lock-namespace.js.
//
// Chạy: node server/tests/test-purchasing-rebate-calculate-period.js
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
  console.log('== POST /api/purchasing/terms/:id/calculate phải đối chiếu kỳ tính với hiệu lực điều khoản ==');

  const STORE = {
    vendors: [{ id: 1, vendorCode: 'NCC001', name: 'Nhà Cung Cấp Test' }],
    rebateTerms: [
      // Điều khoản chỉ áp dụng Q1/2026 (01/01 -> 31/03).
      { id: 10, termCode: 'DK-001', vendorId: 1, status: 'ACTIVE', tierMode: 'PERCENT', tiers: [{ minAmount: 0, rate: 5 }], effectiveFrom: '2026-01-01', effectiveTo: '2026-03-31' },
      // Điều khoản không giới hạn ngày kết thúc (effectiveTo = null) — không được chặn nhầm chiều "đến".
      { id: 11, termCode: 'DK-002', vendorId: 1, status: 'ACTIVE', tierMode: 'PERCENT', tiers: [{ minAmount: 0, rate: 3 }], effectiveFrom: '2026-01-01', effectiveTo: null }
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

  async function calc(termId, periodStart, periodEnd) {
    const res = await fetch(`http://127.0.0.1:${port}/api/purchasing/terms/${termId}/calculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-demo-user': MANAGER.username },
      body: JSON.stringify({ periodStart, periodEnd })
    });
    let body = null;
    try { body = await res.json(); } catch (e) {}
    return { status: res.status, body };
  }

  await test('Kỳ tính NẰM TRỌN trong hiệu lực (Q1) -> tính bình thường', async () => {
    const res = await calc(10, '2026-01-01', '2026-03-31');
    assert.strictEqual(res.status, 200, `Phải tính thành công — thực tế: ${JSON.stringify(res.body)}`);
  });

  await test('Kỳ tính BẮT ĐẦU TRƯỚC effectiveFrom -> bị từ chối 400', async () => {
    const res = await calc(10, '2025-12-01', '2026-01-31');
    assert.strictEqual(res.status, 400, 'Kỳ tính lấn ra trước Ngày Hiệu Lực Từ phải bị chặn');
    assert.ok(res.body.error.includes('Hiệu Lực Từ'), `Thông báo lỗi phải nêu rõ lý do — thực tế: ${res.body.error}`);
  });

  await test('Kỳ tính KẾT THÚC SAU effectiveTo -> bị từ chối 400 (kịch bản chính của lỗi đã vá)', async () => {
    const res = await calc(10, '2026-01-01', '2026-12-31');
    assert.strictEqual(res.status, 400, 'Kỳ tính bao trùm cả các tháng ngoài hiệu lực (Q2-Q4) phải bị chặn, không được âm thầm tính gộp toàn bộ doanh số cả năm');
    assert.ok(res.body.error.includes('Hiệu Lực Đến'), `Thông báo lỗi phải nêu rõ lý do — thực tế: ${res.body.error}`);
  });

  await test('Điều khoản KHÔNG có effectiveTo (vô thời hạn) -> kỳ tính xa vẫn được chấp nhận (không chặn nhầm)', async () => {
    const res = await calc(11, '2026-01-01', '2026-12-31');
    assert.strictEqual(res.status, 200, `effectiveTo=null nghĩa là không giới hạn ngày kết thúc, không được chặn — thực tế: ${JSON.stringify(res.body)}`);
  });

  server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
