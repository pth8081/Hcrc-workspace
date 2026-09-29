// server/tests/test-training-test-edit-guard.js
//
// Regression test cho POST /api/records/trainingTests/:id/edit (routes/records.js, 10/2026 — theo yêu
// cầu người dùng): trước đây route CHẶN CỨNG 409 mọi lần sửa Bộ Câu Hỏi nếu đã có ≥1 bài nộp
// (trainingTestSubmissions), kể cả chỉ sửa lỗi chính tả. Nay vẫn CHO PHÉP sửa dù đã có bài nộp, MIỄN LÀ
// thay đổi KHÔNG làm sai lệch điểm đã chấm (đổi số câu hỏi/type/points/số lượng đáp án/đáp án đúng của
// BẤT KỲ câu nào vẫn CHẶN 409 — xem assertTrainingTestGradingStructureUnchanged(), lib/createValidation.js
// và editTrainingTest(), lib/recordActions.js). "Còn lớp đang gán" (trainingClasses.testId) VẪN chặn
// cứng như cũ, không đổi.
//
// KIẾN TRÚC: chạy thẳng express router THẬT (routes/records.js) trong tiến trình Node, không mở
// Playwright, chỉ giả lập tầng LƯU TRỮ + middleware xác thực — cùng khuôn
// tests/test-audit-round2-internalcomms-training-routes.js.
//
// 4 nhánh chính (theo đúng yêu cầu):
//   (a) sửa chữ khi đã có bài nộp -> cho phép
//   (b) đổi đáp án đúng/điểm khi đã có bài nộp -> vẫn chặn
//   (c) thêm/bớt câu khi đã có bài nộp -> vẫn chặn
//   (d) chưa có bài nộp -> sửa tự do như cũ
//
// Chạy: node server/tests/test-training-test-edit-guard.js
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
const COLLECTIONS = ['trainingTests', 'trainingClasses', 'trainingTestSubmissions'];

function baseTest() {
  return {
    id: 1, title: 'Bài Test ATLĐ', category: '', passScore: null,
    questions: [
      { id: 1, text: 'Câu 1: 1+1=?', type: 'SINGLE', options: [{ id: 1, text: '2' }, { id: 2, text: '3' }], correctOptionIds: [1], points: 5, imageUrl: '' },
      { id: 2, text: 'Câu 2: Chọn các số chẵn', type: 'MULTI', options: [{ id: 1, text: '2' }, { id: 2, text: '3' }, { id: 3, text: '4' }], correctOptionIds: [1, 3], points: 5, imageUrl: '' }
    ]
  };
}

function resetRecords() {
  for (const key of COLLECTIONS) RECORDS[key] = [];
  RECORDS.trainingTests = [baseTest()];
}
resetRecords();

let CURRENT_USERNAME = ADMIN.username;

