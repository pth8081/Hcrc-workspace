// server/tests/test-pricefile-percent-format.js
//
// Regression cho lỗi người dùng báo cáo (10/2026): import Excel ở Phê Duyệt Giá Bán Buôn/Bán Lẻ, cột %
// bị "làm tròn" — thực chất là THIẾU NHÂN 100. Excel lưu ô định dạng phần trăm (numFmt "0.00%"/"0%") dưới
// dạng PHÂN SỐ gốc (cell.value = 0.12345 cho ô hiển thị "12.345%"); lib/xlsxSafeRead.js trước đây chỉ lấy
// cell.value, bỏ qua numFmt, nên import ra đúng "0.12345" thay vì "12.345".
//
// ĐÃ VÁ: streamFirstSheetRows({withNumFmt:true}) mang theo numFmt từng ô (tham số thứ 3 `numFmts` của
// onRow, KHÔNG đổi hành vi 5 luồng import Excel khác dùng chung lib/xlsxSafeRead.js vì mặc định
// withNumFmt=false); lib/priceFileParser.js nhân lại ×100 cho đúng ô % qua cellTextWithFmt()/
// percentFromFraction() — dùng toFixed(9) để loại nhiễu bit cuối của phép nhân dấu phẩy động
// (VD 0.07*100 JS ra 7.000000000000001) mà KHÔNG làm tròn số liệu % thật.
//
// Chạy: node server/tests/test-pricefile-percent-format.js
'use strict';
const assert = require('assert');
const ExcelJS = require('exceljs');
const { parsePriceFile } = require('../lib/priceFileParser');

function check(results, name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }

async function buildWorkbookBuffer() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('BangGia');
  sheet.addRow(['Mã hàng', 'Tên hàng', 'Chiết khấu', 'Giá mới']);
  const r2 = sheet.addRow(['SP001', 'Hàng A', 0.12345, 10000]);
  r2.getCell(3).numFmt = '0.00%';
  const r3 = sheet.addRow(['SP002', 'Hàng B', 0.085, 20000]);
  r3.getCell(3).numFmt = '0.00%';
  const r4 = sheet.addRow(['SP003', 'Hàng C', 0.07, 30000]); // numFmt "0%" (nguyên phần trăm, không lẻ)
  r4.getCell(3).numFmt = '0%';
  const r5 = sheet.addRow(['SP004', 'Hàng D', 1.2345, 40000]); // numFmt "0.00%" nhưng cell.value > 1
  r5.getCell(3).numFmt = '0.00%';
  return wb.xlsx.writeBuffer();
}

async function main() {
  const results = [];
  const buffer = await buildWorkbookBuffer();
  const template = { columns: [
    { key: 'ma', label: 'Mã hàng' },
    { key: 'ten', label: 'Tên hàng' },
    { key: 'ck', label: 'Chiết khấu' },
    { key: 'gia', label: 'Giá mới' }
  ] };

  const { items } = await parsePriceFile(buffer, template);

  check(results, 'Ô % "0.00%" (0.12345 -> 12.345, không làm tròn/mất số lẻ)',
    items[0].values.ck === '12.345', `thực tế "${items[0]?.values?.ck}"`);
  check(results, 'Ô % "0.00%" (0.085 -> 8.5)',
    items[1].values.ck === '8.5', `thực tế "${items[1]?.values?.ck}"`);
  check(results, 'Ô % "0%" (0.07 -> 7, không dính nhiễu dấu phẩy động kiểu "7.000000000000001")',
    items[2].values.ck === '7', `thực tế "${items[2]?.values?.ck}"`);
  check(results, 'Ô % > 100% (1.2345 -> 123.45, không dính nhiễu kiểu "123.44999999999999")',
    items[3].values.ck === '123.45', `thực tế "${items[3]?.values?.ck}"`);
  check(results, 'Cột KHÔNG định dạng % (Giá mới) không bị đụng tới (vẫn đọc nguyên văn số)',
    items[0].values.gia === '10000', `thực tế "${items[0]?.values?.gia}"`);
  check(results, 'Cột text thường (Tên hàng) không bị ảnh hưởng',
    items[0].values.ten === 'Hàng A', `thực tế "${items[0]?.values?.ten}"`);

  let pass = 0;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.pass ? '' : ' -> ' + r.detail}`);
    if (r.pass) pass++;
  }
  console.log(`\n${pass}/${results.length} passed.`);
  if (pass !== results.length) process.exit(1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
