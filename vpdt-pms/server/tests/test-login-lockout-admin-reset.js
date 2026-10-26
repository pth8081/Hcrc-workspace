// server/tests/test-login-lockout-admin-reset.js
//
// Regression cho đợt "khoá tạm đăng nhập sai" (11/2026, theo phản hồi người dùng kèm ảnh chụp màn hình
// "Tài khoản tạm khóa do đăng nhập sai quá nhiều lần. Vui lòng thử lại sau 6 phút" — nhấn mạnh "khoá này
// hoàn toàn khác với khóa tài khoản", và cơ chế hiện tại KHÔNG có cách nào admin can thiệp ngoài đợi hết
// giờ, gây rắc rối thật cho CBNV gõ sai mật khẩu):
//
//   1. lib/loginAttempts.js: LOCKOUT_MINUTES hạ từ 15 xuống 5 phút (MAX_FAILED_ATTEMPTS giữ nguyên 5 lần).
//   2. routes/auth.js — 2 route MỚI, admin-only, thao tác trên 1 username cụ thể (KHÁC "Khoá Tài Khoản"
//      user.active=false — xem toggleUserActive() ở module-admin-userstaging.js, không đụng gì ở đây):
//      - GET /api/auth/login-lockout/status/:username — trả {locked, remainingMinutes, failedLoginAttempts}.
//      - POST /api/auth/login-lockout/reset/:username — xoá sạch failedLoginAttempts/lockedUntil ngay,
//        dùng LẠI đúng resetLoginAttempts() (không phải logic mới/riêng).
//
// Kiểm tra:
//   A. Người thường (không phải admin) bị chặn 403 ở CẢ 2 route, dù gọi đúng username của chính mình.
//   B. Admin xem trạng thái tài khoản CHƯA từng đăng nhập sai lần nào -> locked=false, failedLoginAttempts=0.
//   C. Sau 5 lần đăng nhập sai liên tiếp (gọi thật qua POST /api/auth/login) -> tài khoản bị khoá,
//      GET status trả locked=true với remainingMinutes xấp xỉ 5 (KHÔNG còn 15 như cấu hình cũ).
//   D. Trong lúc đang khoá, đăng nhập dù ĐÚNG mật khẩu vẫn bị chặn 429 (hành vi cũ giữ nguyên, không đổi).
//   E. Admin bấm "Mở Khoá Ngay" (POST reset) -> wasLocked=true, GET status ngay sau đó trả locked=false,
//      failedLoginAttempts=0 — và tài khoản đăng nhập ĐÚNG mật khẩu lại được NGAY LẬP TỨC (không cần đợi
//      hết 5 phút) — đây là bài test THẬT cho đúng yêu cầu "nút khẩn cấp".
//   F. Gọi reset trên tài khoản VỐN KHÔNG bị khoá -> không throw, wasLocked=false (no-op êm, admin không
//      cần tự kiểm tra trạng thái trước khi bấm nút khẩn cấp).
//   G. Username không tồn tại -> 404 ở cả 2 route.
//
// Cùng khuôn tests/test-admin-totp.js (gọi thẳng express router THẬT routes/auth.js, giả lập tầng lưu
// trữ + middleware xác thực + db).
//
// Chạy: node server/tests/test-login-lockout-admin-reset.js
'use strict';

const http = require('http');
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const ADMIN = { username: 'admin1', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, email: 'admin1@x.com', pass: 'hashed:123456' };
const PLAIN = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Kinh Doanh', perms: {}, active: true, email: 'nv1@x.com', pass: 'hashed:123456' };

function seedUsers() {
  return [JSON.parse(JSON.stringify(ADMIN)), JSON.parse(JSON.stringify(PLAIN))];
}
let APP_DATA = { users: seedUsers() };
function resetAppData() { APP_DATA = { users: seedUsers() }; }

