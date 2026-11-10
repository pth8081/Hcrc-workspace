// server/tests/demo-orgchart-diagram-orientation.js
//
// DEMO thật (Playwright) cho tính năng "↔️ Ngang / ↕️ Dọc" ở tab "🖼️ Cây Sơ Đồ Tổ Chức".
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo lại): bản đầu tiên của tính năng này dùng 1 công tắc "Chiều khối"
// DUY NHẤT ở toolbar, đổi là đổi NGUYÊN sơ đồ — không đúng ý người dùng, vốn chỉ muốn đổi chiều của
// ĐÚNG 1 Phòng Ban đang thêm/sửa. Demo này xác nhận bản sửa: mỗi Phòng Ban tự chọn chiều RIÊNG (lúc
// thêm, hoặc đổi lại sau bằng nút ↔️/↕️ nhỏ cạnh mỗi dòng trong danh sách) — CÁC Phòng Ban khác giữ
// nguyên chiều cũ, không bị ảnh hưởng.
//
// Chạy: node server/tests/demo-orgchart-diagram-orientation.js
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'orgchart-diagram-orientation');

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }[ext] || 'application/octet-stream';
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
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.confirm = () => true;
    window.prompt = () => '';
    // 1 Phòng Ban gốc (id 1) + 6 Phòng Ban con (id 2-7), TOÀN BỘ Ngang (mặc định) lúc đầu — mô phỏng
    // đúng tình huống người dùng mô tả "nhiều Phòng Ban cạnh nhau".
    window.__ocDiagramNodesStore = [
      { id: 1, parentNodeId: null, nodeName: 'BAN VẬN HÀNH KINH DOANH', orientation: 'horizontal' },
      { id: 2, parentNodeId: 1, nodeName: 'Kinh Doanh Khu Vực 1', orientation: 'horizontal' },
      { id: 3, parentNodeId: 1, nodeName: 'Kinh Doanh Khu Vực 2', orientation: 'horizontal' },
      { id: 4, parentNodeId: 1, nodeName: 'Kinh Doanh Khu Vực 3', orientation: 'horizontal' },
      { id: 5, parentNodeId: 1, nodeName: 'Phòng Marketing', orientation: 'horizontal' },
      { id: 6, parentNodeId: 1, nodeName: 'Phòng Chăm Sóc Khách Hàng', orientation: 'horizontal' },
      { id: 7, parentNodeId: 1, nodeName: 'Phòng Phát Triển Thị Trường', orientation: 'horizontal' }
    ];
    window.__ocDiagramNextId = 8;

    window.fetch = async (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || 'GET';
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      if (u === '/api/org-chart/versions' && method === 'GET') return { ok: true, status: 200, json: async () => ({ versions: [{ id: 1, versionName: 'Demo', status: 'DRAFT', createdBy: 'admin' }] }) };
      if (u === '/api/org-chart/versions/1' && method === 'GET') return { ok: true, status: 200, json: async () => ({ version: { id: 1, versionName: 'Demo', status: 'DRAFT', nodes: [{ nodeId: 1, nodeType: 'COMPANY', nodeName: 'Công Ty', parentNodeId: null }], kpiFlow: [] } }) };
      if (u === '/api/org-chart/kpi-flow' && method === 'GET') return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      if (u === '/api/org-chart/diagram-nodes' && method === 'GET') return { ok: true, status: 200, json: async () => ({ nodes: window.__ocDiagramNodesStore }) };
      if (u === '/api/org-chart/diagram-nodes' && method === 'POST') {
        const node = { id: window.__ocDiagramNextId++, parentNodeId: body.parentNodeId ?? null, nodeName: body.nodeName, orientation: body.orientation === 'vertical' ? 'vertical' : 'horizontal' };
        window.__ocDiagramNodesStore.push(node);
        return { ok: true, status: 200, json: async () => ({ ok: true, node }) };
      }
      const patchMatch = u.match(/^\/api\/org-chart\/diagram-nodes\/(\d+)$/);
      if (patchMatch && method === 'PATCH') {
        const id = Number(patchMatch[1]);
        const n = window.__ocDiagramNodesStore.find(x => x.id === id);
        if (n && body.orientation !== undefined) n.orientation = body.orientation === 'vertical' ? 'vertical' : 'horizontal';
        return { ok: true, status: 200, json: async () => ({ ok: true, node: n }) };
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
  await page.click('#btnOrgChartSubDiagram');
  await page.waitForTimeout(250);

  // 1) Trạng thái ban đầu — TOÀN BỘ 7 khối đều Ngang.
  await shot(page, '#orgChartSection', '01-tat-ca-ngang-ban-dau.png');
  const initState = await page.evaluate(() => ({ width: document.getElementById('orgChartDiagramSvg').getAttribute('width') }));
  console.log('Chiều rộng sơ đồ (tất cả Ngang):', initState.width);

  // 2) Đổi RIÊNG node id=2 ("Kinh Doanh Khu Vực 1") sang Dọc bằng nút ↕️ nhỏ cạnh dòng tương ứng trong
  // danh sách bên trái — các node khác (3-7) PHẢI giữ nguyên Ngang.
  const node2Row = page.locator('#orgChartDiagramNodeList > div', { hasText: 'Kinh Doanh Khu Vực 1' }).first();
  await node2Row.locator('button[data-arg1="vertical"]').click();
  await page.waitForTimeout(250);
  await shot(page, '#orgChartSection', '02-chi-1-phong-ban-doc-cac-phong-khac-van-ngang.png');

  const mixedState = await page.evaluate(() => {
    const nodes = window.__ocDiagramNodesStore;
    return {
      node2: nodes.find(n => n.id === 2).orientation,
      node3: nodes.find(n => n.id === 3).orientation,
      node5: nodes.find(n => n.id === 5).orientation,
      node7: nodes.find(n => n.id === 7).orientation
    };
  });
  console.log('Chiều lưu lại từng node sau khi đổi:', mixedState);

  const assert = require('assert');
  assert.strictEqual(mixedState.node2, 'vertical', 'LỖI: node vừa đổi (id=2) phải thành Dọc');
  assert.strictEqual(mixedState.node3, 'horizontal', 'LỖI: node KHÁC (id=3) không được bị đổi theo');
  assert.strictEqual(mixedState.node5, 'horizontal', 'LỖI: node KHÁC (id=5) không được bị đổi theo');
  assert.strictEqual(mixedState.node7, 'horizontal', 'LỖI: node KHÁC (id=7) không được bị đổi theo');
  console.log('✅ Chỉ ĐÚNG 1 Phòng Ban đổi chiều, các Phòng Ban khác giữ nguyên — đúng yêu cầu.');

  // 3) Thêm 1 Phòng Ban MỚI với chiều Dọc chọn ngay ở form "➕ Thêm Phòng Ban" (không qua nút sửa) — xác
  // nhận orientation được gửi kèm lúc tạo.
  await page.fill('#orgChartDiagramNodeNameInput', 'Phòng Nhân Sự Mới (Demo)');
  await page.selectOption('#orgChartDiagramNodeParentSelect', '1');
  await page.click('#btnOrgChartAddNodeOrientV');
  await page.waitForTimeout(100);
  await page.click('#btnOrgChartDiagramAddNode');
  await page.waitForTimeout(250);
  await shot(page, '#orgChartSection', '03-them-phong-ban-moi-chon-doc-ngay-luc-them.png');
  const newNodeState = await page.evaluate(() => {
    const nodes = window.__ocDiagramNodesStore;
    const n = nodes.find(x => x.nodeName === 'Phòng Nhân Sự Mới (Demo)');
    return n ? n.orientation : null;
  });
  console.log('Chiều của Phòng Ban mới thêm (phải là vertical):', newNodeState);
  assert.strictEqual(newNodeState, 'vertical', 'LỖI: Phòng Ban mới thêm phải lưu đúng chiều đã chọn ở form');
  console.log('✅ Thêm Phòng Ban mới với chiều riêng hoạt động đúng.');

  // 4) Đổi node 2 về lại Ngang — xác nhận đổi qua đổi lại không ảnh hưởng node khác.
  const node2RowAgain = page.locator('#orgChartDiagramNodeList > div', { hasText: 'Kinh Doanh Khu Vực 1' }).first();
  await node2RowAgain.locator('button[data-arg1="horizontal"]').click();
  await page.waitForTimeout(250);
  await shot(page, '#orgChartSection', '04-doi-lai-ngang-cac-phong-khac-van-khong-doi.png');

  await browser.close();
  server.close();
  console.log('\n🎉 Demo hoàn tất — ảnh lưu tại:', OUT_DIR);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
