// server/tests/test-audit-createvsapprove-gaps.js
//
// Rà soát chuyên sâu 9/2026 (24 module, "tạo hồ sơ" vs "duyệt hồ sơ" phải tách quyền/có chặn tự
// duyệt) phát hiện 4 gap thật, người dùng xác nhận vá đúng #1, #3, #4 (chặn tự duyệt) + #5 (đổi Ngân
// Sách "Đề Xuất" sang cấu hình theo phòng ban) — các mục #2/#6/#7 KHÔNG đụng tới (thiết kế đã đúng ý,
// không phải lỗi).
//
// Toàn bộ hàm test ở đây THUẦN (không đụng DB/network) — gọi thẳng lib/recordActions.js, cùng khuôn
// test-createtask-active-assignee.js.
//
// Chạy: node server/tests/test-audit-createvsapprove-gaps.js
'use strict';
const assert = require('assert');
const recordActions = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

// ===================== #1: Đồng Phục (uniformPeriods) — tự tạo kỳ rồi tự duyệt =====================
{
  const ADMIN = { username: 'admin1', perms: { admin: true } };
  const CREATOR_APPROVER = { username: 'hc1', perms: { uniformManage: true } };
  const OTHER_APPROVER = { username: 'hc2', perms: { uniformApprove: true } };

  test('#1 Đồng Phục: người tạo kỳ (uniformManage) tự duyệt kỳ do chính mình tạo -> 403', () => {
    const period = { creator: 'hc1', approvalStatus: 'PENDING_APPROVAL' };
    assert.throws(() => recordActions.approveUniformPeriod(CREATOR_APPROVER, period), /403|tự duyệt/);
  });

  test('#1 Đồng Phục: người tạo kỳ tự TỪ CHỐI kỳ do chính mình tạo -> 403', () => {
    const period = { creator: 'hc1', approvalStatus: 'PENDING_APPROVAL' };
    assert.throws(() => recordActions.rejectUniformPeriod(CREATOR_APPROVER, period, { reason: 'test' }), /403|tự duyệt/);
  });

  test('#1 Đồng Phục: người KHÁC (có quyền duyệt) duyệt được kỳ do người khác tạo -> thành công', () => {
    const period = { creator: 'hc1', approvalStatus: 'PENDING_APPROVAL' };
    const result = recordActions.approveUniformPeriod(OTHER_APPROVER, period);
    assert.strictEqual(result.approvalStatus, 'APPROVED');
  });

  test('#1 Đồng Phục: admin vẫn tự duyệt được kỳ do chính mình tạo (đặc quyền nhất quán)', () => {
    const period = { creator: 'admin1', approvalStatus: 'PENDING_APPROVAL' };
    const result = recordActions.approveUniformPeriod(ADMIN, period);
    assert.strictEqual(result.approvalStatus, 'APPROVED');
  });
}

// ===================== #3: Tuyển Dụng (recruitmentReferrals) — tự giới thiệu rồi tự xử lý =====================
{
  const ADMIN = { username: 'admin1', perms: { admin: true } };
  const REFERRER = { username: 'nv1', perms: { internalRecruitmentCreate: true } };
  const OTHER = { username: 'nv2', perms: { internalRecruitmentCreate: true } };

  test('#3 Tuyển Dụng: người giới thiệu tự cập nhật trạng thái ứng viên do chính mình giới thiệu -> 403', () => {
    const referral = { referrerUsername: 'nv1', status: 'NEW' };
    assert.throws(
      () => recordActions.setRecruitmentReferralStatus({ status: 'CONTACTED' }, REFERRER, referral),
      /403|tự cập nhật/
    );
  });

  test('#3 Tuyển Dụng: người KHÁC (có quyền quản lý) cập nhật được trạng thái ứng viên -> thành công', () => {
    const referral = { referrerUsername: 'nv1', status: 'NEW' };
    const result = recordActions.setRecruitmentReferralStatus({ status: 'CONTACTED' }, OTHER, referral);
    assert.strictEqual(result.status, 'CONTACTED');
  });

  test('#3 Tuyển Dụng: admin vẫn tự cập nhật được trạng thái ứng viên do chính mình giới thiệu', () => {
    const referral = { referrerUsername: 'admin1', status: 'NEW' };
    const result = recordActions.setRecruitmentReferralStatus({ status: 'HIRED' }, ADMIN, referral);
    assert.strictEqual(result.status, 'HIRED');
  });
}

