// server/tests/test-orgchart-delete-archived-version.js
//
// TÍNH NĂNG MỚI (10/2026, theo yêu cầu người dùng "lỡ Áp Dụng nhầm 1 bản Cơ Cấu Tổ Chức không mong
// muốn, muốn xoá hẳn bản Lưu Trữ (ARCHIVED) thừa đi tránh rác dữ liệu, cho quyền riêng/khẩn"):
//   - lib/orgChart.js::deleteArchivedVersion() — CHỈ xoá được ARCHIVED, không đụng DRAFT (đã có
//     deleteVersion() riêng) hay APPLIED (phải chuyển ARCHIVED trước — tức có bản khác thay thế rồi).
//   - routes/orgChart.js: quyền RIÊNG orgChartDeleteArchived (KHÔNG dùng chung orgChartManage) +
//     route POST /versions/:id/delete-archived, bắt body.confirmVersionName khớp ĐÚNG tên version (lớp
//     xác nhận thứ 2 ở server, không tin tưởng tuyệt đối client đã hỏi lại tên).
//
//   PHẦN A (gọi thẳng lib/orgChart.js::deleteArchivedVersion() qua require(), không cần HTTP):
//     1. Xoá bản ARCHIVED -> thành công, bị loại khỏi danh sách, các bản khác giữ nguyên.
//     2. Xoá bản DRAFT -> 400 (phải dùng deleteVersion() riêng).
//     3. Xoá bản APPLIED -> 400 (phải chuyển ARCHIVED trước).
//     4. Xoá version không tồn tại -> 404.
//
//   PHẦN B (HTTP, routes/orgChart.js thật — stub lib/appData/lib/auth/lib/recordStore):
//     5. Người KHÔNG có quyền orgChartDeleteArchived (kể cả có orgChartManage) -> 403.
//     6. Có quyền nhưng gõ sai tên xác nhận (confirmVersionName không khớp) -> 400, KHÔNG xoá.
//     7. Có quyền + gõ đúng tên -> 200, version biến mất khỏi GET /versions.
//     8. Có quyền nhưng gọi trên bản đang APPLIED -> 400, không xoá được (chặn ở lib, không phải chỉ ở
//        quyền) — đúng tinh thần "không bao giờ xoá được bản đang dùng".
//
// Chạy: node server/tests/test-orgchart-delete-archived-version.js
'use strict';
const http = require('http');
const path = require('path');
const { createRunner, assertEqual, assert } = require('./testHarness');
const { deleteArchivedVersion } = require('../lib/orgChart');

