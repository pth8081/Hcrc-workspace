// server/tests/test-shiftroster-cancel-swap-cleanup.js
//
// LOI DA VA (re-audit lan 5, muc Trung Binh, #141 "Huy/xoa shiftRoster khong xu ly shiftSwapRequests
// PENDING"): POST /shiftRoster/:id/cancel va /shiftRoster/:id/delete (admin-only) khong he xu ly cac
// shiftSwapRequests CON PENDING dang tham chieu dung dong roster do (requesterRosterId === roster.id) —
// don van hien thi "cho duyet" vinh vien trong hang cho cua Quan Ly Sieu Thi/HR
// (computeMyPendingApprovalKeys() — lib/approvalAggregator.js, nhanh admin/hrAttendanceManage KHONG loc
// theo roster con ton tai hay khong), du duyet len chac chan bi chan (applyApproveShiftSwap() da kiem
// targetRoster null/CANCELLED).
//
// Khuon giong Phan B cua tests/test-attendance-leave.js (dung Express app THAT mount routes/create.js +
// routes/records.js, tang luu tru in-memory) — rut gon chi con shiftRoster/shiftSwapRequests.
//
// Chay: node server/tests/test-shiftroster-cancel-swap-cleanup.js
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

const EMPLOYEE_PROFILES = [
  { employeeCode: 'NV1', username: 'store1', status: 'ACTIVE' },
  { employeeCode: 'NV2', username: 'store2', status: 'ACTIVE' }
];
let STORE;
function resetStore() {
  STORE = { shiftRoster: [], shiftSwapRequests: [], employeeProfiles: EMPLOYEE_PROFILES };
}
resetStore();
let nextId = 1;

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['shiftRoster', 'shiftSwapRequests', 'employeeProfiles']),
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
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
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

stubModule('lib/systemLogStore', {
  insertSystemLog: async (entry) => entry,
  querySystemLogs: async () => ({ items: [], total: 0 })
});

const USERS = [
  { username: 'store1', name: 'Nhân Viên Siêu Thị 1', dept: 'Siêu Thị A', posType: 'STORE', perms: {}, active: true },
  { username: 'store2', name: 'Nhân Viên Siêu Thị 2', dept: 'Siêu Thị A', posType: 'STORE', perms: {}, active: true },
  { username: 'storeMgr1', name: 'Quản Lý Siêu Thị A', dept: 'Siêu Thị A', posType: 'STORE', perms: { hrShiftRosterManage: true, hrShiftSwapApprove: true }, active: true },
  { username: 'hr1', name: 'Nhân Sự Một', dept: 'Nhân Sự', perms: { hrAttendanceManage: true }, active: true },
  { username: 'admin', name: 'Quản Trị Viên', dept: 'Nhân Sự', perms: { admin: true }, active: true }
];
const APP_DATA = { users: USERS, employeeProfiles: EMPLOYEE_PROFILES, depts: ['Nhân Sự'], stores: ['Siêu Thị A'], shiftTemplates: [], publicHolidays: [], attendanceHoConfig: {} };
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const username = req.headers['x-demo-user'];
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
  getAppDataValue: async (key) => (APP_DATA[key] !== undefined ? APP_DATA[key] : null),
  getAllAppData: async () => Object.assign({}, APP_DATA),
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

