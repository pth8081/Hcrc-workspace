'use strict';

// tests/test-shifttemplates-generic-route-inuse-check.js
//
// LỖI ĐÃ VÁ (re-audit lần 6, mức Thấp — "shiftTemplates không kiểm tham chiếu từ shiftRoster"):
// applyClockPunch() (lib/attendance.js, mô hình SHIFT_BASED) đọc
// `(appData?.shiftTemplates || []).find(t => t.id === roster.shiftTemplateId)` để tính isLate/
// isEarlyLeave khi chấm công — xoá 1 "Ca Làm Việc" khỏi danh mục này (POST /api/data/shiftTemplates,
// route generic — shiftTemplates là JSON-blob trong AppData, KHÔNG phải collection riêng + delete route)
// dù còn dòng shiftRoster CHƯA HUỶ tham chiếu tới id đó KHÔNG làm crash gì (template undefined, các
// điều kiện if (template) đơn giản bị skip) nhưng ÂM THẦM mất khả năng xác định đi muộn/về sớm cho mọi
// lượt chấm công rơi vào ca đó.
//
// Vá: assertShiftTemplatesSafeToSave() (lib/createValidation.js), gọi NGAY TRƯỚC khi ghi đè
// 'shiftTemplates' ở POST /api/data/:key — so khớp theo `id` ổn định giữa mảng CŨ (đọc lại ngay trước
// khi ghi) và mảng MỚI client gửi, chặn cứng (400) nếu entry bị loại bỏ còn ÍT NHẤT 1 dòng shiftRoster
// CHƯA HUỶ tham chiếu.
//
// Test THẬT (không cần SQL Server) chạy trực tiếp routes/data.js THẬT, cùng khuôn
// test-positiontypes-generic-route-inuse-check.js (chỉ giả lập tầng lưu trữ AppData + recordStore +
// xác thực).
//
// Chạy: node server/tests/test-shifttemplates-generic-route-inuse-check.js

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
const PLAIN = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Siêu Thị A', perms: {}, active: true };

function baseShiftTemplates() {
  return [
    { id: 1, shiftCode: 'CA1', shiftName: 'Ca sáng', startTime: '06:00', endTime: '14:00' },
    { id: 2, shiftCode: 'CA2', shiftName: 'Ca chiều', startTime: '14:00', endTime: '22:00' }
  ];
}

let APP_DATA;
let USERS;
let SHIFT_ROSTER;
function resetConfig() {
  USERS = [{ ...ADMIN }, { ...PLAIN }];
  APP_DATA = { users: USERS, shiftTemplates: baseShiftTemplates() };
  SHIFT_ROSTER = [
    { id: 101, employeeCode: 'NV2', workDate: '2026-03-10', shiftTemplateId: 2, status: 'SCHEDULED' }
  ];
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

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['shiftRoster']),
  getAllForCollectionCached: async (c) => (c === 'shiftRoster' ? SHIFT_ROSTER.slice() : []),
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async () => []
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
    await run.run('LỖI ĐÃ VÁ: xoá Ca "CA2" (đang có 1 dòng shiftRoster CHƯA HUỶ tham chiếu) qua POST /api/data/shiftTemplates -> 400, KHÔNG xoá được', async () => {
      resetConfig();
      const next = baseShiftTemplates().filter(t => t.id !== 2);
      const res = await api('POST', '/api/data/shiftTemplates', next, ADMIN);
      assertEqual(res.status, 400, JSON.stringify(res.body));
      assertIncludes(res.body.error, 'đang có', 'thông báo phải nêu rõ đang có lịch phân ca tham chiếu');
      assertEqual(APP_DATA.shiftTemplates.length, 2, 'shiftTemplates KHÔNG được đổi sau lượt ghi bị từ chối');
    });

    await run.run('đối chứng: xoá Ca "CA2" SAU KHI dòng roster tham chiếu đã bị HUỶ (status CANCELLED) -> vẫn xoá được bình thường', async () => {
      resetConfig();
      SHIFT_ROSTER = SHIFT_ROSTER.map(r => ({ ...r, status: 'CANCELLED' }));
      const next = baseShiftTemplates().filter(t => t.id !== 2);
      const res = await api('POST', '/api/data/shiftTemplates', next, ADMIN);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(APP_DATA.shiftTemplates.length, 1, 'shiftTemplates phải còn đúng 1 entry sau khi xoá CA2');
    });

    await run.run('đối chứng: xoá Ca "CA1" (không ai tham chiếu) -> vẫn xoá được bình thường', async () => {
      resetConfig();
      const next = baseShiftTemplates().filter(t => t.id !== 1);
      const res = await api('POST', '/api/data/shiftTemplates', next, ADMIN);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(APP_DATA.shiftTemplates.length, 1, 'shiftTemplates phải còn đúng 1 entry sau khi xoá CA1');
    });

    await run.run('đối chứng: CHỈ sửa field (không xoá entry nào, VD đổi giờ ca) vẫn lưu được bình thường, không bị chặn nhầm', async () => {
      resetConfig();
      const next = baseShiftTemplates().map(t => (t.id === 2 ? { ...t, endTime: '23:00' } : t));
      const res = await api('POST', '/api/data/shiftTemplates', next, ADMIN);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(APP_DATA.shiftTemplates.find(t => t.id === 2).endTime, '23:00', 'giờ kết thúc mới phải được lưu');
    });

    await run.run('Người KHÔNG phải admin ghi shiftTemplates -> 403 (giữ đúng gate cũ, không bị đổi khi thêm check đang-dùng)', async () => {
      resetConfig();
      const res = await api('POST', '/api/data/shiftTemplates', baseShiftTemplates(), PLAIN);
      assertEqual(res.status, 403, JSON.stringify(res.body));
      assertEqual(APP_DATA.shiftTemplates.length, 2, 'shiftTemplates KHÔNG được đổi sau lượt ghi bị từ chối');
    });
  } finally {
    server.close();
  }
  run.summary();
  process.exit(process.exitCode || 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
