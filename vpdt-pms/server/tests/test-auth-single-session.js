// server/tests/test-auth-single-session.js
//
// Regression test cho yêu cầu người dùng (10/2026): "1 tài khoản chỉ sử dụng 1 kết nối tại 1 thời điểm,
// login gần nhất sẽ đá văng phiên login cũ hơn". Triển khai bằng cách tận dụng ĐÚNG cơ chế sessionVersion
// có sẵn (trước đây chỉ tăng khi đổi mật khẩu/PIN/gỡ TOTP để vô hiệu hoá các phiên cũ — xem
// lib/auth.js requireAuth() so payload.sv với DB) — giờ CŨNG tăng ở mọi lượt CẤP PHIÊN đăng nhập thành
// công (routes/auth.js: POST /login nhánh không cần 2FA, POST /verify-totp-login, POST
// /webauthn/login-verify).
//
// KHÁC test-admin-totp.js/test-admin-webauthn-reset.js: 2 file đó stub HẲN lib/auth (signToken/
// requireAuth giả lập, không đụng JWT/cookie thật) — bài test NÀY cố ý giữ lib/auth.js THẬT (chỉ đặt
// JWT_SECRET giả cho đủ điều kiện chạy) vì chính cơ chế ký/kiểm token + so sánh sessionVersion đó mới là
// thứ cần kiểm — stub nó đi thì test không còn ý nghĩa gì. Chỉ stub 4 lớp lưu trữ/phụ trợ không liên quan
// tới xác thực: lib/appData (users giả lập trong RAM), db (getPool/sql, chỉ để insertSystemLog() không
// crash), lib/captcha (tắt hẳn), lib/mailer + lib/emailCrypto (không gửi mail thật, chỉ cần không crash
// khi TOTP setup/gỡ).
//
// Bao phủ:
//   1. Đăng nhập thường (không TOTP): lượt đăng nhập THỨ 2 (thiết bị khác) phải đá phiên THỨ NHẤT ngay ở
//      request kế tiếp của phiên đó (401), phiên MỚI vẫn dùng bình thường.
//   2. Cùng 1 tài khoản đăng nhập LẦN LƯỢT 3 thiết bị -> chỉ thiết bị CUỐI CÙNG còn hiệu lực.
//   3. Tài khoản KHÁC đăng nhập không ảnh hưởng gì tới phiên đang mở của tài khoản này (đá đúng người,
//      không đá nhầm người khác).
//   4. Admin bật TOTP: bước 1 (mật khẩu đúng, CHƯA qua bước 2) KHÔNG được đá phiên đang mở ở thiết bị
//      khác — chỉ khi bước 2 (verify-totp-login) hoàn tất thật, phiên MỚI mới thật sự được cấp và lúc đó
//      mới đá phiên cũ. Tránh tình huống gõ đúng mật khẩu rồi bỏ dở/gõ sai mã TOTP làm mất oan phiên đang
//      dùng ở máy khác.
//   5. Đăng xuất (POST /logout, cơ chế sessionVersion đã có từ trước) vẫn hoạt động bình thường, không bị
//      đợt sửa này ảnh hưởng.
//
// Chạy: node server/tests/test-auth-single-session.js
'use strict';
process.env.JWT_SECRET = 'test-jwt-secret-chi-dung-de-chay-test-khong-phai-bi-mat-that';
process.env.COOKIE_SECURE = 'false'; // test chạy qua http thuần (127.0.0.1), tắt cờ Secure cho cookie

const http = require('http');
const path = require('path');
const assert = require('assert');
const { authenticator } = require('otplib');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

// ===================== Seed =====================
const ADMIN_TOTP = { username: 'admin_totp', name: 'Admin Có TOTP', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, email: 'admintotp@x.com' };
const NV_A = { username: 'nv_a', name: 'Nhân Viên A', dept: 'Kinh Doanh', perms: {}, active: true, email: 'a@x.com' };
const NV_B = { username: 'nv_b', name: 'Nhân Viên B', dept: 'Kinh Doanh', perms: {}, active: true, email: 'b@x.com' };

function seedUsers() {
  return [JSON.parse(JSON.stringify(ADMIN_TOTP)), JSON.parse(JSON.stringify(NV_A)), JSON.parse(JSON.stringify(NV_B))];
}
let APP_DATA = { users: seedUsers() };
function resetAppData() { APP_DATA = { users: seedUsers() }; }

stubModule('lib/mailer', {
  sendMail: async () => ({ ok: true }),
  resolveEncryption: () => 'NONE',
  hasAuthConfigured: () => false
});
stubModule('lib/emailCrypto', {
  encryptSecret: (plain) => `ENC(${plain})`,
  decryptSecret: (packed) => (/^ENC\((.*)\)$/.exec(packed || '') || [, ''])[1]
});
stubModule('lib/captcha', { isCaptchaEnabled: () => false, verifyCaptcha: async () => true });

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAppDataValueCached: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  withLockedAppDataValue: async (key, fn) => {
    const updated = await fn(APP_DATA[key]);
    APP_DATA[key] = updated;
    return updated;
  }
});

