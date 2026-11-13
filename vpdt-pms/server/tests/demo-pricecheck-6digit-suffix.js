// server/tests/demo-pricecheck-6digit-suffix.js
//
// DEMO xác nhận tính năng "gõ tay 6 số cuối tự detect mã hàng" ở "💲 Kiểm Tra Giá" — người dùng xác nhận
// quy trình thực tế: nhân viên NHẬP TAY mã (lấy từ cơ sở dữ liệu, không quét), muốn chỉ cần gõ 6 số cuối
// là tự nhận diện được đúng mặt hàng, không cần gõ đủ mã vạch dài.
//
// LƯU Ý: tính năng này ĐÃ CÓ SẴN từ v30.5 (matchShelfSystemInventoryBySuffix(), xem module-vanhanh.js) —
// demo này KHÔNG phải code mới, chỉ dựng lại đúng khuôn tests/test-shelf-barcode-suffix-match.js để chụp
// ảnh xác nhận với dữ liệu GIỐNG ví dụ thật người dùng gửi (G7 Cà Phê 3in1, Mã Hàng 2002092675, Mã Vạch
// 8935024912607, giá 79.600đ, Siêu thị số 8 Phạm Ngọc Thạch) — gõ ĐÚNG 6 số cuối "912607" (không gõ đủ
// 13 số Mã Vạch) để xác nhận tự tra ra đúng giá, không cần làm gì thêm.
//
// Chạy: node server/tests/demo-pricecheck-6digit-suffix.js
'use strict';
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'pricecheck-6digit-suffix');

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8992;

  const USER = {
    username: 'nv_st8', name: 'Nhân Viên Siêu Thị 8', dept: 'Siêu thị số 8 Phạm Ngọc Thạch',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true
  };
  const state = createMockState({ depts: ['Siêu thị số 8 Phạm Ngọc Thạch'], users: [USER] });
  state.storeExternalCodes = { 'Siêu thị số 8 Phạm Ngọc Thạch': '008' };
  state.__mockPriceCheckConfigured = true;
  // Đúng mặt hàng người dùng gửi ảnh: G7 Cà Phê 3in1, Mã Hàng 2002092675, Mã Vạch 8935024912607 (6 số
  // cuối "912607" — KHÔNG trùng 6 số cuối với mặt hàng nào khác trong kho để demo đúng nhánh "khớp DUY
  // NHẤT, tự tra giá ngay").
  state.__mockSystemInventoryRows = [
    { maHang: '2002092675', maVach: '8935024912607', tenHang: 'G7_Cà phê 3 in 1 - Hộp 18×16g T24', soLuongTon: 42 },
    { maHang: '2002260821', maVach: '8934563112899', tenHang: 'VNM_Nước dừa tươi 330ml T24', soLuongTon: 18 }
  ];
  state.__mockPriceCheckResults = {
    '2002092675': { maHang: '2002092675', tenHang: 'G7_Cà phê 3 in 1 - Hộp 18×16g T24', maVach: '8935024912607', giaThuong: 79600, giaKhuyenMai: null, coKhuyenMai: false, capNhatLuc: '2026-11-11T08:32:16.000Z' }
  };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 420, height: 850 }); // mô phỏng màn hình điện thoại, đúng bối cảnh ảnh người dùng gửi

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(async () => { await switchTab('vanHanh'); });
    await page.waitForSelector('[data-op="setVanHanhSubTab"][data-tab="SHELF"]', { state: 'visible' });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.waitForTimeout(100);
    await page.click('#btnVhShelfSubPriceCheck');
    await page.waitForTimeout(200);

    // ===== 1) Màn trống, chuẩn bị gõ tay =====
    await shot(page, '#vanHanhShelfWrap', '1-truoc-khi-go.png');

    // ===== 2) Gõ ĐÚNG 6 số cuối "912607" (KHÔNG gõ đủ mã vạch 13 số) =====
    await page.fill('#pcMaHang', '912607');
    await shot(page, '#vanHanhShelfWrap', '2-da-go-6-so-cuoi.png');
    await page.click('#priceCheckForm button[type="submit"]');
    await page.waitForTimeout(200);

    // ===== 3) Tự nhận diện đúng mặt hàng + tra giá ngay, không hỏi gì thêm =====
    await shot(page, '#vanHanhShelfWrap', '3-tu-detect-ra-mat-hang-va-gia.png');
    const result = await page.evaluate(() => ({
      tenHang: document.getElementById('pcResultTenHang').textContent,
      maHangVaMaVach: document.getElementById('pcResultMaHang').textContent,
      giaApDung: document.getElementById('pcResultGiaApDung').textContent,
      pickerHidden: document.getElementById('priceCheckSuffixPickerWrap').classList.contains('hidden')
    }));
    console.log('[Kết quả sau khi gõ 6 số cuối "912607"]', result);
    console.log(result.tenHang.includes('G7_Cà phê') && result.giaApDung.includes('79.600') && result.pickerHidden
      ? '✅ ĐÚNG — tự detect ra đúng mặt hàng + giá NGAY từ 6 số cuối, không cần gõ đủ mã vạch dài, không cần chọn gì thêm.'
      : '⛔ SAI — kiểm tra lại.');

    console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
