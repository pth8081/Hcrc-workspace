// server/tests/test-audit-round2-cluster5.js
//
// Regression test cho ĐỢT 2 rà soát bảo mật — cụm 5 (Báo Cáo / Đào Tạo / Truyền Thông / Tuyển Dụng /
// Đồng Phục / Giấy Phép). Mỗi kịch bản gắn với ĐÚNG 1 lỗ hổng đã vá, viết sao cho hoàn tác bản vá là
// test FAIL ngay:
//
//   1. (High) MỌI route mutation của internalPosts (mark-read/like/comment/comment-like/đăng ký đào
//      tạo...) nạp bài THEO ID rồi trả nguyên văn bài đó về client mà KHÔNG hề gọi canViewInternalPost()
//      -> ai đã đăng nhập, chỉ cần đoán id, gọi mark-read là đọc trọn nội dung bài đang chờ duyệt/bị từ
//      chối/bị ẩn (hoặc bài NEWS hẹn giờ chưa tới lịch đăng) — vô hiệu hoá hoàn toàn hàng rào phía GET
//      /api/data. Vá: assertCanViewInternalPost() trong withInternalPostAction() + route /comment
//      (routes/records.js), dùng LẠI canViewInternalPost() ở lib/recordViewScope.js.
//   2. (Medium) buildUniformIssuance() truyền cứng `null` vào tham số allAdjustments của
//      computeUniformStock() -> tồn kho lúc CẤP PHÁT bỏ qua sạch hàng đã báo Hỏng/Hủy/Mất và phần đã
//      thu hồi từ nhân viên, cấp được cả món thực tế không còn trong kho (và lệch hẳn màn hình Kho ở
//      public/index.html vốn đã trừ adjustments). Vá: route đọc thêm uniformStockAdjustments và truyền
//      xuống (routes/records.js + lib/recordActions.js).
//   3. (Medium) Giới hạn thời gian làm bài test (cls.testSecondsPerQuestion) chỉ tồn tại ở đồng hồ
//      client. Vá (MỘT PHẦN, cố ý — xem evaluateTrainingTestTiming()): route .../start-test ghi mốc bắt
//      đầu ở server, submit-test tính số giây thực tế + gắn cờ overTimeLimit vào bản ghi nộp bài. KHÔNG
//      chặn nộp (luồng hợp lệ cho phép thoát ra vào làm lại từ đầu).
//   4. (Low) closeRecruitmentJob() chỉ cho creator/admin, lệch với confirmRecruitmentJobFilled()/
//      setRecruitmentReferralStatus() vốn dùng canManageRecruitment() cho cả đội tuyển dụng.
//   5. (Low) revokeLicense() không đòi status === 'APPROVED' như setLicenseRenewing() -> thu hồi được
//      cả giấy phép còn đang chờ duyệt/đã bị từ chối (trạng thái vô nghĩa, sai thống kê).
//
// KIẾN TRÚC: giống test-audit-fixes-batch1.js — KHÔNG mở trình duyệt Playwright. Toàn bộ lỗ hổng nằm ở
// TẦNG SERVER, nên chạy thẳng express router THẬT (routes/records.js) trong tiến trình Node và chỉ giả
// lập tầng LƯU TRỮ + middleware xác thực.
//
// Chạy: node server/tests/test-audit-round2-cluster5.js
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
const APPROVER = { username: 'mod1', name: 'Người Kiểm Duyệt Bài', dept: 'Hành Chính', perms: { internalPostApprove: true }, active: true };
const AUTHOR = { username: 'tacgia', name: 'Tác Giả Bài Chờ Duyệt', dept: 'Kinh Doanh', perms: {}, active: true };
const OUTSIDER = { username: 'nguoila', name: 'Người Ngoài Cuộc', dept: 'Kinh Doanh', perms: {}, active: true };

const STORE_MGR = { username: 'gd_sieuthi', name: 'Giám Đốc Siêu Thị A', dept: 'Siêu Thị A', perms: { uniformStoreManage: true }, active: true };
const STORE_STAFF = { username: 'nv_sieuthi', name: 'Nhân Viên Siêu Thị A', dept: 'Siêu Thị A', perms: {}, active: true };

const HR_POSTER = { username: 'hr1', name: 'Nhân Sự Đăng Tin', dept: 'Nhân Sự', perms: { internalRecruitmentCreate: true }, active: true };
const HR_TEAMMATE = { username: 'hr2', name: 'Nhân Sự Cùng Đội', dept: 'Nhân Sự', perms: { internalRecruitmentCreate: true }, active: true };

