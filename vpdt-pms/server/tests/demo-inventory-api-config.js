// server/tests/demo-inventory-api-config.js
//
// DEMO thật (Chromium thật qua Playwright, không phải mock) cho tính năng MỚI "🧺 Cấu Hình API Tồn Kho"
// (Hệ Thống > Quản Trị > Phân Quyền... > Cấu Hình API Tồn Kho) — theo yêu cầu người dùng 11/2026 "sao
// không cho cấu hình API tồn kho trên app, bắt buộc .env tôi không chủ động được". Xác nhận: (1) tab mới
// hiện đúng form, (2) loadInventoryApiConfigToForm() đổ đúng dữ liệu đã seed, (3) bấm "Lưu Cấu Hình API
// Tồn Kho" gọi đúng POST /api/data/inventoryApiConfig với payload đúng, (4) bấm "Đồng Bộ Ngay" gọi đúng
// POST /api/inventory/sync-now.
//
// Chạy: node server/tests/demo-inventory-api-config.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const OUT_DIR = process.env.INVENTORY_API_CONFIG_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'inventory-api-config');
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
  const PORT = 9600 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1100, height: 900 });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  const requestsSeen = [];
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    let bodyJson = null;
    try { bodyJson = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) { /* ignore */ }
    requestsSeen.push({ method: req.method(), url: req.url(), body: bodyJson });
    if (req.url().includes('/api/data/inventoryApiConfig') && req.method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, item: { ...bodyJson, apiKeyEnc: undefined, hasApiKey: true } }) });
    }
    if (req.url().includes('/api/inventory/sync-now') && req.method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, rowCount: 123, storeCount: 8, pagesFetched: 1 }) });
    }
    return route.continue();
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;

    Object.assign(DB, {
      depts: [], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], positionTypes: [],
      users: [{ id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }],
      workflows: [], quickApplyConfigs: [], deptWorkflows: {}, permGroups: [],
      operationOrderApiConfig: {}, externalApiKeys: [], attendanceClockApiKeys: [],
      inventoryApiConfig: { enabled: true, baseUrl: 'https://api.brgmart.vn', hasApiKey: true, lastSyncAt: '2026-11-02T03:00:00.000Z', lastSyncStatus: 'SUCCESS', lastSyncMessage: 'Đồng bộ thành công — 500 dòng, 40 siêu thị, 1 trang.' },
      _versions: {}
    });

    finishLogin(DB.users[0]);
  });

  await page.evaluate(() => switchTab('system'));
  await page.waitForTimeout(300);
  // 11/2026: "Cấu Hình API Tồn Kho" không còn là nút cấp 1 riêng — đã gộp vào tab cha "Cấu Hình API Đối
  // Tác" (#btnAdminSubPartnerApi), tab con "🧺 Tồn Kho — BRGMART" (#btnPartnerApiInventory).
  await page.evaluate(() => document.getElementById('btnAdminSubPartnerApi')?.scrollIntoView());
  await page.click('#btnAdminSubPartnerApi');
  await page.waitForTimeout(150);
  await page.click('#btnPartnerApiInventory');
  await page.waitForTimeout(300);

  await page.screenshot({ path: path.join(OUT_DIR, '1-cau-hinh-api-ton-kho.png'), fullPage: true });
  console.log('Đã chụp: 1-cau-hinh-api-ton-kho.png');

  const formState = await page.evaluate(() => ({
    enabled: document.getElementById('invApiEnabled').value,
    baseUrl: document.getElementById('invApiBaseUrl').value,
    keyStatus: document.getElementById('invApiKeyStatus').textContent,
    lastSyncStatus: document.getElementById('invApiLastSyncStatus').textContent
  }));
  console.log('Form state sau khi vào tab:', JSON.stringify(formState, null, 2));

  // Bấm "Lưu Cấu Hình API Tồn Kho" (không gõ lại API Key -> apiKeyPlain rỗng).
  await page.fill('#invApiBaseUrl', 'https://api.brgmart.vn/v2');
  await page.click('button[type=submit]:has-text("Lưu Cấu Hình API Tồn Kho")');
  await page.waitForTimeout(200);

  // Bấm "Đồng Bộ Ngay".
  await page.click('#invApiSyncNowBtn');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '2-sau-khi-dong-bo-ngay.png'), fullPage: true });
  console.log('Đã chụp: 2-sau-khi-dong-bo-ngay.png');

  const syncStatusAfter = await page.evaluate(() => document.getElementById('invApiLastSyncStatus').textContent);
  console.log('Trạng thái sau "Đồng Bộ Ngay":', syncStatusAfter);

  const saveReq = requestsSeen.find(r => r.url.includes('/api/data/inventoryApiConfig') && r.method === 'POST');
  const syncReq = requestsSeen.find(r => r.url.includes('/api/inventory/sync-now') && r.method === 'POST');
  console.log('Request LƯU đã gửi:', JSON.stringify(saveReq?.body));
  console.log('Request ĐỒNG BỘ NGAY đã gửi (phương thức):', syncReq?.method, syncReq?.url);

  console.log('\nLỗi JS (pageerror) phát sinh:', pageErrors.length ? pageErrors.join(' | ') : '(không có)');
  console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);

  await browser.close();
  server.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
