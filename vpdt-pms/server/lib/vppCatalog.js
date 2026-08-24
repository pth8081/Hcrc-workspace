// lib/vppCatalog.js — Đọc file Excel (.xlsx/.xls, qua exceljs) hoặc CSV (qua csv-parse) admin upload
// lúc tạo "kỳ đăng ký Văn phòng phẩm" thành danh mục mặt hàng có cấu trúc
// [{code, name, unit, origin, spec, price}], dùng cho cả hiển thị chọn mặt hàng (nhân viên) lẫn xuất
// file tổng hợp/tổng quát theo phòng ban (báo cáo). KHÔNG dùng gói "xlsx" (SheetJS) — có lỗ hổng bảo
// mật cao (Prototype Pollution/ReDoS) chưa có bản vá trên npm, đúng vào con đường xử lý file KHÔNG TIN
// CẬY (upload từ người dùng) nên chọn exceljs/csv-parse thay thế.
const ExcelJS = require('exceljs');
const { parse: parseCsv } = require('csv-parse/sync');
const { HttpError } = require('./httpErrors');

// Nhận diện tiêu đề cột không phân biệt hoa-thường/dấu/xuống dòng trong ô (VD "ĐƠN GIÁ\nCHƯA VAT") —
// dò TOÀN BỘ các cột ở dòng đầu để lập bản đồ tên cột -> chỉ số cột, KHÔNG phụ thuộc thứ tự/vị trí cột
// cụ thể của 1 file mẫu (mỗi phòng ban có thể tự sắp xếp cột khác nhau, thêm cột thừa cột đầu để trống...).
function normalizeHeader(s) {
  // NFD + xoá dấu tổ hợp xử lý được hầu hết nguyên âm có dấu, nhưng "đ/Đ" là ký tự độc lập không có
  // dạng phân rã NFD (không phải d + dấu) nên phải thay tay — nếu không "ĐVT"/"Đơn giá" sẽ không khớp
  // được các hint viết bằng "d" thường.
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const FIELD_HINTS = {
  name: ['ten mat hang', 'ten hang', 'ten hang hoa', 'ten', 'name', 'mat hang'],
  unit: ['don vi tinh', 'don vi', 'unit', 'dvt'],
  code: ['ma hang', 'ma vat tu', 'ma vt', 'ma so', 'ma'],
  origin: ['xuat xu', 'nuoc san xuat', 'nsx'],
  spec: ['quy cach dong goi', 'quy cach']
};
// Cột đơn giá thường kèm ghi chú xuống dòng ("ĐƠN GIÁ\nCHƯA VAT") nên dò theo kiểu CHỨA cụm "don gia"
// thay vì so khớp tuyệt đối — vẫn phải phân biệt được với cột "Giá mới ..." (giá tương lai, bỏ qua).
const PRICE_HINT = 'don gia';

// Dò dòng đầu tiên có ít nhất 1 cột khớp tiêu đề "Tên mặt hàng" — coi đó là dòng header, lập bản đồ cột.
// Không tìm thấy (file không có header, hoặc đặt tên khác hẳn) -> trả về null, dùng lại kiểu cũ: cột 1 =
// tên, cột 2 = đơn vị theo VỊ TRÍ (giữ tương thích các file catalog đơn giản 2 cột không header).
function detectColumnMap(headerCells) {
  const map = {};
  let foundName = false;
  headerCells.forEach((raw, idx) => {
    const h = normalizeHeader(raw);
    if (!h) return;
    for (const field of Object.keys(FIELD_HINTS)) {
      if (map[field] !== undefined) continue; // cột đầu tiên khớp thắng, tránh gán đè
      if (FIELD_HINTS[field].some(hint => h === hint)) {
        map[field] = idx;
        if (field === 'name') foundName = true;
      }
    }
    if (map.price === undefined && h.includes(PRICE_HINT)) map.price = idx;
  });
  return foundName ? map : null;
}

// Trước đây bỏ hết dấu phẩy rồi để parseFloat() hiểu MỌI dấu chấm là dấu thập phân — trong khi giá
// VNĐ theo kiểu Việt Nam thường viết dấu chấm là phân cách hàng nghìn (vd "15.000" = 15 nghìn,
// "1.234.567" = 1.234.567), khiến "15.000" đọc ra 15 và "1.234.567" đọc ra 1.234 — sai lệch tới hàng
// nghìn lần. Quy tắc: nếu có CẢ 2 ký tự (. và ,) thì dấu xuất hiện SAU CÙNG là dấu thập phân, dấu còn
// lại là phân cách hàng nghìn (kiểu số quốc tế thông thường). Nếu chỉ có 1 loại dấu, coi là phân cách
// hàng nghìn khi xuất hiện nhiều lần HOẶC nhóm sau dấu đó đúng 3 chữ số (đúng cách viết số VNĐ), còn
// lại (vd "15.5") coi là dấu thập phân.
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

// rows: mảng các mảng ô (mỗi hàng là 1 mảng giá trị cột) — đã tách khỏi định dạng file gốc (Excel/CSV).
function rowsToCatalogItems(rows) {
  if (!rows.length) throw new HttpError(400, 'File danh mục trống, không có dữ liệu');

  const colMap = detectColumnMap(rows[0]);
  const dataRows = colMap ? rows.slice(1) : rows;
  const idx = colMap || { name: 0, unit: 1 };

  const items = [];
  const seenNames = new Set();
  for (const cells of dataRows) {
    const name = String(cells[idx.name] ?? '').trim();
    if (!name) continue; // bỏ qua dòng trống/thiếu tên (VD dòng cuối file chỉ còn mã hàng, không có tên)
    const key = normalizeHeader(name);
    if (seenNames.has(key)) continue; // bỏ trùng tên (không phân biệt hoa-thường/dấu) ngay từ khi đọc file
    seenNames.add(key);
    items.push({
      code: idx.code !== undefined ? String(cells[idx.code] ?? '').trim() : '',
      name,
      unit: idx.unit !== undefined ? String(cells[idx.unit] ?? '').trim() : '',
      origin: idx.origin !== undefined ? String(cells[idx.origin] ?? '').trim() : '',
      spec: idx.spec !== undefined ? String(cells[idx.spec] ?? '').trim() : '',
      price: idx.price !== undefined ? parsePrice(cells[idx.price]) : null
    });
  }
  if (!items.length) throw new HttpError(400, 'Không đọc được mặt hàng nào hợp lệ từ file (cần có cột Tên mặt hàng/Tên hàng)');
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

// Kiểm tra + làm sạch danh sách mặt hàng nhân viên chọn (rawItems) đối chiếu với danh mục CHÍNH THỨC
// của kỳ (catalogItems) — dùng chung cho cả tạo mới (Kết thúc chọn) lẫn sửa nháp (còn NHÁP), nên tách
// riêng khỏi lib/createValidation.js (file đó không tự đọc DB, chỉ nhận payload đã có sẵn appData.vppPeriods
// — nhưng route sửa nháp cũng cần đúng logic này, đặt ở đây để dùng lại 1 chỗ duy nhất, không chép 2 nơi).
// Chốt số liệu (đơn giá/mã hàng/ĐVT/quy cách) LUÔN lấy theo danh mục hiện tại của kỳ tại thời điểm gọi
// (snapshot vào chính hồ sơ đăng ký) — không tin số liệu client tự gửi kèm ngoài name/qty.
function validateRegistrationItems(rawItems, catalogItems) {
  const catalogByName = new Map((catalogItems || []).map(it => [it.name, it]));
  const items = Array.isArray(rawItems) ? rawItems : [];
  const cleaned = [];
  for (const it of items) {
    const name = String(it?.name || '').trim();
    const qty = Number(it?.qty);
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;
    const cat = catalogByName.get(name);
    if (!cat) throw new HttpError(400, `Mặt hàng "${name}" không có trong danh mục kỳ này`);
    cleaned.push({
      code: cat.code || '', name, unit: cat.unit || '', origin: cat.origin || '', spec: cat.spec || '',
      price: cat.price ?? null, qty
    });
  }
  if (!cleaned.length) throw new HttpError(400, 'Vui lòng chọn ít nhất 1 mặt hàng với số lượng hợp lệ');
  return cleaned;
}

// Tổng tiền của 1 đăng ký — dùng chung cho kiểm tra ngân sách/người lúc "Gửi phê duyệt"
// (submitVppRegistration() ở lib/recordActions.js) và báo cáo Tổng Hợp Theo Phòng Ban (index.html).
// items đã snapshot đúng đơn giá của danh mục kỳ (xem validateRegistrationItems ở trên), mặt hàng
// chưa có đơn giá (price=null) coi như 0đ, không làm hỏng tổng của các mặt hàng khác.
function calcItemsTotal(items) {
  return (items || []).reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
}

module.exports = { parseCatalogFile, validateRegistrationItems, calcItemsTotal };
