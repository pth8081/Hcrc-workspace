// routes/payroll.js — Module Lương (Nhân Sự > Lương). Route RIÊNG (không qua GET /api/data chung) vì
// payslips là dữ liệu nhạy cảm nhất hệ thống (Mục 11 tài liệu gốc) — mọi lượt đọc payslip của người khác
// PHẢI qua đúng 1 trong 2 cửa có kiểm tra rõ ràng ở đây: (a) hrPayrollManage/hrPayrollApprove xem TOÀN
// BỘ payslip trong 1 kỳ (GET /periods/:id/payslips), (b) chính nhân viên xem CỦA MÌNH qua /my-payslips*
// — employeeCode LUÔN suy ra từ req.freshUser.username (qua employeeProfiles liên kết), KHÔNG BAO GIỜ
// nhận employeeCode/periodId đối tượng từ query/param để tự ý tra người khác (nguyên tắc IDOR-safe nêu
// rõ ở Mục 10 tài liệu gốc). KHÔNG có endpoint PDF server-side — xuất PDF làm ở CLIENT bằng jsPDF+
// html2canvas (đúng pattern đã dùng cho các phiếu/báo cáo khác trong hệ thống, xem module-luong.js).
const express = require('express');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const { getAllAppData, withLockedAppDataValue } = require('../lib/appData');
const { getAllForCollection, insertRecord, deleteRecordById, deleteRecordForCollection, replaceRecordsInCollection, withLockedRecordForCollection, withLockedRecordById, withAppLock } = require('../lib/recordStore');
const { findProfileByUsername } = require('../lib/employeeProfile');
const { notifyUsers } = require('../lib/notifications');
const payroll = require('../lib/payroll');
const { hasModuleAccessServer } = require('../lib/recordViewScope');
const { insertSystemLog } = require('../lib/systemLogStore');

// LỖI ĐÃ VÁ (rà soát chuyên sâu cụm Nhân Sự vòng 2, mức Trung bình): router này TRƯỚC ĐÂY chỉ gác
// requireAuth/blockIfMustChangePassword, KHÔNG kiểm moduleAccess.hrPayroll (Khối 0) — tắt module "Lương"
// cho 1 tài khoản ở màn Phân Quyền KHÔNG cản được họ gọi thẳng API nếu còn quyền dữ liệu chi tiết
// (hrPayrollManage/hrPayrollApprove...), khác hẳn Hồ Sơ Nhân Sự đã gác đúng ở vòng 1 (xem
// requireHrProfileModuleAccess() ở routes/employeeProfile.js). hasModuleAccessServer() đã sẵn có đúng
// entry 'hrPayroll' (MODULE_ACCESS_PARENTS, lib/recordViewScope.js) — chỉ thiếu chỗ gọi.
function requireHrPayrollModuleAccess(req, res, next) {
  if (!hasModuleAccessServer(req.freshUser, 'hrPayroll')) {
    return res.status(403).json({ error: 'Bạn không có quyền truy cập module này' });
  }
  next();
}
router.use(requireAuth, blockIfMustChangePassword, requireHrPayrollModuleAccess);

