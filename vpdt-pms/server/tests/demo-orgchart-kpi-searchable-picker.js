// server/tests/demo-orgchart-kpi-searchable-picker.js
//
// DEMO thật (Playwright, người dùng chủ động yêu cầu demo trước khi xác nhận làm thật, 11/2026): 2 ô
// "Vị Trí Đánh Giá (cấp trên)"/"Vị Trí Được Đánh Giá" ở tab "🎯 Cấu Hình Đánh Giá KPI" đổi từ <select>
// liệt kê toàn bộ sang ô tìm-kiếm-gõ-chọn chuẩn (dropdown + searchable + single choice, cùng khuôn
// sdd* toàn hệ thống) — theo yêu cầu người dùng.
//
// Chạy: node server/tests/demo-orgchart-kpi-searchable-picker.js
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'orgchart-kpi-searchable-picker');

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
  await page.setViewportSize({ width: 1100, height: 760 });

  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(String(e)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.confirm = () => true;
    // 7 vị trí — 2 node "Nhân Viên Kinh Doanh" CÙNG Phòng Kinh Doanh (2 suất biên chế riêng, cùng tên
    // hiển thị — kịch bản thật khiến nhãn phải tự phụ "(#id)" để phân biệt).
    window.__ocVersionNodes = [
      { nodeId: 1, nodeType: 'COMPANY', nodeName: 'CÔNG TY HCRC', parentNodeId: null },
      { nodeId: 2, nodeType: 'POSITION', jobTitle: 'Tổng Giám Đốc', parentNodeId: 1, headcountQuota: 1, requiresDept: false },
      { nodeId: 3, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', parentNodeId: 2, departmentRef: 'Phòng Kinh Doanh' },
      { nodeId: 4, nodeType: 'POSITION', jobTitle: 'Trưởng Phòng Kinh Doanh', parentNodeId: 3, headcountQuota: 1 },
      { nodeId: 5, nodeType: 'POSITION', jobTitle: 'Nhân Viên Kinh Doanh', parentNodeId: 4, headcountQuota: 1 },
      { nodeId: 9, nodeType: 'POSITION', jobTitle: 'Nhân Viên Kinh Doanh', parentNodeId: 4, headcountQuota: 1 },
      { nodeId: 6, nodeType: 'DEPARTMENT', nodeName: 'Phòng IT', parentNodeId: 2, departmentRef: 'Phòng IT' },
      { nodeId: 7, nodeType: 'POSITION', jobTitle: 'Trưởng Phòng IT', parentNodeId: 6, headcountQuota: 1 }
    ];
    window.__ocApplied = false;
    window.__ocKpiRows = [];
    window.__ocKpiNextId = 1;

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
        window.__ocApplied = true;
        return { ok: true, status: 200, json: async () => ({ version: { versionName: 'Nháp Cơ Cấu + Định Biên 2026', effectiveDate: '2026-11-10' }, unresolvedManagerUsers: [] }) };
      }
      if (u === '/api/org-chart/kpi-flow' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ rows: window.__ocKpiRows }) };
      }
      if (u === '/api/org-chart/kpi-flow' && method === 'POST') {
        const body = JSON.parse(opts.body);
        const nodeById = Object.fromEntries(window.__ocVersionNodes.map(n => [n.nodeId, n]));
        const nameOf = (id) => {
          const n = nodeById[id];
          if (!n) return '?';
          if (n.nodeType !== 'POSITION') return n.nodeName;
          return n.requiresDept === false ? n.jobTitle : `${n.jobTitle} ${n.nodeName || ''}`.trim();
        };
        window.__ocKpiRows.push({ id: window.__ocKpiNextId++, evaluatorName: nameOf(body.evaluatorNodeId), evaluateeName: nameOf(body.evaluateeNodeId), isAutoFromHierarchy: false });
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      if (u === '/api/org-chart/diagram-nodes' && method === 'GET') return { ok: true, status: 200, json: async () => ({ nodes: [] }) };
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: ['Phòng Kinh Doanh', 'Phòng IT'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
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
  await page.click('#btnOrgChartApplyVersion');
  await page.waitForTimeout(300);
  await page.evaluate(() => closeOrgChartApplyResultModal());
  await page.waitForTimeout(150);

  await page.click('#btnOrgChartSubKpi');
  await page.waitForTimeout(250);
  await shot(page, '#orgChartSection', '01-tab-kpi-truoc-khi-go.png');

  // Gõ "nhân viên" vào ô Vị Trí Đánh Giá (cấp trên) -> hiện gợi ý lọc, KHÔNG dấu vẫn ra kết quả có dấu.
  await page.click('#orgChartKpiEvaluatorSelect');
  await page.fill('#orgChartKpiEvaluatorSelect', 'truong phong');
  await page.waitForTimeout(150);
  await shot(page, 'body', '02-go-tim-khong-dau-hien-goi-y.png');

  // Bấm chọn "Trưởng Phòng Kinh Doanh".
  await page.click('div[data-sdd-idx]:has-text("Trưởng Phòng Kinh Doanh")');
  await page.waitForTimeout(100);

  // Ô Vị Trí Được Đánh Giá: gõ "Nhân Viên Kinh Doanh" -> 2 kết quả TRÙNG tên hiển thị -> nhãn tự phụ "(#id)".
  await page.click('#orgChartKpiEvaluateeSelect');
  await page.fill('#orgChartKpiEvaluateeSelect', 'nhan vien kinh doanh');
  await page.waitForTimeout(150);
  await shot(page, 'body', '03-trung-nhan-tu-phu-id-de-phan-biet.png');

  // Chọn đúng dòng "Nhân Viên Kinh Doanh (#5)" (1 trong 2 suất biên chế trùng tên).
  await page.click('div[data-sdd-idx]:has-text("(#5)")');
  await page.waitForTimeout(100);
  await shot(page, '#orgChartSection', '04-da-chon-ca-2-o.png');

  await page.click('#btnAddOrgChartKpiFlow');
  await page.waitForTimeout(250);
  await shot(page, '#orgChartSection', '05-sau-khi-them-quan-he-thanh-cong.png');

  // Thử gõ tự do KHÔNG bấm chọn gợi ý -> bấm Thêm Quan Hệ -> bị chặn rõ ràng, không gửi NaN lên server.
  await page.fill('#orgChartKpiEvaluatorSelect', 'xyz không tồn tại');
  await page.keyboard.press('Escape');
  await page.fill('#orgChartKpiEvaluateeSelect', 'xyz không tồn tại');
  await page.keyboard.press('Escape');
  let alertMsg = null;
  page.once('dialog', async (d) => { alertMsg = d.message(); await d.accept(); });
  await page.click('#btnAddOrgChartKpiFlow');
  await page.waitForTimeout(150);
  console.log('⚠️  Alert khi gõ tự do không bấm chọn:', alertMsg);

  console.log('\nLỗi JS (pageerror):', consoleErrors.length ? consoleErrors : '(không có)');
  console.log('__ocKpiRows cuối:', await page.evaluate(() => JSON.stringify(window.__ocKpiRows)));

  await browser.close();
  server.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
