// jobs/hrProfileGapAudit.js — quét hằng ngày "🔍 Audit Nhân Sự" (11/2026), CÙNG KHUÔN
// jobs/userAccountGapAudit.js (đọc chú thích đầy đủ ở đó) — chỉ gửi email khi chữ ký phát hiện đổi so
// với lần gửi gần nhất, luôn cập nhật hrProfileAuditSummaryCache (đọc bởi thẻ Dashboard) mỗi lần chạy.
// LỖI ĐÃ VÁ (báo cáo người dùng 11/2026, "bỏ gửi email đến admin, chỉ gửi đến người nào có quyền audit
// nhân sự thôi"): trước đây gửi cho BẤT KỲ ai có `perms.admin` HOẶC 1 trong 3 quyền Hồ Sơ Nhân Sự/Hợp
// Đồng — không đối chiếu Khối 0 module `hrAudit`, và LUÔN gửi cho admin dù admin không hề bật quyền Hồ
// Sơ Nhân Sự nào (nhiễu hộp thư admin không liên quan). Nay đối chiếu ĐÚNG cùng điều kiện màn hình thật
// cho xem ("quyền audit nhân sự" — canAccessHrProfileAudit(), routes/hrProfileAudit.js) NHƯNG CỐ Ý BỎ
// nhánh admin-bypass của hàm đó (người dùng yêu cầu rõ "bỏ gửi email đến admin") — chỉ còn Khối 0
// hrAudit VÀ (canFullViewProfiles/canManageContracts/hrReportView), loại hẳn `perms.admin` đơn thuần
// (admin KHÔNG tự động nhận email nữa trừ khi CHÍNH tài khoản đó cũng được cấp 1 trong 3 quyền trên).
const { sendMail, resolveEncryption, resolveGraphOption, resolveEwsOption } = require('../lib/mailer');
const { decryptSecret } = require('../lib/emailCrypto');
const { getAppDataValue, setAppDataValue, getAllAppData } = require('../lib/appData');
const { insertSystemLog } = require('../lib/systemLogStore');
const { auditHrProfileGaps, computeFindingsSignature } = require('../lib/hrProfileAudit');
const { hasModuleAccessServer } = require('../lib/recordViewScope');
const { canFullViewProfiles } = require('../lib/employeeProfile');
const { canManageContracts } = require('../lib/laborContract');

const SUMMARY_CACHE_KEY = 'hrProfileAuditSummaryCache';
const CONFIG_KEY = 'hrProfileAuditJobConfig';
const STATE_KEY = 'hrProfileAuditJobState'; // { lastEmailedSignature }

const SEVERITY_LABEL = { CRITICAL: 'NGHIÊM TRỌNG', WARNING: 'Cảnh báo', INFO: 'Thông tin' };

function summarize(findings) {
  return {
    total: findings.length,
    critical: findings.filter(f => f.severity === 'CRITICAL').length,
    warning: findings.filter(f => f.severity === 'WARNING').length,
    info: findings.filter(f => f.severity === 'INFO').length
  };
}

