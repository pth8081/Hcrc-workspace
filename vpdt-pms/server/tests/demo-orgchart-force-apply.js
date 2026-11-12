// server/tests/demo-orgchart-force-apply.js
//
// DEMO thật (chụp ảnh, Chromium thật + index.html/module-orgchart.js thật) cho tính năng "🚨 Áp Dụng
// Cưỡng Chế" (11/2026, theo yêu cầu người dùng: "Giờ tôi muốn xóa để thay thế bản khác làm từ đầu bạn
// xử lý cho tôi xóa được" — gặp lỗi "Không thể áp dụng — còn lỗi cần xử lý" khi bản nháp thay thế xoá
// hẳn các vị trí (VD "Nhân viên Kỹ thuật và Bảo trì Siêu thị...") đang có hàng chục/hàng trăm người giữ,
// đi "Buộc Gỡ & Xoá" từng node 1 không khả thi ở quy mô này).
//
// Cầu nối Node <-> trình duyệt: fetch() giả trong trang gọi THẲNG các hàm thật lib/orgChart.js::
// applyVersionInPlace()/planForceApplyUnassignOccupiedPositions() chạy ở phía Node (đúng logic server
// thật, cùng khuôn demo-orgchart-add-node-nesting.js) — không mock kết quả tay.
//
// Kịch bản: bản ĐANG ÁP DỤNG có vị trí "Nhân Viên Kho A" (PK-A, 1 người giữ qua Hồ Sơ Nhân Sự) + "Nhân
// Viên Kho B" (PK-B, 1 người giữ qua TÀI KHOẢN ĐĂNG NHẬP, không qua Hồ Sơ) — bản nháp thay thế xoá hẳn cả
// 2 vị trí này. Admin có quyền "Buộc Gỡ & Xoá Vị Trí" bấm "Áp Dụng Phiên Bản Này":
//   1. Lần đầu (không cưỡng chế) -> bị chặn "còn người giữ vị trí".
//   2. Xác nhận "Áp Dụng Cưỡng Chế" -> áp dụng thành công, chụp ảnh modal kết quả cho thấy: hồ sơ PK-A
//      được TỰ ĐỘNG gỡ chức vụ, tài khoản PK-B được BÁO CÁO cần tự sửa (KHÔNG bị hệ thống tự sửa).
//
// Chạy: node server/tests/demo-orgchart-force-apply.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const assert = require('assert');
const orgChart = require('../lib/orgChart');

const OUT_DIR = process.env.OC_FORCEAPPLY_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'orgchart-force-apply');
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

