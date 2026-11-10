// server/tests/test-orgchart-diagram-tab.js
//
// Sub-tab "🖼️ Cây Sơ Đồ Tổ Chức" — VIẾT LẠI HOÀN TOÀN (11/2026, theo yêu cầu người dùng "tách cơ cấu
// tổ chức ra khỏi định biên", demo đã xác nhận): bài test CŨ (trước v29.78) kiểm tra ocBuildDepartmentTree()
// suy cây Phòng Ban TỪ orgChartVersions[].nodes (cùng dữ liệu Định Biên) + hành vi tự-chuyển-tab sau khi
// "Áp Dụng" — CẢ HAI đã đổi hẳn:
//   1. Tab "🌳 Sơ Đồ Tổ Chức" cũ ĐỔI TÊN thành "🧩 Định Biên Nhân Sự" (btnOrgChartSubTree), chức năng
//      giữ nguyên (không liên quan bài test này).
//   2. Tab "🖼️ Sơ Đồ Trực Quan" cũ ĐỔI TÊN thành "🖼️ Cây Sơ Đồ Tổ Chức" (btnOrgChartSubDiagram) — giờ
//      đọc/ghi 1 cây Phòng Ban/Siêu Thị RIÊNG qua API /api/org-chart/diagram-nodes (lib/orgChartDiagramTree.js,
//      khoá AppData "orgChartDiagramNodes") — HOÀN TOÀN TÁCH BIỆT khỏi orgChartVersions, không
//      versioning/DRAFT/APPLIED, thêm/xoá là lưu ngay. ocBuildDepartmentTree()/ocRenderDepartmentDiagram()
//      ĐÃ XOÁ, thay bằng ocBuildDiagramForest()/ocRenderDiagramForest() (nhận MẢNG node gốc — cây này có
//      thể có NHIỀU node gốc song song, không bắt buộc đúng 1 "Công Ty").
//   3. Bấm "✅ Áp Dụng Phiên Bản Này" (Định Biên) KHÔNG còn tự chuyển sang sub-tab Sơ Đồ nữa (ĐẢO LẠI
//      đúng quyết định 10/2026 cũ) — vì sơ đồ giờ là cây RIÊNG, không còn lý do để tự nhảy qua xem ngay
//      sau khi Áp Dụng Định Biên.
//
// Kịch bản bài test MỚI:
//   1. Vào tab Cây Sơ Đồ Tổ Chức lúc chưa có Phòng Ban nào -> thông báo trống đúng, dropdown "Thuộc vào"
//      chỉ có "(gốc)".
//   2. Thêm Phòng Ban gốc "Phòng Kinh Doanh" -> xuất hiện trong danh sách + SVG vẽ ngay (không cần tải
//      lại trang/bấm gì thêm).
//   3. Thêm Phòng Ban con "Kinh Doanh Khu Vực 1" (chọn "Phòng Kinh Doanh" làm cha qua dropdown) -> lồng
//      đúng cấp trong danh sách + SVG.
//   4. Thêm Phòng Ban gốc thứ 2 "Phòng IT" (song song, không chung cha với Phòng Kinh Doanh) -> cả 2 cây
//      gốc cùng vẽ, không đè nhau.
//   5. Xoá "Phòng Kinh Doanh" (có con) -> cascade xoá luôn "Kinh Doanh Khu Vực 1", chỉ còn "Phòng IT".
//   6. Bấm "✅ Áp Dụng Phiên Bản Này" ở tab Định Biên (đang xem tab Cây/Định Biên) -> VẪN ở tab Định
//      Biên, KHÔNG tự nhảy sang tab Sơ Đồ (activeOrgChartSubTab vẫn 'TREE').
//
// Dựng lại đúng khuôn tests/test-car-report-week-month.js (static server phục vụ public/ + Chromium
// thật, không cần route server nào — stub thẳng window.fetch cho các endpoint module này gọi tới, bao
// gồm 3 endpoint MỚI /api/org-chart/diagram-nodes GET/POST/DELETE, mô phỏng lại ĐÚNG hành vi AppData
// (list phẳng trong biến window.__ocDiagramNodesStore, tự tăng id như nextIdFor() ở lib/orgChartDiagramTree.js).
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

    // Định Biên (tab Cây) — 1 version DRAFT đơn giản, chỉ dùng để test Apply KHÔNG tự chuyển tab.
    window.__ocVersionNodes = [
      { nodeId: 1, nodeType: 'COMPANY', nodeName: 'CÔNG TY TEST', parentNodeId: null }
    ];
    window.__ocApplyCalled = false;
    window.__ocApplied = false;

    // Cây Sơ Đồ Tổ Chức (RIÊNG, tách biệt) — mô phỏng khoá AppData orgChartDiagramNodes.
    window.__ocDiagramNodesStore = [];
    window.__ocDiagramNextId = 1;

    window.fetch = async (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || 'GET';
      if (u === '/api/org-chart/versions' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ versions: [{ id: 1, versionName: 'Nháp Test', status: window.__ocApplied ? 'APPLIED' : 'DRAFT', createdBy: 'admin' }] }) };
      }
      if (u === '/api/org-chart/versions/1' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ version: { id: 1, versionName: 'Nháp Test', status: window.__ocApplied ? 'APPLIED' : 'DRAFT', nodes: window.__ocVersionNodes, kpiFlow: [] } }) };
      }
      if (u === '/api/org-chart/versions/1/apply' && method === 'POST') {
        window.__ocApplied = true;
        window.__ocApplyCalled = true;
        return { ok: true, status: 200, json: async () => ({ version: { versionName: 'Nháp Test', effectiveDate: '2026-11-10' }, unresolvedManagerUsers: [] }) };
      }
      if (u === '/api/org-chart/kpi-flow' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      }
      // ===== 3 endpoint MỚI của Cây Sơ Đồ Tổ Chức (lib/orgChartDiagramTree.js) =====
      if (u === '/api/org-chart/diagram-nodes' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ nodes: window.__ocDiagramNodesStore }) };
      }
      if (u === '/api/org-chart/diagram-nodes' && method === 'POST') {
        const body = JSON.parse(opts.body);
        if (!body.nodeName || !body.nodeName.trim()) return { ok: false, status: 400, json: async () => ({ error: 'Vui lòng nhập tên Phòng Ban/Siêu Thị' }) };
        const node = { id: window.__ocDiagramNextId++, parentNodeId: body.parentNodeId != null ? Number(body.parentNodeId) : null, nodeName: body.nodeName.trim() };
        window.__ocDiagramNodesStore.push(node);
        return { ok: true, status: 200, json: async () => ({ ok: true, node }) };
      }
      const delMatch = u.match(/^\/api\/org-chart\/diagram-nodes\/(\d+)$/);
      if (delMatch && method === 'DELETE') {
        const id = Number(delMatch[1]);
        const toDelete = new Set([id]);
        let changed = true;
        while (changed) {
          changed = false;
          window.__ocDiagramNodesStore.forEach(n => {
            if (n.parentNodeId != null && toDelete.has(n.parentNodeId) && !toDelete.has(n.id)) { toDelete.add(n.id); changed = true; }
          });
        }
        window.__ocDiagramNodesStore = window.__ocDiagramNodesStore.filter(n => !toDelete.has(n.id));
        return { ok: true, status: 200, json: async () => ({ ok: true, deletedNodeIds: [...toDelete] }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: [], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
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

  const ready = await page.evaluate(() => typeof ocBuildDiagramForest === 'function' && typeof renderOrgChartDiagramTab === 'function' && typeof downloadOrgChartDiagramSvg === 'function');
  record('setup: module-orgchart.js đã nạp xong qua điều hướng thật, các hàm cần test đã sẵn sàng', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục vì hàm chưa nạp được', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===== 1. Vào tab Cây Sơ Đồ Tổ Chức lúc trống =====
  const subTabBtnExists = await page.evaluate(() => !!document.getElementById('btnOrgChartSubDiagram'));
  record('Sub-tab "🖼️ Cây Sơ Đồ Tổ Chức" tồn tại trên UI thật (không chỉ hàm JS)', subTabBtnExists);
  record('Nhãn sub-tab "🧩 Định Biên Nhân Sự" (đổi tên từ "🌳 Sơ Đồ Tổ Chức")', (await page.evaluate(() => document.getElementById('btnOrgChartSubTree').textContent)).includes('Định Biên Nhân Sự'));
  record('Nhãn sub-tab "🖼️ Cây Sơ Đồ Tổ Chức" (đổi tên từ "🖼️ Sơ Đồ Trực Quan")', (await page.evaluate(() => document.getElementById('btnOrgChartSubDiagram').textContent)).includes('Cây Sơ Đồ Tổ Chức'));

  await page.evaluate(() => document.getElementById('btnOrgChartSubDiagram').click());
  await page.waitForTimeout(250);
  const emptyState = await page.evaluate(() => ({
    diagramVisible: !document.getElementById('orgChartDiagramView').classList.contains('hidden'),
    containerText: document.getElementById('orgChartDiagramContainer').textContent,
    parentOptionsCount: document.getElementById('orgChartDiagramNodeParentSelect').options.length
  }));
  record('Lúc trống: view Sơ Đồ đang hiện, thông báo "chưa có Phòng Ban"', emptyState.diagramVisible && emptyState.containerText.includes('Chưa có Phòng Ban'));
  record('Lúc trống: dropdown "Thuộc vào" chỉ có đúng 1 lựa chọn "(gốc)"', emptyState.parentOptionsCount === 1);

  // ===== 2. Thêm Phòng Ban gốc "Phòng Kinh Doanh" =====
  await page.fill('#orgChartDiagramNodeNameInput', 'Phòng Kinh Doanh');
  await page.click('#btnOrgChartDiagramAddNode');
  await page.waitForTimeout(250);
  // flatSvgText(): LỖI ĐÃ VÁ mẫu CŨ (test-orgchart-diagram-tab.js trước v29.78) — tên dài có thể bị
  // ocWrapLines() xuống dòng (2 thẻ <text> riêng), nên KHÔNG thể so khớp nguyên văn liền mạch trong
  // chuỗi innerHTML thô — gộp toàn bộ nội dung text (bỏ hết thẻ + khoảng trắng) trước khi so khớp.
  const flatSvgText = async () => (await page.evaluate(() => document.getElementById('orgChartDiagramContainer').innerHTML)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, '');
  const afterAdd1 = await page.evaluate(() => ({
    listText: document.getElementById('orgChartDiagramNodeList').textContent
  }));
  record('Thêm "Phòng Kinh Doanh" -> hiện ngay trong danh sách khung trái', afterAdd1.listText.includes('Phòng Kinh Doanh'));
  record('Thêm "Phòng Kinh Doanh" -> SVG tự vẽ lại ngay (không cần tải lại trang)', (await flatSvgText()).includes('PhòngKinhDoanh'));

  // ===== 3. Thêm Phòng Ban con "Kinh Doanh Khu Vực 1" (cha = Phòng Kinh Doanh) =====
  const parentIdKD = await page.evaluate(() => window.__ocDiagramNodesStore.find(n => n.nodeName === 'Phòng Kinh Doanh').id);
  await page.fill('#orgChartDiagramNodeNameInput', 'Kinh Doanh Khu Vực 1');
  await page.selectOption('#orgChartDiagramNodeParentSelect', String(parentIdKD));
  await page.click('#btnOrgChartDiagramAddNode');
  await page.waitForTimeout(250);
  const afterAdd2 = await page.evaluate(() => window.__ocDiagramNodesStore);
  const kdkv1 = afterAdd2.find(n => n.nodeName === 'Kinh Doanh Khu Vực 1');
  record('Thêm "Kinh Doanh Khu Vực 1" lồng ĐÚNG cấp dưới "Phòng Kinh Doanh"', !!kdkv1 && kdkv1.parentNodeId === parentIdKD);

  // ===== 4. Thêm Phòng Ban gốc thứ 2 "Phòng IT" (song song, không chung cha) =====
  await page.fill('#orgChartDiagramNodeNameInput', 'Phòng IT');
  await page.selectOption('#orgChartDiagramNodeParentSelect', '');
  await page.click('#btnOrgChartDiagramAddNode');
  await page.waitForTimeout(250);
  const afterAdd3RootCount = await page.evaluate(() => window.__ocDiagramNodesStore.filter(n => n.parentNodeId == null).length);
  const afterAdd3SvgFlat = await flatSvgText();
  record('Có 2 Phòng Ban gốc song song ("Phòng Kinh Doanh" + "Phòng IT")', afterAdd3RootCount === 2);
  record('SVG vẽ CẢ 2 cây gốc song song, không đè nhau (cả 2 tên đều xuất hiện)', afterAdd3SvgFlat.includes('PhòngKinhDoanh') && afterAdd3SvgFlat.includes('PhòngIT'));

  // ===== 5. Xoá "Phòng Kinh Doanh" (có con) -> cascade xoá "Kinh Doanh Khu Vực 1" =====
  page.once('dialog', d => d.accept());
  await page.evaluate((id) => document.querySelector(`[data-op="deleteOrgChartDiagramNodeClick"][data-arg0="${id}"]`).click(), parentIdKD);
  await page.waitForTimeout(250);
  const afterDeleteStore = await page.evaluate(() => window.__ocDiagramNodesStore);
  const afterDeleteSvgFlat = await flatSvgText();
  record('Xoá "Phòng Kinh Doanh" cascade xoá luôn "Kinh Doanh Khu Vực 1"', !afterDeleteStore.some(n => n.nodeName === 'Kinh Doanh Khu Vực 1'));
  record('Chỉ còn "Phòng IT" sau khi xoá', afterDeleteStore.length === 1 && afterDeleteStore[0].nodeName === 'Phòng IT');
  record('SVG sau khi xoá KHÔNG còn chứa "Phòng Kinh Doanh"', !afterDeleteSvgFlat.includes('PhòngKinhDoanh') && afterDeleteSvgFlat.includes('PhòngIT'));

  // ===== 6. "✅ Áp Dụng Phiên Bản Này" (tab Định Biên) KHÔNG tự chuyển sang tab Sơ Đồ nữa =====
  await page.evaluate(() => document.getElementById('btnOrgChartSubTree').click());
  await page.waitForTimeout(100);
  const beforeApplyOnTree = await page.evaluate(() => !document.getElementById('orgChartTreeView').classList.contains('hidden'));
  record('Trước khi Áp Dụng: đang ở tab Định Biên Nhân Sự (chuẩn bị đối chứng)', beforeApplyOnTree);

  await page.evaluate(() => document.getElementById('btnOrgChartApplyVersion').click());
  await page.waitForTimeout(400);
  const afterApplyState = await page.evaluate(() => ({
    applyCalled: window.__ocApplyCalled === true,
    activeSubTab: activeOrgChartSubTab,
    treeVisible: !document.getElementById('orgChartTreeView').classList.contains('hidden'),
    diagramVisible: !document.getElementById('orgChartDiagramView').classList.contains('hidden')
  }));
  record('Bấm "✅ Áp Dụng Phiên Bản Này" -> gọi đúng API apply', afterApplyState.applyCalled);
  record('Sau khi Áp Dụng: KHÔNG tự chuyển tab nữa — vẫn ở "Định Biên Nhân Sự" (activeOrgChartSubTab===\'TREE\')', afterApplyState.activeSubTab === 'TREE');
  record('Sau khi Áp Dụng: view Định Biên vẫn đang HIỆN, view Sơ Đồ vẫn đang ẨN', afterApplyState.treeVisible && !afterApplyState.diagramVisible);

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
