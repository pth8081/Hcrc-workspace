// server/tests/test-audit-round2-vbt-hd-gp-tt-tl.js
//
// Regression test cho ĐỢT RÀ SOÁT VÒNG 2 (cụm "Văn Bản Trình / Hợp Đồng / Giấy Phép / Thanh Toán / Tài
// Liệu") — 6/9 phát hiện có kịch bản kiểm được bằng test tự động (bỏ qua #5 gốc đã gộp sang cụm Hệ
// Thống/Admin, #8 catalogRename cascade — kiểm ở test riêng của cụm đó — và #10 tài liệu thuần văn bản):
//
//   1. [Cao] POST /api/workflow/submissions/:id/propose-file-replacement KHÔNG xác minh quyền sở hữu
//      tệp — approver có thể trỏ extraFields.fileUrl sang tệp của hồ sơ BẤT KỲ khác.
//   2. [Cao] POST /api/records/paymentRequests/from-source ghi requestFiles/installments[].files client
//      gửi mà không kiểm quyền sở hữu tệp.
//   3. [Cao] createValidation.js licenses.extraValidate: ai có licenseCreate cũng tạo được "phiên bản
//      mới" cho giấy phép của NGƯỜI KHÁC.
//   4. [TB]  lib/positionApprovers.js resolveStepApproverUsernames(): approver PEOPLE-mode bị khoá tài
//      khoản vẫn nằm trong approvers[] -> bước duyệt treo vĩnh viễn.
//   6. [Thấp] createValidation.js paymentRequests.extraValidate: 'dept' không đối chiếu danh mục lúc TẠO.
//   7. [Thấp] createValidation.js docs/contracts.extraValidate: 'cat'/'type' không đối chiếu danh mục lúc
//      TẠO + editDocDraft()/editContract() không sinh lại code/displayCode khi đổi 2 field này lúc SỬA.
//   9. [Thấp] editDocDraft()/editSubmissionDraft()/editContract(): hồ sơ NHÁP/BỊ TỪ CHỐI chỉ đúng người
//      tạo sửa được, admin cũng không -> mở lối thoát cho admin.
//
// Phần 1+2 (route thật qua HTTP): mirror khuôn tests/test-edit-file-ownership.js — mount router THẬT
// (routes/workflow.js + routes/records.js), lib/uploadedFiles.js THẬT (chỉ giả lập 'db' bằng fakePool),
// chỉ stub tầng lưu trữ (lib/recordStore/lib/appData) + lib/auth.
// Phần 3-9 (hàm thuần): mirror khuôn tests/test-audit-cluster-vbt-hd-gp-tt-tl.js — gọi THẲNG các hàm
// thật ở lib/createValidation.js/lib/recordActions.js/lib/positionApprovers.js/lib/workflowEngine.js.
//
// Chạy: node server/tests/test-audit-round2-vbt-hd-gp-tt-tl.js
'use strict';
const http = require('http');
const path = require('path');
const assert = require('assert');

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

// ===================== Phần 1+2: route thật qua HTTP =====================
// Fake pool cho dbo.UploadedFiles (mirror test-edit-file-ownership.js).
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

const DEPT_A = 'Kinh Doanh';
const DEPT_B = 'Marketing';
const APP_DATA_HTTP = {
  depts: [DEPT_A, DEPT_B], stores: [],
  submissionDeptWorkflows: {}, submissionTypeDeptWorkflows: {},
  paymentDeptWorkflows: { [DEPT_A]: { workflowId: 'WF_1STEP', approvers: { 1: ['sep1'] } } },
  workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }]
};

