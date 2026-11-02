// server/tests/test-checklist-revoked-permission-cancel.js
//
// Regression test cho 2 lỗi người dùng báo cáo trực tiếp (11/2026, màn Checklist Đánh Giá Siêu Thị):
//
//   (1) "Bug là không có nút ấn huỷ nếu không làm tiếp" — bài Nháp (DRAFT) không ai cần làm tiếp nữa
//       (VD admin test xong bỏ dở, hoặc quyền thực hiện đã bị thu hồi — xem (2)) trước đây nằm MÃI trong
//       danh sách "Bài Đang Làm Dở", không ai (kể cả chính người tạo) huỷ được — route .../delete trước
//       đây CHỈ admin/canManageChecklistTemplates() mới gọi được, KHÔNG có gì ở client gọi tới.
//   (2) Xác nhận từ người dùng: giám đốc siêu thị TỪNG có quyền checklistAtvstpExecute (Kiểm Soát/VSATTP)
//       rồi bị admin RÚT LẠI sau khi đã bắt đầu 1 bài DRAFT — route lưu nháp/đính kèm ảnh/nộp bài TRƯỚC
//       ĐÂY chỉ kiểm tra ĐÚNG người đã tạo bài (submittedByUsername), KHÔNG re-check quyền HIỆN TẠI, nên
//       người đã bị thu hồi quyền vẫn làm tiếp/nộp bài được bình thường.
//
// Đã vá ở routes/checklist.js: assertCanContinueChecklistSubmission() (answers/attachments/finalize) +
// mở route .../delete cho chính chủ bài Nháp tự huỷ (không cần quyền quản lý mẫu/quyền thực hiện).
// Cùng khuôn harness tests/test-checklist.js (stub lib/appData/lib/recordStore/lib/auth, chạy thẳng
// express router THẬT) — KHÔNG đụng tới routes/attachments (cần stub riêng 'db', xem
// tests/test-checklist-attachment-ownership.js, đã có case riêng cho phần đó).
//
// Chạy: node server/tests/test-checklist-revoked-permission-cancel.js
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
// STORE_MGR: giám đốc siêu thị — perms.checklistExecute/checklistAtvstpExecute bị TOGGLE trực tiếp
// trong test để mô phỏng admin cấp rồi rút lại quyền.
const STORE_MGR = { username: 'gdst1', name: 'Giám Đốc Siêu Thị', dept: 'Siêu thị số 8 Phạm Ngọc Thạch', posType: 'STORE', perms: { checklistExecute: true, checklistAtvstpExecute: true }, active: true };
const OUTSIDER = { username: 'nv_khac', name: 'Nhân Viên Khác', dept: 'Siêu thị B', posType: 'STORE', perms: { checklistExecute: true }, active: true };
let USERS = [ADMIN, STORE_MGR, OUTSIDER];

let RECORDS;
function resetRecords() { RECORDS = { checklistTemplates: [], checklistSubmissions: [] }; }
resetRecords();

let PORT = 0;
let CURRENT_USERNAME = ADMIN.username;
let idSeq = 5000;

