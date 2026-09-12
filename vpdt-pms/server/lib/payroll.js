// lib/payroll.js — Module Lương (Payroll), tab "Lương" trong module Nhân Sự — điểm hội tụ dữ liệu từ
// laborContracts/attendanceRecords/employeeProfiles (giảm trừ gia cảnh) đã xây ở các đợt trước.
//
// ĐIỀU CHỈNH so với tài liệu gốc (thiết kế cho SQL Server chuẩn hoá dbo.PayrollPeriods/dbo.Payslips/
// dbo.PayslipDetails/dbo.PayrollComponents với FK/IDENTITY) cho khớp kiến trúc JSON-blob của app này:
//   1. payrollPeriods + payslips là 2 collection RIÊNG trong dbo.Records (MIGRATED_COLLECTIONS, khoá
//      optimistic theo từng bản ghi) — cùng khuôn tách reportPeriods/reportEntries: period là "sổ cái"
//      (trạng thái/duyệt/tổng số), mỗi payslip là 1 bản ghi độc lập (periodId+employeeCode) để: (a) rà
//      soát/điều chỉnh 1 payslip không phải khoá cả mảng lớn, (b) endpoint tự xem "của tôi" chỉ cần tra
//      theo periodId+employeeCode, không phải tải cả object period nặng.
//   2. KHÔNG dựng bảng PayrollComponents cấu hình được (Mục 4 tài liệu gốc đề xuất danh mục hoàn toàn
//      config-driven) — CHƯA có form lương mẫu thật để biết chính xác danh mục cần những gì (tài liệu tự
//      nêu ở Mục 13), dựng catalog admin CRUD đầy đủ lúc này là suy đoán cấu trúc dữ liệu cho danh mục
//      chưa biết. Thay vào đó: PAYROLL_COMPONENTS dưới đây là danh mục THAM KHẢO cố định (đúng 17 mã ở
//      Mục 4 tài liệu gốc) — khi có form thật chỉ cần sửa file này (thêm/đổi mã), không đụng schema.
//   3. CHỈ tự động tính các dòng có NGUỒN DỮ LIỆU THẬT trong hệ thống: BASIC_SALARY (LaborContracts),
//      OT_150/200/300 (AttendanceRecords RecordType='OVERTIME'), UNPAID_LEAVE_DEDUCT (RecordType=
//      'LEAVE_UNPAID'/'LEAVE_PERSONAL'), SOCIAL_INSURANCE/HEALTH_INSURANCE/UNEMPLOYMENT_INSURANCE/
//      PERSONAL_INCOME_TAX (theo % / biểu thuế cấu hình ở payrollRateConfig). Các dòng còn lại (phụ cấp
//      ăn trưa/điện thoại/chức vụ/ca đêm/ngày lễ, KPI_BONUS, thưởng khác, tạm ứng, phạt) là dòng NHẬP TAY
//      kế toán tự thêm lúc rà soát (Mục 3 bước [3] tài liệu gốc) — vì: (a) hệ thống CHƯA có bảng
//      KpiEvaluations điểm số thật (chỉ có kpiFlow cấu hình AI đánh giá ai, xem lib/orgChart.js) nên
//      không có công thức thật để tự tính KPI_BONUS; (b) AttendanceRecords chưa gắn cờ ca đêm vào từng
//      bản ghi (isNightShift chỉ có ở ShiftTemplates, chưa propagate xuống record — xem lib/attendance.js)
//      nên không tự tính chính xác ALLOWANCE_NIGHT_SHIFT được; (c) phụ cấp ăn trưa/điện thoại/chức vụ
//      hoàn toàn phụ thuộc chính sách công ty chưa xác nhận (Mục 13). Đây KHÔNG phải bỏ sót — là quyết
//      định phạm vi có chủ đích, tránh tự bịa công thức cho phần chưa có dữ liệu nguồn thật.
//   4. % BHXH/BHYT/BHTN, biểu thuế TNCN lũy tiến, giảm trừ bản thân/người phụ thuộc, trần lương đóng BHXH,
//      số ngày công chuẩn HO/Siêu thị — TOÀN BỘ là CẤU HÌNH admin sửa được (payrollRateConfig, xem
//      routes/payroll.js + admin UI "Cấu Hình Lương"), KHÔNG hardcode trong code tính — seed mặc định
//      theo đúng số liệu THAM KHẢO nêu ở Mục 4/5/13 tài liệu gốc (BHXH 8%/BHYT 1.5%/BHTN 1%, giảm trừ bản
//      thân 11.000.000đ/người phụ thuộc 4.400.000đ, biểu thuế 7 bậc theo Luật Thuế TNCN hiện hành — các
//      con số luật định này ổn định nhiều năm, rủi ro sai thấp hơn %BHXH/trần đóng BH vốn điều chỉnh theo
//      lương tối thiểu vùng từng thời kỳ) — riêng TRẦN ĐÓNG BHXH cố tình để mặc định RẤT LỚN (coi như
//      không giới hạn) thay vì đoán 1 con số cụ thể có thể sai, kèm cảnh báo admin PHẢI cấu hình đúng
//      trước khi chạy lương thật (xem banner ở admin UI).
//   5. Lương đóng BHXH lấy ĐÚNG BaseSalary hợp đồng đang ACTIVE (findActiveContractByEmployeeCode() —
//      lib/laborContract.js đã có sẵn) — KHÔNG hỗ trợ tách Gross/Net theo từng nhân viên ở v1 (Mục 13 —
//      "công ty có tách Gross/Net không" là câu hỏi CHƯA có câu trả lời, mặc định tính theo mô hình Gross
//      phổ biến nhất: nhân viên tự chịu BHXH/BHYT/BHTN/thuế TNCN trừ vào lương, không phải công ty đóng
//      thay) — nếu công ty áp dụng Net, HR chỉnh tay dòng thuế/BH = 0 và tự điền phụ cấp bù thuế qua dòng
//      nhập tay lúc rà soát, chờ xác nhận chính sách thật để làm tự động sau.
'use strict';

