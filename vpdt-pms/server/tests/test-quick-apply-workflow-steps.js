// server/tests/test-quick-apply-workflow-steps.js
//
// Regression cho tính năng "⚡ Áp Dụng Nhanh" (sub-tab RIÊNG "Hệ Thống > Áp Dụng Nhanh", tách khỏi
// "Quy Trình & Phê Duyệt") — cho phép tạo NHIỀU cấu hình độc lập (DB.quickApplyConfigs), mỗi cấu hình
// gắn 1 mẫu quy trình (workflowId, tức số bước) vào ĐÚNG các module admin chọn cho cấu hình đó, thay vì
// chỉ có 1 lượt chọn 1 mẫu áp dụng cho TOÀN BỘ quy trình như thiết kế cũ (xem
// collectQuickApplyUnconfiguredTargets()/applyQuickApplyConfig()/saveQuickApplyConfig() ở
// module-workflow.js). Mỗi cấu hình chỉ set số bước cho phòng ban/mức CHƯA từng cấu hình, TUYỆT ĐỐI
// KHÔNG đụng module ngoài phạm vi cấu hình đó và KHÔNG tự gán người duyệt.
//
// Dựng lại đúng khuôn tests/test-lazy-load-all-tabs.js (static server phục vụ public/ + Chromium thật,
// vì đây là logic client-side thuần đọc/ghi biến toàn cục DB — không có route server nào cần test) —
// đăng nhập admin, điều hướng THẬT (click) vào "Hệ Thống > Áp Dụng Nhanh" để trigger đúng
// loadModuleGroup() nạp module-workflow.js/module-itsupport-tier.js, rồi gọi thẳng các hàm qua
// page.evaluate() để kiểm tra state DB sau khi tạo/sửa/xoá/áp dụng cấu hình.
//
// Kiểm tra:
//   A. collectQuickApplyUnconfiguredTargets() (không truyền moduleKeys = quét TOÀN BỘ, giữ nguyên hành
//      vi cũ) đúng với 5 khuôn dữ liệu khác nhau của WF_MODULE_CONFIG — mirror bài test cũ.
//   B. #qaModuleGrid (danh sách module để chọn khi tạo cấu hình) KHÔNG hiện OPERATION_STORE_OPEN/
//      OPERATION_REPAIR (2 module bị loại khỏi phạm vi Áp Dụng Nhanh).
//   C. Tạo Cấu Hình A (mẫu WF_2STEP, phạm vi CHỈ module CAR) rồi áp dụng — CAR Phòng B được điền, CAR
//      Phòng A giữ nguyên, và QUAN TRỌNG NHẤT (khác thiết kế cũ): các module KHÁC đang thiếu cấu hình
//      (SUBMISSION/ITPRICE/OPERATION_ORDER_STORE) TUYỆT ĐỐI KHÔNG bị đụng tới dù cùng lúc đang trống.
//   D. Tạo Cấu Hình B (mẫu WF_1STEP, phạm vi SUBMISSION+ITPRICE+OPERATION_ORDER_STORE) rồi áp dụng —
//      đúng 3 module này được điền, CAR (đã điền ở bước C) không bị đổi lại.
//   E. Sửa Cấu Hình A (đổi mẫu + đổi phạm vi module) qua editQuickApplyConfig()+saveQuickApplyConfig() —
//      cập nhật ĐÚNG bản ghi cũ (không tạo thêm bản ghi mới, id giữ nguyên).
//   F. Xoá Cấu Hình B — DB.quickApplyConfigs mất đúng 1 phần tử, danh sách hiển thị lại đúng.
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
      quickApplyConfigs: [],
      deptWorkflows: {},
      docs: [], submissions: [], submissionApprovalGroups: [],
      // (2) hasTypes — Phòng A đã có cấu hình LEGACY (áp dụng mọi loại qua fallback), Phòng B trống hẳn.
      submissionTypeDeptWorkflows: {},
      submissionDeptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approvers: { 1: ['legacy_approver'] } } },
      contracts: [], contractApprovalGroups: [], contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
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

  // Điều hướng THẬT vào Hệ Thống > Áp Dụng Nhanh (trigger loadModuleGroup() nạp module-workflow.js/
  // module-itsupport-tier.js/module-ngansach.js — cùng khuôn test-lazy-load-all-tabs.js).
  await page.evaluate(() => document.querySelector('[data-op="switchTab"][data-arg0="system"]')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#btnSystemTab')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('button[data-op-seq*="setSystemSubTab(QUICKAPPLY)"]')?.click());
  await page.waitForTimeout(200);

  const ready = await page.evaluate(() => typeof collectQuickApplyUnconfiguredTargets === 'function' && typeof saveQuickApplyConfig === 'function' && typeof applyQuickApplyConfig === 'function');
  record('setup: module-workflow.js đã nạp xong qua điều hướng thật, các hàm cần test đã sẵn sàng', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục vì hàm chưa nạp được', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===== A: liệt kê target KHÔNG giới hạn module (quét toàn bộ) — kiểm tra ĐÚNG những gì được coi là
  // "chưa cấu hình", mirror bài test cũ trước khi có sub-tab riêng =====
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

  // ===== B: danh sách module để chọn khi tạo cấu hình (#qaModuleGrid) KHÔNG hiện 2 module bị loại =====
  const gridModules = await page.evaluate(() => Array.from(document.querySelectorAll('.qaModuleCheck')).map(el => el.value));
  record('#qaModuleGrid chứa module CAR (bình thường)', gridModules.includes('CAR'));
  record('#qaModuleGrid KHÔNG chứa OPERATION_STORE_OPEN/OPERATION_REPAIR (bị loại khỏi Áp Dụng Nhanh)', !gridModules.includes('OPERATION_STORE_OPEN') && !gridModules.includes('OPERATION_REPAIR'));

  // ===== C: tạo Cấu Hình A — mẫu WF_2STEP, phạm vi CHỈ module CAR — rồi áp dụng =====
  await page.evaluate(() => {
    document.getElementById('qaTplSelect').value = 'WF_2STEP';
    document.querySelectorAll('.qaModuleCheck').forEach(el => { el.checked = (el.value === 'CAR'); });
    saveQuickApplyConfig({ preventDefault() {} });
  });
  const afterCreateA = await page.evaluate(() => ({ count: (DB.quickApplyConfigs || []).length, cfg: DB.quickApplyConfigs[0] }));
  record('Cấu Hình A: được thêm vào DB.quickApplyConfigs đúng (1 phần tử, mẫu WF_2STEP, phạm vi [CAR])', afterCreateA.count === 1 && afterCreateA.cfg?.workflowId === 'WF_2STEP' && JSON.stringify(afterCreateA.cfg?.modules) === JSON.stringify(['CAR']));

  const configAId = afterCreateA.cfg?.id;
  await page.evaluate((id) => applyQuickApplyConfig(id), configAId);
  await page.waitForTimeout(50);

  const afterApplyA = await page.evaluate(() => ({
    carA: DB.carDeptWorkflows['Phòng A'], carB: DB.carDeptWorkflows['Phòng B'],
    subTypeSpecificB: DB.submissionTypeDeptWorkflows?.DE_XUAT?.['Phòng B'],
    itPriceRetailB: DB.itPriceDeptWorkflows['Phòng B']?.RETAIL,
    tierMarginGte5: DB.itPriceTierWorkflows.MARGIN_GTE5,
    opOrderStoreLT10M: DB.operationOrderStoreTierWorkflows.LT10M
  }));
  record('Áp dụng Cấu Hình A: CAR Phòng A (đã cấu hình từ trước) GIỮ NGUYÊN, KHÔNG bị ghi đè', afterApplyA.carA?.workflowId === 'WF_1STEP' && JSON.stringify(afterApplyA.carA?.approvers) === JSON.stringify({ 1: ['car_approver'] }));
  record('Áp dụng Cấu Hình A: CAR Phòng B được điền đúng mẫu WF_2STEP, approvers RỖNG', afterApplyA.carB?.workflowId === 'WF_2STEP' && JSON.stringify(afterApplyA.carB?.approvers) === JSON.stringify({}));
  record('Áp dụng Cấu Hình A (phạm vi CHỈ [CAR]): SUBMISSION Phòng B VẪN CHƯA được điền (ngoài phạm vi, không bị đụng)', afterApplyA.subTypeSpecificB === undefined);
  record('Áp dụng Cấu Hình A (phạm vi CHỈ [CAR]): ITPRICE RETAIL Phòng B VẪN CHƯA được điền (ngoài phạm vi)', afterApplyA.itPriceRetailB === undefined);
  record('Áp dụng Cấu Hình A (phạm vi CHỈ [CAR]): ITPRICE WHOLESALE MARGIN_GTE5 VẪN CHƯA được điền (ngoài phạm vi)', afterApplyA.tierMarginGte5 === undefined);
  record('Áp dụng Cấu Hình A (phạm vi CHỈ [CAR]): OPERATION_ORDER_STORE LT10M VẪN CHƯA được điền (ngoài phạm vi)', afterApplyA.opOrderStoreLT10M === undefined);

  // ===== D: tạo Cấu Hình B — mẫu WF_1STEP, phạm vi SUBMISSION + ITPRICE + OPERATION_ORDER_STORE =====
  await page.evaluate(() => {
    document.getElementById('qaTplSelect').value = 'WF_1STEP';
    document.querySelectorAll('.qaModuleCheck').forEach(el => {
      el.checked = ['SUBMISSION', 'ITPRICE', 'OPERATION_ORDER_STORE'].includes(el.value);
    });
    saveQuickApplyConfig({ preventDefault() {} });
  });
  const afterCreateB = await page.evaluate(() => DB.quickApplyConfigs);
  record('Cấu Hình B: được thêm vào DB.quickApplyConfigs (2 cấu hình, KHÔNG ghi đè Cấu Hình A)', afterCreateB.length === 2 && afterCreateB[0].workflowId === 'WF_2STEP');
  const configBId = afterCreateB[1]?.id;

  await page.evaluate((id) => applyQuickApplyConfig(id), configBId);
  await page.waitForTimeout(50);

  const afterApplyB = await page.evaluate(() => ({
    subTypeSpecificA: DB.submissionTypeDeptWorkflows?.DE_XUAT?.['Phòng A'],
    subTypeSpecificB: DB.submissionTypeDeptWorkflows?.DE_XUAT?.['Phòng B'],
    itPriceRetailB: DB.itPriceDeptWorkflows['Phòng B']?.RETAIL,
    tierMarginGte5: DB.itPriceTierWorkflows.MARGIN_GTE5,
    opOrderStoreLT10M: DB.operationOrderStoreTierWorkflows.LT10M,
    carB: DB.carDeptWorkflows['Phòng B'], // đã điền ở bước C bằng WF_2STEP — không được đổi lại
    opStoreOpenA: DB.operationStoreOpenDeptWorkflows['Phòng A']
  }));
  record('Áp dụng Cấu Hình B: KHÔNG tạo type-specific đè lên Phòng A dù legacy vẫn cung cấp fallback', afterApplyB.subTypeSpecificA === undefined);
  record('Áp dụng Cấu Hình B: SUBMISSION Phòng B (trong phạm vi) được điền mới đúng mẫu WF_1STEP', afterApplyB.subTypeSpecificB?.workflowId === 'WF_1STEP');
  record('Áp dụng Cấu Hình B: ITPRICE RETAIL Phòng B (trong phạm vi) được điền mới', afterApplyB.itPriceRetailB?.workflowId === 'WF_1STEP');
  record('Áp dụng Cấu Hình B: ITPRICE WHOLESALE MARGIN_GTE5 (trong phạm vi) được điền mới', afterApplyB.tierMarginGte5?.workflowId === 'WF_1STEP');
  record('Áp dụng Cấu Hình B: OPERATION_ORDER_STORE LT10M (trong phạm vi) được điền mới', afterApplyB.opOrderStoreLT10M?.workflowId === 'WF_1STEP');
  record('Áp dụng Cấu Hình B: CAR Phòng B (đã điền ở Cấu Hình A) GIỮ NGUYÊN mẫu WF_2STEP, không bị Cấu Hình B ghi đè lại', afterApplyB.carB?.workflowId === 'WF_2STEP');
  record('OPERATION_STORE_OPEN: VẪN hoàn toàn trống (module bị loại khỏi phạm vi hẳn, không cấu hình nào chạm tới)', afterApplyB.opStoreOpenA === undefined);

  // ===== E: Sửa Cấu Hình A — đổi mẫu WF_2STEP -> WF_1STEP, đổi phạm vi [CAR] -> [CAR, OFFICE_BUY] =====
  await page.evaluate((id) => editQuickApplyConfig(id), configAId);
  const editFormState = await page.evaluate(() => ({
    tplValue: document.getElementById('qaTplSelect').value,
    carChecked: Array.from(document.querySelectorAll('.qaModuleCheck')).find(el => el.value === 'CAR')?.checked
  }));
  record('editQuickApplyConfig(): nạp đúng dữ liệu cũ vào form (mẫu WF_2STEP, CAR đang tick)', editFormState.tplValue === 'WF_2STEP' && editFormState.carChecked === true);

  await page.evaluate(() => {
    document.getElementById('qaTplSelect').value = 'WF_1STEP';
    document.querySelectorAll('.qaModuleCheck').forEach(el => { el.checked = ['CAR', 'OFFICE_BUY'].includes(el.value); });
    saveQuickApplyConfig({ preventDefault() {} });
  });
  const afterEditA = await page.evaluate(() => DB.quickApplyConfigs);
  record('Sửa Cấu Hình A: vẫn ĐÚNG 2 cấu hình (không tạo thêm bản ghi mới)', afterEditA.length === 2);
  const editedCfg = afterEditA.find(c => c.id === configAId);
  record('Sửa Cấu Hình A: cập nhật ĐÚNG bản ghi cũ (giữ nguyên id, đổi mẫu + phạm vi module)', editedCfg?.workflowId === 'WF_1STEP' && JSON.stringify(editedCfg?.modules) === JSON.stringify(['CAR', 'OFFICE_BUY']));

  // ===== F: Xoá Cấu Hình B =====
  await page.evaluate((id) => deleteQuickApplyConfig(id), configBId);
  const afterDeleteB = await page.evaluate(() => DB.quickApplyConfigs);
  record('Xoá Cấu Hình B: DB.quickApplyConfigs còn đúng 1 phần tử (Cấu Hình A)', afterDeleteB.length === 1 && afterDeleteB[0].id === configAId);

  const listHtmlHasB = await page.evaluate((id) => document.getElementById('quickApplyConfigList').innerHTML.includes(`data-arg0="${id}"`), configBId);
  record('Xoá Cấu Hình B: danh sách hiển thị (#quickApplyConfigList) không còn thẻ của cấu hình đã xoá', !listHtmlHasB);

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
