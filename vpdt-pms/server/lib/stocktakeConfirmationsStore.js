// lib/stocktakeConfirmationsStore.js — Kho lưu trữ RIÊNG cho 3 collection Xác Nhận Kiểm Kê (Tab 6, BƯỚC
// 8, 12/2026 — tách khỏi dbo.AppData, xem chú thích đầy đủ ở sql/schema.sql ngay trên CREATE TABLE
// dbo.StocktakeShelfConfirmations): stocktakeShelfConfirmations (Xác Nhận Quầy Kệ sau Kiểm Đếm),
// stocktakeShelfGomMaConfirmations (Xác Nhận Gom Mã), stocktakeShelfKiemSoatConfirmations (Xác Nhận Kiểm
// Soát) — CÙNG hình dạng hệt nhau (khoá tổng hợp SessionId+ShelfLocationId, không cộng dồn số lượng, chỉ
// là 1 cờ có/không), nên 1 file DÙNG CHUNG cho cả 3, tham số hoá qua `collection` (tên AppData key cũ,
// cũng là key trong lib/recordStore.js DEDICATED_TABLES). Logic nghiệp vụ THUẦN (confirmShelf/
// unconfirmShelf/findShelfConfirmation) GIỮ NGUYÊN ở lib/stocktakeEngine.js — file này chỉ lo đọc/khoá/
// ghi đúng bảng mới, cùng tinh thần lib/stocktakeCountsStore.js.
const { getPool, sql } = require('../db');
const { getAppDataValue } = require('./appData');
const {
  withAppLock, insertRecord, queryDedicatedRecords, deleteRecordForCollection,
  bindExtractedColumns, DEDICATED_TABLES, isLegacyMigrationDone, markLegacyMigrationDone
} = require('./recordStore');
const { confirmShelf } = require('./stocktakeEngine');

async function getConfirmationsForSession(collection, sessionId) {
  const { items } = await queryDedicatedRecords(collection, { where: { SessionId: sessionId } });
  return items;
}

// getConfirmationById() — tra 1 dòng theo Id (KHÔNG khoá, chỉ đọc sessionId/shelfLocationId để validate
// quyền/phạm vi TRƯỚC khi gỡ xác nhận thật) — cùng tinh thần getCountById() (lib/stocktakeCountsStore.js).
async function getConfirmationById(collection, id) {
  const table = DEDICATED_TABLES[collection].table;
  const pool = await getPool();
  const result = await pool.request().input('id', sql.BigInt, id).query(`SELECT Payload FROM dbo.${table} WHERE Id = @id`);
  return result.recordset.length ? JSON.parse(result.recordset[0].Payload) : null;
}

// confirmShelfRow() — idempotent (xác nhận lại 1 quầy kệ ĐÃ xác nhận trả về đúng dòng cũ, không tạo
// trùng) — withAppLock SCOPE ĐÚNG (sessionId, shelfLocationId) chặn race 2 request xác nhận gần như đồng
// thời cùng 1 quầy kệ (ít khả năng hơn hẳn stocktakeCounts nhưng vẫn cùng nguyên tắc an toàn).
async function confirmShelfRow(collection, input, user) {
  const sessionId = Number(input?.sessionId);
  const shelfLocationId = Number(input?.shelfLocationId);
  const lockKey = `stocktake_confirm:${collection}:${sessionId}:${shelfLocationId}`;
  return withAppLock(lockKey, async () => {
    const { items } = await queryDedicatedRecords(collection, { where: { SessionId: sessionId, ShelfLocationId: shelfLocationId } });
    if (items[0]) return items[0]; // đã xác nhận trước đó -> trả nguyên dòng cũ, không tạo trùng.
    const newRow = confirmShelf([], input, user);
    return insertRecord(collection, newRow);
  });
}

async function unconfirmShelfRow(collection, id, checkFn, actor) {
  return deleteRecordForCollection(collection, id, checkFn, actor);
}

// migrateLegacyConfirmations(collection) — cùng khuôn migrateLegacyStocktakeCounts() (lib/stocktakeCountsStore.js)
// — gọi 1 lần/collection lúc khởi động, idempotent, KHÔNG xoá key AppData cũ.
async function migrateLegacyConfirmations(collection) {
  const cfg = DEDICATED_TABLES[collection];
  const table = cfg.table;
  const pool = await getPool();

  // LỖI THẬT PRODUCTION đã vá (12/2026, xem chú thích đầy đủ tại isLegacyMigrationDone()/
  // markLegacyMigrationDone() — lib/recordStore.js): check CŨ chỉ dựa "bảng đích rỗng" để quyết định di
  // trú lại, khiến dữ liệu người dùng đã XOÁ bị "sống lại" sau mỗi lần deploy/restart.
  if (await isLegacyMigrationDone(collection)) return;

  const countResult = await pool.request().query(`SELECT COUNT(*) AS c FROM dbo.${table}`);
  if (countResult.recordset[0].c === 0) {
    let legacy;
    try {
      legacy = await getAppDataValue(collection);
    } catch (err) {
      legacy = null;
    }
    if (Array.isArray(legacy) && legacy.length) {
      let migrated = 0, failed = 0;
      for (const record of legacy) {
        try {
          const req = pool.request();
          req.input('id', sql.BigInt, record.id);
          req.input('payload', sql.NVarChar(sql.MAX), JSON.stringify(record));
          const colNames = ['Id', 'Payload'];
          const colParams = ['@id', '@payload'];
          for (const { col, param } of bindExtractedColumns(req, cfg, record)) {
            colNames.push(col); colParams.push('@' + param);
          }
          await req.query(`INSERT INTO dbo.${table} (${colNames.join(', ')}) VALUES (${colParams.join(', ')});`);
          migrated++;
        } catch (err) {
          failed++;
          console.error(`   ⛔ Lỗi di trú ${collection} Id=${record.id}: ${err.message}`);
        }
      }
      console.log(`   ↳ Đã di chuyển ${migrated}/${legacy.length} dòng ${collection} sang bảng dbo.${table} riêng${failed ? ` — ⚠️ ${failed} dòng LỖI, xem log ở trên` : ''}. Dữ liệu gốc trong AppData VẪN GIỮ NGUYÊN (không xoá) để phòng hờ.`);
    }
  }

  await markLegacyMigrationDone(collection);
}

module.exports = {
  getConfirmationsForSession, getConfirmationById, confirmShelfRow, unconfirmShelfRow, migrateLegacyConfirmations
};
