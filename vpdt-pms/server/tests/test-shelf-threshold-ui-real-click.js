// tests/test-shelf-threshold-ui-real-click.js — "🔔 Ngưỡng Tồn" (Kiểm Soát Hàng Hóa), THIẾT KẾ LẠI
// 11/2026: test UI THẬT bằng Playwright page.click()/page.fill() (không page.evaluate() gọi hàm trực
// tiếp — cùng nguyên tắc đã rút ra từ bug kẹt sub-tab v28.48, xem tests/test-shelf-subtab-real-click.js)
// cho: (1) form tạo mới chỉ còn 3 ô nhận diện tuỳ chọn (Mã Hàng/Mã Vạch/Ngành Hàng, KHÔNG còn dropdown
// "Phạm Vi"), (2) picker "Tự thêm người nhận" (renderPeopleMultiSelect) CHỈ liệt kê nhân viên ĐÚNG siêu
// thị người dùng đang đăng nhập, (3) submit THẬT qua nút bấm -> đi qua ĐÚNG đường
// POST /api/create/shelfStockThresholds (lib/createValidation.js thật, qua testHarness dispatch) và
// re-render đúng danh sách.
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const { startStaticServer, createMockState, launchPage } = require('./testHarness');
  const PORT = 8979;
  const USER = {
    username: 'cht1', name: 'Cửa Hàng Trưởng Q1', dept: 'Siêu thị Quận 1',
    perms: { vanHanhShelfTab: true, shelfRecordCreate: true, shelfLocationManage: true }, active: true, totpEnabled: true, email: 'cht1@hcrc.vn'
  };
  const COLLEAGUE = { username: 'nv2', name: 'Nhân Viên 2', dept: 'Siêu thị Quận 1', active: true, email: 'nv2@hcrc.vn', perms: {} };
  const OTHER_DEPT = { username: 'cht7', name: 'Cửa Hàng Trưởng Q7', dept: 'Siêu thị Quận 7', active: true, email: 'cht7@hcrc.vn', perms: { shelfLocationManage: true } };
  const state = createMockState({ depts: ['Siêu thị Quận 1', 'Siêu thị Quận 7'], users: [USER, COLLEAGUE, OTHER_DEPT], shelfStockThresholds: [] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push('[console.error] ' + msg.text()); });
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, USER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="SHELF"]');
    await page.click('#btnVhShelfSubThreshold');
    await page.waitForTimeout(50);

    await run.run('Form chỉ còn 3 ô nhận diện tuỳ chọn (Mã Hàng/Mã Vạch/Ngành Hàng), KHÔNG còn dropdown "Phạm Vi" cũ', async () => {
      const present = await page.evaluate(() => ({
        maHang: !!document.getElementById('stMaHang'),
        maVach: !!document.getElementById('stMaVach'),
        category: !!document.getElementById('stCategory'),
        minQuantity: !!document.getElementById('stMinQuantity'),
        oldScope: !!document.getElementById('stScope'),
        oldScopeValue: !!document.getElementById('stScopeValue'),
        oldRecipientEmails: !!document.getElementById('stRecipientEmails')
      }));
      assert(present.maHang && present.maVach && present.category && present.minQuantity, `thiếu ô mới, thực tế: ${JSON.stringify(present)}`);
      assert(!present.oldScope && !present.oldScopeValue && !present.oldRecipientEmails, `ô cũ phải bị gỡ hẳn, thực tế: ${JSON.stringify(present)}`);
    });

    await run.run('Picker "Tự thêm người nhận" CHỈ liệt kê nhân viên ĐÚNG siêu thị đăng nhập (gõ "nv" phải thấy nv2, KHÔNG thấy cht7)', async () => {
      await page.fill('#stExtraRecipientsPicker [data-pms-search]', 'nv');
      await page.waitForTimeout(30);
      const dropdownText = await page.evaluate(() => document.querySelector('#stExtraRecipientsPicker [data-pms-dropdown]').textContent);
      assert(dropdownText.includes('nv2'), `phải thấy nv2 (cùng siêu thị), thực tế: ${dropdownText}`);
      assert(!dropdownText.includes('cht7'), `KHÔNG được thấy cht7 (siêu thị khác), thực tế: ${dropdownText}`);
    });

    await run.run('Click chọn nv2 từ dropdown -> hiện chip đã chọn', async () => {
      await page.click('#stExtraRecipientsPicker [data-pms-dropdown] [data-op="pmsAdd"]');
      await page.waitForTimeout(30);
      const chipsText = await page.evaluate(() => document.querySelector('#stExtraRecipientsPicker [data-pms-chips]').textContent);
      assert(chipsText.includes('nv2'), `phải hiện chip nv2 đã chọn, thực tế: ${chipsText}`);
    });

    await run.run('Điền Mã Hàng + Ngưỡng, bấm nút "➕ Thêm Ngưỡng" THẬT -> tạo qua ĐÚNG POST /api/create/shelfStockThresholds, hiện trong bảng', async () => {
      await page.fill('#stMaHang', 'SKU001');
      await page.fill('#stMinQuantity', '5');
      await page.click('#stForm button[type="submit"]');
      await page.waitForTimeout(80);

      const result = await page.evaluate(() => ({
        count: DB.shelfStockThresholds.length,
        item: DB.shelfStockThresholds[0],
        rowText: document.getElementById('vhShelfThresholdBody').textContent
      }));
      assertEqual(result.count, 1, `phải tạo đúng 1 bản ghi, thực tế: ${JSON.stringify(result)}`);
      assertEqual(result.item.maHang, 'SKU001');
      assertEqual(result.item.minQuantity, 5);
      assertEqual(result.item.dept, 'Siêu thị Quận 1', 'dept phải tự ép theo người đăng nhập (forceOwnDept)');
      assertEqual(JSON.stringify(result.item.extraRecipientUsernames), JSON.stringify(['nv2']));
      assert(result.rowText.includes('SKU001'), `bảng phải hiện lại đúng Mã Hàng vừa tạo, thực tế: ${result.rowText}`);
      assert(result.rowText.includes('Nhân Viên 2'), `bảng phải hiện tên người nhận thêm, thực tế: ${result.rowText}`);
    });

    await run.run('Không có lỗi console.error/pageerror nào trong suốt quá trình thao tác THẬT (không phải lỗi CSP/JS)', async () => {
      assertEqual(jsErrors.length, 0, `phải 0 lỗi, thực tế: ${JSON.stringify(jsErrors)}`);
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
