// server/tests/test-orgchart-delete-draft-version.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): trước đây KHÔNG có cách nào xoá hẳn 1 bản nháp (DRAFT)
// Cơ Cấu Tổ Chức không dùng nữa (tạo thử/nhân bản nhầm) — chỉ có thể bỏ mặc nó nằm lại vĩnh viễn trong
// danh sách phiên bản. Nay thêm deleteVersion() — CHỈ xoá được DRAFT, APPLIED/ARCHIVED phải giữ lại
// làm lịch sử (managerUsername/kpiFlow đã từng tính theo đó).
//
// deleteVersion() THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-orgchart-delete-draft-version.js
'use strict';
const assert = require('assert');
const { deleteVersion } = require('../lib/orgChart');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

function makeList() {
  return [
    { id: 1, versionName: 'Bản gốc', status: 'ARCHIVED', nodes: [], kpiFlow: [] },
    { id: 2, versionName: 'Đang áp dụng', status: 'APPLIED', nodes: [], kpiFlow: [] },
    { id: 3, versionName: 'Nháp thử tạo nhầm', status: 'DRAFT', nodes: [], kpiFlow: [] }
  ];
}

test('LỖI ĐÃ VÁ: xoá bản DRAFT -> thành công, bị loại khỏi danh sách', () => {
  const list = makeList();
  const result = deleteVersion(list, 3);
  assert.strictEqual(result.length, 2);
  assert.ok(!result.some(v => v.id === 3));
});

test('Xoá bản APPLIED -> 400, không được xoá (phải giữ lịch sử)', () => {
  const list = makeList();
  assert.throws(() => deleteVersion(list, 2), /400|Chỉ xoá được bản nháp/);
});

test('Xoá bản ARCHIVED -> 400, không được xoá (phải giữ lịch sử)', () => {
  const list = makeList();
  assert.throws(() => deleteVersion(list, 1), /400|Chỉ xoá được bản nháp/);
});

test('Xoá version không tồn tại -> 404', () => {
  const list = makeList();
  assert.throws(() => deleteVersion(list, 999), /404|Không tìm thấy/);
});

test('Danh sách các version còn lại giữ nguyên (không bị đụng gì khác ngoài phần tử bị xoá)', () => {
  const list = makeList();
  const result = deleteVersion(list, 3);
  assert.strictEqual(result.find(v => v.id === 1).status, 'ARCHIVED');
  assert.strictEqual(result.find(v => v.id === 2).status, 'APPLIED');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
