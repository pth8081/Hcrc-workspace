// jobs/hrTaskOverdueReminder.js — Job định kỳ quét checklist Nhân Sự > Onboarding/Offboarding
// (hrProcesses.tasks[], xem lib/createValidation.js/lib/recordActions.js) tìm việc PENDING đã quá hạn
// (dueDate < hôm nay), tự chuyển status sang OVERDUE + gửi email cảnh báo — nhân bản khuôn
// jobs/itServiceRenewalReminder.js (đọc emailConfig chung, gửi email THẬT qua lib/mailer.js nếu đã cấu
// hình SMTP thật, cô lập lỗi theo từng bản ghi). Đúng mục 7/8 tài liệu thiết kế gốc: ưu tiên cao nhất là
// việc nhãn "ASSET_REVOKE" (thu hồi tài sản/khoá tài khoản Offboarding) quá hạn — rủi ro bảo mật nếu bỏ
// sót, nên MỌI task quá hạn (không riêng ASSET_REVOKE) đều được quét, không phân biệt stage.
//
// Khác itServiceRenewalReminder.js ở chỗ CHỈ chuyển trạng thái ĐÚNG 1 LẦN (PENDING -> OVERDUE) — không
// có khái niệm "nhiều ngưỡng nhắc lại" như hạn dịch vụ/hợp đồng (task chỉ có 2 trạng thái đang-mở liên
// quan: PENDING/OVERDUE, còn lại DONE/SKIPPED đã đóng hẳn) — task đã OVERDUE sẽ không bị quét lại ở lần
// chạy sau (idempotent tự nhiên qua điều kiện `status === 'PENDING'`).
const { getPool, sql } = require('../db');
const { sendMail, resolveEncryption, resolveGraphOption, resolveEwsOption, buildReminderEmailLink, buildReminderEmailUrl } = require('../lib/mailer');
const { buildNotificationEmailHtml } = require('../lib/emailTemplate');
const { decryptSecret } = require('../lib/emailCrypto');
const { getAllForCollection, withLockedRecordById } = require('../lib/recordStore');
const { insertSystemLog } = require('../lib/systemLogStore');
const { isUserOptedOutOfEmailModule } = require('../lib/notifyEmailModulesGate');

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

function isPastDue(dateStr) {
  const due = new Date(dateStr);
  if (isNaN(due.getTime())) return false;
  const now = new Date();
  const startOfDue = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return startOfDue.getTime() < startOfNow.getTime();
}

// Người nhận email cho 1 task quá hạn — đúng người được giao riêng (assignedToUsername) nếu có; nhãn
// MANAGER (chưa gán riêng) lùi về ĐÚNG 1 người — directManagerUsername (quản lý trực tiếp HR đã chỉ định
// SẴN lúc tạo quy trình) — đây KHÔNG phải broadcast theo phòng ban, mà là 1 người cụ thể gắn liền với
// CHÍNH quy trình này, giữ nguyên như trước.
// LỊCH SỬ: trước đây (tới v28.73), department HR/ADMIN/IT/FINANCE chưa gán riêng còn lùi về gửi cho CẢ
// PHÒNG BAN (mọi user có hrOnboardingManage/hrOffboardingManage/itManage/paymentManage) — đã từng vá 1
// lỗi liên quan (loại `admin` bypass khỏi nhánh đó, 11/2026) nhưng bản thân cơ chế "gửi cả phòng ban" vẫn
// giữ nguyên.
// ĐỔI (11/2026, theo yêu cầu người dùng tiếp theo): "nếu không gán ai thì không ai được nhận email" — bỏ
// HẲN nhánh gửi-cả-phòng-ban (HR/ADMIN/IT/FINANCE) phía dưới, task chưa gán riêng ở các nhãn này không
// còn gửi email cho bất kỳ ai nữa (trả về mảng rỗng), đi kèm với bước ép buộc PHẢI gán người mới tạo được
// quy trình MỚI (xem hrProcesses.extraValidate ở lib/createValidation.js + completeHrTask() ở
// lib/recordActions.js) — tinh thần: không còn "trách nhiệm chung chung theo phòng ban" nữa, phải có
// đúng 1 người chịu trách nhiệm. Áp dụng NGAY cho MỌI quy trình (kể cả quy trình cũ tạo trước khi có yêu
// cầu này) vì đây là hành vi GỬI EMAIL (không phải dữ liệu/workflow đã lưu) — không có khái niệm "hồi
// tố" ở đây, chỉ ảnh hưởng các lượt quét quá hạn CHẠY TỪ NAY trở đi.
function resolveTaskRecipients(users, item, task) {
  if (task.assignedToUsername) {
    const u = users.find(x => x.username === task.assignedToUsername && x.active !== false);
    return u && u.email && !isUserOptedOutOfEmailModule(u, 'HR_TASK_OVERDUE') ? [{ email: u.email, name: u.name || u.username }] : [];
  }
  if (task.department === 'MANAGER') {
    if (!item.directManagerUsername) return [];
    const u = users.find(x => x.username === item.directManagerUsername && x.active !== false);
    return u && u.email && !isUserOptedOutOfEmailModule(u, 'HR_TASK_OVERDUE') ? [{ email: u.email, name: u.name || u.username }] : [];
  }
  return [];
}

