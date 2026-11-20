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
// KHOÁ CHÍNH THẬT CHỈ 2 CỘT (12/2026, LỖI THẬT PRODUCTION LẦN 5 — SỬA LẠI GIẢ ĐỊNH LẦN 2 Ở TRÊN): người
// dùng thử "Thêm Giá Mới" lại cho CUST_ID/SKU_ID đã từng ghi (dòng lỗi Lần 3 để lại) và gặp lỗi THẬT: "
// Violation of PRIMARY KEY constraint 'PK_CSPRICE'. Cannot insert duplicate key... The duplicate key value
// is (240000000001, 296019310000)." — chỉ 2 giá trị, đúng 2 cột. Người dùng tự chạy câu truy vấn
// `sys.indexes`/`sys.index_columns` đối chiếu PK_CSPRICE qua SSMS (ảnh chụp thật) xác nhận: PK_CSPRICE =
// (CUST_ID, SKU_ID) — CHỈ 2 CỘT, không phải tổ hợp 7 cột suy luận ở Lần 2 (suy luận đó SAI — may mắn KHÔNG
// gây sửa/xoá nhầm dòng khác nhờ lớp an toàn "khớp >1 dòng -> rollback", nhưng khiến INSERT 1 dòng ĐÃ CÓ
// báo lỗi thay vì ghi đè đúng ý).
//
// Ý NGHĨA NGHIỆP VỤ QUAN TRỌNG (sửa lại hiểu nhầm trước đây): CSPRICE KHÔNG PHẢI bảng "lịch sử giá nhiều
// dòng/1 cặp khách+SP phân biệt bởi FR_DATE/TO_DATE" — mỗi cặp (CUST_ID, SKU_ID) CHỈ CÓ ĐÚNG 1 DÒNG DUY
// NHẤT tại một thời điểm (PK ép buộc). "Thêm Giá Mới" cho 1 cặp ĐÃ CÓ dòng thực chất là THAY THẾ/GHI ĐÈ giá
// hiện có, không phải thêm 1 dòng lịch sử mới — xem tryOverwriteExistingRow() bên dưới (thử GHI ĐÈ TRƯỚC
// theo đúng khuôn upsert chuẩn, KHÔNG cần người dùng tự xoá dòng cũ qua SSMS trước).
//
// insertWholesalePrice()/updateWholesalePrice()/deleteWholesalePrice() bên dưới dùng KHOÁ TỰ NHIÊN THẬT
// NATURAL_KEY_COLUMNS = (CUST_ID, SKU_ID) — ĐÃ SỬA từ tổ hợp 7 cột sai ở Lần 2 xuống đúng 2 cột theo PK
// thật xác nhận ở trên.
//
// KHÔNG DÙNG CÂU SELECT NÀO TRÊN DỮ LIỆU CSPRICE (12/2026, LỖI THẬT PRODUCTION LẦN 3 — người dùng thử lại
// gặp đúng lỗi "The SELECT permission was denied on the object 'CSPRICE'..."): tài khoản SQL dùng cho
// tính năng này CHỈ được GRANT INSERT/UPDATE/DELETE, KHÔNG có SELECT trên CSPRICE (đúng nguyên tắc
// least-privilege đã thống nhất lúc tạo tài khoản). Toàn bộ thao tác đọc lại khoá tự nhiên (sau Thêm/Sửa)
// VÀ việc phát hiện khớp >1 dòng (an toàn chống sửa/xoá nhầm) đều dùng `OUTPUT INSERTED.*`/
// `OUTPUT DELETED.*` NGAY TRÊN câu INSERT/UPDATE/DELETE (đọc trực tiếp từ thao tác ghi, KHÔNG phải 1 câu
// SELECT độc lập) — chỉ cần đúng quyền ghi đã có sẵn, không cần xin thêm quyền SELECT nào. updateWholesalePrice()/
// deleteWholesalePrice() chạy trong 1 TRANSACTION (sql.Transaction): nếu OUTPUT cho thấy khớp NHIỀU HƠN 1
// dòng (khoá suy luận không còn duy nhất) thì ROLLBACK NGAY để HOÀN TÁC, không để sót thay đổi trên dòng
// của khách/sản phẩm khác; khớp đúng 1 dòng mới COMMIT. Khoá tự nhiên này lưu lại (dsmartKey) vào
// dbo.DsmartWholesalePriceEntries (mirror nội bộ) để Sửa/Xoá sau này khớp lại.
//
// RỦI RO CÒN TỒN ĐỌNG (nêu rõ, không giấu): nếu suy luận khoá tự nhiên ở trên KHÔNG đúng 100% ý đồ thiết
// kế thật của DSmart (VD TO_DATE không thực sự là 1 phần khoá phân biệt), lớp an toàn (OUTPUT phát hiện
// >1 dòng -> rollback) sẽ TỰ CHẶN và báo lỗi rõ ràng thay vì âm thầm sửa/xoá sai — nhưng vẫn khuyến nghị
// đội IT dùng nút "🔍 Kiểm Tra Cấu Trúc Bảng CSPRICE" (đã mở rộng hiển thị PRIMARY KEY/UNIQUE INDEX khai
// báo thật trên CSPRICE nếu có) để xác nhận lại với đội DSmart/DBA trước khi dùng thật diện rộng. Lưu ý:
// `INSERT ... OUTPUT INSERTED.*` là 1 câu lệnh DUY NHẤT (SQL Server tự coi là 1 giao dịch ngầm) — nếu lỗi
// (kể cả lỗi ở chính mệnh đề OUTPUT) thì TOÀN BỘ câu lệnh tự rollback, không còn tình trạng "đã ghi xong
// nhưng báo lỗi ở bước xác nhận sau" như bản vá SELECT-based trước đó.
//
// PHẠM VI AN TOÀN: mọi câu lệnh dưới đây đều dùng THAM SỐ HOÁ (sql.Request().input(), KHÔNG BAO GIỜ nối
// chuỗi giá trị người dùng trực tiếp vào SQL) — chống SQL injection đúng chuẩn đã áp dụng xuyên suốt
// toàn bộ hệ thống (xem db.js/lib/recordStore.js).
const sql = require('mssql');
const { getRawConfig, decryptSecret } = require('./dsmartPriceConfigStore');
const storeConnStore = require('./dsmartStorePriceConnectionsStore');
const { HttpError } = require('./httpErrors');

