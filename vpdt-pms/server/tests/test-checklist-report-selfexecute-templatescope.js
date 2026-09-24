// server/tests/test-checklist-report-selfexecute-templatescope.js
//
// Regression test cho tính năng MỚI (10/2026, yêu cầu người dùng): phạm vi THEO MẪU checklist cho 2
// quyền phẳng "checklistReportView" (Xem Báo Cáo Checklist) và "checklistStoreSelfExecute" (Đánh Giá
// Checklist — Tự Đánh Giá) — trước đây 2 quyền này là boolean toàn-hoặc-không (có quyền = thấy/làm được
// MỌI mẫu); giờ thêm field {all,depts} (depts chứa TEMPLATE ID dạng chuỗi, TÁI DÙNG tên field 'depts' để
// mergeGroupsBasePerms() tự union đúng — xem lib/checklist.js::getChecklistReportViewScope()/
// getChecklistStoreSelfExecuteScope()) cho phép admin giới hạn xuống 1 số mẫu cụ thể.
//
//   1. Unit (require thẳng lib/checklist.js, không qua HTTP): legacy fallback (chưa từng lưu Scope ->
//      coi như {all:true}, không regression cho tài khoản cũ), scope tường minh giới hạn đúng mẫu, tắt
//      cờ phẳng -> luôn false bất kể scope, admin/checklistTemplateManage luôn bypass all:true.
//   2. Route (chạy thẳng routes/checklist.js thật qua HTTP): export-report/vsattp-dashboard-export chặn
//      đúng mẫu ngoài phạm vi report-view; submissions/start (STORE_SELF) chặn đúng mẫu ngoài phạm vi
//      tự-đánh-giá dù đã có checklistStoreSelfExecute=true nói chung.
//
// Chạy: node server/tests/test-checklist-report-selfexecute-templatescope.js
'use strict';
const http = require('http');
const path = require('path');
const ExcelJS = require('exceljs');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const checklist = require('../lib/checklist');
const { createRunner, assertEqual, assert } = require('./testHarness');

// ===================== 1. Unit test thuần (lib/checklist.js) =====================
async function runUnitTests(run) {
  const ADMIN_U = { perms: { admin: true } };
  const MANAGER_U = { perms: { checklistTemplateManage: true } };
  const LEGACY_REPORTER = { perms: { checklistReportView: true } }; // chưa từng lưu qua UI mới
  const SCOPED_REPORTER = { perms: { checklistReportView: true, checklistReportViewScope: { all: false, depts: ['101'] } } };
  const ALL_SCOPED_REPORTER = { perms: { checklistReportView: true, checklistReportViewScope: { all: true, depts: [] } } };
  const NO_REPORT_PERM = { perms: { checklistReportView: false, checklistReportViewScope: { all: true, depts: [] } } };

  await run.run('getChecklistReportViewScope(): admin/checklistTemplateManage luôn bypass {all:true}', async () => {
    assertEqual(checklist.getChecklistReportViewScope(ADMIN_U).all, true, 'admin phải all:true');
    assertEqual(checklist.getChecklistReportViewScope(MANAGER_U).all, true, 'checklistTemplateManage phải all:true');
  });

  await run.run('canViewChecklistReportForTemplate(): LEGACY (chưa từng lưu Scope) coi như {all:true} — không regression', async () => {
    assertEqual(checklist.canViewChecklistReportForTemplate(LEGACY_REPORTER, 101), true, 'legacy phải thấy mẫu 101');
    assertEqual(checklist.canViewChecklistReportForTemplate(LEGACY_REPORTER, 999), true, 'legacy phải thấy CẢ mẫu chưa từng biết tới (999)');
  });

  await run.run('canViewChecklistReportForTemplate(): Scope tường minh CHỈ cho đúng templateId đã chọn (so khớp qua String(), depts[] lưu dạng chuỗi)', async () => {
    assertEqual(checklist.canViewChecklistReportForTemplate(SCOPED_REPORTER, 101), true, 'templateId số 101 phải khớp "101" trong depts[] qua String()');
    assertEqual(checklist.canViewChecklistReportForTemplate(SCOPED_REPORTER, 202), false, 'KHÔNG được thấy mẫu 202 (ngoài scope)');
  });

  await run.run('canViewChecklistReportForTemplate(): Scope {all:true} tường minh thấy MỌI mẫu', async () => {
    assertEqual(checklist.canViewChecklistReportForTemplate(ALL_SCOPED_REPORTER, 555), true, 'all:true phải thấy mọi mẫu');
  });

  await run.run('canViewChecklistReportForTemplate(): tắt cờ phẳng checklistReportView -> LUÔN false bất kể Scope', async () => {
    assertEqual(checklist.canViewChecklistReportForTemplate(NO_REPORT_PERM, 101), false, 'không có quyền báo cáo thì Scope không có ý nghĩa gì');
  });

  const LEGACY_SELF = { posType: 'STORE', dept: 'Siêu thị A', perms: { checklistStoreSelfExecute: true } };
  const SCOPED_SELF = { posType: 'STORE', dept: 'Siêu thị A', perms: { checklistStoreSelfExecute: true, checklistStoreSelfExecuteScope: { all: false, depts: ['11'] } } };
  const NOT_ELIGIBLE_SELF = { posType: 'OFFICE', dept: 'Phòng KD', perms: { checklistStoreSelfExecute: true, checklistStoreSelfExecuteScope: { all: true, depts: [] } } };

  await run.run('canStoreSelfExecuteTemplate(): legacy (chưa lưu Scope) coi như {all:true}', async () => {
    assertEqual(checklist.canStoreSelfExecuteTemplate(LEGACY_SELF, 11), true, 'legacy phải làm được mọi mẫu');
    assertEqual(checklist.canStoreSelfExecuteTemplate(LEGACY_SELF, 999), true);
  });

  await run.run('canStoreSelfExecuteTemplate(): Scope tường minh CHỈ cho đúng templateId đã chọn', async () => {
    assertEqual(checklist.canStoreSelfExecuteTemplate(SCOPED_SELF, 11), true, 'phải làm được mẫu 11');
    assertEqual(checklist.canStoreSelfExecuteTemplate(SCOPED_SELF, 12), false, 'KHÔNG được làm mẫu 12 (ngoài scope)');
  });

  await run.run('canStoreSelfExecuteTemplate(): không đủ điều kiện eligible (posType khác STORE) -> luôn false dù Scope all:true', async () => {
    assertEqual(checklist.canStoreSelfExecuteTemplate(NOT_ELIGIBLE_SELF, 11), false, 'posType OFFICE không bao giờ được Tự Đánh Giá, bất kể Scope');
  });
}

