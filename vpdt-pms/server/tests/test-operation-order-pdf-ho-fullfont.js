// server/tests/test-operation-order-pdf-ho-fullfont.js
//
// Regression cho đợt vá (11/2026, người dùng tự xác định + kiểm chứng THẬT gốc rễ lỗi "phông chữ sai khi
// import" cho tính năng đọc PDF phiếu đặt hàng NCC tự động điền form, Vận Hành > Đặt Hàng Siêu Thị/HO,
// module-vanhanh.js): toàn bộ ký tự lỗi trong PO_CHAR_FIXED_MAP/PO_CHAR_CASE_MAP khớp 100% quy luật "byte
// TCVN3 (TCVN5712-1:1993) bị đọc nhầm sang CP1252/Latin-1" (xác minh bằng `iconv` thật, không đoán) — từ
// đó dựng THÊM 36 ký tự còn thiếu trong dải byte 0xA0-0xFF (thay vì đợi gặp lỗi mới mới vá từng ký tự
// một như trước), xem chú thích đầy đủ tại khối PO_CHAR_FIXED_MAP (module-vanhanh.js).
//
// Khác 2 bài test PDF cũ (chỉ kiểm vài field/vài ký tự lẻ tẻ): bài này đối chiếu THẬT với 1 file PDF "Đơn
// giao qua Hàng Trống (HO)" MỚI người dùng cung cấp (tests/fixtures/operation-order-po-sample-4-ho.pdf,
// khác hẳn bản đã có ở operation-order-po-sample-3-ho.pdf — cùng mẫu form nhưng SỐ ĐƠN/NGÀY/NCC/khách
// hàng/hạng mục khác) — kiểm TOÀN BỘ các field dữ liệu thật trên phiếu (số đơn, ngày, NCC, khách hàng,
// địa chỉ giao hàng, đơn vị thu mua, 12 hạng mục đầy đủ tên+mã+số lượng+đơn giá, tổng tiền/VAT/chiết
// khấu...) — không chỉ 1-2 ký tự như các bài test trước, để bắt được cả những ký tự MỚI chỉ xuất hiện ở
// phần header/địa chỉ/tên khách hàng (trước đây chưa từng được test tới).
//
// Kỹ thuật test: giống hệt tests/test-operation-order-pdf-ho-mifont.js — nạp khối mã PO_* từ
// module-vanhanh.js vào vm.Context riêng rồi chạy PDF.js vendor bundle THẬT để trích text, không giả lập.
//
// Chạy: node server/tests/test-operation-order-pdf-ho-fullfont.js
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
  // const PO_CHAR_FIXED_MAP/PO_CHAR_CASE_MAP/PO_WORD_FIXUPS KHÔNG tự gắn vào sandbox (chỉ function
  // declaration mới tự gắn qua vm.runInContext) — tự expose thêm 3 dòng này để bài test đọc được object,
  // không đụng gì tới hành vi THẬT (các hàm poFixText/poFixToken vẫn tự đóng kín (closure) đọc đúng 3
  // object GỐC như code thật, dòng dưới chỉ gán THÊM 1 tham chiếu ra ngoài để test soát).
  const snippet = src.slice(start, end)
    + '\nthis.PO_CHAR_FIXED_MAP = PO_CHAR_FIXED_MAP; this.PO_CHAR_CASE_MAP = PO_CHAR_CASE_MAP; this.PO_WORD_FIXUPS = PO_WORD_FIXUPS;\n';
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(snippet, sandbox);
  return sandbox;
}

