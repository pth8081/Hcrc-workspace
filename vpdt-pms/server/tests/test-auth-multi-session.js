// server/tests/test-auth-multi-session.js
//
// Tính năng MỚI (11/2026, theo yêu cầu người dùng): "Bạn làm cho tôi một cái chức năng là cho phép có
// cái box cho phép user được login bao nhiêu phiên trên bao nhiêu máy tại một thời điểm, để tôi có thể
// lựa chọn là user nào có quyền login nhiều phiên tại một thời điểm." — thêm field
// user.maxConcurrentSessions (admin gán qua form Sửa Người Dùng), mặc định 1 nếu không đặt (giữ NGUYÊN
// hành vi gốc "1 tài khoản chỉ 1 kết nối tại 1 thời điểm" — xem test-auth-single-session.js, bài test
// RIÊNG đó vẫn phải pass y nguyên không cần sửa gì, xác nhận không có regression cho N=1).
//
// Thiết kế: thay sessionVersion (scalar DUY NHẤT, chỉ 2 trạng thái toàn-sống/toàn-chết) bằng
// user.activeSessions — 1 DANH SÁCH phiên đang được phép, giới hạn đúng maxConcurrentSessions, mỗi phần
// tử {jti, createdAt, lastSeenAt}. requireAuth() (lib/auth.js) đối chiếu "jti" ký trong token với danh
// sách này — phiên KHÔNG còn trong danh sách (bị loại vì vượt quá số phiên cho phép) mất hiệu lực NGAY,
// dù sessionVersion vẫn khớp. sessionVersion GIỮ NGUYÊN vai trò cũ: chỉ dùng cho "đá TOÀN BỘ phiên ngay"
// (đổi mật khẩu/PIN/gỡ TOTP/gỡ vân tay) — không phân biệt số phiên đồng thời, đá hết bất kể đang cho phép
// bao nhiêu.
//
// Cùng hạ tầng test (stub lib/appData trong RAM + db chỉ phục vụ EphemeralAuthTokens + lib/auth.js THẬT
// không stub) như test-auth-single-session.js — xem chú thích đầy đủ ở đó, không lặp lại ở đây.
//
// Bao phủ:
//   1. Tài khoản maxConcurrentSessions=3: đăng nhập LẦN LƯỢT 3 thiết bị -> KHÔNG thiết bị nào bị hỏi xác
//      nhận (còn chỗ trống mỗi lần) -> cả 3 phiên cùng sống đồng thời.
//   2. Thiết bị THỨ 4 đăng nhập (đã đủ 3, hết chỗ) -> hỏi xác nhận (phiên cũ nhất trong 3 vẫn "có thể còn
//      sống") -> xác nhận xong -> CHỈ thiết bị 1 (cũ nhất) bị đá, thiết bị 2/3/4 vẫn sống.
//   3. Đăng xuất (logout) ở 1 thiết bị (trong số đang có nhiều phiên) KHÔNG đá các thiết bị khác — khác
//      hẳn hành vi N=1 cũ (logout trước đây đá TOÀN BỘ qua sessionVersion).
//   4. Đổi mật khẩu (PATCH /me) ở 1 thiết bị vẫn đá TOÀN BỘ các thiết bị KHÁC đang mở (dù đang cho phép
//      nhiều phiên đồng thời) — chính thiết bị vừa đổi vẫn dùng được bình thường (re-sign).
//   5. Admin HẠ maxConcurrentSessions của 1 tài khoản đang có SẴN nhiều phiên xuống thấp hơn số đang có
//      (VD đang 3 phiên, hạ xuống 1) -> KHÔNG tự đá phiên nào ngay (chỉ ảnh hưởng ở lượt đăng nhập KẾ
//      TIẾP) -> cả 3 phiên cũ vẫn sống cho tới khi có 1 lượt đăng nhập MỚI, lúc đó phải loại đủ (2 phiên
//      cùng lúc) để vừa đúng giới hạn MỚI, và PHẢI hỏi xác nhận nếu bất kỳ phiên nào trong số bị loại đó
//      có thể còn sống (không chỉ kiểm phiên cũ nhất).
//   6. Mặc định (không đặt maxConcurrentSessions, hoặc đặt giá trị không hợp lệ qua chỉnh sửa trực tiếp
//      dữ liệu — 0/âm/chữ) -> coi như 1 (đúng getMaxConcurrentSessions(), lib/auth.js).
//
// Chạy: node server/tests/test-auth-multi-session.js
'use strict';
process.env.JWT_SECRET = 'test-jwt-secret-chi-dung-de-chay-test-khong-phai-bi-mat-that';
process.env.COOKIE_SECURE = 'false';

