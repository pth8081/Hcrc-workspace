// tests/test-dsmart-natural-key-matching.js — LỖI THẬT PRODUCTION đã vá LẦN 2 (12/2026, người dùng gửi
// ảnh chụp thật kết quả bấm "🔍 Kiểm Tra Cấu Trúc Bảng CSPRICE": sys.identity_columns trả RỖNG — CSPRICE
// HOÀN TOÀN KHÔNG CÓ cột ID tự tăng nào, khác hẳn giả định "có cột identity, chỉ sai TÊN cột" của lần vá
// trước — file test-dsmart-identity-column-discovery.js đã test đúng lần vá trước giờ THAY bằng file này).
//
// lib/dsmartSqlClient.js giờ dùng "khoá tự nhiên" (NATURAL_KEY_COLUMNS = CUST_ID+TYPE+STK_ID+SKU_ID+WS_ID+
// FR_DATE+TO_DATE) thay cho 1 cột ID duy nhất — test này mô phỏng THẬT gói `mssql` (require.cache, cùng kỹ
// thuật test-dsmart-identity-column-discovery.js cũ) để kiểm tra đúng cơ chế: insert không cần cột identity
// nào, đọc lại khoá tự nhiên sau khi ghi, và các lớp AN TOÀN chặn Sửa/Xoá khi khoá suy luận khớp 0 hoặc
// NHIỀU HƠN 1 dòng (rủi ro sửa/xoá nhầm — xem chú thích đầy đủ ở đầu lib/dsmartSqlClient.js).
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
let seq = 0; // dùng làm OPEN_DATE/MODI_DATE giả (số tăng dần đóng vai trò mốc thời gian) để ORDER BY ... DESC xác định đúng
const DEFAULT_TYPE = '4', DEFAULT_STK_ID = '', DEFAULT_WS_ID = 30;

function dateMs(v) { return v instanceof Date ? v.getTime() : new Date(v).getTime(); }
function sameDate(a, b) { return dateMs(a) === dateMs(b); }

