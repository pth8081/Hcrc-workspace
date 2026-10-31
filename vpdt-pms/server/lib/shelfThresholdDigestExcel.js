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

// DATA_SCOPE_DISCLAIMER: 1 câu ngắn nêu rõ phạm vi dữ liệu "Tồn Hôm Nay" — gắn vào CẢ file Excel này LẪN
// nội dung email (xem jobs/shelfStockThresholdAlert.js) — VÁ LẦN 3, rà soát chéo độc lập phát hiện: số
// liệu chỉ tính từ 0h cùng ngày tới lúc gửi, báo cáo gửi sớm trong ngày có thể chưa phản ánh đủ hoạt động
// cả ngày (không phải lỗi tính toán, chỉ là phạm vi dữ liệu cần nêu rõ cho người đọc).
const DATA_SCOPE_DISCLAIMER = 'Số liệu "Tồn Hôm Nay" tính từ 00:00 tới thời điểm gửi báo cáo này — có thể chưa đầy đủ nếu gửi vào đầu ngày.';

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
  const disclaimerRow = legendStartRow + 5;
  const disclaimerCell = sheet.getCell(`A${disclaimerRow}`);
  disclaimerCell.value = DATA_SCOPE_DISCLAIMER;
  disclaimerCell.font = { italic: true, color: { argb: 'FF6B7280' }, size: 9 };

  return wb.xlsx.writeBuffer();
}

// classifyThresholdStatus(): quy tắc màu DUY NHẤT dùng chung cho cả Excel đính kèm lẫn bảng web (xem
// renderShelfStockThresholdsList() ở public/js/module-vanhanh.js — PHẢI giữ đúng cùng logic, không được
// lệch nhau) — nguyên văn người dùng: "thấp hơn ngưỡng set thì bôi đỏ, còn khoảng 10%, dưới 10% thì bôi
// vàng". total < minQuantity -> RED (đã dưới ngưỡng). minQuantity <= total < minQuantity*1.1 -> YELLOW
// (còn CHƯA ĐẾN 10% nữa là chạm ngưỡng — biên trên 110% là GREEN, không tính vào vùng vàng). Mọi trường
// hợp còn lại -> GREEN (an toàn, đã có ≥10% đệm).
// FP_EPSILON: dung sai cực nhỏ bù sai số làm tròn số thực JS tại ĐÚNG biên 110% (VD 50*1.1===
// 55.00000000000001, không phải đúng 55) — KHÔNG dùng Math.round(t*10) vì sẽ làm sai các trường hợp số
// lượng có phần thập phân hợp lệ gần biên (VD min=10,total=10.999 phải vẫn là YELLOW vì 10.999 thực sự
// nhỏ hơn 11, nhưng Math.round(109.99)=110 sẽ làm tròn nhầm thành GREEN — phát hiện qua test có sẵn
// "classifyThresholdStatus: đúng biên RED/YELLOW/GREEN (10%)"). 1e-9 đủ lớn để triệt sai số FP (~1e-13
// đến 1e-14) nhưng đủ nhỏ để không ảnh hưởng chênh lệch số lượng thật (luôn ≥ nhiều bậc độ lớn hơn).
const FP_EPSILON = 1e-9;
function classifyThresholdStatus(total, minQuantity) {
  const min = Number(minQuantity) || 0;
  const t = Number(total) || 0;
  if (t < min) return 'RED';
  // "t < min*1.1 - FP_EPSILON" thay vì "t < min*1.1" trực tiếp — VÁ LẦN 3, rà soát chéo độc lập phát hiện
  // lỗi làm tròn số thực JS tại ĐÚNG biên 110% khiến total ĐÚNG BẰNG 110% ngưỡng (lẽ ra AN TOÀN) bị tính
  // nhầm thành VÀNG. PHẢI giữ giống HỆT công thức ở module-vanhanh.js classifyShelfThresholdStatus(), sửa
  // 1 bên bắt buộc sửa cả 2 bên.
  if (t < min * 1.1 - FP_EPSILON) return 'YELLOW';
  return 'GREEN';
}

module.exports = { buildShelfThresholdDigestExcelBuffer, classifyThresholdStatus, STATUS_LABELS, DATA_SCOPE_DISCLAIMER };
