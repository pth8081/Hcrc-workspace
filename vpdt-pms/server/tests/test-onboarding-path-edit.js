// server/tests/test-onboarding-path-edit.js
//
// Regression test cho POST /api/records/onboardingPaths/:id/edit (routes/records.js).
//
// LỖI ĐÃ VÁ (10/2026): bài test này ban đầu (9/2026) chứng minh 1 lỗi đã vá về việc route quên nạp
// appData.trainingCourses khiến normalizeOnboardingPathFields() luôn từ chối stage{1,2}RequiredCourseIds
// hợp lệ. Giai đoạn 1/2 nay đã bỏ hẳn tham chiếu trainingCourses — đổi hẳn sang NỘI DUNG NHẬP TAY
// (stage1Criteria/stage2Criteria, cùng khuôn stage3Criteria vốn đã luôn nhập tay) để tránh danh mục
// Chương Trình bị "Nhập Kế Hoạch Đào Tạo từ Excel" tự đẩy thêm lựa chọn không liên quan — nên route
// KHÔNG còn đọc/cần trainingCourses nữa, bài test được viết lại để xác nhận hành vi MỚI: sửa Lộ Trình chỉ
// cần validate nội dung chữ (không rỗng), không còn đối chiếu bất kỳ danh mục nào.
//
// KIẾN TRÚC: chạy thẳng express router THẬT (routes/records.js) trong tiến trình Node, không mở
// Playwright, chỉ giả lập tầng LƯU TRỮ + middleware xác thực — cùng khuôn
// tests/test-audit-round2-internalcomms-training-routes.js.
//
// Chạy: node server/tests/test-onboarding-path-edit.js
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
const USERS = [ADMIN, TRAINER];

const RECORDS = {};
const COLLECTIONS = ['onboardingPaths'];

function resetRecords() {
  for (const key of COLLECTIONS) RECORDS[key] = [];
  RECORDS.onboardingPaths = [{
    id: 1, name: 'Lộ Trình Nhân Viên Kho',
    stage1Criteria: 'Nội quy công ty, an toàn lao động.', stage2Criteria: 'Quy trình kho.',
    stage3Criteria: 'Thái độ làm việc.',
    creator: TRAINER.username, creatorName: TRAINER.name
  }];
}
resetRecords();

let CURRENT_USERNAME = ADMIN.username;

const { HttpError } = require('../lib/httpErrors');