const { HttpError } = require('../lib/httpErrors');

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key === 'sensitiveKeywords' ? [] : null),
  getAllAppData: async () => ({ users: USERS, depts: ['Kinh Doanh', 'Hành Chính', 'Ban Giám Đốc'], stores: [] }),
  withLockedAppDataValue: async (key, fn) => fn(null)
});

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(COLLECTIONS),
  getAllForCollectionCached: async (c) => RECORDS[c] || [],
  getAllForCollection: async (c) => RECORDS[c] || [],
  getTrashItems: async () => [],
  withLockedRecordForCollection: async (c, id, mutator) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    // Clone (JSON round-trip) trước khi đưa vào mutator — mirror withLockedDedicatedRecordById() thật
    // (lib/recordStore.js: mỗi lần khoá đọc lại 1 bản parse mới từ SQL, không phải reference sống trong
    // bộ nhớ) để mutator throw giữa chừng (409 do sai lệch cấu trúc chấm điểm) KHÔNG làm rò rỉ mutation
    // dở dang vào RECORDS[c] — đúng ngữ nghĩa rollback transaction thật.
    const updated = await mutator(JSON.parse(JSON.stringify(list[idx])));
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
  },
  createForCollectionSerialized: async () => { throw new Error('không dùng trong bài test này'); },
  withLockedRecordById: async () => { throw new Error('không dùng trong bài test này'); },
  withAppLock: async (key, fn) => fn(),
  isUniqueConstraintViolation: () => false
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
const { createRunner, assertEqual, assertIncludes } = require('./testHarness');
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
    await run.run('(d) CHƯA có bài nộp nào: sửa tự do hoàn toàn (kể cả đổi đáp án đúng/thêm câu) như cũ', async () => {
      resetRecords();
      const t = baseTest();
      t.questions[0].correctOptionIds = [2]; // đổi đáp án đúng
      t.questions.push({ text: 'Câu 3 mới thêm', type: 'SINGLE', points: 1, imageUrl: '', options: [{ text: 'A' }, { text: 'B' }], correctOptionIds: [1] });
      const res = await api('POST', '/api/records/trainingTests/1/edit', {
        title: t.title, category: t.category, passScore: t.passScore,
        questions: t.questions.map(q => ({ text: q.text, type: q.type, points: q.points, imageUrl: q.imageUrl, options: q.options, correctOptionIds: q.correctOptionIds }))
      }, TRAINER);
      assertEqual(res.status, 200, `Phải sửa tự do được khi chưa có bài nộp: ${JSON.stringify(res.body)}`);
      assertEqual(res.body.item.questions.length, 3);
      assertEqual(res.body.item.questions[0].correctOptionIds[0], 2);
    });

    await run.run('(a) ĐÃ có bài nộp, chỉ sửa CHỮ (nội dung câu hỏi + nhãn đáp án) + tiêu đề: CHO PHÉP', async () => {
      resetRecords();
      RECORDS.trainingTestSubmissions = [{ id: 1, testId: 1, creator: NV1.username, score: 10 }];
      const res = await api('POST', '/api/records/trainingTests/1/edit', {
        title: 'Bài Test ATLĐ (đã sửa chính tả)', category: '', passScore: null,
        questions: [
          { text: 'Câu 1: 1+1=? (đã sửa chữ)', type: 'SINGLE', points: 5, imageUrl: '', options: [{ text: '2 (đúng)' }, { text: '3' }], correctOptionIds: [1] },
          { text: 'Câu 2: Chọn các số chẵn (đã sửa chữ)', type: 'MULTI', points: 5, imageUrl: '', options: [{ text: '2' }, { text: '3' }, { text: '4' }], correctOptionIds: [1, 3] }
        ]
      }, TRAINER);
      assertEqual(res.status, 200, `Chỉ sửa chữ phải được phép dù đã có bài nộp: ${JSON.stringify(res.body)}`);
      assertEqual(res.body.item.title, 'Bài Test ATLĐ (đã sửa chính tả)');
      assertEqual(res.body.item.questions[0].text, 'Câu 1: 1+1=? (đã sửa chữ)');
      assertEqual(res.body.item.questions[0].correctOptionIds[0], 1, 'đáp án đúng phải giữ nguyên vị trí (option đầu)');
    });

    await run.run('(b) ĐÃ có bài nộp, đổi ĐÁP ÁN ĐÚNG của 1 câu: vẫn CHẶN 409', async () => {
      resetRecords();
      RECORDS.trainingTestSubmissions = [{ id: 1, testId: 1, creator: NV1.username, score: 10 }];
      const res = await api('POST', '/api/records/trainingTests/1/edit', {
        title: 'Bài Test ATLĐ', category: '', passScore: null,
        questions: [
          { text: 'Câu 1: 1+1=?', type: 'SINGLE', points: 5, imageUrl: '', options: [{ text: '2' }, { text: '3' }], correctOptionIds: [2] }, // đổi đáp án đúng: 1 -> 2
          { text: 'Câu 2: Chọn các số chẵn', type: 'MULTI', points: 5, imageUrl: '', options: [{ text: '2' }, { text: '3' }, { text: '4' }], correctOptionIds: [1, 3] }
        ]
      }, TRAINER);
      assertEqual(res.status, 409, `Phải bị chặn vì đổi đáp án đúng: ${JSON.stringify(res.body)}`);
      assertIncludes(res.body.error, 'đáp án đúng');
      assertEqual(RECORDS.trainingTests[0].questions[0].correctOptionIds[0], 1, 'Không được ghi đè bản ghi cũ khi bị chặn');
    });

    await run.run('(b) ĐÃ có bài nộp, đổi ĐIỂM (points) của 1 câu: vẫn CHẶN 409', async () => {
      resetRecords();
      RECORDS.trainingTestSubmissions = [{ id: 1, testId: 1, creator: NV1.username, score: 10 }];
      const res = await api('POST', '/api/records/trainingTests/1/edit', {
        title: 'Bài Test ATLĐ', category: '', passScore: null,
        questions: [
          { text: 'Câu 1: 1+1=?', type: 'SINGLE', points: 9, imageUrl: '', options: [{ text: '2' }, { text: '3' }], correctOptionIds: [1] },
          { text: 'Câu 2: Chọn các số chẵn', type: 'MULTI', points: 5, imageUrl: '', options: [{ text: '2' }, { text: '3' }, { text: '4' }], correctOptionIds: [1, 3] }
        ]
      }, TRAINER);
      assertEqual(res.status, 409, `Phải bị chặn vì đổi điểm: ${JSON.stringify(res.body)}`);
      assertIncludes(res.body.error, 'điểm số');
    });

    await run.run('(b) ĐÃ có bài nộp, đổi TYPE (SINGLE -> MULTI) của 1 câu: vẫn CHẶN 409', async () => {
      resetRecords();
      RECORDS.trainingTestSubmissions = [{ id: 1, testId: 1, creator: NV1.username, score: 10 }];
      const res = await api('POST', '/api/records/trainingTests/1/edit', {
        title: 'Bài Test ATLĐ', category: '', passScore: null,
        questions: [
          { text: 'Câu 1: 1+1=?', type: 'MULTI', points: 5, imageUrl: '', options: [{ text: '2' }, { text: '3' }], correctOptionIds: [1] },
          { text: 'Câu 2: Chọn các số chẵn', type: 'MULTI', points: 5, imageUrl: '', options: [{ text: '2' }, { text: '3' }, { text: '4' }], correctOptionIds: [1, 3] }
        ]
      }, TRAINER);
      assertEqual(res.status, 409, `Phải bị chặn vì đổi loại câu hỏi: ${JSON.stringify(res.body)}`);
      assertIncludes(res.body.error, 'loại câu hỏi');
    });

    await run.run('(c) ĐÃ có bài nộp, THÊM 1 câu hỏi: vẫn CHẶN 409', async () => {
      resetRecords();
      RECORDS.trainingTestSubmissions = [{ id: 1, testId: 1, creator: NV1.username, score: 10 }];
      const res = await api('POST', '/api/records/trainingTests/1/edit', {
        title: 'Bài Test ATLĐ', category: '', passScore: null,
        questions: [
          { text: 'Câu 1: 1+1=?', type: 'SINGLE', points: 5, imageUrl: '', options: [{ text: '2' }, { text: '3' }], correctOptionIds: [1] },
          { text: 'Câu 2: Chọn các số chẵn', type: 'MULTI', points: 5, imageUrl: '', options: [{ text: '2' }, { text: '3' }, { text: '4' }], correctOptionIds: [1, 3] },
          { text: 'Câu 3 mới thêm', type: 'SINGLE', points: 1, imageUrl: '', options: [{ text: 'A' }, { text: 'B' }], correctOptionIds: [1] }
        ]
      }, TRAINER);
      assertEqual(res.status, 409, `Phải bị chặn vì thêm câu hỏi: ${JSON.stringify(res.body)}`);
      assertIncludes(res.body.error, 'số lượng câu hỏi');
    });

    await run.run('(c) ĐÃ có bài nộp, BỚT 1 câu hỏi: vẫn CHẶN 409', async () => {
      resetRecords();
      RECORDS.trainingTestSubmissions = [{ id: 1, testId: 1, creator: NV1.username, score: 10 }];
      const res = await api('POST', '/api/records/trainingTests/1/edit', {
        title: 'Bài Test ATLĐ', category: '', passScore: null,
        questions: [
          { text: 'Câu 1: 1+1=?', type: 'SINGLE', points: 5, imageUrl: '', options: [{ text: '2' }, { text: '3' }], correctOptionIds: [1] }
        ]
      }, TRAINER);
      assertEqual(res.status, 409, `Phải bị chặn vì bớt câu hỏi: ${JSON.stringify(res.body)}`);
      assertIncludes(res.body.error, 'số lượng câu hỏi');
    });

    await run.run('ĐÃ có bài nộp, đổi SỐ LƯỢNG ĐÁP ÁN (thêm 1 option) của 1 câu: vẫn CHẶN 409', async () => {
      resetRecords();
      RECORDS.trainingTestSubmissions = [{ id: 1, testId: 1, creator: NV1.username, score: 10 }];
      const res = await api('POST', '/api/records/trainingTests/1/edit', {
        title: 'Bài Test ATLĐ', category: '', passScore: null,
        questions: [
          { text: 'Câu 1: 1+1=?', type: 'SINGLE', points: 5, imageUrl: '', options: [{ text: '2' }, { text: '3' }, { text: '4' }], correctOptionIds: [1] },
          { text: 'Câu 2: Chọn các số chẵn', type: 'MULTI', points: 5, imageUrl: '', options: [{ text: '2' }, { text: '3' }, { text: '4' }], correctOptionIds: [1, 3] }
        ]
      }, TRAINER);
      assertEqual(res.status, 409, `Phải bị chặn vì đổi số lượng đáp án: ${JSON.stringify(res.body)}`);
      assertIncludes(res.body.error, 'số lượng đáp án');
    });

    await run.run('bài test vẫn CÒN GÁN CHO LỚP (dù chưa có bài nộp): vẫn CHẶN 409 như cũ (không nới lỏng)', async () => {
      resetRecords();
      RECORDS.trainingClasses = [{ id: 900, code: 'LH-001', title: 'Lớp ATLĐ', testId: 1 }];
      const res = await api('POST', '/api/records/trainingTests/1/edit', {
        title: 'Bài Test ATLĐ (sửa chữ thôi)', category: '', passScore: null,
        questions: [
          { text: 'Câu 1: 1+1=?', type: 'SINGLE', points: 5, imageUrl: '', options: [{ text: '2' }, { text: '3' }], correctOptionIds: [1] },
          { text: 'Câu 2: Chọn các số chẵn', type: 'MULTI', points: 5, imageUrl: '', options: [{ text: '2' }, { text: '3' }, { text: '4' }], correctOptionIds: [1, 3] }
        ]
      }, TRAINER);
      assertEqual(res.status, 409, `Phải vẫn bị chặn vì còn lớp đang gán: ${JSON.stringify(res.body)}`);
      assertIncludes(res.body.error, 'lớp học');
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-training-test-edit-guard.js:', err);
  process.exitCode = 1;
});
