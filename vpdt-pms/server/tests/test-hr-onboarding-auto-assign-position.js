// server/tests/test-hr-onboarding-auto-assign-position.js
//
// Test cho tính năng MỚI (11/2026, theo yêu cầu người dùng — "Phòng Ban/Chức Danh ở Onboarding phải
// thành Chức Vụ CHÍNH THỨC ngay, bộ phận tuyển dụng muốn nhập xong là hiệu quả ngay với hồ sơ, không
// phải tự điền lại" — Phương án B, đã phân tích 2 phương án + rủi ro "nhiều vị trí cùng tên" với người
// dùng qua AskUserQuestion trước khi code): autoAssignOnboardingPosition()/lib/employeeProfile.js +
// findAllPositionNodesForDeptJobTitle()/lib/orgChart.js, nối vào createOnboardingProcessRecord()
// (lib/hrProcessOnboardingCreate.js).
//
// Phạm vi kiểm tra:
//   1) Khớp ĐÚNG 1 node, còn chỗ (quota null hoặc quota > đã chiếm) -> tự gán positionKey/jobTitle/dept/
//      positionLabel/posType, KHÔNG có cảnh báo.
//   2) Khớp 1 node nhưng ĐÃ ĐỦ/VƯỢT Định Biên (có hồ sơ ACTIVE khác đang giữ) -> VẪN tạo + gán thành
//      công (không chặn tuyển), nhưng response kèm positionAutoAssignWarning nêu rõ Định Biên.
//   3) 2 node CÙNG dept+jobTitle (mô phỏng "nhiều Nhân Viên Bán Hàng" đã phân tích với người dùng): node
//      đầu đã đủ, node sau còn chỗ -> tự chọn ĐÚNG node sau (không báo lỗi/cảnh báo gì).
//   4) 2 node CÙNG dept+jobTitle, CẢ 2 đều đã đủ/vượt -> vẫn gán (vào node đầu theo thứ tự nodeId cố
//      định), cảnh báo nêu rõ "2 vị trí ... đều đã đủ/vượt".
//   5) Hồ sơ CANCELLED (ứng viên không nhận việc) đang giữ positionKey -> KHÔNG tính vào Định Biên đã
//      chiếm (Onboarding mới vẫn gán vào ĐÚNG node đó, không cảnh báo dù trông như "đã đủ").
//   6) Hồ sơ INACTIVE (đã nghỉ việc) đang giữ positionKey -> cùng lý do, KHÔNG tính vào Định Biên đã
//      chiếm.
//   7) quota=null (chưa cấu hình Định Biên) dù đã có rất nhiều hồ sơ ACTIVE giữ node đó -> không giới
//      hạn, không cảnh báo.
//
// Mirror ĐÚNG khuôn stub/lock thật (appData/recordStore/auth) đã có ở test-onboarding-nationalid-race.js
// — gọi thẳng router THẬT (routes/create.js) qua HTTP, không gọi tắt hàm nội bộ, để kiểm chứng đúng
// luồng người dùng thật sẽ đi qua.
//
// Chạy: node server/tests/test-hr-onboarding-auto-assign-position.js
'use strict';

const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

const HR1 = { username: 'hr1', name: 'Nhân Sự 1', dept: 'Nhân Sự', perms: { hrOnboardingManage: true }, active: true };
const USERS = [HR1];

