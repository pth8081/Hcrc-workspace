// server/tests/test-approval-polling.js
//
// Regression test cho tính năng "Hộp Thư Phê Duyệt tự làm mới, không cần F5" (poll ngắn thay vì WebSocket
// — server chạy PM2 cluster mode, xem chú thích đầy đủ ở routes/approvals.js):
//
//   PHẦN A — lib/approvalAggregator.js::computeMyPendingApprovalKeys(user, appData), HÀM THUẦN không tự
//   đọc DB, gọi TRỰC TIẾP (không mock gì) với fixture dựng tay, phủ ĐỦ 17 nguồn hồ sơ mà hàm này tổng
//   hợp (khớp 1:1 public/js/core-approvalhub.js::getMyPendingApprovals(), xem cross-reference ở đầu
//   lib/approvalAggregator.js): 7 module theo BƯỚC quy trình phòng ban (docs, submissions, carRegs,
//   officeReqs x2 subType, vppRegistrations, itPriceApprovals, budgetEntries, contracts x2 luồng,
//   operationOrders) + module theo QUYỀN PHẲNG (meetings, internalPosts SHARE + bình luận bị gắn cờ,
//   licenses, paymentRequests, itPrice "Từ chối khẩn cấp", operationOrders AWAITING_RECEIPT).
//   operationStoreOpenings/operationRepairs "Dự toán" ĐÃ XOÁ KHỎI ĐÂY — Vận Hành > Siêu Thị không còn
//   bước phê duyệt nào cả, kể cả Dự toán (chủ ứng dụng xác nhận).
//
//   PHẦN B — GET /api/approvals/pending-signature (routes/approvals.js), gọi thẳng router express THẬT
//   trong tiến trình Node (cùng khuôn test-approval-email-config-admin-gate.js/test-audit-round2-
//   cluster1.js — không cần SQL Server thật, chỉ giả lập tầng lưu trữ lib/appData.js + lib/recordStore.js
//   + middleware lib/auth.js): xác thực bắt buộc (401 không phiên), và đặc biệt — DANH SÁCH KHOÁ đổi
//   đúng khi hồ sơ chờ duyệt đổi, kể cả khi ĐẾM giữ nguyên (1 hồ sơ được xử lý xong đúng lúc 1 hồ sơ khác
//   mới phát sinh cùng nhịp poll).
//
// Chạy: node server/tests/test-approval-polling.js
'use strict';

const http = require('http');
const path = require('path');
const { createRunner, assert, assertEqual } = require('./testHarness');

// ==========================================================================
// PHẦN A — computeMyPendingApprovalKeys() thuần, không cần stub gì (hàm không tự đọc DB).
// ==========================================================================
const { computeMyPendingApprovalKeys } = require('../lib/approvalAggregator');

