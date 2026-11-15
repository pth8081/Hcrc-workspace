// tests/demo-stocktake-kiemke-soft-reminder.js — DEMO ảnh thật "Nhắc nhở mềm" khi đổi quầy kệ Kiểm Kê
// (12/2026, theo yêu cầu người dùng). Chạy: node tests/demo-stocktake-kiemke-soft-reminder.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8992;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'stocktake-kiemke-soft-reminder');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', active: true };
  const USER = { username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1, perms: { kiemKeKiemDemDo: true }, active: true, totpEnabled: true };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [USER],
    shelfLocations: [SHELF_A1, SHELF_A2], stocktakeSessions: [THONG_KE_SESSION],
    stocktakeUserAccess: [
      { id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canKiemDem: true },
      { id: 2, username: 'nv1', dept: DEPT1, shelfLocationId: 11, canKiemDem: true }
    ],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [{ maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 }];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  let n = 0;
  const shot = async (label) => { n += 1; await page.screenshot({ path: path.join(OUT_DIR, `${String(n).padStart(2, '0')}-${label}.png`), fullPage: true }); console.log(`📸 ${label}`); };

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(100);
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(200);

    await page.selectOption('#kkKiemDemShelfSelect', '10');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(200);
    await shot('da-quet-sp001-o-A1-chua-xac-nhan');

    // Mô phỏng bấm "Huỷ" ở hộp thoại nhắc nhở mềm khi đổi sang A2
    await page.evaluate(() => { window.__confirmAnswers = [false]; });
    await page.selectOption('#kkKiemDemShelfSelect', '11');
    await page.waitForTimeout(250);
    const lastConfirm = await page.evaluate(() => window.__confirms[window.__confirms.length - 1] || '');
    console.log('   Nội dung hộp thoại nhắc nhở:', lastConfirm);
    await shot('huy-hop-thoai-giu-nguyen-A1-du-lieu-con-nguyen');

    // Đồng ý đổi sang A2
    await page.evaluate(() => { window.__confirmAnswers = []; }); // mặc định rỗng = luôn đồng ý
    await page.selectOption('#kkKiemDemShelfSelect', '11');
    await page.waitForTimeout(250);
    await shot('dong-y-doi-thanh-cong-sang-A2');

    console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
