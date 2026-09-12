// server/tests/test-submissions-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau Bước 8l: submissions tách riêng khỏi vòng lặp
// tải chung qua loadSubmissionsScoped(). canViewSubmission() (lib/recordViewScope.js) 5 nhánh — (1)
// admin xem HẾT, (2) chính người TẠO (creator), (3) scopeAllows(submissionView, dept) — phòng ban mình
// HOẶC submissionView.all/depts[], (4) đang được mời "Xin ý kiến" (opinionRequestees), (5) đang là
// người duyệt theo effectiveApprovers ĐÃ ĐÓNG BĂNG lúc tạo (hoặc cấu hình hiện tại nếu hồ sơ CŨ chưa có
// snapshot). loadSubmissionsScoped() SQL-narrow theo dept/creator/approver-config-hiện-tại + LUÔN tải
// thêm mọi hồ sơ ĐANG PENDING company-wide để bù đắp 2 nhánh (4)/(5) không có cột SQL nào tra thẳng
// được (xem chú thích đầy đủ ở routes/data.js).
//
// Chạy: node server/tests/test-submissions-scope.js
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
const SCOPE_USER = { username: 'scopeuser', name: 'Người Có Phạm Vi Mở Rộng', dept: 'Phòng A', perms: { submissionView: { depts: ['Phòng C'] } }, active: true };
const APPROVER_TYPE = { username: 'duyet_type', name: 'Người Duyệt Loại Riêng', dept: 'Phòng X', perms: {}, active: true };
const APPROVER_DEFAULT = { username: 'duyet_default', name: 'Người Duyệt Mặc Định', dept: 'Phòng X', perms: {}, active: true };
const ALL_VIEW = { username: 'allview', name: 'Xem Toàn Bộ', dept: 'Phòng X', perms: { submissionView: { all: true } }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const USERS = [REGULAR_A, SCOPE_USER, APPROVER_TYPE, APPROVER_DEFAULT, ALL_VIEW, ADMIN];

const APP_DATA = {
  submissionDeptWorkflows: {
    'Phòng E': { approvers: { 1: ['duyet_default'] } }
  },
  submissionTypeDeptWorkflows: {
    KHAC: {
      'Phòng F': { approvers: { 1: ['duyet_type'] } }
    }
  }
};

let ALL_SUBS;
function resetData() {
  ALL_SUBS = [
    { id: 1, dept: 'Phòng A', creator: 'nva', status: 'APPROVED', opinionRequestees: [] },
    { id: 2, dept: 'Phòng B', creator: 'nvb', status: 'PENDING', opinionRequestees: [] }, // creator khác, không liên quan REGULAR_A
    { id: 3, dept: 'Phòng C', creator: 'nvc', status: 'APPROVED', opinionRequestees: [] }, // scope depts=['Phòng C']
    { id: 4, dept: 'Phòng E', creator: 'nve', status: 'REJECTED', opinionRequestees: [] }, // duyet_default approver theo submissionDeptWorkflows (dù đã REJECTED)
    { id: 5, dept: 'Phòng F', creator: 'nvf', status: 'APPROVED', opinionRequestees: [] }, // duyet_type approver theo submissionTypeDeptWorkflows
    // id6: PENDING, người tạo/dept không liên quan gì tới nva — nhưng vẫn phải lọt qua vì loadSubmissionsScoped()
    // LUÔN tải thêm mọi hồ sơ PENDING company-wide (bù nhánh opinionRequestees/snapshot approver không SQL-narrow được);
    // filterSubmissionsForUser() phải LOẠI nó ra khỏi kết quả cuối cùng cho nva vì KHÔNG khớp nhánh nào thật sự.
    { id: 6, dept: 'Phòng G', creator: 'nvg', status: 'PENDING', opinionRequestees: [] },
    // id7: PENDING, nva được mời "Xin ý kiến" — dept/creator không liên quan gì tới nva, CHỈ lọt qua nhờ
    // nhánh PENDING company-wide + canViewSubmission() nhánh opinionRequestees.
    { id: 7, dept: 'Phòng H', creator: 'nvh', status: 'PENDING', opinionRequestees: ['nva'] }
  ];
}
resetData();

let fullLoadCallCount = 0;
let byDeptCalls = [];
let byColumnCalls = [];

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} }),
  getAppDataValue: async (key) => APP_DATA[key] || null
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['submissions']),
  getAllForCollectionCached: async (collection) => {
    if (collection !== 'submissions') return [];
    fullLoadCallCount++;
    return ALL_SUBS.map(r => ({ ...r }));
  },
  getForCollectionByDeptCached: async (collection, dept) => {
    if (collection !== 'submissions') return [];
    byDeptCalls.push(dept);
    return ALL_SUBS.filter(r => r.dept === dept).map(r => ({ ...r }));
  },
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async (collection, column, value) => {
    if (collection !== 'submissions') return [];
    byColumnCalls.push(`${column}=${value}`);
    if (column === 'Creator') return ALL_SUBS.filter(r => r.creator === value).map(r => ({ ...r }));
    if (column === 'Status') return ALL_SUBS.filter(r => r.status === value).map(r => ({ ...r }));
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
    await run.run('Nhân viên thường: thấy phòng ban mình + hồ sơ tự tạo + hồ sơ PENDING mình được mời Xin ý kiến, KHÔNG thấy hồ sơ PENDING không liên quan', async () => {
      resetData(); fullLoadCallCount = 0; byDeptCalls = []; byColumnCalls = [];
      const res = await api('GET', '/api/data', undefined, REGULAR_A);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.submissions || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,7', 'nva phải thấy id1 (Phòng A, tự tạo) + id7 (PENDING, được mời Xin ý kiến) — KHÔNG thấy id6 (PENDING nhưng không liên quan gì)');
      assertEqual(fullLoadCallCount, 0, 'người thường KHÔNG được tải toàn bộ company-wide');
    });

    await run.run('submissionView.depts=["Phòng C"]: thấy phòng ban mình (Phòng A, qua scopeAllows own-dept) + Phòng C (qua scope)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, SCOPE_USER);
      const ids = (res.body.submissions || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,3', 'scopeuser (Phòng A) phải thấy id1 (Phòng A, phòng ban mình) + id3 (Phòng C, qua scope)');
    });

    await run.run('Người duyệt theo submissionDeptWorkflows (mặc định): PHẢI thấy hồ sơ Phòng E dù đã REJECTED', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, APPROVER_DEFAULT);
      const ids = (res.body.submissions || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '4', 'duyet_default phải thấy id4 (Phòng E, đang duyệt theo cấu hình mặc định)');
    });

    await run.run('Người duyệt theo submissionTypeDeptWorkflows (loại riêng): PHẢI thấy hồ sơ Phòng F', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, APPROVER_TYPE);
      const ids = (res.body.submissions || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '5', 'duyet_type phải thấy id5 (Phòng F, đang duyệt theo cấu hình riêng loại KHAC)');
    });

    await run.run('submissionView.all: nhận ĐỦ toàn công ty', async () => {
      resetData(); fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, ALL_VIEW);
      const ids = (res.body.submissions || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,2,3,4,5,6,7', 'submissionView.all phải thấy đủ cả 7 hồ sơ');
      assert(fullLoadCallCount >= 1, 'submissionView.all phải tải theo nhánh company-wide');
    });

    await run.run('admin: nhận ĐỦ toàn công ty', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      const ids = (res.body.submissions || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,2,3,4,5,6,7', 'admin phải thấy đủ cả 7 hồ sơ');
    });

    await run.run('dù nhánh tải trả THỪA (giả lập lỗi tầng dưới), filterSubmissionsForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData();
      stubModule('lib/recordStore', {
        MIGRATED_COLLECTIONS: new Set(['submissions']),
        getAllForCollectionCached: async () => ALL_SUBS.map(r => ({ ...r })),
        getForCollectionByDeptCached: async () => ALL_SUBS.map(r => ({ ...r })), // CỐ Ý trả thừa mọi phòng ban
        getForCollectionByUsernameCached: async () => [],
        getForCollectionByColumnCached: async () => ALL_SUBS.map(r => ({ ...r })) // CỐ Ý trả thừa
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
      const ids = (body.submissions || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,7', 'dù tầng tải trả thừa, filterSubmissionsForUser() vẫn phải chốt đúng còn id1 (tự tạo) + id7 (được mời Xin ý kiến)');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
