// server/tests/test-shelf-location-edit-code-delete.js
//
// TÍNH NĂNG MỚI (11/2026, theo yêu cầu người dùng kèm ảnh chụp màn hình "Quầy Kệ": "cho tôi sửa cả mã
// kệ, tên kệ và ngành hàng và thêm nút xóa nữa để tôi xóa hẳn đi"):
//   - PATCH /api/shelf-stock/locations/:id giờ CHO PHÉP đổi "code" (trước đây BẤT BIẾN) — an toàn vì
//     shelfRecords tham chiếu qua shelfLocationId (số), không qua code (xem lib/shelfStockEdit.js).
//   - DELETE /api/shelf-stock/locations/:id (MỚI) — xoá VĨNH VIỄN khỏi danh mục, KHÔNG qua Thùng Rác
//     (shelfLocations là collection AppData thường), KHÔNG hoàn tác.
//
// Test HTTP qua routes/shelfStock.js THẬT (không mock lại logic business) — chỉ stub lib/appData
// (AppData giả lập trong bộ nhớ)/lib/auth/lib/systemLogStore, giữ NGUYÊN lib/recordStore.js/
// lib/shelfStockEdit.js thật.
//
// Chạy: node server/tests/test-shelf-location-edit-code-delete.js
'use strict';
const http = require('http');
const path = require('path');
const { createRunner, assertEqual, assert } = require('./testHarness');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const MANAGER = { username: 'mgr1', name: 'Quản Lý Siêu Thị 1', dept: 'Siêu thị Quận 1', perms: { shelfLocationManage: true }, active: true };
const OTHER_STORE_MANAGER = { username: 'mgr7', name: 'Quản Lý Siêu Thị 7', dept: 'Siêu thị Quận 7', perms: { shelfLocationManage: true }, active: true };
const STAFF_NO_PERM = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Siêu thị Quận 1', perms: { vanHanhShelfTab: true }, active: true };
let USERS = [MANAGER, OTHER_STORE_MANAGER, STAFF_NO_PERM];
let APP_DATA;
function resetAppData(shelfLocations) {
  APP_DATA = { users: USERS, stores: ['Siêu thị Quận 1', 'Siêu thị Quận 7'], shelfLocations };
}
let PORT = 0;
let CURRENT_USERNAME = MANAGER.username;

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAppDataValueCached: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
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
  blockIfMustChangePassword: (req, res, next) => next()
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

// LƯU Ý QUAN TRỌNG: require('./testHarness') ở trên đã LỠ nạp lib/recordStore.js THẬT từ trước (qua
// chuỗi require testHarness.js -> lib/createValidation.js -> lib/recordStore.js) — module đó đã tự
// destructure `const { getAppDataValue, withLockedAppDataValue } = require('./appData')` thành biến
// const CỤC BỘ trỏ thẳng tới hàm THẬT ngay lúc nạp, nên dù mình stub lại 'lib/appData' ở TRÊN cũng không
// còn tác dụng gì với module ĐÃ nạp sẵn đó nữa (Node không chạy lại thân module khi require trùng cache).
// Xoá cache của lib/recordStore.js để nó được nạp lại TỪ ĐẦU ngay dưới đây (khi routes/shelfStock.js
// require nó) — lúc đó mới đọc đúng bản 'lib/appData' đã stub ở trên.
delete require.cache[require.resolve('../lib/recordStore')];

