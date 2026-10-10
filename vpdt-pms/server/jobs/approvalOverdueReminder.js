// jobs/approvalOverdueReminder.js — Quá Hạn Xử Lý (11/2026): nhắc email khi 1 Văn Bản Trình/Hợp Đồng
// đã CHỜ XỬ LÝ quá lâu tại ĐÚNG 1 bước phê duyệt — xem lib/approvalOverdue.js::computeApprovalOverdueStatus()
// (hàm tính dùng CHUNG với badge hiển thị client, public/js/core.js). Mirror khuôn gửi mail/ghi log
// chung với jobs/contractExpiryReminder.js (nhiều ngưỡng dồn — admin có thể cấu hình nhiều mốc ngày
// tăng dần, VD 3/5/7 — cần mảng theo dõi "đã nhắc" thay vì cờ boolean đơn như
// jobs/itApprovalDeadlineReminder.js).
//
// KHÁC hẳn contractExpiryReminder.js ở 1 điểm quan trọng: "đồng hồ chờ" đếm theo BƯỚC hiện tại, không
// phải 1 mốc hạn cố định — khi item.currentStep đổi (hồ sơ đã qua bước mới), mảng "đã nhắc" PHẢI RESET
// (chờ lại từ đầu ở bước mới), nên lưu kèm currentStep vào field theo dõi
// (item.overdueNotified = { step, thresholds: [...] }) — step lưu khác step hiện tại thì coi như CHƯA
// từng nhắc ở bước này.
//
// Người nhận mặc định = approver LIVE của bước hiện tại (resolveWorkflowStepApprovers(), lib/
// workflowEngine.js — tính lại trực tiếp từ cấu hình dept-workflow hiện hành, không dùng snapshot cũ)
// + người trình/tạo hồ sơ, cộng thêm email CC cố định theo đúng module (submissionOverdueCcEmails/
// contractOverdueCcEmails).
const { getPool } = require('../db');
const { sendMail, resolveEncryption, resolveGraphOption, resolveEwsOption } = require('../lib/mailer');
const { decryptSecret } = require('../lib/emailCrypto');
const { getAllForCollection, withLockedRecordById } = require('../lib/recordStore');
const { insertSystemLog } = require('../lib/systemLogStore');
const { getAllAppData } = require('../lib/appData');
const { MODULE_CONFIGS, resolveWorkflowStepApprovers } = require('../lib/workflowEngine');
const { computeApprovalOverdueStatus } = require('../lib/approvalOverdue');

const MODULE_JOBS = [
  { moduleKey: 'submissions', logModule: 'SUBMISSION', noun: 'tờ trình', overdueDaysField: 'submissionOverdueDays', ccField: 'submissionOverdueCcEmails' },
  { moduleKey: 'contracts', logModule: 'CONTRACT', noun: 'hợp đồng', overdueDaysField: 'contractOverdueDays', ccField: 'contractOverdueCcEmails' }
];

