// server/tests/demo-orgchart-diagram-root-to-dept-fix.js
//
// DEMO thật (Playwright, người dùng yêu cầu xem demo trước khi xác nhận, 11/2026) cho bản vá lỗi "⛔
// Không thể thêm Phòng Ban" ở tab "🖼️ Cây Sơ Đồ Tổ Chức" — khác các demo org-chart khác trong hệ thống,
// demo NÀY chạy xuyên qua ĐÚNG routes/orgChart.js + lib/appData.js THẬT (chỉ mock lớp SQL Server bên
// dưới cùng, giống tests/test-orgchart-diagram-missing-appdata-key-fix.js) — để ảnh chụp phản ánh ĐÚNG
// hành vi server thật, không phải mock fetch thuần phía client như các demo khác.
//
// Kịch bản người dùng mô tả: "tôi muốn chỗ này tạo tổ chức từ công ty (gốc) đến các phòng ban" — demo
// dưới tạo ĐÚNG thứ tự: 1) "Công Ty HCRC" (gốc, không cha) -> 2) "Phòng Kinh Doanh" (con của Công Ty) ->
// 3) "Phòng IT" (con khác của Công Ty) -> 4) "Kinh Doanh Khu Vực 1" (cháu, con của Phòng Kinh Doanh).
//
// Chạy: node server/tests/demo-orgchart-diagram-root-to-dept-fix.js
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'orgchart-diagram-root-to-dept-fix');

// ===== dbMock: BẮT ĐẦU đã có vài khoá khác (đúng server ĐANG CHẠY từ trước v29.78) nhưng KHÔNG có
// "orgChartDiagramNodes" — tái hiện ĐÚNG trạng thái CSDL người dùng đang gặp lỗi. =====
const appDataStore = { users: JSON.stringify([{ username: 'admin', active: true, perms: { admin: true, orgChartManage: true, nhanSuManage: true } }]) };
function makeDbMock() {
  const dbMock = {
    getPool: async () => ({
      request: () => {
        const inputs = {};
        const reqObj = {
          input(name, _type, value) { inputs[name] = value; return reqObj; },
          query: async (sqlText) => {
            if (/SELECT 1 FROM dbo\.AppData WHERE DataKey = @k/.test(sqlText)) {
              return { recordset: Object.prototype.hasOwnProperty.call(appDataStore, inputs.k) ? [{}] : [] };
            }
            if (/INSERT INTO dbo\.AppData/.test(sqlText)) {
              appDataStore[inputs.k] = JSON.stringify(JSON.parse(inputs.v));
              return { recordset: [] };
            }
            if (/^SELECT DataValue FROM dbo\.AppData WHERE DataKey = @k$/.test(sqlText)) {
              if (!Object.prototype.hasOwnProperty.call(appDataStore, inputs.k)) return { recordset: [] };
              return { recordset: [{ DataValue: appDataStore[inputs.k] }] };
            }
            if (/SELECT DataKey, DataValue FROM dbo\.AppData/.test(sqlText)) {
              return { recordset: Object.entries(appDataStore).map(([DataKey, DataValue]) => ({ DataKey, DataValue })) };
            }
            throw new Error(`Unexpected query trong dbMock: ${sqlText}`);
          }
        };
        return reqObj;
      }
    }),
    sql: {
      NVarChar: () => undefined, NVarChar2: () => undefined, MAX: undefined,
      Transaction: function (_pool) { return { begin: async () => {}, commit: async () => {}, rollback: async () => {} }; },
      Request: function (_tx) {
        const inputs = {};
        const reqObj = {
          input(name, _type, value) { inputs[name] = value; return reqObj; },
          query: async (sqlText) => {
            if (/SELECT DataValue FROM dbo\.AppData WITH \(UPDLOCK, HOLDLOCK\) WHERE DataKey = @k/.test(sqlText)) {
              if (!Object.prototype.hasOwnProperty.call(appDataStore, inputs.k)) return { recordset: [] };
              return { recordset: [{ DataValue: appDataStore[inputs.k] }] };
            }
            if (/UPDATE dbo\.AppData SET DataValue = @v, UpdatedAt = SYSUTCDATETIME\(\) WHERE DataKey = @k/.test(sqlText)) {
              appDataStore[inputs.k] = inputs.v;
              return { recordset: [] };
            }
            throw new Error(`Unexpected query trong dbMock.Request: ${sqlText}`);
          }
        };
        return reqObj;
      }
    }
  };
  return dbMock;
}
stubModule('db.js', makeDbMock());