// ===================== #4: Công Việc (tasks) — tự giao việc cho bản thân rồi tự duyệt gia hạn/huỷ =====================
{
  const ADMIN = { username: 'admin1', perms: { admin: true } };
  const SELF_ASSIGNER = { username: 'qly1', perms: { taskEdit: true } };
  const OTHER = { username: 'qly2', perms: { taskEdit: true } };

  test('#4 Công Việc: tự giao việc cho bản thân rồi tự duyệt gia hạn do chính mình xin -> 403', () => {
    const task = {
      assignedBy: 'qly1', assignedTo: 'qly1', status: 'IN_PROGRESS',
      pendingExtension: { newDeadline: '2026-12-31', reason: 'bận', requestedBy: 'qly1', requestedByName: 'Quản Lý 1' }
    };
    assert.throws(
      () => recordActions.resolvePendingTaskAction('extension', 'approve', SELF_ASSIGNER, task),
      /403|tự duyệt/
    );
  });

  test('#4 Công Việc: tự giao việc cho bản thân rồi tự TỪ CHỐI yêu cầu huỷ do chính mình gửi -> 403', () => {
    const task = {
      assignedBy: 'qly1', assignedTo: 'qly1', status: 'IN_PROGRESS',
      pendingCancellation: { reason: 'không cần nữa', requestedBy: 'qly1', requestedByName: 'Quản Lý 1' }
    };
    assert.throws(
      () => recordActions.resolvePendingTaskAction('cancellation', 'reject', SELF_ASSIGNER, task),
      /403|tự duyệt/
    );
  });

  test('#4 Công Việc: người giao việc KHÁC với người nhận việc vẫn duyệt gia hạn bình thường (không đổi hành vi cũ)', () => {
    const task = {
      assignedBy: 'qly2', assignedTo: 'nv1', status: 'IN_PROGRESS',
      pendingExtension: { newDeadline: '2026-12-31', reason: 'bận', requestedBy: 'nv1', requestedByName: 'Nhân Viên 1' }
    };
    const result = recordActions.resolvePendingTaskAction('extension', 'approve', OTHER, task);
    assert.strictEqual(result.deadline, '2026-12-31');
    assert.strictEqual(result.pendingExtension, null);
  });

  test('#4 Công Việc: admin vẫn tự duyệt được yêu cầu gia hạn dù tự giao việc cho bản thân (đặc quyền nhất quán)', () => {
    const task = {
      assignedBy: 'admin1', assignedTo: 'admin1', status: 'IN_PROGRESS',
      pendingExtension: { newDeadline: '2026-12-31', reason: 'bận', requestedBy: 'admin1', requestedByName: 'Admin' }
    };
    const result = recordActions.resolvePendingTaskAction('extension', 'approve', ADMIN, task);
    assert.strictEqual(result.deadline, '2026-12-31');
  });
}

