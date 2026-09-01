// jobs/licenseExpiryReminder.js — Job định kỳ quét Giấy Phép (Hành Chính) sắp/đã hết hạn và gửi thông
// báo nhắc nhở — nhân bản ĐÚNG khuôn jobs/contractExpiryReminder.js (đọc emailConfig chung, ghi
// notifiedThresholds trên từng bản ghi, gửi email THẬT qua lib/mailer.js nếu đã cấu hình SMTP thật).
// Khác hợp đồng ở chỗ Giấy Phép KHÔNG có khái niệm "phòng ban phụ trách" (module quyền phẳng, không
// theo phòng ban — xem lib/createValidation.js licenses.extraValidate) nên KHÔNG cần bảng liên hệ theo
// phòng ban riêng như contractExpiryDeptContacts — người nhận mặc định = người tạo giấy phép + TOÀN BỘ
// người đang có quyền licenseApprove/admin, cộng thêm CC tuỳ chọn (licenseExpiryCcEmails).
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

async function checkLicenseExpiryReminders() {
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('⛔ [Nhắc hạn giấy phép] Không kết nối được SQL Server:', err.message);
    return;
  }

  try {
    const emailConfig = await getCollection(pool, 'emailConfig', {});
    if (!emailConfig || emailConfig.enabled === false) return;

    const configuredDays = Array.isArray(emailConfig.licenseExpiryReminderDays) && emailConfig.licenseExpiryReminderDays.length
      ? emailConfig.licenseExpiryReminderDays.map(Number).filter(n => Number.isFinite(n) && n >= 0)
      : DEFAULT_REMINDER_DAYS;
    const thresholds = Array.from(new Set([...configuredDays, 0])).sort((a, b) => b - a);
    const ccEmails = Array.isArray(emailConfig.licenseExpiryCcEmails) ? emailConfig.licenseExpiryCcEmails : [];

    let smtpUser = null, smtpPass = null;
    if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
      try {
        smtpUser = emailConfig.smtpUser;
        smtpPass = decryptSecret(emailConfig.smtpPassEnc);
      } catch (err) {
        console.error('⛔ [Nhắc hạn giấy phép] Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
      }
    }
    const smtpEncryption = resolveEncryption(emailConfig);

    const licenses = await getAllForCollection('licenses');
    if (!Array.isArray(licenses) || licenses.length === 0) return;

    const users = await getCollection(pool, 'users', []);
    const approverEmails = users
      .filter(u => u && u.active !== false && u.email && (u.perms?.admin || u.perms?.licenseApprove))
      .map(u => ({ email: u.email, name: u.name || u.username }));

    for (const l of licenses) {
      if (!l || !l.expiryDate) continue;
      // Chỉ nhắc hạn giấy phép đã duyệt xong (còn hiệu lực hoặc đang gia hạn) — hồ sơ đang chờ duyệt/bị
      // từ chối/đã thu hồi không cần nhắc (khớp status/lifecycleStatus gán ở lib/createValidation.js +
      // lib/recordActions.js revokeLicense()).
      if (l.status !== 'APPROVED') continue;
      if (l.lifecycleStatus === 'REVOKED') continue;
      const diffDays = daysUntil(l.expiryDate);
      if (diffDays === null) continue;
      if (!Array.isArray(l.notifiedThresholds)) l.notifiedThresholds = [];

      // Cô lập lỗi theo TỪNG bản ghi — cùng lý do đã vá ở jobs/contractExpiryReminder.js.
      try {

      let licenseChanged = false;

      // Chỉ gửi ĐÚNG 1 email/lượt chạy cho ngưỡng gần nhất — cùng lý do đã vá ở
      // jobs/contractExpiryReminder.js.
      const newlyCrossedThresholds = thresholds.filter(t => diffDays <= t && !l.notifiedThresholds.includes(t));
      if (newlyCrossedThresholds.length) {
        const threshold = Math.min(...newlyCrossedThresholds);
        const creator = users.find(u => u.username === l.creator);
        const label = threshold === 0
          ? (diffDays < 0 ? `đã hết hạn ${Math.abs(diffDays)} ngày` : 'hết hạn hôm nay')
          : `còn khoảng ${threshold} ngày là hết hạn`;
        const subject = `[VPDT] Giấy phép ${l.code} ${label}`;
        const body = `Giấy phép "${l.licenseName || l.licenseType}" (${l.code}, số ${l.licenseNumber}, địa điểm: ${l.locationName}) ${label}. Ngày hết hạn: ${l.expiryDate}.`;

        const rawRecipients = [];
        if (creator && creator.email) rawRecipients.push({ email: creator.email, name: creator.name || l.creator });
        for (const a of approverEmails) rawRecipients.push(a);
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
            console.error('⛔ [Nhắc hạn giấy phép] Gửi email thật thất bại:', err.message);
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
          module: 'LICENSE',
          actionType: 'EXPIRY_REMINDER',
          targetObject: l.code,
          description: recipients.length
            ? `${totalSendFailure ? 'LỖI gửi nhắc hạn' : 'Đã gửi nhắc hạn'} giấy phép [${l.code}] (${label}) tới ${recipients.map(r => r.email).join(', ')}${statusSuffix}${totalSendFailure ? ' — sẽ tự thử lại ở lần kiểm tra kế tiếp' : ''}`
            : `Giấy phép [${l.code}] (${label}) chưa có người nhận hợp lệ (chưa ai có quyền licenseApprove kèm email hợp lệ)`,
          status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
        });

        if (!totalSendFailure) {
          l.notifiedThresholds.push(...newlyCrossedThresholds);
          licenseChanged = true;
        }
      }

      if (licenseChanged) {
        await withLockedRecordById('licenses', l.id, (item) => {
          item.notifiedThresholds = l.notifiedThresholds;
          return item;
        });
      }
      } catch (err) {
        console.error(`⛔ [Nhắc hạn giấy phép] Lỗi khi xử lý giấy phép ${l.code || l.id}, bỏ qua và tiếp tục:`, err.message);
      }
    }
  } catch (err) {
    console.error('⛔ [Nhắc hạn giấy phép] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = { checkLicenseExpiryReminders };
