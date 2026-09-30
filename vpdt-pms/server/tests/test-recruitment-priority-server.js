// tests/test-recruitment-priority-server.js — Tuyển Dụng (9/2026), phía SERVER:
//  - field Thu Nhập (income): chuẩn hoá ở normalizeRecruitmentJobFields() (TẠO + SỬA).
//  - Đẩy ưu tiên: POST /api/records/recruitmentJobs/:id/pin + /unpin (routes/records.js THẬT) —
//    gác quyền admin||internalRecruitmentCreate (TÁI DÙNG canManageRecruitment(), không có key mới),
//    pinned/pinnedBy/pinnedAt do SERVER gán, lúc TẠO không tin pinned client gửi, SỬA không đổi được pin.
// Kiến trúc: y hệt tests/test-audit-round2-internalcomms-training-routes.js — express router THẬT, chỉ giả
// lập tầng lưu trữ + xác thực.
//
// Chạy: node tests/test-recruitment-priority-server.js
'use strict';
const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let PORT = 0;
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const HR = { username: 'hr1', name: 'Nhân Sự Một', dept: 'Hành Chính', perms: { internalRecruitmentCreate: true }, active: true };
const NV1 = { username: 'nv1', name: 'Nhân Viên Một', dept: 'Kinh Doanh', perms: {}, active: true };
const USERS = [ADMIN, HR, NV1];
const RECORDS = {};
function resetRecords() {
  RECORDS.recruitmentJobs = [
    { id: 10, title: 'Thu ngân', description: 'x', contactInfo: '0900', status: 'OPEN', creator: HR.username },
    { id: 11, title: 'Bảo vệ', description: 'y', contactInfo: '0901', status: 'CLOSED', creator: HR.username },
    { id: 12, title: 'Kho', description: 'z', contactInfo: '0902', status: 'OPEN', creator: HR.username, pinned: true, pinnedBy: 'hr1', pinnedAt: '2026-09-01T00:00:00.000Z' }
  ];
}
resetRecords();
let CURRENT_USERNAME = ADMIN.username;
const { HttpError } = require('../lib/httpErrors');

stubModule('lib/appData', {
  getAppDataValue: async () => null,
  getAppDataValueCached: async () => null,
  getAllAppData: async () => ({ users: USERS, depts: ['Kinh Doanh', 'Hành Chính', 'Ban Giám Đốc'], stores: [], formTemplates: {} }),
  withLockedAppDataValue: async (key, fn) => fn(null)
});
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['recruitmentJobs']),
  getAllForCollectionCached: async (c) => RECORDS[c] || [],
  getAllForCollection: async (c) => RECORDS[c] || [],
  getTrashItems: async () => [],
  withLockedRecordForCollection: async (c, id, mutator) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    const clone = JSON.parse(JSON.stringify(list[idx])); // mutator throw -> KHÔNG ghi (giống store thật)
    const updated = await mutator(clone);
    list[idx] = updated;
    return updated;
  },
  createForCollection: async () => { throw new Error('không dùng'); },
  insertRecord: async () => { throw new Error('không dùng'); },
  deleteRecordForCollection: async () => { throw new Error('không dùng'); },
  createForCollectionSerialized: async () => { throw new Error('không dùng'); },
  withLockedRecordById: async () => { throw new Error('không dùng'); },
  withAppLock: async (key, fn) => fn()
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [], getAllTasks: async () => [], insertTask: async () => {}, withLockedTaskById: async () => {}, deleteTaskById: async () => {}, migrateDirectiveTaskLinks: async () => 0 });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [], getAllWorkItems: async () => [], getWorkItemsBySource: async () => [], insertWorkItem: async () => {}, withLockedWorkItemById: async () => {}, deleteWorkItemById: async () => {}, deleteWorkItemsByIds: async () => {} });
stubModule('lib/uploadedFiles', { recordUploadedFile: async () => {}, getFileUrlOwners: async () => new Map(), assertPayloadFileUrlsOwnedByUser: async () => {}, collectFileUrlsDeep: () => {} });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {}, getAllSystemLogsCached: async () => [] });
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    req.user = { username: fresh.username, name: fresh.name }; req.freshUser = fresh; req.allUsers = USERS; next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => `hashed:${p}`, isBcryptHash: (v) => String(v || '').startsWith('hashed:'), validatePin: () => null
});
stubModule('lib/emailCrypto', { encryptSecret: (s) => `enc:${s}` });

const express = require('express');
const { createRunner, assert, assertEqual } = require('./testHarness');
const recordRoutes = require('../routes/records');
const cv = require('../lib/createValidation');
const ra = require('../lib/recordActions');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}
async function api(urlPath, body, asUser) {
  CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  let payload = null; try { payload = await res.json(); } catch (_) { /* ignore */ }
  return { status: res.status, body: payload };
}

