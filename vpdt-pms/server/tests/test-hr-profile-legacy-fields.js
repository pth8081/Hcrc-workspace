// server/tests/test-hr-profile-legacy-fields.js
//
// Regression test cho lỗi người dùng báo: admin vào "Nhân Sự > Hồ Sơ Nhân Sự > Chi tiết" một hồ sơ CŨ
// (tạo từ trước khi tính năng Người phụ thuộc/Học vấn ra đời, hoặc nhập Excel hàng loạt trước đó — xem
// chú thích đầu lib/employeeProfileImport.js) thì KHÔNG thêm được Người phụ thuộc/Học vấn — nút "+ Thêm
// dòng" biến mất hẳn.
//
// Nguyên nhân: renderHrpfProfileForm() (public/js/module-hrprofile.js) dùng ĐÚNG `!('dependents' in
// profile)`/`!('education' in profile)` làm điều kiện ẩn/hiện 2 khối này — vốn dùng để giấu 2 field khỏi
// "quản lý trực tiếp" xem hồ sơ giới hạn (getProfileForViewer()/SENSITIVE_FIELDS xoá field ở
// lib/employeeProfile.js), nhưng hồ sơ ĐẦY ĐỦ quyền (kể cả admin) THIẾU HẲN 2 key này (vì được tạo
// TRƯỚC khi tính năng ra đời) cũng bị coi nhầm là "không có quyền xem" — ẩn luôn cả nút "+ Thêm dòng".
// Đã vá: đổi điều kiện sang dùng `!('nationalId' in profile)` (tín hiệu phân biệt hồ sơ đầy đủ/giới hạn
// ĐÃ dùng sẵn ở hrOnlyBlock/limitedNote cùng file — nationalId LUÔN bị xoá/giữ ĐỒNG THỜI với dependents/
// education ở SENSITIVE_FIELDS nên đáng tin cậy y hệt, không phụ thuộc việc 2 field mới có tồn tại
// trên bản ghi CŨ hay không).
//
// Dùng ĐÚNG hạ tầng Playwright thật của tests/_harness-contract.js + stub route /api/hr-profile thật
// (cùng khuôn tests/demo-hr-profile.js) để xác minh đúng trong TRÌNH DUYỆT THẬT, không chỉ đọc code.
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
  const APP_DATA = { users: seedUsers, employeeProfiles: seedProfiles };

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
  const h = await startHarness();
  const { page, loginAs, stop } = h;
  let epServer;
  let failures = 0;
  const check = (label, cond) => {
    if (cond) { console.log(`PASS: ${label}`); } else { console.log(`FAIL: ${label}`); failures++; }
  };

  try {
    const seedUsers = await page.evaluate(() => DB.users.map(u => ({
      username: u.username, name: u.name, dept: u.dept, jobTitle: u.jobTitle, email: u.email, phone: u.phone, perms: u.perms, active: true
    })));

    const employeeProfileLib = require('../lib/employeeProfile');
    // Hồ sơ "CŨ" mô phỏng đúng bug: tạo qua defaultProfile() (có nationalId=null NHƯNG KEY VẪN TỒN TẠI,
    // đúng tín hiệu "hồ sơ đầy đủ") rồi XOÁ HẲN 2 key dependents/education — y hệt hồ sơ tạo trước khi
    // 2 field này ra đời trong lib/employeeProfile.js.
    const legacyProfile = employeeProfileLib.defaultProfile('NV-LEGACY-01');
    legacyProfile.status = 'ACTIVE';
    delete legacyProfile.dependents;
    delete legacyProfile.education;
    assert.ok(!('dependents' in legacyProfile) && !('education' in legacyProfile), 'setup: fixture phải THIẾU HẲN 2 key này');
    assert.ok('nationalId' in legacyProfile, 'setup: fixture vẫn phải giữ nationalId (đúng hồ sơ đầy đủ)');

    epServer = await startEmployeeProfileServer(seedUsers, [legacyProfile]);

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
    await page.waitForSelector('#hrpfManageTableBody', { timeout: 5000 });

    // Mở Chi tiết (chế độ Sửa, readOnly=false) hồ sơ "cũ" — đúng luồng admin đang gặp lỗi.
    await page.evaluate(() => openHrpfDetailModal('NV-LEGACY-01', false));
    await page.waitForSelector('#hrpfDetailModal:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(150);

    const hasAddDependentBtn = await page.evaluate(() => !!document.querySelector('#hrpfDetailBody [data-op="addHrpfDependentRow"]'));
    const hasAddEducationBtn = await page.evaluate(() => !!document.querySelector('#hrpfDetailBody [data-op="addHrpfEducationRow"]'));
    const hasDependentsRowsDiv = await page.evaluate(() => !!document.getElementById('hrpfDependentsRows'));
    const hasEducationRowsDiv = await page.evaluate(() => !!document.getElementById('hrpfEducationRows'));

    check('Hồ sơ CŨ (thiếu key dependents/education) vẫn hiện nút "+ Thêm dòng" Người phụ thuộc cho admin', hasAddDependentBtn);
    check('Hồ sơ CŨ (thiếu key dependents/education) vẫn hiện nút "+ Thêm dòng" Học vấn cho admin', hasAddEducationBtn);
    check('Khối #hrpfDependentsRows tồn tại trong DOM (trước đây bị ẩn hoàn toàn -> null)', hasDependentsRowsDiv);
    check('Khối #hrpfEducationRows tồn tại trong DOM (trước đây bị ẩn hoàn toàn -> null)', hasEducationRowsDiv);

    // Bấm "+ Thêm dòng" thật, điền dữ liệu, Lưu — xác minh round-trip THẬT qua server (không chỉ render).
    await page.click('#hrpfDetailBody [data-op="addHrpfDependentRow"]');
    await page.fill('.hrpf-dependent-row .hrpf-dep-name', 'Nguyễn Văn Con');
    await page.fill('.hrpf-dependent-row .hrpf-dep-rel', 'Con');
    await page.click('#hrpfDetailBody [data-op="addHrpfEducationRow"]');
    await page.fill('.hrpf-education-row .hrpf-edu-degree', 'Cử nhân');
    await page.fill('.hrpf-education-row .hrpf-edu-school', 'Đại Học Kinh Tế TP.HCM');
    await page.click('[data-op="saveHrpfManageProfile"]');
    await page.waitForTimeout(300);

    const savedProfile = epServer.APP_DATA.employeeProfiles.find(p => p.employeeCode === 'NV-LEGACY-01');
    check('Sau khi Lưu: server đã ghi đúng 1 Người phụ thuộc mới', savedProfile && Array.isArray(savedProfile.dependents) && savedProfile.dependents.length === 1 && savedProfile.dependents[0].fullName === 'Nguyễn Văn Con');
    check('Sau khi Lưu: server đã ghi đúng 1 dòng Học vấn mới', savedProfile && Array.isArray(savedProfile.education) && savedProfile.education.length === 1 && savedProfile.education[0].school === 'Đại Học Kinh Tế TP.HCM');

    // Đối chứng: hồ sơ có ĐỦ 2 field (bình thường, không phải hồ sơ "cũ") vẫn hiện 2 khối như trước nay
    // — không phá hành vi bình thường khi vá lại điều kiện.
    const normalProfile = Object.assign(employeeProfileLib.defaultProfile('NV-NORMAL-01'), { status: 'ACTIVE' });
    epServer.APP_DATA.employeeProfiles.push(normalProfile);
    await page.evaluate(() => openHrpfDetailModal('NV-NORMAL-01', false));
    await page.waitForSelector('#hrpfDetailModal:not(.hidden)', { timeout: 5000 });
    await page.waitForTimeout(150);
    const normalHasAddBtn = await page.evaluate(() => !!document.querySelector('#hrpfDetailBody [data-op="addHrpfDependentRow"]'));
    check('Hồ sơ BÌNH THƯỜNG (đủ field từ defaultProfile()) vẫn hiện nút "+ Thêm dòng" như trước (không phá hành vi cũ)', normalHasAddBtn);

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
