// server/tests/test-orgchart-force-unassign-delete.js
//
// TÍNH NĂNG MỚI (11/2026, theo yêu cầu người dùng: "tôi muốn xóa đi kể cả gắn vào thì gọi là remove,
// tự động remove tất cả người ra khỏi vị trí này luôn được không?" -> "Có, làm nút đó đi"):
//   - lib/employeeProfile.js::clearPositionAssignmentForce() — gỡ CHỨC VỤ (positionKey/jobTitle/dept/
//     positionLabel/posType/jobGrade) khỏi 1 Hồ Sơ Nhân Sự, ghi 1 dòng positionHistory, KHÔNG đụng
//     collection `users` (giữ đúng quyết định thiết kế "2 nguồn ĐỘC LẬP" đã có từ trước).
//   - lib/orgChart.js::planForceDeleteNodeCascade() — dry-run 1 lượt trên cả nhánh (node + con), tách
//     occupant thành 2 nhóm: accountMatches (khớp qua users.jobTitle/dept — KHÔNG tự sửa được, phải
//     chặn cứng) và profileMatches (khớp qua employeeProfiles.positionKey — tự gỡ được). Nếu CÒN BẤT
//     KỲ accountMatches nào thì chặn cứng toàn bộ, KHÔNG mutate gì (atomic all-or-nothing).
//   - routes/orgChart.js: quyền RIÊNG orgChartForceUnassignDelete (mặc định KHÔNG ai có) + route mới
//     POST /versions/:id/nodes/:nodeId/force-delete (2 khoá tuần tự: employeeProfiles rồi orgChartVersions).
//
//   PHẦN A (gọi thẳng lib/orgChart.js + lib/employeeProfile.js, không cần HTTP):
//     1. Vị trí chỉ có occupant qua Hồ Sơ Nhân Sự (profileMatch) -> gỡ thành công, trả về đúng
//        clearedProfiles, profile.positionKey/jobTitle/... về null, có thêm 1 dòng positionHistory.
//     2. Vị trí có occupant qua tài khoản đăng nhập (users.jobTitle+dept khớp, KHÔNG qua Hồ Sơ) ->
//        chặn cứng 400, KHÔNG mutate bất kỳ employeeProfiles nào (kể cả hồ sơ khác trong cùng nhánh).
//     3. Nhánh có CẢ 2 vị trí — 1 chỉ profileMatch (gỡ được), 1 có accountMatch (chặn) -> toàn bộ bị
//        chặn (atomic), vị trí đầu KHÔNG bị gỡ dù lẽ ra gỡ được.
//     4. Cascade qua nhiều cấp (phòng ban -> 2 vị trí con) -> clearedProfiles trả đủ cả 2 khi cả 2 đều
//        chỉ có profileMatch.
//     5. Không ai giữ vị trí nào trong nhánh -> trả về [] (rỗng), không lỗi.
//     6. Version KHÔNG phải DRAFT (APPLIED) -> 400 (requireDraft chặn trước khi phân tích occupant).
//     7. profile.status === 'INACTIVE' hoặc linked user.active === false -> KHÔNG tính là occupant,
//        không nằm trong accountMatches/profileMatches/clearedProfiles.
//
//   PHẦN B (HTTP, routes/orgChart.js thật — stub lib/appData/lib/auth/lib/recordStore, giống khuôn
//   test-orgchart-delete-archived-version.js):
//     8. Người KHÔNG có quyền orgChartForceUnassignDelete (kể cả có orgChartManage) -> 403, không đụng
//        employeeProfiles/orgChartVersions.
//     9. Có quyền, vị trí chỉ profileMatch -> 200, node bị xoá khỏi orgChartVersions, profile tương
//        ứng trong employeeProfiles thật bị gỡ chức vụ (positionKey=null).
//     10. Có quyền, vị trí có accountMatch -> 400, employeeProfiles VÀ orgChartVersions đều giữ
//         nguyên (không xoá node, không gỡ hồ sơ nào).
//     11. Version/nodeId không tồn tại -> 404.
//
// Chạy: node server/tests/test-orgchart-force-unassign-delete.js
'use strict';
const http = require('http');
const path = require('path');
const { createRunner, assertEqual, assert } = require('./testHarness');
const orgChart = require('../lib/orgChart');
const { clearPositionAssignmentForce } = require('../lib/employeeProfile');

