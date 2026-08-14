// lib/mailer.js — Gửi email THẬT qua SMTP (nodemailer), dùng chung cho cả routes/email.js (gọi từ
// frontend qua fetch) lẫn jobs/contractExpiryReminder.js (chạy định kỳ phía server).
//
// QUAN TRỌNG VỀ BẢO MẬT: tài khoản/mật khẩu đăng nhập SMTP (SMTP_USER/SMTP_PASS) CHỈ được đọc từ
// biến môi trường phía server (.env), KHÔNG BAO GIỜ lưu trong DB.emailConfig — vì GET /api/data trả
// nguyên toàn bộ dữ liệu ứng dụng cho mọi client gọi được (không có xác thực ở tầng API), lưu mật
// khẩu SMTP ở đó sẽ lộ cho bất kỳ ai mở được trang. Host/Port/Email người gửi không nhạy cảm nên vẫn
// lấy được từ emailConfig (admin chỉnh trong màn Quản trị) như trước.
require('dotenv').config();
const nodemailer = require('nodemailer');

// Đã cấu hình đủ để gửi hay chưa — chỉ cần SMTP_HOST là đủ; SMTP_USER/SMTP_PASS là TÙY CHỌN, để
// hỗ trợ cả mail relay nội bộ không yêu cầu xác thực (chỉ cho phép kết nối từ IP tin cậy). Nếu
// chưa cấu hình, sendMail() trả về simulated:true thay vì báo lỗi, giống hành vi mô phỏng cũ.
function isConfigured() {
  return !!process.env.SMTP_HOST;
}

function buildTransporter({ host, port, secure }) {
  const resolvedHost = host || process.env.SMTP_HOST;
  const resolvedPort = parseInt(port || process.env.SMTP_PORT || '587', 10);
  const resolvedSecure = process.env.SMTP_SECURE === 'true' ? true
    : process.env.SMTP_SECURE === 'false' ? false
    : (secure !== undefined ? !!secure : resolvedPort === 465);

  const config = {
    host: resolvedHost,
    port: resolvedPort,
    secure: resolvedSecure
  };
  // Chỉ thêm xác thực nếu có khai báo đủ tài khoản + mật khẩu — bỏ qua (kết nối ẩn danh) cho relay
  // nội bộ không yêu cầu đăng nhập.
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    config.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
  }
  // Một số relay nội bộ dùng chứng chỉ TLS tự ký — cho phép bỏ qua kiểm tra hợp lệ chứng chỉ khi
  // khai báo rõ ràng (mặc định vẫn kiểm tra bình thường).
  if (process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false') {
    config.tls = { rejectUnauthorized: false };
  }
  return { transporter: nodemailer.createTransport(config), resolvedHost, resolvedPort };
}

// Gửi email tới 1 hoặc nhiều người nhận (gửi riêng từng người để biết chính xác ai thành công/thất
// bại). Trả về { sent, failed, simulated, host, port } — có kèm host/port THỰC đã dùng để gửi (chỉ
// khi simulated:false) để nơi gọi (Nhật ký hệ thống) ghi rõ đã xác nhận gửi tới máy chủ nào, phục vụ
// việc kiểm tra/xác minh thay vì chỉ tin vào việc "đã thử gửi".
async function sendMail({ to, subject, text, html, host, port, secure, from }) {
  const recipients = (Array.isArray(to) ? to : [to]).map(a => (a || '').trim()).filter(Boolean);
  if (recipients.length === 0) return { sent: [], failed: [], simulated: false };

  if (!isConfigured()) {
    return { sent: [], failed: recipients, simulated: true };
  }

  const { transporter, resolvedHost, resolvedPort } = buildTransporter({ host, port, secure });
  const fromAddr = from || process.env.SMTP_FROM || process.env.SMTP_USER || 'no-reply@localhost';

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

module.exports = { sendMail, isConfigured };
