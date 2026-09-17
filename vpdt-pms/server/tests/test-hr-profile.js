// server/tests/test-hr-profile.js
//
// Regression test cho "Nhân Sự > Hồ Sơ Nhân Sự" (Đợt 1/4 module Nhân Sự) — xem
// lib/employeeProfile.js/routes/employeeProfile.js. Cùng khuôn tests/test-orgchart-v2.js (dedicated
// router — không đi qua GET /api/data chung, không cần mock trong tests/testHarness.js):
//
//   PHẦN A (server, chạy thẳng express router THẬT routes/employeeProfile.js — KHÔNG mở Playwright,
//   chỉ giả lập tầng lưu trữ lib/appData + middleware xác thực lib/auth):
//     1. GET /me — 404 nếu tài khoản chưa liên kết hồ sơ nào; 200 + đủ field (kể cả nhạy cảm) nếu đã
//        liên kết (chính chủ luôn xem đủ).
//     2. PATCH /me — chính chủ sửa được SELF_EDITABLE_FIELDS; gửi kèm field HR-only (nationalId) bị
//        server ÂM THẦM bỏ qua (không lỗi, nhưng không đổi giá trị — applyProfileEdit() chỉ nhận field
//        trong allowedFields truyền vào).
//     3. GET / — chỉ hrProfileManage/admin; nhân viên thường/quản lý trực tiếp (chỉ hrProfileView) bị 403.
//     4. GET /by-code/:code — hrProfileManage/admin xem ĐẦY ĐỦ; quản lý trực tiếp (hrProfileView, đúng
//        cây quản lý qua managerUsername) xem BẢN GIỚI HẠN (không có nationalId/dependents/...); người
//        không liên quan (không phải quản lý, không có quyền) -> 404 (không lộ "có hồ sơ nhưng không có
//        quyền" khác với "không tồn tại").
//     5. PATCH /by-code/:code — chỉ hrProfileManage/admin; sửa được CẢ field HR-only (nationalId).
//     6. PATCH /by-code/:code/status — chỉ hrProfileManage/admin; chỉ chuyển ACTIVE<->ON_LEAVE (DRAFT/
//        INACTIVE bị chặn, xem assertValidManualStatusTransition()).
//     7. POST /by-code/:code/link-account — chỉ hrProfileManage/admin; chặn liên kết trùng (2 hồ sơ cùng
//        1 username, hoặc hồ sơ đã có username rồi liên kết lại).
//     8. GET /by-username/:username — CÙNG quyền/hành vi như /by-code (chỉ khác điểm tra cứu) — dùng cho
//        quản lý trực tiếp không có hrProfileManage (không gọi được GET / để tự tra employeeCode).
//     8b. POST / — tạo tay hồ sơ MỚI cho nhân viên cũ (chưa qua Onboarding): chỉ hrProfileManage/admin;
//        status luôn ACTIVE ngay; trùng employeeCode/username bị chặn; username không phải tài khoản đang
//        hoạt động bị chặn.
//     8c. POST /bulk-import — nhập hàng loạt (atomic, 1 giao dịch): dòng hợp lệ tạo được, dòng employeeCode
//        trùng (với dữ liệu đã có HOẶC trùng ngay trong payload) bị skip kèm lý do, không làm hỏng các
//        dòng hợp lệ khác.
//     8d. GET /import-template, POST /parse-import (upload xlsx thật), GET /export-xlsx — quyền
//        hrProfileManage/admin; parse-import đọc đúng file mẫu (đã điền) trả về preview đúng cờ valid.
//
//   PHẦN B (gọi thẳng các hàm THẬT trong lib/employeeProfile.js qua require()):
//     9. ensureDraftProfile(): tạo DRAFT mới, idempotent (gọi lại không tạo trùng).
//    10. applyProcessCompletion(): ONBOARDING hoàn tất -> ACTIVE (tra theo employeeCode); OFFBOARDING
//        hoàn tất -> INACTIVE (tra theo employeeUsername).
//    11. linkAccount(): gán username hợp lệ; lỗi nếu hồ sơ không tồn tại/đã liên kết/username đã dùng.
//    12. assertValidManualStatusTransition(): DRAFT/INACTIVE không chuyển tay được; ACTIVE<->ON_LEAVE OK.
//
// Chạy: node server/tests/test-hr-profile.js
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
// Quản lý trực tiếp của EMP1 (managerUsername trỏ đúng) — chỉ có hrProfileView (KHÔNG có hrProfileManage).
const DIRECT_MGR = { username: 'mgr1', name: 'Trưởng Phòng KD', dept: 'Phòng Kinh Doanh', perms: { hrProfileView: true }, active: true };
const EMP1 = { username: 'emp1', name: 'Nhân Viên Một', dept: 'Phòng Kinh Doanh', managerUsername: 'mgr1', perms: {}, active: true };
const OUTSIDER = { username: 'nv2', name: 'Người Ngoài Cuộc', dept: 'Kế Toán', managerUsername: null, perms: {}, active: true };
// CHỈ hrContractManage (KHÔNG có hrProfileManage) — dùng để test GET /employee-directory mở quyền rộng hơn
// GET / (module-hopdonglaodong.js cần tra được mã nhân viên dù không có hrProfileManage).
const HR_CONTRACT_MGR = { username: 'hrc1', name: 'Phụ Trách Hợp Đồng LĐ', dept: 'Phòng Nhân Sự', perms: { hrContractManage: true }, active: true };
// 3 quyền chi tiết mới (9/2026) — mỗi tài khoản CHỈ có đúng 1 quyền để test tách bạch rõ ràng.
const HR_CREATE_ONLY = { username: 'hrcre1', name: 'Chỉ Tạo Hồ Sơ', dept: 'Phòng Nhân Sự', perms: { hrProfileCreate: true }, active: true };
const HR_FULLVIEW_ONLY = { username: 'hrview1', name: 'Chỉ Xem Toàn Bộ', dept: 'Phòng Nhân Sự', perms: { hrProfileFullView: true }, active: true };
const HR_EDIT_ONLY = { username: 'hredit1', name: 'Chỉ Sửa Hồ Sơ', dept: 'Phòng Nhân Sự', perms: { hrProfileEdit: true }, active: true };
let USERS = [ADMIN, HR_MGR, DIRECT_MGR, EMP1, OUTSIDER, HR_CONTRACT_MGR, HR_CREATE_ONLY, HR_FULLVIEW_ONLY, HR_EDIT_ONLY];

let APP_DATA;
function resetAppData() {
  APP_DATA = { users: USERS, employeeProfiles: [], hrProcesses: [] };
}
resetAppData();

let PORT = 0;
let CURRENT_USERNAME = ADMIN.username;

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAllAppData: async () => APP_DATA,
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
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
const { createRunner, assertEqual, assertIncludes, assert } = require('./testHarness');
const employeeProfileRoutes = require('../routes/employeeProfile');
const employeeProfile = require('../lib/employeeProfile');
const employeeProfileImport = require('../lib/employeeProfileImport');

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

// Upload thật 1 buffer .xlsx (multipart/form-data) — dùng cho POST /parse-import. Cùng cách dùng
// FormData/Blob gốc của Node (>=18) như test-payment.js dùng Playwright cho file thật, chỉ khác đây là
// gọi thẳng fetch không qua trình duyệt.
async function apiUpload(urlPath, buffer, fileName, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, { method: 'POST', body: form });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

