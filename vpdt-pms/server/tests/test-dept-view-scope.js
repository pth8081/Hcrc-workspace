// server/tests/test-dept-view-scope.js
//
// 10/2026, theo yêu cầu người dùng "làm ma trận để tự cấu hình khoá/mở xem theo phòng ban": 11 module
// (budget/payment/office/car/contract/submission/meeting/3×operation/report) trước đây CỨNG 1 nhánh
// "cùng phòng ban là tự động xem được" trong lib/recordViewScope.js (scopeAllows() hoặc so trực tiếp
// item.dept === user.dept) — nay CỘNG THÊM map deptViewScopeConfig (defaults.js) để admin tắt/bật từng
// module qua màn "🔒 Phạm Vi Xem Theo Phòng Ban" (module-admin-deptviewscope.js) mà không cần sửa code.
//
// Bài test THUẦN (không DB/network) — xác minh ĐÚNG 2 bất biến bắt buộc cho CẢ 11 module:
//   1) deptViewScopeConfig THIẾU hoặc module = true (mặc định) -> hành vi CŨ giữ nguyên 100% (cùng phòng
//      là thấy), không đổi gì cho hệ thống chưa từng đụng tới màn cấu hình mới.
//   2) deptViewScopeConfig[module] = false -> người CÙNG PHÒNG nhưng KHÔNG PHẢI người tạo/quản lý cấp
//      trên/admin/approver KHÔNG còn thấy được nữa; NHƯNG các lớp xem khác (creator, manager-of-creator,
//      admin, approver dù khác phòng ban) phải LUÔN giữ nguyên, không bị tắt theo.
//
// Chạy: node server/tests/test-dept-view-scope.js
'use strict';
const assert = require('assert');
const {
  DEPT_VIEW_SCOPE_MODULES, deptAutoViewOn,
  canViewBudgetLine, canViewPaymentRequest, canViewReportEntry,
  canViewOfficeReq, canViewCarReg, canViewContract, canViewSubmission, canViewMeeting,
  canViewOperationOrder, canViewOperationStoreOpening, canViewOperationRepair
} = require('../lib/recordViewScope');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const DEPT = 'Phòng Kinh Doanh';
const OTHER_DEPT = 'Phòng Kỹ Thuật';
const BYSTANDER = { username: 'bystander', dept: DEPT, perms: {} };
const CREATOR = { username: 'creator', dept: OTHER_DEPT, perms: {} };
const MANAGER = { username: 'manager', dept: OTHER_DEPT, perms: {} };
const ADMIN = { username: 'admin1', dept: OTHER_DEPT, perms: { admin: true } };
const USERS = [{ username: 'creator', managerUsername: 'manager' }, { username: 'manager' }];

test('DEPT_VIEW_SCOPE_MODULES: đúng 11 key, mỗi key có label', () => {
  assert.strictEqual(DEPT_VIEW_SCOPE_MODULES.length, 11);
  DEPT_VIEW_SCOPE_MODULES.forEach(m => {
    assert(m.key && typeof m.key === 'string');
    assert(m.label && typeof m.label === 'string');
  });
});

test('deptAutoViewOn(): thiếu appData/config -> true (mặc định an toàn)', () => {
  assert.strictEqual(deptAutoViewOn(undefined, 'budget'), true);
  assert.strictEqual(deptAutoViewOn({}, 'budget'), true);
  assert.strictEqual(deptAutoViewOn({ deptViewScopeConfig: {} }, 'budget'), true);
});
test('deptAutoViewOn(): moduleKey rỗng (canDownloadRecordFile không truyền) -> luôn true', () => {
  assert.strictEqual(deptAutoViewOn({ deptViewScopeConfig: { office: false } }, undefined), true);
});
test('deptAutoViewOn(): module = false -> false; module khác trong CÙNG map không bị ảnh hưởng', () => {
  const cfg = { deptViewScopeConfig: { office: false } };
  assert.strictEqual(deptAutoViewOn(cfg, 'office'), false);
  assert.strictEqual(deptAutoViewOn(cfg, 'car'), true);
});

// ===================== budget (so trực tiếp, không qua scopeAllows) =====================
test('budget: mặc định (chưa cấu hình) cùng phòng vẫn xem được', () => {
  const item = { dept: DEPT, createdBy: 'creator' };
  assert.strictEqual(canViewBudgetLine(BYSTANDER, item), true);
});
test('budget: tắt -> cùng phòng (không phải người tạo) KHÔNG xem được, người tạo vẫn xem được', () => {
  const item = { dept: DEPT, createdBy: 'creator' };
  const off = { deptViewScopeConfig: { budget: false } };
  assert.strictEqual(canViewBudgetLine(BYSTANDER, item, off), false);
  assert.strictEqual(canViewBudgetLine({ username: 'creator', dept: DEPT, perms: {} }, item, off), true);
});

