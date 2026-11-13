// server/tests/demo-shelf-stock-filters.js
//
// DEMO xác nhận bộ lọc tìm kiếm MỚI cho 3 bảng Kiểm Soát Hàng Hóa (11/2026, theo yêu cầu người dùng kèm 3
// ảnh chụp: "20 ghi nhận gần nhất"/"⏰ Hạn Sử Dụng"/"🗄️ Quầy Kệ") — panel lọc mặc định THU GỌN, bấm nút để
// MỞ RA, trường lọc khác nhau theo ĐÚNG cột đã có ở từng bảng.
//
// Chạy: node server/tests/demo-shelf-stock-filters.js
'use strict';
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-stock-filters');

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8999;

  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true
  };
  const LOC_A = { id: 801, code: 'KE-A1', name: 'Kệ Mỹ Phẩm', category: 'Mỹ phẩm', dept: 'Siêu thị Quận 1', active: true };
  const LOC_B = { id: 802, code: 'KE-B2', name: 'Kệ Đồ Uống', category: 'Đồ uống', dept: 'Siêu thị Quận 1', active: false };
  const today = new Date();
  const pastDate = new Date(today.getTime() - 5 * 86400000).toISOString();
  const soonDate = new Date(today.getTime() + 3 * 86400000).toISOString();
  const futureDate = new Date(today.getTime() + 180 * 86400000).toISOString();
  const state = createMockState({
    depts: ['Siêu thị Quận 1'], users: [USER],
    shelfLocations: [LOC_A, LOC_B],
    shelfRecords: [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 801, shelfLocationCode: 'KE-A1', shelfLocationName: 'Kệ Mỹ Phẩm', maHang: 'SP001', maVach: '8930000000001', productName: 'Sữa rửa mặt A', quantity: 5, expiryDate: futureDate, creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: '08:00:00 13/11/2026', lastScannedAt: '08:00:00 13/11/2026', lastEditedBy: 'nv1', lastEditedByName: 'Nhân Viên 1', lastEditedAt: '08:00:00 13/11/2026' },
      { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 801, shelfLocationCode: 'KE-A1', shelfLocationName: 'Kệ Mỹ Phẩm', maHang: 'SP002', maVach: '8930000000002', productName: 'Kem dưỡng da B', quantity: 15, expiryDate: soonDate, creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: '08:05:00 13/11/2026', lastScannedAt: '08:05:00 13/11/2026' },
      { id: 3, dept: 'Siêu thị Quận 1', shelfLocationId: 802, shelfLocationCode: 'KE-B2', shelfLocationName: 'Kệ Đồ Uống', maHang: 'SP003', maVach: '8930000000003', productName: 'Nước suối C', quantity: 25, expiryDate: pastDate, creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: '08:10:00 13/11/2026', lastScannedAt: '08:10:00 13/11/2026' }
    ]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1200, height: 800 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubRecord');
    await page.waitForTimeout(100);

    // ===== 1) "📷 Ghi Nhận" — mở bộ lọc, gõ Mã Hàng =====
    await page.click('#btnToggleShelfRecordRecentFilter');
    await page.fill('#srfMaHang', 'SP002');
    await page.dispatchEvent('#srfMaHang', 'input');
    await page.waitForTimeout(100);
    await shot(page, '#vanHanhShelfWrap', '1-ghi-nhan-bo-loc-mo-va-loc-ma-hang.png');

    await page.click('[data-op="clearShelfRecordRecentFilters"]');
    await page.waitForTimeout(80);

    // ===== 2) "⏰ Hạn Sử Dụng" — mở bộ lọc, chọn Trạng Thái Hạn =====
    await page.click('#btnVhShelfSubExpiry');
    await page.waitForTimeout(100);
    await page.click('#btnToggleShelfExpiryFilter');
    await page.selectOption('#sefStatus', 'SOON');
    await page.waitForTimeout(100);
    await shot(page, '#vanHanhShelfWrap', '2-han-su-dung-bo-loc-mo-va-loc-trang-thai.png');

    await page.selectOption('#sefStatus', '');
    await page.waitForTimeout(80);

    // ===== 3) "🗄️ Quầy Kệ" — mở bộ lọc, gõ Mã Quầy Kệ =====
    await page.click('#btnVhShelfSubLocations');
    await page.waitForTimeout(100);
    await page.click('#btnToggleShelfLocationFilter');
    await page.fill('#slfCode', 'KE-A');
    await page.dispatchEvent('#slfCode', 'input');
    await page.waitForTimeout(100);
    await shot(page, '#vanHanhShelfWrap', '3-quay-ke-bo-loc-mo-va-loc-ma-quay-ke.png');

    console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