const LICENSE_APPROVER = { username: 'gp_duyet', name: 'Người Duyệt Giấy Phép', dept: 'Pháp Chế', perms: { licenseApprove: true }, active: true };

const TRAINEE = { username: 'hocvien', name: 'Học Viên', dept: 'Kinh Doanh', perms: {}, active: true };
const TRAINEE2 = { username: 'hocvien2', name: 'Học Viên Chưa Đăng Ký', dept: 'Kinh Doanh', perms: {}, active: true };

const USERS = [ADMIN, APPROVER, AUTHOR, OUTSIDER, STORE_MGR, STORE_STAFF, HR_POSTER, HR_TEAMMATE, LICENSE_APPROVER, TRAINEE, TRAINEE2];

const APP_DATA = {
  users: USERS,
  depts: ['Kinh Doanh', 'Hành Chính', 'Nhân Sự', 'Pháp Chế', 'Siêu Thị A', 'Ban Giám Đốc'],
  sensitiveKeywords: []
};

// Nội dung "bí mật" dùng để chứng minh có/không rò rỉ qua response của route mutation.
const SECRET_PENDING = 'NOI DUNG BAI CHO DUYET KHONG DUOC LO RA NGOAI';
const SECRET_SCHEDULED = 'NOI DUNG BAI HEN GIO CHUA TOI LICH DANG';
const SECRET_TRAINING = 'NOI DUNG LOP DAO TAO CHUA DUOC DUYET';

const RECORDS = {
  internalPosts: [],
  uniformPeriods: [], uniformIssuances: [], uniformStockAdjustments: [], uniformTransfers: [],
  recruitmentJobs: [],
  licenses: [],
  trainingClasses: [], trainingTests: [], trainingRegistrations: [], trainingTestSubmissions: []
};