const http = require('http');
const path = require('path');
const assert = require('assert');
const jwt = require('jsonwebtoken'); // chỉ dùng để tự ký 1 token KHÔNG có "jti" — mô phỏng phiên ký từ TRƯỚC khi tính năng này triển khai

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const NV_MULTI = { username: 'nv_multi', name: 'Nhân Viên Nhiều Phiên', dept: 'Kinh Doanh', perms: {}, active: true, email: 'multi@x.com', maxConcurrentSessions: 3 };
const NV_SOLO = { username: 'nv_solo', name: 'Nhân Viên 1 Phiên', dept: 'Kinh Doanh', perms: {}, active: true, email: 'solo@x.com' };

function seedUsers() {
  return [JSON.parse(JSON.stringify(NV_MULTI)), JSON.parse(JSON.stringify(NV_SOLO))];
}
let APP_DATA = { users: seedUsers() };

stubModule('lib/mailer', { sendMail: async () => ({ ok: true }), resolveEncryption: () => 'NONE', hasAuthConfigured: () => false });
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

const express = require('express');
const cookieParser = require('cookie-parser');
const authRoutes = require('../routes/auth');
const { requireAuth } = require('../lib/auth');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRoutes);
  app.get('/api/_probe', requireAuth, (req, res) => res.json({ username: req.user.username }));
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

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
      if (setCookie) cookie = setCookie.split(';')[0];
      let payload = null;
      try { payload = await res.json(); } catch (e) { payload = null; }
      return { status: res.status, body: payload };
    },
    hasCookie() { return !!cookie; },
    // Ký TAY 1 token KHÔNG có "jti" — mô phỏng đúng 1 phiên đăng nhập THẬT đã tồn tại TỪ TRƯỚC khi tính
    // năng N-phiên-đồng-thời này triển khai (signToken() thật từ bản vá này trở đi LUÔN kèm "jti").
    setRawCookieNoJti(username, sv) {
      const token = jwt.sign({ sub: username, admin: false, sv: sv || 0 }, process.env.JWT_SECRET, { expiresIn: '8h' });
      cookie = `vpdt_token=${token}`;
    }
  };
}

async function login(device, user, password) {
  return device.call('POST', '/api/auth/login', { username: user.username, password: password || '123456' });
}
async function probe(device) {
  return device.call('GET', '/api/_probe');
}
async function confirmKick(device, username) {
  return device.call('POST', '/api/auth/confirm-kick-session', { username });
}
async function loginAndConfirm(device, user, password) {
  const res = await login(device, user, password);
  if (res.status === 200 && res.body && res.body.confirmKickRequired) {
    return confirmKick(device, res.body.username);
  }
  return res;
}

