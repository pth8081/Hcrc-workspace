'use strict';

// tests/test-catalog-rename-position-pairs.js
//
// LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao): đổi tên Phòng Ban/Chức Danh (POST
// /api/admin/renameCatalogEntry -> lib/catalogRename.js) TRƯỚC ĐÂY chỉ đổi KEY NGOÀI CÙNG của các map
// cấu hình quy trình ({[dept]: <cấu hình>}, cascadeDeptWorkflowMaps()) — KHÔNG đi vào cấu hình LỒNG bên
// trong, nơi bước "Theo vị trí" (POSITION mode) lưu `approversByPosition[stepOrder] = [{jobTitle, dept}]`
// (so khớp CHUỖI THÔ với u.jobTitle/u.dept, xem lib/positionApprovers.js). Sau khi đổi tên:
//   - mọi bước "Theo vị trí" trỏ tên CŨ tra ra 0 approver -> bước treo (chỉ admin duyệt được), ảnh
//     hưởng nhiều module: Hỗ Trợ IT (Bán Lẻ theo dept + Bán Buôn theo tier), Ngân Sách, Vận Hành HO/
//     Siêu Thị (tier), Tài Liệu, Văn Bản Trình (lồng theo LOẠI tờ trình), Xe, VPP, Hợp Đồng, Thanh Toán.
//   - danh mục `workflowParticipatingPositions` ("Vị Trí Tham Gia Quy Trình", nguồn chọn của chính các
//     picker đó) còn giữ cặp mang tên CŨ -> biến mất khỏi gợi ý.
//
// Cùng khuôn tests/test-catalog-rename-server.js (gọi THẲNG router thật routes/adminCatalog.js, chỉ giả
// lập lib/appData + lib/recordStore + middleware requireAuth/isCurrentlyAdmin — không cần DB thật).
//
// Chạy: node server/tests/test-catalog-rename-position-pairs.js
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

// Cấu hình 1 bước "Theo vị trí" cho mọi khuôn map khác nhau đang tồn tại trong hệ thống.
function positionConfig(jobTitle, dept) {
  return {
    workflowId: 'WF_1STEP',
    approvers: { 1: [] },
    approverMode: { 1: 'POSITION' },
    approversByPosition: { 1: [{ jobTitle, dept }] }
  };
}

function resetState() {
  APP_DATA = {
    depts: ['Phòng IT', 'Phòng Nhân Sự'],
    deptAbbrs: {},
    stores: ['Siêu Thị A'],
    jobTitles: ['Trưởng phòng'],
    storeJobTitles: [{ label: 'Giám Đốc Siêu Thị' }],
    users: [{ username: 'u1', dept: 'Phòng IT', jobTitle: 'Trưởng phòng', posType: 'HO', perms: {} }],
    employeeProfiles: [],
    vppExcludedJobTitles: [],
    orgChartVersions: [],
    operationOrderStoreMixedApprovalRules: [],
    workflowParticipatingPositions: [
      { jobTitle: 'Trưởng phòng', dept: 'Phòng IT' },
      { jobTitle: 'Giám Đốc Siêu Thị', dept: 'Siêu Thị A' },
      { jobTitle: 'Trưởng phòng', dept: '' }           // cặp "chỉ chức danh, không ghép phòng"
    ],

    // 1) Map PHẲNG theo phòng ban (đa số module): {dept: cfg}
    deptWorkflows: { 'Phòng IT': positionConfig('Trưởng phòng', 'Phòng IT') },
    budgetDeptWorkflows: { 'Phòng IT': positionConfig('Trưởng phòng', 'Phòng IT') },
    paymentDeptWorkflows: {},
    submissionDeptWorkflows: {},
    contractApprovalDeptWorkflows: {},
    contractManageDeptWorkflows: {},
    carDeptWorkflows: {},
    officeBuyDeptWorkflows: {},
    officeFixDeptWorkflows: {},
    vppDeptWorkflows: {},

    // 2) Hỗ Trợ IT — Bán Lẻ: lồng thêm 1 cấp loại giá {dept: {RETAIL, WHOLESALE}}
    itPriceDeptWorkflows: {
      'Phòng IT': { RETAIL: positionConfig('Trưởng phòng', 'Phòng IT'), WHOLESALE: positionConfig('Giám Đốc Siêu Thị', 'Siêu Thị A') }
    },
    // 3) Hỗ Trợ IT — Bán Buôn: map theo mức {tierKey: cfg}
    itPriceTierWorkflows: { MARGIN_LT5: positionConfig('Trưởng phòng', 'Phòng IT') },
    // 4) Vận Hành — Đơn Hàng: map theo mức giá trị
    operationOrderStoreTierWorkflows: { LT10M: positionConfig('Giám Đốc Siêu Thị', 'Siêu Thị A') },
    operationOrderHOTierWorkflows: { LT100M: positionConfig('Trưởng phòng', 'Phòng IT') },
    // 5) Văn Bản Trình: lồng theo LOẠI tờ trình {typeKey: {dept: cfg}}
    submissionTypeDeptWorkflows: { CHU_TRUONG: { 'Phòng IT': positionConfig('Trưởng phòng', 'Phòng IT') } }
  };
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
  renameFieldValueInCollection: async (collection, mutateFn) => { /* không thuộc phạm vi test này */ }
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

function pairsOf(config) {
  return (config?.approversByPosition?.[1]) || [];
}

let passed = 0, failed = 0;
async function run(name, fn) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); }
  catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

