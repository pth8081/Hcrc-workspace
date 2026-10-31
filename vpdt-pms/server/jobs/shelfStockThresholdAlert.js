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
const { buildShelfThresholdDigestExcelBuffer, classifyThresholdStatus, DATA_SCOPE_DISCLAIMER } = require('../lib/shelfThresholdDigestExcel');

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

// buildDigestRowsForThreshold()/buildDigestRowsForDept(): mỗi điều kiện ĐÃ ĐIỀN của 1 ngưỡng (maHang/
// maVach gộp 1 dòng SKU, category 1 dòng riêng) -> 1 dòng digest — CÙNG đúng nguyên tắc multi-condition
// đã có ("nhập 1 là đủ, nhập nhiều thì check nhiều điều kiện", nguyên văn người dùng xác nhận ở thiết kế
// lần 1), NHƯNG khác bản alert tức thời cũ ở chỗ: liệt kê CẢ dòng an toàn (GREEN), không chỉ dòng vi
// phạm — vì đây là báo cáo tổng hợp định kỳ, không phải cảnh báo riêng từng sự kiện. Tách riêng hàm theo
// ĐÚNG 1 ngưỡng (buildDigestRowsForThreshold) để groupDigestRowsByRecipient() tái dùng được cho cả phạm
// vi "cả siêu thị" (Tầng 1-3) lẫn "đúng 1 ngưỡng lẻ" (Tầng 4-only, xem chú thích bên dưới).
function buildDigestRowsForThreshold(t, shelfRecords, shelfLocationCategoryById) {
  const rows = [];
  if (t.maHang || t.maVach) {
    const total = sumTodaySkuQuantity(t, shelfRecords);
    rows.push({
      dept: t.dept, maHang: t.maHang || '', maVach: t.maVach || '', category: '',
      minQuantity: Number(t.minQuantity), total, status: classifyThresholdStatus(total, t.minQuantity)
    });
  }
  if (t.category) {
    const total = sumTodayCategoryQuantity(t, shelfRecords, shelfLocationCategoryById);
    rows.push({
      dept: t.dept, maHang: '', maVach: '', category: t.category,
      minQuantity: Number(t.minQuantity), total, status: classifyThresholdStatus(total, t.minQuantity)
    });
  }
  return rows;
}
function buildDigestRowsForDept(dept, activeThresholds, shelfRecords, shelfLocationCategoryById) {
  const rows = [];
  for (const t of activeThresholds) {
    if (t.dept !== dept) continue;
    rows.push(...buildDigestRowsForThreshold(t, shelfRecords, shelfLocationCategoryById));
  }
  return rows;
}

