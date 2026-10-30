// tests/test-inventory-recon.js — "📊 Đối Chiếu Kệ & Tồn Kho" (Kiểm Soát Hàng Hóa, bổ sung sau khi có
// tài liệu API Tồn Kho BRGMART v1.1, 10/2026). Test TRỰC TIẾP lib/inventoryApiClient.js (dựng server
// HTTP THẬT cục bộ, cùng khuôn tests/test-dsmart-fetchall-max-pages.js — không mock lại module lõi
// 'http') + jobs/inventorySync.js (cache theo maDiem, tự vô hiệu hoá khi thiếu API key) + phần maHang
// mới trong lib/createValidation.js (shelfRecords) + 1 guard "shape" chặn regression cho route
// GET /api/shelf-stock/system-inventory KHÔNG BAO GIỜ đọc mã siêu thị/maDiem từ query/body client.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { fetchAllSystemInventory, InventoryApiAuthError } = require('../lib/inventoryApiClient');
const { validateAndPrepareCreate, CreateError } = require('../lib/createValidation');

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
function userOf(dept, perms) {
  return { username: 'u1', name: 'User 1', dept, perms: perms || {} };
}

async function main() {
  console.log('== lib/inventoryApiClient.js — fetchAllSystemInventory() ==');

  await test('Phân trang 3 trang (pageSize=2) -> gọi đúng 3 lần, lấy đủ dữ liệu, dừng đúng lúc rows < pageSize', async () => {
    const allRows = [1, 2, 3, 4, 5].map(i => ({ maDiem: '004', maHang: `SKU${i}`, soLuongTon: i, capNhatLuc: '2026-10-30T14:15:00.000Z' }));
    let callCount = 0;
    const server = await startServer((req, res) => {
      callCount++;
      const url = new URL(req.url, 'http://localhost');
      const page = Number(url.searchParams.get('page'));
      const pageSize = Number(url.searchParams.get('pageSize'));
      const slice = allRows.slice((page - 1) * pageSize, page * pageSize);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reportId: 'ton-kho', page, pageSize, columns: [], rows: slice }));
    });
    try {
      const port = server.address().port;
      const result = await fetchAllSystemInventory({ baseUrl: `http://127.0.0.1:${port}`, apiKey: 'test', pageSize: 2 });
      assert.strictEqual(result.rows.length, 5, 'phải lấy đủ 5 dòng qua 3 trang');
      assert.strictEqual(callCount, 3, 'phải dừng đúng sau 3 lượt gọi (trang 3 trả 1 dòng < pageSize=2)');
      assert.strictEqual(result.capNhatLuc, '2026-10-30T14:15:00.000Z');
    } finally { server.close(); }
  });

  await test('Trần MAX_PAGES: API luôn trả đủ pageSize dòng (giả lập lỗi đối tác) -> dừng đúng tại maxPages, báo lỗi rõ', async () => {
    let callCount = 0;
    const server = await startServer((req, res) => {
      callCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rows: [{ maDiem: '004', maHang: 'X', soLuongTon: 1 }, { maDiem: '004', maHang: 'Y', soLuongTon: 1 }] }));
    });
    try {
      const port = server.address().port;
      await assert.rejects(
        () => fetchAllSystemInventory({ baseUrl: `http://127.0.0.1:${port}`, apiKey: 'test', pageSize: 2, maxPages: 4 }),
        /đã lấy tới 4 trang/
      );
      assert.strictEqual(callCount, 4, 'phải dừng NGAY sau đúng 4 lượt gọi');
    } finally { server.close(); }
  });

  await test('429 -> tôn trọng Retry-After (giây), tự thử lại rồi thành công', async () => {
    let callCount = 0;
    const server = await startServer((req, res) => {
      callCount++;
      if (callCount === 1) {
        res.writeHead(429, { 'Retry-After': '0' }); // 0s cho test chạy nhanh, vẫn đúng logic đọc header
        res.end(JSON.stringify({ error: 'Qua tan suat' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rows: [{ maDiem: '004', maHang: 'X', soLuongTon: 5 }] }));
    });
    try {
      const port = server.address().port;
      const result = await fetchAllSystemInventory({ baseUrl: `http://127.0.0.1:${port}`, apiKey: 'test', pageSize: 10 });
      assert.strictEqual(callCount, 2, 'phải gọi lại sau 429');
      assert.strictEqual(result.rows.length, 1);
    } finally { server.close(); }
  });

  await test('401 -> ném InventoryApiAuthError (KHÔNG retry vô ích), đúng loại lỗi để job phân biệt', async () => {
    let callCount = 0;
    const server = await startServer((req, res) => {
      callCount++;
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Sai API key' }));
    });
    try {
      const port = server.address().port;
      let caught = null;
      try { await fetchAllSystemInventory({ baseUrl: `http://127.0.0.1:${port}`, apiKey: 'wrong', pageSize: 10 }); }
      catch (err) { caught = err; }
      assert.ok(caught instanceof InventoryApiAuthError, 'phải là InventoryApiAuthError');
      assert.strictEqual(callCount, 1, '401 không được retry');
    } finally { server.close(); }
  });

  await test('500 -> tự retry theo backoff rồi thành công (lỗi máy chủ tạm thời)', async () => {
    let callCount = 0;
    const server = await startServer((req, res) => {
      callCount++;
      if (callCount < 2) { res.writeHead(500); res.end(JSON.stringify({ error: 'Loi tam thoi' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rows: [{ maDiem: '004', maHang: 'X', soLuongTon: 9 }] }));
    });
    try {
      const port = server.address().port;
      const result = await fetchAllSystemInventory({ baseUrl: `http://127.0.0.1:${port}`, apiKey: 'test', pageSize: 10 });
      assert.strictEqual(result.rows.length, 1);
      assert.ok(callCount >= 2, 'phải retry ít nhất 1 lần trước khi thành công');
    } finally { server.close(); }
  });

  console.log('\n== jobs/inventorySync.js ==');

  await test('Thiếu BRGMART_INVENTORY_API_KEY -> syncSystemInventory() tự vô hiệu hoá, KHÔNG throw, KHÔNG crash', async () => {
    delete process.env.BRGMART_INVENTORY_API_KEY;
    delete require.cache[require.resolve('../jobs/inventorySync')];
    const { syncSystemInventory, isInventoryApiConfigured } = require('../jobs/inventorySync');
    assert.strictEqual(isInventoryApiConfigured(), false);
    const result = await syncSystemInventory();
    assert.strictEqual(result.skipped, true);
  });

  await test('Có API key, đồng bộ thành công -> cache đúng theo maDiem, siêu thị khác maDiem không thấy nhầm dữ liệu', async () => {
    const server = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        rows: [
          { maDiem: '004', maHang: 'A', tenHang: 'San pham A', soLuongTon: 10, capNhatLuc: '2026-10-30T14:15:00.000Z' },
          { maDiem: '001', maHang: 'B', tenHang: 'San pham B', soLuongTon: 20, capNhatLuc: '2026-10-30T14:15:00.000Z' }
        ]
      }));
    });
    try {
      const port = server.address().port;
      process.env.BRGMART_INVENTORY_API_KEY = 'test-key';
      process.env.BRGMART_INVENTORY_API_BASE_URL = `http://127.0.0.1:${port}`;
      delete require.cache[require.resolve('../jobs/inventorySync')];
      const { syncSystemInventory, getSystemInventoryForMaDiem } = require('../jobs/inventorySync');
      const result = await syncSystemInventory();
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.storeCount, 2);
      const cache004 = getSystemInventoryForMaDiem('004');
      assert.strictEqual(cache004.rows.length, 1);
      assert.strictEqual(cache004.rows[0].maHang, 'A');
      const cache001 = getSystemInventoryForMaDiem('001');
      assert.strictEqual(cache001.rows.length, 1);
      assert.strictEqual(cache001.rows[0].maHang, 'B');
      assert.strictEqual(getSystemInventoryForMaDiem('999-khong-ton-tai'), null, 'maDiem không có dữ liệu phải trả null, không throw');
    } finally {
      server.close();
      delete process.env.BRGMART_INVENTORY_API_KEY;
      delete process.env.BRGMART_INVENTORY_API_BASE_URL;
      delete require.cache[require.resolve('../jobs/inventorySync')];
    }
  });

  console.log('\n== lib/createValidation.js — shelfRecords.maHang (bổ sung) ==');

  await test('maHang optional: không gửi -> record.maHang = "" (không lỗi, ghi nhận tay/camera vẫn hoạt động y cũ)', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfRecordCreate: true });
    const existingLocations = [{ id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Nước giải khát', active: true }];
    const record = validateAndPrepareCreate('shelfRecords', { shelfLocationId: 1, productName: 'Coca-Cola', quantity: 10 }, user, [], { shelfLocations: existingLocations });
    assert.strictEqual(record.maHang, '', 'maHang phải rỗng khi không gửi');
  });

  await test('maHang gửi kèm (chọn từ tồn kho hệ thống) -> lưu đúng, dept vẫn LUÔN = user.dept dù client cố gửi dept giả', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfRecordCreate: true });
    const existingLocations = [{ id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Nước giải khát', active: true }];
    const record = validateAndPrepareCreate('shelfRecords',
      { shelfLocationId: 1, productName: 'Sua tuoi TH', quantity: 5, maHang: '2003330491', dept: 'Siêu thị giả mạo' },
      user, [], { shelfLocations: existingLocations });
    assert.strictEqual(record.maHang, '2003330491');
    assert.strictEqual(record.dept, 'Siêu thị Quận 1', 'dept không được lấy theo payload.dept giả mạo (forceOwnDept)');
  });

  console.log('\n== routes/shelfStock.js — guard: GET /system-inventory không đọc mã siêu thị từ client ==');

  await test('Route source KHÔNG đọc req.query/req.body cho maDiem/mã siêu thị (chỉ tra theo req.freshUser.dept)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'shelfStock.js'), 'utf8');
    const start = src.indexOf("router.get('/system-inventory'");
    assert.ok(start !== -1, 'không tìm thấy route GET /system-inventory');
    const end = src.indexOf('\n});', start);
    const handlerSrc = src.slice(start, end);
    assert.ok(!/req\.(query|body|params)\.(maDiem|dept|storeCode|storeName)/i.test(handlerSrc),
      'LỖI BẢO MẬT: route đọc mã siêu thị/maDiem trực tiếp từ client — phải luôn tự tra qua req.freshUser.dept');
    assert.ok(handlerSrc.includes('req.freshUser.dept'), 'route phải tự tra theo req.freshUser.dept');
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
