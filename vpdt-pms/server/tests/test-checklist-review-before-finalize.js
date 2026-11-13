// server/tests/test-checklist-review-before-finalize.js
//
// Tính năng MỚI (11/2026, theo yêu cầu người dùng): "trước khi ấn kết thúc thì có nút cho phép người
// thực hiện checklist review lại từ trên xuống dưới tất cả những checklist họ làm và có thể sửa trong
// lúc review... ảnh chụp cũng cho phép chụp lại ảnh nếu cần thiết, hoặc browse ảnh trong máy điện thoại
// cũng được" — xem renderChecklistReviewBanner()/renderChecklistPhotoInput()/
// renderChecklistSubmissionFooterButtons() (module-vanhanh... à không, module-checklist.js).
//
// Kiểm cả 2 loại mẫu (QA và DEDUCTION) dùng CHUNG 1 cơ chế Review, không lặp code 2 nơi:
//   1. Nút "📋 Xem Lại Toàn Bộ Trước Khi Nộp" có mặt ở màn làm bài bình thường, KHÔNG đổi gì hành vi cũ
//      (capture="environment" vẫn mở thẳng camera, nút "Nộp Bài" vẫn nộp trực tiếp được như trước).
//   2. Vào Review: banner cảnh báo đúng số câu bắt buộc chưa trả lời (QA), câu đó viền đỏ; ảnh minh
//      chứng BỎ capture (cho cả chụp lại lẫn browse ảnh có sẵn).
//   3. SỬA ngay trong Review (chọn đáp án/đổi ảnh) — state cập nhật tại chỗ, banner tự tính lại.
//   4. "⬅️ Quay Lại Chỉnh Sửa" thoát Review — khôi phục ĐÚNG bộ nút + capture="environment" như ban đầu.
//   5. Mở bài làm MỚI (đóng rồi mở lại) — Review mode LUÔN reset về false, không rò rỉ sang bài khác.
//   6. "✅ Xác Nhận Nộp Bài" trong Review gọi ĐÚNG endpoint finalize như nút "Nộp Bài" bình thường (không
//      đổi logic chấm điểm/lưu dữ liệu phía server — chỉ thêm bước UI).
//   7. DEDUCTION (VSATTP) — banner đơn giản hơn (không có khái niệm "câu bắt buộc"), vẫn bỏ capture đúng.
//
// Dựng lại đúng khuôn tests/demo-checklist-photo-capture.js (static server + Chromium thật, stub fetch).
//
// Chạy: node server/tests/test-checklist-review-before-finalize.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

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

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

const QA_TEMPLATE = {
  id: 1, templateName: 'Checklist An Toàn Thực Phẩm', templateKind: 'QA', passThreshold: 80,
  questions: [
    {
      id: 10, text: 'Câu 1 (bắt buộc)', type: 'SINGLE_CHOICE', isRequired: true, displayOrder: 0, maxScore: 10, showIfOptionId: null,
      options: [{ id: 101, text: 'Đạt', isPassing: true, isCriticalFail: false, scoreValue: 10 }, { id: 102, text: 'Không đạt', isPassing: false, isCriticalFail: false, scoreValue: 0 }]
    },
    {
      id: 11, text: 'Câu 2 (bắt buộc)', type: 'SINGLE_CHOICE', isRequired: true, displayOrder: 1, maxScore: 10, showIfOptionId: null,
      options: [{ id: 111, text: 'Đạt', isPassing: true, isCriticalFail: false, scoreValue: 10 }, { id: 112, text: 'Không đạt', isPassing: false, isCriticalFail: false, scoreValue: 0 }]
    }
  ]
};
const QA_SUBMISSION = { id: 1, templateId: 1, storeCode: 'Siêu Thị A', status: 'IN_PROGRESS', answers: [] };

const VSATTP_TEMPLATE = {
  id: 2, templateName: 'Đánh Giá VSATTP', templateKind: 'DEDUCTION', passThreshold: 80,
  categories: [{ name: 'Vệ sinh', maxDeduction: 10, subItems: [{ name: '1.1', maxDeduction: null, criteria: [{ id: 201, description: 'Tiêu chí 1', ruleText: '', perInstanceValue: 2 }] }] }]
};
const VSATTP_SUBMISSION = { id: 2, templateId: 2, storeCode: 'Siêu Thị A', status: 'IN_PROGRESS', deductions: [] };

