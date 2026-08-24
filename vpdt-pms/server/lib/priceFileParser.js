// lib/priceFileParser.js — Đọc file Excel (.xlsx/.xls, qua exceljs) bảng giá đề xuất duyệt của module
// "Phê Duyệt Giá" (Hỗ Trợ IT) thành danh sách mặt hàng có cấu trúc [{code, name, oldPrice, newPrice}].
// Dùng lại đúng cách dò cột theo TIÊU ĐỀ (không phụ thuộc thứ tự) như lib/vppCatalog.js — nhưng tách
// file riêng vì bộ cột và ý nghĩa nghiệp vụ khác hẳn (đây là giá BÁN mặt hàng siêu thị, không phải danh
// mục Văn phòng phẩm). KHÔNG dùng gói "xlsx" (SheetJS) — lý do bảo mật giống hệt lib/vppCatalog.js.
const ExcelJS = require('exceljs');
const { HttpError } = require('./httpErrors');

function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const FIELD_HINTS = {
  code: ['ma hang', 'ma vat tu', 'ma sp', 'ma san pham', 'ma'],
  name: ['ten mat hang', 'ten hang', 'ten hang hoa', 'ten san pham', 'ten'],
  oldPrice: ['gia cu', 'gia ban cu', 'don gia cu'],
  newPrice: ['gia moi', 'gia ban moi', 'don gia moi', 'gia de xuat']
};

function detectColumnMap(headerCells) {
  const map = {};
  let foundName = false;
  headerCells.forEach((raw, idx) => {
    const h = normalizeHeader(raw);
    if (!h) return;
    for (const field of Object.keys(FIELD_HINTS)) {
      if (map[field] !== undefined) continue;
      if (FIELD_HINTS[field].some(hint => h === hint)) {
        map[field] = idx;
        if (field === 'name') foundName = true;
      }
    }
  });
  return foundName ? map : null;
}

// Cùng quy tắc đọc số kiểu Việt Nam với lib/vppCatalog.js::parsePrice() — dấu chấm/phẩy cuối cùng là
// thập phân, còn lại là phân cách hàng nghìn (VD "35.000" = 35 nghìn, không phải 35).
function parsePrice(raw) {
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

function rowsToPriceItems(rows) {
  if (!rows.length) throw new HttpError(400, 'File bảng giá trống, không có dữ liệu');

  const colMap = detectColumnMap(rows[0]);
  const dataRows = colMap ? rows.slice(1) : rows;
  // Không dò được header theo tên cột -> coi như file mẫu đơn giản 3 cột theo VỊ TRÍ: Mã hàng, Tên mặt
  // hàng, Giá mới (không có giá cũ) — vẫn đọc được thay vì báo lỗi trắng.
  const idx = colMap || { code: 0, name: 1, newPrice: 2 };

  const items = [];
  const seenCodes = new Set();
  for (const cells of dataRows) {
    const name = String(cells[idx.name] ?? '').trim();
    if (!name) continue;
    const code = idx.code !== undefined ? String(cells[idx.code] ?? '').trim() : '';
    const dedupeKey = code || normalizeHeader(name);
    if (seenCodes.has(dedupeKey)) continue; // bỏ dòng trùng mã/tên trong CÙNG 1 file
    seenCodes.add(dedupeKey);
    const newPrice = idx.newPrice !== undefined ? parsePrice(cells[idx.newPrice]) : null;
    if (!Number.isFinite(newPrice) || newPrice <= 0) continue; // dòng không có giá mới hợp lệ -> bỏ qua
    items.push({
      code,
      name,
      oldPrice: idx.oldPrice !== undefined ? parsePrice(cells[idx.oldPrice]) : null,
      newPrice
    });
  }
  if (!items.length) {
    throw new HttpError(400, 'Không đọc được dòng giá nào hợp lệ từ file (cần có cột Tên mặt hàng và Giá mới lớn hơn 0)');
  }
  if (items.length > 1000) throw new HttpError(400, 'File bảng giá quá nhiều dòng (tối đa 1000 mặt hàng/tệp)');
  return items;
}

async function parsePriceFile(buffer) {
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
  return rowsToPriceItems(rows);
}

// Làm sạch lại 1 mảng items ĐÃ ĐƯỢC PARSE TỪ SERVER (client chỉ echo lại nguyên văn kết quả của
// POST /api/it-price/parse-file lúc tạo/bổ sung đề xuất — cùng mức tin cậy với cách VPP xử lý
// validateRegistrationItems() ở trên) — chặn payload giả mạo/kiểu dữ liệu lạ trước khi ghi vào DB.
function sanitizePriceFileItems(rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const cleaned = [];
  for (const it of items) {
    const name = String(it?.name || '').trim();
    const newPrice = Number(it?.newPrice);
    if (!name || !Number.isFinite(newPrice) || newPrice <= 0) continue;
    const oldPriceNum = Number(it?.oldPrice);
    cleaned.push({
      code: String(it?.code || '').trim().slice(0, 60),
      name: name.slice(0, 200),
      oldPrice: Number.isFinite(oldPriceNum) && oldPriceNum >= 0 ? oldPriceNum : null,
      newPrice
    });
    if (cleaned.length >= 1000) break;
  }
  if (!cleaned.length) throw new HttpError(400, 'Tệp bảng giá không có dòng hợp lệ nào (thiếu tên mặt hàng hoặc giá mới)');
  return cleaned;
}

module.exports = { parsePriceFile, sanitizePriceFileItems };
