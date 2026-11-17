// tests/demo-stocktake-inventory-tab.js — DEMO ảnh thật tab MỚI "📦 Tồn Kho" (11/2026, Kiểm Kê — theo
// yêu cầu TRỰC TIẾP người dùng: "cho tôi một tab tồn kho để tôi kiểm tra được từng siêu thị hoặc nhiều
// siêu thị"). Luồng: nhân viên thường (chỉ xem đúng siêu thị hồ sơ) -> Giám Sát Vùng (xem thêm siêu thị
// allowlist) -> Admin (xem TẤT CẢ, chọn nhiều siêu thị cùng lúc) -> MẤT MẠNG (vẫn hiện cache lần xem gần
// nhất, có banner 🔌 Ngoại tuyến).
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
  const QS_VUNG = { username: 'qsA', name: 'Giám Sát Vùng A', dept: DEPT1, perms: { kiemKeKiemDemDo: true }, active: true, totpEnabled: true };
  const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };

  const state = createMockState({
    depts: [DEPT1, DEPT2, DEPT3], stores: [DEPT1, DEPT2, DEPT3], users: [NV1, QS_VUNG, ADMIN],
    shelfLocations: [{ id: 60, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true }],
    stocktakeUserAccess: [
      // Giám Sát Vùng: ngoài siêu thị hồ sơ (DEPT1), còn được gán allowlist Kiểm Đếm ở DEPT2 -> xem được cả 2.
      { id: 1, username: 'qsA', dept: DEPT2, shelfLocationId: 60, canGomMa: false, canKiemDem: true, canKiemSoat: false }
    ]
  });
  state.storeExternalCodes = { [DEPT1]: '001', [DEPT2]: '002' }; // DEPT3 CHƯA cấu hình Mã Điểm
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
    // ===== Nhân viên thường: chỉ xem đúng siêu thị hồ sơ (DEPT1) =====
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, NV1);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await page.click('#btnKkSubInventory');
    await page.waitForTimeout(300);
    await shot('nv1-chi-xem-sieu-thi-ho-so');

    // ===== Giám Sát Vùng: xem thêm siêu thị allowlist (DEPT2, CHƯA đồng bộ) =====
    // Xoá lựa chọn cũ của nv1 trên CÙNG ô chọn (12/2026 — test giả lập đổi người dùng KHÔNG tải lại
    // trang như demo khác, nhưng tab "📦 Tồn Kho" CỐ Ý nhớ lựa chọn cũ nếu vẫn hợp lệ — ô chọn còn sót
    // lựa chọn của nv1 sẽ KHÔNG tự thêm DEPT2 mới xuất hiện; 1 phiên trình duyệt thật đổi người dùng
    // luôn tải lại trang nên không gặp tình huống này, ở đây chỉ cần dọn tay để demo đúng mặc định
    // "chưa chọn gì -> hiện TẤT CẢ siêu thị xem được" của người dùng MỚI).
    await page.evaluate(() => { if (typeof gmsClear === 'function') gmsClear('kkInventoryStoreMultiSelect'); });
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, QS_VUNG);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await page.click('#btnKkSubInventory');
    await page.waitForTimeout(300);
    await shot('qsvung-xem-ca-2-sieu-thi-canh-bao-chua-dong-bo');

    // ===== Admin: xem TẤT CẢ (DEPT3 không cấu hình Mã Điểm -> tự loại, không báo lỗi) =====
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
