// server/tests/test-hr-onboarding-profile-edit-process-manager.js
//
// Regression test (11/2026, theo yêu cầu người dùng — "tuyển dụng sửa hồ sơ Onboarding trước khi active,
// cần CCCD/BHXH/MST/tài khoản ngân hàng"): mở rộng cơ chế "Xác Nhận" hồ sơ Onboarding (PATCH /api/hr-
// profile/by-code/:code lúc đang PENDING, xem test-hr-onboarding-queue.js cho tầng BASE gốc) thêm 1 tầng
// MỚI — actor có quyền `hrOnboardingProcessManage` ("Toàn Quyền Thao Tác Quy Trình Onboarding") sửa ĐƯỢC
// RỘNG hơn tầng BASE (hrOnboardingManage cũ): thêm nationalId/socialInsuranceNo/taxCode/bankAccountNo/
// bankName/bankAccountHolderName (giấy tờ onboarding cơ bản), nhưng VẪN bị chặn disciplinaryActions/
// transfers/secondaryPositions/profileEditHistory/rehireHistory (field quản lý vòng đời nhân sự, không
// áp dụng được cho người CHƯA active).
//
// Bài test này CŨNG xác nhận 1 lỗ hổng ĐỌC đã được vá NGAY TRONG ĐỢT NÀY: GET /api/hr-profile/by-code và
// /by-username trước đây KHÔNG redact gì cho actor chỉ có hrOnboardingManage/hrOnboardingProcessManage
// (hasAdminProfileAccess() trả FULL, getProfileForViewer() trả nguyên profile) — dù PATCH đã redact từ
// đợt "re-audit lần 7". Nay cả 2 route GET đều dùng resolveOnboardingQueueBypassTier() để redact đúng
// tầng trước khi trả về.
//
// Chạy: node server/tests/test-hr-onboarding-profile-edit-process-manager.js
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
// Tầng BASE (cũ) — CHỈ hrOnboardingManage, không có hrOnboardingProcessManage.
const HR_ONBOARD_BASE = { username: 'hronb1', name: 'Phụ Trách Onboarding (Base)', dept: 'Phòng Nhân Sự', perms: { hrOnboardingManage: true }, active: true };
// Tầng PROCESS_MANAGER (MỚI) — CHỈ hrOnboardingProcessManage (không kèm hrOnboardingManage), để xác nhận
// quyền mạnh hơn ĐỦ để tự nó mở ra đường bypass, không cần cả 2 quyền cùng lúc.
const RECRUIT_PM = { username: 'tuyendung1', name: 'Tuyển Dụng (Process Manager)', dept: 'Phòng Nhân Sự', perms: { hrOnboardingProcessManage: true }, active: true };
const EMP1 = { username: 'emp1', name: 'Nhân Viên Một', dept: 'Phòng Kinh Doanh', perms: {}, active: true };
let USERS = [ADMIN, HR_MGR, HR_ONBOARD_BASE, RECRUIT_PM, EMP1];

