'use strict';

// tests/test-record-approver-snapshot-username-cascade.js
//
// LỖI ĐÃ VÁ (re-audit lần 8, mức Cao — "Cascade rename username không chạm snapshot approver đông cứng
// (effectiveApprovers/extraApprovalLayers)"): cascadeUsernameChangesToWorkflowApprovers() (lib/catalogRename.js)
// chỉ cascade approvers[]/rule.username trong các MAP CẤU HÌNH (*DeptWorkflows/*TierWorkflows/
// MixedApprovalRules) — nơi quyết định người duyệt cho hồ sơ SẼ TẠO SAU NÀY. Nhưng submissions/contracts
// (quy trình "Phê Duyệt") SNAPSHOT effectiveApprovers NGAY LÚC TẠO, đông cứng vào TỪNG BẢN GHI, không bao
// giờ tính lại; và 7 module khác (docs/carRegs/officeReqs/vppRegistrations/paymentRequests/
// itPriceApprovals/operationOrders) cũng snapshot tương tự vào extraApprovalLayers[].approvers. Đổi
// tên/xoá username không cascade tới các snapshot này khiến chính người được chỉ định duyệt không còn tự
// duyệt được hồ sơ ĐANG PENDING của luồng mình phụ trách.
//
// File này test THUẦN (không cần SQL Server) cho cascadeUsernameChangesToRecordApproverSnapshots()
// (lib/catalogRename.js) — cùng khuôn test-workflowapprover-username-cascade.js, nhưng stub
// renameFieldValueInCollection() bằng 1 mảng in-memory thật (vì hàm mới GỌI tới nó, khác hàm cũ).
//
// Chạy: node server/tests/test-record-approver-snapshot-username-cascade.js
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let STORE;
function resetState() {
  STORE = {
    submissions: [
      { id: 1, status: 'PENDING', effectiveApprovers: { 1: ['nv_old', 'nv2'], 2: ['nv3'] } },
      { id: 2, status: 'PENDING', effectiveApprovers: { 1: ['nv9'] } } // không liên quan, phải giữ nguyên
    ],
    contracts: [
      { id: 10, status: 'PENDING', effectiveApprovers: { 1: ['nv_old'] } }
    ],
    docs: [
      { id: 20, status: 'PENDING', extraApprovalLayers: [
        { layerKey: 'L1', label: 'TGĐ', approvers: ['nv_old'] },
        { layerKey: 'L2', label: 'Thư Ký', approvers: ['nv3'] }
      ] },
      { id: 21, status: 'PENDING' } // không có extraApprovalLayers -> không được đụng
    ],
    carRegs: [
      { id: 30, status: 'PENDING', extraApprovalLayers: [{ layerKey: 'L1', approvers: ['nv_old', 'nv_other'] }] }
    ],
    officeReqs: [
      { id: 40, status: 'PENDING', extraApprovalLayers: [{ layerKey: 'L1', approvers: ['nv_old'] }] }
    ],
    vppRegistrations: [
      { id: 50, status: 'PENDING', extraApprovalLayers: [{ layerKey: 'L1', approvers: ['nv_old'] }] }
    ],
    paymentRequests: [
      { id: 60, status: 'PENDING', extraApprovalLayers: [{ layerKey: 'L1', approvers: ['nv_old'] }] }
    ],
    itPriceApprovals: [
      { id: 70, status: 'PENDING', extraApprovalLayers: [{ layerKey: 'L1', approvers: ['nv_old'] }] }
    ],
    operationOrders: [
      { id: 80, status: 'PENDING', extraApprovalLayers: [{ layerKey: 'L1', approvers: ['nv_old'] }] }
    ]
  };
}
resetState();

stubModule('lib/appData', { withLockedAppDataValue: async (key, fn) => fn(null) });
stubModule('lib/recordStore', {
  // Mirror ĐÚNG hợp đồng của renameFieldValueInCollection() thật (lib/recordStore.js): gọi mutateFn(item)
  // cho MỌI bản ghi, chỉ ghi lại nếu kết quả khác reference ban đầu (bất biến mutateFn phải giữ).
  renameFieldValueInCollection: async (collection, mutateFn) => {
    const list = STORE[collection] || [];
    for (let i = 0; i < list.length; i++) {
      const updated = mutateFn(list[i]);
      if (updated !== list[i]) list[i] = updated;
    }
  }
});

