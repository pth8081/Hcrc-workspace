'use strict';

// tests/test-itsupportticket-dept-rename-cascade.js
//
// LOI DA VA (re-audit lan 4, muc TB-Thap): itSupportTickets (Ho Tro Yeu Cau IT, forceOwnDept — xem
// lib/createValidation.js) luu field "dept" NHUNG truoc day KHONG co trong DEPT_FIELD_COLLECTIONS
// (lib/catalogRename.js) — doi ten 1 phong ban/sieu thi KHONG cascade sang field nay.
// canViewItSupportTicket() (lib/recordViewScope.js) so truc tiep `item.dept === user.dept` (nhanh
// "cung phong ban tu dong xem", deptAutoViewOn('itTicket')) de cho xem ticket CUA CA phong ban (khong
// rieng nguoi tao) — doi ten phong ban ma khong cascade se lam cac ticket CU cua phong ban do "bien
// mat" khoi man hinh cua dong nghiep (dept cu khong con khop user.dept moi), chi chinh nguoi tao
// (item.creator)/approver van xem duoc binh thuong qua nhanh rieng.
//
// Cung khuon test-reportentries-dept-rename-cascade.js (goi THANG router thuc routes/adminCatalog.js,
// gia lap lib/appData + lib/recordStore + middleware requireAuth/isCurrentlyAdmin).
//
// Chay: node server/tests/test-itsupportticket-dept-rename-cascade.js
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
let IT_TICKETS = [];

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
    deptAbbrs: {}, reportPeriods: [], budgetPeriods: [], contractExpiryDeptContacts: {}
  };
  IT_TICKETS = [
    { id: 1, dept: 'Phòng IT', creator: 'nv1', status: 'TODO' },
    { id: 2, dept: 'Phòng IT', creator: 'nv2', status: 'DOING' },
    { id: 3, dept: 'Phòng Nhân Sự', creator: 'nv3', status: 'TODO' } // phòng ban khác — không được đụng
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
    if (collection !== 'itSupportTickets') return; // ngoài phạm vi test này
    IT_TICKETS = IT_TICKETS.map(item => mutateFn(item));
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

  await run('depts: đổi tên "Phòng IT" -> cascade itSupportTickets.dept của CẢ 2 dòng (TODO + DOING)', async () => {
    resetState();
    const res = await renameApi('depts', 'Phòng IT', 'Phòng Công Nghệ Thông Tin');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(IT_TICKETS.find(t => t.id === 1).dept, 'Phòng Công Nghệ Thông Tin');
    assert.strictEqual(IT_TICKETS.find(t => t.id === 2).dept, 'Phòng Công Nghệ Thông Tin');
    assert.strictEqual(IT_TICKETS.find(t => t.id === 3).dept, 'Phòng Nhân Sự', 'phòng ban KHÁC không bị đụng');
  });

  await run('stores: đổi tên siêu thị cũng cascade itSupportTickets.dept (dùng chung field dept/store)', async () => {
    resetState();
    IT_TICKETS.push({ id: 4, dept: 'Siêu Thị A', creator: 'nv4', status: 'TODO' });
    const res = await renameApi('stores', 'Siêu Thị A', 'Siêu Thị A Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(IT_TICKETS.find(t => t.id === 4).dept, 'Siêu Thị A Mới');
  });

  await run('đổi tên phòng ban KHÔNG tồn tại trong itSupportTickets nào -> không đổi gì, idempotent, không throw', async () => {
    resetState();
    const res = await renameApi('depts', 'Phòng Nhân Sự', 'Phòng Nhân Sự Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(IT_TICKETS.find(t => t.id === 1).dept, 'Phòng IT', 'dòng không liên quan giữ nguyên');
    assert.strictEqual(IT_TICKETS.find(t => t.id === 3).dept, 'Phòng Nhân Sự Mới');
  });

  server.close();
  console.log('');
  console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
})();
