// server/tests/test-audit-hethong-round2-workflow-client.js
//
// Regression test CLIENT-SIDE cho 3 phát hiện đã vá ở đợt audit chuyên sâu cụm "Hệ Thống / Admin / Cấu
// Hình" (audit vòng 2), cả 3 đều ở public/js/module-itsupport-tier.js:
//
//   #5 (TB)  Bước "Theo vị trí" (POSITION mode) không bao giờ được tính vào "⚠️ CHƯA có người duyệt" —
//            collectDeptWorkflowConfig()/collectItPriceTierWorkflowConfig() nay dùng
//            previewWfPositionApprovers() (module-admin-specialperm.js) để coi 1 bước POSITION là
//            "trống" khi CHƯA chọn vị trí nào HOẶC đã chọn nhưng không ai khớp.
//   #4 (Cao) Sửa "Mẫu Quy Trình" đổi SỐ BƯỚC của 1 mẫu đang được gán cho >=1 phòng ban/mức không còn
//            lưu thẳng vô điều kiện — collectWorkflowTemplateUsages() (tách từ deleteWorkflowTemplate())
//            được gọi lại trong saveWorkflowTemplate() để cảnh báo confirm() trước khi lưu.
//   #8 (TB)  5 hàm lưu cấu hình quy trình cốt lõi (saveDeptWorkflowConfig/saveAllDeptWorkflowConfigs/
//            saveItPriceTierWorkflowConfig/saveWorkflowTemplate/deleteWorkflowTemplate) chuyển sang
//            await syncStorage() + snapshot/rollback — server từ chối (409/500) thì KHÔNG báo "✅ Đã lưu"
//            và DB phải hoàn tác đúng về snapshot trước khi ghi.
//
// Dựng lại đúng khuôn tests/test-quick-apply-workflow-steps.js (static server phục vụ public/ + Chromium
// thật qua Playwright — đây là logic client-side thuần đọc/ghi biến toàn cục DB/DOM, không có route
// server nào cần test) — đăng nhập admin, điều hướng THẬT vào "Hệ Thống > 🔄 Quy Trình & Phê Duyệt" để
// trigger loadModuleGroup() nạp module-ngansach.js/module-itsupport-tier.js/module-admin-specialperm.js,
// rồi gọi thẳng các hàm qua page.evaluate() để kiểm tra state DOM/DB.
//
// Chạy: node server/tests/test-audit-hethong-round2-workflow-client.js
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
  const PORT = 9700 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  // fetchLog: mọi lượt gọi syncStorage()/fetch tới /api/data/<key> — cho phép test #8 chặn ĐÚNG 1 lượt
  // lưu bằng cách đặt window.__failNextSync = true trước khi bấm lưu.
  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.__confirmCalls = [];
    window.__confirmReturn = true;
    window.confirm = (m) => { window.__confirmCalls.push(String(m)); return window.__confirmReturn; };
    window.prompt = () => '';
    window.__failNextSync = false;
    window.fetch = async (url, opts) => {
      const method = ((opts && opts.method) || 'GET').toUpperCase();
      if (method === 'GET') return { ok: true, status: 200, json: async () => ([]) };
      if (window.__failNextSync) {
        window.__failNextSync = false;
        return { ok: false, status: 409, json: async () => ({ error: 'Xung đột phiên bản (giả lập test)' }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    Object.assign(DB, {
      depts: ['Phòng A'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: ['Trưởng phòng', 'Không Ai Giữ'], storeJobTitles: [], submissionTypes: [{ key: 'DE_XUAT', label: 'Đề Xuất' }],
      contractTypes: [], carTypes: [], uniformCatalog: [], itTicketCategories: [],
      workflows: [
        { id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }] },
        { id: 'WF_2STEP', name: 'Quy trình 2 bước', steps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }] }
      ],
      quickApplyConfigs: [],
      // deptWorkflows['Phòng A'] đã gán WF_2STEP -> dùng để test #4 (đổi số bước cảnh báo confirm()).
      deptWorkflows: { 'Phòng A': { workflowId: 'WF_2STEP', approvers: { 1: ['admin'], 2: ['admin'] }, approverMode: {}, approversByPosition: {} } },
      docs: [], submissions: [], submissionApprovalGroups: [],
      submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {},
      contracts: [], contractApprovalGroups: [], contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
      meetings: [], meetingMinutes: [], meetingAttendeeTemplates: [],
      carRegs: [], carDeptWorkflows: {}, officeReqs: [], officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {},
      tasks: [], internalPosts: [], internalNewsCategories: [], internalShareCategories: [],
      trainingCategories: [], trainingDocuments: [], trainingClasses: [], trainingRegistrations: [],
      careerPaths: [], careerPathConfirmations: [], trainingTests: [], trainingTestSubmissions: [],
      trainingCourses: [], trainingPlans: [], onboardingPaths: [], onboardingProgress: [],
      recruitmentJobs: [], recruitmentReferrals: [], hrFeedback: [], sensitiveKeywords: [],
      paymentRequests: [], paymentDeptWorkflows: {}, formTemplates: {}, permGroups: [], users: [],
      vppExcludeGroups: [], vppExcludedJobTitles: [],
      // workflowParticipatingPositions: 1 cặp KHỚP người thật (Trưởng phòng/Phòng A -> u1) + 1 cặp
      // KHÔNG ai giữ (Không Ai Giữ/Phòng A) — dùng cho test #5.
      workflowParticipatingDepts: [], workflowParticipatingPositions: [
        { jobTitle: 'Trưởng phòng', dept: 'Phòng A' },
        { jobTitle: 'Không Ai Giữ', dept: 'Phòng A' }
      ],
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

    const adminUser = {
      id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng A', jobTitle: 'Nhân viên',
      email: 'admin@test.local', phone: '0900000000', perms: { admin: true }, groupIds: [], permOverrides: null
    };
    // u1: khớp ĐÚNG cặp "Trưởng phòng — Phòng A" (active + canBeApprover) -> previewWfPositionApprovers()
    // phải trả CONFIGURED_RESOLVED cho cặp này.
    const u1 = {
      id: 2, username: 'u1', name: 'Trưởng Phòng A', dept: 'Phòng A', jobTitle: 'Trưởng phòng',
      posType: 'HO', active: true, perms: { canBeApprover: true }, groupIds: [], permOverrides: null
    };
    DB.users.push(adminUser, u1);
    finishLogin(adminUser);
  });

  // Điều hướng THẬT vào Hệ Thống > 🔄 Quy Trình & Phê Duyệt (KHÔNG phải "🔀 Quy Trình Nâng Cao") — trigger
  // loadModuleGroup() nạp module-ngansach.js/module-itsupport-tier.js/module-admin-specialperm.js.
  await page.evaluate(() => document.querySelector('[data-op="switchTab"][data-arg0="system"]')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#btnSystemTab')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('button[data-op-seq*="setSystemSubTab(WORKFLOW)"]')?.click());
  await page.waitForTimeout(250);

  const ready = await page.evaluate(() =>
    typeof collectDeptWorkflowConfig === 'function' && typeof saveDeptWorkflowConfig === 'function'
    && typeof saveWorkflowTemplate === 'function' && typeof previewWfPositionApprovers === 'function'
    && typeof collectWorkflowTemplateUsages === 'function');
  record('setup: module-ngansach.js/module-itsupport-tier.js/module-admin-specialperm.js đã nạp xong qua điều hướng thật', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục vì hàm chưa nạp được', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===== #5: bước "Theo vị trí" (POSITION) với cặp KHÔNG ai khớp phải bị coi là "trống" =====
  await page.evaluate(() => { switchWfModule('DOC'); });
  await page.waitForTimeout(80);
  // Bật "Theo vị trí" cho bước 1 của Phòng A (deptKey = 'Phòng_A', vì .replace(/\s+/g,'_')).
  await page.evaluate(() => {
    const toggle = document.getElementById('wfPosModeToggle_Phòng_A_1');
    toggle.checked = true;
    onWfStepApproverModeToggle('Phòng_A_1', toggle);
  });
  await page.waitForTimeout(50);
  // Chọn cặp KHÔNG ai giữ -> emptySteps phải chứa bước 1.
  const emptyStepsWithUnmatchedPair = await page.evaluate(() => {
    gmsAdd('wfPositionPicker_Phòng_A_1', encodeWfPositionPair({ jobTitle: 'Không Ai Giữ', dept: 'Phòng A' }));
    const result = collectDeptWorkflowConfig('Phòng A');
    return result.emptySteps.map(s => s.order);
  });
  record('#5 POSITION mode, cặp KHÔNG ai giữ -> bước 1 PHẢI nằm trong emptySteps (trước đây bỏ sót)',
    JSON.stringify(emptyStepsWithUnmatchedPair) === JSON.stringify([1]), JSON.stringify(emptyStepsWithUnmatchedPair));

  // Đổi sang cặp CÓ người khớp thật (u1) -> emptySteps phải RỖNG.
  const emptyStepsWithMatchedPair = await page.evaluate(() => {
    gmsRemove('wfPositionPicker_Phòng_A_1', encodeWfPositionPair({ jobTitle: 'Không Ai Giữ', dept: 'Phòng A' }));
    gmsAdd('wfPositionPicker_Phòng_A_1', encodeWfPositionPair({ jobTitle: 'Trưởng phòng', dept: 'Phòng A' }));
    const result = collectDeptWorkflowConfig('Phòng A');
    return result.emptySteps.map(s => s.order);
  });
  record('#5 POSITION mode, cặp CÓ người khớp (u1) -> emptySteps phải RỖNG', emptyStepsWithMatchedPair.length === 0, JSON.stringify(emptyStepsWithMatchedPair));

  // ===== #4: đổi SỐ BƯỚC của mẫu đang gán cho Phòng A phải cảnh báo confirm() =====
  const usagesOfWf2Step = await page.evaluate(() => collectWorkflowTemplateUsages('WF_2STEP'));
  record('#4 collectWorkflowTemplateUsages("WF_2STEP") thấy đúng usage ở deptWorkflows[Phòng A]',
    usagesOfWf2Step.length === 1 && usagesOfWf2Step[0].includes('Phòng A'), JSON.stringify(usagesOfWf2Step));

  // Sửa mẫu WF_2STEP: mở form sửa rồi XOÁ 1 dòng bước (còn lại 1 bước, khác 2 bước gốc) -> phải gọi confirm().
  await page.evaluate(() => { window.__confirmCalls.length = 0; window.__confirmReturn = false; /* NGƯỜI DÙNG BẤM HUỶ */ });
  const snapshotBeforeCancelledSave = await page.evaluate(() => JSON.parse(JSON.stringify(DB.workflows.find(w => w.id === 'WF_2STEP'))));
  await page.evaluate(() => {
    editWorkflowTemplate('WF_2STEP');
    document.querySelectorAll('#stepBuilderContainer .step-row')[1].remove(); // còn lại 1 bước
    document.querySelector('form[data-op-submit="saveWorkflowTemplate"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(80);
  const stateAfterCancelledSave = await page.evaluate(() => JSON.parse(JSON.stringify(DB.workflows.find(w => w.id === 'WF_2STEP'))));
  record('#4 confirm() ĐƯỢC gọi khi đổi số bước của mẫu đang dùng', (await page.evaluate(() => window.__confirmCalls.length)) === 1);
  record('#4 Bấm HUỶ ở confirm() -> DB.workflows KHÔNG bị đổi (vẫn 2 bước)', stateAfterCancelledSave.steps.length === 2, JSON.stringify(stateAfterCancelledSave));
  record('#4 Bấm HUỶ -> KHÔNG có alert "Đã lưu" nào được gọi', (await page.evaluate(() => window.__alerts.length)) === 0);

  // Đồng ý confirm() -> lưu thật, DB.workflows phải còn đúng 1 bước.
  await page.evaluate(() => { window.__confirmReturn = true; window.__alerts.length = 0; });
  await page.evaluate(() => {
    editWorkflowTemplate('WF_2STEP');
    document.querySelectorAll('#stepBuilderContainer .step-row')[1].remove();
    document.querySelector('form[data-op-submit="saveWorkflowTemplate"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(80);
  const stateAfterConfirmedSave = await page.evaluate(() => JSON.parse(JSON.stringify(DB.workflows.find(w => w.id === 'WF_2STEP'))));
  record('#4 Bấm ĐỒNG Ý ở confirm() -> lưu thật, DB.workflows còn đúng 1 bước', stateAfterConfirmedSave.steps.length === 1, JSON.stringify(stateAfterConfirmedSave));
  record('#4 Bấm ĐỒNG Ý -> CÓ alert "✅ Đã lưu" (server chấp nhận)', (await page.evaluate(() => window.__alerts.some(a => a.includes('✅')))));

  // ===== #8: server từ chối lưu (409) -> KHÔNG báo thành công, DB hoàn tác đúng snapshot =====
  await page.evaluate(() => { switchWfModule('DOC'); });
  await page.waitForTimeout(80);
  const snapshotBeforeFailedSave = await page.evaluate(() => JSON.parse(JSON.stringify(DB.deptWorkflows)));
  await page.evaluate(() => {
    window.__alerts.length = 0;
    window.__failNextSync = true; // fetch() tiếp theo trả 409
    // Đổi mẫu Phòng A sang WF_1STEP rồi lưu — mô phỏng admin thao tác bình thường.
    const sel = document.getElementById('wfSelect_Phòng_A');
    sel.value = 'WF_1STEP';
    onWorkflowTemplateChange('Phòng A');
  });
  await page.waitForTimeout(80);
  await page.evaluate(async () => { await saveDeptWorkflowConfig('Phòng A'); });
  await page.waitForTimeout(80);
  const stateAfterFailedSave = await page.evaluate(() => JSON.parse(JSON.stringify(DB.deptWorkflows)));
  record('#8 saveDeptWorkflowConfig(): server từ chối (409) -> DB.deptWorkflows hoàn tác đúng snapshot (KHÔNG đổi thành WF_1STEP)',
    JSON.stringify(stateAfterFailedSave) === JSON.stringify(snapshotBeforeFailedSave), JSON.stringify({ before: snapshotBeforeFailedSave, after: stateAfterFailedSave }));
  record('#8 saveDeptWorkflowConfig(): server từ chối -> KHÔNG có alert "✅ Đã lưu" nào', !(await page.evaluate(() => window.__alerts.some(a => a.includes('✅')))), JSON.stringify(await page.evaluate(() => window.__alerts)));

  // Lượt lưu KẾ TIẾP (server chấp nhận bình thường) phải thành công đúng — xác nhận rollback không làm
  // hỏng luôn cả các lượt lưu sau.
  await page.evaluate(() => { window.__alerts.length = 0; });
  await page.evaluate(async () => { await saveDeptWorkflowConfig('Phòng A'); });
  await page.waitForTimeout(80);
  const stateAfterRetrySave = await page.evaluate(() => DB.deptWorkflows['Phòng A'].workflowId);
  record('#8 Lượt lưu KẾ TIẾP (server chấp nhận) -> lưu thành công đúng (workflowId = WF_1STEP)', stateAfterRetrySave === 'WF_1STEP', stateAfterRetrySave);
  record('#8 Lượt lưu thành công -> CÓ alert "✅ Đã lưu"', (await page.evaluate(() => window.__alerts.some(a => a.includes('✅')))));

  record('Không có lỗi JS/console nào phát sinh trong suốt bài test', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  server.close();
  finish();
}

function finish() {
  const failed = results.filter(r => !r.pass).length;
  console.log('');
  console.log(`==== ${results.length - failed}/${results.length} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('LỖI KHÔNG BẮT ĐƯỢC:', err); process.exitCode = 1; });
