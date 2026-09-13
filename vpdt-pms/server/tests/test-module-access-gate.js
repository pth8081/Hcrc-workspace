// server/tests/test-module-access-gate.js
//
// PQ-01: user.perms.moduleAccess ("Khối 0", xem BUSINESS_MODULES/hasModuleAccess() ở public/js/core.js)
// trước đây CHỈ được thực thi ở CLIENT (ẩn tab điều hướng) — admin tắt hẳn 1 module cho 1 user cụ thể
// KHÔNG chặn được GET /api/data gọi thẳng, với các module "mở sẵn cho mọi nhân viên" (không có quyền
// chi tiết nào gác việc XEM — doc/submission/task/internal/contract/itSupport, xem
// MODULE_ACCESS_GATED_COLLECTIONS ở lib/recordViewScope.js). Test này dùng "contract"/"internal" làm
// đại diện (đi qua đường tải chung migratedList, không qua loader riêng như docs/submissions).
//
// Chạy: node server/tests/test-module-access-gate.js
'use strict';
const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const CREATOR = { username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: { moduleAccess: { contract: false } }, active: true };
const NO_MODULE_ACCESS_FIELD = { username: 'nv2', name: 'Nhân Viên 2', dept: 'Phòng A', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true, moduleAccess: { contract: false, internal: false } }, active: true };
const ALL_USERS_LIST = [CREATOR, NO_MODULE_ACCESS_FIELD, ADMIN];

let APP_DATA;
function resetData() {
  APP_DATA = { users: ALL_USERS_LIST.map(u => ({ ...u })) };
}
resetData();

const CONTRACTS = [{ id: 1, code: 'HD-001', dept: 'Phòng A', creator: 'nv1', approvalStatus: 'APPROVED' }];
const INTERNAL_POSTS = [{ id: 1, author: 'nv1', status: 'APPROVED', publishAt: null }];

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['contracts', 'internalPosts']),
  getAllForCollectionCached: async (collection) => {
    if (collection === 'contracts') return CONTRACTS.map(r => ({ ...r }));
    if (collection === 'internalPosts') return INTERNAL_POSTS.map(r => ({ ...r }));
    return [];
  },
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async () => []
});

let CURRENT_USERNAME = CREATOR.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = ALL_USERS_LIST.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p,
  isBcryptHash: () => false,
  validatePin: () => null
});

const express = require('express');
const { createRunner, assertEqual } = require('./testHarness');
const dataRoutes = require('../routes/data');

let PORT = 0;
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
    await run.run('PQ-01: moduleAccess.contract=false -> data.contracts rỗng dù user là creator của hồ sơ', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, CREATOR);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual((res.body.contracts || []).length, 0, 'contracts phải bị chặn hoàn toàn khi moduleAccess.contract=false');
    });

    await run.run('PQ-01: moduleAccess.contract=false KHÔNG ảnh hưởng module KHÁC (internalPosts vẫn thấy bình thường)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, CREATOR);
      assertEqual((res.body.internalPosts || []).length, 1, 'internalPosts không bị chặn oan chỉ vì module "contract" bị tắt');
    });

    await run.run('PQ-01: KHÔNG có field moduleAccess nào (mặc định mở hết) -> vẫn thấy contracts bình thường', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, NO_MODULE_ACCESS_FIELD);
      assertEqual((res.body.contracts || []).length, 1, 'không có moduleAccess = mặc định KHÔNG bị chặn (khớp hasModuleAccess() client)');
    });

    await run.run('PQ-01: admin luôn bỏ qua moduleAccess (dù chính admin cũng bị tắt contract/internal)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      assertEqual((res.body.contracts || []).length, 1, 'admin phải luôn thấy contracts dù moduleAccess.contract=false');
      assertEqual((res.body.internalPosts || []).length, 1, 'admin phải luôn thấy internalPosts dù moduleAccess.internal=false');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
