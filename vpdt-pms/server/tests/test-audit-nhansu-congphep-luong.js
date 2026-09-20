// server/tests/test-audit-nhansu-congphep-luong.js
//
// Test hồi quy cho các lỗi đã vá ở đợt rà soát chuyên sâu cụm "Nhân Sự" (10/2026) — phần Công & Phép +
// Lương. MỌI test dưới đây đều FAIL trên code TRƯỚC bản vá.
//
//   #3  (Cao) Huỷ đơn nghỉ phép ĐÃ DUYỆT không khôi phục các dòng shiftRoster đã tự huỷ lúc duyệt ->
//             shiftRoster lệch vĩnh viễn với leaveRequests.
//   #5  (Cao) Kiểm tra chồng lấn đơn nghỉ phép chỉ xét đơn PENDING, bỏ qua đơn ĐÃ DUYỆT -> nộp trùng
//             đơn cho cùng khoảng ngày đã duyệt vẫn qua, duyệt lần 2 trừ quỹ phép 2 lần.
//   #6  (Cao) Thuế TNCN KHÔNG được tính lại sau điều chỉnh tay -> thưởng/phụ cấp nhập tay thoát thuế.
//   #9  (TB)  PUT /api/payroll/rate-config không chặn số 0 cho hằng số ngày/giờ công chuẩn (chia 0 ->
//             Infinity), không có trần % BHXH/BHYT/BHTN.
//   #12 (TB)  POST /periods/:id/calculate xoá payslip cũ rồi insert lại KHÔNG atomic.
//   #13 (TB)  POST /api/attendance/clock-punch nhận timestamp tuỳ ý (tương lai / kỳ lương đã CHỐT).
//
// Chạy: node server/tests/test-audit-nhansu-congphep-luong.js
'use strict';

