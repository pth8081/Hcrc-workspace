// lib/budgetTemplateImport.js — Tải mẫu Excel để nhập nhanh các CỘT TUỲ BIẾN của 1 mẫu ngân sách (thay
// vì phải bấm "+ Thêm cột" từng dòng thủ công) + đọc file đã điền. Cùng khuôn lib/trainingRoster.js
// (buildXxxTemplateWorkbook/parseXxxFile qua ExcelJS, dò cột theo tiêu đề không phân biệt hoa-thường/
// dấu) — KHÔNG đụng tới 4 cột LÕI (Tên Hạng Mục/Mô Tả Chi Tiết/Số Tiền/Loại NS), những cột đó LUÔN được
// server tự thêm vào (xem BUDGET_CORE_FIELD_DEFS ở lib/createValidation.js) bất kể file upload có gì.
const ExcelJS = require('exceljs'); // chỉ còn dùng để SINH file mẫu tải xuống; đọc file upload đi qua lib/xlsxSafeRead.js
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');
const { BUDGET_FIELD_TYPES } = require('./createValidation');

const TYPE_LABEL_VN = { text: 'Văn bản', number: 'Số', money: 'Tiền', select: 'Danh sách chọn', date: 'Ngày' };

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

async function buildBudgetTemplateFieldsWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Cột Tuỳ Biến');
  sheet.columns = [
    { header: 'Tên Cột', key: 'label', width: 28 },
    { header: 'Kiểu Dữ Liệu (text/number/money/select/date)', key: 'type', width: 32 },
    { header: 'Bắt Buộc (co/khong)', key: 'required', width: 18 },
    { header: 'Danh Sách Chọn (chỉ dùng nếu Kiểu = select, cách nhau dấu phẩy)', key: 'options', width: 40 }
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({ label: 'Nhà cung cấp', type: 'text', required: 'khong', options: '' });
  sheet.addRow({ label: 'Phụ cấp phát sinh', type: 'money', required: 'khong', options: '' });
  sheet.addRow({ label: 'Trạng thái duyệt nội bộ', type: 'select', required: 'co', options: 'Chưa duyệt, Đã duyệt' });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  sheet.getRow(3).font = { italic: true, color: { argb: 'FF6B7280' } };
  sheet.getRow(4).font = { italic: true, color: { argb: 'FF6B7280' } };
  sheet.addRow([]);
  const noteRow = sheet.addRow(['Lưu ý: KHÔNG cần khai "Tên Hạng Mục"/"Mô Tả Chi Tiết"/"Số Tiền"/"Loại NS" — 4 cột này hệ thống tự thêm vào mọi mẫu, chỉ khai thêm các cột RIÊNG của mẫu này.']);
  noteRow.font = { italic: true, color: { argb: 'FFDC2626' } };
  return wb;
}

// Cùng lib/vppCatalog.js/lib/trainingRoster.js — dò cột theo tiêu đề không phân biệt hoa-thường/dấu.
function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const TYPE_ALIASES = {
  'text': 'text', 'van ban': 'text', 'chu': 'text',
  'number': 'number', 'so': 'number',
  'money': 'money', 'tien': 'money', 'tien te': 'money',
  'select': 'select', 'danh sach chon': 'select', 'lua chon': 'select',
  'date': 'date', 'ngay': 'date'
};

function normalizeType(raw) {
  const key = normalizeHeader(raw);
  return TYPE_ALIASES[key] || null;
}

function normalizeRequired(raw) {
  const key = normalizeHeader(raw);
  return ['co', 'x', 'yes', 'true', 'bat buoc'].includes(key);
}

// 1 dòng dữ liệu -> 1 cột tuỳ biến, hoặc null nếu đây là dòng trống (dấu hiệu DỪNG đọc, xem dưới).
function rowToBudgetField(cells) {
  const label = String(cells[0] ?? '').trim();
  if (!label) return null;
  const type = normalizeType(cells[1]);
  if (!type || !BUDGET_FIELD_TYPES.has(type)) {
    throw new HttpError(400, `Kiểu dữ liệu không hợp lệ ở cột "${label}" — chỉ chấp nhận text/number/money/select/date`);
  }
  const required = normalizeRequired(cells[2]);
  const options = type === 'select'
    ? String(cells[3] ?? '').split(',').map(o => o.trim()).filter(Boolean)
    : [];
  if (type === 'select' && !options.length) {
    throw new HttpError(400, `Cột "${label}" kiểu Danh sách chọn nhưng chưa khai Danh Sách Chọn`);
  }
  return { label: label.slice(0, 100), type, required, options: options.slice(0, 50) };
}

