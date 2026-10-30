// jobs/shelfStockThresholdAlert.js — "🔔 Ngưỡng Tồn" (Kiểm Soát Hàng Hóa, bổ sung sau Phase 1 MVP,
// 11/2026). Job định kỳ quét shelfStockThresholds (active) đối chiếu với shelfRecords ĐÃ GHI NHẬN HÔM
// NAY (KHÔNG cần API tồn kho đối tác — khác hẳn "Đối Chiếu Tồn Kho" vẫn còn chờ mẫu response thật), tự
// gửi email cảnh báo nếu tổng số lượng dưới ngưỡng. Nhân bản khuôn jobs/hrTaskOverdueReminder.js (đọc
// emailConfig chung, gửi email THẬT qua lib/mailer.js nếu đã cấu hình SMTP thật, cô lập lỗi theo từng
// ngưỡng).
//
// QUYẾT ĐỊNH THIẾT KẾ (ghi rõ vì chưa có đặc tả chính thức — chờ người dùng góp ý thêm nếu cần đổi):
// "Tồn trên kệ hôm nay" của 1 ngưỡng = TỔNG `quantity` của mọi shelfRecords tạo HÔM NAY (theo giờ máy
// chủ), CÙNG dept với ngưỡng, khớp scope:
//   - scope SKU (nhãn hiển thị đổi thành "Mã Vạch", 11/2026, API đối tác bổ sung maVach ở bản 1.3 — GIỮ
//     NGUYÊN key `scope: 'SKU'` nội bộ, chỉ đổi field so khớp từ r.sku SANG r.maVach, không cần sửa dữ
//     liệu threshold đã lưu): r.maVach === threshold.scopeValue (so khớp CHÍNH XÁC, không phân biệt
//     hoa/thường bị bỏ vì mã vạch thường có ký tự số/gạch, giữ nguyên dạng người dùng nhập).
//   - scope CATEGORY: tra category của ĐÚNG quầy kệ (r.shelfLocationId -> shelfLocations.category, vì
//     shelfRecords không lưu trực tiếp category) rồi so case-insensitive với threshold.scopeValue.
// Đây là phép CỘNG DỒN nhiều lượt ghi nhận trong ngày (có thể nhiều quầy/nhiều SKU cùng ngành hàng) —
// coi là tín hiệu ước lượng "tổng hàng còn trên kệ hôm nay", KHÔNG phải số tồn kho hệ thống chính xác.
// Ngưỡng không có bản ghi nào hôm nay -> tổng = 0, LUÔN coi là "dưới ngưỡng" (cảnh báo) — hợp lý vì nhân
// viên có thể đã quên kiểm, cần được nhắc. Job chạy 1 lần/24h kể từ lúc server khởi động (CÙNG khuôn mọi
// job nhắc hạn khác trong hệ thống — KHÔNG ghim đúng giờ 07:00 như tài liệu nghiệp vụ gốc đề cập, vì
// không có cơ chế cron-giờ-cụ-thể nào đang dùng trong codebase này; nêu rõ nếu cần đổi sang đúng giờ).
const { getPool, sql } = require('../db');
const { sendMail, resolveEncryption, resolveGraphOption, resolveEwsOption } = require('../lib/mailer');
const { buildNotificationEmailHtml } = require('../lib/emailTemplate');
const { decryptSecret } = require('../lib/emailCrypto');
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

