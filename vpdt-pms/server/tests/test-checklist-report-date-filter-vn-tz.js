// server/tests/test-checklist-report-date-filter-vn-tz.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng gửi ảnh chụp: lọc "Xuất Theo Mẫu Gốc" từ ngày 3/11 đến 3/11 báo lỗi
// "Không có bài đã nộp nào khớp bộ lọc" dù siêu thị ĐÃ nộp đúng ngày 3/11, trong khi lọc 2/11-3/11 lại ra
// kết quả đúng): routes/checklist.js (cả /export-report lẫn /vsattp-dashboard/export) parse fromDate/toDate
// bằng thẳng `new Date(req.body.fromDate)` — chuỗi "YYYY-MM-DD" KHÔNG giờ/zone LUÔN parse theo UTC (đặc tả
// ECMA-262), trong khi submittedDate (parseSubmittedAtDate()) dựng theo GIỜ ĐỊA PHƯƠNG máy chủ. Trên máy
// chủ chạy giờ VN (UTC+7), 00:00 UTC = 07:00 SÁNG VN-local CÙNG NGÀY -> fromDate bị neo trễ 7 tiếng so với
// mốc nửa đêm VN-local submittedDate đang dùng -> MỌI bài nộp ĐÚNG ngày đang lọc bị loại nhầm. Đã vá: thêm
// parseFilterDateLocal() (parse "YYYY-MM-DD" theo giờ địa phương, mirror parseISODateOnly() ở
// lib/recordActions.js) dùng cho cả 2 route.
//
// Cũng test kèm bản vá lỗi cột "ID Lượt Nộp" hiện ký hiệu khoa học (lib/checklistReportExport.js —
// sub.id ghi thẳng dạng SỐ, Date.now() 13 chữ số -> Excel tự hiện "1.79367E+12" -> đã ép thành chuỗi).
//
// Cùng khuôn tests/test-checklist-export.js (stub lib/appData/lib/recordStore/lib/auth, chạy thẳng express
// router THẬT routes/checklist.js) — THÊM process.env.TZ='Asia/Ho_Chi_Minh' (mirror kỹ thuật đã dùng ở
// tests/test-vppregistrations-deadline-utc.js) để THỰC SỰ tái hiện đúng lệch múi giờ máy chủ VN.
//
// Chạy: node server/tests/test-checklist-report-date-filter-vn-tz.js
'use strict';
process.env.TZ = 'Asia/Ho_Chi_Minh';
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

const REPORTER = { username: 'bc1', name: 'Người Xem Báo Cáo', dept: 'Phòng Vận Hành', posType: 'HO', perms: { checklistReportView: true }, active: true };
let USERS = [REPORTER];

let RECORDS;
function resetRecords() { RECORDS = { checklistTemplates: [], checklistSubmissions: [] }; }
resetRecords();

let PORT = 0;
let CURRENT_USERNAME = REPORTER.username;
let idSeq = 1000;

