// server/tests/test-permgroup-jobtitle-match.js
//
// "Phân quyền theo chức danh" (11/2026, theo yêu cầu TRỰC TIẾP của người dùng): "tôi có thể phân quyền
// theo chức danh không? ... gom tất cả trưởng phòng, giám đốc, phó giám đốc, tổng giám đốc... để tôi đỡ
// phải gắn từng tên một" — Nhóm Phân Quyền (permGroups) giờ có thêm field `jobTitles: string[]` (admin
// chọn tay qua picker ở màn Nhóm Phân Quyền): BẤT KỲ user nào có jobTitle CHÍNH (hoặc bất kỳ "Vị Trí Kiêm
// Nhiệm" — secondaryPositions[].jobTitle) khớp 1 trong các chuỗi đó sẽ TỰ ĐỘNG nhận quyền nền của nhóm,
// KHÔNG cần admin tự tick từng tài khoản vào groupIds — cả người ĐANG có jobTitle đó lẫn người SAU NÀY
// mới đổi/được gán đúng jobTitle đó (miễn record "users" của họ được ghi lại qua đúng 1 trong các điểm
// ghi: prepareUsersForSave()/syncUsersWithPermGroupsChange() ở routes/data.js, hoặc
// assignPositionToProfile() ở lib/hrProfilePositionAssign.js — xem lib/permGroupMerge.js).
//
// KIẾN TRÚC: giống test-permgroup-dangling-groupids.js — mount THẬT routes/data.js, chỉ stub tầng lưu
// trữ (lib/appData) + xác thực (lib/auth).
//
// Chạy: node server/tests/test-permgroup-jobtitle-match.js
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

let APP_DATA;
function resetData() {
  APP_DATA = {
    users: [{ ...ADMIN }],
    permGroups: [],
    depts: ['Phòng A', 'Phòng IT', 'Siêu Thị Quận 1'],
    stores: ['Siêu Thị Quận 1'],
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
stubModule('lib/taskStore', { getAllTasksCached: async () => [], cascadeUsernameChangesToTaskAssignedBy: async () => 0 });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [], cascadeUsernameChangesToWorkItemAssignment: async () => 0 });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(),
  getAllForCollectionCached: async () => [],
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async () => [],
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

