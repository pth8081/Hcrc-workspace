// server/tests/test-orgchart-force-apply.js
//
// TÍNH NĂNG MỚI (11/2026, theo yêu cầu người dùng: "tôi muốn xóa để thay thế bản khác làm từ đầu" — có
// quy mô QUÁ LỚN để đi "Buộc Gỡ & Xoá" (xem test-orgchart-force-unassign-delete.js) từng node 1, VD thay
// thế cả khối Siêu Thị/Cửa Hàng với hàng trăm người giữ vị trí cùng lúc): "🚨 Áp Dụng Cưỡng Chế" —
// POST /versions/:id/apply với body { force: true }, CÙNG quyền riêng orgChartForceUnassignDelete
// (không có quyền mới) — bỏ qua check "vị trí bị xoá nhưng còn người giữ" ở computeValidationIssues()
// (CHỈ check đó — vẫn giữ nguyên check node mồ côi/nhiều "Trưởng phòng"), sau khi đã TỰ GỠ chức vụ Hồ Sơ
// Nhân Sự của MỌI người giữ các vị trí bị xoá (lib/orgChart.js::planForceApplyUnassignOccupiedPositions()
// — CÙNG RANH GIỚI "2 nguồn ĐỘC LẬP" như planForceDeleteNodeCascade(): KHÔNG BAO GIỜ tự sửa tài khoản
// đăng nhập, chỉ BÁO CÁO accountsNeedingManualFix — nhưng KHÁC ở chỗ KHÔNG chặn cứng toàn bộ khi gặp
// account khớp, vì ở quy mô thay thế HÀNG LOẠT, chặn cứng theo từng tài khoản sẽ không bao giờ áp dụng
// được).
//
//   PHẦN A (gọi thẳng lib/orgChart.js, không cần HTTP):
//     1. planForceApplyUnassignOccupiedPositions(): vị trí bị xoá chỉ có occupant qua Hồ Sơ Nhân Sự ->
//        gỡ thành công, trả clearedProfiles đúng, accountsNeedingManualFix rỗng.
//     2. vị trí bị xoá có occupant qua TÀI KHOẢN ĐĂNG NHẬP -> KHÔNG throw (khác hẳn
//        planForceDeleteNodeCascade()), trả về accountsNeedingManualFix đúng, KHÔNG mutate users/profile.
//     3. Cả 2 loại cùng lúc (nhiều vị trí bị xoá) -> gỡ đúng phần profile-match, báo đúng phần account-match.
//     4. Không có appliedVersion (version đầu tiên) -> trả về rỗng cả 2, không lỗi.
//     5. computeValidationIssues({skipOccupancyCheck:true}) bỏ qua ĐÚNG 1 check đó, vẫn giữ nguyên check
//        node mồ côi (check #1).
//     6. applyVersionInPlace({forceUnassignOccupied:true}) áp dụng được dù còn occupant (profile CHƯA
//        được gỡ thủ công ở bước này — hàm applyVersionInPlace() tự nó KHÔNG gỡ gì, chỉ bỏ qua chặn).
//
//   PHẦN B (HTTP, routes/orgChart.js thật — cùng khuôn test-orgchart-force-unassign-delete.js):
//     7. Áp dụng thường (không force) khi còn người giữ vị trí bị xoá -> 400 y hệt hành vi CŨ (không
//        regression).
//     8. force:true nhưng KHÔNG có quyền orgChartForceUnassignDelete (kể cả có orgChartManage) -> 403,
//        KHÔNG đụng employeeProfiles/orgChartVersions.
//     9. force:true + có quyền, occupant CHỈ qua Hồ Sơ Nhân Sự -> 200, áp dụng thành công, hồ sơ bị gỡ
//        chức vụ thật, trả đúng clearedProfiles.
//     10. force:true + có quyền, occupant có CẢ account-match -> 200 (KHÔNG bị chặn như force-delete
//         từng node), trả đúng accountsNeedingManualFix, KHÔNG sửa users thật.
//     11. force:true nhưng bản nháp còn lỗi KHÁC (node mồ côi) -> 400 vẫn báo lỗi đó, KHÔNG áp dụng được
//         (xác nhận force KHÔNG bỏ qua hết mọi lỗi, chỉ đúng 1 loại).
//
// Chạy: node server/tests/test-orgchart-force-apply.js
'use strict';
const http = require('http');
const path = require('path');
const { createRunner, assertEqual, assert } = require('./testHarness');
const orgChart = require('../lib/orgChart');

