// server/tests/test-payroll-period-delete.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): trước đây KHÔNG có cách nào xoá 1 kỳ lương tạo nhầm
// (sai tháng/năm/tên) — chỉ có thể bỏ mặc nó nằm lại vĩnh viễn trong danh sách kỳ. Nay
// assertCanDeletePeriod() (lib/payroll.js) cho phép route POST /api/payroll/periods/:id/delete xoá,
// CHỈ khi kỳ còn DRAFT VÀ chưa từng tính lương (employeeCount===0) — kỳ đã tính hoặc đã qua bất kỳ bước
// duyệt/chốt/công bố nào phải giữ lại làm lịch sử.
//
// assertCanDeletePeriod() THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-payroll-period-delete.js
'use strict';
const assert = require('assert');
const { assertCanDeletePeriod } = require('../lib/payroll');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

function makePeriod(overrides) {
  return Object.assign({ id: 1, periodName: 'Lương T9/2026', status: 'DRAFT', employeeCount: 0 }, overrides);
}

test('LỖI ĐÃ VÁ: kỳ còn DRAFT và CHƯA từng tính lương -> xoá được (không throw)', () => {
  assert.doesNotThrow(() => assertCanDeletePeriod(makePeriod()));
});

test('Kỳ DRAFT nhưng ĐÃ từng tính lương (employeeCount>0) -> 409, phải giữ lại', () => {
  assert.throws(() => assertCanDeletePeriod(makePeriod({ employeeCount: 5 })), /409|Chỉ xoá được kỳ lương còn Nháp/);
});

test('Kỳ đã qua bước PENDING_APPROVAL -> chặn, phải giữ lại', () => {
  assert.throws(() => assertCanDeletePeriod(makePeriod({ status: 'PENDING_APPROVAL' })), /Chỉ xoá được kỳ lương còn Nháp/);
});

test('Kỳ đã APPROVED/FINALIZED/PUBLISHED -> chặn, không xoá được dù employeeCount vẫn 0 (dữ liệu bất thường)', () => {
  assert.throws(() => assertCanDeletePeriod(makePeriod({ status: 'PUBLISHED' })), /Chỉ xoá được kỳ lương còn Nháp/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