const { HttpError } = require('./httpErrors');
const { findActiveContractByEmployeeCode, findContractsByEmployeeCode } = require('./laborContract');
const { resolveWorkModelForEmployeeCode, findCompletedOffboardingForProfile } = require('./attendance');

function nowVN() {
  return new Date().toLocaleString('vi-VN');
}

const PERIOD_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FINALIZED', 'PUBLISHED'];

// Danh mục tham khảo Mục 4 tài liệu gốc — xem điều chỉnh #2/#3 đầu file. INCOME/DEDUCTION quyết định
// dấu khi cộng vào grossIncome/totalDeduction; autoCalculated=false -> KHÔNG bao giờ do hệ thống tự sinh,
// chỉ kế toán thêm tay qua adjustPayslipDetail() lúc rà soát (payload.componentCode phải nằm trong
// catalog này — chặn gõ bừa mã lạ).
const PAYROLL_COMPONENTS = {
  BASIC_SALARY: { label: 'Lương cơ bản', type: 'INCOME', autoCalculated: true },
  ALLOWANCE_LUNCH: { label: 'Phụ cấp ăn trưa', type: 'INCOME', autoCalculated: false },
  ALLOWANCE_PHONE: { label: 'Phụ cấp điện thoại', type: 'INCOME', autoCalculated: false },
  ALLOWANCE_POSITION: { label: 'Phụ cấp chức vụ', type: 'INCOME', autoCalculated: false },
  ALLOWANCE_NIGHT_SHIFT: { label: 'Phụ cấp ca đêm', type: 'INCOME', autoCalculated: false },
  ALLOWANCE_HOLIDAY: { label: 'Phụ cấp ngày lễ', type: 'INCOME', autoCalculated: false },
  OT_150: { label: 'Làm thêm giờ 150% (ngày thường)', type: 'INCOME', autoCalculated: true },
  OT_200: { label: 'Làm thêm giờ 200% (cuối tuần)', type: 'INCOME', autoCalculated: true },
  OT_300: { label: 'Làm thêm giờ 300% (lễ/tết)', type: 'INCOME', autoCalculated: true },
  KPI_BONUS: { label: 'Thưởng theo KPI', type: 'INCOME', autoCalculated: false },
  BONUS_OTHER: { label: 'Thưởng khác (đột xuất)', type: 'INCOME', autoCalculated: false },
  SOCIAL_INSURANCE: { label: 'BHXH', type: 'DEDUCTION', autoCalculated: true },
  HEALTH_INSURANCE: { label: 'BHYT', type: 'DEDUCTION', autoCalculated: true },
  UNEMPLOYMENT_INSURANCE: { label: 'BHTN', type: 'DEDUCTION', autoCalculated: true },
  PERSONAL_INCOME_TAX: { label: 'Thuế TNCN', type: 'DEDUCTION', autoCalculated: true },
  ADVANCE_DEDUCT: { label: 'Khấu trừ tạm ứng', type: 'DEDUCTION', autoCalculated: false },
  PENALTY_DEDUCT: { label: 'Khấu trừ vi phạm/phạt', type: 'DEDUCTION', autoCalculated: false },
  UNPAID_LEAVE_DEDUCT: { label: 'Trừ ngày nghỉ không lương', type: 'DEDUCTION', autoCalculated: true }
};
const MANUAL_COMPONENT_CODES = new Set(Object.keys(PAYROLL_COMPONENTS).filter(c => !PAYROLL_COMPONENTS[c].autoCalculated));

