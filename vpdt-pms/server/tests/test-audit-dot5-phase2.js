// server/tests/test-audit-dot5-phase2.js
//
// Regression test cho Giai đoạn 2 của Audit Đợt 5:
//   1) lib/recordViewScope.js canViewOperationStoreOpening()/canViewOperationRepair() — người được
//      chỉ định duyệt Dự toán (quy trình estimate ĐỘC LẬP, thường khác phòng ban với hồ sơ chính)
//      phải thấy được hồ sơ qua GET /api/data, không chỉ gọi được action nếu biết trước id.
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

// ===== 1) Người duyệt Dự toán (khác phòng ban) phải thấy hồ sơ =====
const APP_DATA_ESTIMATE = {
  users: [],
  operationWorkItems: [],
  operationStoreOpenEstimateDeptWorkflows: {
    'Phòng A': { approvers: { 1: ['duyet_dutoan'] } }
  },
  operationRepairEstimateDeptWorkflows: {
    'Phòng A': { approvers: { 1: ['duyet_dutoan_sc'] } }
  },
  operationStoreOpenDeptWorkflows: {},
  operationRepairDeptWorkflows: {}
};

await run.run('canViewOperationStoreOpening(): người được gán duyệt Dự toán (khác phòng ban) VẪN thấy hồ sơ', () => {
  const item = { id: 1, dept: 'Phòng A' };
  const approver = { username: 'duyet_dutoan', dept: 'Phòng B', perms: {} };
  assert(canViewOperationStoreOpening(approver, item, APP_DATA_ESTIMATE), 'người duyệt Dự toán phải thấy được hồ sơ dù khác phòng ban');
});

await run.run('canViewOperationStoreOpening(): người không liên quan (không cùng phòng, không duyệt gì) -> KHÔNG thấy', () => {
  const item = { id: 1, dept: 'Phòng A' };
  const unrelated = { username: 'nv_khac', dept: 'Phòng C', perms: {} };
  assert(!canViewOperationStoreOpening(unrelated, item, APP_DATA_ESTIMATE), 'người không liên quan không được thấy hồ sơ Phòng A');
});

await run.run('canViewOperationRepair(): người được gán duyệt Dự toán sửa chữa (khác phòng ban) VẪN thấy hồ sơ', () => {
  const item = { id: 2, dept: 'Phòng A' };
  const approver = { username: 'duyet_dutoan_sc', dept: 'Phòng B', perms: {} };
  assert(canViewOperationRepair(approver, item, APP_DATA_ESTIMATE), 'người duyệt Dự toán sửa chữa phải thấy được hồ sơ dù khác phòng ban');
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
const EXEC_USER = { username: 'qlvh', perms: { operationExecutionManage: true } };

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
    () => createOperationWorkItem(EXEC_USER, { title: 'Việc mới' }, sourceRecord, [], []),
    'phải chặn tạo công việc mới khi hồ sơ đã xác nhận đưa vào sử dụng'
  );
});

await run.run('createOperationWorkItem(): hồ sơ chưa xác nhận đưa vào sử dụng -> tạo bình thường', () => {
  const sourceRecord = { id: 1, estimateStatus: 'APPROVED', useConfirmStatus: null };
  const periods = [{ id: 99, name: 'Kỳ 1', status: 'DANG_THUC_HIEN' }];
  const item = createOperationWorkItem(EXEC_USER, { title: 'Việc mới', periodId: 99 }, sourceRecord, [], periods);
  assertEqual(item.title, 'Việc mới');
});

}

main().then(() => run.summary()).catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
