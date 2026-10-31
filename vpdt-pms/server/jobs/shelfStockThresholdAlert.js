// jobs/shelfStockThresholdAlert.js — "🔔 Ngưỡng Tồn" (Kiểm Soát Hàng Hóa, bổ sung sau Phase 1 MVP,
// 11/2026; THIẾT KẾ LẠI 11/2026 theo loạt câu hỏi người dùng — xem khối shelfStockThresholds ở
// lib/createValidation.js cho đầy đủ bối cảnh thiết kế). Job định kỳ quét shelfStockThresholds (active)
// đối chiếu với shelfRecords ĐÃ GHI NHẬN HÔM NAY (KHÔNG cần API tồn kho đối tác — khác hẳn "Đối Chiếu
// Tồn Kho"), tự gửi email cảnh báo nếu tổng số lượng dưới ngưỡng.
//
// QUYẾT ĐỊNH THIẾT KẾ (xác nhận với người dùng):
// 1. "Nhập 1 là đủ, nhập nhiều thì check nhiều điều kiện" (nguyên văn) — 1 ngưỡng có 3 trường nhận diện
//    ĐỘC LẬP, đều tuỳ chọn: maHang/maVach (mức SKU, so khớp theo ĐÚNG field đã dùng ở shelfRecords —
//    khớp theo 1 TRONG 2 mã là đủ, dung nạp trường hợp người ghi nhận chỉ có 1 trong 2) và category
//    (mức Ngành Hàng, tra qua shelfLocationId -> shelfLocations.category vì shelfRecords không lưu
//    category trực tiếp). Mỗi điều kiện ĐƯỢC ĐIỀN sẽ tự tính tổng + so ngưỡng RIÊNG — 1 ngưỡng có thể
//    bắn ra 2 cảnh báo ĐỘC LẬP/lượt chạy (1 cho SKU, 1 cho ngành hàng) nếu điền cả 2 và CẢ 2 đều dưới
//    ngưỡng — KHÔNG phải "đủ 1 điều kiện là đủ, không cần xét điều kiện còn lại".
// 2. Người nhận: BỎ HẲN recipientEmails free-text cũ — nay gồm 4 tầng, 3 tầng đầu tính ĐỘNG lúc gửi
//    (không snapshot, không lưu gì ở bản ghi threshold — giống approver "Theo vị trí" của workflowEngine
//    luôn tính lại thời điểm cần dùng):
//      Tầng 1: user ACTIVE có perms.shelfLocationManage===true VÀ dept === đúng siêu thị ngưỡng này
//              (Cửa hàng trưởng/Tổ trưởng quản lý Quầy Kệ/Ngưỡng Tồn của ĐÚNG siêu thị đó).
//      Tầng 2: user ACTIVE có perms.shelfReportView?.depts chứa đúng siêu thị này (Quản lý vùng được
//              gán xem báo cáo đúng vùng phụ trách).
//      Tầng 3: user ACTIVE có perms.shelfReportView?.all===true (nhận toàn hệ thống, mọi siêu thị).
//      Tầng 4: threshold.extraRecipientUsernames[] (cửa hàng trưởng tự chọn THÊM, đã validate ở
//              lib/createValidation.js CHỈ được chọn nhân viên thật, active, ĐÚNG siêu thị mình).
//    Dedup theo username, rồi LOẠI user nào đã tự tắt "📧 Nhận Email Cảnh Báo Ngưỡng Tồn" ở Hồ Sơ Cá
//    Nhân (notifyEmailModules.SHELF_THRESHOLD === false — xem lib/notifyEmailModulesGate.js, mirror
//    ĐÚNG cơ chế personal opt-out đã dùng cho luồng phê duyệt, nay mở rộng sang job cron này).
// Job chạy 1 lần/24h kể từ lúc server khởi động (CÙNG khuôn mọi job nhắc hạn khác trong hệ thống —
// KHÔNG ghim đúng giờ 07:00 như tài liệu nghiệp vụ gốc đề cập, chưa có cơ chế cron-giờ-cụ-thể nào đang
// dùng trong codebase này; nêu rõ nếu cần đổi sang đúng giờ).
const { getPool, sql } = require('../db');
const { sendMail, resolveEncryption, resolveGraphOption, resolveEwsOption } = require('../lib/mailer');
const { buildNotificationEmailHtml } = require('../lib/emailTemplate');
const { decryptSecret } = require('../lib/emailCrypto');
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

