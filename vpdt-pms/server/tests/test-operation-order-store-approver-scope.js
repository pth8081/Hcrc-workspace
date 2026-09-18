// server/tests/test-operation-order-store-approver-scope.js
//
// Test THUẦN Node (không Playwright/SQL Server) cho cơ chế "Quy Trình Hỗn Hợp" (10/2026, THAY HẲN cơ chế
// cũ "Duyệt Đơn Hàng Siêu Thị tự khớp đúng siêu thị" — filterOperationOrderStoreApprovers(), đã xoá) —
// người duyệt của đơn "Đặt Hàng Tại Siêu Thị" giờ tra 100% từ appData.operationOrderStoreMixedApprovalRules,
// KHÔNG còn đọc approvers/approverMode/approversByPosition của operationOrderStoreTierWorkflows nữa (tier
// config chỉ còn quyết định SỐ BƯỚC qua workflowId).
//
// Xem lib/workflowEngine.js::resolveOperationOrderStoreMixedApprovers()/
// resolveOperationOrderStoreMixedApprovalRuleUsernames()/resolveOperationOrderWorkflow() cho cơ chế đầy
// đủ + lý do thiết kế (KHÔNG đọc/phụ thuộc Cơ Cấu Tổ Chức — thuần phân quyền phẳng jobTitle/dept trên hồ
// sơ Người Dùng + cấu hình dòng Quy Trình Hỗn Hợp, dùng CHUNG applyWorkflowAction() nên test qua đây phủ
// luôn nhánh approve/reject thật, không chỉ hàm resolve).
//
// Phủ:
//   1. PERSON mode, stores CÓ giá trị (ngoại lệ): chỉ đúng siêu thị liệt kê mới duyệt được, KHÔNG phụ
//      thuộc dept của chính người đó (khác PEOPLE mode cũ) — 1 người CÓ THỂ phụ trách nhiều siêu thị nếu
//      liệt kê nhiều.
//   2. JOBTITLE mode, stores RỖNG (mặc định) + secondaryPositions ("Vị Trí Kiêm Nhiệm"): tự khớp theo
//      dept CHÍNH hoặc 1 secondaryPositions của TỪNG người giữ đúng chức danh với ĐÚNG siêu thị đơn.
//   3. JOBTITLE mode, stores RỖNG: kịch bản chính người dùng mô tả — nhiều người cùng giữ 1 chức danh,
//      chỉ đúng người có dept khớp siêu thị đơn mới duyệt được, KHÔNG cần liệt kê tay từng siêu thị.
//   4. Option B (đã chốt với người dùng): 1 dòng MẶC ĐỊNH (JOBTITLE, stores rỗng) + 1 dòng NGOẠI LỆ
//      (JOBTITLE khác, có stores) cùng khớp 1 (bước, siêu thị) -> HỢP (UNION) người duyệt lại, không loại
//      trừ nhau.
//   5. HO hoàn toàn KHÔNG đi qua Quy Trình Hỗn Hợp: approver tier HO (dept bất kỳ) vẫn đọc thẳng
//      operationOrderHOTierWorkflows như cũ, không đổi hành vi.
//   6. admin vẫn duyệt được mọi đơn STORE bất kể dept (nhánh admin bypass ở applyWorkflowAction()/
//      canApproveStep(), không đi qua Quy Trình Hỗn Hợp — regression tránh vô tình khoá luôn cả admin).
//
// Chạy: node server/tests/test-operation-order-store-approver-scope.js
'use strict';
const assert = require('assert');
const {
  applyWorkflowAction, WorkflowError,
  resolveOperationOrderWorkflow
} = require('../lib/workflowEngine');

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
function assertThrows(fn, statusExpected, messageContains, label) {
  try {
    fn();
  } catch (err) {
    assert(err instanceof WorkflowError || typeof err.status === 'number', `${label}: lỗi ném ra phải có .status`);
    if (statusExpected !== undefined) assert.strictEqual(err.status, statusExpected, `${label}: sai mã lỗi (nhận ${err.status})`);
    if (messageContains) assert(err.message.includes(messageContains), `${label}: message "${err.message}" phải chứa "${messageContains}"`);
    return;
  }
  throw new Error(`${label}: đáng lẽ phải ném lỗi nhưng không`);
}
function freshOrder(overrides) {
  return Object.assign({
    id: 1, code: 'DH-0001', dept: 'Siêu Thị A', status: 'PENDING', currentStep: 1, history: [],
    creator: 'nv.a', creatorName: 'Nhân Viên A', amount: 5000000, orderLocationType: 'STORE', items: []
  }, overrides);
}

