'use strict';

// tests/test-record-delete-systemlog.js
//
// LOI DA VA (dot ra soat chuyen sau lan 2 truoc go-live, Dot 5, muc Thap): ~30 collection dung CHUNG 1
// diem xoa (deleteRecordForCollection(), lib/recordStore.js) truoc day KHONG co log chung nao trong Nhat
// Ky He Thong (chi vai route tu them 1 dong insertSystemLog() RIENG cho ly do nghiep vu cu the, VD canh
// bao operationOrders da dong bo dsmart16 o routes/records.js) - con lai HOAN TOAN khong co dau vet "ai
// xoa, luc nao, ho so nao". Them logRecordDelete() (lib/recordStore.js) - ghi 1 dong SystemLogs generic
// tai DUNG 1 diem, tu dong ap dung cho MOI collection qua day, khong can sua tung route rieng le.
//
// Test THUAN (khong can SQL Server thuc, gia lap toi thieu sql.Transaction/sql.Request/getPool - khuon
// tests/test-operation-workitem-delete-toctou.js) cho CA 2 nhanh cua deleteRecordForCollection():
//   1. DEDICATED_TABLES (co Thung Rac) -> moveDedicatedRecordToTrash() -> log voi trashed=true.
//   2. AppData (KHONG co Thung Rac, xoa VINH VIEN) -> log voi trashed=false.
//
// Chay: node server/tests/test-record-delete-systemlog.js
const assert = require('assert');

let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}

function stubModule(relPath, exportsObj) {
  const resolved = require.resolve('../' + relPath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, children: [], paths: [], exports: exportsObj };
}

// Gia lap sql.Transaction/sql.Request toi thieu cho ĐÚNG 3 cau query ma moveDedicatedRecordToTrash() phat
// ra (SELECT Payload/Code WITH UPDLOCK,HOLDLOCK -> INSERT INTO dbo.TrashBin -> DELETE) — khuon
// makeFakeSqlModule() cua test-operation-workitem-delete-toctou.js, rut gon cho dung nhu cau o day.
function makeFakeDb(docsRow) {
  const queries = [];
  class FakeRequest {
    constructor() { this.inputs = {}; }
    input(name, _type, value) { this.inputs[name] = value; return this; }
    async query(text) {
      const norm = text.replace(/\s+/g, ' ').trim();
      queries.push(norm);
      if (/^SELECT Payload, Code FROM dbo\.Docs WITH \(UPDLOCK, HOLDLOCK\) WHERE Id = @id/.test(norm)) {
        return docsRow ? { recordset: [{ Payload: JSON.stringify(docsRow.item), Code: docsRow.code }] } : { recordset: [] };
      }
      if (/^INSERT INTO dbo\.TrashBin/.test(norm)) return { recordset: [] };
      if (/^DELETE FROM dbo\.Docs WHERE Id = @id/.test(norm)) return { recordset: [] };
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
      NVarChar: (n) => ({ type: 'nvarchar', n }), BigInt: { type: 'bigint' }, Bit: { type: 'bit' },
      MAX: 'max',
      Transaction: FakeTransaction, Request: FakeRequest
    },
    getPool: async () => ({}),
    queries
  };
}

function makeLogCapture() {
  const calls = [];
  return {
    calls,
    insertSystemLog: async (payload) => { calls.push(payload); return { id: calls.length }; }
  };
}

