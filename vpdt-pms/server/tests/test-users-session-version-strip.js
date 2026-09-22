// server/tests/test-users-session-version-strip.js
//
// BUG THẬT đã sửa (báo cáo thực tế 10/2026: admin chỉ mở ĐÚNG 1 màn hình/1 phiên vẫn nhận cảnh báo
// "⚠️ Đúng bản ghi người dùng bạn đang sửa vừa bị thay đổi ở nơi khác" mỗi khi sửa hồ sơ 1 người dùng)
// — nguyên nhân: sessionVersion (routes/auth.js tăng ở MỌI lượt đăng nhập thành công từ đợt "1 tài khoản
// 1 kết nối", xem lib/auth.js requireAuth so payload.sv) trước đây (1) vẫn lộ ra qua GET /api/data nên
// bản chụp DB.users trên trình duyệt LUÔN có thể lệch với CSDL chỉ vì có người đăng nhập lại — không
// liên quan gì tới nội dung admin đang sửa — khiến retryUsersSaveAfterConflict() (public/js/core.js) so
// sánh sâu 2 bản ghi thấy khác nhau và báo "xung đột thật" một cách oan uổng; và (2) routes/data.js
// prepareUsersForSave() vẫn tin nguyên "u.sessionVersion" do client gửi lên khi ghi NGUYÊN MẢNG "users"
// — nếu client đang cầm bản CŨ, lượt lưu 1 field bất kỳ (VD số điện thoại) sẽ ÂM THẦM GHI ĐÈ
// sessionVersion thật về giá trị CŨ, có thể vô hiệu hoá NGAY phiên đăng nhập vừa cấp của người khác.
//
// Test 2 vế của fix:
//   1. GET /api/data/users — sessionVersion không còn xuất hiện trong response (giống pass/pinHash...).
//   2. POST /api/data/users — "u.sessionVersion" do client gửi lên bị BỎ QUA hoàn toàn, CSDL luôn giữ
//      đúng giá trị đang có (trừ khi CHÍNH lượt lưu này đặt PIN mới cho user đó — vẫn phải tăng đúng
//      như trước, không bị fix này chặn nhầm).
//
// Chạy: node server/tests/test-users-session-version-strip.js
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

const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true, sessionVersion: 1 };
const NV1 = { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: {}, active: true, sessionVersion: 7 };

let APP_DATA;
function resetData() {
  APP_DATA = { users: [{ ...ADMIN }, { ...NV1 }], permGroups: [] };
}
resetData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => APP_DATA[key],
  getAppDataValueWithVersion: async (key) => ({ value: APP_DATA[key], version: '1' }),
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} }),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: '2' }; },
  withLockedAppDataValue: async (key, fn) => { const result = await fn(APP_DATA[key]); APP_DATA[key] = result; return result; }
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => { req.user = { username: 'admin' }; req.freshUser = ADMIN; next(); },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => `hashed:${p}`,
  isBcryptHash: () => false,
  validatePin: () => null
});
stubModule('lib/adminAuth', {
  isCurrentlyAdmin: async () => true,
  isCurrentlyAdminOrUniformManage: async () => true
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', { MIGRATED_COLLECTIONS: new Set(), getAllForCollectionCached: async () => [], getForCollectionByDeptCached: async () => [], getForCollectionByUsernameCached: async () => [], getForCollectionByColumnCached: async () => [] });

const express = require('express');
const { createRunner, assertEqual } = require('./testHarness');
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
    await run.run('GET /api/data/users — sessionVersion KHÔNG xuất hiện trong response (như pass/pinHash)', async () => {
      resetData();
      const res = await api('GET', '/api/data/users');
      assertEqual(res.status, 200, `phải đọc thành công, got: ${JSON.stringify(res.body)}`);
      const nv1 = res.body.find(u => u.username === 'nv1');
      assertEqual(nv1 && !('sessionVersion' in nv1), true, `sessionVersion phải bị lọc khỏi GET /api/data/users, got: ${JSON.stringify(nv1)}`);
    });

    await run.run('POST /api/data/users — sessionVersion client gửi lên (bản CŨ/giả) bị BỎ QUA, CSDL giữ nguyên giá trị thật', async () => {
      resetData();
      const payload = [
        { ...ADMIN },
        // Client đang cầm bản CŨ (sessionVersion=7 lúc tải trang), thật ra CSDL đã tăng lên 9 do người
        // này vừa đăng nhập lại — client KHÔNG hề biết field này (đã bị GET lọc mất) nên gửi lên bất kỳ
        // giá trị nào ở đây (kể cả cố tình gửi số khác) đều phải bị bỏ qua hoàn toàn.
        { id: 2, username: 'nv1', name: 'Nhân Viên 1 (sửa SĐT)', dept: 'Phòng A', perms: {}, active: true, sessionVersion: 999 }
      ];
      APP_DATA.users[1].sessionVersion = 9; // giả lập: CSDL thật đã tăng do người này vừa đăng nhập lại
      const res = await api('POST', '/api/data/users', payload);
      assertEqual(res.status, 200, `phải lưu thành công, got: ${JSON.stringify(res.body)}`);
      const saved = APP_DATA.users.find(u => u.username === 'nv1');
      assertEqual(saved.sessionVersion, 9, `sessionVersion phải giữ ĐÚNG giá trị CSDL (9), KHÔNG bị client (999) ghi đè, got: ${saved.sessionVersion}`);
      assertEqual(saved.name, 'Nhân Viên 1 (sửa SĐT)', 'field admin THẬT SỰ sửa (name) vẫn phải được ghi đúng');
    });

    await run.run('POST /api/data/users — đặt PIN mới cho user khác VẪN tăng sessionVersion như trước (fix không chặn nhầm)', async () => {
      resetData();
      const payload = [
        { ...ADMIN },
        { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: {}, active: true, pin: '123456' }
      ];
      const res = await api('POST', '/api/data/users', payload);
      assertEqual(res.status, 200, `phải lưu thành công, got: ${JSON.stringify(res.body)}`);
      const saved = APP_DATA.users.find(u => u.username === 'nv1');
      assertEqual(saved.sessionVersion, 8, `đặt PIN mới phải tăng sessionVersion (7 -> 8) để đăng xuất phiên cũ, got: ${saved.sessionVersion}`);
    });

    await run.run('POST /api/data/users — tạo user MỚI không có sessionVersion (không lấy nhầm giá trị client gửi)', async () => {
      resetData();
      const payload = [
        { ...ADMIN },
        { ...NV1 },
        { id: 3, username: 'nv3', name: 'Nhân Viên 3', dept: 'Phòng B', perms: {}, active: true, sessionVersion: 42 }
      ];
      const res = await api('POST', '/api/data/users', payload);
      assertEqual(res.status, 200, `phải lưu thành công, got: ${JSON.stringify(res.body)}`);
      const saved = APP_DATA.users.find(u => u.username === 'nv3');
      assertEqual(saved.sessionVersion, undefined, `user MỚI không có "prior" -> sessionVersion phải là undefined, KHÔNG lấy 42 do client tự gửi, got: ${saved.sessionVersion}`);
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