// groupDigestRowsByRecipient(): gom theo NGƯỜI NHẬN THẬT (không theo ngưỡng/siêu thị) — 1 quản lý vùng
// phụ trách 2 siêu thị phải nhận ĐÚNG 1 email duy nhất liệt kê CẢ 2 siêu thị, không phải 2 email riêng.
//
// VÁ LẦN 3 (rà soát chéo độc lập phát hiện lỗ hổng phạm vi thật): bản trước gọi resolveThresholdRecipients()
// theo TỪNG ngưỡng rồi gộp CẢ 4 tầng vào chung 1 "phạm vi siêu thị" — khiến người CHỈ thuộc Tầng 4 (cửa
// hàng trưởng tự thêm họ vào ĐÚNG 1 ngưỡng cụ thể) bị mở rộng nhìn thấy TOÀN BỘ ngưỡng của siêu thị đó,
// sai thiết kế gốc ("Tầng 4 = tự thêm thêm cho ĐÚNG ngưỡng đó", không phải cả siêu thị). Tầng 1 (shelfLocationManage
// + đúng dept), Tầng 2 (shelfReportView.depts), Tầng 3 (shelfReportView.all) ĐÚNG là phạm vi cả siêu thị/
// hệ thống theo thiết kế, GIỮ NGUYÊN. Cách làm mới: tách riêng "phạm vi cả siêu thị" (deptScope, từ Tầng
// 1-3) và "phạm vi đúng 1 ngưỡng" (thresholdIdScope, từ Tầng 4-only) cho MỖI người nhận — nếu người đó
// CŨNG thuộc Tầng 1-3 của ĐÚNG siêu thị chứa ngưỡng Tầng 4 đó thì khỏi lặp dòng (đã có đủ qua deptScope).
//
// Dedup người nhận theo email CHỮ THƯỜNG (Thấp, rà soát chéo phát hiện) — 2 tài khoản cùng email khác hoa/
// thường (VD A@x.com và a@x.com) phải gom thành 1 người nhận, không gửi trùng 2 lần.
function groupDigestRowsByRecipient(allThresholds, allUsers, shelfRecords, shelfLocationCategoryById) {
  const activeThresholds = (allThresholds || []).filter(t => t && t.active !== false);
  const deptsWithThresholds = [...new Set(activeThresholds.map(t => t.dept))];
  const users = Array.isArray(allUsers) ? allUsers : [];

  // emailLower -> { name, email(gốc, dùng để gửi), deptScope: Set<dept>, thresholdIdScope: Set<id> }
  const recipientInfo = new Map();
  const ensureRecipient = (u) => {
    const key = u.email.toLowerCase();
    if (!recipientInfo.has(key)) {
      recipientInfo.set(key, { name: u.name || u.username, email: u.email, deptScope: new Set(), thresholdIdScope: new Set() });
    }
    return recipientInfo.get(key);
  };

  for (const dept of deptsWithThresholds) {
    const deptThresholds = activeThresholds.filter(t => t.dept === dept);
    for (const u of users) {
      if (!u || !u.username || u.active === false || !u.email) continue;
      if (isUserOptedOutOfEmailModule(u, 'SHELF_THRESHOLD')) continue;
      const isTier1 = !!u.perms?.shelfLocationManage && u.dept === dept;
      const isTier2 = Array.isArray(u.perms?.shelfReportView?.depts) && u.perms.shelfReportView.depts.includes(dept);
      const isTier3 = !!u.perms?.shelfReportView?.all;
      if (isTier1 || isTier2 || isTier3) {
        ensureRecipient(u).deptScope.add(dept);
        continue; // đã có cả siêu thị rồi, khỏi cần xét Tầng 4 riêng từng ngưỡng của CHÍNH siêu thị này nữa
      }
      for (const t of deptThresholds) {
        const isTier4 = Array.isArray(t.extraRecipientUsernames) && t.extraRecipientUsernames.includes(u.username);
        if (isTier4) ensureRecipient(u).thresholdIdScope.add(t.id);
      }
    }
  }

  const groups = [];
  for (const info of recipientInfo.values()) {
    const rows = [];
    for (const dept of info.deptScope) {
      rows.push(...buildDigestRowsForDept(dept, activeThresholds, shelfRecords, shelfLocationCategoryById));
    }
    for (const tid of info.thresholdIdScope) {
      const t = activeThresholds.find(x => x.id === tid);
      if (!t) continue; // ngưỡng đã bị xoá/ngừng dùng giữa lúc tính, bỏ qua an toàn
      rows.push(...buildDigestRowsForThreshold(t, shelfRecords, shelfLocationCategoryById));
    }
    if (rows.length) groups.push({ email: info.email, name: info.name, rows });
  }
  return groups;
}

