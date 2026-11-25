// tests/test-dsmart-natural-key-matching.js — LỖI THẬT PRODUCTION đã vá QUA 3 LẦN LIÊN TIẾP trên CÙNG 1
// tính năng (12/2026, nêu đủ lịch sử để không lặp lại bất kỳ giả định nào đã sai):
//   Lần 1: giả định "CSPRICE có cột ID tự tăng tên ID" -> lỗi "Invalid column name 'ID'." -> vá bằng tự
//          tra sys.identity_columns thay vì hard-code "ID".
//   Lần 2: người dùng gửi ảnh chụp thật "🔍 Kiểm Tra Cấu Trúc Bảng CSPRICE" — sys.identity_columns trả
//          RỖNG, CSPRICE HOÀN TOÀN KHÔNG CÓ cột identity nào -> vá bằng "khoá tự nhiên" 7 cột
//          (NATURAL_KEY_COLUMNS = CUST_ID+TYPE+STK_ID+SKU_ID+WS_ID+FR_DATE+TO_DATE), đọc lại khoá sau khi
//          ghi bằng 1 câu SELECT riêng.
//   Lần 3: người dùng thử lại, gặp lỗi THẬT "The SELECT permission was denied on the object 'CSPRICE'..."
//          — tài khoản SQL dùng cho tính năng này CHỈ được GRANT INSERT/UPDATE/DELETE, KHÔNG có SELECT
//          trên CSPRICE -> vá bằng cách bỏ HẲN mọi câu SELECT trên dữ liệu CSPRICE, dùng
//          `OUTPUT INSERTED.*`/`OUTPUT DELETED.*` NGAY TRÊN câu INSERT/UPDATE/DELETE (đọc trực tiếp từ
//          thao tác ghi, không cần quyền SELECT riêng) — updateWholesalePrice()/deleteWholesalePrice()
//          chạy trong 1 transaction, ROLLBACK nếu OUTPUT cho thấy khớp >1 dòng.
//   Lần 4: dòng ghi "thành công" về kỹ thuật nhưng DSmart không áp dụng được giá vì thiếu cột (TYPE/
//          UNIT_SYMB/BASE_UNIT/UNITCONV/VAT_INCL/TAX_CODE/STATUS) -> vá bằng công thức thật trích từ
//          BRG_APP.sql + tra SKU_DEF.
//   Lần 5: người dùng thử Thêm lại cho 1 cặp CUST_ID/SKU_ID ĐÃ CÓ dòng (dòng lỗi Lần 3 để lại), gặp lỗi
//          THẬT "Violation of PRIMARY KEY constraint 'PK_CSPRICE'... duplicate key value is (CUST_ID,
//          SKU_ID)" — người dùng tự đối chiếu qua SSMS (sys.indexes) xác nhận PK_CSPRICE CHỈ gồm 2 cột
//          (CUST_ID, SKU_ID), KHÔNG phải tổ hợp 7 cột giả định SAI ở Lần 2. SỬA: NATURAL_KEY_COLUMNS rút
//          về đúng 2 cột; insertWholesalePrice() bắt lỗi trùng khoá chính (SQL error 2627) và TỰ CHUYỂN
//          sang UPDATE ghi đè đủ lại toàn bộ cột theo công thức Lần 4 (xem overwriteWholesalePrice()),
//          KHÔNG còn báo lỗi cho người dùng khi trùng khoá.
//
// File test này mô phỏng THẬT gói `mssql` (require.cache) — bao gồm mô phỏng ĐÚNG hành vi ROLLBACK (hoàn
// tác thay đổi dữ liệu thật, không chỉ log) để kiểm chứng đúng lớp an toàn chống sửa/xoá nhầm, mô phỏng
// ĐÚNG việc tài khoản không có quyền SELECT trên CSPRICE (mọi câu SELECT dữ liệu thật trên CSPRICE đều ném
// lỗi — nếu code LỠ thêm lại 1 câu SELECT như vậy, test này bắt được ngay), VÀ mô phỏng ĐÚNG ràng buộc
// PRIMARY KEY thật (CUST_ID, SKU_ID) trên CSPRICE — INSERT trùng cặp này ném đúng lỗi SQL Server 2627 như
// thật, để kiểm chứng đúng cơ chế tự chuyển sang ghi đè ở Lần 5.
//
// tests/test-dsmart-wholesale-price.js stub NGUYÊN lib/dsmartSqlClient (không đi qua SQL thật), nên KHÔNG
// phủ được logic bên trong file này — file test này bổ sung đúng phần đó.
//
// Chạy: node server/tests/test-dsmart-natural-key-matching.js
'use strict';
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

// ===== Giả lập dbo.CSPRICE (DSmart16 Trung Tâm) — KHÔNG có cột identity nào (đúng cấu trúc thật người
// dùng xác nhận), khớp đúng 7 cột khoá tự nhiên. TYPE/STK_ID/WS_ID do SQL Server tự áp DEFAULT (ứng dụng
// không ghi trực tiếp — mô phỏng đúng thực tế: DEFAULT_TYPE='4', DEFAULT_STK_ID='' (khoảng trắng CHAR bị
// coi là rỗng), DEFAULT_WS_ID=30, khớp đúng mẫu dữ liệu thật người dùng gửi). =====
let CSPRICE_DB = [];
let queryLog = [];
let seq = 0; // dùng làm OPEN_DATE/MODI_DATE giả (số tăng dần đóng vai trò mốc thời gian)
const DEFAULT_TYPE = '04', DEFAULT_STK_ID = '', DEFAULT_WS_ID = 0;

// ===== Giả lập dbo.SKU_DEF (danh mục sản phẩm, CÙNG CSDL DSmart16 nhưng KHÁC bảng CSPRICE) — nguồn tra
// Đơn Vị Tính/Hệ Số Quy Đổi/Mã Thuế theo đúng công thức lấy từ mã nguồn phần mềm áp giá CŨ (BRG_APP.sql,
// người dùng gửi nguyên văn 12/2026) — xem lookupSkuDefUnitInfo()/lib/dsmartSqlClient.js. =====
let SKU_DEF_DB = { S1: { PICEUNIT: 'BO ', UNITCONV: 1, TAX_CODE: 'T5' } };
let SKU_DEF_PERMISSION_DENIED = false; // mô phỏng trường hợp tài khoản CHƯA được cấp quyền SELECT riêng trên SKU_DEF

// ===== Giả lập dbo.DEALER (danh mục khách hàng B2B thật, CÙNG CSDL DSmart16 nhưng KHÁC CSPRICE/SKU_DEF)
// — người dùng gửi nguyên văn BRG_APP.sql (12/2026), lộ ra bảng này qua sp_BRG_WEBAPP_VendorExist, rồi tự
// hỏi DBA và XÁC NHẬN đây chính là danh mục khách hàng B2B thật — xem validateDealerExists()/
// lib/dsmartSqlClient.js. BLOCK_CODE=0 = khách còn hoạt động (đúng điều kiện sp_BRG_WEBAPP_VendorExist).
let DEALER_DB = { C1: { BLOCK_CODE: 0 } };
let DEALER_PERMISSION_DENIED = false; // mô phỏng trường hợp tài khoản CHƯA được cấp quyền SELECT riêng trên DEALER

function dateMs(v) { return v instanceof Date ? v.getTime() : new Date(v).getTime(); }
function sameDate(a, b) { return dateMs(a) === dateMs(b); }

