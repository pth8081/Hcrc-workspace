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

// LỖI ĐÃ VÁ (rà soát chuyên sâu 4-agent song song, 9/2026): race condition CÓ THẬT bên trong chính
// ExcelJS.stream.xlsx.WorkbookReader (node_modules/exceljs/lib/stream/xlsx/workbook-reader.js,
// _parseWorksheet() đọc `this.model.sheets` trước khi `this.model` kịp gán xong — workbook.xml (nơi gán
// this.model) luôn được exceljs parse SAU CÙNG trong 1 file .xlsx nhiều sheet, còn các sheet khác bị dồn
// vào hàng đợi `waitingWorkSheets` xử lý lại SAU đó; đúng lúc xử lý lại hàng đợi này có thể chạm
// this.model trước khi nó kịp gán xong) — ném TypeError "Cannot read properties of undefined (reading
// 'sheets')". Đo thực tế: tỷ lệ lỗi tăng theo SỐ SHEET (không theo số dòng), ảnh hưởng trực tiếp Ma Trận
// Phân Quyền (nhiều sheet, ~40-68% mỗi lượt) và cả Ngân Sách/Checklist/Hồ Sơ NV/Đào Tạo (mẫu tải về có
// kèm sheet "Ghi Chú" thứ 2). Không sửa được tận gốc (lỗi nằm trong exceljs, không phải code ở đây) —
// Bọc RETRY có giới hạn: gọi lại TOÀN BỘ 1 lượt đọc (buffer đã có sẵn trong RAM, đọc lại không tốn kém),
// nhưng để KHÔNG gọi trùng onRow(...) của caller (rủi ro dòng đôi nếu lỗi rơi vào sheet thứ 2 trở đi, SAU
// KHI sheet 1 đã phát hết dòng cho onRow ở lượt trước) — mỗi lượt đọc dồn kết quả vào 1 mảng nội bộ
// TRƯỚC, chỉ phát lại cho onRow thật của caller đúng 1 LẦN DUY NHẤT sau khi cả lượt đọc đó thành công
// trọn vẹn. Chỉ retry đúng lỗi TypeError này (giữ nguyên hành vi ném lỗi cho mọi lỗi khác, VD HttpError
// zip bomb/file hỏng — không retry những lỗi đó).
// 8 lượt (không phải 3): đo thực tế tỷ lệ lỗi/lượt có thể lên tới ~68% với file 5 sheet — 3 lượt vẫn còn
// ~31% khả năng CẢ 3 cùng dính lỗi (0.68^3), 8 lượt kéo xuống còn ~2% (0.68^8), đủ an toàn cho Ma Trận
// Phân Quyền (nơi đo được tỷ lệ lỗi/lượt cao nhất). Retry rẻ (chỉ đọc lại buffer đã có sẵn trong RAM).
const EXCELJS_STREAM_RETRY_ATTEMPTS = 8;
async function runExceljsStreamWithRetry(attemptFn) {
  let lastErr;
  for (let i = 0; i < EXCELJS_STREAM_RETRY_ATTEMPTS; i++) {
    try {
      return await attemptFn();
    } catch (err) {
      if (!(err instanceof TypeError) || i === EXCELJS_STREAM_RETRY_ATTEMPTS - 1) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

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
//   options.withNumFmt — false (mặc định, giữ nguyên hành vi cũ cho 5 luồng import khác): true thì
//     onRow() nhận thêm tham số thứ 3 `numFmts` (mảng numFmt gốc của Excel, cùng vị trí với `cells`,
//     VD "0.00%") — lib/priceFileParser.js cần nó để biết 1 ô % đang lưu dạng PHÂN SỐ (0.12345) hay số
//     phần trăm thật (12.345), tránh đọc nhầm/làm tròn sai (xem percentFromFraction() ở priceFileParser.js).
async function streamFirstSheetRows(buffer, onRow, options = {}) {
  const includeEmpty = !!options.includeEmpty;
  const raw = !!options.raw;
  const withNumFmt = !!options.withNumFmt;

  await assertDecompressedSizeWithinBudget(buffer);

  // Đọc dồn vào mảng nội bộ `rows` bên trong 1 lượt thử (attemptFn) thay vì gọi thẳng onRow() của caller
  // ngay trong lúc đọc — xem chú thích đầy đủ ở runExceljsStreamWithRetry() (đầu file): retry an toàn,
  // không phát trùng dòng cho caller nếu phải thử lại.
  const rows = await runExceljsStreamWithRetry(async () => {
    const collected = [];
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
            while (expected < row.number) collected.push({ cells: [], rowNumber: expected++ });
            expected = row.number + 1;
          } else if (!row.hasValues) {
            continue;
          }
          const cells = [];
          const numFmts = withNumFmt ? [] : null;
          row.eachCell({ includeEmpty: true }, (cell) => {
            cells.push(cell.value == null ? '' : (raw ? cell.value : String(cell.value)));
            if (numFmts) numFmts.push(cell.numFmt || null);
          });
          collected.push({ cells, numFmts, rowNumber: row.number });
        }
        done = true;
      }
    } finally {
      input.destroy();
    }

    if (!sawSheet) throw new HttpError(400, 'File Excel không có sheet dữ liệu nào');
    return collected;
  });

  for (const r of rows) {
    if (onRow(r.cells, r.rowNumber, r.numFmts || undefined) === false) break;
  }
}

