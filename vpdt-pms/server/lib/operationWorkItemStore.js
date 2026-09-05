// lib/operationWorkItemStore.js — Cây công việc "Thực hiện" của Vận Hành (Mở Mới/Sửa Chữa Siêu Thị),
// dbo.OperationWorkItems, mỗi node = 1 dòng thật (mô phỏng đúng khuôn lib/taskStore.js cho dbo.Tasks,
// xem giải thích đầy đủ ở sql/schema.sql). KHÔNG dùng chung với module Công Việc công ty (dbo.Tasks) —
// cây ở đây có ParentWorkItemId (đa cấp thật) + bộ trạng thái riêng có bước "Nghiệm thu", trong khi
// Task công ty chỉ hỗ trợ subtask phẳng 1 cấp gắn với semantics khác hẳn.
const { getPool, sql } = require('../db');
const { HttpError } = require('./httpErrors');

function toWorkItem(row) {
  return JSON.parse(row.Payload);
}

function extractColumns(item) {
  return {
    status: item.status || 'CHUA_BAT_DAU',
    parentWorkItemId: item.parentWorkItemId ?? null,
    sourceType: item.sourceType,
    sourceId: item.sourceId
  };
}

// Cache ngắn hạn TRONG BỘ NHỚ cho GET /api/data — cùng lý do/khuôn getAllTasksCached() (lib/taskStore.js):
// nhiều người dùng khác nhau gọi gần như cùng lúc đều cần y hệt danh sách work item RAW này trước khi
// lọc theo quyền xem. CHỈ dùng ở route đọc, KHÔNG dùng cho route ghi/kiểm tra (cần dữ liệu mới nhất).
const WORK_ITEMS_CACHE_TTL_MS = parseInt(process.env.APPDATA_CACHE_TTL_MS || '3000', 10);
let workItemsCache = null; // { value, expiresAt }

function invalidateWorkItemsCache() {
  workItemsCache = null;
}

async function getAllWorkItems() {
  const pool = await getPool();
  const result = await pool.request().query('SELECT Payload FROM dbo.OperationWorkItems ORDER BY CreatedAt ASC, Id ASC');
  return result.recordset.map(toWorkItem);
}

async function getAllWorkItemsCached() {
  if (workItemsCache && workItemsCache.expiresAt > Date.now()) return workItemsCache.value;
  const value = await getAllWorkItems();
  workItemsCache = { value, expiresAt: Date.now() + WORK_ITEMS_CACHE_TTL_MS };
  return value;
}

async function getWorkItemsBySource(sourceType, sourceId) {
  const pool = await getPool();
  const result = await pool.request()
    .input('sourceType', sql.NVarChar(30), sourceType)
    .input('sourceId', sql.BigInt, sourceId)
    .query('SELECT Payload FROM dbo.OperationWorkItems WHERE SourceType = @sourceType AND SourceId = @sourceId ORDER BY CreatedAt ASC, Id ASC');
  return result.recordset.map(toWorkItem);
}

