// lib/logCrypto.js — Mã hoá 2 chiều cột IpAddress trong dbo.SystemLogs (Nhật ký hệ thống) bằng
// AES-256-GCM — CÙNG thuật toán/khuôn với lib/emailCrypto.js (mật khẩu SMTP) nhưng khoá TÁCH RIÊNG
// (LOG_ENCRYPTION_KEY, KHÔNG dùng chung EMAIL_ENCRYPTION_KEY) để 2 miền dữ liệu khác nhau (mật khẩu
// SMTP vs. IP truy cập) không cùng lộ nếu 1 trong 2 khoá bị lộ/đổi.
//
// TUỲ CHỌN — không bắt buộc để server khởi động được (khác JWT_SECRET): nếu chưa đặt
// LOG_ENCRYPTION_KEY trong .env, IpAddress vẫn ghi plaintext như trước (KHÔNG chặn ghi log — nhật ký
// hệ thống có giá trị vận hành/điều tra sự cố ngay lúc xảy ra sự cố, không nên vì thiếu 1 biến môi
// trường mà mất khả năng ghi log). db.js in cảnh báo khởi động nếu thiếu, cùng tinh thần cảnh báo
// DB_ENCRYPT đã có.
//
// Chỉ mã hoá IpAddress (không mã hoá FullName/Description) — IP là trường định danh trực tiếp 1
// người/thiết bị rõ ràng nhất trong nhật ký, còn FullName/Description vẫn cần TÌM KIẾM ĐƯỢC khi admin
// tra cứu log (mã hoá cả 2 trường đó sẽ phải giải mã TỪNG DÒNG mới lọc được, không khả thi ở quy mô
// hàng nghìn dòng — xem RETENTION_KEEP ở lib/systemLogStore.js).
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:';

function isEnabled() {
  return !!process.env.LOG_ENCRYPTION_KEY;
}

function getKey() {
  return crypto.createHash('sha256').update(process.env.LOG_ENCRYPTION_KEY).digest();
}

// Mã hoá 1 giá trị IpAddress trước khi ghi CSDL. Trả về plaintext nguyên vẹn nếu tính năng đang tắt
// (chưa đặt khoá) hoặc giá trị rỗng — KHÔNG ném lỗi, để không làm hỏng luồng ghi log (rất thường
// xuyên) chỉ vì thiếu cấu hình tuỳ chọn này.
function encryptLogField(plainText) {
  if (!plainText || !isEnabled()) return plainText || null;
  const key = getKey();
  const iv = crypto.randomBytes(12); // 12 byte là kích thước IV khuyến nghị cho GCM
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Gộp iv+authTag+cipherText thành 1 buffer rồi base64 (thay vì 3 chuỗi hex nối dấu ":" như
  // lib/emailCrypto.js) — GỌN HƠN ĐÁNG KỂ (base64 ~1.33 ký tự/byte so với hex 2 ký tự/byte), cần thiết
  // vì cột IpAddress dùng chung cho cả giá trị hệ thống ("SERVER (Scheduled Job)") lẫn IP/X-Forwarded-For
  // thật, phải vừa trong độ rộng cột SQL sau khi mã hoá (xem sql/schema.sql NVARCHAR(300)).
  const packed = Buffer.concat([iv, authTag, encrypted]).toString('base64');
  return `${PREFIX}${packed}`;
}

// Giải mã 1 giá trị đã lưu — nhận diện được cả dòng log CŨ còn plaintext (ghi trước khi bật
// LOG_ENCRYPTION_KEY, hoặc lúc tính năng đang tắt) nhờ tiền tố "enc:", trả nguyên giá trị nếu không có
// tiền tố đó. KHÔNG BAO GIỜ ném lỗi ra ngoài — 1 dòng log hỏng/không giải mã được không được phép làm
// sập cả màn xem Nhật ký hệ thống.
function decryptLogField(stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored;
  if (!isEnabled()) return '(đã mã hoá — thiếu LOG_ENCRYPTION_KEY để giải mã)';
  try {
    const packed = Buffer.from(stored.slice(PREFIX.length), 'base64');
    const iv = packed.subarray(0, 12);
    const authTag = packed.subarray(12, 28);
    const cipherText = packed.subarray(28);
    const key = getKey();
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    return '(lỗi giải mã)';
  }
}

module.exports = { isEnabled, encryptLogField, decryptLogField };
