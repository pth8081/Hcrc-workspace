// tests/test-lazy-data-groups.js — Lớp 3a (task #188/189/190, tiếp theo Lớp 1/Lớp 2 ở task #133).
//
// Mục đích: xác nhận cơ chế tải LƯỜI DỮ LIỆU theo tab (TAB_DATA_GROUPS/loadDataGroup/loadTabData ở
// core.js, GET /api/data/lazy/:groupKey ở routes/data.js) hoạt động đúng ở tầng CLIENT khi điều hướng
// THẬT qua click DOM (cùng khuôn test-lazy-load-all-tabs.js) — KHÔNG lặp lại các bài test đã có riêng
// cho từng collection ở tầng SERVER (test-attendance-records-scope.js/test-checklist-submissions-scope.js
// đã kiểm phân quyền lọc đúng qua route mới, bài này chỉ kiểm client gọi ĐÚNG group, ĐÚNG lúc, ĐÚNG 1
// lần, và KHÔNG gọi thừa cho tab không cần).
//
// Kiểm tra:
//   1. Vào 1 tab có TAB_DATA_GROUPS (VD "uniform") lần đầu -> gọi ĐÚNG 1 lượt GET /api/data/lazy/uniform,
//      DB.uniformPeriods được gán đúng dữ liệu mock trả về.
//   2. Vào lại tab đó lần 2 trong CÙNG phiên -> KHÔNG gọi lại (idempotent, cache theo Promise).
//   3. hrFeedback dùng CHUNG 2 tab ("internal" và "hr") — vào "internal" trước (tải cả internalHub lẫn
//      hrFeedback) rồi vào "hr" sau -> KHÔNG gọi lại /api/data/lazy/hrFeedback lần 2 (cache theo groupKey,
//      không theo tabName).
//   4. Tab KHÔNG có TAB_DATA_GROUPS (VD "dashboard") -> không có bất kỳ lượt gọi /api/data/lazy/* nào.
//
// Chạy: node server/tests/test-lazy-data-groups.js
const path = require('path');
const http = require('http');
const fs = require('fs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.png': 'image/png', '.svg': 'image/svg+xml'
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

async function main() {
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  const setup = await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => '';

    // Mock fetch: theo dõi MỌI lượt gọi /api/data/lazy/:groupKey (mảng __lazyCalls, đẩy đúng groupKey đã
    // gọi) và trả về dữ liệu giả tương ứng — mỗi group trả đúng 1 field đặc trưng có 1 phần tử, đủ để
    // khẳng định DB.* được gán đúng chứ không chỉ "không lỗi". Các lượt /api/* khác (GET /api/data chính,
    // fragment HTML...) trả mảng/object rỗng hợp lệ, cùng khuôn test-lazy-load-all-tabs.js.
    window.__lazyCalls = [];
    const LAZY_MOCK_RESPONSES = {
      internalHub: { trainingDocuments: [{ id: 1, code: 'TL-MOCK' }] },
      hrFeedback: { hrFeedback: [{ id: 2, content: 'Mock feedback' }] },
      uniform: { uniformPeriods: [{ id: 3, code: 'KP-MOCK' }] },
      budget: { budgetTemplates: [{ id: 4, code: 'MAU-MOCK' }] },
      itSupport: { itServiceRenewals: [{ id: 5, code: 'GH-MOCK' }] },
      laborContract: { laborContracts: [{ id: 6, code: 'HD-MOCK' }] },
      attendance: { attendanceRecords: [{ id: 7, employeeCode: 'NV-MOCK' }] },
      payroll: { payrollPeriods: [{ id: 8, periodYear: 2026, periodMonth: 9 }] },
      checklist: { checklistTemplates: [{ id: 9, code: 'CK-MOCK' }] }
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && !url.startsWith('/api/')) return realFetch(url, opts);
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      const lazyMatch = typeof url === 'string' && url.match(/^\/api\/data\/lazy\/([^/?]+)/);
      if (lazyMatch && method === 'GET') {
        window.__lazyCalls.push(lazyMatch[1]);
        const body = LAZY_MOCK_RESPONSES[lazyMatch[1]] || {};
        return { ok: true, status: 200, json: async () => body };
      }
      if (method === 'GET') return { ok: true, status: 200, json: async () => ([]), blob: async () => new Blob([]) };
      return { ok: false, status: 404, json: async () => ({ error: 'not found (test stub)' }) };
    };

    Object.assign(DB, {
      depts: ['Phòng CNTT'], stores: [], cats: ['Chung'],
      deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: ['Nhân viên'], storeJobTitles: [], submissionTypes: [], contractTypes: [], carTypes: [],
      uniformCatalog: [], itTicketCategories: [],
      workflows: [{ id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }] }],
      deptWorkflows: {},
      docs: [], submissions: [], submissionDeptWorkflows: {}, submissionTypeDeptWorkflows: {}, submissionApprovalGroups: [],
      contracts: [], contractApprovalGroups: [], contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
      meetings: [], meetingMinutes: [], meetingAttendeeTemplates: [],
      carRegs: [], carDeptWorkflows: {},
      officeReqs: [], officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {},
      tasks: [], internalPosts: [], internalNewsCategories: [], internalShareCategories: [],
      trainingCategories: [], sensitiveKeywords: [],
      paymentRequests: [], formTemplates: {}, permGroups: [], users: [],
      vppExcludeGroups: [], vppExcludedJobTitles: [], workflowParticipatingDepts: [],
      pwaShortcutModules: [], itPriceMasterLists: [], itPriceDeptWorkflows: {}, itPriceTierWorkflows: {},
      uploadFileTypeConfig: {}, uploadSizeLimitConfig: {}, emailConfig: {}, systemLogs: [], externalApiKeys: [],
      vppRegistrations: [], vppDeptWorkflows: {}, vppPeriods: [], itPriceApprovals: [],
      budgetEntries: [], budgetDeptWorkflows: {},
      reportPeriods: [], reportEntries: [], licenses: [], licenseTypes: [],
      operationOrders: [], operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {},
      operationStoreOpenings: [], operationStoreOpenDeptWorkflows: {},
      operationRepairs: [], operationRepairDeptWorkflows: {},
      operationWorkItems: [], operationExecutionPeriods: [], orgChartManagerOverrides: {},
      _versions: {}
    });

    const adminUser = {
      id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', jobTitle: 'Nhân viên',
      email: 'admin@test.local', phone: '0900000000', perms: { admin: true }, groupIds: [], permOverrides: null
    };
    DB.users.push(adminUser);
    finishLogin(adminUser);
    return {
      loginOk: document.getElementById('loginSection').classList.contains('hidden'),
      headerShown: !document.getElementById('userHeader').classList.contains('hidden')
    };
  });
  record('setup: finishLogin(admin) với DB.* + mock fetch không lỗi', setup.loginOk && setup.headerShown, JSON.stringify(setup));

  async function clickSeq(selectors) {
    for (const sel of selectors) {
      await page.evaluate((s) => document.querySelector(s)?.click(), sel);
      await page.waitForTimeout(60);
    }
  }

  // ---- 1) Vào tab "uniform" lần đầu -> đúng 1 lượt gọi lazy/uniform, DB.uniformPeriods có dữ liệu mock ----
  await clickSeq(['#btnHanhChinhTab', '#btnUniformTab']);
  await page.waitForTimeout(150);
  const afterFirstUniform = await page.evaluate(() => ({
    calls: window.__lazyCalls.filter(k => k === 'uniform').length,
    periods: (DB.uniformPeriods || []).map(p => p.code)
  }));
  record('Vào tab Đồng Phục lần đầu: gọi ĐÚNG 1 lượt GET /api/data/lazy/uniform',
    afterFirstUniform.calls === 1, `calls=${afterFirstUniform.calls}`);
  record('DB.uniformPeriods được gán đúng dữ liệu mock trả về từ /api/data/lazy/uniform',
    afterFirstUniform.periods.join(',') === 'KP-MOCK', `got=${afterFirstUniform.periods.join(',')}`);

  // ---- 2) Vào lại tab "uniform" lần 2 -> KHÔNG gọi lại (idempotent) ----
  await clickSeq(['#btnUniformTab']);
  await page.waitForTimeout(120);
  const afterSecondUniform = await page.evaluate(() => window.__lazyCalls.filter(k => k === 'uniform').length);
  record('Vào lại tab Đồng Phục lần 2: KHÔNG gọi lại /api/data/lazy/uniform (cache theo Promise)',
    afterSecondUniform === 1, `calls=${afterSecondUniform}`);

  // ---- 3) hrFeedback dùng chung 2 tab: vào "internal" (tải cả internalHub + hrFeedback) rồi "hr" sau ----
  await clickSeq(['#btnInternalTab', 'button[data-op-seq*="setInternalSubTab(QNA)"]']);
  await page.waitForTimeout(150);
  const afterInternal = await page.evaluate(() => ({
    internalHub: window.__lazyCalls.filter(k => k === 'internalHub').length,
    hrFeedback: window.__lazyCalls.filter(k => k === 'hrFeedback').length,
    trainingDocs: (DB.trainingDocuments || []).map(t => t.code),
    feedback: (DB.hrFeedback || []).map(f => f.content)
  }));
  record('Vào tab Truyền Thông Nội Bộ: gọi ĐÚNG 1 lượt lazy/internalHub + 1 lượt lazy/hrFeedback',
    afterInternal.internalHub === 1 && afterInternal.hrFeedback === 1,
    `internalHub=${afterInternal.internalHub} hrFeedback=${afterInternal.hrFeedback}`);
  record('DB.trainingDocuments + DB.hrFeedback được gán đúng dữ liệu mock',
    afterInternal.trainingDocs.join(',') === 'TL-MOCK' && afterInternal.feedback.join(',') === 'Mock feedback',
    JSON.stringify(afterInternal));

  await clickSeq(['#btnHrTab', '#btnHrFeedbackNav']);
  await page.waitForTimeout(120);
  const afterHrTab = await page.evaluate(() => window.__lazyCalls.filter(k => k === 'hrFeedback').length);
  record('Vào tab Nhân Sự > Quản Lý & Phản Hồi Ý Kiến SAU đó: KHÔNG gọi lại /api/data/lazy/hrFeedback (cache theo groupKey, không theo tabName)',
    afterHrTab === 1, `calls=${afterHrTab}`);

  // ---- 4) Tab "dashboard" (không có TAB_DATA_GROUPS) -> không có lượt gọi lazy/* nào phát sinh thêm ----
  const beforeDashboard = await page.evaluate(() => window.__lazyCalls.length);
  await clickSeq(['[data-op="switchTab"][data-arg0="dashboard"]']);
  await page.waitForTimeout(120);
  const afterDashboard = await page.evaluate(() => window.__lazyCalls.length);
  record('Vào tab Trang chủ (không có TAB_DATA_GROUPS): không phát sinh lượt gọi /api/data/lazy/* nào',
    afterDashboard === beforeDashboard, `trước=${beforeDashboard} sau=${afterDashboard}`);

  record('Không có lỗi JS (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0,
    pageErrors.map(e => e.message).join(' | '));

  await browser.close();
  await new Promise((resolve) => server.close(resolve));

  const passCount = results.filter(r => r.pass).length;
  console.log(`\n${passCount}/${results.length} scenarios passed.`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exit(1); });
