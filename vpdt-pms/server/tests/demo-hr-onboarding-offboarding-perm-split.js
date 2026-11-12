// server/tests/demo-hr-onboarding-offboarding-perm-split.js
//
// DEMO thật (Playwright, chụp ảnh — không phải test regression), theo yêu cầu người dùng: "Tách riêng
// luôn quyền onboarding và offboarding nhé, ko cho lẫn vào nhau, gửi ảnh demo cho tôi".
//
// XÁC NHẬN: 2 quyền này ĐÃ tách riêng hoàn toàn từ đợt refactor 11/2026 trước đó (xem chú thích
// "ĐỔI (11/2026, theo yêu cầu người dùng 'tách Onboarding/Offboarding thành 2 nhóm quyền riêng vì
// người dùng khác nhau là bộ phận Tuyển Dụng và bộ phận Nhân Sự')" ở public/fragments/systemSection.html)
// — KHÔNG có quyền gộp chung nào còn sót lại (hrProcessManage cũ đã bị xoá hẳn qua migrateLegacyPerms()).
// Demo này KHÔNG sửa code gì — chỉ chứng minh THẬT bằng thao tác click trên UI thật + đọc lại đúng
// collectPermsFromForm() (module-admin-permtree.js) rằng 4 quyền Onboarding/Offboarding là 4 checkbox
// ĐỘC LẬP hoàn toàn, tick bên Onboarding KHÔNG hề ảnh hưởng tới Offboarding và ngược lại.
//
// Chạy: node server/tests/demo-hr-onboarding-offboarding-perm-split.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8998;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'hr-onboarding-offboarding-perm-split');

