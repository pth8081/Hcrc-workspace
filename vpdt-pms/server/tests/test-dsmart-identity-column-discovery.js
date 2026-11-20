// tests/test-dsmart-identity-column-discovery.js — LỖI THẬT PRODUCTION đã vá (12/2026, người dùng báo
// "Team IT của tôi vừa up giá ghi vào dsmart nhưng lỗi" kèm ảnh chụp, lỗi SQL thật hiện ra sau khi đã vá
// "hiện lỗi thật thay vì xem console": "Invalid column name 'ID'."). Giả định "CSPRICE có cột ID tự
// tăng" (ghi chú đầu lib/dsmartSqlClient.js, nói là người dùng đã xác nhận qua trao đổi) hoá ra SAI trên
// CSDL DSmart16 thật — insertWholesalePrice()/updateWholesalePrice()/deleteWholesalePrice() TRƯỚC ĐÂY
// dùng cứng "ID" trong OUTPUT INSERTED.ID/WHERE ID=..., khiến MỌI lượt ghi/sửa/xoá lỗi ngay từ đầu.
//
// Test này mô phỏng THẬT gói `mssql` (require.cache) để kiểm tra đúng cơ chế TỰ TRA CỨU tên cột identity
// thật qua sys.identity_columns (resolveCspriceIdentityColumn()) — vì
// tests/test-dsmart-wholesale-price.js stub NGUYÊN lib/dsmartSqlClient (không đi qua SQL thật), nên
// KHÔNG phủ được logic bên trong file này.
//
// Chạy: node server/tests/test-dsmart-identity-column-discovery.js
'use strict';
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

// ===== Giả lập gói `mssql` =====
let queryLog = [];
let identityColumnOnServer = 'CSPRICE_ID'; // mặc định: tên cột identity THẬT KHÁC "ID" (đúng tình huống lỗi thật)
let nextInsertedId = 1;
const CSPRICE_ROWS = new Map(); // id -> row

class FakeRequest {
  constructor() { this.inputs = {}; }
  input(name, type, value) { this.inputs[name] = value; return this; }
  async query(sqlText) {
    queryLog.push(sqlText.replace(/\s+/g, ' ').trim());
    if (/sys\.identity_columns/.test(sqlText)) {
      return { recordset: identityColumnOnServer ? [{ ColumnName: identityColumnOnServer }] : [] };
    }
    if (/INFORMATION_SCHEMA\.COLUMNS/.test(sqlText)) {
      return { recordset: [
        { COLUMN_NAME: 'CUST_ID', DATA_TYPE: 'nvarchar', IS_NULLABLE: 'NO' },
        { COLUMN_NAME: 'SKU_ID', DATA_TYPE: 'nvarchar', IS_NULLABLE: 'NO' },
        { COLUMN_NAME: 'WSPRICE', DATA_TYPE: 'decimal', IS_NULLABLE: 'YES' },
        { COLUMN_NAME: identityColumnOnServer || 'CSPRICE_ID', DATA_TYPE: 'bigint', IS_NULLABLE: 'NO' }
      ] };
    }
    if (/^\s*INSERT INTO dbo\.CSPRICE/.test(sqlText)) {
      if (!identityColumnOnServer || !sqlText.includes(`[${identityColumnOnServer}]`)) {
        const err = new Error(`Invalid column name '${sqlText.match(/OUTPUT INSERTED\.\[?(\w+)\]?/)?.[1] || 'ID'}'.`);
        throw err;
      }
      const id = nextInsertedId++;
      CSPRICE_ROWS.set(id, { ...this.inputs });
      return { recordset: [{ Id: id }] };
    }
    if (/^\s*UPDATE dbo\.CSPRICE/.test(sqlText)) {
      const id = this.inputs.dsmartId;
      const exists = CSPRICE_ROWS.has(id);
      if (exists) Object.assign(CSPRICE_ROWS.get(id), this.inputs);
      return { rowsAffected: [exists ? 1 : 0] };
    }
    if (/^\s*DELETE FROM dbo\.CSPRICE/.test(sqlText)) {
      const id = this.inputs.dsmartId;
      const existed = CSPRICE_ROWS.delete(id);
      return { rowsAffected: [existed ? 1 : 0] };
    }
    return { recordset: [] };
  }
}
class FakeConnectionPool {
  constructor(cfg) { this.cfg = cfg; this._closed = false; }
  async connect() { if (this.cfg.user === 'BAD_USER') throw new Error('Login failed (giả lập)'); return this; }
  request() { return new FakeRequest(); }
  async close() { this._closed = true; }
}
const mssqlStubPath = require.resolve('mssql');
require.cache[mssqlStubPath] = {
  id: mssqlStubPath, filename: mssqlStubPath, path: path.dirname(mssqlStubPath), loaded: true,
  exports: {
    ConnectionPool: FakeConnectionPool,
    NVarChar: () => ({}), Decimal: () => ({}), Date: {}, BigInt: {}
  },
  children: [], paths: []
};

