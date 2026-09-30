// server/tests/test-trainingdocuments-encrypted-pdf-pagecount.js — Đào Tạo: PDF có cờ mã hoá
// permission-only (KHÔNG cần mật khẩu để MỞ XEM — phổ biến với file xuất từ Word "Hạn chế chỉnh
// sửa"/scan-OCR/đặt bảo mật qua Adobe) vẫn phải tính được pageCount THẬT ở server, không còn kẹt vĩnh
// viễn ở pageCount=null (10/2026, người dùng báo "cuộn hết PDF không thấy báo hoàn thành").
//
// Root cause đã vá: routes/create.js builderFn (trainingDocuments) gọi PDFDocument.load(bytes) KHÔNG
// truyền { ignoreEncryption: true } — pdf-lib mặc định ném EncryptedPDFError cho MỌI PDF có /Encrypt,
// kể cả loại chỉ giới hạn quyền in/sửa không cần mật khẩu mở xem, nhánh catch() nuốt lỗi khiến
// pageCount giữ null mãi mãi -> isTrainingPdfProgressComplete() (lib/recordActions.js) luôn false vì
// pageCount<=0, dù người xem đã cuộn hết 100% trang thật qua PDF.js (window.renderPdfProtected, vẫn mở
// được các file này bình thường).
//
// KIẾN TRÚC: chạy thẳng express router THẬT (routes/create.js) trong tiến trình Node, giống khuôn
// tests/test-audit-round2-internalcomms-training-routes.js — chỉ giả lập tầng lưu trữ (recordStore/
// appData) + middleware xác thực, KHÔNG mock PDFDocument/pdf-lib (đây chính là hàm cần xác nhận hành vi
// thật). File PDF mã hoá thật được đặt vào server/uploads/ (dọn lại ở finally), tạo bằng pikepdf (Python)
// vì pdf-lib bản cài trong dự án này không tự mã hoá được (không có PDFDocument.prototype.encrypt).
//
// Chạy: node server/tests/test-trainingdocuments-encrypted-pdf-pagecount.js
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

let PORT = 0;
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true, trainingManage: true }, active: true };
const USERS = [ADMIN];

const RECORDS = { trainingDocuments: [], trainingCourses: [] };

const { HttpError } = require('../lib/httpErrors');

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key === 'sensitiveKeywords' ? [] : null),
  getAllAppData: async () => ({ users: USERS, depts: ['Ban Giám Đốc'], stores: [] }),
  withLockedAppDataValue: async (key, fn) => fn(null)
});

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(RECORDS)),
  getAllForCollectionCached: async (c) => RECORDS[c] || [],
  getAllForCollection: async (c) => RECORDS[c] || [],
  getTrashItems: async () => [],
  createForCollection: async (c, builderFn) => {
    const list = RECORDS[c] || (RECORDS[c] = []);
    const record = await builderFn(list);
    list.push(record);
    return record;
  },
  createForCollectionSerialized: async () => { throw new Error('không dùng trong bài test này'); },
  withLockedRecordForCollection: async () => { throw new Error('không dùng trong bài test này'); },
  withLockedRecordById: async () => { throw new Error('không dùng trong bài test này'); },
  withAppLock: async (key, fn) => fn()
});

stubModule('lib/uploadedFiles', {
  recordUploadedFile: async () => {}, getFileUrlOwners: async () => new Map(),
  assertPayloadFileUrlsOwnedByUser: async () => {}, collectFileUrlsDeep: () => {}
});

stubModule('lib/systemLogStore', { insertSystemLog: async () => {}, getAllSystemLogsCached: async () => [] });

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    req.user = { username: ADMIN.username, name: ADMIN.name };
    req.freshUser = ADMIN;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => `hashed:${p}`,
  isBcryptHash: (v) => String(v || '').startsWith('hashed:'),
  validatePin: () => null
});

