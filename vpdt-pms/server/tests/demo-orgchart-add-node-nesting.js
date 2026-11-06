// server/tests/demo-orgchart-add-node-nesting.js
//
// DEMO thật (chụp ảnh, Chromium thật + index.html/module-orgchart.js thật) cho bản vá v29.48 — theo báo
// cáo người dùng: thêm 1 node "Vị Trí" mới (VD "Chủ Tịch") vào 1 phòng ban đã có sẵn nhiều nhánh con lớn
// (VD "BAN TỔNG GIÁM ĐỐC") khiến node mới bị xếp hiện RA SAU TOÀN BỘ nhánh con khác (kể cả nhánh ở rất xa
// như "Khối siêu thị/Cửa hàng" > "Siêu thị hàng trống"), nhìn như "lọt ra ngoài" phòng ban — cả ở màn Cây
// lẫn Báo Cáo Định Biên Nhân Sự. Dựng lại ĐÚNG hình dạng cây thật người dùng mô tả/chụp ảnh.
//
// Khác các demo orgChart tĩnh trước đây (chỉ stub window.fetch trả JSON cố định): demo này dùng
// page.exposeFunction() để nối fetch() giả trong trình duyệt với ĐÚNG hàm thật
// lib/orgChart.js::addNode() + lib/headcountReport.js::computeHeadcountReport() chạy ở phía Node — vừa
// lái UI thật (bấm "+ Thêm nhánh con" thật, điền form thật, bấm Lưu thật) vừa đảm bảo kết quả phản ánh
// ĐÚNG logic server thật, không phải số/cây tự bịa.
//
// Chạy: node server/tests/demo-orgchart-add-node-nesting.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const assert = require('assert');
const orgChart = require('../lib/orgChart');
const { computeHeadcountReport } = require('../lib/headcountReport');

const OUT_DIR = process.env.OC_ADDNODE_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'orgchart-add-node-nesting');
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

