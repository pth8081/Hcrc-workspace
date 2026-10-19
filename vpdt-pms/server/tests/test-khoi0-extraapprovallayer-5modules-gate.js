// server/tests/test-khoi0-extraapprovallayer-5modules-gate.js
//
// LỖI ĐÃ VÁ (re-audit lần 10, mức Cao — "Khối-0 zero-out loop xoá luôn dữ liệu Nhóm Phê Duyệt Cuối cho
// 5 module"): vòng lặp "zero-out" Khối 0 (GET /api/data, cả 2 bản — chính + lazy mirror) đã có exemption
// cho docs/hrFeedback/submissions/contracts/itPriceApprovals (`isExtraApprovalLayerApprover(...) &&
// continue`) nhưng CHƯA có cho 5 module song song dùng CHUNG cơ chế: carRegs (CAR), officeReqs
// (OFFICE_BUY/OFFICE_FIX), vppRegistrations (VPP), paymentRequests (PAYMENT), operationOrders
// (OPERATION_ORDER_STORE/HO). loadCarRegsScoped()/loadOfficeReqsScoped()/loadVppRegistrationsScoped()/
// loadPaymentRequestsScoped()/canSeeAllOperationOrders() (routes/data.js) đều đã tính đúng
// isExtraApprovalLayerApprover() để NẠP company-wide cho người CHỈ là thành viên "Nhóm Phê Duyệt Cuối"
// của module đó (thường KHÔNG dùng module hàng ngày, moduleAccess tắt), nhưng vòng lặp zero-out ngay
// sau đó lại XOÁ SẠCH về [] nếu moduleAccess tắt — nếu họ là approver DUY NHẤT của lớp cuối, hồ sơ kẹt
// PENDING vĩnh viễn không ai thấy để xử lý.
//
// Test này dựng user "approver1" (moduleAccess TẮT cả 5 module, dept KHÁC dept của mọi bản ghi, KHÔNG
// phải creator) nhưng CÓ TÊN trong extraApprovalGroups_<MODULE> tương ứng — chứng minh zero-out THẬT ở
// GET /api/data (cả 2 bản) khi mount routes/data.js thật, cùng khuôn test-khoi0-carregs-vppregistrations-gate.js.
//
// Chạy: node server/tests/test-khoi0-extraapprovallayer-5modules-gate.js
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

// approver1: moduleAccess TẮT cả 5 module, dept KHÁC dept mọi bản ghi — chỉ nhờ có tên trong
// extraApprovalGroups_* mới thấy được (đúng kịch bản lỗi: "duyệt cấp cao", không dùng module hàng ngày).
const APPROVER = { username: 'approver1', name: 'Approver Cấp Cao', dept: 'Ban Giám Đốc', perms: { moduleAccess: { car: false, office: false, vpp: false, payment: false, vanHanh: false } }, active: true };
// outsider1: CÙNG điều kiện moduleAccess tắt + dept khác, nhưng KHÔNG có tên trong bất kỳ
// extraApprovalGroups_* nào — phải vẫn bị zero-out HẾT (chứng minh bản vá KHÔNG mở toang gate cho mọi
// người, chỉ đúng approver "Nhóm Phê Duyệt Cuối").
const OUTSIDER = { username: 'outsider1', name: 'Người Ngoài', dept: 'Ban Giám Đốc', perms: { moduleAccess: { car: false, office: false, vpp: false, payment: false, vanHanh: false } }, active: true };
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true, moduleAccess: { car: false, office: false, vpp: false, payment: false, vanHanh: false } }, active: true };
const ALL_USERS_LIST = [APPROVER, OUTSIDER, ADMIN];

let APP_DATA;
function resetData() {
  APP_DATA = {
    users: ALL_USERS_LIST.map(u => ({ ...u })),
    extraApprovalGroups_CAR: [{ id: 'G1', members: ['approver1'] }],
    extraApprovalGroups_OFFICE_BUY: [{ id: 'G1', members: ['approver1'] }],
    extraApprovalGroups_OFFICE_FIX: [{ id: 'G1', members: ['approver1'] }],
    extraApprovalGroups_VPP: [{ id: 'G1', members: ['approver1'] }],
    extraApprovalGroups_PAYMENT: [{ id: 'G1', members: ['approver1'] }],
    extraApprovalGroups_OPERATION_ORDER_STORE: [{ id: 'G1', members: ['approver1'] }]
  };
}
resetData();

