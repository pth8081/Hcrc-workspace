// server/tests/test-csp-deep-interaction.js
//
// Mở rộng tests/test-csp-full-audit.js (chỉ click qua 38 điểm điều hướng TOP-LEVEL) theo 2 hướng cộng
// dồn:
//   (1) Đợt rà soát sâu KHÔNG committed trước đó (chỉ chạy 1 lần thủ công) đã mở thêm modal "Thêm/Nhân
//       Bản/Duyệt/Cấu hình..." ở 21 module tương tác nhiều nhất — nhưng seed DB.* của đợt đó vẫn để RỖNG
//       hầu hết collection, nên các nút "Sửa"/"Xem"/"Chi tiết" CẤP DÒNG (chỉ render khi có ÍT NHẤT 1 bản
//       ghi khớp điều kiện trong DB.<collection>, khác hẳn nút "Thêm" luôn hiện sẵn trên form) chưa từng
//       được click tới lần nào — cả cây gọi hàm buildXRowHTML()/openXDetailModal() phía sau các nút đó vì
//       vậy chưa hề được bài audit CSP nào đụng tới.
//   (2) Bài test NÀY seed 1 bản ghi THẬT (dựa đúng shape đã xác nhận từ các test hồi quy hiện có —
//       test-car-report-week-month.js/test-budget-lines.js/test-checklist-vsattp-seed.js/test-task.js/
//       test-submission.js...) cho 13 collection tạo hồ sơ chính: carRegs, budgetLines, checklistTemplates
//       (+ checklistSubmissions), licenses, vppRegistrations, itPriceApprovals, operationOrders,
//       contracts, tasks, meetings/meetingMinutes, docs, submissions — rồi chạy lại đúng khung rà soát sâu
//       (mở modal + chuyển sub-tab trong modal + đóng) ở 21 module đó, cộng thêm khẳng định RÕ RÀNG (qua
//       results/record(), không chỉ console.log rồi đọc mắt) rằng nút cấp DÒNG của TỪNG collection nêu
//       trên đã thực sự được click tới — không chỉ "có mở được modal nào đó" chung chung.
//
// Phát hiện phụ trong lúc dựng bài test này (đã tự vá ngay trong seed, không phải lỗi app cần sửa):
// finishLogin() tự khởi động startApprovalPolling() (core.js), nhịp 20s poll
// GET /api/approvals/pending-signature rồi tự initDatabase() (fetch('/api/data')) nếu chữ ký đổi — với
// stub fetch() trả '[]' cho MỌI request GET, nhịp poll ĐẦU TIÊN sau 20s sẽ tự GHI ĐÈ TOÀN BỘ DB.* (kể cả
// mọi bản ghi vừa seed) về rỗng. Bài rà soát 38 điểm + hàng chục lượt click cấp dòng thường chạy quá 20s
// nên các collection được rà soát MUỘN (vd Checklist, Giấy phép, Ngân Sách...) bị xoá sạch dữ liệu ngay
// giữa chừng nếu không xử lý — seed bên dưới tự gọi stopApprovalPolling() ngay sau finishLogin() để tránh.
//
// Boot pattern (Express thật + lib/securityHeaders.js thật + mirror renderIndexHtmlLikeServer() y hệt
// server.js) và bước đăng nhập admin/seed DB.* sao chép nguyên khung từ test-csp-full-audit.js — dùng
// lại harness đã xác nhận đúng thay vì dựng lại từ đầu.
//
// Chạy: node server/tests/test-csp-deep-interaction.js
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

// Mirror ĐÚNG 38 điểm điều hướng của test-csp-full-audit.js/test-lazy-load-all-tabs.js — giữ nguyên thứ
// tự (ảnh hưởng trạng thái các nhóm dropdown/toggle đang mở) dù bài test này chỉ rà soát SÂU 21 điểm
// trong số đó (DEEP_LABELS bên dưới).
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
  { label: 'Hệ Thống > Log', toggle: '#btnSystemTab', click: 'button[data-op-seq*="setSystemSubTab(LOG)"]', section: 'systemSection' }
];

