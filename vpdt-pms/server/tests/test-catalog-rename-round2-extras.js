'use strict';

// tests/test-catalog-rename-round2-extras.js
//
// Regression test cho 3 phát hiện cascade đổi tên phòng ban/siêu thị CÒN THIẾU, đợt audit chuyên sâu
// cụm "Hệ Thống / Admin / Cấu Hình" (audit vòng 2) — KHÁC test-catalog-rename-position-pairs.js (map
// đổi TÊN — approversByPosition/key tầng 2), 3 mục dưới đây đơn giản hơn (không lồng "Theo vị trí"):
//
//   #6 (TB)  contractExpiryDeptContacts {[dept]: [{name,email}]} — người phụ trách phòng ban nhận email
//            nhắc hạn hợp đồng (jobs/contractExpiryReminder.js) không được cascade khi đổi tên phòng
//            ban -> ÂM THẦM ngừng nhận email nhắc hạn.
//   #7 (TB)  workflowParticipatingDepts (MẢNG chuỗi tên phòng ban, KHÔNG phải map) — lọc bớt danh sách
//            phòng ban hiện ở màn "🔄 Quy Trình & Phê Duyệt" — không cascade -> phòng ban biến mất khỏi
//            màn cấu hình dù cấu hình bên trong đã được dời đúng.
//   [GỘP]    budgetLines (Ngân Sách 2.0) — collection MỚI (thay budgetEntries cho MỌI màn nhập liệu),
//            lưu CẢ 2 field "dept" VÀ "location" cần cascade cùng lúc — trước đây KHÔNG có trong
//            DEPT_FIELD_COLLECTIONS (chỉ có budgetEntries kiểu cũ).
//
// Cùng khuôn tests/test-catalog-rename-position-pairs.js (gọi THẲNG router thật routes/adminCatalog.js,
// chỉ giả lập lib/appData + lib/recordStore + middleware requireAuth/isCurrentlyAdmin).
//
// Chạy: node server/tests/test-catalog-rename-round2-extras.js
const http = require('http');
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const ADMIN = { username: 'admin1', perms: { admin: true } };
let APP_DATA = {};

// budgetLines giả lập theo dbo.Records (renameFieldValueInCollection() thật gọi mutateFn(item) trên
// TỪNG bản ghi rồi ghi lại nếu != item cũ) — mock lại ĐÚNG hành vi đó cho collection 'budgetLines',
// các collection khác không thuộc phạm vi test này giữ nguyên (no-op, như file test anh em).
let BUDGET_LINES = [];
function resetState() {
  APP_DATA = {
    depts: ['Phòng IT', 'Phòng Nhân Sự'],
    stores: ['Siêu Thị A'],
    contractExpiryDeptContacts: {
      'Phòng IT': [{ name: 'Chị A', email: 'a@hcrc.vn' }],
      'Phòng Nhân Sự': [{ name: 'Anh B', email: 'b@hcrc.vn' }]
    },
    workflowParticipatingDepts: ['Phòng IT', 'Phòng Nhân Sự', 'Siêu Thị A'],
    // *DeptWorkflows/positionPairs/orgChart/employeeProfiles/users... không cần cho phạm vi test này —
    // các hàm cascade tương ứng tự no-op nếu key/danh sách rỗng, không throw.
    deptWorkflows: {}, submissionDeptWorkflows: {}, contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
    carDeptWorkflows: {}, officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {}, vppDeptWorkflows: {},
    itPriceDeptWorkflows: {}, budgetDeptWorkflows: {}, paymentDeptWorkflows: {},
    submissionTypeDeptWorkflows: {}, itPriceTierWorkflows: {}, operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {},
    workflowParticipatingPositions: [],
    users: [], employeeProfiles: [], vppExcludedJobTitles: [], orgChartVersions: [], operationOrderStoreMixedApprovalRules: [],
    deptAbbrs: {}, reportPeriods: [], budgetPeriods: []
  };
  BUDGET_LINES = [
    { id: 1, dept: 'Phòng IT', location: 'HO', stage: 'PROPOSED' },          // HO: dept="Phòng IT", location="HO" (KHÔNG đổi location)
    { id: 2, dept: 'Siêu Thị A', location: 'Siêu Thị A', stage: 'USED' },    // Siêu Thị: dept = location = "Siêu Thị A" (CẢ 2 field đổi)
    { id: 3, dept: 'Phòng Nhân Sự', location: 'HO', stage: 'APPROVED' }     // phòng ban KHÁC — không được đụng khi đổi tên "Phòng IT"
  ];
}

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  withLockedAppDataValue: async (key, fn) => {
    const updated = await fn(APP_DATA[key]);
    APP_DATA[key] = updated;
    return updated;
  }
});
stubModule('lib/recordStore', {
  renameFieldValueInCollection: async (collection, mutateFn) => {
    if (collection !== 'budgetLines') return; // ngoài phạm vi test này
    BUDGET_LINES = BUDGET_LINES.map(item => mutateFn(item));
  }
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => { req.user = ADMIN; next(); },
  blockIfMustChangePassword: (req, res, next) => next()
});
stubModule('lib/adminAuth', { isCurrentlyAdmin: async (username) => username === ADMIN.username });

