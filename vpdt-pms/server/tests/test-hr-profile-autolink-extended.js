// server/tests/test-hr-profile-autolink-extended.js
//
// Regression test cho MỞ RỘNG tự động liên kết tài khoản VPDT (11/2026, theo yêu cầu người dùng: "mở
// rộng cho cả 2 trường hợp" — trước đây tự động liên kết CHỈ áp dụng lúc Nhập Excel Hồ Sơ Nhân Sự, nay
// thêm: (1) tạo hồ sơ tay "➕ Tạo Hồ Sơ Mới" — lib/employeeProfile.js::createManualProfile(), (2) gợi ý
// ngay trên Chi Tiết hồ sơ ĐÃ CÓ sẵn chưa liên kết — module-hrprofile.js::hrpfFindAutoLinkableAccount()).
// Cả 2 dùng CHUNG đúng 1 hàm khớp lib/employeeProfile.js::findAutoLinkableAccount() (phía client mirror
// lại, không gọi API riêng) — không viết lại business rule nào khác lần nữa.
//
//   PHẦN A (HTTP thật — routes/employeeProfile.js POST / "Tạo Hồ Sơ Mới"):
//     1. Không gửi username + có tài khoản ĐANG HOẠT ĐỘNG trùng ĐÚNG Mã Nhân Viên -> tự liên kết.
//     2. Không gửi username + KHÔNG có tài khoản nào trùng -> giữ nguyên trống, không lỗi.
//     3. Tài khoản trùng Mã NV nhưng ĐÃ KHOÁ (active=false) -> KHÔNG tự liên kết.
//     4. Tài khoản trùng Mã NV nhưng ĐÃ liên kết hồ sơ KHÁC -> KHÔNG tự liên kết (tránh chiếm tài khoản).
//     5. Payload TỰ gửi 1 username khác -> KHÔNG bị ghi đè bởi tự động liên kết.
//
//   PHẦN B (Playwright thật, _harness-contract.js — gợi ý trên Chi Tiết hồ sơ đã có):
//     6. Hồ sơ CHƯA liên kết + có tài khoản khớp Mã NV -> ô "Liên Kết Tài Khoản VPDT" tự pre-fill sẵn +
//        hiện dòng gợi ý, CHƯA lưu gì (server chưa nhận request nào) cho tới khi bấm nút xác nhận.
//     7. Hồ sơ CHƯA liên kết + KHÔNG có tài khoản nào khớp -> không pre-fill gì, không hiện gợi ý.
//     8. Bấm nút "🔗 Liên Kết Tài Khoản VPDT" sau khi tự pre-fill -> gọi đúng POST .../link-account với
//        đúng username đã gợi ý.
//
// Chạy: node server/tests/test-hr-profile-autolink-extended.js
'use strict';
const http = require('http');
const path = require('path');
const assert = require('assert');
const express = require('express');
const { startHarness } = require('./_harness-contract');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
}

