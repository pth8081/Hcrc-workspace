// server/tests/test-orgchart-edit-applied-reapply.js
//
// TÍNH NĂNG MỚI (11/2026, theo yêu cầu người dùng — "trong kỳ chỉ cần sửa lại định biên, không phải
// chuyển qua kỳ mới"): applyVersionInPlace() nhận thêm options.keepEffectiveDate — cho phép áp dụng lại
// 1 bản nháp (được tạo bằng cách Sao Chép/"Sửa Bản Đang Áp Dụng" từ ĐÚNG bản APPLIED hiện tại) mà VẪN
// GIỮ NGUYÊN "Áp dụng từ" của kỳ hiện tại, thay vì luôn đóng dấu ngày hôm nay như trước đây. Điều kiện an
// toàn: version.clonedFromVersionId PHẢI khớp đúng id bản APPLIED hiện tại — nếu dữ liệu đã đổi khác (có
// người khác vừa áp dụng 1 bản khác chen giữa) thì từ chối, không coi là "sửa trong kỳ" nữa.
//
// applyVersionInPlace() THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-orgchart-edit-applied-reapply.js
'use strict';
const assert = require('assert');
const { applyVersionInPlace } = require('../lib/orgChart');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

function makeList() {
  return [
    { id: 1, versionName: 'Định biên 2026', status: 'APPLIED', nodes: [], kpiFlow: [], effectiveDate: '2026-01-01', clonedFromVersionId: null },
    { id: 2, versionName: 'Chỉnh sửa – Định biên 2026', status: 'DRAFT', nodes: [], kpiFlow: [], effectiveDate: null, clonedFromVersionId: 1 },
    { id: 3, versionName: 'Nháp KHÔNG liên quan bản đang áp dụng', status: 'DRAFT', nodes: [], kpiFlow: [], effectiveDate: null, clonedFromVersionId: null },
    { id: 4, versionName: 'Nháp clone từ 1 bản cũ hơn (không phải bản APPLIED hiện tại)', status: 'DRAFT', nodes: [], kpiFlow: [], effectiveDate: null, clonedFromVersionId: 99 }
  ];
}

test('REGRESSION: không truyền options (hành vi cũ) -> luôn đóng dấu ngày hôm nay, không giữ effectiveDate cũ', () => {
  const list = makeList();
  const today = new Date().toISOString().slice(0, 10);
  const result = applyVersionInPlace(list, 2, [], 'admin', []);
  assert.strictEqual(result.effectiveDate, today);
  assert.notStrictEqual(result.effectiveDate, '2026-01-01');
  assert.strictEqual(list.find(v => v.id === 1).status, 'ARCHIVED');
  assert.strictEqual(result.status, 'APPLIED');
});

test('REGRESSION: keepEffectiveDate=false (tường minh) -> giống hành vi cũ, đóng dấu ngày hôm nay', () => {
  const list = makeList();
  const today = new Date().toISOString().slice(0, 10);
  const result = applyVersionInPlace(list, 2, [], 'admin', [], { keepEffectiveDate: false });
  assert.strictEqual(result.effectiveDate, today);
});

test('TÍNH NĂNG MỚI: keepEffectiveDate=true + clonedFromVersionId khớp đúng bản APPLIED -> giữ nguyên effectiveDate cũ', () => {
  const list = makeList();
  const result = applyVersionInPlace(list, 2, [], 'admin', [], { keepEffectiveDate: true });
  assert.strictEqual(result.effectiveDate, '2026-01-01');
  assert.strictEqual(result.status, 'APPLIED');
  assert.strictEqual(list.find(v => v.id === 1).status, 'ARCHIVED');
});

test('TÍNH NĂNG MỚI: keepEffectiveDate=true nhưng bản nháp KHÔNG clone từ bản APPLIED hiện tại -> 400, từ chối', () => {
  const list = makeList();
  assert.throws(() => applyVersionInPlace(list, 3, [], 'admin', [], { keepEffectiveDate: true }), /400|Không thể giữ nguyên/);
});

test('TÍNH NĂNG MỚI: keepEffectiveDate=true nhưng clonedFromVersionId trỏ về 1 bản KHÁC (không phải APPLIED hiện tại) -> 400, từ chối', () => {
  const list = makeList();
  assert.throws(() => applyVersionInPlace(list, 4, [], 'admin', [], { keepEffectiveDate: true }), /400|Không thể giữ nguyên/);
});

test('TÍNH NĂNG MỚI: race condition — bản APPLIED đổi khác (effectiveDate rỗng) sau khi nháp được tạo -> 400, từ chối an toàn', () => {
  const list = makeList();
  list.find(v => v.id === 1).effectiveDate = null; // mô phỏng dữ liệu đã đổi khác, mất mốc ngày gốc
  assert.throws(() => applyVersionInPlace(list, 2, [], 'admin', [], { keepEffectiveDate: true }), /400|Không thể giữ nguyên/);
});

test('TÍNH NĂNG MỚI: không có bản APPLIED nào (áp dụng lần đầu) + keepEffectiveDate=true -> 400, từ chối (không có gì để giữ nguyên)', () => {
  const list = [
    { id: 5, versionName: 'Nháp đầu tiên', status: 'DRAFT', nodes: [], kpiFlow: [], effectiveDate: null, clonedFromVersionId: null }
  ];
  assert.throws(() => applyVersionInPlace(list, 5, [], 'admin', [], { keepEffectiveDate: true }), /400|Không thể giữ nguyên/);
});

test('appliedBy/appliedAt vẫn được gán đúng khi dùng keepEffectiveDate=true (không bị bỏ sót)', () => {
  const list = makeList();
  const result = applyVersionInPlace(list, 2, [], 'hr_user', [], { keepEffectiveDate: true });
  assert.strictEqual(result.appliedBy, 'hr_user');
  assert.ok(result.appliedAt);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
