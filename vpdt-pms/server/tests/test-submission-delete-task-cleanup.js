// server/tests/test-submission-delete-task-cleanup.js
//
// LOI DA VA (re-audit lan 4, muc TB): Cong Viec tu sinh khi 1 to trinh (Van Ban Trinh) duoc duyet
// HOAN TAT o buoc CUOI CUNG kem y kien chi dao (buildTaskFromSubmissionComment(), lib/recordActions.js
// — sourceType='SUBMISSION', sourceCode=ma to trinh) truoc day KHONG he duoc dong lai khi XOA han to
// trinh nguon (POST /api/records/submissions/:id/delete) — Cong Viec con TODO/DOING van "song" vinh
// vien du to trinh nguon da khong con ton tai, "Xem chi tiet" tro ve 1 ma to trinh khong con ton tai.
//
// Cung khuon tests/test-hrprocess-cancel-itticket-cleanup.js (Express app THAT mount routes/records.js,
// tang luu tru in-memory qua stub lib/recordStore + lib/taskStore).
//
// Chay: node server/tests/test-submission-delete-task-cleanup.js
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

const STORE = { submissions: [] };
let TASKS = [];

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['submissions']),
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
  getAllTasks: async () => TASKS.slice(),
  withLockedTaskById: async (id, mutatorFn) => {
    const idx = TASKS.findIndex(t => t.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy công việc'); }
    TASKS[idx] = await mutatorFn(TASKS[idx]);
    return TASKS[idx];
  },
  insertTask: async (t) => { const item = { ...t }; TASKS.push(item); return item; },
  deleteTaskById: async (id) => { TASKS = TASKS.filter(t => t.id !== Number(id)); },
  migrateDirectiveTaskLinks: async () => {}
});

const SYSTEM_LOGS = [];
stubModule('lib/systemLogStore', {
  insertSystemLog: async (entry) => { SYSTEM_LOGS.push(entry); return entry; },
  querySystemLogs: async () => ({ items: [], total: 0 })
});

const USERS = [
  { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true },
  { username: 'nv.a', name: 'Nguyễn Văn A', dept: 'Kinh Doanh', perms: {}, active: true }
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

function makeSubmission(overrides) {
  return Object.assign({
    id: 1, code: 'VBT-001', title: 'Tờ trình xin mua máy chiếu', creator: 'nv.a', status: 'COMPLETED'
  }, overrides || {});
}

function makeTask(overrides) {
  return Object.assign({
    id: 100, title: 'Thực hiện theo chỉ đạo: Tờ trình xin mua máy chiếu', description: 'Mua ngay trong tuần',
    deadline: '', assignedTo: '', assignedToName: '', assignedBy: 'tgd', assignedByName: 'Tổng Giám Đốc',
    sourceType: 'SUBMISSION', sourceCode: 'VBT-001', status: 'TODO',
    extensionCount: 0, lateCount: 0, pendingExtension: null, pendingCancellation: null,
    createdAt: '01/01/2026 10:00:00', history: [{ action: 'CREATED', by: 'tgd', byName: 'Tổng Giám Đốc', time: '01/01/2026 10:00:00' }]
  }, overrides || {});
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
    await test('LỖI ĐÃ VÁ: xoá Văn Bản Trình có Công Việc còn TODO (chưa gán người nhận) -> Công Việc tự huỷ (CANCELLED)', async () => {
      STORE.submissions = [makeSubmission()];
      TASKS = [makeTask()];
      const r = await call('admin', 'POST', '/api/records/submissions/1/delete', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(TASKS.find(t => t.id === 100).status, 'CANCELLED', 'LỖI ĐÃ VÁ: Công Việc phải tự huỷ khi tờ trình nguồn bị xoá');
      assert.ok(SYSTEM_LOGS.some(l => l.actionType === 'AUTO_CANCEL_TASK'), 'phải ghi nhật ký hệ thống');
    });

    await test('Công Việc đang DOING (đã được gán/nhận xử lý) khi xoá tờ trình -> cũng tự huỷ', async () => {
      STORE.submissions = [makeSubmission()];
      TASKS = [makeTask({ status: 'DOING', assignedTo: 'nv.a', assignedToName: 'Nguyễn Văn A' })];
      const r = await call('admin', 'POST', '/api/records/submissions/1/delete', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(TASKS.find(t => t.id === 100).status, 'CANCELLED');
    });

    await test('Công Việc ĐÃ DONE từ trước khi xoá tờ trình -> KHÔNG bị đụng lại (idempotent, không ghi đè kết quả đã hoàn thành)', async () => {
      STORE.submissions = [makeSubmission()];
      TASKS = [makeTask({ status: 'DONE', history: [{ action: 'CREATED', by: 'tgd', byName: 'Tổng Giám Đốc', time: '01/01/2026 10:00:00' }, { action: 'DONE', by: 'nv.a', byName: 'Nguyễn Văn A', time: '02/01/2026 10:00:00' }] })];
      const historyLenBefore = TASKS[0].history.length;
      const r = await call('admin', 'POST', '/api/records/submissions/1/delete', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const task = TASKS.find(t => t.id === 100);
      assert.strictEqual(task.status, 'DONE', 'giữ nguyên DONE, không ghi đè kết quả đã hoàn thành');
      assert.strictEqual(task.history.length, historyLenBefore, 'không thêm dòng lịch sử vào Công Việc đã DONE');
    });

    await test('xoá tờ trình KHÔNG có Công Việc nào liên quan -> không lỗi', async () => {
      STORE.submissions = [makeSubmission()];
      TASKS = [];
      const r = await call('admin', 'POST', '/api/records/submissions/1/delete', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    });

    await test('Công Việc của 1 tờ trình KHÁC (sourceCode khác) -> KHÔNG bị đụng tới khi xoá tờ trình này', async () => {
      STORE.submissions = [makeSubmission()];
      TASKS = [makeTask({ id: 200, sourceCode: 'VBT-002' })];
      const r = await call('admin', 'POST', '/api/records/submissions/1/delete', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(TASKS.find(t => t.id === 200).status, 'TODO', 'Công Việc của tờ trình khác phải giữ nguyên');
    });

    await test('Người KHÔNG phải admin xoá tờ trình -> 403, KHÔNG đụng tới Công Việc', async () => {
      STORE.submissions = [makeSubmission()];
      TASKS = [makeTask()];
      const r = await call('nv.a', 'POST', '/api/records/submissions/1/delete', {});
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
      assert.strictEqual(TASKS.find(t => t.id === 100).status, 'TODO', 'bị từ chối xoá -> Công Việc không bị đụng');
      assert.strictEqual(STORE.submissions.length, 1, 'tờ trình vẫn còn (chưa xoá)');
    });
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
