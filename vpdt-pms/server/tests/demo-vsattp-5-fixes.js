// server/tests/demo-vsattp-5-fixes.js
//
// DEMO thật (chụp ảnh) cho 5 thay đổi đề xuất ở form VSATTP ("Trừ điểm theo hạng mục") theo yêu cầu
// người dùng (11/2026, kèm 2 ảnh chụp màn hình thực tế): (1) nút xoá từng ảnh + xoá hết ảnh minh chứng;
// (2) "Ghi chú" đổi thành textarea xuống dòng được; (3) bỏ hẳn "Mức độ rủi ro"; (4) đổi nhãn "Ghi chú"
// -> "Kiến nghị"; (5) đổi "tham khảo X điểm/lần" -> "quy định X điểm/lần". Đây là bản DEMO — code đang
// nằm trên branch riêng (checklist-vsattp-5-fixes-demo), CHƯA merge main, chỉ để người dùng xem trước
// khi xác nhận phương án.
//
// Dựng lại đúng khuôn tests/demo-checklist-photo-capture.js (static server phục vụ public/ + Chromium
// thật, stub fetch, seed DB.* trực tiếp qua page.evaluate() rồi finishLogin()).
//
// Chạy: node server/tests/demo-vsattp-5-fixes.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const OUT_DIR = process.env.VSATTP_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'vsattp-5-fixes');
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

// Mẫu VSATTP (DEDUCTION) — 1 tiêu chí đã bị trừ điểm, có 2 ảnh minh chứng đính kèm sẵn (để demo nút
// xoá từng ảnh + xoá hết), và dòng "Kiến nghị" chứa văn bản DÀI nhiều câu để demo khả năng xuống dòng.
const VSATTP_TEMPLATE = {
  id: 2, templateName: 'Đánh Giá VSATTP', templateKind: 'DEDUCTION', passThreshold: 80,
  categories: [{
    name: 'Vệ sinh khu chế biến', maxDeduction: 10,
    subItems: [{
      name: '1.1 Khu vực chế biến', maxDeduction: null,
      criteria: [{ id: 201, description: 'Sản phẩm bày bán không đúng tiêu chuẩn VSATTP', ruleText: 'Cho 1 mã SP không phù hợp', perInstanceValue: 2 }]
    }]
  }]
};
const VSATTP_SUBMISSION = {
  id: 2, templateId: 2, storeCode: 'Siêu Thị Quang Trung', status: 'IN_PROGRESS',
  deductions: [{
    criteriaId: 201, deductedPoints: 2, description: 'Sàn ướt, có vũng nước đọng gần khu sơ chế. Phát hiện lúc 8h30 sáng, khu vực gần bồn rửa rau củ, có nguy cơ trơn trượt cho nhân viên qua lại.', riskLevel: 'B', deadline: '',
    note: 'Yêu cầu bộ phận vệ sinh lau khô sàn khu sơ chế ngay trong ca làm việc. Đề nghị siêu thị bổ sung biển cảnh báo "Sàn trơn ướt" và kiểm tra lại vào cuối mỗi ca để tránh tái diễn.',
    attachments: [
      { fileUrl: '/uploads/demo-vsattp-anh-1.jpg', fileName: 'san-uot-1.jpg', fileType: 'image/jpeg' },
      { fileUrl: '/uploads/demo-vsattp-anh-2.jpg', fileName: 'san-uot-2.jpg', fileType: 'image/jpeg' }
    ]
  }]
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 9600 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 900, height: 900 });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(({ vsattpTemplate, vsattpSubmission }) => {
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
      checklistTemplates: [vsattpTemplate],
      checklistSubmissions: [vsattpSubmission],
      _versions: {}
    });

    finishLogin(DB.users[0]);
  }, { vsattpTemplate: VSATTP_TEMPLATE, vsattpSubmission: VSATTP_SUBMISSION });

  await page.evaluate(() => switchTab('checklist'));
  await page.waitForTimeout(300);

  await page.evaluate(() => openChecklistSubmissionForm(2));
  await page.waitForSelector('#checklistSubmissionFormWrap:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, 'sau-khi-sua-vsattp.png'), fullPage: true });
  console.log('Đã chụp: sau-khi-sua-vsattp.png');

  // Xác nhận thật qua DOM (không chỉ suy luận từ ảnh chụp):
  const checks = await page.evaluate(() => {
    const wrap = document.getElementById('checklistSubmissionFormWrap');
    return {
      coRiskLevelSelect: !!wrap.querySelector('select[data-arg1="riskLevel"]'),
      ruleTextLine: wrap.textContent.match(/Cho 1 mã SP không phù hợp[^\n]*/)?.[0]?.trim(),
      soAnhDinhKem: wrap.querySelectorAll('[data-op="removeChecklistAnswerAttachment"]').length,
      coNutXoaHet: !!wrap.querySelector('[data-op="removeAllChecklistAnswerAttachments"]'),
      ghiChuLaTextarea: !!wrap.querySelector('textarea[data-arg1="note"]'),
      placeholderKienNghi: wrap.querySelector('textarea[data-arg1="note"]')?.getAttribute('placeholder')
    };
  });
  console.log('Kiểm tra DOM thật:', JSON.stringify(checks, null, 2));

  console.log('\nLỗi JS (pageerror) phát sinh:', pageErrors.length ? pageErrors.join(' | ') : '(không có)');
  console.log(`\nẢnh demo đã lưu tại: ${OUT_DIR}`);

  await browser.close();
  server.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
