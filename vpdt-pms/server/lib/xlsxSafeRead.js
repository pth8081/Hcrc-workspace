// lib/xlsxSafeRead.js — Đọc file .xlsx người dùng tải lên một cách AN TOÀN trước "zip bomb" (tệp nén
// nhỏ nhưng bung ra hàng GB), dùng chung cho toàn bộ 6 luồng import Excel: lib/priceFileParser.js,
// lib/trainingRoster.js, lib/budgetTemplateImport.js, lib/trainingPlanImport.js,
// lib/storeCatalogImport.js, lib/vppCatalog.js.
//
// VẤN ĐỀ CŨ: mọi luồng đều gọi `await workbook.xlsx.load(buffer)` TRƯỚC rồi mới áp giới hạn số dòng
// (1000/500/2000...) lúc duyệt worksheet đã nạp xong. Vì .xlsx thực chất là 1 file .zip, một tệp chỉ vài
// trăm KB (lọt qua giới hạn 20MB của multer, lại là file zip/xlsx THẬT nên qua luôn lib/fileSignature.js)
// có thể bung ra hàng GB XML; `xlsx.load()` giải nén + dựng object cho TỪNG Ô rồi mới tới lượt giới hạn
// số dòng chạy => hết RAM, PM2 restart worker. Ai có quyền upload ở bất kỳ luồng nào ở trên đều khai
// thác được.
//
// HAI LỚP BẢO VỆ Ở ĐÂY (cần CẢ HAI, thiếu 1 lớp là vẫn thủng):
//
// 1) assertDecompressedSizeWithinBudget() — giải nén thử toàn bộ archive bằng jszip theo kiểu STREAM,
//    ĐẾM số byte bung ra và DỪNG ngay khi vượt ngưỡng MAX_UNCOMPRESSED_BYTES. Không tin số
//    "uncompressedSize" khai trong header zip (kẻ tấn công sửa được), mà đếm byte thật sự bung ra, nên
//    chặn được cả bomb khai gian kích thước. Bộ nhớ dùng ở bước này không đổi (chunk bị bỏ đi ngay).
//    LỚP NÀY LÀ BẮT BUỘC vì ExcelJS.stream.xlsx.WorkbookReader (xem dưới) KHÔNG tự bảo vệ: nó ghi
//    NGUYÊN sheet XML ra file tạm rồi mới phát từng dòng, tức bomb chỉ chuyển từ "hết RAM" sang "đầy đĩa
//    /tmp" chứ không bị chặn.
//
// 2) streamFirstSheetRows() — đọc dòng bằng ExcelJS.stream.xlsx.WorkbookReader (API streaming có sẵn của
//    exceljs 4.x) thay cho workbook.xlsx.load(): mỗi dòng được dựng object rồi trả về cho caller NGAY,
//    caller trả về `false` là dừng đọc luôn. Nhờ đó giới hạn số dòng của từng luồng import chạy TRONG LÚC
//    đọc chứ không phải sau khi đã nạp hết sheet vào RAM. Chỉ với lớp 1 mà vẫn dùng load() thì 32MB XML
//    vẫn nở thành hàng trăm MB object JS, nên vẫn cần lớp 2.
//
// GIỮ NGUYÊN HÀNH VI: callback nhận đúng mảng ô mà `row.eachCell({ includeEmpty: true })` cho ra trước
// đây, và tuỳ chọn `includeEmpty` mô phỏng đúng 2 kiểu `sheet.eachRow()` mà 6 file kia đang dùng
// (xem chú thích ở streamFirstSheetRows()).
const { Readable } = require('stream');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { HttpError } = require('./httpErrors');

// Trần tổng dung lượng sau giải nén của TOÀN BỘ archive. Mọi luồng import ở đây đều chặn ở mức 500-2000
// dòng dữ liệu, tức file hợp lệ "kịch trần" cũng chỉ cỡ trên dưới 10MB XML — 32MiB đã dư gấp mấy lần cho
// file thật, trong khi vẫn giữ mức RAM/đĩa tệ nhất của 1 request ở mức chấp nhận được.
const MAX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

const TOO_BIG_MESSAGE =
  'File Excel này giải nén ra quá lớn (nghi vấn tệp nén độc hại) — vui lòng nộp file dữ liệu bình thường.';

