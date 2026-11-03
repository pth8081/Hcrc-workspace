// server/tests/demo-checklist-report-date-filter-vn-tz.js
//
// Demo XÁC NHẬN cho 2 lỗi người dùng báo (11/2026, ảnh chụp "Xuất Theo Mẫu Gốc" + Excel "Siêu thị số 275
// Nguyễn Trãi"): (1) lọc "từ ngày 3/11 đến 3/11" báo "Không có bài đã nộp nào khớp bộ lọc" dù siêu thị ĐÃ
// nộp đúng ngày đó; (2) cột "ID Lượt Nộp" hiện ký hiệu khoa học "1.79367E+12". Dựng lại ĐÚNG kịch bản: 1
// siêu thị nộp checklist lúc "09:29:48 3/11/2026" — gọi THẲNG route /api/checklist/export-report thật
// (process.env.TZ='Asia/Ho_Chi_Minh', mirror kỹ thuật test-checklist-report-date-filter-vn-tz.js), lưu lại
// file .xlsx thật trả về để xem bằng mắt.
//
// Chạy: node server/tests/demo-checklist-report-date-filter-vn-tz.js
'use strict';
process.env.TZ = 'Asia/Ho_Chi_Minh';
const fs = require('fs');
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

const REPORTER = { username: 'bc1', name: 'Người Xem Báo Cáo', dept: 'Phòng Vận Hành', posType: 'HO', perms: { checklistReportView: true }, active: true };
let USERS = [REPORTER];
let RECORDS = { checklistTemplates: [], checklistSubmissions: [] };
let PORT = 0;
let CURRENT_USERNAME = REPORTER.username;

stubModule('lib/appData', {
  getAppDataValue: async () => null, getAllAppData: async () => ({}), withLockedAppDataValue: async (key, fn) => fn(null),
  getAppDataValueCached: async () => []
});
stubModule('lib/recordStore', {
  getAllForCollection: async (collection) => RECORDS[collection] || [],
  insertRecord: async (collection, record) => { RECORDS[collection] = RECORDS[collection] || []; RECORDS[collection].push(record); return record; },
  withLockedRecordForCollection: async () => { throw new Error('not used in demo'); },
  withAppLock: async (key, fn) => fn(),
  deleteRecordForCollection: async () => true
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
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

(async () => {
  const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'checklist-report-date-filter-vn-tz');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const t = (() => {
    const core = checklist.assertTemplateCoreFields({ templateCode: 'CL_QA', templateName: 'Checklist Hàng Ngày GĐST/CHT (Tự Đánh Giá)', templateType: 'STORE_SELF' });
    const questions = checklist.validateChecklistQuestions([
      { text: 'Hình ảnh (Biển hiệu siêu thị, nguyên vẹn không rách...)', isRequired: true, category: '',
        options: [{ text: 'Đạt', scoreValue: 1, isPassing: true }, { text: 'Không đạt', scoreValue: 0, isPassing: false }] }
    ], 'SCORED');
    const tpl = Object.assign({ id: 1, status: 'ACTIVE', version: 1, clonedFromTemplateId: null, activatedAt: checklist.nowVN(), creator: 'admin', creatorName: 'Quản Trị Viên' }, core, { questions });
    RECORDS.checklistTemplates.push(tpl);
    return tpl;
  })();
  const q = t.questions[0];
  RECORDS.checklistSubmissions.push({
    id: 1793670000000, templateId: t.id, templateCode: t.templateCode, templateName: t.templateName,
    templateType: t.templateType, templateVersion: t.version,
    storeCode: 'Siêu thị số 275 Nguyễn Trãi', submittedByUsername: 'nv1', submittedByName: 'Nguyễn Thị Thùy Chi',
    status: 'SUBMITTED', answers: [{ questionId: q.id, optionIds: [q.options[0].id], note: '' }], deductions: [],
    totalScore: 1, maxPossibleScore: 1, scorePercent: 100, hasCriticalFail: false, isPassed: true,
    startedAt: '09:29:48 3/11/2026', submittedAt: '09:29:48 3/11/2026',
    storeResponseText: null, storeRespondedAt: null, storeRespondedByUsername: null, storeRespondedByName: null
  });

  const server = await startApp();
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/checklist/export-report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: t.id, fromDate: '2026-11-03', toDate: '2026-11-03' })
    });
    console.log('Lọc "từ ngày 3/11 đến 3/11" (CÙNG 1 ngày với bài đã nộp) -> HTTP status:', res.status);
    if (res.status !== 200) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`❌ VẪN LỖI: ${JSON.stringify(body)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const outFile = path.join(OUT_DIR, 'bao-cao-checklist-3-11-den-3-11.xlsx');
    fs.writeFileSync(outFile, buf);
    console.log('✅ Xuất thành công, đã lưu:', outFile);

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheet = wb.getWorksheet('Dữ Liệu Chi Tiết (Gộp)');
    const idCell = sheet.getRow(2).getCell(1);
    console.log('Cột "ID Lượt Nộp", dòng 2 -> kiểu dữ liệu:', typeof idCell.value, '| giá trị:', idCell.value);
    if (typeof idCell.value !== 'string') throw new Error('❌ Cột ID vẫn là số -> Excel sẽ tự hiện ký hiệu khoa học!');
    console.log('\n✅ XÁC NHẬN: cả 2 lỗi (lọc ngày 3/11-3/11 báo rỗng + cột ID khoa học) đã được vá, đường đi THẬT (production route).');
  } finally {
    server.close();
  }
})();
