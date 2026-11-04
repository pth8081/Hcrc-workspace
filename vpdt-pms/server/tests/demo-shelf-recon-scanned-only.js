// server/tests/demo-shelf-recon-scanned-only.js
//
// DEMO thật (không phải bộ hồi quy tự động) — theo yêu cầu người dùng (11/2026): "Đối Chiếu chỉ đối
// chiếu cho những mã đã scan lên kệ, còn không thì bỏ qua — không thì phần này quá nhiều khi siêu thị ấn
// cùng một lúc có thể gây treo ứng dụng." Chụp ảnh TRƯỚC (mô tả) và SAU (thật) để người dùng xác nhận:
// tồn kho hệ thống của siêu thị có 6 mã (giống thực tế vài chục nghìn mã/siêu thị), nhưng chỉ 2 mã đã
// được scan lên kệ hôm nay — màn Đối Chiếu giờ CHỈ hiện đúng 2 mã đó + dòng ghi chú minh bạch "2/6 mã".
//
// Chạy: node server/tests/demo-shelf-recon-scanned-only.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8994;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-recon-scanned-only');

const USER = { username: 'nv1', name: 'Nguyễn Thị Hàng', dept: 'Siêu thị Quận 1', perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true };

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({ depts: [], stores: ['Siêu thị Quận 1'], users: [USER] });
  // Mô phỏng tồn kho hệ thống "lớn" (thực tế vài chục nghìn mã/siêu thị) — ở đây rút gọn 6 mã để demo
  // vẫn đọc được, nhưng CHỈ 2 mã (SP001, SP002) có ghi nhận scan lên kệ hôm nay.
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', tenHang: 'Bánh quy HCRC 200g', soLuongTon: 48, maVach: '8936012345678' },
    { maHang: 'SP002', tenHang: 'Sữa tươi HCRC 1L', soLuongTon: 30, maVach: '8936012345685' },
    { maHang: 'SP003', tenHang: 'Nước suối Lavie 500ml', soLuongTon: 120 },
    { maHang: 'SP004', tenHang: 'Mì tôm Hảo Hảo', soLuongTon: 300 },
    { maHang: 'SP005', tenHang: 'Dầu ăn Simply 1L', soLuongTon: 60 },
    { maHang: 'SP006', tenHang: 'Nước mắm Nam Ngư 500ml', soLuongTon: 90 }
  ];
  const today = new Date().toISOString();
  // SP001 khớp đúng (48=48), SP002 lệch (scan 25 nhưng hệ thống còn 30) — SP003-SP006 CHƯA scan hôm nay.
  state.shelfRecords = [
    { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationLabel: 'KA1 — Kệ bánh kẹo', maHang: 'SP001', maVach: '8936012345678', tenHang: 'Bánh quy HCRC 200g', quantity: 48, expiryDate: '', note: '', createdAt: today, lastScannedAt: today },
    { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationLabel: 'KA1 — Kệ bánh kẹo', maHang: 'SP002', maVach: '8936012345685', tenHang: 'Sữa tươi HCRC 1L', quantity: 25, expiryDate: '', note: '', createdAt: today, lastScannedAt: today }
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
    await page.waitForTimeout(300);

    await shot(page, '#vanHanhShelfWrap', '01-doi-chieu-chi-scan-hom-nay.png');

    // Xác nhận đúng số dòng + nội dung note minh bạch.
    const result = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#vhShelfReconBody tr').length,
      maHangList: Array.from(document.querySelectorAll('#vhShelfReconBody tr td:first-child')).map(td => td.textContent.trim()),
      note: document.getElementById('shelfReconNote').textContent
    }));
    console.log('Số dòng hiện trên màn Đối Chiếu:', result.rowCount, '(tồn kho hệ thống có 6 mã)');
    console.log('Mã hàng hiện ra:', result.maHangList);
    console.log('Note:', result.note);
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\n✅ Demo hoàn tất — ảnh chụp ở:', OUT_DIR);
})().catch((err) => { console.error(err); process.exit(1); });
