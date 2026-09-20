// server/tests/test-edit-file-ownership-operationorders.js
//
// Regression test cho LỖI NGHIÊM TRỌNG phát hiện ở đợt audit chuyên sâu 12 cụm (cụm Vận Hành/Hỗ Trợ IT/
// Mua Hàng BAS/Ngân Sách, 9/2026 — phát hiện #1):
//
//   POST /api/records/operationOrders/:id/update (editOperationOrderDraft, lib/recordActions.js)
//
// là route SỬA DUY NHẤT còn thiếu assertPayloadFileUrlsOwnedByUser() (lib/uploadedFiles.js) — chỉ có
// assertUploadedFileUrl() (kiểm khuôn URL) trong editOperationOrderDraft(), khác 13 route sửa khác đã vá
// cùng lớp (xem test-edit-file-ownership*.js). Đơn hàng bị "Yêu Cầu Bổ Sung" (status DRAFT) mở cho người
// tạo sửa fileUrl trỏ tới file THẬT của người khác (HĐLĐ/phiếu lương/chứng từ thanh toán/CV...) rồi tự
// đọc được trọn vẹn, vì operationOrders đứng trước nhiều checker khác trong findOwningRecord()
// (lib/fileAuthz.js).
//
// Cùng khuôn test-edit-file-ownership-batch3.js: gọi thẳng router THẬT (routes/records.js),
// lib/uploadedFiles.js THẬT (qua 1 fake pool dbo.UploadedFiles), lib/recordActions.js THẬT — chỉ giả lập
// tầng lưu trữ (recordStore/appData).
//
// Chạy: node server/tests/test-edit-file-ownership-operationorders.js
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

// ===== Fake pool cho dbo.UploadedFiles (giống batch3) =====
const uploadedFilesStore = new Map();
const fakePool = {
  request() {
    const params = {};
    const req = {
      input(name, type, value) { params[name] = value; return req; },
      async query(text) {
        if (/INSERT INTO dbo\.UploadedFiles/.test(text)) {
          uploadedFilesStore.set(params.fileUrl, params.uploadedBy);
          return { recordset: [] };
        }
        if (/SELECT FileUrl, UploadedBy FROM dbo\.UploadedFiles/.test(text)) {
          const urls = Object.keys(params).filter(k => k.startsWith('fu')).map(k => params[k]);
          const recordset = urls.filter(u => uploadedFilesStore.has(u)).map(u => ({ FileUrl: u, UploadedBy: uploadedFilesStore.get(u) }));
          return { recordset };
        }
        throw new Error('Fake pool: câu lệnh SQL không xác định được — ' + text);
      }
    };
    return req;
  }
};
stubModule('db', {
  getPool: async () => fakePool,
  sql: { NVarChar: (n) => ({ type: 'NVarChar', n }) }
});

let RECORDS;
function defaultRecords() {
  return {
    operationOrders: [
      {
        id: 200, creator: 'u1', creatorName: 'Người Dùng Một', dept: 'Siêu Thị A', status: 'DRAFT',
        orderLocationType: 'STORE', title: 'Đơn hàng test', supplier: 'NCC A', note: '',
        fileUrl: '/uploads/existing-po-attachment.pdf',
        items: [{ name: 'Hàng A', unit: 'cái', qty: 1, unitPrice: 100000, amount: 100000, note: '', productCode: '', barcode: '', qtyReceived: null }],
        amount: 100000, history: []
      }
    ]
  };
}
function resetRecords() { RECORDS = defaultRecords(); }
resetRecords();

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(defaultRecords())),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    const snapshot = JSON.parse(JSON.stringify(list[idx]));
    const updated = await mutatorFn(snapshot);
    list[idx] = updated;
    return updated;
  },
  withAppLock: async (key, fn) => fn()
});
stubModule('lib/appData', {
  getAllAppData: async () => ({}),
  getAppDataValue: async () => null,
  withLockedAppDataValue: async (key, mutatorFn) => mutatorFn([])
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

const U1 = { username: 'u1', name: 'Người Dùng Một', dept: 'Siêu Thị A', perms: {}, active: true };
const U2 = { username: 'u2', name: 'Người Dùng Hai', dept: 'Siêu Thị B', perms: {}, active: true };
const USERS = [U1, U2];
let CURRENT_USERNAME = U1.username;

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
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
async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

function reset() {
  resetRecords();
  uploadedFilesStore.clear();
  uploadedFilesStore.set('/uploads/u1-owned-po.pdf', 'u1');
  uploadedFilesStore.set('/uploads/u2-secret-payslip.pdf', 'u2');
}

function baseItems() {
  return [{ name: 'Hàng A', qty: 1, unitPrice: 100000 }];
}

async function main() {
  const server = await startApp();
  try {
    // LỖI ĐÃ VÁ: gán fileUrl trỏ tới file THẬT của người khác (u2, VD phiếu lương) phải bị chặn 403,
    // không được âm thầm "chiếm quyền sở hữu" file đó qua 1 đơn hàng đang "Yêu Cầu Bổ Sung".
    reset();
    let r = await api('POST', '/api/records/operationOrders/200/update',
      { title: 'Đơn hàng test', supplier: 'NCC A', items: baseItems(), fileUrl: '/uploads/u2-secret-payslip.pdf' }, U1);
    check('operationOrders/update: chặn gắn tệp của người khác (u2) — 403', r.status === 403, r.body);
    check('operationOrders/update: fileUrl KHÔNG bị đổi sau khi chặn', RECORDS.operationOrders[0].fileUrl === '/uploads/existing-po-attachment.pdf', RECORDS.operationOrders[0]);

    // Gắn tệp CHÍNH MÌNH đã tải lên -> vẫn phải hoạt động bình thường (không phá tính năng sửa).
    reset();
    r = await api('POST', '/api/records/operationOrders/200/update',
      { title: 'Đơn hàng test', supplier: 'NCC A', items: baseItems(), fileUrl: '/uploads/u1-owned-po.pdf' }, U1);
    check('operationOrders/update: gắn tệp CHÍNH MÌNH -> thành công (200)', r.status === 200, r.body);
    check('operationOrders/update: fileUrl mới được lưu đúng', RECORDS.operationOrders[0].fileUrl === '/uploads/u1-owned-po.pdf', RECORDS.operationOrders[0]);

    // Không đổi fileUrl (giữ nguyên tệp cũ) -> exemptFileUrls phải cho qua, không đòi hỏi lại quyền sở hữu.
    reset();
    r = await api('POST', '/api/records/operationOrders/200/update',
      { title: 'Đổi tiêu đề, giữ nguyên tệp', supplier: 'NCC A', items: baseItems(), fileUrl: '/uploads/existing-po-attachment.pdf' }, U1);
    check('operationOrders/update: giữ nguyên tệp cũ (exempt) -> thành công (200)', r.status === 200, r.body);
    check('operationOrders/update: title mới được lưu đúng', RECORDS.operationOrders[0].title === 'Đổi tiêu đề, giữ nguyên tệp', RECORDS.operationOrders[0]);

    // Không phải người tạo -> vẫn bị chặn ở tầng quyền sửa như trước (chưa từng hỏng, không liên quan lớp vá file).
    reset();
    r = await api('POST', '/api/records/operationOrders/200/update',
      { title: 'Chiếm đơn của người khác', supplier: 'X', items: baseItems() }, U2);
    check('operationOrders/update: người không phải chủ đơn bị chặn 403', r.status === 403, r.body);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
