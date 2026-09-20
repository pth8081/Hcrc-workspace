// server/tests/test-mixed-approval-inactive-user.js
//
// LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao): resolveOperationOrderStoreMixedApprovalRuleUsernames()
// (lib/workflowEngine.js — "🏬 Quy Trình Đặt Hàng Siêu Thị") KHÔNG lọc tài khoản đã khoá/nghỉ việc
// (user.active === false) ở CẢ 2 mode PERSON lẫn JOBTITLE — khác hẳn resolvePositionApprovers()
// (lib/positionApprovers.js) vốn đã lọc `u.active !== false` từ đầu. Hậu quả thật: người nghỉ việc vẫn
// nằm trong approvers[] của bước -> luật ĐỒNG PHÊ DUYỆT (isStepApprovalComplete(): TẤT CẢ approver phải
// bấm Duyệt) không bao giờ đủ -> bước TREO VĨNH VIỄN, đơn hàng đứng im (chỉ admin bypass được).
//
// Test THUẦN Node (không Playwright/SQL Server) — cùng khuôn tests/test-operation-order-store-approver-scope.js,
// đi qua CẢ resolveOperationOrderWorkflow() lẫn applyWorkflowAction() thật.
//
// Phủ thêm (XÁC NHẬN HÀNH VI CÓ CHỦ Ý, KHÔNG phải lỗi — chốt lại ở đợt audit này): dòng NGOẠI LỆ (có
// khai "Siêu Thị Phụ Trách") mode JOBTITLE KHÔNG so dept của người giữ chức danh — danh sách siêu thị
// của dòng đã là căn cứ duy nhất (xem chú thích tại chính hàm resolve...RuleUsernames()). Khoá lại bằng
// test để lần rà soát sau không "sửa nhầm" thành lỗi.
//
// Chạy: node server/tests/test-mixed-approval-inactive-user.js
'use strict';
const assert = require('assert');
const { applyWorkflowAction, WorkflowError, resolveOperationOrderWorkflow } = require('../lib/workflowEngine');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}
function assertThrows(fn, statusExpected, messageContains, label) {
  try { fn(); } catch (err) {
    assert(err instanceof WorkflowError || typeof err.status === 'number', `${label}: lỗi ném ra phải có .status`);
    if (statusExpected !== undefined) assert.strictEqual(err.status, statusExpected, `${label}: sai mã lỗi (nhận ${err.status})`);
    if (messageContains) assert(err.message.includes(messageContains), `${label}: message "${err.message}" phải chứa "${messageContains}"`);
    return;
  }
  throw new Error(`${label}: đáng lẽ phải ném lỗi nhưng không`);
}
function freshOrder(over) {
  return Object.assign({
    id: 1, code: 'DH-001', title: 'Đơn hàng test', orderLocationType: 'STORE',
    dept: 'Siêu Thị Q1', amount: 5000000, status: 'PENDING', currentStep: 1, history: [], creator: 'nv.tao'
  }, over);
}

// ===================== 1) JOBTITLE mode: người NGHỈ VIỆC bị loại khỏi danh sách duyệt =====================
{
  const gdDangLam = { username: 'gd.dangLam', name: 'GĐ Đang Làm', jobTitle: 'Giám Đốc siêu thị', dept: 'Siêu Thị Q1', active: true, perms: {} };
  const gdNghiViec = { username: 'gd.nghiViec', name: 'GĐ Đã Nghỉ', jobTitle: 'Giám Đốc siêu thị', dept: 'Siêu Thị Q1', active: false, perms: {} };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [gdDangLam, gdNghiViec],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    operationOrderStoreMixedApprovalRules: [
      { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc siêu thị', stores: [] }
    ]
  };

  test('JOBTITLE: tài khoản active:false KHÔNG còn nằm trong approvers[] của bước', () => {
    const resolved = resolveOperationOrderWorkflow(freshOrder({}), appData);
    assert.deepStrictEqual(resolved.approvers[1], [gdDangLam.username],
      'LỖI: người đã nghỉ việc vẫn được tính là người duyệt');
  });

  test('JOBTITLE: người còn làm việc duyệt 1 lượt là HOÀN TẤT bước (không bị kẹt chờ người đã nghỉ đồng duyệt)', () => {
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item: freshOrder({}), action: 'APPROVE', user: gdDangLam, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED',
      'LỖI: bước treo vì luật đồng phê duyệt vẫn chờ tài khoản đã khoá bấm Duyệt');
  });

  test('JOBTITLE: chính tài khoản đã khoá KHÔNG duyệt được nữa (403)', () => {
    assertThrows(
      () => applyWorkflowAction({ moduleKey: 'operationOrders', item: freshOrder({ id: 2 }), action: 'APPROVE', user: gdNghiViec, comment: '', appData }),
      403, 'Bạn không có quyền', 'Tài khoản active:false duyệt đơn'
    );
  });
}

