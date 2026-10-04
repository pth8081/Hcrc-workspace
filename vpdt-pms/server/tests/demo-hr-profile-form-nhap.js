// server/tests/demo-hr-profile-form-nhap.js
//
// DEMO thật (chụp ảnh) — tách riêng từ demo-hr-profile.js để chụp ĐÚNG "form nhập" (Tạo Hồ Sơ Mới +
// Sửa Hồ Sơ) và màn "Quản Lý Hồ Sơ", theo yêu cầu người dùng xem trực quan trước khi quyết định
// Phương án A (bổ sung field còn thiếu so với mẫu Excel). Dùng lại ĐÚNG hạ tầng harness +
// employeeProfile server giả lập như demo-hr-profile.js.
//
// Chạy: node server/tests/demo-hr-profile-form-nhap.js
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = process.env.HRPROFILE_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'hr-profile-form-nhap');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

async function startEmployeeProfileServer(seedUsers) {
  const APP_DATA = { users: seedUsers, employeeProfiles: [] };
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
  const employeeProfile = require('../lib/employeeProfile');
  const app = express();
  app.use(express.json());
  app.use('/api/hr-profile', employeeProfileRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  return { server, port, APP_DATA, employeeProfile };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const h = await startHarness();
  const { page, loginAs, stop } = h;
  await page.setViewportSize({ width: 1400, height: 1200 });

  const seedUsers = await page.evaluate(() => DB.users.map(u => ({ username: u.username, name: u.name, dept: u.dept, jobTitle: u.jobTitle, email: u.email, phone: u.phone, perms: u.perms, active: true })));
  const adminSeed = seedUsers.find(u => u.username === 'admin');
  if (adminSeed) adminSeed.perms = Object.assign({}, adminSeed.perms, { hrProfileManage: true });
  await page.evaluate(() => {
    const u = DB.users.find(x => x.username === 'admin');
    if (u) u.perms = Object.assign({}, u.perms, { hrProfileManage: true });
  });

  const epServer = await startEmployeeProfileServer(seedUsers);
  const { employeeProfile } = epServer;
  const linkedProfile = Object.assign(employeeProfile.defaultProfile('NV2001'), {
    username: 'kd1', status: 'ACTIVE',
    dateOfBirth: '1995-04-12', gender: 'Nam',
    permanentAddress: '12 Đường Lê Lợi, Q.1, TP.HCM', currentAddress: '45 Đường Nguyễn Huệ, Q.1, TP.HCM',
    personalEmail: 'nvkinhdoanh.ca.nhan@gmail.com',
    emergencyContactName: 'Nguyễn Thị Mẹ', emergencyContactPhone: '0911222333', emergencyContactRelationship: 'Mẹ',
    bankAccountNo: '0071000123456', bankName: 'Vietcombank',
    nationalId: '079095001234', socialInsuranceNo: 'HCM0123456789', taxCode: '8012345678',
    dependents: [{ id: 'd1', fullName: 'Nguyễn Văn Con', relationship: 'Con', dateOfBirth: '2020-06-01', taxCode: null }],
    education: [{ id: 'e1', degree: 'Cử nhân', major: 'Quản Trị Kinh Doanh', school: 'Đại Học Kinh Tế TP.HCM', graduationYear: 2017 }]
  });
  epServer.APP_DATA.employeeProfiles.push(linkedProfile);

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

  await loginAs('admin');
  await page.evaluate(() => switchTab('hrProfile'));
  await page.evaluate(() => setHrProfileView('MANAGE'));
  await page.waitForSelector('#hrpfManageTableBody tr', { timeout: 5000 });
  await page.waitForTimeout(200);

  // ===== Ảnh 1: Màn "Quản Lý Hồ Sơ" (danh sách) =====
  await page.screenshot({ path: path.join(OUT_DIR, '1-quan-ly-ho-so.png'), fullPage: true });
  console.log('Đã chụp: 1-quan-ly-ho-so.png');

  // ===== Ảnh 2: Form "➕ Tạo Hồ Sơ Mới" (trống — đúng khuôn form nhập) =====
  await page.click('#hrpfManageCreateBtn');
  await page.waitForSelector('#hrpfCreateModal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '2-form-tao-ho-so-moi.png'), fullPage: true });
  console.log('Đã chụp: 2-form-tao-ho-so-moi.png');
  await page.evaluate(() => closeHrpfCreateModal());

  // ===== Ảnh 3: Form "✏️ Sửa" hồ sơ đã có (đầy đủ dữ liệu — đúng khuôn form nhập khi chỉnh sửa) =====
  await page.click('button[data-op="openHrpfDetailModal"][data-arg0="NV2001"][data-arg1="false"]');
  await page.waitForSelector('#hrpfDetailModal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '3-form-sua-ho-so.png'), fullPage: true });
  console.log('Đã chụp: 3-form-sua-ho-so.png');

  console.log('jsExceptions:', h.jsExceptions);
  await stop();
  epServer.server.close();
  console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
