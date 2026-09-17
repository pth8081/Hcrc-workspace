// server/tests/test-audit-budgetlines-race.js
//
// Regression test cho lỗ hổng TOCTOU đã vá (đợt rà soát chuyên sâu 9/2026, "Ngân Sách 2.0" — budgetLines):
// POST /api/records/budgetLines/:id/used-parent-delete kiểm tra "chưa có mục con nào" bằng 1 snapshot
// KHÔNG khoá (getAllForCollection), rồi mới xoá — trong lúc đó POST .../children (thêm mục con) có thể
// chen vào (route đó CŨNG đọc snapshot không khoá trước khi tạo con), khiến mục con vừa tạo trỏ
// parentId vào 1 dòng cha đã bị xoá ("mồ côi", biến mất khỏi tab Sử Dụng dù dữ liệu vẫn còn trong DB).
// Đã vá: bọc CẢ 2 route bằng withAppLock cùng khoá `budget_line_used_parent:<id cha>` (lib/recordStore.js)
// — 2 request chạm cùng 1 dòng cha giờ LUÔN tuần tự.
//
// Test này gọi thẳng router THẬT (routes/records.js) với lib/recordStore giả lập bằng 1 hàng đợi mutex
// THẬT theo lockKey (mirror đúng khuôn withFakeAppLock() ở tests/test-audit-round2-cluster3.js — hàng đợi
// promise thật, không phải sp_getapplock thật vì môi trường test không có SQL Server) + 1 cửa sổ "nhường
// lượt" (setTimeout) chèn giữa đọc-và-ghi ở CẢ đường tạo con lẫn đường xoá cha, để buộc 2 request bắn
// GẦN NHƯ ĐỒNG THỜI (Promise.all) phải thực sự tranh chấp cùng 1 cửa sổ thời gian thay vì may rủi lịch
// chạy — nếu bản vá bị hoàn tác (bỏ withAppLock ở 1 trong 2 route), test này sẽ FAIL (phát hiện mục con
// mồ côi).
//
// Chạy: node server/tests/test-audit-budgetlines-race.js
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

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const BUDGET_MGR = { username: 'ns_mgr', name: 'Quản Lý Ngân Sách', dept: 'Kinh Doanh', perms: { budgetManage: true }, active: true };
const USERS = [ADMIN, BUDGET_MGR];

let RECORDS = { budgetLines: [] };
function makeUsedParent() {
  return {
    id: 9001, stage: 'USED', parentId: null, sourceLineId: 9000,
    dept: 'Kinh Doanh', content: 'Chi phí tiếp khách Q4', description: '', itemCategory: 'SERVICE',
    budgetType: 'OPEX', budgetYear: 2026, budgetMonth: 10, totalAmount: 10000000, usageStatus: 'NOT_USED'
  };
}
function makeApprovedSource() {
  return { id: 9000, stage: 'APPROVED', parentId: null, status: 'USED', dept: 'Kinh Doanh', totalAmount: 10000000 };
}
function resetRecords() {
  RECORDS = { budgetLines: [makeApprovedSource(), makeUsedParent()] };
}
resetRecords();

// ===== Hàng đợi mutex THẬT theo lockKey (mirror withFakeAppLock() ở test-audit-round2-cluster3.js) =====
const lockChains = new Map();
async function withFakeAppLock(lockKeyOrKeys, fn) {
  const keys = Array.isArray(lockKeyOrKeys) ? lockKeyOrKeys : [lockKeyOrKeys];
  for (const key of keys) {
    const prev = lockChains.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    lockChains.set(key, prev.then(() => current));
    await prev;
    try { return await fn(); } finally { release(); }
  }
}
const DELAY_MS = 25;
function yieldTurn() { return new Promise((resolve) => setTimeout(resolve, DELAY_MS)); }

