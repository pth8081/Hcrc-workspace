#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression test (12/2026): mục "📋 Kiểm Soát Hàng Hóa" trong REPORT_NAV_TREE (module-baocaoquantri.js)
// trước đây hiện cho MỌI tài khoản đã đăng nhập bất kể có liên quan gì tới module Kiểm Soát Hàng Hóa
// không (chỉ thấy báo cáo rỗng, không đúng chuẩn đối xứng với "checklist"/"muaHang" đã gác đúng qua
// REPORT_KEY_ACCESS_FN). Đã vá bằng canViewShelfReportClient() (core.js) + wire key 'shelfRecords' vào
// REPORT_KEY_ACCESS_FN (module-baocaoquantri.js).
//
// canViewShelfReportClient(user) hiện mục nếu: admin === true, HOẶC có quyền tham gia module thật
// (shelfRecordCreate/shelfLocationManage — KHÔNG dùng hasModuleAccess('vanHanhShelfTab') vì hàm đó mặc
// định trả true khi chưa cấu hình riêng, sẽ lại hiện tràn như lỗi cũ), HOẶC shelfReportView có giá trị
// ý nghĩa ({all:true} hoặc depts non-empty).
//
// Kiểm tra qua isReportKeyVisible('shelfRecords') (module-baocaoquantri.js, hàm nav thật dùng trực
// tiếp) thay vì gọi riêng canViewShelfReportClient() — khớp đúng con đường thật mục nav đi qua.
//
// Chạy: node server/tests/test-shelf-report-nav-gate.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8997;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.startsWith('/js/') || urlPath.startsWith('/fragments/')) {
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          const ext = path.extname(filePath).toLowerCase();
          const mime = ext === '.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
          res.writeHead(200, { 'Content-Type': mime });
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
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (pass) console.log(`PASS: ${name}`);
  else console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
}
async function scenario(name, fn) {
  try { await fn(); record(name, true); }
  catch (e) { record(name, false, 'threw: ' + (e && e.message ? e.message : String(e))); }
}

async function setUserAndCheck(page, user) {
  // LƯU Ý: `currentUser` là biến global khai báo bằng `let` (core.js) — KHÔNG gắn vào window, nên phải
  // gán thẳng biến `currentUser` (bare identifier, page.evaluate chạy ở global scope sẽ re-assign đúng
  // biến let đã khai báo) thay vì `window.currentUser = u` (sẽ tạo property RIÊNG trên window, không
  // trùng với biến `currentUser` thật mà isReportKeyVisible()/canViewShelfReportClient() đọc).
  return page.evaluate((u) => {
    currentUser = u;
    return isReportKeyVisible('shelfRecords');
  }, user);
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));
  const jsErrors = [];
  page.on('pageerror', e => jsErrors.push(String(e)));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.waitForTimeout(150);

  try {
    await scenario('(a) User không có cả 3 điều kiện (perms rỗng) -> KHÔNG thấy mục trong nav', async () => {
      const visible = await setUserAndCheck(page, { username: 'nv.thuong', perms: {} });
      if (visible) throw new Error('Kỳ vọng ẨN mục cho user không liên quan gì tới Kiểm Soát Hàng Hóa, thực tế HIỆN');
    });

    await scenario('(b) User có quyền tham gia module thật (shelfRecordCreate) -> THẤY mục', async () => {
      const visible = await setUserAndCheck(page, { username: 'nv.sieuthi', perms: { shelfRecordCreate: true } });
      if (!visible) throw new Error('Kỳ vọng HIỆN mục cho user có shelfRecordCreate, thực tế ẨN');
    });

    await scenario('(b2) User có quyền tham gia module thật (shelfLocationManage) -> THẤY mục', async () => {
      const visible = await setUserAndCheck(page, { username: 'nv.quanly', perms: { shelfLocationManage: true } });
      if (!visible) throw new Error('Kỳ vọng HIỆN mục cho user có shelfLocationManage, thực tế ẨN');
    });

    await scenario('(c) User có shelfReportView (all=false, depts có giá trị) -> THẤY mục', async () => {
      const visible = await setUserAndCheck(page, { username: 'qlvung.a', perms: { shelfReportView: { all: false, depts: ['Siêu Thị Quận 1'] } } });
      if (!visible) throw new Error('Kỳ vọng HIỆN mục cho user có shelfReportView.depts non-empty (dù all=false), thực tế ẨN');
    });

    await scenario('(c2) User có shelfReportView.all=true (depts rỗng) -> THẤY mục', async () => {
      const visible = await setUserAndCheck(page, { username: 'qlvung.b', perms: { shelfReportView: { all: true, depts: [] } } });
      if (!visible) throw new Error('Kỳ vọng HIỆN mục cho user có shelfReportView.all=true, thực tế ẨN');
    });

    await scenario('(c3) User có shelfReportView rỗng ({all:false, depts:[]}) -> vẫn ẨN (không có giá trị ý nghĩa)', async () => {
      const visible = await setUserAndCheck(page, { username: 'qlvung.c', perms: { shelfReportView: { all: false, depts: [] } } });
      if (visible) throw new Error('Kỳ vọng ẨN mục cho shelfReportView rỗng vô nghĩa, thực tế HIỆN');
    });

    await scenario('(c4) Tương thích ngược: shelfReportViewAll=true (field cũ, chưa có shelfReportView) -> THẤY mục', async () => {
      const visible = await setUserAndCheck(page, { username: 'qlvung.legacy', perms: { shelfReportViewAll: true } });
      if (!visible) throw new Error('Kỳ vọng HIỆN mục qua fallback field cũ shelfReportViewAll=true, thực tế ẨN');
    });

    await scenario('(d) admin:true -> LUÔN THẤY mục dù không có quyền chi tiết nào khác', async () => {
      const visible = await setUserAndCheck(page, { username: 'root', perms: { admin: true } });
      if (!visible) throw new Error('Kỳ vọng HIỆN mục cho admin:true, thực tế ẨN');
    });

    await scenario('reportViewAll/reportExtraKeys vẫn override được như các key khác (không bị canViewShelfReportClient() chặn)', async () => {
      const viaReportViewAll = await setUserAndCheck(page, { username: 'qltonghop', perms: { reportViewAll: true } });
      if (!viaReportViewAll) throw new Error('Kỳ vọng HIỆN mục qua perms.reportViewAll=true (bỏ qua canViewShelfReportClient()), thực tế ẨN');
      const viaExtraKey = await page.evaluate(() => {
        currentUser = { username: 'ql.xemcheo', perms: {}, reportExtraKeys: ['shelfRecords'] };
        return isReportKeyVisible('shelfRecords');
      });
      if (!viaExtraKey) throw new Error('Kỳ vọng HIỆN mục qua reportExtraKeys=["shelfRecords"], thực tế ẨN');
    });

    await scenario('Không có lỗi JS (pageerror) nào phát sinh trong suốt bài test', () => {
      if (jsErrors.length) throw new Error(jsErrors.join(' | '));
    });
  } finally {
    await browser.close();
    await server.close();
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\n${passed} passed, 0 failed`);
  if (failed > 0) process.exitCode = 1;
})();
