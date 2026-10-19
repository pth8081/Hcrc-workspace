'use strict';

// tests/test-uniformtransfer-requestedby-username-cascade.js
//
// LỖI ĐÃ VÁ (re-audit lần 10, mức Cao — "uniformTransfers.requestedBy không cascade username rename/
// xoá"): uniformTransfers tạo qua route riêng (không qua CREATE_MODULE_CONFIGS) nên field requestedBy
// (ai xin điều chuyển kho Đồng Phục) chưa từng được cascade khi đổi tên/xoá username — phá vỡ chặn tự
// duyệt của assertNotSelfDecidingUniformTransfer() (so transfer.requestedBy === user.username) sau khi
// người yêu cầu đổi tên đăng nhập.
//
// File này test THUẦN (không cần SQL Server) cho cascadeUsernameChangesToUniformTransferRequestedBy()
// (lib/catalogRename.js) — giả lập renameFieldValueInCollection() bằng mảng in-memory thật, cùng khuôn
// test-cardriver-officereqtech-username-cascade.js.
//
// Chạy: node server/tests/test-uniformtransfer-requestedby-username-cascade.js
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
    uniformTransfers: [
      { id: 1, status: 'PENDING_APPROVAL', sourceDept: 'Siêu Thị A', targetDept: 'Siêu Thị B', requestedBy: 'nv_old' },
      { id: 2, status: 'APPROVED', sourceDept: 'Siêu Thị A', targetDept: 'Siêu Thị B', requestedBy: 'nv_khac' }, // không liên quan
      { id: 3, status: 'PENDING_APPROVAL', sourceDept: 'Siêu Thị C', targetDept: 'Siêu Thị D', requestedBy: null } // dữ liệu cũ/bất thường — phải bỏ qua an toàn
    ]
  };
}
resetState();

stubModule('lib/recordStore', {
  renameFieldValueInCollection: async (collection, mutateFn) => {
    STORE[collection] = (STORE[collection] || []).map(mutateFn);
  }
});

const { cascadeUsernameChangesToUniformTransferRequestedBy } = require('../lib/catalogRename');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

async function main() {
  await test('đổi tên "nv_old" -> "nv_new": cascade đúng requestedBy, giữ nguyên bản ghi không liên quan', async () => {
    resetState();
    await cascadeUsernameChangesToUniformTransferRequestedBy([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.strictEqual(STORE.uniformTransfers.find(t => t.id === 1).requestedBy, 'nv_new');
    assert.strictEqual(STORE.uniformTransfers.find(t => t.id === 2).requestedBy, 'nv_khac', 'Bản ghi không liên quan phải giữ nguyên');
  });

  await test('xoá vĩnh viễn "nv_old": null hoá requestedBy (gỡ "người xin điều chuyển", không suy đoán ai thay thế)', async () => {
    resetState();
    await cascadeUsernameChangesToUniformTransferRequestedBy([], ['nv_old']);
    assert.strictEqual(STORE.uniformTransfers.find(t => t.id === 1).requestedBy, null);
    assert.strictEqual(STORE.uniformTransfers.find(t => t.id === 2).requestedBy, 'nv_khac');
  });

  await test('requestedBy = null (dữ liệu cũ/bất thường) -> không đổi gì, không crash', async () => {
    resetState();
    await cascadeUsernameChangesToUniformTransferRequestedBy([{ oldValue: 'nv_old', newValue: 'nv_new' }], ['nv_khac']);
    assert.strictEqual(STORE.uniformTransfers.find(t => t.id === 3).requestedBy, null);
  });

  await test('username KHÔNG xuất hiện ở bất kỳ bản ghi nào -> không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(STORE);
    await cascadeUsernameChangesToUniformTransferRequestedBy([{ oldValue: 'khong_ton_tai', newValue: 'moi' }], ['cung_khong_ton_tai']);
    assert.strictEqual(JSON.stringify(STORE), before);
  });

  await test('renamed/deletedUsernames rỗng hoặc thiếu -> không throw, không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(STORE);
    await cascadeUsernameChangesToUniformTransferRequestedBy([], []);
    await cascadeUsernameChangesToUniformTransferRequestedBy(undefined, undefined);
    assert.strictEqual(JSON.stringify(STORE), before);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
