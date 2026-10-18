// server/tests/test-khoi0-checklist-lazy-data-gate.js
//
// Re-audit lần 4 (mức Cao): checklistSubmissions/checklistTemplates (Checklist Đánh Giá Siêu Thị) KHÔNG
// có trong MODULE_ACCESS_GATED_COLLECTIONS trước khi vá — canViewChecklistSubmission() (lib/recordViewScope.js)
// có nhánh "chính người nộp" (submittedByUsername === user.username) VÀ nhánh "cùng siêu thị tự động xem"
// (deptAutoViewOn) KHÔNG hề gọi hasModuleAccessServer(), nên admin tắt moduleAccess.checklist cho 1 tài
// khoản (còn giữ checklistExecute) vẫn đọc được TOÀN BỘ bài Checklist của chính mình/siêu thị mình qua
// GET /api/data/lazy/checklist — dù route HÀNH ĐỘNG (routes/checklist.js, requireChecklistModuleAccess())
// đã gác đúng từ trước.
//
// Đã thêm `checklist: ['checklistTemplates', 'checklistSubmissions']` vào MODULE_ACCESS_GATED_COLLECTIONS
// (lib/recordViewScope.js) — tự động gác vòng lặp zero-out GET /api/data/lazy/:groupKey (routes/data.js).
// Gỡ `checklistTemplates: 'checklist'` khỏi EXTRA_CREATE_MODULE_ACCESS_KEY (routes/create.js, không khai
// trùng) + thêm carve-out RIÊNG cho checklistSubmissions ở routes/reports.js (giữ nguyên tính năng "xem
// chéo Báo Cáo" CỐ Ý không phụ thuộc moduleAccess.checklist — filterChecklistSubmissionsForReportCrossView()).
//
// Test này KHÔNG lặp lại phần route hành động (submit/clone) đã có ở
// test-khoi0-checklist-contract-attendance-internalpost-gate.js — chỉ tập trung đúng phần MỚI: (a) cấu
// trúc map, (b) hành vi zero-out THẬT ở GET /api/data/lazy/checklist, và (c) xác nhận GET
// /api/reports/checklistSubmissions KHÔNG bị chặn oan (giữ đúng tính năng xem chéo).
//
// Chạy: node server/tests/test-khoi0-checklist-lazy-data-gate.js
'use strict';
const http = require('http');
const path = require('path');
const express = require('express');
const { createRunner, assertEqual } = require('./testHarness');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

const CHECKLIST_OFF = { username: 'nv1', name: 'NV 1', dept: 'Siêu Thị A', posType: 'STORE', perms: { checklistExecute: true, moduleAccess: { checklist: false } }, active: true };
const CHECKLIST_ON = { username: 'nv2', name: 'NV 2', dept: 'Siêu Thị A', posType: 'STORE', perms: { checklistExecute: true, moduleAccess: { checklist: true } }, active: true };
const NO_MODULE_ACCESS_FIELD = { username: 'nv3', name: 'NV 3', dept: 'Siêu Thị A', posType: 'STORE', perms: { checklistExecute: true }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true, moduleAccess: { checklist: false } }, active: true };
const REPORT_VIEWER_NO_MODULE = { username: 'nv4', name: 'NV 4 (Xem Báo Cáo chéo)', dept: 'Phòng Khác', perms: { reportViewAll: true, moduleAccess: { checklist: false } }, active: true };
const ALL_USERS_LIST = [CHECKLIST_OFF, CHECKLIST_ON, NO_MODULE_ACCESS_FIELD, ADMIN, REPORT_VIEWER_NO_MODULE];

let APP_DATA;
function resetData() {
  APP_DATA = { users: ALL_USERS_LIST.map(u => ({ ...u })) };
}
resetData();

// bài CHÍNH nv1 nộp (submittedByUsername) + bài nộp tại ĐÚNG siêu thị nv1 (storeCode) — 2 nhánh "chính
// chủ"/"cùng siêu thị" KHÔNG phụ thuộc quyền chi tiết, phải bị zero-out khi moduleAccess.checklist=false.
const CHECKLIST_SUBMISSIONS = [
  { id: 1, templateId: 100, submittedByUsername: 'nv1', storeCode: 'Siêu Thị A', status: 'SUBMITTED' }
];
const CHECKLIST_TEMPLATES = [{ id: 100, name: 'Mẫu A', status: 'ACTIVE', templateType: 'STORE_SELF' }];

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [] });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [] });
// DEDICATED_TABLES: dữ liệu tĩnh (định nghĩa cột, không gọi DB) — dùng nguyên bản thật từ
// lib/recordStore.js, chỉ override hàm GỌI DB thật (queryDedicatedRecords/getAllForCollectionCached/...).
const REAL_RECORD_STORE = require('../lib/recordStore');
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['checklistTemplates', 'checklistSubmissions']),
  DEDICATED_TABLES: REAL_RECORD_STORE.DEDICATED_TABLES,
  getAllForCollectionCached: async (collection) => {
    if (collection === 'checklistTemplates') return CHECKLIST_TEMPLATES.map(r => ({ ...r }));
    if (collection === 'checklistSubmissions') return CHECKLIST_SUBMISSIONS.map(r => ({ ...r }));
    return [];
  },
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async (collection, column, value) => {
    if (collection !== 'checklistSubmissions') return [];
    if (column === 'SubmittedByUsername') return CHECKLIST_SUBMISSIONS.filter(s => s.submittedByUsername === value).map(r => ({ ...r }));
    if (column === 'StoreCode') return CHECKLIST_SUBMISSIONS.filter(s => s.storeCode === value).map(r => ({ ...r }));
    return [];
  },
  queryDedicatedRecords: async (collection) => {
    if (collection === 'checklistSubmissions') return { items: CHECKLIST_SUBMISSIONS.map(r => ({ ...r })) };
    return { items: [] };
  }
});