// 2 node POSITION CÙNG dept="Siêu Thị A"/jobTitle="Nhân Viên Bán Hàng" (nodeId 2 và 3) — mô phỏng đúng
// tình huống "nhiều Nhân Viên Bán Hàng tách node riêng" đã phân tích với người dùng trước khi code.
function freshOrgChartVersion() {
  return {
    id: 'v1', status: 'APPLIED',
    nodes: [
      { nodeId: 1, parentNodeId: null, nodeType: 'DEPARTMENT', nodeName: 'Siêu Thị A', departmentRef: 'Siêu Thị A', jobTitle: null, requiresDept: null, posType: null, jobGrade: null, headcountQuota: null, headcountSelfOnly: false, positionKey: null, displayOrder: 0 },
      { nodeId: 2, parentNodeId: 1, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Nhân Viên Bán Hàng', requiresDept: true, posType: 'STORE', jobGrade: null, headcountQuota: null, headcountSelfOnly: null, positionKey: 'pos-A', displayOrder: 0 },
      { nodeId: 3, parentNodeId: 1, nodeType: 'POSITION', nodeName: null, departmentRef: null, jobTitle: 'Nhân Viên Bán Hàng', requiresDept: true, posType: 'STORE', jobGrade: null, headcountQuota: null, headcountSelfOnly: null, positionKey: 'pos-B', displayOrder: 1 }
    ]
  };
}

let APP_DATA_STORE = {};
function resetAppData(orgChartOverrides) {
  APP_DATA_STORE = {
    users: USERS, depts: [], stores: [], jobTitles: [], storeJobTitles: [],
    hrTaskTemplates: [], formTemplates: {}, employeeProfiles: [],
    orgChartVersions: [Object.assign(freshOrgChartVersion(), orgChartOverrides || {})]
  };
}
resetAppData();

const lockChains = new Map();
async function withFakeLock(lockKey, fn) {
  const prev = lockChains.get(lockKey) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  lockChains.set(lockKey, prev.then(() => current));
  await prev;
  try { return await fn(); } finally { release(); }
}

stubModule('lib/appData', {
  getAllAppData: async () => JSON.parse(JSON.stringify(APP_DATA_STORE)),
  getAppDataValue: async (key) => JSON.parse(JSON.stringify(APP_DATA_STORE[key])),
  withLockedAppDataValue: (key, fn) => withFakeLock(`appdata:${key}`, async () => {
    const currentValue = JSON.parse(JSON.stringify(APP_DATA_STORE[key]));
    const newValue = await fn(currentValue);
    APP_DATA_STORE[key] = newValue;
    return newValue;
  })
});

let RECORDS = { hrProcesses: [] };
let nextId = 1;
function resetRecords() { RECORDS = { hrProcesses: [] }; nextId = 1; }

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['hrProcesses']),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  getTrashItems: async () => [],
  createForCollection: async (c, builderFn) => {
    const draft = await builderFn((RECORDS[c] || []).slice());
    const record = Object.assign({ id: nextId++ }, draft);
    RECORDS[c] = RECORDS[c] || []; RECORDS[c].push(record);
    return record;
  },
  createForCollectionSerialized: async (c, lockKey, builderFn) => withFakeLock(`record:${lockKey}`, async () => {
    const draft = await builderFn((RECORDS[c] || []).slice());
    const record = Object.assign({ id: nextId++ }, draft);
    RECORDS[c] = RECORDS[c] || []; RECORDS[c].push(record);
    return record;
  }),
  withAppLock: async (key, fn) => withFakeLock(`applock:${key}`, fn)
});

stubModule('lib/uploadedFiles', { assertPayloadFileUrlsOwnedByUser: async () => {} });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {}, querySystemLogs: async () => ({ items: [], total: 0 }) });
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const username = req.headers['x-test-user'];
    const fresh = USERS.find((u) => u.username === username);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const createRoutes = require('../routes/create');

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function api(server, body, asUser) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/create/hrProcesses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': asUser.username },
    body: JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

function onboardingPayload(overrides) {
  return Object.assign({
    processType: 'ONBOARDING',
    fullName: 'Ứng Viên Test',
    employeePosType: 'STORE',
    employeeDept: 'Siêu Thị A',
    employeeJobTitle: 'Nhân Viên Bán Hàng',
    email: 'ung.vien@congty.vn', phone: '0900000000', startDate: '2026-12-01'
  }, overrides || {});
}

function profileFor(employeeCode) {
  return (APP_DATA_STORE.employeeProfiles || []).find(p => p.employeeCode === employeeCode);
}

