// lib/vppExport.js — Dựng 2 file Excel cho bộ phận quản lý Văn phòng phẩm, LUÔN sinh trực tiếp từ dữ
// liệu DB hiện tại mỗi lần tải xuống (không lưu file vật lý cập nhật dần) — nhiều phòng ban gửi đăng ký
// tiếp sau khi đã có người tải file trước đó vẫn phản ánh đủ ở lần tải kế tiếp, không có khái niệm file
// "cũ" cần đồng bộ, cũng tránh rủi ro ghi đè khi nhiều người duyệt/tải cùng lúc.
// Chỉ tính đăng ký ĐÃ DUYỆT (APPROVED) — khớp đúng nghiệp vụ "kết thúc phê duyệt thì thông tin mới vào
// file tổng hợp".
const ExcelJS = require('exceljs');

const VND = (n) => Number(n || 0).toLocaleString('vi-VN');

function approvedRegsForPeriod(registrations, periodId) {
  return (registrations || []).filter(r => r.periodId === periodId && r.status === 'APPROVED');
}

function styleHeaderRow(row) {
  row.font = { bold: true };
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    cell.border = { bottom: { style: 'thin' } };
  });
}

// Sheet "Tổng Hợp" — chi tiết từng dòng (1 dòng = 1 mặt hàng của 1 đăng ký đã duyệt).
async function buildSummaryWorkbook(period, registrations) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Tổng Hợp');
  sheet.columns = [
    { header: 'STT', key: 'stt', width: 6 },
    { header: 'Phòng Ban', key: 'dept', width: 22 },
    { header: 'Người Đăng Ký', key: 'creator', width: 20 },
    { header: 'Mã Hàng', key: 'code', width: 14 },
    { header: 'Tên Hàng', key: 'name', width: 32 },
    { header: 'ĐVT', key: 'unit', width: 10 },
    { header: 'Số Lượng', key: 'qty', width: 12 },
    { header: 'Đơn Giá', key: 'price', width: 14 },
    { header: 'Thành Tiền', key: 'total', width: 16 }
  ];
  styleHeaderRow(sheet.getRow(1));

  const regs = approvedRegsForPeriod(registrations, period.id)
    .slice().sort((a, b) => (a.dept || '').localeCompare(b.dept || '', 'vi') || (a.creatorName || '').localeCompare(b.creatorName || '', 'vi'));

  let stt = 0;
  let grandTotal = 0;
  regs.forEach(r => {
    (r.items || []).forEach(it => {
      stt++;
      const total = (Number(it.price) || 0) * (Number(it.qty) || 0);
      grandTotal += total;
      sheet.addRow({
        stt, dept: r.dept, creator: r.creatorName, code: it.code || '', name: it.name,
        unit: it.unit || '', qty: it.qty, price: it.price != null ? VND(it.price) : '',
        total: it.price != null ? VND(total) : ''
      });
    });
  });

  if (!stt) {
    sheet.addRow({ stt: '', dept: '(Chưa có đăng ký nào được duyệt trong kỳ này)' });
  } else {
    const totalRow = sheet.addRow({ name: 'TỔNG CỘNG', total: VND(grandTotal) });
    totalRow.font = { bold: true };
  }
  return wb;
}

// Sheet "Tổng Quát" — ma trận Mặt hàng x Phòng ban (số lượng), kèm Đơn giá + Thành tiền tổng.
async function buildByDeptWorkbook(period, registrations) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Tổng Quát Theo Phòng Ban');

  const regs = approvedRegsForPeriod(registrations, period.id);
  const depts = [...new Set(regs.map(r => r.dept))].sort((a, b) => a.localeCompare(b, 'vi'));

  // Gộp theo mặt hàng: {code, unit, price} lấy snapshot của lần gặp đầu tiên (đều chốt từ cùng 1 danh
  // mục kỳ nên nhất quán); byDept[dept] = số lượng cộng dồn của phòng đó.
  const items = new Map(); // name -> { code, unit, price, byDept: {dept: qty}, total: qty }
  regs.forEach(r => {
    (r.items || []).forEach(it => {
      if (!items.has(it.name)) items.set(it.name, { code: it.code || '', unit: it.unit || '', price: it.price, byDept: {}, total: 0 });
      const entry = items.get(it.name);
      entry.byDept[r.dept] = (entry.byDept[r.dept] || 0) + it.qty;
      entry.total += it.qty;
    });
  });

  const columns = [
    { header: 'Mã Hàng', key: 'code', width: 14 },
    { header: 'Tên Hàng', key: 'name', width: 32 },
    { header: 'ĐVT', key: 'unit', width: 10 },
    { header: 'Đơn Giá', key: 'price', width: 14 },
    ...depts.map((d, i) => ({ header: d, key: `dept${i}`, width: 16 })),
    { header: 'Tổng Số Lượng', key: 'totalQty', width: 14 },
    { header: 'Thành Tiền', key: 'total', width: 16 }
  ];
  sheet.columns = columns;
  styleHeaderRow(sheet.getRow(1));

  const deptTotals = depts.map(() => 0);
  let grandTotal = 0;
  const sortedNames = [...items.keys()].sort((a, b) => a.localeCompare(b, 'vi'));
  sortedNames.forEach(name => {
    const entry = items.get(name);
    const rowData = { code: entry.code, name, unit: entry.unit, price: entry.price != null ? VND(entry.price) : '' };
    depts.forEach((d, i) => {
      const qty = entry.byDept[d] || 0;
      rowData[`dept${i}`] = qty || '';
      deptTotals[i] += qty;
    });
    const total = (Number(entry.price) || 0) * entry.total;
    grandTotal += total;
    rowData.totalQty = entry.total;
    rowData.total = entry.price != null ? VND(total) : '';
    sheet.addRow(rowData);
  });

  if (!sortedNames.length) {
    sheet.addRow({ name: '(Chưa có đăng ký nào được duyệt trong kỳ này)' });
  } else {
    const totalRowData = { name: 'TỔNG CỘNG', totalQty: deptTotals.reduce((s, v) => s + v, 0), total: VND(grandTotal) };
    depts.forEach((d, i) => { totalRowData[`dept${i}`] = deptTotals[i] || ''; });
    const totalRow = sheet.addRow(totalRowData);
    totalRow.font = { bold: true };
  }
  return wb;
}

module.exports = { buildSummaryWorkbook, buildByDeptWorkbook };
