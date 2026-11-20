// lib/dsmartSqlClient.js — kết nối SQL Server RIÊNG tới hệ thống DSmart16 Trung Tâm (CSDL BÊN NGOÀI,
// KHÔNG phải CSDL app này — db.js) để ghi/sửa/xoá trực tiếp bảng CSPRICE, phục vụ tính năng Hỗ Trợ IT >
// "💰 Cài Đặt Giá Bán Buôn" (12/2026, theo yêu cầu người dùng). Thông tin kết nối đọc qua
// lib/dsmartPriceConfigStore.js (admin tự nhập qua màn Cấu Hình riêng, mật khẩu mã hoá 2 chiều).
//
// MAPPING CỘT (người dùng xác nhận trực tiếp qua trao đổi, KHÔNG đoán):
//   Mã Khách B2B -> CUST_ID   |  Mã Sản Phẩm -> SKU_ID  |  Giá Sản Phẩm -> WSPRICE
//   Ngày Bắt Đầu -> FR_DATE   |  Ngày Kết Thúc -> TO_DATE
//
// KHOÁ TỰ NHIÊN, KHÔNG PHẢI ID TỰ TĂNG (12/2026, PHÁT HIỆN LẦN 2 — đợt vá trước giả định CSPRICE "có cột
// ID tự tăng" vẫn SAI): người dùng gửi ảnh chụp thật nút "🔍 Kiểm Tra Cấu Trúc Bảng CSPRICE" — CSPRICE
// HOÀN TOÀN KHÔNG CÓ cột identity/auto-increment nào (23 cột, không cột nào là identity). Tra `sys.
// identity_columns` trả về RỖNG — không phải lỗi dò tên cột sai như lần trước, mà bảng này THỰC SỰ dùng
// KHOÁ TỰ NHIÊN (composite key) nhiều cột, không có surrogate key riêng.
//
// Vì vậy insertWholesalePrice()/updateWholesalePrice()/deleteWholesalePrice() bên dưới KHÔNG còn dựa vào
// 1 cột ID duy nhất — thay vào đó dùng tổ hợp CUST_ID + TYPE + STK_ID + SKU_ID + WS_ID + FR_DATE + TO_DATE
// (suy luận từ cấu trúc bảng thật: khách hàng + loại giá + kho/quầy + sản phẩm + bảng giá + khoảng ngày
// hiệu lực — đúng mô hình "giá đặc biệt theo khách hàng" phổ biến ở ERP; KHÔNG gồm WSPRICE vì đó là giá
// trị SẼ bị đổi khi Sửa, và KHÔNG gồm các cột sổ sách như OPEN_DATE/MODI_DATE/MODIFY/USER_ID vì có thể bị
// hệ thống khác đụng tới ngoài tầm kiểm soát). insertWholesalePrice() đọc lại NGAY dòng vừa thêm (SELECT
// theo đúng 5 giá trị vừa ghi) để lấy đủ 7 cột khoá trên (gồm cả TYPE/STK_ID/WS_ID do SQL Server tự áp
// DEFAULT, ứng dụng không ghi trực tiếp) — lưu nguyên "khoá tự nhiên" này (dsmartKey) vào
// dbo.DsmartWholesalePriceEntries (mirror nội bộ) để Sửa/Xoá sau này khớp lại.
//
// AN TOÀN CHỐNG SỬA/XOÁ NHẦM: vì đây là khoá SUY LUẬN (không phải PRIMARY KEY khai báo chính thức trên
// CSPRICE — môi trường này không truy cập được CSDL thật để xác nhận 100%), updateWholesalePrice()/
// deleteWholesalePrice() LUÔN đếm SELECT COUNT(*) theo đúng khoá tự nhiên TRƯỚC khi UPDATE/DELETE — nếu
// khớp 0 dòng (đã bị xoá/sửa thủ công ngoài hệ thống) hoặc KHỚP HƠN 1 DÒNG (khoá suy luận không còn duy
// nhất — rủi ro sửa/xoá nhầm dòng của khách khác) thì DỪNG LẠI NGAY, báo lỗi rõ ràng, không bao giờ âm
// thầm UPDATE/DELETE mù. Sau UPDATE/DELETE còn double-check lại rowsAffected đúng bằng 1 lần nữa.
//
// RỦI RO CÒN TỒN ĐỌNG (nêu rõ, không giấu): nếu suy luận khoá tự nhiên ở trên KHÔNG đúng 100% ý đồ thiết
// kế thật của DSmart (VD TO_DATE không thực sự là 1 phần khoá phân biệt), các lớp an toàn (đếm trước khi
// ghi, chặn khớp >1 dòng) sẽ TỰ CHẶN và báo lỗi rõ ràng thay vì âm thầm sửa/xoá sai — nhưng vẫn khuyến
// nghị đội IT dùng nút "🔍 Kiểm Tra Cấu Trúc Bảng CSPRICE" (đã mở rộng hiển thị PRIMARY KEY/UNIQUE INDEX
// khai báo thật trên CSPRICE nếu có) để xác nhận lại với đội DSmart/DBA trước khi dùng thật diện rộng.
//
// PHẠM VI AN TOÀN: mọi câu lệnh dưới đây đều dùng THAM SỐ HOÁ (sql.Request().input(), KHÔNG BAO GIỜ nối
// chuỗi giá trị người dùng trực tiếp vào SQL) — chống SQL injection đúng chuẩn đã áp dụng xuyên suốt
// toàn bộ hệ thống (xem db.js/lib/recordStore.js).
const sql = require('mssql');
const { getRawConfig, decryptSecret } = require('./dsmartPriceConfigStore');
const { HttpError } = require('./httpErrors');

