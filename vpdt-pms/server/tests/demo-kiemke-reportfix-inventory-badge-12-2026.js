// tests/demo-kiemke-reportfix-inventory-badge-12-2026.js — DEMO ảnh thật cho 3 việc vừa sửa (12/2026),
// theo phản hồi TRỰC TIẾP người dùng kèm ảnh chụp:
// 1) Tab 7 "📊 Báo Cáo": ô "Siêu thị" ĐỘC LẬP với Tab 1 (trước đây lấy theo kkPeriodDeptSelected, admin
//    chưa đổi gì ở Tab 1 thì rơi về dept hồ sơ "Quản trị" -> Báo Cáo trống trơn) — nay admin/người có
//    kiemKeReportView thấy multi-select TẤT CẢ siêu thị, mặc định chọn hết.
// 2) Badge "📍 Bạn đang ở Siêu Thị" — LUÔN hiện trên mọi sub-tab Kiểm Kê, để supervisor xác nhận nhân
//    viên đang ở đúng siêu thị trước khi tin số liệu (giống tinh thần header "📍 Siêu Thị" bên Kiểm Soát
//    Hàng Hóa, nhưng đặt cố định ngoài mọi tab con).
// 3) Tab "📦 Tồn Kho": cache-first — vào lại tab hiện NGAY dữ liệu đã có, không kẹt "Đang tải...".
// Chạy: node tests/demo-kiemke-reportfix-inventory-badge-12-2026.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'kiemke-reportfix-inventory-badge');
const DEPT1 = 'Siêu thị Quận 1';
const DEPT2 = 'Siêu thị Quận 2';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const ADMIN = { username: 'admin', name: 'Admin', dept: 'Quản trị', perms: { admin: true }, active: true, totpEnabled: true };
  const MANAGER = { username: 'qlA', name: 'Quản Lý A', dept: DEPT1, perms: { kiemKeReportView: true, kiemKeInventoryView: true }, active: true, totpEnabled: true };

  const GOMMA_SESSION = { id: 9201, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONGKE_SESSION = { id: 9202, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONGKE_DEPT2_SESSION = { id: 9203, dept: DEPT2, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Q2 — Q4/2026', trangThai: 'DA_CHOT' };

  const state = createMockState({
    depts: ['Quản trị', DEPT1, DEPT2], stores: [DEPT1, DEPT2], users: [ADMIN, MANAGER],
    shelfLocations: [{ id: 60, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true }],
    stocktakeSessions: [GOMMA_SESSION, THONGKE_SESSION, THONGKE_DEPT2_SESSION],
    stocktakeCounts: [
      { id: 1, sessionId: THONGKE_SESSION.id, dept: DEPT1, shelfLocationId: 60, maHang: 'SP001', tenHang: 'Hàng A1', slGomMa: 0, slKiemDem: 48 },
      { id: 2, sessionId: THONGKE_SESSION.id, dept: DEPT1, shelfLocationId: 60, maHang: 'SP002', tenHang: 'Hàng A2', slGomMa: 0, slKiemDem: 120, slKiemSoat: 108 }
    ]
  });
  state.storeExternalCodes = { [DEPT1]: '001', [DEPT2]: '002' };
  state.__mockStocktakeReportInventoryByDept = {
    [DEPT1]: [{ maHang: 'SP001', tenHang: 'Hàng A1', soLuongTon: 50 }, { maHang: 'SP002', tenHang: 'Hàng A2', soLuongTon: 30 }],
    [DEPT2]: [{ maHang: 'SP003', tenHang: 'Hàng B1', soLuongTon: 20 }]
  };
  state.__mockKkInventoryByDept = {
    [DEPT1]: { rows: [{ maHang: 'SP001', tenHang: 'Hàng A1', soLuongTon: 50 }], fetchedAt: new Date().toISOString() },
    [DEPT2]: { rows: [{ maHang: 'SP003', tenHang: 'Hàng B1', soLuongTon: 20 }], fetchedAt: new Date().toISOString() }
  };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 900, height: 1000 });
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('Mock chỉ hỗ trợ patch-mode')) jsErrors.push(msg.text()); });
  page.on('pageerror', (err) => jsErrors.push(String(err)));
  const snap = async (name) => { await page.screenshot({ path: path.join(OUT_DIR, name), fullPage: true }); console.log('📸 ' + name); };

  try {
    // ===== 1) Admin: badge "Bạn đang ở Siêu Thị" + Tab 7 multi-select TẤT CẢ siêu thị =====
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(200);
    await snap('01-admin-badge-dang-o-sieu-thi.png');

    await page.click('#btnKkSubReport');
    await page.waitForTimeout(300);
    await snap('02-admin-bao-cao-multiselect-tat-ca-sieu-thi.png');

    await page.fill('#kkReportSessionInput', '🔢 Kiểm Kê — Thống Kê Q4/2026 (Đang hoạt động)');
    await page.waitForTimeout(300);
    await snap('03-admin-bao-cao-chon-ky-dept1-ok.png');

    // ===== 2) qlA (CHỈ kiemKeReportView, KHÔNG Admin) — VẪN thấy multi-select TẤT CẢ siêu thị (đúng
    // ngữ nghĩa đã dùng ở Tab Tồn Kho: kiemKeReportView bypass mọi siêu thị) =====
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, MANAGER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(200);
    await snap('04-qla-badge-dang-o-sieu-thi.png');

    await page.click('#btnKkSubReport');
    await page.waitForTimeout(300);
    await snap('05-qla-bao-cao-multiselect-ca-2-sieu-thi.png');

    // ===== 3) Tab "📦 Tồn Kho" — dữ liệu hiện đủ, không kẹt "Đang tải..." =====
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(100);
    await page.click('#btnKkSubInventory');
    await page.waitForTimeout(400);
    await snap('06-qla-ton-kho-day-du-khong-ket-dang-tai.png');

    if (jsErrors.length) {
      console.log('⚠️  Có lỗi JS:', jsErrors.join(' | '));
    } else {
      console.log('✅ Không có lỗi JS/console nào phát sinh.');
    }
    console.log(`\n✅ Đã chụp ảnh demo tại ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
