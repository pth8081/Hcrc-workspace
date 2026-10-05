'use strict';

// tests/test-catalog-rename-hr-suggestion-catalogs.js
//
// Regression test cho "✏️ Sửa" MỚI thêm (10/2026, theo yêu cầu người dùng rà soát màn Quản Lý Danh Mục
// "cái nào chưa có nút Sửa thì bổ sung ngay") cho 7 danh mục GỢI Ý trước đây CHỈ có Thêm/Xoá:
// jobGrades/resignationReasons/disciplinaryTypes/legalEntities/specialLaborStatuses/
// currentWorkStatusDetails/nationalIdIssuePlaces — xem simpleArrayCatalogHandler() mới thêm vào
// CATALOG_HANDLERS (lib/catalogRename.js) + VALID_CATALOG_KEYS (routes/adminCatalog.js).
//
// Cùng khuôn tests/test-catalog-rename-round2-extras.js (gọi THẲNG router thật routes/adminCatalog.js).
//
// Chạy: node server/tests/test-catalog-rename-hr-suggestion-catalogs.js
const http = require('http');
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const ADMIN = { username: 'admin1', perms: { admin: true } };
const NON_ADMIN = { username: 'user1', perms: {} };
const USERS = [ADMIN, NON_ADMIN];

const NEW_SIMPLE_KEYS = [
  ['jobGrades', 'Cấp Bậc'],
  ['resignationReasons', 'Lý Do Nghỉ Việc'],
  ['disciplinaryTypes', 'Loại Kỷ Luật'],
  ['legalEntities', 'Đơn Vị (Pháp Nhân)'],
  ['specialLaborStatuses', 'Đối Tượng Lao Động Đặc Biệt'],
  ['currentWorkStatusDetails', 'Tình Trạng Làm Việc Hiện Tại'],
  ['nationalIdIssuePlaces', 'Nơi Cấp CCCD/CMND']
];

let APP_DATA = {};
function resetState() {
  APP_DATA = {};
  for (const [key] of NEW_SIMPLE_KEYS) APP_DATA[key] = [`${key} Cũ`, `${key} Khác`];
}

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const u = USERS.find(x => x.username === req.headers['x-demo-user']);
    if (!u) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = u;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});
stubModule('lib/adminAuth', {
  isCurrentlyAdmin: async (username) => USERS.find(u => u.username === username)?.perms?.admin === true
});
stubModule('lib/appData', {
  withLockedAppDataValue: async (key, fn) => {
    APP_DATA[key] = await fn(APP_DATA[key]);
    return APP_DATA[key];
  }
});

async function main() {
  let passed = 0, failed = 0;
  const check = (label, cond) => { if (cond) { console.log(`PASS: ${label}`); passed++; } else { console.log(`FAIL: ${label}`); failed++; } };

  const adminCatalogRoutes = require('../routes/adminCatalog');
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminCatalogRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, body) {
    const res = await fetch(`${base}/api/admin/renameCatalogEntry`, {
      method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, username ? { 'x-demo-user': username } : {}),
      body: JSON.stringify(body)
    });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  try {
    for (const [key, label] of NEW_SIMPLE_KEYS) {
      resetState();
      const r = await call('admin1', { catalogKey: key, oldValue: `${key} Cũ`, newValue: `${key} Mới` });
      check(`${label} (${key}): admin đổi tên thành công`, r.status === 200 && r.json.ok === true);
      check(`${label}: mảng cập nhật đúng (còn 2 phần tử, có tên mới)`, Array.isArray(r.json.catalog) && r.json.catalog.length === 2 && r.json.catalog.includes(`${key} Mới`));
      check(`${label}: KHÔNG còn tên cũ sau khi đổi`, !r.json.catalog.includes(`${key} Cũ`));
    }

    resetState();
    const forbidden = await call('user1', { catalogKey: 'jobGrades', oldValue: 'jobGrades Cũ', newValue: 'X' });
    check('Người không phải admin bị chặn 403', forbidden.status === 403);

    resetState();
    const dup = await call('admin1', { catalogKey: 'jobGrades', oldValue: 'jobGrades Cũ', newValue: 'jobGrades Khác' });
    check('Đổi trùng tên đã có trong danh mục -> báo lỗi', dup.status >= 400 && /đã có/.test(dup.json.error || ''));

    resetState();
    const notFound = await call('admin1', { catalogKey: 'jobGrades', oldValue: 'Không Tồn Tại', newValue: 'X' });
    check('Đổi tên giá trị không có trong danh mục -> báo lỗi', notFound.status >= 400 && /Không tìm thấy/.test(notFound.json.error || ''));

    const rejected = await call('admin1', { catalogKey: 'khongCoKeyNao', oldValue: 'A', newValue: 'B' });
    check('catalogKey không nằm trong VALID_CATALOG_KEYS -> 400', rejected.status === 400);
  } finally {
    server.close();
  }

  console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\n${passed} passed, 0 failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