// ===================== #5: Ngân Sách (budgetLines) — Đề Xuất theo cấu hình phòng ban =====================
{
  const ADMIN = { username: 'admin1', perms: { admin: true } };
  const BUDGET_MANAGE = { username: 'qlns1', perms: { budgetManage: true } };
  const CONFIGURED_APPROVER = { username: 'tp_kd', perms: { budgetCreate: true } };
  const UNCONFIGURED_CREATOR = { username: 'nv_kd', perms: { budgetCreate: true } };

  const appData = {
    workflows: [{ id: 'wf1', steps: [{ order: 1, name: 'Duyệt' }] }],
    budgetDeptWorkflows: {
      'Khối Kinh Doanh': { workflowId: 'wf1', approvers: { 1: ['tp_kd'] } }
      // 'Khối Vận Hành' CỐ Ý không có trong đây — mô phỏng phòng ban CHƯA được admin cấu hình gì.
    }
  };

  test('#5 Ngân Sách: budgetCreate KHÔNG phải approver bước 1 của phòng ban -> canDecideBudgetLineProposal = false', () => {
    const item = { dept: 'Khối Kinh Doanh', createdBy: 'nv_kd' };
    assert.strictEqual(recordActions.canDecideBudgetLineProposal(UNCONFIGURED_CREATOR, item, appData), false);
  });

  test('#5 Ngân Sách: budgetCreate LÀ approver bước 1 đúng phòng ban đã cấu hình -> canDecideBudgetLineProposal = true', () => {
    const item = { dept: 'Khối Kinh Doanh', createdBy: 'nv_kd' };
    assert.strictEqual(recordActions.canDecideBudgetLineProposal(CONFIGURED_APPROVER, item, appData), true);
  });

  test('#5 Ngân Sách: phòng ban CHƯA cấu hình -> chỉ budgetManage/admin quyết định được, budgetCreate thường thì không', () => {
    const item = { dept: 'Khối Vận Hành', createdBy: 'nv_kd' };
    assert.strictEqual(recordActions.canDecideBudgetLineProposal(CONFIGURED_APPROVER, item, appData), false);
    assert.strictEqual(recordActions.canDecideBudgetLineProposal(BUDGET_MANAGE, item, appData), true);
    assert.strictEqual(recordActions.canDecideBudgetLineProposal(ADMIN, item, appData), true);
  });

  test('#5 Ngân Sách: approver đúng cấu hình duyệt được Đề Xuất qua approveBudgetLineProposal()', () => {
    const item = { id: 1, dept: 'Khối Kinh Doanh', createdBy: 'nv_kd', stage: 'PROPOSED', status: 'SUBMITTED' };
    const result = recordActions.approveBudgetLineProposal(CONFIGURED_APPROVER, item, appData);
    assert.strictEqual(result.status, 'APPROVED');
    assert.strictEqual(result.decidedBy, 'tp_kd');
  });

  test('#5 Ngân Sách: approver đúng cấu hình từ chối được Đề Xuất qua rejectBudgetLineProposal()', () => {
    const item = { id: 2, dept: 'Khối Kinh Doanh', createdBy: 'nv_kd', stage: 'PROPOSED', status: 'SUBMITTED' };
    const result = recordActions.rejectBudgetLineProposal(CONFIGURED_APPROVER, item, { reason: 'sai định mức' }, appData);
    assert.strictEqual(result.status, 'REJECTED');
  });

  test('#5 Ngân Sách: budgetCreate KHÔNG phải approver -> approveBudgetLineProposal() 403', () => {
    const item = { id: 3, dept: 'Khối Kinh Doanh', createdBy: 'nv_kd', stage: 'PROPOSED', status: 'SUBMITTED' };
    assert.throws(() => recordActions.approveBudgetLineProposal(UNCONFIGURED_CREATOR, item, appData), /403|không có quyền/);
  });

  test('#5 Ngân Sách: budgetManage vẫn LUÔN quyết định được mọi dòng bất kể cấu hình phòng ban', () => {
    const item = { id: 4, dept: 'Khối Kinh Doanh', createdBy: 'nv_kd', stage: 'PROPOSED', status: 'SUBMITTED' };
    const result = recordActions.approveBudgetLineProposal(BUDGET_MANAGE, item, appData);
    assert.strictEqual(result.status, 'APPROVED');
  });

  test('#5 Ngân Sách: approver đúng cấu hình vẫn KHÔNG tự duyệt được Đề Xuất do chính mình tạo (assertNotSelfDecidingBudgetLine giữ nguyên)', () => {
    const item = { id: 5, dept: 'Khối Kinh Doanh', createdBy: 'tp_kd', stage: 'PROPOSED', status: 'SUBMITTED' };
    assert.throws(() => recordActions.approveBudgetLineProposal(CONFIGURED_APPROVER, item, appData), /403|tự duyệt/);
  });
}

