// server/tests/test-payroll.js
//
// Regression test cho module "Nhân Sự > Lương" (lib/payroll.js + routes/payroll.js) — dedicated router
// (không qua GET /api/data chung), cùng khuôn tests/test-hr-profile.js: stub lib/appData + lib/recordStore
// (payrollPeriods/payslips/notifications/laborContracts/attendanceRecords/hrProcesses là MIGRATED_COLLECTIONS,
// xem lib/recordStore.js) + lib/auth, chạy thẳng express router THẬT.
//
//   PHẦN A (HTTP, qua router thật):
//     1. Tính lương (POST /periods/:id/calculate): chỉ hrPayrollManage/admin (403 người thường); tính đúng
//        BASIC_SALARY + OT cho nhân viên có hợp đồng ACTIVE; BỎ QUA (skipped) nhân viên không có hợp đồng.
//     2. Điều chỉnh dòng tay (PATCH /payslips/:id/details): chỉ DRAFT; component lạ (không thuộc
//        MANUAL_COMPONENT_CODES) bị từ chối; ghi đè (không cộng dồn) khi lưu lại cùng 1 componentCode.
//     3. Luồng trạng thái kỳ lương: submit (DRAFT->PENDING_APPROVAL) chỉ hrPayrollManage; approve/reject
//        chỉ hrPayrollApprove (segregation of duties — người CHỈ có hrPayrollManage bị 403 khi approve);
//        reject quay lại DRAFT; finalize khoá; publish tạo Notifications cho từng nhân viên có payslip.
//     4. reopen bắt buộc nhập lý do (400 nếu thiếu).
//     5. Tự xem "Phiếu Lương Của Tôi" (IDOR-safe): GET /my-payslips chỉ trả phiếu của CHÍNH MÌNH (suy từ
//        req.freshUser.username qua employeeProfiles) và chỉ khi kỳ đã PUBLISHED — không nhận employeeCode
//        từ client; GET /my-payslips/:periodId đánh dấu viewedByEmployeeAt lần xem đầu.
//     6. Cấu hình rate (GET/PUT /rate-config): PUT chỉ hrPayrollManage/admin; validate số âm/bậc thuế.
//
//   PHẦN B (gọi thẳng hàm THẬT trong lib/payroll.js qua require()):
//     7. computeTaxFromBrackets(): tính lũy tiến đúng qua biên các bậc thuế.
//
// Chạy: node server/tests/test-payroll.js
'use strict';
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

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const HR_MGR = { username: 'ketoan1', name: 'Kế Toán Trưởng', dept: 'Phòng Kế Toán', perms: { hrPayrollManage: true }, active: true };
const APPROVER = { username: 'gd1', name: 'Giám Đốc', dept: 'Ban Giám Đốc', perms: { hrPayrollApprove: true }, active: true };
const EMP1 = { username: 'emp1', name: 'Nhân Viên Một', dept: 'Phòng Kinh Doanh', posType: 'OFFICE', perms: {}, active: true };
const EMP2 = { username: 'emp2', name: 'Nhân Viên Hai (chưa có HĐ)', dept: 'Phòng Kinh Doanh', posType: 'OFFICE', perms: {}, active: true };
let USERS = [ADMIN, HR_MGR, APPROVER, EMP1, EMP2];

