// server/tests/test-audit-round4-internal-data-gate.js
//
// Regression test cho ĐỢT AUDIT CHUYÊN SÂU 9/2026 — cụm "Truyền Thông Nội Bộ / Đào Tạo", phần nằm ở
// TẦNG ROUTE (2 phát hiện mức Trung bình). Phần còn lại của cụm (logic thuần) nằm ở bài
// tests/test-audit-round4-internal-training.js.
//
//   1. Gate "Khối 0" moduleAccess.internal ở server (routes/data.js +
//      MODULE_ACCESS_GATED_COLLECTIONS ở lib/recordViewScope.js) trước đây CHỈ phủ internalPosts, bỏ
//      sót 15 collection còn lại của CÙNG module (recruitmentJobs/Referrals, toàn bộ trainingXxx,
//      careerPaths/careerPathConfirmations, onboardingPaths/Progress, hrFeedback) — admin tắt module
//      "Truyền Thông Nội Bộ" cho 1 tài khoản chỉ ẩn được tab ở giao diện, gọi thẳng GET /api/data vẫn
//      thấy nguyên dữ liệu.
//   2. Xoá DANH MỤC Đào Tạo (bài test/chương trình/lộ trình thăng tiến) không kiểm tham chiếu
//      (routes/records.js) — xoá 1 bài test đang gán cho lớp/1 chương trình đang là điều kiện bắt buộc
//      của lộ trình là KHOÁ CỨNG luồng thi/xác nhận đang chạy, không có cách khôi phục nghiệp vụ.
//
// Cùng khuôn tests/test-audit-round2-cluster1.js: KHÔNG mở Playwright, chạy thẳng express router THẬT
// (routes/data.js + routes/records.js) trong tiến trình Node và chỉ giả lập tầng LƯU TRỮ + middleware
// xác thực.
//
// Chạy: node server/tests/test-audit-round4-internal-data-gate.js
const http = require('http');
const path = require('path');

let PORT = 0;

// ===================== 0) Giả lập tầng lưu trữ + xác thực TRƯỚC khi require router =====================
function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

// ===================== Seed =====================
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
// Nhân viên BÌNH THƯỜNG, module "Truyền Thông Nội Bộ" đang BẬT (mặc định).
const NV_CO_MODULE = { username: 'nv1', name: 'Nhân Viên Có Module', dept: 'Kinh Doanh', perms: {}, active: true };
// CÙNG kiểu tài khoản nhưng admin đã TẮT riêng module "internal" — đây là người phải bị chặn.
const NV_TAT_MODULE = { username: 'nv2', name: 'Nhân Viên Bị Tắt Module', dept: 'Kinh Doanh', perms: { moduleAccess: { internal: false } }, active: true };
// Cán bộ đào tạo (trainingManage) — dùng cho phần kiểm chặn xoá danh mục (xoá vẫn chỉ admin).
const TRAINER = { username: 'dt1', name: 'Cán Bộ Đào Tạo', dept: 'Hành Chính', perms: { trainingManage: true }, active: true };

const USERS = [ADMIN, NV_CO_MODULE, NV_TAT_MODULE, TRAINER];

const APP_DATA = { users: USERS, depts: ['Kinh Doanh', 'Hành Chính', 'Ban Giám Đốc'], stores: [] };

// 16 collection thuộc module "Truyền Thông Nội Bộ / Đào Tạo" (5 sub-tab của dropdown 📣 Truyền thông).
const INTERNAL_COLLECTIONS = [
  'internalPosts', 'recruitmentJobs', 'recruitmentReferrals',
  'trainingClasses', 'trainingRegistrations', 'trainingCourses', 'trainingDocuments',
  'trainingDocumentProgress', 'trainingTests', 'trainingTestSubmissions', 'trainingPlans',
  'careerPaths', 'careerPathConfirmations', 'onboardingPaths', 'onboardingProgress', 'hrFeedback'
];

