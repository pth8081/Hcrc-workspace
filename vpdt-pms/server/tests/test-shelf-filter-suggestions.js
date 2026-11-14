// tests/test-shelf-filter-suggestions.js — Ô lọc dạng "tìm-kiếm-gõ-chọn" (sdd*, gợi ý THẬT từ dữ liệu
// đang có) cho 5 màn con của "📋 Kiểm Soát Hàng Hóa" (12/2026, theo yêu cầu TRỰC TIẾP của người dùng kèm
// ảnh chụp "⏰ Hạn Sử Dụng": "nếu mà nó có thông tin trường bên dưới thì nó như là kiểu lọc có thông tin
// ấy, và đều drop list và có thể filter được... Tìm kiếm là gợi ý"). KHÁC với test-shelf-stock-filters.js
// (vốn chỉ test ĐÚNG hành vi gõ-chữ-lọc đã có từ trước) — bài này test ĐÚNG phần MỚI: dropdown gợi ý hiện
// đúng giá trị THẬT đang có + CLICK CHUỘT THẬT vào 1 gợi ý vẫn lọc đúng ngay sau đó (đặc biệt field "Quầy
// Kệ" — nhãn gợi ý PHẢI khớp định dạng khoảng trắng của haystack lọc, không dùng gạch ngang hiển thị ở
// bảng, xem populateShelfFilterSuggestions()/module-vanhanh.js — nếu lệch định dạng, bấm 1 gợi ý sẽ khiến
// ô lọc tự lọc ra RỖNG ngay sau khi chọn, lỗi im lặng rất dễ bị bỏ sót nếu chỉ test gõ-chữ-tay).
//
// Phạm vi test:
//  1. "📷 Ghi Nhận": dropdown Mã Hàng hiện ĐÚNG danh sách mã hàng thật đang có.
//  2. "📷 Ghi Nhận": CLICK chọn gợi ý Quầy Kệ (định dạng "code name" không gạch ngang) -> lọc ĐÚNG, không rỗng.
//  3. "⏰ Hạn Sử Dụng": CLICK chọn gợi ý Quầy Kệ -> lọc ĐÚNG, không rỗng (cùng lỗi tiềm ẩn như Ghi Nhận).
//  4. "📋 Ngưỡng Tồn": panel lọc MỚI (trước đây chưa có) — CLICK chọn gợi ý Mã Hàng -> lọc đúng 1 dòng.
//  5. "📊 Đối Chiếu": panel lọc MỚI — CLICK chọn gợi ý Tên Hàng -> lọc đúng; lọc "Kết Quả" = Lệch đúng.
//  6. "📑 Báo Cáo": panel lọc theo-trường MỚI (độc lập với bộ lọc Siêu Thị cũ) — CLICK chọn gợi ý Người Ghi
//     Nhận -> lọc đúng; "✖ Xoá Bộ Lọc" trả về đủ dòng.
//
// Chạy: node server/tests/test-shelf-filter-suggestions.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8995;
  const DEPT = 'Siêu thị Quận 1';
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: DEPT,
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true
  };
  const LOC_A = { id: 801, code: 'KE-A1', name: 'Kệ Mỹ Phẩm', category: 'Mỹ phẩm', dept: DEPT, active: true };
  const LOC_B = { id: 802, code: 'KE-B2', name: 'Kệ Đồ Uống', category: 'Đồ uống', dept: DEPT, active: true };
  const today = new Date();
  const todayIso = today.toISOString();
  const futureDate = new Date(today.getTime() + 180 * 86400000).toISOString();
  const state = createMockState({
    depts: [DEPT], users: [USER],
    shelfLocations: [LOC_A, LOC_B],
    shelfRecords: [
      { id: 1, dept: DEPT, shelfLocationId: 801, shelfLocationCode: 'KE-A1', shelfLocationName: 'Kệ Mỹ Phẩm', maHang: 'SP001', maVach: '8930000000001', productName: 'Sữa rửa mặt A', quantity: 5, expiryDate: futureDate, creator: 'nv1', creatorName: 'Nhân Viên 1', lastEditedByName: 'Nhân Viên 1', createdAt: todayIso, lastScannedAt: todayIso },
      { id: 2, dept: DEPT, shelfLocationId: 802, shelfLocationCode: 'KE-B2', shelfLocationName: 'Kệ Đồ Uống', maHang: 'SP002', maVach: '8930000000002', productName: 'Nước suối B', quantity: 15, expiryDate: futureDate, creator: 'nv1', creatorName: 'Nhân Viên 1', lastEditedByName: 'Nhân Viên 1', createdAt: todayIso, lastScannedAt: todayIso }
    ],
    shelfStockThresholds: [
      { id: 1, dept: DEPT, maHang: 'SP001', minQuantity: 10, active: true },
      { id: 2, dept: DEPT, maHang: 'SP002', minQuantity: 20, active: true }
    ]
  });
  // Đối Chiếu: SP001 khớp (tồn kho = 5, trên kệ hôm nay = 5), SP002 lệch (tồn kho 50 != trên kệ 15).
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', tenHang: 'Sữa rửa mặt A', soLuongTon: 5 },
    { maHang: 'SP002', tenHang: 'Nước suối B', soLuongTon: 50 }
  ];
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  const recentRows = () => page.evaluate(() => Array.from(document.querySelectorAll('#vhShelfRecordRecentBody > tr')).map(tr => tr.children[3]?.textContent.trim()));
  const expiryMaHangRows = () => page.evaluate(() => Array.from(document.querySelectorAll('#vhShelfExpiryBody > tr')).map(tr => tr.children[3]?.textContent.trim()));
  const thresholdRows = () => page.evaluate(() => Array.from(document.querySelectorAll('#vhShelfThresholdBody > tr')).map(tr => tr.children[0]?.textContent.trim()));
  const reconRows = () => page.evaluate(() => Array.from(document.querySelectorAll('#vhShelfReconBody > tr')).map(tr => tr.children[0]?.textContent.trim()));
  const reportCreatorCol = () => page.evaluate(() => Array.from(document.querySelectorAll('#shelfReportBody > tr')).map(tr => tr.children[1]?.textContent.trim()));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');

    // ===== 1-2: Ghi Nhận =====
    await page.click('#btnVhShelfSubRecord');
    await page.waitForTimeout(100);
    await page.click('#btnToggleShelfRecordRecentFilter');

    await run.run('"📷 Ghi Nhận": dropdown Mã Hàng hiện ĐÚNG danh sách mã hàng thật đang có', async () => {
      await page.click('#srfMaHang');
      const options = await page.locator('#srfMaHangDropdown [data-sdd-idx]').allTextContents();
      assertEqual(options.sort().join(','), 'SP001,SP002', `Phải thấy đúng 2 mã hàng thật, thực tế: ${options.join(',')}`);
      await page.keyboard.press('Escape');
    });

    await run.run('"📷 Ghi Nhận": CLICK chọn gợi ý Quầy Kệ -> lọc ĐÚNG, không rỗng', async () => {
      await page.fill('#srfShelfLocation', 'KE-B2');
      await page.dispatchEvent('#srfShelfLocation', 'input');
      await page.waitForTimeout(80);
      await page.locator('#srfShelfLocationDropdown [data-sdd-idx]').first().click();
      const inputVal = await page.inputValue('#srfShelfLocation');
      assertEqual(inputVal, 'KE-B2 Kệ Đồ Uống', `Giá trị ô sau khi chọn phải khớp ĐÚNG định dạng haystack (khoảng trắng, không gạch ngang), thực tế: "${inputVal}"`);
      const rows = await recentRows();
      assertEqual(rows.length, 1, `Phải còn ĐÚNG 1 dòng (SP002, Kệ Đồ Uống) sau khi chọn gợi ý — nếu lệch định dạng sẽ bị lọc RỖNG, thực tế: ${rows.length} dòng`);
      assertEqual(rows[0], 'SP002', `Dòng còn lại phải đúng SP002, thực tế: ${rows[0]}`);
      await page.click('[data-op="clearShelfRecordRecentFilters"]');
      await page.waitForTimeout(80);
    });

    // ===== 3: Hạn Sử Dụng =====
    await page.click('#btnVhShelfSubExpiry');
    await page.waitForTimeout(100);
    await page.click('#btnToggleShelfExpiryFilter');

    await run.run('"⏰ Hạn Sử Dụng": CLICK chọn gợi ý Quầy Kệ -> lọc ĐÚNG, không rỗng', async () => {
      await page.fill('#sefShelfLocation', 'KE-A1');
      await page.dispatchEvent('#sefShelfLocation', 'input');
      await page.waitForTimeout(80);
      await page.locator('#sefShelfLocationDropdown [data-sdd-idx]').first().click();
      const inputVal = await page.inputValue('#sefShelfLocation');
      assertEqual(inputVal, 'KE-A1 Kệ Mỹ Phẩm', `Giá trị ô sau khi chọn phải khớp ĐÚNG định dạng haystack, thực tế: "${inputVal}"`);
      const rows = await expiryMaHangRows();
      assertEqual(rows.length, 1, `Phải còn ĐÚNG 1 dòng (SP001, Kệ Mỹ Phẩm), thực tế: ${rows.length} dòng`);
      assertEqual(rows[0], 'SP001', `Dòng còn lại phải đúng SP001, thực tế: ${rows[0]}`);
      await page.click('[data-op="clearShelfExpiryFilters"]');
      await page.waitForTimeout(80);
    });

    // ===== 4: Ngưỡng Tồn (panel lọc hoàn toàn MỚI) =====
    await page.click('#btnVhShelfSubThreshold');
    await page.waitForTimeout(100);

    await run.run('"📋 Ngưỡng Tồn": panel lọc mặc định THU GỌN, bấm nút mở ra được', async () => {
      const hiddenBefore = await page.evaluate(() => document.getElementById('shelfThresholdFilterPanel').classList.contains('hidden'));
      assert(hiddenBefore, 'Panel lọc phải THU GỌN mặc định');
      await page.click('#btnToggleShelfThresholdFilter');
      const hiddenAfter = await page.evaluate(() => document.getElementById('shelfThresholdFilterPanel').classList.contains('hidden'));
      assert(!hiddenAfter, 'Bấm nút phải MỞ RA panel lọc');
    });

    await run.run('"📋 Ngưỡng Tồn": CLICK chọn gợi ý Mã Hàng -> lọc đúng 1 dòng', async () => {
      await page.fill('#stfMaHang', 'SP002');
      await page.dispatchEvent('#stfMaHang', 'input');
      await page.waitForTimeout(80);
      await page.locator('#stfMaHangDropdown [data-sdd-idx]').first().click();
      const rows = await thresholdRows();
      assertEqual(rows.length, 1, `Phải chỉ còn đúng 1 dòng khớp Mã Hàng SP002, thực tế: ${rows.length}`);
      assert(rows[0].includes('SP002'), `Dòng còn lại phải chứa SP002, thực tế: ${rows[0]}`);
      await page.click('[data-op="clearShelfThresholdFilters"]');
      await page.waitForTimeout(80);
      const rowsAfterClear = await thresholdRows();
      assertEqual(rowsAfterClear.length, 2, `"Xoá Bộ Lọc" phải trả về đủ 2 dòng, thực tế: ${rowsAfterClear.length}`);
    });

    // ===== 5: Đối Chiếu (panel lọc hoàn toàn MỚI) =====
    await page.click('#btnVhShelfSubRecon');
    await page.waitForTimeout(250);
    await page.click('#btnToggleShelfReconFilter');

    await run.run('"📊 Đối Chiếu": CLICK chọn gợi ý Tên Hàng -> lọc đúng', async () => {
      await page.fill('#sconTenHang', 'Nước suối');
      await page.dispatchEvent('#sconTenHang', 'input');
      await page.waitForTimeout(80);
      await page.locator('#sconTenHangDropdown [data-sdd-idx]').first().click();
      const rows = await reconRows();
      assertEqual(rows.length, 1, `Phải chỉ còn đúng 1 dòng khớp Tên Hàng, thực tế: ${rows.length}`);
      assertEqual(rows[0], 'SP002', `Dòng còn lại phải đúng SP002, thực tế: ${rows[0]}`);
      await page.fill('#sconTenHang', '');
      await page.dispatchEvent('#sconTenHang', 'input');
      await page.waitForTimeout(80);
    });

    await run.run('"📊 Đối Chiếu": lọc "Kết Quả" = Lệch -> đúng SP002, loại SP001 (đang khớp)', async () => {
      await page.selectOption('#sconStatus', 'mismatch');
      await page.waitForTimeout(80);
      const rows = await reconRows();
      assertEqual(rows.length, 1, `Chỉ SP002 bị lệch (tồn kho 50 != trên kệ 15), thực tế: ${rows.length} dòng`);
      assertEqual(rows[0], 'SP002', `Dòng lệch phải đúng SP002, thực tế: ${rows[0]}`);
      await page.click('[data-op="clearShelfReconFilters"]');
      await page.waitForTimeout(80);
      const rowsAfterClear = await reconRows();
      assertEqual(rowsAfterClear.length, 2, `"Xoá Bộ Lọc" phải trả về đủ 2 dòng, thực tế: ${rowsAfterClear.length}`);
    });

    // ===== 6: Báo Cáo (panel lọc theo-trường MỚI) =====
    await page.click('#btnVhShelfSubReport');
    await page.waitForTimeout(150);
    await page.click('#btnToggleShelfReportFilter');

    await run.run('"📑 Báo Cáo": CLICK chọn gợi ý Người Ghi Nhận -> lọc đúng, "Xoá Bộ Lọc" trả về đủ dòng', async () => {
      await page.fill('#srpCreator', 'Nhân Viên 1');
      await page.dispatchEvent('#srpCreator', 'input');
      await page.waitForTimeout(80);
      await page.locator('#srpCreatorDropdown [data-sdd-idx]').first().click();
      const rows = await reportCreatorCol();
      assertEqual(rows.length, 2, `Cả 2 ghi nhận đều do "Nhân Viên 1" ghi -> vẫn còn đủ 2 dòng, thực tế: ${rows.length}`);
      await page.fill('#srpMaHang', 'SP001');
      await page.dispatchEvent('#srpMaHang', 'input');
      await page.waitForTimeout(80);
      const rowsAfterMaHang = await reportCreatorCol();
      assertEqual(rowsAfterMaHang.length, 1, `Thêm lọc Mã Hàng SP001 -> chỉ còn 1 dòng, thực tế: ${rowsAfterMaHang.length}`);
      await page.click('[data-op="clearShelfReportFilters"]');
      await page.waitForTimeout(80);
      const rowsAfterClear = await reportCreatorCol();
      assertEqual(rowsAfterClear.length, 2, `"Xoá Bộ Lọc" phải trả về đủ 2 dòng, thực tế: ${rowsAfterClear.length}`);
    });

    await run.run('Không có lỗi JS (console.error/pageerror) nào phát sinh trong suốt bài test', async () => {
      const realErrors = jsErrors.filter(e => !e.includes('404'));
      assertEqual(realErrors.length, 0, `Có lỗi JS không mong đợi: ${realErrors.join(' | ')}`);
    });
  } finally {
    await browser.close();
    server.close();
  }
  run.summary();
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
