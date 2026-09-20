// jobs/itApprovalDeadlineReminder.js — LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): 2 luồng "đang chờ
// xử lý" của Hỗ Trợ IT/Phê Duyệt Giá chỉ hiện badge chờ trên giao diện, KHÔNG job nào chủ động nhắc:
//   1. itSupportTickets.approvalStatus === 'PENDING' (escalateItTicket(), lib/recordActions.js) — ticket
//      "leo thang" xin ý kiến 1 người cụ thể có thể bị quên vô thời hạn nếu người đó không chủ động vào
//      xem, ticket vẫn TODO/DOING chờ mãi (approveItTicketEscalation()/denyItTicketEscalation() chặn mọi
//      chuyển trạng thái khi còn PENDING).
//   2. itPriceApprovals.infoRequests[] còn chưa phản hồi (response == null) — người đề xuất (item.creator)
//      có thể bỏ sót yêu cầu bổ sung, hồ sơ treo vô thời hạn (submitPriceSupplementFile() chặn tiếp tục).
//   3. itPriceApprovals.emergencyRejectStatus === 'PENDING' (requestItPriceEmergencyReject()) — người có
//      quyền itPriceEmergencyRejectApprove(Wholesale/Retail) tương ứng priceType chưa xử lý.
//
// Khác payment/report-period (nhiều NGƯỠNG nhắc dồn), 3 luồng này chỉ cần NHẮC ĐÚNG 1 LẦN sau khi treo
// quá PENDING_REMINDER_DAYS (không có "càng gần hạn càng nhắc dồn" vì đây không phải hạn cố định biết
// trước — chỉ là "đã treo quá lâu chưa ai xử lý") — theo dõi bằng field boolean *ReminderSent (gán sẵn
// false khi mở yêu cầu, xem escalateItTicket()/requestPriceInfoFromIt()/requestItPriceEmergencyReject()
// ở lib/recordActions.js) thay vì mảng notifiedThresholds.
//
// Nhân bản khuôn giả lập/gửi mail chung với jobs/hrTaskOverdueReminder.js.
const { getPool, sql } = require('../db');
const { sendMail, resolveEncryption } = require('../lib/mailer');
const { decryptSecret } = require('../lib/emailCrypto');
const { getAllForCollection, withLockedRecordById } = require('../lib/recordStore');
const { insertSystemLog } = require('../lib/systemLogStore');
const { parseVNDateTime } = require('../lib/recordActions');

const PENDING_REMINDER_DAYS = 2;

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

function daysSince(vnDateTimeStr) {
  const dt = parseVNDateTime(vnDateTimeStr);
  if (!dt) return null;
  return (Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24);
}

