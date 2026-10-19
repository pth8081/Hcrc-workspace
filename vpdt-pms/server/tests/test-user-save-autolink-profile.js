// server/tests/test-user-save-autolink-profile.js
//
// Regression test cho MỞ RỘNG tự động liên kết tài khoản VPDT — chiều "tạo/sửa/nhập user MỚI, hồ sơ nhân
// sự đã có sẵn" (11/2026, theo yêu cầu người dùng xác nhận sau khi xem demo: "Có, tôi xác nhận bạn thực
// hiện đi" — trước đây chiều này CHỈ gợi ý khi HR tự mở lại hồ sơ ra xem + bấm xác nhận, nay tự liên kết
// NGAY lúc "users" được lưu, không cần mở hồ sơ). Xem autoLinkUnlinkedProfiles() ở lib/employeeProfile.js
// (tái dùng NGUYÊN VẸN findAutoLinkableAccount() đã có — cùng 1 luật khớp cho cả 2 chiều) + điểm gọi mới ở
// routes/data.js (POST /api/data/users, SAU KHI ghi "users" thành công).
//
//   1. Tạo user MỚI (active) -> hồ sơ CHƯA liên kết trùng Mã NV == username -> tự liên kết NGAY.
//   2. Tạo user MỚI nhưng active:false (tài khoản khoá) -> KHÔNG tự liên kết.
//   3. Hồ sơ ĐÃ liên kết 1 username KHÁC từ trước -> KHÔNG bị ghi đè khi có user mới trùng Mã NV.
//   4. Username đã bị 1 hồ sơ KHÁC "chiếm" (employeeCode khác) -> hồ sơ đang xét KHÔNG tự liên kết nhầm.
//   5. Không có hồ sơ nào khớp -> lưu users bình thường, không lỗi, không side-effect gì.
//   6. Lưu "users" vì 1 LÝ DO HOÀN TOÀN KHÁC (sửa field user không liên quan) vẫn quét + tự liên kết bất kỳ
//      hồ sơ nào đang chờ khớp — không chỉ áp dụng cho đúng user vừa tạo/sửa trong request đó.
//
// Chạy: node server/tests/test-user-save-autolink-profile.js
'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-user-save-autolink-only';
const http = require('http');
const path = require('path');
const assert = require('assert');
const express = require('express');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
}

const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };

async function main() {
  const employeeProfileLib = require('../lib/employeeProfile');

  let APP_DATA;
  function resetData() {
    APP_DATA = {
      users: [{ ...ADMIN }],
      permGroups: [],
      // depts (Đợt 5, mức Thấp — prepareUsersForSave() giờ validate dept khi THAY ĐỔI so với danh mục,
      // xem routes/data.js) — seed đủ dept dùng trong file này ('Ban Giám Đốc' cho admin, 'Phòng Mới
      // Đổi' cho scenario đổi dept admin) để không bị 400 oan.
      depts: ['Ban Giám Đốc', 'Phòng Mới Đổi'],
      stores: [],
      employeeProfiles: [
        Object.assign(employeeProfileLib.defaultProfile('NV900'), { status: 'ACTIVE' }),
        Object.assign(employeeProfileLib.defaultProfile('NV901'), { status: 'ACTIVE' }),
        Object.assign(employeeProfileLib.defaultProfile('NV902'), { status: 'ACTIVE', username: 'da-co-chu-roi' }),
        Object.assign(employeeProfileLib.defaultProfile('NV904-OLD'), { status: 'ACTIVE', username: 'NV904' }),
        Object.assign(employeeProfileLib.defaultProfile('NV904'), { status: 'ACTIVE' }),
        Object.assign(employeeProfileLib.defaultProfile('NV906'), { status: 'ACTIVE' })
      ]
    };
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
  // cascadeUsernameChangesToTaskAssignedBy() (re-audit lần 9, lib/taskStore.js) gọi hàm này khi lưu
  // 'users' có đổi tên/xoá username — không liên quan tới bài test này, no-op để không vỡ route thật.
  stubModule('lib/taskStore', { getAllTasksCached: async () => [], cascadeUsernameChangesToTaskAssignedBy: async () => 0 });
  stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
  stubModule('lib/recordStore', { MIGRATED_COLLECTIONS: new Set(), getAllForCollectionCached: async () => [], getForCollectionByDeptCached: async () => [], getForCollectionByUsernameCached: async () => [], getForCollectionByColumnCached: async () => [] });
  stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

  const realAuth = require('../lib/auth');
  stubModule('lib/auth', {
    ...realAuth,
    requireAuth: (req, res, next) => {
      const fresh = APP_DATA.users.find(u => u.username === 'admin');
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username }; req.freshUser = fresh; next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });

  const dataRoutes = require('../routes/data');
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function saveUsers(users) {
    const res = await fetch(`${base}/api/data/users`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(users) });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }
  function profileByCode(code) { return APP_DATA.employeeProfiles.find(p => p.employeeCode === code); }

  try {
    await test('Tạo user MỚI (active) trùng Mã NV với hồ sơ chưa liên kết -> tự liên kết NGAY', async () => {
      resetData();
      const r = await saveUsers([...APP_DATA.users, { id: 10, username: 'NV900', name: 'Nhân Viên 900', pass: 'MatKhauManh@2026', active: true, perms: {} }]);
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(profileByCode('NV900').username, 'NV900');
    });

    await test('Tạo user MỚI nhưng active:false -> KHÔNG tự liên kết', async () => {
      resetData();
      const r = await saveUsers([...APP_DATA.users, { id: 11, username: 'NV901', name: 'Nhân Viên 901', pass: 'MatKhauManh@2026', active: false, perms: {} }]);
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(profileByCode('NV901').username, null);
    });

    await test('Hồ sơ ĐÃ liên kết username khác từ trước -> KHÔNG bị ghi đè', async () => {
      resetData();
      const r = await saveUsers([...APP_DATA.users, { id: 12, username: 'NV902', name: 'Nhân Viên 902', pass: 'MatKhauManh@2026', active: true, perms: {} }]);
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(profileByCode('NV902').username, 'da-co-chu-roi');
    });

    await test('Username đã bị hồ sơ KHÁC chiếm (employeeCode khác) -> hồ sơ đang xét KHÔNG tự liên kết nhầm', async () => {
      resetData();
      const r = await saveUsers([...APP_DATA.users, { id: 13, username: 'NV904', name: 'Nhân Viên 904', pass: 'MatKhauManh@2026', active: true, perms: {} }]);
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(profileByCode('NV904').username, null, 'profile Mã NV "NV904" không được tự nhận username đã gắn với hồ sơ "NV904-OLD"');
      assert.strictEqual(profileByCode('NV904-OLD').username, 'NV904', 'hồ sơ cũ đã liên kết trước đó không bị đổi');
    });

    await test('Không có hồ sơ nào khớp -> lưu bình thường, không lỗi, không side-effect', async () => {
      resetData();
      const r = await saveUsers([...APP_DATA.users, { id: 14, username: 'NV999', name: 'Nhân Viên 999', pass: 'MatKhauManh@2026', active: true, perms: {} }]);
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(APP_DATA.employeeProfiles.some(p => p.employeeCode === 'NV999'), false);
    });

    await test('Lưu "users" vì lý do KHÁC (sửa field không liên quan) vẫn quét + tự liên kết hồ sơ đang chờ khớp', async () => {
      resetData();
      // "NV906" tồn tại sẵn như 1 user ĐANG HOẠT ĐỘNG từ trước (mô phỏng: hồ sơ NV906 được tạo/để trống
      // liên kết SAU KHI tài khoản NV906 đã có sẵn từ lâu) — lượt lưu "users" lần này KHÔNG tạo/sửa gì
      // liên quan tới NV906 (chỉ đổi dept của admin), nhưng vẫn phải quét ra & tự liên kết NV906.
      APP_DATA.users.push({ id: 15, username: 'NV906', name: 'Nhân Viên 906', pass: 'MatKhauManh@2026', active: true, perms: {} });
      const usersWithUnrelatedChange = APP_DATA.users.map(u => u.username === 'admin' ? { ...u, dept: 'Phòng Mới Đổi' } : u);
      const r = await saveUsers(usersWithUnrelatedChange);
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(profileByCode('NV906').username, 'NV906');
    });

    console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
    if (failed > 0) process.exitCode = 1;
  } finally {
    server.close();
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