// payrollRateConfig — collection admin-config PHẲNG (1 object duy nhất, cùng khuôn attendanceHoConfig),
// KHÔNG cho user thường ghi (chặn ở routes/data.js ADMIN_ONLY_WRITE_KEYS cùng itPriceDeptWorkflows).
// Biểu thuế TNCN 7 bậc theo Luật Thuế TNCN hiện hành (ổn định nhiều năm — xem điều chỉnh #4 đầu file).
function defaultRateConfig() {
  return {
    bhxhPercent: 8, bhytPercent: 1.5, bhtnPercent: 1,
    bhxhCap: 999999999, // CHƯA có số liệu trần thật — xem điều chỉnh #4, admin PHẢI cấu hình trước khi chạy lương thật
    personalDeduction: 11000000, dependentDeduction: 4400000,
    standardWorkDaysHo: 22, standardWorkDaysStore: 26, standardHoursPerDay: 8,
    otMultiplierNormal: 1.5, otMultiplierWeekend: 2.0, otMultiplierHoliday: 3.0,
    taxBrackets: [
      { upTo: 5000000, rate: 5 }, { upTo: 10000000, rate: 10 }, { upTo: 18000000, rate: 15 },
      { upTo: 32000000, rate: 20 }, { upTo: 52000000, rate: 25 }, { upTo: 80000000, rate: 30 },
      { upTo: null, rate: 35 }
    ],
    updatedAt: nowVN(), updatedBy: 'system'
  };
}

function canManagePayroll(user) {
  return !!(user?.perms?.admin || user?.perms?.hrPayrollManage);
}
function canApprovePayroll(user) {
  return !!(user?.perms?.admin || user?.perms?.hrPayrollApprove);
}
// Xem toàn bộ (danh sách kỳ, mọi payslip trong kỳ) — KHÔNG gồm hrPayrollView (mặc định mọi người, chỉ
// xem CỦA CHÍNH MÌNH qua route /my-payslips riêng, xem điều chỉnh IDOR ở routes/payroll.js).
function canViewAllPayroll(user) {
  return canManagePayroll(user) || canApprovePayroll(user);
}

function computeTaxFromBrackets(taxableBase, brackets) {
  if (!taxableBase || taxableBase <= 0) return 0;
  let tax = 0, prev = 0;
  for (const b of (brackets || [])) {
    const top = b.upTo == null ? Infinity : Number(b.upTo);
    if (taxableBase <= prev) break;
    const inBand = Math.min(taxableBase, top) - prev;
    tax += (inBand * Number(b.rate || 0)) / 100;
    prev = top;
    if (taxableBase <= top) break;
  }
  return Math.round(tax);
}

