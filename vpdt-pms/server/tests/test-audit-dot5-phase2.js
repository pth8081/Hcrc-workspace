// server/tests/test-audit-dot5-phase2.js
//
// Regression test cho Giai đoạn 2 của Audit Đợt 5:
//   1) lib/recordViewScope.js canViewOperationStoreOpening()/canViewOperationRepair() — nhánh "đang là
//      approver Dự toán" ĐÃ BỊ XOÁ (chủ ứng dụng xác nhận Vận Hành > Siêu Thị không còn bước phê duyệt
//      nào cả, kể cả Dự toán) — người ở phòng ban khác, không phải người phụ trách công việc/danh mục
//      đầu tư nào trên hồ sơ, KHÔNG còn được thấy hồ sơ chỉ vì từng được cấu hình là approver.
//   2) lib/recordViewScope.js assertNoManagerCycle() — vẫn hoạt động đúng sau khi chuyển từ
//      routes/data.js sang đây (dùng chung cho cả POST /api/data/users lẫn route hẹp
//      POST /api/admin/org-chart/set-manager).
//   3) lib/recordActions.js deleteOperationWorkItem() — chặn xoá công việc đã "Đã nghiệm thu".
//   4) lib/recordActions.js createOperationWorkItem() — chặn tạo công việc mới sau khi hồ sơ đã
//      "Xác nhận đưa vào sử dụng" (useConfirmStatus === 'CONFIRMED').
//
// Chạy: node server/tests/test-audit-dot5-phase2.js
const { createRunner, assert, assertEqual } = require('./testHarness');
const {
  canViewOperationStoreOpening, canViewOperationRepair, assertNoManagerCycle
} = require('../lib/recordViewScope');
const { createOperationWorkItem, deleteOperationWorkItem } = require('../lib/recordActions');

const run = createRunner();

function assertThrows(fn, message) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error(message || 'Đáng lẽ phải throw nhưng không throw');
}

