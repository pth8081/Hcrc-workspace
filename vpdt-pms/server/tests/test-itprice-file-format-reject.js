// server/tests/test-itprice-file-format-reject.js
//
// Yêu cầu người dùng (9/2026 rà soát nghiệp vụ, mục 3/4 "Giá bán lẻ/buôn kiểm tra format file"):
// POST /api/it-price/parse-file (routes/priceFile.js) phải CHẶN đúng 2 lớp:
//   1) Đuôi file (fileFilter multer, ALLOWED_EXT = .xlsx/.xls) — chặn NGAY, không cho lưu ra đĩa.
//   2) Nội dung nhị phân THẬT (verifyFileSignature(), magic bytes) — 1 file .txt đổi tên thành .xlsx
//      (đuôi hợp lệ nhưng nội dung KHÔNG phải Excel thật) vẫn phải bị chặn ở bước đọc nội dung, không
//      được lọt qua chỉ vì đuôi đúng.
// Và phải CHO QUA đúng 1 file .xlsx thật (dựng bằng ExcelJS) với dữ liệu hợp lệ.
//
// Gọi THẲNG router thật (routes/priceFile.js) qua HTTP thật (multer thật, verifyFileSignature() thật) —
// mirror khuôn tests/test-pricefile-vppcatalog-ownership.js (fake DB pool + fake auth), không giả lập
// lại logic kiểm tra.
//
// Chạy: node server/tests/test-itprice-file-format-reject.js
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

const fakePool = { request() { const req = { input: () => req, query: async () => ({ recordset: [] }) }; return req; } };
stubModule('db', { getPool: async () => fakePool, sql: { NVarChar: (n) => ({ type: 'NVarChar', n }) } });

const PROPOSER = { username: 'proposer', name: 'Người Đề Xuất', dept: 'Phòng A', perms: { itPriceProposeCreateRetail: true, itPriceProposeCreateWholesale: true }, active: true };
const USERS = [PROPOSER];
let CURRENT_USERNAME = PROPOSER.username;

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const priceFileRoutes = require('../routes/priceFile');
const ExcelJS = require('exceljs');

let PORT = 0;
function startApp() {
  const app = express();
  app.use('/api/it-price', priceFileRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function postMultipartFile(buffer, filename, mimeType) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), filename);
  const res = await fetch(`http://127.0.0.1:${PORT}/api/it-price/parse-file`, { method: 'POST', body: form });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function buildValidXlsxBuffer() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.addRow(['Mã hàng', 'Tên mặt hàng', 'Giá cũ', 'Giá mới']);
  ws.addRow(['SP001', 'Mặt hàng A', 10000, 12000]);
  return wb.xlsx.writeBuffer();
}

async function main() {
  const server = await startApp();
  try {
    const formNoFile = new FormData();
    const resNoFile = await fetch(`http://127.0.0.1:${PORT}/api/it-price/parse-file`, { method: 'POST', body: formNoFile });
    check('KHÔNG có tệp đính kèm -> 400 "Thiếu tệp bảng giá"', resNoFile.status === 400);

    const txtBuf = Buffer.from('day khong phai file Excel, chi la van ban thuan');
    const r1 = await postMultipartFile(txtBuf, 'bang-gia.txt', 'text/plain');
    check('Đuôi file KHÔNG hợp lệ (.txt) -> 400, chặn NGAY từ fileFilter (không đọc tới nội dung)',
      r1.status === 400 && /Excel|\.xlsx|\.xls/.test(r1.body?.error || ''), r1.body);

    const fakeXlsx = Buffer.from('day la file .txt gia mao thanh .xlsx, khong co magic bytes that');
    const r2 = await postMultipartFile(fakeXlsx, 'bang-gia-gia-mao.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    check('Đuôi ĐÚNG (.xlsx) nhưng nội dung KHÔNG PHẢI Excel thật -> 400, chặn ở lớp verifyFileSignature() (magic bytes)',
      r2.status === 400 && /không khớp|Nội dung file/.test(r2.body?.error || ''), r2.body);

    const oldExeMagic = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(200, 0)]); // "MZ" = PE/EXE header thật
    const r3 = await postMultipartFile(oldExeMagic, 'file-thuc-thi-doi-ten.xlsx', 'application/octet-stream');
    check('File thực thi (.exe đổi đuôi .xlsx, magic bytes "MZ") -> 400, KHÔNG lọt qua dù đuôi hợp lệ',
      r3.status === 400, r3.body);

    const validBuf = await buildValidXlsxBuffer();
    const r4 = await postMultipartFile(validBuf, 'bang-gia-that.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    check('File .xlsx THẬT hợp lệ -> 200, trả về fileUrl + items đã đọc được từ file',
      r4.status === 200 && !!r4.body?.fileUrl && Array.isArray(r4.body?.items) && r4.body.items.length >= 1, r4.body);

    const xlsRenamedTxt = Buffer.from('gia mao dinh dang .xls cu (CFB/OLE2)');
    const r5 = await postMultipartFile(xlsRenamedTxt, 'bang-gia-cu.xls', 'application/vnd.ms-excel');
    check('Đuôi .xls (định dạng cũ) nhưng nội dung không phải CFB/OLE2 thật -> 400',
      r5.status === 400, r5.body);
  } finally {
    server.close();
  }

  console.log(`\n==== test-itprice-file-format-reject.js: ${pass} pass, ${fail} fail ====`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
