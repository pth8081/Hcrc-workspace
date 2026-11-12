// server/tests/test-user-save-patch-mode.js
//
// Tính năng MỚI (11/2026, theo yêu cầu người dùng "sao cho tôi phân quyền cho nhanh" — màn "Sửa 1 Người
// Dùng" trước đây gửi NGUYÊN CẢ DB.users (toàn bộ nhân viên công ty) lên server mỗi lần lưu, dù chỉ sửa
// 1 người, vừa chậm (payload lớn theo tổng số nhân viên) vừa hay báo "vừa bị người khác thay đổi" GIẢ vì
// so phiên bản của CẢ danh sách — xem routes/data.js nhánh isUsersPatchMode).
//
// Kiểm tra:
//   - Body dạng { __patchUser: {...} } (OBJECT) kích hoạt patch-mode — sửa 1 user hiện có, KHÔNG đụng
//     tới user khác trong danh sách.
//   - Tạo MỚI 1 user qua patch-mode (id chưa tồn tại) — vẫn chạy ĐỦ các validate của prepareUsersForSave()
//     (thiếu mật khẩu -> 400, không ghi gì).
//   - Patch-mode LUÔN đọc "users" MỚI NHẤT ngay trước khi gộp (withLockedAppDataValue) — mô phỏng 1 thay
//     đổi "từ nơi khác" xảy ra GIỮA 2 lượt patch liên tiếp, xác nhận thay đổi đó KHÔNG bị ghi đè mất (khác
//     hẳn kiểu "gửi nguyên mảng cũ" sẽ xoá mất thay đổi đó).
//   - Mọi luật nghiệp vụ hiện có vẫn áp dụng ĐẦY ĐỦ qua patch-mode: khoá tài khoản "admin" gốc toàn
//     quyền, assertAtLeastOneAdmin (không được gỡ quyền Admin của admin DUY NHẤT còn lại), nhật ký
//     "ADMIN_PERMS_REMOVED".
//   - Response trả "item" (bản ghi thật đã lưu, đã strip mật khẩu/PIN hash) + "usersVersion".
//   - Gate ADMIN_ONLY_KEYS vẫn áp dụng (không phải admin -> 403), không đi vòng được qua patch-mode.
//   - Body dạng MẢNG (classic, 13 nơi gọi khác — Nhập Excel/Gán Nhóm hàng loạt/Ma Trận Phân Quyền/Đặt
//     Lại Mật Khẩu Hàng Loạt...) hoàn toàn KHÔNG đổi hành vi, vẫn đi đúng nhánh cũ.
//
// Chạy: node server/tests/test-user-save-patch-mode.js
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

const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const NV1 = { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: {}, active: true };
const NV2 = { id: 3, username: 'nv2', name: 'Nhân Viên 2', dept: 'Phòng A', perms: { admin: true }, active: true };

let APP_DATA;
let currentIsAdmin = true;
function resetData() {
  APP_DATA = { users: [{ ...ADMIN }, { ...NV1 }, { ...NV2 }], permGroups: [], depts: ['Ban Giám Đốc', 'Phòng A', 'Phòng B'], stores: [] };
  currentIsAdmin = true;
}
resetData();

