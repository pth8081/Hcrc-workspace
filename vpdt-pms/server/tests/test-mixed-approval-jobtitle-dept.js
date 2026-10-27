// server/tests/test-mixed-approval-jobtitle-dept.js
//
// Test THUẦN Node (không Playwright/SQL Server) cho field MỚI `jobTitleDept` (10/2026) của dòng mode
// 'JOBTITLE' trong operationOrderStoreMixedApprovalRules/itPriceWholesaleStoreMixedApprovalRules — theo
// yêu cầu người dùng nguyên văn: "tôi lấy vị trí chức danh trong quy trình đặc biệt được không? Tôi
// muốn ghép đúng người thay vì vị trí đang lấy là HO (ví dụ trưởng phòng HO thì có nhiều Tp lắm)".
//
// PHÁT HIỆN GỐC (lý do cần field này): chức danh HO ở mode 'JOBTITLE' KHÔNG có cách nào tách theo phòng
// ban trước đợt này —
//   - stores RỖNG ("mặc định"): tự so storeDept của đơn (TÊN SIÊU THỊ) với dept người giữ chức danh
//     (TÊN PHÒNG BAN HO) -> KHÔNG BAO GIỜ khớp -> 0 approver.
//   - stores CÓ giá trị ("ngoại lệ"): bỏ qua hẳn so dept -> khớp MỌI người giữ đúng chức danh đó trên
//     TOÀN CÔNG TY (VD mọi "Trưởng Phòng" bất kể phòng ban nào).
// `jobTitleDept` sửa cả 2: khi có giá trị, so CHÍNH XÁC user.dept === jobTitleDept (hoặc secondaryPositions
// cùng cặp jobTitle+dept), HOÀN TOÀN ĐỘC LẬP với storeDept/`stores`.
//
// LỖI ĐÃ VÁ TIẾP (11/2026, báo cáo người dùng — xem mục 4a bên dưới): nhánh "stores RỖNG" ở trên vẫn còn
// lỗi với chức danh KHÔNG ghép `jobTitleDept` VÀ không thuộc danh mục storeJobTitles — tham số
// `storeJobTitleLabels` mới phân biệt rõ chức danh cấp công ty (khớp mọi người) với chức danh Siêu Thị
// (vẫn so dept = tên siêu thị như cũ).
//
// Xem lib/workflowEngine.js::resolveOperationOrderStoreMixedApprovalRuleUsernames() (matchesDeptCondition())
// cho cơ chế đầy đủ. Cùng hạ tầng/kiểu test với tests/test-operation-order-store-approver-scope.js.
//
// Chạy: node server/tests/test-mixed-approval-jobtitle-dept.js
'use strict';
const assert = require('assert');
const { applyWorkflowAction, WorkflowError, resolveOperationOrderWorkflow } = require('../lib/workflowEngine');

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

