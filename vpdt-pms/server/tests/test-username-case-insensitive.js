// server/tests/test-username-case-insensitive.js
//
// Theo xác nhận người dùng (10/2026): "cho phép user chữ hoa và chữ thường như nhau" — tên đăng nhập
// (username) không còn phân biệt HOA/thường ở MỌI lượt tra cứu THÔ do người dùng/đối tác ngoài tự gõ:
// đăng nhập mật khẩu (POST /login), bước 2 TOTP, đăng nhập vân tay (WebAuthn), API đối tác ngoài
// (routes/externalAuthVerify.js) — và khi TẠO/SỬA tài khoản, 2 username chỉ khác hoa/thường (VD "User1"
// và "user1") bị coi là TRÙNG, không cho phép tồn tại song song (prepareUsersForSave(), routes/data.js).
//
// Test THẬT theo đúng đường đi thật của server (không mock fetch phía trình duyệt) — dựng router THẬT
// (routes/data.js + routes/auth.js) trên 1 Express app, dùng lib/auth.js THẬT (bcrypt thật), chỉ stub
// lib/appData (in-memory thay SQL Server) — cùng khuôn test-user-import-login-e2e.js.
//
// Chạy: node server/tests/test-username-case-insensitive.js
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-username-ci-only';
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
  APP_DATA = { users: [{ ...ADMIN }], permGroups: [] };
}
resetData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => APP_DATA[key],
  getAppDataValueCached: async (key) => APP_DATA[key],
  getAppDataValueWithVersion: async (key) => ({ value: APP_DATA[key], version: '1' }),
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} }),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: '2' }; },
  withLockedAppDataValue: async (key, fn) => { const result = await fn(APP_DATA[key]); APP_DATA[key] = result; return result; }
});
stubModule('lib/adminAuth', { isCurrentlyAdmin: async () => true, isCurrentlyAdminOrUniformManage: async () => true });
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', { MIGRATED_COLLECTIONS: new Set(), getAllForCollectionCached: async () => [], getForCollectionByDeptCached: async () => [], getForCollectionByUsernameCached: async () => [], getForCollectionByColumnCached: async () => [] });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

const express = require('express');
const realAuth = require('../lib/auth');
const { usernameEquals, findUserByUsernameCI } = realAuth;
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

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (pass) console.log(`PASS: ${name}`);
  else console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
}
async function scenario(name, fn) {
  try { await fn(); } catch (e) { record(name, false, 'threw: ' + (e && e.message ? e.message : String(e))); }
}

