// lib/externalAuth.js — API key cấp cho ứng dụng NGOÀI hệ thống để xác thực (verify) tài khoản/mật
// khẩu người dùng HCRC Workspace qua POST /api/external/verify-credentials (routes/externalAuthVerify.js)
// — KHÔNG cấp phiên đăng nhập (không trả cookie/JWT), chỉ trả lời đúng/sai cặp tài khoản+mật khẩu, dùng
// cho ứng dụng khác muốn "đăng nhập hộ" bằng đúng tài khoản HCRC mà không tự lưu mật khẩu người dùng.
//
// Key thật (dạng "hcrc_" + 64 ký tự hex ngẫu nhiên, sinh bằng crypto.randomBytes — không đoán được) chỉ
// hiển thị đúng 1 LẦN lúc admin tạo (xem routes/externalAuthAdmin.js) — từ đó DB chỉ lưu bcrypt hash
// (cùng thuật toán + rounds lib/auth.js dùng cho mật khẩu người dùng), không có cách nào đọc lại được
// key thật kể cả có toàn quyền truy cập DB.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const KEY_PREFIX = 'hcrc_';
const KEY_RANDOM_BYTES = 32; // -> 64 ký tự hex, cộng KEY_PREFIX
const BCRYPT_ROUNDS = 10; // khớp lib/auth.js BCRYPT_ROUNDS — cùng 1 chuẩn cho mọi bí mật dạng bcrypt trong hệ thống

function generateApiKey() {
  return KEY_PREFIX + crypto.randomBytes(KEY_RANDOM_BYTES).toString('hex');
}

// 12 ký tự đầu của key thật — đủ để admin phân biệt đúng key nào trong danh sách (hiển thị dạng
// "hcrc_ab12cd34…"), KHÔNG đủ để dò ngược ra key thật (còn thiếu 52 ký tự ngẫu nhiên).
function keyDisplayPrefix(rawKey) {
  return String(rawKey || '').slice(0, 12);
}

async function hashApiKey(rawKey) {
  return bcrypt.hash(rawKey, BCRYPT_ROUNDS);
}

async function verifyApiKey(rawKey, keyHash) {
  if (!rawKey || !keyHash) return false;
  return bcrypt.compare(rawKey, keyHash);
}

// Tách key khỏi header Authorization: chuẩn "Bearer <key>", nhưng cũng chấp nhận gửi thẳng key không
// kèm tiền tố "Bearer " (một số hệ thống tích hợp ngoài không tự dựng được header chuẩn) — cho tiện
// tích hợp, không ảnh hưởng độ an toàn (vẫn phải khớp đúng bcrypt hash ở bước xác minh).
function extractBearerToken(authorizationHeader) {
  const raw = String(authorizationHeader || '').trim();
  if (!raw) return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw);
  return m ? m[1].trim() : raw;
}

module.exports = { KEY_PREFIX, generateApiKey, keyDisplayPrefix, hashApiKey, verifyApiKey, extractBearerToken };
