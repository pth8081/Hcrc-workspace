// lib/auth.js — Xác thực người dùng thật ở phía server: hash mật khẩu (bcrypt), phát/kiểm tra
// JWT lưu trong cookie httpOnly, và middleware chặn truy cập API khi chưa đăng nhập / không phải
// admin. Trước đây "đăng nhập" chỉ là JS so sánh chuỗi ở trình duyệt — server tin tuyệt đối mọi
// request từ client, khiến GET/POST /api/data không có xác thực gì. Module này là gốc để vá lỗ đó.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'vpdt_token';
const TOKEN_TTL = '8h';
const BCRYPT_ROUNDS = 10;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('Thiếu JWT_SECRET trong .env — bắt buộc phải đặt trước khi chạy server (xem .env.example).');
  }
  return secret;
}

// Chuỗi trông có phải hash bcrypt hay không (luôn bắt đầu $2a$/$2b$/$2y$) — dùng để phân biệt mật
// khẩu CŨ còn ở dạng plaintext (di trú tự động) với mật khẩu ĐÃ hash rồi (bỏ qua, không hash lại).
function isBcryptHash(value) {
  return typeof value === 'string' && /^\$2[aby]\$/.test(value);
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

async function verifyPassword(plain, hashOrPlain) {
  if (!plain || !hashOrPlain) return false;
  if (isBcryptHash(hashOrPlain)) {
    return bcrypt.compare(plain, hashOrPlain);
  }
  // Phòng trường hợp hiếm: bản ghi chưa kịp di trú (xem seedDefaults.js migratePlaintextPasswords)
  // — so sánh thẳng để không khoá user ra khỏi hệ thống, nhưng KHÔNG dùng đường này cho user mới.
  return plain === hashOrPlain;
}

function signToken(user) {
  return jwt.sign(
    { sub: user.username, admin: !!(user.perms && user.perms.admin) },
    getJwtSecret(),
    { expiresIn: TOKEN_TTL }
  );
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== 'false', // mặc định bật (HTTPS) — chỉ tắt khi dev local qua http
    sameSite: 'strict',
    maxAge: 8 * 60 * 60 * 1000
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== 'false',
    sameSite: 'strict'
  });
}

// Chặn mọi request chưa có cookie phiên hợp lệ — gắn req.user = { username, admin } (đã ký bởi
// server, KHÔNG lấy từ dữ liệu client gửi lên) để các route sau dùng làm căn cứ phân quyền thật.
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    const payload = verifyToken(token);
    req.user = { username: payload.sub, admin: !!payload.admin };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Phiên đăng nhập hết hạn hoặc không hợp lệ' });
  }
}

// Dùng SAU requireAuth — chặn ghi vào các collection chỉ admin mới được sửa (users, permGroups,
// cấu hình quy trình, emailConfig...). Dựa vào req.user.admin lấy từ JWT đã ký, không tin field
// "admin" bất kỳ nào client có thể tự gửi kèm trong body.
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.admin) {
    return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới có quyền thực hiện thao tác này' });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  isBcryptHash,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  setAuthCookie,
  clearAuthCookie,
  requireAuth,
  requireAdmin
};
