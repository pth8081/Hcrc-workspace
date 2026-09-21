// server/tests/test-quick-apply-auto-dept-position.js
//
// LỖI THIẾT KẾ ĐÃ VÁ (theo yêu cầu người dùng, kèm ảnh chụp màn hình "Áp Dụng Nhanh Số Bước Cho Quy
// Trình" — bước 1 "Trưởng phòng"): trước đây "🧭 Gán theo Chức Danh" ở Áp Dụng Nhanh COPY Y HỆT 1 danh
// sách cặp {jobTitle,dept} vào MỌI phòng ban/mức trong phạm vi module đã chọn (xem
// collectQuickApplyUnconfiguredTargets()/emptyConfig() cũ ở module-workflow.js) — để trống Phòng ban thì
// khớp chức danh đó CẢ CÔNG TY (Trưởng Phòng A duyệt được cả hồ sơ Phòng B), điền cụ thể 1 phòng ban thì
// cũng bị copy chéo sang các phòng ban khác không liên quan nếu thêm nhiều cặp để cố phủ nhiều phòng ban.
// Không có cách nào "1 lần Áp Dụng, mỗi phòng ban tự ra đúng Trưởng Phòng của phòng ban đó".
//
// Bản vá: thêm chế độ MỚI "🏢 Tự động khớp đúng phòng ban của từng mục" — CHỈ dùng được ở Bước 1
// (renderQuickApplyPositionSteps()/onQaAutoDeptToggle()/collectQaStepModesAndPositions()) — admin chỉ
// chọn CHỨC DANH (không ghép phòng ban), approverMode[1]='POSITION_AUTO_DEPT' lúc lưu cấu hình. Lúc bấm
// "⚡ Áp Dụng", collectQuickApplyUnconfiguredTargets() tự thay dept rỗng của mỗi pair bằng dept THẬT của
// TỪNG target riêng lẻ rồi hạ approverMode về 'POSITION' bình thường trước khi ghi — resolver dùng chung
// (lib/positionApprovers.js) không cần biết gì về "auto-match".
//
// Kiểm tra:
//   1. UI: checkbox "🏢 Tự động khớp đúng phòng ban" CHỈ xuất hiện ở Bước 1, KHÔNG có ở Bước 2.
//   2. Bật auto-dept cho Bước 1 (chọn "Trưởng Phòng", không ghép phòng ban) rồi Lưu — cấu hình lưu đúng
//      approverMode[1]='POSITION_AUTO_DEPT', approversByPosition[1]=[{jobTitle:'Trưởng Phòng', dept:''}].
//   3. Bấm "⚡ Áp Dụng" cho phạm vi CAR (2 phòng ban CHƯA cấu hình) — MỖI phòng ban tự ra ĐÚNG dept của
//      chính nó (approverMode[1] hạ về 'POSITION' bình thường, approversByPosition[1] có dept ĐÚNG của
//      phòng ban đó) — KHÔNG bị lộ chéo (Phòng A không thấy dept Phòng B và ngược lại).
//   4. Đúng bằng chứng hết lỗi cũ: resolvePositionApprovers() (lib/positionApprovers.js — HÀM DÙNG CHUNG,
//      KHÔNG sửa gì) chạy trên cấu hình ĐÃ ÁP DỤNG của Phòng A chỉ trả về Trưởng Phòng A, KHÔNG trả về
//      Trưởng Phòng B (và ngược lại) — chứng minh việc sửa nằm ở lúc ghi cấu hình (Quick Apply), không
//      phải sửa cơ chế khớp chung (vốn vẫn đúng từ trước, chỉ là bị đưa dữ liệu sai).
//   5. editQuickApplyConfig() nạp lại đúng state auto-dept (checkbox tick, chip hiện đúng chức danh).
//
// Chạy: node server/tests/test-quick-apply-auto-dept-position.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const { resolvePositionApprovers } = require('../lib/positionApprovers');

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
      jobTitles: ['Trưởng Phòng'], storeJobTitles: [], submissionTypes: [{ key: 'DE_XUAT', label: 'Đề Xuất' }],
      contractTypes: [], carTypes: [], uniformCatalog: [], itTicketCategories: [],
      workflows: [
        { id: 'WF_2STEP', name: 'Quy trình 2 bước', steps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }] }
      ],
      quickApplyConfigs: [],
      deptWorkflows: {}, docs: [], submissions: [], submissionApprovalGroups: [],
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
      pwaShortcutModules: [], itPriceMasterLists: [],
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

    // Trưởng Phòng A (canBeApprover) + Trưởng Phòng B (canBeApprover) — dùng để chứng minh resolver
    // dùng chung KHÔNG lộ chéo sau khi Áp Dụng xong (kịch bản 4).
    DB.users.push(
      { id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng A', jobTitle: 'Nhân viên', email: 'admin@test.local', phone: '0900000000', perms: { admin: true }, groupIds: [], permOverrides: null },
      { id: 2, username: 'tp_a', name: 'Trưởng Phòng A', dept: 'Phòng A', jobTitle: 'Trưởng Phòng', email: 'tpa@test.local', phone: '0900000001', perms: { canBeApprover: true }, active: true },
      { id: 3, username: 'tp_b', name: 'Trưởng Phòng B', dept: 'Phòng B', jobTitle: 'Trưởng Phòng', email: 'tpb@test.local', phone: '0900000002', perms: { canBeApprover: true }, active: true }
    );
    finishLogin(DB.users[0]);
  });

  await page.evaluate(() => document.querySelector('[data-op="switchTab"][data-arg0="system"]')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#btnSystemTab')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('button[data-op-seq*="setSystemSubTab(ADVWORKFLOW)"]')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#btnAdvWorkflowSubQuickApply')?.click());
  await page.waitForTimeout(200);

  const ready = await page.evaluate(() => typeof collectQuickApplyUnconfiguredTargets === 'function' && typeof onQaAutoDeptToggle === 'function');
  record('setup: module-workflow.js đã nạp xong, onQaAutoDeptToggle() có sẵn', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục vì hàm chưa nạp được', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===== 1: chọn mẫu WF_2STEP -> checkbox auto-dept CHỈ xuất hiện ở Bước 1 =====
  await page.evaluate(() => {
    document.getElementById('qaTplSelect').value = 'WF_2STEP';
    renderQuickApplyPositionSteps();
  });
  const autoDeptToggles = await page.evaluate(() => ({
    step1: !!document.getElementById('qaAutoDeptToggle_qa_1'),
    step2: !!document.getElementById('qaAutoDeptToggle_qa_2')
  }));
  record('Checkbox "🏢 Tự động khớp đúng phòng ban" CHỈ xuất hiện ở Bước 1', autoDeptToggles.step1 === true);
  record('Checkbox "🏢 Tự động khớp đúng phòng ban" KHÔNG xuất hiện ở Bước 2', autoDeptToggles.step2 === false);

  // ===== 2: bật "Theo Chức Danh" + "Tự động khớp phòng ban" cho Bước 1, chọn "Trưởng Phòng", Lưu =====
  await page.evaluate(() => {
    document.querySelectorAll('.qaModuleCheck').forEach(el => { el.checked = (el.value === 'CAR'); });
    const posToggle = document.getElementById('qaPosModeToggle_qa_1');
    posToggle.checked = true;
    onQaStepPositionToggle('qa_1', posToggle);
    const autoToggle = document.getElementById('qaAutoDeptToggle_qa_1');
    autoToggle.checked = true;
    onQaAutoDeptToggle('qa_1', autoToggle);
    gmsAdd('qaAutoDeptPicker_qa_1', 'Trưởng Phòng');
  });
  const pickerVisibility = await page.evaluate(() => ({
    normalHidden: document.getElementById('qaPositionPicker_qa_1')?.classList.contains('hidden'),
    autoDeptHidden: document.getElementById('qaAutoDeptPicker_qa_1')?.classList.contains('hidden')
  }));
  record('Bật auto-dept: ẩn ô chọn {Chức danh,Phòng ban} thường, hiện ô chọn chức danh thuần', pickerVisibility.normalHidden === true && pickerVisibility.autoDeptHidden === false);

  await page.evaluate(() => saveQuickApplyConfig({ preventDefault() {} }));
  const savedCfg = await page.evaluate(() => DB.quickApplyConfigs[0]);
  record('Lưu cấu hình: approverMode[1] = "POSITION_AUTO_DEPT"', savedCfg?.approverMode?.[1] === 'POSITION_AUTO_DEPT');
  record('Lưu cấu hình: approversByPosition[1] = [{jobTitle:"Trưởng Phòng", dept:""}] (KHÔNG ghép phòng ban ở đây)',
    JSON.stringify(savedCfg?.approversByPosition?.[1]) === JSON.stringify([{ jobTitle: 'Trưởng Phòng', dept: '' }]));

  // ===== 3: Áp Dụng — MỖI phòng ban tự ra ĐÚNG dept của chính nó, approverMode hạ về 'POSITION' =====
  const configId = savedCfg.id;
  await page.evaluate((id) => applyQuickApplyConfig(id), configId);
  await page.waitForTimeout(50);
  const applied = await page.evaluate(() => ({ a: DB.carDeptWorkflows['Phòng A'], b: DB.carDeptWorkflows['Phòng B'] }));

  record('Áp Dụng: CAR Phòng A -> approverMode[1] hạ về "POSITION" bình thường (KHÔNG còn AUTO_DEPT)', applied.a?.approverMode?.[1] === 'POSITION');
  record('Áp Dụng: CAR Phòng A -> approversByPosition[1] có dept ĐÚNG "Phòng A" (không phải rỗng, không phải Phòng B)',
    JSON.stringify(applied.a?.approversByPosition?.[1]) === JSON.stringify([{ jobTitle: 'Trưởng Phòng', dept: 'Phòng A' }]));
  record('Áp Dụng: CAR Phòng B -> approversByPosition[1] có dept ĐÚNG "Phòng B" (KHÔNG lộ chéo sang Phòng A)',
    JSON.stringify(applied.b?.approversByPosition?.[1]) === JSON.stringify([{ jobTitle: 'Trưởng Phòng', dept: 'Phòng B' }]));

  // ===== 4: chứng minh hết lỗi lộ chéo bằng chính resolver dùng chung (lib/positionApprovers.js) =====
  const usersForResolve = await page.evaluate(() => DB.users);
  const approversA = resolvePositionApprovers(applied.a.approversByPosition[1], usersForResolve);
  const approversB = resolvePositionApprovers(applied.b.approversByPosition[1], usersForResolve);
  record('LỖI ĐÃ VÁ: resolvePositionApprovers() trên cấu hình Phòng A CHỈ trả về Trưởng Phòng A (tp_a), KHÔNG có tp_b',
    JSON.stringify(approversA) === JSON.stringify(['tp_a']), JSON.stringify(approversA));
  record('LỖI ĐÃ VÁ: resolvePositionApprovers() trên cấu hình Phòng B CHỈ trả về Trưởng Phòng B (tp_b), KHÔNG có tp_a',
    JSON.stringify(approversB) === JSON.stringify(['tp_b']), JSON.stringify(approversB));

  // ===== 5: editQuickApplyConfig() nạp lại đúng state auto-dept =====
  await page.evaluate((id) => editQuickApplyConfig(id), configId);
  const editState = await page.evaluate(() => ({
    posChecked: document.getElementById('qaPosModeToggle_qa_1')?.checked,
    autoChecked: document.getElementById('qaAutoDeptToggle_qa_1')?.checked,
    normalHidden: document.getElementById('qaPositionPicker_qa_1')?.classList.contains('hidden'),
    autoDeptHidden: document.getElementById('qaAutoDeptPicker_qa_1')?.classList.contains('hidden'),
    chipText: document.getElementById('qaAutoDeptPicker_qa_1')?.textContent || ''
  }));
  record('editQuickApplyConfig(): nạp lại đúng cả 2 toggle (Theo Chức Danh + Tự động khớp phòng ban) đều checked', editState.posChecked === true && editState.autoChecked === true);
  record('editQuickApplyConfig(): hiện đúng ô chọn chức danh thuần (không phải ô cặp thường)', editState.normalHidden === true && editState.autoDeptHidden === false);
  record('editQuickApplyConfig(): chip hiển thị đúng "Trưởng Phòng" đã lưu', editState.chipText.includes('Trưởng Phòng'));

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
