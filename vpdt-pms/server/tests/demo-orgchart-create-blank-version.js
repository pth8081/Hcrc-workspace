// server/tests/demo-orgchart-create-blank-version.js
//
// DEMO thật (chụp ảnh, Chromium thật + index.html/module-orgchart.js thật) cho tính năng MỚI "✨ Tạo Bản
// Mới (Trống)" (11/2026, theo yêu cầu người dùng: "Mình muốn tạo thêm một bản, không phải bản nháp mà
// bản mới đi... Hiện tại hạn chế là chỉ tạo được bản nháp, tức là lấy nguyên cái bản... thêm một tính
// năng tạo bản mới mà sạch luôn để mình có thể làm lại đầu").
//
// Cùng khuôn demo-orgchart-add-node-nesting.js: page.exposeFunction() nối fetch() giả trong trình duyệt
// với ĐÚNG hàm thật lib/orgChart.js chạy ở phía Node — vừa lái UI thật (bấm nút thật, xác nhận prompt
// thật) vừa đảm bảo kết quả phản ánh ĐÚNG logic server thật (createBlankVersion()), không phải bịa.
//
// Kịch bản: 1 bản "Đang áp dụng" đã có cây đầy đủ + 2 bản Nháp CŨ (mô phỏng đúng tình huống người dùng mô
// tả "nhiều bản nháp rác tích lại") -> bấm "✨ Tạo Bản Mới (Trống)" -> xác nhận -> đặt tên -> xác nhận cây
// mới CHỈ có đúng 1 node gốc "Công Ty", các bản khác (Đang áp dụng + 2 Nháp cũ) vẫn giữ nguyên.
//
// Chạy: node server/tests/demo-orgchart-create-blank-version.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const orgChart = require('../lib/orgChart');

const OUT_DIR = process.env.OC_BLANK_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'orgchart-create-blank-version');
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

