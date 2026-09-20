// server/tests/test-audit-round2-internalcomms-training-routes.js
//
// Regression test cho ĐỢT RÀ SOÁT CHUYÊN SÂU VÒNG 2 (9/2026) — cụm "Truyền Thông Nội Bộ / Đào Tạo /
// Tuyển Dụng / HCRC Đồng Hành", phần cần chạy qua ROUTE THẬT (routes/records.js — server tự tính giờ,
// đọc lại bản ghi liên quan, ghi đè payload người xem gửi lên). Phần logic thuần đã tách sang
// tests/test-audit-round2-internalcomms-training-pure.js.
//
// KIẾN TRÚC: giống tests/test-audit-round4-internal-data-gate.js — KHÔNG mở Playwright, chạy thẳng
// express router THẬT (routes/records.js) trong tiến trình Node, chỉ giả lập tầng LƯU TRỮ + middleware
// xác thực.
//
// Mỗi kịch bản gắn với ĐÚNG 1 phát hiện đã vá:
//   #1  POST /trainingClasses/:id/submit-test — lớp ONLINE phải qua endTime mới cho nộp bài (trước đây
//       chỉ kiểm documentIds).
//   #6  POST /trainingClasses/:id/delete và /trainingDocuments/:id/delete — kiểm tham chiếu trước khi
//       xoá (trước đây deleteAdminOnly() trần, xoá vô điều kiện).
//   #7  POST /trainingDocuments/:id/track-progress — durationSeconds/pageCount (MẪU SỐ hoàn thành) ép
//       về đúng giá trị THẬT trên bản ghi trainingDocuments, không tin payload người xem gửi lên.
//   #11 POST /internalPosts/:id/unpin — route gỡ ghim mới.
//   #12 POST /internalPosts/:id/delete — route xoá mới (admin-only).
//
// Chạy: node server/tests/test-audit-round2-internalcomms-training-routes.js
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

let PORT = 0;

// ===================== Seed =====================
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const TRAINER = { username: 'dt1', name: 'Cán Bộ Đào Tạo', dept: 'Hành Chính', perms: { trainingManage: true }, active: true };
const NV1 = { username: 'nv1', name: 'Nhân Viên Một', dept: 'Kinh Doanh', perms: {}, active: true };
const USERS = [ADMIN, TRAINER, NV1];

const RECORDS = {};
const COLLECTIONS = [
  'internalPosts', 'trainingClasses', 'trainingTests', 'trainingTestSubmissions', 'trainingRegistrations',
  'trainingDocuments', 'trainingDocumentProgress'
];
const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

function resetRecords() {
  for (const key of COLLECTIONS) RECORDS[key] = [];
  RECORDS.trainingTests = [{ id: 50, title: 'Bài test ATLĐ', questions: [{ id: 1, type: 'MCQ', points: 10, options: [{ text: 'A', correct: true }, { text: 'B', correct: false }] }] }];
  // Lớp ONLINE, testId=50, endTime TƯƠNG LAI (chưa kết thúc) — kịch bản #1.
  RECORDS.trainingClasses = [
    { id: 900, code: 'LH-001', title: 'Lớp ONLINE', mode: 'ONLINE', status: 'OPEN', testId: 50, passScore: 50, documentIds: [], instructorUsername: null, endTime: FUTURE, creator: TRAINER.username },
    { id: 901, code: 'LH-002', title: 'Lớp không ai đăng ký', mode: 'ONLINE', status: 'OPEN', testId: null, documentIds: [], creator: TRAINER.username, endTime: '' }
  ];
  RECORDS.trainingRegistrations = [
    { id: 700, classId: 900, creator: NV1.username, creatorName: NV1.name, result: 'REGISTERED', viewedDocumentIds: [] }
  ];
  // Tài liệu VIDEO có durationSeconds THẬT = 600s (trainingManage nhập tay lúc thêm) — kịch bản #7.
  RECORDS.trainingDocuments = [
    { id: 800, code: 'TL-001', title: 'Video ATLĐ', docType: 'VIDEO', videoUrl: 'https://www.youtube.com/watch?v=abc', durationSeconds: 600, pageCount: null, uploaderUsername: TRAINER.username }
  ];
  RECORDS.internalPosts = [
    { id: 1, code: 'TN-001', type: 'NEWS', status: 'APPROVED', title: 'Tin ghim', content: 'x', author: ADMIN.username, dept: 'Ban Giám Đốc', comments: [], likes: [], readBy: [], pinned: true, pinExpiresAt: FUTURE, pinnedBy: ADMIN.username },
    { id: 2, code: 'CS-001', type: 'SHARE', status: 'DRAFT', title: 'Bài nháp', content: 'x', author: NV1.username, dept: 'Kinh Doanh', comments: [], likes: [], readBy: [] }
  ];
  RECORDS.trainingTestSubmissions = [];
  RECORDS.trainingDocumentProgress = [];
}
resetRecords();

