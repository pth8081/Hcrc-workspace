// server/tests/test-khoi0-parent-cascade-gate.js
//
// Re-audit lần 5 (mức Cao): MODULE_ACCESS_PARENTS (lib/recordViewScope.js, dùng bởi
// hasModuleAccessServer()) trước đây CHỈ khai 5 module con của "hr" (hrProfile/hrAttendance/hrPayroll/
// hrContract/hrLifecycle) — một comment lỗi thời ngay cạnh khẳng định "car/meeting/vpp/budget/orgChart
// đã có quyền chi tiết riêng chặn đúng ở server, không đi qua hasModuleAccessServer()" — ĐÚNG lúc viết,
// nhưng SAI từ lâu: nhiều đợt vá sau đó đã wire cả car/meeting/vpp/license/uniform/budget/orgChart qua
// ĐÚNG hasModuleAccessServer(user, '<module con>'), chỉ riêng việc cascade THEO MODULE CHA (hanhchinh/
// office/hr, xem BUSINESS_MODULES ở public/js/core.js) thì CHƯA ai thêm vào map này.
//
// Hậu quả: admin tắt moduleAccess.hanhchinh (tắt cả CỤM "Hành Chính" 1 lần qua checkbox "Mục 0") nhưng
// KHÔNG tắt riêng từng car/meeting/vpp/license/uniform thì server vẫn cho qua — trong khi client
// hasModuleAccess() (core.js, đi theo chuỗi `parent`) đã khoá đúng cả 5, gây lệch hành vi: UI ẩn hết
// nhưng API vẫn đọc/thao tác được. Tương tự cho office->budget/payment, hr->orgChart.
//
// Đã vá: thêm 3 cặp cha/con vào MODULE_ACCESS_PARENTS — hanhchinh -> car/meeting/vpp/license/uniform,
// office -> budget/payment, hr -> orgChart (payment chưa có hasModuleAccessServer() nào gọi tới, xem
// mục TB riêng #126 "paymentRequests gác sai key 'office' thay vì 'payment'" — entry payment: 'office'
// thêm trước cho đủ, chưa có hành vi nào thay đổi vì chưa ai consult key đó).
//
// Test này KHÔNG lặp lại toàn bộ gate riêng của từng module (đã có ở test-khoi0-carregs-vppregistrations-
// gate.js/test-khoi0-meeting-periodicreport-gate.js/test-khoi0-license-uniform-gate.js/...) — chỉ tập
// trung đúng phần MỚI: tắt module CHA (không tắt riêng module con) phải cascade xuống đúng 6 module con
// đã enforce ở server (car/meeting/vpp/license/uniform/orgChart — budget test riêng ở
// test-khoi0-budget-parent-cascade bên dưới cùng file, orgChart mount router riêng vì không đi qua
// GET /api/data).
//
// Chạy: node server/tests/test-khoi0-parent-cascade-gate.js
'use strict';
const http = require('http');
const path = require('path');
const express = require('express');
const { createRunner, assertEqual } = require('./testHarness');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

// ===== Phần A: GET /api/data — cascade hanhchinh -> car/meeting/vpp/license/uniform, office -> budget =====

// Mỗi user 1 phòng ban RIÊNG (khác hẳn nhau) — tránh lệch kết quả do nhánh "cùng phòng ban tự động
// xem" (mode mặc định DEPT của car/meeting/budget) vô tình cho user NÀY thấy cả bản ghi của user KHÁC,
// gây nhiễu phép so sánh "có/không bị cascade chặn" (biến số DUY NHẤT cần cô lập ở test này).
const NV1_HANHCHINH_OFF = { username: 'nv1', name: 'NV 1', dept: 'Phòng NV1', perms: { uniformManage: true, moduleAccess: { hanhchinh: false } }, active: true };
const NV2_HANHCHINH_ON = { username: 'nv2', name: 'NV 2', dept: 'Phòng NV2', perms: { uniformManage: true, moduleAccess: {} }, active: true };
const NV3_OFFICE_OFF = { username: 'nv3', name: 'NV 3', dept: 'Phòng NV3', perms: { moduleAccess: { office: false } }, active: true };
const NV4_OFFICE_ON = { username: 'nv4', name: 'NV 4', dept: 'Phòng NV4', perms: { moduleAccess: {} }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true, moduleAccess: { hanhchinh: false, office: false } }, active: true };
const ALL_USERS_LIST = [NV1_HANHCHINH_OFF, NV2_HANHCHINH_ON, NV3_OFFICE_OFF, NV4_OFFICE_ON, ADMIN];

