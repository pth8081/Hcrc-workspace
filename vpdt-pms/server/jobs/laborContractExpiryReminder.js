// jobs/laborContractExpiryReminder.js — Job định kỳ quét Hợp Đồng Lao Động sắp/đã hết hạn (Phần D.2 tài
// liệu thiết kế gốc — "nghiệp vụ quan trọng nhất" của module Hợp Đồng Lao Động) và gửi cảnh báo — nhân
// bản ĐÚNG khuôn jobs/licenseExpiryReminder.js (đọc emailConfig chung, ghi notifiedThresholds trên từng
// bản ghi, gửi email THẬT qua lib/mailer.js nếu đã cấu hình SMTP thật).
//
// Khác Giấy Phép ở người nhận: theo đúng Phần D.2 ("cảnh báo HR + quản lý trực tiếp"), không phải danh
// sách người có quyền duyệt (Hợp Đồng Lao Động không có bước duyệt) — người nhận = mọi tài khoản có
// hrContractManage/admin, CỘNG thêm quản lý trực tiếp của CHÍNH nhân viên đó (tra qua employeeProfiles ->
// user.managerUsername, cùng field phẳng đã dùng ở isManagerOf()/lib/employeeProfile.js). Hợp đồng
// INDEFINITE (endDate null) không bao giờ hết hạn -> bỏ qua tự nhiên (daysUntil() trả null).
const { getPool, sql } = require('../db');
const { sendMail, resolveEncryption } = require('../lib/mailer');
const { decryptSecret } = require('../lib/emailCrypto');
const { getAllForCollection, withLockedRecordById } = require('../lib/recordStore');
const { insertSystemLog } = require('../lib/systemLogStore');

const DEFAULT_REMINDER_DAYS = [60, 45, 30];

async function getCollection(pool, key, fallback) {
  const result = await pool.request()
    .input('k', sql.NVarChar(100), key)
    .query('SELECT DataValue FROM dbo.AppData WHERE DataKey = @k');
  if (result.recordset.length === 0) return fallback;
  try {
    const parsed = JSON.parse(result.recordset[0].DataValue);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

// Số ngày còn lại tới hạn, tính theo ngày lịch (bỏ qua giờ/phút) — số âm nghĩa là đã hết hạn, null nếu
// không có endDate (hợp đồng Vô thời hạn).
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const end = new Date(dateStr);
  if (isNaN(end.getTime())) return null;
  const now = new Date();
  const startOfEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startOfEnd - startOfNow) / (1000 * 60 * 60 * 24));
}

const CONTRACT_TYPE_LABELS = { PROBATION: 'Thử việc', FIXED_TERM: 'Xác định thời hạn', INDEFINITE: 'Vô thời hạn' };

