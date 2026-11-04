// jobs/shelfStockReconDigestAlert.js — "📊 Báo Cáo Đối Chiếu" (Kiểm Soát Hàng Hóa, 11/2026, theo yêu
// cầu người dùng: "phần đối chiếu này cũng sẽ đặt lịch gửi email luôn được nhé để mình setup email gửi
// cho có thêm đường nữa nhận thông tin thay vì xem trên app"). CÙNG MÔ HÌNH digest tổng hợp theo lịch
// ADMIN TỰ CẤU HÌNH như jobs/shelfStockThresholdAlert.js (Hàng ngày/Hàng tuần/Hàng tháng + giờ —
// DB.shelfReconDigestSchedule/#adminSubShelfDigest), NHƯNG lịch TÁCH RIÊNG (lastSentPeriodKey độc lập,
// người dùng xác nhận muốn tần suất riêng cho 2 báo cáo) — tái dùng NGUYÊN shouldSendDigestNow()/
// getPeriodKey() của file threshold (pure function, không phụ thuộc gì riêng Ngưỡng Tồn) thay vì chép
// lại logic.
//
// Nội dung: CHỈ liệt kê mã hàng ĐÃ SCAN lên kệ hôm nay và có CHÊNH LỆCH (Lệch) giữa Tồn Kho Hệ Thống và
// Trên Kệ Hôm Nay — đúng phạm vi đã thu hẹp của màn "📊 Đối Chiếu" (xem routes/shelfStock.js
// GET /system-inventory?scope=recon, v29.21) — KHÔNG liệt kê mã "Khớp" (người dùng xác nhận: email chỉ
// cần cảnh báo, không cần đầy đủ như màn xem). Nếu 1 siêu thị không có mã lệch nào trong kỳ, người nhận
// của ĐÚNG siêu thị đó không được gửi (nhưng vẫn coi kỳ là "đã xử lý xong" nếu KHÔNG ai có lỗi gửi thật).
//
// Người nhận: CÙNG 3 tầng quyền tự động (Tầng 1-3, tính ĐỘNG lúc gửi) như Ngưỡng Tồn — Tầng 1
// shelfLocationManage+đúng dept, Tầng 2 shelfReportView.depts, Tầng 3 shelfReportView.all — CỘNG 1 danh
// sách "tự thêm thêm" riêng theo dept (DB.shelfReconExtraRecipients[dept], KHÔNG dùng chung Tầng 4 theo
// từng ngưỡng của Ngưỡng Tồn vì Đối Chiếu không có khái niệm "ngưỡng/điều kiện" — chỉ có phạm vi SIÊU
// THỊ, xem PUT /api/shelf-stock/recon-recipients ở routes/shelfStock.js).
const { getPool, sql } = require('../db');
const { sendMail, resolveEncryption, resolveGraphOption, resolveEwsOption } = require('../lib/mailer');
const { buildNotificationEmailHtml } = require('../lib/emailTemplate');
const { decryptSecret } = require('../lib/emailCrypto');
const { insertSystemLog } = require('../lib/systemLogStore');
const { isUserOptedOutOfEmailModule } = require('../lib/notifyEmailModulesGate');
const { buildShelfReconDigestExcelBuffer, DATA_SCOPE_DISCLAIMER } = require('../lib/shelfReconDigestExcel');
const { parseVNDateTime } = require('../lib/recordActions');
const { getSystemInventoryForMaDiem } = require('./inventorySync');
const { shouldSendDigestNow, getPeriodKey } = require('./shelfStockThresholdAlert');

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
  const d = parseVNDateTime(dateStr) || new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// buildReconMismatchRowsForDept(): ĐÚNG logic lọc/so khớp của routes/shelfStock.js (GET /system-inventory
