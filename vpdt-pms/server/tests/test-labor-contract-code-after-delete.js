// server/tests/test-labor-contract-code-after-delete.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): generateContractCode() (lib/laborContract.js) trước đây
// tính seq = SỐ LƯỢNG hợp đồng hiện có của nhân viên đó + 1 — nếu 1 hợp đồng GIỮA DÃY từng bị xoá (chỉ
// Admin xoá được, nhưng vẫn xảy ra), "số lượng còn lại" tụt xuống trong khi hậu tố lớn nhất từng dùng
// KHÔNG đổi, khiến hợp đồng mới sinh ra TRÙNG mã 1 hợp đồng còn tồn tại (VD nhân viên có
// HDLD-NV001-1/2/3, xoá #2 -> length=2 -> seq mới=3, trùng thẳng HDLD-NV001-3 đang có).
//
// generateContractCode() THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-labor-contract-code-after-delete.js
'use strict';
const assert = require('assert');
const { generateContractCode } = require('../lib/laborContract');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

test('Nhân viên chưa có hợp đồng nào -> sinh đúng mã đầu tiên', () => {
  assert.strictEqual(generateContractCode([], 'NV001'), 'HDLD-NV001-1');
});

test('Nhân viên đã có 2 hợp đồng liên tiếp -> sinh đúng mã thứ 3', () => {
  const list = [{ employeeCode: 'NV001', code: 'HDLD-NV001-1' }, { employeeCode: 'NV001', code: 'HDLD-NV001-2' }];
  assert.strictEqual(generateContractCode(list, 'NV001'), 'HDLD-NV001-3');
});

test('LỖI ĐÃ VÁ: hợp đồng #2 GIỮA DÃY đã bị xoá (chỉ còn #1 và #3) -> mã mới phải là #4, KHÔNG trùng #3', () => {
  const list = [{ employeeCode: 'NV001', code: 'HDLD-NV001-1' }, { employeeCode: 'NV001', code: 'HDLD-NV001-3' }];
  const newCode = generateContractCode(list, 'NV001');
  assert.strictEqual(newCode, 'HDLD-NV001-4');
  assert.ok(!list.some(c => c.code === newCode), 'Mã mới không được trùng bất kỳ mã nào đang có');
});

test('LỖI ĐÃ VÁ: hợp đồng ĐẦU DÃY bị xoá (chỉ còn #2 và #3) -> mã mới phải là #4, không tụt về #3 trùng lặp', () => {
  const list = [{ employeeCode: 'NV001', code: 'HDLD-NV001-2' }, { employeeCode: 'NV001', code: 'HDLD-NV001-3' }];
  const newCode = generateContractCode(list, 'NV001');
  assert.strictEqual(newCode, 'HDLD-NV001-4');
});

test('Nhiều nhân viên khác nhau — chỉ tính đúng theo employeeCode của mình, không lẫn nhau', () => {
  const list = [
    { employeeCode: 'NV001', code: 'HDLD-NV001-1' }, { employeeCode: 'NV001', code: 'HDLD-NV001-2' },
    { employeeCode: 'NV002', code: 'HDLD-NV002-1' }
  ];
  assert.strictEqual(generateContractCode(list, 'NV002'), 'HDLD-NV002-2');
});

test('Dữ liệu cũ có mã không theo đúng khuôn (code null/lạ) -> vẫn không làm hỏng phép tính, seq vẫn đúng', () => {
  const list = [{ employeeCode: 'NV001', code: null }, { employeeCode: 'NV001', code: 'HDLD-NV001-1' }];
  assert.strictEqual(generateContractCode(list, 'NV001'), 'HDLD-NV001-2');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
