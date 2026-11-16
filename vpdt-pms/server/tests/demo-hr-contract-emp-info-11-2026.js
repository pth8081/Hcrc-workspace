// server/tests/demo-hr-contract-emp-info-11-2026.js
//
// DEMO thật (chụp ảnh) cho tính năng MỚI (11/2026, theo yêu cầu người dùng): bảng Hợp Đồng Lao Động và
// khung Chi Tiết hợp đồng giờ hiện thêm Họ Và Tên/Chức Danh/Phòng Ban (tra qua GET
// /api/hr-profile/employee-directory — xem hrcEmployeeInfo() ở module-hopdonglaodong.js). Dùng lại ĐÚNG
// hạ tầng demo-labor-contract.js (Playwright thật + server Express thật mount routes/create.js +
// routes/records.js), BỔ SUNG stub riêng cho GET /api/hr-profile/employee-directory (demo gốc không cần
// field này nên chưa stub) để có dữ liệu thật cho 3 cột/dòng mới.
//
// Chạy: node server/tests/demo-hr-contract-emp-info-11-2026.js
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = process.env.LABORCONTRACT_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'labor-contract-emp-info');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

async function startLaborContractServer(seedUsers) {
  const STORE = { laborContracts: [] };
  let nextId = 1;

  stubModule('lib/recordStore', {
    MIGRATED_COLLECTIONS: new Set(['laborContracts']),
    getAllForCollection: async (c) => STORE[c].slice(),
    getAllForCollectionCached: async (c) => STORE[c].slice(),
    getTrashItems: async () => [],
    withAppLock: async (key, fn) => fn(),
    createForCollection: async (c, builderFn) => {
      const draft = await builderFn();
      const item = Object.assign({ id: nextId++ }, draft);
      STORE[c].push(item);
      return item;
    },
    createForCollectionSerialized: async (c, lockKey, builderFn) => {
      const draft = await builderFn();
      const item = Object.assign({ id: nextId++ }, draft);
      STORE[c].push(item);
      return item;
    },
    withLockedRecordForCollection: async (c, id, mutatorFn) => {
      const idx = STORE[c].findIndex(x => x.id === Number(id));
      if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
      const result = await mutatorFn(STORE[c][idx]);
      STORE[c][idx] = result;
      return result;
    },
    deleteRecordForCollection: async (c, id, checkFn) => {
      const idx = STORE[c].findIndex(x => x.id === Number(id));
      if (idx === -1) return;
      if (checkFn) checkFn(STORE[c][idx]);
      STORE[c].splice(idx, 1);
    }
  });
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const username = req.headers['x-demo-user'];
      const fresh = (seedUsers || []).find(u => u.username === username);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      req.allUsers = seedUsers;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key === 'users' ? seedUsers : (key === 'employeeProfiles' ? [] : null)),
    getAllAppData: async () => ({ users: seedUsers, employeeProfiles: [], depts: ['Nhân Sự', 'Kinh Doanh'], stores: [] }),
    withLockedAppDataValue: async (key, fn) => fn(key === 'users' ? seedUsers : [])
  });

  const createRoutes = require('../routes/create');
  const recordRoutes = require('../routes/records');
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  app.use('/api/records', recordRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  return { server, port, STORE };
}

