// server/tests/demo-v2489-hr-features.js
//
// DEMO thật (chụp ảnh, không phải bộ hồi quy — đã có test-hr-discipline-jobgrade-resignation.js +
// test-hr-profile.js/test-hr-profile-field-visibility.js phủ luật nghiệp vụ) cho đúng 4 việc vừa làm ở
// v24.89 (theo yêu cầu người dùng "làm luôn cả 2 phần, Cấp Bậc đã có danh mục chưa, nếu chưa thì cho cấu
// hình"):
//   1. 3 danh mục MỞ mới: Cấp Bậc / Lý Do Nghỉ Việc / Loại Kỷ Luật (Hệ Thống → Quản Lý Danh Mục).
//   2. Cấp Bậc: ô "Cấp Bậc" của Vị Trí (Cơ Cấu Tổ Chức) đổi sang gõ-hoặc-chọn từ danh mục.
//   3. Lý Do Nghỉ Việc: field mới TÁCH riêng ở form tạo Offboarding.
//   4. Kỷ luật + 7 trường Người Phụ Thuộc mới ở Hồ Sơ Nhân Sự (Quản Lý Hồ Sơ).
//
// Dựng lại ĐÚNG khuôn tests/demo-orgchart-headcount.js (static server phục vụ public/ + Chromium thật,
// stub thẳng window.fetch — KHÔNG cần mount route server thật, vì mục tiêu là chụp ảnh ĐÚNG giao diện đã
// render từ dữ liệu seed sẵn, không phải kiểm lại luật server — luật đó đã có bộ test riêng).
//
// Chạy: node server/tests/demo-v2489-hr-features.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const OUT_DIR = process.env.V2489_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'v24.89-hr-features');
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

