// tests/test-dsmart-store-fanout.js — Test THẬT (không stub lib/dsmartSqlClient.js như
// test-dsmart-wholesale-price.js) cho tính năng FAN-OUT xuống TỪNG siêu thị (12/2026, theo yêu cầu
// người dùng "tôi muốn cài đặt giá đến tận máy chủ db của siêu thị... khi tôi thay đổi như xóa, sửa nó
// cũng truyền xuống tất cả các siêu thị"). Chạy đúng mã nguồn thật của lib/dsmartSqlClient.js (fan-out,
// upsertPriceOnPool/updatePriceOnPool/deletePriceOnPool) + lib/dsmartStorePriceConnectionsStore.js (CRUD
// + mã hoá mật khẩu) — CHỈ giả lập tầng `mssql` (ConnectionPool/Transaction) bằng 1 "đa máy chủ" ảo
// trong bộ nhớ, phân biệt theo chữ ký kết nối (host:port/database/user) — đúng mô hình thật: CSDL app
// (db.js), DSmart16 Trung Tâm (HO), và MỖI siêu thị đều là 1 SQL Server HOÀN TOÀN RIÊNG BIỆT.
//
// Chạy: node server/tests/test-dsmart-store-fanout.js
'use strict';
const path = require('path');
const assert = require('assert');

process.env.EMAIL_ENCRYPTION_KEY = 'test-fanout-key-khong-dung-production';

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

