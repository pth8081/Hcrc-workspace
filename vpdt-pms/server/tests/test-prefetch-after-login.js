// tests/test-prefetch-after-login.js — "Tải trước nền sau đăng nhập" (10/2026, theo yêu cầu người dùng
// sau khi báo cáo "thỉnh thoảng bấm vào module vẫn có quyền lại báo không có quyền kết nối, bấm vài lần
// lại được" — xem prefetchLazyTabResources()/TAB_PREFETCH_ACCESS ở core.js, gọi NGAY sau finishLogin()).
//
// Mục đích: xác nhận prefetchLazyTabResources() tự động tải TRƯỚC (không cần bấm tay) đúng các nhóm dữ
// liệu lazy (TAB_DATA_GROUPS, GET /api/data/lazy/:groupKey) của MỌI module người dùng CÓ quyền vào, và
// KHÔNG lãng phí gọi mạng cho module người dùng KHÔNG có quyền — cùng khuôn mock fetch với
// test-lazy-data-groups.js (window.__lazyCalls).
//
// Kiểm tra:
//   1. Admin (mọi quyền) đăng nhập xong, KHÔNG bấm gì cả -> sau 1 khoảng chờ ngắn, TẤT CẢ nhóm lazy của
//      các tab admin có quyền (uniform/budget/itSupport/laborContract/attendance/payroll/checklist/
//      internalHub/hrFeedback) đã tự được gọi đúng 1 lần, DB.* tương ứng có dữ liệu mock.
//   2. Sau khi đã prefetch xong, bấm tay vào 1 tab đã được prefetch (VD "uniform") KHÔNG gọi lại mạng lần
//      2 (cache theo Promise dùng chung với loadDataGroup()/loadTabData() hiện có).
//   3. User GIỚI HẠN (không có bất kỳ quyền riêng nào — hr/uniform/budget/hrContract/checklist/reports
//      đều cần quyền riêng mới vào được) đăng nhập xong -> các nhóm lazy CHỈ DÀNH cho module không có
//      quyền (uniform/budget/checklist) KHÔNG được gọi, trong khi module MỞ MẶC ĐỊNH cho mọi người
//      (itSupport/attendance/payroll) vẫn được prefetch bình thường — xác nhận prefetch tôn trọng đúng
//      quyền, không gọi thừa.
//
// Chạy: node server/tests/test-prefetch-after-login.js
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

const BASE_DB = {
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
  paymentRequests: [], paymentDeptWorkflows: {}, formTemplates: {}, permGroups: [], users: [],
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
};

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

async function setupPage(page, user) {
  return page.evaluate(({ user, mocks }) => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => '';

    window.__lazyCalls = [];
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && !url.startsWith('/api/')) return realFetch(url, opts);
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      const lazyMatch = typeof url === 'string' && url.match(/^\/api\/data\/lazy\/([^/?]+)/);
      if (lazyMatch && method === 'GET') {
        window.__lazyCalls.push(lazyMatch[1]);
        const body = mocks[lazyMatch[1]] || {};
        return { ok: true, status: 200, json: async () => body };
      }
      if (method === 'GET') return { ok: true, status: 200, json: async () => ([]), blob: async () => new Blob([]) };
      return { ok: false, status: 404, json: async () => ({ error: 'not found (test stub)' }) };
    };

    Object.assign(DB, window.__BASE_DB, { users: [user] });
    finishLogin(user);
    return {
      loginOk: document.getElementById('loginSection').classList.contains('hidden'),
      headerShown: !document.getElementById('userHeader').classList.contains('hidden')
    };
  }, { user, mocks: LAZY_MOCK_RESPONSES });
}

