// lib/dsmartStorePriceConnectionsStore.js — đọc/ghi dbo.DsmartStorePriceConnections (danh sách kết nối
// SQL Server RIÊNG của TỪNG siêu thị, phục vụ FAN-OUT trực tiếp "💰 Cài Đặt Giá Bán Buôn" xuống CSPRICE
// local mọi siêu thị — xem chú thích đầy đủ ở sql/schema.sql ngay trên CREATE TABLE
// dbo.DsmartStorePriceConnections). Cùng khuôn mã hoá mật khẩu như lib/dsmartPriceConfigStore.js
// (AES-256-GCM qua lib/emailCrypto.js) — CHỈ routes/dsmartWholesalePrice.js và lib/dsmartSqlClient.js
// (fan-out) được gọi tới file này.
const { getPool, sql } = require('../db');
const { encryptSecret, decryptSecret } = require('./emailCrypto');
const { HttpError } = require('./httpErrors');

// Giới hạn độ dài khớp đúng kiểu cột SQL khai báo ở sql/schema.sql (NVARCHAR(50)/(200)/(255)/(100)) — báo
// lỗi rõ ràng ngay ở tầng ứng dụng thay vì để SQL Server tự chặn bằng lỗi "String or binary data would
// be truncated" khó hiểu (audit chéo 12/2026 phát hiện route /apply đã có check tương tự, store-
// connections thì chưa).
const MAX_LEN = { storeCode: 50, storeName: 200, host: 255, database: 100, user: 100 };
function checkFieldLengths(fields) {
  for (const [key, max] of Object.entries(MAX_LEN)) {
    if (fields[key] && String(fields[key]).length > max) {
      throw new HttpError(400, `Trường "${key}" vượt quá ${max} ký tự cho phép.`);
    }
  }
}

function rowToRaw(row) {
  return {
    id: Number(row.Id),
    storeCode: row.StoreCode,
    storeName: row.StoreName,
    host: row.Host,
    port: row.Port || 1433,
    database: row.DatabaseName,
    user: row.DbUser,
    passwordEnc: row.PasswordEnc,
    enabled: !!row.Enabled,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
    updatedBy: row.UpdatedBy || null
  };
}

function sanitize(raw) {
  const { passwordEnc, ...rest } = raw;
  return { ...rest, hasPassword: !!passwordEnc };
}

// listRaw(): TRẢ NGUYÊN VẸN (kể cả PasswordEnc) — CHỈ dùng nội bộ server (lib/dsmartSqlClient.js để mở
// pool thật khi fan-out). KHÔNG BAO GIỜ trả thẳng ra response.
async function listRaw({ onlyEnabled = false } = {}) {
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM dbo.DsmartStorePriceConnections ORDER BY StoreCode');
  const rows = result.recordset.map(rowToRaw);
  return onlyEnabled ? rows.filter(r => r.enabled) : rows;
}

async function listSanitized() {
  return (await listRaw()).map(sanitize);
}

async function getRawById(id) {
  const pool = await getPool();
  const result = await pool.request().input('id', sql.BigInt, id)
    .query('SELECT * FROM dbo.DsmartStorePriceConnections WHERE Id = @id');
  const row = result.recordset[0];
  return row ? rowToRaw(row) : null;
}

