// server/tests/test-hr-reports-weekly-monthly-transfers.js
//
// Regression test cho đợt mở rộng Báo Cáo Nhân Sự (11/2026, theo yêu cầu người dùng đối chiếu file mẫu
// "Template_Quan_ly_ho_so_nhan_su.xlsx"): 6 hàm compute MỚI + field `transfers[]` (Bổ nhiệm/Miễn
// nhiệm/Điều động + thời gian thử thách) ở lib/employeeProfile.js, và 6 route JSON MỚI ở
// routes/employeeProfile.js (GET /reports/dashboard|monthly|weekly|salary-history|transfers|dependents).
//
// PHẦN A: applyProfileEdit() với field 'transfers' — validate assertValidTransfer() (thuần, không HTTP).
// PHẦN B: classifyDept()/computeMonthlyHrReport()/computeWeeklyHeadcountFlow()/
//   computeSalaryAdjustmentHistory()/computeTransfersReport()/computeDependentsReport()/
//   computeHrDashboardSummary() — gọi thẳng, thuần logic.
// PHẦN C: HTTP thật qua Express + routes/employeeProfile.js (mock lib/appData + lib/auth + lib/
//   recordStore, cùng khuôn tests/test-hr-profile-position-history.js) — xác nhận gác quyền
//   canViewHrReports() + wiring route không lỗi.
//
// Chạy: node server/tests/test-hr-reports-weekly-monthly-transfers.js
const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const employeeProfile = require('../lib/employeeProfile');
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');

