// server/tests/test-audit-round4-formapproval.js
//
// Regression test cho ĐỢT RÀ SOÁT CHUYÊN SÂU 9/2026 (tập trung "form nhập có điều kiện phê duyệt", theo
// yêu cầu người dùng) — 7 agent song song rà soát toàn bộ workflowEngine.js + các kênh phụ nằm ngoài
// engine (contract payment-type-change, itPriceApprovals apply/claim, leaveRequests). Mỗi kịch bản dưới
// đây gắn với ĐÚNG 1 lỗ hổng đã vá, viết sao cho hoàn tác bản vá là test FAIL ngay:
//
//   1. paymentRequests: allowSelfDeciding TRƯỚC ĐÂY là cờ tĩnh áp dụng cho TOÀN BỘ module bất kể
//      sourceModule — đề nghị phát sinh từ Hợp Đồng/Mua Bán (sourceModule != 'MANUAL') vẫn tự duyệt
//      được. Vá: allowSelfDeciding giờ là HÀM (item) => boolean, chỉ true khi sourceModule==='MANUAL'.
//   2. contracts — "Đổi Hình Thức Thanh Toán": approveContractPaymentTypeChange()/
//      rejectContractPaymentTypeChange() TRƯỚC ĐÂY không hề kiểm tra tự xử lý.
//   3. contractsSignedFile ("Tài liệu ký"): assertNotSelfDecidingWorkflowItem() TRƯỚC ĐÂY chỉ so với
//      contract.creator (người tạo hợp đồng gốc) — người THỰC SỰ tải Tài liệu ký lên (signedUploadedBy,
//      khác creator theo đúng thiết kế custodianDept) vẫn tự duyệt được tài liệu do chính mình tải.
//   4. itPriceApprovals: claimPriceApply()/applyPriceApproval()/requestPriceInfoFromIt() (bước "IT áp
//      giá", nằm NGOÀI applyWorkflowAction()) TRƯỚC ĐÂY không kiểm tra tự xử lý.
//   5. leaveRequests: canApproveLeaveRequest() nhánh hrAttendanceManage TRƯỚC ĐÂY return true NGAY,
//      không loại trừ trường hợp approver chính là người xin nghỉ.
//   6. leaveRequests: deductLeaveBalance() TRƯỚC ĐÂY trừ VÔ ĐIỀU KIỆN, không so lại với totalDays — 2 đơn
//      không trùng ngày (mỗi đơn hợp lệ riêng lẻ lúc tạo) duyệt cả 2 vẫn vượt quỹ phép không cảnh báo.
//   7. budgetEntries: blockApproveIf (kỳ ngân sách đã đóng sổ) TRƯỚC ĐÂY chỉ gate APPROVE/REJECT —
//      REQUEST_CHANGES (Yêu Cầu Bổ Sung) vẫn đưa được 1 bản ghi của kỳ ĐÃ ĐÓNG về NHÁP, kẹt vĩnh viễn.
//
// Chạy THUẦN NODE (gọi thẳng lib/workflowEngine.js + lib/recordActions.js + lib/attendance.js trong
// process, không cần DB/Playwright) — các hàm này thuần logic, không tự đọc DB.
'use strict';

const workflowEngine = require('../lib/workflowEngine');
const recordActions = require('../lib/recordActions');
const attendance = require('../lib/attendance');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}
function expectThrow(fn, matchText, label) {
  try {
    fn();
    check(label, false, 'không throw');
  } catch (err) {
    check(label, !matchText || String(err.message).includes(matchText), err.message);
  }
}
function expectNoThrow(fn, label) {
  try {
    fn();
    check(label, true);
  } catch (err) {
    check(label, false, err.message);
  }
}

