// lib/trainingPlanImport.js — Tải mẫu Excel "Kế Hoạch Đào Tạo theo tháng" (Đợt 5) + đọc file đã điền để
// trả về xem trước (preview) TRƯỚC khi HR/Đào Tạo xác nhận tạo thật từng dòng qua POST /api/create/
// trainingPlans (route đó tự kiểm tra lại toàn bộ — tháng/courseId/targetDept — không tin nguyên dữ
// liệu "đã xem trước" ở bước này, cùng nguyên tắc routes/trainingRoster.js). Cùng khuôn
// lib/trainingRoster.js (buildXxxTemplateWorkbook/parseXxxFile qua ExcelJS + csv-parse, dò cột theo tiêu
// đề không phân biệt hoa-thường/dấu) — KHÔNG dùng gói "xlsx" (SheetJS), lý do xem đầu file lib/vppCatalog.js.
const ExcelJS = require('exceljs');
const { parse: parseCsv } = require('csv-parse/sync');
const { HttpError } = require('./httpErrors');

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

async function buildPlanImportTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Kế Hoạch Đào Tạo');
  sheet.columns = [
    { header: 'Tháng (YYYY-MM)', key: 'month', width: 16 },
    { header: 'Chương Trình', key: 'courseName', width: 32 },
    { header: 'Đơn Vị', key: 'targetDept', width: 22 },
    { header: 'Đối Tượng', key: 'audience', width: 26 },
    { header: 'Số Lớp', key: 'plannedClasses', width: 10 },
    { header: 'Số Học Viên', key: 'plannedTrainees', width: 14 },
    { header: 'Thời Lượng (giờ)', key: 'plannedHours', width: 16 }
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({
    month: '2026-09', courseName: 'Kỹ năng bán hàng cơ bản', targetDept: 'Phòng Kinh Doanh',
    audience: 'Nhân viên mới', plannedClasses: 2, plannedTrainees: 40, plannedHours: 16
  });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  // Ghi chú đặt ở SHEET RIÊNG (không phải thêm dòng vào cuối sheet dữ liệu) — parsePlanImportFile() chỉ
  // đọc worksheets[0] nên không cần dò/bỏ qua "dòng ghi chú" lẫn trong dữ liệu như
  // lib/budgetTemplateImport.js phải làm (ở đó ghi chú và dữ liệu buộc phải chung 1 sheet).
  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 100;
  noteSheet.addRow(['"Chương Trình" khớp gần đúng (không phân biệt hoa-thường/dấu) với tên trong Đào Tạo > Chương Trình — không khớp được vẫn nhập kế hoạch bình thường, chỉ để trống liên kết chương trình.']);
  noteSheet.addRow(['"Đơn Vị" phải khớp ĐÚNG tên phòng ban/siêu thị đã có trong hệ thống — để trống nếu kế hoạch không nhắm 1 đơn vị cụ thể.']);
  noteSheet.eachRow(row => { row.font = { italic: true, color: { argb: 'FFDC2626' } }; });
  return wb;
}

// Giống lib/trainingRoster.js normalizeHeader() — xử lý "đ/Đ" riêng vì không có dạng phân rã NFD.
function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Cùng kỹ thuật chuẩn hoá để SO SÁNH NỘI DUNG (không chỉ tiêu đề cột) — dùng để đối chiếu gần đúng tên
// Chương Trình trong file với DB.trainingCourses thật (xem matchCourseByName() bên dưới).
function normalizeForMatch(s) {
  return normalizeHeader(s);
}

const HEADER_HINTS = {
  month: ['thang', 'thang dao tao', 'thang ke hoach', 'thang (yyyy-mm)', 'ky'],
  courseName: ['chuong trinh', 'ten chuong trinh', 'chuong trinh dao tao'],
  targetDept: ['don vi', 'phong ban', 'don vi/phong ban', 'don vi phong ban'],
  audience: ['doi tuong', 'doi tuong dao tao'],
  plannedClasses: ['so lop', 'so lop ke hoach'],
  plannedTrainees: ['so hoc vien', 'so hoc vien ke hoach', 'so luong hoc vien', 'so hoc vien ke hoach du kien'],
  plannedHours: ['thoi luong', 'thoi luong (gio)', 'thoi luong dao tao', 'so gio', 'thoi luong gio']
};

// Dò từng cột theo tiêu đề dòng đầu — KHÁC detectUsernameCol() ở lib/trainingRoster.js (chỉ 1 cột) vì
// mẫu này có nhiều cột; trả về map { field: cột index } cho các field DÒ ĐƯỢC, field nào không dò được
// coi như file không có cột đó (rỗng cho mọi dòng, không chặn — chỉ riêng "month" là bắt buộc phải dò
// được, xem rowsToPlanItems() bên dưới).
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

