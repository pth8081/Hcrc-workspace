'use strict';

// tests/test-secondarypositions-rename-cascade.js
//
// LỖI ĐÃ VÁ (re-audit lần 5, mức Cao): users[].secondaryPositions[]/employeeProfiles[].secondaryPositions[]
// ("Vị Trí Kiêm Nhiệm" — mỗi phần tử {positionKey, jobTitle, dept, positionLabel, ...} SNAPSHOT từ 1
// node Cơ Cấu Tổ Chức NGAY LÚC GÁN, xem applyProfileEdit() case 'secondaryPositions' ở
// lib/employeeProfile.js) hoàn toàn bị bỏ sót khỏi MỌI cascade đổi tên danh mục (depts/stores/
// jobTitles/storeJobTitles) — khác vị trí CHÍNH THỨC (user.dept/jobTitle + employeeProfiles.dept/
// jobTitle) đã cascade đúng từ trước. resolvePositionApprovers() (lib/positionApprovers.js, so khớp
// CHUỖI THÔ dept/jobTitle với secondaryPositions[]) không còn nhận ra người kiêm nhiệm sau khi đổi tên
// -> bước duyệt "Theo vị trí" treo ĐÚNG với người kiêm nhiệm (người giữ chức vụ chính thức không bị
// ảnh hưởng), headcountReport() đếm sai đầu người theo node.
//
// Đã vá: cascadePositionPairs() (lib/catalogRename.js, dùng chung bởi cả 4 hàm cascade dept/store/
// jobTitle/storeJobTitle rename) nay gọi thêm cascadeSecondaryPositions() — cascade cả users[] VÀ
// employeeProfiles[].
//
// Cùng khuôn test-budgetperiods-dept-rename-cascade.js (gọi THẲNG router thực routes/adminCatalog.js,
// giả lập lib/appData + lib/recordStore).
//
// Chạy: node server/tests/test-secondarypositions-rename-cascade.js
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

