// server/tests/test-operation-order-delete-dsmart16-orphan-warning.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #10):
// jobs/operationOrderApiSync.js CHỈ có đường GỬI/CẬP NHẬT đơn hàng ra hệ thống ngoài "dsmart16", KHÔNG có
// endpoint HUỶ/XOÁ nào để job tự gọi khi 1 đơn đã đồng bộ (dsmart16Synced=true) bị xoá bên hệ thống này —
// hệ thống dsmart16 sẽ giữ MỒ CÔI 1 bản ghi mà không hề biết đã bị xoá. Đã vá: POST
// /api/records/operationOrders/:id/delete đọc lại hồ sơ trước khi xoá, nếu dsmart16Synced=true thì ghi
// 1 dòng Nhật Ký Hệ Thống mức WARNING rõ ràng (không chặn việc xoá).
//
// Chạy: node server/tests/test-operation-order-delete-dsmart16-orphan-warning.js
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

const ADMIN = { username: 'admin1', name: 'Quản Trị Viên', dept: 'IT', perms: { admin: true }, active: true };
const USERS = [ADMIN];

let RECORDS;
function resetRecords() {
  RECORDS = {
    operationOrders: [
      { id: 1, title: 'Đơn ĐÃ đồng bộ dsmart16', code: 'DH-001', poNumber: 'PO-001', dsmart16Synced: true, status: 'APPROVED', history: [] },
      { id: 2, title: 'Đơn CHƯA đồng bộ dsmart16', code: 'DH-002', poNumber: 'PO-002', dsmart16Synced: false, status: 'DRAFT', history: [] },
      { id: 3, title: 'Đơn không có field dsmart16Synced (dữ liệu cũ)', code: 'DH-003', poNumber: 'PO-003', status: 'DRAFT', history: [] }
    ]
  };
}
resetRecords();

const systemLogs = [];
stubModule('lib/systemLogStore', { insertSystemLog: async (e) => { systemLogs.push(e); } });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['operationOrders']),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  deleteRecordForCollection: async (c, id, checkFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex((x) => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy'); }
    if (checkFn) checkFn(list[idx]);
    list.splice(idx, 1);
  },
  withLockedRecordForCollection: async () => { throw new Error('không dùng ở test này'); },
  withAppLock: async (k, fn) => fn(),
  getTrashItems: async () => []
});
stubModule('lib/appData', {
  getAllAppData: async () => ({}), getAppDataValue: async () => null, withLockedAppDataValue: async (k, fn) => fn([])
});
let CURRENT_USERNAME = ADMIN.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find((u) => u.username === CURRENT_USERNAME);
    req.user = { username: fresh.username, name: fresh.name }; req.freshUser = fresh; req.allUsers = USERS; next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const recordsRoutes = require('../routes/records');
let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordsRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}
async function api(urlPath) {
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, { method: 'POST' });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function main() {
  const server = await startApp();
  try {
    resetRecords(); systemLogs.length = 0;
    const r1 = await api('/api/records/operationOrders/1/delete');
    check('LỖI ĐÃ VÁ: xoá đơn ĐÃ đồng bộ dsmart16 -> vẫn xoá THÀNH CÔNG (không chặn)', r1.status === 200 && !RECORDS.operationOrders.some(o => o.id === 1), r1.body);
    check('LỖI ĐÃ VÁ: ghi đúng 1 dòng Nhật Ký Hệ Thống mức WARNING (DELETE_SYNCED_ORPHAN_WARNING) kèm PO',
      systemLogs.length === 1 && systemLogs[0].status === 'WARNING' && systemLogs[0].actionType === 'DELETE_SYNCED_ORPHAN_WARNING' && /PO-001/.test(systemLogs[0].description),
      systemLogs);

    resetRecords(); systemLogs.length = 0;
    const r2 = await api('/api/records/operationOrders/2/delete');
    check('Xoá đơn CHƯA đồng bộ dsmart16 -> xoá thành công', r2.status === 200 && !RECORDS.operationOrders.some(o => o.id === 2), r2.body);
    check('KHÔNG ghi cảnh báo mồ côi cho đơn chưa đồng bộ (tránh cảnh báo oan)', systemLogs.length === 0, systemLogs);

    resetRecords(); systemLogs.length = 0;
    const r3 = await api('/api/records/operationOrders/3/delete');
    check('Xoá đơn KHÔNG có field dsmart16Synced (dữ liệu cũ trước đợt đồng bộ dsmart16) -> vẫn xoá được bình thường', r3.status === 200, r3.body);
    check('KHÔNG ghi cảnh báo mồ côi cho dữ liệu cũ chưa từng có field này (=== true kiểm chặt, undefined không khớp)', systemLogs.length === 0, systemLogs);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
