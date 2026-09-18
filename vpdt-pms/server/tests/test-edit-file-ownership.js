// server/tests/test-edit-file-ownership.js
//
// Regression test cho 2 lỗi ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026, mức Cao — "giả mạo quyền sở hữu
// file"), cùng 1 lớp lỗi ở 2 route SỬA hồ sơ đã có (khác luồng TẠO MỚI qua routes/create.js, vốn đã có
// assertPayloadFileUrlsOwnedByUser() từ 9/2026):
//
//   1. POST /api/records/laborContracts/:id/edit — trước đây field fileUrl rơi vào nhánh "default" của
//      applyManualEdit() (lib/laborContract.js), KHÔNG hề gọi assertUploadedFileUrl() (mất cả bước kiểm
//      hình dạng, mở lại nguy cơ scheme javascript:) lẫn assertPayloadFileUrlsOwnedByUser() (không xác
//      minh ai thực sự tải "Tệp hợp đồng" lên).
//   2. POST /api/records/itServiceRenewals/:id/edit — cùng lỗi ở editItServiceRenewal()
//      (lib/recordActions.js): field fileUrl chỉ trim/slice, không xác minh gì cả.
//
// Đã vá: thêm assertUploadedFileUrl() (định dạng) vào cả 2 hàm xử lý field fileUrl, cộng
// assertPayloadFileUrlsOwnedByUser() (chủ sở hữu) ở đúng route trong routes/records.js — exemptFileUrls
// giữ nguyên tệp ĐANG CÓ trước khi sửa (không bắt xác minh lại tệp cũ).
//
// Test này gọi thẳng router THẬT (routes/records.js), lib/uploadedFiles.js THẬT, chỉ giả lập tầng DB
// (dbo.UploadedFiles + recordStore) — mirror khuôn Phần B của tests/test-labor-contract.js.
//
// Chạy: node server/tests/test-edit-file-ownership.js
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

// ===== Fake pool cho dbo.UploadedFiles =====
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
function resetRecords() {
  RECORDS = {
    laborContracts: [{
      id: 1, code: 'HDLD-NV001-1', employeeCode: 'NV001', contractType: 'INDEFINITE',
      startDate: '2026-01-01', endDate: null, baseSalary: 10000000,
      fileUrl: '/uploads/existing-contract-file.pdf', fileName: 'hop-dong-cu.pdf',
      status: 'DRAFT', dept: 'Nhân Sự', history: [], amendments: [], notifiedThresholds: []
    }],
    itServiceRenewals: [{
      id: 2, name: 'Domain example.com', category: 'Tên miền', vendor: 'PA Vietnam',
      responsible: 'it1', note: '', startDate: '2026-01-01', expiryDate: '2027-01-01', cost: 500000,
      fileUrl: '/uploads/existing-renewal-invoice.pdf', fileName: 'hoa-don-cu.pdf',
      history: [], notifiedThresholds: []
    }]
  };
}
resetRecords();

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['laborContracts', 'itServiceRenewals']),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    // Mirror ĐÚNG hành vi lib/recordStore.js thật (withLockedDedicatedRecordById — đọc lại Payload JSON
    // từ DB thành 1 object MỚI mỗi lần, KHÔNG chia sẻ tham chiếu với "bản ghi đang lưu"): nếu mutatorFn
    // throw giữa chừng SAU KHI đã mutate item tại chỗ (đúng cách applyManualEdit()/editItServiceRenewal()
    // làm), bản ghi "đã lưu" (list[idx]) không được động tới — transaction thật sẽ rollback, không bao
    // giờ UPDATE. Nếu stub này truyền thẳng list[idx] (share tham chiếu), lỗi ném ra SAU khi mutate xong
    // vẫn để lại thay đổi dở dang trong list[idx], che giấu mất đúng lớp bảo vệ đang test ở file này.
    const snapshot = JSON.parse(JSON.stringify(list[idx]));
    const updated = await mutatorFn(snapshot);
    list[idx] = updated;
    return updated;
  },
  withAppLock: async (key, fn) => fn()
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

const HR1 = { username: 'hr1', name: 'Nhân Sự Một', dept: 'Nhân Sự', perms: { hrContractManage: true }, active: true };
const IT1 = { username: 'it1', name: 'IT Một', dept: 'IT', perms: { itServiceRenewalManage: true }, active: true };
const USERS = [HR1, IT1];
let CURRENT_USERNAME = HR1.username;

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

