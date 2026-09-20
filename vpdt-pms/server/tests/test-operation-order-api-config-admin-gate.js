// server/tests/test-operation-order-api-config-admin-gate.js
//
// LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Thấp): key `operationOrderApiConfig` (Cấu Hình API đồng bộ
// Đơn Hàng ra hệ thống ngoài dsmart16) trước đây được phát cho MỌI tài khoản đã đăng nhập qua
// GET /api/data (và GET /api/data/operationOrderApiConfig) — bí mật headerValueEnc vốn đã bị strip an
// toàn, NHƯNG baseUrl/headerName/syncIntervalMinutes/lastSyncMessage vẫn lộ nguyên (địa chỉ hệ thống nội
// bộ + tên header xác thực + thông điệp lỗi đồng bộ). Cả màn đọc lẫn ghi cấu hình này đều là màn ADMIN
// (sub-tab "Cấu Hình API"), ghi đã gác ADMIN_ONLY_KEYS từ trước — nay ĐỌC cũng chỉ admin mới thấy nội
// dung, cùng khuôn sanitizeExternalApiKeys()/sanitizeAttendanceClockApiKeys().
//
// Cùng khuôn tests/test-approval-email-config-admin-gate.js: chạy thẳng router THẬT (routes/data.js),
// chỉ giả lập lib/appData + lib/auth — không cần SQL Server thật.
//
// Chạy: node server/tests/test-operation-order-api-config-admin-gate.js
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
const PLAIN = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Siêu Thị Q1', perms: { operationOrderCreate: true }, active: true };
const USERS = [ADMIN, PLAIN];

const ORIGINAL_CONFIG = {
  enabled: true,
  baseUrl: 'http://10.10.10.25:8088/dsmart16',      // hạ tầng nội bộ — KHÔNG được lộ cho người thường
  headerName: 'X-Dsmart-Token',
  headerValueEnc: 'enc:super-secret',                // bí mật — không bao giờ trả ra, kể cả cho admin
  matchingKey: 'poNumber', syncIntervalMinutes: 60,
  lastSyncAt: '2026-09-19T02:00:00.000Z', lastSyncStatus: 'FAILED',
  lastSyncMessage: 'ECONNREFUSED 10.10.10.25:8088'
};
const APP_DATA = { users: USERS, operationOrderApiConfig: JSON.parse(JSON.stringify(ORIGINAL_CONFIG)) };

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
const { createRunner, assert, assertEqual } = require('./testHarness');
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
    await run.run('LỖI ĐÃ VÁ: người KHÔNG phải admin đọc GET /api/data/operationOrderApiConfig -> KHÔNG còn thấy baseUrl/headerName', async () => {
      const res = await api('GET', '/api/data/operationOrderApiConfig', undefined, PLAIN);
      assertEqual(res.status, 200, 'Vẫn trả 200 (không phá client cũ), nhưng nội dung phải rỗng');
      const raw = JSON.stringify(res.body || {});
      assert(!raw.includes('10.10.10.25'), `Địa chỉ hạ tầng nội bộ vẫn bị lộ: ${raw}`);
      assert(!raw.includes('X-Dsmart-Token'), `Tên header xác thực vẫn bị lộ: ${raw}`);
      assert(!raw.includes('ECONNREFUSED'), `Thông điệp lỗi đồng bộ vẫn bị lộ: ${raw}`);
    });

    // Vòng phát chung GET /api/data dùng CHUNG đúng hàm sanitizeOperationOrderApiConfig(value, isAdmin)
    // này (xem routes/data.js) nên không kiểm lại ở đây — route đó còn đọc ~14 collection từ SQL Server
    // thật, không chạy được trong test thuần Node.
    await run.run('admin VẪN đọc được đầy đủ cấu hình (trừ bí mật headerValueEnc — chỉ còn cờ hasHeaderValue)', async () => {
      const res = await api('GET', '/api/data/operationOrderApiConfig', undefined, ADMIN);
      assertEqual(res.status, 200);
      assertEqual(res.body.baseUrl, ORIGINAL_CONFIG.baseUrl, 'Admin phải thấy baseUrl để sửa cấu hình');
      assertEqual(res.body.headerName, ORIGINAL_CONFIG.headerName);
      assertEqual(res.body.hasHeaderValue, true, 'Phải báo "đã cấu hình giá trị header"');
      assertEqual(res.body.headerValueEnc, undefined, 'Bí mật KHÔNG bao giờ trả ra, kể cả cho admin');
    });

    await run.run('Ghi operationOrderApiConfig vẫn CHỈ admin (ADMIN_ONLY_KEYS, hành vi cũ không đổi)', async () => {
      const before = JSON.stringify(APP_DATA.operationOrderApiConfig);
      const denied = await api('POST', '/api/data/operationOrderApiConfig', { enabled: false, baseUrl: 'http://evil' }, PLAIN);
      assertEqual(denied.status, 403, 'Người thường phải bị chặn ghi');
      assertEqual(JSON.stringify(APP_DATA.operationOrderApiConfig), before, 'Dữ liệu không đổi sau lượt ghi bị từ chối');
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
