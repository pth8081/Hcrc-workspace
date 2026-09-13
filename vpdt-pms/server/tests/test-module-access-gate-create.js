// server/tests/test-module-access-gate-create.js
//
// PQ-01 (đợt test chuyên sâu 9/2026, mục Phân Quyền): Khối 0 (user.perms.moduleAccess) TRƯỚC ĐÂY chỉ
// được mirror ở GET /api/data (xem test-module-access-gate.js) — hoàn toàn CHƯA chặn ở khâu TẠO MỚI:
// tắt moduleAccess.itSupport/task cho 1 user xong họ vẫn POST /api/create/itSupportTickets hoặc
// POST /api/records/tasks tạo hồ sơ bình thường (chỉ không thấy lại được sau đó). Test này mount THẬT
// routes/create.js (đại diện: itSupportTickets, module getScope trống — đơn giản nhất để dựng payload
// hợp lệ) và routes/records.js (đại diện: tasks, module DUY NHẤT trong 6 module Khối-0-gated không đi
// qua routes/create.js — không có CREATE_MODULE_CONFIGS entry) — đúng 2 điểm chặn mới đã thêm.
//
// Chạy: node server/tests/test-module-access-gate-create.js
'use strict';
const http = require('http');
const path = require('path');
const express = require('express');
const { createRunner, assertEqual } = require('./testHarness');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const OFF = { username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: { moduleAccess: { itSupport: false, task: false } }, active: true };
const ON = { username: 'nv2', name: 'Nhân Viên 2', dept: 'Phòng A', perms: {}, active: true };
const ALL_USERS = [OFF, ON];

stubModule('lib/appData', {
  getAllAppData: async () => ({}),
  getAppDataValue: async () => [],
  withLockedAppDataValue: async (key, fn) => fn([])
});
stubModule('lib/recordStore', {
  createForCollection: async (dbKey, builderFn) => builderFn([]),
  createForCollectionSerialized: async (dbKey, lockKey, builderFn) => builderFn([]),
  getAllForCollection: async () => [],
  withAppLock: async (key, fn) => fn(),
  getTrashItems: async () => []
});
stubModule('lib/employeeProfile', { ensureDraftProfile: () => {} });
stubModule('lib/taskStore', {
  insertTask: async (t) => ({ ...t, id: Date.now() }),
  withLockedTaskById: async () => { throw new Error('không dùng ở test này'); },
  deleteTaskById: async () => {}, getAllTasks: async () => [], migrateDirectiveTaskLinks: async () => {}
});
stubModule('lib/operationWorkItemStore', {
  getAllWorkItems: async () => [], getWorkItemsBySource: async () => [], insertWorkItem: async () => {},
  withLockedWorkItemById: async () => {}, deleteWorkItemById: async () => {}, deleteWorkItemsByIds: async () => {}
});
stubModule('lib/laborContract', {});
stubModule('lib/attendance', {});

let CURRENT_USERNAME = OFF.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = ALL_USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = ALL_USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p, isBcryptHash: () => false, validatePin: () => null
});

const createRoutes = require('../routes/create');
const recordsRoutes = require('../routes/records');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  app.use('/api/records', recordsRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' },
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
    await run.run('PQ-01 (create): moduleAccess.itSupport=false -> POST /api/create/itSupportTickets bị chặn 403', async () => {
      const res = await api('POST', '/api/create/itSupportTickets', { title: 'Máy in hỏng', description: 'Không in được' }, OFF);
      assertEqual(res.status, 403, 'phải trả 403 khi module đang tắt');
    });

    await run.run('PQ-01 (create): moduleAccess bình thường -> POST /api/create/itSupportTickets vẫn tạo được (không bị chặn oan)', async () => {
      const res = await api('POST', '/api/create/itSupportTickets', { title: 'Máy in hỏng', description: 'Không in được' }, ON);
      assertEqual(res.status, 200, 'phải tạo thành công khi module KHÔNG bị tắt');
      assertEqual(res.body?.item?.title, 'Máy in hỏng', 'phải trả về đúng hồ sơ vừa tạo');
    });

    await run.run('PQ-01 (create): moduleAccess.task=false -> POST /api/records/tasks (giao việc thủ công) bị chặn 403', async () => {
      const res = await api('POST', '/api/records/tasks', { title: 'Việc test', assignedTo: ['nv1'] }, OFF);
      assertEqual(res.status, 403, 'phải trả 403 khi module Công Việc đang tắt cho user này');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