// matchNaturalKeyInputs() — Lần 5: khớp ĐÚNG khoá chính thật (CUST_ID, SKU_ID) — rút từ 7 cột xuống 2 cột
// theo xác nhận sys.indexes thật qua SSMS (xem chú thích đầu file).
function matchNaturalKeyInputs(db, inputs) {
  return db.filter(r => r.CUST_ID === inputs.kCustId && r.SKU_ID === inputs.kSkuId);
}
function outputRow(r) {
  return { CUST_ID: r.CUST_ID, SKU_ID: r.SKU_ID };
}
// findByPrimaryKey() — mô phỏng tra cứu theo đúng PK thật (CUST_ID, SKU_ID), dùng để: (1) INSERT phát
// hiện trùng khoá -> ném lỗi 2627 như SQL Server thật, (2) UPDATE ghi đè (overwrite path) tìm đúng dòng.
function findByPrimaryKey(db, custId, skuId) {
  return db.find(r => r.CUST_ID === custId && r.SKU_ID === skuId);
}

class FakeRequest {
  constructor(db) { this.inputs = {}; this.db = db; }
  input(name, type, value) { this.inputs[name] = value; return this; }
  async query(sqlText) {
    const sql = sqlText.replace(/\s+/g, ' ').trim();
    queryLog.push(sql);
    if (/sys\.identity_columns/.test(sql)) {
      return { recordset: [] }; // CSPRICE KHÔNG có cột identity nào — đúng thực tế thật đã xác nhận
    }
    if (/INFORMATION_SCHEMA\.COLUMNS/.test(sql)) {
      return { recordset: [
        { COLUMN_NAME: 'CUST_ID', DATA_TYPE: 'char', IS_NULLABLE: 'NO' },
        { COLUMN_NAME: 'TYPE', DATA_TYPE: 'char', IS_NULLABLE: 'NO' },
        { COLUMN_NAME: 'STK_ID', DATA_TYPE: 'char', IS_NULLABLE: 'NO' },
        { COLUMN_NAME: 'SKU_ID', DATA_TYPE: 'char', IS_NULLABLE: 'NO' },
        { COLUMN_NAME: 'WS_ID', DATA_TYPE: 'int', IS_NULLABLE: 'NO' },
        { COLUMN_NAME: 'WSPRICE', DATA_TYPE: 'numeric', IS_NULLABLE: 'NO' },
        { COLUMN_NAME: 'FR_DATE', DATA_TYPE: 'datetime', IS_NULLABLE: 'YES' },
        { COLUMN_NAME: 'TO_DATE', DATA_TYPE: 'datetime', IS_NULLABLE: 'YES' }
      ] };
    }
    if (/sys\.indexes/.test(sql)) {
      // Giả lập CSPRICE KHÔNG khai báo PRIMARY KEY/UNIQUE INDEX nào (đúng tình huống xấu nhất thường gặp ở
      // ERP cũ — ràng buộc duy nhất chỉ nằm ở tầng ứng dụng DSmart, không khai báo trên CSDL).
      return { recordset: [] };
    }
    // QUY TẮC BẮT BUỘC (12/2026, lỗi thật production LẦN 3): tài khoản SQL thật KHÔNG có quyền SELECT trên
    // dữ liệu CSPRICE — nếu code LỠ thêm lại 1 câu SELECT dữ liệu thật, mock này mô phỏng ĐÚNG lỗi thật sẽ
    // gặp, để bắt được ngay ở test thay vì đợi production báo lại lần nữa. (custIdExistsInCsprice() —
    // hàm từng dùng 1 câu SELECT thuần ở đây — ĐÃ GỠ hoàn toàn theo yêu cầu người dùng, xem
    // lib/dsmartSqlClient.js: cảnh báo mềm "Mã Khách B2B CHƯA TỪNG xuất hiện" không ảnh hưởng gì tới việc
    // ghi INSERT/UPDATE nên không cần giữ lại, cũng không còn phụ thuộc quyền SELECT trên CSPRICE nữa.)
    if (/^SELECT\b/.test(sql) && /\bdbo\.CSPRICE\b/.test(sql)) {
      throw new Error("The SELECT permission was denied on the object 'CSPRICE', database 'DSMART16', schema 'dbo'.");
    }
    // validateDealerExists() — CHẶN CỨNG Mã Khách B2B không có/đang bị khoá trong danh mục DEALER trước
    // khi ghi (12/2026, theo yêu cầu người dùng, xem lib/dsmartSqlClient.js). Bảng KHÁC CSPRICE, cần quyền
    // SELECT RIÊNG (DEALER_PERMISSION_DENIED mô phỏng trường hợp chưa được cấp quyền).
    if (/^SELECT CUST_ID FROM dbo\.DEALER WHERE CUST_ID = @custId AND BLOCK_CODE = 0;?$/.test(sql)) {
      if (DEALER_PERMISSION_DENIED) {
        throw new Error("The SELECT permission was denied on the object 'DEALER', database 'DSMART16', schema 'dbo'.");
      }
      const info = DEALER_DB[this.inputs.custId];
      return { recordset: (info && info.BLOCK_CODE === 0) ? [{ CUST_ID: this.inputs.custId }] : [] };
    }
    if (/^SELECT TOP 1 CUST_ID FROM dbo\.DEALER;?$/.test(sql)) {
      if (DEALER_PERMISSION_DENIED) {
        throw new Error("The SELECT permission was denied on the object 'DEALER', database 'DSMART16', schema 'dbo'.");
      }
      const first = Object.keys(DEALER_DB)[0];
      return { recordset: first ? [{ CUST_ID: first }] : [] };
    }
    // checkDealerCustIds() — bản TRA HÀNG LOẠT dùng riêng ở POST /preview (12/2026), IN-list tham số hoá
    // (@c0, @c1, ...) thay vì 1 câu/1 Mã Khách B2B như validateDealerExists().
    if (/^SELECT CUST_ID FROM dbo\.DEALER WHERE BLOCK_CODE = 0 AND CUST_ID IN \(/.test(sql)) {
      if (DEALER_PERMISSION_DENIED) {
        throw new Error("The SELECT permission was denied on the object 'DEALER', database 'DSMART16', schema 'dbo'.");
      }
      const askedCustIds = Object.values(this.inputs);
      const valid = askedCustIds.filter(id => DEALER_DB[id]?.BLOCK_CODE === 0);
      return { recordset: valid.map(id => ({ CUST_ID: id })) };
    }
    // lookupSkuDefUnitInfo() — tra Đơn Vị Tính/Hệ Số Quy Đổi/Mã Thuế theo SKU_ID, bảng KHÁC CSPRICE nên
    // được phép SELECT (nếu tài khoản có quyền riêng, SKU_DEF_PERMISSION_DENIED mô phỏng trường hợp chưa
    // được cấp quyền).
    if (/^SELECT PICEUNIT, UNITCONV, TAX_CODE FROM dbo\.SKU_DEF WHERE SKU_ID = @skuId;?$/.test(sql)) {
      if (SKU_DEF_PERMISSION_DENIED) {
        throw new Error("The SELECT permission was denied on the object 'SKU_DEF', database 'DSMART16', schema 'dbo'.");
      }
      const info = SKU_DEF_DB[this.inputs.skuId];
      return { recordset: info ? [{ PICEUNIT: info.PICEUNIT, UNITCONV: info.UNITCONV, TAX_CODE: info.TAX_CODE }] : [] };
    }
    if (/^SELECT TOP 1 SKU_ID, PICEUNIT, UNITCONV, TAX_CODE FROM dbo\.SKU_DEF;?$/.test(sql)) {
      if (SKU_DEF_PERMISSION_DENIED) {
        throw new Error("The SELECT permission was denied on the object 'SKU_DEF', database 'DSMART16', schema 'dbo'.");
      }
      const first = Object.keys(SKU_DEF_DB)[0];
      return { recordset: first ? [{ SKU_ID: first, ...SKU_DEF_DB[first] }] : [] };
    }
    if (/^INSERT INTO dbo\.CSPRICE/.test(sql)) {
      // Lần 5: mô phỏng ĐÚNG ràng buộc PRIMARY KEY thật (CUST_ID, SKU_ID) — trùng cặp này phải ném đúng lỗi
      // SQL Server 2627 (không phải lỗi tự chế), để kiểm chứng isPrimaryKeyViolation()/overwriteWholesalePrice()
      // nhận diện đúng và tự chuyển sang ghi đè thay vì để lỗi lọt ra người dùng.
      if (findByPrimaryKey(this.db, this.inputs.custId, this.inputs.skuId)) {
        const err = new Error(`Violation of PRIMARY KEY constraint 'PK_CSPRICE'. Cannot insert duplicate key in object 'dbo.CSPRICE'. The duplicate key value is (${this.inputs.custId}, ${this.inputs.skuId}).`);
        err.number = 2627;
        throw err;
      }
      const now = ++seq;
      const row = {
        CUST_ID: this.inputs.custId, TYPE: DEFAULT_TYPE, SKU_ID: this.inputs.skuId,
        UNIT_SYMB: this.inputs.unit, BASE_UNIT: this.inputs.unit, UNITCONV: this.inputs.unitConv,
        WSPRICE: this.inputs.price, VAT_INCL: 1, TAX_CODE: this.inputs.taxCode,
        STK_ID: DEFAULT_STK_ID, WS_ID: DEFAULT_WS_ID, STATUS: 1,
        FR_DATE: this.inputs.frDate, TO_DATE: this.inputs.toDate,
        OPEN_DATE: now, MODI_DATE: now
      };
      this.db.push(row);
      return { rowsAffected: [1], recordset: [outputRow(row)] };
    }
    // tryOverwriteExistingRow() (Lần 5, sửa SQL Lần 6) — câu UPDATE riêng kích hoạt khi khớp trùng khoá
    // chính, nhận diện qua chữ ký "TYPE = '04'" chỉ xuất hiện ở câu lệnh này (khác hẳn câu UPDATE của luồng
    // "Sửa" bên dưới, vốn chỉ đổi WSPRICE/FR_DATE/TO_DATE) — ghi đè ĐỦ LẠI toàn bộ cột theo đúng công thức
    // Lần 4, CỘNG THÊM Lần 6: LASTWSPR lưu giá CŨ (đọc TRƯỚC khi ghi đè WSPRICE, mô phỏng đúng T-SQL SET
    // đọc giá trị CŨ) + OPEN_DATE LUÔN reset (không còn điều kiện NULL như Lần 5) — khớp đúng nguyên văn
    // `_job_sp_WEBAPP_Item_Price` (BRG_APP.sql, phần mềm áp giá cũ) người dùng tự đối chiếu phát hiện sai lệch.
    if (/^UPDATE dbo\.CSPRICE/.test(sql) && /TYPE = '04'/.test(sql)) {
      const row = findByPrimaryKey(this.db, this.inputs.custId, this.inputs.skuId);
      if (!row) return { rowsAffected: [0], recordset: [] };
      const now = ++seq;
      row.LASTWSPR = row.WSPRICE; // Lần 6: lưu giá CŨ TRƯỚC khi ghi đè — khớp `SET T.LASTWSPR=T.WSPRICE, T.WSPRICE=...` bản gốc
      row.TYPE = '04'; row.UNIT_SYMB = this.inputs.unit; row.BASE_UNIT = this.inputs.unit;
      row.UNITCONV = this.inputs.unitConv; row.WSPRICE = this.inputs.price; row.VAT_INCL = 1;
      row.TAX_CODE = this.inputs.taxCode; row.STATUS = 1; row.FR_DATE = this.inputs.frDate; row.TO_DATE = this.inputs.toDate;
      row.MODI_DATE = now;
      row.OPEN_DATE = now; // Lần 6: LUÔN reset (không còn điều kiện NULL) — khớp `T.OPEN_DATE = GETDATE()` bản gốc
      return { rowsAffected: [1], recordset: [outputRow(row)] };
    }
    if (/^UPDATE dbo\.CSPRICE/.test(sql)) {
      const matches = matchNaturalKeyInputs(this.db, this.inputs);
      const now = ++seq;
      for (const r of matches) { r.WSPRICE = this.inputs.newPrice; r.FR_DATE = this.inputs.newFrDate; r.TO_DATE = this.inputs.newToDate; r.MODI_DATE = now; }
      return { rowsAffected: [matches.length], recordset: matches.map(outputRow) };
    }
    if (/^DELETE FROM dbo\.CSPRICE/.test(sql)) {
      const matches = matchNaturalKeyInputs(this.db, this.inputs);
      for (const r of matches) { const idx = this.db.indexOf(r); this.db.splice(idx, 1); }
      return { rowsAffected: [matches.length], recordset: matches.map(r => ({ CUST_ID: r.CUST_ID })) };
    }
    return { recordset: [] };
  }
}
class FakeConnectionPool {
  constructor(cfg) { this.cfg = cfg; this._closed = false; }
  async connect() { if (this.cfg.user === 'BAD_USER') throw new Error('Login failed (giả lập)'); return this; }
  request() { return new FakeRequest(CSPRICE_DB); }
  async close() { this._closed = true; }
}
// FakeTransaction — mô phỏng ĐÚNG hành vi ROLLBACK thật của SQL Server: snapshot dữ liệu lúc begin(), nếu
// rollback() thì HOÀN TÁC lại dữ liệu CSPRICE_DB về đúng snapshot đó (không chỉ log suông) — bắt buộc phải
// mô phỏng đúng vì updateWholesalePrice()/deleteWholesalePrice() dựa vào rollback THẬT để đảm bảo không
// sót thay đổi khi phát hiện khoá tự nhiên khớp >1 dòng (xem lib/dsmartSqlClient.js).
let transactionLog = [];
class FakeTransaction {
  constructor(pool) { this.pool = pool; this.snapshot = null; }
  async begin() {
    transactionLog.push('BEGIN');
    this.snapshot = CSPRICE_DB.map(r => ({ ...r }));
    return this;
  }
  request() { return new FakeRequest(CSPRICE_DB); }
  async commit() { transactionLog.push('COMMIT'); this.snapshot = null; }
  async rollback() {
    transactionLog.push('ROLLBACK');
    if (this.snapshot) {
      CSPRICE_DB.length = 0;
      CSPRICE_DB.push(...this.snapshot);
    }
  }
}
const mssqlStubPath = require.resolve('mssql');
require.cache[mssqlStubPath] = {
  id: mssqlStubPath, filename: mssqlStubPath, path: path.dirname(mssqlStubPath), loaded: true,
  exports: {
    ConnectionPool: FakeConnectionPool,
    Transaction: FakeTransaction,
    NVarChar: () => ({}), Decimal: () => ({}), Int: {}, DateTime: {}, Date: {}, BigInt: {}
  },
  children: [], paths: []
};

let RAW_CFG = { host: 'fake-host', port: 1433, database: 'fakedb', user: 'fakeuser', passwordEnc: 'enc' };
stubModule('lib/dsmartPriceConfigStore', {
  getRawConfig: async () => RAW_CFG,
  decryptSecret: (v) => v,
  // priceOperationMode (12/2026, "🖥️ Theo Phần Mềm"/"🌐 Theo API") — file này test ĐÚNG đường SQL thật
  // (DIRECT_DB), KHÔNG liên quan nhánh EXTERNAL_API (đã test riêng ở tests/test-dsmart-price-mode.js) —
  // trả cố định DIRECT_DB để lib/dsmartSqlClient.js đi đúng nhánh SQL như trước khi có tính năng này.
  getPriceOperationMode: async () => 'DIRECT_DB',
  getExternalApiConfig: async () => ({ externalApiBaseUrl: '', externalApiKey: null })
});

const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const run = createRunner();
  const clientPath = require.resolve(path.join(__dirname, '..', 'lib', 'dsmartSqlClient.js'));
  function freshClient() {
    delete require.cache[clientPath];
    return require(path.join(__dirname, '..', 'lib', 'dsmartSqlClient.js'));
  }