const RECORDS = {};
function resetRecords() {
  for (const key of INTERNAL_COLLECTIONS) RECORDS[key] = [];
  // Mỗi collection có đúng 1 bản ghi "thấy được với mọi người" để phép thử không phụ thuộc bộ lọc
  // quyền xem chi tiết của từng collection (các bộ lọc đó có bài test riêng).
  RECORDS.internalPosts = [{ id: 1, code: 'TT-001', type: 'NEWS', status: 'APPROVED', title: 'Tin nội bộ', author: ADMIN.username, dept: 'Ban Giám Đốc', comments: [], likes: [], readBy: [] }];
  RECORDS.recruitmentJobs = [{ id: 2, code: 'TD-001', title: 'Tuyển nhân viên bán hàng', status: 'OPEN', creator: ADMIN.username, dept: 'Hành Chính' }];
  RECORDS.recruitmentReferrals = [{ id: 3, jobId: 2, creator: NV_TAT_MODULE.username, candidateName: 'Ứng viên A', dept: 'Kinh Doanh' }];
  RECORDS.trainingClasses = [{ id: 4, code: 'LH-001', title: 'An toàn lao động', status: 'OPEN', creator: TRAINER.username, courseId: 6, testId: 9, inviteList: [], dept: 'Hành Chính' }];
  RECORDS.trainingRegistrations = [{ id: 5, classId: 4, creator: NV_TAT_MODULE.username, result: 'REGISTERED', dept: 'Kinh Doanh' }];
  RECORDS.trainingCourses = [{ id: 6, code: 'CT-001', name: 'An toàn lao động', category: 'An toàn', creator: TRAINER.username, dept: 'Hành Chính' }];
  RECORDS.trainingDocuments = [{ id: 7, code: 'TL-001', title: 'Giáo trình ATLĐ', category: 'An toàn', creator: TRAINER.username, dept: 'Hành Chính' }];
  RECORDS.trainingDocumentProgress = [{ id: 8, documentId: 7, username: NV_TAT_MODULE.username }];
  RECORDS.trainingTests = [{ id: 9, code: 'BT-001', title: 'Bài test ATLĐ', questions: [], creator: TRAINER.username, dept: 'Hành Chính' }];
  RECORDS.trainingTestSubmissions = [{ id: 10, testId: 9, classId: 4, username: NV_TAT_MODULE.username }];
  RECORDS.trainingPlans = [{ id: 11, month: '2026-10', courseId: 6, targetDept: 'Kinh Doanh', creator: TRAINER.username, dept: 'Hành Chính' }];
  RECORDS.careerPaths = [{ id: 12, code: 'LT-001', name: 'Lộ trình bán hàng', stages: [{ name: 'Cấp 1', requiredCourseIds: [6] }], creator: TRAINER.username, dept: 'Hành Chính' }];
  RECORDS.careerPathConfirmations = [{ id: 13, pathId: 12, username: NV_TAT_MODULE.username, stageIndex: 0, dept: 'Kinh Doanh' }];
  RECORDS.onboardingPaths = [{ id: 14, code: 'HN-001', name: 'Tân binh KD', stage1RequiredCourseIds: [6], stage2RequiredCourseIds: [], creator: TRAINER.username, dept: 'Hành Chính' }];
  RECORDS.onboardingProgress = [{ id: 15, pathId: 14, employeeUsername: NV_TAT_MODULE.username, employeeName: NV_TAT_MODULE.name, dept: 'Kinh Doanh' }];
  RECORDS.hrFeedback = [{ id: 16, creator: NV_TAT_MODULE.username, content: 'Câu hỏi riêng tư', dept: 'Kinh Doanh' }];
}
resetRecords();

let CURRENT_USERNAME = ADMIN.username;

const { HttpError } = require('../lib/httpErrors');

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAppDataValueWithVersion: async (key) => ({ value: APP_DATA[key] ?? null, version: 'v-test' }),
  getAllAppDataWithVersionsCached: async () => ({ data: { ...APP_DATA }, versions: {} }),
  getAllAppData: async () => ({ ...APP_DATA }),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: 'v-test-2' }; },
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

// Ghi lại các lượt XOÁ thật sự đi tới tầng lưu trữ — dùng để khẳng định lượt xoá bị chặn KHÔNG hề ghi gì.
const DELETED = [];
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(RECORDS)),
  getAllForCollectionCached: async (c) => RECORDS[c] || [],
  getAllForCollection: async (c) => RECORDS[c] || [],
  getForCollectionByDeptCached: async (c, dept) => (RECORDS[c] || []).filter(x => x.dept === dept),
  getForCollectionByUsernameCached: async (c, username) => (RECORDS[c] || []).filter(x => x.username === username),
  getForCollectionByColumnCached: async (c, column, value) => (RECORDS[c] || []).filter(x => x[column] === value),
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
  deleteRecordForCollection: async (c, id, checkFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    if (checkFn) await checkFn(list[idx]);
    list.splice(idx, 1);
    DELETED.push(`${c}:${id}`);
  },
  createForCollectionSerialized: async () => { throw new Error('không dùng trong bài test này'); },
  insertRecord: async () => { throw new Error('không dùng trong bài test này'); },
  withLockedRecordById: async () => { throw new Error('không dùng trong bài test này'); },
  withAppLock: async (key, fn) => fn()
});

