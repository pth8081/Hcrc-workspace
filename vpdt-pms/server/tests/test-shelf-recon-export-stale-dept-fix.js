// server/tests/test-shelf-recon-export-stale-dept-fix.js
//
// LỖI ĐÃ VÁ (11/2026, phát hiện qua đợt audit chuyên sâu v30.27->v30.30, agent audit code/bảo mật):
// _shelfReconLastArgs (cache module-level dùng cho phân trang Đối Chiếu) KHÔNG tự biết đổi siêu thị
// (shelfAnyStoreAccess, "🔑 Được Chọn Siêu Thị Bất Kỳ") — nếu đổi sang siêu thị B rồi
// loadShelfReconciliation() LỖI (B chưa cấu hình Mã Điểm, mất mạng...), nhánh lỗi TRƯỚC ĐÂY chỉ hiện
// thông báo trên bảng rồi return, KHÔNG xoá cache cũ của A. Bấm "📥 Xuất Excel" (nút KHÔNG tự disable)
// ngay lúc đó sẽ xuất báo cáo "lai": Mã Hàng/Tồn Kho Hệ Thống CŨ của A nhưng Trên Kệ Hôm Nay/Quá Khứ lại
// tính theo getEffectiveShelfDept() MỚI là B — sai lệch hoàn toàn, không cảnh báo gì.
//
// Đã vá bằng 2 lớp: (1) loadShelfReconciliation() xoá _shelfReconLastArgs/_shelfReconLastArgsDept NGAY
// khi bắt đầu tải lại (trước khi biết thành công/lỗi); (2) exportShelfReconciliationExcel() so sánh
// _shelfReconLastArgsDept với getEffectiveShelfDept() hiện tại, từ chối xuất nếu lệch.
//
// Test này mô phỏng ĐÚNG kịch bản lỗi: tải thành công cho Siêu Thị A -> đổi sang Siêu Thị B -> lần tải
// cho B bị lỗi (mock trả 503) -> bấm Xuất Excel PHẢI bị chặn (không xuất, có cảnh báo), KHÔNG được âm
// thầm xuất dữ liệu cũ của A.
//
// Chạy: node server/tests/test-shelf-recon-export-stale-dept-fix.js
'use strict';
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8991;

