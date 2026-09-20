// lib/purchasingManualImport.js — Nhập/Xuất Excel THỦ CÔNG cho dbo.VendorPurchaseTransactions (Mua Hàng
// > BAS > Đồng Bộ DSmart), v23.44. Bổ sung 1 đường nạp dữ liệu THAY THẾ đồng bộ API DSmart (không phải
// đường phụ) — dùng khi DSmart tạm không sẵn sàng hoặc cần bổ sung tay 1 vài giao dịch lẻ. Cùng khuôn
// lib/operationImport.js: SINH file mẫu bằng exceljs, ĐỌC file .xlsx qua lib/xlsxSafeRead.js (chống
// zip-bomb), KHÔNG dùng gói "xlsx" (SheetJS).
//
// Khác lib/operationImport.js ở 1 điểm: route gọi hàm parse ở đây GHI THẲNG vào CSDL luôn (giống
// POST /api/purchasing/sync đang làm với dữ liệu DSmart) thay vì chỉ trả preview cho client tự gộp —
// bảng VendorPurchaseTransactions không phải "hồ sơ" người dùng thao tác qua form thường (không có khái
// niệm 1 dòng = 1 bản ghi được xem/sửa riêng), mirror đúng cách routes/purchasing.js xử lý dữ liệu DSmart.
//
// sourceRefId cho dòng nhập tay: DSmart cấp refId THẬT cho mỗi giao dịch (dùng để dedup khi đồng bộ lặp
// lại cửa sổ ngày chồng lấn) — file Excel thủ công không có khái niệm đó, nên TỰ SINH 1 khoá dedup ổn
// định (hash SHA-1 của đúng các trường nghiệp vụ then chốt) để lỡ tải trùng NGUYÊN 1 file cũ lên lần nữa
// không tạo double-count giao dịch — UNIQUE INDEX (SourceSystem, SourceRefId) đã có sẵn tự chặn (xem
// sql/schema.sql), SourceSystem='MANUAL' tách biệt hẳn khỏi 'DSMART' nên không thể đụng độ chéo 2 nguồn.
const ExcelJS = require('exceljs');
const crypto = require('crypto');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

// Cùng lib/operationImport.js normalizeHeader() — xử lý "đ/Đ" riêng vì không có dạng phân rã NFD.
function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const TX_COLUMNS = [
  { key: 'vendorCode', header: 'Mã NCC (*)', hints: ['ma ncc', 'ma nha cung cap', 'vendorcode'], width: 16 },
  { key: 'storeCode', header: 'Mã Siêu Thị (*)', hints: ['ma sieu thi', 'ma cua hang', 'storecode'], width: 16 },
  { key: 'storeFormat', header: 'Định Dạng (MART/MINIMART)', hints: ['dinh dang', 'storeformat'], width: 22 },
  { key: 'categoryCode', header: 'Mã Ngành Hàng', hints: ['ma nganh hang', 'categorycode'], width: 18 },
  { key: 'purchaseDate', header: 'Ngày Mua (YYYY-MM-DD) (*)', hints: ['ngay mua', 'purchasedate'], width: 20 },
  { key: 'amount', header: 'Số Tiền (*)', hints: ['so tien', 'thanh tien', 'amount'], width: 18 },
  { key: 'isReturn', header: 'Hàng Trả Lại (Có/Không)', hints: ['hang tra lai', 'tra lai', 'isreturn'], width: 20 }
];

async function buildPurchaseTransactionTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Giao Dịch Mua Hàng');
  sheet.columns = TX_COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({
    vendorCode: 'NCC001 (VD, xoá dòng này trước khi nộp)', storeCode: 'ST001', storeFormat: 'MART',
    categoryCode: 'FOOD', purchaseDate: '2026-09-01', amount: 15000000, isReturn: 'Không'
  });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  return wb;
}

function detectColumnMap(headerCells) {
  const map = {};
  let foundAny = false;
  headerCells.forEach((raw, idx) => {
    const h = normalizeHeader(raw);
    if (!h) return;
    for (const col of TX_COLUMNS) {
      if (map[col.key] !== undefined) continue;
      if (col.hints.some(hint => h === hint || h.includes(hint))) {
        map[col.key] = idx;
        foundAny = true;
      }
    }
  });
  return foundAny ? map : null;
}

