// server/tests/test-dsmart-fetchall-max-pages.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): fetchAllPurchases() (lib/dsmartApiClient.js) trước đây
// dùng vòng lặp `while (true)` KHÔNG có trần nào — nếu DSmart API lỗi (luôn trả hasMore:true) thì job
// Đồng Bộ sẽ treo vô thời hạn, bộ nhớ phình vô hạn. Nay có trần maxPages (mặc định MAX_PAGES=1000, có
// thể truyền thấp hơn để test) — dừng + báo lỗi rõ ràng thay vì treo mãi.
//
// Test dựng 1 server HTTP THẬT cục bộ (http.createServer) để không phải mock lại module lõi 'http'.
//
// Chạy: node server/tests/test-dsmart-fetchall-max-pages.js
'use strict';
const http = require('http');
const assert = require('assert');
const { fetchAllPurchases } = require('../lib/dsmartApiClient');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  console.log('== lib/dsmartApiClient.js fetchAllPurchases() — trần MAX_PAGES ==');

  // ===== Kịch bản 1: API trả hasMore=false đúng hạn -> hoạt động bình thường như cũ =====
  await test('API trả hasMore=false ở trang 3 -> lấy đủ 3 trang, không bị chặn bởi trần', async () => {
    let callCount = 0;
    const server = await startServer((req, res) => {
      callCount++;
      const url = new URL(req.url, 'http://localhost');
      const page = Number(url.searchParams.get('page'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: [{ id: page }], hasMore: page < 3 }));
    });
    try {
      const port = server.address().port;
      const result = await fetchAllPurchases({ baseUrl: `http://127.0.0.1:${port}`, apiKey: 'test', pageSize: 10, maxPages: 5 });
      assert.strictEqual(result.pagesFetched, 3);
      assert.strictEqual(result.items.length, 3);
      assert.strictEqual(callCount, 3);
    } finally { server.close(); }
  });

  // ===== Kịch bản 2: API LUÔN trả hasMore=true (giả lập lỗi DSmart) -> dừng đúng tại maxPages, báo lỗi rõ =====
  await test('LỖI ĐÃ VÁ: API luôn trả hasMore=true -> dừng đúng tại maxPages, KHÔNG treo vô thời hạn', async () => {
    let callCount = 0;
    const server = await startServer((req, res) => {
      callCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ items: [{ id: callCount }], hasMore: true }));
    });
    try {
      const port = server.address().port;
      await assert.rejects(
        () => fetchAllPurchases({ baseUrl: `http://127.0.0.1:${port}`, apiKey: 'test', pageSize: 10, maxPages: 5 }),
        /đã lấy tới 5 trang.*hasMore=true/
      );
      assert.strictEqual(callCount, 5, 'Phải dừng NGAY sau đúng 5 lượt gọi, không gọi thêm');
    } finally { server.close(); }
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
