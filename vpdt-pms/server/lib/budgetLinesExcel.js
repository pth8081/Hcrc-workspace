// lib/budgetLinesExcel.js — Tải mẫu Excel / đọc file đã điền (xem trước) cho module Ngân Sách 2.0
// (budgetLines) — mirror ĐÚNG khuôn lib/checklistImport.js (tải mẫu + đọc/xem trước, KHÔNG tự lưu gì).
// Mỗi dòng đọc được từ file VẪN phải đi qua đúng POST /api/create/budgetLines hiện có để thật sự lưu
// (client gọi callCreateAction() từng dòng hợp lệ sau khi người dùng xác nhận xem trước) — server tự
// kiểm tra lại toàn bộ ở createValidation.js budgetLines.extraValidate (Zero-Trust, không tin bất kỳ
// giá trị nào đã "xem trước").
//
// CHỈ áp dụng cho tab Đề Xuất/Phê Duyệt (2 form tạo dòng giống hệt nhau, khác mỗi payload.stage) — tab
// Sử Dụng KHÔNG có Tải Mẫu/Nhập (dòng cha chỉ tự sinh khi duyệt Phê Duyệt, dòng con "Ghi nhận Sử Dụng"
// luôn phải gắn với đúng 1 dòng cha cụ thể — không có khuôn "nhập hàng loạt không rõ dòng cha" hợp lý ở
// đây). "Xuất Excel" (cả 4 tab, gồm Sử Dụng/Báo Cáo) KHÔNG cần route riêng — dùng lại
// downloadXlsxFromServer()/POST /api/admin/export-xlsx có sẵn (core.js), xem module-ngansach.js.
'use strict';

const ExcelJS = require('exceljs');
const { parse: parseCsv } = require('csv-parse/sync');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');
const { markDuplicateItems, normalizeDedupKey } = require('./importDedup');

const MAX_ROWS_PER_IMPORT = 300;

const BUDGET_TYPE_LABELS = { OPEX: 'OPEX', CAPEX: 'CAPEX' };
const CATEGORY_LABELS = { SOFTWARE: 'Phần mềm', HARDWARE: 'Phần cứng', SERVICE: 'Dịch vụ', SYSTEM: 'Hệ thống' };

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

