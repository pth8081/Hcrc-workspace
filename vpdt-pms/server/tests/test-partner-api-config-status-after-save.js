// server/tests/test-partner-api-config-status-after-save.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo: "Cấu hình rồi, đang chạy đồng bộ mà vẫn hiện thông tin chưa cấu
// hình api key, thông báo làm cho admin hiểu sai" — kèm 2 ảnh chụp cho thấy đã Lưu + đang "Đồng Bộ
// Ngay" nhưng panel vẫn hiện "⚠️ Chưa cấu hình API Key."):
//
// syncStorageOnce() (core.js) sau khi lưu THÀNH CÔNG gán lại DB[key] = payload VỪA GỬI LÊN (tránh race
// với nhịp poll Approval Hub — xem chú thích đầy đủ tại đó). payload đó có "apiKeyPlain"/"headerValuePlain"
// (chuỗi thô gõ trên form) chứ KHÔNG có "hasApiKey"/"hasHeaderValue" (field CHỈ server tự tính khi ĐỌC
// qua sanitizeInventoryApiConfig()/sanitizeOperationOrderApiConfig(), không nằm trong response POST lẫn
// payload gửi lên) — badge trạng thái đọc cfg.hasApiKey/hasHeaderValue === undefined -> luôn hiện SAI
// "Chưa cấu hình" ngay sau khi lưu ĐÚNG, dù server đã lưu thành công thật (F5 lại mới thấy đúng).
//
// Đã vá (saveInventoryApiConfig()/saveOperationOrderApiConfig() ở module-hethong-tabs.js): tự tính lại
// đúng hasApiKey/hasHeaderValue (đã gõ giá trị mới HOẶC đã có từ trước giữ nguyên) + xoá field thô khỏi
// DB[key] + gọi lại load...ToForm() ngay sau khi lưu — không cần F5 trang.
//
// Browser thật qua Playwright (mirror khuôn tests/demo-inventory-api-config.js) — mock response POST
// ĐÚNG như server thật (CHỈ {version}, không có "item"/"hasApiKey" — khác demo cũ mock sai khiến
// không bắt được lỗi này).
//
// Chạy: node server/tests/test-partner-api-config-status-after-save.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'
  }[ext] || 'application/octet-stream';
}
function startStaticServer(port) {
  const PUBLIC_DIR = path.join(__dirname, '..', 'public');
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
        res.writeHead(200, { 'Content-Type': contentType(filePath) });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- ' + detail : ''}`); }
}

