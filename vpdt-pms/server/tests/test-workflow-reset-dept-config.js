// server/tests/test-workflow-reset-dept-config.js
//
// Regression cho tính năng "🗑️ Xoá Cấu Hình" (yêu cầu người dùng 9/2026, kèm ảnh): màn "Hệ Thống > Quy
// Trình & Phê Duyệt" LUÔN hiện tạm "Quy trình chung (1 bước)" cho phòng ban CHƯA từng cấu hình (chỉ để
// không trống trơn, xem savedConfig fallback ở renderWorkflowTab()/renderItPriceTierWorkflowTab()) — nếu
// admin lỡ bấm "Lưu Cấu Hình" trong lúc đang hiện giá trị tạm này, nó ghi THẬT xuống server, khiến phòng
// ban đó vĩnh viễn bị "⚡ Áp Dụng Nhanh" coi là "đã cấu hình" (collectQuickApplyUnconfiguredTargets() bỏ
// qua), không cách nào đưa về lại "chưa cấu hình". Thêm nút "🗑️ Xoá Cấu Hình [phòng ban]" (từng thẻ,
// giống hệt khuôn nút "Lưu Cấu Hình [phòng ban]") + "🗑️ Xoá Cấu Hình Tất Cả" (giống khuôn "💾 Lưu Cấu
// Hình Tất Cả") — xoá HẲN entry khỏi DB, đưa phòng ban về "chưa cấu hình" để Quick Apply nhận diện lại.
//
// Kiểm tra:
//   A. Phòng ban ĐÃ có cấu hình thật (VPP, dạng phẳng) -> thẻ có nút "🗑️ Xoá Cấu Hình [...]"; phòng ban
//      CHƯA từng cấu hình (chỉ hiện mặc định tạm) -> KHÔNG có nút này.
//   B. Bấm "🗑️ Xoá Cấu Hình [Phòng A]" (xác nhận confirm) -> DB.vppDeptWorkflows['Phòng A'] bị xoá hẳn,
//      thẻ Phòng A không còn nút Xoá nữa (đã về "chưa cấu hình"), và collectQuickApplyUnconfiguredTargets
//      (['VPP']) giờ liệt kê ĐỦ CẢ 2 phòng ban (trước đó chỉ có Phòng B).
//   C. "🗑️ Xoá Cấu Hình Tất Cả" (resetAllDeptWorkflowConfigs) xoá 1 lượt MỌI phòng ban ĐANG thật sự có
//      cấu hình trong module/scope hiện tại, không đụng phòng ban vốn đã "chưa cấu hình".
//
// Chạy: node server/tests/test-workflow-reset-dept-config.js
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
    window.__confirmAnswer = true;
    window.confirm = () => window.__confirmAnswer;
    window.alert = () => {};
    window.prompt = () => '';
    window.fetch = async (url, opts) => {
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      if (method === 'GET') return { ok: true, status: 200, json: async () => ([]) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    Object.assign(DB, {
      depts: ['Phòng A', 'Phòng B', 'Phòng C'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], submissionTypes: [{ key: 'DE_XUAT', label: 'Đề Xuất' }],
      contractTypes: [], carTypes: [], uniformCatalog: [], itTicketCategories: [],
      workflows: [
        { id: 'WF_1STEP', name: 'Quy trình chung', steps: [{ order: 1, name: 'B1' }] },
        { id: 'WF_3STEP', name: 'Quy trình 3 bước', steps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }, { order: 3, name: 'B3' }] }
      ],
      quickApplyConfigs: [],
      deptWorkflows: {},
      docs: [], submissions: [], submissionApprovalGroups: [],
      submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {},
      contracts: [], contractApprovalGroups: [], contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
      meetings: [], meetingMinutes: [], meetingAttendeeTemplates: [],
      carRegs: [], carDeptWorkflows: {},
      officeReqs: [], officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {},
      tasks: [], internalPosts: [], internalNewsCategories: [], internalShareCategories: [],
      trainingCategories: [], trainingDocuments: [], trainingClasses: [], trainingRegistrations: [],
      careerPaths: [], careerPathConfirmations: [], trainingTests: [], trainingTestSubmissions: [],
      trainingCourses: [], trainingPlans: [], onboardingPaths: [], onboardingProgress: [],
      recruitmentJobs: [], recruitmentReferrals: [], hrFeedback: [], sensitiveKeywords: [],
      paymentRequests: [], paymentDeptWorkflows: {}, formTemplates: {}, permGroups: [], users: [],
      vppExcludeGroups: [], vppExcludedJobTitles: [], workflowParticipatingDepts: [], workflowParticipatingPositions: [],
      pwaShortcutModules: [],
      itPriceMasterLists: [],
      itPriceDeptWorkflows: {},
      itPriceTierWorkflows: {},
      uploadFileTypeConfig: {}, uploadSizeLimitConfig: {}, emailConfig: {}, systemLogs: [], externalApiKeys: [],
      // Phòng A: ĐÃ có cấu hình thật (mô phỏng đúng kịch bản người dùng báo — admin lỡ lưu lại giá trị
      // mặc định 1 bước lúc màn đang hiện tạm). Phòng B: hoàn toàn CHƯA cấu hình. Phòng C: sẽ được seed
      // lại ở bước C (test "Xoá Tất Cả") để không ảnh hưởng bước A/B.
      vppRegistrations: [], vppDeptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } } }, vppPeriods: [], itPriceApprovals: [], itServiceRenewals: [], itSupportTickets: [],
      budgetEntries: [], budgetDeptWorkflows: {}, budgetTemplates: [], budgetPeriods: [],
      reportPeriods: [], reportEntries: [], licenses: [], licenseTypes: [],
      operationOrders: [], operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {},
      operationStoreOpenings: [], operationStoreOpenDeptWorkflows: {},
      operationRepairs: [], operationRepairDeptWorkflows: {},
      operationWorkItems: [], operationExecutionPeriods: [], orgChartManagerOverrides: {},
      _versions: {}
    });

    const adminUser = {
      id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng A', jobTitle: 'Nhân viên',
      email: 'admin@test.local', phone: '0900000000', perms: { admin: true }, groupIds: [], permOverrides: null
    };
    DB.users.push(adminUser);
    finishLogin(adminUser);
  });

  // Điều hướng THẬT vào Hệ Thống > 🔄 Quy Trình & Phê Duyệt > module VPP. #btnSystemTab chỉ TOGGLE dropdown
  // tĩnh (data-op="toggleHeThongDropdown") — gọi thẳng switchTab('system') (đúng hàm dropdown gọi khi bấm
  // mục con), tránh phải mô phỏng thao tác mở dropdown không cần thiết cho bài test này.
  await page.evaluate(() => switchTab('system'));
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('#btnSystemSubWorkflow')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#btnWfModVpp')?.click());
  await page.waitForTimeout(200);

  const ready = await page.evaluate(() => typeof resetDeptWorkflowConfig === 'function' && typeof resetAllDeptWorkflowConfigs === 'function' && typeof collectQuickApplyUnconfiguredTargets === 'function');
  record('setup: module-itsupport-tier.js đã nạp xong, các hàm reset đã sẵn sàng', ready);
  if (!ready) { console.log('DỪNG SỚM:', JSON.stringify(pageErrors)); await browser.close(); server.close(); process.exit(1); }

  // ---- A. Chỉ phòng ban ĐÃ cấu hình thật mới có nút "🗑️ Xoá Cấu Hình" ----
  const initialButtons = await page.evaluate(() => ({
    aHasReset: !!document.querySelector('button[data-op="resetDeptWorkflowConfig"][data-arg0="Phòng A"]'),
    bHasReset: !!document.querySelector('button[data-op="resetDeptWorkflowConfig"][data-arg0="Phòng B"]'),
    aHasSave: !!document.querySelector('button[data-op="saveDeptWorkflowConfig"][data-arg0="Phòng A"]'),
    bHasSave: !!document.querySelector('button[data-op="saveDeptWorkflowConfig"][data-arg0="Phòng B"]')
  }));
  record('Phòng A (đã cấu hình thật) CÓ nút "🗑️ Xoá Cấu Hình"', initialButtons.aHasReset, JSON.stringify(initialButtons));
  record('Phòng B (chưa từng cấu hình, chỉ hiện mặc định tạm) KHÔNG có nút "🗑️ Xoá Cấu Hình"', !initialButtons.bHasReset, JSON.stringify(initialButtons));
  record('Cả 2 phòng ban đều có nút "Lưu Cấu Hình" như cũ (không đổi hành vi cũ)', initialButtons.aHasSave && initialButtons.bHasSave, JSON.stringify(initialButtons));

  // Phòng C cũng chưa từng cấu hình gì ở bước này (chỉ được seed cấu hình RIÊNG ở phần C bên dưới) — nên
  // TRƯỚC khi xoá, Quick Apply thấy ĐỦ Phòng B + Phòng C (2 phòng), CHỈ thiếu đúng Phòng A (đang bị chặn).
  const beforeResetTargets = await page.evaluate(() => collectQuickApplyUnconfiguredTargets(['VPP']).map(t => t.label));
  record('TRƯỚC khi xoá: Quick Apply thấy Phòng B + Phòng C là mục thiếu cấu hình (Phòng A bị chặn)',
    beforeResetTargets.length === 2 && beforeResetTargets.some(t => t.includes('Phòng B')) && beforeResetTargets.some(t => t.includes('Phòng C')),
    JSON.stringify(beforeResetTargets));

  // ---- B. Bấm "🗑️ Xoá Cấu Hình [Phòng A]" -> xoá hẳn, Quick Apply nhận lại được ----
  await page.evaluate(() => document.querySelector('button[data-op="resetDeptWorkflowConfig"][data-arg0="Phòng A"]')?.click());
  await page.waitForTimeout(150);

  const afterReset = await page.evaluate(() => ({
    vppA: DB.vppDeptWorkflows['Phòng A'],
    aHasResetBtn: !!document.querySelector('button[data-op="resetDeptWorkflowConfig"][data-arg0="Phòng A"]'),
    targets: collectQuickApplyUnconfiguredTargets(['VPP']).map(t => t.label)
  }));
  record('SAU khi xoá: DB.vppDeptWorkflows["Phòng A"] bị xoá hẳn (undefined)', afterReset.vppA === undefined, JSON.stringify(afterReset));
  record('SAU khi xoá: thẻ Phòng A KHÔNG còn nút "🗑️ Xoá Cấu Hình" (đã về chưa cấu hình)', !afterReset.aHasResetBtn, JSON.stringify(afterReset));
  record('SAU khi xoá: Quick Apply giờ thấy ĐỦ CẢ 3 phòng ban (Phòng A vừa xoá + Phòng B/Phòng C vốn đã trống)', afterReset.targets.length === 3, JSON.stringify(afterReset));

  // ---- C. "🗑️ Xoá Cấu Hình Tất Cả" (resetAllDeptWorkflowConfigs) — seed lại Phòng A + Phòng C ----
  await page.evaluate(() => {
    DB.vppDeptWorkflows['Phòng A'] = { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
    DB.vppDeptWorkflows['Phòng C'] = { workflowId: 'WF_3STEP', approvers: { 1: ['admin'], 2: ['admin'], 3: ['admin'] } };
    renderWorkflowTab();
  });
  const beforeResetAll = await page.evaluate(() => ({
    a: !!DB.vppDeptWorkflows['Phòng A'], b: !!DB.vppDeptWorkflows['Phòng B'], c: !!DB.vppDeptWorkflows['Phòng C']
  }));
  record('Seed lại: Phòng A + Phòng C có cấu hình, Phòng B vẫn trống (chuẩn bị test Xoá Tất Cả)', beforeResetAll.a && !beforeResetAll.b && beforeResetAll.c, JSON.stringify(beforeResetAll));

  await page.evaluate(() => document.querySelector('button[data-op="resetAllDeptWorkflowConfigs"]')?.click());
  await page.waitForTimeout(150);

  const afterResetAll = await page.evaluate(() => ({
    a: DB.vppDeptWorkflows['Phòng A'], b: DB.vppDeptWorkflows['Phòng B'], c: DB.vppDeptWorkflows['Phòng C'],
    targets: collectQuickApplyUnconfiguredTargets(['VPP']).map(t => t.label)
  }));
  record('"🗑️ Xoá Cấu Hình Tất Cả": xoá hẳn CẢ Phòng A lẫn Phòng C (2 phòng đang có cấu hình thật)', afterResetAll.a === undefined && afterResetAll.c === undefined, JSON.stringify(afterResetAll));
  record('"🗑️ Xoá Cấu Hình Tất Cả": Quick Apply giờ thấy ĐỦ CẢ 3 phòng ban', afterResetAll.targets.length === 3, JSON.stringify(afterResetAll));

  record('Không có lỗi JS (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  await new Promise((resolve) => server.close(resolve));

  const passCount = results.filter(r => r.pass).length;
  console.log(`\n${passCount}/${results.length} scenarios passed.`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exit(1); });
