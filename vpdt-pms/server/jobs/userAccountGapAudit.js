// jobs/userAccountGapAudit.js — quét hằng ngày "🔍 Audit Người Dùng" (11/2026), CÙNG KHUÔN
// jobs/workflowApproverGapAudit.js (đọc chú thích đầy đủ ở đó) — chỉ gửi email khi chữ ký phát hiện đổi
// so với lần gửi gần nhất, luôn cập nhật userAuditSummaryCache (đọc bởi thẻ Dashboard) mỗi lần chạy.
const { sendMail, resolveEncryption, resolveGraphOption, resolveEwsOption } = require('../lib/mailer');
const { decryptSecret } = require('../lib/emailCrypto');
const { getAppDataValue, setAppDataValue, getAllAppData } = require('../lib/appData');
const { insertSystemLog } = require('../lib/systemLogStore');
const { auditUserAccountGaps, computeFindingsSignature } = require('../lib/userAccountAudit');

const SUMMARY_CACHE_KEY = 'userAuditSummaryCache';
const CONFIG_KEY = 'userAuditJobConfig';
const STATE_KEY = 'userAuditJobState'; // { lastEmailedSignature }

const SEVERITY_LABEL = { CRITICAL: 'NGHIÊM TRỌNG', WARNING: 'Cảnh báo', INFO: 'Thông tin' };

function summarize(findings) {
  return {
    total: findings.length,
    critical: findings.filter(f => f.severity === 'CRITICAL').length,
    warning: findings.filter(f => f.severity === 'WARNING').length,
    info: findings.filter(f => f.severity === 'INFO').length
  };
}

async function checkUserAccountGaps() {
  try {
    const appData = await getAllAppData();
    const cfg = (await getAppDataValue(CONFIG_KEY)) || { autoScanEmailEnabled: true, ccEmails: [], dormantDaysThreshold: 90 };
    const findings = auditUserAccountGaps(appData, cfg);
    const at = new Date().toISOString();
    const summary = summarize(findings);
    await setAppDataValue(SUMMARY_CACHE_KEY, { at, ...summary });

    if (cfg.autoScanEmailEnabled === false) return;

    const signature = computeFindingsSignature(findings);
    const state = (await getAppDataValue(STATE_KEY)) || {};
    if (state.lastEmailedSignature === signature) return;

    const emailConfig = (await getAppDataValue('emailConfig')) || {};
    const admins = (appData.users || []).filter(u => u.perms?.admin && u.email);
    const ccEmails = Array.isArray(cfg.ccEmails) ? cfg.ccEmails : [];
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

    // CRITICAL duy nhất của audit này là A1 (tài khoản active dù HR đã nghỉ việc) — ưu tiên hiện số đó
    // ở chủ đề email, vì WARNING/INFO (A2/A3/A4) chỉ là rà soát chủ động, không cần giật tiêu đề.
    const subject = findings.length
      ? `[VPDT] Audit Người Dùng: ${summary.total} phát hiện (${summary.critical} nghiêm trọng)`
      : '[VPDT] Audit Người Dùng: không có phát hiện nào';
    const lines = findings
      .slice(0, 50)
      .map(f => `- [${SEVERITY_LABEL[f.severity] || f.severity}] ${f.username} (${f.name}): ${f.reason}`);
    const more = findings.length > 50 ? `\n... và ${findings.length - 50} phát hiện khác, xem đầy đủ trong màn Audit Người Dùng.` : '';
    const body = findings.length
      ? `Audit Người Dùng phát hiện ${summary.total} điểm cần rà soát (${summary.critical} nghiêm trọng, ${summary.warning} cảnh báo, ${summary.info} thông tin):\n\n${lines.join('\n')}${more}\n\nVui lòng vào Hệ Thống > Quản Trị > "🔍 Audit Người Dùng" để xem chi tiết.`
      : `Toàn bộ phát hiện đã ghi nhận trước đây giờ đã được xử lý hết.`;

    console.log(`[DMS EMAIL SIMULATOR] User account audit alert: ${subject}`);

    let sendResult = { sent: [], failed: [], simulated: true };
    if (recipients.length) {
      let smtpUser = null, smtpPass = null;
      if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
        try {
          smtpUser = emailConfig.smtpUser;
          smtpPass = decryptSecret(emailConfig.smtpPassEnc);
        } catch (err) {
          console.error('⛔ [Audit Người Dùng] Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
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
        console.error('⛔ [Audit Người Dùng] Gửi email cảnh báo thất bại:', err.message);
        sendResult = { sent: [], failed: recipients.map(r => r.email), simulated: false };
      }
    }

    await insertSystemLog({
      username: 'system_scheduler',
      fullName: 'Hệ Thống (Tự Động)',
      ipAddress: 'SERVER (Scheduled Job)',
      module: 'SYSTEM',
      actionType: 'USER_AUDIT_ALERT',
      targetObject: `${summary.total} phát hiện`,
      description: recipients.length
        ? `Audit Người Dùng phát hiện ${summary.total} điểm (${summary.critical} nghiêm trọng), đã gửi tới ${recipients.map(r => r.email).join(', ')}`
        : `Audit Người Dùng phát hiện ${summary.total} điểm nhưng KHÔNG có admin nào có email để nhận cảnh báo`,
      status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
    });

    await setAppDataValue(STATE_KEY, { lastEmailedSignature: signature, lastEmailedAt: at });
  } catch (err) {
    console.error('⛔ [Audit Người Dùng] Lỗi khi quét/gửi cảnh báo:', err.message);
  }
}

module.exports = { checkUserAccountGaps };
