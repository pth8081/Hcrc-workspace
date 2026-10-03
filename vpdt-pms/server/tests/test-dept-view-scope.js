// server/tests/test-dept-view-scope.js
//
// 10/2026, theo yêu cầu người dùng "làm ma trận để tự cấu hình khoá/mở xem theo phòng ban", nâng cấp lên
// MA TRẬN 4 TRẠNG THÁI ở v24.74 ("cần 4 trạng thái này mới đúng để có thể chọn tắt mở có thể xem được
// hoặc không thể xem được"): 17 key (11 module gốc budget/payment/office/car/contract/submission/
// meeting/3×operation/report + 6 key mở rộng task/itTicket/itPriceApproval/doc/checklist/vpp) cấu hình
// qua map deptViewScopeConfig (defaults.js) { [key]: { mode, extraViewers, managerCanView } } — admin
// chỉnh ở màn "🔒 Phạm Vi Xem Theo Phòng Ban" (module-admin-deptviewscope.js) mà không cần sửa code.
//
// Bài test THUẦN (không DB/network) — xác minh ĐÚNG các bất biến bắt buộc:
//   1) deptViewScopeConfig THIẾU key -> hành vi khớp ĐÚNG defaultMode riêng của module đó (DEPT_VIEW_SCOPE_MODULES),
//      không đổi gì cho hệ thống chưa từng đụng tới màn cấu hình mới.
//   2) mode = CREATOR_ONLY (hoặc boolean `false` cũ, tương thích ngược) -> người CÙNG PHÒNG nhưng KHÔNG
//      PHẢI người tạo/quản lý cấp trên/admin/approver KHÔNG còn thấy được nữa; NHƯNG các lớp xem khác
//      (creator, manager-of-creator, admin, approver dù khác phòng ban) phải LUÔN giữ nguyên.
//   3) extraViewers (Option 3) — người trong whitelist xem được MỌI bản ghi của module, bất kể phòng ban.
//   4) managerCanView (Option 4) — quản lý (trực tiếp/gián tiếp) của NGƯỜI TẠO xem được dù mode CREATOR_ONLY.
//
// Chạy: node server/tests/test-dept-view-scope.js
'use strict';
const assert = require('assert');
const {
  DEPT_VIEW_SCOPE_MODULES, deptAutoViewOn, moduleViewConfig, extraViewScopeAllows,
  canViewBudgetLine, canViewPaymentRequest, canViewReportEntry,
  canViewOfficeReq, canViewCarReg, canViewContract, canViewSubmission, canViewMeeting,
  canViewOperationOrder, canViewOperationStoreOpening, canViewOperationRepair,
  canViewTaskRecord, canViewItSupportTicket, canViewItPriceApproval, canViewDoc,
  canViewChecklistSubmission, canViewVppRegistration
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

test('DEPT_VIEW_SCOPE_MODULES: đúng 17 key, mỗi key có label + defaultMode hợp lệ', () => {
  assert.strictEqual(DEPT_VIEW_SCOPE_MODULES.length, 17);
  DEPT_VIEW_SCOPE_MODULES.forEach(m => {
    assert(m.key && typeof m.key === 'string');
    assert(m.label && typeof m.label === 'string');
    assert(['DEPT', 'CREATOR_ONLY'].includes(m.defaultMode), `defaultMode không hợp lệ cho ${m.key}`);
  });
});

test('moduleViewConfig(): key vắng mặt -> defaultMode truyền vào, extraViewers/managerCanView rỗng', () => {
  assert.deepStrictEqual(moduleViewConfig({}, 'task', 'CREATOR_ONLY'), { mode: 'CREATOR_ONLY', extraViewers: [], managerCanView: false });
  assert.deepStrictEqual(moduleViewConfig({}, 'budget'), { mode: 'DEPT', extraViewers: [], managerCanView: false });
});
test('moduleViewConfig(): tương thích ngược boolean CŨ (v24.73)', () => {
  assert.strictEqual(moduleViewConfig({ deptViewScopeConfig: { budget: false } }, 'budget').mode, 'CREATOR_ONLY');
  assert.strictEqual(moduleViewConfig({ deptViewScopeConfig: { budget: true } }, 'budget').mode, 'DEPT');
});
test('moduleViewConfig(): object mới đọc đúng cả 3 trường', () => {
  const cfg = moduleViewConfig({ deptViewScopeConfig: { budget: { mode: 'CREATOR_ONLY', extraViewers: ['x'], managerCanView: true } } }, 'budget');
  assert.deepStrictEqual(cfg, { mode: 'CREATOR_ONLY', extraViewers: ['x'], managerCanView: true });
});
test('extraViewScopeAllows(): Option 3 (extraViewers) xem được bất kể phòng ban', () => {
  const appData = { deptViewScopeConfig: { budget: { mode: 'CREATOR_ONLY', extraViewers: ['watcher'] } } };
  assert.strictEqual(extraViewScopeAllows({ username: 'watcher' }, appData, 'budget', 'creator'), true);
  assert.strictEqual(extraViewScopeAllows({ username: 'someone-else' }, appData, 'budget', 'creator'), false);
});
test('extraViewScopeAllows(): Option 4 (managerCanView) dùng isManagerOf() của NGƯỜI TẠO', () => {
  const appData = { deptViewScopeConfig: { budget: { mode: 'CREATOR_ONLY', managerCanView: true } }, users: USERS };
  assert.strictEqual(extraViewScopeAllows(MANAGER, appData, 'budget', 'creator'), true);
  assert.strictEqual(extraViewScopeAllows(BYSTANDER, appData, 'budget', 'creator'), false);
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
// LỖI ĐÃ VÁ (4-state model v24.74): payment KHÔNG có nhánh "chính người tạo luôn xem" như các module chị
// em khác — người tạo mất quyền xem lại chính đề nghị mình vừa tạo ngay khi tắt dept-view.
test('payment: tắt -> CHÍNH NGƯỜI TẠO vẫn xem được (lỗi đã vá v24.74)', () => {
  const item = { dept: DEPT, createdBy: 'creator' };
  const off = { deptViewScopeConfig: { payment: false }, users: USERS };
  assert.strictEqual(canViewPaymentRequest({ username: 'creator', dept: OTHER_DEPT, perms: {} }, item, off), true);
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
  const item = { dept: DEPT, creator: 'creator' };
  const off = { deptViewScopeConfig: { operationOrder: false }, workflows: [] };
  assert.strictEqual(canViewOperationOrder(BYSTANDER, item, off), false);
  assert.strictEqual(canViewOperationOrder(ADMIN, item, off), true);
});
// LỖI ĐÃ VÁ (4-state model v24.74) — cùng lớp lỗi payment ở trên, cho cả 3 module Vận Hành.
test('operationOrder: tắt -> CHÍNH NGƯỜI TẠO vẫn xem được (lỗi đã vá v24.74)', () => {
  const item = { dept: DEPT, creator: 'creator' };
  const off = { deptViewScopeConfig: { operationOrder: false }, workflows: [] };
  assert.strictEqual(canViewOperationOrder({ username: 'creator', dept: OTHER_DEPT, perms: {} }, item, off), true);
});
test('operationStoreOpening: tắt -> cùng phòng KHÔNG xem được, operationRepair KHÔNG bị ảnh hưởng (độc lập)', () => {
  const item = { dept: DEPT, creator: 'creator', estimateItems: [] };
  const off = { deptViewScopeConfig: { operationStoreOpening: false } };
  assert.strictEqual(canViewOperationStoreOpening(BYSTANDER, item, off), false);
  assert.strictEqual(canViewOperationRepair(BYSTANDER, item, off), true);
});
test('operationStoreOpening: tắt -> CHÍNH NGƯỜI TẠO vẫn xem được (lỗi đã vá v24.74)', () => {
  const item = { dept: DEPT, creator: 'creator', estimateItems: [] };
  const off = { deptViewScopeConfig: { operationStoreOpening: false } };
  assert.strictEqual(canViewOperationStoreOpening({ username: 'creator', dept: OTHER_DEPT, perms: {} }, item, off), true);
});
test('operationRepair: tắt -> cùng phòng KHÔNG xem được', () => {
  const item = { dept: DEPT, creator: 'creator', estimateItems: [] };
  const off = { deptViewScopeConfig: { operationRepair: false } };
  assert.strictEqual(canViewOperationRepair(BYSTANDER, item, off), false);
  assert.strictEqual(canViewOperationRepair(ADMIN, item, off), true);
});
test('operationRepair: tắt -> CHÍNH NGƯỜI TẠO vẫn xem được (lỗi đã vá v24.74)', () => {
  const item = { dept: DEPT, creator: 'creator', estimateItems: [] };
  const off = { deptViewScopeConfig: { operationRepair: false } };
  assert.strictEqual(canViewOperationRepair({ username: 'creator', dept: OTHER_DEPT, perms: {} }, item, off), true);
});

// ===================== 5 module MỞ RỘNG v24.74 (task/itTicket/itPriceApproval/doc/checklist/vpp) =====================
// Công Việc: "người tạo" = assignedBy (xác nhận người dùng). Lớp cố định (assignedTo/collaborators/
// manager-của-assignedTo) KHÔNG bị đụng tới dù cấu hình gì — 4 trạng thái chỉ thêm lớp bystander mới.
test('task: mặc định (chưa cấu hình) KHÔNG có bystander nào thấy (defaultMode CREATOR_ONLY, tính năng dept là MỚI)', () => {
  const t = { assignedTo: 'emp1', assignedBy: 'boss1', collaborators: [] };
  const BYSTANDER_SAME_DEPT_AS_BOSS = { username: 'other', dept: 'Phòng Boss', perms: {} };
  const users = [{ username: 'boss1', dept: 'Phòng Boss' }, { username: 'emp1', dept: 'Phòng Boss', managerUsername: 'boss1' }];
  assert.strictEqual(canViewTaskRecord(BYSTANDER_SAME_DEPT_AS_BOSS, t, { users }), false);
});
test('task: bật mode DEPT -> cùng phòng NGƯỜI GIAO việc tự động xem; assignedTo/collaborators luôn xem bất kể cấu hình', () => {
  const t = { assignedTo: 'emp1', assignedBy: 'boss1', collaborators: ['c1'] };
  const users = [{ username: 'boss1', dept: 'Phòng Boss' }, { username: 'emp1', dept: 'Phòng Boss', managerUsername: 'boss1' }];
  const on = { deptViewScopeConfig: { task: { mode: 'DEPT' } }, users };
  assert.strictEqual(canViewTaskRecord({ username: 'other', dept: 'Phòng Boss', perms: {} }, t, on), true);
  assert.strictEqual(canViewTaskRecord({ username: 'emp1', dept: 'Phòng Boss', perms: {} }, t, {}), true);
  assert.strictEqual(canViewTaskRecord({ username: 'c1', dept: 'Phòng Khác', perms: {} }, t, {}), true);
});
test('task: extraViewers (Option 3) xem được dù mặc định CREATOR_ONLY', () => {
  const t = { assignedTo: 'emp1', assignedBy: 'boss1', collaborators: [] };
  const appData = { deptViewScopeConfig: { task: { extraViewers: ['watcher'] } }, users: [] };
  assert.strictEqual(canViewTaskRecord({ username: 'watcher', dept: 'X', perms: {} }, t, appData), true);
});

// IT Hỗ Trợ (ticket): mặc định hẹp (admin/itManage/creator/approvalApprover), mode DEPT là tính năng MỚI admin tự chọn.
test('itTicket: mặc định KHÔNG mở rộng theo phòng ban (giữ đúng thiết kế cố ý từ trước)', () => {
  const t = { creator: 'creator', dept: DEPT };
  assert.strictEqual(canViewItSupportTicket(BYSTANDER, t, {}), false);
});
test('itTicket: admin bật mode DEPT -> cùng phòng tự động xem', () => {
  const t = { creator: 'creator', dept: DEPT };
  const on = { deptViewScopeConfig: { itTicket: { mode: 'DEPT' } } };
  assert.strictEqual(canViewItSupportTicket(BYSTANDER, t, on), true);
});

// Phê Duyệt Giá: mặc định hẹp (admin/itPriceSupport/creator/approver đúng bước), itPriceSupport LUÔN
// xem hết KHÔNG BỊ ảnh hưởng bởi map này (xác nhận người dùng 10/2026 — kiểm tra có phần nằm TRƯỚC check dept).
test('itPriceApproval: mặc định KHÔNG mở rộng theo phòng ban', () => {
  const item = { creator: 'creator', dept: DEPT, priceType: 'RETAIL' };
  assert.strictEqual(canViewItPriceApproval(BYSTANDER, item, {}), false);
});
test('itPriceApproval: itPriceSupport luôn xem hết, không bị map deptViewScopeConfig ảnh hưởng', () => {
  const item = { creator: 'creator', dept: OTHER_DEPT, priceType: 'RETAIL' };
  const off = { deptViewScopeConfig: { itPriceApproval: { mode: 'CREATOR_ONLY' } } };
  assert.strictEqual(canViewItPriceApproval({ username: 'support1', dept: DEPT, perms: { itPriceSupport: true } }, item, off), true);
});
test('itPriceApproval: admin bật mode DEPT -> cùng phòng tự động xem', () => {
  const item = { creator: 'creator', dept: DEPT, priceType: 'RETAIL' };
  const on = { deptViewScopeConfig: { itPriceApproval: { mode: 'DEPT' } } };
  assert.strictEqual(canViewItPriceApproval(BYSTANDER, item, on), true);
});

// Tài Liệu: default NGƯỢC (CREATOR_ONLY) — chỉ người tạo/người duyệt xem trừ khi admin bật mode DEPT
// hoặc thêm extraViewers/managerCanView (v24.75: đã bỏ hẳn 4 quyền phẳng viewDraftDepts/viewApprovedDepts
// cũ ở Ma Trận Phân Quyền, Tài Liệu giờ xét quyền xem HOÀN TOÀN qua đúng khuôn deptViewScopeConfig này).
test('doc: mặc định KHÔNG tự xem cùng phòng (default khác hẳn 11 module gốc)', () => {
  const doc = { uploader: 'creator', dept: DEPT, status: 'PENDING' };
  assert.strictEqual(canViewDoc(BYSTANDER, doc, {}), false);
});
test('doc: admin bật mode DEPT -> cùng phòng tự động xem', () => {
  const doc = { uploader: 'creator', dept: DEPT, status: 'PENDING' };
  const on = { deptViewScopeConfig: { doc: { mode: 'DEPT' } } };
  assert.strictEqual(canViewDoc(BYSTANDER, doc, on), true);
});

// Checklist: ĐÃ có sẵn nhánh "cùng siêu thị tự động xem" (defaultMode DEPT) — admin có thể TẮT.
test('checklist: mặc định (chưa cấu hình) cùng siêu thị (bài không phải nháp) vẫn xem được — giữ nguyên hành vi gốc', () => {
  const sub = { submittedByUsername: 'creator', storeCode: DEPT, status: 'SUBMITTED' };
  assert.strictEqual(canViewChecklistSubmission({ username: 'other', dept: DEPT, posType: 'STORE', perms: {} }, sub, {}), true);
});
test('checklist: admin tắt (mode CREATOR_ONLY) -> cùng siêu thị KHÔNG còn tự động xem', () => {
  const sub = { submittedByUsername: 'creator', storeCode: DEPT, status: 'SUBMITTED' };
  const off = { deptViewScopeConfig: { checklist: { mode: 'CREATOR_ONLY' } } };
  assert.strictEqual(canViewChecklistSubmission({ username: 'other', dept: DEPT, posType: 'STORE', perms: {} }, sub, off), false);
  assert.strictEqual(canViewChecklistSubmission({ username: 'creator', dept: DEPT, perms: {} }, sub, off), true);
});

// Văn Phòng Phẩm: mặc định hẹp (admin/vppManage/creator/approver đúng bước).
test('vpp: mặc định KHÔNG mở rộng theo phòng ban', () => {
  const item = { creator: 'creator', dept: DEPT };
  assert.strictEqual(canViewVppRegistration(BYSTANDER, item, {}), false);
});
test('vpp: admin bật mode DEPT -> cùng phòng tự động xem', () => {
  const item = { creator: 'creator', dept: DEPT };
  const on = { deptViewScopeConfig: { vpp: { mode: 'DEPT' } } };
  assert.strictEqual(canViewVppRegistration(BYSTANDER, item, on), true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
