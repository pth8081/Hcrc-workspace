// lib/trainingTestImport.js — Tải mẫu Excel "Câu Hỏi" (Ngân Hàng Câu Hỏi, Đào Tạo) + đọc file đã điền để
// trả về xem trước (preview) TRƯỚC khi trainingManage nạp vào danh sách câu hỏi đang soạn dở (tbQuestions
// ở module-internalcomms-daotao.js) — file này CHỈ đọc/xem trước, KHÔNG tự tạo bài test nào: câu hỏi vẫn
// đi qua đúng POST /api/create/trainingTests hiện có (server tự kiểm tra lại toàn bộ ở
// lib/createValidation.js trainingTests.extraValidate — không tin nguyên dữ liệu "đã xem trước" ở bước
// này), cùng nguyên tắc lib/trainingPlanImport.js/lib/trainingRoster.js.
//
// Cột "Ảnh" (tuỳ chọn): CHỈ chấp nhận 1 trong 2 dạng — (a) đường dẫn "/uploads/..." của 1 ảnh ĐÃ tải lên
// hệ thống từ trước (VD dán lại từ cột "Ảnh" của file do exportTrainingTestQuestionsExcel() xuất ra), xác
// minh bằng ĐÚNG regex/độ dài mà assertUploadedFileUrl() (lib/createValidation.js) dùng khi tạo thật —
// KHÔNG dùng regex chép lại gần giống, import trực tiếp hàm đó để 2 nơi không lệch nhau; hoặc (b) 1 tên
// tệp bất kỳ KHÔNG khớp khuôn đó — client (onTrainingTestImportImageFileChange()/
// confirmTrainingTestImport(), module-internalcomms-daotao.js) đối chiếu tên này với danh sách ảnh admin
// đã tải lên TRƯỚC ở cùng màn nhập (qua đúng /api/upload, moduleKey 'trainingTestImage') để tự gắn đúng
// fileUrl thật. CẢ 2 NHÁNH đều CHỈ có thể kết thúc bằng 1 giá trị "/uploads/..." hợp lệ (hoặc rỗng) —
// không có đường nào để 1 URL ngoài hệ thống lọt được vào payload gửi lên POST /api/create/trainingTests,
// và bản thân route đó vẫn xác minh lại lần cuối bằng assertUploadedFileUrl() y hệt.
const ExcelJS = require('exceljs'); // chỉ còn dùng để SINH file mẫu tải xuống; đọc file upload đi qua lib/xlsxSafeRead.js
const { parse: parseCsv } = require('csv-parse/sync');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

async function buildTestImportTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Câu Hỏi');
  sheet.columns = [
    { header: 'Nội Dung Câu Hỏi', key: 'text', width: 40 },
    { header: 'Loại (1 đáp án đúng / Nhiều đáp án đúng)', key: 'type', width: 24 },
    { header: 'Điểm', key: 'points', width: 8 },
    { header: 'Các Đáp Án (cách nhau bằng ;)', key: 'options', width: 45 },
    { header: 'Đáp Án Đúng (số thứ tự, cách nhau bằng ;)', key: 'correct', width: 24 },
    { header: 'Ảnh (đường dẫn /uploads/... hoặc tên tệp đã tải ở bước 2)', key: 'image', width: 32 }
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.addRow({
    text: 'Biển báo này có ý nghĩa gì?',
    type: '1 đáp án đúng',
    points: 1,
    options: 'Cấm rẽ trái; Cấm rẽ phải; Cấm quay đầu; Đường 1 chiều',
    correct: '1',
    image: 'bien-bao-1.png'
  });
  sheet.addRow({
    text: 'Những đâu KHÔNG phải kỹ năng bán hàng cơ bản?',
    type: 'Nhiều đáp án đúng',
    points: 2,
    options: 'Lắng nghe khách hàng; Chào hỏi niềm nở; Cáu gắt khi khách hỏi nhiều; Lơ là khi khách vào cửa hàng',
    correct: '3;4',
    image: ''
  });
  sheet.getRow(2).font = { italic: true, color: { argb: 'FF6B7280' } };
  sheet.getRow(3).font = { italic: true, color: { argb: 'FF6B7280' } };
  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 100;
  noteSheet.addRow(['"Loại": để trống hoặc gõ "1" -> 1 đáp án đúng; gõ "nhiều"/"multi" -> nhiều đáp án đúng.']);
  noteSheet.addRow(['"Các Đáp Án": liệt kê TỪNG đáp án cách nhau bằng dấu chấm phẩy ";" — cần ít nhất 2 đáp án.']);
  noteSheet.addRow(['"Đáp Án Đúng": số thứ tự đáp án ĐÚNG (đếm từ 1) trong đúng danh sách ở cột "Các Đáp Án" — nhiều đáp án đúng thì cách nhau bằng ";", VD "1;3".']);
  noteSheet.addRow(['"Ảnh" (tuỳ chọn): để trống nếu câu hỏi không cần ảnh minh hoạ. Nếu có ảnh, tải ảnh lên TRƯỚC ở bước 2 của màn nhập, rồi gõ ĐÚNG tên tệp gốc của ảnh đó vào cột này (không phân biệt hoa/thường) — hệ thống tự gắn đúng ảnh đã tải khi nạp câu hỏi.']);
  noteSheet.eachRow(row => { row.font = { italic: true, color: { argb: 'FFDC2626' } }; });
  return wb;
}

