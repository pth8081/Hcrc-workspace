// server/tests/test-audit-cluster-license-cascade-download-limit.js
//
// Regression test cho 2 phát hiện CÒN LẠI (mức Trung bình) của đợt audit chuyên sâu cụm "Văn Bản Trình /
// Hợp Đồng / Giấy Phép / Thanh Toán / Tài Liệu" — 2 mục này cần chạy qua ROUTER HTTP THẬT nên tách khỏi
// tests/test-audit-cluster-vbt-hd-gp-tt-tl.js (thuần unit):
//
//   8.  [Giấy Phép] POST /api/records/licenses/:id/delete TRƯỚC ĐÂY dùng deleteAdminOnly() PHẲNG — xoá
//       bản GỐC để lại toàn bộ phiên bản con (rootLicenseId trỏ vào id đã biến mất) MỒ CÔI vĩnh viễn,
//       khác hẳn docs/contracts vốn đã có cascade + khoá family. Kèm theo: routes/create.js thiếu
//       `license_family:<rootId>` trong familyLockKey dù licenses cũng có versioning -> race "tạo phiên
//       bản mới" đan xen "xoá cả họ".
//  13.  GET /api/files/download (đóng dấu watermark PDF: đọc cả file + PDFDocument.load/embedFont/save
//       mỗi lượt) TRƯỚC ĐÂY chỉ có globalApiRateLimiter chung 600 req/phút — nay có rate-limiter RIÊNG
//       60 lượt/phút khoá theo USERNAME (routes/download.js).
//
// Gọi THẲNG router thật (routes/records.js, routes/download.js) qua http.createServer, chỉ giả lập tầng
// lưu trữ (lib/recordStore, lib/appData) + middleware xác thực (lib/auth) — cùng khuôn
// tests/test-edit-file-ownership-batch2.js / tests/test-catalog-rename-server.js.
//
// Chạy: node server/tests/test-audit-cluster-license-cascade-download-limit.js
'use strict';
const http = require('http');
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

// ===================== Tầng lưu trữ giả =====================
let RECORDS;
let LOCK_KEYS_USED;
function defaultRecords() {
  return {
    licenses: [
      // 1 "họ" giấy phép: bản gốc (id 1) + 2 phiên bản con
      { id: 1, code: 'HCRC-HC-GP-001', displayCode: 'HCRC-HC-GP-001', rootLicenseId: null, versionNumber: 1, creator: 'u1', status: 'APPROVED' },
      { id: 2, code: 'HCRC-HC-GP-001-V2', displayCode: 'HCRC-HC-GP-001', rootLicenseId: 1, versionNumber: 2, creator: 'u1', status: 'APPROVED' },
      { id: 3, code: 'HCRC-HC-GP-001-V3', displayCode: 'HCRC-HC-GP-001', rootLicenseId: 1, versionNumber: 3, creator: 'u1', status: 'REJECTED' },
      // 1 họ KHÁC — phải KHÔNG bị đụng tới khi xoá họ trên
      { id: 10, code: 'HCRC-HC-GP-002', displayCode: 'HCRC-HC-GP-002', rootLicenseId: null, versionNumber: 1, creator: 'u1', status: 'APPROVED' },
      { id: 11, code: 'HCRC-HC-GP-002-V2', displayCode: 'HCRC-HC-GP-002', rootLicenseId: 10, versionNumber: 2, creator: 'u1', status: 'APPROVED' }
    ]
  };
}
function resetRecords() { RECORDS = defaultRecords(); LOCK_KEYS_USED = []; }
resetRecords();

