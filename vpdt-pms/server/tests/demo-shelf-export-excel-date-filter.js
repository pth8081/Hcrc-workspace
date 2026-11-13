// server/tests/demo-shelf-export-excel-date-filter.js
//
// DEMO (11/2026, theo yêu cầu người dùng: "tôi muốn có phần xuất ra Excel... trước khi xuất ra Excel,
// tôi muốn có bộ lọc để xuất ra Excel... lọc theo ngày tháng năm... thời gian ghi nhận. Thời gian hết
// hạn") — "⏰ Hạn Sử Dụng" nay có bộ lọc khoảng ngày (Thời Gian Ghi Nhận + Hạn Sử Dụng) + nút "📥 Xuất
// Excel" (dùng đúng bộ lọc đang áp dụng); "📊 Đối Chiếu" có nút Xuất Excel (không có bộ lọc ngày, theo
// xác nhận của người dùng); "📑 Báo Cáo" Excel có thêm cột Mã Vạch.
//
// Chạy: node server/tests/demo-shelf-export-excel-date-filter.js
'use strict';
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-export-excel-date-filter');

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8993;

  const USER = { username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1', perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true };
  const today = new Date();
  const createdNear = new Date(today.getTime() - 2 * 86400000).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const createdFar = new Date(today.getTime() - 25 * 86400000).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  const state = createMockState({
    depts: ['Siêu thị Quận 1'], users: [USER],
    shelfLocations: [{ id: 1, code: 'KA1', name: 'Kệ Bánh Kẹo', category: 'Bánh kẹo', dept: 'Siêu thị Quận 1', active: true }],
    shelfRecords: [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationCode: 'KA1', shelfLocationName: 'Kệ Bánh Kẹo', maHang: 'SP001', maVach: '8930000000001', productName: 'Bánh quy bơ', quantity: 5, expiryDate: new Date(today.getTime() + 5 * 86400000).toISOString(), creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: createdNear, lastScannedAt: createdNear },
      { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationCode: 'KA1', shelfLocationName: 'Kệ Bánh Kẹo', maHang: 'SP002', maVach: '8930000000002', productName: 'Kẹo dẻo trái cây', quantity: 9, expiryDate: new Date(today.getTime() + 60 * 86400000).toISOString(), creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: createdFar, lastScannedAt: createdFar }
    ],
    __mockSystemInventoryRows: [
      { maHang: 'SP001', tenHang: 'Bánh quy bơ', soLuongTon: 5 },
      { maHang: 'SP002', tenHang: 'Kẹo dẻo trái cây', soLuongTon: 100 }
    ]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 900 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');

    // ===== 1) "⏰ Hạn Sử Dụng" — mở bộ lọc, thấy nút "📥 Xuất Excel" + 2 ô lọc khoảng ngày mới =====
    await page.click('#btnVhShelfSubExpiry');
    await page.waitForTimeout(150);
    await page.click('#btnToggleShelfExpiryFilter');
    await page.waitForTimeout(100);
    await shot(page, '#vanHanhShelfWrap', '1-han-su-dung-co-nut-xuat-excel-va-loc-ngay.png');

    // ===== 2) Gõ "Thời Gian Ghi Nhận Từ" -> chỉ còn 1 dòng (SP001, ghi nhận gần đây) =====
    const fromDateStr = new Date(today.getTime() - 5 * 86400000).toISOString().slice(0, 10);
    await page.fill('#sefCreatedFrom', fromDateStr);
    await page.dispatchEvent('#sefCreatedFrom', 'change');
    await page.waitForTimeout(150);
    await shot(page, '#vanHanhShelfWrap', '2-han-su-dung-loc-thoi-gian-ghi-nhan-tu.png');

    await page.click('[data-op="clearShelfExpiryFilters"]');
    await page.waitForTimeout(120);

    // ===== 3) "📊 Đối Chiếu" — có nút Xuất Excel, không có bộ lọc ngày =====
    await page.click('#btnVhShelfSubRecon');
    await page.waitForTimeout(300);
    await shot(page, '#vanHanhShelfWrap', '3-doi-chieu-co-nut-xuat-excel.png');

    // ===== 4) "📑 Báo Cáo" — vẫn như cũ, Excel nay có thêm cột Mã Vạch (không thể chụp trong file Excel,
    //          chỉ xác nhận qua test riêng test-shelf-export-excel-expiry-recon.js) =====

    console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
