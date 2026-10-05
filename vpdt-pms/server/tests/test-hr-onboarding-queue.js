// server/tests/test-hr-onboarding-queue.js
//
// Regression test cho "Ảnh 2" (9/2026, theo yêu cầu người dùng) — tab "🕐 Hồ Sơ Onboarding"
// (module-hrprofile.js) hoạt động như hàng đợi cho hồ sơ nháp vừa đặt chỗ lúc tạo Onboarding:
//   - onboardingQueueStatus='PENDING' -> KHÔNG hiện ở "Quản Lý Hồ Sơ" (GET /api/hr-profile), CHỈ hiện ở
//     GET /api/hr-profile/onboarding-queue (gác riêng hrOnboardingManage, KHÔNG dùng hrProfileManage).
//   - "Hủy" (POST .../onboarding-queue/cancel): bắt buộc lý do, chuyển CANCELLED — hồ sơ VẪN Ở LẠI hàng
//     đợi (không xoá) + cascade huỷ hrProcesses ONBOARDING liên kết (nếu còn IN_PROGRESS).
//   - "Xác Nhận" (PATCH /api/hr-profile/by-code/:code lúc đang PENDING): người CHỈ có hrOnboardingManage
//     (không có bất kỳ quyền Hồ Sơ Nhân Sự nào) vẫn lưu được — sau khi lưu, onboardingQueueStatus->
//     'CONFIRMED' (KHÁC trước đây là null) + status->'ACTIVE' ngay, hồ sơ lọt vào Quản Lý Hồ Sơ ĐỒNG
//     THỜI vẫn GIỮ LẠI ở hàng đợi Onboarding (cập nhật 10/2026, theo yêu cầu người dùng, phục vụ báo
//     cáo "ai đã nhận việc qua đúng quy trình"). Người này KHÔNG sửa được hồ sơ ngoài hàng đợi PENDING.
//   - Sort: GET .../onboarding-queue luôn trả MỚI TẠO TRƯỚC (createdAt giảm dần).
//
// Chạy: node server/tests/test-hr-onboarding-queue.js
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

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const HR_MGR = { username: 'hr1', name: 'Nhân Sự Trưởng', dept: 'Phòng Nhân Sự', perms: { hrProfileManage: true }, active: true };
// CHỈ hrOnboardingManage (KHÔNG có bất kỳ quyền Hồ Sơ Nhân Sự nào) — đúng đối tượng chính của Ảnh 2.
const HR_ONBOARD = { username: 'hronb1', name: 'Phụ Trách Onboarding', dept: 'Phòng Nhân Sự', perms: { hrOnboardingManage: true }, active: true };
const EMP1 = { username: 'emp1', name: 'Nhân Viên Một', dept: 'Phòng Kinh Doanh', perms: {}, active: true };
let USERS = [ADMIN, HR_MGR, HR_ONBOARD, EMP1];

let APP_DATA;
let HR_PROCESSES;
function resetAppData() {
  APP_DATA = { users: USERS, employeeProfiles: [] };
  HR_PROCESSES = [];
}
resetAppData();

let PORT = 0;
let CURRENT_USERNAME = ADMIN.username;

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAllAppData: async () => APP_DATA,
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

stubModule('lib/recordStore', {
  getAllForCollection: async (collection) => (collection === 'hrProcesses' ? HR_PROCESSES.slice() : []),
  withLockedRecordForCollection: async (collection, id, mutatorFn) => {
    const list = collection === 'hrProcesses' ? HR_PROCESSES : [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) throw new Error('Không tìm thấy bản ghi');
    list[idx] = await mutatorFn(list[idx]);
    return list[idx];
  }
});

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const { createRunner, assertEqual, assert } = require('./testHarness');
const employeeProfileRoutes = require('../routes/employeeProfile');
const employeeProfile = require('../lib/employeeProfile');

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
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

