// tests/demo-kiemke-promote-top-level.js — DEMO ảnh thật cho việc PROMOTE "📋 Kiểm Kê" thành module
// chính riêng ở sidebar (12/2026, theo yêu cầu TRỰC TIẾP của người dùng: "Tôi muốn chuyển kiểm kê thành
// module chình ở slide bar như vận hành, mua hàng có được không?"). Trước đó Kiểm Kê sống như 1 sub-tab
// BÊN TRONG "⚙️ Vận Hành" — giờ có mục riêng NGANG HÀNG "⚙️ Vận Hành"/"🔗 Mua Hàng" trên sidebar.
// Chạy: node server/tests/demo-kiemke-promote-top-level.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8991;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'kiemke-promote-top-level');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const DEPT1 = 'Siêu thị Quận 1';
  // Admin — xem đủ sidebar để so sánh vị trí Kiểm Kê với Vận Hành/Mua Hàng.
  const ADMIN = { username: 'admin', name: 'Admin Hệ Thống', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };
  // Nhân viên CHỈ có 1 quyền Kiểm Kê (kiemKeGomMaDo), KHÔNG có BẤT KỲ quyền Vận Hành nào khác — minh hoạ
  // module đã ĐỘC LẬP hoàn toàn, không còn cần "mở được tab Vận Hành" mới vào được Kiểm Kê như trước.
  const KIEMKE_ONLY = {
    username: 'nv1', name: 'Nhân Viên Gom Mã', dept: DEPT1,
    perms: { kiemKeGomMaDo: true }, active: true, totpEnabled: true
  };
  const GOM_MA_SESSION = { id: 9401, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Tuần 46/2026', trangThai: 'DANG_HOAT_DONG' };

  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [ADMIN, KIEMKE_ONLY],
    stocktakeSessions: [GOM_MA_SESSION]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1400, height: 1000 });
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('404')) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    // ===== 1) Admin: sidebar mặc định — "📋 Kiểm Kê" là mục RIÊNG, ngay dưới "⚙️ Vận Hành ▾"/trên
    // "🔗 Mua Hàng ▾", KHÔNG còn là dropdown item của Vận Hành nữa. =====
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, '1-sidebar-admin-kiemke-module-rieng.png'), fullPage: true });
    console.log('Đã chụp: 1-sidebar-admin-kiemke-module-rieng.png');

    // ===== 2) Mở dropdown "⚙️ Vận Hành ▾" — xác nhận "📋 Kiểm Kê" KHÔNG còn trong danh sách shortcut này. =====
    await page.click('#btnVanHanhTab');
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT_DIR, '2-dropdown-van-hanh-khong-con-kiem-ke.png'), fullPage: true });
    console.log('Đã chụp: 2-dropdown-van-hanh-khong-con-kiem-ke.png');
    await page.evaluate(() => closeVanHanhDropdown());

    // ===== 3) Bấm thẳng "📋 Kiểm Kê" trên sidebar -> vào thẳng module, tab con "📅 Kỳ Kiểm Kê". =====
    await page.click('#btnKiemKeTab');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT_DIR, '3-bam-thang-kiem-ke-vao-thang-module.png'), fullPage: true });
    console.log('Đã chụp: 3-bam-thang-kiem-ke-vao-thang-module.png');

    // ===== 4) Nhân viên CHỈ có 1 quyền Kiểm Kê (kiemKeGomMaDo), KHÔNG có quyền Vận Hành nào — sidebar
    // CHỈ hiện mục "📋 Kiểm Kê" (Vận Hành/Mua Hàng tự ẩn vì không có quyền) -> bấm vào vẫn vào thẳng
    // được Tab 2 "Gom Mã" (đã tự rơi về tab duy nhất họ có quyền). =====
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, KIEMKE_ONLY);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, '4-sidebar-nhan-vien-chi-co-1-quyen-kiem-ke.png'), fullPage: true });
    console.log('Đã chụp: 4-sidebar-nhan-vien-chi-co-1-quyen-kiem-ke.png');
    await page.click('#btnKiemKeTab');
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT_DIR, '5-nhan-vien-vao-thang-tab-gom-ma.png'), fullPage: true });
    console.log('Đã chụp: 5-nhan-vien-vao-thang-tab-gom-ma.png');

    console.log(jsErrors.length ? `⚠️ Có lỗi JS: ${jsErrors.join(' | ')}` : '✅ Không có lỗi JS/console nào phát sinh.');
    console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
