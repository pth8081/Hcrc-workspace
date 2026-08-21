// routes/auth.js — Đăng nhập/đăng xuất THẬT ở server: kiểm tra mật khẩu bằng bcrypt, phát cookie
// phiên (JWT, httpOnly) thay vì chỉ so sánh chuỗi ở JS trình duyệt như trước đây.
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { verifyPassword, hashPassword, validatePin, signToken, setAuthCookie, clearAuthCookie, requireAuth } = require('../lib/auth');
const { recordFailedLogin, resetLoginAttempts, getLockoutRemainingMinutes } = require('../lib/loginAttempts');
const { validatePasswordStrength } = require('../lib/passwordPolicy');
const { HttpError } = require('../lib/httpErrors');
const { issueApprovalGrant, issueApprovalOtp, verifyApprovalOtp } = require('../lib/approvalAuth');
const { getPool, sql } = require('../db');
const { sendMail } = require('../lib/mailer');

// Không bao giờ trả field mật khẩu/PIN (dù đã hash) hay dữ liệu khoá đăng nhập ra ngoài, dùng chung cho
// /login, /me và /change-pin — khớp đúng stripPasswords() ở routes/data.js (trước đây route này bỏ sót
// pinHash/failedLoginAttempts/lockedUntil, chỉ lọc pass/password). Thêm hasPin (boolean, KHÔNG phải hash
// thật) để client biết hiện đã có mã PIN hay chưa mà không cần thấy giá trị — dùng để quyết định hiện ô
// "Mã PIN hiện tại" khi đổi PIN (xem #pfCurrentPinWrap ở index.html).
function toSafeUser(user) {
  const { pass, password, pinHash, failedLoginAttempts, lockedUntil, ...safe } = user;
  return { ...safe, hasPin: !!pinHash };
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

    // Cấp phiếu xác thực phê duyệt ngắn hạn (5 phút) — routes/workflow.js đòi phiếu này trước khi
    // chấp nhận Duyệt cho tài khoản có approverAuthLevel=PASSWORD, xem lib/approvalAuth.js.
    issueApprovalGrant(username);
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

    // Cấp phiếu xác thực phê duyệt ngắn hạn — cùng cơ chế với /verify-password ở trên (approverAuthLevel=PIN).
    issueApprovalGrant(username);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/verify-pin lỗi:', err.message);
    res.status(500).json({ error: 'Không thể xác thực mã PIN' });
  }
});

// POST /api/auth/change-pin — người dùng TỰ đặt/đổi mã PIN phê duyệt của CHÍNH mình (perms.
// approverAuthLevel = 'PIN'). Khác PATCH /api/auth/me (đổi mật khẩu không cần xác nhận mật khẩu cũ, chỉ
// dựa vào phiên đăng nhập đang mở) — PIN là lớp xác thực THỨ HAI trước khi Duyệt, nên bắt buộc gõ đúng
// PIN hiện tại (nếu đã có) mới đổi được sang PIN mới, để không ai lợi dụng phiên trình duyệt đang mở sẵn
// (vd máy dùng chung) đổi PIN người khác mà không biết PIN cũ. Nếu CHƯA từng có PIN (hasPin=false, lần
// đầu thiết lập) thì bỏ qua bước xác nhận PIN cũ — không có gì để xác nhận. Cùng 2 lớp chống dò như
// /verify-pin: rate-limit theo IP + khoá theo tài khoản sau nhiều lần sai PIN hiện tại (dùng CHUNG bộ
// đếm lockout với /login, /verify-password, /verify-pin — cùng mục đích chống dò 1 tài khoản).
router.post('/change-pin', loginRateLimiter, requireAuth, async (req, res) => {
  const { currentPin, newPin } = req.body || {};
  if (!newPin) return res.status(400).json({ error: 'Thiếu mã PIN mới' });

  const pinError = validatePin(String(newPin));
  if (pinError) return res.status(400).json({ error: pinError });

  try {
    const username = req.freshUser.username;
    const hasPin = !!req.freshUser.pinHash;

    if (hasPin) {
      if (!currentPin) return res.status(400).json({ error: 'Vui lòng nhập mã PIN hiện tại' });

      const remainingLockMinutes = getLockoutRemainingMinutes(req.freshUser);
      if (remainingLockMinutes !== null) {
        return res.status(429).json({ error: `Tài khoản tạm khóa do nhập sai quá nhiều lần. Vui lòng thử lại sau ${remainingLockMinutes} phút.` });
      }

      const ok = await verifyPassword(currentPin, req.freshUser.pinHash);
      if (!ok) {
        await withLockedAppDataValue('users', (collection) => {
          const list = Array.isArray(collection) ? collection : [];
          const idx = list.findIndex(u => u.username === username);
          if (idx !== -1) recordFailedLogin(list[idx]);
          return list;
        });
        return res.status(401).json({ error: 'Mã PIN hiện tại không chính xác' });
      }
    }

    const newPinHash = await hashPassword(String(newPin));
    let updated;
    await withLockedAppDataValue('users', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(u => u.username === username);
      if (idx === -1) throw new HttpError(401, 'Tài khoản không còn tồn tại');
      updated = { ...list[idx], pinHash: newPinHash, sessionVersion: (list[idx].sessionVersion || 0) + 1 };
      resetLoginAttempts(updated); // đổi PIN thành công (kể cả sau khi vừa gõ sai vài lần) -> xoá lịch sử sai
      list[idx] = updated;
      return list;
    });

    // Vô hiệu hóa mọi phiên JWT KHÁC đang mở của chính người này (xem lib/auth.js) — cấp ngay 1 token
    // mới khớp sessionVersion vừa tăng cho PHIÊN HIỆN TẠI, để không tự đăng xuất người vừa đổi PIN.
    setAuthCookie(res, signToken(updated));
    res.json(toSafeUser(updated));
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/auth/change-pin lỗi:', err.message);
    res.status(500).json({ error: 'Không thể đổi mã PIN' });
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
        // Vô hiệu hóa mọi phiên JWT KHÁC đang mở của chính người này (xem lib/auth.js signToken/
        // requireAuth) — mất mật khẩu/thiết bị cũ vẫn đăng nhập được vô thời hạn cho tới khi token hết
        // hạn (tối đa 1h, có thể lâu hơn do trượt hạn theo hoạt động) trước khi có sessionVersion này.
        updated.sessionVersion = (updated.sessionVersion || 0) + 1;
      }

      list[idx] = updated;
      return list;
    });

    // Cấp lại token mới khớp sessionVersion vừa tăng cho PHIÊN HIỆN TẠI (nếu có đổi mật khẩu) — để
    // không tự đăng xuất người vừa đổi mật khẩu của chính mình.
    if (password) setAuthCookie(res, signToken(updated));
    res.json(toSafeUser(updated));
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('PATCH /api/auth/me lỗi:', err.message);
    res.status(500).json({ error: 'Không thể cập nhật hồ sơ cá nhân' });
  }
});

