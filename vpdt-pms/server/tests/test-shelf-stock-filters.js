// tests/test-shelf-stock-filters.js — Bộ lọc tìm kiếm cho 3 bảng Kiểm Soát Hàng Hóa (11/2026, theo yêu
// cầu TRỰC TIẾP của người dùng kèm 3 ảnh chụp: "20 ghi nhận gần nhất"/"⏰ Hạn Sử Dụng"/"🗄️ Quầy Kệ" đều
// cần bộ lọc tìm kiếm, thu gọn/mở ra được, trường lọc khác nhau theo ĐÚNG cột đã có ở từng bảng). Test UI
// THẬT bằng Playwright page.click()/page.fill() — cùng bài học test-shelf-subtab-real-click.js: gọi hàm
// trực tiếp không bắt được lỗi dispatch CSP thật.
//
// Phạm vi test:
//  1. "📷 Ghi Nhận": panel lọc mặc định THU GỌN, bấm nút mở ra được.
//  2. "📷 Ghi Nhận": lọc theo Mã Hàng -> chỉ còn đúng dòng khớp, bỏ giới hạn "20 dòng gần nhất".
//  3. "📷 Ghi Nhận": lọc theo Số Lượng (khoảng từ-đến) -> đúng dòng trong khoảng.
//  4. "📷 Ghi Nhận": "✖ Xoá Bộ Lọc" -> về lại đúng 20 dòng gần nhất mặc định.
//  5. "⏰ Hạn Sử Dụng": lọc theo Tên Sản Phẩm -> đúng dòng khớp.
//  6. "⏰ Hạn Sử Dụng": lọc theo Trạng Thái Hạn ("Còn hạn") -> loại bỏ dòng đã hết hạn.
//  7. "🗄️ Quầy Kệ": lọc theo Mã Quầy Kệ (gõ không dấu vẫn khớp có dấu) -> đúng dòng khớp.
//  8. "🗄️ Quầy Kệ": lọc theo Trạng Thái ("Ngừng dùng") -> đúng dòng khớp.
//
// Chạy: node server/tests/test-shelf-stock-filters.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8998;
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true
  };
  const LOC_A = { id: 801, code: 'KE-A1', name: 'Kệ Mỹ Phẩm', category: 'Mỹ phẩm', dept: 'Siêu thị Quận 1', active: true };
  const LOC_B = { id: 802, code: 'KE-B2', name: 'Kệ Đồ Uống', category: 'Đồ uống', dept: 'Siêu thị Quận 1', active: false };
  const today = new Date();
  const pastDate = new Date(today.getTime() - 5 * 86400000).toISOString(); // đã hết hạn 5 ngày trước
  const futureDate = new Date(today.getTime() + 180 * 86400000).toISOString(); // còn hạn dài
  const state = createMockState({
    depts: ['Siêu thị Quận 1'], users: [USER],
    shelfLocations: [LOC_A, LOC_B],
    shelfRecords: [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 801, shelfLocationCode: 'KE-A1', shelfLocationName: 'Kệ Mỹ Phẩm', maHang: 'SP001', maVach: '8930000000001', productName: 'Sữa rửa mặt A', quantity: 5, expiryDate: futureDate, creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: '08:00:00 13/11/2026', lastScannedAt: '08:00:00 13/11/2026' },
      { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 801, shelfLocationCode: 'KE-A1', shelfLocationName: 'Kệ Mỹ Phẩm', maHang: 'SP002', maVach: '8930000000002', productName: 'Kem dưỡng da B', quantity: 15, expiryDate: pastDate, creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: '08:05:00 13/11/2026', lastScannedAt: '08:05:00 13/11/2026' },
      { id: 3, dept: 'Siêu thị Quận 1', shelfLocationId: 802, shelfLocationCode: 'KE-B2', shelfLocationName: 'Kệ Đồ Uống', maHang: 'SP003', maVach: '8930000000003', productName: 'Nước suối C', quantity: 25, expiryDate: futureDate, creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: '08:10:00 13/11/2026', lastScannedAt: '08:10:00 13/11/2026' }
    ]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  const recentRows = () => page.evaluate(() => Array.from(document.querySelectorAll('#vhShelfRecordRecentBody > tr')).map(tr => tr.children[3]?.textContent.trim()));
  const expiryProductNames = () => page.evaluate(() => Array.from(document.querySelectorAll('#vhShelfExpiryBody > tr')).map(tr => tr.children[1]?.textContent.trim()));
  const locationCodes = () => page.evaluate(() => Array.from(document.querySelectorAll('#vhShelfLocationsBody > tr')).map(tr => tr.children[0]?.textContent.trim()));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubRecord');
    await page.waitForTimeout(100);

    await run.run('"📷 Ghi Nhận": panel lọc mặc định THU GỌN, bấm nút mở ra được', async () => {
      const hiddenBefore = await page.evaluate(() => document.getElementById('shelfRecordRecentFilterPanel').classList.contains('hidden'));
      assert(hiddenBefore, 'Panel lọc phải THU GỌN mặc định');
      await page.click('#btnToggleShelfRecordRecentFilter');
      const hiddenAfter = await page.evaluate(() => document.getElementById('shelfRecordRecentFilterPanel').classList.contains('hidden'));
      assert(!hiddenAfter, 'Bấm nút phải MỞ RA panel lọc');
    });

    await run.run('"📷 Ghi Nhận": lọc theo Mã Hàng -> chỉ còn đúng dòng khớp', async () => {
      await page.fill('#srfMaHang', 'SP002');
      await page.dispatchEvent('#srfMaHang', 'input');
      await page.waitForTimeout(80);
      const rows = await recentRows();
      assertEqual(rows.length, 1, `Phải chỉ còn đúng 1 dòng khớp Mã Hàng, thực tế: ${rows.length}`);
      assertEqual(rows[0], 'SP002', `Dòng còn lại phải đúng SP002, thực tế: ${rows[0]}`);
      await page.fill('#srfMaHang', '');
      await page.dispatchEvent('#srfMaHang', 'input');
      await page.waitForTimeout(80);
    });

    await run.run('"📷 Ghi Nhận": lọc theo Số Lượng (khoảng 10-20) -> đúng dòng trong khoảng', async () => {
      await page.fill('#srfQtyMin', '10');
      await page.fill('#srfQtyMax', '20');
      await page.dispatchEvent('#srfQtyMax', 'input');
      await page.waitForTimeout(80);
      const rows = await recentRows();
      assertEqual(rows.length, 1, `Chỉ có SP002 (SL=15) nằm trong khoảng 10-20, thực tế: ${rows.length} dòng`);
      assertEqual(rows[0], 'SP002', `Dòng khớp khoảng SL phải là SP002, thực tế: ${rows[0]}`);
    });

    await run.run('"📷 Ghi Nhận": "✖ Xoá Bộ Lọc" -> về lại đủ 3 dòng (dưới 20, không bị giới hạn)', async () => {
      await page.click('[data-op="clearShelfRecordRecentFilters"]');
      await page.waitForTimeout(80);
      const rows = await recentRows();
      assertEqual(rows.length, 3, `Xoá bộ lọc phải về lại đủ 3 ghi nhận đã seed, thực tế: ${rows.length}`);
      const qtyMinVal = await page.evaluate(() => document.getElementById('srfQtyMin').value);
      assertEqual(qtyMinVal, '', 'Xoá Bộ Lọc phải xoá trắng luôn các ô input, không chỉ reset state ngầm');
    });

    await page.click('#btnVhShelfSubExpiry');
    await page.waitForTimeout(100);

    await run.run('"⏰ Hạn Sử Dụng": lọc theo Tên Sản Phẩm -> đúng dòng khớp', async () => {
      await page.click('#btnToggleShelfExpiryFilter');
      await page.fill('#sefProductName', 'Nước suối');
      await page.dispatchEvent('#sefProductName', 'input');
      await page.waitForTimeout(80);
      const names = await expiryProductNames();
      assertEqual(names.length, 1, `Phải chỉ còn đúng 1 dòng khớp tên sản phẩm, thực tế: ${names.length}`);
      assert(names[0].includes('Nước suối'), `Dòng còn lại phải đúng "Nước suối C", thực tế: ${names[0]}`);
      await page.fill('#sefProductName', '');
      await page.dispatchEvent('#sefProductName', 'input');
      await page.waitForTimeout(80);
    });

    await run.run('"⏰ Hạn Sử Dụng": lọc Trạng Thái Hạn "Còn hạn" -> loại bỏ dòng đã hết hạn', async () => {
      await page.selectOption('#sefStatus', 'OK');
      await page.waitForTimeout(80);
      const names = await expiryProductNames();
      assert(!names.some(n => n.includes('Kem dưỡng da B')), 'Lọc "Còn hạn" không được còn dòng ĐÃ HẾT HẠN (Kem dưỡng da B)');
      assert(names.some(n => n.includes('Sữa rửa mặt A')), 'Lọc "Còn hạn" vẫn phải giữ dòng còn hạn dài (Sữa rửa mặt A)');
      await page.selectOption('#sefStatus', '');
      await page.waitForTimeout(80);
    });

    await run.run('"⏰ Hạn Sử Dụng": cột Mã Vạch/Mã Hàng hiện đúng + lọc theo Mã Hàng tham chiếu Ghi Nhận', async () => {
      const cells = await page.evaluate(() => Array.from(document.querySelectorAll('#vhShelfExpiryBody > tr')).map(tr => ({ maVach: tr.children[2]?.textContent.trim(), maHang: tr.children[3]?.textContent.trim() })));
      assert(cells.some(c => c.maHang === 'SP002' && c.maVach === '8930000000002'), `Cột Mã Vạch/Mã Hàng phải hiện đúng giá trị để tham chiếu với Ghi Nhận, thực tế: ${JSON.stringify(cells)}`);
      await page.fill('#sefMaHang', 'SP003');
      await page.dispatchEvent('#sefMaHang', 'input');
      await page.waitForTimeout(80);
      const names = await expiryProductNames();
      assertEqual(names.length, 1, `Lọc theo Mã Hàng SP003 phải chỉ còn đúng 1 dòng, thực tế: ${names.length}`);
      assert(names[0].includes('Nước suối'), `Dòng khớp phải đúng Nước suối C (SP003), thực tế: ${names[0]}`);
      await page.fill('#sefMaHang', '');
      await page.dispatchEvent('#sefMaHang', 'input');
      await page.waitForTimeout(80);
    });

    await page.click('#btnVhShelfSubLocations');
    await page.waitForTimeout(100);

    await run.run('"🗄️ Quầy Kệ": lọc theo Mã Quầy Kệ, gõ KHÔNG DẤU vẫn khớp', async () => {
      await page.click('#btnToggleShelfLocationFilter');
      await page.fill('#slfCode', 'ke-a1');
      await page.dispatchEvent('#slfCode', 'input');
      await page.waitForTimeout(80);
      const codes = await locationCodes();
      assertEqual(codes.length, 1, `Phải chỉ còn đúng 1 quầy kệ khớp, thực tế: ${codes.length}`);
      assertEqual(codes[0], 'KE-A1', `Dòng còn lại phải đúng KE-A1, thực tế: ${codes[0]}`);
      await page.fill('#slfCode', '');
      await page.dispatchEvent('#slfCode', 'input');
      await page.waitForTimeout(80);
    });

    await run.run('"🗄️ Quầy Kệ": lọc Trạng Thái "Ngừng dùng" -> đúng dòng khớp', async () => {
      await page.selectOption('#slfActive', 'INACTIVE');
      await page.waitForTimeout(80);
      const codes = await locationCodes();
      assertEqual(codes.length, 1, `Chỉ có KE-B2 đang "Ngừng dùng", thực tế: ${codes.length} dòng`);
      assertEqual(codes[0], 'KE-B2', `Dòng khớp phải là KE-B2, thực tế: ${codes[0]}`);
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh trong suốt kịch bản: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