function buildFixtureAppData() {
  return {
    // ----- Map cấu hình quy trình theo phòng ban (dbo.AppData, KHÔNG migrate sang dbo.Records) -----
    workflows: [],
    deptWorkflows: { 'Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['duyet1'] } } },
    carDeptWorkflows: { 'Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['duyet1'] } } },
    officeBuyDeptWorkflows: { 'Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['duyet1'] } } },
    officeFixDeptWorkflows: { 'Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['duyet1'] } } },
    vppDeptWorkflows: { 'Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['duyet1'] } } },
    itPriceDeptWorkflows: { 'Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['duyet1'] } } },
    itPriceTierWorkflows: {},
    budgetDeptWorkflows: { 'Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['duyet1'] } } },
    contractApprovalDeptWorkflows: { 'Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['duyet1'] } } },
    contractManageDeptWorkflows: { 'Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['duyet1'] } } },
    operationOrderStoreTierWorkflows: {},
    operationOrderHOTierWorkflows: { LT100M: { workflowId: 'WF_1STEP', approvers: { 1: ['duyet1'] } } },

    // ----- Collection hồ sơ (đã migrate sang dbo.Records — ở đây chỉ là mảng JS thuần, hàm test không
    // quan tâm nguồn lưu trữ thật) — mỗi module: 1 bản ghi duyet1 ĐƯỢC duyệt + 1 bản ghi PHẢI bị loại
    // (khác phòng ban/đã xử lý xong/thiếu quyền) để phép thử thật sự kiểm tra được bộ lọc, không chỉ
    // "trả về gì đó không rỗng".
    docs: [
      { id: 1, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [] },
      { id: 2, dept: 'Nhân Sự', status: 'PENDING', currentStep: 1, history: [] }, // sai phòng ban -> loại
      { id: 3, dept: 'Kế Toán', status: 'APPROVED', currentStep: 1, history: [] } // đã xử lý -> loại
    ],
    submissions: [
      { id: 11, dept: 'Kinh Doanh', status: 'PENDING', currentStep: 1, history: [],
        effectiveSteps: [{ order: 1, name: 'Sếp duyệt' }], effectiveApprovers: { 1: ['duyet1'] } },
      { id: 12, dept: 'Kinh Doanh', status: 'PENDING', currentStep: 1, history: [],
        effectiveSteps: [{ order: 1, name: 'Sếp duyệt' }], effectiveApprovers: { 1: ['someone.else'] } } // không có tên -> loại
    ],
    carRegs: [
      { id: 21, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [] }
    ],
    officeReqs: [
      { id: 31, dept: 'Kế Toán', subType: 'MUA_BAN', status: 'PENDING', currentStep: 1, history: [] },
      { id: 32, dept: 'Kế Toán', subType: 'SUA_CHUA', status: 'PENDING', currentStep: 1, history: [] }
    ],
    vppRegistrations: [
      { id: 41, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [] }
    ],
    itPriceApprovals: [
      { id: 51, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [], priceType: 'RETAIL' },
      // "Từ chối khẩn cấp" (mục riêng, KHÔNG qua bước duyệt phòng ban) — status APPROVED (đã duyệt giá
      // xong bước cuối) NHƯNG có emergencyRejectStatus PENDING -> phải xuất hiện ở nhánh riêng dù không
      // đi qua pushDeptWorkflowKeys() (status không phải 'PENDING' nên bị pushDeptWorkflowKeys() loại,
      // ĐÚNG như getMyPendingApprovals() client).
      { id: 52, dept: 'Kế Toán', status: 'APPROVED', currentStep: 1, history: [], priceType: 'RETAIL',
        emergencyRejectStatus: 'PENDING' }
    ],
    budgetEntries: [
      { id: 61, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [] }
    ],
    contracts: [
      { id: 71, dept: 'Kế Toán', isAddendum: false,
        approvalStatus: 'PENDING', currentStep: 1, history: [],
        effectiveSteps: [{ order: 1, name: 'Sếp duyệt' }], effectiveApprovers: { 1: ['duyet1'] },
        signedFileStatus: 'PENDING', signedFileCurrentStep: 1, signedFileHistory: [] },
      // Phụ lục (isAddendum:true) -> loại khỏi CẢ 2 luồng hợp đồng, kể cả khi đủ điều kiện approver khác.
      { id: 72, dept: 'Kế Toán', isAddendum: true,
        approvalStatus: 'PENDING', currentStep: 1, history: [],
        effectiveSteps: [{ order: 1, name: 'Sếp duyệt' }], effectiveApprovers: { 1: ['duyet1'] },
        signedFileStatus: 'PENDING', signedFileCurrentStep: 1, signedFileHistory: [] }
    ],
    meetings: [
      { id: 81, dept: 'Kế Toán', status: 'PENDING' }
    ],
    internalPosts: [
      { id: 91, dept: 'Kế Toán', type: 'SHARE', status: 'PENDING', comments: [] },
      { id: 92, dept: 'Kế Toán', type: 'SHARE', status: 'APPROVED', comments: [
        { id: 9201, flagged: true, content: 'nội dung nghi vấn' }
      ] }
    ],
    licenses: [
      { id: 101, dept: 'Kế Toán', status: 'PENDING' }
    ],
    paymentRequests: [
      { id: 111, dept: 'Kế Toán', status: 'PENDING' },
      { id: 112, dept: 'Kế Toán', status: 'NEED_INFO' }
    ],
    operationOrders: [
      { id: 121, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [],
        orderLocationType: 'HO', amount: 5000000, paymentTotalAmount: 0 },
      // AWAITING_RECEIPT — mục ĐẶC BIỆT, không đi qua pushDeptWorkflowKeys() (status khác PENDING) —
      // quyền dùng isApproverForOperationOrderReceipt() (lib/recordActions.js): quyền RIÊNG
      // operationOrderReceiptManage {all, depts[]}, scopeKey = 'HO' (orderLocationType==='HO') hoặc tên
      // siêu thị cụ thể (orderLocationType==='STORE', xem lib/recordActions.js). duyet1 chỉ được cấp
      // scope 'HO' ở fixture DUYET1 phía trên -> đơn HO này lọt, đơn STORE dưới không.
      { id: 122, dept: 'Kế Toán', status: 'AWAITING_RECEIPT', currentStep: 1, history: [],
        orderLocationType: 'HO', amount: 5000000, paymentTotalAmount: 0 },
      // orderLocationType STORE, dept = tên 1 siêu thị KHÔNG nằm trong operationOrderReceiptManage.depts
      // của duyet1 (chỉ có 'HO') -> PHẢI bị loại, dù cùng phòng ban 'Kế Toán' với đơn 122 (phòng ban
      // KHÔNG còn liên quan tới quyền này nữa — chỉ scopeKey mới quyết định).
      { id: 123, dept: 'Siêu Thị ABC', status: 'AWAITING_RECEIPT', currentStep: 1, history: [],
        orderLocationType: 'STORE', storeCode: 'Siêu Thị ABC', amount: 500000000, paymentTotalAmount: 0 }
    ]
  };
}

const DUYET1 = {
  username: 'duyet1', name: 'Người Duyệt Một', dept: 'Kế Toán',
  perms: {
    admin: false, meetingApprove: true, internalPostApprove: true, licenseApprove: true,
    paymentManage: true, itPriceEmergencyRejectApprove: true,
    // operationOrderReceiptManage: quyền RIÊNG (đợt "Duyệt Nhập/Hủy Đơn Hàng tập trung"), KHÔNG còn mirror
    // quần thể duyệt/từ chối dept-workflow của đơn hàng nữa — xem isApproverForOperationOrderReceipt()
    // (lib/recordActions.js). Chỉ cấp scope 'HO' (KHÔNG all:true) để bài test dưới còn phân biệt được
    // đúng/sai theo scopeKey (HO sentinel vs tên siêu thị cụ thể) thay vì luôn qua bất kể fixture nào.
    operationOrderReceiptManage: { all: false, depts: ['HO'] }
  }
};
const OUTSIDER = {
  username: 'khong.duyet', name: 'Người Ngoài Cuộc', dept: 'Nhân Sự',
  perms: { admin: false, meetingApprove: false, internalPostApprove: false, licenseApprove: false, paymentManage: false, itPriceEmergencyRejectApprove: false }
};

async function runPartA(run) {
  await run.run('computeMyPendingApprovalKeys(): 7 module dept-workflow đều được tổng hợp ĐÚNG cho duyet1', async () => {
    const appData = buildFixtureAppData();
    const keys = computeMyPendingApprovalKeys(DUYET1, appData);

    assert(keys.includes('doc:1'), 'phải gồm doc:1 (đúng phòng ban, đúng approver, PENDING)');
    assert(!keys.includes('doc:2'), 'PHẢI loại doc:2 (khác phòng ban)');
    assert(!keys.includes('doc:3'), 'PHẢI loại doc:3 (đã APPROVED)');
    assert(keys.includes('submission:11'), 'phải gồm submission:11 (effectiveApprovers khớp duyet1)');
    assert(!keys.includes('submission:12'), 'PHẢI loại submission:12 (effectiveApprovers không có duyet1)');
    assert(keys.includes('car:21'), 'phải gồm car:21');
    assert(keys.includes('officeBuy:31'), 'phải gồm officeBuy:31 (subType MUA_BAN)');
    assert(keys.includes('officeFix:32'), 'phải gồm officeFix:32 (subType SUA_CHUA)');
    assert(keys.includes('vpp:41'), 'phải gồm vpp:41');
    assert(keys.includes('itPrice:51'), 'phải gồm itPrice:51');
    assert(keys.includes('budget:61'), 'phải gồm budget:61');
    assert(keys.includes('contract:71'), 'phải gồm contract:71 (luồng Phê Duyệt)');
    assert(keys.includes('contractSigned:71'), 'phải gồm contractSigned:71 (luồng Tài liệu ký, field riêng)');
    assert(!keys.includes('contract:72') && !keys.includes('contractSigned:72'), 'PHẢI loại phụ lục (isAddendum:true) khỏi CẢ 2 luồng hợp đồng');
    assert(keys.includes('operationOrder:121'), 'phải gồm operationOrder:121 (mức HO/LT100M, duyet1 có tên)');
  });

  await run.run('computeMyPendingApprovalKeys(): 6 module/nhánh QUYỀN PHẲNG (không theo bước) đều đúng', async () => {
    const appData = buildFixtureAppData();
    const keys = computeMyPendingApprovalKeys(DUYET1, appData);

    assert(keys.includes('meeting:81'), 'phải gồm meeting:81 (meetingApprove=true)');
    assert(keys.includes('internalShare:91'), 'phải gồm internalShare:91 (SHARE + PENDING, internalPostApprove=true)');
    assert(keys.includes('flaggedComment:92:9201'), 'phải gồm flaggedComment:92:9201 (bình luận bị gắn cờ, DÙ bài viết đã APPROVED)');
    assert(keys.includes('license:101'), 'phải gồm license:101 (licenseApprove=true)');
    assert(keys.includes('payment:111') && keys.includes('payment:112'), 'phải gồm CẢ payment:111 (PENDING) và payment:112 (NEED_INFO)');
    assert(keys.includes('itPriceEmergencyReject:52'), 'phải gồm itPriceEmergencyReject:52 (mục riêng, KHÔNG lệ thuộc status chính APPROVED)');
    assert(keys.includes('operationOrderReceipt:122'), 'phải gồm operationOrderReceipt:122 (đơn HO, duyet1 có scope HO trong operationOrderReceiptManage)');
    assert(!keys.includes('operationOrderReceipt:123'), 'PHẢI loại operationOrderReceipt:123 (đơn STORE, duyet1 không có scope siêu thị đó)');
  });

  await run.run('computeMyPendingApprovalKeys(): outsider (không có quyền/không đúng phòng ban nào) trả về RỖNG', async () => {
    const appData = buildFixtureAppData();
    const keys = computeMyPendingApprovalKeys(OUTSIDER, appData);
    assertEqual(keys.length, 0, 'người không nằm trong bất kỳ luồng duyệt nào phải nhận mảng rỗng: ' + JSON.stringify(keys));
  });

  await run.run('computeMyPendingApprovalKeys(): admin luôn được tính là approver hợp lệ (canApproveStep() cho admin qua mọi bước)', async () => {
    const appData = buildFixtureAppData();
    const admin = { username: 'admin1', name: 'Admin', dept: 'Ban Giám Đốc', perms: { admin: true } };
    const keys = computeMyPendingApprovalKeys(admin, appData);
    assert(keys.includes('doc:2'), 'admin phải duyệt được cả doc:2 (khác phòng ban với admin, nhưng admin bỏ qua mọi giới hạn dept-workflow)');
  });

  await run.run('computeMyPendingApprovalKeys(): kết quả LUÔN đã sắp xếp + không trùng lặp', async () => {
    const appData = buildFixtureAppData();
    const keys = computeMyPendingApprovalKeys(DUYET1, appData);
    const sorted = [...keys].sort();
    assertEqual(JSON.stringify(keys), JSON.stringify(sorted), 'mảng trả về phải đã sắp xếp sẵn (client so sánh signature theo thứ tự cố định)');
    assertEqual(keys.length, new Set(keys).size, 'không được có khoá trùng lặp');
  });

  await run.run('computeMyPendingApprovalKeys(user=null hoặc appData rỗng) không throw, trả về mảng rỗng', async () => {
    assertEqual(computeMyPendingApprovalKeys(null, buildFixtureAppData()).length, 0, 'user null -> rỗng');
    assertEqual(computeMyPendingApprovalKeys(DUYET1, {}).length, 0, 'appData rỗng (mọi collection undefined) không được throw');
  });
}

// ==========================================================================
// PHẦN B — GET /api/approvals/pending-signature: router express THẬT, chỉ giả lập lib/appData.js +
// lib/recordStore.js (tầng lưu trữ) + lib/auth.js (middleware xác thực) — không cần SQL Server thật.
// ==========================================================================
function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

let CURRENT_USERNAME = null; // null = chưa đăng nhập, mirror requireAuth thật trả 401
const USERS = [DUYET1, OUTSIDER];

// state: đúng những gì routes/approvals.js thực sự đọc — phần map cấu hình (dbo.AppData) qua
// getAllAppDataWithVersionsCached(), phần collection hồ sơ (dbo.Records) qua getAllForCollectionCached().
let APP_DATA_STATE;
function resetAppDataState() {
  APP_DATA_STATE = buildFixtureAppData();
}
resetAppDataState();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA_STATE ? APP_DATA_STATE[key] : null),
  getAppDataValueWithVersion: async (key) => ({ value: APP_DATA_STATE[key] ?? null, version: 'v-test' }),
  // getAllAppDataWithVersionsCached(): chỉ CÁC MAP CẤU HÌNH còn nằm trong dbo.AppData thật sự cần cho
  // route này (collection hồ sơ KHÔNG nằm ở đây — đã migrate sang dbo.Records, xem stub recordStore
  // bên dưới) — thiếu field nào so với thật cũng không sao vì computeMyPendingApprovalKeys() tự "|| {}"/
  // "|| []" an toàn ở mọi nhánh đọc appData.
  getAllAppDataWithVersionsCached: async () => ({ data: { ...APP_DATA_STATE }, versions: {} }),
  setAppDataValue: async (key, value) => { APP_DATA_STATE[key] = value; },
  setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA_STATE[key] = value; return { conflict: false, version: 'v-test-2' }; },
  withLockedAppDataValue: async (key, fn) => { APP_DATA_STATE[key] = await fn(APP_DATA_STATE[key]); return APP_DATA_STATE[key]; }
});

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set([
    'docs', 'submissions', 'carRegs', 'officeReqs', 'vppRegistrations', 'itPriceApprovals',
    'budgetEntries', 'contracts', 'meetings', 'internalPosts', 'licenses', 'paymentRequests',
    'operationOrders', 'operationStoreOpenings', 'operationRepairs'
  ]),
  getAllForCollectionCached: async (collection) => APP_DATA_STATE[collection] || []
});

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    if (!CURRENT_USERNAME) return res.status(401).json({ error: 'Chưa đăng nhập' });
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, admin: !!fresh.perms?.admin };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => `hashed:${p}`,
  isBcryptHash: (v) => String(v || '').startsWith('hashed:'),
  validatePin: () => null
});

