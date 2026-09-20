// server/tests/test-operation-order-mixed-approver-preload.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao — phát hiện #2):
// isApproverForAnyOperationOrderTier() (routes/data.js) là bộ lọc TRƯỚC KHI TẢI quyết định "user này có
// nên tải operationOrders company-wide (như admin) hay chỉ tải theo phòng ban mình" — TRƯỚC ĐÂY chỉ quét
// operationOrderStoreTierWorkflows/operationOrderHOTierWorkflows[...].approvers, nhưng từ đợt "Quy Trình
// Hỗn Hợp" (lib/workflowEngine.js resolveOperationOrderWorkflow()), approver đơn STORE KHÔNG còn lấy từ
// tier config nữa — 100% từ operationOrderStoreMixedApprovalRules, mà hàm này CHƯA BAO GIỜ đọc mảng đó.
// Hậu quả: người duyệt dòng NGOẠI LỆ (rule.stores[]) hoặc dòng JOBTITLE mặc định qua secondaryPositions[]
// không được coi là approver -> chỉ tải operationOrders theo phòng ban mình -> không thấy đơn cần duyệt
// ở Hộp Thư Duyệt (dù applyWorkflowAction() vẫn cho họ duyệt ĐÚNG nếu tải được, canApproveStep() không
// đổi gì — đây thuần là lỗi PHẠM VI TẢI TRƯỚC, không phải lỗi phân quyền duyệt).
//
// Gọi thẳng hàm thật (export qua module.exports.isApproverForAnyOperationOrderTier, xem routes/data.js).
//
// Chạy: node server/tests/test-operation-order-mixed-approver-preload.js
'use strict';
const assert = require('assert');
const { isApproverForAnyOperationOrderTier } = require('../routes/data');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log(`PASS: ${name}`); }
  catch (err) { fail++; console.log(`FAIL: ${name}\n  -> ${err.message}`); }
}

const REGIONAL_MANAGER = { username: 'qlv', name: 'Quản Lý Vùng', dept: 'Siêu Thị A', jobTitle: 'Quản Lý Vùng' };
const STORE_MANAGER_B = { username: 'gd.b', name: 'GĐ Siêu Thị B', dept: 'Siêu Thị B', jobTitle: 'Giám Đốc Siêu Thị' };
const RANDOM_EMPLOYEE = { username: 'nv1', name: 'Nhân Viên Thường', dept: 'Siêu Thị A', jobTitle: 'Nhân Viên' };
const HO_APPROVER = { username: 'ho1', name: 'Người Duyệt HO', dept: 'Phòng Mua Hàng' };

function baseData(overrides) {
  return Object.assign({
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    operationOrderStoreMixedApprovalRules: []
  }, overrides);
}

test('LỖI ĐÃ VÁ: dòng NGOẠI LỆ (PERSON mode, stores[] khai riêng) -> username đó PHẢI được coi là approver', () => {
  const data = baseData({
    operationOrderStoreMixedApprovalRules: [
      { id: 1, step: 1, mode: 'PERSON', username: REGIONAL_MANAGER.username, stores: ['Siêu Thị X', 'Siêu Thị Y'] }
    ]
  });
  assert.strictEqual(isApproverForAnyOperationOrderTier(REGIONAL_MANAGER, data), true);
});

test('LỖI ĐÃ VÁ: dòng JOBTITLE mặc định (stores rỗng) -> user có đúng jobTitle PHẢI được coi là approver', () => {
  const data = baseData({
    operationOrderStoreMixedApprovalRules: [
      { id: 2, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc Siêu Thị', stores: [] }
    ]
  });
  assert.strictEqual(isApproverForAnyOperationOrderTier(STORE_MANAGER_B, data), true);
});

test('User KHÔNG khớp bất kỳ rule nào (username/jobTitle) -> KHÔNG được coi là approver (over-inclusive không phải mục tiêu, nhưng không được false negative NGƯỢC LẠI ở trường hợp khớp)', () => {
  const data = baseData({
    operationOrderStoreMixedApprovalRules: [
      { id: 1, step: 1, mode: 'PERSON', username: REGIONAL_MANAGER.username, stores: ['Siêu Thị X'] },
      { id: 2, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc Siêu Thị', stores: [] }
    ]
  });
  assert.strictEqual(isApproverForAnyOperationOrderTier(RANDOM_EMPLOYEE, data), false);
});

test('HO tier vẫn hoạt động như cũ (không đổi hành vi) — approver theo operationOrderHOTierWorkflows', () => {
  const data = baseData({
    operationOrderHOTierWorkflows: { LT100M: { workflowId: 'WF_1STEP', approvers: { 1: [HO_APPROVER.username] } } }
  });
  assert.strictEqual(isApproverForAnyOperationOrderTier(HO_APPROVER, data), true);
  assert.strictEqual(isApproverForAnyOperationOrderTier(RANDOM_EMPLOYEE, data), false);
});

test('Không có username -> luôn false (an toàn)', () => {
  assert.strictEqual(isApproverForAnyOperationOrderTier({}, baseData({})), false);
  assert.strictEqual(isApproverForAnyOperationOrderTier(null, baseData({})), false);
});

test('rule null/thiếu field trong mảng operationOrderStoreMixedApprovalRules không làm hàm crash', () => {
  const data = baseData({ operationOrderStoreMixedApprovalRules: [null, {}, { mode: 'PERSON' }] });
  assert.strictEqual(isApproverForAnyOperationOrderTier(RANDOM_EMPLOYEE, data), false);
});

console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
process.exitCode = fail ? 1 : 0;
