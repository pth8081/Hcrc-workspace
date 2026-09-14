// server/tests/test-car-report-week-month.js
//
// Regression cho 2 việc mới thêm trong module Đăng Ký Xe (yêu cầu người dùng kèm 2 ảnh chụp phiếu duyệt
// + Lịch Xe):
//   1. Sub-tab MỚI "📊 Báo Cáo" (renderCarReportTab()/canSeeCarReportClient(), module-dangkyxe.js +
//      core.js) — chỉ người quản lý (admin/carView.all/người duyệt ở carDeptWorkflows) mới thấy nút,
//      nội dung tổng hợp đúng số phiếu/KM theo phòng ban + lái xe + xu hướng tháng.
//   2. "Lịch Xe" nâng từ chỉ-xem-theo-ngày lên 3 chế độ Ngày/Tuần/Tháng (setCarCalViewMode()/
//      renderCarScheduleCalendarWeekView()/renderCarScheduleCalendarMonthView(), module-dangkyxe.js) —
//      cùng khuôn Lịch Họp (module-phonghop.js).
//   3. (Nhân tiện đối chứng phần "nhãn hành động cấu hình được" — Task lớn cùng đợt) nút Phê Duyệt trong
//      modal xử lý phiếu xe đổi đúng theo actionLabel cấu hình ở bước hiện tại.
//
// Dựng lại đúng khuôn tests/test-quick-apply-workflow-steps.js (static server phục vụ public/ + Chromium
// thật, logic thuần client-side, không cần route server nào) — đăng nhập giả lập rồi điều hướng THẬT
// (click) vào tab Đăng Ký Xe.
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
    window.fetch = async () => ({ ok: true, status: 200, json: async () => ([]) });

    const todayStr = new Date().toISOString().slice(0, 10);

    Object.assign(DB, {
      depts: ['Phòng Kinh Doanh', 'Phòng Kỹ Thuật'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], submissionTypes: [], contractTypes: [], carTypes: ['Xe 4 chỗ', 'Xe 7 chỗ'],
      carPurposes: ['Công tác'], carVehicleTypes: [], carTaxiCompanies: [],
      uniformCatalog: [], itTicketCategories: [],
      // Bước 1 của WF_2STEP cấu hình actionLabel="Xác Nhận" — đối chứng nút bấm trong modal xử lý phiếu
      // xe đổi đúng theo cấu hình (Task "nhãn hành động cấu hình được cho từng bước ký").
      workflows: [
        { id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Trưởng Phòng', actionLabel: null }] },
        { id: 'WF_2STEP', name: 'Quy trình 2 bước', steps: [
          { order: 1, name: 'Điều Hành Xe', actionLabel: 'Xác Nhận' },
          { order: 2, name: 'Trưởng Phòng', actionLabel: null }
        ] }
      ],
      quickApplyConfigs: [], deptWorkflows: {},
      docs: [], submissions: [], submissionApprovalGroups: {}, submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {},
      contracts: [], contractApprovalGroups: {}, contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
      meetings: [], meetingRooms: [], meetingMinutes: [], meetingAttendeeTemplates: [],
      carDeptWorkflows: {
        'Phòng Kinh Doanh': { workflowId: 'WF_2STEP', approvers: { 1: ['qlxe1'], 2: ['tp_kd'] } },
        'Phòng Kỹ Thuật': { workflowId: 'WF_1STEP', approvers: { 1: ['tp_kt'] } }
      },
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
      _versions: {},
      users: [
        { id: 1, username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng Kinh Doanh', jobTitle: 'Admin', email: 'a@test.local', phone: '0900000000', perms: { admin: true }, active: true, isDriver: false, groupIds: [], permOverrides: null },
        { id: 2, username: 'lx1', name: 'Lái Xe Một', dept: 'Phòng Hành Chính', jobTitle: 'Lái xe', email: 'lx1@test.local', phone: '0900000001', perms: {}, active: true, isDriver: true, groupIds: [], permOverrides: null },
        { id: 3, username: 'lx2', name: 'Lái Xe Hai', dept: 'Phòng Hành Chính', jobTitle: 'Lái xe', email: 'lx2@test.local', phone: '0900000002', perms: {}, active: true, isDriver: true, groupIds: [], permOverrides: null }
      ],
      carRegs: [
        {
          id: 9001, code: 'HCRC-CAR-R1', dept: 'Phòng Kinh Doanh', type: 'Xe 4 chỗ', passengers: '02',
          directUser: 'NV A', directUserPhone: '', purpose: 'Công tác', km: 100,
          startTime: `${todayStr}T08:00`, endTime: `${todayStr}T10:00`, routePoints: ['A', 'B'], destination: 'A → B',
          reason: 'Test', customData: {}, createdAt: '', status: 'APPROVED', currentStep: 1, history: [],
          assignedDriver: 'Lái Xe Một', assignedDriverUsername: 'lx1', assignedVehicleType: 'Xe 4 chỗ', assignedPlate: '30A-111.11', assignedTaxiCompany: '', creator: 'nv1', creatorName: 'Nhân Viên Một'
        },
        {
          id: 9002, code: 'HCRC-CAR-R2', dept: 'Phòng Kỹ Thuật', type: 'Xe 7 chỗ', passengers: '04',
          directUser: 'NV B', directUserPhone: '', purpose: 'Công tác', km: 50,
          startTime: `${todayStr}T14:00`, endTime: `${todayStr}T16:00`, routePoints: ['C', 'D'], destination: 'C → D',
          reason: 'Test', customData: {}, createdAt: '', status: 'APPROVED', currentStep: 1, history: [],
          assignedDriver: 'Lái Xe Hai', assignedDriverUsername: 'lx2', assignedVehicleType: 'Xe 7 chỗ', assignedPlate: '30A-222.22', assignedTaxiCompany: '', creator: 'nv2', creatorName: 'Nhân Viên Hai'
        },
        // Phiếu ĐANG CHỜ DUYỆT ở bước 1 (Điều Hành Xe, actionLabel="Xác Nhận") của Phòng Kinh Doanh —
        // dùng để kiểm nút trong modal xử lý (openCarProcessModal()) đổi đúng nhãn "Xác Nhận".
        {
          id: 9003, code: 'HCRC-CAR-R3', dept: 'Phòng Kinh Doanh', type: 'Xe 4 chỗ', passengers: '01',
          directUser: 'NV C', directUserPhone: '', purpose: 'Công tác', km: 30,
          startTime: `${todayStr}T09:00`, endTime: `${todayStr}T11:00`, routePoints: ['E', 'F'], destination: 'E → F',
          reason: 'Test pending', customData: {}, createdAt: '', status: 'PENDING', currentStep: 1, history: [],
          assignedDriver: '', assignedDriverUsername: '', assignedVehicleType: '', assignedPlate: '', assignedTaxiCompany: '', creator: 'nv3', creatorName: 'Nhân Viên Ba'
        }
      ]
    });

    const adminUser = DB.users[0];
    finishLogin(adminUser);
  });

  // Điều hướng THẬT vào tab Đăng Ký Xe (trigger loadModuleGroup() nạp module-dangkyxe.js) — gọi thẳng
  // switchTab() thay vì click nút sidebar (nút #btnCarTab nằm trong dropdown "Hành Chính" ẩn mặc định).
  await page.evaluate(() => switchTab('car'));
  await page.waitForTimeout(250);

  const ready = await page.evaluate(() => typeof renderCarReportTab === 'function' && typeof setCarCalViewMode === 'function' && typeof canSeeCarReportClient === 'function');
  record('setup: module-dangkyxe.js đã nạp xong qua điều hướng thật, các hàm cần test đã sẵn sàng', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục vì hàm chưa nạp được', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  // ===== 1. Sub-tab "📊 Báo Cáo" — admin thấy nút, nội dung tổng hợp đúng =====
  const btnReportVisibleAdmin = await page.evaluate(() => !document.getElementById('btnCarSubReport').classList.contains('hidden'));
  record('Báo Cáo: admin thấy nút "📊 Báo Cáo"', btnReportVisibleAdmin);

  await page.evaluate(() => document.getElementById('btnCarSubReport').click());
  await page.waitForTimeout(100);
  const reportState = await page.evaluate(() => ({
    tabVisible: !document.getElementById('carSubReport').classList.contains('hidden'),
    summaryHTML: document.getElementById('carReportSummaryCards').innerHTML,
    deptBarsHTML: document.getElementById('carReportDeptBars').innerHTML,
    driverBarsHTML: document.getElementById('carReportDriverBars').innerHTML
  }));
  record('Báo Cáo: chuyển sang tab #carSubReport thành công', reportState.tabVisible);
  record('Báo Cáo: thẻ tổng hợp hiện "Tổng Số Phiếu" = 3 (2 APPROVED + 1 PENDING)', /Tổng Số Phiếu[\s\S]*?>3</.test(reportState.summaryHTML.replace(/\s+/g, ' ')) || reportState.summaryHTML.includes('>3<'));
  record('Báo Cáo: thẻ "Đã Duyệt" = 2', reportState.summaryHTML.includes('>2<'));
  record('Báo Cáo: mức sử dụng theo Phòng Ban hiện "Phòng Kinh Doanh" và "Phòng Kỹ Thuật"', reportState.deptBarsHTML.includes('Phòng Kinh Doanh') && reportState.deptBarsHTML.includes('Phòng Kỹ Thuật'));
  record('Báo Cáo: mức sử dụng theo Lái Xe hiện "Lái Xe Một" và "Lái Xe Hai" kèm số km', reportState.driverBarsHTML.includes('Lái Xe Một') && reportState.driverBarsHTML.includes('100 km') && reportState.driverBarsHTML.includes('Lái Xe Hai') && reportState.driverBarsHTML.includes('50 km'));

  // Người KHÔNG có quyền quản lý (không admin, không carView.all, không phải approver ở BẤT KỲ phòng
  // nào) -> nút "📊 Báo Cáo" phải ẨN, và cố tình gọi setCarSubTab('REPORT') phải tự lùi về REG.
  const nonManagerState = await page.evaluate(() => {
    const u = { id: 9, username: 'nv_thuong', name: 'Nhân Viên Thường', dept: 'Phòng Kinh Doanh', jobTitle: 'NV', email: 'x@test.local', phone: '090', perms: {}, active: true, isDriver: false, groupIds: [], permOverrides: null };
    DB.users.push(u);
    finishLogin(u);
    setCarSubTab('REPORT');
    return {
      btnHidden: document.getElementById('btnCarSubReport').classList.contains('hidden'),
      landedOnReg: !document.getElementById('carSubReg').classList.contains('hidden'),
      reportStillHidden: document.getElementById('carSubReport').classList.contains('hidden')
    };
  });
  record('Báo Cáo: nhân viên thường (không quyền quản lý) KHÔNG thấy nút "📊 Báo Cáo"', nonManagerState.btnHidden);
  record('Báo Cáo: setCarSubTab("REPORT") bị chặn cho nhân viên thường -> tự lùi về tab Đăng Ký', nonManagerState.landedOnReg && nonManagerState.reportStillHidden);

  // Đăng nhập lại admin để tiếp tục các phần sau.
  await page.evaluate(() => finishLogin(DB.users[0]));
  await page.evaluate(() => document.getElementById('btnCarSubCalendar').click());
  await page.waitForTimeout(100);

  // ===== 2. Lịch Xe — 3 chế độ Ngày/Tuần/Tháng =====
  const dayViewState = await page.evaluate(() => ({
    dayGridVisible: !document.getElementById('carCalendarGrid').classList.contains('hidden'),
    weekGridHidden: document.getElementById('carCalendarWeekGrid').classList.contains('hidden'),
    monthGridHidden: document.getElementById('carCalendarMonthGrid').classList.contains('hidden')
  }));
  record('Lịch Xe: mặc định ở chế độ Ngày (grid giờ hiện, Tuần/Tháng ẩn)', dayViewState.dayGridVisible && dayViewState.weekGridHidden && dayViewState.monthGridHidden);

  await page.evaluate(() => document.getElementById('btnCarCalViewWEEK').click());
  await page.waitForTimeout(100);
  const weekViewState = await page.evaluate(() => ({
    dayGridHidden: document.getElementById('carCalendarGrid').classList.contains('hidden'),
    weekGridVisible: !document.getElementById('carCalendarWeekGrid').classList.contains('hidden'),
    weekHTML: document.getElementById('carCalendarWeekGrid').innerHTML
  }));
  record('Lịch Xe: bấm "🗓️ Tuần" -> chuyển đúng grid (Ngày ẩn, Tuần hiện)', weekViewState.dayGridHidden && weekViewState.weekGridVisible);
  record('Lịch Xe (Tuần): hiện đủ 7 ô ngày kèm tên lái xe', (weekViewState.weekHTML.match(/data-op="jumpCarCalToDay"/g) || []).length === 7 && weekViewState.weekHTML.includes('Lái Xe Một'));
  // Hôm nay có 2 chuyến APPROVED của 2 lái xe khác nhau -> đúng 2 ô "X chuyến" (không phải "Trống") trong tuần.
  record('Lịch Xe (Tuần): ô "hôm nay" hiện đúng số chuyến (không phải Trống) cho cả 2 lái xe', (weekViewState.weekHTML.match(/1 chuyến/g) || []).length >= 2);

  await page.evaluate(() => document.getElementById('btnCarCalViewMONTH').click());
  await page.waitForTimeout(100);
  const monthViewState = await page.evaluate(() => ({
    monthGridVisible: !document.getElementById('carCalendarMonthGrid').classList.contains('hidden'),
    monthHTML: document.getElementById('carCalendarMonthGrid').innerHTML
  }));
  record('Lịch Xe: bấm "📆 Tháng" -> chuyển đúng grid (42 ô ngày cố định)', monthViewState.monthGridVisible && (monthViewState.monthHTML.match(/data-op="jumpCarCalToDay"/g) || []).length === 42);
  // "hôm nay" có 3 phiếu đang chiếm chỗ (2 APPROVED id 9001/9002 + 1 PENDING id 9003 — PENDING cũng
  // tính "đang bận" đúng quy ước isCarRegOccupying(), khớp ô đỏ ở chế độ Ngày).
  record('Lịch Xe (Tháng): ô "hôm nay" hiện "3 chuyến" (2 APPROVED + 1 PENDING, cùng quy ước "đang bận")', monthViewState.monthHTML.includes('3 chuyến'));

  // Bấm vào 1 ô ngày ở chế độ Tháng -> nhảy về chế độ Ngày đúng ngày đó.
  const todayStrClient = await page.evaluate(() => new Date().toISOString().slice(0, 10));
  await page.evaluate((d) => document.querySelector(`[data-op="jumpCarCalToDay"][data-arg0="${d}"]`)?.click(), todayStrClient);
  await page.waitForTimeout(100);
  const jumpedState = await page.evaluate(() => ({
    viewMode: carCalViewMode,
    dateVal: document.getElementById('carCalDate').value,
    dayGridVisible: !document.getElementById('carCalendarGrid').classList.contains('hidden')
  }));
  record('Lịch Xe: bấm 1 ô ngày ở chế độ Tháng -> nhảy về chế độ Ngày ĐÚNG ngày đó', jumpedState.viewMode === 'DAY' && jumpedState.dateVal === todayStrClient && jumpedState.dayGridVisible);

  // ===== 3. Đối chứng nhãn hành động cấu hình được — nút trong modal xử lý phiếu xe PENDING (bước 1
  // Phòng Kinh Doanh = "Điều Hành Xe", actionLabel="Xác Nhận") phải hiện "✅ Xác Nhận & Chuyển Bước" =====
  await page.evaluate(() => {
    currentUser.username = 'qlxe1'; // người duyệt bước 1 của Phòng Kinh Doanh (carDeptWorkflows)
    document.getElementById('btnCarSubReg').click();
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => openCarProcessModal(9003));
  await page.waitForTimeout(100);
  const modalBtnHTML = await page.evaluate(() => document.getElementById('carProcessModalBody')?.innerHTML || document.getElementById('carProcessModal')?.innerHTML || '');
  record('Nhãn hành động: nút Phê Duyệt trong modal đổi đúng theo cấu hình bước ("✅ Xác Nhận & Chuyển Bước")', modalBtnHTML.includes('Xác Nhận'));

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
