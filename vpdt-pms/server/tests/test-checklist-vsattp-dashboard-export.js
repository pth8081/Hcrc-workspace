// server/tests/test-checklist-vsattp-dashboard-export.js
//
// Regression cho POST /api/checklist/vsattp-dashboard/export (10/2026, yêu cầu người dùng "gộp chung
// file") — dựng theo ĐÚNG khuôn tests/test-checklist.js (stub lib/appData/lib/recordStore/lib/auth, chạy
// thẳng routes/checklist.js thật qua HTTP). Kiểm:
//   1. Quyền: chỉ checklistReportView (hoặc admin) mới gọi được, người khác bị 403.
//   2. Server TỰ TÍNH LẠI từ DB (không tin số liệu client) — trả file .xlsx hợp lệ (đọc lại bằng exceljs,
//      xác nhận có sheet "Dashboard" + sheet chi tiết từng siêu thị).
//   3. Không có bài nào khớp bộ lọc -> 400 rõ ràng, không crash 500.
//   4. Mẫu QA (không phải DEDUCTION) bị loại khỏi export dù cùng hệ thống.
//
// Chạy: node server/tests/test-checklist-vsattp-dashboard-export.js
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
const REPORTER = { username: 'bc1', name: 'Người Xem Báo Cáo', dept: 'Phòng Vận Hành', posType: 'HO', perms: { checklistReportView: true }, active: true };
const NOBODY = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Phòng Vận Hành', posType: 'HO', perms: {}, active: true };
const USERS = [ADMIN, REPORTER, NOBODY];

let RECORDS;
function resetRecords() { RECORDS = { checklistTemplates: [], checklistSubmissions: [] }; }
resetRecords();

const STORES = ['Siêu Thị A', 'Siêu Thị B'];
const STORE_TYPES = { 'Siêu Thị A': 'ST', 'Siêu Thị B': 'ST' };
stubModule('lib/appData', {
  getAppDataValue: async () => null,
  getAppDataValueCached: async (key) => {
    if (key === 'stores') return STORES;
    if (key === 'storeTypes') return STORE_TYPES;
    return null;
  },
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
  deleteRecordForCollection: async () => true
});
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
const { createRunner, assertEqual, assert } = require('./testHarness');
const checklistRoutes = require('../routes/checklist');
const checklist = require('../lib/checklist');
const ExcelJS = require('exceljs');

let PORT = 0;
let idSeq = 1000;
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
async function apiRaw(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return res;
}

function seedDeductionTemplate(overrides) {
  const core = checklist.assertTemplateCoreFields(Object.assign({
    templateCode: 'CL_DED_TEST', templateName: 'Checklist VSATTP Kiểm Tra', templateType: 'CONTROL_AUDIT', templateKind: 'DEDUCTION'
  }, overrides));
  const categories = checklist.validateChecklistCategories(overrides?.categories || [
    { name: 'Chất Lượng', maxDeduction: 30, subItems: [{ name: 'Cảm quan', maxDeduction: 30, criteria: [
      { description: 'Sản phẩm hết hạn sử dụng', perInstanceValue: 4 }
    ] }] }
  ]);
  const template = Object.assign({ id: idSeq++, status: 'ACTIVE', version: 1, clonedFromTemplateId: null, activatedAt: checklist.nowVN(), creator: 'admin', creatorName: 'Quản Trị Viên' }, core, { categories });
  RECORDS.checklistTemplates.push(template);
  return template;
}
function seedQaTemplate(overrides) {
  const core = checklist.assertTemplateCoreFields(Object.assign({
    templateCode: 'CL_QA_TEST', templateName: 'Checklist Tự Đánh Giá', templateType: 'STORE_SELF'
  }, overrides));
  const questions = checklist.validateChecklistQuestions([{ text: 'Đạt không?', isRequired: true, maxScore: 10, options: [{ text: 'Đạt', scoreValue: 10, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }] }]);
  const template = Object.assign({ id: idSeq++, status: 'ACTIVE', version: 1, clonedFromTemplateId: null, activatedAt: checklist.nowVN(), creator: 'admin', creatorName: 'Quản Trị Viên' }, core, { questions });
  RECORDS.checklistTemplates.push(template);
  return template;
}
function seedSubmission(template, overrides) {
  // criteria id sinh bởi validateChecklistCategories() — lấy id thật ở tiêu chí đầu tiên (khớp cách builder gán id toàn cục).
  const firstCriteriaId = template.categories?.[0]?.subItems?.[0]?.criteria?.[0]?.id;
  const sub = Object.assign({
    id: idSeq++, templateId: template.id, templateCode: template.templateCode, templateName: template.templateName,
    templateType: template.templateType, templateVersion: template.version,
    storeCode: 'Siêu Thị A', submittedByUsername: 'ks1', submittedByName: 'Kiểm Soát Viên', status: 'SUBMITTED',
    answers: [], deductions: firstCriteriaId ? [{ criteriaId: firstCriteriaId, deductedPoints: 4, description: '', riskLevel: null, deadline: '', note: '' }] : [],
    totalScore: 96, maxPossibleScore: 100, scorePercent: 96, hasCriticalFail: false, isPassed: true,
    startedAt: checklist.nowVN(), submittedAt: checklist.nowVN(),
    storeResponseText: null, storeRespondedAt: null, storeRespondedByUsername: null, storeRespondedByName: null, storeResponseHistory: []
  }, overrides);
  RECORDS.checklistSubmissions.push(sub);
  return sub;
}