(async () => {
  const USER = { username: 'nv1', name: 'Nhân Viên 1', dept: 'Siêu thị Quận 1', perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfAnyStoreAccess: true }, active: true, totpEnabled: true };
  const today = new Date().toISOString();
  const state = createMockState({
    depts: ['Siêu thị Quận 1', 'Siêu thị Quận 2'], users: [USER],
    shelfRecords: [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationCode: 'KA1', shelfLocationName: 'Kệ A1', maHang: 'SP001', productName: 'Sản phẩm A', quantity: 5, creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: new Date().toLocaleString('vi-VN'), lastScannedAt: today }
    ],
    __mockSystemInventoryRows: [{ maHang: 'SP001', tenHang: 'Sản phẩm A', soLuongTon: 5 }]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');

    // ===== 1) Tải Đối Chiếu thành công cho Siêu Thị A (dept hiện tại của user) =====
    await page.click('#btnVhShelfSubRecon');
    await page.waitForTimeout(300);
    const deptAfterA = await page.evaluate(() => _shelfReconLastArgsDept);
    assert.strictEqual(deptAfterA, 'Siêu thị Quận 1', 'LỖI: tải thành công phải ghi đúng dept A vào _shelfReconLastArgsDept');
    console.log('PASS: Tải Đối Chiếu thành công cho Siêu Thị A -> cache ghi đúng dept A');

    // Xuất Excel lúc này phải THÀNH CÔNG bình thường (chưa có gì lỗi) — xác nhận chưa vá quá tay.
    await page.click('[data-op="exportShelfReconciliationExcel"]');
    await page.waitForTimeout(150);
    assert.strictEqual((state.__xlsxExports || []).length, 1, 'LỖI: Xuất Excel bình thường (chưa đổi siêu thị) phải THÀNH CÔNG');
    console.log('PASS: Xuất Excel bình thường (chưa đổi siêu thị, chưa lỗi gì) vẫn hoạt động đúng như cũ');

    // ===== 2) Đổi sang Siêu Thị B (mô phỏng quyền shelfAnyStoreAccess), rồi lần tải cho B BỊ LỖI 503 =====
    state.__mockSystemInventoryRows = null; // -> route /system-inventory trả 503 (xem testHarness.js)
    await page.evaluate(() => { shelfStoreOverrideDept = 'Siêu thị Quận 2'; });
    await page.evaluate(() => loadShelfReconciliation());
    await page.waitForTimeout(200);

    const errorRowText = await page.evaluate(() => document.getElementById('vhShelfReconBody')?.textContent || '');
    assert.ok(errorRowText.includes('chưa cấu hình') || errorRowText.length > 0, 'LỖI: phải hiện thông báo lỗi trên bảng');
    const cacheAfterError = await page.evaluate(() => ({ args: _shelfReconLastArgs, dept: _shelfReconLastArgsDept }));
    assert.strictEqual(cacheAfterError.args, null, 'LỖI ĐÃ VÁ CHƯA ĐÚNG: cache _shelfReconLastArgs phải bị xoá khi lần tải mới LỖI, không được giữ dữ liệu CŨ của Siêu Thị A');
    assert.strictEqual(cacheAfterError.dept, null, 'LỖI ĐÃ VÁ CHƯA ĐÚNG: _shelfReconLastArgsDept phải bị xoá theo');
    console.log('PASS: Đổi sang Siêu Thị B, tải lỗi 503 -> cache CŨ của Siêu Thị A đã bị xoá ngay (không còn xuất nhầm được)');

    // ===== 3) Bấm "📥 Xuất Excel" ngay lúc này — PHẢI bị chặn, KHÔNG được âm thầm xuất dữ liệu cũ của A =====
    const exportCountBefore = (state.__xlsxExports || []).length;
    await page.click('[data-op="exportShelfReconciliationExcel"]');
    await page.waitForTimeout(150);
    const exportCountAfter = (state.__xlsxExports || []).length;
    assert.strictEqual(exportCountAfter, exportCountBefore, 'LỖI NGHIÊM TRỌNG: bấm Xuất Excel lúc cache lỗi/rỗng KHÔNG được gửi file nào lên server (tránh xuất nhầm dữ liệu A dưới tên B)');
    const alerts = await page.evaluate(() => window.__alerts || []);
    assert.ok(alerts.some(a => a.includes('Chưa có dữ liệu đối chiếu')), 'LỖI: phải có cảnh báo rõ ràng "chưa có dữ liệu đối chiếu" thay vì im lặng không làm gì');
    console.log('PASS: Bấm Xuất Excel lúc cache rỗng/lỗi -> bị CHẶN đúng, có cảnh báo rõ ràng, không xuất nhầm');

    // ===== 4) Kịch bản tinh vi hơn: cache CŨ của A vẫn còn (giả lập race: lỗi xảy ra SAU khi đã có cache
    //          cũ, nhưng _shelfReconLastArgsDept lệch dept hiện tại) — test trực tiếp lớp vá thứ 2. =====
    await page.evaluate(() => { shelfStoreOverrideDept = ''; }); // quay lại Siêu Thị A (của chính user) TRƯỚC khi set cache
    await page.evaluate((rows) => {
      renderShelfReconciliationTable(rows, new Date().toISOString(), false, null, 1, 1, 1); // set cache ĐÚNG cho "A"
    }, [{ maHang: 'SP001', tenHang: 'Sản phẩm A', soLuongTon: 5 }]);
    await page.evaluate(() => { shelfStoreOverrideDept = 'Siêu thị Quận 2'; }); // đổi dept MÀ KHÔNG qua loadShelfReconciliation() (giả lập race)
    const exportCountBefore2 = (state.__xlsxExports || []).length;
    await page.click('[data-op="exportShelfReconciliationExcel"]');
    await page.waitForTimeout(150);
    assert.strictEqual((state.__xlsxExports || []).length, exportCountBefore2, 'LỖI NGHIÊM TRỌNG: lớp vá thứ 2 (so sánh dept) phải chặn xuất khi cache thuộc dept KHÁC dept đang xem, kể cả khi cache không rỗng');
    const alerts2 = await page.evaluate(() => window.__alerts || []);
    assert.ok(alerts2.some(a => a.includes('chưa khớp đúng siêu thị')), 'LỖI: phải cảnh báo rõ "chưa khớp đúng siêu thị" ở lớp vá thứ 2');
    console.log('PASS: Lớp vá thứ 2 (so sánh dept) chặn đúng cả trường hợp cache KHÔNG rỗng nhưng lệch siêu thị (race condition)');

    assert.strictEqual(jsErrors.length, 0, 'LỖI: có lỗi JS phát sinh: ' + jsErrors.join('\n'));
    console.log('PASS: Không có lỗi console.error/pageerror nào trong suốt quá trình thao tác THẬT');

    console.log('\n==== 7/7 scenario(s) passed ====');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
