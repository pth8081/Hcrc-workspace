// server/tests/test-docs-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau Bước 8k: docs tách riêng khỏi vòng lặp tải
// chung qua loadDocsScoped(). canViewDoc() (lib/recordViewScope.js) 4 nhánh — (1) admin xem HẾT, (2)
// chính người TẢI LÊN (uploader, mọi phòng ban/trạng thái), (3) viewApprovedAll/viewApprovedDepts (chỉ
// hồ sơ APPROVED) HOẶC viewDraftAll/viewDraftDepts (hồ sơ KHÁC APPROVED), (4) đang là người duyệt theo
// deptWorkflows[dept] (BẤT KỲ bước nào, KHÔNG phân biệt trạng thái hồ sơ).
//
// Chạy: node server/tests/test-docs-scope.js
'use strict';
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

const REGULAR_A = { username: 'nva', name: 'Nhân Viên A', dept: 'Phòng A', perms: {}, active: true };
const VIEW_APPROVED_B = { username: 'xemduyet', name: 'Xem Đã Duyệt Phòng B', dept: 'Phòng X', perms: { viewApprovedDepts: ['Phòng B'] }, active: true };
const VIEW_DRAFT_C = { username: 'xemnhap', name: 'Xem Nháp Phòng C', dept: 'Phòng X', perms: { viewDraftDepts: ['Phòng C'] }, active: true };
const APPROVER_D = { username: 'duyet_doc', name: 'Người Duyệt Phòng D', dept: 'Phòng X', perms: {}, active: true };
const VIEW_ALL = { username: 'xemhet', name: 'Xem Toàn Bộ', dept: 'Phòng X', perms: { viewDraftAll: true }, active: true };
const VIEW_TRUE_ALL = { username: 'xemhethet', name: 'Xem Trọn Vẹn', dept: 'Phòng X', perms: { viewDraftAll: true, viewApprovedAll: true }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const USERS = [REGULAR_A, VIEW_APPROVED_B, VIEW_DRAFT_C, APPROVER_D, VIEW_ALL, VIEW_TRUE_ALL, ADMIN];

const APP_DATA = {
  deptWorkflows: {
    'Phòng D': { approvers: { 1: ['duyet_doc'] } }
  }
};

let ALL_DOCS;
function resetData() {
  ALL_DOCS = [
    { id: 1, dept: 'Phòng A', status: 'PENDING', uploader: 'nva' },
    { id: 2, dept: 'Phòng B', status: 'APPROVED', uploader: 'other1' },
    { id: 3, dept: 'Phòng B', status: 'PENDING', uploader: 'other2' },
    { id: 4, dept: 'Phòng C', status: 'PENDING', uploader: 'other3' },
    { id: 5, dept: 'Phòng C', status: 'APPROVED', uploader: 'other4' },
    { id: 6, dept: 'Phòng D', status: 'APPROVED', uploader: 'other5' },
    { id: 7, dept: 'Phòng D', status: 'PENDING', uploader: 'other6' },
    { id: 8, dept: 'Phòng Z', status: 'REJECTED', uploader: 'nva' }
  ];
}
resetData();

let fullLoadCallCount = 0;
let byDeptCalls = [];

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} }),
  getAppDataValue: async (key) => APP_DATA[key] || null
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['docs']),
  getAllForCollectionCached: async (collection) => {
    if (collection !== 'docs') return [];
    fullLoadCallCount++;
    return ALL_DOCS.map(r => ({ ...r }));
  },
  getForCollectionByDeptCached: async (collection, dept) => {
    if (collection !== 'docs') return [];
    byDeptCalls.push(dept);
    return ALL_DOCS.filter(r => r.dept === dept).map(r => ({ ...r }));
  },
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async (collection, column, value) => {
    if (collection !== 'docs') return [];
    if (column === 'Uploader') return ALL_DOCS.filter(r => r.uploader === value).map(r => ({ ...r }));
    return [];
  }
});

let CURRENT_USERNAME = REGULAR_A.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p,
  isBcryptHash: () => false,
  validatePin: () => true
});

