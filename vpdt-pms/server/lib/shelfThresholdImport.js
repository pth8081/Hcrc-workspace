// lib/shelfThresholdImport.js — Tải mẫu Excel Ngưỡng Tồn + đọc file đã điền để XEM TRƯỚC, dùng cho
// "📋 Kiểm Soát Hàng Hóa > Ngưỡng Tồn" (Vận Hành, THIẾT KẾ LẠI 11/2026 — xem khối shelfStockThresholds
// ở lib/createValidation.js cho đầy đủ bối cảnh). CÙNG KHUÔN lib/shelfLocationImport.js (đọc THEO DÒNG
// qua lib/xlsxSafeRead.js, không load cả workbook vào RAM, trần MAX_ROWS chung) — CHỈ KHÁC: tính năng
// này là SIÊU THỊ TỰ UPLOAD ngưỡng của CHÍNH MÌNH (xác nhận với người dùng: "cấu hình ngưỡng tồn là để
// cho siêu thị tự upload file, không phải người quản trị"), nên route gọi hàm này (routes/shelfStock.js)
// PHẢI tự đối chiếu "isNew" theo ĐÚNG siêu thị của người gọi, cùng nguyên tắc forceOwnDept đã áp dụng
// cho mọi route Kiểm Soát Hàng Hóa khác. File này KHÔNG tự ghi gì xuống DB — route trả về xem trước,
// CLIENT tự gọi callCreateAction('shelfStockThresholds', ...) cho từng dòng "mới" (tái dùng validate/
// dup-check/forceOwnDept đã có ở lib/createValidation.js).
//
// KHÔNG có cột Email trong mẫu này (khác hẳn phiên bản cũ trước khi thiết kế lại) — người nhận cảnh báo
// giờ là 3 tầng tự động theo quyền (shelfLocationManage/shelfReportView) + 1 tầng "tự thêm thêm" chọn
// riêng trên UI (people-picker, không qua Excel) — xem jobs/shelfStockThresholdAlert.js.
const ExcelJS = require('exceljs');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

const MAX_ROWS = 500; // trần chung với storeCatalogImport/shelfLocationImport — danh mục quản trị không bao giờ tới mức này

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

async function buildShelfThresholdTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Ngưỡng Tồn');
  sheet.columns = [
    { header: 'Mã Hàng (nội bộ, tuỳ chọn)', key: 'maHang', width: 24 },
    { header: 'Mã Vạch (tuỳ chọn)', key: 'maVach', width: 24 },
    { header: 'Ngành Hàng (tuỳ chọn)', key: 'category', width: 28 },
    { header: 'Ngưỡng Tối Thiểu (bắt buộc)', key: 'minQuantity', width: 20 }
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({ maHang: '2003330491', maVach: '8934696001589', category: '', minQuantity: 20 });
  sheet.addRow({ maHang: '', maVach: '', category: 'Nước giải khát (VD, xoá dòng này trước khi nộp)', minQuantity: 10 });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  sheet.getRow(3).font = { italic: true, color: { argb: 'FF6B7280' } };
  return wb;
}

// Giống normalizeHeader() ở lib/storeCatalogImport.js/lib/shelfLocationImport.js — xử lý "đ/Đ" riêng vì
// không có dạng phân rã NFD.
function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const MA_HANG_HINTS = ['ma hang', 'ma hang noi bo'];
const MA_VACH_HINTS = ['ma vach'];
const CATEGORY_HINTS = ['nganh hang', 'category'];
const MIN_QTY_HINTS = ['nguong toi thieu', 'nguong', 'min quantity'];

function detectCols(headerCells) {
  let maHangCol = null, maVachCol = null, categoryCol = null, minQtyCol = null;
  for (let idx = 0; idx < headerCells.length; idx++) {
    const h = normalizeHeader(headerCells[idx]);
    if (!h) continue;
    if (maHangCol === null && MA_HANG_HINTS.some(hint => h === hint || h.startsWith(hint))) { maHangCol = idx; continue; }
    if (maVachCol === null && MA_VACH_HINTS.some(hint => h === hint || h.startsWith(hint))) { maVachCol = idx; continue; }
    if (categoryCol === null && CATEGORY_HINTS.some(hint => h.startsWith(hint))) { categoryCol = idx; continue; }
    if (minQtyCol === null && MIN_QTY_HINTS.some(hint => h.startsWith(hint))) minQtyCol = idx;
  }
  return { maHangCol, maVachCol, categoryCol, minQtyCol };
}

