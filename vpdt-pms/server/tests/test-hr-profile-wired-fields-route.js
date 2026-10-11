// server/tests/test-hr-profile-wired-fields-route.js
//
// LỖI ĐÃ VÁ (đợt rà soát v25.1→v25.70): GET /api/hr-profile/by-code/:employeeCode và
// /by-username/:username (routes/employeeProfile.js) trước đây merge thẳng resolveWiredReadOnlyFields()
// vào response SAU KHI đã áp lớp ẩn giới hạn cho "quản lý trực tiếp xem giới hạn" (getProfileForViewer())
// — 6/8 field wired (khoiBan/managerManagerUsername/managerManagerName/resignationReason/actualEndDate/
// lastWorkingDate) LUÔN hiện trong response bất kể viewMode, bỏ qua managerVisibleFields. Test này gọi
// THẲNG qua HTTP thật (Express app thật, KHÔNG qua Playwright/browser — tránh lỗi môi trường không liên
// quan đang chặn #hrpfMeContainer ở test-hr-profile-field-visibility.js) để xác nhận ĐÚNG con đường khai
// thác mà audit nêu ra: "gọi thẳng API (session hợp lệ) vẫn đọc được".
//
// Chạy: node server/tests/test-hr-profile-wired-fields-route.js
'use strict';

const http = require('http');
const express = require('express');
const { createRunner, assertEqual } = require('./testHarness');

