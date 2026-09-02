// jobs/diskSpaceMonitor.js — Job định kỳ kiểm tra dung lượng ổ đĩa còn trống ở phân vùng chứa thư mục
// uploads/ (nơi tăng dung lượng nhanh nhất vì người dùng tải file lên liên tục) — CHỈ CẢNH BÁO qua
// email cho admin khi vượt ngưỡng, KHÔNG tự xoá bất kỳ file nào. Cố ý không có phần "auto-cleanup":
// hệ thống fail-open có chủ đích cho nhiều loại file chưa rà quyền sở hữu riêng (ảnh đại diện, logo,
// đính kèm module chưa rà — xem ghi chú authorizeFileAccess() ở lib/fileAuthz.js), nên KHÔNG có cách
// nào chắc chắn 1 file trong uploads/ là "rác an toàn để xoá" mà không có rủi ro mất file thật của
// người dùng — tự xoá nhầm là hành động không thể hoàn tác.
//
// Nhân bản khuôn jobs/contractExpiryReminder.js (đọc emailConfig chung, gửi email THẬT qua
// lib/mailer.js nếu đã cấu hình SMTP thật) nhưng dùng lib/appData.js (getAppDataValue/setAppDataValue)
// thay vì tự viết lại SQL đọc/ghi AppData — 2 job cũ viết trước khi lib/appData.js tồn tại.
const fs = require('fs');
const path = require('path');
const { sendMail, resolveEncryption } = require('../lib/mailer');
const { decryptSecret } = require('../lib/emailCrypto');
const { getAppDataValue, setAppDataValue } = require('../lib/appData');
const { insertSystemLog } = require('../lib/systemLogStore');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const DEFAULT_THRESHOLD_PERCENT = 85;
// Tránh dội email mỗi lượt kiểm tra (chạy hàng giờ, xem server.js) trong khi ổ đĩa vẫn còn đầy giữa
// các lượt — chỉ cảnh báo lại sau 24h kể từ lần cảnh báo gần nhất, TRỪ KHI đã tụt xuống dưới ngưỡng rồi
// vượt lại (coi là 1 đợt cảnh báo mới, xem nhánh xoá state bên dưới).
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

