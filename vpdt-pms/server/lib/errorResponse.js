// lib/errorResponse.js — trả lỗi máy chủ (500, ngoài dự tính — khác HttpError chủ đích ở
// lib/httpErrors.js) ra JSON mà KHÔNG lộ chi tiết exception thật (có thể chứa lỗi SQL, đường dẫn file,
// stack-adjacent info...) khi chạy production. Trước đây res.json({ error, detail: err.message }) trả
// thẳng err.message ra client bất kể môi trường — dev cần thấy chi tiết để gỡ lỗi nhanh, production thì
// KHÔNG nên lộ, chỉ ghi vào console/log server. Đặt NODE_ENV=production khi deploy thật để áp dụng.
function sendServerError(res, status, err, logContext, publicMessage) {
  console.error(`⛔ ${logContext} lỗi:`, err.message);
  const isProd = process.env.NODE_ENV === 'production';
  const body = { error: publicMessage || 'Đã có lỗi xảy ra, vui lòng thử lại sau' };
  if (!isProd) body.detail = err.message;
  res.status(status).json(body);
}

module.exports = { sendServerError };
