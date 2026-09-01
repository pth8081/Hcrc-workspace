// routes/externalAuthVerify.js — API dành cho ứng dụng NGOÀI hệ thống, tự xác thực bằng API key riêng
// (cấp qua routes/externalAuthAdmin.js, xem lib/externalAuth.js) thay vì phiên đăng nhập HCRC:
//   - POST /verify-credentials: xác thực (verify) 1 cặp tài khoản/mật khẩu HCRC Workspace, trả lời
//     ĐÚNG/SAI — không cấp cookie/JWT, không phải "đăng nhập hộ".
//   - GET  /users: đồng bộ danh bạ nhân sự cơ bản (username/tên/điện thoại/phòng ban/chức danh) sang
//     ứng dụng ngoài — chỉ trả các field công khai nội bộ (KHÔNG BAO GIỜ kèm mật khẩu/PIN dù đã hash).
//
// KHÔNG mount sau requireAuth (server.js) — caller là hệ thống ngoài, không có phiên đăng nhập HCRC, tự
// xác thực bằng API key trong header Authorization thay cho cookie phiên (xem requireExternalApiKey()).
// LỚP BẢO MẬT THỨ 2 (tuỳ chọn, cấu hình theo TỪNG key): nếu admin đã khai báo allowedIps[] cho key đó
// (xem routes/externalAuthAdmin.js), request phải tới từ đúng IP/dải CIDR trong danh sách mới được đi
// tiếp — key ĐÚNG nhưng gọi từ IP lạ vẫn bị chặn (403). Key chưa cấu hình allowedIps (mảng rỗng, kể cả
// key tạo trước khi có tính năng này) không bị ảnh hưởng — cho phép mọi IP như trước.
// POST /verify-credentials dùng CHUNG bộ đếm khoá tài khoản (lib/loginAttempts.js) với
// POST /api/auth/login — 1 kênh xác thực mật khẩu bị lộ vẫn tính chung vào đúng 5-lần-sai-thì-khoá,
// không mở thêm đường dò mật khẩu không giới hạn số lần thử.
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { verifyPassword } = require('../lib/auth');
const { recordFailedLogin, resetLoginAttempts, getLockoutRemainingMinutes } = require('../lib/loginAttempts');
const { extractBearerToken, verifyApiKey, isIpAllowed } = require('../lib/externalAuth');
const { insertSystemLog } = require('../lib/systemLogStore');
const { sendServerError } = require('../lib/errorResponse');

// Chung cho MỌI route trong file này (khác loginRateLimiter ở routes/auth.js — caller dự kiến là 1-vài
// hệ thống tích hợp cố định, không phải cả công ty dùng chung 1 IP như đăng nhập thường), chặt hơn nhiều
// để hạn chế 1 API key bị lộ cũng chỉ gọi được số lượng hữu hạn/15 phút. Chỉnh được qua .env
// (EXTERNAL_AUTH_RATE_LIMIT_MAX) không cần sửa code, khớp tiền lệ LOGIN_RATE_LIMIT_MAX.
const externalApiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parseInt(process.env.EXTERNAL_AUTH_RATE_LIMIT_MAX || '300', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Đã gọi API xác thực ngoài quá nhiều lần từ nguồn này. Vui lòng thử lại sau ít phút.' }
});
router.use(externalApiRateLimiter);

