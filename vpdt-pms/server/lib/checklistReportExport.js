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
// "Thời gian hoàn thành" (QA) — quyết định đã chốt với người dùng: ĐỂ TRỐNG, không thêm field/tính năng
// mới nào để lưu trạng thái khắc phục theo từng câu hỏi (hiện chỉ có 1 ô "Phản hồi" chung/toàn bài,
// storeResponseText — không đủ chi tiết theo từng câu, và việc thêm field đó là 1 tính năng lớn hơn hẳn
// phạm vi "xuất báo cáo" lần này).
'use strict';

const ExcelJS = require('exceljs');
const { excelFormulaGuard } = require('./adminExport');

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
        result || '', result === 'Không đạt' ? guard(ans?.note || '') : '', ''
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

// submissionsByStore: Map<storeCode, checklistSubmissions[]> (đã lọc đúng phạm vi/khoảng ngày, mỗi mảng
// nên sắp xếp tăng dần theo submittedAt trước khi truyền vào — hàm này KHÔNG tự sắp xếp lại).
function buildQaReportWorkbook(template, submissionsByStore) {
  const wb = new ExcelJS.Workbook();
  const usedNames = new Set();
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
function addVsattpDashboardSheet(wb, dashboardData) {
  const sheet = wb.addWorksheet('Dashboard', { views: [{ state: 'frozen', ySplit: 0 }] });
  sheet.columns = [{ width: 60 }, { width: 24 }, { width: 14 }];
  let row = 1;
  const titleCell = sheet.getCell(row, 1);
  titleCell.value = guard('TỔNG HỢP BÁO CÁO ĐÁNH GIÁ VSATTP');
  titleCell.font = { ...FONT, bold: true, size: 14 };
  row += 2;
  row = addVsattpTopTable(sheet, row, 'Top 5 Siêu Thị điểm TB cao nhất', dashboardData.topStHigh);
  row = addVsattpTopTable(sheet, row, 'Top 5 Siêu Thị điểm TB thấp nhất', dashboardData.topStLow);
  row = addVsattpTopTable(sheet, row, 'Top 5 Cửa Hàng điểm TB cao nhất', dashboardData.topChHigh);
  row = addVsattpTopTable(sheet, row, 'Top 5 Cửa Hàng điểm TB thấp nhất', dashboardData.topChLow);
  row = addVsattpViolationTable(sheet, row, 'Tỷ lệ Siêu Thị vi phạm theo từng tiêu chí', dashboardData.violSt.rows, dashboardData.violSt.denom);
  row = addVsattpViolationTable(sheet, row, 'Tỷ lệ Cửa Hàng vi phạm theo từng tiêu chí', dashboardData.violCh.rows, dashboardData.violCh.denom);
  return sheet;
}
function buildVsattpDashboardWorkbook(dashboardData, submissionsByStore, templatesById) {
  const wb = new ExcelJS.Workbook();
  addVsattpDashboardSheet(wb, dashboardData);
  const usedNames = new Set(['dashboard']);
  for (const [storeCode, submissions] of submissionsByStore.entries()) {
    if (!submissions.length) continue;
    const sheetName = safeSheetName(storeCode, usedNames);
    addDeductionStoreSheet(wb, sheetName, submissions, (sub) => templatesById.get(sub.templateId));
  }
  return wb;
}

module.exports = { buildQaReportWorkbook, buildDeductionReportWorkbook, buildVsattpDashboardWorkbook, safeSheetName };
