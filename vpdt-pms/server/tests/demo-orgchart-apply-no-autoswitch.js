// server/tests/demo-orgchart-apply-no-autoswitch.js
//
// DEMO (Playwright) — theo yêu cầu người dùng (11/2026): "tách cơ cấu tổ chức ra khỏi định biên", bấm
// Áp Dụng xong KHÔNG được tự nhảy sang tab "🖼️ Sơ Đồ Trực Quan" nữa (đảo lại đúng yêu cầu 10/2026 cũ),
// tab Sơ Đồ Trực Quan vẫn là 1 tab RIÊNG người dùng tự bấm qua, và sơ đồ đó vẫn CHỈ có Phòng Ban/Công Ty
// (không có Vị Trí/định biên) — phần này KHÔNG đổi, đã đúng từ trước.
//
// Kịch bản: 1 bản nháp cơ cấu + định biên (có cả Vị Trí "Tổng Giám Đốc", "Trưởng Phòng Kinh Doanh" kèm
// headcountQuota) đang mở ở tab 🌳 Cây. Bấm "✅ Áp Dụng Phiên Bản Này" -> chụp ảnh xác nhận VẪN đang ở
// tab Cây (không tự nhảy). Sau đó TỰ bấm qua tab 🖼️ Sơ Đồ Trực Quan -> chụp ảnh xác nhận sơ đồ chỉ có
// tên Phòng Ban/Công Ty, không có bất kỳ Chức Danh/Vị Trí nào.
//
// Chạy: node server/tests/demo-orgchart-apply-no-autoswitch.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'orgchart-apply-no-autoswitch');

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

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 9800 + Math.floor(Math.random() * 400);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.confirm = () => true;
    window.prompt = () => '';
    window.__ocNodes = [
      { nodeId: 1, nodeType: 'COMPANY', nodeName: 'CÔNG TY HCRC', parentNodeId: null },
      { nodeId: 2, nodeType: 'POSITION', jobTitle: 'Tổng Giám Đốc', parentNodeId: 1, headcountQuota: 1 },
      { nodeId: 3, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', parentNodeId: 2, departmentRef: 'Phòng Kinh Doanh' },
      { nodeId: 4, nodeType: 'POSITION', jobTitle: 'Trưởng Phòng Kinh Doanh', parentNodeId: 3, headcountQuota: 1 },
      { nodeId: 5, nodeType: 'DEPARTMENT', nodeName: 'Phòng IT', parentNodeId: 1, departmentRef: 'Phòng IT' },
      { nodeId: 6, nodeType: 'DEPARTMENT', nodeName: 'Kinh Doanh Khu Vực 1', parentNodeId: 3, departmentRef: 'Kinh Doanh Khu Vực 1' }
    ];
    window.__ocApplied = false;
    window.__ocApplyCalled = false;

    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u === '/api/org-chart/versions' && (!opts || !opts.method || opts.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ versions: [{ id: 1, versionName: 'Nháp Cơ Cấu + Định Biên 2026', status: window.__ocApplied ? 'APPLIED' : 'DRAFT', createdBy: 'admin' }] }) };
      }
      if (u === '/api/org-chart/versions/1' && (!opts || !opts.method || opts.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ version: { id: 1, versionName: 'Nháp Cơ Cấu + Định Biên 2026', status: window.__ocApplied ? 'APPLIED' : 'DRAFT', nodes: window.__ocNodes, kpiFlow: [] } }) };
      }
      if (u === '/api/org-chart/versions/1/apply' && opts && opts.method === 'POST') {
        window.__ocApplied = true;
        window.__ocApplyCalled = true;
        return { ok: true, status: 200, json: async () => ({ version: { versionName: 'Nháp Cơ Cấu + Định Biên 2026', effectiveDate: '2026-11-09' }, unresolvedManagerUsers: [] }) };
      }
      if (u === '/api/org-chart/kpi-flow' && (!opts || !opts.method || opts.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: ['Phòng Kinh Doanh', 'Phòng IT'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], positionTypes: [], users: [
        { id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true, orgChartManage: true }, active: true, groupIds: [], permOverrides: null }
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
      uniformCatalog: [], itTicketCategories: [],
      _versions: {}
    });

    finishLogin(DB.users[0]);
  });

  await page.evaluate(() => switchTab('orgChart'));
  await page.waitForTimeout(300);

  // Đang ở tab 🌳 Cây — hiện rõ cả Vị Trí (có định biên) lẫn Phòng Ban.
  await shot(page, '#orgChartSection', '01-truoc-ap-dung-tab-cay.png');

  // Bấm "✅ Áp Dụng Phiên Bản Này".
  await page.evaluate(() => document.getElementById('btnOrgChartApplyVersion').click());
  await page.waitForTimeout(400);

  const afterApply = await page.evaluate(() => ({
    applyCalled: window.__ocApplyCalled === true,
    activeSubTab: activeOrgChartSubTab,
    treeVisible: !document.getElementById('orgChartTreeView').classList.contains('hidden'),
    diagramVisible: !document.getElementById('orgChartDiagramView').classList.contains('hidden')
  }));
  console.log('Sau khi Áp Dụng:', afterApply);
  await shot(page, '#orgChartSection', '02-sau-ap-dung-VAN-o-tab-cay.png');

  const assert = require('assert');
  assert.strictEqual(afterApply.applyCalled, true, 'LỖI: nút Áp Dụng không gọi API apply');
  assert.strictEqual(afterApply.activeSubTab, 'TREE', 'LỖI: sau Áp Dụng phải VẪN ở tab Cây (TREE), không tự nhảy sang DIAGRAM nữa');
  assert.ok(afterApply.treeVisible && !afterApply.diagramVisible, 'LỖI: view Cây phải đang hiện, view Sơ Đồ phải đang ẩn');
  console.log('✅ Áp Dụng xong KHÔNG tự nhảy tab — vẫn ở tab 🌳 Cây như trước khi bấm.');

  // Người dùng TỰ bấm qua tab "🖼️ Sơ Đồ Trực Quan".
  await page.evaluate(() => document.getElementById('btnOrgChartSubDiagram').click());
  await page.waitForTimeout(200);
  await shot(page, '#orgChartSection', '03-tu-bam-qua-tab-so-do-chi-co-phong-ban.png');

  const diagramSvgText = await page.evaluate(() => document.getElementById('orgChartDiagramContainer').innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ''));
  const hasFlat = (name) => diagramSvgText.includes(name.replace(/\s+/g, ''));
  assert.ok(hasFlat('PhòngKinhDoanh') || hasFlat('Phòng Kinh Doanh'.replace(/\s+/g, '')), 'LỖI: sơ đồ phải có Phòng Kinh Doanh');
  assert.ok(hasFlat('PhòngIT'), 'LỖI: sơ đồ phải có Phòng IT');
  assert.ok(!hasFlat('TổngGiámĐốc') && !hasFlat('TrưởngPhòngKinhDoanh'), 'LỖI: sơ đồ KHÔNG được chứa tên Vị Trí/Chức Danh nào');
  console.log('✅ Tab Sơ Đồ Trực Quan: chỉ có Phòng Ban/Công Ty, không có Vị Trí/định biên nào — đúng yêu cầu.');

  await browser.close();
  server.close();
  console.log('\n🎉 Demo hoàn tất — ảnh lưu tại:', OUT_DIR);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
