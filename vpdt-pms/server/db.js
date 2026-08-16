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