// 21 module ưu tiên rà soát SÂU (mở modal/form động) — mirror đúng danh sách của đợt audit sâu trước đó.
const DEEP_LABELS = new Set([
  'Nghiệp Vụ',
  'Vận Hành > Checklist Đánh Giá',
  'Tổng Hợp > Ngân Sách',
  'Hành Chính > Đăng ký xe',
  'Hành Chính > Văn phòng phẩm',
  'Hành Chính > Đồng phục',
  'Hành Chính > Giấy phép',
  'Hệ Thống > Quản Trị',
  'Hệ Thống > Quy Trình & Phê Duyệt',
  'Phê Duyệt (Approval Hub)',
  'Hợp Đồng > Quản Lý HĐ & Giấy Phép',
  'Vận Hành > Phê Duyệt Đơn Hàng',
  'Vận Hành > Siêu Thị',
  'Hỗ Trợ IT > Phê Duyệt Giá',
  'Tổng Hợp > Mua Bán',
  'Tổng Hợp > Thanh Toán',
  'Điều Hành > Công việc',
  'Điều Hành > Biên bản họp',
  'Nhân Sự > Cơ Cấu Tổ Chức',
  'Văn bản trình',
  'Tài liệu'
]);

// 10 (thay vì 6 ở test-csp-full-audit.js gốc chưa có bản ghi nào để bỏ lỡ) — nút cấp DÒNG nằm SAU trong
// DOM (dưới thẻ dashboard + nút "Xem Quy Trình" của form tạo mới, vốn cũng khớp bộ lọc TEXT_RE vì nhãn
// luôn chứa "Duyệt"), cần thêm chỗ mới với tới được.
const MAX_CLICKS_PER_TAB = 10;

