// lib/vendorPurchaseStore.js — Kho lưu dbo.VendorPurchaseTransactions (staging dữ liệu mua hàng, hiện
// từ DSmart) + dbo.PurchaseDataSyncLog (Mua Hàng > BAS, v23.30). 2 bảng quan hệ thuần (không phải
// collection Payload-JSON qua lib/recordStore.js) — cùng lý do dbo.SystemLogs/dbo.Tasks: khối lượng lớn,
// nguồn dữ liệu có cấu trúc cố định từ ngoài, cần lọc/gộp hiệu năng cao, không phải "hồ sơ" người dùng tự
// tạo/sửa qua form thường.
const { getPool, sql } = require('../db');

const INSERT_CHUNK_SIZE = 200; // an toàn dưới giới hạn 2100 tham số/câu lệnh của SQL Server (10 cột/dòng)

function toTransaction(row) {
  return {
    transId: row.TransId,
    vendorCode: row.VendorCode,
    storeCode: row.StoreCode,
    storeFormat: row.StoreFormat,
    categoryCode: row.CategoryCode,
    purchaseDate: row.PurchaseDate instanceof Date ? row.PurchaseDate.toISOString().slice(0, 10) : row.PurchaseDate,
    amount: Number(row.Amount),
    isReturn: !!row.IsReturn,
    sourceSystem: row.SourceSystem,
    sourceRefId: row.SourceRefId,
    dataConfidence: row.DataConfidence,
    syncedAt: row.SyncedAt
  };
}

// Nạp hàng loạt — TỰ ĐỘNG loại bỏ dòng đã tồn tại (cùng SourceSystem+SourceRefId, xem UNIQUE INDEX ở
// sql/schema.sql) để đồng bộ lặp lại (cửa sổ "sinceDate" chồng lấn ở biên) không tạo trùng. Dòng thiếu
// SourceRefId (không có mã tham chiếu gốc) LUÔN được chèn thêm (không dedup được, chấp nhận theo đúng
// hành vi UNIQUE INDEX WHERE SourceRefId IS NOT NULL).
async function bulkInsertPurchaseTransactions(rows) {
  if (!rows || !rows.length) return { rowsInserted: 0 };
  const pool = await getPool();

  const withRef = rows.filter(r => r.sourceRefId);
  const refPairs = [...new Set(withRef.map(r => `${r.sourceSystem}|||${r.sourceRefId}`))];
  const existingRefs = new Set();
  for (let i = 0; i < refPairs.length; i += INSERT_CHUNK_SIZE) {
    const chunk = refPairs.slice(i, i + INSERT_CHUNK_SIZE);
    const req = pool.request();
    const conditions = chunk.map((pair, idx) => {
      const [sourceSystem, sourceRefId] = pair.split('|||');
      req.input(`ss${idx}`, sql.NVarChar(30), sourceSystem);
      req.input(`sr${idx}`, sql.NVarChar(100), sourceRefId);
      return `(SourceSystem = @ss${idx} AND SourceRefId = @sr${idx})`;
    });
    const result = await req.query(`SELECT SourceSystem, SourceRefId FROM dbo.VendorPurchaseTransactions WHERE ${conditions.join(' OR ')}`);
    result.recordset.forEach(r => existingRefs.add(`${r.SourceSystem}|||${r.SourceRefId}`));
  }

  const toInsert = rows.filter(r => !r.sourceRefId || !existingRefs.has(`${r.sourceSystem}|||${r.sourceRefId}`));
  let rowsInserted = 0;
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK_SIZE);
    const req = pool.request();
    const valueRows = chunk.map((r, idx) => {
      req.input(`vc${idx}`, sql.NVarChar(30), r.vendorCode);
      req.input(`sc${idx}`, sql.NVarChar(50), r.storeCode);
      req.input(`sf${idx}`, sql.NVarChar(20), r.storeFormat || null);
      req.input(`cc${idx}`, sql.NVarChar(50), r.categoryCode || null);
      req.input(`pd${idx}`, sql.Date, new Date(r.purchaseDate));
      req.input(`am${idx}`, sql.Decimal(18, 2), r.amount);
      req.input(`ir${idx}`, sql.Bit, !!r.isReturn);
      req.input(`ssys${idx}`, sql.NVarChar(30), r.sourceSystem || 'DSMART');
      req.input(`sref${idx}`, sql.NVarChar(100), r.sourceRefId || null);
      req.input(`dc${idx}`, sql.NVarChar(20), r.dataConfidence || 'PROVISIONAL');
      return `(@vc${idx}, @sc${idx}, @sf${idx}, @cc${idx}, @pd${idx}, @am${idx}, @ir${idx}, @ssys${idx}, @sref${idx}, @dc${idx})`;
    });
    await req.query(`
      INSERT INTO dbo.VendorPurchaseTransactions
        (VendorCode, StoreCode, StoreFormat, CategoryCode, PurchaseDate, Amount, IsReturn, SourceSystem, SourceRefId, DataConfidence)
      VALUES ${valueRows.join(', ')};
    `);
    rowsInserted += chunk.length;
  }
  return { rowsInserted, rowsSkippedDuplicate: rows.length - toInsert.length };
}