const WORKFLOWS = [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Duyệt' }] }];

// ===== 1) paymentRequests — allowSelfDeciding chỉ áp dụng đúng sourceModule='MANUAL' =====
function testPaymentRequestsSelfDeciding() {
  const appData = { workflows: WORKFLOWS, paymentDeptWorkflows: { 'Phòng Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['ketoan1'] } } } };
  const user = { username: 'ketoan1', name: 'Kế Toán 1', perms: {} };

  const manualItem = { id: 1, status: 'PENDING', currentStep: 1, dept: 'Phòng Kế Toán', history: [], createdBy: 'ketoan1', sourceModule: 'MANUAL' };
  expectNoThrow(() => workflowEngine.applyWorkflowAction({ moduleKey: 'paymentRequests', item: manualItem, action: 'APPROVE', user, appData }),
    'paymentRequests: sourceModule=MANUAL — người tạo VẪN tự duyệt được (hành vi ĐÃ CHỐT, không đổi)');

  const contractSourcedItem = { id: 2, status: 'PENDING', currentStep: 1, dept: 'Phòng Kế Toán', history: [], createdBy: 'ketoan1', sourceModule: 'CONTRACT' };
  expectThrow(() => workflowEngine.applyWorkflowAction({ moduleKey: 'paymentRequests', item: contractSourcedItem, action: 'APPROVE', user, appData }),
    'tự xử lý', 'paymentRequests: sourceModule=CONTRACT — người tạo KHÔNG được tự duyệt nữa (LỖI ĐÃ VÁ)');

  const officeSourcedItem = { id: 3, status: 'PENDING', currentStep: 1, dept: 'Phòng Kế Toán', history: [], createdBy: 'ketoan1', sourceModule: 'MUA_BAN' };
  expectThrow(() => workflowEngine.applyWorkflowAction({ moduleKey: 'paymentRequests', item: officeSourcedItem, action: 'APPROVE', user, appData }),
    'tự xử lý', 'paymentRequests: sourceModule=MUA_BAN — người tạo KHÔNG được tự duyệt nữa (LỖI ĐÃ VÁ)');
}

// ===== 2) contracts — "Đổi Hình Thức Thanh Toán" chặn tự xử lý =====
function testContractPaymentTypeChangeSelfDeciding() {
  const appData = { contractManageDeptWorkflows: { 'Phòng Kinh Doanh': { workflowId: 'WF_1STEP', approvers: { 1: ['kd1'] } } }, workflows: WORKFLOWS };
  const makeContract = () => ({
    id: 1, dept: 'Phòng Kinh Doanh', creator: 'kd1', approvalStatus: 'APPROVED', paymentType: 'ONE_TIME', paymentInstallments: [],
    pendingPaymentTypeChange: { newPaymentType: 'PERIODIC', newPaymentInstallments: [], requestedBy: 'kd1', requestedByName: 'KD 1', requestedAt: 'now', reason: 'test' }
  });

  expectThrow(() => recordActions.approveContractPaymentTypeChange({ username: 'kd1', name: 'KD 1', perms: {} }, makeContract(), appData),
    'tự xử lý', 'Đổi Hình Thức Thanh Toán: người tạo hợp đồng KHÔNG tự duyệt được yêu cầu do chính mình gửi (LỖI ĐÃ VÁ)');
  expectThrow(() => recordActions.rejectContractPaymentTypeChange({ username: 'kd1', name: 'KD 1', perms: {} }, makeContract(), { reason: 'không đồng ý' }, appData),
    'tự xử lý', 'Đổi Hình Thức Thanh Toán: người tạo hợp đồng KHÔNG tự từ chối được yêu cầu do chính mình gửi (LỖI ĐÃ VÁ)');
  expectNoThrow(() => recordActions.approveContractPaymentTypeChange({ username: 'admin', name: 'Admin', perms: { admin: true } }, makeContract(), appData),
    'Đổi Hình Thức Thanh Toán: admin vẫn duyệt được bình thường (không bị ảnh hưởng)');
}

// ===== 3) contractsSignedFile — chặn đúng signedUploadedBy (không chỉ creator gốc) =====
function testContractsSignedFileSelfDeciding() {
  const appData = { contractManageDeptWorkflows: { 'Phòng Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['ketoan1'] } } }, workflows: WORKFLOWS };
  const makeItem = () => ({
    id: 1, dept: 'Phòng Kế Toán', creator: 'sales1', signedUploadedBy: 'ketoan1',
    signedFileStatus: 'PENDING', signedFileCurrentStep: 1, signedFileHistory: []
  });

  // Người TẢI tài liệu ký lên (ketoan1) khác người TẠO hợp đồng gốc (sales1) — trước đây chỉ chặn
  // sales1 nên ketoan1 vẫn tự duyệt được tài liệu chính mình vừa tải.
  expectThrow(() => workflowEngine.applyWorkflowAction({ moduleKey: 'contractsSignedFile', item: makeItem(), action: 'APPROVE', user: { username: 'ketoan1', name: 'Kế Toán 1', perms: {} }, appData }),
    'tự xử lý', 'contractsSignedFile: người TẢI tài liệu ký lên KHÔNG tự duyệt được (LỖI ĐÃ VÁ, so đúng signedUploadedBy)');

  // Approver khác (không phải creator, không phải signedUploadedBy) vẫn duyệt được bình thường.
  const otherApproverAppData = { contractManageDeptWorkflows: { 'Phòng Kế Toán': { workflowId: 'WF_1STEP', approvers: { 1: ['ketoan2'] } } }, workflows: WORKFLOWS };
  expectNoThrow(() => workflowEngine.applyWorkflowAction({ moduleKey: 'contractsSignedFile', item: makeItem(), action: 'APPROVE', user: { username: 'ketoan2', name: 'Kế Toán 2', perms: {} }, appData: otherApproverAppData }),
    'contractsSignedFile: approver độc lập (không phải creator/signedUploadedBy) vẫn duyệt bình thường');
}

// ===== 4) itPriceApprovals — bước "IT áp giá" chặn tự xử lý =====
function testItPriceApplySelfDealing() {
  const proposer = { username: 'dexuat1', name: 'Người Đề Xuất', perms: { itManage: true } };
  const otherIt = { username: 'it2', name: 'IT Khác', perms: { itManage: true } };
  const admin = { username: 'admin', name: 'Admin', perms: { admin: true } };
  const makeItem = () => ({ id: 1, status: 'APPROVED', applied: false, creator: 'dexuat1', applyClaimedBy: null, infoRequests: [] });

  expectThrow(() => recordActions.claimPriceApply(proposer, makeItem()), 'tự xử lý',
    'itPriceApprovals: người tạo đề xuất (cũng có itManage) KHÔNG tự nhận xử lý áp giá được (LỖI ĐÃ VÁ)');
  expectNoThrow(() => recordActions.claimPriceApply(otherIt, makeItem()),
    'itPriceApprovals: nhân sự IT khác (không phải người tạo) vẫn nhận xử lý được bình thường');

  const claimedByCreator = Object.assign(makeItem(), { applyClaimedBy: 'dexuat1', applyClaimedByName: 'Người Đề Xuất' });
  expectThrow(() => recordActions.applyPriceApproval(proposer, claimedByCreator), 'tự xử lý',
    'itPriceApprovals: người tạo đề xuất KHÔNG tự xác nhận đã áp giá được (LỖI ĐÃ VÁ)');
  expectNoThrow(() => recordActions.applyPriceApproval(admin, claimedByCreator),
    'itPriceApprovals: admin vẫn xác nhận áp giá được bình thường (không bị ảnh hưởng)');

  expectThrow(() => recordActions.requestPriceInfoFromIt(proposer, makeItem(), { reason: 'cần thêm ảnh chụp bảng giá' }), 'tự xử lý',
    'itPriceApprovals: người tạo đề xuất KHÔNG tự yêu cầu bổ sung được (LỖI ĐÃ VÁ)');
}

// ===== 5) leaveRequests — hrAttendanceManage không tự duyệt được đơn của chính mình =====
function testLeaveRequestSelfApproval() {
  const hrManager = { username: 'hr1', perms: { hrAttendanceManage: true } };
  check('leaveRequests: hrAttendanceManage KHÔNG tự duyệt được đơn của CHÍNH MÌNH (LỖI ĐÃ VÁ)',
    attendance.canApproveLeaveRequest(hrManager, [], 'hr1') === false);
  check('leaveRequests: hrAttendanceManage vẫn duyệt được đơn của NGƯỜI KHÁC bình thường',
    attendance.canApproveLeaveRequest(hrManager, [], 'nv_khac') === true);
  const adminUser = { perms: { admin: true } };
  check('leaveRequests: admin vẫn tự duyệt được (đặc quyền admin không đổi, nhất quán hệ thống)',
    attendance.canApproveLeaveRequest(adminUser, [], 'admin') === true);
}

// ===== 6) leaveRequests — chặn vượt quỹ phép năm tại thời điểm DUYỆT =====
function testLeaveBalanceCapEnforced() {
  expectThrow(() => attendance.deductLeaveBalance({ usedDays: 8, totalDays: 10 }, 8), 'vượt quá quỹ phép',
    'leaveRequests: duyệt đơn thứ 2 (8 ngày) khi đã dùng 8/10 ngày -> bị CHẶN (LỖI ĐÃ VÁ, trước đây trừ âm thầm thành 16/10)');
  expectNoThrow(() => {
    const result = attendance.deductLeaveBalance({ usedDays: 0, totalDays: 10 }, 8);
    if (result.usedDays !== 8) throw new Error(`usedDays sai: ${result.usedDays}`);
  }, 'leaveRequests: duyệt đơn hợp lệ (còn đủ quỹ phép) vẫn trừ đúng bình thường');
}

// ===== 7) budgetEntries — REQUEST_CHANGES cũng bị chặn khi kỳ đã đóng sổ (không chỉ APPROVE/REJECT) =====
function testBudgetEntriesRequestChangesBlockedWhenClosed() {
  const closedPeriodAppData = {
    workflows: WORKFLOWS,
    budgetDeptWorkflows: { 'Phòng Kinh Doanh': { workflowId: 'WF_1STEP', approvers: { 1: ['tp_kd'] } } },
    budgetPeriods: [{ id: 1, status: 'CLOSED' }]
  };
  const item = { id: 1, status: 'PENDING', currentStep: 1, dept: 'Phòng Kinh Doanh', history: [], creator: 'ns1', periodId: 1 };
  const approver = { username: 'tp_kd', name: 'Trưởng Phòng KD', perms: {} };

  expectThrow(() => workflowEngine.applyWorkflowAction({ moduleKey: 'budgetEntries', item, action: 'REQUEST_CHANGES', user: approver, comment: 'cần bổ sung', appData: closedPeriodAppData }),
    'đã kết thúc', 'budgetEntries: "Yêu Cầu Bổ Sung" bị CHẶN khi kỳ đã đóng sổ (LỖI ĐÃ VÁ, trước đây chỉ chặn Duyệt/Từ chối)');

  const openPeriodAppData = Object.assign({}, closedPeriodAppData, { budgetPeriods: [{ id: 1, status: 'OPEN' }] });
  expectNoThrow(() => workflowEngine.applyWorkflowAction({ moduleKey: 'budgetEntries', item: Object.assign({}, item, { history: [] }), action: 'REQUEST_CHANGES', user: approver, comment: 'cần bổ sung', appData: openPeriodAppData }),
    'budgetEntries: "Yêu Cầu Bổ Sung" vẫn hoạt động bình thường khi kỳ CHƯA đóng sổ (không bị ảnh hưởng)');
}

function main() {
  testPaymentRequestsSelfDeciding();
  testContractPaymentTypeChangeSelfDeciding();
  testContractsSignedFileSelfDeciding();
  testItPriceApplySelfDealing();
  testLeaveRequestSelfApproval();
  testLeaveBalanceCapEnforced();
  testBudgetEntriesRequestChangesBlockedWhenClosed();

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main();
