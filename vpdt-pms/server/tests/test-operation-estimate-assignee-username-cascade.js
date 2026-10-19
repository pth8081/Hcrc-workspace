'use strict';

// tests/test-operation-estimate-assignee-username-cascade.js
//
// LỖI ĐÃ VÁ (re-audit lần 10, mức TB — "operationStoreOpenings/operationRepairs
// estimateItems[].assignedToUsernames không cascade"): mỗi "danh mục lớn" (estimateItems[], parentId
// rỗng) của hồ sơ Mở Mới/Sửa Chữa (Vận Hành > Siêu Thị) có thể gán 1 mảng assignedToUsernames
// ("Người Phụ Trách danh mục lớn") — mảng này là điều kiện DUY NHẤT cấp quyền XEM cả hồ sơ cho người
// KHÔNG có quyền quản lý/cùng phòng ban nào khác (hasOwnEstimateCategoryInSource(),
// lib/recordViewScope.js) + quyền TẢI FILE đính kèm đúng danh mục đó (lib/fileAuthz.js) — chưa từng
// được cascade khi đổi tên/xoá username.
//
// File này test THUẦN (không cần SQL Server) cho cascadeUsernameChangesToOperationEstimateAssignees()
// (lib/catalogRename.js) — giả lập renameFieldValueInCollection() bằng mảng in-memory thật, cùng khuôn
// test-forwardthreads-username-cascade.js.
//
// Chạy: node server/tests/test-operation-estimate-assignee-username-cascade.js
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
    operationStoreOpenings: [
      {
        id: 1, status: 'PENDING',
        estimateItems: [
          // danh mục lớn (parentId null), 2 người phụ trách — "nv_old" cần cascade, "nv_khac" không liên quan.
          { id: 'e1', parentId: null, content: 'Hạng mục A', assignedToUsernames: ['nv_old', 'nv_khac'], assignedToNames: ['Nguyễn Văn Old', 'Khác'] },
          // danh mục lớn khác, hoàn toàn không liên quan.
          { id: 'e2', parentId: null, content: 'Hạng mục B', assignedToUsernames: ['nv_khac'], assignedToNames: ['Khác'] },
          // danh mục CON (parentId != null) không có field này trong thực tế — giữ nguyên, không crash.
          { id: 'e3', parentId: 'e1', content: 'Hạng mục con A.1' }
        ]
      },
      { id: 2, status: 'PENDING', estimateItems: [] }, // không có danh mục nào — không liên quan, phải giữ nguyên
      { id: 3, status: 'PENDING' } // chưa từng có field estimateItems (bản ghi cũ) — phải bỏ qua an toàn
    ],
    operationRepairs: [
      {
        id: 10, status: 'PENDING',
        estimateItems: [
          { id: 'r1', parentId: null, content: 'Sửa chữa X', assignedToUsernames: ['nv_old'], assignedToNames: ['Nguyễn Văn Old'] }
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

const { cascadeUsernameChangesToOperationEstimateAssignees } = require('../lib/catalogRename');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

async function main() {
  await test('đổi tên "nv_old" -> "nv_new": cascade đúng assignedToUsernames ở CẢ 2 collection, giữ nguyên assignedToNames (tên thật không đổi) + người/danh mục không liên quan', async () => {
    resetState();
    await cascadeUsernameChangesToOperationEstimateAssignees([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    const e1 = STORE.operationStoreOpenings.find(o => o.id === 1).estimateItems.find(it => it.id === 'e1');
    assert.deepStrictEqual(e1.assignedToUsernames, ['nv_new', 'nv_khac']);
    assert.deepStrictEqual(e1.assignedToNames, ['Nguyễn Văn Old', 'Khác'], 'KHÔNG đổi tên hiển thị — tên thật của người đó không đổi khi đổi username');
    const e2 = STORE.operationStoreOpenings.find(o => o.id === 1).estimateItems.find(it => it.id === 'e2');
    assert.deepStrictEqual(e2.assignedToUsernames, ['nv_khac'], 'Danh mục không liên quan phải giữ nguyên');
    const r1 = STORE.operationRepairs.find(o => o.id === 10).estimateItems.find(it => it.id === 'r1');
    assert.deepStrictEqual(r1.assignedToUsernames, ['nv_new']);
  });

  await test('danh mục CON (parentId khác null, không có assignedToUsernames) không bị đụng, không crash', async () => {
    resetState();
    await cascadeUsernameChangesToOperationEstimateAssignees([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    const e3 = STORE.operationStoreOpenings.find(o => o.id === 1).estimateItems.find(it => it.id === 'e3');
    assert.strictEqual(e3.assignedToUsernames, undefined);
  });

  await test('xoá vĩnh viễn "nv_old": gỡ hẳn khỏi CẢ 2 mảng song song (assignedToUsernames/assignedToNames) ở đúng vị trí, giữ nguyên người/danh mục không liên quan', async () => {
    resetState();
    await cascadeUsernameChangesToOperationEstimateAssignees([], ['nv_old']);
    const e1 = STORE.operationStoreOpenings.find(o => o.id === 1).estimateItems.find(it => it.id === 'e1');
    assert.deepStrictEqual(e1.assignedToUsernames, ['nv_khac']);
    assert.deepStrictEqual(e1.assignedToNames, ['Khác']);
    const r1 = STORE.operationRepairs.find(o => o.id === 10).estimateItems.find(it => it.id === 'r1');
    assert.deepStrictEqual(r1.assignedToUsernames, []);
    assert.deepStrictEqual(r1.assignedToNames, []);
    const e2 = STORE.operationStoreOpenings.find(o => o.id === 1).estimateItems.find(it => it.id === 'e2');
    assert.deepStrictEqual(e2.assignedToUsernames, ['nv_khac'], 'Danh mục không liên quan phải giữ nguyên');
  });

  await test('estimateItems rỗng/thiếu -> không đổi gì, không crash', async () => {
    resetState();
    const before2 = JSON.stringify(STORE.operationStoreOpenings.find(o => o.id === 2));
    const before3 = JSON.stringify(STORE.operationStoreOpenings.find(o => o.id === 3));
    await cascadeUsernameChangesToOperationEstimateAssignees([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.strictEqual(JSON.stringify(STORE.operationStoreOpenings.find(o => o.id === 2)), before2);
    assert.strictEqual(JSON.stringify(STORE.operationStoreOpenings.find(o => o.id === 3)), before3);
  });

  await test('username KHÔNG xuất hiện ở bất kỳ danh mục nào -> không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(STORE);
    await cascadeUsernameChangesToOperationEstimateAssignees([{ oldValue: 'khong_ton_tai', newValue: 'moi' }], ['cung_khong_ton_tai']);
    assert.strictEqual(JSON.stringify(STORE), before);
  });

  await test('renamed/deletedUsernames rỗng hoặc thiếu -> không throw, không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(STORE);
    await cascadeUsernameChangesToOperationEstimateAssignees([], []);
    await cascadeUsernameChangesToOperationEstimateAssignees(undefined, undefined);
    assert.strictEqual(JSON.stringify(STORE), before);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
