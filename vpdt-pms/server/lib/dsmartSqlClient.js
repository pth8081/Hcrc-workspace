// lib/dsmartSqlClient.js — kết nối SQL Server RIÊNG tới hệ thống DSmart16 Trung Tâm (CSDL BÊN NGOÀI,
// KHÔNG phải CSDL app này — db.js) để ghi/sửa/xoá trực tiếp bảng CSPRICE, phục vụ tính năng Hỗ Trợ IT >
// "💰 Cài Đặt Giá Bán Buôn" (12/2026, theo yêu cầu người dùng). Thông tin kết nối đọc qua
// lib/dsmartPriceConfigStore.js (admin tự nhập qua màn Cấu Hình riêng, mật khẩu mã hoá 2 chiều).
//
// MAPPING CỘT (người dùng xác nhận trực tiếp qua trao đổi, KHÔNG đoán):
//   Mã Khách B2B -> CUST_ID   |  Mã Sản Phẩm -> SKU_ID  |  Giá Sản Phẩm -> WSPRICE
//   Ngày Bắt Đầu -> FR_DATE   |  Ngày Kết Thúc -> TO_DATE
// CSPRICE có cột ID TỰ TĂNG riêng (người dùng xác nhận) — insertWholesalePrice() lấy lại đúng ID này qua
// OUTPUT INSERTED.ID, lưu vào dbo.DsmartWholesalePriceEntries (mirror nội bộ) để mọi lượt Sửa/Xoá sau
// này khớp CHÍNH XÁC đúng 1 dòng theo ID, không đoán theo tổ hợp cột.
//
// RỦI RO CÒN TỒN ĐỌNG (nêu rõ, không giấu): CSPRICE có nhiều cột khác ngoài 5 cột trên (TYPE, STK_ID,
// UNIT_SYMB, BASE_UNIT, UNITCONV, LASTWSPR, SURP_PC, MINPRICE, MAXPRICE, MODIFY, OUT_DISCPC, OUT_CM...)
// mà người dùng xác nhận KHÔNG cần quan tâm/không có trong file mẫu — insertWholesalePrice() CHỈ ghi
// đúng 5 cột đã xác nhận, để SQL Server tự áp DEFAULT/NULL cho các cột còn lại. Nếu CSPRICE thật có cột
// NOT NULL không có DEFAULT ngoài 5 cột này, lượt ghi ĐẦU TIÊN sẽ báo lỗi rõ ràng (không bị nuốt lỗi, xem
// routes/dsmartWholesalePrice.js) — KHUYẾN NGHỊ người triển khai thử 1 dòng nhỏ trước khi dùng thật diện
// rộng, vì môi trường này không có quyền truy cập CSDL DSmart thật để tự kiểm tra trước.
//
// PHẠM VI AN TOÀN: mọi câu lệnh dưới đây đều dùng THAM SỐ HOÁ (sql.Request().input(), KHÔNG BAO GIỜ nối
// chuỗi giá trị người dùng trực tiếp vào SQL) — chống SQL injection đúng chuẩn đã áp dụng xuyên suốt
// toàn bộ hệ thống (xem db.js/lib/recordStore.js).
const sql = require('mssql');
const { getRawConfig, decryptSecret } = require('./dsmartPriceConfigStore');
const { HttpError } = require('./httpErrors');

let cachedPool = null;
let cachedSignature = null;
// cachedIdentityColumn (12/2026, xem resolveCspriceIdentityColumn() bên dưới) — PHẢI reset mỗi khi
// cachedPool đổi (kết nối khác CSDL khác có thể có tên cột identity khác), nên gán/xoá LUÔN ĐI CÙNG
// cachedPool ở mọi điểm trong file (không tách rời).
let cachedIdentityColumn = null;

function configSignature(cfg) {
  return [cfg.host, cfg.port, cfg.database, cfg.user, cfg.passwordEnc].join('|');
}

// Kế thừa HttpError (không phải Error thuần) để routes/dsmartWholesalePrice.js dùng chung được
// sendCatchError() (lib/errorResponse.js) — message ở đây LUÔN an toàn để hiển thị thẳng cho đội Hỗ Trợ
// IT (không phải lỗi nội bộ cần giấu ở production như lib/errorResponse.js mặc định): đây là công cụ kỹ
// thuật, đội vận hành CẦN thấy đúng lỗi SQL/kết nối thật để tự chẩn đoán (VD thiếu cột NOT NULL ở
// CSPRICE ngoài 5 cột đã xác nhận — xem rủi ro nêu ở đầu file).
class DsmartConfigError extends HttpError { constructor(message) { super(400, message); } }
class DsmartSqlError extends HttpError { constructor(message) { super(502, message); } }