let CURRENT_USERNAME = ADMIN.username;

const { HttpError } = require('../lib/httpErrors');

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key === 'sensitiveKeywords' ? [] : null),
  getAllAppData: async () => ({ users: USERS, depts: ['Kinh Doanh', 'Hành Chính', 'Ban Giám Đốc'], stores: [] }),
  withLockedAppDataValue: async (key, fn) => fn(null)
});

const DELETED = [];
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(COLLECTIONS),
  getAllForCollectionCached: async (c) => RECORDS[c] || [],
  getAllForCollection: async (c) => RECORDS[c] || [],
  getTrashItems: async () => [],
  withLockedRecordForCollection: async (c, id, mutator) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    const updated = await mutator(list[idx]);
    list[idx] = updated;
    return updated;
  },
  createForCollection: async (c, builderFn) => {
    const list = RECORDS[c] || (RECORDS[c] = []);
    const record = await builderFn(list);
    list.push(record);
    return record;
  },
  insertRecord: async (c, record) => {
    const list = RECORDS[c] || (RECORDS[c] = []);
    list.push(record);
    return record;
  },
  deleteRecordForCollection: async (c, id, checkFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    if (checkFn) await checkFn(list[idx]);
    list.splice(idx, 1);
    DELETED.push(`${c}:${id}`);
  },
  createForCollectionSerialized: async () => { throw new Error('không dùng trong bài test này'); },
  withLockedRecordById: async () => { throw new Error('không dùng trong bài test này'); },
  withAppLock: async (key, fn) => fn()
});

stubModule('lib/taskStore', {
  getAllTasksCached: async () => [], getAllTasks: async () => [],
  insertTask: async () => { throw new Error('không dùng'); },
  withLockedTaskById: async () => { throw new Error('không dùng'); },
  deleteTaskById: async () => { throw new Error('không dùng'); },
  migrateDirectiveTaskLinks: async () => 0
});

stubModule('lib/operationWorkItemStore', {
  getAllWorkItemsCached: async () => [], getAllWorkItems: async () => [], getWorkItemsBySource: async () => [],
  insertWorkItem: async () => { throw new Error('không dùng'); },
  withLockedWorkItemById: async () => { throw new Error('không dùng'); },
  deleteWorkItemById: async () => { throw new Error('không dùng'); },
  deleteWorkItemsByIds: async () => { throw new Error('không dùng'); }
});

stubModule('lib/uploadedFiles', {
  recordUploadedFile: async () => {}, getFileUrlOwners: async () => new Map(),
  assertPayloadFileUrlsOwnedByUser: async () => {}, collectFileUrlsDeep: () => {}
});

stubModule('lib/systemLogStore', { insertSystemLog: async () => {}, getAllSystemLogsCached: async () => [] });

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => `hashed:${p}`,
  isBcryptHash: (v) => String(v || '').startsWith('hashed:'),
  validatePin: () => null
});

