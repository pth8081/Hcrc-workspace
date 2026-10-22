// tests/test-internal-news-manage-and-recruitment-delete.js
//
// 11/2026, theo yêu cầu người dùng ("thêm quyền sửa xóa đăng tin tuyển dụng và sửa xóa đăng bài trong
// nhịp sống để người quản lý có thể có quyền thay đổi"):
//
//  - internalNewsManage (quyền MỚI): cho sửa (chỉ DRAFT/NEED_INFO, GIỮ NGUYÊN trần cũ) + xoá (MỌI trạng
//    thái, KHÔNG cần thêm admin) bài type NEWS của NGƯỜI KHÁC. KHÔNG áp dụng cho SHARE/TRAINING.
//  - internalRecruitmentCreate (MỞ RỘNG phạm vi, không phải key mới): từ nay cũng xoá được recruitmentJobs
//    mà không cần thêm admin (edit/close/pin đã hoạt động vậy từ trước).
//
// Kiến trúc: y hệt tests/test-recruitment-priority-server.js / test-hrprocess-delete-permission.js —
// express router THẬT (routes/records.js), chỉ giả lập tầng lưu trữ + middleware xác thực.
//
// Chạy: node tests/test-internal-news-manage-and-recruitment-delete.js
'use strict';
const http = require('http');
const path = require('path');
const { HttpError } = require('../lib/httpErrors');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let PORT = 0;
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const NEWS_MANAGER = { username: 'pr1', name: 'Quản Lý Truyền Thông', dept: 'Hành Chính', perms: { internalNewsManage: true }, active: true };
const RECRUITER = { username: 'hr1', name: 'Nhân Sự Tuyển Dụng', dept: 'Hành Chính', perms: { internalRecruitmentCreate: true }, active: true };
const NV1 = { username: 'nv1', name: 'Nhân Viên Một', dept: 'Kinh Doanh', perms: {}, active: true };
const USERS = [ADMIN, NEWS_MANAGER, RECRUITER, NV1];

const RECORDS = {};
function resetRecords() {
  RECORDS.internalPosts = [
    { id: 1, code: 'TN-001', type: 'NEWS', status: 'DRAFT', title: 'Tin nháp của NV1', content: 'x', postCategory: 'GENERAL', author: NV1.username, dept: 'Kinh Doanh', comments: [], likes: [], readBy: [] },
    { id: 2, code: 'TN-002', type: 'NEWS', status: 'APPROVED', title: 'Tin đã đăng', content: 'x', postCategory: 'GENERAL', author: NV1.username, dept: 'Kinh Doanh', comments: [], likes: [], readBy: [] },
    { id: 3, code: 'CS-001', type: 'SHARE', status: 'DRAFT', title: 'Góc chia sẻ nháp', content: 'x', author: NV1.username, dept: 'Kinh Doanh', comments: [], likes: [], readBy: [] }
  ];
  RECORDS.recruitmentJobs = [
    { id: 10, title: 'Thu ngân', description: 'x', contactInfo: '0900', status: 'OPEN', creator: RECRUITER.username }
  ];
  RECORDS.recruitmentReferrals = [];
}
resetRecords();
let CURRENT_USERNAME = ADMIN.username;

