// tests/test-orgchart-headcount-filter-explain.js — Playwright THẬT cho 2 tính năng MỚI (12/2026, theo
// yêu cầu người dùng: "báo cáo định biên này bạn làm cho mình cái phần tìm kiếm lọc thông tin... lọc
// thông tin phòng ban... thông tin vị trí... ấn nút thu gọn... cả cái phần giải trình ở trên chỗ export
// file cũng thu gọn vào") ở modal "📋 Báo Cáo Định Biên Nhân Sự":
//   1. Đoạn giải thích các cột ("Định biên = số chỗ được duyệt...") — thu gọn được, mặc định ĐÓNG.
//   2. Bộ lọc "Phòng Ban"/"Vị Trí / Chức Danh" — thu gọn được, mặc định ĐÓNG, lọc ĐÚNG CẤU TRÚC phân cấp
//      (GROUP1 ⊃ GROUP2 ⊃ POSITION, xem ocHeadcountFilteredRows()/module-orgchart.js): chỉ hiện nhóm cha
//      nào còn ít nhất 1 vị trí con khớp, ẩn nhóm rỗng hoàn toàn sau khi lọc.
//   3. Ô "🔍 Tìm Kiếm Nhanh" (#ocHeadcountFilterQuick, MỚI 12/2026, theo yêu cầu người dùng "thêm 1 cái
//      tìm kiếm nữa là tìm kiếm nhanh ấy, gõ bất cứ ký tự nào cũng hiện ra") — khớp GỘP mọi cột (phòng
//      ban/bộ phận/chức danh/cấp bậc/mã vị trí) trong CÙNG 1 ô, khác 2 ô Phòng Ban/Vị Trí (chỉ khớp đúng
//      nhóm cột riêng của nó) — vẫn giữ đúng cấu trúc phân cấp khi lọc.
//
// Dựng theo ĐÚNG khuôn tests/test-orgchart-headcount-modal-binding.js (standalone harness, chỉ stub
// window.fetch + DB tối thiểu) — report fixture có đủ 2 cấp nhóm (GROUP1 ⊃ GROUP2) + vị trí trực thuộc
// GROUP1 không qua GROUP2 nào (đúng hình dạng buildFlatGroupedHeadcountReport() thật).
//
// Chạy: node server/tests/test-orgchart-headcount-filter-explain.js
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
  const PORT = 9960 + Math.floor(Math.random() * 100);
  const server = await startStaticServer(PORT);

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });

  // REPORT fixture — 2 GROUP1 (I="Khối Vận Hành", II="Khối Hành Chính"), I có 1 vị trí TRỰC THUỘC (không
  // qua GROUP2) + 2 GROUP2 con (I.1="Phòng Kế Toán", I.2="Phòng Kinh Doanh"), II có 1 GROUP2
  // (II.1="Phòng Nhân Sự") — đúng hình dạng thật buildFlatGroupedHeadcountReport().
  const REPORT = {
    rootLabel: 'Công Ty', rootStats: { quota: 100, actualTotal: 90, variance: 10 },
    rows: [
      { kind: 'GROUP1', sttLabel: 'I', label: 'Khối Vận Hành', quota: 50, actualTotal: 45, variance: 5 },
      { stt: 1, banPhong: 'Khối Vận Hành', banPhongBoPhan: 'Khối Vận Hành', boPhanNhom: '', chucDanh: 'Trưởng Khối', capBac: 'TK', maViTri: 'VT1', quota: 1, actualTotal: 1, variance: 0 },
      { kind: 'GROUP2', sttLabel: 'I.1', label: 'Phòng Kế Toán', quota: 10, actualTotal: 9, variance: 1 },
      { stt: 1, banPhong: 'Khối Vận Hành', banPhongBoPhan: 'Phòng Kế Toán', boPhanNhom: '', chucDanh: 'Kế Toán Viên', capBac: 'NV', maViTri: 'VT2', quota: 10, actualTotal: 9, variance: 1 },
      { kind: 'GROUP2', sttLabel: 'I.2', label: 'Phòng Kinh Doanh', quota: 39, actualTotal: 35, variance: 4 },
      { stt: 1, banPhong: 'Khối Vận Hành', banPhongBoPhan: 'Phòng Kinh Doanh', boPhanNhom: '', chucDanh: 'Nhân Viên Kinh Doanh', capBac: 'NV', maViTri: 'VT3', quota: 39, actualTotal: 35, variance: 4 },
      { kind: 'GROUP1', sttLabel: 'II', label: 'Khối Hành Chính', quota: 50, actualTotal: 45, variance: 5 },
      { kind: 'GROUP2', sttLabel: 'II.1', label: 'Phòng Nhân Sự', quota: 50, actualTotal: 45, variance: 5 },
      { stt: 1, banPhong: 'Khối Hành Chính', banPhongBoPhan: 'Phòng Nhân Sự', boPhanNhom: '', chucDanh: 'Chuyên Viên Nhân Sự', capBac: 'NV', maViTri: 'VT4', quota: 50, actualTotal: 45, variance: 5 }
    ]
  };

  await page.evaluate((reportFixture) => {
    window.alert = () => {};
    window.confirm = () => true;
    window.prompt = () => '';

    const FAKE_VERSION = {
      id: 1, status: 'APPLIED', versionName: 'v1',
      nodes: [{ nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', displayOrder: 0 }]
    };
    window.fetch = async (url) => {
      const u = String(url);
      if (u === '/api/org-chart/versions') {
        return { ok: true, status: 200, json: async () => ({ versions: [{ id: 1, status: 'APPLIED', versionName: 'v1' }] }) };
      }
      if (u === '/api/org-chart/versions/1') {
        return { ok: true, status: 200, json: async () => ({ version: FAKE_VERSION }) };
      }
      if (/\/headcount-report$/.test(u)) {
        return { ok: true, status: 200, json: async () => reportFixture };
      }
      if (u === '/api/org-chart/kpi-flow') {
        return { ok: true, status: 200, json: async () => ({ rows: [] }) };
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
  }, REPORT);

  await page.waitForTimeout(200);
  await page.evaluate(() => { switchTab('orgChart'); });
  await page.waitForTimeout(200);

  await page.evaluate(() => document.getElementById('btnOrgChartHeadcountReport').click());
  await page.waitForTimeout(300);
  check('Bấm nút mở được modal Báo Cáo Định Biên', await page.isVisible('#orgChartHeadcountModal'));

  // ===== 1) Giải thích các cột — mặc định ĐÓNG =====
  check('Đoạn giải thích các cột mặc định ĐÓNG', (await page.isVisible('#orgChartHeadcountExplainText')) === false);
  let explainBtnText = await page.textContent('#btnToggleOrgChartHeadcountExplain');
  check('Nút "Xem Giải Thích" hiện đúng chữ khi đóng', explainBtnText.includes('Xem Giải Thích'), explainBtnText);
  await page.click('#btnToggleOrgChartHeadcountExplain');
  await page.waitForTimeout(100);
  check('Bấm nút -> MỞ đoạn giải thích ra, đúng nội dung gốc', (await page.isVisible('#orgChartHeadcountExplainText')) && (await page.textContent('#orgChartHeadcountExplainText')).includes('Định biên = số chỗ được duyệt'));
  explainBtnText = await page.textContent('#btnToggleOrgChartHeadcountExplain');
  check('Nút đổi thành "Ẩn Giải Thích" khi đang mở', explainBtnText.includes('Ẩn Giải Thích'), explainBtnText);
  await page.click('#btnToggleOrgChartHeadcountExplain');
  await page.waitForTimeout(100);
  check('Bấm lại -> ĐÓNG đoạn giải thích', (await page.isVisible('#orgChartHeadcountExplainText')) === false);

  // ===== 2) Bộ lọc — mặc định ĐÓNG, chưa lọc gì thấy đủ 4 vị trí + 3 nhóm (2 GROUP1 + 3 GROUP2) =====
  check('Panel bộ lọc mặc định ĐÓNG', (await page.isVisible('#orgChartHeadcountFilterPanel')) === false);
  let fullText = await page.textContent('#orgChartHeadcountTableBody');
  check('Chưa lọc gì -> đủ cả 4 vị trí (Trưởng Khối/Kế Toán Viên/Nhân Viên Kinh Doanh/Chuyên Viên Nhân Sự)',
    ['Trưởng Khối', 'Kế Toán Viên', 'Nhân Viên Kinh Doanh', 'Chuyên Viên Nhân Sự'].every(s => fullText.includes(s)));
  check('Chưa lọc gì -> đủ cả 2 nhóm cấp 1 (Khối Vận Hành/Khối Hành Chính)',
    fullText.includes('Khối Vận Hành') && fullText.includes('Khối Hành Chính'));

  await page.click('#btnToggleOrgChartHeadcountFilter');
  await page.waitForTimeout(100);
  check('Bấm nút -> MỞ panel bộ lọc ra', await page.isVisible('#orgChartHeadcountFilterPanel'));

  // ===== 3) Lọc theo Phòng Ban = "Kế Toán" -> CHỈ còn GROUP1 "Khối Vận Hành" (cha) + GROUP2 "Phòng Kế
  // Toán" + vị trí "Kế Toán Viên" — ẩn HẲN "Khối Hành Chính"/"Phòng Kinh Doanh"/"Phòng Nhân Sự" (rỗng sau lọc) =====
  await page.fill('#ocHeadcountFilterDept', 'Kế Toán');
  await page.waitForTimeout(200);
  let filteredText = await page.textContent('#orgChartHeadcountTableBody');
  check('Lọc Phòng Ban "Kế Toán" -> còn đúng "Kế Toán Viên" + nhóm cha "Khối Vận Hành"/"Phòng Kế Toán"',
    filteredText.includes('Kế Toán Viên') && filteredText.includes('Khối Vận Hành') && filteredText.includes('Phòng Kế Toán'));
  check('Lọc Phòng Ban "Kế Toán" -> ẩn HẲN "Khối Hành Chính" (nhóm cha rỗng sau lọc, không còn con nào khớp)',
    !filteredText.includes('Khối Hành Chính'));
  check('Lọc Phòng Ban "Kế Toán" -> ẩn vị trí không liên quan (Trưởng Khối/Nhân Viên Kinh Doanh/Chuyên Viên Nhân Sự)',
    !filteredText.includes('Trưởng Khối') && !filteredText.includes('Nhân Viên Kinh Doanh') && !filteredText.includes('Chuyên Viên Nhân Sự'));
  console.log('PASS-GROUP: Lọc Phòng Ban giữ đúng cấu trúc phân cấp, ẩn nhóm cha rỗng hoàn toàn');
  await page.fill('#ocHeadcountFilterDept', '');
  await page.waitForTimeout(150);

  // ===== 4) Lọc theo Vị Trí = "Trưởng" -> CHỈ còn "Trưởng Khối" (vị trí trực thuộc GROUP1, không qua
  // GROUP2 nào) + nhóm cha "Khối Vận Hành" — không có GROUP2 nào hiện (vì header null của sub chứa nó) =====
  await page.fill('#ocHeadcountFilterPosition', 'Trưởng');
  await page.waitForTimeout(200);
  filteredText = await page.textContent('#orgChartHeadcountTableBody');
  check('Lọc Vị Trí "Trưởng" -> chỉ còn "Trưởng Khối" + nhóm cha "Khối Vận Hành", ẩn mọi vị trí/nhóm khác',
    filteredText.includes('Trưởng Khối') && filteredText.includes('Khối Vận Hành')
    && !filteredText.includes('Kế Toán Viên') && !filteredText.includes('Phòng Kế Toán')
    && !filteredText.includes('Nhân Viên Kinh Doanh') && !filteredText.includes('Khối Hành Chính'));
  console.log('PASS-POS: Lọc Vị Trí xử lý đúng cả vị trí trực thuộc GROUP1 (không qua GROUP2 nào)');
  await page.fill('#ocHeadcountFilterPosition', '');
  await page.waitForTimeout(150);

  // ===== 5) Lọc ra 0 kết quả -> thông báo rõ ràng, không phải bảng trống im lặng =====
  await page.fill('#ocHeadcountFilterDept', 'Không Tồn Tại Phòng Ban Nào Như Vậy');
  await page.waitForTimeout(200);
  filteredText = await page.textContent('#orgChartHeadcountTableBody');
  check('Lọc không khớp gì -> hiện thông báo rõ ràng "Không có vị trí nào khớp"', filteredText.includes('Không có vị trí nào khớp'));
  await page.fill('#ocHeadcountFilterDept', '');
  await page.waitForTimeout(150);

  // ===== 6) Tìm Kiếm Nhanh (#ocHeadcountFilterQuick) — khớp GỘP mọi cột trong 1 ô duy nhất =====
  // 6a) Khớp theo CẤP BẬC ("TK" chỉ có ở "Trưởng Khối") — cột mà 2 ô Phòng Ban/Vị Trí KHÔNG tìm tới.
  await page.fill('#ocHeadcountFilterQuick', 'TK');
  await page.waitForTimeout(200);
  filteredText = await page.textContent('#orgChartHeadcountTableBody');
  check('Tìm Kiếm Nhanh theo Cấp Bậc "TK" -> chỉ còn "Trưởng Khối" + nhóm cha "Khối Vận Hành"',
    filteredText.includes('Trưởng Khối') && filteredText.includes('Khối Vận Hành')
    && !filteredText.includes('Kế Toán Viên') && !filteredText.includes('Nhân Viên Kinh Doanh') && !filteredText.includes('Chuyên Viên Nhân Sự'));
  await page.fill('#ocHeadcountFilterQuick', '');
  await page.waitForTimeout(150);

  // 6b) Khớp theo MÃ VỊ TRÍ ("VT3" chỉ có ở "Nhân Viên Kinh Doanh").
  await page.fill('#ocHeadcountFilterQuick', 'VT3');
  await page.waitForTimeout(200);
  filteredText = await page.textContent('#orgChartHeadcountTableBody');
  check('Tìm Kiếm Nhanh theo Mã Vị Trí "VT3" -> chỉ còn "Nhân Viên Kinh Doanh" + nhóm cha/nhóm con đúng',
    filteredText.includes('Nhân Viên Kinh Doanh') && filteredText.includes('Khối Vận Hành') && filteredText.includes('Phòng Kinh Doanh')
    && !filteredText.includes('Kế Toán Viên') && !filteredText.includes('Trưởng Khối') && !filteredText.includes('Chuyên Viên Nhân Sự'));
  await page.fill('#ocHeadcountFilterQuick', '');
  await page.waitForTimeout(150);

  // 6c) Khớp theo TÊN PHÒNG BAN (gộp chung, giống ô Phòng Ban riêng) — xác nhận ô gộp cũng khớp được cột đó.
  await page.fill('#ocHeadcountFilterQuick', 'Nhân Sự');
  await page.waitForTimeout(200);
  filteredText = await page.textContent('#orgChartHeadcountTableBody');
  check('Tìm Kiếm Nhanh theo tên phòng ban "Nhân Sự" -> chỉ còn "Chuyên Viên Nhân Sự" + nhóm cha "Khối Hành Chính"',
    filteredText.includes('Chuyên Viên Nhân Sự') && filteredText.includes('Khối Hành Chính')
    && !filteredText.includes('Trưởng Khối') && !filteredText.includes('Kế Toán Viên') && !filteredText.includes('Nhân Viên Kinh Doanh'));
  await page.fill('#ocHeadcountFilterQuick', '');
  await page.waitForTimeout(150);

  // 6d) Không dấu + không phân biệt hoa/thường (giống deptKw/posKw) -> vẫn khớp "Kế Toán Viên".
  await page.fill('#ocHeadcountFilterQuick', 'ke toan');
  await page.waitForTimeout(200);
  filteredText = await page.textContent('#orgChartHeadcountTableBody');
  check('Tìm Kiếm Nhanh không dấu/không hoa-thường "ke toan" -> vẫn khớp "Kế Toán Viên"', filteredText.includes('Kế Toán Viên'));
  await page.fill('#ocHeadcountFilterQuick', '');
  await page.waitForTimeout(150);

  // 6e) Không khớp gì -> cùng thông báo rõ ràng như 2 ô cũ.
  await page.fill('#ocHeadcountFilterQuick', 'Không Tồn Tại Gì Cả');
  await page.waitForTimeout(200);
  filteredText = await page.textContent('#orgChartHeadcountTableBody');
  check('Tìm Kiếm Nhanh không khớp gì -> hiện thông báo rõ ràng "Không có vị trí nào khớp"', filteredText.includes('Không có vị trí nào khớp'));
  await page.fill('#ocHeadcountFilterQuick', '');
  await page.waitForTimeout(150);

  check('Không có lỗi JS (pageerror) nào trong suốt quá trình thao tác THẬT', pageErrors.length === 0, pageErrors.join('\n'));

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  server.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => { console.error('FAIL (uncaught):', err); process.exit(1); });
