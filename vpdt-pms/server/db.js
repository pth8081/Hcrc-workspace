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
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
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