// ===== PHẦN A =====
function makeAppliedVersion() {
  return {
    id: 1, versionName: 'Đang Áp Dụng', status: 'APPLIED', kpiFlow: [], clonedFromVersionId: null, effectiveDate: '2026-01-01',
    nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', positionKey: null, displayOrder: 0 },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Test', departmentRef: 'Phòng Test', positionKey: null, displayOrder: 0 },
      { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Nhân Viên A', requiresDept: true, positionKey: 'PK-A', displayOrder: 0 },
      { nodeId: 4, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Nhân Viên B', requiresDept: true, positionKey: 'PK-B', displayOrder: 1 }
    ]
  };
}
// Bản nháp mới XOÁ HẲN cả 2 vị trí PK-A/PK-B khỏi cây (mô phỏng đúng kịch bản người dùng — thay cả 1
// nhánh lớn, không giữ lại vị trí nào của cấu trúc cũ).
function makeDraftWithoutPositions() {
  return {
    id: 10, versionName: 'Nháp Thay Thế', status: 'DRAFT', kpiFlow: [], clonedFromVersionId: null,
    nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', positionKey: null, displayOrder: 0 },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Test Mới', departmentRef: 'Phòng Test Mới', positionKey: null, displayOrder: 0 }
    ]
  };
}
function makeDraftWithOrphanNode() {
  const v = makeDraftWithoutPositions();
  v.nodes.push({ nodeId: 99, parentNodeId: 12345, nodeType: 'POSITION', jobTitle: 'Mồ Côi', requiresDept: true, positionKey: 'PK-ORPHAN', displayOrder: 0 });
  return v;
}
function makeProfile(overrides) {
  return Object.assign({
    employeeCode: 'NV1', username: 'nv1', positionKey: 'PK-A', jobTitle: 'Nhân Viên A', dept: 'Phòng Test',
    positionLabel: null, posType: null, jobGrade: null, status: 'ACTIVE', positionHistory: []
  }, overrides);
}

