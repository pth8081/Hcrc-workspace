'use strict';

// tests/test-vppperiods-dept-rename-cascade.js
//
// LỖI ĐÃ VÁ (re-audit lần 5, mức Cao): vppPeriods.deptHeadcounts/deptBudgetRates CẢ 2 ĐỀU là map
// {dept: number} KHOÁ THEO TÊN PHÒNG BAN (đặt 1 lần lúc tạo kỳ, xem CREATE_MODULE_CONFIGS.vppPeriods ở
// lib/createValidation.js) — hoàn toàn bị bỏ sót khỏi MỌI cascade đổi tên danh mục Phòng Ban/Siêu Thị.
// resolveVppDeptBudget() (lib/vppCatalog.js) tra `period.deptBudgetRates[dept]`/
// `period.deptHeadcounts[dept]` theo ĐÚNG tên phòng ban HIỆN TẠI của người đăng ký — đổi tên 1 phòng
// ban mà không dời khoá sẽ làm quỹ/đầu người CHỐT của phòng đó "biến mất" (tra ra undefined) ngay sau
// khi đổi tên, dù kỳ VPP không hề bị admin sửa gì.
//
// Đã vá: renameVppPeriodDeptKeyedMaps() (lib/catalogRename.js) dời KHOÁ (không phải field) của cả 2
// map, gọi từ cascadeStoreRename() — cùng khuôn renameUniformPeriodAllocations()/renameDeptScopeDepts()
// ngay trên nó.
//
// Cùng khuôn test-budgetperiods-dept-rename-cascade.js (gọi THẲNG router thực routes/adminCatalog.js,
// giả lập lib/appData + lib/recordStore).
//
// Chạy: node server/tests/test-vppperiods-dept-rename-cascade.js
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
let VPP_PERIODS = [];

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
  VPP_PERIODS = [
    {
      id: 1, name: 'Kỳ Q1',
      deptHeadcounts: { 'Phòng IT': 10, 'Phòng Nhân Sự': 5 },
      deptBudgetRates: { 'Phòng Nhân Sự': 150000 } // "Phòng IT" KHÔNG có mức riêng -> dùng perPersonBudget mặc định
    },
    {
      // kỳ KHÔNG liên quan tới "Phòng Nhân Sự" — đối chứng không bị đụng oan.
      id: 2, name: 'Kỳ Q2',
      deptHeadcounts: { 'Siêu Thị A': 8 },
      deptBudgetRates: { 'Siêu Thị A': 200000 }
    }
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
    if (collection !== 'vppPeriods') return; // ngoài phạm vi test này
    VPP_PERIODS = VPP_PERIODS.map(item => mutateFn(item));
  }
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => { req.user = ADMIN; next(); },
  blockIfMustChangePassword: (req, res, next) => next()
});
stubModule('lib/adminAuth', { isCurrentlyAdmin: async (username) => username === ADMIN.username });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

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

  await run('depts: đổi tên "Phòng Nhân Sự" -> dời ĐÚNG khoá trong deptHeadcounts/deptBudgetRates của kỳ id=1, giữ nguyên value', async () => {
    resetState();
    const res = await renameApi('depts', 'Phòng Nhân Sự', 'Phòng Nhân Sự Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const p1 = VPP_PERIODS.find(p => p.id === 1);
    assert.strictEqual(p1.deptHeadcounts['Phòng Nhân Sự Mới'], 5, 'deptHeadcounts phải dời khoá, giữ nguyên số đầu người');
    assert.strictEqual('Phòng Nhân Sự' in p1.deptHeadcounts, false, 'khoá cũ phải bị xoá hẳn, không để lại "mồ côi"');
    assert.strictEqual(p1.deptBudgetRates['Phòng Nhân Sự Mới'], 150000, 'deptBudgetRates phải dời khoá, giữ nguyên mức/người');
    assert.strictEqual('Phòng Nhân Sự' in p1.deptBudgetRates, false, 'khoá cũ phải bị xoá hẳn');
    assert.strictEqual(p1.deptHeadcounts['Phòng IT'], 10, '"Phòng IT" không liên quan, phải giữ nguyên');
  });

  await run('depts: kỳ id=2 KHÔNG liên quan tới "Phòng Nhân Sự" -> không bị đụng oan', async () => {
    resetState();
    await renameApi('depts', 'Phòng Nhân Sự', 'Phòng Nhân Sự Mới');
    const p2 = VPP_PERIODS.find(p => p.id === 2);
    assert.deepStrictEqual(p2.deptHeadcounts, { 'Siêu Thị A': 8 });
    assert.deepStrictEqual(p2.deptBudgetRates, { 'Siêu Thị A': 200000 });
  });

  await run('stores: đổi tên "Siêu Thị A" -> dời khoá trong deptHeadcounts/deptBudgetRates của kỳ id=2 (dùng chung field dept/store)', async () => {
    resetState();
    const res = await renameApi('stores', 'Siêu Thị A', 'Siêu Thị A Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const p2 = VPP_PERIODS.find(p => p.id === 2);
    assert.strictEqual(p2.deptHeadcounts['Siêu Thị A Mới'], 8);
    assert.strictEqual(p2.deptBudgetRates['Siêu Thị A Mới'], 200000);
    assert.strictEqual('Siêu Thị A' in p2.deptHeadcounts, false);
  });

  await run('đổi tên phòng ban KHÔNG tồn tại trong vppPeriods nào -> không đổi gì, idempotent, không throw', async () => {
    resetState();
    const before = JSON.stringify(VPP_PERIODS);
    const res = await renameApi('depts', 'Phòng IT', 'Phòng Công Nghệ Thông Tin');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    // "Phòng IT" chỉ xuất hiện ở deptHeadcounts (không ở deptBudgetRates) của kỳ id=1 — vẫn phải dời đúng khoá đó.
    const p1 = VPP_PERIODS.find(p => p.id === 1);
    assert.strictEqual(p1.deptHeadcounts['Phòng Công Nghệ Thông Tin'], 10);
    assert.notStrictEqual(JSON.stringify(VPP_PERIODS), before);
  });

  server.close();
  console.log('');
  console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
})();
