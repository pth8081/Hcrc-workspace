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
const { parseVNDateTime } = require('./lib/recordActions');

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
  await migrateApprovedOperationOrdersToAwaitingReceipt();
  await migrateOperationOrdersDefaultLocationType();
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

    // Hồ sơ CHÍNH (status, KHÔNG phải estimateStatus) còn kẹt ở DRAFT — nghỉ tại đây CHỈ có thể là do 1
    // phê duyệt viên đã bấm "Yêu Cầu Bổ Sung" (REQUEST_CHANGES) TRƯỚC khi Mục H tồn tại (b89d46e ngày
    // 2026-09-01 tới 60c473b ngày 2026-09-04 — 2 loại hồ sơ này mới có, đi qua đúng 3 ngày pipeline duyệt
    // đầy đủ trước khi Mục H bỏ hẳn phê duyệt). Từ Mục H, KHÔNG còn đường nào tạo mới trạng thái DRAFT
    // cho 2 collection này nữa (createValidation.js đặt thẳng APPROVED ngay lúc tạo) — nhưng bản ghi CŨ
    // lỡ kẹt ở đây thì cũng KHÔNG còn đường thoát nào khác ngoài chính cơ chế "Sửa & Gửi Lại Bổ Sung"
    // (editOperationStoreOpeningDraft/submitOperationStoreOpeningDraft/...) mà bản thân nó sắp bị xoá vì
    // hết còn ai dùng tới — nên phải quét dọn TẠI ĐÂY, cùng lúc với PENDING ở trên, để đảm bảo an toàn dữ
    // liệu TRƯỚC khi xoá cơ chế Bổ Sung. Coi như 1 dạng "Yêu cầu bổ sung" cũng đã hết hiệu lực — chuyển
    // thẳng sang APPROVED giống hệt PENDING ở trên (đúng tinh thần "không ai/không còn phê duyệt module
    // này nữa" — dù trước đó có ai yêu cầu sửa gì thì giờ cũng coi như xong).
    // KHÔNG đụng estimateStatus==='DRAFT' — đó là trạng thái ĐẦU vào hợp lệ, ĐANG DÙNG bình thường cho
    // giai đoạn "Danh mục đầu tư" (xem submitOperationEstimate() ở lib/recordActions.js, chấp nhận cả
    // DRAFT lẫn APPROVED để lưu — không phải trạng thái kẹt cần di trú).
    const stuckDraft = records.filter(r => r.status === 'DRAFT');
    for (const rec of stuckDraft) {
      await withLockedRecordById(collection, rec.id, (item) => {
        if (item.status !== 'DRAFT') return item; // đã đổi bởi request khác giữa lúc đọc và khoá
        item.history = item.history || [];
        item.history.push({ step: 0, approver: 'Hệ Thống', username: 'system', action: 'SYSTEM_MIGRATION',
          comment: 'Module Vận Hành > Siêu Thị không còn qua phê duyệt — tự động chuyển từ "Yêu cầu bổ sung" (DRAFT, còn sót từ trước Mục H) sang "Đã duyệt".',
          time: nowVNForMigration() });
        item.status = 'APPROVED';
        item.currentStep = 0;
        return item;
      });
    }
    if (stuckDraft.length) {
      console.log(`   ↳ Đã di trú ${stuckDraft.length} hồ sơ ${collection} còn kẹt ở DRAFT (Yêu cầu bổ sung, còn sót từ trước Mục H) sang APPROVED (bỏ phê duyệt Vận Hành > Siêu Thị).`);
    }
  }
}

// operationOrders (đợt "Báo Cáo + Nhập Hàng") — applyWorkflowAction() (lib/workflowEngine.js) từ nay tự
// chuyển hồ sơ sang AWAITING_RECEIPT ("Chờ nhập hàng") ngay khi duyệt xong bước cuối, thay vì dừng ở
// APPROVED như trước — nhưng hồ sơ đã ở APPROVED TỪ TRƯỚC đợt này (duyệt xong trước khi tính năng "Nhập
// Hàng"/"Hủy Nhập" tồn tại) sẽ kẹt VĨNH VIỄN ở APPROVED nếu không di trú: 2 nút Nhập Hàng/Hủy Nhập MỚI
// (module-vanhanh.js) chỉ hiện khi status === 'AWAITING_RECEIPT', và Báo Cáo (renderOperationOrderReport())
// đếm "đã phê duyệt" theo nhóm AWAITING_RECEIPT/RECEIVED/RECEIPT_CANCELLED — hồ sơ kẹt APPROVED sẽ vừa
// không thao tác được gì tiếp, vừa lọt khỏi mọi ô đếm báo cáo mới. Coi như đã hoàn tất bước duyệt phòng
// ban, chỉ còn thiếu bước xác nhận nhập hàng MỚI thêm, nên chuyển thẳng sang AWAITING_RECEIPT (KHÔNG
// phải RECEIVED — không có căn cứ để tự suy đoán hàng đã thực nhận hay chưa, để người phụ trách tự xác
// nhận qua đúng luồng mới). approvedAt lấy lại từ dòng lịch sử APPROVED cuối cùng nếu parse được (khớp
// đúng thời điểm duyệt thật, không lệch báo cáo "theo tháng"); không parse được (hồ sơ rất cũ/lỗi định
// dạng hiếm gặp) thì dùng thời điểm chạy di trú làm giá trị tạm — chỉ ảnh hưởng nhóm tháng hiển thị ở
// Báo Cáo, không ảnh hưởng gì khác. Cùng khuôn/idempotent với migrateStuckOperationApprovalStatuses() ở
// trên — chạy mỗi lần khởi động, chỉ còn tác dụng khi thực sự còn bản ghi APPROVED (rất hiếm sau lần
// chạy đầu, vì mọi lượt duyệt MỚI từ giờ đã tự đi thẳng AWAITING_RECEIPT).
async function migrateApprovedOperationOrdersToAwaitingReceipt() {
  const records = await getAllRecords('operationOrders');
  const stuck = records.filter(r => r.status === 'APPROVED');
  for (const rec of stuck) {
    await withLockedRecordById('operationOrders', rec.id, (item) => {
      if (item.status !== 'APPROVED') return item; // đã đổi bởi request khác giữa lúc đọc và khoá
      const lastApproved = [...(item.history || [])].reverse().find(h => h.action === 'APPROVED');
      const parsed = lastApproved ? parseVNDateTime(lastApproved.time) : null;
      item.approvedAt = parsed ? parsed.toISOString() : new Date().toISOString();
      item.status = 'AWAITING_RECEIPT';
      item.history = item.history || [];
      item.history.push({
        step: item.currentStep || 0, approver: 'Hệ Thống', username: 'system', action: 'SYSTEM_MIGRATION',
        comment: 'Đơn hàng đã phê duyệt trước khi hệ thống có bước "Chờ nhập hàng" — tự động chuyển sang chờ xác nhận nhập hàng.',
        time: nowVNForMigration()
      });
      return item;
    });
  }
  if (stuck.length) {
    console.log(`   ↳ Đã di trú ${stuck.length} đơn hàng (operationOrders) đã duyệt trước đợt "Nhập Hàng" sang chờ nhập hàng (AWAITING_RECEIPT).`);
  }
}

