// server/tests/demo-orgchart-diagram-orientation.js
//
// DEMO thật (Playwright) cho tính năng "↔️ Ngang / ↕️ Dọc" (11/2026, theo yêu cầu người dùng "nhiều sơ đồ
// cần quay dọc mới đủ chỗ") ở tab "🖼️ Cây Sơ Đồ Tổ Chức" — mô phỏng đúng tình huống người dùng mô tả: 1
// Phòng Ban có NHIỀU Phòng Ban con (6 node) khiến sơ đồ ngang rất rộng, chụp ảnh Ngang (mặc định) rồi
// bấm "↕️ Dọc" — chụp lại xác nhận: khung hẹp lại (xếp sát nhau hơn), chữ xoay 90° đọc dọc theo khung.
//
// Chạy: node server/tests/demo-orgchart-diagram-orientation.js
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'orgchart-diagram-orientation');

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

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 820 });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.confirm = () => true;
    window.prompt = () => '';
    // 1 Phòng Ban gốc (id 1) + 6 Phòng Ban con (id 2-7) — mô phỏng đúng tình huống "nhiều Phòng Ban cạnh
    // nhau khiến sơ đồ ngang quá rộng" người dùng mô tả.
    window.__ocDiagramNodesStore = [
      { id: 1, parentNodeId: null, nodeName: 'BAN VẬN HÀNH KINH DOANH' },
      { id: 2, parentNodeId: 1, nodeName: 'Kinh Doanh Khu Vực 1' },
      { id: 3, parentNodeId: 1, nodeName: 'Kinh Doanh Khu Vực 2' },
      { id: 4, parentNodeId: 1, nodeName: 'Kinh Doanh Khu Vực 3' },
      { id: 5, parentNodeId: 1, nodeName: 'Phòng Marketing' },
      { id: 6, parentNodeId: 1, nodeName: 'Phòng Chăm Sóc Khách Hàng' },
      { id: 7, parentNodeId: 1, nodeName: 'Phòng Phát Triển Thị Trường' }
    ];
    window.__ocDiagramNextId = 8;

    window.fetch = async (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || 'GET';
      if (u === '/api/org-chart/versions' && method === 'GET') return { ok: true, status: 200, json: async () => ({ versions: [{ id: 1, versionName: 'Demo', status: 'DRAFT', createdBy: 'admin' }] }) };
      if (u === '/api/org-chart/versions/1' && method === 'GET') return { ok: true, status: 200, json: async () => ({ version: { id: 1, versionName: 'Demo', status: 'DRAFT', nodes: [{ nodeId: 1, nodeType: 'COMPANY', nodeName: 'Công Ty', parentNodeId: null }], kpiFlow: [] } }) };
      if (u === '/api/org-chart/kpi-flow' && method === 'GET') return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      if (u === '/api/org-chart/diagram-nodes' && method === 'GET') return { ok: true, status: 200, json: async () => ({ nodes: window.__ocDiagramNodesStore }) };
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: [], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], positionTypes: [], users: [
        { id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true, orgChartManage: true }, active: true, groupIds: [], permOverrides: null }
      ],
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
  });

  await page.evaluate(() => switchTab('orgChart'));
  await page.waitForTimeout(300);
  await page.click('#btnOrgChartSubDiagram');
  await page.waitForTimeout(250);

  // 1) Mặc định "↔️ Ngang" — sơ đồ rộng (7 khối cạnh nhau).
  await shot(page, '#orgChartSection', '01-ngang-mac-dinh.png');
  const hState = await page.evaluate(() => ({ width: document.getElementById('orgChartDiagramSvg').getAttribute('width') }));
  console.log('Chiều rộng sơ đồ (Ngang):', hState.width);

  // 2) Bấm "↕️ Dọc" — khối hẹp lại, chữ xoay 90°.
  await page.click('#btnOrgChartDiagramOrientV');
  await page.waitForTimeout(250);
  await shot(page, '#orgChartSection', '02-doc-chu-xoay.png');
  const vState = await page.evaluate(() => {
    const svg = document.getElementById('orgChartDiagramSvg');
    const text = svg.querySelector('text');
    return { width: svg.getAttribute('width'), transform: text ? text.getAttribute('transform') : null };
  });
  console.log('Chiều rộng sơ đồ (Dọc, phải HẸP hơn Ngang):', vState.width);
  console.log('Thuộc tính transform của chữ (phải có rotate(-90...)):', vState.transform);

  const assert = require('assert');
  assert.ok(Number(vState.width) < Number(hState.width), 'LỖI: sơ đồ Dọc phải HẸP hơn Ngang (khối thu nhỏ lại)');
  assert.ok(vState.transform && vState.transform.includes('rotate(-90'), 'LỖI: chữ phải xoay -90° ở chế độ Dọc');
  console.log('\n✅ Demo xác nhận: chế độ Dọc thu hẹp sơ đồ + xoay chữ 90°, đúng yêu cầu.');

  // 3) Bấm lại "↔️ Ngang" — trở về như cũ.
  await page.click('#btnOrgChartDiagramOrientH');
  await page.waitForTimeout(250);
  await shot(page, '#orgChartSection', '03-quay-lai-ngang.png');

  await browser.close();
  server.close();
  console.log('\n🎉 Demo hoàn tất — ảnh lưu tại:', OUT_DIR);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