stubModule('lib/appData', {
  getAppDataValue: async () => null,
  getAppDataValueCached: async () => null,
  getAllAppData: async () => ({
    users: USERS, depts: ['Kinh Doanh', 'Hành Chính', 'Ban Giám Đốc'], stores: [], formTemplates: {},
    internalNewsCategories: [{ key: 'GENERAL', label: 'Chung' }], internalShareCategories: []
  }),
  withLockedAppDataValue: async (key, fn) => fn(null)
});
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['internalPosts', 'recruitmentJobs']),
  getAllForCollectionCached: async (c) => RECORDS[c] || [],
  getAllForCollection: async (c) => RECORDS[c] || [],
  getTrashItems: async () => [],
  withLockedRecordForCollection: async (c, id, mutator) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    const clone = JSON.parse(JSON.stringify(list[idx]));
    const updated = await mutator(clone);
    list[idx] = updated;
    return updated;
  },
  deleteRecordForCollection: async (collection, id, checkFn) => {
    const list = RECORDS[collection] || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) { const e = new Error('Không tìm thấy hồ sơ'); e.status = 404; throw e; }
    if (checkFn) await checkFn(list[idx]);
    list.splice(idx, 1);
  },
  createForCollection: async () => { throw new Error('không dùng'); },
  insertRecord: async () => { throw new Error('không dùng'); },
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
const { createRunner, assertEqual } = require('./testHarness');
const recordRoutes = require('../routes/records');

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
  try {
    // ===== internalNewsManage — SỬA =====
    await run.run('internalNewsManage sửa được bài NEWS (DRAFT) của NGƯỜI KHÁC', async () => {
      resetRecords();
      const r = await api('/api/records/internalPosts/1/edit', { title: 'Đã sửa bởi quản lý' }, NEWS_MANAGER);
      assertEqual(r.status, 200, JSON.stringify(r.body));
      assertEqual(r.body.item.title, 'Đã sửa bởi quản lý');
    });

    await run.run('internalNewsManage KHÔNG sửa được bài NEWS đã APPROVED của người khác (giữ nguyên trần cũ — admin cũng không sửa được)', async () => {
      resetRecords();
      const r = await api('/api/records/internalPosts/2/edit', { title: 'x' }, NEWS_MANAGER);
      assertEqual(r.status, 409, JSON.stringify(r.body));
    });

    await run.run('internalNewsManage KHÔNG sửa được bài SHARE của người khác (chỉ áp dụng NEWS)', async () => {
      resetRecords();
      const r = await api('/api/records/internalPosts/3/edit', { title: 'x' }, NEWS_MANAGER);
      assertEqual(r.status, 403, JSON.stringify(r.body));
    });

    // ===== internalNewsManage — XOÁ =====
    await run.run('internalNewsManage xoá được bài NEWS DRAFT của người khác, KHÔNG cần admin', async () => {
      resetRecords();
      const r = await api('/api/records/internalPosts/1/delete', {}, NEWS_MANAGER);
      assertEqual(r.status, 200, JSON.stringify(r.body));
      assertEqual(RECORDS.internalPosts.some(p => p.id === 1), false);
    });

    await run.run('internalNewsManage xoá được bài NEWS ĐÃ APPROVED của người khác (xoá KHÔNG bị chặn bởi trần trạng thái của sửa)', async () => {
      resetRecords();
      const r = await api('/api/records/internalPosts/2/delete', {}, NEWS_MANAGER);
      assertEqual(r.status, 200, JSON.stringify(r.body));
      assertEqual(RECORDS.internalPosts.some(p => p.id === 2), false);
    });

    await run.run('internalNewsManage KHÔNG xoá được bài SHARE (rơi về admin-only như cũ)', async () => {
      resetRecords();
      const r = await api('/api/records/internalPosts/3/delete', {}, NEWS_MANAGER);
      assertEqual(r.status, 403, JSON.stringify(r.body));
      assertEqual(RECORDS.internalPosts.some(p => p.id === 3), true);
    });

    await run.run('Người dùng thường (không admin, không internalNewsManage) KHÔNG xoá được bài NEWS', async () => {
      resetRecords();
      const r = await api('/api/records/internalPosts/1/delete', {}, NV1);
      assertEqual(r.status, 403, JSON.stringify(r.body));
      assertEqual(RECORDS.internalPosts.some(p => p.id === 1), true);
    });

    await run.run('Admin vẫn xoá được MỌI loại bài (NEWS/SHARE) như cũ', async () => {
      resetRecords();
      const r = await api('/api/records/internalPosts/3/delete', {}, ADMIN);
      assertEqual(r.status, 200, JSON.stringify(r.body));
    });

    // ===== recruitmentJobs — XOÁ (mở rộng phạm vi internalRecruitmentCreate) =====
    await run.run('internalRecruitmentCreate (KHÔNG có admin) xoá được tin tuyển dụng — mở rộng mới', async () => {
      resetRecords();
      const r = await api('/api/records/recruitmentJobs/10/delete', {}, RECRUITER);
      assertEqual(r.status, 200, JSON.stringify(r.body));
      assertEqual(RECORDS.recruitmentJobs.some(j => j.id === 10), false);
    });

    await run.run('Người dùng thường (không admin, không internalRecruitmentCreate) KHÔNG xoá được tin tuyển dụng', async () => {
      resetRecords();
      const r = await api('/api/records/recruitmentJobs/10/delete', {}, NV1);
      assertEqual(r.status, 403, JSON.stringify(r.body));
      assertEqual(RECORDS.recruitmentJobs.some(j => j.id === 10), true);
    });

    await run.run('Admin vẫn xoá được tin tuyển dụng như cũ', async () => {
      resetRecords();
      const r = await api('/api/records/recruitmentJobs/10/delete', {}, ADMIN);
      assertEqual(r.status, 200, JSON.stringify(r.body));
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-internal-news-manage-and-recruitment-delete.js:', err);
  process.exitCode = 1;
});