// ===================== 1) jobTitleDept + stores RỖNG: khớp ĐÚNG phòng ban HO, độc lập storeDept =====================
{
  const tpCntt = { username: 'tp.cntt', name: 'Trưởng Phòng CNTT', jobTitle: 'Trưởng phòng', dept: 'Phòng CNTT', perms: {} };
  const tpKd = { username: 'tp.kd', name: 'Trưởng Phòng KD', jobTitle: 'Trưởng phòng', dept: 'Phòng Kinh Doanh', perms: {} };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [tpCntt, tpKd],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    operationOrderStoreMixedApprovalRules: [
      { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Trưởng phòng', jobTitleDept: 'Phòng CNTT', stores: [] }
    ]
  };
  test('jobTitleDept mặc định (stores rỗng): tp.cntt (đúng phòng ban) duyệt được đơn Siêu Thị A, BẤT KỂ storeDept không liên quan gì tới "Phòng CNTT"', () => {
    const item = freshOrder({ dept: 'Siêu Thị A' });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: tpCntt, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
  test('jobTitleDept mặc định: tp.kd (CÙNG chức danh, KHÁC phòng ban) BỊ CHẶN dù cùng là "Trưởng phòng"', () => {
    assertThrows(
      () => applyWorkflowAction({ moduleKey: 'operationOrders', item: freshOrder({ id: 2 }), action: 'APPROVE', user: tpKd, comment: '', appData }),
      403, 'Bạn không có quyền', 'tp.kd duyệt nhầm dù khác phòng ban'
    );
  });
  test('jobTitleDept mặc định: đổi đơn sang Siêu Thị B (storeDept khác) — tp.cntt VẪN duyệt được (độc lập hoàn toàn storeDept)', () => {
    const item = freshOrder({ id: 3, dept: 'Siêu Thị B' });
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item, action: 'APPROVE', user: tpCntt, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
  test('resolveOperationOrderWorkflow(): chỉ trả về đúng tp.cntt, không có tp.kd', () => {
    const resolved = resolveOperationOrderWorkflow(freshOrder({ dept: 'Siêu Thị A' }), appData);
    assert.deepStrictEqual(resolved.approvers[1], [tpCntt.username]);
  });
}

// ===================== 2) jobTitleDept + stores CÓ giá trị ("ngoại lệ"): vẫn khớp ĐÚNG phòng ban =====================
{
  const tpCntt = { username: 'tp.cntt2', name: 'Trưởng Phòng CNTT', jobTitle: 'Trưởng phòng', dept: 'Phòng CNTT', perms: {} };
  const tpKd = { username: 'tp.kd2', name: 'Trưởng Phòng KD', jobTitle: 'Trưởng phòng', dept: 'Phòng Kinh Doanh', perms: {} };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [tpCntt, tpKd],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    // "Ngoại lệ" (stores có giá trị) + jobTitleDept: trước đây stores có giá trị sẽ BỎ QUA so dept, khớp
    // MỌI "Trưởng phòng" — jobTitleDept phải VẪN khớp đúng phòng ban dù đang ở nhánh "ngoại lệ".
    operationOrderStoreMixedApprovalRules: [
      { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Trưởng phòng', jobTitleDept: 'Phòng CNTT', stores: ['Siêu Thị Q3'] }
    ]
  };
  test('jobTitleDept + stores ngoại lệ: tp.cntt (đúng phòng ban) vẫn duyệt được đơn Siêu Thị Q3', () => {
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item: freshOrder({ dept: 'Siêu Thị Q3' }), action: 'APPROVE', user: tpCntt, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
  test('jobTitleDept + stores ngoại lệ: tp.kd (KHÁC phòng ban, dù cùng chức danh) VẪN BỊ CHẶN — jobTitleDept override cách khớp "mọi người" cũ của nhánh ngoại lệ', () => {
    assertThrows(
      () => applyWorkflowAction({ moduleKey: 'operationOrders', item: freshOrder({ id: 2, dept: 'Siêu Thị Q3' }), action: 'APPROVE', user: tpKd, comment: '', appData }),
      403, 'Bạn không có quyền', 'tp.kd duyệt nhầm dù "ngoại lệ" + khác phòng ban'
    );
  });
}

// ===================== 3) secondaryPositions ("Vị Trí Kiêm Nhiệm") cùng cặp jobTitle+jobTitleDept =====================
{
  // Lọc đầu tiên của resolveOperationOrderStoreMixedApprovalRuleUsernames() yêu cầu u.jobTitle === rule.jobTitle
  // TRƯỚC KHI xét matchesDeptCondition() — "Vị Trí Kiêm Nhiệm" chỉ mở rộng PHÒNG BAN được công nhận, không
  // thay cho chức danh chính (giống hệt thiết kế secondaryPositions gốc ở test-operation-order-store-approver-scope.js).
  const kiemNhiem = {
    username: 'tp.kiemnhiem', name: 'TP Kiêm Nhiệm', jobTitle: 'Trưởng phòng', dept: 'Phòng Khác', perms: {},
    secondaryPositions: [{ jobTitle: 'Trưởng phòng', dept: 'Phòng CNTT' }]
  };
  const appData = {
    workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
    users: [kiemNhiem],
    operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
    operationOrderHOTierWorkflows: {},
    operationOrderStoreMixedApprovalRules: [
      { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Trưởng phòng', jobTitleDept: 'Phòng CNTT', stores: [] }
    ]
  };
  test('jobTitleDept: khớp qua secondaryPositions cùng cặp (jobTitle, dept) dù dept CHÍNH khác', () => {
    const { transition } = applyWorkflowAction({ moduleKey: 'operationOrders', item: freshOrder({ dept: 'Siêu Thị A' }), action: 'APPROVE', user: kiemNhiem, comment: '', appData });
    assert.strictEqual(transition.type, 'COMPLETED');
  });
}

// ===================== 4) Tương thích ngược: dòng KHÔNG có jobTitleDept giữ nguyên 100% hành vi cũ =====================
{
  // 4a) LỖI ĐÃ VÁ (11/2026, báo cáo người dùng kèm ảnh chụp "Xem Trước Quy Trình..." nhiều bước "chưa có
  //     người duyệt" ở Đặt Hàng Siêu Thị): dòng mặc định (stores rỗng) KHÔNG jobTitleDept + chức danh HO
  //     KHÔNG thuộc danh mục storeJobTitles (chức danh cấp công ty, VD "Trưởng phòng" HO ở đây) trước đây
  //     LUÔN trả 0 approver (coi là "lỗi gốc giữ nguyên có chủ đích", admin phải tự gán jobTitleDept) — nay
  //     ĐÃ SỬA: khớp MỌI người giữ đúng chức danh đó, không đòi hỏi gì về dept/siêu thị (xem
  //     resolveOperationOrderStoreMixedApprovalRuleUsernames(), tham số storeJobTitleLabels). Chức danh
  //     THUỘC danh mục storeJobTitles (VD "Giám Đốc Siêu Thị") vẫn giữ nguyên 0 approver ở đúng kịch bản
  //     này (dept không khớp storeDept nào) — xác nhận KHÔNG đụng gì cơ chế GĐST.
  {
    const tpCntt = { username: 'tp.cntt3', name: 'Trưởng Phòng CNTT', jobTitle: 'Trưởng phòng', dept: 'Phòng CNTT', perms: {} };
    const appData = {
      workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
      users: [tpCntt],
      operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
      operationOrderHOTierWorkflows: {},
      operationOrderStoreMixedApprovalRules: [
        { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Trưởng phòng', stores: [] } // KHÔNG có jobTitleDept
      ],
      storeJobTitles: [] // "Trưởng phòng" KHÔNG thuộc danh mục Siêu Thị -> chức danh cấp công ty
    };
    test('LỖI ĐÃ VÁ: dòng mặc định KHÔNG jobTitleDept + chức danh HO (không thuộc storeJobTitles) -> khớp đúng người giữ chức danh, không còn 0 approver', () => {
      const resolved = resolveOperationOrderWorkflow(freshOrder({ dept: 'Siêu Thị A' }), appData);
      assert.deepStrictEqual(resolved.approvers[1], [tpCntt.username]);
    });
  }
  // 4a-2) REGRESSION: chức danh THUỘC danh mục storeJobTitles vẫn giữ nguyên 0 approver khi dept không
  //       khớp storeDept nào (hành vi GĐST cũ KHÔNG bị ảnh hưởng bởi bản vá chức danh cấp công ty).
  {
    const gdSt = { username: 'gd.st4a2', name: 'Giám Đốc Siêu Thị X', jobTitle: 'Giám Đốc Siêu Thị', dept: 'Siêu Thị X', perms: {} };
    const appData = {
      workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
      users: [gdSt],
      operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
      operationOrderHOTierWorkflows: {},
      operationOrderStoreMixedApprovalRules: [
        { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Giám Đốc Siêu Thị', stores: [] }
      ],
      storeJobTitles: [{ label: 'Giám Đốc Siêu Thị' }]
    };
    test('REGRESSION: chức danh THUỘC storeJobTitles ("Giám Đốc Siêu Thị") vẫn 0 approver khi dept không khớp storeDept đơn (hành vi GĐST giữ nguyên)', () => {
      const resolved = resolveOperationOrderWorkflow(freshOrder({ dept: 'Siêu Thị A' }), appData);
      assert.deepStrictEqual(resolved.approvers[1], []);
    });
  }
  // 4b) stores có giá trị ("ngoại lệ") KHÔNG jobTitleDept: khớp MỌI người giữ chức danh đó (hành vi cũ).
  {
    const tpCntt = { username: 'tp.cntt4', name: 'Trưởng Phòng CNTT', jobTitle: 'Trưởng phòng', dept: 'Phòng CNTT', perms: {} };
    const tpKd = { username: 'tp.kd4', name: 'Trưởng Phòng KD', jobTitle: 'Trưởng phòng', dept: 'Phòng Kinh Doanh', perms: {} };
    const appData = {
      workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }],
      users: [tpCntt, tpKd],
      operationOrderStoreTierWorkflows: { LT10M: { workflowId: 'WF_1STEP' } },
      operationOrderHOTierWorkflows: {},
      operationOrderStoreMixedApprovalRules: [
        { id: 1, step: 1, mode: 'JOBTITLE', jobTitle: 'Trưởng phòng', stores: ['Siêu Thị Q3'] } // KHÔNG có jobTitleDept
      ]
    };
    test('Tương thích ngược: dòng ngoại lệ KHÔNG jobTitleDept -> khớp MỌI người giữ chức danh (hành vi cũ giữ nguyên)', () => {
      const resolved = resolveOperationOrderWorkflow(freshOrder({ dept: 'Siêu Thị Q3' }), appData);
      assert.deepStrictEqual(resolved.approvers[1].sort(), [tpCntt.username, tpKd.username].sort());
    });
  }
}

console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
if (failed) process.exitCode = 1;