function isToday(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// Tổng quantity shelfRecords hôm nay khớp đúng dept + scope/scopeValue của 1 ngưỡng.
function sumTodayQuantityForThreshold(threshold, shelfRecords, shelfLocationCategoryById) {
  let sum = 0;
  for (const r of shelfRecords) {
    if (!r || r.dept !== threshold.dept || !isToday(r.createdAt)) continue;
    if (threshold.scope === 'SKU') {
      if (r.maVach === threshold.scopeValue) sum += Number(r.quantity) || 0;
    } else {
      const category = shelfLocationCategoryById.get(r.shelfLocationId) || '';
      if (category.toLowerCase() === String(threshold.scopeValue).toLowerCase()) sum += Number(r.quantity) || 0;
    }
  }
  return sum;
}

async function checkShelfStockThresholdAlerts() {
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('⛔ [Ngưỡng Tồn Kiểm Soát Hàng Hóa] Không kết nối được SQL Server:', err.message);
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
        console.error('⛔ [Ngưỡng Tồn Kiểm Soát Hàng Hóa] Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
      }
    }
    const smtpEncryption = resolveEncryption(emailConfig);

    const thresholds = await getCollection(pool, 'shelfStockThresholds', []);
    const activeThresholds = (thresholds || []).filter(t => t && t.active !== false);
    if (!activeThresholds.length) return;

    const shelfRecords = await getCollection(pool, 'shelfRecords', []);
    const shelfLocations = await getCollection(pool, 'shelfLocations', []);
    const shelfLocationCategoryById = new Map((shelfLocations || []).map(s => [s.id, s.category || '']));

    for (const threshold of activeThresholds) {
      try {
        const total = sumTodayQuantityForThreshold(threshold, shelfRecords || [], shelfLocationCategoryById);
        if (total >= Number(threshold.minQuantity)) continue; // đủ ngưỡng, không cảnh báo

        const scopeLabel = threshold.scope === 'SKU' ? `SKU "${threshold.scopeValue}"` : `ngành hàng "${threshold.scopeValue}"`;
        const subject = `[VPDT] Cảnh báo ngưỡng tồn: ${scopeLabel} (${threshold.dept})`;
        const plainBody = `Tổng số lượng trên kệ hôm nay của ${scopeLabel} tại "${threshold.dept}" là ${total}, dưới ngưỡng tối thiểu ${threshold.minQuantity} đã cấu hình trong "Kiểm Soát Hàng Hóa".`;
        const html = buildNotificationEmailHtml({
          status: 'warning',
          badge: '🔔 Cảnh báo ngưỡng tồn — Kiểm Soát Hàng Hóa',
          bodyText: plainBody
        });

        const recipients = (threshold.recipientEmails || []).filter(Boolean);
        console.log(`[DMS EMAIL SIMULATOR] To: ${recipients.join(', ')} | Subject: ${subject}\n  ${plainBody}`);
        let sendResult = { sent: [], failed: [], simulated: true };
        if (recipients.length) {
          try {
            sendResult = await sendMail({
              to: recipients,
              subject, text: plainBody, html,
              host: emailConfig.smtpHost, port: emailConfig.smtpPort, encryption: smtpEncryption,
              user: smtpUser, pass: smtpPass,
              from: emailConfig.senderEmail,
              graph: resolveGraphOption(emailConfig),
              ews: resolveEwsOption(emailConfig)
            });
          } catch (err) {
            console.error('⛔ [Ngưỡng Tồn Kiểm Soát Hàng Hóa] Gửi email thật thất bại:', err.message);
            sendResult = { sent: [], failed: recipients, simulated: false };
          }
        }
        await insertSystemLog({
          username: 'system_scheduler', fullName: 'Hệ Thống (Tự Động)', ipAddress: 'SERVER (Scheduled Job)',
          module: 'SHELF_STOCK_THRESHOLD', actionType: 'ALERT', targetObject: `${threshold.dept} — ${scopeLabel}`,
          description: recipients.length
            ? `Tồn hôm nay (${total}) dưới ngưỡng (${threshold.minQuantity}) cho ${scopeLabel} tại "${threshold.dept}" — đã gửi cảnh báo tới ${recipients.join(', ')}`
            : `Tồn hôm nay (${total}) dưới ngưỡng (${threshold.minQuantity}) cho ${scopeLabel} tại "${threshold.dept}" — chưa có email người nhận hợp lệ`,
          status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
        });
      } catch (err) {
        console.error(`⛔ [Ngưỡng Tồn Kiểm Soát Hàng Hóa] Lỗi khi xử lý ngưỡng id=${threshold.id}, bỏ qua và tiếp tục:`, err.message);
      }
    }
  } catch (err) {
    console.error('⛔ [Ngưỡng Tồn Kiểm Soát Hàng Hóa] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = { checkShelfStockThresholdAlerts };