// Mỗi bản ghi cùng dept='Phòng A' (KHÁC dept 'Ban Giám Đốc' của approver1/outsider1) + creator khác hẳn
// -> KHÔNG có nhánh dept/creator thường nào cho approver1/outsider1 thấy; chỉ approver1 (nhờ
// extraApprovalGroups_*) mới thấy được sau bản vá.
// Mỗi bản ghi có extraApprovalLayers đông cứng SẴN approver1 (mô phỏng đúng kết quả
// prepareExtraApprovalSelectionForCreate() lúc tạo hồ sơ) — CẦN THIẾT để canViewCarReg()/canViewOfficeReq()/
// canViewVppRegistration()/canViewPaymentRequest()/canViewOperationOrder() (lib/recordViewScope.js, lớp
// lọc THEO TỪNG BẢN GHI chạy TRƯỚC vòng lặp zero-out Khối 0) cũng nhận approver1 là approver hợp lệ của
// ĐÚNG bản ghi này (qua isApproverForApproversMap(...resolveWfConfig().approvers...), nơi
// appendExtraApprovalLayers() ghép approvers từ field này) — nếu không, bản ghi bị lọc mất ngay ở lớp
// đó, không liên quan gì tới gate Khối 0 đang kiểm ở đây.
const CAR_REGS = [{ id: 1, code: 'XE-001', dept: 'Phòng A', creator: 'nvKhac', status: 'PENDING_APPROVAL', extraApprovalLayers: [{ label: 'Cấp Phê Duyệt Cuối Cùng', layerKey: 'G1', approvers: ['approver1'] }] }];
const OFFICE_REQS = [{ id: 1, code: 'VP-001', dept: 'Phòng A', creator: 'nvKhac', subType: 'MUA_BAN', status: 'PENDING_APPROVAL', extraApprovalLayers: [{ label: 'Cấp Phê Duyệt Cuối Cùng', layerKey: 'G1', approvers: ['approver1'] }] }];
const VPP_REGISTRATIONS = [{ id: 1, code: 'VPP-001', dept: 'Phòng A', creator: 'nvKhac', status: 'SUBMITTED', extraApprovalLayers: [{ label: 'Cấp Phê Duyệt Cuối Cùng', layerKey: 'G1', approvers: ['approver1'] }] }];
const PAYMENT_REQUESTS = [{ id: 1, code: 'TT-001', dept: 'Phòng A', createdBy: 'nvKhac', status: 'PENDING_APPROVAL', extraApprovalLayers: [{ label: 'Cấp Phê Duyệt Cuối Cùng', layerKey: 'G1', approvers: ['approver1'] }] }];
const OPERATION_ORDERS = [{ id: 1, code: 'DH-001', dept: 'Phòng A', creator: 'nvKhac', orderLocationType: 'HO', status: 'PENDING_APPROVAL', extraApprovalLayers: [{ label: 'Cấp Phê Duyệt Cuối Cùng', layerKey: 'G1', approvers: ['approver1'] }] }];

stubModule('lib/appData', {
  getAllAppDataWithVersionsCached: async () => ({ data: APP_DATA, versions: {} })
});
stubModule('lib/taskStore', { getAllTasksCached: async () => [], cascadeUsernameChangesToTaskAssignedBy: async () => 0 });
stubModule('lib/operationWorkItemStore', { getAllWorkItemsCached: async () => [], cascadeUsernameChangesToWorkItemAssignment: async () => 0 });
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['carRegs', 'officeReqs', 'vppRegistrations', 'paymentRequests', 'operationOrders']),
  getAllForCollectionCached: async (collection) => {
    if (collection === 'carRegs') return CAR_REGS.map(r => ({ ...r }));
    if (collection === 'officeReqs') return OFFICE_REQS.map(r => ({ ...r }));
    if (collection === 'vppRegistrations') return VPP_REGISTRATIONS.map(r => ({ ...r }));
    if (collection === 'paymentRequests') return PAYMENT_REQUESTS.map(r => ({ ...r }));
    if (collection === 'operationOrders') return OPERATION_ORDERS.map(r => ({ ...r }));
    return [];
  },
  // dept của approver1/outsider1 ('Ban Giám Đốc') không khớp dept bản ghi nào ('Phòng A') -> luôn rỗng,
  // đúng kịch bản "approver cấp cao không cùng phòng ban với hồ sơ".
  getForCollectionByDeptCached: async () => [],
  getForCollectionByUsernameCached: async () => [],
  getForCollectionByColumnCached: async () => []
});

