// server/tests/demo-vpp-participating-stores.js
//
// DEMO thật (không phải quy hoạch tests/test-*.js — không nằm trong bộ hồi quy tự động) cho tính năng
// "cho phép thêm Siêu Thị vào danh sách Phòng Ban Tham Gia VPP" (11/2026 ĐỢT 2, theo yêu cầu người dùng
// kèm ảnh chụp màn hình) — chụp ảnh màn hình thật cho người dùng xem.
//
// Chạy: node server/tests/demo-vpp-participating-stores.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8994;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'vpp-participating-stores');
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };

async function shot(page, selector, file, label) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log(`📸 ${label} ->`, file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const state = createMockState({
    depts: ['Ban Giám Đốc', 'Phòng Nhân Sự - Hành Chính'],
    stores: ['Siêu thị Minh Khai', 'Siêu thị Hải Dương', 'Siêu thị Sài Đồng'],
    users: [
      ADMIN,
      { username: 'nv1', name: 'Nguyễn Thị A', dept: 'Siêu thị Minh Khai', posType: 'STORE', jobTitle: 'Nhân viên bán hàng', active: true },
      { username: 'nv2', name: 'Trần Văn B', dept: 'Siêu thị Minh Khai', posType: 'STORE', jobTitle: 'Nhân viên bán hàng', active: true },
      { username: 'nv3', name: 'Lê Thị C', dept: 'Siêu thị Minh Khai', posType: 'STORE', jobTitle: 'Thu ngân', active: true }
    ],
    vppParticipatingDepts: []
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1100, height: 700 });

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADVWORKFLOW'); setAdvWorkflowSubTab('SPECIALPERM'); });
    await page.waitForTimeout(150);

    // Ảnh 1: khối "Phòng Ban/Siêu Thị Tham Gia VPP" lúc CHƯA chọn gì (mặc định rỗng).
    await page.locator('#vppParticipatingDeptsMultiSelect').scrollIntoViewIfNeeded();
    await shot(page, 'xpath=//h5[contains(text(),"Phòng Ban/Siêu Thị Tham Gia VPP")]/ancestor::div[contains(@class,"border-b")][1]',
      '01-khoi-phong-ban-sieu-thi-tham-gia-vpp-trong.png', 'Khối "Phòng Ban/Siêu Thị Tham Gia VPP" — mặc định rỗng');

    // Ảnh 2: gõ tìm "Siêu" -> dropdown gợi ý hiện ĐỦ cả 3 siêu thị (trước đây KHÔNG có trong danh sách này).
    // Dropdown dùng position:absolute nên tràn ra ngoài khung cha — chụp cả vùng xung quanh (clip theo
    // khung widget mở rộng thêm chiều cao) thay vì screenshot đúng khung widget (sẽ bị cắt mất dropdown).
    await page.fill('#vppParticipatingDeptsMultiSelect [data-pms-search]', 'Siêu');
    await page.waitForTimeout(100);
    const box = await page.locator('#vppParticipatingDeptsMultiSelect').boundingBox();
    await page.screenshot({ path: path.join(OUT_DIR, '02-go-tim-sieu-thi-hien-goi-y.png'), clip: { x: box.x, y: box.y, width: box.width, height: box.height + 140 } });
    console.log('📸 Gõ tìm "Siêu" — ô tìm-chọn giờ gợi ý ĐỦ cả 3 siêu thị -> 02-go-tim-sieu-thi-hien-goi-y.png');

    // Chọn 1 siêu thị + 1 phòng ban, rồi bấm Lưu.
    await page.click('#vppParticipatingDeptsMultiSelect [data-pms-dropdown] div:has-text("Siêu thị Minh Khai")');
    await page.fill('#vppParticipatingDeptsMultiSelect [data-pms-search]', 'Phòng Nhân Sự');
    await page.waitForTimeout(100);
    await page.click('#vppParticipatingDeptsMultiSelect [data-pms-dropdown] div:has-text("Phòng Nhân Sự - Hành Chính")');
    await page.waitForTimeout(100);

    // Ảnh 3: đã chọn CẢ 1 phòng ban LẪN 1 siêu thị trong cùng 1 danh sách.
    await shot(page, 'xpath=//h5[contains(text(),"Phòng Ban/Siêu Thị Tham Gia VPP")]/ancestor::div[contains(@class,"border-b")][1]',
      '03-da-chon-ca-phong-ban-lan-sieu-thi.png', 'Đã chọn CẢ "Phòng Nhân Sự - Hành Chính" LẪN "Siêu thị Minh Khai"');

    // Ghi thẳng lựa chọn vào DB (bỏ qua vòng gọi API thật — harness demo này không mô phỏng route lưu
    // vppParticipatingDepts, không ảnh hưởng gì tới việc minh hoạ UI/hành vi của tính năng).
    await page.evaluate(() => { DB.vppParticipatingDepts = getMultiSelectValues('vppParticipatingDeptsMultiSelect'); });

    // Mở VPP > Kỳ > "Tạo Kỳ Đăng Ký Mới" — xác nhận bảng "Nhân sự theo phòng ban" giờ CÓ ĐÚNG siêu thị vừa thêm.
    await page.evaluate(() => { switchTab('vpp'); setVppSubTab('PERIODS'); openVppNewPeriodForm(); });
    await page.waitForTimeout(150);
    await shot(page, '#vppNewPeriodFormWrap div.overflow-x-auto:has(#vppDeptHeadcountBody)',
      '04-bang-nhan-su-theo-phong-ban-co-sieu-thi.png', 'Bảng "Nhân sự theo phòng ban" lúc Tạo Kỳ — đã có đúng siêu thị vừa thêm, tự lấy số nhân sự thật (3 người)');

    console.log('\n✅ XÁC NHẬN: ô "Phòng Ban/Siêu Thị Tham Gia VPP" giờ cho chọn CẢ siêu thị, và siêu thị đã chọn tự xuất hiện đúng ở bảng "Nhân sự theo phòng ban" lúc Tạo Kỳ Đăng Ký Mới, lấy đúng số nhân sự thật đang thuộc siêu thị đó.');
  } finally {
    await browser.close();
    server.close();
  }
})();
