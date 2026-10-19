// server/tests/test-shiftroster-create-store-spoofing.js
//
// LỖI ĐÃ VÁ (re-audit lần 8, mức Cao — "shiftRoster tạo mới thiếu chặn đúng siêu thị
// (store-spoofing)"): CREATE_MODULE_CONFIGS.shiftRoster.extraValidate (lib/createValidation.js) chỉ
// kiểm có 1 trong 3 quyền admin/hrShiftRosterManage/hrAttendanceManage, KHÔNG đối chiếu storeCode (đọc
// THÔ từ payload) với user.dept khi actor CHỈ có hrShiftRosterManage — khác hẳn canViewShiftRoster()
// (lib/recordViewScope.js, canSeeHacRosterManageAll() yêu cầu item.storeCode === user.dept) và route
// POST /shiftRoster/:id/cancel (routes/records.js) đã đúng `hrShiftRosterManage && item.storeCode ===
// freshUser.dept`. 1 Quản Lý Siêu Thị A (chỉ hrShiftRosterManage) có thể tạo dòng phân ca "ma" cho Siêu
// Thị B — Siêu Thị B không tạo lại được lịch THẬT cho đúng nhân viên/ngày đó (assertNoRosterConflict()
// chặn nhầm), và dòng storeCode sai còn ảnh hưởng quyền duyệt đổi ca (assertShiftSwapApprover() dùng
// roster.storeCode).
//
// Đã vá: khi actor KHÔNG phải admin/hrAttendanceManage (chỉ hrShiftRosterManage), bắt buộc
// valid.storeCode === user.dept.
//
// Chạy: node server/tests/test-shiftroster-create-store-spoofing.js
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

const STORE = { shiftRoster: [] };
let nextId = 1;
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(STORE)),
  getAllForCollection: async (c) => (STORE[c] || []).slice(),
  getAllForCollectionCached: async (c) => (STORE[c] || []).slice(),
  getTrashItems: async () => [],
  withAppLock: async (key, fn) => fn(),
  createForCollection: async (c, builderFn) => {
    const draft = await builderFn((STORE[c] || []).slice());
    const item = Object.assign({ id: nextId++ }, draft);
    STORE[c].push(item);
    return item;
  },
  createForCollectionSerialized: async (c, lockKey, builderFn) => {
    const draft = await builderFn((STORE[c] || []).slice());
    const item = Object.assign({ id: nextId++ }, draft);
    STORE[c].push(item);
    return item;
  },
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = STORE[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    list[idx] = await mutatorFn(list[idx]);
    return list[idx];
  }
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {}, querySystemLogs: async () => ({ items: [], total: 0 }) });

const USERS = [
  { username: 'storeMgrA', name: 'Quản Lý Siêu Thị A', dept: 'Siêu Thị A', perms: { hrShiftRosterManage: true }, active: true },
  { username: 'hr1', name: 'HR Toàn Công Ty', dept: 'Nhân Sự', perms: { hrAttendanceManage: true }, active: true },
  { username: 'admin1', name: 'Admin', dept: 'Nhân Sự', perms: { admin: true }, active: true }
];
let APP_DATA;
function resetAppData() {
  APP_DATA = {
    users: USERS, depts: ['Nhân Sự'], stores: ['Siêu Thị A', 'Siêu Thị B'],
    shiftTemplates: [{ id: 1, name: 'Ca Sáng' }], formTemplates: []
  };
  STORE.shiftRoster = []; nextId = 1;
}
resetAppData();
stubModule('lib/appData', {
  getAppDataValue: async (key) => (APP_DATA[key] !== undefined ? APP_DATA[key] : null),
  getAllAppData: async () => Object.assign({}, APP_DATA),
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});
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

async function main() {
  const createRoutes = require('../routes/create');
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, body) {
    const res = await fetch(`${base}/api/create/shiftRoster`, {
      method: 'POST', headers: { 'x-demo-user': username, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  try {
    await test('LỖI ĐÃ VÁ: Quản Lý Siêu Thị A (chỉ hrShiftRosterManage) tạo lịch phân ca với storeCode = Siêu Thị B (KHÁC dept) -> 403', async () => {
      resetAppData();
      const r = await call('storeMgrA', { employeeCode: 'NV1', workDate: '2099-01-10', shiftTemplateId: 1, storeCode: 'Siêu Thị B' });
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
      assert.ok(/đúng siêu thị/.test(r.json.error), JSON.stringify(r.json));
      assert.strictEqual(STORE.shiftRoster.length, 0, 'không được tạo dòng phân ca nào');
    });

    await test('đối chứng: Quản Lý Siêu Thị A tạo lịch phân ca với storeCode = ĐÚNG Siêu Thị A vẫn thành công', async () => {
      resetAppData();
      const r = await call('storeMgrA', { employeeCode: 'NV1', workDate: '2099-01-10', shiftTemplateId: 1, storeCode: 'Siêu Thị A' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.storeCode, 'Siêu Thị A');
    });

    await test('đối chứng: hrAttendanceManage (quản lý toàn công ty) tạo lịch phân ca cho Siêu Thị B vẫn thành công (không bị ép dept)', async () => {
      resetAppData();
      const r = await call('hr1', { employeeCode: 'NV2', workDate: '2099-01-10', shiftTemplateId: 1, storeCode: 'Siêu Thị B' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.storeCode, 'Siêu Thị B');
    });

    await test('đối chứng: admin tạo lịch phân ca cho bất kỳ siêu thị nào vẫn thành công', async () => {
      resetAppData();
      const r = await call('admin1', { employeeCode: 'NV3', workDate: '2099-01-10', shiftTemplateId: 1, storeCode: 'Siêu Thị B' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