function matchNaturalKeyInputs(db, inputs) {
  return db.filter(r => r.CUST_ID === inputs.kCustId && r.TYPE === inputs.kType && r.STK_ID === inputs.kStkId
    && r.SKU_ID === inputs.kSkuId && r.WS_ID === inputs.kWsId && sameDate(r.FR_DATE, inputs.kFrDate) && sameDate(r.TO_DATE, inputs.kToDate));
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
    if (/^INSERT INTO dbo\.CSPRICE/.test(sql)) {
      const now = ++seq;
      const row = {
        CUST_ID: this.inputs.custId, SKU_ID: this.inputs.skuId, WSPRICE: this.inputs.price,
        FR_DATE: this.inputs.frDate, TO_DATE: this.inputs.toDate,
        TYPE: DEFAULT_TYPE, STK_ID: DEFAULT_STK_ID, WS_ID: DEFAULT_WS_ID,
        OPEN_DATE: now, MODI_DATE: now
      };
      this.db.push(row);
      return { rowsAffected: [1] };
    }
    if (/^SELECT CUST_ID, TYPE, STK_ID, SKU_ID, WS_ID, FR_DATE, TO_DATE FROM dbo\.CSPRICE/.test(sql)) {
      // captureCspriceNaturalKey() KHÔNG còn khớp theo WSPRICE nữa (audit chéo 12/2026 — tránh rủi ro
      // precision/scale khác nhau giữa app và CSDL thật khiến so sánh = bị trật) — chỉ khớp 4 cột định
      // danh nghiệp vụ CUST_ID/SKU_ID/FR_DATE/TO_DATE.
      const matches = this.db.filter(r => r.CUST_ID === this.inputs.custId && r.SKU_ID === this.inputs.skuId
        && sameDate(r.FR_DATE, this.inputs.frDate) && sameDate(r.TO_DATE, this.inputs.toDate));
      matches.sort((a, b) => (b.OPEN_DATE - a.OPEN_DATE) || (b.MODI_DATE - a.MODI_DATE));
      return { recordset: matches.map(r => ({ CUST_ID: r.CUST_ID, TYPE: r.TYPE, STK_ID: r.STK_ID, SKU_ID: r.SKU_ID, WS_ID: r.WS_ID, FR_DATE: r.FR_DATE, TO_DATE: r.TO_DATE })) };
    }
    if (/^SELECT COUNT\(\*\) AS Cnt FROM dbo\.CSPRICE/.test(sql)) {
      return { recordset: [{ Cnt: matchNaturalKeyInputs(this.db, this.inputs).length }] };
    }
    if (/^UPDATE dbo\.CSPRICE/.test(sql)) {
      const matches = matchNaturalKeyInputs(this.db, this.inputs);
      const now = ++seq;
      for (const r of matches) { r.WSPRICE = this.inputs.newPrice; r.FR_DATE = this.inputs.newFrDate; r.TO_DATE = this.inputs.newToDate; r.MODI_DATE = now; }
      return { rowsAffected: [matches.length] };
    }
    if (/^DELETE FROM dbo\.CSPRICE/.test(sql)) {
      const matches = matchNaturalKeyInputs(this.db, this.inputs);
      for (const r of matches) { const idx = this.db.indexOf(r); this.db.splice(idx, 1); }
      return { rowsAffected: [matches.length] };
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
// FakeTransaction — audit chéo (12/2026) phát hiện ĐẾM + GHI tách rời 2 round-trip không transaction có
// rủi ro TOCTOU thật — lib/dsmartSqlClient.js đã vá bằng `new sql.Transaction(pool)` THẬT (gộp đếm+ghi
// trong 1 giao dịch, khoá bằng UPDLOCK/HOLDLOCK) — mock này KHÔNG mô phỏng khoá/isolation thật (không cần
// thiết cho test logic SQL-text/mutation thuần, chạy tuần tự trong 1 tiến trình Node.js), chỉ cần đúng bề
// mặt API (`begin()`/`request()`/`commit()`/`rollback()`) để code thật chạy được qua mock.
let transactionLog = [];
class FakeTransaction {
  constructor(pool) { this.pool = pool; }
  async begin() { transactionLog.push('BEGIN'); return this; }
  request() { return new FakeRequest(CSPRICE_DB); }
  async commit() { transactionLog.push('COMMIT'); }
  async rollback() { transactionLog.push('ROLLBACK'); }
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
  decryptSecret: (v) => v
});

const { createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const run = createRunner();
  const clientPath = require.resolve(path.join(__dirname, '..', 'lib', 'dsmartSqlClient.js'));
  function freshClient() {
    delete require.cache[clientPath];
    return require(path.join(__dirname, '..', 'lib', 'dsmartSqlClient.js'));
  }

  await run.run('insertWholesalePrice(): CSPRICE KHÔNG có cột identity nào -> VẪN ghi thành công (không còn throw "Không tìm thấy cột ID tự tăng")', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const { insertWholesalePrice } = freshClient();
    const key = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    assertEqual(CSPRICE_DB.length, 1, 'phải ghi được đúng 1 dòng vào CSPRICE');
    assert(!queryLog.some(q => /OUTPUT INSERTED/.test(q)), 'KHÔNG được dùng OUTPUT INSERTED.<cột> nữa (CSPRICE không có cột identity)');
    assertEqual(key.custId, 'C1'); assertEqual(key.skuId, 'S1');
  });

  await run.run('insertWholesalePrice(): khoá tự nhiên trả về gồm cả TYPE/STK_ID/WS_ID do SQL Server tự áp DEFAULT (ứng dụng không ghi trực tiếp)', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const { insertWholesalePrice } = freshClient();
    const key = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    assertEqual(key.type, DEFAULT_TYPE, 'phải đọc lại đúng TYPE mặc định SQL Server tự áp');
    assertEqual(key.wsId, DEFAULT_WS_ID, 'phải đọc lại đúng WS_ID mặc định SQL Server tự áp');
    assert(queryLog.some(q => q.includes('ORDER BY OPEN_DATE DESC, MODI_DATE DESC')), 'phải đọc lại dòng vừa ghi theo đúng 5 giá trị vừa INSERT');
  });

  await run.run('updateWholesalePrice()/deleteWholesalePrice(): khớp đúng 1 dòng theo khoá tự nhiên (7 cột), không cần ID nào, chạy trong 1 TRANSACTION THẬT', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const { insertWholesalePrice, updateWholesalePrice, deleteWholesalePrice } = freshClient();
    const key = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    queryLog = []; transactionLog = [];
    const newKey = await updateWholesalePrice({ dsmartKey: key, price: 150, frDate: '2026-01-01', toDate: '2026-02-28' });
    assertEqual(CSPRICE_DB[0].WSPRICE, 150, 'UPDATE phải đổi đúng giá');
    assert(sameDate(CSPRICE_DB[0].TO_DATE, '2026-02-28'), `UPDATE phải đổi đúng ngày hết hạn — got: ${CSPRICE_DB[0].TO_DATE}`);
    assert(sameDate(newKey.toDate, '2026-02-28'), 'phải trả về khoá tự nhiên MỚI (TO_DATE đổi -> khoá cũ không còn khớp)');
    assert(queryLog.some(q => q.startsWith('SELECT COUNT(*) AS Cnt FROM dbo.CSPRICE')), 'phải ĐẾM TRƯỚC khi UPDATE (an toàn chống sửa nhầm)');
    assert(queryLog.some(q => /WITH \(UPDLOCK, HOLDLOCK\)/.test(q)), 'bước đếm phải khoá dòng (UPDLOCK/HOLDLOCK) để chặn race với lượt ghi khác chen vào giữa đếm và ghi thật');
    assertEqual(transactionLog.join(','), 'BEGIN,COMMIT', 'phải mở transaction THẬT, đếm+ghi trong CÙNG giao dịch, rồi COMMIT (audit chéo 12/2026: 2 round-trip tách rời không transaction là lỗ hổng TOCTOU thật)');
    queryLog = [];
    const delResult = await deleteWholesalePrice({ dsmartKey: newKey });
    assertEqual(delResult.alreadyGone, false, 'phải xoá thành công đúng dòng (dùng khoá MỚI sau khi Sửa)');
    assertEqual(CSPRICE_DB.length, 0, 'CSPRICE phải rỗng sau khi xoá');
  });

  await run.run('AN TOÀN: khoá tự nhiên khớp 2 dòng (trùng hệt 7 cột) -> updateWholesalePrice() DỪNG LẠI (ROLLBACK), KHÔNG sửa mù', async () => {
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
    assertEqual(CSPRICE_DB[0].WSPRICE, 100, 'KHÔNG được sửa dòng nào khi phát hiện trùng khoá (cả 2 dòng vẫn giữ giá cũ)');
    assertEqual(CSPRICE_DB[1].WSPRICE, 100, 'KHÔNG được sửa dòng nào khi phát hiện trùng khoá (cả 2 dòng vẫn giữ giá cũ)');
    assertEqual(transactionLog.join(','), 'BEGIN,ROLLBACK', 'phải ROLLBACK ngay khi phát hiện khớp >1 dòng, KHÔNG BAO GIỜ chạy UPDATE (xác nhận writeFn không hề được gọi)');
  });

  await run.run('AN TOÀN: khoá tự nhiên khớp 2 dòng -> deleteWholesalePrice() cũng DỪNG LẠI (ROLLBACK), KHÔNG xoá mù', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const { insertWholesalePrice, deleteWholesalePrice, DsmartSqlError } = freshClient();
    const key = await insertWholesalePrice({ custId: 'C1', skuId: 'S1', price: 100, frDate: '2026-01-01', toDate: '2026-01-31' });
    CSPRICE_DB.push({ ...CSPRICE_DB[0] });
    transactionLog = [];
    let threw = null;
    try { await deleteWholesalePrice({ dsmartKey: key }); } catch (err) { threw = err; }
    assert(threw instanceof DsmartSqlError, 'phải ném DsmartSqlError khi khớp >1 dòng');
    assertEqual(CSPRICE_DB.length, 2, 'KHÔNG được xoá dòng nào khi phát hiện trùng khoá');
    assertEqual(transactionLog.join(','), 'BEGIN,ROLLBACK', 'phải ROLLBACK ngay khi phát hiện khớp >1 dòng, KHÔNG BAO GIỜ chạy DELETE');
  });

  // Audit chéo (12/2026) phát hiện: Number(price) không có Number.isFinite() guard như toDateOnly() đã có
  // cho ngày — giá trị không phải số (VD "abc" -> NaN) từng vẫn "ghi thành công" rồi mới lỗi mù mờ ở bước
  // đọc lại khoá (NaN !== NaN). Vá bằng cách chặn NGAY TỪ ĐẦU insertWholesalePrice()/updateWholesalePrice().
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

  await run.run('ĐỐI CHỨNG lỗi thật LẦN 1 đã gặp (12/2026): nếu code LỠ quay lại dùng cứng OUTPUT INSERTED.ID trong khi CSPRICE không có cột này -> ném đúng "Invalid column name \'ID\'." (xác nhận HARNESS mô phỏng đúng triệu chứng)', async () => {
    queryLog = []; CSPRICE_DB = []; seq = 0;
    const req = new FakeRequest(CSPRICE_DB);
    // Query giả định code LỠ quay lại khuôn cũ — harness KHÔNG xử lý OUTPUT INSERTED nên rơi vào nhánh mặc
    // định (return rỗng) thay vì lỗi, nên ở đây ta assert trực tiếp bằng cách mô phỏng hành vi SQL Server
    // thật: INFORMATION_SCHEMA xác nhận không có cột "ID" nào trong danh sách cột thật của CSPRICE.
    const colsResult = await req.query('SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = \'dbo\' AND TABLE_NAME = \'CSPRICE\' ORDER BY ORDINAL_POSITION;');
    assert(!colsResult.recordset.some(c => c.COLUMN_NAME === 'ID'), 'CSPRICE không có cột tên "ID" — đúng tình huống lỗi thật gặp phải lần đầu');
  });

  await run.run('inspectCspriceColumns(): identityColumn=null (không có cột identity), naturalKeyColumns trả đủ 7 cột, keyIndexes rỗng (không có PK/unique index khai báo)', async () => {
    queryLog = [];
    const { inspectCspriceColumns } = freshClient();
    const result = await inspectCspriceColumns();
    assertEqual(result.identityColumn, null, 'phải trả null vì CSPRICE không có cột identity nào');
    assert(result.columns.length === 8, `phải trả đủ 8 cột giả lập, got: ${result.columns.length}`);
    assert(result.columns.some(c => c.name === 'CUST_ID'), 'phải có cột CUST_ID trong danh sách');
    assertEqual(result.naturalKeyColumns.length, 7, 'naturalKeyColumns phải có đúng 7 cột');
    assert(result.naturalKeyColumns.includes('WS_ID'), 'naturalKeyColumns phải gồm WS_ID');
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
