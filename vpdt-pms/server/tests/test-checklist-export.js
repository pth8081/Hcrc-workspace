// server/tests/test-checklist-export.js
//
// Regression test cho tính năng MỚI v21.1: "Xuất Excel Theo Mẫu Gốc" (POST /api/checklist/export-report,
// lib/checklistReportExport.js) — xuất báo cáo checklist ĐÃ NỘP ra file .xlsx đúng layout mẫu người dùng
// gửi (2 file: "form_xuat_can.xlsx" cho loại QA/Câu Hỏi & Đáp Án, file VSATTP cho loại DEDUCTION), hỗ trợ
// chọn 1/nhiều/tất cả siêu thị — MỖI SIÊU THỊ 1 SHEET RIÊNG.
//
// Cùng khuôn test-checklist.js: stub lib/appData/lib/recordStore/lib/auth, chạy thẳng express router
// THẬT (routes/checklist.js) — KHÁC ở chỗ response là file nhị phân (.xlsx), không phải JSON, nên đọc lại
// bằng ExcelJS thật để xác minh ĐÚNG nội dung/định dạng từng ô thay vì chỉ kiểm tra status code.
//
// Chạy: node server/tests/test-checklist-export.js
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

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', posType: 'HO', perms: { admin: true }, active: true };
const REPORTER = { username: 'bc1', name: 'Người Xem Báo Cáo', dept: 'Phòng Vận Hành', posType: 'HO', perms: { checklistReportView: true }, active: true };
const NOBODY = { username: 'kh1', name: 'Không Có Quyền', dept: 'Phòng Vận Hành', posType: 'HO', perms: {}, active: true };
let USERS = [ADMIN, REPORTER, NOBODY];

let RECORDS;
function resetRecords() { RECORDS = { checklistTemplates: [], checklistSubmissions: [] }; }
resetRecords();

let PORT = 0;
let CURRENT_USERNAME = ADMIN.username;
let idSeq = 1000;

stubModule('lib/appData', {
  getAppDataValue: async () => null, getAllAppData: async () => ({}), withLockedAppDataValue: async (key, fn) => fn(null),
  // getAppDataValueCached('stores') — dùng cho coverage "đã làm/chưa làm checklist" (10/2026, đợt "xuất
  // Excel Checklist ST/CH giống báo cáo qua web cũ") — mảng rỗng là đủ, test này không kiểm tra coverage.
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
async function apiJson(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}
// Đọc lại workbook nhị phân trả về THẬT bằng ExcelJS — xác minh ĐÚNG nội dung ô, không chỉ status code.
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
    templateCode: 'CL_EXP_QA', templateName: 'Checklist Xuất Báo Cáo QA', templateType: 'STORE_SELF'
  });
  const questions = checklist.validateChecklistQuestions([
    {
      text: 'Hình ảnh biển hiệu nguyên vẹn', isRequired: true, category: '1. Kiểm soát cảnh quan chung',
      options: [{ text: 'Đạt', scoreValue: 1, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }]
    },
    {
      text: 'Âm thanh ánh sáng đầy đủ', isRequired: true, category: '1. Kiểm soát cảnh quan chung',
      options: [{ text: 'Đạt', scoreValue: 1, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }]
    },
    {
      text: 'Câu hỏi độc lập không thuộc nhóm nào', isRequired: true, category: '',
      options: [{ text: 'Đạt', scoreValue: 1, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }]
    }
  ], 'SCORED');
  const template = Object.assign({ id: idSeq++, status: 'ACTIVE', version: 1, clonedFromTemplateId: null, activatedAt: checklist.nowVN(), creator: 'admin', creatorName: 'Quản Trị Viên' }, core, { questions });
  RECORDS.checklistTemplates.push(template);
  return template;
}
function submittedSubmission(template, { storeCode, submittedAt, answersOverride }) {
  const q = template.questions;
  const answers = answersOverride || [
    { questionId: q[0].id, optionIds: [q[0].options[0].id], note: '' }, // Đạt
    { questionId: q[1].id, optionIds: [q[1].options[1].id], note: 'Đèn hỏng' }, // Không đạt
    { questionId: q[2].id, optionIds: [q[2].options[0].id], note: '' } // Đạt, không nhóm
  ];
  return {
    id: idSeq++, templateId: template.id, templateCode: template.templateCode, templateName: template.templateName,
    templateType: template.templateType, templateVersion: template.version,
    storeCode, submittedByUsername: 'nv1', submittedByName: 'Nhân Viên Test',
    status: 'SUBMITTED', answers, deductions: [],
    totalScore: 2, maxPossibleScore: 3, scorePercent: 66.7, hasCriticalFail: false, isPassed: true,
    startedAt: submittedAt, submittedAt,
    storeResponseText: null, storeRespondedAt: null, storeRespondedByUsername: null, storeRespondedByName: null
  };
}

