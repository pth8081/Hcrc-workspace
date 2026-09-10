// server/tests/test-operation-order-receiving.js
//
// Test THUẦN (không cần Playwright/SQL Server) cho đợt "Vận Hành > Đơn Hàng: Báo Cáo + Nhập Hàng":
//   1. lib/workflowEngine.js applyWorkflowAction() — operationOrders:
//      - Duyệt xong bước CUỐI tự động chuyển status APPROVED -> AWAITING_RECEIPT (KHÔNG dừng ở APPROVED
//        như trước) + ghi approvedAt (ISO). Bước GIỮA (chưa phải bước cuối) vẫn PENDING/ADVANCED như cũ,
//        KHÔNG bị đụng.
//      - Từ chối (REJECT) vẫn y hệt hành vi cũ (REJECTED, không có approvedAt) — regression cho quy
//        trình duyệt phòng ban gốc, đây là phần rủi ro cao nhất theo yêu cầu.
//      - Chặn đúng quyền (canApproveStep) y hệt trước — không nới lỏng gì thêm.
//      - Module KHÁC (carRegs) hoàn toàn KHÔNG bị ảnh hưởng bởi nhánh operationOrders mới thêm — vẫn
//        dừng ở APPROVED như trước (đúng phạm vi if (moduleKey === 'operationOrders') tường minh).
//   2. lib/recordActions.js receiveOperationOrderGoods()/cancelOperationOrderReceipt():
//      - Chỉ nhận từ AWAITING_RECEIPT, từ chối rõ ràng (409) nếu sai trạng thái nguồn.
//      - Chỉ đúng quần thể được phép mới gọi được (403) — admin hoặc quyền RIÊNG
//        operationOrderReceiptManage ({all,depts[]}, 'HO' là sentinel) — KHÔNG còn mirror approvers
//        dept-workflow của quy trình Duyệt/Từ chối như trước (đợt "Duyệt Nhập/Hủy Đơn Hàng tập trung").
//      - cancelOperationOrderReceipt() bắt buộc có lý do (400 nếu thiếu).
//      - Thành công: đúng status đích + timestamp ISO tương ứng + 1 dòng lịch sử mới.
//   3. seedDefaults.migrateApprovedOperationOrdersToAwaitingReceipt() — hồ sơ CŨ kẹt APPROVED (từ trước
//      đợt này) tự động chuyển sang AWAITING_RECEIPT, approvedAt lấy lại từ lịch sử APPROVED cuối cùng
//      nếu parse được; idempotent; KHÔNG đụng hồ sơ đã ở trạng thái khác hoặc đã đúng AWAITING_RECEIPT.
//
// Chạy: node server/tests/test-operation-order-receiving.js
const assert = require('assert');
const { applyWorkflowAction, WorkflowError } = require('../lib/workflowEngine');
const recordActions = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}
function assertThrows(fn, statusExpected, messageContains, label) {
  try {
    fn();
  } catch (err) {
    assert(err instanceof WorkflowError || err.name === 'HttpError' || typeof err.status === 'number', `${label}: lỗi ném ra phải có .status (HttpError/WorkflowError), nhận được: ${err}`);
    if (statusExpected !== undefined) assert.strictEqual(err.status, statusExpected, `${label}: sai mã lỗi (nhận ${err.status})`);
    if (messageContains) assert(err.message.includes(messageContains), `${label}: message "${err.message}" phải chứa "${messageContains}"`);
    return;
  }
  throw new Error(`${label}: đáng lẽ phải ném lỗi nhưng không`);
}

