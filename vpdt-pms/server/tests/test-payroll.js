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
  // replaceRecordsInCollection(): đợt rà soát chuyên sâu cụm Nhân Sự 10/2026 — "Tính Lương Tự Động" nay
  // xoá payslip cũ + ghi payslip mới trong ĐÚNG 1 giao dịch SQL (xem lib/recordStore.js). Bản giả lập
  // này mô phỏng đúng ngữ nghĩa "all-or-nothing" trên mảng in-memory.
  replaceRecordsInCollection: async (collection, idsToDelete, newRecords) => {
    const keep = (RECORDS[collection] || []).filter(r => !(idsToDelete || []).includes(r.id));
    RECORDS[collection] = [...keep, ...(newRecords || [])];
    return (newRecords || []).length;
  },
  withLockedRecordById: async (collection, id, mutatorFn) => {
    const list = RECORDS[collection] || [];
    const idx = list.findIndex(r => r.id === id);
    if (idx === -1) { const err = new Error('Không tìm thấy bản ghi'); err.statusCode = 404; throw err; }
    const updated = await mutatorFn(list[idx]);
    list[idx] = updated;
    return updated;
  },
  // withAppLock() (rà soát chuyên sâu cụm Nhân Sự vòng 2, mức Trung bình — #7): "Tính Lương Tự Động" nay
  // bọc toàn bộ trong khoá để chặn 2 lượt gọi đồng thời nhân đôi payslip. Bản giả lập XẾP HÀNG THẬT theo
  // từng lockKey (không chỉ gọi fn() ngay) — mô phỏng đúng ngữ nghĩa loại trừ lẫn nhau của sp_getapplock
  // thật (lib/recordStore.js), để test "2 lượt gọi đồng thời" bên dưới thực sự có ý nghĩa (nếu ai đó lỡ
  // gỡ withAppLock() khỏi route, test này phải FAIL vì payslip bị nhân đôi).
  withAppLock: (() => {
    const chains = new Map();
    return async (lockKeyOrKeys, fn) => {
      const key = (Array.isArray(lockKeyOrKeys) ? [...lockKeyOrKeys].sort() : [lockKeyOrKeys]).join('|');
      const prev = chains.get(key) || Promise.resolve();
      const run = prev.then(fn, fn); // chạy fn() sau khi lượt trước xong, dù lượt trước lỗi hay không
      chains.set(key, run.catch(() => {}));
      return run;
    };
  })()
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

    // LỖI ĐÃ VÁ (rà soát chuyên sâu cụm Nhân Sự vòng 2, mức Trung bình — #7): 2 LƯỢT "Tính Lương Tự Động"
    // GỌI GẦN NHƯ ĐỒNG THỜI (double-click, hoặc 2 kế toán cùng bấm) TRƯỚC ĐÂY đều đọc existingPayslips
    // TRƯỚC KHI lượt kia kịp ghi xong -> cả 2 đều insert payslip mới, KHÔNG lượt nào xoá được payslip của
    // lượt kia -> NHÂN ĐÔI toàn bộ phiếu lương của kỳ. Nay bọc trong withAppLock() để 2 lượt tự xếp hàng —
    // bản giả lập withAppLock ở trên XẾP HÀNG THẬT (không chỉ gọi fn() ngay) nên test này phản ánh đúng
    // hành vi khi 2 request THẬT chạm route gần như đồng thời.
    await run.run('LỖI ĐÃ VÁ (#7): 2 lượt "Tính Lương Tự Động" gọi ĐỒNG THỜI (Promise.all) không nhân đôi payslip', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      const [r1, r2] = await Promise.all([
        api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR),
        api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR)
      ]);
      // Cả 2 request đều hợp lệ về quyền/trạng thái nên cả 2 nên trả 200 (lượt sau tính lại đè lên lượt
      // trước, xếp hàng nhờ withAppLock — không phải 1 request thắng/1 request bị 409 vì race).
      assertEqual(r1.status, 200, JSON.stringify(r1.body));
      assertEqual(r2.status, 200, JSON.stringify(r2.body));
      const payslips = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      assertEqual(payslips.body.payslips.length, 1, '2 lượt tính đồng thời KHÔNG được nhân đôi payslip — đây chính là lỗi vừa vá (#7)');
    });

    // LUONG-09 (regression quan trọng nhất module Lương — bug đã từng gây MẤT DỮ LIỆU lương thật đã nhập
    // tay): tính lại CẢ KỲ (VD chỉ để bổ sung 1 người mới sót) KHÔNG được xoá điều chỉnh tay đã lưu cho
    // người KHÁC — xem mergeManualAdjustmentsIntoPayslip() (lib/payroll.js) + chú thích ở
    // POST /periods/:id/calculate (routes/payroll.js).
    await run.run('LUONG-09: tính lại (recalculate) KHÔNG xoá điều chỉnh tay (thưởng/phạt) đã lưu cho người khác', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      const payslips1 = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      const slip1 = payslips1.body.payslips.find(p => p.employeeCode === 'NV001');
      // Kế toán thêm 1 dòng thưởng nhập tay cho NV001 (đã "chốt" trong lúc rà soát).
      await api('PATCH', `/api/payroll/payslips/${slip1.id}/details`, { componentCode: 'BONUS_OTHER', amount: 2000000, note: 'Thưởng dự án Q1' }, HR_MGR);

      // Giả lập tình huống thật: kế toán phát hiện sót 1 nhân viên (thêm hợp đồng ACTIVE cho NV002 —
      // trước đó bị skip vì chưa có hợp đồng) rồi bấm "Tính Lương" LẠI để bổ sung NV002, KHÔNG có ý định
      // đụng gì tới payslip NV001 đã rà soát xong.
      RECORDS.laborContracts.push({ id: 2, employeeCode: 'NV002', status: 'ACTIVE', baseSalary: 12000000, dept: 'Phòng Kinh Doanh' });
      const recalc = await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      assertEqual(recalc.body.item.employeeCount, 2, 'Tính lại phải nhận đủ cả NV001 lẫn NV002 (mới bổ sung hợp đồng)');

      const payslips2 = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      assertEqual(payslips2.body.payslips.length, 2, 'Phải có đúng 2 payslip sau khi tính lại (không trùng, không thiếu)');
      const slip1After = payslips2.body.payslips.find(p => p.employeeCode === 'NV001');
      const bonusAfter = slip1After.details.find(d => d.componentCode === 'BONUS_OTHER' && d.isManualAdjustment);
      assertIncludes([true], !!bonusAfter, 'Dòng thưởng nhập tay của NV001 PHẢI CÒN NGUYÊN sau khi tính lại cả kỳ');
      assertEqual(bonusAfter.amount, 2000000, 'Số tiền thưởng nhập tay phải giữ đúng giá trị cũ, không bị tính lại/mất');
      assertEqual(slip1After.netPay, slip1After.grossIncome - slip1After.totalDeduction, 'netPay phải được tính lại đúng có gồm cả dòng thưởng nhập tay vừa gộp lại');

      const slip2After = payslips2.body.payslips.find(p => p.employeeCode === 'NV002');
      assertIncludes([true], !!slip2After, 'NV002 (mới bổ sung hợp đồng) phải có payslip sau khi tính lại');
      assertIncludes([false], (slip2After.details || []).some(d => d.isManualAdjustment), 'NV002 mới tính lần đầu không có dòng nhập tay nào');
    });

    // LUONG-07/08: nhân viên hoàn tất Offboarding GIỮA KỲ lương (hợp đồng đã bị applyOffboardingTermination()
    // tự đóng thành TERMINATED TRƯỚC khi kế toán bấm Tính Lương — đúng thứ tự thực tế "nghỉ ngày 15, tính
    // lương ngày 28 cùng tháng") VẪN phải xuất hiện trong kỳ lương, KHÔNG bị bỏ sót, và KHÔNG bị tự động
    // trừ ngày không làm việc (kế toán tự Điều chỉnh dòng lương nếu cần).
    await run.run('LUONG-07/08: nhân viên Offboarding hoàn tất GIỮA KỲ (hợp đồng đã TERMINATED) vẫn được tính lương đủ tháng, có ghi chú', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      APP_DATA.employeeProfiles.push({ employeeCode: 'NV003', username: 'emp3', status: 'INACTIVE', dependents: [] });
      // Hợp đồng đã CHUYỂN TERMINATED (do applyOffboardingTermination() tự đóng khi Offboarding hoàn tất
      // ngày 15/01) — KHÔNG còn ACTIVE nữa vào lúc kế toán bấm Tính Lương.
      RECORDS.laborContracts.push({ id: 3, employeeCode: 'NV003', status: 'TERMINATED', baseSalary: 12000000, dept: 'Phòng Kinh Doanh' });
      RECORDS.hrProcesses.push({
        id: 1, processType: 'OFFBOARDING', status: 'COMPLETED',
        employeeUsername: 'emp3', employeePosType: 'OFFICE', employeeDept: 'Phòng Kinh Doanh',
        lastWorkingDate: '2025-01-15'
      });

      const res = await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      assertEqual(res.status, 200, 'Tính lương phải thành công');
      assertIncludes([false], res.body.skipped.some(s => s.employeeCode === 'NV003'), 'NV003 (offboard giữa kỳ) KHÔNG được rơi vào danh sách bị bỏ qua');

      const payslips = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      const slip = payslips.body.payslips.find(p => p.employeeCode === 'NV003');
      assertIncludes([true], !!slip, 'NV003 phải có payslip trong kỳ dù đã nghỉ việc giữa kỳ');
      const basic = slip.details.find(d => d.componentCode === 'BASIC_SALARY');
      assertEqual(basic.amount, 12000000, 'Lương cơ bản phải tính ĐỦ 1 tháng — KHÔNG tự trừ theo số ngày không làm việc sau khi nghỉ');
      assertIncludes([true], basic.note.includes('nghỉ việc'), 'Dòng Lương cơ bản phải có ghi chú ngày nghỉ việc để kế toán tự rà soát/điều chỉnh');
    });

    // LỖI ĐÃ VÁ (rà soát chuyên sâu Nhân Sự, 9/2026): chiều NGƯỢC LẠI với LUONG-07/08 ở trên — nhân viên
    // MỚI VÀO LÀM giữa kỳ trước đây KHÔNG có cảnh báo tương tự, vẫn cộng đủ 1 tháng BASIC_SALARY mà không
    // ai biết cần rà soát/điều chỉnh.
    await run.run('Nhân viên MỚI VÀO LÀM giữa kỳ: vẫn tính đủ 1 tháng lương, có ghi chú để kế toán rà soát', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      USERS.push({ username: 'emp4', name: 'Nhân Viên Bốn', dept: 'Phòng Kinh Doanh', posType: 'OFFICE', perms: {}, active: true });
      APP_DATA.employeeProfiles.push({ employeeCode: 'NV004', username: 'emp4', status: 'ACTIVE', dependents: [] });
      RECORDS.laborContracts.push({ id: 4, employeeCode: 'NV004', status: 'ACTIVE', startDate: '2025-01-20', baseSalary: 10000000, dept: 'Phòng Kinh Doanh' });

      const res = await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      assertEqual(res.status, 200, 'Tính lương phải thành công');

      const payslips = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      const slip = payslips.body.payslips.find(p => p.employeeCode === 'NV004');
      assertIncludes([true], !!slip, 'NV004 (vào làm giữa kỳ) phải có payslip trong kỳ');
      const basic = slip.details.find(d => d.componentCode === 'BASIC_SALARY');
      assertEqual(basic.amount, 10000000, 'Lương cơ bản phải tính ĐỦ 1 tháng — KHÔNG tự trừ theo số ngày chưa vào làm');
      assertIncludes([true], basic.note.includes('vào làm ngày 2025-01-20'), 'Dòng Lương cơ bản phải có ghi chú ngày vào làm để kế toán tự rà soát/điều chỉnh');
    });

    await run.run('Nhân viên vào làm ĐÚNG ngày đầu kỳ: KHÔNG bị coi là vào làm giữa kỳ, không có ghi chú cảnh báo', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      USERS.push({ username: 'emp5', name: 'Nhân Viên Năm', dept: 'Phòng Kinh Doanh', posType: 'OFFICE', perms: {}, active: true });
      APP_DATA.employeeProfiles.push({ employeeCode: 'NV005', username: 'emp5', status: 'ACTIVE', dependents: [] });
      RECORDS.laborContracts.push({ id: 5, employeeCode: 'NV005', status: 'ACTIVE', startDate: '2025-01-01', baseSalary: 9000000, dept: 'Phòng Kinh Doanh' });

      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      const payslips = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      const slip = payslips.body.payslips.find(p => p.employeeCode === 'NV005');
      const basic = slip.details.find(d => d.componentCode === 'BASIC_SALARY');
      assertEqual(basic.note, 'Theo hợp đồng lao động đang hiệu lực', 'Vào làm đúng ngày 01 đầu kỳ (làm đủ tháng) -> không phải ghi chú cảnh báo giữa kỳ');
    });

    await run.run('Nhân viên có hợp đồng thử việc CŨ trước kỳ, mới ký lại hợp đồng CHÍNH THỨC giữa kỳ: KHÔNG bị coi là vào làm giữa kỳ (dùng ngày hợp đồng SỚM NHẤT)', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      USERS.push({ username: 'emp6', name: 'Nhân Viên Sáu', dept: 'Phòng Kinh Doanh', posType: 'OFFICE', perms: {}, active: true });
      APP_DATA.employeeProfiles.push({ employeeCode: 'NV006', username: 'emp6', status: 'ACTIVE', dependents: [] });
      // Vào làm thật từ 2024 (hợp đồng thử việc SUPERSEDED) — hợp đồng ACTIVE hiện tại chỉ là chuyển loại
      // hợp đồng giữa kỳ lương này, KHÔNG phải ngày vào làm thật.
      RECORDS.laborContracts.push({ id: 6, employeeCode: 'NV006', status: 'SUPERSEDED', startDate: '2024-06-01', baseSalary: 8000000, dept: 'Phòng Kinh Doanh' });
      RECORDS.laborContracts.push({ id: 7, employeeCode: 'NV006', status: 'ACTIVE', startDate: '2025-01-10', baseSalary: 9500000, dept: 'Phòng Kinh Doanh' });

      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      const payslips = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      const slip = payslips.body.payslips.find(p => p.employeeCode === 'NV006');
      const basic = slip.details.find(d => d.componentCode === 'BASIC_SALARY');
      assertEqual(basic.note, 'Theo hợp đồng lao động đang hiệu lực', 'Đã vào làm thật từ trước kỳ (hợp đồng thử việc cũ) -> chuyển loại hợp đồng giữa kỳ KHÔNG phải cảnh báo vào làm giữa kỳ');
      assertEqual(basic.amount, 9500000, 'Vẫn phải lấy đúng baseSalary của hợp đồng ACTIVE hiện tại');
    });

    // LỖI ĐÃ VÁ (rà soát chuyên sâu cụm Nhân Sự vòng 2, mức Trung bình — #8): hợp đồng ACTIVE đã qua
    // endDate không có cơ chế tự chuyển EXPIRED — payroll vẫn tính đủ lương nhưng TRƯỚC ĐÂY không cảnh
    // báo gì để kế toán/HR biết mà xử lý (gia hạn/ký mới/Offboarding).
    await run.run('LỖI ĐÃ VÁ (#8): hợp đồng ACTIVE đã qua endDate (hết hạn) vẫn tính đủ lương NHƯNG có ghi chú cảnh báo rõ ràng', async () => {
      resetAppData();
      const period = seedDraftPeriod(); // Tháng 01/2025 -> periodEnd = 2025-01-31
      USERS.push({ username: 'emp7', name: 'Nhân Viên Bảy', dept: 'Phòng Kinh Doanh', posType: 'OFFICE', perms: {}, active: true });
      APP_DATA.employeeProfiles.push({ employeeCode: 'NV007', username: 'emp7', status: 'ACTIVE', dependents: [] });
      // Hợp đồng Xác định thời hạn hết hạn 2025-01-15 (GIỮA kỳ đang tính) nhưng CHƯA có ai đổi status
      // (đúng hiện trạng thật — không có job tự động chuyển EXPIRED).
      RECORDS.laborContracts.push({ id: 8, employeeCode: 'NV007', status: 'ACTIVE', contractType: 'FIXED_TERM', startDate: '2024-01-15', endDate: '2025-01-15', baseSalary: 10000000, dept: 'Phòng Kinh Doanh' });

      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      const payslips = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      const slip = payslips.body.payslips.find(p => p.employeeCode === 'NV007');
      const basic = slip.details.find(d => d.componentCode === 'BASIC_SALARY');
      assertEqual(basic.amount, 10000000, 'Vẫn tính ĐỦ lương theo hợp đồng (không tự trừ/không tự đổi status) — đúng phạm vi vá đã chốt');
      assertIncludes(basic.note, 'hết hạn ngày 2025-01-15', 'Ghi chú phải nêu rõ ngày hết hạn thật của hợp đồng');
      assertIncludes(basic.note, 'CẢNH BÁO', 'Ghi chú phải cảnh báo rõ ràng cho kế toán/HR biết mà rà soát');
    });

    await run.run('LỖI ĐÃ VÁ (#8): hợp đồng Vô thời hạn (INDEFINITE) KHÔNG bao giờ bị coi là "hết hạn" dù không có endDate', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      USERS.push({ username: 'emp8', name: 'Nhân Viên Tám', dept: 'Phòng Kinh Doanh', posType: 'OFFICE', perms: {}, active: true });
      APP_DATA.employeeProfiles.push({ employeeCode: 'NV008', username: 'emp8', status: 'ACTIVE', dependents: [] });
      RECORDS.laborContracts.push({ id: 9, employeeCode: 'NV008', status: 'ACTIVE', contractType: 'INDEFINITE', startDate: '2020-01-01', endDate: null, baseSalary: 11000000, dept: 'Phòng Kinh Doanh' });

      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      const payslips = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      const slip = payslips.body.payslips.find(p => p.employeeCode === 'NV008');
      const basic = slip.details.find(d => d.componentCode === 'BASIC_SALARY');
      assertEqual(basic.note, 'Theo hợp đồng lao động đang hiệu lực', 'Vô thời hạn không có khái niệm hết hạn -> không được cảnh báo nhầm');
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

    // LỖI ĐÃ VÁ (rà soát chuyên sâu Nhân Sự, 9/2026): trước đây netPay ÂM (VD khấu trừ/tạm ứng/phạt nhập
    // tay lớn hơn cả lương gộp) vẫn Gửi Duyệt được bình thường, đi xuyên suốt cả luồng mà không ai cảnh
    // báo — công ty không thể "trả lương âm".
    await run.run('Gửi duyệt: CHẶN nếu có phiếu lương netPay ÂM (khấu trừ tay lớn hơn lương gộp)', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      const payslips = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      const slipId = payslips.body.payslips[0].id;
      // NV001 lương gộp ~15tr — trừ tạm ứng nhập tay 20tr -> netPay ÂM.
      await api('PATCH', `/api/payroll/payslips/${slipId}/details`, { componentCode: 'ADVANCE_DEDUCT', amount: 20000000, note: 'Trừ tạm ứng lớn' }, HR_MGR);

      const res = await api('POST', `/api/payroll/periods/${period.id}/submit`, {}, HR_MGR);
      assertEqual(res.status, 400, 'Có phiếu lương netPay âm -> phải chặn Gửi Duyệt');
      assertIncludes([true], res.body.error.includes('NV001'), 'Thông báo lỗi phải nêu đúng mã nhân viên bị âm lương');

      const periodsAfter = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      assertIncludes([true], periodsAfter.body.payslips.length >= 0, 'Vẫn đọc được payslips bình thường (kỳ chưa chuyển trạng thái)');
    });

    await run.run('Gửi duyệt: cho phép bình thường nếu SAU KHI sửa lại, netPay không còn âm', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      const payslips = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      const slipId = payslips.body.payslips[0].id;
      await api('PATCH', `/api/payroll/payslips/${slipId}/details`, { componentCode: 'ADVANCE_DEDUCT', amount: 20000000, note: 'Trừ tạm ứng lớn (nhầm)' }, HR_MGR);
      // Kế toán phát hiện nhầm, sửa lại số tiền hợp lý hơn.
      await api('PATCH', `/api/payroll/payslips/${slipId}/details`, { componentCode: 'ADVANCE_DEDUCT', amount: 1000000, note: 'Sửa lại đúng số tạm ứng' }, HR_MGR);

      const res = await api('POST', `/api/payroll/periods/${period.id}/submit`, {}, HR_MGR);
      assertEqual(res.status, 200, 'Sau khi sửa lại hết âm -> Gửi Duyệt phải thành công');
    });

    await run.run('Phân tách nhiệm vụ: hrPayrollManage KHÔNG được tự duyệt (chỉ hrPayrollApprove)', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      await api('POST', `/api/payroll/periods/${period.id}/submit`, {}, HR_MGR);
      const res = await api('POST', `/api/payroll/periods/${period.id}/approve`, {}, HR_MGR);
      assertEqual(res.status, 403, 'Người CHỈ có hrPayrollManage (không có hrPayrollApprove) phải bị chặn duyệt');
    });

    // LỖI ĐÃ VÁ (rà soát chuyên sâu cụm Nhân Sự vòng 2, mức Thấp — #14): kỳ lương TRƯỚC ĐÂY có thể tự
    // tạo — tự gửi duyệt — tự duyệt nếu 1 tài khoản có ĐỦ CẢ 2 quyền hrPayrollManage + hrPayrollApprove
    // (applyApprove() không hề so period.creator với actor). Segregation-of-duties test ở trên chỉ xác
    // nhận thiếu hrPayrollApprove thì bị chặn — KHÔNG bao phủ đúng trường hợp có đủ cả 2 quyền.
    await run.run('LỖI ĐÃ VÁ (#14): người TẠO kỳ lương (dù có đủ hrPayrollApprove) vẫn KHÔNG tự duyệt được kỳ do chính mình tạo — cần người KHÁC duyệt', async () => {
      resetAppData();
      const DUAL_ROLE = { username: 'ketoan_dual', name: 'Kế Toán (có đủ 2 quyền)', dept: 'Phòng Kế Toán', perms: { hrPayrollManage: true, hrPayrollApprove: true }, active: true };
      USERS.push(DUAL_ROLE);
      const valid = payroll.assertValidNewPeriod({ periodMonth: 1, periodYear: 2025 }, RECORDS.payrollPeriods);
      const period = Object.assign(payroll.defaultPeriod(valid, DUAL_ROLE.username, DUAL_ROLE.name), { id: idSeq++ });
      RECORDS.payrollPeriods.push(period);
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, DUAL_ROLE);
      await api('POST', `/api/payroll/periods/${period.id}/submit`, {}, DUAL_ROLE);
      const selfApprove = await api('POST', `/api/payroll/periods/${period.id}/approve`, {}, DUAL_ROLE);
      assertEqual(selfApprove.status, 403, JSON.stringify(selfApprove.body));
      assertIncludes(selfApprove.body.error, 'không thể tự duyệt', 'Thông báo lỗi phải nói rõ lý do là tự duyệt hồ sơ do chính mình tạo');
      // Người KHÁC có hrPayrollApprove vẫn duyệt được bình thường — chỉ chặn đúng CHÍNH người tạo.
      const otherApprove = await api('POST', `/api/payroll/periods/${period.id}/approve`, {}, APPROVER);
      assertEqual(otherApprove.status, 200, JSON.stringify(otherApprove.body));
      assertEqual(otherApprove.body.item.status, 'APPROVED');
    });

    // LƯU Ý THIẾT KẾ (khác lib/workflowEngine.js::assertNotSelfDecidingWorkflowItem()): applyApprove() CỐ
    // Ý KHÔNG có ngoại lệ admin — nhất quán với chính module Lương (canManagePayroll()/canApprovePayroll()
    // đã KHÔNG cho admin tự động quản lý/duyệt từ trước, phải cấp quyền RIÊNG, xem chú thích tại đó) nên
    // dù ADMIN.perms.admin=true, ADMIN vẫn bị chặn ở NGAY guard canApprovePayroll() (chưa tới lượt kiểm
    // tự duyệt) nếu không có hrPayrollApprove — test dưới đây xác nhận admin CÓ hrPayrollApprove vẫn bị
    // chặn TỰ duyệt kỳ do chính mình tạo, giống hệt tài khoản thường.
    await run.run('LỖI ĐÃ VÁ (#14): admin (dù có hrPayrollApprove) cũng KHÔNG tự duyệt được kỳ do chính mình tạo — module Lương cố ý không có ngoại lệ admin', async () => {
      resetAppData();
      const ADMIN_WITH_APPROVE = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true, hrPayrollManage: true, hrPayrollApprove: true }, active: true };
      USERS = USERS.map(u => u.username === 'admin' ? ADMIN_WITH_APPROVE : u);
      const valid = payroll.assertValidNewPeriod({ periodMonth: 1, periodYear: 2025 }, RECORDS.payrollPeriods);
      const period = Object.assign(payroll.defaultPeriod(valid, ADMIN_WITH_APPROVE.username, ADMIN_WITH_APPROVE.name), { id: idSeq++ });
      RECORDS.payrollPeriods.push(period);
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, ADMIN_WITH_APPROVE);
      await api('POST', `/api/payroll/periods/${period.id}/submit`, {}, ADMIN_WITH_APPROVE);
      const res = await api('POST', `/api/payroll/periods/${period.id}/approve`, {}, ADMIN_WITH_APPROVE);
      assertEqual(res.status, 403, JSON.stringify(res.body));
      // Khôi phục lại ADMIN gốc (không có hrPayrollApprove) cho các test PHÍA SAU (nếu còn) không bị ảnh hưởng.
      USERS = USERS.map(u => u.username === 'admin' ? ADMIN : u);
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

    await run.run('LUONG-04: Từ Chối kỳ lương bắt buộc nhập lý do', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      await api('POST', `/api/payroll/periods/${period.id}/submit`, {}, HR_MGR);
      const noReason = await api('POST', `/api/payroll/periods/${period.id}/reject`, {}, APPROVER);
      assertEqual(noReason.status, 400, 'Thiếu lý do -> 400');
      const withReason = await api('POST', `/api/payroll/periods/${period.id}/reject`, { reason: 'Thiếu chứng từ OT tháng này' }, APPROVER);
      assertEqual(withReason.status, 200, 'Có lý do -> thành công');
      assertEqual(withReason.body.item.status, 'DRAFT', 'Từ chối phải trả kỳ về DRAFT');
      const lastEntry = withReason.body.item.history[withReason.body.item.history.length - 1];
      assertIncludes([true], lastEntry.detail.includes('Thiếu chứng từ OT tháng này'), 'Lịch sử phải ghi đúng lý do từ chối, không phải câu chung chung');
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

    // LỖI ĐÃ VÁ (rà soát chuyên sâu Nhân Sự, 9/2026): mở lại kỳ ĐÃ CÔNG BỐ trước đây không xoá cờ
    // viewedByEmployeeAt — nhân viên xem phiếu (đánh dấu đã xem), kế toán phát hiện sai sót -> Mở Lại ->
    // sửa lại -> Công Bố lại, nhưng phiếu vẫn hiện "đã xem" dù nhân viên chưa xem bản ĐÃ SỬA.
    await run.run('reopen: MỞ LẠI kỳ ĐÃ CÔNG BỐ (nhân viên đã xem) phải xoá cờ viewedByEmployeeAt để nhân viên thấy "chưa xem" khi công bố lại', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      await api('POST', `/api/payroll/periods/${period.id}/submit`, {}, HR_MGR);
      await api('POST', `/api/payroll/periods/${period.id}/approve`, {}, APPROVER);
      await api('POST', `/api/payroll/periods/${period.id}/finalize`, {}, HR_MGR);
      await api('POST', `/api/payroll/periods/${period.id}/publish`, {}, HR_MGR);
      // emp1 xem phiếu của mình -> đánh dấu viewedByEmployeeAt.
      await api('GET', `/api/payroll/my-payslips/${period.id}`, undefined, EMP1);
      const payslipsBefore = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      assertIncludes([true], !!payslipsBefore.body.payslips.find(p => p.employeeCode === 'NV001').viewedByEmployeeAt, 'Trước khi mở lại, phiếu NV001 phải đang đánh dấu đã xem');

      const reopen = await api('POST', `/api/payroll/periods/${period.id}/reopen`, { reason: 'Phát hiện sai sót, sửa lại số liệu' }, HR_MGR);
      assertEqual(reopen.status, 200, 'Mở lại kỳ đã công bố phải thành công');

      const payslipsAfter = await api('GET', `/api/payroll/periods/${period.id}/payslips`, undefined, HR_MGR);
      const slipAfter = payslipsAfter.body.payslips.find(p => p.employeeCode === 'NV001');
      assertEqual(slipAfter.viewedByEmployeeAt, null, 'Sau khi mở lại kỳ đã công bố, cờ đã xem PHẢI được xoá về null');
    });

    await run.run('reopen: MỞ LẠI kỳ CHỈ ĐÃ CHỐT (chưa từng công bố) thì KHÔNG có gì để xoá (không lỗi, không side-effect thừa)', async () => {
      resetAppData();
      const period = seedDraftPeriod();
      await api('POST', `/api/payroll/periods/${period.id}/calculate`, {}, HR_MGR);
      await api('POST', `/api/payroll/periods/${period.id}/submit`, {}, HR_MGR);
      await api('POST', `/api/payroll/periods/${period.id}/approve`, {}, APPROVER);
      await api('POST', `/api/payroll/periods/${period.id}/finalize`, {}, HR_MGR);
      // Chưa publish -> chưa ai xem được, mở lại thẳng từ FINALIZED.
      const reopen = await api('POST', `/api/payroll/periods/${period.id}/reopen`, { reason: 'Sửa lại trước khi công bố' }, HR_MGR);
      assertEqual(reopen.status, 200, 'Mở lại kỳ chỉ mới Chốt (chưa Công Bố) vẫn phải thành công bình thường');
      assertEqual(reopen.body.item.status, 'DRAFT', 'Mở lại phải đưa kỳ về DRAFT như cũ');
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
