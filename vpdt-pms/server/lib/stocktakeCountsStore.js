// lib/stocktakeCountsStore.js — Kho lưu trữ RIÊNG cho "stocktakeCounts" (BƯỚC 8, 12/2026 — tách khỏi
// dbo.AppData, xem chú thích đầy đủ ở sql/schema.sql ngay trên CREATE TABLE dbo.StocktakeCounts). Đây là
// collection ghi NHIỀU nhất của cả hệ thống Kiểm Kê (mỗi lượt quét Gom Mã/Kiểm Đếm/Kiểm Soát của MỌI
// người, MỌI siêu thị, MỌI kỳ đều ghi vào đây) nên KHÔNG dùng createForCollection() thường (tạo 1 bản ghi
// độc lập theo lựa chọn người dùng) — đây là "tìm-hoặc-tạo theo khoá tổng hợp (SessionId, ShelfLocationId,
// MaHang) rồi CỘNG DỒN số lượng", cùng tinh thần trainingDocumentProgress/trainingTestSubmissions
// (routes/records.js tự quản lý upsert theo khoá tự nhiên, xem lib/recordStore.js DEDICATED_TABLES) —
// nhưng KHOÁ qua withAppLock() SCOPE ĐÚNG 1 khoá tổng hợp (sp_getapplock, hoạt động đúng cả khi chạy
// nhiều tiến trình PM2 cluster) thay vì khoá nguyên cả AppData blob như thiết kế cũ: 2 lượt quét 2 mã
// hàng KHÁC NHAU (hoặc 2 quầy kệ/2 kỳ khác nhau) giờ KHÔNG còn chặn lẫn nhau nữa.
//
// Toàn bộ LOGIC NGHIỆP VỤ (cộng dồn đúng field theo mode, chống trùng clientScanId, sửa tay, tính SL Cuối
// Cùng...) VẪN giữ nguyên ở lib/stocktakeEngine.js (upsertScanCount/editCountValue — các hàm THUẦN, không
// đọc/ghi CSDL) — file này CHỈ lo phần đọc/khoá/ghi CSDL đúng bảng mới, gọi lại NGUYÊN các hàm thuần đó
// (truyền vào mảng 1 phần tử thay vì cả collection) để không viết lại logic nghiệp vụ đã test kỹ.
const { getPool, sql } = require('../db');
const { getAppDataValue } = require('./appData');
const {
  withAppLock, withLockedRecordForCollection, insertRecord, queryDedicatedRecords, deleteRecordForCollection,
  bindExtractedColumns, DEDICATED_TABLES, isLegacyMigrationDone, markLegacyMigrationDone
} = require('./recordStore');
const { upsertScanCount, editCountValue } = require('./stocktakeEngine');

// getCountsForSession/getCountsForShelf — SQL lọc THẲNG theo SessionId (hoặc +ShelfLocationId), KHÔNG
// còn tải toàn bộ stocktakeCounts của MỌI kỳ/MỌI siêu thị rồi lọc bằng JS như thiết kế AppData cũ.
async function getCountsForSession(sessionId) {
  const { items } = await queryDedicatedRecords('stocktakeCounts', { where: { SessionId: sessionId } });
  return items;
}
async function getCountsForShelf(sessionId, shelfLocationId) {
  const { items } = await queryDedicatedRecords('stocktakeCounts', { where: { SessionId: sessionId, ShelfLocationId: shelfLocationId } });
  return items;
}

// getCountById() — tra 1 dòng theo Id thật (KHÔNG khoá — chỉ dùng để đọc sessionId/shelfLocationId phục
// vụ validate quyền/phạm vi (assertStocktakeScanAllowed()) TRƯỚC khi mở giao dịch khoá ghi thật ở
// editCountValueRow()/deleteCountRowById() — cùng tinh thần "validate xong mới mở transaction ghi" đã ghi
// chú ở routes/stocktake.js PUT /counts/:id).
async function getCountById(id) {
  const pool = await getPool();
  const result = await pool.request().input('id', sql.BigInt, id).query('SELECT Payload FROM dbo.StocktakeCounts WHERE Id = @id');
  return result.recordset.length ? JSON.parse(result.recordset[0].Payload) : null;
}

