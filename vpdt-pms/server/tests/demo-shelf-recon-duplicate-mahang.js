// server/tests/demo-shelf-recon-duplicate-mahang.js
//
// DEMO thật (Playwright, không phải test logic đơn thuần) — theo báo cáo người dùng kèm 3 ảnh chụp màn
// hình thật (11/2026): 1 mã hàng ("2005332610" trong ảnh thật) xuất hiện 2 DÒNG trong bảng "📊 Đối Chiếu"
// với "Tồn Kho Hệ Thống" KHÁC NHAU (0 và 8) — dữ liệu thô từ API Tồn Kho BRGMART có thể trả nhiều dòng
// cho CÙNG 1 mã hàng (VD theo lô/kho con khác nhau). Mô phỏng lại ĐÚNG kịch bản đó: SP002 có 2 dòng tồn
// kho hệ thống (0 và 8), xác nhận sau khi vá (lib/shelfInventoryAggregate.js) bảng Đối Chiếu chỉ còn
// ĐÚNG 1 dòng cho SP002 với Tồn Kho Hệ Thống = tổng 2 dòng (8).
//
// Chạy: node server/tests/demo-shelf-recon-duplicate-mahang.js
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8995;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-recon-duplicate-mahang');

const USER = { username: 'nv1', name: 'Nguyễn Thị Hàng', dept: 'Siêu thị Quận 1', perms: { vanHanhShelfTab: true, shelfRecordCreate: true }, active: true, totpEnabled: true };

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({ depts: [], stores: ['Siêu thị Quận 1'], users: [USER] });
  // SP002 có 2 DÒNG tồn kho hệ thống (0 và 8) — ĐÚNG kịch bản ảnh chụp người dùng gửi (mã hàng
  // "2005332610" lặp lại 2 lần, Tồn Kho Hệ Thống 0 và 8).
  state.__mockSystemInventoryRows = [
    { maHang: 'SP001', tenHang: 'Bánh quy HCRC 200g', soLuongTon: 48 },
    { maHang: 'SP002', tenHang: 'Sữa tươi HCRC 1L', soLuongTon: 0 },
    { maHang: 'SP002', tenHang: 'Sữa tươi HCRC 1L', soLuongTon: 8 }
  ];
  const today = new Date().toISOString();
  state.shelfRecords = [
    { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationLabel: 'KA1 — Kệ bánh kẹo', maHang: 'SP001', tenHang: 'Bánh quy HCRC 200g', quantity: 48, expiryDate: '', note: '', createdAt: today, lastScannedAt: today },
    { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 1, shelfLocationLabel: 'KA1 — Kệ bánh kẹo', maHang: 'SP002', tenHang: 'Sữa tươi HCRC 1L', quantity: 8, expiryDate: '', note: '', createdAt: today, lastScannedAt: today }
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

    await shot(page, '#vanHanhShelfWrap', '01-doi-chieu-gop-trung-ma-hang.png');

    const result = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('#vhShelfReconBody tr').length,
      maHangList: Array.from(document.querySelectorAll('#vhShelfReconBody tr td:first-child')).map(td => td.textContent.trim()),
      sp002SystemStock: Array.from(document.querySelectorAll('#vhShelfReconBody tr')).find(tr => tr.children[0].textContent.trim() === 'SP002')?.children[2]?.textContent.trim(),
      // children[5] (không phải [4]) — 11/2026, bảng Đối Chiếu thêm cột "Trên Kệ Quá Khứ" ở vị trí [4]
      // giữa "Trên Kệ Hôm Nay" và "Kết Quả", đẩy "Kết Quả" từ cột thứ 5 (index 4) sang cột thứ 6 (index 5).
      sp002Result: Array.from(document.querySelectorAll('#vhShelfReconBody tr')).find(tr => tr.children[0].textContent.trim() === 'SP002')?.children[5]?.textContent.trim()
    }));
    console.log('Số dòng hiện trên màn Đối Chiếu:', result.rowCount);
    console.log('Mã hàng hiện ra:', result.maHangList);
    console.log('SP002 — Tồn Kho Hệ Thống (phải là 8, tổng 0+8):', result.sp002SystemStock);
    console.log('SP002 — Kết Quả (phải Khớp vì Trên Kệ Hôm Nay=8=Tổng tồn kho hệ thống):', result.sp002Result);

    assert.strictEqual(result.rowCount, 2, 'LỖI: phải chỉ còn 2 dòng (SP001 + SP002 gộp), không phải 3');
    assert.strictEqual(result.maHangList.filter(m => m === 'SP002').length, 1, 'LỖI: SP002 vẫn lặp lại nhiều dòng');
    assert.strictEqual(result.sp002SystemStock, '8', 'LỖI: Tồn Kho Hệ Thống của SP002 phải là tổng 0+8=8');
    assert.ok(result.sp002Result.includes('Khớp'), 'LỖI: phải Khớp (Trên Kệ Hôm Nay=8 = Tồn Kho Hệ Thống đã gộp=8)');

    console.log('\n✅ Demo xác nhận: mã hàng trùng (SP002, 2 dòng 0+8) đã được GỘP đúng thành 1 dòng, Tồn Kho Hệ Thống = 8, Kết Quả = Khớp.');
  } finally {
    await browser.close();
    server.close();
  }
})();