async function checkLaborContractExpiryReminders() {
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('⛔ [Nhắc hạn Hợp Đồng Lao Động] Không kết nối được SQL Server:', err.message);
    return;
  }

  try {
    const emailConfig = await getCollection(pool, 'emailConfig', {});
    if (!emailConfig || emailConfig.enabled === false) return;

    const configuredDays = Array.isArray(emailConfig.laborContractExpiryReminderDays) && emailConfig.laborContractExpiryReminderDays.length
      ? emailConfig.laborContractExpiryReminderDays.map(Number).filter(n => Number.isFinite(n) && n >= 0)
      : DEFAULT_REMINDER_DAYS;
    const thresholds = Array.from(new Set(configuredDays)).sort((a, b) => b - a);

    let smtpUser = null, smtpPass = null;
    if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
      try {
        smtpUser = emailConfig.smtpUser;
        smtpPass = decryptSecret(emailConfig.smtpPassEnc);
      } catch (err) {
        console.error('⛔ [Nhắc hạn Hợp Đồng Lao Động] Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
      }
    }
    const smtpEncryption = resolveEncryption(emailConfig);

    const contracts = await getAllForCollection('laborContracts');
    if (!Array.isArray(contracts) || contracts.length === 0) return;

    const users = await getCollection(pool, 'users', []);
    const profiles = await getCollection(pool, 'employeeProfiles', []);
    const hrEmails = users
      .filter(u => u && u.active !== false && u.email && (u.perms?.admin || u.perms?.hrContractManage))
      .map(u => ({ email: u.email, name: u.name || u.username }));

    for (const c of contracts) {
      if (!c || c.status !== 'ACTIVE') continue; // chỉ nhắc hợp đồng đang hiệu lực
      const diffDays = daysUntil(c.endDate);
      if (diffDays === null) continue; // Vô thời hạn hoặc endDate hỏng
      if (!Array.isArray(c.notifiedThresholds)) c.notifiedThresholds = [];

      try {
        const newlyCrossedThresholds = thresholds.filter(t => diffDays <= t && !c.notifiedThresholds.includes(t));
        if (!newlyCrossedThresholds.length) continue;
        const threshold = Math.min(...newlyCrossedThresholds);
        const label = diffDays < 0 ? `đã hết hạn ${Math.abs(diffDays)} ngày` : (diffDays === 0 ? 'hết hạn hôm nay' : `còn khoảng ${threshold} ngày là hết hạn`);
        const typeLabel = CONTRACT_TYPE_LABELS[c.contractType] || c.contractType;
        const subject = `[VPDT] Hợp đồng lao động ${c.code} (${typeLabel}) ${label}`;
        const body = `Hợp đồng lao động "${c.code}" (${typeLabel}) của nhân viên mã ${c.employeeCode} ${label}. Ngày hết hạn: ${c.endDate}. Vui lòng xem xét gia hạn/đổi loại hợp đồng/khởi tạo Offboarding nếu không tiếp tục.`;

        const profile = (profiles || []).find(p => p.employeeCode === c.employeeCode);
        const rawRecipients = [...hrEmails];
        if (profile?.username) {
          const employeeUser = users.find(u => u.username === profile.username && u.active !== false);
          if (employeeUser?.managerUsername) {
            const manager = users.find(u => u.username === employeeUser.managerUsername && u.active !== false);
            if (manager?.email) rawRecipients.push({ email: manager.email, name: manager.name || manager.username });
          }
        }
        const seenEmails = new Set();
        const recipients = rawRecipients.filter(r => {
          const key = r.email.toLowerCase();
          if (seenEmails.has(key)) return false;
          seenEmails.add(key);
          return true;
        });

        for (const r of recipients) {
          console.log(`[DMS EMAIL SIMULATOR] To: ${r.name} <${r.email}> | Subject: ${subject}\n  ${body}`);
        }
        let sendResult = { sent: [], failed: [], simulated: true };
        if (recipients.length) {
          try {
            sendResult = await sendMail({
              to: recipients.map(r => r.email),
              subject, text: body,
              host: emailConfig.smtpHost, port: emailConfig.smtpPort, encryption: smtpEncryption,
              user: smtpUser, pass: smtpPass,
              from: emailConfig.senderEmail
            });
          } catch (err) {
            console.error('⛔ [Nhắc hạn Hợp Đồng Lao Động] Gửi email thật thất bại:', err.message);
            sendResult = { sent: [], failed: recipients.map(r => r.email), simulated: false };
          }
        }
        const totalSendFailure = recipients.length > 0 && !sendResult.simulated && sendResult.sent.length === 0 && sendResult.failed.length > 0;

        let statusSuffix = '';
        if (recipients.length && !sendResult.simulated) {
          const hostLabel = sendResult.host ? ` (máy chủ SMTP ${sendResult.host}:${sendResult.port || ''})` : '';
          statusSuffix = sendResult.failed.length
            ? `; LỖI gửi thật tới: ${sendResult.failed.join(', ')}${hostLabel}`
            : ` (đã xác nhận gửi email thật${hostLabel})`;
        }

        await insertSystemLog({
          username: 'system_scheduler', fullName: 'Hệ Thống (Tự Động)', ipAddress: 'SERVER (Scheduled Job)',
          module: 'LABOR_CONTRACT', actionType: 'EXPIRY_REMINDER', targetObject: c.code,
          description: recipients.length
            ? `${totalSendFailure ? 'LỖI gửi nhắc hạn' : 'Đã gửi nhắc hạn'} hợp đồng lao động [${c.code}] (${label}) tới ${recipients.map(r => r.email).join(', ')}${statusSuffix}${totalSendFailure ? ' — sẽ tự thử lại ở lần kiểm tra kế tiếp' : ''}`
            : `Hợp đồng lao động [${c.code}] (${label}) chưa có người nhận hợp lệ (chưa ai có quyền hrContractManage/quản lý trực tiếp kèm email hợp lệ)`,
          status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
        });

        if (!totalSendFailure) {
          await withLockedRecordById('laborContracts', c.id, (item) => {
            item.notifiedThresholds = Array.from(new Set([...(item.notifiedThresholds || []), ...newlyCrossedThresholds]));
            return item;
          });
        }
      } catch (err) {
        console.error(`⛔ [Nhắc hạn Hợp Đồng Lao Động] Lỗi khi xử lý hợp đồng ${c.code || c.id}, bỏ qua và tiếp tục:`, err.message);
      }
    }
  } catch (err) {
    console.error('⛔ [Nhắc hạn Hợp Đồng Lao Động] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = { checkLaborContractExpiryReminders };
