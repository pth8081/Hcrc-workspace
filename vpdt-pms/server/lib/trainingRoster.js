// lib/trainingRoster.js — Tải mẫu Excel danh sách học viên (nhân sự tải xuống, điền tài khoản rồi
// upload lại) + đọc file đã điền để lấy danh sách username, dùng cho POST
// /api/records/trainingClasses/:id/bulk-register (thêm hàng loạt học viên vào lớp). Cùng khuôn
// lib/vppExport.js (sinh file) + lib/vppCatalog.js (đọc file, dò cột theo tiêu đề không phân biệt
// hoa-thường/dấu) — KHÔNG dùng gói "xlsx" (SheetJS), lý do xem đầu file lib/vppCatalog.js.
const ExcelJS = require('exceljs');
const { parse: parseCsv } = require('csv-parse/sync');
const { HttpError } = require('./httpErrors');

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

async function buildRosterTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Danh Sách Học Viên');
  sheet.columns = [
    { header: 'Tài Khoản Đăng Nhập', key: 'username', width: 24 },
    { header: 'Họ Tên (chỉ để tham khảo)', key: 'name', width: 28 }
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({ username: 'nv_nhansu', name: 'Nguyễn Văn A (VD, xoá dòng này trước khi nộp)' });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  return wb;
}

// Giống lib/vppCatalog.js normalizeHeader() — xử lý "đ/Đ" riêng vì không có dạng phân rã NFD.
function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const USERNAME_HINTS = ['tai khoan dang nhap', 'tai khoan', 'username', 'ten dang nhap', 'user name'];

// Dò cột "Tài Khoản Đăng Nhập" theo tiêu đề dòng đầu (không phân biệt hoa-thường/dấu) — không tìm thấy
// (file không có header, hoặc người dùng tự sửa mẫu) thì coi cột 1 là username (khớp đúng mẫu tải về).
function detectUsernameCol(headerCells) {
  for (let idx = 0; idx < headerCells.length; idx++) {
    const h = normalizeHeader(headerCells[idx]);
    if (h && USERNAME_HINTS.some(hint => h === hint)) return idx;
  }
  return null;
}

function rowsToUsernames(rows) {
  if (!rows.length) throw new HttpError(400, 'File danh sách học viên trống, không có dữ liệu');
  const detectedCol = detectUsernameCol(rows[0]);
  const dataRows = detectedCol !== null ? rows.slice(1) : rows;
  const col = detectedCol !== null ? detectedCol : 0;

  const usernames = [];
  const seen = new Set();
  for (const cells of dataRows) {
    const username = String(cells[col] ?? '').trim();
    if (!username || seen.has(username)) continue;
    seen.add(username);
    usernames.push(username);
  }
  if (!usernames.length) throw new HttpError(400, 'Không đọc được tài khoản nào hợp lệ từ file');
  if (usernames.length > 500) throw new HttpError(400, 'File quá nhiều dòng (tối đa 500 học viên/lần)');
  return usernames;
}

async function parseRosterExcelBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new HttpError(400, 'File Excel không có sheet dữ liệu nào');
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell) => { cells.push(cell.value == null ? '' : String(cell.value)); });
    rows.push(cells);
  });
  return rowsToUsernames(rows);
}

function parseRosterCsvBuffer(buffer) {
  const records = parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true, bom: true });
  return rowsToUsernames(records);
}

// ext: '.xlsx' | '.xls' | '.csv' (đã kiểm tra hợp lệ ở multer fileFilter trước khi gọi hàm này).
async function parseRosterFile(buffer, ext) {
  if (ext === '.csv') return parseRosterCsvBuffer(buffer);
  return parseRosterExcelBuffer(buffer);
}

module.exports = { buildRosterTemplateWorkbook, parseRosterFile };