// getCountsForSessions() — Báo Cáo (GET /report) cần counts của NHIỀU kỳ cùng lúc (kỳ chính + tối đa 6
// kỳ So Sánh + mỗi siêu thị ở So Sánh Giữa Các Siêu Thị của Admin) — 1 câu SQL WHERE IN duy nhất, KHÔNG
// tải toàn bộ bảng StocktakeCounts của MỌI kỳ/MỌI siêu thị như thiết kế AppData cũ.
async function getCountsForSessions(sessionIds) {
  const ids = [...new Set((sessionIds || []).map(Number).filter(Number.isFinite))];
  if (!ids.length) return [];
  const pool = await getPool();
  const req = pool.request();
  const placeholders = ids.map((id, i) => { req.input(`id${i}`, sql.BigInt, id); return `@id${i}`; });
  const result = await req.query(`SELECT Payload FROM dbo.StocktakeCounts WHERE SessionId IN (${placeholders.join(',')})`);
  return result.recordset.map(r => JSON.parse(r.Payload));
}

// getSessionIdsWithCounts() — GET /sessions (Tab 1) cần biết TRƯỚC kỳ "Đang hoạt động" nào đã thật sự có
// dữ liệu quét để hiện đúng nút "🗑️ Xoá" (xem deleteDraftSession() ở lib/stocktakeEngine.js) — nhiều kỳ
// cùng lúc (không chỉ 1 sessionId như getCountsForSession() ở trên), nên dùng 1 câu SQL DISTINCT thay vì
// gọi lặp từng kỳ. Trả về Set<sessionId> (chỉ cần BIẾT CÓ hay không, không cần đọc nội dung).
async function getSessionIdsWithCounts(sessionIds) {
  const ids = [...new Set((sessionIds || []).map(Number).filter(Number.isFinite))];
  if (!ids.length) return new Set();
  const pool = await getPool();
  const req = pool.request();
  const placeholders = ids.map((id, i) => { req.input(`id${i}`, sql.BigInt, id); return `@id${i}`; });
  const result = await req.query(`SELECT DISTINCT SessionId FROM dbo.StocktakeCounts WHERE SessionId IN (${placeholders.join(',')})`);
  return new Set(result.recordset.map(r => r.SessionId));
}

// upsertScanCountRow() — thay cho withLockedAppDataValue('stocktakeCounts', arr => upsertScanCount(arr,...))
// cũ. lockKey SCOPE ĐÚNG (sessionId, shelfLocationId, maHang) — "giành chỗ" TRƯỚC khi đọc, chặn đúng race
// "2 request cùng thấy chưa có dòng nào rồi cùng INSERT" (2 lượt quét CÙNG 1 mã hàng gần như đồng thời,
// kịch bản THẬT khi nhiều người kiểm kê cùng lúc) — UX_StocktakeCounts_Session_Shelf_MaHang vẫn là lưới an
// toàn cuối cùng ở tầng CSDL nếu lockKey vì lý do nào đó không phủ hết (không nên xảy ra).
async function upsertScanCountRow(input, extra, user, clientScanId) {
  const sessionId = Number(input?.sessionId);
  const shelfLocationId = Number(input?.shelfLocationId);
  const maHang = String(input?.maHang || '').trim();
  const lockKey = `stocktake_count:${sessionId}:${shelfLocationId}:${maHang}`;
  return withAppLock(lockKey, async () => {
    const { items } = await queryDedicatedRecords('stocktakeCounts', {
      where: { SessionId: sessionId, ShelfLocationId: shelfLocationId, MaHang: maHang }
    });
    const existing = items[0] || null;
    if (existing) {
      return withLockedRecordForCollection('stocktakeCounts', existing.id, (item) =>
        upsertScanCount([item], input, extra, user, clientScanId));
    }
    const newRow = upsertScanCount([], input, extra, user, clientScanId);
    return insertRecord('stocktakeCounts', newRow);
  });
}

