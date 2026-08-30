// server/tests/test-audit-round2-cluster3.js
//
// Regression test cho CỤM 3 (Thanh Toán / Ngân Sách / Văn Phòng Phẩm / Hỗ Trợ IT) của ĐỢT RÀ SOÁT
// BẢO MẬT THỨ HAI. Mỗi kịch bản gắn với ĐÚNG 1 lỗ hổng đã vá, viết sao cho hoàn tác bản vá là test
// FAIL ngay (không phải test "hành vi chung chung"):
//
//   1. budgetEntries có race TOCTOU: luật "1 bản ngân sách/PHÒNG BAN/kỳ" chỉ được kiểm tra bằng 1 lượt
//      quét TRONG BỘ NHỚ ở extraValidate, mà budgetEntries lại KHÔNG khai báo getLockKey nên
//      routes/create.js đi đường createForCollection() thường (không applock) — 2 request tạo ngân
//      sách CÙNG LÚC cho CÙNG phòng ban + CÙNG kỳ đều đọc collection lúc "chưa có bản nào" rồi cùng
//      ghi -> 2 bản trùng, cả hai cùng vào quy trình duyệt. Vá: thêm getLockKey giống
//      vppRegistrations/meetings/trainingRegistrations để đi đường createForCollectionSerialized()
//      (sp_getapplock) (lib/createValidation.js).
//   2a. requestItPriceEmergencyReject() chỉ kiểm tra status==='APPROVED' + !applied, KHÔNG chặn khi
//      còn yêu cầu bổ sung chưa được người đề xuất phản hồi — khác hẳn applyPriceApproval() và
//      requestPriceInfoFromIt() đã chặn đúng bằng hasUnresolvedPriceInfoRequest() (lib/recordActions.js).
//   2b. submitPriceSupplementFile() KHÔNG kiểm tra item.status — hồ sơ đã REJECTED (kể cả do "từ chối
//      khẩn cấp") vẫn nhận thêm tệp bổ sung + dòng history mới (lib/recordActions.js).
//   3. PAYMENT_EDITABLE_FIELDS liệt kê 'amount' dù editPaymentRequest() LUÔN ghi đè pr.amount = Σ số
//      tiền các đợt -> giá trị client gửi bị vứt bỏ. Dọn dẹp, KHÔNG đổi hành vi: test này khoá chặt
//      "amount client gửi luôn bị bỏ qua" ở CẢ trước lẫn sau bản vá (lib/recordActions.js).
//   4. approveItTicketEscalation()/denyItTicketEscalation() chỉ so approvalApprover === user.username,
//      thiếu lối thoát admin mà gần như MỌI cổng duyệt khác trong hệ thống đều có (canApproveStep() ở
//      lib/workflowEngine.js) -> ticket leo thang cho người đã nghỉ việc kẹt vĩnh viễn ở PENDING vì
//      updateItTicketStatus() chặn mọi chuyển trạng thái khi approvalStatus==='PENDING'
//      (lib/recordActions.js).
//   5. updateBudgetEntryDraft()/submitBudgetEntry() chỉ kiểm tra kỳ còn tồn tại + còn mở, KHÔNG kiểm
//      tra lại period.deptScope như lúc TẠO (lib/createValidation.js) -> bản nháp của phòng ban đã bị
//      gỡ khỏi phạm vi kỳ vẫn sửa và GỬI tiếp vào quy trình duyệt được (lib/recordActions.js).
//
// KHÁC các test Playwright trong thư mục này: bài này chạy THUẦN NODE. Lỗ hổng nằm hoàn toàn ở tầng
// server (đường tạo hồ sơ có khoá, các cổng kiểm tra trạng thái/quyền trong lib/recordActions.js), giao
// diện không tham gia — nên chạy thẳng express router THẬT (routes/create.js) + gọi thẳng
// lib/recordActions.js trong tiến trình Node, chỉ giả lập đúng tầng LƯU TRỮ + middleware xác thực,
// đúng khuôn tests/test-audit-fixes-batch1.js.
//
// Chạy: node server/tests/test-audit-round2-cluster3.js
'use strict';

const http = require('http');
const path = require('path');

let PORT = 0;

