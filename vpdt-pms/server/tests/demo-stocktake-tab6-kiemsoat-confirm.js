// tests/demo-stocktake-tab6-kiemsoat-confirm.js — DEMO ảnh thật tính năng "Xác Nhận Kiểm Soát Từng Quầy
// Kệ" (12/2026, theo phản hồi người dùng: "không kiểm soát mà không xác nhận... có thể làm sai lệch số
// liệu nếu người ta cứ kiểm soát suốt. Khi kiểm soát xong phải đóng lại quầy kệ để còn báo cáo, đảm bảo
// không ai phát sinh làm thêm cái gì"). Luồng: Kiểm Đếm + Kiểm Soát 1 quầy kệ → Xác Nhận Kiểm Đếm → Xác
// Nhận Toàn Bộ Đợt VẪN bị chặn vì còn Kiểm Soát chưa Xác Nhận → Xác Nhận Kiểm Soát → quay lại Tab 4 xác
// nhận quầy kệ bị khoá Kiểm Soát NGAY → Xác Nhận Toàn Bộ Đợt giờ mở khoá.
// Chạy: node tests/demo-stocktake-tab6-kiemsoat-confirm.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8995;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'stocktake-tab6-kiemsoat-confirm');
const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chưa hỗ trợ route: POST /api/data/users';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const MANAGER = {
    username: 'qlA', name: 'Quản Lý Siêu Thị', dept: DEPT1,
    perms: { kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true, kiemKeConfirmDo: true }, active: true, totpEnabled: true
  };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [MANAGER],
    shelfLocations: [SHELF_A1],
    stocktakeSessions: [THONG_KE_SESSION],
    stocktakeUserAccess: [{ id: 1, username: 'qlA', dept: DEPT1, shelfLocationId: 10, canKiemDem: true, canKiemSoat: true }],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [{ maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 }];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1000 });
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes(KNOWN_HARNESS_NOISE)) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  let n = 0;
  const shot = async (label) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
    console.log(`📸 ${file}`);
  };

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    // Kiểm Đếm + Kiểm Soát quầy kệ A1.
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(150);
    await page.selectOption('#kkKiemDemShelfSelect', '10');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(150);

    await page.click('#btnKkSubKiemSoat');
    await page.waitForTimeout(150);
    await page.selectOption('#kkKiemSoatShelfSelect', '10');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemSoatBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMSOAT"]');
    await page.waitForTimeout(150);

    // Tab 6: Xác Nhận Kiểm Đếm A1.
    await page.click('#btnKkSubConfirm');
    await page.waitForTimeout(250);
    await shot('tab6-truoc-xac-nhan-2-khung-doc-lap');
    await page.click('#kkConfirmShelfListBody button[data-op="confirmKkShelf"][data-arg0="10"]');
    await page.waitForTimeout(200);
    await shot('tab6-da-xac-nhan-kiem-dem-nhung-toan-bo-dot-van-khoa');

    const noteAfterKiemDemOnly = await page.evaluate(() => document.getElementById('kkConfirmAllNote').textContent);
    console.log(noteAfterKiemDemOnly.includes('Kiểm Soát')
      ? '✅ Nút Toàn Bộ Đợt báo rõ còn thiếu Xác Nhận Kiểm Soát (dù Kiểm Đếm đã đủ)'
      : `⚠️ Thông báo không đúng: "${noteAfterKiemDemOnly}"`);

    // Xác Nhận Kiểm Soát A1.
    await page.click('#kkConfirmSoatShelfListBody button[data-op="confirmKkSoatShelf"][data-arg0="10"]');
    await page.waitForTimeout(200);
    await shot('tab6-da-xac-nhan-ca-2-nut-toan-bo-dot-mo-khoa');

    const btnDisabledAfterBoth = await page.evaluate(() => document.querySelector('[data-op="submitKkConfirmAll"]').disabled);
    console.log(!btnDisabledAfterBoth ? '✅ Đủ cả Kiểm Đếm + Kiểm Soát -> nút Xác Nhận Toàn Bộ Đợt đã MỞ KHOÁ' : '⚠️ Nút vẫn khoá dù đã đủ điều kiện');

    // Quay lại Tab 4 Kiểm Soát -> quầy kệ A1 giờ bị khoá NGAY.
    await page.click('#btnKkSubKiemSoat');
    await page.waitForTimeout(150);
    await page.selectOption('#kkKiemSoatShelfSelect', '10');
    await page.waitForTimeout(200);
    await shot('tab4-kiem-soat-bi-khoa-ngay-sau-xac-nhan');
    const lockedInfo = await page.evaluate(() => document.getElementById('kkKiemSoatSessionInfo').textContent);
    console.log(/ĐÃ được Xác Nhận Kiểm Soát/.test(lockedInfo)
      ? '✅ Tab 4 Kiểm Soát: ô quét bị khoá NGAY, báo rõ lý do'
      : `⚠️ Thông báo khoá không đúng: "${lockedInfo}"`);

    console.log(jsErrors.length ? `⚠️ Có lỗi JS: ${jsErrors.join(' | ')}` : '✅ Không có lỗi JS/console nào phát sinh.');
    console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