let cachedPool = null;
let cachedSignature = null;

// FAN-OUT XUỐNG TỪNG SIÊU THỊ (12/2026, theo yêu cầu người dùng: "tôi muốn cài đặt giá đến tận máy chủ
// db của siêu thị... khi tôi thay đổi như xóa, sửa nó cũng truyền xuống tất cả các siêu thị" — thay vì
// chờ cơ chế đồng bộ ngoài (tool bên ngoài, theo sự kiện lưu của phần mềm DSmart desktop) mà hệ thống
// này KHÔNG kiểm soát/trigger được, xem điều tra dài ở lịch sử trao đổi trước đó). CÁCH LÀM: sau khi ghi
// THÀNH CÔNG vào CSPRICE DSmart16 Trung Tâm (HO) như cũ, lặp lại ĐÚNG CÙNG thao tác (ghi/sửa/xoá) trên
// pool riêng của MỖI siêu thị đang Enabled=1 (dbo.DsmartStorePriceConnections) — tái dùng NGUYÊN các hàm
// writePriceToPool()/updatePriceInPool()/deletePriceInPool() pool-agnostic bên dưới, không viết lại 2 bộ
// logic khác nhau cho HO và siêu thị (tránh lệch công thức ghi CSPRICE như các lỗi Lần 1-6 đã gặp ở HO).
//
// XỬ LÝ LỖI (12/2026, người dùng xác nhận rõ): 1 siêu thị lỗi (mất mạng, SQL Server tạm không phản hồi)
// KHÔNG chặn/rollback thao tác ở HO (đã commit xong, không hoàn tác) VÀ KHÔNG chặn các siêu thị khác —
// chạy ĐỘC LẬP, báo rõ TỪNG siêu thị thành công/lỗi ngay trong response để IT tự biết siêu thị nào cần
// áp lại. Không có hàng đợi/tự động thử lại (v1, theo yêu cầu người dùng — đơn giản hơn, nâng cấp sau
// nếu cần). Đọc danh sách siêu thị LỖI (VD mất kết nối CSDL app) cũng KHÔNG chặn thao tác HO đã xong —
// trả storeResults rỗng kèm storeFanOutError để UI tự báo rõ.
const storePoolCache = new Map(); // storeId -> { pool, signature }

function storeConfigSignature(store) {
  return [store.host, store.port, store.database, store.user, store.passwordEnc].join('|');
}

