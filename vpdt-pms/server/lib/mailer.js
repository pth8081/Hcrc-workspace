// lib/mailer.js — Gửi email THẬT qua SMTP (nodemailer), dùng chung cho cả routes/email.js (gọi từ
// frontend qua fetch) lẫn jobs/contractExpiryReminder.js (chạy định kỳ phía server).
//
// PHÂN CHIA CẤU HÌNH — MỖI PHẦN CHỈ CÓ 1 NGUỒN DUY NHẤT, KHÔNG CHỒNG CHÉO ƯU TIÊN:
// - Host/Port/Kiểu mã hoá/Email người gửi/Bật-tắt gửi mail/Tài khoản đăng nhập SMTP: cấu hình DUY
//   NHẤT ở màn Quản trị > Cấu Hình Email (DB.emailConfig) — admin đổi trực tiếp trên web, không cần
//   đụng server. Hàm sendMail() bên dưới LUÔN nhận các giá trị này qua tham số do nơi gọi truyền vào
//   (đã tự giải mã mật khẩu SMTP trước khi gọi tới đây, xem lib/emailCrypto.js), không tự đọc DB.
// - .env SMTP_USER/SMTP_PASS/SMTP_TLS_REJECT_UNAUTHORIZED: chỉ còn là ĐƯỜNG LÙI cho các máy chủ đã
//   deploy từ trước (chưa cấu hình lại tài khoản qua web) — nơi gọi (routes/email.js/
//   jobs/contractExpiryReminder.js) chỉ truyền user/pass rỗng khi DB.emailConfig chưa có tài khoản
//   riêng, sendMail() bên dưới mới rơi về .env. Để trống CẢ 3 nguồn (DB lẫn .env) = máy chủ SMTP
//   không yêu cầu xác thực (kết nối ẩn danh).
require('dotenv').config();
const nodemailer = require('nodemailer');

// Server (qua .env, đường lùi cũ) hoặc DB.emailConfig (qua tham số truyền vào) có đang cấu hình tài
// khoản/mật khẩu đăng nhập SMTP hay không — dùng để hiển thị TRẠNG THÁI (không nhạy cảm, không lộ giá
// trị thật) cho admin biết server đang chạy ở chế độ có xác thực hay ẩn danh.
function hasAuthConfigured(user, pass) {
  if (user && pass) return true;
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

// 3 kiểu mã hoá (đặt tên khớp các mail client quen thuộc — Outlook/Thunderbird) thay cho 1 boolean
// "secure" mập mờ trước đây (chỉ phân biệt được "mã hoá ngay từ đầu" có/không, còn "TLS nâng cấp sau"
// (STARTTLS) hay "không mã hoá" đều bị coi là 1 nhóm, và STARTTLS thất bại thì nodemailer ÂM THẦM rơi
// về gửi thuần văn bản thay vì báo lỗi — admin tưởng đã mã hoá nhưng thực ra không):
// - NONE     -> secure:false, ignoreTLS:true  (ép KHÔNG mã hoá dù server có chào STARTTLS)
// - STARTTLS -> secure:false, requireTLS:true (kết nối thường rồi BẮT BUỘC nâng cấp mã hoá, lỗi nếu
//               server không hỗ trợ — không rơi về thuần văn bản như mặc định nodemailer trước đây)
// - SSL      -> secure:true                   (mã hoá ngay từ đầu, kiểu cũ "implicit TLS")
function encryptionToTransportOptions(encryption) {
  switch (encryption) {
    case 'NONE': return { secure: false, ignoreTLS: true };
    case 'SSL': return { secure: true };
    case 'STARTTLS':
    default: return { secure: false, requireTLS: true };
  }
}

// Cấu hình lưu TRƯỚC khi đổi sang 3 nút Không mã hoá/TLS/SSL chỉ có "smtpSecure" (boolean 3 trạng
// thái: true/false/null=tự động theo port, xem defaults.js bản cũ) — DB.emailConfig của các máy chủ
// đã deploy từ trước sẽ KHÔNG tự có field "smtpEncryption" mới (seedDefaults.js chỉ seed field còn
// thiếu cho key HOÀN TOÀN CHƯA TỪNG TỒN TẠI, không vá field lẻ vào bản ghi đã có). Suy ra kiểu mã hoá
// tương đương để hành vi cũ vẫn chạy đúng, không bắt admin phải vào lưu lại thủ công mới dùng được.
function resolveEncryption(emailConfig) {
  if (emailConfig?.smtpEncryption) return emailConfig.smtpEncryption;
  const { smtpSecure, smtpPort } = emailConfig || {};
  if (smtpSecure === true) return 'SSL';
  if (smtpSecure === false) return 'STARTTLS';
  return (parseInt(smtpPort, 10) || 587) === 465 ? 'SSL' : 'STARTTLS';
}

function buildTransporter({ host, port, encryption, user, pass }) {
  const resolvedPort = parseInt(port, 10) || 587;

  const config = {
    host,
    port: resolvedPort,
    ...encryptionToTransportOptions(encryption)
  };
  // Chỉ thêm xác thực nếu có khai báo đủ tài khoản + mật khẩu (DB.emailConfig, đã giải mã sẵn ở nơi
  // gọi) — rơi về .env (đường lùi cũ) nếu nơi gọi không truyền, bỏ qua hẳn (kết nối ẩn danh) nếu cả 2
  // nguồn đều không có.
  const resolvedUser = user || process.env.SMTP_USER;
  const resolvedPass = pass || process.env.SMTP_PASS;
  if (resolvedUser && resolvedPass) {
    config.auth = { user: resolvedUser, pass: resolvedPass };
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
async function sendMail({ to, subject, text, html, host, port, encryption, user, pass, from }) {
  const recipients = (Array.isArray(to) ? to : [to]).map(a => (a || '').trim()).filter(Boolean);
  if (recipients.length === 0) return { sent: [], failed: [], simulated: false };

  // Chưa nhập SMTP Server ở màn Cấu Hình Email -> chưa thể gửi thật, mô phỏng như cũ.
  if (!host) {
    return { sent: [], failed: recipients, simulated: true };
  }

  const { transporter, resolvedHost, resolvedPort } = buildTransporter({ host, port, encryption, user, pass });
  const fromAddr = from || user || process.env.SMTP_USER || 'no-reply@localhost';

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

module.exports = { sendMail, hasAuthConfigured, resolveEncryption };