(async () => {
  const server = await startApp();

  await run('jobTitles (HO): cascade approversByPosition[].jobTitle ở MỌI khuôn map (phẳng/lồng loại giá/tier/lồng loại tờ trình)', async () => {
    resetState();
    const res = await renameApi('jobTitles', 'Trưởng phòng', 'Trưởng Phòng Ban');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(pairsOf(APP_DATA.deptWorkflows['Phòng IT'])[0].jobTitle, 'Trưởng Phòng Ban', 'deptWorkflows (Tài Liệu, map phẳng)');
    assert.strictEqual(pairsOf(APP_DATA.budgetDeptWorkflows['Phòng IT'])[0].jobTitle, 'Trưởng Phòng Ban', 'budgetDeptWorkflows (Ngân Sách 1.0)');
    assert.strictEqual(pairsOf(APP_DATA.itPriceDeptWorkflows['Phòng IT'].RETAIL)[0].jobTitle, 'Trưởng Phòng Ban', 'itPriceDeptWorkflows.RETAIL (lồng loại giá)');
    assert.strictEqual(pairsOf(APP_DATA.itPriceTierWorkflows.MARGIN_LT5)[0].jobTitle, 'Trưởng Phòng Ban', 'itPriceTierWorkflows (Bán Buôn theo mức)');
    assert.strictEqual(pairsOf(APP_DATA.operationOrderHOTierWorkflows.LT100M)[0].jobTitle, 'Trưởng Phòng Ban', 'operationOrderHOTierWorkflows (Vận Hành HO)');
    assert.strictEqual(pairsOf(APP_DATA.submissionTypeDeptWorkflows.CHU_TRUONG['Phòng IT'])[0].jobTitle, 'Trưởng Phòng Ban', 'submissionTypeDeptWorkflows (lồng 2 cấp)');
  });

  await run('jobTitles (HO): cascade cả workflowParticipatingPositions[].jobTitle (kể cả cặp KHÔNG ghép phòng ban)', async () => {
    resetState();
    await renameApi('jobTitles', 'Trưởng phòng', 'Trưởng Phòng Ban');
    const list = APP_DATA.workflowParticipatingPositions;
    assert.strictEqual(list[0].jobTitle, 'Trưởng Phòng Ban');
    assert.strictEqual(list[0].dept, 'Phòng IT', 'dept của cặp KHÔNG được đụng tới khi đổi tên chức danh');
    assert.strictEqual(list[2].jobTitle, 'Trưởng Phòng Ban', 'Cặp chỉ-chức-danh (dept rỗng) cũng phải đổi');
    assert.strictEqual(list[1].jobTitle, 'Giám Đốc Siêu Thị', 'Chức danh Siêu Thị khác KHÔNG bị đụng');
  });

  await run('jobTitles: KHÔNG đụng nhầm cặp mang chức danh khác / cấu hình bước PEOPLE', async () => {
    resetState();
    APP_DATA.carDeptWorkflows = { 'Phòng IT': { workflowId: 'WF_1STEP', approvers: { 1: ['u1'] } } };
    await renameApi('jobTitles', 'Trưởng phòng', 'Trưởng Phòng Ban');
    assert.deepStrictEqual(APP_DATA.carDeptWorkflows['Phòng IT'].approvers[1], ['u1'], 'Bước PEOPLE (danh sách username) không được đụng tới');
    assert.strictEqual(pairsOf(APP_DATA.itPriceDeptWorkflows['Phòng IT'].WHOLESALE)[0].jobTitle, 'Giám Đốc Siêu Thị', 'Cặp chức danh Siêu Thị không bị đổi theo rename chức danh HO');
  });

  await run('storeJobTitles (Siêu Thị): cascade approversByPosition[].jobTitle + workflowParticipatingPositions', async () => {
    resetState();
    const res = await renameApi('storeJobTitles', 'Giám Đốc Siêu Thị', 'Giám Đốc ST (Mới)');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(pairsOf(APP_DATA.operationOrderStoreTierWorkflows.LT10M)[0].jobTitle, 'Giám Đốc ST (Mới)');
    assert.strictEqual(pairsOf(APP_DATA.itPriceDeptWorkflows['Phòng IT'].WHOLESALE)[0].jobTitle, 'Giám Đốc ST (Mới)');
    assert.strictEqual(APP_DATA.workflowParticipatingPositions[1].jobTitle, 'Giám Đốc ST (Mới)');
    assert.strictEqual(APP_DATA.workflowParticipatingPositions[0].jobTitle, 'Trưởng phòng', 'Chức danh HO không bị đụng');
  });

  await run('depts (Phòng Ban): cascade approversByPosition[].dept (không đụng jobTitle) ở mọi khuôn map', async () => {
    resetState();
    const res = await renameApi('depts', 'Phòng IT', 'Phòng Công Nghệ Thông Tin');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(pairsOf(APP_DATA.budgetDeptWorkflows['Phòng Công Nghệ Thông Tin'])[0].dept, 'Phòng Công Nghệ Thông Tin',
      'Key ngoài cùng ĐÃ dời đúng từ trước (cascadeDeptWorkflowMaps), cặp BÊN TRONG nay cũng phải đổi theo');
    assert.strictEqual(pairsOf(APP_DATA.budgetDeptWorkflows['Phòng Công Nghệ Thông Tin'])[0].jobTitle, 'Trưởng phòng', 'jobTitle không được đụng khi đổi tên phòng ban');
    // deptWorkflows (Tài Liệu): đợt vá cụm Văn Bản Trình (commit 89a78f5) đã thêm 'deptWorkflows' vào
    // DEPT_WORKFLOW_MAP_KEYS — KEY ngoài cùng nay ĐÃ dời đúng như mọi map khác (khoảng trống cũ đã đóng),
    // cặp "Theo vị trí" bên trong tiếp tục cascade như trước.
    assert.strictEqual(pairsOf(APP_DATA.deptWorkflows['Phòng Công Nghệ Thông Tin'])[0].dept, 'Phòng Công Nghệ Thông Tin');
    assert.strictEqual(APP_DATA.deptWorkflows['Phòng IT'], undefined, 'Key CŨ phải biến mất, không để lại rác');
    assert.strictEqual(pairsOf(APP_DATA.itPriceTierWorkflows.MARGIN_LT5)[0].dept, 'Phòng Công Nghệ Thông Tin', 'Map theo TIER không có key phòng ban -> chỉ cặp bên trong mới cascade được');
    assert.strictEqual(pairsOf(APP_DATA.operationOrderHOTierWorkflows.LT100M)[0].dept, 'Phòng Công Nghệ Thông Tin');
    assert.strictEqual(pairsOf(APP_DATA.submissionTypeDeptWorkflows.CHU_TRUONG['Phòng IT'])[0].dept, 'Phòng Công Nghệ Thông Tin',
      'submissionTypeDeptWorkflows lồng 2 cấp: cặp bên trong vẫn phải đổi (key cấp 2 nằm ngoài phạm vi cascadeDeptWorkflowMaps cũ)');
    assert.strictEqual(APP_DATA.workflowParticipatingPositions[0].dept, 'Phòng Công Nghệ Thông Tin');
    assert.strictEqual(APP_DATA.workflowParticipatingPositions[2].dept, '', 'Cặp chỉ-chức-danh (dept rỗng) không bị gán tên mới oan');
  });

  await run('stores (Siêu Thị): cascade approversByPosition[].dept của cặp trỏ tên siêu thị', async () => {
    resetState();
    const res = await renameApi('stores', 'Siêu Thị A', 'Siêu Thị A Mới');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(pairsOf(APP_DATA.operationOrderStoreTierWorkflows.LT10M)[0].dept, 'Siêu Thị A Mới');
    assert.strictEqual(pairsOf(APP_DATA.itPriceDeptWorkflows['Phòng IT'].WHOLESALE)[0].dept, 'Siêu Thị A Mới');
    assert.strictEqual(APP_DATA.workflowParticipatingPositions[1].dept, 'Siêu Thị A Mới');
    assert.strictEqual(pairsOf(APP_DATA.deptWorkflows['Phòng IT'])[0].dept, 'Phòng IT', 'Phòng ban khác không bị đụng');
  });

  server.close();
  console.log('');
  console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed > 0) process.exitCode = 1;
})();