function parseAmount(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw).replace(/[^\d.,-]/g, '').trim();
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const thousandSep = decimalSep === '.' ? ',' : '.';
    s = s.split(thousandSep).join('');
    if (decimalSep === ',') s = s.replace(',', '.');
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? '.' : ',';
    const parts = s.split(sep);
    const isThousandsGrouping = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    s = isThousandsGrouping ? parts.join('') : parts.join('.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw) {
  if (raw instanceof Date && !isNaN(raw)) return raw.toISOString().slice(0, 10);
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

function parseIsReturn(raw) {
  const s = normalizeHeader(raw);
  return s === 'co' || s === 'true' || s === '1' || s === 'x';
}

// LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao — phát hiện #4, mục phụ): hash dedup TRƯỚC ĐÂY thiếu
// storeFormat — 2 dòng giao dịch THẬT SỰ KHÁC NHAU (cùng NCC/siêu thị/ngành hàng/ngày/số tiền/hàng trả
// lại nhưng khác Định Dạng, VD 1 dòng ghi nhầm 'MART' và 1 dòng đúng 'MINIMART' của cùng chuỗi/siêu thị,
// hoặc 2 giao dịch trùng số tiền ngẫu nhiên ở 2 định dạng khác nhau) sẽ ra CÙNG 1 sourceRefId -> lượt nhập
// sau bị coi là "dòng đã có, bỏ qua" (rowsSkippedDuplicate) dù là 2 giao dịch khác nhau, MẤT dữ liệu.
// LƯU Ý VẬN HÀNH: đổi công thức hash này làm sourceRefId của các dòng MANUAL cũ (đã nhập TRƯỚC bản vá)
// và dòng MANUAL mới (SAU bản vá, có storeFormat) LỆCH NHAU — lỡ nhập lại NGUYÊN 1 file cũ đã nhập trước
// bản vá sẽ không còn nhận diện được là trùng nữa (tạo dòng mới thay vì bỏ qua). Chấp nhận được (nhất
// quán với các lần sửa thuật toán hash/dedup khác trong hệ thống) vì đây là sửa đúng bản chất nghiệp vụ
// (2 dòng khác Định Dạng PHẢI được coi là 2 giao dịch khác nhau).
function buildManualSourceRefId(row) {
  const canon = [row.vendorCode, row.storeCode, row.storeFormat || '', row.categoryCode || '', row.purchaseDate, row.amount, row.isReturn ? '1' : '0'].join('|');
  return 'MANUAL-' + crypto.createHash('sha1').update(canon).digest('hex').slice(0, 24);
}

const MAX_IMPORT_ROWS = 2000;

// Trả về { rows, rowErrors } — rows ĐÃ SẴN SÀNG đưa thẳng vào bulkInsertPurchaseTransactions()
// (sourceSystem/sourceRefId/dataConfidence tự gán), rowErrors là mảng {rowNum, message} cho dòng thiếu
// trường bắt buộc/không hợp lệ (KHÔNG chặn cả file — các dòng hợp lệ khác vẫn được nạp bình thường,
// đúng tinh thần "chấp nhận 1 phần" như chính đồng bộ DSmart cũng làm khi 1 vài item lỗi giữa chừng).
async function parsePurchaseTransactionImportXlsx(buffer) {
  let headerSeen = false;
  let colMap = null;
  let overLimit = false;
  let rowNum = 1;
  const rows = [];
  const rowErrors = [];

  await streamFirstSheetRows(buffer, (cells) => {
    rowNum++;
    if (!headerSeen) {
      headerSeen = true;
      colMap = detectColumnMap(cells);
      if (colMap) return true; // dòng đầu là tiêu đề -> bỏ qua
      colMap = { vendorCode: 0, storeCode: 1, storeFormat: 2, categoryCode: 3, purchaseDate: 4, amount: 5, isReturn: 6 };
    }
    const vendorCode = String(cells[colMap.vendorCode] ?? '').trim();
    const storeCode = String(cells[colMap.storeCode] ?? '').trim();
    const storeFormat = String(cells[colMap.storeFormat] ?? '').trim();
    const categoryCode = String(cells[colMap.categoryCode] ?? '').trim();
    const purchaseDateRaw = cells[colMap.purchaseDate];
    const amountRaw = cells[colMap.amount];
    const isReturn = parseIsReturn(cells[colMap.isReturn]);
    if (!vendorCode && !storeCode && !purchaseDateRaw && !amountRaw) return true; // dòng trắng hoàn toàn -> bỏ qua êm

    const purchaseDate = parseDate(purchaseDateRaw);
    const amount = parseAmount(amountRaw);
    const errs = [];
    if (!vendorCode) errs.push('thiếu Mã NCC');
    if (!storeCode) errs.push('thiếu Mã Siêu Thị');
    if (!purchaseDate) errs.push('Ngày Mua không hợp lệ (cần dạng YYYY-MM-DD)');
    if (amount == null || amount <= 0) errs.push('Số Tiền không hợp lệ (phải là số dương)');
    if (errs.length) {
      rowErrors.push({ rowNum, message: `Dòng ${rowNum}: ${errs.join(', ')}` });
      if (rows.length + rowErrors.length > MAX_IMPORT_ROWS) { overLimit = true; return false; }
      return true;
    }

    const row = {
      vendorCode, storeCode, storeFormat: storeFormat || null, categoryCode: categoryCode || null,
      purchaseDate, amount, isReturn, sourceSystem: 'MANUAL', dataConfidence: 'PROVISIONAL'
    };
    row.sourceRefId = buildManualSourceRefId(row);
    rows.push(row);
    if (rows.length + rowErrors.length > MAX_IMPORT_ROWS) { overLimit = true; return false; }
    return true;
  });

  if (overLimit) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_IMPORT_ROWS} dòng/lần)`);
  if (!rows.length && !rowErrors.length) throw new HttpError(400, 'Không đọc được dòng dữ liệu nào từ file (thiếu cột Mã NCC/Mã Siêu Thị)');
  return { rows, rowErrors };
}

// Xuất lại dữ liệu ĐANG CÓ (dùng để admin tải về, chỉnh sửa/bổ sung rồi tải lên lại qua Nhập File —
// đúng tinh thần "mẫu = đúng khuôn cột sẽ export ra" như lib/operationImport.js).
async function buildPurchaseTransactionExportWorkbook(transactions) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Giao Dịch Mua Hàng');
  sheet.columns = TX_COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));
  styleHeaderRow(sheet.getRow(1));
  transactions.forEach(t => {
    sheet.addRow({
      vendorCode: t.vendorCode, storeCode: t.storeCode, storeFormat: t.storeFormat || '',
      categoryCode: t.categoryCode || '', purchaseDate: t.purchaseDate, amount: t.amount,
      isReturn: t.isReturn ? 'Có' : 'Không'
    });
  });
  return wb;
}

module.exports = { buildPurchaseTransactionTemplateWorkbook, parsePurchaseTransactionImportXlsx, buildPurchaseTransactionExportWorkbook };
