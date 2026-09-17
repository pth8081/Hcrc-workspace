// server/tests/demo-vanhanh-rename.js
//
// DEMO thật (không phải bộ hồi quy tự động) — chụp ảnh sidebar + tab con THẬT sau đợt đổi tên
// "Module lớn QLDA -> Vận Hành, tab con Siêu Thị -> QLDA" (10/2026, theo yêu cầu người dùng, gửi ảnh
// demo trước khi merge). Dùng testHarness.js (Chromium thật mở public/index.html thật).
//
// Chạy: node server/tests/demo-vanhanh-rename.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8991;
const OUT_DIR = process.env.VANHANH_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'vanhanh-rename');

const DEMO_USER = {
  username: 'demo_admin', name: 'Quản Trị Viên Demo', dept: 'Phòng IT',
  perms: { admin: true },
  totpEnabled: true,
  active: true
};

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({ depts: ['Phòng IT'], stores: ['Siêu thị A'], users: [DEMO_USER] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1000, height: 900 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, DEMO_USER);
    await page.waitForTimeout(150);

    // 1) Sidebar: mở dropdown "Vận Hành" (trước đây "QLDA")
    await page.evaluate(() => { toggleVanHanhDropdown({ stopPropagation: () => {} }); });
    await page.waitForTimeout(100);
    await shot(page, '#vanHanhNavWrap', '01-sidebar-van-hanh-dropdown.png');

    // 2) Vào module, tab con "🏬 QLDA" (trước đây "Siêu Thị")
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('STORE'); });
    await page.waitForTimeout(150);
    await shot(page, '#vanHanhSection', '02-vanhanh-subtab-qlda.png');
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n✅ Demo hoàn tất — ảnh chụp ở:', OUT_DIR);
})().catch(err => { console.error(err); process.exit(1); });
