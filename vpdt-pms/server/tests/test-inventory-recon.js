// tests/test-inventory-recon.js — "📊 Đối Chiếu Kệ & Tồn Kho" (Kiểm Soát Hàng Hóa, bổ sung sau khi có
// tài liệu API Tồn Kho BRGMART v1.1, 10/2026). Test TRỰC TIẾP lib/inventoryApiClient.js (dựng server
// HTTP THẬT cục bộ, cùng khuôn tests/test-dsmart-fetchall-max-pages.js — không mock lại module lõi
// 'http') + jobs/inventorySync.js (snapshot theo maDiem lưu qua lib/appData.js, tự vô hiệu hoá khi
// thiếu API key) + phần maHang mới trong lib/createValidation.js (shelfRecords) + 1 guard "shape" chặn
// regression cho route GET /api/shelf-stock/system-inventory KHÔNG BAO GIỜ đọc mã siêu thị/maDiem từ
// query/body client.
//
// v28.84: jobs/inventorySync.js chuyển từ cache RAM (Map trong tiến trình) sang lưu qua lib/appData.js
// (dbo.AppData, khoá "systemInventorySnapshot") — sandbox test KHÔNG có SQL Server thật (xác nhận: mọi
// route/job khác trong repo này vẫn test qua testHarness.js mock-backend hoặc gọi thẳng hàm thuần, chưa
// có tiền lệ nào mở kết nối SQL thật trong bộ test) nên mock lib/appData.js qua require.cache (CÙNG kỹ
// thuật tests/test-checklist-storeself-daily-seed.js dùng cho lib/recordStore) — `fakeStore` là 1 object
// JS dùng chung giữa nhiều lượt require.cache-delete+require lại jobs/inventorySync.js, mô phỏng ĐÚNG
// "nhiều tiến trình PM2 cùng đọc chung 1 bảng AppData thật" (mỗi lượt require lại là 1 "tiến trình" mới,
// state module-level như lastSyncAttemptAt reset về null — khớp đúng PM2 cluster mode thật, nhưng
// fakeStore vẫn còn nguyên vì nó là 1 object NGOÀI require.cache của module, y hệt 1 bảng SQL thật tồn
// tại độc lập với từng tiến trình Node).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { fetchAllSystemInventory, InventoryApiAuthError } = require('../lib/inventoryApiClient');
const { validateAndPrepareCreate, CreateError } = require('../lib/createValidation');

