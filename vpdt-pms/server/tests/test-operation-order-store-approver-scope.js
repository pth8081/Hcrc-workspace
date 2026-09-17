// server/tests/test-operation-order-store-approver-scope.js
//
// Test THUẦN Node (không Playwright/SQL Server) cho đợt "Duyệt Đơn Hàng Siêu Thị tự khớp đúng siêu thị"
// (10/2026, theo yêu cầu người dùng nguyên văn: "siêu thị nào tự duyệt siêu thị đó nhận biêt bằng phân
// quyền phòng , siêu thị" — VD gán chức danh "Giám Đốc" KHÔNG gắn siêu thị cụ thể cho 1 người đang có
// dept = "Siêu Thị A" thì mặc định chỉ được duyệt đơn của Siêu Thị A, không phải mọi siêu thị).
//
// Xem lib/workflowEngine.js::filterOperationOrderStoreApprovers()/resolveOperationOrderWorkflow() cho
// cơ chế đầy đủ + lý do thiết kế (KHÔNG đọc/phụ thuộc Cơ Cấu Tổ Chức — thuần phân quyền phẳng
// jobTitle/dept trên hồ sơ Người Dùng, dùng CHUNG applyWorkflowAction() nên test qua đây phủ luôn nhánh
// approve/reject thật, không chỉ hàm resolve).
//
// Phủ:
//   1. PEOPLE mode (chọn tay username): approver có dept KHỚP đơn -> duyệt được; dept KHÔNG khớp và
//      không có secondaryPositions khớp -> bị chặn 403, dù được liệt kê approver hợp lệ ở tier đó.
//   2. secondaryPositions ("Vị Trí Kiêm Nhiệm"): approver có dept CHÍNH khác đơn nhưng có 1 secondaryPositions
//      khớp đúng dept của đơn -> vẫn duyệt được (mở rộng phạm vi, không thay đổi danh tính chính thức).
//   3. POSITION mode dept-less pair (VD {jobTitle:'Giám Đốc'} không gắn dept — áp dụng CHUNG mọi siêu thị
//      ở bước resolvePositionApprovers()): sau khi resolve ra MỌI giám đốc siêu thị, lọc lại CHỈ còn giữ
//      đúng giám đốc của ĐÚNG siêu thị đang xét — đây là kịch bản chính người dùng mô tả.
//   4. HO hoàn toàn KHÔNG bị lọc: approver tier HO (dept bất kỳ, kể cả khác hẳn dept của đơn — HO vốn
//      không có khái niệm siêu thị) vẫn duyệt được bình thường, không đổi hành vi cũ.
//   5. admin vẫn duyệt được mọi đơn STORE bất kể dept (nhánh admin bypass ở applyWorkflowAction()/
//      canApproveStep(), không đi qua filter này — regression tránh vô tình khoá luôn cả admin).
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

// ===================== 1) PEOPLE mode: dept phải khớp mới duyệt được =====================
{
  const gdA = { username: 'gd.a', name: 'Giám Đốc A', dept: 'Siêu Thị A', perms: {} };
  const gdB = { username: 'gd.b', name: 'Giám Đốc B', dept: 'Siêu Thị B', perms: {} };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [gdA, gdB],
    operationOrderStoreTierWorkflows: {
      LT10M: { workflowId: 'WF_1STEP', approvers: { 1: [gdA.username, gdB.username] } }
    },
    operationOrderHOTierWorkflows: {}
  };

  test('PEOPLE mode: đơn Siêu Thị A, gd.a (dept khớp) duyệt được dù gd.b cũng được liệt kê chung tier', () => {
    const item = freshOrder({ dept: 'Siêu Thị A' });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: gdA, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
  test('PEOPLE mode: đơn Siêu Thị A, gd.b (dept KHÔNG khớp, dù được liệt kê approver tier LT10M) PHẢI bị chặn 403', () => {
    const item = freshOrder({ dept: 'Siêu Thị A' });
    assertThrows(
      () => applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: gdB, comment: '', appData }),
      403, 'Bạn không có quyền', 'gd.b duyệt nhầm đơn Siêu Thị A'
    );
  });
  test('PEOPLE mode: resolveOperationOrderWorkflow() cho đơn Siêu Thị A chỉ trả về đúng gd.a, không có gd.b', () => {
    const item = freshOrder({ dept: 'Siêu Thị A' });
    const resolved = resolveOperationOrderWorkflow(item, appData);
    assert.deepStrictEqual(resolved.approvers['1'], [gdA.username]);
  });
  test('PEOPLE mode: đảo lại — đơn Siêu Thị B thì gd.b duyệt được, gd.a bị chặn', () => {
    const item = freshOrder({ dept: 'Siêu Thị B' });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: gdB, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
    assertThrows(
      () => applyWorkflowAction({ moduleKey: 'operationOrders', item: freshOrder({ dept: 'Siêu Thị B' }), action: 'APPROVE', user: gdA, comment: '', appData }),
      403, 'Bạn không có quyền', 'gd.a duyệt nhầm đơn Siêu Thị B'
    );
  });
}

