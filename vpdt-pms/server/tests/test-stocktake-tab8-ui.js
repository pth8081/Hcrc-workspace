// tests/test-stocktake-tab8-ui.js — test Playwright THẬT (click nút, gõ ô, không gọi hàm nội bộ) cho:
// (1) gating 8 nút sub-tab Kiểm Kê theo ĐÚNG quyền kiemKe* của user (vừa vá — trước đó TẤT CẢ 8 nút luôn
//     hiện bất kể quyền gì, "nút hiện nhưng bấm vào bị 403" — xem setKiemKeSubTab() ở module-vanhanh.js);
// (2) luồng Tab 8 "Cấu Hình Người Dùng" THẬT: chọn người dùng qua ô tìm-kiếm-gõ-chọn, chọn siêu thị, tick
//     quầy kệ, lưu quyền, xác nhận hiện đúng trong "Danh Sách Đã Gán", rồi xoá.
// Chạy: node tests/test-stocktake-tab8-ui.js
'use strict';
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8997;

const DEPT1 = 'Siêu thị Quận 1';
const DEPT2 = 'Siêu thị Quận 2';
const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };

const ADMIN = { username: 'admin', name: 'Admin Hệ Thống', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };
const GOMMA_ONLY = { username: 'nv1', name: 'Nhân Viên Gom Mã', dept: DEPT1, perms: { kiemKeGomMaDo: true }, active: true, totpEnabled: true };

let passed = 0, failed = 0;
function check(label, cond) {
  if (cond) { passed += 1; console.log(`PASS: ${label}`); }
  else { failed += 1; console.log(`FAIL: ${label}`); }
}

(async () => {
  const state = createMockState({
    depts: [DEPT1, DEPT2], stores: [DEPT1, DEPT2],
    users: [ADMIN, GOMMA_ONLY],
    shelfLocations: [SHELF_A1]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(String(err && err.stack || err)));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  try {
    // ===== 1) User chỉ có kiemKeGomMaDo: vào Kiểm Kê, CHỈ thấy nút PERIOD + GOMMA, 6 nút còn lại ẨN =====
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, GOMMA_ONLY);
    await page.waitForTimeout(150);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.waitForTimeout(100);
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(200);

    const visibility = await page.evaluate(() => {
      const ids = ['btnKkSubPeriod', 'btnKkSubGomMa', 'btnKkSubKiemDem', 'btnKkSubKiemSoat', 'btnKkSubShelfConfig', 'btnKkSubConfirm', 'btnKkSubReport', 'btnKkSubUserAccess'];
      const out = {};
      ids.forEach(id => { const el = document.getElementById(id); out[id] = el ? !el.classList.contains('hidden') : null; });
      return out;
    });
    check('Nhân viên chỉ có kiemKeGomMaDo: nút PERIOD hiện (mọi người đều xem được Tab 1)', visibility.btnKkSubPeriod === true);
    check('Nhân viên chỉ có kiemKeGomMaDo: nút GOMMA hiện', visibility.btnKkSubGomMa === true);
    check('Nhân viên chỉ có kiemKeGomMaDo: nút KIEMDEM ẨN', visibility.btnKkSubKiemDem === false);
    check('Nhân viên chỉ có kiemKeGomMaDo: nút KIEMSOAT ẨN', visibility.btnKkSubKiemSoat === false);
    check('Nhân viên chỉ có kiemKeGomMaDo: nút SHELFCONFIG ẨN', visibility.btnKkSubShelfConfig === false);
    check('Nhân viên chỉ có kiemKeGomMaDo: nút CONFIRM ẨN', visibility.btnKkSubConfirm === false);
    check('Nhân viên chỉ có kiemKeGomMaDo: nút REPORT ẨN', visibility.btnKkSubReport === false);
    check('Nhân viên chỉ có kiemKeGomMaDo: nút USERACCESS ẨN', visibility.btnKkSubUserAccess === false);

    // Thử ép vào thẳng tab USERACCESS (giả lập cố tình gọi hàm/đổi DOM) — phải tự rơi về tab còn quyền.
    const fellBackTab = await page.evaluate(() => { setKiemKeSubTab('USERACCESS'); return activeKiemKeSubTab; });
    check('Cố ép vào tab USERACCESS khi không có quyền -> tự rơi về tab khác (không phải USERACCESS)', fellBackTab !== 'USERACCESS');

    // ===== 2) Admin: thấy ĐỦ 8 nút =====
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.waitForTimeout(150);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.waitForTimeout(100);
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(200);
    const adminVisibility = await page.evaluate(() => {
      const ids = ['btnKkSubPeriod', 'btnKkSubGomMa', 'btnKkSubKiemDem', 'btnKkSubKiemSoat', 'btnKkSubShelfConfig', 'btnKkSubConfirm', 'btnKkSubReport', 'btnKkSubUserAccess'];
      return ids.every(id => { const el = document.getElementById(id); return el && !el.classList.contains('hidden'); });
    });
    check('Admin: đủ 8 nút sub-tab đều hiện', adminVisibility === true);

    // ===== 3) Luồng Tab 8 thật: admin gán quyền cho nv1 ở quầy kệ A1 (Gom Mã) =====
    await page.click('#btnKkSubUserAccess');
    await page.waitForTimeout(250);
    await page.fill('#kkUaUserInput', 'Nhân Viên Gom Mã');
    await page.waitForTimeout(150);
    // Chọn đúng gợi ý khớp username nv1 trong dropdown sdd (click item đầu tiên khớp).
    const picked = await page.evaluate(() => {
      const dd = document.getElementById('kkUaUserDatalist');
      if (!dd) return false;
      const item = Array.from(dd.querySelectorAll('[data-sdd-item], li, div')).find(el => el.textContent && el.textContent.includes('nv1'));
      if (!item) return false;
      item.click();
      return true;
    });
    check('Chọn được gợi ý người dùng "nv1" từ ô tìm-kiếm-gõ-chọn', picked === true);
    await page.selectOption('#kkUaDeptSelect', DEPT1);
    await page.waitForTimeout(150);
    const shelfCbCount = await page.evaluate(() => document.querySelectorAll('.kk-ua-shelf-cb').length);
    check('Chọn siêu thị xong -> hiện đúng 1 checkbox quầy kệ A1 của siêu thị đó', shelfCbCount === 1);
    await page.click('.kk-ua-shelf-cb');
    await page.click('#kkUaCanGomMa');
    await page.click('[data-op="submitKkUserAccess"]');
    await page.waitForTimeout(300);

    const listText = await page.evaluate(() => document.getElementById('kkUaListBody')?.textContent || '');
    check('Sau khi lưu quyền, "Danh Sách Đã Gán" hiện đúng tên người dùng', listText.includes('Nhân Viên Gom Mã'));
    check('Sau khi lưu quyền, "Danh Sách Đã Gán" hiện đúng quầy kệ A1', listText.includes('A1'));

    // Xoá dòng vừa gán — xác nhận danh sách rỗng lại.
    await page.click('[data-op="deleteKkUserAccess"]');
    await page.waitForTimeout(300);
    const listTextAfterDelete = await page.evaluate(() => document.getElementById('kkUaListBody')?.textContent || '');
    check('Xoá quyền vừa gán -> không còn hiện trong danh sách', !listTextAfterDelete.includes('Nhân Viên Gom Mã'));

    check('Không có lỗi JS nào phát sinh trong toàn bộ luồng test', jsErrors.length === 0);
    if (jsErrors.length) jsErrors.forEach(e => console.log('   JS ERROR:', e));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`\n==== ${passed} passed, ${failed} failed ====`);
  process.exit(failed ? 1 : 0);
})();
