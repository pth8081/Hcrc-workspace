// server/tests/test-quick-apply-contract-type-filter.js
//
// Hợp Đồng theo Loại Pháp Lý — RELEASE 3/3 (11/2026, "làm giống Văn Bản Trình"): mở rộng tính năng
// "Loại áp dụng" của "⚡ Áp Dụng Nhanh" (trước đây CHỈ hiện/hoạt động cho module "Văn bản trình"/
// SUBMISSION — xem tests/test-quick-apply-submission-type-filter.js) sang module "Hợp đồng - Phê duyệt"
// (CONTRACT_APPROVAL, đã bật cfg.hasTypes từ Release 2) — đúng khuôn collectQuickApplyUnconfiguredTargets()
// GENERIC sẵn theo cfg.hasTypes, chỉ cần tổng quát hoá phần UI (qaTypePickerItems()/
// updateQaSubmissionTypesVisibility()/onQaModuleCheckChange(), xem module-workflow.js).
//
// Dựng lại đúng khuôn tests/test-quick-apply-submission-type-filter.js (static server phục vụ public/ +
// Chromium thật) — đăng nhập admin, điều hướng THẬT vào "Hệ Thống > Áp Dụng Nhanh".
//
// Kiểm tra:
//   A. collectQuickApplyUnconfiguredTargets(['CONTRACT_APPROVAL']) không lọc -> quét ĐỦ 2 loại x 2 phòng
//      ban (4 target) — CONTRACT_APPROVAL cũng chạy qua đúng nhánh cfg.hasTypes như SUBMISSION.
//   B. Lọc CHỈ loại "Hợp đồng kinh tế" -> ĐÚNG 2 target (2 phòng ban), không có "Hợp đồng dịch vụ".
//   C. #qaSubmissionTypesWrap tự HIỆN khi tick CONTRACT_APPROVAL (trước Release 3 CHỈ hiện cho SUBMISSION),
//      tự ẨN khi bỏ tick.
//   D. qaTypePickerItems(['CONTRACT_APPROVAL']) trả đúng 2 loại từ DB.contractTypes (không lẫn submissionTypes).
//   E. qaTypePickerItems(['SUBMISSION','CONTRACT_APPROVAL']) (tick CẢ 2 module) trả HỢP NHẤT cả loại tờ
//      trình lẫn Loại Pháp Lý — không bên nào bị mất khi cả 2 cùng checked.
//   F. Tạo cấu hình lọc "Hợp đồng kinh tế" cho CONTRACT_APPROVAL qua form thật rồi lưu — submissionTypeKeys
//      lưu đúng khoá đã chọn (field tên cũ, nay dùng chung cho mọi module hasTypes).
//   G. Áp dụng cấu hình F — contractTypeApprovalDeptWorkflows CÓ "Hợp đồng kinh tế" cho cả 2 phòng ban,
//      "Hợp đồng dịch vụ" (không chọn trong lọc) hoàn toàn không bị đụng tới.
//   H. renderQuickApplyConfigList() hiện đúng badge "📑 Chỉ loại: Hợp đồng kinh tế" (tra đúng DB.contractTypes,
//      không chỉ DB.submissionTypes).
//   I. editQuickApplyConfig() nạp lại đúng picker + tự hiện lại khối 2b cho CONTRACT_APPROVAL.
//
// Chạy: node server/tests/test-quick-apply-contract-type-filter.js
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
    window.fetch = async (url, opts) => {
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      if (method === 'GET') return { ok: true, status: 200, json: async () => ([]) };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    Object.assign(DB, {
      depts: ['Phòng A', 'Phòng B'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [],
      submissionTypes: [
        { key: 'KINH_PHI', label: 'Tờ trình duyệt kinh phí' },
        { key: 'NHAN_SU', label: 'Tờ trình nhân sự / bổ nhiệm' }
      ],
      contractTypes: ['Hợp đồng kinh tế', 'Hợp đồng dịch vụ'],
      carTypes: [], uniformCatalog: [], itTicketCategories: [],
      workflows: [
        { id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }] },
        { id: 'WF_2STEP', name: 'Quy trình 2 bước', steps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }] }
      ],
      quickApplyConfigs: [],
      deptWorkflows: {},
      docs: [], submissions: [], submissionApprovalGroups: [],
      submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {},
      contracts: [], contractApprovalGroups: [],
      // Hoàn toàn trống — cả 2 loại x 2 phòng ban đều "chưa cấu hình" (không có legacy fallback nào).
      contractTypeApprovalDeptWorkflows: {}, contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
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
      itPriceDeptWorkflows: {}, itPriceTierWorkflows: {},
      uploadFileTypeConfig: {}, uploadSizeLimitConfig: {}, emailConfig: {}, systemLogs: [], externalApiKeys: [],
      vppRegistrations: [], vppDeptWorkflows: {}, vppPeriods: [], itPriceApprovals: [], itServiceRenewals: [], itSupportTickets: [],
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

  // Điều hướng THẬT vào Hệ Thống > 🔀 Nghiệp Vụ Nâng Cao > Áp Dụng Nhanh.
  await page.evaluate(() => document.querySelector('[data-op="switchTab"][data-arg0="system"]')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#btnSystemTab')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('button[data-op-seq*="setSystemSubTab(ADVWORKFLOW)"]')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#btnAdvWorkflowSubQuickApply')?.click());
  await page.waitForTimeout(200);

  const ready = await page.evaluate(() => typeof collectQuickApplyUnconfiguredTargets === 'function' && typeof saveQuickApplyConfig === 'function' && typeof applyQuickApplyConfig === 'function' && typeof qaTypePickerItems === 'function');
  record('setup: module-workflow.js đã nạp xong qua điều hướng thật, các hàm cần test đã sẵn sàng (kể cả qaTypePickerItems() mới)', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục vì hàm chưa nạp được', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===== A: không lọc -> quét ĐỦ 2 loại x 2 phòng ban (4 target) cho CONTRACT_APPROVAL =====
  const targetsNoFilter = await page.evaluate(() => collectQuickApplyUnconfiguredTargets(['CONTRACT_APPROVAL']).map(t => t.label));
  record('A. CONTRACT_APPROVAL không lọc -> quét ĐỦ 4 target (2 loại x 2 phòng ban) — chạy đúng nhánh cfg.hasTypes giống SUBMISSION',
    targetsNoFilter.length === 4 && targetsNoFilter.some(l => l.includes('Hợp đồng kinh tế')) && targetsNoFilter.some(l => l.includes('Hợp đồng dịch vụ')),
    JSON.stringify(targetsNoFilter));

  // ===== B: lọc CHỈ "Hợp đồng kinh tế" -> ĐÚNG 2 target =====
  const targetsFiltered = await page.evaluate(() => collectQuickApplyUnconfiguredTargets(['CONTRACT_APPROVAL'], ['Hợp đồng kinh tế']).map(t => t.label));
  record('B. Lọc CHỈ "Hợp đồng kinh tế": ĐÚNG 2 target (Phòng A + Phòng B)', targetsFiltered.length === 2 && targetsFiltered.every(l => l.includes('Hợp đồng kinh tế')), JSON.stringify(targetsFiltered));
  record('B2. Lọc CHỈ "Hợp đồng kinh tế": KHÔNG có target của "Hợp đồng dịch vụ" (dù đang thiếu cấu hình)', !targetsFiltered.some(l => l.includes('dịch vụ')));

  // ===== C: #qaSubmissionTypesWrap tự HIỆN/ẨN theo checkbox CONTRACT_APPROVAL (Release 3 mở rộng, trước
  // đây CHỈ xét SUBMISSION) =====
  const wrapHiddenInitially = await page.evaluate(() => document.getElementById('qaSubmissionTypesWrap')?.classList.contains('hidden'));
  record('C1. #qaSubmissionTypesWrap ẨN mặc định (chưa tick module nào)', wrapHiddenInitially === true);

  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.qaModuleCheck')).find(x => x.value === 'CONTRACT_APPROVAL');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const wrapVisibleAfterTick = await page.evaluate(() => document.getElementById('qaSubmissionTypesWrap')?.classList.contains('hidden'));
  record('C2. Tick module "Hợp đồng - Phê duyệt" (CONTRACT_APPROVAL): #qaSubmissionTypesWrap tự HIỆN (TRƯỚC Release 3 KHÔNG hiện cho module này)', wrapVisibleAfterTick === false);

  // ===== D: qaTypePickerItems(['CONTRACT_APPROVAL']) chỉ trả đúng 2 loại từ DB.contractTypes =====
  const contractOnlyItems = await page.evaluate(() => qaTypePickerItems(['CONTRACT_APPROVAL']));
  record('D. qaTypePickerItems([\'CONTRACT_APPROVAL\']) trả ĐÚNG 2 loại từ DB.contractTypes, KHÔNG lẫn submissionTypes',
    contractOnlyItems.length === 2 && contractOnlyItems.some(i => i.value === 'Hợp đồng kinh tế') && contractOnlyItems.some(i => i.value === 'Hợp đồng dịch vụ')
      && !contractOnlyItems.some(i => i.value === 'KINH_PHI'),
    JSON.stringify(contractOnlyItems));

  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.qaModuleCheck')).find(x => x.value === 'CONTRACT_APPROVAL');
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const wrapHiddenAfterUntick = await page.evaluate(() => document.getElementById('qaSubmissionTypesWrap')?.classList.contains('hidden'));
  record('C3. Bỏ tick "Hợp đồng - Phê duyệt": #qaSubmissionTypesWrap tự ẨN lại', wrapHiddenAfterUntick === true);

  // ===== E: tick CẢ SUBMISSION lẫn CONTRACT_APPROVAL -> picker HỢP NHẤT cả 2 loại, không mất bên nào =====
  const mixedItems = await page.evaluate(() => qaTypePickerItems(['SUBMISSION', 'CONTRACT_APPROVAL']));
  record('E. qaTypePickerItems([\'SUBMISSION\',\'CONTRACT_APPROVAL\']) trả HỢP NHẤT: có CẢ loại tờ trình (KINH_PHI) lẫn Loại Pháp Lý (Hợp đồng kinh tế)',
    mixedItems.some(i => i.value === 'KINH_PHI') && mixedItems.some(i => i.value === 'Hợp đồng kinh tế') && mixedItems.length === 4,
    JSON.stringify(mixedItems));

  // ===== F: tạo cấu hình lọc "Hợp đồng kinh tế" cho CONTRACT_APPROVAL qua form thật rồi lưu =====
  await page.evaluate(() => {
    document.getElementById('qaTplSelect').value = 'WF_1STEP';
    document.querySelectorAll('.qaModuleCheck').forEach(el => {
      const checked = (el.value === 'CONTRACT_APPROVAL');
      el.checked = checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    gmsAdd('qaSubmissionTypesPicker', 'Hợp đồng kinh tế');
    saveQuickApplyConfig({ preventDefault() {} });
  });
  const afterCreate = await page.evaluate(() => ({ count: (DB.quickApplyConfigs || []).length, cfg: DB.quickApplyConfigs[0] }));
  record('F1. Cấu hình lọc: được thêm vào DB.quickApplyConfigs (1 phần tử, phạm vi [CONTRACT_APPROVAL])', afterCreate.count === 1 && JSON.stringify(afterCreate.cfg?.modules) === JSON.stringify(['CONTRACT_APPROVAL']));
  record('F2. Cấu hình lọc: submissionTypeKeys lưu ĐÚNG khoá đã chọn ("Hợp đồng kinh tế")', JSON.stringify(afterCreate.cfg?.submissionTypeKeys || []) === JSON.stringify(['Hợp đồng kinh tế']), JSON.stringify(afterCreate.cfg?.submissionTypeKeys));
  const configId = afterCreate.cfg.id;

  // ===== G: áp dụng — CHỈ "Hợp đồng kinh tế" được điền, "Hợp đồng dịch vụ" không bị đụng =====
  await page.evaluate((id) => applyQuickApplyConfig(id), configId);
  const afterApply = await page.evaluate(() => DB.contractTypeApprovalDeptWorkflows);
  record('G1. Áp dụng: "Hợp đồng kinh tế" được điền cho cả Phòng A + Phòng B', !!afterApply['Hợp đồng kinh tế']?.['Phòng A'] && !!afterApply['Hợp đồng kinh tế']?.['Phòng B'], JSON.stringify(afterApply));
  record('G2. Áp dụng: "Hợp đồng dịch vụ" (KHÔNG chọn trong lọc) hoàn toàn KHÔNG bị đụng tới, dù đang thiếu cấu hình', !afterApply['Hợp đồng dịch vụ'] || Object.keys(afterApply['Hợp đồng dịch vụ']).length === 0, JSON.stringify(afterApply['Hợp đồng dịch vụ']));
  record('G3. Áp dụng: KHÔNG đụng gì tới contractApprovalDeptWorkflows (map phẳng cũ) — chỉ ghi map lồng mới', Object.keys((await page.evaluate(() => DB.contractApprovalDeptWorkflows)) || {}).length === 0);

  // ===== H: renderQuickApplyConfigList() hiện đúng badge, tra được nhãn từ DB.contractTypes =====
  const listHtml = await page.evaluate(() => document.getElementById('quickApplyConfigList').innerHTML);
  record('H. Danh sách cấu hình hiện badge "📑 Chỉ loại: Hợp đồng kinh tế" (tra đúng DB.contractTypes, không chỉ submissionTypes)', listHtml.includes('Chỉ loại') && listHtml.includes('Hợp đồng kinh tế'), listHtml.slice(0, 400));

  // ===== I: editQuickApplyConfig() nạp lại ĐÚNG picker + tự hiện lại khối 2b cho CONTRACT_APPROVAL =====
  await page.evaluate(() => closeQuickApplyConfigForm());
  await page.evaluate((id) => editQuickApplyConfig(id), configId);
  const editState = await page.evaluate(() => ({
    wrapHidden: document.getElementById('qaSubmissionTypesWrap')?.classList.contains('hidden'),
    values: getMultiSelectValues('qaSubmissionTypesPicker')
  }));
  record('I1. editQuickApplyConfig(): #qaSubmissionTypesWrap tự HIỆN lại (module CONTRACT_APPROVAL đang tick)', editState.wrapHidden === false);
  record('I2. editQuickApplyConfig(): picker nạp lại ĐÚNG giá trị đã lưu ("Hợp đồng kinh tế")', JSON.stringify(editState.values) === JSON.stringify(['Hợp đồng kinh tế']), JSON.stringify(editState.values));

  record('Không có lỗi JS chưa bắt nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();
  return finish();
}

function finish() {
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
