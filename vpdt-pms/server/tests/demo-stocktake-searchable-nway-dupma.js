// tests/demo-stocktake-searchable-nway-dupma.js — DEMO ảnh thật cho 3 việc user vừa yêu cầu/xác nhận:
//   1) TOÀN BỘ select trong Kiểm Kê -> dropdown tìm-kiếm-gõ-chọn (sdd*), kể cả khi đang MỞ gợi ý.
//   2) "So Sánh Với Kỳ Khác" (Báo Cáo) mở rộng N-way (chọn NHIỀU kỳ cùng lúc, dạng chip).
//   3) Cột "Trùng Mã" MỚI ở Gom Mã/Kiểm Đếm/Kiểm Soát (mã rải rác nhiều quầy kệ).
// Chạy: node tests/demo-stocktake-searchable-nway-dupma.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'stocktake-searchable-nway-dupma');
const DEPT1 = 'Siêu thị Quận 1';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', active: true };
  const SHELF_A3 = { id: 12, dept: DEPT1, code: 'A3', name: 'Kệ A3 — Nước giải khát', active: true };

  const GOM_MA_SESSION = { id: 9101, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONG_KE_SESSION = { id: 9102, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONG_KE_Q3 = { id: 9103, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q3/2026', trangThai: 'DA_CHOT' };
  const THONG_KE_Q2 = { id: 9104, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q2/2026', trangThai: 'DA_CHOT' };

  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [ADMIN],
    kiemKeShelfLocations: [SHELF_A1, SHELF_A2, SHELF_A3],
    stocktakeSessions: [GOM_MA_SESSION, THONG_KE_SESSION, THONG_KE_Q3, THONG_KE_Q2],
    stocktakeUserAccess: [
      { id: 1, username: 'admin', dept: DEPT1, shelfLocationId: 10, canGomMa: true, canKiemDem: true, canKiemSoat: true },
      { id: 2, username: 'admin', dept: DEPT1, shelfLocationId: 11, canGomMa: true, canKiemDem: true, canKiemSoat: true },
      { id: 3, username: 'admin', dept: DEPT1, shelfLocationId: 12, canGomMa: true, canKiemDem: true, canKiemSoat: true }
    ],
    // SP001 rải rác trên CẢ 3 quầy kệ A1/A2/A3 (2+3+4=9) -> đúng ví dụ người dùng nêu cho cột "Trùng Mã".
    // SP002 chỉ ở A1 -> không trùng, hiện "—".
    stocktakeCounts: [
      { id: 1, sessionId: THONG_KE_SESSION.id, dept: DEPT1, shelfLocationId: 10, maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', slKiemDem: 2 },
      { id: 2, sessionId: THONG_KE_SESSION.id, dept: DEPT1, shelfLocationId: 11, maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', slKiemDem: 3 },
      { id: 3, sessionId: THONG_KE_SESSION.id, dept: DEPT1, shelfLocationId: 12, maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', slKiemDem: 4 },
      { id: 4, sessionId: THONG_KE_SESSION.id, dept: DEPT1, shelfLocationId: 10, maHang: 'SP002', maVach: '8934000000002', tenHang: 'Mì Hảo Hảo Tôm Chua Cay', slKiemDem: 120 },
      { id: 5, sessionId: THONG_KE_Q3.id, dept: DEPT1, shelfLocationId: 10, maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', slKiemDem: 40 },
      { id: 6, sessionId: THONG_KE_Q2.id, dept: DEPT1, shelfLocationId: 10, maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', slKiemDem: 35 }
    ]
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 },
    { maHang: 'SP002', maVach: '8934000000002', tenHang: 'Mì Hảo Hảo Tôm Chua Cay', soLuongTon: 125 }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('Mock chỉ hỗ trợ patch-mode')) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  let n = 0;
  const shot = async (label) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
    console.log(`📸 ${file}`);
  };

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    // 1) Tab Kiểm Đếm — click vào ô "Quầy Kệ" để MỞ gợi ý tìm-kiếm-gõ-chọn (chứng minh đã là sdd*, không
    // còn <select> tĩnh) rồi gõ 1 phần để lọc.
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(200);
    await page.click('#kkKiemDemShelfInput');
    await page.waitForTimeout(150);
    await shot('tab3-quay-ke-dropdown-tim-kiem-mo-san');
    await page.fill('#kkKiemDemShelfInput', 'A1');
    await page.waitForTimeout(200);
    await shot('tab3-go-A1-loc-dung-1-goi-y');
    await page.fill('#kkKiemDemShelfInput', `${DEPT1} — A1 — Kệ A1 — Gia vị`);
    await page.waitForTimeout(250);

    // 2) Cột "Trùng Mã" — SP001 rải rác 3 kệ (2+3+4=9) phải hiện "3 dòng • Tổng 9" ở A1.
    await shot('tab3-cot-trung-ma-SP001-rai-rac-3-ke');
    await page.fill('#kkKiemDemShelfInput', `${DEPT1} — A2 — Kệ A2 — Mì, cháo`);
    await page.waitForTimeout(250);
    await shot('tab3-doi-sang-A2-van-dung-3-dong-tong-9');

    // 3) Tab 7 Báo Cáo — ô "Kỳ" chính giờ cũng searchable.
    await page.click('#btnKkSubReport');
    await page.waitForTimeout(300);
    await shot('tab7-bao-cao-ky-chinh-searchable');

    // 4) "So Sánh Với Kỳ Khác" — mở rộng N-WAY: thêm 2 kỳ cùng lúc (dạng chip, không còn 1 lựa chọn đơn).
    await page.fill('#kkReportCompareMultiSelect [data-pms-search]', 'Kiểm Kê Q3/2026');
    await page.waitForTimeout(150);
    await page.click('#kkReportCompareMultiSelect [data-pms-dropdown] > div:first-child');
    await page.waitForTimeout(200);
    await shot('tab7-so-sanh-them-ky-thu-1-dang-chip');
    await page.fill('#kkReportCompareMultiSelect [data-pms-search]', 'Kiểm Kê Q2/2026');
    await page.waitForTimeout(150);
    await page.click('#kkReportCompareMultiSelect [data-pms-dropdown] > div:first-child');
    await page.waitForTimeout(300);
    await shot('tab7-so-sanh-N-way-2-ky-cung-luc-bieu-do-N-mau');

    console.log(jsErrors.length ? `⚠️  Có ${jsErrors.length} lỗi JS:\n${jsErrors.join('\n')}` : '✅ Không có lỗi JS/console nào phát sinh.');
    console.log(`\n✅ Đã chụp ${n} ảnh demo tại ${OUT_DIR}`);
  } finally {
    await browser.close();
    await server.close();
  }
})();
