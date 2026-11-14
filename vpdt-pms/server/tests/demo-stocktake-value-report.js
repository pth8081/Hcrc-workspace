// tests/demo-stocktake-value-report.js — DEMO ảnh thật cho tính năng MỚI "💰 Giá Trị Thừa/Thiếu" ở Tab 7
// "📊 Báo Cáo" (12/2026, theo yêu cầu người dùng: "lấy phần tồn kho với cả phần giá sang để làm báo cáo
// xuất ra giá trị siêu thị thừa thiếu bao nhiêu"). Chạy: node server/tests/demo-stocktake-value-report.js
'use strict';
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8996;
const OUT_DIR = process.env.KK_VALUE_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'stocktake-value-report');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const DEPT1 = 'Siêu thị số 120 Hàng Trống';
  const DEPT2 = 'Siêu thị số 45 Láng Hạ';
  const MANAGER = { username: 'qlA', name: 'Quản Lý A', dept: DEPT1, perms: { kiemKeReportView: true }, active: true, totpEnabled: true };
  const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };
  const THONGKE_SESSION = { id: 9201, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONGKE_DEPT2_SESSION = { id: 9202, dept: DEPT2, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };

  const state = createMockState({
    depts: [DEPT1, DEPT2], stores: [DEPT1, DEPT2], users: [MANAGER, ADMIN],
    shelfLocations: [{ id: 50, dept: DEPT1, code: 'A1', name: 'Kệ A1', active: true }],
    stocktakeSessions: [THONGKE_SESSION, THONGKE_DEPT2_SESSION],
    stocktakeCounts: [
      { id: 1, sessionId: THONGKE_SESSION.id, dept: DEPT1, shelfLocationId: 50, maHang: 'SP001', tenHang: 'Dầu Ăn Simply 1L', slKiemDem: 48 },
      { id: 2, sessionId: THONGKE_SESSION.id, dept: DEPT1, shelfLocationId: 50, maHang: 'SP002', tenHang: 'Nước Mắm Nam Ngư 500ml', slKiemDem: 120, slKiemSoat: 108 },
      { id: 3, sessionId: THONGKE_SESSION.id, dept: DEPT1, shelfLocationId: 50, maHang: 'SP003', tenHang: 'Mì Hảo Hảo (Thùng)', slKiemDem: 0 }
    ]
  });
  state.__mockStocktakeReportInventoryByDept = {
    [DEPT1]: [
      { maHang: 'SP001', tenHang: 'Dầu Ăn Simply 1L', soLuongTon: 50 },
      { maHang: 'SP002', tenHang: 'Nước Mắm Nam Ngư 500ml', soLuongTon: 30 },
      { maHang: 'SP003', tenHang: 'Mì Hảo Hảo (Thùng)', soLuongTon: 15 }
    ],
    [DEPT2]: [{ maHang: 'SP004', tenHang: 'Bột Giặt Omo 3kg', soLuongTon: 25 }]
  };
  // DEPT1 đã từng mở "💲 Kiểm Tra Giá" nên có sẵn giá SP001/SP002 — SP003 CHƯA có giá (test nhánh báo
  // rõ "mã chưa có giá"). DEPT2 hoàn toàn chưa có giá nào.
  state.__mockStocktakeReportPriceByDept = {
    [DEPT1]: [{ maHang: 'SP001', giaThuong: 45000 }, { maHang: 'SP002', giaThuong: 32000 }]
  };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1400, height: 1000 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
    await page.evaluate(() => switchTab('vanHanh'));
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(150);
    await page.click('#btnKkSubReport');
    await page.waitForTimeout(150);
    await page.selectOption('#kkReportSessionSelect', String(THONGKE_SESSION.id));
    await page.waitForTimeout(300);

    await page.screenshot({ path: path.join(OUT_DIR, '1-the-gia-tri-va-bang-chi-tiet.png'), fullPage: true });
    console.log('Đã chụp: 1-the-gia-tri-va-bang-chi-tiet.png');

    // Admin: xem thêm khung "Giá Trị Thừa/Thiếu Theo Siêu Thị".
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('vanHanh'));
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(150);
    await page.click('#btnKkSubReport');
    await page.waitForTimeout(150);
    await page.selectOption('#kkReportSessionSelect', String(THONGKE_SESSION.id));
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('kkReportValueByStoreCard')?.scrollIntoView());
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '2-admin-xep-hang-gia-tri-theo-sieu-thi.png'), fullPage: true });
    console.log('Đã chụp: 2-admin-xep-hang-gia-tri-theo-sieu-thi.png');

    console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
