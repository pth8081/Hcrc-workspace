// server/tests/test-edit-file-ownership-batch2.js
//
// Regression test cho 11 route SỬA hồ sơ đã tồn tại còn thiếu bước xác minh chủ sở hữu file
// (assertPayloadFileUrlsOwnedByUser(), lib/uploadedFiles.js) — LỖI ĐÃ VÁ, đợt rà soát chuyên sâu upload
// 10/2026, mức Trung bình (khác 2 route mức Cao đã vá + test riêng ở test-edit-file-ownership.js):
//
//   1. POST /api/records/contracts/:id/edit                  (editContract)
//   2. POST /api/records/contracts/:id/upload-signed         (uploadContractSignedFile)
//   3. POST /api/records/officeReqs/:id/upload-signed        (uploadOfficeSignedFile)
//   4. POST /api/records/laborContracts/:id/add-amendment    (laborContract.addAmendment)
//   5. POST /api/hr-profile/by-code/:employeeCode/set-position (employeeProfile.applyPositionAssignment)
//   6. POST /api/records/docs/:id/update                     (editDocDraft)
//   7. POST /api/records/submissions/:id/update               (editSubmissionDraft)
//   8. POST /api/records/paymentRequests/:id/edit             (editPaymentRequest)
//   9. POST /api/records/itPriceApprovals/:id/submit-supplement (submitPriceSupplementFile)
//  10. POST /api/records/hrProcesses/:id/attachments          (addHrProcessAttachment)
//  11. POST /api/records/reportEntries/:id/update             (updateReportEntryDraft)
//
// Trước khi vá: mỗi route trên chỉ kiểm ĐÚNG KHUÔN URL (assertUploadedFileUrl, chặn scheme
// javascript:/tên miền lạ) nhưng KHÔNG xác minh người sửa có thật sự là người vừa tải file MỚI lên hay
// không — cho phép gắn 1 URL tệp THẬT của người khác (đoán/thấy được, VD từ 1 hồ sơ công khai khác) vào
// hồ sơ của mình, phá lớp phân quyền theo hồ sơ ở lib/fileAuthz.js (findOwningRecord() tưởng tệp đó
// "thuộc về" hồ sơ mình sửa).
//
// Test này gọi thẳng router THẬT (routes/records.js + routes/employeeProfile.js), lib/uploadedFiles.js
// THẬT (qua 1 fake pool dbo.UploadedFiles), lib/recordActions.js + lib/laborContract.js +
// lib/employeeProfile.js + lib/orgChart.js THẬT — chỉ giả lập tầng lưu trữ (recordStore/appData) với
// đúng ngữ nghĩa "đọc lại bản ghi MỚI mỗi transaction, rollback nếu mutatorFn throw" như DB thật (mirror
// khuôn tests/test-edit-file-ownership.js).
//
// Chạy: node server/tests/test-edit-file-ownership-batch2.js
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

// ===== Fake pool cho dbo.UploadedFiles (giống test-edit-file-ownership.js) =====
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

