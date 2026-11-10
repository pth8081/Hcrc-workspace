// server/tests/test-itprice-kiemnhiem-approve-waiver.js
//
// LỖI ĐÃ VÁ (báo cáo người dùng 11/2026, kèm ảnh chụp "Cấu Hình Nâng Cao" QT Giá Bán Buôn với các dòng
// "Thẩm định fresh/ultrafresh/FMCG..." gán theo Chức Danh KIÊM NHIỆM — nguồn: Hồ Sơ Nhân Sự): "Các vị
// trí kiêm nhiệm cho vào trong quy trình đang chập chờn, hiển thị tên trong quy trình như ấn vào phê
// duyệt báo ko có quyền".
//
// NGUYÊN NHÂN: 2 lớp kiểm tra ĐỘC LẬP không khớp nhau khi duyệt QT Giá Bán Lẻ/Bán Buôn (itPriceApprovals):
//   1. Khớp LÀM NGƯỜI DUYỆT bước đó — userHasMixedApprovalPosition() (lib/workflowEngine.js) chỉ cần
//      khớp đúng Chức Danh/Phòng Ban CHÍNH THỨC hoặc KIÊM NHIỆM (u.secondaryPositions[]) — không đòi
//      thêm quyền nào khác, nên tên NGƯỜI hiện đúng ở màn Cấu Hình Nâng Cao ("N người").
//   2. Cổng Khối 0 module access — assertWorkflowModuleAccess()/canAccessItPriceApprovalModuleServer()
//      (routes/workflow.js, lib/recordViewScope.js) ĐÒI RIÊNG tài khoản phải bật Khối 0
//      'muaHang'/'vanHanh'/'itSupport' — HOÀN TOÀN ĐỘC LẬP với việc có khớp vị trí duyệt hay không.
// 1 người chỉ được gán KIÊM NHIỆM đúng 1 vai trò thẩm định (không có Khối 0 Mua Hàng/Vận Hành) hiện tên
// đúng ở Cấu Hình Nâng Cao nhưng bấm Duyệt luôn bị 403 "Module đã bị khoá" TRƯỚC KHI kịp chạm tới
// applyWorkflowAction() (nơi mới thật sự xác minh approversList) — đúng hiện tượng "chập chờn" người
// dùng mô tả (hiện tên nhưng không duyệt được).
//
// ĐÃ VÁ (theo lựa chọn người dùng — "tự động miễn Khối 0 khi khớp đúng vị trí"): routes/workflow.js nay
// kiểm trước — nếu tài khoản ĐÃ được khớp là approver của ĐÚNG bước hiện tại (qua
// resolveWorkflowStepApprovers(), cùng điểm tra cứu applyWorkflowAction() dùng), bỏ qua hẳn cổng Khối 0.
// Mirror HTTP thật — mount routes/workflow.js, stub lib/auth + lib/appData + lib/recordStore.
//
// CẬP NHẬT (xác nhận với người dùng, 11/2026 — "tôi không muốn vị trí kiêm nhiệm đồng bộ từ Hồ Sơ Nhân
// Sự tham gia quy trình phê duyệt, chỉ muốn vị trí gán qua Gán Nhanh"): fixture KIEM_NHIEM_APPROVER ở
// dưới ĐÚNG kịch bản người dùng mô tả lúc báo lỗi gốc (source: 'HR_PROFILE'), nhưng giờ HR_PROFILE không
// còn được tính là approver nữa (xem lib/workflowEngine.js::userHasMixedApprovalPosition()) — đổi
// source fixture này sang 'ADMIN_QUICK_EDIT' (Gán Nhanh) để tiếp tục xác nhận ĐÚNG tính năng "miễn Khối 0
// cho người ĐÃ khớp vị trí duyệt" (mục đích gốc của file này) còn hiệu lực cho nguồn hợp lệ, và thêm 1
// kịch bản MỚI xác nhận riêng source HR_PROFILE giờ bị chặn 403 giống OUTSIDER.
//
// Chạy: node server/tests/test-itprice-kiemnhiem-approve-waiver.js
'use strict';
const http = require('http');
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