function seedDeductionTemplate() {
  const core = checklist.assertTemplateCoreFields({
    templateCode: 'CL_EXP_DED', templateName: 'Checklist Xuất Báo Cáo Trừ Điểm', templateType: 'CONTROL_AUDIT', templateKind: 'DEDUCTION'
  });
  const categories = checklist.validateChecklistCategories([
    { name: 'CHẤT LƯỢNG SẢN PHẨM', maxDeduction: 30, subItems: [
      { name: 'Chất lượng cảm quan', maxDeduction: null, criteria: [{ description: 'Bao bì không nguyên vẹn', perInstanceValue: 2, ruleText: 'Cho 1 mã SP' }] }
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
    deductions: [{ criteriaId: critId, deductedPoints: 6, description: 'Rách bao bì 3 sản phẩm', riskLevel: 'B', deadline: '20/09/2026', note: 'Đã nhắc nhở', attachments: [] }],
    totalScore: 24, maxPossibleScore: 30, scorePercent: 80, hasCriticalFail: false, isPassed: true,
    startedAt: submittedAt, submittedAt,
    storeResponseText: null, storeRespondedAt: null, storeRespondedByUsername: null, storeRespondedByName: null
  };
}

function findRowTexts(sheet, rowNumber) {
  const row = sheet.getRow(rowNumber);
  const vals = [];
  for (let c = 1; c <= sheet.columnCount; c++) vals.push(row.getCell(c).value ?? '');
  return vals;
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('export-report: thiếu quyền checklistReportView (không phải admin) bị 403', async () => {
      resetRecords();
      const t = seedQaTemplate();
      RECORDS.checklistSubmissions.push(submittedSubmission(t, { storeCode: 'Siêu thị A', submittedAt: '10:00:00 1/9/2026' }));
      const res = await apiJson('POST', '/api/checklist/export-report', { templateId: t.id }, NOBODY);
      assertEqual(res.status, 403, 'Không có checklistReportView/admin thì phải bị 403');
    });

    await run.run('export-report: thiếu templateId hợp lệ -> 400', async () => {
      resetRecords();
      const res = await apiJson('POST', '/api/checklist/export-report', {}, REPORTER);
      assertEqual(res.status, 400, 'Thiếu templateId phải bị 400 (không hỗ trợ "Tất cả mẫu" cùng lúc)');
    });

    await run.run('export-report: không có bài nào khớp bộ lọc -> 400', async () => {
      resetRecords();
      const t = seedQaTemplate();
      const res = await apiJson('POST', '/api/checklist/export-report', { templateId: t.id }, REPORTER);
      assertEqual(res.status, 400, 'Không có bài nộp nào thì phải báo lỗi rõ ràng, không xuất file rỗng');
    });

    await run.run('export-report (QA): 2 siêu thị -> 4 sheet (mỗi ST 1 cặp Chi tiết/Thống kê), đúng tên sheet', async () => {
      resetRecords();
      const t = seedQaTemplate();
      RECORDS.checklistSubmissions.push(submittedSubmission(t, { storeCode: 'Siêu thị A', submittedAt: '10:00:00 5/9/2026' }));
      RECORDS.checklistSubmissions.push(submittedSubmission(t, { storeCode: 'Siêu thị B', submittedAt: '11:00:00 5/9/2026' }));
      const res = await apiXlsx('POST', '/api/checklist/export-report', { templateId: t.id }, REPORTER);
      assertEqual(res.status, 200, 'Phải xuất thành công');
      const names = res.workbook.worksheets.map(s => s.name).sort();
      // 10/2026 (đợt "xuất Excel Checklist ST/CH giống báo cáo qua web cũ"): THÊM 4 sheet gộp mới ở đầu
      // workbook (Dữ Liệu Chi Tiết Gộp/Recap/Top Xếp Hạng/Đã Làm-Chưa Làm) — KHÔNG thay thế 4 sheet riêng
      // từng ST cũ, chỉ cộng thêm.
      const expected = [
        'Siêu thị A - Chi tiết', 'Siêu thị A - Thống kê', 'Siêu thị B - Chi tiết', 'Siêu thị B - Thống kê',
        'Dữ Liệu Chi Tiết (Gộp)', 'Recap - Cần Xử Lý', 'Top Xếp Hạng', 'Đã Làm-Chưa Làm'
      ].sort();
      assertEqual(JSON.stringify(names), JSON.stringify(expected), 'Phải có đúng 8 sheet (4 sheet riêng từng ST cũ + 4 sheet gộp mới), đặt tên đúng quy ước');
    });

    await run.run('export-report (QA): sheet Chi tiết có dòng tiêu đề nhóm (in đậm) + đúng Đạt/Không đạt + Thời gian hoàn thành ĐỂ TRỐNG', async () => {
      resetRecords();
      const t = seedQaTemplate();
      RECORDS.checklistSubmissions.push(submittedSubmission(t, { storeCode: 'Siêu thị A', submittedAt: '10:00:00 5/9/2026' }));
      const res = await apiXlsx('POST', '/api/checklist/export-report', { templateId: t.id, storeCodes: ['Siêu thị A'] }, REPORTER);
      const sheet = res.workbook.getWorksheet('Siêu thị A - Chi tiết');
      // Câu 1/2 CÓ category "1. Kiểm soát cảnh quan chung" -> in 1 dòng tiêu đề trước khi liệt kê 2 câu đó;
      // câu 3 KHÔNG có category -> đứng ngay sau, không có dòng tiêu đề riêng.
      const headerRow = findRowTexts(sheet, 2); // dòng 1 = header cột, dòng 2 = dòng tiêu đề nhóm
      assertEqual(headerRow[3], '1. Kiểm soát cảnh quan chung', 'Dòng 2 phải là tiêu đề nhóm');
      assertEqual(sheet.getRow(2).font.bold, true, 'Dòng tiêu đề nhóm phải in đậm');
      const passRow = findRowTexts(sheet, 3);
      assertEqual(passRow[3], 'Hình ảnh biển hiệu nguyên vẹn', 'Dòng 3 phải là câu hỏi đầu nhóm');
      assertEqual(passRow[4], 'Đạt', 'Câu trả lời Đạt phải hiện đúng "Đạt"');
      assertEqual(passRow[6], '', 'Thời gian hoàn thành phải ĐỂ TRỐNG (quyết định đã chốt với người dùng)');
      const failRow = findRowTexts(sheet, 4);
      assertEqual(failRow[3], 'Âm thanh ánh sáng đầy đủ', 'Dòng 4 phải là câu hỏi thứ 2 trong nhóm');
      assertEqual(failRow[4], 'Không đạt', 'Câu trả lời Không đạt phải hiện đúng "Không đạt"');
      assertEqual(failRow[5], 'Đèn hỏng', 'Mô tả lý do chưa đạt phải lấy đúng từ answer.note');
      const independentRow = findRowTexts(sheet, 5);
      assertEqual(independentRow[3], 'Câu hỏi độc lập không thuộc nhóm nào', 'Câu không có category phải đứng NGAY sau, không có dòng tiêu đề riêng');
      assertEqual(independentRow[4], 'Đạt', 'Câu độc lập vẫn phải có kết quả đúng');
    });

    await run.run('export-report (QA): sheet Thống kê tính đúng % Đạt theo nhóm + gom câu ngoài nhóm', async () => {
      resetRecords();
      const t = seedQaTemplate();
      RECORDS.checklistSubmissions.push(submittedSubmission(t, { storeCode: 'Siêu thị A', submittedAt: '10:00:00 5/9/2026' }));
      const res = await apiXlsx('POST', '/api/checklist/export-report', { templateId: t.id, storeCodes: ['Siêu thị A'] }, REPORTER);
      const sheet = res.workbook.getWorksheet('Siêu thị A - Thống kê');
      const row2 = findRowTexts(sheet, 2);
      assertEqual(row2[0], '1. Kiểm soát cảnh quan chung', 'Dòng đầu phải đúng tên nhóm');
      assertEqual(row2[1], '50.0%', 'Nhóm có 1 Đạt/1 Không đạt -> 50.0%');
      const row3 = findRowTexts(sheet, 3);
      assertEqual(row3[0], 'Câu hỏi khác (không thuộc nhóm)', 'Phải gom câu KHÔNG có category vào bucket riêng, không bỏ sót dữ liệu');
      assertEqual(row3[1], '100.0%', 'Câu độc lập duy nhất Đạt -> 100.0%');
    });

    await run.run('export-report: lọc theo storeCodes chỉ trả đúng siêu thị được chọn', async () => {
      resetRecords();
      const t = seedQaTemplate();
      RECORDS.checklistSubmissions.push(submittedSubmission(t, { storeCode: 'Siêu thị A', submittedAt: '10:00:00 5/9/2026' }));
      RECORDS.checklistSubmissions.push(submittedSubmission(t, { storeCode: 'Siêu thị B', submittedAt: '10:00:00 5/9/2026' }));
      const res = await apiXlsx('POST', '/api/checklist/export-report', { templateId: t.id, storeCodes: ['Siêu thị B'] }, REPORTER);
      const names = res.workbook.worksheets.map(s => s.name);
      assertEqual(names.some(n => n.startsWith('Siêu thị A')), false, 'KHÔNG được có sheet của siêu thị không được chọn');
      assertEqual(names.some(n => n.startsWith('Siêu thị B')), true, 'Phải có sheet của siêu thị được chọn');
    });

    await run.run('export-report: lọc theo khoảng ngày loại đúng bài ngoài phạm vi', async () => {
      resetRecords();
      const t = seedQaTemplate();
      RECORDS.checklistSubmissions.push(submittedSubmission(t, { storeCode: 'Siêu thị A', submittedAt: '10:00:00 1/1/2026' })); // ngoài phạm vi
      RECORDS.checklistSubmissions.push(submittedSubmission(t, { storeCode: 'Siêu thị A', submittedAt: '10:00:00 5/9/2026' })); // trong phạm vi
      const res = await apiXlsx('POST', '/api/checklist/export-report', { templateId: t.id, fromDate: '2026-09-01', toDate: '2026-09-30' }, REPORTER);
      const sheet = res.workbook.getWorksheet('Siêu thị A - Chi tiết');
      // Chỉ 1 bài trong phạm vi -> KHÔNG có dòng trống ngăn cách (chỉ xuất hiện khi >=2 submissions)
      assertEqual(sheet.getRow(1).getCell(1).value, 'Thời gian báo cáo', 'Sheet vẫn phải có header cột như thường');
      let hasOutOfRangeDate = false;
      for (let r = 1; r <= sheet.rowCount; r++) { if (sheet.getRow(r).getCell(1).value === '10:00:00 1/1/2026') hasOutOfRangeDate = true; }
      assertEqual(hasOutOfRangeDate, false, 'Bài NGOÀI khoảng ngày lọc không được xuất hiện trong file');
    });

    await run.run('export-report (DEDUCTION): mirror đúng cây Hạng Mục/Hạng Mục Con/Tiêu Chí + điểm trừ thực tế + dòng tổng điểm', async () => {
      resetRecords();
      const t = seedDeductionTemplate();
      RECORDS.checklistSubmissions.push(submittedDeductionSubmission(t, { storeCode: 'Siêu thị A', submittedAt: '10:00:00 5/9/2026' }));
      const res = await apiXlsx('POST', '/api/checklist/export-report', { templateId: t.id }, REPORTER);
      assertEqual(res.status, 200, 'Phải xuất thành công cho loại DEDUCTION');
      const sheet = res.workbook.getWorksheet('Siêu thị A');
      const summaryRow = findRowTexts(sheet, 2);
      // Cột thứ 3 (index 2) là "Mẫu Checklist" (thêm ở đợt Dashboard VSATTP, commit 826023b) — dòng tổng
      // kết/cây tiêu chí đều lùi thêm 1 cột so với bản gốc v21.1, index bên dưới đã cập nhật theo đúng
      // layout hiện tại (xem addDeductionStoreSheet() ở lib/checklistReportExport.js).
      assertEqual(summaryRow[8], 'Tổng điểm: 24/30 (80.0%)', 'Dòng tổng kết đầu mỗi bài phải đúng điểm/%.');
      const critRow = findRowTexts(sheet, 3);
      assertEqual(critRow[3], 'CHẤT LƯỢNG SẢN PHẨM', 'Cột Hạng Mục Lớn phải đúng');
      assertEqual(critRow[4], 'Chất lượng cảm quan', 'Cột Hạng Mục Con phải đúng');
      assertEqual(critRow[5], 'Bao bì không nguyên vẹn', 'Cột Tiêu Chí phải đúng');
      assertEqual(critRow[6], 30, 'Điểm Tối Đa phải dùng trần hạng mục lớn (hạng mục con để trống trần riêng)');
      assertEqual(critRow[7], 6, 'Điểm Trừ Thực Tế phải đúng deductedPoints đã nộp');
      assertEqual(critRow[8], 'Rách bao bì 3 sản phẩm', 'Mô tả nội dung không phù hợp phải đúng');
      assertEqual(critRow[9], 'B', 'Mức độ rủi ro phải đúng');
      assertEqual(critRow[10], '20/09/2026', 'Thời hạn hoàn thành phải đúng');
      assertEqual(critRow[11], 'Đã nhắc nhở', 'Ghi chú phải đúng');
    });

    await run.run('export-report: admin (không cần checklistReportView riêng) vẫn xuất được', async () => {
      resetRecords();
      const t = seedQaTemplate();
      RECORDS.checklistSubmissions.push(submittedSubmission(t, { storeCode: 'Siêu thị A', submittedAt: '10:00:00 5/9/2026' }));
      const res = await apiXlsx('POST', '/api/checklist/export-report', { templateId: t.id }, ADMIN);
      assertEqual(res.status, 200, 'Admin phải xuất được không cần cờ checklistReportView riêng');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(process.exitCode || 0)).catch(err => { console.error(err); process.exit(1); });
