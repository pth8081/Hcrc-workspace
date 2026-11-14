// tests/demo-stocktake-tab7-report.js — demo Playwright THẬT cho Tab 7 "📊 Báo Cáo" (11/2026, Kiểm Kê,
// hoàn tất đủ 8/8 tab). Chụp lại: kỳ Thống Kê (bảng/3 biểu đồ CVD-safe) -> kỳ Gom Mã (giao diện rút gọn)
// -> Admin thấy thêm "So Sánh Giữa Các Siêu Thị".
// Chạy: node tests/demo-stocktake-tab7-report.js — ảnh lưu ở demo-screenshots/stocktake-tab7-report/.
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8992;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'stocktake-tab7-report');
const DEPT1 = 'Siêu thị Quận 1';
const DEPT2 = 'Siêu thị Quận 2';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const MANAGER = { username: 'qlA', name: 'Quản Lý A', dept: DEPT1, perms: { kiemKeReportView: true }, active: true, totpEnabled: true };
  const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };
  const GOMMA_SESSION = { id: 9201, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Quý 4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONGKE_SESSION = { id: 9202, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Quý 4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONGKE_DEPT2 = { id: 9203, dept: DEPT2, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Quý 4/2026 — Q2', trangThai: 'DA_CHOT' };

  const state = createMockState({
    depts: [DEPT1, DEPT2], stores: [DEPT1, DEPT2], users: [MANAGER, ADMIN],
    shelfLocations: [{ id: 60, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true }],
    stocktakeSessions: [GOMMA_SESSION, THONGKE_SESSION, THONGKE_DEPT2],
    stocktakeCounts: [
      { id: 1, sessionId: GOMMA_SESSION.id, dept: DEPT1, shelfLocationId: 60, maHang: 'SP001', tenHang: 'G7 Cà Phê 3in1', slGomMa: 46 },
      { id: 2, sessionId: GOMMA_SESSION.id, dept: DEPT1, shelfLocationId: 60, maHang: 'SP002', tenHang: 'Mì Hảo Hảo Tôm Chua Cay', slGomMa: 118 },
      { id: 3, sessionId: THONGKE_SESSION.id, dept: DEPT1, shelfLocationId: 60, maHang: 'SP001', tenHang: 'G7 Cà Phê 3in1', slKiemDem: 48 },
      { id: 4, sessionId: THONGKE_SESSION.id, dept: DEPT1, shelfLocationId: 60, maHang: 'SP002', tenHang: 'Mì Hảo Hảo Tôm Chua Cay', slKiemDem: 120, slKiemSoat: 108 },
      { id: 5, sessionId: THONGKE_SESSION.id, dept: DEPT1, shelfLocationId: 60, maHang: 'SP003', tenHang: 'Sữa Tươi Vinamilk 1L', slKiemDem: 76 },
      { id: 6, sessionId: THONGKE_SESSION.id, dept: DEPT1, shelfLocationId: 60, maHang: 'SP004', tenHang: 'Nước Giặt Omo 3.7kg', slKiemDem: 22 },
      { id: 7, sessionId: THONGKE_DEPT2.id, dept: DEPT2, shelfLocationId: 60, maHang: 'SP003', tenHang: 'Sữa Tươi Vinamilk 1L', slKiemDem: 60 }
    ]
  });
  state.__mockStocktakeReportInventoryByDept = {
    [DEPT1]: [
      { maHang: 'SP001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 },
      { maHang: 'SP002', tenHang: 'Mì Hảo Hảo Tôm Chua Cay', soLuongTon: 108 },
      { maHang: 'SP003', tenHang: 'Sữa Tươi Vinamilk 1L', soLuongTon: 76 },
      { maHang: 'SP004', tenHang: 'Nước Giặt Omo 3.7kg', soLuongTon: 24 }
    ],
    [DEPT2]: [{ maHang: 'SP003', tenHang: 'Sữa Tươi Vinamilk 1L', soLuongTon: 65 }]
  };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(String(err && err.stack || err)));

  let n = 0;
  const shot = async (label) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
    console.log(`📸 ${file}`);
  };

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
    await page.evaluate(() => switchTab('vanHanh'));
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(150);
    await page.click('#btnKkSubReport');
    await page.waitForTimeout(200);
    await page.selectOption('#kkReportSessionSelect', String(THONGKE_SESSION.id));
    await page.waitForTimeout(300);
    await shot('qla-thongke-day-du');

    await page.selectOption('#kkReportSessionSelect', String(GOMMA_SESSION.id));
    await page.waitForTimeout(300);
    await shot('qla-gomma-rut-gon');

    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('vanHanh'));
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(150);
    await page.click('#btnKkSubReport');
    await page.waitForTimeout(200);
    await page.selectOption('#kkReportSessionSelect', String(THONGKE_SESSION.id));
    await page.waitForTimeout(300);
    await shot('admin-thongke-co-so-sanh-sieu-thi');

    console.log(jsErrors.length ? `⚠️  Có ${jsErrors.length} lỗi JS: ${jsErrors.join('\n')}` : '✅ Không có lỗi JS/console nào phát sinh.');
    console.log(`\n✅ Đã chụp ${n} ảnh demo tại ${OUT_DIR}`);
  } finally {
    await browser.close();
    await server.close();
  }
})();
