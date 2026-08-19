// routes/auth.js — Đăng nhập/đăng xuất THẬT ở server: kiểm tra mật khẩu bằng bcrypt, phát cookie
// phiên (JWT, httpOnly) thay vì chỉ so sánh chuỗi ở JS trình duyệt như trước đây.
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { verifyPassword, hashPassword, signToken, setAuthCookie, clearAuthCookie, requireAuth } = require('../lib/auth');
const { recordFailedLogin, resetLoginAttempts, getLockoutRemainingMinutes } = require('../lib/loginAttempts');
const { validatePasswordStrength } = require('../lib/passwordPolicy');
const { HttpError } = require('../lib/httpErrors');

// Không bao giờ trả field mật khẩu ra ngoài, dùng chung cho /login và /me.
function toSafeUser(user) {
  const { pass, password, ...safe } = user;
  return safe;
}

// Chặn dò mật khẩu ồ ạt từ 1 nguồn (IP) — bổ sung cho khoá theo TÀI KHOẢN ở lib/loginAttempts.js (2
// lớp khác nhau: lớp này chặn 1 IP tấn công nhiều tài khoản, lớp kia chặn ai đó kiên trì dò 1 tài
// khoản cụ thể từ nhiều IP/chậm rãi). skipSuccessfulRequests: chỉ tính các lần đăng nhập THẤT BẠI vào
// giới hạn — nhiều người dùng chung 1 máy đăng nhập đúng liên tục không bị vạ lây.
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Bạn đã thử đăng nhập quá nhiều lần từ thiết bị này. Vui lòng thử lại sau ít phút.' }
});

