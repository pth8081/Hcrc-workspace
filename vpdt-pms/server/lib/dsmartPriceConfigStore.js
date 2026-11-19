// lib/dsmartPriceConfigStore.js — đọc/ghi dbo.DsmartPriceDbConfig (thông tin kết nối CSDL BÊN NGOÀI
// DSmart16 Trung Tâm cho tính năng "💰 Cài Đặt Giá Bán Buôn", Hỗ Trợ IT). Bảng RIÊNG, TÁCH HẲN khỏi
// dbo.AppData — xem chú thích đầy đủ ở sql/schema.sql ngay trên CREATE TABLE dbo.DsmartPriceDbConfig lý
// do không dùng AppData (tránh rủi ro quên sanitize khiến mật khẩu lộ qua GET /api/data chung). CHỈ
// routes/dsmartWholesalePrice.js và lib/dsmartSqlClient.js được gọi tới file này.
const { getPool, sql } = require('../db');
const { encryptSecret, decryptSecret } = require('./emailCrypto');

const CONFIG_ROW_ID = 1;

// getRawConfig(): trả NGUYÊN VẸN (kể cả PasswordEnc) — CHỈ dùng nội bộ server (lib/dsmartSqlClient.js để
// mở kết nối thật). KHÔNG BAO GIỜ trả thẳng ra response — route phải gọi getSanitizedConfig() cho mọi
// response trả về client.
async function getRawConfig() {
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.BigInt, CONFIG_ROW_ID)
    .query('SELECT * FROM dbo.DsmartPriceDbConfig WHERE Id = @id');
  const row = result.recordset[0];
  if (!row) return null;
  return {
    host: row.Host || '',
    port: row.Port || 1433,
    database: row.DatabaseName || '',
    user: row.DbUser || '',
    passwordEnc: row.PasswordEnc || null,
    autoDeleteEnabled: !!row.AutoDeleteEnabled,
    autoDeleteHour: row.AutoDeleteHour != null ? row.AutoDeleteHour : 23,
    autoDeleteMinute: row.AutoDeleteMinute != null ? row.AutoDeleteMinute : 0,
    updatedAt: row.UpdatedAt,
    updatedBy: row.UpdatedBy || null
  };
}

// getSanitizedConfig(): an toàn trả cho client — KHÔNG BAO GIỜ trả mật khẩu (kể cả đã mã hoá), chỉ báo
// hasPassword để màn Cấu Hình biết đã từng nhập hay chưa (ô mật khẩu để trống nghĩa là "giữ nguyên mật
// khẩu cũ" khi lưu, cùng khuôn inventoryApiConfig.hasApiKey).
async function getSanitizedConfig() {
  const cfg = await getRawConfig();
  if (!cfg) {
    return { host: '', port: 1433, database: '', user: '', hasPassword: false, autoDeleteEnabled: false, autoDeleteHour: 23, autoDeleteMinute: 0 };
  }
  const { passwordEnc, ...rest } = cfg;
  return { ...rest, hasPassword: !!passwordEnc };
}

// saveConfig(): password=null hoặc '' nghĩa là GIỮ NGUYÊN mật khẩu cũ (không xoá) — chỉ đổi khi người
// dùng thật sự gõ mật khẩu mới vào ô (client chỉ gửi password khi ô đó có giá trị, xem module JS).
async function saveConfig({ host, port, database, user, password, autoDeleteEnabled, autoDeleteHour, autoDeleteMinute }, actor) {
  const existing = await getRawConfig();
  const passwordEnc = password ? encryptSecret(password) : (existing ? existing.passwordEnc : null);
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.BigInt, CONFIG_ROW_ID);
  req.input('updatedBy', sql.NVarChar(100), actor || null);
  req.input('host', sql.NVarChar(255), host || null);
  req.input('port', sql.Int, port || 1433);
  req.input('database', sql.NVarChar(100), database || null);
  req.input('dbUser', sql.NVarChar(100), user || null);
  req.input('passwordEnc', sql.NVarChar(500), passwordEnc);
  req.input('autoDeleteEnabled', sql.Bit, !!autoDeleteEnabled);
  req.input('autoDeleteHour', sql.Int, Number.isFinite(autoDeleteHour) ? autoDeleteHour : 23);
  req.input('autoDeleteMinute', sql.Int, Number.isFinite(autoDeleteMinute) ? autoDeleteMinute : 0);
  if (existing) {
    await req.query(`
      UPDATE dbo.DsmartPriceDbConfig SET
        UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @updatedBy, Host = @host, Port = @port,
        DatabaseName = @database, DbUser = @dbUser, PasswordEnc = @passwordEnc,
        AutoDeleteEnabled = @autoDeleteEnabled, AutoDeleteHour = @autoDeleteHour, AutoDeleteMinute = @autoDeleteMinute
      WHERE Id = @id`);
  } else {
    await req.query(`
      INSERT INTO dbo.DsmartPriceDbConfig
        (Id, UpdatedBy, Host, Port, DatabaseName, DbUser, PasswordEnc, AutoDeleteEnabled, AutoDeleteHour, AutoDeleteMinute)
      VALUES (@id, @updatedBy, @host, @port, @database, @dbUser, @passwordEnc, @autoDeleteEnabled, @autoDeleteHour, @autoDeleteMinute)`);
  }
  return getSanitizedConfig();
}

