// lib/dsmartPriceNotify.js — gửi email thông báo khi Áp Giá Mới/Xoá giá bán buôn DSmart THÀNH CÔNG
// (12/2026, theo yêu cầu người dùng: "nếu mà khi nào up giá thành công thì nó sẽ gửi email... và khi
// xóa thành công thì nó cũng gửi email xóa tự động... và có thông báo là siêu thị nào đã được áp giá,
// siêu thị nào đã được xóa giá") — áp dụng cho CẢ thao tác TAY (routes/dsmartWholesalePrice.js) lẫn TỰ
// ĐỘNG (jobs/dsmartAutoApplyScheduledPrices.js, jobs/dsmartAutoDeleteExpiredPrices.js), và email bổ
// sung khi hàng đợi tự động thử lại (jobs/dsmartRetryStoreFanOutQueue.js, xem lib/
// dsmartStoreFanOutRetryStore.js) đồng bộ bù được 1 siêu thị trước đó bị lỗi mạng.
//
// Người dùng xác nhận rõ phạm vi: CHỈ Áp Giá Mới + Xoá (KHÔNG tính "✏️ Sửa"); 1 danh sách email CỐ ĐỊNH
// do admin tự cấu hình (emailConfig.dsmartPriceNotifyEmails, màn "📧 Cấu Hình Email" — KHÔNG phải email
// của người tạo/người thao tác); gửi NGAY 1 email/lượt (không gộp theo ngày) — nhưng 1 "lượt" ở đây là 1
// LẦN GỌI route/job (có thể gồm NHIỀU dòng/mục cùng lúc — VD "Thêm Giá Bằng File Excel" áp hàng trăm
// dòng trong 1 request, hoặc job tự động áp/xoá nhiều dòng đến hạn cùng 1 lượt chạy) — GỘP thành 1 email
// DUY NHẤT liệt kê từng mục, KHÔNG gửi 1 email/dòng (tránh bão email khi thao tác hàng loạt).
//
// KHÔNG BAO GIỜ chặn/làm chậm thao tác chính (CSPRICE đã ghi xong trước khi hàm ở đây được gọi) — mọi
// lỗi gửi mail chỉ log cảnh báo qua insertSystemLog, không ném lỗi ra ngoài (3 hàm export đều tự bọc
// try/catch toàn bộ, không reject).
const { getPool, sql } = require('../db');
const { sendMail, resolveEncryption, resolveGraphOption, resolveEwsOption } = require('./mailer');
const { buildNotificationEmailHtml } = require('./emailTemplate');
const { decryptSecret } = require('./emailCrypto');
const { insertSystemLog } = require('./systemLogStore');

const MAX_ITEM_LINES = 50; // chặn email quá dài khi thao tác hàng loạt (VD nhập file vài trăm dòng)
const MAX_STORE_NAMES = 20; // chặn email quá dài khi fan-out xuống hàng chục siêu thị cùng lúc

async function getCollection(pool, key, fallback) {
  const result = await pool.request().input('k', sql.NVarChar(100), key).query('SELECT DataValue FROM dbo.AppData WHERE DataKey = @k');
  if (result.recordset.length === 0) return fallback;
  try {
    const parsed = JSON.parse(result.recordset[0].DataValue);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) { return fallback; }
}

// getNotifyContext(): null nếu TẮT (emailConfig.enabled=false) hoặc CHƯA cấu hình email nhận nào —
// nghĩa là tính năng này TẮT MẶC ĐỊNH cho tới khi admin tự nhập ít nhất 1 email ở Cấu Hình Email.
async function getNotifyContext() {
  const pool = await getPool();
  const emailConfig = await getCollection(pool, 'emailConfig', {});
  if (!emailConfig || emailConfig.enabled === false) return null;
  const recipients = Array.isArray(emailConfig.dsmartPriceNotifyEmails)
    ? emailConfig.dsmartPriceNotifyEmails.map(e => String(e || '').trim()).filter(Boolean)
    : [];
  if (!recipients.length) return null;
  let smtpUser = null, smtpPass = null;
  if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
    try { smtpUser = emailConfig.smtpUser; smtpPass = decryptSecret(emailConfig.smtpPassEnc); }
    catch (err) { console.error('⛔ [DSmart Giá] Không giải mã được mật khẩu SMTP đã lưu:', err.message); }
  }
  return { emailConfig, recipients, smtpUser, smtpPass };
}

