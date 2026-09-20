// server/tests/test-audit-round5-checklist.js
//
// Đợt rà soát chuyên sâu 10/2026 — 2 phát hiện mức Thấp của cụm Checklist, chạy thẳng routes/checklist.js
// THẬT qua HTTP với các lib bị stub (cùng khuôn tests/test-checklist.js):
//
//   14. Nhân bản từ ARCHIVED không kiểm version đã tồn tại -> 2 mẫu CÙNG templateCode trùng version
//       (VD v1 ARCHIVED + v2 ACTIVE, nhân bản v1 lại ra thêm 1 "v2" thứ hai).
//   15. moduleKey lúc tải tệp do CLIENT tự khai (routes/upload.js) -> né được ràng buộc "chỉ ảnh" của
//       checklistAnswerPhoto rồi gắn thẳng tệp .pdf/.docx làm "Ảnh minh chứng" qua
//       POST /api/checklist/submissions/:id/attachments (route này trước đây chỉ kiểm hình dạng URL +
//       quyền sở hữu tệp, không kiểm loại tệp).
//
// (Phát hiện 13 — nút "Nhân Bản" hiện nhầm cho mẫu NHÁP — là lớp UI, kiểm ở
//  tests/test-checklist-config-actions-ui.js đã cập nhật.)
//
// Chạy: node server/tests/test-audit-round5-checklist.js
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

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', posType: 'HO', perms: { admin: true }, active: true };
const STORE_EMP = { username: 'nva', name: 'Nhân Viên Siêu Thị A', dept: 'Siêu thị A', posType: 'STORE', perms: {}, active: true };
const USERS = [ADMIN, STORE_EMP];

let RECORDS = { checklistTemplates: [], checklistSubmissions: [] };
function resetRecords() { RECORDS = { checklistTemplates: [], checklistSubmissions: [] }; }

let PORT = 0;
let CURRENT_USERNAME = ADMIN.username;
let idSeq = 2000;
// Cấu hình "Loại Tệp Cho Phép" của admin cho từng module (uploadFileTypeConfig) — mặc định KHÔNG cấu
// hình riêng cho checklistAnswerPhoto (rơi về danh sách ảnh mặc định ở routes/checklist.js).
let UPLOAD_FILE_TYPE_CONFIG = null;

stubModule('lib/appData', {
  getAppDataValue: async () => null,
  getAppDataValueCached: async (key) => (key === 'uploadFileTypeConfig' ? UPLOAD_FILE_TYPE_CONFIG : null),
  getAllAppData: async () => ({}),
  withLockedAppDataValue: async (key, fn) => fn(null)
});