async function main() {

// ===== 1) Nhánh "đang là approver Dự toán" đã XOÁ — người khác phòng ban, không phụ trách gì trên hồ
// sơ, KHÔNG còn được thấy hồ sơ nữa (dù trước đây từng có cấu hình approver cho phòng ban đó) =====
const APP_DATA_ESTIMATE = {
  users: [],
  operationWorkItems: [],
  operationStoreOpenDeptWorkflows: {},
  operationRepairDeptWorkflows: {}
};

await run.run('canViewOperationStoreOpening(): người khác phòng ban, không phụ trách công việc/danh mục nào -> KHÔNG còn thấy hồ sơ (đã bỏ nhánh approver Dự toán)', () => {
  const item = { id: 1, dept: 'Phòng A', estimateItems: [] };
  const outsider = { username: 'duyet_dutoan', dept: 'Phòng B', perms: {} };
  assert(!canViewOperationStoreOpening(outsider, item, APP_DATA_ESTIMATE), 'Vận Hành > Siêu Thị không còn phê duyệt Dự toán -> không còn nhánh approver mở rộng quyền xem');
});

await run.run('canViewOperationStoreOpening(): người không liên quan (không cùng phòng, không phụ trách gì) -> KHÔNG thấy', () => {
  const item = { id: 1, dept: 'Phòng A', estimateItems: [] };
  const unrelated = { username: 'nv_khac', dept: 'Phòng C', perms: {} };
  assert(!canViewOperationStoreOpening(unrelated, item, APP_DATA_ESTIMATE), 'người không liên quan không được thấy hồ sơ Phòng A');
});

await run.run('canViewOperationRepair(): người khác phòng ban, không phụ trách công việc/danh mục nào -> KHÔNG còn thấy hồ sơ (đã bỏ nhánh approver Dự toán)', () => {
  const item = { id: 2, dept: 'Phòng A', estimateItems: [] };
  const outsider = { username: 'duyet_dutoan_sc', dept: 'Phòng B', perms: {} };
  assert(!canViewOperationRepair(outsider, item, APP_DATA_ESTIMATE), 'Vận Hành > Siêu Thị không còn phê duyệt Dự toán -> không còn nhánh approver mở rộng quyền xem');
});

// ===== 2) assertNoManagerCycle vẫn đúng sau khi chuyển vị trí =====
await run.run('assertNoManagerCycle(): cây quản lý hợp lệ (không vòng lặp) -> không throw', () => {
  const users = [
    { username: 'ceo', managerUsername: null },
    { username: 'gd1', managerUsername: 'ceo' },
    { username: 'nv1', managerUsername: 'gd1' }
  ];
  assertNoManagerCycle(users);
});

await run.run('assertNoManagerCycle(): vòng lặp trực tiếp (A quản lý B, B quản lý A) -> throw', () => {
  const users = [
    { username: 'a', managerUsername: 'b' },
    { username: 'b', managerUsername: 'a' }
  ];
  assertThrows(() => assertNoManagerCycle(users), 'phải throw khi có vòng lặp trực tiếp');
});

await run.run('assertNoManagerCycle(): vòng lặp gián tiếp nhiều cấp -> throw', () => {
  const users = [
    { username: 'a', managerUsername: 'c' },
    { username: 'b', managerUsername: 'a' },
    { username: 'c', managerUsername: 'b' }
  ];
  assertThrows(() => assertNoManagerCycle(users), 'phải throw khi có vòng lặp gián tiếp qua nhiều cấp');
});

// ===== 3) deleteOperationWorkItem() chặn xoá việc đã "Đã nghiệm thu" =====
// Overhaul quyền Vận Hành > Siêu Thị: operationExecutionManage đã RÚT GỌN — dùng operationRecordManageAll
// (toàn quyền MỌI hồ sơ, không cần sourceRecord/creator khớp) để giữ nguyên phạm vi test này (chặn theo
// trạng thái công việc, không phải theo quyền — xem tests/test-operation-store-lifecycle.js cho phần
// test quyền creator-scoped đầy đủ của đợt overhaul này).
const EXEC_USER = { username: 'qlvh', perms: { operationRecordManageAll: true } };

await run.run('deleteOperationWorkItem(): công việc CHUA_BAT_DAU -> xoá được bình thường', () => {
  const item = { id: 10, status: 'CHUA_BAT_DAU' };
  const result = deleteOperationWorkItem(EXEC_USER, item, [11, 12]);
  assertEqual(JSON.stringify(result), JSON.stringify([10, 11, 12]));
});

await run.run('deleteOperationWorkItem(): công việc DA_NGHIEM_THU -> bị chặn, không xoá được', () => {
  const item = { id: 10, status: 'DA_NGHIEM_THU' };
  assertThrows(() => deleteOperationWorkItem(EXEC_USER, item, []), 'phải chặn xoá công việc đã nghiệm thu xong');
});

// ===== 4) createOperationWorkItem() chặn tạo mới sau khi đã "Xác nhận đưa vào sử dụng" =====
await run.run('createOperationWorkItem(): hồ sơ đã useConfirmStatus=CONFIRMED -> chặn tạo công việc mới', () => {
  const sourceRecord = { id: 1, estimateStatus: 'APPROVED', useConfirmStatus: 'CONFIRMED' };
  assertThrows(
    () => createOperationWorkItem(EXEC_USER, { title: 'Việc mới' }, sourceRecord, [], [], undefined, 'OPERATION_STORE_OPENING'),
    'phải chặn tạo công việc mới khi hồ sơ đã xác nhận đưa vào sử dụng'
  );
});

await run.run('createOperationWorkItem(): hồ sơ chưa xác nhận đưa vào sử dụng -> tạo bình thường', () => {
  const sourceRecord = { id: 1, estimateStatus: 'APPROVED', useConfirmStatus: null };
  const periods = [{ id: 99, name: 'Kỳ 1', status: 'DANG_THUC_HIEN' }];
  const item = createOperationWorkItem(EXEC_USER, { title: 'Việc mới', periodId: 99 }, sourceRecord, [], periods, undefined, 'OPERATION_STORE_OPENING');
  assertEqual(item.title, 'Việc mới');
});

}

main().then(() => run.summary()).catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
