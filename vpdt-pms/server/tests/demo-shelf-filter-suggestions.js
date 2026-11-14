// tests/demo-shelf-filter-suggestions.js — DEMO ảnh thật cho tính năng MỚI "ô lọc tìm-kiếm-gõ-chọn,
// gợi ý THẬT từ dữ liệu đang có" trên 5 màn con "📋 Kiểm Soát Hàng Hóa" (12/2026, theo yêu cầu TRỰC TIẾP
// của người dùng kèm ảnh chụp "⏰ Hạn Sử Dụng": "nếu mà nó có thông tin trường bên dưới thì nó như là kiểu
// lọc có thông tin ấy, và đều drop list và có thể filter được... Tìm kiếm là gợi ý, người demo cho mình
// nhé"). Chạy: node server/tests/demo-shelf-filter-suggestions.js
'use strict';
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8994;
const OUT_DIR = process.env.SHELF_FILTER_SUGGEST_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-filter-suggestions');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const DEPT = 'Siêu thị Quận 1';
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: DEPT,
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true
  };
  const LOC_A = { id: 801, code: 'KE-A1', name: 'Kệ Mỹ Phẩm', category: 'Mỹ phẩm', dept: DEPT, active: true };
  const LOC_B = { id: 802, code: 'KE-B2', name: 'Kệ Đồ Uống', category: 'Đồ uống', dept: DEPT, active: true };
  const today = new Date();
  const todayIso = today.toISOString();
  const futureDate = new Date(today.getTime() + 180 * 86400000).toISOString();
  const state = createMockState({
    depts: [DEPT], users: [USER],
    shelfLocations: [LOC_A, LOC_B],
    shelfRecords: [
      { id: 1, dept: DEPT, shelfLocationId: 801, shelfLocationCode: 'KE-A1', shelfLocationName: 'Kệ Mỹ Phẩm', maHang: 'SP001', maVach: '8930000000001', productName: 'Sữa rửa mặt Simple A', quantity: 5, expiryDate: futureDate, creator: 'nv1', creatorName: 'Nhân Viên 1', lastEditedByName: 'Nhân Viên 1', createdAt: todayIso, lastScannedAt: todayIso },
      { id: 2, dept: DEPT, shelfLocationId: 802, shelfLocationCode: 'KE-B2', shelfLocationName: 'Kệ Đồ Uống', maHang: 'SP002', maVach: '8930000000002', productName: 'Nước suối Lavie 500ml', quantity: 15, expiryDate: futureDate, creator: 'nv1', creatorName: 'Nhân Viên 1', lastEditedByName: 'Nhân Viên 1', createdAt: todayIso, lastScannedAt: todayIso },
      { id: 3, dept: DEPT, shelfLocationId: 801, shelfLocationCode: 'KE-A1', shelfLocationName: 'Kệ Mỹ Phẩm', maHang: 'SP003', maVach: '8930000000003', productName: 'Kem dưỡng da Nivea', quantity: 8, expiryDate: futureDate, creator: 'nv1', creatorName: 'Nhân Viên 1', lastEditedByName: 'Nhân Viên 1', createdAt: todayIso, lastScannedAt: todayIso }
    ],
    shelfStockThresholds: [
      { id: 1, dept: DEPT, maHang: 'SP001', minQuantity: 10, active: true },
      { id: 2, dept: DEPT, maHang: 'SP002', minQuantity: 20, active: true },
      { id: 3, dept: DEPT, category: 'Mỹ phẩm', minQuantity: 15, active: true }
    ]
  });
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', tenHang: 'Sữa rửa mặt Simple A', soLuongTon: 5 },
    { maHang: 'SP002', tenHang: 'Nước suối Lavie 500ml', soLuongTon: 50 },
    { maHang: 'SP003', tenHang: 'Kem dưỡng da Nivea', soLuongTon: 8 }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1400, height: 1000 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => switchTab('vanHanh'));
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');

    // 1. Ghi Nhận — gõ "quay" (không dấu) vào ô Quầy Kệ, thấy gợi ý thật.
    await page.click('#btnVhShelfSubRecord');
    await page.waitForTimeout(150);
    await page.click('#btnToggleShelfRecordRecentFilter');
    await page.fill('#srfShelfLocation', 'do uong');
    await page.dispatchEvent('#srfShelfLocation', 'input');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '1-ghi-nhan-goi-y-quay-ke.png'), fullPage: true });
    console.log('Đã chụp: 1-ghi-nhan-goi-y-quay-ke.png');
    await page.locator('#srfShelfLocationDropdown [data-sdd-idx]').first().click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '2-ghi-nhan-sau-khi-chon-goi-y.png'), fullPage: true });
    console.log('Đã chụp: 2-ghi-nhan-sau-khi-chon-goi-y.png');
    await page.click('[data-op="clearShelfRecordRecentFilters"]');

    // 2. Hạn Sử Dụng — gõ mã hàng, thấy gợi ý thật.
    await page.click('#btnVhShelfSubExpiry');
    await page.waitForTimeout(150);
    await page.click('#btnToggleShelfExpiryFilter');
    await page.fill('#sefMaHang', 'SP0');
    await page.dispatchEvent('#sefMaHang', 'input');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '3-han-su-dung-goi-y-ma-hang.png'), fullPage: true });
    console.log('Đã chụp: 3-han-su-dung-goi-y-ma-hang.png');
    await page.click('[data-op="clearShelfExpiryFilters"]');

    // 3. Ngưỡng Tồn — panel lọc hoàn toàn MỚI, gõ ngành hàng, thấy gợi ý.
    await page.click('#btnVhShelfSubThreshold');
    await page.waitForTimeout(150);
    await page.click('#btnToggleShelfThresholdFilter');
    await page.fill('#stfCategory', 'my pham');
    await page.dispatchEvent('#stfCategory', 'input');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '4-nguong-ton-panel-loc-moi.png'), fullPage: true });
    console.log('Đã chụp: 4-nguong-ton-panel-loc-moi.png');
    await page.locator('#stfCategoryDropdown [data-sdd-idx]').first().click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '5-nguong-ton-sau-khi-loc.png'), fullPage: true });
    console.log('Đã chụp: 5-nguong-ton-sau-khi-loc.png');
    await page.click('[data-op="clearShelfThresholdFilters"]');

    // 4. Đối Chiếu — panel lọc hoàn toàn MỚI.
    await page.click('#btnVhShelfSubRecon');
    await page.waitForTimeout(300);
    await page.click('#btnToggleShelfReconFilter');
    await page.fill('#sconTenHang', 'nuoc');
    await page.dispatchEvent('#sconTenHang', 'input');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '6-doi-chieu-panel-loc-moi.png'), fullPage: true });
    console.log('Đã chụp: 6-doi-chieu-panel-loc-moi.png');
    await page.click('[data-op="clearShelfReconFilters"]');

    // 5. Báo Cáo — panel lọc theo-trường MỚI (độc lập với bộ lọc Siêu Thị cũ).
    await page.click('#btnVhShelfSubReport');
    await page.waitForTimeout(150);
    await page.click('#btnToggleShelfReportFilter');
    await page.fill('#srpProductName', 'kem');
    await page.dispatchEvent('#srpProductName', 'input');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '7-bao-cao-panel-loc-theo-truong-moi.png'), fullPage: true });
    console.log('Đã chụp: 7-bao-cao-panel-loc-theo-truong-moi.png');

    console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
