// tests/demo-filter-panels-12-2026.js — DEMO ảnh thật (chụp Chromium thật) cho 4 bộ lọc MỚI (12/2026,
// theo yêu cầu người dùng xác nhận trước khi merge) — xem mục "5s" Huong-dan-nghiep-vu.md:
//   1. Hồ Sơ Nhân Sự > Quản Lý Hồ Sơ — Hình Thức Làm Việc / Căn Cước Công Dân / Khoảng Ngày Vào Làm Việc
//   2. Hợp Đồng Lao Động — Loại HĐ (mới) + Trạng Thái (có sẵn, nay thu gọn được)
//   3. Onboarding/Offboarding — Hình Thức Làm Việc / Tình Trạng Hợp Đồng
//   4. Báo Cáo Định Biên Nhân Sự — Phòng Ban / Vị Trí + thu gọn đoạn giải thích
// Chạy: node server/tests/demo-filter-panels-12-2026.js
'use strict';
const path = require('path');
const fs = require('fs');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const OUT_DIR = process.env.FILTER_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'filter-panels-12-2026');
fs.mkdirSync(OUT_DIR, { recursive: true });

async function shoot(page, name) {
  const p = path.join(OUT_DIR, name);
  await page.screenshot({ path: p, fullPage: false });
  console.log('📸', p);
}

