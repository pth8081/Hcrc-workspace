// lib/taskStore.js — Công việc (dbo.Tasks), mỗi Công việc = 1 row thật (Bước 6b), thay cho 1 dòng
// JSON duy nhất trong AppData. Trước đây MỌI thao tác (giao việc, nhận việc, cập nhật tiến độ, xin
// gia hạn, huỷ việc...) phải khoá + đọc/sửa/ghi lại NGUYÊN mảng "tasks" (withLockedAppDataValue) dù
// chỉ đổi ĐÚNG 1 công việc — 2 người dùng thao tác 2 công việc KHÁC NHAU cùng lúc vẫn tranh chấp khoá
// ở mức cả collection. Giờ khoá đúng 1 dòng (WITH UPDLOCK, HOLDLOCK WHERE Id=@id).
const { getPool, sql } = require('../db');
const { getAppDataValue } = require('./appData');
const { HttpError } = require('./httpErrors');

function toTask(row) {
  return JSON.parse(row.Payload);
}

function extractColumns(task) {
  return {
    status: task.status || 'TODO',
    assignedTo: task.assignedTo || null,
    assignedBy: task.assignedBy || null,
    sourceType: task.sourceType || null,
    sourceCode: task.sourceCode || null
  };
}

async function getAllTasks() {
  const pool = await getPool();
  const result = await pool.request().query('SELECT Payload FROM dbo.Tasks ORDER BY CreatedAt DESC, Id DESC');
  return result.recordset.map(toTask);
}

// Cache ngắn hạn TRONG BỘ NHỚ, chỉ dùng cho GET /api/data (routes/data.js) — cùng lý do/khuôn với
// getAppDataValueCached() (lib/appData.js): nhiều người dùng khác nhau gọi gần như cùng lúc đều cần
// y hệt danh sách Công việc RAW này trước khi lọc theo quyền xem riêng từng người (lib/recordViewScope.js
// filterTasksForUser, chạy SAU bước này) — an toàn dùng chung. CHỈ dùng biến này ở đây, KHÔNG dùng cho
// các route ghi/kiểm tra (routes/records.js...) — nơi đó cần dữ liệu mới nhất tuyệt đối.
const TASKS_CACHE_TTL_MS = parseInt(process.env.APPDATA_CACHE_TTL_MS || '3000', 10);
let tasksCache = null; // { value, expiresAt }

// PM2 cluster mode: mỗi tiến trình giữ 1 bản tasksCache TRONG BỘ NHỚ riêng — cùng lý do/khuôn đã vá cho
// lib/appData.js (xem giải thích đầy đủ ở đó): ghi ở tiến trình A chỉ tự xoá cache của CHÍNH tiến trình
// A, các tiến trình B/C/D... vẫn phục vụ danh sách Công việc cũ tới hết TTL. Dùng lại đúng kênh IPC
// process:msg có sẵn của PM2 để phát tín hiệu xoá cache ngay khi có 1 tiến trình ghi.
const TASKS_CACHE_INVALIDATE_CHANNEL = 'tasksCacheInvalidate';

if (typeof process.on === 'function') {
  process.on('message', (packet) => {
    if (packet && packet.type === 'process:msg' && packet.data && packet.data.channel === TASKS_CACHE_INVALIDATE_CHANNEL) {
      tasksCache = null;
    }
  });
}

function invalidateTasksCache() {
  tasksCache = null;
  if (typeof process.send === 'function') {
    try {
      process.send({ type: 'process:msg', data: { channel: TASKS_CACHE_INVALIDATE_CHANNEL } });
    } catch (err) {
      console.error('⛔ Không phát được tín hiệu xoá tasksCache liên tiến trình:', err.message);
    }
  }
}

async function getAllTasksCached() {
  if (tasksCache && tasksCache.expiresAt > Date.now()) return tasksCache.value;
  const value = await getAllTasks();
  tasksCache = { value, expiresAt: Date.now() + TASKS_CACHE_TTL_MS };
  return value;
}