// getDsmartPool(): mở (hoặc tái dùng) 1 ConnectionPool riêng cho DSmart16 Trung Tâm — tự đóng + mở lại
// nếu admin vừa đổi cấu hình (so sánh "chữ ký" cấu hình hiện tại với lần mở pool gần nhất).
async function getDsmartPool() {
  const cfg = await getRawConfig();
  if (!cfg || !cfg.host || !cfg.database || !cfg.user || !cfg.passwordEnc) {
    throw new DsmartConfigError('Chưa cấu hình kết nối DSmart16 Trung Tâm (Hỗ Trợ IT > Cài Đặt Giá Bán Buôn > Cấu Hình Kết Nối) — vui lòng nhập đủ Host/CSDL/Tài khoản/Mật khẩu trước.');
  }
  const sig = configSignature(cfg);
  if (cachedPool && cachedSignature === sig) return cachedPool;
  if (cachedPool) {
    try { await cachedPool.close(); } catch (_) { /* phớt lờ lỗi đóng pool cũ, không chặn mở pool mới */ }
    cachedPool = null;
    cachedIdentityColumn = null; // đổi pool -> có thể đổi CSDL -> xoá cache tên cột identity cũ (xem resolveCspriceIdentityColumn()).
  }
  let password;
  try {
    password = decryptSecret(cfg.passwordEnc);
  } catch (err) {
    throw new DsmartConfigError('Không giải mã được mật khẩu DSmart16 Trung Tâm đã lưu — vui lòng vào Cấu Hình Kết Nối nhập lại mật khẩu.');
  }
  const pool = new sql.ConnectionPool({
    server: cfg.host,
    port: cfg.port || 1433,
    database: cfg.database,
    user: cfg.user,
    password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 15000,
    connectionTimeout: 15000
  });
  try {
    await pool.connect();
  } catch (err) {
    throw new DsmartConfigError(`Không kết nối được tới DSmart16 Trung Tâm (${cfg.host}:${cfg.port}/${cfg.database}): ${err.message}`);
  }
  cachedPool = pool;
  cachedSignature = sig;
  return pool;
}

// Format ngày sang 'YYYY-MM-DD' (an toàn cho sql.Date, không phụ thuộc định dạng vùng miền của SQL
// Server) — frDate/toDate truyền vào đã là chuỗi 'YYYY-MM-DD' hoặc Date, chuẩn hoá cho chắc.
function toDateOnly(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new DsmartSqlError(`Giá trị ngày không hợp lệ: ${value}`);
  return d;
}

// resolveCspriceIdentityColumn(pool): TỰ TRA CỨU tên cột ID tự tăng (identity) THẬT của dbo.CSPRICE
// ngay trên CSDL DSmart16 — KHÔNG còn đoán/hard-code "ID" như trước.
//
// LỖI THẬT PRODUCTION đã phát hiện (12/2026, người dùng báo "Team IT của tôi vừa up giá ghi vào dsmart
// nhưng lỗi" kèm ảnh chụp — SAU KHI đã vá cho hiện lỗi thật thay vì chỉ "xem console", lỗi THẬT hiện ra
// là "Invalid column name 'ID'."): giả định "CSPRICE có cột ID tự tăng" (ghi ở đầu file, nói là người
// dùng đã xác nhận qua trao đổi) hoá ra SAI trên CSDL thật — mọi lượt ghi/sửa/xoá đều lỗi ngay từ dòng
// đầu tiên vì OUTPUT INSERTED.ID/WHERE ID=... dùng cứng tên cột không tồn tại. KHÔNG thể tự đoán lại tên
// cột đúng (môi trường phát triển này không truy cập được CSDL DSmart thật) — thay vào đó TỰ TRA CỨU qua
// sys.identity_columns (catalog view chuẩn của SQL Server, luôn đúng bất kể tên cột thật là gì) mỗi khi
// mở pool mới, cache lại (cachedIdentityColumn, reset cùng lúc với cachedPool ở getDsmartPool()) để không
// phải tra lại mỗi lượt ghi.
//
// AN TOÀN SQL INJECTION: tên cột không thể tham số hoá qua sql.Request().input() (chỉ tham số hoá được
// GIÁ TRỊ, không tham số hoá được TÊN cột/bảng) — nhưng giá trị trả về ở đây đến từ chính catalog view
// sys.identity_columns của SQL Server (không phải input người dùng), và CÒN được validate thêm bằng regex
// allow-list /^[A-Za-z0-9_]+$/ trước khi nối thẳng vào câu lệnh — loại hẳn rủi ro dù tên cột là gì.
async function resolveCspriceIdentityColumn(pool) {
  if (cachedIdentityColumn) return cachedIdentityColumn;
  let idResult;
  try {
    idResult = await pool.request().query(`
      SELECT c.name AS ColumnName
      FROM sys.identity_columns c
      WHERE OBJECT_NAME(c.object_id) = 'CSPRICE';
    `);
  } catch (err) {
    throw new DsmartSqlError(`Lỗi tra cứu cột ID tự tăng của CSPRICE: ${err.message}`);
  }
  const colName = idResult.recordset?.[0]?.ColumnName;
  if (!colName || !/^[A-Za-z0-9_]+$/.test(colName)) {
    throw new DsmartSqlError('Không tìm thấy cột ID tự tăng (identity) nào trên bảng CSPRICE — dùng nút "🔍 Kiểm Tra Cấu Trúc Bảng CSPRICE" ở Cấu Hình Kết Nối để xem đầy đủ danh sách cột, rồi liên hệ đội phát triển xác nhận lại cột nào dùng làm khoá.');
  }
  cachedIdentityColumn = colName;
  return colName;
}

