// server/tests/test-hr-username-mapping.js
//
// "🆔 Mã NV ↔ Tài Khoản" (11/2026, theo yêu cầu người dùng, admin-only — quy tắc hệ thống: Tên Đăng Nhập
// LUÔN được tạo trùng Mã Nhân Viên). Xem chú thích đầy đủ ở lib/hrUsernameMapping.js/routes/hrUsernameMapping.js.
//
// Phần A: lib/hrUsernameMapping.js (thuần, không qua HTTP) — computeUsernameMappingReport()/
// prepareBulkCreateAccounts(). Phần B: HTTP thật — mount routes/hrUsernameMapping.js (tự require
// routes/data.js để lấy prepareUsersForSave() DÙNG CHUNG, cùng khuôn test-admin-perms-removed-auditlog.js/
// test-permgroup-dangling-groupids.js: chỉ stub tầng lưu trữ/xác thực, KHÔNG viết lại logic nghiệp vụ).
//
// Chạy: node server/tests/test-hr-username-mapping.js
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const assert = require('assert');
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err && err.stack ? err.stack : err}`); }
}

// ===================== Phần A: lib/hrUsernameMapping.js (thuần) =====================
function partA() {
  console.log('== Phần A: lib/hrUsernameMapping.js (thuần) ==');
  const { computeUsernameMappingReport, prepareBulkCreateAccounts, hasWhitespace, findWhitespaceIssues } = require('../lib/hrUsernameMapping');

  const USERS = [
    { id: 1, username: 'NV0001', name: 'Nguyễn Văn Kế Toán', perms: {}, active: true },
    { id: 2, username: 'BL787', name: 'Lê Thị Bình', perms: {}, active: true },
    { id: 3, username: 'honoring-other', name: 'Người Khác', perms: {}, active: true }
  ];
  const HR_PROCESSES = [
    { id: 100, processType: 'ONBOARDING', fullName: 'Bùi Văn Mười' },
    { id: 101, processType: 'ONBOARDING', fullName: 'Cao Thị Mười Một' }
  ];
  function freshAppData() {
    return {
      users: USERS,
      hrProcesses: HR_PROCESSES,
      employeeProfiles: [
        { employeeCode: 'NV0001', username: 'NV0001', status: 'ACTIVE' }, // MATCHED
        { employeeCode: 'BL378', username: 'BL787', status: 'ACTIVE' }, // MISMATCH
        { employeeCode: 'NV0010', username: null, status: 'ACTIVE', processId: 100, dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên' }, // MISSING
        { employeeCode: 'NV0011', username: null, status: 'ON_LEAVE', processId: 101 }, // MISSING (ON_LEAVE vẫn tính)
        { employeeCode: 'NV0099', username: null, status: 'DRAFT' }, // bị loại — Nháp
        { employeeCode: 'NV0088', username: null, status: 'INACTIVE' } // bị loại — Đã nghỉ việc
      ]
    };
  }

  test('computeUsernameMappingReport(): chỉ tính ACTIVE/ON_LEAVE, loại DRAFT/INACTIVE', () => {
    const { rows, stats } = computeUsernameMappingReport(freshAppData());
    assertEqual(rows.length, 4, 'phải loại 2 dòng DRAFT/INACTIVE, còn lại 4');
    assertEqual(stats.total, 4);
    assert(!rows.find(r => r.employeeCode === 'NV0099'), 'DRAFT không được hiện');
    assert(!rows.find(r => r.employeeCode === 'NV0088'), 'INACTIVE không được hiện');
  });

  test('computeUsernameMappingReport(): phân đúng 3 nhóm MATCHED/MISMATCH/MISSING', () => {
    const { rows, stats } = computeUsernameMappingReport(freshAppData());
    assertEqual(rows.find(r => r.employeeCode === 'NV0001').status, 'MATCHED');
    assertEqual(rows.find(r => r.employeeCode === 'BL378').status, 'MISMATCH');
    assertEqual(rows.find(r => r.employeeCode === 'NV0010').status, 'MISSING');
    assertEqual(rows.find(r => r.employeeCode === 'NV0011').status, 'MISSING');
    assertEqual(stats.matched, 1); assertEqual(stats.mismatch, 1); assertEqual(stats.missing, 2);
  });

  test('computeUsernameMappingReport(): tra đúng tên qua hrProcesses.fullName khi chưa liên kết tài khoản', () => {
    const { rows } = computeUsernameMappingReport(freshAppData());
    assertEqual(rows.find(r => r.employeeCode === 'NV0010').name, 'Bùi Văn Mười');
  });

  test('computeUsernameMappingReport(): hồ sơ MISSING không tra được tên (không processId) -> dùng tạm Mã NV, đánh dấu hasName=false', () => {
    const appData = freshAppData();
    appData.employeeProfiles.push({ employeeCode: 'NV0077', username: null, status: 'ACTIVE' });
    const { rows } = computeUsernameMappingReport(appData);
    const r = rows.find(x => x.employeeCode === 'NV0077');
    assertEqual(r.name, 'NV0077');
    assertEqual(r.hasName, false);
  });

  test('prepareBulkCreateAccounts(): tạo đúng cho hồ sơ MISSING hợp lệ, employeeCode làm username', () => {
    const appData = freshAppData();
    const { toCreate, toLinkCodes, skipped } = prepareBulkCreateAccounts(
      [{ employeeCode: 'NV0010', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên', phone: '0900000001', email: 'muoi@hcrc.vn' }],
      appData, 1000
    );
    assertEqual(skipped.length, 0);
    assertEqual(toCreate.length, 1);
    assertEqual(toCreate[0].username, 'NV0010');
    assertEqual(toCreate[0].name, 'Bùi Văn Mười');
    assertEqual(toCreate[0].dept, 'Phòng Kế Toán');
    assertEqual(toCreate[0].email, 'muoi@hcrc.vn');
    assertEqual(toCreate[0].pass, 'Brg@123456');
    assertEqual(toLinkCodes[0], 'NV0010');
  });

  test('prepareBulkCreateAccounts(): groupIds (chuỗi) truyền vào được gắn đúng lên tài khoản mới, bỏ qua giá trị không phải chuỗi', () => {
    const appData = freshAppData();
    const { toCreate } = prepareBulkCreateAccounts(
      [{ employeeCode: 'NV0010' }], appData, 1000, ['grp_a', 123, null, 'grp_b']
    );
    assertEqual(JSON.stringify(toCreate[0].groupIds), JSON.stringify(['grp_a', 'grp_b']));
  });

  test('prepareBulkCreateAccounts(): bỏ qua (skip) hồ sơ đã có tài khoản (MATCHED/MISMATCH), không tạo trùng', () => {
    const appData = freshAppData();
    const { toCreate, skipped } = prepareBulkCreateAccounts(
      [{ employeeCode: 'NV0001' }, { employeeCode: 'BL378' }], appData, 1000
    );
    assertEqual(toCreate.length, 0);
    assertEqual(skipped.length, 2);
  });

  test('prepareBulkCreateAccounts(): employeeCode trùng tên đăng nhập 1 tài khoản KHÁC đang hoạt động -> skip rõ lý do', () => {
    const appData = freshAppData();
    appData.employeeProfiles.push({ employeeCode: 'honoring-other', username: null, status: 'ACTIVE' });
    const { toCreate, skipped } = prepareBulkCreateAccounts([{ employeeCode: 'honoring-other' }], appData, 1000);
    assertEqual(toCreate.length, 0);
    assertEqual(skipped.length, 1);
    assertIncludes(skipped[0].reason, 'trùng tên đăng nhập');
  });

  test('prepareBulkCreateAccounts(): trùng employeeCode trong CÙNG lượt chọn -> chỉ tạo 1, dòng sau bị skip', () => {
    const appData = freshAppData();
    const { toCreate, skipped } = prepareBulkCreateAccounts(
      [{ employeeCode: 'NV0010', dept: 'Phòng Kế Toán' }, { employeeCode: 'NV0010', dept: 'Phòng Kế Toán Khác' }],
      appData, 1000
    );
    assertEqual(toCreate.length, 1);
    assertEqual(skipped.length, 1);
    assertIncludes(skipped[0].reason, 'Trùng lặp');
  });

  test('prepareBulkCreateAccounts(): không gửi dòng nào -> throw 400', () => {
    assert.throws(() => prepareBulkCreateAccounts([], freshAppData(), 1000), /Chưa chọn hồ sơ/);
  });

  test('prepareBulkCreateAccounts(): Phòng Ban/Chức Danh/SĐT/Email do Admin sửa KHÔNG ghi ngược employeeProfiles (chỉ nằm trên object user mới)', () => {
    const appData = freshAppData();
    const before = JSON.parse(JSON.stringify(appData.employeeProfiles.find(p => p.employeeCode === 'NV0010')));
    prepareBulkCreateAccounts([{ employeeCode: 'NV0010', dept: 'Phòng Khác Hẳn', jobTitle: 'Chức Danh Khác', phone: '099', email: 'x@y.z' }], appData, 1000);
    const after = appData.employeeProfiles.find(p => p.employeeCode === 'NV0010');
    assertEqual(JSON.stringify(after), JSON.stringify(before), 'employeeProfiles KHÔNG được đổi gì dù admin sửa field khác lúc tạo tài khoản');
  });

  // hasWhitespace()/findWhitespaceIssues() (11/2026, theo yêu cầu người dùng: "những tài khoản nào đang
  // có khoảng trắng... up code bản này cắt luôn đúng không?" -> xác nhận quét read-only, KHÔNG tự sửa).
  test('hasWhitespace(): nhận diện đúng khoảng trắng ở ĐẦU/CUỐI/GIỮA, không báo nhầm chuỗi liền mạch', () => {
    assertEqual(hasWhitespace('BL 3883'), true, 'khoảng trắng ở giữa');
    assertEqual(hasWhitespace(' BL3883'), true, 'khoảng trắng ở đầu');
    assertEqual(hasWhitespace('BL3883 '), true, 'khoảng trắng ở cuối');
    assertEqual(hasWhitespace('BL3883'), false, 'chuỗi liền mạch không có khoảng trắng');
    assertEqual(hasWhitespace(null), false, 'null không throw, trả false');
    assertEqual(hasWhitespace(undefined), false, 'undefined không throw, trả false');
  });

  test('findWhitespaceIssues(): liệt kê ĐÚNG hồ sơ có employeeCode dính khoảng trắng, KHÔNG giới hạn ELIGIBLE_STATUSES (kể cả DRAFT/INACTIVE)', () => {
    const appData = freshAppData();
    appData.employeeProfiles.push({ employeeCode: 'BL 9999', username: null, status: 'DRAFT' }); // Nháp vẫn phải liệt kê
    appData.employeeProfiles.push({ employeeCode: 'BL8888', username: null, status: 'ACTIVE' }); // sạch, KHÔNG được liệt kê
    const { employeeCodes } = findWhitespaceIssues(appData);
    assertEqual(employeeCodes.length, 1, JSON.stringify(employeeCodes));
    assertEqual(employeeCodes[0].employeeCode, 'BL 9999');
    assertEqual(employeeCodes[0].status, 'DRAFT');
  });

  test('findWhitespaceIssues(): liệt kê ĐÚNG user có username dính khoảng trắng, KHÔNG phụ thuộc có liên kết employeeProfile hay không', () => {
    const appData = freshAppData();
    // KHÔNG push thẳng vào appData.users — đó là tham chiếu mảng USERS DÙNG CHUNG toàn bộ partA() (chỉ
    // employeeProfiles được freshAppData() tạo mới mỗi lần gọi), push thẳng sẽ làm "rò rỉ" sang các test
    // chạy SAU trong cùng file. Tự nhân bản mảng users ở đây để cô lập đúng phạm vi 1 test.
    appData.users = [...appData.users, { id: 99, username: 'BL 9999', name: 'Tài Khoản Dính Khoảng Trắng', perms: {}, active: true }];
    const { usernames } = findWhitespaceIssues(appData);
    assertEqual(usernames.length, 1, JSON.stringify(usernames));
    assertEqual(usernames[0].username, 'BL 9999');
    assertEqual(usernames[0].name, 'Tài Khoản Dính Khoảng Trắng');
  });

  test('findWhitespaceIssues(): dữ liệu sạch hoàn toàn -> trả 2 mảng rỗng', () => {
    const { employeeCodes, usernames } = findWhitespaceIssues(freshAppData());
    assertEqual(employeeCodes.length, 0);
    assertEqual(usernames.length, 0);
  });

  test('computeUsernameMappingReport(): mỗi dòng có cờ employeeCodeHasWhitespace/currentUsernameHasWhitespace đúng thực tế', () => {
    const appData = freshAppData();
    appData.employeeProfiles.push({ employeeCode: 'BL 7777', username: 'BL 7777', status: 'ACTIVE' });
    const { rows } = computeUsernameMappingReport(appData);
    const r = rows.find(x => x.employeeCode === 'BL 7777');
    assertEqual(r.employeeCodeHasWhitespace, true);
    assertEqual(r.currentUsernameHasWhitespace, true);
    const clean = rows.find(x => x.employeeCode === 'NV0001');
    assertEqual(clean.employeeCodeHasWhitespace, false);
    assertEqual(clean.currentUsernameHasWhitespace, false);
  });
}

// ===================== Phần B: HTTP thật — POST /api/admin/username-mapping =====================
async function partB() {
  console.log('\n== Phần B: HTTP thật — /api/admin/username-mapping ==');

  const ADMIN = { id: 1, username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true, pass: 'hashed' };
  const STAFF = { id: 2, username: 'nv1', name: 'Nhân Viên Thường', dept: 'Phòng IT', perms: {}, active: true, pass: 'hashed' };
  const EXISTING_NV0001 = { id: 3, username: 'NV0001', name: 'Nguyễn Văn Kế Toán', dept: 'Phòng IT', perms: {}, active: true, pass: 'hashed' };

  let APP_DATA;
  function resetData() {
    APP_DATA = {
      users: [{ ...ADMIN }, { ...STAFF }, { ...EXISTING_NV0001 }],
      permGroups: [{ id: 'grp_ketoan', name: 'Nhân viên Phòng Kế Toán', perms: { attendanceView: true } }],
      depts: ['Phòng Kế Toán'], stores: [],
      employeeProfiles: [
        { employeeCode: 'NV0010', username: null, status: 'ACTIVE', processId: 500, dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên' },
        { employeeCode: 'NV0011', username: null, status: 'ACTIVE', processId: 501 },
        { employeeCode: 'NV0001', username: 'NV0001', status: 'ACTIVE' }
      ],
      submissionApprovalGroups: [], submissionApprovalLevels: [],
      contractApprovalGroups: [], contractApprovalLevels: []
    };
  }
  resetData();

  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
    getAppDataValueWithVersion: async (key) => ({ value: key in APP_DATA ? APP_DATA[key] : null, version: 'v-0' }),
    getAllAppData: async () => ({ ...APP_DATA }),
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
  function usernameEqualsCI(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
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
    validatePin: () => null,
    findUserByUsernameCI: (users, username) => (users || []).find(u => usernameEqualsCI(u.username, username)),
    usernameEquals: usernameEqualsCI
  });
  stubModule('lib/systemLogStore', {
    insertSystemLog: async () => {},
    clearAllSystemLogs: async () => {},
    getRecentSystemLogs: async () => []
  });
  stubModule('lib/taskStore', { getAllTasksCached: async () => [], cascadeUsernameChangesToTaskAssignedBy: async () => 0 });
  stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [], cascadeUsernameChangesToWorkItemAssignment: async () => 0 });
  stubModule('lib/recordStore', {
    MIGRATED_COLLECTIONS: new Set(['hrProcesses']),
    getAllForCollection: async (c) => (c === 'hrProcesses' ? [
      { id: 500, processType: 'ONBOARDING', fullName: 'Bùi Văn Mười' },
      { id: 501, processType: 'ONBOARDING', fullName: 'Cao Thị Mười Một' }
    ] : []),
    getAllForCollectionCached: async () => [],
    getForCollectionByDeptCached: async () => [],
    getForCollectionByUsernameCached: async () => [],
    getForCollectionByColumnCached: async () => [],
    renameFieldValueInCollection: async () => {}
  });

  const mappingRoutes = require('../routes/hrUsernameMapping');
  const app = express();
  app.use(express.json());
  app.use('/api/admin/username-mapping', mappingRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function call(asUser, method, urlPath, body) {
    CURRENT_USER = asUser;
    const res = await fetch(`${base}${urlPath}`, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  await test('GET /: người không phải admin bị chặn 403', async () => {
    resetData();
    const r = await call(STAFF, 'GET', '/api/admin/username-mapping');
    assertEqual(r.status, 403, JSON.stringify(r.json));
  });

  await test('GET /: admin xem được report đúng 2 nhóm MISSING/MATCHED', async () => {
    resetData();
    const r = await call(ADMIN, 'GET', '/api/admin/username-mapping');
    assertEqual(r.status, 200, JSON.stringify(r.json));
    assertEqual(r.json.stats.total, 3);
    assertEqual(r.json.stats.missing, 2);
    assertEqual(r.json.stats.matched, 1);
  });

  await test('GET /: trả kèm whitespaceIssues (quét read-only dữ liệu cũ dính khoảng trắng, không giới hạn ELIGIBLE_STATUSES)', async () => {
    resetData();
    APP_DATA.employeeProfiles.push({ employeeCode: 'BL 2222', username: null, status: 'INACTIVE' });
    APP_DATA.users.push({ id: 10, username: 'BL 3333', name: 'Dính Khoảng Trắng', perms: {}, active: true, pass: 'hashed' });
    const r = await call(ADMIN, 'GET', '/api/admin/username-mapping');
    assertEqual(r.status, 200, JSON.stringify(r.json));
    assert(r.json.whitespaceIssues, 'phải có field whitespaceIssues');
    assertEqual(r.json.whitespaceIssues.employeeCodes.length, 1);
    assertEqual(r.json.whitespaceIssues.employeeCodes[0].employeeCode, 'BL 2222');
    assertEqual(r.json.whitespaceIssues.usernames.length, 1);
    assertEqual(r.json.whitespaceIssues.usernames[0].username, 'BL 3333');
  });

  await test('POST /bulk-create-accounts: người không phải admin bị chặn 403', async () => {
    resetData();
    const r = await call(STAFF, 'POST', '/api/admin/username-mapping/bulk-create-accounts', { selections: [{ employeeCode: 'NV0010' }] });
    assertEqual(r.status, 403, JSON.stringify(r.json));
  });

  await test('POST /bulk-create-accounts: tạo thành công 2 tài khoản, username=Mã NV, mustChangePassword=true, đã liên kết employeeProfiles.username', async () => {
    resetData();
    const r = await call(ADMIN, 'POST', '/api/admin/username-mapping/bulk-create-accounts', {
      selections: [
        { employeeCode: 'NV0010', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên', phone: '0900000001', email: 'muoi@hcrc.vn' },
        { employeeCode: 'NV0011', dept: 'Phòng Kế Toán', jobTitle: 'Nhân viên' }
      ]
    });
    assertEqual(r.status, 200, JSON.stringify(r.json));
    assertEqual(r.json.created.length, 2);
    assertEqual(r.json.skipped.length, 0);
    const u10 = APP_DATA.users.find(u => u.username === 'NV0010');
    assert(u10, 'phải tạo tài khoản NV0010');
    assertEqual(u10.mustChangePassword, true, 'phải bắt đổi mật khẩu ngay lần đăng nhập đầu');
    assert(u10.pass !== 'Brg@123456', 'mật khẩu phải đã được hash, không lưu plaintext');
    const p10 = APP_DATA.employeeProfiles.find(p => p.employeeCode === 'NV0010');
    assertEqual(p10.username, 'NV0010', 'employeeProfiles phải được liên kết username ngay sau khi tạo');
  });

  await test('POST /bulk-create-accounts: hồ sơ đã MATCHED -> skip rõ lý do, không tạo trùng', async () => {
    resetData();
    const r = await call(ADMIN, 'POST', '/api/admin/username-mapping/bulk-create-accounts', { selections: [{ employeeCode: 'NV0001' }] });
    assertEqual(r.status, 200, JSON.stringify(r.json));
    assertEqual(r.json.created.length, 0);
    assertEqual(r.json.skipped.length, 1);
    const usersWithCode = APP_DATA.users.filter(u => u.username === 'NV0001');
    assertEqual(usersWithCode.length, 1, 'không được tạo thêm tài khoản trùng');
  });

  await test('POST /bulk-create-accounts: Mã NV trùng username 1 tài khoản khác đang hoạt động -> skip, KHÔNG tạo', async () => {
    resetData();
    APP_DATA.employeeProfiles.push({ employeeCode: 'nv1', username: null, status: 'ACTIVE' }); // trùng username STAFF (không phân biệt hoa/thường)
    const r = await call(ADMIN, 'POST', '/api/admin/username-mapping/bulk-create-accounts', { selections: [{ employeeCode: 'nv1' }] });
    assertEqual(r.status, 200, JSON.stringify(r.json));
    assertEqual(r.json.created.length, 0);
    assertEqual(r.json.skipped.length, 1);
  });

  await test('POST /bulk-create-accounts: gửi kèm groupIds (chuỗi "grp_...") -> áp dụng đúng, quyền được tính qua prepareUsersForSave() (không bị ép Number() làm rớt mất)', async () => {
    resetData();
    const r = await call(ADMIN, 'POST', '/api/admin/username-mapping/bulk-create-accounts', {
      selections: [{ employeeCode: 'NV0010', dept: 'Phòng Kế Toán' }],
      groupIds: ['grp_ketoan']
    });
    assertEqual(r.status, 200, JSON.stringify(r.json));
    assertEqual(r.json.created.length, 1);
    const u10 = APP_DATA.users.find(u => u.username === 'NV0010');
    assert(u10, 'phải tạo được tài khoản');
    assert((u10.groupIds || []).includes('grp_ketoan'), `groupIds phải còn đúng chuỗi "grp_ketoan", thực tế: ${JSON.stringify(u10.groupIds)}`);
    assertEqual(u10.perms.attendanceView, true, 'quyền phải được tính từ Nhóm Phân Quyền đã chọn');
  });

  await test('POST /bulk-create-accounts: không gửi "selections" -> 400', async () => {
    resetData();
    const r = await call(ADMIN, 'POST', '/api/admin/username-mapping/bulk-create-accounts', {});
    assertEqual(r.status, 400, JSON.stringify(r.json));
  });

  server.close();
}

(async () => {
  partA();
  await partB();
  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