stubModule('lib/mailer', { sendMail: async () => ({ ok: true }), resolveEncryption: () => 'NONE', hasAuthConfigured: () => false });
stubModule('lib/emailCrypto', { encryptSecret: (p) => `ENC(${p})`, decryptSecret: (p) => (p || '').replace(/^ENC\(|\)$/g, '') });

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  withLockedAppDataValue: async (key, fn) => {
    const updated = await fn(APP_DATA[key]);
    APP_DATA[key] = updated;
    return updated;
  }
});

stubModule('db', {
  getPool: async () => ({
    request: () => {
      const req = { input: () => req, query: async () => ({ recordset: [] }) };
      return req;
    }
  }),
  sql: (() => {
    const handler = { get: (target, prop) => (prop === Symbol.toPrimitive ? undefined : sqlProxy), apply: () => sqlProxy };
    const sqlProxy = new Proxy(function () {}, handler);
    return sqlProxy;
  })()
});

let CURRENT_USERNAME = ADMIN.username;
let CURRENT_AUTHED = true; // false mô phỏng request /login (public, không qua requireAuth)

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = APP_DATA.users.find(u => u.username === CURRENT_USERNAME);
    if (!CURRENT_AUTHED || !fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, admin: !!fresh.perms?.admin };
    req.freshUser = fresh;
    next();
  },
  verifyPassword: async (plain, hashOrPlain) => {
    if (typeof hashOrPlain === 'string' && hashOrPlain.startsWith('hashed:')) return plain === hashOrPlain.slice('hashed:'.length);
    return plain === hashOrPlain;
  },
  hashPassword: async (plain) => `hashed:${plain}`,
  signToken: () => 'tok',
  verifyToken: () => null,
  setAuthCookie: (res) => res,
  clearAuthCookie: (res) => res,
  COOKIE_NAME: 'vpdt_session',
  findUserByUsernameCI: (users, username) => users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase())
});

stubModule('lib/passwordPolicy', { validatePasswordStrength: () => ({ ok: true }) });
stubModule('lib/captcha', { isCaptchaEnabled: () => false, verifyCaptcha: async () => true });
stubModule('lib/approvalAuth', { issueApprovalGrant: async () => {}, issueApprovalOtp: async () => {}, verifyApprovalOtp: async () => true });

