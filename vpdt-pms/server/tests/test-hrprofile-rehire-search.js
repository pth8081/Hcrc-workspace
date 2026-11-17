'use strict';

// tests/test-hrprofile-rehire-search.js
//
// LOI DA VA (11/2026, bao cao nguoi dung: "onboarding tai tuyen dang ko tim thay nhan su cu bang cccd va
// ngay sinh, toi da thu cccd cua 1 nhan su nhung ko ra") - searchInactiveProfilesForRehire()
// (lib/employeeProfile.js) truoc day so khop CCCD/CMND CHAT TUYET DOI (p.nationalId !== nid), chi trim
// phia query-param, KHONG chuan hoa phia gia tri da luu. Ho so cu tao TRUOC thoi diem applyProfileEdit()
// bat buoc dung 12 so (quy tac them tu 11/2026) co the van dang luu kem khoang trang/gach ngang/cham (VD
// dan tu file scan "001 234 567 890") - so khop chat se KHONG BAO GIO khop voi CCCD go lai dung 12 so
// lien nhau khi tim Tai Tuyen.
//
// FIX: them normalizeNationalIdForMatch() (bo khoang trang/gach ngang/cham o CA 2 phia truoc khi so
// sanh) - khong dung cham so (khong bo so 0 dau).
//
// File nay test THUAN (khong can SQL Server) - goi thang lib/employeeProfile.js.
// Chay: node server/tests/test-hrprofile-rehire-search.js
const assert = require('assert');
const employeeProfile = require('../lib/employeeProfile');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`FAIL: ${name}\n  -> ${err.message}`);
    failed++;
  }
}

function makeList() {
  return [
    { employeeCode: 'NV001', nationalId: '001 234 567 890', dateOfBirth: '1990-05-01', status: 'INACTIVE', fullName: 'Nguyễn Văn A' },
    { employeeCode: 'NV002', nationalId: '079200012345', dateOfBirth: '1992-03-10', status: 'ACTIVE', fullName: 'Trần Thị B' },
    { employeeCode: 'NV003', nationalId: '012-345-678-901', dateOfBirth: '1988-07-20', status: 'INACTIVE', fullName: 'Lê Văn C' }
  ];
}

test('CCCD gõ lại đúng 12 số liền nhau, hồ sơ cũ lưu kèm khoảng trắng -> tìm thấy (đúng bug user báo)', () => {
  const result = employeeProfile.searchInactiveProfilesForRehire(makeList(), '001234567890', '');
  assert.strictEqual(result.length, 1, `phải tìm thấy đúng 1 kết quả: ${JSON.stringify(result)}`);
  assert.strictEqual(result[0].employeeCode, 'NV001');
});

test('CCCD gõ lại đúng 12 số liền nhau, hồ sơ cũ lưu kèm gạch ngang -> tìm thấy', () => {
  const result = employeeProfile.searchInactiveProfilesForRehire(makeList(), '012345678901', '');
  assert.strictEqual(result.length, 1, `phải tìm thấy đúng 1 kết quả: ${JSON.stringify(result)}`);
  assert.strictEqual(result[0].employeeCode, 'NV003');
});

test('CCCD + ngày sinh đều khớp (chỉ khác định dạng CCCD) -> tìm thấy', () => {
  const result = employeeProfile.searchInactiveProfilesForRehire(makeList(), '001 234 567 890', '1990-05-01');
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].employeeCode, 'NV001');
});

test('CCCD khớp nhưng ngày sinh KHÁC -> không tìm thấy', () => {
  const result = employeeProfile.searchInactiveProfilesForRehire(makeList(), '001234567890', '1999-01-01');
  assert.strictEqual(result.length, 0);
});

test('hồ sơ ACTIVE trùng CCCD -> KHÔNG trả về (chỉ tìm trong INACTIVE)', () => {
  const result = employeeProfile.searchInactiveProfilesForRehire(makeList(), '079200012345', '');
  assert.strictEqual(result.length, 0);
});

test('CCCD không khớp bất kỳ ai (số thật sự khác) -> không tìm thấy', () => {
  const result = employeeProfile.searchInactiveProfilesForRehire(makeList(), '999999999999', '');
  assert.strictEqual(result.length, 0);
});

test('không truyền CCCD lẫn ngày sinh -> trả về rỗng (không liệt kê toàn bộ INACTIVE)', () => {
  const result = employeeProfile.searchInactiveProfilesForRehire(makeList(), '', '');
  assert.strictEqual(result.length, 0);
});

console.log(`\n${passed}/${passed + failed} scenario(s) passed.`);
if (failed) process.exitCode = 1;
