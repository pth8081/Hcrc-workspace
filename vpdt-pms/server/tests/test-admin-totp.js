// server/tests/test-admin-totp.js
//
// Regression test cho tính năng "xác thực 2 lớp (TOTP) bắt buộc cho tài khoản admin" (lib/totp.js +
// routes/auth.js) — người dùng yêu cầu: "account có quyền admin bắt buộc phải xác thực hai yếu tố".
//
// Bao phủ:
//   1. Thiết lập (setup-options/setup-verify): sinh bí mật + QR, xác minh đúng mã mới lưu thật + bật
//      totpEnabled + sinh 10 mã khôi phục (trả về ĐÚNG 1 lần), sai mã thì KHÔNG lưu gì.
//   2. Đăng nhập 2 bước: admin CHƯA bật TOTP đăng nhập bình thường (cấp cookie ngay, để còn kịp thiết
//      lập); admin ĐÃ bật TOTP thì mật khẩu đúng KHÔNG cấp cookie — phải qua /verify-totp-login với
//      đúng mã (hoặc mã khôi phục, dùng 1 lần) mới cấp; sai mã bị từ chối.
//   3. Tự gỡ (DELETE /totp): bắt buộc đúng mật khẩu, tăng sessionVersion, xoá sạch field liên quan.
//   4. Admin gỡ hộ người khác (GET /totp/status/:username, DELETE /totp/:username): chỉ admin gọi được,
//      tăng sessionVersion của NGƯỜI ĐÓ (không phải của admin gọi).
//   5. Tài khoản thường (không phải admin) hoàn toàn không bị ảnh hưởng — không có totpRequired dù có
//      totpEnabled=true (chỉ áp dụng logic khi perms.admin).
//
// Cùng khuôn test-admin-webauthn-reset.js: gọi thẳng express router THẬT (routes/auth.js) trong tiến
// trình Node, chỉ giả lập tầng lưu trữ (lib/appData) + middleware xác thực (lib/auth requireAuth) +
// lib/emailCrypto (mã hoá "identity" cho gọn, không cần EMAIL_ENCRYPTION_KEY thật) + lib/mailer (không
// gửi mail thật, chỉ đếm số lần gọi) + db (getPool/sql — chỉ để getEmailConfig()/insertSystemLog() không
// crash, không kiểm tra nội dung SQL thật ở đây).
//
// LƯU Ý QUAN TRỌNG: trạng thái pendingLogins/pendingSetups (lib/totp.js) nay lưu qua bảng dùng chung
// dbo.EphemeralAuthTokens (lib/ephemeralStore.js — thay cho 2 Map cấp module trước đây, đổi để cluster
// PM2 nhiều tiến trình đọc/ghi đúng cùng 1 nguồn, xem lib/ephemeralStore.js) — Map giả lập ở khối
// `ephemeralTokens` phía dưới SỐNG Ở CẤP TEST FILE, không bị resetAppData() xoá (hàm đó chỉ reset
// APP_DATA giả lập, không đụng gì tới bảng ephemeral giả lập). Vì vậy MỌI kịch bản dưới đây tự đi qua
// ĐÚNG luồng thật (gọi /login rồi /verify-totp-login, hoặc /setup-options rồi /setup-verify) trong
// CHÍNH kịch bản đó thay vì giả định sẵn 1 trạng thái "đã bật TOTP" trong seed — vừa test đúng luồng
// thật đầu-cuối, vừa tránh trạng thái rò rỉ giữa các kịch bản.
//
// Chạy: node server/tests/test-admin-totp.js
const http = require('http');
const path = require('path');
const { authenticator } = require('otplib');

let PORT = 0;

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

// ===================== Seed =====================
const ADMIN1 = { username: 'admin1', name: 'Quản Trị Viên Một', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, email: 'admin1@x.com' };
const ADMIN2 = { username: 'admin2', name: 'Quản Trị Viên Hai', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, email: 'admin2@x.com' };
const PLAIN = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Kinh Doanh', perms: {}, active: true, email: 'nv1@x.com' };

