// server/tests/test-report-permission-rollout.js
//
// Regression test cho đợt "checkbox phân quyền Báo Cáo theo module/tab/sub-tab" (10/2026, theo yêu cầu
// người dùng: "Vá 2 module hở + tách thêm quyền riêng cho cả 5 module còn lại"). 7 quyền phẳng MỚI, mỗi
// quyền là bypass CỘNG THÊM (additive-only) cho ĐÚNG 1 tab "📊 Báo Cáo" của module tương ứng, KHÔNG thay
// thế/làm yếu bất kỳ quyền hiện có nào:
//   - operationOrderReportView  — Vận Hành > Đơn Hàng > Báo Cáo (canViewOperationOrder())
//   - operationStoreReportView — Vận Hành > QLDA/Siêu Thị > Báo Cáo (canViewOperationStoreOpening()/
//     canViewOperationRepair()/redactOperationEstimateItemsToOwnedScope())
//   - carReportView            — Đăng Ký Xe > Báo Cáo (canViewCarReg())
//   - meetingReportView        — Phòng Họp > Báo Cáo (canViewMeeting())
//   - budgetReportView         — Ngân Sách > Báo Cáo (canViewBudgetEntry()/canViewBudgetLine()/
//     canViewBudgetPeriod())
//   - vppReportView            — Văn Phòng Phẩm > Báo Cáo (canViewVppRegistration())
//   - hrReportView             — Nhân Sự > Báo Cáo (GET /api/hr-profile/reports, routes/employeeProfile.js)
//
// Mỗi kịch bản dưới đây xác nhận CẢ 2 chiều: (a) người CHỈ có đúng quyền ReportView mới (không có quyền
// quản lý/tạo/duyệt nào khác, khác phòng ban, không phải người tạo/approver) vẫn xem được; (b) người
// KHÔNG có quyền nào trong số này vẫn bị chặn như trước (không vô tình mở rộng thêm phạm vi ngoài ý định).
//
// Chạy: node server/tests/test-report-permission-rollout.js
'use strict';
const path = require('path');
const express = require('express');
const http = require('http');
const { createRunner, assert, assertEqual } = require('./testHarness');
const {
  canViewOperationOrder, canViewOperationStoreOpening, canViewOperationRepair,
  redactOperationEstimateItemsToOwnedScope,
  canViewCarReg, canViewMeeting,
  canViewBudgetEntry, canViewBudgetLine, canViewBudgetPeriod,
  canViewVppRegistration
} = require('../lib/recordViewScope');

const run = createRunner();

const OUTSIDER_NO_PERMS = { username: 'nv_khac', dept: 'Phòng C', perms: {} };

