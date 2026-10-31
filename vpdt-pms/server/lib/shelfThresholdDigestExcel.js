// lib/shelfThresholdDigestExcel.js — dựng file Excel đính kèm email "Báo Cáo Ngưỡng Tồn" định kỳ
// (jobs/shelfStockThresholdAlert.js, thiết kế lại 11/2026 theo yêu cầu người dùng: "bôi dòng đấy màu đỏ"
// nếu dưới ngưỡng, "màu vàng" nếu còn CHƯA ĐẾN 10% nữa là chạm ngưỡng — xem classifyThresholdStatus()).
// Dùng ExcelJS (đúng thư viện chuẩn của hệ thống — xem lib/shelfLocationImport.js/lib/storeCatalogImport.js),
// màu nền/chữ lấy đúng theo file demo đã gửi người dùng xác nhận (FFC7CE/9C0006 đỏ, FFEB9C/9C6500 vàng —
// màu "Bad"/"Neutral" chuẩn Excel).
const ExcelJS = require('exceljs');

const RED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
const RED_FONT = { color: { argb: 'FF9C0006' }, bold: true };
const YELLOW_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
const YELLOW_FONT = { color: { argb: 'FF9C6500' }, bold: true };

const STATUS_LABELS = { RED: '🔴 Dưới ngưỡng', YELLOW: '🟡 Gần ngưỡng (<10%)', GREEN: '🟢 An toàn' };

function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6F78' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
}

// rows: [{ dept, maHang, maVach, category, minQuantity, total, status, label }] — xem
// groupDigestRowsByRecipient()/buildDigestRowsForDept() ở jobs/shelfStockThresholdAlert.js cho cách
// dựng mảng này (mỗi điều kiện ĐÃ ĐIỀN của 1 ngưỡng = đúng 1 dòng riêng, cùng khuôn multi-condition đã
// có từ trước — 1 ngưỡng điền cả Mã Hàng/Mã Vạch LẪN Ngành Hàng sẽ ra 2 dòng độc lập).
async function buildShelfThresholdDigestExcelBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Ngưỡng Tồn');
  sheet.columns = [
    { header: 'Siêu Thị', key: 'dept', width: 22 },
    { header: 'Mã Hàng (nội bộ)', key: 'maHang', width: 18 },
    { header: 'Mã Vạch', key: 'maVach', width: 18 },
    { header: 'Ngành Hàng', key: 'category', width: 20 },
    { header: 'Ngưỡng Tối Thiểu', key: 'minQuantity', width: 16 },
    { header: 'Tồn Hôm Nay', key: 'total', width: 14 },
    { header: 'Trạng Thái', key: 'statusLabel', width: 20 }
  ];
  styleHeaderRow(sheet.getRow(1));

  (rows || []).forEach(r => {
    const row = sheet.addRow({
      dept: r.dept || '', maHang: r.maHang || '', maVach: r.maVach || '', category: r.category || '',
      minQuantity: Number(r.minQuantity) || 0, total: Number(r.total) || 0, statusLabel: STATUS_LABELS[r.status] || STATUS_LABELS.GREEN
    });
    if (r.status === 'RED') {
      row.eachCell(cell => { cell.fill = RED_FILL; cell.font = RED_FONT; });
    } else if (r.status === 'YELLOW') {
      row.eachCell(cell => { cell.fill = YELLOW_FILL; cell.font = YELLOW_FONT; });
    }
  });

  if (!rows || !rows.length) {
    sheet.addRow({ dept: 'Không có ngưỡng tồn nào đang áp dụng trong phạm vi của bạn.' });
  }

  const legendStartRow = sheet.rowCount + 2;
  sheet.getCell(`A${legendStartRow}`).value = 'Chú giải màu:';
  sheet.getCell(`A${legendStartRow}`).font = { bold: true };
  const l1 = sheet.getCell(`A${legendStartRow + 1}`);
  l1.value = '🔴 Đỏ — Tồn hôm nay ĐÃ DƯỚI ngưỡng tối thiểu (cần bổ sung ngay)';
  l1.font = RED_FONT; l1.fill = RED_FILL;
  const l2 = sheet.getCell(`A${legendStartRow + 2}`);
  l2.value = '🟡 Vàng — Tồn hôm nay còn CHƯA ĐẾN 10% nữa là chạm ngưỡng (cảnh báo sớm)';
  l2.font = YELLOW_FONT; l2.fill = YELLOW_FILL;
  sheet.getCell(`A${legendStartRow + 3}`).value = '🟢 Không tô — Tồn hôm nay an toàn, còn ≥10% đệm so với ngưỡng';

  return wb.xlsx.writeBuffer();
}

// classifyThresholdStatus(): quy tắc màu DUY NHẤT dùng chung cho cả Excel đính kèm lẫn bảng web (xem
// renderShelfStockThresholdsList() ở public/js/module-vanhanh.js — PHẢI giữ đúng cùng logic, không được
// lệch nhau) — nguyên văn người dùng: "thấp hơn ngưỡng set thì bôi đỏ, còn khoảng 10%, dưới 10% thì bôi
// vàng". total < minQuantity -> RED (đã dưới ngưỡng). minQuantity <= total < minQuantity*1.1 -> YELLOW
// (còn CHƯA ĐẾN 10% nữa là chạm ngưỡng — biên trên 110% là GREEN, không tính vào vùng vàng). Mọi trường
// hợp còn lại -> GREEN (an toàn, đã có ≥10% đệm).
function classifyThresholdStatus(total, minQuantity) {
  const min = Number(minQuantity) || 0;
  const t = Number(total) || 0;
  if (t < min) return 'RED';
  if (t < min * 1.1) return 'YELLOW';
  return 'GREEN';
}

module.exports = { buildShelfThresholdDigestExcelBuffer, classifyThresholdStatus, STATUS_LABELS };
