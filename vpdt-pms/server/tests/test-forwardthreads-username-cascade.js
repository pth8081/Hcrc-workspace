'use strict';

// tests/test-forwardthreads-username-cascade.js
//
// LỖI ĐÃ VÁ (re-audit lần 10, mức Cao — "forwardThreads[].forwardedBy/forwardedTo không cascade
// username (submissions+contracts)"): mỗi node "Chuyển Tiếp Xin Ý Kiến" lưu username THÔ vào
// forwardedBy/forwardedTo, dùng NGUYÊN làm điều kiện duy nhất cấp quyền XEM hồ sơ
// (isForwardThreadParticipant()/sanitizeForwardThreadsForUser(), lib/recordViewScope.js) + quyền TẢI
// FILE đính kèm (lib/fileAuthz.js) — chưa từng được cascade khi đổi tên/xoá username.
//
// File này test THUẦN (không cần SQL Server) cho cascadeUsernameChangesToForwardThreads()
// (lib/catalogRename.js) — giả lập renameFieldValueInCollection() bằng mảng in-memory thật, cùng khuôn
// test-uniformtransfer-requestedby-username-cascade.js.
//
// Chạy: node server/tests/test-forwardthreads-username-cascade.js
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
      {
        id: 1, status: 'PENDING',
        forwardThreads: [
          { id: 'node-1', step: 1, parentNodeId: null, forwardedBy: 'nv_old', forwardedByName: 'Nguyễn Văn Old', forwardedTo: 'ks_old', forwardedToName: 'Kế Toán Old', message: null, reply: null },
          // node CON — parentNodeId tham chiếu theo id (UUID), KHÔNG theo username -> phải còn nguyên sau cascade.
          { id: 'node-2', step: 1, parentNodeId: 'node-1', forwardedBy: 'ks_old', forwardedByName: 'Kế Toán Old', forwardedTo: 'nv_khac', forwardedToName: 'Khác', message: null, reply: null }
        ]
      },
      { id: 2, status: 'APPROVED', forwardThreads: [] }, // không liên quan — mảng rỗng
      { id: 3, status: 'PENDING' } // chưa từng có field forwardThreads (bản ghi cũ) — phải bỏ qua an toàn
    ],
    contracts: [
      {
        id: 10, status: 'PENDING',
        forwardThreads: [
          { id: 'node-10', step: 1, parentNodeId: null, forwardedBy: 'nv_khac', forwardedByName: 'Khác', forwardedTo: 'nv_old', forwardedToName: 'Nguyễn Văn Old', message: null, reply: null }
        ]
      }
    ]
  };
}
resetState();

stubModule('lib/recordStore', {
  renameFieldValueInCollection: async (collection, mutateFn) => {
    STORE[collection] = (STORE[collection] || []).map(mutateFn);
  }
});

const { cascadeUsernameChangesToForwardThreads } = require('../lib/catalogRename');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

async function main() {
  await test('đổi tên "nv_old" -> "nv_new": cascade đúng forwardedBy VÀ forwardedTo ở nhiều node/collection, parentNodeId (theo id, không theo username) không bị đụng', async () => {
    resetState();
    await cascadeUsernameChangesToForwardThreads([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    const sub = STORE.submissions.find(s => s.id === 1);
    assert.strictEqual(sub.forwardThreads[0].forwardedBy, 'nv_new', 'node-1.forwardedBy');
    assert.strictEqual(sub.forwardThreads[0].forwardedTo, 'ks_old', 'node-1.forwardedTo không liên quan, giữ nguyên');
    assert.strictEqual(sub.forwardThreads[1].forwardedBy, 'ks_old', 'node-2.forwardedBy không liên quan, giữ nguyên');
    assert.strictEqual(sub.forwardThreads[1].parentNodeId, 'node-1', 'parentNodeId (tham chiếu theo id) không bị đụng');
    const contract = STORE.contracts.find(c => c.id === 10);
    assert.strictEqual(contract.forwardThreads[0].forwardedTo, 'nv_new', 'contracts cũng được cascade, không chỉ submissions');
  });

  await test('đổi tên: KHÔNG đổi field *Name hiển thị (forwardedByName/forwardedToName) — chỉ field username', async () => {
    resetState();
    await cascadeUsernameChangesToForwardThreads([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.strictEqual(STORE.submissions.find(s => s.id === 1).forwardThreads[0].forwardedByName, 'Nguyễn Văn Old');
  });

  await test('xoá vĩnh viễn "nv_old": null hoá forwardedBy/forwardedTo (gỡ người chuyển tiếp/được chuyển tiếp), NODE VẪN CÒN (không gỡ hẳn, giữ chuỗi parentNodeId cho node con)', async () => {
    resetState();
    await cascadeUsernameChangesToForwardThreads([], ['nv_old']);
    const sub = STORE.submissions.find(s => s.id === 1);
    assert.strictEqual(sub.forwardThreads.length, 2, 'KHÔNG gỡ hẳn node — chỉ null hoá username');
    assert.strictEqual(sub.forwardThreads[0].forwardedBy, null);
    assert.strictEqual(sub.forwardThreads[0].id, 'node-1', 'id node giữ nguyên để node-2.parentNodeId vẫn khớp');
    assert.strictEqual(sub.forwardThreads[1].parentNodeId, 'node-1', 'chuỗi tham chiếu cha-con không bị đứt gãy');
    const contract = STORE.contracts.find(c => c.id === 10);
    assert.strictEqual(contract.forwardThreads[0].forwardedTo, null);
  });

  await test('forwardThreads rỗng/thiếu -> không đổi gì, không crash', async () => {
    resetState();
    const before2 = JSON.stringify(STORE.submissions.find(s => s.id === 2));
    const before3 = JSON.stringify(STORE.submissions.find(s => s.id === 3));
    await cascadeUsernameChangesToForwardThreads([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.strictEqual(JSON.stringify(STORE.submissions.find(s => s.id === 2)), before2);
    assert.strictEqual(JSON.stringify(STORE.submissions.find(s => s.id === 3)), before3);
  });

  await test('username KHÔNG xuất hiện ở bất kỳ node nào -> không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(STORE);
    await cascadeUsernameChangesToForwardThreads([{ oldValue: 'khong_ton_tai', newValue: 'moi' }], ['cung_khong_ton_tai']);
    assert.strictEqual(JSON.stringify(STORE), before);
  });

  await test('renamed/deletedUsernames rỗng hoặc thiếu -> không throw, không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(STORE);
    await cascadeUsernameChangesToForwardThreads([], []);
    await cascadeUsernameChangesToForwardThreads(undefined, undefined);
    assert.strictEqual(JSON.stringify(STORE), before);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
