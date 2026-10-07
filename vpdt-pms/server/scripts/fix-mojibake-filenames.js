// scripts/fix-mojibake-filenames.js — Script MỘT LẦN, chạy thủ công SAU KHI đã deploy code bản vá
// mojibake (v25.45, lib/uploadFilename.js::fixUploadedFilename() + 16 route). Bản vá v25.45 CHỈ chặn
// được tên tệp MỚI tải lên từ nay về sau không còn bị lỗi — những bản ghi ĐÃ LƯU trước khi server được
// cập nhật code vẫn còn nguyên tên tệp bị lỗi font (VD "Test gia há°±n má»›i.xlsx" thay vì "Test gia
// hạn mới.xlsx") vì chuỗi SAI đã bị ghi thẳng vào CSDL — hiển thị lại không tự sửa được, phải DECODE
// LẠI đúng CHUỖI ĐÃ LƯU thì mới ra tên đúng. Script này quét mọi nơi có thể chứa field kết thúc bằng
// "fileName"/"filename" (fileName, bannerFileName, cvFileName, signedFileName, sourceFileName,
// thumbnailFileName, confirmFileName, lumpConfirmFileName, publishedFileName, catalogFileName...) ở
// CẢ 2 tầng lưu trữ hiện có:
//   1. Mọi bảng riêng trong lib/recordStore.js::DEDICATED_TABLES (cột Payload, 1 dòng/bản ghi).
//   2. dbo.AppData (cột DataValue, 1 dòng/khoá — gồm employeeProfiles và các danh mục khác).
//
// AN TOÀN — chỉ SỬA tên tệp, KHÔNG xoá/thêm bản ghi, KHÔNG đụng field nào khác:
//   - Chỉ coi 1 chuỗi là "nghi mojibake" khi MỌI ký tự trong chuỗi có code point <= 0xFF (dấu hiệu
//     chắc chắn: chuỗi này được sinh ra bằng cách lấy từng BYTE gốc rồi coi là 1 ký tự latin1 — tên
//     tệp tiếng Việt ĐÃ ĐÚNG thật sự (có dấu) luôn có code point > 0xFF nên KHÔNG BAO GIỜ khớp điều
//     kiện này, tự động được bỏ qua, không có rủi ro sửa nhầm tên đã đúng).
//   - Dùng LẠI chính fixUploadedFilename() (lib/uploadFilename.js, cùng hàm dùng khi tải tệp mới) —
//     hàm này tự kiểm tra kết quả decode có sinh ký tự lỗi U+FFFD không, có thì GIỮ NGUYÊN bản gốc.
//   - Idempotent — chạy lại nhiều lần an toàn: bản ghi đã đúng tên thì không còn khớp điều kiện trên,
//     tự động bỏ qua.
//
// KHUYẾN NGHỊ BẮT BUỘC trước khi chạy trên server thật: sao lưu CSDL trước.
// SAU KHI CHẠY XONG (--confirm): khởi động lại ứng dụng (pm2 restart) để xoá cache AppData trong bộ
// nhớ (employeeProfiles và các danh mục khác được cache theo tiến trình, không tự nhận state mới ghi
// trực tiếp xuống CSDL từ 1 tiến trình script riêng).
//
// CHẠY NHƯ THẾ NÀO (từ thư mục server/, .env phải có sẵn ở đó — script tự nạp qua db.js):
//   1. node scripts/fix-mojibake-filenames.js            -> chỉ LIỆT KÊ & XEM TRƯỚC (dry-run), KHÔNG ghi gì.
//   2. node scripts/fix-mojibake-filenames.js --confirm  -> GHI THẬT.

const { getPool, sql } = require('../db');
const { DEDICATED_TABLES, dedicatedTableName } = require('../lib/recordStore');
const { fixUploadedFilename } = require('../lib/uploadFilename');

const FILENAME_KEY_RE = /filename$/i;

function looksLikeMojibakeCandidate(str) {
  if (typeof str !== 'string' || !str) return false;
  for (let i = 0; i < str.length; i++) {
    if (str.charCodeAt(i) > 0xFF) return false;
  }
  return true;
}

function tryFixMojibake(str) {
  if (!looksLikeMojibakeCandidate(str)) return null;
  const fixed = fixUploadedFilename(str);
  return fixed !== str ? fixed : null;
}

// Đệ quy toàn bộ object/array, tự sửa TRỰC TIẾP trên `node` (mutate) — trả về mảng các thay đổi để
// báo cáo (before/after + đường dẫn key) cho người chạy script đối chiếu.
function walkAndFix(node, changes, path) {
  if (Array.isArray(node)) {
    node.forEach((item, idx) => walkAndFix(item, changes, `${path}[${idx}]`));
    return;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (typeof val === 'string' && FILENAME_KEY_RE.test(key)) {
        const fixed = tryFixMojibake(val);
        if (fixed) {
          changes.push({ path: `${path}.${key}`, before: val, after: fixed });
          node[key] = fixed;
        }
      } else if (val && typeof val === 'object') {
        walkAndFix(val, changes, `${path}.${key}`);
      }
    }
  }
}

