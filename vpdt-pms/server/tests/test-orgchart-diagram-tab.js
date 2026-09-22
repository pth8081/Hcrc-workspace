// server/tests/test-orgchart-diagram-tab.js
//
// Sub-tab MỚI "🖼️ Sơ Đồ Trực Quan" (yêu cầu người dùng 10/2026) — Cơ Cấu Tổ Chức tự vẽ sơ đồ hình ảnh
// CHỈ tới cấp Phòng Ban (không đưa Vị Trí vào hình, khác tab 🌳 Sơ Đồ Tổ Chức vẫn hiện đủ Vị Trí), xem
// trực tiếp + tải về PNG/SVG. Bấm "✅ Áp Dụng Phiên Bản Này" tự chuyển sang đúng sub-tab này.
//
//   1. ocBuildDepartmentTree(): chỉ giữ COMPANY + DEPARTMENT, BỎ QUA mọi node POSITION nằm giữa (kể cả
//      khi 1 Phòng Ban là con của 1 Vị Trí, VD "Tổng Giám Đốc") — gắn đúng vào Phòng Ban/Công Ty tổ
//      tiên gần nhất, giữ nguyên cấu trúc lồng Phòng Ban con.
//   2. Bấm sub-tab "🖼️ Sơ Đồ Trực Quan" -> đúng view hiện/ẩn, SVG chứa tên MỌI Phòng Ban (kể cả Phòng
//      Ban con lồng nhau) nhưng KHÔNG chứa bất kỳ Chức Danh/tên Vị Trí nào.
//   3. Nút "⬇️ Tải SVG (Vector)"/"🖼️ Tải Ảnh (PNG)" tồn tại, bấm không phát sinh lỗi JS (link tải file
//      thật qua Blob — không tự động click-through file dialog nào cần polyfill thêm).
//   4. Bấm "✅ Áp Dụng Phiên Bản Này" (DRAFT -> APPLIED) -> activeOrgChartSubTab tự chuyển 'DIAGRAM',
//      sau khi renderOrgChartModule() chạy xong, view Sơ Đồ Trực Quan phải đang HIỆN (không phải Cây).
//
// Dựng lại đúng khuôn tests/test-car-report-week-month.js (static server phục vụ public/ + Chromium
// thật, không cần route server nào — stub thẳng window.fetch cho 3 endpoint /api/org-chart/* module này
// gọi tới).
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

    // Cây mẫu: Công Ty(1) -> Vị Trí "Tổng Giám Đốc"(2, POSITION) -> Phòng Kinh Doanh(3, DEPARTMENT) ->
    // [Vị Trí "Trưởng Phòng Kinh Doanh"(4, POSITION), Phòng Kinh Doanh Khu Vực 1(6, DEPARTMENT con)];
    // Công Ty(1) -> Phòng IT(5, DEPARTMENT, con TRỰC TIẾP của Công Ty, không qua Vị Trí nào).
    window.__ocNodes = [
      { nodeId: 1, nodeType: 'COMPANY', nodeName: 'CÔNG TY TEST', parentNodeId: null },
      { nodeId: 2, nodeType: 'POSITION', jobTitle: 'Tổng Giám Đốc', parentNodeId: 1, requiresDept: false },
      { nodeId: 3, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', parentNodeId: 2, departmentRef: 'Phòng Kinh Doanh' },
      { nodeId: 4, nodeType: 'POSITION', jobTitle: 'Trưởng Phòng Kinh Doanh', parentNodeId: 3 },
      { nodeId: 5, nodeType: 'DEPARTMENT', nodeName: 'Phòng IT', parentNodeId: 1, departmentRef: 'Phòng IT' },
      { nodeId: 6, nodeType: 'DEPARTMENT', nodeName: 'Kinh Doanh Khu Vực 1', parentNodeId: 3, departmentRef: 'Kinh Doanh Khu Vực 1' }
    ];
    window.__ocApplied = false;
    window.__ocApplyCalled = false;

    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u === '/api/org-chart/versions' && (!opts || opts.method === undefined || opts.method === 'GET')) {
        return {
          ok: true, status: 200,
          json: async () => ({ versions: [{ id: 1, versionName: 'Nháp Test', status: window.__ocApplied ? 'APPLIED' : 'DRAFT', createdBy: 'admin' }] })
        };
      }
      if (u === '/api/org-chart/versions/1' && (!opts || opts.method === undefined || opts.method === 'GET')) {
        return {
          ok: true, status: 200,
          json: async () => ({ version: { id: 1, versionName: 'Nháp Test', status: window.__ocApplied ? 'APPLIED' : 'DRAFT', nodes: window.__ocNodes, kpiFlow: [] } })
        };
      }
      if (u === '/api/org-chart/versions/1/apply' && opts && opts.method === 'POST') {
        window.__ocApplied = true;
        window.__ocApplyCalled = true;
        return {
          ok: true, status: 200,
          json: async () => ({ version: { versionName: 'Nháp Test', effectiveDate: '2026-01-01' }, unresolvedManagerUsers: [] })
        };
      }
      if (u === '/api/org-chart/kpi-flow' && (!opts || opts.method === undefined || opts.method === 'GET')) {
        return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: ['Phòng Kinh Doanh', 'Phòng IT'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], positionTypes: [], users: [
        { id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true }, active: true, groupIds: [], permOverrides: null }
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

  // Điều hướng THẬT vào tab Cơ Cấu Tổ Chức (trigger loadModuleGroup() nạp module-orgchart.js +
  // renderOrgChartModule() tự gọi GET /api/org-chart/versions).
  await page.evaluate(() => switchTab('orgChart'));
  await page.waitForTimeout(300);

  const ready = await page.evaluate(() => typeof ocBuildDepartmentTree === 'function' && typeof renderOrgChartDiagramTab === 'function' && typeof downloadOrgChartDiagramSvg === 'function');
  record('setup: module-orgchart.js đã nạp xong qua điều hướng thật, các hàm cần test đã sẵn sàng', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục vì hàm chưa nạp được', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===== 1. ocBuildDepartmentTree() — chỉ giữ COMPANY+DEPARTMENT, bỏ qua POSITION nằm giữa =====
  const treeState = await page.evaluate(() => {
    const root = ocBuildDepartmentTree(window.__ocNodes);
    // Công Ty -> [Phòng Kinh Doanh -> [Kinh Doanh Khu Vực 1], Phòng IT] (thứ tự không quan trọng).
    const names = (n) => [n.type + ':' + n.name].concat((n.children || []).flatMap(names));
    return { root, flatNames: names(root) };
  });
  record('ocBuildDepartmentTree(): gốc là COMPANY "CÔNG TY TEST"', treeState.root.type === 'COMPANY' && treeState.root.name === 'CÔNG TY TEST');
  record('ocBuildDepartmentTree(): Phòng Kinh Doanh gắn đúng vào Công Ty (bỏ qua Vị Trí "Tổng Giám Đốc" nằm giữa)', treeState.root.children.some(c => c.type === 'DEPARTMENT' && c.name === 'Phòng Kinh Doanh'));
  record('ocBuildDepartmentTree(): Phòng IT (con trực tiếp Công Ty, không qua Vị Trí nào) vẫn đúng vị trí', treeState.root.children.some(c => c.type === 'DEPARTMENT' && c.name === 'Phòng IT'));
  const kinhDoanhNode = treeState.root.children.find(c => c.name === 'Phòng Kinh Doanh');
  record('ocBuildDepartmentTree(): Phòng Kinh Doanh Khu Vực 1 lồng ĐÚNG bên trong Phòng Kinh Doanh (Phòng Ban con)', !!kinhDoanhNode && kinhDoanhNode.children.some(c => c.name === 'Kinh Doanh Khu Vực 1'));
  record('ocBuildDepartmentTree(): KHÔNG có node nào kiểu POSITION trong cây kết quả', !treeState.flatNames.some(n => n.startsWith('POSITION:')));

  // ===== 2. Bấm sub-tab "🖼️ Sơ Đồ Trực Quan" — đúng view hiện/ẩn, SVG chỉ có tên Phòng Ban =====
  const subTabBtnExists = await page.evaluate(() => !!document.getElementById('btnOrgChartSubDiagram'));
  record('Sub-tab "🖼️ Sơ Đồ Trực Quan" tồn tại trên UI thật (không chỉ hàm JS)', subTabBtnExists);

  await page.evaluate(() => document.getElementById('btnOrgChartSubDiagram').click());
  await page.waitForTimeout(150);
  const diagramState = await page.evaluate(() => ({
    diagramVisible: !document.getElementById('orgChartDiagramView').classList.contains('hidden'),
    treeHidden: document.getElementById('orgChartTreeView').classList.contains('hidden'),
    kpiHidden: document.getElementById('orgChartKpiView').classList.contains('hidden'),
    svgHTML: document.getElementById('orgChartDiagramContainer').innerHTML
  }));
  record('Bấm sub-tab Sơ Đồ Trực Quan -> đúng view hiện (Cây/KPI ẩn)', diagramState.diagramVisible && diagramState.treeHidden && diagramState.kpiHidden);
  record('SVG chứa tên MỌI Phòng Ban (kể cả Phòng Ban con lồng nhau)', diagramState.svgHTML.includes('Phòng Kinh Doanh') && diagramState.svgHTML.includes('Phòng IT') && diagramState.svgHTML.includes('Kinh Doanh Khu Vực 1'));
  record('SVG chứa tên Công Ty (node gốc)', diagramState.svgHTML.includes('CÔNG TY TEST'));
  record('SVG KHÔNG chứa bất kỳ Chức Danh/tên Vị Trí nào (đúng yêu cầu "chỉ cần cấp phòng")', !diagramState.svgHTML.includes('Tổng Giám Đốc') && !diagramState.svgHTML.includes('Trưởng Phòng Kinh Doanh'));

  // ===== 3. 2 nút Tải Ảnh/Tải SVG tồn tại, bấm không lỗi JS =====
  const exportBtnsExist = await page.evaluate(() => !!document.getElementById('btnOrgChartDiagramPng') && !!document.getElementById('btnOrgChartDiagramSvg'));
  record('2 nút "🖼️ Tải Ảnh (PNG)"/"⬇️ Tải SVG (Vector)" tồn tại', exportBtnsExist);
  await page.evaluate(() => { document.getElementById('btnOrgChartDiagramSvg').click(); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { document.getElementById('btnOrgChartDiagramPng').click(); });
  await page.waitForTimeout(300);

  // ===== 4. Bấm "✅ Áp Dụng Phiên Bản Này" -> tự chuyển sang sub-tab Sơ Đồ Trực Quan =====
  // Trước tiên bấm sang tab Cây để xác nhận nút Apply thật sự ĐỔI sub-tab (không phải tình cờ đã đúng).
  await page.evaluate(() => document.getElementById('btnOrgChartSubTree').click());
  await page.waitForTimeout(100);
  const beforeApplyOnTree = await page.evaluate(() => !document.getElementById('orgChartTreeView').classList.contains('hidden'));
  record('Trước khi Áp Dụng: đang ở tab Cây (chuẩn bị đối chứng)', beforeApplyOnTree);

  await page.evaluate(() => document.getElementById('btnOrgChartApplyVersion').click());
  await page.waitForTimeout(400);
  const afterApplyState = await page.evaluate(() => ({
    applyCalled: window.__ocApplyCalled === true,
    activeSubTab: activeOrgChartSubTab,
    diagramVisible: !document.getElementById('orgChartDiagramView').classList.contains('hidden'),
    treeVisible: !document.getElementById('orgChartTreeView').classList.contains('hidden')
  }));
  record('Bấm "✅ Áp Dụng Phiên Bản Này" -> gọi đúng API apply', afterApplyState.applyCalled);
  record('Sau khi Áp Dụng: TỰ chuyển sang sub-tab "Sơ Đồ Trực Quan" (activeOrgChartSubTab===\'DIAGRAM\')', afterApplyState.activeSubTab === 'DIAGRAM');
  record('Sau khi Áp Dụng: view Sơ Đồ Trực Quan đang HIỆN, view Cây đang ẨN', afterApplyState.diagramVisible && !afterApplyState.treeVisible);

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
