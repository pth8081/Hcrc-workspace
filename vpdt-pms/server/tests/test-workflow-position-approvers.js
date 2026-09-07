// tests/test-workflow-position-approvers.js
//
// Regression test cho bước duyệt "Theo vị trí" (POSITION mode, đợt tính năng workflowParticipatingPositions
// — xem defaults.js/lib/positionApprovers.js/lib/workflowEngine.js/lib/createValidation.js/
// public/js/module-ngansach.js+module-itsupport-tier.js). Gọi THẲNG các hàm thật (KHÔNG chép lại logic
// nghiệp vụ bằng tay, KHÔNG mock lib/workflowEngine.js hay lib/createValidation.js):
//
//   1. resolvePositionApprovers()/resolveStepApproverUsernames() (lib/positionApprovers.js, điểm tra
//      cứu trung tâm DUY NHẤT) — lọc đúng theo (jobTitle,dept) VÀ canBeApprover/admin/active; PEOPLE
//      mode (vắng/khác 'POSITION') đọc thẳng approvers[] như cũ.
//   2. flatWorkflowConfigToSteps() (lib/workflowEngine.js) tự động có hiệu lực cho NHIỀU module khác
//      nhau (docs/carRegs/budgetEntries — 3 dbKey khác nhau) MÀ KHÔNG cần sửa riêng từng module, thông
//      qua MODULE_CONFIGS[moduleKey].resolveWfConfig() thật.
//   3. applyWorkflowAction() (workflowEngine.js) THẬT, hành động APPROVE trên 1 bước POSITION mode:
//      - user khớp vị trí VÀ có canBeApprover -> duyệt được.
//      - user khớp vị trí nhưng KHÔNG có canBeApprover -> bị từ chối (403) — đây là yêu cầu bảo mật cốt
//        lõi: khớp vị trí chỉ là điều kiện LỌC BỚT, không thay thế được quyền "Người duyệt".
//   4. PEOPLE mode (mặc định, KHÔNG bật "Theo vị trí") hoàn toàn KHÔNG bị ảnh hưởng — regression-proof
//      rõ ràng, kể cả giữ nguyên 1 quirk CŨ đã biết (1 username có tên sẵn trong approvers[] vẫn duyệt
//      được dù không có canBeApprover — KHÔNG re-check ở PEOPLE mode, ngoài phạm vi đợt này).
//   5. buildEffectiveSubmissionWorkflowServer()/buildEffectiveContractApprovalWorkflowServer()
//      (lib/createValidation.js, 2 module SNAPSHOT effectiveApprovers ngay lúc tạo) resolve đúng
//      POSITION mode NGAY TẠI THỜI ĐIỂM DỰNG SNAPSHOT.
//   6. Xác nhận rõ ràng bằng code (không chỉ mô tả) 2 "ngoại lệ" — operationStoreOpenDeptWorkflows/
//      operationRepairDeptWorkflows KHÔNG có mặt trong MODULE_CONFIGS (đã bị xoá khỏi luồng duyệt sống ở
//      1 đợt trước, xem chú thích trong lib/workflowEngine.js) — nên "Theo vị trí" cấu hình được ở 2 màn
//      admin đó (WF_MODULE_CONFIG.OPERATION_STORE_OPEN/OPERATION_REPAIR ở module-workflow.js) nhưng
//      KHÔNG có đường duyệt thật nào tiêu thụ nó — không phải lỗi của đợt này, chỉ nêu rõ để không ai lầm
//      tưởng "cả 16/16 khớp propagate qua đường duyệt sống".
//
// Chạy: node server/tests/test-workflow-position-approvers.js
'use strict';

const { createRunner, assertEqual, assert } = require('./testHarness');
const { resolvePositionApprovers, resolveStepApproverUsernames } = require('../lib/positionApprovers');
const { MODULE_CONFIGS, applyWorkflowAction, canApproveStep, flatWorkflowConfigToSteps } = require('../lib/workflowEngine');
const { buildEffectiveSubmissionWorkflowServer, buildEffectiveContractApprovalWorkflowServer } = require('../lib/createValidation');

