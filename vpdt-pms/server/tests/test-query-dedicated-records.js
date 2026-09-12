// tests/test-query-dedicated-records.js — Bước 7d: queryDedicatedRecords() (lib/recordStore.js) là hàm
// SQL mới duy nhất trong đợt Bước 7d/7e (lọc theo cột thật + phân trang), CHƯA có phép thử tự động nào
// — mock '../db' bằng 1 SQL engine giả (cùng khuôn tests/test-code-autogen-retry.js) để xác nhận đúng
// hành vi lọc/khoảng ngày/phân trang mà không cần SQL Server thật.
'use strict';
const assert = require('assert');
const Module = require('module');

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.stack || err.message}`); fail++; }
}

// Mock SQL engine tối giản: hiểu đúng shape câu lệnh queryDedicatedRecords() sinh ra
// (SELECT [COUNT(*) AS Total /] Payload FROM dbo.<Table> [WHERE ...] [ORDER BY ... OFFSET ... FETCH ...])
// — áp WHERE bằng cách lọc lại đúng input đã bind theo tên param (không cần hiểu SQL thật, chỉ cần khớp
// đúng input nào ứng với cột nào — suy ra từ tên param "w_<Col>"/"dateFrom"/"dateTo").
function buildFakeDbModule(tables) {
  const fakePool = {
    request() {
      const inputs = {};
      const reqObj = {
        input(name, _type, value) { inputs[name] = value; return reqObj; },
        async query(text) {
          const m = /FROM dbo\.(\w+)/.exec(text);
          if (!m) throw new Error('Mock chưa hỗ trợ câu lệnh: ' + text);
          const tableName = m[1];
          const rows = tables[tableName] || [];

          const matches = (row) => {
            for (const [key, value] of Object.entries(inputs)) {
              if (key === 'offset' || key === 'pageSize') continue;
              if (key === 'dateFrom' && row.CreatedAt < value) return false;
              if (key === 'dateTo' && row.CreatedAt > value) return false;
              if (key.startsWith('w_')) {
                const col = key.slice(2);
                if (row[col] !== value) return false;
              }
            }
            return true;
          };

          const filteredRows = rows.filter(matches).sort((a, b) => (b.CreatedAt - a.CreatedAt) || (b.Id - a.Id));

          if (/^\s*SELECT COUNT\(\*\) AS Total/.test(text)) {
            // Câu lệnh phân trang: 2 SELECT trong 1 batch — trả recordsets[0]=count, recordsets[1]=trang.
            const total = filteredRows.length;
            const offset = inputs.offset || 0;
            const pageSize = inputs.pageSize;
            const page = filteredRows.slice(offset, offset + pageSize);
            return {
              recordsets: [
                [{ Total: total }],
                page.map(r => ({ Payload: JSON.stringify(r.Payload) }))
              ]
            };
          }
          return { recordset: filteredRows.map(r => ({ Payload: JSON.stringify(r.Payload) })) };
        }
      };
      return reqObj;
    }
  };
  return {
    sql: {
      NVarChar: () => null, BigInt: 'BigInt', MAX: 'MAX', Int: 'Int', Bit: 'Bit', Date: 'Date',
      DateTime2: () => null, Transaction: class {}, Request: class {}
    },
    getPool: async () => fakePool
  };
}

async function withMockedDb(tables, fn) {
  const dbPath = require.resolve('../db');
  const recordStorePath = require.resolve('../lib/recordStore');
  delete require.cache[dbPath];
  delete require.cache[recordStorePath];
  const fakeModule = new Module(dbPath, null);
  fakeModule.exports = buildFakeDbModule(tables);
  fakeModule.loaded = true;
  require.cache[dbPath] = fakeModule;
  const recordStore = require('../lib/recordStore');
  try {
    await fn(recordStore);
  } finally {
    delete require.cache[dbPath];
    delete require.cache[recordStorePath];
  }
}

(async () => {
  const baseRows = [
    { Id: 1, CreatedAt: 1000, Dept: 'Phòng A', Status: 'PENDING', Payload: { id: 1, dept: 'Phòng A', status: 'PENDING' } },
    { Id: 2, CreatedAt: 2000, Dept: 'Phòng B', Status: 'APPROVED', Payload: { id: 2, dept: 'Phòng B', status: 'APPROVED' } },
    { Id: 3, CreatedAt: 3000, Dept: 'Phòng A', Status: 'APPROVED', Payload: { id: 3, dept: 'Phòng A', status: 'APPROVED' } },
    { Id: 4, CreatedAt: 4000, Dept: 'Phòng A', Status: 'REJECTED', Payload: { id: 4, dept: 'Phòng A', status: 'REJECTED' } }
  ];

  await check('queryDedicatedRecords(): không truyền where/date -> trả toàn bộ, sắp CreatedAt DESC', async () => {
    await withMockedDb({ Docs: baseRows }, async (recordStore) => {
      const { items, total } = await recordStore.queryDedicatedRecords('docs', {});
      assert.strictEqual(total, 4);
      assert.deepStrictEqual(items.map(i => i.id), [4, 3, 2, 1]);
    });
  });

  await check('queryDedicatedRecords(): lọc where.Dept đúng cột đã khai báo trong DEDICATED_TABLES', async () => {
    await withMockedDb({ Docs: baseRows }, async (recordStore) => {
      const { items, total } = await recordStore.queryDedicatedRecords('docs', { where: { Dept: 'Phòng A' } });
      assert.strictEqual(total, 3);
      assert.ok(items.every(i => i.dept === 'Phòng A'));
    });
  });

  await check('queryDedicatedRecords(): cột KHÔNG khai báo trong schema bị bỏ qua âm thầm (không lỗi, không lọc mù)', async () => {
    await withMockedDb({ Docs: baseRows }, async (recordStore) => {
      const { items, total } = await recordStore.queryDedicatedRecords('docs', { where: { NotARealColumn: 'x', Dept: 'Phòng A' } });
      assert.strictEqual(total, 3); // vẫn lọc đúng theo Dept, bỏ qua field lạ thay vì throw hay trả rỗng
      assert.ok(items.every(i => i.dept === 'Phòng A'));
    });
  });

  await check('queryDedicatedRecords(): dateFrom/dateTo thu hẹp đúng theo CreatedAt', async () => {
    await withMockedDb({ Docs: baseRows }, async (recordStore) => {
      const { items, total } = await recordStore.queryDedicatedRecords('docs', { dateFrom: new Date(1500), dateTo: new Date(3500) });
      assert.strictEqual(total, 2);
      assert.deepStrictEqual(items.map(i => i.id).sort(), [2, 3]);
    });
  });

  await check('queryDedicatedRecords(): phân trang thật (page/pageSize) trả đúng trang + tổng số đúng TRƯỚC khi cắt trang', async () => {
    await withMockedDb({ Docs: baseRows }, async (recordStore) => {
      const r1 = await recordStore.queryDedicatedRecords('docs', { where: { Dept: 'Phòng A' }, page: 1, pageSize: 2 });
      assert.strictEqual(r1.total, 3);
      assert.deepStrictEqual(r1.items.map(i => i.id), [4, 3]);

      const r2 = await recordStore.queryDedicatedRecords('docs', { where: { Dept: 'Phòng A' }, page: 2, pageSize: 2 });
      assert.strictEqual(r2.total, 3);
      assert.deepStrictEqual(r2.items.map(i => i.id), [1]);
    });
  });

  console.log(`\n=== test-query-dedicated-records.js: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
})();
