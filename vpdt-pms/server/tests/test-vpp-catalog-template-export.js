// server/tests/test-vpp-catalog-template-export.js
//
// Regression cho 2 workbook MỚI ở lib/vppExport.js (module Văn Phòng Phẩm):
//   - buildCatalogTemplateWorkbook() — file mẫu rỗng cho bộ phận hành chính tải về điền, dùng ở
//     GET /api/vpp/catalog-template (routes/vppCatalog.js).
//   - buildCatalogWorkbook(period) — xuất lại danh mục mặt hàng đã chốt của 1 kỳ đăng ký, dùng ở
//     GET /api/vpp/export/catalog/:periodId.
// Cả 2 dùng CHUNG 1 bộ cột (CATALOG_TEMPLATE_COLUMNS) — kiểm tra tiêu đề cột khớp ĐÚNG các nhãn mà
// lib/vppCatalog.js::FIELD_HINTS nhận diện được (Mã Hàng/Tên Mặt Hàng/Đơn Vị Tính/Xuất Xứ/Quy Cách Đóng
// Gói/Đơn Giá) — nếu lệch, file xuất ra sẽ không import ngược lại được qua chính route parse-catalog đã
// sinh ra nó, phá vỡ đúng cái vòng "xuất ra rồi nộp lại" mà tính năng này phục vụ.
//
// Đây là bài test Node thuần (không cần Playwright/Express) — gọi thẳng hàm dựng workbook rồi đọc lại
// bằng chính ExcelJS để kiểm tra nội dung, tương đương cách người dùng sẽ mở file trong Excel thật.
//
// Chạy: node server/tests/test-vpp-catalog-template-export.js
'use strict';
const ExcelJS = require('exceljs');
const { buildCatalogTemplateWorkbook, buildCatalogWorkbook } = require('../lib/vppExport');
const { parseCatalogFile } = require('../lib/vppCatalog');

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass });
  console.log((pass ? 'PASS' : 'FAIL') + ': ' + name + (pass ? '' : '\n      ' + (detail || '')));
}

