// server/tests/test-hr-profile-field-visibility.js
//
// Regression test cho yêu cầu người dùng (9/2026): "Trường Xem Của Tôi" (self, mới) + mở rộng "Trường
// Xem Của Quản Lý Trực Tiếp" (đã có) sang ĐỦ 15 field nhạy cảm, theo nguyên tắc OPT-IN — KHÔNG field nào
// hiển thị (kể cả field vốn "luôn thấy" trước đây như ngày sinh/giới tính) cho tới khi HR/admin chủ động
// tick chọn ở màn cấu hình riêng.
//
// Dùng ĐÚNG hạ tầng Playwright thật tests/_harness-contract.js (cùng khuôn test-hr-profile-legacy-fields.js)
// để xác minh trong TRÌNH DUYỆT THẬT: click nút thật (kể cả bindCspDelegation('hrpfSelfFieldConfigModal')
// mới thêm — nếu quên đăng ký, nút Lưu trong modal sẽ KHÔNG phản hồi gì, bài test này sẽ tự đỏ), cấu hình
// từ màn admin có tác động THẬT xuống cả "Hồ Sơ Của Tôi" (chính chủ) lẫn "Xem Hồ Sơ Nhân Viên (Quản Lý
// Trực Tiếp)" (renderHrpfProfileReadOnly() — trước đây NGÓ LƠ hoàn toàn cấu hình này, xem chú thích tại đó).
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
  const APP_DATA = { users: seedUsers, employeeProfiles: seedProfiles, hrProfileManagerVisibleFields: [], hrProfileSelfVisibleFields: [] };

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

  // PHÁT HIỆN theo yêu cầu người dùng (10/2026): admin KHÔNG còn tự động bypass hrProfileManage — bài
  // test này xác minh tính năng cấu hình trường xem (không phải test bypass), nên tài khoản dùng để mở
  // màn cấu hình cần được cấp cụ thể hrProfileManage.
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true, hrProfileManage: true }, active: true };
  const MGR1 = { username: 'qltt01', name: 'Trưởng Phòng Kinh Doanh', dept: 'Phòng Kinh Doanh', perms: { hrProfileView: true }, active: true };
  const EMP1 = { username: 'nv001emp', name: 'Nhân Viên Một', dept: 'Phòng Kinh Doanh', managerUsername: 'qltt01', perms: {}, active: true };

  try {
    const employeeProfileLib = require('../lib/employeeProfile');
    const profile = Object.assign(employeeProfileLib.defaultProfile('NVFV01'), {
      username: 'nv001emp', status: 'ACTIVE',
      dateOfBirth: '1995-05-20', gender: 'Nữ', nationalId: '079195123456',
      dependents: [{ id: 'd1', fullName: 'Nguyễn Văn Con', relationship: 'Con' }]
    });

    epServer = await startEmployeeProfileServer([ADMIN, MGR1, EMP1], [profile]);

    // Seed 3 user vào DB.users PHÍA CLIENT (finishLogin() đọc từ đây) — song song với APP_DATA.users phía
    // server giả (route auth đọc từ đó) — 2 mảng độc lập, cùng khuôn test-hr-profile-legacy-fields.js.
    // Upsert (không push trùng) — hạ tầng harness (tests/_seed.js) đã có sẵn 1 bản ghi username "admin"
    // (perms: {admin:true} thôi) trước khi bài test này chạy; push thêm 1 bản "admin" khác sẽ để lại 2
    // phần tử trùng username, và DB.users.find() (xem loginAs() ở _harness-contract.js) luôn khớp bản
    // ĐẦU TIÊN (bản seed mặc định, KHÔNG có hrProfileManage) — ghi đè thay vì push mới sửa đúng bản.
    await page.evaluate((users) => {
      users.forEach((u) => {
        const idx = DB.users.findIndex((x) => x.username === u.username);
        if (idx >= 0) DB.users[idx] = u; else DB.users.push(u);
      });
    }, [ADMIN, MGR1, EMP1]);

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

    // ===== 1) Admin mở "⚙️ Trường Xem Của Tôi" — tick "dateOfBirth", Lưu (click THẬT, xác minh
    //    bindCspDelegation('hrpfSelfFieldConfigModal') mới thêm ở core.js thật sự hoạt động). =====
    await loginAs('admin');
    await page.evaluate(() => { switchTab('hrProfile'); setHrProfileView('MANAGE'); });
    await page.waitForSelector('#hrpfSelfFieldConfigBtn:not(.hidden)', { timeout: 5000 });
    await page.click('[data-op="openHrpfSelfFieldConfigModal"]');
    await page.waitForSelector('#hrpfSelfFieldConfigModal:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(150);
    const selfCbCount = await page.evaluate(() => document.querySelectorAll('.hrpf-self-field-config-cb').length);
    check('Modal "Trường Xem Của Tôi" liệt kê đủ 15 field nhạy cảm', selfCbCount === 15);
    await page.check('.hrpf-self-field-config-cb[value="dateOfBirth"]');
    await page.click('#hrpfSelfFieldConfigModal [data-op="saveHrpfSelfFieldConfig"]');
    await page.waitForTimeout(200);
    check('PUT /self-field-config (click THẬT nút Lưu trong modal) đã lưu đúng xuống server', JSON.stringify(epServer.APP_DATA.hrProfileSelfVisibleFields) === JSON.stringify(['dateOfBirth']));
    check('Modal tự đóng lại sau khi Lưu', await page.evaluate(() => document.getElementById('hrpfSelfFieldConfigModal').classList.contains('hidden')));

    // ===== 2) Admin mở "⚙️ Trường Xem Của Quản Lý Trực Tiếp" — tick "dependents", Lưu. =====
    await page.click('[data-op="openHrpfManagerFieldConfigModal"]');
    await page.waitForSelector('#hrpfFieldConfigModal:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(150);
    const mgrCbCount = await page.evaluate(() => document.querySelectorAll('.hrpf-field-config-cb').length);
    check('Modal "Trường Xem Của Quản Lý Trực Tiếp" liệt kê đủ 15 field (đã mở rộng 9/2026)', mgrCbCount === 15);
    await page.check('.hrpf-field-config-cb[value="dependents"]');
    await page.click('#hrpfFieldConfigModal [data-op="saveHrpfFieldConfig"]');
    await page.waitForTimeout(200);
    check('PUT /manager-field-config đã lưu đúng xuống server', JSON.stringify(epServer.APP_DATA.hrProfileManagerVisibleFields) === JSON.stringify(['dependents']));

    // ===== 3) Chính chủ (EMP1) xem "Hồ Sơ Của Tôi" — CHỈ thấy dateOfBirth (đã mở), KHÔNG thấy
    //    gender/nationalId/dependents (chưa mở, dù dependents ĐÃ mở cho quản lý trực tiếp — 2 cấu hình
    //    tách biệt, không lẫn sang nhau). =====
    await loginAs('nv001emp');
    await page.evaluate(() => { switchTab('hrProfile'); setHrProfileView('ME'); });
    await page.waitForSelector('#hrpfMeContainer:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(150);
    const dobVal = await page.evaluate(() => document.getElementById('hrpfF_dateOfBirth')?.value);
    check('Chính chủ THẤY dateOfBirth (đã được admin mở), đúng giá trị đã lưu', dobVal === '1995-05-20');
    check('Chính chủ KHÔNG thấy gender (chưa mở)', await page.evaluate(() => !document.getElementById('hrpfF_gender')));
    check('Chính chủ KHÔNG thấy nationalId (chưa mở)', await page.evaluate(() => !document.getElementById('hrpfF_nationalId')));
    check('Chính chủ KHÔNG thấy dependents dù ĐÃ mở cho quản lý trực tiếp (2 cấu hình độc lập)', await page.evaluate(() => !document.getElementById('hrpfDependentsRows')));
    check('Ghi chú "chỉ hiển thị khi HR/Admin đã cấu hình mở" hiện đúng ở scope ME', await page.evaluate(() => document.getElementById('hrpfMeContainer').innerHTML.includes('Trường Xem Của Tôi')));

    // ===== 4) Quản lý trực tiếp (MGR1) tra "Xem Hồ Sơ Nhân Viên" — THẤY dependents (đã mở, LỖI CŨ đã vá:
    //    trước đây renderHrpfProfileReadOnly() hardcode chỉ 3 field, NGÓ LƠ mọi cấu hình admin đã chọn),
    //    KHÔNG thấy nationalId (chưa mở). =====
    await loginAs('qltt01');
    await page.evaluate(() => switchTab('hrProfile'));
    await page.waitForSelector('#hrpfSubordinateSearchWrap:not(.hidden)', { timeout: 5000 });
    await page.evaluate(() => { document.getElementById('hrpfSubordinateUsername').value = 'nv001emp'; });
    await page.click('[data-op="viewHrpfSubordinateProfile"]');
    await page.waitForSelector('#hrpfSubordinateResult:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(150);
    const resultHtml = await page.evaluate(() => document.getElementById('hrpfSubordinateResult').innerHTML);
    check('Quản lý trực tiếp THẤY tên người phụ thuộc "Nguyễn Văn Con" (dependents đã mở — LỖI CŨ đã vá)', resultHtml.includes('Nguyễn Văn Con'));
    check('Quản lý trực tiếp KHÔNG thấy nationalId (chưa mở, không lộ CCCD)', !resultHtml.includes('079195123456'));

    check('Không có ngoại lệ JS chưa bắt (pageerror) nào phát sinh', h.jsExceptions.length === 0);
    if (h.jsExceptions.length) console.log('jsExceptions:', h.jsExceptions);
  } finally {
    await stop();
    if (epServer) epServer.server.close();
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
