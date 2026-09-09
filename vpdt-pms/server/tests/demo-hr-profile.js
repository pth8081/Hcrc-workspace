// server/tests/demo-hr-profile.js
//
// DEMO thật (chụp ảnh, không phải bộ hồi quy — tests/test-hr-profile.js đã phủ luật nghiệp vụ) cho
// module "Hồ Sơ Nhân Sự" (Đợt 1/4 module Nhân Sự). Dùng ĐÚNG hạ tầng Playwright thật của
// tests/_harness-contract.js (Chromium thật mở public/index.html thật + toàn bộ public/js/*.js thật)
// CỘNG THÊM 1 lớp riêng cho route DEDICATED /api/hr-profile/* (module này KHÔNG đi qua GET /api/data
// chung nên __mockApi có sẵn không biết xử lý) — patch window.fetch để CHỈ các URL /api/hr-profile/*
// được chuyển tiếp sang 1 server Express THẬT (mount đúng routes/employeeProfile.js thật, cùng khuôn
// tests/test-hr-profile.js), còn mọi URL khác vẫn đi qua __mockApi như cũ.
//
// Chạy: node server/tests/demo-hr-profile.js
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = process.env.HRPROFILE_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'hr-profile');

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
  // Xác thực giả — đọc username từ header 'x-demo-user' (KHÔNG dùng biến toàn cục như
  // tests/test-hr-profile.js, vì demo này có thể có nhiều request xen kẽ của các phiên đăng nhập khác
  // nhau trong CÙNG 1 tiến trình Node, không có khái niệm "phiên hiện tại" duy nhất).
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
  await page.setViewportSize({ width: 1400, height: 1000 });

  // Danh sách user seed thật của harness (tests/_seed.js) — dùng THẲNG cho server /api/hr-profile giả
  // lập ở trên (cùng 1 username/dept y hệt DB.users phía trình duyệt).
  const seedUsers = await page.evaluate(() => DB.users.map(u => ({ username: u.username, name: u.name, dept: u.dept, jobTitle: u.jobTitle, email: u.email, phone: u.phone, perms: u.perms, active: true })));

  const epServer = await startEmployeeProfileServer(seedUsers);
  const { employeeProfile } = epServer;

  // Seed 2 hồ sơ: 1 đã liên kết tài khoản 'kd1' (ACTIVE, đủ dữ liệu cho ảnh chụp đẹp), 1 hồ sơ DRAFT
  // chưa liên kết (minh hoạ trạng thái "vừa tạo Onboarding, chưa xong") để màn "Quản Lý Hồ Sơ" có ít
  // nhất 2 dòng khác trạng thái.
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
  const draftProfile = employeeProfile.defaultProfile('NV2002');
  epServer.APP_DATA.employeeProfiles.push(linkedProfile, draftProfile);

  // Patch window.fetch: chỉ chuyển tiếp /api/hr-profile/* sang server Express thật vừa dựng — mọi URL
  // khác giữ nguyên hành vi cũ (đi qua __mockApi, đã được _harness-contract.js gán sẵn).
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

  // ===== Ảnh 1: "Hồ Sơ Của Tôi" (nhân viên kd1, đã liên kết hồ sơ NV2001) =====
  await loginAs('kd1');
  await page.evaluate(() => switchTab('hrProfile'));
  await page.waitForSelector('#hrpfMeContainer:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '1-ho-so-cua-toi.png'), fullPage: true });
  console.log('Đã chụp: 1-ho-so-cua-toi.png');

  // ===== Ảnh 2: "Quản Lý Hồ Sơ" (admin — danh sách 2 hồ sơ) =====
  await loginAs('admin');
  await page.evaluate(() => switchTab('hrProfile'));
  await page.evaluate(() => setHrProfileView('MANAGE'));
  await page.waitForSelector('#hrpfManageTableBody tr', { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '2-quan-ly-ho-so-danh-sach.png'), fullPage: true });
  console.log('Đã chụp: 2-quan-ly-ho-so-danh-sach.png');

  // ===== Ảnh 3: Modal "Chi Tiết" hồ sơ đã liên kết (đủ field kể cả HR-only) =====
  await page.click('button[data-op="openHrpfDetailModal"][data-arg0="NV2001"]');
  await page.waitForSelector('#hrpfDetailModal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '3-chi-tiet-ho-so-quan-ly.png'), fullPage: true });
  console.log('Đã chụp: 3-chi-tiet-ho-so-quan-ly.png');

  console.log('jsExceptions:', h.jsExceptions);
  await stop();
  epServer.server.close();
  console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
