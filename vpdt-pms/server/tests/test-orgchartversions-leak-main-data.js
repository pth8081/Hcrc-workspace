// server/tests/test-orgchartversions-leak-main-data.js
//
// Re-audit lần 5 (mức Cao): "orgChartVersions" (AppData key thô, lib/orgChart.js — lưu toàn bộ cây Cơ
// Cấu Tổ Chức + Luồng Đánh Giá KPI Theo Vị Trí) trước đây CHƯA TỪNG được lọc/xoá ở GET /api/data —
// `const data = { ...cachedAppData.data }` (routes/data.js, đầu handler) spread TẤT CẢ key AppData, nên
// orgChartVersions lộ NGUYÊN VẸN cho BẤT KỲ ai đã đăng nhập gọi thẳng GET /api/data, bất kể
// orgChartManage/nhanSuManage/kpiFlowConfigManage/moduleAccess.orgChart — route THẬT duy nhất client sử
// dụng (GET /api/org-chart/versions*, routes/orgChart.js) đã gác đúng cả 2 lớp quyền từ trước, chỉ riêng
// đường GET /api/data chung này bị bỏ sót (cùng lớp lỗi đã vá cho employeeProfiles trước đó).
//
// Đã vá: thêm `delete data.orgChartVersions;` ngay sau khối employeeProfiles — client KHÔNG hề đọc
// DB.orgChartVersions (module-orgchart.js luôn gọi route riêng), nên xoá hẳn, không cần giữ field dẫn
// xuất nào.
//
// Chạy: node server/tests/test-orgchartversions-leak-main-data.js
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

const NV1 = { username: 'nv1', name: 'NV 1', dept: 'Phòng A', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const ALL_USERS_LIST = [NV1, ADMIN];

const ORG_CHART_VERSIONS = [{ id: 1, nodes: [{ id: 1, title: 'Tổng Giám Đốc' }], kpiFlow: [] }];

let APP_DATA;
function resetData() {
  APP_DATA = { users: ALL_USERS_LIST.map(u => ({ ...u })), orgChartVersions: ORG_CHART_VERSIONS.map(v => ({ ...v })) };
}
resetData();

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(),
  getAllForCollectionCached: async () => [],
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async () => []
});

let CURRENT_USERNAME = NV1.username;
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
    await run.run('LỖI ĐÃ VÁ: GET /api/data KHÔNG còn trả field "orgChartVersions" cho user thường (không orgChartManage/nhanSuManage/kpiFlowConfigManage nào)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, NV1);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual(Object.prototype.hasOwnProperty.call(res.body, 'orgChartVersions'), false, 'orgChartVersions phải bị xoá hoàn toàn khỏi response, không chỉ rỗng');
    });

    await run.run('LỖI ĐÃ VÁ: GET /api/data KHÔNG còn trả field "orgChartVersions" cho CẢ admin (route thật duy nhất là GET /api/org-chart/versions*, không phải đây)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      assertEqual(Object.prototype.hasOwnProperty.call(res.body, 'orgChartVersions'), false, 'orgChartVersions phải bị xoá hoàn toàn khỏi response dù là admin — route thật nằm ở /api/org-chart, không phải /api/data');
    });

    await run.run('Dữ liệu khác (users) vẫn trả về bình thường (không bị xoá oan cùng lúc)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, NV1);
      assertEqual(Array.isArray(res.body.users), true, 'users vẫn phải có mặt trong response');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