function seedUsers() {
  return [
    JSON.parse(JSON.stringify(ADMIN1)),
    JSON.parse(JSON.stringify(ADMIN2)),
    JSON.parse(JSON.stringify(PLAIN))
  ];
}
let APP_DATA = { users: seedUsers() };
function resetAppData() { APP_DATA = { users: seedUsers() }; }

let sentMailCount = 0;
stubModule('lib/mailer', {
  sendMail: async () => { sentMailCount++; return { ok: true }; },
  resolveEncryption: () => 'NONE',
  hasAuthConfigured: () => false
});

// Mã hoá "identity" đơn giản cho test — chỉ cần round-trip đúng, không cần bảo mật thật ở đây (đã có
// test riêng cho lib/emailCrypto.js ở nơi khác).
stubModule('lib/emailCrypto', {
  encryptSecret: (plain) => `ENC(${plain})`,
  decryptSecret: (packed) => {
    const m = /^ENC\((.*)\)$/.exec(packed || '');
    if (!m) throw new Error('bad packed secret');
    return m[1];
  }
});

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  withLockedAppDataValue: async (key, fn) => {
    const updated = await fn(APP_DATA[key]);
    APP_DATA[key] = updated;
    return updated;
  }
});

// db.js (getPool/sql) — chỉ cần cho getEmailConfig() (routes/auth.js) và insertSystemLog()
// (lib/systemLogStore.js, gọi khi đăng nhập/xác thực thất bại) không bị crash — request() trả về 1 đối
// tượng "chainable" chấp nhận bao nhiêu lượt .input(...) cũng được rồi mới .query(...), và `sql.*` chấp
// nhận gọi bất kỳ tên kiểu dữ liệu nào (Proxy trả về hàm rỗng cho mọi thuộc tính) — không kiểm tra nội
// dung SQL thật ở bài test này (đã có test riêng cho lib/systemLogStore.js/emailConfig ở nơi khác).
//
// dbo.EphemeralAuthTokens (lib/ephemeralStore.js — nay lib/totp.js dùng để lưu pendingLogins/
// pendingSetups thay cho Map cấp module cũ, xem chú thích "LƯU Ý QUAN TRỌNG" đầu file — Map đó KHÔNG
// còn tồn tại, mọi trạng thái đăng nhập 2 bước/thiết lập giờ đi qua đây) PHẢI được mô phỏng THẬT bằng 1
// Map trong bộ nhớ test — nếu không, mọi request "cấp"/"đọc"/"xoá" trạng thái TOTP tạm thời đều rơi vào
// nhánh mặc định {recordset:[]} bên dưới, khiến hasPendingTotpLogin()/getPendingTotpSetupSecret() không
// bao giờ thấy được dữ liệu đã cấp trước đó.
const ephemeralTokens = new Map(); // TokenKey -> { Payload, ExpiresAt }
function handleEphemeralTokensQuery(q, inputs) {
  if (/^\s*MERGE dbo\.EphemeralAuthTokens/.test(q)) {
    ephemeralTokens.set(inputs.key, { Payload: inputs.payload, ExpiresAt: inputs.expiresAt });
    return { recordset: [] };
  }
  if (/^\s*DELETE FROM dbo\.EphemeralAuthTokens OUTPUT/.test(q)) {
    const row = ephemeralTokens.get(inputs.key);
    ephemeralTokens.delete(inputs.key);
    return { recordset: row ? [{ Payload: row.Payload, ExpiresAt: row.ExpiresAt }] : [] };
  }
  if (/^\s*SELECT Payload FROM dbo\.EphemeralAuthTokens/.test(q)) {
    const row = ephemeralTokens.get(inputs.key);
    if (row && new Date(row.ExpiresAt).getTime() > Date.now()) return { recordset: [{ Payload: row.Payload }] };
    return { recordset: [] };
  }
  if (/^\s*DELETE FROM dbo\.EphemeralAuthTokens WHERE ExpiresAt/.test(q)) {
    const now = Date.now();
    for (const [k, v] of ephemeralTokens) if (new Date(v.ExpiresAt).getTime() <= now) ephemeralTokens.delete(k);
    return { recordset: [] };
  }
  return null;
}