const WHOLESALE_TIER = 'MARGIN_LT5';
const KIEM_NHIEM_JOBTITLE = 'Thẩm định ultrafresh';
const KIEM_NHIEM_DEPT = 'Phòng Mua hàng Thực phẩm Tươi sống';

// Tài khoản CHỈ được gán KIÊM NHIỆM đúng 1 vai trò thẩm định qua "Gán Nhanh" (ADMIN_QUICK_EDIT) —
// jobTitle/dept CHÍNH THỨC hoàn toàn KHÁC (không khớp rule nào), và KHÔNG có bất kỳ Khối 0 module access
// itPriceApprovals nào — đúng mô tả thực tế trong ảnh chụp người dùng gửi kèm lúc báo lỗi gốc (lúc đó
// dòng kiêm nhiệm có source 'HR_PROFILE' — nay đổi sang 'ADMIN_QUICK_EDIT' vì HR_PROFILE không còn được
// tính là approver nữa, xem chú thích đầu file).
const KIEM_NHIEM_APPROVER = {
  username: 'bl0890', name: 'Đào Phan Anh', dept: 'Phòng Hành Chính', jobTitle: 'Nhân Viên Hành Chính',
  secondaryPositions: [{ jobTitle: KIEM_NHIEM_JOBTITLE, dept: KIEM_NHIEM_DEPT, source: 'ADMIN_QUICK_EDIT' }],
  perms: { moduleAccess: { itSupport: false, muaHang: false, vanHanh: false } }, active: true
};
// Người KHÔNG khớp vị trí duyệt NÀO và cũng không có Khối 0 — vẫn phải bị chặn như cũ (xác nhận miễn
// Khối 0 chỉ áp dụng cho ĐÚNG người đã khớp, không phải miễn chung cho mọi người).
const OUTSIDER = { username: 'nv_ngoai', name: 'Người Ngoài Cuộc', dept: 'Phòng Kế Toán', jobTitle: 'Nhân Viên Kế Toán', perms: { moduleAccess: { itSupport: false, muaHang: false, vanHanh: false } }, active: true };
// LỖI ĐÃ VÁ (11/2026) — cùng chức danh kiêm nhiệm/phòng ban ĐÚNG hệt KIEM_NHIEM_APPROVER, nhưng nguồn là
// 'HR_PROFILE' (đồng bộ tự động từ Hồ Sơ Nhân Sự, KHÔNG qua Gán Nhanh) — giờ KHÔNG còn được tính là
// approver nữa, phải bị chặn 403 giống OUTSIDER dù "nhìn" giống kiêm nhiệm hợp lệ.
const HR_SYNCED_NOT_APPROVER = {
  username: 'bl0891', name: 'HR Sync Only', dept: 'Phòng Hành Chính', jobTitle: 'Nhân Viên Hành Chính',
  secondaryPositions: [{ jobTitle: KIEM_NHIEM_JOBTITLE, dept: KIEM_NHIEM_DEPT, source: 'HR_PROFILE' }],
  perms: { moduleAccess: { itSupport: false, muaHang: false, vanHanh: false } }, active: true
};
const CREATOR = { username: 'nv1', name: 'Người Đề Xuất', dept: 'Phòng Vận Hành (HO)', perms: {}, active: true };
const USERS = [KIEM_NHIEM_APPROVER, OUTSIDER, HR_SYNCED_NOT_APPROVER, CREATOR];

