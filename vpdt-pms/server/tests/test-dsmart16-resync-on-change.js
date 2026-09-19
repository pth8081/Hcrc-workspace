// server/tests/test-dsmart16-resync-on-change.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 3, 9/2026): jobs/operationOrderApiSync.js TRƯỚC ĐÂY chỉ điều kiện
// "dsmart16Synced chưa true" — đơn hàng đồng bộ THÀNH CÔNG 1 lần (thường lúc còn PENDING) thì KHÔNG BAO
// GIỜ đồng bộ lại nữa dù sau đó đổi trạng thái (PENDING -> APPROVED -> RECEIVED, approvedAt/receivedAt
// được gán...) — hệ thống dsmart16 ngoài giữ mãi bản ghi cũ. Nay lưu snapshot payload của lần gửi thành
// công gần nhất (dsmart16SyncedPayload) và tự đồng bộ lại khi nội dung khác, bỏ qua khi y hệt — cùng
// khuôn UPSERT "chỉ ghi lại khi khác" của vendorPurchaseStore.js bulkInsertPurchaseTransactions().
//
// Cùng khuôn giả lập với tests/test-dsmart16-sync-overlap.js (db/lib/recordStore/fetch đều giả lập).
//
// Chạy: node server/tests/test-dsmart16-resync-on-change.js
'use strict';
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}
function stubCoreModule(name, exportsObj) {
  const full = require.resolve(name);
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

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

stubCoreModule('dns', { promises: { lookup: async () => [{ address: '8.8.8.8', family: 4 }] } });
stubModule('db', {
  getPool: async () => fakePool,
  sql: { NVarChar: (n) => ({ type: 'NVarChar', n }), MAX: -1, Int: 'Int', VarChar: (n) => ({ type: 'VarChar', n }) }
});
stubModule('lib/emailCrypto', { decryptSecret: (v) => v });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

let RECORDS = { operationOrders: [] };
let fetchCallCount = 0;
const fetchedPayloads = [];

stubModule('lib/recordStore', {
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  withLockedRecordById: async (c, id, mutatorFn) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) throw new Error('Không tìm thấy hồ sơ');
    list[idx] = await mutatorFn(list[idx]);
    return list[idx];
  },
  withAppLock: async (key, fn) => fn()
});

global.fetch = async (url, opts) => {
  fetchCallCount++;
  fetchedPayloads.push(JSON.parse(opts.body));
  return { ok: true, status: 200, statusText: 'OK' };
};

const { syncOperationOrdersToDsmart16, hasPayloadChangedSinceLastSync, buildSyncPayload } = require('../jobs/operationOrderApiSync');

function resetState(order) {
  appDataStore.clear();
  appDataStore.set('operationOrderApiConfig', JSON.stringify({
    enabled: true, baseUrl: 'https://dsmart16.example.com/hook', syncIntervalMinutes: 60
  }));
  RECORDS = { operationOrders: [order] };
  fetchCallCount = 0;
  fetchedPayloads.length = 0;
}

async function main() {
  // ===== Kịch bản 1: đơn hàng lần đầu đồng bộ (chưa từng gửi) =====
  resetState({ id: 1, code: 'DH-001', poNumber: 'PO-1', dsmart16Synced: false, status: 'PENDING', amount: 1000000 });
  const r1 = await syncOperationOrdersToDsmart16({ force: true });
  check('Lần đầu: đồng bộ thành công đúng 1 đơn', r1.ok === true && r1.synced === 1, r1);
  check('Lần đầu: fetch() được gọi đúng 1 lần', fetchCallCount === 1, fetchCallCount);
  const orderAfter1 = RECORDS.operationOrders[0];
  check('Sau khi đồng bộ: dsmart16Synced=true + có lưu snapshot payload',
    orderAfter1.dsmart16Synced === true && typeof orderAfter1.dsmart16SyncedPayload === 'string', orderAfter1);

  // ===== Kịch bản 2: gọi lại NGAY SAU đó, KHÔNG có gì thay đổi -> không gửi lại =====
  fetchCallCount = 0;
  const r2 = await syncOperationOrdersToDsmart16({ force: true });
  check('Không đổi gì: total=0, không gửi lại (LỖI ĐÃ VÁ vẫn không gây gửi thừa khi thật sự không đổi)',
    r2.ok === true && r2.total === 0 && fetchCallCount === 0, { r2, fetchCallCount });

  // ===== Kịch bản 3: đơn hàng đổi trạng thái PENDING -> APPROVED (đã đồng bộ trước đó) -> phải gửi lại =====
  RECORDS.operationOrders[0].status = 'APPROVED';
  RECORDS.operationOrders[0].approvedAt = '2026-09-19T10:00:00Z';
  fetchCallCount = 0;
  fetchedPayloads.length = 0;
  const r3 = await syncOperationOrdersToDsmart16({ force: true });
  check('LỖI ĐÃ VÁ: đơn đổi trạng thái (PENDING->APPROVED) sau khi đã đồng bộ -> phải TỰ ĐỒNG BỘ LẠI',
    r3.ok === true && r3.synced === 1 && fetchCallCount === 1, { r3, fetchCallCount });
  check('Payload gửi lại phải phản ánh đúng status MỚI (APPROVED)',
    fetchedPayloads[0].status === 'APPROVED', fetchedPayloads[0]);

  // ===== Kịch bản 4: đổi tiếp APPROVED -> RECEIVED -> lại tự gửi lại lần nữa =====
  RECORDS.operationOrders[0].status = 'RECEIVED';
  RECORDS.operationOrders[0].receivedAt = '2026-09-20T08:00:00Z';
  fetchCallCount = 0;
  const r4 = await syncOperationOrdersToDsmart16({ force: true });
  check('Đổi tiếp APPROVED->RECEIVED -> tiếp tục tự đồng bộ lại đúng 1 lần nữa',
    r4.ok === true && r4.synced === 1 && fetchCallCount === 1, { r4, fetchCallCount });

  // ===== Kịch bản 5: hàm thuần hasPayloadChangedSinceLastSync()/buildSyncPayload() — kiểm tra trực tiếp =====
  const synced = { id: 9, code: 'DH-009', poNumber: 'PO-9', status: 'RECEIVED', amount: 5000000, dsmart16Synced: true };
  synced.dsmart16SyncedPayload = JSON.stringify(buildSyncPayload(synced, 'poNumber'));
  check('hasPayloadChangedSinceLastSync(): y hệt snapshot -> false (không cần gửi lại)',
    hasPayloadChangedSinceLastSync(synced, 'poNumber') === false);
  const changed = { ...synced, amount: 6000000 };
  check('hasPayloadChangedSinceLastSync(): amount đổi -> true (cần gửi lại)',
    hasPayloadChangedSinceLastSync(changed, 'poNumber') === true);
  const legacySyncedNoSnapshot = { id: 10, code: 'DH-010', poNumber: 'PO-10', status: 'RECEIVED', dsmart16Synced: true };
  check('hasPayloadChangedSinceLastSync(): đã Synced=true nhưng CHƯA có snapshot (dữ liệu cũ trước bản vá) -> true (gửi lại 1 lần để có snapshot đối chiếu)',
    hasPayloadChangedSinceLastSync(legacySyncedNoSnapshot, 'poNumber') === true);

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
