// server/tests/test-pricefile-formula-cell.js
//
// Regression cho lỗi người dùng báo cáo (10/2026): import Excel bảng giá đề xuất (Phê Duyệt Giá Bán
// Buôn/Bán Lẻ) ra "[object Object]" ở nhiều ô.
//
// ROOT CAUSE (xác minh bằng tái hiện thật): lib/priceFileParser.js gọi streamFirstSheetRows() KHÔNG có
// {raw:true}, nên lib/xlsxSafeRead.js tự String(cell.value) cho từng ô — với ô CÔNG THỨC, cell.value là
// {formula, result}, String() ra đúng "[object Object]" (giống hệt richText/hyperlink). ĐÃ VÁ: đọc raw rồi
// quy đổi bằng cellToText(cellRaw(...)) (cặp hàm giờ dùng CHUNG ở lib/xlsxSafeRead.js, trước đây chỉ có ở
// lib/objectCatalogImport.js) ở mọi nơi priceFileParser.js từng gọi String(cell) trực tiếp: rowToPriceItem,
// matchColumnsToTemplate (so khớp cột theo Mẫu Giá), resolveColumns (không có Mẫu Giá), và
// parsePriceTemplateColumns (đọc cột của chính Mẫu Giá).
//
// Chạy: node server/tests/test-pricefile-formula-cell.js
'use strict';
const assert = require('assert');
const ExcelJS = require('exceljs');
const { parsePriceFile, parsePriceTemplateColumns } = require('../lib/priceFileParser');

function check(results, name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }

async function buildWorkbookBuffer() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('BangGia');
  sheet.addRow(['Mã hàng', 'Tên mặt hàng', 'Giá mới']);
  const row2 = sheet.addRow(['SP001', 'Mì gói Hảo Hảo', null]);
  row2.getCell(3).value = { formula: 'B2&""', result: 1100 }; // ô công thức -> cell.value là object
  sheet.addRow(['SP002', 'Nước mắm Nam Ngư', 25000]); // dòng thường, đối chiếu không bị ảnh hưởng
  return wb.xlsx.writeBuffer();
}

async function main() {
  const results = [];

  const buffer = await buildWorkbookBuffer();
  const template = { columns: [
    { key: 'ma', label: 'Mã hàng' },
    { key: 'ten', label: 'Tên mặt hàng' },
    { key: 'gia', label: 'Giá mới' }
  ] };

  const { items } = await parsePriceFile(buffer, template);
  check(results, 'Dòng 1 (ô công thức): không còn "[object Object]"',
    !items[0].values.gia.includes('[object Object]'), `gia=${items[0].values.gia}`);
  check(results, 'Dòng 1 (ô công thức): đọc đúng result của công thức (1100)',
    items[0].values.gia === '1100', `gia=${items[0].values.gia}`);
  check(results, 'Dòng 1: cột text thường vẫn đúng', items[0].values.ten === 'Mì gói Hảo Hảo');
  check(results, 'Dòng 2 (dữ liệu thường): không bị ảnh hưởng', items[1].values.gia === '25000');

  // Không truyền template -> nhánh resolveColumns() lấy nguyên văn cột của chính file (cũng phải qua
  // cellToText/cellRaw, không phải String() trực tiếp).
  const { items: itemsNoTemplate, columnLabels } = await parsePriceFile(buffer, null);
  check(results, 'Không có Mẫu Giá: đọc tên cột tiêu đề đúng (không lỗi object)',
    columnLabels.every(c => !c.label.includes('[object')));
  check(results, 'Không có Mẫu Giá: ô công thức ở dòng dữ liệu vẫn đúng (không "[object Object]")',
    !Object.values(itemsNoTemplate[0].values).some(v => String(v).includes('[object Object]')));

  // parsePriceTemplateColumns() (đọc cột của chính Mẫu Giá) — cũng cần raw + cellToText/cellRaw.
  const wbTemplate = new ExcelJS.Workbook();
  const tplSheet = wbTemplate.addWorksheet('Mau');
  const headerRow = tplSheet.addRow(['Mã hàng', null, 'Giá mới']);
  headerRow.getCell(2).value = { formula: 'UPPER("ten mat hang")', result: 'TEN MAT HANG' };
  const tplBuffer = await wbTemplate.xlsx.writeBuffer();
  const columns = await parsePriceTemplateColumns(tplBuffer);
  check(results, 'parsePriceTemplateColumns(): tiêu đề công thức đọc đúng result, không "[object Object]"',
    columns.some(c => c.label === 'TEN MAT HANG'), JSON.stringify(columns));

  results.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
