// server/tests/test-asset-version-csp.js
//
// Regression cho BUG THẬT phát hiện khi điều tra tiếp lỗi Nghiệp Vụ (v23.7): window.__ASSET_VERSION__
// (server.js::renderIndexHtml()) TRƯỚC ĐÂY được gắn qua 1 <script> NỘI TUYẾN
// (`<script>window.__ASSET_VERSION__="...";</script>`) — bị scriptSrc của CSP (lib/securityHeaders.js,
// KHÔNG có 'unsafe-inline') CHẶN ÂM THẦM trên MỌI server có bật CSP thật, khiến biến này luôn undefined.
// Hậu quả NGHIÊM TRỌNG, ảnh hưởng TOÀN BỘ app (không riêng Nghiệp Vụ): mọi module nạp lười
// (loadModuleGroup()/_loadModuleScriptTag(), core.js) mất hẳn cache-busting "?v=..." trong khi /js/* lại
// phục vụ Cache-Control max-age=1 năm + immutable (JS_STATIC_OPTS, server.js) — trình duyệt có thể GIỮ
// NGUYÊN bản JS cache TỪ CẢ NĂM TRƯỚC cho hầu hết app, không bao giờ tự kiểm tra lại dù server đã deploy
// bản mới + người dùng đã tải lại trang nhiều lần. Đã sửa: gắn version qua <meta name="app-version"
// content="..."> (dữ liệu HTML thuần, không bị scriptSrc chi phối) — core.js đọc lại ngay dòng đầu file.
//
// Bài test NÀY mirror ĐÚNG logic renderIndexHtml() thật ở server.js (2 regex SCRIPT_SRC_RE/CSS_HREF_RE +
// cách chèn version) — KHÔNG require thẳng server.js được vì file đó tự listen cổng + cần kết nối SQL
// Server thật ngay khi nạp (xem require('./db') đầu file), không chạy được trong sandbox (đúng ràng buộc
// đã ghi nhận xuyên suốt bộ test này). Nếu sau này đổi cách server.js gắn version, PHẢI cập nhật lại
// đúng 2 hằng số regex bên dưới cho khớp, tránh test "giả PASS" trong khi code thật đã lệch.
//
// Chạy: node server/tests/test-asset-version-csp.js
'use strict';
const path = require('path');
const fs = require('fs');

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

// Mirror CHÍNH XÁC server.js: SCRIPT_SRC_RE/CSS_HREF_RE + cách chèn version trước <script src="/js/core.js...">.
const SCRIPT_SRC_RE = /(<script\b[^>]*\bsrc=")\/js\/([\w.-]+)\.js(")/g;
const CSS_HREF_RE = /(<link\b[^>]*\bhref=")\/(tailwind|app)\.css(")/g;
function renderIndexHtmlLikeServer(rawHtml, appVersion) {
  let versioned = rawHtml.replace(SCRIPT_SRC_RE, (full, pre, name, post) => `${pre}/js/${name}.js?v=${encodeURIComponent(appVersion)}${post}`);
  versioned = versioned.replace(CSS_HREF_RE, (full, pre, name, post) => `${pre}/${name}.css?v=${encodeURIComponent(appVersion)}${post}`);
  const versionMeta = `<meta name="app-version" content="${String(appVersion).replace(/"/g, '&quot;')}">\n`;
  versioned = versioned.replace(/<script\b[^>]*\bsrc="\/js\/core\.js/, (m) => versionMeta + m);
  return versioned;
}

async function main() {
  const express = require(path.join(__dirname, '..', 'node_modules', 'express'));
  const securityHeaders = require(path.join(__dirname, '..', 'lib', 'securityHeaders'));
  const PUBLIC_DIR = path.join(__dirname, '..', 'public');
  const APP_VERSION = require(path.join(__dirname, '..', 'package.json')).version;

  const app = express();
  app.use(securityHeaders);
  app.get('/', (req, res) => {
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    res.set('Content-Type', 'text/html; charset=utf-8').send(renderIndexHtmlLikeServer(raw, APP_VERSION));
  });
  app.use(express.static(PUBLIC_DIR));
  const PORT = 9713;
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();

  const cspViolations = [];
  page.on('console', (m) => { if (m.text().includes('Content Security Policy')) cspViolations.push(m.text().split('\n')[0]); });

  const requestedModuleUrls = [];
  page.on('request', (req) => { if (req.url().includes('module-nghiepvu.js')) requestedModuleUrls.push(req.url()); });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

  const assetVersion = await page.evaluate(() => window.__ASSET_VERSION__);
  record(`window.__ASSET_VERSION__ gắn đúng dưới CSP thật (không còn undefined) — hiện tại "${APP_VERSION}"`, assetVersion === APP_VERSION, `got=${JSON.stringify(assetVersion)}`);

  const metaTag = await page.evaluate(() => {
    const m = document.querySelector('meta[name="app-version"]');
    return m ? m.getAttribute('content') : null;
  });
  record('Thẻ <meta name="app-version"> có mặt trong trang với đúng nội dung version', metaTag === APP_VERSION, `got=${JSON.stringify(metaTag)}`);

  const hasInlineVersionScript = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script:not([src])')).some(s => s.textContent.includes('__ASSET_VERSION__'));
  });
  record('KHÔNG còn <script> nội tuyến nào gán window.__ASSET_VERSION__ (đã đổi hẳn sang <meta>)', !hasInlineVersionScript);

  record('KHÔNG có vi phạm CSP script-src nào khi tải trang (script nội tuyến cũ đã bị loại bỏ)', cspViolations.length === 0, JSON.stringify(cspViolations));

  // ===== Kiểm tra CHÍNH: module nạp lười PHẢI có "?v=..." đúng version — đây là điều thực sự quyết định
  // cache-busting có hoạt động hay không khi deploy bản mới. =====
  await page.evaluate(() => {
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ([]) });
    Object.assign(DB, {
      depts: [], stores: [], cats: [],
      users: [{ id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'X', jobTitle: 'Admin', email: 'a@t', phone: '0', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }]
    });
    finishLogin(DB.users[0]);
  });
  await page.evaluate(() => switchTab('nghiepVu'));
  await page.waitForTimeout(300);

  record('Module nạp lười (module-nghiepvu.js) được tải kèm đúng "?v=" cache-busting theo version server', requestedModuleUrls.length > 0 && requestedModuleUrls.every(u => u.includes(`?v=${encodeURIComponent(APP_VERSION)}`)), JSON.stringify(requestedModuleUrls));

  await browser.close();
  server.close();
  finish();
}

function finish() {
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log('');
  console.log(`${passed}/${total} scenarios passed.`);
  if (passed !== total) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
