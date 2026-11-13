// server/tests/demo-shelf-suffix-fix-dedup-and-mahang-field.js
//
// DEMO xác nhận 2 LỖI THẬT người dùng báo (11/2026, kèm 3 ảnh chụp từ production) sau khi tính năng "gõ
// tay 6 số cuối tự detect mã hàng" (v30.5) đã hoạt động đúng với dữ liệu "sạch":
//
//   Bug 1 ("💲 Kiểm Tra Giá"): gõ "912607" (6 số cuối G7 Cà Phê 3in1) báo "6 số cuối khớp NHIỀU mặt
//   hàng" kèm 3 dòng chọn HOÀN TOÀN GIỐNG NHAU (cùng Mã Hàng 2002092675/Mã Vạch 8935024912607) — dữ liệu
//   thô từ API đối tác lặp dòng cho CÙNG 1 mã hàng, không phải 3 mặt hàng thật khác nhau.
//   -> ĐÃ VÁ: routes/shelfStock.js GET /system-inventory giờ GỘP (aggregateSystemInventoryRowsByMaHang())
//   NGAY TỪ ĐẦU, áp dụng cho MỌI nơi gọi (trước đây chỉ gộp ở scope=recon/Đối Chiếu).
//
//   Bug 2 ("📷 Ghi Nhận"): gõ "912607" trực tiếp vào ô "Mã Hàng (nội bộ)" không phản hồi gì (⚠️ "Không
//   khớp tồn kho hệ thống") vì ô này trước đây KHÔNG có handler nào — logic 6-số-cuối chỉ gắn vào ô "Mã
//   Vạch". Ghi Nhận (khác Kiểm Tra Giá) không có nút "xác nhận" riêng để kích hoạt khớp.
//   -> ĐÃ VÁ: thêm data-op-input="onShelfMaHangTyped" cho #srMaHang (vanHanhSection.html) +
//   applyShelfMaHangMatch()/onShelfMaHangTyped() (module-vanhanh.js) — gõ tay vào Mã Hàng giờ cũng tự
//   khớp (chính xác hoặc 6 số cuối) như ô Mã Vạch đã làm.
//
// Chạy: node server/tests/demo-shelf-suffix-fix-dedup-and-mahang-field.js
'use strict';
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-suffix-fix-dedup-and-mahang-field');

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8993;

  const USER = {
    username: 'nv_st8', name: 'Nhân Viên Siêu Thị 8', dept: 'Siêu thị số 8 Phạm Ngọc Thạch',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true
  };
  const state = createMockState({ depts: ['Siêu thị số 8 Phạm Ngọc Thạch'], users: [USER] });
  state.storeExternalCodes = { 'Siêu thị số 8 Phạm Ngọc Thạch': '008' };
  state.__mockPriceCheckConfigured = true;
  // ĐÚNG dữ liệu thô gây lỗi: 3 dòng HOÀN TOÀN GIỐNG NHAU cho ĐÚNG 1 mã hàng (y hệt ảnh chụp người dùng
  // gửi — G7 Cà Phê 3in1, Mã Hàng 2002092675, Mã Vạch 8935024912607).
  state.__mockSystemInventoryRows = [
    { maHang: '2002092675', maVach: '8935024912607', tenHang: 'G7_Cà phê 3 in 1 - Hộp 18×16g T24', soLuongTon: 14 },
    { maHang: '2002092675', maVach: '8935024912607', tenHang: 'G7_Cà phê 3 in 1 - Hộp 18×16g T24', soLuongTon: 14 },
    { maHang: '2002092675', maVach: '8935024912607', tenHang: 'G7_Cà phê 3 in 1 - Hộp 18×16g T24', soLuongTon: 14 }
  ];
  state.__mockPriceCheckResults = {
    '2002092675': { maHang: '2002092675', tenHang: 'G7_Cà phê 3 in 1 - Hộp 18×16g T24', maVach: '8935024912607', giaThuong: 79600, giaKhuyenMai: null, coKhuyenMai: false, capNhatLuc: '2026-11-13T08:00:00.000Z' }
  };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 420, height: 850 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(async () => { await switchTab('vanHanh'); });
    await page.waitForSelector('[data-op="setVanHanhSubTab"][data-tab="SHELF"]', { state: 'visible' });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.waitForTimeout(100);

    // ===== BUG 1 — "💲 Kiểm Tra Giá": gõ 6 số cuối của mã hàng có 3 dòng trùng lặp =====
    await page.click('#btnVhShelfSubPriceCheck');
    await page.waitForTimeout(200);
    await page.fill('#pcMaHang', '912607');
    await shot(page, '#vanHanhShelfWrap', '1-kiem-tra-gia-truoc-khi-xac-nhan.png');
    await page.click('#priceCheckForm button[type="submit"]');
    await page.waitForTimeout(200);
    await shot(page, '#vanHanhShelfWrap', '2-kiem-tra-gia-DA-VA-khop-duy-nhat.png');
    const bug1 = await page.evaluate(() => ({
      pickerHidden: document.getElementById('priceCheckSuffixPickerWrap').classList.contains('hidden'),
      resultVisible: !document.getElementById('priceCheckResultWrap').classList.contains('hidden'),
      tenHang: document.getElementById('pcResultTenHang').textContent,
      giaApDung: document.getElementById('pcResultGiaApDung').textContent
    }));
    console.log('[Bug 1 — Kiểm Tra Giá]', bug1);
    console.log(bug1.pickerHidden && bug1.resultVisible && bug1.tenHang.includes('G7_Cà phê') && bug1.giaApDung.includes('79.600')
      ? '✅ ĐÃ VÁ — 3 dòng trùng lặp được gộp thành 1, khớp DUY NHẤT, tự tra giá ngay, KHÔNG còn hỏi "khớp nhiều mặt hàng" giả.'
      : '⛔ SAI — kiểm tra lại.');
    await page.click('#priceCheckResultWrap button[data-op="cancelPriceCheck"]');
    await page.waitForTimeout(50);

    // ===== BUG 2 — "📷 Ghi Nhận": gõ 6 số cuối TRỰC TIẾP vào ô "Mã Hàng (nội bộ)" =====
    await page.click('#btnVhShelfSubRecord');
    await page.waitForTimeout(200);
    await shot(page, '#vanHanhShelfWrap', '3-ghi-nhan-truoc-khi-go.png');
    await page.fill('#srMaHang', '912607');
    await page.dispatchEvent('#srMaHang', 'input');
    await page.waitForTimeout(100);
    await shot(page, '#vanHanhShelfWrap', '4-ghi-nhan-DA-VA-tu-dien-ma-vach-va-ten.png');
    const bug2 = await page.evaluate(() => ({
      maVach: document.getElementById('srSku').value,
      productName: document.getElementById('srProductName').value,
      note: document.getElementById('srMaHangMatchNote').textContent
    }));
    console.log('[Bug 2 — Ghi Nhận, gõ tay vào ô Mã Hàng]', bug2);
    console.log(bug2.maVach === '8935024912607' && bug2.productName.includes('G7_Cà phê')
      ? '✅ ĐÃ VÁ — gõ 6 số cuối trực tiếp vào ô "Mã Hàng (nội bộ)" giờ TỰ điền Mã Vạch + Tên Sản Phẩm, không cần nút xác nhận riêng.'
      : '⛔ SAI — kiểm tra lại.');

    console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
