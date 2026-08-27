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

const DEFAULT_COLUMN_LABELS = [
  { key: 'code', label: 'Mã hàng' },
  { key: 'name', label: 'Tên mặt hàng' },
  { key: 'oldPrice', label: 'Giá cũ' },
  { key: 'newPrice', label: 'Giá mới' }
];

// Đợt "Mẫu Giá chỉ có cột" — khi người đề xuất đã chọn 1 Mẫu Giá (itPriceMasterLists, giờ chỉ còn là
// khuôn CỘT, không còn dữ liệu giá thật — xem lib/createValidation.js), file bảng giá thật họ tải lên
// PHẢI có đúng cột "Tên mặt hàng"/"Giá mới" theo ĐÚNG TÊN CỘT của mẫu đó (so khớp theo tiêu đề đã chuẩn
// hoá, không phân biệt hoa/thường/dấu) — không dùng bộ FIELD_HINTS chung nữa vì mẫu có thể đặt tên cột
// khác hẳn (VD "Mã SP", "Đơn giá đề xuất"...). Trả lại đúng cấu trúc cột (columnLabels) để hiển thị lại
// CHÍNH XÁC tên cột người dùng thấy trong mẫu, không phải nhãn tiếng Việt cứng của hệ thống.
function detectColumnMapFromTemplate(headerCells, template) {
  const normalizedHeaders = headerCells.map(normalizeHeader);
  const findIdx = (label) => normalizedHeaders.findIndex(h => h === normalizeHeader(label));
  const columns = Array.isArray(template?.columns) ? template.columns : [];
  const nameCol = columns.find(c => c.key === 'name');
  const newPriceCol = columns.find(c => c.key === 'newPrice');
  const nameIdx = nameCol ? findIdx(nameCol.label) : -1;
  if (nameIdx === -1) {
    throw new HttpError(400, `File bảng giá thiếu cột "${nameCol?.label || 'Tên mặt hàng'}" theo đúng Mẫu Giá đã chọn`);
  }
  const newPriceIdx = newPriceCol ? findIdx(newPriceCol.label) : -1;
  if (newPriceIdx === -1) {
    throw new HttpError(400, `File bảng giá thiếu cột "${newPriceCol?.label || 'Giá mới'}" theo đúng Mẫu Giá đã chọn`);
  }
  const idx = { name: nameIdx, newPrice: newPriceIdx };
  const codeCol = columns.find(c => c.key === 'code');
  if (codeCol) { const i = findIdx(codeCol.label); if (i !== -1) idx.code = i; }
  const oldPriceCol = columns.find(c => c.key === 'oldPrice');
  if (oldPriceCol) { const i = findIdx(oldPriceCol.label); if (i !== -1) idx.oldPrice = i; }
  // Cột tuỳ ý khác ngoài 4 trường nghiệp vụ cố định (VD Nhà cung cấp/Đơn vị tính/Ghi chú...) — chỉ mang
  // tính hiển thị/tham khảo, KHÔNG bắt buộc phải có trong file thật (mẫu có thể có nhiều cột hơn 1 lần
  // nộp cụ thể cần dùng tới).
  const extraCols = [];
  columns.filter(c => !['code', 'name', 'oldPrice', 'newPrice'].includes(c.key)).forEach(c => {
    const i = findIdx(c.label);
    if (i !== -1) extraCols.push({ key: c.key, label: c.label, idx: i });
  });
  const columnLabels = [
    ...(idx.code !== undefined ? [{ key: 'code', label: codeCol.label }] : []),
    { key: 'name', label: nameCol.label },
    ...(idx.oldPrice !== undefined ? [{ key: 'oldPrice', label: oldPriceCol.label }] : []),
    { key: 'newPrice', label: newPriceCol.label },
    ...extraCols.map(c => ({ key: c.key, label: c.label }))
  ];
  return { idx, extraCols, columnLabels };
}

function rowsToPriceItems(rows, template) {
  if (!rows.length) throw new HttpError(400, 'File bảng giá trống, không có dữ liệu');

  let idx, extraCols = [], columnLabels, dataRows;
  if (template) {
    const detected = detectColumnMapFromTemplate(rows[0], template);
    idx = detected.idx; extraCols = detected.extraCols; columnLabels = detected.columnLabels;
    dataRows = rows.slice(1);
  } else {
    const colMap = detectColumnMap(rows[0]);
    dataRows = colMap ? rows.slice(1) : rows;
    // Không dò được header theo tên cột -> coi như file mẫu đơn giản 3 cột theo VỊ TRÍ: Mã hàng, Tên mặt
    // hàng, Giá mới (không có giá cũ) — vẫn đọc được thay vì báo lỗi trắng.
    idx = colMap || { code: 0, name: 1, newPrice: 2 };
    columnLabels = DEFAULT_COLUMN_LABELS;
  }

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
    const extra = {};
    extraCols.forEach((c) => {
      const v = String(cells[c.idx] ?? '').trim();
      if (v) extra[c.key] = v.slice(0, 200);
    });
    items.push({
      code,
      name,
      oldPrice: idx.oldPrice !== undefined ? parsePrice(cells[idx.oldPrice]) : null,
      newPrice,
      ...(Object.keys(extra).length ? { extra } : {})
    });
  }
  if (!items.length) {
    throw new HttpError(400, 'Không đọc được dòng giá nào hợp lệ từ file (cần có cột Tên mặt hàng và Giá mới lớn hơn 0)');
  }
  if (items.length > 1000) throw new HttpError(400, 'File bảng giá quá nhiều dòng (tối đa 1000 mặt hàng/tệp)');
  return { items, columnLabels };
}

