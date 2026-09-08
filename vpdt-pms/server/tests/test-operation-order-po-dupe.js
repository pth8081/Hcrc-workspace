// tests/test-operation-order-po-dupe.js — Yêu cầu 3 (đợt "4 yêu cầu 1 khối"): Vận Hành > Đặt Hàng chặn
// trùng Số Đơn NCC (poNumber), TÁCH RIÊNG theo orderLocationType (STORE/HO). Gọi THẲNG
// validateAndPrepareCreate('operationOrders', ...) thật (lib/createValidation.js) — không chép lại luật.
'use strict';
const assert = require('assert');
const { validateAndPrepareCreate } = require('../lib/createValidation');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (err) { console.error(`  ❌ ${name}\n     ${err.message}`); fail++; }
}

const USER = { username: 'u1', name: 'Người Đặt Hàng', dept: 'Siêu Thị Hội An', perms: { admin: true, operationOrderCreate: true } };

function payload(overrides) {
  return Object.assign({
    title: 'Đặt hàng NCC A', orderLocationType: 'STORE', poNumber: 'PO-001',
    items: [{ name: 'Hàng A', qty: 1, unitPrice: 1000 }]
  }, overrides);
}

check('poNumber trùng CÙNG orderLocationType -> chặn 409', () => {
  const existing = [{ id: 1, orderLocationType: 'STORE', poNumber: 'PO-001', status: 'PENDING' }];
  assert.throws(() => validateAndPrepareCreate('operationOrders', payload(), USER, existing, {}, []),
    (err) => err.status === 409 && /Số đơn NCC/.test(err.message));
});

check('poNumber trùng nhưng KHÁC orderLocationType (1 STORE, 1 HO) -> KHÔNG chặn', () => {
  const existing = [{ id: 1, orderLocationType: 'HO', poNumber: 'PO-001', status: 'PENDING' }];
  const rec = validateAndPrepareCreate('operationOrders', payload({ orderLocationType: 'STORE' }), USER, existing, {}, []);
  assert.strictEqual(rec.poNumber, 'PO-001');
  assert.strictEqual(rec.orderLocationType, 'STORE');
});

check('poNumber trùng nhưng bản ghi cũ đã REJECTED -> KHÔNG chặn (trạng thái cuối "không tính")', () => {
  const existing = [{ id: 1, orderLocationType: 'STORE', poNumber: 'PO-001', status: 'REJECTED' }];
  const rec = validateAndPrepareCreate('operationOrders', payload(), USER, existing, {}, []);
  assert.strictEqual(rec.poNumber, 'PO-001');
});

check('poNumber trùng nhưng bản ghi cũ đã RECEIPT_CANCELLED -> KHÔNG chặn', () => {
  const existing = [{ id: 1, orderLocationType: 'STORE', poNumber: 'PO-001', status: 'RECEIPT_CANCELLED' }];
  const rec = validateAndPrepareCreate('operationOrders', payload(), USER, existing, {}, []);
  assert.strictEqual(rec.poNumber, 'PO-001');
});

check('poNumber rỗng -> không kiểm tra trùng gì cả (field tuỳ chọn)', () => {
  const existing = [{ id: 1, orderLocationType: 'STORE', poNumber: '', status: 'PENDING' }];
  const rec = validateAndPrepareCreate('operationOrders', payload({ poNumber: '' }), USER, existing, {}, []);
  assert.strictEqual(rec.poNumber, '');
});

check('poNumber trùng với bản ghi cùng orderLocationType nhưng đang AWAITING_RECEIPT (chưa kết thúc) -> vẫn chặn', () => {
  const existing = [{ id: 1, orderLocationType: 'STORE', poNumber: 'PO-001', status: 'AWAITING_RECEIPT' }];
  assert.throws(() => validateAndPrepareCreate('operationOrders', payload(), USER, existing, {}, []),
    (err) => err.status === 409);
});

console.log(`\n=== test-operation-order-po-dupe.js: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
