// server/tests/demo-shelf-expiry-update-today-recon.js
//
// DEMO thật (Playwright) cho lỗi người dùng báo kèm ảnh chụp: "số 7 là tôi cập nhật còn 7 (trước kia là
// 10) mà Trên Kệ Hôm Nay vẫn không có — coi như tôi vừa cập nhật thì phải tính vào Hôm Nay chứ".
//
// GỐC RỄ: Đối Chiếu phân loại Hôm Nay/Quá Khứ dựa vào `lastScannedAt||createdAt` (xem
// isShelfRecordCreatedToday(), module-vanhanh.js) — nhưng nút "✏️ Sửa"/"💾 Cập Nhật"/"✅ Bán Hết" ở tab
// Hạn Sử Dụng (đi qua PATCH /records/:id -> applyShelfRecordEdit(), lib/shelfStockEdit.js) trước đây CHỈ
// đổi quantity/expiryDate/note, KHÔNG bump lastScannedAt — nên 1 dòng vừa Cập Nhật hôm nay vẫn bị tính
// "Quá Khứ" theo đúng lần quét CŨ. ĐÃ VÁ: applyShelfRecordEdit() giờ bump lastScannedAt=now mỗi khi
// quantity được set (Sửa/Cập Nhật/Bán Hết đều dùng chung).
//
// Demo 2 bước, 1 dòng SP004 (tạo/quét 3 ngày trước, SL 10):
//   BƯỚC 1 (trước khi Cập Nhật): tab Hạn Sử Dụng hiện badge "🕗 Lần cuối: <3 ngày trước>"; Đối Chiếu
//     Trên Kệ Hôm Nay=0, Trên Kệ Quá Khứ=10, Lệch (so với Tồn Kho Hệ Thống=7).
//   BƯỚC 2 (bấm "💾 Cập Nhật" SL hiện tại = 7, NGAY HÔM NAY): tab Hạn Sử Dụng badge đổi thành "🟢 Đã
//     kiểm hôm nay"; Đối Chiếu Trên Kệ Hôm Nay=7, Trên Kệ Quá Khứ=0, Khớp (7=7) — đúng ý người dùng.
//
// Chạy: node server/tests/demo-shelf-expiry-update-today-recon.js
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8997;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-expiry-update-today-recon');

