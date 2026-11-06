// server/tests/test-hr-secondary-position-manage-perm.js
//
// Regression test cho quyền riêng "hrSecondaryPositionManage" (11/2026, theo yêu cầu người dùng —
// "vị trí kiêm nhiệm bị khoá ở màn Sửa Người Dùng khi tài khoản đã liên kết hồ sơ Nhân Sự, admin cấu
// hình quy trình module khác không có quyền Hồ Sơ Nhân Sự không tự gán lại được"). Xác nhận đã chốt với
// người dùng ("Đồng ý — thêm quyền riêng (khuyến nghị)"):
//   1. Quyền RIÊNG, HẸP — chỉ mở lại đúng khối Vị Trí Kiêm Nhiệm, KHÔNG mở thêm bất kỳ quyền Hồ Sơ Nhân
//      Sự nào khác (không xem/sửa CCCD, lương, kỷ luật...).
//   2. Vẫn bắt buộc chọn từ vị trí CÓ THẬT trong Cơ Cấu Tổ Chức đang áp dụng (đi qua ĐÚNG đường validate
//      nghiêm ngặt applyProfileEdit() case 'secondaryPositions' — không tự nhập tay free-text).
//   3. Ai đã có quyền sửa Hồ Sơ Nhân Sự đầy đủ (canEditProfiles — hrProfileManage/hrProfileEdit) vẫn
//      dùng được 2 route này (không bị thu hẹp lại).
//   4. GET /secondary-position-options trả current đã resolve + legacyUnresolved cho kiêm nhiệm cũ lưu
//      trực tiếp trên user.secondaryPositions (free-text, trước khi có khái niệm profile.secondaryPositions)
//      chưa khớp được với Cơ Cấu Tổ Chức hiện tại.
//   5. POST /secondary-positions ghi qua applyProfileEdit() rồi ĐỒNG BỘ ngay sang user.secondaryPositions
//      (để matchesPositionPair()/resolvePositionApprovers() ở lib/positionApprovers.js — luồng chấm
//      "Theo vị trí" thật của mọi module khác — nhận diện đúng ngay, không cần HR mở lại hồ sơ).
//   6. Tài khoản CHƯA liên kết hồ sơ Nhân Sự nào -> 404 rõ ràng, không crash.
//
// Chạy: node server/tests/test-hr-secondary-position-manage-perm.js
'use strict';

const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const employeeProfile = require('../lib/employeeProfile');
const positionApprovers = require('../lib/positionApprovers');
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');

function buildOrgVersion() {
  return {
    id: 1, status: 'APPLIED',
    nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', departmentRef: null, jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Mua Hàng Thực Phẩm Tươi Sống', departmentRef: 'Phòng Mua Hàng Thực Phẩm Tươi Sống', jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Thẩm định ultrafresh', requiresDept: true, posType: 'HO', positionKey: 'POS-TD-UF' },
      { nodeId: 4, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng IT', departmentRef: 'Phòng IT', jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 5, parentNodeId: 4, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Chuyên Viên IT', requiresDept: true, posType: 'HO', positionKey: 'POS-IT-01' }
    ]
  };
}