function buildBudgetLinesTemplateWorkbook(stage) {
  const wb = new ExcelJS.Workbook();
  const sheetTitle = stage === 'APPROVED' ? 'Phê Duyệt' : 'Đề Xuất';
  const sheet = wb.addWorksheet(sheetTitle);
  sheet.columns = [
    { header: 'Vị trí (HO hoặc đúng tên Siêu Thị)', key: 'location', width: 26 },
    { header: 'Khối Phòng Ban (chỉ cần nếu Vị trí = HO)', key: 'dept', width: 24 },
    { header: 'Danh Mục (Phần mềm/Phần cứng/Dịch vụ/Hệ thống)', key: 'category', width: 28 },
    { header: 'Loại NS (OPEX/CAPEX)', key: 'budgetType', width: 16 },
    { header: 'Nội Dung', key: 'content', width: 32 },
    { header: 'Mô Tả', key: 'description', width: 28 },
    { header: 'Số Lượng', key: 'quantity', width: 12 },
    { header: 'Đơn Giá', key: 'unitPrice', width: 16 },
    { header: 'VAT (%)', key: 'vat', width: 10 },
    { header: 'Năm NS', key: 'year', width: 10 },
    { header: 'Tháng NS', key: 'month', width: 10 },
    { header: 'Ghi Chú', key: 'note', width: 24 }
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({ location: 'HO', dept: 'Phòng Kế Toán', category: 'Phần mềm', budgetType: 'OPEX', content: 'Gia hạn phần mềm kế toán', description: 'Gia hạn 12 tháng', quantity: 1, unitPrice: 12000000, vat: 10, year: new Date().getFullYear(), month: new Date().getMonth() + 1, note: '' });
  sheet.addRow({ location: 'Siêu Thị Quận 1', dept: '', category: 'Phần cứng', budgetType: 'CAPEX', content: 'Mua máy in mã vạch', description: '02 cái', quantity: 2, unitPrice: 3500000, vat: 8, year: new Date().getFullYear(), month: new Date().getMonth() + 1, note: '' });
  [2, 3].forEach(r => { sheet.getRow(r).font = { italic: true, color: { argb: 'FF6B7280' } }; });

  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 110;
  noteSheet.addRow(['"Vị trí": gõ đúng "HO" (Trụ sở chính) HOẶC đúng tên 1 Siêu Thị đã có trong Danh Mục Siêu Thị (Quản Trị) — sai tên sẽ bị từ chối dòng đó.']);
  noteSheet.addRow(['"Khối Phòng Ban": CHỈ cần điền khi Vị trí = HO (gõ đúng tên trong Danh Mục Phòng) — để TRỐNG khi Vị trí là Siêu Thị, hệ thống tự lấy = đúng tên Siêu Thị.']);
  noteSheet.addRow(['"Danh Mục"/"Loại NS": gõ đúng 1 trong các giá trị gợi ý ở tiêu đề cột — không phân biệt hoa/thường, có thể gõ tắt (VD "phan mem"/"opex").']);
  noteSheet.addRow(['"Số Lượng"/"Đơn Giá"/"VAT"/"Năm NS"/"Tháng NS": bắt buộc là số — "Thành tiền" hệ thống tự tính = Số Lượng × Đơn Giá × (1 + VAT%).']);
  noteSheet.eachRow(row => { row.font = { italic: true, color: { argb: 'FFDC2626' } }; });
  return wb;
}

function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const HEADER_HINTS = {
  location: ['vi tri (ho hoac dung ten sieu thi)', 'vi tri'],
  dept: ['khoi phong ban (chi can neu vi tri = ho)', 'khoi phong ban'],
  category: ['danh muc (phan mem/phan cung/dich vu/he thong)', 'danh muc'],
  budgetType: ['loai ns (opex/capex)', 'loai ns'],
  content: ['noi dung'],
  description: ['mo ta'],
  quantity: ['so luong'],
  unitPrice: ['don gia'],
  vat: ['vat (%)', 'vat'],
  year: ['nam ns'],
  month: ['thang ns'],
  note: ['ghi chu']
};

function detectColumns(headerCells) {
  const cols = {};
  (headerCells || []).forEach((raw, idx) => {
    const h = normalizeHeader(raw);
    if (!h) return;
    for (const [field, hints] of Object.entries(HEADER_HINTS)) {
      if (cols[field] === undefined && hints.includes(h)) cols[field] = idx;
    }
  });
  return cols;
}

function matchLoose(raw, labels) {
  const norm = normalizeHeader(raw);
  for (const [key, label] of Object.entries(labels)) {
    if (normalizeHeader(key) === norm || normalizeHeader(label) === norm) return key;
  }
  return null;
}

// 1 dòng đã đọc -> 1 item xem trước, kèm valid/errors[] (KHÔNG throw ngay khi gặp dòng lỗi — để client
// hiển thị đầy đủ bảng xem trước, người dùng tự quyết định nhập dòng nào). Validate tối thiểu đủ để
// XEM TRƯỚC hữu ích — createValidation.js vẫn kiểm tra lại TOÀN BỘ khi thật sự tạo từng dòng.
function rowToBudgetLineItem(cells, cols, appData) {
  const get = (field) => (cols[field] !== undefined ? String(cells[cols[field]] ?? '').trim() : '');
  const location = get('location');
  const deptRaw = get('dept');
  const categoryRaw = get('category');
  const budgetTypeRaw = get('budgetType');
  const content = get('content');
  const description = get('description');
  const quantity = Number(get('quantity'));
  const unitPrice = Number(get('unitPrice'));
  const vat = get('vat') === '' ? 0 : Number(get('vat'));
  const year = Number(get('year'));
  const month = Number(get('month'));
  const note = get('note');

  const errors = [];
  const isHo = normalizeHeader(location) === 'ho';
  const finalLocation = isHo ? 'HO' : location;
  if (!isHo && !(appData?.stores || []).includes(location)) errors.push(`Vị trí "${location}" không có trong Danh Mục Siêu Thị`);
  const finalDept = isHo ? deptRaw : finalLocation;
  if (isHo && (!deptRaw || !(appData?.depts || []).includes(deptRaw))) errors.push(`Khối Phòng Ban "${deptRaw}" không có trong Danh Mục Phòng`);

  const category = matchLoose(categoryRaw, CATEGORY_LABELS);
  if (!category) errors.push(`Danh Mục "${categoryRaw}" không hợp lệ`);
  const budgetType = matchLoose(budgetTypeRaw, BUDGET_TYPE_LABELS);
  if (!budgetType) errors.push(`Loại NS "${budgetTypeRaw}" không hợp lệ`);

  if (!content) errors.push('thiếu Nội Dung');
  if (!Number.isFinite(quantity) || quantity <= 0) errors.push('Số Lượng không hợp lệ');
  if (!Number.isFinite(unitPrice) || unitPrice < 0) errors.push('Đơn Giá không hợp lệ');
  if (!Number.isFinite(vat) || vat < 0 || vat > 100) errors.push('VAT không hợp lệ');
  if (!Number.isFinite(year) || year < 2000 || year > 2100) errors.push('Năm NS không hợp lệ');
  if (!Number.isFinite(month) || month < 1 || month > 12) errors.push('Tháng NS không hợp lệ');

  return {
    location: finalLocation, dept: finalDept, itemCategory: category, budgetType,
    content, description, quantity, unitPrice, vatPercent: vat, budgetYear: year, budgetMonth: month, note,
    valid: errors.length === 0, errors
  };
}

function assertColumnsFound(cols) {
  if (cols.location === undefined || cols.content === undefined) {
    throw new HttpError(400, 'Không tìm thấy đủ cột "Vị trí"/"Nội Dung" trong file — vui lòng dùng đúng mẫu tải xuống');
  }
}

// Khoá so trùng: Năm+Tháng+Vị trí+Danh Mục+Nội Dung — CHỈ so trong CÙNG chức năng đang nhập (đúng
// stage đang import, VD tab "Đề Xuất" chỉ so với dòng Đề Xuất có sẵn, KHÔNG so chéo sang "Phê Duyệt"; và
// CHỈ so với dòng GỐC parentId==null, không tính dòng con "Ghi nhận Sử Dụng").
function budgetLineDedupKey(item) {
  return normalizeDedupKey(item.budgetYear, item.budgetMonth, item.location, item.itemCategory, item.content);
}
function existingBudgetLineKeys(appData, stage) {
  return (appData?.budgetLines || [])
    .filter(l => l.stage === stage && l.parentId == null)
    .map(l => normalizeDedupKey(l.budgetYear, l.budgetMonth, l.location, l.itemCategory, l.content));
}

async function parseBudgetLinesExcelBuffer(buffer, appData, stage) {
  let cols = null;
  let sawAnyRow = false;
  const items = [];

  await streamFirstSheetRows(buffer, (cells) => {
    if (!sawAnyRow) {
      sawAnyRow = true;
      cols = detectColumns(cells);
      assertColumnsFound(cols);
      return true;
    }
    const contentCell = cols.content !== undefined ? cells[cols.content] : '';
    const locationCell = cols.location !== undefined ? cells[cols.location] : '';
    if (!String(contentCell || '').trim() && !String(locationCell || '').trim()) return true; // dòng trống
    items.push(rowToBudgetLineItem(cells, cols, appData));
    if (items.length > MAX_ROWS_PER_IMPORT) return false;
    return true;
  }, { raw: true });

  if (!sawAnyRow) throw new HttpError(400, 'File trống, không có dữ liệu');
  if (items.length > MAX_ROWS_PER_IMPORT) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_ROWS_PER_IMPORT} dòng/lần)`);
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng hợp lệ nào từ file');
  return markDuplicateItems(items, budgetLineDedupKey, existingBudgetLineKeys(appData, stage));
}

function parseBudgetLinesCsvBuffer(buffer, appData, stage) {
  const records = parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true, bom: true });
  if (!records.length) throw new HttpError(400, 'File trống, không có dữ liệu');
  const cols = detectColumns(records[0]);
  assertColumnsFound(cols);
  const items = records.slice(1)
    .filter(cells => String(cells[cols.content] || '').trim() || String(cells[cols.location] || '').trim())
    .map(cells => rowToBudgetLineItem(cells, cols, appData));
  if (items.length > MAX_ROWS_PER_IMPORT) throw new HttpError(400, `File quá nhiều dòng (tối đa ${MAX_ROWS_PER_IMPORT} dòng/lần)`);
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng hợp lệ nào từ file');
  return markDuplicateItems(items, budgetLineDedupKey, existingBudgetLineKeys(appData, stage));
}

async function parseBudgetLinesImportFile(buffer, ext, appData, stage) {
  if (ext === '.csv') return parseBudgetLinesCsvBuffer(buffer, appData, stage);
  return parseBudgetLinesExcelBuffer(buffer, appData, stage);
}

module.exports = { buildBudgetLinesTemplateWorkbook, parseBudgetLinesImportFile };
