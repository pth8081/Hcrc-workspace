// server/tests/test-selfapprove-leave-shiftswap-meeting.js
//
// Regression test cho LỖI ĐÃ VÁ (re-audit lần 4, mức Cao): 3 hàm gác quyền duyệt riêng của module tự
// phục vụ (Công & Phép / Đổi Ca / Đặt Phòng Họp) đều có nhánh admin/quyền-phẳng `return true` NGAY,
// KHÔNG so sánh với người tạo hồ sơ — ngược hẳn quyết định "chặn admin tự duyệt ở TẤT CẢ module, không
// có ngoại lệ" (v26.50). Sót vì cả 3 hàm KHÔNG nằm trong "họ" assertNotSelfDeciding*/
// assertNotSelfHandling* (lib/workflowEngine.js/lib/recordActions.js) bị quét theo tên ở đợt đó:
//   1) canApproveLeaveRequest() — lib/attendance.js (dùng ở POST /api/leaveRequests/:id/approve)
//   2) assertShiftSwapApprover() — routes/records.js (dùng ở POST /api/records/shiftSwapRequests/:id/approve|reject)
//   3) canDecideMeeting() — lib/recordActions.js (dùng ở POST /api/meetings/:id/approve)
//
// Chạy: node server/tests/test-selfapprove-leave-shiftswap-meeting.js
'use strict';

