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
    // autoApplyHour/autoApplyMinute (12/2026, xem chú thích ở sql/schema.sql) — mặc định 0:0 (giữ nguyên
    // hành vi cũ "áp giá từ 0 giờ") cho tới khi admin tự đổi. KHÔNG có autoApplyEnabled (xem lý do ở
    // getAutoApplyConfig() bên dưới).
    autoApplyHour: row.AutoApplyHour != null ? row.AutoApplyHour : 0,
    autoApplyMinute: row.AutoApplyMinute != null ? row.AutoApplyMinute : 0,
    // priceOperationMode/externalApi* (12/2026, theo yêu cầu người dùng "hai cái nút... chỉ chọn được một
    // trong hai") — xem chú thích đầy đủ ở sql/schema.sql ngay trên 3 cột này. Mặc định 'DIRECT_DB' giữ
    // nguyên hành vi hiện tại cho tới khi admin tự bật "Giá Theo API".
    priceOperationMode: row.PriceOperationMode || 'DIRECT_DB',
    externalApiBaseUrl: row.ExternalApiBaseUrl || '',
    externalApiKeyEnc: row.ExternalApiKeyEnc || null,
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
    return {
      host: '', port: 1433, database: '', user: '', hasPassword: false,
      autoDeleteEnabled: false, autoDeleteHour: 23, autoDeleteMinute: 0,
      autoApplyHour: 0, autoApplyMinute: 0,
      priceOperationMode: 'DIRECT_DB', externalApiBaseUrl: '', hasExternalApiKey: false
    };
  }
  // externalApiKeyEnc CŨNG là bí mật (dù đã mã hoá) — không trả thẳng ra client, cùng tinh thần passwordEnc
  // (chỉ báo hasExternalApiKey để UI biết đã từng nhập hay chưa, ô để trống = giữ nguyên khi lưu).
  const { passwordEnc, externalApiKeyEnc, ...rest } = cfg;
  return { ...rest, hasPassword: !!passwordEnc, hasExternalApiKey: !!externalApiKeyEnc };
}