async function processDedicatedTable(pool, collection, confirm) {
  const table = dedicatedTableName(collection);
  const result = await pool.request().query(`SELECT Id, Payload FROM ${table}`);
  const rows = result.recordset;
  let changedRows = 0;
  const examples = [];
  for (const row of rows) {
    let item;
    try { item = JSON.parse(row.Payload); } catch (e) { continue; }
    const changes = [];
    walkAndFix(item, changes, '$');
    if (!changes.length) continue;
    changedRows++;
    if (examples.length < 5) examples.push({ id: row.Id, changes });
    if (confirm) {
      await pool.request()
        .input('id', sql.BigInt, row.Id)
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(item))
        .query(`UPDATE ${table} SET Payload = @payload WHERE Id = @id`);
    }
  }
  return { name: collection, total: rows.length, changedRows, examples };
}

async function processAppDataKey(pool, dataKey, confirm) {
  const result = await pool.request()
    .input('k', sql.NVarChar(100), dataKey)
    .query('SELECT DataValue FROM dbo.AppData WHERE DataKey = @k');
  if (!result.recordset.length) return null;
  let value;
  try { value = JSON.parse(result.recordset[0].DataValue); } catch (e) { return null; }
  const changes = [];
  walkAndFix(value, changes, '$');
  if (!changes.length) return { name: `AppData:${dataKey}`, total: Array.isArray(value) ? value.length : 1, changedRows: 0, examples: [] };
  if (confirm) {
    await pool.request()
      .input('k', sql.NVarChar(100), dataKey)
      .input('v', sql.NVarChar(sql.MAX), JSON.stringify(value))
      .query('UPDATE dbo.AppData SET DataValue = @v, UpdatedAt = SYSUTCDATETIME() WHERE DataKey = @k');
  }
  return { name: `AppData:${dataKey}`, total: Array.isArray(value) ? value.length : 1, changedRows: changes.length, examples: [{ id: dataKey, changes: changes.slice(0, 5) }] };
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const pool = await getPool();

  console.log(confirm
    ? '🚀 GHI THẬT — sẽ decode lại mọi tên tệp nghi bị lỗi font (mojibake) đã lưu trong CSDL.'
    : 'ℹ️  DRY-RUN — chỉ liệt kê, CHƯA ghi gì. Chạy lại với --confirm để ghi thật.');

  const results = [];

  for (const collection of Object.keys(DEDICATED_TABLES)) {
    try {
      results.push(await processDedicatedTable(pool, collection, confirm));
    } catch (err) {
      console.error(`⛔ Lỗi khi xử lý bảng ${collection}:`, err.message);
    }
  }

  // Lấy toàn bộ khoá AppData hiện có thay vì liệt kê tay — tự động bắt kịp khoá mới phát sinh sau này.
  const appDataKeysResult = await pool.request().query('SELECT DataKey FROM dbo.AppData');
  for (const row of appDataKeysResult.recordset) {
    try {
      const r = await processAppDataKey(pool, row.DataKey, confirm);
      if (r) results.push(r);
    } catch (err) {
      console.error(`⛔ Lỗi khi xử lý AppData[${row.DataKey}]:`, err.message);
    }
  }

  const affected = results.filter(r => r.changedRows > 0);
  console.log(`\n📦 Đã quét ${results.length} nguồn dữ liệu (bảng riêng + khoá AppData).`);
  console.log(`   Nguồn có tên tệp cần sửa: ${affected.length}`);

  for (const r of affected) {
    console.log(`\n   📁 ${r.name} — ${r.changedRows}/${r.total} bản ghi có tên tệp lỗi font`);
    for (const ex of r.examples) {
      console.log(`      [Id=${ex.id}]`);
      for (const c of ex.changes) {
        console.log(`        ${c.path}: "${c.before}" -> "${c.after}"`);
      }
    }
  }

  if (!affected.length) {
    console.log('\n✅ Không tìm thấy tên tệp nào nghi bị lỗi font — không cần sửa gì.');
  } else if (!confirm) {
    console.log('\nℹ️  Đây là DRY-RUN — chưa ghi gì cả. Chạy lại với --confirm để ghi thật.');
  } else {
    console.log('\n✅ Đã ghi xong. Nhớ khởi động lại ứng dụng (pm2 restart) để xoá cache AppData trong bộ nhớ.');
  }

  await pool.close();
}

module.exports = { looksLikeMojibakeCandidate, tryFixMojibake, walkAndFix };

if (require.main === module) {
  main().catch(err => {
    console.error('⛔ Lỗi khi chạy script vá mojibake tên tệp:', err);
    process.exit(1);
  });
}
