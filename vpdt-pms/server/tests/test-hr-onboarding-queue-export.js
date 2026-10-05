// server/tests/test-hr-onboarding-queue-export.js
//
// Regression test TRÌNH DUYỆT THẬT (Playwright, _harness-contract.js — cùng khuôn
// test-hr-profile-90field-ui.js) cho nút "📊 Xuất Excel" mới ở tab "🕐 Hồ Sơ Onboarding" (hàng đợi hồ sơ
// nháp PENDING/CANCELLED/CONFIRMED, module-hrprofile.js) — theo yêu cầu người dùng: tab này CHỈ cần
// Xuất Excel, KHÔNG cần Tải Mẫu/Nhập (khác hẳn tab "Quản Lý Hồ Sơ" đã có đủ 3 nút, và khác hẳn màn
// "Nhân Sự > Onboarding / Offboarding" — module-hrlifecycle.js, quy trình checklist riêng).
//
// Chạy: node server/tests/test-hr-onboarding-queue-export.js
'use strict';

const http = require('http');
const express = require('express');
const assert = require('assert');
const { startHarness } = require('./_harness-contract');

function stubModule(relPath, exportsObj) {
  const path = require('path');
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
  const h = await startHarness();
  const { page, loginAs, stop } = h;
  let epServer;
  let failures = 0;
  const check = (label, cond) => {
    if (cond) { console.log(`PASS: ${label}`); } else { console.log(`FAIL: ${label}`); failures++; }
  };
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  const HR_ONBOARD = { username: 'hronb1', name: 'Phụ Trách Onboarding', dept: 'Phòng Nhân Sự', perms: { hrOnboardingManage: true }, active: true };

  try {
    const employeeProfileLib = require('../lib/employeeProfile');
    const pendingProfile = Object.assign(employeeProfileLib.defaultProfile('NVPD01'), {
      status: 'DRAFT', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên', processId: 1,
      onboardingQueueStatus: 'PENDING', createdAt: '2026-10-01T08:00:00.000Z'
    });
    const cancelledProfile = Object.assign(employeeProfileLib.defaultProfile('NVHUY01'), {
      status: 'DRAFT', dept: 'Phòng Kế Toán', jobTitle: 'Chuyên viên', processId: 2,
      onboardingQueueStatus: 'CANCELLED', onboardingQueueCancelReason: 'Ứng viên không tới nhận việc',
      createdAt: '2026-09-28T08:00:00.000Z'
    });

    epServer = await startEmployeeProfileServer([HR_ONBOARD], [pendingProfile, cancelledProfile]);

    await page.evaluate((u) => {
      const idx = DB.users.findIndex((x) => x.username === u.username);
      if (idx >= 0) DB.users[idx] = u; else DB.users.push(u);
    }, HR_ONBOARD);
    // hrpfIdentitySnapshot() tra DB.hrProcesses theo processId để lấy fullName (profile không tự lưu).
    await page.evaluate(() => {
      DB.hrProcesses = [
        { id: 1, fullName: 'Nguyễn Văn Chờ', employeeDept: 'Phòng Kinh Doanh', employeeJobTitle: 'Nhân viên' },
        { id: 2, fullName: 'Trần Thị Huỷ', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Chuyên viên' }
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

    check('Nút "📊 Xuất Excel" hiện trong tab Hồ Sơ Onboarding', await page.evaluate(() =>
      !!document.querySelector('#hrpfViewOnboardingQueue [data-op="exportHrpfOnboardingQueueExcel"]')));

    const captured = await page.evaluate(() => {
      const originalFn = window.downloadXlsxFromServer;
      let captured = null;
      window.downloadXlsxFromServer = (fileName, sheetName, columns, rows) => { captured = { fileName, columns, rows }; };
      exportHrpfOnboardingQueueExcel();
      window.downloadXlsxFromServer = originalFn;
      return captured;
    });
    check('exportHrpfOnboardingQueueExcel(): gọi downloadXlsxFromServer() đúng tên file', captured && captured.fileName === 'Ho_So_Onboarding.xlsx');
    check('exportHrpfOnboardingQueueExcel(): có đủ cả 2 dòng PENDING + CANCELLED', captured && captured.rows.length === 2);
    const pendingRow = captured && captured.rows.find(r => r.employeeCode === 'NVPD01');
    check('Dòng PENDING: đúng tên (tra qua hrProcesses), đúng nhãn trạng thái', !!pendingRow && pendingRow.fullName === 'Nguyễn Văn Chờ' && pendingRow.statusLabel === 'Chờ xác nhận');
    const cancelledRow = captured && captured.rows.find(r => r.employeeCode === 'NVHUY01');
    check('Dòng CANCELLED: đúng lý do hủy', !!cancelledRow && cancelledRow.cancelReason === 'Ứng viên không tới nhận việc');

    // Real click nút thật trong DOM (xác nhận bindCspDelegation đã đăng ký đúng, không phải chỉ gọi hàm tay).
    await page.evaluate(() => {
      window.__exportCalled = false;
      window.__origExportFn = exportHrpfOnboardingQueueExcel;
      exportHrpfOnboardingQueueExcel = () => { window.__exportCalled = true; };
    });
    await page.click('[data-op="exportHrpfOnboardingQueueExcel"]');
    await page.waitForTimeout(100);
    check('Real click nút thật -> gọi đúng exportHrpfOnboardingQueueExcel()', await page.evaluate(() => window.__exportCalled));
    await page.evaluate(() => { exportHrpfOnboardingQueueExcel = window.__origExportFn; });

    check('Không có ngoại lệ JS chưa bắt (pageerror) nào phát sinh', pageErrors.length === 0);
    if (pageErrors.length) console.error('  pageerror:', pageErrors.join(' | '));
  } finally {
    if (epServer) epServer.server.close();
    await stop();
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  if (failures > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
