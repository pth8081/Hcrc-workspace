// server/tests/test-vendorrebate-tier-ratepct-null.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): validateTiers() (lib/vendorRebate.js) trước đây ép kiểu
// Number(t?.ratePct) TRỰC TIẾP — Number(null)/Number(undefined) trả về 0 (hữu hạn, hợp lệ trong khoảng
// 0-100) nên bậc thang thiếu ratePct (VD client gửi null do JSON.stringify(NaN)=>null khi gõ sai định
// dạng thập phân kiểu Việt "12,5") vẫn ÂM THẦM được chấp nhận là 0% thay vì báo lỗi. Nay chặn rõ
// null/undefined/'' TRƯỚC khi ép kiểu số, không lẫn với việc cố ý nhập 0%. Client (module-muahang.js,
// submitMhTermForm) cũng đã chuẩn hoá dấu phẩy->chấm + tự chặn NaN trước khi gửi — bài test này xác nhận
// lớp chặn phía SERVER (không phụ thuộc client, validateTiers() là hàm THUẦN, gọi thẳng không cần mock gì).
//
// Chạy: node server/tests/test-vendorrebate-tier-ratepct-null.js
'use strict';
const assert = require('assert');
const { validateTiers } = require('../lib/vendorRebate');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

test('Bậc thang hợp lệ (fromAmount + ratePct số bình thường) -> không lỗi', () => {
  assert.strictEqual(validateTiers([{ fromAmount: 0, ratePct: 5 }, { fromAmount: 100000000, ratePct: 8 }]), null);
});

test('Cố ý nhập ratePct = 0 (hợp lệ thật sự, VD bậc chưa đạt ngưỡng) -> KHÔNG bị chặn nhầm', () => {
  assert.strictEqual(validateTiers([{ fromAmount: 0, ratePct: 0 }]), null);
});

test('LỖI ĐÃ VÁ: ratePct = null (mô phỏng JSON.stringify(NaN)) -> báo lỗi rõ ràng, KHÔNG âm thầm coi là 0%', () => {
  const err = validateTiers([{ fromAmount: 0, ratePct: null }]);
  assert.ok(err && err.includes('Vui lòng nhập Tỷ lệ'), `Phải báo lỗi rõ ràng — thực tế: ${err}`);
});

test('LỖI ĐÃ VÁ: ratePct = undefined (thiếu hẳn field) -> báo lỗi rõ ràng', () => {
  const err = validateTiers([{ fromAmount: 0 }]);
  assert.ok(err && err.includes('Vui lòng nhập Tỷ lệ'), `Phải báo lỗi rõ ràng — thực tế: ${err}`);
});

test('LỖI ĐÃ VÁ: ratePct = "" (chuỗi rỗng) -> báo lỗi rõ ràng', () => {
  const err = validateTiers([{ fromAmount: 0, ratePct: '' }]);
  assert.ok(err && err.includes('Vui lòng nhập Tỷ lệ'), `Phải báo lỗi rõ ràng — thực tế: ${err}`);
});

test('ratePct dạng chuỗi số hợp lệ (VD sau khi client chuẩn hoá "12.5") -> vẫn qua được (Number ép đúng)', () => {
  assert.strictEqual(validateTiers([{ fromAmount: 0, ratePct: '12.5' }]), null);
});

test('ratePct ngoài khoảng 0-100 -> vẫn bị chặn như cũ (không phá logic gốc)', () => {
  const err = validateTiers([{ fromAmount: 0, ratePct: 150 }]);
  assert.ok(err && err.includes('0-100'), `thực tế: ${err}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