// saveConfig(): password=null hoặc '' nghĩa là GIỮ NGUYÊN mật khẩu cũ (không xoá) — chỉ đổi khi người
// dùng thật sự gõ mật khẩu mới vào ô (client chỉ gửi password khi ô đó có giá trị, xem module JS).
async function saveConfig({ host, port, database, user, password, autoDeleteEnabled, autoDeleteHour, autoDeleteMinute }, actor) {
  const existing = await getRawConfig();
  const passwordEnc = password ? encryptSecret(password) : (existing ? existing.passwordEnc : null);
  // autoApplyHour/autoApplyMinute (12/2026): saveConfig() KHÔNG nhận 2 field này làm tham số (màn Cấu
  // Hình Kết Nối host/port/password không có ô này, xem saveDsmartPriceConfig() ở module JS) — LUÔN GIỮ
  // NGUYÊN giá trị đã lưu (existing), không ghi đè về mặc định, để sửa host/port/mật khẩu không vô tình
  // xoá mất giờ Lên Lịch Áp Giá admin đã tự chỉnh qua panel riêng (saveAutoApplyConfig() bên dưới).
  const autoApplyHour = existing ? existing.autoApplyHour : 0;
  const autoApplyMinute = existing ? existing.autoApplyMinute : 0;
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
  req.input('autoApplyHour', sql.Int, autoApplyHour);
  req.input('autoApplyMinute', sql.Int, autoApplyMinute);
  if (existing) {
    await req.query(`
      UPDATE dbo.DsmartPriceDbConfig SET
        UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @updatedBy, Host = @host, Port = @port,
        DatabaseName = @database, DbUser = @dbUser, PasswordEnc = @passwordEnc,
        AutoDeleteEnabled = @autoDeleteEnabled, AutoDeleteHour = @autoDeleteHour, AutoDeleteMinute = @autoDeleteMinute,
        AutoApplyHour = @autoApplyHour, AutoApplyMinute = @autoApplyMinute
      WHERE Id = @id`);
  } else {
    await req.query(`
      INSERT INTO dbo.DsmartPriceDbConfig
        (Id, UpdatedBy, Host, Port, DatabaseName, DbUser, PasswordEnc, AutoDeleteEnabled, AutoDeleteHour, AutoDeleteMinute, AutoApplyHour, AutoApplyMinute)
      VALUES (@id, @updatedBy, @host, @port, @database, @dbUser, @passwordEnc, @autoDeleteEnabled, @autoDeleteHour, @autoDeleteMinute, @autoApplyHour, @autoApplyMinute)`);
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

// getAutoApplyConfig()/saveAutoApplyConfig() (12/2026, theo yêu cầu người dùng "cho cái ô điều chỉnh, tự
// điều chỉnh bắt đầu từ giờ nào, giống xóa để cho chủ động") — cặp hàm RIÊNG mirror ĐÚNG khuôn
// getAutoDeleteConfig()/saveAutoDeleteConfig() ở trên, cho "📅 Lên Lịch Áp Giá". KHÔNG có field
// "autoApplyEnabled" — job "Lên Lịch Áp Giá" LUÔN chạy (không có công tắc bật/tắt cả module như Tự Động
// Xoá), chỉ có GIỜ áp dụng là điều chỉnh được; mặc định 0:0 giữ nguyên hành vi cũ "áp giá từ 0 giờ".
async function getAutoApplyConfig() {
  const cfg = await getRawConfig();
  if (!cfg) return { autoApplyHour: 0, autoApplyMinute: 0 };
  return { autoApplyHour: cfg.autoApplyHour, autoApplyMinute: cfg.autoApplyMinute };
}

async function saveAutoApplyConfig({ autoApplyHour, autoApplyMinute }, actor) {
  const existing = await getRawConfig();
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.BigInt, CONFIG_ROW_ID);
  req.input('updatedBy', sql.NVarChar(100), actor || null);
  req.input('autoApplyHour', sql.Int, Number.isFinite(autoApplyHour) ? autoApplyHour : 0);
  req.input('autoApplyMinute', sql.Int, Number.isFinite(autoApplyMinute) ? autoApplyMinute : 0);
  if (existing) {
    await req.query(`
      UPDATE dbo.DsmartPriceDbConfig SET
        UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @updatedBy,
        AutoApplyHour = @autoApplyHour, AutoApplyMinute = @autoApplyMinute
      WHERE Id = @id`);
  } else {
    // Chưa từng cấu hình kết nối mà đã chỉnh giờ Lên Lịch Áp Giá — vẫn cho lưu (Host/CSDL/User để trống,
    // AutoDelete* giữ mặc định), giống hệt nhánh "chưa có existing" của saveAutoDeleteConfig() ở trên.
    await req.input('host', sql.NVarChar(255), null).input('database', sql.NVarChar(100), null)
      .input('dbUser', sql.NVarChar(100), null).input('passwordEnc', sql.NVarChar(500), null)
      .input('port', sql.Int, 1433).input('autoDeleteEnabled', sql.Bit, false)
      .input('autoDeleteHour', sql.Int, 23).input('autoDeleteMinute', sql.Int, 0).query(`
      INSERT INTO dbo.DsmartPriceDbConfig
        (Id, UpdatedBy, Host, Port, DatabaseName, DbUser, PasswordEnc, AutoDeleteEnabled, AutoDeleteHour, AutoDeleteMinute, AutoApplyHour, AutoApplyMinute)
      VALUES (@id, @updatedBy, @host, @port, @database, @dbUser, @passwordEnc, @autoDeleteEnabled, @autoDeleteHour, @autoDeleteMinute, @autoApplyHour, @autoApplyMinute)`);
  }
  return getAutoApplyConfig();
}

// getPriceOperationMode()/getExternalApiConfig()/savePriceOperationMode()/saveExternalApiConfig() (12/2026,
// theo yêu cầu người dùng: "thêm có hai cái nút... kích hoạt sử dụng cài đặt giá theo phần mềm và kích
// hoạt sử dụng giá theo API. Chỉ chọn được một trong hai... tự cái kia sẽ vô hiệu") — tách RIÊNG khỏi
// saveConfig() như autoDelete/autoApply ở trên, cùng lý do: màn Cấu Hình Kết Nối (host/port/mật khẩu) đổi
// độc lập, không được vô tình đụng tới chế độ API/URL/Key đã lưu và ngược lại.
const PRICE_OPERATION_MODES = ['DIRECT_DB', 'EXTERNAL_API'];

async function getPriceOperationMode() {
  const cfg = await getRawConfig();
  return (cfg && PRICE_OPERATION_MODES.includes(cfg.priceOperationMode)) ? cfg.priceOperationMode : 'DIRECT_DB';
}

// getExternalApiConfig(): trả NGUYÊN VẸN (kèm externalApiKey đã GIẢI MÃ) — CHỈ dùng nội bộ server
// (lib/dsmartPriceExternalApiClient.js để gọi API đối tác thật). KHÔNG BAO GIỜ trả thẳng ra response, cùng
// nguyên tắc getRawConfig() ở trên.
async function getExternalApiConfig() {
  const cfg = await getRawConfig();
  if (!cfg) return { externalApiBaseUrl: '', externalApiKey: null };
  let externalApiKey = null;
  if (cfg.externalApiKeyEnc) {
    try { externalApiKey = decryptSecret(cfg.externalApiKeyEnc); } catch (err) { externalApiKey = null; }
  }
  return { externalApiBaseUrl: cfg.externalApiBaseUrl || '', externalApiKey };
}

async function savePriceOperationMode({ priceOperationMode }, actor) {
  const mode = PRICE_OPERATION_MODES.includes(priceOperationMode) ? priceOperationMode : 'DIRECT_DB';
  const existing = await getRawConfig();
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.BigInt, CONFIG_ROW_ID);
  req.input('updatedBy', sql.NVarChar(100), actor || null);
  req.input('priceOperationMode', sql.NVarChar(20), mode);
  if (existing) {
    await req.query(`
      UPDATE dbo.DsmartPriceDbConfig SET
        UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @updatedBy, PriceOperationMode = @priceOperationMode
      WHERE Id = @id`);
  } else {
    await req.query(`
      INSERT INTO dbo.DsmartPriceDbConfig (Id, UpdatedBy, PriceOperationMode)
      VALUES (@id, @updatedBy, @priceOperationMode)`);
  }
  return getPriceOperationMode();
}