async function main() {
  const server = await startApp();
  try {
    // ===== 1a. laborContracts/:id/edit — sửa field KHÁC fileUrl (giữ nguyên tệp cũ) -> vẫn OK =====
    resetRecords();
    uploadedFilesStore.clear();
    const r1a = await api('POST', '/api/records/laborContracts/1/edit', { baseSalary: 12000000 }, HR1);
    check('laborContracts/edit: sửa field khác fileUrl (giữ nguyên tệp cũ) vẫn thành công', r1a.status === 200, r1a.body);

    // ===== 1b. laborContracts/:id/edit — gắn fileUrl KHÔNG đúng khuôn (javascript:) -> chặn 400 (mất
    // luôn cả format check trước khi vá) =====
    resetRecords();
    uploadedFilesStore.clear();
    const r1b = await api('POST', '/api/records/laborContracts/1/edit', { fileUrl: 'javascript:alert(1)' }, HR1);
    check('LỖI ĐÃ VÁ: laborContracts/edit chặn fileUrl sai khuôn (javascript:) — 400', r1b.status === 400, r1b.body);

    // ===== 1c. laborContracts/:id/edit — gắn fileUrl của NGƯỜI KHÁC (giả mạo quyền sở hữu) -> 403 =====
    resetRecords();
    uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/nv002-salary-decision-secret.pdf', 'hr2');
    const r1c = await api('POST', '/api/records/laborContracts/1/edit', { fileUrl: '/uploads/nv002-salary-decision-secret.pdf' }, HR1);
    check('LỖI ĐÃ VÁ: laborContracts/edit chặn gắn tệp của người khác (hr2) — 403', r1c.status === 403, r1c.body);
    check('Hợp đồng KHÔNG bị đổi fileUrl sau khi bị chặn', RECORDS.laborContracts[0].fileUrl === '/uploads/existing-contract-file.pdf', RECORDS.laborContracts[0]);

    // ===== 1d. laborContracts/:id/edit — gắn fileUrl CHÍNH MÌNH vừa tải lên -> thành công =====
    resetRecords();
    uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/hr1-new-contract-file.pdf', 'hr1');
    const r1d = await api('POST', '/api/records/laborContracts/1/edit', { fileUrl: '/uploads/hr1-new-contract-file.pdf' }, HR1);
    check('laborContracts/edit: gắn tệp CHÍNH MÌNH vừa tải lên -> thành công (200)', r1d.status === 200, r1d.body);
    check('fileUrl mới được lưu đúng', RECORDS.laborContracts[0].fileUrl === '/uploads/hr1-new-contract-file.pdf', RECORDS.laborContracts[0]);

    // ===== 2a. itServiceRenewals/:id/edit — sửa field khác fileUrl vẫn OK =====
    resetRecords();
    uploadedFilesStore.clear();
    const r2a = await api('POST', '/api/records/itServiceRenewals/2/edit', {
      name: 'Domain example.com', category: 'Tên miền', expiryDate: '2028-01-01'
    }, IT1);
    check('itServiceRenewals/edit: sửa field khác fileUrl vẫn thành công', r2a.status === 200, r2a.body);

    // ===== 2b. itServiceRenewals/:id/edit — fileUrl sai khuôn -> chặn 400 (trước đây KHÔNG chặn gì) =====
    resetRecords();
    uploadedFilesStore.clear();
    const r2b = await api('POST', '/api/records/itServiceRenewals/2/edit', {
      name: 'Domain example.com', category: 'Tên miền', expiryDate: '2028-01-01', fileUrl: 'javascript:alert(1)'
    }, IT1);
    check('LỖI ĐÃ VÁ: itServiceRenewals/edit chặn fileUrl sai khuôn (javascript:) — 400', r2b.status === 400, r2b.body);

    // ===== 2c. itServiceRenewals/:id/edit — gắn fileUrl của người khác -> 403 =====
    resetRecords();
    uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/it2-private-invoice.pdf', 'it2');
    const r2c = await api('POST', '/api/records/itServiceRenewals/2/edit', {
      name: 'Domain example.com', category: 'Tên miền', expiryDate: '2028-01-01', fileUrl: '/uploads/it2-private-invoice.pdf'
    }, IT1);
    check('LỖI ĐÃ VÁ: itServiceRenewals/edit chặn gắn tệp của người khác (it2) — 403', r2c.status === 403, r2c.body);
    check('Mục gia hạn KHÔNG bị đổi fileUrl sau khi bị chặn', RECORDS.itServiceRenewals[0].fileUrl === '/uploads/existing-renewal-invoice.pdf', RECORDS.itServiceRenewals[0]);

    // ===== 2d. itServiceRenewals/:id/edit — gắn fileUrl CHÍNH MÌNH -> thành công =====
    resetRecords();
    uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/it1-new-invoice.pdf', 'it1');
    const r2d = await api('POST', '/api/records/itServiceRenewals/2/edit', {
      name: 'Domain example.com', category: 'Tên miền', expiryDate: '2028-01-01', fileUrl: '/uploads/it1-new-invoice.pdf'
    }, IT1);
    check('itServiceRenewals/edit: gắn tệp CHÍNH MÌNH vừa tải lên -> thành công (200)', r2d.status === 200, r2d.body);
    check('fileUrl mới được lưu đúng', RECORDS.itServiceRenewals[0].fileUrl === '/uploads/it1-new-invoice.pdf', RECORDS.itServiceRenewals[0]);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
