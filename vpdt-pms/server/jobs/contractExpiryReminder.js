// jobs/contractExpiryReminder.js — Job định kỳ quét hợp đồng sắp/đã hết hạn và gửi thông báo nhắc
// nhở — ghi console + Nhật ký hệ thống như trước, đồng thời gửi email THẬT qua lib/mailer.js nếu
// server đã cấu hình SMTP thật (biến môi trường); nếu chưa cấu hình thì mailer tự trả về
// simulated:true và job vẫn chạy bình thường như cơ chế mô phỏng cũ.
//
// LƯU Ý: contracts đã chuyển sang bảng dbo.Records từ Bước 6g (xem lib/recordStore.js) — job này đọc
// qua getAllForCollection('contracts') và ghi lại notifiedThresholds qua withLockedRecordById() cho
// từng hợp đồng thay đổi, thay vì đọc/ghi nguyên mảng AppData.contracts như trước. Nhật ký hệ thống
// cũng đã chuyển sang dbo.SystemLogs từ Bước 6a (lib/systemLogStore.js) — job này trước đây vẫn đọc/
// ghi thẳng AppData.systemLogs (key đã không còn ai đọc từ Bước 6a, log của job này từng bị lạc mất
// khỏi Nhật ký hệ thống thật mà không ai biết) — nay ghi qua insertSystemLog() để log thật sự xuất
// hiện trong Nhật ký hệ thống.
const { getPool, sql } = require('../db');
const { sendMail } = require('../lib/mailer');
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

async function saveCollection(pool, key, value) {
  await pool.request()
    .input('k', sql.NVarChar(100), key)
    .input('v', sql.NVarChar(sql.MAX), JSON.stringify(value))
    .query(`
      MERGE dbo.AppData AS target
      USING (SELECT @k AS DataKey) AS src
      ON target.DataKey = src.DataKey
      WHEN MATCHED THEN
        UPDATE SET DataValue = @v, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (DataKey, DataValue) VALUES (@k, @v);
    `);
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

async function checkContractExpiryReminders() {
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('⛔ [Nhắc hạn hợp đồng] Không kết nối được SQL Server:', err.message);
    return;
  }

  try {
    const emailConfig = await getCollection(pool, 'emailConfig', {});
    if (!emailConfig || emailConfig.enabled === false) return;

    const configuredDays = Array.isArray(emailConfig.contractExpiryReminderDays) && emailConfig.contractExpiryReminderDays.length
      ? emailConfig.contractExpiryReminderDays.map(Number).filter(n => Number.isFinite(n) && n >= 0)
      : DEFAULT_REMINDER_DAYS;
    // Luôn kèm ngưỡng 0 (đúng ngày/đã hết hạn), sắp giảm dần để log theo thứ tự dễ đọc.
    const thresholds = Array.from(new Set([...configuredDays, 0])).sort((a, b) => b - a);
    const ccEmails = Array.isArray(emailConfig.contractExpiryCcEmails) ? emailConfig.contractExpiryCcEmails : [];

    const contracts = await getAllForCollection('contracts');
    if (!Array.isArray(contracts) || contracts.length === 0) return;

    const users = await getCollection(pool, 'users', []);

    for (const c of contracts) {
      if (!c || !c.endDate) continue;
      const diffDays = daysUntil(c.endDate);
      if (diffDays === null) continue;
      if (!Array.isArray(c.notifiedThresholds)) c.notifiedThresholds = [];

      let contractChanged = false;

      for (const threshold of thresholds) {
        if (diffDays > threshold) continue; // chưa tới ngưỡng này
        if (c.notifiedThresholds.includes(threshold)) continue; // đã nhắc rồi, không gửi trùng

        const creator = users.find(u => u.username === c.creator);
        const label = threshold === 0
          ? (diffDays < 0 ? `đã hết hạn ${Math.abs(diffDays)} ngày` : 'hết hạn hôm nay')
          : `còn khoảng ${threshold} ngày là hết hạn`;
        const subject = `[VPDT] Hợp đồng ${c.code} ${label}`;
        const body = `Hợp đồng "${c.title}" (${c.code}, đối tác: ${c.partner || 'N/A'}) ${label}. Ngày hết hạn: ${c.endDate}.`;

        const recipients = [];
        if (creator && creator.email) recipients.push({ email: creator.email, name: creator.name || c.creator });
        for (const cc of ccEmails) {
          const email = String(cc).trim();
          if (email) recipients.push({ email, name: email });
        }

        for (const r of recipients) {
          console.log(`[DMS EMAIL SIMULATOR] To: ${r.name} <${r.email}> | Subject: ${subject}\n  ${body}`);
        }

        let sendResult = { sent: [], failed: [], simulated: true };
        if (recipients.length) {
          try {
            sendResult = await sendMail({
              to: recipients.map(r => r.email),
              subject, text: body,
              host: emailConfig.smtpHost, port: emailConfig.smtpPort, secure: emailConfig.smtpSecure,
              from: emailConfig.senderEmail
            });
          } catch (err) {
            console.error('⛔ [Nhắc hạn hợp đồng] Gửi email thật thất bại:', err.message);
          }
        }

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
          module: 'CONTRACT',
          actionType: 'EXPIRY_REMINDER',
          targetObject: c.code,
          description: recipients.length
            ? `Đã gửi nhắc hạn hợp đồng [${c.code} - ${c.title}] (${label}) tới ${recipients.map(r => r.email).join(', ')}${statusSuffix}`
            : `Hợp đồng [${c.code} - ${c.title}] (${label}) chưa có người nhận hợp lệ (người tạo chưa có email, không có CC)`,
          status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
        });

        c.notifiedThresholds.push(threshold);
        contractChanged = true;
      }

      if (contractChanged) {
        await withLockedRecordById('contracts', c.id, (item) => {
          item.notifiedThresholds = c.notifiedThresholds;
          return item;
        });
      }
    }
  } catch (err) {
    console.error('⛔ [Nhắc hạn hợp đồng] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = { checkContractExpiryReminders };
