// tests/test-audit-round2-cluster6.js — Kiểm thử hồi quy cho 9 lỗ hổng "cụm 6" (hạ tầng tải tệp,
// email, xác thực/phân quyền) phát hiện ở vòng rà soát bảo mật thứ 2.
//
// Test THUẦN NODE (không Playwright): toàn bộ phần sửa nằm ở server. Không có SQL Server khi chạy test
// nên lib/appData + ../db (và ở vài kịch bản là lib/recordStore) được thay bằng bản giả cắm thẳng vào
// require.cache TRƯỚC khi require module cần kiểm — nhờ vậy code nghiệp vụ thật (lib/fileAuthz.js,
// lib/recordViewScope.js, lib/recordStore.js, lib/adminExport.js, routes/records.js, routes/email.js,
// lib/approvalAuth.js) vẫn chạy nguyên bản, không phải bản chép lại gần giống.
//
// 9 mục được kiểm ở đây (theo đúng thứ tự ưu tiên của cụm):
//   1. (High) Trường tuỳ chỉnh kiểu Tải tệp/Tải nhiều tệp (record.customData) trước đây KHÔNG được
//      findOwningRecord() soi tới -> mọi file đính kèm qua đường này rơi vào FAIL-OPEN.
//   2. (High) Hồ sơ đã xoá vào Thùng Rác: file của nó tra không ra bản ghi sống -> FAIL-OPEN, tức là
//      XOÁ XONG THÌ FILE LỘ RỘNG HƠN; và "xoá vĩnh viễn" không hề gỡ file khỏi đĩa.
//   3. (High) Duyệt đề nghị thanh toán không đi qua khung xác thực lại approverAuthLevel.
//   4. (Medium) Import người dùng .xlsx bỏ qua lớp chống zip bomb dùng chung.
//   5. (Medium) POST /api/send-email cho gửi thư tới ĐỊA CHỈ BẤT KỲ bằng danh tính SMTP công ty.
//   6. (Medium) OTP phê duyệt sinh bằng Math.random() thay vì CSPRNG.
//   7. (Low) 2 route đăng ký WebAuthn không có rate limiter riêng.
//   8. (Low) Gỡ thiết bị WebAuthn không tăng sessionVersion.
//   9. (Low) sendMail() không đặt timeout kết nối/socket SMTP.
//
// Chạy: node server/tests/test-audit-round2-cluster6.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

