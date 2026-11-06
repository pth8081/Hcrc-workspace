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
//   3. ĐÃ ĐỔI (11/2026, báo cáo người dùng — "ô này chỉ tìm được vị trí CÓ THẬT trong Cơ Cấu Tổ Chức,
//      trong khi ô 'Vị Trí Kiêm Nhiệm (tuỳ chọn)' ở TRÊN lại tìm được chức danh HO/Siêu Thị đã tạo ở
//      phân quyền mà không cần có node — không nhất quán, không gán được 1 vị trí vẫn đang dùng cho quy
//      trình nhưng chưa/không còn đặt thành node trong Cơ Cấu Tổ Chức"): KHÔNG còn đòi `positionKey`/
//      node thật — nhận thẳng {jobTitle, dept}, nguồn chọn gợi ý lấy từ 🧭 Vị Trí Tham Gia Quy Trình
//      (appData.workflowParticipatingPositions), đúng CÙNG nguồn ô "Vị Trí Kiêm Nhiệm (tuỳ chọn)" chính
//      đã dùng (wfPositionPairPickerItems() phía client).
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

// Cơ Cấu Tổ Chức — vẫn cần cho PHẦN C (PATCH /by-code, luồng HR_PROFILE, dùng positionKey/node như cũ,
// KHÔNG đổi gì ở luồng đó). POS-TD-UF CỐ Ý KHÔNG tồn tại ở đây (mô phỏng đúng báo cáo người dùng — vị
// trí "Thẩm định ultrafresh" không còn/chưa từng là 1 node thật trong Cơ Cấu Tổ Chức) — chỉ còn 1 node
// POS-IT-01 để PHẦN C vẫn kiểm được luồng HR gán qua Hồ Sơ Nhân Sự.
function buildOrgVersion() {
  return {
    id: 1, status: 'APPLIED',
    nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', departmentRef: null, jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 4, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng IT', departmentRef: 'Phòng IT', jobTitle: null, requiresDept: null, positionKey: null },
      { nodeId: 5, parentNodeId: 4, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Chuyên Viên IT', requiresDept: true, posType: 'HO', positionKey: 'POS-IT-01' }
    ]
  };
}

