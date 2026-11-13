// server/tests/audit-v30-excel-dashboard-sdd.js
//
// AUDIT THỰC TẾ (11/2026, version 30.28-30.30) — Playwright lái trình duyệt THẬT, BẤM NÚT THẬT (không
// gọi thẳng hàm JS) để kiểm tra:
//   1. Xuất Excel THẬT ở "⏰ Hạn Sử Dụng" (kết hợp 4 điều kiện lọc CÙNG LÚC) + "📊 Đối Chiếu" (xác nhận
//      KHÔNG dùng cache cũ khi dữ liệu scan mới nhất đã đổi) — đọc lại state.__xlsxExports để xác nhận
//      đúng dữ liệu ĐÃ LỌC được gửi lên server, không phải toàn bộ dữ liệu gốc.
//   2. Dashboard Giá Bán Buôn/Bán Lẻ: bấm NHANH LIÊN TỤC (double-click, bấm 2 thẻ khác nhau liên tiếp
//      không đợi) + chuyển qua lại nhiều lần giữa 2 tab Vận Hành/Mua Hàng — xác nhận không lệch số/lẫn
//      dữ liệu, không lỗi JS.
//   3. "🗄️ Quầy Kệ" — ô lọc "Ngành Hàng" kiểu tìm-kiếm-gõ-chọn (sdd*): gõ không dấu, gõ giá trị không
//      tồn tại ("Không tìm thấy."), chọn gợi ý rồi xoá trắng ô.
//
// Chạy: node server/tests/audit-v30-excel-dashboard-sdd.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'audit-v30-28-30');

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

let failures = 0;
async function step(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); }
  catch (err) { failures++; console.log(`FAIL: ${name}\n  -> ${err && err.message ? err.message : err}`); }
}

