// server/tests/demo-checklist-photo-capture.js
//
// DEMO thật (chụp ảnh) cho câu hỏi người dùng (10/2026): "Checklist/VSATTP có cho chụp ảnh trực tiếp
// khi phát hiện lỗi không?" — minh họa đúng v28.25 (đã thêm capture="environment" vào 2 ô ảnh minh
// chứng, xem module-checklist.js) VÀ xác nhận hành vi "không bắt buộc" (v9/2026, assertReadyToFinalize()
// ở lib/checklist.js) — chỉ gợi ý mềm, không chặn Nộp Bài.
//
// Dựng lại đúng khuôn tests/demo-orgchart-headcount.js (static server phục vụ public/ + Chromium thật,
// stub fetch, seed DB.* trực tiếp qua page.evaluate() rồi finishLogin() — KHÔNG cần route server nào).
//
// Chạy: node server/tests/demo-checklist-photo-capture.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const OUT_DIR = process.env.CHECKLIST_PHOTO_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'checklist-photo-capture');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'
  }[ext] || 'application/octet-stream';
}
function startStaticServer(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const filePath = path.join(PUBLIC_DIR, urlPath);
      if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
        res.writeHead(200, { 'Content-Type': contentType(filePath) });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// ===== Mẫu Checklist Thường (QA) — 1 câu đã bị đánh giá "Không đạt" (chưa đính ảnh) =====
const QA_TEMPLATE = {
  id: 1, templateName: 'Checklist Vệ Sinh Khu Bán Hàng', templateKind: 'QA', passThreshold: 80,
  questions: [{
    id: 10, text: 'Khu vực trưng bày có sạch sẽ, không có rác/bụi bẩn không?', type: 'SINGLE_CHOICE',
    isRequired: true, displayOrder: 0, maxScore: 10, showIfOptionId: null,
    options: [
      { id: 101, text: 'Đạt — sạch sẽ', isPassing: true, isCriticalFail: false, scoreValue: 10 },
      { id: 102, text: 'Không đạt — có rác/bụi bẩn', isPassing: false, isCriticalFail: false, scoreValue: 0 }
    ]
  }]
};
const QA_SUBMISSION = {
  id: 1, templateId: 1, storeCode: 'Siêu Thị Quang Trung', status: 'IN_PROGRESS',
  answers: [{ questionId: 10, optionIds: [102], note: '', deadline: '', attachments: [] }]
};

// ===== Mẫu VSATTP (DEDUCTION, "Trừ điểm theo hạng mục") — 1 tiêu chí vừa bị trừ điểm =====
const VSATTP_TEMPLATE = {
  id: 2, templateName: 'Đánh Giá VSATTP', templateKind: 'DEDUCTION', passThreshold: 80,
  categories: [{
    name: 'Vệ sinh khu chế biến', maxDeduction: 10,
    subItems: [{
      name: '1.1 Khu vực chế biến', maxDeduction: null,
      criteria: [{ id: 201, description: 'Sàn nhà khu chế biến có đọng nước/rác thải không?', ruleText: 'Trừ 2 điểm/lần vi phạm', perInstanceValue: 2 }]
    }]
  }]
};
const VSATTP_SUBMISSION = {
  id: 2, templateId: 2, storeCode: 'Siêu Thị Quang Trung', status: 'IN_PROGRESS',
  deductions: [{ criteriaId: 201, deductedPoints: 2, description: 'Sàn ướt, có vũng nước đọng gần khu sơ chế', riskLevel: 'B', deadline: '', note: '', attachments: [] }]
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 9600 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1200, height: 900 });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(({ qaTemplate, qaSubmission, vsattpTemplate, vsattpSubmission }) => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => '';
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ([]) });

    Object.assign(DB, {
      depts: [], stores: [{ code: 'Siêu Thị Quang Trung', name: 'Siêu Thị Quang Trung' }], cats: [],
      deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], positionTypes: [],
      users: [{ id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }],
      workflows: [], quickApplyConfigs: [], deptWorkflows: {},
      docs: [], submissions: [], submissionApprovalGroups: [], submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {},
      contracts: [], contractApprovalGroups: [], contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
      meetings: [], meetingRooms: [], meetingMinutes: [], meetingAttendeeTemplates: [],
      carDeptWorkflows: {}, carTypes: [], carPurposes: [], carVehicleTypes: [], carTaxiCompanies: [], carRegs: [],
      officeReqs: [], officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {},
      tasks: [], internalPosts: [], internalNewsCategories: [], internalShareCategories: [],
      trainingCategories: [], trainingDocuments: [], trainingClasses: [], trainingRegistrations: [],
      careerPaths: [], careerPathConfirmations: [], trainingTests: [], trainingTestSubmissions: [],
      trainingCourses: [], trainingPlans: [], onboardingPaths: [], onboardingProgress: [],
      recruitmentJobs: [], recruitmentReferrals: [], hrFeedback: [], sensitiveKeywords: [],
      paymentRequests: [], paymentDeptWorkflows: {}, formTemplates: {}, permGroups: [],
      vppExcludeGroups: [], vppExcludedJobTitles: [], workflowParticipatingDepts: [], workflowParticipatingPositions: [],
      pwaShortcutModules: [], itPriceMasterLists: [], itPriceDeptWorkflows: {}, itPriceTierWorkflows: {},
      uploadFileTypeConfig: {}, uploadSizeLimitConfig: {}, emailConfig: {}, systemLogs: [], externalApiKeys: [],
      vppRegistrations: [], vppDeptWorkflows: {}, vppPeriods: [], itPriceApprovals: [], itServiceRenewals: [], itSupportTickets: [],
      budgetEntries: [], budgetDeptWorkflows: {}, budgetTemplates: [], budgetPeriods: [],
      reportPeriods: [], reportEntries: [], licenses: [], licenseTypes: [],
      operationOrders: [], operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {},
      operationStoreOpenings: [], operationStoreOpenDeptWorkflows: {},
      operationRepairs: [], operationRepairDeptWorkflows: {},
      operationWorkItems: [], operationExecutionPeriods: [], orgChartManagerOverrides: {},
      uniformCatalog: [], itTicketCategories: [], orgChartVersions: [],
      checklistTemplates: [qaTemplate, vsattpTemplate],
      checklistSubmissions: [qaSubmission, vsattpSubmission],
      _versions: {}
    });

    finishLogin(DB.users[0]);
  }, { qaTemplate: QA_TEMPLATE, qaSubmission: QA_SUBMISSION, vsattpTemplate: VSATTP_TEMPLATE, vsattpSubmission: VSATTP_SUBMISSION });

  await page.evaluate(() => switchTab('checklist'));
  await page.waitForTimeout(300);

  // ===== Ảnh 1: Checklist Thường — câu "Không đạt" hiện gợi ý mềm + ô ảnh minh chứng (mở camera) =====
  await page.evaluate(() => openChecklistSubmissionForm(1));
  await page.waitForSelector('#checklistSubmissionFormWrap:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '1-checklist-thuong-anh-minh-chung.png'), fullPage: true });
  console.log('Đã chụp: 1-checklist-thuong-anh-minh-chung.png');

  // Xác nhận thuộc tính capture="environment" thật có trên input (không chỉ suy luận từ ảnh chụp).
  const qaCaptureAttr = await page.evaluate(() => document.querySelector('#checklistSubmissionFormWrap input[type=file]')?.getAttribute('capture'));
  console.log('Thuộc tính capture của input ảnh (Checklist Thường):', qaCaptureAttr);

  await page.evaluate(() => closeChecklistSubmissionForm());
  await page.waitForTimeout(100);

  // ===== Ảnh 2: VSATTP (Trừ điểm theo hạng mục) — tiêu chí bị trừ điểm + ô ảnh minh chứng (mở camera) =====
  await page.evaluate(() => openChecklistSubmissionForm(2));
  await page.waitForSelector('#checklistSubmissionFormWrap:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '2-vsattp-anh-minh-chung.png'), fullPage: true });
  console.log('Đã chụp: 2-vsattp-anh-minh-chung.png');

  const vsattpCaptureAttr = await page.evaluate(() => document.querySelector('#checklistSubmissionFormWrap input[type=file]')?.getAttribute('capture'));
  console.log('Thuộc tính capture của input ảnh (VSATTP):', vsattpCaptureAttr);

  console.log('\nLỗi JS (pageerror) phát sinh:', pageErrors.length ? pageErrors.join(' | ') : '(không có)');
  console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);

  await browser.close();
  server.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
