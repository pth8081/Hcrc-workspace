// server/tests/test-checklist.js
//
// Regression test cho module "Checklist Đánh Giá Siêu Thị" (lib/checklist.js + routes/checklist.js) —
// cùng khuôn tests/test-payroll.js: stub lib/appData/lib/recordStore/lib/auth (checklistTemplates/
// checklistSubmissions là MIGRATED_COLLECTIONS, xem lib/recordStore.js), chạy thẳng express router THẬT.
//
//   1. Vòng đời template: sửa/xoá chỉ khi DRAFT; kích hoạt tự lưu trữ bản ACTIVE khác cùng templateCode;
//      nhân bản tạo version+1 DRAFT.
//   2. Bảo mật STORE_SELF (Mục 7.1): storeCode LUÔN suy từ user.dept, storeCode client gửi lên bị bỏ qua.
//   3. Phạm vi CONTROL_AUDIT: kiểm soát viên ngoài checklistAuditScope bị 403.
//   4. Chấm điểm/nộp bài: lỗi nghiêm trọng ép isPassed=false bất kể %; thiếu câu bắt buộc/thiếu ảnh minh
//      chứng cho câu lỗi đều chặn nộp bài.
//   5. Phản hồi kết quả: chỉ đúng siêu thị của bài CONTROL_AUDIT mới phản hồi được.
//
// Chạy: node server/tests/test-checklist.js
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
const MANAGER = { username: 'qltc1', name: 'Quản Lý Checklist', dept: 'Phòng Vận Hành', posType: 'HO', perms: { checklistTemplateManage: true }, active: true };
const REPORTER = { username: 'bc1', name: 'Người Xem Báo Cáo', dept: 'Phòng Vận Hành', posType: 'HO', perms: { checklistReportView: true }, active: true };
const AUDITOR = { username: 'ks1', name: 'Kiểm Soát Viên', dept: 'Phòng Vận Hành', posType: 'HO', perms: { checklistAuditScope: { all: false, depts: ['Siêu thị A'] } }, active: true };
const STORE_A_EMP = { username: 'nva', name: 'Nhân Viên Siêu Thị A', dept: 'Siêu thị A', posType: 'STORE', perms: {}, active: true };
const STORE_B_EMP = { username: 'nvb', name: 'Nhân Viên Siêu Thị B', dept: 'Siêu thị B', posType: 'STORE', perms: {}, active: true };
let USERS = [ADMIN, MANAGER, REPORTER, AUDITOR, STORE_A_EMP, STORE_B_EMP];

let RECORDS;
function resetRecords() {
  RECORDS = { checklistTemplates: [], checklistSubmissions: [] };
}
resetRecords();

let PORT = 0;
let CURRENT_USERNAME = ADMIN.username;
let idSeq = 1000;

stubModule('lib/appData', {
  getAppDataValue: async () => null,
  getAllAppData: async () => ({}),
  withLockedAppDataValue: async (key, fn) => fn(null)
});