let CURRENT_USERNAME = KIEM_NHIEM_APPROVER.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find((u) => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const APP_DATA = {
  users: USERS,
  workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
  itPriceDeptWorkflows: {},
  itPriceTierWorkflows: { [WHOLESALE_TIER]: { workflowId: 'WF_1STEP', approvers: {} } },
  itPriceWholesaleStoreMixedApprovalRules: [
    { id: 'r1', tier: WHOLESALE_TIER, step: 1, mode: 'JOBTITLE', jobTitle: KIEM_NHIEM_JOBTITLE, jobTitleDept: KIEM_NHIEM_DEPT, stores: [], nganhHang: [] }
  ],
  storeJobTitles: []
};
stubModule('lib/appData', {
  getAllAppData: async () => APP_DATA,
  getAppDataValue: async () => ({}),
  withLockedAppDataValue: async (_k, fn) => fn([])
});

let RECORDS;
function resetRecords() {
  RECORDS = {
    itPriceApprovals: [{
      id: 1, dept: 'Siêu Thị X', status: 'PENDING', currentStep: 1, code: 'ITP-2026-0003', title: 'Đề xuất giá bán buôn ultrafresh',
      priceType: 'WHOLESALE', priceTier: WHOLESALE_TIER, storeScope: { stores: ['Siêu Thị X'] }, nganhHang: [],
      creator: CREATOR.username, creatorName: CREATOR.name, history: [], forwardThreads: []
    }]
  };
}
resetRecords();
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(RECORDS)),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex((x) => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    const updated = await mutatorFn(list[idx]);
    list[idx] = updated;
    return updated;
  },
  withAppLock: async (key, fn) => fn(),
  insertRecord: async (c, rec) => rec
});
stubModule('lib/taskStore', { insertTask: async () => {} });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
stubModule('lib/notifications', { notifyUsers: async () => {} });
stubModule('lib/approvalAuth', { consumeApprovalGrant: async () => true });

const express = require('express');
const workflowRoutes = require('../routes/workflow');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/workflow', workflowRoutes);
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
  console.log('== QT Giá Bán Buôn — vị trí KIÊM NHIỆM khớp vị trí duyệt nhưng KHÔNG có Khối 0 module access ==');
  const server = await startApp();
  try {
    await test('Khớp đúng vị trí qua KIÊM NHIỆM (secondaryPositions) + KHÔNG có Khối 0 muaHang/vanHanh/itSupport -> VẪN duyệt được (miễn Khối 0)', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/itPriceApprovals/1/approve', { comment: 'Đồng ý giá' }, KIEM_NHIEM_APPROVER);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.item.status, 'APPROVED', JSON.stringify(r.body));
    });

    await test('Người KHÔNG khớp vị trí duyệt nào (và cũng không có Khối 0) -> VẪN bị chặn 403 như cũ (miễn Khối 0 chỉ áp dụng cho người ĐÃ khớp)', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/itPriceApprovals/1/approve', { comment: 'Đồng ý giá' }, OUTSIDER);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
      assert.ok(/Module này đã bị khoá/.test(r.body?.error || ''), `message phải nêu đúng lý do Khối 0, nhận: ${JSON.stringify(r.body)}`);
    });

    await test('LỖI ĐÃ VÁ: vị trí kiêm nhiệm source HR_PROFILE (đồng bộ từ Hồ Sơ Nhân Sự, KHÔNG qua Gán Nhanh) KHÔNG còn được miễn Khối 0 -> vẫn bị chặn 403 giống OUTSIDER', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/itPriceApprovals/1/approve', { comment: 'Đồng ý giá' }, HR_SYNCED_NOT_APPROVER);
      assert.strictEqual(r.status, 403, JSON.stringify(r.body));
      assert.ok(/Module này đã bị khoá/.test(r.body?.error || ''), `message phải nêu đúng lý do Khối 0, nhận: ${JSON.stringify(r.body)}`);
    });

    await test('Khớp vị trí qua KIÊM NHIỆM nhưng gửi REJECT (không chỉ APPROVE) -> cũng được miễn Khối 0', async () => {
      resetRecords();
      const r = await api('POST', '/api/workflow/itPriceApprovals/1/reject', { comment: 'Không hợp lý' }, KIEM_NHIEM_APPROVER);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.item.status, 'REJECTED', JSON.stringify(r.body));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