// ===== Fixture chung: 1 phòng ban, 2 khuôn quy trình (1 bước / 2 bước) =====
const DEPT = 'Phòng Vận Hành';
const APPROVER_STEP1 = 'tp.vanhanh';
const APPROVER_STEP2 = 'gd.congty';
// operationOrderDeptWorkflows (theo phòng ban) đã bị XOÁ HẲN — đợt "Tách Đơn Hàng Siêu Thị/HO" đổi sang
// quy trình theo MỨC GIÁ TRỊ, TÁCH RIÊNG Siêu Thị/HO (xem lib/workflowEngine.js). Fixture của test này
// giữ nguyên orderLocationType='HO' cho MỌI đơn (freshOrder() bên dưới) + amount 1.000.000 (< 100 triệu)
// nên chỉ cần cấu hình đúng 1 tier LT100M là đủ cho toàn bộ kịch bản Duyệt/Từ Chối/Nhập Hàng ở file này —
// biên giới/độc lập Siêu Thị-HO có bộ test RIÊNG ở test-operation-order-location-tiers.js.
const appData = {
  workflows: [
    { id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] },
    { id: 'WF_2STEP', steps: [{ order: 1, name: 'Trưởng phòng' }, { order: 2, name: 'Giám đốc' }] }
  ],
  operationOrderHOTierWorkflows: {
    LT100M: { workflowId: 'WF_1STEP', approvers: { 1: [APPROVER_STEP1] } }
  },
  // carRegs dùng để xác nhận module KHÁC không bị ảnh hưởng (mục A5) — cùng khuôn appData tối thiểu.
  carRegDeptWorkflows: {
    [DEPT]: { workflowId: 'WF_1STEP', approvers: { 1: [APPROVER_STEP1] } }
  }
};
const appData2Step = {
  workflows: appData.workflows,
  operationOrderHOTierWorkflows: {
    LT100M: { workflowId: 'WF_2STEP', approvers: { 1: [APPROVER_STEP1], 2: [APPROVER_STEP2] } }
  }
};

function freshOrder(overrides) {
  return Object.assign({
    id: 1, code: 'DH-0001', dept: DEPT, status: 'PENDING', currentStep: 1, history: [],
    creator: 'nv.mua', creatorName: 'Nhân Viên Mua Hàng', amount: 1000000, orderLocationType: 'HO', items: []
  }, overrides);
}
function makeUser(username, extra) { return Object.assign({ username, name: username, perms: {} }, extra); }

// ===================== 1) applyWorkflowAction — operationOrders =====================
test('applyWorkflowAction operationOrders APPROVE (bước duy nhất, đúng approver) -> AWAITING_RECEIPT + approvedAt ISO hợp lệ, KHÔNG còn dừng ở APPROVED', () => {
  const item = freshOrder();
  const user = makeUser(APPROVER_STEP1);
  const { item: result, transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user, comment: '', appData });
  assert.strictEqual(transition.type, 'COMPLETED');
  assert.strictEqual(result.status, 'AWAITING_RECEIPT');
  assert(result.approvedAt, 'approvedAt phải được gán');
  assert(!isNaN(new Date(result.approvedAt).getTime()), 'approvedAt phải là chuỗi ISO hợp lệ');
  const lastHist = result.history[result.history.length - 1];
  assert.strictEqual(lastHist.action, 'APPROVED', 'history vẫn ghi đúng hành động APPROVED (không đổi format lịch sử cũ)');
});

test('applyWorkflowAction operationOrders: bước GIỮA (2 bước, mới duyệt bước 1) -> vẫn PENDING/ADVANCED, KHÔNG tự chuyển AWAITING_RECEIPT (chỉ bước CUỐI mới chuyển)', () => {
  const item = freshOrder();
  const user = makeUser(APPROVER_STEP1);
  const { item: result, transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user, comment: '', appData: appData2Step });
  assert.strictEqual(transition.type, 'ADVANCED');
  assert.strictEqual(result.status, 'PENDING', 'bước giữa vẫn phải PENDING (chờ bước 2), không phải AWAITING_RECEIPT');
  assert.strictEqual(result.currentStep, 2);
  assert(!result.approvedAt, 'approvedAt KHÔNG được gán ở bước giữa, chỉ gán khi hoàn tất bước cuối');

  // Bước 2 (bước cuối) duyệt xong -> mới thực sự chuyển AWAITING_RECEIPT.
  const user2 = makeUser(APPROVER_STEP2);
  const { item: result2, transition: transition2 } = applyWorkflowAction({ moduleKey: 'operationOrders', item: result, action: 'APPROVE', user: user2, comment: '', appData: appData2Step });
  assert.strictEqual(transition2.type, 'COMPLETED');
  assert.strictEqual(result2.status, 'AWAITING_RECEIPT');
  assert(result2.approvedAt);
});

test('applyWorkflowAction operationOrders REJECT — vẫn y hệt hành vi cũ (REJECTED, không approvedAt)', () => {
  const item = freshOrder();
  const user = makeUser(APPROVER_STEP1);
  const { item: result, transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'REJECT', user, comment: 'Giá quá cao', appData });
  assert.strictEqual(transition.type, 'REJECTED');
  assert.strictEqual(result.status, 'REJECTED');
  assert(!result.approvedAt, 'REJECTED không được có approvedAt');
});