async function main() {
  const run = createRunner();

  const ADMIN_NO_HR_PERM = { username: 'adminNonHr', name: 'Admin Quy Trình Khác', perms: { hrSecondaryPositionManage: true }, active: true };
  const ADMIN_NO_PERM_AT_ALL = { username: 'adminNoPerm', name: 'Admin Không Có Quyền Gì', perms: {}, active: true };
  const HR_FULL = { username: 'hr1', name: 'Nhân Sự Trưởng', perms: { hrProfileManage: true }, active: true };
  let USERS, APP_DATA;

  function resetAppData() {
    USERS = [
      { ...ADMIN_NO_HR_PERM }, { ...ADMIN_NO_PERM_AT_ALL }, { ...HR_FULL },
      { username: 'emp1', name: 'Nhân Viên Một', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống', jobTitle: 'Chuyên Viên Mua Hàng', secondaryPositions: [], perms: { canBeApprover: true }, active: true },
      { username: 'emp2Legacy', name: 'Nhân Viên Legacy', dept: 'Cũ', jobTitle: 'Cũ', secondaryPositions: [{ jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' }], perms: {}, active: true },
      { username: 'noProfile1', name: 'Chưa Liên Kết Hồ Sơ', dept: 'X', jobTitle: 'Y', secondaryPositions: [], perms: {}, active: true }
    ];
    APP_DATA = { users: USERS, employeeProfiles: [], hrProcesses: [], orgChartVersions: [buildOrgVersion()] };
  }

  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
    getAllAppData: async () => APP_DATA,
    withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
  });
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const fresh = APP_DATA.users.find(u => u.username === CURRENT_USERNAME);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  stubModule('lib/recordStore', { getAllForCollection: async () => [] });

  const express = require('express');
  const employeeProfileRoutes = require('../routes/employeeProfile');
  let PORT = 0;
  let CURRENT_USERNAME = ADMIN_NO_HR_PERM.username;

  function startApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/hr-profile', employeeProfileRoutes);
    return new Promise((resolve, reject) => {
      const server = http.createServer(app);
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
    });
  }
  async function api(method, urlPath, body, asUser) {
    if (asUser) CURRENT_USERNAME = asUser.username;
    const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let payload = null;
    try { payload = await res.json(); } catch (e) { payload = null; }
    return { status: res.status, body: payload };
  }
  function seedProfile(overrides) {
    const profile = Object.assign(employeeProfile.defaultProfile('NV300'), overrides || {});
    APP_DATA.employeeProfiles.push(profile);
    return profile;
  }

  const server = await startApp();
  try {
    await run.run('GET /secondary-position-options — tài khoản KHÔNG có quyền hrSecondaryPositionManage/HR nào -> 403', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV300', username: 'emp1' });
      const res = await api('GET', '/api/hr-profile/secondary-position-options?username=emp1', undefined, ADMIN_NO_PERM_AT_ALL);
      assertEqual(res.status, 403);
    });

    await run.run('GET /secondary-position-options — admin CHỈ có hrSecondaryPositionManage (KHÔNG có hrProfileManage/hrProfileEdit) -> 200, trả đúng vị trí thật từ Cơ Cấu Tổ Chức', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV300', username: 'emp1' });
      const res = await api('GET', '/api/hr-profile/secondary-position-options?username=emp1', undefined, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 200, 'Quyền riêng hẹp này ĐỦ để xem danh sách, không cần quyền Hồ Sơ Nhân Sự nào khác');
      assertEqual(res.body.hasProfile, true);
      assertEqual(res.body.positions.length, 2);
      assertEqual(res.body.current.length, 0);
    });

    await run.run('GET /secondary-position-options — tài khoản CHƯA liên kết hồ sơ Nhân Sự -> hasProfile=false, không crash', async () => {
      resetAppData();
      const res = await api('GET', '/api/hr-profile/secondary-position-options?username=noProfile1', undefined, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 200);
      assertEqual(res.body.hasProfile, false);
    });

    await run.run('GET /secondary-position-options — kiêm nhiệm CŨ lưu trực tiếp trên user.secondaryPositions (free-text, trước khi có profile.secondaryPositions) -> auto-resolve về positionKey thật khi khớp được tên', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV301', username: 'emp2Legacy' });
      const res = await api('GET', '/api/hr-profile/secondary-position-options?username=emp2Legacy', undefined, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 200);
      assertEqual(res.body.current.length, 1, 'Tự khớp được 1 vị trí cũ với node POSITION thật (cùng jobTitle+dept)');
      assertEqual(res.body.current[0].positionKey, 'POS-TD-UF');
      assertEqual(res.body.legacyUnresolved.length, 0);
    });

    await run.run('POST /secondary-positions — bị chặn khi KHÔNG có quyền', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV300', username: 'emp1' });
      const res = await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ positionKey: 'POS-TD-UF' }] }, ADMIN_NO_PERM_AT_ALL);
      assertEqual(res.status, 403);
    });

    await run.run('POST /secondary-positions — admin CHỈ có hrSecondaryPositionManage -> lưu thành công, đi qua ĐÚNG validate Cơ Cấu Tổ Chức (positionKey giả -> 400)', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV300', username: 'emp1' });
      const bad = await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ positionKey: 'POS-KHONG-TON-TAI' }] }, ADMIN_NO_HR_PERM);
      assertEqual(bad.status, 400, 'Không được tự nhập tay vị trí không có thật — vẫn bắt buộc đi qua Cơ Cấu Tổ Chức');
      const ok = await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ positionKey: 'POS-TD-UF' }] }, ADMIN_NO_HR_PERM);
      assertEqual(ok.status, 200);
      assertEqual(ok.body.secondaryPositions.length, 1);
      assertEqual(ok.body.secondaryPositions[0].jobTitle, 'Thẩm định ultrafresh');
    });

    await run.run('POST /secondary-positions — lưu thành công -> ĐỒNG BỘ ngay sang user.secondaryPositions[] (để luồng "Theo vị trí" thật nhận diện đúng ngay, không cần HR mở lại hồ sơ)', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV300', username: 'emp1' });
      await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ positionKey: 'POS-TD-UF' }] }, ADMIN_NO_HR_PERM);
      const u = APP_DATA.users.find(x => x.username === 'emp1');
      assertEqual(u.secondaryPositions.length, 1);
      assertEqual(u.secondaryPositions[0].jobTitle, 'Thẩm định ultrafresh');
      assertEqual(u.secondaryPositions[0].dept, 'Phòng Mua Hàng Thực Phẩm Tươi Sống');
      // Xác nhận luồng chấm "Theo vị trí" THẬT (lib/positionApprovers.js) nhận diện đúng ngay sau khi lưu.
      const matched = positionApprovers.resolvePositionApprovers(
        [{ jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' }], APP_DATA.users
      );
      assertIncludes(matched, 'emp1', 'resolvePositionApprovers() tìm thấy emp1 ngay sau khi admin gán qua route mới, không cần chờ HR mở lại hồ sơ');
    });

    await run.run('POST /secondary-positions — tài khoản CHƯA liên kết hồ sơ Nhân Sự -> 404 rõ ràng, không crash', async () => {
      resetAppData();
      const res = await api('POST', '/api/hr-profile/secondary-positions', { username: 'noProfile1', secondaryPositions: [{ positionKey: 'POS-TD-UF' }] }, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 404);
      assertIncludes(res.body.error, 'Nhân Sự');
    });

    await run.run('GET + POST /secondary-position* — HR đầy đủ quyền (hrProfileManage, KHÔNG có hrSecondaryPositionManage riêng) vẫn dùng được (canEditProfiles() đủ điều kiện)', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV300', username: 'emp1' });
      const getRes = await api('GET', '/api/hr-profile/secondary-position-options?username=emp1', undefined, HR_FULL);
      assertEqual(getRes.status, 200);
      const postRes = await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ positionKey: 'POS-IT-01' }] }, HR_FULL);
      assertEqual(postRes.status, 200);
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(1); });
