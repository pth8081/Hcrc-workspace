// lib/priceFileParser.js — Đọc file Excel (.xlsx/.xls, qua exceljs) bảng giá đề xuất duyệt của module
// "Phê Duyệt Giá" (Hỗ Trợ IT) thành danh sách mặt hàng có cấu trúc [{code, name, oldPrice, newPrice}].
// KHÔNG dùng gói "xlsx" (SheetJS) — lý do bảo mật giống hệt lib/vppCatalog.js.
//
// Cột KHÔNG còn được "nhận diện" theo từ khoá cố định (bỏ hẳn cách cũ) — Mẫu Giá (itPriceMasterLists)
// giờ lấy NGUYÊN VĂN mọi cột đọc được từ dòng tiêu đề file admin nạp (xem parsePriceTemplateColumns()),
// admin tự gán vai trò "Tên mặt hàng"/"Giá mới"/"Mã hàng"/"Giá cũ" cho ĐÚNG cột nào ngay tại client
// (public/index.html::addItPriceMasterList(), lưu vào master.roles = {name,newPrice,code?,oldPrice?}
// trỏ tới key của 1 cột trong master.columns). Khi người đề xuất nộp bảng giá thật theo 1 Mẫu Giá, việc
// còn lại chỉ là SO KHỚP bộ tên cột file họ nộp với bộ tên cột của Mẫu Giá (detectColumnMapFromTemplate())
// — khớp đúng tên/số lượng thì tự thừa hưởng lại đúng vai trò đã gán trên Mẫu Giá, không đoán lại lần nào
// nữa. Trường hợp hệ thống CHƯA có Mẫu Giá nào cả (mới cài đặt, chưa cấu hình) vẫn cần 1 lối thoát để
// không chặn cứng — giữ lại bộ từ khoá cũ CHỈ cho nhánh này (xem rowsToPriceItems()).
const ExcelJS = require('exceljs');
const { HttpError } = require('./httpErrors');

function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Bộ từ khoá cũ — CHỈ còn dùng cho nhánh "chưa có Mẫu Giá nào trong hệ thống" (xem rowsToPriceItems()),
// không còn dùng để "nhận diện" cột của Mẫu Giá hay đối chiếu file nộp với Mẫu Giá nữa.
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