// ===================== Require code THẬT =====================
const express = require('express');
const { createRunner, assert, assertEqual } = require('./testHarness');
const createRoutes = require('../routes/create');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request({
      hostname: '127.0.0.1', port: PORT, path: urlPath, method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch (e) { /* ignore */ }
        resolve({ status: res.statusCode, body: json, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
// Dựng file PDF mã hoá permission-only bằng Python/pikepdf (đúng cách đã dùng để verify fix thủ công) —
// pdf-lib bản cài trong dự án không tự mã hoá được PDF (không có PDFDocument.prototype.encrypt).
function ensureEncryptedFixture() {
  const scratch = process.env.CLAUDE_SCRATCH_PDF_FIXTURE;
  if (scratch && fs.existsSync(scratch)) return fs.readFileSync(scratch);
  const { execFileSync } = require('child_process');
  const tmpOut = path.join(require('os').tmpdir(), `enc-permission-only-${Date.now()}.pdf`);
  const py = `
import pikepdf
pdf = pikepdf.new()
for i in range(3):
    pdf.add_blank_page(page_size=(200, 200))
pdf.save(${JSON.stringify(tmpOut)}, encryption=pikepdf.Encryption(owner='owner-secret', user='', allow=pikepdf.Permissions(print_lowres=True, print_highres=False)))
`;
  execFileSync('python3', ['-c', py], { stdio: 'pipe' });
  const bytes = fs.readFileSync(tmpOut);
  fs.unlinkSync(tmpOut);
  return bytes;
}

async function main() {
  const { run, summary } = createRunner();
  const server = await startApp();
  const uploadedNames = [];

  function seedUploadedPdf(bytes, name) {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const fname = name;
    fs.writeFileSync(path.join(UPLOAD_DIR, fname), bytes);
    uploadedNames.push(fname);
    return `/uploads/${fname}`;
  }

  try {
    const encryptedBytes = ensureEncryptedFixture();

    await run('PDF mã hoá permission-only (3 trang, không cần mật khẩu mở xem) -> pageCount=3 sau khi vá (trước đây kẹt null mãi)', async () => {
      const fileUrl = seedUploadedPdf(encryptedBytes, `test-enc-${Date.now()}.pdf`);
      const res = await api('POST', '/api/create/trainingDocuments', {
        category: 'ATLD', title: 'Tài liệu PDF mã hoá (test)', docType: 'DOCUMENT',
        fileUrl, fileName: 'tai-lieu.pdf', fileType: 'application/pdf'
      });
      assertEqual(res.status, 200, `phải tạo thành công (200), nhận được: ${res.status} — ${res.raw}`);
      assertEqual(res.body.item && res.body.item.pageCount, 3, 'pageCount phải tính đúng = 3 dù PDF có cờ mã hoá permission-only');
    });

    await run('PDF thường (không mã hoá) vẫn hoạt động như cũ (không regression)', async () => {
      const { PDFDocument } = require('pdf-lib');
      const plain = await PDFDocument.create();
      plain.addPage([200, 200]); plain.addPage([200, 200]);
      const bytes = await plain.save();
      const fileUrl = seedUploadedPdf(Buffer.from(bytes), `test-plain-${Date.now()}.pdf`);
      const res = await api('POST', '/api/create/trainingDocuments', {
        category: 'ATLD', title: 'Tài liệu PDF thường (test)', docType: 'DOCUMENT',
        fileUrl, fileName: 'tai-lieu-thuong.pdf', fileType: 'application/pdf'
      });
      assertEqual(res.status, 200, `phải tạo thành công (200), nhận được: ${res.status} — ${res.raw}`);
      assertEqual(res.body.item && res.body.item.pageCount, 2, 'pageCount PDF thường vẫn tính đúng như trước');
    });

    await run('File .pdf hỏng/không parse được -> pageCount vẫn giữ null (an toàn, không tự động hoàn thành)', async () => {
      const fileUrl = seedUploadedPdf(Buffer.from('%PDF-1.4 không phải PDF thật, cố ý hỏng'), `test-broken-${Date.now()}.pdf`);
      const res = await api('POST', '/api/create/trainingDocuments', {
        category: 'ATLD', title: 'Tài liệu PDF hỏng (test)', docType: 'DOCUMENT',
        fileUrl, fileName: 'hong.pdf', fileType: 'application/pdf'
      });
      assertEqual(res.status, 200, `phải vẫn tạo được hồ sơ (200), chỉ pageCount=null: ${res.status} — ${res.raw}`);
      assertEqual(res.body.item && res.body.item.pageCount, null, 'file PDF hỏng không parse được thì pageCount phải giữ null (không đoán bừa)');
    });

    summary();
  } finally {
    for (const fname of uploadedNames) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, fname)); } catch (e) { /* ignore */ }
    }
    server.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
