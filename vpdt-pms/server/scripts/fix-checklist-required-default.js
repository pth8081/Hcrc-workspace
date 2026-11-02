// scripts/fix-checklist-required-default.js — Script MỘT LẦN, chạy thủ công SAU KHI đã deploy code bản
// vá v28.83 (nút "Bắt Buộc Tất Cả"/"Bỏ Bắt Buộc Tất Cả" ở builder câu hỏi Checklist). Vá đúng 1 vấn đề
// cụ thể người dùng báo (kèm ảnh chụp thật): mẫu "Checklist Hàng Ngày GĐST/CHT (Tự Đánh Giá)" (mã
// CL_STCH_DAILY, seedChecklistStoreSelfDaily.js) được dựng sẵn tự động lúc khởi động server đầu tiên —
// file dữ liệu gốc KHÔNG hề đặt cờ "Bắt buộc" cho câu nào, nhưng validateChecklistQuestions()
// (lib/checklist.js) mặc định MỌI câu không nói rõ -> Bắt buộc = true, nên cả 49 câu bị đóng dấu Bắt
// buộc ngay từ lúc tạo (DRAFT). Người dùng kích hoạt mẫu này mà không gỡ tay 49 checkbox (chưa có nút
// gỡ hàng loạt trước bản vá này) -> route Nộp Bài (assertReadyToFinalize(), lib/checklist.js) chặn cứng
// nhân viên siêu thị không nộp được bài trừ khi trả lời ĐỦ cả 49 câu, trái đúng yêu cầu người dùng đã
// chốt trước đây ("làm đến đâu tính đến đó, không bắt buộc làm hết").
//
// PHẠM VI CỐ Ý THU HẸP (theo đúng yêu cầu người dùng "đừng để lan lỗi sang vùng khác"): script CHỈ
// đụng tới ĐÚNG 1 mẫu, đúng mã CL_STCH_DAILY, đúng bản ĐANG ACTIVE (bản dùng cho bài nộp MỚI) — KHÔNG
// đụng tới bất kỳ mẫu nào khác (VD mẫu VSATTP loại SCORED cố ý giữ nguyên câu bắt buộc, vì đó là
// checklist tuân thủ an toàn thực phẩm, không phải tự đánh giá hàng ngày) và KHÔNG đụng tới các bản
// DRAFT/ARCHIVED cũ của CHÍNH mã này (giữ nguyên lịch sử, chỉ sửa bản đang thực sự được dùng).
//
// AN TOÀN — chỉ đổi field isRequired của từng câu hỏi trong mảng `questions`, KHÔNG đụng field nào khác
// (text/options/category/showIfOptionId/maxScore... giữ nguyên y hệt), KHÔNG xoá/thêm bản ghi nào:
//   - Idempotent — chạy lại nhiều lần an toàn: câu nào đã isRequired:false thì không còn khớp điều
//     kiện "cần sửa" ở lần chạy sau, tự động bỏ qua.
//
// KHUYẾN NGHỊ BẮT BUỘC trước khi chạy trên server thật: sao lưu CSDL trước.
// SAU KHI CHẠY XONG (--confirm): khởi động lại ứng dụng (pm2 restart) để xoá cache AppData/collection
// trong bộ nhớ (checklistTemplates được cache theo tiến trình, không tự nhận state mới ghi trực tiếp
// xuống CSDL từ 1 tiến trình script riêng).
//
// CHẠY NHƯ THẾ NÀO (từ thư mục server/, .env phải có sẵn ở đó — script tự nạp qua db.js):
//   1. node scripts/fix-checklist-required-default.js            -> chỉ LIỆT KÊ & XEM TRƯỚC (dry-run).
//   2. node scripts/fix-checklist-required-default.js --confirm  -> GHI THẬT.

const { getPool, sql } = require('../db');
const { dedicatedTableName } = require('../lib/recordStore');

const TARGET_TEMPLATE_CODE = 'CL_STCH_DAILY';
const TARGET_STATUS = 'ACTIVE';

