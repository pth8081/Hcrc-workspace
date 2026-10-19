'use strict';

// tests/test-managerusername-rename-delete-cascade.js
//
// Re-audit lần 4 (mức Cao): DB.users[].managerUsername (quản lý trực tiếp — đọc bởi isManagerOf() ở
// lib/recordViewScope.js, hasDirectReports()/assignHrSuccessor() ở lib/recordActions.js,
// computeManagerUsernameUpdates() ở lib/orgChart.js) tham chiếu TRỰC TIẾP username của 1 tài khoản
// KHÁC, nhưng CHƯA BAO GIỜ được cascade khi tài khoản đó bị ĐỔI TÊN (sửa #uUsername, không bị khoá
// readonly) hoặc XOÁ VĨNH VIỄN — cùng lớp lỗi "bảng liên kết" đã vá cho employeeProfile.username (xem
// test-employeeprofile-username-desync-cascade.js) nhưng KHÁC ở chỗ managerUsername nằm NGAY TRONG
// chính mảng "users" đang lưu (không phải 1 collection riêng), nên phải sửa TRƯỚC khi ghi, không phải
// SAU như employeeProfiles.
//
// PHẦN A: test THUẦN cascadeUsernameChangesToManagerUsername() (không cần boot DB).
// PHẦN B: test HTTP thật qua POST /api/data/users (mount routes/data.js) — xác nhận managerUsername của
// MỌI cấp dưới được cập nhật đúng trong CÙNG 1 lượt lưu đổi tên/xoá người quản lý.
//
// Chạy: node server/tests/test-managerusername-rename-delete-cascade.js
const assert = require('assert');
const http = require('http');
const path = require('path');
const express = require('express');
const { cascadeUsernameChangesToManagerUsername } = require('../lib/employeeProfile');
const { createRunner, assertEqual } = require('./testHarness');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}

// ===== PHẦN A: cascadeUsernameChangesToManagerUsername() thuần =====

test('đổi tên 1 quản lý -> managerUsername của MỌI cấp dưới được cập nhật, người khác không liên quan giữ nguyên', () => {
  const users = [
    { username: 'truongphong_moi', managerUsername: null },
    { username: 'nv1', managerUsername: 'truongphong' },
    { username: 'nv2', managerUsername: 'truongphong' },
    { username: 'nv3', managerUsername: 'tp_khac' }
  ];
  const changed = cascadeUsernameChangesToManagerUsername(users, [{ oldValue: 'truongphong', newValue: 'truongphong_moi' }], []);
  assertEqual(changed, 2, 'phải đổi đúng 2 cấp dưới của "truongphong"');
  assertEqual(users[1].managerUsername, 'truongphong_moi');
  assertEqual(users[2].managerUsername, 'truongphong_moi');
  assertEqual(users[3].managerUsername, 'tp_khac', 'không liên quan — giữ nguyên');
});

test('xoá vĩnh viễn 1 quản lý -> managerUsername của MỌI cấp dưới được gỡ (null), không suy đoán người thay thế', () => {
  const users = [
    { username: 'nv1', managerUsername: 'truongphong' },
    { username: 'nv2', managerUsername: 'truongphong' }
  ];
  const changed = cascadeUsernameChangesToManagerUsername(users, [], ['truongphong']);
  assertEqual(changed, 2);
  assertEqual(users[0].managerUsername, null);
  assertEqual(users[1].managerUsername, null);
});

test('không có user nào bị ảnh hưởng -> trả 0, không đổi gì', () => {
  const users = [{ username: 'nv1', managerUsername: 'truongphong' }];
  const changed = cascadeUsernameChangesToManagerUsername(users, [{ oldValue: 'khong_ton_tai', newValue: 'gi_do' }], ['cung_khong_ton_tai']);
  assertEqual(changed, 0);
  assertEqual(users[0].managerUsername, 'truongphong');
});

test('user không có managerUsername (null/undefined) -> bỏ qua an toàn, không throw', () => {
  const users = [{ username: 'nv1', managerUsername: null }, { username: 'nv2' }];
  const changed = cascadeUsernameChangesToManagerUsername(users, [{ oldValue: 'a', newValue: 'b' }], ['c']);
  assertEqual(changed, 0);
});

test('mảng users rỗng/thiếu -> không throw, trả 0', () => {
  assertEqual(cascadeUsernameChangesToManagerUsername(null, [], []), 0);
  assertEqual(cascadeUsernameChangesToManagerUsername(undefined, [{ oldValue: 'a', newValue: 'b' }], []), 0);
});

console.log(`\n${passed}/${passed + failed} scenario(s) passed (Phần A).`);

// ===== PHẦN B: HTTP thật qua POST /api/data/users =====

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true, pass: 'hashed' };
const TRUONGPHONG = { id: 2, username: 'truongphong', name: 'Trưởng Phòng A', dept: 'Phòng A', perms: {}, active: true, pass: 'hashed' };
const NV1 = { id: 3, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: {}, active: true, pass: 'hashed', managerUsername: 'truongphong' };
const NV2 = { id: 4, username: 'nv2', name: 'Nhân Viên 2', dept: 'Phòng A', perms: {}, active: true, pass: 'hashed', managerUsername: 'truongphong' };