stubModule('db', { getPool: async () => { throw new Error('không dùng DB trong test này'); }, sql: {} });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['licenses']),
  getAllForCollection: async (c) => (RECORDS[c] || []).map(x => ({ ...x })),
  deleteRecordForCollection: async (c, id, guardFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    if (guardFn) await guardFn(list[idx]);
    list.splice(idx, 1);
  },
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    const updated = await mutatorFn(JSON.parse(JSON.stringify(list[idx])));
    list[idx] = updated;
    return updated;
  },
  withLockedRecordById: async (c, id, fn) => fn(),
  withAppLock: async (key, fn) => { LOCK_KEYS_USED.push(key); return fn(); },
  createForCollection: async () => { throw new Error('không dùng trong test này'); },
  insertRecord: async () => { throw new Error('không dùng trong test này'); },
  CODE_SEQ_SUFFIX_RE: /^(.*?)(\d+)$/,
  computeNextSeqForPrefix: () => 1
});
stubModule('lib/appData', {
  getAllAppData: async () => ({}),
  getAppDataValue: async () => ({}),
  getAppDataValueCached: async () => ({}),
  withLockedAppDataValue: async (key, fn) => fn([])
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
stubModule('lib/uploadedFiles', { assertPayloadFileUrlsOwnedByUser: async () => {} });
// lib/fileAuthz thật cần recordStore/appData/recordViewScope — ở bộ test này chỉ cần biết "cho qua"
// (mục 13 kiểm RATE-LIMIT, không kiểm phân quyền — phần đó đã có tests/test-uploads-file-authz.js).
stubModule('lib/fileAuthz', {
  parseUploadsFileUrl: (u) => {
    const m = /^\/uploads\/([^/\\]+)$/.exec(String(u || ''));
    return m && m[1] !== '.' && m[1] !== '..' ? m[1] : null;
  },
  authorizeFileAccess: async () => true
});

const ADMIN = { username: 'admin1', name: 'Quản Trị', dept: 'Hành Chính', perms: { admin: true }, active: true };
const USER = { username: 'u1', name: 'Người Dùng', dept: 'Hành Chính', perms: { licenseCreate: true }, active: true };
const USERS = [ADMIN, USER];
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
const recordsRoutes = require('../routes/records');
const downloadRoutes = require('../routes/download');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordsRoutes);
  // Mount giống server.js: requireAuth chạy TRƯỚC router tải tệp (rate-limiter khoá theo
  // req.freshUser.username nên phải có phiên trước).
  const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
  app.use('/api/files/download', requireAuth, blockIfMustChangePassword, downloadRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}
async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function main() {
  const server = await startApp();
  try {
    // ===== 8. Cascade xoá "họ" Giấy Phép + khoá license_family =====
    resetRecords();
    let r = await api('POST', '/api/records/licenses/1/delete', {}, ADMIN);
    check('8a. Xoá bản GỐC -> 200', r.status === 200, r.body);
    check('8b. Xoá bản GỐC CASCADE luôn mọi phiên bản con (trước vá: còn lại 2 bản mồ côi rootLicenseId=1)',
      !RECORDS.licenses.some(l => l.id === 1 || l.rootLicenseId === 1), RECORDS.licenses.map(l => l.id));
    check('8c. Họ giấy phép KHÁC không bị đụng tới',
      RECORDS.licenses.filter(l => l.id === 10 || l.rootLicenseId === 10).length === 2, RECORDS.licenses.map(l => l.id));
    check('8d. Dùng ĐÚNG khoá `license_family:<rootId>` (cùng khoá routes/create.js dùng khi tạo phiên bản mới)',
      LOCK_KEYS_USED.includes('license_family:1'), LOCK_KEYS_USED);

    resetRecords();
    r = await api('POST', '/api/records/licenses/2/delete', {}, ADMIN);
    check('8e. Xoá 1 PHIÊN BẢN CON -> chỉ xoá đúng bản đó, bản gốc + phiên bản khác giữ nguyên',
      r.status === 200 && RECORDS.licenses.filter(l => l.id === 1 || l.rootLicenseId === 1).length === 2,
      RECORDS.licenses.map(l => l.id));
    check('8f. Xoá phiên bản con vẫn khoá theo ID GỐC của cả họ (chống race với lượt tạo phiên bản mới)',
      LOCK_KEYS_USED.includes('license_family:1'), LOCK_KEYS_USED);

    resetRecords();
    r = await api('POST', '/api/records/licenses/1/delete', {}, USER);
    check('8g. Người KHÔNG phải admin vẫn bị chặn xoá (giữ nguyên quyền cũ)', r.status === 403, r.body);
    check('8h. ...và KHÔNG xoá gì cả', RECORDS.licenses.length === 5, RECORDS.licenses.length);

    resetRecords();
    r = await api('POST', '/api/records/licenses/999/delete', {}, ADMIN);
    check('8i. Xoá id không tồn tại -> 404', r.status === 404, r.body);

    // routes/create.js: khoá family cho licenses phải được KHAI (kiểm bằng cách đọc chính nguồn — route
    // tạo cần cả chục stub khác mới chạy được HTTP, không đáng dựng riêng ở đây).
    const createSrc = require('fs').readFileSync(path.join(__dirname, '..', 'routes', 'create.js'), 'utf8');
    check('8j. routes/create.js dựng khoá `license_family:` khi tạo phiên bản giấy phép mới (trước vá: chỉ có docs/contracts)',
      /license_family:\$\{req\.body\.rootLicenseId\}/.test(createSrc));

    // ===== 13. Rate-limit riêng cho GET /api/files/download =====
    // Giới hạn 60 lượt/phút/tài khoản — bắn 62 lượt liên tiếp: 60 lượt đầu KHÔNG bị 429 (404 vì tệp
    // không có thật trên đĩa, đủ để chứng minh request đi qua được limiter), 2 lượt cuối phải 429.
    let firstBlockedAt = null;
    let sawNonBlocked = 0;
    for (let i = 1; i <= 62; i++) {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/files/download?fileUrl=/uploads/khong-co-that.pdf`);
      if (res.status === 429) { if (firstBlockedAt === null) firstBlockedAt = i; }
      else sawNonBlocked++;
    }
    check('13a. GET /api/files/download có rate-limiter RIÊNG — lượt thứ 61 trở đi bị chặn 429 (trước vá: chỉ giới hạn chung 600 req/phút, không bao giờ chạm tới ở đây)',
      firstBlockedAt === 61, { firstBlockedAt, sawNonBlocked });
    check('13b. 60 lượt đầu KHÔNG bị chặn oan (ngưỡng đủ dư cho thao tác tải thật, kể cả "Tải tất cả tệp")',
      sawNonBlocked === 60, sawNonBlocked);

    console.log(`\n=== ${pass} passed, ${fail} failed ===`);
    if (fail) process.exitCode = 1;
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