function makeFakeAppData(store) {
  const clone = (v) => (v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)));
  return {
    async getAppDataValue(key) { return clone(store[key] !== undefined ? store[key] : null); },
    async getAppDataValueCached(key) { return clone(store[key] !== undefined ? store[key] : null); },
    async setAppDataValue(key, value) { store[key] = clone(value); },
    async withLockedAppDataValue(key, mutatorFn) {
      const current = store[key] !== undefined ? clone(store[key]) : null;
      if (current === null) throw new Error(`Key không tồn tại trong AppData: ${key}`);
      const next = await mutatorFn(current);
      store[key] = clone(next);
      return next;
    }
  };
}
// requireFreshInventorySync(store) — nạp lại jobs/inventorySync.js "sạch" (reset mọi biến module-level:
// lastSyncAttemptAt/lastSyncSuccessAt/lastSyncError), NHƯNG trỏ require('../lib/appData') bên trong nó
// sang fakeStore CHUNG truyền vào — mô phỏng đúng 1 tiến trình PM2 MỚI (biến RAM module-level reset),
// cùng đọc/ghi 1 "CSDL" chung (store object y hệt instance trước, nếu truyền lại CÙNG store).
function requireFreshInventorySync(store) {
  const appDataPath = require.resolve('../lib/appData');
  const jobPath = require.resolve('../jobs/inventorySync');
  require.cache[appDataPath] = { id: appDataPath, filename: appDataPath, loaded: true, exports: makeFakeAppData(store) };
  delete require.cache[jobPath];
  const mod = require('../jobs/inventorySync');
  return {
    ...mod,
    cleanup: () => { delete require.cache[appDataPath]; delete require.cache[jobPath]; }
  };
}

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
    const store = {};
    const { syncSystemInventory, isInventoryApiConfigured, cleanup } = requireFreshInventorySync(store);
    try {
      assert.strictEqual(await isInventoryApiConfigured(), false);
      const result = await syncSystemInventory();
      assert.strictEqual(result.skipped, true);
      assert.strictEqual(store.systemInventorySnapshot, undefined, 'bỏ qua hoàn toàn thì không được ghi gì vào "CSDL"');
    } finally { cleanup(); }
  });

  await test('Có API key, đồng bộ thành công -> LƯU VÀO "CSDL" (store.systemInventorySnapshot) đúng theo maDiem, siêu thị khác maDiem không thấy nhầm dữ liệu', async () => {
    const server = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        rows: [
          { maDiem: '004', maHang: 'A', tenHang: 'San pham A', soLuongTon: 10, capNhatLuc: '2026-10-30T14:15:00.000Z' },
          { maDiem: '001', maHang: 'B', tenHang: 'San pham B', soLuongTon: 20, capNhatLuc: '2026-10-30T14:15:00.000Z' }
        ]
      }));
    });
    const store = {};
    try {
      const port = server.address().port;
      process.env.BRGMART_INVENTORY_API_KEY = 'test-key';
      process.env.BRGMART_INVENTORY_API_BASE_URL = `http://127.0.0.1:${port}`;
      const { syncSystemInventory, getSystemInventoryForMaDiem, cleanup } = requireFreshInventorySync(store);
      try {
        const result = await syncSystemInventory();
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.storeCount, 2);
        // Xác nhận THẬT SỰ đã ghi vào "CSDL" (object store ngoài require.cache module), không chỉ còn ở
        // biến RAM nào đó bên trong module — đây chính là điểm khác biệt cốt lõi so với bản cũ trước
        // v28.84 (chỉ giữ Map trong tiến trình, test cũ không có điểm xác nhận này).
        assert.ok(store.systemInventorySnapshot, 'phải có key "systemInventorySnapshot" trong store sau khi đồng bộ');
        assert.ok(store.systemInventorySnapshot.byMaDiem['004'], 'store phải có đúng mã điểm 004');
        const cache004 = await getSystemInventoryForMaDiem('004');
        assert.strictEqual(cache004.rows.length, 1);
        assert.strictEqual(cache004.rows[0].maHang, 'A');
        const cache001 = await getSystemInventoryForMaDiem('001');
        assert.strictEqual(cache001.rows.length, 1);
        assert.strictEqual(cache001.rows[0].maHang, 'B');
        assert.strictEqual(await getSystemInventoryForMaDiem('999-khong-ton-tai'), null, 'maDiem không có dữ liệu phải trả null, không throw');
      } finally { cleanup(); }
    } finally {
      server.close();
      delete process.env.BRGMART_INVENTORY_API_KEY;
      delete process.env.BRGMART_INVENTORY_API_BASE_URL;
    }
  });

  await test('QUAN TRỌNG (lý do đổi sang CSDL, v28.84): tiến trình KHÁC (chưa từng tự chạy đồng bộ) vẫn đọc được dữ liệu do tiến trình kia ghi — mô phỏng đúng PM2 cluster mode nhiều tiến trình cùng đọc 1 bảng AppData', async () => {
    const server = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rows: [{ maDiem: '004', maHang: 'A', soLuongTon: 7, capNhatLuc: '2026-10-30T14:15:00.000Z' }] }));
    });
    const sharedStore = {}; // mô phỏng 1 bảng dbo.AppData THẬT, tồn tại độc lập với từng tiến trình Node
    try {
      const port = server.address().port;
      process.env.BRGMART_INVENTORY_API_KEY = 'test-key';
      process.env.BRGMART_INVENTORY_API_BASE_URL = `http://127.0.0.1:${port}`;

      // "Tiến trình #0" (isSchedulerInstance=true trong server.js thật) — tự chạy đồng bộ.
      const worker0 = requireFreshInventorySync(sharedStore);
      const result = await worker0.syncSystemInventory();
      assert.strictEqual(result.ok, true);
      worker0.cleanup();

      // "Tiến trình #1" (1 worker PM2 KHÁC, KHÔNG BAO GIỜ tự gọi syncSystemInventory() — đúng thiết kế
      // isSchedulerInstance chỉ chạy job ở 1 tiến trình duy nhất, xem server.js) — require LẠI module
      // (mọi biến module-level reset sạch, kể cả lastSyncAttemptAt/lastSyncSuccessAt vẫn null), NHƯNG
      // dùng CHUNG sharedStore -> phải đọc được dữ liệu "tiến trình #0" vừa ghi.
      const worker1 = requireFreshInventorySync(sharedStore);
      try {
        assert.strictEqual(worker1.getInventorySyncStatus ? (await worker1.getInventorySyncStatus()).lastSyncSuccessAt : null, null,
          'biến RAM module-level của tiến trình #1 PHẢI null (chưa từng tự chạy sync ở tiến trình này) — xác nhận kịch bản mô phỏng đúng');
        const cache004 = await worker1.getSystemInventoryForMaDiem('004');
        assert.ok(cache004, 'LỖI ĐÚNG BẢN CŨ (trước v28.84) sẽ fail ở đây: tiến trình #1 không có cache RAM riêng -> luôn null. Sau khi chuyển sang CSDL, tiến trình #1 vẫn đọc được dữ liệu "CSDL" chung.');
        assert.strictEqual(cache004.rows[0].maHang, 'A');
        assert.strictEqual(cache004.rows[0].soLuongTon, 7);
      } finally { worker1.cleanup(); }
    } finally {
      server.close();
      delete process.env.BRGMART_INVENTORY_API_KEY;
      delete process.env.BRGMART_INVENTORY_API_BASE_URL;
    }
  });

  await test('Ghi đè hoàn toàn (không cộng dồn/giữ lịch sử): đồng bộ lần 2 với tập siêu thị KHÁC -> siêu thị cũ không còn trong dữ liệu nữa', async () => {
    let callCount = 0;
    const server = await startServer((req, res) => {
      callCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (callCount === 1) {
        res.end(JSON.stringify({ rows: [{ maDiem: '004', maHang: 'A', soLuongTon: 1 }, { maDiem: '001', maHang: 'B', soLuongTon: 2 }] }));
      } else {
        res.end(JSON.stringify({ rows: [{ maDiem: '099', maHang: 'C', soLuongTon: 3 }] })); // 004/001 KHÔNG còn xuất hiện
      }
    });
    const store = {};
    try {
      const port = server.address().port;
      process.env.BRGMART_INVENTORY_API_KEY = 'test-key';
      process.env.BRGMART_INVENTORY_API_BASE_URL = `http://127.0.0.1:${port}`;
      const { syncSystemInventory, getSystemInventoryForMaDiem, cleanup } = requireFreshInventorySync(store);
      try {
        await syncSystemInventory();
        assert.ok(await getSystemInventoryForMaDiem('004'), 'lần 1: phải có 004');
        await syncSystemInventory();
        assert.strictEqual(await getSystemInventoryForMaDiem('004'), null, 'lần 2: 004 không còn trong response -> PHẢI mất khỏi "CSDL" (ghi đè hoàn toàn, không cộng dồn)');
        assert.strictEqual(await getSystemInventoryForMaDiem('001'), null, 'lần 2: 001 cũng phải mất tương tự');
        const cache099 = await getSystemInventoryForMaDiem('099');
        assert.ok(cache099 && cache099.rows[0].maHang === 'C', 'lần 2: 099 (mới) phải có mặt');
        assert.strictEqual(Object.keys(store.systemInventorySnapshot.byMaDiem).length, 1, '"CSDL" chỉ còn ĐÚNG 1 mã điểm sau lần 2 — không phình to theo thời gian (đúng yêu cầu "không cần lịch sử, không sợ tốn diện tích")');
      } finally { cleanup(); }
    } finally {
      server.close();
      delete process.env.BRGMART_INVENTORY_API_KEY;
      delete process.env.BRGMART_INVENTORY_API_BASE_URL;
    }
  });

  await test('Lỗi mạng/server ở lần đồng bộ SAU -> giữ NGUYÊN snapshot cũ trong "CSDL" (không xoá/không ghi đè bằng rỗng)', async () => {
    let callCount = 0;
    const server = await startServer((req, res) => {
      callCount++;
      if (callCount <= 1) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ rows: [{ maDiem: '004', maHang: 'A', soLuongTon: 1 }] }));
        return;
      }
      // Mọi lượt gọi SAU đều lỗi auth (401, không retry) -> sync thất bại ngay.
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Sai API key' }));
    });
    const store = {};
    try {
      const port = server.address().port;
      process.env.BRGMART_INVENTORY_API_KEY = 'test-key';
      process.env.BRGMART_INVENTORY_API_BASE_URL = `http://127.0.0.1:${port}`;
      const { syncSystemInventory, getSystemInventoryForMaDiem, cleanup } = requireFreshInventorySync(store);
      try {
        const r1 = await syncSystemInventory();
        assert.strictEqual(r1.ok, true);
        const snapshotBefore = JSON.stringify(store.systemInventorySnapshot);
        const r2 = await syncSystemInventory();
        assert.strictEqual(r2.ok, false, 'lần 2 phải thất bại (401)');
        assert.strictEqual(JSON.stringify(store.systemInventorySnapshot), snapshotBefore, '"CSDL" phải GIỮ NGUYÊN y hệt snapshot lần 1, lỗi lần 2 không được đụng vào');
        const cache004 = await getSystemInventoryForMaDiem('004');
        assert.ok(cache004 && cache004.rows[0].maHang === 'A', 'màn Đối Chiếu vẫn phải thấy số liệu gần nhất, không trống trơn, dù lần đồng bộ sau lỗi');
      } finally { cleanup(); }
    } finally {
      server.close();
      delete process.env.BRGMART_INVENTORY_API_KEY;
      delete process.env.BRGMART_INVENTORY_API_BASE_URL;
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

  await test('v28.84: route PHẢI await getSystemInventoryForMaDiem() (hàm giờ đọc CSDL, bất đồng bộ — thiếu await sẽ luôn coi Promise là "có dữ liệu" rồi trả rows=undefined thay vì lỗi 404 rõ ràng)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'shelfStock.js'), 'utf8');
    assert.ok(/await getSystemInventoryForMaDiem\(/.test(src), 'thiếu "await" trước getSystemInventoryForMaDiem() — regression nghiêm trọng sau khi chuyển hàm này sang bất đồng bộ (v28.84)');
  });

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
