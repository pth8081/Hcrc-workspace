// routes/attendanceClockPunch.js — API dành cho MÁY CHẤM CÔNG VẬT LÝ/hệ thống trung gian đẩy dữ liệu
// chấm công vào hệ thống (Nhân Sự > Công & Phép, Đợt 3/4 — xem lib/attendance.js đầu file cho toàn bộ
// điều chỉnh so với tài liệu gốc). Xác thực bằng API key RIÊNG (attendanceClockApiKeys, xem
// routes/attendanceClockAdmin.js) — KHÔNG dùng chung externalApiKeys (đã xác nhận với người dùng: tách
// riêng để giảm phạm vi ảnh hưởng nếu 1 trong 2 loại key bị lộ).
//
// KHÔNG mount sau requireAuth (server.js) — caller là máy chấm công, không có phiên đăng nhập HCRC, tự
// xác thực bằng API key trong header Authorization — mirror ĐÚNG cấu trúc routes/externalAuthVerify.js.
//
// POST /api/attendance/clock-punch
// Body: { employeeCode: string, timestamp: ISO string (mặc định = giờ máy chủ nhận request nếu thiếu) }
// Định danh nhân viên = employeeCode (khớp khoá thật employeeProfiles/laborContracts — đã xác nhận với
// người dùng, xem AskUserQuestion "Định danh chấm công"). KHÔNG phân biệt vào/ra bằng field riêng — máy
// chấm công phổ thông chỉ gửi mốc giờ, xem lib/attendance.js applyClockPunch().
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { getAllForCollection, createForCollection, withLockedRecordForCollection, withAppLock } = require('../lib/recordStore');
const { extractBearerToken, verifyApiKey, isIpAllowed } = require('../lib/externalAuth');
const attendance = require('../lib/attendance');
const { insertSystemLog } = require('../lib/systemLogStore');
const { sendServerError } = require('../lib/errorResponse');

// Cùng khuôn externalApiRateLimiter (routes/externalAuthVerify.js) — caller dự kiến là số lượng hữu hạn
// máy chấm công vật lý, không phải cả công ty. Ngưỡng CAO HƠN verify-credentials (mỗi máy có thể đẩy
// nhiều lượt quẹt/phút giờ cao điểm ra vào ca) — chỉnh qua .env (ATTENDANCE_CLOCK_RATE_LIMIT_MAX).
const attendanceClockRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parseInt(process.env.ATTENDANCE_CLOCK_RATE_LIMIT_MAX || '2000', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Đã gọi API chấm công quá nhiều lần từ nguồn này. Vui lòng thử lại sau ít phút.' }
});
router.use(attendanceClockRateLimiter);

