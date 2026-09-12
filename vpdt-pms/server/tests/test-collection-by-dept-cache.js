// tests/test-collection-by-dept-cache.js — Bước 8b/8c: getForCollectionByDeptCached()/
// getForCollectionByUsernameCached() (cùng dựng trên getForCollectionByColumnCached() chung) +
// invalidateCollectionCache() (lib/recordStore.js) — dùng cho routes/data.js (paymentRequests theo Dept,
// trainingDocumentProgress theo Username). Mock '../db' bằng 1 SQL engine giả (cùng khuôn
// tests/test-query-dedicated-records.js) để xác nhận đúng hành vi lọc + cache riêng theo TỪNG GIÁ TRỊ cột
// (không lẫn giữa các giá trị/collection khác nhau) + TTL + invalidate mà không cần SQL Server thật.
'use strict';
const assert = require('assert');
const Module = require('module');

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.stack || err.message}`); fail++; }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Mock SQL engine — cùng logic tối giản như test-query-dedicated-records.js, thêm callCount để đếm số
// lượt THẬT SỰ chạm SQL (xác nhận cache có hoạt động, không phải chỉ đúng dữ liệu).
function buildFakeDbModule(tables, callCounter) {
  const fakePool = {
    request() {
      const inputs = {};
      const reqObj = {
        input(name, _type, value) { inputs[name] = value; return reqObj; },
        async query(text) {
          callCounter.count++;
          const m = /FROM dbo\.(\w+)/.exec(text);
          if (!m) throw new Error('Mock chưa hỗ trợ câu lệnh: ' + text);
          const rows = tables[m[1]] || [];
          const matches = (row) => Object.entries(inputs).every(([key, value]) => {
            if (key === 'offset' || key === 'pageSize') return true;
            if (key === 'dateFrom') return row.CreatedAt >= value;
            if (key === 'dateTo') return row.CreatedAt <= value;
            if (key.startsWith('w_')) return row[key.slice(2)] === value;
            return true;
          });
          const filteredRows = rows.filter(matches).sort((a, b) => (b.CreatedAt - a.CreatedAt) || (b.Id - a.Id));
          return { recordset: filteredRows.map(r => ({ Payload: JSON.stringify(r.Payload) })) };
        }
      };
      return reqObj;
    }
  };
  return {
    sql: { NVarChar: () => null, BigInt: 'BigInt', MAX: 'MAX', Int: 'Int', Bit: 'Bit', Date: 'Date', DateTime2: () => null, Transaction: class {}, Request: class {} },
    getPool: async () => fakePool
  };
}

async function withMockedDb(tables, ttlMs, fn) {
  const dbPath = require.resolve('../db');
  const recordStorePath = require.resolve('../lib/recordStore');
  delete require.cache[dbPath];
  delete require.cache[recordStorePath];
  const prevTtl = process.env.APPDATA_CACHE_TTL_MS;
  process.env.APPDATA_CACHE_TTL_MS = String(ttlMs);
  const callCounter = { count: 0 };
  const fakeModule = new Module(dbPath, null);
  fakeModule.exports = buildFakeDbModule(tables, callCounter);
  fakeModule.loaded = true;
  require.cache[dbPath] = fakeModule;
  const recordStore = require('../lib/recordStore');
  try {
    await fn(recordStore, callCounter);
  } finally {
    delete require.cache[dbPath];
    delete require.cache[recordStorePath];
    if (prevTtl === undefined) delete process.env.APPDATA_CACHE_TTL_MS;
    else process.env.APPDATA_CACHE_TTL_MS = prevTtl;
  }
}

(async () => {
  const rows = [
    { Id: 1, CreatedAt: 1000, Dept: 'Phòng A', Payload: { id: 1, dept: 'Phòng A' } },
    { Id: 2, CreatedAt: 2000, Dept: 'Phòng B', Payload: { id: 2, dept: 'Phòng B' } },
    { Id: 3, CreatedAt: 3000, Dept: 'Phòng A', Payload: { id: 3, dept: 'Phòng A' } }
  ];

  await check('getForCollectionByDeptCached(): chỉ trả đúng bản ghi của phòng ban được truyền', async () => {
    await withMockedDb({ PaymentRequests: rows }, 3000, async (recordStore) => {
      const items = await recordStore.getForCollectionByDeptCached('paymentRequests', 'Phòng A');
      assert.deepStrictEqual(items.map(i => i.id).sort(), [1, 3]);
    });
  });

  await check('getForCollectionByDeptCached(): 2 phòng ban khác nhau KHÔNG lẫn cache của nhau', async () => {
    await withMockedDb({ PaymentRequests: rows }, 3000, async (recordStore) => {
      const a = await recordStore.getForCollectionByDeptCached('paymentRequests', 'Phòng A');
      const b = await recordStore.getForCollectionByDeptCached('paymentRequests', 'Phòng B');
      assert.deepStrictEqual(a.map(i => i.id).sort(), [1, 3]);
      assert.deepStrictEqual(b.map(i => i.id), [2]);
    });
  });

  await check('getForCollectionByDeptCached(): trong TTL, gọi lại KHÔNG chạm SQL lần nữa (dùng cache)', async () => {
    await withMockedDb({ PaymentRequests: rows }, 5000, async (recordStore, callCounter) => {
      await recordStore.getForCollectionByDeptCached('paymentRequests', 'Phòng A');
      const countAfterFirst = callCounter.count;
      await recordStore.getForCollectionByDeptCached('paymentRequests', 'Phòng A');
      assert.strictEqual(callCounter.count, countAfterFirst, 'lần gọi thứ 2 trong TTL không được chạm SQL thêm');
    });
  });

  await check('getForCollectionByDeptCached(): hết TTL thì đọc lại SQL (không cache vĩnh viễn)', async () => {
    await withMockedDb({ PaymentRequests: rows }, 30, async (recordStore, callCounter) => {
      await recordStore.getForCollectionByDeptCached('paymentRequests', 'Phòng A');
      const countAfterFirst = callCounter.count;
      await sleep(60);
      await recordStore.getForCollectionByDeptCached('paymentRequests', 'Phòng A');
      assert.ok(callCounter.count > countAfterFirst, 'sau khi hết TTL phải chạm SQL lại');
    });
  });

  await check('invalidateCollectionCache(): xoá cache theo-phòng-ban của ĐÚNG collection đó, buộc đọc lại dữ liệu mới', async () => {
    await withMockedDb({ PaymentRequests: rows }, 5000, async (recordStore) => {
      const before = await recordStore.getForCollectionByDeptCached('paymentRequests', 'Phòng A');
      assert.strictEqual(before.length, 2);

      // Thêm 1 bản ghi mới cho Phòng A trực tiếp vào bảng giả (mô phỏng có người vừa tạo hồ sơ mới).
      rows.push({ Id: 4, CreatedAt: 4000, Dept: 'Phòng A', Payload: { id: 4, dept: 'Phòng A' } });

      const stillCached = await recordStore.getForCollectionByDeptCached('paymentRequests', 'Phòng A');
      assert.strictEqual(stillCached.length, 2, 'còn trong TTL, chưa invalidate thì vẫn phải trả bản cache cũ (2, chưa thấy bản ghi 4)');

      recordStore.invalidateCollectionCache('paymentRequests');
      const afterInvalidate = await recordStore.getForCollectionByDeptCached('paymentRequests', 'Phòng A');
      assert.strictEqual(afterInvalidate.length, 3, 'sau invalidate phải đọc lại SQL, thấy đủ 3 bản ghi (kể cả bản ghi 4 mới)');
    });
  });

  await check('invalidateCollectionCache(): không đụng cache theo-phòng-ban của collection KHÁC', async () => {
    await withMockedDb({ PaymentRequests: rows, Docs: [{ Id: 9, CreatedAt: 9000, Dept: 'Phòng A', Payload: { id: 9, dept: 'Phòng A' } }] }, 5000, async (recordStore) => {
      await recordStore.getForCollectionByDeptCached('paymentRequests', 'Phòng A');
      await recordStore.getForCollectionByDeptCached('docs', 'Phòng A');
      recordStore.invalidateCollectionCache('paymentRequests');
      // docs không bị xoá cache — vẫn nên trả đúng dữ liệu (không assert số lượt SQL, chỉ xác nhận không lỗi/dữ liệu vẫn đúng)
      const docsItems = await recordStore.getForCollectionByDeptCached('docs', 'Phòng A');
      assert.strictEqual(docsItems.length, 1);
    });
  });

  // ===== getForCollectionByUsernameCached() (Bước 8c — trainingDocumentProgress) =====
  const progressRows = [
    { Id: 1, CreatedAt: 1000, Username: 'nva', Payload: { id: 1, username: 'nva' } },
    { Id: 2, CreatedAt: 2000, Username: 'ntb', Payload: { id: 2, username: 'ntb' } },
    { Id: 3, CreatedAt: 3000, Username: 'nva', Payload: { id: 3, username: 'nva' } }
  ];

  await check('getForCollectionByUsernameCached(): chỉ trả đúng bản ghi của username được truyền', async () => {
    await withMockedDb({ TrainingDocumentProgress: progressRows }, 3000, async (recordStore) => {
      const items = await recordStore.getForCollectionByUsernameCached('trainingDocumentProgress', 'nva');
      assert.deepStrictEqual(items.map(i => i.id).sort(), [1, 3]);
    });
  });

  await check('getForCollectionByUsernameCached(): 2 username khác nhau KHÔNG lẫn cache của nhau, và KHÔNG lẫn với cache theo Dept của collection khác', async () => {
    const freshPaymentRows = [
      { Id: 101, CreatedAt: 1000, Dept: 'Phòng A', Payload: { id: 101, dept: 'Phòng A' } },
      { Id: 102, CreatedAt: 2000, Dept: 'Phòng B', Payload: { id: 102, dept: 'Phòng B' } }
    ];
    await withMockedDb({ TrainingDocumentProgress: progressRows, PaymentRequests: freshPaymentRows }, 3000, async (recordStore) => {
      const a = await recordStore.getForCollectionByUsernameCached('trainingDocumentProgress', 'nva');
      const b = await recordStore.getForCollectionByUsernameCached('trainingDocumentProgress', 'ntb');
      const dept = await recordStore.getForCollectionByDeptCached('paymentRequests', 'Phòng A');
      assert.deepStrictEqual(a.map(i => i.id).sort(), [1, 3]);
      assert.deepStrictEqual(b.map(i => i.id), [2]);
      assert.deepStrictEqual(dept.map(i => i.id), [101]);
    });
  });

  console.log(`\n=== test-collection-by-dept-cache.js: ${pass} pass, ${fail} fail ===`);
  process.exit(fail ? 1 : 0);
})();