let APP_DATA;
function resetData() {
  APP_DATA = { users: ALL_USERS_LIST.map(u => ({ ...u })) };
}
resetData();

// 1 bản ghi mỗi collection CHO TỪNG user (creator = chính họ, cùng dept — đủ đk canView* sẵn có để
// KHÔNG bị lọc bởi lớp canView thường, chỉ còn đúng 1 biến số là Khối 0/cascade cha-con).
function buildFixtures(owner) {
  return {
    carRegs: [{ id: 1, dept: owner.dept, creator: owner.username }],
    meetings: [{ id: 1, dept: owner.dept, creator: owner.username }],
    vppRegistrations: [{ id: 1, dept: owner.dept, creator: owner.username }],
    licenses: [{ id: 1, dept: owner.dept, creator: owner.username }],
    uniformPeriods: [{ id: 1, dept: owner.dept, creator: owner.username, approvalStatus: 'APPROVED', allocations: [] }],
    budgetEntries: [{ id: 1, dept: owner.dept, creator: owner.username }]
  };
}
const FIXTURES_BY_OWNER = {
  nv1: buildFixtures(NV1_HANHCHINH_OFF),
  nv2: buildFixtures(NV2_HANHCHINH_ON),
  nv3: buildFixtures(NV3_OFFICE_OFF),
  nv4: buildFixtures(NV4_OFFICE_ON)
};

// uniformPeriods KHÔNG nằm trong response chính của GET /api/data (đã dời sang nhóm tải lười
// `GET /api/data/lazy/uniform`, xem LAZY_DATA_GROUPS ở routes/data.js) — kiểm riêng ở dưới qua route đó,
// 5 collection còn lại vẫn thuộc response chính như các test car/vpp/meeting/license/budget khác.
const COLLECTIONS = ['carRegs', 'meetings', 'vppRegistrations', 'licenses', 'uniformPeriods', 'budgetEntries'];
const MAIN_DATA_COLLECTIONS = ['carRegs', 'meetings', 'vppRegistrations', 'licenses', 'budgetEntries'];

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(COLLECTIONS),
  getAllForCollectionCached: async (collection) => {
    if (!COLLECTIONS.includes(collection)) return [];
    return Object.values(FIXTURES_BY_OWNER).flatMap(f => f[collection] || []).map(r => ({ ...r }));
  },
  getForCollectionByDeptCached: async (collection, dept) => {
    if (!COLLECTIONS.includes(collection)) return [];
    const all = Object.values(FIXTURES_BY_OWNER).flatMap(f => f[collection] || []);
    return all.filter(r => r.dept === dept).map(r => ({ ...r }));
  },
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async (collection, column, value) => {
    if (!COLLECTIONS.includes(collection) || column !== 'Creator') return [];
    const all = Object.values(FIXTURES_BY_OWNER).flatMap(f => f[collection] || []);
    return all.filter(r => r.creator === value).map(r => ({ ...r }));
  }
});

let CURRENT_USERNAME = NV2_HANHCHINH_ON.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = ALL_USERS_LIST.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p, isBcryptHash: () => false, validatePin: () => null
});

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