function makeUser(over) {
  return { username: 'u', name: 'U', dept: 'Phòng IT', jobTitle: 'Trưởng phòng', active: true, perms: {}, ...over };
}

const WORKFLOWS = [{ id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ order: 1, name: 'Duyệt' }] }];

// 1 config mẫu: bước 1 ở chế độ POSITION, vị trí "Trưởng phòng — Phòng IT".
function positionConfig() {
  return {
    workflowId: 'WF_1STEP',
    approvers: {},
    approverMode: { 1: 'POSITION' },
    approversByPosition: { 1: [{ jobTitle: 'Trưởng phòng', dept: 'Phòng IT' }] }
  };
}

async function main() {
  const run = createRunner();

  // ===== 1) resolvePositionApprovers()/resolveStepApproverUsernames() thuần =====
  await run.run('resolvePositionApprovers(): khớp đúng (jobTitle,dept) VÀ canBeApprover/admin, loại active:false/thiếu quyền/khác dept', () => {
    const users = [
      makeUser({ username: 'a1', perms: { canBeApprover: true } }),
      makeUser({ username: 'a2', perms: {} }), // thiếu canBeApprover
      makeUser({ username: 'a3', dept: 'Phòng Nhân Sự', perms: { canBeApprover: true } }), // khác dept
      makeUser({ username: 'a4', perms: { canBeApprover: true }, active: false }), // đã khoá
      makeUser({ username: 'a5', jobTitle: 'Phó phòng', perms: { canBeApprover: true } }), // khác jobTitle
      makeUser({ username: 'a6', perms: { admin: true } }) // admin thay canBeApprover
    ];
    const result = resolvePositionApprovers([{ jobTitle: 'Trưởng phòng', dept: 'Phòng IT' }], users);
    assertEqual(result.length, 2, 'Chỉ a1 (canBeApprover) và a6 (admin) hợp lệ');
    assert(result.includes('a1'), 'Phải có a1');
    assert(result.includes('a6'), 'Phải có a6 (admin thay canBeApprover)');
    assert(!result.includes('a2'), 'a2 thiếu canBeApprover -> loại');
    assert(!result.includes('a3'), 'a3 khác dept -> loại');
    assert(!result.includes('a4'), 'a4 đã khoá (active:false) -> loại');
    assert(!result.includes('a5'), 'a5 khác jobTitle -> loại');
  });

  await run.run('resolvePositionApprovers(): không cấu hình cặp nào (rỗng/thiếu jobTitle,dept) -> trả về mảng rỗng, không throw', () => {
    assertEqual(resolvePositionApprovers([], [makeUser({ username: 'a1', perms: { canBeApprover: true } })]).length, 0, 'Mảng cặp rỗng -> không ai');
    assertEqual(resolvePositionApprovers(null, []).length, 0, 'null -> không throw, trả về rỗng');
    assertEqual(resolvePositionApprovers([{ jobTitle: '', dept: 'Phòng IT' }], []).length, 0, 'Cặp thiếu jobTitle bị lọc bỏ');
  });

  await run.run('resolveStepApproverUsernames(): approverMode vắng/khác POSITION -> đọc thẳng approvers[] cũ (KHÔNG đổi hành vi)', () => {
    const configPeople = { approvers: { 1: ['x', 'y'] }, approverMode: { 1: 'PEOPLE' } };
    assertEqual(JSON.stringify(resolveStepApproverUsernames(configPeople, 1, [])), JSON.stringify(['x', 'y']), 'PEOPLE mode tường minh -> đọc thẳng approvers[]');
    const configNoMode = { approvers: { 1: ['x'] } };
    assertEqual(JSON.stringify(resolveStepApproverUsernames(configNoMode, 1, [])), JSON.stringify(['x']), 'Vắng approverMode (cấu hình CŨ trước đợt này) -> vẫn đọc approvers[], không đổi hành vi');
    const configPosition = positionConfig();
    const users = [makeUser({ username: 'pos1', perms: { canBeApprover: true } })];
    assertEqual(JSON.stringify(resolveStepApproverUsernames(configPosition, 1, users)), JSON.stringify(['pos1']), 'POSITION mode -> tính động qua resolvePositionApprovers()');
  });

  // ===== 2) flatWorkflowConfigToSteps() qua NHIỀU module khác nhau (docs/carRegs/budgetEntries) =====
  const POS_OK = makeUser({ username: 'pos_ok', name: 'Có Quyền Duyệt', perms: { canBeApprover: true } });
  const POS_NOPERM = makeUser({ username: 'pos_noperm', name: 'Không Có Quyền Duyệt', perms: {} });
  const POS_USERS = [POS_OK, POS_NOPERM];

  const moduleCases = [
    { label: 'docs (deptWorkflows)', appDataKey: 'deptWorkflows', moduleKey: 'docs', item: { dept: 'Phòng IT' } },
    { label: 'carRegs (carDeptWorkflows)', appDataKey: 'carDeptWorkflows', moduleKey: 'carRegs', item: { dept: 'Phòng IT', startTime: '2026-01-01T08:00:00', endTime: '2026-01-01T09:00:00' } },
    { label: 'budgetEntries (budgetDeptWorkflows)', appDataKey: 'budgetDeptWorkflows', moduleKey: 'budgetEntries', item: { dept: 'Phòng IT' } }
  ];
  for (const { label, appDataKey, moduleKey, item } of moduleCases) {
    await run.run(`${label}: resolveWfConfig() (MODULE_CONFIGS thật) tự resolve POSITION mode qua flatWorkflowConfigToSteps() trung tâm — KHÔNG sửa riêng module này`, () => {
      const appData = { workflows: WORKFLOWS, users: POS_USERS, [appDataKey]: { 'Phòng IT': positionConfig() } };
      const { approvers } = MODULE_CONFIGS[moduleKey].resolveWfConfig(item, appData);
      assertEqual(JSON.stringify(approvers[1]), JSON.stringify(['pos_ok']), `${label}: bước 1 phải resolve đúng đúng 1 username hợp lệ (pos_ok), loại pos_noperm`);
    });
  }

  await run.run('flatWorkflowConfigToSteps() độc lập: cùng 1 config POSITION mode cho ra đúng kết quả bất kể gọi trực tiếp', () => {
    const appData = { workflows: WORKFLOWS, users: POS_USERS };
    const { approvers } = flatWorkflowConfigToSteps(positionConfig(), appData);
    assertEqual(JSON.stringify(approvers[1]), JSON.stringify(['pos_ok']), 'flatWorkflowConfigToSteps() phải resolve đúng POSITION mode');
  });

  // ===== 3) applyWorkflowAction() THẬT — APPROVE ở bước POSITION mode =====
  await run.run('applyWorkflowAction(APPROVE) — user khớp vị trí VÀ có canBeApprover -> duyệt được (docs, bước cuối -> APPROVED)', () => {
    const appData = { workflows: WORKFLOWS, users: POS_USERS, deptWorkflows: { 'Phòng IT': positionConfig() } };
    const item = { id: 1, dept: 'Phòng IT', status: 'PENDING', currentStep: 1, history: [] };
    const { item: updated, transition } = applyWorkflowAction({
      moduleKey: 'docs', item, action: 'APPROVE', user: POS_OK, comment: '', appData, existingCollection: [], users: POS_USERS
    });
    assertEqual(updated.status, 'APPROVED', 'Duyệt xong bước cuối (1 bước) -> APPROVED');
    assertEqual(transition.type, 'COMPLETED', 'Transition phải là COMPLETED');
  });

  await run.run('applyWorkflowAction(APPROVE) — user khớp vị trí NHƯNG KHÔNG có canBeApprover -> bị từ chối 403 (YÊU CẦU BẢO MẬT CỐT LÕI)', () => {
    const appData = { workflows: WORKFLOWS, users: POS_USERS, deptWorkflows: { 'Phòng IT': positionConfig() } };
    const item = { id: 2, dept: 'Phòng IT', status: 'PENDING', currentStep: 1, history: [] };
    let threw = null;
    try {
      applyWorkflowAction({ moduleKey: 'docs', item, action: 'APPROVE', user: POS_NOPERM, comment: '', appData, existingCollection: [], users: POS_USERS });
    } catch (e) { threw = e; }
    assert(threw, 'Phải ném lỗi — khớp vị trí không đủ, còn thiếu quyền canBeApprover');
    assertEqual(threw.status, 403, 'Lỗi phải là 403 (không có quyền xử lý ở bước hiện tại)');
    assertEqual(item.status, 'PENDING', 'Hồ sơ KHÔNG được đổi trạng thái sau lượt bị từ chối');
  });

  await run.run('canApproveStep() THẬT: user không khớp vị trí (khác dept) dù có canBeApprover -> vẫn false', () => {
    const outsider = makeUser({ username: 'outsider', dept: 'Phòng Kế Toán', perms: { canBeApprover: true } });
    const appData = { workflows: WORKFLOWS, users: [outsider] };
    const { approvers } = flatWorkflowConfigToSteps(positionConfig(), appData);
    assertEqual(canApproveStep(outsider, approvers[1], [], 1), false, 'Không khớp (jobTitle,dept) -> không phải approver dù có canBeApprover');
  });

  // ===== 4) PEOPLE mode (mặc định) — regression-proof rõ ràng =====
  await run.run('PEOPLE mode (approverMode vắng, cấu hình y hệt TRƯỚC đợt này) — HOÀN TOÀN không đổi hành vi, kể cả quirk CŨ (không re-check canBeApprover)', () => {
    const peopleConfig = { workflowId: 'WF_1STEP', approvers: { 1: ['legacy_named_user'] } }; // KHÔNG có approverMode/approversByPosition — đúng khuôn dữ liệu cũ
    const legacyUser = makeUser({ username: 'legacy_named_user', jobTitle: 'Nhân viên', dept: 'Phòng Khác', perms: {} }); // KHÔNG canBeApprover, KHÔNG khớp vị trí nào — nhưng có TÊN SẴN trong approvers[]
    const appData = { workflows: WORKFLOWS, users: [legacyUser], deptWorkflows: { 'Phòng IT': peopleConfig } };
    const item = { id: 3, dept: 'Phòng IT', status: 'PENDING', currentStep: 1, history: [] };
    const { item: updated } = applyWorkflowAction({
      moduleKey: 'docs', item, action: 'APPROVE', user: legacyUser, comment: '', appData, existingCollection: [], users: [legacyUser]
    });
    assertEqual(updated.status, 'APPROVED', 'PEOPLE mode: 1 username có tên sẵn trong approvers[] vẫn duyệt được dù KHÔNG canBeApprover — quirk CŨ giữ nguyên, ngoài phạm vi đợt này');
  });

  await run.run('PEOPLE mode: user KHÔNG có tên trong approvers[] (dù khớp jobTitle/dept 1 vị trí bất kỳ) vẫn bị từ chối — vị trí không có ý nghĩa gì ở PEOPLE mode', () => {
    const peopleConfig = { workflowId: 'WF_1STEP', approvers: { 1: ['someone_else'] } };
    const uninvolvedButMatchingPosition = makeUser({ username: 'not_named', perms: { canBeApprover: true } }); // đúng jobTitle/dept "Trưởng phòng"/"Phòng IT" nhưng KHÔNG có tên trong approvers[]
    const appData = { workflows: WORKFLOWS, users: [uninvolvedButMatchingPosition], deptWorkflows: { 'Phòng IT': peopleConfig } };
    const item = { id: 4, dept: 'Phòng IT', status: 'PENDING', currentStep: 1, history: [] };
    let threw = null;
    try {
      applyWorkflowAction({ moduleKey: 'docs', item, action: 'APPROVE', user: uninvolvedButMatchingPosition, comment: '', appData, existingCollection: [], users: [uninvolvedButMatchingPosition] });
    } catch (e) { threw = e; }
    assert(threw, 'PEOPLE mode không tra theo vị trí — không có tên trong approvers[] thì luôn bị từ chối');
    assertEqual(threw.status, 403, 'Lỗi 403');
  });

  // ===== 5) Snapshot lúc TẠO (submissions/contracts — lib/createValidation.js) =====
  await run.run('buildEffectiveSubmissionWorkflowServer(): resolve đúng POSITION mode NGAY LÚC dựng snapshot effectiveApprovers', () => {
    const appData = {
      workflows: WORKFLOWS, users: POS_USERS, submissionTypes: [], submissionTypeDeptWorkflows: {},
      submissionDeptWorkflows: { 'Phòng IT': positionConfig() }, submissionApprovalGroups: {}
    };
    const wf = buildEffectiveSubmissionWorkflowServer('Bất kỳ', 'Phòng IT', [], {}, appData, 'KHAC');
    assertEqual(JSON.stringify(wf.approvers[1]), JSON.stringify(['pos_ok']), 'effectiveApprovers[1] phải là username đã resolve (pos_ok), không phải mảng rỗng/config thô');
  });

  await run.run('buildEffectiveContractApprovalWorkflowServer(): resolve đúng POSITION mode NGAY LÚC dựng snapshot effectiveApprovers', () => {
    const appData = {
      workflows: WORKFLOWS, users: POS_USERS,
      contractApprovalDeptWorkflows: { 'Phòng IT': positionConfig() }, contractApprovalGroups: {}
    };
    const wf = buildEffectiveContractApprovalWorkflowServer('Phòng IT', [], {}, appData, 'KHAC');
    assertEqual(JSON.stringify(wf.approvers[1]), JSON.stringify(['pos_ok']), 'effectiveApprovers[1] phải là username đã resolve (pos_ok)');
  });

  // ===== 6) Xác nhận rõ ràng 2 "ngoại lệ" không có đường duyệt sống =====
  await run.run('operationStoreOpenDeptWorkflows/operationRepairDeptWorkflows KHÔNG có MODULE_CONFIGS tương ứng — "Theo vị trí" cấu hình được ở admin nhưng KHÔNG có đường duyệt thật nào tiêu thụ (đã dừng hẳn từ 1 đợt trước, không phải lỗi của đợt này)', () => {
    assert(!('operationStoreOpenings' in MODULE_CONFIGS), 'operationStoreOpenings không được có trong MODULE_CONFIGS (đã dừng phê duyệt)');
    assert(!('operationRepairs' in MODULE_CONFIGS), 'operationRepairs không được có trong MODULE_CONFIGS (đã dừng phê duyệt)');
    // Các dbKey CÒN LẠI đều CÓ mặt — xác nhận 13 MODULE_CONFIGS thật sự phủ đúng 14/16 WF_MODULE_CONFIG
    // (OFFICE_BUY/OFFICE_FIX dùng chung 'officeReqs'; OPERATION_ORDER_STORE/OPERATION_ORDER_HO dùng
    // chung 'operationOrders') + 'paymentRequests' MỚI ("Chuyển Xác Nhận Thanh Toán" giờ đi qua quy trình
    // duyệt theo bước/phòng ban, thay cho quyền phẳng canManagePaymentRequests() cũ — xem
    // lib/workflowEngine.js MODULE_CONFIGS.paymentRequests).
    const expectedKeys = [
      'docs', 'submissions', 'carRegs', 'officeReqs', 'vppRegistrations', 'contracts', 'contractsSignedFile',
      'itPriceApprovals', 'budgetEntries', 'operationOrders', 'operationStoreOpeningEstimate', 'operationRepairEstimate',
      'paymentRequests'
    ];
    expectedKeys.forEach(k => assert(k in MODULE_CONFIGS, `MODULE_CONFIGS phải có key "${k}"`));
    assertEqual(Object.keys(MODULE_CONFIGS).length, expectedKeys.length, 'MODULE_CONFIGS phải có đúng 13 khoá (đúng số đã liệt kê, không thừa/thiếu)');
  });

  run.summary();
}

main().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
