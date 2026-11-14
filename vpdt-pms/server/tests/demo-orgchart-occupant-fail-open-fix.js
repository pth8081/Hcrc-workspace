// server/tests/demo-orgchart-occupant-fail-open-fix.js
//
// DEMO thật (chụp ảnh, trước/sau) cho lỗi người dùng phản hồi (11/2026): "1 siêu thị chỉ có 1 giám đốc
// mà hiện ra thành 30 giám đốc — lấy tất cả giám đốc siêu thị khác cho vào". Xem lib/orgChart.js
// resolvePositionOccupantsDetailed() + public/js/module-orgchart.js ocResolvePositionOccupants(): điều
// kiện CŨ `deptRef && u.dept !== deptRef` (&&) khi deptRef null (DEPARTMENT cha gần nhất chưa gắn
// departmentRef) bỏ qua LUÔN việc lọc dept, khớp NHẦM mọi user chỉ cần đúng jobTitle — "lọt mở". Bản vá
// đổi sang "lọt đóng": requiresDept mà không xác định được deptRef thì KHÔNG khớp ai.
//
// Dựng lại đúng khuôn tests/demo-orgchart-headcount.js (static server phục vụ public/ + Chromium thật,
// stub thẳng window.fetch — KHÔNG cần route server nào). Chạy 2 lần (OC_DEMO_BEFORE_FIX=1 tạm patch lại
// điều kiện CŨ ngay trong page.evaluate() để chụp ảnh "trước khi vá" — KHÔNG đụng gì tới file module-
// orgchart.js thật trên đĩa) để so sánh trước/sau cùng 1 bộ dữ liệu.
//
// Chạy: node server/tests/demo-orgchart-occupant-fail-open-fix.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const OUT_DIR = process.env.OC_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'orgchart-occupant-fail-open-fix');
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