// Trả về { item, changedCount, changes } — `item` đã bị MUTATE trực tiếp nếu có thay đổi (an toàn gọi
// cả ở dry-run vì chỉ JSON.stringify lại khi confirm=true ở processRow(), không ghi gì ở đây).
function unmarkAllQuestionsRequired(item) {
  const changes = [];
  const questions = Array.isArray(item?.questions) ? item.questions : [];
  questions.forEach((q, i) => {
    if (q && q.isRequired !== false) {
      changes.push({ index: i, text: q.text, before: q.isRequired === undefined ? '(mặc định true)' : q.isRequired, after: false });
      q.isRequired = false;
    }
  });
  return changes;
}

async function processRow(pool, table, row, confirm) {
  let item;
  try { item = JSON.parse(row.Payload); } catch (e) { return null; }
  const changes = unmarkAllQuestionsRequired(item);
  if (!changes.length) return { id: row.Id, changes: [] };
  if (confirm) {
    await pool.request()
      .input('id', sql.BigInt, row.Id)
      .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(item))
      .query(`UPDATE ${table} SET Payload = @payload WHERE Id = @id`);
  }
  return { id: row.Id, changes };
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const pool = await getPool();
  const table = dedicatedTableName('checklistTemplates');

  console.log(confirm
    ? `🚀 GHI THẬT — sẽ gỡ cờ "Bắt buộc" của mọi câu hỏi trong mẫu "${TARGET_TEMPLATE_CODE}" (bản ${TARGET_STATUS}).`
    : 'ℹ️  DRY-RUN — chỉ liệt kê, CHƯA ghi gì. Chạy lại với --confirm để ghi thật.');

  const result = await pool.request()
    .input('code', sql.NVarChar(50), TARGET_TEMPLATE_CODE)
    .input('status', sql.NVarChar(20), TARGET_STATUS)
    .query(`SELECT Id, Payload FROM ${table} WHERE TemplateCode = @code AND Status = @status`);

  const rows = result.recordset;
  if (!rows.length) {
    console.log(`\n⚠️  Không tìm thấy mẫu "${TARGET_TEMPLATE_CODE}" ở trạng thái ${TARGET_STATUS} — không có gì để sửa (có thể đã bị Lưu Trữ/đổi mã, hoặc chưa từng Kích Hoạt).`);
    await pool.close();
    return;
  }
  if (rows.length > 1) {
    console.log(`\n⚠️  CẢNH BÁO: tìm thấy ${rows.length} bản ĐANG ACTIVE cùng mã "${TARGET_TEMPLATE_CODE}" — đáng lẽ chỉ có đúng 1 bản ACTIVE tại 1 thời điểm. Xử lý CẢ ${rows.length} bản, nhưng nên kiểm tra lại dữ liệu sau khi chạy.`);
  }

  let totalChanged = 0;
  for (const row of rows) {
    const r = await processRow(pool, table, row, confirm);
    if (!r) { console.log(`\n⛔ Bản ghi Id=${row.Id}: Payload lỗi, bỏ qua.`); continue; }
    if (!r.changes.length) {
      console.log(`\n✅ Bản ghi Id=${row.Id}: mọi câu hỏi đã isRequired:false từ trước — không cần sửa.`);
      continue;
    }
    totalChanged += r.changes.length;
    console.log(`\n📋 Bản ghi Id=${row.Id}: ${r.changes.length} câu hỏi sẽ gỡ "Bắt buộc":`);
    r.changes.slice(0, 5).forEach(c => console.log(`   [#${c.index + 1}] "${c.text}" — Bắt buộc ${c.before} -> ${c.after}`));
    if (r.changes.length > 5) console.log(`   ... và ${r.changes.length - 5} câu khác.`);
  }

  if (!totalChanged) {
    console.log('\n✅ Không có gì cần sửa.');
  } else if (!confirm) {
    console.log(`\nℹ️  Đây là DRY-RUN — ${totalChanged} câu hỏi sẽ được gỡ "Bắt buộc" nếu chạy lại với --confirm. Chưa ghi gì cả.`);
  } else {
    console.log(`\n✅ Đã ghi xong — ${totalChanged} câu hỏi không còn Bắt buộc. Nhớ khởi động lại ứng dụng (pm2 restart) để xoá cache.`);
  }

  await pool.close();
}

module.exports = { unmarkAllQuestionsRequired, TARGET_TEMPLATE_CODE, TARGET_STATUS, main };

if (require.main === module) {
  main().catch(err => {
    console.error('⛔ Lỗi khi chạy script vá cờ Bắt buộc checklist:', err);
    process.exit(1);
  });
}
