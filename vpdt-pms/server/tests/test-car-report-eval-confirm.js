// server/tests/test-car-report-eval-confirm.js
//
// Regression cho phần MỚI thêm v23.4 trong tab "📊 Báo Cáo" của module Đăng Ký Xe (yêu cầu người dùng:
// "báo cáo ai đánh giá lái xe nào, ở phiếu nào, thông tin ra sao; lái xe xác nhận chuyến ở phiếu nào,
// thời gian nào; biểu đồ đăng ký xe theo tháng/tuần/quý/năm, lựa chọn filter"):
//   1. Bảng "Lịch Sử Đánh Giá Chuyến" (#carReportEvalBody) — nguồn evaluatedBy/evaluatedByName/
//      evaluatedAt/actualKm/evaluationComment (đã có sẵn từ evaluateCarTrip(), CHỈ MỚI có màn hiển thị).
//   2. Bảng "Lịch Sử Xác Nhận Của Lái Xe" (#carReportConfirmBody) — nguồn driverConfirmedAt/tripEndedAt/
//      driverReportedKm.
//   3. Bảng số liệu xu hướng (#carReportTrendChart, TRƯỚC ĐÂY là biểu đồ SVG — đổi sang bảng thuần văn
//      bản đợt 9/2026 vì SVG bị vỡ hình trên máy người dùng thật) đổi đúng theo kỳ chọn qua pill filter
//      (setCarReportGranularity()/groupCarRegsByPeriod()) — đối chứng cả 5 kỳ Ngày/Tuần/Tháng/Quý/Năm.
//
// Dựng lại đúng khuôn tests/test-car-report-week-month.js (static server phục vụ public/ + Chromium
// thật, logic thuần client-side, không cần route server nào).
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

    // Neo mốc ngày CỐ ĐỊNH (không phụ thuộc "hôm nay") để test tuần/quý/năm ổn định lâu dài — 4 mốc
    // rải trong năm 2025, đều rơi vào các tuần/quý/tháng khác nhau.
    Object.assign(DB, {
      depts: ['Phòng Kinh Doanh'], stores: [], cats: [], deptAbbrs: {}, docCatAbbrs: {}, contractTypeAbbrs: {},
      jobTitles: [], storeJobTitles: [], submissionTypes: [], contractTypes: [], carTypes: ['Xe 4 chỗ'],
      carPurposes: ['Công tác'], carVehicleTypes: [], carTaxiCompanies: [],
      uniformCatalog: [], itTicketCategories: [], workflows: [], quickApplyConfigs: [], deptWorkflows: {},
      docs: [], submissions: [], submissionApprovalGroups: {}, submissionTypeDeptWorkflows: {}, submissionDeptWorkflows: {},
      contracts: [], contractApprovalGroups: {}, contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
      meetings: [], meetingRooms: [], meetingMinutes: [], meetingAttendeeTemplates: [],
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
        { id: 2, username: 'lx1', name: 'Lái Xe Một', dept: 'Phòng Hành Chính', jobTitle: 'Lái xe', email: 'lx1@test.local', phone: '0900000001', perms: {}, active: true, isDriver: true, groupIds: [], permOverrides: null }
      ],
      carRegs: [
        // Quý 1/2025 (tháng 1), tuần đầu năm — ĐÃ đánh giá + ĐÃ xác nhận đầy đủ.
        {
          id: 9101, code: 'HCRC-CAR-E1', dept: 'Phòng Kinh Doanh', type: 'Xe 4 chỗ', passengers: '02',
          directUser: 'NV A', directUserPhone: '', purpose: 'Công tác', km: 80,
          startTime: '2025-01-06T08:00', endTime: '2025-01-06T10:00', routePoints: ['A', 'B'], destination: 'A → B',
          reason: 'Test', customData: {}, createdAt: '', status: 'COMPLETED', currentStep: 1, history: [],
          assignedDriver: 'Lái Xe Một', assignedDriverUsername: 'lx1', assignedVehicleType: 'Xe 4 chỗ', assignedPlate: '30A-111.11', assignedTaxiCompany: '',
          creator: 'nv1', creatorName: 'Nhân Viên Một',
          driverConfirmed: true, driverConfirmedAt: '2025-01-06 07:50', tripEndedAt: '2025-01-06 10:05', driverReportedKm: 82,
          evaluatedBy: 'nv1', evaluatedByName: 'Nhân Viên Một', evaluatedAt: '2025-01-06 10:30', evaluationComment: 'Lái xe đúng giờ, phục vụ tốt', actualKm: 82
        },
        // Quý 2/2025 (tháng 5) — chỉ xác nhận nhận chuyến, CHƯA kết thúc/CHƯA đánh giá.
        {
          id: 9102, code: 'HCRC-CAR-E2', dept: 'Phòng Kinh Doanh', type: 'Xe 4 chỗ', passengers: '01',
          directUser: 'NV B', directUserPhone: '', purpose: 'Công tác', km: 40,
          startTime: '2025-05-14T09:00', endTime: '2025-05-14T11:00', routePoints: ['C', 'D'], destination: 'C → D',
          reason: 'Test', customData: {}, createdAt: '', status: 'APPROVED', currentStep: 1, history: [],
          assignedDriver: 'Lái Xe Một', assignedDriverUsername: 'lx1', assignedVehicleType: 'Xe 4 chỗ', assignedPlate: '30A-111.11', assignedTaxiCompany: '',
          creator: 'nv2', creatorName: 'Nhân Viên Hai',
          driverConfirmed: true, driverConfirmedAt: '2025-05-14 08:55'
        },
        // Năm 2024 (khác năm) — để đối chứng nhóm theo Năm tách bạch với 2025.
        {
          id: 9103, code: 'HCRC-CAR-E3', dept: 'Phòng Kinh Doanh', type: 'Xe 4 chỗ', passengers: '03',
          directUser: 'NV C', directUserPhone: '', purpose: 'Công tác', km: 20,
          startTime: '2024-11-03T08:00', endTime: '2024-11-03T09:00', routePoints: ['E', 'F'], destination: 'E → F',
          reason: 'Test', customData: {}, createdAt: '', status: 'APPROVED', currentStep: 1, history: [],
          assignedDriver: '', assignedDriverUsername: '', assignedVehicleType: '', assignedPlate: '', assignedTaxiCompany: '',
          creator: 'nv3', creatorName: 'Nhân Viên Ba'
        }
      ]
    });

    finishLogin(DB.users[0]);
  });

  await page.evaluate(() => switchTab('car'));
  await page.waitForTimeout(250);

  const ready = await page.evaluate(() => typeof renderCarReportTab === 'function' && typeof setCarReportGranularity === 'function' && typeof groupCarRegsByPeriod === 'function');
  record('setup: module-dangkyxe.js đã nạp xong, các hàm cần test đã sẵn sàng', ready);
  if (!ready) { record('DỪNG SỚM — không thể tiếp tục vì hàm chưa nạp được', false, JSON.stringify(pageErrors)); await browser.close(); server.close(); return finish(); }

  await page.evaluate(() => document.getElementById('btnCarSubReport').click());
  await page.waitForTimeout(100);

  // ===== 1. Bảng "Lịch Sử Đánh Giá Chuyến" =====
  const evalHTML = await page.evaluate(() => document.getElementById('carReportEvalBody').innerHTML);
  record('Đánh Giá Chuyến: bảng hiện đúng mã phiếu đã được đánh giá (E1)', evalHTML.includes('HCRC-CAR-E1'));
  record('Đánh Giá Chuyến: hiện đúng tên lái xe được đánh giá', evalHTML.includes('Lái Xe Một'));
  record('Đánh Giá Chuyến: hiện đúng tên người đánh giá', evalHTML.includes('Nhân Viên Một'));
  record('Đánh Giá Chuyến: hiện đúng thời điểm đánh giá', evalHTML.includes('2025-01-06 10:30'));
  record('Đánh Giá Chuyến: hiện đúng số km thực tế (actualKm)', evalHTML.includes('82'));
  record('Đánh Giá Chuyến: hiện đúng nhận xét', evalHTML.includes('Lái xe đúng giờ, phục vụ tốt'));
  record('Đánh Giá Chuyến: phiếu CHƯA đánh giá (E2/E3) KHÔNG xuất hiện trong bảng', !evalHTML.includes('HCRC-CAR-E2') && !evalHTML.includes('HCRC-CAR-E3'));

  // ===== 2. Bảng "Lịch Sử Xác Nhận Của Lái Xe" =====
  const confirmHTML = await page.evaluate(() => document.getElementById('carReportConfirmBody').innerHTML);
  record('Xác Nhận Lái Xe: bảng hiện đúng 2 phiếu đã xác nhận (E1 đã kết thúc, E2 chưa)', confirmHTML.includes('HCRC-CAR-E1') && confirmHTML.includes('HCRC-CAR-E2'));
  record('Xác Nhận Lái Xe: phiếu E1 hiện đúng thời điểm kết thúc chuyến + km báo cáo', confirmHTML.includes('2025-01-06 10:05') && confirmHTML.includes('82'));
  record('Xác Nhận Lái Xe: phiếu E2 (chưa kết thúc) hiện nhãn "Chưa kết thúc" thay vì thời gian', /HCRC-CAR-E2[\s\S]*?Chưa kết thúc/.test(confirmHTML));
  record('Xác Nhận Lái Xe: phiếu CHƯA xác nhận (E3) KHÔNG xuất hiện trong bảng', !confirmHTML.includes('HCRC-CAR-E3'));

  // ===== 3. Biểu đồ xu hướng — đổi đúng theo 5 kỳ lọc =====
  // Mở rộng khoảng lọc để bao trọn cả 3 phiếu (mặc định carReportFromDate/ToDate trống = không lọc).
  const defaultGran = await page.evaluate(() => carReportGranularity);
  record('Biểu đồ: mặc định ở kỳ "Tháng"', defaultGran === 'MONTH');

  for (const [g, expectSubstrings] of [
    ['DAY', ['06/1']],
    ['WEEK', ['Tuần']],
    ['MONTH', ['Tháng 1/2025', 'Tháng 5/2025']],
    ['QUARTER', ['Quý 1/2025', 'Quý 2/2025']],
    ['YEAR', ['Năm 2024', 'Năm 2025']]
  ]) {
    const state = await page.evaluate((gran) => {
      setCarReportGranularity(gran);
      return { gran: carReportGranularity, trendHTML: document.getElementById('carReportTrendChart').innerHTML, pillsHTML: document.getElementById('carReportTrendPills').innerHTML };
    }, g);
    const allFound = expectSubstrings.every(s => state.trendHTML.includes(s));
    record(`Biểu đồ: chọn kỳ "${g}" -> bảng số liệu hiện đúng nhãn kỳ (${expectSubstrings.join(', ')})`, state.gran === g && allFound, state.trendHTML);
    const activePillOk = new RegExp(`data-arg0="${g}"[^>]*bg-indigo-700`).test(state.pillsHTML);
    record(`Biểu đồ: pill "${g}" được đánh dấu đang chọn (bg-indigo-700)`, activePillOk, state.pillsHTML);
  }

  // Quý: phiếu tháng 1 (Q1) và tháng 5 (Q2) của 2025 phải RIÊNG cột — đối chứng groupCarRegsByPeriod
  // không gộp nhầm 2 quý khác nhau trong cùng năm.
  const quarterBuckets = await page.evaluate(() => groupCarRegsByPeriod(DB.carRegs.filter(c => c.status !== 'PENDING' && c.status !== 'REJECTED'), 'QUARTER').map(b => b.key));
  record('groupCarRegsByPeriod: 3 phiếu (2 quý 2025 khác nhau + 1 năm 2024) tạo đúng 3 bucket riêng biệt', quarterBuckets.length === 3 && new Set(quarterBuckets).size === 3, JSON.stringify(quarterBuckets));

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
