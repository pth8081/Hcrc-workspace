// server/tests/test-reportperiod-delete-referencing-entries.js
//
// LOI DA VA (re-audit lan 4, muc TB): POST /api/records/reportPeriods/:id/delete truoc day dung thang
// deleteAdminOnly() chung — xoa duoc VO DIEU KIEN 1 ky Bao Cao Dinh Ky du dang co reportEntries tro
// periodId vao no, mo coi du lieu (bao cao NHAP/da nop khong con tra duoc ky goc, ket vinh vien o
// submit/update). Cung lop loi da va cho vppPeriods/:id/delete va budgetPeriods/:id/delete (2 route
// "lien ke" da co dung check nay tu truoc, rieng reportPeriods bi bo sot).
//
// Test HTTP thuc qua mount routes/records.js (stub lib/recordStore luu tru in-memory), cung khuon
// tests/test-submission-delete-task-cleanup.js.
//
// Chay: node server/tests/test-reportperiod-delete-referencing-entries.js
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

const STORE = { reportPeriods: [], reportEntries: [] };

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['reportPeriods', 'reportEntries']),
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

stubModule('lib/taskStore', {
  getAllTasks: async () => [],
  withLockedTaskById: async () => { throw new Error('không dùng ở test này'); },
  insertTask: async (t) => t,
  deleteTaskById: async () => {},
  migrateDirectiveTaskLinks: async () => {}
});

stubModule('lib/systemLogStore', {
  insertSystemLog: async (entry) => entry,
  querySystemLogs: async () => ({ items: [], total: 0 })
});

const USERS = [
  { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true },
  { username: 'nv.a', name: 'Nguyễn Văn A', dept: 'Kinh Doanh', perms: { reportManage: true }, active: true }
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
  return Object.assign({ id: 1, code: 'KY-2026-11', title: 'Báo cáo tháng 11/2026', status: 'OPEN' }, overrides || {});
}
function makeEntry(overrides) {
  return Object.assign({ id: 10, periodId: 1, dept: 'Kinh Doanh', creator: 'nv.a', status: 'DRAFT' }, overrides || {});
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
    await test('LỖI ĐÃ VÁ: xoá kỳ Báo Cáo Định Kỳ còn reportEntries (DRAFT) gắn với nó -> 409, KHÔNG xoá được', async () => {
      STORE.reportPeriods = [makePeriod()];
      STORE.reportEntries = [makeEntry()];
      const r = await call('admin', 'POST', '/api/records/reportPeriods/1/delete', {});
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
      assert.ok(/còn\s+1\s+báo cáo/.test(r.json.error || ''), JSON.stringify(r.json));
      assert.strictEqual(STORE.reportPeriods.length, 1, 'kỳ không được xoá khi còn báo cáo tham chiếu');
    });

    await test('LỖI ĐÃ VÁ: còn reportEntries ĐÃ NỘP (SUBMITTED, không chỉ DRAFT) -> vẫn chặn 409', async () => {
      STORE.reportPeriods = [makePeriod()];
      STORE.reportEntries = [makeEntry({ status: 'SUBMITTED' })];
      const r = await call('admin', 'POST', '/api/records/reportPeriods/1/delete', {});
      assert.strictEqual(r.status, 409, JSON.stringify(r.json));
    });

    await test('đối chứng: KHÔNG có reportEntries nào tham chiếu -> xoá thành công bình thường', async () => {
      STORE.reportPeriods = [makePeriod()];
      STORE.reportEntries = [];
      const r = await call('admin', 'POST', '/api/records/reportPeriods/1/delete', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(STORE.reportPeriods.length, 0);
    });

    await test('reportEntries của 1 KỲ KHÁC (periodId khác) -> KHÔNG chặn xoá kỳ này', async () => {
      STORE.reportPeriods = [makePeriod()];
      STORE.reportEntries = [makeEntry({ id: 20, periodId: 2 })];
      const r = await call('admin', 'POST', '/api/records/reportPeriods/1/delete', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(STORE.reportPeriods.length, 0);
    });

    await test('Người KHÔNG phải admin xoá kỳ -> 403 (giữ đúng gate cũ, không bị đổi khi thêm check tham chiếu)', async () => {
      STORE.reportPeriods = [makePeriod()];
      STORE.reportEntries = [];
      const r = await call('nv.a', 'POST', '/api/records/reportPeriods/1/delete', {});
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
      assert.strictEqual(STORE.reportPeriods.length, 1);
    });

    await test('id không hợp lệ -> 400', async () => {
      const r = await call('admin', 'POST', '/api/records/reportPeriods/abc/delete', {});
      assert.strictEqual(r.status, 400);
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
