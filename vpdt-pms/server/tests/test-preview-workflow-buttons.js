// server/tests/test-preview-workflow-buttons.js
//
// Regression cho tính năng "🔍 Xem Quy Trình" (preview quy trình phê duyệt trước khi nộp hồ sơ) vừa
// thêm cho 9 module trước đây KHÔNG có (Tài Liệu, Đăng Ký Xe, Mua Sắm/Sửa Chữa VP, VPP, Hợp Đồng - Quản
// Lý HĐ, Thanh Toán, Phê Duyệt Giá [Bán Lẻ + Bán Buôn], Ngân Sách [ĐÃ BỎ khỏi bộ test — v23.0, module
// Ngân Sách thiết kế lại không còn dept-workflow], Vận Hành - Đặt Hàng) — cùng cơ chế
// `#viewDocModal` mà Văn Bản Trình/Hợp Đồng Phê Duyệt đã có sẵn từ trước (buildGenericDeptWorkflowPreviewHTML()/
// openGenericWorkflowPreviewModal(), core.js).
//
// Dựng lại đúng khuôn tests/test-lazy-load-all-tabs.js (static server phục vụ public/ + Chromium thật,
// điều hướng THẬT bằng click DOM để trigger đúng loadModuleGroup() nạp từng file module-*.js) — sau khi
// vào đúng tab, set giá trị phòng ban/tier rồi BẤM THẬT nút "🔍 Xem Quy Trình", đọc nội dung
// #viewDocModal để xác nhận đúng bước/người duyệt được hiển thị, và xác nhận model trả về đúng cảnh báo
// khi chưa chọn phòng ban/tier hoặc khi phòng ban/tier đó chưa được admin cấu hình.
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
  const PORT = 9500 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
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
    // realFetch (v23.10): mirror test-csp-full-audit.js — loadTabSectionHtml() (core.js,
    // TAB_SECTION_FRAGMENT) fetch() khung HTML tách lười (vd /fragments/vanHanhSection.html) từ CHÍNH
    // server tĩnh của bài test này, phải đi qua fetch THẬT thay vì bị mock như /api/*.
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && !url.startsWith('/api/')) return realFetch(url, opts);
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      if (method === 'GET') return { ok: true, status: 200, json: async () => ([]) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    Object.assign(DB, {
      depts: ['Phòng A', 'Phòng B'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], submissionTypes: [], contractTypes: ['Kinh tế'], carTypes: [],
      uniformCatalog: [], itTicketCategories: [],
      workflows: [
        { id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }] },
        { id: 'WF_2STEP', name: 'Quy trình 2 bước', steps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }] }
      ],
      // Tài liệu: Phòng A cấu hình 1 bước với người duyệt "doc1"; Phòng B chưa cấu hình gì.
      deptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approvers: { 1: ['doc1'] } } },
      docs: [], submissions: [], submissionApprovalGroups: [], submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {},
      contracts: [], contractApprovalGroups: [],
      // Hợp Đồng: Phê Duyệt (Phòng A, 1 bước, "hd_approval1") KHÁC HẲN Quản Lý HĐ (Phòng A, 2 bước, "hd_manage1").
      contractApprovalDeptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approvers: { 1: ['hd_approval1'] } } },
      contractManageDeptWorkflows: { 'Phòng A': { workflowId: 'WF_2STEP', approvers: { 1: ['hd_manage1'], 2: ['hd_manage2'] } } },
      meetings: [], meetingMinutes: [], meetingAttendeeTemplates: [],
      // Đăng Ký Xe: Phòng A cấu hình, Phòng B thì không.
      carRegs: [], carDeptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approvers: { 1: ['car1'] } } },
      // Mua Sắm/Sửa Chữa dùng CHUNG form nhưng 2 dbKey khác nhau — cấu hình khác nhau để phân biệt đúng nhánh.
      officeReqs: [],
      officeBuyDeptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approvers: { 1: ['buy1'] } } },
      officeFixDeptWorkflows: { 'Phòng A': { workflowId: 'WF_2STEP', approvers: { 1: ['fix1'], 2: ['fix2'] } } },
      tasks: [], internalPosts: [], internalNewsCategories: [], internalShareCategories: [],
      trainingCategories: [], trainingDocuments: [], trainingClasses: [], trainingRegistrations: [],
      careerPaths: [], careerPathConfirmations: [], trainingTests: [], trainingTestSubmissions: [],
      trainingCourses: [], trainingPlans: [], onboardingPaths: [], onboardingProgress: [],
      recruitmentJobs: [], recruitmentReferrals: [], hrFeedback: [], sensitiveKeywords: [],
      paymentRequests: [], paymentDeptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approvers: { 1: ['pay1'] } } },
      formTemplates: {}, permGroups: [], users: [
        { id: 100, username: 'doc1', name: 'Người Duyệt Tài Liệu', dept: 'Phòng A', perms: {}, active: true },
        { id: 101, username: 'hd_approval1', name: 'Người Duyệt HĐ Phê Duyệt', dept: 'Phòng A', perms: {}, active: true },
        { id: 102, username: 'hd_manage1', name: 'Người Duyệt Tài Liệu Ký 1', dept: 'Phòng A', perms: {}, active: true },
        { id: 103, username: 'hd_manage2', name: 'Người Duyệt Tài Liệu Ký 2', dept: 'Phòng A', perms: {}, active: true },
        { id: 104, username: 'car1', name: 'Người Duyệt Xe', dept: 'Phòng A', perms: {}, active: true },
        { id: 105, username: 'buy1', name: 'Người Duyệt Mua Sắm', dept: 'Phòng A', perms: {}, active: true },
        { id: 106, username: 'fix1', name: 'Người Duyệt Sửa Chữa 1', dept: 'Phòng A', perms: {}, active: true },
        { id: 107, username: 'fix2', name: 'Người Duyệt Sửa Chữa 2', dept: 'Phòng A', perms: {}, active: true },
        { id: 108, username: 'vpp1', name: 'Người Duyệt VPP', dept: 'Phòng A', perms: {}, active: true },
        { id: 109, username: 'pay1', name: 'Người Duyệt Thanh Toán', dept: 'Phòng A', perms: {}, active: true },
        { id: 110, username: 'itretail1', name: 'Người Duyệt Giá Bán Lẻ', dept: 'Phòng A', perms: {}, active: true },
        { id: 111, username: 'itwholesale1', name: 'Người Duyệt Giá Bán Buôn', dept: 'Phòng A', perms: {}, active: true },
        { id: 112, username: 'budget1', name: 'Người Duyệt Ngân Sách', dept: 'Phòng A', perms: {}, active: true },
        { id: 113, username: 'oostore1', name: 'Người Duyệt Đặt Hàng Siêu Thị', dept: 'Phòng A', perms: {}, active: true }
      ],
      vppExcludeGroups: [], vppExcludedJobTitles: [], workflowParticipatingDepts: [], workflowParticipatingPositions: [],
      pwaShortcutModules: [], itPriceMasterLists: [],
      itPriceDeptWorkflows: { 'Phòng A': { RETAIL: { workflowId: 'WF_1STEP', approvers: { 1: ['itretail1'] } } } },
      itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'WF_1STEP', approvers: { 1: ['itwholesale1'] } } },
      uploadFileTypeConfig: {}, uploadSizeLimitConfig: {}, emailConfig: {}, systemLogs: [], externalApiKeys: [],
      // VPP: forceOwnDept=true (không có ô chọn phòng ban), luôn dùng currentUser.dept = 'Phòng A'.
      vppRegistrations: [], vppDeptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approvers: { 1: ['vpp1'] } } }, vppPeriods: [],
      itPriceApprovals: [], itServiceRenewals: [], itSupportTickets: [],
      budgetEntries: [], budgetDeptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approvers: { 1: ['budget1'] } } },
      budgetTemplates: [], budgetPeriods: [],
      reportPeriods: [], reportEntries: [], licenses: [], licenseTypes: [],
      // Người duyệt "Đặt Hàng Tại Siêu Thị" nay tra từ operationOrderStoreMixedApprovalRules ("Quy Trình
      // Hỗn Hợp", đợt 10/2026) — operationOrderStoreTierWorkflows[...].approvers KHÔNG còn được đọc cho
      // STORE nữa, chỉ workflowId (số bước) là còn tác dụng.
      operationOrders: [], operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
      operationOrderHOTierWorkflows: {},
      operationOrderStoreMixedApprovalRules: [{ id: 1, step: 1, mode: 'PERSON', username: 'oostore1', stores: [] }],
      operationStoreOpenings: [], operationStoreOpenDeptWorkflows: {},
      operationRepairs: [], operationRepairDeptWorkflows: {},
      operationWorkItems: [], operationExecutionPeriods: [], orgChartManagerOverrides: {},
      _versions: {}
    });

    const adminUser = {
      id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng A', jobTitle: 'Nhân viên',
      email: 'admin@test.local', phone: '0900000000',
      perms: { admin: true, itPriceProposeCreateWholesale: true, itPriceProposeCreateRetail: true }, groupIds: [], permOverrides: null
    };
    DB.users.push(adminUser);
    finishLogin(adminUser);
  });

  async function gotoTab(toggleSel, clickSel) {
    if (toggleSel) await page.evaluate((sel) => document.querySelector(sel)?.click(), toggleSel);
    await page.waitForTimeout(60);
    await page.evaluate((sel) => document.querySelector(sel)?.click(), clickSel);
    await page.waitForTimeout(150);
  }

  async function readModal() {
    return page.evaluate(() => ({
      hidden: document.getElementById('viewDocModal').classList.contains('hidden'),
      title: document.getElementById('viewModalTitle').innerText,
      content: document.getElementById('viewModalContent').innerHTML,
      alerts: window.__alerts.slice()
    }));
  }
  async function closeModalAndClearAlerts() {
    await page.evaluate(() => {
      document.getElementById('viewDocModal').classList.add('hidden');
      window.__alerts = [];
    });
  }

  // ===== 1) Tài Liệu =====
  await gotoTab(null, '[data-op="switchTab"][data-arg0="doc"]');
  await page.evaluate(() => { document.getElementById('selDept').value = 'Phòng A'; });
  await page.evaluate((fn) => window.ensureFnReady ? ensureFnReady(fn) : null, 'previewDocWorkflow');
  await page.evaluate(() => document.getElementById('docPreviewWfBtn')?.click());
  await page.waitForTimeout(400);
  let modal = await readModal();
  record('Tài Liệu: bấm "Xem Quy Trình" (Phòng A, đã cấu hình) -> modal hiện đúng người duyệt "doc1"', !modal.hidden && modal.content.includes('Người Duyệt Tài Liệu'), JSON.stringify(modal));
  await closeModalAndClearAlerts();
  await page.evaluate(() => { document.getElementById('selDept').value = 'Phòng B'; });
  await page.evaluate((fn) => window.ensureFnReady ? ensureFnReady(fn) : null, 'previewDocWorkflow');
  await page.evaluate(() => document.getElementById('docPreviewWfBtn')?.click());
  await page.waitForTimeout(400);
  modal = await readModal();
  record('Tài Liệu: Phòng B (chưa cấu hình) -> modal hiện đúng cảnh báo "chưa được cấu hình"', !modal.hidden && modal.content.includes('chưa được cấu hình'), JSON.stringify(modal));
  await closeModalAndClearAlerts();

  // ===== 2) Đăng Ký Xe =====
  await gotoTab('#btnHanhChinhTab', '#btnCarTab');
  await page.evaluate(() => { document.getElementById('carDept').value = 'Phòng A'; });
  await page.evaluate((fn) => window.ensureFnReady ? ensureFnReady(fn) : null, 'previewCarWorkflow');
  await page.evaluate(() => document.getElementById('carPreviewWfBtn')?.click());
  await page.waitForTimeout(400);
  modal = await readModal();
  record('Đăng Ký Xe: modal hiện đúng người duyệt "car1"', !modal.hidden && modal.content.includes('Người Duyệt Xe'), JSON.stringify(modal));
  await closeModalAndClearAlerts();

  // ===== 3) VPP (forceOwnDept, không có ô chọn phòng ban) =====
  await gotoTab('#btnHanhChinhTab', '#btnVppTab');
  await page.evaluate((fn) => window.ensureFnReady ? ensureFnReady(fn) : null, 'previewVppWorkflow');
  await page.evaluate(() => document.getElementById('vppPreviewWfBtn')?.click());
  await page.waitForTimeout(400);
  modal = await readModal();
  record('VPP: dùng thẳng currentUser.dept ("Phòng A"), modal hiện đúng người duyệt "vpp1"', !modal.hidden && modal.content.includes('Người Duyệt VPP'), JSON.stringify(modal));
  await closeModalAndClearAlerts();

  // ===== 4+5) Mua Sắm / Sửa Chữa (dùng chung form, 2 dbKey khác nhau) =====
  await gotoTab('#btnTongHopTab', '#btnOfficeSubBuyNav');
  await page.evaluate(() => { document.getElementById('offDept').value = 'Phòng A'; });
  await page.evaluate((fn) => window.ensureFnReady ? ensureFnReady(fn) : null, 'previewOfficeWorkflow');
  await page.evaluate(() => document.getElementById('officePreviewWfBtn')?.click());
  await page.waitForTimeout(400);
  modal = await readModal();
  record('Mua Sắm VP: modal hiện đúng người duyệt "buy1" (officeBuyDeptWorkflows)', !modal.hidden && modal.content.includes('Người Duyệt Mua Sắm'), JSON.stringify(modal));
  await closeModalAndClearAlerts();

  await gotoTab('#btnTongHopTab', '#btnOfficeSubFixNav');
  await page.evaluate(() => { document.getElementById('offDept').value = 'Phòng A'; });
  await page.evaluate((fn) => window.ensureFnReady ? ensureFnReady(fn) : null, 'previewOfficeWorkflow');
  await page.evaluate(() => document.getElementById('officePreviewWfBtn')?.click());
  await page.waitForTimeout(400);
  modal = await readModal();
  record('Sửa Chữa VP: modal hiện đúng người duyệt "fix1"+"fix2" (officeFixDeptWorkflows, KHÁC officeBuyDeptWorkflows)', !modal.hidden && modal.content.includes('Người Duyệt Sửa Chữa 1') && modal.content.includes('Người Duyệt Sửa Chữa 2'), JSON.stringify(modal));
  await closeModalAndClearAlerts();

  // ===== 6) Thanh Toán =====
  await gotoTab('#btnTongHopTab', '#btnOfficeSubPaymentNav');
  await page.evaluate(() => { document.getElementById('paymentDept').value = 'Phòng A'; });
  await page.evaluate((fn) => window.ensureFnReady ? ensureFnReady(fn) : null, 'previewPaymentWorkflow');
  await page.evaluate(() => document.getElementById('paymentPreviewWfBtn')?.click());
  await page.waitForTimeout(400);
  modal = await readModal();
  record('Thanh Toán: modal hiện đúng người duyệt "pay1"', !modal.hidden && modal.content.includes('Người Duyệt Thanh Toán'), JSON.stringify(modal));
  await closeModalAndClearAlerts();

  // ===== 7) Ngân Sách — ĐÃ BỎ (v23.0) =====
  // Module Ngân Sách thiết kế lại theo tài liệu "Ngân sách 2.0" (xem module-ngansach.js): budgetLines
  // không còn dùng workflowEngine.js/dept-workflow nữa (chỉ 1 cấp gác permission phẳng budgetCreate/
  // budgetManage), nên không còn nút "Xem Trước Quy Trình" nào cho Ngân Sách — WF_MODULE_CONFIG.BUDGET
  // cũng đã bỏ (module-workflow.js). Kịch bản này xoá khỏi bộ test.

  // ===== 8+9) Phê Duyệt Giá (Bán Lẻ + Bán Buôn) — 10/2026, TÁCH KHỎI Hỗ Trợ IT: đề xuất Bán Lẻ giờ tạo
  // ở Mua Hàng (nút previewMhItPriceWorkflow riêng, id mhItPricePreviewWfBtn), đề xuất Bán Buôn tạo ở
  // Vận Hành (nút previewItPriceWorkflow GIỮ NGUYÊN, id itPricePreviewWfBtn không đổi — chỉ đổi trang
  // sống). Hỗ Trợ IT giờ CHỈ còn danh sách/xử lý, không còn nút "Xem Quy Trình" nào ở đó nữa.
  await gotoTab('#btnMuaHangTab', '#btnMuaHangBasNav');
  await page.evaluate(() => document.getElementById('btnMhSubItPrice')?.click());
  await page.waitForTimeout(80);
  await page.evaluate((fn) => window.ensureFnReady ? ensureFnReady(fn) : null, 'previewMhItPriceWorkflow');
  await page.evaluate(() => document.getElementById('mhItPricePreviewWfBtn')?.click());
  await page.waitForTimeout(400);
  modal = await readModal();
  record('Phê Duyệt Giá (Bán Lẻ, Mua Hàng): modal hiện đúng người duyệt "itretail1"', !modal.hidden && modal.content.includes('Người Duyệt Giá Bán Lẻ'), JSON.stringify(modal));
  await closeModalAndClearAlerts();

  await gotoTab('#btnVanHanhTab', '#btnOperationOrderNav');
  await page.evaluate(() => document.getElementById('btnVanHanhSubItPrice')?.click());
  await page.waitForTimeout(80);
  await page.evaluate(() => { const t = document.getElementById('itPriceTier'); if (t) t.value = 'MARGIN_LT5'; });
  await page.evaluate((fn) => window.ensureFnReady ? ensureFnReady(fn) : null, 'previewItPriceWorkflow');
  await page.evaluate(() => document.getElementById('itPricePreviewWfBtn')?.click());
  await page.waitForTimeout(400);
  modal = await readModal();
  record('Phê Duyệt Giá (Bán Buôn, Vận Hành): modal hiện đúng người duyệt "itwholesale1" (KHÁC nhánh Bán Lẻ)', !modal.hidden && modal.content.includes('Người Duyệt Giá Bán Buôn'), JSON.stringify(modal));
  await closeModalAndClearAlerts();

  // ===== 10) Vận Hành - Đặt Hàng (tier suy ra từ tổng giá trị đơn hàng đang nhập dở) =====
  await gotoTab('#btnVanHanhTab', '#btnOperationOrderNav');
  await page.evaluate(() => document.getElementById('btnOpOrderSubSTORE')?.click());
  await page.waitForTimeout(80);
  // Chưa nhập hạng mục nào -> phải bị chặn bằng alert, KHÔNG mở modal.
  await page.evaluate((fn) => window.ensureFnReady ? ensureFnReady(fn) : null, 'previewOperationOrderWorkflow');
  await page.evaluate(() => document.getElementById('operationOrderPreviewWfBtn')?.click());
  await page.waitForTimeout(400);
  let alertsSoFar = await page.evaluate(() => window.__alerts.slice());
  modal = await readModal();
  record('Vận Hành Đặt Hàng: CHƯA nhập hạng mục nào -> bị chặn bằng alert, KHÔNG mở modal', modal.hidden && alertsSoFar.some(a => a.includes('hạng mục')), JSON.stringify({ alertsSoFar, modal }));
  await closeModalAndClearAlerts();
  // Điền voPaymentTotalAmount (đường tắt đơn giản nhất để đẩy effectiveAmount lên mà không cần dựng
  // bảng hạng mục động — computeOperationOrderAmountClient() lấy MAX(amount, paymentTotalAmount)).
  const paymentTotalExists = await page.evaluate(() => !!document.getElementById('voPaymentTotalAmount'));
  if (paymentTotalExists) {
    await page.evaluate(() => { document.getElementById('voPaymentTotalAmount').value = '5000000'; });
    await page.evaluate((fn) => window.ensureFnReady ? ensureFnReady(fn) : null, 'previewOperationOrderWorkflow');
    await page.evaluate(() => document.getElementById('operationOrderPreviewWfBtn')?.click());
    await page.waitForTimeout(400);
    modal = await readModal();
    record('Vận Hành Đặt Hàng (Siêu Thị, 5tr -> tier LT10M): modal hiện đúng người duyệt "oostore1"', !modal.hidden && modal.content.includes('Người Duyệt Đặt Hàng Siêu Thị'), JSON.stringify(modal));
  } else {
    record('Vận Hành Đặt Hàng: ô #voPaymentTotalAmount tồn tại để điền giá trị test', false, 'không tìm thấy ô trong form hiện tại');
  }
  await closeModalAndClearAlerts();

  // ===== Hợp Đồng: 2 nút Xem Quy Trình tráo nhau đúng theo chế độ (Phê Duyệt vs Quản Lý HĐ) =====
  await gotoTab('#btnHopDongTab', 'button[data-op-seq*="setContractSubTab(APPROVAL)"]');
  let btnState = await page.evaluate(() => ({
    approvalHidden: document.getElementById('contractPreviewWfBtn').classList.contains('hidden'),
    manageHidden: document.getElementById('contractManagePreviewWfBtn').classList.contains('hidden')
  }));
  record('Hợp Đồng (tab Phê Duyệt): nút "Xem Quy Trình" (Phê Duyệt) hiện, nút "Quản Lý HĐ" ẩn', !btnState.approvalHidden && btnState.manageHidden, JSON.stringify(btnState));
  await page.evaluate(() => { document.getElementById('contractDept').value = 'Phòng A'; });
  await page.evaluate((fn) => window.ensureFnReady ? ensureFnReady(fn) : null, 'previewContractApprovalWorkflow');
  await page.evaluate(() => document.getElementById('contractPreviewWfBtn')?.click());
  await page.waitForTimeout(400);
  modal = await readModal();
  record('Hợp Đồng (Phê Duyệt): modal hiện đúng người duyệt "hd_approval1"', !modal.hidden && modal.content.includes('Người Duyệt HĐ Phê Duyệt'), JSON.stringify(modal));
  await closeModalAndClearAlerts();

  await gotoTab('#btnHopDongTab', 'button[data-op-seq*="setContractSubTab(MANAGE)"]');
  btnState = await page.evaluate(() => ({
    approvalHidden: document.getElementById('contractPreviewWfBtn').classList.contains('hidden'),
    manageHidden: document.getElementById('contractManagePreviewWfBtn').classList.contains('hidden')
  }));
  record('Hợp Đồng (tab Quản Lý HĐ): nút "Quản Lý HĐ" hiện, nút "Phê Duyệt" ẩn (tráo đúng chiều ngược lại)', btnState.approvalHidden && !btnState.manageHidden, JSON.stringify(btnState));
  await page.evaluate(() => { document.getElementById('contractDept').value = 'Phòng A'; });
  await page.evaluate((fn) => window.ensureFnReady ? ensureFnReady(fn) : null, 'previewContractManageWorkflow');
  await page.evaluate(() => document.getElementById('contractManagePreviewWfBtn')?.click());
  await page.waitForTimeout(400);
  modal = await readModal();
  record('Hợp Đồng (Quản Lý HĐ): modal hiện đúng người duyệt "hd_manage1"+"hd_manage2" (KHÁC quy trình Phê Duyệt)', !modal.hidden && modal.content.includes('Người Duyệt Tài Liệu Ký 1') && modal.content.includes('Người Duyệt Tài Liệu Ký 2'), JSON.stringify(modal));
  await closeModalAndClearAlerts();

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
