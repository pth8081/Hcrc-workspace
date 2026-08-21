// lib/adminExport.js — Sinh file Excel (.xlsx) DÙNG CHUNG cho các màn xuất dữ liệu ở khu vực Quản Trị
// (Người dùng, Nhật ký hệ thống, Báo Cáo Quản Trị) — trước đây mỗi màn tự dựng chuỗi CSV bằng tay ở
// client, thiếu BOM UTF-8 ở 2/3 chỗ nên tiếng Việt có dấu bị vỡ font khi mở bằng Excel, lại không có
// định dạng (không in đậm dòng tiêu đề, không set độ rộng cột...). Dùng lại đúng thư viện đã có sẵn
// trong app (exceljs, xem lib/vppExport.js) thay vì tự viết CSV — sinh file .xlsx thật nên không còn
// khái niệm mã hoá ký tự phải lo nữa.
const ExcelJS = require('exceljs');

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

async function parseUsersImportXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('File Excel không có sheet dữ liệu nào');

  const headerRow = sheet.getRow(1);
  const colIndex = {}; // tên cột (thường hoá) -> số thứ tự cột (1-based, đúng quy ước exceljs)
  headerRow.eachCell((cell, colNumber) => {
    const h = String(cell.value ?? '').trim().toLowerCase();
    if (USER_IMPORT_COLUMNS.includes(h)) colIndex[h] = colNumber;
  });
  // Không nhận diện được tiêu đề nào khớp -> rơi về vị trí cột mặc định của file mẫu (username, pass,
  // name, email, phone, dept, jobTitle theo đúng thứ tự 1-7), phòng trường hợp người dùng lỡ xoá dòng
  // tiêu đề khi chỉnh sửa file.
  const usePositional = Object.keys(colIndex).length === 0;
  if (usePositional) {
    USER_IMPORT_COLUMNS.forEach((name, i) => { colIndex[name] = i + 1; });
  }

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 && !usePositional) return; // dòng 1 là tiêu đề, bỏ qua (trừ khi đang đọc theo vị trí thì dòng 1 có thể là dữ liệu thật)
    const get = (name) => {
      const idx = colIndex[name];
      if (!idx) return '';
      const v = row.getCell(idx).value;
      return v == null ? '' : String(v).trim();
    };
    const username = get('username');
    if (!username) return; // dòng trống hoặc thiếu username -> bỏ qua, không tạo user rỗng
    rows.push({
      username,
      pass: get('pass'),
      name: get('name'),
      email: get('email'),
      phone: get('phone'),
      dept: get('dept'),
      jobTitle: get('jobtitle') || null
    });
  });
  return rows;
}

module.exports = { buildGenericWorkbook, parseUsersImportXlsx, USER_IMPORT_COLUMNS };
