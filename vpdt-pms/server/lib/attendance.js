// lib/attendance.js — Công & Phép (Attendance & Leave), Phần E của tài liệu thiết kế tổng thể module
// Nhân Sự — Đợt 3/4 (Hồ Sơ → Hợp Đồng Lao Động → Công & Phép → vá lại Phần A/B).
//
// ĐIỀU CHỈNH so với tài liệu gốc (thiết kế cho SQL Server chuẩn hoá dbo.AttendanceRecords/
// dbo.ShiftTemplates/dbo.ShiftRoster/dbo.ShiftSwapRequests/dbo.LeaveBalances/dbo.LeaveRequests) cho khớp
// kiến trúc hiện tại của app — đã xác nhận với người dùng:
//   1. 5 collection dùng dbo.Records (attendanceRecords/shiftRoster/shiftSwapRequests/leaveBalances/
//      leaveRequests, xem lib/recordStore.js MIGRATED_COLLECTIONS) — cùng khuôn laborContracts. Riêng
//      shiftTemplates/publicHolidays (danh mục nhỏ, admin cấu hình) + attendanceHoConfig (1 object cấu
//      hình duy nhất) là AppData thường (xem defaults.js), KHÔNG cần dbo.Records vì không tăng trưởng
//      theo thời gian.
//   2. KHÔNG thêm field `WorkModel`/`WorkLocationCode` vào OrgNodes (Cơ Cấu Tổ Chức, Phần A.2.3) như tài
//      liệu gốc đề xuất — phát hiện `user.posType` ('HO'/'STORE') + `user.dept` (tên phòng ban hoặc tên
//      siêu thị, xem #uPosType/onUserPosTypeChange() ở public/index.html) ĐÃ tồn tại sẵn và phục vụ ĐÚNG
//      mục đích "xác định mô hình theo vị trí" (Phần E.2) — dùng lại thay vì dựng thêm field trùng lặp.
//      resolveWorkModelForEmployee() dưới đây ưu tiên tra qua users (qua employeeProfile.username đã
//      liên kết); nếu CHƯA liên kết tài khoản (nhân viên rất mới, IT chưa kịp cấp), dự phòng tra ngược
//      lại chính hrProcesses (ONBOARDING) đã sinh ra hồ sơ này qua employeeProfile.processId — 2 field
//      employeePosType/employeeDept đã có sẵn ở đó từ lúc tạo quy trình Onboarding (xem
//      lib/createValidation.js hrProcesses.extraValidate).
//   3. Chấm công CHỈ đến từ máy chấm công vật lý đẩy dữ liệu qua API (POST /api/attendance/clock-punch,
//      xác thực bằng API key RIÊNG — attendanceClockApiKeys, tách khỏi externalApiKeys dùng cho tích hợp
//      xác thực tài khoản — để giảm phạm vi ảnh hưởng nếu 1 trong 2 loại key bị lộ) + HR sửa tay qua màn
//      Quản Lý khi cần điều chỉnh (KHÔNG có nút Check-in/Check-out thủ công trong app cho nhân viên tự
//      bấm — đã xác nhận với người dùng, giữ đúng 1 nguồn dữ liệu chính).
//   4. Đổi ca (ShiftSwapRequests): đơn giản hoá thành đổi 1 CHIỀU (gán lại `ShiftRoster.employeeCode`
//      của ĐÚNG dòng roster người xin đổi sang người nhận ca) thay vì đổi CHÉO 2 dòng như tài liệu gốc —
//      đủ dùng cho tình huống phổ biến nhất ("tôi xin nghỉ ca này, X nhận ca thay tôi") mà không cần
//      logic đổi chéo phức tạp hơn; nếu 2 người thật sự muốn hoán đổi ca cho nhau thì tạo 2 yêu cầu đổi
//      ca riêng (mỗi người xin đổi đúng ca của mình sang người kia).
//   5. Tính tiền phép năm chưa nghỉ lúc Offboarding (Phần E.6/E.8): CHỈ tính VÀ hiển thị số tiền tham
//      khảo (remainingDays x đơn giá ngày công) gắn vào task SETTLEMENT — KHÔNG tạo đề nghị thanh toán
//      thật (module Lương/Thanh Toán không có khái niệm "trả phép chưa nghỉ"), vì hệ thống hiện chưa có
//      module Lương. HR đọc số tham khảo này rồi tự xử lý ở hệ thống lương ngoài VPDT.
//   6. Task Onboarding "Xếp lịch ca tuần đầu" (bảng liên kết chéo Phần F) — KHÔNG tự động sinh dòng
//      ShiftRoster theo đúng 1 task checklist cụ thể như tài liệu gốc (hrTaskTemplates hiện KHÔNG có mục
//      nào tên chính xác này, tự thêm 1 mục mới vào danh mục checklist có rủi ro đụng độ dữ liệu
//      checklist đã tuỳ biến của HR ở các đợt trước) — lập lịch ca lần đầu là thao tác THỦ CÔNG của
//      Quản Lý Siêu Thị/HR ở màn "Lịch Phân Ca", độc lập với checklist Onboarding.
'use strict';

