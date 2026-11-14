// tests/demo-kiemke-full-8-tabs.js — demo Playwright THẬT cho TOÀN BỘ module "📋 Kiểm Kê" (11/2026, đã
// hoàn tất đủ 8/8 tab sau đợt audit chéo 3 agent độc lập: nghiệp vụ/UI-CSP/bảo mật). Thay thế các ảnh
// "...-dang-phat-trien.png" cũ (demo-kiemke-all-screens.js, từ lúc Phase 1 MVP chỉ có Tab 1) bằng ảnh
// THẬT của từng tab đang hoạt động, cùng 1 bộ dữ liệu nhất quán xuyên suốt.
// Chạy: node tests/demo-kiemke-full-8-tabs.js — ảnh lưu ở demo-screenshots/kiemke-full-8-tabs/.
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8991;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'kiemke-full-8-tabs');
const DEPT1 = 'Siêu thị Quận 1';
const DEPT2 = 'Siêu thị Quận 2';
const SHELF_A1 = { id: 70, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị, Đồ khô', category: 'Gia vị', active: true };
const SHELF_A2 = { id: 71, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, Cháo gói', category: 'Mì', active: true };

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // MANAGER: đủ 7/8 quyền Kiểm Kê (trừ kiemKeUserAccessManage, xem riêng ở ADMIN) — đúng vai "Quản Lý
  // Siêu Thị" thực tế vận hành hằng ngày toàn bộ module.
  const MANAGER = {
    username: 'qlA', name: 'Quản Lý Siêu Thị', dept: DEPT1,
    perms: {
      kiemKePeriodManage: true, kiemKeGomMaDo: true, kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true,
      kiemKeShelfConfigManage: true, kiemKeConfirmDo: true, kiemKeReportView: true, shelfLocationManage: true
    },
    active: true, totpEnabled: true
  };
  const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };
  const GOMMA_SESSION = { id: 9301, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Quý 4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONGKE_SESSION = { id: 9302, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Quý 4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONGKE_DEPT2 = { id: 9303, dept: DEPT2, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Quý 4/2026 — Q2', trangThai: 'DA_CHOT' };

  const state = createMockState({
    depts: [DEPT1, DEPT2], stores: [DEPT1, DEPT2], users: [MANAGER, ADMIN],
    shelfLocations: [SHELF_A1, SHELF_A2],
    stocktakeSessions: [GOMMA_SESSION, THONGKE_SESSION, THONGKE_DEPT2],
    stocktakeUserAccess: [
      { id: 1, username: 'qlA', dept: DEPT1, shelfLocationId: SHELF_A1.id, canGomMa: true, canKiemDem: true, canKiemSoat: true },
      { id: 2, username: 'qlA', dept: DEPT1, shelfLocationId: SHELF_A2.id, canGomMa: true, canKiemDem: true, canKiemSoat: true }
    ],
    stocktakeCounts: [
      { id: 1, sessionId: GOMMA_SESSION.id, dept: DEPT1, shelfLocationId: SHELF_A1.id, maHang: 'SP001', tenHang: 'G7 Cà Phê 3in1', slGomMa: 46 },
      { id: 2, sessionId: THONGKE_SESSION.id, dept: DEPT1, shelfLocationId: SHELF_A1.id, maHang: 'SP001', tenHang: 'G7 Cà Phê 3in1', slKiemDem: 48 },
      { id: 3, sessionId: THONGKE_SESSION.id, dept: DEPT1, shelfLocationId: SHELF_A1.id, maHang: 'SP002', tenHang: 'Mì Hảo Hảo Tôm Chua Cay', slKiemDem: 120, slKiemSoat: 108 },
      { id: 4, sessionId: THONGKE_SESSION.id, dept: DEPT1, shelfLocationId: SHELF_A2.id, maHang: 'SP003', tenHang: 'Sữa Tươi Vinamilk 1L', slKiemDem: 76 },
      { id: 5, sessionId: THONGKE_DEPT2.id, dept: DEPT2, shelfLocationId: SHELF_A2.id, maHang: 'SP003', tenHang: 'Sữa Tươi Vinamilk 1L', slKiemDem: 60 }
    ],
    // A1 ĐÃ Xác Nhận ở kỳ Thống Kê — dùng để demo luôn fix mới (khoá Tab 3 ngay lúc chọn, KHÔNG khoá Tab 4).
    stocktakeShelfConfirmations: [
      { id: 1, sessionId: THONGKE_SESSION.id, shelfLocationId: SHELF_A1.id, dept: DEPT1, shelfLocationLabel: 'A1 — Kệ A1 — Gia vị, Đồ khô', confirmedBy: 'qlA', confirmedByName: 'Quản Lý Siêu Thị', confirmedAt: new Date().toISOString() }
    ]
  });
  state.storeExternalCodes = { [DEPT1]: '001', [DEPT2]: '002' };
  state.__mockStocktakeReportInventoryByDept = {
    [DEPT1]: [
      { maHang: 'SP001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 },
      { maHang: 'SP002', tenHang: 'Mì Hảo Hảo Tôm Chua Cay', soLuongTon: 108 },
      { maHang: 'SP003', tenHang: 'Sữa Tươi Vinamilk 1L', soLuongTon: 76 }
    ],
    [DEPT2]: [{ maHang: 'SP003', tenHang: 'Sữa Tươi Vinamilk 1L', soLuongTon: 65 }]
  };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const jsErrors = [];
  const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chưa hỗ trợ route: POST /api/data/users';
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes(KNOWN_HARNESS_NOISE)) jsErrors.push('[console] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  let n = 0;
  const shot = async (label) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
    console.log(`📸 ${file}`);
  };
  const gotoStocktake = async () => {
    await page.evaluate(() => switchTab('vanHanh'));
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(150);
  };

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
    await gotoStocktake();

    // Tab 1 "📅 Kỳ Kiểm Kê"
    await page.click('#btnKkSubPeriod');
    await page.waitForTimeout(250);
    await shot('tab1-ky-kiem-ke');

    // Tab 2 "📷 Gom Mã"
    await page.click('#btnKkSubGomMa');
    await page.waitForTimeout(150);
    await page.selectOption('#kkGomMaShelfSelect', String(SHELF_A1.id));
    await page.waitForTimeout(250);
    await shot('tab2-gom-ma');

    // Tab 3 "🔢 Kiểm Đếm" — chọn quầy kệ A2 (CHƯA xác nhận, quét bình thường)
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(150);
    await page.selectOption('#kkKiemDemShelfSelect', String(SHELF_A2.id));
    await page.waitForTimeout(250);
    await shot('tab3-kiem-dem-quay-ke-chua-xac-nhan');

    // Tab 3 — chọn quầy kệ A1 (ĐÃ Xác Nhận) -> demo đúng fix mới: khoá NGAY, không đợi submit.
    await page.selectOption('#kkKiemDemShelfSelect', String(SHELF_A1.id));
    await page.waitForTimeout(250);
    await shot('tab3-kiem-dem-quay-ke-da-xac-nhan-khoa-ngay');

    // Tab 4 "🛡️ Kiểm Soát" — CÙNG quầy kệ A1 (đã Xác Nhận ở Tab 3/Kiểm Đếm) VẪN thao tác được bình thường.
    await page.click('#btnKkSubKiemSoat');
    await page.waitForTimeout(150);
    await page.selectOption('#kkKiemSoatShelfSelect', String(SHELF_A1.id));
    await page.waitForTimeout(250);
    await shot('tab4-kiem-soat-khong-bi-khoa-lay');

    // Tab 5 "🗄️ Cấu Hình Quầy Kệ"
    await page.click('#btnKkSubShelfConfig');
    await page.waitForTimeout(250);
    await shot('tab5-cau-hinh-quay-ke');

    // Tab 6 "✅ Xác Nhận"
    await page.click('#btnKkSubConfirm');
    await page.waitForTimeout(300);
    await shot('tab6-xac-nhan');

    // Tab 7 "📊 Báo Cáo" — kỳ Thống Kê giờ CHỈ so Tồn Kho Hệ Thống/Kiểm Đếm/Kiểm Soát của CHÍNH nó (không
    // trộn Gom Mã của kỳ khác vào — SỬA 11/2026 theo phản hồi người dùng).
    await page.click('#btnKkSubReport');
    await page.waitForTimeout(200);
    await page.selectOption('#kkReportSessionSelect', String(THONGKE_SESSION.id));
    await page.waitForTimeout(300);
    await shot('tab7-bao-cao-quan-ly');

    // Bật "So Sánh Với Kỳ Khác" (TÍNH NĂNG MỚI) -> so sánh kỳ Thống Kê đang xem với kỳ Gom Mã riêng.
    await page.selectOption('#kkReportCompareSelect', String(GOMMA_SESSION.id));
    await page.waitForTimeout(300);
    await shot('tab7-bao-cao-so-sanh-voi-ky-khac');

    // Chuyển sang Admin — xem Tab 8 "🔑 Cấu Hình Người Dùng" (MANAGER không có kiemKeUserAccessManage,
    // đúng vai thực tế: chỉ Admin/người được cấp riêng quyền này mới quản lý allowlist) + Tab 7 Báo Cáo
    // thấy thêm "So Sánh Giữa Các Siêu Thị" (Phase 1: chỉ Admin xem chéo siêu thị).
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await gotoStocktake();
    await page.click('#btnKkSubUserAccess');
    await page.waitForTimeout(300);
    await shot('tab8-cau-hinh-nguoi-dung');

    await page.click('#btnKkSubReport');
    await page.waitForTimeout(200);
    await page.selectOption('#kkReportSessionSelect', String(THONGKE_SESSION.id));
    await page.waitForTimeout(300);
    await shot('tab7-bao-cao-admin-so-sanh-sieu-thi');

    console.log(jsErrors.length ? `\n⚠️  Có ${jsErrors.length} lỗi JS:\n${jsErrors.join('\n')}` : '\n✅ Không có lỗi JS/console nào phát sinh.');
    console.log(`\n✅ Đã chụp ${n} ảnh demo đủ 8/8 tab tại ${OUT_DIR}`);
    process.exitCode = jsErrors.length ? 1 : 0;
  } finally {
    await browser.close();
    await server.close();
  }
})();
