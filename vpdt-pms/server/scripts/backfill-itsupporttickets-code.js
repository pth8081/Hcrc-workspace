// scripts/backfill-itsupporttickets-code.js — Script MỘT LẦN, chạy thủ công SAU KHI đã deploy code bản
// vá "ticket Hỗ Trợ IT tạo từ Onboarding/Offboarding cũng cần Mã Yêu Cầu" (11/2026, theo yêu cầu TRỰC
// TIẾP người dùng kèm ảnh chụp thật — 3 ticket "[Onboarding] Tạo email công ty..." có cột "Mã Yêu Cầu"
// trống). Bản vá code (createItTicketForHrTask(), lib/recordActions.js) CHỈ áp dụng cho ticket tạo MỚI
// sau khi deploy — ticket CŨ đã tạo qua đường "Tạo Ticket IT" (Chi Tiết Quy Trình Onboarding/Offboarding)
// TRƯỚC đó thiếu Code vĩnh viễn trong dữ liệu đã lưu (KHÁC createdAt — không có nguồn nào khác để tự suy
// luận ra Code còn thiếu, không thể vá chỉ bằng JS phía client như đã làm cho sort theo Thời Gian Tạo).
//
// Script này quét TOÀN BỘ dbo.ItSupportTickets theo thứ tự Id tăng dần (đúng thứ tự tạo thật), ticket nào
// CHƯA CÓ Code thì tự sinh qua ĐÚNG recordCodeGen.generateHcrcCode() (CÙNG thuật toán HCRC-<viết tắt
// Phòng Ban>-ITHT-<số thứ tự> dùng cho ticket tạo thường) — số thứ tự tính LIÊN TỤC qua TỪNG ticket đang
// backfill trong CÙNG 1 lượt chạy này (không chỉ dựa vào Code đã có sẵn trước đó), đảm bảo không trùng
// lẫn nhau. Ghi vào CẢ cột Code (SQL) LẪN field `code` trong Payload (JSON app đọc) — KHÔNG đụng field
// nào khác trong Payload, KHÔNG xoá/thêm bản ghi nào.
//
// Idempotent — ticket nào ĐÃ có Code (tạo sau bản vá, hoặc đã backfill ở lượt chạy trước) tự động không
// khớp điều kiện "cần sửa", bỏ qua ở mọi lần chạy.
//
// KHUYẾN NGHỊ BẮT BUỘC trước khi chạy trên server thật: sao lưu CSDL trước. Chạy vào lúc ít người thao
// tác (script giả định không có ticket MỚI nào được tạo đồng thời trong lúc chạy — nếu có, ticket mới đó
// vẫn tự sinh Code đúng qua đường code thường, chỉ risk cực hiếm là trùng Code nếu rơi đúng số thứ tự
// script đang tính — insertDedicatedRecord() đã có cơ chế tự phát hiện + tính lại khi gặp trùng, xem
// lib/recordStore.js, nên vẫn an toàn dù hiếm khi xảy ra).
//
// SAU KHI CHẠY XONG (--confirm): khởi động lại ứng dụng (pm2 restart) để xoá cache collection
// itSupportTickets trong bộ nhớ.
//
// CHẠY NHƯ THẾ NÀO (từ thư mục server/, .env phải có sẵn ở đó — script tự nạp qua db.js):
//   1. node scripts/backfill-itsupporttickets-code.js            -> chỉ LIỆT KÊ & XEM TRƯỚC (dry-run).
//   2. node scripts/backfill-itsupporttickets-code.js --confirm  -> GHI THẬT.

const { getPool, sql } = require('../db');
const { dedicatedTableName } = require('../lib/recordStore');
const { getAppDataValue } = require('../lib/appData');
const recordCodeGen = require('../lib/recordCodeGen');

async function main() {
  const confirm = process.argv.includes('--confirm');
  const pool = await getPool();
  const table = dedicatedTableName('itSupportTickets');
  const deptAbbrs = await getAppDataValue('deptAbbrs');

  console.log(confirm
    ? '🚀 GHI THẬT — sẽ điền "Mã Yêu Cầu" (Code) cho các ticket đang thiếu, theo đúng thứ tự tạo.'
    : 'ℹ️  DRY-RUN — chỉ liệt kê, CHƯA ghi gì. Chạy lại với --confirm để ghi thật.');

  const result = await pool.request().query(`SELECT Id, Code, Dept, Payload FROM ${table} ORDER BY Id ASC`);
  const rows = result.recordset;
  // codeTracker: trạng thái Code hiện có CỦA TỪNG DÒNG theo đúng thứ tự — generateHcrcCode() tính "số
  // lớn nhất từng thấy +1" trên mảng này, nên khi gán Code mới cho dòng i, PHẢI cập nhật lại codeTracker[i]
  // NGAY để dòng i+1 (nếu cùng Phòng Ban) thấy đúng số vừa dùng, không trùng nhau trong CÙNG lượt chạy.
  const codeTracker = rows.map(r => ({ code: r.Code || null }));

  let totalChanged = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.Code) continue; // đã có Code từ trước — bỏ qua (idempotent)
    let item;
    try { item = JSON.parse(row.Payload); } catch (e) { console.log(`\n⛔ Ticket Id=${row.Id}: Payload lỗi, bỏ qua.`); continue; }
    const dept = row.Dept || item.dept || '';
    const newCode = recordCodeGen.generateHcrcCode(codeTracker, { deptAbbrs }, dept, 'ITHT');
    codeTracker[i].code = newCode;
    totalChanged++;
    console.log(`\n📋 Ticket Id=${row.Id} (Phòng Ban "${dept}" — "${item.title || ''}"): Mã Yêu Cầu sẽ gán = "${newCode}"`);
    if (confirm) {
      item.code = newCode;
      await pool.request()
        .input('id', sql.BigInt, row.Id)
        .input('code', sql.NVarChar(100), newCode)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(item))
        .query(`UPDATE ${table} SET Code = @code, Payload = @payload WHERE Id = @id`);
    }
  }

  if (!totalChanged) {
    console.log('\n✅ Không có gì cần sửa — mọi ticket đều đã có Mã Yêu Cầu.');
  } else if (!confirm) {
    console.log(`\nℹ️  Đây là DRY-RUN — ${totalChanged} ticket sẽ được gán Mã Yêu Cầu nếu chạy lại với --confirm. Chưa ghi gì cả.`);
  } else {
    console.log(`\n✅ Đã ghi xong — ${totalChanged} ticket đã có Mã Yêu Cầu. Nhớ khởi động lại ứng dụng (pm2 restart) để xoá cache.`);
  }

  await pool.close();
}

module.exports = { main };

if (require.main === module) {
  main().catch(err => {
    console.error('⛔ Lỗi khi chạy script backfill Mã Yêu Cầu itSupportTickets:', err);
    process.exit(1);
  });
}