// Danh bạ Hồ Sơ Nhân Sự giả lập (ĐÚNG khuôn GET /api/hr-profile/employee-directory thật trả về sau khi
// thêm dept/jobTitle, xem routes/employeeProfile.js) — chỉ cần đủ để demo 1 nhân viên khớp mã hợp đồng
// sẽ tạo bên dưới (NV5001).
const EMPLOYEE_DIRECTORY = [
  { employeeCode: 'NV5001', fullName: 'Trần Thị Mai', dept: 'Siêu thị Hải Dương', jobTitle: 'Nhân viên bán hàng', username: 'nv5001' },
  { employeeCode: 'NV5002', fullName: 'Nguyễn Văn Hùng', dept: 'Phòng Kế Toán', jobTitle: 'Kế toán viên', username: null }
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const h = await startHarness();
  const { page, loginAs, stop } = h;
  await page.setViewportSize({ width: 1400, height: 1100 });
  page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? 'Demo' : undefined));

  const seedUsers = await page.evaluate(() => DB.users.map(u => ({ username: u.username, name: u.name, dept: u.dept, jobTitle: u.jobTitle, email: u.email, perms: u.perms, active: true })));
  const hrUser = seedUsers.find(u => u.username === 'kd1') || seedUsers[0];
  hrUser.perms = Object.assign({}, hrUser.perms, { hrContractManage: true });
  await page.evaluate((username) => {
    const u = DB.users.find(x => x.username === username);
    if (u) u.perms = Object.assign({}, u.perms, { hrContractManage: true });
  }, hrUser.username);

  const lcServer = await startLaborContractServer(seedUsers);

  await page.exposeFunction('__laborContractFetch', async (method, urlPath, bodyStr, username) => {
    const res = await fetch(`http://127.0.0.1:${lcServer.port}${urlPath}`, {
      method,
      headers: Object.assign({ 'x-demo-user': username || '' }, bodyStr !== null ? { 'Content-Type': 'application/json' } : {}),
      body: bodyStr === null ? undefined : bodyStr
    });
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    return { status: res.status, body };
  });
  await page.evaluate((directory) => {
    const originalFetch = window.fetch;
    window.fetch = async (url, opts) => {
      const isLaborContractUrl = typeof url === 'string' && (url.indexOf('/api/create/laborContracts') === 0 || url.indexOf('/api/records/laborContracts') === 0);
      if (isLaborContractUrl) {
        const method = (opts && opts.method) || 'GET';
        const bodyStr = typeof (opts && opts.body) === 'string' ? opts.body : null;
        const username = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.username : null;
        const result = await window.__laborContractFetch(method, url, bodyStr, username);
        return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
      }
      // Stub GET /api/hr-profile/employee-directory (MỚI cho demo này) — route thật hiện đã trả thêm
      // dept/jobTitle, dùng đúng dữ liệu giả này để hrcEmployeeInfo() có gì đó hiển thị.
      if (typeof url === 'string' && url.indexOf('/api/hr-profile/employee-directory') === 0) {
        return { ok: true, status: 200, json: async () => ({ directory }) };
      }
      return originalFetch(url, opts);
    };
  }, EMPLOYEE_DIRECTORY);

  await loginAs(hrUser.username);
  await page.evaluate(() => switchTab('hrContract'));
  await page.waitForSelector('#hrContractSection:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(200);

  // Tạo 1 hợp đồng cho NV5001 (khớp danh bạ giả lập ở trên) — dùng nhánh nhập tay tự do vì ô tìm-chọn
  // thật cần gọi lại GET /api/hr-profile/employee-directory lúc mở modal (loadHrcEmployeeDirectory()),
  // trong khi demo chỉ cần tạo nhanh 1 bản ghi để xem cột/dòng mới, không cần test lại luồng chọn picker
  // (đã có demo-labor-contract.js lo phần đó).
  await page.evaluate(() => openHrContractCreateModal());
  await page.waitForSelector('#hrContractCreateModal:not(.hidden)', { timeout: 5000 });
  await page.check('#hrcNewUseExternalCode');
  await page.fill('#hrcNewEmployeeCodeManual', 'NV5001');
  await page.selectOption('#hrcNewContractType', 'FIXED_TERM');
  await page.fill('#hrcNewStartDate', '2026-01-01');
  await page.fill('#hrcNewEndDate', '2026-12-31');
  await page.fill('#hrcNewBaseSalary', '12000000');
  await page.click('#hrContractCreateForm button[type="submit"]');
  await page.waitForSelector('#hrContractCreateModal.hidden', { state: 'attached', timeout: 5000 });
  await page.waitForSelector('#hrcTableBody tr', { timeout: 5000 });
  // renderHrContractTable() tự nạp hrcEmployeeDirectoryCache bất đồng bộ rồi tự render lại — chờ đúng ô
  // "Họ Và Tên" xuất hiện (không chỉ chờ có <tr>) để chắc chắn ảnh chụp đã có đủ 3 cột mới.
  await page.waitForFunction(() => document.querySelector('#hrcTableBody')?.textContent?.includes('Trần Thị Mai'), { timeout: 5000 });

  // ===== Ảnh 1: Danh sách Hợp Đồng Lao Động — có thêm cột Họ Và Tên/Chức Danh/Phòng Ban =====
  await page.screenshot({ path: path.join(OUT_DIR, '1-danh-sach-co-ho-ten-chuc-danh-phong-ban.png'), fullPage: true });
  console.log('Đã chụp: 1-danh-sach-co-ho-ten-chuc-danh-phong-ban.png');

  // ===== Ảnh 2: Chi tiết hợp đồng — có thêm dòng Họ Và Tên/Chức Danh/Phòng Ban =====
  const contractId = lcServer.STORE.laborContracts[0].id;
  await page.evaluate((id) => openHrContractDetailModal(id), contractId);
  await page.waitForSelector('#hrContractDetailModal:not(.hidden)', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('#hrcDetailBody')?.textContent?.includes('Trần Thị Mai'), { timeout: 5000 });
  await page.screenshot({ path: path.join(OUT_DIR, '2-chi-tiet-co-ho-ten-chuc-danh-phong-ban.png'), fullPage: true });
  console.log('Đã chụp: 2-chi-tiet-co-ho-ten-chuc-danh-phong-ban.png');

  console.log('jsExceptions:', h.jsExceptions);
  await stop();
  lcServer.server.close();
  console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
