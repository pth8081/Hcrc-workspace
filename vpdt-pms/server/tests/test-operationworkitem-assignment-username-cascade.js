'use strict';

// tests/test-operationworkitem-assignment-username-cascade.js
//
// LỖI ĐÃ VÁ (re-audit lần 10, mức Cao — "operationWorkItems.assignedTo[]/acceptorUsername không
// cascade username (bảng riêng dbo.OperationWorkItems)"): operationWorkItems lưu ở bảng SQL RIÊNG
// (dbo.OperationWorkItems, qua lib/operationWorkItemStore.js), hoàn toàn bỏ qua
// renameFieldValueInCollection() mà mọi cascade username khác trong lib/catalogRename.js dùng — cùng
// tình trạng với dbo.Tasks (đã có cascade riêng cascadeUsernameChangesToTaskAssignedBy()) nhưng chưa
// từng được vá tương tự cho đúng 2 field quyết định quyền: assignedTo[] (quyền tự cập nhật tiến độ) và
// acceptorUsername (quyền "nghiệm thu").
//
// File này test THUẦN (không cần SQL Server) cho cascadeUsernameChangesToWorkItemAssignment()
// (lib/operationWorkItemStore.js) — giả lập tối thiểu sql.Transaction/sql.Request/getPool, cùng khuôn
// Phần B của test-record-creator-field-username-cascade.js (cascadeUsernameChangesToTaskAssignedBy).
//
// Chạy: node server/tests/test-operationworkitem-assignment-username-cascade.js
const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

function makeFakeWorkItemDb(initialItems) {
  let rows = initialItems.map(it => ({ Id: it.id, Payload: JSON.stringify(it) }));
  class FakeRequest {
    constructor() { this.inputs = {}; }
    input(name, _type, value) { this.inputs[name] = value; return this; }
    async query(text) {
      const norm = text.replace(/\s+/g, ' ').trim();
      if (norm === 'SELECT Id, Payload FROM dbo.OperationWorkItems WITH (UPDLOCK, HOLDLOCK)') {
        return { recordset: rows.map(r => ({ Id: r.Id, Payload: r.Payload })) };
      }
      if (norm === 'UPDATE dbo.OperationWorkItems SET Payload = @payload WHERE Id = @id') {
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
    getItems: () => rows.map(r => JSON.parse(r.Payload))
  };
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

async function main() {
  await test('đổi tên "nv_old" -> "nv_new": cascade đúng assignedTo[] (giữ vị trí trong mảng) + acceptorUsername', async () => {
    const fakeDb = makeFakeWorkItemDb([
      { id: 1, status: 'DANG_THUC_HIEN', assignedTo: ['nv_old', 'nv_khac'], acceptorUsername: 'nv_old', sourceType: 'STORE_OPENING', sourceId: 100 },
      { id: 2, status: 'DANG_THUC_HIEN', assignedTo: ['nv_khac'], acceptorUsername: 'nv_khac', sourceType: 'STORE_OPENING', sourceId: 100 } // không liên quan
    ]);
    stubModule('db', fakeDb);
    delete require.cache[require.resolve('../lib/operationWorkItemStore')];
    const { cascadeUsernameChangesToWorkItemAssignment } = require('../lib/operationWorkItemStore');
    await cascadeUsernameChangesToWorkItemAssignment([{ oldValue: 'nv_old', newValue: 'nv_new' }], []);
    const items = fakeDb.getItems();
    assert.deepStrictEqual(items.find(it => it.id === 1).assignedTo, ['nv_new', 'nv_khac']);
    assert.strictEqual(items.find(it => it.id === 1).acceptorUsername, 'nv_new');
    assert.deepStrictEqual(items.find(it => it.id === 2).assignedTo, ['nv_khac'], 'bản ghi không liên quan phải giữ nguyên');
    assert.strictEqual(items.find(it => it.id === 2).acceptorUsername, 'nv_khac');
  });

  await test('xoá vĩnh viễn "nv_old": gỡ khỏi assignedTo[] + null hoá acceptorUsername (gỡ "người nghiệm thu", không suy đoán ai thay thế)', async () => {
    const fakeDb = makeFakeWorkItemDb([
      { id: 3, status: 'CHO_NGHIEM_THU', assignedTo: ['nv_old', 'nv_khac'], acceptorUsername: 'nv_old', sourceType: 'STORE_REPAIR', sourceId: 200 }
    ]);
    stubModule('db', fakeDb);
    delete require.cache[require.resolve('../lib/operationWorkItemStore')];
    const { cascadeUsernameChangesToWorkItemAssignment } = require('../lib/operationWorkItemStore');
    await cascadeUsernameChangesToWorkItemAssignment([], ['nv_old']);
    const item = fakeDb.getItems().find(it => it.id === 3);
    assert.deepStrictEqual(item.assignedTo, ['nv_khac']);
    assert.strictEqual(item.acceptorUsername, null);
  });

  await test('assignedTo rỗng/thiếu + acceptorUsername null -> không đổi gì, không crash', async () => {
    const fakeDb = makeFakeWorkItemDb([
      { id: 4, status: 'CHUA_BAT_DAU', assignedTo: [], acceptorUsername: null, sourceType: 'STORE_OPENING', sourceId: 100 }
    ]);
    stubModule('db', fakeDb);
    delete require.cache[require.resolve('../lib/operationWorkItemStore')];
    const { cascadeUsernameChangesToWorkItemAssignment } = require('../lib/operationWorkItemStore');
    const changed = await cascadeUsernameChangesToWorkItemAssignment([{ oldValue: 'nv_old', newValue: 'nv_new' }], ['nv_khac']);
    assert.strictEqual(changed, 0);
  });

  await test('username KHÔNG xuất hiện ở bất kỳ work item nào -> không gọi UPDATE thừa (changed=0)', async () => {
    const fakeDb = makeFakeWorkItemDb([
      { id: 5, status: 'DANG_THUC_HIEN', assignedTo: ['nv_khong_lien_quan'], acceptorUsername: 'nv_khong_lien_quan_2', sourceType: 'STORE_OPENING', sourceId: 100 }
    ]);
    stubModule('db', fakeDb);
    delete require.cache[require.resolve('../lib/operationWorkItemStore')];
    const { cascadeUsernameChangesToWorkItemAssignment } = require('../lib/operationWorkItemStore');
    const changed = await cascadeUsernameChangesToWorkItemAssignment([{ oldValue: 'nv_old', newValue: 'nv_new' }], ['nv_old_2']);
    assert.strictEqual(changed, 0);
    const item = fakeDb.getItems()[0];
    assert.deepStrictEqual(item.assignedTo, ['nv_khong_lien_quan']);
    assert.strictEqual(item.acceptorUsername, 'nv_khong_lien_quan_2');
  });

  await test('renamed/deletedUsernames rỗng hoặc thiếu -> return 0 sớm, KHÔNG mở transaction (early-return)', async () => {
    const fakeDb = makeFakeWorkItemDb([{ id: 6, status: 'CHUA_BAT_DAU', assignedTo: ['nv_old'], acceptorUsername: null, sourceType: 'STORE_OPENING', sourceId: 100 }]);
    stubModule('db', fakeDb);
    delete require.cache[require.resolve('../lib/operationWorkItemStore')];
    const { cascadeUsernameChangesToWorkItemAssignment } = require('../lib/operationWorkItemStore');
    const changed = await cascadeUsernameChangesToWorkItemAssignment([], []);
    assert.strictEqual(changed, 0);
    assert.deepStrictEqual(fakeDb.getItems()[0].assignedTo, ['nv_old'], 'không đổi gì vì early-return');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