async function checkItApprovalDeadlineReminders() {
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('⛔ [Nhắc hạn Phê Duyệt IT] Không kết nối được SQL Server:', err.message);
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
        console.error('⛔ [Nhắc hạn Phê Duyệt IT] Không giải mã được mật khẩu SMTP đã lưu:', err.message);
      }
    }
    const smtpEncryption = resolveEncryption(emailConfig);
    const users = await getCollection(pool, 'users', []);

    async function sendReminder(subject, body, recipients, logTarget) {
      for (const r of recipients) {
        console.log(`[DMS EMAIL SIMULATOR] To: ${r.name} <${r.email}> | Subject: ${subject}\n  ${body}`);
      }
      let sendResult = { sent: [], failed: [], simulated: true };
      if (recipients.length) {
        try {
          sendResult = await sendMail({
            to: recipients.map(r => r.email), subject, text: body,
            host: emailConfig.smtpHost, port: emailConfig.smtpPort, encryption: smtpEncryption,
            user: smtpUser, pass: smtpPass, from: emailConfig.senderEmail
          });
        } catch (err) {
          console.error('⛔ [Nhắc hạn Phê Duyệt IT] Gửi email thật thất bại:', err.message);
          sendResult = { sent: [], failed: recipients.map(r => r.email), simulated: false };
        }
      }
      const totalSendFailure = recipients.length > 0 && !sendResult.simulated && sendResult.sent.length === 0 && sendResult.failed.length > 0;
      await insertSystemLog({
        username: 'system_scheduler', fullName: 'Hệ Thống (Tự Động)', ipAddress: 'SERVER (Scheduled Job)',
        module: 'IT_SUPPORT', actionType: 'DEADLINE_REMINDER', targetObject: logTarget,
        description: recipients.length
          ? `${totalSendFailure ? 'LỖI gửi nhắc hạn' : 'Đã gửi nhắc hạn'} [${logTarget}] tới ${recipients.map(r => r.email).join(', ')}`
          : `[${logTarget}] chưa có người nhận hợp lệ (chưa có email hợp lệ)`,
        status: recipients.length ? (totalSendFailure ? 'WARNING' : 'SUCCESS') : 'WARNING'
      });
      return !totalSendFailure;
    }

    // ===== 1. itSupportTickets: leo thang phê duyệt treo quá lâu =====
    const tickets = await getAllForCollection('itSupportTickets');
    for (const ticket of (tickets || [])) {
      try {
        if (!ticket || ticket.approvalStatus !== 'PENDING' || ticket.approvalReminderSent) continue;
        const days = daysSince(ticket.escalatedAt);
        if (days === null || days < PENDING_REMINDER_DAYS) continue;
        const approver = users.find(u => u.username === ticket.approvalApprover && u.active !== false);
        const recipients = (approver && approver.email) ? [{ email: approver.email, name: approver.name || approver.username }] : [];
        const subject = `[VPDT] Yêu cầu phê duyệt IT "${ticket.title || ''}" (${ticket.code || ticket.id}) đang chờ xử lý quá ${PENDING_REMINDER_DAYS} ngày`;
        const body = `Yêu cầu phê duyệt cho ticket IT "${ticket.title || ''}" (${ticket.code || ''}) gửi tới bạn từ ${ticket.escalatedAt} vẫn chưa được xử lý. Lý do: ${ticket.approvalReason || ''}.`;
        const ok = await sendReminder(subject, body, recipients, `Ticket IT ${ticket.code || ticket.id}`);
        if (ok) {
          await withLockedRecordById('itSupportTickets', ticket.id, (item) => {
            item.approvalReminderSent = true;
            return item;
          });
        }
      } catch (err) {
        console.error(`⛔ [Nhắc hạn Phê Duyệt IT] Lỗi khi xử lý ticket ${ticket.code || ticket.id}, bỏ qua và tiếp tục:`, err.message);
      }
    }

    // ===== 2 & 3. itPriceApprovals: yêu cầu bổ sung + từ chối khẩn cấp treo quá lâu =====
    const priceApprovals = await getAllForCollection('itPriceApprovals');
    for (const item of (priceApprovals || [])) {
      try {
        let changed = false;
        const openInfoReq = (item.infoRequests || []).find(r => !r.response && !r.reminderSent);
        if (openInfoReq) {
          const days = daysSince(openInfoReq.requestedAt);
          if (days !== null && days >= PENDING_REMINDER_DAYS) {
            const creator = users.find(u => u.username === item.creator && u.active !== false);
            const recipients = (creator && creator.email) ? [{ email: creator.email, name: creator.name || creator.username }] : [];
            const subject = `[VPDT] Đề xuất giá "${item.code || item.id}" đang chờ bạn bổ sung quá ${PENDING_REMINDER_DAYS} ngày`;
            const body = `Đề xuất giá của bạn (${item.code || item.id}) có yêu cầu bổ sung từ ${openInfoReq.requestedByName} (từ ${openInfoReq.requestedAt}) chưa được phản hồi: ${openInfoReq.reason}`;
            const ok = await sendReminder(subject, body, recipients, `Đề xuất giá ${item.code || item.id} — yêu cầu bổ sung`);
            if (ok) { openInfoReq.reminderSent = true; changed = true; }
          }
        }
        if (item.emergencyRejectStatus === 'PENDING' && !item.emergencyRejectReminderSent) {
          const days = daysSince(item.emergencyRejectRequestedAt);
          if (days !== null && days >= PENDING_REMINDER_DAYS) {
            const flag = item.priceType === 'WHOLESALE' ? 'itPriceEmergencyRejectApproveWholesale' : 'itPriceEmergencyRejectApproveRetail';
            const recipients = users.filter(u => u && u.active !== false && u.email && (u.perms?.admin || u.perms?.[flag]))
              .map(u => ({ email: u.email, name: u.name || u.username }));
            const subject = `[VPDT] Yêu cầu từ chối khẩn cấp đề xuất giá "${item.code || item.id}" đang chờ xử lý quá ${PENDING_REMINDER_DAYS} ngày`;
            const body = `Yêu cầu từ chối khẩn cấp cho đề xuất giá (${item.code || item.id}) gửi từ ${item.emergencyRejectRequestedByName} (từ ${item.emergencyRejectRequestedAt}) vẫn chưa được xử lý. Lý do: ${item.emergencyRejectReason || ''}.`;
            const ok = await sendReminder(subject, body, recipients, `Đề xuất giá ${item.code || item.id} — từ chối khẩn cấp`);
            if (ok) { item.emergencyRejectReminderSent = true; changed = true; }
          }
        }
        if (changed) {
          await withLockedRecordById('itPriceApprovals', item.id, (rec) => {
            rec.infoRequests = item.infoRequests;
            rec.emergencyRejectReminderSent = item.emergencyRejectReminderSent;
            return rec;
          });
        }
      } catch (err) {
        console.error(`⛔ [Nhắc hạn Phê Duyệt IT] Lỗi khi xử lý đề xuất giá ${item.code || item.id}, bỏ qua và tiếp tục:`, err.message);
      }
    }
  } catch (err) {
    console.error('⛔ [Nhắc hạn Phê Duyệt IT] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = { checkItApprovalDeadlineReminders, PENDING_REMINDER_DAYS };
