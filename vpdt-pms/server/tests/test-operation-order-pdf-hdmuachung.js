// server/tests/test-operation-order-pdf-hdmuachung.js
//
// Regression cho đợt vá (10/2026, mẫu PDF "HD mua chung" người dùng cung cấp) cho tính năng đọc PDF
// phiếu đặt hàng NCC tự động điền form (Vận Hành > Đặt Hàng Siêu Thị/HO, module-vanhanh.js):
//
// 1) Mã NCC không đọc được: mẫu "HD mua chung" ghi nhãn ĐẦY ĐỦ "Nhà cung cấp:" thay vì viết tắt "NCC:"
//    (mẫu 120HT_PO.pdf gốc dùng) — poFindValueAfterLabel() so khớp CHÍNH XÁC từng ký tự nên không bắt
//    được nhãn khác. ĐÃ VÁ: poFindValueAfterAnyLabel() thử lần lượt nhiều nhãn.
// 2) Lỗi chính tả sau import: mẫu "HD mua chung" dùng CÙNG họ phông chữ Việt kiểu cũ (TCVN3/.VnTime)
//    nhưng có vài ký tự/từ mojibake KHÁC mẫu gốc (vd 'í'->'ớ', '»'->'ằ', 'ö'->'ử', 'Ñ'->'ẹ', '÷'->'ữ',
//    và các từ bị rớt ký tự 'ư': "Dương"/"Lương"/"hương"/"nướng"/"Đường"). ĐÃ VÁ: bổ sung thêm vào
//    PO_CHAR_FIXED_MAP/PO_WORD_FIXUPS (CHỈ THÊM, không đổi 35 ký tự + 8 từ của mẫu gốc).
// 3) Số lượng/thành tiền sai khi giá trị lớn: poParseMoney() cũ giữ nguyên dấu chấm (coi là thập phân) —
//    "100.000.000" (2+ dấu chấm) ra NaN -> về 0. ĐÃ VÁ: poParseVNNumber() tự nhận diện dấu phân cách
//    NGHÌN (theo sau có đúng 3 chữ số) khác dấu THẬP PHÂN (theo sau có 1-2 chữ số) — đúng cho CẢ 2 kiểu
//    dấu (mẫu "HD mua chung" dùng PHẨY làm phân cách nghìn — "1,659,588").
//
// File fixture tests/fixtures/operation-order-po-sample-2.pdf là file PDF THẬT người dùng cung cấp (đã
// xin phép dùng làm fixture hồi quy — không chứa dữ liệu nhạy cảm ngoài tên NCC/địa chỉ/mặt hàng công
// khai trên phiếu đặt hàng).
//
// Kỹ thuật test: các hàm poExtractLines()/parsePoLinesToFields()/... được định nghĩa thẳng trong
// public/js/module-vanhanh.js (file client, không phải CommonJS module) nên không require() được — nạp
// đúng khối mã nguồn liên quan (từ PO_CHAR_FIXED_MAP tới hết parsePoLinesToFields(), KHÔNG đụng gì tới
// phần DOM/event-handler phía dưới) vào 1 vm.Context riêng rồi chạy PDF.js vendor bundle THẬT
// (public/vendor/pdfjs/pdf.mjs, giống hệt trình duyệt dùng) để trích text — không giả lập gì.
//
// Chạy: node server/tests/test-operation-order-pdf-hdmuachung.js
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
  const fixturePath = path.join(__dirname, 'fixtures', 'operation-order-po-sample-2.pdf');
  if (!fs.existsSync(fixturePath)) throw new Error(`Thiếu fixture: ${fixturePath}`);
  const data = fs.readFileSync(fixturePath);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
  const lines = await fns.poExtractLines(doc);
  const f = fns.parsePoLinesToFields(lines);

  // ----- 1) Mã/Tên NCC đọc được qua nhãn thay thế "Nhà cung cấp:" -----
  check(results, 'Mã NCC đọc được qua nhãn "Nhà cung cấp:" (mẫu không dùng "NCC:")',
    f.supplierCode === '254000000002', `thực tế "${f.supplierCode}"`);
  check(results, 'Tên NCC đọc đúng, không còn mojibake',
    f.supplierName === 'Chi nhánh Công ty TNHH phân phối Tiên Tiến (Kinh Đô)', `thực tế "${f.supplierName}"`);

  // ----- 2) Chính tả các field text khác (địa chỉ/nơi nhận) không còn mojibake -----
  check(results, 'Nơi nhận: tên siêu thị đúng chính tả (Hải Dương, không phải "Hải Dơng")',
    f.receivingLocationName === 'Siêu thị BRGMart Hải Dương', `thực tế "${f.receivingLocationName}"`);
  check(results, 'Địa chỉ giao hàng đúng chính tả (Nguyễn Lương Bằng/Phạm Ngũ Lão/Hải Dương)',
    f.deliveryAddress === 'Số 1 Nguyễn Lương Bằng, P. Phạm Ngũ Lão, TP Hải Dương', `thực tế "${f.deliveryAddress}"`);
  check(results, 'Người đặt đọc đúng (không đổi hành vi field đã đúng từ trước)',
    f.ordererName === 'Nguyễn Thị Hương', `thực tế "${f.ordererName}"`);

  // ----- 3) Số tiền tổng (dấu phẩy phân cách nghìn — kiểu mẫu "HD mua chung") -----
  check(results, 'Thành tiền sau CK đọc đúng (1,659,588 -> 1659588, không chia 1000 lần)',
    f.afterDiscountAmount === 1659588, `thực tế ${f.afterDiscountAmount}`);
  check(results, 'VAT đọc đúng (132,767)',
    f.vatAmount === 132767, `thực tế ${f.vatAmount}`);
  check(results, 'Tổng giá trị thanh toán đọc đúng (1,792,355, KHÔNG về 0/NaN)',
    f.paymentTotalAmount === 1792355, `thực tế ${f.paymentTotalAmount}`);

  // ----- Bảng hạng mục: đủ 11 dòng, số lượng + đơn giá đúng -----
  check(results, 'Đọc đủ 11 hạng mục trong bảng',
    f.items.length === 11, `thực tế ${f.items.length} dòng`);
  const item1 = f.items[0], item5 = f.items[4], item9 = f.items[8];
  check(results, 'Hạng mục #1: số lượng đúng (12, không phải 1200/0.12)',
    item1 && item1.qty === 12, `thực tế ${item1 && item1.qty}`);
  check(results, 'Hạng mục #1: đơn giá đúng (15,277 -> 15277)',
    item1 && item1.unitPrice === 15277, `thực tế ${item1 && item1.unitPrice}`);
  check(results, 'Hạng mục #5: số lượng lẻ khác đúng (4.00 -> 4, không lẫn hạng mục khác)',
    item5 && item5.qty === 4, `thực tế ${item5 && item5.qty}`);
  check(results, 'Hạng mục #9: số lượng đúng (5.00 -> 5)',
    item9 && item9.qty === 5, `thực tế ${item9 && item9.qty}`);
  check(results, 'Hạng mục #1: tên sản phẩm đúng chính tả (không còn "xµo"/mojibake)',
    item1 && item1.name === 'AFC_B.quy hạt, th.mộc vị bắp xào bơ', `thực tế "${item1 && item1.name}"`);
  const itemNuong = f.items.find(it => it.productCode === '2001332977');
  check(results, 'Hạng mục #2: "PM nướng" đọc đúng chính tả (từ bị mất ký tự "ư")',
    itemNuong && itemNuong.name === 'AFC_B.quy hạt, th.mộc vị nấm PM nướng', `thực tế "${itemNuong && itemNuong.name}"`);
  const itemHuong = f.items.find(it => it.productCode === '2001332978');
  check(results, 'Hạng mục #3: "mini hương socola" đọc đúng chính tả (chữ thường "hương")',
    itemHuong && itemHuong.name === 'OREO_Bánh quy mini hương socola 58.4g', `thực tế "${itemHuong && itemHuong.name}"`);
  const itemKep = f.items.find(it => it.productCode === '2001332979');
  check(results, 'Hạng mục #4: "kẹp kem" đọc đúng chính tả (ký tự mới Ñ->ẹ)',
    itemKep && itemKep.name === 'OREO_Bánh quy SCL kẹp kem vị SC xoài', `thực tế "${itemKep && itemKep.name}"`);
  const itemSua = f.items.find(it => it.productCode === '2001332985');
  check(results, 'Hạng mục #10: "cốm non sữa" đọc đúng chính tả (ký tự mới ÷->ữ)',
    itemSua && itemSua.name === 'SOLITE_Bánh BL cuộn kem vị cốm non sữa', `thực tế "${itemSua && itemSua.name}"`);

  // ----- poParseVNNumber(): magnitude trực tiếp (chục nghìn/trăm triệu) không phụ thuộc dữ liệu PDF
  // thật có sẵn — kiểm cả 2 kiểu dấu phân cách (chấm/phẩy làm nghìn) theo đúng yêu cầu người dùng -----
  check(results, 'poParseVNNumber: "10.000" (chấm làm nghìn) -> 10000, không phải 10',
    fns.poParseVNNumber('10.000') === 10000, `thực tế ${fns.poParseVNNumber('10.000')}`);
  check(results, 'poParseVNNumber: "100.000.000" (2 dấu chấm làm nghìn) -> 100000000, không NaN/0',
    fns.poParseVNNumber('100.000.000') === 100000000, `thực tế ${fns.poParseVNNumber('100.000.000')}`);
  check(results, 'poParseVNNumber: "150,000,000" (phẩy làm nghìn) -> 150000000',
    fns.poParseVNNumber('150,000,000') === 150000000, `thực tế ${fns.poParseVNNumber('150,000,000')}`);
  check(results, 'poParseVNNumber: "12.00" (chấm thập phân thật, 2 số lẻ) -> 12, không phải 1200',
    fns.poParseVNNumber('12.00') === 12, `thực tế ${fns.poParseVNNumber('12.00')}`);
  check(results, 'poParseVNNumber: "2,5" (phẩy thập phân thật, 1 số lẻ) -> 2.5, không phải 25',
    fns.poParseVNNumber('2,5') === 2.5, `thực tế ${fns.poParseVNNumber('2,5')}`);
  check(results, 'poParseVNNumber: chuỗi rỗng/không hợp lệ -> 0 (không throw)',
    fns.poParseVNNumber('') === 0 && fns.poParseVNNumber('abc') === 0, 'throw hoặc khác 0');

  let pass = 0;
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}: ${r.name}${r.pass ? '' : ' -> ' + r.detail}`);
    if (r.pass) pass++;
  }
  console.log(`\n${pass}/${results.length} passed.`);
  if (pass !== results.length) process.exit(1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
