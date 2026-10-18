// server/tests/test-contract-signed-file-no-approver-block.js
//
// Regression test cho LỖ HỔNG ĐÃ VÁ (11/2026, theo yêu cầu người dùng, phát hiện từ đợt rà soát "quy
// trình phê duyệt thiếu/khoá người duyệt"): quy trình "📎 Tài liệu ký" của Hợp Đồng (module ảo
// contractsSignedFile, lib/workflowEngine.js — KHÁC HẲN quy trình Phê Duyệt gốc approvalStatus, vốn ĐÃ
// được chặn từ trước ở routes/create.js) TRƯỚC ĐÂY không hề gọi findMissingApproverStep() ở CẢ 2 đường
// đưa signedFileStatus về PENDING:
//   1. uploadContractSignedFile() (lib/recordActions.js, POST /api/contracts/:id/upload-signed).
//   2. Nhánh isSignedImport của contracts.extraValidate (lib/createValidation.js, "Nhập Hợp Đồng/Phụ Lục
//      Đã Ký" kèm sẵn tài liệu ký lúc nhập).
// Hồ sơ vẫn "tạo/tải lên thành công" nếu phòng ban chưa cấu hình contractManageDeptWorkflows, hoặc người
// được cấu hình đã bị khoá tài khoản/nghỉ việc — rồi treo lặng lẽ, không ai duyệt được, admin không biết.
//
//   PHẦN A (thuần, gọi thẳng uploadContractSignedFile() — lib/recordActions.js):
//     1. Phòng ban CHƯA cấu hình contractManageDeptWorkflows -> chặn 409, KHÔNG đổi signedFileStatus,
//        admin được thông báo.
//     2. Phòng ban CÓ cấu hình nhưng người duyệt đã bị KHOÁ TÀI KHOẢN (active:false) -> vẫn chặn 409.
//     3. Phòng ban CÓ cấu hình + người duyệt ĐANG hoạt động -> tải lên thành công bình thường (đối
//        chứng, không chặn oan), signedFileStatus = 'PENDING'.
//
//   PHẦN B (HTTP thật qua routes/create.js — nhánh isSignedImport):
//     4. Nhập hợp đồng "Đã Ký" (isSignedImport=true) kèm sẵn file -> Phòng ban CHƯA cấu hình người duyệt
//        Tài liệu ký -> chặn 409 (KHÔNG tạo được hồ sơ hợp đồng luôn, dù approvalStatus lẽ ra APPROVED).
//     5. Cùng kịch bản nhưng phòng ban ĐÃ cấu hình người duyệt hợp lệ -> tạo thành công, signedFileStatus
//        = 'PENDING' (không còn tự APPROVED ngay như hành vi gốc trước 10/2026).
//
// Chạy: node server/tests/test-contract-signed-file-no-approver-block.js
'use strict';
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ ${label}${detail !== undefined ? '\n     ' + JSON.stringify(detail) : ''}`); failed++; }
}

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const CUSTODIAN = { username: 'ketoan1', name: 'Nhân Viên Kế Toán', dept: 'Phòng Kế Toán', perms: { contractCreate: true }, active: true };
const TP_KETOAN_NGHIVIEC = { username: 'tp.ketoan.old', name: 'Trưởng Phòng Cũ (đã nghỉ việc)', dept: 'Phòng Kế Toán', perms: {}, active: false };
const TP_KETOAN_DANGLAM = { username: 'tp.ketoan', name: 'Trưởng Phòng Kế Toán', dept: 'Phòng Kế Toán', perms: {}, active: true };

const notifications = [];
stubModule('lib/notifications', {
  notifyUsers: async (usernames, type, title, message, linkTo) => {
    notifications.push({ usernames, type, title, message, linkTo });
    return [];
  }
});

function partA() {
  console.log('\n== Phần A: gọi thẳng uploadContractSignedFile() (lib/recordActions.js) ==');
  const recordActions = require('../lib/recordActions');

  function freshContract(overrides) {
    return Object.assign({
      id: 1, code: 'HCRC-KT-HC-001', dept: 'Phòng Kế Toán', isAddendum: false,
      creator: CUSTODIAN.username, custodianDept: null,
      approvalStatus: 'APPROVED', signedFileStatus: null, paymentStatus: 'CHUA_THANH_TOAN'
    }, overrides);
  }
  const payload = { fileName: 'hop-dong-da-ky.pdf', fileType: 'application/pdf', fileUrl: '/uploads/hop-dong-da-ky.pdf' };

  notifications.length = 0;
  check('[1] Phòng ban CHƯA cấu hình quy trình Tài liệu ký -> chặn 409, KHÔNG đổi signedFileStatus', (() => {
    const contract = freshContract({});
    const appData = { users: [ADMIN, CUSTODIAN], contractManageDeptWorkflows: {} };
    try {
      recordActions.uploadContractSignedFile(payload, CUSTODIAN, contract, [], appData);
      return false;
    } catch (err) {
      return err.status === 409 && /chưa có người duyệt hợp lệ/.test(err.message) && contract.signedFileStatus === null;
    }
  })());
  check('[1] Admin được thông báo', notifications.length === 1 && notifications[0].usernames.includes('admin'), notifications);

  notifications.length = 0;
  check('[2] Phòng ban CÓ cấu hình nhưng người duyệt đã bị KHOÁ tài khoản -> vẫn chặn 409', (() => {
    const contract = freshContract({});
    const appData = {
      users: [ADMIN, CUSTODIAN, TP_KETOAN_NGHIVIEC],
      contractManageDeptWorkflows: { 'Phòng Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: [TP_KETOAN_NGHIVIEC.username] } } }
    };
    try {
      recordActions.uploadContractSignedFile(payload, CUSTODIAN, contract, [], appData);
      return false;
    } catch (err) {
      return err.status === 409 && /khoá tài khoản/.test(err.message);
    }
  })());
  check('[2] Admin vẫn được thông báo dù nguyên nhân là tài khoản bị khoá', notifications.length === 1, notifications);

  notifications.length = 0;
  check('[3 — đối chứng] Phòng ban CÓ người duyệt ĐANG hoạt động -> tải lên thành công, signedFileStatus = PENDING', (() => {
    const contract = freshContract({});
    const appData = {
      users: [ADMIN, CUSTODIAN, TP_KETOAN_DANGLAM],
      contractManageDeptWorkflows: { 'Phòng Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: [TP_KETOAN_DANGLAM.username] } } }
    };
    const updated = recordActions.uploadContractSignedFile(payload, CUSTODIAN, contract, [], appData);
    return updated.signedFileStatus === 'PENDING' && updated.signedFileCurrentStep === 1;
  })());
  check('[3] Không gửi thông báo admin khi mọi thứ hợp lệ', notifications.length === 0, notifications);
}

async function partB() {
  console.log('\n== Phần B: HTTP thật — routes/create.js, nhánh isSignedImport (Nhập Hợp Đồng Đã Ký) ==');
  const http = require('http');
  const express = require('express');

  let RECORDS = { contracts: [] };
  let APP_DATA;
  const CUSTODIAN_IMPORT = { ...CUSTODIAN, perms: { contractCreate: true, contractImportSigned: true } };
  function resetAll() {
    RECORDS = { contracts: [] };
    APP_DATA = {
      users: [ADMIN, CUSTODIAN_IMPORT],
      depts: ['Phòng Kế Toán'], stores: [],
      contractManageDeptWorkflows: {},
      contractApprovalDeptWorkflows: {}
    };
  }
  resetAll();

  stubModule('lib/appData', {
    getAllAppData: async () => JSON.parse(JSON.stringify(APP_DATA)),
    withLockedAppDataValue: async (key, fn) => fn([])
  });
  stubModule('lib/recordStore', {
    MIGRATED_COLLECTIONS: new Set(['contracts']),
    getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
    getTrashItems: async () => [],
    createForCollection: async (c, builderFn) => {
      const record = await builderFn((RECORDS[c] || []).slice());
      RECORDS[c].push(record);
      return record;
    },
    createForCollectionSerialized: async (c, lockKey, builderFn) => {
      const record = await builderFn((RECORDS[c] || []).slice());
      RECORDS[c].push(record);
      return record;
    },
    withAppLock: async (key, fn) => fn()
  });
  stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
  stubModule('lib/uploadedFiles', {
    assertPayloadFileUrlsOwnedByUser: async () => {},
    recordUploadedFile: async () => {},
    getFileUrlOwners: async () => new Map(),
    collectFileUrlsDeep: () => {}
  });
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const username = req.headers['x-test-user'];
      const fresh = APP_DATA.users.find((u) => u.username === username);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      req.allUsers = APP_DATA.users;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });

  // routes/create.js + lib/createValidation.js đã require() thật ở Phần A rồi (qua lib/recordActions.js
  // require('./createValidation') eager) — xoá cache ép require lại, nạp đúng stub MỚI của Phần B (cùng
  // lý do require.cache collision đã gặp ở các test khác trong session này).
  for (const mod of ['../routes/create.js', '../lib/createValidation.js', '../lib/recordActions.js', '../lib/workflowEngine.js']) {
    const full = require.resolve(path.join(__dirname, mod));
    delete require.cache[full];
  }
  const createRoutes = require('../routes/create');

  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  const server = http.createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;

  async function api(method, urlPath, body, asUser) {
    const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
      method, headers: { 'Content-Type': 'application/json', 'x-test-user': asUser.username },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let payload = null; try { payload = await res.json(); } catch (e) {}
    return { status: res.status, body: payload };
  }

  function signedImportPayload(overrides) {
    return Object.assign({
      isSignedImport: true, isAddendum: false, dept: 'Phòng Kế Toán', custodianDept: 'Phòng Kế Toán',
      type: 'Mua bán', title: 'Hợp đồng demo đã ký', partner: 'Đối tác demo',
      amount: 1000000, startDate: '2026-11-01', endDate: '2027-11-01', paymentType: 'LUMP_SUM',
      fileUrl: '/uploads/hopdong-goc.pdf', fileName: 'hopdong-goc.pdf', fileType: 'application/pdf'
    }, overrides || {});
  }

  try {
    resetAll(); notifications.length = 0;
    const r1 = await api('POST', '/api/create/contracts', signedImportPayload(), CUSTODIAN_IMPORT);
    check('[4] Nhập Hợp Đồng Đã Ký, phòng ban CHƯA cấu hình người duyệt Tài liệu ký -> chặn 409, KHÔNG tạo được hồ sơ',
      r1.status === 409 && RECORDS.contracts.length === 0 && /chưa có người duyệt hợp lệ/.test(r1.body?.error || ''), r1.body);

    resetAll(); notifications.length = 0;
    APP_DATA.contractManageDeptWorkflows['Phòng Kế Toán'] = { workflowId: 'WF_1STEP', approvers: { 1: [TP_KETOAN_DANGLAM.username] } };
    APP_DATA.users.push(TP_KETOAN_DANGLAM);
    const r2 = await api('POST', '/api/create/contracts', signedImportPayload(), CUSTODIAN_IMPORT);
    check('[5 — đối chứng] Cùng kịch bản nhưng ĐÃ cấu hình người duyệt hợp lệ -> tạo thành công, signedFileStatus=PENDING',
      r2.status === 200 && RECORDS.contracts.length === 1 && RECORDS.contracts[0].signedFileStatus === 'PENDING' && RECORDS.contracts[0].approvalStatus === 'APPROVED', r2.body);

    // ===== LỖI ĐÃ VÁ (re-audit lần 7, mức TB — "contracts.extraValidate isSignedImport dùng payload.dept
    // thô cho findMissingApproverStep"): CUSTODIAN_IMPORT.dept THẬT = 'Phòng Kế Toán' (forceOwnDept:true
    // nên dept CUỐI CÙNG của record luôn ép về đây, KHÔNG đổi được). 'Phòng Khác' CÓ cấu hình người duyệt
    // hợp lệ, 'Phòng Kế Toán' (dept thật) KHÔNG có. Payload tự gửi dept='Phòng Khác' (giả mạo) để chốt
    // chặn findMissingApproverStep (đọc payload.dept TRƯỚC KHI bị ép) tưởng nhầm là có người duyệt — PHẢI
    // vẫn bị chặn 409 vì record THẬT lưu dept='Phòng Kế Toán' (không có approver).
    resetAll(); notifications.length = 0;
    APP_DATA.depts.push('Phòng Khác');
    APP_DATA.contractManageDeptWorkflows['Phòng Khác'] = { workflowId: 'WF_1STEP', approvers: { 1: [TP_KETOAN_DANGLAM.username] } };
    APP_DATA.users.push(TP_KETOAN_DANGLAM);
    const r3 = await api('POST', '/api/create/contracts', signedImportPayload({ dept: 'Phòng Khác' }), CUSTODIAN_IMPORT);
    check('[LỖI ĐÃ VÁ] payload.dept giả mạo sang phòng CÓ người duyệt, dept thật (Phòng Kế Toán) KHÔNG có -> vẫn phải chặn 409',
      r3.status === 409 && RECORDS.contracts.length === 0 && /chưa có người duyệt hợp lệ/.test(r3.body?.error || ''), r3.body);
    check('[LỖI ĐÃ VÁ] Thông báo admin phải nêu ĐÚNG phòng ban thật (Phòng Kế Toán), không phải phòng giả mạo (Phòng Khác)',
      /Phòng Kế Toán/.test(r3.body?.error || '') && !/Phòng Khác/.test(r3.body?.error || ''), r3.body);

    // Đối chứng: cấu hình thêm người duyệt hợp lệ cho ĐÚNG dept thật (Phòng Kế Toán) -> tạo thành công
    // bình thường dù payload vẫn cố gửi dept giả 'Phòng Khác' (không ảnh hưởng gì, record vẫn ép đúng).
    APP_DATA.contractManageDeptWorkflows['Phòng Kế Toán'] = { workflowId: 'WF_1STEP', approvers: { 1: [TP_KETOAN_DANGLAM.username] } };
    const r4 = await api('POST', '/api/create/contracts', signedImportPayload({ dept: 'Phòng Khác' }), CUSTODIAN_IMPORT);
    check('[đối chứng] dept thật (Phòng Kế Toán) ĐÃ có người duyệt -> tạo thành công bình thường, record ép đúng dept thật',
      r4.status === 200 && RECORDS.contracts.some(c => c.dept === 'Phòng Kế Toán' && c.signedFileStatus === 'PENDING'), r4.body);
  } finally {
    server.close();
  }
}

async function main() {
  partA();
  await partB();
  console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
