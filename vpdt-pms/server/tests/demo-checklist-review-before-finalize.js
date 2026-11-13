// server/tests/demo-checklist-review-before-finalize.js
//
// DEMO (PREVIEW, CHƯA MERGE — gửi người dùng xác nhận trước khi triển khai chính thức) cho tính năng
// MỚI (11/2026, theo yêu cầu người dùng): "trước khi ấn kết thúc thì có nút cho phép người thực hiện
// checklist review lại từ trên xuống dưới tất cả những checklist họ làm và có thể sửa trong lúc review...
// ảnh chụp cũng cho phép chụp lại ảnh nếu cần thiết, hoặc browse ảnh trong máy điện thoại cũng được".
//
// Minh hoạ cả 2 loại mẫu checklist đang có trong hệ thống (ĐỀU dùng chung 1 cơ chế Review, không tách
// riêng cho ATVSTP — xem renderChecklistReviewBanner()/renderChecklistPhotoInput()/
// renderChecklistSubmissionFooterButtons() ở module-checklist.js):
//   1. "Checklist Thường" (QA, câu hỏi/lựa chọn) — 1 câu "Không đạt" chưa đính ảnh, 1 câu bắt buộc CHƯA
//      trả lời (để demo banner cảnh báo "còn câu bắt buộc chưa trả lời" trong Review).
//   2. "Đánh Giá VSATTP" (DEDUCTION, trừ điểm theo hạng mục) — 1 tiêu chí đã bị trừ điểm.
//
// Dựng lại đúng khuôn tests/demo-checklist-photo-capture.js.
//
// Chạy: node server/tests/demo-checklist-review-before-finalize.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const OUT_DIR = process.env.CHECKLIST_REVIEW_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'checklist-review-before-finalize');
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

// ===== Mẫu Checklist Thường (QA) — 2 câu: 1 câu "Không đạt" chưa đính ảnh, 1 câu bắt buộc CHƯA trả lời =====
const QA_TEMPLATE = {
  id: 1, templateName: 'Checklist An Toàn Thực Phẩm — Khu Chế Biến', templateKind: 'QA', passThreshold: 80,
  questions: [
    {
      id: 10, text: 'Khu vực chế biến có sạch sẽ, không đọng nước/rác thải không?', type: 'SINGLE_CHOICE',
      isRequired: true, displayOrder: 0, maxScore: 10, showIfOptionId: null,
      options: [
        { id: 101, text: 'Đạt — sạch sẽ', isPassing: true, isCriticalFail: false, scoreValue: 10 },
        { id: 102, text: 'Không đạt — có đọng nước/rác thải', isPassing: false, isCriticalFail: false, scoreValue: 0 }
      ]
    },
    {
      id: 11, text: 'Nhân viên chế biến có đeo găng tay/khẩu trang đúng quy định không?', type: 'SINGLE_CHOICE',
      isRequired: true, displayOrder: 1, maxScore: 10, showIfOptionId: null,
      options: [
        { id: 111, text: 'Đạt', isPassing: true, isCriticalFail: false, scoreValue: 10 },
        { id: 112, text: 'Không đạt', isPassing: false, isCriticalFail: false, scoreValue: 0 }
      ]
    }
  ]
};
const QA_SUBMISSION = {
  id: 1, templateId: 1, storeCode: 'Siêu Thị Quang Trung', status: 'IN_PROGRESS',
  // Câu 10: đã chọn "Không đạt" nhưng CHƯA đính ảnh minh chứng (demo gợi ý hổ phách).
  // Câu 11: CHƯA trả lời gì (demo banner "còn câu bắt buộc chưa trả lời" khi vào Review).
  answers: [{ questionId: 10, optionIds: [102], note: 'Sàn ướt gần khu sơ chế cá, cần lau khô ngay', deadline: '', attachments: [] }]
};

