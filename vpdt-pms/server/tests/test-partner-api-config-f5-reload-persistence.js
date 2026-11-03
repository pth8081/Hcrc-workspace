// server/tests/test-partner-api-config-f5-reload-persistence.js
//
// LỖI THẬT đã vá (11/2026, người dùng báo kèm ảnh chụp màn hình: "tôi đã nhập key, url, đã ấn lưu nhưng
// F5 mất hết cấu hình, lỗi này đã từng xảy ra với danh mục"):
//
// initDatabase() (core.js) — hàm DUY NHẤT đọc lại dữ liệu từ GET /api/data lúc bootstrap trang (F5/đăng
// nhập lại) — CHƯA TỪNG có dòng gán `DB.inventoryApiConfig = data.inventoryApiConfig` hay
// `DB.storeExternalCodes = data.storeExternalCodes`, dù cả 2 key ĐÃ được server lưu/đọc đúng (route
// generic POST/GET /api/data/:key hoạt động đúng, round-trip verify lúc bấm "Lưu" cũng xác nhận đúng NGAY
// lúc đó — xem v28.93). Vì initDatabase() bỏ sót 2 dòng gán, F5 xong DB.inventoryApiConfig/
// DB.storeExternalCodes luôn là `undefined` -> mọi nơi đọc `DB.<key> || {}` ra object rỗng, y hệt CHƯA
// từng cấu hình gì -> đúng triệu chứng người dùng báo (Base URL rỗng, "Chưa cấu hình API Key", "Chưa từng
// chạy đồng bộ lần nào") dù dữ liệu thật vẫn còn nguyên trên server.
//
// Phát hiện bằng tests/test-initdatabase-key-coverage.js đã có sẵn (kiểm tĩnh, không cần Playwright/SQL)
// — chạy lại bài test đó xác nhận đúng 2 key bị thiếu. File NÀY bổ sung phần CÒN THIẾU: 1 bài test
// Playwright F5 THẬT (page.reload() thật, không chỉ gọi lại hàm JS) để xác nhận TRIỆU CHỨNG người dùng
// thấy (panel trống sau F5) đã hết — khác mọi test partner-api-config khác trước đây (dùng
// page.evaluate() tiêm DB/finishLogin() trực tiếp, không bao giờ thật sự tải lại trang).
//
// Cơ chế: dùng page.route('**/api/**') (network-level, SỐNG SÓT qua page.reload() trong cùng 1 Page —
// khác window.fetch monkey-patch trong page.evaluate(), bị XOÁ SẠCH khi reload) để giả lập "server thật"
// NGOÀI trang, mock cả /api/auth/me (giữ phiên đăng nhập) + GET /api/data (bootstrap đầy đủ) + POST/GET
// /api/data/inventoryApiConfig. Tắt cache DB cục bộ (localStorage) trước khi reload để chắc chắn đi qua
// ĐÚNG nhánh initDatabase() đầy đủ (không bị nhánh "Lớp 1 — hiện tạm bằng cache" hiện dữ liệu cache cũ che
// mất triệu chứng thật).
//
// Chạy: node server/tests/test-partner-api-config-f5-reload-persistence.js
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
  // serviceWorkers: 'block' — public/sw.js (PWA) tự fetch() LẠI mọi request /api/* NGAY TRONG tiến trình
  // Service Worker riêng (không phải trang) để quyết định cache/network — page.route() CHỈ bắt được
  // request phát ra TỪ TRANG, không bắt được fetch() phát sinh bên trong Service Worker, nên sau
  // page.reload() (lúc SW đã active từ lượt tải đầu) mọi request auth/data sẽ "biến mất" khỏi mock mạng
  // của test này dù hành vi SW không liên quan gì tới lỗi thật đang kiểm — chặn hẳn SW để test F5 thật
  // chạy đúng qua ĐÚNG nhánh initDatabase() cần kiểm, không lẫn hành vi SW.
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1100, height: 900 });

  const ADMIN_USER = {
    id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', jobTitle: 'Admin',
    email: 'a@test.local', phone: '0900000000', perms: { admin: true }, active: true, totpEnabled: true,
    groupIds: [], permOverrides: null, mustChangePassword: false
  };

  // "CSDL giả" ngoài trang — sống suốt vòng đời Page, kể cả qua page.reload() (route handlers không bị
  // gỡ khi reload, khác mọi state tiêm qua page.evaluate()).
  const fakeDb = {
    inventoryApiConfig: {}, // CHƯA cấu hình gì lúc đầu — đúng hiện trạng trước khi người dùng thao tác.
    storeExternalCodes: {}
  };

  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();

    if (url.includes('/api/auth/me') && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ADMIN_USER) });
    }
    if (url.endsWith('/api/data') && method === 'GET') {
      // Bootstrap tổng — ĐÚNG hình dạng tối thiểu để initDatabase() không throw ở các dòng gán khác
      // (mọi key không liệt kê ở đây initDatabase() tự `|| []`/`|| {}` nên để trống là an toàn).
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          depts: [], stores: [], cats: [], users: [ADMIN_USER], permGroups: [],
          inventoryApiConfig: fakeDb.inventoryApiConfig,
          storeExternalCodes: fakeDb.storeExternalCodes
        })
      });
    }
    if (url.includes('/api/data/inventoryApiConfig') && method === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      fakeDb.inventoryApiConfig = {
        enabled: body.enabled, baseUrl: body.baseUrl,
        hasApiKey: !!body.apiKeyPlain || !!fakeDb.inventoryApiConfig.hasApiKey
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 'v-fake' }) });
    }
    if (url.includes('/api/data/inventoryApiConfig') && method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeDb.inventoryApiConfig) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  // Đợi tự đăng nhập qua /api/auth/me + initDatabase() + finishLogin() chạy xong (luồng ĐĂNG NHẬP THẬT
  // của app, không gọi finishLogin()/initDatabase() tay như các test khác).
  await page.waitForFunction(() => typeof DB !== 'undefined' && DB.users && DB.users.length > 0, { timeout: 15000 });
  await page.waitForTimeout(200);

  await page.evaluate(() => switchTab('system'));
  await page.waitForTimeout(300);
  await page.click('#btnAdminSubPartnerApi');
  await page.waitForTimeout(150);
  await page.click('#btnPartnerApiInventory');
  await page.waitForTimeout(200);

  const beforeBaseUrl = await page.$eval('#invApiBaseUrl', el => el.value);
  check('Trước khi lưu: Base URL trống (chưa cấu hình gì)', beforeBaseUrl === '', beforeBaseUrl);

  await page.selectOption('#invApiEnabled', 'true');
  await page.fill('#invApiBaseUrl', 'https://api.brgmart.vn');
  await page.fill('#invApiKeyPlain', 'brgmart-secret-key-xyz');
  await page.click('button[type=submit]:has-text("Lưu Cấu Hình API Tồn Kho")');
  await page.waitForTimeout(350);

  const savedAlertSeen = await page.evaluate(() => window.__lastAlert || '');
  // Không assert nội dung alert() thật (chưa stub) — chỉ xác nhận "CSDL giả" ngoài trang đã nhận đúng
  // giá trị vừa lưu, tách bạch khỏi mọi hành vi UI tạm thời trong PHIÊN hiện tại.
  check('Server giả đã nhận đúng baseUrl vừa Lưu', fakeDb.inventoryApiConfig.baseUrl === 'https://api.brgmart.vn', JSON.stringify(fakeDb.inventoryApiConfig));
  check('Server giả đã nhận đúng enabled=true vừa Lưu', fakeDb.inventoryApiConfig.enabled === true, JSON.stringify(fakeDb.inventoryApiConfig));
  check('Server giả đã ghi nhận hasApiKey=true (đã gõ key mới)', fakeDb.inventoryApiConfig.hasApiKey === true, JSON.stringify(fakeDb.inventoryApiConfig));

  // ================= F5 THẬT (page.reload(), không phải gọi lại hàm JS) =================
  // Xoá cache DB cục bộ TRƯỚC khi reload — ép initDatabase() chạy ĐẦY ĐỦ (nhánh "Lớp 1 — hiện tạm bằng
  // cache" sẽ hiện dữ liệu cache CŨ trước rồi mới tự sửa lại ở nền, có thể che mất triệu chứng thật trong
  // vài trăm ms đầu nếu không tắt — xem loadDbSnapshotFromCache()/proceedAfterAuth() ở core.js).
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof DB !== 'undefined' && DB.users && DB.users.length > 0, { timeout: 15000 });
  await page.waitForTimeout(200);

  const dbInventoryAfterReload = await page.evaluate(() => DB.inventoryApiConfig);
  check('SAU F5 THẬT: DB.inventoryApiConfig KHÔNG được là undefined (đây chính là lỗi gốc)', dbInventoryAfterReload !== undefined, dbInventoryAfterReload);
  check('SAU F5 THẬT: DB.inventoryApiConfig.baseUrl đúng giá trị vừa lưu', dbInventoryAfterReload && dbInventoryAfterReload.baseUrl === 'https://api.brgmart.vn', JSON.stringify(dbInventoryAfterReload));
  check('SAU F5 THẬT: DB.inventoryApiConfig.enabled vẫn true', dbInventoryAfterReload && dbInventoryAfterReload.enabled === true, JSON.stringify(dbInventoryAfterReload));
  check('SAU F5 THẬT: DB.inventoryApiConfig.hasApiKey vẫn true', dbInventoryAfterReload && dbInventoryAfterReload.hasApiKey === true, JSON.stringify(dbInventoryAfterReload));

  // Vào lại ĐÚNG panel (y hệt người dùng bấm lại sau F5) — xác nhận giao diện hiển thị ĐÚNG, không chỉ
  // DB trong bộ nhớ đúng mà form không render lại đúng.
  await page.evaluate(() => switchTab('system'));
  await page.waitForTimeout(300);
  await page.click('#btnAdminSubPartnerApi');
  await page.waitForTimeout(150);
  await page.click('#btnPartnerApiInventory');
  await page.waitForTimeout(200);

  const afterBaseUrl = await page.$eval('#invApiBaseUrl', el => el.value);
  check('SAU F5 THẬT: ô Base URL hiển thị ĐÚNG giá trị vừa lưu (KHÔNG rỗng)', afterBaseUrl === 'https://api.brgmart.vn', afterBaseUrl);
  const afterKeyStatus = await page.evaluate(() => document.getElementById('invApiKeyStatus').textContent);
  check('SAU F5 THẬT: badge API Key hiện "Đã cấu hình" (KHÔNG phải "Chưa cấu hình")', afterKeyStatus.includes('Đã cấu hình') && !afterKeyStatus.includes('Chưa cấu hình'), afterKeyStatus);
  const afterEnabledValue = await page.$eval('#invApiEnabled', el => el.value);
  check('SAU F5 THẬT: Trạng Thái vẫn đúng "Bật" (true)', afterEnabledValue === 'true', afterEnabledValue);

  await browser.close();
  server.close();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