function resetRecords() {
  RECORDS.internalPosts = [
    // Bài "Góc Chia Sẻ" đang CHỜ DUYỆT của AUTHOR — chỉ tác giả/người duyệt/admin được xem.
    {
      id: 9101, type: 'SHARE', status: 'PENDING', author: AUTHOR.username, authorName: AUTHOR.name,
      dept: AUTHOR.dept, title: 'Bài chờ duyệt', content: SECRET_PENDING, publishAt: null,
      likes: [], readBy: [], comments: []
    },
    // Bài NEWS đã duyệt nhưng HẸN GIỜ đăng ở tương lai — cũng chỉ tác giả/người duyệt được xem trước.
    {
      id: 9102, type: 'NEWS', status: 'APPROVED', author: APPROVER.username, authorName: APPROVER.name,
      dept: 'Hành Chính', title: 'Bài hẹn giờ', content: SECRET_SCHEDULED,
      publishAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      likes: [], readBy: [], comments: []
    },
    // Bài đã đăng công khai — MỌI người đã đăng nhập vẫn phải tương tác được như trước (chống "vá quá tay").
    {
      id: 9103, type: 'NEWS', status: 'APPROVED', author: APPROVER.username, authorName: APPROVER.name,
      dept: 'Hành Chính', title: 'Bài đã đăng', content: 'Nội dung công khai', publishAt: null,
      likes: [], readBy: [], comments: []
    },
    // Bài Đào Tạo còn CHỜ DUYỆT — dùng cho register-training/unregister-training.
    {
      id: 9104, type: 'TRAINING', status: 'PENDING', author: APPROVER.username, authorName: APPROVER.name,
      dept: 'Hành Chính', title: 'Lớp chờ duyệt', content: SECRET_TRAINING, publishAt: null,
      training: { capacity: 10, registerDeadline: '', registeredUsers: [] },
      likes: [], readBy: [], comments: []
    },
    // Bài Đào Tạo ĐÃ ĐĂNG — đăng ký/huỷ đăng ký vẫn phải chạy bình thường cho mọi người.
    {
      id: 9105, type: 'TRAINING', status: 'APPROVED', author: APPROVER.username, authorName: APPROVER.name,
      dept: 'Hành Chính', title: 'Lớp đã đăng', content: 'Nội dung công khai', publishAt: null,
      training: { capacity: 10, registerDeadline: '', registeredUsers: [] },
      likes: [], readBy: [], comments: []
    },
    // Bài đã đăng rồi bị Admin ẩn — chỉ tác giả/người duyệt còn thấy.
    {
      id: 9106, type: 'NEWS', status: 'HIDDEN', author: APPROVER.username, authorName: APPROVER.name,
      dept: 'Hành Chính', title: 'Bài bị ẩn', content: 'Nội dung bài bị ẩn', publishAt: null,
      likes: [], readBy: [], comments: []
    }
  ];

  // ĐỒNG PHỤC — Siêu Thị A đã nhận (CONFIRMED) 10 áo size M.
  RECORDS.uniformPeriods = [
    {
      id: 5001, code: 'DP-2026-001', status: 'APPROVED',
      allocations: [
        { id: 1, dept: 'Siêu Thị A', status: 'CONFIRMED', items: [{ name: 'Áo Sơ Mi', size: 'M', qty: 10 }] }
      ]
    }
  ];
  RECORDS.uniformIssuances = [];
  RECORDS.uniformStockAdjustments = [];
  RECORDS.uniformTransfers = [];

  RECORDS.recruitmentJobs = [
    { id: 6001, code: 'TD-2026-001', title: 'Tuyển Nhân Viên Bán Hàng', status: 'OPEN', slots: 3, creator: HR_POSTER.username, creatorName: HR_POSTER.name, dept: 'Nhân Sự' },
    { id: 6002, code: 'TD-2026-002', title: 'Tuyển Thu Ngân', status: 'OPEN', slots: 2, creator: HR_POSTER.username, creatorName: HR_POSTER.name, dept: 'Nhân Sự' }
  ];

  RECORDS.licenses = [
    { id: 7001, code: 'GP-001', title: 'Giấy phép còn chờ duyệt', status: 'PENDING', lifecycleStatus: null, history: [] },
    { id: 7002, code: 'GP-002', title: 'Giấy phép đã bị từ chối', status: 'REJECTED', lifecycleStatus: null, history: [] },
    { id: 7003, code: 'GP-003', title: 'Giấy phép đã duyệt', status: 'APPROVED', lifecycleStatus: null, history: [] }
  ];

  // ĐÀO TẠO — lớp ONLINE đã kết thúc, có bài test 2 câu, 60s/câu (ngân sách 120s).
  RECORDS.trainingClasses = [
    {
      id: 4001, code: 'LOP-001', title: 'Lớp Kỹ Năng Bán Hàng', mode: 'ONLINE',
      testId: 3001, passScore: 50, testSecondsPerQuestion: 60, documentIds: [],
      creator: APPROVER.username, status: 'OPEN'
    }
  ];
  RECORDS.trainingTests = [
    {
      id: 3001, title: 'Bài Test Kỹ Năng Bán Hàng',
      questions: [
        { id: 1, text: 'Câu 1', type: 'SINGLE', points: 1, options: [{ id: 11, text: 'A' }, { id: 12, text: 'B' }], correctOptionIds: [11] },
        { id: 2, text: 'Câu 2', type: 'SINGLE', points: 1, options: [{ id: 21, text: 'A' }, { id: 22, text: 'B' }], correctOptionIds: [22] }
      ]
    }
  ];
  RECORDS.trainingRegistrations = [
    { id: 2001, classId: 4001, classCode: 'LOP-001', creator: TRAINEE.username, creatorName: TRAINEE.name, result: 'REGISTERED', viewedDocumentIds: [] }
  ];
  RECORDS.trainingTestSubmissions = [];
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

let INSERT_ID = 100000;
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(RECORDS)),
  getAllForCollectionCached: async (c) => RECORDS[c] || [],
  getAllForCollection: async (c) => RECORDS[c] || [],
  withLockedRecordForCollection: async (c, id, mutator) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    const updated = await mutator(list[idx]);
    list[idx] = updated;
    return updated;
  },
  insertRecord: async (c, record) => {
    const saved = { ...record, id: record.id ?? ++INSERT_ID };
    if (!RECORDS[c]) RECORDS[c] = [];
    RECORDS[c].push(saved);
    return saved;
  },
  createForCollection: async () => { throw new Error('không dùng trong bài test này'); },
  createForCollectionSerialized: async () => { throw new Error('không dùng trong bài test này'); },
  withLockedRecordById: async () => { throw new Error('không dùng trong bài test này'); },
  deleteRecordForCollection: async () => { throw new Error('không dùng trong bài test này'); },
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
const recordActions = require('../lib/recordActions');
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

// Toàn bộ response (kể cả field lồng sâu) không được chứa chuỗi bí mật nào.
function assertNoLeak(res, secret, message) {
  const dump = JSON.stringify(res.body || {});
  assert(!dump.includes(secret), `${message} (response rò rỉ: ${dump.slice(0, 300)})`);
}

