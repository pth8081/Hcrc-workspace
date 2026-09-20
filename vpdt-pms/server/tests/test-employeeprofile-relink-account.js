// server/tests/test-employeeprofile-relink-account.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 4, 9/2026): linkAccount() (lib/employeeProfile.js) hard-chặn khi
// profile.username ĐÃ có giá trị — không có đường nào đổi lại khi 1 nhân viên tái tuyển
// (reactivateForRehire()) với 1 tài khoản VPDT MỚI (tài khoản cũ đã khoá/xoá khi nghỉ việc). Nay thêm
// relinkAccount() cho phép HR đổi tài khoản liên kết của hồ sơ ĐÃ có username sẵn, lưu lại lịch sử đổi.
//
// relinkAccount() THUẦN (không đụng DB/network) — gọi thẳng.
//
// Chạy: node server/tests/test-employeeprofile-relink-account.js
'use strict';
const assert = require('assert');
const { linkAccount, relinkAccount } = require('../lib/employeeProfile');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

function makeList() {
  return [
    { employeeCode: 'NV001', username: 'nv001_cu', status: 'ACTIVE' },
    { employeeCode: 'NV002', username: null, status: 'ACTIVE' },
    { employeeCode: 'NV003', username: 'nv003_dang_dung', status: 'ACTIVE' }
  ];
}

test('LỖI ĐÃ VÁ: hồ sơ ĐÃ có username -> đổi sang tài khoản mới thành công', () => {
  const list = makeList();
  const updated = relinkAccount(list, 'NV001', 'nv001_moi', 'hr1', 'Nhân Sự 1');
  assert.strictEqual(updated.username, 'nv001_moi');
  assert.strictEqual(updated.accountRelinkHistory.length, 1);
  assert.strictEqual(updated.accountRelinkHistory[0].oldUsername, 'nv001_cu');
  assert.strictEqual(updated.accountRelinkHistory[0].newUsername, 'nv001_moi');
});

test('Hồ sơ CHƯA có username nào -> phải dùng linkAccount(), relinkAccount() từ chối', () => {
  const list = makeList();
  assert.throws(() => relinkAccount(list, 'NV002', 'nv002_moi', 'hr1', 'Nhân Sự 1'), /400|chưa liên kết tài khoản nào/);
});

test('Đổi sang ĐÚNG tài khoản đang liên kết (không đổi gì) -> 400', () => {
  const list = makeList();
  assert.throws(() => relinkAccount(list, 'NV001', 'nv001_cu', 'hr1', 'Nhân Sự 1'), /400|phải khác tài khoản đang liên kết/);
});

test('Đổi sang tài khoản ĐÃ liên kết với hồ sơ KHÁC -> 400', () => {
  const list = makeList();
  assert.throws(() => relinkAccount(list, 'NV001', 'nv003_dang_dung', 'hr1', 'Nhân Sự 1'), /400|đã được liên kết/);
});

test('Hồ sơ không tồn tại -> 404', () => {
  const list = makeList();
  assert.throws(() => relinkAccount(list, 'NV999', 'bat_ky', 'hr1', 'Nhân Sự 1'), /404|Không tìm thấy/);
});

test('linkAccount() (hành vi cũ) vẫn không đổi được hồ sơ đã có username — không bị ảnh hưởng bởi relinkAccount() mới', () => {
  const list = makeList();
  assert.throws(() => linkAccount(list, 'NV001', 'nv001_moi', 'hr1'), /400|đã liên kết tài khoản/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
