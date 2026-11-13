// server/tests/demo-shelf-expiry-duplicate-mahang.js
//
// DEMO thật (Playwright) — theo báo cáo người dùng kèm 2 ảnh chụp màn hình thật (11/2026): cùng 1 mã
// hàng hiện "0" ở cột "Tồn Kho Hệ Thống" trong tab "⏰ Hạn Sử Dụng" nhưng hiện "8" ở tab "📊 Đối Chiếu".
// Nguyên nhân: cả 2 tab đọc CÙNG dữ liệu thô (API Tồn Kho BRGMART có thể trả NHIỀU dòng cho CÙNG 1 mã
// hàng) nhưng tab Đối Chiếu đã được vá CỘNG GỘP (v29.76, scope=recon), còn tab Hạn Sử Dụng vẫn dùng
// `findSystemInventoryQtyForProduct()` kiểu `.find()` — chỉ lấy ĐÚNG dòng ĐẦU TIÊN khớp, bỏ qua các dòng
// còn lại, nên 2 tab lệch số cho CÙNG 1 mã hàng dù cùng 1 nguồn. Đã vá hàm đó sang CỘNG DỒN mọi dòng khớp
// (cùng bản chất gộp đã áp dụng cho Đối Chiếu) — demo này xác nhận sau khi vá, CẢ 2 tab hiện CÙNG 1 số.
//
// Chạy: node server/tests/demo-shelf-expiry-duplicate-mahang.js
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8996;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-expiry-duplicate-mahang');

const USER = { username: 'nv1', name: 'Nguyễn Thị Hàng', dept: 'Siêu thị Quận 1', perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true };

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({ depts: [], stores: ['Siêu thị Quận 1'], users: [USER] });
  // SP002 có 2 DÒNG tồn kho hệ thống (0 và 8) — ĐÚNG kịch bản ảnh chụp người dùng gửi.
  state.__mockSystemInventoryRows = [
    { maHang: 'SP002', tenHang: 'Sữa tươi HCRC 1L', soLuongTon: 0 },
    { maHang: 'SP002', tenHang: 'Sữa tươi HCRC 1L', soLuongTon: 8 }
  ];
  const today = new Date().toISOString();
  state.shelfRecords = [
    { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationLabel: 'KA1 — Kệ bánh kẹo', productName: 'Sữa tươi HCRC 1L', maHang: 'SP002', tenHang: 'Sữa tươi HCRC 1L', quantity: 8, expiryDate: '2026-11-30', note: '', createdAt: today, lastScannedAt: today }
  ];
  state.shelfLocations = [{ id: 1, dept: 'Siêu thị Quận 1', code: 'KA1', name: 'Kệ bánh kẹo', active: true }];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 760 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');

    // Tab "⏰ Hạn Sử Dụng" (SP001 không cần — chỉ cần đúng 1 mã trùng để demo rõ).
    await page.click('#btnVhShelfSubExpiry');
    await page.waitForTimeout(300);
    await shot(page, '#vanHanhShelfWrap', '01-han-su-dung-gop-trung-ma-hang.png');

    const expiryStock = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#vhShelfExpiryBody tr')).find(tr => tr.children[1]?.textContent.trim() === 'Sữa tươi HCRC 1L');
      return row ? row.children[7]?.textContent.trim() : null;
    });
    console.log('Tab Hạn Sử Dụng — Tồn Kho Hệ Thống (phải là 8, tổng 0+8):', expiryStock);
    assert.strictEqual(expiryStock, '8', 'LỖI: tab Hạn Sử Dụng phải hiện 8 (tổng 0+8), không phải chỉ dòng đầu (0)');

    // Tab "📊 Đối Chiếu" — xác nhận CÙNG 1 số (8) với tab Hạn Sử Dụng, không lệch nhau nữa.
    await page.click('#btnVhShelfSubRecon');
    await page.waitForTimeout(300);
    await shot(page, '#vanHanhShelfWrap', '02-doi-chieu-cung-so-lieu.png');
    const reconStock = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#vhShelfReconBody tr')).find(tr => tr.children[0]?.textContent.trim() === 'SP002');
      return row ? row.children[2]?.textContent.trim() : null;
    });
    console.log('Tab Đối Chiếu — Tồn Kho Hệ Thống (phải CÙNG là 8):', reconStock);
    assert.strictEqual(reconStock, '8', 'LỖI: tab Đối Chiếu phải hiện 8, khớp đúng tab Hạn Sử Dụng');
    assert.strictEqual(expiryStock, reconStock, 'LỖI: 2 tab phải cho CÙNG 1 số với cùng 1 mã hàng');

    console.log('\n✅ Demo xác nhận: cả 2 tab (Hạn Sử Dụng + Đối Chiếu) nay cho CÙNG 1 số (8) cho mã hàng có nhiều dòng tồn kho hệ thống trùng.');
  } finally {
    await browser.close();
    server.close();
  }
})();
