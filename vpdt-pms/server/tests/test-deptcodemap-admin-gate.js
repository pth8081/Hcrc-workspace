'use strict';

// tests/test-deptcodemap-admin-gate.js
//
// LOI DA VA (dot re-audit lan 3, cung lop loi voi itPriceWholesaleStoreMixedApprovalRules da va truoc
// do): key 'deptCodeMap' (object {<ten bo phan>: <ma bo phan>}, defaults.js) truoc day KHONG co trong
// ADMIN_ONLY_KEYS lan NON_ADMIN_GATED_KEYS cua routes/data.js - bat ky tai khoan da dang nhap nao cung
// ghi de duoc qua POST /api/data/deptCodeMap, du key nay chi do SERVER tu quan ly (ensureDeptCode(),
// routes/employeeProfile.js) va KHONG co man hinh client nao can ghi tay qua day.
//
// Test THAT (khong can SQL Server) chay truc tiep routes/data.js THAT (cung khuon
// test-workflow-participating-positions.js): non-admin bi chan 403, admin ghi duoc binh thuong.
//
// Chay: node server/tests/test-deptcodemap-admin-gate.js
'use strict';

function stubModule(relPath, exportsObj) {
  const path = require('path');
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

let APP_DATA;
function resetConfig() {
  APP_DATA = { users: USERS, deptCodeMap: { 'Phòng Kế Toán': 'KT' } };
}
resetConfig();

let PORT = 0;
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

const http = require('http');
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
    await run.run('non-admin bị chặn ghi đè deptCodeMap (403), dữ liệu KHÔNG đổi', async () => {
      resetConfig();
      const before = JSON.stringify(APP_DATA.deptCodeMap);
      const denied = await api('POST', '/api/data/deptCodeMap', { 'Phòng Kế Toán': 'HACKED' }, PLAIN);
      assertEqual(denied.status, 403, 'Nhân viên thường phải bị chặn ghi deptCodeMap');
      assertIncludes(denied.body.error, 'Quản Trị Viên', 'Thông báo lỗi phải nêu rõ cần quyền Admin');
      assertEqual(JSON.stringify(APP_DATA.deptCodeMap), before, 'Dữ liệu KHÔNG được đổi sau lượt ghi bị từ chối');
    });

    await run.run('admin vẫn ghi được deptCodeMap (đường lùi admin-only vẫn hoạt động)', async () => {
      resetConfig();
      const next = { 'Phòng Kế Toán': 'KT', 'Phòng IT': 'IT' };
      const ok = await api('POST', '/api/data/deptCodeMap', next, ADMIN);
      assertEqual(ok.status, 200, 'Admin phải ghi được deptCodeMap');
      assertEqual(JSON.stringify(APP_DATA.deptCodeMap), JSON.stringify(next), 'Lượt ghi của admin phải có hiệu lực thật');
    });

    await run.run('Key không hợp lệ (không nằm trong DEFAULTS) vẫn bị từ chối 400 như trước', async () => {
      resetConfig();
      const denied = await api('POST', '/api/data/khongTonTai123', {}, ADMIN);
      assertEqual(denied.status, 400, 'Key lạ phải bị từ chối 400');
    });
  } finally {
    server.close();
  }
  run.summary();
  process.exit(process.exitCode || 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