// ===== Dữ liệu mẫu: 1 bản APPLIED có cây đầy đủ + 2 bản DRAFT cũ (rác) =====
let versions = [];
function seed() {
  const applied = { id: 1, versionName: 'Cơ cấu tổ chức Q3/2026', status: 'DRAFT', effectiveDate: null, clonedFromVersionId: null, nodes: [], kpiFlow: [], createdBy: 'admin', createdAt: new Date().toISOString(), appliedBy: null, appliedAt: null };
  const company = orgChart.addNode(applied, { parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty HCRC' });
  const banTgd = orgChart.addNode(applied, { parentNodeId: company.nodeId, nodeType: 'DEPARTMENT', nodeName: 'BAN TỔNG GIÁM ĐỐC' });
  orgChart.addNode(applied, { parentNodeId: banTgd.nodeId, nodeType: 'POSITION', jobTitle: 'Tổng Giám Đốc', requiresDept: false });
  const banVanHanh = orgChart.addNode(applied, { parentNodeId: banTgd.nodeId, nodeType: 'DEPARTMENT', nodeName: 'BAN VẬN HÀNH KINH DOANH' });
  orgChart.addNode(applied, { parentNodeId: banVanHanh.nodeId, nodeType: 'POSITION', jobTitle: 'Quản lý khu vực' });
  // Chuyển sang APPLIED SAU KHI đã dựng xong cây (addNode() chỉ cho sửa bản DRAFT — requireDraft()).
  applied.status = 'APPLIED';
  applied.effectiveDate = '2026-07-01';
  applied.appliedBy = 'admin';
  applied.appliedAt = new Date().toISOString();
  versions.push(applied);
  versions.push({ id: 2, versionName: 'Nháp thử sai 1', status: 'DRAFT', effectiveDate: null, clonedFromVersionId: 1, nodes: orgChart.cloneVersion(versions, 1, 'x', 'admin').nodes, kpiFlow: [], createdBy: 'admin', createdAt: new Date().toISOString(), appliedBy: null, appliedAt: null });
  versions.push({ id: 3, versionName: 'Nháp thử sai 2 (nhầm)', status: 'DRAFT', effectiveDate: null, clonedFromVersionId: 1, nodes: orgChart.cloneVersion(versions, 1, 'y', 'admin').nodes, kpiFlow: [], createdBy: 'admin', createdAt: new Date().toISOString(), appliedBy: null, appliedAt: null });
}
seed();

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const PORT = 9850 + Math.floor(Math.random() * 100);
  const server = await startStaticServer(PORT);

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });

  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  page.on('console', (msg) => { if (msg.type() === 'error') pageErrors.push('[console.error] ' + msg.text()); });

  // Cầu nối Node <-> trình duyệt: fetch() giả gọi THẲNG hàm thật lib/orgChart.js chạy ở phía Node.
  await page.exposeFunction('__serverListVersions', () => versions.map(v => ({ id: v.id, versionName: v.versionName, status: v.status, effectiveDate: v.effectiveDate })));
  await page.exposeFunction('__serverGetVersion', (id) => versions.find(v => v.id === id));
  await page.exposeFunction('__serverCreateBlank', (versionName) => {
    const created = orgChart.createBlankVersion(versions, versionName, 'admin');
    versions.push(created);
    return created;
  });
  await page.exposeFunction('__serverCloneVersion', (sourceId, versionName) => {
    const created = orgChart.cloneVersion(versions, sourceId, versionName, 'admin');
    versions.push(created);
    return created;
  });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  await page.evaluate(() => {
    window.alert = (msg) => { window.__lastAlert = msg; };
    window.confirm = () => true;
    window.prompt = () => 'Cơ cấu tổ chức (bản mới — làm lại từ đầu)';

    window.fetch = async (url, init) => {
      const u = String(url);
      const method = (init && init.method) || 'GET';
      if (u === '/api/org-chart/versions' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ versions: await window.__serverListVersions() }) };
      }
      const getMatch = u.match(/^\/api\/org-chart\/versions\/(\d+)$/);
      if (getMatch && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ version: await window.__serverGetVersion(Number(getMatch[1])) }) };
      }
      if (u === '/api/org-chart/versions/blank' && method === 'POST') {
        const payload = JSON.parse(init.body);
        const created = await window.__serverCreateBlank(payload.versionName);
        return { ok: true, status: 200, json: async () => ({ ok: true, version: created }) };
      }
      const cloneMatch = u.match(/^\/api\/org-chart\/versions\/(\d+)\/clone$/);
      if (cloneMatch && method === 'POST') {
        const payload = JSON.parse(init.body);
        const created = await window.__serverCloneVersion(Number(cloneMatch[1]), payload.versionName);
        return { ok: true, status: 200, json: async () => ({ ok: true, version: created }) };
      }
      if (/\/headcount-report$/.test(u)) return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      if (u === '/api/org-chart/kpi-flow') return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      if (u === '/api/org-chart/diagram-nodes') return { ok: true, status: 200, json: async () => ({ nodes: [] }) };
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

  console.log('📸 01: trước khi tạo — Đang áp dụng + 2 bản Nháp cũ, thấy nút mới "✨ Tạo Bản Mới (Trống)"');
  await page.screenshot({ path: path.join(OUT_DIR, '01-truoc-khi-tao-co-2-ban-nhap-cu.png'), fullPage: true });

  // Mở dropdown phiên bản để chụp rõ danh sách (Đang áp dụng + 2 Nháp cũ) trước khi tạo bản mới.
  const versionOptionsBefore = await page.evaluate(() => [...document.getElementById('orgChartVersionSelect').options].map(o => o.textContent));
  console.log('   Danh sách phiên bản TRƯỚC:', versionOptionsBefore);

  // ===== Bấm THẬT nút "✨ Tạo Bản Mới (Trống)" =====
  await page.click('#btnOrgChartCreateBlank');
  await page.waitForTimeout(400);

  const versionOptionsAfter = await page.evaluate(() => [...document.getElementById('orgChartVersionSelect').options].map(o => o.textContent));
  console.log('   Danh sách phiên bản SAU:', versionOptionsAfter);

  const newVersionIsBlank = await page.evaluate(() => {
    const el = document.getElementById('orgChartTreeContainer');
    const text = el ? el.innerText : '';
    return { text, nodeCount: (window._ocCurrentVersion && window._ocCurrentVersion.nodes || []).length };
  });
  console.log('   Cây của bản mới:', JSON.stringify(newVersionIsBlank));

  console.log('📸 02: sau khi tạo — bản mới CHỈ có gốc "Công Ty", dropdown đã tự chuyển sang xem bản này');
  await page.screenshot({ path: path.join(OUT_DIR, '02-sau-khi-tao-cay-trong-chi-co-cong-ty.png'), fullPage: true });

  await browser.close();
  server.close();

  console.log('\n===== KẾT QUẢ =====');
  console.log('Lỗi JS phát sinh:', pageErrors.length ? pageErrors.join('\n') : '(không có)');
  console.log('Số phiên bản trước:', versionOptionsBefore.length, '-> sau:', versionOptionsAfter.length, '(phải +1)');
  console.log('Bản mới có đúng 1 node "Công Ty" (sạch, không kế thừa gì):', newVersionIsBlank.nodeCount === 1 && newVersionIsBlank.text.includes('Công Ty'));
  console.log('\n✅ Demo hoàn tất — ảnh chụp ở:', OUT_DIR);
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exit(1); });
