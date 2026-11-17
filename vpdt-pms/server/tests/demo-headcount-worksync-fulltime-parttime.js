// server/tests/demo-headcount-worksync-fulltime-parttime.js
//
// DEMO thật (chụp ảnh) cho đợt vá 11/2026 "Báo Cáo Định Biên Nhân Sự" theo yêu cầu người dùng (ảnh chụp
// thật từ production, phát hiện "nghỉ thai sản" không lên báo cáo):
//   1. applyProfileEdit() — HR CHỈ điền "Tình trạng làm việc hiện tại (chi tiết)" = "Nghỉ thai sản" (ĐÚNG
//      thao tác gây ra bug thật, KHÔNG tự bấm chuyển trạng thái tay nào khác) -> status TỰ ĐỘNG chuyển
//      ON_LEAVE -> headcountReport.computeHeadcountReport() (hàm THẬT, không bịa số) đếm đúng vào cột
//      "Thai Sản/Nghỉ Ốm".
//   2. classifyEmploymentType() — 2 cột MỚI "Full Time"/"Part Time" đếm theo field employmentType thật.
//   3. "Đang Bàn Giao Nghỉ Việc" lấy từ hrProcesses (processType=OFFBOARDING, status=IN_PROGRESS) — xác
//      nhận lại đúng câu hỏi người dùng vừa hỏi.
// Dựng lại đúng khuôn tests/demo-orgchart-headcount.js (static server phục vụ public/ + Chromium thật,
// stub window.fetch — không cần server/DB thật).
//
// Chạy: node server/tests/demo-headcount-worksync-fulltime-parttime.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const { computeHeadcountReport } = require('../lib/headcountReport');
const employeeProfile = require('../lib/employeeProfile');

const OUT_DIR = process.env.OC_HEADCOUNT_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'headcount-worksync');
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