let cachedPool = null;
let cachedSignature = null;

// NATURAL_KEY_COLUMNS: 7 cột tạo thành "khoá tự nhiên" dùng để khớp CHÍNH XÁC 1 dòng CSPRICE khi Sửa/Xoá
// (xem chú thích đầy đủ ở đầu file) — thứ tự liệt kê ở đây chỉ để tham chiếu, KHÔNG ảnh hưởng câu lệnh SQL
// (mỗi câu lệnh tự liệt kê tường minh, không loop động, để dễ đọc/dễ rà soát khi audit).
const NATURAL_KEY_COLUMNS = ['CUST_ID', 'TYPE', 'STK_ID', 'SKU_ID', 'WS_ID', 'FR_DATE', 'TO_DATE'];

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

// captureCspriceNaturalKey(pool, {custId, skuId, frDate, toDate}): đọc lại NGAY dòng CSPRICE vừa
// INSERT/UPDATE theo ĐÚNG 4 giá trị định danh nghiệp vụ (CUST_ID/SKU_ID/FR_DATE/TO_DATE — đúng mô hình
// "1 dòng/cặp khách-sản phẩm, phân biệt bởi khoảng ngày hiệu lực" đã xác nhận ở đầu
// routes/dsmartWholesalePrice.js), lấy đủ 7 cột tạo "khoá tự nhiên" NATURAL_KEY_COLUMNS (gồm cả
// TYPE/STK_ID/WS_ID do SQL Server tự áp DEFAULT, ứng dụng không ghi trực tiếp) — xem chú thích đầy đủ ở
// đầu file.
//
// KHÔNG khớp thêm theo WSPRICE (audit chéo 12/2026 phát hiện): cột WSPRICE khai báo kiểu `numeric` nhưng
// KHÔNG xác nhận được chính xác precision/scale thật trên CSDL DSmart (môi trường này không truy cập được
// để kiểm chứng) — nếu cột thật làm tròn số thập phân khác với `sql.Decimal(18,4)` phía ứng dụng, so sánh
// bằng `=` có thể trật dù INSERT/UPDATE vừa THÀNH CÔNG, khiến hệ thống báo lỗi "không đọc lại được" dù dữ
// liệu đã ghi đúng. 4 cột CUST_ID/SKU_ID/FR_DATE/TO_DATE (kiểu char/datetime, không có rủi ro làm tròn) đã
// đủ xác định đúng dòng vừa ghi trong mọi tình huống thực tế.
//
// Nếu khớp NHIỀU hơn 1 dòng (hiếm — trùng hệt cả 4 giá trị với 1 dòng có sẵn từ trước, VD nhập tay ngoài
// hệ thống này, hoặc 2 dòng có giá khác nhau cho CÙNG khoảng ngày — vốn đã được cảnh báo mềm ở bước xem
// trước "Thêm Giá Mới"): lấy dòng có OPEN_DATE/MODI_DATE MỚI NHẤT (gần như chắc chắn là dòng vừa ghi),
// đánh dấu ambiguousMatch=true để caller biết mà cẩn trọng hơn khi Sửa/Xoá dòng này sau này (dù vẫn còn
// lớp an toàn đếm COUNT(*) trong transaction ở updateWholesalePrice()/deleteWholesalePrice() chặn thêm 1
// lần nữa, xem runGuardedNaturalKeyWrite()).
async function captureCspriceNaturalKey(pool, { custId, skuId, frDate, toDate }) {
  const req = pool.request();
  req.input('custId', sql.NVarChar(50), String(custId));
  req.input('skuId', sql.NVarChar(50), String(skuId));
  req.input('frDate', sql.DateTime, toDateOnly(frDate));
  req.input('toDate', sql.DateTime, toDateOnly(toDate));
  let result;
  try {
    result = await req.query(`
      SELECT CUST_ID, TYPE, STK_ID, SKU_ID, WS_ID, FR_DATE, TO_DATE
      FROM dbo.CSPRICE
      WHERE CUST_ID = @custId AND SKU_ID = @skuId AND FR_DATE = @frDate AND TO_DATE = @toDate
      ORDER BY OPEN_DATE DESC, MODI_DATE DESC;
    `);
  } catch (err) {
    throw new DsmartSqlError(`Đã ghi CSPRICE nhưng lỗi khi đọc lại khoá tự nhiên của dòng vừa ghi: ${err.message}`);
  }
  const rows = result.recordset || [];
  if (!rows.length) {
    throw new DsmartSqlError('Đã ghi CSPRICE nhưng không đọc lại được dòng vừa ghi để xác định khoá tự nhiên — dữ liệu CÓ THỂ đã được ghi dù hệ thống này báo lỗi ở bước xác nhận, kiểm tra thủ công trên DSmart.');
  }
  const row = rows[0];
  return {
    custId: String(row.CUST_ID).trim(), type: String(row.TYPE).trim(), stkId: String(row.STK_ID),
    skuId: String(row.SKU_ID).trim(), wsId: row.WS_ID, frDate: row.FR_DATE, toDate: row.TO_DATE,
    ambiguousMatch: rows.length > 1
  };
}

