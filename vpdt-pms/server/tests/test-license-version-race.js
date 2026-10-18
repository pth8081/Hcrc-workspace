// server/tests/test-license-version-race.js
//
// Re-audit lần 6 (mức Trung Bình — "licenses tạo phiên bản mới thiếu getLockKey"): finding ban đầu cho
// rằng CREATE_MODULE_CONFIGS.licenses (lib/createValidation.js) không có `getLockKey` nên 2 request tạo
// PHIÊN BẢN MỚI (rootLicenseId != null) gần như đồng thời có thể cùng đọc "bản mới nhất" giống nhau ->
// cùng versionNumber/code -> 1 trong 2 bị DB UNIQUE INDEX từ chối với lỗi constraint khó hiểu thay vì
// thông báo nghiệp vụ rõ ràng.
//
// ĐIỀU TRA: licenses KHÔNG có `getLockKey` thật, nhưng routes/create.js đã có cơ chế khoá RIÊNG cho
// đúng trường hợp này từ trước — `familyLockKey` (xem routes/create.js, ~dòng 397-411): khi
// `moduleKey === 'licenses' && req.body.rootLicenseId != null`, request đi qua
// `withAppLock('license_family:<rootId>', () => createForCollection(...))` — khoá NGHIÊM TÚC
// (sp_getapplock, cấp Transaction, cùng cơ chế createForCollectionSerialized) bọc quanh TOÀN BỘ chuỗi
// đọc "family" (lib/createValidation.js licenses.extraValidate đọc `collection` NGAY TRONG builderFn,
// chạy SAU khi khoá đã giữ) - kiểm tra "bản mới nhất còn PENDING?" - ghi phiên bản mới, đúng khuôn
// createForCollectionSerialized() (lib/recordStore.js) dùng cho meetings/vppRegistrations... CHỈ khác
// là khoá quấn QUANH createForCollection() thường (dbKey licenses là DEDICATED_TABLES, vốn không tự
// khoá gì) thay vì bên TRONG recordStore.
//
// Test này xác nhận THẬT (không chỉ suy luận tĩnh) bằng race THẬT (hàng đợi mutex theo lockKey, mirror
// khuôn tests/test-offboarding-duplicate-process-race.js/test-onboarding-nationalid-race.js) — gọi
// thẳng router THẬT routes/create.js: 2 request tạo phiên bản mới gần như đồng thời cho CÙNG 1 giấy
// phép gốc KHÔNG được cả 2 cùng thành công, và request thua cuộc phải nhận lỗi NGHIỆP VỤ RÕ RÀNG (409
// "đang chờ duyệt"), không phải lỗi DB thô — xác nhận familyLockKey đã đủ vá đúng lớp lỗi mà finding
// nêu, không cần thêm getLockKey riêng (tránh 2 lớp khoá trùng lặp không cần thiết).
//
// Chạy: node server/tests/test-license-version-race.js
'use strict';

const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

const HC1 = { username: 'hc1', name: 'Hành Chính 1', dept: 'Hành Chính', perms: { licenseCreate: true }, active: true };
const HC2 = { username: 'hc2', name: 'Hành Chính 2', dept: 'Hành Chính', perms: { licenseCreate: true, admin: true }, active: true };
const APPROVER = { username: 'approver1', name: 'Người Duyệt Giấy Phép', dept: 'Ban Giám Đốc', perms: { licenseApprove: true }, active: true };
const USERS = [HC1, HC2, APPROVER];

stubModule('lib/appData', {
  getAllAppData: async () => ({ users: USERS, depts: ['Hành Chính', 'Ban Giám Đốc'], stores: [], formTemplates: {}, deptAbbrs: {} }),
  getAppDataValue: async () => null,
  withLockedAppDataValue: async (key, fn) => fn(null)
});

