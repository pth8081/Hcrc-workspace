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

// Đã có đủ tài khoản SMTP thật để gửi hay chưa — nếu chưa, sendMail() sẽ trả về simulated:true thay
// vì báo lỗi, để hệ thống vẫn chạy bình thường (giống hành vi mô phỏng cũ) cho tới khi được cấu hình.
function isConfigured() {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

function buildTransporter({ host, port, secure }) {
  const resolvedPort = parseInt(port || process.env.SMTP_PORT || '587', 10);
  const resolvedSecure = process.env.SMTP_SECURE === 'true' ? true
    : process.env.SMTP_SECURE === 'false' ? false
    : (secure !== undefined ? !!secure : resolvedPort === 465);

  return nodemailer.createTransport({
    host: host || process.env.SMTP_HOST || 'smtp.gmail.com',
    port: resolvedPort,
    secure: resolvedSecure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

// Gửi email tới 1 hoặc nhiều người nhận (gửi riêng từng người để biết chính xác ai thành công/thất
// bại). Trả về { sent: string[], failed: string[], simulated: boolean }.
async function sendMail({ to, subject, text, html, host, port, secure, from }) {
  const recipients = (Array.isArray(to) ? to : [to]).map(a => (a || '').trim()).filter(Boolean);
  if (recipients.length === 0) return { sent: [], failed: [], simulated: false };

  if (!isConfigured()) {
    return { sent: [], failed: recipients, simulated: true };
  }

  const transporter = buildTransporter({ host, port, secure });
  const fromAddr = from || process.env.SMTP_FROM || process.env.SMTP_USER;

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
  return { sent, failed, simulated: false };
}

module.exports = { sendMail, isConfigured };