// ===== Mẫu VSATTP (DEDUCTION) — 1 tiêu chí đã bị trừ điểm =====
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
  const PORT = 9700 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 420, height: 900 }); // mô phỏng màn hình điện thoại — đúng bối cảnh "làm checklist ngoài thực địa"

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

  // ===== 1) Checklist Thường — màn làm bài BÌNH THƯỜNG (chưa vào Review) =====
  await page.evaluate(() => openChecklistSubmissionForm(1));
  await page.waitForSelector('#checklistSubmissionFormWrap:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '1-lam-bai-binh-thuong.png'), fullPage: true });
  console.log('📸 1-lam-bai-binh-thuong.png — màn làm bài, có nút MỚI "📋 Xem Lại Toàn Bộ Trước Khi Nộp"');

  // Xác nhận nút Review mới có mặt + capture="environment" vẫn giữ nguyên lúc làm bài bình thường.
  const beforeReview = await page.evaluate(() => ({
    hasReviewBtn: !!document.querySelector('[data-op="enterChecklistReviewMode"]'),
    captureAttr: document.querySelector('#checklistSubmissionFormWrap input[type=file]')?.getAttribute('capture')
  }));
  console.log('[Trước Review]', beforeReview);

  // ===== 2) Bấm "📋 Xem Lại Toàn Bộ Trước Khi Nộp" — vào màn Review =====
  await page.click('[data-op="enterChecklistReviewMode"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '2-man-review-co-canh-bao.png'), fullPage: true });
  console.log('📸 2-man-review-co-canh-bao.png — banner Review hiện CẢNH BÁO còn 1 câu bắt buộc chưa trả lời, câu đó viền đỏ');

  const inReview = await page.evaluate(() => ({
    bannerText: document.querySelector('#checklistSubmissionFormWrap .bg-indigo-50')?.textContent.trim(),
    captureAttr: document.querySelector('#checklistSubmissionFormWrap input[type=file]')?.getAttribute('capture'),
    hasBackBtn: !!document.querySelector('[data-op="exitChecklistReviewMode"]'),
    confirmBtnText: document.querySelector('[data-op="finalizeChecklistSubmission"]')?.textContent.trim()
  }));
  console.log('[Trong Review]', inReview);

  // ===== 3) SỬA ngay trong lúc Review: trả lời nốt câu còn thiếu + đổi đáp án câu 1 sang "Đạt" =====
  await page.click('[data-op-change="toggleChecklistAnswerOption"][data-arg0="11"][data-arg1="111"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT_DIR, '3-sua-xong-trong-luc-review.png'), fullPage: true });
  console.log('📸 3-sua-xong-trong-luc-review.png — vừa trả lời nốt câu còn thiếu NGAY TRONG REVIEW, banner tự chuyển sang "Đã trả lời đủ"');

  const afterFix = await page.evaluate(() => document.querySelector('#checklistSubmissionFormWrap .bg-indigo-50')?.textContent.trim());
  console.log('[Banner sau khi sửa]', afterFix);

  await page.evaluate(() => closeChecklistSubmissionForm());
  await page.waitForTimeout(100);

  // ===== 4) VSATTP (DEDUCTION) — vào Review để xác nhận cơ chế dùng CHUNG cho cả 2 loại mẫu =====
  await page.evaluate(() => openChecklistSubmissionForm(2));
  await page.waitForSelector('#checklistSubmissionFormWrap:not(.hidden)', { timeout: 5000 });
  await page.click('[data-op="enterChecklistReviewMode"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '4-vsattp-man-review.png'), fullPage: true });
  console.log('📸 4-vsattp-man-review.png — VSATTP (trừ điểm theo hạng mục) cũng có Review, ảnh minh chứng bỏ capture (chụp mới HOẶC chọn ảnh có sẵn)');

  const vsattpReview = await page.evaluate(() => ({
    captureAttr: document.querySelector('#checklistSubmissionFormWrap input[type=file]')?.getAttribute('capture'),
    hasBackBtn: !!document.querySelector('[data-op="exitChecklistReviewMode"]')
  }));
  console.log('[VSATTP Review]', vsattpReview);

  console.log('\nLỗi JS (pageerror) phát sinh:', pageErrors.length ? pageErrors.join(' | ') : '(không có)');
  console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);

  await browser.close();
  server.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