async function main() {
  const { hashPassword } = require('../lib/auth');
  const realHash = await hashPassword('123456');
  const withHashedPass = (u) => ({ ...u, pass: realHash });
  const reseed = (overrides = {}) => {
    const multi = { ...NV_MULTI, ...(overrides.multi || {}) };
    APP_DATA = { users: [multi, NV_SOLO].map(withHashedPass).map(u => JSON.parse(JSON.stringify(u))) };
  };

  const server = await startApp();
  let passed = 0, failed = 0;
  async function run(name, fn) {
    try { await fn(); passed++; console.log(`PASS  ${name}`); }
    catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
  }

  try {
    await run('maxConcurrentSessions=3: đăng nhập LẦN LƯỢT 3 thiết bị -> KHÔNG thiết bị nào bị hỏi xác nhận, cả 3 cùng sống đồng thời', async () => {
      reseed();
      const d1 = newDevice(), d2 = newDevice(), d3 = newDevice();
      const l1 = await login(d1, NV_MULTI); assert.strictEqual(l1.status, 200); assert.ok(!l1.body.confirmKickRequired, 'Thiết bị 1: còn chỗ trống (0/3) -> không hỏi');
      const l2 = await login(d2, NV_MULTI); assert.strictEqual(l2.status, 200); assert.ok(!l2.body.confirmKickRequired, 'Thiết bị 2: còn chỗ trống (1/3) -> không hỏi');
      const l3 = await login(d3, NV_MULTI); assert.strictEqual(l3.status, 200); assert.ok(!l3.body.confirmKickRequired, 'Thiết bị 3: còn chỗ trống (2/3) -> không hỏi');
      assert.strictEqual((await probe(d1)).status, 200, 'Thiết bị 1 vẫn phải còn sống');
      assert.strictEqual((await probe(d2)).status, 200, 'Thiết bị 2 vẫn phải còn sống');
      assert.strictEqual((await probe(d3)).status, 200, 'Thiết bị 3 vẫn phải còn sống — cả 3 phiên cùng hợp lệ đồng thời');
    });

    await run('Thiết bị THỨ 4 (đã đủ 3/3, hết chỗ) -> hỏi xác nhận -> xác nhận xong CHỈ đá thiết bị 1 (cũ nhất), thiết bị 2/3/4 vẫn sống', async () => {
      reseed();
      const d1 = newDevice(), d2 = newDevice(), d3 = newDevice(), d4 = newDevice();
      await login(d1, NV_MULTI);
      await login(d2, NV_MULTI);
      await login(d3, NV_MULTI);
      const l4 = await login(d4, NV_MULTI);
      assert.strictEqual(l4.status, 200);
      assert.strictEqual(l4.body.confirmKickRequired, true, 'Đã đủ 3/3 (hết chỗ), phiên cũ nhất (thiết bị 1) còn có thể sống -> phải hỏi xác nhận');
      assert.ok(!d4.hasCookie(), 'Chưa cấp cookie khi mới confirmKickRequired');
      assert.strictEqual((await probe(d1)).status, 200, 'Thiết bị 1 vẫn còn sống khi d4 mới nhận confirmKickRequired, chưa xác nhận');

      const confirm4 = await confirmKick(d4, l4.body.username);
      assert.strictEqual(confirm4.status, 200);
      assert.ok(d4.hasCookie());

      assert.strictEqual((await probe(d1)).status, 401, 'Thiết bị 1 (cũ nhất) phải bị đá sau khi xác nhận');
      assert.strictEqual((await probe(d2)).status, 200, 'Thiết bị 2 KHÔNG bị ảnh hưởng (chỉ đá ĐÚNG 1 phiên cũ nhất, không đá cả loạt)');
      assert.strictEqual((await probe(d3)).status, 200, 'Thiết bị 3 KHÔNG bị ảnh hưởng');
      assert.strictEqual((await probe(d4)).status, 200, 'Thiết bị 4 (mới xác nhận) dùng được bình thường');
    });

    await run('Đăng xuất (logout) ở 1 thiết bị trong số nhiều phiên KHÔNG đá các thiết bị khác (khác N=1: logout trước đây đá TOÀN BỘ)', async () => {
      reseed();
      const d1 = newDevice(), d2 = newDevice(), d3 = newDevice();
      await login(d1, NV_MULTI);
      await login(d2, NV_MULTI);
      await login(d3, NV_MULTI);
      const logoutRes = await d2.call('POST', '/api/auth/logout');
      assert.strictEqual(logoutRes.status, 200);
      assert.strictEqual((await probe(d2)).status, 401, 'Chính thiết bị vừa đăng xuất phải mất hiệu lực');
      assert.strictEqual((await probe(d1)).status, 200, 'Thiết bị 1 KHÔNG bị ảnh hưởng bởi logout của thiết bị 2');
      assert.strictEqual((await probe(d3)).status, 200, 'Thiết bị 3 KHÔNG bị ảnh hưởng bởi logout của thiết bị 2');
    });

    await run('Đổi mật khẩu (PATCH /me) ở 1 thiết bị vẫn đá TOÀN BỘ thiết bị KHÁC (dù đang cho phép nhiều phiên đồng thời) — chính thiết bị vừa đổi vẫn dùng được', async () => {
      reseed();
      const d1 = newDevice(), d2 = newDevice(), d3 = newDevice();
      await login(d1, NV_MULTI);
      await login(d2, NV_MULTI);
      await login(d3, NV_MULTI);
      const changePw = await d2.call('PATCH', '/api/auth/me', { password: 'MatKhauMoi!2026xyz', currentPassword: '123456' });
      assert.strictEqual(changePw.status, 200, JSON.stringify(changePw.body));
      assert.strictEqual((await probe(d2)).status, 200, 'Thiết bị vừa đổi mật khẩu (d2) phải vẫn dùng được (re-sign đúng phiên hiện tại)');
      assert.strictEqual((await probe(d1)).status, 401, 'Thiết bị 1 phải bị đá (đổi mật khẩu đá TOÀN BỘ phiên khác, không phân biệt số phiên đồng thời cho phép)');
      assert.strictEqual((await probe(d3)).status, 401, 'Thiết bị 3 phải bị đá — cùng lý do');
    });

    await run('Admin HẠ maxConcurrentSessions (3 -> 1) khi tài khoản đang có SẴN 3 phiên -> KHÔNG tự đá ai ngay; lượt đăng nhập KẾ TIẾP phải loại đủ 2 phiên 1 lúc + hỏi xác nhận đúng (không chỉ kiểm phiên cũ nhất)', async () => {
      reseed();
      const d1 = newDevice(), d2 = newDevice(), d3 = newDevice(), d4 = newDevice();
      await login(d1, NV_MULTI);
      await login(d2, NV_MULTI);
      await login(d3, NV_MULTI);
      assert.strictEqual((await probe(d1)).status, 200);
      assert.strictEqual((await probe(d2)).status, 200);
      assert.strictEqual((await probe(d3)).status, 200);

      // Admin hạ maxConcurrentSessions xuống 1 (mô phỏng thao tác lưu qua form, ghi thẳng appData — cùng
      // field "record.maxConcurrentSessions" mà routes/data.js prepareUsersForSave() ghi vào).
      APP_DATA.users = APP_DATA.users.map(u => u.username === NV_MULTI.username ? { ...u, maxConcurrentSessions: 1 } : u);

      // KHÔNG đá ai ngay — cả 3 phiên cũ vẫn sống nguyên cho tới khi có đăng nhập MỚI.
      assert.strictEqual((await probe(d1)).status, 200, 'Hạ maxConcurrentSessions KHÔNG tự đá phiên đang mở nào ngay lập tức');
      assert.strictEqual((await probe(d2)).status, 200);
      assert.strictEqual((await probe(d3)).status, 200);

      // Đăng nhập thiết bị thứ 4 -> giới hạn MỚI là 1, đang có 3 -> phải loại 3 phiên (d1,d2,d3) để nhường
      // đúng 1 chỗ cho d4 -> trong 3 phiên bị loại CHẮC CHẮN có phiên còn sống (mới đăng nhập) -> phải hỏi
      // xác nhận (không được đá âm thầm).
      const l4 = await login(d4, NV_MULTI);
      assert.strictEqual(l4.status, 200);
      assert.strictEqual(l4.body.confirmKickRequired, true, 'Phải hỏi xác nhận vì trong số (nhiều) phiên sẽ bị loại có phiên còn sống — không chỉ kiểm riêng phiên cũ nhất');
      assert.strictEqual((await probe(d1)).status, 200, 'Chưa xác nhận -> chưa đá ai');

      const confirm4 = await confirmKick(d4, l4.body.username);
      assert.strictEqual(confirm4.status, 200);
      assert.strictEqual((await probe(d1)).status, 401, 'Sau xác nhận: d1 phải bị đá (loại đủ để vừa giới hạn mới = 1)');
      assert.strictEqual((await probe(d2)).status, 401, 'd2 phải bị đá');
      assert.strictEqual((await probe(d3)).status, 401, 'd3 phải bị đá — giới hạn mới chỉ còn đúng 1 chỗ (d4)');
      assert.strictEqual((await probe(d4)).status, 200, 'd4 (mới xác nhận) dùng được bình thường');
    });

    await run('maxConcurrentSessions KHÔNG hợp lệ (0/âm/chữ, chỉnh thẳng dữ liệu) -> coi như 1 (mặc định an toàn)', async () => {
      reseed({ multi: { maxConcurrentSessions: 0 } });
      const d1 = newDevice(), d2 = newDevice();
      await login(d1, NV_MULTI);
      const l2 = await login(d2, NV_MULTI);
      assert.strictEqual(l2.body.confirmKickRequired, true, 'maxConcurrentSessions=0 (không hợp lệ) phải coi như 1 -> thiết bị 2 phải hỏi xác nhận như N=1 bình thường');
      await confirmKick(d2, l2.body.username);
      assert.strictEqual((await probe(d1)).status, 401, 'Sau xác nhận, d1 phải bị đá (đúng hành vi N=1)');
      assert.strictEqual((await probe(d2)).status, 200);
    });

    await run('Tài khoản KHÔNG được cấp maxConcurrentSessions (nv_solo, mặc định) vẫn đúng hành vi N=1 — không bị ảnh hưởng bởi tính năng mới', async () => {
      reseed();
      const d1 = newDevice(), d2 = newDevice();
      await login(d1, NV_SOLO);
      const l2 = await login(d2, NV_SOLO);
      assert.strictEqual(l2.body.confirmKickRequired, true);
      await confirmKick(d2, l2.body.username);
      assert.strictEqual((await probe(d1)).status, 401);
      assert.strictEqual((await probe(d2)).status, 200);
    });

    await run('Token KHÔNG có "jti" (ký từ TRƯỚC khi triển khai tính năng này, đang là phiên THẬT đang sống) -> vẫn được CHO QUA bình thường (không ép đăng xuất ngay lúc vừa deploy)', async () => {
      reseed();
      const legacy = newDevice();
      legacy.setRawCookieNoJti(NV_MULTI.username, 0);
      assert.strictEqual((await probe(legacy)).status, 200, 'Token không có jti phải được chấp nhận (grandfathered) — không có gì để đối chiếu với activeSessions nên bỏ qua kiểm theo danh sách');
    });

    await run('Đăng nhập THÊM 1 thiết bị MỚI (có jti) trong khi phiên legacy (không-jti) đang sống -> KHÔNG đụng gì tới phiên legacy (2 cơ chế độc lập, legacy chỉ bị ảnh hưởng bởi sv)', async () => {
      reseed();
      const legacy = newDevice();
      legacy.setRawCookieNoJti(NV_MULTI.username, 0);
      assert.strictEqual((await probe(legacy)).status, 200);

      const d1 = newDevice();
      const l1 = await login(d1, NV_MULTI);
      assert.strictEqual(l1.status, 200);
      assert.ok(!l1.body.confirmKickRequired, 'activeSessions đang rỗng (phiên legacy không nằm trong danh sách này) -> còn chỗ trống -> không cần hỏi');
      assert.strictEqual((await probe(d1)).status, 200);
      assert.strictEqual((await probe(legacy)).status, 200, 'Phiên legacy KHÔNG bị ảnh hưởng bởi lượt đăng nhập mới (2 cơ chế kiểm độc lập — sv không đổi, jti không áp dụng cho token không-jti)');
    });

    await run('Đăng xuất (logout) bằng token KHÔNG có "jti" -> dùng lại cơ chế CŨ (tăng sessionVersion) để vẫn đá NGAY được chính phiên đó', async () => {
      reseed();
      const legacy = newDevice();
      legacy.setRawCookieNoJti(NV_MULTI.username, 0);
      assert.strictEqual((await probe(legacy)).status, 200);
      const logoutRes = await legacy.call('POST', '/api/auth/logout');
      assert.strictEqual(logoutRes.status, 200);
      assert.strictEqual((await probe(legacy)).status, 401, 'Phiên legacy phải mất hiệu lực ngay sau khi đăng xuất (qua nhánh sv-bump dự phòng, vì không có jti để gỡ theo danh sách)');
    });
  } finally {
    server.close();
  }

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