// Đọc .xlsx/.xls — THEO DÒNG (không nạp cả sheet vào RAM, chặn ngay khi vượt trần MAX_ROWS). Bỏ qua
// dòng thiếu minQuantity hợp lệ hoặc thiếu CẢ 3 trường nhận diện (cùng rule "ít nhất 1 trong 3" của
// extraValidate phía server — lọc sớm ở đây để người dùng thấy ngay dòng nào sẽ bị loại khi xem trước).
async function parseShelfThresholdExcelBuffer(buffer) {
  let headerSeen = false;
  let maHangCol = 0, maVachCol = 1, categoryCol = 2, minQtyCol = 3;
  let sawAnyRow = false;
  let overLimit = false;
  const items = [];
  const seen = new Set();

  const take = (cells) => {
    const maHang = String(cells[maHangCol] ?? '').trim().slice(0, 20);
    const maVach = String(cells[maVachCol] ?? '').trim().slice(0, 20);
    const category = categoryCol !== null ? String(cells[categoryCol] ?? '').trim().slice(0, 100) : '';
    const minQuantity = Number(cells[minQtyCol]);
    if (!maHang && !maVach && !category) return; // thiếu cả 3 trường nhận diện -> bỏ qua dòng này
    if (!Number.isFinite(minQuantity) || minQuantity < 0) return; // ngưỡng không hợp lệ -> bỏ qua
    const dupKey = `${maHang}|${maVach}|${category.toLowerCase()}`;
    if (seen.has(dupKey)) return; // trùng tổ hợp NGAY TRONG file — chỉ giữ dòng đầu
    seen.add(dupKey);
    items.push({ maHang, maVach, category, minQuantity });
  };

  await streamFirstSheetRows(buffer, (cells) => {
    if (!headerSeen) {
      headerSeen = true;
      sawAnyRow = true;
      const detected = detectCols(cells);
      if (detected.minQtyCol !== null) {
        maHangCol = detected.maHangCol ?? 0; maVachCol = detected.maVachCol ?? 1;
        categoryCol = detected.categoryCol; minQtyCol = detected.minQtyCol;
        return true; // dòng đầu là tiêu đề -> bỏ qua
      }
      maHangCol = 0; maVachCol = 1; categoryCol = 2; minQtyCol = 3; // không dò được tiêu đề -> dòng đầu cũng là dữ liệu
      take(cells);
    } else {
      take(cells);
    }
    if (items.length > MAX_ROWS) { overLimit = true; return false; }
    return true;
  });

  if (!sawAnyRow) throw new HttpError(400, 'File Ngưỡng Tồn trống, không có dữ liệu');
  if (overLimit) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_ROWS} ngưỡng/lần)`);
  if (!items.length) throw new HttpError(400, 'Không đọc được ngưỡng tồn hợp lệ nào từ file (mỗi dòng cần Ngưỡng Tối Thiểu + ít nhất 1 trong Mã Hàng/Mã Vạch/Ngành Hàng)');
  return items;
}

function parseShelfThresholdCsvBuffer(buffer) {
  const { parse: parseCsv } = require('csv-parse/sync');
  const rows = parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true, bom: true });
  if (!rows.length) throw new HttpError(400, 'File Ngưỡng Tồn trống, không có dữ liệu');
  const { maHangCol, maVachCol, categoryCol, minQtyCol } = detectCols(rows[0]);
  const hasHeader = minQtyCol !== null;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const mhCol = hasHeader ? (maHangCol ?? 0) : 0;
  const mvCol = hasHeader ? (maVachCol ?? 1) : 1;
  const catCol = hasHeader ? categoryCol : 2;
  const mqCol = hasHeader ? minQtyCol : 3;
  const items = [];
  const seen = new Set();
  for (const cells of dataRows) {
    const maHang = String(cells[mhCol] ?? '').trim().slice(0, 20);
    const maVach = String(cells[mvCol] ?? '').trim().slice(0, 20);
    const category = catCol !== null && catCol !== undefined ? String(cells[catCol] ?? '').trim().slice(0, 100) : '';
    const minQuantity = Number(cells[mqCol]);
    if (!maHang && !maVach && !category) continue;
    if (!Number.isFinite(minQuantity) || minQuantity < 0) continue;
    const dupKey = `${maHang}|${maVach}|${category.toLowerCase()}`;
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);
    items.push({ maHang, maVach, category, minQuantity });
  }
  if (!items.length) throw new HttpError(400, 'Không đọc được ngưỡng tồn hợp lệ nào từ file (mỗi dòng cần Ngưỡng Tối Thiểu + ít nhất 1 trong Mã Hàng/Mã Vạch/Ngành Hàng)');
  if (items.length > MAX_ROWS) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_ROWS} ngưỡng/lần)`);
  return items;
}

// ext: '.xlsx' | '.xls' | '.csv' (đã kiểm tra hợp lệ ở multer fileFilter trước khi gọi hàm này).
async function parseShelfThresholdFile(buffer, ext) {
  if (ext === '.csv') return parseShelfThresholdCsvBuffer(buffer);
  return parseShelfThresholdExcelBuffer(buffer);
}

module.exports = { buildShelfThresholdTemplateWorkbook, parseShelfThresholdFile };
