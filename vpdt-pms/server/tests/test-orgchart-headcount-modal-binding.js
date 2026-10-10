// server/tests/test-orgchart-headcount-modal-binding.js
//
// LỖI ĐÃ VÁ (10/2026, người dùng báo "mở Báo Cáo Định Biên Nhân Sự ra lại không đóng được"):
// #orgChartHeadcountModal là 1 <div> gốc ĐỘC LẬP sống NGOÀI #orgChartSection trong index.html (giống
// orgChartNodeModal/orgChartApplyResultModal/orgChartDiffModal/orgChartImportModal) nhưng CHƯA TỪNG
// được gọi bindCspDelegation('orgChartHeadcountModal') (bị bỏ sót lúc thêm tính năng này, khác với 4
// modal kia đã có đủ — xem core.js, cụm bindCspDelegation() ngay dưới comment "Cơ Cấu Tổ Chức v2").
// Nút mở modal (data-op="openOrgChartHeadcountModal") nằm BÊN TRONG #orgChartSection (đã bind) nên mở
// được bình thường — nhưng cả 2 nút đóng (✕ góc trên + "Đóng" ở chân modal, cùng
// data-op="closeOrgChartHeadcountModal") nằm BÊN TRONG modal (ngoài #orgChartSection) nên không có
// listener nào bắt được click, "treo" đúng như người dùng mô tả.
//
// Test THẬT qua UI (Chromium thật + index.html/module-orgchart.js thật, chỉ stub window.fetch) — đi
// đúng đường người dùng gặp lỗi: mở tab Cơ Cấu Tổ Chức -> bấm "📋 Báo Cáo Định Biên Nhân Sự" -> bấm
// đóng ở CẢ 2 nút. Dựng theo đúng khuôn tests/test-orgchart-import-modal-binding.js (cùng lớp lỗi).
//
// Chạy: node server/tests/test-orgchart-headcount-modal-binding.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

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

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function main() {
  const PORT = 9850 + Math.floor(Math.random() * 100);
  const server = await startStaticServer(PORT);

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.alert = () => {};
    window.confirm = () => true;
    window.prompt = () => '';

    const FAKE_VERSION = {
      id: 1, status: 'APPLIED', versionName: 'v1',
      nodes: [{ nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', displayOrder: 0 }]
    };
    window.fetch = async (url) => {
      const u = String(url);
      if (u === '/api/org-chart/versions') {
        return { ok: true, status: 200, json: async () => ({ versions: [{ id: 1, status: 'APPLIED', versionName: 'v1' }] }) };
      }
      if (u === '/api/org-chart/versions/1') {
        return { ok: true, status: 200, json: async () => ({ version: FAKE_VERSION }) };
      }
      if (/\/headcount-report$/.test(u)) {
        return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      }
      if (u === '/api/org-chart/kpi-flow') {
        return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: [], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], positionTypes: [], users: [
        { id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }
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

  // Điều hướng THẬT vào tab Cơ Cấu Tổ Chức (trigger loadModuleGroup() + bindCspDelegation('orgChartSection')
  // qua đúng luồng thật).
  await page.evaluate(() => switchTab('orgChart'));
  await page.waitForTimeout(300);

  const btnExists = await page.evaluate(() => !!document.getElementById('btnOrgChartHeadcountReport'));
  record('setup: nút "📋 Báo Cáo Định Biên Nhân Sự" tồn tại trên UI thật', btnExists);
  if (!btnExists) { record('DỪNG SỚM — không tìm thấy nút mở modal', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===== 1. Bấm nút mở modal (nằm trong #orgChartSection ĐÃ bind) =====
  await page.evaluate(() => document.getElementById('btnOrgChartHeadcountReport').click());
  await page.waitForTimeout(150);
  const modalVisibleAfterOpen = await page.evaluate(() => !document.getElementById('orgChartHeadcountModal').classList.contains('hidden'));
  record('Bấm nút -> modal #orgChartHeadcountModal hiện ra', modalVisibleAfterOpen);

  // ===== 2. TRỌNG TÂM của lỗi: nút ✕ góc trên (data-op="closeOrgChartHeadcountModal", đầu modal) =====
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#orgChartHeadcountModal [data-op="closeOrgChartHeadcountModal"]')];
    btns[0].click();
  });
  await page.waitForTimeout(100);
  const closedByX = await page.evaluate(() => document.getElementById('orgChartHeadcountModal').classList.contains('hidden'));
  record('Bấm nút ✕ (góc trên modal) -> modal đóng lại (trước khi vá: KHÔNG phản hồi gì, "treo")', closedByX);

  // ===== 3. Mở lại rồi đóng bằng nút "Đóng" ở chân modal (data-op CÙNG TÊN, vị trí khác) =====
  await page.evaluate(() => document.getElementById('btnOrgChartHeadcountReport').click());
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#orgChartHeadcountModal [data-op="closeOrgChartHeadcountModal"]')];
    btns[btns.length - 1].click();
  });
  await page.waitForTimeout(100);
  const closedByFooterButton = await page.evaluate(() => document.getElementById('orgChartHeadcountModal').classList.contains('hidden'));
  record('Bấm nút "Đóng" (chân modal) -> modal cũng đóng lại', closedByFooterButton);

  record('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();
  finish();
}

function finish() {
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log('');
  console.log(`${passed}/${total} scenarios passed.`);
  if (passed !== total) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