async function main() {
  const server = await startApp();
  const run = createRunner();
  const APP = { depts: ['Kinh Doanh'], stores: [], formTemplates: {} };
  try {
    await run.run('income: TẠO chuẩn hoá (trim, cắt 200 ký tự), bỏ trống = ""; pinned client gửi lúc TẠO bị bỏ qua', async () => {
      const p = { title: 'Thu ngân', description: 'Mô tả', contactInfo: '0900', income: '  8-10 triệu  ', pinned: true, pinnedBy: 'hacker', pinnedAt: '2099-01-01' };
      cv.CREATE_MODULE_CONFIGS.recruitmentJobs.extraValidate(p, [], HR, APP);
      assertEqual(p.income, '8-10 triệu');
      assertEqual(p.pinned, false, 'không tin pinned từ client');
      assertEqual(p.pinnedBy, null); assertEqual(p.pinnedAt, null);
      const p2 = { title: 'A', description: 'B', contactInfo: 'C', income: 'x'.repeat(500) };
      cv.CREATE_MODULE_CONFIGS.recruitmentJobs.extraValidate(p2, [], HR, APP);
      assertEqual(p2.income.length, 200, 'cắt 200 ký tự');
      const p3 = { title: 'A', description: 'B', contactInfo: 'C' };
      cv.CREATE_MODULE_CONFIGS.recruitmentJobs.extraValidate(p3, [], HR, APP);
      assertEqual(p3.income, '');
    });

    await run.run('income: SỬA cập nhật được; SỬA KHÔNG đổi được pinned/pinnedBy/pinnedAt', async () => {
      resetRecords();
      const r = await api('/api/records/recruitmentJobs/10/edit', { income: 'Thoả thuận', pinned: true, pinnedAt: '2099-01-01' }, HR);
      assertEqual(r.status, 200, JSON.stringify(r.body));
      assertEqual(r.body.item.income, 'Thoả thuận');
      assert(!r.body.item.pinned, 'edit không được bật pin');
    });

    await run.run('workTime (10/2026): TẠO chuẩn hoá (trim, cắt 200 ký tự), bỏ trống = ""', async () => {
      const p = { title: 'Thu ngân', description: 'Mô tả', contactInfo: '0900', workTime: '  Toàn thời gian  ' };
      cv.CREATE_MODULE_CONFIGS.recruitmentJobs.extraValidate(p, [], HR, APP);
      assertEqual(p.workTime, 'Toàn thời gian');
      const p2 = { title: 'A', description: 'B', contactInfo: 'C', workTime: 'x'.repeat(500) };
      cv.CREATE_MODULE_CONFIGS.recruitmentJobs.extraValidate(p2, [], HR, APP);
      assertEqual(p2.workTime.length, 200, 'cắt 200 ký tự');
      const p3 = { title: 'A', description: 'B', contactInfo: 'C' };
      cv.CREATE_MODULE_CONFIGS.recruitmentJobs.extraValidate(p3, [], HR, APP);
      assertEqual(p3.workTime, '');
    });

    await run.run('workTime: SỬA cập nhật được qua route thật', async () => {
      resetRecords();
      const r = await api('/api/records/recruitmentJobs/10/edit', { workTime: 'Ca sáng 7h-15h' }, HR);
      assertEqual(r.status, 200, JSON.stringify(r.body));
      assertEqual(r.body.item.workTime, 'Ca sáng 7h-15h');
    });

    await run.run('pin: nhân sự (internalRecruitmentCreate) đẩy ưu tiên tin OPEN -> pinned/pinnedBy/pinnedAt do server gán', async () => {
      resetRecords();
      const before = Date.now();
      const r = await api('/api/records/recruitmentJobs/10/pin', { pinnedBy: 'hacker', pinnedAt: '2000-01-01' }, HR);
      assertEqual(r.status, 200, JSON.stringify(r.body));
      assertEqual(r.body.item.pinned, true);
      assertEqual(r.body.item.pinnedBy, 'hr1');
      assert(new Date(r.body.item.pinnedAt).getTime() >= before - 1000, `pinnedAt phải là giờ server: ${r.body.item.pinnedAt}`);
    });

    await run.run('pin: nhân viên thường KHÔNG có quyền -> 403, dữ liệu giữ nguyên', async () => {
      resetRecords();
      const r = await api('/api/records/recruitmentJobs/10/pin', {}, NV1);
      assertEqual(r.status, 403);
      assert(!RECORDS.recruitmentJobs[0].pinned, 'không được đổi dữ liệu');
    });

    await run.run('pin: tin đã đóng -> 409; tin đã đẩy ưu tiên rồi -> 409', async () => {
      resetRecords();
      assertEqual((await api('/api/records/recruitmentJobs/11/pin', {}, ADMIN)).status, 409);
      assertEqual((await api('/api/records/recruitmentJobs/12/pin', {}, ADMIN)).status, 409);
    });

    await run.run('unpin: nhân sự bỏ đẩy ưu tiên -> pinned false, pinnedBy/pinnedAt null; nhân viên thường 403; tin chưa pin 409', async () => {
      resetRecords();
      assertEqual((await api('/api/records/recruitmentJobs/12/unpin', {}, NV1)).status, 403);
      const r = await api('/api/records/recruitmentJobs/12/unpin', {}, HR);
      assertEqual(r.status, 200, JSON.stringify(r.body));
      assertEqual(r.body.item.pinned, false);
      assertEqual(r.body.item.pinnedBy, null);
      assertEqual(r.body.item.pinnedAt, null);
      assertEqual((await api('/api/records/recruitmentJobs/10/unpin', {}, HR)).status, 409);
    });

    await run.run('recordActions export pinRecruitmentJob/unpinRecruitmentJob (mirror unpinInternalPost)', async () => {
      assertEqual(typeof ra.pinRecruitmentJob, 'function');
      assertEqual(typeof ra.unpinRecruitmentJob, 'function');
    });
  } finally {
    server.close();
  }
  run.summary();
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