async function runPureTests(run) {
  await run.run('1. planForceApplyUnassignOccupiedPositions(): occupant CHỈ qua Hồ Sơ Nhân Sự -> gỡ thành công, accountsNeedingManualFix rỗng', () => {
    const applied = makeAppliedVersion();
    const draft = makeDraftWithoutPositions();
    const users = [{ username: 'nv1', name: 'Nguyễn Văn A', active: true, jobTitle: 'Khác', dept: 'Khác' }];
    const profile = makeProfile();
    const { clearedProfiles, accountsNeedingManualFix } = orgChart.planForceApplyUnassignOccupiedPositions(draft, applied, users, [profile], 'admin', 'Quản Trị');
    assertEqual(clearedProfiles.length, 1, 'Phải gỡ đúng 1 hồ sơ (PK-A)');
    assertEqual(clearedProfiles[0].employeeCode, 'NV1');
    assertEqual(profile.positionKey, null, 'positionKey phải về null');
    assertEqual(accountsNeedingManualFix.length, 0, 'Không có account nào khớp qua đăng nhập');
  });

  await run.run('2. occupant qua TÀI KHOẢN ĐĂNG NHẬP -> KHÔNG throw, trả accountsNeedingManualFix đúng, KHÔNG mutate gì', () => {
    const applied = makeAppliedVersion();
    const draft = makeDraftWithoutPositions();
    const users = [{ username: 'nv2', name: 'Trần Văn B', active: true, jobTitle: 'Nhân Viên B', dept: 'Phòng Test' }];
    const before = JSON.parse(JSON.stringify(users));
    let threw = false;
    let result;
    try { result = orgChart.planForceApplyUnassignOccupiedPositions(draft, applied, users, [], 'admin', 'Quản Trị'); }
    catch (e) { threw = true; }
    assertEqual(threw, false, 'KHÔNG được throw khi có account-match (khác hẳn planForceDeleteNodeCascade())');
    assertEqual(result.clearedProfiles.length, 0, 'Không có hồ sơ nào để gỡ');
    assertEqual(result.accountsNeedingManualFix.length, 1, 'Phải báo đúng 1 account cần tự sửa');
    assertEqual(result.accountsNeedingManualFix[0].username, 'nv2');
    assertEqual(result.accountsNeedingManualFix[0].positionLabel.includes('Nhân Viên B'), true);
    assertEqual(JSON.stringify(users), JSON.stringify(before), 'users KHÔNG bị đổi gì (ranh giới 2 nguồn độc lập)');
  });

  await run.run('3. Cả 2 vị trí bị xoá cùng lúc, 1 profile-match + 1 account-match -> gỡ đúng phần gỡ được, báo đúng phần còn lại', () => {
    const applied = makeAppliedVersion();
    const draft = makeDraftWithoutPositions();
    const users = [
      { username: 'nv1', name: 'Nguyễn Văn A', active: true, jobTitle: 'Khác', dept: 'Khác' },
      { username: 'nv2', name: 'Trần Văn B', active: true, jobTitle: 'Nhân Viên B', dept: 'Phòng Test' }
    ];
    const profileA = makeProfile({ employeeCode: 'NV1', username: 'nv1', positionKey: 'PK-A' });
    const { clearedProfiles, accountsNeedingManualFix } = orgChart.planForceApplyUnassignOccupiedPositions(draft, applied, users, [profileA], 'admin', 'Quản Trị');
    assertEqual(clearedProfiles.length, 1, 'PK-A gỡ được qua hồ sơ');
    assertEqual(profileA.positionKey, null);
    assertEqual(accountsNeedingManualFix.length, 1, 'PK-B chỉ báo cáo (nv2 khớp qua tài khoản)');
    assertEqual(accountsNeedingManualFix[0].username, 'nv2');
  });

  await run.run('4. Không có appliedVersion (version đầu tiên) -> trả về rỗng cả 2, không lỗi', () => {
    const draft = makeDraftWithoutPositions();
    const result = orgChart.planForceApplyUnassignOccupiedPositions(draft, null, [], [], 'admin', 'Quản Trị');
    assertEqual(result.clearedProfiles.length, 0);
    assertEqual(result.accountsNeedingManualFix.length, 0);
  });

  await run.run('5. computeValidationIssues({skipOccupancyCheck:true}) bỏ ĐÚNG check occupant, VẪN giữ check node mồ côi', () => {
    const applied = makeAppliedVersion();
    const draftOrphan = makeDraftWithOrphanNode();
    const users = [{ username: 'nv1', name: 'Nguyễn Văn A', active: true, jobTitle: 'Khác', dept: 'Khác' }];
    const profile = makeProfile();
    const issuesNormal = orgChart.computeValidationIssues(draftOrphan, applied, users, [profile]);
    assert(issuesNormal.some(i => /vẫn có người giữ/.test(i)), 'Bình thường phải có issue occupant');
    assert(issuesNormal.some(i => /node cha không tồn tại/.test(i)), 'Bình thường phải có issue node mồ côi');
    const issuesForced = orgChart.computeValidationIssues(draftOrphan, applied, users, [profile], { skipOccupancyCheck: true });
    assert(!issuesForced.some(i => /vẫn có người giữ/.test(i)), 'Cưỡng chế phải bỏ qua issue occupant');
    assert(issuesForced.some(i => /node cha không tồn tại/.test(i)), 'Cưỡng chế KHÔNG được bỏ qua issue node mồ côi (lỗi cấu trúc riêng của bản nháp)');
  });

  await run.run('6. applyVersionInPlace({forceUnassignOccupied:true}) áp dụng được dù còn occupant CHƯA được gỡ', () => {
    const applied = makeAppliedVersion();
    const draft = makeDraftWithoutPositions();
    const list = [applied, draft];
    const users = [{ username: 'nv1', name: 'Nguyễn Văn A', active: true, jobTitle: 'Khác', dept: 'Khác' }];
    const profile = makeProfile(); // CỐ Ý chưa gỡ — xác nhận applyVersionInPlace() tự nó KHÔNG đòi hỏi đã gỡ, chỉ bỏ qua chặn
    const result = orgChart.applyVersionInPlace(list, 10, users, 'admin', [profile], { forceUnassignOccupied: true });
    assertEqual(result.status, 'APPLIED');
    assertEqual(applied.status, 'ARCHIVED', 'Bản cũ phải chuyển Lưu Trữ');
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
const FORCE_APPLIER = { username: 'ocforceapply', name: 'Được Áp Dụng Cưỡng Chế', dept: 'Nhân Sự', perms: { orgChartManage: true, orgChartForceUnassignDelete: true }, active: true };
// nv1 jobTitle='Khác' -> KHÔNG khớp account nào trong PK-A/PK-B (chỉ profileMatch qua employeeProfiles).
// nv2 chỉ thêm ở TEST 10 (jobTitle/dept khớp ĐÚNG "Nhân Viên B" — account-match PK-B) — KHÔNG đưa vào mặc
// định để các test khác (9, 11...) không vô tình dính account-match ngoài ý muốn.
let USERS;
let APP_DATA;
function resetAppData(versions, employeeProfiles, extraUsers) {
  USERS = [MANAGER_ONLY, FORCE_APPLIER, { username: 'nv1', name: 'Nguyễn Văn A', dept: 'Phòng Test', jobTitle: 'Khác', active: true }, ...(extraUsers || [])];
  APP_DATA = { users: USERS, orgChartVersions: versions, employeeProfiles: employeeProfiles || [] };
}
let PORT = 0;
let CURRENT_USERNAME = FORCE_APPLIER.username;

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

    await run.run('7. Áp dụng THƯỜNG (không force) khi còn người giữ vị trí bị xoá -> 400, KHÔNG regression', async () => {
      resetAppData([makeAppliedVersion(), makeDraftWithoutPositions()], [makeProfile()]);
      const res = await api('POST', '/api/org-chart/versions/10/apply', {}, FORCE_APPLIER);
      assertEqual(res.status, 400, 'Phải chặn như hành vi cũ');
      assert(/vẫn có người giữ/.test(res.body.error), `message đúng: ${res.body.error}`);
      assertEqual(APP_DATA.orgChartVersions.find(v => v.id === 10).status, 'DRAFT', 'Bản nháp KHÔNG được áp dụng');
      assertEqual(APP_DATA.employeeProfiles[0].positionKey, 'PK-A', 'Hồ sơ KHÔNG bị đụng tới');
    });

    await run.run('8. force:true nhưng KHÔNG có quyền orgChartForceUnassignDelete -> 403, KHÔNG đụng gì', async () => {
      resetAppData([makeAppliedVersion(), makeDraftWithoutPositions()], [makeProfile()]);
      const res = await api('POST', '/api/org-chart/versions/10/apply', { force: true }, MANAGER_ONLY);
      assertEqual(res.status, 403, 'orgChartManage KHÔNG đủ quyền áp dụng cưỡng chế');
      assertEqual(APP_DATA.orgChartVersions.find(v => v.id === 10).status, 'DRAFT');
      assertEqual(APP_DATA.employeeProfiles[0].positionKey, 'PK-A', 'Hồ sơ KHÔNG bị gỡ');
    });

    await run.run('9. force:true + có quyền, occupant CHỈ qua Hồ Sơ Nhân Sự -> 200, áp dụng thật + gỡ chức vụ thật', async () => {
      resetAppData([makeAppliedVersion(), makeDraftWithoutPositions()], [makeProfile()]);
      const res = await api('POST', '/api/org-chart/versions/10/apply', { force: true }, FORCE_APPLIER);
      assertEqual(res.status, 200, `phải thành công, got: ${JSON.stringify(res.body)}`);
      assertEqual(res.body.clearedProfiles.length, 1);
      assertEqual(res.body.accountsNeedingManualFix.length, 0);
      assertEqual(APP_DATA.orgChartVersions.find(v => v.id === 10).status, 'APPLIED', 'Bản nháp phải chuyển APPLIED thật');
      assertEqual(APP_DATA.orgChartVersions.find(v => v.id === 1).status, 'ARCHIVED', 'Bản cũ phải chuyển Lưu Trữ thật');
      assertEqual(APP_DATA.employeeProfiles[0].positionKey, null, 'Hồ sơ thật phải bị gỡ chức vụ');
    });

    await run.run('10. force:true + có quyền, occupant có CẢ account-match -> 200 (KHÔNG chặn), báo đúng accountsNeedingManualFix, KHÔNG sửa users', async () => {
      const nv2 = { username: 'nv2', name: 'Trần Văn B', dept: 'Phòng Test', jobTitle: 'Nhân Viên B', active: true };
      resetAppData([makeAppliedVersion(), makeDraftWithoutPositions()], [], [nv2]);
      const usersBefore = JSON.parse(JSON.stringify(APP_DATA.users));
      const res = await api('POST', '/api/org-chart/versions/10/apply', { force: true }, FORCE_APPLIER);
      assertEqual(res.status, 200, `phải thành công dù còn account-match, got: ${JSON.stringify(res.body)}`);
      assertEqual(res.body.accountsNeedingManualFix.length, 1, 'Phải báo đúng 1 account (nv2, PK-B)');
      assertEqual(res.body.accountsNeedingManualFix[0].username, 'nv2');
      assertEqual(APP_DATA.orgChartVersions.find(v => v.id === 10).status, 'APPLIED', 'Vẫn áp dụng được dù còn account-match');
      assertEqual(JSON.stringify(APP_DATA.users), JSON.stringify(usersBefore), 'users (tài khoản đăng nhập) KHÔNG bị sửa gì');
    });

    await run.run('11. force:true nhưng bản nháp còn lỗi KHÁC (node mồ côi) -> 400 vẫn báo lỗi đó, KHÔNG áp dụng', async () => {
      resetAppData([makeAppliedVersion(), makeDraftWithOrphanNode()], [makeProfile()]);
      const res = await api('POST', '/api/org-chart/versions/10/apply', { force: true }, FORCE_APPLIER);
      assertEqual(res.status, 400, `phải vẫn bị chặn bởi lỗi node mồ côi, got: ${JSON.stringify(res.body)}`);
      assert(/node cha không tồn tại/.test(res.body.error), `message đúng: ${res.body.error}`);
      assert(!/vẫn có người giữ/.test(res.body.error), 'KHÔNG được còn lẫn issue occupant (đã bỏ qua đúng phần đó)');
      assertEqual(APP_DATA.orgChartVersions.find(v => v.id === 10).status, 'DRAFT', 'KHÔNG được áp dụng khi còn lỗi cấu trúc khác');
    });
  } finally {
    server.close();
  }
  run.summary();
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