// startOfWeekMonday(): lùi "d" về đúng Thứ 2 (00:00) của tuần chứa nó — quy ước tuần bắt đầu Thứ 2, khớp
// đúng cách nhãn UI hiển thị "Thứ 2 → Chủ Nhật" (xem systemSection.html #adminSubShelfDigest). Dùng để
// định danh "kỳ tuần hiện tại" theo tuần, không theo ngày lẻ (xem getPeriodKey() bên dưới).
function startOfWeekMonday(d) {
  const diffToMonday = (d.getDay() + 6) % 7; // Date.getDay(): 0=CN..6=T7 -> Thứ 2=0,...,Chủ Nhật=6
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - diffToMonday);
}
function formatYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// getPeriodKey(): khoá định danh "kỳ hiện tại" dùng để chống gửi trùng (lưu vào
// DB.shelfThresholdDigestSchedule.lastSentPeriodKey SAU KHI gửi xong, so sánh LẠI trước khi gửi lần kế
// tiếp). MONTHLY/DAILY giữ nguyên (tháng/ngày hiện tại là đủ định danh 1 kỳ). WEEKLY ĐỔI SANG khoá theo
// Thứ 2 đầu tuần (VÁ LẦN 3 — trước đây khoá theo NGÀY GỬI THẬT, nếu job "bắt kịp" gửi trễ qua ngày khác
// trong tuần — VD lẽ ra Thứ 2 nhưng mãi Thứ 4 mới gửi được do server down — thì khoá Thứ 4 không trùng
// khoá Thứ 2 bình thường, có thể gửi lại lần nữa nếu tick chạy đúng Thứ 2 tiếp theo tính lầm là "tuần
// khác"; khoá theo Thứ 2 đầu tuần đảm bảo CẢ TUẦN chỉ có ĐÚNG 1 khoá duy nhất bất kể gửi đúng ngày hay
// gửi bắt kịp trễ ngày nào trong tuần đó).
function getPeriodKey(now, frequency) {
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
  if (frequency === 'MONTHLY') return `M-${y}-${m}`;
  if (frequency === 'WEEKLY') return `W-${formatYmd(startOfWeekMonday(now))}`;
  return `D-${y}-${m}-${d}`; // DAILY (và mặc định an toàn nếu frequency lạ)
}

