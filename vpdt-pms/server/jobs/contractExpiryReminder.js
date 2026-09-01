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
const { sendMail, resolveEncryption } = require('../lib/mailer');
const { decryptSecret } = require('../lib/emailCrypto');
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
    // Người phụ trách RIÊNG theo từng phòng ban (bổ sung cho ccEmails ở trên, không thay thế — xem
    // defaults.js/index.html): { [dept]: [{name, email}, ...] }.
    const deptContacts = await getCollection(pool, 'contractExpiryDeptContacts', {});

    // Tài khoản/mật khẩu SMTP: ưu tiên DB.emailConfig (đã mã hoá, xem lib/emailCrypto.js), rơi về
    // .env nếu chưa cấu hình qua web (đường lùi cũ, xem lib/mailer.js) — lỗi giải mã (khoá đổi/hỏng)
    // không nên chặn hẳn job, chỉ log cảnh báo và coi như chưa có tài khoản DB.
    let smtpUser = null, smtpPass = null;
    if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
      try {
        smtpUser = emailConfig.smtpUser;
        smtpPass = decryptSecret(emailConfig.smtpPassEnc);
      } catch (err) {
        console.error('⛔ [Nhắc hạn hợp đồng] Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
      }
    }
    const smtpEncryption = resolveEncryption(emailConfig);

    const contracts = await getAllForCollection('contracts');
    if (!Array.isArray(contracts) || contracts.length === 0) return;

    const users = await getCollection(pool, 'users', []);

    for (const c of contracts) {
      if (!c || !c.endDate) continue;
      // Hợp đồng đang chờ duyệt/bị từ chối chưa chính thức có hiệu lực — không nhắc hạn (khớp
      // approvalStatus gán ở lib/createValidation.js). Phụ lục luôn APPROVED nên không bị loại ở đây.
      if (c.approvalStatus && c.approvalStatus !== 'APPROVED') continue;
      const diffDays = daysUntil(c.endDate);
      if (diffDays === null) continue;
      if (!Array.isArray(c.notifiedThresholds)) c.notifiedThresholds = [];

      // Cô lập lỗi theo TỪNG hợp đồng — trước đây 1 lỗi bất kỳ (VD lock timeout thoáng qua, bản ghi bị
      // xoá giữa lúc liệt kê và lúc ghi lại) ném ra khỏi toàn bộ khối try bên ngoài, làm dừng NGAY vòng
      // lặp — các hợp đồng còn lại (đứng sau trong mảng) bị bỏ sót nhắc hạn hoàn toàn ở lượt chạy này.
      try {

      let contractChanged = false;

      // Chỉ gửi ĐÚNG 1 email/lượt chạy, cho ngưỡng GẦN NHẤT (nhỏ nhất) trong số các ngưỡng vừa bị vượt
      // qua mà chưa từng nhắc — trước đây duyệt hết TẤT CẢ ngưỡng đã vượt qua chưa nhắc, nếu 1 hồ sơ
      // "nhảy cóc" qua nhiều ngưỡng cùng lúc (mới tạo với hạn ngắn, hoặc job gián đoạn dài ngày) sẽ gửi
      // liền nhiều email trong 1 lượt, và các ngưỡng XA hơn ("còn khoảng 30 ngày") vẫn còn hiệu lực nội
      // dung sai lệch dù thực tế hạn gần hơn nhiều. Đánh dấu đã nhắc TẤT CẢ ngưỡng đã vượt qua (không
      // chỉ ngưỡng gần nhất) để tránh lượt chạy kế tiếp lại "nhắc lùi" 1 ngưỡng xa đã lỗi thời.
      const newlyCrossedThresholds = thresholds.filter(t => diffDays <= t && !c.notifiedThresholds.includes(t));
      if (newlyCrossedThresholds.length) {
        const threshold = Math.min(...newlyCrossedThresholds);
        const creator = users.find(u => u.username === c.creator);
        const label = threshold === 0
          ? (diffDays < 0 ? `đã hết hạn ${Math.abs(diffDays)} ngày` : 'hết hạn hôm nay')
          : `còn khoảng ${threshold} ngày là hết hạn`;
        const subject = `[VPDT] Hợp đồng ${c.code} ${label}`;
        const body = `Hợp đồng "${c.title}" (${c.code}, đối tác: ${c.partner || 'N/A'}) ${label}. Ngày hết hạn: ${c.endDate}.`;

        const rawRecipients = [];
        if (creator && creator.email) rawRecipients.push({ email: creator.email, name: creator.name || c.creator });
        // Người phụ trách của ĐÚNG phòng ban hợp đồng này — bổ sung, không thay thế ccEmails (CC
        // chung nhận thông báo bất kỳ hợp đồng phòng nào, vd Ban Giám Đốc).
        const deptRecipients = Array.isArray(deptContacts[c.dept]) ? deptContacts[c.dept] : [];
        for (const dr of deptRecipients) {
          const email = String(dr?.email || '').trim();
          if (email) rawRecipients.push({ email, name: dr.name || email });
        }
        for (const cc of ccEmails) {
          const email = String(cc).trim();
          if (email) rawRecipients.push({ email, name: email });
        }
        // Loại trùng địa chỉ (không phân biệt hoa/thường) — người tạo hợp đồng có thể trùng với người
        // phụ trách phòng ban hoặc nằm sẵn trong CC chung, tránh gửi lặp 1 email nhiều lần.
        const seenEmails = new Set();
        const recipients = rawRecipients.filter(r => {
          const key = r.email.toLowerCase();
          if (seenEmails.has(key)) return false;
          seenEmails.add(key);
          return true;
        });

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
            console.error('⛔ [Nhắc hạn hợp đồng] Gửi email thật thất bại:', err.message);
            // Trước đây sendResult GIỮ NGUYÊN giá trị khởi tạo {sent:[], failed:[], simulated:true} khi
            // sendMail() throw (VD mất kết nối SMTP) — simulated:true khiến log/điều kiện bên dưới coi
            // như "chưa từng thử gửi thật" thay vì "đã thử và thất bại cho TẤT CẢ người nhận", sai lệch
            // cả nội dung log lẫn (nghiêm trọng hơn) điều kiện đánh dấu notifiedThresholds bên dưới.
            sendResult = { sent: [], failed: recipients.map(r => r.email), simulated: false };
          }
        }
        // Gửi thật (không phải mô phỏng) nhưng KHÔNG một ai trong danh sách nhận thành công — coi như
        // chưa nhắc được gì cả, để lần chạy job KẾ TIẾP thử lại nguyên ngưỡng này (không push vào
        // notifiedThresholds). Trước đây push vô điều kiện: 1 lần lỗi kết nối SMTP thoáng qua (hay cấu
        // hình sai tạm thời) khiến ngưỡng đó bị đánh dấu "đã nhắc" vĩnh viễn, không bao giờ thử gửi lại
        // được nữa dù chưa ai thực sự nhận được email nhắc hạn.
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
          module: 'CONTRACT',
          actionType: 'EXPIRY_REMINDER',
          targetObject: c.code,
          description: recipients.length
            ? `${totalSendFailure ? 'LỖI gửi nhắc hạn' : 'Đã gửi nhắc hạn'} hợp đồng [${c.code} - ${c.title}] (${label}) tới ${recipients.map(r => r.email).join(', ')}${statusSuffix}${totalSendFailure ? ' — sẽ tự thử lại ở lần kiểm tra kế tiếp' : ''}`
            : `Hợp đồng [${c.code} - ${c.title}] (${label}) chưa có người nhận hợp lệ (người tạo chưa có email, không có CC)`,
          status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
        });

        if (!totalSendFailure) {
          c.notifiedThresholds.push(...newlyCrossedThresholds);
          contractChanged = true;
        }
      }

      if (contractChanged) {
        await withLockedRecordById('contracts', c.id, (item) => {
          item.notifiedThresholds = c.notifiedThresholds;
          return item;
        });
      }
      } catch (err) {
        console.error(`⛔ [Nhắc hạn hợp đồng] Lỗi khi xử lý hợp đồng ${c.code || c.id}, bỏ qua và tiếp tục các hồ sơ còn lại:`, err.message);
      }
    }
  } catch (err) {
    console.error('⛔ [Nhắc hạn hợp đồng] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = { checkContractExpiryReminders };
