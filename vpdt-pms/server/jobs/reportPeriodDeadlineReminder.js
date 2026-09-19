// jobs/reportPeriodDeadlineReminder.js — LỖI ĐÃ VÁ (rà soát chuyên sâu Điều Hành, 9/2026): tài liệu
// Nghiệp Vụ (public/js/module-nghiepvu.js, entry periodicReport) TUYÊN BỐ "hệ thống tự nhắc các phòng
// ban chưa nộp khi gần tới hạn kỳ báo cáo, tránh thiếu số liệu lúc tổng hợp" nhưng job này CHƯA TỪNG
// được cài đặt — không có bất kỳ cơ chế nhắc hạn nào cho reportPeriods trước đây. Phòng ban quên nộp
// đúng hạn không nhận được nhắc nhở nào, tới lúc người quản lý tổng hợp mới phát hiện thiếu số liệu.
//
// Nhân bản đúng khuôn jobs/hrTaskOverdueReminder.js/contractExpiryReminder.js (đọc emailConfig chung,
// gửi email THẬT qua lib/mailer.js nếu đã cấu hình SMTP thật, cô lập lỗi theo từng kỳ, chỉ đánh dấu đã
// nhắc khi KHÔNG thất bại toàn bộ để lần chạy sau tự thử lại). Ngưỡng nhắc CỐ ĐỊNH (3/1/0 ngày — kỳ báo
// cáo thường có vòng đời ngắn hơn nhiều so với hợp đồng/giấy phép, không cần cấu hình admin riêng như
// contractExpiryReminderDays).
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

// Phòng ban thuộc phạm vi kỳ (deptScope.all -> TOÀN BỘ danh mục phòng ban đang có, đúng khuôn
// inScope()/extraValidate() ở lib/recordActions.js + lib/createValidation.js).
function scopedDepts(period, allDepts) {
  if (period.deptScope?.all) return allDepts.slice();
  return Array.isArray(period.deptScope?.depts) ? period.deptScope.depts.slice() : [];
}

