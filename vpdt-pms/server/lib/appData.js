// lib/appData.js — Đọc/ghi 1 collection JSON trong dbo.AppData, dùng chung bởi routes/data.js,
// routes/auth.js, routes/workflow.js và seedDefaults.js (trước đây mỗi nơi tự viết lại cùng 1 đoạn SQL).
const { getPool, sql } = require('../db');

async function getAppDataValue(key) {
  const pool = await getPool();
  const result = await pool.request()
    .input('k', sql.NVarChar(100), key)
    .query('SELECT DataValue FROM dbo.AppData WHERE DataKey = @k');
  if (result.recordset.length === 0) return null;
  return JSON.parse(result.recordset[0].DataValue);
}

// Đọc kèm "version" (chính là UpdatedAt, cột đã có sẵn NOT NULL DEFAULT SYSUTCDATETIME() — xem
// sql/schema.sql, không cần thêm cột mới) — dùng làm token optimistic concurrency: client phải gửi
// lại đúng version đã đọc thì ghi mới được chấp nhận, tránh 2 người ghi đè mất thay đổi của nhau.
async function getAppDataValueWithVersion(key) {
  const pool = await getPool();
  const result = await pool.request()
    .input('k', sql.NVarChar(100), key)
    .query('SELECT DataValue, UpdatedAt FROM dbo.AppData WHERE DataKey = @k');
  if (result.recordset.length === 0) return { value: null, version: null };
  const row = result.recordset[0];
  return { value: JSON.parse(row.DataValue), version: row.UpdatedAt.toISOString() };
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

// Ghi CÓ ĐIỀU KIỆN: chỉ áp dụng nếu UpdatedAt hiện tại trong DB vẫn khớp đúng expectedVersion đã đọc
// trước đó — UPDATE ... WHERE ... là 1 lệnh nguyên tử ở tầng SQL Server nên an toàn trước race
// condition thật (2 request tới cùng lúc), không chỉ là kiểm tra "đọc rồi so sánh rồi ghi" ở tầng app.
// Trả rowsAffected=0 (conflict=true) nếu ai đó đã ghi đè key này sau lần client đọc gần nhất.
async function setAppDataValueIfVersionMatches(key, value, expectedVersion) {
  const pool = await getPool();
  const result = await pool.request()
    .input('k', sql.NVarChar(100), key)
    .input('v', sql.NVarChar(sql.MAX), JSON.stringify(value))
    .input('expected', sql.DateTime2(3), new Date(expectedVersion))
    .query(`
      UPDATE dbo.AppData
      SET DataValue = @v, UpdatedAt = SYSUTCDATETIME()
      WHERE DataKey = @k AND UpdatedAt = @expected;

      SELECT UpdatedAt FROM dbo.AppData WHERE DataKey = @k;
    `);
  const conflict = result.rowsAffected[0] === 0;
  const newVersion = result.recordset?.[0]?.UpdatedAt?.toISOString() || null;
  return { conflict, version: newVersion };
}

// Đọc TOÀN BỘ AppData trong 1 lượt (không kèm version) — dùng làm ngữ cảnh tra cứu (cấu hình quy
// trình theo phòng ban/loại, danh sách user...) cho routes/workflow.js, không phải nơi ghi dữ liệu.
async function getAllAppData() {
  const pool = await getPool();
  const result = await pool.request().query('SELECT DataKey, DataValue FROM dbo.AppData');
  const data = {};
  for (const row of result.recordset) {
    try { data[row.DataKey] = JSON.parse(row.DataValue); } catch (e) { data[row.DataKey] = null; }
  }
  return data;
}

// Đọc-sửa-ghi 1 collection trong 1 giao dịch có khoá dòng (UPDLOCK, HOLDLOCK) — dùng cho các thay
// đổi chỉ động tới 1 phần tử trong mảng (vd. duyệt 1 hồ sơ) để 2 request xử lý 2 hồ sơ KHÁC NHAU
// trong CÙNG collection không bị chặn nhầm lẫn nhau (khác với optimistic concurrency ở
// setAppDataValueIfVersionMatches — nơi đó phù hợp khi client tự thay cả collection nên không biết
// gộp thay đổi, còn ở đây server biết chính xác đang sửa gì nên khoá+đọc-mới-nhất+ghi là đủ an toàn
// và không gây xung đột giả giữa các hồ sơ độc lập). mutatorFn nhận mảng hiện tại, trả mảng mới cần
// lưu (hoặc throw để huỷ giao dịch, không ghi gì cả).
async function withLockedAppDataValue(key, mutatorFn) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const readReq = new sql.Request(tx);
    const readResult = await readReq
      .input('k', sql.NVarChar(100), key)
      .query('SELECT DataValue FROM dbo.AppData WITH (UPDLOCK, HOLDLOCK) WHERE DataKey = @k');
    if (readResult.recordset.length === 0) {
      throw new Error(`Key không tồn tại trong AppData: ${key}`);
    }
    const currentValue = JSON.parse(readResult.recordset[0].DataValue);

    const newValue = await mutatorFn(currentValue);

    const writeReq = new sql.Request(tx);
    await writeReq
      .input('k', sql.NVarChar(100), key)
      .input('v', sql.NVarChar(sql.MAX), JSON.stringify(newValue))
      .query('UPDATE dbo.AppData SET DataValue = @v, UpdatedAt = SYSUTCDATETIME() WHERE DataKey = @k');

    await tx.commit();
    return newValue;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

module.exports = {
  getAppDataValue, getAppDataValueWithVersion, getAllAppData,
  setAppDataValue, setAppDataValueIfVersionMatches, withLockedAppDataValue
};
