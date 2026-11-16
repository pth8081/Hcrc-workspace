// server/tests/demo-orgchart-displayname-no-dept-suffix.js
//
// DEMO thật (chụp ảnh, trước/sau) cho phản hồi người dùng (12/2026): "tích thuộc phòng ban cụ thể thì nó
// lại cộng thêm cái đuôi phòng ban bên ngoài thành chức danh dài ra... nếu cộng vào thì bị sai hết đối
// với hồ sơ nhân sự". Xem lib/orgChart.js buildNodeDisplayName()/public/js/module-orgchart.js
// ocBuildNodeDisplayName(): TRƯỚC ĐÂY khi node.requiresDept !== false, tên hiển thị = "<Chức danh> <Tên
// phòng ban cha>" (VD "Giám đốc Siêu thị" + "Siêu thị số 390 Nguyễn Văn Cừ"). Bản vá đổi LUÔN trả về đúng
// node.jobTitle, không cộng gì thêm — khớp đúng Chức Danh lưu trong Hồ Sơ Nhân Sự.
//
// Dựng lại đúng khuôn tests/demo-orgchart-occupant-fail-open-fix.js (static server phục vụ public/ +
// Chromium thật, stub thẳng window.fetch — KHÔNG cần route server nào).
//
// Chạy: node server/tests/demo-orgchart-displayname-no-dept-suffix.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const OUT_DIR = process.env.OC_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'orgchart-displayname-no-dept-suffix');
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

// Đúng kịch bản người dùng gửi ảnh: "Siêu thị số 390 Nguyễn Văn Cừ" -> "Giám đốc Siêu thị" (requiresDept
// TRUE, tích "Thuộc 1 phòng ban cụ thể"). Thêm 1 siêu thị khác để chứng minh occupant VẪN lọc đúng riêng
// từng siêu thị (không bị trộn) dù label không còn cộng tên phòng ban.
const VERSION = {
  id: 1, versionName: 'Cơ cấu tổ chức 2026', status: 'APPLIED',
  nodes: [
    { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'CÔNG TY HCRC', positionKey: null, displayOrder: 0 },
    { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Siêu thị số 390 Nguyễn Văn Cừ', departmentRef: 'ST390', positionKey: null, displayOrder: 0 },
    { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Giám đốc Siêu thị', requiresDept: true, positionKey: 'GD-ST390', displayOrder: 0 },
    { nodeId: 4, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Siêu thị số 105 Lê Duẩn', departmentRef: 'ST105', positionKey: null, displayOrder: 1 },
    { nodeId: 5, parentNodeId: 4, nodeType: 'POSITION', jobTitle: 'Giám đốc Siêu thị', requiresDept: true, positionKey: 'GD-ST105', displayOrder: 0 }
  ]
};
const USERS = [
  { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true, orgChartManage: true }, active: true, groupIds: [], permOverrides: null },
  { id: 2, username: 'gd.st390', name: 'Phạm Thị Thanh Hoa', dept: 'ST390', jobTitle: 'Giám đốc Siêu thị', email: 'gd390@test.local', phone: '0900000000', perms: {}, active: true, groupIds: [], permOverrides: null },
  { id: 3, username: 'gd.st105', name: 'Trần Văn B', dept: 'ST105', jobTitle: 'Giám đốc Siêu thị', email: 'gd105@test.local', phone: '0900000000', perms: {}, active: true, groupIds: [], permOverrides: null }
];

async function run(label, { beforeFix }) {
  const outDir = path.join(OUT_DIR, label);
  fs.mkdirSync(outDir, { recursive: true });
  const PORT = 9700 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewportSize({ width: 1100, height: 700 });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push('console.error: ' + msg.text()); });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });

  await page.evaluate(({ version, users }) => {
    window.alert = () => {}; window.confirm = () => true; window.prompt = () => '';
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u === '/api/org-chart/versions' && (!opts || !opts.method || opts.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ versions: [{ id: version.id, versionName: version.versionName, status: version.status, createdBy: 'admin' }] }) };
      }
      if (u === `/api/org-chart/versions/${version.id}` && (!opts || !opts.method || opts.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ version }) };
      }
      if (u === '/api/org-chart/kpi-flow' && (!opts || !opts.method || opts.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };
    Object.assign(DB, {
      depts: ['Ban Giám Đốc', 'ST390', 'ST105'], stores: ['ST390', 'ST105'],
      cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: ['Admin'], storeJobTitles: ['Giám đốc Siêu thị'], positionTypes: [],
      users, workflows: [], quickApplyConfigs: [], deptWorkflows: {},
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
  }, { version: VERSION, users: USERS });

  await page.evaluate(() => switchTab('orgChart'));
  await page.waitForFunction(() => typeof setOrgChartSubTab === 'function', { timeout: 15000 });
  // Mô phỏng hành vi TRƯỚC khi vá — ghi đè SAU khi module-orgchart.js tải lười xong (global function
  // declaration của chính file đó mới là bản sẽ chạy nếu không ghi đè lại ở đây). Hoàn toàn trong bộ nhớ
  // trình duyệt của tiến trình demo — KHÔNG đụng gì tới file module-orgchart.js thật trên đĩa.
  await page.evaluate((beforeFix) => {
    if (!beforeFix) return;
    window.ocBuildNodeDisplayName = function (nodes, node) {
      if (node.nodeType !== 'POSITION') return node.nodeName;
      if (node.requiresDept === false) return node.jobTitle;
      const deptNode = ocFindNearestDeptAncestor(nodes, node);
      return deptNode ? `${node.jobTitle} ${deptNode.nodeName}` : node.jobTitle;
    };
  }, beforeFix);
  await page.evaluate(() => setOrgChartSubTab('TREE'));
  await page.waitForFunction(() => {
    const el = document.getElementById('orgChartTreeContainer');
    return !!el && el.textContent.trim().length > 0;
  }, { timeout: 15000 });
  await page.waitForTimeout(150);

  await page.screenshot({ path: path.join(outDir, '1-cay-so-do-to-chuc.png'), fullPage: true });
  console.log(`[${label}] Đã chụp: 1-cay-so-do-to-chuc.png`);

  const labels = await page.evaluate(() => {
    const strongs = Array.from(document.querySelectorAll('#orgChartTreeContainer strong'));
    return strongs.map(s => s.textContent.trim()).filter(t => t.includes('Giám đốc'));
  });
  console.log(`[${label}] Nhãn "Giám đốc Siêu thị" hiện trên cây:`, JSON.stringify(labels, null, 2));

  console.log(`[${label}] jsExceptions:`, pageErrors);
  await browser.close();
  server.close();
  return labels;
}

async function main() {
  const before = await run('TRUOC-KHI-VA', { beforeFix: true });
  const after = await run('SAU-KHI-VA', { beforeFix: false });
  console.log('\n===== SO SÁNH =====');
  console.log('TRƯỚC khi vá (cộng tên phòng ban):', before);
  console.log('SAU khi vá (đúng Chức Danh, không cộng gì):', after);
  console.log('\nẢnh đã lưu tại', OUT_DIR);
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