const { HttpError } = require('./httpErrors');
const { isManagerOf } = require('./recordViewScope');

function nowVN() {
  return new Date().toLocaleString('vi-VN');
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const WORK_MODELS = new Set(['OFFICE_HOURS', 'SHIFT_BASED']);
// v15.9 — thêm LEAVE_PERSONAL (đơn nghỉ việc riêng, TÁCH khỏi LEAVE_UNPAID để phân biệt lý do trên báo
// cáo dù cùng KHÔNG tính công) — HOURLY (nghỉ theo giờ) KHÔNG sinh bản ghi chấm công riêng (xem
// buildLeaveAttendanceRecords() bên dưới — mô hình chấm công hiện tại chỉ có độ chi tiết theo NGÀY, nghỉ
// vài giờ trong 1 ngày vẫn cần bản ghi WORK bình thường của ngày đó, chỉ trừ vào công theo giờ qua
// daysCount phân số, không đổi recordType).
const ATTENDANCE_RECORD_TYPES = new Set(['WORK', 'LEAVE_PAID', 'LEAVE_UNPAID', 'LEAVE_PERSONAL', 'BUSINESS_TRIP', 'OVERTIME', 'SICK_LEAVE']);
const LEAVE_TYPES = new Set(['ANNUAL', 'UNPAID', 'SICK', 'HOURLY', 'PERSONAL']);
const LEAVE_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']);
const ROSTER_STATUSES = new Set(['SCHEDULED', 'SWAPPED', 'CANCELLED']);
const SWAP_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED']);

// ===== Xác định mô hình chấm công áp dụng cho 1 nhân viên (Phần E.2) =====
// Trả về { workModel: 'OFFICE_HOURS'|'SHIFT_BASED', dept } hoặc null nếu không xác định được (chưa
// liên kết tài khoản VÀ không tìm lại được hrProcesses gốc — trường hợp hiếm, chặn ở nơi gọi).
function resolveWorkModelForEmployeeCode(employeeCode, { employeeProfiles, users, hrProcesses }) {
  const profile = (employeeProfiles || []).find(p => p.employeeCode === employeeCode);
  if (!profile) return null;
  // profile.status: DRAFT (Onboarding chưa hoàn tất, vẫn cho phép — nhánh dự phòng qua hrProcesses bên
  // dưới CHÍNH LÀ dành cho người mới chưa kịp liên kết tài khoản) / ACTIVE (đang làm việc) / ON_LEAVE
  // (nghỉ dài hạn) / INACTIVE (ĐÃ NGHỈ VIỆC, xem lib/employeeProfile.js tự đặt khi Offboarding hoàn
  // tất) — trước đây hàm này KHÔNG kiểm tra status, nên POST /api/attendance/clock-punch (máy chấm công
  // vật lý) vẫn ghi nhận công/lương bình thường cho nhân viên ĐÃ NGHỈ VIỆC nếu mã chấm công cũ chưa kịp
  // gỡ khỏi máy. Chỉ chặn đúng nhánh INACTIVE — DRAFT/ON_LEAVE không phải mục tiêu của lỗ hổng này.
  if (profile.status === 'INACTIVE') return null;
  if (profile.username) {
    const user = (users || []).find(u => u.username === profile.username);
    if (user) {
      return { workModel: user.posType === 'STORE' ? 'SHIFT_BASED' : 'OFFICE_HOURS', dept: user.dept || null, profile, user };
    }
  }
  if (profile.processId != null) {
    const proc = (hrProcesses || []).find(p => p.id === profile.processId);
    if (proc && proc.employeePosType) {
      return {
        workModel: proc.employeePosType === 'STORE' ? 'SHIFT_BASED' : 'OFFICE_HOURS',
        dept: proc.employeeDept || null, profile, user: null
      };
    }
  }
  return null;
}

// Tìm quy trình Offboarding ĐÃ HOÀN TẤT của 1 hồ sơ INACTIVE — nhánh dự phòng CÓ CHỦ ĐÍCH cho vài thao
// tác hợp lệ giới hạn trước lastWorkingDate (bổ sung công tay ngày trước khi nghỉ, tính lương prorate
// theo thời gian đã làm việc) — KHÔNG dùng để nới lỏng resolveWorkModelForEmployeeCode() mặc định ở
// trên (hàm đó vẫn PHẢI chặn hẳn INACTIVE cho máy chấm công/tạo công tay ngày SAU khi nghỉ, xem chú
// thích dòng 76). Trả về hrProcess (có employeePosType/employeeDept/lastWorkingDate) hoặc null.
function findCompletedOffboardingForProfile(profile, hrProcesses) {
  if (!profile || profile.status !== 'INACTIVE') return null;
  return (hrProcesses || []).find(p => p.processType === 'OFFBOARDING' && p.status === 'COMPLETED' &&
    p.employeeUsername === profile.username && p.lastWorkingDate) || null;
}

function isHolidayDate(dateStr, publicHolidays) {
  return (publicHolidays || []).some(h => h.date === dateStr);
}
function isWeekendDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay(); // 0=CN, 6=T7
  return day === 0 || day === 6;
}

function timeStrToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
function minutesOfDay(isoTimestamp) {
  const d = new Date(isoTimestamp);
  return d.getHours() * 60 + d.getMinutes();
}

// ===== Chấm công =====

function defaultAttendanceRecord(employeeCode, workDate, workModel) {
  return {
    employeeCode, workDate, recordType: 'WORK', workModel,
    shiftRosterId: null, checkInTime: null, checkOutTime: null, hoursWorked: null,
    isLate: false, isEarlyLeave: false, isHolidayWork: false, isWeekendWork: false,
    note: null, createdAt: nowVN(), updatedAt: nowVN()
  };
}

// Áp 1 lượt "tap" từ máy chấm công vật lý (timestampISO — giờ thật lúc quẹt thẻ) vào đúng bản ghi
// AttendanceRecords của employeeCode+workDate (ngày lấy theo timestampISO) — idempotent theo hướng
// "punch đầu tiên trong ngày -> checkInTime, punch cuối cùng -> checkOutTime" (không phân biệt
// vào/ra theo field riêng — hầu hết máy chấm công phổ thông chỉ gửi mốc giờ, xem ghi chú đầu file).
// existingList: toàn bộ AttendanceRecords hiện có (đã lọc/không lọc đều được, hàm tự tìm đúng dòng).
function applyClockPunch(existingList, employeeCode, timestampISO, workModelInfo, appData) {
  const ts = new Date(timestampISO);
  if (Number.isNaN(ts.getTime())) throw new HttpError(400, 'Thời gian chấm công không hợp lệ');
  const workDate = ts.toISOString().slice(0, 10);
  const { workModel, dept } = workModelInfo;

  const existing = (existingList || []).find(r => r.employeeCode === employeeCode && r.workDate === workDate);
  const record = existing ? Object.assign({}, existing) : defaultAttendanceRecord(employeeCode, workDate, workModel);
  if (record.recordType !== 'WORK') {
    // Ngày đã có bản ghi nghỉ phép/công tác (do đơn xin nghỉ đã duyệt) — máy chấm công vẫn có thể quẹt
    // (VD nhân viên ghé qua công ty việc riêng) nhưng KHÔNG ghi đè loại bản ghi đã có, chỉ log lại giờ
    // quẹt vào note để HR biết, tránh biến 1 ngày "LEAVE_PAID" thành "WORK" ngoài ý muốn.
    record.note = `${record.note ? record.note + '; ' : ''}Có quẹt máy chấm công lúc ${ts.toLocaleString('vi-VN')} (không đổi loại bản ghi)`;
    record.updatedAt = nowVN();
    return { record, isNew: !existing };
  }

  if (!record.checkInTime || ts < new Date(record.checkInTime)) record.checkInTime = ts.toISOString();
  if (!record.checkOutTime || ts > new Date(record.checkOutTime)) record.checkOutTime = ts.toISOString();
  record.isHolidayWork = isHolidayDate(workDate, appData?.publicHolidays);
  record.isWeekendWork = workModel === 'OFFICE_HOURS' && isWeekendDate(workDate);

  if (workModel === 'OFFICE_HOURS') {
    const cfg = appData?.attendanceHoConfig || {};
    const startMin = timeStrToMinutes(cfg.startTime) ?? 8 * 60;
    const endMin = timeStrToMinutes(cfg.endTime) ?? 17 * 60;
    const grace = Number(cfg.lateGraceMinutes) || 0;
    const checkInMin = minutesOfDay(record.checkInTime);
    const checkOutMin = minutesOfDay(record.checkOutTime);
    record.isLate = checkInMin > startMin + grace;
    record.isEarlyLeave = record.checkInTime !== record.checkOutTime && checkOutMin < endMin;
  } else {
    const roster = (appData?.shiftRoster || []).find(r => r.employeeCode === employeeCode && r.workDate === workDate && r.status !== 'CANCELLED');
    if (roster) {
      record.shiftRosterId = roster.id;
      const template = (appData?.shiftTemplates || []).find(t => t.id === roster.shiftTemplateId);
      if (template) {
        const startMin = timeStrToMinutes(template.startTime);
        const endMin = timeStrToMinutes(template.endTime);
        const checkInMin = minutesOfDay(record.checkInTime);
        const checkOutMin = minutesOfDay(record.checkOutTime);
        if (startMin != null) record.isLate = checkInMin > startMin;
        if (endMin != null) record.isEarlyLeave = record.checkInTime !== record.checkOutTime && checkOutMin < endMin;
      }
    } else {
      record.note = `${record.note ? record.note + '; ' : ''}Không có lịch phân ca ngày này — chưa xác định đi muộn/về sớm`;
    }
  }

  if (record.checkInTime && record.checkOutTime && record.checkInTime !== record.checkOutTime) {
    const hours = (new Date(record.checkOutTime) - new Date(record.checkInTime)) / 3600000;
    record.hoursWorked = Math.round(hours * 100) / 100;
  }
  record.updatedAt = nowVN();
  return { record, isNew: !existing };
}

