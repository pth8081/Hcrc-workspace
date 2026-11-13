// server/tests/demo-shelf-record-shelf-location-filter.js
//
// DEMO (11/2026, theo yêu cầu người dùng: "Chỗ lọc tìm kiếm của Ghi Nhận bạn đã thêm lọc theo quầy
// kệ chưa?" -> "Nếu chưa thì làm luôn và gửi demo đi") — bảng "📷 Ghi Nhận" trước đây chưa có ô lọc
// Quầy Kệ (trong khi "⏰ Hạn Sử Dụng" đã có), giờ thêm #srfShelfLocation cùng khuôn với #sefShelfLocation.
//
// Chạy: node server/tests/demo-shelf-record-shelf-location-filter.js
'use strict';
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-record-shelf-location-filter');

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8995;

  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true
  };
  const shelfLocations = [
    { id: 801, code: 'KE-A1', name: 'Kệ Mỹ Phẩm', category: 'Mỹ phẩm', dept: 'Siêu thị Quận 1', active: true },
    { id: 802, code: 'KE-B2', name: 'Kệ Đồ Uống', category: 'Đồ uống', dept: 'Siêu thị Quận 1', active: true }
  ];
  const shelfRecords = [
    { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 801, shelfLocationCode: 'KE-A1', shelfLocationName: 'Kệ Mỹ Phẩm', maHang: 'SP001', maVach: '8930000000001', productName: 'Sữa rửa mặt A', quantity: 5, creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: '08:00:00 13/11/2026', lastScannedAt: '08:00:00 13/11/2026' },
    { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 802, shelfLocationCode: 'KE-B2', shelfLocationName: 'Kệ Đồ Uống', maHang: 'SP002', maVach: '8930000000002', productName: 'Nước suối B', quantity: 15, creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: '08:05:00 13/11/2026', lastScannedAt: '08:05:00 13/11/2026' },
    { id: 3, dept: 'Siêu thị Quận 1', shelfLocationId: 802, shelfLocationCode: 'KE-B2', shelfLocationName: 'Kệ Đồ Uống', maHang: 'SP003', maVach: '8930000000003', productName: 'Nước ngọt C', quantity: 25, creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: '08:10:00 13/11/2026', lastScannedAt: '08:10:00 13/11/2026' }
  ];

  const state = createMockState({ depts: ['Siêu thị Quận 1'], users: [USER], shelfLocations, shelfRecords });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 800 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubRecord');
    await page.click('#btnToggleShelfRecordRecentFilter');
    await page.waitForTimeout(120);
    await shot(page, '#vanHanhShelfWrap', '1-ghi-nhan-co-o-loc-quay-ke.png');

    await page.fill('#srfShelfLocation', 'KE-B2');
    await page.dispatchEvent('#srfShelfLocation', 'input');
    await page.waitForTimeout(120);
    await shot(page, '#vanHanhShelfWrap', '2-ghi-nhan-loc-quay-ke-chi-con-2-dong.png');

    const rowCount = await page.evaluate(() => document.querySelectorAll('#vhShelfRecordRecentBody tr').length);
    console.log('Số dòng sau khi lọc Quầy Kệ "KE-B2" (phải là 2, SP002+SP003):', rowCount);

    console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
