// server/tests/test-it-price-approvals-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau Bước 8h: itPriceApprovals tách riêng khỏi vòng
// lặp tải chung qua loadItPriceApprovalsScoped(). canViewItPriceApproval() (lib/recordViewScope.js) KHÁC
// carRegs/officeReqs — KHÔNG có nhánh "phòng ban mình" nào (người thường KHÔNG tự động thấy đề xuất giá
// của phòng ban mình, dù cùng dept). Chỉ: admin/itManage xem hết; chính người tạo (Creator); người có
// itPriceEmergencyRejectApprove (điều kiện theo DỮ LIỆU emergencyRejectStatus/emergencyRejectDecidedBy,
// không theo phòng ban); người duyệt RETAIL theo phòng ban (itPriceDeptWorkflows) HOẶC người duyệt
// WHOLESALE theo 1 trong 4 mức cố định (itPriceTierWorkflows, không theo phòng ban).
//
// Chạy: node server/tests/test-it-price-approvals-scope.js
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
const RETAIL_APPROVER_B = { username: 'duyet_b', name: 'Người Duyệt Bán Lẻ Phòng B', dept: 'Phòng Z', perms: {}, active: true };
const WHOLESALE_APPROVER = { username: 'duyet_wholesale', name: 'Người Duyệt Bán Buôn TIER1', dept: 'Phòng Z', perms: {}, active: true };
const EMERGENCY_USER = { username: 'khancap1', name: 'Người Xét Từ Chối Khẩn Cấp', dept: 'Phòng Z', perms: { itPriceEmergencyRejectApprove: true }, active: true };
const IT_MANAGER = { username: 'itmgr', name: 'Trưởng Nhóm Hỗ Trợ IT', dept: 'Phòng IT', perms: { itManage: true }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const USERS = [CREATOR_A, RETAIL_APPROVER_B, WHOLESALE_APPROVER, EMERGENCY_USER, IT_MANAGER, ADMIN];

const APP_DATA = {
  // Cấu hình PHẲNG (legacy) = tính là RETAIL, khớp resolveItPriceDeptWorkflowConfig().
  itPriceDeptWorkflows: {
    'Phòng B': { approvers: { 1: ['duyet_b'] } }
  },
  itPriceTierWorkflows: {
    TIER1: { approvers: { 1: ['duyet_wholesale'] } }
  }
};

let ALL_ITEMS;
function resetData() {
  ALL_ITEMS = [
    { id: 1, dept: 'Phòng A', creator: 'nva', priceType: 'RETAIL' },
    { id: 2, dept: 'Phòng B', creator: 'ntb', priceType: 'RETAIL', emergencyRejectStatus: 'PENDING' },
    { id: 3, dept: 'Phòng C', creator: 'ntc', priceType: 'WHOLESALE', priceTier: 'TIER1' },
    { id: 4, dept: 'Phòng A', creator: 'other1', priceType: 'RETAIL' } // CÙNG phòng ban với nva, nhưng KHÁC người tạo
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
  MIGRATED_COLLECTIONS: new Set(['itPriceApprovals']),
  getAllForCollectionCached: async (collection) => {
    if (collection !== 'itPriceApprovals') return [];
    fullLoadCallCount++;
    return ALL_ITEMS.map(r => ({ ...r }));
  },
  getForCollectionByDeptCached: async (collection, dept) => {
    if (collection !== 'itPriceApprovals') return [];
    return ALL_ITEMS.filter(r => r.dept === dept).map(r => ({ ...r }));
  },
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async (collection, column, value) => {
    if (collection !== 'itPriceApprovals') return [];
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
    await run.run('Người tạo (nva): CHỈ thấy đề xuất do CHÍNH MÌNH tạo — KHÔNG tự động thấy đề xuất KHÁC dù CÙNG phòng ban (khác carRegs/officeReqs)', async () => {
      resetData(); fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, CREATOR_A);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.itPriceApprovals || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1', 'nva chỉ thấy id1 (do mình tạo) — id4 CÙNG phòng ban nhưng KHÁC người tạo không được lộ');
      assertEqual(fullLoadCallCount, 0, 'người thường KHÔNG được tải toàn bộ company-wide');
    });

    await run.run('Người duyệt Bán Lẻ (RETAIL) của Phòng B: PHẢI thấy đề xuất RETAIL của Phòng B', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, RETAIL_APPROVER_B);
      const ids = (res.body.itPriceApprovals || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '2', 'duyet_b phải thấy id2 (Phòng B, đang duyệt)');
    });

    await run.run('Người duyệt Bán Buôn (WHOLESALE) TIER1: PHẢI thấy đề xuất TIER1 dù khác phòng ban, KHÔNG lộ đề xuất khác', async () => {
      resetData(); fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, WHOLESALE_APPROVER);
      const ids = (res.body.itPriceApprovals || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '3', 'duyet_wholesale phải thấy ĐÚNG id3 (TIER1) — dù tải company-wide (không quy được về 1 phòng ban), lớp lọc thật vẫn chốt đúng chỉ còn đúng phạm vi được duyệt');
      assert(fullLoadCallCount >= 1, 'người duyệt tier phải tải theo nhánh company-wide (không thể thu hẹp theo dept)');
    });

    await run.run('itPriceEmergencyRejectApprove: PHẢI thấy đề xuất đang chờ "Từ chối khẩn cấp", KHÔNG lộ đề xuất khác', async () => {
      resetData(); fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, EMERGENCY_USER);
      const ids = (res.body.itPriceApprovals || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '2', 'khancap1 phải thấy ĐÚNG id2 (emergencyRejectStatus=PENDING), không lộ id1/3/4');
      assert(fullLoadCallCount >= 1, 'người có quyền xét khẩn cấp phải tải company-wide (điều kiện không theo phòng ban)');
    });

    await run.run('itManage: nhận ĐỦ toàn bộ', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, IT_MANAGER);
      const ids = (res.body.itPriceApprovals || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'itManage phải thấy đủ cả 4 đề xuất');
    });

    await run.run('admin: nhận ĐỦ toàn bộ', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      const ids = (res.body.itPriceApprovals || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'admin phải thấy đủ cả 4 đề xuất');
    });

    await run.run('dù nhánh tải trả THỪA (giả lập lỗi tầng dưới), filterItPriceApprovalsForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData();
      stubModule('lib/recordStore', {
        MIGRATED_COLLECTIONS: new Set(['itPriceApprovals']),
        getAllForCollectionCached: async () => ALL_ITEMS.map(r => ({ ...r })),
        getForCollectionByDeptCached: async () => ALL_ITEMS.map(r => ({ ...r })), // CỐ Ý trả thừa
        getForCollectionByUsernameCached: async () => [],
        getForCollectionByColumnCached: async () => ALL_ITEMS.map(r => ({ ...r })) // CỐ Ý trả thừa
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
      const ids = (body.itPriceApprovals || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1', 'dù tầng tải trả thừa, filterItPriceApprovalsForUser() vẫn phải chốt đúng còn id1 (do nva tạo)');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
