// routes/auth.js — Đăng nhập/đăng xuất THẬT ở server: kiểm tra mật khẩu bằng bcrypt, phát cookie
// phiên (JWT, httpOnly) thay vì chỉ so sánh chuỗi ở JS trình duyệt như trước đây.
const express = require('express');
const router = express.Router();
const { getAppDataValue, setAppDataValue } = require('../lib/appData');
const { verifyPassword, hashPassword, signToken, setAuthCookie, clearAuthCookie, requireAuth } = require('../lib/auth');

// Không bao giờ trả field mật khẩu ra ngoài, dùng chung cho /login và /me.
function toSafeUser(user) {
  const { pass, password, ...safe } = user;
  return safe;
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Thiếu tên đăng nhập hoặc mật khẩu' });
  }

  try {
    const users = (await getAppDataValue('users')) || [];
    const user = users.find(u => u.username === username);
    const ok = user && await verifyPassword(password, user.pass || user.password);
    if (!ok) {
      return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không chính xác' });
    }
    // Kiểm tra SAU khi đã xác minh đúng mật khẩu — tránh lộ thông tin "tài khoản này có tồn tại và bị
    // vô hiệu hóa" cho người không biết mật khẩu (trả đúng lỗi sai tài khoản/mật khẩu như bình thường).
    if (user.active === false) {
      return res.status(403).json({ error: 'Tài khoản đã bị vô hiệu hóa — vui lòng liên hệ quản trị viên' });
    }

    const token = signToken(user);
    setAuthCookie(res, token);
    res.json(toSafeUser(user));
  } catch (err) {
    console.error('POST /api/auth/login lỗi:', err.message);
    res.status(500).json({ error: 'Không thể đăng nhập, vui lòng thử lại' });
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me — khôi phục phiên khi tải lại trang (đã có cookie hợp lệ từ trước). requireAuth
// đã tự tra cứu + xác minh user hiện tại (kể cả active) và gắn sẵn vào req.freshUser.
router.get('/me', requireAuth, async (req, res) => {
  res.json(toSafeUser(req.freshUser));
});

// POST /api/auth/verify-password — xác thực LẠI mật khẩu của CHÍNH người đang đăng nhập, dùng cho
// lớp "xác thực trước khi phê duyệt" (approverAuthLevel = PASSWORD). Trước đây so sánh thẳng ở JS
// client (currentUser.pass) — không có giá trị bảo mật thật vì có thể sửa bằng DevTools.
router.post('/verify-password', requireAuth, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Thiếu mật khẩu' });

  try {
    const user = req.freshUser;
    const ok = await verifyPassword(password, user.pass || user.password);
    res.json({ ok: !!ok });
  } catch (err) {
    console.error('POST /api/auth/verify-password lỗi:', err.message);
    res.status(500).json({ error: 'Không thể xác thực mật khẩu' });
  }
});

// PATCH /api/auth/me — người dùng tự sửa hồ sơ CỦA CHÍNH MÌNH (tên/email/SĐT/mật khẩu). Xác định
// user cần sửa từ req.user.username (lấy từ JWT đã ký), KHÔNG từ bất kỳ id/username nào client gửi
// trong body — nên không thể dùng route này để sửa hồ sơ người khác hay tự cấp quyền/đổi phòng ban
// (chỉ nhận đúng 4 field liệt kê dưới, bỏ qua mọi field khác kể cả nếu client cố gửi kèm perms/admin).
router.patch('/me', requireAuth, async (req, res) => {
  const { name, email, phone, password } = req.body || {};

  try {
    const users = (await getAppDataValue('users')) || [];
    const idx = users.findIndex(u => u.username === req.user.username);
    if (idx === -1) return res.status(401).json({ error: 'Tài khoản không còn tồn tại' });

    const updated = { ...users[idx] };
    if (typeof name === 'string') updated.name = name;
    if (typeof email === 'string') updated.email = email;
    if (typeof phone === 'string') updated.phone = phone;
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
      updated.pass = await hashPassword(password);
      delete updated.password;
    }

    users[idx] = updated;
    await setAppDataValue('users', users);
    res.json(toSafeUser(updated));
  } catch (err) {
    console.error('PATCH /api/auth/me lỗi:', err.message);
    res.status(500).json({ error: 'Không thể cập nhật hồ sơ cá nhân' });
  }
});

module.exports = router;
