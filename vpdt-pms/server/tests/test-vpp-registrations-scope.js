// server/tests/test-vpp-registrations-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau Bước 8i: vppRegistrations tách riêng khỏi vòng
// lặp tải chung qua loadVppRegistrationsScoped(). canViewVppRegistration() (lib/recordViewScope.js) đơn
// giản hơn itPriceApprovals — chỉ 3 nhánh: canManageVpp (admin/vppManage) xem hết, chính người TẠO
// (Creator), người duyệt theo vppDeptWorkflows (dept-keyed, 1 cấu hình duy nhất). KHÔNG có nhánh "phòng
// ban mình" (giống itPriceApprovals, khác carRegs/officeReqs).
//
// Chạy: node server/tests/test-vpp-registrations-scope.js
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

const CREATOR_A = { username: 'nva', name: 'Người Tạo A', dept: 'Phòng A', perms: {}, active: true };
const APPROVER_B = { username: 'duyet_b', name: 'Người Duyệt Phòng B', dept: 'Phòng Z', perms: {}, active: true };
const VPP_MGR = { username: 'vppmgr', name: 'Quản Lý VPP', dept: 'Phòng Hành Chính', perms: { vppManage: true }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const USERS = [CREATOR_A, APPROVER_B, VPP_MGR, ADMIN];

const APP_DATA = {
  vppDeptWorkflows: {
    'Phòng B': { approvers: { 1: ['duyet_b'] } }
  }
};

let ALL_ITEMS;
function resetData() {
  ALL_ITEMS = [
    { id: 1, dept: 'Phòng A', creator: 'nva' },
    { id: 2, dept: 'Phòng B', creator: 'ntb' },
    { id: 3, dept: 'Phòng C', creator: 'ntc' },
    { id: 4, dept: 'Phòng A', creator: 'other1' } // CÙNG phòng ban với nva, KHÁC người tạo
  ];
}
resetData();

let fullLoadCallCount = 0;

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['vppRegistrations']),
  getAllForCollectionCached: async (collection) => {
    if (collection !== 'vppRegistrations') return [];
    fullLoadCallCount++;
    return ALL_ITEMS.map(r => ({ ...r }));
  },
  getForCollectionByDeptCached: async (collection, dept) => {
    if (collection !== 'vppRegistrations') return [];
    return ALL_ITEMS.filter(r => r.dept === dept).map(r => ({ ...r }));
  },
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async (collection, column, value) => {
    if (collection !== 'vppRegistrations') return [];
    if (column === 'Creator') return ALL_ITEMS.filter(r => r.creator === value).map(r => ({ ...r }));
    return [];
  }
});

let CURRENT_USERNAME = CREATOR_A.username;
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
    await run.run('Người tạo (nva): CHỈ thấy đăng ký do CHÍNH MÌNH tạo — KHÔNG tự động thấy đăng ký khác dù CÙNG phòng ban', async () => {
      resetData(); fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, CREATOR_A);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.vppRegistrations || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1', 'nva chỉ thấy id1 (do mình tạo) — id4 CÙNG phòng ban nhưng KHÁC người tạo không được lộ');
      assertEqual(fullLoadCallCount, 0, 'người thường KHÔNG được tải toàn bộ company-wide');
    });

    await run.run('Người duyệt Phòng B: PHẢI thấy đăng ký của Phòng B dù không phải phòng mình', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, APPROVER_B);
      const ids = (res.body.vppRegistrations || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '2', 'duyet_b phải thấy id2 (Phòng B, đang duyệt)');
    });

    await run.run('vppManage: nhận ĐỦ toàn bộ', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, VPP_MGR);
      const ids = (res.body.vppRegistrations || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'vppManage phải thấy đủ cả 4 đăng ký');
    });

    await run.run('admin: nhận ĐỦ toàn bộ', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      const ids = (res.body.vppRegistrations || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'admin phải thấy đủ cả 4 đăng ký');
    });

    await run.run('dù nhánh tải trả THỪA (giả lập lỗi tầng dưới), filterVppRegistrationsForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData();
      stubModule('lib/recordStore', {
        MIGRATED_COLLECTIONS: new Set(['vppRegistrations']),
        // Chỉ trả thừa cho ĐÚNG vppRegistrations — collection khác (docs/submissions/attendanceRecords...
        // cũng gọi các hàm này KHÔNG điều kiện ở routes/data.js) phải trả đúng rỗng, tránh vô tình "nhồi"
        // dữ liệu sai hình dạng khiến canViewDoc()/canViewSubmission() (đọc appData thật qua
        // getAppDataValue(), KHÔNG stub ở test này) ném lỗi ngoài ý muốn.
        getAllForCollectionCached: async (collection) => (collection === 'vppRegistrations' ? ALL_ITEMS.map(r => ({ ...r })) : []),
        getForCollectionByDeptCached: async (collection) => (collection === 'vppRegistrations' ? ALL_ITEMS.map(r => ({ ...r })) : []), // CỐ Ý trả thừa
        getForCollectionByUsernameCached: async () => [],
        getForCollectionByColumnCached: async (collection) => (collection === 'vppRegistrations' ? ALL_ITEMS.map(r => ({ ...r })) : []) // CỐ Ý trả thừa
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
      CURRENT_USERNAME = CREATOR_A.username;
      const res = await fetch(`http://127.0.0.1:${port2}/api/data`);
      const body = await res.json();
      server2.close();
      const ids = (body.vppRegistrations || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1', 'dù tầng tải trả thừa, filterVppRegistrationsForUser() vẫn phải chốt đúng còn id1 (do nva tạo)');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