function assertValidManualAttendanceEdit(payload) {
  const patch = {};
  if (payload.recordType !== undefined) {
    if (!ATTENDANCE_RECORD_TYPES.has(payload.recordType)) throw new HttpError(400, 'Loại bản ghi công không hợp lệ');
    patch.recordType = payload.recordType;
  }
  if (payload.checkInTime !== undefined) {
    if (payload.checkInTime !== null && Number.isNaN(new Date(payload.checkInTime).getTime())) throw new HttpError(400, 'Giờ vào không hợp lệ');
    patch.checkInTime = payload.checkInTime;
  }
  if (payload.checkOutTime !== undefined) {
    if (payload.checkOutTime !== null && Number.isNaN(new Date(payload.checkOutTime).getTime())) throw new HttpError(400, 'Giờ ra không hợp lệ');
    patch.checkOutTime = payload.checkOutTime;
  }
  if (patch.checkInTime && patch.checkOutTime && new Date(patch.checkOutTime) < new Date(patch.checkInTime)) {
    throw new HttpError(400, 'Giờ ra phải sau giờ vào');
  }
  if (payload.note !== undefined) patch.note = String(payload.note || '').trim().slice(0, 200) || null;
  return patch;
}

function applyManualAttendanceEdit(record, payload, actorUsername) {
  const patch = assertValidManualAttendanceEdit(payload);
  const updated = Object.assign({}, record, patch);
  if (updated.checkInTime && updated.checkOutTime && updated.checkInTime !== updated.checkOutTime) {
    updated.hoursWorked = Math.round(((new Date(updated.checkOutTime) - new Date(updated.checkInTime)) / 3600000) * 100) / 100;
  }
  updated.updatedAt = nowVN();
  updated.note = `${updated.note ? updated.note + '; ' : ''}Đã sửa tay bởi ${actorUsername}`.trim();
  return updated;
}

// ===== Phép năm (Phần E.6) =====

const BASE_ANNUAL_DAYS = 12;
const SENIORITY_YEARS_PER_EXTRA_DAY = 5;

// startDate: ngày vào làm (ISO); year: năm cần tính. Nếu vào làm giữa năm -> pro-rate theo số tháng
// còn lại trong năm đó; nếu đã làm đủ từ đầu năm -> đủ 12 (+ thâm niên).
function computeAnnualLeaveDays(startDateStr, year, referenceDate) {
  const start = new Date(startDateStr + 'T00:00:00');
  const yearStart = new Date(`${year}-01-01T00:00:00`);
  const seniorityYears = Math.max(0, Math.floor((new Date(`${year}-12-31`) - start) / (365.25 * 86400000)));
  const seniorityBonus = Math.floor(seniorityYears / SENIORITY_YEARS_PER_EXTRA_DAY);
  if (start <= yearStart) {
    return Math.round((BASE_ANNUAL_DAYS + seniorityBonus) * 10) / 10;
  }
  if (start.getUTCFullYear() > year) return 0;
  const monthsRemaining = 12 - start.getMonth();
  const proRated = Math.round((BASE_ANNUAL_DAYS / 12) * monthsRemaining * 10) / 10;
  return Math.round((proRated + seniorityBonus) * 10) / 10;
}

function defaultLeaveBalance(employeeCode, year, totalDays) {
  return { employeeCode, year, totalDays, usedDays: 0, createdAt: nowVN(), updatedAt: nowVN() };
}