// operationOrders (đợt "Tách Đơn Hàng Siêu Thị/HO") — item.orderLocationType (STORE/HO) là field MỚI,
// quyết định quy trình duyệt nào áp dụng (2 quy trình TÁCH RIÊNG theo mức giá trị, xem
// resolveOperationOrderWorkflow() ở lib/workflowEngine.js). Hồ sơ TẠO TRƯỚC đợt tách này không có field
// -> phải gán 1 giá trị mặc định để resolveWfConfig() luôn tra được đúng 1 trong 2 map (không rơi vào
// nhánh "chưa xác định" nào). Chọn 'HO' làm mặc định (không phải 'STORE'): hồ sơ CŨ không có căn cứ nào
// để suy luận NGƯỢC lại chúng thuộc "Đặt Hàng Tại Siêu Thị" hay "Tại HO" (receivingLocationName là
// free-text đọc từ PDF NCC, không đối chiếu được danh mục siêu thị — xem
// populateOperationOrderLocationOptions() ở module-vanhanh.js) — 'HO' là lựa chọn AN TOÀN hơn vì HO chỉ
// có 2 mức (LT100M/GTE100M, rộng hơn 3 mức của Siêu Thị), tránh vô tình rơi vào mức thấp nhất "< 10
// triệu" (chỉ có ở Siêu Thị) của 1 đơn có thể giá trị lớn mà chưa admin nào cấu hình người duyệt. Idempotent
// (chỉ gán cho bản ghi CHƯA có field hợp lệ) — cùng khuôn/lý do migrateApprovedOperationOrdersToAwaitingReceipt()
// ở trên, chạy mỗi lần khởi động, chỉ còn tác dụng khi thực sự còn bản ghi thiếu field (rất hiếm sau lần
// chạy đầu, vì mọi đơn MỚI từ giờ luôn có orderLocationType do createValidation.js bắt buộc).
async function migrateOperationOrdersDefaultLocationType() {
  const records = await getAllRecords('operationOrders');
  const missing = records.filter(r => r.orderLocationType !== 'STORE' && r.orderLocationType !== 'HO');
  for (const rec of missing) {
    await withLockedRecordById('operationOrders', rec.id, (item) => {
      if (item.orderLocationType === 'STORE' || item.orderLocationType === 'HO') return item; // đã đổi bởi request khác giữa lúc đọc và khoá
      item.orderLocationType = 'HO';
      return item;
    });
  }
  if (missing.length) {
    console.log(`   ↳ Đã gán mặc định orderLocationType="HO" cho ${missing.length} đơn hàng (operationOrders) tạo trước đợt "Tách Đơn Hàng Siêu Thị/HO".`);
  }
}

// Cùng định dạng với nowVN() ở lib/recordActions.js (không export sẵn cho seedDefaults.js nên lặp lại
// nguyên văn 1 dòng, tránh phải require chéo module chỉ vì 1 hàm định dạng giờ).
function nowVNForMigration() {
  return new Date().toLocaleString('vi-VN');
}

// migrateStuckOperationApprovalStatuses export riêng THÊM vào cho
// tests/test-operation-danhmuc-dautu-units.js (gọi trực tiếp hàm này với lib/recordStore.js đã mock qua
// require.cache, không cần SQL Server thật) — xác nhận đúng hành vi "quét sạch bản ghi DRAFT/PENDING
// còn sót từ trước Mục H mỗi lúc khởi động". migrateOperationOrdersDefaultLocationType export thêm cho
// bộ test hồi quy MỚI của đợt "Tách Đơn Hàng Siêu Thị/HO" (cùng lý do, cùng khuôn mock recordStore).
module.exports = {
  seedDefaults, migrateStuckOperationApprovalStatuses, migrateApprovedOperationOrdersToAwaitingReceipt,
  migrateOperationOrdersDefaultLocationType
};
