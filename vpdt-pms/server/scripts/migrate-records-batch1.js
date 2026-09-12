// scripts/migrate-records-batch1.js — Script MỘT LẦN, chạy thủ công SAU KHI đã chạy sql/schema.sql bản
// mới (tạo 11 bảng riêng Bước 7: Notifications/Docs/Submissions/AttendanceRecords/OperationOrders/
// OperationStoreOpenings/OperationRepairs/PaymentRequests/ChecklistSubmissions/
// TrainingTestSubmissions/TrainingDocumentProgress) — sao chép dữ liệu ĐANG CÓ của 11 collection này từ
// dbo.Records (bảng dùng chung cũ) sang bảng riêng tương ứng.
//
// AN TOÀN — script CHỈ THÊM, KHÔNG XOÁ:
//   - KHÔNG xoá gì ở dbo.Records — dữ liệu gốc giữ nguyên vẹn làm bản sao lưu tới khi Bước 7g (dọn dẹp,
//     một đợt merge RIÊNG sau này, sau khi đã xác nhận ổn định) mới dọn.
//   - Idempotent — chạy lại nhiều lần an toàn: bản ghi nào đã có ở bảng đích (theo Id) sẽ tự bỏ qua,
//     không insert trùng, không báo lỗi.
//   - Giữ NGUYÊN Id gốc (KHÔNG sinh Id mới) — bắt buộc, vì Id đang được tham chiếu chéo ở nơi khác
//     (rootDocId, taskId, sourceId của paymentRequests/operationWorkItems...).
//
// KHUYẾN NGHỊ BẮT BUỘC trước khi chạy trên server thật: sao lưu CSDL (hoặc phục hồi ra 1 bản CSDL thử
// nghiệm riêng), chạy script này ở đó trước, đối chiếu vài bản ghi mẫu khớp đúng dữ liệu cũ, RỒI mới
// chạy trên production thật — không có SQL Server thật trong môi trường phát triển để tự kiểm chứng
// trước khi giao script này.
//
// CHẠY NHƯ THẾ NÀO (từ thư mục server/, .env phải có sẵn ở đó — script tự nạp qua db.js):
//   1. node scripts/migrate-records-batch1.js            -> chỉ ĐẾM & XEM TRƯỚC (dry-run), KHÔNG ghi gì.
//   2. node scripts/migrate-records-batch1.js --confirm  -> DI TRÚ THẬT (chỉ INSERT bản ghi còn thiếu ở
//                                                            bảng đích, không đụng bản ghi đã có).
//
// SAU KHI CHẠY XONG (--confirm) VÀ ĐỐI CHIẾU SỐ LIỆU KHỚP: mới được coi là an toàn để deploy code mới
// (recordStore.js đã trỏ đọc/ghi 11 collection này sang bảng riêng) — nếu deploy code mới TRƯỚC khi
// chạy script này, app sẽ thấy các collection đó RỖNG (bảng mới chưa có dữ liệu).

const { getPool, sql } = require('../db');
const { DEDICATED_TABLES, dedicatedTableName, bindExtractedColumns } = require('../lib/recordStore');

async function loadSourceRows(pool, collection) {
  const result = await pool.request()
    .input('collection', sql.NVarChar(50), collection)
    .query('SELECT Id, Code, Payload FROM dbo.Records WHERE Collection = @collection');
  return result.recordset;
}

async function loadExistingDestIds(pool, table) {
  const result = await pool.request().query(`SELECT Id FROM ${table}`);
  return new Set(result.recordset.map(r => String(r.Id)));
}

