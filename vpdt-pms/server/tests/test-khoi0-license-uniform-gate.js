// server/tests/test-khoi0-license-uniform-gate.js
//
// Rà soát chuyên sâu toàn hệ thống trước go-live (11/2026, mức Cao): Giấy Phép (licenses) và Đồng Phục
// (uniformPeriods/uniformIssuances/uniformStockAdjustments/uniformTransfers) HOÀN TOÀN không có gate
// "Khối 0" (moduleAccess) ở server — admin tắt module cho 1 tài khoản (còn giữ quyền chi tiết
// licenseView/uniformManage/...) vẫn thao tác đầy đủ qua API trực tiếp, và vẫn đọc được toàn bộ dữ liệu
// qua GET /api/data. Test này mount THẬT routes/records.js (chỉ stub lib/auth để bơm req.freshUser —
// middleware router.use() gác Khối 0 chạy TRƯỚC MỌI handler khác nên không cần stub sâu hơn) để xác
// nhận: (a) tắt module -> 403 ở MỌI route hành động, (b) bật module -> KHÔNG bị 403 oan (đi tiếp tới lỗi
// khác do dữ liệu giả không tồn tại, không phải lỗi quyền). Riêng MODULE_ACCESS_GATED_COLLECTIONS.license/
// .uniform (gác GET /api/data + route TẠO MỚI qua COLLECTION_TO_MODULE_ACCESS_KEY) test trực tiếp bằng
// cách require lib/recordViewScope.js, không cần dựng HTTP.
//
// Chạy: node server/tests/test-khoi0-license-uniform-gate.js
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

const LICENSE_OFF = { username: 'nv1', name: 'NV 1', dept: 'Phòng A', perms: { licenseApprove: true, moduleAccess: { license: false } }, active: true };
const LICENSE_ON = { username: 'nv2', name: 'NV 2', dept: 'Phòng A', perms: { licenseApprove: true, moduleAccess: { license: true } }, active: true };
// uniformStoreManage: true (cùng với moduleAccess.uniform) để các route /uniformIssuances|
// uniformStockAdjustments/create (canManageUniformStore() kiểm RIÊNG, độc lập Khối 0 — xem
// lib/recordActions.js) không tự trả 403 vì lý do KHÁC, giữ cho test chỉ còn đúng 1 biến phụ thuộc
// (Khối 0 bật/tắt) khi khẳng định 403/không-403.
const UNIFORM_OFF = { username: 'nv3', name: 'NV 3', dept: 'Phòng A', perms: { uniformManage: true, uniformStoreManage: true, moduleAccess: { uniform: false } }, active: true };
const UNIFORM_ON = { username: 'nv4', name: 'NV 4', dept: 'Phòng A', perms: { uniformManage: true, uniformStoreManage: true, moduleAccess: { uniform: true } }, active: true };
const ALL_USERS = [LICENSE_OFF, LICENSE_ON, UNIFORM_OFF, UNIFORM_ON];

let CURRENT_USERNAME = LICENSE_ON.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = ALL_USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p, isBcryptHash: () => false, validatePin: () => null
});

const recordsRoutes = require('../routes/records');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
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
    // ===== Giấy Phép =====
    await run.run('Giấy Phép: moduleAccess.license=false -> POST /licenses/:id/approve bị chặn 403', async () => {
      const res = await api('POST', '/api/records/licenses/1/approve', {}, LICENSE_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Giấy Phép: moduleAccess.license=false -> POST /licenses/:id/cancel cũng bị chặn 403', async () => {
      const res = await api('POST', '/api/records/licenses/1/cancel', {}, LICENSE_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Giấy Phép: moduleAccess.license=true -> KHÔNG bị 403 (đi tiếp qua logic nghiệp vụ, hồ sơ giả không tồn tại nên lỗi khác 403)', async () => {
      const res = await api('POST', '/api/records/licenses/999999/approve', {}, LICENSE_ON);
      assertEqual(res.status === 403, false, `không được là 403 (quyền module vẫn bật) — nhận status=${res.status}`);
    });

    // ===== Đồng Phục (4 collection, 4 middleware riêng) =====
    await run.run('Đồng Phục: moduleAccess.uniform=false -> POST /uniformPeriods/:id/edit bị chặn 403', async () => {
      const res = await api('POST', '/api/records/uniformPeriods/1/edit', {}, UNIFORM_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Đồng Phục: moduleAccess.uniform=false -> POST /uniformIssuances/create bị chặn 403', async () => {
      const res = await api('POST', '/api/records/uniformIssuances/create', {}, UNIFORM_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Đồng Phục: moduleAccess.uniform=false -> POST /uniformStockAdjustments/create bị chặn 403', async () => {
      const res = await api('POST', '/api/records/uniformStockAdjustments/create', {}, UNIFORM_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Đồng Phục: moduleAccess.uniform=false -> POST /uniformTransfers/:id/cancel bị chặn 403', async () => {
      const res = await api('POST', '/api/records/uniformTransfers/1/cancel', {}, UNIFORM_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Đồng Phục: moduleAccess.uniform=true -> KHÔNG bị 403 oan', async () => {
      const res = await api('POST', '/api/records/uniformPeriods/999999/edit', {}, UNIFORM_ON);
      assertEqual(res.status === 403, false, `không được là 403 (quyền module vẫn bật) — nhận status=${res.status}`);
    });

    // ===== MODULE_ACCESS_GATED_COLLECTIONS (gác GET /api/data + route TẠO MỚI) =====
    await run.run('MODULE_ACCESS_GATED_COLLECTIONS: đã thêm key "license" -> ["licenses"] và "uniform" -> 4 collection', async () => {
      delete require.cache[require.resolve('../lib/recordViewScope')];
      const { MODULE_ACCESS_GATED_COLLECTIONS } = require('../lib/recordViewScope');
      assertEqual(Array.isArray(MODULE_ACCESS_GATED_COLLECTIONS.license) && MODULE_ACCESS_GATED_COLLECTIONS.license.includes('licenses'), true, 'thiếu license->licenses');
      const uniformCols = MODULE_ACCESS_GATED_COLLECTIONS.uniform || [];
      ['uniformPeriods', 'uniformIssuances', 'uniformStockAdjustments', 'uniformTransfers'].forEach(c => {
        assertEqual(uniformCols.includes(c), true, `thiếu uniform->${c}`);
      });
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
