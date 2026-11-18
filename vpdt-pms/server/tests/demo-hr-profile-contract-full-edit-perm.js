// server/tests/demo-hr-profile-contract-full-edit-perm.js
//
// Demo ảnh (Playwright thật, không phải test hồi quy) cho quyền MỚI "🔓 Toàn Quyền Sửa Hồ Sơ Nhân Sự +
// Hợp Đồng Lao Động" (hrProfileContractFullEdit, 12/2026, theo yêu cầu người dùng "1 quyền đặc biệt, sửa
// được tất cả các trường trong hồ sơ và trong hợp đồng lao động, trừ sửa mã") — gộp 2 quyền hrProfileEdit
// + hrContractManage thành 1 nút bật duy nhất, xem chú thích đầy đủ tại systemSection.html +
// lib/auth.js::expandHrFullEditPerms(). Hành vi SERVER đã được test kỹ ở
// tests/test-hr-profile-contract-full-edit-perm.js (15/15 — cả Phần Nhân Sự lẫn Hợp Đồng Lao Động, kể cả
// xác nhận không bypass Trạng thái/Mã) — demo này CHỈ minh hoạ bằng ẢNH đúng checkbox mới ở Cây Phân
// Quyền thật, dùng hạ tầng tests/testHarness.js (giống tests/demo-hr-secondary-position-manage.js).
//
// Chạy: node server/tests/demo-hr-profile-contract-full-edit-perm.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8999;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'hr-profile-contract-full-edit-perm');

// totpEnabled: true — BẮT BUỘC cho user có perms.admin, nếu không proceedAfterAuth() (core.js) rẽ sang
// nhánh "ép thiết lập TOTP" (openTotpSetupWall()) và dừng lại TRƯỚC KHI nạp DB.users, khiến mọi thao tác
// sau đó (editUser()...) chạy trên DB rỗng.
const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', posType: 'HO', perms: { admin: true }, totpEnabled: true, active: true };
const HR_STAFF = { id: 2, username: 'hr_moi', name: 'Nhân Viên Nhân Sự Mới', dept: 'Phòng Nhân Sự', jobTitle: 'Chuyên Viên Nhân Sự', posType: 'HO', perms: {}, active: true };

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, user);
}
async function shot(page, name, selector) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  if (selector) await page.locator(selector).screenshot({ path: file });
  // fullPage: false — chụp ĐÚNG khung nhìn hiện tại (đã cuộn checkbox vào giữa trước khi gọi), không
  // chụp toàn trang (sẽ mất tác dụng của scrollIntoView vừa làm).
  else await page.screenshot({ path: file, fullPage: false });
  console.log(`📸 ${file}`);
}

async function main() {
  const state = createMockState({
    depts: ['Ban Giám Đốc', 'Phòng Nhân Sự'],
    stores: [],
    users: [ADMIN, HR_STAFF]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1000 });

  try {
    await loginAs(page, ADMIN);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('PERMS'); });
    await page.waitForTimeout(150);
    await page.evaluate((id) => { editUser(id); }, HR_STAFF.id);
    await page.waitForTimeout(250);
    // Mỗi khối quyền là 1 <details class="perm-tree-node"> gấp gọn mặc định — mở hết ra trước khi tìm
    // checkbox (setAllPermTreeNodes(), module-admin-permtree.js — cùng hàm nút "Mở rộng tất cả" thật).
    await page.evaluate(() => setAllPermTreeNodes(true));
    await page.waitForTimeout(100);

    // Ảnh 1: trạng thái CHƯA tick — cuộn checkbox vào GIỮA khung nhìn rồi chụp NGUYÊN khung nhìn, thấy
    // đủ ngữ cảnh 3 quyền nằm cạnh nhau (2 quyền gốc + quyền gộp mới).
    await page.evaluate(() => document.getElementById('pHrProfileContractFullEdit').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(100);
    const checked0 = await page.evaluate(() => document.getElementById('pHrProfileContractFullEdit').checked);
    console.log(`\n01: Checkbox "Toàn Quyền Sửa Hồ Sơ Nhân Sự + Hợp Đồng Lao Động" trước khi tick: ${checked0}`);
    await shot(page, '1-checkbox-chua-tick');

    // Ảnh 2: TICK quyền gộp — xác nhận collectPermsFromForm() đọc đúng trạng thái đã tick (lưu riêng,
    // KHÔNG tự đồng thời tick hrProfileEdit/hrContractManage — 2 quyền đó chỉ được COI LÀ true lúc đánh
    // giá quyền thật ở lib/auth.js::expandHrFullEditPerms(), không ghi trùng vào dữ liệu lưu trữ).
    await page.check('#pHrProfileContractFullEdit');
    await page.waitForTimeout(100);
    const perms = await page.evaluate(() => collectPermsFromForm());
    console.log(`02: Sau khi tick — collectPermsFromForm(): hrProfileContractFullEdit=${perms.hrProfileContractFullEdit}, hrProfileEdit (lưu riêng, KHÔNG tự tick)=${perms.hrProfileEdit}, hrContractManage (lưu riêng, KHÔNG tự tick)=${perms.hrContractManage}`);
    if (!perms.hrProfileContractFullEdit) throw new Error('❌ collectPermsFromForm() KHÔNG đọc đúng trạng thái đã tick.');
    await shot(page, '2-checkbox-da-tick');

    console.log(`\n✅ Demo hoàn tất — ảnh lưu tại: ${OUT_DIR}`);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