stubModule('db', {
  getPool: async () => ({
    request: () => {
      const inputs = {};
      const req = {
        input: (name, _type, value) => { inputs[name] = value; return req; },
        query: async (q) => {
          const eph = handleEphemeralTokensQuery(q, inputs);
          return eph !== null ? eph : { recordset: [] };
        }
      };
      return req;
    }
  }),
  // sql.XXX(...) (kiểu dữ liệu mssql, vd sql.NVarChar(50)) đôi khi bị đọc thêm thuộc tính trên kết quả
  // gọi (vd .Id) bởi lib/systemLogStore.js — hàm giả lập trả về CHÍNH proxy này thay vì undefined, để
  // chuỗi truy cập/goi bao nhiêu tầng cũng không throw (chỉ cần không crash, không cần đúng ngữ nghĩa
  // SQL thật ở bài test này).
  sql: (() => {
    const handler = { get: (target, prop) => (prop === Symbol.toPrimitive ? undefined : sqlProxy), apply: () => sqlProxy };
    const sqlProxy = new Proxy(function () {}, handler);
    return sqlProxy;
  })()
});

let CURRENT_USERNAME = ADMIN1.username;

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = APP_DATA.users.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, admin: !!fresh.perms?.admin };
    req.freshUser = fresh;
    req.allUsers = APP_DATA.users;
    next();
  },
  // verifyPassword được DÙNG LẠI cho 2 việc khác nhau trong routes/auth.js: (a) xác minh mật khẩu đăng
  // nhập/xác nhận của user.pass (seed test không có hash thật, coi mật khẩu giả lập chung là "123456"),
  // và (b) lib/totp.js verifyBackupCode() gọi verifyPassword(normalizedCode, hashedBackupCode) — hash đó
  // do CHÍNH hashPassword() dưới đây tạo ra lúc setup-verify, nên phải so khớp ĐÚNG với hash đó, không
  // phải luôn so với "123456" (nếu không mọi mã khôi phục sẽ luôn bị coi là sai).
  verifyPassword: async (plain, hashOrPlain) => {
    if (typeof hashOrPlain === 'string' && hashOrPlain.startsWith('hashed:')) {
      return hashOrPlain === `hashed:${plain}`;
    }
    return plain === '123456';
  },
  hashPassword: async (p) => `hashed:${p}`,
  validatePin: () => null,
  signToken: () => 'fake-token',
  setAuthCookie: () => {},
  clearAuthCookie: () => {}
});

// ===================== 1) Require code THẬT (sau khi đã cắm bản giả lập) =====================
const express = require('express');
const cookieParser = require('cookie-parser');
const authRoutes = require('../routes/auth');

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

async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

// Đi qua ĐÚNG luồng thật (setup-options + setup-verify) để đưa 1 user về trạng thái "đã bật TOTP" —
// dùng lại ở nhiều kịch bản cần sẵn trạng thái này, thay vì tự chế dữ liệu totpSecretEnc giả.
async function enableTotpFor(user) {
  const options = await api('POST', '/api/auth/totp/setup-options', {}, user);
  const code = authenticator.generate(options.body.secret);
  const verify = await api('POST', '/api/auth/totp/setup-verify', { code }, user);
  return { secret: options.body.secret, backupCodes: verify.body.backupCodes };
}