const ADMIN = { id: 1, username: 'admin1', name: 'Quản Trị Viên', dept: 'Phòng IT', posType: 'HO', perms: { admin: true }, totpEnabled: true, active: true };
// Tài khoản mục tiêu — mô phỏng ĐÚNG kịch bản thực tế: 1 tài khoản bộ phận Tuyển Dụng, chưa có quyền
// Nhân Sự nào, admin sắp chỉ cấp đúng 2 quyền Onboarding (KHÔNG đụng gì tới Offboarding).
const TUYEN_DUNG = { id: 2, username: 'tuyendung1', name: 'Nguyễn Thị Tuyển Dụng', dept: 'Phòng Nhân Sự', posType: 'HO', perms: {}, active: true };

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}
async function shot(page, name) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${name}.png`);
  // Chỉ chụp ĐÚNG khung 4 dòng checkbox Onboarding/Offboarding (không chụp cả details cha — quá dài,
  // lại dễ dính header sticky đè lên) — hợp nhất bounding box từ dòng "Quản Lý Onboarding" tới hết
  // dòng "Toàn Quyền Thao Tác Quy Trình Offboarding".
  const box = await page.evaluate(() => {
    const first = document.getElementById('pHrOnboardingManage').closest('label');
    const last = document.getElementById('pHrOffboardingProcessManage').closest('label');
    const r1 = first.getBoundingClientRect();
    const r2 = last.getBoundingClientRect();
    const x = Math.min(r1.x, r2.x);
    const y = Math.min(r1.y, r2.y);
    const right = Math.max(r1.x + r1.width, r2.x + r2.width);
    const bottom = r2.y + r2.height;
    return { x, y, width: right - x, height: bottom - y };
  });
  const pad = 6;
  await page.screenshot({ path: file, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + pad * 2, height: box.height + pad * 2 } });
  console.log(`📸 ${file}`);
}

async function main() {
  const state = createMockState({ depts: ['Phòng IT', 'Phòng Nhân Sự'], stores: [], users: [ADMIN, TUYEN_DUNG] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1100, height: 900 });

  try {
    await loginAs(page, ADMIN);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('PERMS'); });
    await page.waitForTimeout(150);
    await page.evaluate((id) => { editUser(id); }, TUYEN_DUNG.id);
    await page.waitForTimeout(150);

    // Mở khối "🤝 21. Nhân Sự" trong cây phân quyền (details đóng mặc định) — bấm THẬT vào <summary>.
    await page.evaluate(() => {
      const cb = document.getElementById('pHrOnboardingManage');
      const details = cb.closest('details');
      details.open = true;
      details.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(150);

    // Ảnh 1 — trạng thái BAN ĐẦU: cả 4 checkbox Onboarding/Offboarding đều RIÊNG BIỆT, chưa tick gì.
    await shot(page, '1-khoi-nhan-su-ban-dau-chua-tick');

    // Click THẬT (không chỉ gán .checked bằng JS) đúng 2 checkbox ONBOARDING — mô phỏng admin cấp quyền
    // cho tài khoản Tuyển Dụng.
    await page.click('#pHrOnboardingManage');
    await page.click('#pHrOnboardingProcessManage');
    await page.waitForTimeout(100);

    // Ảnh 2 — SAU khi tick 2 quyền Onboarding: 2 checkbox Offboarding PHẢI vẫn còn trống trơn.
    await shot(page, '2-sau-khi-tick-onboarding-offboarding-van-trong');

    const afterOnboardingTick = await page.evaluate(() => ({
      onboardingManage: document.getElementById('pHrOnboardingManage').checked,
      onboardingProcessManage: document.getElementById('pHrOnboardingProcessManage').checked,
      offboardingManage: document.getElementById('pHrOffboardingManage').checked,
      offboardingProcessManage: document.getElementById('pHrOffboardingProcessManage').checked,
    }));
    console.log('Sau khi tick 2 quyền Onboarding:', afterOnboardingTick);
    assert.strictEqual(afterOnboardingTick.onboardingManage, true, 'LỖI: Quản Lý Onboarding phải đang tick');
    assert.strictEqual(afterOnboardingTick.onboardingProcessManage, true, 'LỖI: Toàn Quyền Thao Tác Onboarding phải đang tick');
    assert.strictEqual(afterOnboardingTick.offboardingManage, false, 'LỖI (mixing!): tick Onboarding không được tự tick luôn Quản Lý Offboarding');
    assert.strictEqual(afterOnboardingTick.offboardingProcessManage, false, 'LỖI (mixing!): tick Onboarding không được tự tick luôn Toàn Quyền Thao Tác Offboarding');

    // Đọc đúng collectPermsFromForm() (module-admin-permtree.js, hàm THẬT dùng khi Lưu) để xác nhận
    // ở TẦNG DỮ LIỆU (không chỉ UI) — 2 quyền Offboarding là false/undefined, không hề bị gộp giá trị.
    const collected = await page.evaluate(() => {
      const p = collectPermsFromForm();
      return {
        hrOnboardingManage: p.hrOnboardingManage, hrOnboardingProcessManage: p.hrOnboardingProcessManage,
        hrOffboardingManage: p.hrOffboardingManage, hrOffboardingProcessManage: p.hrOffboardingProcessManage,
      };
    });
    console.log('collectPermsFromForm() trả về:', collected);
    assert.strictEqual(collected.hrOnboardingManage, true, 'LỖI dữ liệu: hrOnboardingManage phải là true');
    assert.strictEqual(collected.hrOnboardingProcessManage, true, 'LỖI dữ liệu: hrOnboardingProcessManage phải là true');
    assert.strictEqual(!!collected.hrOffboardingManage, false, 'LỖI dữ liệu (mixing!): hrOffboardingManage không được lây giá trị true');
    assert.strictEqual(!!collected.hrOffboardingProcessManage, false, 'LỖI dữ liệu (mixing!): hrOffboardingProcessManage không được lây giá trị true');

    // Chiều ngược lại — reset về trống, tick CHỈ 2 quyền OFFBOARDING, xác nhận Onboarding không bị lây.
    await page.click('#pHrOnboardingManage');
    await page.click('#pHrOnboardingProcessManage');
    await page.click('#pHrOffboardingManage');
    await page.click('#pHrOffboardingProcessManage');
    await page.waitForTimeout(100);
    await shot(page, '3-doi-chieu-chi-tick-offboarding-onboarding-van-trong');
    const afterOffboardingTick = await page.evaluate(() => collectPermsFromForm());
    assert.strictEqual(!!afterOffboardingTick.hrOnboardingManage, false, 'LỖI dữ liệu (mixing!): tick Offboarding không được lây sang hrOnboardingManage');
    assert.strictEqual(!!afterOffboardingTick.hrOnboardingProcessManage, false, 'LỖI dữ liệu (mixing!): tick Offboarding không được lây sang hrOnboardingProcessManage');
    assert.strictEqual(afterOffboardingTick.hrOffboardingManage, true, 'LỖI dữ liệu: hrOffboardingManage phải là true');
    assert.strictEqual(afterOffboardingTick.hrOffboardingProcessManage, true, 'LỖI dữ liệu: hrOffboardingProcessManage phải là true');

    console.log('\n✅ Xác nhận: "Quản Lý/Toàn Quyền Onboarding" và "Quản Lý/Toàn Quyền Offboarding" là 4 quyền HOÀN TOÀN ĐỘC LẬP (cả ở UI lẫn dữ liệu collectPermsFromForm()) — tick bên này KHÔNG bao giờ lây sang bên kia.');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
