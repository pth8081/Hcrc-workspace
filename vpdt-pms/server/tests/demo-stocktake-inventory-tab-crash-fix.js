// tests/demo-stocktake-inventory-tab-crash-fix.js — DEMO ảnh thật (Playwright), theo phản hồi TRỰC TIẾP
// người dùng kèm ảnh chụp "Aw, Snap!" (trình duyệt mobile SẬP HẲN tiến trình kết xuất khi mở tab "📦 Tồn
// Kho" ở Kiểm Kê, chọn "Tất cả" 35 siêu thị). Nguyên nhân thật: màn này TRƯỚC ĐÂY dựng bảng chi tiết
// TỪNG DÒNG tồn kho (Mã Hàng/Mã Vạch/Tên Hàng/Tồn Kho) cho MỖI siêu thị — nhiều siêu thị × hàng trăm-
// nghìn dòng/siêu thị = tổng DOM quá lớn, đủ để trình duyệt (nhất là di động, ít bộ nhớ hơn) crash hẳn dù
// đã dựng RẢI RA theo requestAnimationFrame (bản vá trước chỉ giải quyết "luồng chính bị chặn", không
// giải quyết "tổng bộ nhớ DOM quá lớn"). Vá triệt để theo đúng đề xuất người dùng: CHỈ hiện SỐ LƯỢNG mã
// hàng đã đồng bộ/siêu thị (không dựng bảng chi tiết nữa) — dữ liệu chi tiết xem qua nút MỚI "📥 Xuất
// Excel" (exportKkInventoryExcel(), module-vanhanh.js — mỗi siêu thị 1 sheet, dùng CHUNG
// downloadMultiSheetXlsxFromServer()).
//
// Chạy: node server/tests/demo-stocktake-inventory-tab-crash-fix.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8992;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'stocktake-inventory-tab-crash-fix');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, totpEnabled: true };
  // Mô phỏng quy mô THẬT gây crash — nhiều siêu thị (35, đúng số siêu thị người dùng báo cáo), MỖI siêu
  // thị có hàng nghìn dòng tồn kho (trước đây MỖI dòng này sẽ sinh ra 1 hàng <tr> trong DOM, tổng tới
  // hàng chục nghìn hàng — nay chỉ còn đúng 1 dòng tóm tắt/siêu thị).
  const ROWS_PER_STORE = 2000;
  const depts = Array.from({ length: 35 }, (_, i) => `Siêu Thị ${String(i + 1).padStart(2, '0')}`);
  const byDept = {};
  depts.forEach((dept, di) => {
    byDept[dept] = {
      rows: Array.from({ length: ROWS_PER_STORE }, (_, i) => ({
        maHang: `SP${String(di).padStart(2, '0')}${String(i).padStart(4, '0')}`,
        maVach: `893${String(di).padStart(2, '0')}${String(i).padStart(8, '0')}`,
        tenHang: `Sản phẩm demo ${di}-${i}`,
        soLuongTon: (i % 50) + 1
      })),
      fetchedAt: new Date().toISOString()
    };
  });
  const state = createMockState({ depts: ['Ban Giám Đốc'], stores: depts, users: [ADMIN] });
  state.__mockKkInventoryByDept = byDept;

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 420, height: 900 }); // viewport nhỏ — mô phỏng điện thoại
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('404') && !msg.text().includes('Mock chỉ hỗ trợ patch-mode')) jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await page.click('#btnKkSubInventory');
    await page.waitForTimeout(150);
    await page.click('#btnKkInventorySync');
    await page.waitForTimeout(600);

    const domRowCount = await page.evaluate(() => document.querySelectorAll('#kkInventoryStoresBody table tr').length);
    assert.strictEqual(domRowCount, 0, `KHÔNG được còn bất kỳ <table> chi tiết nào trong DOM (trước đây sẽ có tới ${35 * ROWS_PER_STORE} hàng) — thực tế: ${domRowCount}`);
    const cardCount = await page.evaluate(() => document.querySelectorAll('#kkInventoryStoresBody > div').length);
    assert.strictEqual(cardCount, 35, `Phải có đúng 35 thẻ tóm tắt (1/siêu thị), thực tế: ${cardCount}`);
    console.log(`\n✅ 35 siêu thị × ${ROWS_PER_STORE} dòng/siêu thị (tổng ${35 * ROWS_PER_STORE} dòng dữ liệu) — DOM chỉ còn ${cardCount} thẻ tóm tắt, KHÔNG còn 1 hàng <tr> chi tiết nào.`);

    await page.screenshot({ path: path.join(OUT_DIR, '1-ton-kho-35-sieu-thi-chi-hien-so-luong.png'), fullPage: false });
    console.log('📸 1-ton-kho-35-sieu-thi-chi-hien-so-luong.png');

    await page.evaluate(() => document.getElementById('kkInventoryStoresBody').scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(OUT_DIR, '2-cuon-xuong-thay-tung-the-sieu-thi.png'), fullPage: false });
    console.log('📸 2-cuon-xuong-thay-tung-the-sieu-thi.png');

    // "📥 Xuất Excel" (12/2026, SỬA LỖI THẬT PRODUCTION "Failed to fetch" khi xuất với quy mô thật —
    // xem routes/stocktake.js GET /system-inventory/export-xlsx) — không còn đóng gói payload JSON ở
    // trình duyệt nữa, chỉ cần gọi ĐÚNG route GET mới qua downloadFileFromServerGet(); server tự dựng
    // file .xlsx từ dữ liệu đã có sẵn trong CSDL, xác nhận route thật ở tests/test-stocktake-system-
    // inventory-tab.js (parse lại file .xlsx bằng ExcelJS) — ở demo này chỉ cần xác nhận ĐÚNG hàm/route
    // được gọi, không crash DOM dù dữ liệu quy mô 35 siêu thị × 2000 dòng.
    const captured = await page.evaluate(() => {
      const orig = window.downloadFileFromServerGet;
      let out = null;
      window.downloadFileFromServerGet = (url, fallbackName) => { out = { url, fallbackName }; };
      exportKkInventoryExcel();
      window.downloadFileFromServerGet = orig;
      return out;
    });
    assert.strictEqual(captured.url, '/api/stocktake/system-inventory/export-xlsx', 'Xuất Excel phải gọi đúng route export-xlsx mới');
    console.log(`✅ "📥 Xuất Excel" gọi đúng route server-side mới (${captured.url}) — không còn đóng gói payload JSON khổng lồ ở trình duyệt, không còn rủi ro "Failed to fetch" với dữ liệu quy mô thật (35 siêu thị × ${ROWS_PER_STORE} dòng/siêu thị).`);

    await page.evaluate(() => document.getElementById('btnKkInventoryExport').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(OUT_DIR, '3-nut-xuat-excel.png'), fullPage: false });
    console.log('📸 3-nut-xuat-excel.png');

    assert.strictEqual(jsErrors.length, 0, 'Lỗi JS: ' + jsErrors.join(' | '));
    console.log('\n✅ Demo hoàn tất — không còn crash, ảnh lưu tại: ' + OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
