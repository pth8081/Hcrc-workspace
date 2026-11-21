// tests/test-dsmart-price-notify-retry.js — Test THẬT (không stub lib/dsmartSqlClient.js/lib/
// dsmartStoreFanOutRetryStore.js/lib/dsmartPriceNotify.js như tests/test-dsmart-wholesale-price.js) cho:
//   1. lib/dsmartStoreFanOutRetryStore.js — CRUD hàng đợi tự động thử lại (bảng dbo.DsmartStoreFanOutRetryQueue).
//   2. lib/dsmartSqlClient.js::retryStoreFanOut() — thử lại ĐÚNG 1 thao tác trên ĐÚNG 1 siêu thị.
//   3. jobs/dsmartRetryStoreFanOutQueue.js — xử lý toàn bộ hàng đợi 1 lượt chạy.
//   4. lib/dsmartPriceNotify.js — gửi email thông báo Áp Giá/Xoá Giá thành công (12/2026, theo yêu cầu
//      người dùng "nếu mà khi nào up giá thành công thì nó sẽ gửi email... và có thông báo là siêu thị
//      nào đã được áp giá, siêu thị nào đã được xóa giá").
// Cùng khuôn tests/test-dsmart-store-fanout.js: CHỈ giả lập tầng `mssql` bằng 1 "đa máy chủ" ảo trong bộ
// nhớ (phân biệt theo chữ ký kết nối host:port/database/user) — chạy ĐÚNG mã nguồn thật của mọi lib trên.
//
// Chạy: node server/tests/test-dsmart-price-notify-retry.js
'use strict';
const path = require('path');
const assert = require('assert');

process.env.EMAIL_ENCRYPTION_KEY = 'test-notify-retry-key-khong-dung-production';
process.env.DB_SERVER = 'app-db-host';
process.env.DB_PORT = '1433';
process.env.DB_NAME = 'VPDT_DMS_TEST';
process.env.DB_USER = 'app_user';
process.env.DB_PASSWORD = 'app_pass';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('PASS: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (detail ? '\n      ' + JSON.stringify(detail) : '')); }
}
function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}
function freshRequire(relPath) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  delete require.cache[full];
  return require(full);
}

// ===== "Đa máy chủ" SQL Server ảo — mỗi chữ ký kết nối là 1 CSDL RIÊNG (app / DSmart16 HO / từng siêu
// thị), đúng khuôn tests/test-dsmart-store-fanout.js. =====
const databases = new Map();
function dbKey(cfg) { return `${cfg.server}:${cfg.port}/${cfg.database}/${cfg.user}`; }
function getOrCreateDb(key) {
  if (!databases.has(key)) {
    databases.set(key, {
      csprice: new Map(), skuDef: new Map(), dsmartPriceDbConfig: null, storeConnections: new Map(),
      appData: new Map(), retryQueue: new Map()
    });
  }
  return databases.get(key);
}
let forceConnectFailFor = null;

