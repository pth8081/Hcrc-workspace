// tests/demo-stocktake-tab6-bulk-gomma-confirm.js — DEMO ảnh thật 2 tính năng MỚI (12/2026), theo yêu
// cầu người dùng: "IT có thể chọn nhiều quầy kệ kiểm đếm, gom mã và kiểm soát để xác nhận cũng như gỡ
// xác nhận đúng không? Nếu chưa có thì xử lý ngay nhé, gửi demo cho tôi trước khi tôi xác nhận thực
// hiện":
//   (a) Xác Nhận Gom Mã riêng theo từng quầy kệ (MỚI — trước đây Gom Mã không có khoá/Xác Nhận nào).
//   (b) Chọn nhiều quầy kệ ("Chọn tất cả" + tick riêng) rồi "Xác Nhận Đã Chọn"/"Gỡ Xác Nhận Đã Chọn"
//       HÀNG LOẠT — áp dụng ĐỒNG THỜI cho cả 3 khung Kiểm Đếm/Kiểm Soát/Gom Mã.
// Luồng: Kiểm Đếm 2 quầy kệ (A1+A2) + Gom Mã 1 quầy kệ (A1, kỳ Gom Mã riêng) → Tab 6: bulk "Chọn tất cả"
// + Xác Nhận Đã Chọn cho Kiểm Đếm (cả A1+A2 cùng lúc) → bulk Gỡ Xác Nhận Đã Chọn (cả 2 cùng lúc) → Gom
// Mã: chọn đúng Kỳ Gom Mã riêng, bulk Xác Nhận → quay lại Tab 2 Gom Mã, quầy kệ A1 bị khoá NGAY.
// Chạy: node tests/demo-stocktake-tab6-bulk-gomma-confirm.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8996;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'stocktake-tab6-bulk-gomma-confirm');
const KNOWN_HARNESS_NOISE = 'Lỗi khi lưu "users" lên máy chủ: Error: Mock chưa hỗ trợ route: POST /api/data/users';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2 — Mì, cháo', active: true };
  const MANAGER = {
    username: 'qlA', name: 'Quản Lý Siêu Thị', dept: DEPT1,
    perms: { kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true, kiemKeGomMaDo: true, kiemKeConfirmDo: true }, active: true, totpEnabled: true
  };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const GOM_MA_SESSION = { id: 9003, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [MANAGER],
    shelfLocations: [SHELF_A1, SHELF_A2],
    stocktakeSessions: [THONG_KE_SESSION, GOM_MA_SESSION],
    stocktakeUserAccess: [
      { id: 1, username: 'qlA', dept: DEPT1, shelfLocationId: 10, canKiemDem: true, canKiemSoat: true, canGomMa: true },
      { id: 2, username: 'qlA', dept: DEPT1, shelfLocationId: 11, canKiemDem: true, canKiemSoat: true, canGomMa: true }
    ],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 },
    { maHang: 'SP002', maVach: '8934000000002', tenHang: 'Mì Hảo Hảo', soLuongTon: 30 }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 1100 });
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes(KNOWN_HARNESS_NOISE)) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('dialog', (d) => d.accept().catch(() => {}));

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

    // Kiểm Đếm A1 + A2 (Kỳ Kiểm Kê).
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(150);
    await page.selectOption('#kkKiemDemShelfSelect', '10');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(150);
    await page.selectOption('#kkKiemDemShelfSelect', '11');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemBarcodeInput', 'SP002');
    await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(150);

    // Gom Mã A1 (Kỳ Gom Mã RIÊNG — MỚI, trước đây không có khoá/Xác Nhận).
    await page.click('#btnKkSubGomMa');
    await page.waitForTimeout(150);
    await page.selectOption('#kkGomMaShelfSelect', '10');
    await page.waitForTimeout(150);
    await page.fill('#kkGomMaBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="GOMMA"]');
    await page.waitForTimeout(150);
    await shot('tab2-gom-ma-A1-da-quet');

    // Tab 6 Xác Nhận — khung Kiểm Đếm: trước khi chọn gì, 2 nút bulk đều khoá.
    await page.click('#btnKkSubConfirm');
    await page.waitForTimeout(250);
    await shot('tab6-truoc-khi-chon-nut-bulk-khoa');
    const bulkBtnsDisabledBefore = await page.evaluate(() => {
      const bar = document.getElementById('kkConfirmBulkBarKiemDem');
      return Array.from(bar.querySelectorAll('button[data-bulk-btn]')).every(b => b.disabled);
    });
    console.log(bulkBtnsDisabledBefore ? '✅ Chưa chọn quầy kệ nào -> cả 2 nút bulk đều khoá' : '⚠️ Nút bulk không khoá đúng lúc chưa chọn gì');

    // Tick "Chọn tất cả" -> 2 nút bulk mở khoá, báo đúng số lượng đã chọn.
    await page.check('#kkConfirmBulkBarKiemDem input[type="checkbox"]');
    await page.waitForTimeout(150);
    await shot('tab6-chon-tat-ca-kiem-dem-2-quay-ke');
    const countLabel = await page.evaluate(() => document.querySelector('#kkConfirmBulkBarKiemDem [data-role="count"]').textContent);
    console.log(countLabel.includes('2') ? `✅ Báo đúng "${countLabel}"` : `⚠️ Báo sai số lượng đã chọn: "${countLabel}"`);

    // Bấm "Xác Nhận Đã Chọn" -> CẢ 2 quầy kệ Xác Nhận cùng 1 lần bấm.
    await page.click('[data-op="bulkConfirmKkShelves"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(300);
    await shot('tab6-bulk-xac-nhan-ca-2-quay-ke-cung-luc');
    const confirmedCount = await page.evaluate(() => (document.getElementById('kkConfirmShelfListBody').textContent.match(/đã xác nhận bởi/g) || []).length);
    console.log(confirmedCount === 2 ? '✅ Bulk Xác Nhận: cả A1+A2 chuyển sang đã xác nhận CÙNG 1 lần bấm' : `⚠️ Chỉ ${confirmedCount}/2 quầy kệ được xác nhận`);

    // Bulk Gỡ Xác Nhận — tick lại "Chọn tất cả" (giờ đang tick 2 dòng ĐÃ xác nhận) rồi bấm "Gỡ Xác Nhận Đã Chọn".
    await page.check('#kkConfirmBulkBarKiemDem input[type="checkbox"]');
    await page.waitForTimeout(150);
    await page.click('[data-op="bulkUnconfirmKkShelves"][data-arg0="KIEMDEM"]');
    await page.waitForTimeout(300);
    await shot('tab6-bulk-go-xac-nhan-ca-2-quay-ke-cung-luc');
    const confirmedCountAfterUn = await page.evaluate(() => (document.getElementById('kkConfirmShelfListBody').textContent.match(/đã xác nhận bởi/g) || []).length);
    console.log(confirmedCountAfterUn === 0 ? '✅ Bulk Gỡ Xác Nhận: cả A1+A2 gỡ xác nhận CÙNG 1 lần bấm' : `⚠️ Vẫn còn ${confirmedCountAfterUn} quầy kệ chưa gỡ được`);

    // Khung Gom Mã (kỳ RIÊNG) — chọn đúng Kỳ Gom Mã, hiện A1, bulk Xác Nhận.
    await page.selectOption('#kkConfirmGomMaSessionSelect', '9003');
    await page.waitForTimeout(250);
    await shot('tab6-khung-gom-ma-rieng-truoc-xac-nhan');
    await page.check('#kkConfirmBulkBarGomMa input[type="checkbox"]');
    await page.waitForTimeout(150);
    await page.click('[data-op="bulkConfirmKkShelves"][data-arg0="GOMMA"]');
    await page.waitForTimeout(300);
    await shot('tab6-khung-gom-ma-da-xac-nhan-qua-bulk');
    const gomMaConfirmedText = await page.evaluate(() => document.getElementById('kkConfirmGomMaShelfListBody').textContent);
    console.log(gomMaConfirmedText.includes('đã xác nhận bởi') ? '✅ Xác Nhận Gom Mã (MỚI): A1 chuyển sang đã xác nhận qua bulk' : `⚠️ Gom Mã chưa xác nhận được: "${gomMaConfirmedText}"`);

    // Quay lại Tab 2 Gom Mã -> quầy kệ A1 bị khoá NGAY lúc chọn (Lớp 4 Gom Mã, MỚI).
    await page.click('#btnKkSubGomMa');
    await page.waitForTimeout(150);
    await page.selectOption('#kkGomMaShelfSelect', '11');
    await page.waitForTimeout(150);
    await page.selectOption('#kkGomMaShelfSelect', '10');
    await page.waitForTimeout(200);
    await shot('tab2-gom-ma-A1-bi-khoa-ngay-sau-xac-nhan');
    const lockedInfo = await page.evaluate(() => document.getElementById('kkGomMaSessionInfo').textContent);
    console.log(/ĐÃ được Xác Nhận Gom Mã/.test(lockedInfo)
      ? '✅ Tab 2 Gom Mã: ô quét bị khoá NGAY, báo rõ lý do (Lớp 4 Gom Mã MỚI hoạt động đúng)'
      : `⚠️ Thông báo khoá không đúng: "${lockedInfo}"`);

    console.log(jsErrors.length ? `⚠️ Có lỗi JS: ${jsErrors.join(' | ')}` : '✅ Không có lỗi JS/console nào phát sinh.');
    console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
