// server/tests/test-checklist-import.js
//
// Test thuần cho lib/checklistImport.js (v20.9 — "Nhập/Tải mẫu/Xuất Excel câu hỏi checklist") — gọi
// thẳng buildChecklistImportTemplateWorkbook()/parseChecklistImportFile(), KHÔNG qua HTTP/browser (cùng
// tinh thần "chỉ đọc/tách thô, KHÔNG tự lưu gì" — persistence thật đi qua validateChecklistQuestions() ở
// lib/checklist.js, đã có test riêng ở tests/test-checklist.js).
//
// Chạy: node server/tests/test-checklist-import.js
'use strict';

const { buildChecklistImportTemplateWorkbook, parseChecklistImportFile } = require('../lib/checklistImport');
const checklist = require('../lib/checklist');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

async function main() {
  // ===== 1. File mẫu tự sinh -> đọc lại đúng nguyên vẹn (round-trip) — bao gồm cả điểm ÂM ở ví dụ 2
  // (câu "yêu cầu vàng") =====
  const wb = await buildChecklistImportTemplateWorkbook();
  const templateBuffer = await wb.xlsx.writeBuffer();
  const templateItems = await parseChecklistImportFile(templateBuffer, '.xlsx');
  check('File mẫu tự sinh đọc lại đúng 2 câu hỏi ví dụ', templateItems.length === 2, templateItems.length);
  check('Câu 1 (ví dụ thường): 2 đáp án, cả 2 hợp lệ', templateItems[0].valid && templateItems[0].options.length === 2, templateItems[0]);
  check('Câu 2 (ví dụ "yêu cầu vàng"): đáp án "Không đạt" mang điểm ÂM (-20) VÀ cờ Lỗi nghiêm trọng', templateItems[1].options[1].scoreValue === -20 && templateItems[1].options[1].isCriticalFail === true, templateItems[1]);
  check('Câu 2 hợp lệ (đủ 1 đáp án "Đạt")', templateItems[1].valid, templateItems[1]);

  // ===== 2. Câu hỏi hợp lệ đọc từ file mẫu phải đi qua được validateChecklistQuestions() thật (không
  // chỉ "trông có vẻ hợp lệ" ở preview mà server thật lại từ chối) — mirror ĐÚNG nguyên tắc "preview chỉ
  // tham khảo, persistence luôn xác minh lại từ đầu" của lib/trainingTestImport.js. =====
  const asRealQuestions = templateItems.map(it => ({
    text: it.text, type: it.type, isRequired: it.isRequired, maxScore: it.maxScore,
    options: it.options.map(o => ({ text: o.text, isPassing: o.isPassing, isCriticalFail: o.isCriticalFail, scoreValue: o.scoreValue }))
  }));
  let acceptedByRealValidator = false;
  try {
    const validated = checklist.validateChecklistQuestions(asRealQuestions, 'SCORED');
    acceptedByRealValidator = validated.length === 2 && validated[1].options[1].scoreValue === -20;
  } catch (e) { acceptedByRealValidator = false; }
  check('Câu hỏi parse từ file mẫu được validateChecklistQuestions() THẬT chấp nhận nguyên vẹn (kể cả điểm âm)', acceptedByRealValidator);

  // ===== 3. Nhóm nhiều đáp án (>2) theo đúng STT câu hỏi, kể cả khi người dùng gõ LẶP LẠI cùng STT ở
  // mọi dòng (không để trống) — 2 kiểu điền phải nhóm ra kết quả GIỐNG HỆT nhau =====
  async function buildAndParse(rows) {
    const ExcelJS = require('exceljs');
    const wb2 = new ExcelJS.Workbook();
    const sheet = wb2.addWorksheet('Câu Hỏi');
    sheet.addRow(['STT Câu Hỏi', 'Nội Dung Câu Hỏi', 'Loại (Chọn 1 / Chọn nhiều)', 'Bắt Buộc (Có/Không)', 'Điểm Tối Đa Câu Hỏi (chỉ cần nếu CÓ tính điểm)', 'Nội Dung Đáp Án', 'Đạt (Có/Không)', 'Yêu Cầu Vàng / Lỗi Nghiêm Trọng (Có/Không)', 'Điểm Đáp Án (có thể ÂM để trừ điểm, chỉ cần nếu CÓ tính điểm)']);
    rows.forEach(r => sheet.addRow(r));
    const buf = await wb2.xlsx.writeBuffer();
    return parseChecklistImportFile(buf, '.xlsx');
  }

  const blankContinuation = await buildAndParse([
    [1, 'Câu hỏi 3 đáp án', 'Chọn nhiều', 'Có', 5, 'Đáp án A', 'Có', 'Không', 5],
    ['', '', '', '', '', 'Đáp án B', 'Có', 'Không', 3],
    ['', '', '', '', '', 'Đáp án C', 'Không', 'Không', 0]
  ]);
  check('Kiểu điền "để trống dòng tiếp theo": nhóm đúng 1 câu hỏi, 3 đáp án', blankContinuation.length === 1 && blankContinuation[0].options.length === 3, blankContinuation);

  const repeatedQno = await buildAndParse([
    [1, 'Câu hỏi 3 đáp án', 'Chọn nhiều', 'Có', 5, 'Đáp án A', 'Có', 'Không', 5],
    [1, '', '', '', '', 'Đáp án B', 'Có', 'Không', 3],
    [1, '', '', '', '', 'Đáp án C', 'Không', 'Không', 0]
  ]);
  check('Kiểu điền "lặp lại cùng STT ở mọi dòng": nhóm ra KẾT QUẢ GIỐNG HỆT kiểu để trống', JSON.stringify(repeatedQno) === JSON.stringify(blankContinuation), { repeatedQno, blankContinuation });

  // ===== 4. Dòng lỗi (thiếu "Đạt", quá ít đáp án) bị đánh dấu invalid + nêu rõ lý do, KHÔNG throw ngay
  // (để client hiện đủ bảng xem trước, người dùng tự quyết định nạp câu nào) =====
  const withErrors = await buildAndParse([
    [1, 'Câu chỉ có 1 đáp án (lỗi: cần ít nhất 2)', 'Chọn 1', 'Có', 5, 'Chỉ 1 đáp án', 'Có', 'Không', 5],
    [2, 'Câu thiếu đáp án Đạt (lỗi)', 'Chọn 1', 'Có', 5, 'Đáp án 1', 'Không', 'Không', 0],
    ['', '', '', '', '', 'Đáp án 2', 'Không', 'Không', 0],
    [3, 'Câu hợp lệ', 'Chọn 1', 'Có', 5, 'Đạt', 'Có', 'Không', 5],
    ['', '', '', '', '', 'Không đạt', 'Không', 'Không', 0]
  ]);
  check('Đủ 3 nhóm câu hỏi được nhận diện', withErrors.length === 3, withErrors.length);
  check('Câu 1 (chỉ 1 đáp án) -> invalid, nêu đúng lý do', !withErrors[0].valid && withErrors[0].errors.some(e => e.includes('ít nhất 2 đáp án')), withErrors[0]);
  check('Câu 2 (thiếu đáp án Đạt) -> invalid, nêu đúng lý do', !withErrors[1].valid && withErrors[1].errors.some(e => e.includes('Đạt')), withErrors[1]);
  check('Câu 3 (hợp lệ) -> valid, KHÔNG bị ảnh hưởng bởi lỗi ở 2 câu trước', withErrors[2].valid, withErrors[2]);

  // ===== 5. Chọn nhiều/Bắt buộc mặc định + nhận diện linh hoạt cách gõ (không phân biệt hoa/thường,
  // không dấu) =====
  const flexible = await buildAndParse([
    [1, 'Câu chọn nhiều, để trống Bắt Buộc (mặc định Bắt Buộc)', 'chọn nhiều', '', '', 'A', 'co', 'khong', ''],
    ['', '', '', '', '', 'B', 'CÓ', 'KHÔNG', '']
  ]);
  check('Loại "chọn nhiều" (không dấu, thường) -> nhận đúng MULTIPLE_CHOICE', flexible[0].type === 'MULTIPLE_CHOICE', flexible[0]);
  check('Để trống "Bắt Buộc" -> mặc định isRequired=true', flexible[0].isRequired === true, flexible[0]);
  check('"co"/"CÓ" (không dấu/hoa thường khác nhau) đều nhận đúng isPassing=true', flexible[0].options[0].isPassing === true && flexible[0].options[1].isPassing === true, flexible[0]);

  // ===== 6. Quá trần 200 câu hỏi/lần nhập bị chặn rõ ràng =====
  const tooManyRows = [];
  for (let i = 1; i <= 201; i++) {
    tooManyRows.push([i, `Câu ${i}`, 'Chọn 1', 'Có', 5, 'Đạt', 'Có', 'Không', 5]);
    tooManyRows.push(['', '', '', '', '', 'Không đạt', 'Không', 'Không', 0]);
  }
  let overLimitError = null;
  try { await buildAndParse(tooManyRows); } catch (e) { overLimitError = e; }
  check('Quá 200 câu hỏi/lần nhập bị chặn (400) với thông báo rõ ràng', !!overLimitError && overLimitError.status === 400 && /tối đa 200/i.test(overLimitError.message), overLimitError && { status: overLimitError.status, message: overLimitError.message });

  // ===== 7. Định dạng CSV (song song với Excel, cùng layout) =====
  const csvBuffer = Buffer.from(
    'STT Câu Hỏi,Nội Dung Câu Hỏi,Loại (Chọn 1 / Chọn nhiều),Bắt Buộc (Có/Không),Điểm Tối Đa Câu Hỏi (chỉ cần nếu CÓ tính điểm),Nội Dung Đáp Án,Đạt (Có/Không),Yêu Cầu Vàng / Lỗi Nghiêm Trọng (Có/Không),Điểm Đáp Án (có thể ÂM để trừ điểm, chỉ cần nếu CÓ tính điểm)\n' +
    '1,Câu hỏi CSV,Chọn 1,Có,10,Đạt,Có,Không,10\n' +
    ',,,,,Không đạt,Không,Không,0\n', 'utf-8');
  const csvItems = await parseChecklistImportFile(csvBuffer, '.csv');
  check('Đọc được file CSV cùng layout, đúng 1 câu hỏi 2 đáp án', csvItems.length === 1 && csvItems[0].options.length === 2, csvItems);
  check('CSV: câu hỏi hợp lệ', csvItems[0].valid, csvItems[0]);

  console.log(`\n${pass} pass, ${fail} fail`);
  if (fail > 0) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
