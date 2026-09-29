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

// STORE_TYPE_LABEL_VI/STORE_TYPE_CODES — 10/2026 (theo yêu cầu người dùng "mẫu tải bao gồm cả phần cho
// chọn siêu thị, cửa hàng, kho để có thể import luôn mục này"): thêm cột "Loại" vào mẫu — mã nội bộ khớp
// ĐÚNG DB.storeTypes ('ST'/'CH', xem setStoreType() ở module-admin.js) + mã MỚI 'WH' (Kho, trước đây
// KHÔNG có lựa chọn này). "Kho" chỉ được nhìn nhận ở panel Quản Lý Danh Mục + import/export Excel — các
// nơi khác từng đọc DB.storeTypes (VD Dashboard VSATTP) vẫn chỉ hiểu ST/CH, giá trị WH tự rơi vào nhóm
// "chưa phân loại" ở đó, không cần sửa thêm gì (kho không có nghiệp vụ VSATTP).
const STORE_TYPE_LABEL_VI = { ST: 'Siêu Thị', CH: 'Cửa Hàng', WH: 'Kho' };
const STORE_TYPE_CODES = Object.keys(STORE_TYPE_LABEL_VI);

async function buildStoreTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Danh Sách Siêu Thị');
  sheet.columns = [
    { header: 'Tên Siêu Thị', key: 'name', width: 36 },
    { header: 'Loại (Siêu Thị/Cửa Hàng/Kho — để trống nếu chưa phân loại)', key: 'type', width: 44 }
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({ name: 'Siêu thị Quận 1 (VD, xoá dòng này trước khi nộp)', type: 'Siêu Thị' });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  // Data validation dạng danh sách thả xuống cho cột "Loại" — gợi ý đúng 3 giá trị hợp lệ, tránh gõ sai
  // chính tả (để trống vẫn hợp lệ = chưa phân loại, KHÔNG nằm trong danh sách validation vì Excel không
  // cho phép rỗng làm 1 lựa chọn danh sách — ô để trống vẫn được CHẤP NHẬN lúc đọc, chỉ validation gợi ý).
  const typeCol = sheet.getColumn('type').letter;
  for (let r = 2; r <= 500; r++) {
    sheet.getCell(`${typeCol}${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`"${Object.values(STORE_TYPE_LABEL_VI).join(',')}"`]
    };
  }
  return wb;
}

// Giống lib/vppCatalog.js/lib/trainingRoster.js normalizeHeader() — xử lý "đ/Đ" riêng vì không có dạng
// phân rã NFD.
function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const STORE_NAME_HINTS = ['ten sieu thi', 'sieu thi', 'ten', 'store', 'store name'];
const STORE_TYPE_HINTS = ['loai', 'phan loai', 'type'];

// Đọc giá trị 1 ô cột "Loại" -> mã nội bộ ('ST'/'CH'/'WH') hoặc null (để trống/không nhận diện được =
// coi như chưa phân loại, KHÔNG báo lỗi — cùng tinh thần "cảnh báo chứ không chặn" của hệ thống).
function normalizeStoreTypeCell(raw) {
  const v = normalizeHeader(raw);
  if (!v) return null;
  if (v === 'sieu thi' || v === 'st') return 'ST';
  if (v === 'cua hang' || v === 'ch') return 'CH';
  if (v === 'kho' || v === 'wh') return 'WH';
  return null;
}

// Dò cột "Tên Siêu Thị"/"Loại" theo tiêu đề dòng đầu (không phân biệt hoa-thường/dấu) — không tìm thấy
// cột tên (file không có header, hoặc người dùng tự sửa mẫu) thì coi cột 1 là tên siêu thị, KHÔNG có cột
// Loại (khớp đúng hành vi CŨ trước khi có cột này — file 1-cột vẫn import được bình thường).
function detectCols(headerCells) {
  let nameCol = null, typeCol = null;
  for (let idx = 0; idx < headerCells.length; idx++) {
    const h = normalizeHeader(headerCells[idx]);
    if (nameCol === null && h && STORE_NAME_HINTS.some(hint => h === hint)) nameCol = idx;
    else if (typeCol === null && h && STORE_TYPE_HINTS.some(hint => h.startsWith(hint))) typeCol = idx;
  }
  return { nameCol, typeCol };
}

function rowsToStoreItems(rows) {
  if (!rows.length) throw new HttpError(400, 'File danh sách siêu thị trống, không có dữ liệu');
  const { nameCol, typeCol } = detectCols(rows[0]);
  const dataRows = nameCol !== null ? rows.slice(1) : rows;
  const col = nameCol !== null ? nameCol : 0;

  const items = [];
  const seen = new Set();
  for (const cells of dataRows) {
    const name = String(cells[col] ?? '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    items.push({ name, type: typeCol !== null ? normalizeStoreTypeCell(cells[typeCol]) : null });
  }
  if (!items.length) throw new HttpError(400, 'Không đọc được tên siêu thị nào hợp lệ từ file');
  if (items.length > 500) throw new HttpError(400, 'File quá nhiều dòng (tối đa 500 siêu thị/lần)');
  return items;
}

// Đọc theo DÒNG (lib/xlsxSafeRead.js) thay vì nạp cả sheet vào RAM bằng workbook.xlsx.load() — giới hạn
// 500 siêu thị nay chặn NGAY trong lúc đọc, file .xlsx nén độc hại không kịp bung hết vào bộ nhớ. Logic
// dò cột/bỏ trùng/bỏ trống giữ y hệt rowsToStoreItems() (vẫn dùng nguyên cho nhánh CSV bên dưới).
async function parseStoreExcelBuffer(buffer) {
  let headerSeen = false;
  let nameCol = 0, typeCol = null;
  let sawAnyRow = false;
  let overLimit = false;
  const items = [];
  const seen = new Set();

  const take = (cells) => {
    const name = String(cells[nameCol] ?? '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    items.push({ name, type: typeCol !== null ? normalizeStoreTypeCell(cells[typeCol]) : null });
  };

  await streamFirstSheetRows(buffer, (cells) => {
    if (!headerSeen) {
      headerSeen = true;
      sawAnyRow = true;
      const detected = detectCols(cells);
      if (detected.nameCol !== null) { nameCol = detected.nameCol; typeCol = detected.typeCol; return true; } // dòng đầu là tiêu đề -> bỏ qua
      nameCol = 0; typeCol = null; // không dò được tiêu đề -> dòng đầu cũng là dữ liệu (cột 1 = tên siêu thị)
      take(cells);
    } else {
      take(cells);
    }
    if (items.length > 500) { overLimit = true; return false; }
    return true;
  });

  if (!sawAnyRow) throw new HttpError(400, 'File danh sách siêu thị trống, không có dữ liệu');
  // Vượt trần thì danh sách chắc chắn không rỗng, nên thứ tự 2 lỗi dưới đây cho ra đúng thông báo như cũ.
  if (overLimit) throw new HttpError(400, 'File quá nhiều dòng (tối đa 500 siêu thị/lần)');
  if (!items.length) throw new HttpError(400, 'Không đọc được tên siêu thị nào hợp lệ từ file');
  return items;
}

function parseStoreCsvBuffer(buffer) {
  const records = parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true, bom: true });
  return rowsToStoreItems(records);
}

// ext: '.xlsx' | '.xls' | '.csv' (đã kiểm tra hợp lệ ở multer fileFilter trước khi gọi hàm này).
// Trả về mảng {name, type} — type là 'ST'/'CH'/'WH'/null (null = để trống/chưa phân loại, xem
// normalizeStoreTypeCell()). Đổi tên hàm (số ít "Names" -> "Items") vì giờ mang thêm field `type`, không
// còn là mảng chuỗi phẳng nữa — cập nhật cả nơi gọi ở routes/storeCatalogImport.js.
async function parseStoreFile(buffer, ext) {
  if (ext === '.csv') return parseStoreCsvBuffer(buffer);
  return parseStoreExcelBuffer(buffer);
}

module.exports = { buildStoreTemplateWorkbook, parseStoreFile, STORE_TYPE_LABEL_VI, STORE_TYPE_CODES };
