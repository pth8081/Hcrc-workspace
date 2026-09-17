// server/tests/test-dsmart16-sync-overlap.js
//
// Regression test cho lỗi ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026, mức Trung bình) ở
// jobs/operationOrderApiSync.js: trước đây KHÔNG có gì ngăn job cron định kỳ (server.js) và nút
// "🔄 Đồng Bộ Ngay" (force=true, routes/operationOrderApiSync.js) chạy CHỒNG LÊN NHAU — 2 lượt gọi
// syncOperationOrdersToDsmart16() gần như đồng thời đều đọc CÙNG 1 snapshot "candidates = chưa
// dsmart16Synced" (dsmart16Synced chỉ được set=true SAU KHI response.ok — quá muộn để chặn lượt thứ 2
// đã đọc snapshot cũ), khiến cùng 1 đơn hàng bị gửi 2 lần ra hệ thống ngoài dsmart16.
// Đã vá: thêm cờ operationOrderApiConfig.dsmart16SyncInProgress đặt/đọc NGUYÊN TỬ qua withAppLock —
// lượt thứ 2 tự phát hiện lượt đầu đang chạy và bỏ qua (skipped), không gọi fetch() nào cả.
//
// Test này gọi thẳng syncOperationOrdersToDsmart16() thật (jobs/operationOrderApiSync.js) với DB (pool)
// + lib/recordStore + global fetch() đều giả lập, dùng 1 hàng đợi mutex THẬT theo lockKey cho withAppLock
// (mirror đúng khuôn withFakeAppLock() ở các test race condition khác) + 1 cửa sổ "nhường lượt" chèn
// NGAY SAU khi lượt đầu đặt xong cờ dsmart16SyncInProgress (trước khi bắt đầu gọi fetch()), để buộc lượt
// gọi thứ 2 bắn GẦN NHƯ ĐỒNG THỜI (Promise.all) phải thực sự tranh chấp cùng cờ đó thay vì may rủi lịch
// chạy — nếu bản vá bị hoàn tác, test này sẽ FAIL (phát hiện fetch() bị gọi 2 lần cho cùng 1 đơn hàng).
//
// Chạy: node server/tests/test-dsmart16-sync-overlap.js
'use strict';