// employeeProfiles: AppData "phẳng" (KHÔNG phải MIGRATED_COLLECTIONS — module Hồ Sơ NS xây trước Lương,
// vẫn sống trong lib/appData) — payrollRateConfig cũng cùng khuôn. laborContracts/attendanceRecords/
// hrProcesses/payrollPeriods/payslips/notifications MỚI là MIGRATED_COLLECTIONS (lib/recordStore.js),
// giả lập RIÊNG bằng RECORDS bên dưới.
let APP_DATA;
let RECORDS;
function resetAppData() {
  APP_DATA = {
    employeeProfiles: [
      { employeeCode: 'NV001', username: 'emp1', status: 'ACTIVE', dependents: [] },
      { employeeCode: 'NV002', username: 'emp2', status: 'ACTIVE', dependents: [] }
    ],
    payrollRateConfig: {}
  };
  RECORDS = {
    laborContracts: [
      { id: 1, employeeCode: 'NV001', status: 'ACTIVE', baseSalary: 15000000, dept: 'Phòng Kinh Doanh' }
      // NV002 CỐ Ý không có hợp đồng ACTIVE -> test case "skipped"
    ],
    attendanceRecords: [
      // 1 bản ghi OVERTIME hệ số thường (1.5x) trong kỳ 01/2025 cho NV001
      { id: 1, employeeCode: 'NV001', workDate: '2025-01-15', recordType: 'OVERTIME', hoursWorked: 4, isWeekendWork: false, isHolidayWork: false }
    ],
    hrProcesses: [],
    payrollPeriods: [],
    payslips: [],
    notifications: []
  };
}
resetAppData();

let PORT = 0;
let CURRENT_USERNAME = ADMIN.username;
let idSeq = 1000;

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAllAppData: async () => APP_DATA,
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

stubModule('lib/recordStore', {
  getAllForCollection: async (collection) => RECORDS[collection] || [],
  insertRecord: async (collection, record) => {
    if (record.id == null) record.id = idSeq++;
    RECORDS[collection] = RECORDS[collection] || [];
    RECORDS[collection].push(record);
    return record;
  },
  deleteRecordById: async (collection, id) => {
    RECORDS[collection] = (RECORDS[collection] || []).filter(r => r.id !== id);
    return true;
  },
  withLockedRecordForCollection: async (collection, id, mutatorFn) => {
    const list = RECORDS[collection] || [];
    const idx = list.findIndex(r => r.id === id);
    if (idx === -1) { const err = new Error('Không tìm thấy bản ghi'); err.statusCode = 404; throw err; }
    const updated = await mutatorFn(list[idx]);
    list[idx] = updated;
    return updated;
  },
  withLockedRecordById: async (collection, id, mutatorFn) => {
    const list = RECORDS[collection] || [];
    const idx = list.findIndex(r => r.id === id);
    if (idx === -1) { const err = new Error('Không tìm thấy bản ghi'); err.statusCode = 404; throw err; }
    const updated = await mutatorFn(list[idx]);
    list[idx] = updated;
    return updated;
  }
});

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');
const payrollRoutes = require('../routes/payroll');
const payroll = require('../lib/payroll');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/payroll', payrollRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