function resetState() {
  APP_DATA = {
    depts: ['Phòng IT', 'Phòng Nhân Sự'],
    stores: ['Siêu Thị A'],
    jobTitles: ['Nhân viên', 'Trưởng Phòng'],
    storeJobTitles: [{ key: 'gdst', label: 'Giám Đốc Siêu Thị' }],
    deptWorkflows: {}, submissionDeptWorkflows: {}, contractApprovalDeptWorkflows: {}, contractManageDeptWorkflows: {},
    carDeptWorkflows: {}, officeBuyDeptWorkflows: {}, officeFixDeptWorkflows: {}, vppDeptWorkflows: {},
    itPriceDeptWorkflows: {}, budgetDeptWorkflows: {}, budgetApprovedDeptWorkflows: {}, paymentDeptWorkflows: {},
    meetingDeptWorkflows: {},
    submissionTypeDeptWorkflows: {}, itPriceTierWorkflows: {}, operationOrderStoreTierWorkflows: {}, operationOrderHOTierWorkflows: {},
    workflowParticipatingDepts: [], workflowParticipatingDeptGroups: [], workflowParticipatingPositions: [],
    vppExcludedJobTitles: [], orgChartVersions: [], operationOrderStoreMixedApprovalRules: [],
    deptAbbrs: {}, reportPeriods: [], contractExpiryDeptContacts: {},
    users: [
      {
        username: 'nv1', dept: 'Phòng IT', jobTitle: 'Nhân viên', posType: undefined,
        secondaryPositions: [
          { id: 'sp1', positionKey: 'p1', jobTitle: 'Trưởng Phòng', dept: 'Phòng Nhân Sự', positionLabel: 'Trưởng Phòng Nhân Sự' }
        ]
      },
      {
        // KHÔNG liên quan tới "Phòng Nhân Sự"/"Trưởng Phòng" — đối chứng không bị đụng oan.
        username: 'nv2', dept: 'Phòng IT', jobTitle: 'Nhân viên',
        secondaryPositions: [
          { id: 'sp2', positionKey: 'p2', jobTitle: 'Giám Đốc Siêu Thị', dept: 'Siêu Thị A', positionLabel: 'GĐ Siêu Thị A' }
        ]
      }
    ],
    employeeProfiles: [
      {
        username: 'nv1', dept: 'Phòng IT', jobTitle: 'Nhân viên',
        secondaryPositions: [
          { id: 'sp1', positionKey: 'p1', jobTitle: 'Trưởng Phòng', dept: 'Phòng Nhân Sự', positionLabel: 'Trưởng Phòng Nhân Sự' }
        ]
      },
      {
        username: 'nv2', dept: 'Phòng IT', jobTitle: 'Nhân viên',
        secondaryPositions: [
          { id: 'sp2', positionKey: 'p2', jobTitle: 'Giám Đốc Siêu Thị', dept: 'Siêu Thị A', positionLabel: 'GĐ Siêu Thị A' }
        ]
      }
    ]
  };
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
  renameFieldValueInCollection: async () => {} // không collection nào trong phạm vi test này
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

  await run('depts: đổi tên "Phòng Nhân Sự" -> cascade secondaryPositions[].dept ở CẢ users VÀ employeeProfiles', async () => {
    resetState();
    const res = await renameApi('depts', 'Phòng Nhân Sự', 'Phòng Nhân Sự Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const u1 = APP_DATA.users.find(u => u.username === 'nv1');
    const p1 = APP_DATA.employeeProfiles.find(p => p.username === 'nv1');
    assert.strictEqual(u1.secondaryPositions[0].dept, 'Phòng Nhân Sự Mới', 'users[].secondaryPositions[].dept phải đổi theo');
    assert.strictEqual(p1.secondaryPositions[0].dept, 'Phòng Nhân Sự Mới', 'employeeProfiles[].secondaryPositions[].dept phải đổi theo');
    assert.strictEqual(u1.secondaryPositions[0].jobTitle, 'Trưởng Phòng', 'jobTitle không liên quan, phải giữ nguyên');
    const u2 = APP_DATA.users.find(u => u.username === 'nv2');
    assert.strictEqual(u2.secondaryPositions[0].dept, 'Siêu Thị A', 'nv2 không liên quan tới "Phòng Nhân Sự" — không bị đụng oan');
  });

  await run('jobTitles: đổi tên "Trưởng Phòng" -> cascade secondaryPositions[].jobTitle ở CẢ users VÀ employeeProfiles', async () => {
    resetState();
    const res = await renameApi('jobTitles', 'Trưởng Phòng', 'Trưởng Phòng Ban');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const u1 = APP_DATA.users.find(u => u.username === 'nv1');
    const p1 = APP_DATA.employeeProfiles.find(p => p.username === 'nv1');
    assert.strictEqual(u1.secondaryPositions[0].jobTitle, 'Trưởng Phòng Ban', 'users[].secondaryPositions[].jobTitle phải đổi theo');
    assert.strictEqual(p1.secondaryPositions[0].jobTitle, 'Trưởng Phòng Ban', 'employeeProfiles[].secondaryPositions[].jobTitle phải đổi theo');
    assert.strictEqual(u1.secondaryPositions[0].dept, 'Phòng Nhân Sự', 'dept không liên quan, phải giữ nguyên');
    const u2 = APP_DATA.users.find(u => u.username === 'nv2');
    assert.strictEqual(u2.secondaryPositions[0].jobTitle, 'Giám Đốc Siêu Thị', 'nv2 không liên quan tới "Trưởng Phòng" — không bị đụng oan');
  });

  await run('storeJobTitles: đổi tên "Giám Đốc Siêu Thị" -> cascade secondaryPositions[].jobTitle (dùng chung hàm, không phân biệt HO/Siêu Thị)', async () => {
    resetState();
    const res = await renameApi('storeJobTitles', 'Giám Đốc Siêu Thị', 'Giám Đốc Siêu Thị Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const u2 = APP_DATA.users.find(u => u.username === 'nv2');
    const p2 = APP_DATA.employeeProfiles.find(p => p.username === 'nv2');
    assert.strictEqual(u2.secondaryPositions[0].jobTitle, 'Giám Đốc Siêu Thị Mới');
    assert.strictEqual(p2.secondaryPositions[0].jobTitle, 'Giám Đốc Siêu Thị Mới');
  });

  await run('stores: đổi tên "Siêu Thị A" -> cascade secondaryPositions[].dept (dùng chung field dept/store)', async () => {
    resetState();
    const res = await renameApi('stores', 'Siêu Thị A', 'Siêu Thị A Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const u2 = APP_DATA.users.find(u => u.username === 'nv2');
    const p2 = APP_DATA.employeeProfiles.find(p => p.username === 'nv2');
    assert.strictEqual(u2.secondaryPositions[0].dept, 'Siêu Thị A Mới');
    assert.strictEqual(p2.secondaryPositions[0].dept, 'Siêu Thị A Mới');
  });

  await run('Vị trí CHÍNH THỨC (user.dept/jobTitle) vẫn cascade đúng như cũ, không regression', async () => {
    resetState();
    await renameApi('depts', 'Phòng IT', 'Phòng Công Nghệ Thông Tin');
    const u1 = APP_DATA.users.find(u => u.username === 'nv1');
    assert.strictEqual(u1.dept, 'Phòng Công Nghệ Thông Tin');
  });

  server.close();
  console.log('');
  console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
})();
