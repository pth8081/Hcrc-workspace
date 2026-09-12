// server/tests/test-attendance-records-scope.js
//
// Regression test cho GET /api/data (routes/data.js) sau Bước 8m: attendanceRecords tách riêng khỏi
// vòng lặp tải chung qua loadAttendanceRecordsScoped(). canViewEmployeeAttendanceRecord() (lib/
// recordViewScope.js) 3 nhánh — (1) admin/hrAttendanceManage xem HẾT, (2) chính chủ (employeeCode ->
// username qua employeeProfiles), (3) quản lý TRỰC TIẾP/GIÁN TIẾP của chủ bản ghi (isManagerOf(), đi
// ngược cây Cơ Cấu Tổ Chức không giới hạn số cấp).
//
// AttendanceRecords KHÔNG có cột Dept/Username/ManagerUsername nào — loadAttendanceRecordsScoped() tự
// tính tập employeeCode cần tải (self + TOÀN BỘ cấp dưới, qua computeSubordinateUsernames() ở
// lib/recordViewScope.js — BFS xuôi cây quản lý 1 LẦN từ `data.users`) rồi tải theo EmployeeCode.
//
// Chạy: node server/tests/test-attendance-records-scope.js
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

// Cây quản lý: GD (giám đốc) -> TP (trưởng phòng) -> NV1, NV2 (nhân viên) ; NV3 độc lập, không ai quản lý.
const GD = { username: 'gd', name: 'Giám Đốc', dept: 'Ban Giám Đốc', managerUsername: null, perms: {}, active: true };
const TP = { username: 'tp', name: 'Trưởng Phòng', dept: 'Phòng A', managerUsername: 'gd', perms: {}, active: true };
const NV1 = { username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng A', managerUsername: 'tp', perms: {}, active: true };
const NV2 = { username: 'nv2', name: 'Nhân Viên 2', dept: 'Phòng A', managerUsername: 'tp', perms: {}, active: true };
const NV3 = { username: 'nv3', name: 'Nhân Viên 3 (độc lập)', dept: 'Phòng B', managerUsername: null, perms: {}, active: true };
const HR_MANAGE = { username: 'hr1', name: 'Quản Lý Chấm Công', dept: 'Nhân Sự', managerUsername: null, perms: { hrAttendanceManage: true }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', managerUsername: null, perms: { admin: true }, active: true };
const ALL_USERS_LIST = [GD, TP, NV1, NV2, NV3, HR_MANAGE, ADMIN];

const EMPLOYEE_PROFILES = [
  { employeeCode: 'NV-GD', username: 'gd' },
  { employeeCode: 'NV-TP', username: 'tp' },
  { employeeCode: 'NV-01', username: 'nv1' },
  { employeeCode: 'NV-02', username: 'nv2' },
  { employeeCode: 'NV-03', username: 'nv3' }
];

let APP_DATA;
function resetData() {
  APP_DATA = { users: ALL_USERS_LIST.map(u => ({ ...u })), employeeProfiles: EMPLOYEE_PROFILES.map(p => ({ ...p })) };
}
resetData();

let ALL_RECORDS;
function resetRecords() {
  ALL_RECORDS = [
    { id: 1, employeeCode: 'NV-GD', workDate: '2026-09-01', recordType: 'IN' },
    { id: 2, employeeCode: 'NV-TP', workDate: '2026-09-01', recordType: 'IN' },
    { id: 3, employeeCode: 'NV-01', workDate: '2026-09-01', recordType: 'IN' },
    { id: 4, employeeCode: 'NV-02', workDate: '2026-09-01', recordType: 'IN' },
    { id: 5, employeeCode: 'NV-03', workDate: '2026-09-01', recordType: 'IN' }
  ];
}
resetRecords();

let fullLoadCallCount = 0;
let byColumnCalls = [];

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['attendanceRecords']),
  getAllForCollectionCached: async (collection) => {
    if (collection !== 'attendanceRecords') return [];
    fullLoadCallCount++;
    return ALL_RECORDS.map(r => ({ ...r }));
  },
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async (collection, column, value) => {
    if (collection !== 'attendanceRecords') return [];
    if (column === 'EmployeeCode') {
      byColumnCalls.push(value);
      return ALL_RECORDS.filter(r => r.employeeCode === value).map(r => ({ ...r }));
    }
    return [];
  }
});