const express = require('express');
const shelfStockRoutes = require('../routes/shelfStock');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/shelf-stock', shelfStockRoutes);
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
    await run.run('PATCH /locations/:id: đổi code thành công, name/category cũng đổi kèm', async () => {
      resetAppData([
        { id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Kệ bánh kẹo', category: 'Bánh kẹo', active: true },
        { id: 2, dept: 'Siêu thị Quận 1', code: 'B1', name: 'Kệ sữa', category: 'Sữa', active: true }
      ]);
      const res = await api('PATCH', '/api/shelf-stock/locations/1', { code: 'A1-MOI', name: 'Kệ bánh kẹo (đổi tên)', category: 'Bánh kẹo & Snack' }, MANAGER);
      assertEqual(res.status, 200, `phải thành công, got: ${JSON.stringify(res.body)}`);
      assertEqual(res.body.item.code, 'A1-MOI');
      assertEqual(res.body.item.name, 'Kệ bánh kẹo (đổi tên)');
      assertEqual(res.body.item.category, 'Bánh kẹo & Snack');
      assertEqual(APP_DATA.shelfLocations.find(s => s.id === 1).code, 'A1-MOI', 'CSDL (mock) phải lưu code mới thật');
    });

    await run.run('PATCH /locations/:id: đổi code TRÙNG với quầy kệ KHÁC cùng siêu thị -> 409, KHÔNG đổi gì', async () => {
      resetAppData([
        { id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Kệ bánh kẹo', active: true },
        { id: 2, dept: 'Siêu thị Quận 1', code: 'B1', name: 'Kệ sữa', active: true }
      ]);
      const res = await api('PATCH', '/api/shelf-stock/locations/1', { code: 'B1' }, MANAGER);
      assertEqual(res.status, 409, `phải 409 trùng mã, got: ${JSON.stringify(res.body)}`);
      assertEqual(APP_DATA.shelfLocations.find(s => s.id === 1).code, 'A1', 'code KHÔNG được đổi khi bị chặn trùng');
    });

    await run.run('PATCH /locations/:id: quản lý siêu thị KHÁC -> 403, KHÔNG đổi gì', async () => {
      resetAppData([{ id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Kệ bánh kẹo', active: true }]);
      const res = await api('PATCH', '/api/shelf-stock/locations/1', { code: 'HACK' }, OTHER_STORE_MANAGER);
      assertEqual(res.status, 403, `phải 403, got: ${JSON.stringify(res.body)}`);
      assertEqual(APP_DATA.shelfLocations.find(s => s.id === 1).code, 'A1');
    });

    await run.run('DELETE /locations/:id: xoá thành công, biến mất khỏi danh mục thật', async () => {
      resetAppData([
        { id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Kệ bánh kẹo', active: true },
        { id: 2, dept: 'Siêu thị Quận 1', code: 'B1', name: 'Kệ sữa', active: true }
      ]);
      const res = await api('DELETE', '/api/shelf-stock/locations/1', undefined, MANAGER);
      assertEqual(res.status, 200, `phải thành công, got: ${JSON.stringify(res.body)}`);
      assertEqual(APP_DATA.shelfLocations.length, 1, 'phải còn đúng 1 quầy kệ (B1), đã xoá A1 thật');
      assertEqual(APP_DATA.shelfLocations[0].code, 'B1', 'KHÔNG được xoá nhầm quầy kệ khác');
    });

    await run.run('DELETE /locations/:id: KHÔNG có quyền shelfLocationManage -> 403, KHÔNG xoá gì', async () => {
      resetAppData([{ id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Kệ bánh kẹo', active: true }]);
      const res = await api('DELETE', '/api/shelf-stock/locations/1', undefined, STAFF_NO_PERM);
      assertEqual(res.status, 403, `phải 403, got: ${JSON.stringify(res.body)}`);
      assertEqual(APP_DATA.shelfLocations.length, 1, 'KHÔNG được xoá khi bị chặn quyền');
    });

    await run.run('DELETE /locations/:id: quản lý siêu thị KHÁC -> 403, KHÔNG xoá được quầy kệ của siêu thị khác', async () => {
      resetAppData([{ id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Kệ bánh kẹo', active: true }]);
      const res = await api('DELETE', '/api/shelf-stock/locations/1', undefined, OTHER_STORE_MANAGER);
      assertEqual(res.status, 403, `phải 403, got: ${JSON.stringify(res.body)}`);
      assertEqual(APP_DATA.shelfLocations.length, 1, 'KHÔNG được xoá quầy kệ của siêu thị khác');
    });

    await run.run('DELETE /locations/:id: id không tồn tại -> 404', async () => {
      resetAppData([{ id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Kệ bánh kẹo', active: true }]);
      const res = await api('DELETE', '/api/shelf-stock/locations/999', undefined, MANAGER);
      assertEqual(res.status, 404, `phải 404, got: ${JSON.stringify(res.body)}`);
      assertEqual(APP_DATA.shelfLocations.length, 1);
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
