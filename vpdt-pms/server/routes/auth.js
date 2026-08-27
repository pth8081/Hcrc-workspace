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
const { isCaptchaEnabled, verifyCaptcha } = require('../lib/captcha');
const webauthn = require('../lib/webauthn');
const { getPool, sql } = require('../db');
const { sendMail, resolveEncryption } = require('../lib/mailer');
const { decryptSecret } = require('../lib/emailCrypto');
const { insertSystemLog } = require('../lib/systemLogStore');

// Ghi nhật ký hệ thống cho các sự kiện đăng nhập THẤT BẠI/khoá tài khoản — trước đây hoàn toàn không
// có dòng log nào cho các sự kiện này (chỉ LOGIN_SUCCESS được ghi, từ client sau khi đăng nhập xong,
// xem logSystemAction() ở public/index.html), nên admin xem "Nhật ký hệ thống" không thấy DẤU VẾT gì
// của 1 cuộc dò mật khẩu (kể cả khi đủ để kích hoạt khoá tạm 15 phút). Không thể dùng logSystemAction()
// phía client cho các sự kiện này vì POST /api/log yêu cầu ĐÃ đăng nhập (requireAuth) — lúc đang thất
// bại đăng nhập thì chưa có phiên hợp lệ để gọi qua đó, phải ghi thẳng ở server. username ghi lại là
// TÊN ĐĂNG NHẬP người dùng vừa nhập (chưa xác thực được danh tính thật — khác mọi dòng log khác trong
// hệ thống vốn luôn lấy từ req.freshUser đã xác thực), nhưng vẫn cần thiết để admin biết tài khoản nào
// đang bị nhắm tới. Không await ở nơi gọi (fire-and-forget .catch) — lỗi ghi log không được phép làm
// hỏng phản hồi đăng nhập thật.
function logAuthFailure(req, { username, fullName, actionType, description }) {
  insertSystemLog({
    username: username || 'unknown', fullName: fullName || username || 'unknown', ipAddress: req.ip,
    module: 'AUTH', actionType, targetObject: username || '', description, status: 'FAILURE'
  }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (đăng nhập thất bại):', e.message));
}

// Không bao giờ trả field mật khẩu/PIN (dù đã hash) hay dữ liệu khoá đăng nhập ra ngoài, dùng chung cho
// /login, /me và /change-pin — khớp đúng stripPasswords() ở routes/data.js (trước đây route này bỏ sót
// pinHash/failedLoginAttempts/lockedUntil, chỉ lọc pass/password). Thêm hasPin (boolean, KHÔNG phải hash
// thật) để client biết hiện đã có mã PIN hay chưa mà không cần thấy giá trị — dùng để quyết định hiện ô
// "Mã PIN hiện tại" khi đổi PIN (xem #pfCurrentPinWrap ở index.html).
// webauthnCredentials (publicKey/counter) và webauthnUserId cũng không cần lộ ra ngoài — thay bằng
// webauthnDeviceCount (chỉ 1 số) để client biết đã đăng ký vân tay hay chưa; danh sách chi tiết thiết
// bị (id/tên/ngày tạo, KHÔNG kèm publicKey/counter) lấy riêng qua GET /webauthn/credentials bên dưới.
function toSafeUser(user) {
  const { pass, password, pinHash, failedLoginAttempts, lockedUntil, webauthnCredentials, webauthnUserId, ...safe } = user;
  return { ...safe, hasPin: !!pinHash, webauthnDeviceCount: (webauthnCredentials || []).length };
}

// Cảnh báo 1 LẦN/tiến trình (không log lại mỗi lượt đăng nhập, tránh rác log) khi phát hiện dấu hiệu
// cookie phiên vừa cấp ở trên CÓ THỂ bị trình duyệt ÂM THẦM từ chối lưu lại: setAuthCookie() mặc định
// đặt cờ Secure (COOKIE_SECURE=true, bắt buộc chỉ gửi qua HTTPS — xem lib/auth.js), nhưng nếu request
// đăng nhập này lại tới qua HTTP thuần (req.secure=false, đã tôn trọng đúng cấu hình 'trust proxy' nếu
// deploy sau Nginx — xem mục 9b/TRUST_PROXY ở server.js), trình duyệt sẽ không lưu cookie dù server trả
// về 200 "đăng nhập thành công" — người dùng tưởng đã vào được nhưng lần tải lại trang/thao tác kế tiếp
// lập tức bị coi như CHƯA đăng nhập, đúng triệu chứng "thao tác đang thoát phiên phải đăng nhập lại"
// khó hiểu đã gặp trong thực tế. Đây là nguyên nhân phổ biến nhất (xem cảnh báo cùng nội dung ở mục 6/
// 9b HUONG_DAN_DEPLOY_UBUNTU.md) nên chủ động log ngay tại đây để admin thấy ngay trong `pm2 logs` thay
// vì phải tự suy đoán từ báo cáo mơ hồ của người dùng.
let warnedInsecureCookieOnce = false;
function warnIfCookieLikelyNotPersisted(req) {
  if (warnedInsecureCookieOnce) return;
  if (process.env.COOKIE_SECURE === 'false') return; // đã chủ động tắt Secure — không áp dụng
  if (req.secure) return; // đang qua HTTPS thật (hoặc Nginx + trust proxy đúng) — không có gì bất thường
  warnedInsecureCookieOnce = true;
  console.warn('⚠️  Đăng nhập vừa tới qua kết nối KHÔNG an toàn (http://) trong khi COOKIE_SECURE đang bắt buộc HTTPS (mặc định true) — trình duyệt sẽ ÂM THẦM KHÔNG lưu cookie phiên đăng nhập. Người dùng sẽ tưởng đăng nhập thành công nhưng bị coi như chưa đăng nhập ngay ở lần tải lại trang/thao tác tiếp theo. Xem mục 9b HUONG_DAN_DEPLOY_UBUNTU.md để bật HTTPS qua Nginx, hoặc tạm đặt COOKIE_SECURE=false trong .env nếu đang chạy thử trong LAN kín.');
}

// Chặn dò mật khẩu ồ ạt từ 1 nguồn (IP) — bổ sung cho khoá theo TÀI KHOẢN ở lib/loginAttempts.js (2
// lớp khác nhau: lớp này chặn 1 IP tấn công nhiều tài khoản, lớp kia chặn ai đó kiên trì dò 1 tài
// khoản cụ thể từ nhiều IP/chậm rãi). skipSuccessfulRequests: chỉ tính các lần đăng nhập THẤT BẠI vào
// giới hạn — nhiều người dùng chung 1 máy đăng nhập đúng liên tục không bị vạ lây.
// LƯU Ý (phát hiện qua load test 500 user đồng thời, tháng 8/2026): express-rate-limit tăng bộ đếm
// NGAY khi request tới, chỉ trừ lại (nhờ skipSuccessfulRequests) SAU KHI response hoàn tất — nên khi
// nhiều người dùng THẬT SỰ khác nhau (mật khẩu đúng, không phải tấn công) cùng đăng nhập gần như đồng
// thời từ CÙNG 1 địa chỉ IP (rất phổ biến: cả văn phòng ra Internet qua 1 NAT/proxy chung, ví dụ giờ
// 8h sáng), bộ đếm có thể vượt ngưỡng trước khi các lần đăng nhập trước đó kịp được trừ lại — và một
// khi đã vượt, MỌI lần đăng nhập tiếp theo từ IP đó bị chặn 429 trong suốt cả khung 15 phút, kể cả khi
// dùng đúng mật khẩu. Với ngưỡng cũ (20) điều này xảy ra chỉ với vài chục người dùng chung IP. Nâng lên
// đủ cao để chịu được cả công ty (nhiều trăm người) cùng IP đăng nhập dồn dập mà không tự khoá nhau —
// lớp chống dò mật khẩu THẬT SỰ vẫn là khoá theo tài khoản ở lib/loginAttempts.js (khoá sau 5 lần sai
// LIÊN TỤC, không phụ thuộc IP), ngưỡng ở đây chỉ cần đủ để chặn lũ quét/DoS thô, không cần thấp.
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // Chỉnh được qua .env (LOGIN_RATE_LIMIT_MAX) không cần sửa code — công ty đông người dùng chung 1 IP
  // hơn (nhiều chi nhánh cùng NAT, hoặc muốn siết chặt hơn) có thể tự đặt lại mà không cần deploy lại.
  limit: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '2000', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Bạn đã thử đăng nhập quá nhiều lần từ thiết bị này. Vui lòng thử lại sau ít phút.' }
});

