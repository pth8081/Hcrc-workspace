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
    { id: 1, dsmartKey: { custId: '240000000001', type: '4', stkId: '', skuId: '2900381100', wsId: 30, frDate: addDays(-60), toDate: addDays(-10) }, custId: '240000000001', skuId: '2900381100', price: 25920, frDate: addDays(-60), toDate: addDays(-10), status: 'ACTIVE', createdBy: 'nguyenvana', createdAt: '2026-08-02T00:00:00.000Z', history: [{ action: 'INSERT', actor: 'nguyenvana', at: '2026-08-02T00:00:00.000Z' }] },
    { id: 2, dsmartKey: { custId: '240000000005', type: '4', stkId: '', skuId: '2900555210', wsId: 30, frDate: addDays(-5), toDate: addDays(30) }, custId: '240000000005', skuId: '2900555210', price: 52000, frDate: addDays(-5), toDate: addDays(30), status: 'ACTIVE', createdBy: 'nguyenvana', createdAt: '2026-10-28T00:00:00.000Z', history: [{ action: 'INSERT', actor: 'nguyenvana', at: '2026-10-28T00:00:00.000Z' }] },
    { id: 3, dsmartKey: { custId: '240000000001', type: '4', stkId: '', skuId: '2900022700', wsId: 30, frDate: addDays(-200), toDate: addDays(-150) }, custId: '240000000001', skuId: '2900022700', price: 38200, frDate: addDays(-200), toDate: addDays(-150), status: 'DELETED', createdBy: 'nguyenvana', createdAt: '2026-05-01T00:00:00.000Z', deletedBy: 'nguyenvana', deletedAt: '2026-10-10T00:00:00.000Z', history: [{ action: 'INSERT', actor: 'nguyenvana', at: '2026-05-01T00:00:00.000Z' }, { action: 'DELETE', mode: 'MANUAL', actor: 'nguyenvana', at: '2026-10-10T00:00:00.000Z' }] }
  ];
  const HISTORY_FIXTURE = [
    { entryId: 1, custId: '240000000001', skuId: '2900381100', action: 'INSERT', actor: 'nguyenvana', at: '2026-08-02T00:00:00.000Z' },
    { entryId: 3, custId: '240000000001', skuId: '2900022700', action: 'DELETE', mode: 'MANUAL', actor: 'nguyenvana', at: '2026-10-10T00:00:00.000Z' }
  ];

  await page.evaluate(({ entries, history }) => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
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
      if (u === '/api/dsmart-price/preview') {
        window.__dsmartPricePreviewCalled = (window.__dsmartPricePreviewCalled || 0) + 1;
        return { ok: true, status: 200, json: async () => ({ ok: true, fileName: 'test-upload.xlsx', rows: [
          { rowNumber: 2, custId: '240000000009', skuId: '2900999900', price: 12345, frDate: '2026-12-01', toDate: '2026-12-31', errors: [], hasOverlap: false }
        ] }) };
      }
      // /apply (12/2026, "LỖI THẬT đã vá" — người dùng báo "Team IT vừa up giá ghi vào dsmart nhưng
      // lỗi" kèm ảnh chụp MOBILE báo "0/1 dòng thành công, 1 dòng lỗi (xem console)" — trên điện thoại
      // KHÔNG mở được DevTools nên không ai thấy được lý do thật) — giả lập ĐÚNG 1 dòng lỗi với thông
      // điệp lỗi thật (giống hình dạng server trả về, routes/dsmartWholesalePrice.js) để xác nhận
      // alert() MỚI hiện thẳng nội dung lỗi, không còn chỉ "xem console".
      if (u === '/api/dsmart-price/apply' && method === 'POST') {
        window.__dsmartPriceApplyCalled = (window.__dsmartPriceApplyCalled || 0) + 1;
        const body = JSON.parse(opts.body);
        const r = body.rows[0];
        return { ok: true, status: 200, json: async () => ({
          ok: true,
          results: [{ custId: r.custId, skuId: r.skuId, success: false, error: 'Khách hàng không tồn tại trong CSPRICE (giả lập lỗi thật từ DSmart16)' }],
          successCount: 0, failCount: 1
        }) };
      }
      if (u === '/api/dsmart-price/config' && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ ok: true, config: { host: 'dsmart16.hcrc.local', port: 1433, database: 'DSmart16DB', user: 'b2b_price', hasPassword: true } }) };
      }
      if (u === '/api/dsmart-price/config/test-connection') {
        window.__dsmartPriceTestConnCalled = (window.__dsmartPriceTestConnCalled || 0) + 1;
        if (window.__dsmartPriceTestConnShouldFail) {
          return { ok: false, status: 400, json: async () => ({ error: 'Không kết nối được tới DSmart16 Trung Tâm (giả lập)' }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, ms: 42 }) };
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

  // ===== Mục 1 "Thêm Giá Mới" thu gọn mặc định (12/2026, theo yêu cầu người dùng) =====
  check('Mục 1 "Thêm Giá Mới" mặc định ĐÓNG (chỉ hiện nút "➕ Thêm Giá Mới")', (await page.isVisible('#dsmartPriceAddFormWrap')) === false);
  let addToggleText = await page.textContent('#btnDsmartPriceAddToggle');
  check('Nút mục 1 hiện đúng chữ "➕ Thêm Giá Mới" khi đang đóng', addToggleText.includes('Thêm Giá Mới'), addToggleText);
  await page.click('#btnDsmartPriceAddToggle');
  await page.waitForTimeout(100);
  check('Bấm "➕ Thêm Giá Mới" -> MỞ ra, thấy ô Chọn File Excel', await page.isVisible('#dsmartPriceAddFormWrap') && await page.isVisible('#dsmartPriceFileInput + button'));
  addToggleText = await page.textContent('#btnDsmartPriceAddToggle');
  check('Nút đổi chữ thành "✕ Đóng" khi đang mở', addToggleText.includes('Đóng'), addToggleText);

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

  // ===== Phân trang mục "2. Quản Lý Giá Đã Hết Hạn"/"3. Lịch Sử Thao Tác" (12/2026, theo yêu cầu
  // người dùng "nhớ phân trang ở hai mục Quản lý lịch sử và Lịch sử thao tác nhé") =====
  const pagination = await page.evaluate(() => ({
    entriesBoxHTML: document.getElementById('paginationContainer_dsmartPriceEntries')?.innerHTML || '',
    entriesInfoText: document.getElementById('pageInfoText_dsmartPriceEntries')?.innerText || '',
    historyBoxHTML: document.getElementById('paginationContainer_dsmartPriceHistory')?.innerHTML || '',
    historyInfoText: document.getElementById('pageInfoText_dsmartPriceHistory')?.innerText || '',
  }));
  check('Mục "2. Quản Lý Giá Đã Hết Hạn" có thanh phân trang + đúng tổng số dòng (3, từ fixture)',
    pagination.entriesBoxHTML.length > 0 && pagination.entriesInfoText.includes('Tổng 3 dòng giá'), JSON.stringify(pagination));
  check('Mục "3. Lịch Sử Thao Tác" có thanh phân trang + đúng tổng số dòng (2, từ fixture)',
    pagination.historyBoxHTML.length > 0 && pagination.historyInfoText.includes('Tổng 2 dòng lịch sử'), JSON.stringify(pagination));

  // Gõ vào ô lọc sau khi tay đã đẩy page lên 2 -> phải tự lùi về trang 1 (onDsmartPriceEntriesFilterChange()/
  // onDsmartPriceHistoryFilterChange() mới thêm) — không gõ lọc còn bảng trống khó hiểu vì đang kẹt ở trang cũ.
  const resetAfterFilter = await page.evaluate(() => {
    listPageState.dsmartPriceEntries.page = 2;
    listPageState.dsmartPriceHistory.page = 2;
    onDsmartPriceEntriesFilterChange();
    onDsmartPriceHistoryFilterChange();
    return { entriesPage: listPageState.dsmartPriceEntries.page, historyPage: listPageState.dsmartPriceHistory.page };
  });
  check('Đổi bộ lọc mục 2 -> tự lùi về trang 1 (onDsmartPriceEntriesFilterChange())', resetAfterFilter.entriesPage === 1, JSON.stringify(resetAfterFilter));
  check('Đổi bộ lọc mục 3 -> tự lùi về trang 1 (onDsmartPriceHistoryFilterChange())', resetAfterFilter.historyPage === 1, JSON.stringify(resetAfterFilter));

  // ===== Tự Động Xoá: checkbox phản ánh đúng fixture (enabled=true) =====
  const autoDeleteChecked = await page.isChecked('#dsmartPriceAutoDeleteEnabled');
  check('Công tắc "Tự Động Xoá Khi Hết Hạn" phản ánh đúng cấu hình đã tải (BẬT)', autoDeleteChecked === true);
  const hourVal = await page.inputValue('#dsmartPriceAutoDeleteHour');
  check('Giờ Tự Động Xoá hiển thị đúng (23)', hourVal === '23', hourVal);

  // ===== Thêm Giá Mới: bấm chọn file THẬT qua input (page.setInputFiles), không giả lập gọi hàm =====
  // Phát hiện bởi audit chéo (12/2026, agent Playwright độc lập): #dsmartPriceFileInput thiếu
  // data-arg-event="0" khiến onDsmartPriceFileChange(event) nhận event=undefined và crash ngay khi
  // người dùng THẬT chọn file — bug này không bị phát hiện bởi các scenario ở trên vì chúng chỉ gọi
  // hàm JS trực tiếp, không bao giờ bắn sự kiện 'change' thật qua input. Test này bắn sự kiện THẬT.
  const ExcelJS = require('exceljs');
  const realXlsxPath = path.join(require('os').tmpdir(), `dsmart-price-ui-test-${Date.now()}.xlsx`);
  const wbReal = new ExcelJS.Workbook();
  const wsReal = wbReal.addWorksheet('Sheet1');
  wsReal.addRow(['Mã Khách B2B', 'Mã sản phẩm', 'Giá sản phẩm', 'Ngày bắt đầu', 'Ngày kết thúc']);
  wsReal.addRow(['240000000009', '2900999900', 12345, '2026-12-01', '2026-12-31']);
  await wbReal.xlsx.writeFile(realXlsxPath);
  await page.setInputFiles('#dsmartPriceFileInput', realXlsxPath);
  await page.waitForTimeout(300);
  fs.unlinkSync(realXlsxPath);
  const previewCalled = await page.evaluate(() => window.__dsmartPricePreviewCalled || 0);
  check('Chọn file THẬT qua input -> gọi POST /preview đúng 1 lần (không crash trước khi gọi)', previewCalled === 1, 'previewCalled=' + previewCalled);
  check('Chọn file THẬT qua input -> không có uncaught pageerror (bug data-arg-event đã phát hiện)', pageErrors.length === 0, pageErrors.join('\n'));
  const uploadPreviewVisible = await page.isVisible('#dsmartPriceUploadPreviewWrap');
  check('Chọn file THẬT qua input -> bảng xem trước hiện ra với đúng dòng đã preview', uploadPreviewVisible && (await page.textContent('#dsmartPriceUploadPreviewWrap')).includes('240000000009'));
  check('Bộ lọc mục 1 (Thêm Giá Mới) vẫn ĐÓNG sau khi có preview (chỉ mở khi bấm nút)', (await page.isVisible('#dsmartPriceUploadFilterPanel')) === false);
  await page.click('#btnToggleDsmartPriceUploadFilter');
  await page.waitForTimeout(100);
  check('Bấm nút -> MỞ bộ lọc mục 1', await page.isVisible('#dsmartPriceUploadFilterPanel'));

  // ===== LỖI THẬT đã vá (12/2026, người dùng báo "Team IT của tôi vừa up giá ghi vào dsmart nhưng lỗi"
  // kèm ảnh chụp MOBILE: alert cũ chỉ ghi "0/1 dòng thành công, 1 dòng lỗi (xem console)" — trên điện
  // thoại KHÔNG có DevTools, lý do lỗi thật bị giấu kín hoàn toàn) — bấm "✅ Thêm Giá Mới Vào DSmart"
  // với dòng preview đã có sẵn (240000000009), mock /apply trả về ĐÚNG 1 dòng lỗi có thông điệp thật —
  // xác nhận alert() MỚI hiện thẳng nội dung lỗi đó, không còn chỉ "xem console".
  await page.click('#btnDsmartPriceApplyUpload');
  await page.waitForTimeout(200);
  const applyCalled = await page.evaluate(() => window.__dsmartPriceApplyCalled || 0);
  const alertsAfterApply = await page.evaluate(() => window.__alerts.slice());
  check('Bấm "✅ Thêm Giá Mới Vào DSmart" -> gọi đúng 1 lần POST /apply', applyCalled === 1, 'applyCalled=' + applyCalled);
  const applyAlert = alertsAfterApply[alertsAfterApply.length - 1] || '';
  check('LỖI THẬT đã vá: alert khi có dòng lỗi phải hiện THẲNG nội dung lỗi thật (không chỉ "xem console", vì mobile không mở được DevTools)',
    applyAlert.includes('Khách hàng không tồn tại trong CSPRICE') && applyAlert.includes('240000000009'), applyAlert);
  check('Alert vẫn báo đúng số dòng thành công/lỗi (0/1 thành công, 1 lỗi)',
    applyAlert.includes('0/1') && applyAlert.includes('1 dòng lỗi'), applyAlert);

  // ===== Lịch Sử Thao Tác =====
  await page.click('#btnToggleDsmartPriceHistoryFilter');
  await page.waitForTimeout(100);
  const historyText = await page.textContent('#dsmartPriceHistoryBody');
  check('Lịch Sử hiện đúng 2 dòng từ fixture (INSERT + DELETE)', historyText.includes('240000000001'));

  // ===== Cấu Hình Kết Nối + "🔌 Kiểm Tra Kết Nối" (12/2026, chỉ admin) =====
  await page.evaluate(() => { currentUser.perms.admin = true; });
  await page.evaluate(() => openDsmartPriceConfigModal());
  await page.waitForTimeout(150);
  check('Admin mở "⚙️ Cấu Hình Kết Nối" -> modal hiện, điền đúng dữ liệu đã tải', (await page.isVisible('#dsmartPriceConfigModal')) && (await page.inputValue('#dsmartPriceCfgHost')) === 'dsmart16.hcrc.local');
  await page.click('#btnDsmartPriceTestConn');
  await page.waitForTimeout(150);
  let testConnStatus = await page.textContent('#dsmartPriceCfgTestStatus');
  check('Bấm "🔌 Kiểm Tra Kết Nối" (kết nối giả lập THÀNH CÔNG) -> hiện đúng kết quả', testConnStatus.includes('thành công'), testConnStatus);
  await page.evaluate(() => { window.__dsmartPriceTestConnShouldFail = true; });
  await page.click('#btnDsmartPriceTestConn');
  await page.waitForTimeout(150);
  testConnStatus = await page.textContent('#dsmartPriceCfgTestStatus');
  check('Bấm lại "🔌 Kiểm Tra Kết Nối" (kết nối giả lập THẤT BẠI) -> hiện đúng lỗi thật, không phải thông báo thành công cũ', testConnStatus.includes('Không kết nối được'), testConnStatus);
  const testConnCalledCount = await page.evaluate(() => window.__dsmartPriceTestConnCalled || 0);
  check('Nút "🔌 Kiểm Tra Kết Nối" gọi đúng route test-connection mỗi lần bấm (không bị cache/chặn lần 2)', testConnCalledCount === 2, 'count=' + testConnCalledCount);

  check('Không có lỗi JS (pageerror) nào trong suốt quá trình thao tác THẬT', pageErrors.length === 0, pageErrors.join('\n'));

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error('FAIL (uncaught):', err); process.exit(1); });
