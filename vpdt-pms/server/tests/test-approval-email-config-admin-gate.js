// server/tests/test-approval-email-config-admin-gate.js
//
// Regression test cho phần SERVER của "🔔 Thông Báo Email Phê Duyệt" (DB.approvalEmailConfig,
// routes/data.js) — kịch bản (d) của bộ kiểm thử tính năng này: 1 tài khoản KHÔNG phải admin KHÔNG
// được ghi (403) nhưng vẫn ĐỌC được nguyên vẹn (không có bí mật nào trong key này, khác emailConfig).
//
// Cùng khuôn test-audit-round2-cluster1.js (Fix 1 ở đó): KHÔNG mở Playwright, chạy thẳng router
// express THẬT (routes/data.js) trong tiến trình Node, chỉ giả lập tầng lưu trữ (lib/appData) +
// middleware xác thực (lib/auth) — không cần SQL Server thật.
//
// Chạy: node server/tests/test-approval-email-config-admin-gate.js
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

const ORIGINAL_CONFIG = { CAR: { approvalNeeded: false, result: true } };
const APP_DATA = { users: USERS, approvalEmailConfig: JSON.parse(JSON.stringify(ORIGINAL_CONFIG)) };

function resetConfig() {
  APP_DATA.approvalEmailConfig = JSON.parse(JSON.stringify(ORIGINAL_CONFIG));
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
    await run.run('non-admin KHÔNG được ghi POST /api/data/approvalEmailConfig (403), dữ liệu KHÔNG đổi', async () => {
      resetConfig();
      const before = JSON.stringify(APP_DATA.approvalEmailConfig);
      const denied = await api('POST', '/api/data/approvalEmailConfig', { CAR: { approvalNeeded: true, result: true } }, PLAIN);
      assertEqual(denied.status, 403, 'Tài khoản thường phải bị chặn ghi approvalEmailConfig');
      assertIncludes(denied.body.error, 'Quản Trị Viên', 'Thông báo lỗi phải nêu rõ chỉ Quản Trị Viên mới sửa được');
      assertEqual(JSON.stringify(APP_DATA.approvalEmailConfig), before, 'approvalEmailConfig KHÔNG được đổi sau lượt ghi bị từ chối');
    });

    await run.run('non-admin VẪN đọc được nguyên vẹn GET /api/data/approvalEmailConfig (không có bí mật nào trong key này)', async () => {
      resetConfig();
      const res = await api('GET', '/api/data/approvalEmailConfig', undefined, PLAIN);
      assertEqual(res.status, 200, 'Đọc approvalEmailConfig phải mở cho mọi người đã đăng nhập');
      assertEqual(JSON.stringify(res.body), JSON.stringify(ORIGINAL_CONFIG), 'Giá trị đọc về phải nguyên vẹn, không bị lọc/sửa gì (khác emailConfig)');
    });

    await run.run('admin ghi được approvalEmailConfig (bật lại approvalNeeded) — lượt ghi có hiệu lực thật', async () => {
      resetConfig();
      const next = { CAR: { approvalNeeded: true, result: true } };
      const ok = await api('POST', '/api/data/approvalEmailConfig', next, ADMIN);
      assertEqual(ok.status, 200, 'Admin phải ghi được approvalEmailConfig');
      assertEqual(JSON.stringify(APP_DATA.approvalEmailConfig), JSON.stringify(next), 'Lượt ghi của admin phải có hiệu lực thật (đúng giá trị vừa gửi)');
    });

    await run.run('quyền nghiệp vụ khác (không phải admin) không mở khoá ghi approvalEmailConfig', async () => {
      resetConfig();
      const before = JSON.stringify(APP_DATA.approvalEmailConfig);
      const someOtherPerm = { username: 'nv2', name: 'Có Quyền Khác', dept: 'IT', perms: { itManage: true }, active: true };
      USERS.push(someOtherPerm);
      const denied = await api('POST', '/api/data/approvalEmailConfig', { CAR: { approvalNeeded: true } }, someOtherPerm);
      assertEqual(denied.status, 403, 'Quyền nghiệp vụ khác (itManage...) không thay thế được quyền admin cho màn Quản Trị này');
      assertEqual(JSON.stringify(APP_DATA.approvalEmailConfig), before, 'Dữ liệu không đổi');
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
