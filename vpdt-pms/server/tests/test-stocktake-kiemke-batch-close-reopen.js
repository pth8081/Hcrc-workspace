// tests/test-stocktake-kiemke-batch-close-reopen.js — Playwright THẬT, VIẾT MỚI (12/2026, phản hồi TRỰC
// TIẾP người dùng: "tôi chốt không đóng kỳ riêng lẻ siêu thị mà đóng cả kỳ là đóng hết các st trong kỳ
// đó, ko có khái niệm đóng và mở từng siêu thị trong kỳ đó nhé" — mở rộng closeSessionBatch()/
// reopenSessionBatch() (lib/stocktakeEngine.js), CÙNG khuôn activateSessionBatch() đã có test riêng ở
// test-stocktake-kiemke-batch-activate-boundary.js).
//
// Kịch bản (đóng vai Admin thao tác THẬT qua UI):
//   1) Tạo kỳ "Gom Mã" riêng lẻ cho siêu thị X (batch KHÁC, tạo sớm hơn) — ranh giới KHÔNG được động tới.
//   2) Tạo kỳ "Kiểm Kê" CÙNG LÚC cho X, Y, Z (1 batch) rồi Kích Hoạt (đã có cascade từ trước).
//   3) Bấm "🔒 Đóng Kỳ" ở ĐÚNG 1 siêu thị (X) -> Y, Z cũng tự đóng theo — KHÔNG còn khái niệm đóng lẻ.
//   4) Gom Mã cũ của X (batch khác) KHÔNG bị đóng theo.
//   5) Bấm "↩️ Mở Lại" ở ĐÚNG 1 siêu thị (Y) -> X, Z cũng tự mở lại theo.
async function main() {
  const { createRunner, assert, assertEqual, startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8951;
  const X = 'CH Bến Thành';
  const Y = 'CH Tân Định';
  const Z = 'CH Đa Kao';
  const ADMIN = { username: 'admin.close', name: 'Admin Close', dept: 'HO', perms: { admin: true }, active: true, totpEnabled: true };

  const state = createMockState({ depts: [X, Y, Z, 'HO'], stores: [X, Y, Z], users: [ADMIN] });

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
  async function selectKkNewLoaiKy(label) {
    await page.click('#kkNewLoaiKyInput');
    await page.waitForTimeout(80);
    await page.click(`#kkNewLoaiKyDropdown div:text-is("${label}")`);
    await page.waitForTimeout(80);
  }
  function cardOpButton(storeFilterInput, tenKyText, op) {
    return page.evaluate(({ tenKyText, op }) => {
      const cards = Array.from(document.querySelectorAll('#kkPeriodListBody > div'));
      const card = cards.find(c => c.textContent.includes(tenKyText));
      const btn = card && card.querySelector(`button[data-op="${op}"]`);
      return btn ? btn.getAttribute('data-arg0') : null;
    }, { tenKyText, op });
  }

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);

    await run.run('Tạo kỳ Gom Mã riêng lẻ cho X (batch KHÁC, sớm hơn)', async () => {
      await page.fill('#kkPeriodDeptInput', X);
      await page.waitForTimeout(150);
      await openCreateBox();
      await selectKkNewLoaiKy('Loại: Gom Mã');
      await page.waitForTimeout(150);
      await page.fill('#kkNewTenKy', 'Gom Mã cũ - không thuộc batch');
      await addStoreToMultiSelect(X);
      await page.click('#btnSubmitKkPeriod');
      await page.waitForTimeout(300);
    });

    await run.run('Tạo + Kích Hoạt kỳ Kiểm Kê CÙNG LÚC cho X/Y/Z (1 batch)', async () => {
      await openCreateBox();
      await selectKkNewLoaiKy('Loại: Kiểm Kê');
      await page.waitForTimeout(200);
      await page.fill('#kkNewTenKy', 'Kiểm Kê Đợt Đóng Mở - 3 siêu thị');
      for (const s of [X, Y, Z]) await addStoreToMultiSelect(s);
      await page.click('#btnSubmitKkPeriod');
      await page.waitForTimeout(500);
      await page.fill('#kkPeriodDeptInput', X);
      await page.waitForTimeout(150);
      const btnArg = await cardOpButton(null, 'Kiểm Kê Đợt Đóng Mở', 'activateKkPeriod');
      assert(btnArg, 'Phải tìm thấy nút Kích Hoạt cho kỳ vừa tạo');
      await page.click(`button[data-op="activateKkPeriod"][data-arg0="${btnArg}"]`);
      await page.waitForTimeout(400);
      for (const s of [X, Y, Z]) {
        await page.fill('#kkPeriodDeptInput', s);
        await page.waitForTimeout(150);
        const text = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
        assert(text.includes('Kiểm Kê Đợt Đóng Mở') && text.includes('Đang hoạt động'), `Siêu thị ${s} phải Đang hoạt động sau Kích Hoạt, thực tế: ${text}`);
      }
    });

    await run.run('Bấm "🔒 Đóng Kỳ" ở ĐÚNG siêu thị X -> alert báo đóng thêm 2 siêu thị cùng kỳ', async () => {
      await page.fill('#kkPeriodDeptInput', X);
      await page.waitForTimeout(150);
      await page.evaluate(() => { window.__alerts = []; });
      const btnArg = await cardOpButton(null, 'Kiểm Kê Đợt Đóng Mở', 'closeKkPeriod');
      assert(btnArg, 'Phải tìm thấy nút "🔒 Đóng Kỳ" cho dòng X');
      await page.click(`button[data-op="closeKkPeriod"][data-arg0="${btnArg}"]`);
      await page.waitForTimeout(400);
      const alerts = await page.evaluate(() => window.__alerts || []);
      assert(alerts.some(a => a.includes('đóng thêm 2 siêu thị')), `Phải có alert báo đóng thêm 2 siêu thị cùng kỳ, thực tế: ${JSON.stringify(alerts)}`);
    });

    await run.run('CẢ 3 siêu thị X/Y/Z đều chuyển "Đã chốt" — không còn khái niệm đóng lẻ từng siêu thị', async () => {
      for (const s of [X, Y, Z]) {
        await page.fill('#kkPeriodDeptInput', s);
        await page.waitForTimeout(150);
        const text = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
        assert(text.includes('Kiểm Kê Đợt Đóng Mở') && text.includes('Đã chốt'), `Siêu thị ${s} phải Đã chốt sau khi đóng kỳ ở X, thực tế: ${text}`);
      }
    });

    await run.run('RANH GIỚI: Gom Mã cũ của X (batch KHÁC) KHÔNG bị đóng theo — vẫn Nháp', async () => {
      await page.fill('#kkPeriodDeptInput', X);
      await page.waitForTimeout(150);
      await page.click('#btnKkPeriodFilterGomMa');
      await page.waitForTimeout(150);
      const text = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
      assert(text.includes('Gom Mã cũ') && text.includes('Nháp') && !text.includes('Đã chốt'), `Kỳ Gom Mã cũ (batch khác) KHÔNG được bị đóng theo, thực tế: ${text}`);
      await page.click('#btnKkPeriodFilterAll');
    });

    await run.run('Bấm "↩️ Mở Lại" ở ĐÚNG siêu thị Y -> X, Z cũng tự mở lại theo', async () => {
      await page.fill('#kkPeriodDeptInput', Y);
      await page.waitForTimeout(150);
      await page.evaluate(() => { window.__alerts = []; });
      const btnArg = await cardOpButton(null, 'Kiểm Kê Đợt Đóng Mở', 'reopenKkPeriod');
      assert(btnArg, 'Phải tìm thấy nút "↩️ Mở Lại" cho dòng Y');
      await page.click(`button[data-op="reopenKkPeriod"][data-arg0="${btnArg}"]`);
      await page.waitForTimeout(400);
      const alerts = await page.evaluate(() => window.__alerts || []);
      assert(alerts.some(a => a.includes('mở lại thêm 2 siêu thị')), `Phải có alert báo mở lại thêm 2 siêu thị cùng kỳ, thực tế: ${JSON.stringify(alerts)}`);
      for (const s of [X, Y, Z]) {
        await page.fill('#kkPeriodDeptInput', s);
        await page.waitForTimeout(150);
        const text = await page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
        assert(text.includes('Kiểm Kê Đợt Đóng Mở') && text.includes('Đang hoạt động'), `Siêu thị ${s} phải Đang hoạt động trở lại sau khi Mở Lại ở Y, thực tế: ${text}`);
      }
    });

    assertEqual(jsErrors.length, 0, 'Không có lỗi JS/console nào phát sinh: ' + jsErrors.join('\n'));
    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
