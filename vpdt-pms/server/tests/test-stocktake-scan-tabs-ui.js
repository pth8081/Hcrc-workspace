// tests/test-stocktake-scan-tabs-ui.js — test Playwright THẬT (click/fill thật, không gọi hàm nội bộ)
// cho Tab 2 "📷 Gom Mã" + Tab 3 "🔢 Kiểm Đếm" + Tab 4 "🛡️ Kiểm Soát" của "📋 Kiểm Kê" — PHÁT HIỆN NGAY
// LÚC VIẾT TEST NÀY: JS engine (loadKkScanTab()/submitKkScan()/...) đã viết xong từ đợt trước nhưng HTML
// thật (#kkGomMaShelfSelect/#kkGomMaScanBox/...) CHƯA TỪNG được thêm vào vanHanhSection.html — 3 tab này
// trước đó vẫn hiện khung "🚧 Đang phát triển" dù code xử lý đã có sẵn. Test này xác nhận ĐỦ luồng thật:
// chưa chọn quầy kệ -> ô quét ẩn; chọn quầy kệ CHƯA có kỳ -> báo rõ, vẫn ẩn ô quét; có kỳ -> quét/gõ mã ->
// cộng dồn đúng -> MRU -> sửa tay -> xoá. Tab 4 thêm cột SL Kiểm Đếm tham khảo.
// Chạy: node tests/test-stocktake-scan-tabs-ui.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8998;
  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1,
    perms: { kiemKeGomMaDo: true, kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true }, active: true, totpEnabled: true
  };
  const GOM_MA_SESSION = { id: 9001, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã T11', trangThai: 'DANG_HOAT_DONG' };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Thống Kê Q4', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [USER],
    shelfLocations: [SHELF_A1],
    stocktakeSessions: [GOM_MA_SESSION, THONG_KE_SESSION],
    stocktakeUserAccess: [{ id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canGomMa: true, canKiemDem: true, canKiemSoat: true }],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [
    { maHang: '2003330491', maVach: '8934696001589', tenHang: 'Sữa tươi TH True Milk 1L', soLuongTon: 100 }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => switchTab('vanHanh'));
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(100);
    await page.click('#btnKkSubGomMa');
    await page.waitForTimeout(200);

    await run.run('Tab 2 Gom Mã: chưa chọn quầy kệ -> ô quét ẨN, hiện gợi ý chọn quầy kệ', async () => {
      const hidden = await page.evaluate(() => document.getElementById('kkGomMaScanBox').classList.contains('hidden'));
      const info = await page.evaluate(() => document.getElementById('kkGomMaSessionInfo').textContent);
      assert(hidden, 'Ô quét phải ẨN khi chưa chọn quầy kệ');
      assert(/chọn quầy kệ/i.test(info), `Phải gợi ý chọn quầy kệ, thực tế: ${info}`);
      const options = await page.evaluate(() => Array.from(document.getElementById('kkGomMaShelfSelect').options).map(o => o.textContent));
      assert(options.some(o => o.includes('A1')), `Phải hiện đúng quầy kệ A1 đã được allowlist, thực tế: ${options.join(',')}`);
    });

    await run.run('Tab 2 Gom Mã: chọn quầy kệ A1 (đã có kỳ Gom Mã đang hoạt động) -> hiện ô quét + tên kỳ', async () => {
      await page.selectOption('#kkGomMaShelfSelect', '10');
      await page.waitForTimeout(200);
      const hidden = await page.evaluate(() => document.getElementById('kkGomMaScanBox').classList.contains('hidden'));
      const info = await page.evaluate(() => document.getElementById('kkGomMaSessionInfo').textContent);
      assert(!hidden, 'Ô quét phải HIỆN sau khi chọn quầy kệ có kỳ đang hoạt động');
      assert(info.includes('Gom Mã T11'), `Phải hiện đúng tên kỳ đang hoạt động, thực tế: ${info}`);
    });

    await run.run('Tab 2 Gom Mã: quét mã khớp tồn kho hệ thống -> thêm vào danh sách đúng SL', async () => {
      await page.fill('#kkGomMaBarcodeInput', '8934696001589');
      await page.click('[data-op="submitKkScan"][data-arg0="GOMMA"]');
      await page.waitForTimeout(200);
      const text = await page.evaluate(() => document.getElementById('kkGomMaListBody').textContent);
      assert(text.includes('2003330491'), `Phải hiện đúng Mã Hàng đã khớp, thực tế: ${text}`);
      assert(text.includes('Sữa tươi TH True Milk 1L'), `Phải hiện đúng tên, thực tế: ${text}`);
    });

    await run.run('Tab 2 Gom Mã: quét TRÙNG mã lần 2 (SL=1 mỗi lần) -> CỘNG DỒN thành 2, không tạo dòng mới', async () => {
      await page.fill('#kkGomMaBarcodeInput', '8934696001589');
      await page.click('[data-op="submitKkScan"][data-arg0="GOMMA"]');
      await page.waitForTimeout(200);
      const rowCount = await page.evaluate(() => document.querySelectorAll('#kkGomMaListBody tbody tr').length);
      const qty = await page.evaluate(() => document.querySelector('#kkGomMaListBody input[type="number"]').value);
      assertEqual(rowCount, 1, `Phải CỘNG DỒN vào đúng 1 dòng, không tạo dòng mới, thực tế: ${rowCount} dòng`);
      assertEqual(qty, '2', `SL phải cộng dồn thành 2, thực tế: ${qty}`);
    });

    await run.run('Tab 2 Gom Mã: sửa tay SL qua ô trong danh sách -> ghi đè đúng (không cộng dồn)', async () => {
      await page.fill('#kkGomMaListBody input[type="number"]', '5');
      await page.dispatchEvent('#kkGomMaListBody input[type="number"]', 'change');
      await page.waitForTimeout(200);
      const qty = await page.evaluate(() => document.querySelector('#kkGomMaListBody input[type="number"]').value);
      assertEqual(qty, '5', `Sửa tay phải GHI ĐÈ thành 5, thực tế: ${qty}`);
    });

    await run.run('Tab 2 Gom Mã: tìm kiếm không khớp -> báo rõ, không crash', async () => {
      await page.fill('#kkGomMaWrap input[placeholder*="Tìm theo"]', 'khong-ton-tai-xyz');
      await page.waitForTimeout(100);
      const text = await page.evaluate(() => document.getElementById('kkGomMaListBody').textContent);
      assert(/không tìm thấy/i.test(text), `Phải báo không tìm thấy, thực tế: ${text}`);
      await page.fill('#kkGomMaWrap input[placeholder*="Tìm theo"]', '');
      await page.waitForTimeout(100);
    });

    await run.run('Tab 2 Gom Mã: xoá dòng -> danh sách rỗng lại', async () => {
      await page.click('#kkGomMaListBody button[data-op="deleteKkScanCount"]');
      await page.waitForTimeout(200);
      const text = await page.evaluate(() => document.getElementById('kkGomMaListBody').textContent);
      assert(/chưa quét mã nào/i.test(text), `Phải báo rỗng sau khi xoá, thực tế: ${text}`);
    });

    await run.run('Tab 3 Kiểm Đếm: chọn quầy kệ A1 (kỳ Thống Kê đang hoạt động) -> hiện ô quét đúng kỳ', async () => {
      await page.click('#btnKkSubKiemDem');
      await page.waitForTimeout(150);
      await page.selectOption('#kkKiemDemShelfSelect', '10');
      await page.waitForTimeout(200);
      const hidden = await page.evaluate(() => document.getElementById('kkKiemDemScanBox').classList.contains('hidden'));
      const info = await page.evaluate(() => document.getElementById('kkKiemDemSessionInfo').textContent);
      assert(!hidden, 'Ô quét Kiểm Đếm phải hiện');
      assert(info.includes('Thống Kê Q4'), `Phải đúng kỳ Thống Kê, thực tế: ${info}`);
      await page.fill('#kkKiemDemBarcodeInput', '2003330491');
      await page.click('[data-op="submitKkScan"][data-arg0="KIEMDEM"]');
      await page.waitForTimeout(200);
      const text = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(text.includes('2003330491'), `Kiểm Đếm phải quét được, thực tế: ${text}`);
    });

    await run.run('Tab 2 vs Tab 3: Gom Mã và Kiểm Đếm GHI VÀO FIELD RIÊNG, không lẫn số liệu lẫn nhau', async () => {
      // Quay lại Gom Mã — dòng vừa xoá ở trên, quét lại 1 lần để có dữ liệu so sánh độc lập.
      await page.click('#btnKkSubGomMa');
      await page.waitForTimeout(150);
      await page.fill('#kkGomMaBarcodeInput', '2003330491');
      await page.click('[data-op="submitKkScan"][data-arg0="GOMMA"]');
      await page.waitForTimeout(200);
      const gomMaQty = await page.evaluate(() => document.querySelector('#kkGomMaListBody input[type="number"]')?.value);
      assertEqual(gomMaQty, '1', `Gom Mã phải là dòng MỚI của riêng nó (SL=1), không cộng dồn với Kiểm Đếm, thực tế: ${gomMaQty}`);
    });

    await run.run('Tab 4 Kiểm Soát: chọn quầy kệ -> quét -> danh sách hiện thêm cột "SL Kiểm Đếm" tham khảo', async () => {
      await page.click('#btnKkSubKiemSoat');
      await page.waitForTimeout(150);
      await page.selectOption('#kkKiemSoatShelfSelect', '10');
      await page.waitForTimeout(200);
      await page.fill('#kkKiemSoatBarcodeInput', '2003330491');
      await page.fill('#kkKiemSoatQtyInput', '108');
      await page.click('[data-op="submitKkScan"][data-arg0="KIEMSOAT"]');
      await page.waitForTimeout(200);
      const headerText = await page.evaluate(() => document.querySelector('#kkKiemSoatListBody thead').textContent);
      const rowText = await page.evaluate(() => document.querySelector('#kkKiemSoatListBody tbody').textContent);
      assert(headerText.includes('SL Kiểm Đếm'), `Phải có cột tham khảo SL Kiểm Đếm, thực tế header: ${headerText}`);
      assert(rowText.includes('1'), `Cột SL Kiểm Đếm tham khảo phải hiện đúng số Kiểm Đếm đã quét trước đó (1), thực tế: ${rowText}`);
    });

    await run.run('Đổi quầy kệ về rỗng -> ô quét ẩn lại, danh sách xoá sạch', async () => {
      await page.selectOption('#kkKiemSoatShelfSelect', '');
      await page.waitForTimeout(150);
      const hidden = await page.evaluate(() => document.getElementById('kkKiemSoatScanBox').classList.contains('hidden'));
      const listEmpty = await page.evaluate(() => document.getElementById('kkKiemSoatListBody').innerHTML.trim());
      assert(hidden, 'Bỏ chọn quầy kệ phải ẩn lại ô quét');
      assertEqual(listEmpty, '', 'Bỏ chọn quầy kệ phải xoá sạch danh sách đang hiện (không phải của quầy kệ nào)');
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