async function mainDataPart(run) {
  const server = await startApp();
  try {
    await run.run('MODULE_ACCESS_PARENTS: hanhchinh -> car/meeting/vpp/license/uniform; office -> budget/payment; hr -> orgChart', async () => {
      delete require.cache[require.resolve('../lib/recordViewScope')];
      const { MODULE_ACCESS_PARENTS } = require('../lib/recordViewScope');
      assertEqual(MODULE_ACCESS_PARENTS.car, 'hanhchinh', 'thiếu car->hanhchinh');
      assertEqual(MODULE_ACCESS_PARENTS.meeting, 'hanhchinh', 'thiếu meeting->hanhchinh');
      assertEqual(MODULE_ACCESS_PARENTS.vpp, 'hanhchinh', 'thiếu vpp->hanhchinh');
      assertEqual(MODULE_ACCESS_PARENTS.license, 'hanhchinh', 'thiếu license->hanhchinh');
      assertEqual(MODULE_ACCESS_PARENTS.uniform, 'hanhchinh', 'thiếu uniform->hanhchinh');
      assertEqual(MODULE_ACCESS_PARENTS.budget, 'office', 'thiếu budget->office');
      assertEqual(MODULE_ACCESS_PARENTS.payment, 'office', 'thiếu payment->office');
      assertEqual(MODULE_ACCESS_PARENTS.orgChart, 'hr', 'thiếu orgChart->hr');
    });

    await run.run('LỖI ĐÃ VÁ: tắt moduleAccess.hanhchinh (KHÔNG tắt riêng car/meeting/vpp/license) -> cả 4 collection RỖNG (cascade cha->con)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, NV1_HANHCHINH_OFF);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual((res.body.carRegs || []).length, 0, 'carRegs phải bị cascade chặn qua hanhchinh');
      assertEqual((res.body.meetings || []).length, 0, 'meetings phải bị cascade chặn qua hanhchinh');
      assertEqual((res.body.vppRegistrations || []).length, 0, 'vppRegistrations phải bị cascade chặn qua hanhchinh');
      assertEqual((res.body.licenses || []).length, 0, 'licenses phải bị cascade chặn qua hanhchinh');
    });

    await run.run('LỖI ĐÃ VÁ: tắt moduleAccess.hanhchinh -> GET /api/data/lazy/uniform (uniformPeriods) CŨNG RỖNG (cascade cha->con)', async () => {
      resetData();
      const res = await api('GET', '/api/data/lazy/uniform', undefined, NV1_HANHCHINH_OFF);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual((res.body.uniformPeriods || []).length, 0, 'uniformPeriods phải bị cascade chặn qua hanhchinh');
    });

    await run.run('moduleAccess.hanhchinh KHÔNG bị tắt -> cả 4 collection vẫn thấy bình thường (không cascade oan)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, NV2_HANHCHINH_ON);
      assertEqual((res.body.carRegs || []).length, 1, 'carRegs không bị chặn oan');
      assertEqual((res.body.meetings || []).length, 1, 'meetings không bị chặn oan');
      assertEqual((res.body.vppRegistrations || []).length, 1, 'vppRegistrations không bị chặn oan');
      assertEqual((res.body.licenses || []).length, 1, 'licenses không bị chặn oan');
    });

    await run.run('moduleAccess.hanhchinh KHÔNG bị tắt -> GET /api/data/lazy/uniform (uniformPeriods) vẫn thấy bình thường', async () => {
      resetData();
      const res = await api('GET', '/api/data/lazy/uniform', undefined, NV2_HANHCHINH_ON);
      // uniformManage xem được MỌI phòng ban theo thiết kế (canViewUniformPeriod() không có nhánh dept
      // riêng cho quyền này) — chỉ cần > 0 (không bị zero-out oan), không so khớp đúng 1 bản ghi cụ thể
      // như các collection dept-scoped khác ở trên.
      assertEqual((res.body.uniformPeriods || []).length > 0, true, 'uniformPeriods không bị chặn oan');
    });

    await run.run('LỖI ĐÃ VÁ: tắt moduleAccess.office (KHÔNG tắt riêng budget) -> budgetEntries RỖNG (cascade cha->con)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, NV3_OFFICE_OFF);
      assertEqual((res.body.budgetEntries || []).length, 0, 'budgetEntries phải bị cascade chặn qua office');
    });

    await run.run('moduleAccess.office KHÔNG bị tắt -> budgetEntries vẫn thấy bình thường (không cascade oan)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, NV4_OFFICE_ON);
      assertEqual((res.body.budgetEntries || []).length, 1, 'budgetEntries không bị chặn oan');
    });

    await run.run('admin luôn bỏ qua moduleAccess (dù tắt CẢ hanhchinh+office) -> vẫn thấy toàn bộ 5 collection ở GET /api/data', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      for (const col of MAIN_DATA_COLLECTIONS) {
        assertEqual((res.body[col] || []).length >= 1, true, `admin phải luôn thấy ${col} dù moduleAccess.hanhchinh/office=false`);
      }
    });

    await run.run('admin luôn bỏ qua moduleAccess (dù tắt hanhchinh) -> vẫn thấy uniformPeriods ở GET /api/data/lazy/uniform', async () => {
      resetData();
      const res = await api('GET', '/api/data/lazy/uniform', undefined, ADMIN);
      assertEqual((res.body.uniformPeriods || []).length >= 1, true, 'admin phải luôn thấy uniformPeriods dù moduleAccess.hanhchinh=false');
    });
  } finally {
    server.close();
  }
}

