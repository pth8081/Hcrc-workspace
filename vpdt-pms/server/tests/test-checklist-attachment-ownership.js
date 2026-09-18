// server/tests/test-checklist-attachment-ownership.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026, mức Cao — "giả mạo quyền sở hữu file"):
// POST /api/checklist/submissions/:id/attachments (routes/checklist.js) trước đây CHỈ xác minh đúng
// khuôn "/uploads/<tên-file>" (assertUploadedFileUrl) mà KHÔNG xác minh người gọi có thật sự là người
// vừa tải ảnh đó lên hay không — cho phép tự đặt fileUrl = đường dẫn ảnh THẬT của người khác (đoán/thấy
// được từ 1 bài checklist khác) để "nhận vơ" làm ảnh minh chứng của chính mình. Đã vá bằng cách gọi thêm
// assertPayloadFileUrlsOwnedByUser() (lib/uploadedFiles.js) — CÙNG cơ chế đã dùng cho luồng tạo mới
// chung (routes/create.js) từ 9/2026.
//
// Test này gọi thẳng router THẬT (routes/checklist.js) + lib/uploadedFiles.js THẬT, chỉ giả lập tầng DB
// (dbo.UploadedFiles) bằng 1 pool trong bộ nhớ (mirror khuôn fake-pool đã dùng ở
// tests/test-dsmart16-sync-overlap.js) — không giả lập logic ownership, để test đúng code thật đang
// chạy production.
//
// Chạy: node server/tests/test-checklist-attachment-ownership.js
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

// ===== Fake pool cho dbo.UploadedFiles (mirror khuôn test-dsmart16-sync-overlap.js) =====
const uploadedFilesStore = new Map(); // fileUrl -> uploadedBy
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

const U1 = { username: 'u1', name: 'Nhân Viên Một', dept: 'Siêu thị A', posType: 'STORE', perms: { checklistTemplateManage: true }, active: true };
const U2 = { username: 'u2', name: 'Nhân Viên Hai', dept: 'Siêu thị B', posType: 'STORE', perms: { checklistTemplateManage: true }, active: true };
const USERS = [U1, U2];

let RECORDS;
function resetRecords() { RECORDS = { checklistTemplates: [], checklistSubmissions: [] }; }
resetRecords();
let idSeq = 1000;
let CURRENT_USERNAME = U1.username;
let PORT = 0;

stubModule('lib/appData', {
  getAppDataValue: async () => null,
  getAllAppData: async () => ({}),
  withLockedAppDataValue: async (key, fn) => fn(null)
});
stubModule('lib/recordStore', {
  getAllForCollection: async (collection) => RECORDS[collection] || [],
  insertRecord: async (collection, record) => {
    RECORDS[collection] = RECORDS[collection] || [];
    RECORDS[collection].push(record);
    return record;
  },
  withLockedRecordForCollection: async (collection, id, mutatorFn) => {
    const list = RECORDS[collection] || [];
    const idx = list.findIndex(r => r.id === id);
    if (idx === -1) { const err = new Error('Không tìm thấy bản ghi'); err.statusCode = 404; throw err; }
    const updated = await mutatorFn(list[idx]);
    list[idx] = updated;
    return updated;
  },
  withAppLock: async (key, fn) => fn(),
  deleteRecordForCollection: async () => { throw new Error('không dùng trong test này'); }
});
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
const checklistRoutes = require('../routes/checklist');
const checklist = require('../lib/checklist');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/checklist', checklistRoutes);
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

function seedTemplate() {
  const core = checklist.assertTemplateCoreFields({
    templateCode: 'CL_OWN', templateName: 'Checklist Test Ownership', templateType: 'STORE_SELF', passThreshold: 80
  });
  const questions = checklist.validateChecklistQuestions([{
    text: 'Câu hỏi 1', isRequired: true, maxScore: 10,
    options: [{ text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }]
  }]);
  const template = Object.assign({ id: idSeq++, status: 'ACTIVE', version: 1, clonedFromTemplateId: null, activatedAt: 'now', creator: 'admin', creatorName: 'Admin' }, core, { questions });
  RECORDS.checklistTemplates.push(template);
  return template;
}
function seedSubmission(template, submittedBy) {
  const sub = {
    id: idSeq++, templateId: template.id, templateCode: template.templateCode, templateName: template.templateName,
    templateType: template.templateType, templateVersion: template.version, storeCode: submittedBy.dept,
    submittedByUsername: submittedBy.username, submittedByName: submittedBy.name, status: 'DRAFT',
    answers: [{ questionId: 1, selectedOptionIndex: 0, attachments: [] }], deductions: [],
    totalScore: null, maxPossibleScore: null, scorePercent: null, hasCriticalFail: null, isPassed: null,
    startedAt: 'now', submittedAt: null
  };
  RECORDS.checklistSubmissions.push(sub);
  return sub;
}

async function main() {
  const server = await startApp();
  try {
    // ===== Kịch bản 1: u1 tự đính ảnh MÌNH đã tải lên vào bài của MÌNH -> thành công =====
    resetRecords();
    uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/u1-photo-abc123.jpg', 'u1');
    const template1 = seedTemplate();
    const sub1 = seedSubmission(template1, U1);
    const r1 = await api('POST', `/api/checklist/submissions/${sub1.id}/attachments`, {
      questionId: 1, fileUrl: '/uploads/u1-photo-abc123.jpg', fileName: 'a.jpg', fileType: 'image/jpeg'
    }, U1);
    check('u1 đính ảnh CHÍNH MÌNH đã tải lên vào bài của mình -> thành công (200)', r1.status === 200, r1.body);

    // ===== Kịch bản 2: u2 "nhận vơ" ảnh của u1 vào bài của MÌNH -> PHẢI bị chặn 403 (LỖI ĐÃ VÁ) =====
    resetRecords();
    uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/u1-secret-photo-xyz789.jpg', 'u1');
    const template2 = seedTemplate();
    const sub2 = seedSubmission(template2, U2);
    const r2 = await api('POST', `/api/checklist/submissions/${sub2.id}/attachments`, {
      questionId: 1, fileUrl: '/uploads/u1-secret-photo-xyz789.jpg', fileName: 'stolen.jpg', fileType: 'image/jpeg'
    }, U2);
    check('u2 gắn ảnh của u1 (giả mạo quyền sở hữu) vào bài của mình -> PHẢI bị chặn 403 (LỖI ĐÃ VÁ)',
      r2.status === 403, r2.body);
    check('Bài của u2 KHÔNG được có ảnh của u1 sau khi bị chặn',
      RECORDS.checklistSubmissions.find(s => s.id === sub2.id).answers[0].attachments.length === 0,
      RECORDS.checklistSubmissions.find(s => s.id === sub2.id));

    // ===== Kịch bản 3: fileUrl KHÔNG có trong dbo.UploadedFiles (dữ liệu cũ/hợp lệ trước khi có bảng
    // này) -> vẫn cho qua (fail-open có chủ đích, KHÔNG phải regression). =====
    resetRecords();
    uploadedFilesStore.clear();
    const template3 = seedTemplate();
    const sub3 = seedSubmission(template3, U1);
    const r3 = await api('POST', `/api/checklist/submissions/${sub3.id}/attachments`, {
      questionId: 1, fileUrl: '/uploads/unknown-legacy-file.jpg', fileName: 'legacy.jpg', fileType: 'image/jpeg'
    }, U1);
    check('fileUrl không có trong dbo.UploadedFiles (không rõ chủ) vẫn cho qua bình thường (không regression)',
      r3.status === 200, r3.body);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
