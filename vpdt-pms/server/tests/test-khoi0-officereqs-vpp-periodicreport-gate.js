// server/tests/test-khoi0-officereqs-vpp-periodicreport-gate.js
//
// Rà soát chuyên sâu toàn hệ thống trước go-live (11/2026, mức Trung bình): officeReqs (Tổng Hợp)/
// vppRegistrations (VPP)/reportPeriods+reportEntries (Báo Cáo Định Kỳ) đã có gate Khối 0 đúng ở route
// TẠO MỚI + DUYỆT/TỪ CHỐI, nhưng các route TỰ PHỤC VỤ (sửa nháp/gửi lại/hủy/tải tài liệu ký/đóng-mở
// kỳ/tổng hợp/công bố...) ở routes/records.js lại KHÔNG gác — admin tắt module cho 1 tài khoản (còn
// giữ quyền chi tiết cũ) vẫn thao tác đầy đủ qua API trực tiếp. Mount THẬT routes/records.js (chỉ stub
// lib/auth để bơm req.freshUser — middleware Khối 0 chạy TRƯỚC mọi handler khác).
//
// Chạy: node server/tests/test-khoi0-officereqs-vpp-periodicreport-gate.js
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

const OFFICE_OFF = { username: 'nv1', name: 'NV 1', dept: 'Phòng A', perms: { officeReqCreate: true, moduleAccess: { office: false } }, active: true };
const OFFICE_ON = { username: 'nv2', name: 'NV 2', dept: 'Phòng A', perms: { officeReqCreate: true, moduleAccess: { office: true } }, active: true };
const VPP_OFF = { username: 'nv3', name: 'NV 3', dept: 'Phòng A', perms: { moduleAccess: { vpp: false } }, active: true };
const VPP_ON = { username: 'nv4', name: 'NV 4', dept: 'Phòng A', perms: { moduleAccess: { vpp: true } }, active: true };
const PR_OFF = { username: 'nv5', name: 'NV 5', dept: 'Phòng A', perms: { reportManage: true, moduleAccess: { periodicReport: false } }, active: true };
const PR_ON = { username: 'nv6', name: 'NV 6', dept: 'Phòng A', perms: { reportManage: true, moduleAccess: { periodicReport: true } }, active: true };
const ALL_USERS = [OFFICE_OFF, OFFICE_ON, VPP_OFF, VPP_ON, PR_OFF, PR_ON];

let CURRENT_USERNAME = OFFICE_ON.username;
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
    // ===== Tổng Hợp (officeReqs) =====
    await run.run('Tổng Hợp: moduleAccess.office=false -> POST /officeReqs/:id/submit bị chặn 403', async () => {
      const res = await api('POST', '/api/records/officeReqs/1/submit', {}, OFFICE_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Tổng Hợp: moduleAccess.office=false -> POST /officeReqs/:id/upload-signed bị chặn 403', async () => {
      const res = await api('POST', '/api/records/officeReqs/1/upload-signed', {}, OFFICE_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Tổng Hợp: moduleAccess.office=true -> KHÔNG bị 403 oan', async () => {
      const res = await api('POST', '/api/records/officeReqs/999999/submit', {}, OFFICE_ON);
      assertEqual(res.status === 403, false, `không được là 403 — nhận status=${res.status}`);
    });

    // ===== Văn Phòng Phẩm (vppRegistrations) =====
    await run.run('VPP: moduleAccess.vpp=false -> POST /vppRegistrations/:id/submit bị chặn 403', async () => {
      const res = await api('POST', '/api/records/vppRegistrations/1/submit', {}, VPP_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('VPP: moduleAccess.vpp=false -> POST /vppRegistrations/:id/cancel bị chặn 403', async () => {
      const res = await api('POST', '/api/records/vppRegistrations/1/cancel', {}, VPP_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('VPP: moduleAccess.vpp=true -> KHÔNG bị 403 oan', async () => {
      const res = await api('POST', '/api/records/vppRegistrations/999999/submit', {}, VPP_ON);
      assertEqual(res.status === 403, false, `không được là 403 — nhận status=${res.status}`);
    });

    // ===== Báo Cáo Định Kỳ (reportPeriods/reportEntries) =====
    await run.run('Báo Cáo Định Kỳ: moduleAccess.periodicReport=false -> POST /reportPeriods/:id/close bị chặn 403', async () => {
      const res = await api('POST', '/api/records/reportPeriods/1/close', {}, PR_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Báo Cáo Định Kỳ: moduleAccess.periodicReport=false -> POST /reportPeriods/:id/publish bị chặn 403', async () => {
      const res = await api('POST', '/api/records/reportPeriods/1/publish', {}, PR_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Báo Cáo Định Kỳ: moduleAccess.periodicReport=false -> POST /reportEntries/:id/submit bị chặn 403', async () => {
      const res = await api('POST', '/api/records/reportEntries/1/submit', {}, PR_OFF);
      assertEqual(res.status, 403, 'phải trả 403');
    });
    await run.run('Báo Cáo Định Kỳ: moduleAccess.periodicReport=true -> KHÔNG bị 403 oan', async () => {
      const res = await api('POST', '/api/records/reportPeriods/999999/close', {}, PR_ON);
      assertEqual(res.status === 403, false, `không được là 403 — nhận status=${res.status}`);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
