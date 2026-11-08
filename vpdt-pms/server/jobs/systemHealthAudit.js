// jobs/systemHealthAudit.js — quét hằng ngày "🔍 Audit Hệ Thống" (11/2026), CÙNG KHUÔN
// jobs/workflowApproverGapAudit.js/jobs/userAccountGapAudit.js (đọc chú thích đầy đủ ở đó) — khác 1
// điểm: auditSystemHealthGaps() là ASYNC (đọc CSDL ErrorLogs + đĩa uploads/), appData chỉ cần cho danh
// sách admin nhận email, không cần cho chính việc quét.
const { sendMail, resolveEncryption, resolveGraphOption, resolveEwsOption } = require('../lib/mailer');
const { decryptSecret } = require('../lib/emailCrypto');
const { getAppDataValue, setAppDataValue, getAllAppData } = require('../lib/appData');
const { insertSystemLog } = require('../lib/systemLogStore');
const { auditSystemHealthGaps, computeFindingsSignature } = require('../lib/systemHealthAudit');

const SUMMARY_CACHE_KEY = 'systemAuditSummaryCache';
const CONFIG_KEY = 'systemAuditJobConfig';
const STATE_KEY = 'systemAuditJobState'; // { lastEmailedSignature }

const SEVERITY_LABEL = { CRITICAL: 'NGHIÊM TRỌNG', WARNING: 'Cảnh báo', INFO: 'Thông tin' };

function summarize(findings) {
  return {
    total: findings.length,
    critical: findings.filter(f => f.severity === 'CRITICAL').length,
    warning: findings.filter(f => f.severity === 'WARNING').length,
    info: findings.filter(f => f.severity === 'INFO').length
  };
}

async function checkSystemHealthGaps() {
  try {
    const findings = await auditSystemHealthGaps();
    const at = new Date().toISOString();
    const summary = summarize(findings);
    await setAppDataValue(SUMMARY_CACHE_KEY, { at, ...summary });

    const cfg = (await getAppDataValue(CONFIG_KEY)) || { autoScanEmailEnabled: true, ccEmails: [] };
    if (cfg.autoScanEmailEnabled === false) return;

    const signature = computeFindingsSignature(findings);
    const state = (await getAppDataValue(STATE_KEY)) || {};
    if (state.lastEmailedSignature === signature) return;

    const emailConfig = (await getAppDataValue('emailConfig')) || {};
    const appData = await getAllAppData();
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

    const subject = findings.length
      ? `[VPDT] Audit Hệ Thống: ${summary.total} phát hiện (${summary.critical} nghiêm trọng)`
      : '[VPDT] Audit Hệ Thống: không có phát hiện nào';
    const lines = findings
      .slice(0, 50)
      .map(f => `- [${SEVERITY_LABEL[f.severity] || f.severity}] ${f.scopeLabel}: ${f.reason}`);
    const more = findings.length > 50 ? `\n... và ${findings.length - 50} phát hiện khác, xem đầy đủ trong màn Audit Hệ Thống.` : '';
    const body = findings.length
      ? `Audit Hệ Thống phát hiện ${summary.total} điểm cần rà soát (${summary.critical} nghiêm trọng, ${summary.warning} cảnh báo):\n\n${lines.join('\n')}${more}\n\nVui lòng vào Hệ Thống > Quản Trị > "🔍 Audit Hệ Thống" để xem chi tiết.`
      : `Toàn bộ phát hiện đã ghi nhận trước đây giờ đã được xử lý hết.`;

    console.log(`[DMS EMAIL SIMULATOR] System health audit alert: ${subject}`);

    let sendResult = { sent: [], failed: [], simulated: true };
    if (recipients.length) {
      let smtpUser = null, smtpPass = null;
      if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
        try {
          smtpUser = emailConfig.smtpUser;
          smtpPass = decryptSecret(emailConfig.smtpPassEnc);
        } catch (err) {
          console.error('⛔ [Audit Hệ Thống] Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
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
        console.error('⛔ [Audit Hệ Thống] Gửi email cảnh báo thất bại:', err.message);
        sendResult = { sent: [], failed: recipients.map(r => r.email), simulated: false };
      }
    }

    await insertSystemLog({
      username: 'system_scheduler',
      fullName: 'Hệ Thống (Tự Động)',
      ipAddress: 'SERVER (Scheduled Job)',
      module: 'SYSTEM',
      actionType: 'SYSTEM_HEALTH_AUDIT_ALERT',
      targetObject: `${summary.total} phát hiện`,
      description: recipients.length
        ? `Audit Hệ Thống phát hiện ${summary.total} điểm (${summary.critical} nghiêm trọng), đã gửi tới ${recipients.map(r => r.email).join(', ')}`
        : `Audit Hệ Thống phát hiện ${summary.total} điểm nhưng KHÔNG có admin nào có email để nhận cảnh báo`,
      status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
    });

    await setAppDataValue(STATE_KEY, { lastEmailedSignature: signature, lastEmailedAt: at });
  } catch (err) {
    console.error('⛔ [Audit Hệ Thống] Lỗi khi quét/gửi cảnh báo:', err.message);
  }
}

module.exports = { checkSystemHealthGaps };