// ===== "Đa máy chủ" SQL Server ảo — mỗi chữ ký kết nối (host:port/database/user) là 1 CSDL HOÀN TOÀN
// RIÊNG, đúng mô hình thật (app DB / DSmart16 HO / từng siêu thị không hề chia sẻ dữ liệu với nhau). =====
const databases = new Map();
function dbKey(cfg) { return `${cfg.server}:${cfg.port}/${cfg.database}/${cfg.user}`; }
function getOrCreateDb(key) {
  if (!databases.has(key)) {
    databases.set(key, {
      csprice: new Map(), skuDef: new Map(),
      dsmartPriceDbConfig: null,
      storeConnections: new Map()
    });
  }
  return databases.get(key);
}
let forceConnectFailFor = null; // key chữ ký kết nối sẽ giả lập connect() thất bại (mô phỏng mất mạng)

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
  if (/UPDATE dbo\.CSPRICE\s/i.test(t) && /@newPrice/i.test(t)) {
    const key = `${params.kCustId}|${params.kSkuId}`;
    if (!db.csprice.has(key)) return { recordset: [] };
    const row = db.csprice.get(key);
    row.WSPRICE = params.newPrice; row.FR_DATE = params.newFrDate; row.TO_DATE = params.newToDate;
    return { recordset: [{ CUST_ID: params.kCustId, SKU_ID: params.kSkuId }] };
  }
  if (/DELETE FROM dbo\.CSPRICE/i.test(t)) {
    const key = `${params.kCustId}|${params.kSkuId}`;
    if (!db.csprice.has(key)) return { recordset: [] };
    const row = db.csprice.get(key);
    db.csprice.delete(key);
    return { recordset: [{ CUST_ID: row.CUST_ID }] };
  }
  // custIdExistsInCsprice() — từ UPDATE+OUTPUT đổi sang SELECT thuần (12/2026, xem lib/dsmartSqlClient.js
  // + test-dsmart-natural-key-matching.js) sau khi tài khoản DSmart được GRANT thêm quyền SELECT trên
  // CSPRICE ở cả Trung Tâm và từng siêu thị — giữ nhánh mock khớp đúng câu lệnh hiện hành cho đồng bộ,
  // dù chưa có test nào trong file này gọi trực tiếp custIdExistsInCsprice() qua fan-out.
  if (/^SELECT TOP \(1\) CUST_ID FROM dbo\.CSPRICE WHERE CUST_ID = @custId/i.test(t)) {
    const match = [...db.csprice.values()].find(r => r.CUST_ID === params.custId);
    return { recordset: match ? [{ CUST_ID: match.CUST_ID }] : [] };
  }
  if (/SELECT 1 AS ok/i.test(t)) return { recordset: [{ ok: 1 }] };

  // ---- CSDL app (db.js): dbo.DsmartPriceDbConfig (Id=1 cố định) ----
  if (/FROM dbo\.DsmartPriceDbConfig WHERE Id/i.test(t)) {
    return { recordset: db.dsmartPriceDbConfig ? [db.dsmartPriceDbConfig] : [] };
  }
  if (/INSERT INTO dbo\.DsmartPriceDbConfig/i.test(t)) {
    db.dsmartPriceDbConfig = {
      Id: params.id, Host: params.host, Port: params.port, DatabaseName: params.database, DbUser: params.dbUser,
      PasswordEnc: params.passwordEnc, AutoDeleteEnabled: !!params.autoDeleteEnabled,
      AutoDeleteHour: params.autoDeleteHour, AutoDeleteMinute: params.autoDeleteMinute, UpdatedBy: params.updatedBy
    };
    return { recordset: [] };
  }
  if (/UPDATE dbo\.DsmartPriceDbConfig SET/i.test(t)) {
    Object.assign(db.dsmartPriceDbConfig, {
      Host: params.host, Port: params.port, DatabaseName: params.database, DbUser: params.dbUser,
      PasswordEnc: params.passwordEnc, AutoDeleteEnabled: !!params.autoDeleteEnabled,
      AutoDeleteHour: params.autoDeleteHour, AutoDeleteMinute: params.autoDeleteMinute, UpdatedBy: params.updatedBy
    });
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
    db.storeConnections.set(params.id, {
      Id: params.id, StoreCode: params.storeCode, StoreName: params.storeName, Host: params.host, Port: params.port,
      DatabaseName: params.database, DbUser: params.dbUser, PasswordEnc: params.passwordEnc, Enabled: true, UpdatedBy: params.updatedBy
    });
    return { recordset: [] };
  }
  if (/UPDATE dbo\.DsmartStorePriceConnections SET/i.test(t)) {
    const row = db.storeConnections.get(params.id);
    Object.assign(row, {
      StoreCode: params.storeCode, StoreName: params.storeName, Host: params.host, Port: params.port,
      DatabaseName: params.database, DbUser: params.dbUser, PasswordEnc: params.passwordEnc, Enabled: !!params.enabled
    });
    return { recordset: [] };
  }
  if (/DELETE FROM dbo\.DsmartStorePriceConnections WHERE Id/i.test(t)) {
    db.storeConnections.delete(params.id);
    return { recordset: [] };
  }
  throw new Error('Fake mssql: câu SQL không được hỗ trợ trong test — ' + t.slice(0, 160));
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
// require.resolve('mssql') từ bất kỳ file nào trong server/ đều trỏ về CÙNG 1 đường dẫn thật trong
// node_modules — stub đúng đường dẫn đó (không qua alias 'mssql' vì stubModule() cần path thật).
{
  const mssqlRealPath = require.resolve('mssql');
  require.cache[mssqlRealPath] = { id: mssqlRealPath, filename: mssqlRealPath, path: path.dirname(mssqlRealPath), loaded: true, exports: fakeMssql, children: [], paths: [] };
}

process.env.DB_SERVER = 'app-db-host';
process.env.DB_PORT = '1433';
process.env.DB_NAME = 'VPDT_DMS_TEST';
process.env.DB_USER = 'app_user';
process.env.DB_PASSWORD = 'app_pass';