// ===== PHẦN A =====
function makeDraftVersion() {
  return {
    id: 10, versionName: 'Nháp Test', status: 'DRAFT', kpiFlow: [],
    nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', positionKey: null, displayOrder: 0 },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Test', departmentRef: 'Phòng Test', positionKey: null, displayOrder: 0 },
      { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Nhân Viên A', requiresDept: true, positionKey: 'PK-A', displayOrder: 0 },
      { nodeId: 4, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Nhân Viên B', requiresDept: true, positionKey: 'PK-B', displayOrder: 1 }
    ]
  };
}
function makeProfile(overrides) {
  return Object.assign({
    employeeCode: 'NV1', username: 'nv1', positionKey: 'PK-A', jobTitle: 'Nhân Viên A', dept: 'Phòng Test',
    positionLabel: null, posType: null, jobGrade: null, status: 'ACTIVE', positionHistory: []
  }, overrides);
}

async function runPureTests(run) {
  await run.run('1. Vị trí chỉ có occupant qua Hồ Sơ Nhân Sự -> gỡ thành công, trả đúng clearedProfiles + positionHistory', () => {
    const version = makeDraftVersion();
    const users = [{ username: 'nv1', name: 'Nguyễn Văn A', active: true, jobTitle: 'Khác', dept: 'Khác' }];
    const profile = makeProfile();
    const profiles = [profile];
    const cleared = orgChart.planForceDeleteNodeCascade(version, 3, users, profiles, 'admin', 'Quản Trị');
    assertEqual(cleared.length, 1, 'Phải gỡ đúng 1 hồ sơ');
    assertEqual(cleared[0].employeeCode, 'NV1');
    assertEqual(profile.positionKey, null, 'positionKey phải về null');
    assertEqual(profile.jobTitle, null, 'jobTitle phải về null');
    assertEqual(profile.positionHistory.length, 1, 'Phải ghi 1 dòng lịch sử');
    assertEqual(profile.positionHistory[0].oldPositionKey, 'PK-A');
    assertEqual(profile.positionHistory[0].changedBy, 'admin');
  });

  await run.run('2. Vị trí có occupant qua TÀI KHOẢN ĐĂNG NHẬP -> chặn cứng 400, KHÔNG mutate hồ sơ nào', () => {
    const version = makeDraftVersion();
    const users = [{ username: 'nv1', name: 'Nguyễn Văn A', active: true, jobTitle: 'Nhân Viên A', dept: 'Phòng Test' }];
    const profile = makeProfile({ positionKey: null, jobTitle: null, dept: null }); // hồ sơ KHÔNG giữ vị trí này (chỉ account khớp)
    const profiles = [profile];
    const before = JSON.parse(JSON.stringify(profiles));
    let threw = false;
    try { orgChart.planForceDeleteNodeCascade(version, 3, users, profiles, 'admin', 'Quản Trị'); }
    catch (err) { threw = true; assert(/400|không thể buộc gỡ/i.test(err.message), `message đúng: ${err.message}`); }
    assert(threw, 'Phải chặn cứng khi còn tài khoản đăng nhập khớp đúng vị trí');
    assertEqual(JSON.stringify(profiles), JSON.stringify(before), 'employeeProfiles KHÔNG bị đổi gì khi bị chặn');
  });

  await run.run('3. Nhánh có CẢ 2 vị trí (1 profileMatch gỡ được, 1 accountMatch bị chặn) -> toàn bộ chặn, KHÔNG gỡ vị trí đầu', () => {
    const version = makeDraftVersion();
    const users = [
      { username: 'nv1', name: 'Nguyễn Văn A', active: true, jobTitle: 'Khác', dept: 'Khác' },
      { username: 'nv2', name: 'Trần Văn B', active: true, jobTitle: 'Nhân Viên B', dept: 'Phòng Test' }
    ];
    const profileA = makeProfile({ employeeCode: 'NV1', username: 'nv1', positionKey: 'PK-A' });
    const profileB = makeProfile({ employeeCode: 'NV2', username: 'nv2', positionKey: null, jobTitle: null, dept: null });
    const profiles = [profileA, profileB];
    let threw = false;
    try { orgChart.planForceDeleteNodeCascade(version, 2, users, profiles, 'admin', 'Quản Trị'); } // xoá cả Phòng Test
    catch (err) { threw = true; }
    assert(threw, 'Phải chặn toàn bộ nhánh khi còn 1 accountMatch bất kỳ');
    assertEqual(profileA.positionKey, 'PK-A', 'Vị trí profileMatch KHÔNG được gỡ khi nhánh bị chặn (atomic)');
  });

  await run.run('4. Cascade 2 vị trí con đều chỉ profileMatch -> trả đủ clearedProfiles cho cả 2', () => {
    const version = makeDraftVersion();
    const users = [
      { username: 'nv1', name: 'Nguyễn Văn A', active: true, jobTitle: 'Khác', dept: 'Khác' },
      { username: 'nv2', name: 'Trần Văn B', active: true, jobTitle: 'Khác', dept: 'Khác' }
    ];
    const profileA = makeProfile({ employeeCode: 'NV1', username: 'nv1', positionKey: 'PK-A' });
    const profileB = makeProfile({ employeeCode: 'NV2', username: 'nv2', positionKey: 'PK-B', jobTitle: 'Nhân Viên B' });
    const profiles = [profileA, profileB];
    const cleared = orgChart.planForceDeleteNodeCascade(version, 2, users, profiles, 'admin', 'Quản Trị');
    assertEqual(cleared.length, 2, 'Phải gỡ đúng 2 hồ sơ (cả nhánh Phòng Test)');
    assertEqual(profileA.positionKey, null);
    assertEqual(profileB.positionKey, null);
  });

  await run.run('5. Không ai giữ vị trí nào trong nhánh -> trả về [] rỗng, không lỗi', () => {
    const version = makeDraftVersion();
    const cleared = orgChart.planForceDeleteNodeCascade(version, 3, [], [], 'admin', 'Quản Trị');
    assertEqual(cleared.length, 0);
  });

  await run.run('6. Version KHÔNG phải DRAFT (APPLIED) -> 400, chặn trước khi phân tích occupant', () => {
    const version = makeDraftVersion();
    version.status = 'APPLIED';
    let threw = false;
    try { orgChart.planForceDeleteNodeCascade(version, 3, [], [], 'admin', 'Quản Trị'); }
    catch (err) { threw = true; assert(/400|nháp/i.test(err.message), `message đúng: ${err.message}`); }
    assert(threw, 'Phải chặn khi version không phải DRAFT');
  });

  await run.run('7. Hồ sơ INACTIVE hoặc tài khoản liên kết active=false -> KHÔNG tính là occupant', () => {
    const version = makeDraftVersion();
    const users = [{ username: 'nv1', name: 'Nguyễn Văn A', active: false, jobTitle: 'Khác', dept: 'Khác' }];
    const profile = makeProfile({ status: 'INACTIVE' }); // hồ sơ đã nghỉ, vẫn còn positionKey cũ (dữ liệu lịch sử)
    const cleared = orgChart.planForceDeleteNodeCascade(version, 3, users, [profile], 'admin', 'Quản Trị');
    assertEqual(cleared.length, 0, 'Hồ sơ INACTIVE không được tính là occupant cần gỡ');
    assertEqual(profile.positionKey, 'PK-A', 'Hồ sơ INACTIVE không bị động tới (không nằm trong phạm vi tính năng này)');
  });

  await run.run('clearPositionAssignmentForce(): hồ sơ không có positionKey -> trả về false, vô hại', () => {
    const profile = makeProfile({ positionKey: null, jobTitle: null, dept: null });
    const result = clearPositionAssignmentForce(profile, 'admin', 'Quản Trị', 'test');
    assertEqual(result, false);
    assertEqual(profile.positionHistory.length, 0, 'Không ghi lịch sử khi không có gì để gỡ');
  });
}

