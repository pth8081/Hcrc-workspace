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
const { sendMail, resolveEncryption } = require('../lib/mailer');
const { decryptSecret } = require('../lib/emailCrypto');
const { getAllForCollection, withLockedRecordById } = require('../lib/recordStore');
const { insertSystemLog } = require('../lib/systemLogStore');

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

// Người nhận email cho 1 task quá hạn — đúng người được giao riêng (assignedToUsername) nếu có, không
// thì theo nhãn trách nhiệm (department), cùng logic canActOnHrTask() ở lib/recordActions.js nhưng chỉ
// cần DANH SÁCH người có quyền (không cần biết AI đang gọi).
function resolveTaskRecipients(users, item, task) {
  if (task.assignedToUsername) {
    const u = users.find(x => x.username === task.assignedToUsername && x.active !== false);
    return u && u.email ? [{ email: u.email, name: u.name || u.username }] : [];
  }
  let matchesPerm;
  if (task.department === 'HR' || task.department === 'ADMIN') {
    const manageFlag = item.processType === 'ONBOARDING' ? 'hrOnboardingManage' : 'hrOffboardingManage';
    matchesPerm = (u) => u.perms?.admin || u.perms?.[manageFlag];
  } else if (task.department === 'IT') {
    matchesPerm = (u) => u.perms?.admin || u.perms?.itManage;
  } else if (task.department === 'FINANCE') {
    matchesPerm = (u) => u.perms?.admin || u.perms?.paymentManage;
  } else if (task.department === 'MANAGER') {
    if (!item.directManagerUsername) return [];
    const u = users.find(x => x.username === item.directManagerUsername && x.active !== false);
    return u && u.email ? [{ email: u.email, name: u.name || u.username }] : [];
  } else {
    return [];
  }
  return users.filter(u => u && u.active !== false && u.email && matchesPerm(u)).map(u => ({ email: u.email, name: u.name || u.username }));
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
          const body = `Việc "${task.taskName}" trong quy trình ${item.processType === 'ONBOARDING' ? 'Onboarding' : 'Offboarding'} của ${employeeLabel} đã quá hạn (hạn: ${task.dueDate}). Vui lòng xử lý sớm để không ảnh hưởng tiến độ chung.`;

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
              console.error('⛔ [Nhắc việc quá hạn Onboarding/Offboarding] Gửi email thật thất bại:', err.message);
              sendResult = { sent: [], failed: recipients.map(r => r.email), simulated: false };
            }
          }
          await insertSystemLog({
            username: 'system_scheduler', fullName: 'Hệ Thống (Tự Động)', ipAddress: 'SERVER (Scheduled Job)',
            module: 'HR_LIFECYCLE', actionType: 'TASK_OVERDUE', targetObject: `${employeeLabel} — ${task.taskName}`,
            description: recipients.length
              ? `Việc "${task.taskName}" (${employeeLabel}) đã quá hạn — đã gửi cảnh báo tới ${recipients.map(r => r.email).join(', ')}`
              : `Việc "${task.taskName}" (${employeeLabel}) đã quá hạn — chưa có người nhận hợp lệ (chưa ai có quyền phù hợp kèm email)`,
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