// insertWholesalePrice(): THÊM 1 dòng MỚI vào CSPRICE — CHỈ 5 cột đã xác nhận, trả lại ID tự tăng CSPRICE
// vừa tạo (OUTPUT INSERTED.<cột identity thật>, xem resolveCspriceIdentityColumn()) để lưu vào mirror
// nội bộ.
async function insertWholesalePrice({ custId, skuId, price, frDate, toDate }) {
  const pool = await getDsmartPool();
  const idCol = await resolveCspriceIdentityColumn(pool);
  const req = pool.request();
  req.input('custId', sql.NVarChar(50), String(custId));
  req.input('skuId', sql.NVarChar(50), String(skuId));
  req.input('price', sql.Decimal(18, 4), Number(price));
  req.input('frDate', sql.Date, toDateOnly(frDate));
  req.input('toDate', sql.Date, toDateOnly(toDate));
  try {
    const result = await req.query(`
      INSERT INTO dbo.CSPRICE (CUST_ID, SKU_ID, WSPRICE, FR_DATE, TO_DATE)
      OUTPUT INSERTED.[${idCol}] AS Id
      VALUES (@custId, @skuId, @price, @frDate, @toDate);
    `);
    const dsmartId = result.recordset?.[0]?.Id;
    if (dsmartId == null) throw new DsmartSqlError(`DSmart không trả lại ID của dòng vừa thêm (OUTPUT INSERTED.[${idCol}] rỗng) — kiểm tra lại cột ${idCol} trên CSPRICE có đúng là tự tăng không.`);
    return dsmartId;
  } catch (err) {
    if (err instanceof DsmartSqlError) throw err;
    throw new DsmartSqlError(`Lỗi ghi CSPRICE (THÊM MỚI, CUST_ID=${custId}, SKU_ID=${skuId}): ${err.message}`);
  }
}

// updateWholesalePrice(): SỬA đúng 1 dòng đã có sẵn (theo dsmartId) — CHỈ sửa Giá/Ngày, không đụng cột
// nào khác (TYPE/UNIT_SYMB/MINPRICE/MAXPRICE/LASTWSPR... giữ nguyên nguyên trạng bên DSmart).
async function updateWholesalePrice({ dsmartId, price, frDate, toDate }) {
  const pool = await getDsmartPool();
  const idCol = await resolveCspriceIdentityColumn(pool);
  const req = pool.request();
  req.input('dsmartId', sql.BigInt, dsmartId);
  req.input('price', sql.Decimal(18, 4), Number(price));
  req.input('frDate', sql.Date, toDateOnly(frDate));
  req.input('toDate', sql.Date, toDateOnly(toDate));
  let result;
  try {
    result = await req.query(`
      UPDATE dbo.CSPRICE SET WSPRICE = @price, FR_DATE = @frDate, TO_DATE = @toDate
      WHERE [${idCol}] = @dsmartId;
    `);
  } catch (err) {
    throw new DsmartSqlError(`Lỗi ghi CSPRICE (SỬA, ${idCol}=${dsmartId}): ${err.message}`);
  }
  if (!result.rowsAffected?.[0]) {
    throw new DsmartSqlError(`Không tìm thấy dòng ${idCol}=${dsmartId} trong CSPRICE để sửa — có thể đã bị xoá thủ công ngoài hệ thống này.`);
  }
}

