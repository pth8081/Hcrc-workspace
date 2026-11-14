// tests/test-stocktake-tab7-report-ui.js — test Playwright THẬT (click/select thật, không gọi hàm nội
// bộ) cho Tab 7 "📊 Báo Cáo" (chọn Kỳ + 3 biểu đồ CVD-safe + Xuất Excel, tài liệu đề xuất mục A7).
// Chạy: node tests/test-stocktake-tab7-report-ui.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8998;
  const DEPT1 = 'Siêu thị Quận 1';
  const DEPT2 = 'Siêu thị Quận 2';
  // STAFF: có quyền Kiểm Đếm nhưng KHÔNG kiemKeReportView — dùng để xác nhận nút Tab 7 ẨN đúng.
  const STAFF = { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, perms: { kiemKeKiemDemDo: true }, active: true, totpEnabled: true };
  // MANAGER: kiemKeReportView — xem được Báo Cáo của ĐÚNG siêu thị mình, KHÔNG thấy "So Sánh Siêu Thị".
  const MANAGER = { username: 'qlA', name: 'Quản Lý A', dept: DEPT1, perms: { kiemKeReportView: true }, active: true, totpEnabled: true };
  const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };

  const GOMMA_SESSION = { id: 9101, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONGKE_SESSION = { id: 9102, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONGKE_DEPT2_SESSION = { id: 9103, dept: DEPT2, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Q2 — Q4/2026', trangThai: 'DA_CHOT' };

  const state = createMockState({
    depts: [DEPT1, DEPT2], stores: [DEPT1, DEPT2], users: [STAFF, MANAGER, ADMIN],
    shelfLocations: [{ id: 50, dept: DEPT1, code: 'A1', name: 'Kệ A1', active: true }],
    stocktakeSessions: [GOMMA_SESSION, THONGKE_SESSION, THONGKE_DEPT2_SESSION],
    stocktakeCounts: [
      // Gom Mã Q1: SP001 tham khảo 46.
      { id: 1, sessionId: GOMMA_SESSION.id, dept: DEPT1, shelfLocationId: 50, maHang: 'SP001', tenHang: 'Hàng A1', slGomMa: 46, slKiemDem: 0 },
      // Thống Kê Q1: SP001 Kiểm Đếm 48 (chưa soát); SP002 Kiểm Đếm 120 rồi Kiểm Soát lại 108 (A6 ghi đè).
      { id: 2, sessionId: THONGKE_SESSION.id, dept: DEPT1, shelfLocationId: 50, maHang: 'SP001', tenHang: 'Hàng A1', slGomMa: 0, slKiemDem: 48 },
      { id: 3, sessionId: THONGKE_SESSION.id, dept: DEPT1, shelfLocationId: 50, maHang: 'SP002', tenHang: 'Hàng A2', slGomMa: 0, slKiemDem: 120, slKiemSoat: 108 }
    ]
  });
  state.__mockStocktakeReportInventoryByDept = {
    [DEPT1]: [{ maHang: 'SP001', tenHang: 'Hàng A1', soLuongTon: 50 }, { maHang: 'SP002', tenHang: 'Hàng A2', soLuongTon: 30 }],
    [DEPT2]: [{ maHang: 'SP003', tenHang: 'Hàng B1', soLuongTon: 20 }]
  };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chưa hỗ trợ route: POST /api/data/users';
  const jsErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().includes(KNOWN_HARNESS_NOISE)) return;
    jsErrors.push('[console.error] ' + msg.text());
  });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, STAFF);
    await page.evaluate(() => switchTab('vanHanh'));
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(100);

    await run.run('nv1 (KHÔNG kiemKeReportView) KHÔNG thấy nút Tab 7 "Báo Cáo"', async () => {
      const visible = await page.isVisible('#btnKkSubReport');
      assert(!visible, 'LỖI: nút Tab 7 phải ẨN với người không có kiemKeReportView');
    });

    // Chuyển sang qlA (có kiemKeReportView).
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, MANAGER);
    await page.evaluate(() => switchTab('vanHanh'));
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(100);
    await page.click('#btnKkSubReport');
    await page.waitForTimeout(200);

    await run.run('qlA: chọn kỳ Thống Kê Q4/2026 -> hiện đúng stat cards + bảng chi tiết', async () => {
      await page.selectOption('#kkReportSessionSelect', String(THONGKE_SESSION.id));
      await page.waitForTimeout(250);
      const bodyVisible = await page.isVisible('#kkReportBody');
      assert(bodyVisible, 'LỖI: #kkReportBody phải hiện sau khi chọn kỳ');
      const rowsText = await page.textContent('#kkReportTableBody');
      assert(rowsText.includes('SP001') && rowsText.includes('SP002'), 'LỖI: bảng chi tiết phải có cả SP001/SP002');
      assert(!rowsText.includes('Gom Mã'), 'LỖI: bảng chi tiết kỳ Thống Kê KHÔNG được có chữ "Gom Mã" (mỗi kỳ báo cáo độc lập, không trộn Gom Mã của kỳ khác)');
      // SP002: cột Kiểm Đếm=120 (raw), Kiểm Soát=108, SL Cuối Cùng=108 (A6 ghi đè) — đọc đúng từng ô
      // (không dùng includes() thô trên cả bảng vì "120" giờ hợp lệ xuất hiện ở cột Kiểm Đếm riêng).
      const sp002Cells = await page.$$eval('#kkReportTableBody tr', (trs) => {
        const row = trs.find(tr => tr.textContent.includes('SP002'));
        return row ? [...row.querySelectorAll('td')].map(td => td.textContent.trim()) : null;
      });
      assert(sp002Cells, 'LỖI: không tìm thấy dòng SP002');
      assert(sp002Cells[3] === '120', `LỖI: cột Kiểm Đếm (SP002) phải là 120 (raw, chưa ghi đè) -- got: ${JSON.stringify(sp002Cells)}`);
      assert(sp002Cells[4] === '108', `LỖI: cột Kiểm Soát (SP002) phải là 108 -- got: ${JSON.stringify(sp002Cells)}`);
      assert(sp002Cells[5] === '108', `LỖI: cột SL Cuối Cùng (SP002) phải là 108 (Kiểm Soát ghi đè ĐÚNG A6, không phải 120) -- got: ${JSON.stringify(sp002Cells)}`);
    });

    await run.run('qlA: Chart 1 (SVG cột) + Chart 2 (SVG donut) render thật, có đủ 3 màu CVD-safe cố định', async () => {
      const svg1 = await page.$('#kkReportChart1 svg');
      assert(svg1, 'LỖI: Chart 1 phải render ra 1 <svg> thật');
      const svg2 = await page.$('#kkReportChart2 svg');
      assert(svg2, 'LỖI: Chart 2 (donut) phải render ra 1 <svg> thật');
      const fills = await page.$$eval('#kkReportChart1 svg rect', (els) => els.map(e => e.getAttribute('fill')));
      assert(fills.includes('#2563eb') && fills.includes('#ea580c') && fills.includes('#0d9488'), `LỖI: Chart 1 phải dùng đủ 3 màu cố định -- got: ${fills.join(',')}`);
    });

    await run.run('qlA (KHÔNG Admin): KHÔNG thấy khung "So Sánh Giữa Các Siêu Thị" (Phase 1 chưa xem chéo nhiều siêu thị)', async () => {
      const visible = await page.isVisible('#kkReportChart3Card');
      assert(!visible, 'LỖI: #kkReportChart3Card phải ẨN với người không-Admin');
    });

    await run.run('qlA: Kỳ Gom Mã tự xem báo cáo của chính nó -> không có cột "Gom Mã (tham khảo)" riêng, dùng SL Gom Mã làm giá trị chính', async () => {
      await page.selectOption('#kkReportSessionSelect', String(GOMMA_SESSION.id));
      await page.waitForTimeout(250);
      const headText = await page.textContent('#kkReportTableHead');
      assert(!headText.includes('Gom Mã (tham khảo)'), 'LỖI: Kỳ Gom Mã không được có cột "Gom Mã (tham khảo)" riêng');
      assert(headText.includes('SL Gom Mã'), 'LỖI: Kỳ Gom Mã phải có cột "SL Gom Mã"');
      const rowsText = await page.textContent('#kkReportTableBody');
      assert(rowsText.includes('SP001') && rowsText.includes('46'), `LỖI: Kỳ Gom Mã phải hiện SP001=46 -- got: ${rowsText}`);
    });

    await run.run('qlA: "📊 Xuất Excel" gửi ĐÚNG 1 lần, 1 sheet duy nhất (không-Admin không có So Sánh Siêu Thị)', async () => {
      state.__xlsxExports = [];
      await page.selectOption('#kkReportSessionSelect', String(THONGKE_SESSION.id));
      await page.waitForTimeout(200);
      await page.click('[data-op="exportKkReportExcel"]');
      await page.waitForTimeout(150);
      assertEqual((state.__xlsxExports || []).length, 1, 'LỖI: bấm Xuất Excel phải gửi đúng 1 lần POST /api/admin/export-xlsx');
      const sent = state.__xlsxExports[0];
      assert(sent.rows && !sent.sheets, 'LỖI: không-Admin phải xuất 1 sheet đơn (columns/rows), không phải nhiều sheet');
    });

    await run.run('qlA: "📊 So Sánh Với Kỳ Khác" — chọn kỳ Gom Mã để so sánh với kỳ Thống Kê đang xem -> hiện đúng khung So Sánh, KHÔNG trộn vào bảng chi tiết chính', async () => {
      await page.selectOption('#kkReportSessionSelect', String(THONGKE_SESSION.id));
      await page.waitForTimeout(200);
      const compareCardHiddenBefore = await page.evaluate(() => document.getElementById('kkReportCompareCard').classList.contains('hidden'));
      assert(compareCardHiddenBefore, 'LỖI: mặc định (chưa chọn so sánh) khung So Sánh phải ẨN');
      await page.selectOption('#kkReportCompareSelect', String(GOMMA_SESSION.id));
      await page.waitForTimeout(250);
      const compareCardVisible = await page.isVisible('#kkReportCompareCard');
      assert(compareCardVisible, 'LỖI: chọn kỳ so sánh xong phải HIỆN khung So Sánh');
      const svgCompare = await page.$('#kkReportCompareChart svg');
      assert(svgCompare, 'LỖI: khung So Sánh phải render ra 1 <svg> thật');
      const headText = await page.textContent('#kkReportTableHead');
      assert(!headText.includes('Gom Mã'), 'LỖI: bật So Sánh KHÔNG được trộn cột Gom Mã vào bảng chi tiết chính (vẫn phải độc lập)');
      // Tắt so sánh lại -> khung ẩn đi, bảng chính không đổi.
      await page.selectOption('#kkReportCompareSelect', '');
      await page.waitForTimeout(250);
      const compareCardHiddenAfter = await page.evaluate(() => document.getElementById('kkReportCompareCard').classList.contains('hidden'));
      assert(compareCardHiddenAfter, 'LỖI: bỏ chọn so sánh phải ẨN lại khung So Sánh');
    });

    // Chuyển sang Admin — thấy chéo siêu thị.
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('vanHanh'));
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(100);
    await page.click('#btnKkSubReport');
    await page.waitForTimeout(200);

    await run.run('Admin: chọn Kỳ Thống Kê Q4/2026 -> hiện khung "So Sánh Giữa Các Siêu Thị" với CẢ 2 siêu thị', async () => {
      await page.selectOption('#kkReportSessionSelect', String(THONGKE_SESSION.id));
      await page.waitForTimeout(250);
      const visible = await page.isVisible('#kkReportChart3Card');
      assert(visible, 'LỖI: Admin phải thấy #kkReportChart3Card');
      const text = await page.textContent('#kkReportChart3');
      assert(text.includes(DEPT1) && text.includes(DEPT2), `LỖI: So Sánh Siêu Thị phải liệt kê CẢ 2 siêu thị -- got: ${text}`);
    });

    await run.run('Admin: "📊 Xuất Excel" gửi 2 sheet (Chi Tiết + So Sánh Siêu Thị)', async () => {
      state.__xlsxExports = [];
      await page.click('[data-op="exportKkReportExcel"]');
      await page.waitForTimeout(150);
      assertEqual((state.__xlsxExports || []).length, 1, 'LỖI: bấm Xuất Excel phải gửi đúng 1 lần');
      const sent = state.__xlsxExports[0];
      assert(Array.isArray(sent.sheets) && sent.sheets.length === 2, `LỖI: Admin phải xuất 2 sheet -- got: ${JSON.stringify(sent.sheets && sent.sheets.map(s => s.sheetName))}`);
    });

    await run.run('Không có lỗi JS/console nào phát sinh', async () => {
      assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    });

    run.summary();
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
