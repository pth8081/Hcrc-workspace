// server/tests/test-operation-workitem-delete-toctou.js
//
// Rà soát chuyên sâu toàn hệ thống trước go-live (11/2026, mức Trung bình): withLockedWorkItemByIdForDelete()
// (lib/operationWorkItemStore.js) trước đây CHỈ khoá UPDLOCK/HOLDLOCK đúng dòng GỐC đang xoá — danh sách
// con cháu CÙNG NHÁNH (để deleteOperationWorkItem() kiểm "không công việc con nào đã nghiệm thu") vẫn do
// CALLER (routes/records.js) tự đọc qua getWorkItemsBySource() THƯỜNG, KHÔNG khoá, KHÔNG nằm trong cùng
// giao dịch — khe hở TOCTOU: nếu đúng lúc giữa bước đọc con cháu không khoá và câu DELETE cuối cùng, 1
// người KHÁC "Nghiệm thu" 1 công việc con trong CÙNG nhánh và commit trước, bất biến "không xoá được
// công việc đã nghiệm thu" có thể bị vi phạm.
//
// Test THUẦN NODE (không cần SQL Server thật) — giả lập tối thiểu `sql.Transaction`/`sql.Request`/
// `getPool` (khuôn test-operation-workitem-sourceid-schema.js) để xác nhận ĐÚNG hành vi cấu trúc của
// bản vá: (a) có 1 câu SELECT WITH (UPDLOCK, HOLDLOCK) đọc TOÀN BỘ work item cùng SourceType/SourceId
// NGAY TRONG transaction, (b) `computeIdsToDeleteFn` nhận được danh sách đó qua tham số thứ 2, (c) câu
// DELETE chỉ chạy SAU KHI đã đọc xong (đúng thứ tự, không đọc lại), (d) hành vi end-to-end xoá cả nhánh
// (gốc + con cháu) vẫn đúng như trước. Không mô phỏng được race thật giữa 2 transaction song song (cần
// SQL Server thật có khoá hàng thật) — đây là giới hạn đã biết, ghi rõ trong VERSION.md.
//
// Chạy: node server/tests/test-operation-workitem-delete-toctou.js
'use strict';
const assert = require('assert');
const { createRunner, assertEqual } = require('./testHarness');

function makeFakeSqlModule(rows) {
  const calls = [];
  class FakeRequest {
    constructor() { this.inputs = {}; }
    input(name, _type, value) { this.inputs[name] = value; return this; }
    async query(text) {
      calls.push(text.replace(/\s+/g, ' ').trim());
      if (/SELECT Payload FROM dbo\.OperationWorkItems WITH \(UPDLOCK, HOLDLOCK\) WHERE Id = @id/.test(text)) {
        const row = rows.find(r => r.Id === this.inputs.id);
        return { recordset: row ? [{ Payload: JSON.stringify(row.item) }] : [] };
      }
      if (/SELECT Payload FROM dbo\.OperationWorkItems WITH \(UPDLOCK, HOLDLOCK\) WHERE SourceType = @sourceType AND SourceId = @sourceId/.test(text)) {
        const matched = rows.filter(r => r.item.sourceType === this.inputs.sourceType && r.item.sourceId === this.inputs.sourceId);
        return { recordset: matched.map(r => ({ Payload: JSON.stringify(r.item) })) };
      }
      if (/^DELETE FROM dbo\.OperationWorkItems WHERE Id IN/.test(text)) {
        const idsDeleted = Object.values(this.inputs);
        for (const id of idsDeleted) {
          const idx = rows.findIndex(r => r.Id === id);
          if (idx !== -1) rows.splice(idx, 1);
        }
        return { recordset: [] };
      }
      throw new Error('Câu query không mong đợi trong bản giả lập: ' + text);
    }
  }
  class FakeTransaction {
    constructor() { this.committed = false; this.rolledBack = false; }
    async begin() {}
    async commit() { this.committed = true; }
    async rollback() { this.rolledBack = true; }
  }
  return {
    sql: {
      NVarChar: (n) => ({ type: 'nvarchar', n }), BigInt: { type: 'bigint' },
      Transaction: FakeTransaction, Request: FakeRequest
    },
    getPool: async () => ({}),
    calls
  };
}

function stubModule(relPath, exportsObj) {
  const resolved = require.resolve('../' + relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, children: [], paths: [], exports: exportsObj };
}

