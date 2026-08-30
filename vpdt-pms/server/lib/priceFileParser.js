// lib/priceFileParser.js — Đọc file Excel (.xlsx/.xls, qua exceljs) bảng giá đề xuất duyệt của module
// "Phê Duyệt Giá" (Hỗ Trợ IT). KHÔNG dùng gói "xlsx" (SheetJS) — lý do bảo mật giống hệt lib/vppCatalog.js.
//
// Đợt 2 (bỏ hẳn khái niệm "vai trò cột"): trước đây Mẫu Giá (itPriceMasterLists) lấy nguyên văn cột từ
// file mẫu rồi ADMIN tự gán tay 1 cột nào đó giữ vai trò nghiệp vụ "Tên mặt hàng"/"Giá mới"/"Mã hàng"/
// "Giá cũ" (bước "Gán vai trò cột" + nút Xác nhận) để hệ thống biết đọc giá/tên ở đâu mà lọc dòng hợp
// lệ/dựng bảng so sánh. Nay bỏ HẲN bước đó lẫn khái niệm giá cũ/giá mới — Mẫu Giá CHỈ còn là khuôn cột
// (columns[], lấy nguyên văn từ dòng tiêu đề, không gán vai trò gì), việc đọc bảng giá thật người đề xuất
// nộp chỉ còn ĐÚNG 1 việc: SO KHỚP tên cột (không phân biệt hoa/thường/dấu) giữa file nộp và Mẫu Giá đã
// chọn — khớp thì đọc mỗi dòng thành 1 object `values` (key = key cột trong Mẫu Giá, value = nội dung ô
// tương ứng, giữ NGUYÊN VĂN dạng chuỗi, không phân biệt cột nào là "giá"/"tên"). Hiển thị/so sánh ở client
// (public/index.html::itPriceCellHTML()/diffPriceFileItems()) cũng render generic theo columnLabels, không
// còn định dạng số/căn phải đặc biệt cho cột nào.
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// So khớp tên cột (đã chuẩn hoá hoa/thường/dấu) của file bảng giá thật người đề xuất nộp với bộ tên cột
// của Mẫu Giá đã chọn — phải khớp ĐÚNG (cùng số lượng, cùng tên, không thiếu không thừa), không quan tâm
// thứ tự cột trong file thật có giống thứ tự cột trong Mẫu Giá hay không (dò lại vị trí theo tên).
function matchColumnsToTemplate(headerCells, template) {
  const columns = Array.isArray(template?.columns) ? template.columns : [];
  if (!columns.length) throw new HttpError(400, 'Mẫu Giá đã chọn không có cột nào, vui lòng liên hệ Quản trị viên');

  const fileLabelsNorm = headerCells.map(normalizeHeader).filter(h => h);
  const missing = columns.filter(c => !fileLabelsNorm.includes(normalizeHeader(c.label))).map(c => c.label);
  const templateLabelSet = new Set(columns.map(c => normalizeHeader(c.label)));
  const extra = headerCells.map((raw) => ({ raw: String(raw || '').trim(), norm: normalizeHeader(raw) }))
    .filter(h => h.norm && !templateLabelSet.has(h.norm)).map(h => h.raw);
  if (missing.length || extra.length) {
    const parts = [];
    if (missing.length) parts.push(`thiếu cột: ${missing.join(', ')}`);
    if (extra.length) parts.push(`có cột thừa không thuộc mẫu: ${extra.join(', ')}`);
    throw new HttpError(400, `File bảng giá chưa khớp đúng cột theo Mẫu Giá đã chọn (${parts.join('; ')})`);
  }

  const findIdx = (label) => headerCells.findIndex(h => normalizeHeader(h) === normalizeHeader(label));
  const idxByKey = {};
  columns.forEach((c) => { idxByKey[c.key] = findIdx(c.label); });
  return { columnLabels: columns.map(c => ({ key: c.key, label: c.label })), idxByKey };
}

// Dòng tiêu đề -> bộ cột sẽ đọc (giữ nguyên logic cũ, chỉ tách ra để dùng được khi đọc theo dòng).
function resolveColumns(headerCells, template) {
  if (template) {
    const matched = matchColumnsToTemplate(headerCells, template);
    return { columnLabels: matched.columnLabels, idxByKey: matched.idxByKey };
  }
  // Chưa có Mẫu Giá nào trong hệ thống (mới cài đặt/chưa cấu hình) — vẫn cần 1 lối thoát để không chặn
  // cứng: lấy NGUYÊN VĂN cột của CHÍNH file này (giống hệt parsePriceTemplateColumns() ở dưới).
  const columnLabels = [];
  headerCells.forEach((raw, idx) => {
    const label = String(raw || '').trim();
    if (label) columnLabels.push({ key: `c${idx}`, label });
  });
  if (!columnLabels.length) throw new HttpError(400, 'File bảng giá không đọc được cột nào từ dòng tiêu đề');
  const idxByKey = {};
  columnLabels.forEach((c) => { idxByKey[c.key] = Number(c.key.slice(1)); });
  return { columnLabels, idxByKey };
}