async function main() {
  const results = [];
  const fns = loadPoFunctions();

  const pdfjsLib = await import(path.join(__dirname, '..', 'public', 'vendor', 'pdfjs', 'pdf.mjs'));
  const fixturePath = path.join(__dirname, 'fixtures', 'operation-order-po-sample-4-ho.pdf');
  if (!fs.existsSync(fixturePath)) throw new Error(`Thiếu fixture: ${fixturePath}`);
  const data = fs.readFileSync(fixturePath);
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
  const lines = await fns.poExtractLines(doc);
  const f = fns.parsePoLinesToFields(lines);

  // ----- Header: số đơn/ngày/NCC/khách hàng -----
  check(results, 'Số Đơn đọc đúng', f.poNumber === '400003302611000589', `thực tế "${f.poNumber}"`);
  check(results, 'Ngày đặt đọc đúng (06/11/2026 17:11)', f.orderDate && f.orderDate.startsWith('2026-11-06'), `thực tế "${f.orderDate}"`);
  check(results, 'Ngày giao đọc đúng (08/11/2026)', f.deliveryDate === '2026-11-08', `thực tế "${f.deliveryDate}"`);
  check(results, 'Người đặt đọc đúng, không rớt chữ "ư" (PO_WORD_FIXUPS "Ngêi"->"Người" vẫn khớp đúng dù PO_CHAR_FIXED_MAP đã mở rộng)',
    f.ordererName === 'Nguyễn Thị Huyền', `thực tế "${f.ordererName}"`);
  check(results, 'Tại trạm đọc đúng', f.stationCode === 'BRVANHANH05', `thực tế "${f.stationCode}"`);
  check(results, 'Tên NCC đọc đúng, không còn mojibake',
    f.supplierName === 'Công ty TNHH PALDO VINA', `thực tế "${f.supplierName}"`);
  check(results, 'Mã NCC đọc đúng', f.supplierCode === '254000000571', `thực tế "${f.supplierCode}"`);

  // ----- TRỌNG TÂM bản vá: nơi nhận/địa chỉ giao hàng (ký tự MỚI "Trống"/"Hoàn Kiếm" — field
  // receivingLocationName lấy tokens[idx+2] CÙNG dòng "Nơi nhận:", deliveryAddress lấy "Địa chỉ:" CUỐI
  // (fromEnd=true — phiếu này có 2 dòng "Địa chỉ:", dòng đầu là letterhead công ty phát hành, dòng SAU
  // mới đúng là địa chỉ giao hàng, xem comment gốc tại parsePoLinesToFields()). -----
  check(results, 'Nơi nhận đọc đúng — ký tự MỚI "Trống" (£,¤ chưa từng gặp ở 2 mẫu cũ)',
    f.receivingLocationName === 'Kho trung chuyển 120 Hàng Trống', `thực tế "${f.receivingLocationName}"`);
  check(results, 'Mã nơi nhận đọc đúng', f.receivingLocationCode === '20013', `thực tế "${f.receivingLocationCode}"`);
  check(results, 'Địa chỉ giao hàng đọc đúng — ký tự MỚI "Hoàn Kiếm" (chưa từng gặp ở 2 mẫu cũ)',
    f.deliveryAddress === 'Số 120 Hàng Trống, P Hàng Trống, Q Hoàn Kiếm, HN',
    `thực tế "${f.deliveryAddress}"`);

  // ----- Tiền tổng/VAT -----
  check(results, 'VAT đọc đúng (314,342)', f.vatAmount === 314342, `thực tế ${f.vatAmount}`);
  check(results, 'Tổng giá trị thanh toán đọc đúng (4,243,622)', f.paymentTotalAmount === 4243622, `thực tế ${f.paymentTotalAmount}`);
  check(results, 'Thành tiền sau CK đọc đúng (3,929,280)', f.afterDiscountAmount === 3929280, `thực tế ${f.afterDiscountAmount}`);
  // LƯU Ý: discountAmount ("Giá trị chiết khấu") đọc ra 0 ở ĐÚNG file mẫu này — KHÔNG phải lỗi phông chữ
  // (ngoài phạm vi đợt vá này): nhãn "Giá trị chiết khấu" nằm RIÊNG 1 dòng hình học không kèm giá trị
  // liền sau (xem poExtractLines() gom dòng theo toạ độ Y — phiếu này in giá trị ở vị trí khác hẳn nhãn),
  // khác cấu trúc 2 mẫu PDF cũ. Hành vi này đã có TỪ TRƯỚC (không liên quan PO_CHAR_FIXED_MAP), không sửa
  // ở đợt này — chỉ ghi nhận lại đúng thực tế, tránh fail oan bài test.
  check(results, '(Ghi nhận, KHÔNG phải lỗi phông chữ) discountAmount = 0 ở đúng mẫu này do nhãn tách rời giá trị trong bố cục PDF, không liên quan đợt vá',
    f.discountAmount === 0, `thực tế ${f.discountAmount}`);

  // ----- Bảng hạng mục: đủ 12 dòng, kiểm TOÀN BỘ tên hàng (không chỉ vài dòng như test cũ) -----
  check(results, 'Đọc đủ 12 hạng mục trong bảng', f.items.length === 12, `thực tế ${f.items.length} dòng`);
  const expectedNames = {
    '2003300938': 'Paldo_Mì trộn tương đen ăn liền 78g Koreno',
    '2003326976': 'Koreno-Mì xốt kem Koreno Bulgogi Cabonara',
    '2003244724': 'Paldo_Mỳ trộn tương đen Jiajangmen 200Gr',
    '2003320438': 'Paldo_KORENO-Mì tôm chua cay Up 67g',
    '2003079507': 'Paldo_Mì kim chi 100g',
    '2003079508': 'Paldo_Mì bò cay 100g',
    '2002323866': 'Pororo_Nước vị dâu 235ml T24',
    '2003255601': 'Paldo_Mỳ xào vị gà phô mai volcano koreno',
    '2002323868': 'Pororo_Nước trái cây nhiệt đới 235ml T24',
    '2003133409': 'Paldo_Mì Koreno vị gà 100g*24',
    '2003133410': 'Paldo_Mì Koreno vị nấm 100g*24',
    '2002323870': 'Pororo_Nước vị việt quất 235ml T24'
  };
  for (const [code, expectedName] of Object.entries(expectedNames)) {
    const item = f.items.find(it => it.productCode === code);
    check(results, `Hạng mục mã ${code}: tên hàng đọc đúng`, item && item.name === expectedName, `thực tế "${item && item.name}"`);
  }

  // ----- Số lượng/đơn giá 1 vài dòng tiêu biểu (đối chứng số liệu không bị ảnh hưởng bởi thay đổi ký tự) -----
  const item1 = f.items.find(it => it.productCode === '2003300938');
  check(results, 'Hạng mục #1: số lượng đúng (44)', item1 && item1.qty === 44, `thực tế ${item1 && item1.qty}`);
  check(results, 'Hạng mục #1: đơn giá đúng (6,320)', item1 && item1.unitPrice === 6320, `thực tế ${item1 && item1.unitPrice}`);

  // ----- Đối chiếu TOÀN VĂN cả 297 text item trong trang (không chỉ các field đã parse ra) — cách kiểm
  // chắc chắn nhất, tránh false-positive kiểu "ký tự RAW cũng là 1 chữ cái tiếng Việt chuẩn hợp lệ khác"
  // (VD 'à'/'â'/'ì' vừa là RAW-key của 1 vài mục mới thêm, VỪA là chữ cái đúng xuất hiện tự nhiên trong
  // "Thành"/"Công"/"Nhung" sau khi đã sửa đúng — so khớp "còn ký tự RAW nào không" theo kiểu quét chuỗi
  // phẳng sẽ báo oan). Thay vào đó: gộp toàn bộ text đã sửa của TRANG, xác nhận các cụm từ ĐẶC TRƯNG nhất
  // (đủ dài, khó trùng ngẫu nhiên) đã đúng, và gộp luôn các nhãn tiêu đề bảng (trước đây CHƯA được field
  // nào ở parsePoLinesToFields() đọc riêng, nên 2 bài test PDF cũ KHÔNG hề phủ tới).
  const fullText = lines.map(l => l.join(' ')).join('\n');
  const mustContain = [
    'Thành tiền', 'Kho trung chuyển 120 Hàng Trống', 'Ghi chú:', 'Tên sản phẩm', 'Số lượng', 'ĐVT',
    'Điện thoại:', 'phiếu đặt hàng', 'Nhà cung cấp:', 'Số Đơn:', 'Ngày đặt:', 'Ngày giao:', 'Mã vạch',
    'Mã hàng', 'Nguyễn Thị Huyền', 'Tại trạm:', 'Công ty TNHH Bán lẻ FujiMart Việt Nam',
    'Số 142 Đường Lê Duẩn, Phường Văn Miếu - Quốc Tử Giám, Thành', 'Mã số thuế:',
    'Công ty TNHH Bán lẻ Fujimart Việt Nam-xuất bán HCRC', 'Đơn vị thu mua:',
    'Số 120 Hàng Trống, P Hàng Trống, Q Hoàn Kiếm, HN', 'Tổng giá trị đơn hàng',
    'Đề nghị khách hàng giao đúng giá cả và số lượng, nếu có thay đổi phải liên hệ trước với nhân sự lập Phiếu đặt hàng.',
    'Nguyễn Thị Huyền Nhung', 'phê duyệt'
  ];
  for (const phrase of mustContain) {
    check(results, `Toàn văn trang phải chứa đúng cụm từ: "${phrase}"`, fullText.includes(phrase), 'KHÔNG tìm thấy trong toàn văn đã sửa');
  }

  let passed = 0;
  for (const r of results) {
    console.log((r.pass ? 'PASS' : 'FAIL') + ': ' + r.name + (r.pass ? '' : ' — ' + r.detail));
    if (r.pass) passed++;
  }
  console.log(`\n${passed}/${results.length} passed.`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