const USER = { username: 'nv1', name: 'Cửa Hàng Trưởng', dept: 'Siêu thị Quận 1', perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true };

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({ depts: [], stores: ['Siêu thị Quận 1'], users: [USER] });
  state.__mockSystemInventoryRows = [
    { maHang: 'SP004', tenHang: 'ITO_Bánh quy nhân kem vị vani', soLuongTon: 7 }
  ];
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const futureExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
  state.shelfRecords = [
    { id: 4, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationCode: 'KA1', shelfLocationName: 'Kệ bánh kẹo', maHang: 'SP004', productName: 'ITO_Bánh quy nhân kem vị vani', quantity: 10, expiryDate: futureExpiry, note: '', createdAt: threeDaysAgo, lastScannedAt: threeDaysAgo }
  ];
  state.shelfLocations = [{ id: 1, dept: 'Siêu thị Quận 1', code: 'KA1', name: 'Kệ bánh kẹo', active: true }];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 800 });
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubExpiry');
    await page.waitForTimeout(300);

    // ===== BƯỚC 1: trước khi Cập Nhật — badge "Lần cuối" (quá khứ), Đối Chiếu Quá Khứ=10 =====
    await shot(page, '#vanHanhShelfWrap', '01-han-su-dung-truoc-cap-nhat-badge-qua-khu.png');
    const badgeBefore = await page.evaluate(() => document.querySelector('#vhShelfExpiryBody tr')?.children[6]?.textContent.trim());
    console.log('Badge trước Cập Nhật:', badgeBefore);
    assert.ok(badgeBefore.includes('Lần cuối'), `LỖI: badge trước Cập Nhật phải là "Lần cuối: ..." (quá khứ), thực tế: "${badgeBefore}"`);

    await page.click('#btnVhShelfSubRecon');
    await page.waitForTimeout(300);
    const readRecon = async () => page.evaluate(() => {
      const tr = Array.from(document.querySelectorAll('#vhShelfReconBody tr')).find(r => r.children[0]?.textContent.trim() === 'SP004');
      if (!tr) return null;
      return { homNay: tr.children[3].textContent.trim(), quaKhu: tr.children[4].textContent.trim(), ketQua: tr.children[5].textContent.trim() };
    });
    const reconBefore = await readRecon();
    console.log('Đối Chiếu trước Cập Nhật:', reconBefore);
    assert.strictEqual(reconBefore.homNay, '0', 'LỖI: trước Cập Nhật, Trên Kệ Hôm Nay phải là 0');
    assert.strictEqual(reconBefore.quaKhu, '10', 'LỖI: trước Cập Nhật, Trên Kệ Quá Khứ phải là 10');
    assert.ok(reconBefore.ketQua.includes('Lệch'), 'LỖI: trước Cập Nhật phải Lệch (Hôm Nay=0 vs Tồn Kho Hệ Thống=7)');
    await shot(page, '#vanHanhShelfWrap', '02-doi-chieu-truoc-cap-nhat-qua-khu-10.png');

    // ===== BƯỚC 2: bấm "💾 Cập Nhật" SL hiện tại = 7 ở tab Hạn Sử Dụng =====
    await page.click('#btnVhShelfSubExpiry');
    await page.waitForTimeout(300);
    await page.fill('#srQuickQty_expiry_4', '7');
    await page.click('#vhShelfExpiryBody [data-op="quickUpdateShelfRecordQuantity"][data-arg0="4"]');
    await page.waitForTimeout(300);

    const badgeAfter = await page.evaluate(() => document.querySelector('#vhShelfExpiryBody tr')?.children[6]?.textContent.trim());
    console.log('Badge sau Cập Nhật:', badgeAfter);
    assert.ok(badgeAfter.includes('Đã kiểm hôm nay'), `LỖI ĐÃ VÁ chưa đúng: badge sau Cập Nhật phải là "🟢 Đã kiểm hôm nay", thực tế: "${badgeAfter}"`);
    await shot(page, '#vanHanhShelfWrap', '03-han-su-dung-sau-cap-nhat-badge-hom-nay.png');

    await page.click('#btnVhShelfSubRecon');
    await page.waitForTimeout(300);
    const reconAfter = await readRecon();
    console.log('Đối Chiếu sau Cập Nhật:', reconAfter);
    assert.strictEqual(reconAfter.homNay, '7', 'LỖI ĐÃ VÁ chưa đúng: sau Cập Nhật, Trên Kệ Hôm Nay phải là 7');
    assert.strictEqual(reconAfter.quaKhu, '0', 'LỖI ĐÃ VÁ chưa đúng: sau Cập Nhật, Trên Kệ Quá Khứ phải về 0 (dòng đã chuyển hẳn sang Hôm Nay)');
    assert.ok(reconAfter.ketQua.includes('Khớp'), 'LỖI ĐÃ VÁ chưa đúng: sau Cập Nhật phải Khớp (Hôm Nay=7=Tồn Kho Hệ Thống=7)');
    await shot(page, '#vanHanhShelfWrap', '04-doi-chieu-sau-cap-nhat-hom-nay-7-khop.png');

    assert.strictEqual(jsErrors.length, 0, `Có lỗi JS: ${jsErrors.join('\n')}`);
    console.log('\n✅ Demo xác nhận: "💾 Cập Nhật" hôm nay giờ tính đúng vào "Trên Kệ Hôm Nay" (badge tab Hạn Sử Dụng + Đối Chiếu), không còn kẹt ở "Quá Khứ".');
  } finally {
    await browser.close();
    server.close();
  }
})();