const systemLogs = [];
stubModule('lib/appData', {
  getAppDataValue: async (key) => APP_DATA[key],
  getAppDataValueWithVersion: async (key) => ({ value: APP_DATA[key], version: `v-${JSON.stringify(APP_DATA[key]).length}` }),
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} }),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: '2' }; },
  // withLockedAppDataValue (mô phỏng ĐÚNG hành vi thật đủ để kiểm tra "luôn đọc fresh"): mutatorFn nhận
  // APP_DATA[key] HIỆN TẠI (tại thời điểm gọi, không phải bản chụp cũ) — nếu test mutate APP_DATA.users
  // TRỰC TIẾP (mô phỏng "nơi khác vừa ghi") NGAY TRƯỚC khi gọi route, patch-mode vẫn phải thấy đúng bản
  // mới nhất đó.
  withLockedAppDataValue: async (key, fn) => { const result = await fn(APP_DATA[key]); APP_DATA[key] = result; return result; }
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => { req.user = { username: 'admin' }; req.freshUser = ADMIN; next(); },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => `HASHED(${p})`,
  isBcryptHash: () => false,
  validatePin: () => null
});
stubModule('lib/adminAuth', {
  isCurrentlyAdmin: async () => currentIsAdmin,
  isCurrentlyAdminOrUniformManage: async () => currentIsAdmin
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [], cascadeUsernameChangesToTaskAssignedBy: async () => 0 });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [], cascadeUsernameChangesToWorkItemAssignment: async () => 0 });
stubModule('lib/recordStore', { MIGRATED_COLLECTIONS: new Set(), getAllForCollectionCached: async () => [], getForCollectionByDeptCached: async () => [], getForCollectionByUsernameCached: async () => [], getForCollectionByColumnCached: async () => [] });
stubModule('lib/systemLogStore', { insertSystemLog: async (entry) => { systemLogs.push(entry); } });

