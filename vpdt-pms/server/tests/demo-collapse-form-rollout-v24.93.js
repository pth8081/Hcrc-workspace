// server/tests/demo-collapse-form-rollout-v24.93.js
//
// Demo ảnh cho đợt "thu gọn form nhập" toàn ứng dụng (v24.93) — chỉ chụp vài màn đại diện quan trọng
// nhất theo yêu cầu người dùng, không chụp hết cả 34 form:
//   1. Hợp Đồng (tab Quản Lý HĐ) — trước (đóng, chỉ thấy nút "+") / sau (mở ra khi bấm nút).
//   2. Quản Lý Danh Mục — 21 thẻ dạng accordion, tất cả đóng mặc định.
//   3. Phân Quyền (Thêm/Sửa Người Dùng) — form lớn nhất hệ thống, đóng / mở.
//
// Chạy: node server/tests/demo-collapse-form-rollout-v24.93.js
'use strict';
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;
const ADMIN_USER = {
  // totpEnabled: true — tránh màn "Bắt Buộc Thiết Lập Xác Thực 2 Lớp" (proceedAfterAuth(), core.js:7920)
  // che mất giao diện cần chụp, không liên quan gì tới nội dung demo.
  username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc',
  perms: { admin: true }, totpEnabled: true
};

async function main() {
  const state = createMockState({
    depts: ['Ban Giám Đốc', 'Vận Hành'],
    users: [ADMIN_USER],
    contractTypes: ['Hợp đồng dịch vụ', 'Hợp đồng mua bán'],
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const outDir = path.join(__dirname, '.tmp-assets');
  fs.mkdirSync(outDir, { recursive: true });

  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN_USER);
    await page.waitForTimeout(150);

    // ===== 1) Hợp Đồng — tab Quản Lý HĐ: đóng -> mở =====
    await page.evaluate(() => { switchTab('contract'); setContractSubTab('MANAGE'); });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, '1a-hopdong-dong.png') });
    await page.evaluate(() => { document.getElementById('btnContractManageNew')?.click(); });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, '1b-hopdong-mo.png') });
    console.log('✅ 1) Hợp Đồng: đã chụp đóng + mở');

    // ===== 2) Quản Lý Danh Mục — 21 thẻ accordion, mặc định đóng =====
    // (ADMIN là top-level, CATALOG là sub-sub-tab bên trong, qua setAdminSubTab() — xem module-hethong-tabs.js)
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('CATALOG'); });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(outDir, '2-quanlydanhmuc-accordion.png'), fullPage: true });
    console.log('✅ 2) Quản Lý Danh Mục: đã chụp accordion (đóng mặc định)');

    // ===== 3) Phân Quyền (Thêm/Sửa Người Dùng) — đóng -> mở =====
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('PERMS'); });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, '3a-phanquyen-dong.png') });
    await page.evaluate(() => { openCreateUserForm(); });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, '3b-phanquyen-mo.png'), fullPage: true });
    console.log('✅ 3) Phân Quyền: đã chụp đóng + mở');

    console.log('\nTất cả ảnh demo lưu tại:', outDir);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