stubModule('lib/appData', {
  getAppDataValue: async () => null,
  getAllAppData: async () => ({ users: USERS }),
  withLockedAppDataValue: async (key, fn) => fn([])
});
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['budgetLines']),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  createForCollection: async (c, builderFn) => {
    const existing = (RECORDS[c] || []).slice();
    await yieldTurn(); // cửa sổ đọc-rồi-ghi — nhường lượt cho request song song chen vào ĐÚNG chỗ này
    const record = await builderFn(existing);
    RECORDS[c].push(record);
    return record;
  },
  withLockedRecordForCollection: async (c, id, mutatorFn, opts) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy hồ sơ'); }
    const children = opts && opts.childrenByColumn ? list.filter((x) => x.parentId === id) : undefined;
    const updated = children !== undefined ? await mutatorFn(list[idx], children) : await mutatorFn(list[idx]);
    list[idx] = updated;
    return updated;
  },
  deleteRecordForCollection: async (c, id, checkFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy hồ sơ'); }
    if (checkFn) await checkFn(list[idx]);
    await yieldTurn(); // cửa sổ kiểm tra-rồi-xoá — nhường lượt cho request song song chen vào ĐÚNG chỗ này
    list.splice(idx, 1);
  },
  withAppLock: async (key, fn) => withFakeAppLock(key, fn)
});
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
const recordsRoutes = require('../routes/records');

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordsRoutes);
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
    headers: { 'Content-Type': 'application/json', 'x-test-user': asUser.username },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function main() {
  const server = await startApp();
  try {
    resetRecords();

    // Bắn GẦN NHƯ ĐỒNG THỜI: 1 request thêm mục con Sử Dụng vào dòng cha 9001, 1 request xoá CHÍNH dòng
    // cha đó — cả 2 đều đọc snapshot "chưa có mục con nào" nếu không có khoá chung.
    const [addResult, deleteResult] = await Promise.all([
      api(server, 'POST', '/api/records/budgetLines/9001/children', { quantity: 1, unitPrice: 5000000, budgetType: 'OPEX', purchaseMonth: 10, note: 'Mua quà tặng khách hàng' }, BUDGET_MGR),
      api(server, 'POST', '/api/records/budgetLines/9001/used-parent-delete', {}, BUDGET_MGR)
    ]);

    const finalList = RECORDS.budgetLines;
    const parentStillExists = finalList.some((x) => x.id === 9001);
    const orphanedChild = finalList.find((x) => x.parentId === 9001 && !parentStillExists);

    check('KHÔNG có mục con nào bị "mồ côi" (parentId trỏ vào dòng cha đã bị xoá) — LỖI ĐÃ VÁ',
      !orphanedChild, { addStatus: addResult.status, deleteStatus: deleteResult.status, finalList });

    // Đúng 1 trong 2 phải thành công, phía còn lại phải bị chặn hợp lý (409 "đã có mục con" hoặc 404
    // "không tìm thấy" nếu cha đã bị xoá trước) — KHÔNG được cả 2 cùng "thành công" (đó chính là kịch bản
    // sinh ra mục con mồ côi).
    const bothSucceeded = addResult.status === 200 && deleteResult.status === 200;
    check('KHÔNG được cả "thêm mục con" LẪN "xoá dòng cha" cùng thành công (2 thao tác loại trừ nhau)',
      !bothSucceeded, { addStatus: addResult.status, deleteStatus: deleteResult.status });

    if (addResult.status === 200) {
      check('Nếu thêm mục con thành công trước -> xoá dòng cha sau đó phải bị chặn 409 (đã có mục con)',
        deleteResult.status === 409, deleteResult.body);
      check('Dòng cha vẫn còn tồn tại (không bị xoá) khi đã có mục con', parentStillExists);
    } else {
      check('Nếu xoá dòng cha thành công trước -> thêm mục con sau đó phải bị chặn 404 (không tìm thấy dòng cha)',
        addResult.status === 404, addResult.body);
      check('Dòng cha đã bị xoá đúng như mong đợi', !parentStillExists);
    }
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