// ===================== Runner nhỏ (cùng khuôn tests/test-uploads-file-authz.js) =====================
let passed = 0, failed = 0;
async function run(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`);
  }
}

function stubModule(relPath, exportsObj) {
  const resolved = require.resolve(relPath);
  require.cache[resolved] = {
    id: resolved, filename: resolved, loaded: true, children: [], paths: [], exports: exportsObj
  };
  return resolved;
}

// ===================== Dữ liệu dùng chung =====================
const DEPT_A = 'Kinh Doanh';   // phòng ban sở hữu hồ sơ
const DEPT_B = 'Marketing';    // phòng ban NGOÀI phạm vi

const ADMIN = { username: 'admin', dept: 'Ban Giám Đốc', perms: { admin: true } };
// Kẻ tấn công trong cả 2 lỗ hổng High đầu tiên: đã đăng nhập hợp lệ nhưng không được cấp quyền gì với
// các hồ sơ dưới đây, chỉ cần biết/đoán được URL /uploads/<tên-file>.
const OUTSIDER = { username: 'outsider', dept: DEPT_B, perms: {} };

// Hình dạng THẬT của giá trị 1 trường tuỳ chỉnh kiểu file: collectDynamicFieldsData() (public/index.html)
// cất NGUYÊN object mà POST /api/upload trả về, khoá theo NHÃN hiển thị của trường; kiểu multifile là
// MẢNG các object đó.
function uploaded(name) {
  return { fileUrl: `/uploads/${name}`, fileName: name, fileType: 'application/pdf', size: 1234 };
}

// ===== Hồ sơ có file đính kèm nằm TRONG customData (không phải field cố định nào) =====
const DOC = {
  id: 1, dept: DEPT_A, uploader: 'owner_doc', status: 'APPROVED',
  fileUrl: '/uploads/doc-primary.pdf',
  customData: {
    'Tài liệu đính kèm': uploaded('dyn-doc-single.pdf'),
    'Phụ lục (nhiều tệp)': [uploaded('dyn-doc-multi-1.pdf'), uploaded('dyn-doc-multi-2.pdf')],
    'Ghi chú': 'chuỗi thường, không phải file'
  }
};
const SUBMISSION = {
  id: 2, dept: DEPT_A, creator: 'owner_sub', status: 'PENDING',
  fileUrl: '/uploads/sub-primary.pdf', extraFiles: [],
  // Tờ trình tạo qua routes/create.js luôn snapshot sẵn effectiveApprovers (lib/createValidation.js) —
  // để rỗng nghĩa là không ai là người duyệt, đúng ý test: chỉ xét nhánh phạm vi/chính chủ.
  effectiveApprovers: {},
  customData: { 'Hồ sơ kèm': [uploaded('dyn-sub-multi-1.pdf')] }
};
const CONTRACT = {
  id: 3, dept: DEPT_A, custodianDept: DEPT_A, creator: 'owner_ct',
  fileUrl: '/uploads/ct-primary.pdf',
  customData: { 'Bản scan': uploaded('dyn-ct-single.pdf') },
  // Hợp đồng có customData THỨ HAI cho bước nộp Tài liệu ký (xem uploadContractSignedFile()).
  signedCustomData: { 'Biên bản bàn giao': [uploaded('dyn-ct-signed-multi.pdf')] }
};
const CAR_REG = {
  id: 4, dept: DEPT_A, creator: 'owner_car',
  customData: { 'Giấy tờ xe': uploaded('dyn-car-single.pdf') }
};
const OFFICE_REQ = {
  id: 5, dept: DEPT_A, creator: 'owner_office', subType: 'MUA_BAN',
  customData: { 'Báo giá': [uploaded('dyn-office-multi-1.pdf'), uploaded('dyn-office-multi-2.pdf')] }
};
const POST_PENDING = {
  id: 6, author: 'author_post', status: 'PENDING',
  attachment: { fileUrl: '/uploads/post-primary.pdf' },
  customData: { 'Ảnh minh hoạ': uploaded('dyn-post-single.pdf') }
};

let COLLECTIONS = {};
let TRASH_ITEMS = [];

function resetCollections() {
  COLLECTIONS = {
    docs: [DOC], submissions: [SUBMISSION], contracts: [CONTRACT],
    carRegs: [CAR_REG], officeReqs: [OFFICE_REQ], internalPosts: [POST_PENDING]
  };
  TRASH_ITEMS = [];
}
resetCollections();

// ===================== Bản giả cho lib/appData + lib/recordStore + ../db =====================
// Phải cắm TRƯỚC mọi require code thật bên dưới.
const APP_DATA = { deptWorkflows: {}, submissionDeptWorkflows: {}, carDeptWorkflows: {}, officeDeptWorkflows: {} };
stubModule('../lib/appData', {
  getAllAppData: async () => APP_DATA,
  // Trả về đúng KIỂU dữ liệu mà từng khoá cấu hình vốn có (mảng cho danh mục, object cho bản đồ quy
  // trình) — code thật ở lib/recordViewScope.js gọi .find()/[dept] trên các giá trị này.
  getAppDataValue: async (key) => (key === 'submissionTypes' ? [] : {}),
  getAppDataValueCached: async () => ({}),
  withLockedAppDataValue: async (_k, fn) => fn([]),
  invalidateAppDataCache: () => {}
});

// Kho bản ghi giả: dùng cho lib/fileAuthz.js (kịch bản 1-2a) VÀ routes/records.js (kịch bản 3).
const PAYMENT_REQUESTS = new Map();
const recordStoreStub = {
  getAllForCollection: async (name) => COLLECTIONS[name] || [],
  getAllForCollectionCached: async (name) => COLLECTIONS[name] || [],
  getTrashItems: async () => TRASH_ITEMS,
  // lib/fileAuthz.js đọc Thùng Rác qua bản CÓ CACHE (getAllTrashItemsCached) — bản giả trả thẳng dữ
  // liệu hiện tại để mỗi kịch bản đổi TRASH_ITEMS là thấy hiệu lực ngay, không vướng TTL.
  getAllTrashItemsCached: async () => TRASH_ITEMS,
  // Khoá-đọc-sửa-ghi 1 bản ghi: chỉ ghi lại khi mutator KHÔNG ném lỗi, đúng như bản thật.
  withLockedRecordForCollection: async (collection, id, mutator) => {
    const store = collection === 'paymentRequests' ? PAYMENT_REQUESTS : null;
    if (!store) throw new Error(`Bản giả chưa hỗ trợ collection: ${collection}`);
    const item = store.get(Number(id));
    if (!item) { const e = new Error('Không tìm thấy hồ sơ'); e.status = 404; throw e; }
    const copy = JSON.parse(JSON.stringify(item));
    const updated = await mutator(copy);
    store.set(Number(id), updated);
    return updated;
  },
  createForCollection: async () => { throw new Error('không dùng trong bộ test này'); },
  createForCollectionSerialized: async () => { throw new Error('không dùng trong bộ test này'); },
  insertRecord: async () => { throw new Error('không dùng trong bộ test này'); },
  withLockedRecordById: async () => { throw new Error('không dùng trong bộ test này'); },
  deleteRecordForCollection: async () => { throw new Error('không dùng trong bộ test này'); },
  withAppLock: async (_k, fn) => fn(),
  MIGRATED_COLLECTIONS: new Set(['paymentRequests'])
};
const RECORD_STORE_PATH = stubModule('../lib/recordStore', recordStoreStub);

// ../db: getPool() trả về 1 "pool" giả, mọi câu lệnh SQL đi qua DB_HANDLER (đổi được theo từng kịch bản).
let DB_HANDLER = async () => ({ recordset: [] });
stubModule('../db', {
  sql: {
    // Chỉ cần các "kiểu" mà code gọi tới — giá trị thật không quan trọng với bản giả.
    NVarChar: (n) => ({ type: 'nvarchar', n }), BigInt: { type: 'bigint' }, Int: { type: 'int' },
    MAX: 'max', Transaction: class {}, Request: class {}
  },
  getPool: async () => ({
    request() {
      const inputs = {};
      const req = {
        input(name, _type, value) { inputs[name] = value; return req; },
        query: (q) => DB_HANDLER(q, inputs)
      };
      return req;
    }
  })
});

// ===================== Code THẬT cần kiểm =====================
const { authorizeFileAccess, findOwningRecord, findOwningTrashItem } = require('../lib/fileAuthz');
const approvalAuth = require('../lib/approvalAuth');
const { parseUsersImportXlsx } = require('../lib/adminExport');

// ===================== Tiện ích HTTP nhỏ =====================
async function withServer(app, fn) {
  const server = await new Promise(res => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(res => server.close(res));
  }
}

async function buildXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  rows.forEach(r => sheet.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// =================================================================================================
async function main() {
  // ###############################################################################################
  // # 1. (High) File của TRƯỜNG TUỲ CHỈNH (customData) phải được kiểm quyền như file đính kèm chính
  // ###############################################################################################
  //
  // Trước bản vá: findOwningRecord() chỉ soi fileUrl/signedFileUrl/extraFiles/attachment ở cấp cao
  // nhất, nên MỌI file tải lên qua trường tuỳ chỉnh kiểu Tải tệp/Tải nhiều tệp tra không ra hồ sơ sở
  // hữu -> authorizeFileAccess() trả true theo nhánh FAIL-OPEN -> BẤT KỲ ai đã đăng nhập cũng đọc được,
  // dù hồ sơ chứa nó bị giới hạn theo phòng ban.

  await run('[1] Tài Liệu: file của trường tuỳ chỉnh kiểu "Tải nhiều tệp" bị CHẶN với người ngoài phạm vi', async () => {
    for (const url of ['/uploads/dyn-doc-multi-1.pdf', '/uploads/dyn-doc-multi-2.pdf']) {
      assert.strictEqual(await authorizeFileAccess(OUTSIDER, url, 'view'), false, `view ${url} phải bị chặn`);
      assert.strictEqual(await authorizeFileAccess(OUTSIDER, url, 'download'), false, `download ${url} phải bị chặn`);
    }
  });

  await run('[1] Tài Liệu: file của trường tuỳ chỉnh kiểu "Tải tệp" (1 tệp) cũng bị chặn', async () => {
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, '/uploads/dyn-doc-single.pdf', 'view'), false);
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, '/uploads/dyn-doc-single.pdf', 'download'), false);
  });

  await run('[1] Không chặn nhầm: chính chủ + admin vẫn xem/tải được file trường tuỳ chỉnh của mình', async () => {
    const owner = { username: 'owner_doc', dept: DEPT_A, perms: {} };
    assert.strictEqual(await authorizeFileAccess(owner, '/uploads/dyn-doc-multi-1.pdf', 'view'), true);
    assert.strictEqual(await authorizeFileAccess(owner, '/uploads/dyn-doc-multi-1.pdf', 'download'), true);
    assert.strictEqual(await authorizeFileAccess(ADMIN, '/uploads/dyn-doc-multi-2.pdf', 'view'), true);
    assert.strictEqual(await authorizeFileAccess(ADMIN, '/uploads/dyn-doc-multi-2.pdf', 'download'), true);
  });

  await run('[1] findOwningRecord() trả về ĐÚNG owning-info như khi khớp field đính kèm chính', async () => {
    const viaPrimary = await findOwningRecord('/uploads/doc-primary.pdf');
    const viaCustom = await findOwningRecord('/uploads/dyn-doc-multi-2.pdf');
    assert.ok(viaCustom, 'file trường tuỳ chỉnh phải tra ra hồ sơ sở hữu');
    assert.strictEqual(viaCustom.moduleKey, viaPrimary.moduleKey);
    assert.strictEqual(viaCustom.dept, viaPrimary.dept);
    assert.strictEqual(viaCustom.ownerUsername, viaPrimary.ownerUsername);
    assert.strictEqual(viaCustom.record, viaPrimary.record);
  });

  await run('[1] Phủ đủ 6 module có Biểu Mẫu: submission/contract/signedCustomData/car/office/internalPost', async () => {
    const cases = [
      ['/uploads/dyn-sub-multi-1.pdf', 'submission', { username: 'owner_sub', dept: DEPT_A, perms: {} }],
      ['/uploads/dyn-ct-single.pdf', 'contract', { username: 'owner_ct', dept: DEPT_A, perms: {} }],
      ['/uploads/dyn-ct-signed-multi.pdf', 'contract', { username: 'owner_ct', dept: DEPT_A, perms: {} }],
      ['/uploads/dyn-car-single.pdf', 'car', { username: 'owner_car', dept: DEPT_A, perms: {} }],
      ['/uploads/dyn-office-multi-2.pdf', 'office', { username: 'owner_office', dept: DEPT_A, perms: {} }]
    ];
    for (const [url, moduleKey, owner] of cases) {
      const owning = await findOwningRecord(url);
      assert.ok(owning, `${url} phải tra ra hồ sơ sở hữu`);
      assert.strictEqual(owning.moduleKey, moduleKey, `${url} sai module`);
      assert.strictEqual(await authorizeFileAccess(OUTSIDER, url, 'view'), false, `${url} phải chặn người ngoài`);
      assert.strictEqual(await authorizeFileAccess(owner, url, 'view'), true, `${url} không được chặn chính chủ`);
    }
    // Góc Chia Sẻ dùng khuôn quyền RIÊNG (canViewInternalPost), không theo phòng ban.
    const postUrl = '/uploads/dyn-post-single.pdf';
    const owningPost = await findOwningRecord(postUrl);
    assert.ok(owningPost && owningPost.internal, 'file trường tuỳ chỉnh của bài Góc Chia Sẻ phải trả owning {internal}');
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, postUrl, 'view'), false, 'bài CHỜ DUYỆT phải chặn người khác');
    assert.strictEqual(await authorizeFileAccess({ username: 'author_post', perms: {} }, postUrl, 'view'), true);
  });

  await run('[1] Không bắt nhầm: giá trị customData thường (chuỗi) và file lạ vẫn giữ FAIL-OPEN như cũ', async () => {
    assert.strictEqual(await findOwningRecord('/uploads/khong-thuoc-ho-so-nao.png'), null);
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, '/uploads/khong-thuoc-ho-so-nao.png', 'view'), true);
  });

  // ###############################################################################################
  // # 2a. (High) File của hồ sơ ĐÃ VÀO THÙNG RÁC không được rơi vào FAIL-OPEN
  // ###############################################################################################
  //
  // moveRecordToTrash() XOÁ HẲN dòng khỏi dbo.Records, mà findOwningRecord() chỉ đọc dữ liệu đang sống
  // -> trước bản vá, xoá 1 hồ sơ làm file của nó từ "giới hạn theo phòng ban" thành "ai đăng nhập cũng
  // đọc được", trong khi chính Thùng Rác lại là khu vực admin-only.

  await run('[2a] Hồ sơ bị xoá vào Thùng Rác: người KHÔNG phải admin bị chặn (không còn FAIL-OPEN)', async () => {
    COLLECTIONS.docs = []; // hồ sơ đã rời dbo.Records
    TRASH_ITEMS = [{ trashId: 11, collection: 'docs', originalId: DOC.id, code: 'TL-01', item: DOC }];

    // Chính người trước đây xem được (uploader) cũng bị chặn — khớp đúng mức quyền của Thùng Rác.
    for (const u of [OUTSIDER, { username: 'owner_doc', dept: DEPT_A, perms: {} }]) {
      assert.strictEqual(await authorizeFileAccess(u, '/uploads/doc-primary.pdf', 'view'), false);
      assert.strictEqual(await authorizeFileAccess(u, '/uploads/doc-primary.pdf', 'download'), false);
    }
  });

  await run('[2a] ...và admin (mức quyền của chính Thùng Rác) vẫn đọc được', async () => {
    assert.strictEqual(await authorizeFileAccess(ADMIN, '/uploads/doc-primary.pdf', 'view'), true);
    assert.strictEqual(await authorizeFileAccess(ADMIN, '/uploads/doc-primary.pdf', 'download'), true);
  });

  await run('[2a] Thùng Rác cũng được soi tới customData (file trường tuỳ chỉnh của hồ sơ đã xoá)', async () => {
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, '/uploads/dyn-doc-multi-1.pdf', 'view'), false);
    assert.strictEqual(await authorizeFileAccess(ADMIN, '/uploads/dyn-doc-multi-1.pdf', 'view'), true);
    const found = await findOwningTrashItem('/uploads/dyn-doc-multi-1.pdf');
    assert.ok(found && found.trashId === 11, 'phải tra ra đúng mục thùng rác chứa file');
  });

  await run('[2a] Không đổi hành vi khác: file không thuộc hồ sơ sống LẪN thùng rác vẫn FAIL-OPEN', async () => {
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, '/uploads/avatar-abc.png', 'view'), true);
    resetCollections();
  });

  await run('[2a] Hồ sơ được KHÔI PHỤC khỏi Thùng Rác thì quyền trở lại như cũ', async () => {
    assert.strictEqual(await authorizeFileAccess({ username: 'owner_doc', dept: DEPT_A, perms: {} }, '/uploads/doc-primary.pdf', 'view'), true);
    assert.strictEqual(await authorizeFileAccess(OUTSIDER, '/uploads/doc-primary.pdf', 'view'), false);
  });

  // ###############################################################################################
  // # 3. (High) Duyệt đề nghị thanh toán PHẢI qua khung xác thực lại approverAuthLevel
  // ###############################################################################################
  //
  // Dựng ĐÚNG router thật (routes/records.js) với lib/auth thay bằng bản giả gắn sẵn req.freshUser —
  // phần đăng nhập đã có test riêng, ở đây chỉ kiểm phần "phiếu xác thực lại". lib/approvalAuth.js là
  // BẢN THẬT và dùng chung với test, nên phiếu cấp ở đây chính là phiếu route đọc.

  let CURRENT_USER = null;
  stubModule('../lib/auth', {
    requireAuth: (req, _res, next) => { req.freshUser = CURRENT_USER; req.allUsers = [CURRENT_USER]; next(); },
    blockIfMustChangePassword: (_req, _res, next) => next()
  });
  const recordsRouter = require('../routes/records');

  const paymentApp = express();
  paymentApp.use(express.json());
  paymentApp.use('/api/records', recordsRouter);

  function seedPaymentRequest() {
    PAYMENT_REQUESTS.set(77, {
      id: 77, code: 'TT-77', title: 'Thanh toán hợp đồng A', amount: 500000000,
      status: 'PENDING', installments: [{ amount: 500000000, confirmed: false }]
    });
  }

  const ACCOUNTANT_REAUTH = { username: 'ketoan', name: 'Kế Toán', dept: 'Kế Toán', perms: { paymentManage: true, approverAuthLevel: 'PASSWORD' } };
  const ACCOUNTANT_NONE = { username: 'ketoan2', name: 'Kế Toán 2', dept: 'Kế Toán', perms: { paymentManage: true, approverAuthLevel: 'NONE' } };

  await run('[3] approverAuthLevel != NONE mà CHƯA xác thực lại -> 403, đề nghị vẫn ở PENDING', async () => {
    seedPaymentRequest();
    CURRENT_USER = ACCOUNTANT_REAUTH;
    await withServer(paymentApp, async (base) => {
      const res = await fetch(`${base}/api/records/paymentRequests/77/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      assert.strictEqual(res.status, 403, 'phải bị chặn khi chưa có phiếu xác thực lại');
      const body = await res.json();
      // Cùng thông báo với routes/workflow.js — 10 module duyệt phải nói cùng 1 câu.
      assert.strictEqual(body.error, 'Cần xác thực lại (mật khẩu/OTP/PIN) trước khi duyệt');
    });
    assert.strictEqual(PAYMENT_REQUESTS.get(77).status, 'PENDING', 'không được duyệt khi bị chặn');
  });

  await run('[3] Có phiếu xác thực lại (issueApprovalGrant) -> duyệt được, đề nghị chuyển APPROVED', async () => {
    seedPaymentRequest();
    CURRENT_USER = ACCOUNTANT_REAUTH;
    approvalAuth.issueApprovalGrant(ACCOUNTANT_REAUTH.username);
    await withServer(paymentApp, async (base) => {
      const res = await fetch(`${base}/api/records/paymentRequests/77/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      assert.strictEqual(res.status, 200, 'có phiếu thì phải duyệt được');
      const body = await res.json();
      assert.strictEqual(body.item.status, 'APPROVED');
      assert.strictEqual(body.item.approvedBy, ACCOUNTANT_REAUTH.username);
    });
  });

  await run('[3] Phiếu dùng MỘT LẦN: lượt duyệt kế tiếp lại bị chặn (không tái sử dụng phiếu cũ)', async () => {
    seedPaymentRequest();
    CURRENT_USER = ACCOUNTANT_REAUTH;
    await withServer(paymentApp, async (base) => {
      const res = await fetch(`${base}/api/records/paymentRequests/77/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      assert.strictEqual(res.status, 403, 'phiếu đã tiêu ở lượt trước, không được dùng lại');
    });
    assert.strictEqual(PAYMENT_REQUESTS.get(77).status, 'PENDING');
  });

  await run('[3] Không phiền người không bật xác thực lại: approverAuthLevel NONE vẫn duyệt bình thường', async () => {
    seedPaymentRequest();
    CURRENT_USER = ACCOUNTANT_NONE;
    await withServer(paymentApp, async (base) => {
      const res = await fetch(`${base}/api/records/paymentRequests/77/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      assert.strictEqual(res.status, 200, 'NONE thì không được đòi phiếu');
      const body = await res.json();
      assert.strictEqual(body.item.status, 'APPROVED');
    });
  });

  await run('[3] Phiếu xác thực gắn theo TỪNG NGƯỜI: phiếu của người khác không dùng thay được', async () => {
    seedPaymentRequest();
    approvalAuth.issueApprovalGrant('nguoi_khac');
    CURRENT_USER = ACCOUNTANT_REAUTH;
    await withServer(paymentApp, async (base) => {
      const res = await fetch(`${base}/api/records/paymentRequests/77/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      assert.strictEqual(res.status, 403);
    });
  });

  await run('[3] Client đã nối dây: nút Xác nhận thanh toán đi qua withApprovalAuth()', async () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const fnStart = html.indexOf('function approvePaymentRequestAction(');
    assert.ok(fnStart > 0, 'không tìm thấy approvePaymentRequestAction()');
    const body = html.slice(fnStart, fnStart + 1400);
    assert.ok(body.includes('withApprovalAuth('),
      'approvePaymentRequestAction() phải gọi withApprovalAuth() — nếu không, server sẽ luôn trả 403 khó hiểu');
    assert.ok(body.indexOf('withApprovalAuth(') < body.indexOf("callRecordAction('paymentRequests'"),
      'phải xác thực lại TRƯỚC khi gọi API duyệt');
  });

  // ###############################################################################################
  // # 4. (Medium) Import người dùng .xlsx phải đi qua lib/xlsxSafeRead.js (chống zip bomb)
  // ###############################################################################################

  await run('[4] Import người dùng: file .xlsx bung ra quá lớn bị TỪ CHỐI 400 (như 6 luồng import kia)', async () => {
    const { MAX_UNCOMPRESSED_BYTES } = require('../lib/xlsxSafeRead');
    const base = await buildXlsx([
      ['username', 'pass', 'name', 'email', 'phone', 'dept', 'jobTitle'],
      ['nv01', 'Matkhau@123', 'Nguyễn Văn A', 'a@cty.vn', '0900000001', DEPT_A, 'Nhân viên']
    ]);
    const zip = await JSZip.loadAsync(base);
    // Cùng cách dựng bomb như tests/test-audit-fixes-batch2-zipbomb.js: 1 entry toàn byte giống nhau,
    // nén lại còn vài KB nhưng bung ra vượt trần.
    zip.file('xl/media/padding.bin', Buffer.alloc(MAX_UNCOMPRESSED_BYTES + 8 * 1024 * 1024, 0x41));
    const bomb = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    assert.ok(bomb.length < 2 * 1024 * 1024, 'bomb phải nhỏ (lọt mọi giới hạn kích thước upload)');

    let err = null;
    try { await parseUsersImportXlsx(bomb); } catch (e) { err = e; }
    assert.ok(err, 'phải ném lỗi, không được nạp hết vào RAM');
    assert.strictEqual(err.status, 400, 'phải là lỗi 400 như các luồng import khác');
    assert.ok(String(err.message).includes('giải nén ra quá lớn'), `thông báo lỗi bất ngờ: ${err.message}`);
  });

  await run('[4] Không đổi hành vi: file mẫu bình thường vẫn đọc ra đúng cột/dòng như trước', async () => {
    const buf = await buildXlsx([
      ['username', 'pass', 'name', 'email', 'phone', 'dept', 'jobTitle'],
      ['nv01', 'Matkhau@123', 'Nguyễn Văn A', 'a@cty.vn', '0900000001', DEPT_A, 'Nhân viên'],
      ['', 'x', 'Thiếu tài khoản', '', '', '', ''],
      ['nv02', 'Matkhau@456', 'Trần Thị B', 'b@cty.vn', '0900000002', DEPT_B, '']
    ]);
    const rows = await parseUsersImportXlsx(buf);
    assert.strictEqual(rows.length, 2, 'dòng thiếu username phải bị bỏ qua');
    assert.deepStrictEqual(rows[0], {
      username: 'nv01', pass: 'Matkhau@123', name: 'Nguyễn Văn A', email: 'a@cty.vn',
      phone: '0900000001', dept: DEPT_A, jobTitle: 'Nhân viên'
    });
    assert.strictEqual(rows[1].username, 'nv02');
    assert.strictEqual(rows[1].jobTitle, null, 'jobTitle trống phải là null như trước');
  });

  await run('[4] Không đổi hành vi: file bị xoá dòng tiêu đề vẫn đọc theo VỊ TRÍ cột như trước', async () => {
    const rows = await parseUsersImportXlsx(await buildXlsx([
      ['nv09', 'Matkhau@999', 'Lê Văn C', 'c@cty.vn', '0900000009', DEPT_A, 'Trưởng phòng']
    ]));
    assert.strictEqual(rows.length, 1, 'dòng đầu phải được coi là dữ liệu thật khi không có tiêu đề');
    assert.strictEqual(rows[0].username, 'nv09');
    assert.strictEqual(rows[0].jobTitle, 'Trưởng phòng');
  });

  // ###############################################################################################
  // # 5. (Medium) POST /api/send-email chỉ được gửi tới người nhận hợp lệ của hệ thống
  // ###############################################################################################

  const SENT_MAILS = [];
  stubModule('../lib/mailer', {
    sendMail: async ({ to }) => { SENT_MAILS.push(to); return { sent: to, failed: [], simulated: false, host: 'smtp.test', port: 587 }; },
    hasAuthConfigured: () => false,
    resolveEncryption: () => 'STARTTLS'
  });
  stubModule('../lib/emailCrypto', { decryptSecret: (v) => v, encryptSecret: (v) => v });

  const EMAIL_USERS = [
    { username: 'nv01', email: 'a@cty.vn', active: true },
    { username: 'nv02', email: 'b@cty.vn' },                       // active không khai báo = còn hoạt động
    { username: 'nv_nghi', email: 'daNghi@cty.vn', active: false } // đã vô hiệu hoá
  ];
  // Biên bản họp: người dự họp NHẬP TAY, có thể KHÔNG có tài khoản hệ thống và là địa chỉ ngoài — đây
  // là luồng gửi thư ra ngoài DUY NHẤT hợp lệ, phải giữ chạy được.
  COLLECTIONS.meetingMinutes = [{
    id: 1, code: 'BB-01',
    attendees: [
      { name: 'Khách mời ngoài', email: 'khach@doitac.com.vn', hasAccount: 'NO' },
      { name: 'Nội bộ', email: 'a@cty.vn', hasAccount: 'YES', username: 'nv01' }
    ]
  }];

  DB_HANDLER = async (q) => {
    if (/FROM dbo\.AppData/.test(q)) {
      return { recordset: [{ DataValue: JSON.stringify({ enabled: true, smtpHost: 'smtp.test', smtpPort: 587, senderEmail: 'no-reply@cty.vn' }) }] };
    }
    return { recordset: [] };
  };

  const emailRouter = require('../routes/email');
  const emailApp = express();
  emailApp.use(express.json());
  // server.js gắn requireAuth trước router này (nơi gán req.allUsers) — mô phỏng đúng như vậy.
  emailApp.use('/api/send-email', (req, _res, next) => { req.freshUser = EMAIL_USERS[0]; req.allUsers = EMAIL_USERS; next(); }, emailRouter);

  async function postEmail(base, to) {
    const res = await fetch(`${base}/api/send-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject: '[VPDT] Thử', text: 'nội dung' })
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  await run('[5] Địa chỉ NGOÀI bất kỳ (relay spam/lừa đảo) bị từ chối 403, không gọi tới SMTP', async () => {
    SENT_MAILS.length = 0;
    await withServer(emailApp, async (base) => {
      const r = await postEmail(base, ['victim@gmail.com']);
      assert.strictEqual(r.status, 403, `phải bị chặn, nhận ${r.status}`);
      assert.ok(String(r.body.error).includes('victim@gmail.com'), 'thông báo phải nêu rõ địa chỉ bị từ chối');
    });
    assert.strictEqual(SENT_MAILS.length, 0, 'không được gửi gì cả');
  });

  await run('[5] Chỉ cần MỘT địa chỉ lạ trong danh sách là chặn cả yêu cầu (không gửi phần hợp lệ)', async () => {
    SENT_MAILS.length = 0;
    await withServer(emailApp, async (base) => {
      const r = await postEmail(base, ['a@cty.vn', 'attacker@evil.com']);
      assert.strictEqual(r.status, 403);
    });
    assert.strictEqual(SENT_MAILS.length, 0);
  });

  await run('[5] Tài khoản ĐÃ VÔ HIỆU HOÁ cũng không còn là người nhận hợp lệ', async () => {
    await withServer(emailApp, async (base) => {
      const r = await postEmail(base, ['danghi@cty.vn']);
      assert.strictEqual(r.status, 403);
    });
  });

  await run('[5] KHÔNG phá luồng nội bộ: gửi tới người dùng đang hoạt động vẫn chạy (không phân biệt hoa thường)', async () => {
    SENT_MAILS.length = 0;
    await withServer(emailApp, async (base) => {
      const r = await postEmail(base, ['a@cty.vn', 'B@CTY.VN']);
      assert.strictEqual(r.status, 200, `phải gửi được, nhận ${r.status} ${JSON.stringify(r.body)}`);
    });
    assert.strictEqual(SENT_MAILS.length, 1, 'phải gọi sendMail đúng 1 lần');
  });

  await run('[5] KHÔNG phá luồng Biên Bản Họp: email khách mời ngoài đã ghi trong biên bản vẫn gửi được', async () => {
    SENT_MAILS.length = 0;
    await withServer(emailApp, async (base) => {
      const r = await postEmail(base, ['khach@doitac.com.vn']);
      assert.strictEqual(r.status, 200, `thành phần tham dự biên bản họp phải nhận được thư, nhận ${r.status}`);
    });
    assert.strictEqual(SENT_MAILS.length, 1);
  });

  // ###############################################################################################
  // # 6. (Medium) OTP phê duyệt phải sinh bằng CSPRNG (crypto.randomInt), không phải Math.random()
  // ###############################################################################################

  await run('[6] Mã nguồn issueApprovalOtp() dùng crypto.randomInt và KHÔNG còn Math.random', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'approvalAuth.js'), 'utf8');
    assert.ok(src.includes('crypto.randomInt('), 'phải dùng crypto.randomInt() như lib/captcha.js');
    const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.ok(!code.includes('Math.random'), 'không được còn Math.random trong code (ngoài chú thích)');
  });

  await run('[6] Không hề gọi Math.random khi sinh OTP (chặn đường quay lại bộ sinh giả ngẫu nhiên)', () => {
    const original = Math.random;
    let called = 0;
    Math.random = () => { called++; return original(); };
    try {
      for (let i = 0; i < 50; i++) approvalAuth.issueApprovalOtp(`u${i}`);
    } finally {
      Math.random = original;
    }
    assert.strictEqual(called, 0, 'issueApprovalOtp() không được chạm tới Math.random');
  });

  await run('[6] OTP vẫn đúng khuôn 6 chữ số và phân bố đều trên mọi vị trí', () => {
    const seenPerPos = Array.from({ length: 6 }, () => new Set());
    const all = new Set();
    for (let i = 0; i < 3000; i++) {
      const code = approvalAuth.issueApprovalOtp(`user${i}`);
      assert.ok(/^\d{6}$/.test(code), `OTP sai khuôn: ${code}`);
      all.add(code);
      for (let p = 0; p < 6; p++) seenPerPos[p].add(code[p]);
    }
    seenPerPos.forEach((s, p) => assert.strictEqual(s.size, 10, `vị trí ${p} chỉ thấy ${s.size}/10 chữ số`));
    assert.ok(all.size > 2900, `3000 mã mà chỉ có ${all.size} giá trị khác nhau — nghi vấn bộ sinh yếu`);
  });

  await run('[6] OTP vẫn xác minh được đúng 1 lần (không phá lib/approvalAuth.js)', () => {
    const code = approvalAuth.issueApprovalOtp('otp_user');
    assert.strictEqual(approvalAuth.verifyApprovalOtp('otp_user', 'khong-dung'), false);
    const code2 = approvalAuth.issueApprovalOtp('otp_user');
    assert.strictEqual(approvalAuth.verifyApprovalOtp('otp_user', code2), true, 'mã đúng phải xác minh được');
    assert.strictEqual(approvalAuth.verifyApprovalOtp('otp_user', code2), false, 'mã đã dùng không được dùng lại');
    assert.strictEqual(approvalAuth.consumeApprovalGrant('otp_user'), true, 'xác minh OTP đúng phải cấp phiếu Duyệt');
    assert.notStrictEqual(code, code2);
  });

  // ###############################################################################################
  // # 7 + 8. (Low) Rate limiter cho đăng ký WebAuthn + tăng sessionVersion khi gỡ thiết bị
  // ###############################################################################################
  //
  // routes/auth.js kéo theo cả chuỗi lib xác thực (webauthn/captcha/systemLog/mailer...) nên kiểm ở
  // mức mã nguồn: đúng 2 route được nêu phải có limiter riêng, và nhánh gỡ thiết bị phải tăng
  // sessionVersion + cấp lại cookie cho phiên hiện tại (đúng khuôn đổi mật khẩu/PIN).

  await run('[7] 2 route đăng ký WebAuthn đã có rate limiter riêng', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
    assert.ok(/const webauthnRegisterRateLimiter = rateLimit\(/.test(src), 'thiếu định nghĩa limiter riêng');
    assert.ok(/'\/webauthn\/register-options',\s*webauthnRegisterRateLimiter/.test(src),
      'register-options chưa gắn limiter');
    assert.ok(/'\/webauthn\/register-verify',\s*webauthnRegisterRateLimiter/.test(src),
      'register-verify chưa gắn limiter');
  });

  await run('[8] Gỡ thiết bị WebAuthn tăng sessionVersion + cấp lại token cho phiên hiện tại', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
    const start = src.indexOf("router.delete('/webauthn/credentials/:id'");
    assert.ok(start > 0, 'không tìm thấy route gỡ thiết bị');
    const handler = src.slice(start, src.indexOf('router.post', start));
    assert.ok(/sessionVersion:\s*\(list\[idx\]\.sessionVersion \|\| 0\) \+ 1/.test(handler),
      'gỡ thiết bị phải tăng sessionVersion để vô hiệu hoá phiên đang mở từ thiết bị đó');
    assert.ok(handler.includes('setAuthCookie(res, signToken('),
      'phải cấp lại token cho phiên hiện tại để không tự đăng xuất chính người vừa bấm gỡ');
  });

  // ###############################################################################################
  // # 9. (Low) sendMail() phải có timeout kết nối/socket SMTP
  // ###############################################################################################

  await run('[9] buildTransporter() truyền connectionTimeout/socketTimeout cho nodemailer', () => {
    // Bắt lấy config THẬT mà lib/mailer.js đưa cho nodemailer.createTransport().
    const nodemailerPath = require.resolve('nodemailer');
    const original = require.cache[nodemailerPath];
    let captured = null;
    require.cache[nodemailerPath] = {
      id: nodemailerPath, filename: nodemailerPath, loaded: true, children: [], paths: [],
      exports: { createTransport: (cfg) => { captured = cfg; return { sendMail: async () => ({}) }; } }
    };
    const mailerPath = require.resolve('../lib/mailer');
    const originalMailer = require.cache[mailerPath];
    delete require.cache[mailerPath];
    try {
      const realMailer = require('../lib/mailer');
      // sendMail() gọi buildTransporter() bên trong — chỉ cần host là nó đi tới nodemailer thật.
      return realMailer.sendMail({ to: 'x@cty.vn', subject: 's', text: 't', host: 'smtp.test', port: 587 })
        .catch(() => {})
        .then(() => {
          assert.ok(captured, 'không bắt được config truyền cho nodemailer');
          assert.strictEqual(captured.connectionTimeout, 10000);
          assert.strictEqual(captured.socketTimeout, 10000);
          assert.strictEqual(captured.greetingTimeout, 10000);
        });
    } finally {
      if (original) require.cache[nodemailerPath] = original; else delete require.cache[nodemailerPath];
      if (originalMailer) require.cache[mailerPath] = originalMailer; else delete require.cache[mailerPath];
    }
  });

  // ###############################################################################################
  // # 2b. (High) "Xoá vĩnh viễn" phải gỡ luôn FILE VẬT LÝ khỏi uploads/
  // ###############################################################################################
  //
  // ĐỂ CUỐI vì phần này cần lib/recordStore.js THẬT (các kịch bản trên dùng bản giả) — gỡ bản giả khỏi
  // require.cache rồi nạp lại bản thật, chạy trên ../db giả đã cắm từ đầu file.

  delete require.cache[RECORD_STORE_PATH];
  const realRecordStore = require('../lib/recordStore');
  const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

  function makeUploadFile(name) {
    const file = path.join(UPLOAD_DIR, name);
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(file, 'noi dung file test cluster6');
    return file;
  }

  await run('[2b] Xoá vĩnh viễn gỡ luôn file vật lý (fileUrl, signedFileUrl, extraFiles, customData)', async () => {
    const names = [
      'test-c6-primary.pdf', 'test-c6-signed.pdf', 'test-c6-extra.pdf',
      'test-c6-dyn-1.pdf', 'test-c6-dyn-2.pdf'
    ];
    const files = names.map(makeUploadFile);
    const record = {
      id: 91, code: 'HD-91',
      fileUrl: '/uploads/test-c6-primary.pdf',
      signedFileUrl: '/uploads/test-c6-signed.pdf',
      extraFiles: [{ fileUrl: '/uploads/test-c6-extra.pdf', fileName: 'extra.pdf' }],
      customData: { 'Phụ lục': [uploaded('test-c6-dyn-1.pdf')], 'Bản scan': uploaded('test-c6-dyn-2.pdf') }
    };

    DB_HANDLER = async (q) => {
      if (/DELETE FROM dbo\.TrashBin/.test(q)) return { recordset: [{ Id: 91, Payload: JSON.stringify(record) }] };
      // Không còn bản ghi nào (sống hay trong thùng rác) trỏ tới các file này.
      return { recordset: [] };
    };

    try {
      await realRecordStore.permanentlyDeleteTrashItem(91);
      files.forEach((f, i) => assert.ok(!fs.existsSync(f), `file "${names[i]}" vẫn còn trên đĩa sau khi xoá vĩnh viễn`));
    } finally {
      files.forEach(f => { try { fs.unlinkSync(f); } catch (e) { /* đã xoá rồi */ } });
    }
  });

  await run('[2b] AN TOÀN: file còn bản ghi KHÁC tham chiếu tới thì KHÔNG bị xoá', async () => {
    const shared = makeUploadFile('test-c6-shared.pdf');
    const own = makeUploadFile('test-c6-own.pdf');
    const record = { id: 92, fileUrl: '/uploads/test-c6-shared.pdf', extraFiles: [{ fileUrl: '/uploads/test-c6-own.pdf' }] };

    DB_HANDLER = async (q, inputs) => {
      if (/DELETE FROM dbo\.TrashBin/.test(q)) return { recordset: [{ Id: 92, Payload: JSON.stringify(record) }] };
      // Chỉ file "shared" còn được 1 hồ sơ ĐANG SỐNG khác dùng.
      if (/FROM dbo\.Records/.test(q) && String(inputs.pat).includes('test-c6-shared.pdf')) {
        return { recordset: [{ c: 1 }] };
      }
      return { recordset: [] };
    };

    try {
      await realRecordStore.permanentlyDeleteTrashItem(92);
      assert.ok(fs.existsSync(shared), 'file còn hồ sơ khác dùng KHÔNG được xoá');
      assert.ok(!fs.existsSync(own), 'file không ai dùng nữa phải bị xoá');
    } finally {
      [shared, own].forEach(f => { try { fs.unlinkSync(f); } catch (e) { /* đã xoá rồi */ } });
    }
  });

  await run('[2b] Không tìm thấy mục trong thùng rác -> vẫn 404 như cũ, không đụng file nào', async () => {
    DB_HANDLER = async () => ({ recordset: [] });
    let err = null;
    try { await realRecordStore.permanentlyDeleteTrashItem(999); } catch (e) { err = e; }
    assert.ok(err, 'phải ném lỗi khi không có mục');
    assert.strictEqual(err.status, 404);
  });

  await run('[2b] File đã mất trên đĩa (ENOENT) không làm hỏng thao tác xoá vĩnh viễn', async () => {
    const record = { id: 93, fileUrl: '/uploads/test-c6-khong-ton-tai.pdf' };
    DB_HANDLER = async (q) => {
      if (/DELETE FROM dbo\.TrashBin/.test(q)) return { recordset: [{ Id: 93, Payload: JSON.stringify(record) }] };
      return { recordset: [] };
    };
    await realRecordStore.permanentlyDeleteTrashItem(93); // không được ném lỗi
  });

  await run('[2b] Chặn path traversal: chuỗi "/uploads/../server.js" không bao giờ được unlink', async () => {
    const urls = realRecordStore.collectRecordFileUrls({ fileUrl: '/uploads/../server.js', other: '/uploads/sub/x.pdf' });
    assert.strictEqual(urls.size, 0, 'đường dẫn không đúng khuôn "/uploads/<tên-file>" phải bị loại từ đầu');
    const serverJs = path.join(__dirname, '..', 'server.js');
    assert.ok(fs.existsSync(serverJs), 'server.js phải còn nguyên');
  });

  await run('[2b] Cache Thùng Rác: đọc lại dùng cache, nhưng bị XOÁ ngay sau khi xoá vĩnh viễn', async () => {
    let selects = 0;
    DB_HANDLER = async (q) => {
      if (/SELECT .* FROM dbo\.TrashBin/.test(q)) { selects++; return { recordset: [] }; }
      if (/DELETE FROM dbo\.TrashBin/.test(q)) return { recordset: [{ Id: 94, Payload: JSON.stringify({ id: 94 }) }] };
      return { recordset: [] };
    };
    await realRecordStore.getAllTrashItemsCached();
    await realRecordStore.getAllTrashItemsCached();
    assert.strictEqual(selects, 1, 'lượt đọc thứ 2 phải lấy từ cache (đây là đường đi của MỌI ảnh avatar)');

    await realRecordStore.permanentlyDeleteTrashItem(94);
    await realRecordStore.getAllTrashItemsCached();
    assert.strictEqual(selects, 2, 'xoá vĩnh viễn phải xoá cache để không trả dữ liệu cũ');
  });

  await run('[2b] collectRecordFileUrls() gom đủ mọi kiểu tham chiếu file của các collection', () => {
    const urls = realRecordStore.collectRecordFileUrls({
      fileUrl: '/uploads/a.pdf',
      signedFileUrl: '/uploads/b.pdf',
      cvFileUrl: '/uploads/c.pdf',
      attachment: { fileUrl: '/uploads/d.pdf' },
      files: [{ fileUrl: '/uploads/e.pdf' }],
      compilation: { slides: [{ fileUrl: '/uploads/f.pdf' }] },
      customData: { 'Tệp': [uploaded('g.pdf')] },
      signedCustomData: { 'Tệp ký': uploaded('h.pdf') },
      title: 'không phải file'
    });
    ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach(k =>
      assert.ok(urls.has(`/uploads/${k}.pdf`), `thiếu /uploads/${k}.pdf`));
    assert.strictEqual(urls.size, 8);
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  if (failed) process.exit(1);
}

main().catch(err => { console.error('FATAL:', err && err.stack ? err.stack : err); process.exit(1); });