function logExternalAuth(req, { apiKeyName, username, actionType, description, status }) {
  insertSystemLog({
    username: username || 'unknown', fullName: apiKeyName ? `[API: ${apiKeyName}]` : 'unknown', ipAddress: req.ip,
    module: 'EXTERNAL_AUTH', actionType, targetObject: username || '', description, status
  }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (external API):', e.message));
}

// Tra đúng 1 API key đang active khớp header — so tiền tố (keyPrefix, rẻ) trước để khoanh vùng ứng viên
// rồi mới bcrypt.compare (đắt) xác nhận thật, tránh phải so bcrypt với TOÀN BỘ key đang có mỗi request.
async function findMatchingApiKey(rawKey) {
  if (!rawKey) return null;
  const list = (await getAppDataValue('externalApiKeys')) || [];
  const candidates = list.filter(k => k.active !== false && rawKey.startsWith(k.keyPrefix || ' '));
  for (const candidate of candidates) {
    if (await verifyApiKey(rawKey, candidate.keyHash)) return candidate;
  }
  return null;
}

function touchApiKeyLastUsed(id) {
  withLockedAppDataValue('externalApiKeys', (list) => {
    const current = Array.isArray(list) ? list : [];
    const idx = current.findIndex(k => k.id === id);
    if (idx === -1) return current;
    const updated = [...current];
    updated[idx] = { ...current[idx], lastUsedAt: new Date().toISOString() };
    return updated;
  }).catch(e => console.error('Lỗi cập nhật lastUsedAt cho API key:', e.message));
}

// Middleware dùng chung cho MỌI route bên dưới — gắn req.externalApiKey (bản ghi key đã xác thực, dùng
// để ghi log/hiển thị tên ứng dụng gọi) rồi mới cho đi tiếp; API key thiếu/sai/đã bị thu hồi -> 401
// ngay tại đây, các route phía sau không cần tự kiểm tra lại.
async function requireExternalApiKey(req, res, next) {
  try {
    const rawKey = extractBearerToken(req.headers.authorization);
    const apiKey = await findMatchingApiKey(rawKey);
    if (!apiKey) {
      logExternalAuth(req, { actionType: 'API_KEY_INVALID', description: `Gọi ${req.method} ${req.path} với API key thiếu/sai/đã bị thu hồi`, status: 'FAILURE' });
      return res.status(401).json({ error: 'API key không hợp lệ' });
    }
    if (!isIpAllowed(req.ip, apiKey.allowedIps)) {
      logExternalAuth(req, { apiKeyName: apiKey.name, actionType: 'API_KEY_IP_BLOCKED', description: `Gọi ${req.method} ${req.path} từ IP không nằm trong danh sách cho phép của key (IP thực: ${req.ip})`, status: 'FAILURE' });
      return res.status(403).json({ error: 'IP gọi không nằm trong danh sách được phép sử dụng API key này' });
    }
    touchApiKeyLastUsed(apiKey.id);
    req.externalApiKey = apiKey;
    next();
  } catch (err) {
    sendServerError(res, 500, err, `${req.method} ${req.path} (tra API key)`, 'Không thể xác thực yêu cầu');
  }
}
router.use(requireExternalApiKey);

router.post('/verify-credentials', async (req, res) => {
  try {
    const apiKey = req.externalApiKey;
    const { account, password } = req.body || {};
    const username = String(account || '').trim();
    if (!username || !password) {
      return res.status(400).json({ error: 'Thiếu "account" hoặc "password"' });
    }

    const users = (await getAppDataValue('users')) || [];
    const user = users.find(u => u.username === username);

    const remainingLockMinutes = user ? getLockoutRemainingMinutes(user) : null;
    if (remainingLockMinutes !== null) {
      logExternalAuth(req, { apiKeyName: apiKey.name, username, actionType: 'VERIFY_BLOCKED_LOCKED', description: `Tài khoản đang bị khoá tạm thời (còn ${remainingLockMinutes} phút)`, status: 'FAILURE' });
      return res.json({ success: false, error: `Tài khoản tạm khóa do đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${remainingLockMinutes} phút.` });
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
      logExternalAuth(req, { apiKeyName: apiKey.name, username, actionType: 'VERIFY_FAILED', description: 'Xác thực sai tài khoản/mật khẩu qua API ngoài', status: 'FAILURE' });
      return res.json({ success: false, error: 'Tài khoản hoặc mật khẩu không chính xác' });
    }

    if (user.active === false) {
      logExternalAuth(req, { apiKeyName: apiKey.name, username, actionType: 'VERIFY_BLOCKED_INACTIVE', description: 'Đúng mật khẩu nhưng tài khoản đã bị vô hiệu hóa', status: 'FAILURE' });
      return res.json({ success: false, error: 'Tài khoản đã bị vô hiệu hóa' });
    }

    if (user.failedLoginAttempts) {
      await withLockedAppDataValue('users', (collection) => {
        const list = Array.isArray(collection) ? collection : [];
        const idx = list.findIndex(u => u.username === username);
        if (idx !== -1) resetLoginAttempts(list[idx]);
        return list;
      });
    }

    logExternalAuth(req, { apiKeyName: apiKey.name, username, actionType: 'VERIFY_SUCCESS', description: 'Xác thực đúng tài khoản/mật khẩu qua API ngoài', status: 'SUCCESS' });
    res.json({ success: true });
  } catch (err) {
    sendServerError(res, 500, err, 'POST /api/external/verify-credentials', 'Không thể xác thực yêu cầu');
  }
});

// "Vị Trí" — ĐÚNG khái niệm/nhãn đã dùng ở màn Người Dùng đầy đủ (uPosType, public/index.html: "HO (Văn
// phòng)" / "Siêu Thị") — KHÔNG phải "chức danh" (jobTitle, khác field, khác ý nghĩa). User cũ tạo trước
// khi có field posType không có giá trị này — suy luận lại y hệt logic client (renderUserForm()/
// editUser()): dept trùng tên 1 siêu thị trong danh mục stores thì coi là 'STORE', còn lại là 'HO'.
function posTypeLabel(posType) {
  return posType === 'STORE' ? 'Siêu Thị' : 'Văn phòng';
}
function resolvePosType(u, storeNames) {
  return u.posType || (storeNames.has(u.dept) ? 'STORE' : 'HO');
}

// Field công khai nội bộ duy nhất trả ra ngoài cho mục đích đồng bộ danh bạ — ĐÚNG 6 field đối tác yêu
// cầu (vị trí/mã nhân viên/tên nhân viên/điện thoại/phòng/chức danh), TUYỆT ĐỐI không có pass/password/
// pinHash/failedLoginAttempts/lockedUntil hay bất kỳ field bí mật nào khác của users. "username" đóng
// vai trò "mã nhân viên" (không có field mã nhân viên riêng trong hệ thống — username LÀ định danh duy
// nhất/không đổi của mỗi nhân sự, dùng để đăng nhập).
function toDirectoryProfile(u, storeNames) {
  return {
    position: posTypeLabel(resolvePosType(u, storeNames)),
    username: u.username, name: u.name || '', phone: u.phone || '',
    dept: u.dept || '', jobTitle: u.jobTitle || ''
  };
}

// GET /api/external/users — đồng bộ danh bạ nhân sự sang ứng dụng ngoài. Không kèm query "account" ->
// trả TOÀN BỘ danh sách (đồng bộ hàng loạt định kỳ); kèm "?account=<username>" -> trả đúng 1 hồ sơ
// (404 nếu không có) — tiện cho ứng dụng ngoài tra cứu lẻ 1 tài khoản khi cần mà không phải tải cả danh
// bạ.
router.get('/users', async (req, res) => {
  try {
    const apiKey = req.externalApiKey;
    const [users, stores] = await Promise.all([
      getAppDataValue('users').then(v => v || []),
      getAppDataValue('stores').then(v => v || [])
    ]);
    const storeNames = new Set(stores);
    const account = String(req.query?.account || '').trim();

    if (account) {
      const user = users.find(u => u.username === account);
      if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });
      logExternalAuth(req, { apiKeyName: apiKey.name, username: account, actionType: 'DIRECTORY_LOOKUP', description: 'Tra cứu 1 hồ sơ danh bạ qua API ngoài', status: 'SUCCESS' });
      return res.json(toDirectoryProfile(user, storeNames));
    }

    logExternalAuth(req, { apiKeyName: apiKey.name, actionType: 'DIRECTORY_SYNC', description: `Đồng bộ toàn bộ danh bạ qua API ngoài (${users.length} tài khoản)`, status: 'SUCCESS' });
    res.json(users.map(u => toDirectoryProfile(u, storeNames)));
  } catch (err) {
    sendServerError(res, 500, err, 'GET /api/external/users', 'Không thể tải danh bạ');
  }
});

module.exports = router;
