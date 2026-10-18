// server/tests/test-khoi0-orgchart-gate.js
//
// Re-audit lần 4 (mức Cao): routes/orgChart.js ("Cơ Cấu Tổ Chức" + "Cấu Hình Luồng Đánh Giá KPI Theo Vị
// Trí") là router RIÊNG (không qua routes/records.js chung) nên KHÔNG tự động được hưởng vòng lặp
// zero-out Khối 0 ở routes/data.js — module này cũng KHÔNG nằm trong DB.* chung (dữ liệu tự quản lý qua
// khoá AppData riêng "orgChartVersions", xem lib/orgChart.js) nên không đi qua GET /api/data(/reports)
// nào cả. Trước khi vá, router CHỈ có `router.use(requireAuth, blockIfMustChangePassword)` — hoàn toàn
// không gọi hasModuleAccessServer() — admin tắt moduleAccess.orgChart cho 1 tài khoản (còn giữ
// orgChartManage/nhanSuManage/kpiFlowConfigManage) vẫn gọi thẳng MỌI route (xem/sửa cây/luồng KPI) không
// bị cản gì.
//
// Đã thêm middleware `requireOrgChartModuleAccess` (mirror đúng khuôn requireChecklistModuleAccess() ở
// routes/checklist.js/requireHrPayrollModuleAccess() ở routes/payroll.js) vào router.use() đầu file.
//
// Test này mount THẬT routes/orgChart.js (chỉ stub lib/appData/lib/auth/lib/recordStore ở mức tối thiểu
// — middleware router.use() gác Khối 0 chạy TRƯỚC MỌI handler khác nên không cần stub sâu hơn) để xác
// nhận: (a) tắt module -> 403 ở MỌI route (xem/sửa cây/KPI), (b) bật module -> KHÔNG bị 403 oan (đi tiếp
// tới lỗi quyền chi tiết/dữ liệu khác, không phải lỗi Khối 0).
//
// Chạy: node server/tests/test-khoi0-orgchart-gate.js
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

const ORGCHART_OFF = { username: 'nv1', name: 'NV 1', dept: 'Phòng Nhân Sự', perms: { orgChartManage: true, nhanSuManage: true, kpiFlowConfigManage: true, moduleAccess: { orgChart: false } }, active: true };
const ORGCHART_ON = { username: 'nv2', name: 'NV 2', dept: 'Phòng Nhân Sự', perms: { orgChartManage: true, kpiFlowConfigManage: true, moduleAccess: { orgChart: true } }, active: true };
const ALL_USERS_LIST = [ORGCHART_OFF, ORGCHART_ON];

let APP_DATA;
function resetData() {
  APP_DATA = { users: ALL_USERS_LIST.map(u => ({ ...u })), orgChartVersions: [], employeeProfiles: [] };
}
resetData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});
stubModule('lib/recordStore', { getAllForCollection: async () => [] });

let CURRENT_USERNAME = ORGCHART_ON.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = ALL_USERS_LIST.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p, isBcryptHash: () => false, validatePin: () => null
});

const orgChartRoutes = require('../routes/orgChart');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/org-chart', orgChartRoutes);
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
    await run.run('Cơ Cấu Tổ Chức: moduleAccess.orgChart=false -> GET /versions bị chặn 403 dù còn đủ orgChartManage/nhanSuManage/kpiFlowConfigManage', async () => {
      resetData();
      const res = await api('GET', '/api/org-chart/versions', undefined, ORGCHART_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });

    await run.run('Cơ Cấu Tổ Chức: moduleAccess.orgChart=false -> POST /bootstrap (sửa cây) cũng bị chặn 403', async () => {
      resetData();
      const res = await api('POST', '/api/org-chart/bootstrap', { versionName: 'Test' }, ORGCHART_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });

    await run.run('Cơ Cấu Tổ Chức: moduleAccess.orgChart=false -> GET /kpi-flow (luồng KPI) cũng bị chặn 403', async () => {
      resetData();
      const res = await api('GET', '/api/org-chart/kpi-flow', undefined, ORGCHART_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });

    await run.run('Cơ Cấu Tổ Chức: moduleAccess.orgChart=false -> GET /kpi-evaluators/:username cũng bị chặn 403', async () => {
      resetData();
      const res = await api('GET', '/api/org-chart/kpi-evaluators/nv1', undefined, ORGCHART_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });

    await run.run('Cơ Cấu Tổ Chức: moduleAccess.orgChart=true -> KHÔNG bị 403 oan (GET /versions trả 200)', async () => {
      resetData();
      const res = await api('GET', '/api/org-chart/versions', undefined, ORGCHART_ON);
      assertEqual(res.status, 200, `không được là 403 (quyền module vẫn bật) — nhận status=${res.status}`);
    });

    await run.run('Cơ Cấu Tổ Chức: moduleAccess.orgChart=true -> POST /bootstrap KHÔNG bị 403 oan (đi tiếp qua logic thật)', async () => {
      resetData();
      const res = await api('POST', '/api/org-chart/bootstrap', { versionName: 'Test' }, ORGCHART_ON);
      assertEqual(res.status === 403, false, `không được là 403 (quyền module vẫn bật) — nhận status=${res.status}`);
    });

    run.summary();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