// ===================== 2. Route test (HTTP thật qua routes/checklist.js) =====================
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', posType: 'HO', perms: { admin: true }, active: true };
// REPORTER_SCOPED: chỉ được xem báo cáo của 1 trong 2 mẫu DEDUCTION sẽ seed bên dưới (id gán ĐỘNG lúc seed).
let REPORTER_SCOPED;
let STORE_EMP_SCOPED;
let USERS;

let RECORDS;
function resetRecords() { RECORDS = { checklistTemplates: [], checklistSubmissions: [] }; }
resetRecords();

let PORT = 0;
let CURRENT_USERNAME = ADMIN.username;
let idSeq = 5000;
const STORES = ['Siêu thị A', 'Siêu thị B'];

stubModule('lib/appData', {
  getAppDataValue: async () => null,
  getAppDataValueCached: async (key) => (key === 'stores' ? STORES : (key === 'storeTypes' ? {} : null)),
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

const express = require('express');
const checklistRoutes = require('../routes/checklist');

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
async function apiJson(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}
async function apiXlsx(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status !== 200) { let payload = null; try { payload = await res.json(); } catch (e) {} return { status: res.status, body: payload }; }
  const buf = Buffer.from(await res.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buf);
  return { status: res.status, workbook };
}

function seedQaTemplate(overrides) {
  const core = checklist.assertTemplateCoreFields(Object.assign({
    templateCode: 'CL_SCOPE_QA', templateName: 'Checklist QA Phạm Vi', templateType: 'STORE_SELF', passThreshold: 80
  }, overrides));
  const questions = checklist.validateChecklistQuestions([
    { text: 'Đạt hay không?', isRequired: true, maxScore: 10, options: [
      { text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }
    ] }
  ]);
  const template = Object.assign({ id: idSeq++, status: 'ACTIVE', version: 1, clonedFromTemplateId: null, activatedAt: checklist.nowVN(), creator: 'admin', creatorName: 'Quản Trị Viên' }, core, { questions });
  RECORDS.checklistTemplates.push(template);
  return template;
}
function seedDeductionTemplate(overrides) {
  const core = checklist.assertTemplateCoreFields(Object.assign({
    templateCode: 'CL_SCOPE_DED', templateName: 'Checklist Trừ Điểm Phạm Vi', templateType: 'CONTROL_AUDIT', templateKind: 'DEDUCTION'
  }, overrides));
  const categories = checklist.validateChecklistCategories([
    { name: 'HẠNG MỤC', maxDeduction: 10, subItems: [{ name: 'Con', maxDeduction: 10, criteria: [{ description: 'Tiêu chí', perInstanceValue: 2 }] }] }
  ]);
  const template = Object.assign({ id: idSeq++, status: 'ACTIVE', version: 1, clonedFromTemplateId: null, activatedAt: checklist.nowVN(), creator: 'admin', creatorName: 'Quản Trị Viên' }, core, { categories });
  RECORDS.checklistTemplates.push(template);
  return template;
}

async function main() {
  const run = createRunner();
  await runUnitTests(run);

  const server = await startApp();
  try {
    await run.run('export-report: REPORTER có checklistReportViewScope giới hạn 1 mẫu -> 403 khi xin mẫu NGOÀI phạm vi', async () => {
      resetRecords();
      const tIn = seedDeductionTemplate({ templateCode: 'CL_IN' });
      const tOut = seedDeductionTemplate({ templateCode: 'CL_OUT' });
      REPORTER_SCOPED = { username: 'bc_scoped', name: 'Người Xem BC Giới Hạn', dept: 'Phòng Vận Hành', posType: 'HO', perms: { checklistReportView: true, checklistReportViewScope: { all: false, depts: [String(tIn.id)] } }, active: true };
      USERS = [ADMIN, REPORTER_SCOPED];
      RECORDS.checklistSubmissions.push({
        id: 1, templateId: tOut.id, templateCode: tOut.templateCode, templateName: tOut.templateName, templateType: 'CONTROL_AUDIT', templateVersion: 1,
        storeCode: 'Siêu thị A', submittedByUsername: 'ks1', submittedByName: 'KS', status: 'SUBMITTED', answers: [], deductions: [],
        totalScore: 10, maxPossibleScore: 10, scorePercent: 100, hasCriticalFail: false, isPassed: true, startedAt: checklist.nowVN(), submittedAt: checklist.nowVN()
      });
      const res = await apiJson('POST', '/api/checklist/export-report', { templateId: tOut.id }, REPORTER_SCOPED);
      assertEqual(res.status, 403, 'mẫu NGOÀI phạm vi report-view phải bị 403 dù checklistReportView=true chung');
    });

    await run.run('export-report: REPORTER giới hạn 1 mẫu -> 200 khi xin ĐÚNG mẫu trong phạm vi', async () => {
      resetRecords();
      const tIn = seedDeductionTemplate({ templateCode: 'CL_IN' });
      REPORTER_SCOPED = { username: 'bc_scoped', name: 'Người Xem BC Giới Hạn', dept: 'Phòng Vận Hành', posType: 'HO', perms: { checklistReportView: true, checklistReportViewScope: { all: false, depts: [String(tIn.id)] } }, active: true };
      USERS = [ADMIN, REPORTER_SCOPED];
      RECORDS.checklistSubmissions.push({
        id: 1, templateId: tIn.id, templateCode: tIn.templateCode, templateName: tIn.templateName, templateType: 'CONTROL_AUDIT', templateVersion: 1,
        storeCode: 'Siêu thị A', submittedByUsername: 'ks1', submittedByName: 'KS', status: 'SUBMITTED', answers: [], deductions: [],
        totalScore: 10, maxPossibleScore: 10, scorePercent: 100, hasCriticalFail: false, isPassed: true, startedAt: checklist.nowVN(), submittedAt: checklist.nowVN()
      });
      const res = await apiXlsx('POST', '/api/checklist/export-report', { templateId: tIn.id }, REPORTER_SCOPED);
      assertEqual(res.status, 200, 'mẫu TRONG phạm vi phải xuất được bình thường');
    });

    await run.run('vsattp-dashboard/export: chỉ gộp đúng mẫu DEDUCTION trong phạm vi report-view, loại mẫu ngoài phạm vi dù cùng templateKind', async () => {
      resetRecords();
      const tIn = seedDeductionTemplate({ templateCode: 'CL_IN' });
      const tOut = seedDeductionTemplate({ templateCode: 'CL_OUT' });
      REPORTER_SCOPED = { username: 'bc_scoped', name: 'Người Xem BC Giới Hạn', dept: 'Phòng Vận Hành', posType: 'HO', perms: { checklistReportView: true, checklistReportViewScope: { all: false, depts: [String(tIn.id)] } }, active: true };
      USERS = [ADMIN, REPORTER_SCOPED];
      RECORDS.checklistSubmissions.push(
        { id: 1, templateId: tIn.id, templateCode: tIn.templateCode, templateName: tIn.templateName, templateType: 'CONTROL_AUDIT', templateVersion: 1, storeCode: 'Siêu thị A', submittedByUsername: 'ks1', submittedByName: 'KS', status: 'SUBMITTED', answers: [], deductions: [], totalScore: 10, maxPossibleScore: 10, scorePercent: 100, hasCriticalFail: false, isPassed: true, startedAt: checklist.nowVN(), submittedAt: checklist.nowVN() },
        { id: 2, templateId: tOut.id, templateCode: tOut.templateCode, templateName: tOut.templateName, templateType: 'CONTROL_AUDIT', templateVersion: 1, storeCode: 'Siêu thị B', submittedByUsername: 'ks1', submittedByName: 'KS', status: 'SUBMITTED', answers: [], deductions: [], totalScore: 10, maxPossibleScore: 10, scorePercent: 100, hasCriticalFail: false, isPassed: true, startedAt: checklist.nowVN(), submittedAt: checklist.nowVN() }
      );
      const res = await apiXlsx('POST', '/api/checklist/vsattp-dashboard/export', {}, REPORTER_SCOPED);
      assertEqual(res.status, 200, 'phải xuất được (còn ít nhất 1 mẫu trong phạm vi có bài nộp)');
      assert(!!res.workbook.getWorksheet('Siêu thị A'), 'phải có sheet Siêu thị A (thuộc mẫu TRONG phạm vi)');
      assert(!res.workbook.getWorksheet('Siêu thị B'), 'KHÔNG được có sheet Siêu thị B (thuộc mẫu NGOÀI phạm vi report-view, dù cùng templateKind DEDUCTION)');
    });

    await run.run('submissions/start (STORE_SELF): checklistStoreSelfExecuteScope giới hạn 1 mẫu -> 403 khi bắt đầu mẫu NGOÀI phạm vi', async () => {
      resetRecords();
      const tIn = seedQaTemplate({ templateCode: 'CL_SELF_IN' });
      const tOut = seedQaTemplate({ templateCode: 'CL_SELF_OUT' });
      STORE_EMP_SCOPED = { username: 'nv_scoped', name: 'NV Siêu Thị Giới Hạn', dept: 'Siêu thị A', posType: 'STORE', perms: { checklistStoreSelfExecute: true, checklistStoreSelfExecuteScope: { all: false, depts: [String(tIn.id)] } }, active: true };
      USERS = [ADMIN, STORE_EMP_SCOPED];
      const res = await apiJson('POST', '/api/checklist/submissions/start', { templateId: tOut.id }, STORE_EMP_SCOPED);
      assertEqual(res.status, 403, 'mẫu NGOÀI phạm vi Tự Đánh Giá phải bị chặn dù checklistStoreSelfExecute=true chung');
    });

    await run.run('submissions/start (STORE_SELF): checklistStoreSelfExecuteScope giới hạn 1 mẫu -> 200 khi bắt đầu ĐÚNG mẫu trong phạm vi', async () => {
      resetRecords();
      const tIn = seedQaTemplate({ templateCode: 'CL_SELF_IN' });
      STORE_EMP_SCOPED = { username: 'nv_scoped', name: 'NV Siêu Thị Giới Hạn', dept: 'Siêu thị A', posType: 'STORE', perms: { checklistStoreSelfExecute: true, checklistStoreSelfExecuteScope: { all: false, depts: [String(tIn.id)] } }, active: true };
      USERS = [ADMIN, STORE_EMP_SCOPED];
      const res = await apiJson('POST', '/api/checklist/submissions/start', { templateId: tIn.id }, STORE_EMP_SCOPED);
      assertEqual(res.status, 200, 'mẫu TRONG phạm vi phải bắt đầu được bình thường');
      assertEqual(res.body?.item?.storeCode, 'Siêu thị A', 'storeCode vẫn phải tự suy từ user.dept như cũ');
    });

    await run.run('submissions/start (STORE_SELF): CHƯA từng lưu Scope (legacy) vẫn làm được MỌI mẫu như hành vi cũ', async () => {
      resetRecords();
      const t1 = seedQaTemplate({ templateCode: 'CL_LEGACY_1' });
      const LEGACY_EMP = { username: 'nv_legacy', name: 'NV Siêu Thị Cũ', dept: 'Siêu thị A', posType: 'STORE', perms: { checklistStoreSelfExecute: true }, active: true };
      USERS = [ADMIN, LEGACY_EMP];
      const res = await apiJson('POST', '/api/checklist/submissions/start', { templateId: t1.id }, LEGACY_EMP);
      assertEqual(res.status, 200, 'tài khoản cũ (chưa có field Scope) không được coi là bị giới hạn — không regression');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
