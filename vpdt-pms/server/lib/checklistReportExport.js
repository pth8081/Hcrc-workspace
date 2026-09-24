// lib/checklistReportExport.js — Xuất báo cáo Checklist (v21.1) THEO ĐÚNG 2 mẫu người dùng gửi:
//   1. QA (Câu Hỏi & Đáp Án, "checklist siêu thị tự đánh giá Đạt/Không đạt") — mirror ĐÚNG layout file
//      "form_xuat_can.xlsx" người dùng gửi: sheet chi tiết (Thời gian báo cáo/Người gửi báo cáo/ST/Nội
//      dung/Vấn đề cần xử lý/Mô tả lý do chưa đạt/Thời gian hoàn thành) + sheet thống kê (% Đạt theo
//      từng Nhóm câu hỏi, field `category` tuỳ chọn ở lib/checklist.js).
//   2. DEDUCTION (Trừ Điểm Theo Hạng Mục, mẫu VSATTP) — mirror cấu trúc cây Hạng Mục Lớn/Hạng Mục Con/
//      Tiêu Chí gốc, mỗi lượt kiểm tra (1 checklistSubmissions) là 1 khối dòng riêng trong CÙNG 1 sheet
//      của siêu thị đó (quyết định đã chốt trước đây: 1 "Lần kiểm tra" = 1 bài nộp riêng, KHÔNG gộp vào
//      1 bài — xem TEMPLATE_KINDS/lib/checklist.js).
//
// Xuất được 1 HOẶC NHIỀU siêu thị cùng lúc — MỖI SIÊU THỊ 1 SHEET RIÊNG (yêu cầu người dùng: "có thể
// chọn nhiều siêu thị hoặc all siêu thị thì có thể mỗi st là một tab") — mỗi siêu thị có 1 cặp sheet
// "<Mã ST> - Chi tiết" / "<Mã ST> - Thống kê" (QA) hoặc 1 sheet "<Mã ST>" (DEDUCTION).
//
// "Thời gian hoàn thành" (QA) — quyết định TRƯỚC ĐÂY (v21.1): để trống, không thêm field mới. ĐÃ ĐỔI
// (10/2026, yêu cầu người dùng — đợt "xuất Excel Checklist ST/CH giống báo cáo qua web cũ"): thêm hẳn
// field `answers[].deadline` (xem sanitizeChecklistAnswers(), lib/checklist.js) cho câu trả lời Chưa
// đạt, nhập tại form làm bài (renderChecklistSubmissionForm(), module-checklist.js) — cột này giờ có
// dữ liệu thật khi câu trả lời là "Không đạt", vẫn để trống cho câu "Đạt"/chưa trả lời.
//
// 3 sheet MỚI cho mẫu QA (10/2026, cùng đợt trên — mirror file mẫu người dùng gửi "BÁO CÁO CHECKLIST QUA
// WEB.xlsx": sheet "Data thô" yêu cầu "xuất theo chiều DỌC, không kéo dài các cột" gộp MỌI siêu thị vào 1
// sheet + sheet "Recap" chỉ lọc riêng các mục CHƯA ĐẠT cần xử lý) — THÊM VÀO, KHÔNG THAY các sheet riêng
// từng ST đã có ở trên (xác nhận người dùng: giữ nguyên cấu trúc cũ để gửi riêng từng ST, sheet gộp mới
// phục vụ mục đích lọc/pivot toàn bộ):
//   - "Dữ Liệu Chi Tiết (Gộp)" — addQaCombinedDetailSheet(): TẤT CẢ siêu thị trong 1 sheet, mỗi dòng = 1
//     câu hỏi của 1 lượt nộp, đúng khuôn sheet "Data thô" (ID lượt nộp/Ngày gửi/Người thực hiện/Tên siêu
//     thị/Nội dung cần check/Đạt-Chưa đạt/Chi tiết chưa đạt/Thời hạn hoàn thành) — KHÔNG có cột "Chức
//     danh" như file mẫu gốc (checklistSubmissions không lưu field này, chỉ có submittedByName; thêm cột
//     này cần tra chéo `users[].jobTitle` theo submittedByUsername — nằm ngoài phạm vi đợt này).
//   - "Recap - Cần Xử Lý" — addQaRecapSheet(): CHỈ liệt các câu Không đạt, đúng khuôn sheet "Recap" (Siêu
//     thị/Vấn đề chưa đạt/Ngày chưa đạt/Thời hạn hoàn thành).
//   - "Top Xếp Hạng" — addQaTopRankingSheet(): 2 bảng song song "Nhiều Không đạt nhất" (cảnh báo) và "Tỷ
//     lệ Đạt cao nhất" (vinh danh), mirror tinh thần Top 5 của Dashboard VSATTP nhưng đếm theo SỐ CÂU
//     thay vì % điểm (mẫu QA PASS_FAIL_ONLY không có scorePercent).
'use strict';

