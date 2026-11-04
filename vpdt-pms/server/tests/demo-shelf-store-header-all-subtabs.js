// server/tests/demo-shelf-store-header-all-subtabs.js
//
// DEMO thật (không phải bộ hồi quy tự động) — chụp ảnh header cố định "📍 Siêu Thị: ..." (11/2026, theo
// yêu cầu người dùng) hiện ĐÚNG ở CẢ 5 sub-tab của "📋 Kiểm Soát Hàng Hóa": 📷 Ghi Nhận / 🗄️ Quầy Kệ /
// ⏰ Hạn Sử Dụng / 🔔 Ngưỡng Tồn / 📊 Đối Chiếu (Đối Chiếu đã có demo riêng, demo-shelf-recon-madiem.js,
// dựng kèm header chi tiết hơn "Đang đối chiếu Siêu Thị/Mã Điểm" — ở đây chỉ chụp lại cho đủ bộ 5/5).
// Dùng testHarness.js (Chromium thật mở public/index.html thật).
//
// Chạy: node server/tests/demo-shelf-store-header-all-subtabs.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8994;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-store-header-all-subtabs');

// Toàn quyền quản lý Kiểm Soát Hàng Hóa (để cả 5 sub-tab đều mở được, kể cả Quầy Kệ/Ngưỡng Tồn chỉ dành
// cho shelfLocationManage) — mirror đúng vai "Cửa hàng trưởng" theo Huong-dan-nghiep-vu.md.
const USER = {
  username: 'cht1', name: 'Trần Văn Trưởng', dept: 'Siêu thị Quận 1',
  perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true
};

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({ depts: [], stores: ['Siêu thị Quận 1'], users: [USER] });
  state.shelfLocations = [
    { id: 1, dept: 'Siêu thị Quận 1', code: 'KA1', name: 'Kệ bánh kẹo', active: true },
    { id: 2, dept: 'Siêu thị Quận 1', code: 'KB2', name: 'Kệ sữa & đồ uống', active: true }
  ];
  const today = new Date();
  const soon = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000); // cận hạn 3 ngày, rơi nhóm "Cận hạn"
  state.shelfRecords = [
    { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 1, maHang: 'SP001', maVach: '8936012345678', tenHang: 'Bánh quy HCRC 200g', quantity: 48, expiryDate: soon.toISOString().slice(0, 10), note: '', createdAt: today.toISOString(), lastScannedAt: today.toISOString() },
    { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 2, maHang: 'SP002', maVach: '8936012345685', tenHang: 'Sữa tươi HCRC 1L', quantity: 20, expiryDate: '', note: '', createdAt: today.toISOString(), lastScannedAt: today.toISOString() }
  ];
  state.shelfStockThresholds = [
    { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SP001', threshold: 10 }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 820 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.waitForTimeout(150);

    // 1) 📷 Ghi Nhận (mặc định mở sẵn khi vào module)
    await shot(page, '#vanHanhShelfWrap', '01-ghi-nhan.png');

    // 2) 🗄️ Quầy Kệ
    await page.click('#btnVhShelfSubLocations');
    await page.waitForTimeout(150);
    await shot(page, '#vanHanhShelfWrap', '02-quay-ke.png');

    // 3) ⏰ Hạn Sử Dụng
    await page.click('#btnVhShelfSubExpiry');
    await page.waitForTimeout(150);
    await shot(page, '#vanHanhShelfWrap', '03-han-su-dung.png');

    // 4) 🔔 Ngưỡng Tồn
    await page.click('#btnVhShelfSubThreshold');
    await page.waitForTimeout(150);
    await shot(page, '#vanHanhShelfWrap', '04-nguong-ton.png');
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n✅ Demo hoàn tất — ảnh chụp ở:', OUT_DIR);
})().catch((err) => { console.error(err); process.exit(1); });
