'use strict';

// tests/test-cardriver-officereqtech-username-cascade.js
//
// LỖI ĐÃ VÁ (re-audit lần 9, mức TB — "Cascade rename thiếu carRegs.assignedDriverUsername +
// officeReqs.techAssignedTo(Name)"): carRegs.assignedDriverUsername (tài xế được phân công) và
// officeReqs.techAssignedTo (kỹ thuật viên độc lập xác nhận, chốt lúc tạo/sửa hồ sơ SUA_CHUA) chưa
// từng được cascade khi đổi tên/xoá username — khiến người được phân công mất quyền tự xác nhận hồ sơ
// của chính mình sau khi đổi username, hoặc (xoá vĩnh viễn rồi cấp lại username) người MỚI thừa kế
// nhầm quyền xác nhận của người CŨ.
//
// File này test THUẦN (không cần SQL Server) cho cascadeUsernameChangesToCarDriverAndOfficeReqTech()
// (lib/catalogRename.js) — giả lập renameFieldValueInCollection() bằng mảng in-memory thật, cùng khuôn
// test-record-creator-field-username-cascade.js (Phần A).
//
// Chạy: node server/tests/test-cardriver-officereqtech-username-cascade.js
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
    carRegs: [
      { id: 1, status: 'APPROVED', assignedDriverUsername: 'nv_old', assignedDriver: 'Nguyễn Văn Old' },
      { id: 2, status: 'PENDING', assignedDriverUsername: null }, // chưa phân công — không liên quan, phải giữ nguyên
      { id: 3, status: 'APPROVED', assignedDriverUsername: 'nv_khac', assignedDriver: 'Khác' } // không liên quan
    ],
    officeReqs: [
      { id: 10, subType: 'SUA_CHUA', status: 'PENDING', techAssignedTo: 'nv_old', techAssignedToName: 'Nguyễn Văn Old' },
      { id: 11, subType: 'MUA_BAN', status: 'PENDING', techAssignedTo: null }, // module con khác, không liên quan
      { id: 12, subType: 'SUA_CHUA', status: 'PENDING', techAssignedTo: 'nv_khac', techAssignedToName: 'Khác' }
    ],
    // LỖI ĐÃ VÁ (re-audit lần 10, mức Cao — cùng mục trên): itPriceApprovals.emergencyRejectRequestedBy/
    // applyClaimedBy/appliedBy — field "chỉ định 1 người cụ thể" ad-hoc, chưa từng được cascade.
    itPriceApprovals: [
      { id: 20, status: 'PENDING', emergencyRejectRequestedBy: 'nv_old', emergencyRejectRequestedByName: 'Nguyễn Văn Old', applyClaimedBy: 'nv_old', applyClaimedByName: 'Nguyễn Văn Old', appliedBy: 'nv_old', appliedByName: 'Nguyễn Văn Old' },
      { id: 21, status: 'PENDING', emergencyRejectRequestedBy: null, applyClaimedBy: null, appliedBy: null }, // chưa ai thao tác — không liên quan
      { id: 22, status: 'APPROVED', emergencyRejectRequestedBy: 'nv_khac', applyClaimedBy: 'nv_khac', appliedBy: 'nv_khac' } // không liên quan
    ],
    // itSupportTickets.escalatedBy/approvalApprover — chặn tự duyệt escalation + quyết định ai được
    // approve/deny, cùng chưa từng được cascade.
    itSupportTickets: [
      { id: 30, status: 'OPEN', escalatedBy: 'nv_old', escalatedByName: 'Nguyễn Văn Old', approvalApprover: 'nv_old', approvalApproverName: 'Nguyễn Văn Old' },
      { id: 31, status: 'OPEN', escalatedBy: null, approvalApprover: null }, // chưa escalate — không liên quan
      { id: 32, status: 'OPEN', escalatedBy: 'nv_khac', approvalApprover: 'nv_khac' } // không liên quan
    ]
  };
}
resetState();

stubModule('lib/recordStore', {
  renameFieldValueInCollection: async (collection, mutateFn) => {
    STORE[collection] = (STORE[collection] || []).map(mutateFn);
  }
});

const { cascadeUsernameChangesToCarDriverAndOfficeReqTech } = require('../lib/catalogRename');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

