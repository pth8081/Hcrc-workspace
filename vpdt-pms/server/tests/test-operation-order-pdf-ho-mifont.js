// server/tests/test-operation-order-pdf-ho-mifont.js
//
// Regression cho đợt vá (11/2026, mẫu PDF "Đơn giao qua Hàng Trống (HO)" người dùng cung cấp kèm báo
// cáo "phông chữ sai khi import vào hệ thống đặt hàng siêu thị và HO") cho tính năng đọc PDF phiếu đặt
// hàng NCC tự động điền form (Vận Hành > Đặt Hàng Siêu Thị/HO, module-vanhanh.js):
//
// 1) 2 ký tự mojibake MỚI chưa từng gặp ở 2 mẫu trước, CHỈ xuất hiện trong tên sản phẩm:
//    '×' -> 'ì' (vd "Paldo_M×..." -> "Paldo_Mì..."), 'ú' -> 'ỳ' (vd "Paldo_Mú..." -> "Paldo_Mỳ..." — 1
//    số sản phẩm dùng biến thể chính tả "Mỳ"). ĐÃ VÁ: bổ sung vào PO_CHAR_FIXED_MAP (CHỈ THÊM, không đổi
//    37 ký tự đã có).
// 2) "Pororo_Nước..." (3 dòng sản phẩm) đọc sai thành "Pororo_Nớc..." (rớt mất ký tự 'ư', CÙNG LỚP lỗi
//    đã biết — nhưng từ "Nước" ghép LIỀN bằng dấu "_" vào 1 token dài hơn "Pororo_Níc", trong khi
//    PO_WORD_FIXUPS trước đây chỉ so khớp ĐÚNG TOÀN BỘ token nên không bắt được). ĐÃ VÁ: thêm
//    'Níc':'Nước' VÀO PO_WORD_FIXUPS + đổi poFixToken() sang so khớp CHUỖI CON (tìm-và-thay mọi vị trí
//    xuất hiện trong token, không chỉ so khớp đúng toàn bộ token) — vẫn đúng 100% hành vi cũ cho các từ
//    đã có (khớp toàn bộ = trường hợp đặc biệt của khớp chuỗi con), không đổi 13 từ cũ.
//
// File fixture tests/fixtures/operation-order-po-sample-3-ho.pdf là file PDF THẬT người dùng cung cấp
// (đã xin phép dùng làm fixture hồi quy — không chứa dữ liệu nhạy cảm ngoài tên NCC/địa chỉ/mặt hàng
// công khai trên phiếu đặt hàng).
//
// Kỹ thuật test: giống hệt tests/test-operation-order-pdf-hdmuachung.js — nạp khối mã PO_* từ
// module-vanhanh.js vào vm.Context riêng rồi chạy PDF.js vendor bundle THẬT để trích text, không giả lập.
//
// Chạy: node server/tests/test-operation-order-pdf-ho-mifont.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function check(results, name, cond, detail) { results.push({ name, pass: !!cond, detail: cond ? '' : (detail || '') }); }

function loadPoFunctions() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'module-vanhanh.js'), 'utf8');
  const start = src.indexOf('const PO_CHAR_FIXED_MAP');
  const end = src.indexOf('// Điền field đơn');
  if (start === -1 || end === -1) throw new Error('Không tìm thấy khối mã PO_* trong module-vanhanh.js (có thể đã đổi tên/cấu trúc)');
  const snippet = src.slice(start, end);
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(snippet, sandbox);
  return sandbox;
}

