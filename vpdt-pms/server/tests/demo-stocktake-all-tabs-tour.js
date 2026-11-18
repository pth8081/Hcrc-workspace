// tests/demo-stocktake-all-tabs-tour.js — DEMO ảnh thật "đi 1 vòng" TOÀN BỘ 9 tab của module 📋 Kiểm Kê
// (theo yêu cầu người dùng: "gửi lại tất cả các màn hình kiểm kê"), tài khoản Admin (thấy đủ mọi tab):
//   01 Kỳ Kiểm Kê · 02 Tồn Kho · 03 Gom Mã · 04 Kiểm Đếm · 05 Kiểm Soát · 06 Cấu Hình Quầy Kệ ·
//   07 Xác Nhận · 08 Báo Cáo · 09 Cấu Hình Người Dùng
// Dữ liệu mẫu dựng sẵn (2 siêu thị, quầy kệ, kỳ Gom Mã + kỳ Kiểm Kê đang hoạt động, vài mã hàng đã quét)
// để mỗi tab hiện ĐÚNG giao diện thật đang dùng, không phải màn hình trống.
// Chạy: node tests/demo-stocktake-all-tabs-tour.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8995;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'stocktake-all-tabs-tour');
const DEPT1 = 'Siêu thị Quận 1';
const DEPT2 = 'Siêu thị Quận 2';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };

  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', active: true };
  const SHELF_B1 = { id: 12, dept: DEPT2, code: 'B1', name: 'Kệ B1 — Sữa & nước giải khát', active: true };

  const GOM_MA_SESSION = { id: 9101, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONG_KE_SESSION = { id: 9102, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONG_KE_DEPT2 = { id: 9103, dept: DEPT2, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026 — Q2', trangThai: 'DA_CHOT' };

  const state = createMockState({
    depts: [DEPT1, DEPT2], stores: [DEPT1, DEPT2], users: [ADMIN],
    kiemKeShelfLocations: [SHELF_A1, SHELF_A2, SHELF_B1],
    stocktakeSessions: [GOM_MA_SESSION, THONG_KE_SESSION, THONG_KE_DEPT2],
    // Allowlist TUYỆT ĐỐI (kể cả Admin) — Tab 8 "Danh Sách Đã Gán" cũng hiện luôn các dòng này.
    stocktakeUserAccess: [
      { id: 1, username: 'admin', dept: DEPT1, shelfLocationId: 10, canGomMa: true, canKiemDem: true, canKiemSoat: true },
      { id: 2, username: 'admin', dept: DEPT1, shelfLocationId: 11, canGomMa: true, canKiemDem: true, canKiemSoat: true },
      { id: 3, username: 'admin', dept: DEPT2, shelfLocationId: 12, canGomMa: true, canKiemDem: true, canKiemSoat: true }
    ],
    // maVach (MỚI, 11/2026, theo yêu cầu người dùng: "ở tất cả các tab của kiểm kê thì phải riêng phần
    // mã thì có hai mã nhé, là mã vạch và mã nội bộ") — seed kèm mã vạch để demo đúng cột mới ở mọi tab.
    stocktakeCounts: [
      { id: 1, sessionId: GOM_MA_SESSION.id, dept: DEPT1, shelfLocationId: 10, maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', slGomMa: 46 },
      { id: 2, sessionId: GOM_MA_SESSION.id, dept: DEPT1, shelfLocationId: 10, maHang: 'SP002', maVach: '8934000000002', tenHang: 'Mì Hảo Hảo Tôm Chua Cay', slGomMa: 118 },
      { id: 3, sessionId: THONG_KE_SESSION.id, dept: DEPT1, shelfLocationId: 10, maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', slKiemDem: 48, slKiemSoat: 48 },
      { id: 4, sessionId: THONG_KE_SESSION.id, dept: DEPT1, shelfLocationId: 10, maHang: 'SP002', maVach: '8934000000002', tenHang: 'Mì Hảo Hảo Tôm Chua Cay', slKiemDem: 120, slKiemSoat: 108 },
      { id: 5, sessionId: THONG_KE_SESSION.id, dept: DEPT1, shelfLocationId: 11, maHang: 'SP003', maVach: '8934000000003', tenHang: 'Sữa Tươi Vinamilk 1L', slKiemDem: 76 },
      { id: 6, sessionId: THONG_KE_DEPT2.id, dept: DEPT2, shelfLocationId: 12, maHang: 'SP003', maVach: '8934000000003', tenHang: 'Sữa Tươi Vinamilk 1L', slKiemDem: 60 }
    ],
    // Xác Nhận SẴN quầy kệ A1 (Kiểm Đếm + Kiểm Soát) — Tab 6 hiện CẢ dòng ✅ đã xác nhận LẪN dòng ⏳ chưa
    // (A2 chưa xác nhận), đúng cảnh thật đang dùng dở, không phải toàn bộ trống hay toàn bộ xong.
    stocktakeShelfConfirmations: [{ id: 1, sessionId: THONG_KE_SESSION.id, dept: DEPT1, shelfLocationId: 10, confirmedBy: 'admin', confirmedByName: 'Admin', confirmedAt: new Date().toISOString() }],
    stocktakeShelfKiemSoatConfirmations: [{ id: 1, sessionId: THONG_KE_SESSION.id, dept: DEPT1, shelfLocationId: 10, confirmedBy: 'admin', confirmedByName: 'Admin', confirmedAt: new Date().toISOString() }],
    stocktakeShelfGomMaConfirmations: []
  });
  state.storeExternalCodes = { [DEPT1]: '001', [DEPT2]: '002' };
  // Pre-warm + Gom Mã/Kiểm Đếm/Kiểm Soát khớp mã (GET /api/shelf-stock/system-inventory, scope đúng dept
  // hiện tại của Admin = DEPT1).
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 },
    { maHang: 'SP002', maVach: '8934000000002', tenHang: 'Mì Hảo Hảo Tôm Chua Cay', soLuongTon: 125 }
  ];
  // Tab "📦 Tồn Kho" (GET /api/stocktake/system-inventory) — DEPT1 đã đồng bộ, DEPT2 CHƯA (minh hoạ đúng
  // 2 trạng thái khác nhau, giống bản demo đã được xác nhận trước đó).
  state.__mockKkInventoryByDept = {
    [DEPT1]: {
      rows: [
        { maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 },
        { maHang: 'SP002', maVach: '8934000000002', tenHang: 'Mì Hảo Hảo Tôm Chua Cay', soLuongTon: 125 }
      ],
      fetchedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString()
    },
    [DEPT2]: { rows: [], fetchedAt: null }
  };
  // Tab "📊 Báo Cáo" (GET /api/stocktake/report) — tồn kho hệ thống để tính "Giá Trị Thừa/Thiếu".
  state.__mockStocktakeReportInventoryByDept = {
    [DEPT1]: [
      { maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 },
      { maHang: 'SP002', maVach: '8934000000002', tenHang: 'Mì Hảo Hảo Tôm Chua Cay', soLuongTon: 108 },
      { maHang: 'SP003', maVach: '8934000000003', tenHang: 'Sữa Tươi Vinamilk 1L', soLuongTon: 76 }
    ],
    [DEPT2]: [{ maHang: 'SP003', maVach: '8934000000003', tenHang: 'Sữa Tươi Vinamilk 1L', soLuongTon: 65 }]
  };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
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

    await page.click('#btnKkSubPeriod');
    await page.waitForTimeout(250);
    await shot('tab1-ky-kiem-ke');

    await page.click('#btnKkSubInventory');
    await page.waitForTimeout(300);
    await shot('tab2-ton-kho');

    const SHELF_A1_LABEL = `${SHELF_A1.dept} — ${SHELF_A1.code} — ${SHELF_A1.name}`;
    await page.click('#btnKkSubGomMa');
    await page.waitForTimeout(200);
    await page.fill('#kkGomMaShelfInput', SHELF_A1_LABEL);
    await page.waitForTimeout(250);
    await shot('tab3-gom-ma');

    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(200);
    await page.fill('#kkKiemDemShelfInput', SHELF_A1_LABEL);
    await page.waitForTimeout(250);
    await shot('tab4-kiem-dem');

    await page.click('#btnKkSubKiemSoat');
    await page.waitForTimeout(200);
    await page.fill('#kkKiemSoatShelfInput', SHELF_A1_LABEL);
    await page.waitForTimeout(250);
    await shot('tab5-kiem-soat');

    await page.click('#btnKkSubShelfConfig');
    await page.waitForTimeout(250);
    await shot('tab6-cau-hinh-quay-ke');

    await page.click('#btnKkSubConfirm');
    await page.waitForTimeout(300);
    await shot('tab7-xac-nhan');

    await page.click('#btnKkSubReport');
    await page.waitForTimeout(350);
    await shot('tab8-bao-cao');

    await page.click('#btnKkSubUserAccess');
    await page.waitForTimeout(250);
    await shot('tab9-cau-hinh-nguoi-dung');

    console.log(jsErrors.length ? `⚠️  Có ${jsErrors.length} lỗi JS:\n${jsErrors.join('\n')}` : '✅ Không có lỗi JS/console nào phát sinh.');
    console.log(`\n✅ Đã chụp ${n} ảnh demo tại ${OUT_DIR}`);
  } finally {
    await browser.close();
    await server.close();
  }
})();
