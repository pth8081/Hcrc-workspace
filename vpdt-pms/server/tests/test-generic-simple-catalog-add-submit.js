// server/tests/test-generic-simple-catalog-add-submit.js
//
// LỖI ĐÃ VÁ (10/2026, người dùng báo "Cấp Bậc/Lý Do Nghỉ Việc/Loại Kỷ Luật — không add được thông tin
// vào đâu cả"): 3 form "Thêm" này (Hệ Thống > Quản Trị > 🗂️ Quản Lý Danh Mục) dùng
// data-op-submit="saveGenericSimpleCatalogEntry" data-arg0="'<key>'" — nhưng nhánh 'submit' của
// bindCspDelegation() (core.js) KHÔNG hề gọi cspCollectArgs() như 3 nhánh click/change/input kia, nó
// LUÔN gọi cứng fn(e) (chỉ truyền SubmitEvent), bỏ qua hoàn toàn data-arg0. Hậu quả: key nhận được
// trong saveGenericSimpleCatalogEntry() CHÍNH LÀ SubmitEvent (không phải chuỗi 'disciplinaryTypes'...),
// GENERIC_SIMPLE_CATALOGS[key] luôn undefined -> hàm return NGAY DÒNG ĐẦU, im lặng hoàn toàn (không
// alert, không gọi API, không xoá input) — đúng khớp mô tả "bấm Thêm không có tác dụng gì".
//
// Vá tại điểm hẹp nhất (module-admin.js): saveGenericSimpleCatalogEntry() đổi sang nhận event thật,
// tự đọc key từ data-catalog-key đặt ngay trên <form> (e.target lúc 'submit' chính là form) — đổi 3
// form liên quan ở systemSection.html từ data-arg0="'<key>'" sang data-catalog-key="<key>" tương ứng.
// KHÔNG đổi cơ chế dispatch 'submit' dùng chung (tránh ảnh hưởng ~70 form data-op-submit khác đang dựa
// đúng quy ước fn(e) hiện tại).
//
// Test THẬT qua UI (Chromium thật + index.html/module-admin.js thật, chỉ stub window.fetch) — đi đúng
// đường người dùng gặp lỗi: vào Quản Lý Danh Mục -> mở khối "Danh Mục Loại Kỷ Luật" (đang đóng mặc
// định) -> điền ô "Thêm" -> bấm nút "Thêm" THẬT (form submit thật, không gọi thẳng hàm JS) -> xác nhận
// có phản hồi (gọi đúng API, danh sách tự vẽ lại, input tự xoá) thay vì im lặng. Dựng theo đúng khuôn
// tests/test-orgchart-diagram-tab.js (static server phục vụ public/, stub fetch).
//
// Chạy: node server/tests/test-generic-simple-catalog-add-submit.js
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
    window.alert = (m) => { window.__lastAlert = String(m); };
    window.confirm = () => true;
    window.prompt = () => '';
    window.__fetchCalls = [];
    window.fetch = async (url, opts) => {
      window.__fetchCalls.push({ url: String(url), method: (opts && opts.method) || 'GET' });
      if (String(url).startsWith('/api/data/')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      return { ok: true, status: 200, json: async () => ([]) };
    };
    Object.assign(DB, {
      depts: [], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], positionTypes: [], jobGrades: [], resignationReasons: [], disciplinaryTypes: [],
      users: [{ id: 1, username: 'admin', name: 'QTV', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }],
      workflows: [], quickApplyConfigs: [], deptWorkflows: {}, deptGroups: [],
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
      uniformCatalog: [], itTicketCategories: [], storeTypes: [],
      _versions: {}
    });
    finishLogin(DB.users[0]);
  });

  await page.evaluate(() => { switchTab('system'); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { setSystemSubTab('ADMIN'); setAdminSubTab('CATALOG'); });
  await page.waitForTimeout(300);

  const CATALOGS = [
    { key: 'jobGrades', inputId: 'txtJobGradeName', listId: 'jobGradeList', value: 'L9 Test' },
    { key: 'resignationReasons', inputId: 'txtResignationReasonName', listId: 'resignationReasonList', value: 'Chuyển việc Test' },
    { key: 'disciplinaryTypes', inputId: 'txtDisciplinaryTypeName', listId: 'disciplinaryTypeList', value: 'Khiển Trách Test' }
  ];

  for (const cat of CATALOGS) {
    // Mở <details> đang đóng mặc định bằng click DOM thật vào <summary> (giống người dùng thật).
    await page.evaluate((inputId) => {
      document.getElementById(inputId).closest('details').querySelector('summary').click();
    }, cat.inputId);
    await page.waitForTimeout(80);

    const isOpen = await page.evaluate((inputId) => document.getElementById(inputId).closest('details').open, cat.inputId);
    record(`[${cat.key}] Bấm summary mở được khối danh mục (details.open === true)`, isOpen);

    // Điền + bấm nút "Thêm" THẬT (form submit thật qua click, không gọi thẳng saveGenericSimpleCatalogEntry()).
    await page.fill(`#${cat.inputId}`, cat.value);
    await page.click(`#${cat.inputId} ~ button[type="submit"], form:has(#${cat.inputId}) button[type="submit"]`).catch(async () => {
      // Phòng trường hợp CSS :has() không được hỗ trợ bản Chromium cũ — fallback evaluate() tìm nút Thêm trong đúng <form> cha.
      await page.evaluate((inputId) => {
        document.getElementById(inputId).closest('form').querySelector('button[type="submit"]').click();
      }, cat.inputId);
    });
    await page.waitForTimeout(150);

    const after = await page.evaluate(({ key, inputId, listId, value }) => ({
      added: (DB[key] || []).includes(value),
      inputCleared: document.getElementById(inputId).value === '',
      fetchCalled: window.__fetchCalls.some(c => c.url === `/api/data/${key}` && c.method === 'POST'),
      listHasValue: document.getElementById(listId).innerHTML.includes(value)
    }), cat);

    record(`[${cat.key}] Bấm nút "Thêm" THẬT -> gọi đúng POST /api/data/${cat.key} (không còn im lặng)`, after.fetchCalled);
    record(`[${cat.key}] DB.${cat.key} có giá trị mới vừa thêm`, after.added);
    record(`[${cat.key}] Ô nhập tự xoá sau khi thêm thành công`, after.inputCleared);
    record(`[${cat.key}] Danh sách tự vẽ lại, hiện đúng giá trị mới`, after.listHasValue);
  }

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