let RAW_CFG = { host: 'fake-host', port: 1433, database: 'fakedb', user: 'fakeuser', passwordEnc: 'enc' };
stubModule('lib/dsmartPriceConfigStore', {
  getRawConfig: async () => RAW_CFG,
  decryptSecret: (v) => v
});

const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const run = createRunner();
  // Mỗi scenario cần module tươi (cachedPool/cachedIdentityColumn module-level) — xoá cache mỗi lần.
  const clientPath = require.resolve(path.join(__dirname, '..', 'lib', 'dsmartSqlClient.js'));

  function freshClient() {
    delete require.cache[clientPath];
    return require(path.join(__dirname, '..', 'lib', 'dsmartSqlClient.js'));
  }

  await run.run('insertWholesalePrice(): tự tra cứu đúng cột identity thật (KHÁC "ID") qua sys.identity_columns, dùng đúng cột đó trong OUTPUT', async () => {
    queryLog = []; CSPRICE_ROWS.clear(); nextInsertedId = 1; identityColumnOnServer = 'CSPRICE_ID';
    const { insertWholesalePrice } = freshClient();
    const id = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    assertEqual(id, 1, 'phải trả về ID vừa tạo');
    assert(queryLog.some(q => q.includes('sys.identity_columns')), 'phải có 1 lượt tra cứu sys.identity_columns');
    assert(queryLog.some(q => q.includes('OUTPUT INSERTED.[CSPRICE_ID]')), `phải dùng ĐÚNG cột thật (CSPRICE_ID) trong OUTPUT, không phải "ID" cứng — log: ${JSON.stringify(queryLog)}`);
  });

  await run.run('insertWholesalePrice() lượt 2: dùng lại cache, KHÔNG tra cứu sys.identity_columns lần nữa', async () => {
    queryLog = []; CSPRICE_ROWS.clear(); nextInsertedId = 1; identityColumnOnServer = 'CSPRICE_ID';
    const { insertWholesalePrice } = freshClient();
    await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    queryLog = [];
    await insertWholesalePrice({ custId: 'C2', skuId: 'S2', price: 200, frDate: '2026-02-01', toDate: '2026-02-28' });
    assert(!queryLog.some(q => q.includes('sys.identity_columns')), `lượt 2 KHÔNG được tra cứu lại (phải dùng cache) — log: ${JSON.stringify(queryLog)}`);
    assert(queryLog.some(q => q.includes('OUTPUT INSERTED.[CSPRICE_ID]')), 'lượt 2 vẫn phải dùng đúng cột đã cache');
  });

  await run.run('updateWholesalePrice()/deleteWholesalePrice(): cùng dùng đúng cột identity thật trong WHERE (không phải "ID" cứng)', async () => {
    queryLog = []; CSPRICE_ROWS.clear(); nextInsertedId = 1; identityColumnOnServer = 'CSPRICE_ID';
    const { insertWholesalePrice, updateWholesalePrice, deleteWholesalePrice } = freshClient();
    const id = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    queryLog = [];
    await updateWholesalePrice({ dsmartId: id, price: 150, frDate: '2026-01-01', toDate: '2026-01-31' });
    assert(queryLog.some(q => q.includes('WHERE [CSPRICE_ID] = @dsmartId')), `UPDATE phải dùng đúng cột thật — log: ${JSON.stringify(queryLog)}`);
    queryLog = [];
    const delResult = await deleteWholesalePrice({ dsmartId: id });
    assertEqual(delResult.alreadyGone, false, 'phải xoá thành công');
    assert(queryLog.some(q => q.includes('WHERE [CSPRICE_ID] = @dsmartId')), `DELETE phải dùng đúng cột thật — log: ${JSON.stringify(queryLog)}`);
  });

  await run.run('ĐỐI CHỨNG lỗi thật đã gặp (12/2026): nếu code LỠ dùng cứng "ID" trong khi cột thật là "CSPRICE_ID" -> ném đúng "Invalid column name \'ID\'." (mock mô phỏng ĐÚNG hành vi SQL Server thật)', async () => {
    // Test này xác nhận FakeRequest mô phỏng đúng triệu chứng lỗi thật đã gặp — không test code hiện tại
    // (code hiện tại đã tự tra cứu đúng cột nên KHÔNG còn lỗi này) mà xác nhận HARNESS of record đúng.
    queryLog = []; CSPRICE_ROWS.clear(); nextInsertedId = 1; identityColumnOnServer = 'CSPRICE_ID';
    const req = new FakeRequest();
    let threw = null;
    try {
      await req.query(`INSERT INTO dbo.CSPRICE (CUST_ID) OUTPUT INSERTED.ID VALUES ('x');`);
    } catch (err) { threw = err; }
    assert(threw && /Invalid column name 'ID'\./.test(threw.message), `mock phải tái hiện đúng lỗi thật — got: ${threw && threw.message}`);
  });

  await run.run('Không tìm thấy cột identity nào trên CSPRICE -> báo lỗi rõ ràng, hướng dẫn dùng "Kiểm Tra Cấu Trúc Bảng", KHÔNG throw lỗi mù mờ', async () => {
    queryLog = []; CSPRICE_ROWS.clear(); nextInsertedId = 1; identityColumnOnServer = null;
    const { insertWholesalePrice } = freshClient();
    let threw = null;
    try {
      await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    } catch (err) { threw = err; }
    assert(threw, 'phải ném lỗi khi không có cột identity nào');
    assert(threw.message.includes('Kiểm Tra Cấu Trúc Bảng CSPRICE'), `lỗi phải hướng dẫn dùng nút chẩn đoán — got: ${threw.message}`);
  });

  await run.run('inspectCspriceColumns(): trả về đủ danh sách cột + đúng cột identity', async () => {
    queryLog = []; identityColumnOnServer = 'CSPRICE_ID';
    const { inspectCspriceColumns } = freshClient();
    const result = await inspectCspriceColumns();
    assertEqual(result.identityColumn, 'CSPRICE_ID', 'phải trả đúng cột identity');
    assert(result.columns.length === 4, `phải trả đủ 4 cột giả lập, got: ${result.columns.length}`);
    assert(result.columns.some(c => c.name === 'CUST_ID'), 'phải có cột CUST_ID trong danh sách');
  });

  await run.run('Kết nối lỗi (override cfg, user sai) -> DsmartConfigError rõ ràng', async () => {
    const { inspectCspriceColumns, DsmartConfigError } = freshClient();
    let threw = null;
    try {
      await inspectCspriceColumns({ host: 'h', port: 1433, database: 'd', user: 'BAD_USER', password: 'p' });
    } catch (err) { threw = err; }
    assert(threw instanceof DsmartConfigError, 'phải là DsmartConfigError');
    assert(threw.message.includes('Không kết nối được'), `thông báo phải rõ ràng — got: ${threw.message}`);
  });

  run.summary();
}

main().then(() => process.exit(process.exitCode || 0)).catch(err => { console.error('FATAL:', err && err.stack || err); process.exit(1); });