function dispatchQuery(db, rawText, params) {
  const t = rawText.replace(/\s+/g, ' ').trim();
  if (/FROM dbo\.SKU_DEF WHERE SKU_ID/i.test(t)) {
    const row = db.skuDef.get(params.skuId);
    return { recordset: row ? [row] : [] };
  }
  if (/UPDATE dbo\.CSPRICE\s/i.test(t) && /SET TYPE = '04'/i.test(t)) {
    const key = `${params.custId}|${params.skuId}`;
    if (!db.csprice.has(key)) return { recordset: [] };
    const row = db.csprice.get(key);
    row.WSPRICE = params.price; row.FR_DATE = params.frDate; row.TO_DATE = params.toDate;
    return { recordset: [{ CUST_ID: params.custId, SKU_ID: params.skuId }] };
  }
  if (/INSERT INTO dbo\.CSPRICE/i.test(t)) {
    const key = `${params.custId}|${params.skuId}`;
    db.csprice.set(key, { CUST_ID: params.custId, SKU_ID: params.skuId, WSPRICE: params.price, FR_DATE: params.frDate, TO_DATE: params.toDate });
    return { recordset: [{ CUST_ID: params.custId, SKU_ID: params.skuId }] };
  }
  if (/DELETE FROM dbo\.CSPRICE/i.test(t)) {
    const key = `${params.kCustId}|${params.kSkuId}`;
    if (!db.csprice.has(key)) return { recordset: [] };
    const row = db.csprice.get(key);
    db.csprice.delete(key);
    return { recordset: [{ CUST_ID: row.CUST_ID }] };
  }
  if (/SELECT 1 AS ok/i.test(t)) return { recordset: [{ ok: 1 }] };

  // ---- CSDL app (db.js): dbo.DsmartPriceDbConfig ----
  if (/FROM dbo\.DsmartPriceDbConfig WHERE Id/i.test(t)) return { recordset: db.dsmartPriceDbConfig ? [db.dsmartPriceDbConfig] : [] };
  if (/INSERT INTO dbo\.DsmartPriceDbConfig/i.test(t)) {
    db.dsmartPriceDbConfig = { Id: params.id, Host: params.host, Port: params.port, DatabaseName: params.database, DbUser: params.dbUser, PasswordEnc: params.passwordEnc, AutoDeleteEnabled: !!params.autoDeleteEnabled, AutoDeleteHour: params.autoDeleteHour, AutoDeleteMinute: params.autoDeleteMinute, UpdatedBy: params.updatedBy };
    return { recordset: [] };
  }

  // ---- CSDL app (db.js): dbo.DsmartStorePriceConnections ----
  if (/SELECT \* FROM dbo\.DsmartStorePriceConnections ORDER BY StoreCode/i.test(t)) {
    return { recordset: [...db.storeConnections.values()].sort((a, b) => a.StoreCode.localeCompare(b.StoreCode)) };
  }
  if (/SELECT Id FROM dbo\.DsmartStorePriceConnections WHERE StoreCode = @code AND Id/i.test(t)) {
    const hit = [...db.storeConnections.values()].find(r => r.StoreCode === params.code && r.Id !== params.id);
    return { recordset: hit ? [{ Id: hit.Id }] : [] };
  }
  if (/SELECT Id FROM dbo\.DsmartStorePriceConnections WHERE StoreCode = @code/i.test(t)) {
    const hit = [...db.storeConnections.values()].find(r => r.StoreCode === params.code);
    return { recordset: hit ? [{ Id: hit.Id }] : [] };
  }
  if (/SELECT \* FROM dbo\.DsmartStorePriceConnections WHERE Id = @id/i.test(t)) {
    const row = db.storeConnections.get(params.id);
    return { recordset: row ? [row] : [] };
  }
  if (/INSERT INTO dbo\.DsmartStorePriceConnections/i.test(t)) {
    db.storeConnections.set(params.id, { Id: params.id, StoreCode: params.storeCode, StoreName: params.storeName, Host: params.host, Port: params.port, DatabaseName: params.database, DbUser: params.dbUser, PasswordEnc: params.passwordEnc, Enabled: true, UpdatedBy: params.updatedBy });
    return { recordset: [] };
  }
  if (/UPDATE dbo\.DsmartStorePriceConnections SET/i.test(t)) {
    const row = db.storeConnections.get(params.id);
    Object.assign(row, { StoreCode: params.storeCode, StoreName: params.storeName, Host: params.host, Port: params.port, DatabaseName: params.database, DbUser: params.dbUser, PasswordEnc: params.passwordEnc, Enabled: !!params.enabled });
    return { recordset: [] };
  }
  if (/DELETE FROM dbo\.DsmartStorePriceConnections WHERE Id/i.test(t)) {
    db.storeConnections.delete(params.id);
    return { recordset: [] };
  }

  // ---- CSDL app (db.js): dbo.AppData (lib/dsmartPriceNotify.js đọc emailConfig) ----
  if (/FROM dbo\.AppData WHERE DataKey/i.test(t)) {
    const value = db.appData.get(params.k);
    return { recordset: value === undefined ? [] : [{ DataValue: value }] };
  }

  // ---- CSDL app (db.js): dbo.DsmartStoreFanOutRetryQueue (lib/dsmartStoreFanOutRetryStore.js) ----
  if (/UPDATE dbo\.DsmartStoreFanOutRetryQueue SET\s+StoreCode/i.test(t)) {
    const key = `${params.storeId}|${params.custId}|${params.skuId}|${params.action}`;
    const row = db.retryQueue.get(key);
    if (!row) return { recordset: [], rowsAffected: [0] };
    Object.assign(row, { StoreCode: params.storeCode, StoreName: params.storeName, EntryId: params.entryId, PayloadJson: params.payloadJson, LastError: params.lastError });
    row.Attempts += 1;
    return { recordset: [], rowsAffected: [1] };
  }
  if (/INSERT INTO dbo\.DsmartStoreFanOutRetryQueue/i.test(t)) {
    const key = `${params.storeId}|${params.custId}|${params.skuId}|${params.action}`;
    db.retryQueue.set(key, { Id: params.id, StoreId: params.storeId, StoreCode: params.storeCode, StoreName: params.storeName, Action: params.action, CustId: params.custId, SkuId: params.skuId, EntryId: params.entryId, PayloadJson: params.payloadJson, Attempts: 1, LastError: params.lastError, CreatedAt: new Date() });
    return { recordset: [], rowsAffected: [1] };
  }
  if (/SELECT \* FROM dbo\.DsmartStoreFanOutRetryQueue ORDER BY CreatedAt/i.test(t)) {
    return { recordset: [...db.retryQueue.values()].sort((a, b) => a.CreatedAt - b.CreatedAt) };
  }
  if (/UPDATE dbo\.DsmartStoreFanOutRetryQueue SET Attempts = Attempts \+ 1, LastError = @err/i.test(t)) {
    const row = [...db.retryQueue.values()].find(r => r.Id === params.id);
    if (row) { row.Attempts += 1; row.LastError = params.err; }
    return { recordset: [] };
  }
  if (/DELETE FROM dbo\.DsmartStoreFanOutRetryQueue WHERE Id = @id/i.test(t)) {
    for (const [k, v] of db.retryQueue) if (v.Id === params.id) db.retryQueue.delete(k);
    return { recordset: [] };
  }
  if (/DELETE FROM dbo\.DsmartStoreFanOutRetryQueue WHERE StoreId = @storeId/i.test(t)) {
    for (const [k, v] of db.retryQueue) if (v.StoreId === params.storeId) db.retryQueue.delete(k);
    return { recordset: [] };
  }
  throw new Error('Fake mssql: câu SQL không được hỗ trợ trong test — ' + t.slice(0, 200));
}

