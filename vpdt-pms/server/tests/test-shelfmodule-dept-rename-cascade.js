'use strict';

// tests/test-shelfmodule-dept-rename-cascade.js
//
// LOI DA VA (nghien cuu mo rong Audit, 11/2026): shelfLocations/shelfRecords/shelfStockThresholds
// (module "Kiem Soat Hang Hoa", forceOwnDept -- xem lib/createValidation.js) luu field "dept" NHUNG
// truoc day KHONG co trong DEPT_FIELD_COLLECTIONS (lib/catalogRename.js) -- doi ten 1 Sieu Thi KHONG
// cascade sang 3 collection nay. canViewShelfLocation()/canViewShelfRecord()/canViewShelfStockThreshold()
// (lib/recordViewScope.js) so truc tiep `item.dept === user.dept` -- doi ten sieu thi ma khong cascade se
// lam TOAN BO du lieu Kiem Soat Hang Hoa cua sieu thi do "bien mat" khoi man hinh nhan vien sieu thi.
//
// Ngoai ra shelfReconExtraRecipients ({[storeName]: [username,...]}) truoc day cung KHONG co trong
// DEPT_KEYED_APPDATA_MAP_KEYS -- doi ten sieu thi khong doi duoc chinh KHOA cua map nay.
//
// Cung khuon test-itsupportticket-dept-rename-cascade.js (goi THANG router thuc routes/adminCatalog.js).
//
// Chay: node server/tests/test-shelfmodule-dept-rename-cascade.js
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
let SHELF_LOCATIONS = [];
let SHELF_RECORDS = [];
let SHELF_THRESHOLDS = [];

function resetState() {
  APP_DATA = {
    depts: ['Phòng IT'],
    stores: ['Siêu Thị A', 'Siêu Thị B'],
    deptWorkflows: {}, submissionDeptWorkflows: {}, contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
    carDeptWorkflows: {}, officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {}, vppDeptWorkflows: {},
    itPriceDeptWorkflows: {}, budgetDeptWorkflows: {}, budgetApprovedDeptWorkflows: {}, paymentDeptWorkflows: {},
    meetingDeptWorkflows: {},
    submissionTypeDeptWorkflows: {}, itPriceTierWorkflows: {}, operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {},
    workflowParticipatingDepts: [], workflowParticipatingDeptGroups: [], workflowParticipatingPositions: [],
    users: [], employeeProfiles: [], vppExcludedJobTitles: [], orgChartVersions: [], operationOrderStoreMixedApprovalRules: [],
    deptAbbrs: {}, reportPeriods: [], budgetPeriods: [], contractExpiryDeptContacts: {}, storeTypes: {},
    shelfReconExtraRecipients: { 'Siêu Thị A': ['nv1', 'nv2'], 'Siêu Thị B': ['nv3'] }
  };
  SHELF_LOCATIONS = [
    { id: 1, dept: 'Siêu Thị A', code: 'K01', name: 'Kệ 01' },
    { id: 2, dept: 'Siêu Thị B', code: 'K01', name: 'Kệ 01' } // siêu thị khác — không được đụng
  ];
  SHELF_RECORDS = [
    { id: 1, dept: 'Siêu Thị A', shelfLocationId: 1, productName: 'Sữa' },
    { id: 2, dept: 'Siêu Thị B', shelfLocationId: 2, productName: 'Sữa' }
  ];
  SHELF_THRESHOLDS = [
    { id: 1, dept: 'Siêu Thị A', maHang: 'SP001' },
    { id: 2, dept: 'Siêu Thị B', maHang: 'SP001' }
  ];
}
resetState();

const COLLECTIONS = { shelfLocations: () => SHELF_LOCATIONS, shelfRecords: () => SHELF_RECORDS, shelfStockThresholds: () => SHELF_THRESHOLDS };

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
    if (collection === 'shelfLocations') { SHELF_LOCATIONS = SHELF_LOCATIONS.map(item => mutateFn(item)); return; }
    if (collection === 'shelfRecords') { SHELF_RECORDS = SHELF_RECORDS.map(item => mutateFn(item)); return; }
    if (collection === 'shelfStockThresholds') { SHELF_THRESHOLDS = SHELF_THRESHOLDS.map(item => mutateFn(item)); return; }
    // ngoài phạm vi test này
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

  for (const [name, getter] of Object.entries(COLLECTIONS)) {
    await run(`stores: đổi tên "Siêu Thị A" -> cascade ${name}.dept (Siêu Thị B không bị đụng)`, async () => {
      resetState();
      const res = await renameApi('stores', 'Siêu Thị A', 'Siêu Thị A Mới');
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(getter().find(it => it.id === 1).dept, 'Siêu Thị A Mới');
      assert.strictEqual(getter().find(it => it.id === 2).dept, 'Siêu Thị B', 'siêu thị khác giữ nguyên');
    });
  }

  await run('stores: đổi tên siêu thị -> cascade KHOÁ map shelfReconExtraRecipients', async () => {
    resetState();
    const res = await renameApi('stores', 'Siêu Thị A', 'Siêu Thị A Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(APP_DATA.shelfReconExtraRecipients['Siêu Thị A Mới'], ['nv1', 'nv2']);
    assert.ok(!('Siêu Thị A' in APP_DATA.shelfReconExtraRecipients), 'khoá cũ không còn');
    assert.deepStrictEqual(APP_DATA.shelfReconExtraRecipients['Siêu Thị B'], ['nv3'], 'siêu thị khác giữ nguyên');
  });

  await run('đổi tên siêu thị KHÔNG có dữ liệu Kiểm Soát Hàng Hóa nào -> không đổi gì, idempotent, không throw', async () => {
    resetState();
    APP_DATA.stores.push('Siêu Thị Chưa Có Dữ Liệu');
    const res = await renameApi('stores', 'Siêu Thị Chưa Có Dữ Liệu', 'Siêu Thị Chưa Có Dữ Liệu Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(SHELF_LOCATIONS.find(it => it.id === 1).dept, 'Siêu Thị A', 'không bị đụng');
  });

  server.close();
  console.log('');
  console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
})();