// ===== PHẦN A =====
function makeList() {
  return [
    { id: 1, versionName: 'Bản áp dụng nhầm', status: 'ARCHIVED', nodes: [], kpiFlow: [] },
    { id: 2, versionName: 'Đang áp dụng đúng', status: 'APPLIED', nodes: [], kpiFlow: [] },
    { id: 3, versionName: 'Nháp đang sửa', status: 'DRAFT', nodes: [], kpiFlow: [] }
  ];
}
async function runPureTests(run) {
  await run.run('Xoá bản ARCHIVED -> thành công, bị loại khỏi danh sách, các bản khác giữ nguyên', () => {
    const list = makeList();
    const result = deleteArchivedVersion(list, 1);
    assertEqual(result.length, 2);
    assert(!result.some(v => v.id === 1), 'Bản 1 phải bị loại khỏi danh sách');
    assertEqual(result.find(v => v.id === 2).status, 'APPLIED', 'Bản APPLIED giữ nguyên');
    assertEqual(result.find(v => v.id === 3).status, 'DRAFT', 'Bản DRAFT giữ nguyên');
  });
  await run.run('Xoá bản DRAFT bằng deleteArchivedVersion() -> 400 (phải dùng deleteVersion() riêng)', () => {
    const list = makeList();
    let threw = false;
    try { deleteArchivedVersion(list, 3); } catch (err) { threw = true; assert(/400|Lưu Trữ/.test(err.message), `message đúng: ${err.message}`); }
    assert(threw, 'Phải ném lỗi khi xoá DRAFT qua deleteArchivedVersion()');
  });
  await run.run('Xoá bản APPLIED -> 400 (phải chuyển ARCHIVED trước — có bản khác thay thế)', () => {
    const list = makeList();
    let threw = false;
    try { deleteArchivedVersion(list, 2); } catch (err) { threw = true; assert(/400|Lưu Trữ/.test(err.message), `message đúng: ${err.message}`); }
    assert(threw, 'Phải ném lỗi khi xoá APPLIED qua deleteArchivedVersion()');
  });
  await run.run('Xoá version không tồn tại -> 404', () => {
    const list = makeList();
    let threw = false;
    try { deleteArchivedVersion(list, 999); } catch (err) { threw = true; assert(/404|Không tìm thấy/.test(err.message), `message đúng: ${err.message}`); }
    assert(threw, 'Phải ném lỗi khi xoá version không tồn tại');
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
const DELETER = { username: 'ocdeleter', name: 'Được Xoá Lưu Trữ', dept: 'Nhân Sự', perms: { orgChartManage: true, orgChartDeleteArchived: true }, active: true };
let USERS = [MANAGER_ONLY, DELETER];
let APP_DATA;
function resetAppData(versions) {
  APP_DATA = { users: USERS, orgChartVersions: versions, employeeProfiles: [] };
}
let PORT = 0;
let CURRENT_USERNAME = DELETER.username;

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

    await run.run('Người có orgChartManage nhưng KHÔNG có orgChartDeleteArchived -> 403', async () => {
      resetAppData([{ id: 1, versionName: 'Bản áp dụng nhầm', status: 'ARCHIVED', nodes: [], kpiFlow: [] }]);
      const res = await api('POST', '/api/org-chart/versions/1/delete-archived', { confirmVersionName: 'Bản áp dụng nhầm' }, MANAGER_ONLY);
      assertEqual(res.status, 403, 'Chỉ orgChartManage KHÔNG đủ quyền xoá vĩnh viễn bản Lưu Trữ');
      assertEqual(APP_DATA.orgChartVersions.length, 1, 'Version KHÔNG bị xoá');
    });

    await run.run('Có quyền nhưng gõ sai tên xác nhận -> 400, KHÔNG xoá', async () => {
      resetAppData([{ id: 1, versionName: 'Bản áp dụng nhầm', status: 'ARCHIVED', nodes: [], kpiFlow: [] }]);
      const res = await api('POST', '/api/org-chart/versions/1/delete-archived', { confirmVersionName: 'Tên gõ sai' }, DELETER);
      assertEqual(res.status, 400, 'Tên xác nhận không khớp phải bị chặn 400');
      assertEqual(APP_DATA.orgChartVersions.length, 1, 'Version KHÔNG bị xoá khi xác nhận sai');
    });

    await run.run('Có quyền + gõ đúng tên -> 200, version biến mất khỏi danh sách', async () => {
      resetAppData([{ id: 1, versionName: 'Bản áp dụng nhầm', status: 'ARCHIVED', nodes: [], kpiFlow: [] }]);
      const res = await api('POST', '/api/org-chart/versions/1/delete-archived', { confirmVersionName: 'Bản áp dụng nhầm' }, DELETER);
      assertEqual(res.status, 200, 'Xoá thành công phải trả 200');
      assertEqual(APP_DATA.orgChartVersions.length, 0, 'Version phải biến mất khỏi danh sách sau khi xoá');
    });

    await run.run('Có quyền nhưng version đang APPLIED -> 400, không xoá được', async () => {
      resetAppData([{ id: 2, versionName: 'Đang áp dụng đúng', status: 'APPLIED', nodes: [], kpiFlow: [] }]);
      const res = await api('POST', '/api/org-chart/versions/2/delete-archived', { confirmVersionName: 'Đang áp dụng đúng' }, DELETER);
      assertEqual(res.status, 400, 'Không bao giờ xoá được bản đang APPLIED, dù có đủ quyền và gõ đúng tên');
      assertEqual(APP_DATA.orgChartVersions.length, 1, 'Version APPLIED vẫn còn nguyên');
    });
  } finally {
    server.close();
  }
  run.summary();
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
