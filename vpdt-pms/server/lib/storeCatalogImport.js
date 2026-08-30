// lib/storeCatalogImport.js — Tải mẫu Excel danh sách siêu thị + đọc file đã điền, dùng cho "🏬 Quản Lý
// Danh Mục Siêu Thị" (import hàng loạt thay vì thêm từng dòng). Cùng khuôn lib/trainingRoster.js (đơn
// giản nhất, đúng hình dạng "1 cột danh sách phẳng") — KHÔNG dùng gói "xlsx" (SheetJS), lý do xem đầu
// file lib/vppCatalog.js.
const ExcelJS = require('exceljs'); // chỉ còn dùng để SINH file mẫu tải xuống; đọc file upload đi qua lib/xlsxSafeRead.js
const { parse: parseCsv } = require('csv-parse/sync');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

async function buildStoreTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Danh Sách Siêu Thị');
  sheet.columns = [{ header: 'Tên Siêu Thị', key: 'name', width: 36 }];
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({ name: 'Siêu thị Quận 1 (VD, xoá dòng này trước khi nộp)' });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  return wb;
}

// Giống lib/vppCatalog.js/lib/trainingRoster.js normalizeHeader() — xử lý "đ/Đ" riêng vì không có dạng
// phân rã NFD.
function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const STORE_NAME_HINTS = ['ten sieu thi', 'sieu thi', 'ten', 'store', 'store name'];

// Dò cột "Tên Siêu Thị" theo tiêu đề dòng đầu (không phân biệt hoa-thường/dấu) — không tìm thấy (file
// không có header, hoặc người dùng tự sửa mẫu) thì coi cột 1 là tên siêu thị (khớp đúng mẫu tải về).
function detectNameCol(headerCells) {
  for (let idx = 0; idx < headerCells.length; idx++) {
    const h = normalizeHeader(headerCells[idx]);
    if (h && STORE_NAME_HINTS.some(hint => h === hint)) return idx;
  }
  return null;
}

function rowsToStoreNames(rows) {
  if (!rows.length) throw new HttpError(400, 'File danh sách siêu thị trống, không có dữ liệu');
  const detectedCol = detectNameCol(rows[0]);
  const dataRows = detectedCol !== null ? rows.slice(1) : rows;
  const col = detectedCol !== null ? detectedCol : 0;

  const names = [];
  const seen = new Set();
  for (const cells of dataRows) {
    const name = String(cells[col] ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  if (!names.length) throw new HttpError(400, 'Không đọc được tên siêu thị nào hợp lệ từ file');
  if (names.length > 500) throw new HttpError(400, 'File quá nhiều dòng (tối đa 500 siêu thị/lần)');
  return names;
}

// Đọc theo DÒNG (lib/xlsxSafeRead.js) thay vì nạp cả sheet vào RAM bằng workbook.xlsx.load() — giới hạn
// 500 siêu thị nay chặn NGAY trong lúc đọc, file .xlsx nén độc hại không kịp bung hết vào bộ nhớ. Logic
// dò cột/bỏ trùng/bỏ trống giữ y hệt rowsToStoreNames() (vẫn dùng nguyên cho nhánh CSV bên dưới).
async function parseStoreExcelBuffer(buffer) {
  let headerSeen = false;
  let col = 0;
  let sawAnyRow = false;
  let overLimit = false;
  const names = [];
  const seen = new Set();

  const take = (cells) => {
    const name = String(cells[col] ?? '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  };

  await streamFirstSheetRows(buffer, (cells) => {
    if (!headerSeen) {
      headerSeen = true;
      sawAnyRow = true;
      const detectedCol = detectNameCol(cells);
      if (detectedCol !== null) { col = detectedCol; return true; } // dòng đầu là tiêu đề -> bỏ qua
      col = 0; // không dò được tiêu đề -> dòng đầu cũng là dữ liệu (cột 1 = tên siêu thị)
      take(cells);
    } else {
      take(cells);
    }
    if (names.length > 500) { overLimit = true; return false; }
    return true;
  });

  if (!sawAnyRow) throw new HttpError(400, 'File danh sách siêu thị trống, không có dữ liệu');
  // Vượt trần thì danh sách chắc chắn không rỗng, nên thứ tự 2 lỗi dưới đây cho ra đúng thông báo như cũ.
  if (overLimit) throw new HttpError(400, 'File quá nhiều dòng (tối đa 500 siêu thị/lần)');
  if (!names.length) throw new HttpError(400, 'Không đọc được tên siêu thị nào hợp lệ từ file');
  return names;
}

function parseStoreCsvBuffer(buffer) {
  const records = parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true, bom: true });
  return rowsToStoreNames(records);
}

// ext: '.xlsx' | '.xls' | '.csv' (đã kiểm tra hợp lệ ở multer fileFilter trước khi gọi hàm này).
async function parseStoreFile(buffer, ext) {
  if (ext === '.csv') return parseStoreCsvBuffer(buffer);
  return parseStoreExcelBuffer(buffer);
}

module.exports = { buildStoreTemplateWorkbook, parseStoreFile };