// Vị Trí Tham Gia Quy Trình (🧭, Hệ Thống > Quyền Đặc Biệt) — danh mục admin tự dựng, nguồn CHO CẢ "Theo
// vị trí" 14 module lẫn Mixed Approval Rules, KHÔNG đòi hỏi node thật trong Cơ Cấu Tổ Chức. Đúng mẫu báo
// cáo người dùng: "Thẩm định ultrafresh" đã cấu hình ở đây (ghép phòng ban) dù KHÔNG có node tương ứng.
function buildWorkflowParticipatingPositions() {
  return [
    { jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' },
    { jobTitle: 'Chuyên Viên IT', dept: 'Phòng IT' }
  ];
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
    APP_DATA = {
      users: USERS, employeeProfiles: [], hrProcesses: [], orgChartVersions: [buildOrgVersion()],
      workflowParticipatingPositions: buildWorkflowParticipatingPositions(),
      jobTitles: [], depts: [], storeJobTitles: [], stores: [], positionTypes: []
    };
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
    // ===== PHẦN A: quyền + hình dạng dữ liệu =====
    await run.run('GET /secondary-position-options — tài khoản KHÔNG có quyền hrSecondaryPositionManage/HR nào -> 403', async () => {
      resetAppData();
      const res = await api('GET', '/api/hr-profile/secondary-position-options?username=emp1', undefined, ADMIN_NO_PERM_AT_ALL);
      assertEqual(res.status, 403);
    });

    await run.run('GET /secondary-position-options — admin CHỈ có hrSecondaryPositionManage, tài khoản KHÔNG liên kết hồ sơ Nhân Sự nào -> vẫn 200 (KHÔNG đòi hồ sơ Nhân Sự)', async () => {
      resetAppData();
      const res = await api('GET', '/api/hr-profile/secondary-position-options?username=emp1', undefined, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 200, 'Route đọc/ghi thẳng user.secondaryPositions, không cần hồ sơ Nhân Sự tồn tại');
      assertEqual(res.body.positions.length, 2, 'Nguồn chọn lấy từ workflowParticipatingPositions (2 cặp đã cấu hình)');
      assertEqual(res.body.current.length, 0);
    });

    await run.run('GET /secondary-position-options — tài khoản KHÔNG tồn tại -> 404 rõ ràng, không crash', async () => {
      resetAppData();
      const res = await api('GET', '/api/hr-profile/secondary-position-options?username=khongTonTai', undefined, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 404);
    });

    await run.run('POST /secondary-positions — bị chặn 403 khi KHÔNG có quyền', async () => {
      resetAppData();
      const res = await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' }] }, ADMIN_NO_PERM_AT_ALL);
      assertEqual(res.status, 403);
    });

    await run.run('POST /secondary-positions — thiếu jobTitle -> 400, báo lỗi rõ', async () => {
      resetAppData();
      const res = await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ dept: 'Phòng IT' }] }, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 400);
      assertIncludes(res.body.error, 'Chức Danh');
    });

    await run.run('POST /secondary-positions — trùng lặp 2 dòng CÙNG (jobTitle, dept) trong chính danh sách gửi lên -> chặn', async () => {
      resetAppData();
      const res = await api('POST', '/api/hr-profile/secondary-positions', {
        username: 'emp1',
        secondaryPositions: [
          { jobTitle: 'Chuyên Viên IT', dept: 'Phòng IT' },
          { jobTitle: 'Chuyên Viên IT', dept: 'Phòng IT' }
        ]
      }, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 400);
    });

    // ===== PHẦN B: trọng tâm bản vá — gán được vị trí KHÔNG có node thật trong Cơ Cấu Tổ Chức, miễn đã
    // có trong Vị Trí Tham Gia Quy Trình — đúng mẫu người dùng báo cáo ("Thẩm định ultrafresh") =====
    await run.run('POST /secondary-positions — gán ĐƯỢC vị trí KHÔNG có node thật trong Cơ Cấu Tổ Chức (chỉ cần có trong Vị Trí Tham Gia Quy Trình) — TRƯỚC ĐÂY bị chặn 400 "Vị trí không tồn tại trong Cơ Cấu Tổ Chức"', async () => {
      resetAppData();
      const res = await api('POST', '/api/hr-profile/secondary-positions', {
        username: 'emp1', secondaryPositions: [{ jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' }]
      }, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 200, 'Gán thành công dù không có node POSITION nào tên "Thẩm định ultrafresh" trong buildOrgVersion()');
      const u = APP_DATA.users.find(x => x.username === 'emp1');
      assertEqual(u.secondaryPositions.length, 1);
      assertEqual(u.secondaryPositions[0].jobTitle, 'Thẩm định ultrafresh');
      assertEqual(u.secondaryPositions[0].dept, 'Phòng Mua Hàng Thực Phẩm Tươi Sống');
    });

    await run.run('GET /secondary-position-options — hiện ĐỦ vị trí kiêm nhiệm CŨ (legacy, gõ tay thẳng trên user.secondaryPositions) ngay trong box, kể cả vị trí không có node thật', async () => {
      resetAppData();
      const res = await api('GET', '/api/hr-profile/secondary-position-options?username=emp2Legacy', undefined, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 200);
      assertEqual(res.body.current.length, 1, 'Vị trí kiêm nhiệm cũ đã có hiện ra NGAY trong box, không cần migrate tay');
      assertEqual(res.body.current[0].jobTitle, 'Thẩm định ultrafresh');
      assertEqual(res.body.current[0].dept, 'Phòng Mua Hàng Thực Phẩm Tươi Sống');
    });

    await run.run('POST /secondary-positions — sau khi admin gán qua box, resolvePositionApprovers() (luồng "Theo vị trí" THẬT dùng cho MỌI quy trình đã có) nhận diện đúng NGAY', async () => {
      resetAppData();
      await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' }] }, ADMIN_NO_HR_PERM);
      const matched = positionApprovers.resolvePositionApprovers(
        [{ jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' }], APP_DATA.users
      );
      assertIncludes(matched, 'emp1', 'resolvePositionApprovers() dùng CHUNG cho mọi quy trình "Theo vị trí" hiện có — tìm thấy emp1 ngay sau khi admin gán qua box, không cần chờ gì thêm');
    });

    await run.run('GET /secondary-position-options — danh mục Vị Trí Tham Gia Quy Trình RỖNG -> fallback tích chéo jobTitles×depts + storeJobTitles×stores', async () => {
      resetAppData();
      APP_DATA.workflowParticipatingPositions = [];
      APP_DATA.jobTitles = ['Trưởng Phòng', 'Nhân Viên'];
      APP_DATA.depts = ['Phòng Kinh Doanh'];
      APP_DATA.storeJobTitles = [{ label: 'Giám Đốc Siêu Thị' }];
      APP_DATA.stores = ['Siêu thị A'];
      const res = await api('GET', '/api/hr-profile/secondary-position-options?username=emp1', undefined, ADMIN_NO_HR_PERM);
      assertEqual(res.status, 200);
      // 2 jobTitles × 1 dept = 2, + 1 storeJobTitle × 1 store = 1 -> 3 cặp.
      assertEqual(res.body.positions.length, 3, 'Fallback tích chéo khi danh mục chính rỗng, đúng hành vi wfPositionPairCatalogItems() phía client');
      assertIncludes(res.body.positions.map(p => p.jobTitle), 'Giám Đốc Siêu Thị');
    });

    // ===== PHẦN C: (3) KHÔNG update ngược lại hồ sơ Nhân Sự + (4) HR lưu hồ sơ sau đó KHÔNG xoá mất —
    // PHẦN NÀY KHÔNG đổi gì (vẫn dùng positionKey/node thật qua PATCH /by-code, luồng HR_PROFILE) =====
    await run.run('POST /secondary-positions — lưu thành công KHÔNG đụng tới employeeProfiles (dù hồ sơ đã liên kết tài khoản này) — HR không thấy thay đổi này', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV300', username: 'emp1' });
      await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' }] }, ADMIN_NO_HR_PERM);
      const freshProfile = APP_DATA.employeeProfiles.find(p => p.employeeCode === 'NV300');
      assertEqual((freshProfile.secondaryPositions || []).length, 0, 'profile.secondaryPositions (field HR thấy ở Chi tiết hồ sơ) không hề bị đụng tới');
      const u = APP_DATA.users.find(x => x.username === 'emp1');
      assertEqual(u.secondaryPositions.length, 1, 'user.secondaryPositions (dùng để chấm "Theo vị trí") vẫn được ghi đúng');
      assertEqual(u.secondaryPositions[0].jobTitle, 'Thẩm định ultrafresh');
    });

    await run.run('PATCH /by-code — HR lưu hồ sơ (sửa field KHÁC, secondaryPositions của HR vẫn RỖNG) SAU KHI admin đã gán qua box -> KHÔNG xoá mất gán của admin (bug thật nếu không merge đúng)', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV300', username: 'emp1' });
      await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' }] }, ADMIN_NO_HR_PERM);
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
      await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' }] }, ADMIN_NO_HR_PERM);
      await api('PATCH', '/api/hr-profile/by-code/NV300', { secondaryPositions: [{ positionKey: 'POS-IT-01' }] }, HR_FULL);
      const u = APP_DATA.users.find(x => x.username === 'emp1');
      assertEqual(u.secondaryPositions.length, 2, 'Cộng dồn: 1 dòng admin gán qua box + 1 dòng HR gán ở Hồ Sơ Nhân Sự, không dòng nào bị mất');
      assertIncludes(u.secondaryPositions.map(sp => sp.jobTitle), 'Thẩm định ultrafresh');
      assertIncludes(u.secondaryPositions.map(sp => sp.jobTitle), 'Chuyên Viên IT');
    });

    await run.run('PATCH /by-code — HR sửa lại khối Kiêm Nhiệm của chính họ (bỏ 1 vị trí) -> chỉ đúng phần HR quản lý bị thay, phần admin gán qua box không đổi', async () => {
      resetAppData();
      seedProfile({ employeeCode: 'NV300', username: 'emp1' });
      await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ jobTitle: 'Thẩm định ultrafresh', dept: 'Phòng Mua Hàng Thực Phẩm Tươi Sống' }] }, ADMIN_NO_HR_PERM);
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
      const postRes = await api('POST', '/api/hr-profile/secondary-positions', { username: 'emp1', secondaryPositions: [{ jobTitle: 'Chuyên Viên IT', dept: 'Phòng IT' }] }, HR_FULL);
      assertEqual(postRes.status, 200);
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL:', e && e.stack || e); process.exit(1); });
