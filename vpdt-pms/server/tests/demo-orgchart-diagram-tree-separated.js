// server/tests/demo-orgchart-diagram-tree-separated.js
//
// DEMO thật (Playwright, người dùng chủ động yêu cầu demo trước khi xác nhận làm thật — Thread D,
// 11/2026) cho tính năng "tách cơ cấu tổ chức ra khỏi định biên": tab "🌳 Sơ Đồ Tổ Chức" đổi tên thành
// "🧩 Định Biên Nhân Sự" (giữ nguyên chức năng), tab "🖼️ Sơ Đồ Trực Quan" cũ thay bằng "🖼️ Cây Sơ Đồ Tổ
// Chức" — cây Phòng Ban/Siêu Thị RIÊNG, độc lập hoàn toàn, tự thêm Phòng Ban thì sơ đồ tự vẽ ngay, và
// "✅ Áp Dụng Phiên Bản Này" (Định Biên) không còn tự nhảy sang tab Sơ Đồ nữa.
//
// Chạy: node server/tests/demo-orgchart-diagram-tree-separated.js
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'orgchart-diagram-tree-separated');

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
    window.__ocVersionNodes = [
      { nodeId: 1, nodeType: 'COMPANY', nodeName: 'CÔNG TY HCRC', parentNodeId: null },
      { nodeId: 2, nodeType: 'POSITION', jobTitle: 'Tổng Giám Đốc', parentNodeId: 1, headcountQuota: 1 },
      { nodeId: 3, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', parentNodeId: 2, departmentRef: 'Phòng Kinh Doanh' },
      { nodeId: 4, nodeType: 'POSITION', jobTitle: 'Trưởng Phòng Kinh Doanh', parentNodeId: 3, headcountQuota: 1 }
    ];
    window.__ocApplied = false;
    window.__ocApplyCalled = false;
    window.__ocDiagramNodesStore = [];
    window.__ocDiagramNextId = 1;

    window.fetch = async (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || 'GET';
      if (u === '/api/org-chart/versions' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ versions: [{ id: 1, versionName: 'Nháp Cơ Cấu + Định Biên 2026', status: window.__ocApplied ? 'APPLIED' : 'DRAFT', createdBy: 'admin' }] }) };
      }
      if (u === '/api/org-chart/versions/1' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ version: { id: 1, versionName: 'Nháp Cơ Cấu + Định Biên 2026', status: window.__ocApplied ? 'APPLIED' : 'DRAFT', nodes: window.__ocVersionNodes, kpiFlow: [] } }) };
      }
      if (u === '/api/org-chart/versions/1/apply' && method === 'POST') {
        window.__ocApplied = true; window.__ocApplyCalled = true;
        return { ok: true, status: 200, json: async () => ({ version: { versionName: 'Nháp Cơ Cấu + Định Biên 2026', effectiveDate: '2026-11-10' }, unresolvedManagerUsers: [] }) };
      }
      if (u === '/api/org-chart/kpi-flow' && method === 'GET') return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      if (u === '/api/org-chart/diagram-nodes' && method === 'GET') return { ok: true, status: 200, json: async () => ({ nodes: window.__ocDiagramNodesStore }) };
      if (u === '/api/org-chart/diagram-nodes' && method === 'POST') {
        const body = JSON.parse(opts.body);
        const node = { id: window.__ocDiagramNextId++, parentNodeId: body.parentNodeId != null ? Number(body.parentNodeId) : null, nodeName: body.nodeName.trim() };
        window.__ocDiagramNodesStore.push(node);
        return { ok: true, status: 200, json: async () => ({ ok: true, node }) };
      }
      const delMatch = u.match(/^\/api\/org-chart\/diagram-nodes\/(\d+)$/);
      if (delMatch && method === 'DELETE') {
        const id = Number(delMatch[1]);
        const toDelete = new Set([id]);
        let changed = true;
        while (changed) {
          changed = false;
          window.__ocDiagramNodesStore.forEach(n => { if (n.parentNodeId != null && toDelete.has(n.parentNodeId) && !toDelete.has(n.id)) { toDelete.add(n.id); changed = true; } });
        }
        window.__ocDiagramNodesStore = window.__ocDiagramNodesStore.filter(n => !toDelete.has(n.id));
        return { ok: true, status: 200, json: async () => ({ ok: true, deletedNodeIds: [...toDelete] }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: ['Phòng Kinh Doanh'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
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

  // 1) Tab "🧩 Định Biên Nhân Sự" (đổi tên, chức năng giữ nguyên).
  await shot(page, '#orgChartSection', '01-tab-dinh-bien-nhan-su-doi-ten.png');

  // 2) Bấm Áp Dụng -> vẫn ở tab Định Biên, không tự nhảy (đóng modal kết quả Áp Dụng trước khi tiếp tục).
  await page.click('#btnOrgChartApplyVersion');
  await page.waitForTimeout(300);
  await shot(page, '#orgChartSection', '02-ap-dung-xong-van-o-dinh-bien.png');
  await page.evaluate(() => closeOrgChartApplyResultModal());
  await page.waitForTimeout(150);

  // 3) Qua tab "🖼️ Cây Sơ Đồ Tổ Chức" — trống, tự bấm qua (không tự động).
  await page.click('#btnOrgChartSubDiagram');
  await page.waitForTimeout(250);
  await shot(page, '#orgChartSection', '03-tab-cay-so-do-rong.png');

  // 4) Thêm "Phòng Kinh Doanh" (gốc) -> sơ đồ tự vẽ ngay.
  await page.fill('#orgChartDiagramNodeNameInput', 'Phòng Kinh Doanh');
  await page.click('#btnOrgChartDiagramAddNode');
  await page.waitForTimeout(250);
  await shot(page, '#orgChartSection', '04-them-phong-kinh-doanh-tu-ve.png');

  // 5) Thêm "Kinh Doanh Khu Vực 1" (con của Phòng Kinh Doanh) -> lồng cấp.
  const parentId = await page.evaluate(() => window.__ocDiagramNodesStore.find(n => n.nodeName === 'Phòng Kinh Doanh').id);
  await page.fill('#orgChartDiagramNodeNameInput', 'Kinh Doanh Khu Vực 1');
  await page.selectOption('#orgChartDiagramNodeParentSelect', String(parentId));
  await page.click('#btnOrgChartDiagramAddNode');
  await page.waitForTimeout(250);

  // 6) Thêm "Phòng IT" (gốc thứ 2, song song) -> 2 cây gốc cùng vẽ.
  await page.fill('#orgChartDiagramNodeNameInput', 'Phòng IT');
  await page.selectOption('#orgChartDiagramNodeParentSelect', '');
  await page.click('#btnOrgChartDiagramAddNode');
  await page.waitForTimeout(250);
  await shot(page, '#orgChartSection', '05-2-cay-goc-song-song.png');

  await browser.close();
  server.close();
  console.log('\n🎉 Demo hoàn tất — ảnh lưu tại:', OUT_DIR);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