const assert = require('assert');
const path = require('path');
const http = require('http');
const express = require('express');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.stack || err.message}`); }
}
function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

// ===================== Tầng lưu trữ + xác thực giả lập (dùng chung cho mọi route) =====================
const STORE = {
  attendanceRecords: [], leaveBalances: [], leaveRequests: [], shiftRoster: [], shiftSwapRequests: [],
  hrProcesses: [], laborContracts: [], payrollPeriods: [], payslips: []
};
let nextId = 1;
// Cờ ép replaceRecordsInCollection() ném lỗi giữa chừng — dùng cho test #12 (atomic).
let FORCE_REPLACE_FAILURE = false;

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(STORE)),
  getAllForCollection: async (c) => (STORE[c] || []).slice(),
  getAllForCollectionCached: async (c) => (STORE[c] || []).slice(),
  getTrashItems: async () => [],
  withAppLock: async (key, fn) => fn(),
  createForCollection: async (c, builderFn) => {
    const draft = await builderFn((STORE[c] || []).slice());
    const item = Object.assign({ id: nextId++ }, draft);
    STORE[c] = STORE[c] || []; STORE[c].push(item);
    return item;
  },
  createForCollectionSerialized: async (c, lockKey, builderFn) => {
    const draft = await builderFn((STORE[c] || []).slice());
    const item = Object.assign({ id: nextId++ }, draft);
    STORE[c] = STORE[c] || []; STORE[c].push(item);
    return item;
  },
  insertRecord: async (c, record) => { STORE[c] = STORE[c] || []; STORE[c].push(record); return record; },
  deleteRecordById: async (c, id) => { STORE[c] = (STORE[c] || []).filter(r => r.id !== id); },
  // Giả lập ĐÚNG ngữ nghĩa "all-or-nothing" của giao dịch SQL thật (lib/recordStore.js).
  replaceRecordsInCollection: async (c, idsToDelete, newRecords) => {
    if (FORCE_REPLACE_FAILURE) throw new Error('Lỗi giả lập giữa chừng (mất kết nối SQL)');
    const keep = (STORE[c] || []).filter(r => !(idsToDelete || []).includes(r.id));
    STORE[c] = [...keep, ...(newRecords || [])];
    return (newRecords || []).length;
  },
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = STORE[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    list[idx] = await mutatorFn(list[idx]);
    return list[idx];
  },
  withLockedRecordById: async (c, id, mutatorFn) => {
    const list = STORE[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    list[idx] = await mutatorFn(list[idx]);
    return list[idx];
  },
  deleteRecordForCollection: async (c, id, checkFn) => {
    const list = STORE[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    if (checkFn) await checkFn(list[idx]);
    list.splice(idx, 1);
  }
});

const SYSTEM_LOGS = [];
stubModule('lib/systemLogStore', {
  insertSystemLog: async (entry) => { SYSTEM_LOGS.push(entry); return entry; },
  querySystemLogs: async () => ({ items: [], total: 0 })
});
stubModule('lib/notifications', { notifyUsers: async () => 0, notifyUser: async () => 0 });
// Máy chấm công: bỏ qua tầng API key thật (đã có test riêng cho phần đó), tập trung vào luật timestamp.
stubModule('lib/externalAuth', {
  extractBearerToken: () => 'fake-key',
  verifyApiKey: async () => true,
  isIpAllowed: () => true,
  hashApiKey: async () => 'hash'
});

const USERS = [
  { username: 'admin', name: 'Quản Trị Viên', dept: 'Nhân Sự', perms: { admin: true }, active: true },
  { username: 'hr1', name: 'Nhân Sự Một', dept: 'Nhân Sự', posType: 'HO', perms: { hrAttendanceManage: true }, active: true },
  { username: 'ketoan1', name: 'Kế Toán Lương', dept: 'Kế Toán', posType: 'HO', perms: { hrPayrollManage: true }, active: true },
  { username: 'store1', name: 'Nhân Viên Siêu Thị', dept: 'Siêu Thị A', posType: 'STORE', managerUsername: 'storeMgr1', perms: {}, active: true },
  { username: 'storeMgr1', name: 'Quản Lý Siêu Thị A', dept: 'Siêu Thị A', posType: 'STORE', perms: { hrShiftRosterManage: true, hrLeaveApprove: true }, active: true }
];

let APP_DATA;
function resetAppData() {
  APP_DATA = {
    users: USERS,
    employeeProfiles: [
      { employeeCode: 'NV1', username: 'store1', status: 'ACTIVE', dependents: [] }
    ],
    depts: ['Nhân Sự', 'Kế Toán'], stores: ['Siêu Thị A'],
    shiftTemplates: [{ id: 1, name: 'Ca Sáng' }],
    publicHolidays: [], attendanceHoConfig: {},
    // 1 API key máy chấm công "hợp lệ" — tầng verify thật đã được stub ở lib/externalAuth phía trên,
    // ở đây chỉ cần đúng keyPrefix để findMatchingApiKey() chọn được ứng viên.
    attendanceClockApiKeys: [{ id: 1, name: 'Máy chấm công test', active: true, keyPrefix: 'fake', keyHash: 'hash', allowedIps: '' }],
    payrollRateConfig: null, formTemplates: []
  };
}
resetAppData();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (APP_DATA[key] !== undefined ? APP_DATA[key] : null),
  getAllAppData: async () => Object.assign({}, APP_DATA),
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === req.headers['x-demo-user']);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const payroll = require('../lib/payroll');
const createRoutes = require('../routes/create');
const recordRoutes = require('../routes/records');
const payrollRoutes = require('../routes/payroll');
const clockPunchRoutes = require('../routes/attendanceClockPunch');

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  app.use('/api/records', recordRoutes);
  app.use('/api/payroll', payrollRoutes);
  app.use('/api/attendance', clockPunchRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, method, urlPath, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (username) headers['x-demo-user'] = username;
    const res = await fetch(`${base}${urlPath}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, json };
  }

  try {
    console.log('\n== #5 — chồng lấn đơn nghỉ phép phải xét CẢ đơn ĐÃ DUYỆT ==');

    let approvedLeaveId;
    await test('#5 chuẩn bị: nộp + duyệt 1 đơn nghỉ 2099-03-02 → 2099-03-04', async () => {
      resetAppData();
      STORE.leaveRequests = []; STORE.leaveBalances = []; STORE.shiftRoster = []; STORE.attendanceRecords = [];
      const bal = await call('hr1', 'POST', '/api/create/leaveBalances', { employeeCode: 'NV1', year: 2099, totalDays: 12 });
      assert.strictEqual(bal.status, 200, JSON.stringify(bal.json));
      const create = await call('store1', 'POST', '/api/create/leaveRequests', { leaveType: 'ANNUAL', fromDate: '2099-03-02', toDate: '2099-03-04', reason: 'Nghỉ phép' });
      assert.strictEqual(create.status, 200, JSON.stringify(create.json));
      approvedLeaveId = create.json.item.id;
      const approve = await call('storeMgr1', 'POST', `/api/records/leaveRequests/${approvedLeaveId}/approve`, {});
      assert.strictEqual(approve.status, 200, JSON.stringify(approve.json));
      assert.strictEqual(STORE.leaveBalances[0].usedDays, 3);
    });

    await test('#5 nộp đơn MỚI trùng khoảng ngày của đơn ĐÃ DUYỆT -> 409 (trước đây lọt, trừ quỹ phép 2 lần)', async () => {
      const r = await call('store1', 'POST', '/api/create/leaveRequests', { leaveType: 'ANNUAL', fromDate: '2099-03-03', toDate: '2099-03-05', reason: 'Nộp trùng' });
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
      assert.ok(/ĐÃ ĐƯỢC DUYỆT/.test(r.json.error), JSON.stringify(r.json));
      assert.strictEqual(STORE.leaveRequests.length, 1, 'Không được tạo thêm đơn nào');
      assert.strictEqual(STORE.leaveBalances[0].usedDays, 3, 'Quỹ phép không bị trừ thêm');
    });

    await test('#5 nộp đơn KHÔNG trùng ngày -> vẫn hợp lệ (không chặn nhầm)', async () => {
      const r = await call('store1', 'POST', '/api/create/leaveRequests', { leaveType: 'ANNUAL', fromDate: '2099-04-01', toDate: '2099-04-01', reason: 'Khác ngày' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    });

    await test('#5 đơn đã HUỶ không chặn đơn mới cùng ngày (khoảng ngày thực sự trống trở lại)', async () => {
      const target = STORE.leaveRequests.find(r => r.fromDate === '2099-04-01');
      const cancel = await call('store1', 'POST', `/api/records/leaveRequests/${target.id}/cancel`, {});
      assert.strictEqual(cancel.status, 200, JSON.stringify(cancel.json));
      const again = await call('store1', 'POST', '/api/create/leaveRequests', { leaveType: 'ANNUAL', fromDate: '2099-04-01', toDate: '2099-04-01', reason: 'Nộp lại' });
      assert.strictEqual(again.status, 200, JSON.stringify(again.json));
    });

    console.log('\n== #3 — huỷ đơn nghỉ ĐÃ DUYỆT phải khôi phục lịch phân ca đã tự huỷ ==');

    await test('#3 duyệt đơn -> roster trùng ngày bị CANCELLED; huỷ đơn -> roster được khôi phục về SCHEDULED', async () => {
      resetAppData();
      STORE.leaveRequests = []; STORE.leaveBalances = []; STORE.shiftRoster = []; STORE.attendanceRecords = [];
      await call('hr1', 'POST', '/api/create/leaveBalances', { employeeCode: 'NV1', year: 2099, totalDays: 12 });
      // 2 ca trùng khoảng nghỉ + 1 ca NGOÀI khoảng nghỉ (chứng minh không đụng nhầm)
      for (const workDate of ['2099-05-10', '2099-05-11', '2099-06-20']) {
        const r = await call('storeMgr1', 'POST', '/api/create/shiftRoster', { employeeCode: 'NV1', workDate, shiftTemplateId: 1, storeCode: 'Siêu Thị A' });
        assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      }
      const create = await call('store1', 'POST', '/api/create/leaveRequests', { leaveType: 'ANNUAL', fromDate: '2099-05-10', toDate: '2099-05-11', reason: 'Nghỉ phép' });
      const leaveId = create.json.item.id;
      const approve = await call('storeMgr1', 'POST', `/api/records/leaveRequests/${leaveId}/approve`, {});
      assert.strictEqual(approve.status, 200, JSON.stringify(approve.json));
      assert.strictEqual(STORE.shiftRoster.filter(r => r.status === 'CANCELLED').length, 2, 'Tiền đề: 2 ca trùng khoảng nghỉ đã bị tự huỷ lúc duyệt');

      const cancel = await call('store1', 'POST', `/api/records/leaveRequests/${leaveId}/cancel`, {});
      assert.strictEqual(cancel.status, 200, JSON.stringify(cancel.json));
      const restored = STORE.shiftRoster.filter(r => r.workDate !== '2099-06-20');
      assert.strictEqual(restored.every(r => r.status === 'SCHEDULED'), true,
        `Phải khôi phục về SCHEDULED: ${JSON.stringify(restored.map(r => ({ d: r.workDate, s: r.status })))}`);
      assert.strictEqual(restored.every(r => r.cancelledByLeaveCode === undefined), true, 'Dấu vết huỷ theo đơn phải được dọn sạch sau khi khôi phục');
      const untouched = STORE.shiftRoster.find(r => r.workDate === '2099-06-20');
      assert.strictEqual(untouched.status, 'SCHEDULED', 'Ca ngoài khoảng nghỉ giữ nguyên');
      assert.strictEqual(STORE.leaveBalances[0].usedDays, 0, 'Quỹ phép cũng phải được hoàn (hành vi cũ, không được phá)');
    });

    await test('#3 KHÔNG khôi phục các dòng bị huỷ vì lý do KHÁC (VD quản lý huỷ tay) khi huỷ đơn nghỉ', async () => {
      resetAppData();
      STORE.leaveRequests = []; STORE.leaveBalances = []; STORE.shiftRoster = []; STORE.attendanceRecords = [];
      await call('hr1', 'POST', '/api/create/leaveBalances', { employeeCode: 'NV1', year: 2099, totalDays: 12 });
      const r1 = await call('storeMgr1', 'POST', '/api/create/shiftRoster', { employeeCode: 'NV1', workDate: '2099-07-10', shiftTemplateId: 1, storeCode: 'Siêu Thị A' });
      // Ca ngày 2099-07-11 bị quản lý huỷ TAY trước khi có đơn nghỉ nào
      const r2 = await call('storeMgr1', 'POST', '/api/create/shiftRoster', { employeeCode: 'NV1', workDate: '2099-07-11', shiftTemplateId: 1, storeCode: 'Siêu Thị A' });
      const manualCancel = await call('storeMgr1', 'POST', `/api/records/shiftRoster/${r2.json.item.id}/cancel`, {});
      assert.strictEqual(manualCancel.status, 200, JSON.stringify(manualCancel.json));

      const create = await call('store1', 'POST', '/api/create/leaveRequests', { leaveType: 'ANNUAL', fromDate: '2099-07-10', toDate: '2099-07-11', reason: 'Nghỉ phép' });
      await call('storeMgr1', 'POST', `/api/records/leaveRequests/${create.json.item.id}/approve`, {});
      await call('store1', 'POST', `/api/records/leaveRequests/${create.json.item.id}/cancel`, {});
      assert.strictEqual(STORE.shiftRoster.find(r => r.id === r1.json.item.id).status, 'SCHEDULED', 'Ca do đơn nghỉ huỷ -> khôi phục');
      assert.strictEqual(STORE.shiftRoster.find(r => r.id === r2.json.item.id).status, 'CANCELLED', 'Ca bị huỷ TAY trước đó -> giữ nguyên CANCELLED');
    });

    console.log('\n== #13 — chấm công qua máy: chặn timestamp tương lai / kỳ lương đã khoá ==');

    await test('#13 timestamp ở TƯƠNG LAI -> 400, không ghi bản ghi công nào', async () => {
      resetAppData();
      STORE.attendanceRecords = []; STORE.payrollPeriods = [];
      const future = new Date(Date.now() + 3 * 86400000).toISOString();
      const r = await call(null, 'POST', '/api/attendance/clock-punch', { employeeCode: 'NV1', timestamp: future });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.ok(/tương lai/.test(r.json.error), JSON.stringify(r.json));
      assert.strictEqual(STORE.attendanceRecords.length, 0);
    });

    await test('#13 timestamp thuộc kỳ lương ĐÃ CHỐT/CÔNG BỐ -> 409, không ghi đè dữ liệu kỳ đã khoá', async () => {
      resetAppData();
      STORE.attendanceRecords = [];
      const past = new Date(Date.now() - 5 * 86400000);
      STORE.payrollPeriods = [{
        id: 1, periodName: `Lương Tháng ${past.getMonth() + 1}/${past.getFullYear()}`,
        periodMonth: past.getUTCMonth() + 1, periodYear: past.getUTCFullYear(), status: 'PUBLISHED'
      }];
      const r = await call(null, 'POST', '/api/attendance/clock-punch', { employeeCode: 'NV1', timestamp: past.toISOString() });
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
      assert.strictEqual(STORE.attendanceRecords.length, 0);
    });

    await test('#13 kỳ lương còn DRAFT (chưa chốt) -> vẫn ghi nhận bình thường', async () => {
      resetAppData();
      STORE.attendanceRecords = [];
      const past = new Date(Date.now() - 5 * 86400000);
      STORE.payrollPeriods = [{
        id: 1, periodName: 'Kỳ nháp', periodMonth: past.getUTCMonth() + 1, periodYear: past.getUTCFullYear(), status: 'DRAFT'
      }];
      const r = await call(null, 'POST', '/api/attendance/clock-punch', { employeeCode: 'NV1', timestamp: past.toISOString() });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(STORE.attendanceRecords.length, 1);
    });

    console.log('\n== #9 — validate hằng số cấu hình lương ==');

    await test('#9 standardWorkDaysHo = 0 -> 400 (trước đây lọt, chia 0 ra Infinity)', async () => {
      const body = {
        bhxhPercent: 8, bhytPercent: 1.5, bhtnPercent: 1, bhxhCap: 36000000,
        personalDeduction: 11000000, dependentDeduction: 4400000,
        standardWorkDaysHo: 0, standardWorkDaysStore: 26, standardHoursPerDay: 8,
        otMultiplierNormal: 1.5, otMultiplierWeekend: 2, otMultiplierHoliday: 3
      };
      const r = await call('ketoan1', 'PUT', '/api/payroll/rate-config', body);
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.ok(/lớn hơn 0/.test(r.json.error), JSON.stringify(r.json));
    });

    await test('#9 standardHoursPerDay = 0 / standardWorkDaysStore = 0 -> 400', async () => {
      const base = {
        bhxhPercent: 8, bhytPercent: 1.5, bhtnPercent: 1, bhxhCap: 36000000,
        personalDeduction: 11000000, dependentDeduction: 4400000,
        standardWorkDaysHo: 22, standardWorkDaysStore: 26, standardHoursPerDay: 8,
        otMultiplierNormal: 1.5, otMultiplierWeekend: 2, otMultiplierHoliday: 3
      };
      const r1 = await call('ketoan1', 'PUT', '/api/payroll/rate-config', Object.assign({}, base, { standardHoursPerDay: 0 }));
      assert.strictEqual(r1.status, 400, JSON.stringify(r1.json));
      const r2 = await call('ketoan1', 'PUT', '/api/payroll/rate-config', Object.assign({}, base, { standardWorkDaysStore: 0 }));
      assert.strictEqual(r2.status, 400, JSON.stringify(r2.json));
    });

    await test('#9 % BHXH/BHYT/BHTN > 100 -> 400', async () => {
      const base = {
        bhxhPercent: 8, bhytPercent: 1.5, bhtnPercent: 1, bhxhCap: 36000000,
        personalDeduction: 11000000, dependentDeduction: 4400000,
        standardWorkDaysHo: 22, standardWorkDaysStore: 26, standardHoursPerDay: 8,
        otMultiplierNormal: 1.5, otMultiplierWeekend: 2, otMultiplierHoliday: 3
      };
      for (const key of ['bhxhPercent', 'bhytPercent', 'bhtnPercent']) {
        const r = await call('ketoan1', 'PUT', '/api/payroll/rate-config', Object.assign({}, base, { [key]: 800 }));
        assert.strictEqual(r.status, 400, `${key}: ${JSON.stringify(r.json)}`);
        assert.ok(/0-100%/.test(r.json.error), JSON.stringify(r.json));
      }
    });

    await test('#9 cấu hình hợp lệ -> 200, lưu đúng', async () => {
      const body = {
        bhxhPercent: 8, bhytPercent: 1.5, bhtnPercent: 1, bhxhCap: 36000000,
        personalDeduction: 11000000, dependentDeduction: 4400000,
        standardWorkDaysHo: 22, standardWorkDaysStore: 26, standardHoursPerDay: 8,
        otMultiplierNormal: 1.5, otMultiplierWeekend: 2, otMultiplierHoliday: 3
      };
      const r = await call('ketoan1', 'PUT', '/api/payroll/rate-config', body);
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.config.standardWorkDaysHo, 22);
    });

    console.log('\n== #6 — thuế TNCN tính LẠI sau điều chỉnh tay ==');

    await test('#6 applyAdjustPayslipDetail(): thêm thưởng 50tr -> thuế TNCN tăng theo (trước đây giữ nguyên)', () => {
      const rateConfig = payroll.defaultRateConfig();
      const payslip = {
        employeeCode: 'NV1', details: [
          { componentCode: 'BASIC_SALARY', amount: 20000000, isManualAdjustment: false },
          { componentCode: 'SOCIAL_INSURANCE', amount: 1600000, isManualAdjustment: false },
          { componentCode: 'HEALTH_INSURANCE', amount: 300000, isManualAdjustment: false },
          { componentCode: 'UNEMPLOYMENT_INSURANCE', amount: 200000, isManualAdjustment: false },
          { componentCode: 'PERSONAL_INCOME_TAX', amount: 345000, isManualAdjustment: false }
        ],
        grossIncome: 20000000, totalDeduction: 2445000, netPay: 17555000
      };
      const taxBefore = payslip.details.find(d => d.componentCode === 'PERSONAL_INCOME_TAX').amount;
      payroll.applyAdjustPayslipDetail(payslip, { componentCode: 'BONUS_OTHER', amount: 50000000, note: 'Thưởng dự án' }, 'ketoan1',
        { rateConfig, dependentCount: 0 });
      const taxAfter = payslip.details.find(d => d.componentCode === 'PERSONAL_INCOME_TAX').amount;
      assert.ok(taxAfter > taxBefore, `Thuế phải tăng sau khi cộng thưởng chịu thuế (trước ${taxBefore}, sau ${taxAfter})`);
      // Đối chiếu với đúng công thức gốc: thu nhập chịu thuế = 70tr - 2.1tr BH - 11tr giảm trừ
      const expected = payroll.computeTaxFromBrackets(70000000 - 2100000 - 11000000, rateConfig.taxBrackets);
      assert.strictEqual(taxAfter, expected);
      assert.strictEqual(payslip.grossIncome, 70000000);
      assert.strictEqual(payslip.netPay, payslip.grossIncome - payslip.totalDeduction);
    });

    await test('#6 khấu trừ tay (tạm ứng/phạt) KHÔNG làm giảm thu nhập chịu thuế', () => {
      const rateConfig = payroll.defaultRateConfig();
      const payslip = {
        employeeCode: 'NV1', details: [
          { componentCode: 'BASIC_SALARY', amount: 30000000, isManualAdjustment: false },
          { componentCode: 'PERSONAL_INCOME_TAX', amount: 0, isManualAdjustment: false }
        ],
        grossIncome: 30000000, totalDeduction: 0, netPay: 30000000
      };
      payroll.applyAdjustPayslipDetail(payslip, { componentCode: 'ADVANCE_DEDUCT', amount: 5000000, note: 'Tạm ứng' }, 'ketoan1',
        { rateConfig, dependentCount: 0 });
      const tax = payslip.details.find(d => d.componentCode === 'PERSONAL_INCOME_TAX').amount;
      assert.strictEqual(tax, payroll.computeTaxFromBrackets(30000000 - 11000000, rateConfig.taxBrackets));
    });

    await test('#6 người phụ thuộc được trừ đúng khi tính lại thuế', () => {
      const rateConfig = payroll.defaultRateConfig();
      const make = () => ({
        employeeCode: 'NV1',
        details: [{ componentCode: 'BASIC_SALARY', amount: 30000000, isManualAdjustment: false }],
        grossIncome: 30000000, totalDeduction: 0, netPay: 30000000
      });
      const p0 = make(); payroll.applyAdjustPayslipDetail(p0, { componentCode: 'KPI_BONUS', amount: 1000000 }, 'ketoan1', { rateConfig, dependentCount: 0 });
      const p2 = make(); payroll.applyAdjustPayslipDetail(p2, { componentCode: 'KPI_BONUS', amount: 1000000 }, 'ketoan1', { rateConfig, dependentCount: 2 });
      const tax0 = p0.details.find(d => d.componentCode === 'PERSONAL_INCOME_TAX').amount;
      const tax2 = p2.details.find(d => d.componentCode === 'PERSONAL_INCOME_TAX').amount;
      assert.ok(tax2 < tax0, `Có 2 người phụ thuộc thì thuế phải thấp hơn (0 NPT: ${tax0}, 2 NPT: ${tax2})`);
    });

    await test('#6 KHÔNG có cấu hình thuế truyền vào -> gắn cờ cảnh báo taxRecalcPending (không âm thầm bỏ qua)', () => {
      const payslip = {
        employeeCode: 'NV1',
        details: [{ componentCode: 'BASIC_SALARY', amount: 30000000, isManualAdjustment: false }],
        grossIncome: 30000000, totalDeduction: 0, netPay: 30000000
      };
      payroll.applyAdjustPayslipDetail(payslip, { componentCode: 'KPI_BONUS', amount: 1000000 }, 'ketoan1');
      assert.strictEqual(payslip.taxRecalcPending, true);
    });

    await test('#6 mergeManualAdjustmentsIntoPayslip() (tính lại cả kỳ) cũng tính lại thuế', () => {
      const rateConfig = payroll.defaultRateConfig();
      const record = {
        employeeCode: 'NV1',
        details: [
          { componentCode: 'BASIC_SALARY', amount: 30000000, isManualAdjustment: false },
          { componentCode: 'PERSONAL_INCOME_TAX', amount: payroll.computeTaxFromBrackets(30000000 - 11000000, rateConfig.taxBrackets), isManualAdjustment: false }
        ],
        grossIncome: 30000000, totalDeduction: 0, netPay: 30000000
      };
      payroll.mergeManualAdjustmentsIntoPayslip(record, [{ componentCode: 'BONUS_OTHER', amount: 20000000, isManualAdjustment: true }], { rateConfig, dependentCount: 0 });
      const tax = record.details.find(d => d.componentCode === 'PERSONAL_INCOME_TAX').amount;
      assert.strictEqual(tax, payroll.computeTaxFromBrackets(50000000 - 11000000, rateConfig.taxBrackets));
    });

    await test('#6 qua HTTP: PATCH /payslips/:id/details tính lại thuế theo số người phụ thuộc THẬT của hồ sơ', async () => {
      resetAppData();
      APP_DATA.employeeProfiles[0].dependents = [{ id: 'd1', fullName: 'Con A', relationship: 'Con' }];
      STORE.payrollPeriods = [{ id: 3001, periodName: 'Lương Tháng 03/2026', periodMonth: 3, periodYear: 2026, status: 'DRAFT', history: [] }];
      const rateConfig = payroll.defaultRateConfig();
      STORE.payslips = [{
        id: 4001, periodId: 3001, employeeCode: 'NV1', employeeUsername: 'store1',
        details: [
          { componentCode: 'BASIC_SALARY', amount: 30000000, isManualAdjustment: false },
          { componentCode: 'PERSONAL_INCOME_TAX', amount: 100, isManualAdjustment: false }
        ],
        grossIncome: 30000000, totalDeduction: 100, netPay: 29999900
      }];
      const r = await call('ketoan1', 'PATCH', '/api/payroll/payslips/4001/details', { componentCode: 'BONUS_OTHER', amount: 20000000, note: 'Thưởng năm' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const tax = r.json.item.details.find(d => d.componentCode === 'PERSONAL_INCOME_TAX').amount;
      const expected = payroll.computeTaxFromBrackets(50000000 - 11000000 - 4400000, rateConfig.taxBrackets);
      assert.strictEqual(tax, expected, 'Thuế phải tính lại có trừ 1 người phụ thuộc');
    });

    console.log('\n== #12 — Tính Lương Tự Động phải atomic (không mất dữ liệu kỳ lương) ==');

    await test('#12 lỗi giữa chừng khi ghi lại payslip -> payslip CŨ của kỳ còn nguyên (rollback), API báo lỗi', async () => {
      resetAppData();
      STORE.payrollPeriods = [{ id: 3002, periodName: 'Lương Tháng 04/2026', periodMonth: 4, periodYear: 2026, status: 'DRAFT', employeeCount: 1, history: [] }];
      STORE.payslips = [{ id: 4101, periodId: 3002, employeeCode: 'NV1', details: [], grossIncome: 1, totalDeduction: 0, netPay: 1 }];
      STORE.laborContracts = [{ id: 5001, employeeCode: 'NV1', employeeUsername: 'store1', status: 'ACTIVE', baseSalary: 20000000, startDate: '2020-01-01', history: [], amendments: [] }];
      FORCE_REPLACE_FAILURE = true;
      const r = await call('ketoan1', 'POST', '/api/payroll/periods/3002/calculate', {});
      FORCE_REPLACE_FAILURE = false;
      assert.strictEqual(r.status, 500, JSON.stringify(r.json));
      assert.strictEqual(STORE.payslips.length, 1, 'Payslip cũ KHÔNG được mất khi lỗi giữa chừng');
      assert.strictEqual(STORE.payslips[0].id, 4101);
    });

    await test('#12 chạy bình thường -> thay đúng payslip cũ bằng payslip mới (1 giao dịch)', async () => {
      const r = await call('ketoan1', 'POST', '/api/payroll/periods/3002/calculate', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(STORE.payslips.length, 1);
      assert.notStrictEqual(STORE.payslips[0].id, 4101, 'Payslip cũ phải được thay bằng bản tính lại');
      assert.strictEqual(STORE.payslips[0].employeeCode, 'NV1');
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