// Gọi lúc HR_Process (ONBOARDING) Stage=COMPLETED — idempotent (không tạo trùng nếu đã có balance năm
// hiện tại cho employeeCode này, VD Onboarding hoàn tất lại lần 2 do sửa quy trình trước đó).
function ensureLeaveBalanceForYear(list, employeeCode, startDateStr, year) {
  const arr = list || [];
  const existing = arr.find(b => b.employeeCode === employeeCode && b.year === year);
  if (existing) return { list: arr, created: null };
  const totalDays = computeAnnualLeaveDays(startDateStr, year);
  const created = defaultLeaveBalance(employeeCode, year, totalDays);
  return { list: [...arr, created], created };
}

// Đơn giá ngày công quy đổi phép chưa nghỉ (Phần E.6) — dùng khi Offboarding (task SETTLEMENT).
// HO: lương cơ bản / 22; Siêu thị: lương cơ bản / (tổng giờ công chuẩn tháng theo roster / 8h quy đổi)
// — đơn giản hoá vế Siêu thị: dùng luôn 26 ngày công/tháng (lịch làm việc đủ tuần, không cần dựng lại
// "tổng giờ công chuẩn tháng theo roster" phức tạp cho 1 con số tham khảo không ràng buộc — xem ghi chú
// đầu file mục 5, đây CHỈ là số hiển thị tham khảo cho HR, không phải nghiệp vụ tính lương chính thức).
function computeLeavePayoutInfo(baseSalary, remainingDays, workModel) {
  if (!baseSalary || remainingDays <= 0) return { remainingDays: Math.max(0, remainingDays || 0), dailyRate: 0, amount: 0 };
  const divisor = workModel === 'SHIFT_BASED' ? 26 : 22;
  const dailyRate = Math.round(baseSalary / divisor);
  return { remainingDays, dailyRate, amount: Math.round(dailyRate * remainingDays) };
}

// appData (tuỳ chọn) — CHỈ cần cho leaveType 'HOURLY' để đọc attendanceHoConfig.standardHoursPerDay (số
// giờ công chuẩn/ngày, quy đổi ra daysCount phân số) — nếu thiếu, mặc định 8 giờ/ngày.
function assertValidLeaveRequest(payload, appData) {
  const leaveType = String(payload.leaveType || '').trim();
  if (!LEAVE_TYPES.has(leaveType)) throw new HttpError(400, 'Loại nghỉ phép không hợp lệ');
  const reason = String(payload.reason || '').trim().slice(0, 500);

  if (leaveType === 'HOURLY') {
    const fromDate = String(payload.fromDate || '').trim();
    if (!fromDate || Number.isNaN(new Date(fromDate).getTime())) throw new HttpError(400, 'Ngày nghỉ không hợp lệ');
    const startTime = String(payload.startTime || '').trim();
    const endTime = String(payload.endTime || '').trim();
    const startMin = timeStrToMinutes(startTime);
    const endMin = timeStrToMinutes(endTime);
    if (startMin == null || endMin == null) throw new HttpError(400, 'Vui lòng nhập đúng Giờ Bắt Đầu/Giờ Kết Thúc (HH:mm)');
    if (endMin <= startMin) throw new HttpError(400, 'Giờ Kết Thúc phải sau Giờ Bắt Đầu');
    const standardHoursPerDay = Number(appData?.attendanceHoConfig?.standardHoursPerDay) || 8;
    const hours = (endMin - startMin) / 60;
    if (hours > standardHoursPerDay) throw new HttpError(400, `Nghỉ theo giờ không được quá ${standardHoursPerDay} giờ trong 1 ngày — nghỉ cả ngày vui lòng chọn loại "Phép năm"/"Nghỉ không lương"/"Nghỉ ốm"/"Nghỉ việc riêng"`);
    const daysCount = Math.round((hours / standardHoursPerDay) * 100) / 100;
    return { leaveType, fromDate, toDate: fromDate, daysCount, reason, startTime, endTime, hours };
  }

  const fromDate = String(payload.fromDate || '').trim();
  const toDate = String(payload.toDate || '').trim();
  if (!fromDate || Number.isNaN(new Date(fromDate).getTime())) throw new HttpError(400, 'Ngày bắt đầu nghỉ không hợp lệ');
  if (!toDate || Number.isNaN(new Date(toDate).getTime())) throw new HttpError(400, 'Ngày kết thúc nghỉ không hợp lệ');
  if (new Date(toDate) < new Date(fromDate)) throw new HttpError(400, 'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu');
  const daysCount = Math.round((new Date(toDate) - new Date(fromDate)) / 86400000) + 1;
  if (daysCount > 90) throw new HttpError(400, 'Không thể nộp 1 đơn nghỉ quá 90 ngày liên tục');
  return { leaveType, fromDate, toDate, daysCount, reason };
}