const assert = require('assert');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.stack || err.message}`); }
}

// ===================== 1) canApproveLeaveRequest() (thuần) =====================
async function partLeave() {
  console.log('\n== 1) canApproveLeaveRequest() (lib/attendance.js, thuần) ==');
  const { canApproveLeaveRequest } = require('../lib/attendance');

  await test('LỖI ĐÃ VÁ: admin KHÔNG tự duyệt được đơn nghỉ phép của chính mình', () => {
    const admin = { username: 'admin', perms: { admin: true } };
    assert.strictEqual(canApproveLeaveRequest(admin, [], 'admin'), false);
  });

  await test('admin vẫn duyệt được đơn nghỉ phép của NGƯỜI KHÁC (không mất chức năng)', () => {
    const admin = { username: 'admin', perms: { admin: true } };
    assert.strictEqual(canApproveLeaveRequest(admin, [], 'nv_khac'), true);
  });

  await test('LỖI ĐÃ VÁ (đã có từ trước, giữ nguyên): hrAttendanceManage KHÔNG tự duyệt được đơn của chính mình', () => {
    const hr = { username: 'hr1', perms: { hrAttendanceManage: true } };
    assert.strictEqual(canApproveLeaveRequest(hr, [], 'hr1'), false);
  });

  await test('hrLeaveApprove (quản lý trực tiếp thật) vẫn duyệt được đơn của cấp dưới', () => {
    const mgr = { username: 'mgr1', perms: { hrLeaveApprove: true } };
    const allUsers = [{ username: 'mgr1' }, { username: 'staff1', managerUsername: 'mgr1' }];
    assert.strictEqual(canApproveLeaveRequest(mgr, allUsers, 'staff1'), true);
  });
}

// ===================== 2) canDecideMeeting() (thuần) =====================
async function partMeeting() {
  console.log('\n== 2) canDecideMeeting() (lib/recordActions.js, thuần) ==');
  const { canDecideMeeting } = require('../lib/recordActions');

  await test('LỖI ĐÃ VÁ: admin KHÔNG tự duyệt được lịch họp do chính mình đặt', () => {
    const admin = { username: 'admin', perms: { admin: true } };
    const meeting = { creator: 'admin', dept: 'Phòng IT' };
    assert.strictEqual(canDecideMeeting(admin, meeting, {}), false);
  });

  await test('admin vẫn duyệt được lịch họp do NGƯỜI KHÁC đặt (không mất chức năng)', () => {
    const admin = { username: 'admin', perms: { admin: true } };
    const meeting = { creator: 'nv_khac', dept: 'Phòng IT' };
    assert.strictEqual(canDecideMeeting(admin, meeting, {}), true);
  });

  await test('LỖI ĐÃ VÁ: meetingApprove (quyền phẳng) KHÔNG tự duyệt được lịch họp do chính mình đặt', () => {
    const approver = { username: 'ap1', perms: { meetingApprove: true } };
    const meeting = { creator: 'ap1', dept: 'Phòng IT' };
    assert.strictEqual(canDecideMeeting(approver, meeting, {}), false);
  });

  await test('named-approver theo meetingDeptWorkflows vẫn duyệt được lịch họp của phòng ban mình phụ trách (không mất chức năng)', () => {
    const approver = { username: 'ap2', perms: {} };
    const meeting = { creator: 'nv_khac', dept: 'Phòng IT' };
    const appData = { meetingDeptWorkflows: { 'Phòng IT': { approvers: { 1: ['ap2'] } } } };
    assert.strictEqual(canDecideMeeting(approver, meeting, appData), true);
  });
}

// ===================== 3) assertShiftSwapApprover() (qua HTTP thật) =====================
async function partShiftSwap() {
  console.log('\n== 3) assertShiftSwapApprover() (routes/records.js, qua HTTP thật) ==');
  const path = require('path');
  const express = require('express');
  const http = require('http');

  function stubModule(relPath, exportsObj) {
    const full = require.resolve(path.join(__dirname, '..', relPath));
    require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
    return exportsObj;
  }

  const EMPLOYEE_PROFILES = [
    { employeeCode: 'NV1', username: 'store1', status: 'ACTIVE' },
    { employeeCode: 'NV2', username: 'store2', status: 'ACTIVE' },
    // NV3 -> storeMgr1: LỖI ĐÃ VÁ (re-audit lần 6, mức TB — "assertShiftSwapApprover chặn sai phía") —
    // dùng để kiểm storeMgr1 (hrShiftSwapApprove) KHÔNG tự duyệt được khi chính mình là NGƯỜI NHẬN CA
    // (targetEmployeeCode), không chỉ khi là người TẠO đơn (đã chặn từ trước).
    { employeeCode: 'NV3', username: 'storeMgr1', status: 'ACTIVE' }
  ];
  let STORE;
  let nextId;
  function resetStore() {
    STORE = {
      shiftRoster: [{ id: 1, employeeCode: 'NV1', storeCode: 'Siêu Thị A', workDate: '2026-12-10', status: 'SCHEDULED' }],
      shiftSwapRequests: [],
      employeeProfiles: EMPLOYEE_PROFILES
    };
    nextId = 100;
  }
  resetStore();

  stubModule('lib/recordStore', {
    MIGRATED_COLLECTIONS: new Set(['shiftRoster', 'shiftSwapRequests']),
    getAllForCollection: async (c) => (STORE[c] || []).slice(),
    getTrashItems: async () => [],
    withAppLock: async (key, fn) => fn(),
    createForCollection: async (c, builderFn) => {
      const draft = await builderFn((STORE[c] || []).slice());
      const item = Object.assign({ id: nextId++ }, draft);
      STORE[c] = STORE[c] || []; STORE[c].push(item);
      return item;
    },
    withLockedRecordForCollection: async (c, id, mutatorFn) => {
      const idx = (STORE[c] || []).findIndex(x => x.id === Number(id));
      if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
      const result = await mutatorFn(STORE[c][idx]);
      STORE[c][idx] = result;
      return result;
    }
  });

  const STORE_MGR = { username: 'storeMgr1', name: 'Quản Lý Siêu Thị A', dept: 'Siêu Thị A', posType: 'STORE', perms: { hrShiftRosterManage: true, hrShiftSwapApprove: true }, active: true };
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Siêu Thị A', posType: 'STORE', perms: { admin: true }, active: true };
  const USERS = [STORE_MGR, ADMIN, { username: 'store1', dept: 'Siêu Thị A', posType: 'STORE', perms: {}, active: true }];

  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const username = req.headers['x-test-user'];
      const fresh = USERS.find(u => u.username === username);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      req.allUsers = USERS;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  stubModule('lib/appData', {
    getAppDataValue: async () => null,
    getAllAppData: async () => ({ users: USERS }),
    withLockedAppDataValue: async (key, fn) => fn(null)
  });

  const recordRoutes = require('../routes/records');
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, method, urlPath, body) {
    const res = await fetch(`${base}${urlPath}`, {
      method, headers: Object.assign({ 'x-test-user': username }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  try {
    await test('LỖI ĐÃ VÁ: admin KHÔNG tự duyệt được yêu cầu đổi ca do chính mình tạo (dù giữ quyền admin)', async () => {
      resetStore();
      STORE.shiftSwapRequests.push({ id: 1, requesterRosterId: 1, requesterEmployeeCode: 'NV1', targetEmployeeCode: 'NV2', creator: 'admin', status: 'PENDING', history: [] });
      const r = await call('admin', 'POST', '/api/records/shiftSwapRequests/1/approve', {});
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
      assert.ok(/không thể tự duyệt/.test(r.json?.error || ''), JSON.stringify(r.json));
    });

    await test('LỖI ĐÃ VÁ: hrShiftSwapApprove (Quản Lý Siêu Thị) KHÔNG tự duyệt được yêu cầu đổi ca do chính mình tạo', async () => {
      resetStore();
      STORE.shiftSwapRequests.push({ id: 2, requesterRosterId: 1, requesterEmployeeCode: 'NV1', targetEmployeeCode: 'NV2', creator: 'storeMgr1', status: 'PENDING', history: [] });
      const r = await call('storeMgr1', 'POST', '/api/records/shiftSwapRequests/2/approve', {});
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
      assert.ok(/không thể tự duyệt/.test(r.json?.error || ''), JSON.stringify(r.json));
    });

    await test('admin vẫn duyệt được yêu cầu đổi ca do NGƯỜI KHÁC tạo (không mất chức năng)', async () => {
      resetStore();
      STORE.shiftSwapRequests.push({ id: 3, requesterRosterId: 1, requesterEmployeeCode: 'NV1', targetEmployeeCode: 'NV2', creator: 'store1', status: 'PENDING', history: [] });
      const r = await call('admin', 'POST', '/api/records/shiftSwapRequests/3/approve', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    });

    await test('LỖI ĐÃ VÁ: admin KHÔNG tự TỪ CHỐI được yêu cầu đổi ca do chính mình tạo (cùng chặn như approve)', async () => {
      resetStore();
      STORE.shiftSwapRequests.push({ id: 4, requesterRosterId: 1, requesterEmployeeCode: 'NV1', targetEmployeeCode: 'NV2', creator: 'admin', status: 'PENDING', history: [] });
      const r = await call('admin', 'POST', '/api/records/shiftSwapRequests/4/reject', {});
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    // LỖI ĐÃ VÁ (re-audit lần 6, mức TB — "assertShiftSwapApprover chặn sai phía"): 2 bản vá trên CHỈ
    // chặn phía NGƯỜI TẠO ĐƠN (creator) tự duyệt — bỏ sót hoàn toàn phía NGƯỜI NHẬN CA
    // (targetEmployeeCode). storeMgr1 (hrShiftSwapApprove, đúng siêu thị) KHÔNG phải người tạo đơn #5
    // dưới đây (store1 tạo), nhưng CHÍNH LÀ người nhận ca (targetEmployeeCode: NV3 -> storeMgr1) — phải
    // bị chặn giống hệt trường hợp tự tạo đơn.
    await test('LỖI ĐÃ VÁ: hrShiftSwapApprove (Quản Lý Siêu Thị) KHÔNG tự duyệt được yêu cầu đổi ca mà CHÍNH MÌNH là người NHẬN ca (không phải người tạo)', async () => {
      resetStore();
      STORE.shiftSwapRequests.push({ id: 5, requesterRosterId: 1, requesterEmployeeCode: 'NV1', targetEmployeeCode: 'NV3', creator: 'store1', status: 'PENDING', history: [] });
      const r = await call('storeMgr1', 'POST', '/api/records/shiftSwapRequests/5/approve', {});
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
      assert.ok(/không thể tự duyệt/.test(r.json?.error || ''), JSON.stringify(r.json));
    });

    await test('LỖI ĐÃ VÁ: hrShiftSwapApprove (Quản Lý Siêu Thị) KHÔNG tự TỪ CHỐI được yêu cầu đổi ca mà chính mình là người nhận ca (cùng chặn như approve)', async () => {
      resetStore();
      STORE.shiftSwapRequests.push({ id: 6, requesterRosterId: 1, requesterEmployeeCode: 'NV1', targetEmployeeCode: 'NV3', creator: 'store1', status: 'PENDING', history: [] });
      const r = await call('storeMgr1', 'POST', '/api/records/shiftSwapRequests/6/reject', {});
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    await test('đối chứng: hrShiftSwapApprove vẫn duyệt được đơn KHÔNG liên quan tới chính mình (không phải người tạo, không phải người nhận ca)', async () => {
      resetStore();
      STORE.shiftSwapRequests.push({ id: 7, requesterRosterId: 1, requesterEmployeeCode: 'NV1', targetEmployeeCode: 'NV2', creator: 'store1', status: 'PENDING', history: [] });
      const r = await call('storeMgr1', 'POST', '/api/records/shiftSwapRequests/7/approve', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    });
  } finally {
    server.close();
  }
}

(async () => {
  await partLeave();
  await partMeeting();
  await partShiftSwap();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
