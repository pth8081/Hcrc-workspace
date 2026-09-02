// lib/ephemeralStore.js — kho lưu tạm dùng chung cho mọi trạng thái xác thực nhiều bước ngắn hạn
// (dbo.EphemeralAuthTokens, xem sql/schema.sql). Thay cho việc mỗi module (TOTP/WebAuthn/CAPTCHA/
// approvalAuth) tự giữ 1 Map riêng trong bộ nhớ tiến trình — cách đó CHỈ đúng khi chạy đúng 1 tiến
// trình Node; chạy PM2 cluster nhiều tiến trình (instances > 1) mà không có sticky session, request
// "cấp" (VD nhập đúng mật khẩu, chờ mã TOTP) và request "xác minh" (gõ mã TOTP) rất có thể rơi vào 2
// tiến trình khác nhau — Map của tiến trình B không hề thấy dữ liệu tiến trình A vừa ghi, báo lỗi
// nhầm dù người dùng thao tác đúng. Chuyển hẳn sang 1 bảng SQL dùng chung để đúng bất kỳ tiến trình
// nào xử lý request cũng đọc/ghi cùng 1 nguồn, không phụ thuộc cấu hình sticky session ở Nginx.
//
// TokenKey là chuỗi tự do do nơi gọi tự đặt, quy ước có tiền tố theo module để không đụng nhau dù
// dùng chung 1 bảng (VD "totp:login:<username>", "webauthn:reg:<username>", "captcha:<id>",
// "approval:grant:<username>"). Payload là JSON bất kỳ (object/boolean/string...).
const crypto = require('crypto');
const { getPool, sql } = require('../db');

// Dọn dẹp bản ghi hết hạn — chạy XÁC SUẤT (không phải mỗi lần ghi), cùng khuôn
// lib/systemLogStore.js insertSystemLog() — đây chỉ là dọn dẹp định kỳ, không cần đúng-ngay-lập-tức.
async function pruneExpired() {
  const pool = await getPool();
  await pool.request().query('DELETE FROM dbo.EphemeralAuthTokens WHERE ExpiresAt <= SYSUTCDATETIME()');
}

// Ghi/ghi đè 1 token, hết hạn sau ttlMs kể từ lúc gọi.
// WITH (HOLDLOCK) trên target — lỗi đã biết của SQL Server: MERGE không tự khoá đủ chặt, 2 request
// cùng tạo 1 TokenKey MỚI (chưa tồn tại) gần như đồng thời có thể cùng đọc thấy "chưa khớp" rồi cùng
// chạy nhánh INSERT, gây lỗi 500 vi phạm khoá chính thay vì upsert êm — phát hiện ở audit Đợt 5, Giai
// đoạn 3. HOLDLOCK ép SQL Server giữ khoá tới hết statement, request thứ 2 phải chờ thay vì đọc trùng.
async function setToken(key, value, ttlMs) {
  const pool = await getPool();
  const expiresAt = new Date(Date.now() + ttlMs);
  await pool.request()
    .input('key', sql.NVarChar(200), key)
    .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(value))
    .input('expiresAt', sql.DateTime2, expiresAt)
    .query(`
      MERGE dbo.EphemeralAuthTokens WITH (HOLDLOCK) AS target
      USING (SELECT @key AS TokenKey) AS src ON target.TokenKey = src.TokenKey
      WHEN MATCHED THEN UPDATE SET Payload = @payload, ExpiresAt = @expiresAt
      WHEN NOT MATCHED THEN INSERT (TokenKey, Payload, ExpiresAt) VALUES (@key, @payload, @expiresAt);
    `);
  // crypto.randomInt() thay vì Math.random() — không phải vì lấy mẫu 2% cần độ an toàn mật mã, mà để
  // module này (nằm ngay trên đường xử lý OTP/TOTP/WebAuthn) không lỡ khiến các hàm sinh mã bảo mật gọi
  // TỚI Math.random() dù chỉ gián tiếp, tránh phá bất biến "không đụng Math.random" các nơi gọi vào đây
  // đã cố tình giữ (xem lib/approvalAuth.js, tests/test-audit-round2-cluster6.js mục [6]).
  if (crypto.randomInt(0, 100) < 2) {
    pruneExpired().catch(err => console.error('Dọn dẹp ephemeral token lỗi:', err.message));
  }
}

// Đọc 1 token còn hạn mà KHÔNG xoá — dùng cho trường hợp cần đọc nhiều lần trong lúc hết hạn (VD bí
// mật TOTP đang trong quá trình thiết lập, người dùng có thể gõ sai mã vài lần mà không mất bí mật).
async function peekToken(key) {
  const pool = await getPool();
  const result = await pool.request()
    .input('key', sql.NVarChar(200), key)
    .query('SELECT Payload FROM dbo.EphemeralAuthTokens WHERE TokenKey = @key AND ExpiresAt > SYSUTCDATETIME()');
  if (!result.recordset.length) return null;
  try { return JSON.parse(result.recordset[0].Payload); } catch { return null; }
}

// Đọc + xoá NGAY trong 1 câu lệnh (atomic) — dùng cho mọi token "dùng 1 lần" (phiếu Duyệt, mã OTP,
// challenge WebAuthn, phiếu chờ TOTP...). Trả về giá trị đã lưu nếu còn hạn, null nếu không tồn tại
// hoặc đã hết hạn (token hết hạn vẫn bị xoá luôn trong câu lệnh này — dọn rác tiện thể).
async function consumeToken(key) {
  const pool = await getPool();
  const result = await pool.request()
    .input('key', sql.NVarChar(200), key)
    .query('DELETE FROM dbo.EphemeralAuthTokens OUTPUT deleted.Payload, deleted.ExpiresAt WHERE TokenKey = @key');
  if (!result.recordset.length) return null;
  const row = result.recordset[0];
  if (new Date(row.ExpiresAt).getTime() <= Date.now()) return null;
  try { return JSON.parse(row.Payload); } catch { return null; }
}

async function deleteToken(key) {
  const pool = await getPool();
  await pool.request().input('key', sql.NVarChar(200), key).query('DELETE FROM dbo.EphemeralAuthTokens WHERE TokenKey = @key');
}

module.exports = { setToken, peekToken, consumeToken, deleteToken, pruneExpired };
