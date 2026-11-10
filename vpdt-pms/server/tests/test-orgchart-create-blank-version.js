// server/tests/test-orgchart-create-blank-version.js
//
// TÍNH NĂNG MỚI (11/2026, theo yêu cầu người dùng: "Mình muốn tạo thêm một bản, không phải bản nháp mà
// bản mới đi... Hiện tại hạn chế là chỉ tạo được bản nháp, tức là lấy nguyên cái bản... thêm một tính
// năng tạo bản mới mà sạch luôn để mình có thể làm lại đầu"):
//   - lib/orgChart.js::createBlankVersion() — tạo 1 bản Nháp HOÀN TOÀN TRỐNG (chỉ gốc "Công Ty"), GIỐNG
//     bootstrapFirstVersion() nhưng KHÔNG bị chặn khi đã có version khác (bootstrapFirstVersion() CHỈ
//     dùng đúng 1 lần lúc chưa có version nào).
//   - routes/orgChart.js: route mới POST /api/org-chart/versions/blank — dùng CHUNG quyền orgChartManage
//     (y hệt /versions/:id/clone), KHÔNG cần quyền riêng.
//
//   PHẦN A (gọi thẳng lib/orgChart.js::createBlankVersion(), không cần HTTP):
//     1. list rỗng -> vẫn tạo được bình thường (id=1, DRAFT, đúng 1 node gốc "Công Ty").
//     2. list ĐÃ có nhiều version (APPLIED+DRAFT+ARCHIVED) -> vẫn tạo được (KHÁC bootstrapFirstVersion()
//        sẽ throw trong trường hợp này), id tiếp theo đúng, KHÔNG đụng/sửa bất kỳ version nào khác.
//     3. Không truyền versionName -> dùng tên mặc định.
//     4. Gọi 2 lần liên tiếp -> 2 bản độc lập, id khác nhau, mỗi bản đều có đúng 1 node gốc riêng (không
//        chia sẻ tham chiếu mảng nodes).
//
//   PHẦN B (HTTP, routes/orgChart.js thật — stub lib/appData/lib/auth/lib/recordStore, cùng khuôn
//   test-orgchart-delete-all-drafts.js):
//     5. Người KHÔNG có orgChartManage -> 403, danh sách KHÔNG bị đụng (không có bản nào được thêm).
//     6. Có orgChartManage, đã có APPLIED + 2 DRAFT cũ -> 200, version trả về đúng {status DRAFT, đúng 1
//        node Công Ty}, danh sách tăng từ 3 lên 4, 3 bản cũ (APPLIED + 2 DRAFT) giữ NGUYÊN VẸN cây của nó.
//     7. Gọi khi list RỖNG (khác /bootstrap — route đó cũng cho tạo được khi rỗng, nhưng /blank không hề
//        kiểm tra điều kiện "rỗng hay không") -> vẫn 200, tạo thành công.
//
// Chạy: node server/tests/test-orgchart-create-blank-version.js
'use strict';
const http = require('http');
const path = require('path');
const { createRunner, assertEqual, assert } = require('./testHarness');
const { createBlankVersion } = require('../lib/orgChart');

