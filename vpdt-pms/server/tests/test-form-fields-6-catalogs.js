// server/tests/test-form-fields-6-catalogs.js
//
// Regression test cho đợt audit "form-fields-6" (rà soát toàn bộ trường nhiều lựa chọn không cho phép
// admin thêm/bớt) — 5 danh mục MỚI chuyển từ hằng số/<option> gõ cứng sang appData admin-editable:
// meetingRooms, carPurposes, submissionPriorities, hrFeedbackCategories, itRenewalCategories.
//
// Cùng khuôn test-audit-round2-cluster1.js: KHÔNG mở Playwright, chạy thẳng express router THẬT
// (routes/data.js, routes/create.js) trong tiến trình Node, chỉ giả lập tầng LƯU TRỮ + middleware xác
// thực (lib/appData, lib/recordStore, lib/auth) để không cần SQL Server thật.
//
// Kịch bản bảo vệ:
//   1. Cả 5 key MỚI đều nằm trong ADMIN_ONLY_KEYS (routes/data.js) — user thường bị 403, admin ghi được.
//   2. hrFeedback.extraValidate (lib/createValidation.js) đọc appData.hrFeedbackCategories: chấp nhận 1
//      category MỚI admin vừa thêm, từ chối (rơi về OTHER) 1 giá trị không có trong danh mục, và fallback
//      đúng về 4 giá trị gốc khi appData.hrFeedbackCategories rỗng/thiếu (dữ liệu cũ trước khi seed chạy).
//   3. itServiceRenewals: learnItRenewalCategory() (routes/create.js) CHỈ THÊM (không ghi đè) 1 giá trị
//      mới vào itRenewalCategories mỗi khi tạo dịch vụ với category chưa từng có trong danh mục, không
//      thêm trùng nếu category đã có sẵn — cùng khuôn learnLicenseType().
//
// Chạy: node server/tests/test-form-fields-6-catalogs.js
const http = require('http');
const path = require('path');

let PORT = 0;

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const PLAIN_KD = { username: 'plain_kd', name: 'Nhân Viên Kinh Doanh', dept: 'Kinh Doanh', perms: {}, active: true };
const IT_MANAGE_USER = { username: 'it1', name: 'Nhân Viên IT', dept: 'IT', perms: { itManage: true }, active: true };
const USERS = [ADMIN, PLAIN_KD, IT_MANAGE_USER];

// Giá trị gốc (khớp defaults.js) — dùng để khẳng định lượt ghi bị từ chối KHÔNG làm đổi dữ liệu.
const ORIGINAL_CATALOGS = {
  meetingRooms: [
    { id: 1, name: 'Phòng Họp Lớn A (Tầng 3 - Sức chứa 50 người)', short: 'Phòng A (50 người)' },
    { id: 2, name: 'Phòng Họp Nhỏ B (Tầng 2 - Sức chứa 15 người)', short: 'Phòng B (15 người)' }
  ],
  carPurposes: [
    { key: 'Công tác', label: 'Công tác (đính kèm QĐ, KH)' },
    { key: 'Khác', label: 'Khác (đính kèm KH)' }
  ],
  submissionPriorities: [
    { key: 'Bình thường', label: 'Bình thường' },
    { key: 'Gấp', label: '🔥 Gấp' }
  ],
  hrFeedbackCategories: [
    { key: 'OTHER', label: '❓ Khác' }, { key: 'BENEFITS', label: '🎁 Chế độ / Phúc lợi' },
    { key: 'POLICY', label: '📋 Chính sách / Quy định' }, { key: 'SALARY', label: '💰 Lương / Thưởng' }
  ],
  itRenewalCategories: ['Phần mềm/Bản quyền', 'Đường truyền Internet', 'Khác']
};
const NEWLY_ADMIN_ONLY_KEYS = Object.keys(ORIGINAL_CATALOGS);

// Giá trị "tấn công" hợp lệ về mặt định dạng cho từng key (để 403 chắc chắn do gate admin, không phải
// do payload sai định dạng bị chặn ở 1 bước kiểm tra khác).
const HIJACK_VALUES = {
  meetingRooms: [{ id: 99, name: 'Phòng Họp Của Kẻ Tấn Công', short: 'Phòng X' }],
  carPurposes: [{ key: 'HACK', label: 'Mục đích giả' }],
  submissionPriorities: [{ key: 'HACK', label: 'Độ khẩn giả' }],
  hrFeedbackCategories: [{ key: 'HACK', label: 'Chủ đề giả' }],
  itRenewalCategories: ['Loại dịch vụ giả']
};