async function main() {

// ===== 1) operationOrderReportView =====
await run.run('canViewOperationOrder(): operationOrderReportView -> bypass, xem được đơn hàng khác phòng ban/không phải người tạo/không phải approver', () => {
  const reportViewer = { username: 'xem_bc_don', dept: 'Phòng B', perms: { operationOrderReportView: true } };
  const item = { id: 1, dept: 'Phòng A', creator: 'ai_do_khac' };
  const appData = { operationOrders: [] };
  assert(canViewOperationOrder(reportViewer, item, appData), 'operationOrderReportView phải bypass được phạm vi phòng ban/người tạo/approver');
});
await run.run('canViewOperationOrder(): không có operationOrderReportView + không liên quan -> vẫn bị chặn (additive-only, không mở rộng ngoài ý định)', () => {
  const item = { id: 1, dept: 'Phòng A', creator: 'ai_do_khac' };
  const appData = { operationOrders: [] };
  assert(!canViewOperationOrder(OUTSIDER_NO_PERMS, item, appData), 'người không có quyền/không liên quan phải vẫn bị chặn như trước');
});

// ===== 2) operationStoreReportView (dùng CHUNG cho Mở Mới + Sửa Chữa + redact estimateItems) =====
const APP_DATA_STORE = { operationWorkItems: [] };
await run.run('canViewOperationStoreOpening(): operationStoreReportView -> bypass', () => {
  const reportViewer = { username: 'xem_bc_store', dept: 'Phòng B', perms: { operationStoreReportView: true } };
  const item = { id: 1, dept: 'Phòng A', estimateItems: [] };
  assert(canViewOperationStoreOpening(reportViewer, item, APP_DATA_STORE), 'operationStoreReportView phải bypass được canViewOperationStoreOpening()');
});
await run.run('canViewOperationRepair(): operationStoreReportView -> bypass (cùng quyền dùng chung Mở Mới/Sửa Chữa)', () => {
  const reportViewer = { username: 'xem_bc_store', dept: 'Phòng B', perms: { operationStoreReportView: true } };
  const item = { id: 2, dept: 'Phòng A', estimateItems: [] };
  assert(canViewOperationRepair(reportViewer, item, APP_DATA_STORE), 'operationStoreReportView phải bypass được canViewOperationRepair()');
});
await run.run('redactOperationEstimateItemsToOwnedScope(): operationStoreReportView -> KHÔNG bị redact (xem đầy đủ estimateItems, cùng khuôn operationRecordViewAll)', () => {
  const reportViewer = { username: 'xem_bc_store', dept: 'Phòng B', perms: { operationStoreReportView: true } };
  const item = { id: 1, dept: 'Phòng A', estimateItems: [{ id: 1, parentId: null, assignedToUsernames: ['ai_do_khac'] }, { id: 2, parentId: 1 }] };
  const result = redactOperationEstimateItemsToOwnedScope(reportViewer, 'OPERATION_STORE_OPENING', item, APP_DATA_STORE);
  assertEqual(result.estimateItems.length, 2, 'operationStoreReportView phải xem TOÀN VẸN estimateItems, không bị redact xuống 0 dòng như người chỉ có "Người Phụ Trách danh mục lớn"');
});
await run.run('canViewOperationStoreOpening(): không có operationStoreReportView + không liên quan -> vẫn bị chặn', () => {
  const item = { id: 1, dept: 'Phòng A', estimateItems: [] };
  assert(!canViewOperationStoreOpening(OUTSIDER_NO_PERMS, item, APP_DATA_STORE), 'người không có quyền/không liên quan phải vẫn bị chặn như trước');
});

// ===== 3) carReportView =====
await run.run('canViewCarReg(): carReportView -> bypass, xem được phiếu khác phòng ban/không phải người tạo/không phải lái xe được gán/không phải approver', () => {
  const reportViewer = { username: 'xem_bc_xe', dept: 'Phòng B', perms: { carReportView: true } };
  const item = { id: 1, dept: 'Phòng A', creator: 'ai_do_khac', assignedDriverUsername: 'lai_xe_khac' };
  const appData = { carDeptWorkflows: {} };
  assert(canViewCarReg(reportViewer, item, appData), 'carReportView phải bypass được phạm vi phòng ban/người tạo/lái xe/approver');
});
await run.run('canViewCarReg(): không có carReportView + không liên quan -> vẫn bị chặn', () => {
  const item = { id: 1, dept: 'Phòng A', creator: 'ai_do_khac', assignedDriverUsername: 'lai_xe_khac' };
  const appData = { carDeptWorkflows: {} };
  assert(!canViewCarReg(OUTSIDER_NO_PERMS, item, appData), 'người không có quyền/không liên quan phải vẫn bị chặn như trước');
});

// ===== 4) meetingReportView =====
await run.run('canViewMeeting(): meetingReportView -> bypass, xem được lịch họp khác phòng ban/không phải người tạo, KHÔNG cần meetingApprove/meetingCancel', () => {
  const reportViewer = { username: 'xem_bc_hop', dept: 'Phòng B', perms: { meetingReportView: true } };
  const item = { id: 1, dept: 'Phòng A', creator: 'ai_do_khac' };
  assert(canViewMeeting(reportViewer, item), 'meetingReportView phải bypass được phạm vi phòng ban/người tạo, độc lập với meetingApprove/meetingCancel');
});
await run.run('canViewMeeting(): không có meetingReportView + không liên quan -> vẫn bị chặn', () => {
  const item = { id: 1, dept: 'Phòng A', creator: 'ai_do_khac' };
  assert(!canViewMeeting(OUTSIDER_NO_PERMS, item), 'người không có quyền/không liên quan phải vẫn bị chặn như trước');
});

// ===== 5) budgetReportView (3 collection: budgetEntries/budgetLines/budgetPeriods) =====
await run.run('canViewBudgetEntry(): budgetReportView -> bypass, xem được khác phòng ban, KHÔNG cần budgetManage/budgetAggregate', () => {
  const reportViewer = { username: 'xem_bc_ns', dept: 'Phòng B', perms: { budgetReportView: true } };
  const item = { id: 1, dept: 'Phòng A' };
  const appData = { budgetDeptWorkflows: {} };
  assert(canViewBudgetEntry(reportViewer, item, appData), 'budgetReportView phải bypass được canViewBudgetEntry()');
});
await run.run('canViewBudgetLine(): budgetReportView -> bypass', () => {
  const reportViewer = { username: 'xem_bc_ns', dept: 'Phòng B', perms: { budgetReportView: true } };
  const item = { id: 1, dept: 'Phòng A' };
  assert(canViewBudgetLine(reportViewer, item), 'budgetReportView phải bypass được canViewBudgetLine()');
});
await run.run('canViewBudgetPeriod(): budgetReportView -> bypass', () => {
  const reportViewer = { username: 'xem_bc_ns', dept: 'Phòng B', perms: { budgetReportView: true } };
  const item = { id: 1, dept: 'Phòng A' };
  assert(canViewBudgetPeriod(reportViewer, item), 'budgetReportView phải bypass được canViewBudgetPeriod()');
});
await run.run('canViewBudgetEntry(): không có budgetReportView + khác phòng ban -> vẫn bị chặn', () => {
  const item = { id: 1, dept: 'Phòng A' };
  const appData = { budgetDeptWorkflows: {} };
  assert(!canViewBudgetEntry(OUTSIDER_NO_PERMS, item, appData), 'người không có quyền/khác phòng ban phải vẫn bị chặn như trước');
});

// ===== 6) vppReportView =====
await run.run('canViewVppRegistration(): vppReportView -> bypass, xem được đăng ký của người khác, KHÔNG cần vppManage', () => {
  const reportViewer = { username: 'xem_bc_vpp', dept: 'Phòng B', perms: { vppReportView: true } };
  const item = { id: 1, creator: 'ai_do_khac' };
  const appData = { vppRegistrations: [] };
  assert(canViewVppRegistration(reportViewer, item, appData), 'vppReportView phải bypass được canViewVppRegistration(), độc lập với canManageVpp()');
});
await run.run('canViewVppRegistration(): không có vppReportView + không phải người tạo -> vẫn bị chặn', () => {
  const item = { id: 1, creator: 'ai_do_khac' };
  const appData = { vppRegistrations: [] };
  assert(!canViewVppRegistration(OUTSIDER_NO_PERMS, item, appData), 'người không có quyền/không phải người tạo phải vẫn bị chặn như trước');
});

// ===== 7) hrReportView — route thật GET /api/hr-profile/reports (routes/employeeProfile.js) =====
function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}
stubModule('lib/appData', {
  getAppDataValue: async (key) => (key === 'employeeProfiles' ? [] : []),
  getAllAppData: async () => ({ employeeProfiles: [] }),
  withLockedAppDataValue: async (key, fn) => fn([])
});
stubModule('lib/recordStore', {
  getAllForCollection: async () => [],
  insertRecord: async () => {}, deleteRecordById: async () => {},
  withLockedRecordForCollection: async () => {}, withLockedRecordById: async () => {}
});

