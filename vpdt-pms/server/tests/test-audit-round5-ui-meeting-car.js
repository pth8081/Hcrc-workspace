// server/tests/test-audit-round5-ui-meeting-car.js
//
// Đợt rà soát chuyên sâu 10/2026 — phần GIAO DIỆN của 4 phát hiện cụm "Phòng Họp / Đăng Ký Xe". Dựng
// theo đúng khuôn tests/test-car-report-week-month.js (static server phục vụ public/ + Chromium thật,
// mock window.fetch cho đúng route cần, không cần server nghiệp vụ thật):
//
//   2.  [Cao] Lưới "Lịch Họp" + kiểm tra trùng giờ đọc thẳng DB.meetings (ĐÃ bị lọc theo phạm vi xem)
//       -> hiện "Trống" giả ở khung giờ phòng ban KHÁC đã đặt. Nay đọc thêm GET /api/meetings/busy-slots
//       (chỉ room/giờ/trạng thái, KHÔNG có tiêu đề/người đặt).
//   4.  [Cao] Phiếu đi Taxi không có tài xế hệ thống -> phải có lối "Kết Thúc Chuyến" cho người đăng ký/
//       Người Điều Hành Xe ngay trên dòng danh sách (trước đây chỉ sub-tab "Lái Xe" mới có nút này).
//   10. [Thấp] Tab Báo Cáo Đăng Ký Xe phải nói rõ số liệu theo PHẠM VI của người xem.
//   11. [Thấp] Báo cáo cộng KM THỰC TẾ (actualKm) thay vì KM dự kiến (km).
//
// Chạy: node server/tests/test-audit-round5-ui-meeting-car.js
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
  const PORT = 9300 + Math.floor(Math.random() * 400);
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

    // Mock fetch: CHỈ route mới /api/meetings/busy-slots trả dữ liệu thật (mirror hình dạng response ở
    // routes/meetingActions.js: { ok, items:[{id,room,startTime,endTime,status}] }), các route khác trả
    // mảng rỗng. window.__busySlotCalls đếm số lần client gọi route này.
    window.__busySlots = [];
    window.__busySlotCalls = 0;
    window.fetch = async (url) => {
      const u = String(url);
      if (u.includes('/api/meetings/busy-slots')) {
        window.__busySlotCalls++;
        return { ok: true, status: 200, json: async () => ({ ok: true, items: window.__busySlots }) };
      }
      return { ok: true, status: 200, json: async () => ([]) };
    };

    const todayStr = new Date().toISOString().slice(0, 10);

    Object.assign(DB, {
      depts: ['Phòng Kinh Doanh', 'Phòng Kỹ Thuật'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], submissionTypes: [], contractTypes: [], carTypes: ['Xe 4 chỗ', 'Xe 7 chỗ'],
      carPurposes: ['Công tác'],
      carVehicleTypes: [
        { id: 1, name: 'Xe 4 chỗ', bienSo: '30A-111.11', isTaxi: false },
        { id: 2, name: 'Xe Taxi', bienSo: '', isTaxi: true }
      ],
      carTaxiCompanies: ['Mai Linh'],
      uniformCatalog: [], itTicketCategories: [],
      workflows: [{ id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Trưởng Phòng', actionLabel: null }] }],
      quickApplyConfigs: [], deptWorkflows: {},
      docs: [], submissions: [], submissionApprovalGroups: [], submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {},
      contracts: [], contractApprovalGroups: [], contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
      meetings: [], meetingMinutes: [], meetingAttendeeTemplates: [],
      meetingRooms: [
        { id: 1, name: 'Phòng Họp Lớn A', short: 'Phòng A' },
        { id: 2, name: 'Phòng Họp Nhỏ B', short: 'Phòng B' }
      ],
      carDeptWorkflows: { 'Phòng Kinh Doanh': { workflowId: 'WF_1STEP', approvers: { 1: ['tp_kd'] } } },
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
        // Nhân viên thường của Phòng Kinh Doanh: chỉ đặt phòng + xem lịch họp CỦA PHÒNG MÌNH
        // (meetingView hẹp) -> đúng đối tượng bị lỗi "phòng trống giả" của phát hiện #2.
        { id: 2, username: 'nv_kd', name: 'Nhân Viên KD', dept: 'Phòng Kinh Doanh', jobTitle: 'NV', email: 'nv@test.local', phone: '0900000002', perms: { meetingBookScope: { all: false, depts: ['Phòng Kinh Doanh'] }, meetingView: { all: false, depts: ['Phòng Kinh Doanh'] }, carCreate: { all: false, depts: ['Phòng Kinh Doanh'] }, carView: { all: false, depts: ['Phòng Kinh Doanh'] } }, active: true, isDriver: false, groupIds: [], permOverrides: null },
        { id: 3, username: 'lx1', name: 'Lái Xe Một', dept: 'Phòng Hành Chính', jobTitle: 'Lái xe', email: 'lx1@test.local', phone: '0900000003', perms: {}, active: true, isDriver: true, groupIds: [], permOverrides: null }
      ],
      carRegs: [
        // Chuyến ĐÃ HOÀN THÀNH: KM dự kiến 100 nhưng KM THỰC TẾ 250 -> báo cáo phải lấy 250 (phát hiện #11).
        {
          id: 9101, code: 'HCRC-CAR-A1', dept: 'Phòng Kinh Doanh', type: 'Xe 4 chỗ', passengers: '02',
          directUser: 'NV A', directUserPhone: '', purpose: 'Công tác', km: 100, actualKm: 250, driverReportedKm: 250,
          startTime: `${todayStr}T08:00`, endTime: `${todayStr}T10:00`, routePoints: ['A', 'B'], destination: 'A → B',
          reason: 'Test', customData: {}, createdAt: '', status: 'COMPLETED', currentStep: 1, history: [],
          assignedDriver: 'Lái Xe Một', assignedDriverUsername: 'lx1', assignedVehicleType: 'Xe 4 chỗ',
          assignedPlate: '30A-111.11', assignedTaxiCompany: '', creator: 'nv_kd', creatorName: 'Nhân Viên KD',
          evaluatedAt: '01/10/2026 10:00', evaluatedBy: 'nv_kd', evaluatedByName: 'Nhân Viên KD'
        },
        // Phiếu TAXI đã duyệt xong, KHÔNG có tài xế hệ thống -> phải có nút "Kết Thúc Chuyến (Taxi)".
        {
          id: 9102, code: 'HCRC-CAR-A2', dept: 'Phòng Kinh Doanh', type: 'Xe 4 chỗ', passengers: '01',
          directUser: 'NV B', directUserPhone: '', purpose: 'Công tác', km: 30,
          startTime: `${todayStr}T14:00`, endTime: `${todayStr}T16:00`, routePoints: ['C', 'D'], destination: 'C → D',
          reason: 'Test taxi', customData: {}, createdAt: '', status: 'APPROVED', currentStep: 1, history: [],
          assignedDriver: '', assignedDriverUsername: '', assignedVehicleType: 'Xe Taxi',
          assignedPlate: '', assignedTaxiCompany: 'Mai Linh', creator: 'nv_kd', creatorName: 'Nhân Viên KD'
        }
      ]
    });
  });

  // ===================== 2) Lịch Họp: phòng bận của ĐƠN VỊ KHÁC =====================
  await page.evaluate(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    // DB.meetings CHỈ có lịch phòng mình (đúng như GET /api/data đã lọc cho nv_kd) — lịch 09:00-10:00
    // của Phòng Kỹ Thuật ở "Phòng Họp Lớn A" chỉ xuất hiện trong busy-slots (không kèm tiêu đề).
    DB.meetings = [];
    window.__busySlots = [
      { id: 5001, room: 'Phòng Họp Lớn A', startTime: `${todayStr}T09:00`, endTime: `${todayStr}T10:00`, status: 'APPROVED' }
    ];
    finishLogin(DB.users.find(u => u.username === 'nv_kd'));
  });
  await page.evaluate(() => switchTab('meeting'));
  await page.waitForTimeout(400);

  const meetingReady = await page.evaluate(() => typeof renderMeetingCalendar === 'function' && typeof refreshMeetingBusySlots === 'function' && typeof getMeetingOccupancyList === 'function');
  record('setup: module-phonghop.js nạp xong + có hàm mới refreshMeetingBusySlots()/getMeetingOccupancyList()', meetingReady);
  if (!meetingReady) {
    record('DỪNG SỚM — hàm chưa sẵn sàng', false, JSON.stringify(pageErrors));
    await browser.close(); server.close(); return finish();
  }

  const calState = await page.evaluate(async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    setMeetingSubTab('CALENDAR');
    document.getElementById('meetingCalDate').value = todayStr;
    await refreshMeetingBusySlots(true);
    const grid = document.getElementById('meetingCalendarGrid');
    const roomIdx = DB.meetingRooms.findIndex(r => r.name === 'Phòng Họp Lớn A');
    // 09:00 là slot thứ 4 (07:00, 07:30, 08:00, 08:30, 09:00 -> index 4) trong generateMeetingTimeSlots().
    const cell0900 = grid.querySelector(`.meeting-cell[data-room-idx="${roomIdx}"][data-row-idx="4"]`);
    const cell1100 = grid.querySelector(`.meeting-cell[data-room-idx="${roomIdx}"][data-row-idx="8"]`);
    return {
      busyCalls: window.__busySlotCalls,
      busyCellClass: cell0900 ? cell0900.className : '',
      busyCellTitle: cell0900 ? cell0900.getAttribute('title') : '',
      busyCellBookingId: cell0900 ? cell0900.dataset.bookingId : '',
      freeCellClass: cell1100 ? cell1100.className : ''
    };
  });
  record('Mục 2: client gọi GET /api/meetings/busy-slots khi mở tab Lịch Họp', calState.busyCalls > 0, JSON.stringify(calState));
  record('Mục 2 — LỖI ĐÃ VÁ: khung giờ phòng ban KHÁC đã đặt hiện ĐỎ (bận), không còn "trống giả"',
    calState.busyCellClass.includes('bg-red-500') && calState.busyCellBookingId === '5001', JSON.stringify(calState));
  record('Mục 2: ô bận của đơn vị khác KHÔNG lộ tiêu đề cuộc họp (chỉ nhãn trung tính)',
    /đang bận/.test(calState.busyCellTitle) && !/Họp/.test(calState.busyCellTitle.replace('Phòng đang bận (lịch của đơn vị khác)', '')), calState.busyCellTitle);
  record('Mục 2: khung giờ thật sự trống vẫn hiện trắng như cũ', calState.freeCellClass.includes('bg-white'), calState.freeCellClass);

  // Bấm vào ô bận của đơn vị khác -> chỉ báo "đang bận", không hiện chi tiết.
  const slotInfo = await page.evaluate(() => {
    window.__alerts = [];
    showMeetingSlotInfo(5001);
    return window.__alerts.slice();
  });
  record('Mục 2: bấm ô bận của đơn vị khác chỉ báo "đang có lịch", không hiện nội dung cuộc họp',
    slotInfo.length === 1 && /đang có lịch/.test(slotInfo[0]) && !/Người đặt/.test(slotInfo[0]), JSON.stringify(slotInfo));

  // Đăng ký đúng khung giờ đó -> client phải tự chặn bằng đúng dữ liệu busy-slots (trước đây lọt xuống
  // server rồi mới nhận 409 khó hiểu).
  const conflictAlerts = await page.evaluate(async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    window.__alerts = [];
    setMeetingSubTab('REGISTER');
    document.getElementById('meetingDept').value = 'Phòng Kinh Doanh';
    document.getElementById('meetingRoom').value = 'Phòng Họp Lớn A';
    document.getElementById('meetingTitle').value = 'Họp nội bộ KD';
    document.getElementById('meetingAttendees').value = '5';
    document.getElementById('meetingStartTime').value = `${todayStr}T09:15`;
    document.getElementById('meetingEndTime').value = `${todayStr}T09:45`;
    const form = document.querySelector('#meetingRegisterTabContent form');
    await submitMeetingReq({ preventDefault() {}, target: form });
    return window.__alerts.slice();
  });
  record('Mục 2 — LỖI ĐÃ VÁ: gửi đăng ký trùng giờ lịch của đơn vị khác bị chặn NGAY ở client, nêu rõ lý do',
    conflictAlerts.some(a => /đã có lịch trùng khung giờ/.test(a) && /đơn vị khác/.test(a)), JSON.stringify(conflictAlerts));

  // ===================== 4/10/11) Đăng Ký Xe =====================
  await page.evaluate(() => switchTab('car'));
  await page.waitForTimeout(400);
  const carReady = await page.evaluate(() => typeof renderCarReportTab === 'function' && typeof isTaxiCarRegClient === 'function' && typeof carRegReportKm === 'function');
  record('setup: module-dangkyxe.js nạp xong + có hàm mới isTaxiCarRegClient()/carRegReportKm()', carReady);
  if (!carReady) {
    record('DỪNG SỚM — hàm chưa sẵn sàng', false, JSON.stringify(pageErrors));
    await browser.close(); server.close(); return finish();
  }

  const taxiRow = await page.evaluate(() => {
    renderCarRegs();
    const html = document.getElementById('carTableBody').innerHTML;
    return {
      isTaxi: isTaxiCarRegClient(DB.carRegs.find(c => c.id === 9102)),
      hasEndTripOption: html.includes('Kết Thúc Chuyến (Taxi)'),
      hasEndTripOnNonTaxi: (html.match(/Kết Thúc Chuyến \(Taxi\)/g) || []).length === 1
    };
  });
  record('Mục 4: nhận diện đúng phiếu Taxi ở client (isTaxiCarRegClient)', taxiRow.isTaxi);
  record('Mục 4 — LỖI ĐÃ VÁ: người đăng ký thấy tuỳ chọn "🏁 Kết Thúc Chuyến (Taxi)" ngay trên dòng danh sách',
    taxiRow.hasEndTripOption, JSON.stringify(taxiRow));
  record('Mục 4: chỉ phiếu TAXI mới có tuỳ chọn đó (phiếu xe đội nhà không có)', taxiRow.hasEndTripOnNonTaxi, JSON.stringify(taxiRow));

  // Mục 11 + 10 — tab Báo Cáo. nv_kd chỉ có carView theo phòng -> phải hiện chú thích phạm vi; nhưng
  // nv_kd KHÔNG thấy tab Báo Cáo (chỉ người quản lý) nên kiểm bằng cách gọi thẳng renderCarReportTab()
  // giống tests/test-car-report-week-month.js, rồi so 2 vai: admin vs người có phạm vi hẹp.
  const reportScoped = await page.evaluate(() => {
    const scoped = {
      id: 4, username: 'ql_kd', name: 'Quản Lý KD', dept: 'Phòng Kinh Doanh', jobTitle: 'QL', email: 'ql@test.local', phone: '0900000004',
      perms: { carView: { all: false, depts: ['Phòng Kinh Doanh'] }, carApprove: { all: false, depts: ['Phòng Kinh Doanh'] } },
      active: true, isDriver: false, groupIds: [], permOverrides: null
    };
    DB.users.push(scoped);
    finishLogin(scoped);
    switchTab('car');
    setCarSubTab('REPORT');
    renderCarReportTab();
    const noteEl = document.getElementById('carReportScopeNote');
    return {
      noteHidden: noteEl.classList.contains('hidden'),
      noteText: noteEl.textContent,
      summaryHTML: document.getElementById('carReportSummaryCards').innerHTML.replace(/\s+/g, ' ')
    };
  });
  record('Mục 10 — LỖI ĐÃ VÁ: người xem theo phạm vi hẹp thấy chú thích "theo PHẠM VI XEM của bạn"',
    !reportScoped.noteHidden && /PHẠM VI XEM/.test(reportScoped.noteText), JSON.stringify(reportScoped.noteText));
  record('Mục 10: chú thích nêu đúng (các) phòng ban trong phạm vi', /Phòng Kinh Doanh/.test(reportScoped.noteText), reportScoped.noteText);
  // 2 phiếu trong phạm vi: chuyến đã hoàn thành (km dự kiến 100, THỰC TẾ 250) + chuyến taxi chưa kết
  // thúc (chưa có actualKm -> vẫn tính km dự kiến 30). Tổng ĐÚNG = 280; TRƯỚC khi vá là 130 (100+30).
  record('Mục 11 — LỖI ĐÃ VÁ: "Tổng Số KM" cộng KM THỰC TẾ (250+30=280), không phải KM dự kiến (100+30=130)',
    reportScoped.summaryHTML.includes('>280<') && !reportScoped.summaryHTML.includes('>130<'), reportScoped.summaryHTML);
  record('Mục 11: nhãn thẻ nói rõ đây là KM thực tế', /Tổng Số KM \(thực tế/.test(reportScoped.summaryHTML), reportScoped.summaryHTML);

  const reportAdmin = await page.evaluate(() => {
    finishLogin(DB.users.find(u => u.username === 'admin'));
    switchTab('car');
    setCarSubTab('REPORT');
    renderCarReportTab();
    return { noteHidden: document.getElementById('carReportScopeNote').classList.contains('hidden') };
  });
  record('Mục 10: admin (xem toàn công ty) KHÔNG bị hiện chú thích phạm vi', reportAdmin.noteHidden, JSON.stringify(reportAdmin));

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