// ?scope=recon) + renderShelfReconciliationTable() (module-vanhanh.js) — PHẢI giữ khớp cả 3 nơi, sửa 1
// bên bắt buộc sửa cả 2 bên còn lại. Trả về CHỈ các dòng có diff !== 0 (mã lệch), bỏ qua mã khớp.
async function buildReconMismatchRowsForDept(dept, maDiem, shelfRecords) {
  if (!maDiem) return [];
  const cached = await getSystemInventoryForMaDiem(maDiem);
  if (!cached || !Array.isArray(cached.rows) || !cached.rows.length) return [];

  const todayByMaHang = {};
  for (const r of (shelfRecords || [])) {
    if (!r || !r.maHang || r.dept !== dept || !isToday(r.lastScannedAt || r.createdAt)) continue;
    todayByMaHang[r.maHang] = (todayByMaHang[r.maHang] || 0) + (Number(r.quantity) || 0);
  }
  const scannedMaHangToday = new Set(Object.keys(todayByMaHang));

  const rows = [];
  for (const r of cached.rows) {
    if (!r.maHang || !scannedMaHangToday.has(String(r.maHang))) continue;
    const shelfTotal = todayByMaHang[r.maHang] || 0;
    const diff = shelfTotal - (Number(r.soLuongTon) || 0);
    if (diff === 0) continue;
    rows.push({ dept, maHang: r.maHang, tenHang: r.tenHang || '', soLuongTon: Number(r.soLuongTon) || 0, shelfTotal, diff });
  }
  return rows;
}

// groupReconDigestRowsByRecipient(): gom theo NGƯỜI NHẬN THẬT (không theo siêu thị) — cùng tinh thần
// groupDigestRowsByRecipient() ở jobs/shelfStockThresholdAlert.js. Dedup người nhận theo email CHỮ
// THƯỜNG (cùng lý do đã áp dụng ở Ngưỡng Tồn).
function groupReconDigestRowsByRecipient(deptsWithMaDiem, allUsers, extraRecipients, mismatchRowsByDept) {
  const users = Array.isArray(allUsers) ? allUsers : [];
  const recipientInfo = new Map(); // emailLower -> { name, email, deptScope: Set<dept> }
  const ensureRecipient = (u) => {
    const key = u.email.toLowerCase();
    if (!recipientInfo.has(key)) recipientInfo.set(key, { name: u.name || u.username, email: u.email, deptScope: new Set() });
    return recipientInfo.get(key);
  };

  for (const dept of deptsWithMaDiem) {
    const extraUsernames = Array.isArray(extraRecipients?.[dept]) ? extraRecipients[dept] : [];
    for (const u of users) {
      if (!u || !u.username || u.active === false || !u.email) continue;
      if (isUserOptedOutOfEmailModule(u, 'SHELF_RECON')) continue;
      const isTier1 = !!u.perms?.shelfLocationManage && u.dept === dept;
      const isTier2 = Array.isArray(u.perms?.shelfReportView?.depts) && u.perms.shelfReportView.depts.includes(dept);
      const isTier3 = !!u.perms?.shelfReportView?.all;
      const isExtra = extraUsernames.includes(u.username);
      if (isTier1 || isTier2 || isTier3 || isExtra) ensureRecipient(u).deptScope.add(dept);
    }
  }

  const groups = [];
  for (const info of recipientInfo.values()) {
    const rows = [];
    for (const dept of info.deptScope) rows.push(...(mismatchRowsByDept.get(dept) || []));
    if (rows.length) groups.push({ email: info.email, name: info.name, rows });
  }
  return groups;
}