const APP_DATA = { users: USERS, ...JSON.parse(JSON.stringify(ORIGINAL_CATALOGS)) };
function resetCatalogs() {
  Object.assign(APP_DATA, JSON.parse(JSON.stringify(ORIGINAL_CATALOGS)));
}

const RECORDS = { itServiceRenewals: [], hrFeedback: [] };
function resetRecords() {
  RECORDS.itServiceRenewals = [];
  RECORDS.hrFeedback = [];
}

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
  MIGRATED_COLLECTIONS: new Set(Object.keys(RECORDS)),
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

const express = require('express');
const { createRunner, assert, assertEqual, assertIncludes } = require('./testHarness');
const { validateAndPrepareCreate } = require('../lib/createValidation');
const dataRoutes = require('../routes/data');
const createRoutes = require('../routes/create');

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
  app.use('/api/create', createRoutes);
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

function expectThrows(fn, message) {
  try { fn(); } catch (err) { return err; }
  throw new Error(message || 'Đáng lẽ phải ném lỗi nhưng không ném');
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    // ===================================================================================
    // 1) 5 danh mục MỚI phải nằm trong ADMIN_ONLY_KEYS
    // ===================================================================================
    for (const key of NEWLY_ADMIN_ONLY_KEYS) {
      await run.run(`ADMIN_ONLY_KEYS — POST /api/data/${key}: user thường bị chặn 403, dữ liệu KHÔNG đổi`, async () => {
        resetCatalogs();
        const before = JSON.stringify(APP_DATA[key]);
        const denied = await api('POST', `/api/data/${key}`, HIJACK_VALUES[key], PLAIN_KD);
        assertEqual(denied.status, 403, `Tài khoản thường KHÔNG được ghi danh mục "${key}"`);
        assertIncludes(denied.body.error, 'Quản Trị Viên', 'Thông báo lỗi phải nêu rõ chỉ Quản Trị Viên mới sửa được');
        assertEqual(JSON.stringify(APP_DATA[key]), before, `Danh mục "${key}" KHÔNG được thay đổi sau lượt ghi bị từ chối`);
      });
    }

    await run.run('ADMIN_ONLY_KEYS — admin vẫn ghi được cả 5 danh mục MỚI (không chặn nhầm)', async () => {
      resetCatalogs();
      for (const key of NEWLY_ADMIN_ONLY_KEYS) {
        const ok = await api('POST', `/api/data/${key}`, HIJACK_VALUES[key], ADMIN);
        assertEqual(ok.status, 200, `Admin phải ghi được "${key}"`);
        assertEqual(JSON.stringify(APP_DATA[key]), JSON.stringify(HIJACK_VALUES[key]), `Lượt ghi của admin lên "${key}" phải có hiệu lực thật`);
      }
      resetCatalogs();
    });

    await run.run('ADMIN_ONLY_KEYS — itManage (không phải admin) KHÔNG mở khoá ghi itRenewalCategories qua POST /api/data', async () => {
      resetCatalogs();
      const denied = await api('POST', '/api/data/itRenewalCategories', HIJACK_VALUES.itRenewalCategories, IT_MANAGE_USER);
      assertEqual(denied.status, 403, 'itManage vẫn KHÔNG được ghi đè NGUYÊN danh mục itRenewalCategories (chỉ đường tự học CHỈ THÊM mới mở cho itManage)');
      resetCatalogs();
    });

    // ===================================================================================
    // 2) hrFeedback.extraValidate đọc appData.hrFeedbackCategories (thay Set cố định 4 giá trị)
    // ===================================================================================
    await run.run('hrFeedback — category MỚI admin vừa thêm vào danh mục được chấp nhận nguyên vẹn', () => {
      const appData = { hrFeedbackCategories: [...ORIGINAL_CATALOGS.hrFeedbackCategories, { key: 'IT_SUPPORT', label: '💻 Hỗ trợ IT nội bộ' }] };
      const record = validateAndPrepareCreate('hrFeedback', { question: 'Câu hỏi test', category: 'IT_SUPPORT' }, PLAIN_KD, [], appData);
      assertEqual(record.category, 'IT_SUPPORT', 'Category mới (admin vừa thêm) phải được giữ nguyên, không rơi về OTHER');
    });

    await run.run('hrFeedback — category KHÔNG có trong danh mục (kể cả admin vừa xoá) bị ép về OTHER', () => {
      const appData = { hrFeedbackCategories: ORIGINAL_CATALOGS.hrFeedbackCategories.filter(c => c.key !== 'SALARY') };
      const record = validateAndPrepareCreate('hrFeedback', { question: 'Câu hỏi test', category: 'SALARY' }, PLAIN_KD, [], appData);
      assertEqual(record.category, 'OTHER', 'Category đã bị admin xoá khỏi danh mục phải rơi về OTHER, không được giữ nguyên giá trị cũ');
    });

    await run.run('hrFeedback — appData.hrFeedbackCategories rỗng/thiếu (dữ liệu cũ trước khi seed chạy) fallback đúng về 4 giá trị gốc', () => {
      const recOk = validateAndPrepareCreate('hrFeedback', { question: 'Câu hỏi test', category: 'BENEFITS' }, PLAIN_KD, [], {});
      assertEqual(recOk.category, 'BENEFITS', 'Fallback phải chấp nhận đúng 4 giá trị gốc (BENEFITS) khi appData thiếu key');
      const recBad = validateAndPrepareCreate('hrFeedback', { question: 'Câu hỏi test', category: 'KHONG_HOP_LE' }, PLAIN_KD, [], { hrFeedbackCategories: [] });
      assertEqual(recBad.category, 'OTHER', 'Fallback vẫn phải từ chối giá trị không hợp lệ khi appData.hrFeedbackCategories rỗng ([])');
    });

    // ===================================================================================
    // 3) itServiceRenewals: learnItRenewalCategory() CHỈ THÊM, không ghi đè/xoá trắng
    // ===================================================================================
    await run.run('itRenewalCategories — tạo dịch vụ với category MỚI (chưa có trong danh mục) tự động được thêm vào cuối danh mục', async () => {
      resetCatalogs();
      resetRecords();
      const before = [...APP_DATA.itRenewalCategories];

      const res = await api('POST', '/api/create/itServiceRenewals', {
        name: 'Zoom Pro', category: 'Họp trực tuyến', expiryDate: '2027-01-01'
      }, IT_MANAGE_USER);

      assertEqual(res.status, 200, 'itManage phải tạo được dịch vụ mới với category tự do');
      assertIncludes(APP_DATA.itRenewalCategories, 'Họp trực tuyến', 'Category mới gõ phải được server tự thêm vào danh mục itRenewalCategories');
      before.forEach(c => assertIncludes(APP_DATA.itRenewalCategories, c, 'Đường tự học CHỈ ĐƯỢC THÊM — mọi giá trị cũ phải còn nguyên'));
      assertEqual(APP_DATA.itRenewalCategories.length, before.length + 1, 'Đúng 1 giá trị mới được thêm vào');
    });

    await run.run('itRenewalCategories — tạo dịch vụ với category ĐÃ CÓ SẴN không thêm trùng', async () => {
      resetCatalogs();
      resetRecords();
      const before = [...APP_DATA.itRenewalCategories];

      const res = await api('POST', '/api/create/itServiceRenewals', {
        name: 'Office 365', category: 'Phần mềm/Bản quyền', expiryDate: '2027-01-01'
      }, IT_MANAGE_USER);

      assertEqual(res.status, 200, 'itManage phải tạo được dịch vụ với category đã có sẵn');
      assertEqual(APP_DATA.itRenewalCategories.length, before.length, 'Không được thêm bản trùng vào danh mục');
      resetCatalogs();
    });

    await run.run('itRenewalCategories — người không có itManage/admin bị chặn tạo dịch vụ (403), danh mục không bị học nhầm', async () => {
      resetCatalogs();
      resetRecords();
      const before = [...APP_DATA.itRenewalCategories];
      const denied = await api('POST', '/api/create/itServiceRenewals', {
        name: 'Dịch vụ giả mạo', category: 'Loại giả mạo', expiryDate: '2027-01-01'
      }, PLAIN_KD);
      assertEqual(denied.status, 403, 'Người không có itManage/admin phải bị chặn tạo dịch vụ Gia Hạn CNTT');
      assertEqual(JSON.stringify(APP_DATA.itRenewalCategories), JSON.stringify(before), 'Danh mục KHÔNG được học thêm giá trị từ 1 lượt tạo bị từ chối');
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-form-fields-6-catalogs.js:', err);
  process.exitCode = 1;
});