// Tạo sẵn 1 kỳ lương DRAFT trực tiếp qua RECORDS (bỏ qua routes/create.js — route đó test riêng ở
// createValidation.js/generic create engine, không thuộc phạm vi test này).
function seedDraftPeriod(overrides) {
  const valid = payroll.assertValidNewPeriod({ periodMonth: 1, periodYear: 2025 }, RECORDS.payrollPeriods);
  const period = Object.assign(payroll.defaultPeriod(valid, 'admin', 'Quản Trị Viên'), { id: idSeq++ }, overrides || {});
  RECORDS.payrollPeriods.push(period);
  return period;
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    // ===== PHẦN A =====
    await run.run('Tính lương: chỉ hrPayrollManage/admin, chặn người thường', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      const res = await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, EMP1);
      assertEqual(res.status, 403, 'Người thường không có hrPayrollManage phải bị 403');
    });

    await run.run('Tính lương: tính đúng BASIC_SALARY + OT cho NV001, bỏ qua NV002 (chưa có HĐ)', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      const res = await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      assertEqual(res.status, 200, 'Tính lương phải thành công');
      assertEqual(res.body.item.employeeCount, 1, 'Chỉ 1 nhân viên có hợp đồng ACTIVE được tính');
      assertEqual(res.body.item.skippedCount, 1, 'NV002 (chưa có HĐ) phải bị bỏ qua');
      assertEqual(res.body.skipped[0].employeeCode, 'NV002', 'Đúng nhân viên bị bỏ qua');

      const payslips = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      assertEqual(payslips.body.payslips.length, 1, 'Phải có đúng 1 payslip được tạo');
      const slip = payslips.body.payslips[0];
      assertEqual(slip.employeeCode, 'NV001', 'Payslip đúng nhân viên');
      const basic = slip.details.find(d => d.componentCode === 'BASIC_SALARY');
      assertEqual(basic.amount, 15000000, 'Lương cơ bản phải lấy đúng baseSalary hợp đồng ACTIVE');
      const ot150 = slip.details.find(d => d.componentCode === 'OT_150');
      assertIncludes([true], !!ot150, '4 giờ OT hệ số thường phải sinh dòng OT_150');
      // dailyRate = 15tr/22 ngày ~ 681,818đ; hourlyRate = dailyRate/8; OT150 = 4h * hourlyRate * 1.5
      const dailyRate = 15000000 / 22, hourlyRate = dailyRate / 8;
      const expectedOt = Math.round(4 * hourlyRate * 1.5);
      assertEqual(ot150.amount, expectedOt, 'Số tiền OT_150 phải tính đúng công thức giờ × đơn giá × hệ số');
    });

    await run.run('Tính lương: tính lại (recalculate) XOÁ payslip cũ, không cộng dồn trùng', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      const payslips = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      assertEqual(payslips.body.payslips.length, 1, 'Tính lại không được tạo trùng payslip');
    });

    await run.run('Điều chỉnh dòng tay: chặn mã thành phần không thuộc danh mục nhập tay', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      const payslips = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      const slipId = payslips.body.payslips[0].id;
      const res = await api('PATCH', `/api/payroll/payslips/${slipId}/details`,
        { componentCode: 'BASIC_SALARY', amount: 999999999, note: 'cố tình sửa lương cơ bản' }, HR_MGR);
      assertEqual(res.status, 400, 'BASIC_SALARY không phải componentCode nhập tay -> phải bị từ chối');
    });

    await run.run('Điều chỉnh dòng tay: lưu lại cùng componentCode THAY THẾ (không cộng dồn)', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      const payslips = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      const slipId = payslips.body.payslips[0].id;
      await api('PATCH', `/api/payroll/payslips/${slipId}/details`, { componentCode: 'BONUS_OTHER', amount: 500000, note: 'Thưởng lần 1' }, HR_MGR);
      const res2 = await api('PATCH', `/api/payroll/payslips/${slipId}/details`, { componentCode: 'BONUS_OTHER', amount: 800000, note: 'Sửa lại' }, HR_MGR);
      const bonusRows = res2.body.item.details.filter(d => d.componentCode === 'BONUS_OTHER');
      assertEqual(bonusRows.length, 1, 'Lưu lại cùng mã phải THAY THẾ, không tạo thêm dòng thứ 2');
      assertEqual(bonusRows[0].amount, 800000, 'Giá trị mới nhất phải được giữ lại');
    });

    await run.run('Điều chỉnh dòng tay: chặn khi kỳ KHÔNG còn ở trạng thái Nháp', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      const payslips = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      const slipId = payslips.body.payslips[0].id;
      await api('POST', `/api/payroll/periods/${period.id}/submit`, {}, HR_MGR);
      const res = await api('PATCH', `/api/payroll/payslips/${slipId}/details`, { componentCode: 'BONUS_OTHER', amount: 100000 }, HR_MGR);
      assertEqual(res.status, 409, 'Kỳ đã PENDING_APPROVAL -> không điều chỉnh tay được nữa');
    });

    await run.run('Phân tách nhiệm vụ: hrPayrollManage KHÔNG được tự duyệt (chỉ hrPayrollApprove)', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      await api('POST', `/api/payroll/periods/${period.id}/submit`, {}, HR_MGR);
      const res = await api('POST', `/api/payroll/periods/${period.id}/approve`, {}, HR_MGR);
      assertEqual(res.status, 403, 'Người CHỈ có hrPayrollManage (không có hrPayrollApprove) phải bị chặn duyệt');
    });

    await run.run('Luồng đầy đủ: submit -> reject (về DRAFT) -> submit -> approve -> finalize -> publish -> tạo Notifications', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      await api('POST', `/api/payroll/periods/${period.id}/submit`, {}, HR_MGR);
      const rej = await api('POST', `/api/payroll/periods/${period.id}/reject`, { reason: 'Sai số liệu, làm lại' }, APPROVER);
      assertEqual(rej.status, 200, 'hrPayrollApprove được quyền từ chối');
      assertEqual(rej.body.item.status, 'DRAFT', 'Từ chối phải trả kỳ về DRAFT');

      await api('POST', `/api/payroll/periods/${period.id}/submit`, {}, HR_MGR);
      const appr = await api('POST', `/api/payroll/periods/${period.id}/approve`, {}, APPROVER);
      assertEqual(appr.body.item.status, 'APPROVED', 'Duyệt phải chuyển sang APPROVED');

      const fin = await api('POST', `/api/payroll/periods/${period.id}/finalize`, {}, HR_MGR);
      assertEqual(fin.body.item.status, 'FINALIZED', 'Chốt kỳ phải chuyển sang FINALIZED');

      const pub = await api('POST', `/api/payroll/periods/${period.id}/publish`, {}, HR_MGR);
      assertEqual(pub.status, 200, 'Công bố phải thành công');
      assertEqual(pub.body.item.status, 'PUBLISHED', 'Công bố phải chuyển sang PUBLISHED');
      assertEqual(pub.body.notified, 1, 'Phải thông báo đúng số nhân viên có payslip trong kỳ');
      const notif = RECORDS.notifications.find(n => n.username === 'emp1' && n.type === 'PAYSLIP_PUBLISHED');
      assertIncludes([true], !!notif, 'Phải tạo Notification trong app cho nhân viên emp1');
    });

    await run.run('reopen: bắt buộc nhập lý do', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      await api('POST', `/api/payroll/periods/${period.id}/submit`, {}, HR_MGR);
      await api('POST', `/api/payroll/periods/${period.id}/approve`, {}, APPROVER);
      await api('POST', `/api/payroll/periods/${period.id}/finalize`, {}, HR_MGR);
      const noReason = await api('POST', `/api/payroll/periods/${period.id}/reopen`, {}, HR_MGR);
      assertEqual(noReason.status, 400, 'Thiếu lý do -> 400');
      const withReason = await api('POST', `/api/payroll/periods/${period.id}/reopen`, { reason: 'Phát hiện sai sót cần sửa lại' }, HR_MGR);
      assertEqual(withReason.status, 200, 'Có lý do -> thành công');
      assertEqual(withReason.body.item.status, 'DRAFT', 'Mở lại phải đưa kỳ về DRAFT');
    });

    await run.run('Phiếu Lương Của Tôi (IDOR-safe): chỉ thấy phiếu CHÍNH MÌNH, chỉ khi kỳ đã PUBLISHED', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      // Chưa publish -> emp1 chưa thấy gì
      const before = await api('GET', '/api/payroll/my-payslips', undefined, EMP1);
      assertEqual(before.body.payslips.length, 0, 'Kỳ chưa công bố -> nhân viên chưa xem được');

      await api('POST', `/api/payroll/periods/${period.id}/submit`, {}, HR_MGR);
      await api('POST', `/api/payroll/periods/${period.id}/approve`, {}, APPROVER);
      await api('POST', `/api/payroll/periods/${period.id}/finalize`, {}, HR_MGR);
      await api('POST', `/api/payroll/periods/${period.id}/publish`, {}, HR_MGR);

      const mine = await api('GET', '/api/payroll/my-payslips', undefined, EMP1);
      assertEqual(mine.body.payslips.length, 1, 'Sau khi công bố, emp1 phải thấy đúng 1 phiếu của mình');

      // emp2 KHÔNG có payslip trong kỳ này (bị skip lúc tính lương) -> danh sách rỗng, không lộ dữ liệu người khác
      const other = await api('GET', '/api/payroll/my-payslips', undefined, EMP2);
      assertEqual(other.body.payslips.length, 0, 'emp2 không có payslip trong kỳ -> danh sách rỗng');

      const detail = await api('GET', `/api/payroll/my-payslips/${period.id}`, undefined, EMP1);
      assertEqual(detail.status, 200, 'Xem chi tiết phiếu của mình phải thành công');
      assertIncludes([true], !!detail.body.payslip.viewedByEmployeeAt, 'Lần xem đầu phải đánh dấu viewedByEmployeeAt');

      const detailOther = await api('GET', `/api/payroll/my-payslips/${period.id}`, undefined, EMP2);
      assertEqual(detailOther.status, 404, 'emp2 không có payslip trong kỳ -> 404, không đoán ra được payslip của người khác');
    });

    await run.run('Cấu hình tỷ lệ (rate-config): PUT chỉ hrPayrollManage/admin, validate số âm', async () => {
      resetAppData();
      const denied = await api('PUT', '/api/payroll/rate-config', { bhxhPercent: 8, bhytPercent: 1.5, bhtnPercent: 1,
        bhxhCap: 999999999, personalDeduction: 11000000, dependentDeduction: 4400000,
        standardWorkDaysHo: 22, standardWorkDaysStore: 26, standardHoursPerDay: 8,
        otMultiplierNormal: 1.5, otMultiplierWeekend: 2, otMultiplierHoliday: 3 }, EMP1);
      assertEqual(denied.status, 403, 'Người thường không được sửa cấu hình lương');

      const invalid = await api('PUT', '/api/payroll/rate-config', { bhxhPercent: -5, bhytPercent: 1.5, bhtnPercent: 1,
        bhxhCap: 999999999, personalDeduction: 11000000, dependentDeduction: 4400000,
        standardWorkDaysHo: 22, standardWorkDaysStore: 26, standardHoursPerDay: 8,
        otMultiplierNormal: 1.5, otMultiplierWeekend: 2, otMultiplierHoliday: 3 }, HR_MGR);
      assertEqual(invalid.status, 400, '% BHXH âm phải bị từ chối');

      const ok = await api('PUT', '/api/payroll/rate-config', { bhxhPercent: 8, bhytPercent: 1.5, bhtnPercent: 1,
        bhxhCap: 36000000, personalDeduction: 11000000, dependentDeduction: 4400000,
        standardWorkDaysHo: 22, standardWorkDaysStore: 26, standardHoursPerDay: 8,
        otMultiplierNormal: 1.5, otMultiplierWeekend: 2, otMultiplierHoliday: 3 }, HR_MGR);
      assertEqual(ok.status, 200, 'hrPayrollManage sửa cấu hình hợp lệ phải thành công');
      assertEqual(ok.body.config.bhxhCap, 36000000, 'Giá trị mới phải được lưu lại');
    });

    // ===== PHẦN B =====
    await run.run('computeTaxFromBrackets(): tính thuế TNCN lũy tiến đúng qua nhiều bậc', async () => {
      const brackets = [
        { upTo: 5000000, rate: 5 }, { upTo: 10000000, rate: 10 }, { upTo: 18000000, rate: 15 },
        { upTo: 32000000, rate: 20 }, { upTo: 52000000, rate: 25 }, { upTo: 80000000, rate: 30 },
        { upTo: null, rate: 35 }
      ];
      // Thu nhập chịu thuế 15,000,000đ -> bậc 1 (5tr*5%) + bậc 2 (5tr*10%) + bậc 3 (5tr*15%)
      const expected = 5000000 * 0.05 + 5000000 * 0.10 + 5000000 * 0.15;
      assertEqual(payroll.computeTaxFromBrackets(15000000, brackets), Math.round(expected), 'Thuế lũy tiến qua 3 bậc phải tính đúng');
      assertEqual(payroll.computeTaxFromBrackets(0, brackets), 0, 'Thu nhập chịu thuế <= 0 -> thuế = 0');
      assertEqual(payroll.computeTaxFromBrackets(-1000000, brackets), 0, 'Thu nhập chịu thuế âm -> thuế = 0');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