let RECORDS;
function resetHttpRecords() {
  RECORDS = {
    submissions: [{
      id: 1, code: 'HCRC-KD-VBT-001', dept: DEPT_A, creator: 'nguoi_trinh', type: 'Tờ trình khác',
      status: 'PENDING', currentStep: 1, history: [], fileUrl: '/uploads/goc.pdf',
      effectiveSteps: [{ order: 1, name: 'Duyệt' }], effectiveApprovers: { 1: ['approver1'] },
      extraFiles: []
    }],
    contracts: [{
      id: 20, code: 'HCRC-KD-HDKT-001', dept: DEPT_A, custodianDept: DEPT_A, creator: 'kd1',
      signedFileUrl: '/uploads/da-ky.pdf', signedFileStatus: 'APPROVED',
      paymentStatus: 'CHUA_THANH_TOAN', paymentType: 'ONE_TIME', amount: 1000000,
      paymentInstallments: [], pendingPaymentTypeChange: null
    }],
    paymentRequests: []
  };
}
resetHttpRecords();

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['submissions', 'contracts', 'officeReqs', 'paymentRequests']),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy hồ sơ'); }
    // Snapshot rời tham chiếu (mirror test-edit-file-ownership.js) — throw giữa chừng không để lại
    // thay đổi dở dang trong bản ghi "đã lưu", đúng hành vi rollback thật.
    const snapshot = JSON.parse(JSON.stringify(list[idx]));
    const updated = await mutatorFn(snapshot);
    list[idx] = updated;
    return updated;
  },
  createForCollection: async (collection, factory) => {
    const rec = factory();
    RECORDS[collection] = RECORDS[collection] || [];
    RECORDS[collection].push(rec);
    return rec;
  },
  withAppLock: async (keys, fn) => fn()
});
stubModule('lib/appData', { getAllAppData: async () => APP_DATA_HTTP });
stubModule('lib/taskStore', { insertTask: async () => {} });
stubModule('lib/approvalAuth', { consumeApprovalGrant: async () => true });
stubModule('lib/employeeProfile', {});
stubModule('lib/laborContract', {});
stubModule('lib/attendance', {});
stubModule('lib/operationWorkItemStore', {});
stubModule('lib/recordViewScope', {
  sanitizeInternalPostCommentsForUser: (x) => x, canViewInternalPost: () => true,
  assertNoManagerCycle: () => {}, hasModuleAccessServer: () => true
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

const USERS_HTTP = [
  { username: 'nguoi_trinh', name: 'Người Trình', dept: DEPT_A, perms: { submissionCreate: { all: false, depts: [DEPT_A] } }, active: true },
  { username: 'approver1', name: 'Người Duyệt 1', dept: DEPT_A, perms: {}, active: true },
  { username: 'ke_toan1', name: 'Kế Toán 1', dept: DEPT_B, perms: { paymentManage: true }, active: true },
  { username: 'nan_nhan', name: 'Nạn Nhân (chủ file nhạy cảm)', dept: DEPT_A, perms: {}, active: true }
];
let CURRENT_USERNAME_HTTP = 'nguoi_trinh';
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS_HTTP.find(u => u.username === CURRENT_USERNAME_HTTP);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS_HTTP;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const workflowRoutes = require('../routes/workflow');
const recordsRoutes = require('../routes/records');

let HTTP_PORT = 0;
function startHttpApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/workflow', workflowRoutes);
  app.use('/api/records', recordsRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { HTTP_PORT = server.address().port; resolve(server); });
  });
}
async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME_HTTP = asUser.username;
  const res = await fetch(`http://127.0.0.1:${HTTP_PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function runHttpTests() {
  const server = await startHttpApp();
  try {
    // ===== 1. propose-file-replacement =====
    resetHttpRecords(); uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/ho-so-nhay-cam-cua-nan-nhan.pdf', 'nan_nhan');
    const r1a = await api('POST', '/api/workflow/submissions/1/propose-file-replacement',
      { comment: 'thay tệp', extraFields: { fileUrl: '/uploads/ho-so-nhay-cam-cua-nan-nhan.pdf', fileName: 'x.pdf' } },
      { username: 'approver1' });
    check('LỖI ĐÃ VÁ #1: propose-file-replacement chặn approver trỏ fileUrl của NGƯỜI KHÁC — 403', r1a.status === 403, r1a.body);
    check('Tờ trình KHÔNG bị gán pendingFileProposal sau khi bị chặn', !RECORDS.submissions[0].pendingFileProposal, RECORDS.submissions[0]);

    resetHttpRecords(); uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/tep-that-cua-approver1.pdf', 'approver1');
    const r1b = await api('POST', '/api/workflow/submissions/1/propose-file-replacement',
      { comment: 'thay tệp', extraFields: { fileUrl: '/uploads/tep-that-cua-approver1.pdf', fileName: 'x.pdf' } },
      { username: 'approver1' });
    check('KHÔNG chặn nhầm: propose-file-replacement với tệp CHÍNH approver vừa tải lên -> 200', r1b.status === 200, r1b.body);
    check('pendingFileProposal được gán đúng tệp', RECORDS.submissions[0].pendingFileProposal?.fileUrl === '/uploads/tep-that-cua-approver1.pdf', RECORDS.submissions[0]);

    resetHttpRecords(); uploadedFilesStore.clear();
    const r1c = await api('POST', '/api/workflow/submissions/1/propose-file-replacement',
      { comment: 'thay tệp', extraFields: { fileUrl: '/uploads/tep-khong-ro-chu.pdf', fileName: 'x.pdf' } },
      { username: 'approver1' });
    check('KHÔNG chặn nhầm: tệp KHÔNG có trong bảng UploadedFiles (dữ liệu cũ) vẫn cho qua', r1c.status === 200, r1c.body);

    // ===== 2. paymentRequests/from-source =====
    resetHttpRecords(); uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/ho-so-nhay-cam-cua-nan-nhan.pdf', 'nan_nhan');
    const r2a = await api('POST', '/api/records/paymentRequests/from-source', {
      sourceModule: 'CONTRACT', sourceId: 20,
      requestFiles: [{ fileUrl: '/uploads/ho-so-nhay-cam-cua-nan-nhan.pdf', fileName: 'x.pdf' }]
    }, { username: 'ke_toan1' });
    check('LỖI ĐÃ VÁ #2: from-source chặn requestFiles trỏ tệp của NGƯỜI KHÁC — 403', r2a.status === 403, r2a.body);
    check('KHÔNG có đề nghị thanh toán nào được tạo ra sau khi bị chặn', RECORDS.paymentRequests.length === 0, RECORDS.paymentRequests);

    resetHttpRecords(); uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/ho-so-nhay-cam-cua-nan-nhan.pdf', 'nan_nhan');
    const r2b = await api('POST', '/api/records/paymentRequests/from-source', {
      sourceModule: 'CONTRACT', sourceId: 20,
      installments: [{ description: 'Đợt 1', amount: 1000000, files: [{ fileUrl: '/uploads/ho-so-nhay-cam-cua-nan-nhan.pdf', fileName: 'x.pdf' }] }]
    }, { username: 'ke_toan1' });
    check('LỖI ĐÃ VÁ #2b: from-source chặn installments[].files trỏ tệp của NGƯỜI KHÁC — 403', r2b.status === 403, r2b.body);

    resetHttpRecords(); uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/ke-toan1-tu-tai-len.pdf', 'ke_toan1');
    const r2c = await api('POST', '/api/records/paymentRequests/from-source', {
      sourceModule: 'CONTRACT', sourceId: 20,
      requestFiles: [{ fileUrl: '/uploads/ke-toan1-tu-tai-len.pdf', fileName: 'x.pdf' }]
    }, { username: 'ke_toan1' });
    check('KHÔNG chặn nhầm: from-source với tệp CHÍNH kế toán vừa tải lên -> 200', r2c.status === 200, r2c.body);
    check('Đề nghị thanh toán được tạo đúng 1 bản ghi', RECORDS.paymentRequests.length === 1, RECORDS.paymentRequests);
  } finally {
    server.close();
  }
}

// ===================== Phần 3-9: hàm thuần =====================
function expectThrow(fn, reMsg, label) {
  let thrown = null;
  try { fn(); } catch (e) { thrown = e; }
  assert.ok(thrown, `${label}: mong đợi ném lỗi nhưng KHÔNG ném`);
  if (reMsg) assert.ok(reMsg.test(thrown.message), `${label}: thông điệp lỗi không khớp — "${thrown.message}"`);
  return thrown;
}
async function run(name, fn) {
  try { await fn(); pass++; console.log(`PASS: ${name}`); }
  catch (err) { fail++; console.error(`FAIL: ${name}\n      ${err.message}`); }
}

async function runPureTests() {
  // db thật (getPool) không được dùng bởi các hàm thuần này (chỉ dữ liệu trong bộ nhớ) — nhưng
  // lib/positionApprovers.js/lib/createValidation.js/lib/recordActions.js không require('../db') trực
  // tiếp nên không cần stub thêm gì ở đây (đã stub 'db' + 'lib/recordStore' ở Phần 1+2 bên trên rồi,
  // require.cache dùng lại nguyên).
  const { validateAndPrepareCreate, CreateError } = require('../lib/createValidation');
  const recordActions = require('../lib/recordActions');
  const { resolveStepApproverUsernames } = require('../lib/positionApprovers');
  const { isStepApprovalComplete, canApproveStep, applyWorkflowAction, WorkflowError } = require('../lib/workflowEngine');

  const APP_DATA = {
    depts: [DEPT_A, DEPT_B], stores: ['Siêu Thị A'],
    deptAbbrs: { [DEPT_A]: 'KD' }, docCatAbbrs: { 'Quy trình': 'QT' }, contractTypeAbbrs: { 'Hợp đồng kinh tế': 'HDKT' },
    cats: ['Quy trình'], contractTypes: ['Hợp đồng kinh tế'], formTemplates: {},
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    contractApprovalGroups: [], contractApprovalLevels: [{ id: 'TGD', label: 'TGĐ', order: 1, visibleGroupIds: [], lockedGroupIds: [] }],
    contractApprovalDeptWorkflows: {}, paymentDeptWorkflows: {}, users: []
  };
  const USER_A = { username: 'u_a', name: 'Người A', dept: DEPT_A, perms: {
    contractCreate: { all: false, depts: [DEPT_A] }, uploadAll: false, uploadDepts: [DEPT_A],
    licenseCreate: true, paymentManage: true
  } };
  const ADMIN = { username: 'admin', name: 'Quản Trị', dept: DEPT_A, perms: { admin: true } };

  // ================= 3. [Cao] Giấy Phép: phiên bản mới của NGƯỜI KHÁC =================
  const rootLicense = { id: 1, code: 'HCRC-KD-GP-001', displayCode: 'HCRC-KD-GP-001', creator: 'nguoi_tao_goc', rootLicenseId: null, status: 'APPROVED', versionNumber: 1 };
  const newVersionPayload = () => ({
    rootLicenseId: 1, companyName: 'CT', locationName: 'ĐĐ', licenseType: 'GPKD', licenseNumber: '123',
    issuingAuthority: 'SKHĐT', operatingStatus: 'ACTIVE', issueDate: '2026-01-01', expiryDate: '2027-01-01',
    fileUrl: '/uploads/x.pdf', fileName: 'x.pdf'
  });
  await run('3a. licenses: NGƯỜI KHÁC (có licenseCreate, không phải root.creator) tạo phiên bản mới -> 403 (trước vá: chỉ kiểm "bản mới nhất không PENDING")', async () => {
    const err = expectThrow(() => validateAndPrepareCreate('licenses', newVersionPayload(), USER_A, [rootLicense], APP_DATA, []),
      /Chỉ người tạo giấy phép gốc/i, '3a');
    assert.strictEqual(err.status, 403);
  });
  await run('3b. KHÔNG chặn nhầm: chính root.creator tạo phiên bản mới cho giấy phép của mình -> thành công', async () => {
    const creator = { ...USER_A, username: 'nguoi_tao_goc' };
    const rec = validateAndPrepareCreate('licenses', newVersionPayload(), creator, [rootLicense], APP_DATA, []);
    assert.strictEqual(rec.code, 'HCRC-KD-GP-001-V2');
  });
  await run('3c. KHÔNG chặn nhầm: admin vẫn tạo được phiên bản mới cho giấy phép của người khác', async () => {
    const rec = validateAndPrepareCreate('licenses', newVersionPayload(), ADMIN, [rootLicense], APP_DATA, []);
    assert.strictEqual(rec.versionNumber, 2);
  });

  // ================= 4. [TB] approver PEOPLE-mode bị khoá tài khoản -> bước duyệt treo vĩnh viễn =====
  // LƯU Ý THIẾT KẾ: lọc active KHÔNG đặt trong resolveStepApproverUsernames() (lib/positionApprovers.js —
  // vẫn PHẢI trả danh sách THÔ cho các nơi CỐ Ý cần thấy cả người đã khoá, VD công cụ cảnh báo admin
  // findPendingApprovalsForUsername() ở public/js/core-approvalhub.js), mà đặt NGAY TẠI applyWorkflowAction()
  // (lib/workflowEngine.js) — điểm DUY NHẤT canApproveStep()/isStepApprovalComplete() dùng để GÁC hành
  // động Duyệt/Từ chối thật — xem chú thích đầy đủ ở đó.
  const docBase = () => ({
    id: 50, code: 'DOC-1', displayCode: 'DOC-1', dept: DEPT_A, cat: 'Quy trình', uploader: 'nguoi_tai_len',
    status: 'PENDING', currentStep: 1, history: [], fileUrl: '/uploads/x.pdf', title: 'TL'
  });
  const APP_DATA_DOC = { ...APP_DATA, deptWorkflows: { [DEPT_A]: { workflowId: 'WF_1STEP', approvers: { 1: ['active1', 'locked1'] } } } };
  const USERS_MIXED = [
    { username: 'active1', name: 'Approver Active', active: true, perms: {} },
    { username: 'locked1', name: 'Approver Khoá', active: false, perms: {} }
  ];
  await run('4a. LỖI ĐÃ VÁ: approver ACTIVE hoàn tất được bước dù approver KIA (cùng bước, PEOPLE-mode) đã bị khoá tài khoản (trước vá: isStepApprovalComplete đòi ĐỦ cả 2, treo vĩnh viễn)', () => {
    const item = docBase();
    const out = applyWorkflowAction({
      moduleKey: 'docs', item, action: 'APPROVE', user: { username: 'active1', name: 'Approver Active', perms: {} },
      comment: '', appData: APP_DATA_DOC, users: USERS_MIXED
    });
    assert.strictEqual(out.item.status, 'APPROVED', `phải hoàn tất ngay (bước 1 = bước cuối), status thật: ${out.item.status}`);
  });
  await run('4b. KHÔNG chặn nhầm: cả 2 approver ĐỀU active -> vẫn cần CẢ 2 duyệt mới hoàn tất (hành vi đồng phê duyệt giữ nguyên)', () => {
    const item = docBase();
    const bothActive = [{ username: 'active1', active: true, perms: {} }, { username: 'active2', active: true, perms: {} }];
    const appDataBoth = { ...APP_DATA, deptWorkflows: { [DEPT_A]: { workflowId: 'WF_1STEP', approvers: { 1: ['active1', 'active2'] } } } };
    const out1 = applyWorkflowAction({ moduleKey: 'docs', item, action: 'APPROVE', user: { username: 'active1', name: 'A1', perms: {} }, comment: '', appData: appDataBoth, users: bothActive });
    assert.strictEqual(out1.item.status, 'PENDING', 'mới 1/2 duyệt -> chưa hoàn tất');
    assert.strictEqual(out1.transition.type, 'PARTIAL_APPROVE');
  });
  await run('4c. Approver bị khoá KHÔNG tự duyệt được (canApproveStep vẫn từ chối — active giờ chỉ gỡ khỏi yêu cầu "đủ người", không cấp thêm quyền)', () => {
    const item = docBase();
    const err = expectThrow(() => applyWorkflowAction({
      moduleKey: 'docs', item, action: 'APPROVE', user: { username: 'locked1', name: 'Approver Khoá', perms: {} },
      comment: '', appData: APP_DATA_DOC, users: USERS_MIXED
    }), /không có quyền xử lý ở bước hiện tại/i, '4c');
    assert.strictEqual(err.status, 403);
  });
  await run('4d. AN TOÀN: TẤT CẢ approver của bước đều bị khoá -> user thường KHÔNG tự ý duyệt được (danh sách rỗng sau lọc không bị hiểu nhầm là "đã duyệt")', () => {
    const item = docBase();
    const allLocked = [{ username: 'active1', active: false, perms: {} }, { username: 'locked1', active: false, perms: {} }];
    expectThrow(() => applyWorkflowAction({
      moduleKey: 'docs', item, action: 'APPROVE', user: { username: 'active1', name: 'A1', perms: {} },
      comment: '', appData: APP_DATA_DOC, users: allLocked
    }), /không có quyền xử lý ở bước hiện tại/i, '4d');
    // admin vẫn có lối thoát riêng (isAdminOverride, hành vi CŨ giữ nguyên — không phải phạm vi lỗi này).
    const out = applyWorkflowAction({
      moduleKey: 'docs', item, action: 'APPROVE', user: { username: 'admin', name: 'Admin', perms: { admin: true } },
      comment: '', appData: APP_DATA_DOC, users: allLocked
    });
    assert.strictEqual(out.item.status, 'APPROVED');
  });
  await run('4e. resolveStepApproverUsernames() (lib/positionApprovers.js) GIỮ NGUYÊN hành vi cũ — KHÔNG lọc active (công cụ cảnh báo admin trước khi khoá tài khoản cố ý cần thấy người ĐÃ khoá)', () => {
    const cfg = { approvers: { 1: ['active1', 'locked1'] } };
    const result = resolveStepApproverUsernames(cfg, 1, USERS_MIXED);
    assert.deepStrictEqual(result.sort(), ['active1', 'locked1'], 'vẫn trả NGUYÊN danh sách cấu hình, không lọc ở điểm tra cứu chung này');
  });

  // ================= 6. [Thấp] paymentRequests: dept không đối chiếu danh mục lúc TẠO =================
  const manualPrPayload = (over) => Object.assign({
    dept: DEPT_A, title: 'ĐNTT thủ công', installments: [{ description: 'Đợt 1', amount: 1000000 }], requestFiles: []
  }, over || {});
  await run('6a. TẠO thủ công: dept KHÔNG có trong danh mục depts/stores -> 400 (trước vá: nhận nguyên chuỗi client gửi)', () => {
    const err = expectThrow(() => validateAndPrepareCreate('paymentRequests', manualPrPayload({ dept: 'Phòng Ma' }), USER_A, [], APP_DATA, []),
      /Phòng ban không hợp lệ/i, '6a');
    assert.strictEqual(err.status, 400);
  });
  await run('6b. TẠO thủ công: dept CHỈ TOÀN khoảng trắng -> 400 (qua được lớp kiểm "Thiếu phòng ban" chung, phải bị chặn ở extraValidate riêng)', () => {
    expectThrow(() => validateAndPrepareCreate('paymentRequests', manualPrPayload({ dept: '   ' }), USER_A, [], APP_DATA, []),
      /Vui lòng chọn Phòng Ban/i, '6b');
  });
  await run('6c. KHÔNG chặn nhầm: dept khớp đúng danh mục -> tạo được bình thường', () => {
    const rec = validateAndPrepareCreate('paymentRequests', manualPrPayload(), USER_A, [], APP_DATA, []);
    assert.strictEqual(rec.dept, DEPT_A);
    assert.strictEqual(rec.status, 'DRAFT');
  });

  // ================= 7. [Thấp] docs.cat/contracts.type không đối chiếu danh mục + code regen =================
  await run('7a. TẠO docs: cat KHÔNG có trong appData.cats -> 400 (trước vá: mã vẫn sinh được với viết tắt bịa)', () => {
    const err = expectThrow(() => validateAndPrepareCreate('docs', {
      dept: DEPT_A, cat: 'Phân Loại Bịa', title: 'TL', ver: '1.0', fileUrl: '/uploads/x.pdf', fileName: 'x.pdf', rootDocId: null
    }, USER_A, [], APP_DATA, []), /Phân loại tài liệu không hợp lệ/i, '7a');
    assert.strictEqual(err.status, 400);
  });
  await run('7a-bis. KHÔNG chặn nhầm: docs cat hợp lệ -> tạo được, phiên bản mới KHÔNG bị đòi hỏi đối chiếu (kế thừa root.cat sẵn)', () => {
    const rec = validateAndPrepareCreate('docs', {
      dept: DEPT_A, cat: 'Quy trình', title: 'TL', ver: '1.0', fileUrl: '/uploads/x.pdf', fileName: 'x.pdf', rootDocId: null
    }, USER_A, [], APP_DATA, []);
    assert.strictEqual(rec.code, 'QT-KD-001');
  });
  await run('7b. TẠO contracts (gốc): type KHÔNG có trong appData.contractTypes -> 400', () => {
    const err = expectThrow(() => validateAndPrepareCreate('contracts', {
      dept: DEPT_A, custodianDept: DEPT_A, type: 'Loại Bịa', title: 'HĐ', partner: 'X', amount: 1000,
      startDate: '2026-01-01', endDate: '2026-12-31', fileUrl: '/uploads/x.pdf', fileName: 'x.pdf',
      approvalLevel: 'TGD', selectedApprovalLayers: [], selectedLayerMembers: {}, paymentInstallments: []
    }, USER_A, [], APP_DATA, []), /Loại pháp lý hợp đồng không hợp lệ/i, '7b');
    assert.strictEqual(err.status, 400);
  });

  // ----- editDocDraft(): đổi cat lúc SỬA phải sinh lại code/displayCode -----
  const docDraft = () => ({
    id: 5, code: 'QT-KD-001', displayCode: 'QT-KD-001', rootDocId: null, dept: DEPT_A, cat: 'Quy trình',
    uploader: 'u_a', status: 'DRAFT', title: 'TL', ver: '1.0', fileUrl: '/uploads/x.pdf', fileName: 'x.pdf'
  });
  const APP_DATA_2CATS = { ...APP_DATA, cats: ['Quy trình', 'Báo cáo'], docCatAbbrs: { 'Quy trình': 'QT', 'Báo cáo': 'BC' } };
  await run('7c. editDocDraft(): đổi cat -> sinh lại code/displayCode khớp phân loại MỚI (trước vá: giữ nguyên mã cũ, lệch phân loại)', () => {
    const item = docDraft();
    const existing = [item];
    const updated = recordActions.editDocDraft({ cat: 'Báo cáo' }, USER_A, item, APP_DATA_2CATS, existing);
    assert.strictEqual(updated.cat, 'Báo cáo');
    assert.strictEqual(updated.code, 'BC-KD-001', `mã thật: ${updated.code}`);
    assert.strictEqual(updated.displayCode, 'BC-KD-001');
  });
  await run('7d. editDocDraft(): đổi cat sang giá trị KHÔNG có trong danh mục -> 400', () => {
    const item = docDraft();
    expectThrow(() => recordActions.editDocDraft({ cat: 'Phân Loại Bịa' }, USER_A, item, APP_DATA_2CATS, [item]),
      /Phân loại tài liệu không hợp lệ/i, '7d');
  });
  await run('7e. KHÔNG chặn nhầm: editDocDraft() sửa field khác (không đụng cat/dept) -> mã giữ nguyên', () => {
    const item = docDraft();
    const updated = recordActions.editDocDraft({ title: 'TL sửa lại' }, USER_A, item, APP_DATA_2CATS, [item]);
    assert.strictEqual(updated.code, 'QT-KD-001', 'mã KHÔNG được sinh lại khi cat/dept không đổi');
  });

  // ----- editContract(): đổi type lúc SỬA phải sinh lại code -----
  const contractDraft = () => ({
    id: 6, code: 'HCRC-KD-HDKT-001', creator: USER_A.username, dept: DEPT_A, custodianDept: DEPT_A,
    type: 'Hợp đồng kinh tế', title: 'HĐ', partner: 'X', amount: 1000, approvalStatus: 'DRAFT',
    currentStep: 1, history: [], isAddendum: false, paymentInstallments: [],
    selectedApprovalLayers: [], selectedLayerMembers: {}, approvalLevel: 'TGD'
  });
  const APP_DATA_2TYPES = { ...APP_DATA, contractTypes: ['Hợp đồng kinh tế', 'Hợp đồng dịch vụ'], contractTypeAbbrs: { 'Hợp đồng kinh tế': 'HDKT', 'Hợp đồng dịch vụ': 'HDDV' } };
  await run('7f. editContract(): đổi type -> sinh lại code khớp loại pháp lý MỚI (trước vá: giữ nguyên mã cũ)', () => {
    const c = contractDraft();
    const updated = recordActions.editContract({ type: 'Hợp đồng dịch vụ' }, USER_A, c, false, undefined, APP_DATA_2TYPES, undefined, [c]);
    assert.strictEqual(updated.type, 'Hợp đồng dịch vụ');
    assert.strictEqual(updated.code, 'HCRC-KD-HDDV-001', `mã thật: ${updated.code}`);
  });
  await run('7g. editContract(): đổi type sang giá trị KHÔNG có trong danh mục -> 400', () => {
    const c = contractDraft();
    expectThrow(() => recordActions.editContract({ type: 'Loại Bịa' }, USER_A, c, false, undefined, APP_DATA_2TYPES, undefined, [c]),
      /Loại pháp lý hợp đồng không hợp lệ/i, '7g');
  });
  await run('7h. editContract(): hợp đồng gốc ĐÃ có phụ lục -> chặn đổi type (tránh lệch mã với phụ lục)', () => {
    const c = contractDraft();
    expectThrow(() => recordActions.editContract({ type: 'Hợp đồng dịch vụ' }, USER_A, c, true, undefined, APP_DATA_2TYPES, undefined, [c]),
      /không thể đổi loại pháp lý/i, '7h');
  });

  // ================= 9. [Thấp] Admin sửa được NHÁP/BỊ TỪ CHỐI dù không phải người tạo =================
  await run('9a. editContract(): admin sửa được hợp đồng NHÁP của NGƯỜI KHÁC (trước vá: 403 "chỉ người tạo")', () => {
    const c = { ...contractDraft(), creator: 'nguoi_da_nghi_viec' };
    const updated = recordActions.editContract({ title: 'HĐ admin sửa hộ' }, ADMIN, c, false, undefined, APP_DATA_2TYPES, undefined, [c]);
    assert.strictEqual(updated.title, 'HĐ admin sửa hộ');
  });
  await run('9b. editContract(): admin sửa được hợp đồng BỊ TỪ CHỐI của NGƯỜI KHÁC', () => {
    const c = { ...contractDraft(), creator: 'nguoi_da_nghi_viec', approvalStatus: 'REJECTED' };
    const updated = recordActions.editContract({ title: 'sửa lại' }, ADMIN, c, false, undefined, APP_DATA_2TYPES, undefined, [c]);
    assert.strictEqual(updated.title, 'sửa lại');
  });
  await run('9c. editContract(): admin KHÔNG được sửa hợp đồng PENDING của người khác (ngoài phạm vi lối thoát)', () => {
    const c = { ...contractDraft(), creator: 'nguoi_khac', approvalStatus: 'PENDING' };
    expectThrow(() => recordActions.editContract({ title: 'x' }, ADMIN, c, false, undefined, APP_DATA_2TYPES, undefined, [c]),
      /Bạn chỉ có thể sửa hồ sơ hợp đồng do chính mình tạo/i, '9c');
  });
  await run('9d. KHÔNG chặn nhầm: người thường (không phải admin, không phải người tạo) vẫn bị chặn dù hồ sơ NHÁP', () => {
    const c = { ...contractDraft(), creator: 'nguoi_khac' };
    const stranger = { ...USER_A, username: 'ke_la' };
    expectThrow(() => recordActions.editContract({ title: 'x' }, stranger, c, false, undefined, APP_DATA_2TYPES, undefined, [c]),
      /Bạn chỉ có thể sửa hồ sơ hợp đồng do chính mình tạo/i, '9d');
  });
  await run('9e. editDocDraft(): admin sửa được tài liệu NHÁP của NGƯỜI KHÁC', () => {
    const item = { ...docDraft(), uploader: 'nguoi_da_nghi_viec' };
    const updated = recordActions.editDocDraft({ title: 'TL admin sửa hộ' }, ADMIN, item, APP_DATA_2CATS, [item]);
    assert.strictEqual(updated.title, 'TL admin sửa hộ');
  });
  await run('9f. submitDocDraft(): admin gửi lại được tài liệu NHÁP của NGƯỜI KHÁC', () => {
    const item = { ...docDraft(), uploader: 'nguoi_da_nghi_viec', history: [] };
    const updated = recordActions.submitDocDraft(ADMIN, item);
    assert.strictEqual(updated.status, 'PENDING');
  });
  await run('9g. editSubmissionDraft()/submitSubmissionDraft(): admin sửa + gửi lại được tờ trình NHÁP của NGƯỜI KHÁC', () => {
    const item = {
      id: 8, code: 'HCRC-KD-VBT-008', dept: DEPT_A, creator: 'nguoi_da_nghi_viec', status: 'DRAFT',
      type: 'Tờ trình khác', title: 'TT', content: 'ND', fileUrl: '/uploads/x.pdf', fileName: 'x.pdf', extraFiles: [],
      approvalLevel: 'TGD', selectedApprovalLayers: [], selectedLayerMembers: {}, history: []
    };
    const APP_DATA_SUB = { ...APP_DATA_2TYPES, submissionApprovalGroups: [], submissionApprovalLevels: [{ id: 'TGD', label: 'TGĐ', order: 1, visibleGroupIds: [], lockedGroupIds: [], isSystemDefault: true }], submissionDeptWorkflows: {}, submissionTypeDeptWorkflows: {} };
    const updatedEdit = recordActions.editSubmissionDraft({ title: 'TT admin sửa hộ' }, ADMIN, item, APP_DATA_SUB);
    assert.strictEqual(updatedEdit.title, 'TT admin sửa hộ');
    const updatedSubmit = recordActions.submitSubmissionDraft(ADMIN, item);
    assert.strictEqual(updatedSubmit.status, 'PENDING');
  });
}

async function main() {
  await runHttpTests();
  await runPureTests();
  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