// ===== Hàng đợi mutex THẬT theo lockKey (mirror withFakeLock() ở test-offboarding-duplicate-process-race.js) =====
const lockChains = new Map();
async function withFakeLock(lockKey, fn) {
  const prev = lockChains.get(lockKey) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  lockChains.set(lockKey, prev.then(() => current));
  await prev;
  try { return await fn(); } finally { release(); }
}
const DELAY_MS = 20;
function yieldTurn() { return new Promise((resolve) => setTimeout(resolve, DELAY_MS)); }

let RECORDS;
let nextId = 1;
function resetRecords() { RECORDS = { licenses: [] }; nextId = 1; lockChains.clear(); }
resetRecords();

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['licenses']),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  getTrashItems: async () => [],
  // Mirror ĐÚNG createForCollection() thật cho collection DEDICATED_TABLES (licenses): KHÔNG tự khoá gì
  // — đọc "existing" fresh rồi gọi builderFn rồi push, đúng như lib/recordStore.js thật. An toàn ở đây
  // CHỈ nhờ withAppLock(familyLockKey, ...) ở routes/create.js bọc NGOÀI lời gọi này.
  //
  // QUAN TRỌNG để test này thật sự lộ race khi KHÔNG có khoá ngoài: đọc "existing" NGAY (snapshot tại
  // đúng thời điểm gọi — mirror SELECT thật của getAllDedicatedRecords()), rồi MỚI `await yieldTurn()`
  // (mirror round-trip mạng/transaction thật của DB) TRƯỚC KHI gọi builderFn — 2 lời gọi gần như đồng
  // thời đều đọc CÙNG 1 snapshot "cũ" (chưa thấy bản ghi của nhau) trong lúc cùng chờ, đúng y hệt race
  // thật ở SQL Server (2 transaction SERIALIZABLE/READ COMMITTED riêng biệt). Gộp đọc+chờ vào 1 bước
  // (không chờ TRƯỚC khi đọc) mới phản ánh đúng race — bản đầu (đã sửa) chờ trước khi đọc nên vô tình
  // không bao giờ lộ race (builderFn không có await thật nào để nhường lượt giữa đọc và ghi).
  createForCollection: async (c, builderFn) => {
    const existing = (RECORDS[c] || []).slice();
    await yieldTurn();
    const draft = await builderFn(existing);
    const record = Object.assign({ id: nextId++ }, draft);
    RECORDS[c] = RECORDS[c] || []; RECORDS[c].push(record);
    return record;
  },
  createForCollectionSerialized: async (c, lockKey, builderFn) => withFakeLock(`record:${lockKey}`, async () => {
    await yieldTurn();
    const draft = await builderFn((RECORDS[c] || []).slice());
    const record = Object.assign({ id: nextId++ }, draft);
    RECORDS[c] = RECORDS[c] || []; RECORDS[c].push(record);
    return record;
  }),
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    list[idx] = await mutatorFn(list[idx]);
    return list[idx];
  },
  withAppLock: async (key, fn) => withFakeLock(`applock:${key}`, fn)
});

stubModule('lib/uploadedFiles', { assertPayloadFileUrlsOwnedByUser: async () => {} });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {}, querySystemLogs: async () => ({ items: [], total: 0 }) });
stubModule('lib/notifications', { notifyUsers: async () => {} });

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const username = req.headers['x-test-user'];
    const fresh = USERS.find((u) => u.username === username);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const createRoutes = require('../routes/create');

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function api(server, method, urlPath, body, asUser) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: Object.assign({ 'x-test-user': asUser.username }, body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let payload = null; try { payload = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, body: payload };
}

function licensePayload(overrides) {
  return Object.assign({
    companyName: 'Công ty TNHH HCRC', locationName: 'Chi nhánh Hội An', operatingStatus: 'ACTIVE',
    licenseType: 'Giấy phép kinh doanh', licenseNumber: 'GPKD-001/2026',
    issueDate: '2026-01-01', expiryDate: '2027-01-01', issuingAuthority: 'Sở KH&ĐT Quảng Nam',
    fileUrl: '/uploads/giay-phep.pdf'
  }, overrides || {});
}

