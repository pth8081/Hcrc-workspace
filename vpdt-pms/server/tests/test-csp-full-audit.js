// server/tests/test-csp-full-audit.js
//
// Rà soát TOÀN DIỆN vi phạm Content-Security-Policy trên khắp app — người dùng yêu cầu sau khi phát
// hiện 2 lớp lỗi thật (v23.7): module Nghiệp Vụ tạo <style> nội tuyến qua JS + gắn style="..." trực
// tiếp lên <svg>, cả 2 bị CSP (lib/securityHeaders.js, styleSrc KHÔNG có 'unsafe-inline') chặn ÂM THẦM
// trên server thật, trong khi MỌI bài test trước đó đều dùng static server thuần KHÔNG áp CSP nên không
// bao giờ bắt được lớp lỗi này.
//
// Bài test NÀY khác biệt: dựng app Express THẬT có áp lib/securityHeaders.js (helmet CSP thật, đúng cấu
// hình production, mirror renderIndexHtml() thật ở server.js — xem test-asset-version-csp.js cho lý do
// không require thẳng server.js được), rồi CLICK THẬT qua gần như MỌI điểm điều hướng trong sidebar
// (mirror + mở rộng NAV_POINTS của test-lazy-load-all-tabs.js, thêm 2 điểm module thêm sau — Nghiệp Vụ,
// Checklist — vốn chưa có trong danh sách gốc), ghi lại MỌI vi phạm CSP (không chỉ style-src) phát sinh ở
// từng điểm — cho biết CHÍNH XÁC vi phạm nằm ở tab nào để dễ khoanh vùng sửa, thay vì chỉ báo "có lỗi ở
// đâu đó". Nên chạy lại bài test này SAU MỖI đợt thêm module/tab mới, không chỉ khi nghi ngờ có lỗi.
//
// Chạy: node server/tests/test-csp-full-audit.js
'use strict';
const path = require('path');
const fs = require('fs');

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

