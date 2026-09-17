// server/tests/test-payment-source-race.js
//
// Regression test cho race condition ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026) ở
// POST /api/records/contracts/:id/start-payment (và mirror ở /officeReqs/:id/start-payment,
// /paymentRequests/from-source — cùng 1 lỗi, cùng 1 cách vá): allPaymentRequests trước đây đọc TRƯỚC
// khi khoá hợp đồng nguồn — hasActivePaymentRequestForSource() (lib/recordActions.js) chỉ chặn "đang có
// 1 chu kỳ thanh toán chưa PAID" dựa vào SNAPSHOT đã đọc từ trước, không có khoá nào bọc quanh toàn bộ
// đọc-kiểm tra-ghi. 2 request "Chuyển Sang Thanh Toán" cho CÙNG 1 hợp đồng gửi gần như đồng thời (double-
// click, hoặc 2 kế toán viên cùng bấm) đều có thể đọc snapshot "chưa có đề nghị nào", đều qua được
// hasActivePaymentRequestForSource()===false, đều tạo 1 đề nghị DRAFT riêng cùng trỏ về 1 hợp đồng — vi
// phạm bất biến "1 chu kỳ thanh toán/nguồn tại 1 thời điểm".
// Đã vá: bọc withAppLock(`payment_source:CONTRACT:<id>`, ...) quanh TOÀN BỘ đọc allPaymentRequests +
// khoá dòng hợp đồng + tạo bản ghi (routes/records.js).
//
// Test này gọi thẳng router THẬT (routes/records.js) với lib/recordStore giả lập bằng 1 hàng đợi mutex
// THẬT theo lockKey (mirror ĐÚNG khuôn withFakeAppLock() ở tests/test-audit-budgetlines-race.js) + 1 cửa
// sổ "nhường lượt" (setTimeout) chèn giữa đọc allPaymentRequests và bước tạo bản ghi, để buộc 2 request
// bắn GẦN NHƯ ĐỒNG THỜI (Promise.all) phải thực sự tranh chấp cùng 1 cửa sổ thời gian — nếu bản vá bị
// hoàn tác (bỏ withAppLock), test này sẽ FAIL (phát hiện 2 đề nghị thanh toán cùng trỏ 1 nguồn).
//
// Chạy: node server/tests/test-payment-source-race.js
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
const KETOAN2 = { username: 'ketoan2', name: 'Kế Toán 2', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const USERS = [ADMIN, KETOAN2];

let RECORDS = { contracts: [], paymentRequests: [] };
function makeReadyContract() {
  return {
    id: 8001, code: 'HD-RACE-01', dept: 'Phòng Kinh Doanh', custodianDept: 'Phòng Kinh Doanh',
    title: 'Hợp đồng test race condition', amount: 100000000, paymentType: 'ONE_TIME',
    approvalStatus: 'APPROVED', currentStep: 1, history: [],
    signedFileUrl: '/uploads/fake-signed.pdf', signedFileStatus: 'APPROVED', signedFileCurrentStep: 1, signedFileHistory: [],
    paymentStatus: 'CHUA_THANH_TOAN'
  };
}
function resetRecords() {
  RECORDS = { contracts: [makeReadyContract()], paymentRequests: [] };
}
resetRecords();

// ===== Hàng đợi mutex THẬT theo lockKey (mirror withFakeAppLock() ở test-audit-budgetlines-race.js) =====
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

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['contracts', 'paymentRequests']),
  // Cửa sổ đọc-rồi-ghi CỐ Ý chèn NGAY SAU khi đọc allPaymentRequests — đúng điểm hasActivePaymentRequestForSource()
  // đã snapshot xong nhưng CHƯA kịp ghi gì — nhường lượt cho request song song chen vào đúng lúc đó nếu
  // không có khoá chung bọc quanh.
  getAllForCollection: async (c) => {
    const snapshot = (RECORDS[c] || []).slice();
    if (c === 'paymentRequests') await yieldTurn();
    return snapshot;
  },
  createForCollection: async (c, builderFn) => {
    const record = await builderFn((RECORDS[c] || []).slice());
    RECORDS[c].push(record);
    return record;
  },
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy hồ sơ'); }
    const updated = await mutatorFn(list[idx]);
    list[idx] = updated;
    return updated;
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

    // Bắn GẦN NHƯ ĐỒNG THỜI: 2 kế toán viên khác nhau cùng bấm "Chuyển Sang Thanh Toán" cho ĐÚNG 1 hợp
    // đồng — cả 2 đều đọc snapshot "chưa có đề nghị nào" nếu không có khoá chung.
    const [r1, r2] = await Promise.all([
      api(server, 'POST', '/api/records/contracts/8001/start-payment', {}, ADMIN),
      api(server, 'POST', '/api/records/contracts/8001/start-payment', {}, KETOAN2)
    ]);

    const paymentRequestsForContract = RECORDS.paymentRequests.filter(pr => pr.sourceModule === 'CONTRACT' && pr.sourceId === 8001);

    check('KHÔNG được tạo 2 đề nghị thanh toán cùng trỏ về 1 hợp đồng (LỖI ĐÃ VÁ — race condition)',
      paymentRequestsForContract.length === 1,
      { r1Status: r1.status, r2Status: r2.status, paymentRequestsForContract });

    const bothSucceeded = r1.status === 200 && r2.status === 200;
    check('KHÔNG được cả 2 request "Chuyển Sang Thanh Toán" cùng thành công (loại trừ nhau)',
      !bothSucceeded, { r1Status: r1.status, r2Status: r2.status });

    const failed = r1.status === 200 ? r2 : r1;
    check('Request thua cuộc phải bị chặn 409 với đúng lý do "đang có đề nghị thanh toán chưa hoàn tất"',
      failed.status === 409 && /đề nghị thanh toán/.test(failed.body?.error || ''),
      failed.body);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
