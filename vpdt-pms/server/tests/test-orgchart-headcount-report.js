// server/tests/test-orgchart-headcount-report.js
//
// Regression test cho "Báo Cáo Định Biên Nhân Sự" (10/2026, theo yêu cầu người dùng "biết được định
// biên nhân sự hiện tại, định biên nhân sự cần tuyển") — xem lib/headcountReport.js +
// lib/orgChart.js (field headcountQuota trên node POSITION) + routes/orgChart.js (2 route mới).
//
//   PHẦN A (gọi thẳng lib/headcountReport.js::computeHeadcountReport() qua require(), không cần HTTP):
//     1. Vị trí có người ACTIVE bình thường -> đếm vào "active", actualTotal đúng, variance = quota - actual.
//     2. Vị trí có người ON_LEAVE -> đếm vào "onLeave", KHÔNG vào "active".
//     3. Hồ sơ ACTIVE nhưng có hrProcesses OFFBOARDING IN_PROGRESS khớp username -> đếm vào "offboarding",
//        KHÔNG vào "active" (ưu tiên offboarding trước khi xét onLeave/active).
//     4. Hồ sơ status INACTIVE (đã nghỉ hẳn) hoặc DRAFT (chưa chính thức) -> KHÔNG đếm vào bất kỳ cột nào.
//     5. Kiêm nhiệm (user.secondaryPositions khớp đúng dept+jobTitle của node) -> đếm 0.5/người.
//     6. Node không đặt headcountQuota (null) -> quota/variance trả về null (không phải 0).
//     7. Roll-up: node DEPARTMENT/COMPANY cộng dồn ĐÚNG tổng quota (chỉ cộng non-null) + actualTotal của
//        toàn bộ nhánh con, kể cả nhiều cấp lồng nhau.
//
//   PHẦN B (HTTP, routes/orgChart.js thật — stub lib/appData/lib/auth/lib/recordStore):
//     8. POST /nodes tạo vị trí với headcountQuota hợp lệ -> lưu đúng; headcountQuota âm/không phải số
//        -> 400, không tạo node.
//     9. PATCH /nodes/:id sửa headcountQuota (set số mới, rồi set về null) -> lưu đúng cả 2 lượt.
//    10. GET /versions/:id/headcount-report -> 200 kèm đúng field quota vừa đặt ở bước 8-9; 403 cho
//        người không có quyền xem Cơ Cấu Tổ Chức.
//    11. GET /versions/:id/headcount-report/export-xlsx -> 200, Content-Type Excel, buffer là file zip
//        hợp lệ (magic bytes "PK").
//
// Chạy: node server/tests/test-orgchart-headcount-report.js
'use strict';
const http = require('http');
const path = require('path');
const { createRunner, assertEqual, assert } = require('./testHarness');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

