// tests/test-stocktake-kiemke-dupma-column.js — test Playwright THẬT cho cột "Trùng Mã" MỚI ở Gom Mã/
// Kiểm Đếm/Kiểm Soát (theo yêu cầu người dùng: "có thể một mã nhưng nhiều dòng do khi quét mã nằm rải
// rác trên kệ và không cộng dồn khi ghi nhận ở các mục này... cho hiện một cột trùng mã và ghi số lượng
// dòng đang có mã bị trùng... để biết có 3 hàng đang trùng mã và tổng là 9").
// Chạy: node tests/test-stocktake-kiemke-dupma-column.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8997;
  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1', active: true };
  const SHELF_A2 = { id: 11, dept: DEPT1, code: 'A2', name: 'Kệ A2', active: true };
  const SHELF_A3 = { id: 12, dept: DEPT1, code: 'A3', name: 'Kệ A3', active: true };
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1,
    perms: { kiemKeGomMaDo: true, kiemKeKiemDemDo: true, kiemKeKiemSoatDo: true }, active: true, totpEnabled: true
  };
  const GOM_MA_SESSION = { id: 9001, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã T12', trangThai: 'DANG_HOAT_DONG' };
  const THONG_KE_SESSION = { id: 9002, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê T12', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [USER],
    kiemKeShelfLocations: [SHELF_A1, SHELF_A2, SHELF_A3],
    stocktakeSessions: [GOM_MA_SESSION, THONG_KE_SESSION],
    stocktakeUserAccess: [
      { id: 1, username: 'nv1', dept: DEPT1, shelfLocationId: 10, canGomMa: true, canKiemDem: true, canKiemSoat: true },
      { id: 2, username: 'nv1', dept: DEPT1, shelfLocationId: 11, canGomMa: true, canKiemDem: true, canKiemSoat: true },
      { id: 3, username: 'nv1', dept: DEPT1, shelfLocationId: 12, canGomMa: true, canKiemDem: true, canKiemSoat: true }
    ],
    // Sản phẩm P001 rải rác trên 3 quầy kệ (A1=2, A2=3, A3=4, tổng=9) — ĐÚNG ví dụ người dùng nêu.
    // Sản phẩm P002 chỉ ở A1 (SL=5) -> KHÔNG trùng, phải hiện "—".
    stocktakeCounts: [
      { id: 1, sessionId: THONG_KE_SESSION.id, dept: DEPT1, shelfLocationId: 10, maHang: 'P001', maVach: '8930000000001', tenHang: 'Sản Phẩm Rải Rác', slKiemDem: 2 },
      { id: 2, sessionId: THONG_KE_SESSION.id, dept: DEPT1, shelfLocationId: 11, maHang: 'P001', maVach: '8930000000001', tenHang: 'Sản Phẩm Rải Rác', slKiemDem: 3 },
      { id: 3, sessionId: THONG_KE_SESSION.id, dept: DEPT1, shelfLocationId: 12, maHang: 'P001', maVach: '8930000000001', tenHang: 'Sản Phẩm Rải Rác', slKiemDem: 4 },
      { id: 4, sessionId: THONG_KE_SESSION.id, dept: DEPT1, shelfLocationId: 10, maHang: 'P002', maVach: '8930000000002', tenHang: 'Sản Phẩm Riêng Lẻ', slKiemDem: 5 }
    ]
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [
    { maHang: 'P001', maVach: '8930000000001', tenHang: 'Sản Phẩm Rải Rác', soLuongTon: 100 },
    { maHang: 'P002', maVach: '8930000000002', tenHang: 'Sản Phẩm Riêng Lẻ', soLuongTon: 50 },
    { maHang: 'P003', maVach: '8930000000003', tenHang: 'Sản Phẩm Gom Mã', soLuongTon: 20 }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(100);
    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(150);

    await run.run('Kiểm Đếm: chọn A1 -> P001 (rải rác 3 kệ, tổng 2+3+4=9) hiện "3 dòng • Tổng 9"', async () => {
      await page.fill('#kkKiemDemShelfInput', `${DEPT1} — A1 — Kệ A1`);
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(/P001/.test(text), `Phải hiện P001, thực tế: ${text}`);
      assert(/3 dòng • Tổng 9/.test(text), `P001 phải hiện "3 dòng • Tổng 9", thực tế: ${text}`);
    });

    await run.run('Kiểm Đếm: chọn A1 -> P002 (chỉ 1 kệ, không trùng) hiện "—"', async () => {
      const row = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('#kkKiemDemListBody tbody tr'));
        const r = rows.find(tr => tr.textContent.includes('P002'));
        return r ? r.textContent : null;
      });
      assert(row, 'Phải tìm thấy dòng P002');
      assert(row.includes('—'), `P002 không trùng kệ nào khác, phải hiện "—", thực tế: ${row}`);
      assert(!/dòng • Tổng/.test(row), `P002 KHÔNG được hiện cảnh báo trùng mã, thực tế: ${row}`);
    });

    await run.run('Kiểm Đếm: chuyển sang A2 -> P001 CŨNG hiện đúng "3 dòng • Tổng 9" (tính theo CẢ kỳ, không chỉ theo kệ đang xem)', async () => {
      await page.fill('#kkKiemDemShelfInput', `${DEPT1} — A2 — Kệ A2`);
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(/3 dòng • Tổng 9/.test(text), `P001 ở A2 phải hiện đúng "3 dòng • Tổng 9", thực tế: ${text}`);
    });

    await run.run('Kiểm Đếm: chuyển sang A3 -> P001 vẫn hiện đúng "3 dòng • Tổng 9"', async () => {
      await page.fill('#kkKiemDemShelfInput', `${DEPT1} — A3 — Kệ A3`);
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkKiemDemListBody').textContent);
      assert(/3 dòng • Tổng 9/.test(text), `P001 ở A3 phải hiện đúng "3 dòng • Tổng 9", thực tế: ${text}`);
    });

    await run.run('Kiểm Soát: dùng chung dupMap -> P001 ở A1 cũng hiện "3 dòng • Tổng 9" (quét Kiểm Soát riêng SL khác, dupMap tính theo slKiemSoat riêng)', async () => {
      await page.click('#btnKkSubKiemSoat');
      await page.waitForTimeout(150);
      await page.fill('#kkKiemSoatShelfInput', `${DEPT1} — A1 — Kệ A1`);
      await page.waitForTimeout(200);
      await page.fill('#kkKiemSoatBarcodeInput', 'P001');
      await page.fill('#kkKiemSoatQtyInput', '2');
      await page.click('[data-op="submitKkScan"][data-arg0="KIEMSOAT"]');
      await page.waitForTimeout(200);
      await page.fill('#kkKiemSoatShelfInput', `${DEPT1} — A2 — Kệ A2`);
      await page.waitForTimeout(200);
      await page.fill('#kkKiemSoatBarcodeInput', 'P001');
      await page.fill('#kkKiemSoatQtyInput', '3');
      await page.click('[data-op="submitKkScan"][data-arg0="KIEMSOAT"]');
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkKiemSoatListBody').textContent);
      assert(/2 dòng • Tổng 5/.test(text), `P001 Kiểm Soát (A1=2,A2=3) phải hiện "2 dòng • Tổng 5", thực tế: ${text}`);
    });

    await run.run('Gom Mã: quét P003 trên 2 kệ -> hiện đúng "2 dòng • Tổng ..."', async () => {
      await page.click('#btnKkSubGomMa');
      await page.waitForTimeout(150);
      await page.fill('#kkGomMaShelfInput', `${DEPT1} — A1 — Kệ A1`);
      await page.waitForTimeout(200);
      await page.fill('#kkGomMaBarcodeInput', '8930000000003');
      await page.click('[data-op="submitKkScan"][data-arg0="GOMMA"]');
      await page.waitForTimeout(200);
      await page.fill('#kkGomMaShelfInput', `${DEPT1} — A2 — Kệ A2`);
      await page.waitForTimeout(200);
      await page.fill('#kkGomMaBarcodeInput', '8930000000003');
      await page.click('[data-op="submitKkScan"][data-arg0="GOMMA"]');
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkGomMaListBody').textContent);
      assert(/2 dòng • Tổng 2/.test(text), `P003 Gom Mã (A1=1,A2=1) phải hiện "2 dòng • Tổng 2", thực tế: ${text}`);
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
