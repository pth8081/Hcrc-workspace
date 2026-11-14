// tests/demo-shelf-record-unified-scan-input.js — demo Playwright THẬT cho yêu cầu GỘP ô nhận diện sản
// phẩm ở "📷 Ghi Nhận" (12/2026, theo phản hồi người dùng kèm 2 ảnh chụp: "quét mã sao lại ko có thông
// tin, mã nội bộ lại hiện lên mã vạch... nên làm theo cơ chế của kiểm tra giá, gộp 3 mã vào một chỗ quét
// camera để nhận biết sản phẩm luôn thay vì tách 2 ô"). Chụp lại luồng MỚI: 1 ô "Nhận Diện Sản Phẩm" duy
// nhất (#srScanInput) + 1 nút quét camera, thay cho 3 cách cũ tách rời (Mã Vạch/Mã Hàng/picker tìm theo
// tên) — xem applyUnifiedScanMatch()/onUnifiedScanInputChanged() ở module-vanhanh.js.
// Chạy: node tests/demo-shelf-record-unified-scan-input.js — ảnh lưu ở demo-screenshots/shelf-unified-scan/.
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'shelf-unified-scan');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const USER = {
    username: 'nv1', name: 'Nhân Viên Ghi Nhận', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true
  };
  const SHELF_LOCATION = { id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Nước giải khát', active: true };
  const state = createMockState({ depts: ['Siêu thị Quận 1'], stores: ['Siêu thị Quận 1'], users: [USER], shelfLocations: [SHELF_LOCATION] });
  state.storeExternalCodes = { 'Siêu thị Quận 1': '001' };
  state.__mockSystemInventoryRows = [
    { maHang: '2003330491', maVach: '8934696001589', tenHang: 'Sữa tươi TH True Milk 1L', soLuongTon: 186 },
    { maHang: '2002092675', maVach: '8935024912607', dsMaVach: ['8935024122310', '8935024123096', '8935024912607'], tenHang: 'G7_Cà phê 3 in 1 - Hộp 18×16g T24', soLuongTon: 42 }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 430, height: 900 });
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(String(err && err.stack || err)));

  let n = 0;
  const shot = async (label) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: false });
    console.log(`📸 ${file}`);
  };

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => switchTab('vanHanh'));
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubRecord');
    await page.waitForTimeout(250);

    // 1) Form trống — CHỈ còn 1 ô "Nhận Diện Sản Phẩm" + 1 nút 📷 Quét Mã (không còn 3 ô tách rời).
    await shot('form-trong-mot-o-duy-nhat');

    // 2) Gõ tay đúng Mã Vạch EAN-13 -> tự khớp, hiện tên sản phẩm + ghi chú xanh "Đã khớp".
    await page.fill('#srScanInput', '8934696001589');
    await page.dispatchEvent('#srScanInput', 'input');
    await page.waitForTimeout(150);
    await shot('go-ma-vach-tu-khop-hien-ten');

    // 3) Làm Mới rồi gõ ĐÚNG Mã Hàng nội bộ -> cũng tự khớp (không cần biết đó là "ô nào" nữa).
    await page.evaluate(() => resetShelfRecordForm());
    await page.fill('#srScanInput', '2002092675');
    await page.dispatchEvent('#srScanInput', 'input');
    await page.waitForTimeout(150);
    await shot('go-ma-hang-noi-bo-cung-tu-khop');

    // 4) Làm Mới rồi gõ 6 số cuối của 1 mã vạch PHỤ (dsMaVach) -> vẫn khớp đúng (giữ nguyên năng lực cũ).
    await page.evaluate(() => resetShelfRecordForm());
    await page.fill('#srScanInput', '123096');
    await page.dispatchEvent('#srScanInput', 'input');
    await page.waitForTimeout(150);
    await shot('go-6-so-cuoi-ma-vach-phu-van-khop');

    // 5) Làm Mới rồi gõ tên sản phẩm (tìm theo tên, dropdown gợi ý) -> chọn 1 dòng gợi ý -> tự điền đủ.
    await page.evaluate(() => resetShelfRecordForm());
    await page.fill('#srScanInput', 'Sữa tươi');
    await page.waitForTimeout(150);
    await shot('go-ten-hien-goi-y-dropdown');
    await page.evaluate(() => {
      document.getElementById('srScanInput').value = buildShelfSystemInventoryLabel(shelfSystemInventoryCache.find(r => r.maHang === '2003330491'));
      onUnifiedScanInputChanged(document.getElementById('srScanInput').value);
    });
    await page.waitForTimeout(100);
    await shot('chon-tu-goi-y-ten-tu-dien-day-du');

    // 6) Làm Mới rồi gõ 1 mã KHÔNG khớp gì (hàng mới/mã tự đặt) -> vẫn ghi nhận thủ công được, báo rõ.
    await page.evaluate(() => resetShelfRecordForm());
    await page.fill('#srScanInput', 'HANGMOI01');
    await page.dispatchEvent('#srScanInput', 'input');
    await page.fill('#srProductName', 'Hàng mới chưa có trong hệ thống');
    await page.waitForTimeout(100);
    await shot('ma-khong-khop-van-ghi-nhan-thu-cong-duoc');

    console.log(jsErrors.length ? `⛔ Có ${jsErrors.length} lỗi JS:\n${jsErrors.join('\n')}` : '✅ Không có lỗi JS nào trong suốt demo.');
  } finally {
    await browser.close();
    server.close();
  }
})();