// ===================== Phần A: HTTP thật — POST /api/hr-profile (tạo tay) =====================
async function partA() {
  console.log('\n== Phần A: HTTP thật — POST /api/hr-profile (tự động liên kết lúc tạo tay) ==');

  const HR_MGR = { username: 'hr1', name: 'Nhân Sự Trưởng', perms: { hrProfileManage: true }, active: true };
  const ACC_MATCH = { username: 'NV500', name: 'Nguyễn Văn Khớp', dept: 'Phòng Kinh Doanh', active: true };
  const ACC_LOCKED = { username: 'NV501', name: 'Tài Khoản Đã Khoá', dept: 'Phòng Kinh Doanh', active: false };
  const ACC_TAKEN = { username: 'NV502', name: 'Tài Khoản Đã Có Chủ', dept: 'Phòng Kinh Doanh', active: true };
  const ACC_OTHER = { username: 'khac1', name: 'Tài Khoản Khác', dept: 'Phòng Kế Toán', active: true };
  const USERS = [HR_MGR, ACC_MATCH, ACC_LOCKED, ACC_TAKEN, ACC_OTHER];

  let APP_DATA;
  function resetAppData() {
    APP_DATA = {
      users: USERS.map(u => ({ ...u })),
      employeeProfiles: [Object.assign(require('../lib/employeeProfile').defaultProfile('NV502-DAHOSO'), { username: 'NV502', status: 'ACTIVE' })],
      hrProcesses: [], orgChartVersions: []
    };
  }
  resetAppData();

  let CURRENT_USERNAME = 'hr1';
  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
    getAllAppData: async () => APP_DATA,
    withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
  });
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const fresh = APP_DATA.users.find(u => u.username === CURRENT_USERNAME);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name }; req.freshUser = fresh; next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  stubModule('lib/recordStore', { getAllForCollection: async () => [] });

  const employeeProfileRoutes = require('../routes/employeeProfile');
  const app = express();
  app.use(express.json());
  app.use('/api/hr-profile', employeeProfileRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function call(method, urlPath, body) {
    const res = await fetch(`${base}${urlPath}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  try {
    await test('Không gửi username + tài khoản đang hoạt động trùng đúng Mã NV -> tự liên kết', async () => {
      resetAppData();
      const r = await call('POST', '/api/hr-profile', { employeeCode: 'NV500' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.profile.username, 'NV500');
    });

    await test('Không gửi username + KHÔNG có tài khoản nào trùng -> giữ nguyên trống, không lỗi', async () => {
      resetAppData();
      const r = await call('POST', '/api/hr-profile', { employeeCode: 'NV999' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.profile.username, null);
    });

    await test('Tài khoản trùng Mã NV nhưng ĐÃ KHOÁ (active=false) -> KHÔNG tự liên kết', async () => {
      resetAppData();
      const r = await call('POST', '/api/hr-profile', { employeeCode: 'NV501' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.profile.username, null);
    });

    await test('Tài khoản trùng Mã NV nhưng ĐÃ liên kết hồ sơ KHÁC -> KHÔNG tự liên kết (tránh chiếm tài khoản)', async () => {
      resetAppData();
      const r = await call('POST', '/api/hr-profile', { employeeCode: 'NV502' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.profile.username, null);
    });

    await test('Payload TỰ gửi 1 username khác -> KHÔNG bị ghi đè bởi tự động liên kết', async () => {
      resetAppData();
      const r = await call('POST', '/api/hr-profile', { employeeCode: 'NV500', username: 'khac1' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.profile.username, 'khac1', 'phải giữ đúng username người dùng tự chọn, không bị ghi đè thành NV500');
    });
  } finally {
    server.close();
  }
}

// ===================== Phần B: Playwright thật — gợi ý trên Chi Tiết hồ sơ đã có =====================
async function partB() {
  console.log('\n== Phần B: Playwright thật — gợi ý tự động liên kết trên Chi Tiết hồ sơ đã có ==');

  const h = await startHarness();
  const { page, state, loginAs, stop } = h;
  const check = (label, cond) => { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.log(`  ❌ ${label}`); failed++; } };
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  const HR_MANAGER = { username: 'hrfv2', name: 'Quản Lý Hồ Sơ Hai', dept: 'Phòng Nhân Sự', perms: { hrProfileManage: true }, active: true };
  const ACC_MATCH = { username: 'NV600', name: 'Lê Thị Khớp', dept: 'Phòng Kế Toán', active: true };
  const ACC_NOMATCH_CODE = 'NV601'; // không có tài khoản nào username = NV601

  let epServer;
  try {
    const employeeProfileLib = require('../lib/employeeProfile');
    const profileMatch = Object.assign(employeeProfileLib.defaultProfile('NV600'), { status: 'ACTIVE', updatedAt: '2026-11-01T08:00:00.000Z' });
    const profileNoMatch = Object.assign(employeeProfileLib.defaultProfile(ACC_NOMATCH_CODE), { status: 'ACTIVE', updatedAt: '2026-11-01T08:00:00.000Z' });

    const APP_DATA = { users: [HR_MANAGER, ACC_MATCH], employeeProfiles: [profileMatch, profileNoMatch], hrProcesses: [] };
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
        req.user = { username: fresh.username, name: fresh.name }; req.freshUser = fresh; req.allUsers = APP_DATA.users; next();
      },
      blockIfMustChangePassword: (req, res, next) => next()
    });
    // QUAN TRỌNG: routes/employeeProfile.js là module THẬT (không stub) — Phần A ở TRÊN đã require() nó
    // 1 lần (đóng gói sẵn tham chiếu tới lib/appData/lib/auth của Phần A ngay lúc đó qua require() bình
    // thường trong closure). require() lần 2 ở Phần B sẽ trả về ĐÚNG module đã cache đó (vẫn cầm theo
    // APP_DATA/stub CŨ của Phần A) nếu không xoá cache trước — gây lỗi khó hiểu (route chạy nhưng dùng
    // sai APP_DATA, VD GET /by-code/NV600 404 vì Phần A không có hồ sơ NV600). Xoá cache đúng module này
    // để bắt buộc require() lại, nạp đúng 2 stub MỚI của Phần B vừa gán ở trên.
    delete require.cache[require.resolve('../routes/employeeProfile')];
    const employeeProfileRoutes = require('../routes/employeeProfile');
    const app = express();
    app.use(express.json());
    app.use('/api/hr-profile', employeeProfileRoutes);
    const epHttpServer = http.createServer(app);
    const epPort = await new Promise((resolve, reject) => { epHttpServer.once('error', reject); epHttpServer.listen(0, '127.0.0.1', () => resolve(epHttpServer.address().port)); });
    epServer = { server: epHttpServer, port: epPort, APP_DATA };

    await page.evaluate((users) => {
      for (const u of users) { const idx = DB.users.findIndex(x => x.username === u.username); if (idx >= 0) DB.users[idx] = u; else DB.users.push(u); }
    }, [HR_MANAGER, ACC_MATCH]);
    for (const u of [HR_MANAGER, ACC_MATCH]) {
      const idx = state.users.findIndex(x => x.username === u.username);
      if (idx >= 0) state.users[idx] = u; else state.users.push(u);
    }

    await page.exposeFunction('__hrProfileFetch', async (method, urlPath, bodyStr, username) => {
      const res = await fetch(`http://127.0.0.1:${epServer.port}${urlPath}`, {
        method, headers: Object.assign({ 'x-demo-user': username || '' }, bodyStr !== null ? { 'Content-Type': 'application/json' } : {}),
        body: bodyStr === null ? undefined : bodyStr
      });
      let body = null; try { body = await res.json(); } catch (e) { body = null; }
      return { status: res.status, body };
    });
    await page.evaluate(() => {
      const originalMockApi = window.__mockApi;
      window.fetch = async (url, opts) => {
        const method = (opts && opts.method) || 'GET';
        const bodyStr = typeof (opts && opts.body) === 'string' ? opts.body : null;
        const username = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.username : null;
        if (typeof url === 'string' && url.indexOf('/api/hr-profile') === 0) {
          const result = await window.__hrProfileFetch(method, url, bodyStr, username);
          return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
        }
        const result = await originalMockApi(method, url, bodyStr, username);
        return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
      };
      // Theo dõi riêng mọi request thật đi tới /api/hr-profile/by-code/.../link-account — xác nhận KHÔNG
      // có request nào tự bắn lúc chỉ MỞ hồ sơ (chỉ lúc bấm nút mới có).
      window.__linkAccountCalls = [];
      const origHrFetch = window.__hrProfileFetch;
    });

    await loginAs('hrfv2');
    await page.evaluate(() => switchTab('hrProfile'));
    await page.evaluate(() => setHrProfileView('MANAGE'));
    await page.waitForSelector('#hrpfManageTableBody tr', { timeout: 5000 });

    // Hồ sơ KHỚP (NV600) — mở Chi Tiết, xác nhận pre-fill đúng + badge gợi ý hiện, CHƯA gọi link-account.
    await page.evaluate(() => openHrpfDetailModal('NV600', false));
    await page.waitForSelector('#hrpfDetailModal:not(.hidden) #hrpfLinkAccountUsername', { timeout: 5000 }).catch(() => {});

    check('Hồ sơ KHỚP: ô hidden hrpfLinkAccountUsername pre-fill đúng username gợi ý (NV600)',
      await page.evaluate(() => document.getElementById('hrpfLinkAccountUsername')?.value === 'NV600'));
    check('Hồ sơ KHỚP: ô hiển thị hrpfLinkAccountInput pre-fill đúng label (tên — phòng ban (username))',
      await page.evaluate(() => (document.getElementById('hrpfLinkAccountInput')?.value || '').includes('Lê Thị Khớp') &&
        (document.getElementById('hrpfLinkAccountInput')?.value || '').includes('(NV600)')));
    check('Hồ sơ KHỚP: hiện dòng gợi ý "🔗 Gợi ý tự động"',
      await page.evaluate(() => /Gợi ý tự động/.test(document.getElementById('hrpfDetailBody')?.textContent || '')));

    await closeHrpfDetailIfOpen(page);

    // Hồ sơ KHÔNG KHỚP (NV601) — không pre-fill gì, không hiện gợi ý.
    await page.evaluate((code) => openHrpfDetailModal(code, false), ACC_NOMATCH_CODE);
    await page.waitForSelector('#hrpfDetailModal:not(.hidden) #hrpfLinkAccountUsername', { timeout: 5000 }).catch(() => {});
    check('Hồ sơ KHÔNG khớp: ô hidden hrpfLinkAccountUsername rỗng (không pre-fill bậy)',
      await page.evaluate(() => (document.getElementById('hrpfLinkAccountUsername')?.value || '') === ''));
    check('Hồ sơ KHÔNG khớp: KHÔNG hiện dòng gợi ý',
      await page.evaluate(() => !/Gợi ý tự động/.test(document.getElementById('hrpfDetailBody')?.textContent || '')));

    await closeHrpfDetailIfOpen(page);

    // Mở lại hồ sơ KHỚP, bấm nút xác nhận -> gọi đúng POST .../link-account với username đã gợi ý.
    await page.evaluate(() => openHrpfDetailModal('NV600', false));
    await page.waitForSelector('#hrpfDetailModal:not(.hidden) #hrpfLinkAccountUsername', { timeout: 5000 }).catch(() => {});
    check('Trước khi bấm nút: hồ sơ NV600 trong APP_DATA vẫn CHƯA liên kết (không tự ý lưu khi chỉ mở xem)',
      epServer.APP_DATA.employeeProfiles.find(p => p.employeeCode === 'NV600').username == null);

    await page.click('#hrpfDetailModal [data-op="confirmHrpfLinkAccount"]');
    await page.waitForTimeout(300);
    check('Sau khi bấm "🔗 Liên Kết Tài Khoản VPDT": hồ sơ NV600 đã liên kết đúng username NV600',
      epServer.APP_DATA.employeeProfiles.find(p => p.employeeCode === 'NV600').username === 'NV600');

    check('Không có ngoại lệ JS chưa bắt (pageerror) nào phát sinh', pageErrors.length === 0);
    if (pageErrors.length) console.error('  pageerror:', pageErrors.join(' | '));
  } finally {
    if (epServer) epServer.server.close();
    await stop();
  }
}

async function closeHrpfDetailIfOpen(page) {
  await page.evaluate(() => { if (typeof closeHrpfDetailModal === 'function') closeHrpfDetailModal(); });
  await page.waitForTimeout(50);
}

async function main() {
  await partA();
  await partB();
  console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
