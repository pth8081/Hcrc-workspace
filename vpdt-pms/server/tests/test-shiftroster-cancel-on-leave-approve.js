// server/tests/test-shiftroster-cancel-on-leave-approve.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): duyệt đơn nghỉ phép SHIFT_BASED trước đây CHỈ lưu lại
// affectedRosterIds (danh sách dòng phân ca trùng khoảng nghỉ) để THAM KHẢO — các dòng phân ca đó vẫn
// đứng nguyên "SCHEDULED" như chưa từng có đơn nghỉ nào được duyệt, quản lý ca dễ tưởng nhân viên vẫn
// phải đi làm. Nay cancelRosterForApprovedLeave() tự huỷ (CANCELLED) đúng các dòng trùng khoảng nghỉ.
//
// cancelRosterForApprovedLeave() THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-shiftroster-cancel-on-leave-approve.js
'use strict';
const assert = require('assert');
const { cancelRosterForApprovedLeave } = require('../lib/attendance');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

function makeRoster(overrides) {
  return Object.assign({ id: 1, employeeCode: 'NV001', workDate: '2026-09-20', status: 'SCHEDULED' }, overrides);
}

test('LỖI ĐÃ VÁ: dòng phân ca trùng khoảng nghỉ đã duyệt -> tự chuyển CANCELLED', () => {
  const rosterList = [makeRoster({ id: 1, workDate: '2026-09-20' })];
  const result = cancelRosterForApprovedLeave(rosterList, 'NV001', '2026-09-19', '2026-09-21', 'PP-001');
  assert.strictEqual(result[0].status, 'CANCELLED');
  assert.ok(result[0].note.includes('PP-001'), 'Ghi chú phải nêu rõ mã đơn nghỉ phép liên quan');
});

test('Dòng phân ca KHÔNG trùng khoảng nghỉ (ngày khác) -> giữ nguyên SCHEDULED', () => {
  const rosterList = [makeRoster({ id: 2, workDate: '2026-09-25' })];
  const result = cancelRosterForApprovedLeave(rosterList, 'NV001', '2026-09-19', '2026-09-21', 'PP-001');
  assert.strictEqual(result[0].status, 'SCHEDULED');
});

test('Dòng phân ca của NHÂN VIÊN KHÁC -> không bị đụng vào dù trùng ngày', () => {
  const rosterList = [makeRoster({ id: 3, employeeCode: 'NV002', workDate: '2026-09-20' })];
  const result = cancelRosterForApprovedLeave(rosterList, 'NV001', '2026-09-19', '2026-09-21', 'PP-001');
  assert.strictEqual(result[0].status, 'SCHEDULED');
});

test('Dòng ĐÃ CANCELLED từ trước -> giữ nguyên, không ghi đè note (idempotent)', () => {
  const rosterList = [makeRoster({ id: 4, workDate: '2026-09-20', status: 'CANCELLED', note: 'Lý do khác' })];
  const result = cancelRosterForApprovedLeave(rosterList, 'NV001', '2026-09-19', '2026-09-21', 'PP-001');
  assert.strictEqual(result[0].note, 'Lý do khác', 'Không được ghi đè dòng đã huỷ từ trước');
});

test('Nghỉ nhiều ngày trùng nhiều dòng phân ca -> huỷ ĐÚNG hết tất cả các dòng trùng, không sót', () => {
  const rosterList = [
    makeRoster({ id: 5, workDate: '2026-09-19' }),
    makeRoster({ id: 6, workDate: '2026-09-20' }),
    makeRoster({ id: 7, workDate: '2026-09-21' }),
    makeRoster({ id: 8, workDate: '2026-09-22' })
  ];
  const result = cancelRosterForApprovedLeave(rosterList, 'NV001', '2026-09-19', '2026-09-21', 'PP-002');
  assert.strictEqual(result.filter(r => r.status === 'CANCELLED').length, 3, '3 dòng trong khoảng 19-21/9 phải bị huỷ');
  assert.strictEqual(result.find(r => r.id === 8).status, 'SCHEDULED', 'Dòng 22/9 (ngoài khoảng) phải giữ nguyên');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