// getAutoDeleteConfig()/saveAutoDeleteConfig(): tách RIÊNG khỏi saveConfig() ở trên — "🔁 Tự động xoá khi
// hết hạn" là cấu hình NGHIỆP VỤ hàng ngày (đội Hỗ Trợ IT tự bật/tắt), KHÁC HẲN host/port/CSDL/mật khẩu
// (hạ tầng nhạy cảm, CHỈ admin). routes/dsmartWholesalePrice.js gác 2 nhóm field này ở 2 mức quyền khác
// nhau — PHẢI có 2 hàm ghi riêng để không ai vô tình (hoặc cố ý qua endpoint sai) đổi được host/mật khẩu
// qua đường tưởng chừng chỉ "bật tắt tự động xoá".
async function getAutoDeleteConfig() {
  const cfg = await getRawConfig();
  if (!cfg) return { autoDeleteEnabled: false, autoDeleteHour: 23, autoDeleteMinute: 0 };
  return { autoDeleteEnabled: cfg.autoDeleteEnabled, autoDeleteHour: cfg.autoDeleteHour, autoDeleteMinute: cfg.autoDeleteMinute };
}

async function saveAutoDeleteConfig({ autoDeleteEnabled, autoDeleteHour, autoDeleteMinute }, actor) {
  const existing = await getRawConfig();
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.BigInt, CONFIG_ROW_ID);
  req.input('updatedBy', sql.NVarChar(100), actor || null);
  req.input('autoDeleteEnabled', sql.Bit, !!autoDeleteEnabled);
  req.input('autoDeleteHour', sql.Int, Number.isFinite(autoDeleteHour) ? autoDeleteHour : 23);
  req.input('autoDeleteMinute', sql.Int, Number.isFinite(autoDeleteMinute) ? autoDeleteMinute : 0);
  if (existing) {
    await req.query(`
      UPDATE dbo.DsmartPriceDbConfig SET
        UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @updatedBy,
        AutoDeleteEnabled = @autoDeleteEnabled, AutoDeleteHour = @autoDeleteHour, AutoDeleteMinute = @autoDeleteMinute
      WHERE Id = @id`);
  } else {
    // Chưa từng cấu hình kết nối mà đã bật Tự Động Xoá — vẫn cho lưu (Host/CSDL/User để trống), nhưng
    // job (jobs/dsmartAutoDeleteExpiredPrices.js) sẽ không làm gì được cho tới khi admin nhập đủ kết nối
    // (getDsmartPool() tự chặn rõ ràng, xem lib/dsmartSqlClient.js).
    await req.input('host', sql.NVarChar(255), null).input('database', sql.NVarChar(100), null)
      .input('dbUser', sql.NVarChar(100), null).input('passwordEnc', sql.NVarChar(500), null)
      .input('port', sql.Int, 1433).query(`
      INSERT INTO dbo.DsmartPriceDbConfig
        (Id, UpdatedBy, Host, Port, DatabaseName, DbUser, PasswordEnc, AutoDeleteEnabled, AutoDeleteHour, AutoDeleteMinute)
      VALUES (@id, @updatedBy, @host, @port, @database, @dbUser, @passwordEnc, @autoDeleteEnabled, @autoDeleteHour, @autoDeleteMinute)`);
  }
  return getAutoDeleteConfig();
}

module.exports = { getRawConfig, getSanitizedConfig, saveConfig, getAutoDeleteConfig, saveAutoDeleteConfig, decryptSecret };