class FakeRequest {
  constructor(db) { this.db = db; this.params = {}; }
  input(name, _type, value) { this.params[name] = value; return this; }
  async query(text) { return dispatchQuery(this.db, text, this.params); }
}
class FakeTransaction {
  constructor(pool) { this.pool = pool; }
  async begin() {}
  async commit() {}
  async rollback() {}
  request() { return new FakeRequest(this.pool.db); }
}
class FakeConnectionPool {
  constructor(cfg) { this.cfg = cfg; this.key = dbKey(cfg); this.db = getOrCreateDb(this.key); }
  async connect() {
    if (forceConnectFailFor === this.key) throw new Error('Simulated: mất kết nối mạng');
    return this;
  }
  request() { return new FakeRequest(this.db); }
  async close() {}
}
const fakeMssql = {
  ConnectionPool: FakeConnectionPool, Transaction: FakeTransaction,
  NVarChar: (n) => `NVarChar(${n})`, Int: 'Int', BigInt: 'BigInt', Bit: 'Bit',
  Decimal: (p, s) => `Decimal(${p},${s})`, DateTime: 'DateTime', MAX: -1
};
{
  const mssqlRealPath = require.resolve('mssql');
  require.cache[mssqlRealPath] = { id: mssqlRealPath, filename: mssqlRealPath, path: path.dirname(mssqlRealPath), loaded: true, exports: fakeMssql, children: [], paths: [] };
}

