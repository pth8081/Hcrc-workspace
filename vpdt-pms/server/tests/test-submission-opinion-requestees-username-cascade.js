'use strict';

// tests/test-submission-opinion-requestees-username-cascade.js
//
// LỖI ĐÃ VÁ (re-audit lần 9, mức Thấp — "submissions[].opinionRequestees không cascade username"):
// submissions[].opinionRequestees (mảng username admin gán tay, mời "Xin Ý Kiến" — lớp KHÔNG chặn quy
// trình, blocking:false — xem canViewSubmissionWithoutForward()/canViewSubmission(),
// lib/recordViewScope.js) chưa từng được cascade khi đổi tên/xoá tài khoản, cùng lớp lỗi với
// effectiveApprovers/extraApprovalLayers (đã vá ở cascadeUsernameChangesToRecordApproverSnapshots())
// nhưng bị sót vì opinionRequestees không nằm trong 2 danh sách collection đó.
//
// File này test THUẦN (không cần SQL Server) cho cascadeUsernameChangesToSubmissionOpinionRequestees()
// (lib/catalogRename.js) — giả lập renameFieldValueInCollection() bằng mảng in-memory thật, cùng khuôn
// test-cardriver-officereqtech-username-cascade.js.
//
// Chạy: node server/tests/test-submission-opinion-requestees-username-cascade.js
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
      { id: 1, status: 'PENDING', opinionRequestees: ['ks_old', 'sep_khac'] },
      { id: 2, status: 'PENDING', opinionRequestees: [] }, // không ai được mời — không liên quan
      { id: 3, status: 'APPROVED', opinionRequestees: ['ks_khac'] }, // không liên quan tới username đang đổi
      { id: 4, status: 'PENDING' } // chưa từng có field opinionRequestees (bản ghi cũ) — phải bỏ qua an toàn
    ]
  };
}
resetState();

stubModule('lib/recordStore', {
  renameFieldValueInCollection: async (collection, mutateFn) => {
    STORE[collection] = (STORE[collection] || []).map(mutateFn);
  }
});

const { cascadeUsernameChangesToSubmissionOpinionRequestees } = require('../lib/catalogRename');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

async function main() {
  await test('đổi tên "ks_old" -> "ks_new": cascade đúng vào opinionRequestees, giữ đúng vị trí trong mảng, không đụng bản ghi khác', async () => {
    resetState();
    await cascadeUsernameChangesToSubmissionOpinionRequestees([{ oldValue: 'ks_old', newValue: 'ks_new' }], []);
    assert.deepStrictEqual(STORE.submissions.find(s => s.id === 1).opinionRequestees, ['ks_new', 'sep_khac']);
    assert.deepStrictEqual(STORE.submissions.find(s => s.id === 3).opinionRequestees, ['ks_khac'], 'Bản ghi không liên quan phải giữ nguyên');
    assert.strictEqual(STORE.submissions.find(s => s.id === 4).opinionRequestees, undefined, 'Bản ghi cũ không có field này phải giữ nguyên, không crash');
  });

  await test('xoá vĩnh viễn "ks_old": gỡ khỏi opinionRequestees (KHÔNG xoá cả bản ghi, giữ nguyên username khác trong mảng)', async () => {
    resetState();
    await cascadeUsernameChangesToSubmissionOpinionRequestees([], ['ks_old']);
    assert.deepStrictEqual(STORE.submissions.find(s => s.id === 1).opinionRequestees, ['sep_khac']);
    assert.ok(STORE.submissions.find(s => s.id === 1), 'KHÔNG xoá cả bản ghi, chỉ gỡ username khỏi opinionRequestees');
  });

  await test('mảng opinionRequestees rỗng -> không đổi gì (không tự thêm field thừa)', async () => {
    resetState();
    const before = JSON.stringify(STORE.submissions.find(s => s.id === 2));
    await cascadeUsernameChangesToSubmissionOpinionRequestees([{ oldValue: 'ks_old', newValue: 'ks_new' }], []);
    assert.strictEqual(JSON.stringify(STORE.submissions.find(s => s.id === 2)), before);
  });

  await test('username KHÔNG xuất hiện ở bất kỳ bản ghi nào -> không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(STORE);
    await cascadeUsernameChangesToSubmissionOpinionRequestees([{ oldValue: 'khong_ton_tai', newValue: 'moi' }], ['cung_khong_ton_tai']);
    assert.strictEqual(JSON.stringify(STORE), before);
  });

  await test('renamed/deletedUsernames rỗng hoặc thiếu -> không throw, không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(STORE);
    await cascadeUsernameChangesToSubmissionOpinionRequestees([], []);
    await cascadeUsernameChangesToSubmissionOpinionRequestees(undefined, undefined);
    assert.strictEqual(JSON.stringify(STORE), before);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