// ===== Dữ liệu mẫu — ĐÚNG kịch bản người dùng báo cáo (thu nhỏ: 1 vị trí Hồ Sơ + 1 vị trí tài khoản) =====
const appliedVersion = {
  id: 1, versionName: 'Đang áp dụng — ĐỊNH BIÊN NHÂN SỰ-12.11', status: 'APPLIED', kpiFlow: [], effectiveDate: '2026-11-01',
  nodes: [
    { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty HCRC', positionKey: null, displayOrder: 0 },
    { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Siêu thị Phố Nối', departmentRef: 'Siêu thị Phố Nối', positionKey: null, displayOrder: 0 },
    { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Nhân Viên Kho A', requiresDept: true, positionKey: 'PK-A', displayOrder: 0 },
    { nodeId: 4, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Nhân Viên Kho B', requiresDept: true, positionKey: 'PK-B', displayOrder: 1 }
  ]
};
const draftVersion = {
  id: 2, versionName: 'Nháp Thay Thế Toàn Bộ', status: 'DRAFT', kpiFlow: [], clonedFromVersionId: null,
  nodes: [
    { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty HCRC', positionKey: null, displayOrder: 0 },
    { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Siêu thị Phố Nối (cơ cấu mới)', departmentRef: 'Siêu thị Phố Nối', positionKey: null, displayOrder: 0 }
  ]
};
const employeeProfiles = [
  { employeeCode: 'NV001', username: 'nguyenvanhai', positionKey: 'PK-A', jobTitle: 'Nhân Viên Kho A', dept: 'Siêu thị Phố Nối', positionLabel: null, posType: null, jobGrade: null, status: 'ACTIVE', positionHistory: [] }
];
const users = [
  { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', jobTitle: 'Admin', perms: { admin: true, orgChartManage: true, orgChartForceUnassignDelete: true }, active: true, groupIds: [], permOverrides: null },
  { id: 2, username: 'nguyenvanhai', name: 'Nguyễn Văn Hải', dept: 'Siêu thị Phố Nối', jobTitle: 'Khác', perms: {}, active: true, groupIds: [], permOverrides: null },
  { id: 3, username: 'levanthuong', name: 'Lê Văn Thương', dept: 'Siêu thị Phố Nối', jobTitle: 'Nhân Viên Kho B', perms: {}, active: true, groupIds: [], permOverrides: null }
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 9850 + Math.floor(Math.random() * 100);
  const server = await startStaticServer(PORT);

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 950, height: 900 } });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  // Cầu nối Node <-> trình duyệt — gọi THẲNG hàm thật lib/orgChart.js, mirror ĐÚNG 2 bước của
  // POST /versions/:id/apply thật (routes/orgChart.js): force -> gỡ employeeProfiles TRƯỚC, rồi mới
  // applyVersionInPlace() với cờ bỏ qua check.
  await page.exposeFunction('__serverApply', (body) => {
    const force = body && body.force === true;
    let clearedProfiles = [], accountsNeedingManualFix = [];
    if (force) {
      const result = orgChart.planForceApplyUnassignOccupiedPositions(draftVersion, appliedVersion, users, employeeProfiles, 'admin', 'Quản Trị Viên');
      clearedProfiles = result.clearedProfiles;
      accountsNeedingManualFix = result.accountsNeedingManualFix;
    }
    try {
      const list = [appliedVersion, draftVersion];
      const applied = orgChart.applyVersionInPlace(list, draftVersion.id, users, 'admin', employeeProfiles, { forceUnassignOccupied: force });
      return { ok: true, status: 200, body: { ok: true, version: applied, unresolvedManagerUsers: [], clearedProfiles, accountsNeedingManualFix } };
    } catch (err) {
      return { ok: false, status: 400, body: { error: err.message } };
    }
  });
  await page.exposeFunction('__serverGetVersions', () => ([
    { id: appliedVersion.id, status: appliedVersion.status, versionName: appliedVersion.versionName },
    { id: draftVersion.id, status: draftVersion.status, versionName: draftVersion.versionName }
  ]));
  await page.exposeFunction('__serverGetVersion', (id) => (id === appliedVersion.id ? appliedVersion : draftVersion));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  const capturedDialogs = [];
  await page.evaluate(() => {
    window.alert = (msg) => { window.__lastAlert = msg; };
    window.confirm = (msg) => { (window.__confirms = window.__confirms || []).push(msg); return true; };
    window.prompt = () => '';

    window.fetch = async (url, init) => {
      const u = String(url);
      const method = (init && init.method) || 'GET';
      if (u === '/api/org-chart/versions') {
        return { ok: true, status: 200, json: async () => ({ versions: await window.__serverGetVersions() }) };
      }
      const versionIdMatch = u.match(/^\/api\/org-chart\/versions\/(\d+)$/);
      if (versionIdMatch && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ version: await window.__serverGetVersion(Number(versionIdMatch[1])) }) };
      }
      if (/\/apply$/.test(u) && method === 'POST') {
        const body = init.body ? JSON.parse(init.body) : {};
        const result = await window.__serverApply(body);
        return { ok: result.ok, status: result.status, json: async () => result.body };
      }
      if (u === '/api/org-chart/kpi-flow') return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: [], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], positionTypes: [], jobGrades: [], jobTitleGradeDefaults: [],
      users: [], workflows: [], quickApplyConfigs: [], deptWorkflows: {},
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
      uniformCatalog: [], itTicketCategories: [],
      _versions: {}
    });
  }, users);

  await page.evaluate((admin) => { DB.users = [admin]; finishLogin(admin); }, users[0]);
  await page.evaluate(() => switchTab('orgChart'));
  await page.waitForTimeout(300);

  // Chuyển sang xem bản NHÁP thay thế (id=2) — renderOrgChartModule() (gọi tự động lúc switchTab ở trên)
  // mặc định hiện bản ĐANG ÁP DỤNG (id=1), phải tự đổi ô chọn phiên bản sang bản nháp.
  await page.evaluate(async () => {
    document.getElementById('orgChartVersionSelect').value = '2';
    await onOrgChartVersionSelectChange();
  });
  await page.waitForTimeout(300);

  await page.locator('#orgChartTreeContainer').screenshot({ path: path.join(OUT_DIR, '1-ban-nhap-da-xoa-vi-tri.png') });
  console.log('📸 1-ban-nhap-da-xoa-vi-tri.png');

  // Bấm "Áp Dụng Phiên Bản Này" — lần đầu bị chặn, confirm "Cưỡng Chế" tự được chấp nhận (window.confirm
  // đã override ở trên luôn trả true) -> tự động gửi lại với force:true -> thành công.
  await page.evaluate(() => applyOrgChartVersionClick());
  await page.waitForTimeout(300);

  const confirms = await page.evaluate(() => window.__confirms || []);
  console.log('\nCác hộp thoại confirm() đã hiện ra (đã tự động OK):');
  confirms.forEach((c, i) => console.log(`  [${i + 1}] ${c.split('\n')[0]}`));
  assert(confirms.some(c => /ÁP DỤNG CƯỠNG CHẾ/.test(c)), 'Phải có hộp thoại xác nhận Áp Dụng Cưỡng Chế');

  const modalVisible = await page.evaluate(() => !document.getElementById('orgChartApplyResultModal').classList.contains('hidden'));
  assert(modalVisible, 'Modal kết quả phải hiện ra sau khi áp dụng cưỡng chế thành công');

  await page.locator('#orgChartApplyResultModal').screenshot({ path: path.join(OUT_DIR, '2-ket-qua-ap-dung-cuong-che.png') });
  console.log('📸 2-ket-qua-ap-dung-cuong-che.png');

  const draftStatus = draftVersion.status;
  const appliedStatus = appliedVersion.status;
  const clearedOk = employeeProfiles[0].positionKey === null;
  const nv2Untouched = users.find(u => u.username === 'levanthuong').jobTitle === 'Nhân Viên Kho B';
  console.log('\nKết quả thật sau khi áp dụng cưỡng chế:');
  console.log('  - Bản nháp chuyển trạng thái:', draftStatus, '(phải là APPLIED)');
  console.log('  - Bản cũ chuyển trạng thái:', appliedStatus, '(phải là ARCHIVED)');
  console.log('  - Hồ sơ Nguyễn Văn Hải (PK-A) đã được tự động gỡ chức vụ:', clearedOk);
  console.log('  - Tài khoản Lê Văn Thương (PK-B, khớp qua đăng nhập) KHÔNG bị hệ thống tự sửa:', nv2Untouched);
  assert.strictEqual(draftStatus, 'APPLIED');
  assert.strictEqual(appliedStatus, 'ARCHIVED');
  assert.strictEqual(clearedOk, true);
  assert.strictEqual(nv2Untouched, true);
  assert.strictEqual(pageErrors.length, 0, `Không được có lỗi JS: ${pageErrors.join('; ')}`);

  console.log('\n✅ Demo xác nhận: "Áp Dụng Cưỡng Chế" cho phép thay thế hàng loạt cơ cấu tổ chức dù còn người giữ vị trí bị xoá — tự động gỡ chức vụ Hồ Sơ Nhân Sự, báo cáo riêng tài khoản đăng nhập cần tự sửa (không tự sửa), không có lỗi JS nào phát sinh.');

  await browser.close();
  server.close();
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
