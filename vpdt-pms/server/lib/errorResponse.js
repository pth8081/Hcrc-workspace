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

// sendCatchError — dùng trong catch(err) ở các route ĐỌC NỘI DUNG file người dùng tải lên (Excel/CSV
// bảng giá, danh mục, kế hoạch đào tạo...) hoặc callback multer, nơi lỗi bắt được có thể là 1 trong 2
// loại rất khác nhau: (1) lỗi NGHIỆP VỤ đã được code chủ đích ném ra bằng HttpError(status, message) —
// message đã được viết SẴN để hiển thị an toàn cho người dùng (VD "File thiếu cột bắt buộc: Tên mặt
// hàng"), PHẢI hiển thị nguyên văn thì người dùng mới sửa được file; (2) lỗi KHÔNG LƯỜNG TRƯỚC (thư viện
// đọc Excel/CSV ném lỗi nội bộ, hoặc hiếm hơn là lỗi ghi đĩa như ENOSPC/EACCES có thể LỘ ĐƯỜNG DẪN THẬT
// trên server) — loại này phải đi qua sendServerError() để ẩn chi tiết khi NODE_ENV=production, giống
// mọi lỗi 500 khác. Trước đây các route đọc file loại này TRẢ THẲNG err.message ra client bất kể là loại
// (1) hay (2), bất kể môi trường — audit bảo mật phát hiện đây là 1 đường lộ thông tin nội bộ (dù hẹp,
// chỉ xảy ra khi có lỗi thật sự ngoài dự tính) không đi qua cơ chế NODE_ENV-aware đã có sẵn.
function sendCatchError(res, err, logContext, fallbackStatus = 500) {
  const { HttpError } = require('./httpErrors');
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  return sendServerError(res, fallbackStatus, err, logContext);
}

module.exports = { sendServerError, sendCatchError };