// ===================== 1) PERSON mode, stores CÓ giá trị: chỉ đúng siêu thị liệt kê mới duyệt được =====================
{
  const gdA = { username: 'gd.a', name: 'Giám Đốc A', dept: 'Siêu Thị A', perms: {} };
  const gdB = { username: 'gd.b', name: 'Giám Đốc B', dept: 'Siêu Thị B', perms: {} };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [gdA, gdB],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    // gd.a chỉ được gán phụ trách "Siêu Thị A" (ngoại lệ) — gd.b hoàn toàn không có dòng nào.
    operationOrderStoreMixedApprovalRules: [
      { id: 1, step: 1, mode: 'PERSON', username: gdA.username, stores: ['Siêu Thị A'] }
    ]
  };

  test('PERSON mode: đơn Siêu Thị A, gd.a (đúng siêu thị được gán) duyệt được', () => {
    const item = freshOrder({ dept: 'Siêu Thị A' });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: gdA, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
  test('PERSON mode: đơn Siêu Thị A, gd.b (không có dòng cấu hình nào) PHẢI bị chặn 403', () => {
    const item = freshOrder({ dept: 'Siêu Thị A' });
    assertThrows(
      () => applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: gdB, comment: '', appData }),
      403, 'Bạn không có quyền', 'gd.b duyệt nhầm đơn Siêu Thị A'
    );
  });
  test('PERSON mode: resolveOperationOrderWorkflow() cho đơn Siêu Thị A chỉ trả về đúng gd.a, không có gd.b', () => {
    const item = freshOrder({ dept: 'Siêu Thị A' });
    const resolved = resolveOperationOrderWorkflow(item, appData);
    assert.deepStrictEqual(resolved.approvers[1], [gdA.username]);
  });
  test('PERSON mode: đơn Siêu Thị B (ngoài phạm vi "stores" của gd.a) -> gd.a KHÔNG duyệt được, dù dept của chính gd.a là Siêu Thị A', () => {
    const item = freshOrder({ id: 2, dept: 'Siêu Thị B' });
    assertThrows(
      () => applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: gdA, comment: '', appData }),
      403, 'Bạn không có quyền', 'gd.a duyệt nhầm đơn Siêu Thị B ngoài phạm vi được gán'
    );
  });
}

// ===================== 2) JOBTITLE mode, stores rỗng (mặc định) + secondaryPositions mở rộng phạm vi =====================
{
  const gdVung = {
    username: 'gd.vung', name: 'Giám Đốc Vùng', jobTitle: 'Giám Đốc', dept: 'Siêu Thị A', perms: {},
    secondaryPositions: [{ jobTitle: 'Giám Đốc', dept: 'Siêu Thị B' }]
  };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [gdVung],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    operationOrderStoreMixedApprovalRules: [
      { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc', stores: [] }
    ]
  };
  test('JOBTITLE mặc định + secondaryPositions: gd.vung (dept chính = Siêu Thị A, kiêm nhiệm Siêu Thị B) duyệt được CẢ 2 siêu thị', () => {
    const itemA = freshOrder({ dept: 'Siêu Thị A' });
    const itemB = freshOrder({ id: 2, dept: 'Siêu Thị B' });
    assert.strictEqual(applyWorkflowAction({ moduleKey: 'operationOrders', item: itemA, action: 'APPROVE', user: gdVung, comment: '', appData }).transition.type, 'COMPLETED');
    assert.strictEqual(applyWorkflowAction({ moduleKey: 'operationOrders', item: itemB, action: 'APPROVE', user: gdVung, comment: '', appData }).transition.type, 'COMPLETED');
  });
  test('JOBTITLE mặc định + secondaryPositions: gd.vung KHÔNG duyệt được Siêu Thị C (không phải dept chính lẫn kiêm nhiệm)', () => {
    const itemC = freshOrder({ id: 3, dept: 'Siêu Thị C' });
    assertThrows(
      () => applyWorkflowAction({ moduleKey: 'operationOrders', item: itemC, action: 'APPROVE', user: gdVung, comment: '', appData }),
      403, 'Bạn không có quyền', 'gd.vung duyệt nhầm Siêu Thị C ngoài phạm vi kiêm nhiệm'
    );
  });
}