// formatStoreBreakdown(storeResults, storeFanOutError) -> dòng ngắn gọn cho 1 mục trong email, liệt kê
// RÕ siêu thị nào đã đồng bộ xong/đang chờ thử lại — đúng yêu cầu người dùng "có thông báo là siêu thị
// nào đã được áp giá, siêu thị nào đã được xóa giá".
function formatStoreBreakdown(storeResults, storeFanOutError) {
  if (storeFanOutError) return `⚠️ không đọc được danh sách siêu thị (${storeFanOutError})`;
  if (!Array.isArray(storeResults)) return '';
  if (!storeResults.length) return '(không áp dụng cho siêu thị nào — chỉ ghi ở DSmart16 Trung Tâm)';
  const ok = storeResults.filter(r => r.ok);
  const failed = storeResults.filter(r => !r.ok);
  // Nêu RÕ TÊN siêu thị (không chỉ số lượng) — đúng yêu cầu người dùng "có thông báo là siêu thị nào đã
  // được áp giá, siêu thị nào đã được xóa giá". Chặn trần tên hiển thị (MAX_STORE_NAMES) để email không
  // quá dài khi fan-out xuống hàng chục siêu thị cùng lúc.
  const okNames = ok.slice(0, MAX_STORE_NAMES).map(r => r.storeCode).join(', ') + (ok.length > MAX_STORE_NAMES ? `, +${ok.length - MAX_STORE_NAMES} khác` : '');
  if (!failed.length) return `✅ ${ok.length}/${storeResults.length} siêu thị: ${okNames}`;
  const failedNames = failed.slice(0, MAX_STORE_NAMES).map(r => r.storeCode).join(', ') + (failed.length > MAX_STORE_NAMES ? `, +${failed.length - MAX_STORE_NAMES} khác` : '');
  return `✅ ${ok.length}/${storeResults.length} siêu thị${ok.length ? `: ${okNames}` : ''}, ⚠️ đang chờ kết nối lại (tự động thử lại sau): ${failedNames}`;
}

function buildItemLines(items, lineFn) {
  const shown = items.slice(0, MAX_ITEM_LINES).map(lineFn);
  const extra = items.length - shown.length;
  return extra > 0 ? [...shown, `… và ${extra} mục khác (xem "Lịch Sử Thao Tác" để biết chi tiết)`] : shown;
}

async function sendBatchEmail({ subject, bodyLines, logActionType, logDescription }) {
  try {
    const ctx = await getNotifyContext();
    if (!ctx) return; // tắt hoặc chưa cấu hình email nhận — không làm gì, không log (đúng ý "tắt mặc định")
    const bodyText = bodyLines.join('\n');
    const html = buildNotificationEmailHtml({ status: 'success', badge: '💰 Giá Bán Buôn DSmart', bodyText });
    let sendResult = { sent: [], failed: [], simulated: true };
    try {
      sendResult = await sendMail({
        to: ctx.recipients, subject, text: bodyText, html,
        host: ctx.emailConfig.smtpHost, port: ctx.emailConfig.smtpPort, encryption: resolveEncryption(ctx.emailConfig),
        user: ctx.smtpUser, pass: ctx.smtpPass, from: ctx.emailConfig.senderEmail,
        graph: resolveGraphOption(ctx.emailConfig), ews: resolveEwsOption(ctx.emailConfig)
      });
    } catch (err) {
      console.error(`⛔ [DSmart Giá] Gửi email thật thất bại (${logActionType}):`, err.message);
      sendResult = { sent: [], failed: ctx.recipients, simulated: false };
    }
    const totalSendFailure = !sendResult.simulated && sendResult.sent.length === 0 && sendResult.failed.length > 0;
    await insertSystemLog({
      username: 'SYSTEM', fullName: 'Hệ thống (tự động)', ipAddress: null, module: 'IT_SUPPORT',
      actionType: logActionType, targetObject: 'dsmartWholesalePriceEntries',
      description: `${logDescription}${totalSendFailure ? ` — LỖI gửi email tới: ${sendResult.failed.join(', ')}` : ''}`,
      status: totalSendFailure ? 'WARNING' : 'SUCCESS'
    });
  } catch (err) {
    console.error(`⛔ [DSmart Giá] Lỗi không xác định khi gửi email thông báo (${logActionType}):`, err.message);
  }
}