// shouldSendDigestNow(): so khớp "now" với lịch cấu hình — gọi mỗi giờ + 1 lần ngay lúc khởi động (xem
// server.js). VÁ LẦN 3 (rà soát chéo độc lập phát hiện lỗi Cao): bản trước đòi KHỚP CHÍNH XÁC giờ/ngày
// (===) — nếu tick bị trễ (VD server restart đúng lúc gần giờ cấu hình, dời tick kế tiếp qua khỏi đúng
// giờ đó) thì giờ/ngày đó KHÔNG BAO GIỜ được kiểm lại, cả kỳ WEEKLY/MONTHLY đó mất hẳn, không ai gửi. Nay
// đổi logic: "ĐÃ QUA thời điểm cấu hình của kỳ hiện tại CHƯA" (>=, không còn ===) — tự "bắt kịp" (self-
// healing): dù tick chạy trễ bao lâu trong CÙNG kỳ (DAILY: trong ngày; WEEKLY: từ đúng thứ cấu hình tới
// hết Chủ Nhật cùng tuần; MONTHLY: từ đúng ngày cấu hình tới hết tháng), vẫn nhận ra "đã tới lúc gửi" và
// gửi ngay ở lần kiểm kế tiếp. KHÔNG gửi trùng vì periodKey (so khớp NGOÀI hàm này, ở checkShelfStockThresholdAlerts())
// chỉ cho gửi ĐÚNG 1 lần/kỳ bất kể shouldSendDigestNow() trả về true bao nhiêu lần liên tiếp trong cùng kỳ.
function shouldSendDigestNow(schedule, now) {
  const freq = schedule?.frequency || 'WEEKLY';
  const hour = Number.isInteger(schedule?.hour) ? schedule.hour : 20;
  if (now.getHours() < hour) return false; // chưa tới giờ cấu hình hôm nay
  if (freq === 'DAILY') return true;
  if (freq === 'WEEKLY') {
    const dayOfWeek = Number.isInteger(schedule?.dayOfWeek) ? schedule.dayOfWeek : 1;
    const toMondayIdx = (jsDay) => (jsDay + 6) % 7; // Date.getDay() (0=CN..6=T7) -> Thứ 2=0,...,Chủ Nhật=6
    return toMondayIdx(now.getDay()) >= toMondayIdx(dayOfWeek); // đã qua/đúng thứ cấu hình trong TUẦN NÀY
  }
  if (freq === 'MONTHLY') {
    const dayOfMonth = Number.isInteger(schedule?.dayOfMonth) ? schedule.dayOfMonth : 1;
    return now.getDate() >= dayOfMonth; // đã qua/đúng ngày cấu hình trong THÁNG NÀY
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
    const schedule = await getCollection(pool, 'shelfThresholdDigestSchedule', { frequency: 'WEEKLY', hour: 20, dayOfWeek: 1, dayOfMonth: 1, lastSentPeriodKey: null });
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

    // handledOk: TRUE nếu có ÍT NHẤT 1 người nhận được gửi thành công HOẶC được mô phỏng (simulated:true —
    // nghĩa là email CHƯA cấu hình SMTP thật, không phải lỗi, không cần gửi lại) — VÁ LẦN 3 (rà soát chéo
    // phát hiện lỗi TB): bản trước LUÔN đánh dấu "đã gửi kỳ này" (lastSentPeriodKey) dù TẤT CẢ lần gửi
    // thật đều thất bại thật sự (VD SMTP server lỗi) — khiến kỳ đó KHÔNG BAO GIỜ được gửi lại, periodKey
    // đã "dùng hết" dù chưa ai nhận được báo cáo thật. Nay CHỈ đánh dấu khi có ít nhất 1 người được xử lý
    // ổn thoả (thành công thật HOẶC mô phỏng hợp lệ) — nếu TẤT CẢ đều lỗi thật, KHÔNG đánh dấu, để tick
    // giờ kế tiếp tự thử lại đúng kỳ này (periodKey chưa đổi, vẫn trong kỳ).
    let handledOk = digestGroups.length === 0; // không có ai cần gửi -> coi như "đã xử lý xong" kỳ này

    for (const group of digestGroups) {
      try {
        const redCount = group.rows.filter(r => r.status === 'RED').length;
        const yellowCount = group.rows.filter(r => r.status === 'YELLOW').length;
        const subject = `[VPDT] Báo cáo Ngưỡng Tồn — Kiểm Soát Hàng Hóa (${group.rows.length} dòng, ${redCount} dưới ngưỡng, ${yellowCount} gần ngưỡng)`;
        const plainBody = `Đính kèm báo cáo tổng hợp Ngưỡng Tồn — ${group.rows.length} dòng (${redCount} đang DƯỚI ngưỡng, ${yellowCount} còn chưa tới 10% nữa là chạm ngưỡng). Xem file Excel đính kèm để biết chi tiết từng dòng (tô màu đỏ/vàng theo đúng mức). ${DATA_SCOPE_DISCLAIMER}`;
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
        const isRealHardFailure = sendResult.simulated === false && sendResult.sent.length === 0 && sendResult.failed.length > 0;
        if (!isRealHardFailure) handledOk = true;
        await insertSystemLog({
          username: 'system_scheduler', fullName: 'Hệ Thống (Tự Động)', ipAddress: 'SERVER (Scheduled Job)',
          module: 'SHELF_STOCK_THRESHOLD', actionType: 'DIGEST_SENT', targetObject: `${group.name} <${group.email}>`,
          description: `Gửi báo cáo tổng hợp Ngưỡng Tồn kỳ ${periodKey} — ${group.rows.length} dòng (${redCount} đỏ, ${yellowCount} vàng) tới ${group.email}${isRealHardFailure ? ' — THẤT BẠI THẬT, sẽ tự thử lại ở lần kiểm kế tiếp' : ''}`,
          status: isRealHardFailure ? 'WARNING' : 'SUCCESS'
        });
      } catch (err) {
        console.error(`⛔ [Báo Cáo Ngưỡng Tồn Kiểm Soát Hàng Hóa] Lỗi khi gửi cho ${group.email}, bỏ qua và tiếp tục:`, err.message);
      }
    }

    if (handledOk) {
      await setCollection(pool, 'shelfThresholdDigestSchedule', { ...schedule, lastSentPeriodKey: periodKey });
    }
  } catch (err) {
    console.error('⛔ [Báo Cáo Ngưỡng Tồn Kiểm Soát Hàng Hóa] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = {
  checkShelfStockThresholdAlerts,
  resolveThresholdRecipients, sumTodaySkuQuantity, sumTodayCategoryQuantity,
  shouldSendDigestNow, getPeriodKey, startOfWeekMonday, formatYmd,
  buildDigestRowsForThreshold, buildDigestRowsForDept, groupDigestRowsByRecipient,
  DATA_SCOPE_DISCLAIMER
};