async function main() {
  const PORT = 9700 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1100, height: 900 });

  // Mock response ĐÚNG như routes/data.js thật trả về cho POST /api/data/:key thành công: CHỈ
  // {version: ...} (xem routes/data.js, không có "item"/"hasApiKey"/"hasHeaderValue") — cố ý KHÁC
  // demo-inventory-api-config.js cũ (mock sai, lẫn "item.hasApiKey: true" không có thật) để test này
  // THỰC SỰ bắt được lỗi thay vì vô tình che giấu nó.
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    if (req.url().includes('/api/data/inventoryApiConfig') && req.method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'v-fake' }) });
    }
    if (req.url().includes('/api/data/operationOrderApiConfig') && req.method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'v-fake' }) });
    }
    return route.continue();
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => {
    window.alert = () => {};
    window.confirm = () => true;
    Object.assign(DB, {
      depts: [], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], positionTypes: [],
      users: [{ id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }],
      workflows: [], quickApplyConfigs: [], deptWorkflows: {}, permGroups: [],
      externalApiKeys: [], attendanceClockApiKeys: [],
      operationOrderApiConfig: { enabled: true, baseUrl: 'https://dsmart16.example.com/api/orders', hasHeaderValue: true, matchingKey: 'poNumber' },
      inventoryApiConfig: { enabled: true, baseUrl: 'https://api.brgmart.vn', hasApiKey: true, lastSyncAt: null },
      _versions: {}
    });
    finishLogin(DB.users[0]);
  });
  await page.evaluate(() => switchTab('system'));
  await page.waitForTimeout(300);
  await page.click('#btnAdminSubPartnerApi');
  await page.waitForTimeout(150);

  // ===================== Kịch bản 1: Cấu Hình API Tồn Kho (BRGMART) =====================
  await page.click('#btnPartnerApiInventory');
  await page.waitForTimeout(200);

  const keyStatusBefore = await page.evaluate(() => document.getElementById('invApiKeyStatus').textContent);
  check('[Tồn Kho] Trước khi lưu: badge hiện ĐÚNG "Đã cấu hình" (đã seed hasApiKey=true)', keyStatusBefore.includes('Đã cấu hình'), keyStatusBefore);

  // Lưu KHÔNG gõ lại API Key (giữ nguyên) — đúng kịch bản sửa Base URL rồi Lưu như demo cũ.
  await page.fill('#invApiBaseUrl', 'https://api.hcrc.vn/api/v1/reports/ton-kho/run');
  await page.click('button[type=submit]:has-text("Lưu Cấu Hình API Tồn Kho")');
  await page.waitForTimeout(250);
  const keyStatusAfterBlankSave = await page.evaluate(() => document.getElementById('invApiKeyStatus').textContent);
  check('[Tồn Kho] LỖI CHƯA VÁ nếu sau khi Lưu (không gõ lại key) badge đổi SAI thành "Chưa cấu hình"',
    keyStatusAfterBlankSave.includes('Đã cấu hình') && !keyStatusAfterBlankSave.includes('Chưa cấu hình'), keyStatusAfterBlankSave);
  const hasApiKeyInMemoryAfterBlankSave = await page.evaluate(() => DB.inventoryApiConfig.hasApiKey);
  check('[Tồn Kho] DB.inventoryApiConfig.hasApiKey phải vẫn là true trong bộ nhớ sau khi lưu (không gõ lại key)', hasApiKeyInMemoryAfterBlankSave === true, hasApiKeyInMemoryAfterBlankSave);
  const apiKeyPlainLeftover = await page.evaluate(() => 'apiKeyPlain' in DB.inventoryApiConfig);
  check('[Tồn Kho] Không được để sót field "apiKeyPlain" (chuỗi thô) trong DB sau khi lưu', apiKeyPlainLeftover === false, apiKeyPlainLeftover);

  // Lưu CÓ gõ API Key mới — hasApiKey phải thành true (seed lại từ false để kiểm đúng nhánh "vừa gõ mới").
  await page.evaluate(() => { DB.inventoryApiConfig.hasApiKey = false; loadInventoryApiConfigToForm(); });
  await page.fill('#invApiKeyPlain', 'brgmart-secret-key-123');
  await page.click('button[type=submit]:has-text("Lưu Cấu Hình API Tồn Kho")');
  await page.waitForTimeout(250);
  const keyStatusAfterNewKey = await page.evaluate(() => document.getElementById('invApiKeyStatus').textContent);
  check('[Tồn Kho] Sau khi Lưu VỚI API Key mới gõ -> badge phải hiện "Đã cấu hình"', keyStatusAfterNewKey.includes('Đã cấu hình'), keyStatusAfterNewKey);

  // ===================== Kịch bản 2: Cấu Hình API Đơn Hàng (dsmart16) — cùng lớp lỗi =====================
  await page.click('#btnPartnerApiOrder');
  await page.waitForTimeout(200);
  const headerStatusBefore = await page.evaluate(() => document.getElementById('opApiHeaderStatus').textContent);
  check('[Đơn Hàng] Trước khi lưu: badge hiện ĐÚNG "Đã cấu hình" (đã seed hasHeaderValue=true)', headerStatusBefore.includes('Đã cấu hình'), headerStatusBefore);

  await page.fill('#opApiBaseUrl', 'https://dsmart16.example.com/api/orders/v2');
  await page.click('button[type=submit]:has-text("Lưu Cấu Hình API Đơn Hàng")');
  await page.waitForTimeout(250);
  const headerStatusAfterBlankSave = await page.evaluate(() => document.getElementById('opApiHeaderStatus').textContent);
  check('[Đơn Hàng] LỖI CHƯA VÁ nếu sau khi Lưu (không gõ lại header) badge đổi SAI thành "Chưa cấu hình"',
    headerStatusAfterBlankSave.includes('Đã cấu hình') && !headerStatusAfterBlankSave.includes('Chưa cấu hình'), headerStatusAfterBlankSave);
  // Kiểm TRỰC TIẾP state trong bộ nhớ (không chỉ text hiện tại trên màn, có thể "nhìn đúng" NGẪU NHIÊN
  // nếu badge đơn giản không được render lại — DB hỏng bên trong vẫn lộ ra ở lần chuyển tab/tải lại kế
  // tiếp) — mirror đúng cách kiểm "hasApiKeyInMemoryAfterBlankSave" ở kịch bản Tồn Kho phía trên.
  const hasHeaderValueInMemory = await page.evaluate(() => DB.operationOrderApiConfig.hasHeaderValue);
  check('[Đơn Hàng] DB.operationOrderApiConfig.hasHeaderValue phải vẫn là true trong bộ nhớ sau khi lưu (không gõ lại header)', hasHeaderValueInMemory === true, hasHeaderValueInMemory);
  const headerValuePlainLeftover = await page.evaluate(() => 'headerValuePlain' in DB.operationOrderApiConfig);
  check('[Đơn Hàng] Không được để sót field "headerValuePlain" (chuỗi thô) trong DB sau khi lưu', headerValuePlainLeftover === false, headerValuePlainLeftover);
  // Chuyển sang tab khác rồi quay lại -> load...ToForm() chạy lại từ DB trong bộ nhớ -> xác nhận badge
  // VẪN đúng sau khi render lại thật sự (không chỉ còn đúng do chưa bị động tới).
  await page.click('#btnPartnerApiInventory');
  await page.waitForTimeout(100);
  await page.click('#btnPartnerApiOrder');
  await page.waitForTimeout(100);
  const headerStatusAfterTabSwitch = await page.evaluate(() => document.getElementById('opApiHeaderStatus').textContent);
  check('[Đơn Hàng] Sau khi chuyển tab đi rồi quay lại (render lại từ DB bộ nhớ) badge vẫn phải đúng "Đã cấu hình"',
    headerStatusAfterTabSwitch.includes('Đã cấu hình') && !headerStatusAfterTabSwitch.includes('Chưa cấu hình'), headerStatusAfterTabSwitch);

  // Kịch bản QUAN TRỌNG NHẤT (đúng tình huống người dùng gặp lần đầu cấu hình): CHƯA có header value
  // (hasHeaderValue=false) -> admin gõ giá trị MỚI lần đầu -> Lưu -> badge PHẢI đổi thành "Đã cấu hình"
  // NGAY (không phải "giữ nguyên giá trị cũ nhờ spread tình cờ đúng" như 2 kịch bản blank-save ở trên).
  await page.evaluate(() => { DB.operationOrderApiConfig.hasHeaderValue = false; loadOperationOrderApiConfigToForm(); });
  await page.fill('#opApiHeaderValuePlain', 'dsmart16-secret-header-456');
  await page.click('button[type=submit]:has-text("Lưu Cấu Hình API Đơn Hàng")');
  await page.waitForTimeout(250);
  const headerStatusAfterNewHeader = await page.evaluate(() => document.getElementById('opApiHeaderStatus').textContent);
  check('[Đơn Hàng] Sau khi Lưu VỚI giá trị header MỚI gõ lần đầu -> badge phải hiện "Đã cấu hình"', headerStatusAfterNewHeader.includes('Đã cấu hình'), headerStatusAfterNewHeader);

  await browser.close();
  server.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
