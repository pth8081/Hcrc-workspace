// tests/test-stocktake-crossstore-scope-visibility.js — test Playwright THẬT cho câu hỏi người dùng:
// "khi họ được phân quyền siêu thị nào thì họ sẽ vào sẽ nhìn được siêu thị đấy, đúng không?" — xác nhận
// quyền kiemKeShelfLockManage (Tab 5 riêng) và kiemKeConfirmDo (Tab 6) theo phạm vi siêu thị KHÁC siêu thị
// của chính mình phải (a) thấy được ô chọn "📍 Siêu thị:" chuyển sang đúng siêu thị được gán, (b) THỰC SỰ
// nhận được dữ liệu quầy kệ/kiểm đếm/kiểm soát của siêu thị đó (KHÔNG rỗng — LỖI THẬT phát hiện: trước đó
// dữ liệu kiemKeShelfLocations/counts/confirmations CHỈ gửi cho admin/kiemKeUserAccessManage/đúng dept/
// allowlist Tab 8, hoàn toàn KHÔNG tính tới 2 quyền theo siêu thị này — quyền có mà màn hình trống trơn).
// Chạy: node tests/test-stocktake-crossstore-scope-visibility.js
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8947;
  const DEPT1 = 'Siêu thị Quận 1'; // nhà của cả 2 IT
  const DEPT2 = 'Siêu thị Quận 2'; // IT_LOCK được gán Khoá/Mở Khoá ở đây
  const DEPT3 = 'Siêu thị Quận 3'; // IT_CONFIRM được gán Xác Nhận ở đây
  const SHELF_B1 = { id: 50, dept: DEPT2, code: 'B1', name: 'Kệ B1 — Quận 2', active: true };
  const SHELF_C1 = { id: 60, dept: DEPT3, code: 'C1', name: 'Kệ C1 — Quận 3', active: true };
  const IT_LOCK = {
    username: 'it.lock', name: 'IT Khoá Quầy Kệ', dept: DEPT1,
    perms: { kiemKeShelfLockManage: { all: false, depts: [DEPT2] } },
    active: true, totpEnabled: true
  };
  const IT_CONFIRM = {
    username: 'it.confirm', name: 'IT Xác Nhận', dept: DEPT1,
    perms: { kiemKeConfirmDo: { all: false, depts: [DEPT3] } },
    active: true, totpEnabled: true
  };
  const activeDept3 = { id: 8001, dept: DEPT3, loaiKy: 'THONG_KE', tenKy: 'Kiểm Kê Q4/2026 - Quận 3', trangThai: 'DANG_HOAT_DONG' };
  const state = createMockState({
    depts: [DEPT1, DEPT2, DEPT3], stores: [DEPT1, DEPT2, DEPT3], users: [IT_LOCK, IT_CONFIRM],
    kiemKeShelfLocations: [SHELF_B1, SHELF_C1],
    stocktakeSessions: [activeDept3],
    stocktakeCounts: [
      { id: 1, sessionId: 8001, shelfLocationId: 60, maHang: 'SP001', slKiemDem: 5, dept: DEPT3, shelfLocationLabel: 'C1 — Kệ C1 — Quận 3' }
    ]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const KNOWN_HARNESS_NOISE = 'Mock chỉ hỗ trợ patch-mode';
  const jsErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().includes(KNOWN_HARNESS_NOISE)) return;
    jsErrors.push('[console.error] ' + msg.text());
  });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));
  page.on('dialog', (d) => d.accept().catch(() => {}));

  try {
    // ===== IT_LOCK: CHỈ có kiemKeShelfLockManage cho Quận 2 (không phải siêu thị của mình) =====
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, IT_LOCK);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await page.click('#btnKkSubShelfConfig');
    await page.waitForTimeout(200);

    await run.run('IT_LOCK thấy dropdown "Siêu thị:" ở Tab 5 với cả Quận 1 (nhà) lẫn Quận 2 (được gán Khoá/Mở Khoá)', async () => {
      const isSelect = await page.evaluate(() => !!document.getElementById('kkShelfConfigDeptInput'));
      assert(isSelect, 'Phải hiện ô chọn siêu thị (không phải text cố định)');
    });

    await run.run('Chuyển sang Quận 2 -> THẤY ĐƯỢC THẬT quầy kệ B1 (không rỗng dù không có allowlist Tab 8 nào)', async () => {
      await page.fill('#kkShelfConfigDeptInput', DEPT2);
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      assert(text.includes('B1'), `Phải thấy quầy kệ B1 của Quận 2, thực tế: ${text}`);
    });

    await run.run('IT_LOCK thấy khung Khoá/Mở Khoá cho quầy B1 (đúng phạm vi được gán) và khoá được thật', async () => {
      const hasLockUi = await page.evaluate(() => !!document.getElementById('kkShelfLockBulkBar'));
      assert(hasLockUi, 'Phải thấy khung Khoá/Mở Khoá Quầy Kệ (canManageStocktakeShelfLockForDeptClient đúng Quận 2)');
      await page.check('#kkShelfLockBulkBar input[type="checkbox"]');
      await page.waitForTimeout(100);
      await page.click('[data-op="bulkLockKkShelves"]');
      await page.waitForTimeout(250);
      const text = await page.evaluate(() => document.getElementById('kkShelfConfigListBody').textContent);
      assert(text.includes('Đang khoá') || text.includes('🔒'), `Quầy B1 phải chuyển sang Đang khoá, thực tế: ${text}`);
    });

    // ===== IT_CONFIRM: CHỈ có kiemKeConfirmDo cho Quận 3 (không phải siêu thị của mình) =====
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, IT_CONFIRM);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    await run.run('IT_CONFIRM thấy dropdown "Siêu thị:" ở Tab 1 (dùng chung biến) với Quận 3 được gán Xác Nhận', async () => {
      const options = await page.evaluate(() => (document.getElementById('kkPeriodDeptDropdown')._sddItems || []).map(it => it.label));
      assert(options.includes(DEPT3), `Phải có Quận 3 trong danh sách chọn, thực tế: ${options.join(',')}`);
      await page.fill('#kkPeriodDeptInput', DEPT3);
      await page.waitForTimeout(200);
    });

    await run.run('IT_CONFIRM vào Tab 6 Xác Nhận -> THẤY ĐƯỢC THẬT quầy kệ C1 đã Kiểm Đếm của Quận 3 (không rỗng)', async () => {
      await page.click('#btnKkSubConfirm');
      await page.waitForTimeout(300);
      const sessionLabel = await page.evaluate(() => document.getElementById('kkConfirmSessionInput').value);
      assert(sessionLabel && sessionLabel.includes('Kiểm Kê Q4/2026 - Quận 3'), `Phải tự chọn đúng kỳ Quận 3, thực tế: ${sessionLabel}`);
      const text = await page.evaluate(() => document.getElementById('kkConfirmShelfListBody').textContent);
      assert(text.includes('C1'), `Phải thấy quầy kệ C1 đã Kiểm Đếm của Quận 3, thực tế: ${text}`);
    });

    // Nút "Xác Nhận Toàn Bộ Đợt" (submitKkConfirmAll, route confirm-all) mới là hành động ĐÚNG phạm vi
    // quyền kiemKeConfirmDo (xem updateKkConfirmAllVisibility() — canConfirmStocktakeClient &&
    // canConfirmStocktakeForDeptClient), KHÁC HẲN nút "Xác Nhận" từng quầy kệ (chỉ gác bởi quyền Kiểm
    // Đếm/Kiểm Soát quầy đó — kiemKeKiemDemDo/kiemKeKiemSoatDo, không liên quan kiemKeConfirmDo).
    await run.run('IT_CONFIRM thấy khung "Xác Nhận Toàn Bộ Đợt" của Quận 3 (đúng phạm vi kiemKeConfirmDo được gán)', async () => {
      const hidden = await page.evaluate(() => document.getElementById('kkConfirmAllWrap').classList.contains('hidden'));
      assert(!hidden, 'Khung Xác Nhận Toàn Bộ Đợt phải HIỆN cho IT_CONFIRM (có kiemKeConfirmDo đúng phạm vi Quận 3)');
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