stubModule('lib/emailCrypto', { encryptSecret: (s) => `enc:${s}` });

// ===================== Require code THẬT =====================
const express = require('express');
const { createRunner, assert, assertEqual, assertIncludes } = require('./testHarness');
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
    // ===================================================================================
    // #1 — submit-test ONLINE phải qua endTime
    // ===================================================================================
    await run.run('#1 — Lớp ONLINE có endTime TƯƠNG LAI: submit-test bị chặn 409 dù đã đăng ký', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/trainingClasses/900/submit-test', { answers: {} }, NV1);
      assertEqual(res.status, 409, 'Phải bị chặn vì lớp chưa kết thúc');
      assertIncludes(res.body.error, 'kết thúc');
      assertEqual(RECORDS.trainingTestSubmissions.length, 0, 'Không được tạo bản ghi nộp bài nào');
    });

    await run.run('#1 — Lớp ONLINE đã qua endTime (quá khứ): submit-test hoạt động bình thường', async () => {
      resetRecords();
      RECORDS.trainingClasses[0].endTime = PAST;
      const res = await api('POST', '/api/records/trainingClasses/900/submit-test', { answers: { 1: 0 } }, NV1);
      assertEqual(res.status, 200, `Phải nộp bài được: ${JSON.stringify(res.body)}`);
      assertEqual(RECORDS.trainingTestSubmissions.length, 1);
    });

    await run.run('#1 — Lớp ONLINE KHÔNG có endTime: submit-test bị chặn 409 ("chưa có giờ kết thúc")', async () => {
      resetRecords();
      RECORDS.trainingClasses[0].endTime = '';
      const res = await api('POST', '/api/records/trainingClasses/900/submit-test', { answers: {} }, NV1);
      assertEqual(res.status, 409);
      assertIncludes(res.body.error, 'giờ kết thúc');
    });

    // ===================================================================================
    // #6 — chặn xoá trainingClasses/trainingDocuments còn tham chiếu
    // ===================================================================================
    await run.run('#6 — Xoá trainingClasses còn trainingRegistrations tham chiếu -> 409, không xoá', async () => {
      resetRecords();
      DELETED.length = 0;
      const res = await api('POST', '/api/records/trainingClasses/900/delete', {}, ADMIN);
      assertEqual(res.status, 409);
      assertIncludes(res.body.error, 'đăng ký');
      assertEqual(RECORDS.trainingClasses.length, 2, 'Lớp phải còn nguyên');
      assertEqual(DELETED.length, 0);
    });

    await run.run('#6 — Xoá trainingClasses KHÔNG có đăng ký nào -> xoá được bình thường', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/trainingClasses/901/delete', {}, ADMIN);
      assertEqual(res.status, 200);
      assertEqual(RECORDS.trainingClasses.length, 1);
    });

    await run.run('#6 — Xoá trainingDocuments đang nằm trong documentIds của lớp ONLINE CHƯA kết thúc -> 409', async () => {
      resetRecords();
      RECORDS.trainingClasses[1].documentIds = [800]; // lớp 901, endTime rỗng = chưa kết thúc
      const res = await api('POST', '/api/records/trainingDocuments/800/delete', {}, ADMIN);
      assertEqual(res.status, 409);
      assertIncludes(res.body.error, 'ONLINE');
      assertEqual(RECORDS.trainingDocuments.length, 1);
    });

    await run.run('#6 — trainingDocuments chỉ được dùng bởi lớp ONLINE ĐÃ kết thúc -> xoá được', async () => {
      resetRecords();
      RECORDS.trainingClasses[1].documentIds = [800];
      RECORDS.trainingClasses[1].endTime = PAST;
      const res = await api('POST', '/api/records/trainingDocuments/800/delete', {}, ADMIN);
      assertEqual(res.status, 200);
      assertEqual(RECORDS.trainingDocuments.length, 0);
    });

    await run.run('#6 — trainingDocuments KHÔNG được lớp nào dùng -> xoá được bình thường', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/trainingDocuments/800/delete', {}, ADMIN);
      assertEqual(res.status, 200);
    });

    // ===================================================================================
    // #7 — track-progress: durationSeconds/pageCount ép về giá trị THẬT trên bản ghi tài liệu
    // ===================================================================================
    await run.run('#7 — Request GIẢ {furthestSeconds:1, durationSeconds:1} KHÔNG hoàn tất được (server ép durationSeconds thật=600)', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/trainingDocuments/800/track-progress',
        { kind: 'VIDEO', furthestSeconds: 1, durationSeconds: 1 }, NV1);
      assertEqual(res.status, 200);
      const progress = RECORDS.trainingDocumentProgress.find(p => p.docId === 800 && p.username === NV1.username);
      assert(progress, 'phải có bản ghi tiến độ');
      assertEqual(progress.durationSeconds, 600, 'durationSeconds LƯU LẠI phải là giá trị THẬT trên trainingDocuments, không phải giá trị giả client gửi');
      assertEqual(!!progress.completedAt, false, 'KHÔNG được coi là hoàn thành — 1/600 giây thật quá thấp');
    });

    await run.run('#7 — Tiến độ THẬT đạt ~95% của durationSeconds THẬT (600s) -> hoàn thành đúng', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/trainingDocuments/800/track-progress',
        { kind: 'VIDEO', furthestSeconds: 580, durationSeconds: 1 }, NV1); // durationSeconds giả vẫn bị ép về 600
      assertEqual(res.status, 200);
      const progress = RECORDS.trainingDocumentProgress.find(p => p.docId === 800 && p.username === NV1.username);
      assert(!!progress.completedAt, '580/600 = ~96.6% phải đủ ngưỡng 95% để hoàn thành');
    });

    // ===================================================================================
    // #11 — POST /internalPosts/:id/unpin
    // ===================================================================================
    await run.run('#11 — Admin gỡ ghim bài đang ghim -> pinned=false', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/internalPosts/1/unpin', {}, ADMIN);
      assertEqual(res.status, 200);
      assertEqual(RECORDS.internalPosts[0].pinned, false);
    });

    await run.run('#11 — Gỡ ghim 1 bài KHÔNG đang ghim -> 409', async () => {
      resetRecords();
      RECORDS.internalPosts[0].pinned = false;
      const res = await api('POST', '/api/records/internalPosts/1/unpin', {}, ADMIN);
      assertEqual(res.status, 409);
    });

    await run.run('#11 — Người dùng thường KHÔNG gỡ ghim được (403)', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/internalPosts/1/unpin', {}, NV1);
      assertEqual(res.status, 403);
      assertEqual(RECORDS.internalPosts[0].pinned, true, 'Vẫn còn ghim sau lượt bị từ chối');
    });

    // ===================================================================================
    // #12 — POST /internalPosts/:id/delete (admin-only, mới)
    // ===================================================================================
    await run.run('#12 — Admin xoá được bài NHÁP (DRAFT)', async () => {
      resetRecords();
      DELETED.length = 0;
      const res = await api('POST', '/api/records/internalPosts/2/delete', {}, ADMIN);
      assertEqual(res.status, 200);
      assertEqual(RECORDS.internalPosts.length, 1);
      assertEqual(DELETED[0], 'internalPosts:2');
    });

    await run.run('#12 — Người dùng thường (kể cả tác giả) KHÔNG xoá được (403)', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/internalPosts/2/delete', {}, NV1);
      assertEqual(res.status, 403);
      assertEqual(RECORDS.internalPosts.length, 2, 'Bài phải còn nguyên');
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-audit-round2-internalcomms-training-routes.js:', err);
  process.exitCode = 1;
});