async function createStore({ storeCode, storeName, host, port, database, user, password }, actor) {
  if (!storeCode || !storeName || !host || !database || !user || !password) {
    throw new HttpError(400, 'Thiếu Mã Siêu Thị/Tên/Host/Tên CSDL/Tài khoản/Mật khẩu');
  }
  checkFieldLengths({ storeCode, storeName, host, database, user });
  const pool = await getPool();
  const existing = await pool.request().input('code', sql.NVarChar(50), String(storeCode).trim())
    .query('SELECT Id FROM dbo.DsmartStorePriceConnections WHERE StoreCode = @code');
  if (existing.recordset.length) {
    throw new HttpError(400, `Mã Siêu Thị "${storeCode}" đã có kết nối khác — sửa kết nối đã có thay vì tạo trùng.`);
  }
  const id = Date.now() + Math.floor(Math.random() * 1000);
  await pool.request()
    .input('id', sql.BigInt, id)
    .input('storeCode', sql.NVarChar(50), String(storeCode).trim())
    .input('storeName', sql.NVarChar(200), String(storeName).trim())
    .input('host', sql.NVarChar(255), String(host).trim())
    .input('port', sql.Int, Number(port) || 1433)
    .input('database', sql.NVarChar(100), String(database).trim())
    .input('dbUser', sql.NVarChar(100), String(user).trim())
    .input('passwordEnc', sql.NVarChar(500), encryptSecret(String(password)))
    .input('updatedBy', sql.NVarChar(100), actor || null)
    .query(`
      INSERT INTO dbo.DsmartStorePriceConnections
        (Id, StoreCode, StoreName, Host, Port, DatabaseName, DbUser, PasswordEnc, Enabled, UpdatedBy)
      VALUES (@id, @storeCode, @storeName, @host, @port, @database, @dbUser, @passwordEnc, 1, @updatedBy)`);
  return sanitize(await getRawById(id));
}

// updateStore(): password rỗng/không gửi = GIỮ NGUYÊN mật khẩu cũ (cùng ngữ nghĩa dsmartPriceConfigStore).
async function updateStore(id, { storeCode, storeName, host, port, database, user, password, enabled }, actor) {
  const existing = await getRawById(id);
  if (!existing) throw new HttpError(404, 'Không tìm thấy kết nối siêu thị này — có thể đã bị xoá.');
  if (!storeCode || !storeName || !host || !database || !user) {
    throw new HttpError(400, 'Thiếu Mã Siêu Thị/Tên/Host/Tên CSDL/Tài khoản');
  }
  checkFieldLengths({ storeCode, storeName, host, database, user });
  const pool = await getPool();
  const dupCheck = await pool.request().input('code', sql.NVarChar(50), String(storeCode).trim()).input('id', sql.BigInt, id)
    .query('SELECT Id FROM dbo.DsmartStorePriceConnections WHERE StoreCode = @code AND Id <> @id');
  if (dupCheck.recordset.length) {
    throw new HttpError(400, `Mã Siêu Thị "${storeCode}" đã được dùng cho 1 kết nối khác.`);
  }
  const passwordEnc = password ? encryptSecret(String(password)) : existing.passwordEnc;
  await pool.request()
    .input('id', sql.BigInt, id)
    .input('storeCode', sql.NVarChar(50), String(storeCode).trim())
    .input('storeName', sql.NVarChar(200), String(storeName).trim())
    .input('host', sql.NVarChar(255), String(host).trim())
    .input('port', sql.Int, Number(port) || 1433)
    .input('database', sql.NVarChar(100), String(database).trim())
    .input('dbUser', sql.NVarChar(100), String(user).trim())
    .input('passwordEnc', sql.NVarChar(500), passwordEnc)
    .input('enabled', sql.Bit, enabled !== undefined ? !!enabled : existing.enabled)
    .input('updatedBy', sql.NVarChar(100), actor || null)
    .query(`
      UPDATE dbo.DsmartStorePriceConnections SET
        StoreCode = @storeCode, StoreName = @storeName, Host = @host, Port = @port,
        DatabaseName = @database, DbUser = @dbUser, PasswordEnc = @passwordEnc, Enabled = @enabled,
        UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @updatedBy
      WHERE Id = @id`);
  return sanitize(await getRawById(id));
}

async function deleteStore(id) {
  const pool = await getPool();
  await pool.request().input('id', sql.BigInt, id).query('DELETE FROM dbo.DsmartStorePriceConnections WHERE Id = @id');
}

module.exports = { listRaw, listSanitized, getRawById, createStore, updateStore, deleteStore, decryptSecret };