// streamAllSheetsRows(buffer, onRow, options)
//   Biến thể của streamFirstSheetRows() ở trên, đọc HẾT mọi sheet thay vì chỉ sheet đầu tiên (dùng cho
//   Ma Trận Phân Quyền đa sheet — mỗi sheet là 1 khối quyền, xem lib/permMatrixExcel.js). Cùng 2 lớp bảo
//   vệ chống zip bomb (assertDecompressedSizeWithinBudget ở trên, áp dụng 1 LẦN cho toàn bộ archive bất
//   kể bao nhiêu sheet — không cần nhân thêm ngưỡng theo số sheet vì đây vẫn là tổng dung lượng giải nén
//   thật của CẢ file) + đọc bằng streaming reader (không nạp cả sheet vào RAM).
//   onRow(sheetName, cells, rowNumber) — gọi cho từng dòng của MỖI sheet theo đúng thứ tự sheet trong
//     workbook rồi tới thứ tự dòng trong sheet đó; trả về `false` để DỪNG HẲN việc đọc (mọi sheet còn
//     lại bị bỏ qua luôn, không riêng sheet hiện tại) — caller tự đếm tổng số dòng/định danh đã thấy để
//     quyết định lúc nào dừng (xem MAX_MATRIX_IMPORT_ROWS ở lib/permMatrixExcel.js).
//   options — giống hệt streamFirstSheetRows() (includeEmpty/raw).
async function streamAllSheetsRows(buffer, onRow, options = {}) {
  const includeEmpty = !!options.includeEmpty;
  const raw = !!options.raw;
  // LỖI ĐÃ VÁ (đợt audit v25.51→v25.63, DoS): trước đây TOÀN BỘ dòng của MỌI sheet (kể cả sheet
  // KHÔNG khớp tên nào caller cần, VD 1 sheet rác thêm vào file) đều bị buffer hết vào `collected`
  // TRƯỚC KHI onRow() thật của caller (nơi lọc "sheet lạ") được gọi — mâu thuẫn với chính thiết kế
  // "giới hạn số dòng TRONG LÚC đọc" đã công bố ở đầu file. Tham số tuỳ chọn `shouldCollectSheet(name)`
  // cho phép caller BỎ QUA sheet lạ NGAY TẠI ĐÂY (không đọc/buffer dòng nào của sheet đó) — opt-in, mặc
  // định không lọc gì (giữ nguyên hành vi cũ cho caller chưa truyền, VD permMatrixExcel.js chấp nhận
  // MỌI tên sheet theo đúng thiết kế của nó).
  const shouldCollectSheet = typeof options.shouldCollectSheet === 'function' ? options.shouldCollectSheet : null;

  await assertDecompressedSizeWithinBudget(buffer);

  // Đọc dồn vào mảng nội bộ trước khi phát cho onRow() thật của caller — cùng lý do/cơ chế retry an toàn
  // đã áp dụng ở streamFirstSheetRows() (xem chú thích runExceljsStreamWithRetry() đầu file); module này
  // (Ma Trận Phân Quyền, nhiều sheet) là nơi đo được tỷ lệ lỗi cao nhất (~40-68%).
  const rows = await runExceljsStreamWithRetry(async () => {
    const collected = [];
    const input = Readable.from([buffer]);
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(input, {
      worksheets: 'emit',
      sharedStrings: 'cache',
      styles: 'cache',
      hyperlinks: 'ignore',
      entries: 'ignore'
    });

    let sawSheet = false;
    let done = false;
    try {
      for await (const worksheet of reader) {
        if (done) continue; // KHÔNG break — xem chú thích ở streamFirstSheetRows() (dọn file tạm exceljs)
        sawSheet = true;
        const sheetName = worksheet.name || `Sheet${worksheet.id || ''}`;
        if (shouldCollectSheet && !shouldCollectSheet(sheetName)) continue; // bỏ qua sheet lạ, không buffer dòng nào
        let expected = 1;
        for await (const row of worksheet) {
          if (includeEmpty) {
            while (expected < row.number) collected.push({ sheetName, cells: [], rowNumber: expected++ });
            expected = row.number + 1;
          } else if (!row.hasValues) {
            continue;
          }
          const cells = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            cells.push(cell.value == null ? '' : (raw ? cell.value : String(cell.value)));
          });
          collected.push({ sheetName, cells, rowNumber: row.number });
        }
      }
    } finally {
      input.destroy();
    }

    if (!sawSheet) throw new HttpError(400, 'File Excel không có sheet dữ liệu nào');
    return collected;
  });

  for (const r of rows) {
    if (onRow(r.sheetName, r.cells, r.rowNumber) === false) break;
  }
}

// Ô đọc ở chế độ raw (options.raw ở trên) có thể là Date, number, boolean, hoặc object của exceljs
// (richText / hyperlink / công thức) — quy về chuỗi hiển thị. Dùng chung cho mọi luồng import đọc raw
// (trước đây chỉ lib/objectCatalogImport.js có cặp hàm này, lib/priceFileParser.js tự String(cell.value)
// nên công thức/richText/hyperlink bị in ra "[object Object]" — chuyển về đây để dùng chung, tránh lặp).
function cellToText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(p => p.text || '').join('');
    if (v.text !== undefined) return cellToText(v.text);
    if (v.result !== undefined) return cellToText(v.result);
    if (v.error) return '';
    return '';
  }
  return String(v);
}

// Lấy giá trị "gốc" hữu ích của ô (bỏ lớp công thức) — cần cho time/date/number.
function cellRaw(v) {
  if (v && typeof v === 'object' && !(v instanceof Date) && v.result !== undefined) return v.result;
  return v;
}

module.exports = {
  streamFirstSheetRows, streamAllSheetsRows, assertDecompressedSizeWithinBudget, MAX_UNCOMPRESSED_BYTES,
  cellToText, cellRaw
};