// deleteWholesalePrice(): XOÁ THẬT đúng 1 dòng (theo dsmartId) khỏi CSPRICE — KHÔNG hoàn tác được.
async function deleteWholesalePrice({ dsmartId }) {
  const pool = await getDsmartPool();
  const idCol = await resolveCspriceIdentityColumn(pool);
  const req = pool.request();
  req.input('dsmartId', sql.BigInt, dsmartId);
  let result;
  try {
    result = await req.query(`DELETE FROM dbo.CSPRICE WHERE [${idCol}] = @dsmartId;`);
  } catch (err) {
    throw new DsmartSqlError(`Lỗi xoá CSPRICE (${idCol}=${dsmartId}): ${err.message}`);
  }
  if (!result.rowsAffected?.[0]) {
    // Dòng không còn tồn tại (có thể đã bị xoá thủ công/lần trước) — KHÔNG ném lỗi (coi như đã đạt mục
    // tiêu "dòng này không còn trong CSPRICE"), chỉ báo rõ cho caller để ghi chú lại lịch sử.
    return { alreadyGone: true };
  }
  return { alreadyGone: false };
}

// testDsmartConnection(overrideCfg): kiểm tra kết nối NGAY — dùng cho nút "🔌 Kiểm Tra Kết Nối" ở màn
// Cấu Hình Kết Nối (12/2026, theo yêu cầu người dùng). Có 2 chế độ:
//  - overrideCfg CÓ giá trị (đang gõ dở trên form, CHƯA bấm Lưu): mở 1 pool TẠM THỜI RIÊNG (không đụng
//    tới cachedPool đang dùng cho ghi dữ liệu thật), test xong đóng ngay — để admin kiểm tra trước khi
//    lưu, tránh lưu nhầm cấu hình sai rồi mới phát hiện lúc Thêm Giá Mới thật.
//  - overrideCfg KHÔNG truyền: test đúng cấu hình ĐÃ LƯU, tái dùng getDsmartPool() (đúng pool cache dùng
//    cho ghi dữ liệu thật — không mở thêm kết nối thừa).
// Câu lệnh kiểm tra CHỈ "SELECT 1" (hằng số, không đụng bảng nào) — không cần quyền SELECT trên CSPRICE,
// khớp đúng tài khoản chỉ được GRANT INSERT/UPDATE/DELETE (xem hướng dẫn tạo tài khoản đã trao đổi).
async function testDsmartConnection(overrideCfg) {
  if (!overrideCfg) {
    const pool = await getDsmartPool();
    const started = Date.now();
    await pool.request().query('SELECT 1 AS ok;');
    return { ms: Date.now() - started };
  }
  const { host, port, database, user, password } = overrideCfg;
  if (!host || !database || !user || !password) {
    throw new DsmartConfigError('Thiếu Host/Tên CSDL/Tài khoản/Mật khẩu để kiểm tra kết nối.');
  }
  const pool = new sql.ConnectionPool({
    server: host,
    port: port || 1433,
    database,
    user,
    password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    pool: { max: 1, min: 0, idleTimeoutMillis: 5000 },
    requestTimeout: 10000,
    connectionTimeout: 10000
  });
  const started = Date.now();
  try {
    await pool.connect();
    await pool.request().query('SELECT 1 AS ok;');
  } catch (err) {
    throw new DsmartConfigError(`Không kết nối được tới DSmart16 Trung Tâm (${host}:${port || 1433}/${database}): ${err.message}`);
  } finally {
    try { await pool.close(); } catch (_) { /* phớt lờ lỗi đóng pool tạm, không ảnh hưởng kết quả test */ }
  }
  return { ms: Date.now() - started };
}