// ===== Phần B: routes/orgChart.js — cascade hr -> orgChart (router riêng, không qua GET /api/data) =====

async function mainOrgChartPart(run) {
  delete require.cache[require.resolve('../lib/auth')];
  delete require.cache[require.resolve('../lib/appData')];
  delete require.cache[require.resolve('../lib/recordStore')];
  delete require.cache[require.resolve('../routes/orgChart')];
  delete require.cache[require.resolve('../lib/recordViewScope')];

  const HR_OFF = { username: 'nv5', name: 'NV 5', dept: 'Phòng Nhân Sự', perms: { orgChartManage: true, moduleAccess: { hr: false } }, active: true };
  const HR_ON = { username: 'nv6', name: 'NV 6', dept: 'Phòng Nhân Sự', perms: { orgChartManage: true, moduleAccess: {} }, active: true };
  const ORG_USERS = [HR_OFF, HR_ON];

  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key === 'orgChartVersions' ? [] : null),
    withLockedAppDataValue: async (key, fn) => fn([])
  });
  stubModule('lib/recordStore', { getAllForCollection: async () => [] });

  let currentOrgUsername = HR_ON.username;
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const fresh = ORG_USERS.find(u => u.username === currentOrgUsername);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next(),
    hashPassword: async (p) => p, isBcryptHash: () => false, validatePin: () => null
  });

  const orgChartRoutes = require('../routes/orgChart');
  const app = express();
  app.use(express.json());
  app.use('/api/org-chart', orgChartRoutes);
  const server = await new Promise((resolve, reject) => {
    const s = http.createServer(app);
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;

  async function orgApi(urlPath, asUser) {
    currentOrgUsername = asUser.username;
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`);
    let payload = null;
    try { payload = await res.json(); } catch (e) { payload = null; }
    return { status: res.status, body: payload };
  }

  try {
    await run.run('LỖI ĐÃ VÁ: tắt moduleAccess.hr (KHÔNG tắt riêng orgChart) -> GET /api/org-chart/versions bị chặn 403 (cascade cha->con)', async () => {
      const res = await orgApi('/api/org-chart/versions', HR_OFF);
      assertEqual(res.status, 403, 'phải trả 403 vì module cha "hr" đang tắt');
    });

    await run.run('moduleAccess.hr KHÔNG bị tắt -> GET /api/org-chart/versions vẫn xem được (không cascade oan)', async () => {
      const res = await orgApi('/api/org-chart/versions', HR_ON);
      assertEqual(res.status, 200, 'phải trả 200 vì module cha "hr" không bị tắt');
    });
  } finally {
    server.close();
  }
}

async function main() {
  const run = createRunner();
  await mainDataPart(run);
  await mainOrgChartPart(run);
  run.summary();
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
