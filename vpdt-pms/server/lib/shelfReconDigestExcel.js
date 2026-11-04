// lib/shelfReconDigestExcel.js — dựng file Excel đính kèm email "📊 Báo Cáo Đối Chiếu" định kỳ
// (jobs/shelfStockReconDigestAlert.js, 11/2026, theo yêu cầu người dùng "đối chiếu cũng sẽ đặt lịch gửi
// email được, thay vì xem trên app"). Người dùng xác nhận: CHỈ liệt kê các mã "Lệch" (đã có sẵn trên màn
// 📊 Đối Chiếu — rows đầu vào ở đây ĐÃ được lọc chỉ gồm mã lệch từ jobs/shelfStockReconDigestAlert.js,
// không lọc lại ở đây) — không có khái niệm "Khớp" trong báo cáo này nên mọi dòng đều tô đỏ (khác
// lib/shelfThresholdDigestExcel.js có cả đỏ/vàng/không tô).
const ExcelJS = require('exceljs');

const RED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
const RED_FONT = { color: { argb: 'FF9C0006' }, bold: true };

// DATA_SCOPE_DISCLAIMER: cùng tinh thần lib/shelfThresholdDigestExcel.js — nêu rõ phạm vi "Trên Kệ Hôm
// Nay" chỉ tính các mã ĐÃ SCAN lên kệ trong ngày (không phải toàn bộ tồn kho hệ thống của siêu thị).
const DATA_SCOPE_DISCLAIMER = 'Báo cáo này CHỈ liệt kê các mã hàng ĐÃ SCAN lên kệ hôm nay và có chênh lệch (Lệch) giữa Tồn Kho Hệ Thống và Trên Kệ Hôm Nay — các mã khớp đúng hoặc chưa scan không xuất hiện ở đây. Xem đầy đủ tại màn "📊 Đối Chiếu" trong ứng dụng.';

function styleHeaderRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6F78' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
}

// rows: [{ dept, maHang, tenHang, soLuongTon, shelfTotal, diff }] — xem
// buildReconMismatchRowsForDept() ở jobs/shelfStockReconDigestAlert.js cho cách dựng mảng này.
async function buildShelfReconDigestExcelBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Đối Chiếu — Mã Lệch');
  sheet.columns = [
    { header: 'Siêu Thị', key: 'dept', width: 22 },
    { header: 'Mã Hàng (nội bộ)', key: 'maHang', width: 18 },
    { header: 'Tên Hàng', key: 'tenHang', width: 32 },
    { header: 'Tồn Kho Hệ Thống', key: 'soLuongTon', width: 16 },
    { header: 'Trên Kệ Hôm Nay', key: 'shelfTotal', width: 16 },
    { header: 'Chênh Lệch', key: 'diff', width: 14 }
  ];
  styleHeaderRow(sheet.getRow(1));

  (rows || []).forEach(r => {
    const diff = Number(r.diff) || 0;
    const row = sheet.addRow({
      dept: r.dept || '', maHang: r.maHang || '', tenHang: r.tenHang || '',
      soLuongTon: Number(r.soLuongTon) || 0, shelfTotal: Number(r.shelfTotal) || 0,
      diff: diff > 0 ? `+${diff}` : String(diff)
    });
    row.eachCell(cell => { cell.fill = RED_FILL; cell.font = RED_FONT; });
  });

  if (!rows || !rows.length) {
    sheet.addRow({ dept: 'Không có mã hàng nào lệch trong kỳ báo cáo này.' });
  }

  const noteRow = sheet.rowCount + 2;
  const noteCell = sheet.getCell(`A${noteRow}`);
  noteCell.value = DATA_SCOPE_DISCLAIMER;
  noteCell.font = { italic: true, color: { argb: 'FF6B7280' }, size: 9 };

  return wb.xlsx.writeBuffer();
}

module.exports = { buildShelfReconDigestExcelBuffer, DATA_SCOPE_DISCLAIMER };