async function checkShelfStockReconDigestAlerts() {
  let pool;
  try {
    pool = await getPool();
  } catch (err) {
    console.error('⛔ [Báo Cáo Đối Chiếu Kiểm Soát Hàng Hóa] Không kết nối được SQL Server:', err.message);
    return;
  }

  try {
    const schedule = await getCollection(pool, 'shelfReconDigestSchedule', { frequency: 'WEEKLY', hour: 20, dayOfWeek: 1, dayOfMonth: 1, lastSentPeriodKey: null });
    const now = new Date();
    if (!shouldSendDigestNow(schedule, now)) return;
    const periodKey = getPeriodKey(now, schedule.frequency);
    if (schedule.lastSentPeriodKey === periodKey) return; // kỳ này đã gửi rồi

    const emailConfig = await getCollection(pool, 'emailConfig', {});
    if (!emailConfig || emailConfig.enabled === false) return;

    let smtpUser = null, smtpPass = null;
    if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
      try {
        smtpUser = emailConfig.smtpUser;
        smtpPass = decryptSecret(emailConfig.smtpPassEnc);
      } catch (err) {
        console.error('⛔ [Báo Cáo Đối Chiếu Kiểm Soát Hàng Hóa] Không giải mã được mật khẩu SMTP đã lưu:', err.message);
      }
    }
    const smtpEncryption = resolveEncryption(emailConfig);

    const [storeExternalCodes, shelfRecords, extraRecipients, allUsers] = await Promise.all([
      getCollection(pool, 'storeExternalCodes', {}),
      getCollection(pool, 'shelfRecords', []),
      getCollection(pool, 'shelfReconExtraRecipients', {}),
      getCollection(pool, 'users', [])
    ]);

    const deptsWithMaDiem = Object.keys(storeExternalCodes || {}).filter(dept => storeExternalCodes[dept]);
    const mismatchRowsByDept = new Map();
    for (const dept of deptsWithMaDiem) {
      const rows = await buildReconMismatchRowsForDept(dept, storeExternalCodes[dept], shelfRecords || []);
      if (rows.length) mismatchRowsByDept.set(dept, rows);
    }

    const digestGroups = groupReconDigestRowsByRecipient(deptsWithMaDiem, allUsers || [], extraRecipients || {}, mismatchRowsByDept);

    // handledOk: cùng quy tắc Ngưỡng Tồn — chỉ đánh dấu "đã gửi kỳ này" nếu KHÔNG ai cần gửi, hoặc có
    // ít nhất 1 người nhận được xử lý ổn thoả (thành công thật hoặc mô phỏng hợp lệ). Nếu TẤT CẢ lượt
    // gửi thật đều lỗi, KHÔNG đánh dấu, để tick giờ kế tiếp tự thử lại đúng kỳ này.
    let handledOk = digestGroups.length === 0;

    for (const group of digestGroups) {
      try {
        const subject = `[VPDT] Báo cáo Đối Chiếu — Kiểm Soát Hàng Hóa (${group.rows.length} mã lệch)`;
        const plainBody = `Đính kèm báo cáo Đối Chiếu — ${group.rows.length} mã hàng đã scan lên kệ hôm nay nhưng LỆCH so với Tồn Kho Hệ Thống. Xem file Excel đính kèm để biết chi tiết từng dòng (theo siêu thị). ${DATA_SCOPE_DISCLAIMER}`;
        const html = buildNotificationEmailHtml({ status: 'info', badge: '📊 Báo cáo Đối Chiếu định kỳ — Kiểm Soát Hàng Hóa', bodyText: plainBody });
        const excelBuffer = await buildShelfReconDigestExcelBuffer(group.rows);

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
              filename: 'BaoCaoDoiChieu.xlsx',
              content: Buffer.from(excelBuffer),
              contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }]
          });
        } catch (err) {
          console.error(`⛔ [Báo Cáo Đối Chiếu Kiểm Soát Hàng Hóa] Gửi email thật thất bại (${group.email}):`, err.message);
          sendResult = { sent: [], failed: [group.email], simulated: false };
        }
        const isRealHardFailure = sendResult.simulated === false && sendResult.sent.length === 0 && sendResult.failed.length > 0;
        if (!isRealHardFailure) handledOk = true;
        await insertSystemLog({
          username: 'system_scheduler', fullName: 'Hệ Thống (Tự Động)', ipAddress: 'SERVER (Scheduled Job)',
          module: 'SHELF_RECON', actionType: 'DIGEST_SENT', targetObject: `${group.name} <${group.email}>`,
          description: `Gửi báo cáo tổng hợp Đối Chiếu kỳ ${periodKey} — ${group.rows.length} mã lệch tới ${group.email}${isRealHardFailure ? ' — THẤT BẠI THẬT, sẽ tự thử lại ở lần kiểm kế tiếp' : ''}`,
          status: isRealHardFailure ? 'WARNING' : 'SUCCESS'
        });
      } catch (err) {
        console.error(`⛔ [Báo Cáo Đối Chiếu Kiểm Soát Hàng Hóa] Lỗi khi gửi cho ${group.email}, bỏ qua và tiếp tục:`, err.message);
      }
    }

    if (handledOk) {
      await setCollection(pool, 'shelfReconDigestSchedule', { ...schedule, lastSentPeriodKey: periodKey });
    }
  } catch (err) {
    console.error('⛔ [Báo Cáo Đối Chiếu Kiểm Soát Hàng Hóa] Lỗi khi kiểm tra:', err.message);
  }
}

module.exports = {
  checkShelfStockReconDigestAlerts,
  buildReconMismatchRowsForDept, groupReconDigestRowsByRecipient, isToday
};
