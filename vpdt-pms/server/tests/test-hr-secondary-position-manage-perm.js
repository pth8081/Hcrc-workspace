// server/tests/test-hr-secondary-position-manage-perm.js
//
// Regression test cho quyền riêng "hrSecondaryPositionManage" (11/2026, theo yêu cầu người dùng —
// "vị trí kiêm nhiệm bị khoá ở màn Sửa Người Dùng khi tài khoản đã liên kết hồ sơ Nhân Sự, admin cấu
// hình quy trình module khác không có quyền Hồ Sơ Nhân Sự không tự gán lại được"). Xác nhận đã chốt với
// người dùng:
//   1. Quyền RIÊNG, HẸP — chỉ mở lại đúng khối Vị Trí Kiêm Nhiệm, KHÔNG mở thêm bất kỳ quyền Hồ Sơ Nhân
//      Sự nào khác (không xem/sửa CCCD, lương, kỷ luật...).
//   2. Box này hiện ĐỦ TẤT CẢ vị trí kiêm nhiệm tài khoản ĐANG CÓ (kể cả gán kiểu cũ/legacy) — không cần
//      hồ sơ Nhân Sự tồn tại/liên kết.
//   3. Vẫn bắt buộc chọn từ vị trí CÓ THẬT trong Cơ Cấu Tổ Chức đang áp dụng (không tự nhập tay).
//   4. Sửa ở box này vẫn "upline" đúng cho MỌI quy trình "Theo vị trí" đã có (resolvePositionApprovers()).
//   5. ĐÃ XÁC NHẬN LẠI (người dùng hỏi trực tiếp): sửa ở box này KHÔNG được update ngược lại hồ sơ Nhân
//      Sự (profile.secondaryPositions) — để HR không thấy/không hoang mang vì thay đổi họ không tự làm.
//   6. Ngược lại: lần HR lưu hồ sơ SAU ĐÓ (dù chỉ sửa field khác, không đụng khối Kiêm Nhiệm) KHÔNG được
//      âm thầm xoá trắng những gì admin vừa gán ở box này (bug thật nếu không merge đúng — xem PHẦN C).
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
      { username: 'emp2Legacy', name: 'Nhân Viên Legacy', dept: 'Cũ', jobTitle: 'Cũ', secondaryPositions: [{ jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' }], perms: { canBeApprover: true }, active: true },
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
    // ===== PHẦN A: quyền + validate vị trí có thật =====
    await run.run('GET /secondary-position-options — tài khoản KHÔNG có quyền hrSecondaryPositionManage/HR nào -> 403', async () => {
      resetAppData();
      const res = await api('GET', '/api/hr-profile/secondary-position-options?username=emp1', undefined, ADMIN_NO_PERM_AT_ALL);
      assertEqual(res.status, 403);
    });

    await run.run('GET /secondary-position-options — admin CHỈ có hrSecondaryPositionManage, tài khoản KHÔNG liên kết hồ sơ Nhân Sự nào -> vẫn 200 (KHÔNG đòi hồ sơ Nhân Sự)', async () => {
      resetAppData();
      const res = await api('GET', '/api/hr-profile/secondary-position-options?username=emp1', undefined, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 200, 'Route đọc/ghi thẳng user.secondaryPositions, không cần hồ sơ Nhân Sự tồn tại');
      assertEqual(res.body.positions.length, 2);
      assertEqual(res.body.current.length, 0);
    });

    await run.run('GET /secondary-position-options — tài khoản KHÔNG tồn tại -> 404 rõ ràng, không crash', async () => {
      resetAppData();
      const res = await api('GET', '/api/hr-profile/secondary-position-options?username=khongTonTai', undefined, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 404);
    });

    await run.run('POST /secondary-positions — bị chặn 403 khi KHÔNG có quyền', async () => {
      resetAppData();
      const res = await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ positionKey: 'POS-TD-UF' }] }, ADMIN_NO_PERM_AT_ALL);
      assertEqual(res.status, 403);
    });

    await run.run('POST /secondary-positions — vẫn bắt buộc chọn vị trí CÓ THẬT trong Cơ Cấu Tổ Chức (positionKey giả -> 400)', async () => {
      resetAppData();
      const res = await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ positionKey: 'POS-KHONG-TON-TAI' }] }, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 400);
    });

    // ===== PHẦN B: (1) box hiện ĐỦ vị trí kiêm nhiệm cũ đang có + (2) "upline" đúng cho quy trình "Theo vị trí" =====
    await run.run('GET /secondary-position-options — hiện ĐỦ vị trí kiêm nhiệm CŨ (legacy, gõ tay thẳng trên user.secondaryPositions) ngay trong box, tự khớp về positionKey thật', async () => {
      resetAppData();
      const res = await api('GET', '/api/hr-profile/secondary-position-options?username=emp2Legacy', undefined, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 200);
      assertEqual(res.body.current.length, 1, 'Vị trí kiêm nhiệm cũ đã có hiện ra NGAY trong box, không cần migrate tay');
      assertEqual(res.body.current[0].positionKey, 'POS-TD-UF');
      assertEqual(res.body.legacyUnresolved.length, 0);
    });

    await run.run('POST /secondary-positions — sau khi admin gán qua box, resolvePositionApprovers() (luồng "Theo vị trí" THẬT dùng cho MỌI quy trình đã có) nhận diện đúng NGAY', async () => {
      resetAppData();
      await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ positionKey: 'POS-TD-UF' }] }, ADMIN_NO_HR_PERM);
      const matched = positionApprovers.resolvePositionApprovers(
        [{ jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' }], APP_DATA.users
      );
      assertIncludes(matched, 'emp1', 'resolvePositionApprovers() dùng CHUNG cho mọi quy trình "Theo vị trí" hiện có — tìm thấy emp1 ngay sau khi admin gán qua box, không cần chờ gì thêm');
    });

    // ===== PHẦN C: (3) KHÔNG update ngược lại hồ sơ Nhân Sự + (4) HR lưu hồ sơ sau đó KHÔNG xoá mất =====
    await run.run('POST /secondary-positions — lưu thành công KHÔNG đụng tới employeeProfiles (dù hồ sơ đã liên kết tài khoản này) — HR không thấy thay đổi này', async () => {
      resetAppData();
      const profile = seedProfile({ employeeCode: 'NV300', username: 'emp1' });
      await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ positionKey: 'POS-TD-UF' }] }, ADMIN_NO_HR_PERM);
      const freshProfile = APP_DATA.employeeProfiles.find(p => p.employeeCode === 'NV300');
      assertEqual((freshProfile.secondaryPositions || []).length, 0, 'profile.secondaryPositions (field HR thấy ở Chi tiết hồ sơ) không hề bị đụng tới');
      const u = APP_DATA.users.find(x => x.username === 'emp1');
      assertEqual(u.secondaryPositions.length, 1, 'user.secondaryPositions (dùng để chấm "Theo vị trí") vẫn được ghi đúng');
      assertEqual(u.secondaryPositions[0].jobTitle, 'Thẩm định ultrafresh');
    });

    await run.run('PATCH /by-code — HR lưu hồ sơ (sửa field KHÁC, secondaryPositions của HR vẫn RỖNG) SAU KHI admin đã gán qua box -> KHÔNG xoá mất gán của admin (bug thật nếu không merge đúng)', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV300', username: 'emp1' });
      await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ positionKey: 'POS-TD-UF' }] }, ADMIN_NO_HR_PERM);
      // HR lưu hồ sơ của emp1 — chỉ sửa deskLocation, nhưng client luôn gửi kèm secondaryPositions (rỗng,
      // vì HR chưa từng mở khối Kiêm Nhiệm cho hồ sơ này) trong MỌI lần lưu ở scope MANAGE.
      const saveRes = await api('PATCH', '/api/hr-profile/by-code/NV300', { deskLocation: 'Bàn A1', secondaryPositions: [] }, HR_FULL);
      assertEqual(saveRes.status, 200);
      const u = APP_DATA.users.find(x => x.username === 'emp1');
      assertEqual(u.secondaryPositions.length, 1, 'Vị trí admin gán qua box (source ADMIN_QUICK_EDIT) PHẢI còn nguyên sau khi HR lưu hồ sơ không liên quan');
      assertEqual(u.secondaryPositions[0].jobTitle, 'Thẩm định ultrafresh');
    });

    await run.run('PATCH /by-code — HR gán kiêm nhiệm THẬT ở Hồ Sơ Nhân Sự cho cùng tài khoản -> vẫn đồng bộ xuống đúng (chiều này KHÔNG đổi), cộng dồn với phần admin đã gán qua box', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV300', username: 'emp1' });
      await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ positionKey: 'POS-TD-UF' }] }, ADMIN_NO_HR_PERM);
      await api('PATCH', '/api/hr-profile/by-code/NV300', { secondaryPositions: [{ positionKey: 'POS-IT-01' }] }, HR_FULL);
      const u = APP_DATA.users.find(x => x.username === 'emp1');
      assertEqual(u.secondaryPositions.length, 2, 'Cộng dồn: 1 dòng admin gán qua box + 1 dòng HR gán ở Hồ Sơ Nhân Sự, không dòng nào bị mất');
      assertIncludes(u.secondaryPositions.map(sp => sp.jobTitle), 'Thẩm định ultrafresh');
      assertIncludes(u.secondaryPositions.map(sp => sp.jobTitle), 'Chuyên Viên IT');
    });

    await run.run('PATCH /by-code — HR sửa lại khối Kiêm Nhiệm của chính họ (bỏ 1 vị trí) -> chỉ đúng phần HR quản lý bị thay, phần admin gán qua box không đổi', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV300', username: 'emp1' });
      await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ positionKey: 'POS-TD-UF' }] }, ADMIN_NO_HR_PERM);
      await api('PATCH', '/api/hr-profile/by-code/NV300', { secondaryPositions: [{ positionKey: 'POS-IT-01' }] }, HR_FULL);
      // HR đổi ý, bỏ hẳn vị trí IT, lưu lại hồ sơ.
      await api('PATCH', '/api/hr-profile/by-code/NV300', { secondaryPositions: [] }, HR_FULL);
      const u = APP_DATA.users.find(x => x.username === 'emp1');
      assertEqual(u.secondaryPositions.length, 1, 'Dòng HR (Chuyên Viên IT) bị bỏ đúng ý HR, dòng admin (Thẩm định ultrafresh) vẫn còn');
      assertEqual(u.secondaryPositions[0].jobTitle, 'Thẩm định ultrafresh');
    });

    await run.run('GET + POST /secondary-position* — HR đầy đủ quyền (hrProfileManage, KHÔNG có hrSecondaryPositionManage riêng) vẫn dùng được box này (canEditProfiles() đủ điều kiện)', async () => {
      resetAppData();
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
