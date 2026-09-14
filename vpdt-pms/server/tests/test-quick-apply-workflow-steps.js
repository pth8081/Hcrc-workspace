// server/tests/test-quick-apply-workflow-steps.js
//
// Regression cho tính năng "⚡ Áp Dụng Nhanh Số Bước Cho Toàn Bộ Quy Trình" (Hệ Thống > Quy Trình & Phê
// Duyệt) — set NHANH cùng 1 mẫu quy trình (workflowId) cho MỌI phòng ban/mức CHƯA từng cấu hình, trên
// TOÀN BỘ WF_MODULE_CONFIG cùng lúc, KHÔNG tự gán người duyệt và TUYỆT ĐỐI KHÔNG đụng tới bất kỳ mục
// nào ĐÃ có cấu hình từ trước (xem collectQuickApplyUnconfiguredTargets()/applyQuickApplyWorkflowSteps()
// ở module-workflow.js).
//
// Dựng lại đúng khuôn tests/test-lazy-load-all-tabs.js (static server phục vụ public/ + Chromium thật,
// vì đây là logic client-side thuần đọc/ghi biến toàn cục DB — không có route server nào cần test) —
// đăng nhập admin, điều hướng THẬT (click) vào "Hệ Thống > Quy Trình & Phê Duyệt" để trigger đúng
// loadModuleGroup() nạp module-workflow.js/module-itsupport-tier.js, rồi gọi thẳng các hàm qua
// page.evaluate() để kiểm tra state DB sau khi áp dụng.
//
// Kiểm tra 5 khuôn dữ liệu khác nhau của WF_MODULE_CONFIG cùng lúc:
//   1. Phẳng thường (CAR) — 1 phòng ban đã cấu hình (giữ nguyên), 1 phòng ban chưa (được điền).
//   2. hasTypes (SUBMISSION) — 1 phòng ban có cấu hình LEGACY (phẳng, không theo loại) phải được coi là
//      "đã cấu hình" (không tạo type-specific đè lên), phòng ban còn lại hoàn toàn trống thì được điền
//      type-specific mới.
//   3. priceTypeNested (ITPRICE) — nhánh RETAIL (lồng theo dept) + nhánh WHOLESALE (tier phẳng riêng)
//      cùng lúc, mỗi nhánh có 1 phần đã cấu hình/1 phần chưa.
//   4. pureTier (OPERATION_ORDER_STORE) — hoàn toàn trống, cả 3 tier phải được điền hết.
//   5. Module bị loại khỏi phạm vi (OPERATION_STORE_OPEN) — dù trống hoàn toàn, KHÔNG được điền gì cả.
//
// Chạy: node server/tests/test-quick-apply-workflow-steps.js
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
      jobTitles: [], storeJobTitles: [], submissionTypes: [{ key: 'DE_XUAT', label: 'Đề Xuất' }],
      contractTypes: [], carTypes: [], uniformCatalog: [], itTicketCategories: [],
      workflows: [
        { id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }] },
        { id: 'WF_2STEP', name: 'Quy trình 2 bước', steps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }] }
      ],
      deptWorkflows: {},
      docs: [], submissions: [], submissionApprovalGroups: {},
      // (2) hasTypes — Phòng A đã có cấu hình LEGACY (áp dụng mọi loại qua fallback), Phòng B trống hẳn.
      submissionTypeDeptWorkflows: {},
      submissionDeptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approvers: { 1: ['legacy_approver'] } } },
      contracts: [], contractApprovalGroups: {}, contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
      meetings: [], meetingMinutes: [], meetingAttendeeTemplates: [],
      // (1) phẳng thường — Phòng A đã cấu hình (PHẢI giữ nguyên), Phòng B trống.
      carRegs: [], carDeptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approvers: { 1: ['car_approver'] } } },
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
      // (3) priceTypeNested — Phòng A/RETAIL đã cấu hình (giữ nguyên), Phòng B/RETAIL trống; tier
      // MARGIN_LT5 đã cấu hình (giữ nguyên), 3 tier còn lại trống.
      itPriceDeptWorkflows: { 'Phòng A': { RETAIL: { workflowId: 'WF_1STEP', approvers: { 1: ['itprice_approver'] } } } },
      itPriceTierWorkflows: { MARGIN_LT5: { workflowId: 'WF_1STEP', approvers: { 1: ['tier_approver'] } } },
      uploadFileTypeConfig: {}, uploadSizeLimitConfig: {}, emailConfig: {}, systemLogs: [], externalApiKeys: [],
      vppRegistrations: [], vppDeptWorkflows: {}, vppPeriods: [], itPriceApprovals: [], itServiceRenewals: [], itSupportTickets: [],
      budgetEntries: [], budgetDeptWorkflows: {}, budgetTemplates: [], budgetPeriods: [],
      reportPeriods: [], reportEntries: [], licenses: [], licenseTypes: [],
      // (4) pureTier — hoàn toàn trống, cả 3 tier phải được điền hết.
      operationOrders: [], operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {},
      // (5) module bị loại khỏi phạm vi — hoàn toàn trống nhưng KHÔNG được đụng tới.
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

  // Điều hướng THẬT vào Hệ Thống > Quy Trình & Phê Duyệt (trigger loadModuleGroup() nạp
  // module-workflow.js/module-itsupport-tier.js/module-ngansach.js — cùng khuôn test-lazy-load-all-tabs.js).
  await page.evaluate(() => document.querySelector('[data-op="switchTab"][data-arg0="system"]')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#btnSystemTab')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('button[data-op-seq*="setSystemSubTab(WORKFLOW)"]')?.click());
  await page.waitForTimeout(200);

  const ready = await page.evaluate(() => typeof collectQuickApplyUnconfiguredTargets === 'function' && typeof applyQuickApplyWorkflowSteps === 'function');
  record('setup: module-workflow.js đã nạp xong qua điều hướng thật, 2 hàm cần test đã sẵn sàng', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục vì hàm chưa nạp được', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===== Bước 1: liệt kê target (trước khi áp dụng) — kiểm tra ĐÚNG những gì được coi là "chưa cấu hình" =====
  const targetsBefore = await page.evaluate(() => collectQuickApplyUnconfiguredTargets().map(t => ({ label: t.label, dbKey: t.dbKey })));

  const hasTarget = (labelSubstr) => targetsBefore.some(t => t.label.includes(labelSubstr));
  record('CAR: Phòng B (chưa cấu hình) NẰM TRONG danh sách target', hasTarget('Đăng ký xe') && targetsBefore.some(t => t.label.includes('Đăng ký xe') && t.label.includes('Phòng B')));
  record('CAR: Phòng A (đã cấu hình) KHÔNG nằm trong danh sách target', !targetsBefore.some(t => t.label.includes('Đăng ký xe') && t.label.includes('Phòng A')));
  record('SUBMISSION: Phòng A có cấu hình LEGACY -> KHÔNG bị coi là thiếu cấu hình (không tạo type-specific đè lên)', !targetsBefore.some(t => t.label.includes('Văn bản trình') && t.label.includes('Phòng A')));
  record('SUBMISSION: Phòng B hoàn toàn trống -> NẰM TRONG danh sách target', targetsBefore.some(t => t.label.includes('Văn bản trình') && t.label.includes('Phòng B')));
  record('ITPRICE RETAIL: Phòng A đã cấu hình -> KHÔNG nằm trong target', !targetsBefore.some(t => t.label.includes('Bán Lẻ') && t.label.includes('Phòng A')));
  record('ITPRICE RETAIL: Phòng B chưa cấu hình -> NẰM TRONG target', targetsBefore.some(t => t.label.includes('Bán Lẻ') && t.label.includes('Phòng B')));
  record('ITPRICE WHOLESALE: mức MARGIN_LT5 đã cấu hình -> KHÔNG nằm trong target', !targetsBefore.some(t => t.label.includes('Bán Buôn') && t.label.includes('Margin < 5%')));
  record('ITPRICE WHOLESALE: 3 mức còn lại chưa cấu hình -> NẰM TRONG target', ['Margin ≥ 5%', 'Chiết khấu ≤ 5%', 'Chiết khấu > 5%'].every(l => targetsBefore.some(t => t.label.includes('Bán Buôn') && t.label.includes(l))));
  record('OPERATION_ORDER_STORE (pureTier, trống hẳn): cả 3 tier đều NẰM TRONG target', ['≤ 10 triệu', '> 10 triệu - ≤ 100 triệu', '> 100 triệu'].every(l => targetsBefore.some(t => t.label.includes('Đặt Hàng Tại Siêu Thị') && t.label.includes(l))));
  record('OPERATION_STORE_OPEN (module bị loại khỏi phạm vi, dù trống hẳn): KHÔNG xuất hiện trong target', !targetsBefore.some(t => t.label.includes('Mở Mới Siêu Thị')));

  // ===== Bước 2: áp dụng thật (chọn WF_2STEP) rồi kiểm tra state DB sau khi áp dụng =====
  await page.evaluate(() => { document.getElementById('quickApplyWfSelect').value = 'WF_2STEP'; });
  await page.evaluate(() => applyQuickApplyWorkflowSteps());
  await page.waitForTimeout(50);

  const after = await page.evaluate(() => ({
    carA: DB.carDeptWorkflows['Phòng A'], carB: DB.carDeptWorkflows['Phòng B'],
    subLegacyA: DB.submissionDeptWorkflows['Phòng A'],
    subTypeSpecificA: DB.submissionTypeDeptWorkflows?.DE_XUAT?.['Phòng A'],
    subTypeSpecificB: DB.submissionTypeDeptWorkflows?.DE_XUAT?.['Phòng B'],
    itPriceRetailA: DB.itPriceDeptWorkflows['Phòng A']?.RETAIL, itPriceRetailB: DB.itPriceDeptWorkflows['Phòng B']?.RETAIL,
    tierMarginLt5: DB.itPriceTierWorkflows.MARGIN_LT5, tierMarginGte5: DB.itPriceTierWorkflows.MARGIN_GTE5,
    opOrderStoreLT10M: DB.operationOrderStoreTierWorkflows.LT10M,
    opStoreOpenA: DB.operationStoreOpenDeptWorkflows['Phòng A'], opStoreOpenB: DB.operationStoreOpenDeptWorkflows['Phòng B'],
    targetsAfter: collectQuickApplyUnconfiguredTargets().length
  }));

  record('CAR: Phòng A (đã cấu hình từ trước) GIỮ NGUYÊN workflowId + approvers, KHÔNG bị ghi đè', after.carA?.workflowId === 'WF_1STEP' && JSON.stringify(after.carA?.approvers) === JSON.stringify({ 1: ['car_approver'] }));
  record('CAR: Phòng B được điền đúng mẫu vừa chọn (WF_2STEP), approvers RỖNG (không tự gán người duyệt)', after.carB?.workflowId === 'WF_2STEP' && JSON.stringify(after.carB?.approvers) === JSON.stringify({}));
  record('SUBMISSION: cấu hình LEGACY của Phòng A GIỮ NGUYÊN (không bị đụng tới)', after.subLegacyA?.workflowId === 'WF_1STEP' && JSON.stringify(after.subLegacyA?.approvers) === JSON.stringify({ 1: ['legacy_approver'] }));
  record('SUBMISSION: KHÔNG tạo type-specific đè lên Phòng A dù legacy vẫn cung cấp fallback', after.subTypeSpecificA === undefined);
  record('SUBMISSION: Phòng B (trống hẳn) được tạo type-specific mới đúng mẫu WF_2STEP', after.subTypeSpecificB?.workflowId === 'WF_2STEP');
  record('ITPRICE RETAIL: Phòng A GIỮ NGUYÊN', after.itPriceRetailA?.workflowId === 'WF_1STEP' && JSON.stringify(after.itPriceRetailA?.approvers) === JSON.stringify({ 1: ['itprice_approver'] }));
  record('ITPRICE RETAIL: Phòng B được điền mới', after.itPriceRetailB?.workflowId === 'WF_2STEP');
  record('ITPRICE WHOLESALE: mức MARGIN_LT5 GIỮ NGUYÊN', after.tierMarginLt5?.workflowId === 'WF_1STEP' && JSON.stringify(after.tierMarginLt5?.approvers) === JSON.stringify({ 1: ['tier_approver'] }));
  record('ITPRICE WHOLESALE: mức MARGIN_GTE5 (trống) được điền mới', after.tierMarginGte5?.workflowId === 'WF_2STEP');
  record('OPERATION_ORDER_STORE: tier LT10M (trống hẳn) được điền mới', after.opOrderStoreLT10M?.workflowId === 'WF_2STEP');
  record('OPERATION_STORE_OPEN: VẪN hoàn toàn trống sau khi áp dụng (module bị loại khỏi phạm vi, không bị điền)', after.opStoreOpenA === undefined && after.opStoreOpenB === undefined);
  record('Sau khi áp dụng: collectQuickApplyUnconfiguredTargets() không còn liệt kê lại các mục VỪA được điền (idempotent)', after.targetsAfter < targetsBefore.length);

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
