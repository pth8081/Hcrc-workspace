// server/tests/demo-hr-onboarding-queue-export.js
//
// DEMO thật (chụp ảnh, KHÔNG phải test regression) cho nút "📊 Xuất Excel" mới ở tab "🕐 Hồ Sơ
// Onboarding" (hàng đợi hồ sơ nháp, module-hrprofile.js — v25.11).
//
// Chạy: node server/tests/demo-hr-onboarding-queue-export.js
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = process.env.HRPF_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'hr-onboarding-queue-export-v25.11');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

async function startEmployeeProfileServer(seedUsers, seedProfiles) {
  const APP_DATA = { users: seedUsers, employeeProfiles: seedProfiles, hrProcesses: [] };
  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
    getAllAppData: async () => APP_DATA,
    withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
  });
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const username = req.headers['x-demo-user'];
      const fresh = (APP_DATA.users || []).find(u => u.username === username);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      req.allUsers = APP_DATA.users;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  const employeeProfileRoutes = require('../routes/employeeProfile');
  const app = express();
  app.use(express.json());
  app.use('/api/hr-profile', employeeProfileRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  return { server, port, APP_DATA };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const h = await startHarness();
  const { page, loginAs, stop } = h;
  await page.setViewportSize({ width: 1500, height: 1000 });

  const HR_ONBOARD = { username: 'hronb1', name: 'Phụ Trách Onboarding', dept: 'Phòng Nhân Sự', perms: { hrOnboardingManage: true }, active: true };

  const employeeProfileLib = require('../lib/employeeProfile');
  const pendingProfile = Object.assign(employeeProfileLib.defaultProfile('NV2101'), {
    status: 'DRAFT', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên', processId: 1,
    onboardingQueueStatus: 'PENDING', createdAt: '2026-10-05T08:00:00.000Z'
  });
  const confirmedProfile = Object.assign(employeeProfileLib.defaultProfile('NV2098'), {
    status: 'ACTIVE', dept: 'Phòng Kế Toán', jobTitle: 'Chuyên viên', processId: 2,
    onboardingQueueStatus: 'CONFIRMED', createdAt: '2026-10-02T08:00:00.000Z'
  });
  const cancelledProfile = Object.assign(employeeProfileLib.defaultProfile('NV2095'), {
    status: 'DRAFT', dept: 'Phòng Marketing', jobTitle: 'Nhân viên', processId: 3,
    onboardingQueueStatus: 'CANCELLED', onboardingQueueCancelReason: 'Ứng viên nhận việc nơi khác',
    createdAt: '2026-09-30T08:00:00.000Z'
  });

  const epServer = await startEmployeeProfileServer([HR_ONBOARD], [pendingProfile, confirmedProfile, cancelledProfile]);

  await page.evaluate((u) => {
    const idx = DB.users.findIndex((x) => x.username === u.username);
    if (idx >= 0) DB.users[idx] = u; else DB.users.push(u);
  }, HR_ONBOARD);
  await page.evaluate(() => {
    DB.hrProcesses = [
      { id: 1, fullName: 'Nguyễn Văn Ứng Viên', employeeDept: 'Phòng Kinh Doanh', employeeJobTitle: 'Nhân viên' },
      { id: 2, fullName: 'Trần Thị Đã Nhận', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Chuyên viên' },
      { id: 3, fullName: 'Lê Văn Không Tới', employeeDept: 'Phòng Marketing', employeeJobTitle: 'Nhân viên' }
    ];
  });

  await page.exposeFunction('__hrProfileFetch', async (method, urlPath, bodyStr, username) => {
    const res = await fetch(`http://127.0.0.1:${epServer.port}${urlPath}`, {
      method,
      headers: Object.assign({ 'x-demo-user': username || '' }, bodyStr !== null ? { 'Content-Type': 'application/json' } : {}),
      body: bodyStr === null ? undefined : bodyStr
    });
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { status: res.status, body };
  });
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.indexOf('/api/hr-profile') === 0) {
        const method = (opts && opts.method) || 'GET';
        const bodyStr = typeof (opts && opts.body) === 'string' ? opts.body : null;
        const username = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.username : null;
        const result = await window.__hrProfileFetch(method, url, bodyStr, username);
        return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
      }
      return originalFetch(url, opts);
    };
  });

  await loginAs('hronb1');
  await page.evaluate(() => { switchTab('hrProfile'); setHrProfileView('ONBOARDING_QUEUE'); });
  await page.waitForSelector('#hrpfOnboardingQueueTableBody tr', { timeout: 5000 });
  await page.waitForTimeout(200);

  await page.screenshot({ path: path.join(OUT_DIR, '1-ho-so-onboarding-nut-xuat-excel.png'), fullPage: false });
  console.log('Đã chụp: 1-ho-so-onboarding-nut-xuat-excel.png');

  const result = await page.evaluate(() => {
    let captured = null;
    window.downloadXlsxFromServer = (fileName, sheetName, columns, rows) => { captured = { fileName, rowCount: rows.length }; };
    exportHrpfOnboardingQueueExcel();
    return captured;
  });
  console.log('exportHrpfOnboardingQueueExcel() trả về:', result);

  console.log('jsExceptions:', h.jsExceptions);
  await stop();
  epServer.server.close();
  console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
