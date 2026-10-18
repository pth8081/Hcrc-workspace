'use strict';

// tests/test-catalogrename-positiontypes-systemlog.js
//
// Re-audit lần 4 (mức TB): POST /api/admin/renameCatalogEntry (routes/adminCatalog.js) và toàn bộ route
// ghi của "Vị Trí Làm Việc" (routes/positionTypes.js: tạo/đổi nhãn/xoá + 2 cascade rename địa điểm/chức
// danh con) KHÔNG ghi bất kỳ dòng nào vào Nhật ký hệ thống — khác hẳn logAdminSensitiveDataWrite() ở
// routes/data.js (ghi log cho mọi POST /api/data/:key thuộc ADMIN_SENSITIVE_KEYS) hay insertSystemLog()
// ở routes/trash.js/routes/attendanceClockAdmin.js. Hệ quả: đổi tên 1 giá trị danh mục CÓ cascade sang
// hàng loạt hồ sơ, hay tạo/xoá cả 1 Vị Trí Làm Việc, không để lại dấu vết "ai làm, lúc nào" trong Nhật
// ký hệ thống — admin không có cách nào tra lại thao tác này sau này.
//
// Test HTTP thật qua express, mount đúng 2 router này, bắt (capture) mọi lời gọi insertSystemLog().
//
// Chạy: node server/tests/test-catalogrename-positiontypes-systemlog.js
const assert = require('assert');
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
}

const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', perms: { admin: true } };
const NONADMIN = { id: 2, username: 'nhanvien1', name: 'Nhân Viên 1', perms: {} };

let APP_DATA;
function resetData() {
  APP_DATA = {
    users: [{ ...ADMIN }, { ...NONADMIN }],
    jobGrades: ['Bậc 1', 'Bậc 2'],
    positionTypes: [
      { key: 'HO', label: 'Văn Phòng', builtin: true },
      { key: 'STORE', label: 'Siêu Thị', builtin: true },
      { key: 'KHO_VUNG', label: 'Kho Vùng', builtin: false, locations: ['Kho A'], jobTitles: ['Thủ Kho'] }
    ]
  };
}
resetData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  withLockedAppDataValue: async (key, mutatorFn) => {
    if (!(key in APP_DATA)) APP_DATA[key] = [];
    const next = await mutatorFn(APP_DATA[key]);
    APP_DATA[key] = next;
    return next;
  }
});
stubModule('lib/recordStore', { renameFieldValueInCollection: async () => {} });

let LOG_CALLS = [];
stubModule('lib/systemLogStore', {
  insertSystemLog: async (payload) => { LOG_CALLS.push(payload); return { id: LOG_CALLS.length }; }
});

let CURRENT_USER = ADMIN;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = (APP_DATA.users || []).find(u => u.username === CURRENT_USER.username) || CURRENT_USER;
    req.user = { username: fresh.username, name: fresh.name, admin: !!fresh.perms?.admin };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const adminCatalogRoutes = require('../routes/adminCatalog');