const createRoutes = require('../routes/create');
const recordRoutes = require('../routes/records');

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  app.use('/api/records', recordRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, method, urlPath, body) {
    const res = await fetch(`${base}${urlPath}`, {
      method, headers: Object.assign({ 'x-demo-user': username }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null; try { json = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, json };
  }

  async function createRoster(employeeCode, workDate) {
    const r = await call('storeMgr1', 'POST', '/api/create/shiftRoster', { employeeCode, workDate, shiftTemplateId: 1, storeCode: 'Siêu Thị A' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    return r.json.item.id;
  }
  async function createSwap(requesterUsername, requesterRosterId, targetEmployeeCode) {
    const r = await call(requesterUsername, 'POST', '/api/create/shiftSwapRequests', { requesterRosterId, targetEmployeeCode, reason: 'Bận việc gia đình' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    return r.json.item.id;
  }

  try {
    await test('LỖI ĐÃ VÁ: huỷ 1 dòng shiftRoster đang có shiftSwapRequest PENDING -> đơn tự REJECTED (không kẹt "chờ duyệt")', async () => {
      resetStore(); nextId = 1;
      const rosterId = await createRoster('NV1', '2026-05-04');
      const swapId = await createSwap('store1', rosterId, 'NV2');
      assert.strictEqual(STORE.shiftSwapRequests.find(s => s.id === swapId).status, 'PENDING');

      const rc = await call('storeMgr1', 'POST', `/api/records/shiftRoster/${rosterId}/cancel`, {});
      assert.strictEqual(rc.status, 200, JSON.stringify(rc.json));
      const swap = STORE.shiftSwapRequests.find(s => s.id === swapId);
      assert.strictEqual(swap.status, 'REJECTED', 'LỖI ĐÃ VÁ: shiftSwapRequest phải tự REJECTED khi dòng roster liên kết bị huỷ, không còn kẹt PENDING vĩnh viễn');
      assert.strictEqual(swap.approverName, 'Hệ Thống (Tự Động)');
    });

    await test('LỖI ĐÃ VÁ: xoá hẳn (admin) 1 dòng shiftRoster đang có shiftSwapRequest PENDING -> đơn cũng tự REJECTED', async () => {
      resetStore(); nextId = 1;
      const rosterId = await createRoster('NV1', '2026-05-04');
      const swapId = await createSwap('store1', rosterId, 'NV2');

      const rd = await call('admin', 'POST', `/api/records/shiftRoster/${rosterId}/delete`, {});
      assert.strictEqual(rd.status, 200, JSON.stringify(rd.json));
      assert.strictEqual(STORE.shiftRoster.find(r => r.id === rosterId), undefined, 'dòng roster phải bị xoá hẳn');
      const swap = STORE.shiftSwapRequests.find(s => s.id === swapId);
      assert.strictEqual(swap.status, 'REJECTED', 'LỖI ĐÃ VÁ: xoá hẳn roster cũng phải tự REJECTED đơn đổi ca PENDING liên kết (cùng cơ chế /cancel)');
    });

    await test('huỷ roster -> KHÔNG đụng shiftSwapRequest của 1 dòng roster KHÁC còn PENDING (không huỷ nhầm)', async () => {
      resetStore(); nextId = 1;
      const rosterId1 = await createRoster('NV1', '2026-05-04');
      const rosterId2 = await createRoster('NV1', '2026-05-05');
      const swapId2 = await createSwap('store1', rosterId2, 'NV2');

      await call('storeMgr1', 'POST', `/api/records/shiftRoster/${rosterId1}/cancel`, {});
      const swap2 = STORE.shiftSwapRequests.find(s => s.id === swapId2);
      assert.strictEqual(swap2.status, 'PENDING', 'đơn đổi ca của dòng roster KHÁC (chưa bị huỷ) phải giữ nguyên PENDING, không bị đụng nhầm');
    });

    await test('đơn đổi ca ĐÃ APPROVED/REJECTED từ trước khi huỷ roster -> KHÔNG bị ghi đè lại (idempotent)', async () => {
      resetStore(); nextId = 1;
      const rosterId = await createRoster('NV1', '2026-05-04');
      const swapId = await createSwap('store1', rosterId, 'NV2');
      const rr = await call('storeMgr1', 'POST', `/api/records/shiftSwapRequests/${swapId}/reject`, {});
      assert.strictEqual(rr.status, 200, JSON.stringify(rr.json));
      const approverBefore = STORE.shiftSwapRequests.find(s => s.id === swapId).approverUsername;

      const rc = await call('storeMgr1', 'POST', `/api/records/shiftRoster/${rosterId}/cancel`, {});
      assert.strictEqual(rc.status, 200, JSON.stringify(rc.json));
      const swap = STORE.shiftSwapRequests.find(s => s.id === swapId);
      assert.strictEqual(swap.status, 'REJECTED');
      assert.strictEqual(swap.approverUsername, approverBefore, 'không ghi đè approverUsername của quyết định thật đã có (vẫn là storeMgr1, không phải system)');
    });

    await test('huỷ roster KHÔNG có đơn đổi ca nào tham chiếu -> không lỗi, hoạt động như cũ', async () => {
      resetStore(); nextId = 1;
      const rosterId = await createRoster('NV1', '2026-05-04');
      const rc = await call('storeMgr1', 'POST', `/api/records/shiftRoster/${rosterId}/cancel`, {});
      assert.strictEqual(rc.status, 200, JSON.stringify(rc.json));
      assert.strictEqual(rc.json.item.status, 'CANCELLED');
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