async function main() {
  const results = [];
  const fns = loadPoFunctions();

  const pdfjsLib = await import(path.join(__dirname, '..', 'public', 'vendor', 'pdfjs', 'pdf.mjs'));
  const fixturePath = path.join(__dirname, 'fixtures', 'operation-order-po-sample-3-ho.pdf');
  if (!fs.existsSync(fixturePath)) throw new Error(`Thiếu fixture: ${fixturePath}`);
  const data = fs.readFileSync(fixturePath);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
  const lines = await fns.poExtractLines(doc);
  const f = fns.parsePoLinesToFields(lines);

  // ----- Field header: không đổi hành vi field đã đúng từ trước -----
  // Lưu ý: dòng "Người đặt:" ở ĐẦU phiếu này chỉ ghi "Nguyễn Thị Huyền" (CHÍNH PDF nguồn từ DSmart đã
  // rút gọn vậy, không phải lỗi tách token của poFindMultiTokenValueAfterLabel() — tên ĐẦY ĐỦ "Nguyễn
  // Thị Huyền Nhung" chỉ xuất hiện riêng ở khối CHỮ KÝ cuối phiếu, 1 dòng/field hoàn toàn khác, không
  // phải cùng 1 field "Người đặt:" để gộp token).
  check(results, 'Người đặt đọc đúng (đúng như PDF nguồn ghi ở dòng "Người đặt:", không lẫn tên ở khối chữ ký)',
    f.ordererName === 'Nguyễn Thị Huyền', `thực tế "${f.ordererName}"`);
  check(results, 'Tên NCC đọc đúng, không còn mojibake',
    f.supplierName === 'Công ty TNHH PALDO VINA', `thực tế "${f.supplierName}"`);
  check(results, 'Tổng giá trị thanh toán đọc đúng (4,243,622)',
    f.paymentTotalAmount === 4243622, `thực tế ${f.paymentTotalAmount}`);
  check(results, 'VAT đọc đúng (314,342)',
    f.vatAmount === 314342, `thực tế ${f.vatAmount}`);

  // ----- Bảng hạng mục: đủ 12 dòng -----
  check(results, 'Đọc đủ 12 hạng mục trong bảng',
    f.items.length === 12, `thực tế ${f.items.length} dòng`);

  // ----- TRỌNG TÂM bản vá: ký tự mới '×'->'ì' / 'ú'->'ỳ' trong tên sản phẩm -----
  const item1 = f.items.find(it => it.productCode === '2003300938');
  check(results, 'Hạng mục #1: "Mì" đọc đúng (ký tự mới ×->ì, không còn "M×")',
    item1 && item1.name === 'Paldo_Mì trộn tương đen ăn liền 78g Koreno', `thực tế "${item1 && item1.name}"`);
  const item2 = f.items.find(it => it.productCode === '2003326976');
  check(results, 'Hạng mục #2: "Mì xốt" đọc đúng (ký tự mới ×->ì)',
    item2 && item2.name === 'Koreno-Mì xốt kem Koreno Bulgogi Cabonara', `thực tế "${item2 && item2.name}"`);
  const item3 = f.items.find(it => it.productCode === '2003244724');
  check(results, 'Hạng mục #3: "Mỳ" đọc đúng (ký tự mới ú->ỳ, biến thể chính tả khác "Mì")',
    item3 && item3.name === 'Paldo_Mỳ trộn tương đen Jiajangmen 200Gr', `thực tế "${item3 && item3.name}"`);
  const item8 = f.items.find(it => it.productCode === '2003255601');
  check(results, 'Hạng mục #8: "Mỳ xào" đọc đúng (ký tự mới ú->ỳ)',
    item8 && item8.name === 'Paldo_Mỳ xào vị gà phô mai volcano koreno', `thực tế "${item8 && item8.name}"`);

  // ----- TRỌNG TÂM bản vá: "Pororo_Nước..." (từ dính liền token dài hơn qua dấu "_") -----
  const item7 = f.items.find(it => it.productCode === '2002323866');
  check(results, 'Hạng mục #7: "Pororo_Nước vị dâu" đọc đúng (không còn "Nớc" thiếu chữ ư)',
    item7 && item7.name === 'Pororo_Nước vị dâu 235ml T24', `thực tế "${item7 && item7.name}"`);
  const item9 = f.items.find(it => it.productCode === '2002323868');
  check(results, 'Hạng mục #9: "Pororo_Nước trái cây nhiệt đới" đọc đúng',
    item9 && item9.name === 'Pororo_Nước trái cây nhiệt đới 235ml T24', `thực tế "${item9 && item9.name}"`);
  const item12 = f.items.find(it => it.productCode === '2002323870');
  check(results, 'Hạng mục #12: "Pororo_Nước vị việt quất" đọc đúng',
    item12 && item12.name === 'Pororo_Nước vị việt quất 235ml T24', `thực tế "${item12 && item12.name}"`);

  // ----- Các hạng mục còn lại không bị ảnh hưởng (không dùng ký tự mới) -----
  const item5 = f.items.find(it => it.productCode === '2003079507');
  check(results, 'Hạng mục #5: không có ký tự mới vẫn đọc đúng (regression)',
    item5 && item5.name === 'Paldo_Mì kim chi 100g', `thực tế "${item5 && item5.name}"`);

  const total = results.length, passed = results.filter(r => r.pass).length;
  results.forEach(r => console.log((r.pass ? 'PASS' : 'FAIL') + ': ' + r.name + (r.pass ? '' : `\n      ${r.detail}`)));
  console.log('');
  console.log(`${passed}/${total} passed.`);
  if (passed !== total) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