// ===== PHẦN B: HTTP qua routes/orgChart.js thật =====
function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const MANAGER_ONLY = { username: 'ocmanager', name: 'Quản Lý Cây', dept: 'Nhân Sự', perms: { orgChartManage: true }, active: true };
const FORCE_DELETER = { username: 'ocforcedel', name: 'Được Buộc Gỡ', dept: 'Nhân Sự', perms: { orgChartManage: true, orgChartForceUnassignDelete: true }, active: true };
let USERS = [MANAGER_ONLY, FORCE_DELETER, { username: 'nv1', name: 'Nguyễn Văn A', dept: 'Phòng Test', jobTitle: 'Khác', active: true }];
let APP_DATA;
function resetAppData(versions, employeeProfiles) {
  APP_DATA = { users: USERS, orgChartVersions: versions, employeeProfiles: employeeProfiles || [] };
}
let PORT = 0;
let CURRENT_USERNAME = FORCE_DELETER.username;

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
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
stubModule('lib/recordStore', { getAllForCollection: async () => [] });

const express = require('express');
const orgChartRoutes = require('../routes/orgChart');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/org-chart', orgChartRoutes);
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

async function main() {
  const server = await startApp();
  const run = createRunner();
  try {
    await runPureTests(run);

    await run.run('8. Người KHÔNG có orgChartForceUnassignDelete (kể cả có orgChartManage) -> 403, không đụng gì', async () => {
      resetAppData([makeDraftVersion()], [makeProfile()]);
      const res = await api('POST', '/api/org-chart/versions/10/nodes/3/force-delete', {}, MANAGER_ONLY);
      assertEqual(res.status, 403, 'orgChartManage KHÔNG đủ quyền buộc gỡ & xoá');
      assertEqual(APP_DATA.orgChartVersions[0].nodes.length, 4, 'Node KHÔNG bị xoá');
      assertEqual(APP_DATA.employeeProfiles[0].positionKey, 'PK-A', 'Hồ sơ KHÔNG bị gỡ');
    });

    await run.run('9. Có quyền, vị trí chỉ profileMatch -> 200, xoá node thật + gỡ chức vụ hồ sơ thật', async () => {
      resetAppData([makeDraftVersion()], [makeProfile()]);
      const res = await api('POST', '/api/org-chart/versions/10/nodes/3/force-delete', {}, FORCE_DELETER);
      assertEqual(res.status, 200, 'Phải thành công');
      assertEqual(res.body.clearedProfiles.length, 1);
      assert(!APP_DATA.orgChartVersions[0].nodes.some(n => n.nodeId === 3), 'Node phải bị xoá khỏi orgChartVersions thật');
      assertEqual(APP_DATA.employeeProfiles[0].positionKey, null, 'employeeProfiles thật phải bị gỡ chức vụ');
    });

    await run.run('10. Có quyền, vị trí có accountMatch -> 400, GIỮ NGUYÊN cả employeeProfiles và orgChartVersions', async () => {
      // nv1 (đã có trong USERS) có jobTitle='Khác' -> đổi version để node 3 yêu cầu đúng jobTitle đó
      const version = makeDraftVersion();
      version.nodes[2].jobTitle = 'Khác'; // khớp đúng users[nv1].jobTitle='Khác' + dept='Phòng Test'
      resetAppData([version], []);
      const res = await api('POST', '/api/org-chart/versions/10/nodes/3/force-delete', {}, FORCE_DELETER);
      assertEqual(res.status, 400, 'Phải chặn khi còn tài khoản đăng nhập khớp vị trí');
      assertEqual(APP_DATA.orgChartVersions[0].nodes.length, 4, 'Node KHÔNG bị xoá khi bị chặn');
      assertEqual(APP_DATA.employeeProfiles.length, 0, 'Không có hồ sơ nào bị động tới');
    });

    await run.run('11. Version không tồn tại -> 404', async () => {
      resetAppData([makeDraftVersion()], [makeProfile()]);
      const res = await api('POST', '/api/org-chart/versions/999/nodes/3/force-delete', {}, FORCE_DELETER);
      assertEqual(res.status, 404);
    });

    await run.run('11b. nodeId không tồn tại trong version -> 404', async () => {
      resetAppData([makeDraftVersion()], [makeProfile()]);
      const res = await api('POST', '/api/org-chart/versions/10/nodes/999/force-delete', {}, FORCE_DELETER);
      assertEqual(res.status, 404);
    });
  } finally {
    server.close();
  }
  run.summary();
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
