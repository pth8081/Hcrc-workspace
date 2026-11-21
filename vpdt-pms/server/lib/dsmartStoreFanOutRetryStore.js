// lib/dsmartStoreFanOutRetryStore.js — đọc/ghi dbo.DsmartStoreFanOutRetryQueue (hàng đợi tự động thử lại
// fan-out xuống TỪNG siêu thị khi lỗi mạng lúc Áp Giá Mới/Sửa/Xoá, 12/2026 — theo yêu cầu người dùng: "có
// bao giờ là bạn sẽ xử lý khi nó có kết nối trở lại... cũng như là update giá mới mất mạng vậy") — xem
// chú thích đầy đủ ở schema.sql ngay trên
// CREATE TABLE dbo.DsmartStoreFanOutRetryQueue. CHỈ routes/dsmartWholesalePrice.js, jobs/
// dsmartAutoApplyScheduledPrices.js, jobs/dsmartAutoDeleteExpiredPrices.js (ghi vào hàng đợi khi 1 siêu
// thị lỗi) và jobs/dsmartRetryStoreFanOutQueue.js (đọc + xử lý hàng đợi) được gọi tới file này.
const { getPool, sql } = require('../db');

function rowToItem(row) {
  let payload = {};
  try { payload = JSON.parse(row.PayloadJson) || {}; } catch (_) { payload = {}; }
  return {
    id: Number(row.Id), storeId: Number(row.StoreId), storeCode: row.StoreCode, storeName: row.StoreName,
    action: row.Action, custId: row.CustId, skuId: row.SkuId,
    entryId: row.EntryId == null ? null : Number(row.EntryId),
    payload, attempts: row.Attempts, lastError: row.LastError,
    createdAt: row.CreatedAt, lastTriedAt: row.LastTriedAt
  };
}

async function listAll() {
  const pool = await getPool();
  const result = await pool.request().query('SELECT * FROM dbo.DsmartStoreFanOutRetryQueue ORDER BY CreatedAt');
  return result.recordset.map(rowToItem);
}

// enqueue(): UPSERT theo khoá (StoreId, CustId, SkuId, Action) — UPDATE trước (coi như đã có dòng chờ
// thử lại từ lần lỗi trước), INSERT nếu chưa có (cùng khuôn "UPDATE trước, INSERT sau" đã rút kinh
// nghiệm ở lib/dsmartSqlClient.js::upsertPriceOnPool(), tránh exception-driven control flow cho tình
// huống BÌNH THƯỜNG là ghi đè).
async function enqueue({ storeId, storeCode, storeName, action, custId, skuId, entryId, payload, error }) {
  const pool = await getPool();
  const payloadJson = JSON.stringify(payload || {});
  const updateResult = await pool.request()
    .input('storeId', sql.BigInt, storeId).input('custId', sql.NVarChar(50), custId)
    .input('skuId', sql.NVarChar(50), skuId).input('action', sql.NVarChar(10), action)
    .input('storeCode', sql.NVarChar(50), storeCode).input('storeName', sql.NVarChar(200), storeName)
    .input('entryId', sql.BigInt, entryId == null ? null : Number(entryId))
    .input('payloadJson', sql.NVarChar(sql.MAX), payloadJson)
    .input('lastError', sql.NVarChar(sql.MAX), error || null)
    .query(`
      UPDATE dbo.DsmartStoreFanOutRetryQueue SET
        StoreCode = @storeCode, StoreName = @storeName, EntryId = @entryId, PayloadJson = @payloadJson,
        Attempts = Attempts + 1, LastError = @lastError, LastTriedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
      WHERE StoreId = @storeId AND CustId = @custId AND SkuId = @skuId AND Action = @action;
    `);
  if (updateResult.rowsAffected[0] > 0) return;
  const id = Date.now() + Math.floor(Math.random() * 1000);
  await pool.request()
    .input('id', sql.BigInt, id)
    .input('storeId', sql.BigInt, storeId).input('storeCode', sql.NVarChar(50), storeCode)
    .input('storeName', sql.NVarChar(200), storeName).input('action', sql.NVarChar(10), action)
    .input('custId', sql.NVarChar(50), custId).input('skuId', sql.NVarChar(50), skuId)
    .input('entryId', sql.BigInt, entryId == null ? null : Number(entryId))
    .input('payloadJson', sql.NVarChar(sql.MAX), payloadJson)
    .input('lastError', sql.NVarChar(sql.MAX), error || null)
    .query(`
      INSERT INTO dbo.DsmartStoreFanOutRetryQueue
        (Id, StoreId, StoreCode, StoreName, Action, CustId, SkuId, EntryId, PayloadJson, Attempts, LastError, LastTriedAt)
      VALUES (@id, @storeId, @storeCode, @storeName, @action, @custId, @skuId, @entryId, @payloadJson, 1, @lastError, SYSUTCDATETIME());
    `);
}

// enqueueFailedStores(): tiện ích gọi tại nơi vừa Áp Giá/Xoá — lọc đúng storeResults có ok=false và
// enqueue() từng cái. KHÔNG BAO GIỜ ném lỗi ra ngoài (lỗi ghi hàng đợi chỉ log cảnh báo, không được chặn
// thao tác chính Áp Giá/Xoá đã ghi CSPRICE thành công).
async function enqueueFailedStores({ storeResults, action, entryId, custId, skuId, payload }) {
  if (!Array.isArray(storeResults)) return;
  for (const r of storeResults) {
    if (r.ok) continue;
    try {
      await enqueue({ storeId: r.storeId, storeCode: r.storeCode, storeName: r.storeName, action, custId, skuId, entryId, payload, error: r.error });
    } catch (err) {
      console.error(`⛔ dsmartStoreFanOutRetryStore: lỗi khi ghi hàng đợi thử lại (store=${r.storeCode}, action=${action}, CustId=${custId}/SkuId=${skuId}):`, err.message);
    }
  }
}

async function markTried(id, errorMessage) {
  const pool = await getPool();
  await pool.request().input('id', sql.BigInt, id).input('err', sql.NVarChar(sql.MAX), errorMessage || 'Lỗi không xác định')
    .query('UPDATE dbo.DsmartStoreFanOutRetryQueue SET Attempts = Attempts + 1, LastError = @err, LastTriedAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME() WHERE Id = @id');
}

async function removeById(id) {
  const pool = await getPool();
  await pool.request().input('id', sql.BigInt, id).query('DELETE FROM dbo.DsmartStoreFanOutRetryQueue WHERE Id = @id');
}

// removeByStoreId(): dọn hàng đợi khi 1 kết nối siêu thị bị XOÁ hẳn (DELETE /store-connections/:id) —
// không còn kết nối nào để thử lại nữa.
async function removeByStoreId(storeId) {
  const pool = await getPool();
  await pool.request().input('storeId', sql.BigInt, storeId).query('DELETE FROM dbo.DsmartStoreFanOutRetryQueue WHERE StoreId = @storeId');
}

module.exports = { listAll, enqueue, enqueueFailedStores, markTried, removeById, removeByStoreId };
