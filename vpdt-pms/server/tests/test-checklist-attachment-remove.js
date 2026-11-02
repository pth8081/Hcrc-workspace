// server/tests/test-checklist-attachment-remove.js
//
// Regression test cho route MỚI POST /api/checklist/submissions/:id/attachments/remove
// (routes/checklist.js) — thêm theo yêu cầu người dùng (11/2026): nút xoá từng ảnh + "xoá hết ảnh" ở
// màn làm bài Checklist/VSATTP (trước đây hoàn toàn không có cách gỡ ảnh minh chứng đã đính kèm, chỉ
// thêm được). Mirror ĐÚNG khuôn test-checklist-attachment-ownership.js (router thật, fake pool
// dbo.UploadedFiles trong bộ nhớ, stub recordStore/auth).
//
// Chạy: node server/tests/test-checklist-attachment-remove.js
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

stubModule('db', {
  getPool: async () => ({ request() { return { input() { return this; }, async query() { return { recordset: [] }; } }; } }),
  sql: { NVarChar: (n) => ({ type: 'NVarChar', n }) }
});

const U1 = { username: 'u1', name: 'Nhân Viên Một', dept: 'Siêu thị A', posType: 'STORE', perms: { checklistTemplateManage: true, checklistExecute: true, checklistAtvstpExecute: true }, active: true };
const U2 = { username: 'u2', name: 'Nhân Viên Hai', dept: 'Siêu thị B', posType: 'STORE', perms: { checklistTemplateManage: true, checklistExecute: true, checklistAtvstpExecute: true }, active: true };
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

function seedQaTemplate() {
  const core = checklist.assertTemplateCoreFields({
    templateCode: 'CL_RM_QA', templateName: 'Checklist Test Remove QA', templateType: 'STORE_SELF', passThreshold: 80
  });
  const questions = checklist.validateChecklistQuestions([{
    text: 'Câu hỏi 1', isRequired: true, maxScore: 10,
    options: [{ text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }]
  }]);
  const template = Object.assign({ id: idSeq++, status: 'ACTIVE', version: 1, clonedFromTemplateId: null, activatedAt: 'now', creator: 'admin', creatorName: 'Admin' }, core, { questions });
  RECORDS.checklistTemplates.push(template);
  return template;
}
function seedDeductionTemplate() {
  const core = checklist.assertTemplateCoreFields({
    templateCode: 'CL_RM_VSATTP', templateName: 'Checklist Test Remove VSATTP', templateType: 'CONTROL_AUDIT', templateKind: 'DEDUCTION', passThreshold: 80
  });
  const categories = checklist.validateChecklistCategories([{
    name: 'Hạng mục 1', maxDeduction: 10,
    subItems: [{ name: 'Mục con 1', maxDeduction: null, criteria: [{ description: 'Tiêu chí 1', ruleText: 'Trừ 2đ/lần', perInstanceValue: 2 }] }]
  }]);
  const template = Object.assign({ id: idSeq++, status: 'ACTIVE', version: 1, clonedFromTemplateId: null, activatedAt: 'now', creator: 'admin', creatorName: 'Admin' }, core, { categories });
  RECORDS.checklistTemplates.push(template);
  return template;
}
function seedQaSubmission(template, submittedBy, attachments) {
  const sub = {
    id: idSeq++, templateId: template.id, templateCode: template.templateCode, templateName: template.templateName,
    templateType: template.templateType, templateVersion: template.version, storeCode: submittedBy.dept,
    submittedByUsername: submittedBy.username, submittedByName: submittedBy.name, status: 'DRAFT',
    answers: [{ questionId: 1, optionIds: [0], note: '', deadline: '', attachments }], deductions: [],
    totalScore: null, maxPossibleScore: null, scorePercent: null, hasCriticalFail: null, isPassed: null,
    startedAt: 'now', submittedAt: null
  };
  RECORDS.checklistSubmissions.push(sub);
  return sub;
}
function seedDeductionSubmission(template, submittedBy, criteriaId, attachments) {
  const sub = {
    id: idSeq++, templateId: template.id, templateCode: template.templateCode, templateName: template.templateName,
    templateType: template.templateType, templateVersion: template.version, storeCode: submittedBy.dept,
    submittedByUsername: submittedBy.username, submittedByName: submittedBy.name, status: 'DRAFT',
    answers: [], deductions: [{ criteriaId, deductedPoints: 2, description: '', riskLevel: null, deadline: '', note: '', attachments }],
    totalScore: null, maxPossibleScore: null, scorePercent: null, hasCriticalFail: null, isPassed: null,
    startedAt: 'now', submittedAt: null
  };
  RECORDS.checklistSubmissions.push(sub);
  return sub;
}

