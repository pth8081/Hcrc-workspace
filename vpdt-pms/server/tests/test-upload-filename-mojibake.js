// server/tests/test-upload-filename-mojibake.js
//
// Regression test cho lỗi THẬT người dùng báo (10/2026, kèm ảnh chụp màn hình thật): tên tệp tải lên
// chứa ký tự Unicode (VD tiếng Việt có dấu — "Test gia hạn mới.xlsx") hiện ra lỗi font kiểu
// "Test gia há°±n má»›i.xlsx" ở cột "Tệp Bảng Giá" (Phê Duyệt Giá, module-itsupport-price.js) và nhiều
// màn khác dùng chung routes/upload.js hoặc các route Excel import riêng.
//
// Nguyên nhân: multer/busboy mặc định đọc tham số "filename=" trong header Content-Disposition của
// multipart/form-data bằng latin1 (không cấu hình defParamCharset) — trong khi trình duyệt (và
// FormData/Blob/fetch chuẩn của Node, xác nhận THẬT bằng test này) gửi NGUYÊN BYTE UTF-8 cho
// "filename=" (không dùng cú pháp mở rộng RFC 5987 "filename*=UTF-8''..." mà chỉ server dùng khi TRẢ
// tệp về, xem priceFile.js) — mỗi ký tự có dấu bị tách thành 2-3 ký tự latin1 sai.
//
// Đã vá bằng lib/uploadFilename.js::fixUploadedFilename() (decode lại latin1→utf8, tự động KHÔNG áp
// dụng nếu sinh ký tự lỗi U+FFFD — an toàn cho tên tệp thuần ASCII hoặc trường hợp hiếm đã đúng UTF-8
// từ trước) — áp dụng ngay sau khi nhận req.file ở 16 route multer có echo lại tên tệp cho client.
//
// Test này gọi THẬT router routes/upload.js (route gốc nơi người dùng báo lỗi) qua 1 server HTTP thật,
// multer THẬT (ghi file thật ra uploads/), dùng FormData/Blob/fetch chuẩn của Node (encode multipart
// y hệt trình duyệt thật — xác nhận bug tái hiện được THẬT qua đường này, không chỉ suy luận lý
// thuyết) — đúng khuôn tests/test-pricefile-vppcatalog-ownership.js.
//
// Chạy: node server/tests/test-upload-filename-mojibake.js
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

// routes/upload.js tự ghi nhận chủ sở hữu vào dbo.UploadedFiles — giả lập 1 pool trong bộ nhớ, cùng
// khuôn tests/test-pricefile-vppcatalog-ownership.js (không phải mục tiêu test này).
const fakePool = {
  request() {
    const req = {
      input() { return req; },
      async query(text) {
        if (/INSERT INTO dbo\.UploadedFiles/.test(text)) return { recordset: [] };
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
stubModule('lib/auth', {
  requireAuth: (req, res, next) => { req.user = { username: ADMIN.username, name: ADMIN.name }; req.freshUser = ADMIN; next(); },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const ExcelJS = require('exceljs');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const uploadRoutes = require('../routes/upload');

let PORT = 0;
function startApp() {
  const app = express();
  // Mount đúng khuôn server.js thật (app.use('/api/upload', requireAuth, blockIfMustChangePassword,
  // uploadRoutes)) — routes/upload.js tự nó KHÔNG gọi requireAuth, dựa vào server.js gắn sẵn.
  app.use('/api/upload', requireAuth, blockIfMustChangePassword, uploadRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function postFile(buffer, filename, mime) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), filename);
  const res = await fetch(`http://127.0.0.1:${PORT}/api/upload`, { method: 'POST', body: form });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function main() {
  const server = await startApp();
  try {
    // File .xlsx THẬT (sinh bằng ExcelJS, vượt qua verifyFileSignature() THẬT) — nội dung bên trong
    // không quan trọng với test này, chỉ cần đúng định dạng khai báo.
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sheet1').addRow(['test']);
    const xlsxBuf = Buffer.from(await wb.xlsx.writeBuffer());

    // ===== Kịch bản THẬT người dùng báo: "Test gia hạn mới.xlsx" =====
    const r1 = await postFile(xlsxBuf, 'Test gia hạn mới.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    check('POST /api/upload trả về 200', r1.status === 200, r1.body);
    check('LỖI ĐÃ VÁ: fileName trả về ĐÚNG tiếng Việt có dấu, không lỗi font (mojibake)',
      r1.body?.fileName === 'Test gia hạn mới.xlsx', r1.body);
    if (r1.body?.fileUrl) {
      const p = path.join(__dirname, '..', r1.body.fileUrl);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    // ===== Kịch bản khác từ ảnh người dùng gửi: "261006 Test TĂG.xlsx" (có dấu Ă) =====
    const r2 = await postFile(xlsxBuf, '261006 Test TĂG.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    check('Tên tệp có dấu Ă giữ nguyên đúng', r2.body?.fileName === '261006 Test TĂG.xlsx', r2.body);
    if (r2.body?.fileUrl) {
      const p = path.join(__dirname, '..', r2.body.fileUrl);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    // ===== Tên tệp thuần ASCII (không dấu) — PHẢI giữ nguyên y hệt, không bị fix làm hỏng =====
    const r3 = await postFile(xlsxBuf, 'Test KM.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    check('Tên tệp thuần ASCII không bị ảnh hưởng bởi bản vá (round-trip identity)',
      r3.body?.fileName === 'Test KM.xlsx', r3.body);
    if (r3.body?.fileUrl) {
      const p = path.join(__dirname, '..', r3.body.fileUrl);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  } finally {
    server.close();
  }

  console.log(`\n${pass} PASS, ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('Lỗi chạy test:', e); process.exit(1); });