// Cấu hình SMTP đọc từ DB.emailConfig — cùng nguồn với routes/email.js (admin cấu hình ở màn Quản trị,
// không tách hàm dùng chung vì routes/email.js không export helper này, xem comment ở đó).
async function getEmailConfig() {
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('k', sql.NVarChar(100), 'emailConfig')
      .query('SELECT DataValue FROM dbo.AppData WHERE DataKey = @k');
    if (result.recordset.length === 0) return {};
    return JSON.parse(result.recordset[0].DataValue) || {};
  } catch (err) {
    console.error('⛔ Không đọc được emailConfig, coi như mặc định (đang bật):', err.message);
    return {};
  }
}

// POST /api/auth/request-approval-otp — sinh mã OTP 6 số MỚI ở SERVER (không phải JS trình duyệt như
// trước) và gửi qua email thật của CHÍNH người đang cần xác thực (approverAuthLevel=OTP_EMAIL), dùng
// chung rate-limit chống dò với /verify-password|/verify-pin.
router.post('/request-approval-otp', loginRateLimiter, requireAuth, async (req, res) => {
  try {
    if (!req.freshUser.email) {
      return res.status(400).json({ error: 'Tài khoản chưa có email, không thể gửi mã OTP' });
    }
    const code = issueApprovalOtp(req.freshUser.username);
    const emailConfig = await getEmailConfig();
    if (emailConfig.enabled === false) {
      return res.json({ ok: true, simulated: true });
    }
    await sendMail({
      to: [req.freshUser.email],
      subject: '[VPDT] Mã xác thực phê duyệt',
      text: `Mã OTP của bạn: ${code} (chỉ dùng 1 lần cho lượt duyệt này, hết hạn sau 5 phút)`,
      host: emailConfig.smtpHost, port: emailConfig.smtpPort, secure: emailConfig.smtpSecure,
      from: emailConfig.senderEmail
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/request-approval-otp lỗi:', err.message);
    res.status(500).json({ error: 'Không thể gửi mã OTP' });
  }
});

// POST /api/auth/verify-approval-otp — xác thực mã OTP đã gửi ở trên, cấp phiếu Duyệt nếu đúng (xem
// lib/approvalAuth.js verifyApprovalOtp() — đã tự cấp phiếu bên trong khi khớp mã).
router.post('/verify-approval-otp', loginRateLimiter, requireAuth, async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Thiếu mã OTP' });
  const ok = verifyApprovalOtp(req.freshUser.username, code);
  res.json({ ok });
});

module.exports = router;
