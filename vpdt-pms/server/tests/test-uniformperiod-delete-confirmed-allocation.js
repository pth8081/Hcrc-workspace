// server/tests/test-uniformperiod-delete-confirmed-allocation.js
//
// LỖI ĐÃ VÁ (re-audit lần 5, mức Trung Bình — "Xoá uniformPeriods không kiểm tham chiếu -> tồn kho
// âm"): POST /api/records/uniformPeriods/:id/delete trước đây dùng thẳng deleteAdminOnly() chung — xoá
// được VÔ ĐIỀU KIỆN 1 kỳ cấp phát đồng phục dù đã có allocations[] ĐÃ XÁC NHẬN (status 'CONFIRMED',
// confirmUniformAllocation()) — computeUniformStock() (lib/recordActions.js) cộng "allocated" từ
// allocations CONFIRMED của MỌI kỳ, trong khi uniformIssuances/uniformStockAdjustments/uniformTransfers
// trừ kho khớp theo itemName/size/dept (KHÔNG tham chiếu periodId). Xoá kỳ đã CONFIRMED làm "nguồn
// cung" biến mất khỏi phép tính nhưng phần đã cấp phát/điều chỉnh dựa trên nguồn cung đó vẫn còn
// nguyên -> tồn kho tính lại ÂM, không có cách quay lại (không có action "huỷ xác nhận phân bổ").
//
// Cùng khuôn tests/test-reportperiod-delete-referencing-entries.js (HTTP thực qua mount
// routes/records.js, stub lib/recordStore lưu trữ in-memory).
//
// Chạy: node server/tests/test-uniformperiod-delete-confirmed-allocation.js
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

const STORE = { uniformPeriods: [], uniformIssuances: [], uniformStockAdjustments: [], uniformTransfers: [] };

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['uniformPeriods', 'uniformIssuances', 'uniformStockAdjustments', 'uniformTransfers']),
  getAllForCollection: async (c) => (STORE[c] || []).slice(),
  getAllForCollectionCached: async (c) => (STORE[c] || []).slice(),
  getTrashItems: async () => [],
  withAppLock: async (key, fn) => fn(),
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
  { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true, moduleAccess: { uniform: true } }, active: true },
  { username: 'nv.a', name: 'Nguyễn Văn A', dept: 'Siêu Thị A', perms: { uniformManage: true, moduleAccess: { uniform: true } }, active: true }
];

stubModule('lib/appData', {
  getAppDataValue: async () => null,
  getAllAppData: async () => ({ users: USERS }),
  withLockedAppDataValue: async (key, fn) => fn(null)
});

let CURRENT_USER = 'admin';
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USER);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const recordRoutes = require('../routes/records');

function makePeriod(overrides) {
  return Object.assign({ id: 1, code: 'DP-2026-11', name: 'Kỳ cấp phát tháng 11/2026', allocations: [] }, overrides || {});
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, method, urlPath, body) {
    CURRENT_USER = username;
    const res = await fetch(`${base}${urlPath}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null; try { json = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, json };
  }

  try {
    await test('LỖI ĐÃ VÁ: xoá kỳ còn 1 allocation ĐÃ XÁC NHẬN (CONFIRMED) -> 409, KHÔNG xoá được', async () => {
      STORE.uniformPeriods = [makePeriod({
        allocations: [{ id: 1, dept: 'Siêu Thị A', status: 'CONFIRMED', items: [{ name: 'Áo', size: 'L', qty: 10 }] }]
      })];
      const r = await call('admin', 'POST', '/api/records/uniformPeriods/1/delete', {});
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
      assert.ok(/xác nhận/.test(r.json.error || ''), JSON.stringify(r.json));
      assert.strictEqual(STORE.uniformPeriods.length, 1, 'kỳ không được xoá khi còn allocation đã xác nhận');
    });

    await test('LỖI ĐÃ VÁ: 2 trong 3 allocation CONFIRMED (1 PENDING_CONFIRM) -> vẫn chặn 409, nêu đúng số lượng', async () => {
      STORE.uniformPeriods = [makePeriod({
        allocations: [
          { id: 1, dept: 'Siêu Thị A', status: 'CONFIRMED', items: [] },
          { id: 2, dept: 'Siêu Thị B', status: 'CONFIRMED', items: [] },
          { id: 3, dept: 'Siêu Thị C', status: 'PENDING_CONFIRM', items: [] }
        ]
      })];
      const r = await call('admin', 'POST', '/api/records/uniformPeriods/1/delete', {});
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
      assert.ok(/2\s+siêu thị/.test(r.json.error || ''), JSON.stringify(r.json));
    });

    await test('đối chứng: TOÀN BỘ allocation còn PENDING_CONFIRM (chưa ai xác nhận) -> xoá thành công bình thường', async () => {
      STORE.uniformPeriods = [makePeriod({
        allocations: [{ id: 1, dept: 'Siêu Thị A', status: 'PENDING_CONFIRM', items: [] }]
      })];
      const r = await call('admin', 'POST', '/api/records/uniformPeriods/1/delete', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(STORE.uniformPeriods.length, 0);
    });

    await test('đối chứng: kỳ KHÔNG có allocation nào (vừa tạo xong) -> xoá thành công bình thường', async () => {
      STORE.uniformPeriods = [makePeriod({ allocations: [] })];
      const r = await call('admin', 'POST', '/api/records/uniformPeriods/1/delete', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(STORE.uniformPeriods.length, 0);
    });

    await test('Người KHÔNG phải admin xoá kỳ -> 403 (giữ đúng gate cũ, không bị đổi khi thêm check tham chiếu)', async () => {
      STORE.uniformPeriods = [makePeriod({ allocations: [] })];
      const r = await call('nv.a', 'POST', '/api/records/uniformPeriods/1/delete', {});
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
      assert.strictEqual(STORE.uniformPeriods.length, 1);
    });

    await test('id không hợp lệ -> 400', async () => {
      const r = await call('admin', 'POST', '/api/records/uniformPeriods/abc/delete', {});
      assert.strictEqual(r.status, 400);
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