async function main() {
  const server = await startApp();
  try {
    // ===== Kịch bản 1: xoá ĐÚNG 1 ảnh (fileUrl khớp) trong 2 ảnh đính kèm (QA) =====
    resetRecords();
    const t1 = seedQaTemplate();
    const s1 = seedQaSubmission(t1, U1, [
      { fileUrl: '/uploads/a.jpg', fileName: 'a.jpg', fileType: 'image/jpeg' },
      { fileUrl: '/uploads/b.jpg', fileName: 'b.jpg', fileType: 'image/jpeg' }
    ]);
    const r1 = await api('POST', `/api/checklist/submissions/${s1.id}/attachments/remove`, { questionId: 1, fileUrl: '/uploads/a.jpg' }, U1);
    check('Xoá đúng 1 ảnh (QA) -> 200', r1.status === 200, r1.body);
    const after1 = RECORDS.checklistSubmissions.find(s => s.id === s1.id).answers[0].attachments;
    check('Còn lại đúng 1 ảnh (b.jpg), ảnh a.jpg đã bị gỡ', after1.length === 1 && after1[0].fileUrl === '/uploads/b.jpg', after1);

    // ===== Kịch bản 2: removeAll xoá sạch toàn bộ ảnh (QA) =====
    resetRecords();
    const t2 = seedQaTemplate();
    const s2 = seedQaSubmission(t2, U1, [
      { fileUrl: '/uploads/c.jpg', fileName: 'c.jpg', fileType: 'image/jpeg' },
      { fileUrl: '/uploads/d.jpg', fileName: 'd.jpg', fileType: 'image/jpeg' }
    ]);
    const r2 = await api('POST', `/api/checklist/submissions/${s2.id}/attachments/remove`, { questionId: 1, removeAll: true }, U1);
    check('Xoá hết ảnh (removeAll) -> 200', r2.status === 200, r2.body);
    const after2 = RECORDS.checklistSubmissions.find(s => s.id === s2.id).answers[0].attachments;
    check('Mảng attachments rỗng sau removeAll', Array.isArray(after2) && after2.length === 0, after2);

    // ===== Kịch bản 3: DEDUCTION (VSATTP) — xoá đúng 1 ảnh theo criteriaId =====
    resetRecords();
    const t3 = seedDeductionTemplate();
    const criteriaId3 = t3.categories[0].subItems[0].criteria[0].id;
    const s3 = seedDeductionSubmission(t3, U1, criteriaId3, [
      { fileUrl: '/uploads/e.jpg', fileName: 'e.jpg', fileType: 'image/jpeg' },
      { fileUrl: '/uploads/f.jpg', fileName: 'f.jpg', fileType: 'image/jpeg' }
    ]);
    const r3 = await api('POST', `/api/checklist/submissions/${s3.id}/attachments/remove`, { questionId: criteriaId3, fileUrl: '/uploads/e.jpg' }, U1);
    check('DEDUCTION: xoá đúng 1 ảnh theo criteriaId -> 200', r3.status === 200, r3.body);
    const after3 = RECORDS.checklistSubmissions.find(s => s.id === s3.id).deductions[0].attachments;
    check('DEDUCTION: còn lại đúng 1 ảnh (f.jpg)', after3.length === 1 && after3[0].fileUrl === '/uploads/f.jpg', after3);

    // ===== Kịch bản 4: u2 KHÔNG phải chủ bài -> 403, không đụng được ảnh của u1 =====
    resetRecords();
    const t4 = seedQaTemplate();
    const s4 = seedQaSubmission(t4, U1, [{ fileUrl: '/uploads/g.jpg', fileName: 'g.jpg', fileType: 'image/jpeg' }]);
    const r4 = await api('POST', `/api/checklist/submissions/${s4.id}/attachments/remove`, { questionId: 1, fileUrl: '/uploads/g.jpg' }, U2);
    check('u2 xoá ảnh bài của u1 -> 403', r4.status === 403, r4.body);
    const after4 = RECORDS.checklistSubmissions.find(s => s.id === s4.id).answers[0].attachments;
    check('Ảnh của u1 vẫn còn nguyên sau khi u2 bị chặn', after4.length === 1, after4);

    // ===== Kịch bản 5: bài đã NỘP (không còn DRAFT) -> 409, không xoá được nữa =====
    resetRecords();
    const t5 = seedQaTemplate();
    const s5 = seedQaSubmission(t5, U1, [{ fileUrl: '/uploads/h.jpg', fileName: 'h.jpg', fileType: 'image/jpeg' }]);
    s5.status = 'SUBMITTED';
    const r5 = await api('POST', `/api/checklist/submissions/${s5.id}/attachments/remove`, { questionId: 1, fileUrl: '/uploads/h.jpg' }, U1);
    check('Bài đã nộp (không còn DRAFT) -> 409, không xoá được', r5.status === 409, r5.body);

    // ===== Kịch bản 6: mất quyền checklistExecute SAU KHI tạo bài -> xoá ảnh cũng bị 403 (đồng bộ với
    // answers/attachments/finalize, assertCanContinueChecklistSubmission()) =====
    resetRecords();
    const t6 = seedQaTemplate();
    const s6 = seedQaSubmission(t6, U1, [{ fileUrl: '/uploads/i.jpg', fileName: 'i.jpg', fileType: 'image/jpeg' }]);
    U1.perms.checklistExecute = false;
    const r6 = await api('POST', `/api/checklist/submissions/${s6.id}/attachments/remove`, { questionId: 1, fileUrl: '/uploads/i.jpg' }, U1);
    check('Mất quyền checklistExecute -> xoá ảnh cũng bị 403', r6.status === 403, r6.body);
    U1.perms.checklistExecute = true;

    // ===== Kịch bản 7: thiếu cả fileUrl lẫn removeAll -> 400 (validate input) =====
    resetRecords();
    const t7 = seedQaTemplate();
    const s7 = seedQaSubmission(t7, U1, [{ fileUrl: '/uploads/j.jpg', fileName: 'j.jpg', fileType: 'image/jpeg' }]);
    const r7 = await api('POST', `/api/checklist/submissions/${s7.id}/attachments/remove`, { questionId: 1 }, U1);
    check('Thiếu fileUrl lẫn removeAll -> 400', r7.status === 400, r7.body);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
