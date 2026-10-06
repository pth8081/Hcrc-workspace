// server/tests/test-contract-import-mode-ui-clarity.js
//
// Regression cho lỗi người dùng báo cáo (10/2026): "upload hợp đồng/phụ lục đã ký đã add người phê
// duyệt và quy trình nhưng khi upload lên lại bỏ qua không sử dụng phê duyệt và bypass luôn". Sau khi rà
// soát kỹ, đây KHÔNG phải lỗi logic duyệt (server vẫn xác minh đúng người duyệt khi upload Tài Liệu Ký
// cho hồ sơ CÓ SẴN — xem test-contract.js kịch bản 8), mà người dùng đang thao tác ở màn
// "📥 Nhập Hợp Đồng/Phụ Lục Đã Ký" (chế độ IMPORT_CONTRACT/IMPORT_ADDENDUM, tab Quản Lý HĐ) — màn này
// CỐ Ý tạo hồ sơ ở trạng thái ĐÃ DUYỆT NGAY (dùng để số hoá hợp đồng giấy đã ký sẵn ngoài hệ thống, xem
// comment isSignedImport ở lib/createValidation.js), không đi qua quy trình nào cả.
//
// Gốc gây hiểu nhầm: ngay trong form IMPORT đó lại có nút "🔍 Xem Quy Trình Duyệt Tài Liệu Ký" (preview
// 1 quy trình THẬT có cấu hình người duyệt) VÀ nút submit ghi "Gửi phê duyệt" — cả 2 đều ngầm gợi ý có
// bước duyệt sắp xảy ra, trong khi hồ sơ nhập ở màn này luôn bỏ qua duyệt ngay khi bấm nút. Vá (module-
// hopdong.js): đổi nhãn nút submit thành "💾 Lưu Hồ Sơ Đã Ký (Không Qua Duyệt)" ở 2 chế độ IMPORT_*, và
// thêm cảnh báo rõ ràng vào footer modal preview (qua tham số footerOverride mới, TUỲ CHỌN, thêm ở
// core.js openGenericWorkflowPreviewModal() — không đổi hành vi của 10+ lời gọi khác không truyền tham
// số này).
//
// Chạy: node server/tests/test-contract-import-mode-ui-clarity.js
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
  const PORT = 9900 + Math.floor(Math.random() * 400);
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

    const DEPT = 'Phòng Tài chính Kế toán';
    Object.assign(DB, {
      depts: [DEPT], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], submissionTypes: [], contractTypes: ['Hợp đồng kinh tế'], carTypes: [],
      uniformCatalog: [], itTicketCategories: [],
      workflows: [{ id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Trưởng phòng' }] }],
      deptWorkflows: {},
      docs: [], submissions: [], submissionApprovalGroups: [], submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {},
      contracts: [], contractApprovalGroups: [], contractApprovalDeptWorkflows: {},
      // Quy trình duyệt Tài Liệu Ký CÓ cấu hình đầy đủ người duyệt cho phòng ban này — đúng kịch bản
      // người dùng báo cáo ("ảnh 2 tôi ấn xem quy trình đã có người phê duyệt").
      contractManageDeptWorkflows: { [DEPT]: { workflowId: 'WF_1STEP', approvers: { 1: ['tp_tckt'] } } },
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
        { id: 300, username: 'admin_tckt', name: 'Quản Trị Viên', dept: DEPT, jobTitle: 'Admin', perms: { admin: true }, active: true },
        { id: 301, username: 'tp_tckt', name: 'Trưởng phòng kế toán', dept: DEPT, jobTitle: 'Trưởng phòng', active: true }
      ],
      moduleApproverUsernames: { canBeApprover: ['tp_tckt'] },
      vppExcludeGroups: [], vppExcludedJobTitles: [], workflowParticipatingDepts: [], workflowParticipatingPositions: [],
      pwaShortcutModules: [], itPriceMasterLists: [],
      itPriceDeptWorkflows: {}, itPriceTierWorkflows: {}, itPriceWholesaleStoreMixedApprovalRules: [],
      uploadFileTypeConfig: {}, uploadSizeLimitConfig: {}, emailConfig: {}, systemLogs: [], externalApiKeys: [],
      vppRegistrations: [], vppDeptWorkflows: {}, vppPeriods: [],
      budgetEntries: [], budgetDeptWorkflows: {}, budgetApprovedDeptWorkflows: {},
      operationOrders: [], operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {},
      operationOrderStoreMixedApprovalRules: [], storeTypes: [],
      priceZones: [], itPriceApprovals: [], notifications: []
    });

    // admin có mọi quyền (kể cả contractImportSigned) — đúng kịch bản người dùng đang tự test bằng tài
    // khoản quản trị của mình.
    finishLogin(DB.users.find(u => u.username === 'admin_tckt'));
  });

  await page.evaluate(() => switchTab('contract'));
  await page.waitForTimeout(150);
  await page.evaluate(() => setContractSubTab('MANAGE'));
  await page.waitForTimeout(100);
  await page.evaluate(() => openContractManageForm());
  await page.waitForTimeout(100);

  const opMode = await page.evaluate(() => document.getElementById('contractOpMode')?.value);
  record('Mở "+ Thêm Hợp Đồng/Phụ Lục" ở tab Quản Lý HĐ -> mặc định đúng chế độ IMPORT_CONTRACT', opMode === 'IMPORT_CONTRACT', opMode);

  const submitBtnLabel = await page.evaluate(() => document.getElementById('contractSubmitBtn')?.innerText);
  record(
    'LỖI ĐÃ VÁ: nhãn nút Gửi ở chế độ Nhập Đã Ký KHÔNG còn ghi "Gửi phê duyệt" (dễ hiểu lầm còn chờ duyệt) — phải nêu rõ KHÔNG qua duyệt',
    !/Gửi phê duyệt/i.test(submitBtnLabel || '') && /Không Qua Duyệt/i.test(submitBtnLabel || ''),
    submitBtnLabel
  );

  await page.evaluate(() => { document.getElementById('contractDept').value = 'Phòng Tài chính Kế toán'; });
  await page.evaluate(() => document.getElementById('contractManagePreviewWfBtn')?.click());
  await page.waitForTimeout(200);
  const modal = await page.evaluate(() => ({
    hidden: document.getElementById('viewDocModal').classList.contains('hidden'),
    footer: document.getElementById('viewModalFooterInfo').innerText,
    content: document.getElementById('viewModalContent').innerHTML
  }));

  record(
    'Preview "Xem Quy Trình Duyệt Tài Liệu Ký" vẫn hiện đúng người duyệt đã cấu hình (Trưởng phòng kế toán)',
    !modal.hidden && modal.content.includes('Trưởng phòng kế toán'),
    JSON.stringify(modal)
  );
  record(
    'LỖI ĐÃ VÁ: footer modal preview ở chế độ Nhập Đã Ký phải cảnh báo RÕ quy trình xem được KHÔNG áp dụng cho hồ sơ đang nhập (hồ sơ sẽ ĐÃ DUYỆT ngay)',
    /KHÔNG qua bước duyệt|ĐÃ DUYỆT ngay/i.test(modal.footer || ''),
    modal.footer
  );

  // Đối chứng: tab "Phê Duyệt" (chế độ NEW, hồ sơ THẬT SỰ đi qua hàng chờ duyệt) vẫn giữ nguyên nhãn
  // "Gửi phê duyệt" — không bị đổi nhầm sang hồ sơ không liên quan.
  await page.evaluate(() => setContractSubTab('APPROVAL'));
  await page.waitForTimeout(100);
  await page.evaluate(() => openContractManageForm());
  await page.waitForTimeout(100);
  const approvalOpMode = await page.evaluate(() => document.getElementById('contractOpMode')?.value);
  const approvalSubmitLabel = await page.evaluate(() => document.getElementById('contractSubmitBtn')?.innerText);
  record(
    'Đối chứng: tab Phê Duyệt (chế độ NEW, hồ sơ THẬT đi qua duyệt) vẫn giữ nguyên nhãn "Gửi phê duyệt"',
    approvalOpMode === 'NEW' && /Gửi phê duyệt/i.test(approvalSubmitLabel || ''),
    JSON.stringify({ approvalOpMode, approvalSubmitLabel })
  );

  record('Không có ngoại lệ JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, pageErrors.join('\n'));

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed} pass, ${failed} fail`);
  if (failed) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