function requireManage(req, res, next) {
  if (!payroll.canManagePayroll(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền quản lý Lương' });
  next();
}
function requireViewAll(req, res, next) {
  if (!payroll.canViewAllPayroll(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền xem dữ liệu Lương' });
  next();
}

// PHÁT HIỆN theo yêu cầu người dùng (10/2026, dữ liệu lương là nhạy cảm nhất hệ thống): ghi log mọi thao
// tác THAY ĐỔI (không log các GET xem) để đối chiếu khi cần — song song với việc bỏ quyền admin mặc định
// khỏi hrPayrollManage/hrPayrollApprove (xem lib/payroll.js).
function logPayrollAction(req, actionType, targetObject, description) {
  insertSystemLog({
    username: req.freshUser.username, fullName: req.freshUser.name || req.freshUser.username, ipAddress: req.ip,
    module: 'PAYROLL', actionType, targetObject, description, status: 'SUCCESS'
  }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (Lương):', e.message));
}

async function buildComputationAppData(req) {
  const [plainAppData, laborContracts, attendanceRecords, hrProcesses] = await Promise.all([
    getAllAppData(), getAllForCollection('laborContracts'), getAllForCollection('attendanceRecords'), getAllForCollection('hrProcesses')
  ]);
  const rateConfig = Object.assign(payroll.defaultRateConfig(), plainAppData.payrollRateConfig || {});
  const appData = Object.assign({}, plainAppData, { laborContracts, attendanceRecords, hrProcesses, users: req.allUsers });
  return { appData, rateConfig };
}

// ===== Cấu hình % BHXH/BHYT/BHTN, biểu thuế, trần đóng BH, ngày công chuẩn — xem điều chỉnh #4
// lib/payroll.js. Route RIÊNG (không qua /api/data) để cho phép hrPayrollManage sửa (KHÔNG chỉ admin —
// kế toán trưởng có thể không phải admin hệ thống) trong khi vẫn chặn user thường qua /api/data (xem
// ADMIN_ONLY_WRITE_KEYS ở routes/data.js). =====
router.get('/rate-config', requireViewAll, async (req, res) => {
  try {
    const data = await getAllAppData();
    res.json({ config: Object.assign(payroll.defaultRateConfig(), data.payrollRateConfig || {}) });
  } catch (err) { sendCatchError(res, err, 'GET /api/payroll/rate-config'); }
});
router.put('/rate-config', requireManage, async (req, res) => {
  try {
    const body = req.body || {};
    const next = Object.assign(payroll.defaultRateConfig(), {
      bhxhPercent: Number(body.bhxhPercent), bhytPercent: Number(body.bhytPercent), bhtnPercent: Number(body.bhtnPercent),
      bhxhCap: Number(body.bhxhCap), personalDeduction: Number(body.personalDeduction), dependentDeduction: Number(body.dependentDeduction),
      standardWorkDaysHo: Number(body.standardWorkDaysHo), standardWorkDaysStore: Number(body.standardWorkDaysStore),
      standardHoursPerDay: Number(body.standardHoursPerDay),
      otMultiplierNormal: Number(body.otMultiplierNormal), otMultiplierWeekend: Number(body.otMultiplierWeekend), otMultiplierHoliday: Number(body.otMultiplierHoliday),
      taxBrackets: Array.isArray(body.taxBrackets) && body.taxBrackets.length ? body.taxBrackets.map(b => ({
        upTo: b.upTo === null || b.upTo === '' ? null : Number(b.upTo), rate: Number(b.rate)
      })) : payroll.defaultRateConfig().taxBrackets,
      updatedAt: new Date().toLocaleString('vi-VN'), updatedBy: req.freshUser.username
    });
    for (const [k, v] of Object.entries(next)) {
      if (['taxBrackets', 'updatedAt', 'updatedBy'].includes(k)) continue;
      if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: `Giá trị "${k}" không hợp lệ` });
    }
    // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu cụm Nhân Sự, 10/2026, mức Trung bình): vòng kiểm ở trên chỉ chặn
    // số âm/không phải số — CHO QUA số 0 cho các hằng số dùng làm MẪU SỐ khi tính lương
    // (standardWorkDaysHo/Store, standardHoursPerDay: dailyRate = baseSalary / standardDays, hourlyRate =
    // dailyRate / standardHoursPerDay — xem computeEmployeePayslip()). Đặt 0 làm mọi phiếu lương của kỳ
    // ra Infinity/NaN (lương làm thêm giờ, trừ nghỉ không lương...) mà không có cảnh báo nào. Cũng không
    // có TRẦN cho % BHXH/BHYT/BHTN — gõ nhầm 800 thay vì 8 thì trừ gấp 100 lần lương bảo hiểm.
    const POSITIVE_ONLY_KEYS = {
      standardWorkDaysHo: 'Ngày công chuẩn (Khối Văn Phòng)',
      standardWorkDaysStore: 'Ngày công chuẩn (Siêu Thị)',
      standardHoursPerDay: 'Số giờ công chuẩn/ngày'
    };
    for (const [k, label] of Object.entries(POSITIVE_ONLY_KEYS)) {
      if (!(next[k] > 0)) return res.status(400).json({ error: `"${label}" phải lớn hơn 0 (giá trị này được dùng làm mẫu số khi tính lương ngày/giờ)` });
    }
    const PERCENT_KEYS = { bhxhPercent: 'BHXH', bhytPercent: 'BHYT', bhtnPercent: 'BHTN' };
    for (const [k, label] of Object.entries(PERCENT_KEYS)) {
      if (next[k] > 100) return res.status(400).json({ error: `Tỷ lệ ${label} phải nằm trong khoảng 0-100%` });
    }
    for (const b of next.taxBrackets) {
      if (!Number.isFinite(b.rate) || b.rate < 0 || b.rate > 100) return res.status(400).json({ error: 'Bậc thuế TNCN không hợp lệ' });
      if (b.upTo !== null && (!Number.isFinite(b.upTo) || b.upTo <= 0)) return res.status(400).json({ error: 'Ngưỡng bậc thuế TNCN không hợp lệ' });
    }
    await withLockedAppDataValue('payrollRateConfig', () => next);
    logPayrollAction(req, 'RATE_CONFIG_UPDATE', 'payrollRateConfig', 'Cập nhật cấu hình tính lương (BHXH/BHYT/BHTN/thuế TNCN)');
    res.json({ ok: true, config: next });
  } catch (err) { sendCatchError(res, err, 'PUT /api/payroll/rate-config'); }
});

// ===== Tính lương tự động cho toàn bộ nhân viên ACTIVE trong kỳ — GHI ĐÈ mọi payslip cũ của kỳ này
// (chỉ cho phép khi kỳ đang DRAFT — xem payroll.assertTransition), CẢNH BÁO client trước khi gọi nếu đã
// có điều chỉnh tay (client tự kiểm tra period.employeeCount > 0 trước khi hỏi lại người dùng). =====
// Xoá kỳ lương tạo nhầm (sai tháng/năm/tên) — CHỈ khi còn DRAFT và chưa từng tính lương (assertCanDeletePeriod()
// ở lib/payroll.js). Kỳ đã tính/qua bất kỳ bước duyệt nào phải giữ lại làm lịch sử, không xoá được.
router.post('/periods/:id/delete', requireManage, async (req, res) => {
  const periodId = Number(req.params.id);
  if (!Number.isFinite(periodId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const periods = await getAllForCollection('payrollPeriods');
    const period = periods.find(p => p.id === periodId);
    if (!period) return res.status(404).json({ error: 'Không tìm thấy kỳ lương' });
    await deleteRecordForCollection('payrollPeriods', periodId, (item) => payroll.assertCanDeletePeriod(item), { username: req.freshUser.username, name: req.freshUser.name });
    logPayrollAction(req, 'PERIOD_DELETE', period.periodName, `Xoá kỳ lương [${period.periodName}] (còn Nháp, chưa từng tính lương)`);
    res.json({ ok: true });
  } catch (err) { sendCatchError(res, err, `POST /api/payroll/periods/${req.params.id}/delete`); }
});

// LỖI ĐÃ VÁ (rà soát chuyên sâu cụm Nhân Sự vòng 2, mức Trung bình): route này TRƯỚC ĐÂY đọc
// period.status/existingPayslips NGOÀI mọi khoá — 2 lượt bấm "Tính Lương Tự Động" gần như đồng thời
// (double-click, hoặc 2 kế toán cùng bấm) đều đọc existingPayslips=[cũ] TRƯỚC KHI lượt kia kịp ghi xong,
// nên cả 2 đều gọi replaceRecordsInCollection() với cùng danh sách id cần xoá — lượt sau KHÔNG xoá được
// payslip lượt trước vừa ghi (đã đổi id khác), kết quả NHÂN ĐÔI toàn bộ phiếu lương của kỳ. Bọc TOÀN BỘ
// route trong withAppLock() (cùng khuôn checklistTemplates/:id/activate ở routes/checklist.js) để 2 lượt
// gọi đồng thời tự xếp hàng tuần tự — đọc lại period.status/existingPayslips ĐÚNG BÊN TRONG khoá này.
// record.id = Date.now() + idSeq: khoá đã đủ chặn 2 lượt TÍNH chạy chồng nhau nên không còn rủi ro trùng
// id giữa 2 lượt gọi lệch nhau vài mili-giây (mỗi lượt luôn thấy Date.now() mới nhất của chính nó, không
// còn interleave với lượt khác) — giữ nguyên công thức cũ.
router.post('/periods/:id/calculate', requireManage, async (req, res) => {
  const periodId = Number(req.params.id);
  if (!Number.isFinite(periodId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { updated, skipped, computedCount } = await withAppLock(`payroll_calculate:${periodId}`, async () => {
      const periods = await getAllForCollection('payrollPeriods');
      const period = periods.find(p => p.id === periodId);
      if (!period) throw new HttpError(404, 'Không tìm thấy kỳ lương');
      if (period.status !== 'DRAFT') throw new HttpError(409, 'Chỉ tính lương được khi kỳ đang ở trạng thái Nháp');

      const { appData, rateConfig } = await buildComputationAppData(req);
      // PHÁT HIỆN ở đợt audit chuyên sâu lần 2: chỉ lọc status==='ACTIVE' bỏ sót HOÀN TOÀN nhân viên vừa
      // hoàn tất Offboarding NGAY TRONG kỳ lương (nghỉ giữa tháng, status đã chuyển INACTIVE trước khi HR
      // bấm "Tính Lương") — không có payslip nào cho những ngày đã làm việc trước khi nghỉ. Bổ sung nhánh
      // INACTIVE có Offboarding COMPLETED với lastWorkingDate rơi trong kỳ (computeEmployeePayslip() tự xử
      // lý nhánh này, xem lib/payroll.js) — LƯU Ý: hệ thống KHÔNG tự bịa công thức trừ lương tương ứng
      // những ngày sau lastWorkingDate, payslip sinh ra sẽ có ghi chú để kế toán tự rà soát/điều chỉnh.
      const { start: periodStart, end: periodEnd } = payroll.periodDateRange(period);
      const activeProfiles = (appData.employeeProfiles || []).filter(p => p.status === 'ACTIVE');
      const offboardedMidPeriodProfiles = (appData.employeeProfiles || []).filter(p => p.status === 'INACTIVE' &&
        (appData.hrProcesses || []).some(h => h.processType === 'OFFBOARDING' && h.status === 'COMPLETED' &&
          h.employeeUsername === p.username && h.lastWorkingDate >= periodStart && h.lastWorkingDate <= periodEnd));
      const skippedList = [];
      const computedList = [];
      for (const profile of [...activeProfiles, ...offboardedMidPeriodProfiles]) {
        const result = payroll.computeEmployeePayslip(profile.employeeCode, period, appData, rateConfig);
        if (result.skipped) { skippedList.push({ employeeCode: profile.employeeCode, reason: result.reason }); continue; }
        computedList.push(result);
      }

      const existingPayslips = (await getAllForCollection('payslips')).filter(p => p.periodId === periodId);
      // PHÁT HIỆN ở đợt audit chuyên sâu lần 2: tính lại CẢ KỲ (VD chỉ để sửa/thêm 1 người) trước đây xoá
      // trắng LUÔN mọi dòng "Điều chỉnh dòng lương" (phụ cấp/thưởng/tạm ứng/phạt nhập tay, isManualAdjustment)
      // đã chốt cho MỌI nhân viên KHÁC trong kỳ — giữ lại bằng cách gom trước rồi gộp lại vào payslip mới
      // (xem mergeManualAdjustmentsIntoPayslip() ở lib/payroll.js).
      const manualAdjustmentsByEmployee = new Map();
      for (const old of existingPayslips) {
        const manualLines = (old.details || []).filter(d => d.isManualAdjustment);
        if (manualLines.length) manualAdjustmentsByEmployee.set(old.employeeCode, manualLines);
      }
      // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu cụm Nhân Sự, 10/2026, mức Trung bình): trước đây xoá từng
      // payslip cũ rồi insert từng phiếu mới bằng N lệnh RIÊNG LẺ, KHÔNG atomic — lỗi ở giữa chừng làm
      // MẤT TRẮNG phần dữ liệu lương chưa kịp ghi lại (payslips xoá KHÔNG qua Thùng Rác). Nay gom cả
      // "xoá cũ + ghi mới" vào ĐÚNG 1 giao dịch SQL, rollback toàn bộ nếu lỗi — xem
      // lib/recordStore.js::replaceRecordsInCollection().
      let idSeq = 0;
      const newPayslips = computedList.map((computed) => {
        const record = payroll.defaultPayslip(period, computed);
        payroll.mergeManualAdjustmentsIntoPayslip(record, manualAdjustmentsByEmployee.get(computed.employeeCode), {
          rateConfig,
          dependentCount: ((appData.employeeProfiles || []).find(p => p.employeeCode === computed.employeeCode)?.dependents || []).length
        });
        record.id = Date.now() + (idSeq++);
        return record;
      });
      await replaceRecordsInCollection('payslips', existingPayslips.map(p => p.id), newPayslips);

      const totalGross = computedList.reduce((s, c) => s + c.grossIncome, 0);
      const totalNet = computedList.reduce((s, c) => s + c.netPay, 0);
      const updatedPeriod = await withLockedRecordForCollection('payrollPeriods', periodId, (p) => {
        if (p.status !== 'DRAFT') throw new HttpError(409, 'Kỳ lương không còn ở trạng thái Nháp — có thể vừa được người khác thao tác');
        p.employeeCount = computedList.length; p.skippedCount = skippedList.length;
        p.totalGross = Math.round(totalGross); p.totalNet = Math.round(totalNet);
        p.history = [...(p.history || []), {
          action: 'CALCULATED', by: req.freshUser.username, byName: req.freshUser.name, time: new Date().toLocaleString('vi-VN'),
          detail: `Tính lương tự động: ${computedList.length} nhân viên${skippedList.length ? `, bỏ qua ${skippedList.length} người (xem chi tiết)` : ''}`
        }];
        p.updatedAt = new Date().toLocaleString('vi-VN'); p.updatedBy = req.freshUser.username;
        return p;
      });
      return { updated: updatedPeriod, skipped: skippedList, computedCount: computedList.length };
    });
    logPayrollAction(req, 'CALCULATE', String(periodId), `Tính lương tự động kỳ #${periodId}: ${computedCount} nhân viên${skipped.length ? `, bỏ qua ${skipped.length} người` : ''}`);
    res.json({ ok: true, item: updated, skipped });
  } catch (err) { sendCatchError(res, err, `payroll/periods/${req.params.id}/calculate`); }
});

// Điều chỉnh 1 dòng thành phần lương NHẬP TAY của 1 payslip (thưởng/phạt/tạm ứng/phụ cấp phát sinh) —
// CHỈ trong lúc kỳ đang DRAFT (rà soát trước khi gửi duyệt, xem Mục 3 bước [3] tài liệu gốc).
router.patch('/payslips/:id/details', requireManage, async (req, res) => {
  const payslipId = Number(req.params.id);
  if (!Number.isFinite(payslipId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const periods = await getAllForCollection('payrollPeriods');
    // taxContext — cấu hình thuế/giảm trừ + số người phụ thuộc của ĐÚNG nhân viên này, để tính LẠI thuế
    // TNCN ngay sau khi điều chỉnh làm đổi thu nhập chịu thuế (xem recomputePersonalIncomeTax() ở
    // lib/payroll.js — trước đây thu nhập nhập tay thoát thuế hoàn toàn).
    const appData = await getAllAppData();
    const rateConfig = Object.assign(payroll.defaultRateConfig(), appData.payrollRateConfig || {});
    const result = await withLockedRecordById('payslips', payslipId, (payslip) => {
      const period = periods.find(p => p.id === payslip.periodId);
      if (!period || period.status !== 'DRAFT') throw new HttpError(409, 'Chỉ điều chỉnh được khi kỳ lương đang ở trạng thái Nháp');
      const dependentCount = ((appData.employeeProfiles || []).find(p => p.employeeCode === payslip.employeeCode)?.dependents || []).length;
      return payroll.applyAdjustPayslipDetail(payslip, req.body || {}, req.freshUser.username, { rateConfig, dependentCount });
    });
    logPayrollAction(req, 'ADJUST_PAYSLIP', String(payslipId), 'Điều chỉnh dòng lương nhập tay của phiếu lương');
    res.json({ ok: true, item: result });
  } catch (err) { sendCatchError(res, err, `payroll/payslips/${req.params.id}/details`); }
});

router.get('/periods/:id/payslips', requireViewAll, async (req, res) => {
  const periodId = Number(req.params.id);
  if (!Number.isFinite(periodId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const all = await getAllForCollection('payslips');
    res.json({ payslips: all.filter(p => p.periodId === periodId) });
  } catch (err) { sendCatchError(res, err, `payroll/periods/${req.params.id}/payslips`); }
});

function periodTransitionRoute(path, guard, applyFn, historyNoteRequired, actionType) {
  router.post(path, guard, async (req, res) => {
    const periodId = Number(req.params.id);
    if (!Number.isFinite(periodId)) return res.status(400).json({ error: 'id không hợp lệ' });
    if (historyNoteRequired && (!req.body?.reason || !String(req.body.reason).trim())) {
      return res.status(400).json({ error: 'Vui lòng nhập lý do' });
    }
    try {
      // req.freshUser (5º tham số, LỖI ĐÃ VÁ #14) — thêm để applyApprove() biết actor có phải admin
      // không (bypass tự duyệt) mà không đổi chữ ký các applyFn khác đang chỉ dùng 4 tham số đầu.
      const updated = await withLockedRecordForCollection('payrollPeriods', periodId, (period) =>
        applyFn(period, req.freshUser.username, req.freshUser.name, req.body?.reason, req.freshUser)
      );
      logPayrollAction(req, actionType, String(periodId), `${actionType} kỳ lương #${periodId}${req.body?.reason ? ` — Lý do: ${req.body.reason}` : ''}`);
      res.json({ ok: true, item: updated });
    } catch (err) { sendCatchError(res, err, `payroll${path.replace(':id', req.params.id)}`); }
  });
}
periodTransitionRoute('/periods/:id/submit', requireManage, async (p, u, n) => {
  const payslips = (await getAllForCollection('payslips')).filter(s => s.periodId === p.id);
  return payroll.applySubmitForApproval(p, u, n, payslips);
}, false, 'SUBMIT');
periodTransitionRoute('/periods/:id/approve', (req, res, next) => {
  if (!payroll.canApprovePayroll(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền duyệt kỳ lương' });
  next();
}, (p, u, n, reason, actorUser) => payroll.applyApprove(p, u, n, actorUser), false, 'APPROVE');
// PHÁT HIỆN (đợt rà soát theo kịch bản test chuyên sâu, LUONG-04): route này TRƯỚC ĐÂY thiếu tham số
// `historyNoteRequired=true` (khác /reopen ngay dưới) — periodTransitionRoute() chỉ bắt buộc `reason`
// khi cờ này bật, nên Từ Chối một kỳ lương KHÔNG cần nhập lý do gì cả, dù applyReject() (lib/payroll.js)
// tự thay bằng 1 câu chung chung "Từ chối — trả về rà soát lại" khi thiếu — kế toán không biết ĐÍCH XÁC
// vì sao bị từ chối để sửa đúng chỗ.
periodTransitionRoute('/periods/:id/reject', (req, res, next) => {
  if (!payroll.canApprovePayroll(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền duyệt kỳ lương' });
  next();
}, (p, u, n, reason) => payroll.applyReject(p, u, n, reason), true, 'REJECT');
periodTransitionRoute('/periods/:id/finalize', requireViewAll, (p, u, n) => payroll.applyFinalize(p, u, n), false, 'FINALIZE');
// LỖI ĐÃ VÁ (rà soát chuyên sâu Nhân Sự, 9/2026): mở lại kỳ ĐÃ CÔNG BỐ phải xoá cờ "đã xem" trên từng
// payslip — xem chú thích đầy đủ tại applyReopen() (lib/payroll.js) — để nhân viên thấy lại đúng trạng
// thái "chưa xem" khi kế toán Công Bố lại số liệu đã sửa.
periodTransitionRoute('/periods/:id/reopen', requireManage, async (p, u, n, reason) => {
  const wasPublished = p.status === 'PUBLISHED';
  const updated = payroll.applyReopen(p, u, n, reason);
  if (wasPublished) {
    const payslips = (await getAllForCollection('payslips')).filter(s => s.periodId === p.id && s.viewedByEmployeeAt);
    for (const slip of payslips) {
      await withLockedRecordById('payslips', slip.id, (item) => { item.viewedByEmployeeAt = null; return item; });
    }
  }
  return updated;
}, true, 'REOPEN');

// Công bố — RIÊNG (không dùng periodTransitionRoute) vì cần tạo Notifications cho từng nhân viên có
// payslip trong kỳ SAU KHI period đã publish thành công (Mục 8 tài liệu gốc).
router.post('/periods/:id/publish', requireViewAll, async (req, res) => {
  const periodId = Number(req.params.id);
  if (!Number.isFinite(periodId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const updated = await withLockedRecordForCollection('payrollPeriods', periodId, (period) =>
      payroll.applyPublish(period, req.freshUser.username, req.freshUser.name)
    );
    const payslips = (await getAllForCollection('payslips')).filter(p => p.periodId === periodId);
    const usernames = payslips.map(p => p.employeeUsername).filter(Boolean);
    await notifyUsers(usernames, 'PAYSLIP_PUBLISHED', 'Có phiếu lương mới',
      `Phiếu lương ${updated.periodName} đã được công bố — bấm để xem chi tiết.`, `/payroll/my-payslips/${periodId}`);
    logPayrollAction(req, 'PUBLISH', String(periodId), `Công bố kỳ lương #${periodId} — thông báo ${usernames.length} nhân viên`);
    res.json({ ok: true, item: updated, notified: usernames.length });
  } catch (err) { sendCatchError(res, err, `payroll/periods/${req.params.id}/publish`); }
});

// ===== Tự xem — IDOR-safe: employeeCode LUÔN suy ra từ req.freshUser.username qua employeeProfiles,
// KHÔNG BAO GIỜ nhận từ query/param client gửi. =====
async function resolveOwnEmployeeCode(username) {
  const appData = await getAllAppData();
  const profile = findProfileByUsername(appData.employeeProfiles, username);
  if (!profile) throw new HttpError(404, 'Không tìm thấy hồ sơ nhân sự liên kết với tài khoản của bạn');
  return profile.employeeCode;
}

router.get('/my-payslips', async (req, res) => {
  try {
    // Khối 0: payslips không qua GET /api/data chung (dữ liệu lương nhạy cảm) nên phải tự chặn ở đây —
    // đợt test chuyên sâu 9/2026 (PQ, mục Phân Quyền) phát hiện trước đây route này bỏ qua Khối 0 hoàn
    // toàn, tắt moduleAccess.hrPayroll cho 1 user vẫn không cản được họ gọi thẳng route xem phiếu lương.
    if (!hasModuleAccessServer(req.freshUser, 'hrPayroll')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập module này' });
    }
    const employeeCode = await resolveOwnEmployeeCode(req.freshUser.username);
    const [payslips, periods] = await Promise.all([getAllForCollection('payslips'), getAllForCollection('payrollPeriods')]);
    const publishedPeriodIds = new Set(periods.filter(p => p.status === 'PUBLISHED').map(p => p.id));
    const mine = payslips
      .filter(p => p.employeeCode === employeeCode && publishedPeriodIds.has(p.periodId))
      .map(p => ({ id: p.id, periodId: p.periodId, periodMonth: p.periodMonth, periodYear: p.periodYear, netPay: p.netPay, viewedByEmployeeAt: p.viewedByEmployeeAt }))
      .sort((a, b) => (b.periodYear - a.periodYear) || (b.periodMonth - a.periodMonth));
    res.json({ payslips: mine });
  } catch (err) { sendCatchError(res, err, 'GET /api/payroll/my-payslips'); }
});

router.get('/my-payslips/:periodId', async (req, res) => {
  const periodId = Number(req.params.periodId);
  if (!Number.isFinite(periodId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    if (!hasModuleAccessServer(req.freshUser, 'hrPayroll')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập module này' });
    }
    const employeeCode = await resolveOwnEmployeeCode(req.freshUser.username);
    const [payslips, periods] = await Promise.all([getAllForCollection('payslips'), getAllForCollection('payrollPeriods')]);
    const period = periods.find(p => p.id === periodId);
    const payslip = payslips.find(p => p.periodId === periodId && p.employeeCode === employeeCode);
    if (!period || period.status !== 'PUBLISHED' || !payslip) return res.status(404).json({ error: 'Không tìm thấy phiếu lương' });
    if (!payslip.viewedByEmployeeAt) {
      await withLockedRecordById('payslips', payslip.id, (item) => {
        if (!item.viewedByEmployeeAt) item.viewedByEmployeeAt = new Date().toLocaleString('vi-VN');
        return item;
      });
      payslip.viewedByEmployeeAt = new Date().toLocaleString('vi-VN');
    }
    res.json({ payslip, period: { periodName: period.periodName, periodMonth: period.periodMonth, periodYear: period.periodYear, publishedAt: period.publishedAt } });
  } catch (err) { sendCatchError(res, err, `GET /api/payroll/my-payslips/${req.params.periodId}`); }
});

module.exports = router;
