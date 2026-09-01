// purge-dau-tu.js — Script MỘT LẦN, chạy thủ công sau khi deploy bản xoá "Đầu Tư" khỏi module Tổng Hợp.
//
// Người dùng đã yêu cầu xoá VĨNH VIỄN toàn bộ dữ liệu Đầu Tư (subType='DAU_TU' trong collection
// officeReqs) cùng mọi đề nghị thanh toán tự sinh từ đó (paymentRequests.sourceModule='DAU_TU') —
// KHÔNG chuyển vào Thùng Rác (bỏ qua dbo.TrashBin), xoá thẳng khỏi dbo.Records + dọn luôn file đính kèm
// không còn ai tham chiếu (đúng logic unlinkUnreferencedUploads() đã có, quét chéo cả 3 nơi lưu file:
// Records/TrashBin/AppData nên an toàn, không xoá nhầm file đang được record khác dùng chung).
//
// CHẠY NHƯ THẾ NÀO (từ thư mục server/, .env phải có sẵn ở đó — script tự nạp qua db.js):
//   1. node scripts/purge-dau-tu.js            -> chỉ XEM TRƯỚC (dry-run), KHÔNG xoá gì cả, in ra số
//                                                  lượng + mã hồ sơ sẽ bị xoá để kiểm tra lại trước.
//   2. node scripts/purge-dau-tu.js --confirm  -> XOÁ THẬT, vĩnh viễn, không hoàn tác được. Chỉ chạy
//                                                  bước này SAU KHI đã xem kỹ kết quả dry-run ở bước 1.
//
// An toàn: chạy được nhiều lần (idempotent) — lần 2 trở đi sẽ báo "Không còn hồ sơ Đầu Tư nào" vì đã
// xoá sạch ở lần đầu.

const { getPool, sql } = require('../db');
const { collectRecordFileUrls, unlinkUnreferencedUploads } = require('../lib/recordStore');

async function loadCollectionRows(pool, collection) {
  const result = await pool.request()
    .input('collection', sql.NVarChar(50), collection)
    .query('SELECT Id, Code, Payload FROM dbo.Records WHERE Collection = @collection');
  return result.recordset.map(row => {
    let payload = null;
    try { payload = JSON.parse(row.Payload); } catch { payload = null; }
    return { id: row.Id, code: row.Code, payload };
  });
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const pool = await getPool();

  const officeReqs = await loadCollectionRows(pool, 'officeReqs');
  const dauTuOfficeReqs = officeReqs.filter(r => r.payload?.subType === 'DAU_TU');

  const paymentRequests = await loadCollectionRows(pool, 'paymentRequests');
  const dauTuPayments = paymentRequests.filter(r => r.payload?.sourceModule === 'DAU_TU');

  console.log(`\n📈 Tìm thấy ${dauTuOfficeReqs.length} hồ sơ Đầu Tư (officeReqs) và ${dauTuPayments.length} đề nghị thanh toán liên quan (paymentRequests) sẽ bị xoá vĩnh viễn:\n`);
  dauTuOfficeReqs.forEach(r => console.log(`  - officeReqs #${r.id} [${r.code}] "${r.payload?.title || ''}"`));
  dauTuPayments.forEach(r => console.log(`  - paymentRequests #${r.id} [${r.code}] nguồn officeReqs #${r.payload?.sourceId}`));

  if (dauTuOfficeReqs.length === 0 && dauTuPayments.length === 0) {
    console.log('\n✅ Không còn hồ sơ Đầu Tư nào cần xoá.\n');
    await pool.close();
    return;
  }

  if (!confirm) {
    console.log('\nℹ️  Đây là DRY-RUN — chưa xoá gì cả. Chạy lại với --confirm để xoá thật.\n');
    await pool.close();
    return;
  }

  const fileUrls = new Set();
  dauTuOfficeReqs.forEach(r => collectRecordFileUrls(r.payload, fileUrls));
  dauTuPayments.forEach(r => collectRecordFileUrls(r.payload, fileUrls));

  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    for (const r of dauTuOfficeReqs) {
      await new sql.Request(tx)
        .input('collection', sql.NVarChar(50), 'officeReqs')
        .input('id', sql.BigInt, r.id)
        .query('DELETE FROM dbo.Records WHERE Collection = @collection AND Id = @id');
    }
    for (const r of dauTuPayments) {
      await new sql.Request(tx)
        .input('collection', sql.NVarChar(50), 'paymentRequests')
        .input('id', sql.BigInt, r.id)
        .query('DELETE FROM dbo.Records WHERE Collection = @collection AND Id = @id');
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }

  console.log(`\n✅ Đã xoá vĩnh viễn ${dauTuOfficeReqs.length} hồ sơ officeReqs + ${dauTuPayments.length} paymentRequests.`);

  const { removed, kept } = await unlinkUnreferencedUploads(fileUrls);
  console.log(`🗑️  Đã dọn ${removed.length} file đính kèm không còn ai tham chiếu (giữ lại ${kept.length} file vẫn đang được hồ sơ khác dùng chung).\n`);

  await pool.close();
}

main().catch(err => {
  console.error('⛔ Lỗi khi chạy script xoá Đầu Tư:', err);
  process.exit(1);
});
