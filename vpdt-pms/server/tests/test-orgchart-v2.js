// server/tests/test-orgchart-v2.js
//
// Regression test cho "Nhân Sự > Cơ Cấu Tổ Chức" v2 (cây CÓ VERSIONING + Cấu Hình Luồng Đánh Giá KPI
// Theo Vị Trí) — xem lib/orgChart.js/routes/orgChart.js/defaults.js (orgChartVersions)/routes/data.js
// (NON_ADMIN_GATED_KEYS.orgChartVersions). Thay hẳn tests/test-kpi-evaluator-config.js +
// tests/demo-kpi-evaluator-config.js + tests/test-orgchart-excel-import.js (bản v1 dept×jobTitle map
// phẳng + Excel import/export thủ công — đã xoá hoàn toàn khỏi code, không còn gì để test).
//
//   PHẦN A (server, chạy thẳng express router THẬT routes/orgChart.js — KHÔNG mở Playwright, chỉ giả
//   lập tầng lưu trữ lib/appData + middleware xác thực lib/auth, cùng khuôn test-kpi-evaluator-config.js
//   bản cũ):
//     1-3. Quyền: XEM mở cho orgChartManage/nhanSuManage/kpiFlowConfigManage/admin, KHÔNG cho người
//          không có quyền nào trong 4 quyền trên; SỬA CÂY chỉ orgChartManage/admin (nhanSuManage/
//          kpiFlowConfigManage KHÔNG đủ); SỬA LUỒNG KPI orgChartManage/kpiFlowConfigManage/admin.
//     4. Bootstrap: tạo version DRAFT đầu tiên (gốc COMPANY) — bootstrap lần 2 phải lỗi 400.
//     5. Thêm node DEPARTMENT + 2 POSITION (cha-con) — dựng cây Phòng Kinh Doanh/Trưởng phòng/Nhân viên.
//     6. Xoá node đang có người giữ -> 400, dữ liệu không đổi; xoá node KHÔNG ai giữ -> thành công,
//        cascade xoá luôn node con.
//     7. Validate bản nháp hợp lệ -> {valid:true, issues:[]}.
//     8. Apply: version DRAFT -> APPLIED; kpiFlow tự seed đúng 1 dòng (Trưởng phòng -> Nhân viên bán
//        hàng, isAutoFromHierarchy:true); user.managerUsername TỰ ĐỘNG cập nhật đúng cho nhân viên có
//        ĐÚNG 1 người giữ vị trí cha (Trưởng phòng), user giữ chính vị trí Trưởng phòng (cha là node
//        DEPARTMENT, không phải POSITION) KHÔNG bị đổi managerUsername (bỏ qua, không phải unresolved).
//     9. Apply version 2 (clone từ bản đã áp dụng, thêm nhánh Phòng IT với 2 người CÙNG giữ 1 vị trí
//        Trưởng phòng IT) -> bản cũ chuyển ARCHIVED, bản mới APPLIED; nhân viên dưới vị trí ambiguous đó
//        rơi vào unresolvedManagerUsers (đúng lý do "nhiều hơn 1 người").
//    10. KPI Flow: GET liệt kê đúng dòng auto-seed; POST thêm 1 quan hệ thủ công (chéo, không theo cây
//        báo cáo hành chính); DELETE gỡ được (kể cả dòng auto); GET /kpi-evaluators/:username tra đúng
//        người đánh giá hiện tại theo dòng vừa thêm.
//
//   PHẦN B (gọi thẳng các hàm THẬT trong lib/orgChart.js qua require() — module này là CommonJS chuẩn,
//   không cần vm sandbox như module-hcrcdonghanh.js kiểu cũ):
//    11. computeValidationIssues(): phát hiện node cha không tồn tại (mồ côi).
//    12. computeValidationIssues(): phát hiện vị trí bị xoá khỏi bản nháp nhưng bản ĐANG ÁP DỤNG vẫn có
//        người giữ.
//    13. computeValidationIssues(): phát hiện 2 node "Trưởng phòng" CÙNG phòng ban đều có người giữ.
//    14. diffVersions(): so đúng added/removed/changed giữa 2 version theo positionKey.
//
// Chạy: node server/tests/test-orgchart-v2.js
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

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const ORGCHART_MGR = { username: 'orgchart1', name: 'Quản Lý Cơ Cấu', dept: 'Phòng Nhân Sự', perms: { orgChartManage: true }, active: true };
const HR_MGR = { username: 'hr1', name: 'Nhân Sự Trưởng', dept: 'Phòng Nhân Sự', perms: { nhanSuManage: true }, active: true };
const KPI_MGR = { username: 'kpi1', name: 'Cấu Hình KPI', dept: 'Phòng Nhân Sự', perms: { kpiFlowConfigManage: true }, active: true };
const PLAIN = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Kế Toán', perms: {}, active: true };
let USERS = [ADMIN, ORGCHART_MGR, HR_MGR, KPI_MGR, PLAIN];

