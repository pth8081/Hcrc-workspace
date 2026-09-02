// db.js — Kết nối SQL Server (MSSQL) bằng connection pool dùng chung toàn app
const sql = require('mssql');
require('dotenv').config();

const config = {
  server: process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME || 'VPDT_DMS',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',           // true nếu dùng Azure SQL hoặc yêu cầu TLS
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false', // true khi dùng self-signed cert (mặc định, phù hợp môi trường nội bộ)
    enableArithAbort: true
  },
  pool: {
    // Mặc định nâng từ 10 lên 20 — với thiết kế lưu mỗi collection thành 1 bản ghi JSON (đọc/ghi cả
    // khối lớn mỗi lần thay vì theo dòng), 10 kết nối dễ bị nghẽn hàng đợi khi có nhiều người dùng
    // thao tác đồng thời. Cho phép chỉnh qua .env để tinh chỉnh theo cấu hình SQL Server thực tế mà
    // không cần sửa code.
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    // min > 0 để tránh độ trễ "cold start" tạo lại kết nối mỗi khi pool rảnh lâu rồi có traffic trở lại.
    min: parseInt(process.env.DB_POOL_MIN || '2', 10),
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '30000', 10),
    // Nếu pool đã dùng hết (nghẽn thật sự khi quá tải), báo lỗi rõ ràng sau 15s thay vì để request
    // treo vô thời hạn chờ có kết nối rảnh.
    acquireTimeoutMillis: parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT_MS || '15000', 10)
  },
  // Timeout cho từng câu lệnh SQL và cho bước thiết lập kết nối — đặt tường minh (thay vì để mssql tự
  // dùng mặc định ẩn) để có thể tinh chỉnh qua .env khi cần, đặc biệt hữu ích khi DB ở xa hoặc dưới tải
  // cao. Giá trị mặc định giữ giống mssql (15s) để không đổi hành vi hiện tại.
  requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT_MS || '15000', 10),
  connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '15000', 10)
};

// Cảnh báo khởi động nếu chưa bật mã hoá kết nối tới SQL Server (DB_ENCRYPT) — KHÔNG tự đổi mặc định
// (vẫn giữ tắt) vì nhiều SQL Server nội bộ hiện tại chưa cấu hình chứng chỉ TLS, bật ép buộc sẽ làm
// server không kết nối được. In cảnh báo rõ ràng để admin biết cần bật khi hạ tầng đã sẵn sàng — dự
// kiến sẽ BẮT BUỘC bật ở đợt rà soát bảo mật kế tiếp.
if (!config.options.encrypt) {
  console.warn('⚠️  DB_ENCRYPT chưa bật (kết nối SQL Server hiện KHÔNG mã hoá) — chỉ chấp nhận được nếu SQL Server & ứng dụng cùng nằm trong mạng nội bộ tin cậy. Bật DB_ENCRYPT=true trong .env ngay khi SQL Server đã có chứng chỉ TLS (xem .env.example).');
}

// Cảnh báo khởi động nếu chưa bật mã hoá cột IpAddress trong Nhật ký hệ thống (xem lib/logCrypto.js) —
// KHÔNG chặn khởi động (log vẫn ghi được, chỉ ở dạng plaintext như trước) vì đây là lớp phòng thủ bổ
// sung (defense-in-depth), không phải điều kiện để hệ thống hoạt động đúng.
if (!process.env.LOG_ENCRYPTION_KEY) {
  console.warn('⚠️  LOG_ENCRYPTION_KEY chưa đặt (địa chỉ IP trong Nhật ký hệ thống hiện lưu dạng plaintext) — nên bật trước khi hệ thống public ra Internet để bảo vệ dữ liệu cá nhân (PII). Xem .env.example.');
}

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then(pool => {
        console.log('✅ Đã kết nối SQL Server:', config.server + ':' + config.port, '- DB:', config.database);
        return pool;
      })
      .catch(err => {
        console.error('⛔ Lỗi kết nối SQL Server:', err.message);
        poolPromise = null; // cho phép thử kết nối lại ở lần gọi sau
        throw err;
      });
  }
  return poolPromise;
}

module.exports = { sql, getPool };
