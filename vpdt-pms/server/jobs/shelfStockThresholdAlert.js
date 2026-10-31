// jobs/shelfStockThresholdAlert.js — "📊 Báo Cáo Ngưỡng Tồn" (Kiểm Soát Hàng Hóa, THIẾT KẾ LẠI LẦN 2,
// 11/2026, theo yêu cầu người dùng cụ thể):
//   "Khi mà gửi email ấy, nếu hàng tồn mà bị thấp hơn cái ngưỡng set ấy, thì nó phải bôi dòng đấy màu đỏ.
//   Còn gần đến ngưỡng set ấy, tầm khoảng còn 10% nữa về ngưỡng set ấy, thì bôi dòng đấy màu vàng. Cho ra
//   Excel gửi mail ấy... Tôi có thể gửi trong ngày, gửi theo tuần, gửi theo tháng đấy, việc của tôi...
//   chỉ áp dụng cho ngưỡng tồn thôi, còn cái kia [9 job nhắc hạn khác] là email báo tự động theo action
//   thì thôi."
//
// ĐỔI HẲN mô hình so với bản trước (MỖI ngưỡng vi phạm -> 1 email riêng, chạy mỗi 24h kể từ lúc server
// khởi động): nay là 1 BÁO CÁO TỔNG HỢP (digest), gửi theo lịch ADMIN TỰ CẤU HÌNH (Hàng ngày/Hàng tuần/
// Hàng tháng + giờ, xem DB.shelfThresholdDigestSchedule/#adminSubShelfDigest), liệt kê TOÀN BỘ ngưỡng
// (không chỉ ngưỡng vi phạm — demo file đã gửi người dùng xác nhận có cả dòng "an toàn"), tô màu đỏ/vàng
// theo classifyThresholdStatus() (lib/shelfThresholdDigestExcel.js — DÙNG CHUNG đúng 1 hàm với bảng web,
// xem module-vanhanh.js, KHÔNG được lệch logic giữa 2 nơi), đính kèm file .xlsx qua tham số "attachments"
// CÓ SẴN của sendMail() (lib/mailer.js, không cần sửa gì thêm — đã hỗ trợ cả SMTP/Graph/EWS).
//
// server.js GỌI HÀM NÀY MỖI GIỜ (KHÔNG còn mỗi 24h, và KHÔNG gọi ngay lúc khởi động như trước — xem
// chú thích chi tiết tại điểm đăng ký job ở server.js) — hàm tự kiểm tra bên trong "có đúng giờ cấu hình
// chưa, kỳ này đã gửi chưa" (shouldSendDigestNow()/periodKey, chống gửi trùng khi server restart nhiều
// lần ngay trong đúng giờ khớp lịch) rồi mới thực sự tính toán + gửi.
const { getPool, sql } = require('../db');
const { sendMail, resolveEncryption, resolveGraphOption, resolveEwsOption } = require('../lib/mailer');
const { buildNotificationEmailHtml } = require('../lib/emailTemplate');
const { decryptSecret } = require('../lib/emailCrypto');
const { insertSystemLog } = require('../lib/systemLogStore');
const { isUserOptedOutOfEmailModule } = require('../lib/notifyEmailModulesGate');
const { buildShelfThresholdDigestExcelBuffer, classifyThresholdStatus } = require('../lib/shelfThresholdDigestExcel');

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

async function setCollection(pool, key, value) {
  const request = pool.request();
  request.input('k', sql.NVarChar(100), key);
  request.input('v', sql.NVarChar(sql.MAX), JSON.stringify(value));
  await request.query(`
    MERGE dbo.AppData AS target
    USING (SELECT @k AS DataKey) AS src ON target.DataKey = src.DataKey
    WHEN MATCHED THEN UPDATE SET DataValue = @v, UpdatedAt = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (DataKey, DataValue, UpdatedAt) VALUES (@k, @v, SYSUTCDATETIME());
  `);
}

