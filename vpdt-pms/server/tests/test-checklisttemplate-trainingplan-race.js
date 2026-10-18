// server/tests/test-checklisttemplate-trainingplan-race.js
//
// Re-audit lần 4 (mức Trung Bình): checklistTemplates/trainingPlans KHÔNG có getLockKey nên đi qua
// createForCollection() thường (không khoá) — mỗi collection đều có 1 check trùng dựa trên SNAPSHOT đọc
// TRƯỚC khi ghi (templateCode cho checklistTemplates, dupKey Tháng+Chương Trình+Đơn Vị cho trainingPlans):
//   - checklistTemplates: `if ((collection || []).some(t => t.templateCode === core.templateCode))` ->
//     409 "Mã checklist ... đã tồn tại".
//   - trainingPlans: `if (dupKey && (collection || []).some(p => trainingPlanDedupKey(p) === dupKey))` ->
//     409 "Đã có dòng kế hoạch đào tạo ...".
// 2 request tạo MỚI gần như đồng thời, CÙNG khoá so trùng, đều đọc được collection "chưa có gì trùng"
// TRƯỚC khi cái nào kịp ghi — cả 2 đều qua được check rồi cùng tạo, vi phạm đúng bất biến mà check đó
// định bảo vệ.
//
// Đã vá: thêm getLockKey cho CẢ 2 (CREATE_MODULE_CONFIGS, lib/createValidation.js) — routes/create.js tự
// động chuyển sang createForCollectionSerialized() (sp_getapplock, lib/recordStore.js).
//
// Test này gọi thẳng router THẬT (routes/create.js) với lib/recordStore giả lập bằng 1 hàng đợi mutex
// THẬT theo lockKey + 1 cửa sổ "nhường lượt" chèn giữa đọc collection và bước tạo bản ghi — cùng khuôn
// test-operation-order-po-race.js.
//
// Chạy: node server/tests/test-checklisttemplate-trainingplan-race.js
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

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Phòng IT', perms: { admin: true }, active: true };
const ADMIN2 = { username: 'admin2', name: 'Quản Trị Viên 2', dept: 'Phòng IT', perms: { admin: true }, active: true };
const USERS = [ADMIN, ADMIN2];

const TRAINING_COURSES = [{ id: 1, name: 'Chương Trình A' }];

let RECORDS;
function resetRecords() {
  RECORDS = { checklistTemplates: [], trainingPlans: [] };
}
resetRecords();

// ===== Hàng đợi mutex THẬT theo lockKey (mirror test-operation-order-po-race.js) =====
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
  getAllAppData: async () => ({
    users: USERS,
    depts: ['Phòng IT'], stores: ['Siêu Thị A']
  }),
  withLockedAppDataValue: async (key, fn) => fn([])
});
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['checklistTemplates', 'trainingPlans']),
  getAllForCollection: async (c) => {
    if (c === 'trainingCourses') return TRAINING_COURSES.slice();
    return (RECORDS[c] || []).slice();
  },
  getTrashItems: async () => [],
  // CỐ Ý chèn cùng 1 cửa sổ "nhường lượt" (yieldTurn) giữa đọc snapshot và ghi — mirror đúng khoảng
  // thời gian round-trip DB THẬT giữa đọc và ghi (SELECT rồi INSERT, không phải 1 lệnh atomic) — nếu
  // không có cửa sổ này, 2 request trong Promise.all rất dễ chạy hết lượt của request 1 (đọc-kiểm tra-
  // ghi) trước khi request 2 kịp bắt đầu đọc (do KHÔNG có await nào đủ "tốn thời gian" để nhường lượt
  // thật), khiến test không bao giờ thực sự dựng lại được cửa sổ đua — SAI dù chưa vá, kể cả không có
  // getLockKey nào ở route. Khác createForCollectionSerialized() ở dưới (CÓ khoá bọc quanh qua
  // withFakeAppLock): nhánh này KHÔNG khoá gì — đúng hành vi CŨ (chưa vá) của createForCollection() thật.
  createForCollection: async (c, builderFn) => {
    const existing = (RECORDS[c] || []).slice();
    await yieldTurn();
    const record = await builderFn(existing);
    RECORDS[c].push(record);
    return record;
  },
  // Cửa sổ đọc-rồi-ghi CỐ Ý chèn NGAY SAU khi khoá được cấp (mirror đúng chỗ createForCollectionSerialized
  // thật đọc collection RỒI mới await builderFn ghi) — nhường lượt cho request song song thứ 2 chờ đúng
  // lúc này nếu KHÔNG có khoá chung bọc quanh (bản vá bị hoàn tác).
  createForCollectionSerialized: (c, lockKey, builderFn) => withFakeAppLock(lockKey, async () => {
    const existing = (RECORDS[c] || []).slice();
    await yieldTurn();
    const record = await builderFn(existing);
    RECORDS[c].push(record);
    return record;
  }),
  withAppLock: async (key, fn) => withFakeAppLock(key, fn)
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
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
    headers: { 'Content-Type': 'application/json', 'x-test-user': asUser.username },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