async function migrateCollection(pool, collection, confirm) {
  const cfg = DEDICATED_TABLES[collection];
  const table = dedicatedTableName(collection);
  const sourceRows = await loadSourceRows(pool, collection);
  const existingDestIds = await loadExistingDestIds(pool, table);
  const toMigrate = sourceRows.filter(row => !existingDestIds.has(String(row.Id)));

  console.log(`\n📦 ${collection} (-> ${table})`);
  console.log(`   Nguồn dbo.Records: ${sourceRows.length} bản ghi | Đã có ở bảng đích: ${existingDestIds.size} | Cần di trú: ${toMigrate.length}`);

  if (!confirm || toMigrate.length === 0) return { collection, migrated: 0, skipped: sourceRows.length - toMigrate.length, total: sourceRows.length };

  let migrated = 0;
  let failed = 0;
  for (const row of toMigrate) {
    let item;
    try {
      item = JSON.parse(row.Payload);
    } catch (err) {
      console.error(`   ⛔ Bỏ qua Id=${row.Id}: Payload không phải JSON hợp lệ (${err.message})`);
      failed++;
      continue;
    }
    try {
      const req = pool.request();
      req.input('id', sql.BigInt, row.Id);
      req.input('payload', sql.NVarChar(sql.MAX), row.Payload);
      const colNames = ['Id', 'Payload'];
      const colParams = ['@id', '@payload'];
      if (cfg.hasCode) {
        req.input('code', sql.NVarChar(100), row.Code || null);
        colNames.push('Code'); colParams.push('@code');
      }
      for (const { col, param } of bindExtractedColumns(req, cfg, item)) {
        colNames.push(col); colParams.push('@' + param);
      }
      await req.query(`INSERT INTO ${table} (${colNames.join(', ')}) VALUES (${colParams.join(', ')});`);
      migrated++;
    } catch (err) {
      console.error(`   ⛔ Lỗi di trú Id=${row.Id} (Code=${row.Code || ''}): ${err.message}`);
      failed++;
    }
  }
  console.log(`   ✅ Đã di trú ${migrated}/${toMigrate.length} bản ghi mới${failed ? ` — ⚠️ ${failed} bản ghi LỖI, xem log ở trên` : ''}.`);
  return { collection, migrated, failed, skipped: sourceRows.length - toMigrate.length, total: sourceRows.length };
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const pool = await getPool();

  console.log(confirm
    ? '🚀 DI TRÚ THẬT — sẽ INSERT các bản ghi còn thiếu vào 11 bảng riêng Bước 7 (KHÔNG xoá gì ở dbo.Records).'
    : 'ℹ️  DRY-RUN — chỉ đếm số liệu, CHƯA ghi gì. Chạy lại với --confirm để di trú thật.');

  const results = [];
  for (const collection of Object.keys(DEDICATED_TABLES)) {
    results.push(await migrateCollection(pool, collection, confirm));
  }

  const totalFailed = results.reduce((sum, r) => sum + (r.failed || 0), 0);
  console.log('\n===== TỔNG KẾT =====');
  for (const r of results) {
    console.log(`  ${r.collection.padEnd(28)} nguồn=${String(r.total).padStart(6)}  ${confirm ? `di_trú_mới=${String(r.migrated).padStart(6)}` : `cần_di_trú=${String(r.total - r.skipped).padStart(6)}`}  đã_có=${String(r.skipped).padStart(6)}`);
  }
  if (confirm) {
    if (totalFailed > 0) {
      console.log(`\n⚠️  Có ${totalFailed} bản ghi LỖI khi di trú — xem chi tiết ở log phía trên, XỬ LÝ THỦ CÔNG các bản ghi này rồi chạy lại script (an toàn, idempotent) trước khi coi là hoàn tất.`);
    } else {
      console.log('\n✅ Di trú xong, không có lỗi nào. Đối chiếu lại số liệu nguồn/đích ở trên khớp nhau trước khi deploy code mới.');
    }
  } else {
    console.log('\nℹ️  Đây là DRY-RUN — chưa ghi gì cả. Chạy lại với --confirm để di trú thật.');
  }

  await pool.close();
}

main().catch(err => {
  console.error('⛔ Lỗi khi chạy script di trú Bước 7:', err);
  process.exit(1);
});
