// server/tests/test-job-title-grade-default.js
//
// Test cho tính năng MỚI "Chức Danh ↔ Cấp Bậc (Gợi Ý Mặc Định)" (10/2026, theo yêu cầu người dùng: "xây
// 1 danh mục mà chức danh gắn với cấp bậc luôn để khi chọn cấp bậc đó tự nhảy ra cấp bậc", xác nhận
// "Theo hướng gợi ý mặc định, sửa tay được"). Xác nhận:
//   A) Admin CRUD catalog DB.jobTitleGradeDefaults (Hệ Thống → Quản Lý Danh Mục): thêm, chặn trùng chức
//      danh, sửa (đổi cấp bậc), xoá — qua đúng UI thật (data-op dispatch), không gọi thẳng hàm JS.
//   B) module-orgchart.js: chọn/gõ xong 1 Chức Danh có cấu hình mặc định -> ô "Cấp Bậc" tự điền — CHỈ khi
//      đang RỖNG, KHÔNG đè giá trị đã có sẵn (đúng yêu cầu "sửa tay được" — gợi ý, không ép buộc).
//
// Dựng lại đúng khuôn tests/demo-orgchart-headcount.js (static server phục vụ public/ + Chromium thật,
// stub thẳng window.fetch — KHÔNG cần route server nào).
//
// Chạy: node server/tests/test-job-title-grade-default.js
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

