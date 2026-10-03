// server/tests/test-docs-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau Bước 8k: docs tách riêng khỏi vòng lặp tải
// chung qua loadDocsScoped(). canViewDoc() (lib/recordViewScope.js) — LÀM GỌN ở v24.75 (theo yêu cầu
// người dùng "bỏ hết các phân quyền lằng nhằng, chỉ giữ lại đúng quyền Tải tài liệu"): bỏ HẲN 4 quyền
// phẳng cũ viewDraftAll/viewDraftDepts/viewApprovedAll/viewApprovedDepts (Ma Trận Phân Quyền) + nhánh
// isManagerOf(uploader) UNCONDITIONAL — giờ chỉ còn đúng 4 nhánh: (1) admin xem HẾT, (2) chính người TẢI
// LÊN (uploader, mọi phòng ban/trạng thái), (3) đang là người duyệt theo deptWorkflows[dept]/POSITION
// mode (BẤT KỲ bước nào, KHÔNG phân biệt trạng thái hồ sơ — LUÔN thấy để duyệt), (4)
// deptViewScopeConfig['doc'] (khuôn 4 trạng thái dùng chung 16 module khác — mode CREATOR_ONLY/DEPT +
// extraViewers + managerCanView, xem lib/recordViewScope.js moduleViewConfig()/extraViewScopeAllows()).
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
const BYSTANDER_B = { username: 'dongnghiep_b', name: 'Đồng Nghiệp Phòng B', dept: 'Phòng B', perms: {}, active: true };
const EXTRA_VIEWER = { username: 'xemhet', name: 'Xem Toàn Bộ (Chọn Người Xem)', dept: 'Phòng X', perms: {}, active: true };
const MANAGER_OF_OTHER4 = { username: 'quanly_c', name: 'Quản Lý Phòng C', dept: 'Phòng C', perms: {}, active: true };
const OTHER4_UPLOADER = { username: 'other4', name: 'Nhân Viên Phòng C', dept: 'Phòng C', managerUsername: 'quanly_c', perms: {}, active: true };
const APPROVER_D = { username: 'duyet_doc', name: 'Người Duyệt Phòng D', dept: 'Phòng X', perms: {}, active: true };
// LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026): trước đây canViewDoc() tự đọc THẲNG deptWorkflows[dept].approvers
// (field TĨNH), bỏ qua hẳn approverMode/approversByPosition ("Theo vị trí" — POSITION mode) — người
// duyệt hợp lệ theo cấu hình POSITION mode KHÔNG BAO GIỜ thấy được tài liệu cần duyệt. approver_pos có
// jobTitle "Trưởng phòng E" ĐÚNG phòng "Phòng E", canBeApprover=true (bắt buộc với POSITION mode).
const APPROVER_POSITION_E = { username: 'truongphong_e', name: 'Trưởng Phòng E', dept: 'Phòng E', jobTitle: 'Trưởng phòng E', perms: { canBeApprover: true }, active: true };
const NOT_APPROVER_SAME_JOBTITLE_OTHER_DEPT = { username: 'truongphong_f', name: 'Trưởng Phòng F', dept: 'Phòng F', jobTitle: 'Trưởng phòng E', perms: { canBeApprover: true }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const USERS = [
  REGULAR_A, BYSTANDER_B, EXTRA_VIEWER, MANAGER_OF_OTHER4, OTHER4_UPLOADER, APPROVER_D, ADMIN,
  APPROVER_POSITION_E, NOT_APPROVER_SAME_JOBTITLE_OTHER_DEPT
];

const APP_DATA = {
  deptWorkflows: {
    'Phòng D': { approvers: { 1: ['duyet_doc'] } },
    // "Theo vị trí" (POSITION mode) — GẮN đúng dept ('Phòng E') vào cặp (jobTitle,dept), khác dept-less.
    'Phòng E': { approverMode: { 1: 'POSITION' }, approversByPosition: { 1: [{ jobTitle: 'Trưởng phòng E', dept: 'Phòng E' }] } }
  },
  deptViewScopeConfig: {},
  users: USERS
};
function resetDeptViewScopeConfig() {
  APP_DATA.deptViewScopeConfig = { doc: { mode: 'CREATOR_ONLY', extraViewers: [], managerCanView: false } };
}
resetDeptViewScopeConfig();

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
    { id: 8, dept: 'Phòng Z', status: 'REJECTED', uploader: 'nva' },
    { id: 9, dept: 'Phòng E', status: 'PENDING', uploader: 'other7' }
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
      resetData(); resetDeptViewScopeConfig(); fullLoadCallCount = 0; byDeptCalls = [];
      const res = await api('GET', '/api/data', undefined, REGULAR_A);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,8', 'nva phải thấy id1 (Phòng A) + id8 (Phòng Z) — cả 2 đều tự tải lên, KHÔNG thấy hồ sơ người khác');
      assertEqual(fullLoadCallCount, 0, 'người thường KHÔNG được tải toàn bộ company-wide');
    });

    await run.run('deptViewScopeConfig.doc mode DEPT: cùng phòng tự động xem MỌI trạng thái (không riêng đã duyệt)', async () => {
      resetData(); resetDeptViewScopeConfig(); byDeptCalls = [];
      APP_DATA.deptViewScopeConfig.doc = { mode: 'DEPT', extraViewers: [], managerCanView: false };
      const res = await api('GET', '/api/data', undefined, BYSTANDER_B);
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '2,3', 'dongnghiep_b (Phòng B) phải thấy CẢ id2 (APPROVED) VÀ id3 (PENDING), không thấy phòng khác');
      assert(byDeptCalls.includes('Phòng B'), 'mode DEPT phải tải theo dept của user ở nhánh tối ưu SQL');
    });

    await run.run('deptViewScopeConfig.doc extraViewers: người trong danh sách "Chọn người xem" thấy MỌI tài liệu bất kể phòng ban/trạng thái', async () => {
      resetData(); resetDeptViewScopeConfig(); fullLoadCallCount = 0;
      APP_DATA.deptViewScopeConfig.doc = { mode: 'CREATOR_ONLY', extraViewers: ['xemhet'], managerCanView: false };
      const res = await api('GET', '/api/data', undefined, EXTRA_VIEWER);
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,2,3,4,5,6,7,8,9', 'xemhet (extraViewers) phải thấy đủ cả 9 tài liệu');
      assert(fullLoadCallCount >= 1, 'extraViewers phải tải theo nhánh company-wide (whitelist dùng chung toàn công ty, không theo phòng ban)');
    });

    await run.run('deptViewScopeConfig.doc managerCanView: quản lý (Cơ Cấu Tổ Chức) chỉ thấy tài liệu của CHÍNH cấp dưới mình, không thấy người khác', async () => {
      resetData(); resetDeptViewScopeConfig(); fullLoadCallCount = 0;
      APP_DATA.deptViewScopeConfig.doc = { mode: 'CREATOR_ONLY', extraViewers: [], managerCanView: true };
      const res = await api('GET', '/api/data', undefined, MANAGER_OF_OTHER4);
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '5', 'quanly_c phải CHỈ thấy id5 (uploader other4, cấp dưới trực tiếp) — KHÔNG thấy id4 (other3, không phải cấp dưới của quanly_c) hay bất kỳ hồ sơ nào khác');
      assert(fullLoadCallCount >= 1, 'managerCanView phải tải theo nhánh company-wide (cấp dưới có thể ở BẤT KỲ phòng ban nào)');
    });

    await run.run('Người duyệt Phòng D (deptWorkflows): PHẢI thấy CẢ 2 trạng thái của Phòng D (nhánh approver không phân biệt status)', async () => {
      resetData(); resetDeptViewScopeConfig();
      const res = await api('GET', '/api/data', undefined, APPROVER_D);
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '6,7', 'duyet_doc phải thấy CẢ id6 (APPROVED) VÀ id7 (PENDING) của Phòng D');
    });

    await run.run('LỖI ĐÃ VÁ 10/2026: người duyệt "Theo vị trí" (POSITION mode, đúng jobTitle+dept) PHẢI thấy tài liệu cần duyệt của Phòng E', async () => {
      resetData(); resetDeptViewScopeConfig();
      const res = await api('GET', '/api/data', undefined, APPROVER_POSITION_E);
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '9', 'truongphong_e phải thấy id9 (Phòng E, POSITION mode) — đây chính là lỗi đã vá (trước đây luôn rỗng cho mọi POSITION mode)');
    });

    await run.run('Cùng chức danh nhưng KHÁC phòng ban (không khớp cặp jobTitle+dept) KHÔNG được coi là approver — không rò rỉ chéo phòng ban', async () => {
      resetData(); resetDeptViewScopeConfig();
      const res = await api('GET', '/api/data', undefined, NOT_APPROVER_SAME_JOBTITLE_OTHER_DEPT);
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '', 'truongphong_f (Phòng F, cùng jobTitle nhưng cấu hình POSITION mode yêu cầu ĐÚNG dept Phòng E) KHÔNG được thấy id9');
    });

    await run.run('admin: nhận ĐỦ toàn công ty', async () => {
      resetData(); resetDeptViewScopeConfig();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      const ids = (res.body.docs || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,2,3,4,5,6,7,8,9', 'admin phải thấy đủ cả 9 tài liệu');
    });

    await run.run('dù nhánh tải trả THỪA (giả lập lỗi tầng dưới), filterDocsForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData(); resetDeptViewScopeConfig();
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
