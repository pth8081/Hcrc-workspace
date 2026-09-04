// seedDefaults.js — Ghi dữ liệu mặc định vào SQL Server nếu bảng AppData chưa có key tương ứng,
// và di trú mật khẩu người dùng còn ở dạng plaintext sang bcrypt (chạy mỗi lần khởi động, idempotent
// — không đổi gì nếu mật khẩu đã hash rồi).
const { getPool, sql } = require('./db');
const { DEFAULTS } = require('./defaults');
const { hashPassword, isBcryptHash, verifyPassword } = require('./lib/auth');
const { getAppDataValue, setAppDataValue } = require('./lib/appData');
const { migrateLegacySystemLogs } = require('./lib/systemLogStore');
const { migrateLegacyTasks } = require('./lib/taskStore');
const { migrateAllLegacyCollections } = require('./lib/recordStore');

// Mật khẩu mặc định của các tài khoản seed lúc khởi tạo hệ thống lần đầu (defaults.js) — dùng để dò
// tài khoản NÀO CÒN đang dùng đúng mật khẩu này (xem flagKnownDefaultPasswords() bên dưới), bất kể
// tài khoản đó được tạo từ seed hay admin tự đặt sau này trùng giá trị.
const KNOWN_DEFAULT_PASSWORDS = ['123456'];

async function seedDefaults() {
  const pool = await getPool();
  // PHẢI chạy TRƯỚC vòng lặp seed mặc định bên dưới — vòng lặp đó sẽ tự tạo row "vppExcludedJobTitles"
  // rỗng ([]) cho MỌI DB (kể cả DB đã tồn tại lâu năm, chưa từng có key này) ngay khi thấy key thiếu
  // trong DEFAULTS, khiến hàm này không còn phân biệt được "chưa từng tồn tại" (cần di trú dữ liệu cũ)
  // với "đã tồn tại nhưng rỗng" (admin xoá hết/chưa cấu hình gì thật) nếu chạy sau. Xem chi tiết ở
  // migrateVppExcludedJobTitles() bên dưới.
  await migrateVppExcludedJobTitles(pool);
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
  await migrateLegacyTasks();
  await migrateAllLegacyCollections();
  await migrateDefaultStorePermGroup();
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

// Seed 1 Nhóm Phân Quyền mặc định scope STORE ("Nhân Viên Siêu Thị") cho DB đã tồn tại từ trước — riêng
// bằng vòng lặp DEFAULTS[key] ở trên KHÔNG đủ, vì nó chỉ ghi khi key "permGroups" CHƯA TỪNG tồn tại
// trong AppData; DB thật đang chạy production gần như chắc chắn ĐÃ có row "permGroups" (kể cả khi giá
// trị đang là mảng rỗng []) nên thay đổi permGroups mặc định trong defaults.js không tự động chạm tới
// DB đó — cần migration idempotent riêng này để chạy đúng 1 lần trên mọi DB hiện có.
async function migrateDefaultStorePermGroup() {
  const groups = await getAppDataValue('permGroups');
  if (!Array.isArray(groups)) return;
  if (groups.some(g => g.scope === 'STORE')) return; // đã có rồi (kể cả do admin tự tạo/tag) -> không seed thêm
  const seeded = {
    id: 'grp_store_default',
    name: 'Nhân Viên Siêu Thị (Mặc Định)',
    description: 'Nhóm quyền mặc định cho tài khoản nhân viên siêu thị tạo qua sub-tab "Quản Lý Nhân Viên Siêu Thị" (Đồng Phục) — không có quyền đặc biệt nào, chỉ dùng để phân loại/gán mặc định.',
    perms: {},
    scope: 'STORE'
  };
  await setAppDataValue('permGroups', [...groups, seeded]);
  console.log('   ↳ Đã thêm Nhóm Phân Quyền mặc định "Nhân Viên Siêu Thị" (scope STORE).');
}

// Di trú "Nhóm Không Cấp Văn Phòng Phẩm" từ vppExcludeGroups[] (DẠNG CŨ — nhiều nhóm đặt tên tự do,
// mỗi nhóm mang 1 danh sách chức danh, user còn phải được gán thủ công vào từng nhóm) sang
// vppExcludedJobTitles[] (DẠNG MỚI — 1 mảng chuỗi phẳng, cùng khuôn workflowParticipatingDepts, xem
// isUserVppExcluded() ở index.html). CHỈ chạy đúng 1 lần trên mỗi DB: kiểm tra TRỰC TIẾP bằng SQL xem
// row "vppExcludedJobTitles" đã tồn tại trong dbo.AppData hay chưa (giống hệt cách vòng lặp DEFAULTS ở
// seedDefaults() kiểm tra) — PHẢI tự kiểm tra riêng thay vì dùng getAppDataValue()==null, vì hàm này
// bắt buộc phải chạy TRƯỚC vòng lặp đó (xem seedDefaults()) nên tại thời điểm gọi, row chắc chắn CHƯA
// được vòng lặp tạo). Nếu chưa từng tồn tại: gộp (union, khử trùng) toàn bộ jobTitles[] của MỌI nhóm
// trong vppExcludeGroups[] hiện có thành giá trị khởi tạo — không để mất cấu hình admin đã lưu trước
// đó dù DB hoàn toàn mới (vppExcludeGroups rỗng/chưa có) vẫn ra mảng rỗng, đúng ý "khởi tạo lần đầu".
// key "vppExcludeGroups" + field user.vppExcludeGroupIds vẫn giữ nguyên trong CSDL sau di trú này,
// không xoá — chỉ đơn giản không còn nơi nào trong code mới đọc/ghi tới 2 chỗ đó nữa.
async function migrateVppExcludedJobTitles(pool) {
  const existing = await pool.request()
    .input('k', sql.NVarChar(100), 'vppExcludedJobTitles')
    .query('SELECT 1 FROM dbo.AppData WHERE DataKey = @k');
  if (existing.recordset.length > 0) return; // đã di trú/seed rồi (kể cả admin đã lưu qua UI mới)

  const oldGroups = await getAppDataValue('vppExcludeGroups');
  const unioned = [...new Set(
    (Array.isArray(oldGroups) ? oldGroups : [])
      .flatMap(g => (Array.isArray(g?.jobTitles) ? g.jobTitles : []))
  )];
  await setAppDataValue('vppExcludedJobTitles', unioned);
  console.log(`   ↳ Di trú "Nhóm Không Cấp Văn Phòng Phẩm" (vppExcludeGroups -> vppExcludedJobTitles, ${unioned.length} chức danh).`);
}

module.exports = { seedDefaults };
