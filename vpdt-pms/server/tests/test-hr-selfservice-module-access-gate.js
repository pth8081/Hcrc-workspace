// server/tests/test-hr-selfservice-module-access-gate.js
//
// PQ-01 (đợt test chuyên sâu 9/2026, mục Phân Quyền — "Finding 2"): hrProfile/hrPayroll (module con
// "mở cho MỌI nhân viên", parent:'hr', xem BUSINESS_MODULES ở public/js/core.js) hoàn toàn KHÔNG có
// gate Khối 0 nào ở server — GET/PATCH /api/hr-profile/me và GET /api/payroll/my-payslips* trước đây
// chỉ có requireAuth, bỏ qua hasModuleAccessServer() dù client đã ẩn tab đúng. Test này mount THẬT
// routes/employeeProfile.js + routes/payroll.js, xác nhận: (a) tắt riêng hrProfile/hrPayroll -> 403,
// (b) tắt module CHA "hr" (không tắt riêng hrProfile/hrPayroll) CŨNG phải 403 (parent-cascade, xem
// MODULE_ACCESS_PARENTS ở lib/recordViewScope.js — trước đây hasModuleAccessServer() không mirror quy
// tắc "cha tắt thì con tắt theo" như hasModuleAccess() client), (c) không đụng gì tới moduleAccess ->
// vẫn hoạt động bình thường (không bị chặn oan).
//
// Chạy: node server/tests/test-hr-selfservice-module-access-gate.js
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

const PROFILE_OFF_CHILD = { username: 'nv1', name: 'NV 1', dept: 'Phòng A', perms: { moduleAccess: { hrProfile: false } }, active: true };
const PROFILE_OFF_PARENT = { username: 'nv2', name: 'NV 2', dept: 'Phòng A', perms: { moduleAccess: { hr: false } }, active: true };
const PROFILE_ON = { username: 'nv3', name: 'NV 3', dept: 'Phòng A', perms: {}, active: true };
const ALL_USERS = [PROFILE_OFF_CHILD, PROFILE_OFF_PARENT, PROFILE_ON];

const EMPLOYEE_PROFILES = [
  { employeeCode: 'NV001', username: 'nv1', status: 'ACTIVE' },
  { employeeCode: 'NV002', username: 'nv2', status: 'ACTIVE' },
  { employeeCode: 'NV003', username: 'nv3', status: 'ACTIVE' }
];
const PAYROLL_PERIODS = [{ id: 1, status: 'PUBLISHED', periodName: 'Kỳ 1', periodMonth: 1, periodYear: 2026 }];
const PAYSLIPS = [
  { id: 10, periodId: 1, employeeCode: 'NV001', netPay: 1000 },
  { id: 11, periodId: 1, employeeCode: 'NV002', netPay: 1000 },
  { id: 12, periodId: 1, employeeCode: 'NV003', netPay: 1000 }
];

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key === 'employeeProfiles' ? EMPLOYEE_PROFILES.map(p => ({ ...p })) : []),
  getAllAppData: async () => ({ employeeProfiles: EMPLOYEE_PROFILES }),
  withLockedAppDataValue: async (key, fn) => fn(EMPLOYEE_PROFILES.map(p => ({ ...p })))
});
stubModule('lib/recordStore', {
  getAllForCollection: async (col) => (col === 'payslips' ? PAYSLIPS.map(p => ({ ...p })) : col === 'payrollPeriods' ? PAYROLL_PERIODS.map(p => ({ ...p })) : []),
  insertRecord: async () => {}, deleteRecordById: async () => {},
  withLockedRecordForCollection: async () => {}, withLockedRecordById: async () => {}
});

let CURRENT_USERNAME = PROFILE_ON.username;
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

const employeeProfileRoutes = require('../routes/employeeProfile');
const payrollRoutes = require('../routes/payroll');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/hr-profile', employeeProfileRoutes);
  app.use('/api/payroll', payrollRoutes);
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
    await run.run('PQ-01 (hrProfile): moduleAccess.hrProfile=false -> GET /api/hr-profile/me bị chặn 403', async () => {
      const res = await api('GET', '/api/hr-profile/me', undefined, PROFILE_OFF_CHILD);
      assertEqual(res.status, 403, 'phải trả 403');
    });

    await run.run('PQ-01 (hrProfile): tắt module CHA "hr" (không tắt riêng hrProfile) -> vẫn bị chặn 403 (parent-cascade)', async () => {
      const res = await api('GET', '/api/hr-profile/me', undefined, PROFILE_OFF_PARENT);
      assertEqual(res.status, 403, 'phải trả 403 vì module cha "hr" đang tắt');
    });

    await run.run('PQ-01 (hrProfile): moduleAccess bình thường -> GET /api/hr-profile/me vẫn xem được (không chặn oan)', async () => {
      const res = await api('GET', '/api/hr-profile/me', undefined, PROFILE_ON);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual(res.body?.profile?.employeeCode, 'NV003', 'phải trả đúng hồ sơ của chính mình');
    });

    await run.run('PQ-01 (hrProfile): moduleAccess.hrProfile=false -> PATCH /api/hr-profile/me bị chặn 403', async () => {
      const res = await api('PATCH', '/api/hr-profile/me', { phone: '0900000000' }, PROFILE_OFF_CHILD);
      assertEqual(res.status, 403, 'phải trả 403');
    });

    await run.run('PQ-01 (hrPayroll): moduleAccess.hrProfile=false KHÔNG ảnh hưởng hrPayroll (2 module độc lập)', async () => {
      const res = await api('GET', '/api/payroll/my-payslips', undefined, PROFILE_OFF_CHILD);
      assertEqual(res.status, 200, 'hrPayroll không bị chặn oan chỉ vì hrProfile bị tắt (2 quyền độc lập)');
    });

    await run.run('PQ-01 (hrPayroll): tắt module CHA "hr" -> GET /api/payroll/my-payslips bị chặn 403 (parent-cascade)', async () => {
      const res = await api('GET', '/api/payroll/my-payslips', undefined, PROFILE_OFF_PARENT);
      assertEqual(res.status, 403, 'phải trả 403 vì module cha "hr" đang tắt');
    });

    await run.run('PQ-01 (hrPayroll): tắt module CHA "hr" -> GET /api/payroll/my-payslips/:periodId CŨNG bị chặn 403', async () => {
      const res = await api('GET', '/api/payroll/my-payslips/1', undefined, PROFILE_OFF_PARENT);
      assertEqual(res.status, 403, 'phải trả 403');
    });

    await run.run('PQ-01 (hrPayroll): moduleAccess bình thường -> GET /api/payroll/my-payslips vẫn xem được', async () => {
      const res = await api('GET', '/api/payroll/my-payslips', undefined, PROFILE_ON);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual((res.body?.payslips || []).length, 1, 'phải thấy đúng phiếu lương của chính mình');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
