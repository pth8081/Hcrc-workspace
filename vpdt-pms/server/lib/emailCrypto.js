// lib/emailCrypto.js — Mã hoá/giải mã mật khẩu đăng nhập SMTP lưu trong DB.emailConfig. Trước đây tài
// khoản/mật khẩu SMTP CHỈ đọc được từ .env (xem lib/mailer.js bản cũ) — lý do là GET /api/data trả
// nguyên "emailConfig" cho MỌI người đã đăng nhập (không riêng admin, xem routes/data.js), nên không
// thể lưu mật khẩu SMTP dạng thường vào đó. Giờ admin muốn tự cấu hình tài khoản ngay trên web (không
// cần đụng .env/khởi động lại server) — mã hoá 2 chiều (không phải hash 1 chiều như mật khẩu đăng nhập,
// vì phải LẤY LẠI được giá trị thật để xác thực với máy chủ SMTP) bằng AES-256-GCM, khoá mã hoá tách
// riêng khỏi CSDL (chỉ có trong .env, khác máy chủ mới giải mã được dù có trộm được CSDL). Giá trị đã
// mã hoá (smtpPassEnc) vẫn bị lọc khỏi MỌI response đọc (xem routes/data.js sanitizeEmailConfig()) —
// mã hoá là lớp phòng thủ thứ 2, không thay thế việc không lộ ra ngoài.
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

function getKey() {
  const raw = process.env.EMAIL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('Thiếu EMAIL_ENCRYPTION_KEY trong .env — bắt buộc phải đặt trước khi cấu hình mật khẩu SMTP trên web (xem .env.example).');
  }
  // Chấp nhận chuỗi bất kỳ (không bắt buộc đúng 32 byte hex) — băm SHA-256 ra đúng 32 byte làm khoá
  // AES-256, tiện cho admin tự đặt 1 chuỗi ngẫu nhiên dài mà không cần tính đúng độ dài hex.
  return crypto.createHash('sha256').update(raw).digest();
}

// Trả về 1 chuỗi duy nhất "iv:authTag:cipherText" (hex, phân tách bằng dấu ":") để lưu thẳng vào 1
// field JSON string trong DB.emailConfig.smtpPassEnc — không cần thêm cột/bảng riêng.
function encryptSecret(plainText) {
  if (!plainText) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12); // 12 byte là kích thước IV khuyến nghị cho GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(packed) {
  if (!packed) return null;
  const parts = String(packed).split(':');
  if (parts.length !== 3) return null; // dữ liệu hỏng/không đúng định dạng -> coi như chưa cấu hình
  const [ivHex, authTagHex, cipherHex] = parts;
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encryptSecret, decryptSecret };