// buildNaturalKeyWhere(req, dsmartKey): gán tham số hoá đủ 7 cột khoá tự nhiên vào request SQL đã cho,
// trả về mệnh đề WHERE tương ứng — dùng CHUNG cho cả bước đếm COUNT(*) lẫn bước UPDATE/DELETE thật bên
// dưới, đảm bảo 2 bước LUÔN khớp đúng cùng 1 điều kiện.
function buildNaturalKeyWhere(req, dsmartKey) {
  if (!dsmartKey || typeof dsmartKey !== 'object') {
    throw new DsmartSqlError('Thiếu khoá tự nhiên (dsmartKey) của dòng CSPRICE cần sửa/xoá — dữ liệu nội bộ có thể bị hỏng, liên hệ đội phát triển.');
  }
  const { custId, type, stkId, skuId, wsId, frDate, toDate } = dsmartKey;
  if (custId == null || type == null || stkId == null || skuId == null || wsId == null || frDate == null || toDate == null) {
    throw new DsmartSqlError(`Khoá tự nhiên (dsmartKey) thiếu 1 trong các trường ${NATURAL_KEY_COLUMNS.join('/')}  — không thể xác định đúng 1 dòng CSPRICE để sửa/xoá an toàn.`);
  }
  req.input('kCustId', sql.NVarChar(50), String(custId));
  req.input('kType', sql.NVarChar(20), String(type));
  req.input('kStkId', sql.NVarChar(50), String(stkId));
  req.input('kSkuId', sql.NVarChar(50), String(skuId));
  req.input('kWsId', sql.Int, Number(wsId));
  req.input('kFrDate', sql.DateTime, toDateOnly(frDate));
  req.input('kToDate', sql.DateTime, toDateOnly(toDate));
  return 'CUST_ID = @kCustId AND TYPE = @kType AND STK_ID = @kStkId AND SKU_ID = @kSkuId AND WS_ID = @kWsId AND FR_DATE = @kFrDate AND TO_DATE = @kToDate';
}

