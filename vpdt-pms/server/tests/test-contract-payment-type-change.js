// tests/test-contract-payment-type-change.js — Yêu cầu 2 (đợt "4 yêu cầu 1 khối"): cho sửa Hình Thức
// Thanh Toán của hợp đồng ĐÃ APPROVED, qua phê duyệt lại bởi ĐÚNG nhóm người duyệt "Tài liệu ký"
// (contractManageDeptWorkflows[dept]). Gọi THẲNG 3 hàm thật ở lib/recordActions.js — không tự đọc DB
// (nhận dữ liệu qua tham số), test được trực tiếp trong Node thuần.
'use strict';
const assert = require('assert');
const recordActions = require('../lib/recordActions');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.message}`); fail++; }
}

const CREATOR = { username: 'creator1', name: 'Người Tạo Hợp Đồng', dept: 'Phòng Kinh Doanh' };
const OTHER_USER = { username: 'other1', name: 'Người Khác', dept: 'Phòng Kinh Doanh' };
const APPROVER = { username: 'approver1', name: 'Người Duyệt Tài Liệu Ký', dept: 'Phòng Kinh Doanh' };
const ADMIN = { username: 'admin1', name: 'Admin', perms: { admin: true } };

const appData = {
  contractManageDeptWorkflows: { 'Phòng Kinh Doanh': { workflowId: 'WF_1STEP', approvers: { 1: [APPROVER.username] } } },
  workflows: []
};

function freshContract() {
  return {
    id: 1, code: 'HCRC-KD-HD-001', dept: 'Phòng Kinh Doanh', creator: CREATOR.username,
    approvalStatus: 'APPROVED', amount: 1000000,
    paymentType: 'ONE_TIME', paymentInstallments: [],
    pendingPaymentTypeChange: null
  };
}

check('requestContractPaymentTypeChange(): người KHÁC người tạo bị chặn 403', () => {
  const c = freshContract();
  assert.throws(() => recordActions.requestContractPaymentTypeChange(
    OTHER_USER, c, { newPaymentType: 'PERIODIC' }, appData, []
  ), (err) => err.status === 403);
});

check('requestContractPaymentTypeChange(): hợp đồng CHƯA APPROVED bị chặn 409', () => {
  const c = freshContract();
  c.approvalStatus = 'PENDING';
  assert.throws(() => recordActions.requestContractPaymentTypeChange(
    CREATOR, c, { newPaymentType: 'PERIODIC' }, appData, []
  ), (err) => err.status === 409);
});

check('requestContractPaymentTypeChange(): đã có paymentRequests tham chiếu hợp đồng -> chặn 409 rõ lý do', () => {
  const c = freshContract();
  const allPaymentRequests = [{ id: 99, sourceModule: 'CONTRACT', sourceId: c.id }];
  assert.throws(() => recordActions.requestContractPaymentTypeChange(
    CREATOR, c, { newPaymentType: 'PERIODIC' }, appData, allPaymentRequests
  ), (err) => err.status === 409 && /đề nghị thanh toán/.test(err.message));
});

check('requestContractPaymentTypeChange(): paymentRequests của HỢP ĐỒNG KHÁC không chặn', () => {
  const c = freshContract();
  const allPaymentRequests = [{ id: 99, sourceModule: 'CONTRACT', sourceId: 999 }];
  const result = recordActions.requestContractPaymentTypeChange(
    CREATOR, c, { newPaymentType: 'PERIODIC', newPaymentInstallments: [] }, appData, allPaymentRequests
  );
  assert.ok(result.pendingPaymentTypeChange);
});

check('requestContractPaymentTypeChange(): tổng các đợt không khớp amount -> 400', () => {
  const c = freshContract();
  assert.throws(() => recordActions.requestContractPaymentTypeChange(
    CREATOR, c, {
      newPaymentType: 'PERIODIC',
      newPaymentInstallments: [{ description: 'Đợt 1', amount: 500000, dueDate: '' }] // thiếu 500k so với amount 1tr
    }, appData, []
  ), (err) => err.status === 400);
});

check('requestContractPaymentTypeChange(): hợp lệ -> tạo pendingPaymentTypeChange, CHƯA áp dụng paymentType thật', () => {
  const c = freshContract();
  const result = recordActions.requestContractPaymentTypeChange(
    CREATOR, c, {
      newPaymentType: 'PERIODIC',
      newPaymentInstallments: [{ description: 'Đợt 1', amount: 1000000, dueDate: '' }],
      reason: 'Đổi sang định kỳ'
    }, appData, []
  );
  assert.strictEqual(result.paymentType, 'ONE_TIME'); // CHƯA đổi
  assert.strictEqual(result.pendingPaymentTypeChange.newPaymentType, 'PERIODIC');
  assert.strictEqual(result.pendingPaymentTypeChange.requestedBy, CREATOR.username);
});

check('approveContractPaymentTypeChange(): người KHÔNG thuộc contractManageDeptWorkflows[dept] bị chặn 403', () => {
  const c = freshContract();
  recordActions.requestContractPaymentTypeChange(CREATOR, c, { newPaymentType: 'PERIODIC', newPaymentInstallments: [] }, appData, []);
  assert.throws(() => recordActions.approveContractPaymentTypeChange(OTHER_USER, c, appData), (err) => err.status === 403);
});

check('approveContractPaymentTypeChange(): admin LUÔN duyệt được dù không có tên trong danh sách', () => {
  const c = freshContract();
  recordActions.requestContractPaymentTypeChange(CREATOR, c, { newPaymentType: 'PERIODIC', newPaymentInstallments: [] }, appData, []);
  const result = recordActions.approveContractPaymentTypeChange(ADMIN, c, appData);
  assert.strictEqual(result.paymentType, 'PERIODIC');
});

check('approveContractPaymentTypeChange(): đúng người duyệt -> áp đúng paymentType/paymentInstallments mới + ghi lịch sử + xoá pending', () => {
  const c = freshContract();
  recordActions.requestContractPaymentTypeChange(CREATOR, c, {
    newPaymentType: 'PERIODIC',
    newPaymentInstallments: [{ description: 'Đợt 1', amount: 1000000, dueDate: '2026-12-01' }],
    reason: 'Đổi sang định kỳ'
  }, appData, []);
  const result = recordActions.approveContractPaymentTypeChange(APPROVER, c, appData);
  assert.strictEqual(result.paymentType, 'PERIODIC');
  assert.strictEqual(result.paymentInstallments.length, 1);
  assert.strictEqual(result.paymentInstallments[0].amount, 1000000);
  assert.strictEqual(result.pendingPaymentTypeChange, null);
  assert.strictEqual(result.paymentTypeChangeHistory.length, 1);
  assert.strictEqual(result.paymentTypeChangeHistory[0].approvedBy, APPROVER.username);
  assert.strictEqual(result.paymentTypeChangeHistory[0].fromPaymentType, 'ONE_TIME');
  assert.strictEqual(result.paymentTypeChangeHistory[0].toPaymentType, 'PERIODIC');
});

check('approveContractPaymentTypeChange(): không có pending nào đang chờ -> 409', () => {
  const c = freshContract();
  assert.throws(() => recordActions.approveContractPaymentTypeChange(APPROVER, c, appData), (err) => err.status === 409);
});

check('rejectContractPaymentTypeChange(): người không thuộc nhóm duyệt bị chặn 403', () => {
  const c = freshContract();
  recordActions.requestContractPaymentTypeChange(CREATOR, c, { newPaymentType: 'PERIODIC', newPaymentInstallments: [] }, appData, []);
  assert.throws(() => recordActions.rejectContractPaymentTypeChange(OTHER_USER, c, { reason: 'Không hợp lý' }, appData), (err) => err.status === 403);
});

check('rejectContractPaymentTypeChange(): thiếu lý do -> 400', () => {
  const c = freshContract();
  recordActions.requestContractPaymentTypeChange(CREATOR, c, { newPaymentType: 'PERIODIC', newPaymentInstallments: [] }, appData, []);
  assert.throws(() => recordActions.rejectContractPaymentTypeChange(APPROVER, c, {}, appData), (err) => err.status === 400);
});

check('rejectContractPaymentTypeChange(): CHỈ xoá pendingPaymentTypeChange, KHÔNG đổi paymentType/paymentInstallments hiện tại', () => {
  const c = freshContract();
  recordActions.requestContractPaymentTypeChange(CREATOR, c, {
    newPaymentType: 'PERIODIC', newPaymentInstallments: [{ description: 'Đợt 1', amount: 1000000, dueDate: '' }]
  }, appData, []);
  const result = recordActions.rejectContractPaymentTypeChange(APPROVER, c, { reason: 'Không đồng ý' }, appData);
  assert.strictEqual(result.pendingPaymentTypeChange, null);
  assert.strictEqual(result.paymentType, 'ONE_TIME'); // giữ nguyên, không đổi
  assert.strictEqual(result.paymentInstallments.length, 0); // giữ nguyên, không đổi
  assert.strictEqual(result.paymentTypeChangeHistory[0].rejectedBy, APPROVER.username);
  assert.strictEqual(result.paymentTypeChangeHistory[0].rejectReason, 'Không đồng ý');
});

console.log(`\n=== test-contract-payment-type-change.js: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
