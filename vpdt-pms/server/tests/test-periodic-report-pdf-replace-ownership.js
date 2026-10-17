// server/tests/test-periodic-report-pdf-replace-ownership.js
//
// Regression test cho phần "quyền sở hữu file thay thế" của tính năng "Thay trang bằng bản mới" (Báo
// Cáo Định Kỳ > Tổng Hợp PDF, 11/2026): routes/records.js (POST /reportPeriods/:id/mergePdf) gọi
// assertPayloadFileUrlsOwnedByUser({ pages: req.body?.pages }, freshUser) TRƯỚC khi vào
// mergeReportPeriodPdf() — cùng cơ chế "vá lỗ hổng giả mạo quyền sở hữu file" (9/2026) đã áp dụng cho mọi
// action route khác nhận fileUrl từ client, chặn 1 người tự đặt pages[].replacement.fileUrl = đường dẫn
// tệp THẬT của người khác để "ghép" nội dung không phải của mình vào bản báo cáo chính thức.
//
// Test này gọi THẲNG assertPayloadFileUrlsOwnedByUser()/collectFileUrlsDeep() thật (lib/uploadedFiles.js)
// với ĐÚNG hình dạng payload mà routes/records.js truyền vào ({ pages: [...] }, mỗi phần tử có thể có
// replacement.fileUrl lồng 2 cấp) — xác nhận collectFileUrlsDeep() quét sâu tìm đúng field mới này mà
// không cần sửa gì thêm ở lib/uploadedFiles.js (hàm quét theo REGEX khuôn URL, không theo tên field, nên
// tự phủ được field mới — test này xác nhận đúng giả định đó bằng dữ liệu thật). Chỉ giả lập tầng DB
// (dbo.UploadedFiles) bằng 1 pool trong bộ nhớ, mirror khuôn tests/test-checklist-attachment-ownership.js.
//
// Chạy: node server/tests/test-periodic-report-pdf-replace-ownership.js
'use strict';
const path = require('path');

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

// ===== Fake pool cho dbo.UploadedFiles (mirror khuôn test-checklist-attachment-ownership.js) =====
const uploadedFilesStore = new Map(); // fileUrl -> uploadedBy
const fakePool = {
  request() {
    const params = {};
    const req = {
      input(name, type, value) { params[name] = value; return req; },
      async query(text) {
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

const { assertPayloadFileUrlsOwnedByUser } = require('../lib/uploadedFiles');

const OWNER = { username: 'owner1' };
const OTHER = { username: 'other1' };

async function main() {
  uploadedFilesStore.set('/uploads/mine-abc123.pdf', OWNER.username);
  uploadedFilesStore.set('/uploads/victim-xyz789.pdf', OTHER.username);

  await (async () => {
    try {
      await assertPayloadFileUrlsOwnedByUser({
        pages: [
          { sourceEntryId: 1, sourcePageIndex: 0, replacement: { fileUrl: '/uploads/mine-abc123.pdf', fileName: 'a.pdf' } },
          { sourceEntryId: 2, sourcePageIndex: 0, replacement: null }
        ]
      }, OWNER);
      check('Trang thay thế bằng CHÍNH tệp mình vừa tải lên -> cho qua bình thường', true);
    } catch (err) {
      check('Trang thay thế bằng CHÍNH tệp mình vừa tải lên -> cho qua bình thường', false, err.message);
    }
  })();

  await (async () => {
    let threw = null;
    try {
      await assertPayloadFileUrlsOwnedByUser({
        pages: [
          { sourceEntryId: 1, sourcePageIndex: 0, replacement: { fileUrl: '/uploads/victim-xyz789.pdf', fileName: 'a.pdf' } }
        ]
      }, OWNER);
    } catch (err) { threw = err; }
    check('LỖI ĐÃ VÁ — tự đặt replacement.fileUrl = tệp THẬT của người khác (lồng 2 cấp pages[].replacement.fileUrl) -> bị chặn 403', !!threw && threw.status === 403, threw);
  })();

  await (async () => {
    try {
      await assertPayloadFileUrlsOwnedByUser({
        pages: [
          { sourceEntryId: 1, sourcePageIndex: 0, replacement: { fileUrl: '/uploads/khong-ro-chu-so-huu.pdf', fileName: 'a.pdf' } }
        ]
      }, OWNER);
      check('replacement.fileUrl KHÔNG có trong dbo.UploadedFiles (dữ liệu cũ/không rõ chủ) -> vẫn cho qua, không regression', true);
    } catch (err) {
      check('replacement.fileUrl KHÔNG có trong dbo.UploadedFiles (dữ liệu cũ/không rõ chủ) -> vẫn cho qua, không regression', false, err.message);
    }
  })();

  await (async () => {
    try {
      await assertPayloadFileUrlsOwnedByUser({
        pages: [{ sourceEntryId: 1, sourcePageIndex: 0, replacement: null }]
      }, OWNER);
      check('Không có trang nào mang replacement (chỉ sắp/xoá trang gốc bình thường) -> không gọi DB, cho qua ngay', true);
    } catch (err) {
      check('Không có trang nào mang replacement (chỉ sắp/xoá trang gốc bình thường) -> không gọi DB, cho qua ngay', false, err.message);
    }
  })();

  console.log('');
  console.log(`==== ${pass}/${pass + fail} scenario(s) passed${fail ? `, ${fail} FAILED` : ''} ====`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-periodic-report-pdf-replace-ownership.js:', err);
  process.exitCode = 1;
});