stubModule('lib/recordStore', {
  getAllForCollection: async (collection) => RECORDS[collection] || [],
  // KHÔNG tự gán id nếu record thiếu — mirror ĐÚNG lib/recordStore.js thật (insertRecord() dùng thẳng
  // record.id làm tham số SQL BigInt, không tự sinh id hộ). Mock trước đây tự Object.assign({id:...},
  // record) che mất 1 lỗi thật ở routes/checklist.js (clone/submission thiếu "id:" trước khi gọi
  // insertRecord() -> record.id=undefined -> lỗi 500 thật ở production, không tái hiện được ở đây vì
  // mock tự vá hộ) — xem phản hồi thực tế "Bắt Đầu Test báo lỗi" đã fix ở routes/checklist.js.
  insertRecord: async (collection, record) => {
    if (record.id == null) throw new Error(`insertRecord('${collection}', ...) thiếu record.id — lib/recordStore.js thật KHÔNG tự sinh id hộ, phải gán id: Date.now() trước khi gọi`);
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
  deleteRecordForCollection: async (collection, id, checkFn, actor) => {
    const list = RECORDS[collection] || [];
    const idx = list.findIndex(r => r.id === id);
    if (idx === -1) { const err = new Error('Không tìm thấy bản ghi'); err.statusCode = 404; throw err; }
    await checkFn(list[idx]);
    list.splice(idx, 1);
    return true;
  }
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
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

// Seed thẳng qua RECORDS + lib/checklist.js thật (bỏ qua routes/create.js — route tạo mới DRAFT dùng
// khuôn generic create engine, test riêng ở createValidation.js, không thuộc phạm vi test này).
function seedTemplate(overrides) {
  const core = checklist.assertTemplateCoreFields(Object.assign({
    templateCode: 'CL_TEST', templateName: 'Checklist Kiểm Tra', templateType: 'STORE_SELF', passThreshold: 80
  }, overrides));
  const questions = checklist.validateChecklistQuestions(overrides?.questions || [
    {
      text: 'Vệ sinh khu vực quầy có đạt không?', isRequired: true, maxScore: 10,
      options: [
        { text: 'Đạt', scoreValue: 10, isPassing: true },
        { text: 'Không đạt (lỗi nghiêm trọng)', scoreValue: 0, isPassing: false, isCriticalFail: true }
      ]
    }
  ]);
  const template = Object.assign({
    id: idSeq++, status: 'DRAFT', version: 1, clonedFromTemplateId: null, activatedAt: null,
    creator: 'admin', creatorName: 'Quản Trị Viên'
  }, core, { questions });
  RECORDS.checklistTemplates.push(template);
  return template;
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    // ===== 1. Vòng đời template =====
    await run.run('Template: chỉ sửa được khi còn DRAFT', async () => {
      resetRecords();
      const t = seedTemplate();
      t.status = 'ACTIVE';
      const res = await api('POST', `/api/checklist/templates/${t.id}/edit`, { templateCode: t.templateCode, templateName: 'Đổi tên', templateType: 'STORE_SELF', questions: t.questions }, MANAGER);
      assertEqual(res.status, 409, 'Sửa template ACTIVE phải bị từ chối (409)');
    });

    await run.run('Template: kích hoạt tự lưu trữ bản ACTIVE khác cùng templateCode', async () => {
      resetRecords();
      const t1 = seedTemplate();
      const oldActive = seedTemplate({ templateCode: t1.templateCode });
      oldActive.status = 'ACTIVE';
      const res = await api('POST', `/api/checklist/templates/${t1.id}/activate`, {}, MANAGER);
      assertEqual(res.status, 200, 'Kích hoạt DRAFT phải thành công');
      assertEqual(res.body.item.status, 'ACTIVE', 'Template vừa kích hoạt phải chuyển ACTIVE');
      const refreshedOld = RECORDS.checklistTemplates.find(x => x.id === oldActive.id);
      assertEqual(refreshedOld.status, 'ARCHIVED', 'Bản ACTIVE cũ cùng mã phải tự chuyển ARCHIVED');
    });

    await run.run('Template: nhân bản tạo bản DRAFT version+1', async () => {
      resetRecords();
      const t = seedTemplate();
      t.status = 'ACTIVE'; t.version = 3;
      const res = await api('POST', `/api/checklist/templates/${t.id}/clone`, {}, MANAGER);
      assertEqual(res.status, 200, 'Nhân bản phải thành công');
      assertEqual(res.body.item.status, 'DRAFT', 'Bản nhân bản phải là DRAFT');
      assertEqual(res.body.item.version, 4, 'Bản nhân bản phải là version+1');
      assertEqual(res.body.item.clonedFromTemplateId, t.id, 'Phải ghi lại nguồn nhân bản');
    });

    await run.run('Template: chỉ xoá được khi còn DRAFT', async () => {
      resetRecords();
      const t = seedTemplate();
      t.status = 'ARCHIVED';
      const res = await api('POST', `/api/checklist/templates/${t.id}/delete`, {}, MANAGER);
      assertEqual(res.status, 409, 'Xoá template ARCHIVED phải bị từ chối (409)');
    });

    // ===== 2. Bảo mật STORE_SELF (Mục 7.1) =====
    await run.run('STORE_SELF: storeCode LUÔN suy từ user.dept, bỏ qua storeCode client gửi lên', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const res = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị B (giả mạo)' }, STORE_A_EMP);
      assertEqual(res.status, 200, 'STORE_SELF hợp lệ phải bắt đầu được');
      assertEqual(res.body.item.storeCode, 'Siêu thị A', 'storeCode phải LUÔN là dept thật của user, không phải giá trị client gửi lên');
    });

    await run.run('STORE_SELF: người không ở vị trí Siêu Thị (posType khác STORE) bị chặn', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const res = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, MANAGER);
      assertEqual(res.status, 400, 'posType không phải STORE thì không tự đánh giá được');
    });

    await run.run('STORE_SELF: admin không gắn Vị Trí Siêu Thị vẫn test được nếu tự chọn siêu thị (storeCode do admin gửi lên được tin, khác hẳn user thường)', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const blocked = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, ADMIN);
      assertEqual(blocked.status, 400, 'Admin KHÔNG chọn siêu thị thì vẫn bị chặn (không có storeCode nào để dùng)');
      const res = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị B' }, ADMIN);
      assertEqual(res.status, 200, 'Admin CÓ chọn siêu thị thì bắt đầu được (mục đích test mẫu)');
      assertEqual(res.body.item.storeCode, 'Siêu thị B', 'storeCode phải đúng giá trị admin chọn (khác quy tắc "luôn = user.dept" áp dụng cho người dùng thường)');
    });

    // ===== 3. Phạm vi CONTROL_AUDIT =====
    await run.run('CONTROL_AUDIT: kiểm soát viên ngoài phạm vi checklistAuditScope bị 403', async () => {
      resetRecords();
      const t = seedTemplate({ templateType: 'CONTROL_AUDIT' }); t.status = 'ACTIVE';
      const resB = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị B' }, AUDITOR);
      assertEqual(resB.status, 403, 'Kiểm soát viên chỉ được cấp phạm vi Siêu thị A -> đánh giá Siêu thị B phải bị từ chối');
      const resA = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị A' }, AUDITOR);
      assertEqual(resA.status, 200, 'Đúng phạm vi được cấp phải cho phép');
      assertEqual(resA.body.item.storeCode, 'Siêu thị A', 'storeCode phải đúng siêu thị được chọn');
    });

    await run.run('CONTROL_AUDIT: thiếu storeCode bị từ chối', async () => {
      resetRecords();
      const t = seedTemplate({ templateType: 'CONTROL_AUDIT' }); t.status = 'ACTIVE';
      const res = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, AUDITOR);
      assertEqual(res.status, 400, 'CONTROL_AUDIT bắt buộc chọn storeCode');
    });

    // ===== 4. Chấm điểm / nộp bài =====
    await run.run('Finalize: thiếu câu bắt buộc bị chặn nộp bài', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_A_EMP);
      const res = await api('POST', `/api/checklist/submissions/${start.body.item.id}/finalize`, {}, STORE_A_EMP);
      assertEqual(res.status, 400, 'Chưa trả lời câu bắt buộc thì không nộp bài được');
    });

    await run.run('Finalize: chọn lựa chọn lỗi nghiêm trọng ép isPassed=false bất kể %', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const failOption = t.questions[0].options.find(o => o.isCriticalFail);
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_A_EMP);
      const subId = start.body.item.id;
      // Câu trả lời lỗi nghiêm trọng — CHƯA đính ảnh minh chứng -> phải bị chặn trước (kiểm ở case sau).
      await api('POST', `/api/checklist/submissions/${subId}/answers`, { answers: [{ questionId: t.questions[0].id, optionIds: [failOption.id], note: '' }] }, STORE_A_EMP);
      const blocked = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      assertEqual(blocked.status, 400, 'Câu trả lời bị đánh giá lỗi mà chưa có ảnh minh chứng phải bị chặn nộp bài');

      // Đính ảnh minh chứng thủ công (bỏ qua bước upload thật, chỉ kiểm hành vi finalize) rồi nộp lại.
      await checklistAttachFakePhoto(subId, t.questions[0].id);
      const res = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      assertEqual(res.status, 200, 'Sau khi có ảnh minh chứng phải nộp bài được');
      assertEqual(res.body.item.hasCriticalFail, true, 'Phải ghi nhận có lỗi nghiêm trọng');
      assertEqual(res.body.item.isPassed, false, 'Lỗi nghiêm trọng phải ép isPassed=false bất kể % điểm');
    });

    await run.run('Finalize: không lỗi, đạt ngưỡng % thì isPassed=true', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const passOption = t.questions[0].options.find(o => o.isPassing);
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_A_EMP);
      const subId = start.body.item.id;
      await api('POST', `/api/checklist/submissions/${subId}/answers`, { answers: [{ questionId: t.questions[0].id, optionIds: [passOption.id], note: '' }] }, STORE_A_EMP);
      const res = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      assertEqual(res.status, 200, 'Trả lời đầy đủ, không lỗi phải nộp bài được');
      assertEqual(res.body.item.isPassed, true, 'Đạt điểm và không lỗi nghiêm trọng phải isPassed=true');
      assertEqual(res.body.item.scorePercent, 100, 'Chọn đúng lựa chọn tối đa điểm phải đạt 100%');
    });

    await run.run('Bài đã SUBMITTED không sửa/nộp lại được', async () => {
      resetRecords();
      const t = seedTemplate(); t.status = 'ACTIVE';
      const passOption = t.questions[0].options.find(o => o.isPassing);
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_A_EMP);
      const subId = start.body.item.id;
      await api('POST', `/api/checklist/submissions/${subId}/answers`, { answers: [{ questionId: t.questions[0].id, optionIds: [passOption.id] }] }, STORE_A_EMP);
      await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      const res = await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, STORE_A_EMP);
      assertEqual(res.status, 409, 'Bài đã nộp không thể nộp lại lần nữa');
    });

    // ===== 5. Phản hồi kết quả (Kết Quả & Phản Hồi) =====
    await run.run('Store-response: chỉ đúng siêu thị của bài CONTROL_AUDIT mới phản hồi được', async () => {
      resetRecords();
      const t = seedTemplate({ templateType: 'CONTROL_AUDIT' }); t.status = 'ACTIVE';
      const passOption = t.questions[0].options.find(o => o.isPassing);
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị A' }, AUDITOR);
      const subId = start.body.item.id;
      await api('POST', `/api/checklist/submissions/${subId}/answers`, { answers: [{ questionId: t.questions[0].id, optionIds: [passOption.id] }] }, AUDITOR);
      await api('POST', `/api/checklist/submissions/${subId}/finalize`, {}, AUDITOR);

      const wrongStore = await api('POST', `/api/checklist/submissions/${subId}/store-response`, { responseText: 'Đã khắc phục' }, STORE_B_EMP);
      assertEqual(wrongStore.status, 403, 'Nhân viên siêu thị KHÁC không được phản hồi kết quả');

      const correctStore = await api('POST', `/api/checklist/submissions/${subId}/store-response`, { responseText: 'Đã khắc phục' }, STORE_A_EMP);
      assertEqual(correctStore.status, 200, 'Đúng nhân viên siêu thị được đánh giá phải phản hồi được');
      assertEqual(correctStore.body.item.storeResponseText, 'Đã khắc phục', 'Nội dung phản hồi phải được lưu đúng');
    });

    run.summary();
  } finally {
    server.close();
  }
}

// Gắn thẳng attachment vào RECORDS (bỏ qua bước upload thật /api/upload — test riêng ở routes/upload.js,
// không thuộc phạm vi test này) để kiểm hành vi assertReadyToFinalize() với answersNeedingPhoto.
async function checklistAttachFakePhoto(subId, questionId) {
  const sub = RECORDS.checklistSubmissions.find(s => s.id === subId);
  const answers = sub.answers.map(a => a.questionId === questionId
    ? Object.assign({}, a, { attachments: [{ fileUrl: '/uploads/fake.jpg', fileName: 'fake.jpg', fileType: 'image/jpeg' }] })
    : a);
  sub.answers = answers;
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
