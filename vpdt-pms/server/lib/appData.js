// lib/appData.js — Đọc/ghi 1 collection JSON trong dbo.AppData, dùng chung bởi routes/data.js,
// routes/auth.js và seedDefaults.js (trước đây mỗi nơi tự viết lại cùng 1 đoạn SQL).
const { getPool, sql } = require('../db');

async function getAppDataValue(key) {
  const pool = await getPool();
  const result = await pool.request()
    .input('k', sql.NVarChar(100), key)
    .query('SELECT DataValue FROM dbo.AppData WHERE DataKey = @k');
  if (result.recordset.length === 0) return null;
  return JSON.parse(result.recordset[0].DataValue);
}

async function setAppDataValue(key, value) {
  const pool = await getPool();
  await pool.request()
    .input('k', sql.NVarChar(100), key)
    .input('v', sql.NVarChar(sql.MAX), JSON.stringify(value))
    .query(`
      MERGE dbo.AppData AS target
      USING (SELECT @k AS DataKey) AS src
      ON target.DataKey = src.DataKey
      WHEN MATCHED THEN
        UPDATE SET DataValue = @v, UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (DataKey, DataValue) VALUES (@k, @v);
    `);
}

module.exports = { getAppDataValue, setAppDataValue };