// notifyDsmartPriceApplyBatch({mode, actor, items}) — items: [{custId, skuId, price, frDate, toDate,
// storeResults, storeFanOutError}] ĐÃ ÁP DỤNG THÀNH CÔNG (không gồm dòng chỉ tạo lịch SCHEDULED, vì
// CHƯA ghi gì thật vào CSPRICE). mode: 'MANUAL' (tay) | 'AUTO_SCHEDULED' (job "Lên Lịch Áp Giá" tự động).
async function notifyDsmartPriceApplyBatch({ mode, actor, items }) {
  if (!Array.isArray(items) || !items.length) return;
  const modeLabel = mode === 'AUTO_SCHEDULED' ? 'tự động (đến hạn lịch đã đặt)' : `thủ công bởi ${actor || 'không rõ'}`;
  const subject = items.length === 1
    ? `[Giá Bán Buôn] Đã áp giá thành công: ${items[0].custId}/${items[0].skuId}`
    : `[Giá Bán Buôn] Đã áp giá thành công: ${items.length} mục`;
  const bodyLines = [
    `Hệ thống vừa ÁP GIÁ THÀNH CÔNG (${modeLabel}) ${items.length} mục sau xuống DSmart16 Trung Tâm:`, '',
    ...buildItemLines(items, it => `- ${it.custId}/${it.skuId} (giá ${it.price}, ${it.frDate} → ${it.toDate}): ${formatStoreBreakdown(it.storeResults, it.storeFanOutError)}`)
  ];
  await sendBatchEmail({
    subject, bodyLines, logActionType: 'NOTIFY_DSMART_PRICE_APPLIED',
    logDescription: `Đã gửi email thông báo áp giá thành công (${modeLabel}, ${items.length} mục)`
  });
}

// notifyDsmartPriceDeleteBatch({mode, actor, items}) — items: [{custId, skuId, storeResults, storeFanOutError}].
async function notifyDsmartPriceDeleteBatch({ mode, actor, items }) {
  if (!Array.isArray(items) || !items.length) return;
  const modeLabel = mode === 'AUTO' ? 'tự động (đã hết hạn)' : `thủ công bởi ${actor || 'không rõ'}`;
  const subject = items.length === 1
    ? `[Giá Bán Buôn] Đã xoá giá thành công: ${items[0].custId}/${items[0].skuId}`
    : `[Giá Bán Buôn] Đã xoá giá thành công: ${items.length} mục`;
  const bodyLines = [
    `Hệ thống vừa XOÁ GIÁ THÀNH CÔNG (${modeLabel}) ${items.length} mục sau khỏi DSmart16 Trung Tâm:`, '',
    ...buildItemLines(items, it => `- ${it.custId}/${it.skuId}: ${formatStoreBreakdown(it.storeResults, it.storeFanOutError)}`)
  ];
  await sendBatchEmail({
    subject, bodyLines, logActionType: 'NOTIFY_DSMART_PRICE_DELETED',
    logDescription: `Đã gửi email thông báo xoá giá thành công (${modeLabel}, ${items.length} mục)`
  });
}

// notifyDsmartPriceRetryBatch({items}) — items: [{action:'APPLY'|'DELETE', storeCode, storeName, custId, skuId}]
// ĐÃ đồng bộ BÙ thành công qua hàng đợi tự động thử lại (jobs/dsmartRetryStoreFanOutQueue.js), tức các
// siêu thị trước đó bị báo lỗi mạng ở email đầu tiên nay đã kết nối lại và ghi thành công.
async function notifyDsmartPriceRetryBatch({ items }) {
  if (!Array.isArray(items) || !items.length) return;
  const subject = `[Giá Bán Buôn] Đã đồng bộ bổ sung thành công tới ${items.length} siêu thị (sau khi mất kết nối)`;
  const bodyLines = [
    'Các siêu thị sau TRƯỚC ĐÓ bị lỗi mạng khi Áp Giá/Xoá Giá — hệ thống vừa TỰ ĐỘNG thử lại và ĐÃ đồng bộ thành công:', '',
    ...buildItemLines(items, it => `- ${it.storeCode} (${it.storeName}): ${it.action === 'APPLY' ? 'Áp giá' : 'Xoá giá'} ${it.custId}/${it.skuId}`)
  ];
  await sendBatchEmail({
    subject, bodyLines, logActionType: 'NOTIFY_DSMART_PRICE_RETRY_SUCCEEDED',
    logDescription: `Đã gửi email thông báo đồng bộ bổ sung thành công (${items.length} lượt thử lại)`
  });
}

module.exports = { notifyDsmartPriceApplyBatch, notifyDsmartPriceDeleteBatch, notifyDsmartPriceRetryBatch };
