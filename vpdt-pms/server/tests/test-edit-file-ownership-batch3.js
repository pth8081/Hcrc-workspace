// server/tests/test-edit-file-ownership-batch3.js
//
// Regression test cho LỖI NGHIÊM TRỌNG phát hiện ở đợt audit chuyên sâu 12 cụm module (9/2026):
//
//   POST /api/records/internalPosts/:id/edit (editInternalPost, lib/recordActions.js)
//
// là route SỬA DUY NHẤT còn thiếu assertPayloadFileUrlsOwnedByUser() (lib/uploadedFiles.js) — khác 13
// route sửa khác đã vá cùng lớp (xem test-edit-file-ownership.js + test-edit-file-ownership-batch2.js).
// Bài "Góc Chia Sẻ" (type SHARE) ở trạng thái DRAFT mở cho MỌI tài khoản tạo được — kẻ tấn công tạo 1 bài
// nháp, sửa attachment.fileUrl trỏ tới file THẬT của người khác (HĐLĐ, Quyết định lương, chứng từ thanh
// toán, CV ứng viên...) rồi tự đọc được trọn vẹn nội dung, vì internalPosts là checker thứ 6 trong
// findOwningRecord() (lib/fileAuthz.js), thắng trước nhiều checker khác đứng sau nó trong mảng.
//
// Cùng khuôn test-edit-file-ownership-batch2.js: gọi thẳng router THẬT (routes/records.js),
// lib/uploadedFiles.js THẬT (qua 1 fake pool dbo.UploadedFiles), lib/recordActions.js THẬT — chỉ giả lập
// tầng lưu trữ (recordStore/appData).
//
// Chạy: node server/tests/test-edit-file-ownership-batch3.js
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

// ===== Fake pool cho dbo.UploadedFiles (giống batch2) =====
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

let RECORDS;
function defaultRecords() {
  return {
    internalPosts: [
      {
        id: 100, author: 'u1', status: 'DRAFT', type: 'SHARE', title: 'Bài Góc Chia Sẻ test',
        content: 'Nội dung', postCategory: 'CAT1',
        attachment: { fileUrl: '/uploads/existing-post-attachment.pdf', fileName: 'dinh-kem.pdf' },
        comments: [], likes: [], readBy: [], customData: {}
      }
    ]
  };
}
function resetRecords() { RECORDS = defaultRecords(); }
resetRecords();

const APPDATA_STORE = { internalShareCategories: [{ key: 'CAT1', label: 'Chuyên đề 1' }] };

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(defaultRecords())),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    // Mirror ĐÚNG hành vi rollback-safe của DB thật — xem chú thích đầy đủ ở test-edit-file-ownership.js.
    const snapshot = JSON.parse(JSON.stringify(list[idx]));
    const updated = await mutatorFn(snapshot);
    list[idx] = updated;
    return updated;
  },
  withAppLock: async (key, fn) => fn()
});
stubModule('lib/appData', {
  getAllAppData: async () => APPDATA_STORE,
  getAppDataValue: async (key) => APPDATA_STORE[key],
  withLockedAppDataValue: async (key, mutatorFn) => {
    const snapshot = JSON.parse(JSON.stringify(APPDATA_STORE[key]));
    const updated = await mutatorFn(snapshot);
    APPDATA_STORE[key] = updated;
    return updated;
  }
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

const U1 = { username: 'u1', name: 'Người Dùng Một', dept: 'Phòng A', perms: {}, active: true };
const U2 = { username: 'u2', name: 'Người Dùng Hai', dept: 'Phòng B', perms: {}, active: true };
const USERS = [U1, U2];
let CURRENT_USERNAME = U1.username;

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

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordsRoutes);
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

function reset() {
  resetRecords();
  uploadedFilesStore.clear();
  uploadedFilesStore.set('/uploads/u1-owned-file.pdf', 'u1');
  uploadedFilesStore.set('/uploads/u2-secret-file.pdf', 'u2');
}

async function main() {
  const server = await startApp();
  try {
    // LỖI ĐÃ VÁ: gắn attachment.fileUrl trỏ tới file THẬT của người khác (u2) phải bị chặn 403, không
    // được âm thầm "chiếm quyền sở hữu" file đó qua 1 bài Góc Chia Sẻ nháp.
    reset();
    let r = await api('POST', '/api/records/internalPosts/100/edit',
      { title: 'Bài Góc Chia Sẻ test', content: 'Nội dung', postCategory: 'CAT1', attachment: { fileUrl: '/uploads/u2-secret-file.pdf', fileName: 'chiem-doat.pdf' } }, U1);
    check('internalPosts/edit: chặn gắn tệp của người khác (u2) — 403', r.status === 403, r.body);
    check('internalPosts/edit: attachment.fileUrl KHÔNG bị đổi sau khi chặn', RECORDS.internalPosts[0].attachment.fileUrl === '/uploads/existing-post-attachment.pdf', RECORDS.internalPosts[0]);

    // Gắn tệp CHÍNH MÌNH đã tải lên -> vẫn phải hoạt động bình thường (không phá tính năng sửa).
    reset();
    r = await api('POST', '/api/records/internalPosts/100/edit',
      { title: 'Bài Góc Chia Sẻ test', content: 'Nội dung', postCategory: 'CAT1', attachment: { fileUrl: '/uploads/u1-owned-file.pdf', fileName: 'moi.pdf' } }, U1);
    check('internalPosts/edit: gắn tệp CHÍNH MÌNH -> thành công (200)', r.status === 200, r.body);
    check('internalPosts/edit: attachment.fileUrl mới được lưu đúng', RECORDS.internalPosts[0].attachment.fileUrl === '/uploads/u1-owned-file.pdf', RECORDS.internalPosts[0]);

    // Không đổi attachment (giữ nguyên tệp cũ) -> exemptFileUrls phải cho qua, không đòi hỏi lại quyền sở hữu.
    reset();
    r = await api('POST', '/api/records/internalPosts/100/edit',
      { title: 'Đổi tiêu đề, giữ nguyên tệp', content: 'Nội dung', postCategory: 'CAT1', attachment: { fileUrl: '/uploads/existing-post-attachment.pdf', fileName: 'dinh-kem.pdf' } }, U1);
    check('internalPosts/edit: giữ nguyên tệp cũ (exempt) -> thành công (200)', r.status === 200, r.body);
    check('internalPosts/edit: title mới được lưu đúng', RECORDS.internalPosts[0].title === 'Đổi tiêu đề, giữ nguyên tệp', RECORDS.internalPosts[0]);

    // Không phải tác giả và không phải admin -> vẫn bị chặn ở tầng quyền sửa như trước (chưa từng hỏng).
    reset();
    r = await api('POST', '/api/records/internalPosts/100/edit',
      { title: 'Chiếm bài của người khác', content: 'X', postCategory: 'CAT1' }, U2);
    check('internalPosts/edit: người không phải tác giả/admin bị chặn 403 (không liên quan tới lớp vá file)', r.status === 403, r.body);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
