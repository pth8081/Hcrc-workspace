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
const { buildGenericWorkbook } = require('./adminExport');

const MAX_ITEM_LINES = 50; // chặn email quá dài khi thao tác hàng loạt (VD nhập file vài trăm dòng) — vẫn
// dùng cho phần TÓM TẮT trong body (cảnh báo bất thường) và cho bản fallback KHÔNG đính kèm được file,
// KHÔNG còn giới hạn số dòng của file Excel đính kèm (xem buildItemsXlsxAttachment() ngay dưới).
const MAX_STORE_NAMES = 20; // chặn email quá dài khi fan-out xuống hàng chục siêu thị cùng lúc

// buildItemsXlsxAttachment() (12/2026, theo yêu cầu người dùng kèm ảnh chụp email thật: "Gửi ra body mail
// này nhiều lúc nó đến cả vài trăm đến 1000 dòng... người đọc người ta không để ý được. Nên là riêng cái
// gửi email này... attach file nhé") — dựng 1 file Excel đính kèm liệt kê ĐẦY ĐỦ (không cắt bớt như body)
// từng mục của lượt Áp Giá/Xoá Giá/Đồng Bộ Lại, tái dùng ĐÚNG buildGenericWorkbook() dùng chung
// (lib/adminExport.js, cùng hàm POST /api/admin/export-xlsx đang dùng — xem quy tắc CLAUDE.md "ưu tiên
// route/hàm Excel dùng chung") thay vì tự viết logic dựng Excel mới. Lỗi dựng file (hiếm) chỉ log cảnh
// báo, trả về null — nơi gọi tự fallback về liệt kê rút gọn ngay trong body (đúng hành vi CŨ trước khi có
// đính kèm), KHÔNG làm mất hẳn nội dung thông báo.
async function buildItemsXlsxAttachment(filenameBase, sheetName, columns, rows) {
  try {
    const wb = buildGenericWorkbook(sheetName, columns, rows);
    const buffer = await wb.xlsx.writeBuffer();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    return [{
      filename: `${filenameBase}_${ts}.xlsx`, content: Buffer.from(buffer),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }];
  } catch (err) {
    console.error('⛔ [DSmart Giá] Không dựng được file Excel đính kèm, email sẽ gửi KHÔNG kèm file:', err.message);
    return null;
  }
}

// buildStoreAnomalySummaryLines(items) — dòng CẢNH BÁO TÓM TẮT ngay trong body (không cần mở file đính
// kèm mới thấy) khi phát hiện bất thường về đồng bộ siêu thị. Trả lời THẲNG câu hỏi người dùng thật đã
// hỏi (12/2026, kèm ảnh email "Đã áp giá thành công: 20 mục", toàn bộ 20 dòng đều "không áp dụng cho siêu
// thị nào"): "tại sao nó lại không áp dụng ở các siêu thị nào, hay do người chọn à?" — xác nhận qua đọc
// lại resolveDsmartPriceTargetStoreIds()/renderDsmartPriceApplyStoreMultiSelect()
// (module-itsupport-dsmartprice.js): ô "🏬 Áp Dụng Cho Siêu Thị" mặc định chọn SẴN TẤT CẢ siêu thị đang
// bật — CHỈ gửi mảng rỗng lên server khi người thao tác TỰ bỏ chọn hết (bấm × từng chip hoặc bấm × ở badge
// "✅ Tất cả" để bỏ chọn tất cả) trước khi bấm "Thêm Giá Mới"/"Dùng Lại" — KHÔNG có đường nào trong code
// hiện tại tự ý gửi mảng rỗng (ô chưa tải xong danh sách siêu thị thì tự trả về null = áp dụng TẤT CẢ,
// không phải mảng rỗng, xem resolveDsmartPriceTargetStoreIds()). Vậy đây LUÔN là lựa chọn CHỦ ĐỘNG của
// người thao tác (đã nêu tên ngay dòng mở đầu email, xem modeLabel) — không phải lỗi hệ thống.
function buildStoreAnomalySummaryLines(items) {
  const lines = [];
  const noStoreItems = items.filter(it => Array.isArray(it.storeResults) && it.storeResults.length === 0 && !it.storeFanOutError);
  const errorItems = items.filter(it => it.storeFanOutError);
  const failedSyncItems = items.filter(it => Array.isArray(it.storeResults) && it.storeResults.some(r => !r.ok));
  if (noStoreItems.length) {
    lines.push('', `⚠️ ${noStoreItems.length}/${items.length} mục KHÔNG đồng bộ xuống bất kỳ siêu thị nào (chỉ ghi ở DSmart16 Trung Tâm) — do người thao tác đã BỎ CHỌN hết ở ô "🏬 Áp Dụng Cho Siêu Thị" lúc thực hiện (không phải lỗi hệ thống):`,
      ...buildItemLines(noStoreItems, it => `  - ${it.custId}/${it.skuId}`));
  }
  if (errorItems.length) lines.push('', `⚠️ ${errorItems.length}/${items.length} mục không đọc được danh sách siêu thị để đồng bộ (xem chi tiết trong file đính kèm).`);
  if (failedSyncItems.length) lines.push('', `⚠️ ${failedSyncItems.length}/${items.length} mục có ít nhất 1 siêu thị lỗi mạng lúc đồng bộ, hệ thống đang TỰ ĐỘNG thử lại (xem chi tiết trong file đính kèm).`);
  return lines;
}

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