async function demoHrProfile() {
  const PORT = 9101;
  const HR = { username: 'hr1', name: 'HR Quản Lý', dept: 'Nhân Sự', perms: { hrProfileManage: true }, active: true, totpEnabled: true };
  const LINKED_USER = { username: 'nv.a', name: 'Nguyễn Văn A', dept: 'Phòng Kế Toán', startDate: '2020-01-01', active: true, totpEnabled: true };
  const PROFILES = [
    { employeeCode: 'FE001', username: 'nv.a', status: 'ACTIVE', dept: 'Phòng Kế Toán', jobTitle: 'Kế Toán Viên',
      employmentType: 'Chính thức', nationalId: '001090001234', joinDateAtHcrc: '2020-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    { employeeCode: 'FE002', username: null, status: 'ACTIVE', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân Viên KD',
      employmentType: 'Thời vụ', nationalId: '002090005678', joinDateAtHcrc: '2024-06-15', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
    { employeeCode: 'FE003', username: null, status: 'ACTIVE', dept: 'Phòng Kế Toán', jobTitle: 'Kế Toán Trưởng',
      employmentType: 'Chính thức', nationalId: '003090009999', joinDateAtHcrc: '2023-03-10', createdAt: '2026-01-03', updatedAt: '2026-01-03' }
  ];
  const state = createMockState({ users: [HR, LINKED_USER], employeeProfiles: PROFILES, employmentTypes: ['Chính thức', 'Thời vụ', 'Bán thời gian'] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, HR);
    await page.evaluate(() => { switchTab('hrProfile'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { setHrProfileView('MANAGE'); });
    await page.waitForTimeout(300);
    await page.click('#btnToggleHrpfMgFilter');
    await page.waitForTimeout(150);
    await page.selectOption('#hrpfMgFilterEmploymentType', 'Chính thức');
    await page.fill('#hrpfMgFilterJoinFrom', '2020-01-01');
    await page.waitForTimeout(150);
    await shoot(page, '1-hoso-nhansu-bo-loc.png');
  } finally {
    await browser.close();
    server.close();
  }
}

async function demoHrContract() {
  const PORT = 9102;
  const HR = { username: 'hr1', name: 'HR Hợp Đồng', dept: 'Nhân Sự', perms: { hrContractManage: true }, active: true, totpEnabled: true };
  const CONTRACTS = [
    { id: 301, employeeCode: 'FE001', code: 'HD001', contractType: 'INDEFINITE', status: 'ACTIVE', startDate: '2024-01-01', endDate: '' },
    { id: 302, employeeCode: 'FE002', code: 'HD002', contractType: 'DEFINITE_12', status: 'TERMINATED', startDate: '2022-01-01', endDate: '2023-12-31' },
    { id: 303, employeeCode: 'FE003', code: 'HD003', contractType: 'INDEFINITE', status: 'DRAFT', startDate: '2026-01-01', endDate: '' }
  ];
  const LABOR_CONTRACT_TYPES = [
    { id: 'INDEFINITE', label: 'Không xác định thời hạn', order: 1 },
    { id: 'DEFINITE_12', label: 'Xác định thời hạn 12 tháng', order: 2 }
  ];
  const state = createMockState({ users: [HR], laborContracts: CONTRACTS, laborContractTypes: LABOR_CONTRACT_TYPES });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, HR);
    await page.evaluate(async () => { await switchTab('hrContract'); });
    await page.waitForTimeout(300);
    await page.selectOption('#hrcFilterContractType', 'INDEFINITE');
    await page.waitForTimeout(150);
    await shoot(page, '2-hopdong-laodong-bo-loc.png');
  } finally {
    await browser.close();
    server.close();
  }
}

async function demoHrLifecycle() {
  const PORT = 9103;
  const HR = { username: 'hr1', name: 'HR Onboarding', dept: 'Nhân Sự', perms: { hrOnboardingManage: true, hrOffboardingManage: true }, active: true, totpEnabled: true };
  const NV_B = { username: 'nv.b', name: 'Nguyễn Văn B', dept: 'Phòng Kế Toán', active: true, totpEnabled: true };
  const NV_C = { username: 'nv.c', name: 'Trần Thị C', dept: 'Phòng Kinh Doanh', active: true, totpEnabled: true };
  const PROFILES = [
    { employeeCode: 'FE010', username: null, status: 'ACTIVE', employmentType: 'Chính thức' },
    { employeeCode: 'FE011', username: null, status: 'ACTIVE', employmentType: 'Thời vụ' },
    { employeeCode: 'FE012', username: 'nv.b', status: 'ACTIVE', employmentType: 'Chính thức' },
    { employeeCode: 'FE013', username: 'nv.c', status: 'ACTIVE', employmentType: 'Thời vụ' }
  ];
  const CONTRACTS = [
    { id: 901, employeeCode: 'FE010', status: 'ACTIVE' },
    { id: 902, employeeCode: 'FE011', status: 'DRAFT' },
    { id: 903, employeeCode: 'FE012', status: 'TERMINATED' },
    { id: 904, employeeCode: 'FE013', status: 'ACTIVE' }
  ];
  const PROCESSES = [
    { id: 701, processType: 'ONBOARDING', employeeCode: 'FE010', fullName: 'Ứng Viên 10', status: 'IN_PROGRESS', employmentType: 'Chính thức', stage: 'PRE_BOARDING', tasks: [] },
    { id: 702, processType: 'ONBOARDING', employeeCode: 'FE011', fullName: 'Ứng Viên 11', status: 'IN_PROGRESS', stage: 'PRE_BOARDING', tasks: [] },
    { id: 703, processType: 'OFFBOARDING', employeeUsername: 'nv.b', fullName: 'Nguyễn Văn B', status: 'IN_PROGRESS', stage: 'NOTICE', tasks: [] },
    { id: 704, processType: 'OFFBOARDING', employeeUsername: 'nv.c', fullName: 'Trần Thị C', status: 'IN_PROGRESS', stage: 'NOTICE', tasks: [] }
  ];
  const state = createMockState({ users: [HR, NV_B, NV_C], employeeProfiles: PROFILES, laborContracts: CONTRACTS, hrProcesses: PROCESSES, employmentTypes: ['Chính thức', 'Thời vụ'] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 900 });
  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, HR);
    await page.evaluate(async () => { await switchTab('hrLifecycle'); });
    await page.waitForTimeout(300);
    await page.click('#btnToggleHrpListFilter');
    await page.waitForTimeout(400); // chờ danh bạ (employee-directory) tải xong
    await page.selectOption('#hrpListFilterEmploymentType', 'Chính thức');
    await page.waitForTimeout(200);
    await shoot(page, '3-onboarding-offboarding-bo-loc.png');
  } finally {
    await browser.close();
    server.close();
  }
}