function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const HEADER_HINTS = {
  text: ['noi dung cau hoi', 'noi dung', 'cau hoi'],
  type: ['loai (1 dap an dung / nhieu dap an dung)', 'loai', 'loai cau hoi'],
  points: ['diem'],
  options: ['cac dap an (cach nhau bang ;)', 'cac dap an', 'dap an'],
  correct: ['dap an dung (so thu tu, cach nhau bang ;)', 'dap an dung', 'so thu tu dap an dung'],
  image: ['anh (duong dan /uploads/... hoac ten tep da tai o buoc 2)', 'anh', 'ten tep anh', 'hinh anh']
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

// 1 dòng dữ liệu -> 1 câu hỏi xem trước, hoặc null nếu coi như dòng trống (không có nội dung câu hỏi).
// CHỈ đọc/tách thô — KHÔNG xác minh imageRef có phải "/uploads/..." hợp lệ hay không ở đây (việc đó để
// client đối chiếu với ảnh đã tải/để server xác minh lần cuối lúc TẠO THẬT, xem chú thích đầu file).
function rowToQuestionItem(cells, cols) {
  const get = (field) => (cols[field] !== undefined ? cells[cols[field]] : '');
  const rawText = get('text');
  if (rawText === '' || rawText == null) return null;
  const text = String(rawText).trim();
  if (!text) return null;

  const typeRaw = normalizeHeader(get('type'));
  const type = /nhieu|multi/.test(typeRaw) ? 'MULTI' : 'SINGLE';

  const pointsNum = Number(get('points'));
  const points = Number.isFinite(pointsNum) && pointsNum > 0 ? pointsNum : 1;

  const options = String(get('options') || '').split(';').map(s => s.trim()).filter(Boolean);

  const correctIndexes = String(get('correct') || '').split(';').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n >= 1);
  const correctIndexesInRange = correctIndexes.filter(n => n <= options.length);

  const imageRef = String(get('image') || '').trim();

  const errors = [];
  if (options.length < 2) errors.push('cần ít nhất 2 đáp án');
  if (!correctIndexesInRange.length) errors.push('chưa xác định đáp án đúng hợp lệ');
  if (type === 'SINGLE' && correctIndexesInRange.length > 1) errors.push('loại "1 đáp án đúng" nhưng lại đánh dấu nhiều hơn 1 đáp án đúng');

  return {
    text, type, points, options,
    correctIndexes: correctIndexesInRange,
    imageRef,
    valid: errors.length === 0,
    errors
  };
}

function rowsToQuestionItems(rows) {
  if (!rows.length) throw new HttpError(400, 'File câu hỏi trống, không có dữ liệu');
  const cols = detectColumns(rows[0]);
  if (cols.text === undefined) {
    throw new HttpError(400, 'Không tìm thấy cột "Nội Dung Câu Hỏi" trong file — vui lòng dùng đúng mẫu tải xuống');
  }
  const items = [];
  for (const cells of rows.slice(1)) {
    const item = rowToQuestionItem(cells, cols);
    if (!item) continue;
    items.push(item);
    if (items.length > 100) throw new HttpError(400, 'File quá nhiều câu hỏi (tối đa 100 câu/lần, khớp giới hạn của 1 bài test)');
  }
  if (!items.length) throw new HttpError(400, 'Không đọc được câu hỏi hợp lệ nào từ file (thiếu cột Nội Dung Câu Hỏi ở mọi dòng?)');
  return items;
}

// raw:true — giữ nguyên giá trị GỐC của ô (số/chuỗi), khớp cùng lý do lib/trainingPlanImport.js.
async function parseTestImportExcelBuffer(buffer) {
  let cols = null;
  let sawAnyRow = false;
  let overLimit = false;
  const items = [];

  await streamFirstSheetRows(buffer, (cells) => {
    if (!sawAnyRow) {
      sawAnyRow = true;
      cols = detectColumns(cells);
      if (cols.text === undefined) {
        throw new HttpError(400, 'Không tìm thấy cột "Nội Dung Câu Hỏi" trong file — vui lòng dùng đúng mẫu tải xuống');
      }
      return true;
    }
    const item = rowToQuestionItem(cells, cols);
    if (item) items.push(item);
    if (items.length > 100) { overLimit = true; return false; }
    return true;
  }, { raw: true });

  if (!sawAnyRow) throw new HttpError(400, 'File câu hỏi trống, không có dữ liệu');
  if (overLimit) throw new HttpError(400, 'File quá nhiều câu hỏi (tối đa 100 câu/lần, khớp giới hạn của 1 bài test)');
  if (!items.length) throw new HttpError(400, 'Không đọc được câu hỏi hợp lệ nào từ file (thiếu cột Nội Dung Câu Hỏi ở mọi dòng?)');
  return items;
}

function parseTestImportCsvBuffer(buffer) {
  const records = parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true, bom: true });
  return rowsToQuestionItems(records);
}

async function parseTestImportFile(buffer, ext) {
  if (ext === '.csv') return parseTestImportCsvBuffer(buffer);
  return parseTestImportExcelBuffer(buffer);
}

module.exports = { buildTestImportTemplateWorkbook, parseTestImportFile };