const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}
function stubCoreModule(name, exportsObj) {
  const full = require.resolve(name);
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

// ===== Hàng đợi mutex THẬT theo lockKey (mirror withFakeAppLock() ở test-payment-source-race.js) =====
const lockChains = new Map();
async function withFakeAppLock(lockKeyOrKeys, fn) {
  const keys = Array.isArray(lockKeyOrKeys) ? lockKeyOrKeys : [lockKeyOrKeys];
  for (const key of keys) {
    const prev = lockChains.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    lockChains.set(key, prev.then(() => current));
    await prev;
    try { return await fn(); } finally { release(); }
  }
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// ===== dbo.AppData giả lập trong bộ nhớ (đúng khuôn getCollection/setCollection thật đọc/ghi) =====
const appDataStore = new Map();
function makeFakePool() {
  return {
    request() {
      const params = {};
      const req = {
        input(name, type, value) { params[name] = value; return req; },
        async query(text) {
          if (/SELECT DataValue/.test(text)) {
            const val = appDataStore.get(params.k);
            return { recordset: val !== undefined ? [{ DataValue: val }] : [] };
          }
          if (/MERGE dbo\.AppData/.test(text)) {
            appDataStore.set(params.k, params.v);
            return { recordset: [] };
          }
          throw new Error('Fake pool: câu lệnh SQL không xác định được — ' + text);
        }
      };
      return req;
    }
  };
}
const fakePool = makeFakePool();

stubCoreModule('dns', {
  promises: {
    lookup: async () => [{ address: '8.8.8.8', family: 4 }]
  }
});
stubModule('db', {
  getPool: async () => fakePool,
  sql: { NVarChar: (n) => ({ type: 'NVarChar', n }), MAX: -1, Int: 'Int', VarChar: (n) => ({ type: 'VarChar', n }) }
});
stubModule('lib/emailCrypto', { decryptSecret: (v) => v });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

let RECORDS = { operationOrders: [] };
const FETCH_DELAY_MS = 40; // đủ lớn để lượt gọi thứ 2 chắc chắn còn kịp bắn TRONG LÚC lượt đầu đang ở giữa vòng lặp fetch().
let fetchCallCount = 0;
const fetchedPoNumbers = [];

stubModule('lib/recordStore', {
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  withLockedRecordById: async (c, id, mutatorFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) throw new Error('Không tìm thấy hồ sơ');
    list[idx] = await mutatorFn(list[idx]);
    return list[idx];
  },
  withAppLock: async (key, fn) => withFakeAppLock(key, fn)
});

global.fetch = async (url, opts) => {
  fetchCallCount++;
  const body = JSON.parse(opts.body);
  fetchedPoNumbers.push(body.poNumber);
  await delay(FETCH_DELAY_MS);
  return { ok: true, status: 200, statusText: 'OK' };
};

const { syncOperationOrdersToDsmart16 } = require('../jobs/operationOrderApiSync');

function resetState() {
  appDataStore.clear();
  appDataStore.set('operationOrderApiConfig', JSON.stringify({
    enabled: true, baseUrl: 'https://dsmart16.example.com/hook', syncIntervalMinutes: 60
  }));
  RECORDS = {
    operationOrders: [
      { id: 1, code: 'DH-001', poNumber: 'PO-OVERLAP-1', dsmart16Synced: false, status: 'RECEIVED' }
    ]
  };
  fetchCallCount = 0;
  fetchedPoNumbers.length = 0;
}

async function main() {
  // ===== Kịch bản 1: 2 lượt gọi gần như đồng thời (cron tick + "Đồng Bộ Ngay") =====
  resetState();
  const [r1, r2] = await Promise.all([
    syncOperationOrdersToDsmart16({ force: true }),
    syncOperationOrdersToDsmart16({ force: true })
  ]);

  check('fetch() CHỈ được gọi ĐÚNG 1 LẦN cho đơn hàng dùng chung (LỖI ĐÃ VÁ — không gửi trùng)',
    fetchCallCount === 1, { fetchCallCount, fetchedPoNumbers, r1, r2 });

  const oneRanOneSkipped = (r1.skipped === true && r2.skipped !== true) || (r2.skipped === true && r1.skipped !== true);
  check('ĐÚNG 1 trong 2 lượt gọi phải bị bỏ qua (skipped) do lượt kia đang chạy',
    oneRanOneSkipped, { r1, r2 });

  const skippedResult = r1.skipped === true ? r1 : r2;
  check('Lượt bị bỏ qua phải có thông báo đúng lý do "đang chạy"',
    /đang chạy/.test(skippedResult.message || ''), skippedResult);

  const ranResult = r1.skipped === true ? r2 : r1;
  check('Lượt thực sự chạy phải báo đồng bộ thành công đúng 1 đơn hàng',
    ranResult.ok === true && ranResult.synced === 1, ranResult);

  check('Cờ dsmart16SyncInProgress phải được dọn về false sau khi xong (không khoá cứng vĩnh viễn)',
    JSON.parse(appDataStore.get('operationOrderApiConfig')).dsmart16SyncInProgress === false,
    appDataStore.get('operationOrderApiConfig'));

  // ===== Kịch bản 2: sau khi lượt 1 đã xong (cờ đã dọn), lượt gọi tiếp theo (không chồng chéo) vẫn chạy
  // bình thường — bản vá không được vô tình khoá cứng LUÔN các lượt về sau. =====
  resetState();
  const r3 = await syncOperationOrdersToDsmart16({ force: true });
  check('Lượt gọi ĐƠN LẺ (không chồng chéo) vẫn đồng bộ bình thường sau khi bản vá thêm cờ khoá',
    r3.ok === true && r3.skipped !== true && r3.synced === 1, r3);
  const r4 = await syncOperationOrdersToDsmart16({ force: true });
  check('Gọi lại lần nữa NGAY SAU đó (đơn đã dsmart16Synced=true) vẫn chạy bình thường, không bị "kẹt" cờ',
    r4.ok === true && r4.skipped !== true && r4.total === 0, r4);

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