async function checkApprovalOverdueReminders() {
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('⛔ [Nhắc quá hạn xử lý] Không kết nối được SQL Server:', err.message);
    return;
  }

  try {
    const appData = await getAllAppData();
    const emailConfig = appData.emailConfig || {};
    if (!emailConfig || emailConfig.enabled === false) return;

    let smtpUser = null, smtpPass = null;
    if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
      try {
        smtpUser = emailConfig.smtpUser;
        smtpPass = decryptSecret(emailConfig.smtpPassEnc);
      } catch (err) {
        console.error('⛔ [Nhắc quá hạn xử lý] Không giải mã được mật khẩu SMTP đã lưu:', err.message);
      }
    }
    const smtpEncryption = resolveEncryption(emailConfig);
    const users = appData.users || [];

    for (const jobCfg of MODULE_JOBS) {
      const overdueDaysRaw = emailConfig[jobCfg.overdueDaysField];
      const thresholds = (Array.isArray(overdueDaysRaw) ? overdueDaysRaw : [])
        .map(Number).filter(n => Number.isFinite(n) && n > 0)
        .filter((v, i, arr) => arr.indexOf(v) === i).sort((a, b) => a - b);
      if (!thresholds.length) continue; // Tính năng TẮT cho đúng module này (mảng rỗng)

      const ccEmails = Array.isArray(emailConfig[jobCfg.ccField]) ? emailConfig[jobCfg.ccField] : [];
      const moduleConfig = MODULE_CONFIGS[jobCfg.moduleKey];
      const records = await getAllForCollection(moduleConfig.dbKey);
      if (!Array.isArray(records) || !records.length) continue;

      for (const item of records) {
        try {
          const st = computeApprovalOverdueStatus(item, moduleConfig, thresholds, new Date());
          if (!st) continue; // không PENDING / là phụ lục / tính năng tắt / chưa tới ngưỡng nhỏ nhất

          const step = item.currentStep;
          const tracked = (item.overdueNotified && item.overdueNotified.step === step)
            ? item.overdueNotified : { step, thresholds: [] };
          const newlyCrossed = thresholds.filter(t => st.daysWaited >= t && !tracked.thresholds.includes(t));
          if (!newlyCrossed.length) continue;

          const approverUsernames = resolveWorkflowStepApprovers(jobCfg.moduleKey, item, appData, step);
          const rawRecipients = [];
          for (const uname of approverUsernames) {
            const u = users.find(x => x.username === uname && x.active !== false);
            if (u && u.email) rawRecipients.push({ email: u.email, name: u.name || uname });
          }
          const creator = users.find(u => u.username === item.creator && u.active !== false);
          if (creator && creator.email) rawRecipients.push({ email: creator.email, name: creator.name || item.creator });
          for (const cc of ccEmails) {
            const email = String(cc || '').trim();
            if (email) rawRecipients.push({ email, name: email });
          }
          const seenEmails = new Set();
          const recipients = rawRecipients.filter(r => {
            const key = r.email.toLowerCase();
            if (seenEmails.has(key)) return false;
            seenEmails.add(key);
            return true;
          });

          const label = `đã chờ xử lý ${st.daysWaited} ngày ở bước ${step} (ngưỡng ${st.level === 'OVERDUE' ? '🔴 Quá Hạn Xử Lý' : '⚠️ Sắp Quá Hạn'}: ${st.threshold} ngày)`;
          const subject = `[VPDT] ${jobCfg.noun.charAt(0).toUpperCase() + jobCfg.noun.slice(1)} ${item.code} ${st.level === 'OVERDUE' ? 'đã quá hạn xử lý' : 'sắp quá hạn xử lý'}`;
          const body = `${jobCfg.noun.charAt(0).toUpperCase() + jobCfg.noun.slice(1)} "${item.title || ''}" (${item.code}) ${label}.`;

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
                from: emailConfig.senderEmail,
                graph: resolveGraphOption(emailConfig),
                ews: resolveEwsOption(emailConfig)
              });
            } catch (err) {
              console.error('⛔ [Nhắc quá hạn xử lý] Gửi email thật thất bại:', err.message);
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
            module: jobCfg.logModule,
            actionType: 'OVERDUE_REMINDER',
            targetObject: item.code,
            description: recipients.length
              ? `${totalSendFailure ? 'LỖI gửi nhắc quá hạn' : 'Đã gửi nhắc quá hạn'} ${jobCfg.noun} [${item.code}] (${label}) tới ${recipients.map(r => r.email).join(', ')}${statusSuffix}${totalSendFailure ? ' — sẽ tự thử lại ở lần kiểm tra kế tiếp' : ''}`
              : `${jobCfg.noun.charAt(0).toUpperCase() + jobCfg.noun.slice(1)} [${item.code}] (${label}) chưa có người nhận hợp lệ`,
            status: recipients.length ? (totalSendFailure ? 'WARNING' : 'SUCCESS') : 'WARNING'
          });

          if (!totalSendFailure) {
            await withLockedRecordById(moduleConfig.dbKey, item.id, (rec) => {
              // Tra lại currentStep MỚI NHẤT tại thời điểm ghi (có thể đã đổi trong lúc đang gửi mail) —
              // chỉ ghi nếu vẫn CÙNG bước đã tính ở trên, tránh đánh dấu nhầm "đã nhắc" cho 1 bước MỚI mà
              // hồ sơ vừa được duyệt sang trong lúc job đang chạy.
              if (rec.currentStep !== step) return rec;
              const prevTracked = (rec.overdueNotified && rec.overdueNotified.step === step) ? rec.overdueNotified.thresholds : [];
              rec.overdueNotified = { step, thresholds: Array.from(new Set([...prevTracked, ...newlyCrossed])) };
              return rec;
            });
          }
        } catch (err) {
          console.error(`⛔ [Nhắc quá hạn xử lý] Lỗi khi xử lý ${jobCfg.noun} ${item.code || item.id}, bỏ qua và tiếp tục các hồ sơ còn lại:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('⛔ [Nhắc quá hạn xử lý] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = { checkApprovalOverdueReminders };
