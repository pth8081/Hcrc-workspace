// lib/adminExport.js — Sinh file Excel (.xlsx) DÙNG CHUNG cho các màn xuất dữ liệu ở khu vực Quản Trị
// (Người dùng, Nhật ký hệ thống, Báo Cáo Quản Trị) — trước đây mỗi màn tự dựng chuỗi CSV bằng tay ở
// client, thiếu BOM UTF-8 ở 2/3 chỗ nên tiếng Việt có dấu bị vỡ font khi mở bằng Excel, lại không có
// định dạng (không in đậm dòng tiêu đề, không set độ rộng cột...). Dùng lại đúng thư viện đã có sẵn
// trong app (exceljs, xem lib/vppExport.js) thay vì tự viết CSV — sinh file .xlsx thật nên không còn
// khái niệm mã hoá ký tự phải lo nữa.
const ExcelJS = require('exceljs'); // chỉ còn dùng để SINH file .xlsx xuất ra; đọc file upload đi qua lib/xlsxSafeRead.js
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

// columns: [{header, key, width}], rows: [{key: value, ...}, ...] — khớp đúng API "sheet.columns" +
// "sheet.addRow(obj)" của exceljs, dùng lại được cho MỌI màn xuất Excel đơn giản (1 sheet, không cần
// công thức/style phức tạp) mà không phải viết riêng từng hàm dựng workbook như VPP (vốn có 2 sheet
// và cách tính tổng hợp riêng, không dùng chung được).
function buildGenericWorkbook(sheetName, columns, rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(String(sheetName || 'Sheet1').slice(0, 31)); // Excel giới hạn tên sheet 31 ký tự
  sheet.columns = columns.map(c => ({ header: String(c.header ?? ''), key: String(c.key ?? ''), width: Number(c.width) || 18 }));
  styleHeaderRow(sheet.getRow(1));
  rows.forEach(r => sheet.addRow(r));
  return wb;
}

// ===== Import Người dùng (.xlsx) =====
// Cột cố định theo ĐÚNG thứ tự file mẫu do chính hệ thống sinh ra (xem downloadUserTemplate() ở
// index.html) — khác lib/vppCatalog.js (phải dò tiêu đề linh hoạt vì file do từng phòng ban tự làm),
// file này luôn xuất phát từ file mẫu của hệ thống nên dò theo TÊN CỘT cố định (không phân biệt hoa
// thường) là đủ, không cần bộ dò linh hoạt như danh mục VPP.
const USER_IMPORT_COLUMNS = ['username', 'pass', 'name', 'email', 'phone', 'dept', 'jobtitle'];

// Trần số dòng người dùng đọc trong 1 lần import — cùng tinh thần giới hạn 500/1000/2000 dòng của 6
// luồng import Excel còn lại, và nay chặn NGAY TRONG LÚC đọc (xem streamFirstSheetRows) chứ không phải
// sau khi đã nạp cả sheet vào RAM.
const MAX_USER_IMPORT_ROWS = 2000;

// Đọc theo DÒNG (lib/xlsxSafeRead.js) thay vì nạp cả sheet vào RAM bằng workbook.xlsx.load().
//
// LỖ HỔNG ĐƯỢC VÁ: đây là luồng import Excel THỨ 7, nhưng lại là luồng DUY NHẤT còn gọi thẳng
// wb.xlsx.load(buffer) — bỏ qua toàn bộ lớp chống "zip bomb" mà lib/xlsxSafeRead.js đã dựng cho 6 luồng
// kia (priceFileParser/trainingRoster/budgetTemplateImport/trainingPlanImport/storeCatalogImport/
// vppCatalog). Một file .xlsx vài trăm KB (lọt giới hạn 20MB của multer, lại là file .xlsx THẬT nên qua
// luôn lib/fileSignature.js) bung ra hàng GB XML là đủ làm hết RAM và PM2 restart worker.
//
// Logic dò cột/vị trí/bỏ dòng thiếu username giữ Y NGUYÊN, chỉ đổi chỉ số cột từ 1-based (quy ước
// row.getCell của exceljs) sang 0-based (mảng `cells` mà streamFirstSheetRows trả về).
async function parseUsersImportXlsx(buffer) {
  const colIndex = {}; // tên cột (thường hoá) -> chỉ số trong mảng cells (0-based)
  let headerSeen = false;
  let usePositional = false;
  let overLimit = false;
  const rows = [];

  const get = (cells, name) => {
    const idx = colIndex[name];
    if (idx === undefined) return '';
    const v = cells[idx];
    return v == null ? '' : String(v).trim();
  };

  const take = (cells) => {
    const username = get(cells, 'username');
    if (!username) return; // dòng trống hoặc thiếu username -> bỏ qua, không tạo user rỗng
    rows.push({
      username,
      pass: get(cells, 'pass'),
      name: get(cells, 'name'),
      email: get(cells, 'email'),
      phone: get(cells, 'phone'),
      dept: get(cells, 'dept'),
      jobTitle: get(cells, 'jobtitle') || null
    });
  };

  await streamFirstSheetRows(buffer, (cells) => {
    if (!headerSeen) {
      headerSeen = true;
      cells.forEach((cell, i) => {
        const h = String(cell ?? '').trim().toLowerCase();
        if (USER_IMPORT_COLUMNS.includes(h)) colIndex[h] = i;
      });
      // Không nhận diện được tiêu đề nào khớp -> rơi về vị trí cột mặc định của file mẫu (username,
      // pass, name, email, phone, dept, jobTitle theo đúng thứ tự 1-7), phòng trường hợp người dùng lỡ
      // xoá dòng tiêu đề khi chỉnh sửa file — khi đó dòng 1 cũng là DỮ LIỆU THẬT, phải đọc luôn.
      usePositional = Object.keys(colIndex).length === 0;
      if (usePositional) {
        USER_IMPORT_COLUMNS.forEach((name, i) => { colIndex[name] = i; });
        take(cells);
      }
    } else {
      take(cells);
    }
    if (rows.length > MAX_USER_IMPORT_ROWS) { overLimit = true; return false; }
    return true;
  });

  if (overLimit) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_USER_IMPORT_ROWS} người dùng/lần)`);
  return rows;
}

module.exports = { buildGenericWorkbook, parseUsersImportXlsx, USER_IMPORT_COLUMNS };
