// server/tests/demo-shelf-record-create-can-edit.js
//
// DEMO xác nhận: người chỉ có quyền "📷 Ghi Nhận Trên Kệ" (shelfRecordCreate — Ảnh 1 người dùng gửi, ô
// "Quản Lý Danh Mục Quầy Kệ" KHÔNG tick) nay tự Sửa/Cập Nhật nhanh/Bán Hết/Xóa được ngay trên bảng ghi
// nhận (Ảnh 2) — trước đây bấm vào các nút này đều bị server báo lỗi "Bạn không có quyền sửa/xóa Ghi
// Nhận Trên Kệ (cần quyền quản lý Quầy Kệ)" dù nút vẫn hiện ra bình thường.
//
// Chạy: node server/tests/demo-shelf-record-create-can-edit.js
'use strict';
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-record-create-can-edit');

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8997;

  // CHỈ shelfRecordCreate — KHÔNG shelfLocationManage, KHÔNG admin (đúng ảnh 1: chỉ tick "📷 Ghi Nhận
  // Trên Kệ").
  const USER = {
    username: 'nv1', name: 'Nhân Viên Ghi Nhận', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true
  };
  const SHELF_LOCATION = { id: 701, code: 'NF19', name: 'Kem chống nắng/Nước tẩy trang/Son', category: 'Mỹ phẩm', dept: 'Siêu thị Quận 1', active: true };
  const state = createMockState({
    depts: ['Siêu thị Quận 1'], users: [USER],
    shelfLocations: [SHELF_LOCATION],
    shelfRecords: [
      { id: 9001, dept: 'Siêu thị Quận 1', shelfLocationId: 701, shelfLocationCode: 'NF19', maHang: '2005260612', maVach: '', productName: 'SKIN AQUA -Tone Up UV Essence 50g', quantity: 4, expiryDate: '2029-05-14T00:00:00.000Z', note: '', creator: 'nv1', creatorName: 'Nhân Viên Ghi Nhận', lastScannedAt: '16:02:14 13/11/2026', createdAt: '16:02:14 13/11/2026' }
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

    await shot(page, '#vanHanhShelfWrap', '1-truoc-khi-thao-tac.png');

    // "✏️ Sửa" -> đổi số lượng, lưu.
    await page.click('[data-op="enterShelfRecordEditMode"][data-arg0="9001"]');
    await page.waitForTimeout(50);
    await page.fill('#srEditQuantity_recent_9001', '7');
    await page.click('[data-op="saveShelfRecordEdit"][data-arg0="9001"]');
    await page.waitForTimeout(100);
    const afterEdit = await page.evaluate(() => DB.shelfRecords.find(r => r.id === 9001));
    console.log('[Sau khi bấm "✏️ Sửa" -> đổi SL 4 -> 7]', { quantity: afterEdit.quantity });
    await shot(page, '#vanHanhShelfWrap', '2-sau-khi-sua-khong-bi-403.png');

    // "💾 Cập Nhật" (ô SL hiện tại).
    await page.fill('#srQuickQty_recent_9001', '12');
    await page.click('[data-op="quickUpdateShelfRecordQuantity"][data-arg0="9001"]');
    await page.waitForTimeout(100);
    const afterQuick = await page.evaluate(() => DB.shelfRecords.find(r => r.id === 9001));
    console.log('[Sau khi bấm "💾 Cập Nhật" -> SL 7 -> 12]', { quantity: afterQuick.quantity });
    await shot(page, '#vanHanhShelfWrap', '3-sau-khi-cap-nhat-nhanh.png');

    // "✅ Bán Hết".
    page.once('dialog', d => d.accept());
    await page.click('[data-op="markShelfRecordSoldOut"][data-arg0="9001"]');
    await page.waitForTimeout(100);
    const afterSoldOut = await page.evaluate(() => DB.shelfRecords.find(r => r.id === 9001));
    console.log('[Sau khi bấm "✅ Bán Hết"]', { quantity: afterSoldOut.quantity });
    await shot(page, '#vanHanhShelfWrap', '4-sau-khi-ban-het.png');

    const allOk = afterEdit.quantity === 7 && afterQuick.quantity === 12 && afterSoldOut.quantity === 0;
    console.log(allOk
      ? '✅ ĐÃ VÁ — quyền "📷 Ghi Nhận Trên Kệ" (shelfRecordCreate) nay tự Sửa/Cập Nhật/Bán Hết được, không còn bị 403 "cần quyền quản lý Quầy Kệ".'
      : '⛔ SAI — kiểm tra lại.');

    console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