async function readDiskUsage() {
  if (typeof fs.promises.statfs !== 'function') {
    console.error('⛔ [Giám sát ổ đĩa] Node.js phiên bản này không hỗ trợ fs.statfs — bỏ qua kiểm tra (cần Node >= 18.15).');
    return null;
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const stat = await fs.promises.statfs(UPLOAD_DIR);
  const totalBytes = stat.blocks * stat.bsize;
  const availBytes = stat.bavail * stat.bsize; // bavail = trống thật sự dùng được (khác bfree, trừ phần dành riêng cho root)
  if (!totalBytes) return null;
  return {
    usedPercent: Math.round((1 - availBytes / totalBytes) * 1000) / 10,
    totalGB: totalBytes / 1024 / 1024 / 1024,
    availGB: availBytes / 1024 / 1024 / 1024
  };
}

async function checkDiskSpace() {
  let usage;
  try {
    usage = await readDiskUsage();
  } catch (err) {
    console.error('⛔ [Giám sát ổ đĩa] Không đọc được dung lượng ổ đĩa:', err.message);
    return;
  }
  if (!usage) return;

  try {
    const emailConfig = (await getAppDataValue('emailConfig')) || {};
    const threshold = Number.isFinite(Number(emailConfig.diskSpaceAlertThresholdPercent))
      ? Number(emailConfig.diskSpaceAlertThresholdPercent) : DEFAULT_THRESHOLD_PERCENT;
    const state = (await getAppDataValue('diskSpaceMonitorState')) || {};

    if (usage.usedPercent < threshold) {
      // Đã tụt xuống dưới ngưỡng — xoá dấu vết đã cảnh báo để lần vượt ngưỡng KẾ TIẾP (kể cả trong
      // cùng 1 ngày) được cảnh báo ngay, không bị cooldown của đợt tăng dung lượng trước đó áp nhầm.
      if (state.lastAlertAt) await setAppDataValue('diskSpaceMonitorState', {});
      return;
    }

    if (state.lastAlertAt && Date.now() - new Date(state.lastAlertAt).getTime() < ALERT_COOLDOWN_MS) {
      return; // đã cảnh báo gần đây, còn trong thời gian chờ
    }

    if (emailConfig.enabled === false) return;

    const users = (await getAppDataValue('users')) || [];
    const admins = users.filter(u => u.perms?.admin && u.email);
    const ccEmails = Array.isArray(emailConfig.diskSpaceAlertCcEmails) ? emailConfig.diskSpaceAlertCcEmails : [];
    const rawRecipients = [
      ...admins.map(u => ({ email: u.email, name: u.name || u.username })),
      ...ccEmails.map(e => ({ email: String(e).trim(), name: String(e).trim() }))
    ].filter(r => r.email);
    const seen = new Set();
    const recipients = rawRecipients.filter(r => {
      const key = r.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const subject = `[VPDT] CẢNH BÁO: Ổ đĩa máy chủ sắp đầy (${usage.usedPercent}%)`;
    const body = `Ổ đĩa chứa thư mục uploads/ hiện đã dùng ${usage.usedPercent}% (còn trống ${usage.availGB.toFixed(1)}GB / tổng ${usage.totalGB.toFixed(1)}GB), vượt ngưỡng cảnh báo ${threshold}%. Vui lòng kiểm tra và dọn dẹp/tăng dung lượng máy chủ sớm — tải file lên sẽ lỗi khi ổ đĩa đầy hẳn, có thể ảnh hưởng tới nhiều module đang hoạt động.`;

    console.log(`[DMS EMAIL SIMULATOR] Disk space alert: ${subject}\n  ${body}`);

    let sendResult = { sent: [], failed: [], simulated: true };
    if (recipients.length) {
      let smtpUser = null, smtpPass = null;
      if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
        try {
          smtpUser = emailConfig.smtpUser;
          smtpPass = decryptSecret(emailConfig.smtpPassEnc);
        } catch (err) {
          console.error('⛔ [Giám sát ổ đĩa] Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
        }
      }
      try {
        sendResult = await sendMail({
          to: recipients.map(r => r.email),
          subject, text: body,
          host: emailConfig.smtpHost, port: emailConfig.smtpPort, encryption: resolveEncryption(emailConfig),
          user: smtpUser, pass: smtpPass,
          from: emailConfig.senderEmail
        });
      } catch (err) {
        console.error('⛔ [Giám sát ổ đĩa] Gửi email cảnh báo thất bại:', err.message);
        sendResult = { sent: [], failed: recipients.map(r => r.email), simulated: false };
      }
    }

    await insertSystemLog({
      username: 'system_scheduler',
      fullName: 'Hệ Thống (Tự Động)',
      ipAddress: 'SERVER (Scheduled Job)',
      module: 'SYSTEM',
      actionType: 'DISK_SPACE_ALERT',
      targetObject: `${usage.usedPercent}%`,
      description: recipients.length
        ? `Cảnh báo ổ đĩa đã dùng ${usage.usedPercent}% (còn ${usage.availGB.toFixed(1)}GB / ${usage.totalGB.toFixed(1)}GB), đã gửi tới ${recipients.map(r => r.email).join(', ')}`
        : `Cảnh báo ổ đĩa đã dùng ${usage.usedPercent}% (còn ${usage.availGB.toFixed(1)}GB) nhưng KHÔNG có admin nào có email để nhận cảnh báo — hãy bổ sung email cho tài khoản admin`,
      status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
    });

    await setAppDataValue('diskSpaceMonitorState', { lastAlertAt: new Date().toISOString(), lastAlertPercent: usage.usedPercent });
  } catch (err) {
    console.error('⛔ [Giám sát ổ đĩa] Lỗi khi kiểm tra/cảnh báo:', err.message);
  }
}

module.exports = { checkDiskSpace };
