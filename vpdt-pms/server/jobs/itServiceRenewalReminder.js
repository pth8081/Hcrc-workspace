// jobs/itServiceRenewalReminder.js — Job định kỳ quét danh mục "Gia Hạn Dịch Vụ CNTT" (Hỗ Trợ IT) sắp/đã
// hết hạn và gửi thông báo nhắc nhở — nhân bản ĐÚNG khuôn jobs/licenseExpiryReminder.js (đọc emailConfig
// chung, ghi notifiedThresholds trên từng bản ghi, gửi email THẬT qua lib/mailer.js nếu đã cấu hình SMTP
// thật). Khác Giấy Phép ở chỗ module này KHÔNG có trạng thái APPROVED/REVOKED để lọc (không qua duyệt —
// xem lib/createValidation.js itServiceRenewals.extraValidate) nên quét TOÀN BỘ bản ghi; người nhận mặc
// định = người tạo + TOÀN BỘ người đang có quyền itManage/admin, cộng thêm CC tuỳ chọn
// (itRenewalCcEmails).
const { getPool, sql } = require('../db');
const { sendMail, resolveEncryption } = require('../lib/mailer');
const { decryptSecret } = require('../lib/emailCrypto');
const { getAllForCollection, withLockedRecordById } = require('../lib/recordStore');
const { insertSystemLog } = require('../lib/systemLogStore');

const DEFAULT_REMINDER_DAYS = [30, 15, 7];

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

// Số ngày còn lại tới hạn, tính theo ngày lịch (bỏ qua giờ/phút) — số âm nghĩa là đã hết hạn.
function daysUntil(dateStr) {
  const end = new Date(dateStr);
  if (isNaN(end.getTime())) return null;
  const now = new Date();
  const startOfEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startOfEnd - startOfNow) / (1000 * 60 * 60 * 24));
}

async function checkItServiceRenewalReminders() {
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('⛔ [Nhắc hạn dịch vụ CNTT] Không kết nối được SQL Server:', err.message);
    return;
  }

  try {
    const emailConfig = await getCollection(pool, 'emailConfig', {});
    if (!emailConfig || emailConfig.enabled === false) return;

    const configuredDays = Array.isArray(emailConfig.itRenewalReminderDays) && emailConfig.itRenewalReminderDays.length
      ? emailConfig.itRenewalReminderDays.map(Number).filter(n => Number.isFinite(n) && n >= 0)
      : DEFAULT_REMINDER_DAYS;
    const thresholds = Array.from(new Set([...configuredDays, 0])).sort((a, b) => b - a);
    const ccEmails = Array.isArray(emailConfig.itRenewalCcEmails) ? emailConfig.itRenewalCcEmails : [];

    let smtpUser = null, smtpPass = null;
    if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
      try {
        smtpUser = emailConfig.smtpUser;
        smtpPass = decryptSecret(emailConfig.smtpPassEnc);
      } catch (err) {
        console.error('⛔ [Nhắc hạn dịch vụ CNTT] Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
      }
    }
    const smtpEncryption = resolveEncryption(emailConfig);

    const renewals = await getAllForCollection('itServiceRenewals');
    if (!Array.isArray(renewals) || renewals.length === 0) return;

    const users = await getCollection(pool, 'users', []);
    const itTeamEmails = users
      .filter(u => u && u.active !== false && u.email && (u.perms?.admin || u.perms?.itManage))
      .map(u => ({ email: u.email, name: u.name || u.username }));

    for (const item of renewals) {
      if (!item || !item.expiryDate) continue;
      const diffDays = daysUntil(item.expiryDate);
      if (diffDays === null) continue;
      if (!Array.isArray(item.notifiedThresholds)) item.notifiedThresholds = [];

      // Cô lập lỗi theo TỪNG bản ghi — 1 lỗi bất kỳ không được làm dừng cả vòng lặp, bỏ sót các bản ghi
      // còn lại (cùng lý do đã vá ở jobs/contractExpiryReminder.js).
      try {

      let itemChanged = false;

      // Chỉ gửi ĐÚNG 1 email/lượt chạy cho ngưỡng gần nhất (cùng lý do đã vá ở
      // jobs/contractExpiryReminder.js — tránh gửi trùng nhiều email khi "nhảy cóc" qua nhiều ngưỡng).
      const newlyCrossedThresholds = thresholds.filter(t => diffDays <= t && !item.notifiedThresholds.includes(t));
      if (newlyCrossedThresholds.length) {
        const threshold = Math.min(...newlyCrossedThresholds);
        const creator = users.find(u => u.username === item.creator);
        const label = threshold === 0
          ? (diffDays < 0 ? `đã hết hạn ${Math.abs(diffDays)} ngày` : 'hết hạn hôm nay')
          : `còn khoảng ${threshold} ngày là hết hạn`;
        const subject = `[VPDT] Dịch vụ CNTT "${item.name}" ${label}`;
        const body = `Dịch vụ CNTT "${item.name}" (${item.category}${item.vendor ? `, nhà cung cấp: ${item.vendor}` : ''}) ${label}. Ngày hết hạn: ${item.expiryDate}.${item.responsible ? ` Người phụ trách: ${item.responsible}.` : ''}`;

        const rawRecipients = [];
        if (creator && creator.email) rawRecipients.push({ email: creator.email, name: creator.name || item.creator });
        for (const a of itTeamEmails) rawRecipients.push(a);
        for (const cc of ccEmails) {
          const email = String(cc).trim();
          if (email) rawRecipients.push({ email, name: email });
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
            console.error('⛔ [Nhắc hạn dịch vụ CNTT] Gửi email thật thất bại:', err.message);
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
          username: 'system_scheduler',
          fullName: 'Hệ Thống (Tự Động)',
          ipAddress: 'SERVER (Scheduled Job)',
          module: 'IT_SERVICE_RENEWAL',
          actionType: 'EXPIRY_REMINDER',
          targetObject: item.name,
          description: recipients.length
            ? `${totalSendFailure ? 'LỖI gửi nhắc hạn' : 'Đã gửi nhắc hạn'} dịch vụ CNTT [${item.name}] (${label}) tới ${recipients.map(r => r.email).join(', ')}${statusSuffix}${totalSendFailure ? ' — sẽ tự thử lại ở lần kiểm tra kế tiếp' : ''}`
            : `Dịch vụ CNTT [${item.name}] (${label}) chưa có người nhận hợp lệ (chưa ai có quyền itManage kèm email hợp lệ)`,
          status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
        });

        if (!totalSendFailure) {
          item.notifiedThresholds.push(...newlyCrossedThresholds);
          itemChanged = true;
        }
      }

      if (itemChanged) {
        await withLockedRecordById('itServiceRenewals', item.id, (record) => {
          record.notifiedThresholds = item.notifiedThresholds;
          return record;
        });
      }
      } catch (err) {
        console.error(`⛔ [Nhắc hạn dịch vụ CNTT] Lỗi khi xử lý bản ghi ${item.name || item.id}, bỏ qua và tiếp tục:`, err.message);
      }
    }
  } catch (err) {
    console.error('⛔ [Nhắc hạn dịch vụ CNTT] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = { checkItServiceRenewalReminders };
