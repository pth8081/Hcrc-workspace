// server/tests/test-orgchart-headcount-import-modal-binding.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo kèm ảnh chụp: "Nhập excel ở phần báo cáo định biên nhân sự các nút
// này đang không khả dụng, có thể lỗi cps bạn kiểm tra lại" — khoanh đỏ cả nút ✕ góc trên lẫn "Đóng"/"Nhập"
// ở chân modal "📤 Nhập Định Biên"):
//
// #orgChartHeadcountImportModal là 1 <div> gốc ĐỘC LẬP sống NGOÀI #orgChartSection trong index.html —
// CÙNG LỚP LỖI với #orgChartHeadcountModal đã vá ở test-orgchart-headcount-modal-binding.js (10/2026), lần
// này lọt qua chính đợt vá đó vì modal con này được thêm CÙNG lúc nhưng bindCspDelegation() chỉ được gọi
// cho #orgChartHeadcountModal (modal CHA), không gọi cho #orgChartHeadcountImportModal (modal CON — mở từ
// nút "📤 Nhập Định Biên" BÊN TRONG modal cha). Nút mở modal con nằm bên trong gốc ĐÃ bind (modal cha) nên
// mở được bình thường — dễ gây hiểu lầm cả modal "hoạt động tốt" — nhưng 3 nút BÊN TRONG modal con (✕,
// "Đóng", "Nhập", data-op="closeOrgChartHeadcountImportModal"/"submitOrgChartHeadcountImport") không nằm
// trong bất kỳ gốc nào đã bindCspDelegation() nên không có listener nào bắt được click — đúng mô tả "các
// nút này đang không khả dụng" của người dùng, không phải modal bị khoá/treo logic thật sự.
//
// Test THẬT qua UI (Chromium thật + index.html/module-orgchart.js thật, chỉ stub window.fetch) — dựng
// theo đúng khuôn tests/test-orgchart-headcount-modal-binding.js (cùng lớp lỗi, cùng cách tái hiện).
//
// Chạy: node server/tests/test-orgchart-headcount-import-modal-binding.js
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
  const PORT = 9750 + Math.floor(Math.random() * 100);
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
      id: 1, status: 'DRAFT', versionName: 'v1',
      nodes: [{ nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', displayOrder: 0 }]
    };
    window.fetch = async (url) => {
      const u = String(url);
      if (u === '/api/org-chart/versions') {
        return { ok: true, status: 200, json: async () => ({ versions: [{ id: 1, status: 'DRAFT', versionName: 'v1' }] }) };
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

  // ===== Mở modal cha "📋 Báo Cáo Định Biên Nhân Sự" (đã bind, phải hoạt động bình thường) =====
  const btnExists = await page.evaluate(() => !!document.getElementById('btnOrgChartHeadcountReport'));
  record('setup: nút "📋 Báo Cáo Định Biên Nhân Sự" tồn tại trên UI thật', btnExists);
  if (!btnExists) { record('DỪNG SỚM — không tìm thấy nút mở modal cha', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }
  await page.evaluate(() => document.getElementById('btnOrgChartHeadcountReport').click());
  await page.waitForTimeout(150);
  const parentOpen = await page.evaluate(() => !document.getElementById('orgChartHeadcountModal').classList.contains('hidden'));
  record('Bấm nút -> modal cha #orgChartHeadcountModal hiện ra', parentOpen);

  // ===== TRỌNG TÂM của lỗi: bấm "📤 Nhập Định Biên" mở modal con =====
  await page.evaluate(() => document.getElementById('btnOrgChartHeadcountImport').click());
  await page.waitForTimeout(150);
  const importOpen = await page.evaluate(() => !document.getElementById('orgChartHeadcountImportModal').classList.contains('hidden'));
  record('Bấm "📤 Nhập Định Biên" -> modal con #orgChartHeadcountImportModal hiện ra', importOpen);

  // ===== Nút ✕ góc trên modal con (trước khi vá: KHÔNG phản hồi gì, "treo") =====
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#orgChartHeadcountImportModal [data-op="closeOrgChartHeadcountImportModal"]')];
    btns[0].click();
  });
  await page.waitForTimeout(100);
  const closedByX = await page.evaluate(() => document.getElementById('orgChartHeadcountImportModal').classList.contains('hidden'));
  record('Bấm nút ✕ (góc trên modal con) -> modal đóng lại', closedByX);

  // ===== Mở lại, đóng bằng nút "Đóng" ở chân modal con =====
  await page.evaluate(() => document.getElementById('btnOrgChartHeadcountImport').click());
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#orgChartHeadcountImportModal [data-op="closeOrgChartHeadcountImportModal"]')];
    btns[btns.length - 1].click();
  });
  await page.waitForTimeout(100);
  const closedByFooterButton = await page.evaluate(() => document.getElementById('orgChartHeadcountImportModal').classList.contains('hidden'));
  record('Bấm nút "Đóng" (chân modal con) -> modal cũng đóng lại', closedByFooterButton);

  // ===== Mở lại, bấm "Nhập" KHÔNG chọn file -> phải THỰC SỰ dispatch được submitOrgChartHeadcountImport() =====
  await page.evaluate(() => document.getElementById('btnOrgChartHeadcountImport').click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.getElementById('orgChartHeadcountImportModal').querySelector('[data-op="submitOrgChartHeadcountImport"]').click());
  await page.waitForTimeout(100);
  const resultText = await page.evaluate(() => document.getElementById('orgChartHeadcountImportResult').textContent);
  record(
    'Bấm "Nhập" (chưa chọn file) -> submitOrgChartHeadcountImport() THỰC SỰ chạy, hiện đúng cảnh báo "Vui lòng chọn file"',
    resultText.includes('Vui lòng chọn file'),
    resultText
  );

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
