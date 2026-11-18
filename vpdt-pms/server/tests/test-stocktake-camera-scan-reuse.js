// tests/test-stocktake-camera-scan-reuse.js — xác nhận Gom Mã/Kiểm Đếm/Kiểm Soát (Kiểm Kê) dùng ĐÚNG
// CHUNG logic nhận diện mã (Mã Vạch kể cả dsMaVach, Mã Hàng nội bộ, 6-số-cuối) VÀ modal quét camera với
// "📷 Ghi Nhận"/"💲 Kiểm Tra Giá" bên Kiểm Soát Hàng Hóa — theo câu hỏi TRỰC TIẾP người dùng: "chắc lấy
// lại cái logic quét mã ở trong kiểm soát ấy là nó đong được cả mã vạch này, mã nội bộ này, với cả mã
// barcode đấy. Dùng luôn cho cả gom mã kiểm đếm và kiểm soát đi. Đúng cái đó làm nó được chưa?"
//
// Xác nhận qua code: resolveKkScanItemFromCode() (module-vanhanh.js) gọi THẲNG 3 hàm
// matchShelfSystemInventoryByMaVach()/ByMaHang()/BySuffix() — CÙNG hàm "📷 Ghi Nhận" dùng, KHÔNG viết lại
// logic riêng. Nút "📷" ở cả 3 tab Gom Mã/Kiểm Đếm/Kiểm Soát gọi openShelfBarcodeModalForKkScan(tabKey) —
// DÙNG CHUNG đúng 1 modal camera/ZXing/BarcodeDetector với "📷 Ghi Nhận"/"💲 Kiểm Tra Giá" (chỉ đổi
// `shelfBarcodeModalMode`, không phải modal/luồng riêng).
//
// Test này mô phỏng ĐÚNG điểm nối camera->ứng dụng (onShelfBarcodeDecoded(text), hàm camera thật gọi khi
// giải mã xong 1 khung hình) — không mở camera thật (không khả dụng trong môi trường test headless).
// Chạy: node tests/test-stocktake-camera-scan-reuse.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8999;
  const DEPT1 = 'Siêu thị Quận 1';
  const SHELF_A1 = { id: 10, dept: DEPT1, code: 'A1', name: 'Kệ A1 — Gia vị', active: true };
  const ADMIN = { username: 'admin', name: 'Admin', dept: DEPT1, perms: { admin: true }, active: true, totpEnabled: true };
  const GOM_MA_SESSION = { id: 9301, dept: DEPT1, loaiKy: 'GOM_MA', tenKy: 'Gom Mã Q4/2026', trangThai: 'DANG_HOAT_DONG' };
  const THONG_KE_SESSION = { id: 9302, dept: DEPT1, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026', trangThai: 'DANG_HOAT_DONG' };

  const state = createMockState({
    depts: [DEPT1], stores: [DEPT1], users: [ADMIN],
    kiemKeShelfLocations: [SHELF_A1],
    stocktakeSessions: [GOM_MA_SESSION, THONG_KE_SESSION],
    stocktakeUserAccess: [{ id: 1, username: 'admin', dept: DEPT1, shelfLocationId: 10, canGomMa: true, canKiemDem: true, canKiemSoat: true }],
    stocktakeCounts: []
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  // SP001: maVach MẶC ĐỊNH khác hẳn mã vạch PHỤ trong dsMaVach — camera quét ra ĐÚNG mã vạch PHỤ (không
  // phải maVach mặc định) vẫn phải khớp được (đúng cơ chế dsMaVach của "📷 Ghi Nhận").
  // SP002: không cấu hình maVach/dsMaVach nào — chỉ khớp được qua Mã Hàng nội bộ (gõ/quét đúng "SP002").
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', maVach: '8934000000001', dsMaVach: ['8934000000001', '8934000099999'], tenHang: 'G7 Cà Phê 3in1', soLuongTon: 50 },
    { maHang: 'SP002', tenHang: 'Mì Hảo Hảo Tôm Chua Cay', soLuongTon: 30 }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('Mock chỉ hỗ trợ patch-mode')) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  // simulateCameraDecode(tabKey, shelfSelectId, code) — mô phỏng ĐÚNG luồng camera thật: bấm "📷" (gán
  // shelfBarcodeModalMode='KK_SCAN' + kkBarcodeScanTabKey) rồi ZXing/BarcodeDetector giải mã xong 1 khung
  // hình gọi onShelfBarcodeDecoded(code) — KHÔNG mở camera thật (headless không có camera).
  const simulateCameraDecode = (tabKey, code) => page.evaluate(({ tabKey, code }) => {
    shelfBarcodeModalMode = 'KK_SCAN';
    kkBarcodeScanTabKey = tabKey;
    onShelfBarcodeDecoded(code);
  }, { tabKey, code });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    await page.click('#btnKkSubGomMa');
    await page.waitForTimeout(150);
    await page.fill('#kkGomMaShelfInput', 'Siêu thị Quận 1 — A1 — Kệ A1 — Gia vị');
    await page.waitForTimeout(150);
    await run.run('Gom Mã: camera quét ĐÚNG mã vạch PHỤ (dsMaVach, không phải mã vạch mặc định) vẫn khớp SP001', async () => {
      await simulateCameraDecode('GOMMA', '8934000099999');
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.getElementById('kkGomMaListBody')?.textContent || '');
      assert(text.includes('SP001') && text.includes('G7 Cà Phê 3in1'), `Phải nhận diện đúng SP001 qua dsMaVach, thực tế: ${text}`);
    });
    await run.run('Gom Mã: camera quét đúng Mã Hàng nội bộ (không có mã vạch nào) vẫn khớp SP002', async () => {
      await simulateCameraDecode('GOMMA', 'SP002');
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.getElementById('kkGomMaListBody')?.textContent || '');
      assert(text.includes('SP002') && text.includes('Mì Hảo Hảo'), `Phải nhận diện đúng SP002 qua Mã Hàng nội bộ, thực tế: ${text}`);
    });

    await page.click('#btnKkSubKiemDem');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemDemShelfInput', 'Siêu thị Quận 1 — A1 — Kệ A1 — Gia vị');
    await page.waitForTimeout(150);
    await run.run('Kiểm Đếm: nút "📷" dùng ĐÚNG CHUNG openShelfBarcodeModalForKkScan(\'KIEMDEM\') -> camera quét mã vạch phụ vẫn khớp SP001', async () => {
      await simulateCameraDecode('KIEMDEM', '8934000099999');
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.getElementById('kkKiemDemListBody')?.textContent || '');
      assert(text.includes('SP001'), `Phải nhận diện đúng SP001, thực tế: ${text}`);
    });

    await page.click('#btnKkSubKiemSoat');
    await page.waitForTimeout(150);
    await page.fill('#kkKiemSoatShelfInput', 'Siêu thị Quận 1 — A1 — Kệ A1 — Gia vị');
    await page.waitForTimeout(150);
    await run.run('Kiểm Soát: nút "📷" dùng ĐÚNG CHUNG openShelfBarcodeModalForKkScan(\'KIEMSOAT\') -> camera quét Mã Hàng nội bộ vẫn khớp SP002', async () => {
      await simulateCameraDecode('KIEMSOAT', 'SP002');
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.getElementById('kkKiemSoatListBody')?.textContent || '');
      assert(text.includes('SP002'), `Phải nhận diện đúng SP002, thực tế: ${text}`);
    });

    await run.run('Cả 3 tab đều có nút "📷" gọi ĐÚNG data-op="openShelfBarcodeModalForKkScan" (không phải logic/markup riêng)', async () => {
      const ops = await page.evaluate(() => [...document.querySelectorAll('[data-op="openShelfBarcodeModalForKkScan"]')].map(el => el.getAttribute('data-arg0')));
      assertEqual(JSON.stringify(ops.sort()), JSON.stringify(['GOMMA', 'KIEMDEM', 'KIEMSOAT']), ops);
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
