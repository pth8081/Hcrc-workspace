// seedDefaults.js — Ghi dữ liệu mặc định vào SQL Server nếu bảng AppData chưa có key tương ứng,
// và di trú mật khẩu người dùng còn ở dạng plaintext sang bcrypt (chạy mỗi lần khởi động, idempotent
// — không đổi gì nếu mật khẩu đã hash rồi).
const { getPool, sql } = require('./db');
const { DEFAULTS } = require('./defaults');
const { hashPassword, isBcryptHash, verifyPassword } = require('./lib/auth');
const { getAppDataValue, setAppDataValue } = require('./lib/appData');
const { migrateLegacySystemLogs } = require('./lib/systemLogStore');
const { migrateLegacyTasks } = require('./lib/taskStore');
const { migrateAllLegacyCollections, getAllRecords, withLockedRecordById } = require('./lib/recordStore');
const { assertSourceIdColumnIsBigInt } = require('./lib/operationWorkItemStore');
const { HttpError } = require('./lib/httpErrors');

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
  await migratePendingActualBudgetEntries();
  await migrateStuckOperationApprovalStatuses();
  await warnIfOperationWorkItemsSchemaOutdated(pool);
}

// Cảnh báo NGAY lúc khởi động (cùng khuôn DB_ENCRYPT/LOG_ENCRYPTION_KEY ở db.js) nếu cột
// dbo.OperationWorkItems.SourceId trên CSDL thật CHƯA được ALTER sang BIGINT theo migration đã có sẵn ở
// sql/schema.sql — xem giải thích đầy đủ ở assertSourceIdColumnIsBigInt() (lib/operationWorkItemStore.js).
// KHÔNG chặn khởi động (server vẫn chạy bình thường cho MỌI tính năng khác, chỉ riêng tạo/sửa công việc
// Thực hiện của Vận Hành > Siêu Thị sẽ tự chặn lại với đúng thông báo này) — giúp phát hiện NGAY qua log
// khi deploy, thay vì phải đợi 1 người dùng thật bấm "Lưu Công Việc" rồi mới lộ ra qua toast lỗi.
async function warnIfOperationWorkItemsSchemaOutdated(pool) {
  try {
    await assertSourceIdColumnIsBigInt(pool);
  } catch (err) {
    if (err instanceof HttpError) {
      console.error(`⛔ ${err.message}`);
      return;
    }
    throw err;
  }
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

// Ngân Sách "Thực Hiện" (entryKind==='ACTUAL') không còn qua bước phê duyệt Trưởng phòng nữa — chỉ
// "Ngân Sách Phê Duyệt" (PLAN) còn giữ (xem submitBudgetEntry() ở lib/recordActions.js). Di trú 1 LẦN
// cho các bản ACTUAL đã lỡ gửi TRƯỚC thay đổi này, đang kẹt ở PENDING chờ 1 phê duyệt sẽ KHÔNG BAO GIỜ
// tới nữa — chuyển thẳng sang APPROVED (cùng đích mà submitBudgetEntry() giờ đi thẳng tới), ghi 1 dòng
// lịch sử SYSTEM_MIGRATION để có dấu vết đây là chuyển tự động lúc khởi động, không phải ai đó bấm
// Duyệt. Idempotent — chạy mỗi lần khởi động, chỉ còn tác dụng khi thực sự có bản ACTUAL nào đang
// PENDING (sau lần chạy đầu tiên sẽ không còn bản nào để di trú nữa).
async function migratePendingActualBudgetEntries() {
  const entries = await getAllRecords('budgetEntries');
  const stuck = entries.filter(e => e.entryKind === 'ACTUAL' && e.status === 'PENDING');
  if (!stuck.length) return;
  for (const entry of stuck) {
    await withLockedRecordById('budgetEntries', entry.id, (item) => {
      if (item.entryKind !== 'ACTUAL' || item.status !== 'PENDING') return item; // đã đổi bởi request khác giữa lúc đọc và khoá
      item.history = item.history || [];
      item.history.push({
        step: 0, approver: 'Hệ Thống', username: 'system', action: 'SYSTEM_MIGRATION',
        comment: 'Ngân sách thực hiện không còn qua phê duyệt — tự động chuyển từ "Chờ duyệt" sang "Đã duyệt".',
        time: nowVNForMigration()
      });
      item.status = 'APPROVED';
      item.currentStep = 0;
      return item;
    });
  }
  console.log(`   ↳ Đã di trú ${stuck.length} bản Ngân Sách Thực Hiện (ACTUAL) còn kẹt ở PENDING sang APPROVED (bỏ phê duyệt cho ACTUAL).`);
}

// Vận Hành > Siêu Thị (operationStoreOpenings/operationRepairs) — "mỗi khi lập không cần phê duyệt"
// (Mục H) bỏ qua bước duyệt cho CẢ hồ sơ chính LẪN Danh mục đầu tư (estimateStatus) ngay lúc tạo/lưu,
// nhưng bản ghi đã LỠ gửi duyệt TRƯỚC khi Mục H tồn tại (còn kẹt ở PENDING chờ 1 phê duyệt sẽ KHÔNG BAO
// GIỜ tới nữa vì không còn ai/đường nào set PENDING mới) sẽ bị kẹt VĨNH VIỄN — hồ sơ chính kẹt PENDING
// khiến badge hiển thị sai "đang chờ duyệt" dù thực chất đã coi như xong; Danh mục đầu tư kẹt PENDING
// nghiêm trọng hơn: submitOperationEstimate() chỉ nhận lại từ DRAFT/APPROVED, resetOperationEstimateToDraft()
// chỉ nhận từ REJECTED — KHÔNG có đường thoát nào từ PENDING, tức không bao giờ lập được công việc Thực
// hiện (đây chính là gốc rễ "Danh mục cv trong thực hiện đang lỗi ko lập và tạo được" mà người dùng báo).
// Di trú 1 LẦN, chuyển thẳng sang APPROVED (đúng đích mà 2 hàm trên giờ đi tới), ghi SYSTEM_MIGRATION —
// cùng khuôn/lý do migratePendingActualBudgetEntries() ngay trên. Idempotent — chạy mỗi lần khởi động,
// chỉ còn tác dụng khi thực sự còn bản ghi PENDING (rất hiếm sau lần chạy đầu).
async function migrateStuckOperationApprovalStatuses() {
  for (const collection of ['operationStoreOpenings', 'operationRepairs']) {
    const records = await getAllRecords(collection);
    const stuck = records.filter(r => r.status === 'PENDING' || r.estimateStatus === 'PENDING');
    for (const rec of stuck) {
      await withLockedRecordById(collection, rec.id, (item) => {
        const note = { step: 0, approver: 'Hệ Thống', username: 'system', action: 'SYSTEM_MIGRATION',
          comment: 'Module Vận Hành > Siêu Thị không còn qua phê duyệt — tự động chuyển từ "Chờ duyệt" sang "Đã duyệt".',
          time: nowVNForMigration() };
        if (item.status === 'PENDING') {
          item.history = item.history || [];
          item.history.push(note);
          item.status = 'APPROVED';
          item.currentStep = 0;
        }
        if (item.estimateStatus === 'PENDING') {
          item.estimateHistory = item.estimateHistory || [];
          item.estimateHistory.push(note);
          item.estimateStatus = 'APPROVED';
          item.estimateCurrentStep = 0;
        }
        return item;
      });
    }
    if (stuck.length) {
      console.log(`   ↳ Đã di trú ${stuck.length} hồ sơ ${collection} còn kẹt ở PENDING (hồ sơ chính/danh mục đầu tư) sang APPROVED (bỏ phê duyệt Vận Hành > Siêu Thị).`);
    }
  }
}

// Cùng định dạng với nowVN() ở lib/recordActions.js (không export sẵn cho seedDefaults.js nên lặp lại
// nguyên văn 1 dòng, tránh phải require chéo module chỉ vì 1 hàm định dạng giờ).
function nowVNForMigration() {
  return new Date().toLocaleString('vi-VN');
}

module.exports = { seedDefaults };
