'use strict';

// tests/test-budgetperiods-dept-rename-cascade.js
//
// LOI DA VA (dot re-audit lan 3, muc Cao): budgetPeriods ("ky ngan sach") co 2 field phong ban HOAN
// TOAN KHAC NHAU — `deptScope` (pham vi phong ban PHAI nop, admin tu chon khi tao ky, DA duoc cascade
// qua renameDeptScopeDepts()) va `dept` (forceOwnDept — snapshot phong ban cua NGUOI TAO ky, xem
// lib/createValidation.js). canViewBudgetPeriod() (lib/recordViewScope.js) lai xet quyen XEM bang field
// THU HAI nay: `item.dept === user.dept`. Truoc day chi co dong cascade cho deptScope — field `dept`
// bi bo sot hoan toan, khien ky ngan sach "bien mat" khoi man hinh cua CA phong ban (tru admin/
// budgetManage/budgetAggregate/budgetReportView) sau khi doi ten phong ban cua nguoi da tao ky do.
//
// Cung khuon test-reportentries-dept-rename-cascade.js / test-catalog-rename-round2-extras.js (goi
// THANG router thuc routes/adminCatalog.js, gia lap lib/appData + lib/recordStore).
//
// Chay: node server/tests/test-budgetperiods-dept-rename-cascade.js
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
let BUDGET_PERIODS = [];

function resetState() {
  APP_DATA = {
    depts: ['Phòng IT', 'Phòng Nhân Sự'],
    stores: ['Siêu Thị A'],
    deptWorkflows: {}, submissionDeptWorkflows: {}, contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
    carDeptWorkflows: {}, officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {}, vppDeptWorkflows: {},
    itPriceDeptWorkflows: {}, budgetDeptWorkflows: {}, budgetApprovedDeptWorkflows: {}, paymentDeptWorkflows: {},
    meetingDeptWorkflows: {},
    submissionTypeDeptWorkflows: {}, itPriceTierWorkflows: {}, operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {},
    workflowParticipatingDepts: [], workflowParticipatingDeptGroups: [], workflowParticipatingPositions: [],
    users: [], employeeProfiles: [], vppExcludedJobTitles: [], orgChartVersions: [], operationOrderStoreMixedApprovalRules: [],
    deptAbbrs: {}, reportPeriods: [], contractExpiryDeptContacts: {}
  };
  BUDGET_PERIODS = [
    // kỳ do người ở "Phòng IT" tạo, phạm vi nộp (deptScope) lại là "Phòng Nhân Sự" — 2 field ĐỘC LẬP,
    // cố ý khác nhau để test không nhầm field này với field kia.
    { id: 1, dept: 'Phòng IT', deptScope: { all: false, depts: ['Phòng Nhân Sự'] }, name: 'Kỳ Q1' },
    { id: 2, dept: 'Phòng Nhân Sự', deptScope: { all: true, depts: [] }, name: 'Kỳ Q2' } // phòng ban khác — không được đụng field dept
  ];
}
resetState();

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
    if (collection !== 'budgetPeriods') return; // ngoài phạm vi test này
    BUDGET_PERIODS = BUDGET_PERIODS.map(item => mutateFn(item));
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

  await run('đổi tên "Phòng IT" -> cascade budgetPeriods.dept (field snapshot người tạo, KHÁC deptScope)', async () => {
    resetState();
    const res = await renameApi('depts', 'Phòng IT', 'Phòng Công Nghệ Thông Tin');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const p1 = BUDGET_PERIODS.find(p => p.id === 1);
    assert.strictEqual(p1.dept, 'Phòng Công Nghệ Thông Tin', 'dept (người tạo) phải đổi theo');
    assert.deepStrictEqual(p1.deptScope, { all: false, depts: ['Phòng Nhân Sự'] }, 'deptScope không liên quan tới "Phòng IT", phải giữ nguyên');
  });

  await run('đổi tên "Phòng Nhân Sự" -> cascade CẢ dept (kỳ id=2) VÀ deptScope.depts (kỳ id=1), không lẫn nhau', async () => {
    resetState();
    const res = await renameApi('depts', 'Phòng Nhân Sự', 'Phòng Nhân Sự Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const p1 = BUDGET_PERIODS.find(p => p.id === 1);
    const p2 = BUDGET_PERIODS.find(p => p.id === 2);
    assert.strictEqual(p1.dept, 'Phòng IT', 'kỳ id=1 dept KHÔNG đổi (người tạo ở Phòng IT, không liên quan)');
    assert.deepStrictEqual(p1.deptScope, { all: false, depts: ['Phòng Nhân Sự Mới'] }, 'kỳ id=1 deptScope PHẢI đổi (phạm vi nộp)');
    assert.strictEqual(p2.dept, 'Phòng Nhân Sự Mới', 'kỳ id=2 dept PHẢI đổi (người tạo ở Phòng Nhân Sự)');
  });

  await run('stores: đổi tên siêu thị cũng cascade budgetPeriods.dept (dùng chung field dept/store)', async () => {
    resetState();
    BUDGET_PERIODS.push({ id: 3, dept: 'Siêu Thị A', deptScope: { all: true, depts: [] }, name: 'Kỳ Siêu Thị' });
    const res = await renameApi('stores', 'Siêu Thị A', 'Siêu Thị A Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(BUDGET_PERIODS.find(p => p.id === 3).dept, 'Siêu Thị A Mới');
  });

  server.close();
  console.log('');
  console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
})();
