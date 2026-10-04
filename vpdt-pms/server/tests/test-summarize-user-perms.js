#!/usr/bin/env node
'use strict';

// ==========================================================================
// LỖI ĐÃ VÁ (mức Thấp, đợt rà soát v24.74→v24.81): summarizeUserPerms()
// (public/js/module-admin-userstaging.js, dùng cho bảng tóm tắt quyền ở danh
// sách Quản Lý Người Dùng) trước đây chỉ xét submissionCreate/contractCreate khi
// quyết định hiện tag "📜 Tờ trình"/"📄 Hợp đồng" — người CHỈ có quyền Tải
// (submissionDownload/contractDownload, không có quyền Tạo) bị rơi mất tag này
// dù vẫn thực sự có quyền thao tác module. Test THUẦN CLIENT qua Playwright
// (cùng khuôn tests/test-perm-matrix-client.js), gọi thẳng hàm thật.
//
// Run: node server/tests/test-summarize-user-perms.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');

function startServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.startsWith('/js/') || urlPath.startsWith('/fragments/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          const isHtml = urlPath.startsWith('/fragments/');
          res.writeHead(200, { 'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' });
          res.end(data);
        });
      }
      fs.readFile(INDEX_HTML_PATH, (err, data) => {
        if (err) { res.writeHead(500); res.end(String(err)); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (pass) console.log(`PASS: ${name}`);
  else console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
}

async function scenario(name, fn) {
  try { await fn(); } catch (e) { record(name, false, 'threw: ' + (e && e.message ? e.message : String(e))); }
}

(async () => {
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startServer(PORT);
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.waitForTimeout(150);

  await scenario('summarizeUserPerms(): submissionCreate=true -> hiện tag "Tờ trình" (hành vi cũ)', async () => {
    const r = await page.evaluate(() => summarizeUserPerms({ submissionCreate: { all: true, depts: [] } }));
    record('tag "Tờ trình" xuất hiện khi có quyền Tạo', r.includes('Tờ trình'), r);
  });

  await scenario('LỖI ĐÃ VÁ: submissionDownload=true (CHỈ quyền Tải, không có quyền Tạo) -> vẫn phải hiện tag "Tờ trình"', async () => {
    const r = await page.evaluate(() => summarizeUserPerms({ submissionDownload: { all: true, depts: [] } }));
    record('tag "Tờ trình" xuất hiện khi CHỈ có quyền Tải', r.includes('Tờ trình'), r);
  });

  await scenario('LỖI ĐÃ VÁ: contractDownload=true (CHỈ quyền Tải, không có quyền Tạo) -> vẫn phải hiện tag "Hợp đồng"', async () => {
    const r = await page.evaluate(() => summarizeUserPerms({ contractDownload: { all: false, depts: ['Phòng A'] } }));
    record('tag "Hợp đồng" xuất hiện khi CHỈ có quyền Tải theo phòng ban', r.includes('Hợp đồng'), r);
  });

  await scenario('Không có bất kỳ quyền Tạo/Tải Tờ Trình/Hợp Đồng nào -> KHÔNG hiện 2 tag này', async () => {
    const r = await page.evaluate(() => summarizeUserPerms({ paymentManage: true }));
    record('không có tag "Tờ trình"', !r.includes('Tờ trình'), r);
    record('không có tag "Hợp đồng"', !r.includes('Hợp đồng'), r);
  });

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass).length;
  console.log(`\n==== ${results.length - failed}/${results.length} scenario(s) passed ====`);
  process.exit(failed ? 1 : 0);
})();