async function getStorePool(store) {
  const sig = storeConfigSignature(store);
  const cached = storePoolCache.get(store.id);
  if (cached && cached.signature === sig) return cached.pool;
  if (cached) {
    try { await cached.pool.close(); } catch (_) { /* phớt lờ lỗi đóng pool cũ */ }
    storePoolCache.delete(store.id);
  }
  let password;
  try {
    password = decryptSecret(store.passwordEnc);
  } catch (err) {
    throw new DsmartConfigError(`Không giải mã được mật khẩu đã lưu cho siêu thị "${store.storeCode}" — vào Cấu Hình Kết Nối Siêu Thị nhập lại mật khẩu.`);
  }
  const pool = new sql.ConnectionPool({
    server: store.host,
    port: store.port || 1433,
    database: store.database,
    user: store.user,
    password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    pool: { max: 3, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 15000,
    connectionTimeout: 15000
  });
  try {
    await pool.connect();
  } catch (err) {
    throw new DsmartConfigError(`Không kết nối được tới siêu thị "${store.storeCode}" (${store.host}:${store.port}/${store.database}): ${err.message}`);
  }
  storePoolCache.set(store.id, { pool, signature: sig });
  return pool;
}

const STORE_FANOUT_CONCURRENCY = 5;

// fanOutToStores(operation): operation(pool) thực hiện ĐÚNG 1 thao tác ghi/sửa/xoá trên 1 pool — gọi
// LẶP LẠI cho từng siêu thị Enabled=1, chạy song song theo lô (không dồn quá nhiều kết nối cùng lúc).
async function fanOutToStores(operation) {
  let stores;
  try {
    stores = await storeConnStore.listRaw({ onlyEnabled: true });
  } catch (err) {
    return { storeResults: [], storeFanOutError: `Không đọc được danh sách kết nối siêu thị: ${err.message}` };
  }
  const storeResults = [];
  for (let i = 0; i < stores.length; i += STORE_FANOUT_CONCURRENCY) {
    const chunk = stores.slice(i, i + STORE_FANOUT_CONCURRENCY);
    await Promise.all(chunk.map(async (store) => {
      try {
        const pool = await getStorePool(store);
        await operation(pool);
        storeResults.push({ storeId: store.id, storeCode: store.storeCode, storeName: store.storeName, ok: true });
      } catch (err) {
        storeResults.push({ storeId: store.id, storeCode: store.storeCode, storeName: store.storeName, ok: false, error: err.message || 'Lỗi không xác định' });
      }
    }));
  }
  return { storeResults, storeFanOutError: null };
}

// NATURAL_KEY_COLUMNS: khoá tự nhiên (= PRIMARY KEY THẬT của CSPRICE, xác nhận Lần 5 qua sys.indexes) dùng
// để khớp CHÍNH XÁC 1 dòng CSPRICE khi Sửa/Xoá/phát hiện trùng khoá lúc Thêm — thứ tự liệt kê ở đây chỉ để
// tham chiếu, KHÔNG ảnh hưởng câu lệnh SQL (mỗi câu lệnh tự liệt kê tường minh, không loop động, để dễ đọc/
// dễ rà soát khi audit).
const NATURAL_KEY_COLUMNS = ['CUST_ID', 'SKU_ID'];

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

// CÁC CỘT BẮT BUỘC ĐỂ DSMART THỰC SỰ "ÁP DỤNG" ĐƯỢC GIÁ (12/2026, LỖI THẬT PRODUCTION LẦN 4 — người dùng
// tự so sánh dòng vừa ghi với 1 dòng giá THẬT hoạt động bình thường qua SSMS, phát hiện CSPRICE còn cần
// NHIỀU cột nữa ngoài 5 cột đã xác nhận, nếu không DSmart không dùng được giá dù dòng đã ghi "thành
// công" về mặt kỹ thuật): người dùng gửi NGUYÊN VĂN mã nguồn phần mềm áp giá CŨ (BRG_APP.sql, stored
// procedure `_job_sp_WEBAPP_Item_Price`) — đây là CÔNG THỨC THẬT DSmart từng dùng, không phải suy đoán:
//   INSERT INTO CSPRICE (CUST_ID, TYPE, SKU_ID, UNIT_SYMB, BASE_UNIT, UNITCONV, WSPRICE, VAT_INCL,
//                         TAX_CODE, OPEN_DATE, MODI_DATE, STATUS, FR_DATE, TO_DATE)
//   SELECT CUST_ID, '04', SKU_ID, PICEUNIT, PICEUNIT, UNITCONV, WSPRICE, 1, TAX_CODE, GETDATE(),
//          GETDATE(), 1, startDate, endDate FROM SKU_DEF ...
// Tức là: TYPE/VAT_INCL/STATUS là HẰNG SỐ CỐ ĐỊNH ('04'/1/1), còn UNIT_SYMB/BASE_UNIT/UNITCONV/TAX_CODE
// PHẢI tra từ bảng `dbo.SKU_DEF` (CÙNG CSDL DSmart16, KHÁC bảng CSPRICE) theo đúng SKU_ID — xem
// lookupSkuDefUnitInfo() bên dưới. WS_ID/USER_ID/STK_ID: script gốc KHÔNG set, để trống đúng như hệ
// thống này đã làm từ đầu (không cần sửa).
//
// TÀI KHOẢN SQL CHỈ ĐƯỢC GRANT INSERT/UPDATE/DELETE, KHÔNG CÓ SELECT (12/2026, LỖI THẬT PRODUCTION LẦN 3):
// bản vá "khoá tự nhiên" (xem lịch sử ở đầu file) ban đầu đọc lại dòng vừa ghi bằng 1 câu SELECT riêng để
// xác nhận khoá — người dùng thử lại và gặp lỗi THẬT: "The SELECT permission was denied on the object
// 'CSPRICE', database 'DSMART16', schema 'dbo'." Tài khoản SQL tạo riêng cho tính năng này (theo đúng
// nguyên tắc least-privilege đã trao đổi lúc đầu — xem testDsmartConnection() bên dưới) CHỈ được cấp
// INSERT/UPDATE/DELETE trên CSPRICE, KHÔNG có SELECT — nghĩa là MỌI câu lệnh `SELECT ... FROM dbo.CSPRICE`
// (kể cả `SELECT COUNT(*)`) đều sẽ bị chặn, không chỉ riêng câu đọc lại khoá.
//
// VÁ: bỏ HẲN mọi câu SELECT trên dữ liệu CSPRICE — dùng mệnh đề `OUTPUT INSERTED.*`/`OUTPUT DELETED.*`
// NGAY TRÊN chính câu lệnh INSERT/UPDATE/DELETE để lấy lại dữ liệu dòng vừa ảnh hưởng. OUTPUT đọc trực
// tiếp từ buffer của THAO TÁC GHI đó (không phải 1 câu SELECT độc lập trên bảng), nên chỉ cần đúng quyền
// INSERT/UPDATE/DELETE đã có sẵn — đây là cách chuẩn SQL Server khuyến nghị cho đúng tình huống tài khoản
// chỉ có quyền ghi, không có quyền đọc.
//
// AN TOÀN CHỐNG SỬA/XOÁ NHẦM (khi khoá tự nhiên suy luận không còn duy nhất) — vì KHÔNG còn dùng được
// `SELECT COUNT(*)` để đếm trước khi ghi (cũng bị chặn SELECT), updateWholesalePrice()/deleteWholesalePrice()
// chạy UPDATE/DELETE có `OUTPUT` NGAY TRONG 1 TRANSACTION (sql.Transaction) — đọc SỐ DÒNG mà OUTPUT trả về
// (chính là số dòng VỪA bị ảnh hưởng, không cần SELECT riêng): nếu đúng 1 dòng -> COMMIT; nếu 0 dòng ->
// COMMIT (không có gì thay đổi, vô hại); nếu NHIỀU HƠN 1 dòng (khoá suy luận không còn duy nhất) ->
// ROLLBACK NGAY để HOÀN TÁC thao tác đã lỡ áp dụng cho nhiều dòng, báo lỗi rõ ràng — không bao giờ để sót
// lại thay đổi trên dòng của khách/sản phẩm khác.
// LẦN 5 — KIẾN TRÚC UPSERT CHUẨN (audit chéo 4 agent phát hiện bản vá đầu tiên "INSERT rồi bắt lỗi trùng
// khoá PK_CSPRICE để chuyển sang ghi đè" là cách vá KHÔNG triệt để — dựa vào exception-driven control flow
// cho 1 tình huống BÌNH THƯỜNG (ghi đè giá đã có), tự tạo ra lỗi ràng buộc THẬT trên SQL Server mỗi lần ghi
// đè (có thể làm nhiễu log/giám sát lỗi production), và cơ chế nhận diện lỗi trùng khoá (err.number/regex
// tên ràng buộc) có thể nhầm 1 ràng buộc UNIQUE khác (nếu CSPRICE từng có thêm) thành trùng khoá chính):
// SỬA lại theo đúng khuôn upsert chuẩn — **UPDATE TRƯỚC** (coi như đã có dòng, đúng PK thật CUST_ID+SKU_ID
// xác nhận qua SSMS); nếu UPDATE không khớp dòng nào (OUTPUT rỗng = CHƯA có dòng) thì mới INSERT dòng MỚI.
// Không còn cần phân biệt "lỗi trùng khoá" khỏi "lỗi SQL khác" nữa — loại bỏ hẳn hàm isPrimaryKeyViolation()
// cũ. Rủi ro còn lại (chấp nhận được, hiếm xảy ra): 2 request THẬT đồng thời cùng thêm giá MỚI (chưa từng
// có dòng) cho ĐÚNG cùng 1 cặp CUST_ID+SKU_ID — cả 2 đều thấy UPDATE khớp 0 dòng, 1 trong 2 INSERT trước sẽ
// thành công, request còn lại gặp lỗi PK_CSPRICE THẬT từ SQL Server (ném thẳng ra, không cố bắt/chuyển đổi
// nữa — trung thực hơn, người dùng thử lại là xong, khác hẳn case GHI ĐÈ vốn là tình huống thường xuyên).
// upsertPriceOnPool(pool, ...): phần LÕI pool-agnostic của insertWholesalePrice() — tách riêng để FAN-OUT
// (xem fanOutToStores() ở đầu file) gọi LẶP LẠI ĐÚNG CÙNG logic này trên pool của từng siêu thị, không
// viết lại 1 bộ công thức ghi CSPRICE khác cho siêu thị (tránh lệch công thức như các lỗi Lần 1-6 ở HO).
async function upsertPriceOnPool(pool, { custId, skuId, price, frDate, toDate }) {
  const { unit, unitConv, taxCode } = await lookupSkuDefUnitInfo(pool, skuId);
  const common = { custId, skuId, unit, unitConv, price, taxCode, frDate, toDate };
  const overwritten = await tryOverwriteExistingRow(pool, common);
  if (overwritten) return { ...overwritten, wasOverwrite: true };
  const inserted = await insertNewRow(pool, common);
  return { ...inserted, wasOverwrite: false };
}

async function insertWholesalePrice(params) {
  if (!Number.isFinite(Number(params.price))) {
    throw new DsmartSqlError(`Giá trị Giá không hợp lệ: ${params.price}`);
  }
  const pool = await getDsmartPool();
  const hoResult = await upsertPriceOnPool(pool, params);
  const { storeResults, storeFanOutError } = await fanOutToStores((storePool) => upsertPriceOnPool(storePool, params));
  return { ...hoResult, storeResults, storeFanOutError };
}

// tryOverwriteExistingRow(): thử UPDATE đúng dòng khớp khoá chính thật (CUST_ID, SKU_ID) TRƯỚC — ghi đè ĐỦ
// LẠI toàn bộ các cột bắt buộc (TYPE/UNIT_SYMB/BASE_UNIT/UNITCONV/WSPRICE/VAT_INCL/TAX_CODE/STATUS/FR_DATE/
// TO_DATE/MODI_DATE) theo đúng công thức Lần 4, KHÔNG chỉ sửa Giá/Ngày — mục đích kép: (1) đúng ý "Thêm Giá
// Mới" nghĩa là thay giá hiện có khi đã tồn tại dòng, (2) TỰ khắc phục luôn dòng cũ bị ghi thiếu cột do lỗi
// Lần 3 (TYPE/UNIT_SYMB/... rỗng) mà không cần người dùng tự sửa tay qua SSMS.
//
// LẦN 6 (12/2026, người dùng tự đối chiếu nguyên văn `_job_sp_WEBAPP_Item_Price` trong BRG_APP.sql — phần
// mềm áp giá CŨ, nghi ngờ tool tự thêm sai lệch khi IT báo giá CHƯA đồng bộ xuống được siêu thị): soát lại
// kỹ câu UPDATE gốc `SET T.LASTWSPR=T.WSPRICE, T.WSPRICE = S.WSPRICE, T.OPEN_DATE = GETDATE(), ...` phát
// hiện ĐÚNG 2 điểm bản vá trước đây tự sai lệch so với bản gốc — sửa lại cho khớp 100%:
//   (1) LASTWSPR: bản gốc LUÔN lưu giá CŨ vào cột này trước khi ghi đè — bản vá trước bỏ sót hoàn toàn, giá
//       cũ bị mất không dấu vết. Nay thêm `LASTWSPR = WSPRICE` NGAY TRƯỚC `WSPRICE = @price` trong cùng 1
//       mệnh đề SET — T-SQL đảm bảo mọi biểu thức trong SET đọc giá trị CŨ của dòng (trước khi cập nhật),
//       nên LASTWSPR nhận đúng giá CŨ dù viết trên 1 dòng, khớp đúng ý `T.LASTWSPR=T.WSPRICE` của bản gốc.
//   (2) OPEN_DATE: bản gốc LUÔN set lại `GETDATE()` mỗi lần ghi giá (kể cả ghi đè) — bản vá trước CHỈ set
//       nếu đang NULL (lựa chọn tự thêm, không có trong bản gốc). Nay bỏ hẳn điều kiện ISNULL, LUÔN gán
//       GETDATE() cho khớp đúng bản gốc.
// (Chưa xác nhận được đây có phải nguyên nhân thật của lỗi "chưa đồng bộ xuống siêu thị" hay không — bước
// CSPRICE (DSmart16 Trung Tâm) -> từng siêu thị KHÔNG xuất hiện ở đâu trong BRG_APP.sql, nằm ngoài phạm vi
// mã nguồn đang có; người dùng sẽ hỏi lại đội DSmart/IT về cơ chế đồng bộ đó. Sửa 2 điểm trên vì ĐÃ xác
// nhận chắc chắn là sai lệch thật so với bản gốc, không phụ thuộc kết quả tra cứu thêm.)
//
// Trả về `null` (KHÔNG ném lỗi) nếu UPDATE khớp 0 dòng — nghĩa là CHƯA có dòng nào, caller sẽ tự INSERT mới.
async function tryOverwriteExistingRow(pool, { custId, skuId, unit, unitConv, price, taxCode, frDate, toDate }) {
  const req = pool.request();
  req.input('custId', sql.NVarChar(50), String(custId));
  req.input('skuId', sql.NVarChar(50), String(skuId));
  req.input('unit', sql.NVarChar(10), unit);
  req.input('unitConv', sql.Int, unitConv);
  req.input('price', sql.Decimal(18, 4), Number(price));
  req.input('taxCode', sql.NVarChar(10), taxCode);
  req.input('frDate', sql.DateTime, toDateOnly(frDate));
  req.input('toDate', sql.DateTime, toDateOnly(toDate));
  let result;
  try {
    result = await req.query(`
      UPDATE dbo.CSPRICE
      SET TYPE = '04', UNIT_SYMB = @unit, BASE_UNIT = @unit, UNITCONV = @unitConv,
          LASTWSPR = WSPRICE, WSPRICE = @price,
          VAT_INCL = 1, TAX_CODE = @taxCode, STATUS = 1, FR_DATE = @frDate, TO_DATE = @toDate,
          MODI_DATE = GETDATE(), OPEN_DATE = GETDATE()
      OUTPUT INSERTED.CUST_ID, INSERTED.SKU_ID
      WHERE CUST_ID = @custId AND SKU_ID = @skuId;
    `);
  } catch (err) {
    throw new DsmartSqlError(`Lỗi ghi đè CSPRICE (CUST_ID=${custId}, SKU_ID=${skuId}): ${err.message}`);
  }
  const rows = result.recordset || [];
  if (!rows.length) return null; // chưa có dòng nào khớp -> caller tự INSERT mới
  return naturalKeyFromRow(rows[0]);
}

// insertNewRow(): chỉ gọi khi tryOverwriteExistingRow() xác nhận CHƯA có dòng nào cho cặp (CUST_ID, SKU_ID)
// — INSERT dòng THẬT SỰ mới theo đúng công thức Lần 4.
async function insertNewRow(pool, { custId, skuId, unit, unitConv, price, taxCode, frDate, toDate }) {
  const req = pool.request();
  req.input('custId', sql.NVarChar(50), String(custId));
  req.input('skuId', sql.NVarChar(50), String(skuId));
  req.input('unit', sql.NVarChar(10), unit);
  req.input('unitConv', sql.Int, unitConv);
  req.input('price', sql.Decimal(18, 4), Number(price));
  req.input('taxCode', sql.NVarChar(10), taxCode);
  req.input('frDate', sql.DateTime, toDateOnly(frDate));
  req.input('toDate', sql.DateTime, toDateOnly(toDate));
  let result;
  try {
    result = await req.query(`
      INSERT INTO dbo.CSPRICE (CUST_ID, TYPE, SKU_ID, UNIT_SYMB, BASE_UNIT, UNITCONV, WSPRICE, VAT_INCL, TAX_CODE, OPEN_DATE, MODI_DATE, STATUS, FR_DATE, TO_DATE)
      OUTPUT INSERTED.CUST_ID, INSERTED.SKU_ID
      VALUES (@custId, '04', @skuId, @unit, @unit, @unitConv, @price, 1, @taxCode, GETDATE(), GETDATE(), 1, @frDate, @toDate);
    `);
  } catch (err) {
    // Hiếm gặp: 2 request đồng thời cùng thêm giá MỚI cho đúng 1 cặp — xem chú thích ở insertWholesalePrice().
    throw new DsmartSqlError(`Lỗi ghi CSPRICE (THÊM MỚI, CUST_ID=${custId}, SKU_ID=${skuId}): ${err.message}`);
  }
  const rows = result.recordset || [];
  if (!rows.length) {
    throw new DsmartSqlError('DSmart không trả lại dòng vừa thêm (OUTPUT INSERTED rỗng) — kiểm tra thủ công trên DSmart xem dòng đã được ghi chưa.');
  }
  return naturalKeyFromRow(rows[0]);
}

// lookupSkuDefUnitInfo(pool, skuId): tra Đơn Vị Tính (PICEUNIT, dùng chung cho cả UNIT_SYMB lẫn BASE_UNIT
// — đúng công thức BRG_APP) + Hệ Số Quy Đổi (UNITCONV) + Mã Thuế (TAX_CODE) theo Mã Sản Phẩm từ bảng
// `dbo.SKU_DEF` — CÙNG CSDL DSmart16 nhưng KHÁC bảng CSPRICE, nên quyền SELECT bị chặn trên CSPRICE (xem
// chú thích ở trên) KHÔNG áp dụng cho bảng này — tài khoản SQL cần được GRANT RIÊNG quyền SELECT trên
// dbo.SKU_DEF (đội DBA xác nhận/cấp thêm). Phân biệt rõ 2 nguyên nhân lỗi khác nhau để người dùng biết
// hướng xử lý đúng: (1) bị từ chối quyền -> cần xin GRANT SELECT; (2) không tìm thấy/thiếu dữ liệu SKU_ID
// -> cần bổ sung danh mục sản phẩm trên DSmart, không phải lỗi quyền.
async function lookupSkuDefUnitInfo(pool, skuId) {
  const req = pool.request();
  req.input('skuId', sql.NVarChar(50), String(skuId));
  let result;
  try {
    result = await req.query('SELECT PICEUNIT, UNITCONV, TAX_CODE FROM dbo.SKU_DEF WHERE SKU_ID = @skuId;');
  } catch (err) {
    throw new DsmartSqlError(`Lỗi tra Đơn Vị Tính/Thuế theo Mã Sản Phẩm (bảng SKU_DEF, SKU_ID=${skuId}): ${err.message} — kiểm tra tài khoản SQL đã được GRANT SELECT trên dbo.SKU_DEF chưa (khác quyền trên CSPRICE).`);
  }
  const row = result.recordset?.[0];
  if (!row) {
    throw new DsmartSqlError(`Không tìm thấy Mã Sản Phẩm "${skuId}" trong danh mục SKU_DEF trên DSmart — kiểm tra lại đúng Mã Sản Phẩm, hoặc sản phẩm chưa được tạo trên DSmart.`);
  }
  const unit = String(row.PICEUNIT || '').trim();
  const taxCode = String(row.TAX_CODE || '').trim();
  const unitConvNum = Number(row.UNITCONV);
  if (!unit || !taxCode || !Number.isFinite(unitConvNum)) {
    throw new DsmartSqlError(`Mã Sản Phẩm "${skuId}" thiếu dữ liệu Đơn Vị Tính/Hệ Số Quy Đổi/Mã Thuế trong SKU_DEF (PICEUNIT="${unit}", UNITCONV=${row.UNITCONV}, TAX_CODE="${taxCode}") — cần đội DSmart bổ sung đầy đủ danh mục sản phẩm trước khi áp giá.`);
  }
  return { unit, unitConv: unitConvNum, taxCode };
}

// naturalKeyFromRow(row): chuyển 1 dòng kết quả OUTPUT (hoặc tương đương) thành object "khoá tự nhiên"
// dsmartKey chuẩn — dùng chung cho insert/update.
function naturalKeyFromRow(row) {
  return { custId: String(row.CUST_ID).trim(), skuId: String(row.SKU_ID).trim() };
}

// buildNaturalKeyWhere(req, dsmartKey): gán tham số hoá đúng 2 cột khoá chính thật (CUST_ID, SKU_ID) vào
// request SQL đã cho, trả về mệnh đề WHERE tương ứng.
function buildNaturalKeyWhere(req, dsmartKey) {
  if (!dsmartKey || typeof dsmartKey !== 'object') {
    throw new DsmartSqlError('Thiếu khoá tự nhiên (dsmartKey) của dòng CSPRICE cần sửa/xoá — dữ liệu nội bộ có thể bị hỏng, liên hệ đội phát triển.');
  }
  const { custId, skuId } = dsmartKey;
  if (custId == null || skuId == null) {
    throw new DsmartSqlError(`Khoá tự nhiên (dsmartKey) thiếu 1 trong các trường ${NATURAL_KEY_COLUMNS.join('/')} — không thể xác định đúng 1 dòng CSPRICE để sửa/xoá an toàn.`);
  }
  req.input('kCustId', sql.NVarChar(50), String(custId));
  req.input('kSkuId', sql.NVarChar(50), String(skuId));
  return 'CUST_ID = @kCustId AND SKU_ID = @kSkuId';
}

// updateWholesalePrice(): SỬA đúng 1 dòng đã có sẵn (khớp theo dsmartKey — khoá chính thật CUST_ID+SKU_ID,
// xem Lần 5 ở đầu file) — CHỈ sửa Giá/Ngày, không đụng cột nào khác. Chạy trong 1 transaction, dùng OUTPUT
// để vừa biết số dòng bị ảnh hưởng vừa lấy lại khoá, KHÔNG cần câu SELECT riêng nào (xem chú thích quyền
// SQL ở trên). Từ Lần 5: khoá CHỈ gồm CUST_ID+SKU_ID (không còn gồm FR_DATE/TO_DATE như giả định Lần 2 sai)
// nên đổi Giá/Ngày KHÔNG làm khoá đổi theo nữa — vẫn trả về khoá (giờ luôn giống khoá cũ) để caller lưu đè
// lại cho nhất quán, dù không còn bắt buộc như trước.
async function updateWholesalePrice(params) {
  if (!Number.isFinite(Number(params.price))) {
    throw new DsmartSqlError(`Giá trị Giá không hợp lệ: ${params.price}`);
  }
  const pool = await getDsmartPool();
  const hoResult = await updatePriceOnPool(pool, params);
  const { storeResults, storeFanOutError } = await fanOutToStores((storePool) => updatePriceOnPool(storePool, params));
  return { ...hoResult, storeResults, storeFanOutError };
}

// updatePriceOnPool(pool, ...): phần LÕI pool-agnostic của updateWholesalePrice() — tái dùng cho FAN-OUT
// xuống từng siêu thị (xem fanOutToStores() ở đầu file). Nếu 1 siêu thị KHÔNG có dòng này (0 dòng khớp —
// VD lần đầu bật fan-out, siêu thị đó chưa từng có giá này), hàm ném lỗi rõ ràng (không tự fallback sang
// INSERT) — "Sửa" LUÔN có nghĩa "dòng đã tồn tại", báo lỗi đúng để IT biết cần "Thêm Giá Mới" ở siêu thị
// đó trước, không âm thầm ghi 1 dòng thiếu cột (upsertPriceOnPool mới có đủ UNIT_SYMB/TAX_CODE/...).
async function updatePriceOnPool(pool, { dsmartKey, price, frDate, toDate }) {
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
  } catch (err) {
    throw new DsmartSqlError(`Lỗi mở giao dịch (transaction) CSPRICE trước khi sửa: ${err.message}`);
  }
  let rows;
  try {
    const req = transaction.request();
    const whereClause = buildNaturalKeyWhere(req, dsmartKey);
    req.input('newPrice', sql.Decimal(18, 4), Number(price));
    req.input('newFrDate', sql.DateTime, toDateOnly(frDate));
    req.input('newToDate', sql.DateTime, toDateOnly(toDate));
    const result = await req.query(`
      UPDATE dbo.CSPRICE SET WSPRICE = @newPrice, FR_DATE = @newFrDate, TO_DATE = @newToDate
      OUTPUT INSERTED.CUST_ID, INSERTED.SKU_ID
      WHERE ${whereClause};
    `);
    rows = result.recordset || [];
  } catch (err) {
    try { await transaction.rollback(); } catch (_) { /* transaction có thể đã tự đóng nếu lỗi kết nối giữa chừng */ }
    throw new DsmartSqlError(`Lỗi ghi CSPRICE (SỬA, CUST_ID=${dsmartKey?.custId}/SKU_ID=${dsmartKey?.skuId}): ${err.message}`);
  }
  if (rows.length > 1) {
    try { await transaction.rollback(); } catch (_) { /* vẫn báo lỗi chính dù rollback lỗi */ }
    throw new DsmartSqlError(`Khoá tự nhiên đã lưu khớp ${rows.length} dòng CSPRICE (không còn DUY NHẤT) — ĐÃ HOÀN TÁC (rollback), KHÔNG dòng nào thực sự bị sửa, liên hệ đội phát triển kiểm tra thủ công trước khi thử lại.`);
  }
  if (rows.length === 0) {
    try { await transaction.commit(); } catch (_) { /* không có thay đổi để mất */ }
    throw new DsmartSqlError('Không tìm thấy dòng CSPRICE khớp đúng khoá tự nhiên đã lưu để sửa — có thể đã bị xoá/sửa thủ công ngoài hệ thống này.');
  }
  try {
    await transaction.commit();
  } catch (err) {
    throw new DsmartSqlError(`Lỗi xác nhận (commit) giao dịch CSPRICE sau khi sửa: ${err.message}`);
  }
  return naturalKeyFromRow(rows[0]);
}

