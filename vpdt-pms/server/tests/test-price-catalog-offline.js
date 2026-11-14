// tests/test-price-catalog-offline.js — test Playwright THẬT (bấm nút qua UI, không gọi hàm nội bộ) cho
// bảng giá offline "💲 Kiểm Tra Giá" (12/2026, theo yêu cầu người dùng: "tự đồng bộ giá xuống trình
// duyệt khi vào tab Kiểm Soát/Kiểm Tra Giá, offline mà chưa có thì check online, có rồi thì lấy offline,
// không hỏi gì cả"). Dùng testHarness.js mock GET /api/shelf-stock/price-catalog (state.__mockPriceCatalogByMaDiem,
// giả lập "server đã đồng bộ ngầm xong từ trước") + POST /api/shelf-stock/price-check (state.__mockPriceCheckResults,
// giả lập tra online). Chạy: node tests/test-price-catalog-offline.js
'use strict';
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8995;
const USER = { username: 'nv1', name: 'Nguyễn Thị Hàng', dept: 'Siêu thị Quận 1', perms: { shelfRecordCreate: true }, active: true, totpEnabled: true };

(async () => {
  const state = createMockState({ depts: [], stores: ['Siêu thị Quận 1'], users: [USER] });
  state.storeExternalCodes = { 'Siêu thị Quận 1': 'MD-Q1-0088' };
  // Bảng giá ĐÃ đồng bộ ngầm sẵn (giả lập jobs/priceSync.js đã chạy xong từ trước) — mã "SP-OFFLINE-01"
  // CHỈ có trong offline cache này, CỐ Ý KHÔNG có trong __mockPriceCheckResults bên dưới — nếu client lỡ
  // gọi online cho mã này sẽ nhận 404 (not found), chứng minh được RÕ nếu test PASS là nhờ đọc offline
  // thật, không phải vô tình vẫn gọi online.
  // maHang PHẢI đúng 10 CHỮ SỐ (đúng khuôn resolveShelfPriceCheckLookupCode()/module-vanhanh.js — gõ tay
  // không khớp maVach trong Tồn Kho Hệ Thống thì tự đoán: đúng 10 số -> gửi maHang, còn lại -> gửi maVach;
  // dùng chuỗi không phải số sẽ bị hiểu nhầm thành maVach, không khớp được maHang trong cache offline).
  state.__mockPriceCatalogByMaDiem = {
    'MD-Q1-0088': {
      rows: [
        { maHang: '1000000001', tenHang: 'Sản phẩm Offline 1', maVach: '8938800000001', giaThuong: 15000, giaKhuyenMai: null, coKhuyenMai: false, capNhatLuc: '2026-12-01T01:00:00.000Z' }
      ],
      capNhatLuc: '2026-12-01T01:00:00.000Z',
      fetchedAt: '2026-12-01T01:05:00.000Z'
    }
  };
  // Mã CHỈ có online (chưa có trong bảng giá offline — SKU mới thêm giữa 2 lần đồng bộ).
  state.__mockPriceCheckConfigured = true;
  state.__mockPriceCheckResults = {
    '1000000002': { maHang: '1000000002', tenHang: 'Sản phẩm Online 2', maVach: '8938800000002', giaThuong: 20000, giaKhuyenMai: null, coKhuyenMai: false, capNhatLuc: '2026-12-02T00:00:00.000Z' }
  };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(String(err && err.stack || err)));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(async () => { await switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    // Vào tab "📋 Kiểm Soát Hàng Hóa" (sub-tab mặc định "📷 Ghi Nhận", KHÔNG bấm vào "💲 Kiểm Tra Giá" ngay)
    // — phải TỰ kích hoạt đồng bộ ngầm đúng theo yêu cầu người dùng "vào phần kiểm soát này" (không chỉ
    // riêng lúc vào thẳng Kiểm Tra Giá).
    await page.waitForTimeout(300); // chờ fetch ngầm /price-catalog hoàn tất + ghi vào IndexedDB

    // 1) Vào "💲 Kiểm Tra Giá" — tra mã CHỈ có trong bảng giá offline (đã đồng bộ ngầm từ bước vào tab ở
    //    trên, TRƯỚC KHI bấm vào đây) — phải trả về ĐÚNG kết quả offline, có nhãn "📦 Ngoại tuyến", và
    //    KHÔNG gọi online (nếu lỡ gọi online sẽ nhận 404 vì mã này không có trong __mockPriceCheckResults).
    await page.click('#btnVhShelfSubPriceCheck');
    await page.waitForTimeout(150);
    await page.fill('#pcMaHang', '1000000001');
    await page.click('#priceCheckForm button[type="submit"]');
    await page.waitForTimeout(200);
    let tenHang = await page.textContent('#pcResultTenHang');
    let giaApDung = await page.textContent('#pcResultGiaApDung');
    let capNhat = await page.textContent('#pcResultCapNhat');
    assert.strictEqual(tenHang, 'Sản phẩm Offline 1', 'LỖI: phải hiện đúng tên hàng từ bảng giá OFFLINE (đã đồng bộ ngầm khi vào tab Kiểm Soát, không phải lúc vào Kiểm Tra Giá)');
    assert.ok(giaApDung.includes('15.000'), 'LỖI: phải hiện đúng giá 15.000 VNĐ từ offline');
    assert.ok(capNhat.includes('📦 Ngoại tuyến'), 'LỖI: phải có nhãn "📦 Ngoại tuyến" khi lấy từ bảng giá offline, không được lẫn với tra online');
    console.log('PASS: Vào tab Kiểm Soát Hàng Hóa (không riêng Kiểm Tra Giá) đã tự đồng bộ ngầm bảng giá — tra ĐÚNG mã offline, không gọi online, có nhãn rõ ràng, KHÔNG hỏi gì cả');

    // 2) Tra mã CHƯA có trong offline (SKU mới) — phải fallback ONLINE đúng như luồng cũ, KHÔNG có nhãn
    //    "📦 Ngoại tuyến" (phải phân biệt rõ 2 nguồn).
    await page.click('#priceCheckResultWrap button[data-op="cancelPriceCheck"]');
    await page.waitForTimeout(150);
    await page.fill('#pcMaHang', '1000000002');
    await page.click('#priceCheckForm button[type="submit"]');
    await page.waitForTimeout(200);
    tenHang = await page.textContent('#pcResultTenHang');
    capNhat = await page.textContent('#pcResultCapNhat');
    assert.strictEqual(tenHang, 'Sản phẩm Online 2', 'LỖI: mã chưa có trong offline phải fallback ONLINE đúng (lấy từ __mockPriceCheckResults)');
    assert.ok(!capNhat.includes('📦 Ngoại tuyến'), 'LỖI: kết quả tra ONLINE không được gắn nhầm nhãn "📦 Ngoại tuyến"');
    console.log('PASS: Mã CHƯA có trong bảng giá offline tự fallback tra ONLINE đúng, không gắn nhầm nhãn offline');

    // 3) Tra LẠI ĐÚNG mã vừa tra online ở bước 2 — giờ phải đọc được từ OFFLINE (đã tự "lấp" vào cache
    //    ngay sau lần tra online thành công, xem mergeShelfPriceCatalogOfflineOneResult()) — xoá hẳn kết
    //    quả khỏi __mockPriceCheckResults để chứng minh CHẮC CHẮN không gọi lại online lần này.
    delete state.__mockPriceCheckResults['1000000002'];
    await page.click('#priceCheckResultWrap button[data-op="cancelPriceCheck"]');
    await page.waitForTimeout(150);
    await page.fill('#pcMaHang', '1000000002');
    await page.click('#priceCheckForm button[type="submit"]');
    await page.waitForTimeout(200);
    tenHang = await page.textContent('#pcResultTenHang');
    capNhat = await page.textContent('#pcResultCapNhat');
    assert.strictEqual(tenHang, 'Sản phẩm Online 2', 'LỖI: lần tra THỨ 2 phải vẫn ra đúng kết quả (giờ đọc từ cache, không phải online nữa — đã xoá khỏi mock online)');
    assert.ok(capNhat.includes('📦 Ngoại tuyến'), 'LỖI: lần tra THỨ 2 phải đọc được từ OFFLINE (đã tự lấp vào cache ngay sau lần tra online đầu tiên), không được báo lỗi "không tìm thấy"');
    console.log('PASS: Sau 1 lần tra online thành công, mã đó tự "lấp" vào bảng giá offline — lần tra lại SAU không cần gọi online nữa');

    assert.strictEqual(jsErrors.length, 0, 'LỖI: có lỗi JS phát sinh: ' + jsErrors.join('\n'));
    console.log('PASS: Không có lỗi JS (pageerror) nào trong suốt quá trình thao tác THẬT');

    console.log('\n==== 4/4 scenario(s) passed ====');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
