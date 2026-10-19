// server/tests/test-permgroup-dangling-groupids.js
//
// Re-audit lần 4 (mức Cao): prepareUsersForSave() (routes/data.js, POST /api/data/users) có bất biến đã
// nêu rõ ở chú thích đầu hàm: "Quyền hiệu lực (perms) của user CÓ groupId PHẢI luôn tính từ quyền nhóm +
// permOverrides tại thời điểm ghi" — KHÔNG BAO GIỜ tin "perms" client gửi lên cho user có groupId. Trước
// khi vá, điều kiện tái tính là `if (groupsPerms.length)` — groupsPerms là kết quả TRA permGroups THẬT
// theo từng id trong groupIds, lọc bỏ id KHÔNG tồn tại (permGroupsById.get(id) trả undefined ->
// .filter(Boolean) loại hẳn). Nếu MỌI id trong groupIds đều "treo" (nhóm đã bị xoá khỏi permGroups
// nhưng user chưa được gỡ khỏi nhóm đó — VD admin xoá 1 nhóm trong lúc có user vẫn đang gán nhóm đó),
// groupsPerms rỗng -> nhánh if KHÔNG chạy -> record.perms RƠI THẲNG về nguyên "u.perms" mà client gửi
// lên — đúng hành vi chỉ nên áp dụng cho user KHÔNG groupId. Khai thác: 1 request tự soạn
// groupIds:['<id không tồn tại>'] kèm perms:{admin:true} sẽ được server ghi thẳng, tự phong toàn quyền.
//
// Đã sửa điều kiện thành `if (groupIds.length)` — LUÔN tái tính phía server bất kể còn nhóm hợp lệ nào
// hay không (mergeGroupsBasePermsServer([]) = {} khi groupsPerms rỗng, permOverrides vẫn áp đúng như cũ).
//
// KIẾN TRÚC: giống test-audit-hethong-cluster-server.js — mount THẬT routes/data.js, chỉ stub tầng lưu
// trữ (lib/appData) + xác thực (lib/auth).
//
// Chạy: node server/tests/test-permgroup-dangling-groupids.js
'use strict';
const http = require('http');
const path = require('path');
const express = require('express');
const { createRunner, assert, assertEqual } = require('./testHarness');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true, pass: 'hashed' };
const STAFF = { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: {}, active: true, pass: 'hashed' };

let APP_DATA;
function resetData() {
  APP_DATA = {
    users: [{ ...ADMIN }, { ...STAFF }],
    permGroups: [
      { id: 'G_A', perms: { moduleAccess: { doc: true }, hrAttendanceManage: true } }
    ],
    depts: ['Phòng A', 'Phòng IT'],
    employeeProfiles: [],
    submissionApprovalGroups: [],
    submissionApprovalLevels: [],
    contractApprovalGroups: [],
    contractApprovalLevels: []
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
    // Tolerant hơn thật (lib/appData.js đòi key đã tồn tại) — tránh phải khai đủ MỌI key cascade phụ
    // (extraApprovalGroups_<MODULE>/...) mà prepareUsersForSave() có thể đụng tới, không liên quan gì
    // tới đúng 1 hành vi đang test (tái tính perms khi groupIds toàn "treo").
    if (!(key in APP_DATA)) APP_DATA[key] = [];
    const next = await mutatorFn(APP_DATA[key]);
    APP_DATA[key] = next;
    return next;
  }
});
stubModule('lib/systemLogStore', {
  insertSystemLog: async () => {},
  clearAllSystemLogs: async () => {},
  getRecentSystemLogs: async () => []
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(),
  getAllForCollectionCached: async () => [],
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async () => [],
  // cascadeUsernameChangesToRecordApproverSnapshots() (re-audit lần 8, lib/catalogRename.js) gọi hàm
  // này khi lưu 'users' có đổi tên/xoá username — không liên quan tới bài test này (groupIds "treo"),
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

async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USER = asUser;
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
    await run.run('groupIds TOÀN "treo" (không trỏ tới bất kỳ permGroup nào còn tồn tại) -> perms VẪN bị server tái tính (base rỗng), KHÔNG tin "perms" client tự gửi -> không tự phong admin được', async () => {
      resetData();
      const res = await api('POST', '/api/data/users', [
        { ...ADMIN },
        { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', groupIds: ['G_KHONG_TON_TAI'], perms: { admin: true }, active: true }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      const saved = APP_DATA.users.find(u => u.id === 2);
      assert(!saved.perms.admin, 'TUYỆT ĐỐI không được tự phong admin chỉ vì groupIds trỏ tới 1 id không tồn tại kèm perms tự soạn');
      assertEqual(JSON.stringify(saved.perms), JSON.stringify({}), 'perms phải là {} (base rỗng vì không còn nhóm hợp lệ nào, không có permOverrides) — không phải "perms" client gửi lên');
    });

    await run.run('groupIds TOÀN "treo" + permOverrides -> permOverrides vẫn áp đúng lên base rỗng (không bị bỏ qua)', async () => {
      resetData();
      const res = await api('POST', '/api/data/users', [
        { ...ADMIN },
        { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', groupIds: ['G_KHONG_TON_TAI'], perms: { admin: true }, permOverrides: { hrAttendanceManage: true }, active: true }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      const saved = APP_DATA.users.find(u => u.id === 2);
      assert(!saved.perms.admin, 'không được tự phong admin');
      assertEqual(saved.perms.hrAttendanceManage, true, 'permOverrides vẫn phải áp đúng lên base rỗng');
    });

    await run.run('1/2 groupIds treo, 1 id còn hợp lệ -> vẫn tính đúng theo nhóm hợp lệ còn lại (không rơi vào nhánh "treo toàn bộ")', async () => {
      resetData();
      const res = await api('POST', '/api/data/users', [
        { ...ADMIN },
        { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', groupIds: ['G_KHONG_TON_TAI', 'G_A'], perms: { admin: true }, active: true }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      const saved = APP_DATA.users.find(u => u.id === 2);
      assert(!saved.perms.admin, 'không được tự phong admin');
      assertEqual(saved.perms.hrAttendanceManage, true, 'vẫn phải nhận đúng quyền từ nhóm G_A còn hợp lệ');
    });

    await run.run('KHÔNG có groupIds (user thường, không thuộc nhóm nào) -> hành vi CŨ giữ nguyên, perms client gửi được tin (không bị ảnh hưởng bởi bản vá)', async () => {
      resetData();
      const res = await api('POST', '/api/data/users', [
        { ...ADMIN },
        { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', perms: { hrAttendanceManage: true }, active: true }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      const saved = APP_DATA.users.find(u => u.id === 2);
      assertEqual(saved.perms.hrAttendanceManage, true, 'user không groupId vẫn giữ nguyên hành vi cũ: tin thẳng perms client gửi');
    });

    run.summary();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