async function checkReportPeriodDeadlineReminders() {
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('⛔ [Nhắc hạn Báo Cáo Định Kỳ] Không kết nối được SQL Server:', err.message);
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
        console.error('⛔ [Nhắc hạn Báo Cáo Định Kỳ] Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
      }
    }
    const smtpEncryption = resolveEncryption(emailConfig);

    const periods = await getAllForCollection('reportPeriods');
    if (!Array.isArray(periods) || periods.length === 0) return;
    const openPeriods = periods.filter(p => p && p.status === 'OPEN' && p.endTime);
    if (!openPeriods.length) return;

    const entries = await getAllForCollection('reportEntries');
    const users = await getCollection(pool, 'users', []);
    const depts = await getCollection(pool, 'depts', []);

    for (const period of openPeriods) {
      try {
        const diffDays = daysUntil(period.endTime);
        if (diffDays === null) continue;
        const notified = Array.isArray(period.notifiedDeadlineThresholds) ? period.notifiedDeadlineThresholds : [];
        const newlyCrossedThresholds = REMINDER_DAYS.filter(t => diffDays <= t && !notified.includes(t));
        if (!newlyCrossedThresholds.length) continue;
        const threshold = Math.min(...newlyCrossedThresholds);
        const label = threshold === 0
          ? (diffDays < 0 ? `đã quá hạn ${Math.abs(diffDays)} ngày` : 'hết hạn hôm nay')
          : `còn khoảng ${threshold} ngày là hết hạn`;

        // Phòng ban thuộc phạm vi kỳ CHƯA có báo cáo SUBMITTED nào (DRAFT chưa gửi vẫn coi là chưa nộp,
        // đúng nguyên tắc "đã gửi" ở submitReportEntry() — nháp không tính là đã nộp).
        const submittedDepts = new Set(
          entries.filter(e => e.periodId === period.id && e.status === 'SUBMITTED').map(e => e.dept)
        );
        const missingDepts = scopedDepts(period, depts).filter(d => !submittedDepts.has(d));
        if (!missingDepts.length) {
          // Không còn phòng ban nào thiếu -> không cần nhắc, nhưng vẫn đánh dấu ngưỡng đã "qua" để
          // không kiểm tra lại vô ích ở các lượt chạy sau cùng ngưỡng này.
          await withLockedRecordById('reportPeriods', period.id, (item) => {
            item.notifiedDeadlineThresholds = [...new Set([...(item.notifiedDeadlineThresholds || []), ...newlyCrossedThresholds])];
            return item;
          });
          continue;
        }

        let anyAttempted = false;
        let anyTotalFailure = false;
        for (const dept of missingDepts) {
          const recipients = users
            .filter(u => u && u.active !== false && u.email && u.dept === dept && (u.perms?.admin || u.perms?.reportEntryCreate))
            .map(u => ({ email: u.email, name: u.name || u.username }));

          const subject = `[VPDT] Kỳ báo cáo "${period.name}" ${label} — "${dept}" chưa nộp`;
          const body = `Kỳ báo cáo "${period.name}" ${label} (hạn: ${period.endTime}). Phòng ban "${dept}" CHƯA nộp báo cáo cho kỳ này — vui lòng nộp sớm để tránh thiếu số liệu lúc tổng hợp.`;

          for (const r of recipients) {
            console.log(`[DMS EMAIL SIMULATOR] To: ${r.name} <${r.email}> | Subject: ${subject}\n  ${body}`);
          }
          let sendResult = { sent: [], failed: [], simulated: true };
          if (recipients.length) {
            anyAttempted = true;
            try {
              sendResult = await sendMail({
                to: recipients.map(r => r.email),
                subject, text: body,
                host: emailConfig.smtpHost, port: emailConfig.smtpPort, encryption: smtpEncryption,
                user: smtpUser, pass: smtpPass,
                from: emailConfig.senderEmail
              });
            } catch (err) {
              console.error('⛔ [Nhắc hạn Báo Cáo Định Kỳ] Gửi email thật thất bại:', err.message);
              sendResult = { sent: [], failed: recipients.map(r => r.email), simulated: false };
            }
            const totalFailure = !sendResult.simulated && sendResult.sent.length === 0 && sendResult.failed.length > 0;
            if (totalFailure) anyTotalFailure = true;
          }

          await insertSystemLog({
            username: 'system_scheduler', fullName: 'Hệ Thống (Tự Động)', ipAddress: 'SERVER (Scheduled Job)',
            module: 'PERIODIC_REPORT', actionType: 'DEADLINE_REMINDER', targetObject: `${period.name} — ${dept}`,
            description: recipients.length
              ? `Kỳ báo cáo [${period.name}] (${label}) — "${dept}" chưa nộp, đã nhắc tới ${recipients.map(r => r.email).join(', ')}`
              : `Kỳ báo cáo [${period.name}] (${label}) — "${dept}" chưa nộp, nhưng chưa có ai của phòng này có quyền "Nộp Báo Cáo Định Kỳ" kèm email hợp lệ để nhắc`,
            status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
          });
        }

        // Chỉ đánh dấu đã nhắc nếu KHÔNG có lượt gửi thật nào thất bại toàn bộ — để lần chạy kế tiếp tự
        // thử lại đúng ngưỡng này nếu SMTP lỗi thoáng qua (đúng khuôn contractExpiryReminder.js).
        if (!anyTotalFailure || !anyAttempted) {
          await withLockedRecordById('reportPeriods', period.id, (item) => {
            item.notifiedDeadlineThresholds = [...new Set([...(item.notifiedDeadlineThresholds || []), ...newlyCrossedThresholds])];
            return item;
          });
        }
      } catch (err) {
        console.error(`⛔ [Nhắc hạn Báo Cáo Định Kỳ] Lỗi khi xử lý kỳ ${period.name || period.id}, bỏ qua và tiếp tục các kỳ còn lại:`, err.message);
      }
    }
  } catch (err) {
    console.error('⛔ [Nhắc hạn Báo Cáo Định Kỳ] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = { checkReportPeriodDeadlineReminders };
