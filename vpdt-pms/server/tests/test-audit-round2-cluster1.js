// server/tests/test-audit-round2-cluster1.js
//
// Regression test cho ĐỢT 2 (cụm 1) các lỗ hổng đã xác minh bằng đọc code trực tiếp. Mỗi kịch bản gắn
// với ĐÚNG 1 bản vá — hoàn tác bản vá thì test FAIL ngay:
//
//   1. ADMIN_ONLY_KEYS (routes/data.js) THIẾU 5 danh mục của tab "🗂️ Quản Lý Danh Mục" (chỉ admin
//      thấy): depts, cats, licenseTypes, trainingCategories, contractTypeAbbrs. Bất kỳ tài khoản đã
//      đăng nhập nào cũng ghi đè/XOÁ TRẮNG được qua POST /api/data/<key> — xoá trắng "depts" là làm
//      hỏng mọi dropdown/kiểm tra phạm vi phòng ban + sinh mã của TOÀN BỘ app.
//   2. Stored XSS qua scheme "javascript:" ở trainingDocuments.videoUrl (lib/createValidation.js):
//      kiểm tra cũ /youtube\.com|youtu\.be/i chỉ dò CHUỖI CON nên
//      "javascript:alert(document.cookie)//youtube.com" LỌT, rồi phía hiển thị rơi về nhánh dự phòng
//      `<a href="${escapeHtml(d.videoUrl)}">` (escapeHtml KHÔNG vô hiệu hoá scheme này).
//   3. isMeetingMinutesAttendeeServer() (lib/recordViewScope.js) khớp THUẦN theo tên hiển thị —
//      2 nhân viên TRÙNG TÊN đều xem được biên bản chỉ mời 1 người.
//
// Cùng khuôn test-audit-fixes-batch1.js: KHÔNG mở Playwright, chạy thẳng express router THẬT
// (routes/data.js) trong tiến trình Node và chỉ giả lập tầng LƯU TRỮ + middleware xác thực.
//
// Chạy: node server/tests/test-audit-round2-cluster1.js
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
const PLAIN_KD = { username: 'plain_kd', name: 'Nhân Viên Kinh Doanh', dept: 'Kinh Doanh', perms: {}, active: true };
// Người có quyền tải giấy phép (licenseCreate) — KHÔNG phải admin: đúng vai người trước đây ghi được
// "licenseTypes" qua nhánh "tự học" của uploadLicense().
const LICENSE_USER = { username: 'gp1', name: 'Nhân Viên Pháp Chế', dept: 'Hành Chính', perms: { licenseCreate: true }, active: true };
// Người có quyền quản lý đào tạo — cần để đi qua gate của trainingDocuments.extraValidate.
const TRAINER = { username: 'dt1', name: 'Cán Bộ Đào Tạo', dept: 'Hành Chính', perms: { trainingManage: true }, active: true };

// HAI người TRÙNG TÊN HIỂN THỊ — chính là kịch bản của lỗ hổng số 3.
const NVA_MOI = { username: 'nva_kd', name: 'Nguyễn Văn A', dept: 'Kinh Doanh', perms: {}, active: true };
const NVA_TRUNG_TEN = { username: 'nva_it', name: 'Nguyễn Văn A', dept: 'IT', perms: {}, active: true };
// Khách mời bên ngoài KHÔNG có tài khoản trong dòng tham dự, nhưng có tài khoản hệ thống trùng tên —
// đúng khuôn "dòng chỉ có tên" phải TIẾP TỤC khớp theo tên như trước khi vá.
const KHACH_NGOAI = { username: 'doitac1', name: 'Trần Đối Tác', dept: 'Kinh Doanh', perms: {}, active: true };

const USERS = [ADMIN, PLAIN_KD, LICENSE_USER, TRAINER, NVA_MOI, NVA_TRUNG_TEN, KHACH_NGOAI];