// editCountValueRow()/deleteCountRowById() — sửa tay/xoá 1 dòng đã biết Id thật (UI đã tải danh sách rồi
// mới bấm sửa/xoá) — chỉ cần khoá ĐÚNG 1 dòng theo Id (withLockedRecordForCollection/deleteRecordForCollection
// đã tự làm đúng việc này), không cần withAppLock theo khoá tổng hợp như upsertScanCountRow() ở trên (ở
// đây không có nhánh "tạo mới nếu chưa có", không có race cần giành chỗ).
async function editCountValueRow(id, mode, newQty, user) {
  return withLockedRecordForCollection('stocktakeCounts', id, (item) => editCountValue([item], id, mode, newQty, user));
}
// checkFn/actor — truyền thẳng xuống deleteRecordForCollection() để validate quyền/phạm vi TRƯỚC khi xoá
// (xem lib/recordStore.js::moveDedicatedRecordToTrash, checkFn nhận bản ghi JSON đầy đủ) + ghi vào Thùng
// Rác (dbo.TrashBin) — CẢI THIỆN so với hành vi cũ (xoá vĩnh viễn, không khôi phục được), đồng bộ đúng
// khuôn mọi collection khác đã có bảng riêng.
async function deleteCountRowById(id, checkFn, actor) {
  return deleteRecordForCollection('stocktakeCounts', id, checkFn, actor);
}

// migrateLegacyStocktakeCounts() — gọi 1 LẦN lúc server khởi động (seedDefaults.js, CÙNG khuôn
// migrateLegacyInventorySnapshot()/migrateLegacySystemLogs() đã có) — idempotent (bảng đích đã có dữ liệu
// thì bỏ qua ngay). KHÁC migrateLegacyInventorySnapshot(): KHÔNG xoá key AppData "stocktakeCounts" cũ sau
// khi di trú xong (dữ liệu nghiệp vụ người dùng nhập tay, không phải cache có thể đồng bộ lại nếu mất —
// giữ lại làm bản sao lưu, code từ nay không còn đọc/ghi key cũ này nữa nên để nguyên không ảnh hưởng gì).
async function migrateLegacyStocktakeCounts() {
  const pool = await getPool();

  // LỖI THẬT PRODUCTION đã vá (12/2026, xem chú thích đầy đủ tại isLegacyMigrationDone()/
  // markLegacyMigrationDone() — lib/recordStore.js): check CŨ chỉ dựa "bảng đích rỗng" để quyết định di
  // trú lại, khiến dữ liệu người dùng đã XOÁ bị "sống lại" sau mỗi lần deploy/restart.
  if (await isLegacyMigrationDone('stocktakeCounts')) return;

  const countResult = await pool.request().query('SELECT COUNT(*) AS c FROM dbo.StocktakeCounts');
  if (countResult.recordset[0].c === 0) {
    let legacy;
    try {
      legacy = await getAppDataValue('stocktakeCounts');
    } catch (err) {
      // Key "stocktakeCounts" chưa từng được seedDefaults() tạo (môi trường hoàn toàn mới, chưa ai dùng
      // Kiểm Kê bao giờ) — không có gì để di trú, không phải lỗi.
      legacy = null;
    }
    if (Array.isArray(legacy) && legacy.length) {
      const cfg = DEDICATED_TABLES.stocktakeCounts;
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
          await req.query(`INSERT INTO dbo.StocktakeCounts (${colNames.join(', ')}) VALUES (${colParams.join(', ')});`);
          migrated++;
        } catch (err) {
          failed++;
          console.error(`   ⛔ Lỗi di trú stocktakeCounts Id=${record.id}: ${err.message}`);
        }
      }
      console.log(`   ↳ Đã di chuyển ${migrated}/${legacy.length} dòng Kiểm Kê (stocktakeCounts) sang bảng dbo.StocktakeCounts riêng${failed ? ` — ⚠️ ${failed} dòng LỖI, xem log ở trên` : ''}. Dữ liệu gốc trong AppData VẪN GIỮ NGUYÊN (không xoá) để phòng hờ.`);
    }
  }

  await markLegacyMigrationDone('stocktakeCounts');
}

module.exports = {
  getCountsForSession, getCountsForShelf, getCountsForSessions, getCountById, getSessionIdsWithCounts,
  upsertScanCountRow, editCountValueRow, deleteCountRowById, migrateLegacyStocktakeCounts
};