async function main() {
  const run = createRunner();

  await run.run('withLockedWorkItemByIdForDelete(): đọc TOÀN BỘ work item cùng SourceType/SourceId qua SELECT có UPDLOCK/HOLDLOCK, NGAY TRONG transaction', async () => {
    const rows = [
      { Id: 1, item: { id: 1, sourceType: 'OPERATION_STORE_OPENING', sourceId: 100, status: 'CHUA_BAT_DAU', parentWorkItemId: null } },
      { Id: 2, item: { id: 2, sourceType: 'OPERATION_STORE_OPENING', sourceId: 100, status: 'CHUA_BAT_DAU', parentWorkItemId: 1 } }
    ];
    const fakeDb = makeFakeSqlModule(rows);
    stubModule('db', { getPool: fakeDb.getPool, sql: fakeDb.sql });
    delete require.cache[require.resolve('../lib/operationWorkItemStore')];
    const { withLockedWorkItemByIdForDelete } = require('../lib/operationWorkItemStore');

    let receivedSecondArg = null;
    const { idsDeleted } = await withLockedWorkItemByIdForDelete(1, async (item, allLockedItems) => {
      receivedSecondArg = allLockedItems;
      return [item.id, ...allLockedItems.filter(w => w.parentWorkItemId === item.id).map(w => w.id)];
    });

    assertEqual(idsDeleted.sort().join(','), '1,2', 'phải xoá đúng cả gốc lẫn con');
    assertEqual(Array.isArray(receivedSecondArg), true, 'computeIdsToDeleteFn phải nhận tham số thứ 2 (allLockedItems)');
    assertEqual(receivedSecondArg.length, 2, 'allLockedItems phải gồm đủ cả gốc lẫn con cùng SourceType/SourceId');
    const hasLockedAllQuery = fakeDb.calls.some(c => /WITH \(UPDLOCK, HOLDLOCK\) WHERE SourceType = @sourceType AND SourceId = @sourceId/.test(c));
    assertEqual(hasLockedAllQuery, true, 'phải có câu SELECT khoá UPDLOCK/HOLDLOCK đọc toàn bộ work item cùng nguồn, KHÔNG được đọc không khoá');
  });

  await run.run('withLockedWorkItemByIdForDelete(): thứ tự đúng — đọc khoá XONG rồi mới DELETE, không đọc lại sau DELETE', async () => {
    const rows = [{ Id: 5, item: { id: 5, sourceType: 'OPERATION_REPAIR', sourceId: 200, status: 'CHUA_BAT_DAU', parentWorkItemId: null } }];
    const fakeDb = makeFakeSqlModule(rows);
    stubModule('db', { getPool: fakeDb.getPool, sql: fakeDb.sql });
    delete require.cache[require.resolve('../lib/operationWorkItemStore')];
    const { withLockedWorkItemByIdForDelete } = require('../lib/operationWorkItemStore');

    await withLockedWorkItemByIdForDelete(5, async (item) => [item.id]);

    const idxRootRead = fakeDb.calls.findIndex(c => /WHERE Id = @id/.test(c));
    const idxAllRead = fakeDb.calls.findIndex(c => /WHERE SourceType = @sourceType/.test(c));
    const idxDelete = fakeDb.calls.findIndex(c => /^DELETE FROM/.test(c));
    assert(idxRootRead < idxAllRead, 'phải đọc dòng gốc trước khi đọc toàn bộ cùng nguồn');
    assert(idxAllRead < idxDelete, 'phải đọc khoá toàn bộ cùng nguồn TRƯỚC khi DELETE (không được DELETE dựa trên dữ liệu chưa khoá)');
    assertEqual(fakeDb.calls.filter(c => /WHERE SourceType = @sourceType/.test(c)).length, 1, 'chỉ đọc đúng 1 lần, không đọc lại thừa');
  });

  await run.run('withLockedWorkItemByIdForDelete(): không tìm thấy dòng gốc -> 404, KHÔNG đọc toàn bộ / KHÔNG DELETE gì', async () => {
    const rows = [];
    const fakeDb = makeFakeSqlModule(rows);
    stubModule('db', { getPool: fakeDb.getPool, sql: fakeDb.sql });
    delete require.cache[require.resolve('../lib/operationWorkItemStore')];
    const { withLockedWorkItemByIdForDelete } = require('../lib/operationWorkItemStore');

    await assert.rejects(() => withLockedWorkItemByIdForDelete(999, async () => []), (err) => {
      assertEqual(err.status, 404, 'phải là HttpError 404');
      return true;
    });
    assertEqual(fakeDb.calls.some(c => /WHERE SourceType = @sourceType/.test(c)), false, 'không được đọc toàn bộ cùng nguồn khi dòng gốc không tồn tại');
  });

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