const positionTypesRoutes = require('../routes/positionTypes');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminCatalogRoutes);
  app.use('/api/admin/position-types', positionTypesRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function api(method, urlPath, body) {
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
    await run.run('LỖI ĐÃ VÁ: POST /api/admin/renameCatalogEntry thành công -> ghi đúng 1 dòng Nhật ký hệ thống (module CONFIG/actionType CATALOG_RENAME, nêu rõ giá trị cũ/mới)', async () => {
      resetData(); LOG_CALLS = []; CURRENT_USER = ADMIN;
      const res = await api('POST', '/api/admin/renameCatalogEntry', { catalogKey: 'jobGrades', oldValue: 'Bậc 1', newValue: 'Bậc 1 (mới)' });
      assertEqual(res.status, 200, 'phải đổi tên được');
      await new Promise(r => setImmediate(r));
      assertEqual(LOG_CALLS.length, 1, 'phải ghi đúng 1 dòng log');
      assertEqual(LOG_CALLS[0].module, 'CONFIG');
      assertEqual(LOG_CALLS[0].actionType, 'CATALOG_RENAME');
      assertEqual(LOG_CALLS[0].targetObject, 'jobGrades');
      assert.ok(LOG_CALLS[0].description.includes('Bậc 1') && LOG_CALLS[0].description.includes('Bậc 1 (mới)'), 'mô tả phải nêu rõ giá trị cũ/mới');
      assertEqual(LOG_CALLS[0].username, 'admin');
    });

    await run.run('renameCatalogEntry KHÔNG đủ quyền (403) -> KHÔNG ghi log nào (không ghi log cho thao tác bị từ chối)', async () => {
      resetData(); LOG_CALLS = []; CURRENT_USER = NONADMIN;
      const res = await api('POST', '/api/admin/renameCatalogEntry', { catalogKey: 'jobGrades', oldValue: 'Bậc 1', newValue: 'X' });
      assertEqual(res.status, 403);
      await new Promise(r => setImmediate(r));
      assertEqual(LOG_CALLS.length, 0, 'thao tác bị từ chối không được ghi log SUCCESS');
    });

    await run.run('LỖI ĐÃ VÁ: POST /api/admin/position-types (tạo mới) -> ghi log POSITION_TYPE_CREATE', async () => {
      resetData(); LOG_CALLS = []; CURRENT_USER = ADMIN;
      const res = await api('POST', '/api/admin/position-types', { label: 'Kho Miền Bắc' });
      assertEqual(res.status, 200);
      await new Promise(r => setImmediate(r));
      assertEqual(LOG_CALLS.length, 1);
      assertEqual(LOG_CALLS[0].actionType, 'POSITION_TYPE_CREATE');
      assert.ok(LOG_CALLS[0].description.includes('Kho Miền Bắc'));
    });

    await run.run('LỖI ĐÃ VÁ: PATCH /api/admin/position-types/:key (đổi nhãn) -> ghi log POSITION_TYPE_RENAME', async () => {
      resetData(); LOG_CALLS = []; CURRENT_USER = ADMIN;
      const res = await api('PATCH', '/api/admin/position-types/KHO_VUNG', { label: 'Kho Vùng (đổi tên)' });
      assertEqual(res.status, 200);
      await new Promise(r => setImmediate(r));
      assertEqual(LOG_CALLS.length, 1);
      assertEqual(LOG_CALLS[0].actionType, 'POSITION_TYPE_RENAME');
      assertEqual(LOG_CALLS[0].targetObject, 'KHO_VUNG');
    });

    await run.run('LỖI ĐÃ VÁ: DELETE /api/admin/position-types/:key -> ghi log POSITION_TYPE_DELETE', async () => {
      resetData(); LOG_CALLS = []; CURRENT_USER = ADMIN;
      const res = await api('DELETE', '/api/admin/position-types/KHO_VUNG');
      assertEqual(res.status, 200);
      await new Promise(r => setImmediate(r));
      assertEqual(LOG_CALLS.length, 1);
      assertEqual(LOG_CALLS[0].actionType, 'POSITION_TYPE_DELETE');
    });

    await run.run('LỖI ĐÃ VÁ: POST /:key/locations/rename -> ghi log POSITION_TYPE_LOCATION_RENAME', async () => {
      resetData(); LOG_CALLS = []; CURRENT_USER = ADMIN;
      const res = await api('POST', '/api/admin/position-types/KHO_VUNG/locations/rename', { oldValue: 'Kho A', newValue: 'Kho A2' });
      assertEqual(res.status, 200);
      await new Promise(r => setImmediate(r));
      assertEqual(LOG_CALLS.length, 1);
      assertEqual(LOG_CALLS[0].actionType, 'POSITION_TYPE_LOCATION_RENAME');
      assert.ok(LOG_CALLS[0].description.includes('Kho A') && LOG_CALLS[0].description.includes('Kho A2'));
    });

    await run.run('LỖI ĐÃ VÁ: POST /:key/job-titles/rename -> ghi log POSITION_TYPE_JOBTITLE_RENAME', async () => {
      resetData(); LOG_CALLS = []; CURRENT_USER = ADMIN;
      const res = await api('POST', '/api/admin/position-types/KHO_VUNG/job-titles/rename', { oldValue: 'Thủ Kho', newValue: 'Thủ Kho Chính' });
      assertEqual(res.status, 200);
      await new Promise(r => setImmediate(r));
      assertEqual(LOG_CALLS.length, 1);
      assertEqual(LOG_CALLS[0].actionType, 'POSITION_TYPE_JOBTITLE_RENAME');
    });

    await run.run('position-types KHÔNG đủ quyền (403) -> KHÔNG ghi log nào', async () => {
      resetData(); LOG_CALLS = []; CURRENT_USER = NONADMIN;
      const res = await api('POST', '/api/admin/position-types', { label: 'X' });
      assertEqual(res.status, 403);
      await new Promise(r => setImmediate(r));
      assertEqual(LOG_CALLS.length, 0);
    });

    run.summary();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