// 1 dòng dữ liệu -> 1 item, hoặc null nếu dòng trắng hoàn toàn (bỏ qua như trước).
function rowToPriceItem(cells, columnLabels, idxByKey) {
  const values = {};
  let hasData = false;
  columnLabels.forEach((c) => {
    const idx = idxByKey[c.key];
    const v = (idx !== undefined && idx !== -1) ? String(cells[idx] ?? '').trim() : '';
    if (v) hasData = true;
    values[c.key] = v.slice(0, 500);
  });
  return hasData ? { values } : null;
}

// template (tuỳ chọn) — Mẫu Giá đã chọn (itPriceMasterLists), dùng ĐÚNG tên cột của mẫu để so khớp thay
// vì bộ từ khoá chung. Trả về { items, columnLabels } — columnLabels đi kèm mỗi tệp lưu vào item.files[]
// để hiển thị lại đúng tên cột ngay cả khi mẫu sau này bị sửa/xoá.
//
// Đọc theo DÒNG (lib/xlsxSafeRead.js) chứ không nạp cả sheet vào RAM: giới hạn 1000 dòng bên dưới nay
// chặn NGAY trong lúc đọc, không để file nén độc hại bung hết vào bộ nhớ rồi mới bị từ chối.
async function parsePriceFile(buffer, template) {
  let columnLabels = null;
  let idxByKey = null;
  let sawAnyRow = false;
  let overLimit = false;
  const items = [];

  await streamFirstSheetRows(buffer, (cells) => {
    if (!sawAnyRow) { // dòng đầu tiên đọc được là dòng tiêu đề
      sawAnyRow = true;
      ({ columnLabels, idxByKey } = resolveColumns(cells, template));
      return true;
    }
    const item = rowToPriceItem(cells, columnLabels, idxByKey);
    if (item) items.push(item);
    if (items.length > 1000) { overLimit = true; return false; }
    return true;
  });

  if (!sawAnyRow) throw new HttpError(400, 'File bảng giá trống, không có dữ liệu');
  // Vượt trần thì items chắc chắn không rỗng, nên thứ tự 2 lỗi dưới đây cho ra đúng thông báo như cũ.
  if (overLimit) throw new HttpError(400, 'File bảng giá quá nhiều dòng (tối đa 1000 dòng/tệp)');
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng dữ liệu nào hợp lệ từ file (mọi dòng đều trống)');
  return { items, columnLabels };
}

// Làm sạch lại 1 mảng items ĐÃ ĐƯỢC PARSE TỪ SERVER (client chỉ echo lại nguyên văn kết quả của
// POST /api/it-price/parse-file lúc tạo/bổ sung đề xuất — cùng mức tin cậy với cách VPP xử lý
// validateRegistrationItems() ở trên) — chặn payload giả mạo/kiểu dữ liệu lạ trước khi ghi vào DB. Mỗi
// item chỉ còn 1 field `values` (object key->string), không còn field nghiệp vụ cố định nào.
function sanitizePriceFileItems(rawItems) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const cleaned = [];
  for (const it of items) {
    const rawValues = it?.values && typeof it.values === 'object' ? it.values : null;
    if (!rawValues) continue;
    const values = {};
    let hasData = false;
    Object.keys(rawValues).slice(0, 50).forEach((k) => {
      const key = String(k).slice(0, 40);
      const v = String(rawValues[k] ?? '').trim();
      if (v) hasData = true;
      values[key] = v.slice(0, 500);
    });
    if (!hasData) continue;
    cleaned.push({ values });
    if (cleaned.length >= 1000) break;
  }
  if (!cleaned.length) throw new HttpError(400, 'Tệp bảng giá không có dòng dữ liệu nào hợp lệ');
  return cleaned;
}

const DEFAULT_COLUMN_LABELS = [{ key: 'c0', label: 'Dữ liệu' }];

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
// điểm, KHÔNG lưu dữ liệu giá thật — chỉ đọc DUY NHẤT dòng tiêu đề, bỏ hết các dòng dữ liệu bên dưới.
// Lấy NGUYÊN VĂN mọi cột đọc được, key sinh theo VỊ TRÍ cột (ổn định, không đổi dù đổi tên cột sau này).
// KHÔNG còn bước "gán vai trò cột" nào ở client sau khi đọc xong — xem addItPriceMasterList() ở
// public/index.html.
async function parsePriceTemplateColumns(buffer) {
  let headerCells = null;
  // Chỉ cần ĐÚNG dòng đầu -> trả về false ngay để dừng đọc, không đụng tới phần còn lại của file.
  await streamFirstSheetRows(buffer, (cells) => { headerCells = cells; return false; });
  if (!headerCells || !headerCells.length) throw new HttpError(400, 'File mẫu không có dòng tiêu đề nào');
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