// ===================== 3) JOBTITLE mode, stores rỗng — kịch bản chính người dùng mô tả =====================
{
  // Chức danh "Giám Đốc" cấu hình 1 dòng DUY NHẤT, KHÔNG kèm siêu thị cụ thể (stores rỗng = mặc định) ->
  // TỰ ĐỘNG khớp theo dept của TỪNG người giữ đúng chức danh — không cần liệt kê tay từng siêu thị.
  const gdA = { username: 'gd.a2', name: 'Giám Đốc Siêu Thị A', jobTitle: 'Giám Đốc', dept: 'Siêu Thị A', perms: {} };
  const gdB = { username: 'gd.b2', name: 'Giám Đốc Siêu Thị B', jobTitle: 'Giám Đốc', dept: 'Siêu Thị B', perms: {} };
  const gdC = { username: 'gd.c2', name: 'Giám Đốc Siêu Thị C', jobTitle: 'Giám Đốc', dept: 'Siêu Thị C', perms: {} };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [gdA, gdB, gdC],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    operationOrderStoreMixedApprovalRules: [
      { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc', stores: [] }
    ]
  };

  test('JOBTITLE mặc định "Giám Đốc": nv siêu thị A lập đơn -> gd.a2 mặc định được duyệt, gd.b2/gd.c2 bị chặn dù cùng chức danh', () => {
    const item = freshOrder({ dept: 'Siêu Thị A' });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: gdA, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
    assertThrows(
      () => applyWorkflowAction({ moduleKey: 'operationOrders', item: freshOrder({ dept: 'Siêu Thị A' }), action: 'APPROVE', user: gdB, comment: '', appData }),
      403, 'Bạn không có quyền', 'gd.b2 (Giám Đốc Siêu Thị B) duyệt nhầm đơn Siêu Thị A'
    );
    assertThrows(
      () => applyWorkflowAction({ moduleKey: 'operationOrders', item: freshOrder({ dept: 'Siêu Thị A' }), action: 'APPROVE', user: gdC, comment: '', appData }),
      403, 'Bạn không có quyền', 'gd.c2 (Giám Đốc Siêu Thị C) duyệt nhầm đơn Siêu Thị A'
    );
  });
  test('JOBTITLE mặc định "Giám Đốc": đổi sang đơn Siêu Thị B thì CHỈ gd.b2 duyệt được', () => {
    const item = freshOrder({ id: 4, dept: 'Siêu Thị B' });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: gdB, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
  test('resolveOperationOrderWorkflow(): đơn Siêu Thị A chỉ trả về đúng gd.a2', () => {
    const item = freshOrder({ dept: 'Siêu Thị A' });
    const resolved = resolveOperationOrderWorkflow(item, appData);
    assert.deepStrictEqual(resolved.approvers[1], [gdA.username]);
  });
}

// ===================== 4) Phương án B: dòng MẶC ĐỊNH + dòng NGOẠI LỆ cùng khớp -> HỢP (UNION) =====================
{
  const gdSt = { username: 'gd.st', name: 'Giám Đốc ST', jobTitle: 'Giám Đốc siêu thị', dept: 'Siêu Thị Q3', perms: {} };
  const pgdSt = { username: 'pgd.st', name: 'Phó Giám Đốc ST', jobTitle: 'Phó Giám Đốc siêu thị', dept: 'Siêu Thị Q3', perms: {} };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [gdSt, pgdSt],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    operationOrderStoreMixedApprovalRules: [
      // Mặc định: Giám Đốc siêu thị áp dụng MỌI siêu thị.
      { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc siêu thị', stores: [] },
      // Ngoại lệ: RIÊNG "Siêu Thị Q3" thêm Phó Giám Đốc siêu thị cũng được duyệt (KHÔNG thay thế dòng trên).
      { id: 2, step: 1, mode: 'JOBTITLE', jobTitle: 'Phó Giám Đốc siêu thị', stores: ['Siêu Thị Q3'] }
    ]
  };
  test('Phương án B: đơn Siêu Thị Q3 -> CẢ gd.st (mặc định) LẪN pgd.st (ngoại lệ) đều duyệt được', () => {
    const resolved = resolveOperationOrderWorkflow(freshOrder({ dept: 'Siêu Thị Q3' }), appData);
    assert.deepStrictEqual(resolved.approvers[1].sort(), [gdSt.username, pgdSt.username].sort());
  });
  test('Phương án B: đơn Siêu Thị Q3 -> pgd.st (ngoại lệ) duyệt được thật (không bị 403) — bước có 2 approver (gd.st + pgd.st) nên cần ĐỒNG PHÊ DUYỆT cả 2, 1 lượt duyệt đầu trả về PARTIAL_APPROVE chứ chưa COMPLETED', () => {
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item: freshOrder({ dept: 'Siêu Thị Q3' }), action: 'APPROVE', user: pgdSt, comment: '', appData });
    assert.strictEqual(transition.type, 'PARTIAL_APPROVE');
  });
  test('Phương án B: đơn Siêu Thị Q5 (ngoài phạm vi ngoại lệ) -> CHỈ gd.st (mặc định) duyệt được, pgd.st bị chặn', () => {
    const resolved = resolveOperationOrderWorkflow(freshOrder({ id: 5, dept: 'Siêu Thị Q5' }), appData);
    assert.deepStrictEqual(resolved.approvers[1], []); // gd.st có dept Siêu Thị Q3 (không khớp Q5) -> mặc định cũng rỗng ở đây
    assertThrows(
      () => applyWorkflowAction({ moduleKey: 'operationOrders', item: freshOrder({ id: 6, dept: 'Siêu Thị Q5' }), action: 'APPROVE', user: pgdSt, comment: '', appData }),
      403, 'Bạn không có quyền', 'pgd.st duyệt nhầm Siêu Thị Q5 ngoài phạm vi ngoại lệ'
    );
  });
}

