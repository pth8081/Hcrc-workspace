// server/tests/demo-shelf-dsmavach-multi-barcode.js
//
// DEMO xác nhận tính năng "khớp mã vạch PHỤ" (11/2026, đối tác bổ sung field mới `dsMaVach` ở API "Tồn
// Kho" theo đúng yêu cầu người dùng, sau khi báo lỗi thật kèm ảnh chụp): 1 mã hàng trên hệ thống DSMART
// có thể đăng ký NHIỀU mã vạch hợp lệ (ví dụ G7 Cà Phê 3in1 có 3 mã vạch: 8935024122310, 8935024123096,
// 8935024912607 — chỉ 1 trong đó là mã MẶC ĐỊNH, trước đây lưu ở trường `maVach`). Khi nhân viên quét/
// nhập ĐÚNG 1 mã vạch KHÔNG phải mã mặc định, hệ thống TRƯỚC ĐÂY báo sai "không tìm thấy"/"không khớp"
// dù mã vạch đó hoàn toàn hợp lệ.
//
// Đối tác đã cập nhật API "Tồn Kho" (GET /api/v1/reports/ton-kho/run) trả thêm trường `dsMaVach` (mảng,
// LUÔN chứa cả giá trị đang có ở `maVach`) — `maVach` giữ nguyên không đổi. Đã sửa logic đối chiếu ở màn
// "📷 Ghi Nhận" (và các hàm dùng chung khác — "⏰ Hạn Sử Dụng") để so khớp mã vạch quét/nhập với TOÀN BỘ
// `dsMaVach`, không chỉ so với đúng 1 giá trị `maVach` như trước.
//
// Demo tái hiện ĐÚNG ví dụ đối tác gửi: G7 Cà Phê 3in1, Mã Hàng 2002092675, mã vạch mặc định
// 8935024912607, 2 mã vạch phụ 8935024122310/8935024123096 — gõ ĐỦ 1 mã vạch PHỤ (không gõ mã mặc định)
// để xác nhận hệ thống vẫn tự nhận diện đúng, không còn báo "không khớp" sai.
//
// Chạy: node server/tests/demo-shelf-dsmavach-multi-barcode.js
'use strict';
const fs = require('fs');
const path = require('path');

const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-dsmavach-multi-barcode');

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8994;

  const USER = {
    username: 'nv_st8', name: 'Nhân Viên Siêu Thị 8', dept: 'Siêu thị số 8 Phạm Ngọc Thạch',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true
  };
  const state = createMockState({ depts: ['Siêu thị số 8 Phạm Ngọc Thạch'], users: [USER] });
  state.storeExternalCodes = { 'Siêu thị số 8 Phạm Ngọc Thạch': '008' };
  state.__mockPriceCheckConfigured = true;
  // ĐÚNG ví dụ đối tác gửi: maVach = mã MẶC ĐỊNH, dsMaVach = TOÀN BỘ danh sách (luôn chứa cả maVach).
  state.__mockSystemInventoryRows = [
    {
      maHang: '2002092675', maVach: '8935024912607',
      dsMaVach: ['8935024122310', '8935024123096', '8935024912607'],
      tenHang: 'G7_Cà phê 3 in 1 - Hộp 18×16g T24', soLuongTon: 42
    }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 420, height: 850 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(async () => { await switchTab('vanHanh'); });
    await page.waitForSelector('[data-op="setVanHanhSubTab"][data-tab="SHELF"]', { state: 'visible' });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.waitForTimeout(100);
    await page.click('#btnVhShelfSubRecord');
    await page.waitForTimeout(200);

    await shot(page, '#vanHanhShelfWrap', '1-truoc-khi-go.png');

    // Gõ ĐỦ 1 mã vạch PHỤ (8935024123096) — KHÔNG phải mã mặc định (8935024912607).
    await page.fill('#srScanInput', '8935024123096');
    await page.dispatchEvent('#srScanInput', 'input');
    await page.waitForTimeout(150);
    await shot(page, '#vanHanhShelfWrap', '2-go-ma-vach-PHU-tu-nhan-dien-dung.png');

    const result = await page.evaluate(() => ({
      maHang: document.getElementById('srMaHang').value,
      productName: document.getElementById('srProductName').value,
      note: document.getElementById('srMaHangMatchNote').textContent
    }));
    console.log('[Gõ mã vạch PHỤ 8935024123096 — không phải mã mặc định 8935024912607]', result);
    console.log(result.maHang === '2002092675' && result.productName.includes('G7_Cà phê') && !/không khớp/i.test(result.note)
      ? '✅ ĐÃ VÁ — mã vạch PHỤ (không phải mặc định) vẫn tự nhận diện đúng mặt hàng, không còn báo "không khớp" sai.'
      : '⛔ SAI — kiểm tra lại.');

    console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