// Seed 1 hồ sơ DRAFT ở hàng đợi (PENDING), y hệt hook thật ở routes/create.js sau khi tạo Onboarding.
function seedQueuedProfile(employeeCode, processId, overrides) {
  const profile = Object.assign(employeeProfile.defaultProfile(employeeCode), {
    processId, onboardingQueueStatus: 'PENDING'
  }, overrides || {});
  APP_DATA.employeeProfiles.push(profile);
  HR_PROCESSES.push({
    id: processId, processType: 'ONBOARDING', status: 'IN_PROGRESS', employeeCode,
    fullName: 'Ứng Viên ' + employeeCode, creator: 'hr1', history: []
  });
  return profile;
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('Sau khi tạo Onboarding: hồ sơ PENDING KHÔNG hiện ở GET /api/hr-profile (Quản Lý Hồ Sơ)', async () => {
      resetAppData();
      seedQueuedProfile('NV001', 1);
      const res = await api('GET', '/api/hr-profile', undefined, HR_MGR);
      assertEqual(res.status, 200, 'HR_MGR gọi GET / thành công');
      assertEqual(res.body.profiles.some(p => p.employeeCode === 'NV001'), false, 'Hồ sơ PENDING phải bị lọc khỏi Quản Lý Hồ Sơ');
    });

    await run.run('GET /onboarding-queue — 403 nếu không có hrOnboardingManage (kể cả hrProfileManage)', async () => {
      resetAppData();
      seedQueuedProfile('NV001', 1);
      const asHrMgr = await api('GET', '/api/hr-profile/onboarding-queue', undefined, HR_MGR);
      assertEqual(asHrMgr.status, 403, 'hrProfileManage KHÔNG đủ — phải có đúng hrOnboardingManage');
      const asEmp = await api('GET', '/api/hr-profile/onboarding-queue', undefined, EMP1);
      assertEqual(asEmp.status, 403, 'Nhân viên thường bị chặn');
    });

    await run.run('GET /onboarding-queue — hrOnboardingManage xem được, luôn MỚI TẠO TRƯỚC', async () => {
      resetAppData();
      seedQueuedProfile('NV001', 1, { createdAt: '10:00:00 1/1/2026' });
      seedQueuedProfile('NV002', 2, { createdAt: '10:00:00 2/1/2026' }); // tạo sau -> phải lên đầu
      const res = await api('GET', '/api/hr-profile/onboarding-queue', undefined, HR_ONBOARD);
      assertEqual(res.status, 200, 'hrOnboardingManage xem được hàng đợi');
      assertEqual(res.body.profiles.length, 2, 'Đủ 2 hồ sơ đang PENDING');
      assertEqual(res.body.profiles[0].employeeCode, 'NV002', 'Mới tạo (2/1) phải lên đầu, trước 1/1');
      assertEqual(res.body.profiles[1].employeeCode, 'NV001', 'Tạo trước (1/1) xếp sau');
      assertEqual(res.body.profiles[0].processId, 2, 'Trả kèm processId để client suy tên ứng viên từ DB.hrProcesses');
    });

    await run.run('Hủy hàng đợi: 403 nếu không có hrOnboardingManage; 400 nếu thiếu lý do', async () => {
      resetAppData();
      seedQueuedProfile('NV001', 1);
      const asEmp = await api('POST', '/api/hr-profile/by-code/NV001/onboarding-queue/cancel', { reason: 'Không tới nhận việc' }, EMP1);
      assertEqual(asEmp.status, 403, 'Nhân viên thường không hủy được');
      const noReason = await api('POST', '/api/hr-profile/by-code/NV001/onboarding-queue/cancel', {}, HR_ONBOARD);
      assertEqual(noReason.status, 400, 'Thiếu lý do -> 400');
    });

    await run.run('Hủy hàng đợi hợp lệ: CANCELLED + GIỮ LẠI hồ sơ + cascade hủy hrProcesses liên kết', async () => {
      resetAppData();
      seedQueuedProfile('NV001', 1);
      const res = await api('POST', '/api/hr-profile/by-code/NV001/onboarding-queue/cancel', { reason: 'Ứng viên không tới nhận việc' }, HR_ONBOARD);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(res.body.profile.onboardingQueueStatus, 'CANCELLED', 'Chuyển CANCELLED');
      assertEqual(res.body.profile.onboardingQueueCancelReason, 'Ứng viên không tới nhận việc', 'Lưu đúng lý do');
      assertEqual(APP_DATA.employeeProfiles.some(p => p.employeeCode === 'NV001'), true, 'Hồ sơ VẪN CÒN — KHÔNG bị xoá (khác nút Hủy Quy Trình cũ)');
      assertEqual(HR_PROCESSES.find(p => p.id === 1).status, 'CANCELLED', 'Quy trình Onboarding liên kết cũng bị hủy theo (cascade)');

      // Hủy lần 2 khi đã CANCELLED -> 400 (không còn PENDING).
      const again = await api('POST', '/api/hr-profile/by-code/NV001/onboarding-queue/cancel', { reason: 'Thử lại' }, HR_ONBOARD);
      assertEqual(again.status, 400, 'Không hủy lại được hồ sơ đã CANCELLED');

      // Vẫn còn trong danh sách hàng đợi (để báo cáo), không rơi khỏi GET .../onboarding-queue.
      const queue = await api('GET', '/api/hr-profile/onboarding-queue', undefined, HR_ONBOARD);
      assertEqual(queue.body.profiles.some(p => p.employeeCode === 'NV001' && p.onboardingQueueStatus === 'CANCELLED'), true, 'Vẫn hiện ở hàng đợi với trạng thái Đã hủy');
    });

    await run.run('"Xác Nhận": hrOnboardingManage-only SỬA + LƯU được hồ sơ PENDING -> CONFIRMED (đã nhận việc), VẪN giữ ở hàng đợi + hiện thêm ở Quản Lý Hồ Sơ', async () => {
      // CẬP NHẬT (10/2026, theo yêu cầu người dùng): "Xác Nhận" KHÔNG còn reset onboardingQueueStatus về
      // null như trước — chuyển sang 'CONFIRMED' (đã nhận việc) + status='ACTIVE' NGAY, hồ sơ VẪN hiện ở
      // tab "🕐 Hồ Sơ Onboarding" (giống hồ sơ CANCELLED, phục vụ báo cáo) ĐỒNG THỜI lọt vào "Quản Lý Hồ
      // Sơ" — 2 màn tách biệt nhưng cùng 1 bản ghi duy nhất. Xem PATCH /by-code/:employeeCode (routes/
      // employeeProfile.js) + chú thích onboardingQueueStatus ở defaultProfile() (lib/employeeProfile.js).
      resetAppData();
      seedQueuedProfile('NV001', 1);
      const res = await api('PATCH', '/api/hr-profile/by-code/NV001', { dateOfBirth: '1995-05-05' }, HR_ONBOARD);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(res.body.profile.onboardingQueueStatus, 'CONFIRMED', 'Lưu thành công lúc PENDING -> CONFIRMED (đã nhận việc)');
      assertEqual(res.body.profile.status, 'ACTIVE', 'status chuyển ACTIVE ngay lúc Xác Nhận');
      assertEqual(res.body.profile.dateOfBirth, '1995-05-05', 'Field vừa sửa được lưu đúng');

      // Hồ sơ CONFIRMED hiện ở CẢ 2 nơi: Quản Lý Hồ Sơ (đã "tốt nghiệp" khỏi trạng thái DRAFT/PENDING)
      // VÀ vẫn ở hàng đợi Onboarding (để báo cáo ai đã nhận việc qua đúng quy trình này).
      const managed = await api('GET', '/api/hr-profile', undefined, HR_MGR);
      assertEqual(managed.body.profiles.some(p => p.employeeCode === 'NV001'), true, 'Đã hiện ở Quản Lý Hồ Sơ');
      const queue = await api('GET', '/api/hr-profile/onboarding-queue', undefined, HR_ONBOARD);
      assertEqual(queue.body.profiles.some(p => p.employeeCode === 'NV001' && p.onboardingQueueStatus === 'CONFIRMED'), true, 'Vẫn hiện ở hàng đợi với trạng thái Đã nhận việc');
    });

    await run.run('hrOnboardingManage-only KHÔNG sửa được hồ sơ đã CONFIRMED/hồ sơ thường (không còn PENDING)', async () => {
      resetAppData();
      seedQueuedProfile('NV001', 1, { onboardingQueueStatus: 'CONFIRMED', status: 'ACTIVE' }); // đã Xác Nhận từ trước
      const res = await api('PATCH', '/api/hr-profile/by-code/NV001', { dateOfBirth: '1995-05-05' }, HR_ONBOARD);
      assertEqual(res.status, 403, 'Không phải PENDING -> vẫn cần hrProfileManage/hrProfileEdit như bình thường');
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch((e) => { console.error('💥 Test lỗi:', e); process.exitCode = 1; });
