// tests/test-stocktake-period-view-all-depts.js — Playwright THẬT, VIẾT MỚI (12/2026, phản hồi TRỰC TIẾP
// người dùng: "Tôi muốn chọn all siêu thị mục lúc để xóa và ko báo lỗi ntn, chọn all siêu thị đang có kỳ
// kiểm kê không phải vào từng siêu thị để chọn" — trước đó Tab 1 chỉ hiện đúng 1 siêu thị/lượt (ô "📍
// Siêu thị:"), bulk-select chỉ gộp được các dòng CỦA ĐÚNG siêu thị đang xem). Thêm "🌐 Xem Tất Cả Siêu
// Thị" (CHỈ Admin) — xem GET /sessions?scope=manage-all (routes/stocktake.js) +
// kkPeriodShowAllDepts/toggleKkPeriodShowAllDepts() (module-vanhanh.js).
//
// Kịch bản (đóng vai Admin thao tác THẬT qua UI):
//   1) Chưa bật "Xem Tất Cả": checkbox hiện (Admin, >1 siêu thị), danh sách chỉ hiện đúng 1 siêu thị.
//   2) Bật "Xem Tất Cả Siêu Thị" -> danh sách gộp CẢ 2 siêu thị, mỗi dòng tự nêu rõ tên siêu thị.
//   3) "Chọn tất cả đang hiện" (bulk bar) khi đang Xem Tất Cả -> chọn được dòng của CẢ 2 siêu thị cùng lúc.
//   4) Bấm "Xoá Các Kỳ Đã Chọn" -> xoá sạch ở CẢ 2 siêu thị trong 1 lượt (không cần đổi ô Siêu thị).
//   5) Người KHÔNG phải Admin (dù có kiemKePeriodManage) KHÔNG thấy checkbox "Xem Tất Cả Siêu Thị".
async function main() {
  const { createRunner, assert, assertEqual, startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8953;
  const DEPT1 = 'CH Toàn Bộ A';
  const DEPT2 = 'CH Toàn Bộ B';
  const ADMIN = { username: 'admin.viewall', name: 'Admin ViewAll', dept: 'HO', perms: { admin: true }, active: true, totpEnabled: true };
  const MANAGER = { username: 'ql.a', name: 'Quản Lý A', dept: DEPT1, perms: { kiemKePeriodManage: true }, active: true, totpEnabled: true };

  const state = createMockState({ depts: [DEPT1, DEPT2, 'HO'], stores: [DEPT1, DEPT2], users: [ADMIN, MANAGER] });

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

  async function selectDept(dept) {
    await page.fill('#kkPeriodDeptInput', dept);
    await page.waitForTimeout(150);
  }
  async function openCreateBox() {
    const boxHidden = await page.evaluate(() => document.getElementById('kkPeriodCreateBox').classList.contains('hidden'));
    if (boxHidden) await page.click('#btnKkPeriodOpenCreate');
    await page.waitForTimeout(100);
  }
  async function addStoreToMultiSelect(storeName) {
    await page.fill('#kkNewStoresMultiSelect [data-pms-search]', storeName);
    await page.waitForTimeout(80);
    await page.click(`#kkNewStoresMultiSelect [data-pms-dropdown] div:text-is("${storeName}")`);
    await page.waitForTimeout(80);
  }
  async function createSolo(dept, tenKy) {
    await openCreateBox();
    await page.fill('#kkNewTenKy', tenKy);
    await addStoreToMultiSelect(dept);
    await page.click('#btnSubmitKkPeriod');
    await page.waitForTimeout(250);
  }
  function listBodyText() {
    return page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
  }

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await selectDept(DEPT1);

    await run.run('Tạo kỳ Gom Mã riêng lẻ cho DEPT1 và DEPT2', async () => {
      await createSolo(DEPT1, 'Rác A1 - xem all');
      await selectDept(DEPT2);
      await createSolo(DEPT2, 'Rác B1 - xem all');
      let text = await listBodyText();
      assert(text.includes('Rác B1'), `DEPT2 phải thấy Rác B1, thực tế: ${text}`);
      await selectDept(DEPT1);
      text = await listBodyText();
      assert(text.includes('Rác A1') && !text.includes('Rác B1'), `Chưa bật Xem Tất Cả -> CHỈ thấy đúng DEPT1, thực tế: ${text}`);
    });

    await run.run('Admin: checkbox "🌐 Xem Tất Cả Siêu Thị" hiện (> 1 siêu thị)', async () => {
      const visible = await page.isVisible('input[data-op-change="toggleKkPeriodShowAllDepts"]');
      assert(visible, 'Checkbox Xem Tất Cả phải hiện cho Admin khi có > 1 siêu thị');
    });

    await run.run('Bật "Xem Tất Cả Siêu Thị" -> gộp CẢ DEPT1 lẫn DEPT2, mỗi dòng nêu rõ tên siêu thị', async () => {
      await page.click('input[data-op-change="toggleKkPeriodShowAllDepts"]');
      await page.waitForTimeout(300);
      const text = await listBodyText();
      assert(text.includes('Rác A1') && text.includes('Rác B1'), `Phải gộp cả 2 siêu thị, thực tế: ${text}`);
      assert(text.includes(DEPT1) && text.includes(DEPT2), `Mỗi dòng phải nêu rõ tên siêu thị, thực tế: ${text}`);
    });

    await run.run('"Chọn tất cả đang hiện" -> chọn được dòng của CẢ 2 siêu thị cùng lúc', async () => {
      await page.click('#kkPeriodBulkBar input[data-op-change="toggleKkPeriodBulkSelectAll"]');
      await page.waitForTimeout(80);
      const barText = await page.evaluate(() => document.querySelector('#kkPeriodBulkBar [data-role="count"]')?.textContent || '');
      assertEqual(barText, 'Đã chọn 2 kỳ', `Phải chọn đủ 2 kỳ (2 siêu thị khác nhau), thực tế: "${barText}"`);
    });

    await run.run('Bấm "Xoá Các Kỳ Đã Chọn" -> xoá sạch ở CẢ 2 siêu thị trong 1 lượt, không cần đổi ô Siêu thị', async () => {
      await page.evaluate(() => { window.__alerts = []; });
      await page.click('#kkPeriodBulkBar button[data-bulk-btn]');
      await page.waitForTimeout(400);
      const text = await listBodyText();
      assert(!text.includes('Rác A1') && !text.includes('Rác B1'), `Phải xoá sạch cả 2 kỳ ở 2 siêu thị, thực tế: ${text}`);
      const alerts = await page.evaluate(() => window.__alerts || []);
      assert(alerts.some(a => a.includes('Đã xoá 2/2 kỳ đã chọn')), `Phải xác nhận đã xoá 2/2, thực tế: ${JSON.stringify(alerts)}`);
    });

    // Chuyển sang quản lý KHÔNG phải Admin (có kiemKePeriodManage — vẫn quản lý được kỳ CỦA MÌNH).
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, MANAGER);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await run.run('Người KHÔNG phải Admin (dù có kiemKePeriodManage) KHÔNG thấy checkbox "Xem Tất Cả Siêu Thị"', async () => {
      const count = await page.evaluate(() => document.querySelectorAll('input[data-op-change="toggleKkPeriodShowAllDepts"]').length);
      assertEqual(count, 0, 'KHÔNG được có checkbox Xem Tất Cả cho người không phải Admin');
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