// dbo.EphemeralAuthTokens giả lập trong RAM — lib/totp.js dùng để lưu trạng thái đăng nhập 2 bước đang
// chờ (pendingLogins), cùng khuôn test-admin-totp.js.
const ephemeralTokens = new Map();
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
  sql: (() => {
    const handler = { get: (target, prop) => (prop === Symbol.toPrimitive ? undefined : sqlProxy), apply: () => sqlProxy };
    const sqlProxy = new Proxy(function () {}, handler);
    return sqlProxy;
  })()
});

// ===================== Require code THẬT (sau khi đã cắm bản giả lập của lớp lưu trữ) =====================
const express = require('express');
const cookieParser = require('cookie-parser');
const authRoutes = require('../routes/auth');
const { requireAuth } = require('../lib/auth'); // THẬT — không stub, đây chính là thứ cần kiểm

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  // Route test-only, dùng requireAuth() THẬT — mô phỏng 1 API nghiệp vụ bất kỳ để kiểm tra phiên còn
  // sống hay đã bị đá, không cần mount toàn bộ app thật.
  app.get('/api/_probe', requireAuth, (req, res) => res.json({ username: req.user.username }));
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

// Cookie jar THỦ CÔNG — fetch() của Node không tự quản lý cookie qua nhiều request như trình duyệt thật,
// nên mô phỏng "1 thiết bị/trình duyệt" bằng 1 biến string cookie riêng, tự đọc Set-Cookie rồi tự gắn lại
// Cookie ở lượt gọi kế tiếp CỦA ĐÚNG THIẾT BỊ ĐÓ — 2 "thiết bị" khác nhau dùng 2 biến cookie độc lập,
// đúng bản chất "2 trình duyệt/máy khác nhau, không chia sẻ cookie storage".
function newDevice() {
  let cookie = '';
  return {
    async call(method, urlPath, body) {
      const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {})
        },
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0]; // "vpdt_token=..." — bỏ các thuộc tính (Path/HttpOnly...)
      let payload = null;
      try { payload = await res.json(); } catch (e) { payload = null; }
      return { status: res.status, body: payload };
    },
    hasCookie() { return !!cookie; }
  };
}

async function login(device, user, password) {
  return device.call('POST', '/api/auth/login', { username: user.username, password: password || '123456' });
}
async function probe(device) {
  return device.call('GET', '/api/_probe');
}

