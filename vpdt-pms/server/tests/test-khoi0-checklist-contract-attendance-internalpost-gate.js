// server/tests/test-khoi0-checklist-contract-attendance-internalpost-gate.js
//
// Rà soát chuyên sâu lần 2 trước go-live (11/2026): 6 lỗ hổng Khối 0 (moduleAccess) vừa vá, phát hiện
// qua agent audit "Phân quyền & Khối 0 gating":
//   1. [Cao] routes/checklist.js (Checklist Đánh Giá Siêu Thị) — router RIÊNG, chưa từng gác Khối 0 ở
//      server, admin tắt moduleAccess.checklist không cản được gọi API trực tiếp.
//   2. [Cao] laborContracts — assertContractManage() (routes/records.js) chỉ kiểm hrContractManage,
//      thiếu hasModuleAccessServer(user,'hrContract').
//   3. [Cao] Công & Phép (leaveRequests/attendanceRecords/leaveBalances/shiftRoster/shiftSwapRequests)
//      — mọi route hành động thiếu router.use gác moduleAccess.hrAttendance.
//   4. [Cao] routes/create.js — reportPeriods/reportEntries/vppPeriods/checklistTemplates TẠO MỚI
//      chưa từng gác Khối 0 (bất đối xứng với route hành động đã gác đúng ở records.js).
//   5. [Trung Bình] vppPeriods — thiếu router.use gác moduleAccess.vpp ở route hành động (delete/close).
//   6. [Trung Bình] internalPosts — assertCanViewInternalPost() (dùng ở 15/16 route tự phục vụ) thiếu
//      hasModuleAccessServer(user,'internal').
//
// Mount THẬT routes/records.js + routes/checklist.js + routes/create.js (chỉ stub lib/auth để bơm
// req.freshUser + lib/appData để route create.js không cần SQL thật — middleware Khối 0 chạy TRƯỚC mọi
// handler động tới DB).
//
// Chạy: node server/tests/test-khoi0-checklist-contract-attendance-internalpost-gate.js
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

const CHECKLIST_OFF = { username: 'nv1', name: 'NV 1', dept: 'Phòng A', perms: { checklistExecute: true, moduleAccess: { checklist: false } }, active: true };
const CHECKLIST_ON = { username: 'nv2', name: 'NV 2', dept: 'Phòng A', perms: { checklistExecute: true, moduleAccess: { checklist: true } }, active: true };
const CONTRACT_OFF = { username: 'nv3', name: 'NV 3', dept: 'Phòng A', perms: { hrContractManage: true, moduleAccess: { hrContract: false } }, active: true };
const CONTRACT_ON = { username: 'nv4', name: 'NV 4', dept: 'Phòng A', perms: { hrContractManage: true, moduleAccess: { hrContract: true } }, active: true };
const ATT_OFF = { username: 'nv5', name: 'NV 5', dept: 'Phòng A', perms: { hrAttendanceManage: true, moduleAccess: { hrAttendance: false } }, active: true };
const ATT_ON = { username: 'nv6', name: 'NV 6', dept: 'Phòng A', perms: { hrAttendanceManage: true, moduleAccess: { hrAttendance: true } }, active: true };
const VPPP_OFF = { username: 'nv7', name: 'NV 7', dept: 'Phòng A', perms: { vppManage: true, moduleAccess: { vpp: false } }, active: true };
const VPPP_ON = { username: 'nv8', name: 'NV 8', dept: 'Phòng A', perms: { vppManage: true, moduleAccess: { vpp: true } }, active: true };
const PR_CREATE_OFF = { username: 'nv9', name: 'NV 9', dept: 'Phòng A', perms: { reportManage: true, reportEntryCreate: true, moduleAccess: { periodicReport: false } }, active: true };
const PR_CREATE_ON = { username: 'nv10', name: 'NV 10', dept: 'Phòng A', perms: { reportManage: true, reportEntryCreate: true, moduleAccess: { periodicReport: true } }, active: true };
const CL_CREATE_OFF = { username: 'nv11', name: 'NV 11', dept: 'Phòng A', perms: { checklistManage: true, moduleAccess: { checklist: false } }, active: true };
const CL_CREATE_ON = { username: 'nv12', name: 'NV 12', dept: 'Phòng A', perms: { checklistManage: true, moduleAccess: { checklist: true } }, active: true };
const VPPP_CREATE_OFF = { username: 'nv13', name: 'NV 13', dept: 'Phòng A', perms: { vppManage: true, moduleAccess: { vpp: false } }, active: true };
const VPPP_CREATE_ON = { username: 'nv14', name: 'NV 14', dept: 'Phòng A', perms: { vppManage: true, moduleAccess: { vpp: true } }, active: true };
const INTERNAL_OFF = { username: 'nv15', name: 'NV 15', dept: 'Phòng A', perms: { moduleAccess: { internal: false } }, active: true };
const INTERNAL_ON = { username: 'nv16', name: 'NV 16', dept: 'Phòng A', perms: { moduleAccess: { internal: true } }, active: true };