// BÀI HỌC TỪ 1 BUG THẬT ĐÃ GẶP (xem sql/schema.sql, khối ALTER COLUMN ngay trên CREATE TABLE
// dbo.OperationWorkItems): cột SourceId BAN ĐẦU tạo kiểu INT (tối đa ~2.1 tỷ) trong khi giá trị luôn là
// id kiểu Date.now() (~1.7 nghìn tỷ ở thời điểm hiện tại — VƯỢT TRẦN INT ngay lập tức) — khiến MỌI lần
// tạo/sửa công việc Thực hiện chắc chắn lỗi trên SQL Server thật. schema.sql ĐÃ có sẵn migration ALTER
// COLUMN tự chạy an toàn nhiều lần, NHƯNG đó là script CHẠY TAY (quản trị viên phải tự chạy lại mỗi khi
// schema.sql đổi, xem CLAUDE.md/HUONG_DAN_DEPLOY_UBUNTU.md) — nếu quên chạy lại sau 1 lần cập nhật code,
// cột SourceId trên CSDL thật vẫn còn INT dù code đã đúng từ lâu, và lỗi SQL Server THÔ (không phải
// HttpError) lọt qua handleError() ở routes/records.js thành toast chung chung "Không thể xử lý yêu cầu"
// — không ai biết đường sửa (đây CHÍNH XÁC là triệu chứng người dùng báo "không tạo được công việc Thực
// hiện", dù mọi validate nghiệp vụ ở lib/recordActions.js createOperationWorkItem() đều đã đúng).
// Hàm này CHỦ ĐỘNG dò kiểu cột thật trước khi ghi — KHÔNG tự ALTER ở đây (DDL luôn đi qua schema.sql,
// không qua code chạy lúc runtime, tránh cần cấp quyền ALTER cho tài khoản ứng dụng) — để chặn SỚM bằng
// 1 lỗi RÕ RÀNG, dễ hiểu, thay vì để lỗi SQL Server thô lọt ra ngoài. Cache kết quả OK vĩnh viễn trong
// tiến trình (schema không đổi khi server đang chạy, đọc lại mỗi lần tốn 1 query nhỏ không cần thiết);
// KHÔNG cache khi CHƯA đúng — tự dò lại ở lần gọi kế tiếp để tự nhận ra ngay khi quản trị vừa chạy xong
// schema.sql mà không cần khởi động lại server.
let sourceIdColumnConfirmedBigInt = false;
async function assertSourceIdColumnIsBigInt(pool) {
  if (sourceIdColumnConfirmedBigInt) return;
  const result = await pool.request().query(`
    SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'OperationWorkItems' AND COLUMN_NAME = 'SourceId'
  `);
  const dataType = result.recordset[0]?.DATA_TYPE;
  if (dataType && dataType !== 'bigint') {
    throw new HttpError(500,
      `Cấu trúc CSDL chưa được cập nhật: cột dbo.OperationWorkItems.SourceId vẫn là kiểu "${dataType}" ` +
      '(cần "bigint" để chứa id dạng Date.now()). Vui lòng nhờ quản trị hệ thống chạy lại server/sql/schema.sql ' +
      'trên SQL Server (script tự ALTER an toàn, không mất dữ liệu — xem mục 12 HUONG_DAN_DEPLOY_UBUNTU.md), ' +
      'sau đó thử tạo lại công việc này.');
  }
  sourceIdColumnConfirmedBigInt = true;
}

// Id sinh theo đúng quy ước Date.now()[+offset] đã dùng cho Task/Record — không phải IDENTITY. Va chạm
// dưới tải cao được tự retry (cùng cơ chế đã vá cho insertTask/insertRecord ở Giai đoạn 2 audit).
const INSERT_WORK_ITEM_MAX_ATTEMPTS = 5;
async function insertWorkItem(item) {
  const pool = await getPool();
  await assertSourceIdColumnIsBigInt(pool);
  for (let attempt = 1; attempt <= INSERT_WORK_ITEM_MAX_ATTEMPTS; attempt++) {
    const cols = extractColumns(item);
    try {
      await pool.request()
        .input('id', sql.BigInt, item.id)
        .input('status', sql.NVarChar(20), cols.status)
        .input('parentWorkItemId', sql.BigInt, cols.parentWorkItemId)
        .input('sourceType', sql.NVarChar(30), cols.sourceType)
        .input('sourceId', sql.BigInt, cols.sourceId)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(item))
        .query(`
          INSERT INTO dbo.OperationWorkItems (Id, Status, ParentWorkItemId, SourceType, SourceId, Payload)
          VALUES (@id, @status, @parentWorkItemId, @sourceType, @sourceId, @payload);
        `);
      invalidateWorkItemsCache();
      return item;
    } catch (err) {
      const isIdCollision = err && (err.number === 2601 || err.number === 2627);
      if (!isIdCollision || attempt === INSERT_WORK_ITEM_MAX_ATTEMPTS) {
        if (isIdCollision) throw new HttpError(409, 'Hệ thống đang bận, vui lòng thử tạo lại.');
        throw err;
      }
      item.id = Date.now() + Math.floor(Math.random() * 1000);
    }
  }
}