async function main() {
  const PORT = 10200 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });

  // ===== Kịch bản 1+2: admin (mọi quyền) — prefetch TOÀN BỘ, không cần bấm tay =====
  {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
    await page.evaluate((db) => { window.__BASE_DB = db; }, BASE_DB);

    // hrContractManage: true — canAccessHrContractModule() KHÔNG có nhánh bypass admin (xem task #103 "Bỏ
    // quyền admin mặc định cho HR/HĐLĐ/Lương", đúng chủ ý thiết kế) nên admin "mọi quyền" ở đây vẫn cần
    // gán tường minh để tab Hợp Đồng Lao Động (nhóm lazy 'laborContract') được prefetch, giống 1 admin
    // thật được cấp đủ quyền quản lý trong thực tế.
    const adminUser = {
      id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', jobTitle: 'Nhân viên',
      email: 'admin@test.local', phone: '0900000000', perms: { admin: true, hrContractManage: true },
      groupIds: [], permOverrides: null
    };
    const setup = await setupPage(page, adminUser);
    record('Admin: setup finishLogin() không lỗi', setup.loginOk && setup.headerShown, JSON.stringify(setup));

    // Đợi đủ cho prefetchLazyTabResources() chạy tuần tự xong hết (fire-and-forget, không await được từ
    // ngoài) — không bấm bất kỳ tab nào trong suốt thời gian chờ.
    await page.waitForTimeout(1200);

    const afterPrefetch = await page.evaluate(() => ({
      calls: window.__lazyCalls.slice(),
      uniformPeriods: (DB.uniformPeriods || []).map(p => p.code),
      checklistTemplates: (DB.checklistTemplates || []).map(t => t.code)
    }));
    const expectedGroups = ['internalHub', 'hrFeedback', 'uniform', 'budget', 'itSupport', 'laborContract', 'attendance', 'payroll', 'checklist'];
    const missing = expectedGroups.filter(g => !afterPrefetch.calls.includes(g));
    record('Admin: KHÔNG bấm gì cả vẫn tự prefetch đủ mọi nhóm lazy (uniform/budget/itSupport/laborContract/attendance/payroll/checklist/internalHub/hrFeedback)',
      missing.length === 0, `thiếu=${missing.join(',')} đã gọi=${afterPrefetch.calls.join(',')}`);
    record('Admin: DB.uniformPeriods đã có dữ liệu mock dù chưa từng bấm vào tab Đồng Phục',
      afterPrefetch.uniformPeriods.join(',') === 'KP-MOCK', JSON.stringify(afterPrefetch));
    record('Admin: DB.checklistTemplates đã có dữ liệu mock dù chưa từng bấm vào tab Checklist',
      afterPrefetch.checklistTemplates.join(',') === 'CK-MOCK', JSON.stringify(afterPrefetch));

    const eachGroupCalledOnce = expectedGroups.every(g => afterPrefetch.calls.filter(c => c === g).length === 1);
    record('Admin: mỗi nhóm lazy CHỈ được gọi ĐÚNG 1 lần trong đợt prefetch (không gọi trùng)',
      eachGroupCalledOnce, `calls=${afterPrefetch.calls.join(',')}`);

    // Bấm tay vào tab đã được prefetch -> KHÔNG gọi lại mạng lần 2 (dùng chung cache Promise với
    // loadDataGroup()/loadTabData() hiện có — switchTab() thấy isTabDataGroupsSettled() đã true).
    await page.evaluate(() => document.getElementById('btnHanhChinhTab')?.click());
    await page.waitForTimeout(60);
    await page.evaluate(() => document.getElementById('btnUniformTab')?.click());
    await page.waitForTimeout(150);
    const afterManualClick = await page.evaluate(() => window.__lazyCalls.filter(k => k === 'uniform').length);
    record('Admin: bấm tay vào tab Đồng Phục SAU KHI đã prefetch xong -> KHÔNG gọi lại /api/data/lazy/uniform lần 2',
      afterManualClick === 1, `calls=${afterManualClick}`);

    record('Admin: không có lỗi JS (pageerror) nào phát sinh', pageErrors.length === 0,
      pageErrors.map(e => e.message).join(' | '));
    await page.close();
  }

  // ===== Kịch bản 3: user KHÔNG có quyền riêng nào — prefetch CHỈ tải module mở mặc định, bỏ qua module cần quyền =====
  {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
    await page.evaluate((db) => { window.__BASE_DB = db; }, BASE_DB);

    const plainUser = {
      id: 2, username: 'nv1', name: 'Nhân Viên Thường', dept: 'Phòng CNTT', jobTitle: 'Nhân viên',
      email: 'nv1@test.local', phone: '0900000001', perms: {}, groupIds: [], permOverrides: null
    };
    const setup = await setupPage(page, plainUser);
    record('User giới hạn: setup finishLogin() không lỗi', setup.loginOk && setup.headerShown, JSON.stringify(setup));

    await page.waitForTimeout(1200);
    const calls = await page.evaluate(() => window.__lazyCalls.slice());

    const shouldNotCall = ['uniform', 'budget', 'checklist']; // cần quyền riêng (uniformManage/budgetCreate.../checklist...) — nv1 không có
    const shouldCall = ['itSupport', 'attendance', 'payroll']; // mở mặc định cho mọi nhân viên đã đăng nhập
    const wronglyCalled = shouldNotCall.filter(g => calls.includes(g));
    const missingOpen = shouldCall.filter(g => !calls.includes(g));
    record('User giới hạn: KHÔNG prefetch nhóm lazy của module cần quyền riêng (uniform/budget/checklist) mà nv1 không có',
      wronglyCalled.length === 0, `gọi thừa=${wronglyCalled.join(',')} đã gọi=${calls.join(',')}`);
    record('User giới hạn: VẪN prefetch nhóm lazy của module mở mặc định (itSupport/attendance/payroll)',
      missingOpen.length === 0, `thiếu=${missingOpen.join(',')} đã gọi=${calls.join(',')}`);

    record('User giới hạn: không có lỗi JS (pageerror) nào phát sinh', pageErrors.length === 0,
      pageErrors.map(e => e.message).join(' | '));
    await page.close();
  }

  await browser.close();
  await new Promise((resolve) => server.close(resolve));

  const passCount = results.filter(r => r.pass).length;
  console.log(`\n${passCount}/${results.length} scenarios passed.`);
  process.exit(results.length === passCount ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