let APP_DATA;
function resetAppData() {
  APP_DATA = { users: USERS, employeeProfiles: [] };
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
  getAllForCollection: async () => [],
  withLockedRecordForCollection: async (collection, id, mutatorFn) => { throw new Error('not used in this test'); }
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
const { createRunner, assertEqual } = require('./testHarness');
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

const SENSITIVE_BASE_RESTRICTED = ['nationalId', 'socialInsuranceNo', 'taxCode', 'bankAccountNo', 'bankName', 'bankAccountHolderName'];
const LIFECYCLE_ALWAYS_RESTRICTED = ['disciplinaryActions', 'transfers', 'secondaryPositions', 'profileEditHistory', 'rehireHistory'];

function seedQueuedProfile(employeeCode, overrides) {
  const profile = Object.assign(employeeProfile.defaultProfile(employeeCode), {
    onboardingQueueStatus: 'PENDING',
    nationalId: '079099001111', socialInsuranceNo: 'BH001', taxCode: 'MST001',
    bankAccountNo: '00112233', bankName: 'Ngân hàng Cũ', bankAccountHolderName: 'Nguyễn Văn Cũ',
    disciplinaryActions: [{ id: 'd1', type: 'Cảnh cáo' }],
    transfers: [{ id: 't1', type: 'Điều động' }],
    secondaryPositions: [{ jobTitle: 'Trưởng nhóm', dept: 'Phòng Kinh Doanh' }],
    profileEditHistory: [{ by: 'hr1', time: 'x' }], rehireHistory: [{ rehiredBy: 'hr1' }]
  }, overrides || {});
  APP_DATA.employeeProfiles.push(profile);
  return profile;
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('PROCESS_MANAGER: PATCH hồ sơ PENDING sửa ĐƯỢC nationalId/BHXH/MST/ngân hàng, response KHÔNG redact các field này', async () => {
      resetAppData();
      seedQueuedProfile('NV001');
      const res = await api('PATCH', '/api/hr-profile/by-code/NV001', {
        dateOfBirth: '1995-05-05',
        nationalId: '079099999999', socialInsuranceNo: 'BH999', taxCode: 'MST999',
        bankAccountNo: '00199999', bankName: 'Ngân hàng Mới', bankAccountHolderName: 'Nguyễn Văn Mới'
      }, RECRUIT_PM);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(res.body.profile.dateOfBirth, '1995-05-05', 'Field thường vẫn sửa được');
      for (const f of SENSITIVE_BASE_RESTRICTED) {
        assertEqual(f in res.body.profile, true, `Field "${f}" PHẢI xuất hiện trong response cho PROCESS_MANAGER (không bị redact)`);
      }
      assertEqual(res.body.profile.nationalId, '079099999999', 'nationalId được ghi đè đúng giá trị mới');
      assertEqual(res.body.profile.taxCode, 'MST999', 'taxCode được ghi đè đúng giá trị mới');
      assertEqual(res.body.profile.bankAccountNo, '00199999', 'bankAccountNo được ghi đè đúng giá trị mới');
      // "Xác Nhận" vẫn chuyển CONFIRMED + ACTIVE như tầng BASE (hành vi KHÔNG đổi).
      assertEqual(res.body.profile.onboardingQueueStatus, 'CONFIRMED', 'Vẫn chuyển CONFIRMED như tầng BASE');
      assertEqual(res.body.profile.status, 'ACTIVE', 'Vẫn chuyển ACTIVE như tầng BASE');
    });

    await run.run('PROCESS_MANAGER: VẪN bị chặn sửa kỷ luật/bổ nhiệm/vị trí kiêm nhiệm/lịch sử (field vòng đời, không áp dụng trước khi active)', async () => {
      resetAppData();
      seedQueuedProfile('NV001');
      const res = await api('PATCH', '/api/hr-profile/by-code/NV001', {
        dateOfBirth: '1995-05-05',
        disciplinaryActions: [], transfers: [], secondaryPositions: [{ jobTitle: 'Giám Đốc', dept: 'Ban Giám Đốc' }]
      }, RECRUIT_PM);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      for (const f of LIFECYCLE_ALWAYS_RESTRICTED) {
        assertEqual(f in res.body.profile, false, `Field "${f}" KHÔNG được xuất hiện trong response cho PROCESS_MANAGER`);
      }
      const asHrMgr = await api('GET', '/api/hr-profile/by-code/NV001', undefined, HR_MGR);
      assertEqual(asHrMgr.body.profile.disciplinaryActions.length, 1, 'disciplinaryActions KHÔNG bị ghi đè bởi PROCESS_MANAGER');
      assertEqual(asHrMgr.body.profile.secondaryPositions[0].jobTitle, 'Trưởng nhóm', 'secondaryPositions giữ ĐÚNG giá trị gốc, không bị đổi sang giá trị tấn công');
    });

    await run.run('ĐỐI CHỨNG — tầng BASE (hrOnboardingManage, KHÔNG có hrOnboardingProcessManage) VẪN bị chặn y hệt trước đây (không bị nới quyền lây)', async () => {
      resetAppData();
      seedQueuedProfile('NV001');
      const res = await api('PATCH', '/api/hr-profile/by-code/NV001', {
        dateOfBirth: '1995-05-05',
        nationalId: 'HACKED', taxCode: 'HACKED', bankAccountNo: 'HACKED'
      }, HR_ONBOARD_BASE);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      for (const f of [...SENSITIVE_BASE_RESTRICTED, ...LIFECYCLE_ALWAYS_RESTRICTED]) {
        assertEqual(f in res.body.profile, false, `Tầng BASE: field "${f}" vẫn PHẢI bị redact như cũ`);
      }
      const asHrMgr = await api('GET', '/api/hr-profile/by-code/NV001', undefined, HR_MGR);
      assertEqual(asHrMgr.body.profile.nationalId, '079099001111', 'Tầng BASE: nationalId KHÔNG bị ghi đè (giữ hành vi cũ)');
    });

    await run.run('PROCESS_MANAGER-only KHÔNG sửa được hồ sơ đã CONFIRMED/hồ sơ thường (không còn PENDING = đã "active")', async () => {
      resetAppData();
      seedQueuedProfile('NV001', { onboardingQueueStatus: 'CONFIRMED', status: 'ACTIVE' });
      const res = await api('PATCH', '/api/hr-profile/by-code/NV001', { dateOfBirth: '1995-05-05' }, RECRUIT_PM);
      assertEqual(res.status, 403, 'Không phải PENDING -> đúng yêu cầu "sau khi active chỉ có ql nhân sự sửa"');
    });

    await run.run('LỖI ĐÃ VÁ (đợt này): GET /by-code trước đây KHÔNG redact gì cho actor onboarding-only — nay redact đúng tầng PROCESS_MANAGER', async () => {
      resetAppData();
      seedQueuedProfile('NV001');
      const res = await api('GET', '/api/hr-profile/by-code/NV001', undefined, RECRUIT_PM);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(res.body.viewMode, 'FULL', 'viewMode vẫn FULL (đọc được field cơ bản + giấy tờ onboarding)');
      for (const f of SENSITIVE_BASE_RESTRICTED) {
        assertEqual(f in res.body.profile, true, `GET: field "${f}" PHẢI đọc được (tầng PROCESS_MANAGER)`);
      }
      for (const f of LIFECYCLE_ALWAYS_RESTRICTED) {
        assertEqual(f in res.body.profile, false, `GET: field "${f}" KHÔNG được lộ cho PROCESS_MANAGER`);
      }
    });

    await run.run('LỖI ĐÃ VÁ (đợt này): GET /by-code tầng BASE redact ĐẦY ĐỦ (cả giấy tờ onboarding lẫn field vòng đời) — trước đây lộ hết', async () => {
      resetAppData();
      seedQueuedProfile('NV001');
      const res = await api('GET', '/api/hr-profile/by-code/NV001', undefined, HR_ONBOARD_BASE);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      for (const f of [...SENSITIVE_BASE_RESTRICTED, ...LIFECYCLE_ALWAYS_RESTRICTED]) {
        assertEqual(f in res.body.profile, false, `GET: tầng BASE field "${f}" KHÔNG được lộ (lỗ hổng đọc đã vá)`);
      }
    });

    await run.run('GET /by-username cũng redact đúng tầng (mirror /by-code) — cần liên kết username trước', async () => {
      resetAppData();
      seedQueuedProfile('NV001', { username: 'ungvien1' });
      const linked = USERS.concat([{ username: 'ungvien1', name: 'Ứng Viên 1', dept: 'Phòng Kinh Doanh', perms: {}, active: true }]);
      APP_DATA.users = linked;
      const res = await api('GET', '/api/hr-profile/by-username/ungvien1', undefined, RECRUIT_PM);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      for (const f of SENSITIVE_BASE_RESTRICTED) {
        assertEqual(f in res.body.profile, true, `GET by-username: field "${f}" PHẢI đọc được (tầng PROCESS_MANAGER)`);
      }
      for (const f of LIFECYCLE_ALWAYS_RESTRICTED) {
        assertEqual(f in res.body.profile, false, `GET by-username: field "${f}" KHÔNG được lộ`);
      }
    });

    await run.run('ĐỐI CHỨNG: HR thật (hrProfileManage) KHÔNG bị ảnh hưởng — vẫn xem/sửa đầy đủ như cũ ở cả PATCH lẫn GET', async () => {
      resetAppData();
      seedQueuedProfile('NV001');
      const patchRes = await api('PATCH', '/api/hr-profile/by-code/NV001', {
        nationalId: '079099003333', disciplinaryActions: [{ id: 'd2', type: 'Khiển trách', date: '2026-01-01' }]
      }, HR_MGR);
      assertEqual(patchRes.status, 200, JSON.stringify(patchRes.body));
      assertEqual(patchRes.body.profile.nationalId, '079099003333', 'HR thật vẫn sửa được nationalId như cũ');
      assertEqual(patchRes.body.profile.disciplinaryActions.length, 1, 'HR thật vẫn sửa được disciplinaryActions như cũ');
      const getRes = await api('GET', '/api/hr-profile/by-code/NV001', undefined, HR_MGR);
      assertEqual('disciplinaryActions' in getRes.body.profile, true, 'HR thật vẫn ĐỌC được disciplinaryActions như cũ (không bị redact nhầm)');
    });

    await run.run('Người có CẢ 2 quyền (hrOnboardingManage + hrOnboardingProcessManage): PROCESS_MANAGER quyết định phạm vi (quyền mạnh hơn thắng)', async () => {
      resetAppData();
      seedQueuedProfile('NV001');
      const both = { username: 'both1', name: 'Cả Hai Quyền', dept: 'Phòng Nhân Sự', perms: { hrOnboardingManage: true, hrOnboardingProcessManage: true }, active: true };
      USERS.push(both);
      APP_DATA.users = USERS;
      const res = await api('PATCH', '/api/hr-profile/by-code/NV001', { taxCode: 'MST-BOTH' }, both);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual('taxCode' in res.body.profile, true, 'Có cả 2 quyền -> dùng phạm vi RỘNG của PROCESS_MANAGER, không bị thu hẹp lại BASE');
      assertEqual(res.body.profile.taxCode, 'MST-BOTH', 'taxCode được ghi đè đúng');
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch((e) => { console.error('💥 Test lỗi:', e); process.exitCode = 1; });