router.post('/login', loginRateLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Thiếu tên đăng nhập hoặc mật khẩu' });
  }

  try {
    const users = (await getAppDataValue('users')) || [];
    const user = users.find(u => u.username === username);

    // Kiểm tra khoá tài khoản TRƯỚC KHI xác minh mật khẩu — tài khoản đã tự lộ diện qua chính hành vi
    // bị dò sai nhiều lần trước đó (không phải thông tin mới bị lộ thêm ở bước này), và không cần tốn
    // công so bcrypt cho 1 lượt thử chắc chắn bị từ chối.
    const remainingLockMinutes = user ? getLockoutRemainingMinutes(user) : null;
    if (remainingLockMinutes !== null) {
      return res.status(429).json({ error: `Tài khoản tạm khóa do đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${remainingLockMinutes} phút.` });
    }

    const ok = user && await verifyPassword(password, user.pass || user.password);
    if (!ok) {
      if (user) {
        await withLockedAppDataValue('users', (collection) => {
          const list = Array.isArray(collection) ? collection : [];
          const idx = list.findIndex(u => u.username === username);
          if (idx !== -1) recordFailedLogin(list[idx]);
          return list;
        });
      }
      return res.status(401).json({ error: 'Tài khoản hoặc mật khẩu không chính xác' });
    }
    // Kiểm tra SAU khi đã xác minh đúng mật khẩu — tránh lộ thông tin "tài khoản này có tồn tại và bị
    // vô hiệu hóa" cho người không biết mật khẩu (trả đúng lỗi sai tài khoản/mật khẩu như bình thường).
    if (user.active === false) {
      return res.status(403).json({ error: 'Tài khoản đã bị vô hiệu hóa — vui lòng liên hệ quản trị viên' });
    }

    // Đăng nhập đúng -> xoá sạch lịch sử đăng nhập sai trước đó (nếu có), không cộng dồn về sau.
    if (user.failedLoginAttempts) {
      await withLockedAppDataValue('users', (collection) => {
        const list = Array.isArray(collection) ? collection : [];
        const idx = list.findIndex(u => u.username === username);
        if (idx !== -1) resetLoginAttempts(list[idx]);
        return list;
      });
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
// Cùng 2 lớp chống dò mật khẩu như /login: rate-limit theo IP (loginRateLimiter) + khoá theo TÀI
// KHOẢN sau nhiều lần sai (lib/loginAttempts.js) — trước đây route này bỏ sót cả 2 lớp, dù đây cũng
// là 1 chỗ cho phép thử mật khẩu lặp lại không giới hạn.
router.post('/verify-password', loginRateLimiter, requireAuth, async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Thiếu mật khẩu' });

  try {
    const username = req.freshUser.username;
    const remainingLockMinutes = getLockoutRemainingMinutes(req.freshUser);
    if (remainingLockMinutes !== null) {
      return res.status(429).json({ error: `Tài khoản tạm khóa do nhập sai mật khẩu quá nhiều lần. Vui lòng thử lại sau ${remainingLockMinutes} phút.` });
    }

    const ok = await verifyPassword(password, req.freshUser.pass || req.freshUser.password);
    if (!ok) {
      await withLockedAppDataValue('users', (collection) => {
        const list = Array.isArray(collection) ? collection : [];
        const idx = list.findIndex(u => u.username === username);
        if (idx !== -1) recordFailedLogin(list[idx]);
        return list;
      });
      return res.json({ ok: false });
    }

    if (req.freshUser.failedLoginAttempts) {
      await withLockedAppDataValue('users', (collection) => {
        const list = Array.isArray(collection) ? collection : [];
        const idx = list.findIndex(u => u.username === username);
        if (idx !== -1) resetLoginAttempts(list[idx]);
        return list;
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/verify-password lỗi:', err.message);
    res.status(500).json({ error: 'Không thể xác thực mật khẩu' });
  }
});

// POST /api/auth/verify-pin — xác thực mã PIN của CHÍNH người đang đăng nhập, dùng cho lớp "xác thực
// trước khi phê duyệt" (approverAuthLevel = PIN) — cùng khuôn /verify-password ở trên (rate-limit theo
// IP + khoá theo tài khoản sau nhiều lần sai, dùng CHUNG bộ đếm lockout với mật khẩu vì cùng mục đích
// chống dò). PIN chưa được admin đặt (pinHash rỗng) -> luôn từ chối, không rơi vào so sánh "undefined".
router.post('/verify-pin', loginRateLimiter, requireAuth, async (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'Thiếu mã PIN' });

  try {
    const username = req.freshUser.username;
    const remainingLockMinutes = getLockoutRemainingMinutes(req.freshUser);
    if (remainingLockMinutes !== null) {
      return res.status(429).json({ error: `Tài khoản tạm khóa do nhập sai quá nhiều lần. Vui lòng thử lại sau ${remainingLockMinutes} phút.` });
    }

    const ok = !!req.freshUser.pinHash && await verifyPassword(pin, req.freshUser.pinHash);
    if (!ok) {
      await withLockedAppDataValue('users', (collection) => {
        const list = Array.isArray(collection) ? collection : [];
        const idx = list.findIndex(u => u.username === username);
        if (idx !== -1) recordFailedLogin(list[idx]);
        return list;
      });
      return res.json({ ok: false });
    }

    if (req.freshUser.failedLoginAttempts) {
      await withLockedAppDataValue('users', (collection) => {
        const list = Array.isArray(collection) ? collection : [];
        const idx = list.findIndex(u => u.username === username);
        if (idx !== -1) resetLoginAttempts(list[idx]);
        return list;
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/verify-pin lỗi:', err.message);
    res.status(500).json({ error: 'Không thể xác thực mã PIN' });
  }
});

// PATCH /api/auth/me — người dùng tự sửa hồ sơ CỦA CHÍNH MÌNH (tên/email/SĐT/mật khẩu). Xác định
// user cần sửa từ req.user.username (lấy từ JWT đã ký), KHÔNG từ bất kỳ id/username nào client gửi
// trong body — nên không thể dùng route này để sửa hồ sơ người khác hay tự cấp quyền/đổi phòng ban
// (chỉ nhận đúng 4 field liệt kê dưới, bỏ qua mọi field khác kể cả nếu client cố gửi kèm perms/admin).
router.patch('/me', requireAuth, async (req, res) => {
  const { name, email, phone, password, dashboardHiddenCards } = req.body || {};

  try {
    let updated;
    // withLockedAppDataValue (thay vì đọc/sửa/ghi rời rạc như trước) — khoá đúng dòng "users" trong
    // lúc đọc-sửa-ghi, tránh mất dữ liệu nếu có request khác (admin sửa quyền người khác, hoặc chính
    // người này tự sửa hồ sơ từ 2 tab) ghi đè "users" gần như đồng thời.
    await withLockedAppDataValue('users', async (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(u => u.username === req.user.username);
      if (idx === -1) throw new HttpError(401, 'Tài khoản không còn tồn tại');

      updated = { ...list[idx] };
      if (typeof name === 'string') updated.name = name;
      if (typeof email === 'string') updated.email = email;
      if (typeof phone === 'string') updated.phone = phone;
      // Danh sách key thẻ Dashboard người dùng đã tự ẩn (Đợt D — chuyển từ localStorage sang lưu
      // server để đồng bộ giữa các thiết bị). Chỉ là 1 mảng string tuỳ ý lưu riêng cho từng người, KHÔNG
      // cấp/ảnh hưởng quyền gì — không cần đối chiếu với danh sách key thật ở client.
      if (Array.isArray(dashboardHiddenCards) && dashboardHiddenCards.every(k => typeof k === 'string')) {
        updated.dashboardHiddenCards = dashboardHiddenCards;
      }
      if (password) {
        const passwordError = validatePasswordStrength(password);
        if (passwordError) throw new HttpError(400, passwordError);
        updated.pass = await hashPassword(password);
        delete updated.password;
        // Tự đổi mật khẩu thành công -> gỡ cờ bắt buộc đổi (nếu có) — đây chính là lối thoát duy nhất
        // khỏi trạng thái mustChangePassword (xem lib/auth.js blockIfMustChangePassword).
        delete updated.mustChangePassword;
      }

      list[idx] = updated;
      return list;
    });

    res.json(toSafeUser(updated));
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('PATCH /api/auth/me lỗi:', err.message);
    res.status(500).json({ error: 'Không thể cập nhật hồ sơ cá nhân' });
  }
});

module.exports = router;