const STORES = ['Siêu thị số 8 Phạm Ngọc Thạch', 'Siêu thị B'];
stubModule('lib/appData', {
  getAppDataValue: async () => null,
  getAppDataValueCached: async (key) => (key === 'stores' ? STORES : null),
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
const { createRunner, assertEqual } = require('./testHarness');
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
    templateCode: 'CL_REVOKE', templateName: 'Checklist Thu Hồi Quyền', templateType: 'STORE_SELF', passThreshold: 80
  }, overrides));
  const questions = checklist.validateChecklistQuestions([
    {
      text: 'Câu hỏi test', isRequired: true, maxScore: 10,
      options: [{ text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }]
    }
  ]);
  const template = Object.assign({
    id: idSeq++, status: 'ACTIVE', version: 1, clonedFromTemplateId: null, activatedAt: checklist.nowVN(),
    creator: 'admin', creatorName: 'Quản Trị Viên'
  }, core, { questions });
  RECORDS.checklistTemplates.push(template);
  return template;
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    // ===== (2) Quyền bị thu hồi SAU KHI đã bắt đầu bài DRAFT =====
    await run.run('STORE_SELF: GĐST có checklistExecute bắt đầu bài, bị rút quyền -> /answers 403', async () => {
      resetRecords();
      const t = seedTemplate({ templateType: 'STORE_SELF' });
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_MGR);
      assertEqual(start.status, 200, 'Bắt đầu bài khi còn quyền phải thành công', start.body);
      STORE_MGR.perms.checklistExecute = false; // admin rút quyền
      const res = await api('POST', `/api/checklist/submissions/${start.body.item.id}/answers`, { answers: [] }, STORE_MGR);
      assertEqual(res.status, 403, 'Mất quyền checklistExecute -> lưu nháp tiếp phải bị 403', res.body);
      assertEqual(/thu hồi/.test(res.body?.error || ''), true, 'Thông báo lỗi phải nói rõ quyền đã bị thu hồi', res.body);
      STORE_MGR.perms.checklistExecute = true; // trả lại cho các test sau
    });

    await run.run('STORE_SELF: mất quyền checklistExecute -> /finalize cũng 403 (không lách qua được)', async () => {
      resetRecords();
      const t = seedTemplate({ templateType: 'STORE_SELF' });
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_MGR);
      STORE_MGR.perms.checklistExecute = false;
      const res = await api('POST', `/api/checklist/submissions/${start.body.item.id}/finalize`, {}, STORE_MGR);
      assertEqual(res.status, 403, 'Mất quyền checklistExecute -> nộp bài phải bị 403', res.body);
      STORE_MGR.perms.checklistExecute = true;
    });

    await run.run('CONTROL_AUDIT (VSATTP): mất quyền checklistAtvstpExecute -> /answers + /finalize đều 403', async () => {
      resetRecords();
      const t = seedTemplate({ templateType: 'CONTROL_AUDIT' });
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị số 8 Phạm Ngọc Thạch' }, STORE_MGR);
      assertEqual(start.status, 200, 'Bắt đầu bài VSATTP khi còn quyền phải thành công', start.body);
      STORE_MGR.perms.checklistAtvstpExecute = false; // admin rút quyền ATVSTP
      const resAnswers = await api('POST', `/api/checklist/submissions/${start.body.item.id}/answers`, { answers: [] }, STORE_MGR);
      assertEqual(resAnswers.status, 403, 'Mất quyền checklistAtvstpExecute -> lưu nháp VSATTP phải bị 403', resAnswers.body);
      const resFinalize = await api('POST', `/api/checklist/submissions/${start.body.item.id}/finalize`, {}, STORE_MGR);
      assertEqual(resFinalize.status, 403, 'Mất quyền checklistAtvstpExecute -> nộp bài VSATTP phải bị 403', resFinalize.body);
      STORE_MGR.perms.checklistAtvstpExecute = true;
    });

    await run.run('Admin KHÔNG bao giờ bị chặn bởi assertCanContinueChecklistSubmission (bypass như mọi nơi khác)', async () => {
      resetRecords();
      const t = seedTemplate({ templateType: 'STORE_SELF' });
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị B' }, ADMIN);
      assertEqual(start.status, 200, 'Admin bắt đầu bài test phải thành công', start.body);
      const res = await api('POST', `/api/checklist/submissions/${start.body.item.id}/finalize`, { answers: [{ questionId: t.questions[0].id, optionIds: [t.questions[0].options[0].id], note: '' }] }, ADMIN);
      assertEqual(res.status, 200, 'Admin luôn nộp bài test được, không bị chặn bởi check mới', res.body);
    });

    // ===== (1) Nút Huỷ bài Nháp =====
    await run.run('Huỷ bài Nháp: CHÍNH chủ bài huỷ được bài của mình dù KHÔNG còn quyền thực hiện (dọn dẹp, không phải làm tiếp)', async () => {
      resetRecords();
      const t = seedTemplate({ templateType: 'CONTROL_AUDIT' });
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id, storeCode: 'Siêu thị số 8 Phạm Ngọc Thạch' }, STORE_MGR);
      STORE_MGR.perms.checklistAtvstpExecute = false;
      const res = await api('POST', `/api/checklist/submissions/${start.body.item.id}/delete`, {}, STORE_MGR);
      assertEqual(res.status, 200, 'Chính chủ huỷ bài Nháp của mình phải thành công dù mất quyền thực hiện', res.body);
      assertEqual(RECORDS.checklistSubmissions.length, 0, 'Bài Nháp phải bị xoá khỏi RECORDS sau khi huỷ', RECORDS.checklistSubmissions);
      STORE_MGR.perms.checklistAtvstpExecute = true;
    });

    await run.run('Huỷ bài Nháp: người KHÁC (không phải chủ bài, không phải admin) KHÔNG huỷ được', async () => {
      resetRecords();
      const t = seedTemplate({ templateType: 'STORE_SELF' });
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_MGR);
      const res = await api('POST', `/api/checklist/submissions/${start.body.item.id}/delete`, {}, OUTSIDER);
      assertEqual(res.status, 403, 'Người ngoài cuộc không huỷ được bài của người khác', res.body);
      assertEqual(RECORDS.checklistSubmissions.length, 1, 'Bài Nháp KHÔNG bị xoá khi bị từ chối huỷ', RECORDS.checklistSubmissions);
    });

    await run.run('Huỷ bài Nháp: admin vẫn huỷ được bài của BẤT KỲ AI (giữ nguyên hành vi cũ, mirror canManageChecklistTemplates)', async () => {
      resetRecords();
      const t = seedTemplate({ templateType: 'STORE_SELF' });
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_MGR);
      const res = await api('POST', `/api/checklist/submissions/${start.body.item.id}/delete`, {}, ADMIN);
      assertEqual(res.status, 200, 'Admin huỷ được bài Nháp của người khác', res.body);
    });

    await run.run('Huỷ bài Nháp: bài ĐÃ NỘP (không còn DRAFT) không ai huỷ được qua route này, kể cả chính chủ', async () => {
      resetRecords();
      const t = seedTemplate({ templateType: 'STORE_SELF' });
      const start = await api('POST', '/api/checklist/submissions/start', { templateId: t.id }, STORE_MGR);
      const opt = t.questions[0].options[0];
      await api('POST', `/api/checklist/submissions/${start.body.item.id}/finalize`,
        { answers: [{ questionId: t.questions[0].id, optionIds: [opt.id], note: '' }] }, STORE_MGR);
      const res = await api('POST', `/api/checklist/submissions/${start.body.item.id}/delete`, {}, STORE_MGR);
      assertEqual(res.status, 409, 'Bài đã nộp (SUBMITTED) không huỷ được qua route này', res.body);
      assertEqual(RECORDS.checklistSubmissions.length, 1, 'Bài đã nộp phải còn nguyên trong RECORDS', RECORDS.checklistSubmissions);
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