async function main() {
  const server = await startApp();
  try {
    resetRecords();

    // Tạo giấy phép GỐC rồi tự "duyệt" (giả lập) để latest.status !== 'PENDING' — mở khoá cho phép tạo
    // phiên bản mới (đúng điều kiện licenses.extraValidate chặn: "Không thể cập nhật khi phiên bản mới
    // nhất... đang chờ duyệt").
    const rootRes = await api(server, 'POST', '/api/create/licenses', licensePayload(), HC1);
    check('tạo giấy phép GỐC thành công', rootRes.status === 200, rootRes.body);
    const rootId = rootRes.body?.item?.id;
    RECORDS.licenses[0].status = 'APPROVED';

    // Bắn GẦN NHƯ ĐỒNG THỜI: 2 request tạo PHIÊN BẢN MỚI cho CÙNG 1 giấy phép gốc (1 từ chính người tạo
    // HC1, 1 từ HC2 — admin cũng có quyền tạo version theo đúng luật root.creator/admin).
    const [ra, rb] = await Promise.all([
      api(server, 'POST', '/api/create/licenses', licensePayload({ rootLicenseId: rootId }), HC1),
      api(server, 'POST', '/api/create/licenses', licensePayload({ rootLicenseId: rootId }), HC2)
    ]);
    const bothSucceeded = ra.status === 200 && rb.status === 200;
    check('familyLockKey (license_family) đã đủ vá: KHÔNG được cả 2 request tạo phiên bản mới CÙNG LÚC cùng thành công',
      !bothSucceeded, { raStatus: ra.status, rbStatus: rb.status, raBody: ra.body, rbBody: rb.body });

    const winner = ra.status === 200 ? ra : rb;
    const loser = ra.status === 200 ? rb : ra;
    check('request thắng tạo được ĐÚNG 1 phiên bản mới (versionNumber=2)', winner.status === 200 && winner.body?.item?.versionNumber === 2, winner.body);
    check('LỖI ĐÃ VÁ (đúng như finding mô tả): request THUA phải nhận lỗi NGHIỆP VỤ RÕ RÀNG (409 "đang chờ duyệt"), KHÔNG phải lỗi DB thô/500',
      loser.status === 409 && /chờ duyệt/.test(loser.body?.error || ''), loser.body);
    check('chỉ ĐÚNG 1 phiên bản mới (versionNumber=2) được tạo cho family này — không có bản ghi trùng/mồ côi',
      RECORDS.licenses.filter(l => l.rootLicenseId === rootId).length === 1, RECORDS.licenses);
    check('mã (code) của phiên bản mới là DUY NHẤT trong toàn collection', new Set(RECORDS.licenses.map(l => l.code)).size === RECORDS.licenses.length, RECORDS.licenses.map(l => l.code));

    resetRecords();
    // Đối chứng: 2 giấy phép GỐC khác nhau (rootLicenseId == null cho cả 2) vẫn tạo đồng thời bình
    // thường, không bị khoá chung "vô tình" chặn nhầm (familyLockKey chỉ áp dụng khi rootLicenseId != null).
    const [rc, rd] = await Promise.all([
      api(server, 'POST', '/api/create/licenses', licensePayload({ licenseNumber: 'GPKD-002/2026' }), HC1),
      api(server, 'POST', '/api/create/licenses', licensePayload({ licenseNumber: 'GPKD-003/2026' }), HC2)
    ]);
    check('2 giấy phép GỐC khác nhau vẫn tạo đồng thời bình thường (không bị khoá chung chặn nhầm)',
      rc.status === 200 && rd.status === 200 && RECORDS.licenses.length === 2,
      { rcStatus: rc.status, rdStatus: rd.status, count: RECORDS.licenses.length });
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  if (fail) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