// Chèn 1 Công việc MỚI — id đã được lib/recordActions.js sinh sẵn (Date.now()[+offset]), không phải
// IDENTITY của bảng. Dùng cho cả tạo thủ công (createTask) lẫn tự động sinh từ chỉ đạo biên bản họp/
// tờ trình (buildTasksFromDirectives/buildTaskFromSubmissionComment) — record đã được validate/build
// đầy đủ ở lib/recordActions.js trước khi gọi hàm này, ở đây chỉ lo việc lưu trữ.
//
// dbo.Tasks.Id là PRIMARY KEY đơn (không có cột nào khác để lẫn lộn như dbo.Records với Code) — Id =
// Date.now() (đôi khi +i/+i+1 khi 1 lượt thao tác sinh nhiều Công việc cùng lúc, xem lib/recordActions.js)
// CHỈ đúng khi không có 2 Công việc nào của TOÀN HỆ THỐNG được tạo trùng đúng mili-giây. Dưới tải cao
// (nhiều người giao việc gần như cùng lúc, hoặc 1 chỉ đạo sinh nhiều Công việc trong 1 request) trước
// đây việc này ném thẳng lỗi SQL thô (không try/catch) lên tận route — người dùng thấy lỗi 500 khó hiểu
// dù thao tác của họ hoàn toàn hợp lệ. Tự sinh lại Id khác rồi thử lại ngay, không cần người dùng biết.
const INSERT_TASK_MAX_ATTEMPTS = 5;
async function insertTask(task) {
  const pool = await getPool();
  for (let attempt = 1; attempt <= INSERT_TASK_MAX_ATTEMPTS; attempt++) {
    const cols = extractColumns(task);
    try {
      await pool.request()
        .input('id', sql.BigInt, task.id)
        .input('status', sql.NVarChar(20), cols.status)
        .input('assignedTo', sql.NVarChar(100), cols.assignedTo)
        .input('assignedBy', sql.NVarChar(100), cols.assignedBy)
        .input('sourceType', sql.NVarChar(30), cols.sourceType)
        .input('sourceCode', sql.NVarChar(100), cols.sourceCode)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(task))
        .query(`
          INSERT INTO dbo.Tasks (Id, Status, AssignedTo, AssignedBy, SourceType, SourceCode, Payload)
          VALUES (@id, @status, @assignedTo, @assignedBy, @sourceType, @sourceCode, @payload);
        `);
      invalidateTasksCache();
      return task;
    } catch (err) {
      const isIdCollision = err && (err.number === 2601 || err.number === 2627);
      if (!isIdCollision || attempt === INSERT_TASK_MAX_ATTEMPTS) {
        if (isIdCollision) throw new HttpError(409, 'Hệ thống đang bận, vui lòng thử tạo lại.');
        throw err;
      }
      task.id = Date.now() + Math.floor(Math.random() * 1000);
    }
  }
}

// Đọc-khoá-sửa-ghi ĐÚNG 1 Công việc theo id, trong 1 giao dịch có khoá dòng (khớp đúng
// lib/appData.js withLockedAppDataValue(), nhưng ở mức 1 dòng thay vì cả collection). mutatorFn nhận
// object Công việc hiện tại, trả object đã sửa (hoặc throw HttpError để huỷ giao dịch, không ghi gì).
// Ném sẵn 404 nếu không tìm thấy — mọi route gọi hàm này không cần tự kiểm tra tồn tại nữa.
async function withLockedTaskById(id, mutatorFn) {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const readReq = new sql.Request(tx);
    const readResult = await readReq
      .input('id', sql.BigInt, id)
      .query('SELECT Payload FROM dbo.Tasks WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id');
    if (readResult.recordset.length === 0) {
      throw new HttpError(404, 'Không tìm thấy công việc');
    }
    const task = toTask(readResult.recordset[0]);

    const updated = await mutatorFn(task);

    const cols = extractColumns(updated);
    const writeReq = new sql.Request(tx);
    await writeReq
      .input('id', sql.BigInt, id)
      .input('status', sql.NVarChar(20), cols.status)
      .input('assignedTo', sql.NVarChar(100), cols.assignedTo)
      .input('assignedBy', sql.NVarChar(100), cols.assignedBy)
      .input('sourceType', sql.NVarChar(30), cols.sourceType)
      .input('sourceCode', sql.NVarChar(100), cols.sourceCode)
      .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(updated))
      .query(`
        UPDATE dbo.Tasks
        SET Status = @status, AssignedTo = @assignedTo, AssignedBy = @assignedBy,
            SourceType = @sourceType, SourceCode = @sourceCode, Payload = @payload
        WHERE Id = @id
      `);

    await tx.commit();
    invalidateTasksCache();
    return updated;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// Kiểm tra tồn tại (404 nếu không) rồi mới gọi permissionCheckFn (throw nếu không đủ quyền) — khớp
