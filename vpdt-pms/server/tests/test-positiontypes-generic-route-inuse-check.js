'use strict';

// tests/test-positiontypes-generic-route-inuse-check.js
//
// LỖI ĐÃ VÁ (re-audit lần 5, mức Trung Bình — "positionTypes ghi qua /api/data né check 'đang dùng'"):
// DELETE /api/admin/position-types/:key (routes/positionTypes.js) CHẶN CỨNG xoá 1 "Vị Trí Làm Việc"
// nếu (a) là 1 trong 2 giá trị builtin (HO/Siêu Thị — luôn phải có ít nhất 2 giá trị gốc) hoặc (b)
// đang có tài khoản gán posType đó (users.posType === key). NHƯNG 'positionTypes' cũng nằm trong
// ADMIN_ONLY_KEYS (routes/data.js) nên admin có thể gọi THẲNG POST /api/data/positionTypes với 1 mảng
// ĐÃ LOẠI BỎ 1 entry (builtin hoặc đang dùng) — route generic này chỉ gate QUYỀN (admin-only), hoàn
// toàn không soát chiếu với "users" trước khi ghi đè, né sạch 2 lớp chặn ở route riêng.
//
// Vá: assertPositionTypesSafeToSave() (lib/createValidation.js), gọi NGAY TRƯỚC khi ghi đè 'positionTypes'
// ở POST /api/data/:key — so khớp theo `key` ổn định giữa mảng CŨ (đọc lại ngay trước khi ghi) và mảng
// MỚI client gửi, áp đúng 2 điều kiện chặn y hệt route DELETE cho MỖI entry bị loại bỏ.
//
// Test THẬT (không cần SQL Server) chạy trực tiếp routes/data.js THẬT, cùng khuôn
// test-deptcodemap-admin-gate.js (chỉ giả lập tầng lưu trữ AppData + xác thực).
//
// Chạy: node server/tests/test-positiontypes-generic-route-inuse-check.js

function stubModule(relPath, exportsObj) {
  const path = require('path');
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', posType: 'HO', perms: { admin: true }, active: true };
const PLAIN = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Kế Toán', posType: 'HO', perms: {}, active: true };

function basePositionTypes() {
  return [
    { key: 'HO', label: 'HO (Văn phòng)', builtin: true },
    { key: 'STORE', label: 'Siêu Thị', builtin: true },
    { key: 'KHO', label: 'Kho', builtin: false, locations: ['Kho Hà Nội'], jobTitles: ['Thủ kho'] }
  ];
}

let APP_DATA;
let USERS;
function resetConfig() {
  USERS = [
    { ...ADMIN },
    { ...PLAIN },
    { username: 'nv.kho1', name: 'Thủ Kho Một', dept: 'Kho Hà Nội', jobTitle: 'Thủ kho', posType: 'KHO', perms: {}, active: true }
  ];
  APP_DATA = { users: USERS, positionTypes: basePositionTypes() };
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
    await run.run('LỖI ĐÃ VÁ: xoá entry "KHO" (đang có 1 tài khoản gán posType) qua POST /api/data/positionTypes -> 400, KHÔNG xoá được', async () => {
      resetConfig();
      const next = basePositionTypes().filter(t => t.key !== 'KHO');
      const res = await api('POST', '/api/data/positionTypes', next, ADMIN);
      assertEqual(res.status, 400, JSON.stringify(res.body));
      assertIncludes(res.body.error, 'đang có', 'thông báo phải nêu rõ đang có tài khoản gán');
      assertEqual(APP_DATA.positionTypes.length, 3, 'positionTypes KHÔNG được đổi sau lượt ghi bị từ chối');
    });

    await run.run('LỖI ĐÃ VÁ: xoá builtin "HO" qua POST /api/data/positionTypes -> 400, KHÔNG xoá được', async () => {
      resetConfig();
      const next = basePositionTypes().filter(t => t.key !== 'HO');
      const res = await api('POST', '/api/data/positionTypes', next, ADMIN);
      assertEqual(res.status, 400, JSON.stringify(res.body));
      assertIncludes(res.body.error, 'mặc định', 'thông báo phải nêu rõ không thể xoá Vị Trí mặc định');
      assertEqual(APP_DATA.positionTypes.length, 3, 'positionTypes KHÔNG được đổi sau lượt ghi bị từ chối');
    });

    await run.run('LỖI ĐÃ VÁ: xoá builtin "STORE" qua POST /api/data/positionTypes -> 400, KHÔNG xoá được', async () => {
      resetConfig();
      const next = basePositionTypes().filter(t => t.key !== 'STORE');
      const res = await api('POST', '/api/data/positionTypes', next, ADMIN);
      assertEqual(res.status, 400, JSON.stringify(res.body));
      assertIncludes(res.body.error, 'mặc định', 'thông báo phải nêu rõ không thể xoá Vị Trí mặc định');
    });

    await run.run('đối chứng: xoá entry "KHO" SAU KHI không còn ai gán posType đó -> vẫn xoá được bình thường', async () => {
      resetConfig();
      APP_DATA.users = APP_DATA.users.map(u => (u.username === 'nv.kho1' ? { ...u, posType: 'HO' } : u));
      const next = basePositionTypes().filter(t => t.key !== 'KHO');
      const res = await api('POST', '/api/data/positionTypes', next, ADMIN);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(APP_DATA.positionTypes.length, 2, 'positionTypes phải còn đúng 2 entry builtin sau khi xoá KHO');
    });

    await run.run('đối chứng: CHỈ đổi nhãn (không xoá entry nào) vẫn lưu được bình thường, không bị chặn nhầm', async () => {
      resetConfig();
      const next = basePositionTypes().map(t => (t.key === 'KHO' ? { ...t, label: 'Kho Vận' } : t));
      const res = await api('POST', '/api/data/positionTypes', next, ADMIN);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(APP_DATA.positionTypes.find(t => t.key === 'KHO').label, 'Kho Vận', 'nhãn mới phải được lưu');
    });

    await run.run('Người KHÔNG phải admin ghi positionTypes -> 403 (giữ đúng gate ADMIN_ONLY_KEYS cũ, không bị đổi khi thêm check đang-dùng)', async () => {
      resetConfig();
      const res = await api('POST', '/api/data/positionTypes', basePositionTypes(), PLAIN);
      assertEqual(res.status, 403, JSON.stringify(res.body));
      assertEqual(APP_DATA.positionTypes.length, 3, 'positionTypes KHÔNG được đổi sau lượt ghi bị từ chối');
    });
  } finally {
    server.close();
  }
  run.summary();
  process.exit(process.exitCode || 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