// 5 danh mục ĐANG bị bỏ sót + giá trị gốc để khẳng định lượt ghi bị từ chối KHÔNG làm đổi dữ liệu.
const ORIGINAL_CATALOGS = {
  depts: ['Kinh Doanh', 'IT', 'Hành Chính', 'Ban Giám Đốc'],
  cats: ['Công văn', 'Quyết định', 'Quy chế'],
  licenseTypes: ['Giấy phép kinh doanh', 'Giấy phép PCCC'],
  trainingCategories: ['An toàn lao động', 'Nghiệp vụ bán hàng'],
  contractTypeAbbrs: { 'Hợp đồng nguyên tắc': 'HDNT', 'Hợp đồng dịch vụ': 'HDDV' }
};
const NEWLY_ADMIN_ONLY_KEYS = Object.keys(ORIGINAL_CATALOGS);

const APP_DATA = {
  users: USERS,
  ...JSON.parse(JSON.stringify(ORIGINAL_CATALOGS))
};

function resetCatalogs() {
  Object.assign(APP_DATA, JSON.parse(JSON.stringify(ORIGINAL_CATALOGS)));
}

// Bảng dbo.Records giả lập — meetingMinutes (kịch bản 3) + licenses (đường "tự học" loại giấy phép
// đã chuyển về server, xem learnLicenseType() ở routes/create.js).
const RECORDS = { meetingMinutes: [], licenses: [] };

function resetRecords() {
  RECORDS.meetingMinutes = [
    {
      // Biên bản CHỈ MỜI nva_kd (dòng đã chỉ đích danh tài khoản). nva_it trùng tên hiển thị.
      id: 4001, code: 'BB-2026-001', title: 'Họp kế hoạch Kinh Doanh quý 4',
      creator: ADMIN.username, creatorName: ADMIN.name,
      attendees: [
        { id: 'a1', hasAccount: 'YES', username: NVA_MOI.username, name: 'Nguyễn Văn A', title: 'Nhân viên', dept: 'Kinh Doanh', email: '' }
      ],
      directives: []
    },
    {
      // Biên bản có khách mời NGOÀI công ty — dòng chỉ có tên, không tài khoản.
      id: 4002, code: 'BB-2026-002', title: 'Họp với đối tác',
      creator: ADMIN.username, creatorName: ADMIN.name,
      attendees: [
        { id: 'b1', hasAccount: 'NO', username: null, name: '  trần đối tác ', title: 'Giám đốc NCC', dept: '', email: '' }
      ],
      directives: []
    }
  ];
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

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(RECORDS)),
  getAllForCollectionCached: async (c) => RECORDS[c] || [],
  getAllForCollection: async (c) => RECORDS[c] || [],
  // routes/create.js đọc trash trước khi tạo (kiểm trùng mã với hồ sơ đã xoá, xem
  // lib/createValidation.js) — bài test này không có kịch bản nào liên quan Thùng Rác, luôn trả rỗng.
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

// ===================== 1) Require code THẬT (sau khi đã cắm bản giả lập) =====================
const express = require('express');
const { createRunner, assert, assertEqual, assertIncludes } = require('./testHarness');
const recordViewScope = require('../lib/recordViewScope');
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