const express = require('express');
const cookieParser = require('cookie-parser');
const authRoutes = require('../routes/auth');
const { LOCKOUT_MINUTES, MAX_FAILED_ATTEMPTS } = require('../lib/loginAttempts');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function api(method, urlPath, body, asUser, authed = true) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  CURRENT_AUTHED = authed;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function main() {
  const server = await startApp();

  record('Hằng số LOCKOUT_MINUTES đã hạ xuống 5 (không còn 15)', LOCKOUT_MINUTES === 5, `LOCKOUT_MINUTES=${LOCKOUT_MINUTES}`);
  record('MAX_FAILED_ATTEMPTS giữ nguyên 5 lần (không đổi ngưỡng kích hoạt khoá)', MAX_FAILED_ATTEMPTS === 5, `MAX_FAILED_ATTEMPTS=${MAX_FAILED_ATTEMPTS}`);

  // ===== A: người thường bị chặn 403 ở cả 2 route =====
  resetAppData();
  const statusAsPlain = await api('GET', `/api/auth/login-lockout/status/${PLAIN.username}`, undefined, PLAIN);
  record('A1. Người thường gọi GET status -> 403', statusAsPlain.status === 403, JSON.stringify(statusAsPlain));
  const resetAsPlain = await api('POST', `/api/auth/login-lockout/reset/${PLAIN.username}`, undefined, PLAIN);
  record('A2. Người thường gọi POST reset -> 403', resetAsPlain.status === 403, JSON.stringify(resetAsPlain));

  // ===== B: tài khoản chưa từng đăng nhập sai =====
  resetAppData();
  const statusClean = await api('GET', `/api/auth/login-lockout/status/${PLAIN.username}`, undefined, ADMIN);
  record('B. Tài khoản sạch -> locked=false, failedLoginAttempts=0', statusClean.status === 200 && statusClean.body.locked === false && statusClean.body.failedLoginAttempts === 0, JSON.stringify(statusClean));

  // ===== C: 5 lần đăng nhập sai liên tiếp -> khoá, remainingMinutes ~5 (không phải ~15) =====
  resetAppData();
  for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
    await api('POST', '/api/auth/login', { username: PLAIN.username, password: 'sai-mat-khau' }, null, false);
  }
  const statusLocked = await api('GET', `/api/auth/login-lockout/status/${PLAIN.username}`, undefined, ADMIN);
  record('C. Sau 5 lần sai liên tiếp -> locked=true', statusLocked.status === 200 && statusLocked.body.locked === true, JSON.stringify(statusLocked));
  record('C2. remainingMinutes <= 5 (khớp LOCKOUT_MINUTES mới, KHÔNG phải 15 cũ)', statusLocked.body.remainingMinutes <= 5 && statusLocked.body.remainingMinutes >= 1, JSON.stringify(statusLocked));

  // ===== D: đang khoá, đăng nhập ĐÚNG mật khẩu vẫn bị chặn 429 (hành vi cũ giữ nguyên) =====
  const loginWhileLocked = await api('POST', '/api/auth/login', { username: PLAIN.username, password: '123456' }, null, false);
  record('D. Đang khoá, đăng nhập ĐÚNG mật khẩu vẫn bị chặn 429', loginWhileLocked.status === 429, JSON.stringify(loginWhileLocked));

  // ===== E: admin bấm "Mở Khoá Ngay" -> mở ngay, đăng nhập lại được NGAY LẬP TỨC =====
  const resetResult = await api('POST', `/api/auth/login-lockout/reset/${PLAIN.username}`, undefined, ADMIN);
  record('E1. Admin reset -> 200, wasLocked=true', resetResult.status === 200 && resetResult.body.wasLocked === true, JSON.stringify(resetResult));
  const statusAfterReset = await api('GET', `/api/auth/login-lockout/status/${PLAIN.username}`, undefined, ADMIN);
  record('E2. Ngay sau reset -> locked=false, failedLoginAttempts=0', statusAfterReset.status === 200 && statusAfterReset.body.locked === false && statusAfterReset.body.failedLoginAttempts === 0, JSON.stringify(statusAfterReset));
  const loginAfterReset = await api('POST', '/api/auth/login', { username: PLAIN.username, password: '123456' }, null, false);
  record('E3. Đăng nhập ĐÚNG mật khẩu NGAY sau reset -> KHÔNG còn bị 429 (mở khoá khẩn cấp có tác dụng thật)', loginAfterReset.status !== 429, JSON.stringify(loginAfterReset));

  // ===== F: reset trên tài khoản VỐN KHÔNG bị khoá -> no-op êm =====
  resetAppData();
  const resetNotLocked = await api('POST', `/api/auth/login-lockout/reset/${PLAIN.username}`, undefined, ADMIN);
  record('F. Reset tài khoản vốn không khoá -> 200, wasLocked=false (không throw)', resetNotLocked.status === 200 && resetNotLocked.body.wasLocked === false, JSON.stringify(resetNotLocked));

  // ===== G: username không tồn tại -> 404 ở cả 2 route =====
  const statusMissing = await api('GET', '/api/auth/login-lockout/status/khong-ton-tai', undefined, ADMIN);
  record('G1. GET status username không tồn tại -> 404', statusMissing.status === 404, JSON.stringify(statusMissing));
  const resetMissing = await api('POST', '/api/auth/login-lockout/reset/khong-ton-tai', undefined, ADMIN);
  record('G2. POST reset username không tồn tại -> 404', resetMissing.status === 404, JSON.stringify(resetMissing));

  server.close();
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
