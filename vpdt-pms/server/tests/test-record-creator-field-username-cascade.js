'use strict';

// tests/test-record-creator-field-username-cascade.js
//
// LỖI ĐÃ VÁ (re-audit lần 9, mức Cao — "Cascade username rename/xoá không phủ creator/uploader/
// assignedBy"): 3 cascade username đã có (cascadeUsernameChangesToApprovalGroups/WorkflowApprovers/
// RecordApproverSnapshots) chỉ phủ field QUYẾT ĐỊNH NGƯỜI DUYỆT — hoàn toàn không chạm field "ai TẠO/
// TẢI LÊN hồ sơ" (creator/uploader/author/createdBy/uploaderUsername/referrerUsername tuỳ module, xem
// `creatorField` ở CREATE_MODULE_CONFIGS, lib/createValidation.js), là field QUYẾT ĐỊNH QUYỀN XEM ở rất
// nhiều hàm canView*() CREATOR_ONLY (lib/recordViewScope.js). Đổi username -> mất quyền xem hồ sơ CHÍNH
// MÌNH đã tạo; xoá vĩnh viễn rồi cấp lại đúng username đó cho người khác -> người MỚI thừa kế nhầm
// quyền xem hồ sơ CREATOR_ONLY của người CŨ.
//
// PHẦN A: cascadeUsernameChangesToRecordCreatorFields() (lib/catalogRename.js) — test THUẦN, stub
// renameFieldValueInCollection() bằng mảng in-memory thật (cùng khuôn
// test-record-approver-snapshot-username-cascade.js).
// PHẦN B: cascadeUsernameChangesToTaskAssignedBy() (lib/taskStore.js) — Công Việc (dbo.Tasks) có tầng
// lưu trữ RIÊNG, không đi qua renameFieldValueInCollection() được — giả lập tối thiểu sql.Transaction/
// sql.Request/getPool (khuôn test-record-delete-systemlog.js).
//
// Chạy: node server/tests/test-record-creator-field-username-cascade.js
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

// ===== PHẦN A: cascadeUsernameChangesToRecordCreatorFields() =====

let STORE;
function resetState() {
  STORE = {
    // docs.uploader — module CREATOR_ONLY mặc định, field creatorField='uploader' (KHÁC 'creator').
    docs: [
      { id: 1, status: 'PENDING', uploader: 'nv_old' },
      { id: 2, status: 'PENDING', uploader: 'nv_khac' } // không liên quan, phải giữ nguyên
    ],
    // itSupportTickets.creator — module CREATOR_ONLY, field 'creator'.
    itSupportTickets: [
      { id: 10, status: 'OPEN', creator: 'nv_old' }
    ],
    // itPriceApprovals.creator
    itPriceApprovals: [
      { id: 20, status: 'PENDING', creator: 'nv_old' }
    ],
    // internalPosts.author — field creatorField='author' (KHÁC 'creator').
    internalPosts: [
      { id: 30, status: 'APPROVED', author: 'nv_old' }
    ],
    // paymentRequests.createdBy — field creatorField='createdBy'.
    paymentRequests: [
      { id: 40, status: 'PENDING', createdBy: 'nv_old' }
    ],
    // trainingDocuments.uploaderUsername — field creatorField='uploaderUsername'.
    trainingDocuments: [
      { id: 50, uploaderUsername: 'nv_old' }
    ],
    // recruitmentReferrals.referrerUsername — field creatorField='referrerUsername'.
    recruitmentReferrals: [
      { id: 60, referrerUsername: 'nv_old' }
    ]
  };
}
resetState();

stubModule('lib/recordStore', {
  // Mirror ĐÚNG hợp đồng của renameFieldValueInCollection() thật (lib/recordStore.js): gọi mutateFn(item)
  // cho MỌI bản ghi, chỉ ghi lại nếu kết quả khác reference ban đầu.
  renameFieldValueInCollection: async (collection, mutateFn) => {
    const list = STORE[collection] || [];
    for (let i = 0; i < list.length; i++) {
      const updated = mutateFn(list[i]);
      if (updated !== list[i]) list[i] = updated;
    }
  }
});

