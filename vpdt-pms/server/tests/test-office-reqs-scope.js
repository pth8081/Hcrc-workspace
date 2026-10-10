// server/tests/test-office-reqs-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau Bước 8g: officeReqs tách riêng khỏi vòng lặp
// tải chung qua loadOfficeReqsScoped(). canViewOfficeReq() (lib/recordViewScope.js) cùng khuôn carRegs
// (4 nhánh: admin; chính người TẠO — Creator, KHÔNG forceOwnDept nên có thể tạo hộ phòng ban khác;
// scopeAllows(dept, deptViewScopeConfig['office']) (mode DEPT + extraViewers/managerCanView — LÀM GỌN
// 10/2026 "Việc D" mở rộng: bỏ hẳn quyền phẳng cũ officeView {all,depts}); đang là người duyệt theo
// *DeptWorkflows) — khác carRegs ở chỗ CÓ 2 bộ cấu hình duyệt riêng theo subType
// (officeBuyDeptWorkflows/officeFixDeptWorkflows).
//
// Chạy: node server/tests/test-office-reqs-scope.js
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
// duyet1 duyệt SUA_CHUA của Phòng D (không phải phòng mình, không phải MUA_BAN).
const APPROVER_D_FIX = { username: 'duyet1', name: 'Người Duyệt Sửa Chữa Phòng D', dept: 'Phòng A', perms: {}, active: true };
// creator1 tạo hộ đề xuất cho Phòng B (officeCreate scope riêng cho phép, không forceOwnDept).
const CREATOR_OTHER_DEPT = { username: 'creator1', name: 'Người Tạo Hộ Phòng B', dept: 'Phòng A', perms: {}, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
// MANAGED_CREATOR_OFFICE: dùng RIÊNG cho kịch bản deptViewScopeConfig.office.managerCanView dưới (được
// REGULAR_A quản lý trực tiếp qua managerUsername) — managerCanView chỉ cấp quyền xem theo QUAN HỆ QUẢN
// LÝ với NGƯỜI TẠO từng hồ sơ cụ thể (item.creator, qua scopeAllows()->extraViewScopeAllows()->
// isManagerOf()), không phải cấp quyền xem toàn công ty cho MỌI user thường.
const MANAGED_CREATOR_OFFICE = { username: 'nv_cap_duoi_office', name: 'NV Cấp Dưới Của A (Mua Sắm)', dept: 'Phòng B', perms: {}, managerUsername: 'nva', active: true };
const USERS = [REGULAR_A, APPROVER_D_FIX, CREATOR_OTHER_DEPT, ADMIN, MANAGED_CREATOR_OFFICE];

const APP_DATA = {
  officeBuyDeptWorkflows: {},
  officeFixDeptWorkflows: {
    'Phòng D': { approvers: { 1: ['duyet1'] } }
  },
  // isManagerOf()/extraViewScopeAllows() (lib/recordViewScope.js) đọc appData.users để tra managerUsername
  // theo quan hệ quản lý-nhân viên — cần có mặt ở đây cho kịch bản managerCanView dưới.
  users: USERS
};

let ALL_REQS;
function resetData() {
  ALL_REQS = [
    { id: 1, dept: 'Phòng A', subType: 'MUA_BAN', creator: 'nva' },
    { id: 2, dept: 'Phòng B', subType: 'MUA_BAN', creator: 'creator1' }, // creator1 tạo hộ Phòng B, dù bản thân ở Phòng A
    { id: 3, dept: 'Phòng C', subType: 'MUA_BAN', creator: 'ntc' },
    { id: 4, dept: 'Phòng D', subType: 'SUA_CHUA', creator: 'ntd' }
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
  MIGRATED_COLLECTIONS: new Set(['officeReqs']),
  getAllForCollectionCached: async (collection) => {
    if (collection !== 'officeReqs') return [];
    fullLoadCallCount++;
    return ALL_REQS.map(r => ({ ...r }));
  },
  getForCollectionByDeptCached: async (collection, dept) => {
    if (collection !== 'officeReqs') return [];
    byDeptCalls.push(dept);
    return ALL_REQS.filter(r => r.dept === dept).map(r => ({ ...r }));
  },
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async (collection, column, value) => {
    if (collection !== 'officeReqs') return [];
    byColumnCalls.push(`${column}=${value}`);
    if (column === 'Creator') {
      return ALL_REQS.filter(r => r.creator === value).map(r => ({ ...r }));
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
    await run.run('Nhân viên thường: chỉ thấy đề xuất ĐÚNG phòng ban mình', async () => {
      resetData(); byDeptCalls = []; byColumnCalls = []; fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, REGULAR_A);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.officeReqs || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1', 'Phòng A (nva) chỉ thấy đúng đề xuất của phòng mình');
      assertEqual(fullLoadCallCount, 0, 'người thường KHÔNG được tải toàn bộ company-wide');
    });

    await run.run('Người duyệt Sửa Chữa của Phòng D: PHẢI thấy đề xuất SUA_CHUA của Phòng D dù khác phòng mình', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, APPROVER_D_FIX);
      const ids = (res.body.officeReqs || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,4', 'duyet1 phải thấy Phòng A (mình) + Phòng D (đang duyệt Sửa Chữa)');
    });

    await run.run('Người tạo hộ Phòng B (officeReqs KHÔNG forceOwnDept): PHẢI thấy đúng đề xuất mình tạo dù khác phòng ban mình', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, CREATOR_OTHER_DEPT);
      const ids = (res.body.officeReqs || []).map(r => r.id).sort();
      // creator1 thuộc Phòng A (thấy id1 qua nhánh phòng ban mình) VÀ đã tạo hộ id2 cho Phòng B (thấy
      // qua nhánh Creator) — cả 2 nhánh cộng lại, không phải chỉ 1.
      assertEqual(ids.join(','), '1,2', 'creator1 phải thấy id1 (phòng mình) + id2 (đề xuất mình tạo cho Phòng B)');
    });

    await run.run('admin: nhận ĐỦ toàn công ty', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      const ids = (res.body.officeReqs || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'admin phải thấy đủ cả 4 đề xuất');
    });

    // LỖI ĐÃ VÁ (rà soát v24.74→v24.81, 11/2026, mức Trung bình): deptViewScopeConfig['office'] trước đây
    // KHÔNG được loadOfficeReqsScoped() đọc — xem chú thích đầy đủ tại loadOfficeReqsScoped() (routes/data.js).
    await run.run('GET /api/data: deptViewScopeConfig.office.extraViewers=[nva] (thay thế officeView.all cũ)', async () => {
      resetData(); fullLoadCallCount = 0;
      APP_DATA.deptViewScopeConfig = { office: { mode: 'DEPT', extraViewers: [REGULAR_A.username], managerCanView: false } };
      const res = await api('GET', '/api/data', undefined, REGULAR_A);
      const ids = (res.body.officeReqs || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,2,3,4', 'extraViewers phải thấy đủ cả 4 đề xuất, mọi phòng ban');
      assert(fullLoadCallCount >= 1, 'extraViewers phải đi qua nhánh tải company-wide');
      delete APP_DATA.deptViewScopeConfig;
    });

    await run.run('GET /api/data: deptViewScopeConfig.office.managerCanView=true -> quản lý của người tạo hồ sơ nhận thêm hồ sơ của cấp dưới, không phải mọi user thường', async () => {
      resetData(); fullLoadCallCount = 0;
      // Hồ sơ #5 riêng (creator) của MANAGED_CREATOR_OFFICE — người mà REGULAR_A quản lý trực tiếp.
      ALL_REQS.push({ id: 5, dept: 'Phòng B', subType: 'MUA_BAN', creator: MANAGED_CREATOR_OFFICE.username });
      APP_DATA.deptViewScopeConfig = { office: { mode: 'DEPT', extraViewers: [], managerCanView: true } };
      const res = await api('GET', '/api/data', undefined, REGULAR_A);
      const ids = (res.body.officeReqs || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1,5', 'A (quản lý của nv_cap_duoi_office) phải thấy #1 (phòng mình) + #5 (của cấp dưới) qua managerCanView, KHÔNG thấy #2/#3/#4');
      assert(fullLoadCallCount >= 1, 'managerCanView phải đi qua nhánh tải company-wide ở lớp SQL pre-filter');
      delete APP_DATA.deptViewScopeConfig;
    });

    await run.run('dù nhánh tải trả THỪA (giả lập lỗi tầng dưới), filterOfficeReqsForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData();
      stubModule('lib/recordStore', {
        MIGRATED_COLLECTIONS: new Set(['officeReqs']),
        // Chỉ trả thừa cho ĐÚNG officeReqs — collection khác (docs/submissions/attendanceRecords... cũng
        // gọi các hàm này KHÔNG điều kiện ở routes/data.js) phải trả đúng rỗng, tránh vô tình "nhồi" dữ
        // liệu sai hình dạng khiến canViewDoc()/canViewSubmission() (đọc appData thật qua
        // getAppDataValue(), KHÔNG stub ở test này) ném lỗi ngoài ý muốn.
        getAllForCollectionCached: async (collection) => (collection === 'officeReqs' ? ALL_REQS.map(r => ({ ...r })) : []),
        getForCollectionByDeptCached: async (collection) => (collection === 'officeReqs' ? ALL_REQS.map(r => ({ ...r })) : []), // CỐ Ý trả thừa mọi phòng ban
        getForCollectionByUsernameCached: async () => [],
        getForCollectionByColumnCached: async (collection) => (collection === 'officeReqs' ? ALL_REQS.map(r => ({ ...r })) : []) // CỐ Ý trả thừa
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
      const ids = (body.officeReqs || []).map(r => r.id).sort();
      assertEqual(ids.join(','), '1', 'dù tầng tải trả thừa, filterOfficeReqsForUser() vẫn phải chốt đúng còn đề xuất của Phòng A');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