// inspectCspriceColumns(overrideCfg): LIỆT KÊ THẬT các cột của dbo.CSPRICE trên DSmart16 Trung Tâm +
// cột nào là ID tự tăng (identity) — nút "🔍 Kiểm Tra Cấu Trúc Bảng CSPRICE" (12/2026).
//
// LỖI THẬT PRODUCTION đã phát hiện (người dùng báo "Team IT của tôi vừa up giá ghi vào dsmart nhưng lỗi"
// kèm ảnh chụp, SAU KHI đã vá cho hiện lỗi thật thay vì "xem console" — xem module-itsupport-dsmartprice.js):
// lỗi thật là "Invalid column name 'ID'." — giả định "CSPRICE có cột ID tự tăng" (ghi ở đầu file này,
// nói là NGƯỜI DÙNG đã xác nhận qua trao đổi) hoá ra SAI trên CSDL DSmart16 thật — insertWholesalePrice()/
// updateWholesalePrice()/deleteWholesalePrice() đều dùng cứng tên cột "ID" (OUTPUT INSERTED.ID, WHERE
// ID=...), nên MỌI lượt ghi/sửa/xoá đều lỗi ngay từ dòng đầu tiên. KHÔNG thể tự đoán tên cột thật đúng
// (môi trường phát triển này không có quyền truy cập CSDL DSmart thật) — thay vào đó cung cấp công cụ để
// CHÍNH đội IT tự tra cứu ngay trên UI (không cần nhờ DBA/mở SSMS), từ đó xác nhận lại tên cột thật rồi
// mới sửa cứng insertWholesalePrice()/updateWholesalePrice()/deleteWholesalePrice() cho đúng.
//
// CHỈ ĐỌC METADATA (INFORMATION_SCHEMA.COLUMNS + sys.identity_columns) — KHÔNG đọc bất kỳ dữ liệu THẬT
// nào trong CSPRICE, nên KHÔNG cần quyền SELECT trên dữ liệu bảng (cùng tinh thần testDsmartConnection()
// "SELECT 1" ở trên — tài khoản chỉ GRANT INSERT/UPDATE/DELETE vẫn thấy được metadata của bảng mình có
// ít nhất 1 quyền, đây là hành vi chuẩn của SQL Server, không phải giả định).
async function inspectCspriceColumns(overrideCfg) {
  let pool;
  let shouldClose = false;
  if (overrideCfg) {
    const { host, port, database, user, password } = overrideCfg;
    if (!host || !database || !user || !password) {
      throw new DsmartConfigError('Thiếu Host/Tên CSDL/Tài khoản/Mật khẩu để kiểm tra cấu trúc bảng.');
    }
    pool = new sql.ConnectionPool({
      server: host, port: port || 1433, database, user, password,
      options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
      pool: { max: 1, min: 0, idleTimeoutMillis: 5000 },
      requestTimeout: 10000, connectionTimeout: 10000
    });
    try {
      await pool.connect();
    } catch (err) {
      throw new DsmartConfigError(`Không kết nối được tới DSmart16 Trung Tâm (${host}:${port || 1433}/${database}): ${err.message}`);
    }
    shouldClose = true;
  } else {
    pool = await getDsmartPool();
  }
  try {
    const colsResult = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'CSPRICE'
      ORDER BY ORDINAL_POSITION;
    `);
    const idResult = await pool.request().query(`
      SELECT c.name AS ColumnName
      FROM sys.identity_columns c
      WHERE OBJECT_NAME(c.object_id) = 'CSPRICE';
    `);
    const columns = (colsResult.recordset || []).map(r => ({ name: r.COLUMN_NAME, dataType: r.DATA_TYPE, nullable: r.IS_NULLABLE === 'YES' }));
    if (!columns.length) {
      throw new DsmartSqlError('Không thấy cột nào của dbo.CSPRICE — kiểm tra lại tên CSDL/quyền của tài khoản (cần ít nhất 1 quyền INSERT/UPDATE/DELETE/SELECT trên bảng CSPRICE để thấy được metadata).');
    }
    const identityColumn = idResult.recordset?.[0]?.ColumnName || null;
    return { columns, identityColumn };
  } catch (err) {
    if (err instanceof DsmartSqlError || err instanceof DsmartConfigError) throw err;
    throw new DsmartSqlError(`Lỗi đọc cấu trúc bảng CSPRICE: ${err.message}`);
  } finally {
    if (shouldClose) { try { await pool.close(); } catch (_) { /* phớt lờ lỗi đóng pool tạm */ } }
  }
}

// Chỉ dùng cho test/khi server tắt hẳn — đóng pool đang cache (nếu có).
async function closeDsmartPool() {
  if (cachedPool) {
    try { await cachedPool.close(); } catch (_) { /* ignore */ }
    cachedPool = null;
    cachedSignature = null;
    cachedIdentityColumn = null;
  }
}

module.exports = {
  getDsmartPool, insertWholesalePrice, updateWholesalePrice, deleteWholesalePrice, closeDsmartPool,
  testDsmartConnection, inspectCspriceColumns, DsmartConfigError, DsmartSqlError
};
