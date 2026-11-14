// tests/test-shelf-mavach-match.js — "📋 Kiểm Soát Hàng Hóa" > Ghi Nhận Trên Kệ, thiết kế lại khi API
// Tồn Kho BRGMART bổ sung field maVach (mã vạch EAN-13) ở bản 1.3 (11/2026). ĐỔI (12/2026, theo phản hồi
// người dùng kèm ảnh chụp: tách Mã Vạch/Mã Hàng 2 ô riêng gây hiểu lầm quét xong không rõ vào đâu) — GỘP
// cả quét camera/gõ tay/tìm theo tên vào ĐÚNG 1 ô #srScanInput (xem applyUnifiedScanMatch()/
// onUnifiedScanInputChanged(), module-vanhanh.js). Test đúng hành vi MỚI: #srSku/#srMaHang giờ là 2 ô ẨN,
// hệ thống TỰ điền sau khi khớp — khớp maVach/maHang/6-số-cuối thì điền thêm Mã Hàng/Tên Sản Phẩm, KHÔNG
// khớp thì CHỦ ĐỘNG xoá cả Mã Hàng lẫn Mã Vạch cũ (mỗi lần gõ/quét vào ô gộp là 1 lượt nhận diện MỚI hoàn
// toàn — không còn khái niệm "giữ Mã Hàng cũ" như bản 2-ô trước đây, tránh submit nhầm Mã Vạch mới khớp
// với Mã Hàng cũ không liên quan). Picker "Chọn Từ Tồn Kho Hệ Thống" (nay dùng chung ô #srScanInput) điền
// CẢ 2 ô ẩn (Mã Hàng luôn có, Mã Vạch theo đúng dòng đã chọn, có thể rỗng). Dùng Playwright thật (gọi hàm
// browser-side thật ở module-vanhanh.js qua page.evaluate(), KHÔNG mock/giả lập lại logic) — cùng khuôn
// tests/test-shelf-kehang-offline.js.
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const run = createRunner();
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8996;
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1',
    perms: { shelfRecordCreate: true }, active: true, totpEnabled: true
  };
  const state = createMockState({ depts: ['Siêu thị Quận 1'], users: [USER] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => {
      DB.shelfLocations = [{ id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Nước giải khát', active: true }];
      DB.shelfRecords = [];
      // Mô phỏng tồn kho hệ thống ĐÃ TẢI cho đúng siêu thị (bỏ qua bước gọi route thật — test đúng phần
      // logic so khớp phía client, route GET /system-inventory đã có test riêng ở test-inventory-recon.js).
      shelfSystemInventoryCache = [
        { maHang: '2003330491', tenHang: 'Sữa tươi TH True Milk 1L', maVach: '8934696001589', soLuongTon: 186 },
        { maHang: '2003290553', tenHang: 'Dầu ăn Simply 1L', maVach: null, soLuongTon: 86 } // mặt hàng CHƯA khai mã vạch
      ];
    });
  } catch (err) {
    await browser.close(); server.close(); throw err;
  }

  await run.run('camera quét khớp maVach -> tự điền Mã Hàng + Tên Sản Phẩm + hiện ghi chú đã khớp', async () => {
    await page.evaluate(() => {
      document.getElementById('srSku').value = '';
      document.getElementById('srMaHang').value = '';
      document.getElementById('srProductName').value = '';
      onShelfBarcodeDecoded('8934696001589');
    });
    const sku = await page.evaluate(() => document.getElementById('srSku').value);
    const maHang = await page.evaluate(() => document.getElementById('srMaHang').value);
    const productName = await page.evaluate(() => document.getElementById('srProductName').value);
    const noteText = await page.evaluate(() => document.getElementById('srMaHangMatchNote').textContent);
    assertEqual(sku, '8934696001589', 'Mã Vạch phải LUÔN được điền (dù khớp hay không)');
    assertEqual(maHang, '2003330491', 'khớp maVach -> phải tự điền đúng Mã Hàng');
    assertEqual(productName, 'Sữa tươi TH True Milk 1L', 'khớp maVach -> phải tự điền đúng Tên Sản Phẩm');
    assert(noteText.includes('Đã khớp') && noteText.includes('Sữa tươi'), `phải hiện ghi chú đã khớp, thực tế: "${noteText}"`);
  });

  await run.run('camera quét KHÔNG khớp -> vẫn điền "mã thô" vào Mã Vạch ẩn, CHỦ ĐỘNG xoá Mã Hàng cũ (mỗi lượt quét là 1 lần nhận diện mới), hiện ghi chú chưa khớp', async () => {
    await page.evaluate(() => {
      document.getElementById('srSku').value = '';
      document.getElementById('srMaHang').value = '2003330491'; // giả lập đã có Mã Hàng từ trước (gõ tay/picker)
      onShelfBarcodeDecoded('0000000000000'); // mã lạ, không có trong shelfSystemInventoryCache
    });
    const sku = await page.evaluate(() => document.getElementById('srSku').value);
    const maHang = await page.evaluate(() => document.getElementById('srMaHang').value);
    const noteText = await page.evaluate(() => document.getElementById('srMaHangMatchNote').textContent);
    assertEqual(sku, '0000000000000', 'Mã Vạch ẩn phải vẫn được điền dù không khớp (lưu lại để tham chiếu)');
    assertEqual(maHang, '', 'KHÔNG khớp -> PHẢI xoá Mã Hàng cũ (tránh submit nhầm Mã Vạch mới + Mã Hàng cũ không liên quan)');
    assert(noteText.includes('Không khớp'), `phải hiện ghi chú không khớp, thực tế: "${noteText}"`);
  });

  await run.run('picker (ô gộp) chọn dòng CÓ maVach -> điền cả Mã Hàng + Mã Vạch', async () => {
    await page.evaluate(() => {
      document.getElementById('srScanInput').value = buildShelfSystemInventoryLabel(shelfSystemInventoryCache[0]);
      onUnifiedScanInputChanged(document.getElementById('srScanInput').value);
    });
    const maHang = await page.evaluate(() => document.getElementById('srMaHang').value);
    const sku = await page.evaluate(() => document.getElementById('srSku').value);
    assertEqual(maHang, '2003330491', 'picker phải điền đúng Mã Hàng');
    assertEqual(sku, '8934696001589', 'picker phải điền đúng Mã Vạch của dòng đã chọn');
  });

  await run.run('picker (ô gộp) chọn dòng maVach null -> Mã Hàng có, Mã Vạch để TRỐNG (không ghi chữ "null")', async () => {
    await page.evaluate(() => {
      document.getElementById('srScanInput').value = buildShelfSystemInventoryLabel(shelfSystemInventoryCache[1]);
      onUnifiedScanInputChanged(document.getElementById('srScanInput').value);
    });
    const maHang = await page.evaluate(() => document.getElementById('srMaHang').value);
    const sku = await page.evaluate(() => document.getElementById('srSku').value);
    assertEqual(maHang, '2003290553', 'picker vẫn phải điền đúng Mã Hàng dù dòng đó không có mã vạch');
    assertEqual(sku, '', 'maVach null -> ô Mã Vạch phải để trống, không hiện chữ "null"');
  });

  await run.run('gõ tay trực tiếp vào ô gộp (onUnifiedScanInputChanged) -> cũng tự khớp như camera', async () => {
    await page.evaluate(() => {
      document.getElementById('srMaHang').value = '';
      document.getElementById('srProductName').value = '';
      document.getElementById('srScanInput').value = '8934696001589';
      onUnifiedScanInputChanged('8934696001589');
    });
    const maHang = await page.evaluate(() => document.getElementById('srMaHang').value);
    assertEqual(maHang, '2003330491', 'gõ tay mã vạch khớp -> phải tự khớp giống hành vi camera');
  });

  await browser.close();
  server.close();
  run.summary();
}

main().catch((err) => { console.error(err); process.exit(1); });