function isToday(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// Tổng quantity shelfRecords hôm nay khớp ĐÚNG dept + (maHang HOẶC maVach, khớp 1 trong 2 là đủ) — GIỮ
// NGUYÊN 100% logic đã có từ bản thiết kế lần 1 (chưa đổi gì ở đây).
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

// Tổng quantity shelfRecords hôm nay khớp ĐÚNG dept + category của quầy kệ (case-insensitive) — GIỮ
// NGUYÊN 100% logic đã có từ bản thiết kế lần 1.
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

// 4 tầng người nhận — GIỮ NGUYÊN 100% logic đã có từ bản thiết kế lần 1 (xem chú thích đầy đủ ở lịch sử
// git, lib/createValidation.js khối shelfStockThresholds). Trả về mảng {email, name} đã dedup + lọc
// opt-out + lọc email rỗng.
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

// buildDigestRowsForDept(): mỗi điều kiện ĐÃ ĐIỀN của 1 ngưỡng (maHang/maVach gộp 1 dòng SKU, category 1
// dòng riêng) -> 1 dòng digest — CÙNG đúng nguyên tắc multi-condition đã có ("nhập 1 là đủ, nhập nhiều
// thì check nhiều điều kiện", nguyên văn người dùng xác nhận ở thiết kế lần 1), NHƯNG khác bản alert tức
// thời cũ ở chỗ: liệt kê CẢ dòng an toàn (GREEN), không chỉ dòng vi phạm — vì đây là báo cáo tổng hợp
// định kỳ, không phải cảnh báo riêng từng sự kiện.
function buildDigestRowsForDept(dept, activeThresholds, shelfRecords, shelfLocationCategoryById) {
  const rows = [];
  for (const t of activeThresholds) {
    if (t.dept !== dept) continue;
    if (t.maHang || t.maVach) {
      const total = sumTodaySkuQuantity(t, shelfRecords);
      rows.push({
        dept, maHang: t.maHang || '', maVach: t.maVach || '', category: '',
        minQuantity: Number(t.minQuantity), total, status: classifyThresholdStatus(total, t.minQuantity)
      });
    }
    if (t.category) {
      const total = sumTodayCategoryQuantity(t, shelfRecords, shelfLocationCategoryById);
      rows.push({
        dept, maHang: '', maVach: '', category: t.category,
        minQuantity: Number(t.minQuantity), total, status: classifyThresholdStatus(total, t.minQuantity)
      });
    }
  }
  return rows;
}

// groupDigestRowsByRecipient(): gom theo NGƯỜI NHẬN THẬT (không theo ngưỡng/siêu thị) — 1 quản lý vùng
// phụ trách 2 siêu thị phải nhận ĐÚNG 1 email duy nhất liệt kê CẢ 2 siêu thị, không phải 2 email riêng.
// Cách làm: với MỖI siêu thị có ít nhất 1 ngưỡng active, tính lại 4 tầng người nhận theo TỪNG ngưỡng của
// siêu thị đó (tái dùng nguyên resolveThresholdRecipients() — nó đã tự lọc opt-out), rồi với MỖI người
// nhận match được, cộng dồn đúng siêu thị đó vào tập "phạm vi" (Set) của người đó. Cuối cùng, với MỖI
// người nhận, dựng danh sách dòng từ TOÀN BỘ siêu thị trong phạm vi của họ (không chỉ 1 ngưỡng lẻ).
function groupDigestRowsByRecipient(allThresholds, allUsers, shelfRecords, shelfLocationCategoryById) {
  const activeThresholds = (allThresholds || []).filter(t => t && t.active !== false);
  const deptsWithThresholds = [...new Set(activeThresholds.map(t => t.dept))];

  const recipientScope = new Map(); // email -> { name, depts: Set<string> }
  for (const dept of deptsWithThresholds) {
    const deptThresholds = activeThresholds.filter(t => t.dept === dept);
    for (const t of deptThresholds) {
      for (const r of resolveThresholdRecipients(t, allUsers)) {
        if (!recipientScope.has(r.email)) recipientScope.set(r.email, { name: r.name, depts: new Set() });
        recipientScope.get(r.email).depts.add(dept);
      }
    }
  }

  const groups = [];
  for (const [email, info] of recipientScope) {
    const rows = [];
    for (const dept of info.depts) {
      rows.push(...buildDigestRowsForDept(dept, activeThresholds, shelfRecords, shelfLocationCategoryById));
    }
    if (rows.length) groups.push({ email, name: info.name, rows });
  }
  return groups;
}

// getPeriodKey(): khoá định danh "kỳ hiện tại" dùng để chống gửi trùng (lưu vào
// DB.shelfThresholdDigestSchedule.lastSentPeriodKey SAU KHI gửi xong, so sánh LẠI trước khi gửi lần kế
// tiếp). WEEKLY/DAILY dùng thẳng ngày hiện tại (YYYY-MM-DD) làm khoá — vì WEEKLY chỉ khớp ĐÚNG 1 dayOfWeek
// cấu hình nên ngày đó đã định danh duy nhất đúng 1 tuần, không cần tính số tuần ISO phức tạp hơn.
function getPeriodKey(now, frequency) {
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
  if (frequency === 'MONTHLY') return `M-${y}-${m}`;
  if (frequency === 'WEEKLY') return `W-${y}-${m}-${d}`;
  return `D-${y}-${m}-${d}`; // DAILY (và mặc định an toàn nếu frequency lạ)
}

// shouldSendDigestNow(): so khớp "now" với lịch cấu hình — gọi mỗi giờ (xem server.js), chỉ TRẢ VỀ true
// ĐÚNG 1 giờ trong ngày (hoặc đúng 1 ngày/tuần, 1 ngày/tháng tuỳ frequency) mà `now.getHours()` khớp
// `schedule.hour`. KHÔNG tự xử lý chống gửi trùng ở đây (việc đó là periodKey, tách riêng) — hàm này CHỈ
// trả lời "có đúng thời điểm cấu hình không".
function shouldSendDigestNow(schedule, now) {
  const freq = schedule?.frequency || 'WEEKLY';
  const hour = Number.isInteger(schedule?.hour) ? schedule.hour : 7;
  if (now.getHours() !== hour) return false;
  if (freq === 'DAILY') return true;
  if (freq === 'WEEKLY') {
    const dayOfWeek = Number.isInteger(schedule?.dayOfWeek) ? schedule.dayOfWeek : 1;
    return now.getDay() === dayOfWeek;
  }
  if (freq === 'MONTHLY') {
    const dayOfMonth = Number.isInteger(schedule?.dayOfMonth) ? schedule.dayOfMonth : 1;
    return now.getDate() === dayOfMonth;
  }
  return false;
}

async function checkShelfStockThresholdAlerts() {
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('⛔ [Báo Cáo Ngưỡng Tồn Kiểm Soát Hàng Hóa] Không kết nối được SQL Server:', err.message);
    return;
  }

  try {
    const schedule = await getCollection(pool, 'shelfThresholdDigestSchedule', { frequency: 'WEEKLY', hour: 7, dayOfWeek: 1, dayOfMonth: 1, lastSentPeriodKey: null });
    const now = new Date();
    if (!shouldSendDigestNow(schedule, now)) return;
    const periodKey = getPeriodKey(now, schedule.frequency);
    if (schedule.lastSentPeriodKey === periodKey) return; // kỳ này đã gửi rồi (chống gửi trùng khi tick giờ chạy lại/server restart ngay trong giờ khớp lịch)

    const emailConfig = await getCollection(pool, 'emailConfig', {});
    if (!emailConfig || emailConfig.enabled === false) return;

    let smtpUser = null, smtpPass = null;
    if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
      try {
        smtpUser = emailConfig.smtpUser;
        smtpPass = decryptSecret(emailConfig.smtpPassEnc);
      } catch (err) {
        console.error('⛔ [Báo Cáo Ngưỡng Tồn Kiểm Soát Hàng Hóa] Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
      }
    }
    const smtpEncryption = resolveEncryption(emailConfig);

    const [thresholds, shelfRecords, shelfLocations, allUsers] = await Promise.all([
      getCollection(pool, 'shelfStockThresholds', []),
      getCollection(pool, 'shelfRecords', []),
      getCollection(pool, 'shelfLocations', []),
      getCollection(pool, 'users', [])
    ]);
    const shelfLocationCategoryById = new Map((shelfLocations || []).map(s => [s.id, s.category || '']));

    const digestGroups = groupDigestRowsByRecipient(thresholds || [], allUsers || [], shelfRecords || [], shelfLocationCategoryById);

    for (const group of digestGroups) {
      try {
        const redCount = group.rows.filter(r => r.status === 'RED').length;
        const yellowCount = group.rows.filter(r => r.status === 'YELLOW').length;
        const subject = `[VPDT] Báo cáo Ngưỡng Tồn — Kiểm Soát Hàng Hóa (${group.rows.length} dòng, ${redCount} dưới ngưỡng, ${yellowCount} gần ngưỡng)`;
        const plainBody = `Đính kèm báo cáo tổng hợp Ngưỡng Tồn — ${group.rows.length} dòng (${redCount} đang DƯỚI ngưỡng, ${yellowCount} còn chưa tới 10% nữa là chạm ngưỡng). Xem file Excel đính kèm để biết chi tiết từng dòng (tô màu đỏ/vàng theo đúng mức).`;
        const html = buildNotificationEmailHtml({ status: 'info', badge: '📊 Báo cáo Ngưỡng Tồn định kỳ — Kiểm Soát Hàng Hóa', bodyText: plainBody });
        const excelBuffer = await buildShelfThresholdDigestExcelBuffer(group.rows);

        let sendResult = { sent: [], failed: [], simulated: true };
        try {
          sendResult = await sendMail({
            to: [group.email],
            subject, text: plainBody, html,
            host: emailConfig.smtpHost, port: emailConfig.smtpPort, encryption: smtpEncryption,
            user: smtpUser, pass: smtpPass,
            from: emailConfig.senderEmail,
            graph: resolveGraphOption(emailConfig),
            ews: resolveEwsOption(emailConfig),
            attachments: [{
              filename: 'BaoCaoNguongTon.xlsx',
              content: Buffer.from(excelBuffer),
              contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }]
          });
        } catch (err) {
          console.error(`⛔ [Báo Cáo Ngưỡng Tồn Kiểm Soát Hàng Hóa] Gửi email thật thất bại (${group.email}):`, err.message);
          sendResult = { sent: [], failed: [group.email], simulated: false };
        }
        await insertSystemLog({
          username: 'system_scheduler', fullName: 'Hệ Thống (Tự Động)', ipAddress: 'SERVER (Scheduled Job)',
          module: 'SHELF_STOCK_THRESHOLD', actionType: 'DIGEST_SENT', targetObject: `${group.name} <${group.email}>`,
          description: `Gửi báo cáo tổng hợp Ngưỡng Tồn kỳ ${periodKey} — ${group.rows.length} dòng (${redCount} đỏ, ${yellowCount} vàng) tới ${group.email}`,
          status: sendResult.failed.length && !sendResult.simulated ? 'WARNING' : 'SUCCESS'
        });
      } catch (err) {
        console.error(`⛔ [Báo Cáo Ngưỡng Tồn Kiểm Soát Hàng Hóa] Lỗi khi gửi cho ${group.email}, bỏ qua và tiếp tục:`, err.message);
      }
    }

    await setCollection(pool, 'shelfThresholdDigestSchedule', { ...schedule, lastSentPeriodKey: periodKey });
  } catch (err) {
    console.error('⛔ [Báo Cáo Ngưỡng Tồn Kiểm Soát Hàng Hóa] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = {
  checkShelfStockThresholdAlerts,
  resolveThresholdRecipients, sumTodaySkuQuantity, sumTodayCategoryQuantity,
  shouldSendDigestNow, getPeriodKey, buildDigestRowsForDept, groupDigestRowsByRecipient
};