// ===== Cây mẫu đúng kịch bản người dùng mô tả: nhiều "Giám Đốc Siêu Thị", mỗi siêu thị phải chỉ hiện
// đúng 1 người. Node "Siêu thị số 120 Hàng Trống" CỐ Ý để departmentRef null (mô phỏng đúng tình huống
// thật: node Siêu Thị quên liên kết đúng mã siêu thị khi dựng cây) — vị trí "Giám Đốc Siêu Thị" nằm
// TRỰC TIẾP dưới node này mới lộ rõ lỗi "lọt mở". Node "Siêu thị số 45 Láng Hạ" gắn departmentRef ĐÚNG
// chuẩn, dùng làm đối chứng (phải luôn chỉ hiện đúng 1 người của chính nó, không bị ảnh hưởng gì). =====
const VERSION = {
  id: 1, versionName: 'Cơ cấu tổ chức 2026', status: 'APPLIED',
  nodes: [
    { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'CÔNG TY HCRC', positionKey: null, displayOrder: 0 },
    { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Siêu thị số 120 Hàng Trống', departmentRef: null, positionKey: null, displayOrder: 0 },
    { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Giám Đốc Siêu Thị', requiresDept: true, positionKey: 'GD-ST120', displayOrder: 0 },
    { nodeId: 4, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Siêu thị số 45 Láng Hạ', departmentRef: 'ST45', positionKey: null, displayOrder: 1 },
    { nodeId: 5, parentNodeId: 4, nodeType: 'POSITION', jobTitle: 'Giám Đốc Siêu Thị', requiresDept: true, positionKey: 'GD-ST45', displayOrder: 0 }
  ]
};
const STORE_CODES = ['ST120', 'ST45', 'ST07', 'ST12', 'ST19', 'ST23', 'ST31', 'ST38', 'ST44', 'ST50'];
// canAccessOrgChartModule() (core.js) KHÔNG còn admin bypass (11/2026) — phải có đúng quyền
// orgChartManage/nhanSuManage/kpiFlowConfigManage mới vào được module, admin:true không đủ.
const USERS = [{ id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true, orgChartManage: true }, active: true, groupIds: [], permOverrides: null }];
STORE_CODES.forEach((code, i) => {
  USERS.push({ id: 10 + i, username: `gd.${code.toLowerCase()}`, name: `Giám Đốc Siêu Thị ${code}`, dept: code, jobTitle: 'Giám Đốc Siêu Thị', email: `gd${code}@test.local`, phone: '0900000000', perms: {}, active: true, groupIds: [], permOverrides: null });
});

async function run(label, { beforeFix }) {
  const outDir = path.join(OUT_DIR, label);
  fs.mkdirSync(outDir, { recursive: true });
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.setViewportSize({ width: 1400, height: 900 });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push('console.error: ' + msg.text()); });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });

  await page.evaluate(({ version, beforeFix, users }) => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => '';

    window.__OC_DEMO_BEFORE_FIX__ = beforeFix;

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
      depts: ['Ban Giám Đốc', 'ST120', 'ST45', 'ST07', 'ST12', 'ST19', 'ST23', 'ST31', 'ST38', 'ST44', 'ST50'],
      stores: ['ST120', 'ST45', 'ST07', 'ST12', 'ST19', 'ST23', 'ST31', 'ST38', 'ST44', 'ST50'],
      cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: ['Admin'], storeJobTitles: ['Giám Đốc Siêu Thị'], positionTypes: [],
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
  }, { version: VERSION, beforeFix, users: USERS });

  await page.evaluate(() => switchTab('orgChart'));
  // orgchart-v2 là module JS tải LƯỜI (MODULE_LOAD_GROUPS ở core.js) — đợi script injection thật xong
  // (không chỉ sleep cố định) trước khi gọi hàm của nó, tránh ReferenceError do race.
  await page.waitForFunction(() => typeof setOrgChartSubTab === 'function', { timeout: 15000 });
  // Mô phỏng ĐÚNG hành vi TRƯỚC khi vá — PHẢI ghi đè SAU khi module-orgchart.js (tải lười) đã thực thi
  // xong (ngay phía trên), vì global function declaration của chính file đó sẽ GHI ĐÈ LẠI bất kỳ giá trị
  // nào gán cho window.ocResolvePositionOccupants TRƯỚC lúc nó tải xong. Hoàn toàn trong bộ nhớ trình
  // duyệt của tiến trình demo — KHÔNG đụng gì tới file module-orgchart.js thật trên đĩa.
  await page.evaluate(() => {
    if (!window.__OC_DEMO_BEFORE_FIX__) return;
    window.ocResolvePositionOccupants = function (nodes, node, users) {
      if (!node || node.nodeType !== 'POSITION') return [];
      const deptNode = node.requiresDept !== false ? ocFindNearestDeptAncestor(nodes, node) : null;
      const deptRef = (deptNode && deptNode.departmentRef) || null;
      return (users || []).filter(u => {
        if (u.active === false) return false;
        if (u.jobTitle !== node.jobTitle) return false;
        if (node.requiresDept !== false && deptRef && u.dept !== deptRef) return false;
        return true;
      }).map(u => ({ username: u.username, name: u.name }));
    };
  });
  await page.evaluate(() => setOrgChartSubTab('TREE'));
  await page.waitForFunction(() => {
    const el = document.getElementById('orgChartTreeContainer');
    return !!el && el.textContent.trim().length > 0;
  }, { timeout: 15000 });
  await page.waitForTimeout(150);

  await page.screenshot({ path: path.join(outDir, '1-cay-so-do-to-chuc.png'), fullPage: true });
  console.log(`[${label}] Đã chụp: 1-cay-so-do-to-chuc.png`);

  const occupantText = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('#orgChartTreeContainer .text-teal-700, #orgChartTreeContainer .text-amber-600'));
    return spans.map(s => s.textContent.trim());
  });
  console.log(`[${label}] Dòng occupant hiện trên cây:`, JSON.stringify(occupantText, null, 2));

  console.log(`[${label}] jsExceptions:`, pageErrors);
  await browser.close();
  server.close();
  return occupantText;
}

async function main() {
  const before = await run('TRUOC-KHI-VA', { beforeFix: true });
  const after = await run('SAU-KHI-VA', { beforeFix: false });
  console.log('\n===== SO SÁNH =====');
  console.log('TRƯỚC khi vá:', before);
  console.log('SAU khi vá:  ', after);
  console.log('\nẢnh đã lưu tại', OUT_DIR);
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
