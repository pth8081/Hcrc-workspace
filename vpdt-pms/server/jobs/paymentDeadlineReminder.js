// jobs/paymentDeadlineReminder.js — LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 3, 9/2026): paymentRequests đã
// duyệt xong (status APPROVED, "đang chờ thanh toán") có TỪNG ĐỢT với hạn thanh toán riêng (dueDate) —
// computePaymentInstallmentDeadlineStatus() (lib/recordActions.js) đã tính badge "⚠️ Quá hạn"/"⏳ Sắp
// đến hạn" ngay trên giao diện, nhưng KHÔNG có job nào chủ động NHẮC người phụ trách — kế toán/người
// tạo đề nghị chỉ phát hiện đợt sắp/đã quá hạn nếu tự vào xem, khác hẳn Hợp Đồng/Giấy Phép/Kỳ Báo Cáo
// đã có job nhắc hạn chủ động từ lâu.
//
// Nhân bản đúng khuôn jobs/reportPeriodDeadlineReminder.js (ngưỡng CỐ ĐỊNH 3/1/0 ngày, không cần cấu
// hình admin riêng — đợt thanh toán có vòng đời ngắn, không cần tuỳ biến như contractExpiryReminderDays).
// Người nhận = người tạo đề nghị (createdBy) + MỌI user đang giữ quyền paymentManage (kế toán/"custodian"
// giữ tiền — mirror cách reportPeriodDeadlineReminder.js suy ra người nhận từ QUYỀN, không dùng danh
// sách CC cấu hình tay như contractExpiryReminder.js, vì phạm vi ở đây hẹp và rõ ràng hơn nhiều).
//
// Theo dõi "đã nhắc ngưỡng nào" Ở TỪNG ĐỢT (installment.notifiedThresholds), không phải ở cả đề nghị,
// vì mỗi đợt có dueDate riêng — khác contractExpiryReminder.js (1 hợp đồng chỉ có 1 endDate).
const { getPool, sql } = require('../db');
const { sendMail, resolveEncryption } = require('../lib/mailer');
const { decryptSecret } = require('../lib/emailCrypto');
const { getAllForCollection, withLockedRecordById } = require('../lib/recordStore');
const { insertSystemLog } = require('../lib/systemLogStore');

const REMINDER_DAYS = [3, 1, 0];

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

function daysUntil(dateStr) {
  const end = new Date(dateStr);
  if (isNaN(end.getTime())) return null;
  const now = new Date();
  const startOfEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((startOfEnd - startOfNow) / (1000 * 60 * 60 * 24));
}