// Mật khẩu giả lập "123456" cho mọi user (không hash thật — verifyPassword thật của lib/auth cần bcrypt,
// nên seed field `pass` bằng hash bcrypt THẬT qua chính hashPassword() thật, không giả lập chuỗi tay).
async function main() {
  const { hashPassword } = require('../lib/auth');
  const realHash = await hashPassword('123456');
  const withHashedPass = (u) => ({ ...u, pass: realHash });
  const reseed = () => {
    APP_DATA = { users: [ADMIN_TOTP, NV_A, NV_B].map(withHashedPass).map(u => JSON.parse(JSON.stringify(u))) };
  };

  const server = await startApp();
  let passed = 0, failed = 0;
  async function run(name, fn) {
    try { await fn(); passed++; console.log(`PASS  ${name}`); }
    catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }

  try {
    await run('Đăng nhập lần 2 (thiết bị B) đá phiên lần 1 (thiết bị A) — A bị 401 ở request kế tiếp, B vẫn dùng được', async () => {
      reseed();
      const deviceA = newDevice(), deviceB = newDevice();
      const loginA = await login(deviceA, NV_A);
      assert.strictEqual(loginA.status, 200);
      assert.ok(deviceA.hasCookie(), 'Phải nhận được cookie phiên sau khi đăng nhập thành công');
      const probeA1 = await probe(deviceA);
      assert.strictEqual(probeA1.status, 200, 'Phiên A còn sống trước khi B đăng nhập');

      const loginB = await login(deviceB, NV_A); // CÙNG tài khoản nv_a, thiết bị KHÁC
      assert.strictEqual(loginB.status, 200);

      const probeA2 = await probe(deviceA);
      assert.strictEqual(probeA2.status, 401, 'Phiên A phải bị đá NGAY sau khi B đăng nhập thành công (cùng tài khoản)');
      assert.match(probeA2.body.error, /Mật khẩu\/PIN vừa được thay đổi|đăng nhập lại/, 'Lỗi trả về phải đúng nhánh sv-mismatch của requireAuth()');

      const probeB = await probe(deviceB);
      assert.strictEqual(probeB.status, 200, 'Phiên B (mới nhất) vẫn phải dùng được bình thường');
      assert.strictEqual(probeB.body.username, NV_A.username);
    });

    await run('3 thiết bị đăng nhập lần lượt -> chỉ thiết bị THỨ 3 (cuối cùng) còn sống, 2 thiết bị trước đều bị đá', async () => {
      reseed();
      const d1 = newDevice(), d2 = newDevice(), d3 = newDevice();
      await login(d1, NV_A);
      await login(d2, NV_A);
      await login(d3, NV_A);
      assert.strictEqual((await probe(d1)).status, 401, 'Thiết bị 1 phải bị đá');
      assert.strictEqual((await probe(d2)).status, 401, 'Thiết bị 2 phải bị đá (kể cả khi đã bị đá TIẾP bởi thiết bị 3, không chỉ thiết bị 1 mới đá được)');
      assert.strictEqual((await probe(d3)).status, 200, 'Chỉ thiết bị 3 (mới nhất) còn sống');
    });

    await run('Tài khoản KHÁC đăng nhập KHÔNG đá phiên của tài khoản này — chỉ đá đúng người vừa đăng nhập lại', async () => {
      reseed();
      const deviceA = newDevice(), deviceOther = newDevice();
      await login(deviceA, NV_A);
      await login(deviceOther, NV_B); // tài khoản KHÁC hẳn (nv_b), không liên quan tới nv_a
      const probeA = await probe(deviceA);
      assert.strictEqual(probeA.status, 200, 'Phiên nv_a KHÔNG được phép bị ảnh hưởng bởi lượt đăng nhập của nv_b');
    });

    await run('Admin bật TOTP: mật khẩu đúng nhưng CHƯA qua bước 2 -> KHÔNG được đá phiên đang mở ở thiết bị khác', async () => {
      reseed();
      // Bật TOTP thật cho ADMIN_TOTP qua đúng luồng setup-options/setup-verify.
      const setupDevice = newDevice();
      const options = await setupDevice.call('POST', '/api/auth/totp/setup-options', {});
      // setup-options tự yêu cầu ĐÃ đăng nhập (requireAuth thật) — đăng nhập trước bằng chính tài khoản
      // này (lúc này totpEnabled vẫn false nên đăng nhập bình thường, không totpRequired).
      // -> làm lại đúng thứ tự: đăng nhập trước, rồi mới gọi setup-options bằng CÙNG cookie đó.
      const bootDevice = newDevice();
      const bootLogin = await login(bootDevice, ADMIN_TOTP);
      assert.strictEqual(bootLogin.status, 200, 'Đăng nhập lần đầu (chưa bật TOTP) phải bình thường, không totpRequired');
      const opts2 = await bootDevice.call('POST', '/api/auth/totp/setup-options', {});
      assert.strictEqual(opts2.status, 200);
      const code0 = authenticator.generate(opts2.body.secret);
      const verify0 = await bootDevice.call('POST', '/api/auth/totp/setup-verify', { code: code0 });
      assert.strictEqual(verify0.body.ok, true, 'Bật TOTP thành công');
      const totpSecret = opts2.body.secret;

      // "Đăng nhập lần đầu" (bootDevice) ĐÃ tự tăng sessionVersion 1 lần khi login (vì admin CHƯA bật TOTP
      // lúc đó) — nay coi bootDevice là "phiên đang mở ở thiết bị A" cần bảo toàn.
      const deviceB = newDevice();
      const step1 = await login(deviceB, ADMIN_TOTP);
      assert.strictEqual(step1.status, 200);
      assert.strictEqual(step1.body.totpRequired, true, 'Admin đã bật TOTP -> mật khẩu đúng vẫn phải yêu cầu bước 2');
      assert.ok(!deviceB.hasCookie(), 'CHƯA cấp cookie phiên ở bước 1 (chỉ mật khẩu đúng)');

      const probeBoot = await probe(bootDevice);
      assert.strictEqual(probeBoot.status, 200, 'Phiên đang mở (bootDevice) KHÔNG được đá chỉ vì có người gõ đúng mật khẩu ở bước 1 tại thiết bị khác — phải đợi bước 2 hoàn tất thật');

      // Hoàn tất bước 2 THẬT -> bây giờ mới thật sự cấp phiên mới -> mới đá phiên cũ.
      const code = authenticator.generate(totpSecret);
      const step2 = await deviceB.call('POST', '/api/auth/verify-totp-login', { username: ADMIN_TOTP.username, code });
      assert.strictEqual(step2.status, 200);
      assert.ok(deviceB.hasCookie(), 'Bước 2 thành công phải cấp cookie phiên thật');

      const probeBootAfter = await probe(bootDevice);
      assert.strictEqual(probeBootAfter.status, 401, 'Sau khi bước 2 hoàn tất thật ở thiết bị B, phiên cũ (bootDevice) phải bị đá');
      const probeB = await probe(deviceB);
      assert.strictEqual(probeB.status, 200, 'Phiên mới (thiết bị B, vừa hoàn tất bước 2) phải dùng được');
    });

    await run('Đăng xuất (POST /logout) vẫn hoạt động bình thường, không bị đợt sửa sessionVersion-khi-đăng-nhập ảnh hưởng', async () => {
      reseed();
      const device = newDevice();
      await login(device, NV_A);
      assert.strictEqual((await probe(device)).status, 200);
      const logoutRes = await device.call('POST', '/api/auth/logout');
      assert.strictEqual(logoutRes.status, 200);
      const probeAfter = await probe(device);
      assert.strictEqual(probeAfter.status, 401, 'Sau khi đăng xuất, chính phiên vừa đăng xuất cũng phải mất hiệu lực (sessionVersion tự tăng, cơ chế đã có từ trước)');
    });
  } finally {
    server.close();
  }

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