async function checkHrProfileGaps() {
  try {
    const appData = await getAllAppData();
    const cfg = (await getAppDataValue(CONFIG_KEY)) || { autoScanEmailEnabled: true, ccEmails: [], draftStaleDaysThreshold: 30, contractExpirySoonDays: 30 };
    const findings = await auditHrProfileGaps(appData, cfg);
    const at = new Date().toISOString();
    const summary = summarize(findings);
    await setAppDataValue(SUMMARY_CACHE_KEY, { at, ...summary });

    if (cfg.autoScanEmailEnabled === false) return;

    const signature = computeFindingsSignature(findings);
    const state = (await getAppDataValue(STATE_KEY)) || {};
    if (state.lastEmailedSignature === signature) return;

    const emailConfig = (await getAppDataValue('emailConfig')) || {};
    // actionable: y hệt điều kiện canAccessHrProfileAudit() (routes/hrProfileAudit.js) TRỪ nhánh admin-
    // bypass — xem chú thích đầu file. active!==false: không gửi cho tài khoản đã khoá/nghỉ việc.
    const actionable = (appData.users || []).filter(u =>
      u && u.email && u.active !== false && hasModuleAccessServer(u, 'hrAudit') &&
      (canFullViewProfiles(u) || canManageContracts(u) || !!u.perms?.hrReportView));
    const ccEmails = Array.isArray(cfg.ccEmails) ? cfg.ccEmails : [];
    const rawRecipients = [
      ...actionable.map(u => ({ email: u.email, name: u.name || u.username })),
      ...ccEmails.map(e => ({ email: String(e).trim(), name: String(e).trim() }))
    ].filter(r => r.email);
    const seen = new Set();
    const recipients = rawRecipients.filter(r => {
      const key = r.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const subject = findings.length
      ? `[VPDT] Audit Nhân Sự: ${summary.total} phát hiện (${summary.critical} nghiêm trọng)`
      : '[VPDT] Audit Nhân Sự: không có phát hiện nào';
    const lines = findings
      .slice(0, 50)
      .map(f => `- [${SEVERITY_LABEL[f.severity] || f.severity}] ${f.employeeCode} (${f.name}): ${f.reason}`);
    const more = findings.length > 50 ? `\n... và ${findings.length - 50} phát hiện khác, xem đầy đủ trong màn Audit Nhân Sự.` : '';
    const body = findings.length
      ? `Audit Nhân Sự phát hiện ${summary.total} điểm cần rà soát (${summary.critical} nghiêm trọng, ${summary.warning} cảnh báo):\n\n${lines.join('\n')}${more}\n\nVui lòng vào Nhân Sự > "🔍 Audit Nhân Sự" để xem chi tiết.`
      : `Toàn bộ phát hiện đã ghi nhận trước đây giờ đã được xử lý hết.`;

    console.log(`[DMS EMAIL SIMULATOR] HR profile audit alert: ${subject}`);

    let sendResult = { sent: [], failed: [], simulated: true };
    if (recipients.length) {
      let smtpUser = null, smtpPass = null;
      if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
        try {
          smtpUser = emailConfig.smtpUser;
          smtpPass = decryptSecret(emailConfig.smtpPassEnc);
        } catch (err) {
          console.error('⛔ [Audit Nhân Sự] Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
        }
      }
      try {
        sendResult = await sendMail({
          to: recipients.map(r => r.email),
          subject, text: body,
          host: emailConfig.smtpHost, port: emailConfig.smtpPort, encryption: resolveEncryption(emailConfig),
          user: smtpUser, pass: smtpPass,
          from: emailConfig.senderEmail,
          graph: resolveGraphOption(emailConfig),
          ews: resolveEwsOption(emailConfig)
        });
      } catch (err) {
        console.error('⛔ [Audit Nhân Sự] Gửi email cảnh báo thất bại:', err.message);
        sendResult = { sent: [], failed: recipients.map(r => r.email), simulated: false };
      }
    }

    await insertSystemLog({
      username: 'system_scheduler',
      fullName: 'Hệ Thống (Tự Động)',
      ipAddress: 'SERVER (Scheduled Job)',
      module: 'HR_PROFILE',
      actionType: 'HR_AUDIT_ALERT',
      targetObject: `${summary.total} phát hiện`,
      description: recipients.length
        ? `Audit Nhân Sự phát hiện ${summary.total} điểm (${summary.critical} nghiêm trọng), đã gửi tới ${recipients.map(r => r.email).join(', ')}`
        : `Audit Nhân Sự phát hiện ${summary.total} điểm nhưng KHÔNG có người quản lý Nhân Sự/Hợp Đồng nào có email để nhận cảnh báo`,
      status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
    });

    await setAppDataValue(STATE_KEY, { lastEmailedSignature: signature, lastEmailedAt: at });
  } catch (err) {
    console.error('⛔ [Audit Nhân Sự] Lỗi khi quét/gửi cảnh báo:', err.message);
  }
}

module.exports = { checkHrProfileGaps };