async function main() {
  const PORT = 9710 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(({ qaTemplate, qaSubmission, vsattpTemplate, vsattpSubmission }) => {
    window.__alerts = [];
    window.__finalizeCalls = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => '';
    window.fetch = async (url, opts) => {
      if (String(url).includes('/finalize')) window.__finalizeCalls.push({ url: String(url), body: opts && opts.body });
      return { ok: true, status: 200, json: async () => ({ item: (String(url).includes('submissions/1') ? qaSubmission : vsattpSubmission) }) };
    };

    Object.assign(DB, {
      depts: [], stores: [{ code: 'Siêu Thị A', name: 'Siêu Thị A' }], cats: [],
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
  await page.waitForTimeout(200);

  // ===== 1) Màn làm bài bình thường — có nút Review mới, capture="environment" vẫn giữ nguyên =====
  await page.evaluate(() => openChecklistSubmissionForm(1));
  await page.waitForSelector('#checklistSubmissionFormWrap:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(100);
  const normalState = await page.evaluate(() => ({
    hasReviewBtn: !!document.querySelector('[data-op="enterChecklistReviewMode"]'),
    hasDirectFinalizeBtn: !!document.querySelector('[data-op="finalizeChecklistSubmission"]'),
    hasBackBtn: !!document.querySelector('[data-op="exitChecklistReviewMode"]'),
    captureAttr: document.querySelector('#checklistSubmissionFormWrap input[type=file]')?.getAttribute('capture'),
    hasBanner: !!document.querySelector('#checklistSubmissionFormWrap .bg-indigo-50')
  }));
  record('Màn làm bài bình thường: có nút "Xem Lại Toàn Bộ Trước Khi Nộp" MỚI', normalState.hasReviewBtn);
  record('Màn làm bài bình thường: nút "Nộp Bài" trực tiếp VẪN CÒN (không ép phải qua Review)', normalState.hasDirectFinalizeBtn);
  record('Màn làm bài bình thường: KHÔNG có nút "Quay Lại Chỉnh Sửa" (chỉ hiện khi đang Review)', !normalState.hasBackBtn);
  record('Màn làm bài bình thường: ảnh minh chứng vẫn capture="environment" (mở thẳng camera, KHÔNG đổi hành vi cũ)', normalState.captureAttr === 'environment');
  record('Màn làm bài bình thường: KHÔNG có banner Review', !normalState.hasBanner);

  // ===== 2) Vào Review — banner cảnh báo đủ số câu bắt buộc chưa trả lời, câu đó viền đỏ, bỏ capture =====
  await page.click('[data-op="enterChecklistReviewMode"]');
  await page.waitForTimeout(100);
  const reviewState = await page.evaluate(() => ({
    bannerText: document.querySelector('#checklistSubmissionFormWrap .bg-indigo-50')?.textContent || '',
    missingHighlightCount: document.querySelectorAll('#checklistSubmissionFormWrap .border-red-400').length,
    captureAttr: document.querySelector('#checklistSubmissionFormWrap input[type=file]')?.getAttribute('capture'),
    hasBackBtn: !!document.querySelector('[data-op="exitChecklistReviewMode"]'),
    hasReviewEntryBtnStill: !!document.querySelector('[data-op="enterChecklistReviewMode"]'),
    confirmBtnText: document.querySelector('[data-op="finalizeChecklistSubmission"]')?.textContent.trim()
  }));
  record('Vào Review: banner cảnh báo đúng "Còn 2/2 câu bắt buộc chưa trả lời"', reviewState.bannerText.includes('Còn 2/2 câu bắt buộc chưa trả lời'), reviewState.bannerText);
  record('Vào Review: CẢ 2 câu bắt buộc chưa trả lời đều viền đỏ nổi bật', reviewState.missingHighlightCount === 2, `thực tế: ${reviewState.missingHighlightCount}`);
  record('Vào Review: ảnh minh chứng BỎ capture (cho chụp lại HOẶC browse ảnh có sẵn trong máy)', reviewState.captureAttr === null);
  record('Vào Review: có nút "⬅️ Quay Lại Chỉnh Sửa"', reviewState.hasBackBtn);
  record('Vào Review: KHÔNG còn nút "Xem Lại Toàn Bộ..." (đã ở trong Review rồi)', !reviewState.hasReviewEntryBtnStill);
  record('Vào Review: nút nộp bài đổi chữ thành "✅ Xác Nhận Nộp Bài"', reviewState.confirmBtnText === '✅ Xác Nhận Nộp Bài');

  // ===== 3) SỬA ngay trong Review — chọn đáp án câu 1, banner tự tính lại còn 1/2 =====
  await page.click('[data-op-change="toggleChecklistAnswerOption"][data-arg0="10"][data-arg1="101"]');
  await page.waitForTimeout(100);
  const afterOneFix = await page.evaluate(() => document.querySelector('#checklistSubmissionFormWrap .bg-indigo-50')?.textContent || '');
  record('Sửa 1 câu ngay trong Review: banner tự cập nhật còn "1/2 câu bắt buộc chưa trả lời"', afterOneFix.includes('Còn 1/2 câu bắt buộc chưa trả lời'), afterOneFix);

  await page.click('[data-op-change="toggleChecklistAnswerOption"][data-arg0="11"][data-arg1="111"]');
  await page.waitForTimeout(100);
  const afterBothFixed = await page.evaluate(() => document.querySelector('#checklistSubmissionFormWrap .bg-indigo-50')?.textContent || '');
  record('Sửa đủ cả 2 câu ngay trong Review: banner chuyển sang "Đã trả lời đủ 2/2"', afterBothFixed.includes('Đã trả lời đủ 2/2'), afterBothFixed);

  // ===== 4) "⬅️ Quay Lại Chỉnh Sửa" — khôi phục ĐÚNG bộ nút + capture ban đầu =====
  await page.click('[data-op="exitChecklistReviewMode"]');
  await page.waitForTimeout(100);
  const backToNormal = await page.evaluate(() => ({
    hasReviewBtn: !!document.querySelector('[data-op="enterChecklistReviewMode"]'),
    hasBackBtn: !!document.querySelector('[data-op="exitChecklistReviewMode"]'),
    captureAttr: document.querySelector('#checklistSubmissionFormWrap input[type=file]')?.getAttribute('capture'),
    hasBanner: !!document.querySelector('#checklistSubmissionFormWrap .bg-indigo-50')
  }));
  record('Quay Lại Chỉnh Sửa: trở về ĐÚNG màn làm bài bình thường (nút Review lại hiện, nút Back biến mất)', backToNormal.hasReviewBtn && !backToNormal.hasBackBtn);
  record('Quay Lại Chỉnh Sửa: ảnh minh chứng khôi phục capture="environment" như ban đầu', backToNormal.captureAttr === 'environment');
  record('Quay Lại Chỉnh Sửa: banner Review biến mất', !backToNormal.hasBanner);

  // ===== 5) Đóng rồi mở bài khác — Review mode PHẢI reset về false, không rò rỉ sang bài sau =====
  await page.evaluate(() => { enterChecklistReviewMode(); closeChecklistSubmissionForm(); });
  await page.evaluate(() => openChecklistSubmissionForm(1));
  await page.waitForSelector('#checklistSubmissionFormWrap:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(100);
  const reopenedState = await page.evaluate(() => ({
    hasReviewBtn: !!document.querySelector('[data-op="enterChecklistReviewMode"]'),
    hasBanner: !!document.querySelector('#checklistSubmissionFormWrap .bg-indigo-50')
  }));
  record('LỖI ĐÃ VÁ (an toàn): đóng bài lúc ĐANG Review rồi mở bài mới -> Review KHÔNG rò rỉ sang bài sau (tự reset về màn làm bài bình thường)', reopenedState.hasReviewBtn && !reopenedState.hasBanner);

  // ===== 6) "✅ Xác Nhận Nộp Bài" trong Review gọi ĐÚNG endpoint finalize (không đổi logic server) =====
  await page.click('[data-op="enterChecklistReviewMode"]');
  await page.waitForTimeout(100);
  await page.click('[data-op="finalizeChecklistSubmission"]');
  await page.waitForTimeout(150);
  const finalizeCalls = await page.evaluate(() => window.__finalizeCalls || []);
  record('"✅ Xác Nhận Nộp Bài" trong Review gọi ĐÚNG 1 lần POST .../submissions/1/finalize', finalizeCalls.length === 1 && finalizeCalls[0].url.includes('/submissions/1/finalize'), JSON.stringify(finalizeCalls));

  await page.evaluate(() => closeChecklistSubmissionForm());
  await page.waitForTimeout(100);

  // ===== 7) DEDUCTION (VSATTP) — cùng cơ chế Review, banner đơn giản hơn (không có "câu bắt buộc") =====
  await page.evaluate(() => openChecklistSubmissionForm(2));
  await page.waitForSelector('#checklistSubmissionFormWrap:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(100);
  const vsattpNormalCapture = await page.evaluate(() => document.querySelector('#checklistSubmissionFormWrap input[type=file]')?.getAttribute('capture'));
  record('VSATTP màn làm bài bình thường: ảnh vẫn capture="environment"', vsattpNormalCapture === 'environment');

  await page.click('[data-op="enterChecklistReviewMode"]');
  await page.waitForTimeout(100);
  const vsattpReview = await page.evaluate(() => ({
    hasBanner: !!document.querySelector('#checklistSubmissionFormWrap .bg-indigo-50'),
    bannerText: document.querySelector('#checklistSubmissionFormWrap .bg-indigo-50')?.textContent || '',
    captureAttr: document.querySelector('#checklistSubmissionFormWrap input[type=file]')?.getAttribute('capture'),
    hasBackBtn: !!document.querySelector('[data-op="exitChecklistReviewMode"]')
  }));
  record('VSATTP vào Review: có banner giới thiệu chung (KHÔNG có dòng "câu bắt buộc" — DEDUCTION không có khái niệm này)', vsattpReview.hasBanner && !vsattpReview.bannerText.includes('câu bắt buộc'), vsattpReview.bannerText);
  record('VSATTP vào Review: ảnh minh chứng cũng BỎ capture', vsattpReview.captureAttr === null);
  record('VSATTP vào Review: có nút "Quay Lại Chỉnh Sửa"', vsattpReview.hasBackBtn);

  record('Không có lỗi JS (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();

  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log(`\n${passed}/${total} scenarios passed.`);
  if (passed !== total) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
