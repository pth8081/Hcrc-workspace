// lib/mailer.js — Gửi email THẬT qua SMTP (nodemailer), dùng chung cho cả routes/email.js (gọi từ
// frontend qua fetch) lẫn jobs/contractExpiryReminder.js (chạy định kỳ phía server).
//
// PHÂN CHIA CẤU HÌNH — MỖI PHẦN CHỈ CÓ 1 NGUỒN DUY NHẤT, KHÔNG CHỒNG CHÉO ƯU TIÊN:
// - Host/Port/Secure(TLS)/Email người gửi/Bật-tắt gửi mail: KHÔNG nhạy cảm, cấu hình DUY NHẤT ở màn
//   Quản trị > Cấu Hình Email (DB.emailConfig) — admin đổi trực tiếp trên web, không cần đụng server.
//   Hàm sendMail() bên dưới LUÔN nhận các giá trị này qua tham số do nơi gọi truyền vào, không tự đọc
//   biến môi trường nào cho phần này.
// - Tài khoản/mật khẩu đăng nhập SMTP (SMTP_USER/SMTP_PASS): CHỈ đọc từ biến môi trường phía server
//   (.env), KHÔNG BAO GIỜ lưu trong DB.emailConfig — vì GET /api/data trả nguyên toàn bộ dữ liệu ứng
//   dụng cho mọi client gọi được (không có xác thực ở tầng API), lưu mật khẩu SMTP ở đó sẽ lộ cho bất
//   kỳ ai mở được trang. Để trống CẢ HAI biến này = máy chủ SMTP không yêu cầu xác thực (kết nối ẩn
//   danh) — hỗ trợ song song cả 2 kiểu máy chủ SMTP (có xác thực / không xác thực) mà không cần cấu
//   hình gì thêm ngoài việc điền hay bỏ trống 2 biến này.
require('dotenv').config();
const nodemailer = require('nodemailer');

// Server có cấu hình tài khoản/mật khẩu đăng nhập SMTP hay không — dùng để hiển thị TRẠNG THÁI (không
// nhạy cảm, không lộ giá trị thật) cho admin biết server đang chạy ở chế độ có xác thực hay ẩn danh.
function hasAuthConfigured() {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function buildTransporter({ host, port, secure }) {
  const resolvedPort = parseInt(port, 10) || 587;
  const resolvedSecure = secure !== undefined && secure !== null ? !!secure : resolvedPort === 465;

  const config = {
    host,
    port: resolvedPort,
    secure: resolvedSecure
  };
  // Chỉ thêm xác thực nếu có khai báo đủ tài khoản + mật khẩu — bỏ qua (kết nối ẩn danh) cho relay
  // nội bộ không yêu cầu đăng nhập.
  if (hasAuthConfigured()) {
    config.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  }
  // Một số relay nội bộ dùng chứng chỉ TLS tự ký — cho phép bỏ qua kiểm tra hợp lệ chứng chỉ khi
  // khai báo rõ ràng (mặc định vẫn kiểm tra bình thường).
  if (process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false') {
    config.tls = { rejectUnauthorized: false };
  }
  return { transporter: nodemailer.createTransport(config), resolvedHost: host, resolvedPort };
}

// Gửi email tới 1 hoặc nhiều người nhận (gửi riêng từng người để biết chính xác ai thành công/thất
// bại). Trả về { sent, failed, simulated, host, port } — có kèm host/port THỰC đã dùng để gửi (chỉ
// khi simulated:false) để nơi gọi (Nhật ký hệ thống) ghi rõ đã xác nhận gửi tới máy chủ nào, phục vụ
// việc kiểm tra/xác minh thay vì chỉ tin vào việc "đã thử gửi".
async function sendMail({ to, subject, text, html, host, port, secure, from }) {
  const recipients = (Array.isArray(to) ? to : [to]).map(a => (a || '').trim()).filter(Boolean);
  if (recipients.length === 0) return { sent: [], failed: [], simulated: false };

  // Chưa nhập SMTP Server ở màn Cấu Hình Email -> chưa thể gửi thật, mô phỏng như cũ.
  if (!host) {
    return { sent: [], failed: recipients, simulated: true };
  }

  const { transporter, resolvedHost, resolvedPort } = buildTransporter({ host, port, secure });
  const fromAddr = from || process.env.SMTP_USER || 'no-reply@localhost';

  const sent = [];
  const failed = [];
  for (const addr of recipients) {
    try {
      await transporter.sendMail({ from: fromAddr, to: addr, subject, text, html: html || undefined });
      sent.push(addr);
    } catch (err) {
      console.error(`⛔ Gửi email tới ${addr} thất bại:`, err.message);
      failed.push(addr);
    }
  }
  return { sent, failed, simulated: false, host: resolvedHost, port: resolvedPort };
}

module.exports = { sendMail, hasAuthConfigured };
