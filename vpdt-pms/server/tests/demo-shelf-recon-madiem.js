// server/tests/demo-shelf-recon-madiem.js
//
// DEMO thật (không phải bộ hồi quy tự động) — chụp ảnh header "📊 Đối Chiếu" MỚI (11/2026, theo yêu cầu
// người dùng: "đối chiếu sai tôi không biết được") — hiện rõ ĐANG đối chiếu dữ liệu đối tác (BRGMART)
// theo đúng Siêu Thị + Mã Điểm nào, để tự so lại với cột "Mã Điểm" cấu hình ở Danh Mục Siêu Thị.
// Dùng testHarness.js (Chromium thật mở public/index.html thật, backend mock mirror ĐÚNG field maDiem
// mới — xem routes/shelfStock.js + setShelfReconHeader()/module-vanhanh.js).
//
// Chạy: node server/tests/demo-shelf-recon-madiem.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8995;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-recon-madiem');

const USER = { username: 'nv1', name: 'Nguyễn Thị Hàng', dept: 'Siêu thị Quận 1', perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true };

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({ depts: [], stores: ['Siêu thị Quận 1'], users: [USER] });
  // Dữ liệu tồn kho hệ thống (đối tác BRGMART, qua mock) — 1 mã KHỚP, 1 mã LỆCH (để demo rõ badge).
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', tenHang: 'Bánh quy HCRC 200g', soLuongTon: 48, maVach: '8936012345678' },
    { maHang: 'SP002', tenHang: 'Sữa tươi HCRC 1L', soLuongTon: 30, maVach: '8936012345685' }
  ];
  state.__mockSystemInventoryMaDiem = 'MD-Q1-0088';
  // 1 ghi nhận HÔM NAY cho SP001 (khớp) — SP002 cố tình KHÔNG ghi nhận gì để ra "Lệch".
  const today = new Date().toISOString();
  state.shelfRecords = [
    { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationLabel: 'KA1 — Kệ bánh kẹo', maHang: 'SP001', maVach: '8936012345678', tenHang: 'Bánh quy HCRC 200g', quantity: 48, expiryDate: '', note: '', createdAt: today, lastScannedAt: today }
  ];
  state.shelfLocations = [{ id: 1, dept: 'Siêu thị Quận 1', code: 'KA1', name: 'Kệ bánh kẹo', active: true }];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 760 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubRecon');
    await page.waitForTimeout(250);

    await shot(page, '#vanHanhShelfWrap', '01-doi-chieu-ma-diem.png');
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n✅ Demo hoàn tất — ảnh chụp ở:', OUT_DIR);
})().catch((err) => { console.error(err); process.exit(1); });