// saveExternalApiConfig(): externalApiKey=null/'' nghĩa là GIỮ NGUYÊN key cũ (không xoá) — cùng khuôn
// password ở saveConfig() (client chỉ gửi key khi ô đó có giá trị mới, xem module JS).
async function saveExternalApiConfig({ externalApiBaseUrl, externalApiKey }, actor) {
  const existing = await getRawConfig();
  const externalApiKeyEnc = externalApiKey ? encryptSecret(externalApiKey) : (existing ? existing.externalApiKeyEnc : null);
  const pool = await getPool();
  const req = pool.request();
  req.input('id', sql.BigInt, CONFIG_ROW_ID);
  req.input('updatedBy', sql.NVarChar(100), actor || null);
  req.input('externalApiBaseUrl', sql.NVarChar(500), externalApiBaseUrl || null);
  req.input('externalApiKeyEnc', sql.NVarChar(500), externalApiKeyEnc);
  if (existing) {
    await req.query(`
      UPDATE dbo.DsmartPriceDbConfig SET
        UpdatedAt = SYSUTCDATETIME(), UpdatedBy = @updatedBy,
        ExternalApiBaseUrl = @externalApiBaseUrl, ExternalApiKeyEnc = @externalApiKeyEnc
      WHERE Id = @id`);
  } else {
    await req.query(`
      INSERT INTO dbo.DsmartPriceDbConfig (Id, UpdatedBy, ExternalApiBaseUrl, ExternalApiKeyEnc)
      VALUES (@id, @updatedBy, @externalApiBaseUrl, @externalApiKeyEnc)`);
  }
  const cfg = await getRawConfig();
  return { externalApiBaseUrl: cfg.externalApiBaseUrl, hasExternalApiKey: !!cfg.externalApiKeyEnc };
}

module.exports = {
  getRawConfig, getSanitizedConfig, saveConfig, getAutoDeleteConfig, saveAutoDeleteConfig,
  getAutoApplyConfig, saveAutoApplyConfig, getPriceOperationMode, getExternalApiConfig,
  savePriceOperationMode, saveExternalApiConfig, decryptSecret
};
