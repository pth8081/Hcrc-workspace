// lib/totp.js — Xác thực 2 lớp (TOTP, RFC 6238 — Google Authenticator/Microsoft Authenticator...) BẮT
// BUỘC cho tài khoản có quyền admin. Yêu cầu người dùng: "account có quyền admin bắt buộc phải xác thực
// hai yếu tố". Chỉ áp dụng cho admin — KHÔNG dùng cho tài khoản thường, và KHÔNG thay thế WebAuthn (vân
// tay/Face ID, vẫn là 1 phương thức đăng nhập độc lập) hay OTP_EMAIL/PIN/WEBAUTHN (vẫn là 4 mức
// approverAuthLevel độc lập cho bước Duyệt) — đây là lớp MỚI, RIÊNG, chỉ gác cổng đăng nhập của admin.
//
// Bí mật TOTP (totpSecretEnc trên bản ghi user) mã hoá bằng lib/emailCrypto.js (AES-256-GCM, cùng khoá
// EMAIL_ENCRYPTION_KEY đã có sẵn — không cần thêm biến môi trường mới). Mã khôi phục (backup codes) —
// 10 mã, mỗi mã dùng ĐÚNG 1 LẦN cho tình huống mất điện thoại — lưu dạng HASH (bcrypt, dùng chung
// hashPassword/verifyPassword ở lib/auth.js, khớp cách PIN được lưu), KHÔNG lưu plaintext, KHÔNG thể
// hiển thị lại sau khi đã tạo (đúng khuôn GitHub/Google/AWS).
//
// 2 Map trong bộ nhớ tiến trình (không cần bền, khớp khuôn lib/approvalAuth.js — hết hạn nhanh, mất khi
// restart chỉ khiến người dùng phải thử lại, không phải lỗ hổng bảo mật):
//   - pendingLogins: "đã xác minh đúng mật khẩu, đang chờ nhập mã TOTP" — bước 1 của luồng đăng nhập 2
//     bước cho admin ĐÃ bật TOTP. Đây là khác biệt cốt lõi so với mustChangePassword (vốn cấp cookie
//     phiên NGAY rồi mới chặn ở các route nghiệp vụ phía sau): nếu cấp cookie ngay sau khi chỉ đúng mật
//     khẩu, mật khẩu bị lộ 1 mình vẫn đủ để có phiên hoạt động trên MỌI route chưa bị chặn — làm mất hết
//     ý nghĩa "bắt buộc 2 yếu tố". Phiên đăng nhập thật CHỈ được cấp sau khi qua được bước 2.
//   - pendingSetups: bí mật MỚI sinh ra khi bắt đầu thiết lập TOTP, CHƯA lưu vào bản ghi user — chỉ lưu
//     thật (kèm bật totpEnabled) sau khi người dùng xác minh đúng 1 mã hiện tại từ app Authenticator,
//     chứng minh họ đã quét/nhập đúng mã bí mật vào app trước khi hệ thống khoá cứng yêu cầu 2 lớp.
const { authenticator } = require('otplib');
const crypto = require('crypto');

const ISSUER = 'HCRC Workspace';

const PENDING_LOGIN_TTL_MS = 5 * 60 * 1000;
const PENDING_SETUP_TTL_MS = 10 * 60 * 1000; // dài hơn login: cần thời gian mở app, quét QR, gõ mã

const pendingLogins = new Map(); // username -> expiresAt (ms)
const pendingSetups = new Map(); // username -> { secret, expiresAt }

function generateSecret() {
  return authenticator.generateSecret();
}

function buildOtpauthUri(username, secret) {
  return authenticator.keyuri(username, ISSUER, secret);
}

function verifyCode(code, secret) {
  if (!code || !secret) return false;
  try {
    return authenticator.verify({ token: String(code).trim(), secret });
  } catch (err) {
    return false;
  }
}

// Mã khôi phục dạng số (khớp quy ước crypto.randomInt() đã dùng cho OTP phê duyệt ở lib/approvalAuth.js
// — KHÔNG dùng Math.random(), không phải bộ sinh dành cho mật mã). Định dạng XXXX-XXXX cho dễ đọc/chép
// tay; dấu gạch ngang bị bỏ qua khi so khớp (xem normalizeBackupCode bên dưới).
function generateBackupCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    let digits = '';
    for (let j = 0; j < 8; j++) digits += crypto.randomInt(0, 10);
    codes.push(`${digits.slice(0, 4)}-${digits.slice(4)}`);
  }
  return codes;
}

function normalizeBackupCode(input) {
  return String(input || '').replace(/[^0-9]/g, '');
}

async function hashBackupCodes(codes) {
  const { hashPassword } = require('./auth'); // require trễ — tránh vòng lặp require với lib/auth.js
  return Promise.all(codes.map(c => hashPassword(normalizeBackupCode(c))));
}

// Trả về INDEX của mã khớp trong hashedCodes (để nơi gọi tự xoá đúng phần tử đó — dùng 1 lần), hoặc -1
// nếu không khớp mã nào.
async function verifyBackupCode(code, hashedCodes) {
  const { verifyPassword } = require('./auth');
  const normalized = normalizeBackupCode(code);
  if (!normalized || !Array.isArray(hashedCodes)) return -1;
  for (let i = 0; i < hashedCodes.length; i++) {
    if (hashedCodes[i] && await verifyPassword(normalized, hashedCodes[i])) return i;
  }
  return -1;
}

function issuePendingTotpLogin(username) {
  pendingLogins.set(username, Date.now() + PENDING_LOGIN_TTL_MS);
}

function hasPendingTotpLogin(username) {
  const expiresAt = pendingLogins.get(username);
  return !!expiresAt && expiresAt > Date.now();
}

function consumePendingTotpLogin(username) {
  pendingLogins.delete(username);
}

function issuePendingTotpSetup(username, secret) {
  pendingSetups.set(username, { secret, expiresAt: Date.now() + PENDING_SETUP_TTL_MS });
}

// Không xoá khi gọi (khác consumePendingTotpLogin) — người dùng có thể gõ sai mã vài lần trong lúc thiết
// lập (không phải chuyện quá 1 lần thử như đăng nhập) mà không cần lấy lại mã QR mới mỗi lần gõ sai.
function getPendingTotpSetupSecret(username) {
  const entry = pendingSetups.get(username);
  if (!entry || entry.expiresAt <= Date.now()) {
    pendingSetups.delete(username);
    return null;
  }
  return entry.secret;
}

function consumePendingTotpSetup(username) {
  pendingSetups.delete(username);
}

module.exports = {
  generateSecret,
  buildOtpauthUri,
  verifyCode,
  generateBackupCodes,
  hashBackupCodes,
  verifyBackupCode,
  issuePendingTotpLogin,
  hasPendingTotpLogin,
  consumePendingTotpLogin,
  issuePendingTotpSetup,
  getPendingTotpSetupSecret,
  consumePendingTotpSetup
};
