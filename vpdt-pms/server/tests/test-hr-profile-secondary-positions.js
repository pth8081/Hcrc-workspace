// server/tests/test-hr-profile-secondary-positions.js
//
// Regression test cho tính năng "Vị Trí Kiêm Nhiệm" (11/2026, theo yêu cầu người dùng — "vị trí kiêm
// nhiệm nhập từ Nhân Sự, link sang Quản Lý Người Dùng cho phần phê duyệt, vì phải xuất phát từ nhân
// sự"). Xác nhận đã chốt với người dùng:
//   1. Nhiều vị trí kiêm nhiệm cùng lúc, LUÔN chọn từ node POSITION thật trong Cơ Cấu Tổ Chức đang áp
//      dụng (kể cả vị trí ở phòng ban khác) — xem case 'secondaryPositions' ở applyProfileEdit().
//   2. KHÔNG tính vào headcountQuota — chỉ phục vụ Báo Cáo Kiêm Nhiệm (computeSecondaryPositionsReport()).
//   3. Tự động đồng bộ 1 CHIỀU từ Hồ Sơ Nhân Sự sang user.secondaryPositions[] khi hồ sơ đã liên kết tài
//      khoản VPDT (PATCH /by-code, link-account, relink-account) — màn Sửa Người Dùng không còn là
//      nguồn nhập tay cho tài khoản đã liên kết (chỉ còn đọc, xem module-admin-userstaging.js).
//
// PHẦN A: applyProfileEdit() case 'secondaryPositions' + computeSecondaryPositionsReport() (thuần).
// PHẦN B: HTTP thật qua Express (mock lib/appData + lib/auth + lib/recordStore, cùng khuôn
//   test-hr-profile-position-history.js).
//
// Chạy: node server/tests/test-hr-profile-secondary-positions.js
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
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');

