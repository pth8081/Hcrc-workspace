// server/tests/test-admin-webauthn-reset.js
//
// Regression test cho tính năng "admin gỡ hộ thiết bị vân tay/Face ID của người khác" (khắc phục tình
// huống mất thiết bị/quên mật khẩu mà không còn cách nào tự đăng nhập để tự gỡ) — bước đầu tiên trên
// đường tới "bắt buộc xác thực 2 yếu tố cho tài khoản admin" mà người dùng đã yêu cầu.
//
//   1. GET /api/auth/webauthn/credentials/:username — CHỈ admin gọi được, trả đúng danh sách thiết bị
//      AN TOÀN (id/deviceLabel/createdAt) của ĐÚNG người được chỉ định, KHÔNG lộ publicKey/counter.
//   2. DELETE /api/auth/webauthn/credentials/:username/:id — CHỈ admin gọi được, gỡ đúng 1 thiết bị của
//      NGƯỜI KHÁC (không đụng thiết bị khác của họ, không đụng thiết bị người khác), tăng sessionVersion
//      của NGƯỜI ĐÓ (không phải của admin đang gọi).
//   3. Tài khoản không tồn tại -> 404, không làm gãy mảng users.
//
// Cùng khuôn test-audit-round2-cluster1.js: gọi thẳng express router THẬT (routes/auth.js) trong tiến
// trình Node, chỉ giả lập tầng lưu trữ (lib/appData) + middleware xác thực (lib/auth requireAuth).
//
// Chạy: node server/tests/test-admin-webauthn-reset.js
const http = require('http');
const path = require('path');

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
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const PLAIN = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Kinh Doanh', perms: {}, active: true };
const VICTIM = {
  username: 'nv2', name: 'Người Mất Điện Thoại', dept: 'Kinh Doanh', perms: {}, active: true,
  sessionVersion: 3,
  webauthnCredentials: [
    { id: 'cred-A', deviceLabel: 'iPhone cũ (đã mất)', createdAt: '01/01/2026 08:00', publicKey: 'BÍ MẬT-A', counter: 5 },
    { id: 'cred-B', deviceLabel: 'Laptop công ty', createdAt: '02/01/2026 09:00', publicKey: 'BÍ MẬT-B', counter: 2 }
  ]
};
const OTHER = {
  username: 'nv3', name: 'Người Khác', dept: 'IT', perms: {}, active: true,
  webauthnCredentials: [{ id: 'cred-C', deviceLabel: 'Điện thoại của nv3', createdAt: '03/01/2026 10:00', publicKey: 'BÍ MẬT-C', counter: 1 }]
};

function seedUsers() {
  return [ADMIN, PLAIN, JSON.parse(JSON.stringify(VICTIM)), JSON.parse(JSON.stringify(OTHER))];
}
let APP_DATA = { users: seedUsers() };
function resetAppData() { APP_DATA = { users: seedUsers() }; }

let CURRENT_USERNAME = ADMIN.username;

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  withLockedAppDataValue: async (key, fn) => {
    const updated = await fn(APP_DATA[key]);
    APP_DATA[key] = updated;
    return updated;
  }
});

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = APP_DATA.users.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, admin: !!fresh.perms?.admin };
    req.freshUser = fresh;
    req.allUsers = APP_DATA.users;
    next();
  },
  verifyPassword: async () => false,
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

async function api(method, urlPath, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, { method });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
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

  await run('Admin xem thiết bị của người khác -> trả đúng danh sách AN TOÀN (không lộ publicKey/counter)', async () => {
    resetAppData();
    const res = await api('GET', `/api/auth/webauthn/credentials/${VICTIM.username}`, ADMIN);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.length, 2);
    const ids = res.body.map(c => c.id).sort();
    assert.deepStrictEqual(ids, ['cred-A', 'cred-B']);
    assert.strictEqual(res.body[0].deviceLabel, VICTIM.webauthnCredentials[0].deviceLabel);
    assert.ok(!('publicKey' in res.body[0]), 'Không được lộ publicKey ra ngoài');
    assert.ok(!('counter' in res.body[0]), 'Không được lộ counter ra ngoài');
  });

  await run('Người dùng thường (không phải admin) xem thiết bị người khác -> 403, KHÔNG lộ danh sách', async () => {
    resetAppData();
    const res = await api('GET', `/api/auth/webauthn/credentials/${VICTIM.username}`, PLAIN);
    assert.strictEqual(res.status, 403);
    assert.ok(res.body.error);
  });

  await run('Xem thiết bị của tài khoản không tồn tại -> 404', async () => {
    resetAppData();
    const res = await api('GET', '/api/auth/webauthn/credentials/khong_ton_tai', ADMIN);
    assert.strictEqual(res.status, 404);
  });

  await run('Admin gỡ HỘ 1 thiết bị của người khác -> gỡ đúng 1 cái, KHÔNG đụng thiết bị còn lại', async () => {
    resetAppData();
    const res = await api('DELETE', `/api/auth/webauthn/credentials/${VICTIM.username}/cred-A`, ADMIN);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    const victim = APP_DATA.users.find(u => u.username === VICTIM.username);
    assert.strictEqual(victim.webauthnCredentials.length, 1, 'Chỉ còn đúng 1 thiết bị');
    assert.strictEqual(victim.webauthnCredentials[0].id, 'cred-B', 'Thiết bị còn lại phải là cái KHÔNG bị gỡ');
  });

  await run('Gỡ hộ -> tăng sessionVersion của NGƯỜI ĐÓ (đăng xuất mọi phiên cũ của họ)', async () => {
    resetAppData();
    await api('DELETE', `/api/auth/webauthn/credentials/${VICTIM.username}/cred-A`, ADMIN);
    const victim = APP_DATA.users.find(u => u.username === VICTIM.username);
    assert.strictEqual(victim.sessionVersion, (VICTIM.sessionVersion || 0) + 1);
  });

  await run('Gỡ hộ thiết bị người NÀY -> KHÔNG đụng gì tới thiết bị của người KHÁC (nv3)', async () => {
    resetAppData();
    await api('DELETE', `/api/auth/webauthn/credentials/${VICTIM.username}/cred-A`, ADMIN);
    const other = APP_DATA.users.find(u => u.username === OTHER.username);
    assert.strictEqual(other.webauthnCredentials.length, 1);
    assert.strictEqual(other.webauthnCredentials[0].id, 'cred-C');
  });

  await run('Người dùng thường (không phải admin) gỡ hộ thiết bị người khác -> 403, KHÔNG đổi gì', async () => {
    resetAppData();
    const res = await api('DELETE', `/api/auth/webauthn/credentials/${VICTIM.username}/cred-A`, PLAIN);
    assert.strictEqual(res.status, 403);
    const victim = APP_DATA.users.find(u => u.username === VICTIM.username);
    assert.strictEqual(victim.webauthnCredentials.length, 2, 'Không được đổi gì khi bị từ chối 403');
  });

  await run('Gỡ hộ thiết bị của tài khoản không tồn tại -> 404', async () => {
    resetAppData();
    const res = await api('DELETE', '/api/auth/webauthn/credentials/khong_ton_tai/cred-A', ADMIN);
    assert.strictEqual(res.status, 404);
  });

  server.close();
  console.log('');
  console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
})();
