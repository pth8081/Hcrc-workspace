// tests/test-shelf-report-offline-fallback.js — "📑 Báo Cáo" (Kiểm Soát Hàng Hóa) nay có cache offline
// RIÊNG (key 'report', 12/2026 — xem docs/kiem-ke-kiem-soat-offline.md "Báo Cáo — Thêm Cache Offline
// Mới"). TRƯỚC ĐÂY hoàn toàn không có dự phòng (chỉ cache RAM mất khi tải lại trang) — mất mạng là cột
// "Tồn Kho Hệ Thống" trống trắng "—" toàn bộ. Test này xác nhận: (1) cache-first hiện ngay dữ liệu cũ khi
// mất mạng (nhánh 1 siêu thị), (2) cache 'report' KHÔNG đè lên cache 'cache' dùng chung cho Ghi Nhận/Hạn
// Sử Dụng/Kiểm Kê (lỗi tiềm ẩn phát hiện trong lúc code — 2 cache lẫn chung sẽ làm hỏng khả năng khớp mã
// quét ở những màn đó sau khi chỉ đơn giản xem qua tab Báo Cáo).
// Chạy: node tests/test-shelf-report-offline-fallback.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8995;
  const DEPT1 = 'Siêu thị Quận 1';
  const USER = {
    username: 'nv1', name: 'Nhân Viên 1', dept: DEPT1,
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true
  };
  const state = createMockState({
    depts: [DEPT1], users: [USER],
    shelfRecords: [{ id: 1, dept: DEPT1, shelfLocationId: 1, shelfLocationCode: 'KA1', shelfLocationName: 'Kệ A1', maHang: 'SP001', productName: 'G7 Cà Phê 3in1', quantity: 10, creator: 'nv1', creatorName: 'Nhân Viên 1', createdAt: new Date().toLocaleString('vi-VN'), lastScannedAt: new Date().toISOString() }]
  });
  state.storeExternalCodes = { [DEPT1]: '001' };
  // scope=recon (dùng bởi cả Đối Chiếu lẫn Báo Cáo nhánh 1 siêu thị) chỉ trả về mã ĐÃ TỪNG được quét —
  // seed đúng SP001 khớp với shelfRecords ở trên (xem testHarness.js GET /system-inventory).
  state.__mockSystemInventoryRows = [{ maHang: 'SP001', maVach: '8934000000001', tenHang: 'G7 Cà Phê 3in1', soLuongTon: 42 }];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  const goOffline = () => page.evaluate(() => { window.__origFetch = window.fetch; window.fetch = () => { throw new TypeError('Failed to fetch'); }; });
  const goOnline = () => page.evaluate(() => { if (window.__origFetch) { window.fetch = window.__origFetch; delete window.__origFetch; } });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('SHELF'); setVanHanhShelfSubTab('RECORD'); });
    await page.waitForTimeout(150);

    await run.run('Online: vào Ghi Nhận trước -> cache picker (key "cache") nạp ĐÚNG 1 dòng đầy đủ tồn kho', async () => {
      const len = await page.evaluate(() => shelfSystemInventoryCache.length);
      assertEqual(len, 1, 'Picker Ghi Nhận phải có 1 dòng tồn kho hệ thống');
    });

    await page.evaluate(() => { setVanHanhShelfSubTab('REPORT'); });
    await page.waitForTimeout(200);
    await run.run('Online: vào Báo Cáo -> hiện đúng cột Tồn Kho Hệ Thống = 42, KHÔNG đụng cache picker của Ghi Nhận', async () => {
      const text = await page.evaluate(() => document.getElementById('shelfReportBody')?.textContent || '');
      assert(text.includes('42'), `Phải hiện đúng tồn kho hệ thống 42, thực tế: ${text}`);
      const pickerLen = await page.evaluate(() => shelfSystemInventoryCache.length);
      assertEqual(pickerLen, 1, 'Cache picker Ghi Nhận KHÔNG được bị Báo Cáo ghi đè/xoá mất (2 cache khác key nhau)');
    });

    await goOffline();
    await page.evaluate(() => { setVanHanhShelfSubTab('RECORD'); });
    await page.waitForTimeout(100);
    await page.evaluate(() => { setVanHanhShelfSubTab('REPORT'); });
    await page.waitForTimeout(200);
    await run.run('Offline (lần 2 vào Báo Cáo, mất mạng): vẫn hiện đúng Tồn Kho Hệ Thống = 42 từ cache "report" riêng (TRƯỚC ĐÂY sẽ trống "—")', async () => {
      const text = await page.evaluate(() => document.getElementById('shelfReportBody')?.textContent || '');
      assert(text.includes('42'), `Mất mạng vẫn phải hiện 42 từ cache offline riêng của Báo Cáo, thực tế: ${text}`);
    });
    await goOnline();

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
