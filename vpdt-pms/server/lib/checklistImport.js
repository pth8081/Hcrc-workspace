// lib/checklistImport.js — Tải mẫu Excel "Câu Hỏi Checklist" + đọc file đã điền để trả về xem trước
// (preview) TRƯỚC khi checklistTemplateManage nạp vào danh sách câu hỏi đang soạn dở
// (checklistBuilderQuestions ở module-checklist.js) — mirror ĐÚNG khuôn lib/trainingTestImport.js (file
// đó CHỈ đọc/xem trước, KHÔNG tự tạo template nào: câu hỏi vẫn đi qua đúng POST /api/create/checklistTemplates
// hoặc POST /api/checklist/templates/:id/edit hiện có, server tự kiểm tra lại toàn bộ ở
// lib/checklist.js::validateChecklistQuestions() — không tin nguyên dữ liệu "đã xem trước" ở bước này).
//
// LAYOUT KHÁC lib/trainingTestImport.js: 1 câu hỏi checklist có 2-10 đáp án, MỖI đáp án cần 3 thuộc tính
// riêng (Đạt/Lỗi nghiêm trọng/Điểm) — không gọn được vào 1 ô "options" cách nhau bằng ";" như trắc nghiệm
// (chỉ có đúng/sai). Chọn layout "1 DÒNG = 1 ĐÁP ÁN", các dòng CÙNG 1 câu hỏi nhóm lại theo cột "STT Câu
// Hỏi" — cột thông tin câu hỏi (Nội Dung/Loại/Bắt Buộc/Điểm Tối Đa) CHỈ cần điền ở dòng ĐẦU TIÊN của mỗi
// câu hỏi, để trống ở các dòng đáp án tiếp theo (COI LÀ tiếp tục nhóm câu hỏi hiện tại) — nếu người dùng
// vẫn điền lặp lại giống hệt STT câu hỏi ở mọi dòng cũng được (2 kiểu điền đều nhóm đúng, xem groupRows()).
//
// Cột điểm ("Điểm Tối Đa Câu Hỏi"/"Điểm Đáp Án") CHỈ áp dụng cho checklist CÓ tính điểm (scoringMode
// SCORED) — để TRỐNG nếu checklist chỉ chấm Đạt/Chưa đạt (PASS_FAIL_ONLY), server tự bỏ qua 2 cột này
// trong TRƯỜNG HỢP đó (validateChecklistQuestions() ép về 0, xem lib/checklist.js) nên 1 file mẫu DUY
// NHẤT dùng chung được cho CẢ 2 chế độ, không cần 2 mẫu riêng.
'use strict';

const ExcelJS = require('exceljs'); // chỉ dùng để SINH file mẫu tải xuống; đọc file upload đi qua lib/xlsxSafeRead.js
const { parse: parseCsv } = require('csv-parse/sync');
const { streamFirstSheetRows } = require('./xlsxSafeRead');
const { HttpError } = require('./httpErrors');

const MAX_QUESTIONS_PER_IMPORT = 200; // khớp trần validateChecklistQuestions() (lib/checklist.js)

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

