// tests/test-shelf-mavach-match.js — "📋 Kiểm Soát Hàng Hóa" > Ghi Nhận Trên Kệ, thiết kế lại khi API
// Tồn Kho BRGMART bổ sung field maVach (mã vạch EAN-13) ở bản 1.3 (11/2026). Test đúng hành vi MỚI:
// camera quét (hoặc gõ tay vào ô Mã Vạch) LUÔN điền #srSku, rồi TỰ khớp với maVach trong tồn kho hệ
// thống đã tải — khớp được thì tự điền thêm Mã Hàng/Tên Sản Phẩm, KHÔNG khớp thì giữ nguyên Mã Hàng
// (không xoá), không chặn UI. Picker "Chọn Từ Tồn Kho Hệ Thống" điền CẢ 2 ô (Mã Hàng luôn có, Mã Vạch
// theo đúng dòng đã chọn, có thể rỗng). Dùng Playwright thật (gọi hàm browser-side thật ở
// module-vanhanh.js qua page.evaluate(), KHÔNG mock/giả lập lại logic) — cùng khuôn
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

  await run.run('camera quét KHÔNG khớp maVach -> vẫn điền Mã Vạch, Mã Hàng cũ KHÔNG bị xoá, hiện ghi chú chưa khớp', async () => {
    await page.evaluate(() => {
      document.getElementById('srSku').value = '';
      document.getElementById('srMaHang').value = '2003330491'; // giả lập đã có Mã Hàng từ trước (gõ tay/picker)
      onShelfBarcodeDecoded('0000000000000'); // mã lạ, không có trong shelfSystemInventoryCache
    });
    const sku = await page.evaluate(() => document.getElementById('srSku').value);
    const maHang = await page.evaluate(() => document.getElementById('srMaHang').value);
    const noteText = await page.evaluate(() => document.getElementById('srMaHangMatchNote').textContent);
    assertEqual(sku, '0000000000000', 'Mã Vạch phải vẫn được điền dù không khớp (lưu lại để tham chiếu)');
    assertEqual(maHang, '2003330491', 'KHÔNG khớp -> không được xoá Mã Hàng đã có sẵn trước đó');
    assert(noteText.includes('Không khớp'), `phải hiện ghi chú không khớp, thực tế: "${noteText}"`);
  });

  await run.run('picker chọn dòng CÓ maVach -> điền cả Mã Hàng + Mã Vạch', async () => {
    await page.evaluate(() => {
      document.getElementById('srSystemInventoryInput').value = buildShelfSystemInventoryLabel(shelfSystemInventoryCache[0]);
      resolveShelfSystemInventoryInput();
    });
    const maHang = await page.evaluate(() => document.getElementById('srMaHang').value);
    const sku = await page.evaluate(() => document.getElementById('srSku').value);
    assertEqual(maHang, '2003330491', 'picker phải điền đúng Mã Hàng');
    assertEqual(sku, '8934696001589', 'picker phải điền đúng Mã Vạch của dòng đã chọn');
  });

  await run.run('picker chọn dòng maVach null -> Mã Hàng có, Mã Vạch để TRỐNG (không ghi chữ "null")', async () => {
    await page.evaluate(() => {
      document.getElementById('srSystemInventoryInput').value = buildShelfSystemInventoryLabel(shelfSystemInventoryCache[1]);
      resolveShelfSystemInventoryInput();
    });
    const maHang = await page.evaluate(() => document.getElementById('srMaHang').value);
    const sku = await page.evaluate(() => document.getElementById('srSku').value);
    assertEqual(maHang, '2003290553', 'picker vẫn phải điền đúng Mã Hàng dù dòng đó không có mã vạch');
    assertEqual(sku, '', 'maVach null -> ô Mã Vạch phải để trống, không hiện chữ "null"');
  });

  await run.run('gõ tay trực tiếp vào ô Mã Vạch (onShelfMaVachTyped) -> cũng tự khớp như camera', async () => {
    await page.evaluate(() => {
      document.getElementById('srMaHang').value = '';
      document.getElementById('srProductName').value = '';
      document.getElementById('srSku').value = '8934696001589';
      onShelfMaVachTyped();
    });
    const maHang = await page.evaluate(() => document.getElementById('srMaHang').value);
    assertEqual(maHang, '2003330491', 'gõ tay mã vạch khớp -> phải tự khớp giống hành vi camera');
  });

  await browser.close();
  server.close();
  run.summary();
}

main().catch((err) => { console.error(err); process.exit(1); });