router.post('/login', loginRateLimiter, async (req, res) => {
  const { username, password, captchaId, captchaAnswer } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Thiếu tên đăng nhập hoặc mật khẩu' });
  }

  // Chỉ áp dụng khi đã bật CAPTCHA_ENABLED=true (.env) — xem lib/captcha.js. Kiểm tra trước cả bước
  // tra tài khoản/khoá đăng nhập bên dưới vì đây là lớp chặn bot RẺ NHẤT (không tốn DB/bcrypt).
  if (isCaptchaEnabled()) {
    if (!verifyCaptcha(captchaId, captchaAnswer)) {
      logAuthFailure(req, { username, actionType: 'CAPTCHA_FAILED', description: 'Nhập sai/hết hạn mã xác nhận CAPTCHA lúc đăng nhập' });
      return res.status(400).json({ error: 'Mã xác nhận không đúng hoặc đã hết hạn, vui lòng thử lại.' });
    }
  }

  try {
    const users = (await getAppDataValue('users')) || [];
    const user = users.find(u => u.username === username);

    // Kiểm tra khoá tài khoản TRƯỚC KHI xác minh mật khẩu — tài khoản đã tự lộ diện qua chính hành vi
    // bị dò sai nhiều lần trước đó (không phải thông tin mới bị lộ thêm ở bước này), và không cần tốn
    // công so bcrypt cho 1 lượt thử chắc chắn bị từ chối.
    const remainingLockMinutes = user ? getLockoutRemainingMinutes(user) : null;
    if (remainingLockMinutes !== null) {
      logAuthFailure(req, {
        username, fullName: user.name, actionType: 'LOGIN_BLOCKED_LOCKED',
        description: `Thử đăng nhập khi tài khoản đang bị khoá tạm thời (còn ${remainingLockMinutes} phút)`
      });
      return res.status(429).json({ error: `Tài khoản tạm khóa do đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${remainingLockMinutes} phút.` });
    }

    const ok = user && await verifyPassword(password, user.pass || user.password);
    if (!ok) {
      if (user) {
        let justLocked = false;
        await withLockedAppDataValue('users', (collection) => {
          const list = Array.isArray(collection) ? collection : [];
          const idx = list.findIndex(u => u.username === username);
          if (idx !== -1) {
            recordFailedLogin(list[idx]);
            justLocked = !!list[idx].lockedUntil;
          }
          return list;
        });
        logAuthFailure(req, {
          username, fullName: user.name,
          actionType: justLocked ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
          description: justLocked
            ? 'Tài khoản bị khoá tạm thời 15 phút do đăng nhập sai quá 5 lần liên tiếp'
            : 'Đăng nhập sai mật khẩu'
        });
      } else {
        logAuthFailure(req, { username, actionType: 'LOGIN_FAILED', description: 'Đăng nhập sai tên đăng nhập hoặc mật khẩu' });
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
    warnIfCookieLikelyNotPersisted(req);
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
  const { name, email, phone, password, currentPassword, dashboardHiddenCards } = req.body || {};

  try {
    // Đổi mật khẩu bắt buộc xác nhận đúng mật khẩu HIỆN TẠI trước — cùng lý do với /change-pin (đổi
    // PIN): tránh ai lợi dụng phiên trình duyệt đang mở sẵn (máy dùng chung/phiên bị chiếm) tự đặt mật
    // khẩu mới mà không cần biết mật khẩu cũ, rồi đăng xuất mọi phiên khác qua sessionVersion bên dưới —
    // chiếm trọn tài khoản trong khi chủ thật không hề bị lộ mật khẩu ban đầu. Người đang phải đổi mật
    // khẩu tạm lần đầu (mustChangePassword) vẫn còn nhớ đúng mật khẩu tạm vừa dùng để đăng nhập, NHƯNG
    // #mustChangePasswordModal (index.html) — lối thoát DUY NHẤT khỏi trạng thái này — chưa từng thu
    // thập/gửi currentPassword. Nếu vẫn đòi currentPassword ở đây thì tài khoản mustChangePassword bị
    // khoá cứng vĩnh viễn (chỉ còn nút Đăng Xuất) — nên bỏ qua yêu cầu này khi đang ở trạng thái đó.
    if (password && !req.freshUser.mustChangePassword) {
      if (!currentPassword) return res.status(400).json({ error: 'Vui lòng nhập mật khẩu hiện tại' });

      const remainingLockMinutes = getLockoutRemainingMinutes(req.freshUser);
      if (remainingLockMinutes !== null) {
        return res.status(429).json({ error: `Tài khoản tạm khóa do nhập sai quá nhiều lần. Vui lòng thử lại sau ${remainingLockMinutes} phút.` });
      }

      // Khớp fallback "pass || password" mà /login và /verify-password đã dùng (tương thích bản ghi cũ
      // chưa kịp di trú qua migratePlaintextPasswords()) — trước đây chỉ đọc req.freshUser.pass, nên 1
      // bản ghi hiếm hoi chỉ còn field "password" (phục hồi backup giữa chừng, import thủ công...) vẫn
      // đăng nhập được nhưng PATCH /me đổi mật khẩu LUÔN báo sai dù nhập đúng, không có lối thoát.
      const ok = await verifyPassword(currentPassword, req.freshUser.pass || req.freshUser.password);
      if (!ok) {
        await withLockedAppDataValue('users', (collection) => {
          const list = Array.isArray(collection) ? collection : [];
          const idx = list.findIndex(u => u.username === req.user.username);
          if (idx !== -1) recordFailedLogin(list[idx]);
          return list;
        });
        return res.status(401).json({ error: 'Mật khẩu hiện tại không chính xác' });
      }
    }

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
        // Tự đổi mật khẩu thành công (kể cả sau khi vừa gõ sai currentPassword vài lần) -> xoá lịch sử
        // sai + gỡ cờ bắt buộc đổi (nếu có) — đây chính là lối thoát duy nhất khỏi trạng thái
        // mustChangePassword (xem lib/auth.js blockIfMustChangePassword).
        resetLoginAttempts(updated);
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
    // Tài khoản/mật khẩu SMTP: ưu tiên DB.emailConfig (đã mã hoá, xem lib/emailCrypto.js), rơi về
    // .env nếu chưa cấu hình qua web — khớp đúng routes/email.js/jobs/contractExpiryReminder.js.
    let smtpUser = null, smtpPass = null;
    if (emailConfig.smtpAuthEnabled && emailConfig.smtpUser && emailConfig.smtpPassEnc) {
      try {
        smtpUser = emailConfig.smtpUser;
        smtpPass = decryptSecret(emailConfig.smtpPassEnc);
      } catch (err) {
        console.error('⛔ Không giải mã được mật khẩu SMTP đã lưu, dùng đường lùi .env nếu có:', err.message);
      }
    }
    await sendMail({
      to: [req.freshUser.email],
      subject: '[VPDT] Mã xác thực phê duyệt',
      text: `Mã OTP của bạn: ${code} (chỉ dùng 1 lần cho lượt duyệt này, hết hạn sau 5 phút)`,
      host: emailConfig.smtpHost, port: emailConfig.smtpPort, encryption: resolveEncryption(emailConfig),
      user: smtpUser, pass: smtpPass,
      from: emailConfig.senderEmail
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/request-approval-otp lỗi:', err.message);
    res.status(500).json({ error: 'Không thể gửi mã OTP' });
  }
});

// POST /api/auth/verify-approval-otp — xác thực mã OTP đã gửi ở trên, cấp phiếu Duyệt nếu đúng (xem
// lib/approvalAuth.js verifyApprovalOtp() — đã tự cấp phiếu bên trong khi khớp mã). Trước đây là điểm
// DUY NHẤT trong 4 điểm xác thực lại (login, /verify-password, /verify-pin, ở đây) KHÔNG dùng chung bộ
// đếm khoá tài khoản (lib/loginAttempts.js) — mã OTP chỉ có 6 chữ số (1 triệu khả năng, hết hạn sau 5
// phút, xem lib/approvalAuth.js), chỉ dựa vào loginRateLimiter (giới hạn theo IP) thì 1 kẻ tấn công có
// thể đổi IP/dùng nhiều thiết bị để dò thẳng account đang cần OTP mà không bị khoá tài khoản như 3 điểm
// xác thực còn lại.
router.post('/verify-approval-otp', loginRateLimiter, requireAuth, async (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Thiếu mã OTP' });

  try {
    const username = req.freshUser.username;
    const remainingLockMinutes = getLockoutRemainingMinutes(req.freshUser);
    if (remainingLockMinutes !== null) {
      return res.status(429).json({ error: `Tài khoản tạm khóa do nhập sai quá nhiều lần. Vui lòng thử lại sau ${remainingLockMinutes} phút.` });
    }

    const ok = verifyApprovalOtp(username, code);
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
    console.error('POST /api/auth/verify-approval-otp lỗi:', err.message);
    res.status(500).json({ error: 'Không thể xác thực mã OTP' });
  }
});

// ==========================================
// ĐĂNG NHẬP / XÁC THỰC LẠI KHI DUYỆT BẰNG VÂN TAY, FACE ID (WebAuthn/FIDO2) — xem lib/webauthn.js.
// 4 nhóm route: (1) đăng ký thiết bị mới [requireAuth — chỉ làm được từ phiên đã đăng nhập mật khẩu
// trước đó] + liệt kê/gỡ thiết bị; (2) đăng nhập bằng vân tay [public, thay /login]; (3) xác thực lại
// khi Duyệt bằng vân tay [requireAuth, mức WEBAUTHN mới trong approverAuthLevel — song song
// PASSWORD/OTP_EMAIL/PIN đã có, cùng cấp "phiếu Duyệt" qua issueApprovalGrant()].
// ==========================================

// POST /api/auth/webauthn/register-options — Bước 1 đăng ký thiết bị mới của CHÍNH người đang đăng
// nhập. Lần đầu đăng ký thiết bị nào đó, sinh sẵn webauthnUserId dùng chung cho MỌI thiết bị của tài
// khoản này về sau (không sinh lại mỗi lần).
router.post('/webauthn/register-options', requireAuth, async (req, res) => {
  try {
    const { options, webauthnUserId } = await webauthn.buildRegistrationOptions(req, req.freshUser);
    if (webauthnUserId !== req.freshUser.webauthnUserId) {
      await withLockedAppDataValue('users', (collection) => {
        const list = Array.isArray(collection) ? collection : [];
        const idx = list.findIndex(u => u.username === req.freshUser.username);
        if (idx !== -1) list[idx] = { ...list[idx], webauthnUserId };
        return list;
      });
    }
    res.json(options);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/auth/webauthn/register-options lỗi:', err.message);
    res.status(500).json({ error: 'Không thể khởi tạo đăng ký vân tay' });
  }
});

// POST /api/auth/webauthn/register-verify — Bước 2, xác minh attestation trình duyệt gửi lên rồi lưu
// credential mới vào user.webauthnCredentials. deviceLabel: tên gợi nhớ người dùng tự đặt (không bắt
// buộc), hiển thị lại ở màn quản lý thiết bị.
router.post('/webauthn/register-verify', requireAuth, async (req, res) => {
  const { response, deviceLabel } = req.body || {};
  if (!response) return res.status(400).json({ error: 'Thiếu dữ liệu xác minh từ trình duyệt' });

  try {
    const credential = await webauthn.verifyRegistration(req, req.freshUser, response);
    credential.deviceLabel = String(deviceLabel || '').trim().slice(0, 100) || 'Thiết bị chưa đặt tên';

    await withLockedAppDataValue('users', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(u => u.username === req.freshUser.username);
      if (idx === -1) throw new HttpError(401, 'Tài khoản không còn tồn tại');
      const existing = Array.isArray(list[idx].webauthnCredentials) ? list[idx].webauthnCredentials : [];
      list[idx] = { ...list[idx], webauthnCredentials: [...existing, credential] };
      return list;
    });

    res.json({ ok: true, credential: { id: credential.id, deviceLabel: credential.deviceLabel, createdAt: credential.createdAt } });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/auth/webauthn/register-verify lỗi:', err.message);
    res.status(500).json({ error: 'Không thể đăng ký thiết bị vân tay' });
  }
});

// GET /api/auth/webauthn/credentials — liệt kê thiết bị vân tay CỦA CHÍNH mình (Hồ Sơ Cá Nhân). Chỉ
// trả id/tên/ngày tạo — KHÔNG trả publicKey/counter (không cần thiết cho client, tránh lộ thừa).
router.get('/webauthn/credentials', requireAuth, (req, res) => {
  const list = (req.freshUser.webauthnCredentials || []).map(c => ({ id: c.id, deviceLabel: c.deviceLabel, createdAt: c.createdAt }));
  res.json(list);
});

// DELETE /api/auth/webauthn/credentials/:id — gỡ 1 thiết bị vân tay CỦA CHÍNH mình.
router.delete('/webauthn/credentials/:id', requireAuth, async (req, res) => {
  try {
    await withLockedAppDataValue('users', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(u => u.username === req.freshUser.username);
      if (idx === -1) throw new HttpError(401, 'Tài khoản không còn tồn tại');
      const existing = Array.isArray(list[idx].webauthnCredentials) ? list[idx].webauthnCredentials : [];
      list[idx] = { ...list[idx], webauthnCredentials: existing.filter(c => c.id !== req.params.id) };
      return list;
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('DELETE /api/auth/webauthn/credentials lỗi:', err.message);
    res.status(500).json({ error: 'Không thể gỡ thiết bị vân tay' });
  }
});

// POST /api/auth/webauthn/login-options — Bước 1 đăng nhập bằng vân tay (public, thay /login). Luôn
// trả về 1 bộ challenge hợp lệ dù username có tồn tại/có đăng ký vân tay hay không — KHÔNG lộ thông
// tin tài khoản qua sự khác biệt của response (khớp cách /login xử lý sai tài khoản/mật khẩu).
router.post('/webauthn/login-options', loginRateLimiter, async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Thiếu tên đăng nhập' });

  try {
    const users = (await getAppDataValue('users')) || [];
    const user = users.find(u => u.username === username) || null;
    const options = await webauthn.buildAuthenticationOptions(req, user);
    res.json(options);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/auth/webauthn/login-options lỗi:', err.message);
    res.status(500).json({ error: 'Không thể khởi tạo đăng nhập vân tay' });
  }
});

// POST /api/auth/webauthn/login-verify — Bước 2, xác minh chữ ký rồi cấp cookie phiên Y HỆT /login.
// Dùng CHUNG bộ đếm khoá tài khoản (lib/loginAttempts.js) với /login — vân tay xác thực sai cũng tính
// là 1 lần đăng nhập sai, cùng mục đích chống dò/lạm dụng như mật khẩu.
router.post('/webauthn/login-verify', loginRateLimiter, async (req, res) => {
  const { username, response } = req.body || {};
  if (!username || !response) return res.status(400).json({ error: 'Thiếu dữ liệu đăng nhập' });

  try {
    const users = (await getAppDataValue('users')) || [];
    const user = users.find(u => u.username === username);

    const remainingLockMinutes = user ? getLockoutRemainingMinutes(user) : null;
    if (remainingLockMinutes !== null) {
      logAuthFailure(req, {
        username, fullName: user.name, actionType: 'LOGIN_BLOCKED_LOCKED',
        description: `Thử đăng nhập bằng vân tay khi tài khoản đang bị khoá tạm thời (còn ${remainingLockMinutes} phút)`
      });
      return res.status(429).json({ error: `Tài khoản tạm khóa do đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${remainingLockMinutes} phút.` });
    }

    // Lỗi cụ thể (hết hạn challenge, sai thiết bị, chữ ký không hợp lệ...) đều gộp về CHUNG 1 thông báo
    // ra ngoài — không lộ chi tiết nào giúp phân biệt "tài khoản không tồn tại" với "vân tay sai".
    let verifyResult = null;
    if (user) {
      try {
        verifyResult = await webauthn.verifyAuthentication(req, user, response);
      } catch (err) {
        verifyResult = null;
      }
    }

    if (!verifyResult) {
      if (user) {
        let justLocked = false;
        await withLockedAppDataValue('users', (collection) => {
          const list = Array.isArray(collection) ? collection : [];
          const idx = list.findIndex(u => u.username === username);
          if (idx !== -1) {
            recordFailedLogin(list[idx]);
            justLocked = !!list[idx].lockedUntil;
          }
          return list;
        });
        logAuthFailure(req, {
          username, fullName: user.name,
          actionType: justLocked ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILED',
          description: justLocked
            ? 'Tài khoản bị khoá tạm thời 15 phút do đăng nhập sai quá 5 lần liên tiếp'
            : 'Đăng nhập bằng vân tay thất bại'
        });
      } else {
        logAuthFailure(req, { username, actionType: 'LOGIN_FAILED', description: 'Đăng nhập bằng vân tay với tài khoản không tồn tại' });
      }
      return res.status(401).json({ error: 'Không thể đăng nhập bằng vân tay, vui lòng thử lại hoặc dùng mật khẩu' });
    }

    if (user.active === false) {
      return res.status(403).json({ error: 'Tài khoản đã bị vô hiệu hóa — vui lòng liên hệ quản trị viên' });
    }

    // Cập nhật counter chống replay + xoá lịch sử đăng nhập sai (nếu có) trong CÙNG 1 lượt ghi khoá
    // dòng users, tránh mất counter nếu có request khác tới gần như đồng thời.
    let updatedUser;
    await withLockedAppDataValue('users', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(u => u.username === username);
      if (idx === -1) throw new HttpError(401, 'Tài khoản không còn tồn tại');
      const creds = (list[idx].webauthnCredentials || []).map(c =>
        c.id === verifyResult.credentialId ? { ...c, counter: verifyResult.newCounter } : c
      );
      updatedUser = { ...list[idx], webauthnCredentials: creds };
      resetLoginAttempts(updatedUser);
      list[idx] = updatedUser;
      return list;
    });

    const token = signToken(updatedUser);
    setAuthCookie(res, token);
    warnIfCookieLikelyNotPersisted(req);
    res.json(toSafeUser(updatedUser));
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/auth/webauthn/login-verify lỗi:', err.message);
    res.status(500).json({ error: 'Không thể đăng nhập' });
  }
});

// POST /api/auth/webauthn/approval-options + /approval-verify — xác thực lại bằng vân tay trước khi
// Duyệt (approverAuthLevel = 'WEBAUTHN', mức thứ 4 song song PASSWORD/OTP_EMAIL/PIN). Xác minh xong
// cấp "phiếu Duyệt" y hệt /verify-password|/verify-pin (xem lib/approvalAuth.js issueApprovalGrant()).
router.post('/webauthn/approval-options', loginRateLimiter, requireAuth, async (req, res) => {
  try {
    const options = await webauthn.buildAuthenticationOptions(req, req.freshUser);
    res.json(options);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/auth/webauthn/approval-options lỗi:', err.message);
    res.status(500).json({ error: 'Không thể khởi tạo xác thực vân tay' });
  }
});

router.post('/webauthn/approval-verify', loginRateLimiter, requireAuth, async (req, res) => {
  const { response } = req.body || {};
  if (!response) return res.status(400).json({ error: 'Thiếu dữ liệu xác thực từ trình duyệt' });

  try {
    const username = req.freshUser.username;
    const remainingLockMinutes = getLockoutRemainingMinutes(req.freshUser);
    if (remainingLockMinutes !== null) {
      return res.status(429).json({ error: `Tài khoản tạm khóa do nhập sai quá nhiều lần. Vui lòng thử lại sau ${remainingLockMinutes} phút.` });
    }

    let verifyResult;
    try {
      verifyResult = await webauthn.verifyAuthentication(req, req.freshUser, response);
    } catch (err) {
      await withLockedAppDataValue('users', (collection) => {
        const list = Array.isArray(collection) ? collection : [];
        const idx = list.findIndex(u => u.username === username);
        if (idx !== -1) recordFailedLogin(list[idx]);
        return list;
      });
      return res.json({ ok: false });
    }

    await withLockedAppDataValue('users', (collection) => {
      const list = Array.isArray(collection) ? collection : [];
      const idx = list.findIndex(u => u.username === username);
      if (idx === -1) return list;
      const creds = (list[idx].webauthnCredentials || []).map(c =>
        c.id === verifyResult.credentialId ? { ...c, counter: verifyResult.newCounter } : c
      );
      const updated = { ...list[idx], webauthnCredentials: creds };
      resetLoginAttempts(updated);
      list[idx] = updated;
      return list;
    });

    issueApprovalGrant(username);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/auth/webauthn/approval-verify lỗi:', err.message);
    res.status(500).json({ error: 'Không thể xác thực vân tay' });
  }
});

module.exports = router;
