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

// insertWholesalePrice(): THÊM 1 dòng MỚI vào CSPRICE — CHỈ 5 cột đã xác nhận, trả lại ID tự tăng CSPRICE
// vừa tạo (OUTPUT INSERTED.ID) để lưu vào mirror nội bộ.
async function insertWholesalePrice({ custId, skuId, price, frDate, toDate }) {
  const pool = await getDsmartPool();
  const req = pool.request();
  req.input('custId', sql.NVarChar(50), String(custId));
  req.input('skuId', sql.NVarChar(50), String(skuId));
  req.input('price', sql.Decimal(18, 4), Number(price));
  req.input('frDate', sql.Date, toDateOnly(frDate));
  req.input('toDate', sql.Date, toDateOnly(toDate));
  try {
    const result = await req.query(`
      INSERT INTO dbo.CSPRICE (CUST_ID, SKU_ID, WSPRICE, FR_DATE, TO_DATE)
      OUTPUT INSERTED.ID
      VALUES (@custId, @skuId, @price, @frDate, @toDate);
    `);
    const dsmartId = result.recordset?.[0]?.ID;
    if (dsmartId == null) throw new DsmartSqlError('DSmart không trả lại ID của dòng vừa thêm (OUTPUT INSERTED.ID rỗng) — kiểm tra lại cột ID trên CSPRICE có đúng là tự tăng không.');
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
  const req = pool.request();
  req.input('dsmartId', sql.BigInt, dsmartId);
  req.input('price', sql.Decimal(18, 4), Number(price));
  req.input('frDate', sql.Date, toDateOnly(frDate));
  req.input('toDate', sql.Date, toDateOnly(toDate));
  let result;
  try {
    result = await req.query(`
      UPDATE dbo.CSPRICE SET WSPRICE = @price, FR_DATE = @frDate, TO_DATE = @toDate
      WHERE ID = @dsmartId;
    `);
  } catch (err) {
    throw new DsmartSqlError(`Lỗi ghi CSPRICE (SỬA, ID=${dsmartId}): ${err.message}`);
  }
  if (!result.rowsAffected?.[0]) {
    throw new DsmartSqlError(`Không tìm thấy dòng ID=${dsmartId} trong CSPRICE để sửa — có thể đã bị xoá thủ công ngoài hệ thống này.`);
  }
}

// deleteWholesalePrice(): XOÁ THẬT đúng 1 dòng (theo dsmartId) khỏi CSPRICE — KHÔNG hoàn tác được.
async function deleteWholesalePrice({ dsmartId }) {
  const pool = await getDsmartPool();
  const req = pool.request();
  req.input('dsmartId', sql.BigInt, dsmartId);
  let result;
  try {
    result = await req.query('DELETE FROM dbo.CSPRICE WHERE ID = @dsmartId;');
  } catch (err) {
    throw new DsmartSqlError(`Lỗi xoá CSPRICE (ID=${dsmartId}): ${err.message}`);
  }
  if (!result.rowsAffected?.[0]) {
    // Dòng không còn tồn tại (có thể đã bị xoá thủ công/lần trước) — KHÔNG ném lỗi (coi như đã đạt mục
    // tiêu "dòng này không còn trong CSPRICE"), chỉ báo rõ cho caller để ghi chú lại lịch sử.
    return { alreadyGone: true };
  }
  return { alreadyGone: false };
}

// Chỉ dùng cho test/khi server tắt hẳn — đóng pool đang cache (nếu có).
async function closeDsmartPool() {
  if (cachedPool) {
    try { await cachedPool.close(); } catch (_) { /* ignore */ }
    cachedPool = null;
    cachedSignature = null;
  }
}

module.exports = {
  getDsmartPool, insertWholesalePrice, updateWholesalePrice, deleteWholesalePrice, closeDsmartPool,
  DsmartConfigError, DsmartSqlError
};