const { userMatchesPermGroupJobTitles, computeAutoMatchedGroupIds, sanitizePermGroupJobTitles } = require('../lib/permGroupMerge');

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    // ===== 1) Unit nhỏ: userMatchesPermGroupJobTitles()/computeAutoMatchedGroupIds() =====
    await run.run('userMatchesPermGroupJobTitles(): khớp đúng jobTitle CHÍNH', () => {
      assert(userMatchesPermGroupJobTitles({ jobTitle: 'Trưởng Phòng' }, ['Trưởng Phòng', 'Giám Đốc']), 'phải khớp');
      assert(!userMatchesPermGroupJobTitles({ jobTitle: 'Nhân Viên' }, ['Trưởng Phòng', 'Giám Đốc']), 'không được khớp nhầm');
    });
    await run.run('userMatchesPermGroupJobTitles(): khớp qua "Vị Trí Kiêm Nhiệm" (secondaryPositions[].jobTitle)', () => {
      const u = { jobTitle: 'Nhân Viên', secondaryPositions: [{ jobTitle: 'Giám Đốc Siêu Thị', dept: 'Siêu Thị Quận 1' }] };
      assert(userMatchesPermGroupJobTitles(u, ['Giám Đốc Siêu Thị']), 'phải khớp qua kiêm nhiệm');
    });
    await run.run('userMatchesPermGroupJobTitles(): jobTitles rỗng/thiếu -> luôn false (an toàn)', () => {
      assert(!userMatchesPermGroupJobTitles({ jobTitle: 'Giám Đốc' }, []), 'mảng rỗng -> false');
      assert(!userMatchesPermGroupJobTitles({ jobTitle: 'Giám Đốc' }, null), 'null -> false');
      assert(!userMatchesPermGroupJobTitles(null, ['Giám Đốc']), 'user null -> false');
    });
    await run.run('computeAutoMatchedGroupIds(): trả đúng id các nhóm khớp, bỏ qua nhóm không khớp/không có jobTitles', () => {
      const groups = [
        { id: 'G1', jobTitles: ['Trưởng Phòng'] },
        { id: 'G2', jobTitles: ['Giám Đốc'] },
        { id: 'G3' } // không có jobTitles -> không bao giờ tự khớp ai
      ];
      assertEqual(JSON.stringify(computeAutoMatchedGroupIds({ jobTitle: 'Trưởng Phòng' }, groups)), JSON.stringify(['G1']));
    });
    await run.run('sanitizePermGroupJobTitles(): lọc rác, trim, khử trùng lặp', () => {
      assertEqual(JSON.stringify(sanitizePermGroupJobTitles([' Giám Đốc ', 'Giám Đốc', 123, null, '', 'Trưởng Phòng'])),
        JSON.stringify(['Giám Đốc', 'Trưởng Phòng']));
      assertEqual(JSON.stringify(sanitizePermGroupJobTitles('không phải mảng')), JSON.stringify([]));
    });

    // ===== 2) Lưu "users" (prepareUsersForSave): user KHÔNG groupIds, jobTitle khớp permGroup.jobTitles =====
    await run.run('POST /api/data/users: user KHÔNG có groupIds tường minh nhưng jobTitle khớp permGroup.jobTitles -> VẪN nhận quyền nền của nhóm', async () => {
      resetData();
      APP_DATA.permGroups = [{ id: 'G_TP', name: 'Trưởng Phòng (toàn công ty)', perms: { moduleAccess: { doc: true }, hrAttendanceManage: true }, jobTitles: ['Trưởng Phòng', 'Giám Đốc'] }];
      const res = await api('POST', '/api/data/users', [
        { ...ADMIN },
        { id: 2, username: 'nv.tp', name: 'Trưởng Phòng A', dept: 'Phòng A', jobTitle: 'Trưởng Phòng', perms: {}, active: true, pass: 'Test@1234' }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      const saved = APP_DATA.users.find(u => u.id === 2);
      assertEqual(saved.perms.hrAttendanceManage, true, 'phải tự nhận quyền hrAttendanceManage từ nhóm khớp chức danh');
      assertEqual(JSON.stringify(saved.groupIds || []), JSON.stringify([]), 'groupIds tường minh KHÔNG được tự ghi id nhóm khớp chức danh vào (giữ nghĩa "gán tay")');
    });

    await run.run('POST /api/data/users: jobTitle KHÔNG khớp bất kỳ nhóm nào -> hành vi CŨ giữ nguyên (tin thẳng perms client gửi)', async () => {
      resetData();
      APP_DATA.permGroups = [{ id: 'G_TP', perms: { hrAttendanceManage: true }, jobTitles: ['Trưởng Phòng'] }];
      const res = await api('POST', '/api/data/users', [
        { ...ADMIN },
        { id: 2, username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', jobTitle: 'Nhân Viên', perms: { hrAttendanceManage: true }, active: true, pass: 'Test@1234' }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      const saved = APP_DATA.users.find(u => u.id === 2);
      assertEqual(saved.perms.hrAttendanceManage, true, 'không khớp chức danh nào -> không có groupIds nào -> tin thẳng perms client gửi (hành vi cũ)');
    });

    await run.run('POST /api/data/users: gán tay (groupIds) MỘT nhóm + khớp chức danh MỘT nhóm KHÁC -> HỢP (union) cả 2 quyền', async () => {
      resetData();
      APP_DATA.permGroups = [
        { id: 'G_TAY', perms: { carRegManage: true } },
        { id: 'G_CD', perms: { hrAttendanceManage: true }, jobTitles: ['Giám Đốc'] }
      ];
      const res = await api('POST', '/api/data/users', [
        { ...ADMIN },
        { id: 2, username: 'nv.gd', name: 'Giám Đốc A', dept: 'Phòng A', jobTitle: 'Giám Đốc', groupIds: ['G_TAY'], perms: {}, active: true, pass: 'Test@1234' }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      const saved = APP_DATA.users.find(u => u.id === 2);
      assertEqual(saved.perms.carRegManage, true, 'phải giữ quyền từ nhóm gán tay G_TAY');
      assertEqual(saved.perms.hrAttendanceManage, true, 'phải CỘNG THÊM quyền từ nhóm khớp chức danh G_CD');
      assertEqual(JSON.stringify(saved.groupIds), JSON.stringify(['G_TAY']), 'groupIds tường minh chỉ còn đúng nhóm gán tay, KHÔNG lẫn G_CD');
    });

    await run.run('POST /api/data/users: tài khoản "admin" KHÔNG bao giờ bị ảnh hưởng bởi khớp chức danh (luôn ép perms:{admin:true})', async () => {
      resetData();
      APP_DATA.permGroups = [{ id: 'G_IT', perms: { hrAttendanceManage: true }, jobTitles: ['Phòng IT'] }];
      // admin không có field jobTitle trong fixture — test này xác nhận dù CÓ gán trùng tên chức danh,
      // isProtectedAdminRecord vẫn ép perms:{admin:true} TRƯỚC khi recomputeEffectivePerms() chạy tới.
      const res = await api('POST', '/api/data/users', [
        { ...ADMIN, jobTitle: 'Phòng IT' }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      const saved = APP_DATA.users.find(u => u.username === 'admin');
      assertEqual(JSON.stringify(saved.perms), JSON.stringify({ admin: true }), 'admin luôn toàn quyền, không bị khớp/gộp quyền nhóm nào');
    });

    // ===== 3) Lưu "permGroups" (syncUsersWithPermGroupsChange): sửa tiêu chí chức danh của 1 nhóm phải
    // NGAY LẬP TỨC áp dụng cho user KHỚP, kể cả user CHƯA TỪNG có groupIds nào trước đó =====
    await run.run('POST /api/data/permGroups: thêm jobTitles MỚI vào 1 nhóm -> user ĐÃ CÓ SẴN (chưa từng gán nhóm) khớp chức danh TỰ ĐỘNG nhận quyền ngay, không cần sửa "users" riêng', async () => {
      resetData();
      APP_DATA.permGroups = [{ id: 'G_GD', perms: {}, jobTitles: [] }];
      APP_DATA.users.push({ id: 2, username: 'nv.gd2', name: 'Giám Đốc B', dept: 'Phòng A', jobTitle: 'Giám Đốc', perms: {}, groupIds: [], active: true });

      const res = await api('POST', '/api/data/permGroups', [
        { id: 'G_GD', perms: { hrAttendanceManage: true }, jobTitles: ['Giám Đốc', 'Phó Giám Đốc', 'Tổng Giám Đốc'] }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu permGroups thành công');
      const saved = APP_DATA.users.find(u => u.username === 'nv.gd2');
      assertEqual(saved.perms.hrAttendanceManage, true, 'sửa permGroups xong là user khớp chức danh phải nhận quyền NGAY (không cần lưu "users" riêng)');
      assertEqual(JSON.stringify(saved.groupIds || []), JSON.stringify([]), 'groupIds tường minh vẫn rỗng (chưa từng gán tay)');
    });

    await run.run('POST /api/data/permGroups: bớt jobTitles của 1 nhóm (gỡ "Giám Đốc Siêu Thị") -> user chỉ khớp qua chức danh đó MẤT quyền ngay, không ảnh hưởng người khác vẫn còn khớp', async () => {
      resetData();
      APP_DATA.permGroups = [{ id: 'G_STORE', perms: { operationOrderAllowSelfApproveStore: true }, jobTitles: ['Giám Đốc Siêu Thị', 'Trưởng Phòng'] }];
      APP_DATA.users.push(
        { id: 2, username: 'gdst', name: 'GĐ Siêu Thị', dept: 'Siêu Thị Quận 1', jobTitle: 'Giám Đốc Siêu Thị', perms: {}, active: true },
        { id: 3, username: 'tp', name: 'Trưởng Phòng C', dept: 'Phòng A', jobTitle: 'Trưởng Phòng', perms: {}, active: true }
      );
      // Lưu 1 lần để cả 2 cùng nhận quyền trước (mô phỏng trạng thái "đã khớp từ trước").
      await api('POST', '/api/data/users', APP_DATA.users, ADMIN);
      assert(APP_DATA.users.find(u => u.username === 'gdst').perms.operationOrderAllowSelfApproveStore, 'tiền đề: GĐ Siêu Thị phải đã có quyền trước khi gỡ');

      const res = await api('POST', '/api/data/permGroups', [
        { id: 'G_STORE', perms: { operationOrderAllowSelfApproveStore: true }, jobTitles: ['Trưởng Phòng'] } // gỡ "Giám Đốc Siêu Thị"
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu permGroups thành công');
      const gdst = APP_DATA.users.find(u => u.username === 'gdst');
      const tp = APP_DATA.users.find(u => u.username === 'tp');
      assert(!gdst.perms.operationOrderAllowSelfApproveStore, 'GĐ Siêu Thị bị gỡ khỏi tiêu chí -> phải MẤT quyền ngay');
      assert(tp.perms.operationOrderAllowSelfApproveStore, 'Trưởng Phòng C vẫn còn khớp tiêu chí -> KHÔNG bị ảnh hưởng');
    });

    await run.run('POST /api/data/permGroups: sanitizePermGroupJobTitles() tự dọn rác (số/null/chuỗi rỗng/trùng lặp) tại điểm ghi', async () => {
      resetData();
      const res = await api('POST', '/api/data/permGroups', [
        { id: 'G_X', perms: {}, jobTitles: [' Giám Đốc ', 123, null, '', 'Giám Đốc'] }
      ], ADMIN);
      assertEqual(res.status, 200, 'phải lưu được');
      assertEqual(JSON.stringify(APP_DATA.permGroups[0].jobTitles), JSON.stringify(['Giám Đốc']), 'phải được sanitize gọn, khử trùng lặp');
    });

    // ===== 4) assignPositionToProfile() (lib/hrProfilePositionAssign.js) — điểm ghi TRỰC TIẾP "users"
    // bỏ qua prepareUsersForSave(), phải tự gọi recomputeEffectivePerms() =====
    await run.run('assignPositionToProfile(): gán Chức Vụ mới (đổi jobTitle) khớp permGroup.jobTitles -> user nhận quyền NGAY dù route này bỏ qua prepareUsersForSave()', async () => {
      resetData();
      APP_DATA.permGroups = [{ id: 'G_GD3', perms: { hrAttendanceManage: true }, jobTitles: ['Giám Đốc'] }];
      APP_DATA.users.push({ id: 2, username: 'nv.moi', name: 'Nhân Viên Mới', dept: 'Phòng A', jobTitle: 'Nhân Viên', perms: {}, active: true });
      APP_DATA.employeeProfiles = [{ employeeCode: 'NV001', username: 'nv.moi', fullName: 'Nhân Viên Mới' }];
      APP_DATA.orgChartVersions = [];

      const { assignPositionToProfile } = require('../lib/hrProfilePositionAssign');
      // Stub tối giản employeeProfile.applyPositionAssignment() — không cần logic thật của module đó,
      // chỉ cần trả đúng {jobTitle,dept,posType} để assignPositionToProfile() đồng bộ xuống "users".
      const employeeProfileLib = require('../lib/employeeProfile');
      const origApply = employeeProfileLib.applyPositionAssignment;
      const origFind = employeeProfileLib.findProfile;
      employeeProfileLib.findProfile = (list, code) => (list || []).find(p => p.employeeCode === code);
      employeeProfileLib.applyPositionAssignment = (profile) => {
        profile.jobTitle = 'Giám Đốc';
        profile.dept = 'Phòng A';
        return { jobTitle: 'Giám Đốc', dept: 'Phòng A', posType: 'HO' };
      };
      const orgChartLib = require('../lib/orgChart');
      const origGetApplied = orgChartLib.getAppliedVersion;
      orgChartLib.getAppliedVersion = () => null;
      try {
        await assignPositionToProfile('NV001', 'posKey1', ADMIN, {});
      } finally {
        employeeProfileLib.applyPositionAssignment = origApply;
        employeeProfileLib.findProfile = origFind;
        orgChartLib.getAppliedVersion = origGetApplied;
      }
      const saved = APP_DATA.users.find(u => u.username === 'nv.moi');
      assertEqual(saved.jobTitle, 'Giám Đốc', 'jobTitle phải được đồng bộ xuống users');
      assertEqual(saved.perms.hrAttendanceManage, true, 'phải TỰ nhận quyền nhóm khớp chức danh "Giám Đốc" ngay sau khi Gán Chức Vụ, không cần thao tác gì thêm');
    });

    run.summary();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