// ===================== payment (so trực tiếp) =====================
test('payment: tắt -> cùng phòng KHÔNG xem được; quản lý cấp trên của người tạo vẫn xem được', () => {
  const item = { dept: DEPT, createdBy: 'creator' };
  const off = { deptViewScopeConfig: { payment: false }, users: USERS };
  assert.strictEqual(canViewPaymentRequest(BYSTANDER, item, off), false);
  assert.strictEqual(canViewPaymentRequest(MANAGER, item, off), true);
});

// ===================== report (so trực tiếp, chỉ bản đã GỬI) =====================
test('report: tắt -> cùng phòng KHÔNG xem được bản đã gửi của người khác; người tạo luôn xem được (kể cả DRAFT)', () => {
  const sent = { dept: DEPT, creator: 'creator', status: 'SUBMITTED' };
  const off = { deptViewScopeConfig: { report: false } };
  assert.strictEqual(canViewReportEntry(BYSTANDER, sent, off), false);
  assert.strictEqual(canViewReportEntry({ username: 'creator', dept: DEPT, perms: {} }, sent, off), true);
});

// ===================== 5 module qua scopeAllows (office/car/contract/submission/meeting) =====================
const SCOPE_ALLOWS_CASES = [
  { key: 'office', fn: canViewOfficeReq },
  { key: 'car', fn: canViewCarReg },
  { key: 'submission', fn: canViewSubmission },
  { key: 'meeting', fn: canViewMeeting }
];
SCOPE_ALLOWS_CASES.forEach(({ key, fn }) => {
  test(`${key}: mặc định cùng phòng xem được`, () => {
    const item = { dept: DEPT, creator: 'creator' };
    assert.strictEqual(fn(BYSTANDER, item, { workflows: [], users: USERS }), true);
  });
  test(`${key}: tắt -> cùng phòng (bystander) KHÔNG xem được`, () => {
    const item = { dept: DEPT, creator: 'creator' };
    const off = { deptViewScopeConfig: { [key]: false }, workflows: [], users: USERS };
    assert.strictEqual(fn(BYSTANDER, item, off), false);
  });
  test(`${key}: tắt -> người tạo VẪN xem được`, () => {
    const item = { dept: DEPT, creator: 'creator' };
    const off = { deptViewScopeConfig: { [key]: false }, workflows: [], users: USERS };
    assert.strictEqual(fn({ username: 'creator', dept: OTHER_DEPT, perms: {} }, item, off), true);
  });
  test(`${key}: tắt -> admin VẪN xem được`, () => {
    const item = { dept: DEPT, creator: 'creator' };
    const off = { deptViewScopeConfig: { [key]: false }, workflows: [], users: USERS };
    assert.strictEqual(fn(ADMIN, item, off), true);
  });
});
test('contract: tắt -> cùng phòng KHÔNG xem được; custodianDept khác cũng áp dụng toggle', () => {
  const item = { dept: DEPT, custodianDept: OTHER_DEPT, creator: 'creator' };
  const off = { deptViewScopeConfig: { contract: false }, workflows: [], users: USERS };
  assert.strictEqual(canViewContract(BYSTANDER, item, off), false);
  assert.strictEqual(canViewContract({ username: 'custodian', dept: OTHER_DEPT, perms: {} }, item, off), false);
});
test('contract: tắt -> quản lý cấp trên của người tạo vẫn xem được', () => {
  const item = { dept: DEPT, creator: 'creator' };
  const off = { deptViewScopeConfig: { contract: false }, workflows: [], users: USERS };
  assert.strictEqual(canViewContract(MANAGER, item, off), true);
});

// ===================== 3 module Vận Hành (so trực tiếp, field dept riêng từng loại) =====================
test('operationOrder: tắt -> cùng phòng KHÔNG xem được', () => {
  const item = { dept: DEPT };
  const off = { deptViewScopeConfig: { operationOrder: false }, workflows: [] };
  assert.strictEqual(canViewOperationOrder(BYSTANDER, item, off), false);
  assert.strictEqual(canViewOperationOrder(ADMIN, item, off), true);
});
test('operationStoreOpening: tắt -> cùng phòng KHÔNG xem được, operationRepair KHÔNG bị ảnh hưởng (độc lập)', () => {
  const item = { dept: DEPT, estimateItems: [] };
  const off = { deptViewScopeConfig: { operationStoreOpening: false } };
  assert.strictEqual(canViewOperationStoreOpening(BYSTANDER, item, off), false);
  assert.strictEqual(canViewOperationRepair(BYSTANDER, item, off), true);
});
test('operationRepair: tắt -> cùng phòng KHÔNG xem được', () => {
  const item = { dept: DEPT, estimateItems: [] };
  const off = { deptViewScopeConfig: { operationRepair: false } };
  assert.strictEqual(canViewOperationRepair(BYSTANDER, item, off), false);
  assert.strictEqual(canViewOperationRepair(ADMIN, item, off), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
