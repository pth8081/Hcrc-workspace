// server/tests/demo-operation-order-create-form-tabs.js — DEMO thật (không phải bộ hồi quy tự động):
// chụp màn hình form "📦 Tạo Đơn Hàng Mới" THẬT (code thật qua testHarness.js, Chromium thật) cho CẢ 2
// sub-tab "🏬 Đặt Hàng Tại Siêu Thị"/"🏢 Đặt Hàng Tại HO" theo yêu cầu người dùng.
// Chạy: node server/tests/demo-operation-order-create-form-tabs.js
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8998;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'operation-order-create-form-tabs');
const CREATOR = { username: 'vh_demo', name: 'Người Lập Đơn Hàng (Demo)', dept: 'Vận Hành', perms: { operationOrderCreate: true, operationOrderReportView: true }, active: true };

const state = createMockState({ depts: ['Vận Hành'], users: [CREATOR] });

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1200, height: 1400 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, CREATOR);
    await page.evaluate(() => { switchTab('vanHanh'); setVanHanhSubTab('ORDERS'); });

    await page.evaluate(() => { setOperationOrderSubTab('STORE'); });
    await page.evaluate(() => openOperationOrderForm());
    await page.waitForSelector('#operationOrderForm', { state: 'visible' });
    await page.waitForTimeout(150);
    await page.locator('#vanHanhOrdersWrap').screenshot({ path: path.join(OUT_DIR, '01-dat-hang-tai-sieu-thi.png') });

    await page.evaluate(() => { setOperationOrderSubTab('HO'); });
    await page.evaluate(() => openOperationOrderForm());
    await page.waitForSelector('#operationOrderForm', { state: 'visible' });
    await page.waitForTimeout(150);
    await page.locator('#vanHanhOrdersWrap').screenshot({ path: path.join(OUT_DIR, '02-dat-hang-tai-ho.png') });

    console.log('Ảnh chụp lưu tại:', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
