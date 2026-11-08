// jobs/workflowApproverGapAudit.js — quét hằng ngày "🔍 Audit Quy Trình: Lỗ Hổng Phê Duyệt" (11/2026),
// CÙNG KHUÔN jobs/diskSpaceMonitor.js (job "giám sát hệ thống" gửi cho TOÀN BỘ admin, không phải nhắc
// hạn theo từng hồ sơ/người cụ thể) — khác 1 điểm: dùng CHỮ KÝ phát hiện (computeFindingsSignature(),
// lib/workflowApproverAudit.js) để chỉ gửi email khi DANH SÁCH lỗ hổng thực sự ĐỔI so với lần gửi gần
// nhất (không phải cooldown theo thời gian như ổ đĩa) — tránh dội email mỗi ngày khi admin chưa kịp xử
// lý xong (số lỗ hổng không đổi thì không gửi lại), nhưng gửi NGAY khi có thêm/bớt 1 lỗ hổng bất kỳ (kể
// cả giảm — admin nên biết đã xử lý xong để yên tâm).
//
// LUÔN cập nhật workflowAuditSummaryCache (đọc bởi GET /api/admin/workflow-audit/summary — thẻ cảnh báo
// Dashboard) mỗi lần chạy, BẤT KỂ có gửi email hay không — màn Audit/Dashboard không nên hiện dữ liệu
// quá 1 ngày.
const { sendMail, resolveEncryption, resolveGraphOption, resolveEwsOption } = require('../lib/mailer');
const { decryptSecret } = require('../lib/emailCrypto');
const { getAppDataValue, setAppDataValue, getAllAppData } = require('../lib/appData');
const { insertSystemLog } = require('../lib/systemLogStore');
const { auditWorkflowApproverGaps, computeFindingsSignature } = require('../lib/workflowApproverAudit');

const SUMMARY_CACHE_KEY = 'workflowAuditSummaryCache';
const CONFIG_KEY = 'workflowAuditJobConfig';
const STATE_KEY = 'workflowAuditJobState'; // { lastEmailedSignature }

function summarize(findings) {
  return {
    total: findings.length,
    critical: findings.filter(f => f.severity === 'CRITICAL').length,
    warning: findings.filter(f => f.severity === 'WARNING').length
  };
}

async function checkWorkflowApproverGaps() {
  try {
    const appData = await getAllAppData();
    const findings = auditWorkflowApproverGaps(appData);
    const at = new Date().toISOString();
    const summary = summarize(findings);
    await setAppDataValue(SUMMARY_CACHE_KEY, { at, ...summary });

    const cfg = (await getAppDataValue(CONFIG_KEY)) || { autoScanEmailEnabled: true, ccEmails: [] };
    if (cfg.autoScanEmailEnabled === false) return;

    const signature = computeFindingsSignature(findings);
    const state = (await getAppDataValue(STATE_KEY)) || {};
    if (state.lastEmailedSignature === signature) return; // không đổi gì từ lần gửi gần nhất -> không dội email

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

    const subject = findings.length
      ? `[VPDT] CẢNH BÁO: ${summary.total} quy trình có lỗ hổng phê duyệt (${summary.critical} nghiêm trọng)`
      : '[VPDT] Audit Quy Trình: đã hết lỗ hổng phê duyệt';
    const lines = findings
      .slice(0, 50)
      .map(f => `- [${f.severity === 'CRITICAL' ? 'NGHIÊM TRỌNG' : 'Cảnh báo'}] ${f.scopeLabel} — ${f.stepName}: ${f.reason}`);
    const more = findings.length > 50 ? `\n... và ${findings.length - 50} lỗ hổng khác, xem đầy đủ trong màn Audit Quy Trình.` : '';
    const body = findings.length
      ? `Hệ thống phát hiện ${summary.total} quy trình phê duyệt đang có lỗ hổng (${summary.critical} nghiêm trọng, ${summary.warning} cảnh báo) — bước duyệt chưa gắn người, hoặc người được gắn đã bị khoá tài khoản/nghỉ việc:\n\n${lines.join('\n')}${more}\n\nVui lòng vào Hệ Thống > Quản Trị > "🔄 Quy Trình & Phê Duyệt" > "🔍 Audit Quy Trình" để xem chi tiết và bổ sung người duyệt.`
      : `Toàn bộ lỗ hổng phê duyệt đã phát hiện trước đây giờ đã được xử lý hết — không còn quy trình nào thiếu người duyệt.`;

    console.log(`[DMS EMAIL SIMULATOR] Workflow audit alert: ${subject}`);

    let sendResult = { sent: [], failed: [], simulated: true };
    if (recipients.length) {
      let smtpUser = null, smtpPass = null;
      if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
        try {
          smtpUser = emailConfig.smtpUser;
          smtpPass = decryptSecret(emailConfig.smtpPassEnc);
        } catch (err) {
          console.error('⛔ [Audit Quy Trình] Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
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
        console.error('⛔ [Audit Quy Trình] Gửi email cảnh báo thất bại:', err.message);
        sendResult = { sent: [], failed: recipients.map(r => r.email), simulated: false };
      }
    }

    await insertSystemLog({
      username: 'system_scheduler',
      fullName: 'Hệ Thống (Tự Động)',
      ipAddress: 'SERVER (Scheduled Job)',
      module: 'SYSTEM',
      actionType: 'WORKFLOW_AUDIT_ALERT',
      targetObject: `${summary.total} lỗ hổng`,
      description: recipients.length
        ? `Audit Quy Trình phát hiện ${summary.total} lỗ hổng (${summary.critical} nghiêm trọng), đã gửi tới ${recipients.map(r => r.email).join(', ')}`
        : `Audit Quy Trình phát hiện ${summary.total} lỗ hổng nhưng KHÔNG có admin nào có email để nhận cảnh báo — hãy bổ sung email cho tài khoản admin`,
      status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
    });

    await setAppDataValue(STATE_KEY, { lastEmailedSignature: signature, lastEmailedAt: at });
  } catch (err) {
    console.error('⛔ [Audit Quy Trình] Lỗi khi quét/gửi cảnh báo:', err.message);
  }
}

module.exports = { checkWorkflowApproverGaps };
