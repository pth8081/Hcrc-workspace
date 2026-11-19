// tests/test-dsmart-price-ui.js — Playwright THẬT cho UI mới "💰 Cài Đặt Giá Bán Buôn" (Hỗ Trợ IT,
// 12/2026) — bộ lọc thu gọn (cả 3 mục), quyền ẩn/hiện tab, hiển thị trạng thái/badge đúng dữ liệu fixture,
// công tắc Tự Động Xoá. Dựng theo khuôn tests/test-orgchart-headcount-filter-explain.js (standalone
// harness: static server + stub window.fetch/DB tối thiểu, không qua testHarness.js createMockState vì
// route /api/dsmart-price/* là route MỚI hoàn toàn, chưa có trong dispatcher dùng chung).
//
// Chạy: node server/tests/test-dsmart-price-ui.js
'use strict';
const path = require('path');
const http = require('http');
const fs = require('fs');
const assert = require('assert');

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

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (detail ? '\n      ' + detail : '')); }
}

async function main() {
  const PORT = 9970 + Math.floor(Math.random() * 100);
  const server = await startStaticServer(PORT);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return iso(d); };

  const ENTRIES_FIXTURE = [
    { id: 1, dsmartId: 101, custId: '240000000001', skuId: '2900381100', price: 25920, frDate: addDays(-60), toDate: addDays(-10), status: 'ACTIVE', createdBy: 'nguyenvana', createdAt: '2026-08-02T00:00:00.000Z', history: [{ action: 'INSERT', actor: 'nguyenvana', at: '2026-08-02T00:00:00.000Z' }] },
    { id: 2, dsmartId: 102, custId: '240000000005', skuId: '2900555210', price: 52000, frDate: addDays(-5), toDate: addDays(30), status: 'ACTIVE', createdBy: 'nguyenvana', createdAt: '2026-10-28T00:00:00.000Z', history: [{ action: 'INSERT', actor: 'nguyenvana', at: '2026-10-28T00:00:00.000Z' }] },
    { id: 3, dsmartId: 103, custId: '240000000001', skuId: '2900022700', price: 38200, frDate: addDays(-200), toDate: addDays(-150), status: 'DELETED', createdBy: 'nguyenvana', createdAt: '2026-05-01T00:00:00.000Z', deletedBy: 'nguyenvana', deletedAt: '2026-10-10T00:00:00.000Z', history: [{ action: 'INSERT', actor: 'nguyenvana', at: '2026-05-01T00:00:00.000Z' }, { action: 'DELETE', mode: 'MANUAL', actor: 'nguyenvana', at: '2026-10-10T00:00:00.000Z' }] }
  ];
  const HISTORY_FIXTURE = [
    { entryId: 1, custId: '240000000001', skuId: '2900381100', action: 'INSERT', actor: 'nguyenvana', at: '2026-08-02T00:00:00.000Z' },
    { entryId: 3, custId: '240000000001', skuId: '2900022700', action: 'DELETE', mode: 'MANUAL', actor: 'nguyenvana', at: '2026-10-10T00:00:00.000Z' }
  ];

  await page.evaluate(({ entries, history }) => {
    window.alert = () => {};
    window.confirm = () => true;
    window.prompt = () => '';

    window.fetch = async (url, opts) => {
      const u = String(url);
      const method = (opts && opts.method) || 'GET';
      if (u === '/api/dsmart-price/entries') return { ok: true, status: 200, json: async () => ({ ok: true, items: entries }) };
      if (u === '/api/dsmart-price/history') return { ok: true, status: 200, json: async () => ({ ok: true, items: history }) };
      if (u === '/api/dsmart-price/auto-delete-config') {
        if (method === 'GET') return { ok: true, status: 200, json: async () => ({ ok: true, config: { autoDeleteEnabled: true, autoDeleteHour: 23, autoDeleteMinute: 0 } }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, config: { autoDeleteEnabled: true, autoDeleteHour: 23, autoDeleteMinute: 0 } }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };

    Object.assign(DB, {
      depts: [], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], positionTypes: [],
      users: [{ id: 1, username: 'itw1', name: 'IT Giá Bán Buôn', dept: 'Hỗ Trợ IT', jobTitle: 'NV', email: 'a@test.local', phone: '0900000000', perms: { itSupportPriceWriteDsmart: true }, active: true, groupIds: [], permOverrides: null }],
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
  }, { entries: ENTRIES_FIXTURE, history: HISTORY_FIXTURE });

  await page.waitForTimeout(200);
  await page.evaluate(() => Promise.all(Object.keys(MODULE_LOAD_GROUPS || {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(TAB_SECTION_FRAGMENT || {}).map(k => loadTabSectionHtml(k))));
  await page.evaluate(() => { switchTab('itSupport'); });
  await page.waitForTimeout(200);

  check('Tab "💰 Cài Đặt Giá Bán Buôn" HIỆN cho user có quyền itSupportPriceWriteDsmart', await page.isVisible('#btnItSubDsmartPrice'));

  await page.evaluate(() => { setItSupportSubTab('DSMARTPRICE'); });
  await page.waitForTimeout(300);
  check('Bấm sang sub-tab -> hiện đúng khung #itSubDsmartPrice', await page.isVisible('#itSubDsmartPrice'));

  // ===== 3 bộ lọc đều mặc định ĐÓNG =====
  check('Bộ lọc mục 1 (Thêm Giá Mới) mặc định ĐÓNG', (await page.isVisible('#dsmartPriceUploadFilterPanel')) === false);
  check('Bộ lọc mục 2 (Quản Lý) mặc định ĐÓNG', (await page.isVisible('#dsmartPriceMgFilterPanel')) === false);
  check('Bộ lọc mục 3 (Lịch Sử) mặc định ĐÓNG', (await page.isVisible('#dsmartPriceHistoryFilterPanel')) === false);

  await page.click('#btnToggleDsmartPriceMgFilter');
  await page.waitForTimeout(100);
  check('Bấm nút -> MỞ bộ lọc mục 2', await page.isVisible('#dsmartPriceMgFilterPanel'));
  let btnText = await page.textContent('#btnToggleDsmartPriceMgFilter');
  check('Nút đổi chữ thành "Ẩn Bộ Lọc" khi đang mở', btnText.includes('Ẩn Bộ Lọc'), btnText);

  // ===== Danh sách Quản Lý Giá Đã Hết Hạn: đúng trạng thái/badge theo fixture =====
  // Mặc định "Chỉ hiện Đã hết hạn" được tick -> dòng còn hiệu lực lâu (id=2) KHÔNG hiện trong bảng
  const onlyExpiredChecked = await page.isChecked('#dsmartPriceMgOnlyExpired');
  check('"Chỉ hiện Đã hết hạn" mặc định ĐƯỢC tick', onlyExpiredChecked === true);
  let mgText = await page.textContent('#dsmartPriceEntriesBody');
  check('Khi tick "Chỉ hiện Đã hết hạn" -> ẩn dòng còn hiệu lực lâu (240000000005)', !mgText.includes('240000000005'));
  check('Dòng ACTIVE đã hết hạn (toDate quá khứ) -> hiện "Đã hết hạn"', mgText.includes('Đã hết hạn'));
  check('Dòng DELETED -> hiện "Đã xoá"', mgText.includes('Đã xoá'));
  check('Dòng DELETED có nút "↩️ Dùng Lại"', mgText.includes('Dùng Lại'));
  check('Dòng ACTIVE có nút "✏️ Sửa"', mgText.includes('Sửa'));

  // Bỏ tick "Chỉ hiện Đã hết hạn" -> hiện lại dòng còn hiệu lực lâu, kiểm tra badge "Đang áp dụng"
  await page.uncheck('#dsmartPriceMgOnlyExpired');
  await page.waitForTimeout(100);
  mgText = await page.textContent('#dsmartPriceEntriesBody');
  check('Bỏ tick "Chỉ hiện Đã hết hạn" -> hiện lại dòng còn hiệu lực lâu (240000000005)', mgText.includes('240000000005'));
  check('Dòng ACTIVE đang trong hiệu lực -> hiện "Đang áp dụng"', mgText.includes('Đang áp dụng'));

  // ===== Sửa (mở form inline) =====
  await page.evaluate(() => startDsmartPriceEdit(1));
  await page.waitForTimeout(100);
  check('Bấm "✏️ Sửa" -> mở form sửa inline, điền sẵn giá cũ', (await page.isVisible('#dsmartPriceEditForm')) && (await page.inputValue('#dsmartPriceEditPrice')) === '25920');

  // ===== Dùng Lại (mở form inline, điền sẵn, để trống ngày) =====
  await page.evaluate(() => startDsmartPriceReuse(3));
  await page.waitForTimeout(100);
  const reuseVisible = await page.isVisible('#dsmartPriceReuseForm');
  const reusePrice = reuseVisible ? await page.inputValue('#dsmartPriceReusePrice') : null;
  check('Bấm "↩️ Dùng Lại" -> mở form điền sẵn giá cũ (38200), ngày để trống', reuseVisible && reusePrice === '38200');

  // ===== Tự Động Xoá: checkbox phản ánh đúng fixture (enabled=true) =====
  const autoDeleteChecked = await page.isChecked('#dsmartPriceAutoDeleteEnabled');
  check('Công tắc "Tự Động Xoá Khi Hết Hạn" phản ánh đúng cấu hình đã tải (BẬT)', autoDeleteChecked === true);
  const hourVal = await page.inputValue('#dsmartPriceAutoDeleteHour');
  check('Giờ Tự Động Xoá hiển thị đúng (23)', hourVal === '23', hourVal);

  // ===== Lịch Sử Thao Tác =====
  await page.click('#btnToggleDsmartPriceHistoryFilter');
  await page.waitForTimeout(100);
  const historyText = await page.textContent('#dsmartPriceHistoryBody');
  check('Lịch Sử hiện đúng 2 dòng từ fixture (INSERT + DELETE)', historyText.includes('240000000001'));

  check('Không có lỗi JS (pageerror) nào trong suốt quá trình thao tác THẬT', pageErrors.length === 0, pageErrors.join('\n'));

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error('FAIL (uncaught):', err); process.exit(1); });