const express = require('express');
const approvalsRoutes = require('../routes/approvals');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/approvals', approvalsRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function api(method, urlPath, asUsername) {
  CURRENT_USERNAME = asUsername === undefined ? CURRENT_USERNAME : asUsername;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, { method });
  let body = null;
  try { body = await res.json(); } catch (e) { body = null; }
  return { status: res.status, body };
}

async function runPartB(run) {
  const server = await startApp();
  try {
    await run.run('GET /api/approvals/pending-signature KHÔNG có phiên đăng nhập -> 401', async () => {
      const res = await api('GET', '/api/approvals/pending-signature', null);
      assertEqual(res.status, 401, 'phải từ chối khi chưa đăng nhập');
    });

    await run.run('GET /api/approvals/pending-signature với phiên hợp lệ -> 200, trả { count, keys } khớp fixture', async () => {
      resetAppDataState();
      const res = await api('GET', '/api/approvals/pending-signature', 'duyet1');
      assertEqual(res.status, 200, 'phải trả 200 cho phiên hợp lệ');
      assert(Array.isArray(res.body.keys), 'body.keys phải là mảng');
      assertEqual(res.body.count, res.body.keys.length, 'count phải khớp đúng độ dài keys');
      assert(res.body.keys.includes('doc:1'), 'keys phải gồm doc:1, khớp computeMyPendingApprovalKeys() gọi trực tiếp ở Phần A');
    });

    await run.run('outsider gọi cùng endpoint -> 200 nhưng keys RỖNG (khác hẳn duyet1, chứng minh lọc theo ĐÚNG người gọi, không lộ chéo)', async () => {
      resetAppDataState();
      const res = await api('GET', '/api/approvals/pending-signature', 'khong.duyet');
      assertEqual(res.status, 200);
      assertEqual(res.body.keys.length, 0, JSON.stringify(res.body));
    });

    // ==========================================================================
    // Kịch bản cốt lõi: ĐẾM giữ nguyên nhưng NỘI DUNG đổi hẳn (1 hồ sơ được xử lý xong ĐÚNG LÚC 1 hồ sơ
    // khác mới phát sinh) — client (core.js runApprovalPollTick()) PHẢI phát hiện ra đây LÀ 1 thay đổi
    // thật (so KHOÁ, không so ĐẾM). Test này gọi lại đúng route thật ở 3 mốc và so sánh chữ ký (keys nối
    // chuỗi, cùng cách core.js làm) để khẳng định: (1) thêm 1 hồ sơ mới -> tăng đếm + đổi chữ ký; (2) xử
    // lý xong hồ sơ CŨ trong khi hồ sơ MỚI vẫn còn đó -> đếm quay VỀ ĐÚNG SỐ BAN ĐẦU nhưng chữ ký VẪN
    // KHÁC chữ ký ban đầu (vì là 2 hồ sơ khác nhau).
    // ==========================================================================
    await run.run('add-rồi-resolve: đếm quay về số ban đầu nhưng chữ ký (signature) đổi ở CẢ 2 mốc', async () => {
      resetAppDataState();
      const r0 = await api('GET', '/api/approvals/pending-signature', 'duyet1');
      const sig0 = r0.body.keys.join('|');
      const count0 = r0.body.count;

      // Mốc 1: thêm 1 doc PENDING mới mà duyet1 duyệt được -> đếm TĂNG, chữ ký đổi.
      APP_DATA_STATE.docs.push({ id: 999, dept: 'Kế Toán', status: 'PENDING', currentStep: 1, history: [] });
      const r1 = await api('GET', '/api/approvals/pending-signature', 'duyet1');
      const sig1 = r1.body.keys.join('|');
      assertEqual(r1.body.count, count0 + 1, 'đếm phải tăng đúng 1 sau khi thêm 1 hồ sơ mới');
      assert(sig1 !== sig0, 'chữ ký phải đổi ngay khi có hồ sơ mới');
      assert(r1.body.keys.includes('doc:999'), 'khoá của hồ sơ mới phải xuất hiện: ' + JSON.stringify(r1.body.keys));

      // Mốc 2: hồ sơ CŨ (doc:1) được xử lý xong (APPROVED) trong khi doc:999 (mới) vẫn PENDING -> đếm
      // quay VỀ ĐÚNG count0 (1 hồ sơ rời khỏi danh sách, 1 hồ sơ khác đã có mặt từ mốc 1) NHƯNG đây
      // KHÔNG PHẢI "không có gì đổi" — chữ ký PHẢI khác chữ ký gốc sig0 (nội dung là doc:999, không phải
      // doc:1 nữa), đây chính là trường hợp mà so ĐẾM đơn thuần sẽ bỏ sót.
      APP_DATA_STATE.docs.find(d => d.id === 1).status = 'APPROVED';
      const r2 = await api('GET', '/api/approvals/pending-signature', 'duyet1');
      const sig2 = r2.body.keys.join('|');
      assertEqual(r2.body.count, count0, 'đếm phải quay về ĐÚNG số ban đầu (count0) sau khi 1 hồ sơ cũ xử lý xong, 1 hồ sơ mới đã có mặt');
      assert(sig2 !== sig0, 'chữ ký PHẢI khác chữ ký GỐC dù đếm bằng nhau — nội dung thực sự khác (doc:1 rời đi, doc:999 vẫn còn)');
      assert(!r2.body.keys.includes('doc:1'), 'doc:1 đã APPROVED, không còn trong danh sách');
      assert(r2.body.keys.includes('doc:999'), 'doc:999 vẫn PENDING, vẫn phải còn trong danh sách');
    });

  } finally {
    server.close();
  }
}

async function main() {
  const run = createRunner();
  await runPartA(run);
  await runPartB(run);
  run.summary();
}

main().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
