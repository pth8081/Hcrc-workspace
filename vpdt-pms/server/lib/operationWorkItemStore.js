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
    .input('sourceId', sql.Int, sourceId)
    .query('SELECT Payload FROM dbo.OperationWorkItems WHERE SourceType = @sourceType AND SourceId = @sourceId ORDER BY CreatedAt ASC, Id ASC');
  return result.recordset.map(toWorkItem);
}

// Id sinh theo đúng quy ước Date.now()[+offset] đã dùng cho Task/Record — không phải IDENTITY. Va chạm
// dưới tải cao được tự retry (cùng cơ chế đã vá cho insertTask/insertRecord ở Giai đoạn 2 audit).
const INSERT_WORK_ITEM_MAX_ATTEMPTS = 5;
async function insertWorkItem(item) {
  const pool = await getPool();
  for (let attempt = 1; attempt <= INSERT_WORK_ITEM_MAX_ATTEMPTS; attempt++) {
    const cols = extractColumns(item);
    try {
      await pool.request()
        .input('id', sql.BigInt, item.id)
        .input('status', sql.NVarChar(20), cols.status)
        .input('parentWorkItemId', sql.BigInt, cols.parentWorkItemId)
        .input('sourceType', sql.NVarChar(30), cols.sourceType)
        .input('sourceId', sql.Int, cols.sourceId)
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
      .input('sourceId', sql.Int, cols.sourceId)
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

module.exports = {
  getAllWorkItems, getAllWorkItemsCached, getWorkItemsBySource,
  insertWorkItem, withLockedWorkItemById, deleteWorkItemById, invalidateWorkItemsCache
};