let CURRENT_USERNAME = NV1.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = ALL_USERS_LIST.find(u => u.username === CURRENT_USERNAME);
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
    await run.run('Nhân viên lá (nv1, không quản lý ai): chỉ thấy bản ghi CHÍNH MÌNH', async () => {
      resetData(); resetRecords(); fullLoadCallCount = 0; byColumnCalls = [];
      const res = await api('GET', '/api/data', undefined, NV1);
      assertEqual(res.status, 200, 'phải trả 200');
      const ids = (res.body.attendanceRecords || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '3', 'nv1 chỉ thấy đúng bản ghi của chính mình (NV-01)');
      assertEqual(fullLoadCallCount, 0, 'người thường KHÔNG được tải toàn bộ company-wide');
    });

    await run.run('Trưởng phòng (tp, quản lý TRỰC TIẾP nv1+nv2): thấy CHÍNH MÌNH + 2 cấp dưới, KHÔNG thấy nv3 (không liên quan) hay gd (cấp trên)', async () => {
      resetData(); resetRecords();
      const res = await api('GET', '/api/data', undefined, TP);
      const ids = (res.body.attendanceRecords || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '2,3,4', 'tp phải thấy id2 (chính mình) + id3 (nv1) + id4 (nv2) — KHÔNG thấy id1 (gd, cấp trên) hay id5 (nv3, không liên quan)');
    });

    await run.run('Giám đốc (gd, quản lý GIÁN TIẾP nv1+nv2 qua tp): thấy CHÍNH MÌNH + tp + nv1 + nv2 (đệ quy 2 cấp), KHÔNG thấy nv3', async () => {
      resetData(); resetRecords();
      const res = await api('GET', '/api/data', undefined, GD);
      const ids = (res.body.attendanceRecords || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,2,3,4', 'gd phải thấy id1 (chính mình) + id2 (tp) + id3 (nv1) + id4 (nv2) qua đệ quy 2 cấp — KHÔNG thấy id5 (nv3)');
    });

    await run.run('hrAttendanceManage: nhận ĐỦ toàn công ty (tải company-wide)', async () => {
      resetData(); resetRecords(); fullLoadCallCount = 0;
      const res = await api('GET', '/api/data', undefined, HR_MANAGE);
      const ids = (res.body.attendanceRecords || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,2,3,4,5', 'hrAttendanceManage phải thấy đủ cả 5 bản ghi');
      assert(fullLoadCallCount >= 1, 'hrAttendanceManage phải tải theo nhánh company-wide');
    });

    await run.run('admin: nhận ĐỦ toàn công ty', async () => {
      resetData(); resetRecords();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      const ids = (res.body.attendanceRecords || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '1,2,3,4,5', 'admin phải thấy đủ cả 5 bản ghi');
    });

    await run.run('dù nhánh tải trả THỪA (giả lập lỗi tầng dưới), filterAttendanceRecordsForUser() vẫn chốt đúng phạm vi (lớp chắn thứ 2)', async () => {
      resetData(); resetRecords();
      stubModule('lib/recordStore', {
        MIGRATED_COLLECTIONS: new Set(['attendanceRecords']),
        getAllForCollectionCached: async (collection) => (collection === 'attendanceRecords' ? ALL_RECORDS.map(r => ({ ...r })) : []),
        getForCollectionByDeptCached: async () => [],
        getForCollectionByUsernameCached: async () => [],
        // Chỉ trả thừa cho ĐÚNG attendanceRecords — collection khác (docs/submissions cũng gọi hàm này
        // KHÔNG điều kiện ở routes/data.js) phải trả đúng rỗng, tránh vô tình "nhồi" dữ liệu sai hình
        // dạng khiến canViewDoc()/canViewSubmission() (đọc appData thật qua getAppDataValue(), KHÔNG
        // stub ở test này) ném lỗi ngoài ý muốn.
        getForCollectionByColumnCached: async (collection) => (collection === 'attendanceRecords' ? ALL_RECORDS.map(r => ({ ...r })) : []) // CỐ Ý trả thừa mọi employeeCode
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
      CURRENT_USERNAME = NV1.username;
      const res = await fetch(`http://127.0.0.1:${port2}/api/data`);
      const body = await res.json();
      server2.close();
      const ids = (body.attendanceRecords || []).map(r => r.id).sort((a, b) => a - b);
      assertEqual(ids.join(','), '3', 'dù tầng tải trả thừa, filterAttendanceRecordsForUser() vẫn phải chốt đúng còn bản ghi của chính nv1');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
