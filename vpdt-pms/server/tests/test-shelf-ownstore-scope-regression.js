// server/tests/test-shelf-ownstore-scope-regression.js
//
// LỖI ĐÃ VÁ (11/2026, báo cáo người dùng kèm ảnh: "nếu khi tôi đăng nhập mà tôi đổi siêu thị ấy, thì sẽ
// không được nhìn thấy cái thông tin mà tôi đứng ở siêu thị khác... Hiện tại là nó vẫn có thông tin nếu
// mà tôi chuyển sang siêu thị khác. Cái này là bug"):
//
// 4 tab thao tác hằng ngày trong "📋 Kiểm Soát Hàng Hóa" — "📷 Ghi Nhận" (cả ô chọn Quầy Kệ lẫn bảng "20
// ghi nhận gần nhất"), "🗄️ Quầy Kệ", "⏰ Hạn Sử Dụng", "🔔 Ngưỡng Tồn" — trước đây lấy THẲNG
// DB.shelfLocations/shelfRecords/shelfStockThresholds không lọc lại theo currentUser.dept. Dữ liệu client
// (DB.*) có thể chứa NHIỀU siêu thị cùng lúc nếu server gửi về nhiều siêu thị (tài khoản có quyền
// shelfReportView nhiều siêu thị hoặc admin — filterShelfRecordsForUser(), lib/recordViewScope.js, phục
// vụ tab "📊 Đối Chiếu"/"📑 Báo Cáo") — 4 tab trên vô tình lộ HẾT dữ liệu nhiều siêu thị đó ra dù tiêu đề
// vẫn ghi đúng tên 1 siêu thị.
//
// Đã vá bằng shelfItemsForOwnStore() (module-vanhanh.js) — lọc lại CHẶT CHẼ theo currentUser.dept ở
// CẢ 6 điểm đọc: effectiveShelfLocations() (ô chọn Quầy Kệ ở Ghi Nhận), renderShelfRecordRecentList(),
// renderShelfLocationsList(), exportShelfLocationsExcel(), renderShelfExpiryGroups() (2 nhánh),
// renderShelfStockThresholdsList().
//
// Test này mô phỏng ĐÚNG kịch bản người dùng báo cáo: dữ liệu client có CẢ 2 siêu thị (A = siêu thị đang
// đứng, B = siêu thị khác) — xác nhận cả 4 tab chỉ hiện ĐÚNG Siêu Thị A, và tab "📑 Báo Cáo" (KHÔNG đổi,
// cố ý cho xem nhiều siêu thị) vẫn hiện ĐỦ CẢ 2 để xác nhận không bị vá quá tay.
//
// Chạy: node server/tests/test-shelf-ownstore-scope-regression.js
'use strict';
const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8995;
  const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'shelf-ownstore-scope');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Tài khoản có quyền quản lý Kiểm Soát Hàng Hóa (Cửa Hàng Trưởng Siêu Thị A) — dept = Siêu Thị A, data
  // client (DB.*) lại chứa CẢ Siêu Thị B (mô phỏng đúng tình huống thật: server gửi nhiều siêu thị vì tài
  // khoản có thêm quyền báo cáo/admin — mock testHarness.js KHÔNG tự lọc shelfRecords theo viewer nên
  // luôn mô phỏng đúng trạng thái "client có nhiều siêu thị" này).
  const USER = {
    username: 'cht_a', name: 'Chủ Cửa Hàng A', dept: 'Siêu Thị A',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true, shelfReportView: { all: true } },
    active: true, totpEnabled: true
  };
  const today = new Date();
  const state = createMockState({ depts: [], stores: ['Siêu Thị A', 'Siêu Thị B'], users: [USER] });
  state.shelfLocations = [
    { id: 1, dept: 'Siêu Thị A', code: 'QA1', name: 'Quầy A1 — Siêu Thị A', category: 'Đồ uống', active: true },
    { id: 2, dept: 'Siêu Thị B', code: 'QB1', name: 'Quầy B1 — Siêu Thị B', category: 'Bánh kẹo', active: true }
  ];
  state.shelfRecords = [
    { id: 1, dept: 'Siêu Thị A', shelfLocationId: 1, shelfLocationCode: 'QA1', shelfLocationName: 'Quầy A1 — Siêu Thị A', maHang: 'SP_A', maVach: '', productName: 'Sản Phẩm Siêu Thị A', quantity: 10, expiryDate: today.toISOString(), note: '', createdAt: today.toISOString(), lastScannedAt: today.toISOString() },
    { id: 2, dept: 'Siêu Thị B', shelfLocationId: 2, shelfLocationCode: 'QB1', shelfLocationName: 'Quầy B1 — Siêu Thị B', maHang: 'SP_B', maVach: '', productName: 'Sản Phẩm Siêu Thị B', quantity: 20, expiryDate: today.toISOString(), note: '', createdAt: today.toISOString(), lastScannedAt: today.toISOString() }
  ];
  state.shelfStockThresholds = [
    { id: 1, dept: 'Siêu Thị A', maHang: 'SP_A', maVach: '', category: '', minQuantity: 5, extraRecipientUsernames: [], active: true },
    { id: 2, dept: 'Siêu Thị B', maHang: 'SP_B', maVach: '', category: '', minQuantity: 5, extraRecipientUsernames: [], active: true }
  ];

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + err.message));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.waitForTimeout(150);

    await run.run('Xác nhận dữ liệu client THỰC SỰ có cả 2 siêu thị (mô phỏng đúng tình huống báo cáo)', async () => {
      const depts = await page.evaluate(() => [...new Set((DB.shelfRecords || []).map(r => r.dept))].sort());
      assertEqual(JSON.stringify(depts), JSON.stringify(['Siêu Thị A', 'Siêu Thị B']), 'DB.shelfRecords phải có cả 2 siêu thị để test có ý nghĩa');
    });

    // ===== 1) 📷 Ghi Nhận — ô chọn Quầy Kệ (effectiveShelfLocations()) =====
    await run.run('Ghi Nhận: ô chọn Quầy Kệ (effectiveShelfLocations()) CHỈ có QA1, KHÔNG có QB1', async () => {
      const codes = await page.evaluate(() => effectiveShelfLocations().map(s => s.code).sort());
      assertEqual(JSON.stringify(codes), JSON.stringify(['QA1']), `Chỉ được thấy QA1, thực tế: ${JSON.stringify(codes)}`);
    });
    await page.locator('#vanHanhShelfWrap').screenshot({ path: path.join(OUT_DIR, '01-ghi-nhan-form.png') });

    // ===== 2) 📷 Ghi Nhận — "20 ghi nhận gần nhất" (renderShelfRecordRecentList()) =====
    await run.run('Ghi Nhận: "20 ghi nhận gần nhất" CHỈ hiện SP_A, KHÔNG hiện SP_B', async () => {
      const text = await page.locator('#vhShelfRecordRecentBody').textContent();
      assert(text.includes('SP_A'), 'Phải thấy SP_A (của đúng Siêu Thị A)');
      assert(!text.includes('SP_B'), `KHÔNG được thấy SP_B (của Siêu Thị B) — nội dung bảng: ${text}`);
    });

    // ===== 3) 🗄️ Quầy Kệ — renderShelfLocationsList() =====
    await page.click('#btnVhShelfSubLocations');
    await page.waitForTimeout(150);
    await run.run('Quầy Kệ: bảng danh mục CHỈ hiện QA1, KHÔNG hiện QB1', async () => {
      const text = await page.locator('#vhShelfLocationsBody').textContent();
      assert(text.includes('QA1'), 'Phải thấy QA1');
      assert(!text.includes('QB1'), `KHÔNG được thấy QB1 — nội dung bảng: ${text}`);
    });
    await page.locator('#vanHanhShelfWrap').screenshot({ path: path.join(OUT_DIR, '02-quay-ke.png') });

    // ===== 4) ⏰ Hạn Sử Dụng — renderShelfExpiryGroups() =====
    await page.click('#btnVhShelfSubExpiry');
    await page.waitForTimeout(150);
    await run.run('Hạn Sử Dụng: bảng CHỈ hiện SP_A, KHÔNG hiện SP_B', async () => {
      const text = await page.locator('#vhShelfExpiryBody').textContent();
      assert(text.includes('SP_A') || text.includes('Sản Phẩm Siêu Thị A'), 'Phải thấy sản phẩm Siêu Thị A');
      assert(!text.includes('SP_B') && !text.includes('Sản Phẩm Siêu Thị B'), `KHÔNG được thấy sản phẩm Siêu Thị B — nội dung bảng: ${text}`);
    });
    await page.locator('#vanHanhShelfWrap').screenshot({ path: path.join(OUT_DIR, '03-han-su-dung.png') });

    // ===== 5) 🔔 Ngưỡng Tồn — renderShelfStockThresholdsList() =====
    await page.click('#btnVhShelfSubThreshold');
    await page.waitForTimeout(150);
    await run.run('Ngưỡng Tồn: bảng CHỈ hiện ngưỡng SP_A, KHÔNG hiện ngưỡng SP_B', async () => {
      const text = await page.locator('#vhShelfThresholdBody').textContent();
      assert(text.includes('SP_A'), 'Phải thấy ngưỡng SP_A');
      assert(!text.includes('SP_B'), `KHÔNG được thấy ngưỡng SP_B — nội dung bảng: ${text}`);
    });
    await page.locator('#vanHanhShelfWrap').screenshot({ path: path.join(OUT_DIR, '04-nguong-ton.png') });

    // ===== 6) 📑 Báo Cáo — PHẢI vẫn hiện ĐỦ CẢ 2 siêu thị (tab này CỐ Ý cho xem nhiều siêu thị, KHÔNG
    // bị đụng tới bởi lần vá này — sanity check chống vá quá tay) =====
    await page.click('#btnVhShelfSubReport');
    await page.waitForTimeout(300);
    await run.run('Báo Cáo: KHÔNG bị ảnh hưởng — vẫn hiện ĐỦ CẢ SP_A lẫn SP_B (tab này cố ý đa siêu thị)', async () => {
      const text = await page.locator('#vanHanhShelfReportWrap').textContent();
      assert(text.includes('SP_A'), 'Báo Cáo vẫn phải thấy SP_A');
      assert(text.includes('SP_B'), 'Báo Cáo vẫn phải thấy SP_B — KHÔNG được bị vá nhầm sang tab này');
    });
    await page.locator('#vanHanhShelfWrap').screenshot({ path: path.join(OUT_DIR, '05-bao-cao-van-du-2-sieu-thi.png') });

    await run.run('Không có lỗi JS (console.error/pageerror) nào phát sinh trong suốt bài test', () => {
      assertEqual(jsErrors.length, 0, `Có lỗi JS: ${jsErrors.join(' | ')}`);
    });
  } finally {
    await browser.close();
    server.close();
  }
  run.summary();
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
