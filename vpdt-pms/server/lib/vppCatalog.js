// lib/vppCatalog.js — Đọc file Excel (.xlsx/.xls, qua exceljs) hoặc CSV (qua csv-parse) admin upload
// lúc tạo "kỳ đăng ký Văn phòng phẩm" thành danh mục mặt hàng có cấu trúc [{name, unit}], dùng cho cả
// hiển thị chọn mặt hàng (nhân viên) lẫn tổng hợp số lượng theo mặt hàng (báo cáo). KHÔNG dùng gói
// "xlsx" (SheetJS) — có lỗ hổng bảo mật cao (Prototype Pollution/ReDoS) chưa có bản vá trên npm, đúng
// vào con đường xử lý file KHÔNG TIN CẬY (upload từ người dùng) nên chọn exceljs/csv-parse thay thế.
const ExcelJS = require('exceljs');
const { parse: parseCsv } = require('csv-parse/sync');
const { HttpError } = require('./httpErrors');

// Nhận diện cột "Tên mặt hàng"/"Đơn vị tính" không phân biệt hoa-thường/dấu — nếu dòng đầu không khớp
// tiêu đề nào (file không có header, hoặc đặt tên khác), coi cột 1 = tên, cột 2 = đơn vị theo vị trí.
function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
const NAME_HEADER_HINTS = ['ten mat hang', 'ten hang', 'ten', 'name', 'mat hang'];
const UNIT_HEADER_HINTS = ['don vi tinh', 'don vi', 'unit', 'dvt'];

function looksLikeHeaderRow(cells) {
  const a = stripAccents(cells[0]);
  const b = stripAccents(cells[1]);
  return NAME_HEADER_HINTS.some(h => a === h) || UNIT_HEADER_HINTS.some(h => b === h);
}

// rows: mảng các mảng ô (mỗi hàng là 1 mảng giá trị cột) — đã tách khỏi định dạng file gốc (Excel/CSV).
function rowsToCatalogItems(rows) {
  if (!rows.length) throw new HttpError(400, 'File danh mục trống, không có dữ liệu');
  let dataRows = rows;
  if (looksLikeHeaderRow(rows[0])) dataRows = rows.slice(1);

  const items = [];
  const seenNames = new Set();
  for (const cells of dataRows) {
    const name = String(cells[0] ?? '').trim();
    if (!name) continue; // bỏ qua dòng trống
    const unit = String(cells[1] ?? '').trim();
    const key = stripAccents(name);
    if (seenNames.has(key)) continue; // bỏ trùng tên (không phân biệt hoa-thường/dấu) ngay từ khi đọc file
    seenNames.add(key);
    items.push({ name, unit });
  }
  if (!items.length) throw new HttpError(400, 'Không đọc được mặt hàng nào hợp lệ từ file (cột đầu tiên phải là Tên mặt hàng)');
  if (items.length > 2000) throw new HttpError(400, 'File danh mục quá nhiều dòng (tối đa 2000 mặt hàng)');
  return items;
}

async function parseExcelBuffer(buffer) {
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
  return rowsToCatalogItems(rows);
}

function parseCsvBuffer(buffer) {
  const records = parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true, bom: true });
  return rowsToCatalogItems(records);
}

// ext: '.xlsx' | '.xls' | '.csv' (đã kiểm tra hợp lệ ở multer fileFilter trước khi gọi hàm này).
async function parseCatalogFile(buffer, ext) {
  if (ext === '.csv') return parseCsvBuffer(buffer);
  return parseExcelBuffer(buffer);
}

module.exports = { parseCatalogFile };