// đúng thứ tự kiểm tra cũ ở routes/records.js (tìm bản ghi trước, xác minh quyền sau). Không cần giao
// dịch/khoá: xoá là thao tác nguyên tử, 2 yêu cầu xoá cùng lúc chỉ 1 cái thành công, cái sau ảnh
// hưởng 0 dòng — vô hại, không phải race condition cần khoá tránh.
async function deleteTaskById(id, permissionCheckFn) {
  const pool = await getPool();
  const existing = await pool.request().input('id', sql.BigInt, id).query('SELECT 1 FROM dbo.Tasks WHERE Id = @id');
  if (existing.recordset.length === 0) throw new HttpError(404, 'Không tìm thấy công việc');

  permissionCheckFn();

  await pool.request().input('id', sql.BigInt, id).query('DELETE FROM dbo.Tasks WHERE Id = @id');
  invalidateTasksCache();
}

// Di chuyển dữ liệu cũ (nếu còn) từ AppData.tasks sang bảng Tasks — CHỈ chạy nếu bảng mới đang RỖNG
// (idempotent, khớp đúng lib/systemLogStore.js migrateLegacySystemLogs()). Giữ nguyên id/thứ tự cũ:
// AppData.tasks giữ mới-nhất-trước (do unshift() khi tạo) — chèn từ cuối mảng lên đầu để CreatedAt
// tăng dần đúng theo thứ tự tạo thật, ORDER BY CreatedAt DESC khi đọc lại cho đúng mới-nhất-trước.
async function migrateLegacyTasks() {
  const pool = await getPool();
  const countResult = await pool.request().query('SELECT COUNT(*) AS c FROM dbo.Tasks');
  if (countResult.recordset[0].c > 0) return;

  const legacy = await getAppDataValue('tasks');
  if (!Array.isArray(legacy) || legacy.length === 0) return;

  for (let i = legacy.length - 1; i >= 0; i--) {
    await insertTask(legacy[i]);
  }
  await pool.request().query(`DELETE FROM dbo.AppData WHERE DataKey = 'tasks'`);
  console.log(`   ↳ Đã di chuyển ${legacy.length} công việc cũ sang bảng Tasks.`);
}

// Tìm 1 Công việc theo sourceType/sourceCode/sourceDirectiveId (không phải id thật của Task) — dùng để
// đồng bộ lại Task.sourceDirectiveId khi Biên Bản Họp bù id ổn định lần đầu cho 1 dòng chỉ đạo ĐANG có
// Task tham chiếu theo vị trí cũ (xem migrateDirectiveTaskLinks() bên dưới + editMinutes() ở
// lib/recordActions.js). Lọc trước bằng 2 cột đã đánh index (SourceType/SourceCode) rồi so
// sourceDirectiveId ở tầng ứng dụng — số Công việc của riêng 1 biên bản luôn rất ít.
async function findTaskBySource(sourceType, sourceCode, sourceDirectiveId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('sourceType', sql.NVarChar(30), sourceType)
    .input('sourceCode', sql.NVarChar(100), sourceCode)
    .query('SELECT Payload FROM dbo.Tasks WHERE SourceType = @sourceType AND SourceCode = @sourceCode');
  const tasks = result.recordset.map(toTask);
  return tasks.find(t => t.sourceDirectiveId === sourceDirectiveId) || null;
}

// Viết lại Task.sourceDirectiveId sang id mới NGAY sau khi Biên Bản Họp bù id ổn định lần đầu cho 1
// dòng chỉ đạo cũ (biên bản tạo trước tính năng này) — không migrate thì "Xem chi tiết" (index.html, tra
// theo d.id nếu có, else vị trí) mất liên kết vĩnh viễn ngay từ lần sửa đó. Không tìm thấy Task (đã bị
// xoá riêng) thì bỏ qua, không có gì để đồng bộ lại.
async function migrateDirectiveTaskLinks(minutesCode, migrations) {
  for (const { oldSourceDirectiveId, newSourceDirectiveId } of migrations || []) {
    const task = await findTaskBySource('MEETING_MINUTES', minutesCode, oldSourceDirectiveId);
    if (!task) continue;
    await withLockedTaskById(task.id, (t) => ({ ...t, sourceDirectiveId: newSourceDirectiveId }));
  }
}

module.exports = {
  getAllTasks, getAllTasksCached, insertTask, withLockedTaskById, deleteTaskById, migrateLegacyTasks,
  findTaskBySource, migrateDirectiveTaskLinks
};
