// server/tests/test-operation-order-items-and-dates.js
//
// 2 LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm — cụm "Vận Hành", mức Thấp):
//  1. editOperationOrderDraft() (lib/recordActions.js — đường ghi của "Yêu Cầu Bổ Sung" -> người tạo sửa
//     lại đơn, POST /api/records/operationOrders/:id/update) dựng LẠI object hạng mục từ đầu nhưng chỉ
//     liệt kê 6 field cũ -> 3 field đọc từ phiếu đặt hàng NCC (productCode/barcode/qtyReceived, đợt "Đọc
//     PDF Đơn Hàng tự động điền form") RƠI MẤT sau mỗi vòng sửa-gửi lại, dù nhánh TẠO MỚI
//     (lib/createValidation.js operationOrders.extraValidate) vẫn lưu đủ.
//  2. Tạo đơn hàng KHÔNG đối chiếu deliveryDate với orderDate — gõ nhầm (hoặc parser PDF đọc nhầm năm)
//     Ngày Giao TRƯỚC Ngày Đặt vẫn lưu bình thường, đi thẳng vào báo cáo/phiếu nhập hàng.
//
// Test THUẦN Node — gọi thẳng 2 hàm thật (không qua HTTP/DB): recordActions.editOperationOrderDraft() và
// createValidation.validateAndPrepareCreate('operationOrders', ...).
//
// Chạy: node server/tests/test-operation-order-items-and-dates.js
'use strict';
const assert = require('assert');
const recordActions = require('../lib/recordActions');
const { validateAndPrepareCreate } = require('../lib/createValidation');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const CREATOR = { username: 'nv.tao', name: 'Người Tạo Đơn', dept: 'Siêu Thị Q1', perms: { operationOrderCreate: true } };

function draftOrder() {
  return {
    id: 1, code: 'DH-001', title: 'Đơn hàng cũ', supplier: 'NCC A', note: '',
    orderLocationType: 'STORE', dept: 'Siêu Thị Q1', creator: CREATOR.username,
    status: 'DRAFT', currentStep: 1, history: [],
    items: [{ name: 'Sữa tươi', unit: 'Thùng', qty: 10, unitPrice: 300000, amount: 3000000, note: '', productCode: 'SP001', barcode: '8935001234567', qtyReceived: 8 }],
    amount: 3000000
  };
}

// ===================== 1) editOperationOrderDraft(): giữ nguyên productCode/barcode/qtyReceived =========
test('LỖI ĐÃ VÁ: sửa lại đơn (Yêu Cầu Bổ Sung) có gửi kèm items -> giữ nguyên productCode/barcode/qtyReceived', () => {
  const item = draftOrder();
  const updated = recordActions.editOperationOrderDraft(CREATOR, item, {
    title: 'Đơn hàng sửa lại',
    items: [{ name: 'Sữa tươi', unit: 'Thùng', qty: 12, unitPrice: 300000, note: 'đổi số lượng', productCode: 'SP001', barcode: '8935001234567', qtyReceived: 8 }]
  });
  const it = updated.items[0];
  assert.strictEqual(it.productCode, 'SP001', 'productCode bị rơi mất sau khi sửa draft');
  assert.strictEqual(it.barcode, '8935001234567', 'barcode bị rơi mất sau khi sửa draft');
  assert.strictEqual(it.qtyReceived, 8, 'qtyReceived bị rơi mất sau khi sửa draft');
  assert.strictEqual(it.qty, 12, 'Số lượng mới vẫn phải được cập nhật');
  assert.strictEqual(updated.amount, 3600000, 'amount phải tính lại theo số lượng mới');
});

test('qtyReceived CHƯA nhập -> giữ null (khác "nhận 0 cái"), khớp đúng nhánh tạo mới', () => {
  const item = draftOrder();
  const updated = recordActions.editOperationOrderDraft(CREATOR, item, {
    items: [{ name: 'Sữa tươi', unit: 'Thùng', qty: 5, unitPrice: 300000, productCode: 'SP001', barcode: '' }]
  });
  assert.strictEqual(updated.items[0].qtyReceived, null);
  assert.strictEqual(updated.items[0].barcode, '');
});

test('Không gửi items -> danh sách hạng mục CŨ (kèm đủ 3 field) giữ nguyên 100% (hành vi cũ, không đổi)', () => {
  const item = draftOrder();
  const updated = recordActions.editOperationOrderDraft(CREATOR, item, { title: 'Chỉ đổi tiêu đề' });
  assert.strictEqual(updated.items[0].productCode, 'SP001');
  assert.strictEqual(updated.items[0].qtyReceived, 8);
  assert.strictEqual(updated.title, 'Chỉ đổi tiêu đề');
});

// ===================== 2) deliveryDate >= orderDate lúc TẠO đơn ==========================================
const APP_DATA = { formTemplates: [] };
function createOrder(over) {
  return validateAndPrepareCreate('operationOrders', Object.assign({
    title: 'Đơn hàng mới', orderLocationType: 'STORE',
    items: [{ name: 'Sữa tươi', qty: 1, unitPrice: 1000000 }]
  }, over), CREATOR, [], APP_DATA, []);
}

test('LỖI ĐÃ VÁ: Ngày Giao TRƯỚC Ngày Đặt -> bị chặn với thông báo rõ ràng', () => {
  assert.throws(
    () => createOrder({ orderDate: '2026-09-20T09:00', deliveryDate: '2026-09-18' }),
    (err) => err.status === 400 && /Ngày Giao không được trước Ngày Đặt/.test(err.message),
    'Phải ném CreateError 400 nêu rõ Ngày Giao/Ngày Đặt'
  );
});

test('Ngày Giao SAU Ngày Đặt -> tạo bình thường', () => {
  const rec = createOrder({ orderDate: '2026-09-20T09:00', deliveryDate: '2026-09-25' });
  assert.ok(rec.deliveryDate, 'deliveryDate phải được lưu lại');
});

test('Giao NGAY TRONG NGÀY đặt (Ngày Đặt có giờ, Ngày Giao chỉ có ngày) -> KHÔNG bị chặn oan', () => {
  const rec = createOrder({ orderDate: '2026-09-20T14:30', deliveryDate: '2026-09-20' });
  assert.ok(rec.deliveryDate);
});

test('Chỉ có 1 trong 2 ngày (hoặc không có ngày nào) -> giữ nguyên hành vi cũ, không chặn gì', () => {
  assert.ok(createOrder({ orderDate: '2026-09-20T09:00' }));
  assert.ok(createOrder({ deliveryDate: '2026-09-18' }));
  assert.ok(createOrder({}));
});

test('Ngày sai định dạng (không parse được) -> vẫn chỉ âm thầm bỏ qua như cũ, KHÔNG chặn cả đơn hàng', () => {
  const rec = createOrder({ orderDate: 'không-phải-ngày', deliveryDate: '2026-09-18' });
  assert.strictEqual(rec.orderDate, '');
});

console.log('');
console.log(`==== ${passed}/${passed + failed} scenario(s) passed${failed ? `, ${failed} FAILED` : ''} ====`);
if (failed > 0) process.exitCode = 1;
