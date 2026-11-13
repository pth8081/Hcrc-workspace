// server/tests/test-shelf-export-excel-expiry-recon.js
//
// Theo yêu cầu người dùng (11/2026): thêm "📥 Xuất Excel" cho "⏰ Hạn Sử Dụng" (kèm bộ lọc khoảng ngày
// "Thời Gian Ghi Nhận" + "Hạn Sử Dụng" ÁP DỤNG TRƯỚC KHI xuất) và "📊 Đối Chiếu" (không có bộ lọc ngày,
// theo xác nhận của người dùng — bảng gộp theo mã hàng không có field ngày phù hợp). "📑 Báo Cáo" bổ
// sung thêm cột Mã Vạch vào Excel đã có (đủ thay thế nhu cầu xuất của "📷 Ghi Nhận").
//
// Chạy: node server/tests/test-shelf-export-excel-expiry-recon.js
'use strict';
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8994;

(async () => {
  const USER = { username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1', perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true };
  const today = new Date();
  const createdIn = new Date(today.getTime() - 2 * 86400000).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const createdOut = new Date(today.getTime() - 20 * 86400000).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const expiryIn = new Date(today.getTime() + 5 * 86400000).toISOString();
  const expiryOut = new Date(today.getTime() + 60 * 86400000).toISOString();
  const state = createMockState({
    depts: ['Siêu thị Quận 1'], users: [USER],
    shelfLocations: [{ id: 1, code: 'KA1', name: 'Kệ A1', category: 'Bánh kẹo', dept: 'Siêu thị Quận 1', active: true }],
    shelfRecords: [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationCode: 'KA1', shelfLocationName: 'Kệ A1', maHang: 'SP001', maVach: '8930000000001', productName: 'Trong khoảng', quantity: 5, expiryDate: expiryIn, creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: createdIn, lastScannedAt: createdIn },
      { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationCode: 'KA1', shelfLocationName: 'Kệ A1', maHang: 'SP002', maVach: '8930000000002', productName: 'Ngoài khoảng', quantity: 9, expiryDate: expiryOut, creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: createdOut, lastScannedAt: createdOut }
    ],
    __mockSystemInventoryRows: [
      { maHang: 'SP001', tenHang: 'Trong khoảng', soLuongTon: 5 },
      { maHang: 'SP002', tenHang: 'Ngoài khoảng', soLuongTon: 100 }
    ]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');

    // ===== 1) "⏰ Hạn Sử Dụng": Xuất Excel KHÔNG lọc -> đủ cả 2 dòng, có đủ cột mới. =====
    await page.click('#btnVhShelfSubExpiry');
    await page.waitForTimeout(150);
    await page.click('[data-op="exportShelfExpiryExcel"]');
    await page.waitForTimeout(150);
    assert.strictEqual((state.__xlsxExports || []).length, 1, 'LỖI: bấm Xuất Excel (Hạn Sử Dụng) phải gửi đúng 1 lần POST export-xlsx');
    const exp1 = state.__xlsxExports[0];
    assert.strictEqual(exp1.rows.length, 2, 'LỖI: chưa lọc gì thì phải xuất đủ cả 2 dòng');
    ['maVach', 'statusHan', 'sysStock', 'groupTotal', 'createdAt'].forEach(k => {
      assert.ok(exp1.columns.some(c => c.key === k), `LỖI: thiếu cột "${k}" trong Excel Hạn Sử Dụng`);
    });
    console.log('PASS: "⏰ Hạn Sử Dụng" Xuất Excel không lọc -> đủ 2 dòng + đủ cột Mã Vạch/Trạng Thái Hạn/Tồn Kho Hệ Thống/Tổng Theo Dõi/Thời Gian Ghi Nhận');

    // ===== 2) Lọc "Thời Gian Ghi Nhận Từ" -> chỉ còn dòng SP001 (createdIn gần đây, SP002 20 ngày trước
    //          bị loại) -> Xuất Excel phải đúng lọc này, không xuất ngược lại toàn bộ. =====
    const fromDateStr = new Date(today.getTime() - 5 * 86400000).toISOString().slice(0, 10);
    await page.click('#btnToggleShelfExpiryFilter');
    await page.fill('#sefCreatedFrom', fromDateStr);
    await page.dispatchEvent('#sefCreatedFrom', 'change');
    await page.waitForTimeout(150);
    const rowCountAfterFilter = await page.evaluate(() => document.querySelectorAll('#vhShelfExpiryBody tr').length);
    assert.strictEqual(rowCountAfterFilter, 1, 'LỖI: lọc "Thời Gian Ghi Nhận Từ" phải chỉ còn đúng 1 dòng (SP001) trên màn hình');

    await page.click('[data-op="exportShelfExpiryExcel"]');
    await page.waitForTimeout(150);
    assert.strictEqual((state.__xlsxExports || []).length, 2, 'LỖI: lần Xuất Excel thứ 2 phải được ghi nhận');
    const exp2 = state.__xlsxExports[1];
    assert.strictEqual(exp2.rows.length, 1, 'LỖI: Xuất Excel phải tôn trọng bộ lọc "Thời Gian Ghi Nhận" đang áp dụng, chỉ xuất 1 dòng');
    assert.strictEqual(exp2.rows[0].maHang, 'SP001', 'LỖI: dòng xuất ra phải đúng SP001 (khớp bộ lọc), không phải SP002');
    console.log('PASS: Lọc "Thời Gian Ghi Nhận Từ" -> màn hình VÀ Xuất Excel đều chỉ còn đúng 1 dòng khớp bộ lọc');

    await page.click('[data-op="clearShelfExpiryFilters"]');
    await page.waitForTimeout(120);

    // ===== 3) Lọc "Hạn Sử Dụng Đến" (gần, chỉ còn SP001 có expiryIn +5 ngày, SP002 +60 ngày bị loại). =====
    const expiryToStr = new Date(today.getTime() + 10 * 86400000).toISOString().slice(0, 10);
    await page.fill('#sefExpiryTo', expiryToStr);
    await page.dispatchEvent('#sefExpiryTo', 'change');
    await page.waitForTimeout(150);
    const rowCountExpiryFilter = await page.evaluate(() => document.querySelectorAll('#vhShelfExpiryBody tr').length);
    assert.strictEqual(rowCountExpiryFilter, 1, 'LỖI: lọc "Hạn Sử Dụng Đến" phải chỉ còn đúng 1 dòng (SP001)');
    console.log('PASS: Lọc "Hạn Sử Dụng Đến" -> chỉ còn đúng dòng khớp khoảng hạn sử dụng');

    await page.click('[data-op="clearShelfExpiryFilters"]');
    await page.waitForTimeout(120);

    // ===== 4) "📊 Đối Chiếu": Xuất Excel, không có bộ lọc ngày (xác nhận KHÔNG hiện bộ lọc đó). =====
    await page.click('#btnVhShelfSubRecon');
    await page.waitForTimeout(300);
    const hasReconDateFilter = await page.evaluate(() => !!document.getElementById('sefCreatedFrom')?.offsetParent && document.getElementById('vanHanhShelfReconWrap')?.contains(document.getElementById('sefCreatedFrom')));
    assert.strictEqual(hasReconDateFilter, false, 'LỖI: Đối Chiếu KHÔNG được có bộ lọc ngày riêng (theo xác nhận của người dùng)');
    await page.click('[data-op="exportShelfReconciliationExcel"]');
    await page.waitForTimeout(150);
    assert.strictEqual((state.__xlsxExports || []).length, 3, 'LỖI: bấm Xuất Excel (Đối Chiếu) phải gửi đúng 1 lần POST export-xlsx mới');
    const exp3 = state.__xlsxExports[2];
    assert.strictEqual(exp3.rows.length, 2, 'LỖI: Đối Chiếu phải xuất đủ 2 mã hàng đã scan');
    ['maHang', 'tenHang', 'soLuongTon', 'shelfTotal', 'pastTotal', 'ketQua'].forEach(k => {
      assert.ok(exp3.columns.some(c => c.key === k), `LỖI: thiếu cột "${k}" trong Excel Đối Chiếu`);
    });
    console.log('PASS: "📊 Đối Chiếu" Xuất Excel -> đủ 2 dòng + đủ cột, KHÔNG có bộ lọc ngày');

    // ===== 5) "📑 Báo Cáo": Excel đã có nay phải có thêm cột Mã Vạch. =====
    await page.click('#btnVhShelfSubReport');
    await page.waitForTimeout(250);
    await page.click('[data-op="exportShelfReportExcel"]');
    await page.waitForTimeout(150);
    const exp4 = state.__xlsxExports[state.__xlsxExports.length - 1];
    assert.ok(exp4.columns.some(c => c.key === 'maVach'), 'LỖI: Báo Cáo Excel phải có thêm cột Mã Vạch');
    const sp001Row = exp4.rows.find(r => r.maHang === 'SP001');
    assert.strictEqual(sp001Row.maVach, '8930000000001', 'LỖI: giá trị cột Mã Vạch phải đúng dữ liệu thật của dòng đó');
    console.log('PASS: "📑 Báo Cáo" Xuất Excel đã có thêm cột Mã Vạch đúng giá trị');

    assert.strictEqual(jsErrors.length, 0, 'LỖI: có lỗi JS phát sinh: ' + jsErrors.join('\n'));
    console.log('PASS: Không có lỗi console.error/pageerror nào trong suốt quá trình thao tác THẬT');

    console.log('\n==== 10/10 scenario(s) passed ====');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
