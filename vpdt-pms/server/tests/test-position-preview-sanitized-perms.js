// server/tests/test-position-preview-sanitized-perms.js
//
// Regression cho lỗi người dùng báo cáo (10/2026): "Phê Duyệt Giá Bán Lẻ đã cấu hình Theo Vị Trí ở Quy
// Trình & Phê Duyệt (admin xem đúng ra người duyệt) nhưng khi nhân viên bấm "Xem Trước Quy Trình" ở form
// tạo đề xuất thì vẫn báo chưa có người duyệt.
//
// GỐC LỖI: sanitizeUsersPermsForViewer() (server, lib/recordViewScope.js) xoá field `perms` của MỌI
// người khác trong DB.users với viewer KHÔNG PHẢI admin (chỉ giữ `perms` của chính người gọi) — đúng và
// cần thiết để không lộ ma trận quyền của đồng nghiệp. Nhưng resolvePositionApproverUsernamesClient()
// (client, core.js, dùng cho MỌI preview "Theo vị trí") trước đây đọc THẲNG u.perms?.canBeApprover của
// từng người — với 1 viewer không phải admin, cờ đó LUÔN undefined cho người khác, nên preview luôn kết
// luận "chưa có người duyệt" dù cấu hình/dữ liệu hoàn toàn đúng. Vá: thêm 'canBeApprover' vào
// APPROVER_FLAG_KEYS (lib/recordViewScope.js) để có sẵn DB.moduleApproverUsernames.canBeApprover (danh
// sách AN TOÀN, chỉ username) — resolvePositionApproverUsernamesClient() dùng danh sách đó làm lớp dự
// phòng khi u.perms đã bị xoá.
//
// Test này KHÔNG dùng testHarness.js (vốn không mock /api/data/lazy/* theo kiểu viewer non-admin) — tự
// dựng static server + DB.* mô phỏng ĐÚNG shape mà GET /api/data trả về cho 1 viewer KHÔNG PHẢI admin
// (users[] của người khác không có field `perms`, chỉ có moduleApproverUsernames.canBeApprover thay thế).
//
// Chạy: node server/tests/test-position-preview-sanitized-perms.js
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
  const PORT = 9800 + Math.floor(Math.random() * 400);
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
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && !url.startsWith('/api/')) return realFetch(url, opts);
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      if (method === 'GET') return { ok: true, status: 200, json: async () => ([]) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const DEPT = 'Phòng Mua hàng Thực phẩm Tươi sống';
    Object.assign(DB, {
      depts: [DEPT, 'Phòng B'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], submissionTypes: [], contractTypes: ['Kinh tế'], carTypes: [],
      uniformCatalog: [], itTicketCategories: [],
      workflows: [{ id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Trưởng phòng' }] }],
      deptWorkflows: {},
      docs: [], submissions: [], submissionApprovalGroups: [], submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {},
      contracts: [], contractApprovalGroups: [], contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
      meetings: [], meetingMinutes: [], meetingAttendeeTemplates: [],
      carRegs: [], carDeptWorkflows: {},
      officeReqs: [], officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {},
      tasks: [], internalPosts: [], internalNewsCategories: [], internalShareCategories: [],
      trainingCategories: [], trainingDocuments: [], trainingClasses: [], trainingRegistrations: [],
      careerPaths: [], careerPathConfirmations: [], trainingTests: [], trainingTestSubmissions: [],
      trainingCourses: [], trainingPlans: [], onboardingPaths: [], onboardingProgress: [],
      recruitmentJobs: [], recruitmentReferrals: [], hrFeedback: [], sensitiveKeywords: [],
      paymentRequests: [], paymentDeptWorkflows: {},
      formTemplates: {}, permGroups: [],
      users: [
        // Mô phỏng ĐÚNG sanitizeUsersPermsForViewer() (server, lib/recordViewScope.js) khi viewer KHÔNG
        // PHẢI admin: perms của NGƯỜI KHÁC (Trưởng phòng) bị xoá hẳn -- chỉ còn active/dept/jobTitle.
        { id: 200, username: 'tp_mhtps', name: 'Hoàng Văn Đại', dept: DEPT, jobTitle: 'Trưởng phòng', active: true },
        { id: 201, username: 'nv_mhtps', name: 'Nhân Viên MHTPS', dept: DEPT, jobTitle: 'Nhân viên', perms: { itPriceProposeCreateRetail: true }, active: true }
      ],
      // moduleApproverUsernames.canBeApprover -- danh sách AN TOÀN (computeModuleApproverUsernames(),
      // server, lib/recordViewScope.js) thay thế cho u.perms.canBeApprover đã bị xoá ở trên.
      moduleApproverUsernames: { canBeApprover: ['tp_mhtps'] },
      vppExcludeGroups: [], vppExcludedJobTitles: [], workflowParticipatingDepts: [], workflowParticipatingPositions: [],
      pwaShortcutModules: [], itPriceMasterLists: [],
      itPriceDeptWorkflows: {
        [DEPT]: {
          RETAIL: {
            workflowId: 'WF_1STEP', approvers: {},
            approverMode: { 1: 'POSITION' },
            approversByPosition: { 1: [{ jobTitle: 'Trưởng phòng', dept: DEPT }] }
          }
        }
      },
      itPriceTierWorkflows: {}, itPriceWholesaleStoreMixedApprovalRules: [],
      uploadFileTypeConfig: {}, uploadSizeLimitConfig: {}, emailConfig: {}, systemLogs: [], externalApiKeys: [],
      vppRegistrations: [], vppDeptWorkflows: {}, vppPeriods: [],
      budgetEntries: [], budgetDeptWorkflows: {}, budgetApprovedDeptWorkflows: {},
      operationOrders: [], operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {},
      operationOrderStoreMixedApprovalRules: [], storeTypes: [],
      priceZones: [], itPriceApprovals: [], notifications: []
    });

    // Người NỘP đề xuất (KHÔNG phải Trưởng Phòng, KHÔNG phải admin) — đúng kịch bản thật người dùng báo
    // cáo: nhân viên thường nộp, Trưởng Phòng duyệt theo "Theo vị trí".
    finishLogin(DB.users.find(u => u.username === 'nv_mhtps'));
  });

  await page.evaluate(() => document.querySelector('#btnMuaHangTab')?.click());
  await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelector('#btnMuaHangBasNav')?.click());
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById('btnMhSubItPrice')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => { if (typeof openMhItPriceCreateForm === 'function') openMhItPriceCreateForm(); });
  await page.waitForTimeout(100);

  const deptDisplayValue = await page.evaluate(() => document.getElementById('mhItPriceDeptDisplay')?.value);
  record('Form tự điền đúng phòng ban của nhân viên nộp đề xuất', deptDisplayValue === 'Phòng Mua hàng Thực phẩm Tươi sống', deptDisplayValue);

  await page.evaluate(() => document.getElementById('mhItPricePreviewWfBtn')?.click());
  await page.waitForTimeout(300);
  const modal = await page.evaluate(() => ({
    hidden: document.getElementById('viewDocModal').classList.contains('hidden'),
    content: document.getElementById('viewModalContent').innerHTML
  }));

  record(
    'LỖI ĐÃ VÁ: nhân viên thường (perms của Trưởng Phòng đã bị server ẩn) bấm "Xem Trước Quy Trình" vẫn thấy ĐÚNG người duyệt "Hoàng Văn Đại", KHÔNG còn báo "chưa có người duyệt"',
    !modal.hidden && modal.content.includes('Hoàng Văn Đại') && !modal.content.includes('chưa có người duyệt'),
    JSON.stringify(modal)
  );

  record('Không có ngoại lệ JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, pageErrors.join('\n'));

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed} pass, ${failed} fail`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