function checklistTemplatePayload(overrides) {
  return Object.assign({
    templateCode: 'CL_RACE_001', templateName: 'Checklist Race Test', templateType: 'STORE_SELF',
    questions: [{ text: 'Câu 1', options: [{ text: 'Đạt', isPassing: true }, { text: 'Không đạt', isPassing: false }] }]
  }, overrides);
}

function trainingPlanPayload(overrides) {
  return Object.assign({ month: '2026-09', courseId: 1, targetDept: 'Phòng IT' }, overrides);
}

async function main() {
  const server = await startApp();
  try {
    // ===== checklistTemplates: 2 request CÙNG templateCode gần như đồng thời =====
    resetRecords();
    const [c1, c2] = await Promise.all([
      api(server, 'POST', '/api/create/checklistTemplates', checklistTemplatePayload(), ADMIN),
      api(server, 'POST', '/api/create/checklistTemplates', checklistTemplatePayload(), ADMIN2)
    ]);
    check('checklistTemplates: KHÔNG được tạo 2 mẫu cùng templateCode (LỖI ĐÃ VÁ — race condition)',
      RECORDS.checklistTemplates.filter(t => t.templateCode === 'CL_RACE_001').length === 1,
      { c1Status: c1.status, c2Status: c2.status, created: RECORDS.checklistTemplates });
    const clBothSucceeded = c1.status === 200 && c2.status === 200;
    check('checklistTemplates: KHÔNG được cả 2 request cùng thành công (loại trừ nhau)',
      !clBothSucceeded, { c1Status: c1.status, c2Status: c2.status });
    const clFailed = c1.status === 200 ? c2 : c1;
    check('checklistTemplates: request thua cuộc phải bị chặn 409 với đúng lý do "Mã checklist ... đã tồn tại"',
      clFailed.status === 409 && /Mã checklist/.test(clFailed.body?.error || ''),
      clFailed.body);

    resetRecords();
    const [c3, c4] = await Promise.all([
      api(server, 'POST', '/api/create/checklistTemplates', checklistTemplatePayload({ templateCode: 'CL_RACE_002' }), ADMIN),
      api(server, 'POST', '/api/create/checklistTemplates', checklistTemplatePayload({ templateCode: 'CL_RACE_003' }), ADMIN2)
    ]);
    check('checklistTemplates: 2 mẫu KHÁC templateCode vẫn tạo đồng thời bình thường (không bị khoá chung chặn nhầm)',
      c3.status === 200 && c4.status === 200 && RECORDS.checklistTemplates.length === 2,
      { c3Status: c3.status, c4Status: c4.status, count: RECORDS.checklistTemplates.length });

    // ===== trainingPlans: 2 request CÙNG Tháng+Chương Trình+Đơn Vị gần như đồng thời =====
    resetRecords();
    const [t1, t2] = await Promise.all([
      api(server, 'POST', '/api/create/trainingPlans', trainingPlanPayload(), ADMIN),
      api(server, 'POST', '/api/create/trainingPlans', trainingPlanPayload(), ADMIN2)
    ]);
    check('trainingPlans: KHÔNG được tạo 2 dòng cùng Tháng+Chương Trình+Đơn Vị (LỖI ĐÃ VÁ — race condition)',
      RECORDS.trainingPlans.length === 1,
      { t1Status: t1.status, t2Status: t2.status, created: RECORDS.trainingPlans });
    const tpBothSucceeded = t1.status === 200 && t2.status === 200;
    check('trainingPlans: KHÔNG được cả 2 request cùng thành công (loại trừ nhau)',
      !tpBothSucceeded, { t1Status: t1.status, t2Status: t2.status });
    const tpFailed = t1.status === 200 ? t2 : t1;
    check('trainingPlans: request thua cuộc phải bị chặn 409 với đúng lý do "Đã có dòng kế hoạch đào tạo..."',
      tpFailed.status === 409 && /Đã có dòng kế hoạch đào tạo/.test(tpFailed.body?.error || ''),
      tpFailed.body);

    resetRecords();
    const [t3, t4] = await Promise.all([
      api(server, 'POST', '/api/create/trainingPlans', trainingPlanPayload({ targetDept: 'Phòng IT' }), ADMIN),
      api(server, 'POST', '/api/create/trainingPlans', trainingPlanPayload({ targetDept: 'Siêu Thị A' }), ADMIN2)
    ]);
    check('trainingPlans: 2 dòng KHÁC Đơn Vị vẫn tạo đồng thời bình thường (không bị khoá chung chặn nhầm)',
      t3.status === 200 && t4.status === 200 && RECORDS.trainingPlans.length === 2,
      { t3Status: t3.status, t4Status: t4.status, count: RECORDS.trainingPlans.length });
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
