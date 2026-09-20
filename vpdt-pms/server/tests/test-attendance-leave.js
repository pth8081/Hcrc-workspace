// server/tests/test-attendance-leave.js
//
// Test hồi quy cho module "Công & Phép" (Đợt 3/4 module Nhân Sự, Phần E tài liệu thiết kế gốc). 2 phần:
//   A) Gọi TRỰC TIẾP lib/attendance.js (thuần, không cần HTTP) — resolveWorkModelForEmployeeCode, chấm
//      công qua máy (applyClockPunch), phép năm (computeAnnualLeaveDays/computeLeavePayoutInfo/đơn nghỉ
//      phép), lịch phân ca + đổi ca.
//   B) Dựng 1 Express app THẬT mount routes/create.js + routes/records.js, lib/recordStore.js THẬT
//      nhưng thay getPool()/db bằng in-memory (mirror ĐÚNG khuôn tests/test-labor-contract.js) — xác
//      nhận API tạo/duyệt/huỷ qua đúng đường HTTP, đúng quyền hrAttendanceManage/hrLeaveApprove/
//      hrShiftRosterManage/hrShiftSwapApprove.
//
// Chạy: node server/tests/test-attendance-leave.js
'use strict';

const assert = require('assert');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

// ===================== Phần A: lib/attendance.js (thuần) =====================
async function partA() {
  console.log('\n== Phần A: lib/attendance.js (thuần) ==');
  const attendance = require('../lib/attendance');

  await test('resolveWorkModelForEmployeeCode() qua tài khoản đã liên kết (posType STORE -> SHIFT_BASED)', () => {
    const employeeProfiles = [{ employeeCode: 'NV1', username: 'u1', status: 'ACTIVE' }];
    const users = [{ username: 'u1', posType: 'STORE', dept: 'Siêu Thị A' }];
    const info = attendance.resolveWorkModelForEmployeeCode('NV1', { employeeProfiles, users, hrProcesses: [] });
    assert.strictEqual(info.workModel, 'SHIFT_BASED');
    assert.strictEqual(info.dept, 'Siêu Thị A');
  });

  await test('resolveWorkModelForEmployeeCode() posType HO -> OFFICE_HOURS', () => {
    const employeeProfiles = [{ employeeCode: 'NV2', username: 'u2', status: 'ACTIVE' }];
    const users = [{ username: 'u2', posType: 'HO', dept: 'Kinh Doanh' }];
    const info = attendance.resolveWorkModelForEmployeeCode('NV2', { employeeProfiles, users, hrProcesses: [] });
    assert.strictEqual(info.workModel, 'OFFICE_HOURS');
  });

  await test('resolveWorkModelForEmployeeCode() dự phòng qua hrProcesses khi chưa liên kết tài khoản', () => {
    const employeeProfiles = [{ employeeCode: 'NV3', username: null, processId: 55, status: 'DRAFT' }];
    const hrProcesses = [{ id: 55, employeePosType: 'STORE', employeeDept: 'Siêu Thị B' }];
    const info = attendance.resolveWorkModelForEmployeeCode('NV3', { employeeProfiles, users: [], hrProcesses });
    assert.strictEqual(info.workModel, 'SHIFT_BASED');
    assert.strictEqual(info.dept, 'Siêu Thị B');
  });

  await test('resolveWorkModelForEmployeeCode() trả null nếu không tìm thấy hồ sơ/không xác định được', () => {
    assert.strictEqual(attendance.resolveWorkModelForEmployeeCode('NV_KHONG_CO', { employeeProfiles: [], users: [], hrProcesses: [] }), null);
  });

  await test('applyClockPunch() lượt quẹt đầu tiên -> checkIn=checkOut, lượt sau cập nhật checkOut', () => {
    const workModelInfo = { workModel: 'OFFICE_HOURS', dept: 'Kinh Doanh' };
    const appData = { attendanceHoConfig: { startTime: '08:00', endTime: '17:00', lateGraceMinutes: 0 }, publicHolidays: [] };
    const { record: r1, isNew } = attendance.applyClockPunch([], 'NV1', '2026-03-02T01:00:00.000Z', workModelInfo, appData);
    assert.strictEqual(isNew, true);
    assert.strictEqual(r1.checkInTime, r1.checkOutTime);
    const { record: r2 } = attendance.applyClockPunch([r2Seed(r1)], 'NV1', '2026-03-02T09:30:00.000Z', workModelInfo, appData);
    assert.notStrictEqual(r2.checkInTime, r2.checkOutTime);
    function r2Seed(rec) { return Object.assign({ id: 1 }, rec); }
  });

  await test('applyClockPunch() OFFICE_HOURS đánh dấu isLate khi quẹt sau giờ vào + trễ cho phép', () => {
    const workModelInfo = { workModel: 'OFFICE_HOURS' };
    const appData = { attendanceHoConfig: { startTime: '08:00', endTime: '17:00', lateGraceMinutes: 5 }, publicHolidays: [] };
    // 08:20 UTC giờ máy chủ = giả lập giờ VN bằng cách dùng đúng field .getHours() nội bộ (server chạy
    // theo giờ hệ thống) — test chỉ cần xác nhận CHECK-IN muộn hơn startTime+grace bị đánh dấu isLate,
    // dùng mốc giờ trong ngày rõ ràng vượt xa 08:05 để không phụ thuộc múi giờ máy chạy test.
    const late = new Date(); late.setHours(23, 0, 0, 0);
    const { record } = attendance.applyClockPunch([], 'NV1', late.toISOString(), workModelInfo, appData);
    assert.strictEqual(record.isLate, true);
  });

  await test('applyClockPunch() giữ nguyên recordType đã có (LEAVE_PAID) khi máy chấm công lỡ quẹt', () => {
    const existing = { id: 9, employeeCode: 'NV1', workDate: '2026-03-02', recordType: 'LEAVE_PAID', note: null };
    const { record, isNew } = attendance.applyClockPunch([existing], 'NV1', '2026-03-02T02:00:00.000Z', { workModel: 'OFFICE_HOURS' }, {});
    assert.strictEqual(isNew, false);
    assert.strictEqual(record.recordType, 'LEAVE_PAID', 'Không được đổi loại bản ghi nghỉ phép thành WORK');
    assert(record.note.includes('quẹt máy chấm công'));
  });

  // LỖI ĐÃ VÁ (rà soát chuyên sâu cụm Nhân Sự vòng 2, mức Cao — #5): workDate TRƯỚC ĐÂY lấy qua
  // ts.toISOString().slice(0,10) (LUÔN UTC) — trên máy chủ chạy giờ VN (UTC+7), mọi lượt quẹt từ
  // 00:00-06:59 giờ VN bị gán nhầm sang workDate của NGÀY HÔM TRƯỚC. Ép process.env.TZ='Asia/Ho_Chi_Minh'
  // để mô phỏng đúng máy chủ thật (môi trường chạy test mặc định là UTC nên không tự lộ lỗi này) — Node
  // đọc lại TZ cho mỗi Date mới tạo nên đổi giữa chừng vẫn có tác dụng ngay (đã xác nhận thực nghiệm).
  await test('LỖI ĐÃ VÁ (#5): applyClockPunch() quẹt 06:30 giờ VN (local) cho workDate ĐÚNG NGÀY ĐÓ, không rơi sang hôm trước', () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = 'Asia/Ho_Chi_Minh';
    try {
      const workModelInfo = { workModel: 'OFFICE_HOURS' };
      const appData = { attendanceHoConfig: { startTime: '08:00', endTime: '17:00', lateGraceMinutes: 0 }, publicHolidays: [] };
      // 2026-03-02T06:30:00+07:00 = giờ VN 06:30 sáng Thứ 2 (2026-03-02) — quy đổi UTC là 2026-03-01T23:30:00Z
      // (dùng offset tường minh +07:00 trong chuỗi ISO thay vì phụ thuộc TZ để dựng đúng input, TZ chỉ chi
      // phối cách applyClockPunch() ĐỌC LẠI "ngày local" từ mốc thời gian tuyệt đối này).
      const { record } = attendance.applyClockPunch([], 'NV1', '2026-03-02T06:30:00+07:00', workModelInfo, appData);
      assert.strictEqual(record.workDate, '2026-03-02', 'Quẹt 06:30 giờ VN phải tính công cho ĐÚNG ngày 02/03, không phải 01/03 (lỗi UTC cũ)');
    } finally {
      process.env.TZ = originalTZ;
    }
  });

  await test('LỖI ĐÃ VÁ (#5): localDateStr()/listDatesInRange() dùng giờ LOCAL, không lệch ngày khi máy chủ chạy giờ VN', () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = 'Asia/Ho_Chi_Minh';
    try {
      const d = new Date('2026-03-02T00:30:00+07:00'); // 00:30 sáng giờ VN — vẫn ngày 02/03 theo giờ VN
      assert.strictEqual(attendance.localDateStr(d), '2026-03-02');
      const dates = attendance.listDatesInRange('2026-03-02', '2026-03-03');
      assert.deepStrictEqual(dates, ['2026-03-02', '2026-03-03'], 'Không được lệch lùi 1 ngày (lỗi toISOString() cũ)');
    } finally {
      process.env.TZ = originalTZ;
    }
  });

  await test('computeAnnualLeaveDays() đủ 12 ngày (+thâm niên) nếu vào làm từ đầu năm trở về trước', () => {
    const days = attendance.computeAnnualLeaveDays('2020-01-01', 2026);
    assert(days >= 12, `Kỳ vọng >= 12, được ${days}`);
  });

  await test('computeAnnualLeaveDays() pro-rate theo tháng còn lại nếu vào làm giữa năm', () => {
    const days = attendance.computeAnnualLeaveDays('2026-07-01', 2026);
    assert(days < 12 && days > 0, `Kỳ vọng pro-rate 0<x<12, được ${days}`);
  });

  await test('computeLeavePayoutInfo() chia 22 cho OFFICE_HOURS, 26 cho SHIFT_BASED', () => {
    const ho = attendance.computeLeavePayoutInfo(22000000, 5, 'OFFICE_HOURS');
    assert.strictEqual(ho.dailyRate, 1000000);
    assert.strictEqual(ho.amount, 5000000);
    const store = attendance.computeLeavePayoutInfo(26000000, 5, 'SHIFT_BASED');
    assert.strictEqual(store.dailyRate, 1000000);
  });

  await test('computeLeavePayoutInfo() trả 0 nếu không còn ngày phép/không có lương', () => {
    assert.strictEqual(attendance.computeLeavePayoutInfo(20000000, 0, 'OFFICE_HOURS').amount, 0);
    assert.strictEqual(attendance.computeLeavePayoutInfo(null, 5, 'OFFICE_HOURS').amount, 0);
  });

  await test('assertValidLeaveRequest() chặn ngày kết thúc trước ngày bắt đầu + chặn quá 90 ngày', () => {
    assert.throws(() => attendance.assertValidLeaveRequest({ leaveType: 'ANNUAL', fromDate: '2026-03-10', toDate: '2026-03-01' }), /sau hoặc bằng/);
    assert.throws(() => attendance.assertValidLeaveRequest({ leaveType: 'ANNUAL', fromDate: '2026-01-01', toDate: '2026-12-31' }), /quá 90 ngày/);
  });

  await test('assertValidLeaveRequest() tính đúng daysCount bao gồm cả 2 đầu mút', () => {
    const v = attendance.assertValidLeaveRequest({ leaveType: 'SICK', fromDate: '2026-03-02', toDate: '2026-03-04' });
    assert.strictEqual(v.daysCount, 3, 'SICK vẫn đếm theo ngày lịch (ngoài phạm vi LỖI ĐÃ VÁ #3, xem chú thích tại countLeaveDaysExcludingRestDays())');
  });

  // LỖI ĐÃ VÁ (rà soát chuyên sâu cụm Nhân Sự vòng 2, mức Cao — #3): daysCount của ANNUAL/UNPAID TRƯỚC
  // ĐÂY đếm cả Thứ 7/CN/ngày lễ — đơn Thứ Sáu (06/03) -> Thứ Hai (09/03, 4 ngày LỊCH) bị trừ đủ 4 ngày dù
  // chỉ có 2 ngày làm việc thật (06/03 T6 + 09/03 T2, loại 07-08/03 T7-CN).
  await test('LỖI ĐÃ VÁ (#3): ANNUAL Thứ Sáu->Thứ Hai chỉ trừ 2 ngày làm việc (không phải 4 ngày lịch)', () => {
    const v = attendance.assertValidLeaveRequest({ leaveType: 'ANNUAL', fromDate: '2026-03-06', toDate: '2026-03-09' });
    assert.strictEqual(v.daysCount, 2, 'Phải loại đúng Thứ 7 (07/03) + Chủ Nhật (08/03), chỉ còn 06/03 (T6) + 09/03 (T2)');
  });

  await test('LỖI ĐÃ VÁ (#3): UNPAID cũng loại Thứ 7/CN giống ANNUAL; SICK/PERSONAL giữ nguyên đếm theo ngày lịch (ngoài phạm vi vá)', () => {
    const vUnpaid = attendance.assertValidLeaveRequest({ leaveType: 'UNPAID', fromDate: '2026-03-06', toDate: '2026-03-09' });
    assert.strictEqual(vUnpaid.daysCount, 2, 'UNPAID cùng công thức loại Thứ 7/CN như ANNUAL');
    const vPersonal = attendance.assertValidLeaveRequest({ leaveType: 'PERSONAL', fromDate: '2026-03-06', toDate: '2026-03-09' });
    assert.strictEqual(vPersonal.daysCount, 4, 'PERSONAL KHÔNG nằm trong phạm vi vá #3 — vẫn đếm theo ngày lịch như trước');
  });

  await test('LỖI ĐÃ VÁ (#3): ANNUAL/UNPAID loại thêm publicHolidays đã cấu hình, không chỉ Thứ 7/CN', () => {
    const holidays = [{ date: '2026-03-09', name: 'Nghỉ lễ test' }]; // 09/03 vốn là Thứ 2 (ngày làm việc) -> nếu là ngày lễ thì cũng phải loại
    const v = attendance.assertValidLeaveRequest({ leaveType: 'ANNUAL', fromDate: '2026-03-06', toDate: '2026-03-09' }, { publicHolidays: holidays });
    assert.strictEqual(v.daysCount, 1, 'Loại cả Thứ 7 (07/03) + CN (08/03) + ngày lễ cấu hình (09/03) -> chỉ còn 06/03');
  });

  await test('LỖI ĐÃ VÁ (#3): buildLeaveAttendanceRecords() KHÔNG sinh bản ghi LEAVE_UNPAID/LEAVE_PAID cho Thứ 7/CN (payroll đếm thẳng số bản ghi để trừ lương)', () => {
    const request = { employeeCode: 'NV1', leaveType: 'UNPAID', fromDate: '2026-03-06', toDate: '2026-03-09', workModel: 'OFFICE_HOURS' };
    const results = attendance.buildLeaveAttendanceRecords(request, []);
    assert.strictEqual(results.length, 2, 'Chỉ sinh 2 bản ghi (06/03 + 09/03), KHÔNG sinh cho 07-08/03 (T7-CN)');
    assert.deepStrictEqual(results.map(r => r.record.workDate).sort(), ['2026-03-06', '2026-03-09']);
    assert.ok(results.every(r => r.record.recordType === 'LEAVE_UNPAID'));
  });

  await test('canApproveLeaveRequest() admin/hrAttendanceManage luôn true, không cần isManagerOf', () => {
    assert.strictEqual(attendance.canApproveLeaveRequest({ perms: { admin: true } }, [], 'u1'), true);
    assert.strictEqual(attendance.canApproveLeaveRequest({ perms: { hrAttendanceManage: true } }, [], 'u1'), true);
  });

  await test('canApproveLeaveRequest() hrLeaveApprove CHỈ true khi thực sự là quản lý trực tiếp (transitive)', () => {
    const users = [
      { username: 'staff', managerUsername: 'lead' },
      { username: 'lead', managerUsername: 'mgr' }
    ];
    const mgr = { username: 'mgr', perms: { hrLeaveApprove: true } };
    assert.strictEqual(attendance.canApproveLeaveRequest(mgr, users, 'staff'), true, 'mgr là cấp trên gián tiếp của staff qua lead');
    const stranger = { username: 'stranger', perms: { hrLeaveApprove: true } };
    assert.strictEqual(attendance.canApproveLeaveRequest(stranger, users, 'staff'), false);
  });

  await test('canApproveLeaveRequest() có hrLeaveApprove nhưng KHÔNG phải quản lý -> false', () => {
    const approver = { username: 'someone', perms: { hrLeaveApprove: true } };
    assert.strictEqual(attendance.canApproveLeaveRequest(approver, [], 'emp'), false);
  });

  await test('applyApproveLeaveRequest() chuyển PENDING -> APPROVED, tính affectedRosterIds cho SHIFT_BASED', () => {
    const request = { employeeCode: 'NV1', workModel: 'SHIFT_BASED', status: 'PENDING', fromDate: '2026-03-02', toDate: '2026-03-03' };
    const roster = [
      { id: 1, employeeCode: 'NV1', workDate: '2026-03-02', status: 'SCHEDULED' },
      { id: 2, employeeCode: 'NV1', workDate: '2026-03-05', status: 'SCHEDULED' } // ngoài khoảng nghỉ
    ];
    const { updated, affectedRosterIds } = attendance.applyApproveLeaveRequest(request, 'mgr', 'Manager', roster);
    assert.strictEqual(updated.status, 'APPROVED');
    assert.deepStrictEqual(affectedRosterIds, [1]);
  });

  await test('applyApproveLeaveRequest() chặn nếu đơn không còn PENDING', () => {
    assert.throws(() => attendance.applyApproveLeaveRequest({ status: 'REJECTED' }, 'mgr', 'Manager', []), /không còn ở trạng thái chờ duyệt/);
  });

  await test('buildLeaveAttendanceRecords() sinh đúng số dòng LEAVE_PAID cho khoảng nghỉ, bỏ qua ngày đã có nghỉ khác', () => {
    const request = { employeeCode: 'NV1', leaveType: 'ANNUAL', fromDate: '2026-03-02', toDate: '2026-03-03', workModel: 'OFFICE_HOURS' };
    const existing = [{ id: 7, employeeCode: 'NV1', workDate: '2026-03-03', recordType: 'SICK_LEAVE' }];
    const results = attendance.buildLeaveAttendanceRecords(request, existing);
    assert.strictEqual(results.length, 1, 'Ngày 03-03 đã có SICK_LEAVE, không được ghi đè');
    assert.strictEqual(results[0].record.workDate, '2026-03-02');
    assert.strictEqual(results[0].record.recordType, 'LEAVE_PAID');
    assert.strictEqual(results[0].isNew, true);
  });

  await test('LỖI ĐÃ VÁ (đợt 3, 9/2026): buildLeaveCancelAttendanceReverts() dọn ĐÚNG bản ghi do đơn này tạo về WORK rỗng, bỏ qua bản ghi KHÔNG khớp chữ ký note', () => {
    const request = { employeeCode: 'NV1', leaveType: 'ANNUAL', fromDate: '2026-03-02', toDate: '2026-03-03' };
    const existing = [
      { id: 10, employeeCode: 'NV1', workDate: '2026-03-02', recordType: 'LEAVE_PAID', note: 'Nghỉ phép theo đơn đã duyệt (2026-03-02 → 2026-03-03)' },
      { id: 11, employeeCode: 'NV1', workDate: '2026-03-03', recordType: 'LEAVE_PAID', note: 'Nghỉ phép theo đơn đã duyệt (2026-03-02 → 2026-03-03)' },
      { id: 12, employeeCode: 'NV1', workDate: '2026-03-04', recordType: 'SICK_LEAVE', note: 'Ghi chú của 1 đơn nghỉ phép KHÁC hoàn toàn' }
    ];
    const reverts = attendance.buildLeaveCancelAttendanceReverts(request, existing);
    assert.strictEqual(reverts.length, 2, 'Chỉ 2 bản ghi 03-02/03-03 khớp đúng chữ ký note của đơn này');
    assert.ok(reverts.every(r => r.recordType === 'WORK' && r.checkInTime === null && r.hoursWorked === null));
    assert.ok(!reverts.some(r => r.id === 12), 'Không được đụng vào bản ghi của đơn KHÁC (id 12)');
  });

  await test('refundLeaveBalance() trừ ngược usedDays, không cho âm', () => {
    assert.strictEqual(attendance.refundLeaveBalance({ usedDays: 5 }, 2).usedDays, 3);
    assert.strictEqual(attendance.refundLeaveBalance({ usedDays: 1 }, 5).usedDays, 0, 'Không được âm dù hoàn nhiều hơn đã dùng');
  });

  await test('deductLeaveBalance() cộng dồn usedDays', () => {
    // totalDays đủ chỗ cho cả 2 lượt cộng — LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 9/2026): hàm này giờ CHẶN
    // nếu usedDays sau khi cộng vượt totalDays (xem test riêng "chặn vượt quỹ phép" bên dưới), nên fixture
    // ở đây cần đủ hạn mức thay vì bỏ trống totalDays như trước.
    const updated = attendance.deductLeaveBalance({ usedDays: 2, totalDays: 10 }, 3);
    assert.strictEqual(updated.usedDays, 5);
  });

  await test('deductLeaveBalance() CHẶN nếu duyệt tiếp sẽ vượt quá quỹ phép còn lại (LỖI ĐÃ VÁ 9/2026)', () => {
    assert.throws(() => attendance.deductLeaveBalance({ usedDays: 8, totalDays: 10 }, 8), /vượt quá quỹ phép/);
    assert.doesNotThrow(() => attendance.deductLeaveBalance({ usedDays: 8, totalDays: 10 }, 2));
  });

  await test('assertNoRosterConflict() chặn phân ca trùng ngày cho cùng nhân viên', () => {
    const list = [{ employeeCode: 'NV1', workDate: '2026-03-02', status: 'SCHEDULED', id: 1 }];
    assert.throws(() => attendance.assertNoRosterConflict(list, 'NV1', '2026-03-02', null), /đã có lịch phân ca/);
    assert.doesNotThrow(() => attendance.assertNoRosterConflict(list, 'NV2', '2026-03-02', null));
  });

  await test('applyApproveShiftSwap() gán lại employeeCode của dòng roster, đánh dấu SWAPPED', () => {
    const swapRequest = { requesterEmployeeCode: 'NV1', targetEmployeeCode: 'NV2', status: 'PENDING' };
    const roster = { id: 1, employeeCode: 'NV1', workDate: '2026-03-02', status: 'SCHEDULED' };
    const { updatedSwap, updatedRoster } = attendance.applyApproveShiftSwap(swapRequest, roster, [roster], 'mgr', 'Manager');
    assert.strictEqual(updatedSwap.status, 'APPROVED');
    assert.strictEqual(updatedRoster.employeeCode, 'NV2');
    assert.strictEqual(updatedRoster.status, 'SWAPPED');
  });

  await test('applyApproveShiftSwap() chặn nếu roster đã bị huỷ', () => {
    const swapRequest = { requesterEmployeeCode: 'NV1', targetEmployeeCode: 'NV2', status: 'PENDING' };
    assert.throws(() => attendance.applyApproveShiftSwap(swapRequest, { status: 'CANCELLED' }, [], 'mgr', 'Manager'), /đã bị huỷ/);
  });

  // LỖI ĐÃ VÁ (rà soát chuyên sâu Nhân Sự, 9/2026): duyệt đổi ca trước đây KHÔNG kiểm tra người NHẬN ca
  // (targetEmployeeCode) có đang trùng lịch phân ca ngày đó không — có thể tạo ra 2 ca chồng nhau cho
  // cùng 1 người mà không ai biết.
  await test('applyApproveShiftSwap() CHẶN nếu người nhận ca (targetEmployeeCode) đã có lịch phân ca khác trùng đúng ngày đó', () => {
    const swapRequest = { requesterEmployeeCode: 'NV1', targetEmployeeCode: 'NV2', status: 'PENDING' };
    const roster = { id: 1, employeeCode: 'NV1', workDate: '2026-03-02', status: 'SCHEDULED' };
    // NV2 (người nhận ca) đã độc lập có 1 dòng roster KHÁC trùng đúng ngày 2026-03-02.
    const nv2ConflictingRoster = { id: 99, employeeCode: 'NV2', workDate: '2026-03-02', status: 'SCHEDULED' };
    assert.throws(
      () => attendance.applyApproveShiftSwap(swapRequest, roster, [roster, nv2ConflictingRoster], 'mgr', 'Manager'),
      /đã có lịch phân ca/,
      'phải chặn duyệt đổi ca vì người nhận ca sẽ bị trùng lịch 2 ca cùng ngày'
    );
  });

  await test('applyApproveShiftSwap() vẫn duyệt được bình thường nếu người nhận ca chỉ trùng ca đã CANCELLED (không tính là xung đột)', () => {
    const swapRequest = { requesterEmployeeCode: 'NV1', targetEmployeeCode: 'NV2', status: 'PENDING' };
    const roster = { id: 1, employeeCode: 'NV1', workDate: '2026-03-02', status: 'SCHEDULED' };
    const nv2CancelledRoster = { id: 99, employeeCode: 'NV2', workDate: '2026-03-02', status: 'CANCELLED' };
    const { updatedRoster } = attendance.applyApproveShiftSwap(swapRequest, roster, [roster, nv2CancelledRoster], 'mgr', 'Manager');
    assert.strictEqual(updatedRoster.employeeCode, 'NV2', 'ca CANCELLED không tính là xung đột, vẫn duyệt đổi ca bình thường');
  });

  await test('cancelFutureRosterAfterOffboarding() chỉ huỷ ca TƯƠNG LAI (sau lastWorkingDate)', () => {
    const roster = [
      { id: 1, employeeCode: 'NV1', workDate: '2026-03-01', status: 'SCHEDULED' },
      { id: 2, employeeCode: 'NV1', workDate: '2026-03-10', status: 'SCHEDULED' }
    ];
    const updated = attendance.cancelFutureRosterAfterOffboarding(roster, 'NV1', '2026-03-05');
    assert.strictEqual(updated.find(r => r.id === 1).status, 'SCHEDULED', 'Ca trong quá khứ/trước ngày nghỉ việc giữ nguyên');
    assert.strictEqual(updated.find(r => r.id === 2).status, 'CANCELLED');
  });
}

