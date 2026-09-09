// server/tests/demo-labor-contract.js
//
// DEMO thật (chụp ảnh, không phải bộ hồi quy — tests/test-labor-contract.js đã phủ luật nghiệp vụ) cho
// module "Hợp Đồng Lao Động" (Đợt 2/4 module Nhân Sự). Dùng ĐÚNG hạ tầng Playwright thật của
// tests/_harness-contract.js (Chromium thật mở public/index.html thật + toàn bộ public/js/*.js thật)
// CỘNG THÊM 1 lớp riêng patch window.fetch để chuyển tiếp CHỈ 2 tiền tố URL
// (/api/create/laborContracts, /api/records/laborContracts/*) sang 1 server Express THẬT (mount đúng
// routes/create.js + routes/records.js thật — module này đi qua engine CHUNG chứ không phải router
// riêng như hr-profile), còn mọi URL khác vẫn đi qua __mockApi như cũ (khớp khuôn demo-hr-profile.js).
//
// Chạy: node server/tests/demo-labor-contract.js
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { startHarness } = require('./_harness-contract');

const OUT_DIR = process.env.LABORCONTRACT_DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'labor-contract');

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

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const h = await startHarness();
  const { page, loginAs, stop } = h;
  await page.setViewportSize({ width: 1400, height: 1000 });
  // activateHrContract()/closeHrContractManual() dùng confirm()/prompt() thật — Playwright mặc định TỰ
  // HUỶ dialog (confirm() trả về false, prompt() trả về null) nếu không đăng ký handler, sẽ khiến các
  // hàm này return sớm không gọi API. Đăng ký accept() cho MỌI dialog trong suốt demo.
  page.on('dialog', (dialog) => dialog.accept(dialog.type() === 'prompt' ? 'Demo' : undefined));

  const seedUsers = await page.evaluate(() => DB.users.map(u => ({ username: u.username, name: u.name, dept: u.dept, jobTitle: u.jobTitle, email: u.email, perms: u.perms, active: true })));
  // Bảo đảm tài khoản demo có hrContractManage — đợt này chưa xây tầng tự xem của nhân viên (HR-only).
  const hrUser = seedUsers.find(u => u.username === 'kd1') || seedUsers[0];
  hrUser.perms = Object.assign({}, hrUser.perms, { hrContractManage: true });

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
  await page.evaluate(() => {
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
      return originalFetch(url, opts);
    };
  });

  await loginAs(hrUser.username);
  await page.evaluate(() => switchTab('hrContract'));
  await page.waitForSelector('#hrContractSection:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(200);

  // ===== Ảnh 1: Danh sách (rỗng) + form Tạo Hợp Đồng Mới =====
  await page.evaluate(() => openHrContractCreateModal());
  await page.waitForSelector('#hrContractCreateModal:not(.hidden)', { timeout: 5000 });
  await page.fill('#hrcNewEmployeeCode', 'NV5001');
  await page.selectOption('#hrcNewContractType', 'FIXED_TERM');
  await page.fill('#hrcNewStartDate', '2026-01-01');
  await page.fill('#hrcNewEndDate', '2026-12-31');
  await page.fill('#hrcNewBaseSalary', '12000000');
  await page.screenshot({ path: path.join(OUT_DIR, '1-tao-hop-dong-moi.png'), fullPage: true });
  console.log('Đã chụp: 1-tao-hop-dong-moi.png');

  await page.click('#hrContractCreateForm button[type="submit"]');
  await page.waitForTimeout(300);
  await page.waitForSelector('#hrContractCreateModal.hidden', { timeout: 5000 });

  // ===== Ảnh 2: Danh sách hợp đồng (sau khi tạo) =====
  await page.waitForSelector('#hrcTableBody tr', { timeout: 5000 });
  await page.screenshot({ path: path.join(OUT_DIR, '2-danh-sach-hop-dong.png'), fullPage: true });
  console.log('Đã chụp: 2-danh-sach-hop-dong.png');

  // ===== Ảnh 3: Chi tiết hợp đồng (còn DRAFT) — form hoàn thiện trước khi kích hoạt =====
  const contractId = lcServer.STORE.laborContracts[0].id;
  await page.evaluate((id) => openHrContractDetailModal(id), contractId);
  await page.waitForSelector('#hrContractDetailModal:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT_DIR, '3-chi-tiet-hop-dong-nhap.png'), fullPage: true });
  console.log('Đã chụp: 3-chi-tiet-hop-dong-nhap.png');

  // ===== Ảnh 4: Sau khi kích hoạt — hiện nút Đóng Hợp Đồng + khối Lịch Sử Thay Đổi =====
  await page.evaluate((id) => activateHrContract(id), contractId);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, '4-chi-tiet-hop-dong-da-kich-hoat.png'), fullPage: true });
  console.log('Đã chụp: 4-chi-tiet-hop-dong-da-kich-hoat.png');

  console.log('jsExceptions:', h.jsExceptions);
  await stop();
  lcServer.server.close();
  console.log('DONE. Ảnh đã lưu tại', OUT_DIR);
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
