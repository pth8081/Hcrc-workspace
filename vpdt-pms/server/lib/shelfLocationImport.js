// lib/shelfLocationImport.js — Tải mẫu Excel danh sách Quầy Kệ + đọc file đã điền để XEM TRƯỚC, dùng
// cho "🗄️ Quầy Kệ" (Vận Hành > Kiểm Soát Hàng Hóa, Phase 1 MVP bổ sung, 11/2026). CÙNG KHUÔN
// lib/storeCatalogImport.js (đọc THEO DÒNG qua lib/xlsxSafeRead.js, không load cả workbook vào RAM) —
// CHỈ KHÁC: route gọi hàm này (routes/shelfStock.js) PHẢI tự đối chiếu "isNew" theo ĐÚNG siêu thị của
// người gọi (không đối chiếu toàn hệ thống như storeCatalogImport, vì mã quầy kệ chỉ cần DUY NHẤT trong
// CÙNG 1 siêu thị — xem chú thích shelfLocations ở lib/createValidation.js). File này KHÔNG tự ghi gì
// xuống DB — route trả về xem trước, CLIENT tự gọi callCreateAction('shelfLocations', ...) cho từng dòng
// "mới" (y hệt luồng "Thêm" tay đã có ở Phase 1 MVP), để tái dùng TOÀN BỘ validate/dup-check/forceOwnDept
// đã có ở lib/createValidation.js — không cần route "confirm add hàng loạt" riêng.
const ExcelJS = require('exceljs');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

const MAX_ROWS = 500; // trần chung với storeCatalogImport/objectCatalogImport — danh mục quản trị không bao giờ tới mức này

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

async function buildShelfLocationTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Danh Sách Quầy Kệ');
  sheet.columns = [
    { header: 'Mã Quầy Kệ', key: 'code', width: 20 },
    { header: 'Tên Quầy Kệ', key: 'name', width: 36 },
    { header: 'Ngành Hàng (tuỳ chọn)', key: 'category', width: 28 }
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({ code: 'A1', name: 'Nước giải khát (VD, xoá dòng này trước khi nộp)', category: 'Đồ uống' });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  return wb;
}

// Giống normalizeHeader() ở lib/storeCatalogImport.js — xử lý "đ/Đ" riêng vì không có dạng phân rã NFD.
function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const CODE_HINTS = ['ma quay ke', 'ma', 'code'];
const NAME_HINTS = ['ten quay ke', 'ten', 'name'];
const CATEGORY_HINTS = ['nganh hang', 'category'];

function detectCols(headerCells) {
  let codeCol = null, nameCol = null, categoryCol = null;
  for (let idx = 0; idx < headerCells.length; idx++) {
    const h = normalizeHeader(headerCells[idx]);
    if (!h) continue;
    if (codeCol === null && CODE_HINTS.some(hint => h === hint || h.startsWith(hint))) { codeCol = idx; continue; }
    if (nameCol === null && NAME_HINTS.some(hint => h === hint || h.startsWith(hint))) { nameCol = idx; continue; }
    if (categoryCol === null && CATEGORY_HINTS.some(hint => h.startsWith(hint))) categoryCol = idx;
  }
  return { codeCol, nameCol, categoryCol };
}

// Đọc .xlsx/.xls — THEO DÒNG (không nạp cả sheet vào RAM, chặn ngay khi vượt trần MAX_ROWS).
async function parseShelfLocationExcelBuffer(buffer) {
  let headerSeen = false;
  let codeCol = 0, nameCol = 1, categoryCol = 2;
  let sawAnyRow = false;
  let overLimit = false;
  const items = [];
  const seen = new Set();

  const take = (cells) => {
    const code = String(cells[codeCol] ?? '').trim();
    const name = String(cells[nameCol] ?? '').trim();
    if (!code || !name || seen.has(code)) return;
    seen.add(code);
    items.push({ code, name, category: categoryCol !== null ? String(cells[categoryCol] ?? '').trim() : '' });
  };

  await streamFirstSheetRows(buffer, (cells) => {
    if (!headerSeen) {
      headerSeen = true;
      sawAnyRow = true;
      const detected = detectCols(cells);
      if (detected.codeCol !== null && detected.nameCol !== null) {
        codeCol = detected.codeCol; nameCol = detected.nameCol; categoryCol = detected.categoryCol;
        return true; // dòng đầu là tiêu đề -> bỏ qua
      }
      codeCol = 0; nameCol = 1; categoryCol = 2; // không dò được tiêu đề -> dòng đầu cũng là dữ liệu
      take(cells);
    } else {
      take(cells);
    }
    if (items.length > MAX_ROWS) { overLimit = true; return false; }
    return true;
  });

  if (!sawAnyRow) throw new HttpError(400, 'File danh sách quầy kệ trống, không có dữ liệu');
  if (overLimit) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_ROWS} quầy kệ/lần)`);
  if (!items.length) throw new HttpError(400, 'Không đọc được quầy kệ hợp lệ nào từ file (cần đủ Mã + Tên)');
  return items;
}

function parseShelfLocationCsvBuffer(buffer) {
  const { parse: parseCsv } = require('csv-parse/sync');
  const rows = parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true, bom: true });
  if (!rows.length) throw new HttpError(400, 'File danh sách quầy kệ trống, không có dữ liệu');
  const { codeCol, nameCol, categoryCol } = detectCols(rows[0]);
  const dataRows = (codeCol !== null && nameCol !== null) ? rows.slice(1) : rows;
  const cCol = codeCol !== null ? codeCol : 0, nCol = nameCol !== null ? nameCol : 1, gCol = categoryCol;
  const items = [];
  const seen = new Set();
  for (const cells of dataRows) {
    const code = String(cells[cCol] ?? '').trim();
    const name = String(cells[nCol] ?? '').trim();
    if (!code || !name || seen.has(code)) continue;
    seen.add(code);
    items.push({ code, name, category: gCol !== null && gCol !== undefined ? String(cells[gCol] ?? '').trim() : '' });
  }
  if (!items.length) throw new HttpError(400, 'Không đọc được quầy kệ hợp lệ nào từ file (cần đủ Mã + Tên)');
  if (items.length > MAX_ROWS) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_ROWS} quầy kệ/lần)`);
  return items;
}

// ext: '.xlsx' | '.xls' | '.csv' (đã kiểm tra hợp lệ ở multer fileFilter trước khi gọi hàm này).
async function parseShelfLocationFile(buffer, ext) {
  if (ext === '.csv') return parseShelfLocationCsvBuffer(buffer);
  return parseShelfLocationExcelBuffer(buffer);
}

module.exports = { buildShelfLocationTemplateWorkbook, parseShelfLocationFile };