stubModule('lib/recordStore', {
  getAllForCollection: async (collection) => RECORDS[collection] || [],
  insertRecord: async (collection, record) => {
    if (record.id == null) throw new Error(`insertRecord('${collection}', ...) thiếu record.id`);
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
  deleteRecordForCollection: async () => true
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

// Quyền sở hữu tệp (dbo.UploadedFiles) không thuộc phạm vi bài test này — coi như mọi tệp đều của chính
// người gọi, để kiểm ĐÚNG lớp kiểm tra loại tệp mới thêm.
stubModule('lib/uploadedFiles', {
  assertPayloadFileUrlsOwnedByUser: async () => {},
  recordUploadedFile: async () => {},
  getFileUrlOwners: async () => new Map(),
  collectFileUrlsDeep: () => {}
});

const express = require('express');
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');
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

function seedTemplate(overrides) {
  const core = checklist.assertTemplateCoreFields(Object.assign({
    templateCode: 'CL_TEST', templateName: 'Checklist Kiểm Tra', templateType: 'STORE_SELF', passThreshold: 80
  }, overrides));
  const questions = checklist.validateChecklistQuestions(overrides?.questions || [
    {
      text: 'Vệ sinh khu vực quầy có đạt không?', isRequired: true, maxScore: 10,
      options: [
        { text: 'Đạt', scoreValue: 10, isPassing: true },
        { text: 'Không đạt', scoreValue: 0, isPassing: false }
      ]
    }
  ]);
  const template = Object.assign({
    id: idSeq++, status: 'DRAFT', version: overrides?.version || 1, clonedFromTemplateId: null,
    activatedAt: null, creator: 'admin', creatorName: 'Quản Trị Viên'
  }, core, { questions });
  RECORDS.checklistTemplates.push(template);
  return template;
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    // ===================== 14) Nhân bản: version phải là số CHƯA tồn tại =====================
    await run.run('Mục 14 — LỖI ĐÃ VÁ: nhân bản từ bản ARCHIVED cũ KHÔNG tạo ra version trùng', async () => {
      resetRecords();
      const v1 = seedTemplate({ version: 1 });
      v1.status = 'ARCHIVED';
      const v2 = seedTemplate({ version: 2 });
      v2.status = 'ACTIVE';

      const res = await api('POST', `/api/checklist/templates/${v1.id}/clone`, {}, ADMIN);
      assertEqual(res.status, 200, 'Nhân bản từ ARCHIVED vẫn phải thành công (v23.4)');
      assertEqual(res.body.item.version, 3, 'Phải lấy version LỚN NHẤT đang có (2) + 1 = 3, không phải 1+1=2');
      const sameVersion = RECORDS.checklistTemplates.filter(t => t.templateCode === v1.templateCode && t.version === 2);
      assertEqual(sameVersion.length, 1, 'Không được có 2 mẫu cùng templateCode trùng version');
    });

    await run.run('Mục 14 — nhân bản từ bản ACTIVE mới nhất vẫn tăng đúng 1 bậc như cũ', async () => {
      resetRecords();
      const v1 = seedTemplate({ version: 1 });
      v1.status = 'ACTIVE';
      const res = await api('POST', `/api/checklist/templates/${v1.id}/clone`, {}, ADMIN);
      assertEqual(res.body.item.version, 2, 'Hành vi cũ cho trường hợp thường: version + 1');
      assertEqual(res.body.item.status, 'DRAFT', 'Bản nhân bản luôn là NHÁP');
    });

    await run.run('Mục 14 — version chỉ tính theo ĐÚNG templateCode, không ăn theo mã khác', async () => {
      resetRecords();
      const other = seedTemplate({ templateCode: 'CL_KHAC', version: 9 });
      other.status = 'ACTIVE';
      const mine = seedTemplate({ templateCode: 'CL_RIENG', version: 1 });
      mine.status = 'ACTIVE';
      const res = await api('POST', `/api/checklist/templates/${mine.id}/clone`, {}, ADMIN);
      assertEqual(res.body.item.version, 2, 'Mã khác (v9) không được ảnh hưởng tới mã này');
    });

    await run.run('Mục 13 (đối chứng server) — nhân bản mẫu NHÁP vẫn bị từ chối 409 như cũ', async () => {
      resetRecords();
      const draft = seedTemplate();
      const res = await api('POST', `/api/checklist/templates/${draft.id}/clone`, {}, ADMIN);
      assertEqual(res.status, 409, 'Server luôn từ chối nhân bản bản NHÁP -> client phải ẩn nút');
    });

    // ===================== 15) Ảnh minh chứng: chỉ nhận ẢNH THẬT =====================
    function seedSubmissionForStoreA() {
      const template = seedTemplate();
      template.status = 'ACTIVE';
      const sub = {
        id: idSeq++, templateId: template.id, templateCode: template.templateCode,
        templateKind: 'QA', storeCode: 'Siêu thị A', status: 'DRAFT',
        submittedByUsername: STORE_EMP.username, submittedByName: STORE_EMP.name,
        answers: [{ questionId: template.questions[0].id, selectedOptionId: template.questions[0].options[0].id, attachments: [] }]
      };
      RECORDS.checklistSubmissions.push(sub);
      return { template, sub };
    }

    await run.run('Mục 15 — LỖI ĐÃ VÁ: gắn tệp .pdf (tải lên với moduleKey khác) làm ảnh minh chứng -> 400', async () => {
      resetRecords();
      UPLOAD_FILE_TYPE_CONFIG = null;
      const { template, sub } = seedSubmissionForStoreA();
      const res = await api('POST', `/api/checklist/submissions/${sub.id}/attachments`, {
        questionId: template.questions[0].id, fileUrl: '/uploads/1700000000-abcdef0123456789.pdf',
        fileName: 'tai-lieu.pdf', fileType: 'application/pdf'
      }, STORE_EMP);
      assertEqual(res.status, 400, 'Tệp không phải ảnh phải bị từ chối bất kể moduleKey client đã khai');
      assertIncludes(res.body.error, 'chỉ nhận tệp ảnh', 'Thông báo phải nói rõ lý do');
      const refreshed = RECORDS.checklistSubmissions.find(s => s.id === sub.id);
      assertEqual((refreshed.answers[0].attachments || []).length, 0, 'Không được ghi gì vào bài làm');
    });

    await run.run('Mục 15 — .docx cũng bị chặn (không chỉ .pdf)', async () => {
      resetRecords();
      UPLOAD_FILE_TYPE_CONFIG = null;
      const { template, sub } = seedSubmissionForStoreA();
      const res = await api('POST', `/api/checklist/submissions/${sub.id}/attachments`, {
        questionId: template.questions[0].id, fileUrl: '/uploads/1700000000-abcdef0123456789.docx'
      }, STORE_EMP);
      assertEqual(res.status, 400, 'Tệp văn bản không phải ảnh minh chứng');
    });

    await run.run('Mục 15 — ảnh THẬT (.jpg/.png/.webp) vẫn gắn được bình thường (không đổi hành vi cũ)', async () => {
      resetRecords();
      UPLOAD_FILE_TYPE_CONFIG = null;
      const { template, sub } = seedSubmissionForStoreA();
      const res = await api('POST', `/api/checklist/submissions/${sub.id}/attachments`, {
        questionId: template.questions[0].id, fileUrl: '/uploads/1700000000-abcdef0123456789.jpg',
        fileName: 'bang-chung.jpg', fileType: 'image/jpeg'
      }, STORE_EMP);
      assertEqual(res.status, 200, 'Ảnh hợp lệ phải gắn được');
      assertEqual(res.body.item.answers[0].attachments.length, 1, 'Ảnh phải được ghi vào đúng câu trả lời');
    });

    await run.run('Mục 15 — tôn trọng cấu hình admin ("Quản Lý Tệp File") cho checklistAnswerPhoto', async () => {
      resetRecords();
      // Admin chủ động cho phép thêm .pdf cho riêng mục ảnh minh chứng -> route phải theo cấu hình đó,
      // mirror ĐÚNG thứ tự ưu tiên ở routes/upload.js (không hard-code cứng danh sách ảnh).
      UPLOAD_FILE_TYPE_CONFIG = { checklistAnswerPhoto: ['.jpg', '.pdf'] };
      const { template, sub } = seedSubmissionForStoreA();
      const ok = await api('POST', `/api/checklist/submissions/${sub.id}/attachments`, {
        questionId: template.questions[0].id, fileUrl: '/uploads/1700000000-abcdef0123456789.pdf'
      }, STORE_EMP);
      assertEqual(ok.status, 200, 'Admin đã cho phép .pdf thì phải nhận');
      const blocked = await api('POST', `/api/checklist/submissions/${sub.id}/attachments`, {
        questionId: template.questions[0].id, fileUrl: '/uploads/1700000000-abcdef0123456789.png'
      }, STORE_EMP);
      assertEqual(blocked.status, 400, '.png không nằm trong cấu hình riêng của admin -> chặn');
      UPLOAD_FILE_TYPE_CONFIG = null;
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err); process.exitCode = 1; });