// ===== lib/mailer.js — KHÔNG gửi SMTP thật, chỉ ghi lại lời gọi để test xác nhận nội dung email =====
let SENT_MAILS = [];
let forceSendMailError = false;
stubModule('lib/mailer', {
  sendMail: async ({ to, subject, text, html }) => {
    if (forceSendMailError) throw new Error('Mô phỏng gửi SMTP thất bại');
    SENT_MAILS.push({ to, subject, text, html });
    return { sent: to, failed: [], simulated: false, host: 'fake-smtp' };
  },
  resolveEncryption: () => 'STARTTLS', resolveGraphOption: () => null, resolveEwsOption: () => null
});

let SYSTEM_LOGS = [];
stubModule('lib/systemLogStore', { insertSystemLog: async (entry) => { SYSTEM_LOGS.push(entry); return entry; } });

async function main() {
  freshRequire('db');
  const dsmartPriceConfigStore = freshRequire('lib/dsmartPriceConfigStore');
  const storeConnStore = freshRequire('lib/dsmartStorePriceConnectionsStore');
  const dsmartSqlClient = freshRequire('lib/dsmartSqlClient');
  const retryQueueStore = freshRequire('lib/dsmartStoreFanOutRetryStore');
  const dsmartPriceNotify = freshRequire('lib/dsmartPriceNotify');

  await dsmartPriceConfigStore.saveConfig({
    host: 'ho-dsmart16', port: 1433, database: 'DSMART16', user: 'b2b_price', password: 'ho-pass',
    autoDeleteEnabled: false, autoDeleteHour: 23, autoDeleteMinute: 0
  }, 'tester');
  const skuRow = { PICEUNIT: 'BO ', UNITCONV: 1, TAX_CODE: 'T5' };
  getOrCreateDb(dbKey({ server: 'ho-dsmart16', port: 1433, database: 'DSMART16', user: 'b2b_price' })).skuDef.set('SKU01', skuRow);

  const store1 = await storeConnStore.createStore({ storeCode: 'ST01', storeName: 'Siêu Thị 1', host: 'st01-host', port: 1433, database: 'ST01DB', user: 'st01user', password: 'st01pass' }, 'tester');
  getOrCreateDb(dbKey({ server: 'st01-host', port: 1433, database: 'ST01DB', user: 'st01user' })).skuDef.set('SKU01', skuRow);

  // ===================== 1. lib/dsmartStoreFanOutRetryStore.js — CRUD cơ bản =====================
  {
    await retryQueueStore.enqueue({ storeId: store1.id, storeCode: 'ST01', storeName: 'Siêu Thị 1', action: 'APPLY', custId: 'C1', skuId: 'S1', entryId: 111, payload: { price: 10 }, error: 'Mất mạng' });
    const items = await retryQueueStore.listAll();
    check('enqueue(): tạo mới 1 dòng hàng đợi', items.length === 1 && items[0].storeId === store1.id && items[0].action === 'APPLY' && items[0].attempts === 1, items);

    // Lỗi LẶP LẠI cho CÙNG store+custId+skuId+action -> UPDATE ĐÈ (không tạo dòng thứ 2), Attempts tăng lên.
    await retryQueueStore.enqueue({ storeId: store1.id, storeCode: 'ST01', storeName: 'Siêu Thị 1', action: 'APPLY', custId: 'C1', skuId: 'S1', entryId: 111, payload: { price: 10 }, error: 'Vẫn mất mạng' });
    const itemsAfter = await retryQueueStore.listAll();
    check('enqueue(): lỗi lặp lại CÙNG tổ hợp -> UPDATE ĐÈ, không tạo dòng thứ 2', itemsAfter.length === 1 && itemsAfter[0].attempts === 2 && itemsAfter[0].lastError === 'Vẫn mất mạng', itemsAfter);

    await retryQueueStore.removeById(itemsAfter[0].id);
    check('removeById(): xoá đúng dòng', (await retryQueueStore.listAll()).length === 0);
  }

  // ===================== 2. enqueueFailedStores() — chỉ enqueue đúng siêu thị ok=false =====================
  {
    await retryQueueStore.enqueueFailedStores({
      action: 'DELETE', entryId: 222, custId: 'C2', skuId: 'S2', payload: { dsmartKey: { custId: 'C2', skuId: 'S2' } },
      storeResults: [
        { storeId: store1.id, storeCode: 'ST01', storeName: 'Siêu Thị 1', ok: false, error: 'Mất mạng' },
        { storeId: 9999, storeCode: 'ST02', storeName: 'Siêu Thị 2', ok: true }
      ]
    });
    const items = await retryQueueStore.listAll();
    check('enqueueFailedStores(): CHỈ enqueue siêu thị ok=false (bỏ qua ok=true)', items.length === 1 && items[0].storeId === store1.id && items[0].action === 'DELETE', items);
    await retryQueueStore.removeById(items[0].id);
  }

  // ===================== 3. retryStoreFanOut() — thử lại ĐÚNG 1 thao tác trên ĐÚNG 1 siêu thị =====================
  {
    const result = await dsmartSqlClient.retryStoreFanOut(store1.id, 'APPLY', { custId: 'CRETRY1', skuId: 'SKU01', price: 500, frDate: '2026-01-01', toDate: '2026-12-31' });
    check('retryStoreFanOut(APPLY): thành công, trả đúng storeCode', result.skipped === false && result.storeCode === 'ST01', result);
    const stDb = getOrCreateDb(dbKey({ server: 'st01-host', port: 1433, database: 'ST01DB', user: 'st01user' }));
    check('retryStoreFanOut(APPLY): ghi THẬT xuống CSPRICE của siêu thị', stDb.csprice.has('CRETRY1|SKU01') && stDb.csprice.get('CRETRY1|SKU01').WSPRICE === 500);

    const delResult = await dsmartSqlClient.retryStoreFanOut(store1.id, 'DELETE', { dsmartKey: { custId: 'CRETRY1', skuId: 'SKU01' } });
    check('retryStoreFanOut(DELETE): thành công, xoá THẬT khỏi CSPRICE siêu thị', delResult.skipped === false && !stDb.csprice.has('CRETRY1|SKU01'));

    const skippedResult = await dsmartSqlClient.retryStoreFanOut(888888, 'APPLY', { custId: 'X', skuId: 'Y', price: 1, frDate: '2026-01-01', toDate: '2026-12-31' });
    check('retryStoreFanOut(): siêu thị không tồn tại -> skipped=true, reason=store-deleted', skippedResult.skipped === true && skippedResult.reason === 'store-deleted', skippedResult);

    const store2 = await storeConnStore.createStore({ storeCode: 'ST02', storeName: 'Siêu Thị 2 (Tắt)', host: 'st02-host', port: 1433, database: 'ST02DB', user: 'st02user', password: 'pass2' }, 'tester');
    await storeConnStore.updateStore(store2.id, { storeCode: 'ST02', storeName: 'Siêu Thị 2 (Tắt)', host: 'st02-host', port: 1433, database: 'ST02DB', user: 'st02user', enabled: false }, 'tester');
    const disabledResult = await dsmartSqlClient.retryStoreFanOut(store2.id, 'APPLY', { custId: 'X', skuId: 'Y', price: 1, frDate: '2026-01-01', toDate: '2026-12-31' });
    check('retryStoreFanOut(): siêu thị đã TẮT -> skipped=true, reason=store-disabled', disabledResult.skipped === true && disabledResult.reason === 'store-disabled', disabledResult);
  }

  // ===================== 4. jobs/dsmartRetryStoreFanOutQueue.js — xử lý toàn bộ hàng đợi 1 lượt =====================
  {
    const { runDsmartRetryStoreFanOutQueue } = freshRequire('jobs/dsmartRetryStoreFanOutQueue');
    getOrCreateDb(dbKey({ server: 'app-db-host', port: 1433, database: 'VPDT_DMS_TEST', user: 'app_user' })).appData.set('emailConfig', JSON.stringify({ enabled: true, dsmartPriceNotifyEmails: ['it@hcrc.vn'] }));
    SENT_MAILS = []; SYSTEM_LOGS = [];

    // Dòng 1: sẽ THÀNH CÔNG (siêu thị ST01 đang bật, kết nối tốt).
    await retryQueueStore.enqueue({ storeId: store1.id, storeCode: 'ST01', storeName: 'Siêu Thị 1', action: 'APPLY', custId: 'CJOB1', skuId: 'SKU01', entryId: 1, payload: { custId: 'CJOB1', skuId: 'SKU01', price: 100, frDate: '2026-01-01', toDate: '2026-12-31' }, error: 'Mất mạng (giả lập lần đầu)' });
    // Dòng 2: VẪN LỖI (buộc kết nối thất bại cho store1 lần kế tiếp).
    await retryQueueStore.enqueue({ storeId: store1.id, storeCode: 'ST01', storeName: 'Siêu Thị 1', action: 'DELETE', custId: 'CJOB2', skuId: 'SKU01', entryId: 2, payload: { dsmartKey: { custId: 'CJOB2', skuId: 'SKU01' } }, error: 'Mất mạng (giả lập lần đầu)' });
    // Dòng 3: siêu thị đã bị XOÁ trong lúc chờ -> job phải tự dọn, không lỗi.
    await retryQueueStore.enqueue({ storeId: 777777, storeCode: 'STGHOST', storeName: 'Siêu Thị Ma', action: 'APPLY', custId: 'CJOB3', skuId: 'SKU01', entryId: 3, payload: { custId: 'CJOB3', skuId: 'SKU01', price: 1, frDate: '2026-01-01', toDate: '2026-12-31' }, error: 'x' });

    const beforeItems = await retryQueueStore.listAll();
    assert.strictEqual(beforeItems.length, 3, 'tiền đề: phải có đúng 3 dòng trong hàng đợi trước khi job chạy');

    // Ép dòng 2 (DELETE CJOB2) thất bại thật: payload dsmartKey trỏ tới 1 cặp CHƯA từng có ở ST01 -> deletePriceOnPool
    // trả alreadyGone (KHÔNG lỗi) — vậy để test "vẫn lỗi" thật sự, ép forceConnectFailFor cho đúng chữ ký ST01
    // SAU KHI dòng 1 (APPLY) đã chạy xong (job xử lý tuần tự theo thứ tự enqueue — dòng 1 trước dòng 2).
    // Đơn giản hơn: patch tạm thời getRawById để dòng 2 gặp lỗi SQL thật — ở đây dùng cách trực tiếp: tạm
    // đổi payload dsmartKey thành dạng thiếu trường (ném DsmartSqlError thật từ buildNaturalKeyWhere()).
    const queueNow = await retryQueueStore.listAll();
    const row2 = queueNow.find(it => it.custId === 'CJOB2');
    await retryQueueStore.enqueue({ storeId: row2.storeId, storeCode: row2.storeCode, storeName: row2.storeName, action: 'DELETE', custId: 'CJOB2', skuId: 'SKU01', entryId: 2, payload: { dsmartKey: null }, error: 'reset payload lỗi để ép lỗi thật' });

    const result = await runDsmartRetryStoreFanOutQueue();
    check('job: tổng kết đúng 1 thành công, 1 vẫn lỗi, 1 bỏ qua (siêu thị đã xoá)', result.succeededCount === 1 && result.failedCount === 1 && result.skippedCount === 1, result);

    const afterItems = await retryQueueStore.listAll();
    check('job: chỉ CÒN LẠI đúng dòng vẫn lỗi (CJOB2) trong hàng đợi', afterItems.length === 1 && afterItems[0].custId === 'CJOB2' && afterItems[0].attempts >= 2, afterItems);

    check('job: đã gửi email thông báo đồng bộ bổ sung thành công (CJOB1)', SENT_MAILS.length === 1 && /CJOB1/.test(SENT_MAILS[0].text) && /ST01/.test(SENT_MAILS[0].text), SENT_MAILS);
    check('job: ghi System Log đúng nội dung thành công/lỗi/bỏ qua', SYSTEM_LOGS.some(l => l.actionType === 'RETRY_DSMART_STORE_FANOUT' && /1 thành công/.test(l.description) && /1 vẫn lỗi/.test(l.description) && /1 bỏ qua/.test(l.description)), SYSTEM_LOGS);

    await retryQueueStore.removeById(afterItems[0].id); // dọn sạch cho khối test sau
  }

  // ===================== 5. lib/dsmartPriceNotify.js — gửi email thông báo Áp Giá/Xoá Giá =====================
  const appDb = getOrCreateDb(dbKey({ server: 'app-db-host', port: 1433, database: 'VPDT_DMS_TEST', user: 'app_user' }));
  {
    appDb.appData.set('emailConfig', JSON.stringify({})); // CHƯA cấu hình email nhận nào
    SENT_MAILS = []; SYSTEM_LOGS = [];
    await dsmartPriceNotify.notifyDsmartPriceApplyBatch({ mode: 'MANUAL', actor: 'it1', items: [{ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-12-31', storeResults: [], storeFanOutError: null }] });
    check('notifyDsmartPriceApplyBatch(): CHƯA cấu hình email nhận -> KHÔNG gửi gì, KHÔNG ghi log (tắt mặc định)', SENT_MAILS.length === 0 && SYSTEM_LOGS.length === 0, { SENT_MAILS, SYSTEM_LOGS });
  }
  {
    appDb.appData.set('emailConfig', JSON.stringify({ enabled: true, dsmartPriceNotifyEmails: ['it@hcrc.vn', 'qldh@hcrc.vn'] }));
    SENT_MAILS = []; SYSTEM_LOGS = [];
    await dsmartPriceNotify.notifyDsmartPriceApplyBatch({
      mode: 'MANUAL', actor: 'it1', items: [
        { custId: 'C1', skuId: 'S1', price: 1000, frDate: '2026-01-01', toDate: '2026-12-31', storeResults: [{ storeId: 1, storeCode: 'ST01', storeName: 'Siêu Thị 1', ok: true }, { storeId: 2, storeCode: 'ST02', storeName: 'Siêu Thị 2', ok: false, error: 'Mất mạng' }], storeFanOutError: null }
      ]
    });
    check('notifyDsmartPriceApplyBatch(): đã cấu hình email -> gửi tới ĐÚNG danh sách cấu hình', SENT_MAILS.length === 1 && JSON.stringify(SENT_MAILS[0].to) === JSON.stringify(['it@hcrc.vn', 'qldh@hcrc.vn']), SENT_MAILS);
    check('notifyDsmartPriceApplyBatch(): nội dung nêu rõ siêu thị nào OK/siêu thị nào đang chờ thử lại', /ST01/.test(SENT_MAILS[0].text) && /ST02/.test(SENT_MAILS[0].text) && /chờ kết nối lại/.test(SENT_MAILS[0].text), SENT_MAILS[0].text);
    // (ST01 OK + ST02 lỗi ở trên — cả 2 PHẢI xuất hiện rõ tên trong nội dung, không chỉ số lượng)
    check('notifyDsmartPriceApplyBatch(): subject nêu đúng Mã Khách B2B/Mã Sản Phẩm khi chỉ 1 mục', /C1\/S1/.test(SENT_MAILS[0].subject), SENT_MAILS[0].subject);
    check('notifyDsmartPriceApplyBatch(): ghi System Log SUCCESS', SYSTEM_LOGS.some(l => l.actionType === 'NOTIFY_DSMART_PRICE_APPLIED' && l.status === 'SUCCESS'), SYSTEM_LOGS);
  }
  {
    SENT_MAILS = []; SYSTEM_LOGS = [];
    await dsmartPriceNotify.notifyDsmartPriceDeleteBatch({ mode: 'AUTO', actor: null, items: [{ custId: 'C9', skuId: 'S9', storeResults: [], storeFanOutError: null }] });
    check('notifyDsmartPriceDeleteBatch(): gửi email xoá giá, nêu rõ "tự động" khi mode=AUTO', SENT_MAILS.length === 1 && /tự động/.test(SENT_MAILS[0].text), SENT_MAILS[0]);
    check('notifyDsmartPriceDeleteBatch(): subject chứa đúng C9/S9', /C9\/S9/.test(SENT_MAILS[0].subject), SENT_MAILS[0].subject);
  }
  {
    // Gửi SMTP thất bại -> KHÔNG ném lỗi ra ngoài (không chặn job/route gọi nó), ghi WARNING.
    SENT_MAILS = []; SYSTEM_LOGS = []; forceSendMailError = true;
    await dsmartPriceNotify.notifyDsmartPriceApplyBatch({ mode: 'MANUAL', actor: 'it1', items: [{ custId: 'CF', skuId: 'SF', price: 1, frDate: '2026-01-01', toDate: '2026-12-31', storeResults: [], storeFanOutError: null }] });
    check('notifyDsmartPriceApplyBatch(): gửi SMTP lỗi -> KHÔNG ném lỗi ra ngoài, ghi System Log WARNING', SYSTEM_LOGS.some(l => l.actionType === 'NOTIFY_DSMART_PRICE_APPLIED' && l.status === 'WARNING'), SYSTEM_LOGS);
    forceSendMailError = false;
  }
  {
    // Nhiều mục (>MAX_ITEM_LINES=50) -> email vẫn gửi 1 lần, có dòng "... và X mục khác".
    SENT_MAILS = [];
    const manyItems = Array.from({ length: 55 }, (_, i) => ({ custId: `C${i}`, skuId: `S${i}`, price: 1, frDate: '2026-01-01', toDate: '2026-12-31', storeResults: [], storeFanOutError: null }));
    await dsmartPriceNotify.notifyDsmartPriceApplyBatch({ mode: 'MANUAL', actor: 'it1', items: manyItems });
    check('notifyDsmartPriceApplyBatch(): 55 mục -> GỘP 1 email duy nhất, có dòng "... và X mục khác"', SENT_MAILS.length === 1 && /và 5 mục khác/.test(SENT_MAILS[0].text), SENT_MAILS[0]?.text);
  }
  {
    SENT_MAILS = [];
    await dsmartPriceNotify.notifyDsmartPriceRetryBatch({ items: [{ action: 'APPLY', storeCode: 'ST01', storeName: 'Siêu Thị 1', custId: 'CR1', skuId: 'SR1' }] });
    check('notifyDsmartPriceRetryBatch(): gửi email đồng bộ bổ sung thành công', SENT_MAILS.length === 1 && /ST01/.test(SENT_MAILS[0].text) && /CR1\/SR1/.test(SENT_MAILS[0].text), SENT_MAILS);
  }
  {
    SENT_MAILS = [];
    await dsmartPriceNotify.notifyDsmartPriceApplyBatch({ mode: 'MANUAL', actor: 'it1', items: [] });
    await dsmartPriceNotify.notifyDsmartPriceDeleteBatch({ mode: 'MANUAL', actor: 'it1', items: [] });
    await dsmartPriceNotify.notifyDsmartPriceRetryBatch({ items: [] });
    check('3 hàm notify: items rỗng -> KHÔNG gửi gì (không gọi sendMail)', SENT_MAILS.length === 0);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('LỖI CHẠY TEST:', err); process.exit(1); });
