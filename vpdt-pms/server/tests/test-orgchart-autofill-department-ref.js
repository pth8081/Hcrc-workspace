// server/tests/test-orgchart-autofill-department-ref.js
//
// Regression test cho planAutoFillDepartmentRef()/autoFillDepartmentRef() (lib/orgChart.js) +
// POST /api/org-chart/versions/:id/autofill-department-ref (routes/orgChart.js) — 11/2026, ca thật
// người dùng báo: Nhập Excel Gán Chức Vụ xem trước báo "sẵn sàng gán" hàng loạt (khớp được theo
// nodeName, bản vá trước) nhưng Áp Dụng lại fail HÀNG LOẠT vì node Phòng Ban/Siêu Thị cha chưa gắn
// departmentRef thật — đa số node chỉ có nodeName tự do, chưa từng chọn departmentRef qua dropdown
// riêng. Thêm 1 nút "Tự Động Gắn departmentRef" cho bản DRAFT: tự gắn departmentRef = ĐÚNG tên trong
// Danh Mục Phòng Ban/Siêu Thị khi nodeName khớp đúng 1 tên thật — AN TOÀN vì không bao giờ ghi tên tự
// do/rác vào departmentRef.
//
//   PHẦN A: planAutoFillDepartmentRef()/autoFillDepartmentRef() thuần (gọi thẳng lib/orgChart.js).
//   PHẦN B: HTTP thật — POST /api/org-chart/versions/:id/autofill-department-ref (quyền, DRAFT-only,
//           persist đúng, không ghi đè departmentRef đã có sẵn).
//
// Chạy: node server/tests/test-orgchart-autofill-department-ref.js
'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