// Giải nén thử từng entry trong archive, đếm byte thật bung ra, vượt ngưỡng là dừng + báo lỗi 400.
// jszip chỉ ĐỌC MỤC LỤC ở loadAsync() (không giải nén gì), việc giải nén xảy ra ở internalStream() bên
// dưới và bị chặn lại bằng pause() ngay khi vượt ngưỡng nên không bao giờ bung hết 1 bomb.
async function assertDecompressedSizeWithinBudget(buffer) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    throw new HttpError(400, 'Không đọc được file Excel (tệp hỏng hoặc không đúng định dạng .xlsx)');
  }

  const entries = [];
  zip.forEach((relPath, file) => { if (!file.dir) entries.push(file); });

  let total = 0;
  for (const file of entries) {
    let overBudget = false;
    await new Promise((resolve, reject) => {
      const stream = file.internalStream('nodebuffer');
      stream.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_UNCOMPRESSED_BYTES && !overBudget) {
          overBudget = true;
          stream.pause(); // jszip kéo dữ liệu theo nhịp resume() -> pause() là ngừng hẳn việc giải nén
          resolve();
        }
      });
      stream.on('error', reject);
      stream.on('end', resolve);
      stream.resume();
    });
    if (overBudget) throw new HttpError(400, TOO_BIG_MESSAGE);
  }
}

// streamFirstSheetRows(buffer, onRow, options)
//   onRow(cells, rowNumber) — gọi cho từng dòng của worksheets[0] theo đúng thứ tự; trả về `false` để
//     DỪNG đọc (giới hạn số dòng của caller), giá trị khác coi như đọc tiếp. Ném lỗi trong onRow cũng
//     dừng đọc và lỗi được ném tiếp ra ngoài như thường.
//   options.includeEmpty — mô phỏng `sheet.eachRow({ includeEmpty })`:
//     false (mặc định): bỏ qua dòng KHÔNG có giá trị nào (đúng như eachRow bỏ qua row.hasValues === false).
//     true: giữ cả dòng trống — dòng không tồn tại trong XML được bù bằng mảng rỗng để caller vẫn thấy
//       đúng "ranh giới dòng trống" (lib/budgetTemplateImport.js dựa vào đó để biết chỗ hết dữ liệu).
//   options.raw — false (mặc định): mỗi ô đổi sang String như code cũ; true: giữ NGUYÊN giá trị gốc
//     (lib/trainingPlanImport.js cần phân biệt ô kiểu Date thật với chuỗi text).
async function streamFirstSheetRows(buffer, onRow, options = {}) {
  const includeEmpty = !!options.includeEmpty;
  const raw = !!options.raw;

  await assertDecompressedSizeWithinBudget(buffer);

  const input = Readable.from([buffer]);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(input, {
    worksheets: 'emit',
    sharedStrings: 'cache', // cần để ô kiểu chuỗi dùng bảng sharedStrings đọc ra đúng nội dung
    styles: 'cache',        // cần để ô định dạng ngày đọc ra Date đúng như workbook.xlsx.load() trước đây
    hyperlinks: 'ignore',
    entries: 'ignore'
  });

  let sawSheet = false;
  let done = false;
  try {
    // KHÔNG `break` vòng lặp worksheet: exceljs dọn file tạm của từng sheet ngay sau khi caller xin sheet
    // kế tiếp, thoát sớm sẽ để lại rác trong thư mục tạm sau MỖI lần import file nhiều sheet (mẫu Kế
    // Hoạch Đào Tạo có sheet "Ghi Chú" đi kèm). Chỉ đọc dòng của sheet ĐẦU TIÊN, các sheet sau bỏ qua.
    for await (const worksheet of reader) {
      if (done) continue;
      sawSheet = true;
      let expected = 1;
      for await (const row of worksheet) {
        if (includeEmpty) {
          while (expected < row.number) {
            if (onRow([], expected++) === false) { done = true; break; }
          }
          if (done) break;
          expected = row.number + 1;
        } else if (!row.hasValues) {
          continue;
        }
        const cells = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          cells.push(cell.value == null ? '' : (raw ? cell.value : String(cell.value)));
        });
        if (onRow(cells, row.number) === false) { done = true; break; }
      }
      done = true;
    }
  } finally {
    input.destroy();
  }

  if (!sawSheet) throw new HttpError(400, 'File Excel không có sheet dữ liệu nào');
}

module.exports = { streamFirstSheetRows, assertDecompressedSizeWithinBudget, MAX_UNCOMPRESSED_BYTES };
