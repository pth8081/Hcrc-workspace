// seedDefaults.js — Ghi dữ liệu mặc định vào SQL Server nếu bảng AppData chưa có key tương ứng,
// và di trú mật khẩu người dùng còn ở dạng plaintext sang bcrypt (chạy mỗi lần khởi động, idempotent
// — không đổi gì nếu mật khẩu đã hash rồi).
const { getPool, sql } = require('./db');
const { DEFAULTS } = require('./defaults');
const { hashPassword, isBcryptHash, verifyPassword } = require('./lib/auth');
const { getAppDataValue, setAppDataValue } = require('./lib/appData');
const { migrateLegacySystemLogs } = require('./lib/systemLogStore');

// Mật khẩu mặc định của các tài khoản seed lúc khởi tạo hệ thống lần đầu (defaults.js) — dùng để dò
// tài khoản NÀO CÒN đang dùng đúng mật khẩu này (xem flagKnownDefaultPasswords() bên dưới), bất kể
// tài khoản đó được tạo từ seed hay admin tự đặt sau này trùng giá trị.
const KNOWN_DEFAULT_PASSWORDS = ['123456'];

async function seedDefaults() {
  const pool = await getPool();
  for (const key of Object.keys(DEFAULTS)) {
    const existing = await pool.request()
      .input('k', sql.NVarChar(100), key)
      .query('SELECT 1 FROM dbo.AppData WHERE DataKey = @k');

    if (existing.recordset.length === 0) {
      console.log(`   ↳ Seed mặc định cho "${key}"`);
      await pool.request()
        .input('k', sql.NVarChar(100), key)
        .input('v', sql.NVarChar(sql.MAX), JSON.stringify(DEFAULTS[key]))
        .query('INSERT INTO dbo.AppData (DataKey, DataValue) VALUES (@k, @v)');
    }
  }

  await migratePlaintextPasswords();
  await flagKnownDefaultPasswords();
  await migrateLegacySystemLogs();
}

// Trước đây mật khẩu lưu plaintext (cả trong seed mặc định lẫn dữ liệu do admin tạo trước khi có
// tầng xác thực thật). Hàm này quét collection "users", hash lại bất kỳ mật khẩu nào CHƯA phải
// dạng bcrypt ($2a$/$2b$/$2y$...), rồi ghi lại — chạy mỗi lần khởi động, không hash lại 2 lần.
async function migratePlaintextPasswords() {
  const users = await getAppDataValue('users');
  if (!Array.isArray(users) || users.length === 0) return;

  let changed = false;
  const migrated = await Promise.all(users.map(async (u) => {
    const current = u.pass || u.password;
    if (!current || isBcryptHash(current)) return u;
    changed = true;
    const { password, ...rest } = u; // gộp về 1 field "pass" duy nhất, bỏ field "password" cũ (nếu có)
    return { ...rest, pass: await hashPassword(current) };
  }));

  if (changed) {
    await setAppDataValue('users', migrated);
    console.log('   ↳ Đã di trú mật khẩu người dùng còn ở dạng plaintext sang bcrypt.');
  }
}

// Rủi ro thực tế: tài khoản seed (admin/nv_nhansu/...) mặc định mật khẩu "123456" — nếu không ai đổi
// sau khi triển khai, đây là lỗ hổng rất dễ bị khai thác (mật khẩu đoán được ngay). Chạy mỗi lần khởi
// động (idempotent — bỏ qua user đã có cờ hoặc đã đổi mật khẩu khác): dùng CHÍNH cơ chế xác minh mật
// khẩu thật (verifyPassword, so với bcrypt hash đã lưu) để dò xem tài khoản nào CÒN đang dùng đúng 1
// trong các mật khẩu mặc định đã biết, rồi đánh dấu mustChangePassword=true — buộc đổi ngay lần đăng
// nhập kế tiếp (xem lib/auth.js blockIfMustChangePassword). Áp dụng cho MỌI tài khoản đang dùng trùng
// giá trị này, không riêng gì các user được tạo từ seed ban đầu.
async function flagKnownDefaultPasswords() {
  const users = await getAppDataValue('users');
  if (!Array.isArray(users) || users.length === 0) return;

  let changed = false;
  const flagged = await Promise.all(users.map(async (u) => {
    if (u.mustChangePassword) return u; // đã đánh dấu rồi (kể cả do admin đặt mật khẩu tạm khác)
    const hash = u.pass || u.password;
    if (!hash) return u;
    for (const guess of KNOWN_DEFAULT_PASSWORDS) {
      if (await verifyPassword(guess, hash)) {
        changed = true;
        return { ...u, mustChangePassword: true };
      }
    }
    return u;
  }));

  if (changed) {
    await setAppDataValue('users', flagged);
    console.log('   ↳ Đã đánh dấu bắt buộc đổi mật khẩu cho các tài khoản còn dùng mật khẩu mặc định.');
  }
}

module.exports = { seedDefaults };