async function main() {
  await test('moveDedicatedRecordToTrash(): ghi đúng 1 dòng SystemLogs module=RECORD/actionType=DELETE, mô tả nêu rõ "đã chuyển vào Thùng Rác"', async () => {
    const fakeDb = makeFakeDb({ item: { id: 42, code: 'VB-001', title: 'Tài liệu test' }, code: 'VB-001' });
    const logCapture = makeLogCapture();
    stubModule('db', { getPool: fakeDb.getPool, sql: fakeDb.sql });
    stubModule('lib/systemLogStore', { insertSystemLog: logCapture.insertSystemLog });
    stubModule('lib/appData', { getAppDataValue: async () => null, withLockedAppDataValue: async () => {} });
    stubModule('lib/httpErrors', require('../lib/httpErrors'));
    delete require.cache[require.resolve('../lib/recordStore')];
    const recordStore = require('../lib/recordStore');

    await recordStore.moveRecordToTrash('docs', 42, { username: 'admin1', name: 'Quản Trị Viên' }, null);
    // insertSystemLog() là fire-and-forget (không await bên trong logRecordDelete) — đợi 1 microtask để
    // Promise bên trong chạy xong trước khi assert.
    await new Promise(r => setImmediate(r));

    assert.strictEqual(logCapture.calls.length, 1, 'phải ghi đúng 1 dòng log');
    const log = logCapture.calls[0];
    assert.strictEqual(log.username, 'admin1');
    assert.strictEqual(log.fullName, 'Quản Trị Viên');
    assert.strictEqual(log.module, 'RECORD');
    assert.strictEqual(log.actionType, 'DELETE');
    assert.strictEqual(log.targetObject, 'VB-001');
    assert.ok(log.description.includes('docs'), 'description phải nêu tên collection');
    assert.ok(log.description.includes('42'), 'description phải nêu id');
    assert.ok(log.description.includes('Thùng Rác'), 'description phải nêu rõ đã vào Thùng Rác (khôi phục được)');
    assert.strictEqual(log.status, 'SUCCESS');
  });

  await test('deleteRecordForCollection() nhánh AppData (không có DEDICATED_TABLES entry): ghi log với mô tả "XOÁ VĨNH VIỄN"', async () => {
    const fakeDb = makeFakeDb(null);
    const logCapture = makeLogCapture();
    const fakeList = [{ id: 7, code: 'NHOM-A' }, { id: 9, code: 'NHOM-B' }];
    stubModule('db', { getPool: fakeDb.getPool, sql: fakeDb.sql });
    stubModule('lib/systemLogStore', { insertSystemLog: logCapture.insertSystemLog });
    stubModule('lib/appData', {
      getAppDataValue: async () => fakeList,
      withLockedAppDataValue: async (key, mutatorFn) => { await mutatorFn(fakeList); }
    });
    stubModule('lib/httpErrors', require('../lib/httpErrors'));
    delete require.cache[require.resolve('../lib/recordStore')];
    const recordStore = require('../lib/recordStore');

    // 'khongTonTaiTrongDedicated' không có DEDICATED_TABLES entry lẫn MIGRATED_COLLECTIONS -> rơi về
    // nhánh AppData (xoá thẳng, không Thùng Rác).
    await recordStore.deleteRecordForCollection('khongTonTaiTrongDedicated', 9, null, { username: 'admin2', name: 'Admin Hai' });
    await new Promise(r => setImmediate(r));

    assert.strictEqual(logCapture.calls.length, 1, 'phải ghi đúng 1 dòng log');
    const log = logCapture.calls[0];
    assert.strictEqual(log.username, 'admin2');
    assert.strictEqual(log.targetObject, 'NHOM-B');
    assert.ok(log.description.includes('XOÁ VĨNH VIỄN'), 'description phải nêu rõ xoá vĩnh viễn (không qua Thùng Rác)');
    assert.ok(!log.description.includes('Thùng Rác, có thể'), 'KHÔNG được lẫn mô tả của nhánh có Thùng Rác');
  });

  await test('1 lượt ghi SystemLogs lỗi (VD SQL Server tạm mất kết nối) KHÔNG làm hỏng lượt xoá thật (fire-and-forget)', async () => {
    const fakeDb = makeFakeDb({ item: { id: 55, code: 'VB-055' }, code: 'VB-055' });
    stubModule('db', { getPool: fakeDb.getPool, sql: fakeDb.sql });
    stubModule('lib/systemLogStore', { insertSystemLog: async () => { throw new Error('Mất kết nối SQL Server (giả lập)'); } });
    stubModule('lib/appData', { getAppDataValue: async () => null, withLockedAppDataValue: async () => {} });
    stubModule('lib/httpErrors', require('../lib/httpErrors'));
    delete require.cache[require.resolve('../lib/recordStore')];
    const recordStore = require('../lib/recordStore');

    // Không throw gì ra ngoài — lượt xoá vẫn coi là thành công dù log thất bại.
    await recordStore.moveRecordToTrash('docs', 55, { username: 'admin3', name: 'Admin Ba' }, null);
    await new Promise(r => setImmediate(r));
  });

  console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
  if (failed) process.exitCode = 1;
}

main();