function isToday(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// Tổng quantity shelfRecords hôm nay khớp ĐÚNG dept + (maHang HOẶC maVach, khớp 1 trong 2 là đủ).
function sumTodaySkuQuantity(threshold, shelfRecords) {
  let sum = 0;
  for (const r of shelfRecords) {
    if (!r || r.dept !== threshold.dept || !isToday(r.createdAt)) continue;
    const matchesMaHang = threshold.maHang && r.maHang === threshold.maHang;
    const matchesMaVach = threshold.maVach && r.maVach === threshold.maVach;
    if (matchesMaHang || matchesMaVach) sum += Number(r.quantity) || 0;
  }
  return sum;
}

// Tổng quantity shelfRecords hôm nay khớp ĐÚNG dept + category của quầy kệ (case-insensitive).
function sumTodayCategoryQuantity(threshold, shelfRecords, shelfLocationCategoryById) {
  let sum = 0;
  const wanted = String(threshold.category || '').trim().toLowerCase();
  for (const r of shelfRecords) {
    if (!r || r.dept !== threshold.dept || !isToday(r.createdAt)) continue;
    const category = (shelfLocationCategoryById.get(r.shelfLocationId) || '').toLowerCase();
    if (category === wanted) sum += Number(r.quantity) || 0;
  }
  return sum;
}

// 4 tầng người nhận — xem chú thích đầu file. Trả về mảng {email, name} đã dedup + lọc opt-out +
// lọc email rỗng.
function resolveThresholdRecipients(threshold, allUsers) {
  const users = Array.isArray(allUsers) ? allUsers : [];
  const matched = new Map(); // username -> user, dedup
  for (const u of users) {
    if (!u || !u.username || u.active === false) continue;
    const isTier1 = !!u.perms?.shelfLocationManage && u.dept === threshold.dept;
    const isTier2 = Array.isArray(u.perms?.shelfReportView?.depts) && u.perms.shelfReportView.depts.includes(threshold.dept);
    const isTier3 = !!u.perms?.shelfReportView?.all;
    const isTier4 = Array.isArray(threshold.extraRecipientUsernames) && threshold.extraRecipientUsernames.includes(u.username);
    if (isTier1 || isTier2 || isTier3 || isTier4) matched.set(u.username, u);
  }
  const recipients = [];
  const seenEmails = new Set();
  for (const u of matched.values()) {
    if (!u.email) continue;
    if (isUserOptedOutOfEmailModule(u, 'SHELF_THRESHOLD')) continue;
    const key = u.email.toLowerCase();
    if (seenEmails.has(key)) continue;
    seenEmails.add(key);
    recipients.push({ email: u.email, name: u.name || u.username });
  }
  return recipients;
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
    const allUsers = await getCollection(pool, 'users', []);
    const shelfLocationCategoryById = new Map((shelfLocations || []).map(s => [s.id, s.category || '']));

    for (const threshold of activeThresholds) {
      try {
        // Mỗi điều kiện ĐƯỢC ĐIỀN tự đánh giá riêng — có thể bắn ra 0/1/2 cảnh báo cho CÙNG 1 ngưỡng.
        const conditions = [];
        if (threshold.maHang || threshold.maVach) {
          const total = sumTodaySkuQuantity(threshold, shelfRecords || []);
          if (total < Number(threshold.minQuantity)) {
            const skuLabel = [threshold.maHang ? `Mã Hàng "${threshold.maHang}"` : null, threshold.maVach ? `Mã Vạch "${threshold.maVach}"` : null].filter(Boolean).join(' / ');
            conditions.push({ level: 'SKU', label: skuLabel, total });
          }
        }
        if (threshold.category) {
          const total = sumTodayCategoryQuantity(threshold, shelfRecords || [], shelfLocationCategoryById);
          if (total < Number(threshold.minQuantity)) {
            conditions.push({ level: 'CATEGORY', label: `Ngành Hàng "${threshold.category}"`, total });
          }
        }
        if (!conditions.length) continue; // đủ ngưỡng ở MỌI điều kiện đã điền, không cảnh báo

        const recipients = resolveThresholdRecipients(threshold, allUsers);

        for (const cond of conditions) {
          const subject = `[VPDT] Cảnh báo ngưỡng tồn: ${cond.label} (${threshold.dept})`;
          const plainBody = `Tổng số lượng trên kệ hôm nay của ${cond.label} tại "${threshold.dept}" là ${cond.total}, dưới ngưỡng tối thiểu ${threshold.minQuantity} đã cấu hình trong "Kiểm Soát Hàng Hóa".`;
          const html = buildNotificationEmailHtml({
            status: 'warning',
            badge: '🔔 Cảnh báo ngưỡng tồn — Kiểm Soát Hàng Hóa',
            bodyText: plainBody
          });

          console.log(`[DMS EMAIL SIMULATOR] To: ${recipients.map(r => r.email).join(', ')} | Subject: ${subject}\n  ${plainBody}`);
          let sendResult = { sent: [], failed: [], simulated: true };
          if (recipients.length) {
            try {
              sendResult = await sendMail({
                to: recipients.map(r => r.email),
                subject, text: plainBody, html,
                host: emailConfig.smtpHost, port: emailConfig.smtpPort, encryption: smtpEncryption,
                user: smtpUser, pass: smtpPass,
                from: emailConfig.senderEmail,
                graph: resolveGraphOption(emailConfig),
                ews: resolveEwsOption(emailConfig)
              });
            } catch (err) {
              console.error('⛔ [Ngưỡng Tồn Kiểm Soát Hàng Hóa] Gửi email thật thất bại:', err.message);
              sendResult = { sent: [], failed: recipients.map(r => r.email), simulated: false };
            }
          }
          await insertSystemLog({
            username: 'system_scheduler', fullName: 'Hệ Thống (Tự Động)', ipAddress: 'SERVER (Scheduled Job)',
            module: 'SHELF_STOCK_THRESHOLD', actionType: 'ALERT', targetObject: `${threshold.dept} — ${cond.label}`,
            description: recipients.length
              ? `Tồn hôm nay (${cond.total}) dưới ngưỡng (${threshold.minQuantity}) cho ${cond.label} tại "${threshold.dept}" — đã gửi cảnh báo tới ${recipients.map(r => r.email).join(', ')}`
              : `Tồn hôm nay (${cond.total}) dưới ngưỡng (${threshold.minQuantity}) cho ${cond.label} tại "${threshold.dept}" — chưa có email người nhận hợp lệ (có thể do tất cả đã tự tắt nhận email, hoặc chưa ai thuộc 4 tầng người nhận)`,
            status: recipients.length ? (sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS') : 'WARNING'
          });
        }
      } catch (err) {
        console.error(`⛔ [Ngưỡng Tồn Kiểm Soát Hàng Hóa] Lỗi khi xử lý ngưỡng id=${threshold.id}, bỏ qua và tiếp tục:`, err.message);
      }
    }
  } catch (err) {
    console.error('⛔ [Ngưỡng Tồn Kiểm Soát Hàng Hóa] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = { checkShelfStockThresholdAlerts, resolveThresholdRecipients, sumTodaySkuQuantity, sumTodayCategoryQuantity };
