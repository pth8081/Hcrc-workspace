// tests/test-vanhanh-module-access-receipt-perm.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo "user đã add vào nhóm quyền có cho truy cập module như Vận Hành
// mà có user thấy được menu và có user không thấy được" — "người có quyền nào cũng nên được vào module,
// ko nhất thiết phải 3 quyền"): canAccessOperationModule() (core.js) đòi hỏi module access (Mục 0)
// CỘNG THÊM ít nhất 1 trong các quyền chi tiết của module — danh sách đó đã khá đầy đủ nhưng THIẾU đúng
// 1 quyền THẬT đang có trong chính cây phân quyền "22. Vận Hành" (systemSection.html):
// operationOrderReceiptManageHO/Store ("🧾 Quyền Phê Duyệt Đặt Hàng HO/Siêu Thị" — xác nhận nhận hàng/
// hủy đơn SAU KHI đơn đã duyệt xong, KHÔNG liên quan tới operationOrderCreate) — 1 user CHỈ được cấp
// đúng quyền này (VD nhân viên kho chỉ xác nhận nhận hàng) sẽ hoàn toàn không vào được module dù quyền
// đó rõ ràng thuộc Vận Hành. Đã bổ sung vào danh sách OR ở canAccessOperationModule().
//
// Chạy: node tests/test-vanhanh-module-access-receipt-perm.js
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = 8993;

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' }[ext] || 'application/octet-stream';
}
function startServer() {
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
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  if (pass) console.log(`PASS: ${name}`);
  else console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

  const r = await page.evaluate(() => {
    const base = { username: 'nv_kho', name: 'Nhân Viên Kho', dept: 'Phòng CNTT', role: 'NHANVIEN', jobTitle: null };

    const userHO = { ...base, perms: { admin: false, moduleAccess: {}, operationOrderReceiptManageHO: true } };
    const userStoreAll = { ...base, perms: { admin: false, moduleAccess: {}, operationOrderReceiptManageStore: { all: true, depts: [] } } };
    const userStoreDept = { ...base, perms: { admin: false, moduleAccess: {}, operationOrderReceiptManageStore: { all: false, depts: ['Siêu Thị A'] } } };
    const userNone = { ...base, perms: { admin: false, moduleAccess: {} } };

    return {
      ho: canAccessOperationModule(userHO),
      storeAll: canAccessOperationModule(userStoreAll),
      storeDept: canAccessOperationModule(userStoreDept),
      none: canAccessOperationModule(userNone)
    };
  });

  record('CHỈ có operationOrderReceiptManageHO=true -> vào được module Vận Hành', r.ho === true, JSON.stringify(r));
  record('CHỈ có operationOrderReceiptManageStore.all=true -> vào được module Vận Hành', r.storeAll === true, JSON.stringify(r));
  record('CHỈ có operationOrderReceiptManageStore.depts=[1 phòng] -> vào được module Vận Hành', r.storeDept === true, JSON.stringify(r));
  record('ĐỐI CHỨNG: hoàn toàn không có quyền gì -> vẫn KHÔNG vào được module (không nới lỏng quá tay)', r.none === false, JSON.stringify(r));

  await browser.close();
  server.close();

  const failed = results.filter(x => !x.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length) process.exitCode = 1;
})().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