const express = require('express');
const { createRunner, assertEqual, assert } = require('./testHarness');
const dataRoutes = require('../routes/data');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function api(method, urlPath, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('Patch-mode: sửa 1 field của nv1 -> CHỈ đúng nv1 đổi, nv2/admin GIỮ NGUYÊN', async () => {
      resetData();
      const patched = { ...NV1, phone: '0909999999' };
      const res = await api('POST', '/api/data/users', { __patchUser: patched });
      assertEqual(res.status, 200, `phải lưu thành công, got: ${JSON.stringify(res.body)}`);
      assertEqual(res.body.item.phone, '0909999999', 'item trả về phải đúng field vừa sửa');
      assertEqual(APP_DATA.users.length, 3, 'không được thêm/bớt user nào ngoài ý muốn');
      const saved = APP_DATA.users.find(u => u.id === 2);
      assertEqual(saved.phone, '0909999999', 'nv1 phải được cập nhật thật trong CSDL (mock)');
      const nv2 = APP_DATA.users.find(u => u.id === 3);
      assertEqual(nv2.name, 'Nhân Viên 2', 'nv2 (KHÔNG liên quan) phải giữ nguyên, không bị đụng');
      assert(!!res.body.usersVersion, 'phải trả kèm usersVersion để client tự đồng bộ DB._versions.users');
    });

    await run.run('Patch-mode: item trả về KHÔNG lộ mật khẩu/PIN hash (stripPasswords)', async () => {
      resetData();
      const patched = { ...NV1, pass: 'MatKhauMoi@2024' };
      const res = await api('POST', '/api/data/users', { __patchUser: patched });
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(res.body.item.pass, undefined, 'item KHÔNG được có field pass');
      assertEqual(res.body.item.pinHash, undefined, 'item KHÔNG được có field pinHash');
      assertEqual(res.body.item.mustChangePassword, true, 'đổi mật khẩu cho user khác phải tự bật mustChangePassword');
    });

    await run.run('Patch-mode: admin đặt mật khẩu MỚI cho người khác -> mustChangePassword=true + sessionVersion tăng (vô hiệu hoá phiên JWT cũ, prepareUsersForSave() chạy ĐỦ qua patch-mode)', async () => {
      resetData();
      const before = APP_DATA.users.find(u => u.id === 2);
      const priorSessionVersion = before.sessionVersion || 0;
      const patched = { ...before, pass: 'MatKhauMoiDoAdminDat@2024' };
      const res = await api('POST', '/api/data/users', { __patchUser: patched });
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(res.body.item.mustChangePassword, true, 'item trả về phải báo mustChangePassword=true');
      const saved = APP_DATA.users.find(u => u.id === 2);
      assertEqual(saved.mustChangePassword, true, 'CSDL (mock) phải lưu mustChangePassword=true');
      assertEqual(saved.sessionVersion, priorSessionVersion + 1, 'sessionVersion phải tăng (vô hiệu hoá phiên JWT cũ của người bị đặt mật khẩu mới)');
      assert(saved.pass === 'HASHED(MatKhauMoiDoAdminDat@2024)', `mật khẩu phải đi qua hashPassword() (mock trả "HASHED(...)"), không lưu plaintext — got: ${saved.pass}`);
    });

    await run.run('Patch-mode: tạo MỚI 1 user (id chưa tồn tại) -> thêm vào danh sách, đủ validate', async () => {
      resetData();
      const newUser = { id: 999, username: 'nv3', pass: 'MatKhau@2024', name: 'Nhân Viên 3', dept: 'Phòng B', perms: {}, active: true };
      const res = await api('POST', '/api/data/users', { __patchUser: newUser });
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(APP_DATA.users.length, 4, 'phải thêm đúng 1 user mới, giữ nguyên 3 user cũ');
      assertEqual(res.body.item.username, 'nv3', 'item trả về phải đúng user mới tạo');
    });

    await run.run('Patch-mode: tạo MỚI thiếu mật khẩu -> 400, KHÔNG thêm gì (vẫn đi qua đủ prepareUsersForSave())', async () => {
      resetData();
      const newUser = { id: 999, username: 'nv3', name: 'Nhân Viên 3', dept: 'Phòng B', perms: {}, active: true };
      const res = await api('POST', '/api/data/users', { __patchUser: newUser });
      assertEqual(res.status, 400, `phải bị chặn thiếu mật khẩu, got: ${JSON.stringify(res.body)}`);
      assertEqual(APP_DATA.users.length, 3, 'KHÔNG được thêm user nào khi bị chặn');
    });

    await run.run('Patch-mode: LUÔN đọc "users" MỚI NHẤT — thay đổi "từ nơi khác" giữa 2 lượt patch KHÔNG bị mất', async () => {
      resetData();
      // Lượt 1: sửa nv1.
      const res1 = await api('POST', '/api/data/users', { __patchUser: { ...NV1, phone: '0901111111' } });
      assertEqual(res1.status, 200, JSON.stringify(res1.body));
      // Mô phỏng "nơi khác" (VD tự đổi mật khẩu qua PATCH /api/auth/me) ghi thẳng vào APP_DATA.users
      // NGAY TRƯỚC lượt patch thứ 2 — mirror đúng tình huống thật gây 409 giả ở cơ chế CŨ.
      const nv2InDb = APP_DATA.users.find(u => u.id === 3);
      nv2InDb.name = 'Nhân Viên 2 (đã tự đổi tên ở nơi khác)';
      // Lượt 2: sửa admin (KHÔNG liên quan gì tới nv2) — patch-mode phải tự đọc fresh nên KHÔNG xoá mất
      // thay đổi "nơi khác" vừa xảy ra ở nv2.
      const res2 = await api('POST', '/api/data/users', { __patchUser: { ...ADMIN, email: 'admin@hcrc.vn' } });
      assertEqual(res2.status, 200, JSON.stringify(res2.body));
      const finalNv1 = APP_DATA.users.find(u => u.id === 2);
      const finalNv2 = APP_DATA.users.find(u => u.id === 3);
      const finalAdmin = APP_DATA.users.find(u => u.id === 1);
      assertEqual(finalNv1.phone, '0901111111', 'thay đổi lượt 1 (nv1) phải còn nguyên');
      assertEqual(finalNv2.name, 'Nhân Viên 2 (đã tự đổi tên ở nơi khác)', 'thay đổi "từ nơi khác" (nv2) KHÔNG được bị ghi đè mất — đây chính là điểm khác biệt so với cơ chế CŨ (gửi nguyên mảng cũ sẽ xoá mất thay đổi này)');
      assertEqual(finalAdmin.email, 'admin@hcrc.vn', 'thay đổi lượt 2 (admin) phải được áp dụng');
    });

    await run.run('Patch-mode: tài khoản "admin" gốc vẫn bị khoá cứng toàn quyền (không sửa perms qua patch được)', async () => {
      resetData();
      const res = await api('POST', '/api/data/users', { __patchUser: { ...ADMIN, perms: {} } });
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(res.body.item.perms.admin, true, 'tài khoản "admin" gốc phải LUÔN giữ perms.admin=true dù client gửi perms rỗng');
    });

    await run.run('Patch-mode: gỡ quyền Admin của ADMIN DUY NHẤT còn lại (ngoài "admin" gốc) -> 400 (assertAtLeastOneAdmin), không ghi gì', async () => {
      resetData();
      // Xoá quyền admin của "admin" gốc trước (mô phỏng đã có 1 lượt khác) để nv2 là admin DUY NHẤT còn
      // lại ngoài "admin" gốc — nhưng "admin" gốc luôn bị ép admin:true nên thực ra vẫn còn 1 admin, test
      // ĐÚNG tình huống: gỡ nv2 (perms.admin:false) KHÔNG vi phạm assertAtLeastOneAdmin vì "admin" gốc
      // vẫn còn — đổi kịch bản: thay "admin" gốc bằng user thường để nv2 là NGUỒN admin duy nhất.
      APP_DATA.users = [{ ...ADMIN, username: 'nonadmin', perms: {} }, { ...NV1 }, { ...NV2 }];
      const res = await api('POST', '/api/data/users', { __patchUser: { ...NV2, perms: {} } });
      assertEqual(res.status, 400, `phải chặn KHÔNG CÒN ADMIN NÀO, got: ${JSON.stringify(res.body)}`);
      assertEqual(APP_DATA.users.find(u => u.id === 3).perms.admin, true, 'KHÔNG được ghi đè — nv2 vẫn phải còn admin:true sau khi bị chặn');
    });

    await run.run('Patch-mode: gỡ quyền Admin của nv2 (CÒN "admin" gốc) -> lưu OK + ghi Nhật Ký ADMIN_PERMS_REMOVED', async () => {
      resetData();
      systemLogs.length = 0;
      const res = await api('POST', '/api/data/users', { __patchUser: { ...NV2, perms: {} } });
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(res.body.item.perms.admin, undefined, 'nv2 phải mất quyền admin sau khi lưu');
      const log = systemLogs.find(l => l.actionType === 'ADMIN_PERMS_REMOVED' && l.targetObject === 'nv2');
      assert(!!log, 'phải ghi Nhật Ký Hệ Thống ADMIN_PERMS_REMOVED cho nv2 (LƯỚI AN TOÀN hiện có, không được bỏ sót ở patch-mode)');
    });

    await run.run('Patch-mode: KHÔNG phải Quản Trị Viên -> 403, không ghi gì (gate ADMIN_ONLY_KEYS vẫn áp dụng)', async () => {
      resetData();
      currentIsAdmin = false;
      const res = await api('POST', '/api/data/users', { __patchUser: { ...NV1, phone: '0900000000' } });
      assertEqual(res.status, 403, `phải bị chặn 403, got: ${JSON.stringify(res.body)}`);
      assertEqual(APP_DATA.users.find(u => u.id === 2).phone, undefined, 'KHÔNG được ghi gì khi bị chặn quyền');
      currentIsAdmin = true;
    });

    await run.run('Đối chứng: body dạng MẢNG (classic, 13 nơi gọi khác) hoàn toàn KHÔNG đổi hành vi', async () => {
      resetData();
      const payload = [{ ...ADMIN }, { ...NV1, phone: '0908888888' }, { ...NV2 }];
      const res = await api('POST', '/api/data/users', payload);
      assertEqual(res.status, 200, JSON.stringify(res.body));
      assertEqual(res.body.item, undefined, 'classic array-mode KHÔNG trả "item" (chỉ patch-mode mới có)');
      assertEqual(APP_DATA.users.find(u => u.id === 2).phone, '0908888888', 'vẫn ghi đúng như cơ chế cũ');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