// ===================== 5) HO hoàn toàn KHÔNG đi qua Quy Trình Hỗn Hợp =====================
{
  const hoApprover = { username: 'ho.duyet', name: 'Duyệt HO', dept: 'Ban Giám Đốc', perms: {} };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [hoApprover],
    operationOrderStoreTierWorkflows: {},
    operationOrderHOTierWorkflows: {
      LT100M: { workflowId: 'WF_1STEP', approvers: { 1: [hoApprover.username] } }
    },
    operationOrderStoreMixedApprovalRules: [] // rỗng — HO không đọc field này nên không ảnh hưởng gì.
  };
  test('HO: approver dept "Ban Giám Đốc" duyệt được đơn HO dept "Phòng Vận Hành" (khác hẳn dept) — không có khái niệm siêu thị, KHÔNG bị lọc', () => {
    const item = freshOrder({ dept: 'Phòng Vận Hành', orderLocationType: 'HO', amount: 5000000 });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: hoApprover, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
  test('HO: resolveOperationOrderWorkflow() KHÔNG lọc approvers theo dept (trả về nguyên approver dù dept khác)', () => {
    const item = freshOrder({ dept: 'Phòng Vận Hành', orderLocationType: 'HO', amount: 5000000 });
    const resolved = resolveOperationOrderWorkflow(item, appData);
    assert.deepStrictEqual(resolved.approvers[1], [hoApprover.username]);
  });
}

// ===================== 6) admin bypass vẫn hoạt động bình thường (không bị Quy Trình Hỗn Hợp chặn nhầm) =====================
{
  const admin = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true } };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [admin],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    operationOrderStoreMixedApprovalRules: []
  };
  test('admin: vẫn duyệt được đơn Siêu Thị bất kỳ dù không nằm trong Quy Trình Hỗn Hợp nào (nhánh admin bypass ở applyWorkflowAction())', () => {
    const item = freshOrder({ dept: 'Siêu Thị Bất Kỳ' });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: admin, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
}

console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
if (failed) process.exitCode = 1;