// ===== Cây mẫu — 1 Phòng Ban, 1 Vị Trí "Nhân Viên Bán Hàng" đủ 6 người minh hoạ 6 trạng thái khác nhau =====
const VERSION = {
  id: 1, versionName: 'Cơ cấu tổ chức 2026', status: 'APPLIED',
  nodes: [
    { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'CÔNG TY HCRC', positionKey: null, displayOrder: 0 },
    { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Siêu thị BRGMart Moonlight', departmentRef: 'Siêu thị BRGMart Moonlight', positionKey: null, displayOrder: 0 },
    { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Nhân viên bán hàng', jobGrade: 'L10.2', requiresDept: true, positionKey: 'PK-NVBH', headcountQuota: 6, displayOrder: 0 }
  ]
};

// ===== Hồ sơ mẫu — xây bằng ĐÚNG applyProfileEdit() thật, KHÔNG gán status tay, để chứng minh cơ chế tự
// động hoạt động đúng như thao tác HR thật sẽ làm (chỉ điền ô "Tình trạng làm việc hiện tại (chi tiết)"). =====
function buildProfile(employeeCode, username, overrides) {
  const p = employeeProfile.defaultProfile(employeeCode);
  Object.assign(p, { username, positionKey: 'PK-NVBH', status: 'ACTIVE' }, overrides || {});
  return p;
}

const pHanh = buildProfile('BL3021', 'pham.thi.hanh', { employmentType: 'Full-Time' });
// ĐÚNG thao tác HR thật đã làm (gây ra bug thật trên production): chỉ điền currentWorkStatusDetail, KHÔNG
// tự bấm chuyển trạng thái tay nào khác — applyProfileEdit() giờ tự lo chuyển ON_LEAVE.
employeeProfile.applyProfileEdit(
  pHanh,
  { currentWorkStatusDetail: 'Nghỉ thai sản', currentWorkStatusFrom: '2026-10-07', currentWorkStatusTo: '2027-04-06' },
  ['currentWorkStatusDetail', 'currentWorkStatusFrom', 'currentWorkStatusTo'],
  'hr1', 'HR Nhân Sự', { skipHistory: true }
);

const EMPLOYEE_PROFILES = [
  pHanh,
  buildProfile('NV2002', 'nv.bh2', { employmentType: 'Full-Time' }),
  buildProfile('NV2003', 'nv.bh3', { employmentType: 'Full-Time' }),
  buildProfile('NV2004', 'nv.bh4', { employmentType: 'Part-Time' }),
  buildProfile('NV2005', 'nv.bh5', { employmentType: 'Part-Time' }),
  buildProfile('NV2006', 'nv.bh6', { employmentType: 'Full-Time' }) // sẽ rơi vào "Đang Bàn Giao Nghỉ Việc" (qua hrProcesses, KHÔNG qua field nào trên hồ sơ)
];
const HR_PROCESSES = [
  { processType: 'OFFBOARDING', status: 'IN_PROGRESS', employeeUsername: 'nv.bh6' }
];
const USERS = EMPLOYEE_PROFILES.map(p => ({ username: p.username, active: true, secondaryPositions: [] }));
const HEADCOUNT_REPORT = computeHeadcountReport(VERSION, EMPLOYEE_PROFILES, HR_PROCESSES, USERS);

console.log('--- Số liệu THẬT từ computeHeadcountReport() (hàm thật, không bịa) ---');
console.log(JSON.stringify(HEADCOUNT_REPORT.rows.find(r => r.nodeId === 3), null, 2));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 9700 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1500, height: 900 });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()));
  page.on('requestfailed', (req) => console.log('[requestfailed]', req.url(), req.failure()?.errorText));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(({ version, report }) => {
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
      if (u === `/api/org-chart/versions/${version.id}/headcount-report` && (!opts || !opts.method || opts.method === 'GET')) {
        return { ok: true, status: 200, json: async () => report };
      }
      if (u === '/api/org-chart/kpi-flow' && (!opts || !opts.method || opts.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: ['Siêu thị BRGMart Moonlight'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: ['Nhân viên bán hàng'], storeJobTitles: [], positionTypes: [],
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
      uniformCatalog: [], itTicketCategories: [],
      _versions: {}
    });

    finishLogin(DB.users[0]);
  }, { version: VERSION, report: HEADCOUNT_REPORT });

  await page.evaluate(() => switchTab('orgChart'));
  // module-orgchart.js tải LƯỜI (MODULE_LOAD_GROUPS['orgchart-v2'], core.js) — đợi hàm thật sự tồn tại
  // thay vì waitForTimeout cố định (môi trường sandbox đôi lúc tải chậm hơn mốc timeout cũ, gây
  // "ReferenceError: openOrgChartHeadcountModal is not defined" dù app không có lỗi gì thật).
  await page.waitForFunction(() => typeof window.openOrgChartHeadcountModal === 'function', { timeout: 15000 });

  // ===== Ảnh 1: Báo Cáo Định Biên Nhân Sự — đủ 2 cột mới "Full Time"/"Part Time" + "Thai Sản/Nghỉ Ốm"
  // đếm ĐÚNG người chỉ điền "Tình trạng làm việc hiện tại (chi tiết)" (KHÔNG tự bấm chuyển trạng thái) =====
  await page.evaluate(() => openOrgChartHeadcountModal());
  await page.waitForSelector('#orgChartHeadcountModal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, '1-bao-cao-dinh-bien-day-du.png'), fullPage: true });
  console.log('Đã chụp: 1-bao-cao-dinh-bien-day-du.png');

  // ===== Ảnh 2: Zoom vào đúng dòng "Nhân viên bán hàng" để thấy rõ số liệu từng cột =====
  const rowHandle = await page.evaluateHandle(() => {
    const rows = Array.from(document.querySelectorAll('#orgChartHeadcountTableBody tr'));
    return rows.find(r => r.textContent.includes('Nhân viên bán hàng'));
  });
  if (rowHandle) {
    const box = await rowHandle.asElement()?.boundingBox();
    if (box) {
      await page.screenshot({
        path: path.join(OUT_DIR, '2-dong-nhan-vien-ban-hang-zoom.png'),
        clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 160), width: 1480, height: 230 }
      });
      console.log('Đã chụp: 2-dong-nhan-vien-ban-hang-zoom.png');
    }
  }

  console.log('jsExceptions:', pageErrors);
  await browser.close();
  server.close();
  console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