test('applyWorkflowAction operationOrders — quyền Duyệt/Từ chối KHÔNG bị nới lỏng: người ngoài danh sách approver vẫn bị chặn 403', () => {
  const item = freshOrder();
  const outsider = makeUser('nv.khac');
  assertThrows(
    () => applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: outsider, comment: '', appData }),
    403, 'Bạn không có quyền', 'operationOrders APPROVE bởi người ngoài quyền'
  );
});

test('applyWorkflowAction — module KHÁC (carRegs) HOÀN TOÀN không bị ảnh hưởng: Duyệt xong bước cuối vẫn dừng ở APPROVED như trước (không tự AWAITING_RECEIPT)', () => {
  const item = { id: 9, dept: DEPT, status: 'PENDING', currentStep: 1, history: [] };
  const user = makeUser(APPROVER_STEP1, { perms: { admin: true } });
  const { item: result, transition } = applyWorkflowAction({ moduleKey: 'carRegs', item, action: 'APPROVE', user, comment: '', appData, existingCollection: [], users: [] });
  assert.strictEqual(transition.type, 'COMPLETED');
  assert.strictEqual(result.status, 'APPROVED', 'carRegs phải vẫn dừng ở APPROVED — nhánh mới CHỈ áp dụng cho operationOrders');
  assert(!result.approvedAt, 'carRegs không được có approvedAt (field đó chỉ operationOrders dùng)');
});

// ===================== 2) receiveOperationOrderGoods() / cancelOperationOrderReceipt() =====================
test('receiveOperationOrderGoods(): admin, đúng AWAITING_RECEIPT -> RECEIVED + receivedAt ISO + history mới', () => {
  const item = freshOrder({ status: 'AWAITING_RECEIPT', approvedAt: new Date().toISOString() });
  const admin = makeUser('admin', { perms: { admin: true } });
  const result = recordActions.receiveOperationOrderGoods(admin, item, appData);
  assert.strictEqual(result.status, 'RECEIVED');
  assert(result.receivedAt && !isNaN(new Date(result.receivedAt).getTime()));
  assert.strictEqual(result.history[result.history.length - 1].action, 'RECEIVED');
});

// Đợt "Duyệt Nhập/Hủy Đơn Hàng tập trung": quyền Nhập Hàng/Hủy Nhập KHÔNG còn mirror quần thể Duyệt/Từ
// chối (approvers dept-workflow) như trước — giờ là quyền RIÊNG, phẳng
// (operationOrderReceiptManage: {all, depts[]}, 'HO' là sentinel cho đơn Đặt Hàng Tại HO). 2 test dưới
// đây khoá lại đúng hành vi MỚI: approver bước duyệt KHÔNG có quyền receipt riêng bị chặn; người có
// đúng quyền receipt (dù không phải approver bước duyệt nào) thì được phép.
test('receiveOperationOrderGoods(): approver dept-workflow (KHÔNG có operationOrderReceiptManage) KHÔNG còn được phép mặc định — quyền đã tách riêng', () => {
  const item = freshOrder({ status: 'AWAITING_RECEIPT' });
  const approver = makeUser(APPROVER_STEP1);
  assertThrows(() => recordActions.receiveOperationOrderGoods(approver, item, appData), 403, 'không có quyền', 'receiveOperationOrderGoods approver bước duyệt không có quyền receipt riêng');
});

test('receiveOperationOrderGoods(): người có operationOrderReceiptManage.all=true (KHÔNG phải admin/approver bước duyệt nào) vẫn được phép', () => {
  const item = freshOrder({ status: 'AWAITING_RECEIPT' });
  const receiptManager = makeUser('nv.kho', { perms: { operationOrderReceiptManage: { all: true, depts: [] } } });
  const result = recordActions.receiveOperationOrderGoods(receiptManager, item, appData);
  assert.strictEqual(result.status, 'RECEIVED');
});

test('receiveOperationOrderGoods(): người có operationOrderReceiptManage.depts=["HO"] được phép cho đơn orderLocationType=HO', () => {
  const item = freshOrder({ status: 'AWAITING_RECEIPT', orderLocationType: 'HO' });
  const receiptManager = makeUser('nv.kho2', { perms: { operationOrderReceiptManage: { all: false, depts: ['HO'] } } });
  const result = recordActions.receiveOperationOrderGoods(receiptManager, item, appData);
  assert.strictEqual(result.status, 'RECEIVED');
});