// ===== Cây Cơ Cấu Tổ Chức mẫu (đủ 1 node POSITION để mở modal Sửa Vị Trí) =====
const ORG_VERSION = {
  id: 1, versionName: 'Cơ cấu tổ chức 2026', status: 'APPLIED',
  nodes: [
    { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'CÔNG TY HCRC', positionKey: null, displayOrder: 0 },
    { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', departmentRef: 'Phòng Kinh Doanh', positionKey: null, displayOrder: 0 },
    { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Trưởng Phòng Kinh Doanh', jobGrade: 'L5', requiresDept: true, positionKey: 'PK-TPKD', headcountQuota: 1, displayOrder: 0 }
  ]
};

// ===== Hồ sơ Nhân Sự mẫu: Kỷ luật + 7 trường mới của Người Phụ Thuộc =====
const HR_PROFILE = {
  employeeCode: 'NV3001', username: 'kd2', status: 'ACTIVE',
  dateOfBirth: '1992-03-10', gender: 'Nam',
  dependents: [{
    id: 'd1', fullName: 'Nguyễn Thị Phụ', relationship: 'Vợ/Chồng', dateOfBirth: '1994-08-20', taxCode: '8099988877',
    nationality: 'Việt Nam', idNumber: '079194002345',
    deductionFromMonth: '2024-01', deductionToMonth: '2026-12', deductionCutMonth: null,
    deductionAmount: 4400000, declarationMonth: '2024-01'
  }],
  education: [],
  disciplinaryActions: [{
    id: 'dis1', date: '2026-08-15', type: 'Nhắc nhở', note: 'Đi làm muộn 3 lần trong tháng',
    decidedBy: 'admin', decidedByName: 'Quản Trị Viên', createdAt: '2026-08-15T09:00:00.000Z'
  }],
  profileEditHistory: []
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1400, height: 1100 });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(({ version, profile }) => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => '';

    window.fetch = async (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || 'GET';
      // Cơ Cấu Tổ Chức (dedicated router) — mirror ĐÚNG khuôn demo-orgchart-headcount.js.
      if (u === '/api/org-chart/versions' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ versions: [{ id: version.id, versionName: version.versionName, status: version.status, createdBy: 'admin' }] }) };
      }
      if (u === `/api/org-chart/versions/${version.id}` && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ version }) };
      }
      if (u === '/api/org-chart/kpi-flow' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      }
      // Hồ Sơ Nhân Sự (dedicated router) — danh sách + chi tiết 1 hồ sơ.
      if (u === '/api/hr-profile' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ profiles: [profile] }) };
      }
      if (u === `/api/hr-profile/by-code/${encodeURIComponent(profile.employeeCode)}` && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ profile }) };
      }
      if (u.startsWith('/api/hr-profile/') && u.includes('/history') && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ history: [] }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: ['Phòng Kinh Doanh'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: ['Trưởng Phòng Kinh Doanh', 'Nhân Viên Kinh Doanh'], storeJobTitles: [], positionTypes: [],
      // 3 danh mục MỚI của v24.89 — đã có sẵn vài giá trị mẫu để minh hoạ.
      jobGrades: ['L3', 'L4', 'L5', 'L6'],
      resignationReasons: ['Nghỉ việc theo nguyện vọng cá nhân', 'Chuyển công tác', 'Hết hạn hợp đồng', 'Về hưu'],
      disciplinaryTypes: ['Nhắc nhở', 'Khiển trách', 'Cảnh cáo', 'Sa thải'],
      users: [
        { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true, hrProfileManage: true }, active: true, groupIds: [], permOverrides: null },
        { id: 2, username: 'kd2', name: 'Nguyễn Văn Kinh Doanh', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân Viên Kinh Doanh', email: 'kd2@test.local', phone: '0911222333', perms: {}, active: true, groupIds: [], permOverrides: null }
      ],
      workflows: [], quickApplyConfigs: [], deptWorkflows: {},
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
      uniformCatalog: [], itTicketCategories: [], hrProcesses: [], hrTaskTemplates: [],
      _versions: {}
    });

    finishLogin(DB.users[0]);
  }, { version: ORG_VERSION, profile: HR_PROFILE });

  // ===== Ảnh 1: Quản Lý Danh Mục — 3 danh mục mới (Cấp Bậc/Lý Do Nghỉ Việc/Loại Kỷ Luật) =====
  await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); });
  await page.waitForSelector('#jobGradeList', { timeout: 5000 });
  await page.waitForTimeout(200);
  {
    const box1 = await page.locator('#jobGradeList').locator('xpath=ancestor::div[contains(@class,"bg-fuchsia-50")]').boundingBox();
    const box2 = await page.locator('#disciplinaryTypeList').locator('xpath=ancestor::div[contains(@class,"bg-fuchsia-50")]').boundingBox();
    const clip = { x: Math.max(0, Math.min(box1.x, box2.x) - 10), y: Math.max(0, box1.y - 10), width: Math.max(box1.width, box2.width) + 20, height: (box2.y + box2.height) - box1.y + 20 };
    await page.screenshot({ path: path.join(OUT_DIR, '1-quan-ly-danh-muc-3-danh-muc-moi.png'), clip });
  }
  console.log('Đã chụp: 1-quan-ly-danh-muc-3-danh-muc-moi.png');

  // ===== Ảnh 2: Cơ Cấu Tổ Chức — ô "Cấp Bậc" gõ-hoặc-chọn từ danh mục =====
  await page.evaluate(() => switchTab('orgChart'));
  await page.waitForTimeout(300);
  await page.evaluate(() => openOrgChartEditNodeModal(3));
  await page.waitForSelector('#orgChartNodeModal:not(.hidden)', { timeout: 5000 });
  // Gõ 1 phần "L" để kích hoạt dropdown gợi ý sdd (hiển thị đúng 4 giá trị DB.jobGrades đã seed).
  await page.click('#orgChartNodeJobGradeInput');
  await page.fill('#orgChartNodeJobGradeInput', 'L');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '2-sua-vi-tri-cap-bac-goi-y.png'), fullPage: true });
  console.log('Đã chụp: 2-sua-vi-tri-cap-bac-goi-y.png');
  await page.evaluate(() => closeOrgChartNodeModal());

  // ===== Ảnh 3: Tạo Offboarding — field "Lý Do Nghỉ Việc" MỚI (tách khỏi "Ghi Chú Thêm") =====
  await page.evaluate(() => switchTab('hrLifecycle'));
  await page.waitForTimeout(300);
  await page.evaluate(() => showHrCreateForm('OFFBOARDING'));
  await page.waitForSelector('#hrpCreateOffboardWrap:not(.hidden)', { timeout: 5000 });
  await page.evaluate(() => {
    document.getElementById('hrpOffbEmployeeInput').value = 'Nguyễn Văn Kinh Doanh — Phòng Kinh Doanh (kd2)';
    document.getElementById('hrpOffbEmployeeUsername').value = 'kd2';
    document.getElementById('hrpOffbLastWorkingDate').value = '2026-11-30';
  });
  await page.click('#hrpOffbResignationReason');
  await page.fill('#hrpOffbResignationReason', 'Nghỉ việc theo nguyện vọng cá nhân');
  await page.evaluate(() => { document.getElementById('hrpOffbReason').value = 'Đã bàn giao đầy đủ công việc cho đồng nghiệp.'; });
  await page.waitForTimeout(200);
  {
    const box = await page.locator('#hrpCreateOffboardWrap').boundingBox();
    await page.screenshot({ path: path.join(OUT_DIR, '3-tao-offboarding-ly-do-nghi-viec.png'), clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: box.width + 20, height: box.height + 20 } });
  }
  console.log('Đã chụp: 3-tao-offboarding-ly-do-nghi-viec.png');

  // ===== Ảnh 4: Hồ Sơ Nhân Sự (Quản Lý Hồ Sơ) — khối "⚠️ Kỷ luật" + 7 trường mới Người Phụ Thuộc =====
  await page.evaluate(() => switchTab('hrProfile'));
  await page.evaluate(() => setHrProfileView('MANAGE'));
  await page.waitForTimeout(200);
  await page.evaluate((code) => openHrpfDetailModal(code, false), HR_PROFILE.employeeCode);
  await page.waitForSelector('#hrpfDetailModal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT_DIR, '4-ho-so-nhan-su-ky-luat-phu-thuoc.png'), fullPage: true });
  console.log('Đã chụp: 4-ho-so-nhan-su-ky-luat-phu-thuoc.png');

  console.log('jsExceptions:', pageErrors);
  await browser.close();
  server.close();
  console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