const { cascadeUsernameChangesToRecordApproverSnapshots } = require('../lib/catalogRename');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

async function main() {
  await test('LỖI ĐÃ VÁ: đổi tên "nv_old" -> "nv_new" cascade đúng vào submissions.effectiveApprovers', async () => {
    resetState();
    await cascadeUsernameChangesToRecordApproverSnapshots([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.deepStrictEqual(STORE.submissions[0].effectiveApprovers[1], ['nv_new', 'nv2']);
    assert.deepStrictEqual(STORE.submissions[0].effectiveApprovers[2], ['nv3']);
    assert.deepStrictEqual(STORE.submissions[1].effectiveApprovers[1], ['nv9'], 'bản ghi không liên quan phải giữ nguyên');
  });

  await test('LỖI ĐÃ VÁ: đổi tên cascade đúng vào contracts.effectiveApprovers', async () => {
    resetState();
    await cascadeUsernameChangesToRecordApproverSnapshots([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.deepStrictEqual(STORE.contracts[0].effectiveApprovers[1], ['nv_new']);
  });

  await test('LỖI ĐÃ VÁ: đổi tên cascade đúng vào docs.extraApprovalLayers[].approvers (chỉ layer có username, giữ layer khác)', async () => {
    resetState();
    await cascadeUsernameChangesToRecordApproverSnapshots([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.deepStrictEqual(STORE.docs[0].extraApprovalLayers[0].approvers, ['nv_new']);
    assert.deepStrictEqual(STORE.docs[0].extraApprovalLayers[1].approvers, ['nv3']);
    assert.strictEqual(STORE.docs[1].extraApprovalLayers, undefined, 'bản ghi không có extraApprovalLayers không bị đụng/tạo mới');
  });

  await test('LỖI ĐÃ VÁ: đổi tên cascade đúng vào CẢ 6 module extraApprovalLayers còn lại (carRegs/officeReqs/vppRegistrations/paymentRequests/itPriceApprovals/operationOrders)', async () => {
    resetState();
    await cascadeUsernameChangesToRecordApproverSnapshots([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.deepStrictEqual(STORE.carRegs[0].extraApprovalLayers[0].approvers, ['nv_new', 'nv_other']);
    assert.deepStrictEqual(STORE.officeReqs[0].extraApprovalLayers[0].approvers, ['nv_new']);
    assert.deepStrictEqual(STORE.vppRegistrations[0].extraApprovalLayers[0].approvers, ['nv_new']);
    assert.deepStrictEqual(STORE.paymentRequests[0].extraApprovalLayers[0].approvers, ['nv_new']);
    assert.deepStrictEqual(STORE.itPriceApprovals[0].extraApprovalLayers[0].approvers, ['nv_new']);
    assert.deepStrictEqual(STORE.operationOrders[0].extraApprovalLayers[0].approvers, ['nv_new']);
  });

  await test('LỖI ĐÃ VÁ: xoá vĩnh viễn "nv_old" -> GỠ khỏi effectiveApprovers/extraApprovalLayers (không để lại username "ma")', async () => {
    resetState();
    await cascadeUsernameChangesToRecordApproverSnapshots([], ['nv_old']);
    assert.deepStrictEqual(STORE.submissions[0].effectiveApprovers[1], ['nv2']);
    assert.deepStrictEqual(STORE.contracts[0].effectiveApprovers[1], []);
    assert.deepStrictEqual(STORE.docs[0].extraApprovalLayers[0].approvers, []);
    assert.deepStrictEqual(STORE.carRegs[0].extraApprovalLayers[0].approvers, ['nv_other']);
  });

  await test('username KHÔNG xuất hiện ở bất kỳ bản ghi nào -> không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(STORE);
    await cascadeUsernameChangesToRecordApproverSnapshots([{ oldValue: 'khong_ton_tai', newValue: 'gi_do' }], ['cung_khong_ton_tai']);
    assert.strictEqual(JSON.stringify(STORE), before);
  });

  await test('renamed/deletedUsernames rỗng hoặc thiếu -> không throw, không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(STORE);
    await cascadeUsernameChangesToRecordApproverSnapshots([], []);
    assert.strictEqual(JSON.stringify(STORE), before);
    await cascadeUsernameChangesToRecordApproverSnapshots(undefined, undefined); // không throw = pass
  });

  console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
  if (failed) process.exitCode = 1;
}

main();