// ===== Cây mẫu — ĐÚNG hình dạng người dùng báo cáo: "BAN TỔNG GIÁM ĐỐC" đã có sẵn nhiều nhánh con lớn
// (Tổng Giám Đốc/Phó TGĐ, BAN VẬN HÀNH KINH DOANH -> PHÒNG VẬN HÀNH SIÊU THỊ/CỬA HÀNG -> 2 vị trí, PHÒNG
// KIỂM SOÁT TUÂN THỦ VÀ CHẤT LƯỢNG -> 4 vị trí, Khối siêu thị/Cửa hàng -> Siêu thị hàng trống) TRƯỚC khi
// thêm "Chủ Tịch". =====
let version = { id: 1, versionName: 'Cơ cấu tổ chức 2026', status: 'DRAFT', nodes: [], kpiFlow: [] };
function seed() {
  version.nodes = [];
  const company = orgChart.addNode(version, { parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty HCRC' });
  const banTgd = orgChart.addNode(version, { parentNodeId: company.nodeId, nodeType: 'DEPARTMENT', nodeName: 'BAN TỔNG GIÁM ĐỐC' });
  orgChart.addNode(version, { parentNodeId: banTgd.nodeId, nodeType: 'POSITION', jobTitle: 'Tổng Giám Đốc', requiresDept: false });
  orgChart.addNode(version, { parentNodeId: banTgd.nodeId, nodeType: 'POSITION', jobTitle: 'Phó Tổng Giám đốc', requiresDept: false });
  const banVanHanh = orgChart.addNode(version, { parentNodeId: banTgd.nodeId, nodeType: 'DEPARTMENT', nodeName: 'BAN VẬN HÀNH KINH DOANH' });
  const phongVanHanhSieuThi = orgChart.addNode(version, { parentNodeId: banVanHanh.nodeId, nodeType: 'DEPARTMENT', nodeName: 'PHÒNG VẬN HÀNH SIÊU THỊ /CỬA HÀNG' });
  orgChart.addNode(version, { parentNodeId: phongVanHanhSieuThi.nodeId, nodeType: 'POSITION', jobTitle: 'Quản lý khu vực' });
  orgChart.addNode(version, { parentNodeId: phongVanHanhSieuThi.nodeId, nodeType: 'POSITION', jobTitle: 'Trợ lý kinh doanh' });
  const phongKiemSoat = orgChart.addNode(version, { parentNodeId: banTgd.nodeId, nodeType: 'DEPARTMENT', nodeName: 'PHÒNG KIỂM SOÁT TUÂN THỦ VÀ CHẤT LƯỢNG' });
  orgChart.addNode(version, { parentNodeId: phongKiemSoat.nodeId, nodeType: 'POSITION', jobTitle: 'Trưởng phòng KSTT và Chất lượng' });
  orgChart.addNode(version, { parentNodeId: phongKiemSoat.nodeId, nodeType: 'POSITION', jobTitle: 'Chuyên viên Kiểm soát An ninh' });
  orgChart.addNode(version, { parentNodeId: phongKiemSoat.nodeId, nodeType: 'POSITION', jobTitle: 'Chuyên viên Kiểm soát Tuân thủ' });
  orgChart.addNode(version, { parentNodeId: phongKiemSoat.nodeId, nodeType: 'POSITION', jobTitle: 'Chuyên viên Kiểm soát Chất lượng' });
  const khoiSieuThi = orgChart.addNode(version, { parentNodeId: banTgd.nodeId, nodeType: 'DEPARTMENT', nodeName: 'Khối siêu thị/Cửa hàng' });
  orgChart.addNode(version, { parentNodeId: khoiSieuThi.nodeId, nodeType: 'DEPARTMENT', nodeName: 'Siêu thị hàng trống' });
  return banTgd.nodeId;
}
const banTgdNodeId = seed();

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? '✅ PASS' : '❌ FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 9950 + Math.floor(Math.random() * 100);
  const server = await startStaticServer(PORT);

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 1400 } });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  // Cầu nối Node <-> trình duyệt: fetch() giả trong trang gọi THẲNG hàm thật lib/orgChart.js::addNode()
  // + lib/headcountReport.js::computeHeadcountReport() chạy ở phía Node (đúng logic server thật).
  await page.exposeFunction('__serverAddNode', (payload) => {
    const node = orgChart.addNode(version, payload);
    return { node, parentNodeIdSentByClient: payload.parentNodeId, displayOrderSentByClient: payload.displayOrder };
  });
  await page.exposeFunction('__serverGetVersion', () => version);
  await page.exposeFunction('__serverGetHeadcountRows', () => computeHeadcountReport(version, [], [], []).rows);

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.alert = (msg) => { window.__lastAlert = msg; };
    window.confirm = () => true;
    window.prompt = () => '';

    window.fetch = async (url, init) => {
      const u = String(url);
      const method = (init && init.method) || 'GET';
      if (u === '/api/org-chart/versions') {
        return { ok: true, status: 200, json: async () => ({ versions: [{ id: 1, status: 'DRAFT', versionName: 'Cơ cấu tổ chức 2026' }] }) };
      }
      if (u === '/api/org-chart/versions/1' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ version: await window.__serverGetVersion() }) };
      }
      if (u === '/api/org-chart/versions/1/nodes' && method === 'POST') {
        const payload = JSON.parse(init.body);
        const result = await window.__serverAddNode(payload);
        window.__lastAddNodeCall = result;
        return { ok: true, status: 200, json: async () => ({ ok: true, node: result.node }) };
      }
      if (/\/headcount-report$/.test(u)) {
        return { ok: true, status: 200, json: async () => ({ rows: await window.__serverGetHeadcountRows() }) };
      }
      if (u === '/api/org-chart/kpi-flow') {
        return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: [], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], positionTypes: [], jobGrades: [], jobTitleGradeDefaults: [],
      users: [{ id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true, orgChartManage: true }, active: true, groupIds: [], permOverrides: null }],
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
  await page.waitForTimeout(400);

  record('Setup: tải cây thật (DRAFT) lên UI thật', await page.evaluate(() => !!document.getElementById('orgChartTreeContainer').innerText.includes('BAN TỔNG GIÁM ĐỐC')));

  await page.screenshot({ path: path.join(OUT_DIR, '01-truoc-khi-them-cay-day-du-BAN-TONG-GIAM-DOC.png'), fullPage: true });

  // ===== Bấm "+ Thêm nhánh con" ĐÚNG trên dòng "BAN TỔNG GIÁM ĐỐC" (nodeId thật, không đoán tay) =====
  const clickedParentLabel = await page.evaluate((nodeId) => {
    const btn = document.querySelector(`[data-op="openOrgChartAddNodeModal"][data-arg0="${nodeId}"]`);
    if (!btn) return null;
    btn.click();
    return document.getElementById('orgChartNodeModalParentInfo').innerText;
  }, banTgdNodeId);
  record('Bấm "+ Thêm nhánh con" trên BAN TỔNG GIÁM ĐỐC -> modal hiện đúng "Thêm vào: BAN TỔNG GIÁM ĐỐC"', clickedParentLabel === 'Thêm vào: BAN TỔNG GIÁM ĐỐC', clickedParentLabel);

  // Điền "Chức Danh" = "Chủ Tịch", KHÔNG tick "Thuộc 1 phòng ban cụ thể" (đúng kịch bản người dùng vừa
  // test lại) — Loại Node mặc định đã là "Vị Trí"? KHÔNG — mặc định modal luôn mở ở DEPARTMENT, phải tự
  // chọn "Vị Trí" trước giống thao tác thật của người dùng.
  await page.evaluate(() => {
    document.getElementById('orgChartNodeTypeSelect').value = 'POSITION';
    onOrgChartNodeTypeChange();
    document.getElementById('orgChartNodeJobTitleInput').value = 'Chủ Tịch';
    document.getElementById('orgChartNodeRequiresDeptCheckbox').checked = false;
  });
  await page.screenshot({ path: path.join(OUT_DIR, '02-modal-them-Chu-Tich-vao-BAN-TONG-GIAM-DOC.png') });

  await page.evaluate(() => saveOrgChartNodeClick());
  await page.waitForTimeout(400);

  const callInfo = await page.evaluate(() => window.__lastAddNodeCall);
  record('Payload client gửi lên đúng parentNodeId của BAN TỔNG GIÁM ĐỐC', callInfo && callInfo.parentNodeIdSentByClient === banTgdNodeId, JSON.stringify(callInfo));
  record('Node "Chủ Tịch" được lưu đúng parentNodeId = BAN TỔNG GIÁM ĐỐC (dữ liệu thật trên version)', callInfo && callInfo.node && callInfo.node.parentNodeId === banTgdNodeId, JSON.stringify(callInfo && callInfo.node));

  const modalClosed = await page.evaluate(() => document.getElementById('orgChartNodeModal').classList.contains('hidden'));
  record('Modal đóng lại sau khi Lưu thành công', modalClosed);

  // ===== Kiểm tra VỊ TRÍ HIỂN THỊ trên Cây — "Chủ Tịch" phải xuất hiện NGAY DƯỚI dòng "BAN TỔNG GIÁM
  // ĐỐC", TRƯỚC "Tổng Giám Đốc" (không rơi xuống sau "Khối siêu thị/Cửa hàng" > "Siêu thị hàng trống"). =====
  const treeOrder = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#orgChartTreeContainer > div')];
    return rows.map(r => r.querySelector('strong')?.innerText || '').filter(Boolean);
  });
  const idxBanTgd = treeOrder.indexOf('BAN TỔNG GIÁM ĐỐC');
  const idxChuTich = treeOrder.indexOf('Chủ Tịch');
  const idxTgd = treeOrder.indexOf('Tổng Giám Đốc');
  const idxSieuThiHangTrong = treeOrder.indexOf('Siêu thị hàng trống');
  record('"Chủ Tịch" xuất hiện NGAY SAU "BAN TỔNG GIÁM ĐỐC" trên Cây (trước cả "Tổng Giám Đốc")',
    idxChuTich === idxBanTgd + 1 && idxChuTich < idxTgd,
    `thứ tự thật: ${JSON.stringify(treeOrder)}`);
  record('"Chủ Tịch" KHÔNG còn rơi xuống sau "Siêu thị hàng trống" (lỗi người dùng báo cáo)',
    idxChuTich < idxSieuThiHangTrong,
    `idxChuTich=${idxChuTich} idxSieuThiHangTrong=${idxSieuThiHangTrong}`);

  await page.screenshot({ path: path.join(OUT_DIR, '03-sau-khi-them-Chu-Tich-hien-ngay-duoi-BAN-TONG-GIAM-DOC.png'), fullPage: true });

  // ===== Mở Báo Cáo Định Biên Nhân Sự — kiểm tra ĐÚNG hàng thật, "Chủ Tịch" phải nằm ngay dưới hàng
  // "BAN TỔNG GIÁM ĐỐC", không bị gom dưới "Siêu thị hàng trống". =====
  await page.evaluate(() => document.getElementById('btnOrgChartHeadcountReport').click());
  await page.waitForTimeout(300);
  const headcountOrder = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#orgChartHeadcountTableBody tr')];
    return rows.map(r => r.querySelector('td')?.innerText.replace(/ /g, '').trim() || '');
  });
  const hcIdxBanTgd = headcountOrder.findIndex(t => t.includes('BAN TỔNG GIÁM ĐỐC'));
  const hcIdxChuTich = headcountOrder.findIndex(t => t.includes('Chủ Tịch'));
  const hcIdxSieuThiHangTrong = headcountOrder.findIndex(t => t.includes('Siêu thị hàng trống'));
  record('Báo Cáo Định Biên: "Chủ Tịch" xuất hiện NGAY SAU hàng "BAN TỔNG GIÁM ĐỐC"',
    hcIdxChuTich === hcIdxBanTgd + 1,
    `thứ tự thật: ${JSON.stringify(headcountOrder)}`);
  record('Báo Cáo Định Biên: "Chủ Tịch" KHÔNG còn nằm sau "Siêu thị hàng trống"',
    hcIdxChuTich < hcIdxSieuThiHangTrong,
    `hcIdxChuTich=${hcIdxChuTich} hcIdxSieuThiHangTrong=${hcIdxSieuThiHangTrong}`);

  await page.screenshot({ path: path.join(OUT_DIR, '04-BaoCao-DinhBien-ChuTich-ngay-duoi-BAN-TONG-GIAM-DOC.png'), fullPage: true });

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
  console.log(`Ảnh demo lưu tại: ${OUT_DIR}`);
  if (passed !== total) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
