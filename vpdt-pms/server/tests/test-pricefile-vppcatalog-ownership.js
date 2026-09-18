// server/tests/test-pricefile-vppcatalog-ownership.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026, mức Cao — "giả mạo quyền sở hữu file"):
// routes/priceFile.js (POST /api/it-price/master-list/parse-file, và cùng lỗi ở /api/it-price/parse-file)
// và routes/vppCatalog.js (POST /api/vpp/parse-catalog) — khác routes/upload.js chung — LƯU FILE THẬT ra
// đĩa (không xoá sau khi đọc xong) nhưng trước đây KHÔNG ghi nhận chủ sở hữu vào dbo.UploadedFiles.
// fileUrl trả về được client gắn vào itPriceApprovals.files[]/vppPeriods.catalogFileUrl khi tạo hồ sơ —
// assertPayloadFileUrlsOwnedByUser() (routes/create.js) coi file "không có trong bảng" là "không rõ chủ,
// cho qua", nên bất kỳ ai biết được fileUrl của người khác đều gắn được vào hồ sơ của chính mình mà
// không bị chặn — tái hiện đúng lớp lỗi đã vá cho routes/upload.js. Đã vá: gọi recordUploadedFile() ngay
// sau khi file được LƯU THẬT trên đĩa, cùng khuôn routes/upload.js.
//
// Test này gọi thẳng router THẬT (routes/priceFile.js/routes/vppCatalog.js), multer THẬT (ghi file thật
// ra thư mục uploads/), verifyFileSignature() THẬT (buffer .xlsx sinh bằng ExcelJS — file HỢP LỆ thật,
// không giả lập chữ ký), chỉ giả lập tầng DB dbo.UploadedFiles bằng 1 pool trong bộ nhớ (mirror khuôn
// fake-pool ở tests/test-checklist-attachment-ownership.js).
//
// Chạy: node server/tests/test-pricefile-vppcatalog-ownership.js
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');

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

// ===== Fake pool cho dbo.UploadedFiles =====
const uploadedFilesStore = new Map();
const fakePool = {
  request() {
    const params = {};
    const req = {
      input(name, type, value) { params[name] = value; return req; },
      async query(text) {
        if (/INSERT INTO dbo\.UploadedFiles/.test(text)) {
          uploadedFilesStore.set(params.fileUrl, params.uploadedBy);
          return { recordset: [] };
        }
        if (/SELECT FileUrl, UploadedBy FROM dbo\.UploadedFiles/.test(text)) {
          const urls = Object.keys(params).filter(k => k.startsWith('fu')).map(k => params[k]);
          const recordset = urls.filter(u => uploadedFilesStore.has(u)).map(u => ({ FileUrl: u, UploadedBy: uploadedFilesStore.get(u) }));
          return { recordset };
        }
        throw new Error('Fake pool: câu lệnh SQL không xác định được — ' + text);
      }
    };
    return req;
  }
};
stubModule('db', {
  getPool: async () => fakePool,
  sql: { NVarChar: (n) => ({ type: 'NVarChar', n }) }
});

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'X', perms: { admin: true }, active: true };
const VPP_MANAGER = { username: 'vpp1', name: 'Quản Lý VPP', dept: 'X', perms: { vppManage: true }, active: true };
const USERS = [ADMIN, VPP_MANAGER];
let CURRENT_USERNAME = ADMIN.username;

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
const vppCatalogRoutes = require('../routes/vppCatalog');
const ExcelJS = require('exceljs');

let PORT = 0;
function startApp() {
  const app = express();
  app.use('/api/it-price', priceFileRoutes);
  app.use('/api/vpp', vppCatalogRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function buildXlsxBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  rows.forEach(r => ws.addRow(r));
  return wb.xlsx.writeBuffer();
}

async function postMultipartFile(urlPath, buffer, filename, asUser) {
  CURRENT_USERNAME = asUser.username;
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, { method: 'POST', body: form });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function main() {
  const server = await startApp();
  try {
    // ===== routes/priceFile.js — POST /api/it-price/master-list/parse-file (admin-only) =====
    uploadedFilesStore.clear();
    const masterListBuf = await buildXlsxBuffer([['Mã hàng', 'Tên mặt hàng', 'Đơn giá']]);
    const r1 = await postMultipartFile('/api/it-price/master-list/parse-file', masterListBuf, 'master-list.xlsx', ADMIN);
    check('POST /api/it-price/master-list/parse-file trả về 200 kèm fileUrl', r1.status === 200 && !!r1.body?.fileUrl, r1.body);
    if (r1.body?.fileUrl) {
      check('LỖI ĐÃ VÁ: fileUrl PHẢI được ghi nhận vào dbo.UploadedFiles đúng người upload (admin)',
        uploadedFilesStore.get(r1.body.fileUrl) === 'admin',
        { fileUrl: r1.body.fileUrl, recordedOwner: uploadedFilesStore.get(r1.body.fileUrl) });
      // Dọn file vật lý vừa test tạo ra (không phải mục tiêu test, chỉ tránh rác thư mục uploads/).
      const filePath = path.join(__dirname, '..', r1.body.fileUrl);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    // ===== routes/vppCatalog.js — POST /api/vpp/parse-catalog (cần quyền vppManage) =====
    uploadedFilesStore.clear();
    const catalogBuf = await buildXlsxBuffer([
      ['Tên mặt hàng', 'ĐVT', 'Xuất xứ', 'Quy cách', 'Đơn giá'],
      ['Bút bi Thiên Long', 'Cái', 'Việt Nam', 'Hộp 10 cái', '5000']
    ]);
    const r2 = await postMultipartFile('/api/vpp/parse-catalog', catalogBuf, 'catalog.xlsx', VPP_MANAGER);
    check('POST /api/vpp/parse-catalog trả về 200 kèm fileUrl', r2.status === 200 && !!r2.body?.fileUrl, r2.body);
    if (r2.body?.fileUrl) {
      check('LỖI ĐÃ VÁ: fileUrl PHẢI được ghi nhận vào dbo.UploadedFiles đúng người upload (vpp1)',
        uploadedFilesStore.get(r2.body.fileUrl) === 'vpp1',
        { fileUrl: r2.body.fileUrl, recordedOwner: uploadedFilesStore.get(r2.body.fileUrl) });
      const filePath = path.join(__dirname, '..', r2.body.fileUrl);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