let CURRENT_USERNAME = CHECKLIST_ON.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = ALL_USERS_LIST.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p,
  isBcryptHash: () => false,
  validatePin: () => null
});

const dataRoutes = require('../routes/data');
const reportsRoutes = require('../routes/reports');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
  app.use('/api/reports', reportsRoutes);
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

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    await run.run('MODULE_ACCESS_GATED_COLLECTIONS: đã thêm key "checklist" -> ["checklistTemplates", "checklistSubmissions"]', async () => {
      delete require.cache[require.resolve('../lib/recordViewScope')];
      const { MODULE_ACCESS_GATED_COLLECTIONS } = require('../lib/recordViewScope');
      const cols = MODULE_ACCESS_GATED_COLLECTIONS.checklist || [];
      assertEqual(cols.includes('checklistTemplates'), true, 'thiếu checklist->checklistTemplates');
      assertEqual(cols.includes('checklistSubmissions'), true, 'thiếu checklist->checklistSubmissions');
    });

    await run.run('moduleAccess.checklist=false -> GET /api/data/lazy/checklist trả checklistSubmissions RỖNG dù chính người nộp', async () => {
      resetData();
      const res = await api('GET', '/api/data/lazy/checklist', undefined, CHECKLIST_OFF);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual((res.body.checklistSubmissions || []).length, 0, 'checklistSubmissions phải bị chặn hoàn toàn khi moduleAccess.checklist=false');
    });

    await run.run('moduleAccess.checklist=false -> GET /api/data/lazy/checklist trả checklistTemplates RỖNG', async () => {
      resetData();
      const res = await api('GET', '/api/data/lazy/checklist', undefined, CHECKLIST_OFF);
      assertEqual((res.body.checklistTemplates || []).length, 0, 'checklistTemplates phải bị chặn hoàn toàn khi moduleAccess.checklist=false');
    });

    await run.run('moduleAccess.checklist=true -> vẫn thấy checklistSubmissions/checklistTemplates bình thường (không bị chặn oan)', async () => {
      resetData();
      const res = await api('GET', '/api/data/lazy/checklist', undefined, CHECKLIST_ON);
      assertEqual((res.body.checklistSubmissions || []).length, 1, 'checklistSubmissions không bị chặn oan khi module bật');
      assertEqual((res.body.checklistTemplates || []).length, 1, 'checklistTemplates không bị chặn oan khi module bật');
    });

    await run.run('KHÔNG có field moduleAccess nào (mặc định mở hết) -> vẫn thấy checklistSubmissions/checklistTemplates', async () => {
      resetData();
      const res = await api('GET', '/api/data/lazy/checklist', undefined, NO_MODULE_ACCESS_FIELD);
      assertEqual((res.body.checklistSubmissions || []).length, 1, 'không có moduleAccess = mặc định KHÔNG bị chặn');
      assertEqual((res.body.checklistTemplates || []).length, 1, 'không có moduleAccess = mặc định KHÔNG bị chặn');
    });

    await run.run('admin luôn bỏ qua moduleAccess (dù chính admin cũng bị tắt checklist)', async () => {
      resetData();
      const res = await api('GET', '/api/data/lazy/checklist', undefined, ADMIN);
      assertEqual((res.body.checklistSubmissions || []).length, 1, 'admin phải luôn thấy checklistSubmissions dù moduleAccess.checklist=false');
      assertEqual((res.body.checklistTemplates || []).length, 1, 'admin phải luôn thấy checklistTemplates dù moduleAccess.checklist=false');
    });

    await run.run('"Xem chéo Báo Cáo" KHÔNG bị gãy: reportViewAll=true + moduleAccess.checklist=false vẫn GET /api/reports/checklistSubmissions không bị 403', async () => {
      resetData();
      const res = await api('GET', '/api/reports/checklistSubmissions', undefined, REPORT_VIEWER_NO_MODULE);
      assertEqual(res.status === 403, false, `KHÔNG được là 403 (tính năng xem chéo Báo Cáo cố ý không phụ thuộc moduleAccess.checklist) — nhận status=${res.status}`);
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