// ===================== 2) secondaryPositions mở rộng phạm vi duyệt sang siêu thị khác =====================
{
  const gdVung = {
    username: 'gd.vung', name: 'Giám Đốc Vùng', dept: 'Siêu Thị A', perms: {},
    secondaryPositions: [{ jobTitle: 'Giám Đốc', dept: 'Siêu Thị B' }]
  };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [gdVung],
    operationOrderStoreTierWorkflows: {
      LT10M: { workflowId: 'WF_1STEP', approvers: { 1: [gdVung.username] } }
    },
    operationOrderHOTierWorkflows: {}
  };
  test('secondaryPositions: gd.vung (dept chính = Siêu Thị A, kiêm nhiệm Siêu Thị B) duyệt được CẢ 2 siêu thị', () => {
    const itemA = freshOrder({ dept: 'Siêu Thị A' });
    const itemB = freshOrder({ id: 2, dept: 'Siêu Thị B' });
    assert.strictEqual(applyWorkflowAction({ moduleKey: 'operationOrders', item: itemA, action: 'APPROVE', user: gdVung, comment: '', appData }).transition.type, 'COMPLETED');
    assert.strictEqual(applyWorkflowAction({ moduleKey: 'operationOrders', item: itemB, action: 'APPROVE', user: gdVung, comment: '', appData }).transition.type, 'COMPLETED');
  });
  test('secondaryPositions: gd.vung KHÔNG duyệt được Siêu Thị C (không phải dept chính lẫn kiêm nhiệm)', () => {
    const itemC = freshOrder({ id: 3, dept: 'Siêu Thị C' });
    assertThrows(
      () => applyWorkflowAction({ moduleKey: 'operationOrders', item: itemC, action: 'APPROVE', user: gdVung, comment: '', appData }),
      403, 'Bạn không có quyền', 'gd.vung duyệt nhầm Siêu Thị C ngoài phạm vi kiêm nhiệm'
    );
  });
}

