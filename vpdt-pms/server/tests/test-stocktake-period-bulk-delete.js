// tests/test-stocktake-period-bulk-delete.js — Playwright THẬT, VIẾT MỚI (12/2026, phản hồi TRỰC TIẾP
// người dùng kèm ảnh chụp 2 kỳ Nháp (1 Gom Mã + 1 Kiểm Kê) CÙNG 1 siêu thị, tạo RIÊNG LẺ trước đây (không
// chung batchId): "Sao tôi vẫn phải xóa thủ công từng kỳ kiểm kê, gom mã, làm cách nào tôi xóa hết...").
// Cascade theo batchId (kkPeriodActionWithSiblings) KHÔNG giúp được các kỳ này vì chúng chưa từng thuộc
// nhóm nào (khác loại kỳ, không chung batch) — cần chọn NHIỀU dòng bất kỳ ĐANG HIỆN (1 siêu thị/1 lượt —
// Tab 1 vốn đã scope theo ĐÚNG 1 siêu thị đang chọn ở ô "📍 Siêu thị:", xem kkPeriodDeptSelected) rồi xoá
// 1 lần, xem toggleKkPeriodBulkSelect()/deleteSelectedKkPeriods() (module-vanhanh.js).
//
// Kịch bản (đóng vai Admin thao tác THẬT qua UI):
//   1) Siêu thị A: tạo 1 kỳ Gom Mã + 1 kỳ Kiểm Kê RIÊNG LẺ (không chung batchId, khác loại kỳ).
//   2) Checkbox CHỈ hiện ở dòng Nháp (được phép xoá).
//   3) Tick CẢ 2 dòng của A ("Chọn tất cả đang hiện") -> xoá 1 lần -> cả 2 bị xoá.
//   4) Siêu thị D: tạo 1 batch Kiểm Kê (D+E cùng lúc) — tick CHỈ dòng D rồi xoá -> E (không hề hiện trong
//      danh sách đang xem vì D/E KHÁC siêu thị) vẫn bị xoá theo qua cascade batchId, alert nêu rõ.
async function main() {
  const { createRunner, assert, assertEqual, startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8952;
  const A = 'CH Rác A';
  const D = 'CH Batch D';
  const E = 'CH Batch E';
  const ADMIN = { username: 'admin.bulk', name: 'Admin Bulk', dept: 'HO', perms: { admin: true }, active: true, totpEnabled: true };

  const state = createMockState({ depts: [A, D, E, 'HO'], stores: [A, D, E], users: [ADMIN] });

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
  async function selectKkNewLoaiKy(label) {
    await page.click('#kkNewLoaiKyInput');
    await page.waitForTimeout(80);
    await page.click(`#kkNewLoaiKyDropdown div:text-is("${label}")`);
    await page.waitForTimeout(80);
  }
  async function createSolo(dept, tenKy, loaiKyLabel) {
    await openCreateBox();
    if (loaiKyLabel) await selectKkNewLoaiKy(loaiKyLabel);
    await page.fill('#kkNewTenKy', tenKy);
    await addStoreToMultiSelect(dept);
    await page.click('#btnSubmitKkPeriod');
    await page.waitForTimeout(300);
  }
  function cardCheckboxId(tenKyText) {
    return page.evaluate((tenKyText) => {
      const cards = Array.from(document.querySelectorAll('#kkPeriodListBody > div'));
      const card = cards.find(c => c.textContent.includes(tenKyText));
      const cb = card && card.querySelector('input[data-kk-period-id]');
      return cb ? cb.getAttribute('data-kk-period-id') : null;
    }, tenKyText);
  }
  function cardHasCheckbox(tenKyText) {
    return page.evaluate((tenKyText) => {
      const cards = Array.from(document.querySelectorAll('#kkPeriodListBody > div'));
      const card = cards.find(c => c.textContent.includes(tenKyText));
      return !!(card && card.querySelector('input[data-kk-period-id]'));
    }, tenKyText);
  }
  function listBodyText() {
    return page.evaluate(() => document.getElementById('kkPeriodListBody').textContent);
  }

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => switchTab('kiemKe'));
    await page.waitForTimeout(150);
    await selectDept(A);

    await run.run('Siêu thị A: tạo 1 kỳ Gom Mã + 1 kỳ Kiểm Kê RIÊNG LẺ (khác loại kỳ, không chung batchId)', async () => {
      await createSolo(A, 'Rác Gom Mã - xoá sau', null); // mặc định "Loại: Gom Mã" khi mở khung
      await createSolo(A, 'Rác Kiểm Kê - xoá sau', 'Loại: Kiểm Kê');
      const text = await listBodyText();
      assert(text.includes('Rác Gom Mã') && text.includes('Rác Kiểm Kê'), `Phải thấy cả 2 kỳ vừa tạo, thực tế: ${text}`);
    });

    await run.run('Checkbox xoá hàng loạt CHỈ hiện ở dòng Nháp (được phép xoá)', async () => {
      const hasGomMa = await cardHasCheckbox('Rác Gom Mã');
      const hasKiemKe = await cardHasCheckbox('Rác Kiểm Kê');
      assert(hasGomMa && hasKiemKe, 'Cả 2 dòng Nháp phải có checkbox');
    });

    await run.run('"Chọn tất cả đang hiện" -> thanh "Đã chọn 2 kỳ" hiện đúng', async () => {
      await page.click('#kkPeriodBulkBar input[data-op-change="toggleKkPeriodBulkSelectAll"]');
      await page.waitForTimeout(80);
      const barText = await page.evaluate(() => document.querySelector('#kkPeriodBulkBar [data-role="count"]')?.textContent || '');
      assertEqual(barText, 'Đã chọn 2 kỳ', `Thanh xoá hàng loạt phải hiện đúng số đã chọn, thực tế: "${barText}"`);
    });

    await run.run('Bấm "Xoá Các Kỳ Đã Chọn" -> cả 2 kỳ của A bị xoá 1 lần', async () => {
      await page.evaluate(() => { window.__alerts = []; });
      await page.click('#kkPeriodBulkBar button[data-bulk-btn]');
      await page.waitForTimeout(400);
      const text = await listBodyText();
      assert(!text.includes('Rác Gom Mã') && !text.includes('Rác Kiểm Kê'), `Cả 2 kỳ phải đã bị xoá, thực tế: ${text}`);
      const alerts = await page.evaluate(() => window.__alerts || []);
      assert(alerts.some(a => a.includes('Đã xoá 2/2 kỳ đã chọn')), `Phải có alert xác nhận đã xoá 2/2, thực tế: ${JSON.stringify(alerts)}`);
    });

    await selectDept(D);
    await run.run('Siêu thị D: tạo 1 batch Kiểm Kê (D+E cùng lúc, còn Nháp)', async () => {
      await openCreateBox();
      await selectKkNewLoaiKy('Loại: Kiểm Kê');
      await page.waitForTimeout(150);
      await page.fill('#kkNewTenKy', 'Batch D-E - xoá theo nhóm');
      for (const s of [D, E]) await addStoreToMultiSelect(s);
      await page.click('#btnSubmitKkPeriod');
      await page.waitForTimeout(300);
      const text = await listBodyText();
      assert(text.includes('Batch D-E') && text.includes('Tạo cùng đợt với 1 siêu thị khác'), `Phải thấy batch D-E vừa tạo, thực tế: ${text}`);
    });

    await run.run('Tick riêng dòng D (KHÔNG hề thấy E trong danh sách đang xem) rồi xoá -> E vẫn bị xoá theo qua cascade batchId', async () => {
      const idD = await cardCheckboxId('Batch D-E');
      assert(idD, 'Phải tìm được checkbox của dòng D');
      await page.click(`input[data-kk-period-id="${idD}"]`);
      await page.waitForTimeout(80);
      await page.evaluate(() => { window.__alerts = []; });
      await page.click('#kkPeriodBulkBar button[data-bulk-btn]');
      await page.waitForTimeout(400);
      const text = await listBodyText();
      assert(!text.includes('Batch D-E'), `Dòng D phải đã bị xoá, thực tế: ${text}`);
      const alerts = await page.evaluate(() => window.__alerts || []);
      assert(alerts.some(a => a.includes('Đã xoá 1/1 kỳ đã chọn') && a.includes('kỳ "anh em" cùng đợt bị xoá theo')),
        `Phải nêu rõ có 1 kỳ anh em (E) bị xoá theo cascade dù không hề tick, thực tế: ${JSON.stringify(alerts)}`);
    });

    await selectDept(E);
    await run.run('Siêu thị E: kỳ "anh em" (không hề tick) cũng đã biến mất khỏi danh sách thật', async () => {
      const text = await listBodyText();
      assert(!text.includes('Batch D-E'), `Siêu thị E cũng phải không còn kỳ Batch D-E (đã xoá theo cascade), thực tế: ${text}`);
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