function listDatesInRange(fromDate, toDate) {
  const dates = [];
  let cur = new Date(fromDate + 'T00:00:00');
  const end = new Date(toDate + 'T00:00:00');
  while (cur <= end) {
    dates.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
  }
  return dates;
}

function defaultLeaveRequest(employeeCode, valid, workModel) {
  return {
    employeeCode, leaveType: valid.leaveType, fromDate: valid.fromDate, toDate: valid.toDate,
    daysCount: valid.daysCount, reason: valid.reason, workModel,
    startTime: valid.startTime || null, endTime: valid.endTime || null,
    status: 'PENDING', approverUsername: null, approverName: null, decidedAt: null, rejectReason: null,
    affectedRosterIds: [], createdAt: nowVN(), updatedAt: nowVN()
  };
}

// allUsers: toàn bộ users (để xác định quản lý trực tiếp qua isManagerOf).
function canApproveLeaveRequest(approver, allUsers, employeeProfileUsername) {
  if (approver?.perms?.admin || approver?.perms?.hrAttendanceManage) return true;
  if (!approver?.perms?.hrLeaveApprove) return false;
  if (!employeeProfileUsername) return false;
  return isManagerOf(approver.username, employeeProfileUsername, allUsers);
}

function applyApproveLeaveRequest(request, actorUsername, actorName, shiftRosterList) {
  if (request.status !== 'PENDING') throw new HttpError(400, 'Đơn nghỉ phép không còn ở trạng thái chờ duyệt');
  const updated = Object.assign({}, request, {
    status: 'APPROVED', approverUsername: actorUsername, approverName: actorName,
    decidedAt: nowVN(), updatedAt: nowVN()
  });
  let affectedRosterIds = [];
  if (request.workModel === 'SHIFT_BASED') {
    affectedRosterIds = (shiftRosterList || [])
      .filter(r => r.employeeCode === request.employeeCode && r.status !== 'CANCELLED'
        && r.workDate >= request.fromDate && r.workDate <= request.toDate)
      .map(r => r.id);
    updated.affectedRosterIds = affectedRosterIds;
  }
  return { updated, affectedRosterIds };
}

function applyRejectLeaveRequest(request, actorUsername, actorName, reason) {
  if (request.status !== 'PENDING') throw new HttpError(400, 'Đơn nghỉ phép không còn ở trạng thái chờ duyệt');
  return Object.assign({}, request, {
    status: 'REJECTED', approverUsername: actorUsername, approverName: actorName,
    decidedAt: nowVN(), rejectReason: String(reason || '').trim().slice(0, 300) || null, updatedAt: nowVN()
  });
}

function applyCancelLeaveRequest(request, actorUsername) {
  if (!['PENDING', 'APPROVED'].includes(request.status)) throw new HttpError(400, 'Đơn nghỉ phép này không thể huỷ');
  if (request.status === 'APPROVED' && new Date(request.fromDate) <= new Date(todayStr())) {
    throw new HttpError(400, 'Đơn đã duyệt và ngày nghỉ đã/đang diễn ra — không thể tự huỷ, vui lòng liên hệ HR');
  }
  return Object.assign({}, request, { status: 'CANCELLED', updatedAt: nowVN(), note: `Huỷ bởi ${actorUsername}` });
}

// Cộng dồn UsedDays vào LeaveBalance đúng năm khi đơn được duyệt (chỉ tính đơn ANNUAL — UNPAID/SICK
// không trừ vào phép năm, xem AttendanceRecords.recordType tương ứng ở createLeaveAttendanceRecords()).
function deductLeaveBalance(balance, daysCount) {
  return Object.assign({}, balance, { usedDays: Math.round(((balance.usedDays || 0) + daysCount) * 10) / 10, updatedAt: nowVN() });
}

// Sinh các dòng AttendanceRecords loại LEAVE_PAID/LEAVE_UNPAID/SICK_LEAVE cho từng ngày trong khoảng
// nghỉ đã duyệt — GHI ĐÈ bản ghi WORK (nếu máy chấm công đã lỡ ghi ngày đó) vì đơn đã duyệt là nguồn sự
// thật cao hơn; KHÔNG ghi đè nếu ngày đó đã có bản ghi nghỉ phép khác (tránh đơn chồng đơn).
function buildLeaveAttendanceRecords(request, existingList) {
  // HOURLY (nghỉ theo giờ) không sinh bản ghi chấm công riêng — xem ghi chú tại ATTENDANCE_RECORD_TYPES.
  if (request.leaveType === 'HOURLY') return [];
  const recordType = request.leaveType === 'UNPAID' ? 'LEAVE_UNPAID'
    : request.leaveType === 'SICK' ? 'SICK_LEAVE'
    : request.leaveType === 'PERSONAL' ? 'LEAVE_PERSONAL'
    : 'LEAVE_PAID';
  const dates = listDatesInRange(request.fromDate, request.toDate);
  const results = [];
  for (const workDate of dates) {
    const existing = (existingList || []).find(r => r.employeeCode === request.employeeCode && r.workDate === workDate);
    if (existing && existing.recordType !== 'WORK') continue; // đã có bản ghi nghỉ phép khác — bỏ qua
    const base = existing ? Object.assign({}, existing) : defaultAttendanceRecord(request.employeeCode, workDate, request.workModel);
    base.recordType = recordType;
    base.checkInTime = null; base.checkOutTime = null; base.hoursWorked = null;
    base.isLate = false; base.isEarlyLeave = false;
    base.note = `Nghỉ phép theo đơn đã duyệt (${request.fromDate} → ${request.toDate})`;
    base.updatedAt = nowVN();
    results.push({ record: base, isNew: !existing });
  }
  return results;
}