async function sendBatchEmail({ subject, bodyLines, attachments, logActionType, logDescription }) {
  try {
    const ctx = await getNotifyContext();
    if (!ctx) return; // tắt hoặc chưa cấu hình email nhận — không làm gì, không log (đúng ý "tắt mặc định")
    const bodyText = bodyLines.join('\n');
    const html = buildNotificationEmailHtml({ status: 'success', badge: '💰 Giá Bán Buôn DSmart', bodyText });
    let sendResult = { sent: [], failed: [], simulated: true };
    try {
      sendResult = await sendMail({
        to: ctx.recipients, subject, text: bodyText, html, attachments,
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
  const intro = `Hệ thống vừa ÁP GIÁ THÀNH CÔNG (${modeLabel}) ${items.length} mục sau xuống DSmart16 Trung Tâm.`;
  const attachments = await buildItemsXlsxAttachment('Ap_Gia_Ban_Buon', 'Ap Gia Moi', [
    { header: 'Mã Khách B2B', key: 'custId', width: 18 },
    { header: 'Mã Sản Phẩm', key: 'skuId', width: 18 },
    { header: 'Giá', key: 'price', width: 14, numFmt: '#,##0' },
    { header: 'Ngày Bắt Đầu', key: 'frDate', width: 14 },
    { header: 'Ngày Kết Thúc', key: 'toDate', width: 14 },
    { header: 'Đồng Bộ Siêu Thị', key: 'storeInfo', width: 60 }
  ], items.map(it => ({ custId: it.custId, skuId: it.skuId, price: it.price, frDate: it.frDate, toDate: it.toDate, storeInfo: formatStoreBreakdown(it.storeResults, it.storeFanOutError) })));
  const bodyLines = attachments
    ? [intro, '', '📎 Xem danh sách đầy đủ từng mục (kèm chi tiết đồng bộ từng siêu thị) trong file Excel đính kèm.', ...buildStoreAnomalySummaryLines(items)]
    : [`${intro}:`, '', ...buildItemLines(items, it => `- ${it.custId}/${it.skuId} (giá ${it.price}, ${it.frDate} → ${it.toDate}): ${formatStoreBreakdown(it.storeResults, it.storeFanOutError)}`)];
  await sendBatchEmail({
    subject, bodyLines, attachments: attachments || undefined, logActionType: 'NOTIFY_DSMART_PRICE_APPLIED',
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
  const intro = `Hệ thống vừa XOÁ GIÁ THÀNH CÔNG (${modeLabel}) ${items.length} mục sau khỏi DSmart16 Trung Tâm.`;
  const attachments = await buildItemsXlsxAttachment('Xoa_Gia_Ban_Buon', 'Xoa Gia', [
    { header: 'Mã Khách B2B', key: 'custId', width: 18 },
    { header: 'Mã Sản Phẩm', key: 'skuId', width: 18 },
    { header: 'Đồng Bộ Siêu Thị', key: 'storeInfo', width: 60 }
  ], items.map(it => ({ custId: it.custId, skuId: it.skuId, storeInfo: formatStoreBreakdown(it.storeResults, it.storeFanOutError) })));
  const bodyLines = attachments
    ? [intro, '', '📎 Xem danh sách đầy đủ từng mục (kèm chi tiết đồng bộ từng siêu thị) trong file Excel đính kèm.', ...buildStoreAnomalySummaryLines(items)]
    : [`${intro}:`, '', ...buildItemLines(items, it => `- ${it.custId}/${it.skuId}: ${formatStoreBreakdown(it.storeResults, it.storeFanOutError)}`)];
  await sendBatchEmail({
    subject, bodyLines, attachments: attachments || undefined, logActionType: 'NOTIFY_DSMART_PRICE_DELETED',
    logDescription: `Đã gửi email thông báo xoá giá thành công (${modeLabel}, ${items.length} mục)`
  });
}

// notifyDsmartPriceRetryBatch({items}) — items: [{action:'APPLY'|'DELETE', storeCode, storeName, custId, skuId}]
// ĐÃ đồng bộ BÙ thành công qua hàng đợi tự động thử lại (jobs/dsmartRetryStoreFanOutQueue.js), tức các
// siêu thị trước đó bị báo lỗi mạng ở email đầu tiên nay đã kết nối lại và ghi thành công.
async function notifyDsmartPriceRetryBatch({ items }) {
  if (!Array.isArray(items) || !items.length) return;
  const subject = `[Giá Bán Buôn] Đã đồng bộ bổ sung thành công tới ${items.length} siêu thị (sau khi mất kết nối)`;
  const intro = 'Các siêu thị sau TRƯỚC ĐÓ bị lỗi mạng khi Áp Giá/Xoá Giá — hệ thống vừa TỰ ĐỘNG thử lại và ĐÃ đồng bộ thành công.';
  const attachments = await buildItemsXlsxAttachment('Dong_Bo_Lai_Gia_Ban_Buon', 'Dong Bo Lai', [
    { header: 'Mã Siêu Thị', key: 'storeCode', width: 16 },
    { header: 'Tên Siêu Thị', key: 'storeName', width: 24 },
    { header: 'Hành Động', key: 'action', width: 14 },
    { header: 'Mã Khách B2B', key: 'custId', width: 18 },
    { header: 'Mã Sản Phẩm', key: 'skuId', width: 18 }
  ], items.map(it => ({ storeCode: it.storeCode, storeName: it.storeName, action: it.action === 'APPLY' ? 'Áp giá' : 'Xoá giá', custId: it.custId, skuId: it.skuId })));
  const bodyLines = attachments
    ? [intro, '', '📎 Xem danh sách đầy đủ từng lượt đồng bộ trong file Excel đính kèm.']
    : [`${intro}`, '', ...buildItemLines(items, it => `- ${it.storeCode} (${it.storeName}): ${it.action === 'APPLY' ? 'Áp giá' : 'Xoá giá'} ${it.custId}/${it.skuId}`)];
  await sendBatchEmail({
    subject, bodyLines, attachments: attachments || undefined, logActionType: 'NOTIFY_DSMART_PRICE_RETRY_SUCCEEDED',
    logDescription: `Đã gửi email thông báo đồng bộ bổ sung thành công (${items.length} lượt thử lại)`
  });
}

module.exports = { notifyDsmartPriceApplyBatch, notifyDsmartPriceDeleteBatch, notifyDsmartPriceRetryBatch };
