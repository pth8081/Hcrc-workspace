// lib/shelfRecordsStore.js — Kho lưu trữ RIÊNG cho lượt Ghi Nhận Trên Kệ "upsert theo lô" (Kiểm Soát
// Hàng Hóa, BƯỚC 8, 12/2026 — tách khỏi dbo.AppData, xem chú thích đầy đủ ở sql/schema.sql ngay trên
// CREATE TABLE dbo.ShelfRecords + lib/recordStore.js::DEDICATED_TABLES.shelfRecords). CRUD thường của
// shelfRecords (tạo mới qua POST /api/create/shelfRecords, sửa PATCH /records/:id, xoá DELETE
// /records/:id) đã tự đi qua các hàm GENERIC lib/recordStore.js (createForCollection/
// withLockedRecordForCollection/deleteRecordForCollection) — KHÔNG cần file này, tự chuyển sang bảng
// riêng ngay khi có DEDICATED_TABLES entry. File này CHỈ lo đúng 1 route ĐẶC BIỆT: POST
// /api/shelf-stock/records/upsert (routes/shelfStock.js) — trước đây gọi THẲNG
// withLockedAppDataValue('shelfRecords', ...), khoá NGUYÊN cả collection cho MỌI lượt Ghi Nhận của MỌI
// siêu thị cùng lúc.
//
// "CÙNG LÔ" (ghi đè, không tạo dòng mới) khớp maHang HOẶC maVach (OR) + CÒN quantity>0 — điều kiện này
// KHÔNG diễn đạt được bằng 1 UNIQUE INDEX/khoá tổng hợp đơn giản như stocktakeCounts
// (lib/stocktakeCountsStore.js), nên khoá ở đây CHỈ scope theo (dept, shelfLocationId) — thô hơn 1 chút
// nhưng vẫn hẹp hơn HẲN khoá nguyên cả AppData cũ (2 lượt Ghi Nhận ở 2 quầy kệ KHÁC NHAU không còn chặn
// lẫn nhau). Logic nghiệp vụ khớp "cùng lô" (findMatchingActiveShelfRecord(), hàm THUẦN) GIỮ NGUYÊN ở
// lib/shelfRecordUpsert.js — file này chỉ lo đọc/khoá/ghi đúng bảng mới.
const { getPool, sql } = require('../db');
const { getAppDataValue } = require('./appData');
const {
  withAppLock, withLockedRecordForCollection, insertRecord, queryDedicatedRecords,
  bindExtractedColumns, DEDICATED_TABLES, isLegacyMigrationDone, markLegacyMigrationDone
} = require('./recordStore');
const { findMatchingActiveShelfRecord, formatCreatedAt } = require('./shelfRecordUpsert');

// normalized: kết quả normalizeShelfRecordPayload() (lib/shelfRecordUpsert.js) — đã validate đủ, CHƯA
// có dept/id/createdAt/creator (route tự gán ở đây, sau khi biết chèn mới hay cập nhật bản ghi đã khoá —
// giữ ĐÚNG hành vi cũ, chỉ đổi nơi đọc/khoá/ghi).
async function upsertShelfRecordRow(normalized, dept, freshUser, clientRecordId) {
  const shelfLocationId = normalized.shelfLocationId;
  const lockKey = `shelf_record_upsert:${dept}:${shelfLocationId}`;
  return withAppLock(lockKey, async () => {
    const { items } = await queryDedicatedRecords('shelfRecords', { where: { Dept: dept, ShelfLocationId: shelfLocationId } });
    const existing = findMatchingActiveShelfRecord(items, {
      dept, shelfLocationId, maHang: normalized.maHang, maVach: normalized.maVach, expiryDate: normalized.expiryDate
    });
    // lastScannedAt (KHÁC createdAt, xem chú thích đầy đủ ở routes/shelfStock.js bản cũ trước khi tách
    // bảng — giữ nguyên ý nghĩa) — bump MỖI LẦN quét/cập nhật tại chỗ, kể cả lô tạo từ hôm trước.
    const lastScannedAt = formatCreatedAt(new Date());
    if (existing) {
      const updated = await withLockedRecordForCollection('shelfRecords', existing.id, (item) => {
        item.quantity = normalized.quantity;
        item.productName = normalized.productName;
        item.note = normalized.note;
        if (normalized.customData !== undefined) item.customData = normalized.customData;
        item.lastScannedAt = lastScannedAt;
        if (clientRecordId) item.clientRecordId = clientRecordId;
        return item;
      });
      return { item: updated, wasUpdate: true };
    }
    const rec = {
      ...normalized, dept, id: Date.now(),
      createdAt: formatCreatedAt(new Date()), lastScannedAt,
      creator: freshUser.username, creatorName: freshUser.name,
      clientRecordId
    };
    const inserted = await insertRecord('shelfRecords', rec);
    return { item: inserted, wasUpdate: false };
  });
}

// migrateLegacyShelfRecords() — gọi 1 LẦN lúc server khởi động (seedDefaults.js, CÙNG khuôn
// migrateLegacyStocktakeCounts()/migrateLegacyConfirmations() đã có) — idempotent, KHÔNG xoá key
// AppData "shelfRecords" cũ sau khi di trú xong (dữ liệu nghiệp vụ người dùng nhập tay).
async function migrateLegacyShelfRecords() {
  const pool = await getPool();

  // LỖI THẬT PRODUCTION đã vá (12/2026, xem chú thích đầy đủ tại isLegacyMigrationDone()/
  // markLegacyMigrationDone() — lib/recordStore.js): check CŨ chỉ dựa "bảng đích rỗng" để quyết định di
  // trú lại, khiến dữ liệu người dùng đã XOÁ bị "sống lại" sau mỗi lần deploy/restart.
  if (await isLegacyMigrationDone('shelfRecords')) return;

  const countResult = await pool.request().query('SELECT COUNT(*) AS c FROM dbo.ShelfRecords');
  if (countResult.recordset[0].c === 0) {
    let legacy;
    try {
      legacy = await getAppDataValue('shelfRecords');
    } catch (err) {
      legacy = null; // Key chưa từng được seedDefaults() tạo -> không có gì để di trú.
    }
    if (Array.isArray(legacy) && legacy.length) {
      const cfg = DEDICATED_TABLES.shelfRecords;
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
          await req.query(`INSERT INTO dbo.ShelfRecords (${colNames.join(', ')}) VALUES (${colParams.join(', ')});`);
          migrated++;
        } catch (err) {
          failed++;
          console.error(`   ⛔ Lỗi di trú shelfRecords Id=${record.id}: ${err.message}`);
        }
      }
      console.log(`   ↳ Đã di chuyển ${migrated}/${legacy.length} dòng Ghi Nhận Trên Kệ (shelfRecords) sang bảng dbo.ShelfRecords riêng${failed ? ` — ⚠️ ${failed} dòng LỖI, xem log ở trên` : ''}. Dữ liệu gốc trong AppData VẪN GIỮ NGUYÊN (không xoá) để phòng hờ.`);
    }
  }

  await markLegacyMigrationDone('shelfRecords');
}

module.exports = { upsertShelfRecordRow, migrateLegacyShelfRecords };