// ===================== Phần A: lib/orgChart.js (thuần) =====================
async function partA() {
  console.log('\n== Phần A: lib/orgChart.js (thuần) ==');
  const orgChart = require('../lib/orgChart');
  const CATALOG = ['Cửa hàng 5 Hàm Tử Quan', 'Siêu thị số 275 Nguyễn Trãi', 'Phòng Kinh Doanh'];

  function buildVersion(status) {
    return {
      id: 1, status,
      nodes: [
        { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', departmentRef: null },
        { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Cửa hàng 5 Hàm Tử Quan', departmentRef: null },
        { nodeId: 3, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: '  siêu   thị Số 275 nguyễn trãi  ', departmentRef: null },
        { nodeId: 4, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Không Tồn Tại Trong Danh Mục', departmentRef: null },
        { nodeId: 5, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Phòng Kinh Doanh', departmentRef: 'Phòng Kinh Doanh (đã gắn từ trước)' },
        { nodeId: 6, parentNodeId: 1, nodeType: 'POSITION', jobTitle: 'Trưởng quầy', requiresDept: true, positionKey: 'POS1' }
      ]
    };
  }

  await test('planAutoFillDepartmentRef(): khớp ĐÚNG tên trong danh mục -> đưa vào toUpdate', () => {
    const plan = orgChart.planAutoFillDepartmentRef(buildVersion('DRAFT'), CATALOG);
    const n2 = plan.toUpdate.find(u => u.nodeId === 2);
    assert.ok(n2 && n2.matchedCatalogValue === 'Cửa hàng 5 Hàm Tử Quan');
  });

  await test('planAutoFillDepartmentRef(): khớp dù khác Unicode/khoảng trắng/hoa-thường (normalizeMatchText)', () => {
    const plan = orgChart.planAutoFillDepartmentRef(buildVersion('DRAFT'), CATALOG);
    const n3 = plan.toUpdate.find(u => u.nodeId === 3);
    assert.ok(n3 && n3.matchedCatalogValue === 'Siêu thị số 275 Nguyễn Trãi', 'phải trả ĐÚNG giá trị catalog (không phải nodeName gốc lệch chuẩn)');
  });

  await test('planAutoFillDepartmentRef(): nodeName KHÔNG khớp tên nào trong danh mục -> vào needsManualReview, KHÔNG đoán bừa', () => {
    const plan = orgChart.planAutoFillDepartmentRef(buildVersion('DRAFT'), CATALOG);
    assert.ok(plan.needsManualReview.some(r => r.nodeId === 4));
    assert.ok(!plan.toUpdate.some(u => u.nodeId === 4));
  });

  await test('planAutoFillDepartmentRef(): node ĐÃ CÓ departmentRef -> bỏ qua hoàn toàn, KHÔNG ghi đè', () => {
    const plan = orgChart.planAutoFillDepartmentRef(buildVersion('DRAFT'), CATALOG);
    assert.ok(!plan.toUpdate.some(u => u.nodeId === 5), 'node đã có departmentRef không được đưa vào toUpdate');
    assert.ok(!plan.needsManualReview.some(r => r.nodeId === 5), 'cũng không được báo "cần gắn tay" vì đã có rồi');
  });

  await test('planAutoFillDepartmentRef(): KHÔNG đụng tới node POSITION', () => {
    const plan = orgChart.planAutoFillDepartmentRef(buildVersion('DRAFT'), CATALOG);
    assert.ok(!plan.toUpdate.some(u => u.nodeId === 6) && !plan.needsManualReview.some(r => r.nodeId === 6));
  });

  await test('autoFillDepartmentRef(): mutate ĐÚNG departmentRef cho node khớp, giữ nguyên node khác', () => {
    const version = buildVersion('DRAFT');
    const plan = orgChart.autoFillDepartmentRef(version, CATALOG);
    assert.strictEqual(version.nodes.find(n => n.nodeId === 2).departmentRef, 'Cửa hàng 5 Hàm Tử Quan');
    assert.strictEqual(version.nodes.find(n => n.nodeId === 3).departmentRef, 'Siêu thị số 275 Nguyễn Trãi');
    assert.strictEqual(version.nodes.find(n => n.nodeId === 4).departmentRef, null, 'không khớp thì giữ null, không đoán bừa');
    assert.strictEqual(version.nodes.find(n => n.nodeId === 5).departmentRef, 'Phòng Kinh Doanh (đã gắn từ trước)', 'không được ghi đè departmentRef đã có sẵn');
    assert.strictEqual(plan.toUpdate.length, 2);
  });

  await test('autoFillDepartmentRef(): bản KHÔNG PHẢI DRAFT (APPLIED/ARCHIVED) -> throw 400, không mutate gì (cùng ràng buộc requireDraft() như editNode())', () => {
    const version = buildVersion('APPLIED');
    let threw = false;
    try { orgChart.autoFillDepartmentRef(version, CATALOG); } catch (err) { threw = true; assert.strictEqual(err.status, 400); }
    assert.ok(threw, 'phải throw khi version không phải DRAFT');
    assert.strictEqual(version.nodes.find(n => n.nodeId === 2).departmentRef, null, 'không được mutate gì khi bị chặn');
  });
}

// ===================== Phần B: HTTP thật (Express + routes/orgChart.js) =====================
async function partB() {
  console.log('\n== Phần B: HTTP thật — POST /api/org-chart/versions/:id/autofill-department-ref ==');

  const ORGCHART_MGR = { username: 'orgchart1', name: 'Quản Lý Cơ Cấu', dept: 'Phòng Nhân Sự', perms: { orgChartManage: true }, active: true };
  const PLAIN = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Kế Toán', perms: {}, active: true };
  const USERS = [ORGCHART_MGR, PLAIN];

  let APP_DATA;
  function resetAppData() {
    APP_DATA = {
      users: USERS,
      depts: ['Phòng Kinh Doanh'],
      stores: ['Cửa hàng 5 Hàm Tử Quan'],
      orgChartVersions: [{
        id: 1, status: 'DRAFT',
        nodes: [
          { nodeId: 1, parentNodeId: null, nodeType: 'COMPANY', nodeName: 'Công Ty', departmentRef: null },
          { nodeId: 2, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Cửa hàng 5 Hàm Tử Quan', departmentRef: null },
          { nodeId: 3, parentNodeId: 1, nodeType: 'DEPARTMENT', nodeName: 'Chưa Có Trong Danh Mục', departmentRef: null }
        ]
      }]
    };
  }
  resetAppData();

  let PORT = 0;
  let CURRENT_USERNAME = ORGCHART_MGR.username;

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
  stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

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
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let payload = null;
    try { payload = await res.json(); } catch (e) { payload = null; }
    return { status: res.status, body: payload };
  }

  const server = await startApp();
  try {
    await test('Không có quyền orgChartManage -> 403, không mutate gì', async () => {
      resetAppData();
      const res = await api('POST', '/api/org-chart/versions/1/autofill-department-ref', {}, PLAIN);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(APP_DATA.orgChartVersions[0].nodes.find(n => n.nodeId === 2).departmentRef, null);
    });

    await test('orgChartManage -> 200, gắn ĐÚNG departmentRef cho node khớp danh mục, trả đúng toUpdate/needsManualReview, PERSIST vào AppData', async () => {
      resetAppData();
      const res = await api('POST', '/api/org-chart/versions/1/autofill-department-ref', {}, ORGCHART_MGR);
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.toUpdate.length, 1);
      assert.strictEqual(res.body.toUpdate[0].matchedCatalogValue, 'Cửa hàng 5 Hàm Tử Quan');
      assert.strictEqual(res.body.needsManualReview.length, 1);
      assert.strictEqual(res.body.needsManualReview[0].nodeId, 3);
      // Persist thật vào AppData — không chỉ trả response đúng mà KHÔNG lưu.
      assert.strictEqual(APP_DATA.orgChartVersions[0].nodes.find(n => n.nodeId === 2).departmentRef, 'Cửa hàng 5 Hàm Tử Quan');
      assert.strictEqual(APP_DATA.orgChartVersions[0].nodes.find(n => n.nodeId === 3).departmentRef, null);
    });

    await test('Version KHÔNG phải DRAFT (APPLIED) -> 400, không mutate', async () => {
      resetAppData();
      APP_DATA.orgChartVersions[0].status = 'APPLIED';
      const res = await api('POST', '/api/org-chart/versions/1/autofill-department-ref', {}, ORGCHART_MGR);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(APP_DATA.orgChartVersions[0].nodes.find(n => n.nodeId === 2).departmentRef, null);
    });

    await test('Version không tồn tại -> 404', async () => {
      resetAppData();
      const res = await api('POST', '/api/org-chart/versions/999/autofill-department-ref', {}, ORGCHART_MGR);
      assert.strictEqual(res.status, 404);
    });
  } finally {
    server.close();
  }
}

(async () => {
  await partA();
  await partB();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