test('receiveOperationOrderGoods(): người có operationOrderReceiptManage nhưng chỉ cấp phòng ban khác (KHÔNG có "HO") bị chặn cho đơn HO', () => {
  const item = freshOrder({ status: 'AWAITING_RECEIPT', orderLocationType: 'HO' });
  const wrongScope = makeUser('nv.kho3', { perms: { operationOrderReceiptManage: { all: false, depts: ['Siêu Thị Quận 1'] } } });
  assertThrows(() => recordActions.receiveOperationOrderGoods(wrongScope, item, appData), 403, 'không có quyền', 'receiveOperationOrderGoods sai phạm vi phòng ban');
});

test('receiveOperationOrderGoods(): sai trạng thái nguồn (PENDING) -> 409, không đổi gì', () => {
  const item = freshOrder({ status: 'PENDING' });
  const admin = makeUser('admin', { perms: { admin: true } });
  assertThrows(() => recordActions.receiveOperationOrderGoods(admin, item, appData), 409, 'chờ nhập hàng', 'receiveOperationOrderGoods sai trạng thái');
  assert.strictEqual(item.status, 'PENDING', 'không được đổi status khi bị chặn');
});

test('receiveOperationOrderGoods(): người KHÔNG phải admin/approver bị chặn 403', () => {
  const item = freshOrder({ status: 'AWAITING_RECEIPT' });
  const outsider = makeUser('nv.khac');
  assertThrows(() => recordActions.receiveOperationOrderGoods(outsider, item, appData), 403, 'không có quyền', 'receiveOperationOrderGoods người ngoài quyền');
});

test('cancelOperationOrderReceipt(): thiếu lý do -> 400', () => {
  const item = freshOrder({ status: 'AWAITING_RECEIPT' });
  const admin = makeUser('admin', { perms: { admin: true } });
  assertThrows(() => recordActions.cancelOperationOrderReceipt(admin, item, {}, appData), 400, 'lý do', 'cancelOperationOrderReceipt thiếu lý do');
});

test('cancelOperationOrderReceipt(): admin + có lý do + đúng AWAITING_RECEIPT -> RECEIPT_CANCELLED + receiptCancelledAt + history ghi lý do', () => {
  const item = freshOrder({ status: 'AWAITING_RECEIPT' });
  const admin = makeUser('admin', { perms: { admin: true } });
  const result = recordActions.cancelOperationOrderReceipt(admin, item, { reason: 'NCC báo hết hàng, không giao được' }, appData);
  assert.strictEqual(result.status, 'RECEIPT_CANCELLED');
  assert(result.receiptCancelledAt && !isNaN(new Date(result.receiptCancelledAt).getTime()));
  const lastHist = result.history[result.history.length - 1];
  assert.strictEqual(lastHist.action, 'RECEIPT_CANCELLED');
  assert.strictEqual(lastHist.comment, 'NCC báo hết hàng, không giao được');
});

test('cancelOperationOrderReceipt(): sai trạng thái nguồn (đã RECEIVED rồi) -> 409', () => {
  const item = freshOrder({ status: 'RECEIVED' });
  const admin = makeUser('admin', { perms: { admin: true } });
  assertThrows(() => recordActions.cancelOperationOrderReceipt(admin, item, { reason: 'abc' }, appData), 409, 'chờ nhập hàng', 'cancelOperationOrderReceipt sai trạng thái nguồn');
});

test('cancelOperationOrderReceipt(): người ngoài quyền bị chặn 403 dù có lý do hợp lệ', () => {
  const item = freshOrder({ status: 'AWAITING_RECEIPT' });
  const outsider = makeUser('nv.khac');
  assertThrows(() => recordActions.cancelOperationOrderReceipt(outsider, item, { reason: 'abc' }, appData), 403, 'không có quyền', 'cancelOperationOrderReceipt người ngoài quyền');
});

// ===================== 3) seedDefaults.migrateApprovedOperationOrdersToAwaitingReceipt() =====================
// Fake lib/recordStore.js tối thiểu (getAllRecords/withLockedRecordById) — cùng kỹ thuật require.cache
// đã dùng ở tests/test-operation-danhmuc-dautu-units.js cho migrateStuckOperationApprovalStatuses().
function makeFakeRecordStore(seed) {
  return {
    async getAllRecords(collection) { return seed[collection] || []; },
    async withLockedRecordById(collection, id, mutatorFn) {
      const arr = seed[collection] || [];
      const idx = arr.findIndex(r => r.id === id);
      if (idx === -1) throw new Error(`fakeRecordStore: không tìm thấy ${collection}#${id}`);
      arr[idx] = await mutatorFn(arr[idx]);
      return arr[idx];
    }
  };
}
function requireFreshMigrationFn(seed) {
  const recordStorePath = require.resolve('../lib/recordStore');
  const seedDefaultsPath = require.resolve('../seedDefaults');
  require.cache[recordStorePath] = { id: recordStorePath, filename: recordStorePath, loaded: true, exports: makeFakeRecordStore(seed) };
  delete require.cache[seedDefaultsPath];
  const { migrateApprovedOperationOrdersToAwaitingReceipt } = require('../seedDefaults');
  return {
    migrateApprovedOperationOrdersToAwaitingReceipt,
    cleanup: () => { delete require.cache[recordStorePath]; delete require.cache[seedDefaultsPath]; }
  };
}