async function main() {
  const server = await startApp();
  try {
    // ===== 1) Khớp đúng 1 node, còn chỗ (quota null) -> gán, không cảnh báo =====
    resetAppData(); resetRecords();
    const r1 = await api(server, onboardingPayload({ fullName: 'Ứng Viên Một' }), HR1);
    check('1) Tạo Onboarding thành công (200)', r1.status === 200, r1.body);
    const p1 = profileFor(r1.body?.item?.employeeCode);
    check('1) Hồ sơ được tự gán positionKey khớp node CHƯA đầy (pos-A, node đầu theo nodeId)', p1?.positionKey === 'pos-A', p1);
    check('1) jobTitle/dept/posType snapshot đúng từ node', p1?.jobTitle === 'Nhân Viên Bán Hàng' && p1?.dept === 'Siêu Thị A' && p1?.posType === 'STORE', p1);
    check('1) KHÔNG có cảnh báo Định Biên (quota null = không giới hạn)', !r1.body?.item?.positionAutoAssignWarning, r1.body?.item);

    // ===== 2) 1 node, ĐÃ ĐỦ Định Biên (1 hồ sơ ACTIVE khác đang giữ, quota=1) -> vẫn gán + cảnh báo =====
    resetAppData(); // reset rồi override quota ngay dưới
    APP_DATA_STORE.orgChartVersions[0].nodes.find(n => n.positionKey === 'pos-A').headcountQuota = 1;
    APP_DATA_STORE.orgChartVersions[0].nodes.find(n => n.positionKey === 'pos-B').headcountQuota = 1;
    APP_DATA_STORE.employeeProfiles.push({ employeeCode: 'NV-CU-1', positionKey: 'pos-A', status: 'ACTIVE', onboardingQueueStatus: 'CONFIRMED' });
    APP_DATA_STORE.employeeProfiles.push({ employeeCode: 'NV-CU-2', positionKey: 'pos-B', status: 'ACTIVE', onboardingQueueStatus: 'CONFIRMED' });
    resetRecords();
    const r2 = await api(server, onboardingPayload({ fullName: 'Ứng Viên Hai' }), HR1);
    check('2) Tạo Onboarding VẪN thành công dù cả 2 vị trí đã đủ Định Biên (không chặn tuyển)', r2.status === 200, r2.body);
    const p2 = profileFor(r2.body?.item?.employeeCode);
    check('2) Vẫn tự gán vào node đầu (pos-A) theo thứ tự cố định', p2?.positionKey === 'pos-A', p2);
    check('2) CÓ cảnh báo Định Biên, nêu rõ "2 vị trí"/"đều đã đủ/vượt"', /2 vị trí/.test(r2.body?.item?.positionAutoAssignWarning || '') && /đều đã đủ\/vượt/.test(r2.body?.item?.positionAutoAssignWarning || ''), r2.body?.item);

    // ===== 3) 2 node cùng tên, node ĐẦU đã đủ (quota=1), node SAU còn chỗ -> chọn ĐÚNG node sau =====
    resetAppData();
    APP_DATA_STORE.orgChartVersions[0].nodes.find(n => n.positionKey === 'pos-A').headcountQuota = 1;
    APP_DATA_STORE.employeeProfiles.push({ employeeCode: 'NV-CU-3', positionKey: 'pos-A', status: 'ACTIVE', onboardingQueueStatus: 'CONFIRMED' });
    // pos-B KHÔNG cấu hình quota (null) -> luôn còn chỗ.
    resetRecords();
    const r3 = await api(server, onboardingPayload({ fullName: 'Ứng Viên Ba' }), HR1);
    check('3) Tạo thành công', r3.status === 200, r3.body);
    const p3 = profileFor(r3.body?.item?.employeeCode);
    check('3) Tự chuyển sang node CÒN CHỖ (pos-B), không gán vào pos-A đã đầy', p3?.positionKey === 'pos-B', p3);
    check('3) KHÔNG cảnh báo (đã tìm được node còn chỗ)', !r3.body?.item?.positionAutoAssignWarning, r3.body?.item);

    // ===== 4) CANCELLED giữ positionKey -> KHÔNG tính vào Định Biên đã chiếm =====
    resetAppData();
    APP_DATA_STORE.orgChartVersions[0].nodes.find(n => n.positionKey === 'pos-A').headcountQuota = 1;
    APP_DATA_STORE.employeeProfiles.push({ employeeCode: 'NV-CU-4', positionKey: 'pos-A', status: 'DRAFT', onboardingQueueStatus: 'CANCELLED' });
    resetRecords();
    const r4 = await api(server, onboardingPayload({ fullName: 'Ứng Viên Bốn' }), HR1);
    check('4) Tạo thành công', r4.status === 200, r4.body);
    const p4 = profileFor(r4.body?.item?.employeeCode);
    check('4) Hồ sơ CANCELLED không tính vào Định Biên -> vẫn gán ĐÚNG pos-A (còn chỗ), KHÔNG cảnh báo', p4?.positionKey === 'pos-A' && !r4.body?.item?.positionAutoAssignWarning, { profile: p4, warning: r4.body?.item?.positionAutoAssignWarning });

    // ===== 5) INACTIVE giữ positionKey -> KHÔNG tính vào Định Biên đã chiếm =====
    resetAppData();
    APP_DATA_STORE.orgChartVersions[0].nodes.find(n => n.positionKey === 'pos-A').headcountQuota = 1;
    APP_DATA_STORE.employeeProfiles.push({ employeeCode: 'NV-CU-5', positionKey: 'pos-A', status: 'INACTIVE', onboardingQueueStatus: 'CONFIRMED' });
    resetRecords();
    const r5 = await api(server, onboardingPayload({ fullName: 'Ứng Viên Năm' }), HR1);
    check('5) Tạo thành công', r5.status === 200, r5.body);
    const p5 = profileFor(r5.body?.item?.employeeCode);
    check('5) Hồ sơ INACTIVE (đã nghỉ) không tính vào Định Biên -> vẫn gán ĐÚNG pos-A, KHÔNG cảnh báo', p5?.positionKey === 'pos-A' && !r5.body?.item?.positionAutoAssignWarning, { profile: p5, warning: r5.body?.item?.positionAutoAssignWarning });

    // ===== 6) quota=null dù đã có rất nhiều hồ sơ ACTIVE -> không giới hạn, không cảnh báo =====
    resetAppData();
    for (let i = 0; i < 20; i++) {
      APP_DATA_STORE.employeeProfiles.push({ employeeCode: `NV-BULK-${i}`, positionKey: 'pos-A', status: 'ACTIVE', onboardingQueueStatus: 'CONFIRMED' });
    }
    resetRecords();
    const r6 = await api(server, onboardingPayload({ fullName: 'Ứng Viên Sáu' }), HR1);
    check('6) Tạo thành công', r6.status === 200, r6.body);
    const p6 = profileFor(r6.body?.item?.employeeCode);
    check('6) quota=null -> không giới hạn, không cảnh báo dù đã 20 người', p6?.positionKey === 'pos-A' && !r6.body?.item?.positionAutoAssignWarning, { profile: p6, warning: r6.body?.item?.positionAutoAssignWarning });
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