// ===== PHẦN A =====
function makeMixedList() {
  return [
    { id: 1, versionName: 'Đang áp dụng', status: 'APPLIED', nodes: [{ nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty' }, { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Nhân Sự' }], kpiFlow: [] },
    { id: 2, versionName: 'Nháp rác 1', status: 'DRAFT', nodes: [], kpiFlow: [] },
    { id: 3, versionName: 'Bản cũ lưu trữ', status: 'ARCHIVED', nodes: [], kpiFlow: [] }
  ];
}
async function runPureTests(run) {
  await run.run('1. list rỗng -> vẫn tạo được bình thường (id=1, DRAFT, đúng 1 node gốc Công Ty)', () => {
    const v = createBlankVersion([], 'Bản đầu tiên', 'admin');
    assertEqual(v.id, 1);
    assertEqual(v.status, 'DRAFT');
    assertEqual(v.versionName, 'Bản đầu tiên');
    assertEqual(v.nodes.length, 1);
    assertEqual(v.nodes[0].nodeType, 'COMPANY');
    assertEqual(v.nodes[0].nodeName, 'Công Ty');
    assertEqual(v.nodes[0].parentNodeId, null);
    assertEqual(v.kpiFlow.length, 0);
    assertEqual(v.clonedFromVersionId, null, 'KHÔNG kế thừa từ bất kỳ version nào (khác cloneVersion())');
  });

  await run.run('2. list ĐÃ có nhiều version (APPLIED+DRAFT+ARCHIVED) -> vẫn tạo được, KHÔNG đụng bản nào khác', () => {
    const list = makeMixedList();
    const originalApplied = JSON.parse(JSON.stringify(list[0]));
    const v = createBlankVersion(list, 'Làm lại từ đầu', 'admin');
    assertEqual(v.id, 4, 'id tiếp theo đúng (nextIdFor)');
    assertEqual(v.status, 'DRAFT');
    assertEqual(v.nodes.length, 1, 'Bản mới CHỈ có đúng 1 node gốc, KHÔNG sao chép cây của bản APPLIED');
    assertEqual(JSON.stringify(list[0]), JSON.stringify(originalApplied), 'Bản APPLIED không hề bị đụng tới');
    assertEqual(list.length, 3, 'createBlankVersion() KHÔNG tự thêm vào list truyền vào (route mới nối list)');
  });

  await run.run('3. Không truyền versionName -> dùng tên mặc định', () => {
    const v = createBlankVersion([], undefined, 'admin');
    assertEqual(v.versionName, 'Cơ cấu tổ chức (bản mới)');
  });

  await run.run('4. Gọi 2 lần liên tiếp -> 2 bản độc lập, nodes KHÔNG chia sẻ tham chiếu', () => {
    const list = [];
    const v1 = createBlankVersion(list, 'Bản 1', 'admin');
    list.push(v1);
    const v2 = createBlankVersion(list, 'Bản 2', 'admin');
    assertEqual(v2.id, 2);
    assert(v1.nodes !== v2.nodes, 'Mảng nodes phải là 2 mảng riêng biệt, không dùng chung tham chiếu');
    v2.nodes[0].nodeName = 'Đã đổi tên';
    assertEqual(v1.nodes[0].nodeName, 'Công Ty', 'Sửa bản 2 không ảnh hưởng bản 1');
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

    await run.run('5. Người KHÔNG có orgChartManage -> 403, danh sách KHÔNG bị đụng', async () => {
      resetAppData(makeMixedList());
      const res = await api('POST', '/api/org-chart/versions/blank', { versionName: 'Hack thử' }, NO_PERM);
      assertEqual(res.status, 403);
      assertEqual(APP_DATA.orgChartVersions.length, 3, 'Danh sách KHÔNG có bản nào được thêm');
    });

    await run.run('6. Có orgChartManage, đã có APPLIED + 1 DRAFT + 1 ARCHIVED -> 200, bản mới đúng 1 node Công Ty, các bản cũ giữ nguyên vẹn', async () => {
      resetAppData(makeMixedList());
      const originalApplied = JSON.parse(JSON.stringify(APP_DATA.orgChartVersions[0]));
      const originalDraft = JSON.parse(JSON.stringify(APP_DATA.orgChartVersions[1]));
      const res = await api('POST', '/api/org-chart/versions/blank', { versionName: 'Làm lại từ đầu' }, MANAGER);
      assertEqual(res.status, 200);
      assertEqual(res.body.version.status, 'DRAFT');
      assertEqual(res.body.version.versionName, 'Làm lại từ đầu');
      assertEqual(res.body.version.nodes.length, 1, 'Bản mới CHỈ có 1 node gốc Công Ty');
      assertEqual(res.body.version.nodes[0].nodeName, 'Công Ty');
      assertEqual(APP_DATA.orgChartVersions.length, 4, 'Danh sách tăng từ 3 lên 4');
      const stillApplied = APP_DATA.orgChartVersions.find(v => v.id === 1);
      const stillDraft = APP_DATA.orgChartVersions.find(v => v.id === 2);
      assertEqual(JSON.stringify(stillApplied), JSON.stringify(originalApplied), 'Bản APPLIED giữ nguyên vẹn, không bị đụng tới');
      assertEqual(JSON.stringify(stillDraft), JSON.stringify(originalDraft), 'Bản DRAFT cũ giữ nguyên vẹn, không bị đụng tới');
    });

    await run.run('7. Gọi khi danh sách RỖNG -> vẫn 200, tạo thành công (khác /bootstrap, route /blank không kiểm tra điều kiện rỗng)', async () => {
      resetAppData([]);
      const res = await api('POST', '/api/org-chart/versions/blank', { versionName: 'Bản đầu tiên' }, MANAGER);
      assertEqual(res.status, 200);
      assertEqual(res.body.version.id, 1);
      assertEqual(APP_DATA.orgChartVersions.length, 1);
    });
  } finally {
    server.close();
  }
  run.summary();
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