// ===================== 2) PERSON mode: dòng trỏ đúng 1 người đã nghỉ việc =====================
{
  const nguoiNghi = { username: 'ql.nghi', name: 'Quản Lý Đã Nghỉ', jobTitle: 'Quản Lý Vùng', dept: 'Siêu Thị Q1', active: false, perms: {} };
  const nguoiConLam = { username: 'ql.con', name: 'Quản Lý Còn Làm', jobTitle: 'Quản Lý Vùng', dept: 'Siêu Thị Q1', active: true, perms: {} };
  const appData = {
    workflows: [{ id: 'WF_2STEP', steps: [{ order: 1, name: 'GĐ Siêu Thị' }, { order: 2, name: 'Quản Lý Vùng' }] }],
    users: [nguoiNghi, nguoiConLam],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_2STEP' } },
    operationOrderHOTierWorkflows: {},
    operationOrderStoreMixedApprovalRules: [
      { id: 1, step: 1, mode: 'PERSON', username: 'ql.nghi', stores: [] },
      { id: 2, step: 1, mode: 'PERSON', username: 'ql.con', stores: [] },
      { id: 3, step: 2, mode: 'PERSON', username: 'ql.nghi', stores: [] }
    ]
  };

  test('PERSON: dòng trỏ tài khoản đã khoá bị bỏ qua, chỉ còn người còn làm việc', () => {
    const resolved = resolveOperationOrderWorkflow(freshOrder({}), appData);
    assert.deepStrictEqual(resolved.approvers[1], ['ql.con'], 'LỖI: dòng PERSON trỏ người đã nghỉ vẫn được tính');
  });

  test('PERSON: bước chỉ có DUY NHẤT 1 dòng trỏ người đã nghỉ -> approvers rỗng (đơn "mồ côi" lộ ra rõ ràng, thay vì treo im lặng chờ người đã nghỉ)', () => {
    const resolved = resolveOperationOrderWorkflow(freshOrder({}), appData);
    assert.deepStrictEqual(resolved.approvers[2], []);
  });

  test('PERSON: người còn làm việc duyệt được bước 1 và chuyển đúng sang bước 2', () => {
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item: freshOrder({}), action: 'APPROVE', user: nguoiConLam, comment: '', appData });
    assert.strictEqual(transition.type, 'ADVANCED');
  });
}

// ===================== 3) Dòng NGOẠI LỆ JOBTITLE KHÔNG so dept — HÀNH VI CÓ CHỦ Ý (không phải lỗi) ====
{
  const qlVungKhacDept = { username: 'ql.vung', name: 'Quản Lý Vùng', jobTitle: 'Quản Lý Vùng', dept: 'Khối Vận Hành', active: true, perms: {} };
  const qlVungNghi = { username: 'ql.vung.nghi', name: 'Quản Lý Vùng (nghỉ)', jobTitle: 'Quản Lý Vùng', dept: 'Khối Vận Hành', active: false, perms: {} };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [qlVungKhacDept, qlVungNghi],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    operationOrderStoreMixedApprovalRules: [
      { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Quản Lý Vùng', stores: ['Siêu Thị Q1', 'Siêu Thị Q3'] }
    ]
  };

  test('NGOẠI LỆ (có khai siêu thị): người giữ chức danh ở dept KHÁC vẫn duyệt được đúng siêu thị đã khai — CÓ CHỦ Ý, giữ nguyên', () => {
    const resolved = resolveOperationOrderWorkflow(freshOrder({ dept: 'Siêu Thị Q1' }), appData);
    assert.deepStrictEqual(resolved.approvers[1], [qlVungKhacDept.username]);
  });

  test('NGOẠI LỆ: siêu thị KHÔNG nằm trong danh sách khai -> không ai duyệt (phạm vi vẫn bị giới hạn đúng)', () => {
    const resolved = resolveOperationOrderWorkflow(freshOrder({ id: 3, dept: 'Siêu Thị Q7' }), appData);
    assert.deepStrictEqual(resolved.approvers[1], []);
  });

  test('NGOẠI LỆ: tài khoản đã khoá trong cùng chức danh vẫn bị loại (bản vá áp dụng cho CẢ dòng ngoại lệ)', () => {
    const resolved = resolveOperationOrderWorkflow(freshOrder({ dept: 'Siêu Thị Q3' }), appData);
    assert.ok(!resolved.approvers[1].includes(qlVungNghi.username));
  });
}

console.log('');
console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
if (failed > 0) process.exitCode = 1;
