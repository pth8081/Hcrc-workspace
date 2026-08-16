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

// Chèn 1 Công việc MỚI — id đã được lib/recordActions.js sinh sẵn (Date.now()[+offset]), không phải
// IDENTITY của bảng. Dùng cho cả tạo thủ công (createTask) lẫn tự động sinh từ chỉ đạo biên bản họp/
// tờ trình (buildTasksFromDirectives/buildTaskFromSubmissionComment) — record đã được validate/build
// đầy đủ ở lib/recordActions.js trước khi gọi hàm này, ở đây chỉ lo việc lưu trữ.
async function insertTask(task) {
  const pool = await getPool();
  const cols = extractColumns(task);
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
  return task;
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

module.exports = { getAllTasks, insertTask, withLockedTaskById, deleteTaskById, migrateLegacyTasks };