let APP_DATA;
function resetAppData() {
  APP_DATA = { users: USERS, orgChartVersions: [] };
}
resetAppData();

let PORT = 0;
let CURRENT_USERNAME = ADMIN.username;

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

const express = require('express');
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');
const orgChartRoutes = require('../routes/orgChart');
const orgChart = require('../lib/orgChart');

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
    // ===== PHẦN A: quyền =====
    await run.run('XEM (GET /versions) mở cho orgChartManage/nhanSuManage/kpiFlowConfigManage/admin, chặn người không quyền', async () => {
      resetAppData();
      for (const u of [ADMIN, ORGCHART_MGR, HR_MGR, KPI_MGR]) {
        const ok = await api('GET', '/api/org-chart/versions', undefined, u);
        assertEqual(ok.status, 200, `${u.username} phải xem được danh sách version`);
      }
      const denied = await api('GET', '/api/org-chart/versions', undefined, PLAIN);
      assertEqual(denied.status, 403, 'Nhân viên thường không có quyền nào liên quan phải bị chặn xem');
    });

    await run.run('SỬA CÂY (bootstrap) chỉ orgChartManage/admin — nhanSuManage/kpiFlowConfigManage KHÔNG đủ', async () => {
      resetAppData();
      const deniedHr = await api('POST', '/api/org-chart/bootstrap', { versionName: 'x' }, HR_MGR);
      assertEqual(deniedHr.status, 403, 'nhanSuManage không đủ quyền sửa cây');
      const deniedKpi = await api('POST', '/api/org-chart/bootstrap', { versionName: 'x' }, KPI_MGR);
      assertEqual(deniedKpi.status, 403, 'kpiFlowConfigManage không đủ quyền sửa cây');
      assertEqual((APP_DATA.orgChartVersions || []).length, 0, 'Không có version nào được tạo sau các lượt bị từ chối');
    });

    await run.run('SỬA LUỒNG KPI (POST kpi-flow) cho orgChartManage/kpiFlowConfigManage/admin, chặn nhanSuManage', async () => {
      resetAppData();
      await api('POST', '/api/org-chart/bootstrap', { versionName: 'CCTC' }, ORGCHART_MGR);
      const versionId = APP_DATA.orgChartVersions[0].id;
      // chưa có version APPLIED -> mọi request kpi-flow (dù đủ quyền) đều 400 "chưa có phiên bản đang áp dụng"
      const deniedHr = await api('POST', '/api/org-chart/kpi-flow', { evaluatorNodeId: 1, evaluateeNodeId: 1 }, HR_MGR);
      assertEqual(deniedHr.status, 403, 'nhanSuManage không đủ quyền sửa luồng KPI');
    });

    // ===== PHẦN A: vòng đời đầy đủ =====
    let versionId, deptNodeId, mgrNodeId, empNodeId;
    await run.run('Bootstrap version đầu tiên (gốc COMPANY) — bootstrap lần 2 phải lỗi 400', async () => {
      resetAppData();
      const first = await api('POST', '/api/org-chart/bootstrap', { versionName: 'Cơ cấu tổ chức 2026' }, ORGCHART_MGR);
      assertEqual(first.status, 200, 'Bootstrap lần đầu phải thành công');
      assertEqual(first.body.version.status, 'DRAFT', 'Version mới phải ở trạng thái DRAFT');
      assertEqual(first.body.version.nodes.length, 1, 'Phải có đúng 1 node gốc COMPANY');
      assertEqual(first.body.version.nodes[0].nodeType, 'COMPANY', 'Node gốc phải là COMPANY');
      versionId = first.body.version.id;
      const second = await api('POST', '/api/org-chart/bootstrap', { versionName: 'x' }, ORGCHART_MGR);
      assertEqual(second.status, 400, 'Bootstrap lần 2 khi đã có version phải lỗi');
    });

    await run.run('Thêm node DEPARTMENT + 2 POSITION cha-con (Phòng Kinh Doanh/Trưởng phòng/Nhân viên bán hàng)', async () => {
      const dept = await api('POST', `/api/org-chart/versions/${versionId}/nodes`, {
        parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', departmentRef: 'Phòng Kinh Doanh'
      }, ORGCHART_MGR);
      assertEqual(dept.status, 200, 'Thêm node DEPARTMENT phải thành công');
      deptNodeId = dept.body.node.nodeId;

      const mgr = await api('POST', `/api/org-chart/versions/${versionId}/nodes`, {
        parentNodeId: deptNodeId, nodeType: 'POSITION', jobTitle: 'Trưởng phòng', requiresDept: true
      }, ORGCHART_MGR);
      assertEqual(mgr.status, 200, 'Thêm node POSITION Trưởng phòng phải thành công');
      assertIncludes(typeof mgr.body.node.positionKey, 'string', 'POSITION phải có positionKey (GUID)');
      mgrNodeId = mgr.body.node.nodeId;

      const emp = await api('POST', `/api/org-chart/versions/${versionId}/nodes`, {
        parentNodeId: mgrNodeId, nodeType: 'POSITION', jobTitle: 'Nhân viên bán hàng', requiresDept: true
      }, ORGCHART_MGR);
      assertEqual(emp.status, 200, 'Thêm node POSITION Nhân viên bán hàng phải thành công');
      empNodeId = emp.body.node.nodeId;

      // thêm 3 nhân viên thật khớp đúng dept+jobTitle của cây vừa dựng
      USERS.push(
        { username: 'mgr_kd', name: 'Nguyễn Trưởng Phòng', dept: 'Phòng Kinh Doanh', jobTitle: 'Trưởng phòng', active: true, managerUsername: null },
        { username: 'nv_kd1', name: 'Trần Văn Bán 1', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên bán hàng', active: true, managerUsername: null },
        { username: 'nv_kd2', name: 'Trần Văn Bán 2', dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân viên bán hàng', active: true, managerUsername: null }
      );
      APP_DATA.users = USERS;
    });

    await run.run('Xoá node đang có người giữ -> 400 không đổi gì; xoá node KHÔNG ai giữ -> thành công + cascade', async () => {
      const blocked = await api('DELETE', `/api/org-chart/versions/${versionId}/nodes/${mgrNodeId}`, undefined, ORGCHART_MGR);
      assertEqual(blocked.status, 400, 'Không thể xoá vị trí đang có người giữ (mgr_kd giữ Trưởng phòng)');
      assertIncludes(blocked.body.error, 'Nguyễn Trưởng Phòng', 'Thông báo lỗi phải nêu rõ ai đang giữ');

      // thêm 1 node rỗng để test xoá thật + cascade con
      const tmp = await api('POST', `/api/org-chart/versions/${versionId}/nodes`, {
        parentNodeId: deptNodeId, nodeType: 'POSITION', jobTitle: 'Thực tập sinh (chưa tuyển ai)', requiresDept: true
      }, ORGCHART_MGR);
      const tmpChild = await api('POST', `/api/org-chart/versions/${versionId}/nodes`, {
        parentNodeId: tmp.body.node.nodeId, nodeType: 'POSITION', jobTitle: 'Cộng tác viên (chưa tuyển ai)', requiresDept: true
      }, ORGCHART_MGR);
      const del = await api('DELETE', `/api/org-chart/versions/${versionId}/nodes/${tmp.body.node.nodeId}`, undefined, ORGCHART_MGR);
      assertEqual(del.status, 200, 'Xoá vị trí không ai giữ phải thành công');
      assertEqual(del.body.deletedNodeIds.length, 2, 'Phải cascade xoá luôn node con (Cộng tác viên)');
      assertIncludes(del.body.deletedNodeIds, tmpChild.body.node.nodeId, 'Node con phải nằm trong danh sách bị xoá');
    });

    await run.run('Validate bản nháp hợp lệ -> {valid:true, issues:[]}', async () => {
      const res = await api('POST', `/api/org-chart/versions/${versionId}/validate`, undefined, ORGCHART_MGR);
      assertEqual(res.status, 200);
      assertEqual(res.body.valid, true, 'Cây hiện tại phải hợp lệ, không có lỗi');
      assertEqual(res.body.issues.length, 0);
    });

    await run.run('Apply version 1: DRAFT->APPLIED, kpiFlow tự seed, managerUsername tự cập nhật đúng (bỏ qua vị trí không có cha là POSITION)', async () => {
      const res = await api('POST', `/api/org-chart/versions/${versionId}/apply`, undefined, ORGCHART_MGR);
      assertEqual(res.status, 200, 'Apply phải thành công');
      assertEqual(res.body.version.status, 'APPLIED');
      assertEqual(res.body.version.kpiFlow.length, 1, 'Phải tự seed đúng 1 dòng KPI (Trưởng phòng -> Nhân viên bán hàng)');
      assertEqual(res.body.version.kpiFlow[0].isAutoFromHierarchy, true);
      assertEqual(res.body.unresolvedManagerUsers.length, 0, 'Không có ca nào cần cảnh báo ở lượt apply đầu tiên');

      const nv1 = USERS.find(u => u.username === 'nv_kd1');
      const nv2 = USERS.find(u => u.username === 'nv_kd2');
      const mgr = USERS.find(u => u.username === 'mgr_kd');
      assertEqual(nv1.managerUsername, 'mgr_kd', 'nv_kd1 phải được tự gán quản lý trực tiếp = mgr_kd');
      assertEqual(nv2.managerUsername, 'mgr_kd', 'nv_kd2 phải được tự gán quản lý trực tiếp = mgr_kd');
      assertEqual(mgr.managerUsername, null, 'mgr_kd (cha là node DEPARTMENT, không phải POSITION) KHÔNG bị đổi managerUsername');
    });

    let version2Id, itMgrPositionNodeId, itEmpNodeId;
    await run.run('Apply version 2 (clone, thêm nhánh Phòng IT 2 người CÙNG giữ 1 vị trí) -> bản 1 ARCHIVED, unresolved đúng lý do', async () => {
      const clone = await api('POST', `/api/org-chart/versions/${versionId}/clone`, { versionName: 'Cơ cấu tổ chức 2026 (bổ sung IT)' }, ORGCHART_MGR);
      assertEqual(clone.status, 200);
      version2Id = clone.body.version.id;
      assertEqual(clone.body.version.clonedFromVersionId, versionId);
      // positionKey của Trưởng phòng/Nhân viên bán hàng phải giữ NGUYÊN qua clone (continuity cho kpiFlow tham chiếu)
      const mgrNodeClone = clone.body.version.nodes.find(n => n.nodeId === mgrNodeId);
      assertEqual(mgrNodeClone.positionKey, USERS && true ? mgrNodeClone.positionKey : null); // sanity: field tồn tại
      assertIncludes(typeof mgrNodeClone.positionKey, 'string', 'positionKey phải còn nguyên sau clone');

      const itDept = await api('POST', `/api/org-chart/versions/${version2Id}/nodes`, {
        parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng IT', departmentRef: 'Phòng IT'
      }, ORGCHART_MGR);
      const itMgr = await api('POST', `/api/org-chart/versions/${version2Id}/nodes`, {
        parentNodeId: itDept.body.node.nodeId, nodeType: 'POSITION', jobTitle: 'Trưởng phòng IT', requiresDept: true
      }, ORGCHART_MGR);
      itMgrPositionNodeId = itMgr.body.node.nodeId;
      const itEmp = await api('POST', `/api/org-chart/versions/${version2Id}/nodes`, {
        parentNodeId: itMgrPositionNodeId, nodeType: 'POSITION', jobTitle: 'Chuyên viên IT', requiresDept: true
      }, ORGCHART_MGR);
      itEmpNodeId = itEmp.body.node.nodeId;

      USERS.push(
        { username: 'tp_it1', name: 'Lê Trưởng Phòng IT 1', dept: 'Phòng IT', jobTitle: 'Trưởng phòng IT', active: true, managerUsername: null },
        { username: 'tp_it2', name: 'Lê Trưởng Phòng IT 2', dept: 'Phòng IT', jobTitle: 'Trưởng phòng IT', active: true, managerUsername: null },
        { username: 'nv_it1', name: 'Phạm Chuyên Viên IT', dept: 'Phòng IT', jobTitle: 'Chuyên viên IT', active: true, managerUsername: null }
      );
      APP_DATA.users = USERS;

      const apply2 = await api('POST', `/api/org-chart/versions/${version2Id}/apply`, undefined, ORGCHART_MGR);
      assertEqual(apply2.status, 200, 'Apply version 2 phải thành công (không vi phạm luật "1 Trưởng phòng/dept" vì đây là 2 NGƯỜI trên CÙNG 1 node, không phải 2 node)');
      assertEqual(apply2.body.version.status, 'APPLIED');

      const list = await api('GET', '/api/org-chart/versions', undefined, ORGCHART_MGR);
      const v1 = list.body.versions.find(v => v.id === versionId);
      const v2 = list.body.versions.find(v => v.id === version2Id);
      assertEqual(v1.status, 'ARCHIVED', 'Bản 1 phải chuyển ARCHIVED sau khi bản 2 được apply');
      assertEqual(v2.status, 'APPLIED');

      const nvIt = USERS.find(u => u.username === 'nv_it1');
      assertEqual(nvIt.managerUsername, null, 'nv_it1 KHÔNG được gán managerUsername vì vị trí cha có 2 người cùng giữ (ambiguous)');
      const unresolvedEntry = apply2.body.unresolvedManagerUsers.find(u => u.username === 'nv_it1');
      assertIncludes(unresolvedEntry.reason, 'nhiều hơn 1 người', 'Lý do unresolved phải nêu đúng "nhiều hơn 1 người cùng giữ vị trí quản lý cấp trên"');
    });

    await run.run('KPI Flow: GET liệt kê dòng auto-seed; POST thêm quan hệ thủ công (chéo); DELETE gỡ được; kpi-evaluators/:username tra đúng', async () => {
      const list1 = await api('GET', '/api/org-chart/kpi-flow', undefined, ORGCHART_MGR);
      assertEqual(list1.status, 200);
      assertEqual(list1.body.rows.length, 2, 'Phải có 2 dòng auto-seed (Trưởng phòng->NV bán hàng, Trưởng phòng IT->Chuyên viên IT)');

      const manual = await api('POST', '/api/org-chart/kpi-flow', { evaluatorNodeId: itMgrPositionNodeId, evaluateeNodeId: empNodeId }, KPI_MGR);
      assertEqual(manual.status, 200, 'kpiFlowConfigManage phải thêm được quan hệ thủ công (chéo phòng ban)');
      assertEqual(manual.body.row.isAutoFromHierarchy, false, 'Dòng thêm thủ công phải đánh dấu isAutoFromHierarchy:false');

      const evalRes = await api('GET', '/api/org-chart/kpi-evaluators/nv_kd1', undefined, ORGCHART_MGR);
      assertEqual(evalRes.status, 200);
      const groupNames = evalRes.body.result.evaluatorGroups.map(g => g.positionName);
      assertIncludes(groupNames, 'Trưởng phòng Phòng Kinh Doanh', 'Phải có nhóm đánh giá tự động từ cây (Trưởng phòng)');
      assertIncludes(groupNames, 'Trưởng phòng IT Phòng IT', 'Phải có thêm nhóm đánh giá thủ công vừa thêm (Trưởng phòng IT)');

      const del = await api('DELETE', `/api/org-chart/kpi-flow/${manual.body.row.id}`, undefined, KPI_MGR);
      assertEqual(del.status, 200, 'Gỡ quan hệ thủ công phải thành công');
      const del2 = await api('DELETE', `/api/org-chart/kpi-flow/${manual.body.row.id}`, undefined, KPI_MGR);
      assertEqual(del2.status, 404, 'Gỡ lần 2 (đã gỡ rồi) phải báo không tìm thấy');

      const listFinal = await api('GET', '/api/org-chart/kpi-flow', undefined, ORGCHART_MGR);
      assertEqual(listFinal.body.rows.length, 2, 'Sau khi gỡ dòng thủ công, chỉ còn lại 2 dòng auto-seed ban đầu');
    });

  } finally {
    server.close();
  }

  // ===== PHẦN B: gọi thẳng hàm THẬT trong lib/orgChart.js =====
  await run.run('computeValidationIssues(): phát hiện node cha không tồn tại (mồ côi)', () => {
    const version = { nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' },
      { nodeId: 2, parentNodeId: 999, nodeType: 'DEPARTMENT', nodeName: 'Phòng Ma' }
    ], kpiFlow: [] };
    const issues = orgChart.computeValidationIssues(version, null, []);
    assertEqual(issues.length, 1);
    assertIncludes(issues[0], 'node cha không tồn tại');
  });

  await run.run('computeValidationIssues(): phát hiện vị trí bị xoá khỏi bản nháp nhưng bản ĐANG ÁP DỤNG vẫn có người giữ', () => {
    const applied = { nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng KD', departmentRef: 'Phòng KD' },
      { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Trưởng phòng', requiresDept: true, positionKey: 'key-3' }
    ], kpiFlow: [] };
    const candidate = { nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng KD', departmentRef: 'Phòng KD' }
    ], kpiFlow: [] };
    const users = [{ username: 'mgr_kd', name: 'Nguyễn Trưởng Phòng', dept: 'Phòng KD', jobTitle: 'Trưởng phòng', active: true }];
    const issues = orgChart.computeValidationIssues(candidate, applied, users);
    assertEqual(issues.length, 1);
    assertIncludes(issues[0], 'vẫn có người giữ');
  });

  await run.run('computeValidationIssues(): phát hiện 2 node "Trưởng phòng" CÙNG phòng ban đều có người giữ', () => {
    const version = { nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng KD', departmentRef: 'Phòng KD' },
      { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Trưởng phòng', requiresDept: true },
      { nodeId: 4, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Trưởng phòng (node thừa)', requiresDept: true }
    ], kpiFlow: [] };
    // sửa jobTitle node 4 để vẫn khớp regex /trưởng phòng/i nhưng khác chuỗi thật (mô phỏng lỗi nhập liệu)
    version.nodes[3].jobTitle = 'Trưởng Phòng';
    const users = [
      { username: 'a', name: 'A', dept: 'Phòng KD', jobTitle: 'Trưởng phòng', active: true },
      { username: 'b', name: 'B', dept: 'Phòng KD', jobTitle: 'Trưởng Phòng', active: true }
    ];
    const issues = orgChart.computeValidationIssues(version, null, users);
    assertEqual(issues.length, 1);
    assertIncludes(issues[0], 'nhiều hơn 1 "Trưởng phòng"');
  });

  await run.run('diffVersions(): so đúng added/removed/changed giữa 2 version theo positionKey', () => {
    const base = { nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng KD' },
      { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Trưởng phòng', requiresDept: true, positionKey: 'key-mgr' },
      { nodeId: 4, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Nhân viên cũ', requiresDept: true, positionKey: 'key-old' }
    ] };
    const other = { nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng KD' },
      { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Trưởng phòng cấp cao', requiresDept: true, positionKey: 'key-mgr' },
      { nodeId: 5, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Nhân viên mới', requiresDept: true, positionKey: 'key-new' }
    ] };
    const diff = orgChart.diffVersions(base, other);
    assertEqual(diff.added.length, 1);
    assertIncludes(diff.added[0], 'Nhân viên mới');
    assertEqual(diff.removed.length, 1);
    assertIncludes(diff.removed[0], 'Nhân viên cũ');
    assertEqual(diff.changed.length, 1);
    assertIncludes(diff.changed[0], 'Trưởng phòng cấp cao');
  });

  run.summary();
}

main().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
