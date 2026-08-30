// server/tests/test-audit-round3-lowfixes.js
//
// Regression test cho ĐỢT 3 (round 3) — 4 lỗ hổng/gap "Thấp" trước đây bị bỏ qua ở 2 đợt rà soát trước
// (cần quyết định nghiệp vụ hoặc dễ bị coi nhầm là thiết kế cố ý), nay được xử lý theo yêu cầu người
// dùng "Bạn xử lý luôn giúp tôi nhé". Mỗi kịch bản gắn với ĐÚNG 1 bản vá, viết sao cho hoàn tác bản vá
// là FAIL ngay:
//
//   1. (lib/workflowEngine.js) Admin dùng đặc quyền "bỏ qua điều kiện đủ approver" để Duyệt hộ 1 bước
//      chưa đủ người ký — lịch sử duyệt trước đây không có dấu hiệu nào phân biệt lượt này với 1 lượt
//      duyệt bình thường. Bản vá gắn cờ adminOverride:true vào ĐÚNG dòng lịch sử đó khi (và chỉ khi)
//      còn approver được liệt kê CHƯA duyệt tại thời điểm admin bấm Duyệt.
//
//   2. (lib/createValidation.js + routes/create.js) Mã (code) của 1 hồ sơ đã bị xoá (còn nằm trong
//      Thùng Rác) trước đây có thể bị hồ sơ MỚI dùng lại (kiểm trùng chỉ quét collection đang sống, bỏ
//      qua Thùng Rác) — cả nhánh kiểm trùng chung (mọi module có field code) lẫn nhánh tự tính mã phiên
//      bản tài liệu mới (docs, rootDocId != null).
//
//   3. (lib/recordStore.js + routes/trash.js) Khôi phục 1 phiên bản tài liệu/phụ lục hợp đồng từ Thùng
//      Rác trước đây CHỈ khôi phục đúng mục đó — các thành viên khác cùng "họ" (phiên bản/phụ lục khác)
//      vẫn kẹt trong Thùng Rác, để lại tài liệu/hợp đồng với lịch sử phiên bản bị đứt quãng.
//
//   4. (lib/recordActions.js + routes/records.js) mergeReportPeriodByTasks() tính phạm vi thời gian dựa
//      trên kỳ CLOSED gần nhất — nếu kỳ liền trước (theo thời gian) CHƯA đóng, hàm âm thầm dùng 1 kỳ xa
//      hơn làm mốc, không có cảnh báo nào cho người tổng hợp biết có khoảng trống/chồng lấn ở ranh giới.
//
// Test THUẦN Node (không Playwright): toàn bộ phần sửa nằm ở tầng server, không có mặt nào ở giao diện.
// Gọi THẲNG hàm thật của lib/workflowEngine.js + lib/createValidation.js + lib/recordActions.js +
// lib/recordStore.js (familyRootId — hàm thuần, không đọc DB) với dữ liệu dựng sẵn trong bộ nhớ, không
// chép lại logic nào (khớp khuôn tests/test-audit-round2-cluster*.js).
//
// Chạy: node server/tests/test-audit-round3-lowfixes.js
const assert = require('assert');

const { applyWorkflowAction } = require('../lib/workflowEngine');
const { validateAndPrepareCreate } = require('../lib/createValidation');
const recordActions = require('../lib/recordActions');
const { familyRootId } = require('../lib/recordStore');

