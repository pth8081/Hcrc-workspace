// server/tests/test-partner-api-config-false-success-detection.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo kèm ảnh chụp, 2 lần liên tiếp cho 2 key KHÁC nhau —
// inventoryApiConfig rồi storeExternalCodes — "up code mới xong lại mất hết cấu hình"/"nhập mã điểm api
// xong refresh lại mất hết"): nghi vấn "lưu thành công giả" — POST /api/data/:key trả HTTP 200 nhưng dữ
// liệu không thực sự persist trong CSDL (hoặc một tiến trình PM2 khác đọc thấy bản cũ). Đã thêm round-
// trip verification: saveInventoryApiConfig()/saveOperationOrderApiConfig() (module-hethong-tabs.js) gọi
// GET /api/data/<key> NGAY SAU KHI POST xong để xác nhận THẬT giá trị đã nằm trong CSDL, trước khi báo
// "✅ Đã lưu". File này kiểm ĐÚNG nhánh phát hiện "lưu thành công giả" — tách riêng khỏi
// test-partner-api-config-status-after-save.js (vốn chỉ kiểm đường THÀNH CÔNG THẬT) để không làm phình
// file đó.
//
// Chạy: node server/tests/test-partner-api-config-false-success-detection.js
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
  const PORT = 9650 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1100, height: 900 });

  // POST luôn trả 200 "thành công" (đúng như server thật trả khi query chạy xong, kể cả trong kịch bản
  // dữ liệu không thực sự persist — VD lỗi replication/đọc nhầm cache ở 1 tiến trình PM2 khác) — nhưng
  // GET đọc lại CỐ Ý trả về giá trị CŨ/rỗng, mô phỏng đúng triệu chứng người dùng báo.
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    if (req.url().includes('/api/data/inventoryApiConfig') && req.method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'v-fake' }) });
    }
    if (req.url().includes('/api/data/inventoryApiConfig') && req.method() === 'GET') {
      // "Mất cấu hình" — rơi về đúng trạng thái mặc định rỗng người dùng đã thấy trong ảnh chụp báo lỗi.
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, baseUrl: '', hasApiKey: false }) });
    }
    if (req.url().includes('/api/data/operationOrderApiConfig') && req.method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'v-fake' }) });
    }
    if (req.url().includes('/api/data/operationOrderApiConfig') && req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ enabled: false, baseUrl: '', hasHeaderValue: false }) });
    }
    return route.continue();
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (msg) => { window.__alerts.push(String(msg)); };
    window.confirm = () => true;
    Object.assign(DB, {
      depts: [], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], positionTypes: [],
      users: [{ id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }],
      workflows: [], quickApplyConfigs: [], deptWorkflows: {}, permGroups: [],
      externalApiKeys: [], attendanceClockApiKeys: [],
      operationOrderApiConfig: { enabled: false, baseUrl: '', hasHeaderValue: false },
      inventoryApiConfig: { enabled: false, baseUrl: '', hasApiKey: false, lastSyncAt: null },
      _versions: {}
    });
    finishLogin(DB.users[0]);
  });
  await page.evaluate(() => switchTab('system'));
  await page.waitForTimeout(300);
  await page.click('#btnAdminSubPartnerApi');
  await page.waitForTimeout(150);

  // ===================== Tồn Kho (BRGMART) =====================
  await page.click('#btnPartnerApiInventory');
  await page.waitForTimeout(200);
  await page.selectOption('#invApiEnabled', 'true');
  await page.fill('#invApiBaseUrl', 'https://api.hcrc.vn/api/v1/reports/ton-kho/run');
  await page.fill('#invApiKeyPlain', 'brgmart-secret-key-123');
  const alertsBefore = await page.evaluate(() => window.__alerts.length);
  await page.click('button[type=submit]:has-text("Lưu Cấu Hình API Tồn Kho")');
  await page.waitForTimeout(300);
  const resultInv = await page.evaluate((before) => ({
    newAlerts: window.__alerts.slice(before),
    enabledAfter: document.getElementById('invApiEnabled').value
  }), alertsBefore);
  check('[Tồn Kho] "lưu thành công giả" (GET đọc lại rỗng) -> phải cảnh báo, KHÔNG báo "Đã lưu"',
    resultInv.newAlerts.length === 1 && resultInv.newAlerts[0].includes('CẢNH BÁO') && !resultInv.newAlerts[0].includes('✅ Đã lưu'),
    JSON.stringify(resultInv.newAlerts));

  // ===================== Đơn Hàng (dsmart16) =====================
  await page.click('#btnPartnerApiOrder');
  await page.waitForTimeout(200);
  await page.selectOption('#opApiEnabled', 'true');
  await page.fill('#opApiBaseUrl', 'https://dsmart16.example.com/api/orders');
  await page.fill('#opApiHeaderValuePlain', 'dsmart16-secret-header-456');
  const alertsBefore2 = await page.evaluate(() => window.__alerts.length);
  await page.click('button[type=submit]:has-text("Lưu Cấu Hình API Đơn Hàng")');
  await page.waitForTimeout(300);
  const resultOrder = await page.evaluate((before) => window.__alerts.slice(before), alertsBefore2);
  check('[Đơn Hàng] "lưu thành công giả" (GET đọc lại rỗng) -> phải cảnh báo, KHÔNG báo "Đã lưu"',
    resultOrder.length === 1 && resultOrder[0].includes('CẢNH BÁO') && !resultOrder[0].includes('✅ Đã lưu'),
    JSON.stringify(resultOrder));

  await browser.close();
  server.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