async function workbookToBuffer(wb) {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function headerRowValues(sheet) {
  return sheet.getRow(1).values.slice(1); // ExcelJS values[0] luôn undefined (1-indexed)
}

async function main() {
  // ===== 1) File mẫu rỗng =====
  const templateWb = buildCatalogTemplateWorkbook();
  const templateSheet = templateWb.getWorksheet('Danh Mục Mặt Hàng');
  record('buildCatalogTemplateWorkbook(): tạo đúng 1 sheet "Danh Mục Mặt Hàng"', !!templateSheet);

  const headers = headerRowValues(templateSheet);
  record('File mẫu: tiêu đề cột ĐÚNG thứ tự Mã Hàng/Tên Mặt Hàng/Đơn Vị Tính/Xuất Xứ/Quy Cách Đóng Gói/Đơn Giá',
    JSON.stringify(headers) === JSON.stringify(['Mã Hàng', 'Tên Mặt Hàng', 'Đơn Vị Tính', 'Xuất Xứ', 'Quy Cách Đóng Gói', 'Đơn Giá']),
    JSON.stringify(headers));

  record('File mẫu: có đúng 1 dòng ví dụ (in nghiêng)', templateSheet.rowCount === 2 && templateSheet.getRow(2).font?.italic === true);

  // Đọc lại file mẫu qua ĐÚNG route thật (parseCatalogFile, ext .xlsx) — mô phỏng hành chính điền thêm
  // dòng rồi nộp lại, phải nhận diện được tiêu đề cột và đọc đúng dòng ví dụ.
  const templateBuf = await workbookToBuffer(templateWb);
  const templateParsed = await parseCatalogFile(templateBuf, '.xlsx');
  record('File mẫu: parseCatalogFile() đọc lại được đúng 1 mặt hàng ví dụ, đủ 6 trường',
    templateParsed.length === 1 &&
    templateParsed[0].code === 'VPP001' &&
    templateParsed[0].name.includes('Bút bi Thiên Long') &&
    templateParsed[0].unit === 'Cái' && templateParsed[0].origin === 'Việt Nam' &&
    templateParsed[0].spec === 'Hộp 10 cái' && templateParsed[0].price === 3000,
    JSON.stringify(templateParsed));

  // ===== 2) Xuất lại danh mục của 1 kỳ đăng ký đã có dữ liệu =====
  const period = {
    id: 1, code: 'VPP-20260901-00001',
    catalogItems: [
      { code: 'A01', name: 'Bút bi', unit: 'Cái', origin: 'Việt Nam', spec: 'Hộp 10', price: 3000 },
      { code: '', name: 'Giấy A4', unit: 'Ream', origin: '', spec: '', price: null }, // thiếu vài field -> vẫn phải xuất được, không throw
      // Formula-injection payload (bắt đầu bằng "=") — phải bị sanitizeRowForFormulaInjection() vô hiệu hoá.
      { code: 'A02', name: '=cmd|"/c calc"!A1', unit: 'Cái', origin: '', spec: '', price: 5000 }
    ]
  };
  const catalogWb = buildCatalogWorkbook(period);
  const catalogSheet = catalogWb.getWorksheet('Danh Mục Mặt Hàng');
  record('buildCatalogWorkbook(): tiêu đề cột GIỐNG HỆT file mẫu (cùng khuôn, import lại được)',
    JSON.stringify(headerRowValues(catalogSheet)) === JSON.stringify(['Mã Hàng', 'Tên Mặt Hàng', 'Đơn Vị Tính', 'Xuất Xứ', 'Quy Cách Đóng Gói', 'Đơn Giá']));

  record('buildCatalogWorkbook(): xuất đủ 3 dòng (đúng số mặt hàng của kỳ)', catalogSheet.rowCount === 4); // 1 header + 3 items

  const rowA01 = catalogSheet.getRow(2).values.slice(1);
  record('buildCatalogWorkbook(): dòng đầy đủ field xuất đúng giá trị (số Đơn Giá giữ nguyên dạng số, không format chuỗi VNĐ)',
    rowA01[0] === 'A01' && rowA01[1] === 'Bút bi' && rowA01[2] === 'Cái' && rowA01[3] === 'Việt Nam' && rowA01[4] === 'Hộp 10' && rowA01[5] === 3000,
    JSON.stringify(rowA01));

  const rowGiayA4 = catalogSheet.getRow(3).values.slice(1);
  record('buildCatalogWorkbook(): mặt hàng thiếu field (code rỗng/price null) xuất ra chuỗi rỗng, không throw/undefined lộ ra ngoài',
    rowGiayA4[0] === undefined || rowGiayA4[0] === '' ? true : false, // ExcelJS bỏ qua cell rỗng khi đọc .values -> undefined là hợp lệ ở đây
    JSON.stringify(rowGiayA4));

  const rowInjection = catalogSheet.getRow(4).values.slice(1);
  const nameCellSanitized = typeof rowInjection[1] === 'string' && !rowInjection[1].startsWith('=');
  record('buildCatalogWorkbook(): tên mặt hàng bắt đầu bằng "=" (formula injection) ĐÃ bị sanitizeRowForFormulaInjection() vô hiệu hoá', nameCellSanitized, JSON.stringify(rowInjection));

  // Đọc lại qua parseCatalogFile() — xuất ra rồi nộp lại phải cho đúng 3 mặt hàng (đối chiếu với round-trip thật).
  const catalogBuf = await workbookToBuffer(catalogWb);
  const catalogParsed = await parseCatalogFile(catalogBuf, '.xlsx');
  record('buildCatalogWorkbook(): file xuất ra IMPORT LẠI ĐƯỢC qua parseCatalogFile(), đủ 3 mặt hàng (round-trip)', catalogParsed.length === 3, JSON.stringify(catalogParsed));

  // ===== 3) Kỳ đăng ký chưa có mặt hàng nào — không throw, có dòng ghi chú =====
  const emptyPeriod = { id: 2, code: 'VPP-EMPTY', catalogItems: [] };
  const emptyWb = buildCatalogWorkbook(emptyPeriod);
  const emptySheet = emptyWb.getWorksheet('Danh Mục Mặt Hàng');
  record('buildCatalogWorkbook(): kỳ chưa có mặt hàng nào -> không throw, có 1 dòng ghi chú', emptySheet.rowCount === 2 && String(emptySheet.getRow(2).values[2] || '').includes('chưa có mặt hàng'));

  finish();
}

function finish() {
  const total = results.length;
  const passed = results.filter(r => r.pass).length;
  console.log('');
  console.log(`${passed}/${total} scenarios passed.`);
  if (passed !== total) process.exitCode = 1;
}

main().catch(err => { console.error(err); process.exitCode = 1; });