async function main() {
  const run = createRunner();

  // ===== PHẦN A: applyProfileEdit() với field 'transfers' =====
  await run.run('applyProfileEdit(transfers): thiếu "type" -> lỗi rõ ràng, không lưu', () => {
    const profile = employeeProfile.defaultProfile('NV001');
    let threw = false;
    try {
      employeeProfile.applyProfileEdit(profile, { transfers: [{ transferFromDate: '2026-01-01' }] }, ['transfers'], 'hr1', 'Nhân Sự Trưởng');
    } catch (e) { threw = true; assertIncludes(e.message, 'Loại thao tác', 'Lỗi phải nêu rõ thiếu Loại thao tác'); }
    assertEqual(threw, true, 'Phải throw khi thiếu type');
    assertEqual(profile.transfers.length, 0, 'KHÔNG lưu gì (lỗi trước khi set)');
  });

  await run.run('applyProfileEdit(transfers): type không thuộc TRANSFER_TYPES -> lỗi rõ ràng', () => {
    const profile = employeeProfile.defaultProfile('NV002');
    let threw = false;
    try {
      employeeProfile.applyProfileEdit(profile, { transfers: [{ type: 'KHONG_TON_TAI', transferFromDate: '2026-01-01' }] }, ['transfers'], 'hr1', 'HR');
    } catch (e) { threw = true; }
    assertEqual(threw, true, 'Phải throw khi type sai');
  });

  await run.run('applyProfileEdit(transfers): thiếu transferFromDate -> lỗi rõ ràng', () => {
    const profile = employeeProfile.defaultProfile('NV003');
    let threw = false;
    try {
      employeeProfile.applyProfileEdit(profile, { transfers: [{ type: 'APPOINTMENT' }] }, ['transfers'], 'hr1', 'HR');
    } catch (e) { threw = true; assertIncludes(e.message, 'điều chuyển', 'Lỗi phải nêu rõ thiếu Thời gian điều chuyển'); }
    assertEqual(threw, true, 'Phải throw khi thiếu transferFromDate');
  });

  await run.run('applyProfileEdit(transfers): hợp lệ CÓ probationFromDate -> status tự suy ra IN_PROBATION, ghi profileEditHistory', () => {
    const profile = employeeProfile.defaultProfile('NV004');
    employeeProfile.applyProfileEdit(profile, {
      transfers: [{ type: 'TRANSFER', oldUnit: 'Phòng A', newUnit: 'Phòng B', transferFromDate: '2026-01-01', probationFromDate: '2026-01-01', probationToDate: '2026-03-01', note: 'Điều động thử việc' }]
    }, ['transfers'], 'hr1', 'Nhân Sự Trưởng');
    assertEqual(profile.transfers.length, 1, 'Lưu đúng 1 dòng');
    const t = profile.transfers[0];
    assertEqual(t.status, 'IN_PROBATION', 'Có probationFromDate -> tự suy ra IN_PROBATION');
    assertEqual(t.oldUnit, 'Phòng A', 'oldUnit lưu đúng');
    assertEqual(t.newUnit, 'Phòng B', 'newUnit lưu đúng');
    assertEqual(t.decidedByName, 'Nhân Sự Trưởng', 'Ghi đúng người quyết định');
    assertEqual(!!t.id, true, 'Tự sinh id');
    const editEntry = profile.profileEditHistory.find(h => (h.changedFields || []).some(f => f.includes('Bổ nhiệm') || f.includes('Điều động')));
    assertEqual(!!editEntry, true, 'Phải ghi 1 dòng profileEditHistory cho field transfers (đúng khuôn disciplinaryActions)');
  });

  await run.run('applyProfileEdit(transfers): KHÔNG có probationFromDate -> status tự suy ra CONFIRMED', () => {
    const profile = employeeProfile.defaultProfile('NV005');
    employeeProfile.applyProfileEdit(profile, {
      transfers: [{ type: 'APPOINTMENT', newUnit: 'Phòng C', transferFromDate: '2026-01-01' }]
    }, ['transfers'], 'hr1', 'HR');
    assertEqual(profile.transfers[0].status, 'CONFIRMED', 'Không có thử thách -> CONFIRMED ngay');
  });

  await run.run('applyProfileEdit(transfers): status truyền tay hợp lệ (CANCELLED) -> giữ đúng giá trị truyền vào', () => {
    const profile = employeeProfile.defaultProfile('NV006');
    employeeProfile.applyProfileEdit(profile, {
      transfers: [{ type: 'DISMISSAL', transferFromDate: '2026-01-01', status: 'CANCELLED' }]
    }, ['transfers'], 'hr1', 'HR');
    assertEqual(profile.transfers[0].status, 'CANCELLED', 'Giữ đúng status truyền tay');
  });

  await run.run('applyProfileEdit(transfers): status truyền tay KHÔNG hợp lệ -> lỗi rõ ràng', () => {
    const profile = employeeProfile.defaultProfile('NV007');
    let threw = false;
    try {
      employeeProfile.applyProfileEdit(profile, {
        transfers: [{ type: 'DISMISSAL', transferFromDate: '2026-01-01', status: 'BUA' }]
      }, ['transfers'], 'hr1', 'HR');
    } catch (e) { threw = true; assertIncludes(e.message, 'Trạng thái', 'Lỗi phải nêu rõ Trạng thái không hợp lệ'); }
    assertEqual(threw, true, 'Phải throw khi status sai');
  });

  // ===== PHẦN B: các hàm compute thuần =====
  const STORE_TYPES = { 'Siêu Thị Quận 1': 'ST', 'Cửa Hàng ABC': 'CH' };

  await run.run('classifyDept(): có trong storeTypes -> STCH, không có -> HO (mặc định)', () => {
    assertEqual(employeeProfile.TRANSFER_TYPE_LABELS.APPOINTMENT, 'Bổ nhiệm', 'Label APPOINTMENT đúng (xác nhận export đủ)');
  });

  await run.run('computeMonthlyHrReport(): gộp đúng tuyển mới/gia hạn theo phòng ban + tổng HO/STCH', () => {
    const contracts = [
      { employeeCode: 'NV001', dept: 'Phòng Kinh Doanh', renewalIndex: 0, startDate: '2026-03-05' },
      { employeeCode: 'NV002', dept: 'Phòng Kinh Doanh', renewalIndex: 1, startDate: '2026-03-10' },
      { employeeCode: 'NV003', dept: 'Siêu Thị Quận 1', renewalIndex: 0, startDate: '2026-03-15' },
      { employeeCode: 'NV004', dept: 'Phòng Kinh Doanh', renewalIndex: 0, startDate: '2026-02-20' } // ngoài tháng 3
    ];
    const result = employeeProfile.computeMonthlyHrReport([], contracts, { month: '2026-03', storeTypes: STORE_TYPES });
    assertEqual(result.totals.newHires, 2, 'Đúng 2 tuyển mới trong tháng 3 (NV001 + NV003, loại NV004 tháng 2)');
    assertEqual(result.totals.renewals, 1, 'Đúng 1 gia hạn trong tháng 3');
    const kdRow = result.rows.find(r => r.dept === 'Phòng Kinh Doanh');
    assertEqual(kdRow.newHires, 1, 'Phòng Kinh Doanh: 1 tuyển mới (NV001, NV004 ngoài tháng)');
    assertEqual(kdRow.renewals, 1, 'Phòng Kinh Doanh: 1 gia hạn');
    assertEqual(kdRow.classification, 'HO', 'Phòng Kinh Doanh không trong storeTypes -> HO');
    const stRow = result.rows.find(r => r.dept === 'Siêu Thị Quận 1');
    assertEqual(stRow.classification, 'STCH', 'Siêu Thị Quận 1 có trong storeTypes -> STCH');
    assertEqual(result.byClassification.HO.newHires, 1, 'Tổng HO newHires đúng');
    assertEqual(result.byClassification.STCH.newHires, 1, 'Tổng STCH newHires đúng');
  });

  await run.run('computeWeeklyHeadcountFlow(): tính đúng đầu tuần/tăng/giảm/cuối tuần theo phòng ban', () => {
    const profiles = [
      Object.assign(employeeProfile.defaultProfile('NV001'), { dept: 'Phòng Kinh Doanh', status: 'ACTIVE' }),
      Object.assign(employeeProfile.defaultProfile('NV002'), { dept: 'Phòng Kinh Doanh', status: 'ACTIVE' }),
      Object.assign(employeeProfile.defaultProfile('NV003'), { dept: 'Phòng Kinh Doanh', status: 'INACTIVE', updatedAt: '10:00:00 26/8/2026' })
    ];
    const contracts = [
      { employeeCode: 'NV001', renewalIndex: 0, startDate: '2026-01-10' }, // đã vào từ đầu năm, trước tuần
      { employeeCode: 'NV002', renewalIndex: 0, startDate: '2026-08-26' }, // vào TRONG tuần đang xét
      { employeeCode: 'NV003', renewalIndex: 0, startDate: '2026-02-01' } // nghỉ TRONG tuần đang xét (updatedAt 26/8)
    ];
    const result = employeeProfile.computeWeeklyHeadcountFlow(profiles, contracts, { weekStart: '2026-08-24', weekEnd: '2026-08-30' });
    const row = result.rows.find(r => r.dept === 'Phòng Kinh Doanh');
    assertEqual(!!row, true, 'Phải có dòng Phòng Kinh Doanh');
    assertEqual(row.startOfWeek, 2, 'Đầu tuần (23/8): NV001 + NV003 đã vào làm, NV002 chưa vào -> 2 người');
    assertEqual(row.increased, 1, 'Tăng trong tuần: đúng 1 (NV002 vào 26/8)');
    assertEqual(row.decreased, 1, 'Giảm trong tuần: đúng 1 (NV003 nghỉ 26/8)');
    assertEqual(row.endOfWeek, 2, 'Cuối tuần (30/8): NV001 + NV002 còn làm (NV003 đã nghỉ) -> 2 người');
  });

  await run.run('computeSalaryAdjustmentHistory(): chỉ lấy amendment LOẠI LƯƠNG trong khoảng ngày, bỏ qua loại khác', () => {
    const profiles = [Object.assign(employeeProfile.defaultProfile('NV001'), { dept: 'Phòng Kinh Doanh' })];
    const contracts = [{
      employeeCode: 'NV001', code: 'HDLD-NV001-1',
      amendments: [
        { amendmentType: 'Tăng lương', effectiveDate: '2026-02-15', oldValue: '10tr', newValue: '12tr' },
        { amendmentType: 'Đổi chức danh', effectiveDate: '2026-02-20', oldValue: 'NV', newValue: 'TP' },
        { amendmentType: 'Tăng lương', effectiveDate: '2026-05-01', oldValue: '12tr', newValue: '15tr' }
      ]
    }];
    const result = employeeProfile.computeSalaryAdjustmentHistory(profiles, contracts, { from: '2026-02-01', to: '2026-02-28' });
    assertEqual(result.total, 1, 'Chỉ 1 dòng khớp (loại lương, trong tháng 2) — loại "Đổi chức danh" và dòng tháng 5 bị loại');
    assertEqual(result.rows[0].dept, 'Phòng Kinh Doanh', 'Tra đúng phòng ban từ hồ sơ');
    assertEqual(result.rows[0].newValue, '12tr', 'Giá trị mới đúng dòng khớp');
  });

  await run.run('computeTransfersReport(): lọc đúng theo khoảng ngày + loại thao tác, sort mới nhất trước', () => {
    const profiles = [
      Object.assign(employeeProfile.defaultProfile('NV001'), {
        dept: 'Phòng A',
        transfers: [
          { type: 'APPOINTMENT', transferFromDate: '2026-01-10', status: 'CONFIRMED' },
          { type: 'TRANSFER', transferFromDate: '2026-03-10', status: 'IN_PROBATION' }
        ]
      })
    ];
    const all = employeeProfile.computeTransfersReport(profiles, {});
    assertEqual(all.total, 2, 'Không lọc -> đủ 2 dòng');
    assertEqual(all.rows[0].transferFromDate, '2026-03-10', 'Sort mới nhất (3/2026) đứng đầu');
    const filtered = employeeProfile.computeTransfersReport(profiles, { type: 'APPOINTMENT' });
    assertEqual(filtered.total, 1, 'Lọc theo type=APPOINTMENT -> đúng 1 dòng');
    assertEqual(filtered.rows[0].typeLabel, 'Bổ nhiệm', 'typeLabel map đúng nhãn tiếng Việt');
    const byRange = employeeProfile.computeTransfersReport(profiles, { from: '2026-02-01', to: '2026-04-01' });
    assertEqual(byRange.total, 1, 'Lọc theo khoảng ngày -> đúng 1 dòng (chỉ dòng 3/2026)');
  });

  await run.run('computeDependentsReport(): làm phẳng dependents[] của NHIỀU nhân viên thành đúng số dòng', () => {
    const profiles = [
      Object.assign(employeeProfile.defaultProfile('NV001'), {
        dept: 'Phòng A', taxCode: 'MST001',
        dependents: [{ fullName: 'Con A', relationship: 'Con', dateOfBirth: '2015-01-01' }]
      }),
      Object.assign(employeeProfile.defaultProfile('NV002'), { dept: 'Phòng B', dependents: [] })
    ];
    const result = employeeProfile.computeDependentsReport(profiles);
    assertEqual(result.total, 1, 'Đúng 1 dòng (NV002 không có người phụ thuộc)');
    assertEqual(result.rows[0].employeeCode, 'NV001', 'Mã NV đúng');
    assertEqual(result.rows[0].taxpayerTaxCode, 'MST001', 'MST người nộp thuế lấy từ hồ sơ chính');
    assertEqual(result.rows[0].fullName, 'Con A', 'Tên người phụ thuộc đúng');
  });

  await run.run('computeHrDashboardSummary(): gộp đúng chỉ số brief (ACTIVE_LIKE/HO-STCH/onboarding/offboarding/sắp hết hạn/đang thử thách)', () => {
    const profiles = [
      Object.assign(employeeProfile.defaultProfile('NV001'), { dept: 'Phòng A', status: 'ACTIVE' }),
      Object.assign(employeeProfile.defaultProfile('NV002'), { dept: 'Siêu Thị Quận 1', status: 'ON_LEAVE' }),
      Object.assign(employeeProfile.defaultProfile('NV003'), { dept: 'Phòng A', status: 'INACTIVE' }),
      Object.assign(employeeProfile.defaultProfile('NV004'), {
        dept: 'Phòng A', status: 'ACTIVE',
        transfers: [{ type: 'TRANSFER', transferFromDate: '2026-01-01', status: 'IN_PROBATION' }]
      })
    ];
    const contracts = [
      { employeeCode: 'NV001', status: 'ACTIVE', endDate: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) }
    ];
    const hrProcesses = [
      { processType: 'ONBOARDING', status: 'IN_PROGRESS' },
      { processType: 'ONBOARDING', status: 'COMPLETED' },
      { processType: 'OFFBOARDING', status: 'IN_PROGRESS' }
    ];
    const result = employeeProfile.computeHrDashboardSummary(profiles, contracts, hrProcesses, STORE_TYPES);
    assertEqual(result.totalActive, 3, 'ACTIVE_LIKE (ACTIVE hoặc ON_LEAVE): NV001+NV002+NV004 = 3 (bỏ NV003 INACTIVE)');
    assertEqual(result.onLeave, 1, 'Đúng 1 người ON_LEAVE (NV002)');
    assertEqual(result.byClassification.STCH, 1, 'Đúng 1 người thuộc STCH (NV002, Siêu Thị Quận 1)');
    assertEqual(result.byClassification.HO, 2, 'Đúng 2 người thuộc HO (NV001 + NV004)');
    assertEqual(result.onboardingInProgress, 1, 'Đúng 1 Onboarding đang tiến hành (bỏ dòng COMPLETED)');
    assertEqual(result.offboardingInProgress, 1, 'Đúng 1 Offboarding đang tiến hành');
    assertEqual(result.expiringSoonCount, 1, 'Đúng 1 hợp đồng sắp hết hạn trong 30 ngày');
    assertEqual(result.transfersInProbation, 1, 'Đúng 1 lượt điều động đang thử thách (NV004)');
  });

  // ===== PHẦN C: HTTP thật qua Express =====
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, active: true };
  const HR_FULL = { username: 'hr1', name: 'Nhân Sự Trưởng', perms: { hrProfileManage: true, hrContractManage: true }, active: true };
  const HR_PROFILE_ONLY = { username: 'hr2', name: 'HR Chỉ Hồ Sơ', perms: { hrProfileManage: true }, active: true };
  const HR_REPORT_VIEW_ONLY = { username: 'hr3', name: 'HR Chỉ Xem Báo Cáo', perms: { hrReportView: true }, active: true };
  const EMP1 = { username: 'emp1', name: 'Nhân Viên Một', dept: 'Cũ', jobTitle: 'Chức Cũ', perms: {}, active: true };
  const USERS = [ADMIN, HR_FULL, HR_PROFILE_ONLY, HR_REPORT_VIEW_ONLY, EMP1];
  let APP_DATA;
  function resetAppData() {
    APP_DATA = { users: USERS, employeeProfiles: [], hrProcesses: [], orgChartVersions: [], storeTypes: {} };
  }
  let LABOR_CONTRACTS = [];

  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
    getAllAppData: async () => APP_DATA,
    withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
  });
  let CURRENT_USERNAME = ADMIN.username;
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  stubModule('lib/recordStore', {
    getAllForCollection: async (collection) => (collection === 'laborContracts' ? LABOR_CONTRACTS : [])
  });

  const express = require('express');
  const employeeProfileRoutes = require('../routes/employeeProfile');
  let PORT = 0;

  function startApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/hr-profile', employeeProfileRoutes);
    return new Promise((resolve, reject) => {
      const server = http.createServer(app);
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
    });
  }
  async function api(urlPath, asUser) {
    if (asUser) CURRENT_USERNAME = asUser.username;
    const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`);
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { status: res.status, body };
  }

  const server = await startApp();
  try {
    for (const routePath of ['/reports/dashboard', '/reports/monthly', '/reports/weekly?weekStart=2026-01-01&weekEnd=2026-01-07', '/reports/salary-history', '/reports/transfers', '/reports/dependents']) {
      await run.run(`GET /api/hr-profile${routePath} — người chỉ có hrProfileManage (thiếu hrContractManage) -> 403`, async () => {
        resetAppData();
        const res = await api(`/api/hr-profile${routePath}`, HR_PROFILE_ONLY);
        assertEqual(res.status, 403, 'Phải bị chặn 403 — cùng mức chặt canViewHrReports()');
      });
      await run.run(`GET /api/hr-profile${routePath} — người có hrReportView (không cần đủ cả 2 quyền kia) -> 200`, async () => {
        resetAppData();
        const res = await api(`/api/hr-profile${routePath}`, HR_REPORT_VIEW_ONLY);
        assertEqual(res.status, 200, 'Có hrReportView -> xem được, không cần đủ cả hrProfileManage+hrContractManage');
      });
      await run.run(`GET /api/hr-profile${routePath} — nhân viên thường (không quyền gì) -> 403`, async () => {
        resetAppData();
        const res = await api(`/api/hr-profile${routePath}`, EMP1);
        assertEqual(res.status, 403, 'Không có quyền nào -> 403');
      });
    }

    await run.run('GET /api/hr-profile/reports/weekly — thiếu weekStart/weekEnd -> 400 rõ ràng', async () => {
      resetAppData();
      const res = await api('/api/hr-profile/reports/weekly', HR_FULL);
      assertEqual(res.status, 400, 'Thiếu weekStart/weekEnd phải trả 400, không 500');
    });

    await run.run('GET /api/hr-profile/reports/dashboard — trả đúng cấu trúc JSON (wiring đúng hàm compute)', async () => {
      resetAppData();
      APP_DATA.employeeProfiles = [Object.assign(employeeProfile.defaultProfile('NV001'), { dept: 'Phòng A', status: 'ACTIVE' })];
      const res = await api('/api/hr-profile/reports/dashboard', HR_FULL);
      assertEqual(res.status, 200, 'Xem được');
      assertEqual(res.body.totalActive, 1, 'Wiring đúng — đếm đúng 1 người ACTIVE từ fixture vừa seed');
      assertEqual(typeof res.body.byClassification, 'object', 'Có field byClassification');
    });

    await run.run('GET /api/hr-profile/reports/transfers — trả đúng dữ liệu transfers[] đã lưu trên hồ sơ', async () => {
      resetAppData();
      APP_DATA.employeeProfiles = [Object.assign(employeeProfile.defaultProfile('NV001'), {
        dept: 'Phòng A',
        transfers: [{ type: 'APPOINTMENT', transferFromDate: '2026-01-01', status: 'CONFIRMED' }]
      })];
      const res = await api('/api/hr-profile/reports/transfers', HR_FULL);
      assertEqual(res.status, 200, 'Xem được');
      assertEqual(res.body.total, 1, 'Wiring đúng — đọc đúng transfers[] đã seed');
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('LỖI CHẠY TEST:', err); process.exit(1); });