// vendorCode: bắt buộc (aggregator lọc đúng theo 1 NCC/lần gọi) — periodStart/periodEnd: DATE string.
async function queryPurchaseTransactionsForVendor(vendorCode, periodStart, periodEnd) {
  const pool = await getPool();
  const result = await pool.request()
    .input('vendorCode', sql.NVarChar(30), vendorCode)
    .input('periodStart', sql.Date, new Date(periodStart))
    .input('periodEnd', sql.Date, new Date(periodEnd))
    .query(`
      SELECT * FROM dbo.VendorPurchaseTransactions
      WHERE VendorCode = @vendorCode AND PurchaseDate >= @periodStart AND PurchaseDate <= @periodEnd
      ORDER BY PurchaseDate DESC, TransId DESC;
    `);
  return result.recordset.map(toTransaction);
}

// ===================== PurchaseDataSyncLog =====================
function toSyncLogEntry(row) {
  return {
    logId: row.LogId,
    startedAt: row.StartedAt, finishedAt: row.FinishedAt,
    sourceSystem: row.SourceSystem, status: row.Status,
    rowsFetched: row.RowsFetched, rowsInserted: row.RowsInserted, pagesFetched: row.PagesFetched,
    triggeredBy: row.TriggeredBy, errorMessage: row.ErrorMessage
  };
}

async function insertPurchaseSyncLog({ startedAt, finishedAt, sourceSystem, status, rowsFetched, rowsInserted, pagesFetched, triggeredBy, errorMessage }) {
  const pool = await getPool();
  const result = await pool.request()
    .input('startedAt', sql.DateTime2(3), startedAt)
    .input('finishedAt', sql.DateTime2(3), finishedAt || null)
    .input('sourceSystem', sql.NVarChar(30), sourceSystem)
    .input('status', sql.NVarChar(20), status)
    .input('rowsFetched', sql.Int, rowsFetched != null ? rowsFetched : null)
    .input('rowsInserted', sql.Int, rowsInserted != null ? rowsInserted : null)
    .input('pagesFetched', sql.Int, pagesFetched != null ? pagesFetched : null)
    .input('triggeredBy', sql.NVarChar(100), triggeredBy || null)
    .input('errorMessage', sql.NVarChar(sql.MAX), errorMessage || null)
    .query(`
      INSERT INTO dbo.PurchaseDataSyncLog (StartedAt, FinishedAt, SourceSystem, Status, RowsFetched, RowsInserted, PagesFetched, TriggeredBy, ErrorMessage)
      OUTPUT INSERTED.*
      VALUES (@startedAt, @finishedAt, @sourceSystem, @status, @rowsFetched, @rowsInserted, @pagesFetched, @triggeredBy, @errorMessage);
    `);
  return toSyncLogEntry(result.recordset[0]);
}

async function getRecentPurchaseSyncLogs(limit = 50) {
  const pool = await getPool();
  const result = await pool.request()
    .input('limit', sql.Int, limit)
    .query('SELECT TOP (@limit) * FROM dbo.PurchaseDataSyncLog ORDER BY StartedAt DESC, LogId DESC');
  return result.recordset.map(toSyncLogEntry);
}

// Lần đồng bộ THÀNH CÔNG gần nhất — dùng làm "sinceDate" cho lượt đồng bộ tăng dần kế tiếp (mục 6.4 tài
// liệu). PARTIAL/FAILED không tính, để lần sau tự động thử lại từ đúng điểm dừng thành công gần nhất
// (không bỏ sót dữ liệu nếu 1 lượt đồng bộ giữa chừng bị lỗi).
async function getLastSuccessfulSyncStart(sourceSystem) {
  const pool = await getPool();
  const result = await pool.request()
    .input('sourceSystem', sql.NVarChar(30), sourceSystem)
    .query(`SELECT TOP (1) StartedAt FROM dbo.PurchaseDataSyncLog WHERE SourceSystem = @sourceSystem AND Status = 'SUCCESS' ORDER BY StartedAt DESC`);
  return result.recordset[0] ? result.recordset[0].StartedAt : null;
}

module.exports = {
  bulkInsertPurchaseTransactions, queryPurchaseTransactionsForVendor,
  insertPurchaseSyncLog, getRecentPurchaseSyncLogs, getLastSuccessfulSyncStart
};
