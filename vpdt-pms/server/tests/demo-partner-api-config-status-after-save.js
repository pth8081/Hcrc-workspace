// server/tests/demo-partner-api-config-status-after-save.js
//
// Demo trước/sau cho lỗi người dùng báo: "Cấu hình rồi, đang chạy đồng bộ mà vẫn hiện thông tin chưa
// cấu hình api key, thông báo làm cho admin hiểu sai". Dựng lại ĐÚNG kịch bản: admin gõ API Key LẦN ĐẦU
// (hasApiKey=false trước đó) rồi bấm Lưu — chụp màn HÌNH THẬT ngay sau khi lưu xong (không F5).
//
// Chạy: node server/tests/demo-partner-api-config-status-after-save.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'partner-api-config-status-after-save');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'
  }[ext] || 'application/octet-stream';
}
function startStaticServer(port) {
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

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1100, height: 520 });

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    if (req.url().includes('/api/data/inventoryApiConfig') && req.method() === 'POST') {
      // Mock ĐÚNG như server thật trả về: CHỈ {version}, không có "hasApiKey" (field đó CHỈ server tự
      // tính khi ĐỌC qua sanitizeInventoryApiConfig(), không nằm trong response lưu).
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'v-demo' }) });
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
      operationOrderApiConfig: {}, externalApiKeys: [], attendanceClockApiKeys: [],
      inventoryApiConfig: { enabled: true, baseUrl: 'https://api.hcrc.vn/api/v1/reports/ton-kho/run', hasApiKey: false, lastSyncAt: null },
      _versions: {}
    });
    finishLogin(DB.users[0]);
  });
  await page.evaluate(() => switchTab('system'));
  await page.waitForTimeout(300);
  await page.click('#btnAdminSubPartnerApi');
  await page.waitForTimeout(150);
  await page.click('#btnPartnerApiInventory');
  await page.waitForTimeout(250);

  await page.locator('#adminSubInvApi').screenshot({ path: path.join(OUT_DIR, '1-truoc-khi-luu-chua-co-key.png') });
  console.log('📸 1-truoc-khi-luu-chua-co-key.png');

  // Gõ API Key lần đầu rồi Lưu — đúng kịch bản người dùng gặp.
  await page.fill('#invApiKeyPlain', 'brgmart-secret-key-that-that');
  await page.click('button[type=submit]:has-text("Lưu Cấu Hình API Tồn Kho")');
  await page.waitForTimeout(300);

  await page.locator('#adminSubInvApi').screenshot({ path: path.join(OUT_DIR, '2-sau-khi-luu-badge-dung.png') });
  console.log('📸 2-sau-khi-luu-badge-dung.png');

  const keyStatus = await page.evaluate(() => document.getElementById('invApiKeyStatus').textContent);
  console.log('Badge sau khi lưu:', keyStatus);
  if (!keyStatus.includes('Đã cấu hình')) throw new Error('❌ Badge vẫn hiện sai sau khi lưu!');
  console.log('\n✅ XÁC NHẬN: lưu xong hiện ĐÚNG ngay "Đã cấu hình API Key", không cần F5 trang.');

  await browser.close();
  server.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