const express = require('express');
const { createRunner, assertEqual, assert } = require('./testHarness');
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
    await run.run('Nhân viên thường (không quyền xem gì đặc biệt): chỉ thấy tài liệu CHÍNH MÌNH đã tải lên, mọi phòng ban/trạng thái', async () => {
      resetData(); fullLoadCallCount = 0; byDeptCalls = [];
      const res = await api('GET', '/api/data', undefined, REGULAR_A);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,8', 'nva phải thấy id1 (Phòng A) + id8 (Phòng Z) — cả 2 đều tự tải lên, KHÔNG thấy hồ sơ người khác');
      assertEqual(fullLoadCallCount, 0, 'người thường KHÔNG được tải toàn bộ company-wide');
    });

    await run.run('viewApprovedDepts=["Phòng B"]: CHỈ thấy tài liệu ĐÃ DUYỆT của Phòng B, không thấy bản PENDING cùng phòng', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, VIEW_APPROVED_B);
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '2', 'chỉ thấy id2 (APPROVED, Phòng B) — id3 (PENDING, Phòng B) phải bị loại');
    });

    await run.run('viewDraftDepts=["Phòng C"]: CHỈ thấy tài liệu CHƯA duyệt của Phòng C, không thấy bản APPROVED cùng phòng', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, VIEW_DRAFT_C);
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '4', 'chỉ thấy id4 (PENDING, Phòng C) — id5 (APPROVED, Phòng C) phải bị loại');
    });

    await run.run('Người duyệt Phòng D (deptWorkflows): PHẢI thấy CẢ 2 trạng thái của Phòng D (nhánh approver không phân biệt status)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, APPROVER_D);
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '6,7', 'duyet_doc phải thấy CẢ id6 (APPROVED) VÀ id7 (PENDING) của Phòng D');
    });

    await run.run('viewDraftAll (KHÔNG có viewApprovedAll/Depts): thấy MỌI hồ sơ CHƯA duyệt company-wide, KHÔNG tự động thấy hồ sơ ĐÃ duyệt', async () => {
      resetData(); fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, VIEW_ALL);
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,3,4,7,8', 'viewDraftAll chỉ thấy hồ sơ KHÁC APPROVED (id2/5/6 đã duyệt phải bị loại, không có viewApprovedAll/Depts nào)');
      assert(fullLoadCallCount >= 1, 'viewDraftAll phải tải theo nhánh company-wide (để không bỏ sót phòng ban nào)');
    });

    await run.run('viewDraftAll + viewApprovedAll: nhận ĐỦ toàn công ty', async () => {
      resetData(); fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, VIEW_TRUE_ALL);
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,2,3,4,5,6,7,8', 'có cả 2 quyền All thì thấy đủ cả 8 tài liệu bất kể trạng thái');
      assert(fullLoadCallCount >= 1, 'phải tải theo nhánh company-wide');
    });

    await run.run('admin: nhận ĐỦ toàn công ty', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,2,3,4,5,6,7,8', 'admin phải thấy đủ cả 8 tài liệu');
    });

    await run.run('dù nhánh tải trả THỪA (giả lập lỗi tầng dưới), filterDocsForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData();
      stubModule('lib/recordStore', {
        MIGRATED_COLLECTIONS: new Set(['docs']),
        getAllForCollectionCached: async () => ALL_DOCS.map(r => ({ ...r })),
        getForCollectionByDeptCached: async () => ALL_DOCS.map(r => ({ ...r })), // CỐ Ý trả thừa mọi phòng ban
        getForCollectionByUsernameCached: async () => [],
        getForCollectionByColumnCached: async () => ALL_DOCS.map(r => ({ ...r })) // CỐ Ý trả thừa
      });
      delete require.cache[require.resolve('../routes/data')];
      const freshDataRoutes = require('../routes/data');
      const app2 = express();
      app2.use(express.json());
      app2.use('/api/data', freshDataRoutes);
      const server2 = await new Promise((resolve, reject) => {
        const s = http.createServer(app2);
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => resolve(s));
      });
      const port2 = server2.address().port;
      CURRENT_USERNAME = REGULAR_A.username;
      const res = await fetch(`http://127.0.0.1:${port2}/api/data`);
      const body = await res.json();
      server2.close();
      const ids = (body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,8', 'dù tầng tải trả thừa, filterDocsForUser() vẫn phải chốt đúng còn tài liệu tự tải lên của nva');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