function buildOrgVersion() {
  return {
    id: 1, status: 'APPLIED',
    nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', departmentRef: null, jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', departmentRef: 'Phòng Kinh Doanh', jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Trưởng Phòng', requiresDept: true, posType: 'HO', positionKey: 'POS-TP-KD' },
      { nodeId: 4, parentNodeId: 2, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Nhân Viên', requiresDept: true, posType: 'STORE', positionKey: 'POS-NV-KD' },
      { nodeId: 5, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng IT', departmentRef: 'Phòng IT', jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 6, parentNodeId: 5, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Chuyên Viên IT', requiresDept: true, posType: 'HO', positionKey: 'POS-IT-01' },
      { nodeId: 7, parentNodeId: 1, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Tổng Giám Đốc', requiresDept: false, posType: null, positionKey: 'POS-TGD' }
    ]
  };
}

async function main() {
  const run = createRunner();

  // ===== PHẦN A: applyProfileEdit() case 'secondaryPositions' (thuần) =====
  await run.run('applyProfileEdit(): gán 2 vị trí kiêm nhiệm Ở PHÒNG BAN KHÁC -> snapshot đúng jobTitle/dept/positionLabel', () => {
    const version = buildOrgVersion();
    const profile = employeeProfile.defaultProfile('NV001');
    employeeProfile.applyProfileEdit(profile, { secondaryPositions: [{ positionKey: 'POS-NV-KD' }, { positionKey: 'POS-IT-01', note: 'Hỗ trợ IT khi cần' }] },
      employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'Nhân Sự Trưởng', { orgChartAppliedVersion: version });
    assertEqual(profile.secondaryPositions.length, 2, 'Lưu đủ 2 dòng');
    assertEqual(profile.secondaryPositions[0].jobTitle, 'Nhân Viên');
    assertEqual(profile.secondaryPositions[0].dept, 'Phòng Kinh Doanh');
    assertEqual(profile.secondaryPositions[1].jobTitle, 'Chuyên Viên IT');
    assertEqual(profile.secondaryPositions[1].dept, 'Phòng IT', 'Kiêm nhiệm vị trí ở PHÒNG BAN KHÁC vẫn được (đúng yêu cầu người dùng)');
    assertEqual(profile.secondaryPositions[1].note, 'Hỗ trợ IT khi cần');
    assertIncludes(profile.secondaryPositions[0].positionLabel, 'Nhân Viên', 'positionLabel snapshot đúng');
  });

  await run.run('applyProfileEdit(): vị trí requiresDept=false (VD Tổng Giám Đốc) -> dept=null, vẫn hợp lệ', () => {
    const version = buildOrgVersion();
    const profile = employeeProfile.defaultProfile('NV002');
    employeeProfile.applyProfileEdit(profile, { secondaryPositions: [{ positionKey: 'POS-TGD' }] },
      employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR', { orgChartAppliedVersion: version });
    assertEqual(profile.secondaryPositions[0].dept, null);
  });

  await run.run('applyProfileEdit(): kiêm nhiệm ĐÚNG vị trí CHÍNH THỨC hiện tại -> chặn, báo lỗi rõ', () => {
    const version = buildOrgVersion();
    const profile = employeeProfile.defaultProfile('NV003');
    employeeProfile.applyPositionAssignment(profile, version, 'POS-TP-KD', null, 'hr1', 'HR', null);
    let threw = null;
    try {
      employeeProfile.applyProfileEdit(profile, { secondaryPositions: [{ positionKey: 'POS-TP-KD' }] },
        employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR', { orgChartAppliedVersion: version });
    } catch (e) { threw = e; }
    assertEqual(!!threw, true);
    assertEqual(threw.status, 400);
    assertIncludes(threw.message, 'CHÍNH THỨC');
  });

  await run.run('applyProfileEdit(): trùng lặp 2 dòng CÙNG vị trí trong chính danh sách gửi lên -> chặn', () => {
    const version = buildOrgVersion();
    const profile = employeeProfile.defaultProfile('NV004');
    let threw = null;
    try {
      employeeProfile.applyProfileEdit(profile, { secondaryPositions: [{ positionKey: 'POS-NV-KD' }, { positionKey: 'POS-NV-KD' }] },
        employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR', { orgChartAppliedVersion: version });
    } catch (e) { threw = e; }
    assertEqual(!!threw, true);
    assertEqual(threw.status, 400);
  });

  await run.run('applyProfileEdit(): positionKey không tồn tại trong bản áp dụng -> chặn, báo lỗi rõ', () => {
    const version = buildOrgVersion();
    const profile = employeeProfile.defaultProfile('NV005');
    let threw = null;
    try {
      employeeProfile.applyProfileEdit(profile, { secondaryPositions: [{ positionKey: 'POS-KHONG-TON-TAI' }] },
        employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR', { orgChartAppliedVersion: version });
    } catch (e) { threw = e; }
    assertEqual(!!threw, true);
    assertEqual(threw.status, 400);
  });

  await run.run('applyProfileEdit(): chưa có bản Cơ Cấu Tổ Chức nào áp dụng (orgChartAppliedVersion=undefined) -> chặn, báo lỗi rõ', () => {
    const profile = employeeProfile.defaultProfile('NV006');
    let threw = null;
    try {
      employeeProfile.applyProfileEdit(profile, { secondaryPositions: [{ positionKey: 'POS-NV-KD' }] },
        employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR', {});
    } catch (e) { threw = e; }
    assertEqual(!!threw, true);
    assertIncludes(threw.message, 'Cơ Cấu Tổ Chức');
  });

  await run.run('applyProfileEdit(): gửi mảng rỗng -> xoá sạch kiêm nhiệm đã có (bỏ chọn hết)', () => {
    const version = buildOrgVersion();
    const profile = employeeProfile.defaultProfile('NV007');
    employeeProfile.applyProfileEdit(profile, { secondaryPositions: [{ positionKey: 'POS-NV-KD' }] },
      employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR', { orgChartAppliedVersion: version });
    assertEqual(profile.secondaryPositions.length, 1);
    employeeProfile.applyProfileEdit(profile, { secondaryPositions: [] },
      employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR', { orgChartAppliedVersion: version });
    assertEqual(profile.secondaryPositions.length, 0);
  });

  await run.run('applyProfileEdit(): secondaryPositions KHÔNG thuộc SELF_EDITABLE_FIELDS -> tự phục vụ (scope ME) gửi lên bị bỏ qua hoàn toàn', () => {
    const version = buildOrgVersion();
    const profile = employeeProfile.defaultProfile('NV008');
    employeeProfile.applyProfileEdit(profile, { secondaryPositions: [{ positionKey: 'POS-NV-KD' }] },
      employeeProfile.SELF_EDITABLE_FIELDS, 'emp1', 'Nhân Viên Một', { orgChartAppliedVersion: version });
    assertEqual(profile.secondaryPositions.length, 0, 'allowedFields không chứa secondaryPositions -> field bị bỏ qua, không throw, không set');
  });

  // ===== computeSecondaryPositionsReport() (thuần) =====
  await run.run('computeSecondaryPositionsReport(): gộp đúng mọi dòng kiêm nhiệm của hồ sơ ACTIVE, bỏ qua hồ sơ INACTIVE', () => {
    const version = buildOrgVersion();
    const p1 = employeeProfile.defaultProfile('NV100');
    p1.status = 'ACTIVE'; p1.dept = 'Phòng Kinh Doanh'; p1.jobTitle = 'Trưởng Phòng';
    employeeProfile.applyProfileEdit(p1, { secondaryPositions: [{ positionKey: 'POS-IT-01', note: 'Ghi chú A' }] },
      employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR', { orgChartAppliedVersion: version });
    const p2 = employeeProfile.defaultProfile('NV101');
    p2.status = 'INACTIVE';
    employeeProfile.applyPositionAssignment(p2, version, 'POS-NV-KD', null, 'hr1', 'HR', null);
    employeeProfile.applyProfileEdit(p2, { secondaryPositions: [{ positionKey: 'POS-IT-01' }] },
      employeeProfile.HR_ONLY_EDITABLE_FIELDS, 'hr1', 'HR', { orgChartAppliedVersion: version });
    const result = employeeProfile.computeSecondaryPositionsReport([p1, p2]);
    assertEqual(result.total, 1, 'Chỉ 1 dòng (hồ sơ p2 INACTIVE bị loại)');
    assertEqual(result.rows[0].employeeCode, 'NV100');
    assertEqual(result.rows[0].secondaryJobTitle, 'Chuyên Viên IT');
    assertEqual(result.rows[0].secondaryDept, 'Phòng IT');
    assertEqual(result.rows[0].note, 'Ghi chú A');
  });

  // ===== PHẦN B: HTTP thật qua Express =====
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên', perms: { admin: true }, active: true };
  const HR_FULL = { username: 'hr1', name: 'Nhân Sự Trưởng', perms: { hrProfileManage: true, hrContractManage: true }, active: true };
  const EMP1 = { username: 'emp1', name: 'Nhân Viên Một', dept: 'Cũ', jobTitle: 'Chức Cũ', secondaryPositions: [{ jobTitle: 'Cũ Gõ Tay', dept: '' }], perms: {}, active: true };
  let USERS = [ADMIN, HR_FULL, EMP1];
  let APP_DATA;
  function resetAppData() {
    USERS = [
      { ...ADMIN }, { ...HR_FULL },
      { username: 'emp1', name: 'Nhân Viên Một', dept: 'Cũ', jobTitle: 'Chức Cũ', secondaryPositions: [{ jobTitle: 'Cũ Gõ Tay', dept: '' }], perms: {}, active: true }
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
  let CURRENT_USERNAME = ADMIN.username;

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
    const profile = Object.assign(employeeProfile.defaultProfile('NV200'), overrides || {});
    APP_DATA.employeeProfiles.push(profile);
    return profile;
  }

  const server = await startApp();
  try {
    await run.run('PATCH /by-code — hồ sơ ĐÃ liên kết tài khoản -> secondaryPositions trong payload đồng bộ GHI ĐÈ sang user.secondaryPositions[]', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV200', username: 'emp1' });
      const res = await api('PATCH', '/api/hr-profile/by-code/NV200', { secondaryPositions: [{ positionKey: 'POS-IT-01' }] }, HR_FULL);
      assertEqual(res.status, 200);
      const u = APP_DATA.users.find(x => x.username === 'emp1');
      assertEqual(u.secondaryPositions.length, 1, 'Đồng bộ đúng 1 vị trí');
      assertEqual(u.secondaryPositions[0].jobTitle, 'Chuyên Viên IT');
      assertEqual(u.secondaryPositions[0].dept, 'Phòng IT');
    });

    await run.run('PATCH /by-code — field "secondaryPositions" KHÔNG có mặt trong payload -> KHÔNG đụng tới user.secondaryPositions[] cũ (sửa field khác không làm mất kiêm nhiệm cũ)', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV200', username: 'emp1' });
      await api('PATCH', '/api/hr-profile/by-code/NV200', { secondaryPositions: [{ positionKey: 'POS-IT-01' }] }, HR_FULL);
      const before = JSON.stringify(APP_DATA.users.find(x => x.username === 'emp1').secondaryPositions);
      await api('PATCH', '/api/hr-profile/by-code/NV200', { deskLocation: 'Bàn A1' }, HR_FULL);
      const after = JSON.stringify(APP_DATA.users.find(x => x.username === 'emp1').secondaryPositions);
      assertEqual(after, before, 'Không gửi secondaryPositions -> giữ nguyên đồng bộ cũ');
    });

    await run.run('PATCH /by-code — hồ sơ CHƯA liên kết tài khoản -> lưu vào hồ sơ bình thường, KHÔNG lỗi, KHÔNG đụng users', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV200' });
      const res = await api('PATCH', '/api/hr-profile/by-code/NV200', { secondaryPositions: [{ positionKey: 'POS-IT-01' }] }, HR_FULL);
      assertEqual(res.status, 200);
      assertEqual(res.body.profile.secondaryPositions.length, 1);
    });

    await run.run('POST /by-code/:code/link-account — hồ sơ ĐÃ có kiêm nhiệm TRƯỚC KHI liên kết -> đồng bộ NGAY LÚC liên kết (cùng lỗi/cách vá như positionKey)', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV200' });
      await api('PATCH', '/api/hr-profile/by-code/NV200', { secondaryPositions: [{ positionKey: 'POS-NV-KD' }] }, HR_FULL);
      const res = await api('POST', '/api/hr-profile/by-code/NV200/link-account', { username: 'emp1' }, HR_FULL);
      assertEqual(res.status, 200);
      const u = APP_DATA.users.find(x => x.username === 'emp1');
      assertEqual(u.secondaryPositions.length, 1, 'Đồng bộ ngay khi liên kết, không chờ sửa lại');
      assertEqual(u.secondaryPositions[0].jobTitle, 'Nhân Viên');
    });

    await run.run('GET /linked-usernames — trả đúng danh sách username đã liên kết, mở cho MỌI tài khoản đăng nhập (không đòi quyền Hồ Sơ Nhân Sự nào)', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV200', username: 'emp1' });
      const res = await api('GET', '/api/hr-profile/linked-usernames', undefined, EMP1);
      assertEqual(res.status, 200, 'EMP1 không có quyền HR nào vẫn gọi được (route exempt khỏi gác module hrProfile)');
      assertEqual(res.body.usernames.includes('emp1'), true);
    });

    await run.run('GET /reports/secondary-positions — đòi quyền Báo Cáo Nhân Sự, trả đúng dữ liệu', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV200', username: 'emp1', status: 'ACTIVE' });
      await api('PATCH', '/api/hr-profile/by-code/NV200', { secondaryPositions: [{ positionKey: 'POS-IT-01' }] }, HR_FULL);
      const denied = await api('GET', '/api/hr-profile/reports/secondary-positions', undefined, EMP1);
      assertEqual(denied.status, 403);
      const ok = await api('GET', '/api/hr-profile/reports/secondary-positions', undefined, HR_FULL);
      assertEqual(ok.status, 200);
      assertEqual(ok.body.total, 1);
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(1); });
