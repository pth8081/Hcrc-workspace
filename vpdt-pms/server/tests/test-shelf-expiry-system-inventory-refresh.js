// server/tests/test-shelf-expiry-system-inventory-refresh.js
//
// Theo báo cáo người dùng kèm 2 ảnh chụp màn hình thật (11/2026): cùng 1 mã hàng (329539) hiện
// "Tồn Kho Hệ Thống" = 3 ở tab "⏰ Hạn Sử Dụng" nhưng = 9 ở tab "📊 Đối Chiếu" ngay lúc đó, hỏi "cả
// hai đều realtime phải không?". Nguyên nhân: ensureShelfSystemInventoryForExpiry() (tab Hạn Sử
// Dụng) có điều kiện `if (shelfSystemInventoryCache && shelfSystemInventoryCache.length) return;`
// khiến nó CHỈ tải dữ liệu 1 LẦN DUY NHẤT mỗi phiên làm việc (lần đầu BẤT KỲ tab nào trong 3 tab
// dùng chung cache gọi tới) — mở lại tab sau khi dữ liệu đã đổi ở server (job nền đồng bộ mỗi ~20
// phút) vẫn hiện số CŨ. Trong khi đó loadShelfReconciliation() (tab Đối Chiếu) LUÔN tải lại MỚI mỗi
// lần mở tab, nên 2 tab lệch nhau dù cùng 1 nguồn dữ liệu. Đã vá: bỏ hẳn điều kiện "đã có cache thì
// bỏ qua" — ensureShelfSystemInventoryForExpiry() giờ LUÔN tải lại mới mỗi lần tab Hạn Sử Dụng được
// mở, cùng khuôn loadShelfSystemInventoryForRecordPicker() (Ghi Nhận/Kiểm Tra Giá) đã làm từ trước.
//
// Test này mô phỏng ĐÚNG kịch bản báo cáo: mở tab Hạn Sử Dụng (nạp snapshot A) -> server đồng bộ lại
// (mock đổi state.__mockSystemInventoryRows sang snapshot B) -> chuyển sang tab khác rồi quay lại tab
// Hạn Sử Dụng -> PHẢI hiện snapshot B (mới), không phải A (cũ, lỗi trước khi vá).
//
// Chạy: node server/tests/test-shelf-expiry-system-inventory-refresh.js
'use strict';

const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8997;

const USER = { username: 'nv1', name: 'Nguyễn Thị Hàng', dept: 'Siêu thị Quận 1', perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true };

(async () => {
  const state = createMockState({ depts: [], stores: ['Siêu thị Quận 1'], users: [USER] });
  // Snapshot A — lúc mở tab Hạn Sử Dụng lần đầu.
  state.__mockSystemInventoryRows = [{ maHang: '329539', tenHang: 'Sữa tươi HCRC 1L', soLuongTon: 3 }];
  const today = new Date().toISOString();
  state.shelfRecords = [
    { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationLabel: 'KA1 — Kệ bánh kẹo', productName: 'Sữa tươi HCRC 1L', maHang: '329539', tenHang: 'Sữa tươi HCRC 1L', quantity: 5, expiryDate: '2026-11-30', note: '', createdAt: today, lastScannedAt: today }
  ];
  state.shelfLocations = [{ id: 1, dept: 'Siêu thị Quận 1', code: 'KA1', name: 'Kệ bánh kẹo', active: true }];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 760 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');

    // Mở tab "⏰ Hạn Sử Dụng" lần đầu — phải nạp snapshot A (3).
    await page.click('#btnVhShelfSubExpiry');
    await page.waitForTimeout(300);
    const stockA = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#vhShelfExpiryBody tr')).find(tr => tr.children[1]?.textContent.trim() === 'Sữa tươi HCRC 1L');
      return row ? row.children[5]?.textContent.trim() : null;
    });
    console.log('Lần mở đầu tiên — Tồn Kho Hệ Thống (phải là 3, snapshot A):', stockA);
    assert.strictEqual(stockA, '3', 'LỖI: lần mở đầu tiên phải hiện đúng snapshot A (3)');

    // Server "đồng bộ lại" (job nền) — đổi sang snapshot B (9), ĐÚNG số liệu "Đối Chiếu" trong ảnh chụp người dùng.
    state.__mockSystemInventoryRows = [{ maHang: '329539', tenHang: 'Sữa tươi HCRC 1L', soLuongTon: 9 }];

    // Chuyển sang tab khác rồi quay lại tab "⏰ Hạn Sử Dụng" — PHẢI tải lại MỚI, không dùng cache cũ.
    // CHÚ Ý: dùng tab "📑 Báo Cáo" (không đụng tới shelfSystemInventoryCache) để chuyển tab, KHÔNG dùng
    // tab "📷 Ghi Nhận" (btnVhShelfSubRecord) — tab đó tự fetch lại cache qua
    // loadShelfSystemInventoryForRecordPicker() (luôn tải mới, không có bug) nên sẽ VÔ TÌNH làm mới cache
    // giùm, khiến test không còn cô lập đúng lỗi của riêng ensureShelfSystemInventoryForExpiry().
    await page.click('#btnVhShelfSubReport');
    await page.waitForTimeout(150);
    await page.click('#btnVhShelfSubExpiry');
    await page.waitForTimeout(300);
    const stockB = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#vhShelfExpiryBody tr')).find(tr => tr.children[1]?.textContent.trim() === 'Sữa tươi HCRC 1L');
      return row ? row.children[5]?.textContent.trim() : null;
    });
    console.log('Mở lại lần 2 (sau khi server đồng bộ) — Tồn Kho Hệ Thống (phải là 9, snapshot B, KHÔNG được còn là 3 cũ):', stockB);
    assert.strictEqual(stockB, '9', 'LỖI (bug tái hiện): tab Hạn Sử Dụng vẫn hiện số CŨ từ cache (3) thay vì tải lại mới (9) — đúng lỗi người dùng báo cáo');

    // Xác nhận khớp đúng số tab "📊 Đối Chiếu" đang hiện ngay lúc đó (luôn tải mới, không có cache cũ).
    await page.click('#btnVhShelfSubRecon');
    await page.waitForTimeout(300);
    const reconStock = await page.evaluate(() => {
      const row = Array.from(document.querySelectorAll('#vhShelfReconBody tr')).find(tr => tr.children[0]?.textContent.trim() === '329539');
      return row ? row.children[2]?.textContent.trim() : null;
    });
    console.log('Tab Đối Chiếu — Tồn Kho Hệ Thống (phải CÙNG là 9):', reconStock);
    assert.strictEqual(reconStock, '9', 'LỖI: tab Đối Chiếu phải hiện 9');
    assert.strictEqual(stockB, reconStock, 'LỖI: 2 tab phải cho CÙNG 1 số sau khi dữ liệu đã đồng bộ lại ở server');

    console.log('\n✅ Test xác nhận: tab "⏰ Hạn Sử Dụng" nay LUÔN tải lại Tồn Kho Hệ Thống MỚI mỗi lần mở tab, không còn dùng cache cũ từ phiên trước — khớp đúng tab "📊 Đối Chiếu".');
  } finally {
    await browser.close();
    server.close();
  }
})();
