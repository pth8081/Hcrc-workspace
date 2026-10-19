// server/tests/test-user-import-login-e2e.js
//
// Test THẬT theo đúng đường đi thật của server (không mock fetch phía trình duyệt như
// test-admin-users-permgroups.js) — dựng 2 router THẬT (routes/data.js + routes/auth.js) trên 1 Express
// app, dùng lib/auth.js THẬT (bcrypt hash/verify thật, không stub), chỉ stub lib/appData (in-memory thay
// SQL Server) + vài lib phụ không liên quan (taskStore/operationWorkItemStore/recordStore/systemLogStore/
// adminAuth) để không cần SQL Server thật.
//
// Mục tiêu: tái hiện ĐÚNG luồng "Import Excel Người Dùng" (module-admin-userstaging.js
// confirmUsersImport() — DB.users.push({..., pass: <mật khẩu thô đọc từ file Excel>, ...}) rồi gửi
// NGUYÊN mảng users lên POST /api/data/users) và xác nhận: sau khi import, người dùng mới ĐĂNG NHẬP
// ĐƯỢC bằng ĐÚNG mật khẩu đã gõ trong Excel (không phải "báo sai tài khoản hoặc mật khẩu").
//
// Chạy: node server/tests/test-user-import-login-e2e.js
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-e2e-import-login-only';
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

let APP_DATA;
function resetData() {
  // depts (Đợt 5, mức Thấp — prepareUsersForSave() giờ validate dept khi THAY ĐỔI/GÁN MỚI so với danh
  // mục, xem routes/data.js) — seed đủ các dept dùng trong file này ('Ban Giám Đốc' cho admin, 'Phòng
  // Nhân Sự' cho user mới import, 'Phòng A' cho user ghi đè sẵn có) để không bị 400 oan.
  APP_DATA = { users: [{ ...ADMIN }], permGroups: [], depts: ['Ban Giám Đốc', 'Phòng Nhân Sự', 'Phòng A'], stores: [] };
}
resetData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => APP_DATA[key],
  getAppDataValueCached: async (key) => APP_DATA[key], // dùng bởi lib/auth.js THẬT (không stub)
  getAppDataValueWithVersion: async (key) => ({ value: APP_DATA[key], version: '1' }),
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} }),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: '2' }; },
  withLockedAppDataValue: async (key, fn) => { const result = await fn(APP_DATA[key]); APP_DATA[key] = result; return result; }
});
stubModule('lib/adminAuth', {
  isCurrentlyAdmin: async () => true,
  isCurrentlyAdminOrUniformManage: async () => true
});
// cascadeUsernameChangesToTaskAssignedBy() (re-audit lần 9, lib/taskStore.js) gọi hàm này khi lưu
// 'users' có đổi tên/xoá username — không liên quan tới bài test này, no-op để không vỡ route thật.
stubModule('lib/taskStore', { getAllTasksCached: async () => [], cascadeUsernameChangesToTaskAssignedBy: async () => 0 });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', { MIGRATED_COLLECTIONS: new Set(), getAllForCollectionCached: async () => [], getForCollectionByDeptCached: async () => [], getForCollectionByUsernameCached: async () => [], getForCollectionByColumnCached: async () => [] });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

