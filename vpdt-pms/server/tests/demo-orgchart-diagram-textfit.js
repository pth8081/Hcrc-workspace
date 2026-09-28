// server/tests/demo-orgchart-diagram-textfit.js
//
// DEMO thật (người dùng chủ động yêu cầu "demo bằng ảnh trước khi tôi xác nhận làm") cho fix "chữ tràn
// ra ngoài ô" trên tab 🖼️ Sơ Đồ Trực Quan (Cơ Cấu Tổ Chức) — dùng ĐÚNG tên Phòng/Ban dài trong ảnh chụp
// người dùng gửi ("BAN TỔNG GIÁM ĐỐC", "BAN VẬN HÀNH KINH DOANH", "BAN CUNG ỨNG") để tái hiện chính xác
// tình huống lỗi rồi chụp lại sau khi vá (ocWrapLines()/module-orgchart.js — xuống dòng theo ước lượng
// số ký tự vừa khung, tối đa 2 dòng, box tự cao thêm nếu cần).
//
// Chạy: node server/tests/demo-orgchart-diagram-textfit.js
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_DIR = process.env.ORGCHART_TEXTFIT_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'orgchart-diagram-textfit');
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[ext] || 'application/octet-stream';
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

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 9812;
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1000, height: 700 });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.alert = () => {}; window.confirm = () => true; window.prompt = () => '';
    // Đúng tên Công Ty/Phòng Ban dài trong ảnh chụp người dùng gửi kèm yêu cầu.
    window.__ocNodes = [
      { nodeId: 1, nodeType: 'COMPANY', nodeName: 'Công Ty HCRC', parentNodeId: null },
      { nodeId: 2, nodeType: 'DEPARTMENT', nodeName: 'BAN TỔNG GIÁM ĐỐC', parentNodeId: 1, departmentRef: 'BAN TỔNG GIÁM ĐỐC' },
      { nodeId: 3, nodeType: 'DEPARTMENT', nodeName: 'BAN VẬN HÀNH KINH DOANH', parentNodeId: 2, departmentRef: 'BAN VẬN HÀNH KINH DOANH' },
      { nodeId: 4, nodeType: 'DEPARTMENT', nodeName: 'BAN CUNG ỨNG', parentNodeId: 2, departmentRef: 'BAN CUNG ỨNG' }
    ];
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u === '/api/org-chart/versions') return { ok: true, status: 200, json: async () => ({ versions: [{ id: 1, versionName: 'Demo', status: 'APPLIED', createdBy: 'admin' }] }) };
      if (u === '/api/org-chart/versions/1') return { ok: true, status: 200, json: async () => ({ version: { id: 1, versionName: 'Demo', status: 'APPLIED', nodes: window.__ocNodes, kpiFlow: [] } }) };
      if (u === '/api/org-chart/kpi-flow') return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      return { ok: true, status: 200, json: async () => ([]) };
    };
    Object.assign(DB, {
      depts: [], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {}, jobTitles: [], storeJobTitles: [],
      positionTypes: [], users: [{ id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }],
      workflows: [], quickApplyConfigs: [], deptWorkflows: {}, docs: [], submissions: [], submissionApprovalGroups: [],
      submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {}, contracts: [], contractApprovalGroups: [],
      contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {}, meetings: [], meetingRooms: [], meetingMinutes: [],
      meetingAttendeeTemplates: [], carDeptWorkflows: {}, carTypes: [], carPurposes: [], carVehicleTypes: [], carTaxiCompanies: [],
      carRegs: [], officeReqs: [], officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {}, tasks: [], internalPosts: [],
      internalNewsCategories: [], internalShareCategories: [], trainingCategories: [], trainingDocuments: [], trainingClasses: [],
      trainingRegistrations: [], careerPaths: [], careerPathConfirmations: [], trainingTests: [], trainingTestSubmissions: [],
      trainingCourses: [], trainingPlans: [], onboardingPaths: [], onboardingProgress: [], recruitmentJobs: [],
      recruitmentReferrals: [], hrFeedback: [], sensitiveKeywords: [], paymentRequests: [], paymentDeptWorkflows: {},
      formTemplates: {}, permGroups: [], vppExcludeGroups: [], vppExcludedJobTitles: [], workflowParticipatingDepts: [],
      workflowParticipatingPositions: [], pwaShortcutModules: [], itPriceMasterLists: [], itPriceDeptWorkflows: {},
      itPriceTierWorkflows: {}, uploadFileTypeConfig: {}, uploadSizeLimitConfig: {}, emailConfig: {}, systemLogs: [],
      externalApiKeys: [], vppRegistrations: [], vppDeptWorkflows: {}, vppPeriods: [], itPriceApprovals: [],
      itServiceRenewals: [], itSupportTickets: [], budgetEntries: [], budgetDeptWorkflows: {}, budgetTemplates: [],
      budgetPeriods: [], reportPeriods: [], reportEntries: [], licenses: [], licenseTypes: [], operationOrders: [],
      operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {}, operationStoreOpenings: [],
      operationStoreOpenDeptWorkflows: {}, operationRepairs: [], operationRepairDeptWorkflows: {}, operationWorkItems: [],
      operationExecutionPeriods: [], orgChartManagerOverrides: {}, uniformCatalog: [], itTicketCategories: [], _versions: {}
    });
    finishLogin(DB.users[0]);
  });

  await page.evaluate(() => switchTab('orgChart'));
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('btnOrgChartSubDiagram').click());
  await page.waitForTimeout(200);

  await page.locator('#orgChartDiagramContainer').screenshot({ path: path.join(OUT_DIR, 'sau-khi-va-chu-luon-trong-o.png') });
  console.log('📸 sau-khi-va-chu-luon-trong-o.png');

  await browser.close();
  server.close();
  console.log('\n🖼️  Ảnh demo đã lưu tại:', OUT_DIR);
}

main().catch((e) => { console.error('💥 Demo lỗi:', e); process.exitCode = 1; });