// runGuardedNaturalKeyWrite(pool, dsmartKey, action, writeFn): audit chéo (12/2026, 2 agent độc lập) phát
// hiện RỦI RO THẬT trong bản vá đầu tiên (đếm COUNT(*) rồi UPDATE/DELETE qua 2 round-trip TÁCH RỜI, không
// transaction) — nếu có 1 lượt ghi KHÁC chen đúng vào giữa 2 round-trip đó (VD 2 tab admin cùng sửa gần
// như đồng thời), UPDATE/DELETE vẫn có thể CHẠM tới nhiều hơn 1 dòng TRƯỚC KHI code kịp phát hiện ở bước
// kiểm tra rowsAffected sau đó — phát hiện ra thì dữ liệu đã bị ảnh hưởng rồi, không còn "dừng lại trước
// khi ghi" như bình luận cũ khẳng định.
//
// VÁ: gộp ĐẾM + GHI vào 1 TRANSACTION SQL THẬT (sql.Transaction) — đếm bằng `WITH (UPDLOCK, HOLDLOCK)`
// NGAY TRONG transaction đó để KHOÁ các dòng khớp lại tới khi commit/rollback, chặn mọi lượt ghi khác (kể
// cả từ chính ứng dụng này ở 1 request song song khác) chen vào giữa bước đếm và bước ghi thật. Đếm khác 1
// -> ROLLBACK ngay, KHÔNG BAO GIỜ chạy writeFn. Đếm đúng 1 -> chạy writeFn trong CÙNG transaction rồi mới
// COMMIT. Bất kỳ lỗi nào giữa chừng đều ROLLBACK (không để transaction treo nửa chừng).
async function runGuardedNaturalKeyWrite(pool, dsmartKey, action, writeFn) {
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
  } catch (err) {
    throw new DsmartSqlError(`Lỗi mở giao dịch (transaction) CSPRICE trước khi ${action}: ${err.message}`);
  }
  try {
    const countReq = transaction.request();
    const whereClause = buildNaturalKeyWhere(countReq, dsmartKey);
    let countResult;
    try {
      countResult = await countReq.query(`SELECT COUNT(*) AS Cnt FROM dbo.CSPRICE WITH (UPDLOCK, HOLDLOCK) WHERE ${whereClause};`);
    } catch (err) {
      throw new DsmartSqlError(`Lỗi kiểm tra dòng CSPRICE trước khi ${action}: ${err.message}`);
    }
    const cnt = countResult.recordset?.[0]?.Cnt ?? 0;
    if (cnt === 0) {
      await transaction.commit(); // không có gì cần khoá thêm — commit cho sạch (không có thay đổi nào để mất nếu rollback)
      return { matchCount: 0, writeResult: null };
    }
    if (cnt > 1) {
      // KHÔNG tự rollback ở đây — để DUY NHẤT khối catch bên dưới xử lý rollback (tránh gọi rollback() 2
      // lần: throw ở đây rơi thẳng xuống catch, catch rollback xong rồi mới re-throw ra ngoài).
      throw new DsmartSqlError(`Khoá tự nhiên đã lưu khớp ${cnt} dòng CSPRICE (không còn DUY NHẤT) — DỪNG LẠI để tránh ${action} nhầm dòng của khách/sản phẩm khác, liên hệ đội phát triển kiểm tra thủ công trước khi thử lại.`);
    }
    const writeReq = transaction.request();
    const writeResult = await writeFn(writeReq);
    await transaction.commit();
    return { matchCount: 1, writeResult };
  } catch (err) {
    try { await transaction.rollback(); } catch (_) { /* transaction có thể đã tự đóng nếu lỗi kết nối giữa chừng — bỏ qua lỗi rollback */ }
    if (err instanceof DsmartSqlError) throw err;
    throw new DsmartSqlError(`Lỗi giao dịch CSPRICE khi ${action}: ${err.message}`);
  }
}

