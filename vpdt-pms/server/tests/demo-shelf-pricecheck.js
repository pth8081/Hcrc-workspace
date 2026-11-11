// server/tests/demo-shelf-pricecheck.js
//
// DEMO thật (không phải bộ hồi quy tự động) — chụp ảnh tab MỚI "💲 Kiểm Tra Giá" (11/2026, theo yêu cầu
// người dùng: "siêu thị có thể kt nhanh giá của mặt hàng... chỉ hiện giá và ấn quét lại hoặc hủy nhé ko
// có lưu bất kỳ giá nào"). Dùng testHarness.js (Chromium thật mở public/index.html thật, backend mock
// mirror ĐÚNG route POST /api/shelf-stock/price-check — xem routes/shelfStock.js).
//
// Chạy: node server/tests/demo-shelf-pricecheck.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8989;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-pricecheck');

const USER = { username: 'nv1', name: 'Nguyễn Thị Hàng', dept: 'Siêu thị Quận 1', perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true };

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({ depts: [], stores: ['Siêu thị Quận 1'], users: [USER] });
  state.storeExternalCodes = { 'Siêu thị Quận 1': 'MD-Q1-0088' };
  state.__mockPriceCheckConfigured = true;
  state.__mockPriceCheckResults = {
    '2003330491': { maHang: '2003330491', tenHang: 'Sữa tươi TH True Milk 1L', maVach: '8934696001589', giaThuong: 24000, giaKhuyenMai: null, coKhuyenMai: false, capNhatLuc: new Date().toISOString() },
    '8934588012345': { maHang: '2003330999', tenHang: 'Nước suối Aquafina 500ml', maVach: '8934588012345', giaThuong: 10000, giaKhuyenMai: 8500, coKhuyenMai: true, capNhatLuc: new Date().toISOString() }
  };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 760 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(async () => { await switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubPriceCheck');
    await page.waitForTimeout(250);
    await shot(page, '#vanHanhShelfWrap', '01-form-trong.png');

    // Tra giá bằng Mã Hàng nội bộ — KHÔNG khuyến mại.
    await page.fill('#pcMaHang', '2003330491');
    await page.click('#priceCheckForm button[type="submit"]');
    await page.waitForTimeout(250);
    await shot(page, '#vanHanhShelfWrap', '02-ket-qua-khong-khuyen-mai.png');

    // 11/2026 ĐỢT 2: nút "🔄 Quét Lại" giờ mở THẲNG camera (rescanPriceCheck()) — demo này gõ tay mã kế
    // tiếp nên dùng "✖️ Hủy" (cancelPriceCheck(), vẫn quay về form trống) để tiếp tục, không phải Quét Lại.
    await page.click('#priceCheckResultWrap button[data-op="cancelPriceCheck"]');
    await page.waitForTimeout(150);

    // Tra giá bằng Mã Vạch EAN-13 (API bản 1.1) — CÓ khuyến mại.
    await page.fill('#pcMaHang', '8934588012345');
    await page.click('#priceCheckForm button[type="submit"]');
    await page.waitForTimeout(250);
    await shot(page, '#vanHanhShelfWrap', '03-ket-qua-co-khuyen-mai-tra-bang-ma-vach.png');

    await page.click('#priceCheckResultWrap button[data-op="cancelPriceCheck"]');
    await page.waitForTimeout(150);

    // Mã không tồn tại -> lỗi 404.
    await page.fill('#pcMaHang', 'MA_KHONG_TON_TAI');
    await page.click('#priceCheckForm button[type="submit"]');
    await page.waitForTimeout(250);
    await shot(page, '#vanHanhShelfWrap', '04-loi-khong-tim-thay-gia.png');
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n✅ Demo hoàn tất — ảnh chụp ở:', OUT_DIR);
})().catch(err => { console.error(err); process.exit(1); });