const VERSION = {
  id: 1, versionName: 'Cơ cấu tổ chức 2026', status: 'APPLIED',
  nodes: [
    { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'CÔNG TY HCRC', positionKey: null, displayOrder: 0 },
    { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', departmentRef: 'Phòng Kinh Doanh', positionKey: null, displayOrder: 0 },
    { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Trưởng Phòng Kinh Doanh', jobGrade: 'L5', requiresDept: true, positionKey: 'PK-TPKD', displayOrder: 0 }
  ]
};

async function main() {
  const PORT = 9400 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 1200 });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(({ version }) => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => '';

    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u === '/api/org-chart/versions' && (!opts || !opts.method || opts.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ versions: [{ id: version.id, versionName: version.versionName, status: version.status, createdBy: 'admin' }] }) };
      }
      if (u === `/api/org-chart/versions/${version.id}` && (!opts || !opts.method || opts.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ version }) };
      }
      if (/^\/api\/data\//.test(u) && opts && opts.method === 'POST') {
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: ['Phòng Kinh Doanh'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: ['Trưởng Phòng Kinh Doanh', 'Nhân Viên Kinh Doanh'], storeJobTitles: [{ label: 'Giám Đốc siêu thị' }], positionTypes: [],
      jobGrades: ['L1', 'L3', 'L5'], jobTitleGradeDefaults: [],
      users: [{ id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }],
      workflows: [], quickApplyConfigs: [], deptWorkflows: {}, deptGroups: [],
      docs: [], submissions: [], submissionApprovalGroups: [], submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {}, submissionTypes: [],
      contracts: [], contractApprovalGroups: [], contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {}, contractTypes: [],
      meetings: [], meetingRooms: [], meetingMinutes: [], meetingAttendeeTemplates: [], meetingDeptWorkflows: {},
      carDeptWorkflows: {}, carTypes: [], carPurposes: [], carVehicleTypes: [], carTaxiCompanies: [], carRegs: [], carEvaluationIssues: [],
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
      reportPeriods: [], reportEntries: [], licenses: [], licenseTypes: [], priceZones: [], itRenewalCategories: [],
      operationOrders: [], operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {},
      operationStoreOpenings: [], operationStoreOpenDeptWorkflows: {},
      operationRepairs: [], operationRepairDeptWorkflows: {},
      operationWorkItems: [], operationExecutionPeriods: [], orgChartManagerOverrides: {},
      uniformCatalog: [], itTicketCategories: [], resignationReasons: [], disciplinaryTypes: [],
      legalEntities: [], specialLaborStatuses: [], currentWorkStatusDetails: [], nationalIdIssuePlaces: [], educationDegrees: [],
      meetingRoomCatalog: [], submissionApprovalLevels: [], contractApprovalLevels: [],
      _versions: {}
    });

    finishLogin(DB.users[0]);
  }, { version: VERSION });

  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map((k) => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));

  // =====================================================================================
  // A) Admin CRUD — Hệ Thống → Quản Lý Danh Mục → "🔗 Chức Danh ↔ Cấp Bậc (Gợi Ý Mặc Định)"
  // =====================================================================================
  await page.evaluate(async () => { await switchTab('system'); setSystemSubTab('ADMIN'); setAdminSubTab('CATALOG'); });
  await page.waitForTimeout(150);
  // Panel nằm trong <details class="filter-box-details"> ĐÓNG mặc định (thu gọn, xem test-collapse-
  // catalog-accordion.js) -> phải mở ra trước khi fill/click được (phần tử "not visible" khi collapsed).
  await page.evaluate(() => { document.getElementById('txtJtgdJobTitle')?.closest('details')?.setAttribute('open', ''); });

  const emptyText = await page.locator('#jobTitleGradeDefaultList').innerText();
  record('A1. Bảng trống ban đầu hiện đúng thông báo "Chưa có cấu hình nào"', /Chưa có cấu hình/.test(emptyText), emptyText);

  // A2: thêm dòng "Trưởng Phòng Kinh Doanh" -> "L5"
  // Escape sau mỗi fill để đóng dropdown gợi ý sdd (xem core.js ~11637) — nó che nút Submit (Playwright
  // coi "intercepts pointer events") nếu còn mở, vì page.fill() không dispatch 1 click DOM thật để tự
  // đóng như thao tác tay (xem listener 'click' đóng dropdown ở core.js ~11646).
  await page.fill('#txtJtgdJobTitle', 'Trưởng Phòng Kinh Doanh — HO/Khối VP');
  await page.keyboard.press('Escape');
  await page.fill('#txtJtgdJobGrade', 'L5');
  await page.keyboard.press('Escape');
  await page.click('#btnJtgdSubmit');
  await page.waitForTimeout(100);
  let rules = await page.evaluate(() => DB.jobTitleGradeDefaults);
  record('A2. Thêm dòng qua UI -> DB có đúng 1 cấu hình', rules.length === 1 && rules[0].jobTitle === 'Trưởng Phòng Kinh Doanh' && rules[0].jobGrade === 'L5', JSON.stringify(rules));

  // A3: thêm trùng chức danh -> bị chặn (alert), KHÔNG tạo dòng thứ 2
  const alertsBefore = await page.evaluate(() => window.__alerts.length);
  await page.fill('#txtJtgdJobTitle', 'Trưởng Phòng Kinh Doanh — HO/Khối VP');
  await page.keyboard.press('Escape');
  await page.fill('#txtJtgdJobGrade', 'L3');
  await page.keyboard.press('Escape');
  await page.click('#btnJtgdSubmit');
  await page.waitForTimeout(100);
  const alertsAfter = await page.evaluate(() => window.__alerts.length);
  rules = await page.evaluate(() => DB.jobTitleGradeDefaults);
  record('A3. Thêm TRÙNG chức danh -> bị chặn (có alert cảnh báo), DB vẫn chỉ 1 dòng', alertsAfter > alertsBefore && rules.length === 1, JSON.stringify(rules));

  // A4: sửa dòng vừa thêm (đổi cấp bậc L5 -> L7)
  await page.click('button[data-op="editJobTitleGradeDefault"][data-arg0="Trưởng Phòng Kinh Doanh"]');
  await page.waitForTimeout(80);
  const prefillJobTitle = await page.inputValue('#txtJtgdJobTitle');
  const prefillJobGrade = await page.inputValue('#txtJtgdJobGrade');
  // Ô nhập hiện NHÃN có hậu tố nguồn (" — HO/Khối VP"), không phải giá trị thuần đã lưu trong DB — xem
  // chú thích đầy đủ ở editJobTitleGradeDefault() (module-admin.js).
  record('A4a. Bấm "Sửa" -> form prefill đúng dữ liệu dòng đó (nhãn có hậu tố nguồn)', prefillJobTitle === 'Trưởng Phòng Kinh Doanh — HO/Khối VP' && prefillJobGrade === 'L5', JSON.stringify({ prefillJobTitle, prefillJobGrade }));
  await page.fill('#txtJtgdJobGrade', 'L7');
  await page.keyboard.press('Escape');
  await page.click('#btnJtgdSubmit');
  await page.waitForTimeout(100);
  rules = await page.evaluate(() => DB.jobTitleGradeDefaults);
  record('A4b. Lưu sửa -> DB cập nhật đúng cấp bậc mới (L7), vẫn chỉ 1 dòng', rules.length === 1 && rules[0].jobGrade === 'L7', JSON.stringify(rules));

  // A5: thêm 1 dòng thứ 2 cho chức danh Siêu Thị (gõ-tìm hỗn hợp cả 2 danh mục)
  await page.fill('#txtJtgdJobTitle', 'Giám Đốc siêu thị — Siêu Thị');
  await page.keyboard.press('Escape');
  await page.fill('#txtJtgdJobGrade', 'L3');
  await page.keyboard.press('Escape');
  await page.click('#btnJtgdSubmit');
  await page.waitForTimeout(100);
  rules = await page.evaluate(() => DB.jobTitleGradeDefaults);
  record('A5. Thêm dòng thứ 2 (chức danh Siêu Thị) -> DB có đúng 2 cấu hình', rules.length === 2 && rules.some(r => r.jobTitle === 'Giám Đốc siêu thị' && r.jobGrade === 'L3'), JSON.stringify(rules));

  // A6: xoá dòng "Giám Đốc siêu thị" -> còn đúng 1 dòng
  await page.click('button[data-op="deleteJobTitleGradeDefault"][data-arg0="Giám Đốc siêu thị"]');
  await page.waitForTimeout(100);
  rules = await page.evaluate(() => DB.jobTitleGradeDefaults);
  record('A6. Xoá dòng qua UI -> DB chỉ còn đúng 1 dòng "Trưởng Phòng Kinh Doanh"', rules.length === 1 && rules[0].jobTitle === 'Trưởng Phòng Kinh Doanh', JSON.stringify(rules));

  // =====================================================================================
  // B) Auto-fill ở Cơ Cấu Tổ Chức — module-orgchart.js
  // =====================================================================================
  await page.evaluate(() => switchTab('orgChart'));
  await page.waitForTimeout(300);

  // B1: Thêm Node MỚI (jobGrade rỗng ban đầu) -> chọn Chức Danh có mặc định -> tự điền đúng
  await page.evaluate(() => openOrgChartAddNodeModal(2));
  await page.waitForSelector('#orgChartNodeModal:not(.hidden)', { timeout: 5000 });
  await page.evaluate(() => { document.getElementById('orgChartNodeTypeSelect').value = 'POSITION'; onOrgChartNodeTypeChange(); });
  await page.waitForTimeout(80);
  await page.fill('#orgChartNodeJobTitleInput', 'Trưởng Phòng Kinh Doanh');
  await page.locator('#orgChartNodeJobTitleInput').dispatchEvent('change');
  await page.waitForTimeout(80);
  let gradeVal = await page.inputValue('#orgChartNodeJobGradeInput');
  record('B1. Thêm node mới: gõ Chức Danh có cấu hình mặc định -> ô Cấp Bậc TỰ ĐIỀN đúng "L7"', gradeVal === 'L7', gradeVal);
  await page.evaluate(() => closeOrgChartNodeModal());

  // B2: Thêm Node MỚI khác, chọn Chức Danh KHÔNG có mặc định -> ô Cấp Bậc vẫn rỗng
  await page.evaluate(() => openOrgChartAddNodeModal(2));
  await page.waitForSelector('#orgChartNodeModal:not(.hidden)', { timeout: 5000 });
  await page.evaluate(() => { document.getElementById('orgChartNodeTypeSelect').value = 'POSITION'; onOrgChartNodeTypeChange(); });
  await page.waitForTimeout(80);
  await page.fill('#orgChartNodeJobTitleInput', 'Nhân Viên Kinh Doanh');
  await page.locator('#orgChartNodeJobTitleInput').dispatchEvent('change');
  await page.waitForTimeout(80);
  gradeVal = await page.inputValue('#orgChartNodeJobGradeInput');
  record('B2. Chức Danh KHÔNG có cấu hình mặc định -> ô Cấp Bậc vẫn RỖNG (không lỗi, không điền bậy)', gradeVal === '', gradeVal);
  await page.evaluate(() => closeOrgChartNodeModal());

  // B3: SỬA node đã có sẵn Cấp Bậc "L5" (nodeId=3, Trưởng Phòng Kinh Doanh) -> đổi Chức Danh sang chính
  // chức danh có mặc định "L7" ở trên -> ô Cấp Bậc KHÔNG BỊ ĐÈ, vẫn giữ "L5" cũ (chỉ gợi ý khi RỖNG,
  // đúng yêu cầu "sửa tay được" — không ép buộc/không ghi đè giá trị admin đã tự chọn trước đó).
  await page.evaluate(() => openOrgChartEditNodeModal(3));
  await page.waitForSelector('#orgChartNodeModal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(80);
  const gradeBefore = await page.inputValue('#orgChartNodeJobGradeInput');
  await page.fill('#orgChartNodeJobTitleInput', '');
  await page.fill('#orgChartNodeJobTitleInput', 'Trưởng Phòng Kinh Doanh');
  await page.locator('#orgChartNodeJobTitleInput').dispatchEvent('change');
  await page.waitForTimeout(80);
  const gradeAfter = await page.inputValue('#orgChartNodeJobGradeInput');
  record('B3. Sửa node ĐÃ CÓ Cấp Bậc "L5" -> đổi lại Chức Danh -> Cấp Bậc KHÔNG bị đè (vẫn "L5", không nhảy sang "L7")', gradeBefore === 'L5' && gradeAfter === 'L5', JSON.stringify({ gradeBefore, gradeAfter }));
  await page.evaluate(() => closeOrgChartNodeModal());

  record('Z. KHÔNG có lỗi JS (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenario(s) passed.`);
  if (failed.length) {
    console.log(`\n${failed.length} FAILED:`);
    failed.forEach(f => console.log(` - ${f.name}`));
    process.exit(1);
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exit(1); });