// insertWholesalePrice(): THÊM 1 dòng MỚI vào CSPRICE — CHỈ 5 cột đã xác nhận (SQL Server tự áp DEFAULT
// cho các cột còn lại, xem rủi ro nêu ở đầu file) — trả lại "khoá tự nhiên" (dsmartKey, xem
// captureCspriceNaturalKey()) để lưu vào mirror nội bộ, dùng cho Sửa/Xoá sau này.
async function insertWholesalePrice({ custId, skuId, price, frDate, toDate }) {
  if (!Number.isFinite(Number(price))) {
    throw new DsmartSqlError(`Giá trị Giá không hợp lệ: ${price}`);
  }
  const pool = await getDsmartPool();
  const req = pool.request();
  req.input('custId', sql.NVarChar(50), String(custId));
  req.input('skuId', sql.NVarChar(50), String(skuId));
  req.input('price', sql.Decimal(18, 4), Number(price));
  req.input('frDate', sql.DateTime, toDateOnly(frDate));
  req.input('toDate', sql.DateTime, toDateOnly(toDate));
  try {
    await req.query(`
      INSERT INTO dbo.CSPRICE (CUST_ID, SKU_ID, WSPRICE, FR_DATE, TO_DATE)
      VALUES (@custId, @skuId, @price, @frDate, @toDate);
    `);
  } catch (err) {
    throw new DsmartSqlError(`Lỗi ghi CSPRICE (THÊM MỚI, CUST_ID=${custId}, SKU_ID=${skuId}): ${err.message}`);
  }
  return captureCspriceNaturalKey(pool, { custId, skuId, frDate, toDate });
}

// updateWholesalePrice(): SỬA đúng 1 dòng đã có sẵn (khớp theo dsmartKey — khoá tự nhiên, đếm+ghi trong
// CÙNG 1 transaction, xem runGuardedNaturalKeyWrite()) — CHỈ sửa Giá/Ngày, không đụng cột nào khác. LƯU Ý
// QUAN TRỌNG: FR_DATE/TO_DATE là 1 PHẦN của khoá tự nhiên — sau khi UPDATE, khoá tự nhiên CŨ (dsmartKey
// truyền vào) không còn khớp dòng này nữa nếu ngày bị đổi, nên hàm này LUÔN đọc lại + TRẢ VỀ khoá tự nhiên
// MỚI (caller PHẢI lưu đè lại dsmartKey trong mirror nội bộ, nếu không lần Sửa/Xoá kế tiếp sẽ dùng khoá cũ
// đã sai).
async function updateWholesalePrice({ dsmartKey, price, frDate, toDate }) {
  if (!Number.isFinite(Number(price))) {
    throw new DsmartSqlError(`Giá trị Giá không hợp lệ: ${price}`);
  }
  const pool = await getDsmartPool();
  const { matchCount, writeResult } = await runGuardedNaturalKeyWrite(pool, dsmartKey, 'sửa', async (req) => {
    const whereClause = buildNaturalKeyWhere(req, dsmartKey);
    req.input('newPrice', sql.Decimal(18, 4), Number(price));
    req.input('newFrDate', sql.DateTime, toDateOnly(frDate));
    req.input('newToDate', sql.DateTime, toDateOnly(toDate));
    try {
      return await req.query(`
        UPDATE dbo.CSPRICE SET WSPRICE = @newPrice, FR_DATE = @newFrDate, TO_DATE = @newToDate
        WHERE ${whereClause};
      `);
    } catch (err) {
      throw new DsmartSqlError(`Lỗi ghi CSPRICE (SỬA, CUST_ID=${dsmartKey?.custId}/SKU_ID=${dsmartKey?.skuId}): ${err.message}`);
    }
  });
  if (matchCount === 0) {
    throw new DsmartSqlError('Không tìm thấy dòng CSPRICE khớp đúng khoá tự nhiên đã lưu để sửa — có thể đã bị xoá/sửa thủ công ngoài hệ thống này.');
  }
  const affected = writeResult?.rowsAffected?.[0] ?? 0;
  if (affected !== 1) {
    throw new DsmartSqlError(`UPDATE CSPRICE đã ảnh hưởng ${affected} dòng (kỳ vọng đúng 1) — liên hệ đội phát triển kiểm tra NGAY, dữ liệu CSPRICE có thể đã bị sửa ngoài ý muốn.`);
  }
  return captureCspriceNaturalKey(pool, { custId: dsmartKey.custId, skuId: dsmartKey.skuId, frDate, toDate });
}