function expectThrows(fn, message) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error(message || 'Đáng lẽ phải ném lỗi nhưng không ném');
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    // ===================================================================================
    // Fix 1 — internalPosts: mọi route mutation phải qua canViewInternalPost() trước khi mutate
    // ===================================================================================
    const BLOCKED_ACTIONS = [
      ['mark-read', {}],
      ['like', {}],
      ['comment', { content: 'Bình luận thử để đọc trộm bài' }],
      ['comment/1/like', {}],
      ['register-training', {}],
      ['unregister-training', {}]
    ];

    for (const [action, payload] of BLOCKED_ACTIONS) {
      await run.run(`Fix 1 — người KHÔNG có quyền xem bài CHỜ DUYỆT bị chặn 403 ở "${action}" và không đọc được nội dung`, async () => {
        resetRecords();
        const res = await api('POST', `/api/records/internalPosts/9101/${action}`, payload, OUTSIDER);
        assertEqual(res.status, 403, `"${action}" trên bài PENDING của người khác PHẢI bị chặn 403`);
        assertNoLeak(res, SECRET_PENDING, `"${action}" không được để lộ nội dung bài chờ duyệt`);
        // ...và cũng không được ghi gì vào bài (đọc trộm đã chặn thì ghi trộm càng phải chặn).
        const post = RECORDS.internalPosts.find(p => p.id === 9101);
        assertEqual((post.readBy || []).length, 0, 'Bài chờ duyệt không được ghi nhận lượt đọc của người ngoài');
        assertEqual((post.likes || []).length, 0, 'Bài chờ duyệt không được ghi nhận lượt thích của người ngoài');
        assertEqual((post.comments || []).length, 0, 'Bài chờ duyệt không được nhận bình luận của người ngoài');
      });
    }

    await run.run('Fix 1 — bài NEWS hẹn giờ (APPROVED nhưng chưa tới publishAt) cũng bị chặn với người thường', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/internalPosts/9102/mark-read', {}, OUTSIDER);
      assertEqual(res.status, 403, 'Bài hẹn giờ chưa tới lịch đăng PHẢI bị chặn như bài chưa duyệt');
      assertNoLeak(res, SECRET_SCHEDULED, 'Không được để lộ nội dung bài hẹn giờ trước lịch đăng');
    });

    await run.run('Fix 1 — bài đã đăng rồi bị Admin ẩn (HIDDEN) cũng bị chặn với người thường', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/internalPosts/9106/like', {}, OUTSIDER);
      assertEqual(res.status, 403, 'Bài HIDDEN PHẢI bị chặn với người không có quyền duyệt');
    });

    await run.run('Fix 1 — bài Đào Tạo CHỜ DUYỆT: register-training bị chặn, không ghi được suất đăng ký', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/internalPosts/9104/register-training', {}, OUTSIDER);
      assertEqual(res.status, 403, 'Đăng ký lớp thuộc bài chưa duyệt PHẢI bị chặn');
      assertNoLeak(res, SECRET_TRAINING, 'Không được để lộ nội dung bài đào tạo chưa duyệt');
      const post = RECORDS.internalPosts.find(p => p.id === 9104);
      assertEqual((post.training.registeredUsers || []).length, 0, 'Không được ghi suất đăng ký vào bài chưa duyệt');
    });

    // ===== Chống "vá quá tay": người ĐƯỢC xem vẫn phải thao tác bình thường =====
    await run.run('Fix 1 — TÁC GIẢ vẫn tương tác được với chính bài chờ duyệt của mình', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/internalPosts/9101/mark-read', {}, AUTHOR);
      assertEqual(res.status, 200, 'Tác giả PHẢI vẫn đọc/đánh dấu đã đọc được bài của chính mình');
      assertIncludes(res.body.item.readBy, AUTHOR.username, 'readBy phải ghi nhận tác giả');
    });

    await run.run('Fix 1 — NGƯỜI KIỂM DUYỆT (internalPostApprove) vẫn tương tác được với bài chờ duyệt', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/internalPosts/9101/like', {}, APPROVER);
      assertEqual(res.status, 200, 'Người kiểm duyệt PHẢI vẫn xem/thích được bài đang chờ duyệt');
      assertEqual(res.body.item.content, SECRET_PENDING, 'Người kiểm duyệt vẫn nhận đủ nội dung như trước');
    });

    await run.run('Fix 1 — ADMIN vẫn tương tác được với bài chờ duyệt', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/internalPosts/9101/mark-read', {}, ADMIN);
      assertEqual(res.status, 200, 'Admin PHẢI vẫn thao tác được');
    });

    await run.run('Fix 1 — bài ĐÃ ĐĂNG: mọi người dùng thường vẫn mark-read/like/comment như trước', async () => {
      resetRecords();
      const r1 = await api('POST', '/api/records/internalPosts/9103/mark-read', {}, OUTSIDER);
      assertEqual(r1.status, 200, 'mark-read trên bài đã đăng KHÔNG được bị chặn');
      const r2 = await api('POST', '/api/records/internalPosts/9103/like', {}, OUTSIDER);
      assertEqual(r2.status, 200, 'like trên bài đã đăng KHÔNG được bị chặn');
      assertIncludes(r2.body.item.likes, OUTSIDER.username, 'Lượt thích phải được ghi nhận như trước');
      const r3 = await api('POST', '/api/records/internalPosts/9103/comment', { content: 'Bình luận hợp lệ' }, OUTSIDER);
      assertEqual(r3.status, 200, 'comment trên bài đã đăng KHÔNG được bị chặn');
      assert(r3.body.item.comments.some(c => c.content === 'Bình luận hợp lệ'), 'Bình luận vừa gửi phải có trong response');
    });

    await run.run('Fix 1 — bài Đào Tạo ĐÃ ĐĂNG: đăng ký rồi huỷ đăng ký vẫn chạy bình thường', async () => {
      resetRecords();
      const reg = await api('POST', '/api/records/internalPosts/9105/register-training', {}, OUTSIDER);
      assertEqual(reg.status, 200, 'Đăng ký lớp đã đăng KHÔNG được bị chặn');
      assertIncludes(reg.body.item.training.registeredUsers, OUTSIDER.username, 'Suất đăng ký phải được ghi nhận như trước');
      const unreg = await api('POST', '/api/records/internalPosts/9105/unregister-training', {}, OUTSIDER);
      assertEqual(unreg.status, 200, 'Huỷ đăng ký lớp đã đăng KHÔNG được bị chặn');
      assertEqual(unreg.body.item.training.registeredUsers.length, 0, 'Huỷ đăng ký phải gỡ đúng suất vừa đăng ký');
    });

    // ===================================================================================
    // Fix 2 — Đồng Phục: tồn kho lúc cấp phát phải trừ HONG/HUY/MAT và cộng lại phần thu hồi
    // ===================================================================================
    await run.run('Fix 2 — cấp phát vượt tồn sau khi đã báo Hỏng/Hủy/Mất bị chặn 409 (trước đây lọt)', async () => {
      resetRecords();
      // 10 áo M đã nhận. Báo hỏng 3 + huỷ 2 (trực tiếp từ kho) -> chỉ còn 5.
      RECORDS.uniformStockAdjustments = [
        { id: 8001, dept: 'Siêu Thị A', source: 'STOCK', outcome: 'HONG', itemName: 'Áo Sơ Mi', size: 'M', qty: 3, reason: 'Rách' },
        { id: 8002, dept: 'Siêu Thị A', source: 'STOCK', outcome: 'HUY', itemName: 'Áo Sơ Mi', size: 'M', qty: 2, reason: 'Sai mẫu' }
      ];
      const res = await api('POST', '/api/records/uniformIssuances/create', {
        code: 'CP-001', employeeUsername: STORE_STAFF.username, items: [{ name: 'Áo Sơ Mi', size: 'M', qty: 6 }]
      }, STORE_MGR);
      assertEqual(res.status, 409, 'Cấp 6 khi thực tế chỉ còn 5 PHẢI bị chặn');
      assertIncludes(res.body.error, 'còn 5', 'Thông báo phải nêu đúng số tồn thật (10 - 3 hỏng - 2 hủy = 5)');
      assertEqual(RECORDS.uniformIssuances.length, 0, 'Không được ghi bản ghi cấp phát nào');
    });

    await run.run('Fix 2 — hàng bị MẤT (source EMPLOYEE, outcome MAT) cũng phải trừ khỏi tồn khi cấp phát', async () => {
      resetRecords();
      // Đã cấp 4 cho nhân viên, sau đó thu hồi 4 nhưng phát hiện MẤT hết -> tồn = 10 - (4 - 4) - 4 = 6.
      RECORDS.uniformIssuances = [
        { id: 8100, dept: 'Siêu Thị A', employeeUsername: STORE_STAFF.username, items: [{ name: 'Áo Sơ Mi', size: 'M', qty: 4 }] }
      ];
      RECORDS.uniformStockAdjustments = [
        { id: 8101, dept: 'Siêu Thị A', source: 'EMPLOYEE', outcome: 'MAT', itemName: 'Áo Sơ Mi', size: 'M', qty: 4, reason: 'Nhân viên làm mất', employeeUsername: STORE_STAFF.username }
      ];
      const res = await api('POST', '/api/records/uniformIssuances/create', {
        code: 'CP-002', employeeUsername: STORE_STAFF.username, items: [{ name: 'Áo Sơ Mi', size: 'M', qty: 7 }]
      }, STORE_MGR);
      assertEqual(res.status, 409, 'Cấp 7 khi chỉ còn 6 PHẢI bị chặn');
      assertIncludes(res.body.error, 'còn 6', 'Số tồn phải khớp công thức allocated - (issued - recalled) - mat');
    });

    await run.run('Fix 2 — vẫn cấp phát bình thường trong phạm vi tồn kho ĐÃ trừ điều chỉnh', async () => {
      resetRecords();
      RECORDS.uniformStockAdjustments = [
        { id: 8201, dept: 'Siêu Thị A', source: 'STOCK', outcome: 'HONG', itemName: 'Áo Sơ Mi', size: 'M', qty: 3, reason: 'Rách' }
      ];
      const res = await api('POST', '/api/records/uniformIssuances/create', {
        code: 'CP-003', employeeUsername: STORE_STAFF.username, items: [{ name: 'Áo Sơ Mi', size: 'M', qty: 7 }]
      }, STORE_MGR);
      assertEqual(res.status, 200, 'Cấp đúng 7 = tồn thật (10 - 3) PHẢI thành công');
      assertEqual(RECORDS.uniformIssuances.length, 1, 'Bản ghi cấp phát phải được lưu');
    });

    await run.run('Fix 2 — điều chỉnh của SIÊU THỊ KHÁC không được ảnh hưởng tồn kho siêu thị này', async () => {
      resetRecords();
      RECORDS.uniformStockAdjustments = [
        { id: 8301, dept: 'Siêu Thị B', source: 'STOCK', outcome: 'HUY', itemName: 'Áo Sơ Mi', size: 'M', qty: 9, reason: 'Kho khác' }
      ];
      const res = await api('POST', '/api/records/uniformIssuances/create', {
        code: 'CP-004', employeeUsername: STORE_STAFF.username, items: [{ name: 'Áo Sơ Mi', size: 'M', qty: 10 }]
      }, STORE_MGR);
      assertEqual(res.status, 200, 'Điều chỉnh của siêu thị khác KHÔNG được trừ vào tồn của siêu thị này');
    });

    await run.run('Fix 2 — buildUniformIssuance() không còn tự nuốt tham số điều chỉnh (kiểm tra trực tiếp hàm)', () => {
      const periods = [{ id: 1, allocations: [{ id: 1, dept: 'Siêu Thị A', status: 'CONFIRMED', items: [{ name: 'Áo Sơ Mi', size: 'M', qty: 10 }] }] }];
      const adjustments = [{ id: 1, dept: 'Siêu Thị A', source: 'STOCK', outcome: 'HONG', itemName: 'Áo Sơ Mi', size: 'M', qty: 8, reason: 'Hỏng' }];
      const err = expectThrows(
        () => recordActions.buildUniformIssuance(STORE_MGR, { employeeUsername: STORE_STAFF.username, items: [{ name: 'Áo Sơ Mi', size: 'M', qty: 5 }] }, periods, [], adjustments, USERS, []),
        'Phải ném 409 vì tồn thật chỉ còn 2'
      );
      assertEqual(err.status, 409, 'Phải là lỗi 409 thiếu tồn kho');
      assertIncludes(err.message, 'còn 2', 'Tồn thật = 10 - 8 hỏng = 2');
    });

    // ===================================================================================
    // Fix 3 — Đào Tạo: mốc bắt đầu làm bài được ghi Ở SERVER (vá MỘT PHẦN, cố ý không chặn nộp)
    // ===================================================================================
    await run.run('Fix 3 — start-test ghi testStartedAt vào đúng dòng đăng ký của học viên', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/trainingClasses/4001/start-test', {}, TRAINEE);
      assertEqual(res.status, 200, 'Học viên đã đăng ký PHẢI bắt đầu được bài test');
      const reg = RECORDS.trainingRegistrations.find(r => r.id === 2001);
      assert(!!reg.testStartedAt, 'testStartedAt PHẢI được ghi ở server, không thể chỉ tin đồng hồ client');
      assert(Number.isFinite(new Date(reg.testStartedAt).getTime()), 'testStartedAt phải parse được (dạng ISO)');
    });

    await run.run('Fix 3 — gọi lại start-test KHÔNG làm mới mốc bắt đầu (nếu không thì gian lận chỉ cần gọi lại trước khi nộp)', async () => {
      resetRecords();
      await api('POST', '/api/records/trainingClasses/4001/start-test', {}, TRAINEE);
      const first = RECORDS.trainingRegistrations.find(r => r.id === 2001).testStartedAt;
      await new Promise(r => setTimeout(r, 20));
      await api('POST', '/api/records/trainingClasses/4001/start-test', {}, TRAINEE);
      const second = RECORDS.trainingRegistrations.find(r => r.id === 2001).testStartedAt;
      assertEqual(second, first, 'Mốc bắt đầu chỉ được ghi LẦN ĐẦU');
    });

    await run.run('Fix 3 — người CHƯA đăng ký lớp không bắt đầu được bài test (403)', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/trainingClasses/4001/start-test', {}, TRAINEE2);
      assertEqual(res.status, 403, 'Chưa đăng ký thì không có gì để bắt đầu');
    });

    await run.run('Fix 3 — nộp bài trong thời gian cho phép: bản ghi kèm số giây thực tế, KHÔNG bị gắn cờ quá giờ', async () => {
      resetRecords();
      await api('POST', '/api/records/trainingClasses/4001/start-test', {}, TRAINEE);
      const res = await api('POST', '/api/records/trainingClasses/4001/submit-test', {
        answers: [{ questionId: 1, selectedOptionIds: [11] }, { questionId: 2, selectedOptionIds: [22] }]
      }, TRAINEE);
      assertEqual(res.status, 200, 'Nộp bài đúng giờ phải thành công như trước');
      assertEqual(res.body.submission.timeLimitSeconds, 120, 'Ngân sách = 60s/câu × 2 câu');
      assertEqual(res.body.submission.overTimeLimit, false, 'Nộp ngay thì không thể bị coi là quá giờ');
      assert(res.body.submission.elapsedSeconds !== null, 'Bản ghi nộp bài phải lưu số giây thực tế để còn rà soát');
    });

    await run.run('Fix 3 — nộp bài QUÁ giới hạn thời gian bị GẮN CỜ overTimeLimit (cố ý KHÔNG chặn nộp — vá một phần)', async () => {
      resetRecords();
      // Mốc bắt đầu cách đây 1 giờ, ngân sách chỉ 120s + 15s biên.
      RECORDS.trainingRegistrations[0].testStartedAt = new Date(Date.now() - 3600 * 1000).toISOString();
      const res = await api('POST', '/api/records/trainingClasses/4001/submit-test', {
        answers: [{ questionId: 1, selectedOptionIds: [11] }, { questionId: 2, selectedOptionIds: [22] }]
      }, TRAINEE);
      assertEqual(res.status, 200, 'CỐ Ý không chặn: học viên vẫn nộp được, chỉ bị gắn cờ (xem giải thích ở evaluateTrainingTestTiming)');
      assertEqual(res.body.submission.overTimeLimit, true, 'Bài nộp quá giờ PHẢI bị gắn cờ để người quản lý đào tạo rà lại');
      assert(res.body.submission.elapsedSeconds > 120, 'Số giây thực tế phải vượt ngân sách');
    });

    await run.run('Fix 3 — bản ghi ĐĂNG KÝ CŨ chưa có testStartedAt vẫn nộp bài được (không gắn cờ bừa)', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/trainingClasses/4001/submit-test', {
        answers: [{ questionId: 1, selectedOptionIds: [11] }, { questionId: 2, selectedOptionIds: [22] }]
      }, TRAINEE);
      assertEqual(res.status, 200, 'Dữ liệu cũ (trước bản vá) vẫn phải nộp bài được bình thường');
      assertEqual(res.body.submission.overTimeLimit, null, 'Không đủ dữ liệu thì KHÔNG kết luận quá giờ');
    });

    // ===================================================================================
    // Fix 4 — Tuyển Dụng: closeRecruitmentJob theo canManageRecruitment (cả đội), không chỉ người đăng
    // ===================================================================================
    await run.run('Fix 4 — người CÙNG ĐỘI tuyển dụng (không phải người đăng tin) đóng được tin', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/recruitmentJobs/6001/close', {}, HR_TEAMMATE);
      assertEqual(res.status, 200, 'internalRecruitmentCreate PHẢI đóng được tin của đồng nghiệp (khớp confirm-filled/set-referral-status)');
      assertEqual(res.body.item.status, 'CLOSED', 'Tin phải chuyển sang CLOSED');
    });

    await run.run('Fix 4 — người đăng tin và Admin vẫn đóng được như trước', async () => {
      resetRecords();
      const r1 = await api('POST', '/api/records/recruitmentJobs/6001/close', {}, HR_POSTER);
      assertEqual(r1.status, 200, 'Người đăng tin vẫn đóng được');
      const r2 = await api('POST', '/api/records/recruitmentJobs/6002/close', {}, ADMIN);
      assertEqual(r2.status, 200, 'Admin vẫn đóng được');
    });

    await run.run('Fix 4 — người KHÔNG thuộc đội tuyển dụng vẫn bị chặn 403', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/recruitmentJobs/6001/close', {}, OUTSIDER);
      assertEqual(res.status, 403, 'Không có internalRecruitmentCreate/admin thì không được đóng tin');
      assertEqual(RECORDS.recruitmentJobs.find(j => j.id === 6001).status, 'OPEN', 'Tin phải giữ nguyên OPEN');
    });

    await run.run('Fix 4 — đóng lại tin ĐÃ đóng vẫn báo 409 như trước', async () => {
      resetRecords();
      await api('POST', '/api/records/recruitmentJobs/6001/close', {}, HR_TEAMMATE);
      const res = await api('POST', '/api/records/recruitmentJobs/6001/close', {}, HR_TEAMMATE);
      assertEqual(res.status, 409, 'Tin đã đóng không đóng lại được (hành vi cũ giữ nguyên)');
    });

    // ===================================================================================
    // Fix 5 — Giấy Phép: revokeLicense đòi status === 'APPROVED' như setLicenseRenewing
    // ===================================================================================
    await run.run('Fix 5 — không thu hồi được giấy phép còn CHỜ DUYỆT', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/licenses/7001/revoke', { reason: 'Thử thu hồi bậy' }, LICENSE_APPROVER);
      assertEqual(res.status, 409, 'Giấy phép PENDING chưa từng có hiệu lực thì không có gì để thu hồi');
      assertEqual(RECORDS.licenses.find(l => l.id === 7001).lifecycleStatus, null, 'Không được đánh dấu REVOKED');
    });

    await run.run('Fix 5 — không thu hồi được giấy phép ĐÃ BỊ TỪ CHỐI', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/licenses/7002/revoke', { reason: 'Thử thu hồi bậy' }, LICENSE_APPROVER);
      assertEqual(res.status, 409, 'Giấy phép REJECTED cũng không thu hồi được');
      assertEqual(RECORDS.licenses.find(l => l.id === 7002).lifecycleStatus, null, 'Không được đánh dấu REVOKED');
    });

    await run.run('Fix 5 — vẫn thu hồi bình thường giấy phép ĐÃ DUYỆT', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/licenses/7003/revoke', { reason: 'Hết hiệu lực theo quyết định mới' }, LICENSE_APPROVER);
      assertEqual(res.status, 200, 'Giấy phép APPROVED PHẢI vẫn thu hồi được');
      assertEqual(res.body.item.lifecycleStatus, 'REVOKED', 'lifecycleStatus phải chuyển REVOKED');
      assertEqual(res.body.item.revokedBy, LICENSE_APPROVER.username, 'Ghi lại người thu hồi như cũ');
    });

    await run.run('Fix 5 — thông báo lỗi cùng khuôn với setLicenseRenewing (kiểm tra trực tiếp hàm)', () => {
      const pending = { id: 1, status: 'PENDING', lifecycleStatus: null, history: [] };
      const errRevoke = expectThrows(() => recordActions.revokeLicense(LICENSE_APPROVER, pending, { reason: 'x' }), 'revokeLicense phải ném lỗi');
      const errRenew = expectThrows(() => recordActions.setLicenseRenewing(LICENSE_APPROVER, pending, { renewing: true }), 'setLicenseRenewing phải ném lỗi');
      assertEqual(errRevoke.status, 409, 'revokeLicense: 409');
      assertEqual(errRenew.status, 409, 'setLicenseRenewing: 409 (mốc so sánh)');
      assertIncludes(errRevoke.message, 'đã được phê duyệt', 'Cùng khuôn diễn đạt với setLicenseRenewing');
    });

    // Lý do vẫn bắt buộc (không được vì thêm điều kiện status mà bỏ lọt kiểm tra cũ).
    await run.run('Fix 5 — vẫn bắt buộc nhập lý do khi thu hồi giấy phép đã duyệt', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/licenses/7003/revoke', { reason: '   ' }, LICENSE_APPROVER);
      assertEqual(res.status, 400, 'Thiếu lý do vẫn phải bị chặn như trước');
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-audit-round2-cluster5.js:', err);
  process.exitCode = 1;
});
