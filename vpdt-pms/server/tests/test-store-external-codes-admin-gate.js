// server/tests/test-store-external-codes-admin-gate.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo lỗi kèm ảnh chụp khi cấu hình "Mã Điểm API Tồn Kho" ở màn
// Quản Lý Danh Mục > Danh Mục Siêu Thị): bấm lưu báo "Lỗi lưu dữ liệu 'storeExternalCodes' lên máy
// chủ: Key không hợp lệ: storeExternalCodes". Key này đã được khai báo đầy đủ ở client
// (setStoreExternalCode(), module-admin.js), ở route đọc (routes/shelfStock.js GET /system-inventory)
// và ở ADMIN_ONLY_KEYS (routes/data.js) — nhưng BỊ THIẾU trong DEFAULTS (defaults.js), nguồn duy nhất
// xây VALID_KEYS (routes/data.js: `new Set(Object.keys(DEFAULTS))`) — khiến route lưu chung luôn từ
// chối key này dù hợp lệ. Đã vá: thêm `storeExternalCodes: {}` vào defaults.js.
//
// Cùng khuôn test-approval-email-config-admin-gate.js: KHÔNG mở Playwright, chạy thẳng router express
// THẬT (routes/data.js) trong tiến trình Node, chỉ giả lập tầng lưu trữ (lib/appData) + middleware xác
// thực (lib/auth) — không cần SQL Server thật.
//
// Chạy: node server/tests/test-store-external-codes-admin-gate.js
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

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const PLAIN = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Kế Toán', perms: {}, active: true };
const USERS = [ADMIN, PLAIN];

const ORIGINAL_STORE_EXTERNAL_CODES = { 'Siêu Thị A': '100' };
const ORIGINAL_STORE_TYPES = { 'Siêu Thị A': 'LOAI_1' };
const APP_DATA = {
  users: USERS,
  storeExternalCodes: JSON.parse(JSON.stringify(ORIGINAL_STORE_EXTERNAL_CODES)),
  storeTypes: JSON.parse(JSON.stringify(ORIGINAL_STORE_TYPES))
};

function resetConfig() {
  APP_DATA.storeExternalCodes = JSON.parse(JSON.stringify(ORIGINAL_STORE_EXTERNAL_CODES));
  APP_DATA.storeTypes = JSON.parse(JSON.stringify(ORIGINAL_STORE_TYPES));
}

let CURRENT_USERNAME = ADMIN.username;

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAppDataValueWithVersion: async (key) => ({ value: APP_DATA[key] ?? null, version: 'v-test' }),
  getAllAppDataWithVersionsCached: async () => ({ data: { ...APP_DATA }, versions: {} }),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: 'v-test-2' }; },
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => `hashed:${p}`,
  isBcryptHash: (v) => String(v || '').startsWith('hashed:'),
  validatePin: () => null
});

const express = require('express');
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');
const dataRoutes = require('../routes/data');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
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
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('admin ghi được storeExternalCodes (gán Mã Điểm mới cho 1 siêu thị) — đúng kịch bản người dùng báo lỗi', async () => {
      resetConfig();
      const next = { 'Siêu Thị A': '100', 'Siêu Thị B': '217' };
      const ok = await api('POST', '/api/data/storeExternalCodes', next, ADMIN);
      assertEqual(ok.status, 200, 'Admin phải ghi được storeExternalCodes (trước khi vá: 400 "Key không hợp lệ")');
      assertEqual(JSON.stringify(APP_DATA.storeExternalCodes), JSON.stringify(next), 'Lượt ghi của admin phải có hiệu lực thật (đúng Mã Điểm vừa gửi)');
    });

    await run.run('non-admin KHÔNG được ghi POST /api/data/storeExternalCodes (403), dữ liệu KHÔNG đổi', async () => {
      resetConfig();
      const before = JSON.stringify(APP_DATA.storeExternalCodes);
      const denied = await api('POST', '/api/data/storeExternalCodes', { 'Siêu Thị A': '999' }, PLAIN);
      assertEqual(denied.status, 403, 'Tài khoản thường phải bị chặn ghi storeExternalCodes');
      assertIncludes(denied.body.error, 'Quản Trị Viên', 'Thông báo lỗi phải nêu rõ chỉ Quản Trị Viên mới sửa được');
      assertEqual(JSON.stringify(APP_DATA.storeExternalCodes), before, 'storeExternalCodes KHÔNG được đổi sau lượt ghi bị từ chối');
    });

    await run.run('mọi người đã đăng nhập vẫn đọc được storeExternalCodes (không có bí mật trong key này)', async () => {
      resetConfig();
      const res = await api('GET', '/api/data/storeExternalCodes', undefined, PLAIN);
      assertEqual(res.status, 200, 'Đọc storeExternalCodes phải mở cho mọi người đã đăng nhập');
      assertEqual(JSON.stringify(res.body), JSON.stringify(ORIGINAL_STORE_EXTERNAL_CODES), 'Giá trị đọc về phải nguyên vẹn');
    });

    await run.run('key chị em storeTypes vẫn lưu được bình thường (không hồi quy do thêm storeExternalCodes)', async () => {
      resetConfig();
      const next = { 'Siêu Thị A': 'LOAI_2' };
      const ok = await api('POST', '/api/data/storeTypes', next, ADMIN);
      assertEqual(ok.status, 200, 'Admin vẫn phải ghi được storeTypes như trước');
      assertEqual(JSON.stringify(APP_DATA.storeTypes), JSON.stringify(next), 'Lượt ghi storeTypes phải có hiệu lực thật');
    });

  } finally {
    server.close();
  }

  run.summary();
}

main().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