// 13 cặp {collection, op cấp DÒNG kỳ vọng được click} — dùng để khẳng định RÕ RÀNG qua record() rằng bản
// ghi seed cho từng collection này thực sự khiến 1 nút Sửa/Xem/Chi tiết cấp dòng xuất hiện VÀ được click
// tới, không chỉ suy luận từ số liệu tổng. `textPattern` khi có nghĩa là nút đó PHẢI có text hiển thị
// khớp — chứng minh đây đúng là nút "Sửa"/"Xem"/"Chi tiết" chứ không phải trùng op ngẫu nhiên; budgetLines
// không có textPattern vì nút Sửa của nó chỉ là icon "✏️" (không có chữ), vẫn hợp lệ vì được nhận diện
// qua op-prefix "edit...".
const EXPECTED_ROW_LEVEL = [
  { collection: 'carRegs', op: 'runCarAction', textPattern: /(Xem|Chi tiết)/, moduleLabel: 'Hành Chính > Đăng ký xe' },
  { collection: 'budgetLines', op: 'editBudgetLineDraft', textPattern: null, moduleLabel: 'Tổng Hợp > Ngân Sách' },
  { collection: 'checklistTemplates (Xem)', op: 'viewChecklistTemplate', textPattern: /Xem/, moduleLabel: 'Vận Hành > Checklist Đánh Giá' },
  { collection: 'checklistTemplates (Sửa)', op: 'editViaCloneChecklistTemplate', textPattern: /Sửa/, moduleLabel: 'Vận Hành > Checklist Đánh Giá' },
  { collection: 'licenses', op: 'runLicenseAction', textPattern: /Chi tiết/, moduleLabel: 'Hành Chính > Giấy phép' },
  { collection: 'vppRegistrations', op: 'openVppRegModal', textPattern: /(Xem|Chi tiết)/, moduleLabel: 'Hành Chính > Văn phòng phẩm' },
  { collection: 'itPriceApprovals', op: 'openItPriceModal', textPattern: /Chi tiết/, moduleLabel: 'Hỗ Trợ IT > Phê Duyệt Giá' },
  { collection: 'operationOrders', op: 'openOperationProcessModal', textPattern: /(Xem|Chi tiết)/, moduleLabel: 'Vận Hành > Phê Duyệt Đơn Hàng' },
  { collection: 'contracts', op: 'runContractAction', textPattern: /(Xem|Chi tiết)/, moduleLabel: 'Hợp Đồng > Quản Lý HĐ & Giấy Phép' },
  { collection: 'tasks', op: 'runTaskAction', textPattern: /Chi tiết/, moduleLabel: 'Điều Hành > Công việc' },
  { collection: 'meetingMinutes', op: 'runMinutesAction', textPattern: /(Xem|Chi tiết)/, moduleLabel: 'Điều Hành > Biên bản họp' },
  { collection: 'docs', op: 'runDocAction', textPattern: /Chi tiết/, moduleLabel: 'Tài liệu' },
  { collection: 'submissions', op: 'runSubmissionAction', textPattern: /Chi tiết/, moduleLabel: 'Văn bản trình' }
];

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
  // Cổng RIÊNG, chưa dùng ở bài test nào khác (test-asset-version-csp.js=9713, test-csp-full-audit.js=
  // 9714, test-nghiepvu-csp.js=9705 — grep `.listen(` toàn bộ tests/ trước khi chọn).
  const PORT = 9716;
  const server = app.listen(PORT, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // Vi phạm CSP/lỗi JS luôn được gắn nhãn "điểm/nút đang thao tác" tại thời điểm phát sinh, cùng khuôn
  // test-csp-full-audit.js — cho biết đúng vị trí gây lỗi thay vì chỉ 1 danh sách chung chung.
  let currentPoint = 'trang đăng nhập / trước khi vào app';
  const violations = [];
  const pageErrors = [];
  let interactionAttempts = 0;
  const interactionLog = [];

  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('Content Security Policy') || t.includes('Refused to')) {
      violations.push({ point: currentPoint, text: t.split('\n')[0] });
    }
  });
  page.on('pageerror', (err) => pageErrors.push({ point: currentPoint, text: String((err && err.message) || err) }));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });

  currentPoint = 'setup: đăng nhập admin (seed DB.* CÓ dữ liệu thật ở 13 collection tạo hồ sơ, không chỉ mảng rỗng)';
  const setup = await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => '';
    window.fetch = async (url, opts) => {
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      if (method === 'GET') return { ok: true, status: 200, json: async () => ([]), blob: async () => new Blob([]) };
      return { ok: false, status: 404, json: async () => ({ error: 'not found (test stub)' }) };
    };

    const NOW = '15/09/2026 08:00:00';
    const ADMIN_NAME = 'Quản Trị Viên Test';

    Object.assign(DB, {
      depts: ['Phòng CNTT', 'Phòng Kế Toán'], stores: ['Siêu Thị Quận 1'], cats: ['Chung'],
      deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: ['Nhân viên'], storeJobTitles: [], submissionTypes: [], contractTypes: [], carTypes: [],
      uniformCatalog: [], itTicketCategories: [],
      workflows: [{ id: 'WF_1STEP', name: 'Quy trình 1 bước (Sếp duyệt)', steps: [{ order: 1, name: 'Phê duyệt 1' }] }],
      deptWorkflows: {},
      submissionDeptWorkflows: {}, submissionTypeDeptWorkflows: {}, submissionApprovalGroups: {},
      contractApprovalGroups: {}, contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
      meetingAttendeeTemplates: [],
      carDeptWorkflows: {},
      officeReqs: [], officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {},
      internalPosts: [], internalNewsCategories: [], internalShareCategories: [],
      trainingCategories: [], trainingDocuments: [], trainingClasses: [], trainingRegistrations: [],
      careerPaths: [], careerPathConfirmations: [], trainingTests: [], trainingTestSubmissions: [],
      trainingCourses: [], trainingPlans: [], onboardingPaths: [], onboardingProgress: [],
      recruitmentJobs: [], recruitmentReferrals: [], hrFeedback: [], sensitiveKeywords: [],
      paymentRequests: [], formTemplates: {}, permGroups: [], users: [],
      vppExcludeGroups: [], vppExcludedJobTitles: [], workflowParticipatingDepts: [],
      pwaShortcutModules: [], itPriceMasterLists: [], itPriceDeptWorkflows: {}, itPriceTierWorkflows: {},
      uploadFileTypeConfig: {}, uploadSizeLimitConfig: {}, emailConfig: {}, systemLogs: [], externalApiKeys: [],
      vppDeptWorkflows: {}, vppPeriods: [], itServiceRenewals: [], itSupportTickets: [],
      budgetDeptWorkflows: {}, budgetTemplates: [], budgetPeriods: [],
      reportPeriods: [], reportEntries: [], licenseTypes: [],
      operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {},
      operationStoreOpenings: [], operationStoreOpenDeptWorkflows: {},
      operationRepairs: [], operationRepairDeptWorkflows: {},
      operationWorkItems: [], operationExecutionPeriods: [], orgChartManagerOverrides: {},
      _versions: {},

      // ============ Từ đây trở xuống: 13 collection tạo hồ sơ được seed 1 bản ghi THẬT thay vì mảng rỗng
      // — shape khớp các test hồi quy hiện có (test-car-report-week-month.js/test-budget-lines.js/
      // test-checklist-vsattp-seed.js/test-task.js/test-submission.js...) + đọc thẳng logic render dòng
      // ở module-*.js tương ứng, để nút "Sửa"/"Xem"/"Chi tiết" cấp DÒNG thực sự xuất hiện và được click
      // tới. Hầu hết set status 'APPROVED' (không phải 'PENDING') CÓ CHỦ ĐÍCH: canApproveStep() (core.js)
      // cho ADMIN quyền duyệt BẤT KỲ bước nào bất kể approvers cấu hình gì — để 'PENDING' sẽ khiến nút
      // chính luôn là "Duyệt"/"Xử lý" thay vì "Xem"/"Chi tiết", không bắt đúng nhánh cần rà soát ở đây.

      carRegs: [{
        id: 90001, code: 'HCRC-CAR-A1', dept: 'Phòng CNTT', type: 'Xe 4 chỗ', passengers: '02',
        directUser: 'Nhân Viên A', directUserPhone: '', purpose: 'Công tác', km: 80,
        startTime: '2026-09-16T08:00', endTime: '2026-09-16T10:00', routePoints: ['HO', 'Q1'], destination: 'HO → Q1',
        reason: 'Họp đối tác', customData: {}, createdAt: NOW, status: 'APPROVED', currentStep: 1, history: [],
        assignedDriver: 'Lái Xe Một', assignedDriverUsername: 'lx1', assignedVehicleType: 'Xe 4 chỗ',
        assignedPlate: '51A-111.11', assignedTaxiCompany: '', creator: 'admin', creatorName: ADMIN_NAME
      }],

      budgetLines: [{
        id: 90101, stage: 'PROPOSED', status: 'SUBMITTED', dept: 'Phòng CNTT', location: 'HO',
        content: 'Mua máy tính bàn văn phòng', description: '03 bộ, thay máy cũ hư',
        quantity: 3, unitPrice: 12000000, vatPercent: 10, totalAmount: 39600000,
        budgetType: 'OPEX', itemCategory: 'HARDWARE', budgetYear: 2026, budgetMonth: 10, note: '',
        createdBy: 'admin', createdByName: ADMIN_NAME, createdAt: NOW, history: []
      }],
      // budgetEntries — collection CŨ đã bị thay thế hẳn bởi budgetLines (xem test-budget-lines.js
      // header), giữ mảng rỗng ở đây chỉ để phòng code cũ nào lỡ còn đọc tới, không seed bản ghi thật.
      budgetEntries: [],

      checklistTemplates: [{
        id: 90201, templateCode: 'CL_VSATTP', templateName: 'Checklist Vệ Sinh ATTP (seed test)',
        templateType: 'DEDUCTION', templateKind: 'DEDUCTION', version: 1, status: 'ACTIVE', categories: [],
        createdBy: 'admin', createdAt: NOW
      }],
      checklistSubmissions: [{
        id: 90202, templateId: 90201, templateCode: 'CL_VSATTP', templateName: 'Checklist Vệ Sinh ATTP (seed test)',
        templateType: 'DEDUCTION', templateVersion: 1, storeCode: 'Siêu Thị Quận 1', status: 'SUBMITTED',
        submittedByUsername: 'admin', submittedByName: ADMIN_NAME, submittedAt: NOW,
        isPassed: true, hasCriticalFail: false, scorePercent: 96.5, answers: [], deductions: []
      }],

      licenses: [{
        id: 90301, rootLicenseId: null, versionNumber: 1, code: 'HCRC-CNTT-GP-001', displayCode: 'HCRC-CNTT-GP-001',
        companyName: 'Công Ty TNHH HCRC', locationName: 'Trụ sở chính', licenseType: 'Giấy phép kinh doanh',
        licenseNumber: 'GP-0099/2026', issueDate: '01/01/2026', expiryDate: '01/01/2030',
        issuingAuthority: 'Sở KH&ĐT TP.HCM', operatingStatus: 'ACTIVE', lifecycleStatus: null,
        status: 'APPROVED', creator: 'admin', creatorName: ADMIN_NAME, createdAt: NOW, fileUrl: null, history: []
      }],

      vppRegistrations: [{
        id: 90401, periodName: 'Kỳ 3/2026', dept: 'Phòng CNTT', creator: 'admin', creatorName: ADMIN_NAME,
        items: [{ name: 'Bút bi', qty: 10, unit: 'Cây' }, { name: 'Giấy A4', qty: 5, unit: 'Ram' }],
        status: 'APPROVED', currentStep: 1, history: [], createdAt: NOW
      }],

      itPriceApprovals: [{
        id: 90501, code: 'HCRC-CNTT-GBB-001', dept: 'Phòng CNTT', creator: 'admin', creatorName: ADMIN_NAME,
        priceType: 'RETAIL', status: 'PENDING', currentStep: 1, history: [], createdAt: NOW,
        files: [{ fileName: 'bao-gia-seed.pdf', fileUrl: '/uploads/bao-gia-seed.pdf' }], applied: false
      }],

      // activeOperationOrderSubTab mặc định = 'STORE' (module-vanhanh.js) — orderLocationType PHẢI khớp
      // 'STORE' để đơn hàng hiện ngay ở sub-tab mặc định khi vào thẳng "Vận Hành > Phê Duyệt Đơn Hàng"
      // (để 'HO' sẽ bị lọc mất ngay từ đầu, không có nút cấp dòng nào để rà soát).
      operationOrders: [{
        id: 90601, code: 'HCRC-CNTT-DH-001', title: 'Đặt mua vật tư văn phòng seed test',
        dept: 'Phòng CNTT', creator: 'admin', creatorName: ADMIN_NAME, orderLocationType: 'STORE',
        receivingLocationName: 'Siêu Thị Quận 1',
        supplier: 'Công Ty Vật Tư ABC', amount: 5000000, items: [{ name: 'Mực in', qty: 5, unit: 'Hộp' }],
        status: 'APPROVED', currentStep: 1, history: [], createdAt: NOW, files: []
      }],

      // approvalStatus 'APPROVED' CÓ CHỦ ĐÍCH: sub-tab rà soát sâu là "Quản Lý HĐ & Giấy Phép"
      // (activeContractSubTab==='MANAGE'), CHỈ hiện hợp đồng gốc đã APPROVED (renderContracts() lọc
      // thẳng approvalStatus!=='APPROVED' ra khỏi tab này) — để 'PENDING' sẽ khiến hợp đồng không hiện
      // ra ở tab này (thuộc tab "Phê Duyệt" thay vào đó, không nằm trong DEEP_LABELS).
      contracts: [{
        id: 90701, code: 'HCRC-CNTT-HD-001', type: 'Nguyên tắc', title: 'Hợp đồng nguyên tắc seed test',
        partner: 'Công Ty Đối Tác XYZ', dept: 'Phòng CNTT', custodianDept: 'Phòng CNTT',
        creator: 'admin', creatorName: ADMIN_NAME, isAddendum: false, approvalStatus: 'APPROVED',
        paymentStatus: 'CHUA_THANH_TOAN', paymentType: 'ONE_TIME', signedFileStatus: null,
        startDate: '2026-01-01', endDate: '2026-12-31', createdAt: NOW, currentStep: 1, history: [],
        fileUrl: null, signedFileUrl: null, pendingPaymentTypeChange: null
      }],

      // assignedTo rỗng (chưa gán) CÓ CHỦ ĐÍCH: nếu gán sẵn cho admin, primary button của dòng sẽ là
      // "🔄 Cập nhật tiến độ" (ưu tiên cao hơn "Chi tiết" trong renderTasks(), xem module-congviec.js) —
      // để trống mới chắc chắn primary rơi đúng vào "👁️ Chi tiết" cần rà soát.
      tasks: [{
        id: 90801, title: 'Kiểm tra hệ thống mạng seed test', description: 'Việc mẫu cho audit CSP sâu',
        deadline: '2026-09-30', assignedTo: '', assignedToName: '', assignedBy: 'admin', assignedByName: ADMIN_NAME,
        sourceType: 'MANUAL', sourceCode: '', status: 'TODO', startedAt: null,
        externalCollaborators: [], collaboratorAccepts: [], subtasks: [], collaborators: [],
        extensionCount: 0, lateCount: 0, pendingExtension: null, pendingCancellation: null,
        createdAt: NOW, history: []
      }],

      meetings: [{
        id: 90901, code: 'HCRC-CNTT-PH-001', room: 'Phòng họp A', title: 'Họp giao ban seed test',
        attendees: 5, equipment: 'Máy chiếu', startTime: '2026-09-16T09:00', endTime: '2026-09-16T10:00',
        dept: 'Phòng CNTT', creator: 'admin', creatorName: ADMIN_NAME, status: 'APPROVED', createdAt: NOW, history: []
      }],
      meetingMinutes: [{
        id: 91001, code: 'HCRC-CNTT-BB-001', title: 'Biên bản họp giao ban seed test',
        time: '16/09/2026 09:00', location: 'Phòng họp A', chair: ADMIN_NAME, secretary: ADMIN_NAME,
        dept: 'Phòng CNTT', creator: 'admin', creatorName: ADMIN_NAME, tasksAssigned: false, directives: [],
        attendees: [{ name: ADMIN_NAME, username: 'admin' }], createdAt: NOW, history: []
      }],

      docs: [{
        id: 91101, rootDocId: null, code: 'HCRC-CNTT-TL-001', displayCode: 'HCRC-CNTT-TL-001',
        title: 'Quy trình vận hành seed test', summary: 'Tài liệu mẫu cho audit CSP sâu',
        dept: 'Phòng CNTT', cat: 'Chung', ver: 'v1', status: 'APPROVED', currentStep: 1, history: [],
        uploader: 'admin', uploaderName: ADMIN_NAME, fileUrl: null, createdAt: NOW
      }],

      submissions: [{
        id: 91201, code: 'HCRC-CNTT-TT-001', title: 'Tờ trình xin duyệt seed test',
        content: 'Nội dung tờ trình mẫu cho audit CSP sâu', dept: 'Phòng CNTT', type: 'Hành chính',
        priority: 'Bình thường', creator: 'admin', creatorName: ADMIN_NAME, status: 'APPROVED', currentStep: 1,
        fileName: 'to-trinh-seed.pdf', fileUrl: '/uploads/to-trinh-seed.pdf', fileType: 'application/pdf',
        effectiveSteps: [{ order: 1, name: 'Trưởng phòng duyệt' }], effectiveApprovers: { 1: ['admin'] },
        history: [], createdAt: NOW, extraFiles: []
      }]
    });
    const adminUser = {
      id: 1, username: 'admin', name: ADMIN_NAME, dept: 'Phòng CNTT', jobTitle: 'Nhân viên',
      email: 'admin@test.local', phone: '0900000000', perms: { admin: true }, groupIds: [], permOverrides: null
    };
    DB.users.push(adminUser);
    finishLogin(adminUser);
    // Dừng ngay nhịp poll 20s tự khởi động trong finishLogin() — xem chú thích đầu file (phần "Phát hiện
    // phụ") để biết lý do bắt buộc phải làm bước này TRƯỚC khi bắt đầu rà soát.
    if (typeof stopApprovalPolling === 'function') stopApprovalPolling();
    return {
      loginOk: document.getElementById('loginSection').classList.contains('hidden'),
      headerShown: !document.getElementById('userHeader').classList.contains('hidden')
    };
  });
  record('setup: đăng nhập admin + seed 13 collection có dữ liệu thật không lỗi', setup.loginOk && setup.headerShown, JSON.stringify(setup));
  if (!setup.loginOk || !setup.headerShown) {
    console.error('Đăng nhập thất bại, dừng sớm.');
    await browser.close(); server.close(); return finish();
  }

  // Quét các phần tử "mở gì đó" đang HIỂN THỊ trên trang: button/a/[data-op]/[onclick] mà op hoặc text
  // gợi ý thêm/sửa/xem/nhân bản/duyệt/cấu hình — loại trừ các op điều hướng/chuyển sub-tab thuần (đã rà
  // soát ở test-csp-full-audit.js) và các thẻ dashboard "filter...ByCard" (chỉ LỌC lại danh sách, không
  // mở modal/form nào, nhãn luôn chứa "Duyệt" nên khớp TEXT_RE bất kể có dữ liệu — nếu không loại sẽ
  // chiếm hết chỗ trong MAX_CLICKS_PER_TAB trước khi tới lượt nút cấp DÒNG thật sự nằm sau trong DOM).
  async function scanCandidates() {
    return await page.evaluate(() => {
      const NAV_OP_RE = /^(switchTab|set[A-Z][a-zA-Z]*SubTab|set[A-Z][a-zA-Z]*View|set[A-Z][a-zA-Z]*ViewMode|set[A-Z][a-zA-Z]*Tab|switchWf[A-Z][a-zA-Z]*|logout|confirmAndResetForm|shift[A-Z][a-zA-Z]*Date|filter[A-Z][a-zA-Z]*ByCard)$/;
      const OP_PREFIX_RE = /^(open|show|add|create|edit|view|new|clone|duplicate|approve|reject|configure|grade|submit)/i;
      const TEXT_RE = /(Thêm|Sửa|Xem\b|Xem Chi Tiết|Chi tiết|Nhân bản|Nhân Bản|Duyệt|Từ chối|Cấu hình|Tạo mới|Tạo Mới|Chỉnh sửa|Điều chỉnh|Import|Nhập)/;
      const nodes = Array.from(document.querySelectorAll('button, a, [data-op], [onclick]'));
      const out = [];
      let mark = 0;
      nodes.forEach((el) => {
        const rects = el.getClientRects();
        if (!rects.length) return;
        let anc = el; let visible = true;
        while (anc) {
          const cs = window.getComputedStyle(anc);
          if (cs.display === 'none' || cs.visibility === 'hidden') { visible = false; break; }
          anc = anc.parentElement;
        }
        if (!visible) return;
        const op = el.getAttribute('data-op') || '';
        if (op && NAV_OP_RE.test(op)) return;
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 50);
        const matchesOp = !!(op && OP_PREFIX_RE.test(op));
        const matchesText = TEXT_RE.test(text);
        if (matchesOp || matchesText) {
          el.setAttribute('data-csp-audit-mark', String(mark));
          out.push({ mark: mark, op: op, text: text, tag: el.tagName });
          mark++;
        }
      });
      return out;
    });
  }

  async function tryCloseAnyModal() {
    await page.evaluate(() => {
      const modals = Array.from(document.querySelectorAll('[id$="Modal"]')).filter((m) => {
        const cs = window.getComputedStyle(m);
        return cs.display !== 'none' && !m.classList.contains('hidden');
      });
      modals.forEach((m) => {
        const closeBtn = m.querySelector('[data-op^="close" i], [data-op^="Close" i]') ||
          Array.from(m.querySelectorAll('button')).find(b => /^(đóng|close|x)$/i.test((b.textContent || '').trim()));
        if (closeBtn) closeBtn.click();
      });
    });
    await page.keyboard.press('Escape').catch(() => {});
  }

  async function tryClickModalSubTabs() {
    return await page.evaluate(() => {
      const modals = Array.from(document.querySelectorAll('[id$="Modal"]')).filter((m) => {
        const cs = window.getComputedStyle(m);
        return cs.display !== 'none' && !m.classList.contains('hidden');
      });
      let clicked = 0;
      modals.forEach((m) => {
        const subtabBtns = Array.from(m.querySelectorAll('button[data-op], [data-op-seq]')).filter((b) => {
          const op = (b.getAttribute('data-op') || '') + (b.getAttribute('data-op-seq') || '');
          return /Tab|SubTab|View/i.test(op) && !/close/i.test(op);
        }).slice(0, 3);
        subtabBtns.forEach((b) => { try { b.click(); clicked++; } catch (e) {} });
      });
      return clicked;
    });
  }

  async function hasVisibleModal() {
    return await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[id$="Modal"]')).some((m) => {
        const cs = window.getComputedStyle(m);
        return cs.display !== 'none' && !m.classList.contains('hidden');
      });
    });
  }

  for (const point of NAV_POINTS) {
    currentPoint = point.label;
    if (point.toggle) await page.click(point.toggle, { force: true }).catch(() => {});
    await page.evaluate((sel) => document.querySelector(sel)?.click(), point.click);
    await page.waitForTimeout(200);

    if (!DEEP_LABELS.has(point.label)) continue;

    const candidates = await scanCandidates();
    const chosen = candidates.slice(0, MAX_CLICKS_PER_TAB);
    for (const c of chosen) {
      const label = `${point.label} > click [${c.tag}${c.op ? ' data-op=' + c.op : ''}] "${c.text}"`;
      currentPoint = label;
      interactionAttempts++;
      try {
        await page.evaluate((mark) => {
          const el = document.querySelector(`[data-csp-audit-mark="${mark}"]`);
          if (el) el.click();
        }, c.mark);
        await page.waitForTimeout(300);
        const modalOpen = await hasVisibleModal();
        let note = modalOpen ? 'mở modal' : 'không mở modal (có thể là form nội tuyến / hành động trực tiếp)';
        if (modalOpen) {
          currentPoint = label + ' > chuyển sub-tab trong modal';
          const nSub = await tryClickModalSubTabs();
          await page.waitForTimeout(200);
          currentPoint = label + ' > đóng modal';
          await tryCloseAnyModal();
          await page.waitForTimeout(150);
          note += `, đã thử ${nSub} sub-tab, đã đóng`;
        }
        interactionLog.push({ point: point.label, label, note, ok: true, text: c.text, op: c.op });
      } catch (e) {
        interactionLog.push({ point: point.label, label, note: 'lỗi thao tác (không liên quan CSP): ' + String((e && e.message) || e).slice(0, 120), ok: false, text: c.text, op: c.op });
        await tryCloseAnyModal().catch(() => {});
      }
    }
    await tryCloseAnyModal().catch(() => {});
  }

  // ====== Khẳng định kết quả qua record() — đúng convention "PASS: .../N scenarios passed" của cả bộ
  // test, thay vì chỉ dump console.log rồi đọc mắt ======

  const uniqueViolationPoints = [...new Set(violations.map(v => v.point))];
  record(`KHÔNG có vi phạm CSP nào phát sinh trong toàn bộ rà soát (${NAV_POINTS.length} điểm điều hướng + ${interactionAttempts} lượt click sâu ở ${DEEP_LABELS.size} module, có seed dữ liệu thật)`,
    violations.length === 0,
    violations.length ? `Vi phạm tại: ${uniqueViolationPoints.join(', ')}\n      Chi tiết:\n      ${violations.map(v => `[${v.point}] ${v.text}`).join('\n      ')}` : '');

  record('KHÔNG có lỗi JS (pageerror) nào phát sinh trong suốt vòng rà soát', pageErrors.length === 0,
    pageErrors.map(e => `[${e.point}] ${e.text}`).join(' | '));

  const failedInteractions = interactionLog.filter(l => !l.ok);
  record('KHÔNG có lượt click nào lỗi thao tác (element not found/timeout — không tính CSP)', failedInteractions.length === 0,
    failedInteractions.map(l => `[${l.label}] ${l.note}`).join(' | '));

  record(`Đã thực hiện đủ số lượt tương tác cấp sâu để rà soát có ý nghĩa (>= 40, thực tế: ${interactionAttempts})`,
    interactionAttempts >= 40, `interactionAttempts=${interactionAttempts}`);

  // Khẳng định RIÊNG cho TỪNG collection trong 13 collection đã seed: nút cấp DÒNG tương ứng (chỉ hiện
  // khi có bản ghi khớp điều kiện trong DB.<collection>) đã thực sự được tìm thấy VÀ click thành công —
  // đây là phần cốt lõi phân biệt bài test này với audit sâu trước đó (seed rỗng, chỉ bấm được "Thêm").
  for (const exp of EXPECTED_ROW_LEVEL) {
    const hit = interactionLog.find(l => l.ok && l.op === exp.op && (!exp.textPattern || exp.textPattern.test(l.text)));
    record(`Cấp DÒNG — collection "${exp.collection}" (module "${exp.moduleLabel}"): đã click trúng nút data-op="${exp.op}"${exp.textPattern ? ' với text khớp ' + exp.textPattern : ''}`,
      !!hit, hit ? '' : `Không tìm thấy trong log. Toàn bộ lượt click ở "${exp.moduleLabel}": ${JSON.stringify(interactionLog.filter(l => l.point === exp.moduleLabel).map(l => ({ op: l.op, text: l.text, ok: l.ok })))}`);
  }

  const rowLevelRE = /(Sửa|Xem|Chi tiết)/;
  const rowLevel = interactionLog.filter(l => l.ok && rowLevelRE.test(l.text));
  record(`Tổng số lượt click TRÚNG nút có text Sửa/Xem/Chi tiết (cấp dòng lẫn nút "Xem Quy Trình" của form) >= 15 (thực tế: ${rowLevel.length})`,
    rowLevel.length >= 15, `rowLevel=${rowLevel.length}`);

  // ====== Log chi tiết để đối chiếu khi cần điều tra (không phải assertion, chỉ tham khảo) ======
  console.log('');
  console.log('--- Toàn bộ nhật ký tương tác (để đối chiếu) ---');
  interactionLog.forEach(l => console.log(`  [${l.ok ? 'OK' : 'ERR'}] ${l.label} => ${l.note}`));

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