// Payload tài liệu đào tạo dạng VIDEO — chỉ đổi videoUrl giữa các kịch bản.
function videoDocPayload(videoUrl) {
  return { category: 'An toàn lao động', title: 'Video hướng dẫn', docType: 'VIDEO', videoUrl };
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    // ===================================================================================
    // Fix 1 — 5 danh mục của tab "Quản Lý Danh Mục" phải nằm trong ADMIN_ONLY_KEYS
    // ===================================================================================
    // Giá trị "tấn công" cho từng key: đúng dạng dữ liệu thật để KHÔNG bị chặn nhầm bởi 1 bước kiểm
    // tra kiểu dữ liệu nào khác — nếu route trả 403 thì chắc chắn là do gate admin, không phải do
    // payload sai định dạng.
    const HIJACK_VALUES = {
      depts: ['Phòng Ban Của Kẻ Tấn Công'],
      cats: ['Loại Tài Liệu Giả'],
      licenseTypes: ['Giấy phép giả'],
      trainingCategories: ['Khoá học giả'],
      contractTypeAbbrs: { 'Hợp đồng nguyên tắc': 'XXX' }
    };

    for (const key of NEWLY_ADMIN_ONLY_KEYS) {
      await run.run(`Fix 1 — POST /api/data/${key}: user thường bị chặn 403, dữ liệu KHÔNG đổi`, async () => {
        resetCatalogs();
        const before = JSON.stringify(APP_DATA[key]);

        const denied = await api('POST', `/api/data/${key}`, HIJACK_VALUES[key], PLAIN_KD);
        assertEqual(denied.status, 403, `Tài khoản thường KHÔNG được ghi danh mục "${key}" (màn Quản Lý Danh Mục chỉ admin thấy)`);
        assertIncludes(denied.body.error, 'Quản Trị Viên', 'Thông báo lỗi phải nêu rõ chỉ Quản Trị Viên mới sửa được');
        assertEqual(JSON.stringify(APP_DATA[key]), before, `Danh mục "${key}" KHÔNG được thay đổi sau lượt ghi bị từ chối`);
      });
    }

    await run.run('Fix 1 — XOÁ TRẮNG danh mục (POST mảng rỗng) cũng bị chặn: đây là kịch bản phá hoại nặng nhất với "depts"', async () => {
      resetCatalogs();
      const wipe = await api('POST', '/api/data/depts', [], PLAIN_KD);
      assertEqual(wipe.status, 403, 'Xoá trắng danh sách phòng ban phải bị chặn — depts chi phối dropdown/phạm vi/sinh mã của TOÀN BỘ app');
      assertEqual(APP_DATA.depts.length, ORIGINAL_CATALOGS.depts.length, 'Danh sách phòng ban phải còn nguyên vẹn');
    });

    await run.run('Fix 1 — quyền nghiệp vụ liên quan (licenseCreate/trainingManage) KHÔNG mở khoá ghi danh mục: đây là màn Quản Trị', async () => {
      resetCatalogs();
      const a = await api('POST', '/api/data/licenseTypes', HIJACK_VALUES.licenseTypes, LICENSE_USER);
      assertEqual(a.status, 403, 'Người có licenseCreate vẫn KHÔNG được ghi đè danh mục Loại Giấy Phép');
      const b = await api('POST', '/api/data/trainingCategories', HIJACK_VALUES.trainingCategories, TRAINER);
      assertEqual(b.status, 403, 'Người có trainingManage vẫn KHÔNG được ghi đè danh mục Loại Đào Tạo');
    });

    await run.run('Fix 1 — admin vẫn ghi được cả 5 danh mục như trước (không chặn nhầm)', async () => {
      resetCatalogs();
      for (const key of NEWLY_ADMIN_ONLY_KEYS) {
        const ok = await api('POST', `/api/data/${key}`, HIJACK_VALUES[key], ADMIN);
        assertEqual(ok.status, 200, `Admin phải ghi được "${key}" như trước bản vá`);
        assertEqual(JSON.stringify(APP_DATA[key]), JSON.stringify(HIJACK_VALUES[key]), `Lượt ghi của admin lên "${key}" phải có hiệu lực thật`);
      }
      resetCatalogs();
    });

    // Tính năng "tự học loại giấy phép" KHÔNG được mất khi khoá licenseTypes lại — nó chỉ chuyển từ
    // đường ghi đè NGUYÊN mảng (POST /api/data/licenseTypes, giờ chỉ admin) sang đường CHỈ THÊM ở
    // server trong luồng tạo giấy phép (learnLicenseType(), routes/create.js).
    await run.run('Fix 1 — người có licenseCreate vẫn "tự học" được loại giấy phép mới qua POST /api/create/licenses (chỉ THÊM, không ghi đè)', async () => {
      resetCatalogs();
      RECORDS.licenses = [];
      const before = [...APP_DATA.licenseTypes];

      const res = await api('POST', '/api/create/licenses', {
        companyName: 'Công ty TNHH HCRC', locationName: 'Chi nhánh Hội An', operatingStatus: 'ACTIVE',
        licenseType: 'Giấy phép an toàn thực phẩm', licenseNumber: 'ATTP-001/2026',
        issueDate: '2026-01-01', expiryDate: '2027-01-01', issuingAuthority: 'Sở Y Tế',
        fileUrl: '/uploads/1234567890-abcdef0123456789.pdf', fileName: 'gp.pdf', fileType: 'application/pdf',
        rootLicenseId: null, versionNumber: 1, code: 'HCRC-GP-2026-001'
      }, LICENSE_USER);

      assertEqual(res.status, 200, 'Người có licenseCreate vẫn phải tạo được giấy phép như trước');
      assertIncludes(APP_DATA.licenseTypes, 'Giấy phép an toàn thực phẩm',
        'Loại giấy phép mới gõ phải được server tự thêm vào danh mục (tính năng cũ không được mất khi khoá key lại)');
      before.forEach(t => assertIncludes(APP_DATA.licenseTypes, t,
        'Đường tự học CHỈ ĐƯỢC THÊM — mọi giá trị đang có trong danh mục phải còn nguyên (không ghi đè/xoá trắng)'));
      assertEqual(APP_DATA.licenseTypes.length, before.length + 1, 'Đúng 1 giá trị mới được thêm vào');

      // Nhưng đường GHI ĐÈ NGUYÊN MẢNG thì vẫn đóng với chính người này — đó mới là lỗ hổng đã vá.
      const denied = await api('POST', '/api/data/licenseTypes', ['CHỈ CÒN 1 LOẠI'], LICENSE_USER);
      assertEqual(denied.status, 403, 'Ghi đè NGUYÊN danh mục vẫn phải bị chặn với người không phải admin');
      assert(APP_DATA.licenseTypes.length > 1, 'Danh mục không được bị thu về 1 phần tử');
      resetCatalogs();
    });

    await run.run('Fix 1 — tự học loại giấy phép KHÔNG thêm trùng khi loại đó đã có sẵn trong danh mục', async () => {
      resetCatalogs();
      RECORDS.licenses = [];
      const before = [...APP_DATA.licenseTypes];

      const res = await api('POST', '/api/create/licenses', {
        companyName: 'Công ty TNHH HCRC', locationName: 'Trụ sở', operatingStatus: 'ACTIVE',
        licenseType: 'Giấy phép PCCC', licenseNumber: 'PCCC-002/2026',
        issueDate: '2026-01-01', expiryDate: '2027-01-01', issuingAuthority: 'Công An PCCC',
        fileUrl: '/uploads/1234567890-abcdef0123456789.pdf', fileName: 'gp.pdf', fileType: 'application/pdf',
        rootLicenseId: null, versionNumber: 1, code: 'HCRC-GP-2026-002'
      }, LICENSE_USER);

      assertEqual(res.status, 200, 'Tạo giấy phép với loại đã có sẵn vẫn phải thành công');
      assertEqual(APP_DATA.licenseTypes.length, before.length, 'Không được thêm bản trùng vào danh mục');
      resetCatalogs();
    });

    // ===================================================================================
    // Fix 2 — trainingDocuments.videoUrl: chặn scheme "javascript:" (stored XSS)
    // ===================================================================================
    await run.run('Fix 2a — videoUrl "javascript:alert(document.cookie)//youtube.com" bị từ chối 400 (trước đây LỌT vì chỉ dò chuỗi con)', () => {
      const err = expectThrows(
        () => createRecord('trainingDocuments', videoDocPayload('javascript:alert(document.cookie)//youtube.com'), TRAINER),
        'Payload XSS scheme "javascript:" đáng lẽ phải bị từ chối'
      );
      assertEqual(err.status, 400, 'Phải là lỗi 400 (dữ liệu không hợp lệ)');
      assertIncludes(err.message, 'Youtube', 'Thông báo lỗi phải nói rõ chỉ nhận link Youtube hợp lệ');
    });

    await run.run('Fix 2b — các biến thể scheme nguy hiểm/tên miền giả mạo khác đều bị từ chối', () => {
      const ATTACKS = [
        // Cùng lỗ hổng chuỗi con, đổi cách nguỵ trang.
        'javascript:alert(1)//youtu.be',
        'JavaScript:alert(1)/*youtube.com*/',
        'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==#youtube.com',
        'vbscript:msgbox("youtube.com")',
        // Tên miền giả mạo: CHỨA "youtube.com" nhưng KHÔNG PHẢI Youtube.
        'https://youtube.com.evil.tld/watch?v=abc',
        'https://evil.tld/?ref=https://youtube.com/watch?v=abc',
        'https://notyoutube.com/watch?v=abc',
        'https://youtu.be.evil.tld/abc',
        // Không phải URL phân giải được.
        'youtube.com/watch?v=abc',
        '   ',
        'javascript:void(0)'
      ];
      ATTACKS.forEach(bad => {
        expectThrows(
          () => createRecord('trainingDocuments', videoDocPayload(bad), TRAINER),
          `videoUrl "${bad}" đáng lẽ phải bị từ chối`
        );
      });
    });

    await run.run('Fix 2c — link Youtube THẬT vẫn tạo được bình thường (không chặn nhầm tính năng)', () => {
      const OK_URLS = [
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtube.com/watch?v=dQw4w9WgXcQ',
        'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
        'https://youtu.be/dQw4w9WgXcQ',
        'https://www.youtube.com/embed/dQw4w9WgXcQ?start=30',
        'https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ'
      ];
      OK_URLS.forEach(good => {
        const record = createRecord('trainingDocuments', videoDocPayload(good), TRAINER);
        assertEqual(record.videoUrl, good.trim(), `Link Youtube hợp lệ "${good}" phải được giữ nguyên`);
        assertEqual(record.docType, 'VIDEO', 'docType vẫn phải là VIDEO');
        assertEqual(record.fileUrl, null, 'Tài liệu dạng VIDEO không kèm tệp tải lên (hành vi cũ không được vỡ)');
        assertEqual(record.uploaderUsername, TRAINER.username, 'Người tải lên vẫn lấy từ phiên đăng nhập');
      });
    });

    await run.run('Fix 2d — http:// (không mã hoá) cũng bị từ chối: chỉ chấp nhận đúng https://', () => {
      expectThrows(
        () => createRecord('trainingDocuments', videoDocPayload('http://www.youtube.com/watch?v=dQw4w9WgXcQ'), TRAINER),
        'Link http:// đáng lẽ phải bị từ chối (chỉ nhận https://)'
      );
    });

    await run.run('Fix 2e — tài liệu dạng DOCUMENT/IMAGE không bị ảnh hưởng bởi bản vá', () => {
      const doc = createRecord('trainingDocuments', {
        category: 'An toàn lao động', title: 'Tài liệu PDF', docType: 'DOCUMENT', fileUrl: '/uploads/1234567890-abcdef0123456789.pdf'
      }, TRAINER);
      assertEqual(doc.docType, 'DOCUMENT', 'docType DOCUMENT giữ nguyên');
      assertEqual(doc.videoUrl, '', 'videoUrl bị dọn rỗng cho tài liệu không phải VIDEO (hành vi cũ)');
    });

    // ===================================================================================
    // Fix 3 — Biên bản họp: tham dự viên CÓ TÀI KHOẢN khớp theo username, không theo tên
    // ===================================================================================
    await run.run('Fix 3a — 2 người TRÙNG TÊN HIỂN THỊ: chỉ đúng người được mời (khớp username) xem được biên bản', () => {
      resetRecords();
      const minutes = RECORDS.meetingMinutes[0];

      assertEqual(recordViewScope.canViewMeetingMinutes(NVA_MOI, minutes), true,
        'Người ĐƯỢC MỜI (username khớp dòng tham dự) vẫn phải xem được biên bản');
      assertEqual(recordViewScope.canViewMeetingMinutes(NVA_TRUNG_TEN, minutes), false,
        'Người TRÙNG TÊN nhưng KHÁC tài khoản KHÔNG được xem — đây chính là dữ liệu bị rò rỉ trước khi vá');
    });

    await run.run('Fix 3b — dòng tham dự chỉ có TÊN (khách mời ngoài, không tài khoản) vẫn khớp theo tên như cũ', () => {
      resetRecords();
      const minutes = RECORDS.meetingMinutes[1];
      assertEqual(recordViewScope.canViewMeetingMinutes(KHACH_NGOAI, minutes), true,
        'Dòng không có tài khoản phải TIẾP TỤC khớp theo tên (đã trim, không phân biệt hoa/thường) — biên bản cũ/nhập tay không được mất quyền xem');
      assertEqual(recordViewScope.canViewMeetingMinutes(PLAIN_KD, minutes), false,
        'Người không liên quan vẫn không xem được');
    });

    await run.run('Fix 3c — dòng hasAccount:"YES" nhưng THIẾU username thì rơi về khớp theo tên (dữ liệu cũ không vỡ)', () => {
      const legacyMinutes = {
        id: 4003, code: 'BB-2026-003', title: 'Biên bản cũ', creator: ADMIN.username,
        attendees: [{ id: 'c1', hasAccount: 'YES', username: null, name: 'Nhân Viên Kinh Doanh' }]
      };
      assertEqual(recordViewScope.canViewMeetingMinutes(PLAIN_KD, legacyMinutes), true,
        'hasAccount:"YES" nhưng chưa gán username (dữ liệu cũ) vẫn phải khớp theo tên như trước');
    });

    await run.run('Fix 3d — người tạo/admin/minutesView vẫn xem được mọi biên bản (không chặn nhầm)', () => {
      resetRecords();
      const minutes = RECORDS.meetingMinutes[0];
      assertEqual(recordViewScope.canViewMeetingMinutes(ADMIN, minutes), true, 'Admin luôn xem được');
      const viewer = { username: 'thuky', name: 'Thư Ký', dept: 'Hành Chính', perms: { minutesView: true } };
      assertEqual(recordViewScope.canViewMeetingMinutes(viewer, minutes), true, 'Quyền minutesView xem được toàn bộ');
      const creator = { username: ADMIN.username, name: 'Tên Đã Đổi', perms: {} };
      assertEqual(recordViewScope.canViewMeetingMinutes(creator, minutes), true, 'Người tạo vẫn xem được kể cả khi đổi tên hiển thị');
    });

    await run.run('Fix 3e — GET /api/data (bộ lọc THẬT): người trùng tên không còn nhận được biên bản của người khác', async () => {
      resetRecords();

      const asInvited = await api('GET', '/api/data', undefined, NVA_MOI);
      assertEqual(asInvited.status, 200, 'GET /api/data phải trả 200');
      assert(asInvited.body.meetingMinutes.some(m => m.id === 4001),
        'Người được mời phải nhận được đúng biên bản 4001');

      const asLookalike = await api('GET', '/api/data', undefined, NVA_TRUNG_TEN);
      assertEqual(asLookalike.body.meetingMinutes.length, 0,
        'Người trùng tên phải nhận mảng RỖNG — trước đây nhận nguyên biên bản họp của đồng nghiệp cùng tên');

      const asGuest = await api('GET', '/api/data', undefined, KHACH_NGOAI);
      assert(asGuest.body.meetingMinutes.some(m => m.id === 4002),
        'Khách mời khớp theo tên (dòng không tài khoản) vẫn phải nhận được biên bản 4002');
      assert(!asGuest.body.meetingMinutes.some(m => m.id === 4001),
        'Khách mời KHÔNG được nhận biên bản không liên quan');
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-audit-round2-cluster1.js:', err);
  process.exitCode = 1;
});
