// server/tests/test-car-regs-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau Bước 8f: carRegs tách riêng khỏi vòng lặp tải
// chung qua loadCarRegsScoped(). canViewCarReg() (lib/recordViewScope.js) có 4 nhánh — admin; chính lái
// xe được gán (assignedDriverUsername, không nhất thiết cùng phòng ban); scopeAllows(carView, dept)
// (phòng ban mình + carView.all + carView.depts[] riêng từng người); đang là người duyệt theo
// carDeptWorkflows (dept-keyed). routes/data.js gộp {phòng ban mình} ∪ carView.depts[] ∪ {phòng ban
// approver} rồi tải từng phòng ban + 1 lượt riêng theo AssignedDriverUsername, gộp + khử trùng.
//
// Chạy: node server/tests/test-car-regs-scope.js
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
const SCOPE_USER = { username: 'scopeuser', name: 'Người Có Phạm Vi Mở Rộng', dept: 'Phòng A', perms: { carView: { depts: ['Phòng C'] } }, active: true };
const APPROVER_D = { username: 'duyet1', name: 'Người Duyệt Xe Phòng D', dept: 'Phòng A', perms: {}, active: true };
const DRIVER_B = { username: 'lixe1', name: 'Lái Xe', dept: 'Phòng A', perms: {}, active: true };
const ALL_VIEW = { username: 'allview', name: 'Xem Toàn Bộ', dept: 'Phòng A', perms: { carView: { all: true } }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const USERS = [REGULAR_A, SCOPE_USER, APPROVER_D, DRIVER_B, ALL_VIEW, ADMIN];

const APP_DATA = {
  // duyet1 là người duyệt CẤU HÌNH của Phòng D (không liên quan phòng ban của chính duyet1, là Phòng A).
  carDeptWorkflows: {
    'Phòng D': { approvers: { 1: ['duyet1'] } }
  }
};

let ALL_CARS;
function resetData() {
  ALL_CARS = [
    { id: 1, dept: 'Phòng A', assignedDriverUsername: null },
    { id: 2, dept: 'Phòng B', assignedDriverUsername: 'lixe1' }, // lixe1 được gán lái xe này, dù xe thuộc Phòng B
    { id: 3, dept: 'Phòng C', assignedDriverUsername: null },
    { id: 4, dept: 'Phòng D', assignedDriverUsername: null }
  ];
}
resetData();

let byDeptCalls = [];
let byColumnCalls = [];
let fullLoadCallCount = 0;

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['carRegs']),
  getAllForCollectionCached: async (collection) => {
    if (collection !== 'carRegs') return [];
    fullLoadCallCount++;
    return ALL_CARS.map(r => ({ ...r }));
  },
  getForCollectionByDeptCached: async (collection, dept) => {
    if (collection !== 'carRegs') return [];
    byDeptCalls.push(dept);
    return ALL_CARS.filter(r => r.dept === dept).map(r => ({ ...r }));
  },
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async (collection, column, value) => {
    if (collection !== 'carRegs') return [];
    byColumnCalls.push(`${column}=${value}`);
    if (column === 'AssignedDriverUsername') {
      return ALL_CARS.filter(r => r.assignedDriverUsername === value).map(r => ({ ...r }));
    }
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
    await run.run('Nhân viên thường (không scope/không approver/không lái xe): chỉ thấy xe ĐÚNG phòng ban mình', async () => {
      resetData(); byDeptCalls = []; byColumnCalls = []; fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, REGULAR_A);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.carRegs || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1', 'Phòng A (nva) chỉ thấy đúng xe của phòng mình');
      assertEqual(fullLoadCallCount, 0, 'người thường KHÔNG được tải toàn bộ company-wide');
    });

    await run.run('carView.depts=["Phòng C"] (không phải all): thấy phòng ban mình + Phòng C, KHÔNG thấy Phòng B/D', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, SCOPE_USER);
      const ids = (res.body.carRegs || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,3', 'phải thấy đúng Phòng A (mình) + Phòng C (scope), không thừa/thiếu');
    });

    await run.run('Người duyệt carDeptWorkflows của Phòng D (không phải phòng mình): PHẢI thấy xe Phòng D để duyệt', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, APPROVER_D);
      const ids = (res.body.carRegs || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,4', 'duyet1 phải thấy Phòng A (mình) + Phòng D (đang duyệt) — quan trọng nhất, tránh lỗi người duyệt không thấy hồ sơ');
    });

    await run.run('Lái xe được gán (assignedDriverUsername) cho 1 xe khác phòng ban: PHẢI thấy đúng xe đó dù khác phòng ban', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, DRIVER_B);
      const ids = (res.body.carRegs || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2', 'lixe1 phải thấy Phòng A (mình) + xe id2 (được gán lái, dù thuộc Phòng B)');
    });

    await run.run('carView.all: nhận ĐỦ toàn công ty (không mất dữ liệu)', async () => {
      resetData(); fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, ALL_VIEW);
      const ids = (res.body.carRegs || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'carView.all phải thấy đủ cả 4 xe');
      assert(fullLoadCallCount >= 1, 'carView.all phải tải theo nhánh company-wide');
    });

    await run.run('admin: nhận ĐỦ toàn công ty', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      const ids = (res.body.carRegs || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'admin phải thấy đủ cả 4 xe');
    });

    await run.run('dù nhánh tải trả THỪA (giả lập lỗi tầng dưới), filterCarRegsForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData();
      stubModule('lib/recordStore', {
        MIGRATED_COLLECTIONS: new Set(['carRegs']),
        // Chỉ trả thừa cho ĐÚNG carRegs — collection khác (docs/submissions/attendanceRecords... cũng
        // gọi các hàm này KHÔNG điều kiện ở routes/data.js) phải trả đúng rỗng, tránh vô tình "nhồi" dữ
        // liệu sai hình dạng khiến canViewDoc()/canViewSubmission() (đọc appData thật qua
        // getAppDataValue(), KHÔNG stub ở test này) ném lỗi ngoài ý muốn.
        getAllForCollectionCached: async (collection) => (collection === 'carRegs' ? ALL_CARS.map(r => ({ ...r })) : []),
        getForCollectionByDeptCached: async (collection) => (collection === 'carRegs' ? ALL_CARS.map(r => ({ ...r })) : []), // CỐ Ý trả thừa mọi phòng ban
        getForCollectionByUsernameCached: async () => [],
        getForCollectionByColumnCached: async (collection) => (collection === 'carRegs' ? ALL_CARS.map(r => ({ ...r })) : []) // CỐ Ý trả thừa
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
      const ids = (body.carRegs || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1', 'dù tầng tải trả thừa, filterCarRegsForUser() vẫn phải chốt đúng còn xe của Phòng A');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