const HR_REPORT_VIEWER = { username: 'xem_bc_ns2', dept: 'Phòng B', perms: { hrReportView: true }, active: true };
const HR_FULL_MANAGER = { username: 'hr_full', dept: 'Phòng NS', perms: { hrProfileManage: true, hrContractManage: true }, active: true };
const HR_HALF_MANAGER = { username: 'hr_half', dept: 'Phòng NS', perms: { hrProfileManage: true }, active: true };
const HR_NOTHING = { username: 'nv_thuong', dept: 'Phòng C', perms: {}, active: true };
const HR_USERS = [HR_REPORT_VIEWER, HR_FULL_MANAGER, HR_HALF_MANAGER, HR_NOTHING];

let CURRENT_USERNAME = HR_REPORT_VIEWER.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = HR_USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.username };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => p, isBcryptHash: () => false, validatePin: () => null
});

const employeeProfileRoutes = require('../routes/employeeProfile');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/hr-profile', employeeProfileRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
    server.on('error', reject);
  });
}
function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: urlPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body || '{}') }));
    }).on('error', reject);
  });
}

const server = await startApp();
try {
  await run.run('GET /api/hr-profile/reports: hrReportView (không kèm hrProfileManage/hrContractManage) -> 200 OK', async () => {
    CURRENT_USERNAME = HR_REPORT_VIEWER.username;
    const res = await httpGet('/api/hr-profile/reports');
    assertEqual(res.status, 200, 'hrReportView phải đủ để xem báo cáo, không cần combo AND cũ');
  });
  await run.run('GET /api/hr-profile/reports: đủ CẢ 2 quyền cũ (hrProfileManage + hrContractManage), KHÔNG có hrReportView -> vẫn 200 OK (combo cũ không bị yếu đi)', async () => {
    CURRENT_USERNAME = HR_FULL_MANAGER.username;
    const res = await httpGet('/api/hr-profile/reports');
    assertEqual(res.status, 200, 'combo AND cũ vẫn phải hoạt động y hệt trước khi thêm hrReportView');
  });
  await run.run('GET /api/hr-profile/reports: chỉ có 1 trong 2 quyền cũ (hrProfileManage, thiếu hrContractManage), KHÔNG có hrReportView -> vẫn 403 (additive-only, không mở rộng ngoài ý định)', async () => {
    CURRENT_USERNAME = HR_HALF_MANAGER.username;
    const res = await httpGet('/api/hr-profile/reports');
    assertEqual(res.status, 403, 'thiếu 1 trong 2 quyền cũ và không có hrReportView vẫn phải bị chặn như trước');
  });
  await run.run('GET /api/hr-profile/reports: không có quyền gì -> 403', async () => {
    CURRENT_USERNAME = HR_NOTHING.username;
    const res = await httpGet('/api/hr-profile/reports');
    assertEqual(res.status, 403, 'người không có quyền gì phải vẫn bị chặn như trước');
  });
} finally {
  server.close();
}

}

main().then(() => run.summary()).catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