async function buildChecklistImportTemplateWorkbook() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Câu Hỏi');
  sheet.columns = [
    { header: 'STT Câu Hỏi', key: 'qno', width: 10 },
    { header: 'Nội Dung Câu Hỏi (chỉ điền ở dòng đầu của câu)', key: 'text', width: 38 },
    { header: 'Loại (Chọn 1 / Chọn nhiều)', key: 'type', width: 20 },
    { header: 'Bắt Buộc (Có/Không)', key: 'required', width: 15 },
    { header: 'Điểm Tối Đa Câu Hỏi (chỉ cần nếu CÓ tính điểm)', key: 'maxScore', width: 20 },
    { header: 'Nội Dung Đáp Án', key: 'optionText', width: 32 },
    { header: 'Đạt (Có/Không)', key: 'isPassing', width: 14 },
    { header: 'Yêu Cầu Vàng / Lỗi Nghiêm Trọng (Có/Không)', key: 'isCriticalFail', width: 26 },
    { header: 'Điểm Đáp Án (có thể ÂM để trừ điểm, chỉ cần nếu CÓ tính điểm)', key: 'scoreValue', width: 26 }
  ];
  styleHeaderRow(sheet.getRow(1));
  // Ví dụ 1 — câu hỏi thường, có tính điểm, 2 đáp án.
  sheet.addRow({ qno: 1, text: 'Khu vực bán hàng có sạch sẽ, gọn gàng không?', type: 'Chọn 1', required: 'Có', maxScore: 10, optionText: 'Đạt', isPassing: 'Có', isCriticalFail: 'Không', scoreValue: 10 });
  sheet.addRow({ qno: 1, text: '', type: '', required: '', maxScore: '', optionText: 'Không đạt', isPassing: 'Không', isCriticalFail: 'Không', scoreValue: 0 });
  // Ví dụ 2 — câu hỏi "yêu cầu vàng": đáp án "Không đạt" mang điểm ÂM để TRỪ điểm tổng.
  sheet.addRow({ qno: 2, text: 'Có tuân thủ quy định PCCC không? (Yêu cầu vàng)', type: 'Chọn 1', required: 'Có', maxScore: 0, optionText: 'Đạt', isPassing: 'Có', isCriticalFail: 'Không', scoreValue: 0 });
  sheet.addRow({ qno: 2, text: '', type: '', required: '', maxScore: '', optionText: 'Không đạt', isPassing: 'Không', isCriticalFail: 'Có', scoreValue: -20 });
  [2, 3, 4, 5].forEach(r => { sheet.getRow(r).font = { italic: true, color: { argb: 'FF6B7280' } }; });

  const noteSheet = wb.addWorksheet('Ghi Chú');
  noteSheet.getColumn(1).width = 110;
  noteSheet.addRow(['"STT Câu Hỏi": đánh số thứ tự câu hỏi — các đáp án CÙNG 1 câu hỏi phải ghi CÙNG 1 số ở cột này, mỗi đáp án 1 dòng riêng.']);
  noteSheet.addRow(['"Nội Dung Câu Hỏi"/"Loại"/"Bắt Buộc"/"Điểm Tối Đa Câu Hỏi": chỉ cần điền ở DÒNG ĐẦU TIÊN của mỗi câu hỏi — để trống ở các dòng đáp án tiếp theo của CÙNG câu đó.']);
  noteSheet.addRow(['"Loại": để trống hoặc gõ "1"/"Chọn 1" -> chỉ chọn được 1 đáp án; gõ "nhiều"/"Chọn nhiều" -> chọn được nhiều đáp án.']);
  noteSheet.addRow(['"Bắt Buộc": để trống -> mặc định Bắt Buộc. Gõ "Không" nếu câu hỏi không bắt buộc trả lời.']);
  noteSheet.addRow(['"Điểm Tối Đa Câu Hỏi"/"Điểm Đáp Án": CHỈ áp dụng cho checklist CÓ TÍNH ĐIỂM — nếu checklist chỉ chấm Đạt/Chưa đạt (không tính điểm), để TRỐNG cả 2 cột này, hệ thống tự bỏ qua.']);
  noteSheet.addRow(['"Điểm Đáp Án": có thể nhập SỐ ÂM để TRỪ điểm tổng — VD đáp án "Không đạt" của 1 câu hỏi "yêu cầu vàng" quan trọng có thể đặt -20 để trừ 20 điểm nếu chọn đáp án đó.']);
  noteSheet.addRow(['"Đạt": mỗi câu hỏi cần ít nhất 1 đáp án ghi "Có" ở cột này.']);
  noteSheet.addRow(['"Yêu Cầu Vàng / Lỗi Nghiêm Trọng": ghi "Có" nếu chọn đáp án này thì CẢ BÀI checklist bị đánh giá "Không đạt" ngay lập tức, bất kể điểm số.']);
  noteSheet.eachRow(row => { row.font = { italic: true, color: { argb: 'FFDC2626' } }; });
  return wb;
}

