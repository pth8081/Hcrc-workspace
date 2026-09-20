// server/tests/test-purchasing-synclogs-error-detail-gate.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #8):
// GET /api/purchasing/sync-logs chỉ gác bởi requireAnyPurchasingAccess (CHO PHÉP bất kỳ quyền nào trong 5
// quyền module, kể cả CHỈ có rebateViewReport — người KHÔNG được phép đồng bộ) — nhưng toSyncLogEntry()
// (lib/vendorPurchaseStore.js) trả nguyên errorMessage (có thể chứa hostname/IP nội bộ, phản hồi thô từ
// hệ thống DSmart ngoài) cho MỌI người xem được log. Đã vá: chỉ trả errorMessage chi tiết cho người CÓ
// quyền đồng bộ thật (canManageTerms — admin/rebateTermManage, đúng quyền gác POST /sync), người khác chỉ
// thấy trạng thái chung chung (sanitizePurchaseSyncLogs(), routes/purchasing.js).
//
// Cùng khuôn tests/test-purchasing-term-vendor-and-dates.js — router THẬT (routes/purchasing.js).
//
// Chạy: node server/tests/test-purchasing-synclogs-error-detail-gate.js
'use strict';
const http = require('http');
const path = require('path');
const assert = require('assert');

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

const MANAGER = { username: 'mh1', name: 'NV Quản Lý Điều Khoản', dept: 'Phòng Mua Hàng', perms: { rebateTermManage: true }, active: true };
const VIEWER_ONLY = { username: 'mh2', name: 'NV Chỉ Xem Báo Cáo', dept: 'Phòng Mua Hàng', perms: { rebateViewReport: true }, active: true };
const USERS = [MANAGER, VIEWER_ONLY];
let CURRENT_USERNAME = MANAGER.username;

const SENSITIVE_ERROR = 'DSmart API trả về HTTP 500: connect ECONNREFUSED 10.20.30.40:8443 (internal-dsmart.corp.local)';
const SYNC_LOGS = [
  { logId: 1, startedAt: new Date(), finishedAt: new Date(), sourceSystem: 'DSMART', status: 'FAILED', rowsFetched: null, rowsInserted: null, pagesFetched: null, triggeredBy: 'mh1', errorMessage: SENSITIVE_ERROR },
  { logId: 2, startedAt: new Date(), finishedAt: new Date(), sourceSystem: 'DSMART', status: 'SUCCESS', rowsFetched: 10, rowsInserted: 10, pagesFetched: 1, triggeredBy: 'mh1', errorMessage: null }
];

stubModule('lib/recordStore', { getAllForCollection: async () => [], withAppLock: async (k, fn) => fn() });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
stubModule('lib/vendorPurchaseStore', {
  getRecentPurchaseSyncLogs: async () => SYNC_LOGS,
  queryPurchaseTransactionsForVendor: async () => [], queryPurchaseTransactionsForExport: async () => [],
  bulkInsertPurchaseTransactions: async () => ({ rowsInserted: 0, rowsUpdated: 0, rowsSkippedDuplicate: 0 }),
  insertPurchaseSyncLog: async () => {}, getLastSuccessfulSyncStart: async () => null
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    req.user = { username: fresh.username, name: fresh.name }; req.freshUser = fresh; req.allUsers = USERS; next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const purchasingRoutes = require('../routes/purchasing');
let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/purchasing', purchasingRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}
async function api(urlPath, asUser) {
  CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main() {
  const server = await startApp();
  try {
    const asManager = await api('/api/purchasing/sync-logs', MANAGER);
    check('canManageTerms (rebateTermManage) -> đọc được sync-logs (200)', asManager.status === 200, asManager.body);
    const failedLogManager = asManager.body.items.find(l => l.logId === 1);
    check('LỖI ĐÃ VÁ: người CÓ quyền đồng bộ thật -> vẫn thấy errorMessage chi tiết đầy đủ (không đổi hành vi cũ)',
      failedLogManager?.errorMessage === SENSITIVE_ERROR, failedLogManager);

    const asViewer = await api('/api/purchasing/sync-logs', VIEWER_ONLY);
    check('rebateViewReport (không có quyền đồng bộ) -> vẫn đọc được sync-logs (200, chỉ khác nội dung)', asViewer.status === 200, asViewer.body);
    const failedLogViewer = asViewer.body.items.find(l => l.logId === 1);
    check('LỖI ĐÃ VÁ: người KHÔNG có quyền đồng bộ -> KHÔNG thấy errorMessage chi tiết (không lộ hostname/IP nội bộ)',
      failedLogViewer?.errorMessage !== SENSITIVE_ERROR && !/10\.20\.30\.40|internal-dsmart/.test(failedLogViewer?.errorMessage || ''), failedLogViewer);
    check('errorMessage rút gọn vẫn là chuỗi có ý nghĩa (không phải null/rỗng, người xem vẫn biết "có lỗi")',
      typeof failedLogViewer?.errorMessage === 'string' && failedLogViewer.errorMessage.length > 0, failedLogViewer);

    const successLogViewer = asViewer.body.items.find(l => l.logId === 2);
    check('Log SUCCESS (errorMessage=null) -> vẫn null cho người xem hạn chế (không tự bịa lỗi cho log không lỗi)',
      successLogViewer?.errorMessage === null, successLogViewer);

    check('Các field khác (status/rowsFetched/triggeredBy...) KHÔNG bị ẩn — chỉ mỗi errorMessage bị rút gọn',
      failedLogViewer?.status === 'FAILED' && failedLogViewer?.sourceSystem === 'DSMART' && failedLogViewer?.triggeredBy === 'mh1', failedLogViewer);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