// deleteWholesalePrice(): XOÁ THẬT đúng 1 dòng (khớp theo dsmartKey — khoá tự nhiên) khỏi CSPRICE — KHÔNG
// hoàn tác được SAU KHI commit. Cùng cơ chế transaction + OUTUT như updateWholesalePrice() ở trên — khớp
// >1 dòng thì ROLLBACK (không xoá gì cả), khớp 0 dòng thì coi như đã đạt mục tiêu (không ném lỗi).
async function deleteWholesalePrice(params) {
  const pool = await getDsmartPool();
  const hoResult = await deletePriceOnPool(pool, params);
  const { storeResults, storeFanOutError } = await fanOutToStores((storePool) => deletePriceOnPool(storePool, params));
  return { ...hoResult, storeResults, storeFanOutError };
}

// deletePriceOnPool(pool, ...): phần LÕI pool-agnostic của deleteWholesalePrice() — tái dùng cho FAN-OUT
// (xem fanOutToStores() ở đầu file). 0 dòng khớp ở 1 siêu thị KHÔNG ném lỗi (coi như đã đạt mục tiêu,
// giống hành vi ở HO) — siêu thị đó vẫn báo "ok: true" trong storeResults.
async function deletePriceOnPool(pool, { dsmartKey }) {
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
  } catch (err) {
    throw new DsmartSqlError(`Lỗi mở giao dịch (transaction) CSPRICE trước khi xoá: ${err.message}`);
  }
  let rows;
  try {
    const req = transaction.request();
    const whereClause = buildNaturalKeyWhere(req, dsmartKey);
    const result = await req.query(`
      DELETE FROM dbo.CSPRICE
      OUTPUT DELETED.CUST_ID
      WHERE ${whereClause};
    `);
    rows = result.recordset || [];
  } catch (err) {
    try { await transaction.rollback(); } catch (_) { /* transaction có thể đã tự đóng nếu lỗi kết nối giữa chừng */ }
    throw new DsmartSqlError(`Lỗi xoá CSPRICE (CUST_ID=${dsmartKey?.custId}/SKU_ID=${dsmartKey?.skuId}): ${err.message}`);
  }
  if (rows.length > 1) {
    try { await transaction.rollback(); } catch (_) { /* vẫn báo lỗi chính dù rollback lỗi */ }
    throw new DsmartSqlError(`Khoá tự nhiên đã lưu khớp ${rows.length} dòng CSPRICE (không còn DUY NHẤT) — ĐÃ HOÀN TÁC (rollback), KHÔNG dòng nào thực sự bị xoá, liên hệ đội phát triển kiểm tra thủ công trước khi thử lại.`);
  }
  if (rows.length === 0) {
    try { await transaction.commit(); } catch (_) { /* không có gì để mất */ }
    // Dòng không còn tồn tại (có thể đã bị xoá thủ công/lần trước) — KHÔNG ném lỗi (coi như đã đạt mục
    // tiêu "dòng này không còn trong CSPRICE"), chỉ báo rõ cho caller để ghi chú lại lịch sử.
    return { alreadyGone: true };
  }
  try {
    await transaction.commit();
  } catch (err) {
    throw new DsmartSqlError(`Lỗi xác nhận (commit) giao dịch CSPRICE sau khi xoá: ${err.message}`);
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

// testSkuDefAccess(overrideCfg): kiểm tra tài khoản SQL có đọc được dbo.SKU_DEF không — nút "🔍 Kiểm Tra
// Quyền Đọc SKU_DEF" (12/2026, sau khi insertWholesalePrice() cần tra SKU_DEF để lấy đủ Đơn Vị Tính/Hệ
// Số Quy Đổi/Mã Thuế, xem lookupSkuDefUnitInfo()) — để đội IT tự xác nhận quyền đã được cấp đủ TRƯỚC khi
// thử ghi giá thật, không cần đợi submit 1 dòng thật rồi mới biết lỗi quyền. Cùng khuôn 2 chế độ như
// testDsmartConnection() ở dưới (cấu hình đã lưu / giá trị đang gõ dở).
async function testSkuDefAccess(overrideCfg) {
  async function runCheck(pool) {
    const started = Date.now();
    let result;
    try {
      result = await pool.request().query('SELECT TOP 1 SKU_ID, PICEUNIT, UNITCONV, TAX_CODE FROM dbo.SKU_DEF;');
    } catch (err) {
      throw new DsmartConfigError(`Không đọc được bảng dbo.SKU_DEF (cần quyền SELECT riêng, khác quyền trên CSPRICE): ${err.message}`);
    }
    return { ms: Date.now() - started, sampleRow: result.recordset?.[0] || null };
  }
  if (!overrideCfg) {
    const pool = await getDsmartPool();
    return runCheck(pool);
  }
  const { host, port, database, user, password } = overrideCfg;
  if (!host || !database || !user || !password) {
    throw new DsmartConfigError('Thiếu Host/Tên CSDL/Tài khoản/Mật khẩu để kiểm tra quyền đọc SKU_DEF.');
  }
  const pool = new sql.ConnectionPool({
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
  try {
    return await runCheck(pool);
  } finally {
    try { await pool.close(); } catch (_) { /* phớt lờ lỗi đóng pool tạm */ }
  }
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

// custIdExistsInCsprice(custId): kiểm tra Mã Khách B2B (CUST_ID) đã TỪNG xuất hiện trong CSPRICE (với BẤT
// KỲ Mã Sản Phẩm nào) hay chưa — dùng ở bước xem trước (preview) "Thêm Giá Mới" để CẢNH BÁO MỀM nếu mã
// khách hoàn toàn MỚI (12/2026, LỖI THẬT production: người dùng set giá cho 1 CUST_ID không phải mã khách
// thật của siêu thị/khách hàng cần đổi giá — xác nhận qua plan cache DSmart16: lookup giá lúc lập phiếu
// bán buôn khoá CHẶT theo CUST_ID (`SELECT * FROM CSPRICE WHERE STATUS=1 AND TYPE='04' AND CUST_ID=@P1 AND
// SKU_ID=@P2`), 2 mã khách khác nhau hoàn toàn KHÔNG liên quan nhau — giá set nhầm mã sẽ KHÔNG BAO GIỜ áp
// đúng chỗ, không phải lỗi đồng bộ/code).
//
// KHÔNG DÙNG SELECT (tài khoản không có quyền — xem chú thích đầu file): dùng đúng mẹo OUTPUT trên 1 câu
// UPDATE "vô hại" (gán lại CHÍNH giá trị CUST_ID hiện có cho CHÍNH dòng đó, TOP 1, KHÔNG đổi dữ liệu gì) —
// khớp được >=1 dòng thì CUST_ID này đã từng tồn tại trong CSPRICE; khớp 0 dòng thì là mã khách hoàn toàn
// MỚI (cần người dùng tự xác nhận lại trước khi tiếp tục, xem routes/dsmartWholesalePrice.js /preview).
async function custIdExistsInCsprice(custId) {
  const pool = await getDsmartPool();
  const req = pool.request();
  req.input('custId', sql.NVarChar(50), String(custId));
  let result;
  try {
    result = await req.query(`
      UPDATE TOP (1) dbo.CSPRICE
      SET CUST_ID = CUST_ID
      OUTPUT INSERTED.CUST_ID
      WHERE CUST_ID = @custId;
    `);
  } catch (err) {
    throw new DsmartSqlError(`Lỗi kiểm tra Mã Khách B2B "${custId}" đã từng có trong CSPRICE chưa: ${err.message}`);
  }
  return (result.recordset || []).length > 0;
}

// Chỉ dùng cho test/khi server tắt hẳn — đóng pool đang cache (nếu có).
async function closeDsmartPool() {
  if (cachedPool) {
    try { await cachedPool.close(); } catch (_) { /* ignore */ }
    cachedPool = null;
    cachedSignature = null;
  }
}

// Chỉ dùng cho test/khi server tắt hẳn — đóng TOÀN BỘ pool siêu thị đang cache.
async function closeAllStorePools() {
  for (const { pool } of storePoolCache.values()) {
    try { await pool.close(); } catch (_) { /* ignore */ }
  }
  storePoolCache.clear();
}

// testStoreConnection(overrideCfg): nút "🔌 Kiểm Tra Kết Nối" ở màn Cấu Hình Kết Nối Siêu Thị — cùng
// khuôn testDsmartConnection() ở trên (test giá trị đang gõ dở, KHÔNG đụng pool cache dùng cho ghi thật).
// overrideCfg: { host, port, database, user, password } — luôn dùng giá trị client gửi (KHÔNG có "test
// theo cấu hình đã lưu, không truyền gì" như testDsmartConnection(), vì mỗi lần test là 1 trong NHIỀU
// siêu thị, route luôn biết id cụ thể, không cần nhánh không truyền gì).
async function testStoreConnection({ host, port, database, user, password }) {
  if (!host || !database || !user || !password) {
    throw new DsmartConfigError('Thiếu Host/Tên CSDL/Tài khoản/Mật khẩu để kiểm tra kết nối.');
  }
  const pool = new sql.ConnectionPool({
    server: host, port: port || 1433, database, user, password,
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    pool: { max: 1, min: 0, idleTimeoutMillis: 5000 },
    requestTimeout: 10000, connectionTimeout: 10000
  });
  const started = Date.now();
  try {
    await pool.connect();
    await pool.request().query('SELECT 1 AS ok;');
  } catch (err) {
    throw new DsmartConfigError(`Không kết nối được (${host}:${port || 1433}/${database}): ${err.message}`);
  } finally {
    try { await pool.close(); } catch (_) { /* phớt lờ lỗi đóng pool tạm */ }
  }
  return { ms: Date.now() - started };
}

module.exports = {
  getDsmartPool, insertWholesalePrice, updateWholesalePrice, deleteWholesalePrice, closeDsmartPool,
  closeAllStorePools, testStoreConnection,
  testDsmartConnection, testSkuDefAccess, inspectCspriceColumns, custIdExistsInCsprice, DsmartConfigError, DsmartSqlError
};