// Đợt "khớp cột thay vì nhận diện" — Mẫu Giá (itPriceMasterLists) giờ lưu NGUYÊN VĂN mọi cột đọc được
// từ file admin nạp (template.columns = [{key,label}], key ổn định theo VỊ TRÍ lúc nạp mẫu — xem
// parsePriceTemplateColumns()) cộng theo `template.roles = {name, newPrice, code?, oldPrice?}` trỏ tới
// ĐÚNG key nào trong columns đóng vai trò gì — do ADMIN tự gán tay ở client (public/index.html), KHÔNG
// còn suy luận theo từ khoá. Việc còn lại ở đây chỉ là: bộ tên cột (đã chuẩn hoá hoa/thường/dấu) của file
// bảng giá thật người đề xuất nộp phải KHỚP ĐÚNG (cùng số lượng, cùng tên, không thiếu không thừa) với bộ
// tên cột của Mẫu Giá — khớp thì tự thừa hưởng lại đúng vai trò đã gán trên Mẫu Giá.
function detectColumnMapFromTemplate(headerCells, template) {
  const columns = Array.isArray(template?.columns) ? template.columns : [];
  if (!columns.length) throw new HttpError(400, 'Mẫu Giá đã chọn không có cột nào, vui lòng liên hệ Quản trị viên');
  let roles = template?.roles && typeof template.roles === 'object' ? template.roles : null;
  // Tương thích ngược: Mẫu Giá tạo TRƯỚC khi có bước "gán vai trò cột" tường minh (parsePriceTemplateColumns()
  // cũ tự nhận diện theo từ khoá, đặt thẳng key = 'name'/'newPrice'/'code'/'oldPrice') không có field
  // `roles` — suy ra roles từ chính key của cột trong trường hợp này, tránh chặn cứng hồ sơ Mẫu Giá cũ
  // đã tạo trước khi cập nhật (admin dùng "Thay mẫu" để gán lại vai trò tường minh khi cần).
  if (!roles) {
    roles = {};
    columns.forEach((c) => { if (['name', 'newPrice', 'code', 'oldPrice'].includes(c.key)) roles[c.key] = c.key; });
  }

  const templateLabelsNorm = columns.map(c => normalizeHeader(c.label));
  const fileLabelsNorm = headerCells.map(normalizeHeader).filter(h => h);
  const missing = columns.filter(c => !fileLabelsNorm.includes(normalizeHeader(c.label))).map(c => c.label);
  const templateLabelSet = new Set(templateLabelsNorm);
  const extra = headerCells.map((raw, i) => ({ raw: String(raw || '').trim(), norm: normalizeHeader(raw) }))
    .filter(h => h.norm && !templateLabelSet.has(h.norm)).map(h => h.raw);
  if (missing.length || extra.length) {
    const parts = [];
    if (missing.length) parts.push(`thiếu cột: ${missing.join(', ')}`);
    if (extra.length) parts.push(`có cột thừa không thuộc mẫu: ${extra.join(', ')}`);
    throw new HttpError(400, `File bảng giá chưa khớp đúng cột theo Mẫu Giá đã chọn (${parts.join('; ')})`);
  }

  const findIdx = (label) => headerCells.findIndex(h => normalizeHeader(h) === normalizeHeader(label));
  const colByKey = new Map(columns.map(c => [c.key, c]));
  const idx = {};
  ['name', 'newPrice', 'code', 'oldPrice'].forEach((role) => {
    const col = roles[role] ? colByKey.get(roles[role]) : null;
    if (col) idx[role] = findIdx(col.label);
  });
  if (idx.name === undefined || idx.name === -1) {
    throw new HttpError(400, 'Mẫu Giá đã chọn chưa gán cột "Tên mặt hàng", vui lòng liên hệ Quản trị viên');
  }
  if (idx.newPrice === undefined || idx.newPrice === -1) {
    throw new HttpError(400, 'Mẫu Giá đã chọn chưa gán cột "Giá mới", vui lòng liên hệ Quản trị viên');
  }

  const roleKeys = new Set(['name', 'newPrice', 'code', 'oldPrice'].map(r => roles[r]).filter(Boolean));
  const extraCols = columns.filter(c => !roleKeys.has(c.key)).map(c => ({ key: c.key, label: c.label, idx: findIdx(c.label) }));

  // columnLabels đi theo ĐÚNG thứ tự cột của Mẫu Giá (không phải thứ tự cột trong file thật) — cột đóng
  // vai trò được đổi sang key NGHIỆP VỤ cố định (name/newPrice/code/oldPrice) để itPriceCellHTML() ở
  // client hiển thị đúng định dạng số/căn phải như trước, cột phụ giữ nguyên key gốc (đọc qua it.extra[key]).
  const roleKeyOfCol = (colKey) => ['name', 'newPrice', 'code', 'oldPrice'].find(r => roles[r] === colKey) || null;
  const columnLabels = columns.map(c => ({ key: roleKeyOfCol(c.key) || c.key, label: c.label }));

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
// điểm, KHÔNG còn lưu dữ liệu giá thật — chỉ đọc DUY NHẤT dòng tiêu đề, bỏ hết các dòng dữ liệu bên
// dưới. KHÔNG còn tự "nhận diện" cột nào đóng vai trò gì nữa (bỏ hẳn FIELD_HINTS ở bước này) — lấy
// NGUYÊN VĂN mọi cột đọc được, key sinh theo VỊ TRÍ cột (ổn định, không đổi dù đổi tên cột sau này) để
// client tự gán vai trò "Tên mặt hàng"/"Giá mới"/"Mã hàng"/"Giá cũ" cho đúng cột nào (lưu vào
// master.roles, xem detectColumnMapFromTemplate() ở trên) — xem addItPriceMasterList() ở public/index.html.
async function parsePriceTemplateColumns(buffer) {
  const rows = await readSheetRows(buffer);
  if (!rows.length || !rows[0].length) throw new HttpError(400, 'File mẫu không có dòng tiêu đề nào');
  const headerCells = rows[0];
  const columns = [];
  headerCells.forEach((raw, idx) => {
    const label = String(raw || '').trim();
    if (!label) return;
    columns.push({ key: `c${idx}`, label: label.slice(0, 100) });
  });
  if (!columns.length) throw new HttpError(400, 'File mẫu không đọc được cột nào từ dòng tiêu đề');
  if (columns.length > 50) throw new HttpError(400, 'Mẫu Giá quá nhiều cột (tối đa 50 cột/tệp)');
  return columns;
}

module.exports = {
  parsePriceFile, sanitizePriceFileItems, sanitizeColumnLabels, DEFAULT_COLUMN_LABELS,
  parsePriceTemplateColumns
};