const ExcelJS = require('exceljs');
const { excelFormulaGuard } = require('./adminExport');
const { computeQaStoreStats, computeQaTopLists, computeChecklistCoverage } = require('./checklist');

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1A983' } };
const CATEGORY_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF6C6AC' } };
const FONT = { name: 'Times New Roman', size: 11 };

// Tên sheet Excel: tối đa 31 ký tự, không chứa \ / ? * [ ] : — và KHÔNG được trùng nhau trong 1 workbook
// (2 siêu thị có mã trùng 31 ký tự đầu sau khi cắt vẫn phải phân biệt được).
function safeSheetName(name, usedNames) {
  const base = String(name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  let n = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function guard(v) { return excelFormulaGuard(v == null ? '' : String(v)); }

// ===================== LOẠI 1: QA (Câu Hỏi & Đáp Án) =====================
function computeVisibleQuestionsForAnswers(template, answers) {
  const selectedOptionIds = new Set();
  (answers || []).forEach(a => (a.optionIds || []).forEach(id => selectedOptionIds.add(id)));
  return (template.questions || [])
    .filter(q => q.showIfOptionId == null || selectedOptionIds.has(q.showIfOptionId))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

// null = câu hỏi CHƯA được trả lời (VD câu dùng làm "tiêu đề nhóm" không bắt buộc, cố tình bỏ trống) —
// khớp đúng cách mẫu gốc để trống toàn bộ cột kết quả/lý do/hoàn thành ở những dòng này.
function questionResultLabel(question, answer) {
  if (!answer || !(answer.optionIds || []).length) return null;
  const selected = (question.options || []).filter(o => (answer.optionIds || []).includes(o.id));
  const passing = selected.length > 0 && selected.every(o => o.isPassing && !o.isCriticalFail);
  return passing ? 'Đạt' : 'Không đạt';
}

function addQaDetailSheet(wb, sheetName, template, submissions) {
  const sheet = wb.addWorksheet(sheetName);
  sheet.columns = [
    { header: 'Thời gian báo cáo', width: 16 }, { header: 'Người gửi báo cáo', width: 20 },
    { header: 'ST', width: 18 }, { header: 'Nội dung', width: 45 },
    { header: 'Vấn đề cần xử lý', width: 16 }, { header: 'Mô tả lý do chưa đạt', width: 26 },
    { header: 'Thời gian hoàn thành', width: 22 }
  ];
  const headerRow = sheet.getRow(1);
  headerRow.font = { ...FONT, bold: true };
  headerRow.eachCell(cell => { cell.fill = HEADER_FILL; });

  submissions.forEach((sub, subIdx) => {
    if (subIdx > 0) sheet.addRow([]);
    const visible = computeVisibleQuestionsForAnswers(template, sub.answers);
    const answersByQ = new Map((sub.answers || []).map(a => [a.questionId, a]));
    let lastCategory = null;
    visible.forEach(q => {
      const cat = q.category || '';
      if (cat && cat !== lastCategory) {
        const row = sheet.addRow([guard(sub.submittedAt), guard(sub.submittedByName), guard(sub.storeCode), guard(cat), '', '', '']);
        row.font = { ...FONT, bold: true };
        row.eachCell(cell => { cell.fill = CATEGORY_FILL; });
      }
      lastCategory = cat;
      const ans = answersByQ.get(q.id);
      const result = questionResultLabel(q, ans);
      const row = sheet.addRow([
        guard(sub.submittedAt), guard(sub.submittedByName), guard(sub.storeCode), guard(q.text),
        result || '', result === 'Không đạt' ? guard(ans?.note || '') : '',
        result === 'Không đạt' ? guard(ans?.deadline || '') : ''
      ]);
      row.font = FONT;
    });
  });
  return sheet;
}

function addQaStatsSheet(wb, sheetName, template, submissions) {
  const sheet = wb.addWorksheet(sheetName);
  sheet.columns = [{ header: 'Nội dung', width: 55 }, { header: 'Kết qủa', width: 14 }];
  const headerRow = sheet.getRow(1);
  headerRow.font = { ...FONT, bold: true };
  headerRow.eachCell(cell => { cell.fill = HEADER_FILL; });

  // Gộp câu trả lời của TOÀN BỘ submissions (siêu thị + khoảng ngày đã lọc) theo category — thứ tự nhóm
  // theo lần đầu xuất hiện trong template (không phải theo submission), khớp đúng cách sheet "form thống
  // kê" gốc liệt kê category theo đúng thứ tự trong checklist, không phải theo thời gian nộp bài.
  const categoryOrder = [];
  const seenCategories = new Set();
  (template.questions || []).sort((a, b) => a.displayOrder - b.displayOrder).forEach(q => {
    const cat = q.category || '';
    if (cat && !seenCategories.has(cat)) { seenCategories.add(cat); categoryOrder.push(cat); }
  });

  const tally = new Map(); // category -> {passed, total}
  let ungroupedTally = { passed: 0, total: 0 };
  submissions.forEach(sub => {
    const visible = computeVisibleQuestionsForAnswers(template, sub.answers);
    const answersByQ = new Map((sub.answers || []).map(a => [a.questionId, a]));
    visible.forEach(q => {
      const result = questionResultLabel(q, answersByQ.get(q.id));
      if (result === null) return; // chưa trả lời -> không tính vào % (không phải câu hỏi thật)
      const cat = q.category || '';
      const bucket = cat ? (tally.get(cat) || { passed: 0, total: 0 }) : ungroupedTally;
      bucket.total += 1;
      if (result === 'Đạt') bucket.passed += 1;
      if (cat) tally.set(cat, bucket);
    });
  });

  categoryOrder.forEach(cat => {
    const t = tally.get(cat);
    const pct = t && t.total > 0 ? `${((t.passed / t.total) * 100).toFixed(1)}%` : '—';
    const row = sheet.addRow([guard(cat), pct]);
    row.font = FONT;
  });
  if (ungroupedTally.total > 0) {
    const pct = `${((ungroupedTally.passed / ungroupedTally.total) * 100).toFixed(1)}%`;
    const row = sheet.addRow(['Câu hỏi khác (không thuộc nhóm)', pct]);
    row.font = FONT;
  }
  return sheet;
}

// "Dữ Liệu Chi Tiết (Gộp)" (10/2026) — TẤT CẢ siêu thị trong 1 sheet DUY NHẤT, mỗi dòng = 1 câu hỏi của
// 1 lượt nộp, xếp DỌC nối tiếp nhau theo đúng thứ tự Map submissionsByStore (đã sort theo storeCode khi
// duyệt qua Map.entries() — JS Map giữ thứ tự chèn, buildQaReportWorkbook() bên dưới chèn theo thứ tự đã
// nhận từ route, route nhóm theo storeCode xuất hiện trước trong danh sách submissions gốc). Mirror ĐÚNG
// khuôn sheet "Data thô" file mẫu người dùng gửi ("Yêu cầu: Dữ liệu xuất theo chiều dọc, không kéo dài
// các cột") — id lượt nộp riêng để người đọc lọc/pivot lại theo từng lượt nộp trong Excel.
function addQaCombinedDetailSheet(wb, sheetName, template, submissionsByStore) {
  const sheet = wb.addWorksheet(sheetName);
  sheet.columns = [
    { header: 'ID Lượt Nộp', width: 12 }, { header: 'Ngày Gửi', width: 16 }, { header: 'Người Thực Hiện', width: 22 },
    { header: 'Tên Siêu Thị', width: 18 }, { header: 'Nội Dung Cần Check', width: 45 },
    { header: 'Đạt/Chưa Đạt', width: 14 }, { header: 'Chi Tiết Chưa Đạt', width: 28 }, { header: 'Thời Hạn Hoàn Thành', width: 18 }
  ];
  const headerRow = sheet.getRow(1);
  headerRow.font = { ...FONT, bold: true };
  headerRow.eachCell(cell => { cell.fill = HEADER_FILL; });

  for (const submissions of submissionsByStore.values()) {
    submissions.forEach(sub => {
      const visible = computeVisibleQuestionsForAnswers(template, sub.answers);
      const answersByQ = new Map((sub.answers || []).map(a => [a.questionId, a]));
      visible.forEach(q => {
        const ans = answersByQ.get(q.id);
        const result = questionResultLabel(q, ans);
        if (result === null) return; // chưa trả lời -> không đưa vào sheet gộp (không phải câu hỏi thật)
        const row = sheet.addRow([
          sub.id, guard(sub.submittedAt), guard(sub.submittedByName), guard(sub.storeCode), guard(q.text),
          result, result === 'Không đạt' ? guard(ans?.note || '') : '',
          result === 'Không đạt' ? guard(ans?.deadline || '') : ''
        ]);
        row.font = FONT;
      });
    });
  }
  return sheet;
}

// "Recap - Cần Xử Lý" (10/2026) — CHỈ liệt các câu Không đạt (bỏ qua Đạt/chưa trả lời), mirror ĐÚNG khuôn
// sheet "Recap" file mẫu ("Chỉ lọc những vấn đề chưa đạt, cần xử lý vào bảng Recap").
function addQaRecapSheet(wb, sheetName, template, submissionsByStore) {
  const sheet = wb.addWorksheet(sheetName);
  sheet.columns = [
    { header: 'Siêu Thị', width: 18 }, { header: 'Vấn Đề Chưa Đạt', width: 45 },
    { header: 'Ngày Chưa Đạt', width: 16 }, { header: 'Thời Hạn Hoàn Thành', width: 18 }
  ];
  const headerRow = sheet.getRow(1);
  headerRow.font = { ...FONT, bold: true };
  headerRow.eachCell(cell => { cell.fill = HEADER_FILL; });

  for (const submissions of submissionsByStore.values()) {
    submissions.forEach(sub => {
      const visible = computeVisibleQuestionsForAnswers(template, sub.answers);
      const answersByQ = new Map((sub.answers || []).map(a => [a.questionId, a]));
      visible.forEach(q => {
        const ans = answersByQ.get(q.id);
        if (questionResultLabel(q, ans) !== 'Không đạt') return;
        const row = sheet.addRow([guard(sub.storeCode), guard(q.text), guard(sub.submittedAt), guard(ans?.deadline || '')]);
        row.font = FONT;
      });
    });
  }
  if (sheet.rowCount === 1) {
    const row = sheet.addRow(['Không có mục nào Chưa đạt trong phạm vi đã lọc.', '', '', '']);
    row.font = { ...FONT, italic: true };
  }
  return sheet;
}

// "Top Xếp Hạng" (10/2026) — 2 bảng SONG SONG: "Nhiều Không đạt nhất" (cảnh báo) + "Tỷ lệ Đạt cao nhất"
// (vinh danh), mirror computeQaTopLists() (lib/checklist.js, nguồn sự thật dùng chung với Top ranking
// hiển thị trên tab Báo Cáo Checklist ST/CH).
function addQaTopRankingSheet(wb, sheetName, allSubmissions, template) {
  const sheet = wb.addWorksheet(sheetName);
  sheet.columns = [{ width: 8 }, { width: 22 }, { width: 16 }, { width: 4 }, { width: 8 }, { width: 22 }, { width: 16 }];
  let row = 1;
  const storeStats = computeQaStoreStats(allSubmissions, () => template);
  const { topIssues, topHonor } = computeQaTopLists(storeStats, 5);

  const titleIssues = sheet.getCell(row, 1); titleIssues.value = guard('⚠️ Top 5 Siêu Thị Nhiều Không Đạt Nhất'); titleIssues.font = { ...FONT, bold: true, size: 12 };
  const titleHonor = sheet.getCell(row, 5); titleHonor.value = guard('🏆 Top 5 Siêu Thị Tỷ Lệ Đạt Cao Nhất'); titleHonor.font = { ...FONT, bold: true, size: 12 };
  row += 1;
  const headRow = sheet.getRow(row);
  headRow.getCell(1).value = 'STT'; headRow.getCell(2).value = 'Siêu Thị'; headRow.getCell(3).value = 'Số Câu Không Đạt';
  headRow.getCell(5).value = 'STT'; headRow.getCell(6).value = 'Siêu Thị'; headRow.getCell(7).value = 'Tỷ Lệ Đạt (%)';
  headRow.font = { ...FONT, bold: true };
  [1, 2, 3, 5, 6, 7].forEach(c => { headRow.getCell(c).fill = HEADER_FILL; });
  row += 1;
  const maxRows = Math.max(topIssues.length, topHonor.length, 1);
  for (let i = 0; i < maxRows; i++) {
    const r = sheet.getRow(row + i);
    if (topIssues[i]) { r.getCell(1).value = i + 1; r.getCell(2).value = guard(topIssues[i].storeCode); r.getCell(3).value = topIssues[i].failed; }
    if (topHonor[i]) { r.getCell(5).value = i + 1; r.getCell(6).value = guard(topHonor[i].storeCode); r.getCell(7).value = Number(topHonor[i].passRate.toFixed(1)); }
    r.font = FONT;
  }
  if (!topIssues.length) sheet.getCell(row, 2).value = 'Không có dữ liệu.';
  if (!topHonor.length) sheet.getCell(row, 6).value = 'Không có dữ liệu.';
  return sheet;
}

// "Đã Làm-Chưa Làm" (10/2026) — sheet RIÊNG cho export-report QA (VSATTP gộp chung vào sheet "Dashboard"
// có sẵn qua addCoverageTable(), ở đây tách sheet riêng vì QA không có sheet Dashboard tổng hợp nào).
function addQaCoverageSheet(wb, sheetName, coverage) {
  const sheet = wb.addWorksheet(sheetName);
  sheet.columns = [{ width: 60 }, { width: 24 }, { width: 14 }, { width: 14 }];
  addCoverageTable(sheet, 1, coverage);
  return sheet;
}

// submissionsByStore: Map<storeCode, checklistSubmissions[]> (đã lọc đúng phạm vi/khoảng ngày, mỗi mảng
// nên sắp xếp tăng dần theo submittedAt trước khi truyền vào — hàm này KHÔNG tự sắp xếp lại). coverage
// (tuỳ chọn, 10/2026) — {doneCodes, notDoneCodes, byDay, byMonth} từ computeChecklistCoverage()
// (lib/checklist.js), truyền vào để thêm sheet "Đã Làm-Chưa Làm"; bỏ qua (undefined) nếu route gọi
// không cần (không phá vỡ call site cũ).
function buildQaReportWorkbook(template, submissionsByStore, coverage) {
  const wb = new ExcelJS.Workbook();
  const usedNames = new Set();
  // 4 sheet gộp MỚI (10/2026) đặt NGAY ĐẦU workbook (usedNames seed trước để không trùng tên với sheet
  // riêng từng ST bên dưới, dù trùng khả năng rất thấp do storeCode hiếm khi trùng các tên cố định này).
  const allSubmissions = [...submissionsByStore.values()].flat();
  if (allSubmissions.length) {
    addQaCombinedDetailSheet(wb, safeSheetName('Dữ Liệu Chi Tiết (Gộp)', usedNames), template, submissionsByStore);
    addQaRecapSheet(wb, safeSheetName('Recap - Cần Xử Lý', usedNames), template, submissionsByStore);
    addQaTopRankingSheet(wb, safeSheetName('Top Xếp Hạng', usedNames), allSubmissions, template);
    if (coverage) addQaCoverageSheet(wb, safeSheetName('Đã Làm-Chưa Làm', usedNames), coverage);
  }
  for (const [storeCode, submissions] of submissionsByStore.entries()) {
    if (!submissions.length) continue;
    const detailName = safeSheetName(`${storeCode} - Chi tiết`, usedNames);
    const statsName = safeSheetName(`${storeCode} - Thống kê`, usedNames);
    addQaDetailSheet(wb, detailName, template, submissions);
    addQaStatsSheet(wb, statsName, template, submissions);
  }
  if (!wb.worksheets.length) wb.addWorksheet('Không có dữ liệu');
  return wb;
}

// ===================== LOẠI 2: DEDUCTION (Trừ Điểm Theo Hạng Mục, mẫu VSATTP) =====================
// getTemplateForSub(sub) — TÁCH tham số này ra khỏi 1 template CỐ ĐỊNH (bản gốc trước 10/2026) để dùng
// chung được cho cả buildDeductionReportWorkbook() (luôn đúng 1 mẫu, do route bắt buộc chọn) LẪN
// buildVsattpDashboardWorkbook() (nhiều siêu thị có thể có bài nộp từ NHIỀU mẫu DEDUCTION khác nhau —
// Dashboard VSATTP áp dụng cho MỌI mẫu templateKind==='DEDUCTION', không riêng 1 mẫu, xem lib/checklist.js).
function addDeductionStoreSheet(wb, sheetName, submissions, getTemplateForSub) {
  const sheet = wb.addWorksheet(sheetName);
  sheet.columns = [
    { header: 'Ngày kiểm tra', width: 16 }, { header: 'Người kiểm tra', width: 20 }, { header: 'Mẫu Checklist', width: 22 },
    { header: 'Hạng Mục Lớn', width: 26 }, { header: 'Hạng Mục Con', width: 24 }, { header: 'Tiêu Chí', width: 40 },
    { header: 'Điểm Tối Đa', width: 12 }, { header: 'Điểm Trừ Thực Tế', width: 14 },
    { header: 'Mô Tả Nội Dung Không Phù Hợp', width: 30 }, { header: 'Mức Độ Rủi Ro', width: 12 },
    { header: 'Thời Hạn Hoàn Thành', width: 16 }, { header: 'Ghi Chú', width: 24 }
  ];
  const headerRow = sheet.getRow(1);
  headerRow.font = { ...FONT, bold: true };
  headerRow.eachCell(cell => { cell.fill = HEADER_FILL; });

  submissions.forEach((sub, subIdx) => {
    if (subIdx > 0) sheet.addRow([]);
    const template = getTemplateForSub(sub);
    const summaryRow = sheet.addRow([
      guard(sub.submittedAt), guard(sub.submittedByName), guard(sub.templateName), '', '', '',
      '', '', `Tổng điểm: ${sub.totalScore ?? '—'}/${sub.maxPossibleScore ?? '—'}` + (sub.scorePercent != null ? ` (${sub.scorePercent.toFixed(1)}%)` : ''),
      '', '', ''
    ]);
    summaryRow.font = { ...FONT, bold: true, italic: true };
    if (!template) return; // mẫu gốc đã bị xoá — vẫn giữ dòng tổng điểm, không có cây tiêu chí để liệt kê chi tiết.

    const deductionsByC = new Map((sub.deductions || []).map(d => [d.criteriaId, d]));
    (template.categories || []).forEach(cat => {
      (cat.subItems || []).forEach(sub2 => {
        const effectiveMax = sub2.maxDeduction != null ? sub2.maxDeduction : cat.maxDeduction;
        (sub2.criteria || []).forEach(c => {
          const d = deductionsByC.get(c.id);
          const row = sheet.addRow([
            '', '', '', guard(cat.name), guard(sub2.name), guard(c.description),
            effectiveMax, d?.deductedPoints || 0, guard(d?.description || ''), guard(d?.riskLevel || ''),
            guard(d?.deadline || ''), guard(d?.note || '')
          ]);
          row.font = FONT;
        });
      });
    });
  });
  return sheet;
}

function buildDeductionReportWorkbook(template, submissionsByStore) {
  const wb = new ExcelJS.Workbook();
  const usedNames = new Set();
  for (const [storeCode, submissions] of submissionsByStore.entries()) {
    if (!submissions.length) continue;
    const sheetName = safeSheetName(storeCode, usedNames);
    addDeductionStoreSheet(wb, sheetName, submissions, () => template);
  }
  if (!wb.worksheets.length) wb.addWorksheet('Không có dữ liệu');
  return wb;
}

// ===================== Dashboard VSATTP (10/2026) — GỘP 1 FILE: sheet "Dashboard" (Top 5 + tỷ lệ vi
// phạm, mirror sheet Dashboard/Sheet2 file Excel gốc người dùng gửi) + 1 sheet chi tiết/siêu thị (dùng
// LẠI addDeductionStoreSheet() ở trên) — yêu cầu người dùng: "gộp chung file" thay vì 2 nút xuất riêng. =====
function addVsattpTopTable(sheet, startRow, title, rows) {
  const titleCell = sheet.getCell(startRow, 1);
  titleCell.value = guard(title);
  titleCell.font = { ...FONT, bold: true, size: 12 };
  const headerRow = sheet.getRow(startRow + 1);
  headerRow.getCell(1).value = 'STT'; headerRow.getCell(2).value = 'Tên Đơn Vị'; headerRow.getCell(3).value = 'Điểm TB';
  headerRow.font = { ...FONT, bold: true };
  headerRow.eachCell(cell => { cell.fill = HEADER_FILL; });
  rows.forEach((r, idx) => {
    const row = sheet.getRow(startRow + 2 + idx);
    row.getCell(1).value = idx + 1; row.getCell(2).value = guard(r.storeCode); row.getCell(3).value = Number(r.avg.toFixed(1));
    row.font = FONT;
  });
  return startRow + 2 + rows.length + 1; // dòng trống kế tiếp
}
// Top 5 theo SỐ LẦN VI PHẠM (10/2026) — cùng khuôn addVsattpTopTable() ở trên, chỉ đổi cột 3 từ "Điểm
// TB" sang "Số Lần Vi Phạm" (r.count thay vì r.avg).
function addVsattpTopCountTable(sheet, startRow, title, rows) {
  const titleCell = sheet.getCell(startRow, 1);
  titleCell.value = guard(title);
  titleCell.font = { ...FONT, bold: true, size: 12 };
  const headerRow = sheet.getRow(startRow + 1);
  headerRow.getCell(1).value = 'STT'; headerRow.getCell(2).value = 'Tên Đơn Vị'; headerRow.getCell(3).value = 'Số Lần Vi Phạm';
  headerRow.font = { ...FONT, bold: true };
  headerRow.eachCell(cell => { cell.fill = HEADER_FILL; });
  rows.forEach((r, idx) => {
    const row = sheet.getRow(startRow + 2 + idx);
    row.getCell(1).value = idx + 1; row.getCell(2).value = guard(r.storeCode); row.getCell(3).value = r.count;
    row.font = FONT;
  });
  return startRow + 2 + rows.length + 1;
}
// "Đã làm/Chưa làm checklist theo ngày/tháng" (10/2026) — dùng chung cho CẢ export-report QA (thêm ở
// buildQaReportWorkbook() nếu cần) LẪN Dashboard VSATTP, mirror computeChecklistCoverage() (lib/checklist.js).
function addCoverageTable(sheet, startRow, coverage) {
  const titleCell = sheet.getCell(startRow, 1);
  titleCell.value = guard(`ĐÃ LÀM / CHƯA LÀM CHECKLIST — Đã làm: ${coverage.doneCodes.length} · Chưa làm: ${coverage.notDoneCodes.length}`);
  titleCell.font = { ...FONT, bold: true, size: 12 };
  let row = startRow + 1;
  const notDoneCell = sheet.getCell(row, 1);
  notDoneCell.value = guard(`Chưa làm: ${coverage.notDoneCodes.join(', ') || '(không có — tất cả đơn vị đang hoạt động đều đã làm)'}`);
  notDoneCell.font = FONT;
  notDoneCell.alignment = { wrapText: true };
  row += 2;
  const dayHeadRow = sheet.getRow(row);
  dayHeadRow.getCell(1).value = 'Theo Ngày'; dayHeadRow.getCell(3).value = 'Theo Tháng';
  dayHeadRow.font = { ...FONT, bold: true };
  row += 1;
  const dayHeadRow2 = sheet.getRow(row);
  dayHeadRow2.getCell(1).value = 'Ngày'; dayHeadRow2.getCell(2).value = 'Số Đơn Vị';
  dayHeadRow2.getCell(3).value = 'Tháng'; dayHeadRow2.getCell(4).value = 'Số Đơn Vị';
  dayHeadRow2.font = { ...FONT, bold: true };
  [1, 2, 3, 4].forEach(c => { dayHeadRow2.getCell(c).fill = HEADER_FILL; });
  row += 1;
  const maxRows = Math.max(coverage.byDay.length, coverage.byMonth.length, 1);
  for (let i = 0; i < maxRows; i++) {
    const r = sheet.getRow(row + i);
    if (coverage.byDay[i]) { r.getCell(1).value = guard(coverage.byDay[i].date); r.getCell(2).value = coverage.byDay[i].count; }
    if (coverage.byMonth[i]) { r.getCell(3).value = guard(coverage.byMonth[i].month); r.getCell(4).value = coverage.byMonth[i].count; }
    r.font = FONT;
  }
  return row + maxRows + 1;
}
function addVsattpViolationTable(sheet, startRow, title, rows, denom) {
  const titleCell = sheet.getCell(startRow, 1);
  titleCell.value = guard(`${title} (mẫu số: ${denom} đơn vị đã kiểm tra trong kỳ)`);
  titleCell.font = { ...FONT, bold: true, size: 12 };
  const headerRow = sheet.getRow(startRow + 1);
  headerRow.getCell(1).value = 'Tiêu Chí Vi Phạm'; headerRow.getCell(2).value = 'Số Đơn Vị Mắc Phải'; headerRow.getCell(3).value = 'Tỷ Lệ (%)';
  headerRow.font = { ...FONT, bold: true };
  headerRow.eachCell(cell => { cell.fill = HEADER_FILL; });
  sheet.getColumn(1).width = 60;
  rows.forEach((r, idx) => {
    const row = sheet.getRow(startRow + 2 + idx);
    row.getCell(1).value = guard(r.label); row.getCell(2).value = r.count; row.getCell(3).value = Number(r.pct.toFixed(1));
    row.font = FONT;
    row.getCell(1).alignment = { wrapText: true };
  });
  return startRow + 2 + rows.length + 1;
}
function addVsattpDashboardSheet(wb, dashboardData, coverage) {
  const sheet = wb.addWorksheet('Dashboard', { views: [{ state: 'frozen', ySplit: 0 }] });
  sheet.columns = [{ width: 60 }, { width: 24 }, { width: 14 }, { width: 14 }];
  let row = 1;
  const titleCell = sheet.getCell(row, 1);
  titleCell.value = guard('TỔNG HỢP BÁO CÁO ĐÁNH GIÁ VSATTP');
  titleCell.font = { ...FONT, bold: true, size: 14 };
  row += 2;
  row = addVsattpTopTable(sheet, row, 'Top 5 Siêu Thị điểm TB cao nhất', dashboardData.topStHigh);
  row = addVsattpTopTable(sheet, row, 'Top 5 Siêu Thị điểm TB thấp nhất', dashboardData.topStLow);
  row = addVsattpTopTable(sheet, row, 'Top 5 Cửa Hàng điểm TB cao nhất', dashboardData.topChHigh);
  row = addVsattpTopTable(sheet, row, 'Top 5 Cửa Hàng điểm TB thấp nhất', dashboardData.topChLow);
  // topStViolation/topChViolation (10/2026) — SONG SONG Top điểm TB ở trên, đếm theo TẦN SUẤT vi phạm.
  row = addVsattpTopCountTable(sheet, row, 'Top 5 Siêu Thị nhiều vi phạm nhất', dashboardData.topStViolation || []);
  row = addVsattpTopCountTable(sheet, row, 'Top 5 Cửa Hàng nhiều vi phạm nhất', dashboardData.topChViolation || []);
  row = addVsattpViolationTable(sheet, row, 'Tỷ lệ Siêu Thị vi phạm theo từng tiêu chí', dashboardData.violSt.rows, dashboardData.violSt.denom);
  row = addVsattpViolationTable(sheet, row, 'Tỷ lệ Cửa Hàng vi phạm theo từng tiêu chí', dashboardData.violCh.rows, dashboardData.violCh.denom);
  if (coverage) row = addCoverageTable(sheet, row, coverage);
  return sheet;
}
function buildVsattpDashboardWorkbook(dashboardData, submissionsByStore, templatesById, coverage) {
  const wb = new ExcelJS.Workbook();
  addVsattpDashboardSheet(wb, dashboardData, coverage);
  const usedNames = new Set(['dashboard']);
  for (const [storeCode, submissions] of submissionsByStore.entries()) {
    if (!submissions.length) continue;
    const sheetName = safeSheetName(storeCode, usedNames);
    addDeductionStoreSheet(wb, sheetName, submissions, (sub) => templatesById.get(sub.templateId));
  }
  return wb;
}

module.exports = { buildQaReportWorkbook, buildDeductionReportWorkbook, buildVsattpDashboardWorkbook, safeSheetName };