async function demoOrgChartHeadcount() {
  const PORT = 9104;
  const REPORT = {
    rootLabel: 'Công Ty', rootStats: { quota: 100, actualTotal: 90, variance: 10 },
    rows: [
      { kind: 'GROUP1', sttLabel: 'I', label: 'Khối Vận Hành', quota: 50, actualTotal: 45, variance: 5 },
      { stt: 1, banPhong: 'Khối Vận Hành', banPhongBoPhan: 'Khối Vận Hành', boPhanNhom: '', chucDanh: 'Trưởng Khối', capBac: 'TK', maViTri: 'VT1', quota: 1, actualTotal: 1, variance: 0 },
      { kind: 'GROUP2', sttLabel: 'I.1', label: 'Phòng Kế Toán', quota: 10, actualTotal: 9, variance: 1 },
      { stt: 1, banPhong: 'Khối Vận Hành', banPhongBoPhan: 'Phòng Kế Toán', boPhanNhom: '', chucDanh: 'Kế Toán Viên', capBac: 'NV', maViTri: 'VT2', quota: 10, actualTotal: 9, variance: 1 },
      { kind: 'GROUP2', sttLabel: 'I.2', label: 'Phòng Kinh Doanh', quota: 39, actualTotal: 35, variance: 4 },
      { stt: 1, banPhong: 'Khối Vận Hành', banPhongBoPhan: 'Phòng Kinh Doanh', boPhanNhom: '', chucDanh: 'Nhân Viên Kinh Doanh', capBac: 'NV', maViTri: 'VT3', quota: 39, actualTotal: 35, variance: 4 },
      { kind: 'GROUP1', sttLabel: 'II', label: 'Khối Hành Chính', quota: 50, actualTotal: 45, variance: 5 },
      { kind: 'GROUP2', sttLabel: 'II.1', label: 'Phòng Nhân Sự', quota: 50, actualTotal: 45, variance: 5 },
      { stt: 1, banPhong: 'Khối Hành Chính', banPhongBoPhan: 'Phòng Nhân Sự', boPhanNhom: '', chucDanh: 'Chuyên Viên Nhân Sự', capBac: 'NV', maViTri: 'VT4', quota: 50, actualTotal: 45, variance: 5 }
    ]
  };
  const PUBLIC_DIR = path.join(__dirname, '..', 'public');
  const http = require('http');
  function contentType(fp) {
    const ext = path.extname(fp).toLowerCase();
    return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[ext] || 'application/octet-stream';
  }
  const server = await new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
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
    s.on('error', reject);
    s.listen(9105, '127.0.0.1', () => resolve(s));
  });
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://127.0.0.1:9105/index.html', { waitUntil: 'load' });
  try {
    await page.evaluate((reportFixture) => {
      window.alert = () => {}; window.confirm = () => true; window.prompt = () => '';
      const FAKE_VERSION = { id: 1, status: 'APPLIED', versionName: 'v1', nodes: [{ nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', displayOrder: 0 }] };
      window.fetch = async (url) => {
        const u = String(url);
        if (u === '/api/org-chart/versions') return { ok: true, status: 200, json: async () => ({ versions: [{ id: 1, status: 'APPLIED', versionName: 'v1' }] }) };
        if (u === '/api/org-chart/versions/1') return { ok: true, status: 200, json: async () => ({ version: FAKE_VERSION }) };
        if (/\/headcount-report$/.test(u)) return { ok: true, status: 200, json: async () => reportFixture };
        if (u === '/api/org-chart/kpi-flow') return { ok: true, status: 200, json: async () => ({ rows: [] }) };
        return { ok: true, status: 200, json: async () => ([]) };
      };
      Object.assign(DB, {
        depts: [], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
        jobTitles: [], storeJobTitles: [], positionTypes: [],
        users: [{ id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true, orgChartManage: true }, active: true, groupIds: [], permOverrides: null }],
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
        uniformCatalog: [], itTicketCategories: [], _versions: {}
      });
      finishLogin(DB.users[0]);
    }, REPORT);
    await page.waitForTimeout(200);
    await page.evaluate(() => { switchTab('orgChart'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => document.getElementById('btnOrgChartHeadcountReport').click());
    await page.waitForTimeout(300);
    await page.click('#btnToggleOrgChartHeadcountFilter');
    await page.waitForTimeout(100);
    await page.fill('#ocHeadcountFilterDept', 'Kế Toán');
    await page.waitForTimeout(200);
    await shoot(page, '4a-dinh-bien-bo-loc.png');
    // Thêm 1 ảnh: giải thích các cột ĐANG MỞ (để thấy rõ nội dung vẫn còn nguyên, chỉ thu gọn mặc định)
    await page.fill('#ocHeadcountFilterDept', '');
    await page.click('#btnToggleOrgChartHeadcountExplain');
    await page.waitForTimeout(150);
    await shoot(page, '4b-dinh-bien-giai-thich-mo.png');
    // 4c) MỚI: ô "🔍 Tìm Kiếm Nhanh" — gõ mã vị trí "VT3" (không thuộc cột Phòng Ban/Vị Trí đang gõ) vẫn
    // lọc ra đúng ngay, theo yêu cầu bổ sung của người dùng sau khi xem demo 4a/4b.
    await page.click('#btnToggleOrgChartHeadcountExplain');
    await page.fill('#ocHeadcountFilterQuick', 'VT3');
    await page.waitForTimeout(200);
    await shoot(page, '4c-dinh-bien-tim-kiem-nhanh.png');
  } finally {
    await browser.close();
    server.close();
  }
}

(async () => {
  await demoHrProfile();
  await demoHrContract();
  await demoHrLifecycle();
  await demoOrgChartHeadcount();
  console.log('\nTất cả ảnh demo đã lưu tại:', OUT_DIR);
})().catch((err) => { console.error('DEMO LỖI:', err); process.exit(1); });