async function readSheetRows(buffer) {
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
  return rows;
}

// template (tuỳ chọn) — Mẫu Giá đã chọn (itPriceMasterLists), dùng ĐÚNG tên cột của mẫu để dò thay vì
// bộ FIELD_HINTS chung. Trả về { items, columnLabels } — columnLabels đi kèm mỗi tệp lưu vào
// item.files[].columnLabels để hiển thị lại đúng tên cột ngay cả khi mẫu sau này bị sửa/xoá.
async function parsePriceFile(buffer, template) {
  const rows = await readSheetRows(buffer);
  return rowsToPriceItems(rows, template);
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
    const rawExtra = it?.extra && typeof it.extra === 'object' ? it.extra : null;
    const extra = {};
    if (rawExtra) {
      Object.keys(rawExtra).slice(0, 20).forEach((k) => {
        const key = String(k).slice(0, 40);
        const v = String(rawExtra[k] ?? '').trim();
        if (v) extra[key] = v.slice(0, 200);
      });
    }
    cleaned.push({
      code: String(it?.code || '').trim().slice(0, 60),
      name: name.slice(0, 200),
      oldPrice: Number.isFinite(oldPriceNum) && oldPriceNum >= 0 ? oldPriceNum : null,
      newPrice,
      ...(Object.keys(extra).length ? { extra } : {})
    });
    if (cleaned.length >= 1000) break;
  }
  if (!cleaned.length) throw new HttpError(400, 'Tệp bảng giá không có dòng hợp lệ nào (thiếu tên mặt hàng hoặc giá mới)');
  return cleaned;
}

// Làm sạch lại columnLabels ĐÃ ĐƯỢC PARSE TỪ SERVER trước khi ghi vào item.files[] — cùng mức tin cậy
// với sanitizePriceFileItems() ở trên.
function sanitizeColumnLabels(rawColumnLabels) {
  const list = Array.isArray(rawColumnLabels) ? rawColumnLabels : DEFAULT_COLUMN_LABELS;
  const cleaned = list.slice(0, 50).map((c) => ({
    key: String(c?.key || '').slice(0, 40),
    label: String(c?.label || '').trim().slice(0, 100)
  })).filter((c) => c.key && c.label);
  return cleaned.length ? cleaned : DEFAULT_COLUMN_LABELS;
}

// ============ Mẫu Giá (itPriceMasterLists) — khuôn CỘT của bảng giá bên mua hàng gửi tại từng thời
// điểm, KHÔNG còn lưu dữ liệu giá thật (khác thiết kế cũ dùng để đối chiếu tự động) — chỉ đọc DUY NHẤT
// dòng tiêu đề, bỏ hết các dòng dữ liệu bên dưới. Cho phép mẫu có thêm cột tuỳ ý ngoài 4 trường nghiệp
// vụ cố định (Mã hàng/Tên mặt hàng/Giá cũ/Giá mới) — các cột đó giữ nguyên tên gốc, đánh dấu key dạng
// "extra_<vị trí cột>" để tra cứu lại khi đối chiếu với file bảng giá thật (xem detectColumnMapFromTemplate()).
async function parsePriceTemplateColumns(buffer) {
  const rows = await readSheetRows(buffer);
  if (!rows.length || !rows[0].length) throw new HttpError(400, 'File mẫu không có dòng tiêu đề nào');
  const headerCells = rows[0];
  const seenKeys = new Set();
  const columns = [];
  headerCells.forEach((raw, idx) => {
    const label = String(raw || '').trim();
    if (!label) return;
    const h = normalizeHeader(label);
    let key = null;
    for (const field of Object.keys(FIELD_HINTS)) {
      if (seenKeys.has(field)) continue;
      if (FIELD_HINTS[field].some((hint) => h === hint)) { key = field; break; }
    }
    if (!key) key = `extra_${idx}`;
    seenKeys.add(key);
    columns.push({ key, label: label.slice(0, 100) });
  });
  if (!columns.some((c) => c.key === 'name')) {
    throw new HttpError(400, 'Mẫu Giá cần có ít nhất 1 cột nhận diện được là "Tên mặt hàng"');
  }
  if (!columns.some((c) => c.key === 'newPrice')) {
    throw new HttpError(400, 'Mẫu Giá cần có ít nhất 1 cột nhận diện được là "Giá mới"');
  }
  if (columns.length > 50) throw new HttpError(400, 'Mẫu Giá quá nhiều cột (tối đa 50 cột/tệp)');
  return columns;
}

module.exports = {
  parsePriceFile, sanitizePriceFileItems, sanitizeColumnLabels, DEFAULT_COLUMN_LABELS,
  parsePriceTemplateColumns
};
