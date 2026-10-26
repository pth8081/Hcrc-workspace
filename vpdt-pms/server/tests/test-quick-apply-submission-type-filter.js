// server/tests/test-quick-apply-submission-type-filter.js
//
// Regression cho tính năng "Loại tờ trình áp dụng" (10/2026) — 1 lọc TUỲ CHỌN mới gắn vào mỗi cấu hình
// "⚡ Áp Dụng Nhanh" (DB.quickApplyConfigs[].submissionTypeKeys, khối "2b" trong form, chỉ hiện khi tick
// module SUBMISSION — xem systemSection.html + module-workflow.js). Giải quyết đúng bài toán người dùng
// nêu: Văn Bản Trình có NHIỀU loại tờ trình, mỗi loại có thể cần mẫu quy trình (số bước) KHÁC nhau, nhưng
// "⚡ Áp Dụng Nhanh" trước đây chỉ áp 1 mẫu cho TẤT CẢ loại cùng lúc trong 1 lượt — không tách được.
//
// Thiết kế: để trống submissionTypeKeys = giữ ĐÚNG hành vi cũ (áp dụng mẫu cho TẤT CẢ loại tờ trình);
// chọn cụ thể = CHỈ áp dụng cho các loại đã chọn, loại khác (dù đang thiếu cấu hình) KHÔNG bị đụng tới.
//
// Dựng lại đúng khuôn tests/test-quick-apply-workflow-steps.js (static server phục vụ public/ + Chromium
// thật) — đăng nhập admin, điều hướng THẬT vào "Hệ Thống > Áp Dụng Nhanh", rồi gọi thẳng các hàm qua
// page.evaluate() để kiểm tra state DB.
//
// Kiểm tra:
//   A. collectQuickApplyUnconfiguredTargets(['SUBMISSION']) KHÔNG truyền submissionTypeKeys (hoặc truyền
//      mảng rỗng) -> quét ĐỦ cả 3 loại tờ trình x 2 phòng ban (backward-compat, hành vi cũ GIỮ NGUYÊN).
//   B. collectQuickApplyUnconfiguredTargets(['SUBMISSION'], ['KINH_PHI']) -> CHỈ trả về target của loại
//      KINH_PHI, KHÔNG có NHAN_SU/QUY_CHE dù cả 2 loại đó cũng đang thiếu cấu hình ở cả 2 phòng ban.
//   C. #qaSubmissionTypesWrap ẨN mặc định, tự HIỆN khi tick module SUBMISSION, tự ẨN lại khi bỏ tick
//      (onQaModuleCheckChange()/updateQaSubmissionTypesVisibility()).
//   D. Tạo cấu hình lọc 2/3 loại (KINH_PHI + QUY_CHE) qua form thật (gmsAdd trên #qaSubmissionTypesPicker)
//      rồi lưu — DB.quickApplyConfigs[0].submissionTypeKeys lưu ĐÚNG 2 khoá đã chọn.
//   E. Áp dụng cấu hình D — submissionTypeDeptWorkflows CÓ KINH_PHI/QUY_CHE cho cả 2 phòng ban, KHÔNG có
//      NHAN_SU (loại bị loại khỏi lọc, dù đang thiếu cấu hình).
//   F. renderQuickApplyConfigList() hiện đúng badge "📑 Chỉ loại: ..." với nhãn của 2 loại đã chọn.
//   G. editQuickApplyConfig() nạp lại ĐÚNG 2 giá trị đã chọn vào picker + tự hiện lại khối 2b.
//   H. resetQuickApplyConfigForm() dọn sạch picker (rỗng) + ẩn lại khối 2b.
//
// Chạy: node server/tests/test-quick-apply-submission-type-filter.js
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
        { key: 'NHAN_SU', label: 'Tờ trình nhân sự / bổ nhiệm' },
        { key: 'QUY_CHE', label: 'Tờ trình ban hành Quy chế / Quy định' }
      ],
      contractTypes: [], carTypes: [], uniformCatalog: [], itTicketCategories: [],
      workflows: [
        { id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }] },
        { id: 'WF_2STEP', name: 'Quy trình 2 bước', steps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }] }
      ],
      quickApplyConfigs: [],
      deptWorkflows: {},
      docs: [], submissions: [], submissionApprovalGroups: [],
      // Hoàn toàn trống — cả 3 loại x 2 phòng ban đều "chưa cấu hình" (không có legacy fallback nào).
      submissionTypeDeptWorkflows: {},
      submissionDeptWorkflows: {},
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

  // Điều hướng THẬT vào Hệ Thống > 🔀 Nghiệp Vụ Nâng Cao > Áp Dụng Nhanh (xem chú thích đầy đủ ở
  // tests/test-quick-apply-workflow-steps.js).
  await page.evaluate(() => document.querySelector('[data-op="switchTab"][data-arg0="system"]')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#btnSystemTab')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('button[data-op-seq*="setSystemSubTab(ADVWORKFLOW)"]')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#btnAdvWorkflowSubQuickApply')?.click());
  await page.waitForTimeout(200);

  const ready = await page.evaluate(() => typeof collectQuickApplyUnconfiguredTargets === 'function' && typeof saveQuickApplyConfig === 'function' && typeof applyQuickApplyConfig === 'function' && typeof getMultiSelectValues === 'function');
  record('setup: module-workflow.js đã nạp xong qua điều hướng thật, các hàm cần test đã sẵn sàng', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục vì hàm chưa nạp được', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===== A: không truyền submissionTypeKeys (hoặc mảng rỗng) -> quét ĐỦ cả 3 loại x 2 phòng ban =====
  const targetsNoFilter = await page.evaluate(() => collectQuickApplyUnconfiguredTargets(['SUBMISSION']).map(t => t.label));
  const targetsEmptyFilter = await page.evaluate(() => collectQuickApplyUnconfiguredTargets(['SUBMISSION'], []).map(t => t.label));
  const allTypeDeptCombos = ['Tờ trình duyệt kinh phí', 'Tờ trình nhân sự / bổ nhiệm', 'Tờ trình ban hành Quy chế / Quy định']
    .flatMap(typeLabel => ['Phòng A', 'Phòng B'].map(dept => `${typeLabel}) — ${dept}`));
  record('Không truyền submissionTypeKeys: quét ĐỦ 6 target (3 loại x 2 phòng ban) — hành vi cũ giữ nguyên',
    targetsNoFilter.length === 6 && allTypeDeptCombos.every(combo => targetsNoFilter.some(l => l.includes(combo))),
    JSON.stringify(targetsNoFilter));
  record('Truyền submissionTypeKeys=[] (rỗng): giống hệt không truyền — vẫn quét ĐỦ 6 target',
    targetsEmptyFilter.length === 6, JSON.stringify(targetsEmptyFilter));

  // ===== B: lọc CHỈ KINH_PHI -> CHỈ 2 target (Phòng A + Phòng B của loại KINH_PHI), không có 2 loại khác =====
  const targetsFiltered = await page.evaluate(() => collectQuickApplyUnconfiguredTargets(['SUBMISSION'], ['KINH_PHI']).map(t => t.label));
  record('Lọc CHỈ loại KINH_PHI: ĐÚNG 2 target (Phòng A + Phòng B)', targetsFiltered.length === 2 && targetsFiltered.every(l => l.includes('Tờ trình duyệt kinh phí')), JSON.stringify(targetsFiltered));
  record('Lọc CHỈ loại KINH_PHI: KHÔNG có target của Tờ trình nhân sự/Quy chế (dù đang thiếu cấu hình)', !targetsFiltered.some(l => l.includes('nhân sự') || l.includes('Quy chế')));

  // ===== C: #qaSubmissionTypesWrap ẨN mặc định, tự HIỆN/ẨN theo checkbox module SUBMISSION =====
  const wrapHiddenInitially = await page.evaluate(() => document.getElementById('qaSubmissionTypesWrap')?.classList.contains('hidden'));
  record('#qaSubmissionTypesWrap ẨN mặc định (chưa tick module nào)', wrapHiddenInitially === true);

  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.qaModuleCheck')).find(x => x.value === 'SUBMISSION');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const wrapVisibleAfterTick = await page.evaluate(() => document.getElementById('qaSubmissionTypesWrap')?.classList.contains('hidden'));
  record('Tick module "Văn bản trình" (SUBMISSION): #qaSubmissionTypesWrap tự HIỆN', wrapVisibleAfterTick === false);

  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('.qaModuleCheck')).find(x => x.value === 'SUBMISSION');
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const wrapHiddenAfterUntick = await page.evaluate(() => document.getElementById('qaSubmissionTypesWrap')?.classList.contains('hidden'));
  record('Bỏ tick module "Văn bản trình": #qaSubmissionTypesWrap tự ẨN lại', wrapHiddenAfterUntick === true);

  // ===== D: tạo cấu hình lọc 2/3 loại (KINH_PHI + QUY_CHE) qua form thật rồi lưu =====
  await page.evaluate(() => {
    document.getElementById('qaTplSelect').value = 'WF_1STEP';
    document.querySelectorAll('.qaModuleCheck').forEach(el => {
      const checked = (el.value === 'SUBMISSION');
      el.checked = checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    gmsAdd('qaSubmissionTypesPicker', 'KINH_PHI');
    gmsAdd('qaSubmissionTypesPicker', 'QUY_CHE');
    saveQuickApplyConfig({ preventDefault() {} });
  });
  const afterCreate = await page.evaluate(() => ({ count: (DB.quickApplyConfigs || []).length, cfg: DB.quickApplyConfigs[0] }));
  record('Cấu hình lọc: được thêm vào DB.quickApplyConfigs (1 phần tử, phạm vi [SUBMISSION])', afterCreate.count === 1 && JSON.stringify(afterCreate.cfg?.modules) === JSON.stringify(['SUBMISSION']));
  record('Cấu hình lọc: submissionTypeKeys lưu ĐÚNG 2 khoá đã chọn (KINH_PHI, QUY_CHE)', JSON.stringify((afterCreate.cfg?.submissionTypeKeys || []).slice().sort()) === JSON.stringify(['KINH_PHI', 'QUY_CHE'].sort()), JSON.stringify(afterCreate.cfg?.submissionTypeKeys));
  const configId = afterCreate.cfg.id;

  // ===== E: áp dụng cấu hình — CHỈ 2 loại đã chọn được điền, loại KHÔNG chọn (NHAN_SU) không bị đụng =====
  await page.evaluate((id) => applyQuickApplyConfig(id), configId);
  const afterApply = await page.evaluate(() => DB.submissionTypeDeptWorkflows);
  record('Áp dụng: KINH_PHI được điền cho cả Phòng A + Phòng B', !!afterApply.KINH_PHI?.['Phòng A'] && !!afterApply.KINH_PHI?.['Phòng B']);
  record('Áp dụng: QUY_CHE được điền cho cả Phòng A + Phòng B', !!afterApply.QUY_CHE?.['Phòng A'] && !!afterApply.QUY_CHE?.['Phòng B']);
  record('Áp dụng: NHAN_SU (KHÔNG chọn trong lọc) hoàn toàn KHÔNG bị đụng tới, dù đang thiếu cấu hình', !afterApply.NHAN_SU || Object.keys(afterApply.NHAN_SU).length === 0, JSON.stringify(afterApply.NHAN_SU));

  // ===== F: renderQuickApplyConfigList() hiện đúng badge "📑 Chỉ loại: ..." =====
  const listHtml = await page.evaluate(() => document.getElementById('quickApplyConfigList').innerHTML);
  record('Danh sách cấu hình hiện badge "📑 Chỉ loại:" kèm nhãn 2 loại đã chọn', listHtml.includes('Chỉ loại') && listHtml.includes('Tờ trình duyệt kinh phí') && listHtml.includes('Tờ trình ban hành Quy chế'));

  // ===== G: editQuickApplyConfig() nạp lại ĐÚNG picker + tự hiện lại khối 2b =====
  // Thu gọn trước (giống thao tác thật đóng form) để chắc chắn editQuickApplyConfig() tự mở lại đúng.
  await page.evaluate(() => closeQuickApplyConfigForm());
  await page.evaluate((id) => editQuickApplyConfig(id), configId);
  const editState = await page.evaluate(() => ({
    wrapHidden: document.getElementById('qaSubmissionTypesWrap')?.classList.contains('hidden'),
    values: getMultiSelectValues('qaSubmissionTypesPicker').slice().sort()
  }));
  record('editQuickApplyConfig(): #qaSubmissionTypesWrap tự HIỆN lại (module SUBMISSION đang tick)', editState.wrapHidden === false);
  record('editQuickApplyConfig(): picker nạp lại ĐÚNG 2 giá trị đã lưu (KINH_PHI, QUY_CHE)', JSON.stringify(editState.values) === JSON.stringify(['KINH_PHI', 'QUY_CHE'].sort()), JSON.stringify(editState.values));

  // ===== H: resetQuickApplyConfigForm() dọn sạch picker + ẩn lại khối 2b =====
  await page.evaluate(() => resetQuickApplyConfigForm());
  const resetState = await page.evaluate(() => ({
    wrapHidden: document.getElementById('qaSubmissionTypesWrap')?.classList.contains('hidden'),
    values: getMultiSelectValues('qaSubmissionTypesPicker')
  }));
  record('resetQuickApplyConfigForm(): picker rỗng (không rò state từ lượt Sửa trước)', resetState.values.length === 0);
  record('resetQuickApplyConfigForm(): #qaSubmissionTypesWrap ẨN lại (module SUBMISSION đã bỏ tick)', resetState.wrapHidden === true);

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