async function main() {
  const server = await startApp();
  const run = createRunner();
  try {
    await run.run('403: người không có checklistReportView bị chặn', async () => {
      resetRecords();
      const res = await apiRaw('POST', '/api/checklist/vsattp-dashboard/export', {}, NOBODY);
      assertEqual(res.status, 403, 'Phải trả 403');
    });

    await run.run('400: không có bài nào khớp bộ lọc -> báo lỗi rõ ràng, không crash', async () => {
      resetRecords();
      const res = await apiRaw('POST', '/api/checklist/vsattp-dashboard/export', {}, REPORTER);
      assertEqual(res.status, 400, 'Phải trả 400 khi không có dữ liệu');
      const body = await res.json();
      assert(!!body.error, 'Phải có thông báo lỗi');
    });

    await run.run('200: xuất file .xlsx hợp lệ, có sheet Dashboard + sheet siêu thị, đúng quyền REPORTER', async () => {
      resetRecords();
      const t = seedDeductionTemplate({});
      seedSubmission(t, { storeCode: 'Siêu Thị A', scorePercent: 96 });
      seedSubmission(t, { storeCode: 'Siêu Thị B', scorePercent: 90, deductions: [] });
      const res = await apiRaw('POST', '/api/checklist/vsattp-dashboard/export', {}, REPORTER);
      assertEqual(res.status, 200, 'Phải trả 200');
      assertEqual(res.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Đúng content-type Excel');
      const buf = Buffer.from(await res.arrayBuffer());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const sheetNames = wb.worksheets.map(ws => ws.name);
      assert(sheetNames.includes('Dashboard'), 'Phải có sheet "Dashboard" — got: ' + JSON.stringify(sheetNames));
      assert(sheetNames.includes('Siêu Thị A'), 'Phải có sheet chi tiết "Siêu Thị A" — got: ' + JSON.stringify(sheetNames));
      assert(sheetNames.includes('Siêu Thị B'), 'Phải có sheet chi tiết "Siêu Thị B" — got: ' + JSON.stringify(sheetNames));
    });

    await run.run('Mẫu QA (không phải DEDUCTION) không lọt vào export dù cùng hệ thống', async () => {
      resetRecords();
      const dedT = seedDeductionTemplate({});
      const qaT = seedQaTemplate({});
      seedSubmission(dedT, { storeCode: 'Siêu Thị A' });
      // Bài mẫu QA — dùng route generic /submissions/start thật sự sẽ khác, ở đây seed thẳng vào RECORDS.
      RECORDS.checklistSubmissions.push({ id: idSeq++, templateId: qaT.id, templateName: qaT.templateName, templateType: qaT.templateType, storeCode: 'Siêu Thị B', status: 'SUBMITTED', answers: [], deductions: [], scorePercent: 50, submittedAt: checklist.nowVN(), submittedByUsername: 'nv2', submittedByName: 'NV2' });
      const res = await apiRaw('POST', '/api/checklist/vsattp-dashboard/export', {}, REPORTER);
      assertEqual(res.status, 200, 'Phải trả 200 (vẫn có dữ liệu mẫu DEDUCTION)');
      const buf = Buffer.from(await res.arrayBuffer());
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf);
      const sheetNames = wb.worksheets.map(ws => ws.name);
      assert(!sheetNames.includes('Siêu Thị B'), '"Siêu Thị B" (chỉ có bài mẫu QA) KHÔNG được xuất hiện — got: ' + JSON.stringify(sheetNames));
    });

  } finally {
    run.summary();
    server.close();
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exit(1); });