// ===== Fake recordStore (mirror hành vi rollback-safe của withLockedDedicatedRecordById() thật) =====
let RECORDS;
function defaultRecords() {
  return {
    contracts: [
      { id: 10, code: 'HD-EDIT-1', creator: 'u1', dept: 'Phòng A', custodianDept: 'Phòng A', type: 'MUA_BAN', title: 'HĐ Sửa', partner: 'X', amount: 1000000, startDate: '2026-01-01', endDate: '2026-12-31', content: '', paymentType: 'ONE_TIME', approvalStatus: 'PENDING', fileUrl: '/uploads/existing-contract-edit.pdf', fileName: 'hd.pdf', history: [], isAddendum: false },
      { id: 11, code: 'HD-SIGN-1', creator: 'u1', dept: 'Phòng A', custodianDept: 'Phòng A', type: 'MUA_BAN', title: 'HĐ Ký', partner: 'X', amount: 1000000, startDate: '2026-01-01', endDate: '2026-12-31', paymentType: 'ONE_TIME', approvalStatus: 'APPROVED', paymentStatus: 'CHUA_THANH_TOAN', signedFileStatus: null, signedFileUrl: null, history: [], isAddendum: false }
    ],
    officeReqs: [
      { id: 20, code: 'DX-1', creator: 'u1', dept: 'Phòng A', subType: 'MUA_BAN', status: 'APPROVED', paymentStatus: 'CHUA_THANH_TOAN', signedFileUrl: null, amount: 0, items: [], history: [] }
    ],
    laborContracts: [
      { id: 30, code: 'HDLD-NV030-1', employeeCode: 'NV030', contractType: 'INDEFINITE', startDate: '2026-01-01', endDate: null, baseSalary: 9000000, fileUrl: '/uploads/existing-hdld.pdf', fileName: 'hd.pdf', status: 'ACTIVE', dept: 'Nhân Sự', history: [], amendments: [], notifiedThresholds: [] }
    ],
    docs: [
      { id: 40, uploader: 'u1', status: 'DRAFT', title: 'Tài liệu test', dept: 'Phòng A', cat: '', ver: '', summary: '', fileUrl: '/uploads/existing-doc.pdf', fileName: 'doc.pdf', fileType: 'application/pdf' }
    ],
    submissions: [
      { id: 50, creator: 'u1', status: 'DRAFT', title: 'Tờ trình test', dept: 'Phòng A', type: 'KHAC', priority: 'NORMAL', content: '', fileUrl: '/uploads/existing-submission.pdf', fileName: 'tt.pdf', extraFiles: [], approvalLevel: 'KHAC', selectedApprovalLayers: [], selectedLayerMembers: {} }
    ],
    paymentRequests: [
      { id: 60, createdBy: 'u1', status: 'DRAFT', title: 'ĐNTT test', dept: 'Phòng A', requestFiles: [{ fileUrl: '/uploads/existing-pr.pdf', fileName: 'pr.pdf', fileType: null }], installments: [{ description: 'Đợt 1', amount: null, dueDate: '', files: [], confirmed: false, confirmedAt: null, confirmedBy: null, confirmFileUrl: null, confirmFileName: null, confirmFileType: null }], amount: 0 }
    ],
    itPriceApprovals: [
      { id: 70, creator: 'u1', status: 'PENDING', currentStep: 1, files: [{ id: 1, fileUrl: '/uploads/existing-price.xlsx', fileName: 'gia.xlsx', uploadedBy: 'u1', uploadedByName: 'U1', uploadedAt: '', items: [], columnLabels: [] }], infoRequests: [{ id: 1, response: null }], history: [] }
    ],
    hrProcesses: [
      { id: 80, creator: 'u1', processType: 'ONBOARDING', tasks: [], attachments: [], history: [] }
    ],
    reportEntries: [
      { id: 90, creator: 'u1', status: 'DRAFT', title: 'Báo cáo test', periodId: 900, fileUrl: '/uploads/existing-report.pdf', fileName: 'bc.pdf', fileType: 'application/pdf', parsedSlides: [] }
    ],
    reportPeriods: [
      { id: 900, status: 'OPEN', endTime: null }
    ]
  };
}
function resetRecords() { RECORDS = defaultRecords(); }
resetRecords();

let APPDATA_STORE;
function defaultAppData() {
  return {
    employeeProfiles: [
      { employeeCode: 'NV099', positionKey: null, jobTitle: null, dept: null, positionLabel: null, posType: null, positionHistory: [] }
    ],
    orgChartVersions: [
      { id: 1, status: 'APPLIED', nodes: [{ nodeType: 'POSITION', positionKey: 'POS1', jobTitle: 'Nhân viên IT', requiresDept: false, posType: 'HO' }] }
    ],
    users: []
  };
}
function resetAppData() { APPDATA_STORE = defaultAppData(); }
resetAppData();

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(defaultRecords())),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    // Mirror ĐÚNG hành vi lib/recordStore.js thật: đọc lại Payload JSON thành 1 object MỚI mỗi lần —
    // nếu mutatorFn throw SAU KHI đã mutate item tại chỗ, bản ghi "đã lưu" không bị động tới (transaction
    // thật rollback). Xem chú thích đầy đủ ở tests/test-edit-file-ownership.js.
    const snapshot = JSON.parse(JSON.stringify(list[idx]));
    const updated = await mutatorFn(snapshot);
    list[idx] = updated;
    return updated;
  },
  withAppLock: async (key, fn) => fn()
});
stubModule('lib/appData', {
  getAllAppData: async () => ({}),
  getAppDataValue: async (key) => APPDATA_STORE[key],
  withLockedAppDataValue: async (key, mutatorFn) => {
    const snapshot = JSON.parse(JSON.stringify(APPDATA_STORE[key]));
    const updated = await mutatorFn(snapshot);
    APPDATA_STORE[key] = updated;
    return updated;
  }
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

const U1 = { username: 'u1', name: 'Người Dùng Một', dept: 'Phòng A', perms: { admin: true, hrContractManage: true, hrProfileManage: true }, active: true };
const U2 = { username: 'u2', name: 'Người Dùng Hai', dept: 'Phòng B', perms: {}, active: true };
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
const employeeProfileRoutes = require('../routes/employeeProfile');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordsRoutes);
  app.use('/api/hr-profile', employeeProfileRoutes);
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
  resetAppData();
  uploadedFilesStore.clear();
  uploadedFilesStore.set('/uploads/u1-owned-file.pdf', 'u1');
  uploadedFilesStore.set('/uploads/u2-secret-file.pdf', 'u2');
}