const express = require('express');
const { createRunner, assert, assertEqual } = require('./testHarness');
// lib/auth.js: giữ THẬT hashPassword/verifyPassword/signToken (bcrypt thật) — CHỈ thay requireAuth/
// blockIfMustChangePassword bằng bản bỏ qua kiểm tra cookie JWT (routes/data.js tự require('../lib/auth')
// lấy requireAuth ở top-level, nên phải override NGAY TRONG cache trước khi routes/data.js được require,
// không thể chèn middleware ngoài để "ghi đè" 1 hàm đã được destructure sẵn).
const realAuth = require('../lib/auth');
stubModule('lib/auth', {
  ...realAuth,
  requireAuth: (req, res, next) => { req.user = { username: 'admin' }; req.freshUser = APP_DATA.users.find(u => u.username === 'admin'); next(); },
  blockIfMustChangePassword: (req, res, next) => next()
});
const dataRoutes = require('../routes/data');
const authRoutes = require('../routes/auth');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
  app.use('/api/auth', authRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function main() {
  const server = await startApp();
  const run = createRunner();
  try {
    await run.run('Import Excel tạo user mới (mật khẩu thô từ file) -> đăng nhập được ĐÚNG mật khẩu đã gõ', async () => {
      resetData();
      // Mirror ĐÚNG confirmUsersImport() (module-admin-userstaging.js): DB.users.push({..., pass: <thô>,
      // ...}) rồi gửi NGUYÊN mảng (kể cả admin có sẵn, pass đã bị stripPasswords() lọc khỏi GET nên
      // client KHÔNG có field pass cho user cũ — mirror bằng cách không gửi field pass cho admin).
      const desired = [
        { ...APP_DATA.users[0], pass: undefined },
        {
          id: Date.now(), username: 'nv.excel1', pass: 'MatKhau@2024', name: 'Nguyễn Văn Excel',
          email: 'nv.excel1@company.com', phone: '0901111111', dept: 'Phòng Nhân Sự', jobTitle: 'Nhân viên',
          posType: 'HO', startDate: '', khoiBan: '', perms: {}
        }
      ];
      const saveRes = await fetch(`http://127.0.0.1:${PORT}/api/data/users`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(desired)
      });
      assertEqual(saveRes.status, 200, `Lưu users (import) phải thành công, không phải ${saveRes.status}: ${await saveRes.text()}`);

      // Đúng thứ tự confirmUsersImport() thật: sau khi lưu xong, KHÔNG reload trang — người admin bấm
      // "Đã thêm mới" rồi báo nhân viên đăng nhập ngay bằng mật khẩu trong file Excel.
      const loginRes = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nv.excel1', password: 'MatKhau@2024' })
      });
      const loginBody = await loginRes.json().catch(() => ({}));
      assertEqual(loginRes.status, 200, `Đăng nhập bằng ĐÚNG mật khẩu vừa import phải thành công (200), không phải ${loginRes.status}: ${JSON.stringify(loginBody)}`);
      assert(!loginBody.error, `Không được có lỗi khi đăng nhập đúng: ${JSON.stringify(loginBody)}`);

      // Đối chứng: sai mật khẩu vẫn phải bị từ chối (không phải lỗ hổng đi ngược lại, ai gõ gì cũng vào).
      const wrongRes = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nv.excel1', password: 'SaiMatKhau@2024' })
      });
      assertEqual(wrongRes.status, 401, 'Sai mật khẩu phải bị từ chối (401)');
    });

    await run.run('Import Excel GHI ĐÈ thông tin user đã có (không đụng mật khẩu) -> vẫn đăng nhập được bằng mật khẩu CŨ', async () => {
      resetData();
      // Bước 1: tạo user thật trước (mirror form tạo tay), có mật khẩu ban đầu.
      const created = [
        { ...APP_DATA.users[0], pass: undefined },
        { id: 555, username: 'nv.old', pass: 'MatKhauCu@2024', name: 'Nhân Viên Cũ', email: 'old@company.com', phone: '0900000000', dept: 'Phòng A', jobTitle: null, posType: 'HO', startDate: '', khoiBan: '', perms: {} }
      ];
      await fetch(`http://127.0.0.1:${PORT}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(created) });

      // Bước 2: import Excel overwrite (đúng nhánh toOverwrite.forEach() — CHỈ sửa tên/email/SĐT/phòng
      // ban/chức danh/vị trí/Khối-Ban/ngày vào làm việc, KHÔNG đụng username/pass/perms/groupIds).
      const afterOverwrite = await fetch(`http://127.0.0.1:${PORT}/api/data/users`).then(r => r.json());
      const existing = afterOverwrite.find(u => u.username === 'nv.old');
      existing.name = 'Nhân Viên Cũ (Đã Cập Nhật)'; existing.email = 'new-email@company.com';
      // pass KHÔNG có trong response GET (đã bị stripPasswords() lọc) — mirror đúng: existing.pass vẫn
      // là undefined ở đây, giữ nguyên hành vi thật của toOverwrite.forEach() không set lại pass.
      const overwritePayload = [{ ...afterOverwrite[0], pass: undefined }, existing];
      const saveRes = await fetch(`http://127.0.0.1:${PORT}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(overwritePayload) });
      assertEqual(saveRes.status, 200, 'Lưu users (overwrite) phải thành công');

      const loginOldPass = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'nv.old', password: 'MatKhauCu@2024' }) });
      assertEqual(loginOldPass.status, 200, 'Sau khi import overwrite (không đụng mật khẩu), phải vẫn đăng nhập được bằng mật khẩu CŨ');
    });

    // 3 scenario dưới đây (Đợt 5, mức Thấp) — prepareUsersForSave() (routes/data.js) giờ validate dept
    // khi THAY ĐỔI/GÁN MỚI so với danh mục DB.depts/DB.stores, chặn đúng khe hở "Nhập Excel chỉ validate
    // CLIENT-SIDE (validateImportedUserRow()), điểm ghi THẬT không tự kiểm lại".
    await run.run('(Đợt 5) Import/tạo user MỚI với dept KHÔNG có trong danh mục -> 400, nêu rõ tên dept + username', async () => {
      resetData();
      const desired = [
        { ...APP_DATA.users[0], pass: undefined },
        { id: 777, username: 'nv.baddept', pass: 'MatKhau@2024', name: 'NV Dept Sai', email: 'bad@company.com', phone: '0900000001', dept: 'Phòng Không Tồn Tại', jobTitle: null, posType: 'HO', startDate: '', khoiBan: '', perms: {} }
      ];
      const saveRes = await fetch(`http://127.0.0.1:${PORT}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(desired) });
      const body = await saveRes.json().catch(() => ({}));
      assertEqual(saveRes.status, 400, `Phải bị chặn 400, không phải ${saveRes.status}: ${JSON.stringify(body)}`);
      assert((body.error || '').includes('Phòng Không Tồn Tại'), `Thông báo lỗi phải nêu rõ tên dept sai: ${JSON.stringify(body)}`);
      assert((body.error || '').includes('nv.baddept'), `Thông báo lỗi phải nêu rõ username: ${JSON.stringify(body)}`);
    });

    await run.run('(Đợt 5) User ĐÃ CÓ với dept "mồ côi" (không còn trong danh mục) — sửa field KHÁC (name), GIỮ NGUYÊN dept cũ -> vẫn lưu được, KHÔNG bị chặn oan', async () => {
      resetData();
      // Giả lập 1 user cũ còn sót dept không có trong danh mục hiện tại (VD phòng ban đã bị xoá hẳn từ
      // trước, không phải đổi tên — cascadeStoreRename() chỉ xử lý ĐỔI TÊN, không xử lý XOÁ HẲN).
      APP_DATA.users.push({ id: 888, username: 'nv.orphandept', name: 'NV Mồ Côi Dept', email: 'orphan@company.com', phone: '0900000002', dept: 'Phòng Đã Xoá Từ Lâu', jobTitle: null, posType: 'HO', startDate: '', khoiBan: '', perms: {} });
      const desired = APP_DATA.users.map(u => ({ ...u, pass: undefined }));
      const target = desired.find(u => u.username === 'nv.orphandept');
      target.name = 'NV Mồ Côi Dept (Đã Sửa Tên)'; // KHÔNG đụng field dept.
      const saveRes = await fetch(`http://127.0.0.1:${PORT}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(desired) });
      const body = await saveRes.json().catch(() => ({}));
      assertEqual(saveRes.status, 200, `Giữ nguyên dept cũ (dù mồ côi) khi sửa field khác phải vẫn lưu được: ${JSON.stringify(body)}`);
    });

    await run.run('(Đợt 5) User ĐÃ CÓ dept "mồ côi" — ĐỔI SANG dept khác CŨNG không có trong danh mục -> vẫn bị chặn 400 (không phải chỉ giữ nguyên mới được miễn)', async () => {
      resetData();
      APP_DATA.users.push({ id: 999, username: 'nv.orphandept2', name: 'NV Mồ Côi 2', email: 'orphan2@company.com', phone: '0900000003', dept: 'Phòng Đã Xoá Từ Lâu', jobTitle: null, posType: 'HO', startDate: '', khoiBan: '', perms: {} });
      const desired = APP_DATA.users.map(u => ({ ...u, pass: undefined }));
      const target = desired.find(u => u.username === 'nv.orphandept2');
      target.dept = 'Phòng Khác Cũng Sai'; // ĐỔI sang 1 giá trị KHÁC vẫn sai, không phải giữ nguyên.
      const saveRes = await fetch(`http://127.0.0.1:${PORT}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(desired) });
      assertEqual(saveRes.status, 400, 'Đổi dept mồ côi sang 1 giá trị MỚI cũng sai phải vẫn bị chặn (không phải "đã từng sai thì sai tiếp cũng được")');
    });

    await run.run('(Đợt 5) Đổi dept sang giá trị HỢP LỆ (có trong danh mục) -> lưu thành công', async () => {
      resetData();
      const desired = [
        { ...APP_DATA.users[0], pass: undefined, dept: 'Phòng Nhân Sự' } // admin đổi dept sang 1 giá trị hợp lệ khác.
      ];
      const saveRes = await fetch(`http://127.0.0.1:${PORT}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(desired) });
      const body = await saveRes.json().catch(() => ({}));
      assertEqual(saveRes.status, 200, `Đổi dept sang giá trị hợp lệ phải lưu được: ${JSON.stringify(body)}`);
    });

    await run.run('(Đợt 5) dept RỖNG ("để trống nếu không chọn") -> luôn hợp lệ, không bị chặn', async () => {
      resetData();
      const desired = [
        { ...APP_DATA.users[0], pass: undefined, dept: '' }
      ];
      const saveRes = await fetch(`http://127.0.0.1:${PORT}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(desired) });
      const body = await saveRes.json().catch(() => ({}));
      assertEqual(saveRes.status, 200, `dept rỗng phải luôn hợp lệ: ${JSON.stringify(body)}`);
    });
  } finally {
    server.close();
  }
  run.summary();
  process.exit(process.exitCode || 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