  await run.run('insertWholesalePrice(): CSPRICE KHÔNG có cột identity nào -> VẪN ghi thành công, dùng OUTPUT INSERTED (không cần SELECT riêng)', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const { insertWholesalePrice } = freshClient();
    const key = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    assertEqual(CSPRICE_DB.length, 1, 'phải ghi được đúng 1 dòng vào CSPRICE');
    assert(queryLog.some(q => /^INSERT INTO dbo\.CSPRICE/.test(q) && /OUTPUT INSERTED/.test(q)), 'câu INSERT phải có OUTPUT INSERTED để đọc lại khoá, không dùng SELECT riêng');
    assert(!queryLog.some(q => /^SELECT\b/.test(q) && /dbo\.CSPRICE\b/.test(q) && !/INFORMATION_SCHEMA/.test(q)), 'KHÔNG được có câu SELECT dữ liệu nào trên CSPRICE (tài khoản thật không có quyền SELECT)');
    assertEqual(key.custId, 'C1'); assertEqual(key.skuId, 'S1');
  });

  await run.run('insertWholesalePrice(): dòng ghi vào CSPRICE có đúng TYPE=\'04\' (hằng số ghi tường minh) + STK_ID/WS_ID do SQL Server tự áp DEFAULT (không ghi trực tiếp); khoá trả về (Lần 5) CHỈ còn custId/skuId (đúng PK thật)', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const { insertWholesalePrice } = freshClient();
    const key = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    assertEqual(CSPRICE_DB[0].TYPE, DEFAULT_TYPE, 'phải ghi đúng TYPE=\'04\' (hằng số cố định, trích công thức BRG_APP.sql)');
    assertEqual(CSPRICE_DB[0].WS_ID, DEFAULT_WS_ID, 'phải đọc lại đúng WS_ID mặc định SQL Server tự áp (KHÔNG ghi trực tiếp)');
    assertEqual(CSPRICE_DB[0].STK_ID, DEFAULT_STK_ID, 'phải đọc lại đúng STK_ID mặc định SQL Server tự áp (KHÔNG ghi trực tiếp)');
    assertEqual(key.custId, 'C1'); assertEqual(key.skuId, 'S1'); assertEqual(key.wasOverwrite, false, 'INSERT lần đầu KHÔNG phải ghi đè');
    assert(key.type === undefined && key.wsId === undefined && key.stkId === undefined, 'khoá trả về (Lần 5) KHÔNG còn mang type/wsId/stkId — PK thật chỉ 2 cột custId/skuId');
  });

  // Audit theo nguồn mã BRG_APP.sql thật (12/2026, người dùng gửi): UNIT_SYMB/BASE_UNIT/UNITCONV/TAX_CODE
  // PHẢI tra từ bảng dbo.SKU_DEF theo SKU_ID — KHÔNG được để trống/0 như bản vá trước, nếu không DSmart
  // không áp dụng được giá (người dùng tự so sánh qua SSMS, phát hiện dòng thiếu Đơn Vị Tính không dùng
  // được trong khi dòng có đủ thì dùng được).
  await run.run('insertWholesalePrice(): tra ĐÚNG Đơn Vị Tính/Hệ Số Quy Đổi/Mã Thuế từ SKU_DEF + ghi đủ VAT_INCL=1/STATUS=1 (công thức BRG_APP.sql)', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    SKU_DEF_DB = { S1: { PICEUNIT: 'BO ', UNITCONV: 1, TAX_CODE: 'T5' } };
    const { insertWholesalePrice } = freshClient();
    await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    assert(queryLog.some(q => /^SELECT PICEUNIT, UNITCONV, TAX_CODE FROM dbo\.SKU_DEF WHERE SKU_ID = @skuId/.test(q)), 'phải tra SKU_DEF theo đúng SKU_ID trước khi ghi');
    const row = CSPRICE_DB[0];
    assertEqual(row.TYPE, '04', 'TYPE phải là hằng số \'04\' (công thức BRG_APP.sql)');
    assertEqual(row.UNIT_SYMB.trim(), 'BO', 'UNIT_SYMB phải lấy từ SKU_DEF.PICEUNIT (đã trim)');
    assertEqual(row.BASE_UNIT.trim(), 'BO', 'BASE_UNIT phải lấy CÙNG giá trị PICEUNIT như UNIT_SYMB (đúng công thức BRG_APP.sql)');
    assertEqual(row.UNITCONV, 1, 'UNITCONV phải lấy từ SKU_DEF.UNITCONV');
    assertEqual(row.TAX_CODE.trim(), 'T5', 'TAX_CODE phải lấy từ SKU_DEF.TAX_CODE (đã trim)');
    assertEqual(row.VAT_INCL, 1, 'VAT_INCL phải là hằng số 1 (công thức BRG_APP.sql)');
    assertEqual(row.STATUS, 1, 'STATUS phải là hằng số 1 (công thức BRG_APP.sql — thiếu cột này có thể là lý do DSmart không áp dụng được giá)');
  });

  // ===== LẦN 5 (12/2026): trùng khoá chính PK_CSPRICE (CUST_ID, SKU_ID) lúc Thêm -> TỰ GHI ĐÈ, KHÔNG báo
  // lỗi cho người dùng — đúng lỗi thật người dùng gặp khi thử Thêm lại cho dòng Lần 3 để lại. =====
  await run.run('LẦN 5: insertWholesalePrice() trùng khoá chính (CUST_ID, SKU_ID) -> TỰ GHI ĐÈ (UPDATE), KHÔNG ném lỗi, wasOverwrite=true, ghi đủ lại toàn bộ cột theo công thức Lần 4', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    SKU_DEF_DB = { S1: { PICEUNIT: 'BO ', UNITCONV: 1, TAX_CODE: 'T5' } };
    const { insertWholesalePrice } = freshClient();
    await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    assertEqual(CSPRICE_DB.length, 1, 'sau lần Thêm đầu phải có đúng 1 dòng');
    queryLog = [];
    const key2 = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 999, frDate: '2026-03-01', toDate: '2026-03-31' });
    assertEqual(CSPRICE_DB.length, 1, 'Thêm trùng khoá KHÔNG được tạo dòng thứ 2 — phải GHI ĐÈ đúng dòng cũ');
    assertEqual(CSPRICE_DB[0].WSPRICE, 999, 'phải ghi đè đúng giá MỚI');
    assert(sameDate(CSPRICE_DB[0].FR_DATE, '2026-03-01') && sameDate(CSPRICE_DB[0].TO_DATE, '2026-03-31'), 'phải ghi đè đúng ngày MỚI');
    assertEqual(key2.wasOverwrite, true, 'phải báo wasOverwrite=true để route biết đây là ghi đè, không phải thêm mới');
    // Kiến trúc upsert chuẩn (sửa sau audit chéo): UPDATE thử TRƯỚC — nếu khớp dòng thì GHI ĐÈ luôn, KHÔNG
    // cần thử INSERT trước rồi bắt lỗi trùng khoá nữa (cách cũ dựa exception-driven control flow, đã bỏ).
    assert(queryLog.some(q => /^UPDATE dbo\.CSPRICE/.test(q) && /TYPE = '04'/.test(q)), 'phải thử UPDATE ghi đè TRƯỚC (khuôn upsert chuẩn)');
    assert(!queryLog.some(q => /^INSERT INTO dbo\.CSPRICE/.test(q)), 'KHÔNG được thử INSERT khi UPDATE đã khớp được dòng (tránh tự tạo lỗi ràng buộc PK thật không cần thiết)');
  });

  // LẦN 6 (12/2026, người dùng tự đối chiếu nguyên văn `_job_sp_WEBAPP_Item_Price` BRG_APP.sql, phát hiện
  // Lần 5 tự sai lệch 2 điểm): OPEN_DATE bản gốc LUÔN reset GETDATE() mỗi lần ghi giá (không phải chỉ
  // backfill khi NULL như Lần 5 làm) + LASTWSPR LUÔN lưu giá CŨ trước khi ghi đè.
  await run.run('LẦN 6: ghi đè do trùng khoá -> OPEN_DATE LUÔN reset lại (không giữ nguyên như Lần 5), LASTWSPR lưu đúng giá CŨ trước khi ghi đè (khớp nguyên văn BRG_APP.sql)', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    SKU_DEF_DB = { S1: { PICEUNIT: 'BO ', UNITCONV: 1, TAX_CODE: 'T5' } };
    const { insertWholesalePrice } = freshClient();
    // Mô phỏng ĐÚNG dòng lỗi Lần 3 để lại: thiếu cột, OPEN_DATE NULL (giống ảnh chụp SSMS thật người dùng gửi)
    CSPRICE_DB.push({ CUST_ID: 'C1', TYPE: '', SKU_ID: 'S1', UNIT_SYMB: '', BASE_UNIT: '', UNITCONV: 0, WSPRICE: 1000000, VAT_INCL: 0, TAX_CODE: '', STK_ID: '', WS_ID: 0, STATUS: 0, FR_DATE: '2026-01-01', TO_DATE: '2026-01-31', OPEN_DATE: null, MODI_DATE: null });
    const key = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-02-01', toDate: '2026-02-28' });
    assertEqual(key.wasOverwrite, true);
    const row = CSPRICE_DB[0];
    assertEqual(row.TYPE, '04', 'phải tự fix lại TYPE đúng công thức (dòng cũ hỏng thiếu cột này)');
    assertEqual(row.UNIT_SYMB.trim(), 'BO', 'phải tự fix lại UNIT_SYMB');
    assertEqual(row.VAT_INCL, 1, 'phải tự fix lại VAT_INCL');
    assertEqual(row.LASTWSPR, 1000000, 'LASTWSPR phải lưu đúng giá CŨ (1000000) trước khi ghi đè giá mới (100)');
    assert(row.OPEN_DATE != null, 'OPEN_DATE đang NULL (dòng hỏng) -> phải TỰ set lại, không được để NULL mãi');
    const firstOpenDate = row.OPEN_DATE;
    queryLog = [];
    const key3 = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 200, frDate: '2026-04-01', toDate: '2026-04-30' });
    assertEqual(key3.wasOverwrite, true);
    assertEqual(row.LASTWSPR, 100, 'lần ghi đè THỨ 2 phải lưu đúng giá CŨ của chính lần đó (100), không phải giá gốc ban đầu');
    assert(row.OPEN_DATE !== firstOpenDate, 'LẦN 6: OPEN_DATE phải LUÔN reset lại mỗi lần ghi đè (khớp đúng bản gốc GETDATE() không điều kiện), KHÔNG giữ nguyên như Lần 5 làm sai');
  });

  await run.run('LẦN 5: lỗi SQL KHÁC lúc INSERT (không phải trùng khoá chính) -> VẪN ném DsmartSqlError bình thường, KHÔNG bị nhầm thành ghi đè', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const { insertWholesalePrice, DsmartSqlError } = freshClient();
    const origQuery = FakeRequest.prototype.query;
    FakeRequest.prototype.query = async function (sqlText) {
      if (/^INSERT INTO dbo\.CSPRICE/.test(sqlText.replace(/\s+/g, ' ').trim())) {
        throw new Error('Cannot insert the value NULL into column \'SOME_OTHER_REQUIRED_COLUMN\', table \'dbo.CSPRICE\'; column does not allow nulls.');
      }
      return origQuery.call(this, sqlText);
    };
    let threw = null;
    try { await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }); }
    catch (err) { threw = err; }
    FakeRequest.prototype.query = origQuery;
    assert(threw instanceof DsmartSqlError, 'lỗi SQL khác (không phải trùng khoá chính) vẫn phải ném DsmartSqlError bình thường');
    assertEqual(CSPRICE_DB.length, 0, 'không được ghi gì khi gặp lỗi SQL thật khác');
    assert(!/GHI ĐÈ/i.test(threw.message) && !/TRÙNG KHOÁ/i.test(threw.message), 'KHÔNG được nhầm lỗi khác thành lỗi trùng khoá');
  });

  await run.run('insertWholesalePrice(): Mã Sản Phẩm KHÔNG có trong SKU_DEF -> báo lỗi rõ ràng, KHÔNG ghi gì vào CSPRICE', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    SKU_DEF_DB = {}; // không có SKU nào trong danh mục
    const { insertWholesalePrice, DsmartSqlError } = freshClient();
    let threw = null;
    try { await insertWholesalePrice({ custId: 'C1', skuId: 'KHONG_TON_TAI', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }); }
    catch (err) { threw = err; }
    assert(threw instanceof DsmartSqlError, 'phải ném DsmartSqlError khi không tìm thấy SKU_ID trong SKU_DEF');
    assert(/Không tìm thấy Mã Sản Phẩm/.test(threw.message), `thông báo phải nêu rõ không tìm thấy Mã Sản Phẩm — got: ${threw.message}`);
    assertEqual(CSPRICE_DB.length, 0, 'KHÔNG được ghi gì vào CSPRICE khi chưa tra được Đơn Vị Tính');
    SKU_DEF_DB = { S1: { PICEUNIT: 'BO ', UNITCONV: 1, TAX_CODE: 'T5' } }; // khôi phục cho các test sau
  });

  await run.run('insertWholesalePrice(): tài khoản CHƯA được cấp quyền SELECT trên SKU_DEF -> báo lỗi rõ ràng phân biệt với lỗi "không tìm thấy", KHÔNG ghi gì vào CSPRICE', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    SKU_DEF_PERMISSION_DENIED = true;
    const { insertWholesalePrice, DsmartSqlError } = freshClient();
    let threw = null;
    try { await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }); }
    catch (err) { threw = err; }
    SKU_DEF_PERMISSION_DENIED = false;
    assert(threw instanceof DsmartSqlError, 'phải ném DsmartSqlError khi bị từ chối quyền SELECT trên SKU_DEF');
    assert(/GRANT SELECT trên dbo\.SKU_DEF/.test(threw.message), `thông báo phải hướng dẫn rõ cần GRANT SELECT trên SKU_DEF — got: ${threw.message}`);
    assertEqual(CSPRICE_DB.length, 0, 'KHÔNG được ghi gì vào CSPRICE khi bị từ chối quyền tra SKU_DEF');
  });

  await run.run('testSkuDefAccess(): đọc được SKU_DEF -> trả ms + sampleRow; bị từ chối quyền -> DsmartConfigError rõ ràng', async () => {
    const { testSkuDefAccess, DsmartConfigError } = freshClient();
    SKU_DEF_PERMISSION_DENIED = false;
    const ok = await testSkuDefAccess();
    assert(ok.sampleRow && ok.sampleRow.SKU_ID === 'S1', 'phải trả về 1 dòng mẫu từ SKU_DEF khi đọc được');
    SKU_DEF_PERMISSION_DENIED = true;
    let threw = null;
    try { await testSkuDefAccess(); } catch (err) { threw = err; }
    SKU_DEF_PERMISSION_DENIED = false;
    assert(threw instanceof DsmartConfigError, 'phải ném DsmartConfigError khi bị từ chối quyền');
    assert(/SKU_DEF/.test(threw.message), `thông báo phải nêu rõ bảng SKU_DEF — got: ${threw.message}`);
  });

  // validateDealerExists() — CHẶN CỨNG Mã Khách B2B (12/2026, theo yêu cầu người dùng: "Nếu không có thì
  // không cho nhập nữa. Bạn phải kiểm tra chứ" — sau khi gỡ hẳn cảnh báo MỀM custIdExistsInCsprice() cũ).
  await run.run('insertWholesalePrice(): Mã Khách B2B KHÔNG có trong DEALER -> báo lỗi rõ ràng, KHÔNG ghi gì vào CSPRICE', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    DEALER_DB = {}; // không có khách hàng nào trong danh mục
    const { insertWholesalePrice, DsmartSqlError } = freshClient();
    let threw = null;
    try { await insertWholesalePrice({ custId: 'KHONG_TON_TAI', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }); }
    catch (err) { threw = err; }
    assert(threw instanceof DsmartSqlError, 'phải ném DsmartSqlError khi không tìm thấy Mã Khách B2B trong DEALER');
    assert(/Không tìm thấy Mã Khách B2B/.test(threw.message), `thông báo phải nêu rõ không tìm thấy Mã Khách B2B — got: ${threw.message}`);
    assertEqual(CSPRICE_DB.length, 0, 'KHÔNG được ghi gì vào CSPRICE khi Mã Khách B2B không hợp lệ');
    DEALER_DB = { C1: { BLOCK_CODE: 0 } }; // khôi phục cho các test sau
  });

  await run.run('insertWholesalePrice(): Mã Khách B2B có trong DEALER nhưng ĐANG BỊ KHOÁ (BLOCK_CODE khác 0) -> báo lỗi rõ ràng, KHÔNG ghi gì vào CSPRICE', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    DEALER_DB = { 'C-BLOCKED': { BLOCK_CODE: 1 } };
    const { insertWholesalePrice, DsmartSqlError } = freshClient();
    let threw = null;
    try { await insertWholesalePrice({ custId: 'C-BLOCKED', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }); }
    catch (err) { threw = err; }
    assert(threw instanceof DsmartSqlError, 'phải ném DsmartSqlError khi Mã Khách B2B đang bị khoá');
    assert(/đang bị khoá/.test(threw.message), `thông báo phải nêu rõ khách hàng đang bị khoá — got: ${threw.message}`);
    assertEqual(CSPRICE_DB.length, 0, 'KHÔNG được ghi gì vào CSPRICE khi Mã Khách B2B đang bị khoá');
    DEALER_DB = { C1: { BLOCK_CODE: 0 } }; // khôi phục cho các test sau
  });

  await run.run('insertWholesalePrice(): Mã Khách B2B CÓ trong DEALER và KHÔNG bị khoá -> ghi bình thường', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const { insertWholesalePrice } = freshClient();
    const key = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    assertEqual(key.custId, 'C1');
    assertEqual(CSPRICE_DB.length, 1, 'phải ghi được 1 dòng khi Mã Khách B2B hợp lệ');
    assert(queryLog.some(q => /^SELECT CUST_ID FROM dbo\.DEALER WHERE CUST_ID = @custId AND BLOCK_CODE = 0;?$/.test(q)), `phải tra DEALER trước khi ghi — queryLog: ${JSON.stringify(queryLog)}`);
  });

  await run.run('insertWholesalePrice(): tài khoản CHƯA được cấp quyền SELECT trên DEALER -> báo lỗi rõ ràng phân biệt với lỗi "không tìm thấy", KHÔNG ghi gì vào CSPRICE', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    DEALER_PERMISSION_DENIED = true;
    const { insertWholesalePrice, DsmartSqlError } = freshClient();
    let threw = null;
    try { await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' }); }
    catch (err) { threw = err; }
    DEALER_PERMISSION_DENIED = false;
    assert(threw instanceof DsmartSqlError, 'phải ném DsmartSqlError khi bị từ chối quyền SELECT trên DEALER');
    assert(/GRANT SELECT trên dbo\.DEALER/.test(threw.message), `thông báo phải hướng dẫn rõ cần GRANT SELECT trên DEALER — got: ${threw.message}`);
    assertEqual(CSPRICE_DB.length, 0, 'KHÔNG được ghi gì vào CSPRICE khi bị từ chối quyền tra DEALER');
  });

  await run.run('testDealerAccess(): đọc được DEALER -> trả ms + sampleRow; bị từ chối quyền -> DsmartConfigError rõ ràng', async () => {
    const { testDealerAccess, DsmartConfigError } = freshClient();
    DEALER_PERMISSION_DENIED = false;
    const ok = await testDealerAccess();
    assert(ok.sampleRow && ok.sampleRow.CUST_ID === 'C1', 'phải trả về 1 dòng mẫu từ DEALER khi đọc được');
    DEALER_PERMISSION_DENIED = true;
    let threw = null;
    try { await testDealerAccess(); } catch (err) { threw = err; }
    DEALER_PERMISSION_DENIED = false;
    assert(threw instanceof DsmartConfigError, 'phải ném DsmartConfigError khi bị từ chối quyền');
    assert(/DEALER/.test(threw.message), `thông báo phải nêu rõ bảng DEALER — got: ${threw.message}`);
  });

  // checkDealerCustIds() (12/2026, POST /preview tra DEALER NGAY ở bước xem trước — xem chú thích đầy đủ
  // tại hàm, lib/dsmartSqlClient.js) — bản TRA HÀNG LOẠT của validateDealerExists(), dùng đúng 1 câu
  // SELECT IN-list cho nhiều Mã Khách B2B cùng lúc, KHÔNG ném lỗi cho từng mã không hợp lệ (chỉ trả về
  // đúng tập mã HỢP LỆ, để route tự so khớp gắn lỗi đúng dòng).
  await run.run('checkDealerCustIds(): trả về ĐÚNG tập Mã Khách B2B hợp lệ (có trong DEALER, chưa bị khoá), bỏ qua mã sai/đang khoá', async () => {
    DEALER_DB = { C1: { BLOCK_CODE: 0 }, C2: { BLOCK_CODE: 0 }, 'C-BLOCKED': { BLOCK_CODE: 1 } };
    const { getDsmartPool, checkDealerCustIds } = freshClient();
    const valid = await checkDealerCustIds(await getDsmartPool(), ['C1', 'C2', 'C-BLOCKED', 'C-KHONG-TON-TAI']);
    assert(valid instanceof Set, 'phải trả về 1 Set');
    assertEqual([...valid].sort().join(','), 'C1,C2', 'chỉ C1/C2 hợp lệ — C-BLOCKED đang khoá, C-KHONG-TON-TAI không có trong DEALER');
    DEALER_DB = { C1: { BLOCK_CODE: 0 } }; // khôi phục cho các test sau
  });

  await run.run('checkDealerCustIds(): danh sách rỗng -> trả Set rỗng NGAY, KHÔNG gọi SQL nào', async () => {
    queryLog = [];
    const { getDsmartPool, checkDealerCustIds } = freshClient();
    const valid = await checkDealerCustIds(await getDsmartPool(), []);
    assertEqual(valid.size, 0);
    assert(!queryLog.some(q => /dbo\.DEALER/.test(q)), 'không được tốn 1 câu SQL nào khi danh sách rỗng');
  });

  await run.run('checkDealerCustIds(): bị từ chối quyền SELECT trên DEALER -> ném DsmartSqlError rõ ràng (KHÔNG âm thầm coi như rỗng/hợp lệ hết)', async () => {
    DEALER_PERMISSION_DENIED = true;
    const { getDsmartPool, checkDealerCustIds, DsmartSqlError } = freshClient();
    let threw = null;
    try { await checkDealerCustIds(await getDsmartPool(), ['C1']); } catch (err) { threw = err; }
    DEALER_PERMISSION_DENIED = false;
    assert(threw instanceof DsmartSqlError, 'phải ném DsmartSqlError khi bị từ chối quyền');
    assert(/GRANT SELECT trên dbo\.DEALER/.test(threw.message), `thông báo phải hướng dẫn rõ cần GRANT SELECT trên DEALER — got: ${threw.message}`);
  });

  await run.run('updateWholesalePrice()/deleteWholesalePrice(): khớp đúng 1 dòng theo khoá chính thật (CUST_ID, SKU_ID — 2 cột, Lần 5), dùng OUTPUT trong 1 TRANSACTION THẬT, không cần SELECT riêng', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const { insertWholesalePrice, updateWholesalePrice, deleteWholesalePrice } = freshClient();
    const key = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    queryLog = []; transactionLog = [];
    const newKey = await updateWholesalePrice({ dsmartKey: key, price: 150, frDate: '2026-01-01', toDate: '2026-02-28' });
    assertEqual(CSPRICE_DB[0].WSPRICE, 150, 'UPDATE phải đổi đúng giá');
    assert(sameDate(CSPRICE_DB[0].TO_DATE, '2026-02-28'), `UPDATE phải đổi đúng ngày hết hạn — got: ${CSPRICE_DB[0].TO_DATE}`);
    // Lần 5: khoá thật CHỈ gồm custId/skuId (KHÔNG còn gồm FR_DATE/TO_DATE như giả định Lần 2 sai) -> đổi
    // ngày KHÔNG làm khoá đổi theo nữa, khoá mới phải GIỐNG khoá cũ (vẫn cùng custId/skuId).
    assertEqual(newKey.custId, key.custId); assertEqual(newKey.skuId, key.skuId);
    assert(queryLog.some(q => /^UPDATE dbo\.CSPRICE/.test(q) && /OUTPUT INSERTED/.test(q)), 'câu UPDATE phải có OUTPUT INSERTED để biết số dòng bị ảnh hưởng + khoá mới, không cần SELECT COUNT riêng');
    // 12/2026, FAN-OUT (lib/dsmartSqlClient.js::fanOutToStores()) — SỬA giờ CÓ thêm đúng 1 câu SELECT,
    // nhưng là `SELECT ... FROM dbo.DsmartStorePriceConnections` (bảng CẤU HÌNH danh sách siêu thị, nằm
    // trong CSDL CỦA CHÍNH APP này — db.js, KHÁC HẲN CSDL DSmart16) để biết siêu thị nào đang Enabled cần
    // fan-out — KHÔNG đụng gì tới CSPRICE nên không vi phạm ràng buộc "tài khoản DSmart16 không có quyền
    // SELECT trên CSPRICE" mà quy tắc này bảo vệ. Chỉ cấm SELECT trên CSPRICE, không cấm SELECT nói chung.
    assert(!queryLog.some(q => /^SELECT\b/.test(q) && /\bdbo\.CSPRICE\b/.test(q)), 'KHÔNG được có câu SELECT nào trên dbo.CSPRICE (kể cả SELECT COUNT) trong luồng Sửa');
    assertEqual(transactionLog.join(','), 'BEGIN,COMMIT', 'phải mở transaction THẬT quanh UPDATE, rồi COMMIT khi khớp đúng 1 dòng');
    queryLog = [];
    const delResult = await deleteWholesalePrice({ dsmartKey: newKey });
    assertEqual(delResult.alreadyGone, false, 'phải xoá thành công đúng dòng (dùng khoá MỚI sau khi Sửa)');
    assertEqual(CSPRICE_DB.length, 0, 'CSPRICE phải rỗng sau khi xoá');
    assert(queryLog.some(q => /^DELETE FROM dbo\.CSPRICE/.test(q) && /OUTPUT DELETED/.test(q)), 'câu DELETE phải có OUTPUT DELETED');
  });

  await run.run('AN TOÀN: khoá chính khớp 2 dòng (phòng thủ, bình thường PK thật đã ngăn tình huống này) -> updateWholesalePrice() ROLLBACK, HOÀN TÁC thật (không để sót thay đổi)', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const { insertWholesalePrice, updateWholesalePrice, DsmartSqlError } = freshClient();
    const key = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    // Giả lập 1 dòng THỨ 2 trùng hệt khoá tự nhiên (VD nhập tay ngoài hệ thống này, hoặc dữ liệu cũ có sẵn)
    CSPRICE_DB.push({ ...CSPRICE_DB[0] });
    transactionLog = [];
    let threw = null;
    try { await updateWholesalePrice({ dsmartKey: key, price: 999, frDate: '2026-01-01', toDate: '2026-01-31' }); }
    catch (err) { threw = err; }
    assert(threw instanceof DsmartSqlError, 'phải ném DsmartSqlError khi khớp >1 dòng');
    assert(/không còn DUY NHẤT/.test(threw.message), `thông báo phải nêu rõ không còn duy nhất — got: ${threw.message}`);
    assert(/HOÀN TÁC/.test(threw.message), `thông báo phải nêu rõ đã hoàn tác — got: ${threw.message}`);
    assertEqual(CSPRICE_DB[0].WSPRICE, 100, 'ROLLBACK phải HOÀN TÁC về giá cũ (mock mô phỏng rollback thật, không chỉ log)');
    assertEqual(CSPRICE_DB[1].WSPRICE, 100, 'ROLLBACK phải HOÀN TÁC về giá cũ cho cả dòng trùng khoá');
    assertEqual(transactionLog.join(','), 'BEGIN,ROLLBACK', 'phải ROLLBACK khi phát hiện OUTPUT trả về >1 dòng');
  });

  await run.run('AN TOÀN: khoá tự nhiên khớp 2 dòng -> deleteWholesalePrice() ROLLBACK, HOÀN TÁC thật (không xoá mất dữ liệu)', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const { insertWholesalePrice, deleteWholesalePrice, DsmartSqlError } = freshClient();
    const key = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    CSPRICE_DB.push({ ...CSPRICE_DB[0] });
    transactionLog = [];
    let threw = null;
    try { await deleteWholesalePrice({ dsmartKey: key }); } catch (err) { threw = err; }
    assert(threw instanceof DsmartSqlError, 'phải ném DsmartSqlError khi khớp >1 dòng');
    assertEqual(CSPRICE_DB.length, 2, 'ROLLBACK phải HOÀN TÁC — cả 2 dòng vẫn còn nguyên (mock mô phỏng rollback thật)');
    assertEqual(transactionLog.join(','), 'BEGIN,ROLLBACK', 'phải ROLLBACK khi phát hiện OUTPUT trả về >1 dòng');
  });

  // Audit chéo (12/2026) phát hiện: Number(price) không có Number.isFinite() guard như toDateOnly() đã có
  // cho ngày — giá trị không phải số (VD "abc" -> NaN) từng vẫn "ghi thành công" rồi mới lỗi mù mờ ở bước
  // sau. Vá bằng cách chặn NGAY TỪ ĐẦU insertWholesalePrice()/updateWholesalePrice().
  await run.run('insertWholesalePrice()/updateWholesalePrice(): giá không phải số hợp lệ (NaN) -> chặn NGAY, KHÔNG ghi gì vào CSPRICE', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const { insertWholesalePrice, updateWholesalePrice, DsmartSqlError } = freshClient();
    let threw = null;
    try { await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 'abc', frDate: '2026-01-01', toDate: '2026-01-31' }); }
    catch (err) { threw = err; }
    assert(threw instanceof DsmartSqlError, 'phải ném DsmartSqlError khi giá không phải số hợp lệ');
    assertEqual(CSPRICE_DB.length, 0, 'KHÔNG được ghi gì vào CSPRICE khi giá không hợp lệ');
    assertEqual(queryLog.length, 0, 'KHÔNG được gửi câu lệnh SQL nào khi chặn ngay từ đầu');

    const key = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    threw = null;
    try { await updateWholesalePrice({ dsmartKey: key, price: NaN, frDate: '2026-01-01', toDate: '2026-01-31' }); }
    catch (err) { threw = err; }
    assert(threw instanceof DsmartSqlError, 'phải ném DsmartSqlError khi sửa với giá NaN');
    assertEqual(CSPRICE_DB[0].WSPRICE, 100, 'KHÔNG được sửa giá khi giá mới không hợp lệ');
  });

  await run.run('deleteWholesalePrice(): khoá không còn khớp dòng nào (đã bị xoá thủ công trước đó) -> trả alreadyGone=true, KHÔNG ném lỗi', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const { insertWholesalePrice, deleteWholesalePrice } = freshClient();
    const key = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    CSPRICE_DB.length = 0; // mô phỏng đã bị xoá thủ công ngoài hệ thống
    const result = await deleteWholesalePrice({ dsmartKey: key });
    assertEqual(result.alreadyGone, true);
  });

  await run.run('updateWholesalePrice(): khoá không còn khớp dòng nào -> ném lỗi rõ ràng (không âm thầm bỏ qua)', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const { insertWholesalePrice, updateWholesalePrice, DsmartSqlError } = freshClient();
    const key = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    CSPRICE_DB.length = 0;
    let threw = null;
    try { await updateWholesalePrice({ dsmartKey: key, price: 999, frDate: '2026-01-01', toDate: '2026-01-31' }); }
    catch (err) { threw = err; }
    assert(threw instanceof DsmartSqlError, 'phải ném DsmartSqlError khi không tìm thấy dòng để sửa');
  });

  await run.run('ĐỐI CHỨNG lỗi thật LẦN 1 đã gặp (12/2026): CSPRICE không có cột tên "ID" (xác nhận HARNESS mô phỏng đúng cấu trúc thật)', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const req = new FakeRequest(CSPRICE_DB);
    const colsResult = await req.query('SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = \'dbo\' AND TABLE_NAME = \'CSPRICE\' ORDER BY ORDINAL_POSITION;');
    assert(!colsResult.recordset.some(c => c.COLUMN_NAME === 'ID'), 'CSPRICE không có cột tên "ID" — đúng tình huống lỗi thật gặp phải lần đầu');
  });

  await run.run('ĐỐI CHỨNG lỗi thật LẦN 3 đã gặp (12/2026): bất kỳ câu SELECT dữ liệu nào trên CSPRICE đều bị DSmart từ chối (xác nhận HARNESS mô phỏng đúng quyền tài khoản thật)', async () => {
    queryLog = []; CSPRICE_DB = [];
    const req = new FakeRequest(CSPRICE_DB);
    let threw = null;
    try { await req.query('SELECT CUST_ID FROM dbo.CSPRICE WHERE CUST_ID = @custId;'); }
    catch (err) { threw = err; }
    assert(threw && /SELECT permission was denied/.test(threw.message), `mock phải tái hiện đúng lỗi thật đã gặp — got: ${threw && threw.message}`);
  });

  await run.run('inspectCspriceColumns(): identityColumn=null (không có cột identity), naturalKeyColumns (Lần 5) trả đúng 2 cột CUST_ID+SKU_ID, keyIndexes rỗng (không có PK/unique index khai báo)', async () => {
    queryLog = [];
    const { inspectCspriceColumns } = freshClient();
    const result = await inspectCspriceColumns();
    assertEqual(result.identityColumn, null, 'phải trả null vì CSPRICE không có cột identity nào');
    assert(result.columns.length === 8, `phải trả đủ 8 cột giả lập, got: ${result.columns.length}`);
    assert(result.columns.some(c => c.name === 'CUST_ID'), 'phải có cột CUST_ID trong danh sách');
    assertEqual(result.naturalKeyColumns.length, 2, 'naturalKeyColumns (Lần 5) phải có đúng 2 cột (CUST_ID, SKU_ID — đúng PK thật)');
    assert(result.naturalKeyColumns.includes('SKU_ID') && result.naturalKeyColumns.includes('CUST_ID'), 'naturalKeyColumns phải gồm đúng CUST_ID + SKU_ID');
    assertEqual(result.keyIndexes.length, 0, 'keyIndexes phải rỗng (giả lập CSPRICE không khai báo PK/unique index nào)');
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
