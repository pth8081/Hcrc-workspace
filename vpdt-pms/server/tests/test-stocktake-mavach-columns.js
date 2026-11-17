// tests/test-stocktake-mavach-columns.js — xác nhận "2 cột mã" (Mã Hàng nội bộ + Mã Vạch) có mặt ở MỌI
// tab Kiểm Kê có hiển thị mã sản phẩm (theo yêu cầu TRỰC TIẾP người dùng: "ở tất cả các tab của kiểm kê
// thì phải riêng phần mã thì có hai mã nhé, là mã vạch và mã nội bộ... bắt buộc phải có hai cột đấy").
// Phạm vi: Tab "📦 Tồn Kho", Tab Gom Mã/Kiểm Đếm/Kiểm Soát (renderKkScanList), Tab "📊 Báo Cáo" (bảng
// Chi Tiết Theo Mã Hàng) — CẢ server (maVach đi đúng qua sumCountsByMaHang()/computeSessionPrimaryRows(),
// routes/stocktake.js) lẫn UI thật (Playwright).
// Chạy: node tests/test-stocktake-mavach-columns.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8997;
  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };
  const GOM_MA_SESSION = { id: 9201, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONG_KE_SESSION = { id: 9202, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };

  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [ADMIN],
    kiemKeShelfLocations: [SHELF_A1],
    stocktakeSessions: [GOM_MA_SESSION, THONG_KE_SESSION],
    stocktakeUserAccess: [{ id: 1, username: 'admin', dept: DEPT1, shelfLocationId: 10, canGomMa: true, canKiemDem: true, canKiemSoat: true }],
    stocktakeCounts: [
      { id: 1, sessionId: THONG_KE_SESSION.id, dept: DEPT1, shelfLocationId: 10, maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', slKiemDem: 48, slKiemSoat: 48 }
    ]
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  state.__mockSystemInventoryRows = [{ maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 }];
  state.__mockKkInventoryByDept = {
    [DEPT1]: { rows: [{ maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 }], fetchedAt: new Date().toISOString() }
  };
  state.__mockStocktakeReportInventoryByDept = { [DEPT1]: [{ maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 }] };

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('Mock chỉ hỗ trợ patch-mode')) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    await page.click('#btnKkSubInventory');
    await page.waitForTimeout(300);
    await run.run('Tab "📦 Tồn Kho": có cột "Mã Vạch" + hiện đúng giá trị mã vạch', async () => {
      const headText = await page.evaluate(() => document.getElementById('kkInventoryStoresBody')?.textContent || '');
      assert(headText.includes('Mã Vạch'), 'Phải có tiêu đề cột "Mã Vạch"');
      assert(headText.includes('8934000000001'), 'Phải hiện đúng giá trị mã vạch SP001');
    });

    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(150);
    await page.selectOption('#kkKiemDemShelfSelect', '10');
    await page.waitForTimeout(250);
    await run.run('Tab "🔢 Kiểm Đếm": danh sách quét có cột "Mã Vạch" + đúng giá trị', async () => {
      const text = await page.evaluate(() => document.getElementById('kkKiemDemListBody')?.textContent || '');
      assert(text.includes('Mã Vạch'), 'Phải có tiêu đề cột "Mã Vạch"');
      assert(text.includes('8934000000001'), 'Phải hiện đúng mã vạch của SP001 đã quét');
    });

    await page.click('#btnKkSubKiemSoat');
    await page.waitForTimeout(150);
    await page.selectOption('#kkKiemSoatShelfSelect', '10');
    await page.waitForTimeout(250);
    await run.run('Tab "🛡️ Kiểm Soát": danh sách quét có cột "Mã Vạch" + đúng giá trị', async () => {
      const text = await page.evaluate(() => document.getElementById('kkKiemSoatListBody')?.textContent || '');
      assert(text.includes('Mã Vạch'), 'Phải có tiêu đề cột "Mã Vạch"');
      assert(text.includes('8934000000001'), 'Phải hiện đúng mã vạch của SP001 đã quét');
    });

    await page.click('#btnKkSubGomMa');
    await page.waitForTimeout(150);
    await page.selectOption('#kkGomMaShelfSelect', '10');
    await page.fill('#kkGomMaBarcodeInput', 'SP001');
    await page.click('[data-op="submitKkScan"][data-arg0="GOMMA"]');
    await page.waitForTimeout(250);
    await run.run('Tab "📷 Gom Mã": danh sách quét có cột "Mã Vạch" + đúng giá trị (kể cả quét MỚI)', async () => {
      const text = await page.evaluate(() => document.getElementById('kkGomMaListBody')?.textContent || '');
      assert(text.includes('Mã Vạch'), 'Phải có tiêu đề cột "Mã Vạch"');
      assert(text.includes('8934000000001'), 'Phải hiện đúng mã vạch của SP001 vừa gom mã');
    });

    await page.click('#btnKkSubReport');
    await page.waitForTimeout(350);
    await run.run('Tab "📊 Báo Cáo": bảng "Chi Tiết Theo Mã Hàng" có cột "Mã Vạch" + đúng giá trị', async () => {
      const text = await page.evaluate(() => document.getElementById('kkReportTableBody')?.textContent || '');
      const headText = await page.evaluate(() => document.getElementById('kkReportTableHead')?.textContent || '');
      assert(headText.includes('Mã Vạch'), 'Phải có tiêu đề cột "Mã Vạch"');
      assert(text.includes('8934000000001'), 'Phải hiện đúng mã vạch của SP001');
    });

    await run.run('Không có lỗi JS/console nào phát sinh', async () => {
      assert(jsErrors.length === 0, 'Lỗi JS: ' + jsErrors.join(' | '));
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