// ===================== Runner nhỏ (cùng khuôn test-audit-round2-cluster2.js) =====================
let passed = 0, failed = 0;
function run(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err && err.message}`);
  }
}

function expectHttpError(fn, status, messagePart) {
  let thrown = null;
  try { fn(); } catch (err) { thrown = err; }
  assert.ok(thrown, `Phải bị TỪ CHỐI nhưng lại đi lọt (không ném lỗi nào)`);
  assert.strictEqual(thrown.status, status, `Sai mã lỗi: ${thrown.status} — ${thrown.message}`);
  if (messagePart) {
    assert.ok(String(thrown.message).includes(messagePart),
      `Thông điệp lỗi không khớp: ${JSON.stringify(thrown.message)}`);
  }
}

// ============================================================================
// 1) workflowEngine.js — cờ adminOverride trên lịch sử duyệt
// ============================================================================
console.log('\n===== 1) applyWorkflowAction(): cờ adminOverride =====');

const DEPT = 'Kinh Doanh';
const ADMIN_USER = { username: 'admin1', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true } };
const APPROVER_X = { username: 'x1', name: 'Người X', dept: DEPT, perms: {} };
const APPROVER_Y = { username: 'y1', name: 'Người Y', dept: DEPT, perms: {} };

const WF_APP_DATA = {
  workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
  carDeptWorkflows: { [DEPT]: { workflowId: 'WF_1STEP', approvers: { 1: [APPROVER_X.username, APPROVER_Y.username] } } }
};

function seedCarReg(history) {
  return { id: 1, code: 'XE-2026-001', dept: DEPT, status: 'PENDING', currentStep: 1, history: history || [] };
}

run('Admin Duyệt khi CHƯA có approver nào ký -> ghi adminOverride:true (bypass thật sự)', () => {
  const item = seedCarReg([]);
  const outcome = applyWorkflowAction({
    moduleKey: 'carRegs', item, action: 'APPROVE', user: ADMIN_USER,
    appData: WF_APP_DATA, existingCollection: [item], users: []
  });
  const last = outcome.item.history[outcome.item.history.length - 1];
  assert.strictEqual(last.username, ADMIN_USER.username);
  assert.strictEqual(last.action, 'APPROVED');
  assert.strictEqual(last.adminOverride, true, 'Phải đánh dấu adminOverride khi các approver được liệt kê chưa ai duyệt');
});

run('Admin Duyệt sau khi TẤT CẢ approver được liệt kê đã ký đủ -> KHÔNG đánh dấu (không override gì cả)', () => {
  const item = seedCarReg([
    { step: 1, action: 'APPROVED', username: APPROVER_X.username, time: 't1' },
    { step: 1, action: 'APPROVED', username: APPROVER_Y.username, time: 't2' }
  ]);
  const outcome = applyWorkflowAction({
    moduleKey: 'carRegs', item, action: 'APPROVE', user: ADMIN_USER,
    appData: WF_APP_DATA, existingCollection: [item], users: []
  });
  const last = outcome.item.history[outcome.item.history.length - 1];
  assert.strictEqual(last.username, ADMIN_USER.username);
  assert.ok(!last.adminOverride, 'Không được đánh dấu override khi bước đã đủ người ký từ trước');
});

run('Người dùng thường (không phải admin) Duyệt -> KHÔNG BAO GIỜ có cờ adminOverride', () => {
  const item = seedCarReg([]);
  const outcome = applyWorkflowAction({
    moduleKey: 'carRegs', item, action: 'APPROVE', user: APPROVER_X,
    appData: WF_APP_DATA, existingCollection: [item], users: []
  });
  const last = outcome.item.history[outcome.item.history.length - 1];
  assert.strictEqual(last.username, APPROVER_X.username);
  assert.ok(!('adminOverride' in last), 'Người dùng thường không đi qua đặc quyền admin, không thể có cờ này');
});

run('Cờ CHỈ gắn vào đúng dòng lịch sử của lượt duyệt override, không đụng các dòng khác', () => {
  const item = seedCarReg([{ step: 1, action: 'APPROVED', username: APPROVER_X.username, time: 't1' }]);
  const outcome = applyWorkflowAction({
    moduleKey: 'carRegs', item, action: 'APPROVE', user: ADMIN_USER,
    appData: WF_APP_DATA, existingCollection: [item], users: []
  });
  assert.ok(!('adminOverride' in outcome.item.history[0]), 'Dòng của người X (không phải admin) không được đụng tới');
  assert.strictEqual(outcome.item.history[1].adminOverride, true, 'Chỉ chưa 1/2 approver ký -> admin duyệt vẫn là override');
});

// ============================================================================
// 2) createValidation.js — kiểm trùng mã CẢ trong Thùng Rác
// ============================================================================
console.log('\n===== 2) validateAndPrepareCreate(): trùng mã với hồ sơ đã xoá =====');

const UPLOADER = { username: 'up1', name: 'Người Tải Lên', dept: DEPT, perms: { uploadAll: true, uploadDepts: [] } };
const APP_DATA_EMPTY = { formTemplates: {} };
const docPayload = (over) => ({ dept: DEPT, title: 'Quy trình ISO', cat: 'Quy trình', ver: '1.0', fileUrl: '/uploads/1717171717171-abc.pdf', ...over });

run('Không truyền trashedItems (caller cũ) -> hành vi y hệt trước đây, không bị chặn oan', () => {
  const rec = validateAndPrepareCreate('docs', docPayload({ code: 'TL-001' }), UPLOADER, [], APP_DATA_EMPTY);
  assert.strictEqual(rec.code, 'TL-001');
});

run('Mã trùng với hồ sơ ĐANG SỐNG -> vẫn bị chặn như cũ (không đổi hành vi hiện có)', () => {
  const existing = [{ id: 1, code: 'TL-002' }];
  expectHttpError(() => validateAndPrepareCreate('docs', docPayload({ code: 'TL-002' }), UPLOADER, existing, APP_DATA_EMPTY),
    409, 'đã tồn tại');
});

run('Mã trùng với hồ sơ ĐÃ XOÁ (Thùng Rác) -> bị chặn, không cho dùng lại', () => {
  const trashedItems = [{ trashId: 9, collection: 'docs', originalId: 5, code: 'TL-003', item: { id: 5, code: 'TL-003' } }];
  expectHttpError(() => validateAndPrepareCreate('docs', docPayload({ code: 'TL-003' }), UPLOADER, [], APP_DATA_EMPTY, trashedItems),
    409, 'đã xoá');
});

run('Mã hoàn toàn mới (không trùng sống lẫn Thùng Rác) -> qua bình thường', () => {
  const trashedItems = [{ trashId: 9, collection: 'docs', originalId: 5, code: 'TL-999', item: { id: 5, code: 'TL-999' } }];
  const rec = validateAndPrepareCreate('docs', docPayload({ code: 'TL-NEW-1' }), UPLOADER, [], APP_DATA_EMPTY, trashedItems);
  assert.strictEqual(rec.code, 'TL-NEW-1');
});

run('Nhánh phiên bản tài liệu (rootDocId != null): mã V2 trùng phiên bản đã xoá -> bị chặn', () => {
  const root = { id: 10, code: 'TL-010', displayCode: 'TL-010', dept: DEPT, rootDocId: null, versionNumber: 1, status: 'APPROVED' };
  const collection = [root];
  const trashedItems = [{ trashId: 20, collection: 'docs', originalId: 11, code: 'TL-010-V2', item: { id: 11, code: 'TL-010-V2', rootDocId: 10 } }];
  expectHttpError(() => validateAndPrepareCreate('docs', docPayload({ dept: DEPT, rootDocId: 10 }), UPLOADER, collection, APP_DATA_EMPTY, trashedItems),
    409, 'đã xoá');
});

run('Nhánh phiên bản tài liệu: không trùng Thùng Rác -> tạo version 2 bình thường', () => {
  const root = { id: 10, code: 'TL-010', displayCode: 'TL-010', dept: DEPT, rootDocId: null, versionNumber: 1, status: 'APPROVED' };
  const collection = [root];
  const rec = validateAndPrepareCreate('docs', docPayload({ dept: DEPT, rootDocId: 10 }), UPLOADER, collection, APP_DATA_EMPTY, []);
  assert.strictEqual(rec.code, 'TL-010-V2');
  assert.strictEqual(rec.versionNumber, 2);
});

// ============================================================================
// 3) recordStore.js — familyRootId(): xác định "họ" phiên bản/phụ lục để khôi phục cùng lúc
// ============================================================================
console.log('\n===== 3) familyRootId(): nhóm "họ" cho khôi phục cascade =====');

run('docs: bản GỐC (rootDocId null) -> id gốc là chính id của nó', () => {
  assert.strictEqual(familyRootId('docs', { id: 10, rootDocId: null }), 10);
});

run('docs: 1 PHIÊN BẢN (rootDocId khác null) -> id gốc là rootDocId', () => {
  assert.strictEqual(familyRootId('docs', { id: 11, rootDocId: 10 }), 10);
});

run('contracts: hợp đồng GỐC (isAddendum false) -> id gốc là chính id của nó', () => {
  assert.strictEqual(familyRootId('contracts', { id: 20, isAddendum: false }), 20);
});

run('contracts: 1 PHỤ LỤC (isAddendum true) -> id gốc là rootContractId', () => {
  assert.strictEqual(familyRootId('contracts', { id: 21, isAddendum: true, rootContractId: 20 }), 20);
});

run('Collection không có khái niệm "họ" (vd carRegs) -> null, không nhóm gì cả', () => {
  assert.strictEqual(familyRootId('carRegs', { id: 30 }), null);
});

// ============================================================================
// 4) recordActions.js — mergeReportPeriodByTasks(): cảnh báo khoảng trống ranh giới kỳ
// ============================================================================
console.log('\n===== 4) mergeReportPeriodByTasks(): warning khoảng trống ranh giới =====');

const AGG_USER = { username: 'agg1', name: 'Người Tổng Hợp', dept: 'Ban Giám Đốc', perms: { reportAggregate: true } };
const REPORT_STAFF = { username: 'nv1', name: 'Nhân Viên KD', dept: DEPT };
const targetPeriod = (over) => ({
  id: 3, name: 'Kỳ 3', status: 'CLOSED', endTime: '2026-09-01T00:00:00',
  deptScope: { all: true }, compilation: null, ...over
});
// 1 việc TODO, không hạn chót -> luôn tính vào kỳ (không phụ thuộc startBoundary/endBoundary cụ thể ở
// từng kịch bản dưới đây) — chỉ để deptOrder khác rỗng, không phải trọng tâm của nhóm test này.
const oneTask = () => [{ id: 100, assignedTo: REPORT_STAFF.username, status: 'TODO', title: 'Việc mẫu' }];

run('Kỳ liền trước đã CLOSED, không có khoảng trống -> warning = null, không đụng compilation', () => {
  const period = targetPeriod();
  const priorClosed = { id: 2, name: 'Kỳ 2', status: 'CLOSED', endTime: '2026-08-01T00:00:00' };
  const result = recordActions.mergeReportPeriodByTasks(AGG_USER, period, oneTask(), [REPORT_STAFF], [period, priorClosed]);
  assert.ok(!result.warning, 'Không có khoảng trống thì không được cảnh báo');
  assert.ok(!('warning' in result.period), 'warning KHÔNG được lẫn vào object period sẽ bị lưu lại (JSON.stringify verbatim)');
});

run('Kỳ liền trước CHƯA đóng (còn 1 kỳ CLOSED xa hơn được dùng làm mốc thay thế) -> warning nêu rõ tên kỳ đó', () => {
  const period = targetPeriod();
  const priorClosedFar = { id: 2, name: 'Kỳ 2', status: 'CLOSED', endTime: '2026-08-01T00:00:00' };
  const priorOpenNear = { id: 4, name: 'Kỳ 2.5 (chưa đóng)', status: 'OPEN', endTime: '2026-08-20T00:00:00' };
  const result = recordActions.mergeReportPeriodByTasks(AGG_USER, period, oneTask(), [REPORT_STAFF], [period, priorClosedFar, priorOpenNear]);
  assert.ok(result.warning, 'Phải có cảnh báo vì kỳ liền trước theo thời gian chưa đóng');
  assert.ok(result.warning.includes('Kỳ 2.5'), `Cảnh báo phải nêu tên đúng kỳ liền trước: ${result.warning}`);
  assert.ok(!('warning' in result.period), 'warning vẫn KHÔNG được lẫn vào object period sẽ bị lưu lại');
});

run('Không có kỳ nào trước đó (kỳ đầu tiên) -> warning = null', () => {
  const period = targetPeriod({ id: 1 });
  const result = recordActions.mergeReportPeriodByTasks(AGG_USER, period, oneTask(), [REPORT_STAFF], [period]);
  assert.ok(!result.warning, 'Kỳ đầu tiên không có gì để so sánh, không được cảnh báo');
});

// ===================== Tổng kết =====================
console.log('');
console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
if (failed > 0) process.exitCode = 1;