let CURRENT_USERNAME = APPROVER.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = ALL_USERS_LIST.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = ALL_USERS_LIST;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p,
  isBcryptHash: () => false,
  validatePin: () => null
});

const dataRoutes = require('../routes/data');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
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
    await run.run('LỖI ĐÃ VÁ: approver "Nhóm Phê Duyệt Cuối" CAR (moduleAccess.car=false, khác dept) vẫn thấy carRegs — không bị zero-out oan', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, APPROVER);
      assertEqual(res.status, 200, 'phải trả 200');
      assertEqual((res.body.carRegs || []).length, 1, 'carRegs phải còn 1 bản ghi nhờ exemption extraApprovalGroups_CAR');
    });

    await run.run('LỖI ĐÃ VÁ: approver "Nhóm Phê Duyệt Cuối" OFFICE_BUY/FIX vẫn thấy officeReqs dù moduleAccess.office=false', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, APPROVER);
      assertEqual((res.body.officeReqs || []).length, 1, 'officeReqs phải còn 1 bản ghi nhờ exemption extraApprovalGroups_OFFICE_BUY/FIX');
    });

    await run.run('LỖI ĐÃ VÁ: approver "Nhóm Phê Duyệt Cuối" VPP vẫn thấy vppRegistrations dù moduleAccess.vpp=false', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, APPROVER);
      assertEqual((res.body.vppRegistrations || []).length, 1, 'vppRegistrations phải còn 1 bản ghi nhờ exemption extraApprovalGroups_VPP');
    });

    await run.run('LỖI ĐÃ VÁ: approver "Nhóm Phê Duyệt Cuối" PAYMENT vẫn thấy paymentRequests dù moduleAccess.payment=false', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, APPROVER);
      assertEqual((res.body.paymentRequests || []).length, 1, 'paymentRequests phải còn 1 bản ghi nhờ exemption extraApprovalGroups_PAYMENT');
    });

    await run.run('LỖI ĐÃ VÁ: approver "Nhóm Phê Duyệt Cuối" OPERATION_ORDER_STORE vẫn thấy operationOrders dù moduleAccess.vanHanh=false', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, APPROVER);
      assertEqual((res.body.operationOrders || []).length, 1, 'operationOrders phải còn 1 bản ghi nhờ exemption extraApprovalGroups_OPERATION_ORDER_STORE');
    });

    await run.run('ĐỐI CHỨNG: outsider KHÔNG có tên trong bất kỳ extraApprovalGroups_* nào -> vẫn bị zero-out HẾT cả 5 (bản vá không mở toang gate)', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, OUTSIDER);
      assertEqual((res.body.carRegs || []).length, 0, 'carRegs phải rỗng cho outsider');
      assertEqual((res.body.officeReqs || []).length, 0, 'officeReqs phải rỗng cho outsider');
      assertEqual((res.body.vppRegistrations || []).length, 0, 'vppRegistrations phải rỗng cho outsider');
      assertEqual((res.body.paymentRequests || []).length, 0, 'paymentRequests phải rỗng cho outsider');
      assertEqual((res.body.operationOrders || []).length, 0, 'operationOrders phải rỗng cho outsider');
    });

    await run.run('admin luôn bỏ qua moduleAccess (dù chính admin cũng bị tắt cả 5 module) -> thấy đủ cả 5', async () => {
      resetData();
      const res = await api('GET', '/api/data', undefined, ADMIN);
      assertEqual((res.body.carRegs || []).length, 1, 'admin phải luôn thấy carRegs');
      assertEqual((res.body.officeReqs || []).length, 1, 'admin phải luôn thấy officeReqs');
      assertEqual((res.body.vppRegistrations || []).length, 1, 'admin phải luôn thấy vppRegistrations');
      assertEqual((res.body.paymentRequests || []).length, 1, 'admin phải luôn thấy paymentRequests');
      assertEqual((res.body.operationOrders || []).length, 1, 'admin phải luôn thấy operationOrders');
    });

    run.summary();
  } finally {
    server.close();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