stubModule('lib/taskStore', {
  getAllTasksCached: async () => [],
  getAllTasks: async () => [],
  insertTask: async () => { throw new Error('không dùng trong bài test này'); },
  withLockedTaskById: async () => { throw new Error('không dùng trong bài test này'); },
  deleteTaskById: async () => { throw new Error('không dùng trong bài test này'); },
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

// ===================== 1) Require code THẬT (sau khi đã cắm bản giả lập) =====================
const express = require('express');
const { createRunner, assert, assertEqual, assertIncludes } = require('./testHarness');
const dataRoutes = require('../routes/data');
const recordRoutes = require('../routes/records');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
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
    // Fix 1 — moduleAccess.internal phải phủ ĐỦ 16 collection của module
    // ===================================================================================
    // Lớp 3a (task #188): 15/16 collection của module "internal" (tất cả trừ internalPosts) đã chuyển
    // sang GET /api/data/lazy/internalHub (+ /lazy/hrFeedback riêng cho hrFeedback) — gate
    // MODULE_ACCESS_GATED_COLLECTIONS.internal vẫn áp dụng HỆT như cũ, chỉ khác route trả về. Cả 2 nhóm
    // dùng chung 1 vòng lặp zero-out (xem router.get('/lazy/:groupKey') ở routes/data.js) nên test dưới
    // đây gọi cả 3 route (chính + 2 lazy) để phủ đủ 16 collection.
    await run.run('Fix 1 — tài khoản BẬT module "Truyền Thông Nội Bộ" vẫn nhận đủ dữ liệu (không chặn nhầm)', async () => {
      resetRecords();
      const resMain = await api('GET', '/api/data', undefined, NV_CO_MODULE);
      assertEqual(resMain.status, 200, 'GET /api/data phải trả 200');
      assert((resMain.body.internalPosts || []).length > 0, '"internalPosts" phải còn dữ liệu cho tài khoản đang BẬT module');

      const resHub = await api('GET', '/api/data/lazy/internalHub', undefined, NV_CO_MODULE);
      assertEqual(resHub.status, 200, 'GET /api/data/lazy/internalHub phải trả 200');
      // Chọn các collection KHÔNG bị bộ lọc quyền xem chi tiết nào cắt bớt với người dùng thường.
      for (const key of ['recruitmentJobs', 'trainingClasses', 'trainingCourses', 'trainingDocuments', 'trainingTests', 'trainingPlans', 'careerPaths', 'onboardingPaths']) {
        assert((resHub.body[key] || []).length > 0, `"${key}" phải còn dữ liệu cho tài khoản đang BẬT module`);
      }
      // Các collection riêng tư theo người: người này KHÔNG phải chủ sở hữu nên vốn đã rỗng — không dùng
      // để kiểm ở đây (đã có bài test riêng cho từng bộ lọc).
    });

    await run.run('Fix 1 — TẮT module -> TẤT CẢ 16 collection của module về rỗng', async () => {
      resetRecords();
      const resMain = await api('GET', '/api/data', undefined, NV_TAT_MODULE);
      assertEqual(resMain.status, 200, 'GET /api/data phải trả 200 (chỉ rỗng dữ liệu, không lỗi)');
      assertEqual((resMain.body.internalPosts || []).length, 0, '"internalPosts" phải RỖNG khi moduleAccess.internal = false');

      const resHub = await api('GET', '/api/data/lazy/internalHub', undefined, NV_TAT_MODULE);
      assertEqual(resHub.status, 200, 'GET /api/data/lazy/internalHub phải trả 200 (chỉ rỗng dữ liệu, không lỗi)');
      for (const key of INTERNAL_COLLECTIONS.filter(k => k !== 'internalPosts' && k !== 'hrFeedback')) {
        assertEqual((resHub.body[key] || []).length, 0,
          `"${key}" phải RỖNG khi moduleAccess.internal = false — trước bản vá chỉ internalPosts bị chặn`);
      }

      const resFeedback = await api('GET', '/api/data/lazy/hrFeedback', undefined, NV_TAT_MODULE);
      assertEqual((resFeedback.body.hrFeedback || []).length, 0, '"hrFeedback" phải RỖNG khi moduleAccess.internal = false');
    });

    await run.run('Fix 1 — dữ liệu RIÊNG TƯ của chính người bị tắt module cũng không trả về (gate module là lớp chặn độc lập)', async () => {
      resetRecords();
      const resMain = await api('GET', '/api/data', undefined, NV_TAT_MODULE);
      assertEqual((resMain.body.trainingDocumentProgress || []).length, 0, '"trainingDocumentProgress" của chính người dùng vẫn phải bị gate module chặn');

      const resHub = await api('GET', '/api/data/lazy/internalHub', undefined, NV_TAT_MODULE);
      // 5 collection dưới đây vốn CÓ bản ghi của chính nv2 (bộ lọc quyền xem sẽ cho qua) — chỉ gate
      // module mới là thứ chặn được chúng.
      for (const key of ['trainingRegistrations', 'trainingTestSubmissions', 'careerPathConfirmations', 'onboardingProgress', 'recruitmentReferrals']) {
        assertEqual((resHub.body[key] || []).length, 0, `"${key}" của chính người dùng vẫn phải bị gate module chặn`);
      }

      const resFeedback = await api('GET', '/api/data/lazy/hrFeedback', undefined, NV_TAT_MODULE);
      assertEqual((resFeedback.body.hrFeedback || []).length, 0, '"hrFeedback" của chính người dùng vẫn phải bị gate module chặn');
    });

    await run.run('Fix 1 — Admin KHÔNG bị gate chặn (hasModuleAccessServer trả true cho admin)', async () => {
      resetRecords();
      const res = await api('GET', '/api/data/lazy/internalHub', undefined, ADMIN);
      assert((res.body.trainingClasses || []).length > 0, 'Admin phải thấy đủ dữ liệu module');
    });

    await run.run('Fix 1 — tắt module "internal" KHÔNG làm rỗng dữ liệu module khác', async () => {
      resetRecords();
      const res = await api('GET', '/api/data', undefined, NV_TAT_MODULE);
      assert(Array.isArray(res.body.users) && res.body.users.length > 0, 'Danh sách tài khoản (dùng chung toàn app) phải còn nguyên');
    });

    // ===================================================================================
    // Fix 2 — chặn xoá danh mục Đào Tạo còn đang được tham chiếu
    // ===================================================================================
    await run.run('Fix 2 — xoá BÀI TEST đang gán cho 1 lớp học -> 409, bản ghi KHÔNG bị xoá', async () => {
      resetRecords();
      DELETED.length = 0;
      const res = await api('POST', '/api/records/trainingTests/9/delete', {}, ADMIN);
      assertEqual(res.status, 409, 'Phải bị chặn 409 vì lớp LH-001 đang gán bài test này');
      assertIncludes(res.body.error, 'lớp học', 'Thông báo phải nêu rõ lý do là còn lớp học đang gán');
      assertEqual(RECORDS.trainingTests.length, 1, 'Bài test phải còn nguyên');
      assertEqual(DELETED.length, 0, 'Không được có lượt ghi xoá nào đi tới tầng lưu trữ');
    });

    await run.run('Fix 2 — gỡ bài test khỏi lớp rồi xoá -> thành công (không chặn oan)', async () => {
      resetRecords();
      DELETED.length = 0;
      RECORDS.trainingClasses[0].testId = null;
      const res = await api('POST', '/api/records/trainingTests/9/delete', {}, ADMIN);
      assertEqual(res.status, 200, 'Không còn tham chiếu thì phải xoá được như trước');
      assertEqual(RECORDS.trainingTests.length, 0);
    });

    await run.run('Fix 2 — xoá CHƯƠNG TRÌNH đang được lớp học/kế hoạch/lộ trình dùng -> 409, nêu đủ nơi tham chiếu', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/trainingCourses/6/delete', {}, ADMIN);
      assertEqual(res.status, 409);
      assertIncludes(res.body.error, 'lớp học');
      assertIncludes(res.body.error, 'kế hoạch đào tạo');
      assertIncludes(res.body.error, 'lộ trình thăng tiến');
      assertIncludes(res.body.error, 'lộ trình đào tạo tân binh');
      assertEqual(RECORDS.trainingCourses.length, 1, 'Chương trình phải còn nguyên');
    });

    await run.run('Fix 2 — chương trình KHÔNG còn ai tham chiếu -> xoá được bình thường', async () => {
      resetRecords();
      RECORDS.trainingClasses = [];
      RECORDS.trainingPlans = [];
      RECORDS.careerPaths = [];
      RECORDS.onboardingPaths = [];
      const res = await api('POST', '/api/records/trainingCourses/6/delete', {}, ADMIN);
      assertEqual(res.status, 200);
      assertEqual(RECORDS.trainingCourses.length, 0);
    });

    await run.run('Fix 2 — xoá LỘ TRÌNH THĂNG TIẾN đã có mốc xác nhận của nhân viên -> 409', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/careerPaths/12/delete', {}, ADMIN);
      assertEqual(res.status, 409);
      assertIncludes(res.body.error, 'mốc xác nhận');
      assertEqual(RECORDS.careerPaths.length, 1);
    });

    await run.run('Fix 2 — lộ trình thăng tiến chưa có mốc xác nhận nào -> xoá được bình thường', async () => {
      resetRecords();
      RECORDS.careerPathConfirmations = [];
      const res = await api('POST', '/api/records/careerPaths/12/delete', {}, ADMIN);
      assertEqual(res.status, 200);
      assertEqual(RECORDS.careerPaths.length, 0);
    });

    await run.run('Fix 2 — 3 route xoá này VẪN chỉ dành cho Admin (không nới quyền khi thêm kiểm tham chiếu)', async () => {
      resetRecords();
      RECORDS.trainingClasses = []; RECORDS.trainingPlans = []; RECORDS.careerPaths = []; RECORDS.onboardingPaths = [];
      const denied = await api('POST', '/api/records/trainingCourses/6/delete', {}, TRAINER);
      assertEqual(denied.status, 403, 'trainingManage KHÔNG được xoá danh mục — giữ nguyên luật cũ');
      assertEqual(RECORDS.trainingCourses.length, 1, 'Chương trình phải còn nguyên sau lượt xoá bị từ chối');
    });

    // ===================================================================================
    // Thu hồi mốc xác nhận Lộ Trình Thăng Tiến (route mới, phần logic có bài test riêng)
    // ===================================================================================
    await run.run('Route mới — POST /careerPathConfirmations/:id/revoke: trainingManage thu hồi được mốc xác nhận', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/careerPathConfirmations/13/revoke', {}, TRAINER);
      assertEqual(res.status, 200);
      assertEqual(RECORDS.careerPathConfirmations.length, 0, 'Mốc xác nhận phải được gỡ khỏi collection (vào Thùng Rác ở bản thật)');
    });

    await run.run('Route mới — người dùng thường KHÔNG thu hồi được mốc xác nhận (403)', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/careerPathConfirmations/13/revoke', {}, NV_CO_MODULE);
      assertEqual(res.status, 403);
      assertEqual(RECORDS.careerPathConfirmations.length, 1);
    });

    // ===================================================================================
    // Đóng/mở lại đăng ký lớp học (route mới)
    // ===================================================================================
    await run.run('Route mới — POST /trainingClasses/:id/close-registration đổi status sang CLOSED', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/trainingClasses/4/close-registration', {}, TRAINER);
      assertEqual(res.status, 200);
      assertEqual(RECORDS.trainingClasses[0].status, 'CLOSED');
      const reopen = await api('POST', '/api/records/trainingClasses/4/reopen-registration', {}, TRAINER);
      assertEqual(reopen.status, 200);
      assertEqual(RECORDS.trainingClasses[0].status, 'OPEN');
    });

    await run.run('Route mới — người dùng thường không đóng được đăng ký lớp (403)', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/trainingClasses/4/close-registration', {}, NV_CO_MODULE);
      assertEqual(res.status, 403);
      assertEqual(RECORDS.trainingClasses[0].status, 'OPEN');
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-audit-round4-internal-data-gate.js:', err);
  process.exitCode = 1;
});