// ===== #5b (10/2026, theo yêu cầu người dùng bổ sung route phê duyệt cuối): Ngân Sách (budgetLines) —
// Phê Duyệt CUỐI (stage=APPROVED) theo cấu hình phòng ban RIÊNG (budgetApprovedDeptWorkflows), TÁCH
// KHỎI budgetDeptWorkflows của bước Đề Xuất ở #5 — mirror đúng khuôn test nhưng dùng map khác =====
{
  const ADMIN = { username: 'admin1', perms: { admin: true } };
  const BUDGET_MANAGE = { username: 'qlns1', perms: { budgetManage: true } };
  const CONFIGURED_APPROVER = { username: 'bgd1', perms: { budgetCreate: true } };
  const UNCONFIGURED_CREATOR = { username: 'nv_kd', perms: { budgetCreate: true } };

  const appData = {
    workflows: [{ id: 'wf1', steps: [{ order: 1, name: 'Duyệt' }] }],
    // CỐ Ý khác người so với budgetDeptWorkflows ở #5 (tp_kd) — minh hoạ đúng ý nghĩa "2 bước có thể
    // cần người duyệt khác nhau" (Đề Xuất do Trưởng phòng, Phê Duyệt cuối do Ban Giám Đốc).
    budgetDeptWorkflows: { 'Khối Kinh Doanh': { workflowId: 'wf1', approvers: { 1: ['tp_kd'] } } },
    budgetApprovedDeptWorkflows: {
      'Khối Kinh Doanh': { workflowId: 'wf1', approvers: { 1: ['bgd1'] } }
      // 'Khối Vận Hành' CỐ Ý không có trong đây — mô phỏng phòng ban CHƯA được admin cấu hình gì.
    }
  };

  test('#5b Ngân Sách: budgetCreate KHÔNG phải approver bước 1 Phê Duyệt cuối của phòng ban -> canDecideBudgetLineFinal = false', () => {
    const item = { dept: 'Khối Kinh Doanh', createdBy: 'nv_kd' };
    assert.strictEqual(recordActions.canDecideBudgetLineFinal(UNCONFIGURED_CREATOR, item, appData), false);
  });

  test('#5b Ngân Sách: budgetCreate LÀ approver bước 1 Phê Duyệt cuối đúng phòng ban đã cấu hình -> canDecideBudgetLineFinal = true', () => {
    const item = { dept: 'Khối Kinh Doanh', createdBy: 'nv_kd' };
    assert.strictEqual(recordActions.canDecideBudgetLineFinal(CONFIGURED_APPROVER, item, appData), true);
  });

  test('#5b Ngân Sách: approver bước Đề Xuất (tp_kd) KHÔNG tự động là approver Phê Duyệt cuối (2 map tách biệt)', () => {
    const item = { dept: 'Khối Kinh Doanh', createdBy: 'nv_kd' };
    const PROPOSAL_APPROVER = { username: 'tp_kd', perms: { budgetCreate: true } };
    assert.strictEqual(recordActions.canDecideBudgetLineFinal(PROPOSAL_APPROVER, item, appData), false);
  });

  test('#5b Ngân Sách: phòng ban CHƯA cấu hình Phê Duyệt cuối -> chỉ budgetManage/admin quyết định được', () => {
    const item = { dept: 'Khối Vận Hành', createdBy: 'nv_kd' };
    assert.strictEqual(recordActions.canDecideBudgetLineFinal(CONFIGURED_APPROVER, item, appData), false);
    assert.strictEqual(recordActions.canDecideBudgetLineFinal(BUDGET_MANAGE, item, appData), true);
    assert.strictEqual(recordActions.canDecideBudgetLineFinal(ADMIN, item, appData), true);
  });

  test('#5b Ngân Sách: approver đúng cấu hình duyệt được dòng Phê Duyệt cuối qua approveBudgetLine()', () => {
    const item = { id: 101, dept: 'Khối Kinh Doanh', createdBy: 'nv_kd', stage: 'APPROVED', status: 'SUBMITTED' };
    const result = recordActions.approveBudgetLine(CONFIGURED_APPROVER, item, appData);
    assert.strictEqual(result.status, 'APPROVED');
    assert.strictEqual(result.decidedBy, 'bgd1');
  });

  test('#5b Ngân Sách: approver đúng cấu hình từ chối được dòng Phê Duyệt cuối qua rejectBudgetLine()', () => {
    const item = { id: 102, dept: 'Khối Kinh Doanh', createdBy: 'nv_kd', stage: 'APPROVED', status: 'SUBMITTED' };
    const result = recordActions.rejectBudgetLine(CONFIGURED_APPROVER, item, { reason: 'sai định mức' }, appData);
    assert.strictEqual(result.status, 'REJECTED');
  });

  test('#5b Ngân Sách: budgetCreate KHÔNG phải approver Phê Duyệt cuối -> approveBudgetLine() 403', () => {
    const item = { id: 103, dept: 'Khối Kinh Doanh', createdBy: 'nv_kd', stage: 'APPROVED', status: 'SUBMITTED' };
    assert.throws(() => recordActions.approveBudgetLine(UNCONFIGURED_CREATOR, item, appData), /403|không có quyền/);
  });

  test('#5b Ngân Sách: budgetManage vẫn LUÔN quyết định được mọi dòng Phê Duyệt cuối bất kể cấu hình phòng ban', () => {
    const item = { id: 104, dept: 'Khối Kinh Doanh', createdBy: 'nv_kd', stage: 'APPROVED', status: 'SUBMITTED' };
    const result = recordActions.approveBudgetLine(BUDGET_MANAGE, item, appData);
    assert.strictEqual(result.status, 'APPROVED');
  });

  test('#5b Ngân Sách: approver đúng cấu hình vẫn KHÔNG tự duyệt được dòng Phê Duyệt cuối do chính mình tạo (assertNotSelfDecidingBudgetLine giữ nguyên)', () => {
    const item = { id: 105, dept: 'Khối Kinh Doanh', createdBy: 'bgd1', stage: 'APPROVED', status: 'SUBMITTED' };
    assert.throws(() => recordActions.approveBudgetLine(CONFIGURED_APPROVER, item, appData), /403|tự duyệt/);
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