// Đọc theo DÒNG (lib/xlsxSafeRead.js) thay vì nạp cả sheet vào RAM bằng workbook.xlsx.load() — trần 30
// cột tuỳ biến (và cả điểm dừng "gặp dòng trống") nay chặn NGAY trong lúc đọc, file .xlsx nén độc hại
// không kịp bung hết vào bộ nhớ.
// includeEmpty: true — PHẢI giữ lại dòng trống thật (không bỏ qua) để nhận biết đúng ranh giới "hết dữ
// liệu cột, phần còn lại là ghi chú" (xem mẫu tải về ở buildBudgetTemplateFieldsWorkbook()).
async function parseBudgetTemplateFieldsExcelBuffer(buffer) {
  let headerSeen = false;
  let sawAnyRow = false;
  const fields = [];

  await streamFirstSheetRows(buffer, (cells) => {
    if (!headerSeen) { // Dòng đầu là header (Tên Cột/Kiểu Dữ Liệu/...) — luôn bỏ qua, mẫu tải về cũng theo đúng thứ tự này.
      headerSeen = true;
      sawAnyRow = true;
      return true;
    }
    // Gặp dòng trống là DỪNG hẳn (không đọc tiếp) — mẫu tải về có 1 dòng trống ngăn cách trước dòng ghi
    // chú cuối file, dừng ở đây để không lỡ đọc nhầm dòng ghi chú thành 1 cột.
    const field = rowToBudgetField(cells);
    if (!field) return false;
    fields.push(field);
    return fields.length < 30; // khớp giới hạn tối đa cột tuỳ biến ở sanitizeBudgetCustomFields()
  }, { includeEmpty: true });

  if (!sawAnyRow) throw new HttpError(400, 'File trống, không có dữ liệu cột nào');
  if (!fields.length) throw new HttpError(400, 'Không đọc được cột hợp lệ nào từ file');
  return fields;
}

// Đọc CHỈ dòng tiêu đề của 1 file Excel BẤT KỲ (không theo khuôn định nghĩa cột Tên Cột/Kiểu/Bắt Buộc ở
// trên) — dùng cho nút "📎 Từ File Dữ Liệu Thật": admin có sẵn 1 file ngân sách thật (VD Kế Toán gửi),
// muốn lấy nguyên tên cột trong file đó làm cột của mẫu thay vì gõ tay/điền theo khuôn riêng — cùng cơ
// chế với Mẫu Giá ở module Hỗ Trợ IT (xem lib/priceFileParser.js::parsePriceTemplateColumns()). CHỈ trả
// về tên cột, KHÔNG đọc dữ liệu dòng bên dưới — client tự gán vai trò (Tên Hạng Mục/Số Tiền/Loại NS/Mô Tả
// Chi Tiết) rồi đưa vào bảng cột đang sửa như bình thường (không lưu trực tiếp ở đây).
async function parseArbitraryColumnLabels(buffer) {
  let headerCells = null;
  // includeEmpty: true + dừng ngay sau dòng đầu tiên — giữ đúng ngữ nghĩa cũ "đọc CHÍNH XÁC dòng 1"
  // (sheet.getRow(1)), kể cả khi dòng 1 trống mà dữ liệu bắt đầu từ dòng dưới; đồng thời không đọc quá
  // 1 dòng của file.
  await streamFirstSheetRows(buffer, (cells) => { headerCells = cells; return false; }, { includeEmpty: true });
  const labels = [];
  (headerCells || []).forEach((raw) => {
    const label = String(raw == null ? '' : raw).trim();
    if (label) labels.push(label.slice(0, 100));
  });
  if (!labels.length) throw new HttpError(400, 'File không có dòng tiêu đề nào (dòng 1 trống)');
  if (labels.length > 50) throw new HttpError(400, 'File có quá nhiều cột (tối đa 50 cột)');
  return labels;
}

module.exports = {
  buildBudgetTemplateFieldsWorkbook, parseBudgetTemplateFieldsExcelBuffer, TYPE_LABEL_VN,
  parseArbitraryColumnLabels
};
