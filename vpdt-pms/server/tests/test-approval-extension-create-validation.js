// server/tests/test-approval-extension-create-validation.js
//
// Test hồi quy cho field TUỲ CHỌN `desiredApprovalDate` ("Ngày Mong Muốn Phê Duyệt", 11/2026) ở
// lib/createValidation.js — CREATE_MODULE_CONFIGS.submissions/contracts.extraValidate(). Gọi THẲNG
// validateAndPrepareCreate() thật (không stub lib/createValidation.js) với fixture TỐI THIỂU đủ để đi
// qua hết các bước validate khác (quy trình phê duyệt, custodianDept, loại hợp đồng...) mà không throw
// vì lý do KHÔNG liên quan tới field đang test.
//
// Chạy: node server/tests/test-approval-extension-create-validation.js
'use strict';
const assert = require('assert');
const { validateAndPrepareCreate, CreateError } = require('../lib/createValidation');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

const USER = { username: 'nv1', name: 'Người Trình', dept: 'Phòng A', perms: { submissionCreate: true, contractCreate: true } };

const SUB_APP_DATA = {
  submissionApprovalLevels: [{ id: 'LV1', visibleGroupIds: [], lockedGroupIds: [] }],
  submissionApprovalGroups: [],
  submissionTypeDeptWorkflows: {},
  submissionDeptWorkflows: {},
  contractApprovalLevels: [{ id: 'LV1', visibleGroupIds: [], lockedGroupIds: [] }],
  contractApprovalGroups: [],
  contractApprovalDeptWorkflows: {},
  workflows: [],
  users: [USER],
  formTemplates: {}
};

function baseSubmissionPayload(extra) {
  return {
    dept: 'Phòng A', type: 'Tờ trình khác', title: 'Tờ trình test', priority: 'Bình thường', content: 'Nội dung',
    approvalLevel: 'LV1', selectedApprovalLayers: [], selectedLayerMembers: {},
    customData: {}, fileUrl: '', extraFiles: [],
    ...extra
  };
}

function baseContractPayload(extra) {
  return {
    dept: 'Phòng A', custodianDept: 'Phòng A', type: 'Thuê dịch vụ', title: 'Hợp đồng test', partner: 'Đối tác A',
    amount: 100000, startDate: '2026-01-01', endDate: '2026-12-31', content: 'Nội dung',
    isAddendum: false, rootContractId: null, paymentInstallments: [],
    approvalLevel: 'LV1', selectedApprovalLayers: [], selectedLayerMembers: {},
    customData: {}, fileUrl: '', signedFileUrl: '',
    ...extra
  };
}

function main() {
  console.log('== "Ngày Mong Muốn Phê Duyệt" — CREATE_MODULE_CONFIGS.submissions/contracts.extraValidate() ==');

  test('Submissions: KHÔNG đặt desiredApprovalDate -> record.desiredApprovalDate = null (không regression, hành vi cũ nguyên vẹn)', () => {
    const payload = baseSubmissionPayload();
    const rec = validateAndPrepareCreate('submissions', payload, USER, [], SUB_APP_DATA, []);
    assert.strictEqual(rec.desiredApprovalDate, null);
  });

  test('Submissions: đặt desiredApprovalDate hợp lệ -> giữ nguyên trong record', () => {
    const payload = baseSubmissionPayload({ desiredApprovalDate: '2026-12-31' });
    const rec = validateAndPrepareCreate('submissions', payload, USER, [], SUB_APP_DATA, []);
    assert.strictEqual(rec.desiredApprovalDate, '2026-12-31');
  });

  test('Submissions: desiredApprovalDate không hợp lệ -> CreateError 400', () => {
    const payload = baseSubmissionPayload({ desiredApprovalDate: 'khong-phai-ngay' });
    assert.throws(() => validateAndPrepareCreate('submissions', payload, USER, [], SUB_APP_DATA, []),
      (err) => err instanceof CreateError && err.status === 400);
  });

  test('Contracts: KHÔNG đặt desiredApprovalDate -> record.desiredApprovalDate = null', () => {
    const payload = baseContractPayload();
    const rec = validateAndPrepareCreate('contracts', payload, USER, [], SUB_APP_DATA, []);
    assert.strictEqual(rec.desiredApprovalDate, null);
  });

  test('Contracts: đặt desiredApprovalDate hợp lệ -> giữ nguyên trong record', () => {
    const payload = baseContractPayload({ desiredApprovalDate: '2026-12-31' });
    const rec = validateAndPrepareCreate('contracts', payload, USER, [], SUB_APP_DATA, []);
    assert.strictEqual(rec.desiredApprovalDate, '2026-12-31');
  });

  test('Contracts: desiredApprovalDate không hợp lệ -> CreateError 400', () => {
    const payload = baseContractPayload({ desiredApprovalDate: 'khong-phai-ngay' });
    assert.throws(() => validateAndPrepareCreate('contracts', payload, USER, [], SUB_APP_DATA, []),
      (err) => err instanceof CreateError && err.status === 400);
  });

  test('Contracts: các validate KHÁC (amount>0, startDate<=endDate...) KHÔNG bị ảnh hưởng bởi field mới', () => {
    const payload = baseContractPayload({ amount: 0 });
    assert.throws(() => validateAndPrepareCreate('contracts', payload, USER, [], SUB_APP_DATA, []),
      (err) => err instanceof CreateError && /lớn hơn 0/.test(err.message));
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  process.exitCode = failed ? 1 : 0;
}

main();
