// server/tests/test-quick-apply-people-mode.js
//
// Regression cho "👤 Gán Người Cụ Thể" — mở rộng "⚡ Áp Dụng Nhanh" (module-workflow.js) thêm tuỳ chọn
// thứ 3 (bên cạnh "để trống"/"🧭 Gán theo Chức Danh") cho khối "3. (Tuỳ chọn) Gán người duyệt theo
// Chức Danh HOẶC theo Người Cụ Thể cho từng bước" — theo yêu cầu người dùng (11/2026, kèm ảnh chụp màn
// hình Áp Dụng Nhanh): bật cho ĐÚNG 1/nhiều người cụ thể (không cần đúng 1 chức danh) làm người duyệt
// 1 bước, áp dụng CHUNG cho MỌI mục (phòng ban/mức) đang thiếu cấu hình trong phạm vi module đã chọn —
// cùng tinh thần "🧭 Gán theo Chức Danh" nhưng chọn thẳng người thay vì chức danh.
//
// Dựng lại đúng khuôn tests/test-quick-apply-workflow-steps.js (mục G) — static server phục vụ public/ +
// Chromium thật, đăng nhập admin, điều hướng THẬT vào "Hệ Thống > 🔀 Nghiệp Vụ Nâng Cao > ⚡ Áp Dụng
// Nhanh", rồi thao tác qua page.evaluate()/pmsAdd() (hàm dùng chung renderPeopleMultiSelect() —
// core.js) để mô phỏng đúng click chọn người trên UI thật.
//
// Kiểm tra:
//   A. renderQuickApplyPositionSteps() vẽ đúng checkbox "👤 Gán Người Cụ Thể" cho mỗi bước, khối người
//      cụ thể mặc định ẩn.
//   B. Bật "👤 Gán Người Cụ Thể" cho Bước 1 + chọn 1 người (qua pmsAdd, mô phỏng click chọn trên UI) —
//      lưu cấu hình ra ĐÚNG approverMode[1]='PEOPLE' + approvers[1]=[username], Bước 2 (không bật gì)
//      vẫn để trống như cũ.
//   C. Mutual exclusivity: bật "🧭 Gán theo Chức Danh" cho 1 bước đã bật "👤 Gán Người Cụ Thể" từ
//      trước (và ngược lại) phải TỰ TẮT + ẩn khối còn lại — 1 bước chỉ ở ĐÚNG 1 trạng thái tại 1 thời
//      điểm.
//   D. Áp dụng cấu hình — MỌI mục (2 phòng ban cùng lúc) đang thiếu cấu hình trong phạm vi module nhận
//      ĐÚNG CÙNG 1 người đó làm người duyệt Bước 1 (không bị biến đổi/khác nhau theo từng phòng ban,
//      khác hẳn "🧭 Tự động khớp đúng phòng ban" của chức danh).
//   E. editQuickApplyConfig() nạp lại ĐÚNG state (toggle checked, khối hiện, chip hiển thị đúng tên
//      người đã chọn, toggle "Theo Chức Danh" của ĐÚNG bước đó vẫn tắt).
//   F. resetQuickApplyConfigForm() dọn sạch state (không rò từ lượt Sửa trước sang lượt Tạo mới).
//   G. Danh sách cấu hình hiện đúng badge "👤 N bước theo Người Cụ Thể".
//
// Chạy: node server/tests/test-quick-apply-people-mode.js
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
      jobTitles: [], storeJobTitles: [], submissionTypes: [], contractTypes: [], carTypes: [], uniformCatalog: [],
      itTicketCategories: [],
      workflows: [
        { id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Phê duyệt 1' }] },
        { id: 'WF_2STEP', name: 'Quy trình 2 bước', steps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }] }
      ],
      quickApplyConfigs: [],
      deptWorkflows: {},
      docs: [], submissions: [], submissionApprovalGroups: [], submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {},
      contracts: [], contractApprovalGroups: [], contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
      meetings: [], meetingMinutes: [], meetingAttendeeTemplates: [],
      // CAR: cả Phòng A lẫn Phòng B đều TRỐNG — cả 2 sẽ cùng được áp dụng chung 1 người cụ thể.
      carRegs: [], carDeptWorkflows: {},
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
      users: [], _versions: {}
    });

    const adminUser = {
      id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng A', jobTitle: 'Nhân viên',
      email: 'admin@test.local', phone: '0900000000', perms: { admin: true }, groupIds: [], permOverrides: null
    };
    // u_approver1 — có cờ canBeApprover (ứng viên "👤 Gán Người Cụ Thể"), KHÔNG phải admin.
    const approver1 = {
      id: 2, username: 'u_approver1', name: 'Nguyễn Văn Duyệt', dept: 'Phòng A', jobTitle: 'Trưởng Phòng',
      email: 'a1@test.local', phone: '0900000001', active: true, perms: { canBeApprover: true }, groupIds: [], permOverrides: null
    };
    DB.users.push(adminUser, approver1);
    finishLogin(adminUser);
  });

  // Điều hướng THẬT vào Hệ Thống > 🔀 Nghiệp Vụ Nâng Cao > ⚡ Áp Dụng Nhanh (cùng khuôn
  // test-quick-apply-workflow-steps.js).
  await page.evaluate(() => document.querySelector('[data-op="switchTab"][data-arg0="system"]')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#btnSystemTab')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('button[data-op-seq*="setSystemSubTab(ADVWORKFLOW)"]')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => document.querySelector('#btnAdvWorkflowSubQuickApply')?.click());
  await page.waitForTimeout(200);

  const ready = await page.evaluate(() => typeof collectQuickApplyUnconfiguredTargets === 'function' && typeof saveQuickApplyConfig === 'function' && typeof applyQuickApplyConfig === 'function' && typeof onQaStepPeopleToggle === 'function');
  record('setup: module-workflow.js đã nạp xong qua điều hướng thật, các hàm cần test đã sẵn sàng', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục vì hàm chưa nạp được', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===== A: chọn mẫu WF_2STEP + module CAR -> renderQuickApplyPositionSteps() phải vẽ đúng checkbox
  // "👤 Gán Người Cụ Thể" cho mỗi bước, khối người cụ thể mặc định ẩn =====
  await page.evaluate(() => {
    document.getElementById('qaTplSelect').value = 'WF_2STEP';
    renderQuickApplyPositionSteps();
    document.querySelectorAll('.qaModuleCheck').forEach(el => { el.checked = (el.value === 'CAR'); });
  });
  const initialRender = await page.evaluate(() => ({
    hasPeopleToggleStep1: !!document.getElementById('qaPeopleModeToggle_qa_1'),
    hasPeopleToggleStep2: !!document.getElementById('qaPeopleModeToggle_qa_2'),
    peopleBlockStep1Hidden: document.getElementById('qaPeopleBlock_qa_1')?.classList.contains('hidden')
  }));
  record('A1. renderQuickApplyPositionSteps(): vẽ đúng checkbox "👤 Gán Người Cụ Thể" cho cả 2 bước', initialRender.hasPeopleToggleStep1 && initialRender.hasPeopleToggleStep2);
  record('A2. Khối người cụ thể Bước 1 mặc định ẨN (chưa bật)', initialRender.peopleBlockStep1Hidden === true);

  // ===== C: mutual exclusivity — bật "👤 Gán Người Cụ Thể" Bước 1 trước, rồi bật "🧭 Gán theo Chức
  // Danh" CÙNG bước -> phải tự tắt + ẩn khối người cụ thể =====
  await page.evaluate(() => {
    const peopleToggle = document.getElementById('qaPeopleModeToggle_qa_1');
    peopleToggle.checked = true;
    onQaStepPeopleToggle('qa_1', peopleToggle);
  });
  const afterPeopleOn = await page.evaluate(() => ({
    peopleBlockHidden: document.getElementById('qaPeopleBlock_qa_1')?.classList.contains('hidden'),
    posToggleChecked: document.getElementById('qaPosModeToggle_qa_1')?.checked
  }));
  record('C1. Bật "👤 Gán Người Cụ Thể" Bước 1 -> khối người cụ thể HIỆN, "🧭 Gán theo Chức Danh" vẫn tắt', afterPeopleOn.peopleBlockHidden === false && afterPeopleOn.posToggleChecked === false);

  await page.evaluate(() => {
    const posToggle = document.getElementById('qaPosModeToggle_qa_1');
    posToggle.checked = true;
    onQaStepPositionToggle('qa_1', posToggle);
  });
  const afterPositionOnTop = await page.evaluate(() => ({
    peopleToggleChecked: document.getElementById('qaPeopleModeToggle_qa_1')?.checked,
    peopleBlockHidden: document.getElementById('qaPeopleBlock_qa_1')?.classList.contains('hidden'),
    positionBlockHidden: document.getElementById('qaPositionBlock_qa_1')?.classList.contains('hidden')
  }));
  record('C2. Bật tiếp "🧭 Gán theo Chức Danh" CÙNG bước -> tự TẮT + ẨN "👤 Gán Người Cụ Thể" (loại trừ lẫn nhau)', afterPositionOnTop.peopleToggleChecked === false && afterPositionOnTop.peopleBlockHidden === true && afterPositionOnTop.positionBlockHidden === false);

  // Tắt lại "Theo Chức Danh", bật lại "Người Cụ Thể" rồi chọn 1 người thật (mô phỏng click chọn trên UI
  // qua pmsAdd() — hàm dùng chung renderPeopleMultiSelect()/core.js).
  await page.evaluate(() => {
    const posToggle = document.getElementById('qaPosModeToggle_qa_1');
    posToggle.checked = false;
    onQaStepPositionToggle('qa_1', posToggle);
    const peopleToggle = document.getElementById('qaPeopleModeToggle_qa_1');
    peopleToggle.checked = true;
    onQaStepPeopleToggle('qa_1', peopleToggle);
    pmsAdd('qaPeoplePicker_qa_1', 'u_approver1');
  });
  const afterPick = await page.evaluate(() => ({
    checkedCount: document.querySelectorAll('input.qaPeopleApproverCheckbox[data-step="1"]:checked').length,
    chipText: document.getElementById('qaPeoplePicker_qa_1')?.textContent || ''
  }));
  record('B1. pmsAdd() chọn "u_approver1" -> đúng 1 checkbox ẩn (data-step=1) được tick', afterPick.checkedCount === 1);
  record('B2. Chip hiển thị đúng tên người vừa chọn ("Nguyễn Văn Duyệt")', afterPick.chipText.includes('Nguyễn Văn Duyệt'));

  // ===== B: lưu cấu hình, kiểm shape approverMode/approvers =====
  await page.evaluate(() => saveQuickApplyConfig({ preventDefault() {} }));
  const afterCreate = await page.evaluate(() => DB.quickApplyConfigs);
  const configId = afterCreate[afterCreate.length - 1]?.id;
  const cfg = afterCreate.find(c => c.id === configId);
  record('B3. Lưu ĐÚNG approverMode Bước 1 = PEOPLE, Bước 2 KHÔNG có (giữ trống như cũ)', cfg?.approverMode?.[1] === 'PEOPLE' && cfg?.approverMode?.[2] === undefined);
  record('B4. Lưu ĐÚNG approvers Bước 1 = ["u_approver1"]', JSON.stringify(cfg?.approvers?.[1]) === JSON.stringify(['u_approver1']));

  // ===== G: badge danh sách cấu hình =====
  const badgeText = await page.evaluate(() => document.getElementById('quickApplyConfigList')?.textContent || '');
  record('G1. Danh sách cấu hình hiện badge "👤 1 bước theo Người Cụ Thể"', badgeText.includes('👤 1 bước theo Người Cụ Thể'));

  // ===== D: áp dụng — CẢ 2 phòng ban (Phòng A + Phòng B, đều trống) cùng nhận ĐÚNG người cụ thể đó cho
  // Bước 1, Bước 2 vẫn để trống =====
  await page.evaluate((id) => applyQuickApplyConfig(id), configId);
  await page.waitForTimeout(50);
  const afterApply = await page.evaluate(() => ({ a: DB.carDeptWorkflows['Phòng A'], b: DB.carDeptWorkflows['Phòng B'] }));
  record('D1. Áp dụng: CAR Phòng A nhận ĐÚNG approverMode[1]=PEOPLE + approvers[1]=["u_approver1"]',
    afterApply.a?.approverMode?.[1] === 'PEOPLE' && JSON.stringify(afterApply.a?.approvers?.[1]) === JSON.stringify(['u_approver1']));
  record('D2. Áp dụng: CAR Phòng B nhận ĐÚNG CÙNG 1 người đó (không biến đổi theo phòng ban, khác "Tự động khớp phòng ban")',
    afterApply.b?.approverMode?.[1] === 'PEOPLE' && JSON.stringify(afterApply.b?.approvers?.[1]) === JSON.stringify(['u_approver1']));
  record('D3. Bước 2 (không bật gì) vẫn để trống như hành vi cũ ở CẢ 2 phòng ban',
    afterApply.a?.approverMode?.[2] === undefined && afterApply.b?.approverMode?.[2] === undefined);

  // ===== E: editQuickApplyConfig() nạp lại đúng state =====
  await page.evaluate((id) => editQuickApplyConfig(id), configId);
  const editState = await page.evaluate(() => ({
    peopleToggleChecked: document.getElementById('qaPeopleModeToggle_qa_1')?.checked,
    peopleBlockHidden: document.getElementById('qaPeopleBlock_qa_1')?.classList.contains('hidden'),
    posToggleChecked: document.getElementById('qaPosModeToggle_qa_1')?.checked,
    chipText: document.getElementById('qaPeoplePicker_qa_1')?.textContent || ''
  }));
  record('E1. editQuickApplyConfig(): nạp lại ĐÚNG toggle "Người Cụ Thể" Bước 1 (checked, khối hiện)', editState.peopleToggleChecked === true && editState.peopleBlockHidden === false);
  record('E2. editQuickApplyConfig(): "🧭 Gán theo Chức Danh" Bước 1 vẫn TẮT (không lẫn lộn 2 chế độ)', editState.posToggleChecked === false);
  record('E3. editQuickApplyConfig(): chip hiển thị đúng người đã lưu ("Nguyễn Văn Duyệt")', editState.chipText.includes('Nguyễn Văn Duyệt'));

  // ===== F: resetQuickApplyConfigForm() dọn sạch state =====
  await page.evaluate(() => resetQuickApplyConfigForm());
  const resetState = await page.evaluate(() => ({
    peopleToggleChecked: document.getElementById('qaPeopleModeToggle_qa_1')?.checked,
    stepCount: document.querySelectorAll('#qaPositionStepsWrap > div').length
  }));
  record('F1. resetQuickApplyConfigForm(): #qaPositionStepsWrap vẫn vẽ đúng 2 bước (mẫu giữ nguyên)', resetState.stepCount === 2);
  record('F2. resetQuickApplyConfigForm(): toggle "Người Cụ Thể" Bước 1 trở về KHÔNG tick (không rò state)', resetState.peopleToggleChecked === false);

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