// Mirror renderIndexHtml() thật ở server.js — xem giải thích đầy đủ ở test-asset-version-csp.js.
const SCRIPT_SRC_RE = /(<script\b[^>]*\bsrc=")\/js\/([\w.-]+)\.js(")/g;
const CSS_HREF_RE = /(<link\b[^>]*\bhref=")\/(tailwind|app)\.css(")/g;
function renderIndexHtmlLikeServer(rawHtml, appVersion) {
  let versioned = rawHtml.replace(SCRIPT_SRC_RE, (full, pre, name, post) => `${pre}/js/${name}.js?v=${encodeURIComponent(appVersion)}${post}`);
  versioned = versioned.replace(CSS_HREF_RE, (full, pre, name, post) => `${pre}/${name}.css?v=${encodeURIComponent(appVersion)}${post}`);
  const versionMeta = `<meta name="app-version" content="${String(appVersion).replace(/"/g, '&quot;')}">\n`;
  versioned = versioned.replace(/<script\b[^>]*\bsrc="\/js\/core\.js/, (m) => versionMeta + m);
  return versioned;
}

async function main() {
  const express = require(path.join(__dirname, '..', 'node_modules', 'express'));
  const securityHeaders = require(path.join(__dirname, '..', 'lib', 'securityHeaders'));
  const PUBLIC_DIR = path.join(__dirname, '..', 'public');
  const APP_VERSION = require(path.join(__dirname, '..', 'package.json')).version;

  const app = express();
  app.use(securityHeaders);
  app.get('/', (req, res) => {
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
    res.set('Content-Type', 'text/html; charset=utf-8').send(renderIndexHtmlLikeServer(raw, APP_VERSION));
  });
  app.use(express.static(PUBLIC_DIR));
  const PORT = 9714;
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Vi phạm CSP luôn được gắn nhãn "điểm điều hướng hiện tại" tại thời điểm phát sinh — cho biết đúng
  // tab nào gây lỗi thay vì chỉ 1 danh sách chung chung khó khoanh vùng.
  let currentPoint = 'trang đăng nhập / trước khi vào app';
  const violationsByPoint = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('Content Security Policy') || t.includes('Refused to')) {
      violationsByPoint.push({ point: currentPoint, text: t.split('\n')[0] });
    }
  });
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push({ point: currentPoint, text: String(err && err.message || err) }));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

  currentPoint = 'setup: đăng nhập admin (seed đủ DB.*)';
  const setup = await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => '';
    // realFetch (v23.10): giữ lại fetch() GỐC TRƯỚC khi ghi đè — loadTabSectionHtml() (core.js,
    // TAB_SECTION_FRAGMENT) fetch() các khung HTML tách lười (vd /fragments/vanHanhSection.html) từ
    // CHÍNH server tĩnh của bài test này (file thật, không phải API cần mock) — phải cho đi qua fetch
    // THẬT thay vì trả dữ liệu giả như /api/*, nếu không section HTML sẽ mãi rỗng (trước đây còn ném lỗi
    // "r.text is not a function" do stub cũ thiếu hẳn .text(), bị switchTab() bắt+nuốt lặng lẽ — phát
    // hiện qua chính bài test này khi click qua Vận Hành, sinh pageerror thật ở bước render tiếp theo).
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && !url.startsWith('/api/')) return realFetch(url, opts);
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      if (method === 'GET') return { ok: true, status: 200, json: async () => ([]), blob: async () => new Blob([]) };
      return { ok: false, status: 404, json: async () => ({ error: 'not found (test stub)' }) };
    };
    Object.assign(DB, {
      depts: ['Phòng CNTT', 'Phòng Kế Toán'], stores: ['Siêu Thị Quận 1'], cats: ['Chung'],
      deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: ['Nhân viên'], storeJobTitles: [], submissionTypes: [], contractTypes: [], carTypes: [],
      uniformCatalog: [], itTicketCategories: [],
      workflows: [{ id: 'WF_1STEP', name: 'Quy trình 1 bước (Sếp duyệt)', steps: [{ order: 1, name: 'Phê duyệt 1' }] }],
      deptWorkflows: {},
      docs: [], submissions: [], submissionDeptWorkflows: {}, submissionTypeDeptWorkflows: {}, submissionApprovalGroups: [],
      contracts: [], contractApprovalGroups: [], contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
      meetings: [], meetingMinutes: [], meetingAttendeeTemplates: [],
      carRegs: [], carDeptWorkflows: {},
      officeReqs: [], officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {},
      tasks: [], internalPosts: [], internalNewsCategories: [], internalShareCategories: [],
      trainingCategories: [], trainingDocuments: [], trainingClasses: [], trainingRegistrations: [],
      careerPaths: [], careerPathConfirmations: [], trainingTests: [], trainingTestSubmissions: [],
      trainingCourses: [], trainingPlans: [], onboardingPaths: [], onboardingProgress: [],
      recruitmentJobs: [], recruitmentReferrals: [], hrFeedback: [], sensitiveKeywords: [],
      paymentRequests: [], formTemplates: {}, permGroups: [], users: [],
      vppExcludeGroups: [], vppExcludedJobTitles: [], workflowParticipatingDepts: [],
      pwaShortcutModules: [], itPriceMasterLists: [], itPriceDeptWorkflows: {}, itPriceTierWorkflows: {},
      uploadFileTypeConfig: {}, uploadSizeLimitConfig: {}, emailConfig: {}, systemLogs: [], externalApiKeys: [],
      vppRegistrations: [], vppDeptWorkflows: {}, vppPeriods: [], itPriceApprovals: [], itServiceRenewals: [], itSupportTickets: [],
      budgetEntries: [], budgetDeptWorkflows: {}, budgetTemplates: [], budgetPeriods: [],
      reportPeriods: [], reportEntries: [], licenses: [], licenseTypes: [],
      operationOrders: [], operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {},
      operationStoreOpenings: [], operationStoreOpenDeptWorkflows: {},
      operationRepairs: [], operationRepairDeptWorkflows: {},
      operationWorkItems: [], operationExecutionPeriods: [], orgChartManagerOverrides: {},
      checklistTemplates: [], checklistSubmissions: [],
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
  record('setup: đăng nhập admin + seed DB.* không lỗi', setup.loginOk && setup.headerShown, JSON.stringify(setup));

  // Mirror NAV_POINTS của test-lazy-load-all-tabs.js + bổ sung 2 điểm module thêm sau (Nghiệp Vụ,
  // Checklist) chưa có trong danh sách gốc — PHẢI thêm điểm mới vào đây mỗi khi thêm tab/module mới.
  const NAV_POINTS = [
    { label: 'Trang chủ (Dashboard)', click: '[data-op="switchTab"][data-arg0="dashboard"]', section: 'dashboardSection' },
    { label: 'Phê Duyệt (Approval Hub)', click: '[data-op="switchTab"][data-arg0="approvalHub"]', section: 'approvalHubSection' },
    { label: 'Tài liệu', click: '[data-op="switchTab"][data-arg0="doc"]', section: 'docSection' },
    { label: 'Văn bản trình', click: '[data-op="switchTab"][data-arg0="submission"]', section: 'submissionSection' },
    { label: 'Báo cáo Quản trị', click: '[data-op="switchTab"][data-arg0="reports"]', section: 'reportsSection' },
    { label: 'Nghiệp Vụ', click: '[data-op="switchTab"][data-arg0="nghiepVu"]', section: 'nghiepVuSection' },
    { label: 'Nhân Sự > Quản Lý &amp; Phản Hồi Ý Kiến', toggle: '#btnHrTab', click: '#btnHrFeedbackNav', section: 'hrSection' },
    { label: 'Nhân Sự > Cơ Cấu Tổ Chức', toggle: '#btnHrTab', click: '#btnOrgChartNav', section: 'orgChartSection' },
    { label: 'Truyền Thông > Nhịp Sống HCRC', toggle: '#btnInternalTab', click: 'button[data-op-seq*="setInternalSubTab(NEWS)"]', section: 'internalSection' },
    { label: 'Truyền Thông > Đào Tạo', toggle: '#btnInternalTab', click: 'button[data-op-seq*="setInternalSubTab(TRAINING)"]', section: 'internalSection' },
    { label: 'Truyền Thông > Tuyển Dụng', toggle: '#btnInternalTab', click: 'button[data-op-seq*="setInternalSubTab(RECRUITMENT)"]', section: 'internalSection' },
    { label: 'Truyền Thông > Góc Chia Sẻ', toggle: '#btnInternalTab', click: 'button[data-op-seq*="setInternalSubTab(SHARE)"]', section: 'internalSection' },
    { label: 'Truyền Thông > HCRC Đồng Hành', toggle: '#btnInternalTab', click: 'button[data-op-seq*="setInternalSubTab(QNA)"]', section: 'internalSection' },
    { label: 'Hợp Đồng > Phê Duyệt', toggle: '#btnHopDongTab', click: 'button[data-op-seq*="setContractSubTab(APPROVAL)"]', section: 'contractSection' },
    { label: 'Hợp Đồng > Quản Lý HĐ & Giấy Phép', toggle: '#btnHopDongTab', click: 'button[data-op-seq*="setContractSubTab(MANAGE)"]', section: 'contractSection' },
    { label: 'Điều Hành > Biên bản họp', toggle: '#btnDieuHanhTab', click: '#btnMinutesTab', section: 'minutesSection' },
    { label: 'Điều Hành > Công việc', toggle: '#btnDieuHanhTab', click: '#btnTaskTab', section: 'taskSection' },
    { label: 'Điều Hành > Báo Cáo Định Kỳ', toggle: '#btnDieuHanhTab', click: '#btnPeriodicReportTab', section: 'periodicReportSection' },
    { label: 'Hành Chính > Phòng họp', toggle: '#btnHanhChinhTab', click: '#btnMeetingTab', section: 'meetingSection' },
    { label: 'Hành Chính > Đăng ký xe', toggle: '#btnHanhChinhTab', click: '#btnCarTab', section: 'carSection' },
    { label: 'Hành Chính > Văn phòng phẩm', toggle: '#btnHanhChinhTab', click: '#btnVppTab', section: 'vppSection' },
    { label: 'Hành Chính > Đồng phục', toggle: '#btnHanhChinhTab', click: '#btnUniformTab', section: 'uniformSection' },
    { label: 'Hành Chính > Giấy phép', toggle: '#btnHanhChinhTab', click: '#btnLicenseTab', section: 'licenseSection' },
    { label: 'Tổng Hợp > Mua Bán', toggle: '#btnTongHopTab', click: '#btnOfficeSubBuyNav', section: 'officeSection' },
    { label: 'Tổng Hợp > Sửa Chữa', toggle: '#btnTongHopTab', click: '#btnOfficeSubFixNav', section: 'officeSection' },
    { label: 'Tổng Hợp > Thanh Toán', toggle: '#btnTongHopTab', click: '#btnOfficeSubPaymentNav', section: 'officeSection' },
    { label: 'Tổng Hợp > Ngân Sách', toggle: '#btnTongHopTab', click: '#btnBudgetNav', section: 'budgetSection' },
    { label: 'Vận Hành > Phê Duyệt Đơn Hàng', toggle: '#btnVanHanhTab', click: '#btnOperationOrderNav', section: 'vanHanhSection' },
    { label: 'Vận Hành > Siêu Thị', toggle: '#btnVanHanhTab', click: '#btnOperationStoreNav', section: 'vanHanhSection' },
    { label: 'Vận Hành > Checklist Đánh Giá', toggle: '#btnVanHanhTab', click: '#btnChecklistNav', section: 'checklistSection' },
    { label: 'Hỗ Trợ IT > Phê Duyệt Giá', toggle: '#btnItSupportTab', click: 'button[data-op-seq*="setItSupportSubTab(PRICE)"]', section: 'itSupportSection' },
    { label: 'Hỗ Trợ IT > Hỗ Trợ Yêu Cầu', toggle: '#btnItSupportTab', click: 'button[data-op-seq*="setItSupportSubTab(TICKET)"]', section: 'itSupportSection' },
    { label: 'Hỗ Trợ IT > Gia Hạn Dịch Vụ', toggle: '#btnItSupportTab', click: '#btnItSupportNavRenewal', section: 'itSupportSection' },
    { label: 'Hệ Thống > Quản Trị', toggle: '#btnSystemTab', click: 'button[data-op-seq*="setSystemSubTab(ADMIN)"]', section: 'systemSection' },
    { label: 'Hệ Thống > Biểu Mẫu', toggle: '#btnSystemTab', click: 'button[data-op-seq*="setSystemSubTab(FORM)"]', section: 'systemSection' },
    { label: 'Hệ Thống > Quy Trình & Phê Duyệt', toggle: '#btnSystemTab', click: 'button[data-op-seq*="setSystemSubTab(WORKFLOW)"]', section: 'systemSection' },
    { label: 'Hệ Thống > Quản Lý Tệp File', toggle: '#btnSystemTab', click: 'button[data-op-seq*="setSystemSubTab(UPLOAD)"]', section: 'systemSection' },
    { label: 'Hệ Thống > Log', toggle: '#btnSystemTab', click: 'button[data-op-seq*="setSystemSubTab(LOG)"]', section: 'systemSection' },
    // 🔀 Nghiệp Vụ Nâng Cao (từ v23.65) — mirror đúng 4 điểm đã thêm ở test-lazy-load-all-tabs.js. Từ
    // v23.73: sidebar không còn link tắt riêng thẳng tới QUICKAPPLY (mục "⚡ Áp Dụng Nhanh" trong sidebar
    // đã bỏ hẳn, thay bằng lối vào chung "🔀 Nghiệp Vụ Nâng Cao") — điểm đầu tiên nay chỉ còn kiểm tra
    // đúng lối vào MẶC ĐỊNH qua sidebar mới; việc bấm sâu vào từng sub-tab (kể cả QUICKAPPLY) đã có
    // test-adv-workflow-tab-deep.js/test-quick-apply-workflow-steps.js phủ kỹ hơn nhiều.
    { label: 'Hệ Thống > Nghiệp Vụ Nâng Cao (mặc định)', toggle: '#btnSystemTab', click: 'button[data-op-seq*="setSystemSubTab(ADVWORKFLOW)"]', section: 'systemSection' },
    { label: 'Hệ Thống > Nghiệp Vụ Nâng Cao (Quy Trình Đặt Hàng Siêu Thị)', click: '#btnSystemSubAdvWorkflow', section: 'systemSection' },
    { label: 'Hệ Thống > Nghiệp Vụ Nâng Cao (Nhóm Phê Duyệt Trình/HĐ)', click: '#btnAdvWorkflowSubGroups', section: 'systemSection' },
    { label: 'Hệ Thống > Nghiệp Vụ Nâng Cao (Nhóm Quyền Đặc Biệt)', click: '#btnAdvWorkflowSubSpecialPerm', section: 'systemSection' }
  ];

  for (const point of NAV_POINTS) {
    currentPoint = point.label;
    if (point.toggle) await page.click(point.toggle, { force: true });
    await page.evaluate((sel) => document.querySelector(sel)?.click(), point.click);
    await page.waitForTimeout(150);
  }

  const uniqueViolationPoints = [...new Set(violationsByPoint.map(v => v.point))];
  record(`KHÔNG có vi phạm CSP nào phát sinh khi duyệt qua toàn bộ ${NAV_POINTS.length} điểm điều hướng`,
    violationsByPoint.length === 0,
    violationsByPoint.length ? `Vi phạm tại: ${uniqueViolationPoints.join(', ')}\n      Chi tiết:\n      ${violationsByPoint.map(v => `[${v.point}] ${v.text}`).join('\n      ')}` : '');

  record('KHÔNG có lỗi JS (pageerror) nào phát sinh trong suốt vòng duyệt', pageErrors.length === 0,
    pageErrors.map(e => `[${e.point}] ${e.text}`).join(' | '));

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