function normalizeHeader(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
// Giá trị "Có"/"Yes"/"X"/"1"/"Đạt" (đã qua normalizeHeader) đều coi là TRUE — khớp cách người dùng phổ
// thông hay điền các ô dạng cờ trong Excel, không bắt buộc gõ đúng nguyên văn "Có".
function normalizeYesNo(raw, defaultWhenBlank) {
  const v = normalizeHeader(raw);
  if (!v) return !!defaultWhenBlank;
  return /^(co|yes|true|1|x|dat)$/.test(v);
}

const HEADER_HINTS = {
  qno: ['stt cau hoi', 'stt', 'so thu tu cau hoi'],
  text: ['noi dung cau hoi (chi dien o dong dau cua cau)', 'noi dung cau hoi', 'cau hoi'],
  type: ['loai (chon 1 / chon nhieu)', 'loai', 'loai cau hoi'],
  required: ['bat buoc (co/khong)', 'bat buoc'],
  maxScore: ['diem toi da cau hoi (chi can neu co tinh diem)', 'diem toi da cau hoi', 'diem toi da'],
  optionText: ['noi dung dap an', 'dap an'],
  isPassing: ['dat (co/khong)', 'dat'],
  isCriticalFail: ['yeu cau vang / loi nghiem trong (co/khong)', 'yeu cau vang / loi nghiem trong', 'yeu cau vang', 'loi nghiem trong'],
  scoreValue: ['diem dap an (co the am de tru diem, chi can neu co tinh diem)', 'diem dap an']
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

// Gộp dần TỪNG DÒNG (1 đáp án) vào đúng nhóm câu hỏi đang mở — cùng 1 đối tượng dùng được cho cả đường
// đọc STREAM (Excel, từng dòng 1) lẫn đọc MẢNG SẴN (CSV, đã có đủ toàn bộ cùng lúc).
function makeQuestionGrouper() {
  const groups = [];
  let current = null;
  return {
    addRow(cells, cols) {
      const get = (field) => (cols[field] !== undefined ? cells[cols[field]] : '');
      const qnoRaw = String(get('qno') ?? '').trim();
      const optionText = String(get('optionText') ?? '').trim();
      if (!qnoRaw && !optionText) return; // dòng hoàn toàn trống — bỏ qua
      if (qnoRaw && (!current || String(current.qno) !== qnoRaw)) {
        current = {
          qno: qnoRaw, text: String(get('text') ?? '').trim(), type: get('type'), required: get('required'),
          maxScore: get('maxScore'), rows: []
        };
        groups.push(current);
      }
      if (!current) return; // dòng đáp án xuất hiện trước khi có STT câu hỏi nào — bỏ qua (lỗi định dạng)
      current.rows.push({ optionText, isPassing: get('isPassing'), isCriticalFail: get('isCriticalFail'), scoreValue: get('scoreValue') });
    },
    groups
  };
}

// 1 nhóm dòng (1 câu hỏi + các đáp án) -> 1 item xem trước, kèm valid/errors[] (KHÔNG throw ngay khi gặp
// dòng lỗi — để client hiển thị đầy đủ bảng xem trước trước khi người dùng quyết định nạp câu nào).
function groupToQuestionItem(group) {
  const text = String(group.text || '').trim();
  const typeRaw = normalizeHeader(group.type);
  const type = /nhieu|multi/.test(typeRaw) ? 'MULTIPLE_CHOICE' : 'SINGLE_CHOICE';
  const isRequired = normalizeYesNo(group.required, true);
  const maxScoreNum = Number(group.maxScore);
  const maxScore = Number.isFinite(maxScoreNum) && maxScoreNum >= 0 ? maxScoreNum : 0;

  const options = (group.rows || [])
    .filter(r => String(r.optionText || '').trim())
    .map(r => {
      const scoreNum = Number(r.scoreValue);
      return {
        text: String(r.optionText).trim(),
        isPassing: normalizeYesNo(r.isPassing, true),
        isCriticalFail: normalizeYesNo(r.isCriticalFail, false),
        scoreValue: Number.isFinite(scoreNum) ? scoreNum : 0
      };
    });

  const errors = [];
  if (!text) errors.push('thiếu nội dung câu hỏi');
  if (options.length < 2) errors.push('cần ít nhất 2 đáp án');
  if (options.length > 10) errors.push('tối đa 10 đáp án');
  if (options.length >= 2 && !options.some(o => o.isPassing)) errors.push('cần ít nhất 1 đáp án "Đạt"');

  return { qno: group.qno, text, type, isRequired, maxScore, options, valid: errors.length === 0, errors };
}

function assertColumnsFound(cols) {
  if (cols.text === undefined || cols.optionText === undefined) {
    throw new HttpError(400, 'Không tìm thấy đủ cột "Nội Dung Câu Hỏi"/"Nội Dung Đáp Án" trong file — vui lòng dùng đúng mẫu tải xuống');
  }
}

async function parseChecklistImportExcelBuffer(buffer) {
  let cols = null;
  let sawAnyRow = false;
  const grouper = makeQuestionGrouper();

  await streamFirstSheetRows(buffer, (cells) => {
    if (!sawAnyRow) {
      sawAnyRow = true;
      cols = detectColumns(cells);
      assertColumnsFound(cols);
      return true;
    }
    grouper.addRow(cells, cols);
    if (grouper.groups.length > MAX_QUESTIONS_PER_IMPORT) return false;
    return true;
  }, { raw: true });

  if (!sawAnyRow) throw new HttpError(400, 'File câu hỏi trống, không có dữ liệu');
  if (grouper.groups.length > MAX_QUESTIONS_PER_IMPORT) {
    throw new HttpError(400, `File quá nhiều câu hỏi (tối đa ${MAX_QUESTIONS_PER_IMPORT} câu/lần, khớp giới hạn của 1 checklist)`);
  }
  if (!grouper.groups.length) throw new HttpError(400, 'Không đọc được câu hỏi hợp lệ nào từ file (thiếu cột STT Câu Hỏi/Nội Dung Đáp Án ở mọi dòng?)');
  return grouper.groups.map(groupToQuestionItem);
}

function parseChecklistImportCsvBuffer(buffer) {
  const records = parseCsv(buffer, { skip_empty_lines: true, relax_column_count: true, bom: true });
  if (!records.length) throw new HttpError(400, 'File câu hỏi trống, không có dữ liệu');
  const cols = detectColumns(records[0]);
  assertColumnsFound(cols);
  const grouper = makeQuestionGrouper();
  for (const cells of records.slice(1)) {
    grouper.addRow(cells, cols);
    if (grouper.groups.length > MAX_QUESTIONS_PER_IMPORT) {
      throw new HttpError(400, `File quá nhiều câu hỏi (tối đa ${MAX_QUESTIONS_PER_IMPORT} câu/lần, khớp giới hạn của 1 checklist)`);
    }
  }
  if (!grouper.groups.length) throw new HttpError(400, 'Không đọc được câu hỏi hợp lệ nào từ file (thiếu cột STT Câu Hỏi/Nội Dung Đáp Án ở mọi dòng?)');
  return grouper.groups.map(groupToQuestionItem);
}

async function parseChecklistImportFile(buffer, ext) {
  if (ext === '.csv') return parseChecklistImportCsvBuffer(buffer);
  return parseChecklistImportExcelBuffer(buffer);
}

module.exports = { buildChecklistImportTemplateWorkbook, parseChecklistImportFile };
