// server/tests/demo-orgchart-headcount.js
//
// DEMO thật (chụp ảnh) cho tính năng MỚI "📋 Báo Cáo Định Biên Nhân Sự" (10/2026, theo yêu cầu người
// dùng "biết được định biên nhân sự hiện tại, định biên nhân sự cần tuyển") — xem lib/headcountReport.js
// + field headcountQuota trên node POSITION (lib/orgChart.js) + routes/orgChart.js (2 route mới).
//
// Dựng lại đúng khuôn tests/test-orgchart-diagram-tab.js (static server phục vụ public/ + Chromium
// thật, stub thẳng window.fetch — KHÔNG cần route server nào). Số liệu Thực Tế/Chênh Lệch hiện trong
// ảnh chụp được tính bằng ĐÚNG hàm thật computeHeadcountReport() (require trực tiếp lib/headcountReport.js
// phía Node), không phải số tự bịa — đảm bảo ảnh demo phản ánh đúng logic nghiệp vụ thật.
//
// Chạy: node server/tests/demo-orgchart-headcount.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const { computeHeadcountReport } = require('../lib/headcountReport');

const OUT_DIR = process.env.OC_HEADCOUNT_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'orgchart-headcount');
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

// ===== Cây mẫu + dữ liệu nhân sự mẫu (tính Thực Tế bằng ĐÚNG hàm thật) =====
const VERSION = {
  id: 1, versionName: 'Cơ cấu tổ chức 2026', status: 'APPLIED',
  nodes: [
    { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'CÔNG TY HCRC', positionKey: null, displayOrder: 0 },
    { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', departmentRef: 'Phòng Kinh Doanh', positionKey: null, displayOrder: 0 },
    { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Trưởng Phòng Kinh Doanh', jobGrade: 'L5', requiresDept: true, positionKey: 'PK-TPKD', headcountQuota: 1, displayOrder: 0 },
    { nodeId: 4, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Nhân Viên Kinh Doanh', jobGrade: 'L3', requiresDept: true, positionKey: 'PK-NVKD', headcountQuota: 6, displayOrder: 1 }
  ]
};
const EMPLOYEE_PROFILES = [
  { employeeCode: 'NV2001', username: 'tp.kd', positionKey: 'PK-TPKD', status: 'ACTIVE' },
  { employeeCode: 'NV2002', username: 'nv.kd1', positionKey: 'PK-NVKD', status: 'ACTIVE' },
  { employeeCode: 'NV2003', username: 'nv.kd2', positionKey: 'PK-NVKD', status: 'ACTIVE' },
  { employeeCode: 'NV2004', username: 'nv.kd3', positionKey: 'PK-NVKD', status: 'ON_LEAVE' },
  { employeeCode: 'NV2005', username: 'nv.kd4', positionKey: 'PK-NVKD', status: 'ACTIVE' } // sẽ rơi vào "đang bàn giao nghỉ việc"
];
const HR_PROCESSES = [
  { processType: 'OFFBOARDING', status: 'IN_PROGRESS', employeeUsername: 'nv.kd4' }
];
const USERS = [
  { username: 'tp.kd', active: true, secondaryPositions: [] },
  { username: 'nv.kd1', active: true, secondaryPositions: [] },
  { username: 'nv.kd2', active: true, secondaryPositions: [] },
  { username: 'nv.kd3', active: true, secondaryPositions: [] },
  { username: 'nv.kd4', active: true, secondaryPositions: [] },
  { username: 'kiemnhiem1', active: true, secondaryPositions: [{ dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân Viên Kinh Doanh' }] }
];
const HEADCOUNT_REPORT = computeHeadcountReport(VERSION, EMPLOYEE_PROFILES, HR_PROCESSES, USERS);

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 9700 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 1100 });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

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
      depts: ['Phòng Kinh Doanh'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: ['Trưởng Phòng Kinh Doanh', 'Nhân Viên Kinh Doanh'], storeJobTitles: [], positionTypes: [],
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
  await page.waitForTimeout(300);

  // ===== Ảnh 1: Sửa Vị Trí "Nhân Viên Kinh Doanh" — thấy ô "Định Biên" mới =====
  await page.evaluate(() => openOrgChartEditNodeModal(4));
  await page.waitForSelector('#orgChartNodeModal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT_DIR, '1-sua-vi-tri-dinh-bien.png'), fullPage: true });
  console.log('Đã chụp: 1-sua-vi-tri-dinh-bien.png');
  await page.evaluate(() => closeOrgChartNodeModal());

  // ===== Ảnh 2: Màn Cơ Cấu Tổ Chức — nút "📋 Báo Cáo Định Biên Nhân Sự" =====
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT_DIR, '2-man-co-cau-to-chuc.png'), fullPage: true });
  console.log('Đã chụp: 2-man-co-cau-to-chuc.png');

  // ===== Ảnh 3: Báo Cáo Định Biên Nhân Sự — bảng Định biên/Thực tế/Chênh lệch =====
  await page.evaluate(() => openOrgChartHeadcountModal());
  await page.waitForSelector('#orgChartHeadcountModal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, '3-bao-cao-dinh-bien.png'), fullPage: true });
  console.log('Đã chụp: 3-bao-cao-dinh-bien.png');

  console.log('jsExceptions:', pageErrors);
  await browser.close();
  server.close();
  console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