stubModule('lib/appData', {
  getAppDataValue: async () => null, getAllAppData: async () => ({}), withLockedAppDataValue: async (key, fn) => fn(null),
  getAppDataValueCached: async () => []
});
stubModule('lib/recordStore', {
  getAllForCollection: async (collection) => RECORDS[collection] || [],
  insertRecord: async (collection, record) => { RECORDS[collection] = RECORDS[collection] || []; RECORDS[collection].push(record); return record; },
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
async function apiXlsx(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (res.status !== 200) {
    let payload = null;
    try { payload = await res.json(); } catch (e) { payload = null; }
    return { status: res.status, body: payload, workbook: null };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return { status: res.status, workbook: wb };
}

function seedQaTemplate() {
  const core = checklist.assertTemplateCoreFields({
    templateCode: 'CL_TZ_QA', templateName: 'Checklist Test Múi Giờ', templateType: 'STORE_SELF'
  });
  const questions = checklist.validateChecklistQuestions([
    { text: 'Câu hỏi 1', isRequired: true, category: '',
      options: [{ text: 'Đạt', scoreValue: 1, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }] }
  ], 'SCORED');
  const template = Object.assign({ id: idSeq++, status: 'ACTIVE', version: 1, clonedFromTemplateId: null, activatedAt: checklist.nowVN(), creator: 'admin', creatorName: 'Quản Trị Viên' }, core, { questions });
  RECORDS.checklistTemplates.push(template);
  return template;
}
function submittedSubmission(template, { storeCode, submittedAt }) {
  const q = template.questions;
  return {
    id: 1793670000000 + idSeq++, templateId: template.id, templateCode: template.templateCode, templateName: template.templateName,
    templateType: template.templateType, templateVersion: template.version,
    storeCode, submittedByUsername: 'nv1', submittedByName: 'Nhân Viên Test',
    status: 'SUBMITTED', answers: [{ questionId: q[0].id, optionIds: [q[0].options[0].id], note: '' }], deductions: [],
    totalScore: 1, maxPossibleScore: 1, scorePercent: 100, hasCriticalFail: false, isPassed: true,
    startedAt: submittedAt, submittedAt,
    storeResponseText: null, storeRespondedAt: null, storeRespondedByUsername: null, storeRespondedByName: null
  };
}

function seedDeductionTemplate() {
  const core = checklist.assertTemplateCoreFields({
    templateCode: 'CL_TZ_DED', templateName: 'Checklist Test Múi Giờ VSATTP', templateType: 'CONTROL_AUDIT', templateKind: 'DEDUCTION'
  });
  const categories = checklist.validateChecklistCategories([
    { name: 'NHOM A', maxDeduction: 10, subItems: [
      { name: 'Muc con', maxDeduction: null, criteria: [{ description: 'Tieu chi', perInstanceValue: 2, ruleText: 'Cho 1 loi' }] }
    ] }
  ]);
  const template = Object.assign({ id: idSeq++, status: 'ACTIVE', version: 1, clonedFromTemplateId: null, activatedAt: checklist.nowVN(), creator: 'admin', creatorName: 'Quản Trị Viên' }, core, { categories });
  RECORDS.checklistTemplates.push(template);
  return template;
}
function submittedDeductionSubmission(template, { storeCode, submittedAt }) {
  const critId = template.categories[0].subItems[0].criteria[0].id;
  return {
    id: idSeq++, templateId: template.id, templateCode: template.templateCode, templateName: template.templateName,
    templateType: template.templateType, templateVersion: template.version,
    storeCode, submittedByUsername: 'ks1', submittedByName: 'Kiểm Soát Viên Test',
    status: 'SUBMITTED', answers: [],
    deductions: [{ criteriaId: critId, deductedPoints: 2, description: 'Loi', riskLevel: 'B', deadline: '', note: '', attachments: [] }],
    totalScore: 8, maxPossibleScore: 10, scorePercent: 80, hasCriticalFail: false, isPassed: true,
    startedAt: submittedAt, submittedAt,
    storeResponseText: null, storeRespondedAt: null, storeRespondedByUsername: null, storeRespondedByName: null
  };
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('export-report (QA): lọc "từ ngày 3/11 đến 3/11" (CÙNG 1 ngày) PHẢI xuất được bài nộp ĐÚNG ngày đó (server giờ VN)', async () => {
      resetRecords();
      const t = seedQaTemplate();
      RECORDS.checklistSubmissions.push(submittedSubmission(t, { storeCode: 'Siêu thị số 275 Nguyễn Trãi', submittedAt: '09:29:48 3/11/2026' }));
      const res = await apiXlsx('POST', '/api/checklist/export-report', { templateId: t.id, fromDate: '2026-11-03', toDate: '2026-11-03' }, REPORTER);
      assertEqual(res.status, 200, 'LỖI CHƯA VÁ nếu trả 400 "Không có bài đã nộp nào khớp bộ lọc" — đúng y lỗi người dùng báo');
    });

    await run.run('export-report (QA): lọc "từ ngày 2/11 đến 3/11" (đối chứng, khoảng rộng hơn) vẫn xuất được như trước', async () => {
      resetRecords();
      const t = seedQaTemplate();
      RECORDS.checklistSubmissions.push(submittedSubmission(t, { storeCode: 'Siêu thị số 275 Nguyễn Trãi', submittedAt: '09:29:48 3/11/2026' }));
      const res = await apiXlsx('POST', '/api/checklist/export-report', { templateId: t.id, fromDate: '2026-11-02', toDate: '2026-11-03' }, REPORTER);
      assertEqual(res.status, 200, 'Khoảng ngày rộng hơn (bao phủ đúng ngày nộp) phải luôn xuất được, không được thụt lùi hành vi cũ');
    });

    await run.run('export-report (QA): lọc ngày THỰC SỰ không khớp (bài nộp ngoài phạm vi) vẫn đúng 400 — không vá quá tay thành luôn chấp nhận', async () => {
      resetRecords();
      const t = seedQaTemplate();
      RECORDS.checklistSubmissions.push(submittedSubmission(t, { storeCode: 'Siêu thị A', submittedAt: '09:29:48 1/11/2026' }));
      const res = await apiXlsx('POST', '/api/checklist/export-report', { templateId: t.id, fromDate: '2026-11-03', toDate: '2026-11-03' }, REPORTER);
      assertEqual(res.status, 400, 'Bài nộp THỰC SỰ ngoài khoảng ngày lọc vẫn phải bị loại đúng (400), không phải lỗi "chấp nhận tất cả"');
    });

    await run.run('export-report (QA): cột "ID Lượt Nộp" ở sheet "Dữ Liệu Chi Tiết (Gộp)" phải là CHUỖI đầy đủ chữ số, không phải số (tránh Excel hiện ký hiệu khoa học)', async () => {
      resetRecords();
      const t = seedQaTemplate();
      const sub = submittedSubmission(t, { storeCode: 'Siêu thị số 275 Nguyễn Trãi', submittedAt: '09:29:48 3/11/2026' });
      RECORDS.checklistSubmissions.push(sub);
      const res = await apiXlsx('POST', '/api/checklist/export-report', { templateId: t.id, fromDate: '2026-11-03', toDate: '2026-11-03' }, REPORTER);
      assertEqual(res.status, 200, 'Phải xuất thành công để kiểm tra cột ID');
      const sheet = res.workbook.getWorksheet('Dữ Liệu Chi Tiết (Gộp)');
      const idCell = sheet.getRow(2).getCell(1).value;
      assertEqual(typeof idCell, 'string', `LỖI CHƯA VÁ nếu kiểu dữ liệu là 'number' (Excel sẽ tự hiện ký hiệu khoa học) — nhận được kiểu '${typeof idCell}'`);
      assertEqual(idCell, String(sub.id), 'Giá trị chuỗi phải đúng ĐẦY ĐỦ chữ số id gốc, không bị cắt/làm tròn');
    });

    await run.run('vsattp-dashboard/export: lọc "từ ngày 3/11 đến 3/11" (CÙNG 1 ngày) PHẢI xuất được bài nộp ĐÚNG ngày đó', async () => {
      resetRecords();
      const t = seedDeductionTemplate();
      RECORDS.checklistSubmissions.push(submittedDeductionSubmission(t, { storeCode: 'Siêu thị số 275 Nguyễn Trãi', submittedAt: '09:28:13 3/11/2026' }));
      const res = await apiXlsx('POST', '/api/checklist/vsattp-dashboard/export', { fromDate: '2026-11-03', toDate: '2026-11-03' }, REPORTER);
      assertEqual(res.status, 200, 'LỖI CHƯA VÁ nếu trả 400 — Dashboard VSATTP dùng CHUNG lỗi UTC/giờ địa phương với export-report');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(err => { console.error(err); process.exit(1); });