let APP_DATA;
function resetData() {
  APP_DATA = {
    users: [{ ...ADMIN }, { ...TRUONGPHONG }, { ...NV1 }, { ...NV2 }],
    permGroups: [], submissionApprovalGroups: [], submissionApprovalLevels: [],
    contractApprovalGroups: [], contractApprovalLevels: [], depts: ['Phòng A', 'Phòng IT'],
    employeeProfiles: []
  };
}
resetData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAppDataValueWithVersion: async (key) => ({ value: key in APP_DATA ? APP_DATA[key] : null, version: 'v-0' }),
  getAllAppDataWithVersionsCached: async () => ({ data: { ...APP_DATA }, versions: {} }),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: 'v-1' }; },
  withLockedAppDataValue: async (key, mutatorFn) => {
    if (!(key in APP_DATA)) APP_DATA[key] = [];
    const next = await mutatorFn(APP_DATA[key]);
    APP_DATA[key] = next;
    return next;
  }
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {}, clearAllSystemLogs: async () => {}, getRecentSystemLogs: async () => [] });
// cascadeUsernameChangesToTaskAssignedBy() (re-audit lần 9, lib/taskStore.js) gọi hàm này khi lưu
// 'users' có đổi tên/xoá username — không liên quan tới bài test này, no-op để không vỡ route thật.
stubModule('lib/taskStore', { getAllTasksCached: async () => [], cascadeUsernameChangesToTaskAssignedBy: async () => 0 });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [], cascadeUsernameChangesToWorkItemAssignment: async () => 0 });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(),
  getAllForCollectionCached: async () => [],
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async () => [],
  // cascadeUsernameChangesToRecordApproverSnapshots() (re-audit lần 8, lib/catalogRename.js) gọi hàm
  // này khi lưu 'users' có đổi tên/xoá username — không liên quan tới bài test này (managerUsername),
  // no-op để không vỡ route thật.
  renameFieldValueInCollection: async () => {}
});

let CURRENT_USER = ADMIN;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = (APP_DATA.users || []).find(u => u.username === CURRENT_USER.username) || CURRENT_USER;
    req.user = { username: fresh.username, name: fresh.name, admin: !!fresh.perms?.admin };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => `hashed:${p}`,
  isBcryptHash: (v) => typeof v === 'string' && v.startsWith('hashed'),
  validatePin: () => null
});

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
    method, headers: { 'Content-Type': 'application/json' },
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
    await run.run('LỖI ĐÃ VÁ: đổi tên "truongphong" -> "truongphong_a" qua POST /api/data/users -> managerUsername của nv1/nv2 TỰ ĐỘNG cập nhật trong CÙNG lượt lưu', async () => {
      resetData();
      const res = await api('POST', '/api/data/users', [
        { ...ADMIN },
        { ...TRUONGPHONG, username: 'truongphong_a' },
        { ...NV1 },
        { ...NV2 }
      ]);
      assertEqual(res.status, 200, 'phải lưu được');
      const nv1 = APP_DATA.users.find(u => u.id === NV1.id);
      const nv2 = APP_DATA.users.find(u => u.id === NV2.id);
      assertEqual(nv1.managerUsername, 'truongphong_a', 'managerUsername của nv1 phải tự cập nhật theo tên mới');
      assertEqual(nv2.managerUsername, 'truongphong_a', 'managerUsername của nv2 phải tự cập nhật theo tên mới');
    });

    await run.run('LỖI ĐÃ VÁ: xoá vĩnh viễn "truongphong" qua POST /api/data/users -> managerUsername của nv1/nv2 được GỠ (null), không còn "mồ côi"', async () => {
      resetData();
      const res = await api('POST', '/api/data/users', [
        { ...ADMIN },
        { ...NV1 },
        { ...NV2 }
      ]);
      assertEqual(res.status, 200, 'phải lưu được');
      const nv1 = APP_DATA.users.find(u => u.id === NV1.id);
      const nv2 = APP_DATA.users.find(u => u.id === NV2.id);
      assertEqual(nv1.managerUsername, null, 'managerUsername phải được gỡ, không còn trỏ tới username đã xoá');
      assertEqual(nv2.managerUsername, null);
    });

    await run.run('Lưu "users" vì lý do KHÁC (không đổi tên/xoá ai) -> managerUsername giữ nguyên, không bị đụng oan', async () => {
      resetData();
      const res = await api('POST', '/api/data/users', [
        { ...ADMIN },
        { ...TRUONGPHONG },
        { ...NV1, name: 'Nhân Viên 1 (đã sửa tên hiển thị)' },
        { ...NV2 }
      ]);
      assertEqual(res.status, 200, 'phải lưu được');
      const nv1 = APP_DATA.users.find(u => u.id === NV1.id);
      assertEqual(nv1.managerUsername, 'truongphong', 'không đổi tên/xoá ai -> managerUsername giữ nguyên');
    });

    run.summary();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
