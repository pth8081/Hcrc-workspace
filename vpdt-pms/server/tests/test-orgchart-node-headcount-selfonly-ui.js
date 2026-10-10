// server/tests/test-orgchart-node-headcount-selfonly-ui.js
//
// Test UI thật cho checkbox MỚI "Chỉ tính Định Biên/Thực Tế riêng của node này" (10/2026, theo yêu cầu
// người dùng — "Ban Tổng Giám Đốc" bị tính nhầm bằng tổng cả công ty vì mọi Ban khác đều nằm dưới nó
// trong sơ đồ). Modal Thêm/Sửa Node (#orgChartNodeModal) thêm 1 checkbox
// #orgChartNodeHeadcountSelfOnlyCheckbox cho node DEPARTMENT — test này xác nhận đúng vòng đời UI:
//   1. Mở Thêm Node mới (DEPARTMENT) -> checkbox mặc định BỎ TICK.
//   2. Mở Sửa 1 node DEPARTMENT đã có headcountSelfOnly=true -> checkbox tự TICK sẵn (prefill đúng).
//   3. Mở Sửa 1 node DEPARTMENT headcountSelfOnly=false/chưa đặt -> checkbox vẫn BỎ TICK.
//   4. Bỏ tick rồi Lưu -> payload PATCH gửi đúng headcountSelfOnly=false.
//   5. Tick rồi Lưu -> payload PATCH gửi đúng headcountSelfOnly=true.
// Phần tính toán thuần (computeHeadcountReport roll-up/display tách biệt) đã có test riêng ở
// tests/test-orgchart-headcount-report.js — bài này CHỈ xác minh lớp UI (modal + payload gửi đi).
//
// Chạy: node server/tests/test-orgchart-node-headcount-selfonly-ui.js
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
  id: 1, versionName: 'Cơ cấu tổ chức 2026', status: 'DRAFT',
  nodes: [
    { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty HCRC', positionKey: null, displayOrder: 0 },
    { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Ban Tổng Giám Đốc', headcountSelfOnly: true, positionKey: null, displayOrder: 0 },
    { nodeId: 3, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Ban Vận Hành Kinh Doanh', headcountSelfOnly: false, positionKey: null, displayOrder: 1 }
  ]
};

async function main() {
  const PORT = 9500 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 1200 });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(({ version }) => {
    window.alert = () => {};
    window.confirm = () => true;
    window.prompt = () => '';
    window.__lastPatchBody = null;
    window.__lastPostBody = null;

    window.fetch = async (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || 'GET';
      if (u === '/api/org-chart/versions' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ versions: [{ id: version.id, versionName: version.versionName, status: version.status, createdBy: 'admin' }] }) };
      }
      if (u === `/api/org-chart/versions/${version.id}` && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ version }) };
      }
      if (/^\/api\/org-chart\/versions\/\d+\/nodes\/\d+$/.test(u) && method === 'PATCH') {
        window.__lastPatchBody = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ node: { nodeId: 2, ...window.__lastPatchBody } }) };
      }
      if (/^\/api\/org-chart\/versions\/\d+\/nodes$/.test(u) && method === 'POST') {
        window.__lastPostBody = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ node: { nodeId: 99, ...window.__lastPostBody } }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: [], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], positionTypes: [], jobGrades: [], jobTitleGradeDefaults: [],
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

  await page.evaluate(() => switchTab('orgChart'));
  await page.waitForTimeout(300);

  // 1. Thêm Node mới (DEPARTMENT, mặc định) -> checkbox mặc định BỎ TICK
  await page.evaluate(() => openOrgChartAddNodeModal(1));
  await page.waitForSelector('#orgChartNodeModal:not(.hidden)', { timeout: 5000 });
  let checked = await page.locator('#orgChartNodeHeadcountSelfOnlyCheckbox').isChecked();
  record('1. Thêm Node mới (DEPARTMENT) -> checkbox mặc định BỎ TICK', checked === false, String(checked));
  await page.evaluate(() => closeOrgChartNodeModal());

  // 2. Sửa node "Ban Tổng Giám Đốc" (headcountSelfOnly=true sẵn) -> checkbox TỰ TICK
  await page.evaluate(() => openOrgChartEditNodeModal(2));
  await page.waitForSelector('#orgChartNodeModal:not(.hidden)', { timeout: 5000 });
  checked = await page.locator('#orgChartNodeHeadcountSelfOnlyCheckbox').isChecked();
  record('2. Sửa "Ban Tổng Giám Đốc" (đã có headcountSelfOnly=true) -> checkbox prefill TICK sẵn', checked === true, String(checked));

  // 3. Bỏ tick rồi Lưu -> PATCH gửi đúng headcountSelfOnly=false
  await page.locator('#orgChartNodeHeadcountSelfOnlyCheckbox').uncheck();
  await page.click('#btnSaveOrgChartNode');
  await page.waitForTimeout(100);
  let patchBody = await page.evaluate(() => window.__lastPatchBody);
  record('3. Bỏ tick + Lưu -> PATCH gửi đúng headcountSelfOnly=false', patchBody && patchBody.headcountSelfOnly === false, JSON.stringify(patchBody));

  // 4. Sửa node "Ban Vận Hành Kinh Doanh" (headcountSelfOnly=false) -> checkbox vẫn BỎ TICK
  await page.evaluate(() => openOrgChartEditNodeModal(3));
  await page.waitForSelector('#orgChartNodeModal:not(.hidden)', { timeout: 5000 });
  checked = await page.locator('#orgChartNodeHeadcountSelfOnlyCheckbox').isChecked();
  record('4. Sửa "Ban Vận Hành Kinh Doanh" (headcountSelfOnly=false) -> checkbox vẫn BỎ TICK', checked === false, String(checked));

  // 5. Tick rồi Lưu -> PATCH gửi đúng headcountSelfOnly=true
  await page.locator('#orgChartNodeHeadcountSelfOnlyCheckbox').check();
  await page.click('#btnSaveOrgChartNode');
  await page.waitForTimeout(100);
  patchBody = await page.evaluate(() => window.__lastPatchBody);
  record('5. Tick + Lưu -> PATCH gửi đúng headcountSelfOnly=true', patchBody && patchBody.headcountSelfOnly === true, JSON.stringify(patchBody));

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
main().catch(err => { console.error(err); process.exitCode = 1; });