function stubModule(relPath, exportsObj) {
  const path = require('path');
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

async function startServer(APP_DATA) {
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

  delete require.cache[require.resolve('../routes/employeeProfile')];
  const employeeProfileRoutes = require('../routes/employeeProfile');

  const app = express();
  app.use(express.json());
  app.use('/api/hr-profile', employeeProfileRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  return { server, port };
}

async function callApi(port, method, path, username) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'x-demo-user': username || '' } });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main() {
  const run = createRunner();
  const employeeProfileLib = require('../lib/employeeProfile');

  const ADMIN = { username: 'admin', name: 'Quản Trị Viên', perms: { admin: true, hrProfileManage: true }, active: true };
  const GD1 = { username: 'gd01', name: 'Giám Đốc Kinh Doanh', perms: {}, active: true };
  const MGR1 = { username: 'qltt01', name: 'Trưởng Phòng Kinh Doanh', managerUsername: 'gd01', perms: { hrProfileView: true }, active: true };
  const EMP1 = { username: 'nv001emp', name: 'Nhân Viên Một', khoiBan: 'Khối Kinh Doanh', managerUsername: 'qltt01', perms: {}, active: true };
  const profile = Object.assign(employeeProfileLib.defaultProfile('NVWF01'), { username: 'nv001emp', status: 'ACTIVE' });
  const hrProcesses = [{
    id: 'proc1', processType: 'OFFBOARDING', employeeUsername: 'nv001emp',
    resignationReason: 'Lý do nghỉ việc BÍ MẬT', actualEndDate: '2024-12-31', lastWorkingDate: '2024-12-30',
    createdAt: '08:00:00 31/12/2024'
  }];

  const APP_DATA = {
    users: [ADMIN, GD1, MGR1, EMP1], employeeProfiles: [profile],
    hrProcesses, hrProfileManagerVisibleFields: [], hrProfileSelfVisibleFields: []
  };

  const { server, port } = await startServer(APP_DATA);
  try {
    await run.run('GET /by-username (quản lý trực tiếp, LIMITED, chưa mở field nào) -> resignationReason/khoiBan/managerManagerName PHẢI null', async () => {
      const { status, body } = await callApi(port, 'GET', '/api/hr-profile/by-username/nv001emp', 'qltt01');
      assertEqual(status, 200);
      assertEqual(body.viewMode, 'LIMITED');
      assertEqual(body.profile.resignationReason, null, 'XÁC NHẬN LỖI ĐÃ VÁ: resignationReason không còn lộ qua API thô');
      assertEqual(body.profile.khoiBan, null, 'XÁC NHẬN LỖI ĐÃ VÁ: khoiBan không còn lộ qua API thô');
      assertEqual(body.profile.managerManagerName, null, 'XÁC NHẬN LỖI ĐÃ VÁ: managerManagerName không còn lộ qua API thô');
      assertEqual(body.profile.actualEndDate, null);
      assertEqual(body.profile.lastWorkingDate, null);
      assertEqual(body.profile.managerManagerUsername, null);
      assertEqual(body.profile.managerUsername, 'qltt01', 'managerUsername (cấp 1, chính người đang xem) vẫn hiện bình thường');
      assertEqual(body.profile.managerName, 'Trưởng Phòng Kinh Doanh');
    });

    await run.run('PUT /manager-field-config mở resignationReason+khoiBan+managerManagerName -> GET sau đó hiện ĐÚNG, phần còn lại vẫn null', async () => {
      const put = await fetch(`http://127.0.0.1:${port}/api/hr-profile/manager-field-config`, {
        method: 'PUT', headers: { 'x-demo-user': 'admin', 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibleFields: ['resignationReason', 'khoiBan', 'managerManagerName'] })
      });
      assertEqual(put.status, 200);

      const { body } = await callApi(port, 'GET', '/api/hr-profile/by-username/nv001emp', 'qltt01');
      assertEqual(body.profile.resignationReason, 'Lý do nghỉ việc BÍ MẬT', 'cơ chế opt-in vẫn hoạt động sau khi admin mở');
      assertEqual(body.profile.khoiBan, 'Khối Kinh Doanh');
      assertEqual(body.profile.managerManagerName, 'Giám Đốc Kinh Doanh');
      assertEqual(body.profile.actualEndDate, null, 'actualEndDate KHÔNG được mở -> vẫn null dù 3 field khác đã mở (lọc đúng từng field)');
      assertEqual(body.profile.lastWorkingDate, null);
      assertEqual(body.profile.managerManagerUsername, null);
    });

    await run.run('GET /by-code (HR/admin, FULL view) -> vẫn thấy đủ wiredFields kể cả field chưa mở cho quản lý trực tiếp', async () => {
      const { body } = await callApi(port, 'GET', '/api/hr-profile/by-code/NVWF01', 'admin');
      assertEqual(body.viewMode, 'FULL');
      assertEqual(body.profile.actualEndDate, '2024-12-31', 'FULL view không bị ảnh hưởng bởi managerVisibleFields');
      assertEqual(body.profile.lastWorkingDate, '2024-12-30');
      assertEqual(body.profile.managerManagerUsername, 'gd01');
    });

    // LỖI ĐÃ VÁ (11/2026, rà soát theo yêu cầu người dùng sau đợt thêm field transfers/báo cáo mới):
    // nhân viên KHÔNG có bất kỳ quyền Hồ Sơ Nhân Sự nào tự gọi THẲNG GET /by-code hoặc /by-username với
    // CHÍNH mã/username của mình (DevTools/curl, không qua UI nào — UI tự xem luôn đi GET /api/hr-profile/me)
    // trước đây nhận lại NGUYÊN hồ sơ không lọc field nhạy cảm nào (viewMode='FULL' sai), bỏ qua hoàn toàn
    // cấu hình "Trường Xem Của Tôi" (hrProfileSelfVisibleFields) mà GET /me đang tôn trọng đúng — xem
    // getProfileForViewer()/lib/employeeProfile.js.
    await run.run('GET /by-code tự gọi CHÍNH MÌNH (không quyền HR nào, chưa mở selfVisibleFields) -> field nhạy cảm PHẢI null, viewMode=SELF (không còn FULL sai)', async () => {
      const { status, body } = await callApi(port, 'GET', '/api/hr-profile/by-code/NVWF01', 'nv001emp');
      assertEqual(status, 200);
      assertEqual(body.viewMode, 'SELF', 'XÁC NHẬN LỖI ĐÃ VÁ: không còn báo FULL cho tự xem chưa mở field nào');
      assertEqual(body.profile.dateOfBirth, undefined, 'XÁC NHẬN LỖI ĐÃ VÁ: field nhạy cảm (SENSITIVE_FIELDS) không còn lộ nguyên vẹn qua /by-code tự gọi');
      assertEqual(body.profile.nationalId, undefined);
      assertEqual(body.profile.resignationReason, null, 'wiredFields cũng phải lọc đúng theo selfVisibleFields (KHÔNG dùng nhầm managerVisibleFields)');
    });

    await run.run('GET /by-username tự gọi CHÍNH MÌNH -> cùng mức lọc như /me (đối xứng, đúng selfVisibleFields đã cấu hình)', async () => {
      const put = await fetch(`http://127.0.0.1:${port}/api/hr-profile/self-field-config`, {
        method: 'PUT', headers: { 'x-demo-user': 'admin', 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibleFields: ['dateOfBirth'] })
      });
      assertEqual(put.status, 200);

      const { body } = await callApi(port, 'GET', '/api/hr-profile/by-username/nv001emp', 'nv001emp');
      assertEqual(body.viewMode, 'SELF');
      assertEqual(Object.prototype.hasOwnProperty.call(body.profile, 'dateOfBirth'), true, 'field vừa mở qua self-field-config phải CÓ MẶT trong response (không còn bị xoá key)');
      assertEqual(body.profile.dateOfBirth, null, 'hồ sơ gốc chưa có dữ liệu ngày sinh -> đúng giá trị null (không phải chuỗi/ẩn)');
      assertEqual(body.profile.nationalId, undefined, 'field CHƯA mở vẫn tiếp tục bị ẩn sau khi mở field khác');
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