let CURRENT_USERNAME = 'admin';
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const users = JSON.parse(appDataStore.users);
    const fresh = users.find((u) => u.username === CURRENT_USERNAME);
    req.user = { username: fresh.username };
    req.freshUser = fresh;
    req.allUsers = users;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

async function startApp() {
  const express = require('express');
  const orgChartRoutes = require('../routes/orgChart');
  const app = express();
  app.use(express.json());
  app.use('/api/org-chart', orgChartRoutes);
  app.use(express.static(PUBLIC_DIR));
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('Điểm xuất phát: dbo.AppData CHƯA có "orgChartDiagramNodes" ->', !('orgChartDiagramNodes' in appDataStore));

  const { server, port } = await startApp();
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1180, height: 820 });
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push('[console] ' + m.text()); });

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load' });

  // Mock MỌI gọi API khác (login/DB.* ban đầu) để vào thẳng giao diện đã đăng nhập — CHỈ các URL
  // /api/org-chart/diagram-nodes* mới đi qua window.fetch GỐC, chạm ĐÚNG server Express thật (routes/
  // orgChart.js thật + lib/appData.js thật, chỉ SQL bên dưới bị mock) — không phải giả lập phía client.
  await page.evaluate(() => {
    window.confirm = () => true;
    const realFetch = window.fetch.bind(window);
    window.fetch = async (url, opts) => {
      const u = String(url);
      // Mọi thứ KHÔNG phải gọi API JSON (fragment HTML, ảnh, css...) -> đi thẳng server thật.
      if (!u.startsWith('/api/')) return realFetch(url, opts);
      if (u.startsWith('/api/org-chart/diagram-nodes')) return realFetch(url, opts);
      const method = (opts && opts.method) || 'GET';
      // 1 version APPLIED giả (bỏ qua màn "Khởi Tạo Cơ Cấu Tổ Chức") — tab Cây Sơ Đồ KHÔNG phụ thuộc gì
      // vào version này, chỉ cần có ÍT NHẤT 1 version để hiện đủ 3 nút sub-tab.
      if (u === '/api/org-chart/versions' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ versions: [{ id: 1, versionName: 'Nháp Cơ Cấu + Định Biên 2026', status: 'APPLIED', createdBy: 'admin' }] }) };
      }
      if (u === '/api/org-chart/versions/1' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ version: { id: 1, versionName: 'Nháp Cơ Cấu + Định Biên 2026', status: 'APPLIED', nodes: [{ nodeId: 1, nodeType: 'COMPANY', nodeName: 'CÔNG TY HCRC', parentNodeId: null }], kpiFlow: [] } }) };
      }
      if (u === '/api/org-chart/kpi-flow' && method === 'GET') return { ok: true, status: 200, json: async () => ({ rows: [] }) };
      return { ok: true, status: 200, json: async () => ([]) };
    };
    Object.assign(DB, {
      depts: [], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], positionTypes: [], users: [
        { id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Ban Giám Đốc', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true, orgChartManage: true, nhanSuManage: true }, active: true, groupIds: [], permOverrides: null }
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
  await page.waitForTimeout(400);
  await page.click('#btnOrgChartSubDiagram');
  await page.waitForTimeout(250);

  // ===== TRƯỚC KHI VÁ: server thật (CSDL chưa có khoá orgChartDiagramNodes) =====
  await page.fill('#orgChartDiagramNodeNameInput', 'Công Ty HCRC');
  await page.selectOption('#orgChartDiagramNodeParentSelect', '');
  await page.click('#btnOrgChartDiagramAddNode');
  await page.waitForTimeout(300);
  await shot(page, '#orgChartSection', '01-TRUOC-VA-loi-khong-the-them-phong-ban.png');
  const errorTextBefore = await page.locator('#orgChartDiagramNodeFormStatus').innerText();
  console.log('Thông báo lỗi TRƯỚC khi vá (server thật):', JSON.stringify(errorTextBefore));

  // ===== Mô phỏng ĐÚNG thao tác người dùng sẽ làm: copy code bản vá (defaults.js đã thêm khoá) +
  // `pm2 restart` (seedDefaults() tự chạy, tự chèn dòng còn thiếu — KHÔNG đụng CSDL tay) =====
  const { DEFAULTS } = require('../defaults');
  for (const key of Object.keys(DEFAULTS)) {
    if (!Object.prototype.hasOwnProperty.call(appDataStore, key)) appDataStore[key] = JSON.stringify(DEFAULTS[key]);
  }
  console.log('Sau khi "pm2 restart" (seedDefaults chạy lại): orgChartDiagramNodes đã có dòng ->', 'orgChartDiagramNodes' in appDataStore);

  // ===== SAU KHI VÁ: thử lại đúng thao tác vừa thất bại =====
  await page.click('#btnOrgChartDiagramAddNode');
  await page.waitForTimeout(300);
  await shot(page, '#orgChartSection', '02-SAU-VA-them-cong-ty-goc-thanh-cong.png');

  // Thêm "Phòng Kinh Doanh" — con của "Công Ty HCRC" vừa tạo.
  const congTyId = await page.evaluate(() => _ocDiagramNodes.find(n => n.nodeName === 'Công Ty HCRC').id);
  await page.fill('#orgChartDiagramNodeNameInput', 'Phòng Kinh Doanh');
  await page.selectOption('#orgChartDiagramNodeParentSelect', String(congTyId));
  await page.click('#btnOrgChartDiagramAddNode');
  await page.waitForTimeout(300);

  // Thêm "Phòng IT" — con khác của "Công Ty HCRC" (song song với Phòng Kinh Doanh).
  await page.fill('#orgChartDiagramNodeNameInput', 'Phòng IT');
  await page.selectOption('#orgChartDiagramNodeParentSelect', String(congTyId));
  await page.click('#btnOrgChartDiagramAddNode');
  await page.waitForTimeout(300);
  await shot(page, '#orgChartSection', '03-them-2-phong-ban-con-cua-cong-ty.png');

  // Thêm "Kinh Doanh Khu Vực 1" — cháu (con của Phòng Kinh Doanh) -> xác nhận lồng NHIỀU CẤP từ gốc.
  const kinhDoanhId = await page.evaluate(() => _ocDiagramNodes.find(n => n.nodeName === 'Phòng Kinh Doanh').id);
  await page.fill('#orgChartDiagramNodeNameInput', 'Kinh Doanh Khu Vực 1');
  await page.selectOption('#orgChartDiagramNodeParentSelect', String(kinhDoanhId));
  await page.click('#btnOrgChartDiagramAddNode');
  await page.waitForTimeout(300);
  await shot(page, '#orgChartSection', '04-cay-3-cap-cong-ty-phong-ban-khu-vuc.png');

  console.log('\nLỗi JS (pageerror):', consoleErrors.length ? consoleErrors : '(không có)');
  console.log('Cây cuối cùng:', await page.evaluate(() => JSON.stringify(_ocDiagramNodes.map(n => ({ id: n.id, nodeName: n.nodeName, parentNodeId: n.parentNodeId })))));

  await browser.close();
  server.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