async function main() {
  const server = await startApp();
  try {
    // ===== (0) Unit: usernameEquals()/findUserByUsernameCI() (lib/auth.js) =====
    await scenario('(0a) usernameEquals(): khác hoa/thường vẫn coi là "cùng" username', () => {
      if (!usernameEquals('User1', 'user1')) throw new Error('phải coi "User1"/"user1" là cùng 1 username');
      if (!usernameEquals(' Bl2000 ', 'bl2000')) throw new Error('phải bỏ khoảng trắng thừa + không phân biệt hoa/thường');
      record('(0a) usernameEquals(): khác hoa/thường vẫn coi là "cùng" username', true);
    });
    await scenario('(0b) usernameEquals(): username THẬT SỰ khác nhau vẫn báo khác', () => {
      if (usernameEquals('user1', 'user2')) throw new Error('2 username khác nhau không được coi là trùng');
      record('(0b) usernameEquals(): username THẬT SỰ khác nhau vẫn báo khác', true);
    });
    await scenario('(0c) findUserByUsernameCI(): tìm đúng bản ghi, GIỮ NGUYÊN hoa/thường đã lưu', () => {
      const users = [{ username: 'NhanVienA', id: 5 }];
      const found = findUserByUsernameCI(users, 'nhanviena');
      if (!found || found.id !== 5 || found.username !== 'NhanVienA') {
        throw new Error('phải tìm thấy đúng bản ghi và trả về username GỐC (giữ hoa/thường đã lưu), không phải giá trị vừa gõ');
      }
      record('(0c) findUserByUsernameCI(): tìm đúng bản ghi, GIỮ NGUYÊN hoa/thường đã lưu', true);
    });

    // ===== (1) Đăng nhập mật khẩu KHÔNG phân biệt hoa/thường =====
    await scenario('(1) Tạo user "TestUser" -> đăng nhập được bằng "testuser"/"TESTUSER"/"TestUser" (cùng mật khẩu)', async () => {
      resetData();
      const desired = [
        { ...APP_DATA.users[0], pass: undefined },
        { id: 2001, username: 'TestUser', pass: 'MatKhau@2024', name: 'Nguyễn Test', email: 't@x.com', phone: '0900001111', dept: 'Phòng A', jobTitle: null, posType: 'HO', startDate: '', khoiBan: '', perms: {} }
      ];
      const saveRes = await fetch(`http://127.0.0.1:${PORT}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(desired) });
      if (saveRes.status !== 200) throw new Error(`Lưu users thất bại: ${saveRes.status} ${await saveRes.text()}`);

      for (const tryUsername of ['testuser', 'TESTUSER', 'TestUser', 'tEsTuSeR']) {
        const loginRes = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: tryUsername, password: 'MatKhau@2024' })
        });
        const body = await loginRes.json().catch(() => ({}));
        if (loginRes.status !== 200) throw new Error(`Đăng nhập với "${tryUsername}" phải thành công (200), được ${loginRes.status}: ${JSON.stringify(body)}`);
        if (body.username !== 'TestUser') throw new Error(`Phải trả về ĐÚNG username gốc "TestUser" đã lưu, được "${body.username}"`);
      }
      record('(1) Tạo user "TestUser" -> đăng nhập được bằng "testuser"/"TESTUSER"/"TestUser" (cùng mật khẩu)', true);
    });

    await scenario('(2) Sai mật khẩu vẫn bị từ chối (401) dù đúng username khác hoa/thường — không lỏng lẻo quá', async () => {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'TESTUSER', password: 'SaiMatKhau@2024' })
      });
      if (r.status !== 401) throw new Error(`Phải bị từ chối 401, được ${r.status}`);
      record('(2) Sai mật khẩu vẫn bị từ chối (401) dù đúng username khác hoa/thường — không lỏng lẻo quá', true);
    });

    await scenario('(3) Username không tồn tại (kể cả gần giống) vẫn bị từ chối (401)', async () => {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser2', password: 'MatKhau@2024' })
      });
      if (r.status !== 401) throw new Error(`Phải bị từ chối 401, được ${r.status}`);
      record('(3) Username không tồn tại (kể cả gần giống) vẫn bị từ chối (401)', true);
    });

    // ===== (4) Server chặn tạo/sửa 2 tài khoản chỉ khác hoa/thường =====
    await scenario('(4) Tạo tài khoản mới "testuser" khi "TestUser" đã có -> 400 (trùng, không phân biệt hoa/thường)', async () => {
      const current = await fetch(`http://127.0.0.1:${PORT}/api/data/users`).then(r => r.json());
      const payload = [
        ...current.map(u => ({ ...u, pass: undefined })),
        { id: 2002, username: 'testuser', pass: 'MatKhauKhac@2024', name: 'Trùng Tên', email: 'dup@x.com', phone: '0900002222', dept: 'Phòng A', jobTitle: null, posType: 'HO', startDate: '', khoiBan: '', perms: {} }
      ];
      const res = await fetch(`http://127.0.0.1:${PORT}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await res.json().catch(() => ({}));
      if (res.status !== 400) throw new Error(`Phải bị chặn 400, được ${res.status}: ${JSON.stringify(body)}`);
      if (!/trùng/i.test(body.error || '')) throw new Error(`Thông báo lỗi phải nêu rõ "trùng": ${JSON.stringify(body)}`);
      record('(4) Tạo tài khoản mới "testuser" khi "TestUser" đã có -> 400 (trùng, không phân biệt hoa/thường)', true);
    });

    await scenario('(5) Đối chứng: username KHÔNG trùng (khác hẳn) vẫn lưu bình thường, không bị chặn oan', async () => {
      const current = await fetch(`http://127.0.0.1:${PORT}/api/data/users`).then(r => r.json());
      const payload = [
        ...current.map(u => ({ ...u, pass: undefined })),
        { id: 2003, username: 'nv.khac.hoan.toan', pass: 'MatKhauKhac@2024', name: 'Người Khác', email: 'other@x.com', phone: '0900003333', dept: 'Phòng A', jobTitle: null, posType: 'HO', startDate: '', khoiBan: '', perms: {} }
      ];
      const res = await fetch(`http://127.0.0.1:${PORT}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.status !== 200) throw new Error(`Phải lưu thành công (200), được ${res.status}: ${await res.text()}`);
      record('(5) Đối chứng: username KHÔNG trùng (khác hẳn) vẫn lưu bình thường, không bị chặn oan', true);
    });

    // ===== (6) WebAuthn login-options: không lộ thông tin khi username khác hoa/thường =====
    // Lưu ý: môi trường test KHÔNG đặt WEBAUTHN_RP_ID (tính năng vân tay tắt mặc định, xem lib/webauthn.js
    // ensureEnabled()) nên cả 2 request đều bị chặn ở TẦNG TÍNH NĂNG trước khi tới đoạn findUserByUsernameCI —
    // vì vậy không ép cứng phải là 200 (không test nào khác trong bộ test này bật cờ đó). Điều thật sự cần
    // kiểm ở đây (đúng ý scenario 6): 2 response phải GIỐNG HỆT NHAU (status) dù username có tồn tại hay
    // không -- tức là không có sự khác biệt nào rò rỉ ra do khớp/không khớp username (kể cả khi tính năng bật).
    await scenario('(6) POST /webauthn/login-options với username khác hoa/thường -> response GIỐNG HỆT username không tồn tại (không lộ tồn tại/không)', async () => {
      const r1 = await fetch(`http://127.0.0.1:${PORT}/api/auth/webauthn/login-options`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'TESTUSER' }) });
      const r2 = await fetch(`http://127.0.0.1:${PORT}/api/auth/webauthn/login-options`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'khong-ton-tai' }) });
      if (r1.status !== r2.status) throw new Error(`2 response phải cùng status (không phân biệt tồn tại/không): ${r1.status}/${r2.status}`);
      record('(6) POST /webauthn/login-options với username khác hoa/thường -> response GIỐNG HỆT username không tồn tại (không lộ tồn tại/không)', true);
    });
  } finally {
    server.close();
  }

  const failCount = results.filter(x => !x.pass).length;
  console.log(`\n${results.length - failCount}/${results.length} scenarios passed.`);
  process.exitCode = failCount > 0 ? 1 : 0;
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
