// server/tests/test-operation-order-po-fields.js
//
// Regression test cho đợt "Đọc PDF Đơn Hàng tự động điền form" (Vận Hành > 📦 Đơn Hàng) — phần server-side
// (lib/createValidation.js operationOrders.extraValidate): các field MỚI đọc được từ phiếu đặt hàng NCC
// (Số Đơn/Ngày đặt/Ngày giao/Người đặt/Tại trạm/Mã NCC/MST NCC/Mã & tên nơi nhận/Địa chỉ giao hàng/Giá
// trị chiết khấu/VAT/Thành tiền sau CK/Tổng giá trị thanh toán, cùng 3 field mới ở từng hạng mục —
// Mã hàng/Mã vạch/Thực nhận) PHẢI hoàn toàn optional — không phá vỡ hồ sơ tạo tay kiểu CŨ (không có field
// nào trong nhóm này), và phải lưu/đọc lại đúng khi có đủ.
//
// Test THUẦN Node (không Playwright) — gọi thẳng validateAndPrepareCreate('operationOrders', ...) thật,
// cùng khuôn tests/test-audit-round3-lowfixes.js.
//
// Chạy: node server/tests/test-operation-order-po-fields.js
const assert = require('assert');
const { validateAndPrepareCreate } = require('../lib/createValidation');

