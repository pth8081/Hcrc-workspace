// lib/auth.js — Xác thực người dùng thật ở phía server: hash mật khẩu (bcrypt), phát/kiểm tra
// JWT lưu trong cookie httpOnly, và middleware chặn truy cập API khi chưa đăng nhập / không phải
// admin. Trước đây "đăng nhập" chỉ là JS so sánh chuỗi ở trình duyệt — server tin tuyệt đối mọi
// request từ client, khiến GET/POST /api/data không có xác thực gì. Module này là gốc để vá lỗ đó.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getAppDataValue } = require('./appData');

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

// Chặn mọi request chưa có cookie phiên hợp lệ. Xác minh xong chữ ký JWT rồi còn tra CƯ TRẠNG THÁI
// HIỆN TẠI của tài khoản trong DB (không chỉ tin token) — vì token có hiệu lực tới 8h
// (TOKEN_TTL), nếu chỉ dựa vào token thì 1 tài khoản admin vừa VÔ HIỆU HÓA (nhân viên nghỉ việc) vẫn
// thao tác được bình thường suốt phiên đang mở cho tới khi token hết hạn — không đúng ý "vô hiệu hóa
// là mất quyền NGAY LẬP TỨC". Gắn req.user = { username, admin } (giữ nguyên shape cũ, dùng khắp nơi),
// req.freshUser = bản ghi user đầy đủ vừa đọc được, và req.allUsers = toàn bộ danh sách users cùng
// lượt đọc — để các route phía sau (create.js/workflow.js/records.js/meetingActions.js) không phải tự
// đọc lại DB thêm 1 lần nữa cho cùng mục đích (trước đây mỗi route tự viết lại y hệt đoạn này).
async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: 'Phiên đăng nhập hết hạn hoặc không hợp lệ' });
  }

  try {
    const users = await getAppDataValue('users');
    const freshUser = (users || []).find(u => u.username === payload.sub);
    if (!freshUser) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });
    if (freshUser.active === false) {
      return res.status(401).json({ error: 'Tài khoản đã bị vô hiệu hóa — vui lòng liên hệ quản trị viên' });
    }

    req.user = { username: freshUser.username, admin: !!freshUser.perms?.admin };
    req.freshUser = freshUser;
    req.allUsers = users || [];
    next();
  } catch (err) {
    console.error('requireAuth: lỗi khi xác minh trạng thái tài khoản:', err.message);
    res.status(500).json({ error: 'Không thể xác minh phiên đăng nhập' });
  }
}

// Dùng SAU requireAuth (cần req.freshUser đã gắn sẵn) — chặn mọi route NGHIỆP VỤ khi tài khoản đang
// bị đánh dấu bắt buộc đổi mật khẩu (mustChangePassword: admin vừa đặt/reset mật khẩu tạm cho user,
// hoặc tài khoản vẫn đang dùng đúng mật khẩu mặc định "123456" từ lúc khởi tạo hệ thống — xem
// seedDefaults.js flagKnownDefaultPasswords()). KHÔNG mount ở routes/auth.js (GET/PATCH /me, /logout)
// — đó chính là lối thoát duy nhất để đổi mật khẩu và gỡ cờ này, chặn luôn ở đó sẽ tự khoá người dùng
// không lối ra. Cũng KHÔNG mount ở routes/systemLog.js — ghi nhật ký (kể cả lúc đang bị buộc đổi mật
// khẩu) không rủi ro gì và có giá trị lưu vết, không cần chặn.
function blockIfMustChangePassword(req, res, next) {
  if (req.freshUser?.mustChangePassword) {
    return res.status(403).json({
      error: 'Bạn cần đổi mật khẩu trước khi tiếp tục sử dụng hệ thống.',
      mustChangePassword: true
    });
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
  blockIfMustChangePassword
};