async function main() {
  await testAsync('migrateApprovedOperationOrdersToAwaitingReceipt(): hồ sơ CŨ kẹt APPROVED -> AWAITING_RECEIPT, approvedAt lấy lại từ dòng lịch sử APPROVED cuối cùng (parse được)', async () => {
    const seed = {
      operationOrders: [
        {
          id: 1, code: 'DH-OLD-1', status: 'APPROVED', currentStep: 0,
          history: [
            { step: 1, approver: 'Trưởng Phòng', username: APPROVER_STEP1, action: 'APPROVED', comment: '', time: '08:30:00 15/3/2026' }
          ]
        }
      ]
    };
    const { migrateApprovedOperationOrdersToAwaitingReceipt, cleanup } = requireFreshMigrationFn(seed);
    try {
      await migrateApprovedOperationOrdersToAwaitingReceipt();
      const rec = seed.operationOrders[0];
      assert.strictEqual(rec.status, 'AWAITING_RECEIPT');
      assert(rec.approvedAt, 'phải gán approvedAt');
      const parsedYear = new Date(rec.approvedAt).getFullYear();
      assert.strictEqual(parsedYear, 2026, 'approvedAt phải khớp đúng năm lấy lại từ dòng lịch sử APPROVED (15/3/2026)');
      assert(rec.history.some(h => h.action === 'SYSTEM_MIGRATION'), 'phải ghi thêm 1 dòng SYSTEM_MIGRATION');
    } finally { cleanup(); }
  });

  await testAsync('migrateApprovedOperationOrdersToAwaitingReceipt(): idempotent — chạy 2 lần liên tiếp không đổi gì thêm ở lần 2, không tạo thêm SYSTEM_MIGRATION', async () => {
    const seed = {
      operationOrders: [
        { id: 2, code: 'DH-OLD-2', status: 'APPROVED', currentStep: 0, history: [] }
      ]
    };
    const { migrateApprovedOperationOrdersToAwaitingReceipt, cleanup } = requireFreshMigrationFn(seed);
    try {
      await migrateApprovedOperationOrdersToAwaitingReceipt();
      await migrateApprovedOperationOrdersToAwaitingReceipt();
      const rec = seed.operationOrders[0];
      assert.strictEqual(rec.status, 'AWAITING_RECEIPT');
      const migrationEntries = rec.history.filter(h => h.action === 'SYSTEM_MIGRATION');
      assert.strictEqual(migrationEntries.length, 1, 'chạy lần 2 không được thêm SYSTEM_MIGRATION lần nữa (đã ở AWAITING_RECEIPT, không còn APPROVED để di trú)');
    } finally { cleanup(); }
  });

  await testAsync('migrateApprovedOperationOrdersToAwaitingReceipt(): hồ sơ đang PENDING/REJECTED/DRAFT/RECEIVED không bị đụng tới', async () => {
    const seed = {
      operationOrders: [
        { id: 3, code: 'DH-P', status: 'PENDING', currentStep: 1, history: [] },
        { id: 4, code: 'DH-R', status: 'REJECTED', currentStep: 1, history: [] },
        { id: 5, code: 'DH-D', status: 'DRAFT', currentStep: 0, history: [] },
        { id: 6, code: 'DH-RECEIVED', status: 'RECEIVED', currentStep: 0, history: [], receivedAt: '2026-01-01T00:00:00.000Z' }
      ]
    };
    const snapshotBefore = JSON.parse(JSON.stringify(seed.operationOrders));
    const { migrateApprovedOperationOrdersToAwaitingReceipt, cleanup } = requireFreshMigrationFn(seed);
    try {
      await migrateApprovedOperationOrdersToAwaitingReceipt();
      assert.deepStrictEqual(seed.operationOrders, snapshotBefore, 'không có hồ sơ nào trong nhóm này được đổi gì');
    } finally { cleanup(); }
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
  if (failed) process.exitCode = 1;
}
main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
