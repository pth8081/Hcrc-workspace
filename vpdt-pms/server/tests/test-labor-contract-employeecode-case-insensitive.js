// server/tests/test-labor-contract-employeecode-case-insensitive.js
//
// Regression test cho Thấp#7 (đợt rà soát chuyên sâu v25.1→v25.70): so khớp Mã Nhân Viên trong luồng
// Nhập Excel HĐLĐ (cả "Nhập Excel hàng loạt" lẫn "Nhập Excel TẠO MỚI hàng loạt") TRƯỚC ĐÂY dùng `===`
// (case-sensitive) — employeeCode mặc định tự sinh in hoa nhưng HR vẫn gõ tay được 1 mã khác
// (createManualProfile(), xem lib/employeeProfile.js), nên "nv9001" gõ trong file Excel không khớp
// được hồ sơ đã lưu "NV9001", báo nhầm "không có trong Hồ Sơ Nhân Sự". Đã vá tại
// lib/employeeProfile.js::findProfile() + lib/laborContract.js::findActiveContractByEmployeeCode()/
// findContractsByEmployeeCode() (so khớp không phân biệt hoa/thường, KHÔNG đổi giá trị gốc đã lưu).
'use strict';

const assert = require('assert');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

function main() {
  const employeeProfile = require('../lib/employeeProfile');
  const laborContract = require('../lib/laborContract');

  test('findProfile(): "nv9001" (gõ thường) vẫn khớp đúng hồ sơ lưu "NV9001" (gõ hoa)', () => {
    const list = [{ employeeCode: 'NV9001', username: 'u1' }];
    const found = employeeProfile.findProfile(list, 'nv9001');
    assert.ok(found, 'phải tìm thấy');
    assert.strictEqual(found.employeeCode, 'NV9001', 'KHÔNG được đổi giá trị employeeCode gốc đã lưu');
  });

  test('findProfile(): khớp CHÍNH XÁC hoa/thường vẫn hoạt động như cũ (không phải regression)', () => {
    const list = [{ employeeCode: 'NV9001' }];
    assert.ok(employeeProfile.findProfile(list, 'NV9001'));
  });

  test('findProfile(): mã rỗng/null -> null, không throw', () => {
    const list = [{ employeeCode: 'NV9001' }];
    assert.strictEqual(employeeProfile.findProfile(list, ''), null);
    assert.strictEqual(employeeProfile.findProfile(list, null), null);
    assert.strictEqual(employeeProfile.findProfile(list, undefined), null);
  });

  test('findProfile(): không khớp mã nào -> null', () => {
    const list = [{ employeeCode: 'NV9001' }];
    assert.strictEqual(employeeProfile.findProfile(list, 'NV9999'), null);
  });

  test('findActiveContractByEmployeeCode(): "nv9001" vẫn tìm đúng hợp đồng ACTIVE lưu "NV9001"', () => {
    const list = [
      { id: 1, employeeCode: 'NV9001', status: 'ACTIVE' },
      { id: 2, employeeCode: 'NV9002', status: 'ACTIVE' }
    ];
    const found = laborContract.findActiveContractByEmployeeCode(list, 'nv9001');
    assert.ok(found);
    assert.strictEqual(found.id, 1);
  });

  test('findContractsByEmployeeCode(): gộp đúng mọi hợp đồng của 1 nhân viên bất kể hoa/thường khi gõ tra cứu', () => {
    const list = [
      { id: 1, employeeCode: 'NV9001', status: 'TERMINATED' },
      { id: 2, employeeCode: 'NV9001', status: 'ACTIVE' },
      { id: 3, employeeCode: 'NV9002', status: 'ACTIVE' }
    ];
    const found = laborContract.findContractsByEmployeeCode(list, 'Nv9001');
    assert.strictEqual(found.length, 2);
  });

  test('findActiveContractByEmployeeCode(): mã rỗng -> null, không throw', () => {
    assert.strictEqual(laborContract.findActiveContractByEmployeeCode([{ employeeCode: 'NV9001', status: 'ACTIVE' }], ''), null);
  });
}

main();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