// ===== Lịch phân ca & đổi ca (Phần E.4) =====

function assertValidShiftTemplate(payload) {
  const shiftCode = String(payload.shiftCode || '').trim().toUpperCase();
  if (!shiftCode) throw new HttpError(400, 'Vui lòng nhập Mã Ca');
  const shiftName = String(payload.shiftName || '').trim();
  if (!shiftName) throw new HttpError(400, 'Vui lòng nhập Tên Ca');
  const startTime = String(payload.startTime || '').trim();
  const endTime = String(payload.endTime || '').trim();
  if (timeStrToMinutes(startTime) == null) throw new HttpError(400, 'Giờ bắt đầu ca không hợp lệ (HH:mm)');
  if (timeStrToMinutes(endTime) == null) throw new HttpError(400, 'Giờ kết thúc ca không hợp lệ (HH:mm)');
  const breakMinutes = Number(payload.breakMinutes) || 0;
  const standardHours = Number(payload.standardHours);
  if (!Number.isFinite(standardHours) || standardHours <= 0 || standardHours > 24) throw new HttpError(400, 'Số giờ chuẩn của ca không hợp lệ');
  return { shiftCode: shiftCode.slice(0, 20), shiftName: shiftName.slice(0, 100), startTime, endTime, breakMinutes, isNightShift: !!payload.isNightShift, standardHours, isActive: payload.isActive !== false };
}

function assertValidRosterAssignment(payload) {
  const employeeCode = String(payload.employeeCode || '').trim();
  if (!employeeCode) throw new HttpError(400, 'Vui lòng chọn nhân viên');
  const workDate = String(payload.workDate || '').trim();
  if (!workDate || Number.isNaN(new Date(workDate).getTime())) throw new HttpError(400, 'Ngày làm việc không hợp lệ');
  const shiftTemplateId = Number(payload.shiftTemplateId);
  if (!Number.isFinite(shiftTemplateId)) throw new HttpError(400, 'Vui lòng chọn ca làm việc');
  const storeCode = String(payload.storeCode || '').trim();
  if (!storeCode) throw new HttpError(400, 'Vui lòng chọn Siêu Thị');
  return { employeeCode: employeeCode.slice(0, 50), workDate, shiftTemplateId, storeCode: storeCode.slice(0, 100) };
}

function defaultShiftRoster(valid, createdBy) {
  return Object.assign({}, valid, { status: 'SCHEDULED', createdBy, createdAt: nowVN(), updatedAt: nowVN() });
}

function assertNoRosterConflict(list, employeeCode, workDate, excludeId) {
  const conflict = (list || []).some(r => r.employeeCode === employeeCode && r.workDate === workDate && r.status !== 'CANCELLED' && r.id !== excludeId);
  if (conflict) throw new HttpError(409, 'Nhân viên này đã có lịch phân ca ngày này — huỷ dòng cũ trước nếu muốn phân ca lại');
}

function applyCancelRoster(roster, actorUsername) {
  if (roster.status === 'CANCELLED') throw new HttpError(400, 'Dòng phân ca này đã huỷ trước đó');
  return Object.assign({}, roster, { status: 'CANCELLED', updatedAt: nowVN(), note: `Huỷ bởi ${actorUsername}` });
}

function defaultShiftSwapRequest(payload, requesterEmployeeCode) {
  const requesterRosterId = Number(payload.requesterRosterId);
  if (!Number.isFinite(requesterRosterId)) throw new HttpError(400, 'Vui lòng chọn ca cần đổi');
  const targetEmployeeCode = String(payload.targetEmployeeCode || '').trim();
  if (!targetEmployeeCode) throw new HttpError(400, 'Vui lòng chọn người nhận ca thay');
  if (targetEmployeeCode === requesterEmployeeCode) throw new HttpError(400, 'Không thể tự đổi ca cho chính mình');
  const reason = String(payload.reason || '').trim().slice(0, 300);
  return {
    requesterEmployeeCode, requesterRosterId, targetEmployeeCode, reason,
    status: 'PENDING', approverUsername: null, approverName: null, decidedAt: null,
    createdAt: nowVN(), updatedAt: nowVN()
  };
}