// ===================== 0) Giả lập tầng lưu trữ + xác thực TRƯỚC khi require router =====================
// routes/create.js destructure các hàm DB ngay lúc require, nên bản giả lập phải nằm sẵn trong
// require.cache TRƯỚC dòng require router bên dưới.
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
const BUDGET_KD_1 = { username: 'ns_kd1', name: 'Người Lập Ngân Sách KD 1', dept: 'Kinh Doanh', perms: { budgetCreate: true }, active: true };
const BUDGET_KD_2 = { username: 'ns_kd2', name: 'Người Lập Ngân Sách KD 2', dept: 'Kinh Doanh', perms: { budgetCreate: true }, active: true };
const BUDGET_IT = { username: 'ns_it', name: 'Người Lập Ngân Sách IT', dept: 'IT', perms: { budgetCreate: true }, active: true };
const IT1 = { username: 'it1', name: 'Đội Hỗ Trợ IT', dept: 'IT', perms: { itManage: true }, active: true };
const PROPOSER = { username: 'kd_dexuat', name: 'Người Đề Xuất Giá', dept: 'Kinh Doanh', perms: {}, active: true };
const TP_APPROVER = { username: 'tp_kd', name: 'Trưởng Phòng Kinh Doanh', dept: 'Kinh Doanh', perms: { itPriceEmergencyRejectApprove: true }, active: true };
const ACCOUNTANT = { username: 'ketoan', name: 'Kế Toán Thanh Toán', dept: 'Tài Chính', perms: { paymentManage: true }, active: true };
const OUTSIDER = { username: 'nguoi_khac', name: 'Người Ngoài Cuộc', dept: 'Hành Chính', perms: { itManage: true }, active: true };

const USERS = [ADMIN, BUDGET_KD_1, BUDGET_KD_2, BUDGET_IT, IT1, PROPOSER, TP_APPROVER, ACCOUNTANT, OUTSIDER];

const APP_DATA = {
  users: USERS,
  depts: ['Kinh Doanh', 'IT', 'Tài Chính', 'Hành Chính', 'Ban Giám Đốc'],
  budgetDeptWorkflows: {}
};

// Bảng dbo.Records giả lập — chỉ các collection mà đường tạo budgetEntries đụng tới.
const RECORDS = {
  budgetEntries: [],
  budgetPeriods: [],
  budgetTemplates: []
};

// Kỳ ngân sách mở, áp dụng cho ĐÚNG 2 phòng (Kinh Doanh + IT) — không dùng deptScope.all để kịch bản
// "phòng ban rơi ra khỏi phạm vi" ở Fix 5 có nghĩa.
function makeOpenPeriod() {
  return {
    id: 5001, name: 'Ngân sách Quý 4/2026', status: 'OPEN',
    endTime: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    deptScope: { all: false, depts: ['Kinh Doanh', 'IT'] },
    templateId: null, closeHistory: []
  };
}

function resetRecords() {
  RECORDS.budgetEntries = [];
  RECORDS.budgetPeriods = [makeOpenPeriod()];
  RECORDS.budgetTemplates = [];
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

// ---- Giả lập đường GHI của dbo.Records, mô phỏng ĐÚNG cửa sổ race thật ----------------------------
// createForCollection() thật đọc collection -> gọi builderFn (kiểm tra trùng) -> INSERT, KHÔNG có
// applock nào bao quanh: 2 request đan xen nhau trong cửa sổ đó đều thấy "chưa có bản nào". Bản giả lập
// dưới đây chèn 1 lượt nhường lượt (await setTimeout) đúng giữa "đọc" và "ghi" để cửa sổ đó xảy ra CHẮC
// CHẮN, thay vì phụ thuộc may rủi lịch chạy.
//
// createForCollectionSerialized() thật bọc TOÀN BỘ chuỗi đọc-kiểm tra-ghi trong sp_getapplock theo
// lockKey (@LockOwner='Transaction', nhả khi commit) — bản giả lập tái hiện bằng 1 hàng đợi promise
// theo từng lockKey. Cửa sổ nhường lượt vẫn giữ nguyên: nếu bản vá đúng thì khoá phải khiến request thứ
// hai đợi request thứ nhất ghi xong rồi mới đọc, và lúc đó nó THẤY bản trùng -> 409.
const LOCK_KEYS_USED = [];
const lockChains = new Map();

async function withFakeAppLock(lockKey, fn) {
  LOCK_KEYS_USED.push(lockKey);
  const prev = lockChains.get(lockKey) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  lockChains.set(lockKey, prev.then(() => current));
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function rawCreate(collection, builderFn) {
  const existing = (RECORDS[collection] || []).slice();
  // Cửa sổ đọc-kiểm-tra-ghi: nhường lượt cho request song song chen vào ĐÚNG chỗ này.
  await new Promise((resolve) => setTimeout(resolve, 25));
  const record = await builderFn(existing);
  if (!RECORDS[collection]) RECORDS[collection] = [];
  RECORDS[collection].unshift(record);
  return record;
}

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(RECORDS)),
  getAllForCollectionCached: async (c) => RECORDS[c] || [],
  getAllForCollection: async (c) => RECORDS[c] || [],
  // routes/create.js đọc trash trước khi tạo (kiểm trùng mã với hồ sơ đã xoá, xem
  // lib/createValidation.js) — bài test này không có kịch bản nào liên quan Thùng Rác, luôn trả rỗng.
  getTrashItems: async () => [],
  createForCollection: async (c, builderFn) => rawCreate(c, builderFn),
  createForCollectionSerialized: async (c, lockKey, builderFn) => withFakeAppLock(lockKey, () => rawCreate(c, builderFn)),
  withAppLock: async (key, fn) => withFakeAppLock(key, fn),
  withLockedRecordForCollection: async (c, id, mutator) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    const updated = await mutator(list[idx]);
    list[idx] = updated;
    return updated;
  },
  withLockedRecordById: async () => { throw new Error('không dùng trong bài test này'); },
  insertRecord: async () => { throw new Error('không dùng trong bài test này'); },
  deleteRecordForCollection: async () => { throw new Error('không dùng trong bài test này'); }
});

