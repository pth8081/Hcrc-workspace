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
const { getAllForCollection, insertRecord, deleteRecordById, withLockedRecordForCollection, withLockedRecordById } = require('../lib/recordStore');
const { findProfileByUsername } = require('../lib/employeeProfile');
const { notifyUsers } = require('../lib/notifications');
const payroll = require('../lib/payroll');

router.use(requireAuth, blockIfMustChangePassword);

function requireManage(req, res, next) {
  if (!payroll.canManagePayroll(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền quản lý Lương' });
  next();
}
function requireViewAll(req, res, next) {
  if (!payroll.canViewAllPayroll(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền xem dữ liệu Lương' });
  next();
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
    for (const b of next.taxBrackets) {
      if (!Number.isFinite(b.rate) || b.rate < 0 || b.rate > 100) return res.status(400).json({ error: 'Bậc thuế TNCN không hợp lệ' });
      if (b.upTo !== null && (!Number.isFinite(b.upTo) || b.upTo <= 0)) return res.status(400).json({ error: 'Ngưỡng bậc thuế TNCN không hợp lệ' });
    }
    await withLockedAppDataValue('payrollRateConfig', () => next);
    res.json({ ok: true, config: next });
  } catch (err) { sendCatchError(res, err, 'PUT /api/payroll/rate-config'); }
});

// ===== Tính lương tự động cho toàn bộ nhân viên ACTIVE trong kỳ — GHI ĐÈ mọi payslip cũ của kỳ này
// (chỉ cho phép khi kỳ đang DRAFT — xem payroll.assertTransition), CẢNH BÁO client trước khi gọi nếu đã
// có điều chỉnh tay (client tự kiểm tra period.employeeCount > 0 trước khi hỏi lại người dùng). =====
router.post('/periods/:id/calculate', requireManage, async (req, res) => {
  const periodId = Number(req.params.id);
  if (!Number.isFinite(periodId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const periods = await getAllForCollection('payrollPeriods');
    const period = periods.find(p => p.id === periodId);
    if (!period) return res.status(404).json({ error: 'Không tìm thấy kỳ lương' });
    if (period.status !== 'DRAFT') return res.status(409).json({ error: 'Chỉ tính lương được khi kỳ đang ở trạng thái Nháp' });

    const { appData, rateConfig } = await buildComputationAppData(req);
    const activeProfiles = (appData.employeeProfiles || []).filter(p => p.status === 'ACTIVE');
    const skipped = [];
    const computedList = [];
    for (const profile of activeProfiles) {
      const result = payroll.computeEmployeePayslip(profile.employeeCode, period, appData, rateConfig);
      if (result.skipped) { skipped.push({ employeeCode: profile.employeeCode, reason: result.reason }); continue; }
      computedList.push(result);
    }

    const existingPayslips = (await getAllForCollection('payslips')).filter(p => p.periodId === periodId);
    for (const old of existingPayslips) await deleteRecordById('payslips', old.id);
    let idSeq = 0;
    for (const computed of computedList) {
      const record = payroll.defaultPayslip(period, computed);
      record.id = Date.now() + (idSeq++);
      await insertRecord('payslips', record);
    }

    const totalGross = computedList.reduce((s, c) => s + c.grossIncome, 0);
    const totalNet = computedList.reduce((s, c) => s + c.netPay, 0);
    const updated = await withLockedRecordForCollection('payrollPeriods', periodId, (p) => {
      if (p.status !== 'DRAFT') throw new HttpError(409, 'Kỳ lương không còn ở trạng thái Nháp — có thể vừa được người khác thao tác');
      p.employeeCount = computedList.length; p.skippedCount = skipped.length;
      p.totalGross = Math.round(totalGross); p.totalNet = Math.round(totalNet);
      p.history = [...(p.history || []), {
        action: 'CALCULATED', by: req.freshUser.username, byName: req.freshUser.name, time: new Date().toLocaleString('vi-VN'),
        detail: `Tính lương tự động: ${computedList.length} nhân viên${skipped.length ? `, bỏ qua ${skipped.length} người (xem chi tiết)` : ''}`
      }];
      p.updatedAt = new Date().toLocaleString('vi-VN'); p.updatedBy = req.freshUser.username;
      return p;
    });
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
    const result = await withLockedRecordById('payslips', payslipId, (payslip) => {
      const period = periods.find(p => p.id === payslip.periodId);
      if (!period || period.status !== 'DRAFT') throw new HttpError(409, 'Chỉ điều chỉnh được khi kỳ lương đang ở trạng thái Nháp');
      return payroll.applyAdjustPayslipDetail(payslip, req.body || {}, req.freshUser.username);
    });
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

function periodTransitionRoute(path, guard, applyFn, historyNoteRequired) {
  router.post(path, guard, async (req, res) => {
    const periodId = Number(req.params.id);
    if (!Number.isFinite(periodId)) return res.status(400).json({ error: 'id không hợp lệ' });
    if (historyNoteRequired && (!req.body?.reason || !String(req.body.reason).trim())) {
      return res.status(400).json({ error: 'Vui lòng nhập lý do' });
    }
    try {
      const updated = await withLockedRecordForCollection('payrollPeriods', periodId, (period) =>
        applyFn(period, req.freshUser.username, req.freshUser.name, req.body?.reason)
      );
      res.json({ ok: true, item: updated });
    } catch (err) { sendCatchError(res, err, `payroll${path.replace(':id', req.params.id)}`); }
  });
}
periodTransitionRoute('/periods/:id/submit', requireManage, (p, u, n) => payroll.applySubmitForApproval(p, u, n));
periodTransitionRoute('/periods/:id/approve', (req, res, next) => {
  if (!payroll.canApprovePayroll(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền duyệt kỳ lương' });
  next();
}, (p, u, n) => payroll.applyApprove(p, u, n));
periodTransitionRoute('/periods/:id/reject', (req, res, next) => {
  if (!payroll.canApprovePayroll(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền duyệt kỳ lương' });
  next();
}, (p, u, n, reason) => payroll.applyReject(p, u, n, reason));
periodTransitionRoute('/periods/:id/finalize', requireViewAll, (p, u, n) => payroll.applyFinalize(p, u, n));
periodTransitionRoute('/periods/:id/reopen', requireManage, (p, u, n, reason) => payroll.applyReopen(p, u, n, reason), true);

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