async function main() {
  const server = await startApp();
  try {
    // ===== 1. contracts/:id/edit =====
    reset();
    let r = await api('POST', '/api/records/contracts/10/edit', { fileUrl: '/uploads/u2-secret-file.pdf', fileName: 'moi.pdf', title: 'HĐ Sửa' }, U1);
    check('contracts/edit: chặn gắn tệp của người khác (u2) — 403', r.status === 403, r.body);
    check('contracts/edit: fileUrl KHÔNG bị đổi sau khi chặn', RECORDS.contracts[0].fileUrl === '/uploads/existing-contract-edit.pdf', RECORDS.contracts[0]);
    reset();
    r = await api('POST', '/api/records/contracts/10/edit', { fileUrl: '/uploads/u1-owned-file.pdf', fileName: 'moi.pdf', title: 'HĐ Sửa' }, U1);
    check('contracts/edit: gắn tệp CHÍNH MÌNH -> thành công (200)', r.status === 200, r.body);
    check('contracts/edit: fileUrl mới được lưu đúng', RECORDS.contracts[0].fileUrl === '/uploads/u1-owned-file.pdf', RECORDS.contracts[0]);

    // ===== 2. contracts/:id/upload-signed =====
    reset();
    r = await api('POST', '/api/records/contracts/11/upload-signed', { fileUrl: '/uploads/u2-secret-file.pdf', fileName: 'ky.pdf' }, U1);
    check('contracts/upload-signed: chặn gắn tệp của người khác (u2) — 403', r.status === 403, r.body);
    check('contracts/upload-signed: signedFileUrl vẫn null sau khi chặn', RECORDS.contracts[1].signedFileUrl === null, RECORDS.contracts[1]);
    reset();
    r = await api('POST', '/api/records/contracts/11/upload-signed', { fileUrl: '/uploads/u1-owned-file.pdf', fileName: 'ky.pdf' }, U1);
    check('contracts/upload-signed: gắn tệp CHÍNH MÌNH -> thành công (200)', r.status === 200, r.body);
    check('contracts/upload-signed: signedFileUrl mới được lưu đúng', RECORDS.contracts[1].signedFileUrl === '/uploads/u1-owned-file.pdf', RECORDS.contracts[1]);

    // ===== 3. officeReqs/:id/upload-signed =====
    reset();
    r = await api('POST', '/api/records/officeReqs/20/upload-signed', { fileUrl: '/uploads/u2-secret-file.pdf', fileName: 'ky.pdf' }, U1);
    check('officeReqs/upload-signed: chặn gắn tệp của người khác (u2) — 403', r.status === 403, r.body);
    check('officeReqs/upload-signed: signedFileUrl vẫn null sau khi chặn', RECORDS.officeReqs[0].signedFileUrl === null, RECORDS.officeReqs[0]);
    reset();
    r = await api('POST', '/api/records/officeReqs/20/upload-signed', { fileUrl: '/uploads/u1-owned-file.pdf', fileName: 'ky.pdf' }, U1);
    check('officeReqs/upload-signed: gắn tệp CHÍNH MÌNH -> thành công (200)', r.status === 200, r.body);
    check('officeReqs/upload-signed: signedFileUrl mới được lưu đúng', RECORDS.officeReqs[0].signedFileUrl === '/uploads/u1-owned-file.pdf', RECORDS.officeReqs[0]);

    // ===== 4. laborContracts/:id/add-amendment =====
    reset();
    r = await api('POST', '/api/records/laborContracts/30/add-amendment', { amendmentType: 'Tăng lương', effectiveDate: '2026-02-01', fileUrl: '/uploads/u2-secret-file.pdf' }, U1);
    check('laborContracts/add-amendment: chặn gắn tệp của người khác (u2) — 403', r.status === 403, r.body);
    check('laborContracts/add-amendment: KHÔNG thêm amendment nào sau khi chặn', RECORDS.laborContracts[0].amendments.length === 0, RECORDS.laborContracts[0]);
    reset();
    r = await api('POST', '/api/records/laborContracts/30/add-amendment', { amendmentType: 'Tăng lương', effectiveDate: '2026-02-01', fileUrl: '/uploads/u1-owned-file.pdf' }, U1);
    check('laborContracts/add-amendment: gắn tệp CHÍNH MÌNH -> thành công (200)', r.status === 200, r.body);
    check('laborContracts/add-amendment: amendment mới được thêm đúng fileUrl', RECORDS.laborContracts[0].amendments[0]?.fileUrl === '/uploads/u1-owned-file.pdf', RECORDS.laborContracts[0]);

    // ===== 5. hr-profile/by-code/:employeeCode/set-position =====
    reset();
    r = await api('POST', '/api/hr-profile/by-code/NV099/set-position', { positionKey: 'POS1', effectiveDate: '2026-02-01', fileUrl: '/uploads/u2-secret-file.pdf', fileName: 'qd.pdf' }, U1);
    check('hr-profile/set-position: chặn gắn tệp của người khác (u2) — 403', r.status === 403, r.body);
    check('hr-profile/set-position: KHÔNG đổi chức vụ sau khi chặn', APPDATA_STORE.employeeProfiles[0].positionKey === null, APPDATA_STORE.employeeProfiles[0]);
    reset();
    r = await api('POST', '/api/hr-profile/by-code/NV099/set-position', { positionKey: 'POS1', effectiveDate: '2026-02-01', fileUrl: '/uploads/u1-owned-file.pdf', fileName: 'qd.pdf' }, U1);
    check('hr-profile/set-position: gắn tệp CHÍNH MÌNH -> thành công (200)', r.status === 200, r.body);
    check('hr-profile/set-position: positionHistory ghi đúng fileUrl', APPDATA_STORE.employeeProfiles[0].positionHistory[0]?.fileUrl === '/uploads/u1-owned-file.pdf', APPDATA_STORE.employeeProfiles[0]);

    // ===== 6. docs/:id/update =====
    reset();
    r = await api('POST', '/api/records/docs/40/update', { fileUrl: '/uploads/u2-secret-file.pdf', fileName: 'moi.pdf' }, U1);
    check('docs/update: chặn gắn tệp của người khác (u2) — 403', r.status === 403, r.body);
    check('docs/update: fileUrl KHÔNG bị đổi sau khi chặn', RECORDS.docs[0].fileUrl === '/uploads/existing-doc.pdf', RECORDS.docs[0]);
    reset();
    r = await api('POST', '/api/records/docs/40/update', { fileUrl: '/uploads/u1-owned-file.pdf', fileName: 'moi.pdf' }, U1);
    check('docs/update: gắn tệp CHÍNH MÌNH -> thành công (200)', r.status === 200, r.body);
    check('docs/update: fileUrl mới được lưu đúng', RECORDS.docs[0].fileUrl === '/uploads/u1-owned-file.pdf', RECORDS.docs[0]);

    // ===== 7. submissions/:id/update =====
    reset();
    r = await api('POST', '/api/records/submissions/50/update', { fileUrl: '/uploads/u2-secret-file.pdf', approvalLevel: 'KHAC', selectedApprovalLayers: [] }, U1);
    check('submissions/update: chặn gắn tệp của người khác (u2) — 403', r.status === 403, r.body);
    check('submissions/update: fileUrl KHÔNG bị đổi sau khi chặn', RECORDS.submissions[0].fileUrl === '/uploads/existing-submission.pdf', RECORDS.submissions[0]);
    reset();
    r = await api('POST', '/api/records/submissions/50/update', { fileUrl: '/uploads/u1-owned-file.pdf', approvalLevel: 'KHAC', selectedApprovalLayers: [] }, U1);
    check('submissions/update: gắn tệp CHÍNH MÌNH -> thành công (200)', r.status === 200, r.body);
    check('submissions/update: fileUrl mới được lưu đúng', RECORDS.submissions[0].fileUrl === '/uploads/u1-owned-file.pdf', RECORDS.submissions[0]);
    // extraFiles[] cùng lớp bảo vệ
    reset();
    r = await api('POST', '/api/records/submissions/50/update', { extraFiles: [{ fileUrl: '/uploads/u2-secret-file.pdf', fileName: 'phu.pdf' }], approvalLevel: 'KHAC', selectedApprovalLayers: [] }, U1);
    check('submissions/update: chặn extraFiles[] chứa tệp của người khác — 403', r.status === 403, r.body);

    // ===== 8. paymentRequests/:id/edit =====
    reset();
    r = await api('POST', '/api/records/paymentRequests/60/edit', { requestFiles: [{ fileUrl: '/uploads/u2-secret-file.pdf', fileName: 'pr.pdf' }] }, U1);
    check('paymentRequests/edit: chặn gắn tệp của người khác (u2) — 403', r.status === 403, r.body);
    check('paymentRequests/edit: requestFiles KHÔNG bị đổi sau khi chặn', RECORDS.paymentRequests[0].requestFiles[0].fileUrl === '/uploads/existing-pr.pdf', RECORDS.paymentRequests[0]);
    reset();
    r = await api('POST', '/api/records/paymentRequests/60/edit', { requestFiles: [{ fileUrl: '/uploads/u1-owned-file.pdf', fileName: 'pr.pdf' }] }, U1);
    check('paymentRequests/edit: gắn tệp CHÍNH MÌNH -> thành công (200)', r.status === 200, r.body);
    check('paymentRequests/edit: requestFiles mới được lưu đúng', RECORDS.paymentRequests[0].requestFiles[0].fileUrl === '/uploads/u1-owned-file.pdf', RECORDS.paymentRequests[0]);

    // ===== 9. itPriceApprovals/:id/submit-supplement =====
    reset();
    r = await api('POST', '/api/records/itPriceApprovals/70/submit-supplement', { file: { fileUrl: '/uploads/u2-secret-file.pdf', fileName: 'bo-sung.xlsx', items: [{ values: { c0: 'Sản phẩm A', c1: '10000' } }] } }, U1);
    check('itPriceApprovals/submit-supplement: chặn gắn tệp của người khác (u2) — 403', r.status === 403, r.body);
    check('itPriceApprovals/submit-supplement: KHÔNG thêm tệp nào sau khi chặn', RECORDS.itPriceApprovals[0].files.length === 1, RECORDS.itPriceApprovals[0]);
    reset();
    r = await api('POST', '/api/records/itPriceApprovals/70/submit-supplement', { file: { fileUrl: '/uploads/u1-owned-file.pdf', fileName: 'bo-sung.xlsx', items: [{ values: { c0: 'Sản phẩm A', c1: '10000' } }] } }, U1);
    check('itPriceApprovals/submit-supplement: gắn tệp CHÍNH MÌNH -> thành công (200)', r.status === 200, r.body);
    check('itPriceApprovals/submit-supplement: tệp mới được thêm đúng', RECORDS.itPriceApprovals[0].files[1]?.fileUrl === '/uploads/u1-owned-file.pdf', RECORDS.itPriceApprovals[0]);

    // ===== 10. hrProcesses/:id/attachments =====
    reset();
    r = await api('POST', '/api/records/hrProcesses/80/attachments', { fileUrl: '/uploads/u2-secret-file.pdf', fileName: 'dinh-kem.pdf' }, U1);
    check('hrProcesses/attachments: chặn gắn tệp của người khác (u2) — 403', r.status === 403, r.body);
    check('hrProcesses/attachments: KHÔNG thêm attachment nào sau khi chặn', RECORDS.hrProcesses[0].attachments.length === 0, RECORDS.hrProcesses[0]);
    reset();
    r = await api('POST', '/api/records/hrProcesses/80/attachments', { fileUrl: '/uploads/u1-owned-file.pdf', fileName: 'dinh-kem.pdf' }, U1);
    check('hrProcesses/attachments: gắn tệp CHÍNH MÌNH -> thành công (200)', r.status === 200, r.body);
    check('hrProcesses/attachments: attachment mới được thêm đúng', RECORDS.hrProcesses[0].attachments[0]?.fileUrl === '/uploads/u1-owned-file.pdf', RECORDS.hrProcesses[0]);

    // ===== 11. reportEntries/:id/update =====
    reset();
    r = await api('POST', '/api/records/reportEntries/90/update', { title: 'Báo cáo test', fileUrl: '/uploads/u2-secret-file.pdf', fileName: 'moi.pdf' }, U1);
    check('reportEntries/update: chặn gắn tệp của người khác (u2) — 403', r.status === 403, r.body);
    check('reportEntries/update: fileUrl KHÔNG bị đổi sau khi chặn', RECORDS.reportEntries[0].fileUrl === '/uploads/existing-report.pdf', RECORDS.reportEntries[0]);
    reset();
    r = await api('POST', '/api/records/reportEntries/90/update', { title: 'Báo cáo test', fileUrl: '/uploads/u1-owned-file.pdf', fileName: 'moi.pdf' }, U1);
    check('reportEntries/update: gắn tệp CHÍNH MÌNH -> thành công (200)', r.status === 200, r.body);
    check('reportEntries/update: fileUrl mới được lưu đúng', RECORDS.reportEntries[0].fileUrl === '/uploads/u1-owned-file.pdf', RECORDS.reportEntries[0]);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