stubModule('lib/auth', {
  // Bản thật re-fetch user từ DB rồi gắn req.freshUser/req.allUsers — giữ nguyên hợp đồng đó ở đây.
  // KHÁC tests/test-audit-fixes-batch1.js: bài này bắn 2 request SONG SONG nên KHÔNG dùng được 1 biến
  // "người đang đăng nhập" toàn cục (request sau ghi đè request trước ngay giữa chừng) — danh tính đi
  // kèm TỪNG request qua header x-test-user, đúng như cookie phiên thật.
  requireAuth: (req, res, next) => {
    const username = req.headers['x-test-user'] || CURRENT_USERNAME;
    const fresh = USERS.find(u => u.username === username);
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

// ===================== 1) Require code THẬT (sau khi đã cắm bản giả lập) =====================
const express = require('express');
const { createRunner, assert, assertEqual, assertIncludes } = require('./testHarness');
const recordActions = require('../lib/recordActions');
const { CREATE_MODULE_CONFIGS } = require('../lib/createValidation');
const createRoutes = require('../routes/create');

// ===================== 2) Client HTTP nhỏ gọn =====================
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

// Danh tính đi kèm TỪNG request qua header x-test-user (xem chú thích ở stub lib/auth bên trên).
async function api(method, urlPath, body, asUser) {
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-test-user': asUser ? asUser.username : CURRENT_USERNAME },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

function goodBudgetLines() {
  return [
    { name: 'Chi phí tiếp khách', amount: 12000000, budgetType: 'OPEX' },
    { name: 'Mua máy tính xách tay', amount: 30000000, budgetType: 'CAPEX' }
  ];
}

// ===================== Bộ dựng dữ liệu cho các kịch bản gọi thẳng lib/recordActions.js ==============
function makeApprovedPriceItem(extra) {
  return Object.assign({
    id: 7001, code: 'PDG-001', dept: 'Kinh Doanh',
    creator: PROPOSER.username, creatorName: PROPOSER.name,
    status: 'APPROVED', currentStep: 2, applied: false,
    applyClaimedBy: null, applyClaimedByName: null,
    infoRequests: [], files: [],
    history: [
      { step: 1, approver: 'Trưởng phòng', username: 'tp_kd', action: 'APPROVED', comment: '', time: '01/08/2026' },
      { step: 2, approver: TP_APPROVER.name, username: TP_APPROVER.username, action: 'APPROVED', comment: '', time: '02/08/2026' }
    ]
  }, extra || {});
}

// Tệp bảng giá bổ sung HỢP LỆ (đúng khuôn sanitizePriceFileItems(): mỗi dòng là { values: {...} } có ít
// nhất 1 ô có dữ liệu) — dùng ở CẢ kịch bản bị chặn lẫn kịch bản chạy được, để chắc chắn các lỗi 409
// dưới đây đến từ ĐÚNG cổng kiểm tra trạng thái chứ không phải từ lỗi làm sạch tệp.
function goodSupplementFile() {
  return {
    fileUrl: '/uploads/bang-gia-moi.xlsx', fileName: 'bang-gia-moi.xlsx',
    items: [{ values: { c0: 'Sữa tươi 1L', c1: '25000' } }, { values: { c0: 'Bánh quy hộp', c1: '48000' } }],
    columnLabels: [{ key: 'c0', label: 'Tên hàng' }, { key: 'c1', label: 'Giá' }]
  };
}

function openInfoRequest() {
  return {
    id: 900001, step: null, requestedBy: IT1.username, requestedByName: IT1.name,
    reason: 'Bảng giá thiếu cột đơn vị tính', requestedAt: '03/08/2026', response: null, respondedAt: null, byRole: 'it'
  };
}

function makeEscalatedTicket() {
  return {
    id: 8001, code: 'HTIT-001', dept: 'Kinh Doanh', creator: PROPOSER.username,
    status: 'DOING', assignee: IT1.username, assigneeName: IT1.name,
    approvalStatus: 'PENDING', approvalApprover: 'nguoi_da_nghi_viec', approvalApproverName: 'Người Đã Nghỉ Việc',
    approvalReason: 'Cần duyệt chi phí thay linh kiện', approvalComment: '', comments: []
  };
}

function makeDraftBudgetEntry() {
  return {
    id: 6001, periodId: 5001, dept: 'Kinh Doanh',
    creator: BUDGET_KD_1.username, creatorName: BUDGET_KD_1.name,
    status: 'DRAFT', currentStep: 1, history: [],
    lines: [{ name: 'Chi phí tiếp khách', amount: 12000000, budgetType: 'OPEX', extra: {} }]
  };
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
    // =====================================================================================
    // FIX 1 — budgetEntries: race TOCTOU "1 ngân sách/phòng ban/kỳ"
    // =====================================================================================
    await run.run('Fix 1a — budgetEntries khai báo getLockKey theo cặp KỲ + PHÒNG BAN (không theo người tạo)', async () => {
      const cfg = CREATE_MODULE_CONFIGS.budgetEntries;
      assert(typeof cfg.getLockKey === 'function',
        'budgetEntries PHẢI có getLockKey — nếu không, routes/create.js đi đường createForCollection() không khoá và luật "1 bản/phòng/kỳ" chỉ còn là 1 lượt quét trong bộ nhớ (race TOCTOU)');
      assertEqual(cfg.getLockKey({ periodId: 5001 }, BUDGET_KD_1), 'budget_entry:5001:Kinh Doanh',
        'Khoá phải gồm ĐÚNG kỳ + phòng ban của người tạo');
      // Hai NGƯỜI KHÁC NHAU cùng phòng phải cho ra CÙNG 1 khoá — điều kiện trùng lặp là theo PHÒNG BAN,
      // khoá theo người tạo (như vppRegistrations) sẽ không chặn được gì ở module này.
      assertEqual(cfg.getLockKey({ periodId: 5001 }, BUDGET_KD_2), cfg.getLockKey({ periodId: 5001 }, BUDGET_KD_1),
        '2 người CÙNG PHÒNG phải giành CÙNG 1 khoá (nếu khoá theo username thì race vẫn còn nguyên)');
      assert(cfg.getLockKey({ periodId: 5001 }, BUDGET_IT) !== cfg.getLockKey({ periodId: 5001 }, BUDGET_KD_1),
        '2 phòng ban khác nhau phải là 2 khoá khác nhau (không được khoá chéo lẫn nhau)');
    });

    await run.run('Fix 1b — 2 request tạo ngân sách SONG SONG cho cùng phòng + cùng kỳ: đúng 1 bản được tạo, bản thứ hai bị 409', async () => {
      resetRecords();
      LOCK_KEYS_USED.length = 0;
      const body = { periodId: 5001, lines: goodBudgetLines() };
      const [r1, r2] = await Promise.all([
        api('POST', '/api/create/budgetEntries', body, BUDGET_KD_1),
        api('POST', '/api/create/budgetEntries', body, BUDGET_KD_2)
      ]);
      const statuses = [r1.status, r2.status].sort();
      assertEqual(JSON.stringify(statuses), JSON.stringify([200, 409]),
        `Phải có ĐÚNG 1 request thành công và 1 request bị chặn 409 (nhận được ${r1.status} + ${r2.status})`);
      const rejected = r1.status === 409 ? r1 : r2;
      assertIncludes(rejected.body.error, 'đã có ngân sách ở kỳ này',
        'Request thua cuộc phải nhận đúng thông báo "phòng ban đã có ngân sách ở kỳ này"');
      assertEqual(RECORDS.budgetEntries.length, 1,
        'CHỈ được ghi ĐÚNG 1 bản ngân sách cho cặp phòng+kỳ này (2 bản = race TOCTOU chưa được vá)');
      assertIncludes(LOCK_KEYS_USED, 'budget_entry:5001:Kinh Doanh',
        'Cả 2 request phải đi qua đường createForCollectionSerialized() với khoá kỳ+phòng ban');
      assertEqual(LOCK_KEYS_USED.length, 2, 'Cả 2 request đều phải giành khoá (không request nào lọt qua đường không khoá)');
    });

    await run.run('Fix 1c — khoá KHÔNG chặn nhầm: 2 phòng ban khác nhau vẫn tạo song song được cho cùng 1 kỳ', async () => {
      resetRecords();
      LOCK_KEYS_USED.length = 0;
      const body = { periodId: 5001, lines: goodBudgetLines() };
      const [r1, r2] = await Promise.all([
        api('POST', '/api/create/budgetEntries', body, BUDGET_KD_1),
        api('POST', '/api/create/budgetEntries', body, BUDGET_IT)
      ]);
      assertEqual(r1.status, 200, 'Phòng Kinh Doanh tạo được');
      assertEqual(r2.status, 200, 'Phòng IT cũng phải tạo được (khoá theo phòng ban, không phải khoá toàn collection)');
      assertEqual(RECORDS.budgetEntries.length, 2, 'Đủ 2 bản ngân sách của 2 phòng ban khác nhau');
      const depts = RECORDS.budgetEntries.map(e => e.dept).sort();
      assertEqual(JSON.stringify(depts), JSON.stringify(['IT', 'Kinh Doanh']), 'Mỗi phòng ban đúng 1 bản');
    });

    await run.run('Fix 1d — tạo tuần tự (không song song) vẫn bị chặn như cũ, thông báo không đổi', async () => {
      resetRecords();
      const body = { periodId: 5001, lines: goodBudgetLines() };
      const first = await api('POST', '/api/create/budgetEntries', body, BUDGET_KD_1);
      assertEqual(first.status, 200, 'Bản đầu tiên tạo bình thường');
      const second = await api('POST', '/api/create/budgetEntries', body, BUDGET_KD_2);
      assertEqual(second.status, 409, 'Người thứ hai cùng phòng bị chặn');
      assertIncludes(second.body.error, 'vui lòng sửa bản nháp hiện có', 'Giữ nguyên hướng dẫn "sửa bản nháp hiện có"');
      assertEqual(RECORDS.budgetEntries.length, 1, 'Vẫn chỉ 1 bản');
    });

    // =====================================================================================
    // FIX 2a — "Từ chối khẩn cấp" khi còn yêu cầu bổ sung chưa phản hồi
    // =====================================================================================
    await run.run('Fix 2a — requestItPriceEmergencyReject bị CHẶN khi còn yêu cầu bổ sung chưa được phản hồi', async () => {
      const item = makeApprovedPriceItem({ infoRequests: [openInfoRequest()] });
      const err = expectThrows(
        () => recordActions.requestItPriceEmergencyReject(TP_APPROVER, item, { reason: 'Giá sai, cần huỷ gấp' }),
        'Đáng lẽ phải chặn "từ chối khẩn cấp" khi còn yêu cầu bổ sung treo'
      );
      assertEqual(err.status, 409, 'Phải là lỗi 409 (xung đột trạng thái), cùng kiểu applyPriceApproval()');
      assertIncludes(err.message, 'yêu cầu bổ sung chưa được người đề xuất phản hồi',
        'Thông báo phải nói rõ đang vướng yêu cầu bổ sung, khớp văn phong applyPriceApproval()');
      assertEqual(item.emergencyRejectStatus, undefined,
        'KHÔNG được ghi bất kỳ dấu vết yêu cầu từ chối khẩn cấp nào khi đã bị chặn');
      assertEqual((item.history || []).some(h => h.action === 'EMERGENCY_REJECT_REQUEST'), false,
        'KHÔNG được đẩy dòng history EMERGENCY_REJECT_REQUEST khi đã bị chặn');
    });

    await run.run('Fix 2a — yêu cầu bổ sung ĐÃ được phản hồi thì "từ chối khẩn cấp" vẫn gửi được bình thường', async () => {
      const resolved = Object.assign(openInfoRequest(), { response: 'Đã tải lên tệp bổ sung: bg.xlsx', respondedAt: '04/08/2026' });
      const item = makeApprovedPriceItem({ infoRequests: [resolved] });
      recordActions.requestItPriceEmergencyReject(TP_APPROVER, item, { reason: 'Nhà cung cấp báo sai giá' });
      assertEqual(item.emergencyRejectStatus, 'PENDING', 'Yêu cầu từ chối khẩn cấp vẫn phải gửi được (không chặn quá tay)');
      assertEqual(item.emergencyRejectRequestedBy, TP_APPROVER.username, 'Ghi đúng người gửi yêu cầu');
      assert((item.history || []).some(h => h.action === 'EMERGENCY_REJECT_REQUEST'), 'Có dòng history EMERGENCY_REJECT_REQUEST');
    });

    // =====================================================================================
    // FIX 2b — tải tệp bổ sung khi hồ sơ đã bị TỪ CHỐI
    // =====================================================================================
    await run.run('Fix 2b — submitPriceSupplementFile bị CHẶN khi hồ sơ đã ở trạng thái REJECTED', async () => {
      const item = makeApprovedPriceItem({ status: 'REJECTED', infoRequests: [openInfoRequest()] });
      const err = expectThrows(
        () => recordActions.submitPriceSupplementFile(PROPOSER, item, { file: goodSupplementFile() }),
        'Đáng lẽ phải chặn tải tệp bổ sung vào hồ sơ đã bị từ chối'
      );
      assertEqual(err.status, 409, 'Phải là lỗi 409 (xung đột trạng thái)');
      assertIncludes(err.message, 'đã bị từ chối', 'Thông báo phải nói rõ hồ sơ đã bị từ chối');
      assertEqual((item.files || []).length, 0, 'KHÔNG được thêm tệp nào vào hồ sơ đã từ chối');
      assertEqual(item.infoRequests[0].response, null,
        'KHÔNG được "đóng" yêu cầu bổ sung đang treo của hồ sơ đã từ chối');
      assertEqual((item.history || []).some(h => h.action === 'SUBMIT_SUPPLEMENT'), false,
        'KHÔNG được đẩy dòng history SUBMIT_SUPPLEMENT');
    });

    await run.run('Fix 2b — hồ sơ bị REJECTED do "từ chối khẩn cấp" cũng chặn tệp bổ sung (cùng 1 cổng trạng thái)', async () => {
      const item = makeApprovedPriceItem({ infoRequests: [] });
      recordActions.requestItPriceEmergencyReject(TP_APPROVER, item, { reason: 'Sai giá nghiêm trọng' });
      recordActions.approveItPriceEmergencyReject(ADMIN, item);
      assertEqual(item.status, 'REJECTED', 'Từ chối khẩn cấp được duyệt -> hồ sơ REJECTED');
      // Giả lập tình huống còn 1 yêu cầu bổ sung treo từ trước (đủ điều kiện đi tiếp ở bản CHƯA vá).
      item.infoRequests = [openInfoRequest()];
      const err = expectThrows(
        () => recordActions.submitPriceSupplementFile(PROPOSER, item, { file: goodSupplementFile() }),
        'Đáng lẽ phải chặn'
      );
      assertEqual(err.status, 409, 'Phải là lỗi 409');
      assertIncludes(err.message, 'đã bị từ chối', 'Thông báo đúng');
    });

    await run.run('Fix 2b — hồ sơ còn hợp lệ (chưa từ chối) vẫn tải được tệp bổ sung như cũ', async () => {
      const item = makeApprovedPriceItem({ infoRequests: [openInfoRequest()] });
      recordActions.submitPriceSupplementFile(PROPOSER, item, { file: goodSupplementFile() });
      assertEqual(item.files.length, 1, 'Tệp bổ sung phải được thêm vào (không chặn quá tay)');
      assert(!!item.infoRequests[0].response, 'Yêu cầu bổ sung được đánh dấu đã phản hồi');
      assert((item.history || []).some(h => h.action === 'SUBMIT_SUPPLEMENT'), 'Có dòng history SUBMIT_SUPPLEMENT');
    });

    // =====================================================================================
    // FIX 3 — PAYMENT_EDITABLE_FIELDS bỏ 'amount' (dọn dẹp, hành vi KHÔNG đổi)
    // =====================================================================================
    await run.run('Fix 3 — editPaymentRequest: "amount" client gửi LUÔN bị bỏ qua, tổng tiền tính lại từ các đợt', async () => {
      const pr = {
        id: 7100, dept: 'Kinh Doanh', title: 'Thanh toán hợp đồng A', amount: 50000000, status: 'PENDING',
        installments: [{ description: 'Đợt 1', amount: 50000000, dueDate: '', confirmed: false, confirmedAt: null, confirmedBy: null }]
      };
      recordActions.editPaymentRequest({
        title: 'Thanh toán hợp đồng A (sửa)',
        amount: 999999999, // Client cố tình gửi tổng tiền KHÁC tổng các đợt
        installments: [
          { description: 'Đợt 1', amount: 20000000, dueDate: '' },
          { description: 'Đợt 2', amount: 30000000, dueDate: '' }
        ]
      }, ACCOUNTANT, pr);
      assertEqual(pr.amount, 50000000,
        'Tổng tiền PHẢI = Σ các đợt (20tr + 30tr), KHÔNG bao giờ lấy theo "amount" client gửi lên');
      assertEqual(pr.title, 'Thanh toán hợp đồng A (sửa)', 'Các field sửa được khác vẫn nhận bình thường');
      assertEqual(pr.installments.length, 2, 'Các đợt được thay mới đầy đủ');
      assertEqual(pr.status, 'PENDING', 'Sửa xong quay lại hàng chờ duyệt');
    });

    await run.run('Fix 3 — PAYMENT_EDITABLE_FIELDS không còn liệt kê "amount" (tránh hiểu nhầm là sửa được)', async () => {
      // Đọc lại danh sách qua chính hành vi: gửi RIÊNG "amount" (không kèm installments) cũng không đổi
      // được tổng tiền — vì amount luôn được tính lại từ installments hiện có.
      const pr = {
        id: 7101, dept: 'IT', title: 'Thanh toán máy chủ', amount: 40000000, status: 'NEED_INFO',
        installments: [{ description: 'Đợt duy nhất', amount: 40000000, dueDate: '', confirmed: false, confirmedAt: null, confirmedBy: null }]
      };
      recordActions.editPaymentRequest({ amount: 1 }, ACCOUNTANT, pr);
      assertEqual(pr.amount, 40000000, 'Gửi riêng "amount" cũng không đổi được tổng tiền');
      assertEqual(pr.installments.length, 1, 'Các đợt giữ nguyên');
    });

    // =====================================================================================
    // FIX 4 — admin override cho phê duyệt leo thang ticket IT
    // =====================================================================================
    await run.run('Fix 4 — Quản Trị Viên duyệt thay được yêu cầu phê duyệt leo thang (người được chỉ định không còn xử lý được)', async () => {
      const ticket = makeEscalatedTicket();
      recordActions.approveItTicketEscalation(ADMIN, ticket);
      assertEqual(ticket.approvalStatus, 'APPROVED',
        'Admin PHẢI duyệt thay được — nếu không, ticket leo thang cho người đã nghỉ việc kẹt vĩnh viễn ở PENDING');
      assert((ticket.comments || []).some(c => c.username === ADMIN.username),
        'Ghi lại dấu vết ai là người thực sự bấm duyệt');
    });

    await run.run('Fix 4 — Quản Trị Viên cũng từ chối thay được yêu cầu phê duyệt leo thang', async () => {
      const ticket = makeEscalatedTicket();
      recordActions.denyItTicketEscalation(ADMIN, ticket, { comment: 'Chi phí vượt hạn mức, không duyệt' });
      assertEqual(ticket.approvalStatus, 'REJECTED', 'Admin từ chối thay được');
      assertEqual(ticket.approvalComment, 'Chi phí vượt hạn mức, không duyệt', 'Lý do từ chối được ghi lại');
    });

    await run.run('Fix 4 — người KHÔNG phải admin và KHÔNG được chỉ định vẫn bị chặn (không nới lỏng quá tay)', async () => {
      const ticket = makeEscalatedTicket();
      const err1 = expectThrows(() => recordActions.approveItTicketEscalation(OUTSIDER, ticket), 'Đáng lẽ phải chặn');
      assertEqual(err1.status, 403, 'Người ngoài cuộc (kể cả có itManage) không duyệt được');
      assertIncludes(err1.message, 'không phải người được yêu cầu phê duyệt', 'Giữ nguyên thông báo cũ');
      const err2 = expectThrows(() => recordActions.denyItTicketEscalation(OUTSIDER, ticket, { comment: 'x' }), 'Đáng lẽ phải chặn');
      assertEqual(err2.status, 403, 'Người ngoài cuộc cũng không từ chối được');
      assertEqual(ticket.approvalStatus, 'PENDING', 'Trạng thái không đổi sau 2 lần bị chặn');
    });

    await run.run('Fix 4 — đúng người được chỉ định vẫn duyệt được như trước', async () => {
      const ticket = makeEscalatedTicket();
      ticket.approvalApprover = TP_APPROVER.username;
      ticket.approvalApproverName = TP_APPROVER.name;
      recordActions.approveItTicketEscalation(TP_APPROVER, ticket);
      assertEqual(ticket.approvalStatus, 'APPROVED', 'Người được chỉ định duyệt bình thường');
    });

    // =====================================================================================
    // FIX 5 — kiểm tra lại period.deptScope lúc SỬA/GỬI ngân sách
    // =====================================================================================
    await run.run('Fix 5 — updateBudgetEntryDraft bị CHẶN khi phòng ban đã bị gỡ khỏi phạm vi kỳ', async () => {
      const item = makeDraftBudgetEntry();
      const period = makeOpenPeriod();
      period.deptScope = { all: false, depts: ['IT'] }; // Kinh Doanh đã bị gỡ khỏi phạm vi
      const err = expectThrows(
        () => recordActions.updateBudgetEntryDraft(BUDGET_KD_1, item, { lines: goodBudgetLines() }, period, []),
        'Đáng lẽ phải chặn sửa khi phòng ban ngoài phạm vi kỳ'
      );
      assertEqual(err.status, 403, 'Phải là 403, đúng kiểu lỗi phạm vi lúc TẠO (lib/createValidation.js)');
      assertIncludes(err.message, 'không thuộc phạm vi kỳ ngân sách này',
        'Dùng đúng thông báo của bản kiểm tra lúc TẠO để giao diện/nghiệp vụ nhất quán');
      assertEqual(item.lines.length, 1, 'Nội dung bản nháp KHÔNG được sửa đổi khi đã bị chặn');
    });

    await run.run('Fix 5 — submitBudgetEntry bị CHẶN khi phòng ban đã bị gỡ khỏi phạm vi kỳ', async () => {
      const item = makeDraftBudgetEntry();
      const period = makeOpenPeriod();
      period.deptScope = { all: false, depts: ['IT'] };
      const err = expectThrows(
        () => recordActions.submitBudgetEntry(BUDGET_KD_1, item, period),
        'Đáng lẽ phải chặn gửi khi phòng ban ngoài phạm vi kỳ'
      );
      assertEqual(err.status, 403, 'Phải là 403');
      assertIncludes(err.message, 'không thuộc phạm vi kỳ ngân sách này', 'Thông báo nhất quán với lúc TẠO');
      assertEqual(item.status, 'DRAFT', 'Bản nháp KHÔNG được đẩy sang PENDING');
      assertEqual((item.history || []).length, 0, 'KHÔNG được ghi dòng history SUBMITTED');
    });

    await run.run('Fix 5 — Quản Trị Viên cũng bị chặn (phạm vi kỳ là luật DỮ LIỆU, không phải luật quyền hạn)', async () => {
      const item = makeDraftBudgetEntry();
      item.dept = ADMIN.dept; // để qua được cổng "chỉ sửa ngân sách của phòng mình"
      const period = makeOpenPeriod(); // deptScope = Kinh Doanh + IT, không có Ban Giám Đốc
      const err = expectThrows(
        () => recordActions.submitBudgetEntry(ADMIN, item, period),
        'Đáng lẽ phải chặn — lúc TẠO admin cũng bị chặn y hệt (createValidation.js không có lối thoát admin ở kiểm tra deptScope)'
      );
      assertEqual(err.status, 403, 'Phải là 403');
      assertIncludes(err.message, 'không thuộc phạm vi kỳ ngân sách này', 'Thông báo nhất quán');
    });

    await run.run('Fix 5 — phòng ban CÒN trong phạm vi thì sửa/gửi vẫn chạy bình thường (không chặn quá tay)', async () => {
      const item = makeDraftBudgetEntry();
      const period = makeOpenPeriod(); // Kinh Doanh vẫn trong phạm vi
      recordActions.updateBudgetEntryDraft(BUDGET_KD_1, item, { lines: goodBudgetLines() }, period, []);
      assertEqual(item.lines.length, 2, 'Sửa bản nháp thành công, nhận đủ 2 dòng ngân sách mới');
      recordActions.submitBudgetEntry(BUDGET_KD_1, item, period);
      assertEqual(item.status, 'PENDING', 'Gửi thành công -> vào quy trình duyệt');
      assertEqual(item.currentStep, 1, 'Bắt đầu lại từ bước 1');
      assert((item.history || []).some(h => h.action === 'SUBMITTED'), 'Có dòng history SUBMITTED');
    });

    await run.run('Fix 5 — kỳ có deptScope.all = true thì MỌI phòng ban đều sửa/gửi được', async () => {
      const item = makeDraftBudgetEntry();
      const period = makeOpenPeriod();
      period.deptScope = { all: true, depts: [] };
      recordActions.updateBudgetEntryDraft(BUDGET_KD_1, item, { lines: goodBudgetLines() }, period, []);
      recordActions.submitBudgetEntry(BUDGET_KD_1, item, period);
      assertEqual(item.status, 'PENDING', 'deptScope.all phải cho qua mọi phòng ban');
    });

    await run.run('Fix 5 — kiểm tra phạm vi chạy TRƯỚC/ĐỘC LẬP với kiểm tra kỳ đã đóng (không thay thế lẫn nhau)', async () => {
      const item = makeDraftBudgetEntry();
      const period = makeOpenPeriod();
      period.status = 'CLOSED';
      const err = expectThrows(() => recordActions.submitBudgetEntry(BUDGET_KD_1, item, period), 'Đáng lẽ phải chặn');
      assertEqual(err.status, 409, 'Kỳ đã đóng vẫn phải trả 409 như cũ (bản vá phạm vi không được nuốt mất lỗi này)');
      assertIncludes(err.message, 'đã kết thúc', 'Giữ nguyên thông báo "kỳ đã kết thúc"');
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-audit-round2-cluster3.js:', err);
  process.exitCode = 1;
});
