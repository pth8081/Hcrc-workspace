// server/tests/demo-shelf-stock-pagination-and-nguoi-ghi-nhan.js
//
// DEMO (11/2026) tổng hợp CÁC THAY ĐỔI CHƯA DEMO cho người dùng xác nhận trước khi merge, theo đúng
// các yêu cầu liên tiếp trong đợt này:
//   1. "Người Ghi Nhận" (r.creatorName) hiện ở CẢ 2 bảng "📷 Ghi Nhận" và "⏰ Hạn Sử Dụng" (trước đây
//      chỉ có ở "📑 Báo Cáo").
//   2. Bỏ giới hạn "20 ghi nhận gần nhất" + PHÂN TRANG cho 5 bảng: Ghi Nhận, Quầy Kệ, Hạn Sử Dụng,
//      Đối Chiếu, Báo Cáo (dùng chung buildPaginationBoxHTML()/paginateList(), core.js).
//   3. Cột "Người Cập Nhật Gần Nhất" responsive (max-w-[110px] + break-words) — không kéo dãn bảng.
//   4. "🗄️ Quầy Kệ": ô lọc "Ngành Hàng" đổi sang kiểu tìm-kiếm-gõ-chọn (sdd*, không còn input tự do).
//
// Chạy: node server/tests/demo-shelf-stock-pagination-and-nguoi-ghi-nhan.js
'use strict';
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-stock-pagination');

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8996;

  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true
  };
  const CATS = ['Mỹ phẩm', 'Đồ uống', 'Bánh kẹo', 'Gia dụng'];
  const shelfLocations = Array.from({ length: 6 }, (_, i) => ({
    id: 900 + i, code: `KE-${i + 1}`, name: `Kệ Số ${i + 1}`, category: CATS[i % CATS.length], dept: 'Siêu thị Quận 1', active: true
  }));
  // 23 ghi nhận (> 1 trang mặc định 10 dòng/trang) để demo phân trang "📷 Ghi Nhận" + "Người Ghi Nhận".
  const shelfRecords = Array.from({ length: 23 }, (_, i) => ({
    id: i + 1, dept: 'Siêu thị Quận 1',
    shelfLocationId: 900 + (i % 6), shelfLocationCode: `KE-${(i % 6) + 1}`, shelfLocationName: `Kệ Số ${(i % 6) + 1}`,
    maHang: `SP${String(i + 1).padStart(3, '0')}`, maVach: `893000000${String(i + 1).padStart(4, '0')}`,
    productName: `Sản phẩm demo ${i + 1}`, quantity: 5 + i,
    expiryDate: new Date(Date.now() + (10 + i) * 86400000).toISOString(),
    creator: 'nv1', creatorName: 'Nhân Viên 1',
    createdAt: `08:${String(i).padStart(2, '0')}:00 13/11/2026`, lastScannedAt: `08:${String(i).padStart(2, '0')}:00 13/11/2026`,
    // 1 vài dòng đã có "Người Cập Nhật Gần Nhất" (tên DÀI để demo responsive) — còn lại chưa ai sửa ("—").
    ...(i % 5 === 0 ? { lastEditedBy: 'nv1', lastEditedByName: 'Nguyễn Thị Cập Nhật Tên Rất Dài Để Demo', lastEditedAt: `09:00:00 13/11/2026` } : {})
  }));

  const state = createMockState({
    depts: ['Siêu thị Quận 1'], users: [USER],
    shelfLocations, shelfRecords
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 850 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');

    // ===== 1) "📷 Ghi Nhận" — cột "Người Ghi Nhận" + phân trang (23 dòng, trang 1/3) =====
    await page.click('#btnVhShelfSubRecord');
    await page.waitForTimeout(150);
    await shot(page, '#vanHanhShelfWrap', '1-ghi-nhan-nguoi-ghi-nhan-va-phan-trang.png');

    // Sang trang 2 để xác nhận phân trang hoạt động thật (không chỉ hiện UI).
    await page.click('[data-op="goToListPage"][data-arg0="shelfRecordRecent"][data-arg1="2"]');
    await page.waitForTimeout(150);
    await shot(page, '#vanHanhShelfWrap', '2-ghi-nhan-sang-trang-2.png');

    // ===== 2) "⏰ Hạn Sử Dụng" — cột "Người Ghi Nhận" + Mã Vạch/Mã Hàng + phân trang =====
    await page.click('#btnVhShelfSubExpiry');
    await page.waitForTimeout(150);
    await shot(page, '#vanHanhShelfWrap', '3-han-su-dung-nguoi-ghi-nhan-va-phan-trang.png');

    // ===== 3) "🗄️ Quầy Kệ" — ô lọc "Ngành Hàng" kiểu tìm-kiếm-gõ-chọn (sdd*) + phân trang =====
    await page.click('#btnVhShelfSubLocations');
    await page.waitForTimeout(150);
    await page.click('#btnToggleShelfLocationFilter');
    await page.click('#slfCategory');
    await page.waitForTimeout(120);
    await shot(page, '#vanHanhShelfWrap', '4-quay-ke-loc-nganh-hang-searchable-mo-goi-y.png');
    await page.fill('#slfCategory', 'Đồ uống');
    await page.dispatchEvent('#slfCategory', 'input');
    await page.waitForTimeout(120);
    await shot(page, '#vanHanhShelfWrap', '5-quay-ke-loc-nganh-hang-da-chon.png');

    // ===== 4) "📑 Báo Cáo" — phân trang =====
    await page.click('#btnVhShelfSubReport');
    await page.waitForTimeout(250);
    await shot(page, '#vanHanhShelfWrap', '6-bao-cao-phan-trang.png');

    console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
