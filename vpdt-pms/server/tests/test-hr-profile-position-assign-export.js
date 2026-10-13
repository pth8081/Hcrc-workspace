// server/tests/test-hr-profile-position-assign-export.js
//
// Regression test TRÌNH DUYỆT THẬT (Playwright, _harness-contract.js — cùng khuôn
// test-hr-onboarding-queue-export.js) cho nút "📊 Xuất Excel Gán Chức Vụ" mới ở tab "📋 Quản Lý Hồ Sơ"
// (module-hrprofile.js, 10/2026 — theo yêu cầu người dùng "làm nút xuất excel cho gán chức vụ luôn đi",
// bổ sung Xuất Excel cho đủ bộ 3 nút Tải Mẫu/Nhập/Xuất như "🏷️ Gán Chức Vụ Hàng Loạt").
//
// Chạy: node server/tests/test-hr-profile-position-assign-export.js
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
  const { page, state, loginAs, stop } = h;
  let epServer;
  let failures = 0;
  const check = (label, cond) => {
    if (cond) { console.log(`PASS: ${label}`); } else { console.log(`FAIL: ${label}`); failures++; }
  };
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  // hrProfileFullView -> hrpfCanFullView() true -> hiện nút Xuất Excel Gán Chức Vụ (và toàn bộ list MANAGE).
  const HR_MANAGER = { username: 'hrfv1', name: 'Quản Lý Hồ Sơ', dept: 'Phòng Nhân Sự', perms: { hrProfileFullView: true }, active: true };
  const MANAGER_ACC = { username: 'tp.ketoan', name: 'Lê Văn Trưởng', dept: 'Phòng Kế Toán', jobTitle: 'Trưởng phòng', active: true };

  try {
    const employeeProfileLib = require('../lib/employeeProfile');
    const assignedProfile = Object.assign(employeeProfileLib.defaultProfile('NVGC01'), {
      status: 'ACTIVE', username: 'nv.ketoan1', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên',
      jobGrade: 'Bậc 3', positionLabel: 'Nhân viên Phòng Kế Toán', updatedAt: '2026-10-05T08:00:00.000Z'
    });
    const unassignedProfile = Object.assign(employeeProfileLib.defaultProfile('NVGC02'), {
      status: 'ACTIVE', dept: '', jobTitle: '', updatedAt: '2026-10-06T08:00:00.000Z'
    });
    const EMP_ACC = { username: 'nv.ketoan1', name: 'Phạm Thị Viên', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên', managerUsername: 'tp.ketoan', active: true };

    epServer = await startEmployeeProfileServer([HR_MANAGER, MANAGER_ACC, EMP_ACC], [assignedProfile, unassignedProfile]);

    await page.evaluate((users) => {
      for (const u of users) {
        const idx = DB.users.findIndex((x) => x.username === u.username);
        if (idx >= 0) DB.users[idx] = u; else DB.users.push(u);
      }
    }, [HR_MANAGER, MANAGER_ACC, EMP_ACC]);
    // PHẢI seed CẢ state.users (tests/_seed.js, dữ liệu RIÊNG của __mockApi/_mockBackend.js) —
    // KHÔNG chỉ DB.users (dữ liệu phía trang) — nếu không getUser() trong _mockBackend.js sẽ not-found
    // -> 401 cho MỌI request kể cả /api/notifications,/api/data/lazy/* (chạy ngầm ngay lúc finishLogin()),
    // kéo theo handleSessionExpired() tự gọi logout() giữa chừng, currentUser bị null bất ngờ.
    for (const u of [HR_MANAGER, MANAGER_ACC, EMP_ACC]) {
      const idx = state.users.findIndex((x) => x.username === u.username);
      if (idx >= 0) state.users[idx] = u; else state.users.push(u);
    }

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
      // QUAN TRỌNG: startHarness() đã gán window.fetch trỏ TOÀN BỘ qua window.__mockApi (tests/_mockBackend.js,
      // phủ /api/notifications, /api/data/lazy/*, /api/auth/logout...) — đè thẳng lên window.fetch rồi forward
      // phần không khớp sang fetch() THẬT của trình duyệt (lỗi đã gặp ở 1 vài test cũ, VD
      // test-hr-onboarding-queue-export.js) sẽ làm MẤT toàn bộ mock đó, gây 401 ở /api/notifications ngay lúc
      // finishLogin() -> handleSessionExpired() tự gọi logout() giữa chừng (currentUser bị null bất ngờ). Forward
      // phần không khớp về ĐÚNG window.__mockApi (đã expose sẵn) thay vì fetch() thật để giữ nguyên toàn bộ mock.
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
    });

    await loginAs('hrfv1');
    // switchTab() là async (tải fragment HTML + render module) — PHẢI await riêng trước khi gọi
    // setHrProfileView(), không gộp chung 1 evaluate() như lỗi đã gặp ở vài test cũ (currentUser đọc
    // được NULL do đua với fragment chưa tải xong) — xem demo-hr-profile.js/test-hr-profile-legacy-fields.js
    // làm mẫu đúng.
    await page.evaluate(() => switchTab('hrProfile'));
    await page.evaluate(() => setHrProfileView('MANAGE'));
    await page.waitForSelector('#hrpfManageTableBody tr', { timeout: 5000 });

    check('Nút "📊 Xuất Excel Gán Chức Vụ" hiện trong tab Quản Lý Hồ Sơ (có quyền hrProfileFullView)',
      await page.evaluate(() => !!document.querySelector('#hrpfViewManage [data-op="exportHrpfPositionAssignExcel"]') &&
        !document.getElementById('hrpfManagePositionAssignExportBtn').classList.contains('hidden')));

    const captured = await page.evaluate(() => {
      const originalFn = window.downloadXlsxFromServer;
      let captured = null;
      window.downloadXlsxFromServer = (fileName, sheetName, columns, rows) => { captured = { fileName, sheetName, columns, rows }; };
      exportHrpfPositionAssignExcel();
      window.downloadXlsxFromServer = originalFn;
      return captured;
    });
    check('exportHrpfPositionAssignExcel(): gọi downloadXlsxFromServer() đúng tên file', captured && captured.fileName === 'Gan_Chuc_Vu.xlsx');
    check('exportHrpfPositionAssignExcel(): có đủ cả 2 dòng (đã gán + chưa gán)', captured && captured.rows.length === 2);

    const assignedRow = captured && captured.rows.find(r => r.employeeCode === 'NVGC01');
    check('Dòng đã gán: đúng Cấp Bậc, Vị Trí, Trạng Thái Gán, Quản Lý Trực Tiếp (tra qua managerUsername)',
      !!assignedRow && assignedRow.jobGrade === 'Bậc 3' && assignedRow.positionLabel === 'Nhân viên Phòng Kế Toán' &&
      assignedRow.assignStatus === 'Đã gán' && assignedRow.managerName === 'Lê Văn Trưởng');

    const unassignedRow = captured && captured.rows.find(r => r.employeeCode === 'NVGC02');
    check('Dòng chưa gán: Trạng Thái Gán = "Chưa gán", Cấp Bậc/Vị Trí rỗng', !!unassignedRow && unassignedRow.assignStatus === 'Chưa gán' &&
      unassignedRow.jobGrade === '' && unassignedRow.positionLabel === '');

    check('exportHrpfPositionAssignExcel(): đủ 9 cột đúng thứ tự (Mã NV...Cập Nhật Lần Cuối)', captured &&
      JSON.stringify(captured.columns.map(c => c.key)) === JSON.stringify(['employeeCode', 'fullName', 'dept', 'jobTitle', 'jobGrade', 'positionLabel', 'managerName', 'assignStatus', 'updatedAt']));

    // Real click nút thật trong DOM (xác nhận bindCspDelegation đã đăng ký đúng, không phải chỉ gọi hàm tay).
    await page.evaluate(() => {
      window.__exportCalled = false;
      window.__origExportFn = exportHrpfPositionAssignExcel;
      exportHrpfPositionAssignExcel = () => { window.__exportCalled = true; };
    });
    await page.click('[data-op="exportHrpfPositionAssignExcel"]');
    await page.waitForTimeout(100);
    check('Real click nút thật -> gọi đúng exportHrpfPositionAssignExcel()', await page.evaluate(() => window.__exportCalled));
    await page.evaluate(() => { exportHrpfPositionAssignExcel = window.__origExportFn; });

    // Không có quyền hrProfileFullView (chỉ hrProfileCreate) -> nút phải ẩn.
    const HR_CREATOR = { username: 'hrcr1', name: 'Chỉ Tạo Hồ Sơ', dept: 'Phòng Nhân Sự', perms: { hrProfileCreate: true }, active: true };
    epServer.APP_DATA.users.push(HR_CREATOR);
    state.users.push(HR_CREATOR);
    await page.evaluate((u) => { DB.users.push(u); }, HR_CREATOR);
    await loginAs('hrcr1');
    await page.evaluate(() => switchTab('hrProfile'));
    await page.evaluate(() => setHrProfileView('MANAGE'));
    await page.waitForTimeout(200);
    check('Không có quyền hrProfileFullView -> nút Xuất Excel Gán Chức Vụ bị ẩn',
      await page.evaluate(() => document.getElementById('hrpfManagePositionAssignExportBtn').classList.contains('hidden')));

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