async function checkHrTaskOverdueReminders() {
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('⛔ [Nhắc việc quá hạn Onboarding/Offboarding] Không kết nối được SQL Server:', err.message);
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
        console.error('⛔ [Nhắc việc quá hạn Onboarding/Offboarding] Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
      }
    }
    const smtpEncryption = resolveEncryption(emailConfig);

    const processes = await getAllForCollection('hrProcesses');
    if (!Array.isArray(processes) || processes.length === 0) return;
    const users = await getCollection(pool, 'users', []);

    for (const item of processes) {
      if (!item || item.status !== 'IN_PROGRESS' || !Array.isArray(item.tasks)) continue;
      const overdueTasks = item.tasks.filter(t => t.status === 'PENDING' && isPastDue(t.dueDate));
      if (overdueTasks.length === 0) continue;

      try {
        const employeeLabel = item.processType === 'ONBOARDING'
          ? `${item.fullName} (${item.employeeCode})` : `${item.fullName} (${item.employeeUsername})`;
        for (const task of overdueTasks) {
          const recipients = resolveTaskRecipients(users, item, task);
          const subject = `[VPDT] Việc "${task.taskName}" (${employeeLabel}) đã quá hạn`;
          const plainBody = `Việc "${task.taskName}" trong quy trình ${item.processType === 'ONBOARDING' ? 'Onboarding' : 'Offboarding'} của ${employeeLabel} đã quá hạn (hạn: ${task.dueDate}). Vui lòng xử lý sớm để không ảnh hưởng tiến độ chung.`;
          const body = `${plainBody}${buildReminderEmailLink('hrLifecycle', String(item.id))}`;
          const html = buildNotificationEmailHtml({
            status: 'danger',
            badge: '🔴 Việc Onboarding/Offboarding đã quá hạn',
            bodyText: plainBody,
            ctaUrl: buildReminderEmailUrl('hrLifecycle', String(item.id))
          });

          for (const r of recipients) {
            console.log(`[DMS EMAIL SIMULATOR] To: ${r.name} <${r.email}> | Subject: ${subject}\n  ${body}`);
          }
          let sendResult = { sent: [], failed: [], simulated: true };
          if (recipients.length) {
            try {
              sendResult = await sendMail({
                to: recipients.map(r => r.email),
                subject, text: body, html,
                host: emailConfig.smtpHost, port: emailConfig.smtpPort, encryption: smtpEncryption,
                user: smtpUser, pass: smtpPass,
                from: emailConfig.senderEmail,
                graph: resolveGraphOption(emailConfig),
                ews: resolveEwsOption(emailConfig)
              });
            } catch (err) {
              console.error('⛔ [Nhắc việc quá hạn Onboarding/Offboarding] Gửi email thật thất bại:', err.message);
              sendResult = { sent: [], failed: recipients.map(r => r.email), simulated: false };
            }
          }
          await insertSystemLog({
            username: 'system_scheduler', fullName: 'Hệ Thống (Tự Động)', ipAddress: 'SERVER (Scheduled Job)',
            module: 'HR_LIFECYCLE', actionType: 'TASK_OVERDUE', targetObject: `${employeeLabel} — ${task.taskName}`,
            description: recipients.length
              ? `Việc "${task.taskName}" (${employeeLabel}) đã quá hạn — đã gửi cảnh báo tới ${recipients.map(r => r.email).join(', ')}`
              : `Việc "${task.taskName}" (${employeeLabel}) đã quá hạn — KHÔNG gửi email cảnh báo (chưa gán người phụ trách cụ thể, hoặc người phụ trách thiếu email/đã tắt nhận thông báo loại này)`,
            status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
          });
        }

        // Chuyển trạng thái NGAY SAU khi đã gửi xong toàn bộ email cho quy trình này — khoá lại record 1
        // lần duy nhất, tránh nhiều lượt khoá liên tiếp cho từng task như nếu khoá bên trong vòng lặp trên.
        await withLockedRecordById('hrProcesses', item.id, (record) => {
          for (const task of (record.tasks || [])) {
            if (task.status === 'PENDING' && overdueTasks.some(t => t.taskId === task.taskId)) {
              task.status = 'OVERDUE';
            }
          }
          return record;
        });
      } catch (err) {
        console.error(`⛔ [Nhắc việc quá hạn Onboarding/Offboarding] Lỗi khi xử lý quy trình ${item.id}, bỏ qua và tiếp tục:`, err.message);
      }
    }
  } catch (err) {
    console.error('⛔ [Nhắc việc quá hạn Onboarding/Offboarding] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = { checkHrTaskOverdueReminders };