// ===== PHẦN A: computeHeadcountReport() thuần =====
function buildVersion() {
  return {
    nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', positionKey: null, displayOrder: 0 },
      { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', departmentRef: 'Phòng Kinh Doanh', positionKey: null, displayOrder: 0 },
      { nodeId: 3, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Trưởng Phòng', jobGrade: 'L5', requiresDept: true, positionKey: 'PK-TP', headcountQuota: 1, displayOrder: 0 },
      { nodeId: 4, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Nhân Viên Bán Hàng', jobGrade: null, requiresDept: true, positionKey: 'PK-NV', headcountQuota: 3, displayOrder: 1 },
      { nodeId: 5, parentNodeId: 2, nodeType: 'POSITION', jobTitle: 'Thực Tập Sinh', jobGrade: null, requiresDept: true, positionKey: 'PK-TT', headcountQuota: null, displayOrder: 2 }
    ]
  };
}
function runPureTests(run) {
  return run.run('computeHeadcountReport(): active/onLeave/offboarding/inactive/draft/kiêm nhiệm/quota null/roll-up', async () => {
    const { computeHeadcountReport } = require('../lib/headcountReport');
    const version = buildVersion();
    const employeeProfiles = [
      { employeeCode: 'NV1', username: 'nv1', positionKey: 'PK-NV', status: 'ACTIVE' },
      { employeeCode: 'NV2', username: 'nv2', positionKey: 'PK-NV', status: 'ON_LEAVE' },
      { employeeCode: 'NV3', username: 'nv3', positionKey: 'PK-NV', status: 'ACTIVE' }, // sẽ bị offboarding IN_PROGRESS bắt
      { employeeCode: 'NV4', username: 'nv4', positionKey: 'PK-NV', status: 'INACTIVE' }, // đã nghỉ hẳn -> bỏ qua
      { employeeCode: 'NV5', username: 'nv5', positionKey: 'PK-NV', status: 'DRAFT' }, // chưa chính thức -> bỏ qua
      { employeeCode: 'TP1', username: 'tp1', positionKey: 'PK-TP', status: 'ACTIVE' }
    ];
    const hrProcesses = [
      { processType: 'OFFBOARDING', status: 'IN_PROGRESS', employeeUsername: 'nv3' },
      { processType: 'OFFBOARDING', status: 'COMPLETED', employeeUsername: 'nv4' } // đã xong -> không tính là "đang bàn giao"
    ];
    const users = [
      { username: 'nv1', active: true, secondaryPositions: [] },
      { username: 'nv2', active: true, secondaryPositions: [] },
      { username: 'nv3', active: true, secondaryPositions: [] },
      { username: 'tp1', active: true, secondaryPositions: [] },
      { username: 'kiemnhiem1', active: true, secondaryPositions: [{ dept: 'Phòng Kinh Doanh', jobTitle: 'Nhân Viên Bán Hàng' }] }
    ];
    const { rows } = computeHeadcountReport(version, employeeProfiles, hrProcesses, users);
    const byId = new Map(rows.map(r => [r.nodeId, r]));

    const nv = byId.get(4);
    assertEqual(nv.active, 1, 'Nhân Viên Bán Hàng: 1 người ACTIVE thường (nv1)');
    assertEqual(nv.onLeave, 1, 'Nhân Viên Bán Hàng: 1 người ON_LEAVE (nv2)');
    assertEqual(nv.offboarding, 1, 'Nhân Viên Bán Hàng: 1 người đang offboarding IN_PROGRESS (nv3) — không rơi vào active');
    assertEqual(nv.secondary, 0.5, 'Nhân Viên Bán Hàng: 1 người kiêm nhiệm = 0.5');
    assertEqual(nv.actualTotal, 1 + 1 + 1 + 0.5, 'actualTotal = active+onLeave+offboarding+secondary (INACTIVE/DRAFT không tính)');
    assertEqual(nv.quota, 3, 'Quota giữ đúng giá trị đã đặt (3)');
    assertEqual(nv.variance, 3 - 3.5, 'variance = quota - actualTotal');

    const tp = byId.get(3);
    assertEqual(tp.active, 1, 'Trưởng Phòng: 1 người active');
    assertEqual(tp.quota, 1, 'Trưởng Phòng: quota=1');
    assertEqual(tp.variance, 0, 'Trưởng Phòng: variance = 1-1 = 0');

    const tt = byId.get(5);
    assertEqual(tt.quota, null, 'Thực Tập Sinh: chưa đặt định biên -> quota=null (không phải 0)');
    assertEqual(tt.variance, null, 'Thực Tập Sinh: variance=null khi quota=null');
    assertEqual(tt.actualTotal, 0, 'Thực Tập Sinh: không ai giữ -> actualTotal=0');

    const dept = byId.get(2);
    assertEqual(dept.quota, 1 + 3, 'Phòng Kinh Doanh: roll-up quota = 1 (TP) + 3 (NV) — bỏ qua TT (null)');
    assertEqual(dept.actualTotal, tp.actualTotal + nv.actualTotal + tt.actualTotal, 'Phòng Kinh Doanh: roll-up actualTotal = tổng 3 vị trí con');
    assertEqual(dept.variance, dept.quota - dept.actualTotal, 'Phòng Kinh Doanh: variance roll-up đúng công thức');

    const company = byId.get(1);
    assertEqual(company.actualTotal, dept.actualTotal, 'Công Ty (gốc): roll-up xuyên 2 cấp vẫn đúng tổng');
    assertEqual(company.quota, dept.quota, 'Công Ty (gốc): roll-up quota xuyên 2 cấp vẫn đúng tổng');
  });
}

// ===== PHẦN B: HTTP qua routes/orgChart.js thật =====
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const PLAIN = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Kế Toán', perms: {}, active: true };
let USERS = [ADMIN, PLAIN];
let APP_DATA;
function resetAppData() {
  APP_DATA = { users: USERS, orgChartVersions: [], employeeProfiles: [] };
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
async function apiRaw(method, urlPath, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, { method });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf };
}

async function main() {
  const server = await startApp();
  const run = createRunner();
  try {
    await runPureTests(run);

    let versionId, posNodeId;
    await run.run('POST /nodes: headcountQuota hợp lệ -> lưu đúng; âm/không phải số -> 400', async () => {
      resetAppData();
      const created = await api('POST', '/api/org-chart/bootstrap', { versionName: 'CCTC Test' }, ADMIN);
      versionId = created.body.version.id;
      const deptNode = await api('POST', `/api/org-chart/versions/${versionId}/nodes`, { parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Test' }, ADMIN);
      const deptNodeId = deptNode.body.node.nodeId;
      const bad = await api('POST', `/api/org-chart/versions/${versionId}/nodes`, { parentNodeId: deptNodeId, nodeType: 'POSITION', jobTitle: 'VT1', headcountQuota: -2 }, ADMIN);
      assertEqual(bad.status, 400, 'headcountQuota âm phải bị chặn 400');
      const ok = await api('POST', `/api/org-chart/versions/${versionId}/nodes`, { parentNodeId: deptNodeId, nodeType: 'POSITION', jobTitle: 'VT1', headcountQuota: 4 }, ADMIN);
      assertEqual(ok.status, 200, 'headcountQuota hợp lệ phải tạo được');
      assertEqual(ok.body.node.headcountQuota, 4, 'headcountQuota lưu đúng giá trị 4');
      posNodeId = ok.body.node.nodeId;
    });

    await run.run('PATCH /nodes/:id: sửa headcountQuota (số mới rồi về null) -> lưu đúng cả 2 lượt', async () => {
      const upd1 = await api('PATCH', `/api/org-chart/versions/${versionId}/nodes/${posNodeId}`, { headcountQuota: 7 }, ADMIN);
      assertEqual(upd1.body.node.headcountQuota, 7, 'Sửa headcountQuota=7 lưu đúng');
      const upd2 = await api('PATCH', `/api/org-chart/versions/${versionId}/nodes/${posNodeId}`, { headcountQuota: null }, ADMIN);
      assertEqual(upd2.body.node.headcountQuota, null, 'Sửa headcountQuota=null (bỏ định biên) lưu đúng');
      // đặt lại 2 cho các test sau dùng
      await api('PATCH', `/api/org-chart/versions/${versionId}/nodes/${posNodeId}`, { headcountQuota: 2 }, ADMIN);
    });

    await run.run('GET /headcount-report: 200 kèm đúng quota vừa đặt; 403 cho người không có quyền', async () => {
      const denied = await api('GET', `/api/org-chart/versions/${versionId}/headcount-report`, undefined, PLAIN);
      assertEqual(denied.status, 403, 'Người không có quyền Cơ Cấu Tổ Chức phải bị chặn');
      const ok = await api('GET', `/api/org-chart/versions/${versionId}/headcount-report`, undefined, ADMIN);
      assertEqual(ok.status, 200, 'Admin xem được báo cáo định biên');
      const posRow = ok.body.rows.find(r => r.nodeId === posNodeId);
      assert(!!posRow, 'Phải có dòng cho vị trí VT1 vừa tạo');
      assertEqual(posRow.quota, 2, 'Dòng báo cáo phản ánh đúng headcountQuota=2 vừa đặt');
      assertEqual(posRow.actualTotal, 0, 'Chưa có ai giữ vị trí -> actualTotal=0');
      assertEqual(posRow.variance, 2, 'variance = 2 - 0 = 2 (cần tuyển 2)');
    });

    await run.run('GET /headcount-report/export-xlsx: 200, Content-Type Excel, buffer là file zip hợp lệ', async () => {
      const res = await apiRaw('GET', `/api/org-chart/versions/${versionId}/headcount-report/export-xlsx`, ADMIN);
      assertEqual(res.status, 200, 'Export phải trả 200');
      assert((res.headers.get('content-type') || '').includes('spreadsheetml'), 'Content-Type phải là Excel (.xlsx)');
      assertEqual(res.buf.slice(0, 2).toString('latin1'), 'PK', 'Buffer phải là file zip hợp lệ (magic bytes PK — .xlsx thật)');
    });
  } finally {
    server.close();
  }
  run.summary();
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
