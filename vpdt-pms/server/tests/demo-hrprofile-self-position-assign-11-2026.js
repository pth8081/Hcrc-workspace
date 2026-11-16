// server/tests/demo-hrprofile-self-position-assign-11-2026.js
//
// DEMO thật (chụp ảnh) cho fix MỚI (11/2026, theo yêu cầu người dùng): trước đây người xử lý hồ sơ Nhân
// Sự (hrProfileManage/hrProfileEdit) KHÔNG tự gán được Chức Vụ cho CHÍNH hồ sơ của mình (chặn CỨNG
// assertNotSelfAssigningPosition(), 403) — người dùng xác nhận đây là bug, muốn bỏ hẳn chặn này (chỉ cần
// đúng quyền xử lý hồ sơ là đủ, không cần quyền nào thêm). Xem lib/employeeProfile.js::applyPositionAssignment()
// + tests/test-hrprofile-self-position-assign.js (đã cập nhật 10/10 scenario cho hành vi MỚI).
//
// Dùng lại ĐÚNG hạ tầng demo-hr-profile.js (Playwright thật + server Express thật mount routes/
// employeeProfile.js), seed THÊM 1 bản Cơ Cấu Tổ Chức ĐANG ÁP DỤNG để có vị trí thật cho ô "Gán/Đổi Chức
// Vụ", và seed tài khoản demo CHỈ CÓ hrProfileEdit (KHÔNG có hrProfileManage/admin) — đúng tình huống
// người dùng báo cáo.
//
// Chạy: node server/tests/demo-hrprofile-self-position-assign-11-2026.js
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = process.env.HRPROFILE_SELFASSIGN_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'hr-profile-self-position-assign');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const ORG_CHART_VERSION = {
  id: 'v1', status: 'APPLIED',
  nodes: [
    { nodeId: 1, nodeType: 'COMPANY', nodeName: 'HCRC', parentNodeId: null },
    { nodeId: 2, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', parentNodeId: 1, departmentRef: null },
    { nodeId: 3, nodeType: 'POSITION', nodeName: 'Trưởng Phòng Kinh Doanh', parentNodeId: 2, positionKey: 'POS_TPKD', jobTitle: 'Trưởng Phòng', requiresDept: true }
  ]
};

async function startEmployeeProfileServer(seedUsers) {
  const APP_DATA = { users: seedUsers, employeeProfiles: [], orgChartVersions: [ORG_CHART_VERSION] };

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
  await page.setViewportSize({ width: 1400, height: 1000 });
  page.on('dialog', (dialog) => dialog.accept());

  const seedUsers = await page.evaluate(() => DB.users.map(u => ({ username: u.username, name: u.name, dept: u.dept, jobTitle: u.jobTitle, email: u.email, phone: u.phone, perms: u.perms, active: true })));
  // Tài khoản demo 'kd1' — CHỈ cấp hrProfileEdit (KHÔNG hrProfileManage, KHÔNG admin), đúng tình huống
  // người dùng báo cáo: "chỉ cần quyền xử lý hồ sơ là đủ, không cần quyền nào thêm".
  const hrUser = seedUsers.find(u => u.username === 'kd1') || seedUsers[0];
  hrUser.perms = Object.assign({}, hrUser.perms, { hrProfileManage: false, hrProfileEdit: true, admin: false });
  await page.evaluate((username) => {
    const u = DB.users.find(x => x.username === username);
    if (u) u.perms = Object.assign({}, u.perms, { hrProfileManage: false, hrProfileEdit: true, admin: false });
  }, hrUser.username);

  const epServer = await startEmployeeProfileServer(seedUsers);
  const { employeeProfile } = epServer;

  // Hồ sơ Nhân Sự liên kết CHÍNH tài khoản hrUser — người xử lý hồ sơ đang tự xem/sửa hồ sơ của MÌNH.
  const selfProfile = Object.assign(employeeProfile.defaultProfile('NV9001'), {
    username: hrUser.username, status: 'ACTIVE'
  });
  epServer.APP_DATA.employeeProfiles.push(selfProfile);

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

  await loginAs(hrUser.username);
  await page.evaluate(() => switchTab('hrProfile'));
  await page.evaluate(() => setHrProfileView('MANAGE'));
  await page.waitForSelector('#hrpfManageTableBody tr', { timeout: 5000 });

  // ===== Ảnh 1: mở hồ sơ CHÍNH MÌNH (NV9001, liên kết username hrUser) ở chế độ Sửa — Chức Vụ "(chưa gán)" =====
  await page.evaluate(() => openHrpfDetailModal('NV9001', false));
  await page.waitForSelector('#hrpfDetailModal:not(.hidden)', { timeout: 5000 });
  await page.waitForSelector('#hrpfAssignPositionInput', { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '1-truoc-khi-gan-chua-gan.png'), fullPage: true });
  console.log('Đã chụp: 1-truoc-khi-gan-chua-gan.png');

  // ===== Gán Chức Vụ cho CHÍNH MÌNH ("Trưởng Phòng Phòng Kinh Doanh") — trước đây bị chặn 403 =====
  // populateHrpfPositionDatalist() đã nạp 'hrpfPositionDatalist' lúc setHrProfileView('MANAGE') ở trên
  // (hrpfCanEdit() true) — gõ ĐÚNG label đầy đủ "<jobTitle> <tên phòng ban> (<positionKey>)" như
  // populateHrpfPositionDatalist() dựng, để resolveHrpfAssignPositionInput() trích đúng positionKey.
  await page.fill('#hrpfAssignPositionInput', 'Trưởng Phòng Phòng Kinh Doanh (POS_TPKD)');
  await page.click('button[data-op="confirmHrpfAssignPosition"]');
  await page.waitForFunction(() => document.querySelector('#hrpfDetailBody')?.textContent?.includes('Trưởng Phòng Phòng Kinh Doanh'), { timeout: 5000 });

  // ===== Ảnh 2: SAU khi tự gán — Chức Vụ hiện tại đã đổi, KHÔNG còn bị chặn 403 =====
  await page.screenshot({ path: path.join(OUT_DIR, '2-sau-khi-tu-gan-thanh-cong.png'), fullPage: true });
  console.log('Đã chụp: 2-sau-khi-tu-gan-thanh-cong.png');

  console.log('Hồ sơ sau khi gán (server thật):', JSON.stringify({ positionKey: epServer.APP_DATA.employeeProfiles[0].positionKey, jobTitle: epServer.APP_DATA.employeeProfiles[0].jobTitle, dept: epServer.APP_DATA.employeeProfiles[0].dept }));
  console.log('jsExceptions:', h.jsExceptions);
  await stop();
  epServer.server.close();
  console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