function periodDateRange(period) {
  const start = `${period.periodYear}-${String(period.periodMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(period.periodYear, period.periodMonth, 0).getDate();
  const end = `${period.periodYear}-${String(period.periodMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function addDetail(details, componentCode, amount, note, isManualAdjustment) {
  const rounded = Math.round(Number(amount) || 0);
  if (rounded === 0 && isManualAdjustment) return; // dòng nhập tay = 0 không cần lưu
  if (rounded === 0 && !['BASIC_SALARY'].includes(componentCode)) return; // dòng tự tính = 0 (VD không OT) thì bỏ qua, đỡ rác payslip
  details.push({ componentCode, amount: rounded, note: note || null, isManualAdjustment: !!isManualAdjustment, createdAt: nowVN() });
}

function sumDetails(details, type) {
  return (details || []).reduce((sum, d) => {
    const comp = PAYROLL_COMPONENTS[d.componentCode];
    if (!comp || comp.type !== type) return sum;
    return sum + (Number(d.amount) || 0);
  }, 0);
}

// Tính 1 payslip cho 1 nhân viên — TRẢ VỀ null nếu bỏ qua (không có hợp đồng ACTIVE/không xác định được
// mô hình chấm công), caller (calculatePayrollPeriod) tự quyết định có báo cho HR biết ai bị bỏ qua.
function computeEmployeePayslip(employeeCode, period, appData, rateConfig) {
  // Tra Offboarding ĐÃ HOÀN TẤT của đúng nhân viên này với lastWorkingDate rơi trong kỳ TRƯỚC, dùng
  // chung cho CẢ 2 nhánh dự phòng bên dưới (hợp đồng lẫn mô hình chấm công) — xem 2 chú thích PHÁT HIỆN
  // ngay dưới đây.
  const profile = (appData.employeeProfiles || []).find(p => p.employeeCode === employeeCode);
  const offboarding = findCompletedOffboardingForProfile(profile, appData.hrProcesses);
  const { start: pStart, end: pEnd } = periodDateRange(period);
  const offboardingLastWorkingDate = (offboarding && offboarding.lastWorkingDate >= pStart && offboarding.lastWorkingDate <= pEnd)
    ? offboarding.lastWorkingDate : null;

  let contract = findActiveContractByEmployeeCode(appData.laborContracts, employeeCode);
  // PHÁT HIỆN (đợt rà soát theo kịch bản test chuyên sâu, sau đợt audit lần 2 ở dưới): applyOffboardingTermination()
  // (lib/laborContract.js) tự đóng hợp đồng ACTIVE thành TERMINATED NGAY lúc Offboarding hoàn tất — đúng
  // trình tự thực tế "Offboarding hoàn tất ngày 15 -> kế toán bấm Tính Lương ngày 28 CÙNG THÁNG" (kịch
  // bản LUONG-07), hợp đồng đã KHÔNG CÒN ACTIVE vào lúc tính lương nữa, khiến findActiveContractByEmployeeCode()
  // trả về null và nhân viên bị đẩy thẳng vào skipped[] (lý do "không có hợp đồng hiệu lực") TRƯỚC KHI
  // kịp chạm tới nhánh dự phòng workModelInfo bên dưới — tái hiện lại ĐÚNG lỗi LUONG-07 mà nhánh đó định
  // sửa nhưng chưa đủ. Dùng lại ĐÚNG hợp đồng vừa bị đóng (mới nhất theo id — applyOffboardingTermination()
  // chỉ đóng ĐÚNG 1 hợp đồng ACTIVE tại thời điểm Offboarding hoàn tất, findContractsByEmployeeCode() lấy
  // TOÀN BỘ lịch sử bất kể trạng thái) CHỈ khi có Offboarding hoàn tất đúng người này rơi trong kỳ — hợp
  // đồng hết hiệu lực vì lý do KHÁC (hết hạn tự nhiên, chấm dứt thủ công không qua Offboarding...) vẫn bị
  // skip như cũ, đúng nguyên tắc "không tự suy diễn khi thiếu xác nhận" nêu ở đầu file.
  if (!contract && offboardingLastWorkingDate) {
    const candidates = findContractsByEmployeeCode(appData.laborContracts, employeeCode);
    if (candidates.length) contract = candidates.reduce((a, b) => (b.id > a.id ? b : a));
  }
  if (!contract || !contract.baseSalary) return { skipped: true, reason: 'Không có hợp đồng lao động đang hiệu lực kèm lương cơ bản' };

  let workModelInfo = resolveWorkModelForEmployeeCode(employeeCode, appData);
  // PHÁT HIỆN ở đợt audit chuyên sâu lần 2: resolveWorkModelForEmployeeCode() CHẶN HẲN hồ sơ INACTIVE
  // (đúng ý — chặn máy chấm công/tạo công tay cho người đã nghỉ, xem lib/attendance.js) — nhưng payroll
  // dùng LẠI đúng hàm đó nên nhân viên hoàn tất Offboarding NGAY TRONG kỳ lương (nghỉ giữa tháng) bị BỎ
  // SÓT HOÀN TOÀN, không có payslip nào dù đã làm việc 1 phần kỳ. Nhánh dự phòng CHỈ áp dụng riêng cho
  // payroll (không đổi hành vi dùng chung của hàm trên): nếu có quy trình Offboarding ĐÃ HOÀN TẤT của
  // đúng nhân viên này với lastWorkingDate rơi trong kỳ (đã tính sẵn ở offboardingLastWorkingDate phía
  // trên), vẫn coi là có mô hình chấm công để tính. LƯU Ý PHẠM VI: KHÔNG tự bịa công thức trừ lương tương
  // ứng những ngày sau lastWorkingDate (đúng nguyên tắc "không tự tính công thức chưa có nguồn dữ liệu
  // xác nhận" nêu ở đầu file) — kế toán rà soát payslip này và dùng "Điều chỉnh dòng lương"
  // (applyAdjustPayslipDetail) để trừ đúng phần ngày không làm việc.
  if (!workModelInfo && offboardingLastWorkingDate) {
    workModelInfo = {
      workModel: offboarding.employeePosType === 'STORE' ? 'SHIFT_BASED' : 'OFFICE_HOURS',
      dept: offboarding.employeeDept || null, profile, user: null
    };
  }
  if (!workModelInfo) return { skipped: true, reason: 'Không xác định được mô hình chấm công (hồ sơ chưa liên kết tài khoản)' };

  const { start, end: periodEnd } = periodDateRange(period);
  const end = offboardingLastWorkingDate && offboardingLastWorkingDate < periodEnd ? offboardingLastWorkingDate : periodEnd;
  const records = (appData.attendanceRecords || []).filter(r => r.employeeCode === employeeCode && r.workDate >= start && r.workDate <= end);
  const baseSalary = Number(contract.baseSalary);
  const standardDays = workModelInfo.workModel === 'SHIFT_BASED' ? Number(rateConfig.standardWorkDaysStore) || 26 : Number(rateConfig.standardWorkDaysHo) || 22;
  const dailyRate = standardDays > 0 ? baseSalary / standardDays : 0;
  const hourlyRate = dailyRate / (Number(rateConfig.standardHoursPerDay) || 8);

  const workDays = records.filter(r => ['WORK', 'LEAVE_PAID', 'SICK_LEAVE', 'BUSINESS_TRIP'].includes(r.recordType)).length;
  const unpaidDays = records.filter(r => ['LEAVE_UNPAID', 'LEAVE_PERSONAL'].includes(r.recordType)).length;

  const details = [];
  addDetail(details, 'BASIC_SALARY', baseSalary,
    offboardingLastWorkingDate
      ? `Theo hợp đồng lao động — nghỉ việc ngày ${offboardingLastWorkingDate} giữa kỳ, CHƯA trừ tương ứng số ngày không làm việc, kế toán cần rà soát + Điều chỉnh dòng lương`
      : 'Theo hợp đồng lao động đang hiệu lực',
    false);

  let ot150 = 0, ot200 = 0, ot300 = 0;
  for (const r of records) {
    if (r.recordType !== 'OVERTIME' || !r.hoursWorked) continue;
    const multiplier = r.isHolidayWork ? Number(rateConfig.otMultiplierHoliday) || 3
      : r.isWeekendWork ? Number(rateConfig.otMultiplierWeekend) || 2
      : Number(rateConfig.otMultiplierNormal) || 1.5;
    const amount = Number(r.hoursWorked) * hourlyRate * multiplier;
    if (multiplier >= 3) ot300 += amount; else if (multiplier >= 2) ot200 += amount; else ot150 += amount;
  }
  addDetail(details, 'OT_150', ot150, `Làm thêm giờ hệ số ${rateConfig.otMultiplierNormal}`, false);
  addDetail(details, 'OT_200', ot200, `Làm thêm giờ hệ số ${rateConfig.otMultiplierWeekend}`, false);
  addDetail(details, 'OT_300', ot300, `Làm thêm giờ hệ số ${rateConfig.otMultiplierHoliday}`, false);

  if (unpaidDays > 0) addDetail(details, 'UNPAID_LEAVE_DEDUCT', unpaidDays * dailyRate, `${unpaidDays} ngày nghỉ không lương × ${Math.round(dailyRate).toLocaleString('vi-VN')}đ/ngày`, false);

  const grossSoFar = sumDetails(details, 'INCOME');
  const insuranceSalary = Math.min(baseSalary, Number(rateConfig.bhxhCap) || Infinity);
  const bhxh = insuranceSalary * (Number(rateConfig.bhxhPercent) || 0) / 100;
  const bhyt = insuranceSalary * (Number(rateConfig.bhytPercent) || 0) / 100;
  const bhtn = insuranceSalary * (Number(rateConfig.bhtnPercent) || 0) / 100;
  addDetail(details, 'SOCIAL_INSURANCE', bhxh, `${rateConfig.bhxhPercent}% trên ${Math.round(insuranceSalary).toLocaleString('vi-VN')}đ`, false);
  addDetail(details, 'HEALTH_INSURANCE', bhyt, `${rateConfig.bhytPercent}% trên ${Math.round(insuranceSalary).toLocaleString('vi-VN')}đ`, false);
  addDetail(details, 'UNEMPLOYMENT_INSURANCE', bhtn, `${rateConfig.bhtnPercent}% trên ${Math.round(insuranceSalary).toLocaleString('vi-VN')}đ`, false);

  const dependentCount = (profile?.dependents || []).length;
  const unpaidLeaveAmount = sumDetails(details.filter(d => d.componentCode === 'UNPAID_LEAVE_DEDUCT'), 'DEDUCTION');
  const taxableBase = grossSoFar - (bhxh + bhyt + bhtn) - unpaidLeaveAmount
    - (Number(rateConfig.personalDeduction) || 0) - dependentCount * (Number(rateConfig.dependentDeduction) || 0);
  const tax = computeTaxFromBrackets(taxableBase, rateConfig.taxBrackets);
  addDetail(details, 'PERSONAL_INCOME_TAX', tax, `Thu nhập chịu thuế ${Math.max(0, Math.round(taxableBase)).toLocaleString('vi-VN')}đ (${dependentCount} người phụ thuộc)`, false);

  const grossIncome = sumDetails(details, 'INCOME');
  const totalDeduction = sumDetails(details, 'DEDUCTION');
  return {
    skipped: false,
    employeeCode, employeeUsername: workModelInfo.user?.username || profile?.username || null,
    contractId: contract.id, dept: contract.dept || workModelInfo.dept || null, workModel: workModelInfo.workModel,
    workDays, standardDays, unpaidDays,
    details, grossIncome: Math.round(grossIncome), totalDeduction: Math.round(totalDeduction),
    netPay: Math.round(grossIncome - totalDeduction)
  };
}

function defaultPayslip(period, computed) {
  return {
    code: `PL-${period.id}-${computed.employeeCode}`,
    periodId: period.id, periodMonth: period.periodMonth, periodYear: period.periodYear,
    employeeCode: computed.employeeCode, employeeUsername: computed.employeeUsername,
    dept: computed.dept, workModel: computed.workModel,
    workDays: computed.workDays, standardDays: computed.standardDays, unpaidDays: computed.unpaidDays,
    details: computed.details, grossIncome: computed.grossIncome, totalDeduction: computed.totalDeduction, netPay: computed.netPay,
    viewedByEmployeeAt: null,
    createdAt: nowVN(), updatedAt: nowVN()
  };
}

function assertValidNewPeriod(payload, existingPeriods) {
  const periodMonth = Number(payload.periodMonth);
  const periodYear = Number(payload.periodYear);
  if (!Number.isInteger(periodMonth) || periodMonth < 1 || periodMonth > 12) throw new HttpError(400, 'Tháng không hợp lệ');
  if (!Number.isInteger(periodYear) || periodYear < 2020 || periodYear > 2100) throw new HttpError(400, 'Năm không hợp lệ');
  if ((existingPeriods || []).some(p => p.periodMonth === periodMonth && p.periodYear === periodYear)) {
    throw new HttpError(409, `Đã tồn tại kỳ lương Tháng ${periodMonth}/${periodYear}`);
  }
  const periodName = String(payload.periodName || `Lương Tháng ${String(periodMonth).padStart(2, '0')}/${periodYear}`).trim().slice(0, 100);
  return { periodMonth, periodYear, periodName };
}

function defaultPeriod(valid, actorUsername, actorName) {
  return {
    periodName: valid.periodName, periodMonth: valid.periodMonth, periodYear: valid.periodYear,
    status: 'DRAFT', employeeCount: 0, skippedCount: 0, totalGross: 0, totalNet: 0,
    creator: actorUsername, creatorName: actorName,
    approvedBy: null, approvedByName: null, approvedAt: null,
    finalizedBy: null, finalizedAt: null, publishedAt: null,
    history: [{ action: 'CREATED', by: actorUsername, byName: actorName, time: nowVN(), detail: 'Tạo kỳ lương' }],
    createdAt: nowVN(), updatedAt: nowVN(), updatedBy: actorUsername
  };
}

function assertTransition(period, allowedFrom, actionLabel) {
  if (!allowedFrom.includes(period.status)) {
    throw new HttpError(409, `Không thể "${actionLabel}" — kỳ lương đang ở trạng thái không phù hợp`);
  }
}

function pushHistory(period, action, actorUsername, actorName, detail) {
  period.history = [...(period.history || []), { action, by: actorUsername, byName: actorName, time: nowVN(), detail: detail || null }];
  period.updatedAt = nowVN(); period.updatedBy = actorUsername;
}

function applySubmitForApproval(period, actorUsername, actorName) {
  assertTransition(period, ['DRAFT'], 'Gửi duyệt');
  if (!period.employeeCount) throw new HttpError(400, 'Vui lòng tính lương trước khi gửi duyệt');
  period.status = 'PENDING_APPROVAL';
  pushHistory(period, 'SUBMITTED', actorUsername, actorName, 'Gửi duyệt kỳ lương');
  return period;
}
function applyApprove(period, actorUsername, actorName) {
  assertTransition(period, ['PENDING_APPROVAL'], 'Duyệt');
  period.status = 'APPROVED'; period.approvedBy = actorUsername; period.approvedByName = actorName; period.approvedAt = nowVN();
  pushHistory(period, 'APPROVED', actorUsername, actorName, 'Duyệt kỳ lương');
  return period;
}
function applyReject(period, actorUsername, actorName, reason) {
  assertTransition(period, ['PENDING_APPROVAL'], 'Từ chối');
  period.status = 'DRAFT';
  pushHistory(period, 'REJECTED', actorUsername, actorName, reason ? String(reason).trim().slice(0, 500) : 'Từ chối — trả về rà soát lại');
  return period;
}
function applyFinalize(period, actorUsername, actorName) {
  assertTransition(period, ['APPROVED'], 'Chốt kỳ lương');
  period.status = 'FINALIZED'; period.finalizedBy = actorUsername; period.finalizedByName = actorName; period.finalizedAt = nowVN();
  pushHistory(period, 'FINALIZED', actorUsername, actorName, 'Chốt kỳ lương — khoá không sửa được nữa');
  return period;
}
function applyPublish(period, actorUsername, actorName) {
  assertTransition(period, ['FINALIZED'], 'Công bố');
  period.status = 'PUBLISHED'; period.publishedAt = nowVN();
  pushHistory(period, 'PUBLISHED', actorUsername, actorName, 'Công bố phiếu lương cho nhân viên');
  return period;
}
function applyReopen(period, actorUsername, actorName, reason) {
  assertTransition(period, ['FINALIZED', 'PUBLISHED'], 'Mở lại');
  if (!reason || !String(reason).trim()) throw new HttpError(400, 'Vui lòng nhập lý do mở lại kỳ lương (bắt buộc ghi log)');
  const wasPublished = period.status === 'PUBLISHED';
  period.status = 'DRAFT'; period.approvedBy = null; period.approvedByName = null; period.approvedAt = null;
  period.finalizedBy = null; period.finalizedByName = null; period.finalizedAt = null; period.publishedAt = null;
  pushHistory(period, 'REOPENED', actorUsername, actorName, `${wasPublished ? '(Đã công bố) ' : ''}Lý do: ${String(reason).trim().slice(0, 500)}`);
  return period;
}

function assertValidDetailAdjustment(payload) {
  const componentCode = String(payload.componentCode || '').trim();
  if (!MANUAL_COMPONENT_CODES.has(componentCode)) {
    throw new HttpError(400, 'Mã thành phần lương không hợp lệ — chỉ sửa được các dòng nhập tay (phụ cấp/thưởng/tạm ứng/phạt)');
  }
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount)) throw new HttpError(400, 'Số tiền không hợp lệ');
  const note = payload.note ? String(payload.note).trim().slice(0, 300) : null;
  return { componentCode, amount: Math.round(amount), note };
}

// Áp 1 dòng điều chỉnh tay lên payslip (mutate tại chỗ) — nếu componentCode đã có dòng tay trước đó thì
// THAY THẾ (amount=0 hoặc rỗng -> caller tự lọc bỏ dòng, xem routes/payroll.js), không cộng dồn nhiều lần
// bấm lưu cùng 1 mã (tránh kế toán bấm lưu 2 lần = cộng đôi tiền).
function applyAdjustPayslipDetail(payslip, payload, actorUsername) {
  const { componentCode, amount, note } = assertValidDetailAdjustment(payload);
  const details = (payslip.details || []).filter(d => !(d.componentCode === componentCode && d.isManualAdjustment));
  if (amount !== 0) details.push({ componentCode, amount, note, isManualAdjustment: true, createdAt: nowVN(), createdBy: actorUsername });
  payslip.details = details;
  payslip.grossIncome = Math.round(sumDetails(details, 'INCOME'));
  payslip.totalDeduction = Math.round(sumDetails(details, 'DEDUCTION'));
  payslip.netPay = payslip.grossIncome - payslip.totalDeduction;
  payslip.updatedAt = nowVN();
  return payslip;
}

// Gộp lại các dòng ĐIỀU CHỈNH TAY (isManualAdjustment=true, xem applyAdjustPayslipDetail()) từ payslip
// CŨ vào payslip vừa tính lại tự động — PHÁT HIỆN ở đợt audit chuyên sâu lần 2: POST /periods/:id/calculate
// (routes/payroll.js) xoá HẲN mọi payslip cũ của kỳ rồi dựng lại HOÀN TOÀN MỚI từ computeEmployeePayslip()
// (chỉ có các dòng TỰ ĐỘNG isManualAdjustment=false) — kế toán cần tính lại CHỈ 1 người (VD thêm nhân
// viên mới sót/sửa lỗi chấm công) buộc phải chạy lại CẢ KỲ, xoá sạch luôn phụ cấp/thưởng/tạm ứng/phạt đã
// nhập tay cho MỌI nhân viên KHÁC trong kỳ đó — mất dữ liệu tài chính đã chốt mà không hề cảnh báo.
function mergeManualAdjustmentsIntoPayslip(record, manualDetails) {
  if (!manualDetails || !manualDetails.length) return record;
  record.details = [...record.details, ...manualDetails];
  record.grossIncome = Math.round(sumDetails(record.details, 'INCOME'));
  record.totalDeduction = Math.round(sumDetails(record.details, 'DEDUCTION'));
  record.netPay = record.grossIncome - record.totalDeduction;
  return record;
}

module.exports = {
  PERIOD_STATUSES, PAYROLL_COMPONENTS, MANUAL_COMPONENT_CODES,
  defaultRateConfig, canManagePayroll, canApprovePayroll, canViewAllPayroll,
  computeTaxFromBrackets, periodDateRange, computeEmployeePayslip, defaultPayslip,
  assertValidNewPeriod, defaultPeriod,
  applySubmitForApproval, applyApprove, applyReject, applyFinalize, applyPublish, applyReopen,
  assertValidDetailAdjustment, applyAdjustPayslipDetail, mergeManualAdjustmentsIntoPayslip
};