// ===================== Phần B: HTTP thật qua routes/create.js + routes/records.js =====================
async function partB() {
  console.log('\n== Phần B: HTTP thật (Express + recordStore in-memory) ==');
  const path = require('path');
  const express = require('express');
  const http = require('http');

  // payrollPeriods (rà soát chuyên sâu cụm Nhân Sự vòng 2, mức Trung bình — #6): 3 đường ghi
  // attendanceRecords ở routes/records.js/lib/createValidation.js giờ đều gọi
  // findLockedPayrollPeriodForDate()/findLockedPayrollPeriodInRange() (lib/payroll.js), cần đọc
  // collection payrollPeriods — thêm vào STORE để mock getAllForCollection('payrollPeriods') không vỡ.
  const STORE = { attendanceRecords: [], leaveBalances: [], leaveRequests: [], shiftRoster: [], shiftSwapRequests: [], hrProcesses: [], payrollPeriods: [] };
  let nextId = 1;
  function stubModule(relPath, exportsObj) {
    const full = require.resolve(path.join(__dirname, '..', relPath));
    require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
    return exportsObj;
  }
  stubModule('lib/recordStore', {
    MIGRATED_COLLECTIONS: new Set(Object.keys(STORE)),
    getAllForCollection: async (c) => STORE[c].slice(),
    getAllForCollectionCached: async (c) => STORE[c].slice(),
    getTrashItems: async () => [],
    withAppLock: async (key, fn) => fn(),
    createForCollection: async (c, builderFn) => {
      const draft = await builderFn(STORE[c].slice());
      const item = Object.assign({ id: nextId++ }, draft);
      STORE[c].push(item);
      return item;
    },
    withLockedRecordForCollection: async (c, id, mutatorFn) => {
      const idx = STORE[c].findIndex(x => x.id === Number(id));
      if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
      const result = await mutatorFn(STORE[c][idx]);
      STORE[c][idx] = result;
      return result;
    },
    deleteRecordForCollection: async (c, id, checkFn) => {
      const idx = STORE[c].findIndex(x => x.id === Number(id));
      if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
      if (checkFn) checkFn(STORE[c][idx]);
      STORE[c].splice(idx, 1);
    }
  });

  const EMPLOYEE_PROFILES = [
    { employeeCode: 'NV1', username: 'staff1', status: 'ACTIVE' }, // OFFICE_HOURS (posType HO)
    { employeeCode: 'NV2', username: 'store1', status: 'ACTIVE' }  // SHIFT_BASED (posType STORE)
  ];
  const USERS = [
    { username: 'hr1', name: 'Nhân Sự Một', dept: 'Nhân Sự', posType: 'HO', perms: { hrAttendanceManage: true }, active: true },
    { username: 'staff1', name: 'Nhân Viên Văn Phòng', dept: 'Kinh Doanh', posType: 'HO', managerUsername: 'mgr1', perms: {}, active: true },
    { username: 'mgr1', name: 'Trưởng Phòng', dept: 'Kinh Doanh', posType: 'HO', perms: { hrLeaveApprove: true }, active: true },
    { username: 'store1', name: 'Nhân Viên Siêu Thị', dept: 'Siêu Thị A', posType: 'STORE', perms: {}, active: true },
    { username: 'storeMgr1', name: 'Quản Lý Siêu Thị A', dept: 'Siêu Thị A', posType: 'STORE', perms: { hrShiftRosterManage: true, hrShiftSwapApprove: true }, active: true },
    { username: 'storeMgrB', name: 'Quản Lý Siêu Thị B', dept: 'Siêu Thị B', posType: 'STORE', perms: { hrShiftRosterManage: true, hrShiftSwapApprove: true }, active: true },
    { username: 'admin', name: 'Quản Trị Viên', dept: 'Nhân Sự', perms: { admin: true }, active: true }
  ];
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const username = req.headers['x-demo-user'];
      const fresh = USERS.find(u => u.username === username);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      req.allUsers = USERS;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  const APP_DATA = { users: USERS, employeeProfiles: EMPLOYEE_PROFILES, depts: ['Nhân Sự', 'Kinh Doanh'], stores: ['Siêu Thị A', 'Siêu Thị B'], shiftTemplates: [], publicHolidays: [], attendanceHoConfig: {} };
  stubModule('lib/appData', {
    getAppDataValue: async (key) => (APP_DATA[key] !== undefined ? APP_DATA[key] : null),
    getAllAppData: async () => Object.assign({}, APP_DATA),
    withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
  });

  const createRoutes = require('../routes/create');
  const recordRoutes = require('../routes/records');
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  app.use('/api/records', recordRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, method, urlPath, body) {
    const res = await fetch(`${base}${urlPath}`, {
      method, headers: Object.assign({ 'x-demo-user': username }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  try {
    // Ngày công tay dùng đây CỐ Ý tách khỏi khoảng nghỉ phép (2026-03-02 -> 2026-03-03) dùng ở các test
    // approve leaveRequests bên dưới — buildLeaveAttendanceRecords() ghi ĐÈ mọi bản ghi WORK trong đúng
    // khoảng ngày nghỉ đã duyệt (đúng thiết kế), nên nếu trùng ngày, bản ghi WORK tạo ở đây sẽ biến thành
    // LEAVE_PAID trước khi tới lượt test edit/delete phía dưới dùng lại đúng id này.
    let attendanceRecordId;
    await test('POST /api/create/attendanceRecords — HR bổ sung bản ghi công tay (happy path)', async () => {
      const r = await call('hr1', 'POST', '/api/create/attendanceRecords', {
        employeeCode: 'NV1', workDate: '2026-01-15', recordTypeInput: 'WORK',
        checkInTimeInput: '2026-01-15T01:00:00.000Z', checkOutTimeInput: '2026-01-15T09:00:00.000Z'
      });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.employeeCode, 'NV1');
      assert(r.json.item.hoursWorked > 0);
      attendanceRecordId = r.json.item.id;
    });

    await test('POST /api/create/attendanceRecords — người không có hrAttendanceManage bị chặn 403', async () => {
      const r = await call('staff1', 'POST', '/api/create/attendanceRecords', { employeeCode: 'NV1', workDate: '2026-01-16', recordTypeInput: 'WORK' });
      assert.strictEqual(r.status, 403);
    });

    await test('POST /api/create/attendanceRecords — trùng ngày đã có bản ghi bị chặn 409', async () => {
      const r = await call('hr1', 'POST', '/api/create/attendanceRecords', { employeeCode: 'NV1', workDate: '2026-01-15', recordTypeInput: 'WORK' });
      assert.strictEqual(r.status, 409);
    });

    let leaveBalanceId;
    await test('POST /api/create/leaveBalances — HR tạo bảng phép năm cho NV1', async () => {
      const r = await call('hr1', 'POST', '/api/create/leaveBalances', { employeeCode: 'NV1', year: 2026, totalDays: 12 });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      leaveBalanceId = r.json.item.id;
    });

    await test('POST /api/create/leaveBalances — trùng năm bị chặn 409', async () => {
      const r = await call('hr1', 'POST', '/api/create/leaveBalances', { employeeCode: 'NV1', year: 2026, totalDays: 12 });
      assert.strictEqual(r.status, 409);
    });

    let leaveRequestId;
    await test('POST /api/create/leaveRequests — nhân viên tự nộp đơn phép năm trong hạn mức', async () => {
      const r = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'ANNUAL', fromDate: '2026-03-02', toDate: '2026-03-03', reason: 'Việc gia đình' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.employeeCode, 'NV1', 'employeeCode phải tự suy ra từ tài khoản đăng nhập, không nhận từ payload');
      assert.strictEqual(r.json.item.status, 'PENDING');
      leaveRequestId = r.json.item.id;
    });

    await test('POST /api/create/leaveRequests — vượt quá số ngày phép còn lại bị chặn 400', async () => {
      const r = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'ANNUAL', fromDate: '2026-04-01', toDate: '2026-04-20', reason: 'x' });
      assert.strictEqual(r.status, 400);
    });

    // LỖI ĐÃ VÁ (rà soát chuyên sâu cụm Nhân Sự vòng 2, mức Thấp — #15): đơn vắt qua năm dương lịch bị
    // chặn 400 vì toàn bộ số ngày trừ vào quỹ phép năm của fromDate — không có bảng phép năm 2098 nào
    // được tạo (remaining=0) nên chắc chắn bị chặn dù không liên quan tới quỹ phép NĂM SAU (2099).
    await test('LỖI ĐÃ VÁ (#15): đơn ANNUAL vắt qua năm dương lịch bị chặn 400 (không đủ quỹ) -> thông báo lỗi gợi ý tách đơn theo năm', async () => {
      const r = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'ANNUAL', fromDate: '2098-12-29', toDate: '2099-01-02', reason: 'x' });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert(r.json.error.includes('VẮT QUA NĂM DƯƠNG LỊCH'), `Thông báo lỗi phải nêu rõ đơn vắt qua năm, thực tế: ${r.json.error}`);
      assert(r.json.error.includes('tách thành 2 đơn'), `Thông báo lỗi phải gợi ý tách đơn theo năm, thực tế: ${r.json.error}`);
    });

    await test('LỖI ĐÃ VÁ (#15): đơn ANNUAL KHÔNG vắt qua năm (cùng năm) bị chặn 400 vẫn giữ thông báo CŨ, không có gợi ý tách đơn thừa', async () => {
      const r = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'ANNUAL', fromDate: '2098-03-02', toDate: '2098-03-03', reason: 'x' });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert(!r.json.error.includes('VẮT QUA NĂM DƯƠNG LỊCH'), `Đơn cùng năm không được chèn nhầm gợi ý tách năm, thực tế: ${r.json.error}`);
    });

    await test('POST /api/create/leaveRequests — trùng khoảng ngày với đơn PENDING khác bị chặn 409', async () => {
      const r = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'SICK', fromDate: '2026-03-03', toDate: '2026-03-03', reason: 'x' });
      assert.strictEqual(r.status, 409);
    });

    // v15.9 — 2 loại nghỉ mới: HOURLY (nghỉ theo giờ, daysCount phân số) + PERSONAL (nghỉ việc riêng,
    // tách khỏi UNPAID trên báo cáo).
    await test('POST /api/create/leaveRequests — HOURLY tính đúng daysCount phân số theo giờ', async () => {
      const r = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'HOURLY', fromDate: '2026-03-10', startTime: '08:00', endTime: '10:00', reason: 'Đi khám bệnh' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.daysCount, 0.25, 'Chuẩn 8 giờ/ngày, nghỉ 2 giờ = 0.25 ngày');
      assert.strictEqual(r.json.item.fromDate, r.json.item.toDate, 'HOURLY chỉ đúng 1 ngày');
    });

    await test('POST /api/create/leaveRequests — HOURLY quá số giờ chuẩn/ngày bị chặn 400', async () => {
      const r = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'HOURLY', fromDate: '2026-03-11', startTime: '08:00', endTime: '18:00', reason: 'x' });
      assert.strictEqual(r.status, 400);
    });

    // LỖI ĐÃ VÁ (rà soát chuyên sâu cụm Nhân Sự vòng 2, mức Thấp — #13): so trùng khoảng nghỉ TRƯỚC ĐÂY
    // chỉ so fromDate/toDate — 2 đơn HOURLY CÙNG 1 NGÀY (2026-03-10, đã có đơn sáng 08:00-10:00 ở test
    // phía trên) nhưng khung giờ KHÔNG chồng lấn thật (chiều 14:00-16:00) vẫn bị chặn nhầm 409.
    await test('LỖI ĐÃ VÁ (#13): 2 đơn HOURLY CÙNG 1 ngày nhưng khung giờ KHÔNG chồng lấn (sáng/chiều) -> KHÔNG bị chặn nhầm', async () => {
      const r = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'HOURLY', fromDate: '2026-03-10', startTime: '14:00', endTime: '16:00', reason: 'Việc riêng buổi chiều' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    });

    await test('LỖI ĐÃ VÁ (#13): 2 đơn HOURLY CÙNG 1 ngày với khung giờ THẬT SỰ chồng lấn vẫn bị chặn 409 (không nới lỏng quá tay)', async () => {
      // Đơn sáng 08:00-10:00 đã có sẵn ở test trên (cùng ngày 2026-03-10) — nộp thêm 09:00-11:00 (chồng
      // lấn 09:00-10:00) phải vẫn bị chặn.
      const r = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'HOURLY', fromDate: '2026-03-10', startTime: '09:00', endTime: '11:00', reason: 'x' });
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
    });

    await test('POST /api/create/leaveRequests — PERSONAL (nghỉ việc riêng) tạo được, KHÔNG bị tính vào phép năm', async () => {
      const balanceBefore = STORE.leaveBalances.find(b => b.id === leaveBalanceId).usedDays;
      const r = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'PERSONAL', fromDate: '2026-03-20', toDate: '2026-03-20', reason: 'Việc gia đình' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(STORE.leaveBalances.find(b => b.id === leaveBalanceId).usedDays, balanceBefore, 'PERSONAL không trừ phép năm lúc tạo (chỉ ANNUAL mới trừ)');
    });

    await test('POST /api/records/leaveRequests/:id/approve — người KHÔNG phải quản lý trực tiếp bị chặn 403', async () => {
      const r = await call('storeMgr1', 'POST', `/api/records/leaveRequests/${leaveRequestId}/approve`, {});
      assert.strictEqual(r.status, 403);
    });

    await test('POST /api/records/leaveRequests/:id/approve — quản lý trực tiếp duyệt thành công, trừ phép năm', async () => {
      const r = await call('mgr1', 'POST', `/api/records/leaveRequests/${leaveRequestId}/approve`, {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.status, 'APPROVED');
      const balance = STORE.leaveBalances.find(b => b.id === leaveBalanceId);
      assert.strictEqual(balance.usedDays, 2, 'Phải trừ đúng 2 ngày (02-03 đến 03-03)');
      const attRecords = STORE.attendanceRecords.filter(r => r.employeeCode === 'NV1' && r.recordType === 'LEAVE_PAID');
      assert.strictEqual(attRecords.length, 2, 'Phải sinh 2 bản ghi công LEAVE_PAID cho 2 ngày nghỉ');
    });

    // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 9/2026, theo phản hồi người dùng): 2 đơn KHÔNG trùng ngày đều hợp
    // lệ RIÊNG LẺ lúc tạo (usedDays=2/12 tại thời điểm tạo cả 2), nhưng duyệt CẢ 2 thì vượt quỹ phép
    // (2+6+6=14 > 12) — TRƯỚC ĐÂY không hề bị chặn ở bước duyệt thứ 2, âm thầm ghi usedDays=14.
    let overQuotaLeaveId1, overQuotaLeaveId2;
    // LỖI ĐÃ VÁ (rà soát chuyên sâu cụm Nhân Sự vòng 2, mức Cao): daysCount của ANNUAL/UNPAID giờ loại
    // trừ Thứ 7/CN (xem countLeaveDaysExcludingRestDays() ở lib/attendance.js) — 2 khoảng ngày dưới đây
    // ĐÃ ĐỔI từ 06-01→06-06/07-01→07-06 (6 ngày LỊCH, có dính Thứ 7) sang 06-01→06-08/07-01→07-08 (6 ngày
    // LÀM VIỆC thật — Mon-Fri + Mon tuần sau, tính bằng node script) để giữ nguyên đúng "6 ngày" như thiết
    // kế test gốc, không đổi ý nghĩa của kịch bản vượt quỹ phép bên dưới.
    await test('POST /api/create/leaveRequests — 2 đơn 6 ngày làm việc không trùng ngày, đều hợp lệ RIÊNG LẺ lúc tạo (còn 10/12 ngày)', async () => {
      const r1 = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'ANNUAL', fromDate: '2026-06-01', toDate: '2026-06-08', reason: 'Đơn 1' });
      assert.strictEqual(r1.status, 200, JSON.stringify(r1.json));
      assert.strictEqual(r1.json.item.daysCount, 6, 'Loại 2 ngày cuối tuần (06-06/06-07) khỏi 8 ngày lịch -> đúng 6 ngày làm việc');
      overQuotaLeaveId1 = r1.json.item.id;
      const r2 = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'ANNUAL', fromDate: '2026-07-01', toDate: '2026-07-08', reason: 'Đơn 2' });
      assert.strictEqual(r2.status, 200, JSON.stringify(r2.json));
      assert.strictEqual(r2.json.item.daysCount, 6, 'Loại 2 ngày cuối tuần (07-04/07-05) khỏi 8 ngày lịch -> đúng 6 ngày làm việc');
      overQuotaLeaveId2 = r2.json.item.id;
    });
    await test('POST /api/records/leaveRequests/:id/approve — duyệt đơn 1 (6 ngày) thành công, usedDays 2 -> 8', async () => {
      const r = await call('mgr1', 'POST', `/api/records/leaveRequests/${overQuotaLeaveId1}/approve`, {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(STORE.leaveBalances.find(b => b.id === leaveBalanceId).usedDays, 8);
    });
    await test('POST /api/records/leaveRequests/:id/approve — duyệt đơn 2 (6 ngày) BỊ CHẶN vì sẽ vượt quỹ phép (8+6=14 > 12)', async () => {
      const r = await call('mgr1', 'POST', `/api/records/leaveRequests/${overQuotaLeaveId2}/approve`, {});
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
      assert.strictEqual(STORE.leaveBalances.find(b => b.id === leaveBalanceId).usedDays, 8, 'usedDays KHÔNG được đổi khi đơn 2 bị chặn');
      const req2 = STORE.leaveRequests.find(x => x.id === overQuotaLeaveId2);
      assert.strictEqual(req2.status, 'PENDING', 'Đơn 2 phải GIỮ NGUYÊN PENDING (chưa hề bị đổi sang APPROVED) vì bị chặn TRƯỚC khi cập nhật trạng thái');
    });

    let cancelableLeaveId;
    await test('POST /api/create/leaveRequests (đơn khác) + tự huỷ đơn của chính mình', async () => {
      const create = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'UNPAID', fromDate: '2026-05-01', toDate: '2026-05-01', reason: 'x' });
      assert.strictEqual(create.status, 200, JSON.stringify(create.json));
      cancelableLeaveId = create.json.item.id;
      const cancel = await call('staff1', 'POST', `/api/records/leaveRequests/${cancelableLeaveId}/cancel`, {});
      assert.strictEqual(cancel.status, 200, JSON.stringify(cancel.json));
      assert.strictEqual(cancel.json.item.status, 'CANCELLED');
    });

    await test('POST /api/records/leaveRequests/:id/cancel — không được huỷ đơn của người khác', async () => {
      // Ngày 2026-08-03 (Thứ 2 — dùng ngày làm việc thật, tránh daysCount=0 sau lỗi đã vá #3 ở
      // lib/attendance.js): CỐ Ý không trùng đơn 1 (2026-06-01→08) đã được duyệt ở trên — từ đợt rà soát
      // chuyên sâu cụm Nhân Sự 10/2026, kiểm tra chồng lấn khi nộp đơn xét CẢ đơn ĐÃ DUYỆT (trước đây
      // chỉ xét PENDING), nên ngày cũ (2026-06-01) nay bị chặn 409 đúng như thiết kế.
      const create = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'UNPAID', fromDate: '2026-08-03', toDate: '2026-08-03', reason: 'x' });
      assert.strictEqual(create.status, 200, JSON.stringify(create.json));
      const r = await call('mgr1', 'POST', `/api/records/leaveRequests/${create.json.item.id}/cancel`, {});
      assert.strictEqual(r.status, 403);
    });

    // LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 3, 9/2026): huỷ 1 đơn ANNUAL ĐÃ DUYỆT (ngày nghỉ chưa tới) trước
    // đây chỉ đổi status='CANCELLED', không hoàn quỹ phép/dọn AttendanceRecords LEAVE_PAID đã sinh — NV
    // mất vĩnh viễn 2 ngày phép "xin rồi huỷ" dù chưa hề nghỉ. Dùng năm 2099 (bảng phép năm riêng) để
    // chắc chắn ngày nghỉ "chưa tới" bất kể thời điểm CHẠY test là khi nào. 12/13-01-2099 CỐ Ý là Thứ 2/Thứ
    // 3 (2 ngày LÀM VIỆC liên tiếp) — sau LỖI ĐÃ VÁ #3 (daysCount loại Thứ 7/CN), dùng ngày cuối tuần ở đây
    // sẽ làm daysCount=0 và bị chặn tạo đơn.
    let approvedThenCancelledLeaveId, futureBalanceId;
    await test('POST /api/create/leaveBalances — HR tạo bảng phép năm 2099 cho NV1 (để test huỷ đơn đã duyệt)', async () => {
      const r = await call('hr1', 'POST', '/api/create/leaveBalances', { employeeCode: 'NV1', year: 2099, totalDays: 12 });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      futureBalanceId = r.json.item.id;
    });
    await test('POST /api/create/leaveRequests + approve — đơn ANNUAL 2 ngày trong tương lai xa (2099)', async () => {
      const create = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'ANNUAL', fromDate: '2099-01-12', toDate: '2099-01-13', reason: 'Test huỷ sau duyệt' });
      assert.strictEqual(create.status, 200, JSON.stringify(create.json));
      approvedThenCancelledLeaveId = create.json.item.id;
      const approve = await call('mgr1', 'POST', `/api/records/leaveRequests/${approvedThenCancelledLeaveId}/approve`, {});
      assert.strictEqual(approve.status, 200, JSON.stringify(approve.json));
      assert.strictEqual(STORE.leaveBalances.find(b => b.id === futureBalanceId).usedDays, 2);
      const attRecords = STORE.attendanceRecords.filter(r => r.employeeCode === 'NV1' && r.workDate >= '2099-01-12' && r.workDate <= '2099-01-13');
      assert.strictEqual(attRecords.length, 2);
      assert.ok(attRecords.every(r => r.recordType === 'LEAVE_PAID'));
    });
    await test('POST /api/records/leaveRequests/:id/cancel — huỷ đơn ĐÃ DUYỆT: hoàn quỹ phép + dọn AttendanceRecords về WORK', async () => {
      const cancel = await call('staff1', 'POST', `/api/records/leaveRequests/${approvedThenCancelledLeaveId}/cancel`, {});
      assert.strictEqual(cancel.status, 200, JSON.stringify(cancel.json));
      assert.strictEqual(cancel.json.item.status, 'CANCELLED');
      assert.strictEqual(STORE.leaveBalances.find(b => b.id === futureBalanceId).usedDays, 0, 'Phải hoàn lại đúng 2 ngày (2 -> 0)');
      const attRecords = STORE.attendanceRecords.filter(r => r.employeeCode === 'NV1' && r.workDate >= '2099-01-12' && r.workDate <= '2099-01-13');
      assert.strictEqual(attRecords.length, 2);
      assert.ok(attRecords.every(r => r.recordType === 'WORK' && r.checkInTime === null), 'Phải dọn về WORK rỗng, không còn ghi "nghỉ phép có lương"');
    });

    let rosterId;
    await test('POST /api/create/shiftRoster — Quản Lý Siêu Thị A phân ca cho NV2', async () => {
      // shiftTemplateId chỉ cần là số hợp lệ (assertValidRosterAssignment không tra cứu shiftTemplates
      // lúc TẠO, chỉ applyClockPunch mới cần tra đúng mẫu ca — xem lib/attendance.js).
      const r = await call('storeMgr1', 'POST', '/api/create/shiftRoster', { employeeCode: 'NV2', workDate: '2026-03-05', shiftTemplateId: 1, storeCode: 'Siêu Thị A' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      rosterId = r.json.item.id;
    });

    await test('POST /api/create/shiftRoster — trùng ngày cho cùng nhân viên bị chặn 409', async () => {
      const r = await call('storeMgr1', 'POST', '/api/create/shiftRoster', { employeeCode: 'NV2', workDate: '2026-03-05', shiftTemplateId: 1, storeCode: 'Siêu Thị A' });
      assert.strictEqual(r.status, 409);
    });

    await test('POST /api/records/shiftRoster/:id/cancel — Quản Lý Siêu Thị B (khác siêu thị) bị chặn 403', async () => {
      const r = await call('storeMgrB', 'POST', `/api/records/shiftRoster/${rosterId}/cancel`, {});
      assert.strictEqual(r.status, 403);
    });

    let swapRequestId;
    await test('POST /api/create/shiftSwapRequests — NV2 xin đổi ca cho NV1 (khác mô hình chấm công vẫn cho phép ở tầng validate)', async () => {
      const r = await call('store1', 'POST', '/api/create/shiftSwapRequests', { requesterRosterId: rosterId, targetEmployeeCode: 'NV1', reason: 'Bận việc gia đình' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.status, 'PENDING');
      swapRequestId = r.json.item.id;
    });

    await test('POST /api/records/shiftSwapRequests/:id/approve — Quản Lý Siêu Thị B (khác siêu thị) bị chặn 403', async () => {
      const r = await call('storeMgrB', 'POST', `/api/records/shiftSwapRequests/${swapRequestId}/approve`, {});
      assert.strictEqual(r.status, 403);
    });

    await test('POST /api/records/shiftSwapRequests/:id/approve — Quản Lý Siêu Thị A duyệt, roster đổi employeeCode + SWAPPED', async () => {
      const r = await call('storeMgr1', 'POST', `/api/records/shiftSwapRequests/${swapRequestId}/approve`, {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const roster = STORE.shiftRoster.find(x => x.id === rosterId);
      assert.strictEqual(roster.employeeCode, 'NV1');
      assert.strictEqual(roster.status, 'SWAPPED');
    });

    await test('POST /api/records/attendanceRecords/:id/edit — HR sửa bản ghi công', async () => {
      const r = await call('hr1', 'POST', `/api/records/attendanceRecords/${attendanceRecordId}/edit`, { note: 'Đã kiểm tra lại' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert(r.json.item.note.includes('Đã kiểm tra lại'));
    });

    await test('POST /api/records/attendanceRecords/:id/delete — chỉ admin mới xoá được', async () => {
      const r1 = await call('hr1', 'POST', `/api/records/attendanceRecords/${attendanceRecordId}/delete`, {});
      assert.strictEqual(r1.status, 403, 'HR (không phải admin) không được xoá');
      const r2 = await call('admin', 'POST', `/api/records/attendanceRecords/${attendanceRecordId}/delete`, {});
      assert.strictEqual(r2.status, 200, JSON.stringify(r2.json));
    });

    // ===================== LỖI ĐÃ VÁ (rà soát chuyên sâu cụm Nhân Sự vòng 2, mức Trung bình — #6) =====
    // Kỳ lương đã Chốt/Công bố TRƯỚC ĐÂY chỉ chặn được ở API máy chấm công vật lý (routes/attendanceClockPunch.js)
    // — 3 đường ghi attendanceRecords khác trong CHÍNH APP (tạo công tay/duyệt đơn nghỉ/sửa tay) hoàn
    // toàn không kiểm. Khoá Tháng 02/2026 (FINALIZED) rồi xác nhận CẢ 3 đường đều bị chặn 409.
    await test('LỖI ĐÃ VÁ (#6): tạo công tay cho ngày thuộc kỳ lương đã CHỐT bị chặn 409', async () => {
      const r = await call('hr1', 'POST', '/api/create/attendanceRecords', { employeeCode: 'NV1', workDate: '2026-02-11', recordTypeInput: 'WORK' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json), 'Trước khi khoá kỳ lương, tạo công tay bình thường phải thành công');
      STORE.payrollPeriods.push({ id: 9001, periodYear: 2026, periodMonth: 2, periodName: 'Lương Tháng 02/2026', status: 'FINALIZED' });
      const r2 = await call('hr1', 'POST', '/api/create/attendanceRecords', { employeeCode: 'NV1', workDate: '2026-02-12', recordTypeInput: 'WORK' });
      assert.strictEqual(r2.status, 409, JSON.stringify(r2.json));
      assert(/CHỐT|khoá/.test(r2.json.error), `Thông báo lỗi phải nói rõ kỳ lương đã khoá, thực tế: ${r2.json.error}`);
    });

    await test('LỖI ĐÃ VÁ (#6): sửa tay 1 bản ghi công thuộc kỳ lương đã CHỐT bị chặn 409 (dùng lại bản ghi 2026-02-11 vừa tạo TRƯỚC khi khoá)', async () => {
      const lockedMonthRecordId = STORE.attendanceRecords.find(r => r.employeeCode === 'NV1' && r.workDate === '2026-02-11').id;
      const r = await call('hr1', 'POST', `/api/records/attendanceRecords/${lockedMonthRecordId}/edit`, { note: 'Thử sửa sau khi khoá' });
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
    });

    let lockedLeaveRequestId;
    await test('Chuẩn bị dữ liệu: nộp đơn ANNUAL cho khoảng ngày thuộc kỳ lương SẼ khoá (nộp đơn KHÔNG bị chặn — chỉ chặn lúc DUYỆT)', async () => {
      const r = await call('staff1', 'POST', '/api/create/leaveRequests', { leaveType: 'ANNUAL', fromDate: '2026-02-16', toDate: '2026-02-17', reason: 'Test kỳ lương khoá' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      lockedLeaveRequestId = r.json.item.id;
    });

    await test('LỖI ĐÃ VÁ (#6): duyệt đơn nghỉ rơi vào kỳ lương đã CHỐT bị chặn 409, KHÔNG chuyển APPROVED', async () => {
      const r = await call('mgr1', 'POST', `/api/records/leaveRequests/${lockedLeaveRequestId}/approve`, {});
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
      const req = STORE.leaveRequests.find(x => x.id === lockedLeaveRequestId);
      assert.strictEqual(req.status, 'PENDING', 'Đơn phải giữ nguyên PENDING, không được chuyển APPROVED khi bị chặn vì kỳ lương khoá');
    });
  } finally {
    server.close();
  }
}

async function main() {
  await partA();
  await partB();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
