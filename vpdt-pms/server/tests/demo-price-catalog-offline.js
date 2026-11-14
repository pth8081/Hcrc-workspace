// tests/demo-price-catalog-offline.js — demo Playwright THẬT chụp màn hình cho tính năng "💲 Kiểm Tra
// Giá" — đồng bộ ngầm bảng giá offline (12/2026). Dùng để gửi người dùng xác nhận trước khi push main.
// Chạy: node tests/demo-price-catalog-offline.js — ảnh lưu ở demo-screenshots/price-catalog-offline/.
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8996;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'price-catalog-offline');
const USER = { username: 'nv1', name: 'Nguyễn Thị Hàng', dept: 'Siêu thị Quận 1', perms: { shelfRecordCreate: true }, active: true, totpEnabled: true };

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({ depts: [], stores: ['Siêu thị Quận 1'], users: [USER] });
  state.storeExternalCodes = { 'Siêu thị Quận 1': 'MD-Q1-0088' };
  // Bảng giá ĐÃ đồng bộ ngầm sẵn (giả lập server đã chạy jobs/priceSync.js xong từ đêm trước) — 2 mã.
  state.__mockPriceCatalogByMaDiem = {
    'MD-Q1-0088': {
      rows: [
        { maHang: '1000000001', tenHang: 'Sữa tươi TH True Milk 1L', maVach: '8938800000001', giaThuong: 24000, giaKhuyenMai: null, coKhuyenMai: false, capNhatLuc: '2026-12-01T01:00:00.000Z' },
        { maHang: '1000000003', tenHang: 'Nước suối Aquafina 500ml', maVach: '8938800000003', giaThuong: 10000, giaKhuyenMai: 8500, coKhuyenMai: true, capNhatLuc: '2026-12-01T01:00:00.000Z' }
      ],
      capNhatLuc: '2026-12-01T01:00:00.000Z',
      fetchedAt: '2026-12-01T01:05:00.000Z'
    }
  };
  // Mã CHỈ có online (SKU mới thêm giữa 2 lần đồng bộ ngầm, chưa kịp có trong bảng giá offline).
  state.__mockPriceCheckConfigured = true;
  state.__mockPriceCheckResults = {
    '1000000002': { maHang: '1000000002', tenHang: 'Bánh mì sandwich Kinh Đô', maVach: '8938800000002', giaThuong: 18000, giaKhuyenMai: null, coKhuyenMai: false, capNhatLuc: '2026-12-02T00:00:00.000Z' }
  };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 760 });
  page.on('dialog', (d) => d.accept().catch(() => {}));

  let n = 0;
  const shot = async (label) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${label}.png`;
    await page.locator('#vanHanhShelfWrap').screenshot({ path: path.join(OUT_DIR, file) });
    console.log(`📸 ${file}`);
  };

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(async () => { await switchTab('vanHanh'); });

    // 1) Vào tab "📋 Kiểm Soát Hàng Hóa" (sub-tab mặc định "📷 Ghi Nhận") — KHÔNG có hộp thoại/thông báo
    //    nào hiện ra, nhưng NGẦM đã tự gọi GET /api/shelf-stock/price-catalog và lưu vào IndexedDB.
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.waitForTimeout(350); // chờ fetch ngầm hoàn tất
    await shot('vao-tab-kiem-soat-khong-co-hop-thoai-nao');

    // 2) Vào "💲 Kiểm Tra Giá" — form trống ban đầu.
    await page.click('#btnVhShelfSubPriceCheck');
    await page.waitForTimeout(150);
    await shot('tab-kiem-tra-gia-form-trong');

    // 3) Tra mã CÓ trong bảng giá offline (không khuyến mại) — phải ra kết quả NGAY, nhãn "📦 Ngoại tuyến".
    await page.fill('#pcMaHang', '1000000001');
    await page.click('#priceCheckForm button[type="submit"]');
    await page.waitForTimeout(150);
    await shot('tra-gia-offline-khong-khuyen-mai');

    // 4) Tra mã CÓ trong bảng giá offline, CÓ khuyến mại — vẫn đọc offline, hiện giá khuyến mại + gạch ngang.
    await page.click('#priceCheckResultWrap button[data-op="cancelPriceCheck"]');
    await page.waitForTimeout(100);
    await page.fill('#pcMaHang', '1000000003');
    await page.click('#priceCheckForm button[type="submit"]');
    await page.waitForTimeout(150);
    await shot('tra-gia-offline-co-khuyen-mai');

    // 5) Tra mã CHƯA có trong bảng giá offline (SKU mới) — fallback ONLINE, KHÔNG có nhãn "📦 Ngoại tuyến".
    await page.click('#priceCheckResultWrap button[data-op="cancelPriceCheck"]');
    await page.waitForTimeout(100);
    await page.fill('#pcMaHang', '1000000002');
    await page.click('#priceCheckForm button[type="submit"]');
    await page.waitForTimeout(150);
    await shot('tra-gia-online-fallback-sku-moi');

    // 6) Tra LẠI ĐÚNG mã vừa tra online — giờ đã tự "lấp" vào offline, xoá mock online để chứng minh chắc
    //    chắn không gọi lại server (nếu gọi lại sẽ lỗi "không tìm thấy").
    delete state.__mockPriceCheckResults['1000000002'];
    await page.click('#priceCheckResultWrap button[data-op="cancelPriceCheck"]');
    await page.waitForTimeout(100);
    await page.fill('#pcMaHang', '1000000002');
    await page.click('#priceCheckForm button[type="submit"]');
    await page.waitForTimeout(150);
    await shot('tra-lai-sku-moi-da-tu-luu-offline');

    console.log(`\n==== Đã chụp ${n} ảnh vào ${OUT_DIR} ====`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
