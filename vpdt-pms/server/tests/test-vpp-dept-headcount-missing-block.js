// server/tests/test-vpp-dept-headcount-missing-block.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): resolveVppDeptBudget()/submitVppRegistration()
// (lib/vppCatalog.js + lib/recordActions.js) trước đây coi totalBudget=0 (rate × headcount) LÀ "không
// giới hạn" (chủ đích, khi admin để trống mức/người) — nhưng totalBudget CŨNG bị tính ra 0 khi admin
// ĐÃ cấu hình mức/người > 0 cho phòng ban đó (deptBudgetRates hoặc perPersonBudget mặc định) mà quên
// nhập số nhân sự (deptHeadcounts thiếu/= 0 cho phòng đó) — khiến phòng ban này đăng ký KHÔNG GIỚI HẠN
// dù admin rõ ràng muốn chặn theo ngân sách, ngược hẳn ý định cấu hình.
//
// resolveVppDeptBudget()/submitVppRegistration() đều THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-vpp-dept-headcount-missing-block.js
'use strict';
const assert = require('assert');
const { resolveVppDeptBudget } = require('../lib/vppCatalog');
const { submitVppRegistration } = require('../lib/recordActions');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const CREATOR = { username: 'nv1', name: 'Nhân Viên 1' };

function makeItem(overrides) {
  return Object.assign({
    id: 1, creator: 'nv1', status: 'DRAFT', dept: 'Phòng Kinh Doanh',
    items: [{ name: 'Bút bi', price: 5000, qty: 10 }] // 50.000đ
  }, overrides);
}
function makePeriod(overrides) {
  return Object.assign({ id: 10, status: 'OPEN', endDate: '', perPersonBudget: null, deptHeadcounts: {}, deptBudgetRates: {} }, overrides);
}

test('resolveVppDeptBudget: rate=0/null thật sự (không cấu hình gì) -> rateConfiguredButNoHeadcount=false (đúng ý "không giới hạn")', () => {
  const r = resolveVppDeptBudget(makePeriod(), 'Phòng Kinh Doanh');
  assert.strictEqual(r.totalBudget, 0);
  assert.strictEqual(r.rateConfiguredButNoHeadcount, false);
});

test('LỖI ĐÃ VÁ: perPersonBudget mặc định > 0 nhưng phòng này KHÔNG có trong deptHeadcounts -> rateConfiguredButNoHeadcount=true', () => {
  const r = resolveVppDeptBudget(makePeriod({ perPersonBudget: 100000, deptHeadcounts: { 'Phòng Khác': 5 } }), 'Phòng Kinh Doanh');
  assert.strictEqual(r.totalBudget, 0);
  assert.strictEqual(r.rateConfiguredButNoHeadcount, true);
});

test('LỖI ĐÃ VÁ: deptBudgetRates riêng > 0 cho phòng này nhưng headcount=0 -> rateConfiguredButNoHeadcount=true', () => {
  const r = resolveVppDeptBudget(makePeriod({ deptBudgetRates: { 'Phòng Kinh Doanh': 150000 }, deptHeadcounts: {} }), 'Phòng Kinh Doanh');
  assert.strictEqual(r.rateConfiguredButNoHeadcount, true);
});

test('Có rate VÀ headcount đầy đủ -> rateConfiguredButNoHeadcount=false, totalBudget tính đúng', () => {
  const r = resolveVppDeptBudget(makePeriod({ perPersonBudget: 100000, deptHeadcounts: { 'Phòng Kinh Doanh': 5 } }), 'Phòng Kinh Doanh');
  assert.strictEqual(r.totalBudget, 500000);
  assert.strictEqual(r.rateConfiguredButNoHeadcount, false);
});

test('LỖI ĐÃ VÁ: submitVppRegistration() phải CHẶN (409) khi rate>0 nhưng thiếu headcount, KHÔNG cho qua như "không giới hạn"', () => {
  const period = makePeriod({ perPersonBudget: 100000, deptHeadcounts: {} });
  assert.throws(
    () => submitVppRegistration(CREATOR, makeItem(), period, []),
    /409|chưa cấu hình số nhân sự/
  );
});

test('rate=0 thật (không cấu hình gì) -> submitVppRegistration() vẫn cho qua không giới hạn như cũ (không đổi hành vi cũ)', () => {
  const period = makePeriod();
  const result = submitVppRegistration(CREATOR, makeItem(), period, []);
  assert.strictEqual(result.status, 'PENDING');
});

test('Có rate + headcount đầy đủ, vượt ngân sách -> vẫn 400 chặn ngân sách như cũ (không đổi hành vi cũ)', () => {
  const period = makePeriod({ perPersonBudget: 10000, deptHeadcounts: { 'Phòng Kinh Doanh': 1 } }); // budget=10.000đ
  assert.throws(
    () => submitVppRegistration(CREATOR, makeItem(), period, []), // đăng ký 50.000đ
    /400|không đủ/
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