// ===================== 3) POSITION mode dept-less pair — kịch bản chính người dùng mô tả =====================
{
  // Chức danh "Giám Đốc" gán KHÔNG kèm siêu thị cụ thể (pair.dept rỗng) -> resolvePositionApprovers()
  // trả về MỌI user có jobTitle "Giám Đốc" (bất kể dept) làm approver "hợp lệ chung" của tier — bước lọc
  // filterOperationOrderStoreApprovers() PHẢI thu hẹp lại đúng theo dept của TỪNG đơn cụ thể.
  const gdA = { username: 'gd.a2', name: 'Giám Đốc Siêu Thị A', jobTitle: 'Giám Đốc', dept: 'Siêu Thị A', perms: { canBeApprover: true } };
  const gdB = { username: 'gd.b2', name: 'Giám Đốc Siêu Thị B', jobTitle: 'Giám Đốc', dept: 'Siêu Thị B', perms: { canBeApprover: true } };
  const gdC = { username: 'gd.c2', name: 'Giám Đốc Siêu Thị C', jobTitle: 'Giám Đốc', dept: 'Siêu Thị C', perms: { canBeApprover: true } };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [gdA, gdB, gdC],
    operationOrderStoreTierWorkflows: {
      LT10M: {
        workflowId: 'WF_1STEP',
        approverMode: { 1: 'POSITION' },
        approversByPosition: { 1: [{ jobTitle: 'Giám Đốc' }] } // KHÔNG gắn dept -> áp dụng mọi siêu thị
      }
    },
    operationOrderHOTierWorkflows: {}
  };

  test('POSITION mode dept-less "Giám Đốc": resolvePositionApprovers() thô trả về CẢ 3 giám đốc (chưa lọc theo siêu thị)', () => {
    const { resolveStepApproverUsernames } = require('../lib/positionApprovers');
    const raw = resolveStepApproverUsernames(appData.operationOrderStoreTierWorkflows.LT10M, 1, appData.users);
    assert.deepStrictEqual(raw.sort(), [gdA.username, gdB.username, gdC.username].sort());
  });
  test('POSITION mode dept-less "Giám Đốc": SAU lọc siêu thị, đơn Siêu Thị A chỉ còn đúng gd.a2', () => {
    const item = freshOrder({ dept: 'Siêu Thị A' });
    const resolved = resolveOperationOrderWorkflow(item, appData);
    assert.deepStrictEqual(resolved.approvers['1'], [gdA.username]);
  });
  test('POSITION mode dept-less "Giám Đốc": nv siêu thị A lập đơn -> gd.a2 mặc định được duyệt (đúng kịch bản người dùng mô tả), gd.b2/gd.c2 bị chặn dù cùng chức danh', () => {
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
  test('POSITION mode dept-less "Giám Đốc": đổi sang đơn Siêu Thị B thì CHỈ gd.b2 duyệt được', () => {
    const item = freshOrder({ id: 4, dept: 'Siêu Thị B' });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: gdB, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
}

// ===================== 4) HO hoàn toàn KHÔNG bị lọc theo dept =====================
{
  const hoApprover = { username: 'ho.duyet', name: 'Duyệt HO', dept: 'Ban Giám Đốc', perms: {} };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [hoApprover],
    operationOrderStoreTierWorkflows: {},
    operationOrderHOTierWorkflows: {
      LT100M: { workflowId: 'WF_1STEP', approvers: { 1: [hoApprover.username] } }
    }
  };
  test('HO: approver dept "Ban Giám Đốc" duyệt được đơn HO dept "Phòng Vận Hành" (khác hẳn dept) — không có khái niệm siêu thị, KHÔNG bị lọc', () => {
    const item = freshOrder({ dept: 'Phòng Vận Hành', orderLocationType: 'HO', amount: 5000000 });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: hoApprover, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
  test('HO: resolveOperationOrderWorkflow() KHÔNG lọc approvers theo dept (trả về nguyên approver dù dept khác)', () => {
    const item = freshOrder({ dept: 'Phòng Vận Hành', orderLocationType: 'HO', amount: 5000000 });
    const resolved = resolveOperationOrderWorkflow(item, appData);
    assert.deepStrictEqual(resolved.approvers['1'], [hoApprover.username]);
  });
}

// ===================== 5) admin bypass vẫn hoạt động bình thường (không bị filter này chặn nhầm) =====================
{
  const admin = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true } };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [admin],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP', approvers: { 1: [] } } },
    operationOrderHOTierWorkflows: {}
  };
  test('admin: vẫn duyệt được đơn Siêu Thị bất kỳ dù không nằm trong danh sách approvers[] nào (nhánh admin bypass ở applyWorkflowAction())', () => {
    const item = freshOrder({ dept: 'Siêu Thị Bất Kỳ' });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: admin, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
}

console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
if (failed) process.exitCode = 1;