// ================================================================================================
// PHẦN 1) XUẤT EXCEL THẬT (bấm nút thật) — Hạn Sử Dụng (kết hợp 4 điều kiện) + Đối Chiếu (chống cache cũ)
// ================================================================================================
async function runExcelExportSuite() {
  const PORT = 8982;
  const DEPT = 'Siêu thị Quận 1';
  const USER = { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT, perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true };
  const now = Date.now();
  const fmt = (ms) => new Date(ms).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const nearTs = fmt(now - 2 * 86400000);
  const farTs = fmt(now - 20 * 86400000);

  // 5 bản ghi, CHỈ 1 bản ghi (EXA01) khớp ĐỦ CẢ 4 điều kiện lọc sẽ áp dụng cùng lúc: Quầy Kệ=KE-1,
  // Thời Gian Ghi Nhận Từ (gần đây), Hạn Sử Dụng Đến (sắp hết), Số Lượng Từ (>=10).
  const shelfRecords = [
    { id: 1, dept: DEPT, shelfLocationId: 1, shelfLocationCode: 'KE-1', shelfLocationName: 'Kệ KE-1', maHang: 'EXA01', maVach: 'V001', productName: 'Khớp đủ 4 điều kiện', quantity: 15, expiryDate: new Date(now + 5 * 86400000).toISOString(), creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: nearTs, lastScannedAt: nearTs },
    { id: 2, dept: DEPT, shelfLocationId: 2, shelfLocationCode: 'KE-2', shelfLocationName: 'Kệ KE-2', maHang: 'EXA02', maVach: 'V002', productName: 'Sai quầy kệ', quantity: 15, expiryDate: new Date(now + 5 * 86400000).toISOString(), creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: nearTs, lastScannedAt: nearTs },
    { id: 3, dept: DEPT, shelfLocationId: 1, shelfLocationCode: 'KE-1', shelfLocationName: 'Kệ KE-1', maHang: 'EXA03', maVach: 'V003', productName: 'Ghi nhận quá xa', quantity: 15, expiryDate: new Date(now + 5 * 86400000).toISOString(), creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: farTs, lastScannedAt: farTs },
    { id: 4, dept: DEPT, shelfLocationId: 1, shelfLocationCode: 'KE-1', shelfLocationName: 'Kệ KE-1', maHang: 'EXA04', maVach: 'V004', productName: 'Hạn sử dụng còn quá xa', quantity: 15, expiryDate: new Date(now + 60 * 86400000).toISOString(), creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: nearTs, lastScannedAt: nearTs },
    { id: 5, dept: DEPT, shelfLocationId: 1, shelfLocationCode: 'KE-1', shelfLocationName: 'Kệ KE-1', maHang: 'EXA05', maVach: 'V005', productName: 'Số lượng thiếu', quantity: 3, expiryDate: new Date(now + 5 * 86400000).toISOString(), creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: nearTs, lastScannedAt: nearTs }
  ];
  const inventoryRows = [
    { maHang: 'PROD-A', tenHang: 'Sản phẩm A (đã scan)', soLuongTon: 50 },
    { maHang: 'PROD-B', tenHang: 'Sản phẩm B (đã scan)', soLuongTon: 20 },
    { maHang: 'PROD-C', tenHang: 'Sản phẩm C (CHƯA scan lúc đầu)', soLuongTon: 10 }
  ];
  const reconScannedRecordsInitial = [
    { id: 101, dept: DEPT, shelfLocationId: 1, shelfLocationCode: 'KE-1', shelfLocationName: 'Kệ KE-1', maHang: 'PROD-A', maVach: 'VA', productName: 'Sản phẩm A', quantity: 50, expiryDate: new Date(now + 30 * 86400000).toISOString(), creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: nearTs, lastScannedAt: nearTs },
    { id: 102, dept: DEPT, shelfLocationId: 1, shelfLocationCode: 'KE-1', shelfLocationName: 'Kệ KE-1', maHang: 'PROD-B', maVach: 'VB', productName: 'Sản phẩm B', quantity: 20, expiryDate: new Date(now + 30 * 86400000).toISOString(), creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: nearTs, lastScannedAt: nearTs }
  ];

  const state = createMockState({
    depts: [DEPT], users: [USER],
    shelfLocations: [{ id: 1, code: 'KE-1', name: 'Kệ KE-1', category: 'Bánh kẹo', dept: DEPT, active: true }],
    shelfRecords: shelfRecords.concat(reconScannedRecordsInitial),
    __mockSystemInventoryRows: inventoryRows
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');

    await step('[Excel] "Hạn Sử Dụng" — bấm nút thật, 4 điều kiện lọc CÙNG LÚC -> Excel chỉ chứa đúng 1 dòng khớp cả 4', async () => {
      await page.click('#btnVhShelfSubExpiry');
      await page.waitForTimeout(150);
      await page.click('#btnToggleShelfExpiryFilter');
      await page.fill('#sefShelfLocation', 'KE-1');
      await page.dispatchEvent('#sefShelfLocation', 'input');
      await page.fill('#sefCreatedFrom', new Date(now - 5 * 86400000).toISOString().slice(0, 10));
      await page.dispatchEvent('#sefCreatedFrom', 'change');
      await page.fill('#sefExpiryTo', new Date(now + 10 * 86400000).toISOString().slice(0, 10));
      await page.dispatchEvent('#sefExpiryTo', 'change');
      await page.fill('#sefQtyMin', '10');
      await page.dispatchEvent('#sefQtyMin', 'input');
      await page.waitForTimeout(150);
      // Xác nhận MÀN HÌNH đã đúng 1 dòng TRƯỚC khi bấm Xuất Excel thật.
      const onScreenRows = await page.locator('#vhShelfExpiryBody tr').count();
      assert.strictEqual(onScreenRows, 1, `LỖI: màn hình phải còn đúng 1 dòng sau khi lọc 4 điều kiện (thực tế ${onScreenRows} dòng) — chưa bấm Excel đã sai thì Excel chắc chắn cũng sai theo`);

      const exportsBefore = (state.__xlsxExports || []).length;
      await page.click('[data-op="exportShelfExpiryExcel"]'); // BẤM NÚT THẬT, không gọi thẳng hàm JS
      await page.waitForTimeout(200);
      assert.strictEqual((state.__xlsxExports || []).length, exportsBefore + 1, 'LỖI: bấm "📥 Xuất Excel" (Hạn Sử Dụng) phải gửi đúng 1 lần POST /api/admin/export-xlsx mới');
      const exp = state.__xlsxExports[state.__xlsxExports.length - 1];
      assert.strictEqual(exp.rows.length, 1, `LỖI: Excel "Hạn Sử Dụng" phải CHỈ chứa 1 dòng khớp ĐỦ CẢ 4 điều kiện lọc đang áp dụng, không phải toàn bộ ${shelfRecords.length} dòng gốc. Thực tế: ${exp.rows.length} dòng`);
      assert.strictEqual(exp.rows[0].maHang, 'EXA01', `LỖI: dòng Excel xuất ra phải đúng EXA01 (khớp cả 4 điều kiện), không phải mã khác. Thực tế: ${exp.rows[0].maHang}`);
      console.log('  -> Excel Hạn Sử Dụng (4 điều kiện lọc cùng lúc) chỉ có đúng 1 dòng: ' + JSON.stringify(exp.rows[0]));
      await page.click('[data-op="clearShelfExpiryFilters"]');
      await page.waitForTimeout(120);
    });

    await step('[Excel] "Đối Chiếu" — bấm nút thật, dữ liệu MỚI (sau khi có scan thêm) KHÔNG dùng cache cũ', async () => {
      await page.click('#btnVhShelfSubRecon');
      await page.waitForTimeout(300);
      const exportsBefore1 = (state.__xlsxExports || []).length;
      await page.click('[data-op="exportShelfReconciliationExcel"]'); // BẤM NÚT THẬT
      await page.waitForTimeout(200);
      assert.strictEqual((state.__xlsxExports || []).length, exportsBefore1 + 1, 'LỖI: bấm Xuất Excel (Đối Chiếu, lần 1) phải gửi đúng 1 lần export mới');
      const exp1 = state.__xlsxExports[state.__xlsxExports.length - 1];
      assert.strictEqual(exp1.rows.length, 2, `LỖI: lúc đầu chỉ scan 2 mã (PROD-A/PROD-B) -> Excel Đối Chiếu phải đúng 2 dòng. Thực tế: ${exp1.rows.length}`);

      // Thêm 1 bản ghi SCAN MỚI (PROD-C, trước đó CHƯA từng scan) — mô phỏng nhân viên vừa quét thêm
      // hàng, rồi mở lại tab "📊 Đối Chiếu" (người dùng thật sẽ bấm lại tab, không phải F5 trang).
      const newScan = { id: 103, dept: DEPT, shelfLocationId: 1, shelfLocationCode: 'KE-1', shelfLocationName: 'Kệ KE-1', maHang: 'PROD-C', maVach: 'VC', productName: 'Sản phẩm C', quantity: 10, expiryDate: new Date(now + 30 * 86400000).toISOString(), creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: fmt(Date.now()), lastScannedAt: fmt(Date.now()) };
      state.shelfRecords.push(newScan);
      await page.evaluate((rec) => { DB.shelfRecords.push(rec); }, newScan);
      await page.click('#btnVhShelfSubExpiry'); // rời tab rồi quay lại, giống thao tác thật của người dùng
      await page.waitForTimeout(100);
      await page.click('#btnVhShelfSubRecon');
      await page.waitForTimeout(300); // chờ loadShelfReconciliation() tải lại THẬT từ server

      const onScreenReconRows = await page.locator('#vhShelfReconBody tr').count();
      assert.strictEqual(onScreenReconRows, 3, `LỖI: sau khi scan thêm PROD-C, màn hình "Đối Chiếu" phải hiện đủ 3 dòng (không đứng yên ở 2 dòng cache cũ). Thực tế: ${onScreenReconRows}`);

      const exportsBefore2 = (state.__xlsxExports || []).length;
      await page.click('[data-op="exportShelfReconciliationExcel"]'); // BẤM NÚT THẬT lần 2
      await page.waitForTimeout(200);
      const exp2 = state.__xlsxExports[state.__xlsxExports.length - 1];
      assert.strictEqual((state.__xlsxExports || []).length, exportsBefore2 + 1, 'LỖI: bấm Xuất Excel (Đối Chiếu, lần 2) phải gửi đúng 1 lần export mới');
      assert.strictEqual(exp2.rows.length, 3, `LỖI: Excel Đối Chiếu lần 2 (sau khi scan thêm PROD-C) phải xuất đủ 3 dòng, KHÔNG được dùng cache cũ chỉ 2 dòng. Thực tế: ${exp2.rows.length}`);
      assert.ok(exp2.rows.some(r => r.maHang === 'PROD-C'), 'LỖI: Excel Đối Chiếu lần 2 thiếu đúng mã PROD-C vừa scan thêm');
      console.log('  -> Excel Đối Chiếu lần 2 (sau khi scan thêm) có đủ 3 dòng, không dính cache 2 dòng cũ');
    });

    assert.strictEqual(jsErrors.length, 0, 'LỖI: có lỗi JS phát sinh trong PHẦN 1: ' + jsErrors.join('\n'));
    console.log('PASS: [PHẦN 1] Không có lỗi console.error/pageerror nào');
  } catch (err) {
    failures++;
    console.log('FAIL: [PHẦN 1] lỗi không mong đợi: ' + (err && err.stack || err));
  } finally {
    await browser.close();
    server.close();
  }
}

// ================================================================================================
// PHẦN 2) DASHBOARD GIÁ BÁN BUÔN/BÁN LẺ — bấm nhanh liên tục + chuyển tab nhiều lần
// ================================================================================================
function mkItPriceItem(id, code, priceType, status) {
  return {
    id, code, priceType, dept: 'Phòng Mua hàng Thực phẩm Tươi sống',
    creator: 'nv_mh', creatorName: 'Phạm Thị Thanh Loan', createdAt: new Date().toLocaleString('vi-VN'),
    status, currentStep: status === 'PENDING' ? 1 : 2, history: [], infoRequests: [], applied: false,
    reason: 'Audit dashboard', storeScope: { stores: [] },
    files: [{ id: 1, fileUrl: '/uploads/demo.xlsx', fileName: 'demo.xlsx', uploadedBy: 'nv_mh', uploadedByName: 'Phạm Thị Thanh Loan', uploadedAt: new Date().toLocaleString('vi-VN'), columnLabels: [{ key: 'c0', label: 'Mã hàng' }], items: [{ values: { c0: '1001' } }] }]
  };
}
function buildItPriceItems(priceType, startId) {
  return [
    mkItPriceItem(startId, `CODE-${priceType}-1`, priceType, 'PENDING'),
    mkItPriceItem(startId + 1, `CODE-${priceType}-2`, priceType, 'APPROVED'),
    mkItPriceItem(startId + 2, `CODE-${priceType}-3`, priceType, 'APPROVED'),
    mkItPriceItem(startId + 3, `CODE-${priceType}-4`, priceType, 'REJECTED')
  ];
}

async function runDashboardStressSuite() {
  const PORT = 8983;
  // id SỐ NGUYÊN tường minh (tránh kích hoạt nhánh tự vá "id lỗi dạng thập phân" ở finishLogin(), core.js
  // — nhánh đó tự POST /api/data/users NGẦM mà mock harness này không mô phỏng route chung, không liên
  // quan gì tới tính năng dashboard đang audit — cùng khuôn ADMIN có "id" tường minh ở các test khác).
  const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };
  const state = createMockState({
    depts: ['Phòng Mua hàng Thực phẩm Tươi sống'], users: [ADMIN],
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Phê duyệt' }] }],
    itPriceDeptWorkflows: { 'Phòng Mua hàng Thực phẩm Tươi sống': { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } } },
    itPriceApprovals: [...buildItPriceItems('WHOLESALE', 1), ...buildItPriceItems('RETAIL', 101)]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  // LƯU Ý: bỏ qua ĐÚNG 1 thông báo đã biết trước, KHÔNG liên quan gì tới dashboard đang audit — đăng
  // nhập admin với `perms` tối giản (không đủ field boolean cũ như submissionCreate...) luôn kích hoạt
  // nhánh "tự vá phân quyền cũ" ở finishLogin() (core.js, migrateLegacyPerms()) rồi âm thầm POST
  // /api/data/users — route CHUNG này chưa được mock ở testHarness.js (chỉ mock vài key cụ thể như
  // uniformCatalog/hrTaskTemplates...), nên mọi test đăng nhập ADMIN qua harness này đều in ra lỗi hệt
  // nhau (đã xác nhận: cả demo-itprice-dashboard-cards.js gốc, không đụng gì tới đợt audit này, cũng in
  // ra y hệt — chỉ vì nó không gắn listener 'console' nên không bị lộ ra). Lỗi THẬT của TÍNH NĂNG đang
  // audit vẫn được bắt đầy đủ qua pageerror + mọi console.error KHÁC.
  const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chưa hỗ trợ route: POST /api/data/users';
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().includes(KNOWN_HARNESS_NOISE)) return;
    jsErrors.push('[console.error] ' + msg.text());
  });

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);

    await step('[Dashboard Vận Hành] bấm ĐÚP (double-click) liên tục vào 1 thẻ -> không lỗi, lọc đúng đúng 1 lần', async () => {
      await page.evaluate(async () => { await switchTab('vanHanh'); setVanHanhSubTab('ITPRICE'); });
      await page.waitForTimeout(250);
      // dblclick() bắn 2 click LIÊN TIẾP SÁT NHAU (mô phỏng người dùng bấm nhanh) vào thẻ "Đang Chờ Duyệt".
      await page.dblclick('[data-op="filterVanHanhItPriceByCard"][data-arg0="PENDING"]');
      await page.waitForTimeout(200);
      const rows = await page.locator('#vanHanhItPriceTableBody tr').count();
      assert.strictEqual(rows, 1, `LỖI: bấm đúp thẻ "Đang Chờ Duyệt" phải ra đúng 1 dòng (lọc 2 lần liên tiếp vẫn phải ra CÙNG kết quả, không cộng dồn/xoá nhầm). Thực tế: ${rows}`);
      const selectVal = await page.inputValue('#filterStatusVanHanhItPrice');
      assert.strictEqual(selectVal, 'PENDING', `LỖI: sau khi bấm đúp, ô lọc trạng thái phải đúng "PENDING", không bị treo giá trị khác. Thực tế: "${selectVal}"`);
    });

    await step('[Dashboard Vận Hành] bấm LIÊN TIẾP 2 thẻ KHÁC NHAU không đợi -> kết quả CUỐI CÙNG phải đúng thẻ bấm sau', async () => {
      // Không await giữa 2 lần click — mô phỏng người dùng bấm rất nhanh đổi ý giữa 2 thẻ.
      const p1 = page.click('[data-op="filterVanHanhItPriceByCard"][data-arg0=""]');
      const p2 = page.click('[data-op="filterVanHanhItPriceByCard"][data-arg0="APPROVED"]');
      await Promise.all([p1, p2]);
      await page.waitForTimeout(200);
      const rows = await page.locator('#vanHanhItPriceTableBody tr').count();
      assert.strictEqual(rows, 2, `LỖI: bấm liên tiếp "Tổng Đề Xuất" rồi "Đã Phê Duyệt" (không đợi) -> kết quả CUỐI phải là "Đã Phê Duyệt" (2 dòng), không bị kẹt ở trạng thái lưng chừng/sai. Thực tế: ${rows}`);
      const selectVal = await page.inputValue('#filterStatusVanHanhItPrice');
      assert.strictEqual(selectVal, 'APPROVED', `LỖI: ô lọc trạng thái phải dừng đúng ở giá trị của lần bấm SAU CÙNG ("APPROVED"). Thực tế: "${selectVal}"`);
      await page.click('[data-op="filterVanHanhItPriceByCard"][data-arg0=""]');
      await page.waitForTimeout(150);
    });

    await step('[Dashboard] chuyển qua lại Vận Hành <-> Mua Hàng NHIỀU LẦN (6 vòng) -> số liệu KHÔNG lệch/lẫn', async () => {
      for (let i = 0; i < 6; i++) {
        await page.evaluate(async () => { await switchTab('vanHanh'); setVanHanhSubTab('ITPRICE'); });
        await page.waitForTimeout(100);
        const vhCards = await page.evaluate(() => Array.from(document.querySelectorAll('#vanHanhItPriceDashboardCards > div > div')).map(c => Array.from(c.children).map(x => x.textContent.trim())));
        assert.deepStrictEqual(vhCards, [['Tổng Đề Xuất', '4'], ['Đang Chờ Duyệt', '1'], ['Đã Phê Duyệt', '2'], ['Bị Từ Chối', '1']],
          `LỖI [vòng ${i + 1}]: dashboard Vận Hành (Bán Buôn) phải LUÔN đúng 4/1/2/1 dù chuyển tab qua lại nhiều lần. Thực tế: ${JSON.stringify(vhCards)}`);

        await page.evaluate(async () => { await switchTab('muaHang'); setPurchasingSubTab('ITPRICE'); });
        await page.waitForTimeout(100);
        const mhCards = await page.evaluate(() => Array.from(document.querySelectorAll('#mhItPriceDashboardCards > div > div')).map(c => Array.from(c.children).map(x => x.textContent.trim())));
        assert.deepStrictEqual(mhCards, [['Tổng Đề Xuất', '4'], ['Đang Chờ Duyệt', '1'], ['Đã Phê Duyệt', '2'], ['Bị Từ Chối', '1']],
          `LỖI [vòng ${i + 1}]: dashboard Mua Hàng (Bán Lẻ) phải LUÔN đúng 4/1/2/1 dù chuyển tab qua lại nhiều lần, KHÔNG được lẫn số của Vận Hành. Thực tế: ${JSON.stringify(mhCards)}`);
      }
      console.log('  -> 6/6 vòng chuyển tab Vận Hành <-> Mua Hàng đều giữ đúng 4/1/2/1 ở cả 2 bên, không lẫn/lệch số');
      await shot(page, '#muaHangSection', '5-dashboard-mua-hang-sau-6-vong-chuyen-tab.png');
    });

    assert.strictEqual(jsErrors.length, 0, 'LỖI: có lỗi JS phát sinh trong PHẦN 2: ' + jsErrors.join('\n'));
    console.log('PASS: [PHẦN 2] Không có lỗi console.error/pageerror nào (kể cả lúc bấm đúp/bấm liên tiếp/chuyển tab dồn dập)');
  } catch (err) {
    failures++;
    console.log('FAIL: [PHẦN 2] lỗi không mong đợi: ' + (err && err.stack || err));
  } finally {
    await browser.close();
    server.close();
  }
}