// ===================== Runner nhỏ =====================
let passed = 0, failed = 0;
async function run(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`);
  }
}
const assert = require('assert');

(async () => {
  const server = await startApp();

  // ===== Thiết lập TOTP (self-service) =====
  await run('setup-options: sinh bí mật MỚI + QR + otpauth URI, CHƯA lưu vào bản ghi user', async () => {
    resetAppData();
    const res = await api('POST', '/api/auth/totp/setup-options', {}, ADMIN1);
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.secret && res.body.secret.length >= 16);
    assert.ok(res.body.otpauthUri.startsWith('otpauth://totp/'));
    assert.ok(res.body.qrDataUrl.startsWith('data:image/'));
    const user = APP_DATA.users.find(u => u.username === ADMIN1.username);
    assert.ok(!user.totpEnabled, 'CHƯA bật cho tới khi xác minh xong ở setup-verify');
    assert.ok(!user.totpSecretEnc, 'CHƯA lưu bí mật cho tới khi xác minh xong');
  });

  await run('setup-verify: mã ĐÚNG -> lưu thật + bật totpEnabled + sinh 10 mã khôi phục + gửi email báo', async () => {
    resetAppData();
    sentMailCount = 0;
    const { backupCodes } = await enableTotpFor(ADMIN1);
    assert.strictEqual(backupCodes.length, 10);
    assert.ok(/^\d{4}-\d{4}$/.test(backupCodes[0]), 'Mã khôi phục đúng định dạng XXXX-XXXX');

    const user = APP_DATA.users.find(u => u.username === ADMIN1.username);
    assert.strictEqual(user.totpEnabled, true);
    assert.ok(user.totpSecretEnc, 'Đã lưu bí mật (mã hoá)');
    assert.strictEqual(user.totpBackupCodeHashes.length, 10);
    assert.notStrictEqual(user.totpBackupCodeHashes[0], backupCodes[0], 'Lưu HASH, không lưu plaintext mã khôi phục');
    assert.strictEqual(sentMailCount, 1, 'Phải gửi 1 email báo vừa thiết lập TOTP');
  });

  await run('setup-verify: mã SAI -> ok:false, KHÔNG lưu gì, totpEnabled vẫn false', async () => {
    resetAppData();
    await api('POST', '/api/auth/totp/setup-options', {}, ADMIN1);
    const res = await api('POST', '/api/auth/totp/setup-verify', { code: '000000' }, ADMIN1);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, false);
    const user = APP_DATA.users.find(u => u.username === ADMIN1.username);
    assert.ok(!user.totpEnabled);
    assert.ok(!user.totpSecretEnc);
  });

  await run('setup-verify: phiên thiết lập hết hạn/chưa từng gọi setup-options -> 400', async () => {
    resetAppData();
    // Dùng PLAIN (chưa từng gọi setup-options ở bất kỳ kịch bản nào trước đó trong suốt bài test này) —
    // tránh trạng thái Map pendingSetups rò rỉ từ các kịch bản khác đã dùng ADMIN1/ADMIN2.
    const res = await api('POST', '/api/auth/totp/setup-verify', { code: '123456' }, PLAIN);
    assert.strictEqual(res.status, 400);
  });

  // ===== Đăng nhập 2 bước =====
  await run('login: admin CHƯA bật TOTP -> đăng nhập bình thường (KHÔNG có totpRequired)', async () => {
    resetAppData();
    const res = await api('POST', '/api/auth/login', { username: ADMIN2.username, password: '123456' });
    assert.strictEqual(res.status, 200);
    assert.ok(!res.body.totpRequired);
    assert.strictEqual(res.body.username, ADMIN2.username);
  });

  await run('login: nhân viên thường -> đăng nhập bình thường dù có totpEnabled=true (chỉ áp dụng cho admin)', async () => {
    resetAppData();
    APP_DATA.users = APP_DATA.users.map(u => u.username === PLAIN.username ? { ...u, totpEnabled: true } : u);
    const res = await api('POST', '/api/auth/login', { username: PLAIN.username, password: '123456' });
    assert.strictEqual(res.status, 200);
    assert.ok(!res.body.totpRequired, 'Nhân viên thường không bao giờ bị bắt qua bước 2, dù cờ totpEnabled=true');
  });

  await run('login: admin ĐÃ bật TOTP -> mật khẩu đúng CHƯA cấp phiên, trả totpRequired:true', async () => {
    resetAppData();
    await enableTotpFor(ADMIN1);
    const res = await api('POST', '/api/auth/login', { username: ADMIN1.username, password: '123456' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totpRequired, true);
    assert.strictEqual(res.body.username, ADMIN1.username);
    assert.ok(!res.body.perms, 'KHÔNG trả về thông tin user đầy đủ ở bước này');
  });

  await run('verify-totp-login: chưa qua bước 1 (login) -> 401', async () => {
    resetAppData();
    await enableTotpFor(ADMIN2); // dùng ADMIN2 (không /login ở kịch bản này) để không dính pending grant của ADMIN1 ở kịch bản khác
    const res = await api('POST', '/api/auth/verify-totp-login', { username: ADMIN2.username, code: '123456' });
    assert.strictEqual(res.status, 401);
  });

  await run('verify-totp-login: mã ĐÚNG sau khi qua bước 1 -> cấp phiên thật (200, trả full user)', async () => {
    resetAppData();
    const { secret } = await enableTotpFor(ADMIN1);
    await api('POST', '/api/auth/login', { username: ADMIN1.username, password: '123456' });
    const code = authenticator.generate(secret);
    const res = await api('POST', '/api/auth/verify-totp-login', { username: ADMIN1.username, code });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.username, ADMIN1.username);
    assert.strictEqual(res.body.totpEnabled, true);
  });

  await run('verify-totp-login: mã SAI -> 401, KHÔNG cấp phiên', async () => {
    resetAppData();
    await enableTotpFor(ADMIN1);
    await api('POST', '/api/auth/login', { username: ADMIN1.username, password: '123456' });
    const res = await api('POST', '/api/auth/verify-totp-login', { username: ADMIN1.username, code: '000000' });
    assert.strictEqual(res.status, 401);
  });

  await run('verify-totp-login: dùng mã khôi phục ĐÚNG -> cấp phiên + xoá mã đó khỏi danh sách (dùng 1 lần)', async () => {
    resetAppData();
    const { backupCodes } = await enableTotpFor(ADMIN1);
    const backupCode = backupCodes[0];
    const before = APP_DATA.users.find(u => u.username === ADMIN1.username).totpBackupCodeHashes.length;

    await api('POST', '/api/auth/login', { username: ADMIN1.username, password: '123456' });
    const res = await api('POST', '/api/auth/verify-totp-login', { username: ADMIN1.username, backupCode });
    assert.strictEqual(res.status, 200);
    const after = APP_DATA.users.find(u => u.username === ADMIN1.username).totpBackupCodeHashes.length;
    assert.strictEqual(after, before - 1, 'Mã khôi phục vừa dùng phải bị xoá khỏi danh sách');
  });

  await run('verify-totp-login: dùng LẠI mã khôi phục đã dùng -> 401 (không dùng được lần 2)', async () => {
    resetAppData();
    const { backupCodes } = await enableTotpFor(ADMIN1);
    const backupCode = backupCodes[0];

    await api('POST', '/api/auth/login', { username: ADMIN1.username, password: '123456' });
    await api('POST', '/api/auth/verify-totp-login', { username: ADMIN1.username, backupCode });
    await api('POST', '/api/auth/login', { username: ADMIN1.username, password: '123456' });
    const res2 = await api('POST', '/api/auth/verify-totp-login', { username: ADMIN1.username, backupCode });
    assert.strictEqual(res2.status, 401);
  });

  // ===== Tự gỡ (self-service) =====
  await run('DELETE /totp (tự gỡ): thiếu mật khẩu -> 400', async () => {
    resetAppData();
    await enableTotpFor(ADMIN1);
    const res = await api('DELETE', '/api/auth/totp', {}, ADMIN1);
    assert.strictEqual(res.status, 400);
  });

  await run('DELETE /totp (tự gỡ): sai mật khẩu -> 401, KHÔNG đổi gì', async () => {
    resetAppData();
    await enableTotpFor(ADMIN1);
    const res = await api('DELETE', '/api/auth/totp', { password: 'saimatkhau' }, ADMIN1);
    assert.strictEqual(res.status, 401);
    const user = APP_DATA.users.find(u => u.username === ADMIN1.username);
    assert.strictEqual(user.totpEnabled, true, 'Trạng thái TOTP không bị đổi khi sai mật khẩu');
  });

  await run('DELETE /totp (tự gỡ): đúng mật khẩu -> gỡ sạch field, tăng sessionVersion, gửi email báo', async () => {
    resetAppData();
    await enableTotpFor(ADMIN1);
    sentMailCount = 0;
    const before = APP_DATA.users.find(u => u.username === ADMIN1.username).sessionVersion || 0;
    const res = await api('DELETE', '/api/auth/totp', { password: '123456' }, ADMIN1);
    assert.strictEqual(res.status, 200);
    const user = APP_DATA.users.find(u => u.username === ADMIN1.username);
    assert.ok(!user.totpEnabled);
    assert.ok(!user.totpSecretEnc);
    assert.ok(!user.totpBackupCodeHashes);
    assert.strictEqual(user.sessionVersion, before + 1, 'Gỡ TOTP phải tăng sessionVersion (đăng xuất phiên cũ)');
    assert.strictEqual(sentMailCount, 1);
  });

  // ===== Admin gỡ hộ người khác =====
  await run('GET /totp/status/:username: admin xem đúng trạng thái người khác', async () => {
    resetAppData();
    await enableTotpFor(ADMIN1);
    const res = await api('GET', `/api/auth/totp/status/${ADMIN1.username}`, undefined, ADMIN2);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totpEnabled, true);
  });

  await run('GET /totp/status/:username: nhân viên thường KHÔNG xem được -> 403', async () => {
    resetAppData();
    await enableTotpFor(ADMIN1);
    const res = await api('GET', `/api/auth/totp/status/${ADMIN1.username}`, undefined, PLAIN);
    assert.strictEqual(res.status, 403);
  });

  await run('DELETE /totp/:username: admin gỡ HỘ admin khác -> gỡ sạch, tăng sessionVersion của NGƯỜI ĐÓ (không phải người gọi)', async () => {
    resetAppData();
    await enableTotpFor(ADMIN1);
    sentMailCount = 0;
    const beforeTarget = APP_DATA.users.find(u => u.username === ADMIN1.username).sessionVersion || 0;
    const beforeCaller = APP_DATA.users.find(u => u.username === ADMIN2.username).sessionVersion || 0;

    const res = await api('DELETE', `/api/auth/totp/${ADMIN1.username}`, {}, ADMIN2);
    assert.strictEqual(res.status, 200);
    const target = APP_DATA.users.find(u => u.username === ADMIN1.username);
    const caller = APP_DATA.users.find(u => u.username === ADMIN2.username);
    assert.ok(!target.totpEnabled);
    assert.strictEqual(target.sessionVersion, beforeTarget + 1);
    assert.strictEqual(caller.sessionVersion || 0, beforeCaller, 'KHÔNG đụng gì tới phiên của admin đang gọi');
    assert.strictEqual(sentMailCount, 1, 'Phải báo cho người bị gỡ hộ biết');
  });

  await run('DELETE /totp/:username: nhân viên thường không gỡ được -> 403, KHÔNG đổi gì', async () => {
    resetAppData();
    await enableTotpFor(ADMIN1);
    const res = await api('DELETE', `/api/auth/totp/${ADMIN1.username}`, {}, PLAIN);
    assert.strictEqual(res.status, 403);
    const target = APP_DATA.users.find(u => u.username === ADMIN1.username);
    assert.strictEqual(target.totpEnabled, true, 'Không bị gỡ khi bị từ chối 403');
  });

  await run('DELETE /totp/:username: tài khoản không tồn tại -> 404', async () => {
    resetAppData();
    const res = await api('DELETE', '/api/auth/totp/khong_ton_tai', {}, ADMIN2);
    assert.strictEqual(res.status, 404);
  });

  // ===== Data minimization (toSafeUser) =====
  await run('GET /me: KHÔNG lộ totpSecretEnc/totpBackupCodeHashes, CÓ totpEnabled boolean', async () => {
    resetAppData();
    await enableTotpFor(ADMIN1);
    const res = await api('GET', '/api/auth/me', undefined, ADMIN1);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.totpEnabled, true);
    assert.ok(!('totpSecretEnc' in res.body));
    assert.ok(!('totpBackupCodeHashes' in res.body));
  });

  // ===== Thêm thiết bị khác (reveal-secret) — không cần gỡ + thiết lập lại từ đầu =====
  await run('reveal-secret: thiếu mật khẩu -> 400', async () => {
    resetAppData();
    await enableTotpFor(ADMIN1);
    const res = await api('POST', '/api/auth/totp/reveal-secret', {}, ADMIN1);
    assert.strictEqual(res.status, 400);
  });

  await run('reveal-secret: chưa bật TOTP -> 400', async () => {
    resetAppData();
    const res = await api('POST', '/api/auth/totp/reveal-secret', { password: '123456' }, ADMIN2);
    assert.strictEqual(res.status, 400);
  });

  await run('reveal-secret: sai mật khẩu -> 401, KHÔNG đổi gì', async () => {
    resetAppData();
    await enableTotpFor(ADMIN1);
    const before = APP_DATA.users.find(u => u.username === ADMIN1.username).totpSecretEnc;
    const res = await api('POST', '/api/auth/totp/reveal-secret', { password: 'saimatkhau' }, ADMIN1);
    assert.strictEqual(res.status, 401);
    const after = APP_DATA.users.find(u => u.username === ADMIN1.username).totpSecretEnc;
    assert.strictEqual(after, before, 'Bí mật TOTP không bị đổi khi sai mật khẩu');
  });

  await run('reveal-secret: đúng mật khẩu -> trả ĐÚNG bí mật ĐANG DÙNG (không sinh mới), gửi email báo', async () => {
    resetAppData();
    const { secret: originalSecret } = await enableTotpFor(ADMIN1);
    sentMailCount = 0;
    const res = await api('POST', '/api/auth/totp/reveal-secret', { password: '123456' }, ADMIN1);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.secret, originalSecret, 'Phải trả ĐÚNG bí mật đang dùng, không sinh bí mật mới');
    assert.ok(res.body.qrDataUrl.startsWith('data:image/'));
    assert.strictEqual(sentMailCount, 1, 'Phải gửi email báo khi xem lại bí mật TOTP');

    // Mã sinh ra từ bí mật vừa trả về vẫn xác thực được ở vòng đăng nhập 2 bước thật — chứng minh nó
    // ĐÚNG LÀ bí mật hệ thống đang lưu, không phải giá trị giả lập nào khác.
    const code = authenticator.generate(res.body.secret);
    await api('POST', '/api/auth/login', { username: ADMIN1.username, password: '123456' });
    const loginRes = await api('POST', '/api/auth/verify-totp-login', { username: ADMIN1.username, code });
    assert.strictEqual(loginRes.status, 200);
  });

  await run('reveal-secret: KHÔNG tăng sessionVersion (hành động "thêm", không phải "thu hồi lòng tin")', async () => {
    resetAppData();
    await enableTotpFor(ADMIN1);
    const before = APP_DATA.users.find(u => u.username === ADMIN1.username).sessionVersion || 0;
    await api('POST', '/api/auth/totp/reveal-secret', { password: '123456' }, ADMIN1);
    const after = APP_DATA.users.find(u => u.username === ADMIN1.username).sessionVersion || 0;
    assert.strictEqual(after, before);
  });

  server.close();
  console.log('');
  console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
})();
