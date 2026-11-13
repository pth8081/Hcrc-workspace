// server/tests/demo-shelf-store-picker-and-sl-width.js
//
// DEMO xác nhận 3 thay đổi người dùng yêu cầu (11/2026, kèm 2 ảnh chụp thật):
//
//  1. (Ảnh 1) Ô "SL hiện tại" ở cụm nút Sửa/Xóa/Cập Nhật/Bán Hết (📷 Ghi Nhận, bảng "20 ghi nhận gần
//     nhất"/"⏰ Hạn Sử Dụng") bị thu gọn (w-16 = 64px) khiến placeholder "SL hiện tại" bị cắt cụt trên cả
//     mobile lẫn desktop -> nới rộng (w-24 = 96px) để hiện đủ chữ.
//  2. (Ảnh 2, ô đỏ TRÊN) "📍 Chọn Siêu Thị Để Thao Tác" (quyền shelfAnyStoreAccess) — ĐỔI từ SELECT
//     thường sang ô tìm-kiếm-gõ-chọn ĐƠN (sdd*) — gõ tên siêu thị để tìm, chỉ chọn ĐÚNG 1 siêu thị tại 1
//     thời điểm để thao tác (Ghi Nhận/Quầy Kệ/Kiểm Tra Giá...).
//  3. (Ảnh 2, ô đỏ DƯỚI) "📑 Báo Cáo" > bộ lọc "Siêu Thị" — ĐỔI từ SELECT đơn sang widget CHỌN NHIỀU
//     (renderMultiSelectDropdown()) — chọn nhiều siêu thị cùng lúc để xem báo cáo tổng hợp của ĐÚNG các
//     siêu thị đã chọn (để trống = xem tất cả, giữ nguyên ngữ nghĩa cũ).
//
// Chạy: node server/tests/demo-shelf-store-picker-and-sl-width.js
'use strict';
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-store-picker-and-sl-width');

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8995;

  const STORES = ['Siêu thị Sài Đồng', 'Siêu thị số 8 Phạm Ngọc Thạch', 'Siêu thị Quận 1', 'Siêu thị Quận 3', 'Siêu thị Quận 7'];
  const ADMIN = { username: 'admin1', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true, totpEnabled: true };
  const state = createMockState({ depts: ['Phòng IT', ...STORES], stores: STORES, users: [ADMIN] });
  state.storeExternalCodes = Object.fromEntries(STORES.map((s, i) => [s, String(100 + i)]));
  // Dữ liệu ghi nhận ở NHIỀU siêu thị để Báo Cáo tự "nở" thêm bộ lọc (chỉ hiện khi >1 siêu thị, xem
  // populateShelfReportStoreFilter()).
  state.shelfRecords = [
    { id: 1, dept: 'Siêu thị Sài Đồng', maHang: '2005260612', productName: 'SKIN AQUA -Tone Up UV Essence 50g', quantity: 4, lastScannedAt: '08:00:00 13/11/2026', createdAt: '08:00:00 13/11/2026' },
    { id: 2, dept: 'Siêu thị số 8 Phạm Ngọc Thạch', maHang: '2002092675', productName: 'G7_Cà phê 3 in 1 - Hộp 18×16g T24', quantity: 10, lastScannedAt: '08:05:00 13/11/2026', createdAt: '08:05:00 13/11/2026' },
    { id: 3, dept: 'Siêu thị Quận 1', maHang: 'SP001', productName: 'Sản phẩm 1', quantity: 7, lastScannedAt: '08:10:00 13/11/2026', createdAt: '08:10:00 13/11/2026' }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 420, height: 900 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(async () => { await switchTab('vanHanh'); });
    await page.waitForSelector('[data-op="setVanHanhSubTab"][data-tab="SHELF"]', { state: 'visible' });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.waitForTimeout(150);

    // ===== 2) Ô tìm-kiếm-gõ-chọn ĐƠN "Chọn Siêu Thị Để Thao Tác" =====
    await shot(page, '#vanHanhShelfStoreOverrideWrap', '1-truoc-khi-go-ten-sieu-thi.png');
    await page.click('#vanHanhShelfStoreOverrideSearchInput');
    await page.fill('#vanHanhShelfStoreOverrideSearchInput', 'Sài Đồng');
    await page.waitForTimeout(100);
    // Khung gợi ý sdd* là position:fixed (nổi riêng, thoát khỏi khung #vanHanhShelfStoreOverrideWrap) ->
    // chụp TOÀN TRANG mới thấy được, chụp đúng khung cha sẽ bị cắt mất khung gợi ý.
    await page.screenshot({ path: path.join(OUT_DIR, '2-go-tim-hien-goi-y.png') });
    console.log('📸 2-go-tim-hien-goi-y.png');
    await page.click('#vanHanhShelfStoreOverrideDropdown [data-sdd-idx="0"]');
    await page.waitForTimeout(150);
    await shot(page, '#vanHanhShelfStoreOverrideWrap', '3-da-chon-1-sieu-thi-de-thao-tac.png');
    const overrideResult = await page.evaluate(() => ({
      effectiveDept: getEffectiveShelfDept(),
      confirmText: document.getElementById('vanHanhShelfStoreOverrideConfirm').textContent
    }));
    console.log('[Chọn Siêu Thị Để Thao Tác]', overrideResult);
    console.log(overrideResult.effectiveDept === 'Siêu thị Sài Đồng' && overrideResult.confirmText.includes('Sài Đồng')
      ? '✅ ĐÚNG — gõ tìm + bấm chọn 1 gợi ý tự áp dụng ĐÚNG 1 siêu thị để thao tác, không cần select thường.'
      : '⛔ SAI — kiểm tra lại.');

    // ===== 1) Ô "SL hiện tại" đủ rộng ở "📷 Ghi Nhận" ("20 ghi nhận gần nhất") =====
    await page.click('#btnVhShelfSubRecord');
    await page.waitForTimeout(150);
    await page.locator('[id^="srQuickQty_"]').scrollIntoViewIfNeeded();
    // Chụp sát ĐÚNG cụm "SL hiện tại [input] 💾 Cập Nhật" (span cha trực tiếp của input) — cùng đúng cụm
    // bị cắt cụt chữ trong ảnh chụp người dùng gửi, không cần chụp nguyên trang.
    await shot(page, '[id^="srQuickQty_"] >> xpath=..', '4-sl-hien-tai-du-rong.png');
    const qtyInputBox = await page.evaluate(() => {
      const el = document.querySelector('[id^="srQuickQty_"]');
      return el ? { placeholder: el.placeholder, width: el.getBoundingClientRect().width } : null;
    });
    console.log('[Ô "SL hiện tại"]', qtyInputBox);

    // ===== 3) "📑 Báo Cáo" — bộ lọc Siêu Thị CHỌN NHIỀU =====
    await page.click('#btnVhShelfSubReport');
    await page.waitForTimeout(200);
    await shot(page, '#vanHanhShelfReportWrap', '5-bao-cao-truoc-khi-loc.png');
    await page.click('#shelfReportStoreFilterMultiSelect [data-pms-search]');
    await page.fill('#shelfReportStoreFilterMultiSelect [data-pms-search]', 'Sài Đồng');
    await page.waitForTimeout(80);
    await page.click('#shelfReportStoreFilterMultiSelect [data-op="gmsAdd"]:has-text("Sài Đồng")');
    await page.waitForTimeout(80);
    await page.fill('#shelfReportStoreFilterMultiSelect [data-pms-search]', 'Phạm Ngọc Thạch');
    await page.waitForTimeout(80);
    await page.click('#shelfReportStoreFilterMultiSelect [data-op="gmsAdd"]:has-text("Phạm Ngọc Thạch")');
    await page.waitForTimeout(150);
    await shot(page, '#vanHanhShelfReportWrap', '6-bao-cao-da-chon-2-sieu-thi.png');
    const reportResult = await page.evaluate(() => ({
      selected: getMultiSelectValues('shelfReportStoreFilterMultiSelect'),
      rowDepts: Array.from(document.querySelectorAll('#shelfReportBody tr td:first-child')).map(td => td.textContent.trim())
    }));
    console.log('[Báo Cáo — chọn nhiều siêu thị]', reportResult);
    console.log(
      reportResult.selected.length === 2 &&
      reportResult.rowDepts.every(d => d === 'Siêu thị Sài Đồng' || d === 'Siêu thị số 8 Phạm Ngọc Thạch') &&
      reportResult.rowDepts.length === 2
        ? '✅ ĐÚNG — chọn 2 siêu thị, bảng báo cáo CHỈ còn đúng 2 dòng của 2 siêu thị đã chọn, không lẫn siêu thị Quận 1.'
        : '⛔ SAI — kiểm tra lại.'
    );

    console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