async function main() {
  await test('đổi tên "nv_old" -> "nv_new": cascade đúng assignedDriverUsername (carRegs) + techAssignedTo (officeReqs), giữ nguyên bản ghi không liên quan', async () => {
    resetState();
    await cascadeUsernameChangesToCarDriverAndOfficeReqTech([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.strictEqual(STORE.carRegs.find(r => r.id === 1).assignedDriverUsername, 'nv_new');
    assert.strictEqual(STORE.carRegs.find(r => r.id === 1).assignedDriver, 'Nguyễn Văn Old', 'KHÔNG đổi tên hiển thị (assignedDriver) — chỉ field username');
    assert.strictEqual(STORE.carRegs.find(r => r.id === 3).assignedDriverUsername, 'nv_khac', 'Bản ghi không liên quan phải giữ nguyên');
    assert.strictEqual(STORE.officeReqs.find(r => r.id === 10).techAssignedTo, 'nv_new');
    assert.strictEqual(STORE.officeReqs.find(r => r.id === 10).techAssignedToName, 'Nguyễn Văn Old', 'KHÔNG đổi tên hiển thị (techAssignedToName) — chỉ field username');
    assert.strictEqual(STORE.officeReqs.find(r => r.id === 12).techAssignedTo, 'nv_khac', 'Bản ghi không liên quan phải giữ nguyên');
  });

  await test('LỖI ĐÃ VÁ (re-audit lần 10): đổi tên "nv_old" -> "nv_new" cascade đúng itPriceApprovals.emergencyRejectRequestedBy/applyClaimedBy/appliedBy + itSupportTickets.escalatedBy/approvalApprover, giữ nguyên field *Name hiển thị', async () => {
    resetState();
    await cascadeUsernameChangesToCarDriverAndOfficeReqTech([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    const itPrice = STORE.itPriceApprovals.find(r => r.id === 20);
    assert.strictEqual(itPrice.emergencyRejectRequestedBy, 'nv_new');
    assert.strictEqual(itPrice.applyClaimedBy, 'nv_new');
    assert.strictEqual(itPrice.appliedBy, 'nv_new');
    assert.strictEqual(itPrice.emergencyRejectRequestedByName, 'Nguyễn Văn Old', 'KHÔNG đổi tên hiển thị — chỉ field username');
    assert.strictEqual(STORE.itPriceApprovals.find(r => r.id === 22).emergencyRejectRequestedBy, 'nv_khac', 'Bản ghi không liên quan phải giữ nguyên');
    const ticket = STORE.itSupportTickets.find(r => r.id === 30);
    assert.strictEqual(ticket.escalatedBy, 'nv_new');
    assert.strictEqual(ticket.approvalApprover, 'nv_new');
    assert.strictEqual(ticket.escalatedByName, 'Nguyễn Văn Old', 'KHÔNG đổi tên hiển thị — chỉ field username');
    assert.strictEqual(STORE.itSupportTickets.find(r => r.id === 32).escalatedBy, 'nv_khac', 'Bản ghi không liên quan phải giữ nguyên');
  });

  await test('xoá vĩnh viễn "nv_old": null hoá assignedDriverUsername/techAssignedTo (gỡ người được phân công, không suy đoán ai thay thế)', async () => {
    resetState();
    await cascadeUsernameChangesToCarDriverAndOfficeReqTech([], ['nv_old']);
    assert.strictEqual(STORE.carRegs.find(r => r.id === 1).assignedDriverUsername, null);
    assert.strictEqual(STORE.officeReqs.find(r => r.id === 10).techAssignedTo, null);
    assert.strictEqual(STORE.carRegs.find(r => r.id === 3).assignedDriverUsername, 'nv_khac');
  });

  await test('LỖI ĐÃ VÁ (re-audit lần 10): xoá vĩnh viễn "nv_old": null hoá cả 5 field itPriceApprovals/itSupportTickets', async () => {
    resetState();
    await cascadeUsernameChangesToCarDriverAndOfficeReqTech([], ['nv_old']);
    const itPrice = STORE.itPriceApprovals.find(r => r.id === 20);
    assert.strictEqual(itPrice.emergencyRejectRequestedBy, null);
    assert.strictEqual(itPrice.applyClaimedBy, null);
    assert.strictEqual(itPrice.appliedBy, null);
    const ticket = STORE.itSupportTickets.find(r => r.id === 30);
    assert.strictEqual(ticket.escalatedBy, null);
    assert.strictEqual(ticket.approvalApprover, null);
    assert.strictEqual(STORE.itPriceApprovals.find(r => r.id === 22).emergencyRejectRequestedBy, 'nv_khac', 'Bản ghi không liên quan phải giữ nguyên');
  });

  await test('bản ghi assignedDriverUsername/techAssignedTo = null (chưa phân công) -> không đổi gì, không crash', async () => {
    resetState();
    await cascadeUsernameChangesToCarDriverAndOfficeReqTech([{ oldValue: 'nv_old', newValue: 'nv_new' }], ['nv_khac']);
    assert.strictEqual(STORE.carRegs.find(r => r.id === 2).assignedDriverUsername, null);
    assert.strictEqual(STORE.officeReqs.find(r => r.id === 11).techAssignedTo, null);
    assert.strictEqual(STORE.itPriceApprovals.find(r => r.id === 21).emergencyRejectRequestedBy, null, 'bản ghi chưa ai thao tác -> không đổi gì, không crash');
    assert.strictEqual(STORE.itSupportTickets.find(r => r.id === 31).escalatedBy, null, 'bản ghi chưa escalate -> không đổi gì, không crash');
  });

  await test('username KHÔNG xuất hiện ở bất kỳ bản ghi nào -> không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(STORE);
    await cascadeUsernameChangesToCarDriverAndOfficeReqTech([{ oldValue: 'khong_ton_tai', newValue: 'moi' }], ['cung_khong_ton_tai']);
    assert.strictEqual(JSON.stringify(STORE), before);
  });

  await test('renamed/deletedUsernames rỗng hoặc thiếu -> không throw, không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(STORE);
    await cascadeUsernameChangesToCarDriverAndOfficeReqTech([], []);
    await cascadeUsernameChangesToCarDriverAndOfficeReqTech(undefined, undefined);
    assert.strictEqual(JSON.stringify(STORE), before);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