async function main() {
  freshRequire('db');
  const dsmartPriceConfigStore = freshRequire('lib/dsmartPriceConfigStore');
  const storeConnStore = freshRequire('lib/dsmartStorePriceConnectionsStore');
  const dsmartSqlClient = freshRequire('lib/dsmartSqlClient');

  // ===== Cấu hình DSmart16 Trung Tâm (HO) =====
  await dsmartPriceConfigStore.saveConfig({
    host: 'ho-dsmart16', port: 1433, database: 'DSMART16', user: 'b2b_price', password: 'ho-pass',
    autoDeleteEnabled: false, autoDeleteHour: 23, autoDeleteMinute: 0
  }, 'tester');

  // Seed SKU_DEF ở CẢ HO lẫn các siêu thị (mỗi CSDL độc lập, phải seed riêng từng nơi — đúng thực tế mỗi
  // siêu thị có catalog riêng, thường đã đồng bộ sẵn qua cơ chế khác của DSmart).
  const skuRow = { PICEUNIT: 'BO ', UNITCONV: 1, TAX_CODE: 'T5' };
  getOrCreateDb(dbKey({ server: 'ho-dsmart16', port: 1433, database: 'DSMART16', user: 'b2b_price' })).skuDef.set('SKU01', skuRow);

  // ===== Chưa cấu hình siêu thị nào -> fan-out trả storeResults rỗng, KHÔNG lỗi, KHÔNG chặn ghi HO =====
  {
    const result = await dsmartSqlClient.insertWholesalePrice({ custId: 'CUST01', skuId: 'SKU01', price: 1000, frDate: '2026-01-01', toDate: '2026-12-31' });
    check('Chưa cấu hình siêu thị nào -> vẫn ghi HO thành công, storeResults rỗng', result.storeResults.length === 0 && !result.storeFanOutError, result);
  }

  // ===== Thêm 2 siêu thị (ST01 bật, ST02 tắt) =====
  const st01 = await storeConnStore.createStore({ storeCode: 'ST01', storeName: 'Siêu Thị 01', host: 'store01-host', port: 1433, database: 'CSDL_ST01', user: 'st01_user', password: 'st01-pass' }, 'tester');
  const st02 = await storeConnStore.createStore({ storeCode: 'ST02', storeName: 'Siêu Thị 02', host: 'store02-host', port: 1433, database: 'CSDL_ST02', user: 'st02_user', password: 'st02-pass' }, 'tester');
  await storeConnStore.updateStore(st02.id, { storeCode: 'ST02', storeName: 'Siêu Thị 02', host: 'store02-host', port: 1433, database: 'CSDL_ST02', user: 'st02_user', enabled: false }, 'tester');
  check('createStore() KHÔNG trả passwordEnc (sanitize)', st01.passwordEnc === undefined && st01.hasPassword === true);
  getOrCreateDb(dbKey({ server: 'store01-host', port: 1433, database: 'CSDL_ST01', user: 'st01_user' })).skuDef.set('SKU01', skuRow);
  getOrCreateDb(dbKey({ server: 'store02-host', port: 1433, database: 'CSDL_ST02', user: 'st02_user' })).skuDef.set('SKU01', skuRow);

  // ===== insertWholesalePrice fan-out: ST01 (bật) nhận được, ST02 (tắt) KHÔNG nhận =====
  {
    const result = await dsmartSqlClient.insertWholesalePrice({ custId: 'CUST02', skuId: 'SKU01', price: 2000, frDate: '2026-02-01', toDate: '2026-12-31' });
    check('Fan-out INSERT: chỉ gọi đúng 1 siêu thị ĐANG BẬT (ST01), bỏ qua ST02 đã tắt',
      result.storeResults.length === 1 && result.storeResults[0].storeCode === 'ST01' && result.storeResults[0].ok === true, result.storeResults);
    const st01Db = getOrCreateDb(dbKey({ server: 'store01-host', port: 1433, database: 'CSDL_ST01', user: 'st01_user' }));
    check('Fan-out INSERT: dòng THẬT SỰ xuất hiện trong CSPRICE của ST01', st01Db.csprice.has('CUST02|SKU01'));
    const st02Db = getOrCreateDb(dbKey({ server: 'store02-host', port: 1433, database: 'CSDL_ST02', user: 'st02_user' }));
    check('Fan-out INSERT: ST02 (đã tắt) KHÔNG có dòng này', !st02Db.csprice.has('CUST02|SKU01'));
    const hoDb = getOrCreateDb(dbKey({ server: 'ho-dsmart16', port: 1433, database: 'DSMART16', user: 'b2b_price' }));
    check('Ghi HO (DSmart16 Trung Tâm) vẫn đúng như cũ, không bị ảnh hưởng bởi fan-out', hoDb.csprice.has('CUST02|SKU01'));
  }

  // ===== Bật lại ST02, thêm giá MỚI khác -> cả 2 siêu thị đều nhận =====
  await storeConnStore.updateStore(st02.id, { storeCode: 'ST02', storeName: 'Siêu Thị 02', host: 'store02-host', port: 1433, database: 'CSDL_ST02', user: 'st02_user', enabled: true }, 'tester');
  {
    const result = await dsmartSqlClient.insertWholesalePrice({ custId: 'CUST03', skuId: 'SKU01', price: 3000, frDate: '2026-03-01', toDate: '2026-12-31' });
    check('Bật lại ST02 -> fan-out đủ CẢ 2 siêu thị, cả 2 đều thành công',
      result.storeResults.length === 2 && result.storeResults.every(r => r.ok), result.storeResults);
  }

  // ===== 1 siêu thị mất kết nối -> KHÔNG chặn siêu thị khác, KHÔNG chặn/rollback ghi HO đã xong =====
  forceConnectFailFor = dbKey({ server: 'store01-host', port: 1433, database: 'CSDL_ST01', user: 'st01_user' });
  // Pool ST01 đã cache từ các lần gọi trước (fan-out insert ở trên) — đổi mật khẩu để buộc mở pool MỚI
  // (đổi "chữ ký" cấu hình -> storeConfigSignature() khác -> fanOutToStores() tự đóng pool cũ, mở lại).
  await storeConnStore.updateStore(st01.id, { storeCode: 'ST01', storeName: 'Siêu Thị 01', host: 'store01-host', port: 1433, database: 'CSDL_ST01', user: 'st01_user', password: 'doi-mat-khau-de-buoc-mo-pool-moi', enabled: true }, 'tester');
  {
    const result = await dsmartSqlClient.insertWholesalePrice({ custId: 'CUST04', skuId: 'SKU01', price: 4000, frDate: '2026-04-01', toDate: '2026-12-31' });
    const st01Result = result.storeResults.find(r => r.storeCode === 'ST01');
    const st02Result = result.storeResults.find(r => r.storeCode === 'ST02');
    check('1 siêu thị (ST01) mất kết nối -> báo lỗi RÕ RÀNG cho đúng siêu thị đó', st01Result && st01Result.ok === false && !!st01Result.error, st01Result);
    check('Siêu thị khác (ST02) KHÔNG bị ảnh hưởng, vẫn ghi thành công', st02Result && st02Result.ok === true, st02Result);
    const hoDb = getOrCreateDb(dbKey({ server: 'ho-dsmart16', port: 1433, database: 'DSMART16', user: 'b2b_price' }));
    check('Ghi HO vẫn THÀNH CÔNG dù 1 siêu thị lỗi fan-out (không rollback HO)', hoDb.csprice.has('CUST04|SKU01'));
  }
  forceConnectFailFor = null;

  // ===== updateWholesalePrice (Sửa) fan-out — ST02 CHƯA từng có dòng CUST05 -> báo lỗi rõ cho ST02, HO/ST01 vẫn đúng =====
  {
    const insertResult = await dsmartSqlClient.insertWholesalePrice({ custId: 'CUST05', skuId: 'SKU01', price: 5000, frDate: '2026-05-01', toDate: '2026-12-31' });
    // Xoá tay khỏi ST02 để mô phỏng đúng tình huống "siêu thị chưa từng nhận được dòng này" (VD do mới
    // bật fan-out, lịch sử cũ trước đó).
    getOrCreateDb(dbKey({ server: 'store02-host', port: 1433, database: 'CSDL_ST02', user: 'st02_user' })).csprice.delete('CUST05|SKU01');
    const updateResult = await dsmartSqlClient.updateWholesalePrice({ dsmartKey: { custId: 'CUST05', skuId: 'SKU01' }, price: 5500, frDate: '2026-05-01', toDate: '2026-12-31' });
    const st02Result = updateResult.storeResults.find(r => r.storeCode === 'ST02');
    const st01Result = updateResult.storeResults.find(r => r.storeCode === 'ST01');
    check('Sửa fan-out: ST02 chưa từng có dòng này -> báo lỗi rõ (không âm thầm ghi thiếu cột)', st02Result && st02Result.ok === false, st02Result);
    check('Sửa fan-out: ST01 (đã có dòng từ lúc Thêm) vẫn sửa thành công', st01Result && st01Result.ok === true, st01Result);
    const hoDb = getOrCreateDb(dbKey({ server: 'ho-dsmart16', port: 1433, database: 'DSMART16', user: 'b2b_price' }));
    check('Sửa HO: giá đã đổi đúng thành 5500', hoDb.csprice.get('CUST05|SKU01').WSPRICE === 5500);
  }

  // ===== deleteWholesalePrice (Xoá) fan-out — xoá đúng khỏi CẢ HO lẫn ST01 =====
  {
    const delResult = await dsmartSqlClient.deleteWholesalePrice({ dsmartKey: { custId: 'CUST03', skuId: 'SKU01' } });
    check('Xoá fan-out: cả 2 siêu thị (ST01/ST02) đều báo thành công', delResult.storeResults.length === 2 && delResult.storeResults.every(r => r.ok), delResult.storeResults);
    const hoDb = getOrCreateDb(dbKey({ server: 'ho-dsmart16', port: 1433, database: 'DSMART16', user: 'b2b_price' }));
    const st01Db = getOrCreateDb(dbKey({ server: 'store01-host', port: 1433, database: 'CSDL_ST01', user: 'st01_user' }));
    check('Xoá fan-out: dòng THẬT SỰ biến mất khỏi CSPRICE của HO', !hoDb.csprice.has('CUST03|SKU01'));
    check('Xoá fan-out: dòng THẬT SỰ biến mất khỏi CSPRICE của ST01', !st01Db.csprice.has('CUST03|SKU01'));
  }

  // ===== deleteStore() -> siêu thị đó không còn nhận fan-out ở lượt sau =====
  await storeConnStore.deleteStore(st02.id);
  {
    const result = await dsmartSqlClient.insertWholesalePrice({ custId: 'CUST06', skuId: 'SKU01', price: 6000, frDate: '2026-06-01', toDate: '2026-12-31' });
    check('deleteStore() xong -> fan-out chỉ còn ĐÚNG 1 siêu thị còn lại (ST01)', result.storeResults.length === 1 && result.storeResults[0].storeCode === 'ST01', result.storeResults);
  }

  // ===== testStoreConnection()/testStoreConnection route logic (giả lập mất mạng) =====
  {
    forceConnectFailFor = dbKey({ server: 'khong-ton-tai', port: 1433, database: 'X', user: 'u' });
    let threw = false;
    try {
      await dsmartSqlClient.testStoreConnection({ host: 'khong-ton-tai', port: 1433, database: 'X', user: 'u', password: 'p' });
    } catch (err) { threw = true; check('testStoreConnection() báo lỗi NGUYÊN VĂN khi mất kết nối', err.message.includes('mất kết nối mạng'), err.message); }
    check('testStoreConnection() ném lỗi khi mất kết nối (không trả thành công giả)', threw);
    forceConnectFailFor = null;
    const ok = await dsmartSqlClient.testStoreConnection({ host: 'store01-host', port: 1433, database: 'CSDL_ST01', user: 'st01_user', password: 'doi-mat-khau-de-buoc-mo-pool-moi' });
    check('testStoreConnection() thành công khi kết nối đúng', Number.isFinite(ok.ms));
  }

  // ===== Mã Siêu Thị trùng -> chặn tạo trùng =====
  {
    let threw = false;
    try { await storeConnStore.createStore({ storeCode: 'ST01', storeName: 'Trùng Mã', host: 'h', port: 1433, database: 'd', user: 'u', password: 'p' }, 'tester'); }
    catch (err) { threw = true; }
    check('createStore() chặn Mã Siêu Thị trùng', threw);
  }

  // ===== updateStore() để trống password -> GIỮ NGUYÊN mật khẩu cũ =====
  {
    const before = await storeConnStore.getRawById(st01.id);
    await storeConnStore.updateStore(st01.id, { storeCode: 'ST01', storeName: 'Siêu Thị 01 (đổi tên)', host: 'store01-host', port: 1433, database: 'CSDL_ST01', user: 'st01_user', password: null, enabled: true }, 'tester');
    const after = await storeConnStore.getRawById(st01.id);
    check('updateStore() để trống mật khẩu -> PasswordEnc GIỮ NGUYÊN', after.passwordEnc === before.passwordEnc);
    check('updateStore() vẫn đổi được StoreName dù không đổi mật khẩu', after.storeName === 'Siêu Thị 01 (đổi tên)');
  }

  await dsmartSqlClient.closeDsmartPool();
  await dsmartSqlClient.closeAllStorePools();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error('LỖI KHÔNG BẮT ĐƯỢC:', err); process.exit(1); });
