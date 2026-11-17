// tests/demo-stocktake-inventory-tab.js — DEMO ảnh thật tab MỚI "📦 Tồn Kho" (11/2026, Kiểm Kê — theo
// yêu cầu TRỰC TIẾP người dùng: "cho tôi một tab tồn kho để tôi kiểm tra được từng siêu thị hoặc nhiều
// siêu thị"). SIẾT LẠI (sau khi xem demo bản đầu, người dùng phản hồi TRỰC TIẾP: "cái tab tồn kho ấy thì
// chỉ có admin mới xem mà thôi... có người được phân quyền mới vào được với cả admin, thì bạn phải thêm
// một cái quyền phẳng nữa"): nay CHỈ admin + người được gán quyền MỚI "kiemKeInventoryView" mới thấy/vào
// được tab này — nhân viên thường KHÔNG thấy tab, nhưng VẪN được tự động pre-warm cache tồn kho đúng
// siêu thị mình (không qua tab này) nên Gom Mã/Kiểm Đếm/Kiểm Soát offline vẫn hoạt động bình thường.
// Luồng: nhân viên THƯỜNG (không thấy tab "📦 Tồn Kho" chút nào) -> người ĐƯỢC GÁN quyền xem (thấy đúng
// siêu thị hồ sơ + siêu thị allowlist) -> Admin (xem TẤT CẢ, chọn nhiều siêu thị cùng lúc) -> MẤT MẠNG
// (vẫn hiện cache lần xem gần nhất, có banner 🔌 Ngoại tuyến).
// Chạy: node tests/demo-stocktake-inventory-tab.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8994;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'stocktake-inventory-tab');
const DEPT1 = 'Siêu thị Quận 1';
const DEPT2 = 'Siêu thị Quận 2';
const DEPT3 = 'Siêu thị Quận 3';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const NV1 = { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, perms: { kiemKeKiemDemDo: true }, active: true, totpEnabled: true };
  // INV_VIEWER: được GÁN RIÊNG quyền "📦 Tab Tồn Kho" (kiemKeInventoryView) + allowlist Kiểm Đếm thêm ở
  // DEPT2 (kiểu Giám Sát Vùng) — KHÔNG phải admin, KHÔNG có kiemKeReportView.
  const INV_VIEWER = { username: 'qsA', name: 'Giám Sát Vùng A (được gán xem Tồn Kho)', dept: DEPT1, perms: { kiemKeKiemDemDo: true, kiemKeInventoryView: true }, active: true, totpEnabled: true };
  const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };

  const state = createMockState({
    depts: [DEPT1, DEPT2, DEPT3], stores: [DEPT1, DEPT2, DEPT3], users: [NV1, INV_VIEWER, ADMIN],
    shelfLocations: [{ id: 60, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true }],
    stocktakeUserAccess: [
      // qsA: ngoài siêu thị hồ sơ (DEPT1), còn được gán allowlist Kiểm Đếm ở DEPT2 -> xem được cả 2.
      { id: 1, username: 'qsA', dept: DEPT2, shelfLocationId: 60, canGomMa: false, canKiemDem: true, canKiemSoat: false }
    ]
  });
  state.storeExternalCodes = { [DEPT1]: '001', [DEPT2]: '002' }; // DEPT3 CHƯA cấu hình Mã Điểm
  // Pre-warm (ensureShelfSystemInventoryCacheLoaded(), chạy UNCONDITIONAL cho MỌI người vào module) gọi
  // route KHÁC (GET /api/shelf-stock/system-inventory) — seed riêng để chứng minh nv1 (không có quyền
  // xem tab) vẫn pre-warm được bình thường.
  state.__mockSystemInventoryRows = [{ maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 120 }];
  state.__mockKkInventoryByDept = {
    [DEPT1]: {
      rows: [
        { maHang: 'SP001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 120 },
        { maHang: 'SP002', tenHang: 'Mì Hảo Hảo Tôm Chua Cay', soLuongTon: 340 },
        { maHang: 'SP003', tenHang: 'Sữa Tươi Vinamilk 1L', soLuongTon: 76 }
      ],
      fetchedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString()
    },
    [DEPT2]: { rows: [], fetchedAt: null } // CHƯA đồng bộ lần nào -> cảnh báo rõ trên demo
  };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  const goOffline = () => page.evaluate(() => { window.__origFetch = window.fetch; window.fetch = () => { throw new TypeError('Failed to fetch'); }; });
  const goOnline = () => page.evaluate(() => { if (window.__origFetch) { window.fetch = window.__origFetch; delete window.__origFetch; } });

  let n = 0;
  const shot = async (label) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
    console.log(`📸 ${file}`);
  };

  try {
    // ===== Nhân viên THƯỜNG (không có kiemKeInventoryView): KHÔNG thấy tab "📦 Tồn Kho" chút nào =====
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, NV1);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(300);
    await shot('nv1-khong-thay-tab-ton-kho');

    // ===== Người ĐƯỢC GÁN quyền xem Tồn Kho (kiemKeInventoryView, không phải admin): thấy đúng siêu thị
    //       hồ sơ (DEPT1) + siêu thị allowlist (DEPT2, CHƯA đồng bộ) =====
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, INV_VIEWER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await page.click('#btnKkSubInventory');
    await page.waitForTimeout(300);
    await shot('duoc-gan-quyen-xem-2-sieu-thi-canh-bao-chua-dong-bo');

    // ===== Admin: xem TẤT CẢ (DEPT3 không cấu hình Mã Điểm -> tự loại, không báo lỗi) =====
    // Xoá lựa chọn cũ trên CÙNG ô chọn (demo giả lập đổi người dùng KHÔNG tải lại trang, khác 1 phiên
    // trình duyệt thật luôn tải lại trang khi đổi tài khoản — chỉ cần dọn tay để đúng mặc định "chưa
    // chọn gì -> hiện TẤT CẢ siêu thị xem được" của người dùng MỚI).
    await page.evaluate(() => { if (typeof gmsClear === 'function') gmsClear('kkInventoryStoreMultiSelect'); });
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await page.click('#btnKkSubInventory');
    await page.waitForTimeout(300);
    await shot('admin-xem-tat-ca-sieu-thi');

    // Bỏ chọn DEPT2, chỉ còn DEPT1 — minh hoạ ô tìm-kiếm-đa-chọn hoạt động đúng.
    await page.evaluate(() => {
      const c = document.getElementById('kkInventoryStoreMultiSelect');
      if (c && c._gmsSelected) { c._gmsSelected.delete('Siêu thị Quận 2'); c._gmsRenderChips(); }
    });
    await page.waitForTimeout(200);
    await shot('admin-loc-con-1-sieu-thi');

    // ===== MẤT MẠNG — vẫn hiện số liệu lần xem gần nhất, có banner 🔌 Ngoại tuyến =====
    await goOffline();
    await page.evaluate(() => switchTab('kiemKe'));
    await page.click('#btnKkSubInventory');
    await page.waitForTimeout(300);
    await shot('admin-offline-van-hien-cache-cu');
    await goOnline();

    console.log(jsErrors.length ? `⚠️  Có ${jsErrors.length} lỗi JS:\n${jsErrors.join('\n')}` : '✅ Không có lỗi JS/console nào phát sinh.');
    console.log(`\n✅ Đã chụp ${n} ảnh demo tại ${OUT_DIR}`);
  } finally {
    await browser.close();
    await server.close();
  }
})();