let passed = 0, failed = 0;
function run(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err && err.stack || err}`);
  }
}

const USER = { username: 'vh_creator', name: 'Người Tạo Đơn Hàng', dept: 'Vận Hành', perms: { operationOrderCreate: true }, active: true };

// ===== (a) Tạo hồ sơ KHÔNG có bất kỳ field mới nào — phải hoạt động y hệt trước đợt này =====
run('operationOrders: tạo hồ sơ KIỂU CŨ (không field PDF-autofill) vẫn hợp lệ', () => {
  const payload = {
    code: 'VH-DH-OLD-001',
    title: 'Đặt hàng văn phòng phẩm (nhập tay, không PDF)',
    supplier: 'Công ty ABC',
    note: '',
    items: [{ name: 'Giấy A4', unit: 'Ram', qty: 10, unitPrice: 60000 }],
    fileUrl: '/uploads/quote-test-file.pdf', fileName: 'quote.pdf', fileType: 'application/pdf'
  };
  const record = validateAndPrepareCreate('operationOrders', payload, USER, [], {}, []);
  assert.strictEqual(record.title, payload.title);
  assert.strictEqual(record.amount, 600000);
  assert.strictEqual(record.items.length, 1);
  // Field mới phải tự về rỗng/0 — KHÔNG throw, KHÔNG undefined làm hỏng JSON.stringify khi lưu.
  assert.strictEqual(record.poNumber, '');
  assert.strictEqual(record.orderDate, '');
  assert.strictEqual(record.deliveryDate, '');
  assert.strictEqual(record.ordererName, '');
  assert.strictEqual(record.stationCode, '');
  assert.strictEqual(record.supplierCode, '');
  assert.strictEqual(record.supplierTaxCode, '');
  assert.strictEqual(record.receivingLocationCode, '');
  assert.strictEqual(record.receivingLocationName, '');
  assert.strictEqual(record.deliveryAddress, '');
  assert.strictEqual(record.discountAmount, 0);
  assert.strictEqual(record.vatAmount, 0);
  assert.strictEqual(record.afterDiscountAmount, 0);
  assert.strictEqual(record.paymentTotalAmount, 0);
  // Item cũ không có productCode/barcode/qtyReceived -> tự về '' / null, KHÔNG lỗi.
  assert.strictEqual(record.items[0].productCode, '');
  assert.strictEqual(record.items[0].barcode, '');
  assert.strictEqual(record.items[0].qtyReceived, null);
  assert.strictEqual(record.status, 'PENDING');
});

// ===== (b) Tạo hồ sơ ĐẦY ĐỦ field đọc từ PDF — lưu & đọc lại đúng =====
run('operationOrders: tạo hồ sơ ĐẦY ĐỦ field PDF-autofill lưu & đọc lại đúng', () => {
  const payload = {
    code: 'VH-DH-PDF-001',
    title: 'Đặt hàng NCC Công ty CP KD CB Nông Sản Bảo Minh - 400001302608000212',
    supplier: 'Công ty cổ phần kinh doanh chế biến nông sản Bảo Minh',
    note: 'Tự điền từ PDF 120HT_PO.pdf',
    fileUrl: '/uploads/120HT_PO-test-file.pdf', fileName: '120HT_PO.pdf', fileType: 'application/pdf',
    poNumber: '400001302608000212',
    orderDate: '2026-08-27T09:22',
    deliveryDate: '2026-08-29',
    ordererName: 'Nguyễn Thị Hương Giang',
    stationCode: 'BRVANHANH19',
    supplierCode: '254000001184',
    supplierTaxCode: '0106705176',
    receivingLocationCode: '10011',
    receivingLocationName: 'Siêu thị BRGMart 120 Hàng Trống',
    deliveryAddress: 'Số 120 Hàng Trống, P Hàng Trống, Q Hoàn Kiếm, HN',
    discountAmount: 0,
    vatAmount: 115848,
    afterDiscountAmount: 2108100,
    paymentTotalAmount: 2223948,
    items: [
      { name: 'OCOP- Trà táo mèo ShanThinh 192g', productCode: '2002601843', barcode: '8938517876158', unit: 'H', qty: 6, unitPrice: 43200, qtyReceived: 6 },
      { name: 'BẢO MINH - Miến dong ĐS Làng So 200g', productCode: '2003316579', barcode: '8936096741195', unit: 'G', qty: 6, unitPrice: 24650 }
    ]
  };
  const record = validateAndPrepareCreate('operationOrders', payload, USER, [], {}, []);
  assert.strictEqual(record.poNumber, '400001302608000212');
  assert.strictEqual(record.orderDate, new Date('2026-08-27T09:22').toISOString());
  assert.strictEqual(record.deliveryDate, new Date('2026-08-29').toISOString());
  assert.strictEqual(record.ordererName, 'Nguyễn Thị Hương Giang');
  assert.strictEqual(record.stationCode, 'BRVANHANH19');
  assert.strictEqual(record.supplierCode, '254000001184');
  assert.strictEqual(record.supplierTaxCode, '0106705176');
  assert.strictEqual(record.receivingLocationCode, '10011');
  assert.strictEqual(record.receivingLocationName, 'Siêu thị BRGMart 120 Hàng Trống');
  assert.strictEqual(record.deliveryAddress, 'Số 120 Hàng Trống, P Hàng Trống, Q Hoàn Kiếm, HN');
  assert.strictEqual(record.discountAmount, 0);
  assert.strictEqual(record.vatAmount, 115848);
  assert.strictEqual(record.afterDiscountAmount, 2108100);
  assert.strictEqual(record.paymentTotalAmount, 2223948);
  // amount = tổng qty*unitPrice tự tính lại phía server (KHÔNG tin số client gửi) — vẫn đúng logic cũ,
  // không bị field mới can thiệp: 6*43200 + 6*24650 = 259200 + 147900 = 407100.
  assert.strictEqual(record.amount, 407100);
  assert.strictEqual(record.items[0].productCode, '2002601843');
  assert.strictEqual(record.items[0].barcode, '8938517876158');
  assert.strictEqual(record.items[0].qtyReceived, 6);
  // Item 2 không gửi qtyReceived -> null (khác 0 thật, "chưa nhận" != "nhận 0").
  assert.strictEqual(record.items[1].qtyReceived, null);
  assert.strictEqual(record.items[1].productCode, '2003316579');
});

// ===== (c) Số tiền hợp lệ (mô phỏng getMoneyValue() ở client ĐÃ tự strip dấu phân cách hàng nghìn
// trước khi gửi JSON, cùng khuôn mọi field tiền khác trong hệ thống — VD unitPrice/approvedBudget)
// round-trip đúng số nguyên; chuỗi còn sót ký tự lạ (client lỗi/bỏ qua getMoneyValue()) không được làm
// hỏng bản ghi (Number(...)||0 tự về 0 an toàn, không throw/NaN) =====
run('operationOrders: discountAmount/vatAmount số nguyên round-trip đúng, chuỗi lạ tự về 0 an toàn', () => {
  const payload = {
    code: 'VH-DH-PDF-002', title: 'Test parse số', supplier: 'NCC X',
    items: [{ name: 'Hàng test', unit: 'Cái', qty: 1, unitPrice: 1000 }],
    discountAmount: 50000, vatAmount: 115848, paymentTotalAmount: 2223948
  };
  const record = validateAndPrepareCreate('operationOrders', payload, USER, [], {}, []);
  assert.strictEqual(record.discountAmount, 50000);
  assert.strictEqual(record.vatAmount, 115848);
  assert.strictEqual(record.paymentTotalAmount, 2223948);

  const badPayload = { ...payload, code: 'VH-DH-PDF-002B', discountAmount: '50,000' };
  const badRecord = validateAndPrepareCreate('operationOrders', badPayload, USER, [], {}, []);
  assert.strictEqual(badRecord.discountAmount, 0); // an toàn: không throw, không NaN, không giữ chuỗi thô
});

// ===== Số âm/định dạng sai vẫn bị chặn/làm sạch đúng như hành vi field cũ (không field mới nào yếu bảo mật hơn) =====
run('operationOrders: discountAmount âm bị ép về 0 (Math.max(0, ...))', () => {
  const payload = {
    code: 'VH-DH-PDF-003', title: 'Test số âm', supplier: 'NCC Y',
    items: [{ name: 'Hàng test', unit: 'Cái', qty: 1, unitPrice: 1000 }],
    discountAmount: -5000
  };
  const record = validateAndPrepareCreate('operationOrders', payload, USER, [], {}, []);
  assert.strictEqual(record.discountAmount, 0);
});

run('operationOrders: orderDate/deliveryDate sai định dạng tự về rỗng, KHÔNG throw', () => {
  const payload = {
    code: 'VH-DH-PDF-004', title: 'Test ngày sai', supplier: 'NCC Z',
    items: [{ name: 'Hàng test', unit: 'Cái', qty: 1, unitPrice: 1000 }],
    orderDate: 'không phải ngày', deliveryDate: 'abc'
  };
  const record = validateAndPrepareCreate('operationOrders', payload, USER, [], {}, []);
  assert.strictEqual(record.orderDate, '');
  assert.strictEqual(record.deliveryDate, '');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
