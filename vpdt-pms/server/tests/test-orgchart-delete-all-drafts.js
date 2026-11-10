// server/tests/test-orgchart-delete-all-drafts.js
//
// TÍNH NĂNG MỚI (11/2026, theo yêu cầu người dùng "xóa tất cả các cái định biên này đi và tôi làm lại từ
// đầu được không" — khi có nhiều bản Nháp rác tích lại, tránh phải bấm "Xoá Bản Nháp Này" từng bản):
//   - lib/orgChart.js::deleteAllDraftVersions() — lọc bỏ TẤT CẢ version có status DRAFT khỏi danh sách,
//     giữ nguyên APPLIED/ARCHIVED (nguyên tắc bất biến y hệt deleteVersion() đơn lẻ đã có).
//   - routes/orgChart.js: route mới POST /versions/delete-all-drafts — dùng CHUNG quyền orgChartManage
//     (y hệt /versions/:id/delete đơn lẻ), KHÔNG cần quyền riêng.
//
//   PHẦN A (gọi thẳng lib/orgChart.js::deleteAllDraftVersions(), không cần HTTP):
//     1. Danh sách có 2 DRAFT + 1 APPLIED + 1 ARCHIVED -> xoá đúng 2 DRAFT, giữ nguyên 2 bản còn lại.
//     2. Danh sách không có DRAFT nào -> deletedCount=0, list giữ nguyên hoàn toàn (không lỗi).
//     3. Danh sách toàn DRAFT -> xoá hết, trả về list rỗng.
//
//   PHẦN B (HTTP, routes/orgChart.js thật — stub lib/appData/lib/auth/lib/recordStore, cùng khuôn
//   test-orgchart-delete-draft-version.js / test-orgchart-delete-archived-version.js):
//     4. Người KHÔNG có orgChartManage -> 403, danh sách KHÔNG bị đụng.
//     5. Có orgChartManage, nhiều DRAFT + 1 APPLIED -> 200, deletedCount đúng, APPLIED còn nguyên trong
//        GET /versions sau đó.
//     6. Gọi khi KHÔNG có DRAFT nào (chỉ có APPLIED) -> vẫn 200, deletedCount=0, APPLIED không đổi.
//
// Chạy: node server/tests/test-orgchart-delete-all-drafts.js
'use strict';
const http = require('http');
const path = require('path');
const { createRunner, assertEqual, assert } = require('./testHarness');
const { deleteAllDraftVersions } = require('../lib/orgChart');

// ===== PHẦN A =====
function makeMixedList() {
  return [
    { id: 1, versionName: 'Nháp rác 1', status: 'DRAFT', nodes: [], kpiFlow: [] },
    { id: 2, versionName: 'Đang áp dụng', status: 'APPLIED', nodes: [], kpiFlow: [] },
    { id: 3, versionName: 'Nháp rác 2', status: 'DRAFT', nodes: [], kpiFlow: [] },
    { id: 4, versionName: 'Bản cũ lưu trữ', status: 'ARCHIVED', nodes: [], kpiFlow: [] }
  ];
}
async function runPureTests(run) {
  await run.run('1. Danh sách lẫn 2 DRAFT + 1 APPLIED + 1 ARCHIVED -> xoá đúng 2 DRAFT, giữ nguyên 2 bản còn lại', () => {
    const { list, deletedCount } = deleteAllDraftVersions(makeMixedList());
    assertEqual(deletedCount, 2);
    assertEqual(list.length, 2);
    assert(!list.some(v => v.status === 'DRAFT'), 'Không còn bản DRAFT nào');
    assertEqual(list.find(v => v.id === 2).status, 'APPLIED', 'Bản APPLIED giữ nguyên');
    assertEqual(list.find(v => v.id === 4).status, 'ARCHIVED', 'Bản ARCHIVED giữ nguyên');
  });

  await run.run('2. Không có DRAFT nào -> deletedCount=0, list giữ nguyên hoàn toàn', () => {
    const noDraft = makeMixedList().filter(v => v.status !== 'DRAFT');
    const { list, deletedCount } = deleteAllDraftVersions(noDraft);
    assertEqual(deletedCount, 0);
    assertEqual(list.length, noDraft.length);
  });

  await run.run('3. Toàn bộ danh sách là DRAFT -> xoá hết, trả về list rỗng', () => {
    const allDraft = [
      { id: 1, versionName: 'Nháp 1', status: 'DRAFT', nodes: [], kpiFlow: [] },
      { id: 2, versionName: 'Nháp 2', status: 'DRAFT', nodes: [], kpiFlow: [] }
    ];
    const { list, deletedCount } = deleteAllDraftVersions(allDraft);
    assertEqual(deletedCount, 2);
    assertEqual(list.length, 0);
  });

  await run.run('deleteAllDraftVersions(null/undefined) -> không crash, trả về rỗng', () => {
    const { list, deletedCount } = deleteAllDraftVersions(null);
    assertEqual(deletedCount, 0);
    assertEqual(list.length, 0);
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

const MANAGER = { username: 'ocmanager', name: 'Quản Lý Cây', dept: 'Nhân Sự', perms: { orgChartManage: true }, active: true };
const NO_PERM = { username: 'ocnoperm', name: 'Không Có Quyền', dept: 'Nhân Sự', perms: {}, active: true };
let USERS = [MANAGER, NO_PERM];
let APP_DATA;
function resetAppData(versions) {
  APP_DATA = { users: USERS, orgChartVersions: versions, employeeProfiles: [] };
}
let PORT = 0;
let CURRENT_USERNAME = MANAGER.username;

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

    await run.run('4. Người KHÔNG có orgChartManage -> 403, danh sách KHÔNG bị đụng', async () => {
      resetAppData(makeMixedList());
      const res = await api('POST', '/api/org-chart/versions/delete-all-drafts', {}, NO_PERM);
      assertEqual(res.status, 403);
      assertEqual(APP_DATA.orgChartVersions.length, 4, 'Danh sách KHÔNG bị xoá gì');
    });

    await run.run('5. Có orgChartManage, nhiều DRAFT + 1 APPLIED -> 200, deletedCount đúng, APPLIED còn nguyên', async () => {
      resetAppData(makeMixedList());
      const res = await api('POST', '/api/org-chart/versions/delete-all-drafts', {}, MANAGER);
      assertEqual(res.status, 200);
      assertEqual(res.body.deletedCount, 2);
      assertEqual(APP_DATA.orgChartVersions.length, 2);
      assert(APP_DATA.orgChartVersions.some(v => v.id === 2 && v.status === 'APPLIED'), 'APPLIED còn nguyên trong dữ liệu thật');
      assert(APP_DATA.orgChartVersions.some(v => v.id === 4 && v.status === 'ARCHIVED'), 'ARCHIVED còn nguyên trong dữ liệu thật');
    });

    await run.run('6. Gọi khi KHÔNG có DRAFT nào -> vẫn 200, deletedCount=0, không đổi gì', async () => {
      const onlyApplied = [{ id: 2, versionName: 'Đang áp dụng', status: 'APPLIED', nodes: [], kpiFlow: [] }];
      resetAppData(onlyApplied);
      const res = await api('POST', '/api/org-chart/versions/delete-all-drafts', {}, MANAGER);
      assertEqual(res.status, 200);
      assertEqual(res.body.deletedCount, 0);
      assertEqual(APP_DATA.orgChartVersions.length, 1);
    });
  } finally {
    server.close();
  }
  run.summary();
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