// trainingDocuments/trainingClasses CŨNG KHÔNG nằm trong AppData thật (đều là MIGRATED_COLLECTION,
// xem recordStore.js) — nhưng routes/records.js /onboardingPaths/:id/edit lại gọi getAllAppData() (đã
// re-add 10/2026) rồi TỰ LẤY appData.trainingDocuments/appData.trainingClasses, nên mirror đúng thực tế
// ở đây nghĩa là field đó PHẢI có mặt (không phải chỉ Set rỗng) để test phơi bày đúng lỗi nếu route quên
// nạp, giống hệt lý do trainingCourses từng bị thiếu trước khi vá.
const TRAINING_DOCS = [{ id: 1, title: 'Tài Liệu Kho A' }, { id: 2, title: 'Tài Liệu Kho B' }];
const TRAINING_CLASSES = [{ id: 10, title: 'Lớp Tân Binh Kho Q1' }];
stubModule('lib/appData', {
  // Cố ý KHÔNG có trainingCourses ở đây — mirror ĐÚNG thực tế getAllAppData() (trainingCourses là
  // MIGRATED_COLLECTION, không nằm trong AppData) để bài test này thật sự phơi bày đúng lỗi đã vá thay
  // vì âm thầm cho qua nhờ giả lập sai.
  getAppDataValue: async (key) => (key === 'sensitiveKeywords' ? [] : null),
  getAllAppData: async () => ({
    users: USERS, depts: ['Hành Chính', 'Ban Giám Đốc'], stores: [],
    trainingDocuments: TRAINING_DOCS, trainingClasses: TRAINING_CLASSES
  }),
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
    // (lib/recordStore.js: mỗi lần khoá đọc lại 1 bản parse mới từ SQL) để mutator throw giữa chừng
    // không làm rò rỉ mutation dở dang.
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
    await run.run('sửa Lộ Trình Tân Binh CHỈ đổi tiêu chí Giai đoạn 3 (không đổi nội dung Giai đoạn 1/2) phải THÀNH CÔNG', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/onboardingPaths/1/edit', {
        name: 'Lộ Trình Nhân Viên Kho',
        stage1Criteria: 'Nội quy công ty, an toàn lao động.', stage2Criteria: 'Quy trình kho.',
        stage3Criteria: 'Tiêu chí đã cập nhật.'
      }, TRAINER);
      assertEqual(res.status, 200, `Phải sửa được: ${JSON.stringify(res.body)}`);
      assertEqual(res.body.item.stage3Criteria, 'Tiêu chí đã cập nhật.');
      assertEqual(res.body.item.stage1Criteria, 'Nội quy công ty, an toàn lao động.', 'stage1Criteria phải giữ nguyên');
    });

    await run.run('sửa Lộ Trình đổi SANG nội dung khác cho Giai đoạn 1/2 vẫn THÀNH CÔNG (không còn đối chiếu bất kỳ danh mục nào)', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/onboardingPaths/1/edit', {
        name: 'Lộ Trình Nhân Viên Kho',
        stage1Criteria: 'Nội dung Giai đoạn 1 đã đổi.', stage2Criteria: 'Nội dung Giai đoạn 2 đã đổi.',
        stage3Criteria: 'x'
      }, TRAINER);
      assertEqual(res.status, 200, `Phải sửa được: ${JSON.stringify(res.body)}`);
      assertEqual(res.body.item.stage1Criteria, 'Nội dung Giai đoạn 1 đã đổi.');
      assertEqual(res.body.item.stage2Criteria, 'Nội dung Giai đoạn 2 đã đổi.');
    });

    await run.run('sửa Lộ Trình với Giai đoạn 1 để trống bị từ chối 400 (vẫn bắt buộc nhập nội dung)', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/onboardingPaths/1/edit', {
        name: 'Lộ Trình Nhân Viên Kho',
        stage1Criteria: '', stage2Criteria: 'Quy trình kho.',
        stage3Criteria: 'x'
      }, TRAINER);
      assertEqual(res.status, 400);
      assertIncludes(res.body.error, 'nội dung bắt buộc cho Giai đoạn 1');
    });

    await run.run('sửa Lộ Trình gán stage1DocIds/stage2DocIds (tham chiếu trainingDocuments) + linkedClassId (tham chiếu trainingClasses) hợp lệ phải THÀNH CÔNG', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/onboardingPaths/1/edit', {
        name: 'Lộ Trình Nhân Viên Kho',
        stage1Criteria: 'Nội quy công ty, an toàn lao động.', stage2Criteria: 'Quy trình kho.',
        stage3Criteria: 'x',
        stage1DocIds: [1, 2], stage2DocIds: [2], linkedClassId: 10
      }, TRAINER);
      assertEqual(res.status, 200, `Phải sửa được: ${JSON.stringify(res.body)}`);
      assertEqual(JSON.stringify(res.body.item.stage1DocIds), JSON.stringify([1, 2]));
      assertEqual(JSON.stringify(res.body.item.stage2DocIds), JSON.stringify([2]));
      assertEqual(res.body.item.linkedClassId, 10);
    });

    await run.run('stage1DocIds chứa ID tài liệu KHÔNG tồn tại bị lọc bỏ âm thầm (không văng lỗi, chỉ giữ ID hợp lệ)', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/onboardingPaths/1/edit', {
        name: 'Lộ Trình Nhân Viên Kho',
        stage1Criteria: 'a', stage2Criteria: 'b', stage3Criteria: 'x',
        stage1DocIds: [1, 9999]
      }, TRAINER);
      assertEqual(res.status, 200, `Phải sửa được: ${JSON.stringify(res.body)}`);
      assertEqual(JSON.stringify(res.body.item.stage1DocIds), JSON.stringify([1]), 'ID tài liệu không tồn tại (9999) phải bị lọc bỏ');
    });

    await run.run('linkedClassId trỏ tới lớp KHÔNG tồn tại bị chuẩn hoá về null (không văng lỗi)', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/onboardingPaths/1/edit', {
        name: 'Lộ Trình Nhân Viên Kho',
        stage1Criteria: 'a', stage2Criteria: 'b', stage3Criteria: 'x',
        linkedClassId: 9999
      }, TRAINER);
      assertEqual(res.status, 200, `Phải sửa được: ${JSON.stringify(res.body)}`);
      assertEqual(res.body.item.linkedClassId, null, 'linkedClassId trỏ lớp không tồn tại phải về null');
    });

    await run.run('người không có quyền trainingManage/admin bị từ chối 403 (gác quyền không đổi)', async () => {
      resetRecords();
      const OUTSIDER = { username: 'nv1', name: 'Nhân Viên Một', dept: 'Kinh Doanh', perms: {}, active: true };
      USERS.push(OUTSIDER);
      const res = await api('POST', '/api/records/onboardingPaths/1/edit', { name: 'x', stage3Criteria: 'x' }, OUTSIDER);
      assertEqual(res.status, 403);
      USERS.pop();
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-onboarding-path-edit.js:', err);
  process.exitCode = 1;
});
