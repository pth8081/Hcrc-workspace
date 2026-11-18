// tests/demo-user-contact-hr-sync-12-2026.js — DEMO ảnh thật cho đợt "đồng bộ Email/Số điện thoại từ
// Nhân Sự sang Phân Quyền" (12/2026, theo yêu cầu người dùng: "cho phép đồng bộ phần email và phần số
// điện thoại từ nhân sự sang phân quyền nhà tôi nhé") + xác nhận lại tính năng "Ngày Vào Làm Việc" tự
// động (đã làm từ đợt trước) VẪN hoạt động đúng, cả 3 field cùng tự điền 1 lượt khi gõ Họ và Tên khớp 1
// Hồ Sơ Nhân Sự đã có sẵn.
// Chạy: node tests/demo-user-contact-hr-sync-12-2026.js
'use strict';
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8992;
const ADMIN_USER = {
  username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc',
  // hrProfileManage (MỚI, cần cho GET /api/hr-profile/employee-directory — canFullViewProfiles() KHÔNG
  // tự bypass qua admin:true, xem chú thích ở routes/employeeProfile.js/testHarness.js) — admin demo này
  // phải tick quyền rõ ràng giống thực tế.
  perms: { admin: true, hrProfileManage: true }, totpEnabled: true
};

async function main() {
  const state = createMockState({
    depts: ['Ban Giám Đốc', 'Vận Hành'],
    users: [ADMIN_USER],
    jobTitles: ['Nhân viên', 'Trưởng phòng'],
    // Hồ sơ Nhân Sự ĐÃ CÓ sẵn Ngày Vào HCRC + Email công ty + SĐT liên hệ (VD nhập tay/import Excel
    // trước, CHƯA liên kết tài khoản VPDT nào — username: null) — đúng kịch bản thật IT tạo tài khoản
    // đăng nhập cho người ĐÃ có hồ sơ Nhân Sự từ trước.
    employeeProfiles: [{
      employeeCode: 'BL3883', fullName: 'Lò Thị Chứ', status: 'ACTIVE', username: null,
      joinDateAtHcrc: '2026-11-15', workEmail: 'lothichu@hcrc.local', contactPhone: '0912345678'
    }]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const outDir = path.join(__dirname, '..', 'demo-screenshots', 'user-contact-hr-sync');
  fs.mkdirSync(outDir, { recursive: true });
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  let n = 0;
  const shot = async (label) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: path.join(outDir, file) });
    console.log(`📸 ${file}`);
  };

  try {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN_USER);
    await page.waitForTimeout(150);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('PERMS'); });
    await page.waitForTimeout(150);
    await page.evaluate(() => { openCreateUserForm(); });
    await page.waitForTimeout(150);
    await shot('form-trong-chua-dien-gi');

    // Gõ Họ và Tên khớp ĐÚNG hồ sơ Nhân Sự đã seed -> rời ô (blur/change) để kích hoạt tự động dò.
    await page.fill('#uFullName', 'Lò Thị Chứ');
    await page.locator('#uFullName').blur();
    await page.waitForTimeout(300);
    await shot('tu-dong-dien-ca-3-truong-ngay-vao-email-sdt');

    // Phóng cận khối 9 ô identity để thấy rõ 3 giá trị vừa tự điền.
    await page.locator('#userIdentityFields').screenshot({ path: path.join(outDir, '03-phong-can-3-truong-tu-dien.png') });
    console.log('📸 03-phong-can-3-truong-tu-dien.png');

    console.log(jsErrors.length ? `⚠️  Có ${jsErrors.length} lỗi JS:\n${jsErrors.join('\n')}` : '✅ Không có lỗi JS/console nào phát sinh.');
    console.log(`\n✅ Đã chụp ${n + 1} ảnh demo tại ${outDir}`);
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