const express = require('express');
const adminCatalogRoutes = require('../routes/adminCatalog');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminCatalogRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function renameApi(catalogKey, oldValue, newValue) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/admin/renameCatalogEntry`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ catalogKey, oldValue, newValue })
  });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}

let passed = 0, failed = 0;
async function run(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

(async () => {
  const server = await startApp();

  await run('#6 depts: đổi tên -> DỜI ĐÚNG key contractExpiryDeptContacts (người phụ trách nhận email nhắc hạn HĐ)', async () => {
    resetState();
    const res = await renameApi('depts', 'Phòng IT', 'Phòng Công Nghệ Thông Tin');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(APP_DATA.contractExpiryDeptContacts['Phòng Công Nghệ Thông Tin'], [{ name: 'Chị A', email: 'a@hcrc.vn' }], 'liên hệ phải dời sang key tên mới');
    assert.strictEqual(APP_DATA.contractExpiryDeptContacts['Phòng IT'], undefined, 'key CŨ phải biến mất');
    assert.deepStrictEqual(APP_DATA.contractExpiryDeptContacts['Phòng Nhân Sự'], [{ name: 'Anh B', email: 'b@hcrc.vn' }], 'phòng ban KHÁC không bị đụng');
  });

  await run('#6 stores: đổi tên siêu thị cũng cascade contractExpiryDeptContacts (dùng chung 1 field dept/store)', async () => {
    resetState();
    APP_DATA.contractExpiryDeptContacts['Siêu Thị A'] = [{ name: 'GĐ Siêu Thị A', email: 'gd@hcrc.vn' }];
    const res = await renameApi('stores', 'Siêu Thị A', 'Siêu Thị A Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(APP_DATA.contractExpiryDeptContacts['Siêu Thị A Mới'], [{ name: 'GĐ Siêu Thị A', email: 'gd@hcrc.vn' }]);
    assert.strictEqual(APP_DATA.contractExpiryDeptContacts['Siêu Thị A'], undefined);
  });

  await run('#7 depts: đổi tên -> cập nhật GIÁ TRỊ trong mảng workflowParticipatingDepts (không phải key)', async () => {
    resetState();
    const res = await renameApi('depts', 'Phòng IT', 'Phòng Công Nghệ Thông Tin');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(APP_DATA.workflowParticipatingDepts, ['Phòng Công Nghệ Thông Tin', 'Phòng Nhân Sự', 'Siêu Thị A'],
      'phần tử mang tên CŨ phải đổi thành tên MỚI, giữ nguyên vị trí + các phần tử khác');
  });

  await run('#7 stores: đổi tên siêu thị cũng cập nhật đúng giá trị trong mảng (không đụng phòng ban)', async () => {
    resetState();
    const res = await renameApi('stores', 'Siêu Thị A', 'Siêu Thị A Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(APP_DATA.workflowParticipatingDepts, ['Phòng IT', 'Phòng Nhân Sự', 'Siêu Thị A Mới']);
  });

  await run('[GỘP] budgetLines: đổi tên PHÒNG BAN (HO) -> chỉ field "dept" đổi, "location" GIỮ NGUYÊN "HO"', async () => {
    resetState();
    const res = await renameApi('depts', 'Phòng IT', 'Phòng Công Nghệ Thông Tin');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const line1 = BUDGET_LINES.find(l => l.id === 1);
    assert.strictEqual(line1.dept, 'Phòng Công Nghệ Thông Tin', 'dept phải đổi sang tên mới');
    assert.strictEqual(line1.location, 'HO', 'location của dòng HO KHÔNG được đụng (vẫn là sentinel "HO")');
    const line3 = BUDGET_LINES.find(l => l.id === 3);
    assert.strictEqual(line3.dept, 'Phòng Nhân Sự', 'dòng thuộc phòng ban KHÁC không bị đụng');
  });

  await run('[GỘP] budgetLines: đổi tên SIÊU THỊ -> CẢ 2 field "dept" VÀ "location" đều đổi (dòng Siêu Thị: dept=location=tên siêu thị)', async () => {
    resetState();
    const res = await renameApi('stores', 'Siêu Thị A', 'Siêu Thị A Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const line2 = BUDGET_LINES.find(l => l.id === 2);
    assert.strictEqual(line2.dept, 'Siêu Thị A Mới', 'dept của dòng Siêu Thị phải đổi theo (dept=location cho dòng Siêu Thị)');
    assert.strictEqual(line2.location, 'Siêu Thị A Mới', 'location cũng phải đổi theo');
    const line1 = BUDGET_LINES.find(l => l.id === 1);
    assert.strictEqual(line1.location, 'HO', 'dòng HO không liên quan không bị đụng khi đổi tên SIÊU THỊ');
  });

  server.close();
  console.log('');
  console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
})();