const ALL_USERS = [
  CHECKLIST_OFF, CHECKLIST_ON, CONTRACT_OFF, CONTRACT_ON, ATT_OFF, ATT_ON, VPPP_OFF, VPPP_ON,
  PR_CREATE_OFF, PR_CREATE_ON, CL_CREATE_OFF, CL_CREATE_ON, VPPP_CREATE_OFF, VPPP_CREATE_ON,
  INTERNAL_OFF, INTERNAL_ON
];

let CURRENT_USERNAME = CHECKLIST_ON.username;
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
// routes/create.js gọi getAllAppData() TRƯỚC KHI chạy tới kiểm tra Khối 0 (xem thứ tự thật trong code)
// — không stub thì lượt test "phải 403" cũng không tới được vì gãy sớm bởi thiếu SQL Server thật.
stubModule('lib/appData', {
  getAllAppData: async () => ({}),
  getAppDataValue: async () => null,
  getAppDataValueCached: async () => null,
  withLockedAppDataValue: async (key, fn) => fn(null)
});

const recordsRoutes = require('../routes/records');
const checklistRoutes = require('../routes/checklist');
const createRoutes = require('../routes/create');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordsRoutes);
  app.use('/api/checklist', checklistRoutes);
  app.use('/api/create', createRoutes);
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
    // ===== 1. Checklist Đánh Giá Siêu Thị (router riêng) =====
    await run.run('Checklist: moduleAccess.checklist=false -> POST /submissions/start bị chặn 403', async () => {
      const res = await api('POST', '/api/checklist/submissions/start', {}, CHECKLIST_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Checklist: moduleAccess.checklist=false -> POST /templates/:id/clone bị chặn 403', async () => {
      const res = await api('POST', '/api/checklist/templates/1/clone', {}, CHECKLIST_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Checklist: moduleAccess.checklist=true -> KHÔNG bị 403 oan', async () => {
      const res = await api('POST', '/api/checklist/submissions/start', {}, CHECKLIST_ON);
      assertEqual(res.status === 403, false, `không được là 403 — nhận status=${res.status}`);
    });

    // ===== 2. Hợp Đồng Lao Động (laborContracts, qua assertContractManage) =====
    await run.run('Hợp Đồng Lao Động: moduleAccess.hrContract=false -> POST /laborContracts/:id/edit bị chặn 403', async () => {
      const res = await api('POST', '/api/records/laborContracts/1/edit', {}, CONTRACT_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Hợp Đồng Lao Động: moduleAccess.hrContract=false -> POST /laborContracts/:id/activate bị chặn 403', async () => {
      const res = await api('POST', '/api/records/laborContracts/1/activate', {}, CONTRACT_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Hợp Đồng Lao Động: moduleAccess.hrContract=true -> KHÔNG bị 403 oan', async () => {
      const res = await api('POST', '/api/records/laborContracts/999999/edit', {}, CONTRACT_ON);
      assertEqual(res.status === 403, false, `không được là 403 — nhận status=${res.status}`);
    });

    // ===== 3. Công & Phép (leaveRequests/attendanceRecords/leaveBalances/shiftRoster/shiftSwapRequests) =====
    await run.run('Công & Phép: moduleAccess.hrAttendance=false -> POST /leaveRequests/:id/cancel bị chặn 403', async () => {
      const res = await api('POST', '/api/records/leaveRequests/1/cancel', {}, ATT_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Công & Phép: moduleAccess.hrAttendance=false -> POST /attendanceRecords/:id/edit bị chặn 403', async () => {
      const res = await api('POST', '/api/records/attendanceRecords/1/edit', {}, ATT_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Công & Phép: moduleAccess.hrAttendance=false -> POST /shiftSwapRequests/:id/approve bị chặn 403', async () => {
      const res = await api('POST', '/api/records/shiftSwapRequests/1/approve', {}, ATT_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Công & Phép: moduleAccess.hrAttendance=true -> KHÔNG bị 403 oan', async () => {
      const res = await api('POST', '/api/records/leaveRequests/999999/cancel', {}, ATT_ON);
      assertEqual(res.status === 403, false, `không được là 403 — nhận status=${res.status}`);
    });

    // ===== 4. vppPeriods (hành động: delete/close) =====
    await run.run('vppPeriods: moduleAccess.vpp=false -> POST /vppPeriods/:id/delete bị chặn 403', async () => {
      const res = await api('POST', '/api/records/vppPeriods/1/delete', {}, VPPP_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('vppPeriods: moduleAccess.vpp=false -> POST /vppPeriods/:id/close bị chặn 403', async () => {
      const res = await api('POST', '/api/records/vppPeriods/1/close', {}, VPPP_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('vppPeriods: moduleAccess.vpp=true -> KHÔNG bị 403 oan', async () => {
      const res = await api('POST', '/api/records/vppPeriods/999999/close', {}, VPPP_ON);
      assertEqual(res.status === 403, false, `không được là 403 — nhận status=${res.status}`);
    });

    // ===== 5. routes/create.js — reportPeriods/reportEntries/vppPeriods/checklistTemplates TẠO MỚI =====
    await run.run('TẠO MỚI: moduleAccess.periodicReport=false -> POST /api/create/reportPeriods bị chặn 403', async () => {
      const res = await api('POST', '/api/create/reportPeriods', { dept: 'Phòng A' }, PR_CREATE_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('TẠO MỚI: moduleAccess.periodicReport=false -> POST /api/create/reportEntries bị chặn 403', async () => {
      const res = await api('POST', '/api/create/reportEntries', { dept: 'Phòng A' }, PR_CREATE_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('TẠO MỚI: moduleAccess.periodicReport=true -> KHÔNG bị 403 oan', async () => {
      const res = await api('POST', '/api/create/reportPeriods', { dept: 'Phòng A' }, PR_CREATE_ON);
      assertEqual(res.status === 403, false, `không được là 403 — nhận status=${res.status}`);
    });
    await run.run('TẠO MỚI: moduleAccess.vpp=false -> POST /api/create/vppPeriods bị chặn 403', async () => {
      const res = await api('POST', '/api/create/vppPeriods', { dept: 'Phòng A' }, VPPP_CREATE_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('TẠO MỚI: moduleAccess.vpp=true -> KHÔNG bị 403 oan', async () => {
      const res = await api('POST', '/api/create/vppPeriods', { dept: 'Phòng A' }, VPPP_CREATE_ON);
      assertEqual(res.status === 403, false, `không được là 403 — nhận status=${res.status}`);
    });
    await run.run('TẠO MỚI: moduleAccess.checklist=false -> POST /api/create/checklistTemplates bị chặn 403', async () => {
      const res = await api('POST', '/api/create/checklistTemplates', {}, CL_CREATE_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('TẠO MỚI: moduleAccess.checklist=true -> KHÔNG bị 403 oan', async () => {
      const res = await api('POST', '/api/create/checklistTemplates', {}, CL_CREATE_ON);
      assertEqual(res.status === 403, false, `không được là 403 — nhận status=${res.status}`);
    });

    // ===== 6. internalPosts (assertCanViewInternalPost — dùng ở 15/16 route tự phục vụ) =====
    await run.run('internalPosts: moduleAccess.internal=false -> POST /internalPosts/:id/mark-read bị chặn 403', async () => {
      const res = await api('POST', '/api/records/internalPosts/1/mark-read', {}, INTERNAL_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('internalPosts: moduleAccess.internal=false -> POST /internalPosts/:id/like bị chặn 403', async () => {
      const res = await api('POST', '/api/records/internalPosts/1/like', {}, INTERNAL_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('internalPosts: moduleAccess.internal=false -> POST /internalPosts/:id/comment bị chặn 403', async () => {
      const res = await api('POST', '/api/records/internalPosts/1/comment', { content: 'x' }, INTERNAL_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('internalPosts: moduleAccess.internal=true -> KHÔNG bị 403 oan', async () => {
      const res = await api('POST', '/api/records/internalPosts/999999/mark-read', {}, INTERNAL_ON);
      assertEqual(res.status === 403, false, `không được là 403 — nhận status=${res.status}`);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
