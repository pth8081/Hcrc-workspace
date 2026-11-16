// server/tests/test-workflow-reset-dept-config-legacy.js
//
// Regression cho LOI DA VA (12/2026, nguoi dung bao "Ap Dung Nhanh" cho "Hop Dong - Phe Duyet" bao
// "khong co gi de ap dung" du vua "Xoa Cau Hinh Tat Ca" bao "khong co gi de xoa" ngay truoc do - 2 thong
// bao tuong mau thuan nhung cung 1 goc): module hasTypes (Van Ban Trinh/Hop Dong - Phe Duyet) co 2 tang
// cau hinh - RIENG theo loai (vd contractTypeApprovalDeptWorkflows[loai][dept]) va CHUNG cu ap dung moi
// loai chua co rieng (legacyDbKey, vd contractApprovalDeptWorkflows[dept]). TRUOC DAY
// isDeptWorkflowConfigured()/clearDeptWorkflowConfig() (public/js/module-itsupport-tier.js) CHI biet ve
// tang RIENG, khong he biet/dong duoc tang CHUNG - trong khi collectQuickApplyUnconfiguredTargets()
// (module-workflow.js) VAN DUNG DAN coi tang CHUNG la "da cau hinh that" (vi no dang thuc su chi phoi
// ket qua duyet, xem resolveContractApprovalDeptWorkflow()/lib/workflowEngine.js) nen tu choi ap dung
// de. Khong co man nao expose duoc tang CHUNG de xoa (activeWfSubmissionType luon ep ve types[0].key,
// khong co tab "Chung" nao) -> phong ban dinh tang CHUNG se MAI MAI bi Quick Apply tu choi, du "Xoa Cau
// Hinh" bao da xoa sach.
//
// Da va: isDeptWorkflowConfigured() nay CUNG xet legacyDbKey; clearDeptWorkflowConfig() nay CUNG xoa
// legacyDbKey; resetDeptWorkflowConfig()/resetAllDeptWorkflowConfigs() nay LUU CA 2 dbKey (qua
// clearAndSyncDeptWorkflowConfigs() moi) khi module co legacyDbKey.
//
// Chay: node server/tests/test-workflow-reset-dept-config-legacy.js
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
      depts: ['Phòng A', 'Phòng B'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], submissionTypes: [{ key: 'DE_XUAT', label: 'Đề Xuất' }],
      contractTypes: ['Hợp đồng kinh tế'], carTypes: [], uniformCatalog: [], itTicketCategories: [],
      workflows: [
        { id: 'WF_1STEP', name: 'Quy trình chung', steps: [{ order: 1, name: 'B1' }] },
        { id: 'WF_3STEP', name: 'Quy trình 3 bước', steps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }, { order: 3, name: 'B3' }] }
      ],
      quickApplyConfigs: [],
      deptWorkflows: {},
      docs: [], submissions: [], submissionApprovalGroups: [],
      submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {},
      contracts: [], contractApprovalGroups: [], contractManageDeptWorkflows: {},
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
      vppRegistrations: [], vppDeptWorkflows: {}, vppPeriods: [], itPriceApprovals: [], itServiceRenewals: [], itSupportTickets: [],
      budgetEntries: [], budgetDeptWorkflows: {}, budgetTemplates: [], budgetPeriods: [],
      reportPeriods: [], reportEntries: [], licenses: [], licenseTypes: [],
      operationOrders: [], operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {},
      operationStoreOpenings: [], operationStoreOpenDeptWorkflows: {},
      operationRepairs: [], operationRepairDeptWorkflows: {},
      operationWorkItems: [], operationExecutionPeriods: [], orgChartManagerOverrides: {},
      // Kịch bản thật người dùng báo: contractTypeApprovalDeptWorkflows (tầng RIÊNG theo loại) HOÀN
      // TOÀN TRỐNG — nhưng contractApprovalDeptWorkflows (tầng CHUNG cũ) VẪN còn 1 entry cho Phòng A,
      // có thể còn sót lại từ trước khi tính năng "Loại Hợp Đồng" ra đời, hoặc 1 lượt Áp Dụng Nhanh/lưu
      // tay rất lâu trước đó — không ai thấy/xoá được qua bất kỳ màn nào.
      contractTypeApprovalDeptWorkflows: {},
      contractApprovalDeptWorkflows: { 'Phòng A': { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } } },
      _versions: {}
    });

    const adminUser = {
      id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng A', jobTitle: 'Nhân viên',
      email: 'admin@test.local', phone: '0900000000', perms: { admin: true }, groupIds: [], permOverrides: null
    };
    DB.users.push(adminUser);
    finishLogin(adminUser);
  });

  await page.evaluate(() => switchTab('system'));
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('#btnSystemSubWorkflow')?.click());
  await page.waitForTimeout(150);
  await page.evaluate(() => switchWfModule('CONTRACT_APPROVAL'));
  await page.waitForTimeout(200);

  const ready = await page.evaluate(() => typeof resetDeptWorkflowConfig === 'function' && typeof resetAllDeptWorkflowConfigs === 'function' && typeof collectQuickApplyUnconfiguredTargets === 'function' && typeof isDeptWorkflowConfigured === 'function');
  record('setup: module-itsupport-tier.js đã nạp xong, các hàm cần test đã sẵn sàng', ready);
  if (!ready) { console.log('DỪNG SỚM:', JSON.stringify(pageErrors)); await browser.close(); server.close(); process.exit(1); }

  // ---- A. LỖI ĐÃ VÁ: Phòng A chỉ có cấu hình CHUNG cũ (không có cấu hình RIÊNG) -> vẫn phải được coi
  // là "đã cấu hình thật" (trước bản vá: false, vì chỉ xét contractTypeApprovalDeptWorkflows) ----
  const before = await page.evaluate(() => ({
    isConfiguredA: isDeptWorkflowConfigured('Phòng A'),
    hasResetBtnA: !!document.querySelector('button[data-op="resetDeptWorkflowConfig"][data-arg0="Phòng A"]'),
    quickApplyTargets: collectQuickApplyUnconfiguredTargets(['CONTRACT_APPROVAL']).map(t => t.label)
  }));
  record('LỖI ĐÃ VÁ: isDeptWorkflowConfigured("Phòng A") = true dù CHỈ có cấu hình chung cũ (không có cấu hình riêng loại nào)', before.isConfiguredA === true, JSON.stringify(before));
  record('LỖI ĐÃ VÁ: thẻ Phòng A giờ CÓ nút "🗑️ Xoá Cấu Hình" (trước đây vô hình, không cách nào xoá)', before.hasResetBtnA === true, JSON.stringify(before));
  record('Đối chứng — ĐÚNG như thiết kế: "⚡ Áp Dụng Nhanh" KHÔNG coi Phòng A là mục thiếu cấu hình (cấu hình chung cũ VẪN đang chi phối kết quả duyệt thật, không được ghi đè)',
    !before.quickApplyTargets.some(t => t.includes('Phòng A')) && before.quickApplyTargets.some(t => t.includes('Phòng B')),
    JSON.stringify(before));

  // ---- B. Bấm "🗑️ Xoá Cấu Hình [Phòng A]" -> xoá HẲN CẢ 2 tầng (riêng + chung) ----
  await page.evaluate(() => document.querySelector('button[data-op="resetDeptWorkflowConfig"][data-arg0="Phòng A"]')?.click());
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => ({
    legacyA: DB.contractApprovalDeptWorkflows['Phòng A'],
    typedA: DB.contractTypeApprovalDeptWorkflows?.['Hợp đồng kinh tế']?.['Phòng A'],
    hasResetBtnA: !!document.querySelector('button[data-op="resetDeptWorkflowConfig"][data-arg0="Phòng A"]'),
    quickApplyTargets: collectQuickApplyUnconfiguredTargets(['CONTRACT_APPROVAL']).map(t => t.label)
  }));
  record('LỖI ĐÃ VÁ: SAU khi xoá, cấu hình CHUNG cũ (contractApprovalDeptWorkflows["Phòng A"]) bị xoá hẳn', after.legacyA === undefined, JSON.stringify(after));
  record('SAU khi xoá: cấu hình RIÊNG theo loại cũng không có gì (vốn đã trống từ đầu, không bị tạo oan)', after.typedA === undefined, JSON.stringify(after));
  record('SAU khi xoá: thẻ Phòng A KHÔNG còn nút "🗑️ Xoá Cấu Hình" (đã về CHƯA CẤU HÌNH thật)', after.hasResetBtnA === false, JSON.stringify(after));
  record('LỖI ĐÃ VÁ — GỐC RỄ TRIỆU CHỨNG NGƯỜI DÙNG BÁO: "⚡ Áp Dụng Nhanh" giờ THẤY Phòng A là mục thiếu cấu hình, có thể áp dụng lại',
    after.quickApplyTargets.some(t => t.includes('Phòng A')), JSON.stringify(after));

  record('Không có lỗi JS (pageerror) nào phát sinh trong suốt bài test', pageErrors.length === 0, pageErrors.join(' | '));

  await browser.close();
  await new Promise((resolve) => server.close(resolve));

  const passCount = results.filter(r => r.pass).length;
  console.log(`\n${passCount}/${results.length} scenarios passed.`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exit(1); });