// ================================================================================================
// PHẦN 3) "🗄️ Quầy Kệ" — ô lọc "Ngành Hàng" (sdd*): gõ không dấu / không tồn tại / chọn rồi xoá trắng
// ================================================================================================
async function runShelfCategorySddSuite() {
  const PORT = 8984;
  const DEPT = 'Siêu thị Quận 1';
  const USER = { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT, perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true };
  const CATS = ['Mỹ phẩm', 'Đồ uống', 'Bánh kẹo', 'Gia dụng'];
  const shelfLocations = CATS.flatMap((cat, ci) => Array.from({ length: 2 }, (_, i) => ({
    id: 100 + ci * 2 + i, code: `KE-${ci}-${i}`, name: `Kệ ${cat} ${i + 1}`, category: cat, dept: DEPT, active: true
  })));

  const state = createMockState({ depts: [DEPT], users: [USER], shelfLocations });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubLocations');
    await page.waitForTimeout(150);
    await page.click('#btnToggleShelfLocationFilter');
    await page.waitForTimeout(100);

    await step('[Quầy Kệ] click vào ô "Ngành Hàng" -> hiện ĐỦ cả 4 gợi ý (chưa gõ gì)', async () => {
      await page.click('#slfCategory');
      await page.waitForTimeout(150);
      const options = await page.locator('#slfCategoryDropdown [data-sdd-idx]').allTextContents();
      assert.deepStrictEqual(options.slice().sort(), CATS.slice().sort(), `LỖI: click vào ô chưa gõ gì phải hiện ĐỦ 4 ngành hàng hiện có. Thực tế: ${JSON.stringify(options)}`);
      await shot(page, '#vanHanhShelfWrap', '6-quay-ke-nganh-hang-mo-du-4-goi-y.png');
    });

    await step('[Quầy Kệ] gõ KHÔNG DẤU "do uong" -> vẫn ra đúng gợi ý có dấu "Đồ uống"', async () => {
      await page.fill('#slfCategory', 'do uong');
      await page.dispatchEvent('#slfCategory', 'input');
      await page.waitForTimeout(150);
      const options = await page.locator('#slfCategoryDropdown [data-sdd-idx]').allTextContents();
      assert.deepStrictEqual(options, ['Đồ uống'], `LỖI: gõ không dấu "do uong" phải CHỈ gợi ý đúng 1 kết quả "Đồ uống" (so khớp bỏ dấu). Thực tế: ${JSON.stringify(options)}`);
      // Danh sách Quầy Kệ trên MÀN HÌNH cũng phải lọc theo (chưa chọn, chỉ mới gõ — field lọc đọc
      // .value trực tiếp nên gõ không dấu rồi filter theo chuỗi KHÔNG DẤU đó).
      console.log('  -> Gợi ý đúng 1 kết quả "Đồ uống" khi gõ không dấu "do uong"');
    });

    await step('[Quầy Kệ] gõ giá trị KHÔNG TỒN TẠI -> dropdown báo "Không tìm thấy." đàng hoàng', async () => {
      await page.fill('#slfCategory', 'xyz-khong-ton-tai-123');
      await page.dispatchEvent('#slfCategory', 'input');
      await page.waitForTimeout(150);
      const ddText = (await page.locator('#slfCategoryDropdown').innerText()).trim();
      assert.strictEqual(ddText, 'Không tìm thấy.', `LỖI: gõ ngành hàng không tồn tại phải báo "Không tìm thấy.", không được hiện trống trơn/gợi ý sai. Thực tế: "${ddText}"`);
      // Danh sách Quầy Kệ bên dưới cũng phải rỗng/báo đúng (lọc theo chuỗi không khớp dòng nào).
      await page.dispatchEvent('#slfCategory', 'change');
      await page.waitForTimeout(150);
      const bodyText = (await page.locator('#vhShelfLocationsBody').innerText()).trim();
      assert.ok(bodyText.includes('Không có quầy kệ nào khớp bộ lọc'), `LỖI: lọc Ngành Hàng không khớp dòng nào thì bảng Quầy Kệ phải báo rõ "Không có quầy kệ nào khớp bộ lọc". Thực tế: "${bodyText}"`);
      await shot(page, '#vanHanhShelfWrap', '7-quay-ke-nganh-hang-khong-tim-thay.png');
      console.log('  -> Gõ ngành hàng không tồn tại: dropdown "Không tìm thấy.", bảng báo đúng "Không có quầy kệ nào khớp bộ lọc"');
    });

    await step('[Quầy Kệ] chọn 1 gợi ý (bấm chuột THẬT) rồi XOÁ TRẮNG ô -> danh sách trả về ĐẦY ĐỦ', async () => {
      await page.fill('#slfCategory', 'My pham'); // không dấu, phải vẫn ra gợi ý "Mỹ phẩm"
      await page.dispatchEvent('#slfCategory', 'input');
      await page.waitForTimeout(150);
      await page.locator('#slfCategoryDropdown [data-sdd-idx]', { hasText: 'Mỹ phẩm' }).click(); // CLICK CHUỘT THẬT, không set value bằng tay
      await page.waitForTimeout(150);
      const inputVal = await page.inputValue('#slfCategory');
      assert.strictEqual(inputVal, 'Mỹ phẩm', `LỖI: bấm chuột chọn gợi ý phải điền ĐÚNG label có dấu vào ô, không giữ nguyên chữ gõ không dấu. Thực tế: "${inputVal}"`);
      let rows = await page.locator('#vhShelfLocationsBody tr').count();
      assert.strictEqual(rows, 2, `LỖI: sau khi chọn "Mỹ phẩm", bảng Quầy Kệ phải CHỈ còn đúng 2 dòng thuộc ngành hàng đó. Thực tế: ${rows}`);

      // Xoá TRẮNG ô (select-all + Delete, giống thao tác bàn phím thật) -> danh sách phải trả về ĐẦY ĐỦ
      // toàn bộ 8 quầy kệ (4 ngành hàng x 2 quầy), không bị kẹt lại bộ lọc cũ.
      await page.click('#slfCategory');
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await page.dispatchEvent('#slfCategory', 'input');
      await page.waitForTimeout(150);
      rows = await page.locator('#vhShelfLocationsBody tr').count();
      assert.strictEqual(rows, shelfLocations.length, `LỖI: xoá trắng ô "Ngành Hàng" sau khi đã chọn 1 gợi ý phải trả về ĐẦY ĐỦ ${shelfLocations.length} quầy kệ, không được kẹt lại kết quả đã lọc trước đó. Thực tế: ${rows}`);
      console.log(`  -> Chọn "Mỹ phẩm" bằng chuột thật -> còn 2 dòng; xoá trắng ô -> trả về đủ ${shelfLocations.length} dòng`);
      await shot(page, '#vanHanhShelfWrap', '8-quay-ke-nganh-hang-xoa-trang-tra-ve-day-du.png');
    });

    assert.strictEqual(jsErrors.length, 0, 'LỖI: có lỗi JS phát sinh trong PHẦN 3: ' + jsErrors.join('\n'));
    console.log('PASS: [PHẦN 3] Không có lỗi console.error/pageerror nào');
  } catch (err) {
    failures++;
    console.log('FAIL: [PHẦN 3] lỗi không mong đợi: ' + (err && err.stack || err));
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await runExcelExportSuite();
  await runDashboardStressSuite();
  await runShelfCategorySddSuite();
  console.log(`\n==== ${failures === 0 ? 'TẤT CẢ' : (failures + ' LỖI trong')} scenario(s) đã chạy (3 phần) ====`);
  console.log(`\nẢnh minh chứng đã lưu tại: ${OUT_DIR}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