async function checkPaymentDeadlineReminders() {
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('⛔ [Nhắc hạn Thanh Toán] Không kết nối được SQL Server:', err.message);
    return;
  }

  try {
    const emailConfig = await getCollection(pool, 'emailConfig', {});
    if (!emailConfig || emailConfig.enabled === false) return;

    let smtpUser = null, smtpPass = null;
    if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
      try {
        smtpUser = emailConfig.smtpUser;
        smtpPass = decryptSecret(emailConfig.smtpPassEnc);
      } catch (err) {
        console.error('⛔ [Nhắc hạn Thanh Toán] Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
      }
    }
    const smtpEncryption = resolveEncryption(emailConfig);

    const paymentRequests = await getAllForCollection('paymentRequests');
    const approved = (paymentRequests || []).filter(pr => pr && pr.status === 'APPROVED' && Array.isArray(pr.installments) && pr.installments.length);
    if (!approved.length) return;

    const users = await getCollection(pool, 'users', []);
    // "custodian" giữ tiền = mọi user đang có quyền paymentManage (kế toán) — TÁCH RIÊNG khỏi người
    // tạo đề nghị, vì người tạo (createdBy) có thể không giữ quyền này (VD custodianDept khác), và kế
    // toán quản lý payment KHÔNG nhất thiết là người đã tạo đề nghị đó.
    const custodians = users.filter(u => u && u.active !== false && u.email && (u.perms?.admin || u.perms?.paymentManage))
      .map(u => ({ email: u.email, name: u.name || u.username }));

    for (const pr of approved) {
      try {
        const creator = users.find(u => u.username === pr.createdBy);
        let anyInstallmentChanged = false;

        for (let idx = 0; idx < pr.installments.length; idx++) {
          const it = pr.installments[idx];
          if (!it || it.confirmed || !it.dueDate) continue;
          const diffDays = daysUntil(it.dueDate);
          if (diffDays === null) continue;
          const notified = Array.isArray(it.notifiedThresholds) ? it.notifiedThresholds : [];
          const newlyCrossedThresholds = REMINDER_DAYS.filter(t => diffDays <= t && !notified.includes(t));
          if (!newlyCrossedThresholds.length) continue;
          const threshold = Math.min(...newlyCrossedThresholds);
          const label = threshold === 0
            ? (diffDays < 0 ? `đã quá hạn ${Math.abs(diffDays)} ngày` : 'đến hạn hôm nay')
            : `còn khoảng ${threshold} ngày là đến hạn`;

          const rawRecipients = [];
          if (creator && creator.email) rawRecipients.push({ email: creator.email, name: creator.name || pr.createdByName || pr.createdBy });
          rawRecipients.push(...custodians);
          const seenEmails = new Set();
          const recipients = rawRecipients.filter(r => {
            const key = r.email.toLowerCase();
            if (seenEmails.has(key)) return false;
            seenEmails.add(key);
            return true;
          });

          const installmentLabel = it.description ? `"${it.description}"` : `đợt ${idx + 1}`;
          const subject = `[VPDT] Đề nghị thanh toán "${pr.title}" — ${installmentLabel} ${label}`;
          const body = `Đề nghị thanh toán "${pr.title}"${pr.sourceCode ? ` (nguồn: ${pr.sourceCode})` : ''} — ${installmentLabel} ${label}. Hạn thanh toán: ${it.dueDate}. Số tiền: ${(it.amount || 0).toLocaleString('vi-VN')} VNĐ.`;

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
              console.error('⛔ [Nhắc hạn Thanh Toán] Gửi email thật thất bại:', err.message);
              sendResult = { sent: [], failed: recipients.map(r => r.email), simulated: false };
            }
          }
          // Gửi thật nhưng KHÔNG ai nhận thành công -> coi như chưa nhắc được, để lần chạy kế tiếp tự
          // thử lại đúng ngưỡng này (đúng khuôn contractExpiryReminder.js/reportPeriodDeadlineReminder.js).
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
            module: 'PAYMENT', actionType: 'DEADLINE_REMINDER', targetObject: pr.title,
            description: recipients.length
              ? `${totalSendFailure ? 'LỖI gửi nhắc hạn' : 'Đã gửi nhắc hạn'} đề nghị thanh toán [${pr.title} — ${installmentLabel}] (${label}) tới ${recipients.map(r => r.email).join(', ')}${statusSuffix}${totalSendFailure ? ' — sẽ tự thử lại ở lần kiểm tra kế tiếp' : ''}`
              : `Đề nghị thanh toán [${pr.title} — ${installmentLabel}] (${label}) chưa có người nhận hợp lệ (người tạo chưa có email, chưa ai giữ quyền quản lý Thanh Toán kèm email hợp lệ)`,
            status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
          });

          if (!totalSendFailure) {
            it.notifiedThresholds = [...new Set([...notified, ...newlyCrossedThresholds])];
            anyInstallmentChanged = true;
          }
        }

        if (anyInstallmentChanged) {
          await withLockedRecordById('paymentRequests', pr.id, (item) => {
            item.installments = pr.installments;
            return item;
          });
        }
      } catch (err) {
        console.error(`⛔ [Nhắc hạn Thanh Toán] Lỗi khi xử lý đề nghị ${pr.title || pr.id}, bỏ qua và tiếp tục các hồ sơ còn lại:`, err.message);
      }
    }
  } catch (err) {
    console.error('⛔ [Nhắc hạn Thanh Toán] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = { checkPaymentDeadlineReminders };
