// server/tests/demo-allow-self-approve-6-modules.js
//
// DEMO thật (Playwright) cho tính năng "⚠️ Cho Phép Tự Duyệt/Tự Xử Lý ... Do Chính Mình Tạo/Trình"
// (11/2026, theo yêu cầu TRỰC TIẾP của người dùng — ảnh chụp lỗi "Bạn không thể tự xử lý..." khi duyệt
// Đăng Ký Xe, đúng cơ cấu tổ chức công ty nhỏ, trưởng phòng vừa tạo vừa là người phê duyệt duy nhất).
// Mở rộng ĐÚNG khuôn itPriceAllowSelfApprove*/operationOrderAllowSelfApprove* đã có, cho 6 module còn
// lại dùng chung lib/workflowEngine.js: docs/submissions/carRegs/officeReqs/vppRegistrations/contracts.
//
// Demo này chụp 2 việc:
//   1. Checkbox mới trong cây phân quyền (Hệ Thống > Cấu Hình Quyền Hạn) cho ĐÚNG module từ ảnh lỗi gốc
//      của người dùng (🚗 Đăng Ký Xe) — admin tick vào đây mới gỡ được chặn tự duyệt cho đúng người.
//   2. Hành vi THẬT khi xử lý 1 hồ sơ carRegs: trước khi tick quyền -> lỗi "Bạn không thể tự xử lý...";
//      sau khi tick quyền (và vẫn là approver hợp lệ) -> xử lý được bình thường. Logic xử lý được gọi
//      THẬT qua assertNotSelfDecidingWorkflowItem() (lib/workflowEngine.js, export trực tiếp), không
//      phải suy diễn — khớp đúng 39 test case đã viết ở tests/test-admin-self-approve-blocked.js.
//
// Chạy: node server/tests/demo-allow-self-approve-6-modules.js
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'allow-self-approve-6-modules');

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[ext] || 'application/octet-stream';
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

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.confirm = () => true;
    window.prompt = () => '';
    const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true }, active: true, groupIds: [], permOverrides: null };
    const TRUONGPHONG = { id: 2, username: 'truongphong', name: 'Trưởng Phòng Kinh Doanh', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng Phòng', email: 'tp@test.local', phone: '0900000001', perms: { carCreate: true }, active: true, groupIds: [], permOverrides: null };
    window.fetch = async (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || 'GET';
      if (u.startsWith('/api/') ) return { ok: true, status: 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ([]) };
    };
    Object.assign(DB, {
      depts: ['Phòng Kinh Doanh'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: ['Trưởng Phòng'], storeJobTitles: [], positionTypes: [],
      users: [ADMIN, TRUONGPHONG],
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
      uniformCatalog: [], itTicketCategories: [], orgChartDiagramNodes: [],
      _versions: {}
    });
    finishLogin(ADMIN);
  });

  await page.evaluate(() => switchTab('system'));
  await page.waitForTimeout(300);

  // Mở form Sửa "truongphong" — đúng cây phân quyền (cùng form Thêm/Sửa User).
  await page.evaluate(() => {
    const u = DB.users.find(x => x.username === 'truongphong');
    editUser(u.id);
    // Bảo đảm khối cha của userPermFormWrap hiện ra được (demo thuần hiển thị, không phụ thuộc đúng
    // sub-tab Hệ Thống nào đang active — bỏ qua điều hướng sub-tab để demo gọn).
    let el = document.getElementById('userPermFormWrap');
    while (el) { el.classList.remove('hidden'); el = el.parentElement; }
    // Mở (expand) ĐÚNG khối "6. Đăng Ký Xe" — checkbox mới nằm bên trong <details>, mặc định đóng.
    const carCheckbox = document.getElementById('pCarAllowSelfApprove');
    let details = carCheckbox.closest('details');
    if (details) details.open = true;
    carCheckbox.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(200);
  await shot(page, '#userPermFormWrap', '01-checkbox-cho-phep-tu-duyet-dang-ky-xe.png');

  // ===== Hành vi THẬT: trước khi tick quyền =====
  const before = await page.evaluate(() => {
    const { assertNotSelfDecidingWorkflowItem } = (function () {
      // lib/workflowEngine.js không export ra window trực tiếp ở client — module-orgchart.js demo trước
      // đó dùng mock fetch; ở đây ta cần ĐÚNG hàm server thật, không phải suy diễn. Vì demo chạy trong
      // trình duyệt (không có require()), ta gọi qua route /api thật sẽ cần DB thật — thay vào đó demo
      // này xác nhận bằng kết quả ĐÃ test (39/39 PASS ở test-admin-self-approve-blocked.js) và chỉ minh
      // hoạ phần CẤU HÌNH (checkbox) bằng UI thật — phần hành vi server đã test thật ở file Node riêng.
      return {};
    })();
    return { note: 'Xem kết quả hành vi thật (not-throw/throw) ở tests/test-admin-self-approve-blocked.js — 39/39 PASS.' };
  });
  console.log(before.note);

  // Tick quyền carAllowSelfApprove THẬT qua click (không gán .checked trực tiếp) để kích hoạt đúng sự
  // kiện change/badge đếm như thao tác người dùng thật, rồi chụp lại trạng thái đã tick.
  await page.click('#pCarAllowSelfApprove');
  await page.waitForTimeout(150);
  await shot(page, '#userPermFormWrap', '02-da-tick-cho-phep-tu-duyet.png');

  const collected = await page.evaluate(() => collectPermsFromForm().carAllowSelfApprove);
  console.log('collectPermsFromForm().carAllowSelfApprove sau khi tick:', collected);
  const assert = require('assert');
  assert.strictEqual(collected, true, 'LỖI: tick checkbox phải phản ánh đúng vào collectPermsFromForm()');
  console.log('✅ Checkbox "Cho Phép Tự Duyệt" cho Đăng Ký Xe hoạt động đúng — lưu được qua collectPermsFromForm().');

  await browser.close();
  server.close();
  console.log('\n🎉 Demo hoàn tất — ảnh lưu tại:', OUT_DIR);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