function logClockAuth(req, { apiKeyName, employeeCode, actionType, description, status }) {
  insertSystemLog({
    username: employeeCode || 'unknown', fullName: apiKeyName ? `[Máy chấm công: ${apiKeyName}]` : 'unknown', ipAddress: req.ip,
    module: 'ATTENDANCE_CLOCK', actionType, targetObject: employeeCode || '', description, status
  }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (chấm công):', e.message));
}

async function findMatchingApiKey(rawKey) {
  if (!rawKey) return null;
  const list = (await getAppDataValue('attendanceClockApiKeys')) || [];
  const candidates = list.filter(k => k.active !== false && rawKey.startsWith(k.keyPrefix || ' '));
  for (const candidate of candidates) {
    if (await verifyApiKey(rawKey, candidate.keyHash)) return candidate;
  }
  return null;
}

function touchApiKeyLastUsed(id) {
  withLockedAppDataValue('attendanceClockApiKeys', (list) => {
    const current = Array.isArray(list) ? list : [];
    const idx = current.findIndex(k => k.id === id);
    if (idx === -1) return current;
    const updated = [...current];
    updated[idx] = { ...current[idx], lastUsedAt: new Date().toISOString() };
    return updated;
  }).catch(e => console.error('Lỗi cập nhật lastUsedAt cho API key chấm công:', e.message));
}

async function requireAttendanceClockApiKey(req, res, next) {
  try {
    const rawKey = extractBearerToken(req.headers.authorization);
    const apiKey = await findMatchingApiKey(rawKey);
    if (!apiKey) {
      logClockAuth(req, { actionType: 'API_KEY_INVALID', description: `Gọi ${req.method} ${req.path} với API key thiếu/sai/đã bị thu hồi`, status: 'FAILURE' });
      return res.status(401).json({ error: 'API key không hợp lệ' });
    }
    if (!isIpAllowed(req.ip, apiKey.allowedIps)) {
      logClockAuth(req, { apiKeyName: apiKey.name, actionType: 'API_KEY_IP_BLOCKED', description: `Gọi ${req.method} ${req.path} từ IP không nằm trong danh sách cho phép của key (IP thực: ${req.ip})`, status: 'FAILURE' });
      return res.status(403).json({ error: 'IP gọi không nằm trong danh sách được phép sử dụng API key này' });
    }
    touchApiKeyLastUsed(apiKey.id);
    req.attendanceClockApiKey = apiKey;
    next();
  } catch (err) {
    sendServerError(res, 500, err, `${req.method} ${req.path} (tra API key chấm công)`, 'Không thể xác thực yêu cầu');
  }
}
router.use(requireAttendanceClockApiKey);

router.post('/clock-punch', async (req, res) => {
  const employeeCode = String(req.body?.employeeCode || '').trim();
  const timestamp = req.body?.timestamp ? String(req.body.timestamp).trim() : new Date().toISOString();
  if (!employeeCode) return res.status(400).json({ error: 'Thiếu employeeCode' });
  if (Number.isNaN(new Date(timestamp).getTime())) return res.status(400).json({ error: 'timestamp không hợp lệ' });

  try {
    const [employeeProfiles, users, hrProcesses, attendanceHoConfig, publicHolidays] = await Promise.all([
      getAppDataValue('employeeProfiles'), getAppDataValue('users'), getAllForCollection('hrProcesses'),
      getAppDataValue('attendanceHoConfig'), getAppDataValue('publicHolidays')
    ]);
    const workModelInfo = attendance.resolveWorkModelForEmployeeCode(employeeCode, { employeeProfiles, users, hrProcesses });
    if (!workModelInfo) {
      logClockAuth(req, { apiKeyName: req.attendanceClockApiKey.name, employeeCode, actionType: 'CLOCK_PUNCH_UNKNOWN_EMPLOYEE', description: `Không xác định được nhân viên/mô hình chấm công cho employeeCode "${employeeCode}"`, status: 'FAILURE' });
      return res.status(400).json({ error: 'Không tìm thấy nhân viên hoặc chưa xác định được mô hình chấm công (hồ sơ chưa liên kết tài khoản)' });
    }

    const workDate = new Date(timestamp).toISOString().slice(0, 10);
    const lockKey = `attendanceRecords:${employeeCode}:${workDate}`;
    const savedRecord = await withAppLock(lockKey, async () => {
      const shiftRoster = workModelInfo.workModel === 'SHIFT_BASED' ? await getAllForCollection('shiftRoster') : [];
      const shiftTemplates = workModelInfo.workModel === 'SHIFT_BASED' ? (await getAppDataValue('shiftTemplates')) : [];
      const appDataForPunch = { attendanceHoConfig, publicHolidays, shiftRoster, shiftTemplates };
      const existingList = await getAllForCollection('attendanceRecords');
      const existing = existingList.find(r => r.employeeCode === employeeCode && r.workDate === workDate);
      const { record } = attendance.applyClockPunch(existingList, employeeCode, timestamp, workModelInfo, appDataForPunch);
      if (existing) {
        return withLockedRecordForCollection('attendanceRecords', existing.id, () => record);
      }
      return createForCollection('attendanceRecords', () => record);
    });

    logClockAuth(req, { apiKeyName: req.attendanceClockApiKey.name, employeeCode, actionType: 'CLOCK_PUNCH_RECORDED', description: `Ghi nhận chấm công ${employeeCode} lúc ${timestamp} (workDate=${workDate})`, status: 'SUCCESS' });
    res.json({ ok: true, item: savedRecord });
  } catch (err) {
    sendServerError(res, 500, err, 'POST /api/attendance/clock-punch', 'Không thể ghi nhận chấm công');
  }
});

module.exports = router;