// deleteWholesalePrice(): XOÁ THẬT đúng 1 dòng (khớp theo dsmartKey — khoá tự nhiên, đếm+xoá trong CÙNG 1
// transaction, xem runGuardedNaturalKeyWrite()) khỏi CSPRICE — KHÔNG hoàn tác được.
async function deleteWholesalePrice({ dsmartKey }) {
  const pool = await getDsmartPool();
  const { matchCount, writeResult } = await runGuardedNaturalKeyWrite(pool, dsmartKey, 'xoá', async (req) => {
    const whereClause = buildNaturalKeyWhere(req, dsmartKey);
    try {
      return await req.query(`DELETE FROM dbo.CSPRICE WHERE ${whereClause};`);
    } catch (err) {
      throw new DsmartSqlError(`Lỗi xoá CSPRICE (CUST_ID=${dsmartKey?.custId}/SKU_ID=${dsmartKey?.skuId}): ${err.message}`);
    }
  });
  if (matchCount === 0) {
    // Dòng không còn tồn tại (có thể đã bị xoá thủ công/lần trước) — KHÔNG ném lỗi (coi như đã đạt mục
    // tiêu "dòng này không còn trong CSPRICE"), chỉ báo rõ cho caller để ghi chú lại lịch sử.
    return { alreadyGone: true };
  }
  const affected = writeResult?.rowsAffected?.[0] ?? 0;
  if (affected === 0) return { alreadyGone: true };
  if (affected > 1) {
    throw new DsmartSqlError(`DELETE CSPRICE đã xoá ${affected} dòng (kỳ vọng đúng 1) — liên hệ đội phát triển kiểm tra NGAY, dữ liệu CSPRICE có thể đã bị ảnh hưởng ngoài ý muốn.`);
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

// inspectCspriceColumns(overrideCfg): LIỆT KÊ THẬT các cột của dbo.CSPRICE trên DSmart16 Trung Tâm + mọi
// PRIMARY KEY/UNIQUE INDEX khai báo thật (nếu có) — nút "🔍 Kiểm Tra Cấu Trúc Bảng CSPRICE" (12/2026).
//
// LỊCH SỬ (2 lần vá liên tiếp trên CÙNG 1 giả định sai, nêu rõ để không lặp lại): lần 1 giả định "CSPRICE
// có cột ID tự tăng tên ID" -> lỗi "Invalid column name 'ID'." -> vá bằng cách TỰ TRA sys.identity_columns
// thay vì hard-code "ID". Lần 2 (người dùng gửi ảnh chụp thật kết quả bấm nút này): sys.identity_columns
// trả về RỖNG — CSPRICE HOÀN TOÀN KHÔNG CÓ cột identity nào (không phải lỗi tên cột, mà bảng này THỰC SỰ
// dùng khoá tự nhiên nhiều cột) -> vá lần 2 bằng khoá tự nhiên NATURAL_KEY_COLUMNS (xem chú thích đầy đủ ở
// đầu file/insertWholesalePrice()). Nút này giờ mở rộng thêm: hiển thị PRIMARY KEY/UNIQUE INDEX khai báo
// thật trên CSPRICE (nếu CÓ) để đội IT/DBA tự đối chiếu xem khoá tự nhiên hệ thống đang dùng có khớp đúng
// ý đồ thiết kế thật của DSmart hay không — vẫn hoạt động đúng dù không tìm thấy khoá nào (các lớp an toàn
// đếm COUNT(*)/chặn khớp >1 dòng ở updateWholesalePrice()/deleteWholesalePrice() không phụ thuộc kết quả
// tra cứu này, đây CHỈ là công cụ chẩn đoán/đối chiếu thêm).
//
// CHỈ ĐỌC METADATA (INFORMATION_SCHEMA.COLUMNS + sys.identity_columns + sys.indexes) — KHÔNG đọc bất kỳ
// dữ liệu THẬT nào trong CSPRICE, nên KHÔNG cần quyền SELECT trên dữ liệu bảng (cùng tinh thần
// testDsmartConnection() "SELECT 1" ở trên — tài khoản chỉ GRANT INSERT/UPDATE/DELETE vẫn thấy được
// metadata của bảng mình có ít nhất 1 quyền, đây là hành vi chuẩn của SQL Server, không phải giả định).
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
    // Mọi PRIMARY KEY/UNIQUE INDEX khai báo thật trên CSPRICE (nếu có) — nhóm theo tên index, sắp đúng
    // thứ tự cột trong khoá (key_ordinal) để IT/DBA đối chiếu với NATURAL_KEY_COLUMNS đang dùng.
    const idxResult = await pool.request().query(`
      SELECT i.name AS IndexName, i.is_primary_key AS IsPrimaryKey, c.name AS ColumnName, ic.key_ordinal AS KeyOrdinal
      FROM sys.indexes i
      JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0
      JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      WHERE i.object_id = OBJECT_ID('dbo.CSPRICE') AND (i.is_primary_key = 1 OR i.is_unique = 1)
      ORDER BY i.index_id, ic.key_ordinal;
    `);
    const columns = (colsResult.recordset || []).map(r => ({ name: r.COLUMN_NAME, dataType: r.DATA_TYPE, nullable: r.IS_NULLABLE === 'YES' }));
    if (!columns.length) {
      throw new DsmartSqlError('Không thấy cột nào của dbo.CSPRICE — kiểm tra lại tên CSDL/quyền của tài khoản (cần ít nhất 1 quyền INSERT/UPDATE/DELETE/SELECT trên bảng CSPRICE để thấy được metadata).');
    }
    const identityColumn = idResult.recordset?.[0]?.ColumnName || null;
    const keyIndexesMap = new Map();
    for (const r of (idxResult.recordset || [])) {
      if (!keyIndexesMap.has(r.IndexName)) keyIndexesMap.set(r.IndexName, { name: r.IndexName, isPrimaryKey: !!r.IsPrimaryKey, columns: [] });
      keyIndexesMap.get(r.IndexName).columns.push(r.ColumnName);
    }
    const keyIndexes = [...keyIndexesMap.values()];
    return { columns, identityColumn, keyIndexes, naturalKeyColumns: NATURAL_KEY_COLUMNS };
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
  }
}

module.exports = {
  getDsmartPool, insertWholesalePrice, updateWholesalePrice, deleteWholesalePrice, closeDsmartPool,
  testDsmartConnection, inspectCspriceColumns, DsmartConfigError, DsmartSqlError
};
