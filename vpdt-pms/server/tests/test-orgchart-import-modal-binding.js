// server/tests/test-orgchart-import-modal-binding.js
//
// LỖI ĐÃ VÁ (10/2026, người dùng báo "định vị nhân sự" — thực chất là Nhân Sự > Cơ Cấu Tổ Chức —
// bấm "Nhập Excel (Bản Nháp Mới)" thì mở được modal, chọn file xong KHÔNG có tác dụng gì, modal "treo"
// không bấm được gì tiếp): #orgChartImportModal là 1 <div> gốc ĐỘC LẬP sống NGOÀI #orgChartSection
// trong index.html (giống orgChartNodeModal/orgChartApplyResultModal/orgChartDiffModal) nhưng CHƯA
// TỪNG được gọi bindCspDelegation('orgChartImportModal') (xem core.js, cụm 4 bindCspDelegation() ngay
// dưới comment "Cơ Cấu Tổ Chức v2") — nút "✕ Hủy"/"✅ Tạo Bản Nháp Mới Từ File" (data-op) và ô chọn file
// #orgChartImportFileInput (data-op-change) bên trong modal này đều KHÔNG có listener nào bắt được sự
// kiện, nên không hề "treo" theo nghĩa bị khoá — chỉ đơn giản không ai lắng nghe cả. Dialog chọn file
// của OS vẫn mở được (hành vi gốc trình duyệt, không qua CSP/JS) đúng với mô tả "mở được nhưng chọn
// file không tác động gì".
//
// Test THẬT qua UI (Chromium thật + index.html/module-orgchart.js thật, chỉ stub window.fetch) — đi
// đúng đường người dùng gặp lỗi: bấm nút mở modal -> chọn file thật qua input -> xác nhận modal PHẢN
// HỒI (status đổi, nút Xác Nhận hiện ra) thay vì im lặng. Dựng theo đúng khuôn
// tests/test-orgchart-diagram-tab.js (static server phục vụ public/, stub fetch cho API org-chart).
//
// Chạy: node server/tests/test-orgchart-import-modal-binding.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const os = require('os');
const ExcelJS = require('exceljs');

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

async function buildSampleXlsx(filePath) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Cơ Cấu Tổ Chức');
  sheet.columns = [
    { header: 'Mã Node (*)', key: 'nodeKey' },
    { header: 'Mã Node Cha', key: 'parentKey' },
    { header: 'Loại Node (*) (Công Ty/Phòng Ban/Vị Trí)', key: 'nodeTypeLabel' },
    { header: 'Tên (Công Ty/Phòng Ban)', key: 'nodeName' },
    { header: 'Mã Phòng Ban Hệ Thống (Phòng Ban, tuỳ chọn)', key: 'departmentRef' },
    { header: 'Chức Danh (Vị Trí)', key: 'jobTitle' },
    { header: 'Yêu Cầu Phòng Ban (Vị Trí, Có/Không)', key: 'requiresDeptLabel' },
    { header: 'Vị Trí Làm Việc (Vị Trí, HO/STORE, tuỳ chọn)', key: 'posType' },
    { header: 'Cấp Bậc (Vị Trí, tuỳ chọn)', key: 'jobGrade' },
    { header: 'Thứ Tự Hiển Thị (tuỳ chọn)', key: 'displayOrder' }
  ];
  sheet.addRow({ nodeKey: 'CT', parentKey: '', nodeTypeLabel: 'Công Ty', nodeName: 'Công Ty ABC' });
  await wb.xlsx.writeFile(filePath);
}

async function main() {
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const sampleFile = path.join(os.tmpdir(), `orgchart-import-test-${Date.now()}.xlsx`);
  await buildSampleXlsx(sampleFile);

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => '';

    window.fetch = async (url) => {
      const u = String(url);
      if (u === '/api/org-chart/versions') {
        return { ok: true, status: 200, json: async () => ({ versions: [] }) };
      }
      if (u === '/api/org-chart/parse-import') {
        return {
          ok: true, status: 200,
          json: async () => ({
            fileName: 'orgchart-import-test.xlsx',
            valid: true,
            fileErrors: [],
            items: [{ nodeKey: 'CT', parentKey: null, nodeType: 'COMPANY', nodeTypeLabel: 'Công Ty', nodeName: 'Công Ty ABC', valid: true, errors: [] }]
          })
        };
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
  // qua đúng luồng thật, giống người dùng thật).
  await page.evaluate(() => switchTab('orgChart'));
  await page.waitForTimeout(300);

  const btnExists = await page.evaluate(() => !!document.getElementById('btnOrgChartImportExcel'));
  record('setup: nút "📤 Nhập Excel (Bản Nháp Mới)" tồn tại trên UI thật', btnExists);
  if (!btnExists) { record('DỪNG SỚM — không tìm thấy nút mở modal', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); fs.unlinkSync(sampleFile); return finish(); }

  // ===== 1. Bấm nút mở modal (data-op="openOrgChartImportModal", nằm trong #orgChartSection ĐÃ bind) =====
  await page.evaluate(() => document.getElementById('btnOrgChartImportExcel').click());
  await page.waitForTimeout(100);
  const modalVisible = await page.evaluate(() => !document.getElementById('orgChartImportModal').classList.contains('hidden'));
  record('Bấm nút -> modal #orgChartImportModal hiện ra', modalVisible);

  // ===== 2. Chọn file THẬT qua đúng input (mô phỏng chính xác thao tác người dùng mô tả) =====
  await page.setInputFiles('#orgChartImportFileInput', sampleFile);
  await page.waitForTimeout(200);

  // TRỌNG TÂM của lỗi: nếu #orgChartImportModal chưa được bindCspDelegation(), sự kiện 'change' ở trên
  // không có listener nào bắt -> statusEl.innerText vẫn rỗng mãi (đúng cảm giác "treo", chọn file không
  // tác động gì người dùng mô tả). Sau khi vá, listener bắt được -> gọi onOrgChartImportFileChange() ->
  // fetch /api/org-chart/parse-import (đã stub ở trên) -> status cập nhật + hiện khối xem trước + nút Xác Nhận.
  const afterPick = await page.evaluate(() => ({
    status: document.getElementById('orgChartImportStatus').innerText,
    previewVisible: !document.getElementById('orgChartImportPreviewWrap').classList.contains('hidden'),
    confirmWrapVisible: !document.getElementById('orgChartImportConfirmWrap').classList.contains('hidden')
  }));
  record('Chọn file -> #orgChartImportStatus CÓ cập nhật (không còn rỗng/treo)', afterPick.status.length > 0, `status thực tế: "${afterPick.status}"`);
  record('Chọn file hợp lệ -> khối xem trước (preview) hiện ra', afterPick.previewVisible);
  record('Chọn file hợp lệ -> khối xác nhận (nút "Tạo Bản Nháp Mới Từ File") hiện ra', afterPick.confirmWrapVisible);

  // ===== 3. Nút "✕ Hủy" (data-op="closeOrgChartImportModal") trong modal cũng phải phản hồi được =====
  await page.evaluate(() => document.querySelector('#orgChartImportModal [data-op="closeOrgChartImportModal"]').click());
  await page.waitForTimeout(100);
  const modalClosedAfterCancel = await page.evaluate(() => document.getElementById('orgChartImportModal').classList.contains('hidden'));
  record('Bấm "✕ Hủy" trong modal -> modal đóng lại (nút data-op trong modal có phản hồi)', modalClosedAfterCancel);

  record('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();
  fs.unlinkSync(sampleFile);
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