// Áp dụng duyệt đổi ca — đổi 1 CHIỀU (xem ghi chú đầu file mục 4): gán lại employeeCode của ĐÚNG dòng
// roster người xin đổi sang targetEmployeeCode, giữ nguyên workDate/shiftTemplateId/storeCode, đánh dấu
// Status='SWAPPED' để phân biệt với 'SCHEDULED' gốc (vẫn có thể truy vết ai đã từng đứng ca này).
function applyApproveShiftSwap(swapRequest, targetRoster, actorUsername, actorName) {
  if (swapRequest.status !== 'PENDING') throw new HttpError(400, 'Yêu cầu đổi ca không còn ở trạng thái chờ duyệt');
  if (!targetRoster) throw new HttpError(404, 'Không tìm thấy dòng phân ca cần đổi (có thể đã bị huỷ)');
  if (targetRoster.status === 'CANCELLED') throw new HttpError(400, 'Dòng phân ca này đã bị huỷ, không thể đổi ca');
  const updatedSwap = Object.assign({}, swapRequest, {
    status: 'APPROVED', approverUsername: actorUsername, approverName: actorName, decidedAt: nowVN(), updatedAt: nowVN()
  });
  const updatedRoster = Object.assign({}, targetRoster, {
    employeeCode: swapRequest.targetEmployeeCode, status: 'SWAPPED', updatedAt: nowVN(),
    note: `Đổi ca: ${swapRequest.requesterEmployeeCode} → ${swapRequest.targetEmployeeCode} (duyệt bởi ${actorUsername})`
  });
  return { updatedSwap, updatedRoster };
}

function applyRejectShiftSwap(swapRequest, actorUsername, actorName) {
  if (swapRequest.status !== 'PENDING') throw new HttpError(400, 'Yêu cầu đổi ca không còn ở trạng thái chờ duyệt');
  return Object.assign({}, swapRequest, { status: 'REJECTED', approverUsername: actorUsername, approverName: actorName, decidedAt: nowVN(), updatedAt: nowVN() });
}

// ===== Offboarding hook: huỷ lịch phân ca tương lai + đơn nghỉ phép còn treo (Phần F) =====
function cancelFutureRosterAfterOffboarding(rosterList, employeeCode, lastWorkingDate) {
  return (rosterList || []).map(r => {
    if (r.employeeCode !== employeeCode || r.status === 'CANCELLED') return r;
    if (r.workDate <= lastWorkingDate) return r;
    return Object.assign({}, r, { status: 'CANCELLED', updatedAt: nowVN(), note: 'Tự huỷ do nhân viên nghỉ việc (Offboarding hoàn tất)' });
  });
}
function cancelPendingLeaveRequestsAfterOffboarding(leaveRequestList, employeeCode) {
  return (leaveRequestList || []).map(r => {
    if (r.employeeCode !== employeeCode || r.status !== 'PENDING') return r;
    return Object.assign({}, r, { status: 'CANCELLED', updatedAt: nowVN(), note: 'Tự huỷ do nhân viên nghỉ việc (Offboarding hoàn tất)' });
  });
}

module.exports = {
  WORK_MODELS, ATTENDANCE_RECORD_TYPES, LEAVE_TYPES, LEAVE_STATUSES, ROSTER_STATUSES, SWAP_STATUSES,
  resolveWorkModelForEmployeeCode, findCompletedOffboardingForProfile, isHolidayDate, isWeekendDate,
  defaultAttendanceRecord, applyClockPunch, assertValidManualAttendanceEdit, applyManualAttendanceEdit,
  computeAnnualLeaveDays, defaultLeaveBalance, ensureLeaveBalanceForYear, computeLeavePayoutInfo,
  assertValidLeaveRequest, defaultLeaveRequest, canApproveLeaveRequest,
  applyApproveLeaveRequest, applyRejectLeaveRequest, applyCancelLeaveRequest, deductLeaveBalance,
  buildLeaveAttendanceRecords, listDatesInRange,
  assertValidShiftTemplate, assertValidRosterAssignment, defaultShiftRoster, assertNoRosterConflict, applyCancelRoster,
  defaultShiftSwapRequest, applyApproveShiftSwap, applyRejectShiftSwap,
  cancelFutureRosterAfterOffboarding, cancelPendingLeaveRequestsAfterOffboarding
};