// "Tháng" chấp nhận vài định dạng phổ biến người dùng có thể gõ/Excel có thể tự đổi (Date thật nếu ô
// được định dạng kiểu ngày) — KHÔNG cố gắng đoán mọi định dạng có thể, chỉ vài dạng thường gặp nhất;
// dạng không nhận ra được giữ nguyên chuỗi gốc để server (normalizeTrainingPlanFields(),
// lib/createValidation.js) tự báo lỗi rõ ràng "không hợp lệ" thay vì âm thầm sai.
function parseMonthCell(raw) {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}`;
  }
  const s = String(raw ?? '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}`;
  return s;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Đối chiếu gần đúng tên Chương Trình trong file với danh mục trainingCourses THẬT (do CALLER đọc sẵn
// truyền vào, xem routes/trainingPlanImport.js) — so khớp CHÍNH XÁC sau khi chuẩn hoá (bỏ dấu/hoa-thường/
// khoảng trắng thừa), KHÔNG so khớp mờ kiểu "chứa 1 phần" (tránh khớp nhầm 2 chương trình tên gần giống
// nhau, vd "Kỹ năng bán hàng cơ bản" vs "Kỹ năng bán hàng nâng cao"). Không khớp được -> null, dòng đó
// vẫn nhập bình thường (chỉ để trống liên kết courseId), KHÔNG chặn cả dòng — quyết định nghiệp vụ: tên
// chương trình trong file có thể là chữ tự do do người lập kế hoạch gõ, không phải lúc nào cũng khớp
// đúng 1 chương trình đã có sẵn trong danh mục.
function matchCourseByName(name, courses) {
  const norm = normalizeForMatch(name);
  if (!norm) return null;
  return (courses || []).find(c => normalizeForMatch(c.name) === norm) || null;
}

function rowsToPlanItems(rows, courses) {
  if (!rows.length) throw new HttpError(400, 'File kế hoạch đào tạo trống, không có dữ liệu');
  const cols = detectColumns(rows[0]);
  if (cols.month === undefined) {
    throw new HttpError(400, 'Không tìm thấy cột "Tháng" trong file — vui lòng dùng đúng mẫu tải xuống');
  }
  const dataRows = rows.slice(1);
  const get = (cells, field) => (cols[field] !== undefined ? cells[cols[field]] : '');
  const toNum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

  const items = [];
  for (const cells of dataRows) {
    const rawMonth = get(cells, 'month');
    // Dòng hoàn toàn không có tháng coi như dòng trống (bỏ qua, không báo lỗi) — khớp cách
    // lib/trainingRoster.js bỏ qua username rỗng.
    if (rawMonth === '' || rawMonth == null) continue;
    const month = parseMonthCell(rawMonth);
    const courseName = String(get(cells, 'courseName') || '').trim();
    const matchedCourse = courseName ? matchCourseByName(courseName, courses) : null;
    items.push({
      month,
      monthValid: MONTH_RE.test(month),
      courseName,
      courseId: matchedCourse ? matchedCourse.id : null,
      courseMatched: !!matchedCourse,
      targetDept: String(get(cells, 'targetDept') || '').trim(),
      audience: String(get(cells, 'audience') || '').trim(),
      plannedClasses: Math.floor(toNum(get(cells, 'plannedClasses'))),
      plannedTrainees: Math.floor(toNum(get(cells, 'plannedTrainees'))),
      plannedHours: toNum(get(cells, 'plannedHours'))
    });
    if (items.length > 500) throw new HttpError(400, 'File quá nhiều dòng (tối đa 500 dòng kế hoạch/lần)');
  }
  if (!items.length) throw new HttpError(400, 'Không đọc được dòng kế hoạch nào hợp lệ từ file (thiếu cột Tháng ở mọi dòng?)');
  return items;
}

async function parsePlanImportExcelBuffer(buffer, courses) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new HttpError(400, 'File Excel không có sheet dữ liệu nào');
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells = [];
    // Giữ nguyên giá trị GỐC (không ép về chuỗi ngay như lib/trainingRoster.js) — cần phân biệt được ô
    // kiểu Date thật (Excel tự đổi khi người dùng gõ dạng ngày) với chuỗi text thường ở parseMonthCell().
    row.eachCell({ includeEmpty: true }, (cell) => { cells.push(cell.value == null ? '' : cell.value); });
    rows.push(cells);
  });
  return rowsToPlanItems(rows, courses);
}

function parsePlanImportCsvBuffer(buffer, courses) {
  const records = parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true, bom: true });
  return rowsToPlanItems(records, courses);
}

// ext: '.xlsx' | '.xls' | '.csv' (đã kiểm tra hợp lệ ở multer fileFilter trước khi gọi hàm này, xem
// routes/trainingPlanImport.js). courses: DB.trainingCourses thật do CALLER đọc sẵn (đối chiếu tên).
async function parsePlanImportFile(buffer, ext, courses) {
  if (ext === '.csv') return parsePlanImportCsvBuffer(buffer, courses);
  return parsePlanImportExcelBuffer(buffer, courses);
}

module.exports = { buildPlanImportTemplateWorkbook, parsePlanImportFile };