const { cascadeUsernameChangesToRecordCreatorFields } = require('../lib/catalogRename');

async function runPartA() {
  await test('LỖI ĐÃ VÁ: đổi tên "nv_old" -> "nv_new" cascade đúng vào docs.uploader (field KHÁC "creator")', async () => {
    resetState();
    await cascadeUsernameChangesToRecordCreatorFields([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.strictEqual(STORE.docs[0].uploader, 'nv_new');
    assert.strictEqual(STORE.docs[1].uploader, 'nv_khac', 'bản ghi không liên quan phải giữ nguyên');
  });

  await test('LỖI ĐÃ VÁ: đổi tên cascade đúng vào itSupportTickets.creator + itPriceApprovals.creator', async () => {
    resetState();
    await cascadeUsernameChangesToRecordCreatorFields([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.strictEqual(STORE.itSupportTickets[0].creator, 'nv_new');
    assert.strictEqual(STORE.itPriceApprovals[0].creator, 'nv_new');
  });

  await test('LỖI ĐÃ VÁ: đổi tên cascade đúng vào CẢ 4 tên field khác nhau còn lại (author/createdBy/uploaderUsername/referrerUsername)', async () => {
    resetState();
    await cascadeUsernameChangesToRecordCreatorFields([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    assert.strictEqual(STORE.internalPosts[0].author, 'nv_new');
    assert.strictEqual(STORE.paymentRequests[0].createdBy, 'nv_new');
    assert.strictEqual(STORE.trainingDocuments[0].uploaderUsername, 'nv_new');
    assert.strictEqual(STORE.recruitmentReferrals[0].referrerUsername, 'nv_new');
  });

  await test('LỖI ĐÃ VÁ: xoá vĩnh viễn "nv_old" -> null hoá creator/uploader/... (gỡ "người tạo", không để lại username "ma" có thể bị tái sử dụng thừa kế)', async () => {
    resetState();
    await cascadeUsernameChangesToRecordCreatorFields([], ['nv_old']);
    assert.strictEqual(STORE.docs[0].uploader, null);
    assert.strictEqual(STORE.docs[1].uploader, 'nv_khac', 'không liên quan, giữ nguyên');
    assert.strictEqual(STORE.itSupportTickets[0].creator, null);
    assert.strictEqual(STORE.internalPosts[0].author, null);
  });

  await test('username KHÔNG xuất hiện ở bất kỳ bản ghi nào -> không đổi gì', async () => {
    resetState();
    const before = JSON.stringify(STORE);
    await cascadeUsernameChangesToRecordCreatorFields([{ oldValue: 'khong_ton_tai', newValue: 'gi_do' }], ['cung_khong_ton_tai']);
    assert.strictEqual(JSON.stringify(STORE), before);
  });

  await test('renamed/deletedUsernames rỗng hoặc thiếu -> không throw, không đổi gì (early-return, không quét 48 collection vô ích)', async () => {
    resetState();
    const before = JSON.stringify(STORE);
    await cascadeUsernameChangesToRecordCreatorFields([], []);
    assert.strictEqual(JSON.stringify(STORE), before);
    await cascadeUsernameChangesToRecordCreatorFields(undefined, undefined); // không throw = pass
  });
}

// ===== PHẦN B: cascadeUsernameChangesToTaskAssignedBy() (dbo.Tasks, tầng lưu trữ riêng) =====

function makeFakeTaskDb(initialTasks) {
  let rows = initialTasks.map(t => ({ Id: t.id, Payload: JSON.stringify(t) }));
  class FakeRequest {
    constructor() { this.inputs = {}; }
    input(name, _type, value) { this.inputs[name] = value; return this; }
    async query(text) {
      const norm = text.replace(/\s+/g, ' ').trim();
      if (norm === 'SELECT Id, Payload FROM dbo.Tasks WITH (UPDLOCK, HOLDLOCK)') {
        return { recordset: rows.map(r => ({ Id: r.Id, Payload: r.Payload })) };
      }
      if (norm === 'UPDATE dbo.Tasks SET Payload = @payload, AssignedBy = @assignedBy WHERE Id = @id') {
        const row = rows.find(r => r.Id === this.inputs.id);
        if (row) row.Payload = this.inputs.payload;
        return { recordset: [] };
      }
      throw new Error('Câu query không mong đợi trong bản giả lập: ' + norm);
    }
  }
  class FakeTransaction {
    async begin() {}
    async commit() {}
    async rollback() {}
  }
  return {
    sql: {
      NVarChar: (n) => ({ type: 'nvarchar', n }), BigInt: { type: 'bigint' }, MAX: 'max',
      Transaction: FakeTransaction, Request: FakeRequest
    },
    getPool: async () => ({}),
    getTasks: () => rows.map(r => JSON.parse(r.Payload))
  };
}

async function runPartB() {
  await test('LỖI ĐÃ VÁ: đổi tên "nv_old" -> "nv_new" cascade đúng vào tasks.assignedBy (tầng lưu trữ riêng dbo.Tasks)', async () => {
    const fakeDb = makeFakeTaskDb([
      { id: 1, assignedTo: 'nv_khac', assignedBy: 'nv_old', status: 'TODO' },
      { id: 2, assignedTo: 'nv_khac', assignedBy: 'nv_khac', status: 'TODO' } // không liên quan
    ]);
    stubModule('db', fakeDb);
    delete require.cache[require.resolve('../lib/taskStore')];
    const { cascadeUsernameChangesToTaskAssignedBy } = require('../lib/taskStore');
    await cascadeUsernameChangesToTaskAssignedBy([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    const tasks = fakeDb.getTasks();
    assert.strictEqual(tasks.find(t => t.id === 1).assignedBy, 'nv_new');
    assert.strictEqual(tasks.find(t => t.id === 1).assignedTo, 'nv_khac', 'assignedTo KHÔNG bị đụng (ngoài phạm vi phát hiện này)');
    assert.strictEqual(tasks.find(t => t.id === 2).assignedBy, 'nv_khac', 'bản ghi không liên quan phải giữ nguyên');
  });

  await test('LỖI ĐÃ VÁ: xoá vĩnh viễn "nv_old" -> null hoá tasks.assignedBy (gỡ "người giao", không suy đoán ai thay thế)', async () => {
    const fakeDb = makeFakeTaskDb([
      { id: 3, assignedTo: 'nv_khac', assignedBy: 'nv_old', status: 'TODO' }
    ]);
    stubModule('db', fakeDb);
    delete require.cache[require.resolve('../lib/taskStore')];
    const { cascadeUsernameChangesToTaskAssignedBy } = require('../lib/taskStore');
    await cascadeUsernameChangesToTaskAssignedBy([], ['nv_old']);
    const tasks = fakeDb.getTasks();
    assert.strictEqual(tasks.find(t => t.id === 3).assignedBy, null);
  });

  await test('Công Việc không liên quan (assignedBy khác) -> không đổi gì, không gọi UPDATE thừa', async () => {
    const fakeDb = makeFakeTaskDb([
      { id: 4, assignedTo: 'nv_khac', assignedBy: 'nv_khong_lien_quan', status: 'TODO' }
    ]);
    stubModule('db', fakeDb);
    delete require.cache[require.resolve('../lib/taskStore')];
    const { cascadeUsernameChangesToTaskAssignedBy } = require('../lib/taskStore');
    const changed = await cascadeUsernameChangesToTaskAssignedBy([{ oldValue: 'nv_old', newValue: 'nv_new' }], ['nv_old_2']);
    assert.strictEqual(changed, 0);
    assert.strictEqual(fakeDb.getTasks()[0].assignedBy, 'nv_khong_lien_quan');
  });
}

async function main() {
  await runPartA();
  await runPartB();
  console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
  if (failed) process.exitCode = 1;
}

main();