function seedLinkedProfile(overrides) {
  const profile = Object.assign(employeeProfile.defaultProfile('NV001'), {
    username: 'emp1', status: 'ACTIVE'
  }, overrides || {});
  APP_DATA.employeeProfiles.push(profile);
  return profile;
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('GET /me — 404 nếu chưa liên kết hồ sơ nào', async () => {
      resetAppData();
      const res = await api('GET', '/api/hr-profile/me', undefined, EMP1);
      assertEqual(res.status, 404, 'Chưa liên kết hồ sơ -> 404');
    });

    await run.run('GET /me — mặc định OPT-IN, KHÔNG field nhạy cảm nào hiện tới khi HR/admin cấu hình mở (9/2026)', async () => {
      resetAppData();
      seedLinkedProfile({ nationalId: '079123456789', dateOfBirth: '1990-01-01' });
      const res = await api('GET', '/api/hr-profile/me', undefined, EMP1);
      assertEqual(res.status, 200, 'Đã liên kết -> 200');
      assertEqual('nationalId' in res.body.profile, false, 'Mặc định KHÔNG cấu hình gì -> chính chủ KHÔNG thấy nationalId (opt-in, kể cả field vốn "luôn thấy" trước đây)');
      assertEqual('dateOfBirth' in res.body.profile, false, 'Mặc định KHÔNG cấu hình gì -> chính chủ KHÔNG thấy dateOfBirth');
      assertEqual(res.body.selfVisibleFields.length, 0, 'Tín hiệu selfVisibleFields trả kèm phải rỗng khi chưa cấu hình');
      assertEqual(res.body.profile.employeeCode, 'NV001', 'Field định danh/hệ thống (không nằm trong SENSITIVE_FIELDS) vẫn LUÔN hiện, không bị opt-in chi phối');

      // Sau khi HR/admin mở field 'dateOfBirth' qua PUT /self-field-config: chính chủ THẤY dateOfBirth
      // nhưng VẪN KHÔNG thấy nationalId (chỉ field được tick mới mở, không mở tất cả).
      await api('PUT', '/api/hr-profile/self-field-config', { visibleFields: ['dateOfBirth'] }, HR_MGR);
      const afterCfg = await api('GET', '/api/hr-profile/me', undefined, EMP1);
      assertEqual(afterCfg.body.profile.dateOfBirth, '1990-01-01', 'Sau khi cấu hình mở: chính chủ phải thấy dateOfBirth');
      assertEqual('nationalId' in afterCfg.body.profile, false, 'Sau khi cấu hình: VẪN không thấy nationalId (chưa mở field này)');
      assertEqual(afterCfg.body.selfVisibleFields[0], 'dateOfBirth', 'Tín hiệu selfVisibleFields phải khớp đúng cấu hình vừa lưu');
    });

    await run.run('PATCH /me — field ĐANG BỊ ẨN (chưa mở qua selfVisibleFields) KHÔNG tự sửa được, đối xứng đúng phần không xem được ở GET /me (9/2026)', async () => {
      resetAppData();
      seedLinkedProfile({ nationalId: '079123456789', permanentAddress: 'Địa chỉ cũ' });
      // Chưa cấu hình gì -> permanentAddress (dù nằm trong SELF_EDITABLE_FIELDS) đang bị ẩn -> gửi lên vẫn
      // bị bỏ qua ÂM THẦM, giữ nguyên giá trị cũ (phòng request tự soạn/DevTools sửa tay field đã ẩn khỏi UI).
      const blocked = await api('PATCH', '/api/hr-profile/me',
        { permanentAddress: '123 Đường ABC', nationalId: '000000000000' }, EMP1);
      assertEqual(blocked.status, 200, 'Chính chủ PATCH hồ sơ mình vẫn trả 200 dù field bị bỏ qua (không lỗi)');
      const hrCheckBefore = await api('GET', '/api/hr-profile/by-code/NV001', undefined, HR_MGR);
      assertEqual(hrCheckBefore.body.profile.permanentAddress, 'Địa chỉ cũ', 'permanentAddress chưa được mở cho chính chủ -> KHÔNG được sửa qua PATCH /me, giữ nguyên giá trị cũ');
      assertEqual(hrCheckBefore.body.profile.nationalId, '079123456789', 'nationalId (HR-only) KHÔNG được đổi qua PATCH /me');

      // Sau khi HR/admin mở field 'permanentAddress' cho chính chủ: PATCH /me giờ mới sửa được field này.
      await api('PUT', '/api/hr-profile/self-field-config', { visibleFields: ['permanentAddress'] }, HR_MGR);
      const allowed = await api('PATCH', '/api/hr-profile/me', { permanentAddress: '123 Đường ABC' }, EMP1);
      assertEqual(allowed.status, 200, 'Sau khi mở field: PATCH /me phải thành công');
      assertEqual(allowed.body.profile.permanentAddress, '123 Đường ABC', 'Field đã mở -> phải sửa được VÀ thấy lại đúng giá trị mới trong response');
      const hrCheckAfter = await api('GET', '/api/hr-profile/by-code/NV001', undefined, HR_MGR);
      assertEqual(hrCheckAfter.body.profile.permanentAddress, '123 Đường ABC', 'Giá trị mới phải được lưu thật xuống hồ sơ');
    });

    await run.run('GET/PUT /self-field-config — cấu hình trường nhạy cảm chính chủ tự xem được ở "Hồ Sơ Của Tôi" (9/2026)', async () => {
      resetAppData();
      seedLinkedProfile({ nationalId: '079123456789', dependents: [{ id: 'd1', fullName: 'Con A', relationship: 'Con' }] });

      const deniedGet = await api('GET', '/api/hr-profile/self-field-config', undefined, EMP1);
      assertEqual(deniedGet.status, 403, 'Nhân viên thường (chính chủ) KHÔNG được tự xem/sửa cấu hình này');
      const deniedPut = await api('PUT', '/api/hr-profile/self-field-config', { visibleFields: ['dependents'] }, DIRECT_MGR);
      assertEqual(deniedPut.status, 403, 'Quản lý trực tiếp (chỉ hrProfileView) không được sửa cấu hình');

      const defaultGet = await api('GET', '/api/hr-profile/self-field-config', undefined, HR_MGR);
      assertEqual(defaultGet.status, 200, 'HR phải xem được cấu hình');
      assertEqual(defaultGet.body.visibleFields.length, 0, 'Mặc định chưa cấu hình gì -> rỗng (opt-in)');
      assertEqual(defaultGet.body.availableFields.length, 15, 'Phải liệt kê đủ 15 field nhạy cảm khả dụng (đã mở rộng 9/2026, kể cả field vốn "luôn thấy" trước đây)');

      const putRes = await api('PUT', '/api/hr-profile/self-field-config',
        { visibleFields: ['dependents', 'khong-hop-le-loai-bo'] }, HR_MGR);
      assertEqual(putRes.status, 200, 'HR lưu cấu hình phải thành công');
      assertEqual(putRes.body.visibleFields.length, 1, 'Field không hợp lệ phải bị lọc bỏ, chỉ giữ dependents');

      const afterCfg = await api('GET', '/api/hr-profile/me', undefined, EMP1);
      assertEqual('dependents' in afterCfg.body.profile, true, 'Sau khi cấu hình: chính chủ phải thấy dependents (đã mở)');
      assertEqual('nationalId' in afterCfg.body.profile, false, 'Sau khi cấu hình: VẪN không thấy nationalId (chưa mở field này)');

      // Cấu hình self-field-config KHÔNG được lẫn sang managerVisibleFields (2 cấu hình độc lập) — quản lý
      // trực tiếp vẫn KHÔNG thấy dependents dù self-field-config đã mở field này cho CHÍNH CHỦ.
      const mgrView = await api('GET', '/api/hr-profile/by-code/NV001', undefined, DIRECT_MGR);
      assertEqual('dependents' in mgrView.body.profile, false, 'self-field-config KHÔNG được ảnh hưởng tới quyền xem của quản lý trực tiếp (2 cấu hình tách biệt)');
    });

    await run.run('GET / — chỉ hrProfileManage, KHÔNG bypass admin, chặn quản lý trực tiếp/nhân viên thường', async () => {
      resetAppData();
      seedLinkedProfile({});
      const ok = await api('GET', '/api/hr-profile', undefined, HR_MGR);
      assertEqual(ok.status, 200, `${HR_MGR.username} phải xem được danh sách`);
      // PHÁT HIỆN theo yêu cầu người dùng (10/2026): dữ liệu Hồ Sơ Nhân Sự nhạy cảm — admin KHÔNG còn
      // tự động bypass, phải được cấp cụ thể hrProfileManage mới xem được (xem lib/employeeProfile.js).
      const deniedAdmin = await api('GET', '/api/hr-profile', undefined, ADMIN);
      assertEqual(deniedAdmin.status, 403, 'admin KHÔNG có hrProfileManage -> vẫn bị chặn (không còn bypass mặc định)');
      const deniedMgr = await api('GET', '/api/hr-profile', undefined, DIRECT_MGR);
      assertEqual(deniedMgr.status, 403, 'Quản lý trực tiếp (chỉ hrProfileView) không được xem danh sách đầy đủ');
      const deniedEmp = await api('GET', '/api/hr-profile', undefined, EMP1);
      assertEqual(deniedEmp.status, 403, 'Nhân viên thường không được xem danh sách');
    });

    await run.run('GET /employee-directory — mở quyền RỘNG HƠN GET / (thêm hrContractManage), KHÔNG bypass admin, chỉ trả employeeCode+tên, loại INACTIVE', async () => {
      resetAppData();
      seedLinkedProfile({}); // NV001, liên kết emp1 -> tên tra qua DB.users
      APP_DATA.hrProcesses.push({ id: 200, fullName: 'Nguyễn Văn Chưa Liên Kết' });
      APP_DATA.employeeProfiles.push(Object.assign(employeeProfile.defaultProfile('NV002'), { status: 'ACTIVE', processId: 200 }));
      APP_DATA.employeeProfiles.push(Object.assign(employeeProfile.defaultProfile('NV003'), { status: 'INACTIVE' }));
      const deniedAdmin = await api('GET', '/api/hr-profile/employee-directory', undefined, ADMIN);
      assertEqual(deniedAdmin.status, 403, 'admin KHÔNG có hrProfileManage/hrContractManage -> vẫn bị chặn (không còn bypass mặc định)');
      for (const u of [HR_MGR, HR_CONTRACT_MGR]) {
        const ok = await api('GET', '/api/hr-profile/employee-directory', undefined, u);
        assertEqual(ok.status, 200, `${u.username} (hrProfileManage hoặc hrContractManage) phải tra được`);
        const codes = ok.body.directory.map(d => d.employeeCode);
        assertEqual(codes.includes('NV001'), true, 'NV001 (ACTIVE) phải có trong danh sách');
        assertEqual(codes.includes('NV002'), true, 'NV002 (ACTIVE) phải có trong danh sách');
        assertEqual(codes.includes('NV003'), false, 'NV003 (INACTIVE) KHÔNG được có trong danh sách');
        const nv001 = ok.body.directory.find(d => d.employeeCode === 'NV001');
        assertEqual(nv001.fullName, 'Nhân Viên Một', 'NV001 tra tên qua username đã liên kết (DB.users)');
        assertEqual('username' in nv001, false, 'Danh sách nhẹ KHÔNG được lộ username');
        assertEqual('status' in nv001, false, 'Danh sách nhẹ KHÔNG được lộ status');
        const nv002 = ok.body.directory.find(d => d.employeeCode === 'NV002');
        assertEqual(nv002.fullName, 'Nguyễn Văn Chưa Liên Kết', 'NV002 (chưa liên kết) tra tên qua processId (DB.hrProcesses)');
      }
      const denied = await api('GET', '/api/hr-profile/employee-directory', undefined, EMP1);
      assertEqual(denied.status, 403, 'Người không có hrProfileManage lẫn hrContractManage bị chặn');
    });

    await run.run('GET /by-code/:code — HR/admin xem đủ; quản lý trực tiếp xem giới hạn; người ngoài 404', async () => {
      resetAppData();
      seedLinkedProfile({ nationalId: '079123456789', dependents: [{ id: 'd1', fullName: 'Con A', relationship: 'Con' }] });

      const full = await api('GET', '/api/hr-profile/by-code/NV001', undefined, HR_MGR);
      assertEqual(full.status, 200, 'HR phải xem được hồ sơ');
      assertEqual(full.body.profile.nationalId, '079123456789', 'HR phải xem được field nhạy cảm');

      const limited = await api('GET', '/api/hr-profile/by-code/NV001', undefined, DIRECT_MGR);
      assertEqual(limited.status, 200, 'Quản lý trực tiếp đúng cây quản lý phải xem được bản giới hạn');
      assertEqual('nationalId' in limited.body.profile, false, 'Bản giới hạn KHÔNG được có nationalId');
      assertEqual('dependents' in limited.body.profile, false, 'Bản giới hạn KHÔNG được có dependents');

      const outsider = await api('GET', '/api/hr-profile/by-code/NV001', undefined, OUTSIDER);
      assertEqual(outsider.status, 404, 'Người không liên quan phải bị 404 (không phân biệt lý do)');
    });

    await run.run('PATCH /by-code/:code — chỉ HR/admin, sửa được cả field HR-only', async () => {
      resetAppData();
      seedLinkedProfile({});
      const deniedMgr = await api('PATCH', '/api/hr-profile/by-code/NV001', { nationalId: '079999999999' }, DIRECT_MGR);
      assertEqual(deniedMgr.status, 403, 'Quản lý trực tiếp không được sửa hồ sơ người khác');
      const ok = await api('PATCH', '/api/hr-profile/by-code/NV001', { nationalId: '079999999999' }, HR_MGR);
      assertEqual(ok.status, 200, 'HR sửa hồ sơ phải thành công');
      assertEqual(ok.body.profile.nationalId, '079999999999', 'HR phải sửa được field HR-only');
    });

    await run.run('PATCH /by-code/:code/status — chỉ chuyển tay ACTIVE<->ON_LEAVE, chặn DRAFT/INACTIVE', async () => {
      resetAppData();
      seedLinkedProfile({ status: 'ACTIVE' });
      const toLeave = await api('PATCH', '/api/hr-profile/by-code/NV001/status', { status: 'ON_LEAVE' }, HR_MGR);
      assertEqual(toLeave.status, 200, 'ACTIVE -> ON_LEAVE phải thành công');
      const toDraft = await api('PATCH', '/api/hr-profile/by-code/NV001/status', { status: 'DRAFT' }, HR_MGR);
      assertEqual(toDraft.status, 400, 'Không được chuyển tay sang DRAFT');

      resetAppData();
      seedLinkedProfile({ status: 'INACTIVE' });
      const fromInactive = await api('PATCH', '/api/hr-profile/by-code/NV001/status', { status: 'ACTIVE' }, HR_MGR);
      assertEqual(fromInactive.status, 400, 'Hồ sơ đã INACTIVE không đổi trạng thái tay được');
    });

    await run.run('POST /by-code/:code/link-account — chặn liên kết trùng', async () => {
      resetAppData();
      APP_DATA.employeeProfiles.push(employeeProfile.defaultProfile('NV002'));
      const denied = await api('POST', '/api/hr-profile/by-code/NV002/link-account', { username: 'emp1' }, DIRECT_MGR);
      assertEqual(denied.status, 403, 'Chỉ HR/admin mới liên kết tài khoản');
      const ok = await api('POST', '/api/hr-profile/by-code/NV002/link-account', { username: 'emp1' }, HR_MGR);
      assertEqual(ok.status, 200, 'Liên kết hợp lệ phải thành công');
      const dupSameProfile = await api('POST', '/api/hr-profile/by-code/NV002/link-account', { username: 'nv2' }, HR_MGR);
      assertEqual(dupSameProfile.status, 400, 'Hồ sơ đã liên kết rồi không liên kết lại được');

      APP_DATA.employeeProfiles.push(employeeProfile.defaultProfile('NV003'));
      const dupUsername = await api('POST', '/api/hr-profile/by-code/NV003/link-account', { username: 'emp1' }, HR_MGR);
      assertEqual(dupUsername.status, 400, 'username đã được hồ sơ khác liên kết rồi không dùng lại được');
    });

    await run.run('GET /by-username/:username — cùng quyền/hành vi như /by-code (đường tra cứu khác)', async () => {
      resetAppData();
      seedLinkedProfile({ nationalId: '079123456789' });
      const limited = await api('GET', '/api/hr-profile/by-username/emp1', undefined, DIRECT_MGR);
      assertEqual(limited.status, 200, 'Quản lý trực tiếp phải tra được theo username');
      assertEqual('nationalId' in limited.body.profile, false, 'Vẫn phải là bản giới hạn (không có nationalId)');
      const outsider = await api('GET', '/api/hr-profile/by-username/emp1', undefined, OUTSIDER);
      assertEqual(outsider.status, 404, 'Người không liên quan vẫn bị 404 qua đường tra cứu này');
      const notFound = await api('GET', '/api/hr-profile/by-username/khong-ton-tai', undefined, HR_MGR);
      assertEqual(notFound.status, 404, 'username không liên kết hồ sơ nào -> 404');
    });

    await run.run('POST / — tạo tay hồ sơ mới (nhân viên cũ chưa qua Onboarding), chỉ HR/admin', async () => {
      resetAppData();
      const deniedMgr = await api('POST', '/api/hr-profile', { employeeCode: 'NV900' }, DIRECT_MGR);
      assertEqual(deniedMgr.status, 403, 'Quản lý trực tiếp không được tạo tay hồ sơ');

      const ok = await api('POST', '/api/hr-profile', { employeeCode: 'NV900', dateOfBirth: '1990-01-01', gender: 'Nam' }, HR_MGR);
      assertEqual(ok.status, 200, 'HR tạo hồ sơ mới phải thành công');
      assertEqual(ok.body.profile.status, 'ACTIVE', 'Hồ sơ tạo tay phải ở trạng thái ACTIVE ngay (không qua DRAFT)');
      assertEqual(ok.body.profile.dateOfBirth, '1990-01-01', 'Phải lưu đúng field cá nhân gửi kèm lúc tạo');

      const dupCode = await api('POST', '/api/hr-profile', { employeeCode: 'NV900' }, HR_MGR);
      assertEqual(dupCode.status, 400, 'Trùng employeeCode phải bị chặn');

      const badUsername = await api('POST', '/api/hr-profile', { employeeCode: 'NV901', username: 'khong-ton-tai' }, HR_MGR);
      assertEqual(badUsername.status, 400, 'username không phải tài khoản đang hoạt động phải bị chặn');

      const withUsername = await api('POST', '/api/hr-profile', { employeeCode: 'NV902', username: 'nv2' }, HR_MGR);
      assertEqual(withUsername.status, 200, 'Liên kết luôn tài khoản VPDT hợp lệ ngay lúc tạo phải thành công');
      assertEqual(withUsername.body.profile.username, 'nv2', 'Phải lưu đúng username liên kết');

      const dupUsername = await api('POST', '/api/hr-profile', { employeeCode: 'NV903', username: 'nv2' }, HR_MGR);
      assertEqual(dupUsername.status, 400, 'username đã liên kết hồ sơ khác phải bị chặn');
    });

    await run.run('POST / — employeeCode để trống -> tự sinh "BL..." (9/2026)', async () => {
      const ok = await api('POST', '/api/hr-profile', { dateOfBirth: '1991-02-02' }, HR_MGR);
      assertEqual(ok.status, 200, 'Tạo hồ sơ không kèm employeeCode vẫn phải thành công');
      assertIncludes(ok.body.profile.employeeCode, 'BL', 'Mã tự sinh phải có tiền tố BL');
    });

    await run.run('GET /search-inactive + POST /by-code/:code/rehire — Kiểm Tra Nhân Sự Cũ/Tái Tuyển (9/2026)', async () => {
      resetAppData();
      const inactive = Object.assign(employeeProfile.defaultProfile('NV700'), {
        status: 'INACTIVE', username: 'nv2', nationalId: '079095001234', dateOfBirth: '1995-04-12'
      });
      APP_DATA.employeeProfiles.push(inactive);
      APP_DATA.employeeProfiles.push(employeeProfile.defaultProfile('NV701')); // hồ sơ khác, không liên quan

      const denied = await api('GET', '/api/hr-profile/search-inactive?nationalId=079095001234', undefined, DIRECT_MGR);
      assertEqual(denied.status, 403, 'Quản lý trực tiếp không được tìm nhân sự cũ');

      const noMatch = await api('GET', '/api/hr-profile/search-inactive?nationalId=000000000000', undefined, HR_MGR);
      assertEqual(noMatch.body.results.length, 0, 'CCCD không khớp ai -> rỗng');

      const byNationalId = await api('GET', '/api/hr-profile/search-inactive?nationalId=079095001234', undefined, HR_MGR);
      assertEqual(byNationalId.body.results.length, 1, 'Tìm đúng theo CCCD phải ra đúng 1 kết quả');
      assertEqual(byNationalId.body.results[0].employeeCode, 'NV700', 'Phải đúng employeeCode của hồ sơ INACTIVE');
      assertEqual(byNationalId.body.results[0].fullName, 'Người Ngoài Cuộc', 'Phải suy đúng tên qua username liên kết (users) — nv2.name');

      const byBoth = await api('GET', '/api/hr-profile/search-inactive?nationalId=079095001234&dateOfBirth=1995-04-12', undefined, HR_MGR);
      assertEqual(byBoth.body.results.length, 1, 'Khớp CẢ 2 tiêu chí vẫn ra đúng 1 kết quả');

      const mismatch = await api('GET', '/api/hr-profile/search-inactive?nationalId=079095001234&dateOfBirth=2000-01-01', undefined, HR_MGR);
      assertEqual(mismatch.body.results.length, 0, 'Khớp CCCD nhưng SAI ngày sinh (gửi cả 2) phải rỗng — bắt buộc khớp CẢ 2 khi cả 2 đều được gửi');

      const deniedRehire = await api('POST', '/api/hr-profile/by-code/NV700/rehire', { newStartDate: '2026-09-16' }, DIRECT_MGR);
      assertEqual(deniedRehire.status, 403, 'Quản lý trực tiếp không được xác nhận tái tuyển');

      const notInactive = await api('POST', '/api/hr-profile/by-code/NV701/rehire', { newStartDate: '2026-09-16' }, HR_MGR);
      assertEqual(notInactive.status, 400, 'Hồ sơ không ở trạng thái INACTIVE phải bị chặn tái tuyển');

      const missingDate = await api('POST', '/api/hr-profile/by-code/NV700/rehire', {}, HR_MGR);
      assertEqual(missingDate.status, 400, 'Thiếu Ngày bắt đầu làm việc lại phải bị chặn');

      const rehired = await api('POST', '/api/hr-profile/by-code/NV700/rehire', { newStartDate: '2026-09-16' }, HR_MGR);
      assertEqual(rehired.status, 200, 'Tái tuyển hợp lệ phải thành công');
      assertEqual(rehired.body.profile.status, 'ACTIVE', 'Trạng thái phải chuyển lại ACTIVE');
      assertEqual(rehired.body.profile.employeeCode, 'NV700', 'Mã Nhân Viên phải GIỮ NGUYÊN (không cấp mã mới)');
      assertEqual(rehired.body.profile.rehireHistory.length, 1, 'Phải ghi đúng 1 dòng lịch sử tái tuyển');
      assertEqual(rehired.body.profile.rehireHistory[0].newStartDate, '2026-09-16', 'Phải lưu đúng ngày bắt đầu làm việc lại');

      const alreadyActive = await api('POST', '/api/hr-profile/by-code/NV700/rehire', { newStartDate: '2026-10-01' }, HR_MGR);
      assertEqual(alreadyActive.status, 400, 'Hồ sơ đã ACTIVE (vừa tái tuyển xong) không tái tuyển lại được nữa');
    });

    await run.run('POST /bulk-import — atomic: dòng hợp lệ tạo được, dòng trùng bị skip kèm lý do', async () => {
      resetAppData();
      APP_DATA.employeeProfiles.push(employeeProfile.defaultProfile('NV800')); // đã tồn tại sẵn

      const denied = await api('POST', '/api/hr-profile/bulk-import', { items: [{ employeeCode: 'NV810' }] }, DIRECT_MGR);
      assertEqual(denied.status, 403, 'Quản lý trực tiếp không được nhập hàng loạt');

      const res = await api('POST', '/api/hr-profile/bulk-import', {
        items: [
          { employeeCode: 'NV810', dateOfBirth: '1992-02-02' },
          { employeeCode: 'NV800' }, // trùng với hồ sơ đã có sẵn -> skip
          { employeeCode: 'NV811' },
          { employeeCode: 'NV811' } // trùng NGAY trong payload -> skip
        ]
      }, HR_MGR);
      assertEqual(res.status, 200, 'Bulk-import phải trả 200 dù có dòng skip (không throw cả batch)');
      assertEqual(res.body.created.length, 2, 'Phải tạo đúng 2 hồ sơ hợp lệ (NV810, NV811 dòng đầu)');
      assertEqual(res.body.skipped.length, 2, 'Phải skip đúng 2 dòng (trùng dữ liệu cũ + trùng trong payload)');
      const listAfter = await api('GET', '/api/hr-profile', undefined, HR_MGR);
      assertEqual(listAfter.body.profiles.length, 3, 'Tổng số hồ sơ phải là 3 (1 cũ + 2 mới tạo, KHÔNG có bản ghi vênh từ dòng lỗi)');
    });

    await run.run('GET /import-template, POST /parse-import (file thật), GET /export-xlsx', async () => {
      resetAppData();
      const deniedTemplate = await api('GET', '/api/hr-profile/import-template', undefined, DIRECT_MGR);
      assertEqual(deniedTemplate.status, 403, 'Quản lý trực tiếp không tải được mẫu Excel');

      // Sinh file mẫu THẬT (đúng hàm server dùng để cấp cho HR tải), rồi upload lại NGUYÊN VẸN để parse —
      // xác nhận vòng tròn tải-mẫu -> điền -> upload đọc lại đúng cột/đúng dòng ví dụ có sẵn trong mẫu.
      const wb = await employeeProfileImport.buildImportTemplateWorkbook();
      const buffer = await wb.xlsx.writeBuffer();

      const deniedParse = await apiUpload('/api/hr-profile/parse-import', buffer, 'mau.xlsx', DIRECT_MGR);
      assertEqual(deniedParse.status, 403, 'Quản lý trực tiếp không parse-import được');

      const parsed = await apiUpload('/api/hr-profile/parse-import', buffer, 'mau.xlsx', HR_MGR);
      assertEqual(parsed.status, 200, 'Parse file mẫu (đã có sẵn 1 dòng ví dụ) phải thành công');
      assertEqual(parsed.body.items.length, 1, 'Mẫu có đúng 1 dòng ví dụ');
      assertEqual(parsed.body.items[0].employeeCode, 'NV1001', 'Phải đọc đúng Mã Nhân Viên từ dòng ví dụ trong mẫu');
      assertEqual(parsed.body.items[0].valid, true, 'Dòng ví dụ trong mẫu (employeeCode chưa tồn tại) phải hợp lệ');

      APP_DATA.employeeProfiles.push(employeeProfile.defaultProfile('NV1001'));
      const parsedAfterDup = await apiUpload('/api/hr-profile/parse-import', buffer, 'mau.xlsx', HR_MGR);
      assertEqual(parsedAfterDup.body.items[0].valid, false, 'Sau khi NV1001 đã có hồ sơ, dòng ví dụ (cùng mã) phải báo KHÔNG hợp lệ');

      const okTemplate = await api('GET', '/api/hr-profile/import-template', undefined, HR_MGR);
      assertEqual(okTemplate.status, 200, 'HR phải tải được mẫu Excel');

      const deniedExport = await api('GET', '/api/hr-profile/export-xlsx', undefined, DIRECT_MGR);
      assertEqual(deniedExport.status, 403, 'Quản lý trực tiếp không xuất được Excel');
      const okExport = await api('GET', '/api/hr-profile/export-xlsx', undefined, HR_MGR);
      assertEqual(okExport.status, 200, 'HR phải xuất được Excel toàn bộ danh sách hồ sơ');
    });

    await run.run('3 quyền chi tiết Tạo/Xem toàn bộ/Sửa hồ sơ nhân sự — tách bạch, không suy ra lẫn nhau (9/2026)', async () => {
      resetAppData();
      seedLinkedProfile({ nationalId: '079123456789' }); // NV001

      // hrProfileCreate: tạo được, nhưng KHÔNG xem được danh sách/sửa (Create không tự kéo theo FullView).
      const createOk = await api('POST', '/api/hr-profile', { dateOfBirth: '1990-01-01' }, HR_CREATE_ONLY);
      assertEqual(createOk.status, 200, 'hrProfileCreate phải tạo được hồ sơ mới');
      const createDeniedList = await api('GET', '/api/hr-profile', undefined, HR_CREATE_ONLY);
      assertEqual(createDeniedList.status, 403, 'hrProfileCreate KHÔNG được tự xem danh sách (không suy ra FullView)');
      const createDeniedEdit = await api('PATCH', '/api/hr-profile/by-code/NV001', { permanentAddress: 'X' }, HR_CREATE_ONLY);
      assertEqual(createDeniedEdit.status, 403, 'hrProfileCreate KHÔNG được sửa hồ sơ');

      // hrProfileFullView: xem được danh sách/chi tiết đầy đủ, nhưng KHÔNG tạo/sửa được.
      const viewOkList = await api('GET', '/api/hr-profile', undefined, HR_FULLVIEW_ONLY);
      assertEqual(viewOkList.status, 200, 'hrProfileFullView phải xem được danh sách');
      const viewOkDetail = await api('GET', '/api/hr-profile/by-code/NV001', undefined, HR_FULLVIEW_ONLY);
      assertEqual(viewOkDetail.status, 200, 'hrProfileFullView phải xem được chi tiết đầy đủ (kể cả field nhạy cảm)');
      assertEqual(viewOkDetail.body.profile.nationalId, '079123456789', 'hrProfileFullView phải thấy field nhạy cảm (không bị giới hạn như quản lý trực tiếp)');
      const viewDeniedCreate = await api('POST', '/api/hr-profile', { dateOfBirth: '1991-01-01' }, HR_FULLVIEW_ONLY);
      assertEqual(viewDeniedCreate.status, 403, 'hrProfileFullView KHÔNG được tạo hồ sơ mới');
      const viewDeniedEdit = await api('PATCH', '/api/hr-profile/by-code/NV001', { permanentAddress: 'X' }, HR_FULLVIEW_ONLY);
      assertEqual(viewDeniedEdit.status, 403, 'hrProfileFullView KHÔNG được sửa hồ sơ');

      // hrProfileEdit: sửa được (kể cả field HR-only) + TỰ ĐỘNG xem được (edit kéo theo FullView), nhưng KHÔNG tạo mới được.
      const editOk = await api('PATCH', '/api/hr-profile/by-code/NV001', { nationalId: '079999999999' }, HR_EDIT_ONLY);
      assertEqual(editOk.status, 200, 'hrProfileEdit phải sửa được hồ sơ (kể cả field HR-only)');
      assertEqual(editOk.body.profile.nationalId, '079999999999', 'hrProfileEdit phải sửa được field nhạy cảm');
      const editOkList = await api('GET', '/api/hr-profile', undefined, HR_EDIT_ONLY);
      assertEqual(editOkList.status, 200, 'hrProfileEdit phải TỰ ĐỘNG xem được danh sách (edit kéo theo view)');
      const editDeniedCreate = await api('POST', '/api/hr-profile', { dateOfBirth: '1992-01-01' }, HR_EDIT_ONLY);
      assertEqual(editDeniedCreate.status, 403, 'hrProfileEdit KHÔNG được tạo hồ sơ mới');
    });

    await run.run('GET/PUT /manager-field-config — cấu hình trường nhạy cảm mở thêm cho quản lý trực tiếp (9/2026)', async () => {
      resetAppData();
      seedLinkedProfile({ nationalId: '079123456789', dependents: [{ id: 'd1', fullName: 'Con A', relationship: 'Con' }] }); // NV001, quản lý = mgr1

      const deniedGet = await api('GET', '/api/hr-profile/manager-field-config', undefined, DIRECT_MGR);
      assertEqual(deniedGet.status, 403, 'Quản lý trực tiếp không được xem cấu hình');
      const deniedPut = await api('PUT', '/api/hr-profile/manager-field-config', { visibleFields: ['dependents'] }, DIRECT_MGR);
      assertEqual(deniedPut.status, 403, 'Quản lý trực tiếp không được sửa cấu hình');
      const deniedFullView = await api('PUT', '/api/hr-profile/manager-field-config', { visibleFields: ['dependents'] }, HR_FULLVIEW_ONLY);
      assertEqual(deniedFullView.status, 403, 'hrProfileFullView (không có hrProfileManage) không được sửa cấu hình — quyền bảo mật riêng, chặt hơn');

      const defaultGet = await api('GET', '/api/hr-profile/manager-field-config', undefined, HR_MGR);
      assertEqual(defaultGet.status, 200, 'HR phải xem được cấu hình');
      assertEqual(defaultGet.body.visibleFields.length, 0, 'Mặc định chưa cấu hình gì -> rỗng (giữ nguyên hành vi cũ: ẩn hết)');
      assertEqual(defaultGet.body.availableFields.length, 15, 'Phải liệt kê đủ 15 field nhạy cảm khả dụng (đã mở rộng 9/2026)');

      // Trước khi cấu hình: quản lý trực tiếp KHÔNG thấy nationalId/dependents.
      const beforeCfg = await api('GET', '/api/hr-profile/by-code/NV001', undefined, DIRECT_MGR);
      assertEqual('nationalId' in beforeCfg.body.profile, false, 'Trước khi cấu hình: chưa mở nationalId');
      assertEqual('dependents' in beforeCfg.body.profile, false, 'Trước khi cấu hình: chưa mở dependents');

      const putRes = await api('PUT', '/api/hr-profile/manager-field-config',
        { visibleFields: ['dependents', 'khong-hop-le-loai-bo'] }, HR_MGR);
      assertEqual(putRes.status, 200, 'HR lưu cấu hình phải thành công');
      assertEqual(putRes.body.visibleFields.length, 1, 'Field không hợp lệ ("khong-hop-le-loai-bo") phải bị lọc bỏ, chỉ giữ dependents');
      assertEqual(putRes.body.visibleFields[0], 'dependents', 'Phải giữ đúng field hợp lệ đã gửi');

      // Sau khi cấu hình mở "dependents": quản lý trực tiếp thấy dependents nhưng VẪN KHÔNG thấy nationalId
      // (chỉ field được admin tick mới mở, không mở tất cả).
      const afterCfg = await api('GET', '/api/hr-profile/by-code/NV001', undefined, DIRECT_MGR);
      assertEqual('dependents' in afterCfg.body.profile, true, 'Sau khi cấu hình: phải thấy dependents (đã mở)');
      assertEqual(afterCfg.body.profile.dependents[0].fullName, 'Con A', 'Dữ liệu dependents phải đúng');
      assertEqual('nationalId' in afterCfg.body.profile, false, 'Sau khi cấu hình: VẪN không thấy nationalId (chưa mở field này)');

      // HR/admin (canViewFullProfile) luôn thấy đủ mọi field bất kể cấu hình — cấu hình chỉ ảnh hưởng
      // tầng "quản lý trực tiếp xem giới hạn".
      const hrView = await api('GET', '/api/hr-profile/by-code/NV001', undefined, HR_MGR);
      assertEqual(hrView.body.profile.nationalId, '079123456789', 'HR luôn xem đủ, không bị ảnh hưởng bởi cấu hình này');
    });

  } finally {
    server.close();
  }

  // ===== PHẦN B: gọi thẳng hàm THẬT trong lib/employeeProfile.js =====
  await run.run('ensureDraftProfile(): tạo DRAFT mới, idempotent', () => {
    let list = [];
    list = employeeProfile.ensureDraftProfile(list, 'NV100', 'proc-1', 'hr1');
    assertEqual(list.length, 1, 'Phải tạo đúng 1 hồ sơ mới');
    assertEqual(list[0].status, 'DRAFT', 'Hồ sơ mới phải ở trạng thái DRAFT');
    list = employeeProfile.ensureDraftProfile(list, 'NV100', 'proc-2', 'hr1');
    assertEqual(list.length, 1, 'Gọi lại với cùng employeeCode KHÔNG được tạo trùng');
  });

  await run.run('applyProcessCompletion(): ONBOARDING -> ACTIVE (theo employeeCode), OFFBOARDING -> INACTIVE (theo employeeUsername)', () => {
    let list = [employeeProfile.defaultProfile('NV200')];
    list = employeeProfile.applyProcessCompletion(list, { processType: 'ONBOARDING', employeeCode: 'NV200' });
    assertEqual(list[0].status, 'ACTIVE', 'ONBOARDING hoàn tất phải chuyển ACTIVE');

    list = [Object.assign(employeeProfile.defaultProfile('NV201'), { username: 'emp1', status: 'ACTIVE' })];
    list = employeeProfile.applyProcessCompletion(list, { processType: 'OFFBOARDING', employeeUsername: 'emp1' });
    assertEqual(list[0].status, 'INACTIVE', 'OFFBOARDING hoàn tất phải chuyển INACTIVE');
  });

  await run.run('linkAccount(): gán hợp lệ; lỗi nếu hồ sơ không tồn tại/đã liên kết/username trùng', () => {
    let list = [employeeProfile.defaultProfile('NV300'), employeeProfile.defaultProfile('NV301')];
    const profile = employeeProfile.linkAccount(list, 'NV300', 'emp1', 'hr1');
    assertEqual(profile.username, 'emp1', 'Phải gán đúng username');

    let threwNotFound = false;
    try { employeeProfile.linkAccount(list, 'NV999', 'emp2', 'hr1'); } catch (e) { threwNotFound = true; assertIncludes(e.message, 'Không tìm thấy'); }
    assertEqual(threwNotFound, true, 'Hồ sơ không tồn tại phải throw');

    let threwAlreadyLinked = false;
    try { employeeProfile.linkAccount(list, 'NV300', 'emp2', 'hr1'); } catch (e) { threwAlreadyLinked = true; assertIncludes(e.message, 'đã liên kết'); }
    assertEqual(threwAlreadyLinked, true, 'Hồ sơ đã liên kết rồi phải throw khi liên kết lại');

    let threwDupUsername = false;
    try { employeeProfile.linkAccount(list, 'NV301', 'emp1', 'hr1'); } catch (e) { threwDupUsername = true; assertIncludes(e.message, 'đã được liên kết'); }
    assertEqual(threwDupUsername, true, 'username đã dùng ở hồ sơ khác phải throw');
  });

  await run.run('assertValidManualStatusTransition(): chỉ ACTIVE<->ON_LEAVE, chặn DRAFT/INACTIVE', () => {
    employeeProfile.assertValidManualStatusTransition('ACTIVE', 'ON_LEAVE'); // không throw
    employeeProfile.assertValidManualStatusTransition('ON_LEAVE', 'ACTIVE'); // không throw

    let threwFromDraft = false;
    try { employeeProfile.assertValidManualStatusTransition('DRAFT', 'ACTIVE'); } catch (e) { threwFromDraft = true; }
    assertEqual(threwFromDraft, true, 'Không chuyển tay được từ DRAFT');

    let threwFromInactive = false;
    try { employeeProfile.assertValidManualStatusTransition('INACTIVE', 'ACTIVE'); } catch (e) { threwFromInactive = true; }
    assertEqual(threwFromInactive, true, 'Không chuyển tay được từ INACTIVE');

    let threwToDraft = false;
    try { employeeProfile.assertValidManualStatusTransition('ACTIVE', 'DRAFT'); } catch (e) { threwToDraft = true; }
    assertEqual(threwToDraft, true, 'Không chuyển tay SANG DRAFT');
  });

  // 13. generateEmployeeCode() — Mã Nhân Viên TỰ SINH (9/2026, theo yêu cầu người dùng): tiền tố "BL" +
  // số tuần tự, nhảy qua số đã dùng, và createManualProfile() tự gọi hàm này khi employeeCode để trống.
  await run.run('generateEmployeeCode(): tiền tố "BL" + số tuần tự, lấy đúng số LỚN NHẤT đã dùng +1', () => {
    assertEqual(employeeProfile.generateEmployeeCode([]), 'BL0001', 'Danh sách rỗng phải bắt đầu từ BL0001');
    const list1 = [employeeProfile.defaultProfile('BL0001'), employeeProfile.defaultProfile('BL0003')];
    assertEqual(employeeProfile.generateEmployeeCode(list1), 'BL0004', 'Phải lấy đúng số LỚN NHẤT (0003) + 1, không phải đếm số lượng (2+1=3)');
    // Mã KHÁC định dạng "BL<số>" (mã ngoài hệ thống cũ, hoặc mã người dùng tự gõ tay) không được tính vào.
    const list2 = [employeeProfile.defaultProfile('NV999'), employeeProfile.defaultProfile('BL0002')];
    assertEqual(employeeProfile.generateEmployeeCode(list2), 'BL0003', 'Mã không đúng khuôn BL<số> phải bị bỏ qua khi tính số tiếp theo');
  });

  await run.run('generateEmployeeCode(): nhảy qua số đã dùng nếu số tính được (do dữ liệu cũ không tuần tự) vẫn trùng', () => {
    const list = [employeeProfile.defaultProfile('BL0005'), employeeProfile.defaultProfile('BL0001')];
    // maxSeq=5 -> ứng viên đầu tiên là BL0006, không trùng gì cả -> vẫn đúng như bình thường (kịch bản
    // trùng thật chỉ xảy ra khi dữ liệu cũ có "lỗ hổng" số nhỏ hơn maxSeq NHƯNG generateEmployeeCode vẫn
    // phải an toàn nếu maxSeq tính sai/đụng nhau — assert vòng while không rơi vào lặp vô hạn/trả về mã
    // đã tồn tại là đủ, không cần dựng kịch bản nhân tạo ép trùng vì thuật toán maxSeq+1 vốn không tự trùng).
    const code = employeeProfile.generateEmployeeCode(list);
    assert(!list.some(p => p.employeeCode === code), 'Mã sinh ra không được trùng với bất kỳ mã nào đã có');
  });

  await run.run('createManualProfile(): employeeCode để trống -> tự sinh "BL...", vẫn gõ tay được nếu muốn', () => {
    let list = [];
    const auto = employeeProfile.createManualProfile(list, { dateOfBirth: '1990-01-01' }, 'hr1');
    assertEqual(auto.employeeCode, 'BL0001', 'Để trống employeeCode phải tự sinh đúng mã đầu tiên');
    list.push(auto);
    const manual = employeeProfile.createManualProfile(list, { employeeCode: 'NV-NGOAI-01' }, 'hr1');
    assertEqual(manual.employeeCode, 'NV-NGOAI-01', 'Vẫn cho gõ tay mã khác (VD hồ sơ Tái Tuyển giữ nguyên mã cũ) nếu có gửi employeeCode');
  });

  await run.run('createManualProfile(): tự ghi 1 dòng profileEditHistory type=CREATE, KHÔNG ghi thêm dòng EDIT cho dữ liệu điền lúc tạo (9/2026)', () => {
    const created = employeeProfile.createManualProfile([], { dateOfBirth: '1990-01-01', bankName: 'Vietcombank' }, 'hr1', 'Nhân Sự Trưởng');
    assertEqual(created.profileEditHistory.length, 1, 'Chỉ đúng 1 dòng lịch sử (CREATE) — điền field ban đầu KHÔNG tính là "sửa"');
    assertEqual(created.profileEditHistory[0].type, 'CREATE', 'Đúng type CREATE');
    assertEqual(created.profileEditHistory[0].byName, 'Nhân Sự Trưởng', 'Ghi đúng tên người tạo');
  });

  await run.run('applyProfileEdit(): chỉ ghi profileEditHistory (type=EDIT) khi field THỰC SỰ đổi giá trị, liệt kê đúng field đã đổi (9/2026)', () => {
    const profile = employeeProfile.defaultProfile('NV900');
    profile.bankName = 'Vietcombank';
    profile.dateOfBirth = '1990-01-01';

    // Gửi lại ĐÚNG giá trị cũ (không đổi gì) -> KHÔNG ghi history thừa.
    employeeProfile.applyProfileEdit(profile, { bankName: 'Vietcombank' }, employeeProfile.SELF_EDITABLE_FIELDS, 'emp1', 'Nhân Viên Một');
    assertEqual(profile.profileEditHistory.length, 0, 'Không đổi giá trị thực sự -> không ghi history');

    // Đổi 2 field cùng lúc -> ghi ĐÚNG 1 dòng, liệt kê CẢ 2 field (không phải 2 dòng riêng).
    employeeProfile.applyProfileEdit(profile, { bankName: 'Techcombank', currentAddress: '123 ABC' }, employeeProfile.SELF_EDITABLE_FIELDS, 'emp1', 'Nhân Viên Một');
    assertEqual(profile.profileEditHistory.length, 1, 'Phải ghi đúng 1 dòng lịch sử cho 1 lượt PATCH (dù đổi nhiều field)');
    assertEqual(profile.profileEditHistory[0].type, 'EDIT', 'Đúng type EDIT');
    assertEqual(profile.profileEditHistory[0].changedFields.includes('Tên ngân hàng'), true, 'Phải liệt kê đúng nhãn field "Tên ngân hàng" đã đổi');
    assertEqual(profile.profileEditHistory[0].changedFields.includes('Địa chỉ hiện tại'), true, 'Phải liệt kê đúng nhãn field "Địa chỉ hiện tại" đã đổi');
    assertEqual(profile.profileEditHistory[0].changedFields.includes('Ngày sinh'), false, 'KHÔNG được liệt kê field không nằm trong payload gửi lên (dateOfBirth)');
    assertEqual(profile.profileEditHistory[0].byName, 'Nhân Viên Một', 'Ghi đúng tên người sửa');

    // options.skipHistory=true (đường createManualProfile() dùng) -> không ghi gì dù có đổi giá trị.
    employeeProfile.applyProfileEdit(profile, { bankName: 'ACB' }, employeeProfile.SELF_EDITABLE_FIELDS, 'hr1', 'HR', { skipHistory: true });
    assertEqual(profile.profileEditHistory.length, 1, 'skipHistory=true không được ghi thêm dòng nào');
  });

  await run.run('computeHrReportSummary(): gộp đúng nhân sự vào làm/nghỉ việc/tăng lương/hợp đồng mới-gia hạn-sắp hết hạn/thăng chức, lọc đúng khoảng thời gian (9/2026)', () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const iso = (offsetDays) => { const d = new Date(today); d.setDate(d.getDate() + offsetDays); return d.toISOString().slice(0, 10); };

    const profiles = [
      Object.assign(employeeProfile.defaultProfile('NV001'), {
        status: 'INACTIVE', updatedAt: '08:00:00 15/2/2026', // nghỉ việc trong kỳ
        positionHistory: [{ effectiveDate: '2026-02-10', oldPositionKey: null, oldPositionLabel: null, newPositionLabel: 'Nhân Viên' }]
      }),
      Object.assign(employeeProfile.defaultProfile('NV002'), {
        status: 'ACTIVE',
        positionHistory: [{ effectiveDate: '2026-02-20', oldPositionKey: 'POS-NV', oldPositionLabel: 'Nhân Viên', newPositionLabel: 'Trưởng Phòng' }]
      })
    ];
    const contracts = [
      { employeeCode: 'NV002', code: 'HDLD-NV002-1', renewalIndex: 0, status: 'ACTIVE', contractType: 'PROBATION', startDate: '2026-02-01', endDate: iso(15), createdAt: '09:00:00 1/2/2026', amendments: [] },
      { employeeCode: 'NV002', code: 'HDLD-NV002-2', renewalIndex: 1, status: 'ACTIVE', contractType: 'FIXED_TERM', startDate: '2026-02-10', endDate: null, createdAt: '10:00:00 10/2/2026',
        amendments: [
          { amendmentType: 'Tăng lương', effectiveDate: '2026-02-15', oldValue: '10.000.000', newValue: '12.000.000' },
          { amendmentType: 'Đổi ca làm việc', effectiveDate: '2026-02-16', oldValue: 'Ca sáng', newValue: 'Ca chiều' }
        ]
      },
      { employeeCode: 'NV003', code: 'HDLD-NV003-1', renewalIndex: 0, status: 'TERMINATED', contractType: 'PROBATION', startDate: '2025-01-01', endDate: '2025-06-01', createdAt: '08:00:00 1/1/2025', amendments: [] }
    ];

    const summary = employeeProfile.computeHrReportSummary(profiles, contracts, { from: '2026-02-01', to: '2026-02-28' });
    assertEqual(summary.counts.joiners, 1, 'Chỉ tính hợp đồng renewalIndex=0 có startDate trong kỳ (NV002, HDLD-NV002-1) -> 1 người vào làm');
    assertEqual(summary.joiners[0].employeeCode, 'NV002', 'Đúng người vào làm');
    assertEqual(summary.counts.leavers, 1, 'NV001 (INACTIVE, updatedAt trong kỳ) -> 1 người nghỉ việc');
    assertEqual(summary.leavers[0].employeeCode, 'NV001', 'Đúng người nghỉ việc');
    assertEqual(summary.counts.newContracts, 2, 'Cả 2 hợp đồng NV002 có createdAt trong kỳ -> 2 hợp đồng mới (NV003 tạo 2025, ngoài kỳ)');
    assertEqual(summary.counts.renewedContracts, 1, 'Chỉ HDLD-NV002-2 (renewalIndex=1) tính là gia hạn');
    assertEqual(summary.counts.salaryIncreases, 1, 'Đúng 1 phụ lục "Tăng lương" trong kỳ');
    assertEqual(summary.salaryIncreases[0].oldValue, '10.000.000', 'Giữ đúng giá trị cũ đã lưu (định dạng tiền)');
    assertEqual(summary.counts.otherAmendments, 1, '"Đổi ca làm việc" không liên quan lương -> tính riêng otherAmendments');
    assertEqual(summary.counts.positionChanges, 2, 'Cả 2 hồ sơ đều có 1 dòng positionHistory trong kỳ -> 2 thay đổi chức vụ');
    const nv002Change = summary.positionChanges.find(p => p.employeeCode === 'NV002');
    assertEqual(nv002Change.isNewAppointment, false, 'NV002 có oldPositionKey -> KHÔNG phải bổ nhiệm lần đầu');
    const nv001Change = summary.positionChanges.find(p => p.employeeCode === 'NV001');
    assertEqual(nv001Change.isNewAppointment, true, 'NV001 không có oldPositionKey -> bổ nhiệm lần đầu');

    const filteredByStatus = employeeProfile.computeHrReportSummary(profiles, contracts, { contractStatus: 'TERMINATED' });
    assertEqual(filteredByStatus.counts.contractsByStatus, 1, 'Lọc theo contractStatus=TERMINATED chỉ ra đúng 1 hợp đồng (NV003)');

    const outOfRange = employeeProfile.computeHrReportSummary(profiles, contracts, { from: '2026-05-01', to: '2026-05-31' });
    assertEqual(outOfRange.counts.joiners, 0, 'Ngoài khoảng thời gian -> không có kết quả nào');
    assertEqual(outOfRange.counts.salaryIncreases, 0, 'Ngoài khoảng thời gian -> không có tăng lương nào');
  });

  await run.run('computeHrReportSummary(): "sắp hết hạn" luôn tính từ HÔM NAY (không phụ thuộc from/to)', () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const iso = (offsetDays) => { const d = new Date(today); d.setDate(d.getDate() + offsetDays); return d.toISOString().slice(0, 10); };
    const contracts = [
      { employeeCode: 'NV900', code: 'HDLD-NV900-1', renewalIndex: 0, status: 'ACTIVE', contractType: 'FIXED_TERM', startDate: iso(-100), endDate: iso(10), createdAt: '08:00:00 1/1/2020', amendments: [] },
      { employeeCode: 'NV901', code: 'HDLD-NV901-1', renewalIndex: 0, status: 'ACTIVE', contractType: 'FIXED_TERM', startDate: iso(-100), endDate: iso(60), createdAt: '08:00:00 1/1/2020', amendments: [] },
      { employeeCode: 'NV902', code: 'HDLD-NV902-1', renewalIndex: 0, status: 'DRAFT', contractType: 'FIXED_TERM', startDate: iso(-100), endDate: iso(5), createdAt: '08:00:00 1/1/2020', amendments: [] }
    ];
    // Truyền from/to CỐ Ý rất xa (không bao gồm hôm nay) — expiringSoon vẫn phải ra đúng kết quả vì
    // KHÔNG phụ thuộc bộ lọc from/to (luôn tính từ ngày hiện tại thật).
    const summary = employeeProfile.computeHrReportSummary([], contracts, { from: '2020-01-01', to: '2020-01-31' });
    assertEqual(summary.counts.expiringSoon, 1, 'Chỉ NV900 (ACTIVE, còn 10 ngày) sắp hết hạn — NV901 còn quá xa (60 ngày), NV902 không ACTIVE');
    assertEqual(summary.expiringSoon[0].employeeCode, 'NV900', 'Đúng hợp đồng sắp hết hạn');
  });

  run.summary();
}

main().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