// Đọc-khoá-sửa-ghi ĐÚNG 1 work item theo id, trong 1 giao dịch có khoá dòng — cùng khuôn
// withLockedTaskById() (lib/taskStore.js). Ném sẵn 404 nếu không tìm thấy.
async function withLockedWorkItemById(id, mutatorFn) {
  const pool = await getPool();
  await assertSourceIdColumnIsBigInt(pool);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const readReq = new sql.Request(tx);
    const readResult = await readReq
      .input('id', sql.BigInt, id)
      .query('SELECT Payload FROM dbo.OperationWorkItems WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id');
    if (readResult.recordset.length === 0) {
      throw new HttpError(404, 'Không tìm thấy công việc');
    }
    const item = toWorkItem(readResult.recordset[0]);

    const updated = await mutatorFn(item);

    const cols = extractColumns(updated);
    const writeReq = new sql.Request(tx);
    await writeReq
      .input('id', sql.BigInt, id)
      .input('status', sql.NVarChar(20), cols.status)
      .input('parentWorkItemId', sql.BigInt, cols.parentWorkItemId)
      .input('sourceType', sql.NVarChar(30), cols.sourceType)
      .input('sourceId', sql.BigInt, cols.sourceId)
      .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(updated))
      .query(`
        UPDATE dbo.OperationWorkItems
        SET Status = @status, ParentWorkItemId = @parentWorkItemId, SourceType = @sourceType,
            SourceId = @sourceId, Payload = @payload
        WHERE Id = @id
      `);

    await tx.commit();
    invalidateWorkItemsCache();
    return updated;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// Xoá 1 work item — KHÔNG cascade ở đây (cascade cả cây con là quyết định nghiệp vụ, xử lý ở
// lib/recordActions.js deleteOperationWorkItem() nơi có đủ ngữ cảnh quyền/toàn bộ cây).
async function deleteWorkItemById(id) {
  const pool = await getPool();
  await pool.request().input('id', sql.BigInt, id).query('DELETE FROM dbo.OperationWorkItems WHERE Id = @id');
  invalidateWorkItemsCache();
}

// Xoá NHIỀU work item (1 nhánh cây gồm toàn bộ con cháu, hoặc cả cây khi cascade theo hồ sơ nguồn bị
// xoá) trong ĐÚNG 1 câu DELETE...WHERE Id IN (...) thay vì vòng lặp nhiều câu DELETE riêng lẻ — audit
// Đợt 5 Giai đoạn 3 phát hiện vòng lặp cũ không bọc transaction: nếu tiến trình crash/khởi động lại
// giữa vòng lặp, một số node bị xoá còn một số node con vẫn còn (ParentWorkItemId trỏ vào bản ghi vừa
// bị xoá) — cây bị đứt gãy vĩnh viễn. 1 câu SQL DUY NHẤT tự nó đã atomic (SQL Server áp dụng ngầm cho
// từng statement, không cần BEGIN/COMMIT tường minh) nên không còn trạng thái "xoá dở dang".
async function deleteWorkItemsByIds(ids) {
  const list = Array.from(new Set((ids || []).map(Number).filter(Number.isFinite)));
  if (!list.length) return;
  const pool = await getPool();
  const request = pool.request();
  const params = list.map((id, i) => {
    const p = `id${i}`;
    request.input(p, sql.BigInt, id);
    return `@${p}`;
  });
  await request.query(`DELETE FROM dbo.OperationWorkItems WHERE Id IN (${params.join(',')})`);
  invalidateWorkItemsCache();
}

module.exports = {
  getAllWorkItems, getAllWorkItemsCached, getWorkItemsBySource,
  insertWorkItem, withLockedWorkItemById, deleteWorkItemById, deleteWorkItemsByIds, invalidateWorkItemsCache,
  // Export riêng cho seedDefaults.js gọi 1 LẦN lúc khởi động — in cảnh báo RÕ RÀNG ra console ngay khi
  // server bật lên (cùng khuôn cảnh báo DB_ENCRYPT/LOG_ENCRYPTION_KEY ở db.js) thay vì phải đợi 1 người
  // dùng thật bấm "Lưu Công Việc" rồi mới lộ ra qua toast lỗi.
  assertSourceIdColumnIsBigInt
};
