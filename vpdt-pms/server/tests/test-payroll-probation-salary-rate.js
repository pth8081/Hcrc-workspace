// server/tests/test-payroll-probation-salary-rate.js
//
// LỖI ĐÃ VÁ (re-audit lần 9, mức Cao — "computeEmployeePayslip() bỏ qua probationSalaryRate"):
// contract.probationSalaryRate ("Tỷ lệ hưởng lương trong thời gian thử việc", 85 hoặc 100 — chỉ có ý
// nghĩa khi contractType='PROBATION', xem lib/laborContract.js) trước đây hoàn toàn không được đọc ở
// computeEmployeePayslip() — nhân viên thử việc cấu hình 85% vẫn bị tính lương CƠ BẢN đủ 100%, trả dư
// âm thầm. Đây KHÁC các cảnh báo BASIC_SALARY khác trong hàm (nghỉ/vào làm giữa kỳ...) — field này là 1
// công thức ĐÃ CÓ NGUỒN DỮ LIỆU XÁC NHẬN THẬT (HR tự cấu hình rõ ràng 85/100), nên ÁP DỤNG TRỰC TIẾP
// thay vì chỉ cảnh báo.
//
// computeEmployeePayslip() là hàm THUẦN (không đụng DB/network) — gọi thẳng, không cần stub gì.
//
// Chạy: node server/tests/test-payroll-probation-salary-rate.js
'use strict';
const assert = require('assert');
const { computeEmployeePayslip, defaultRateConfig } = require('../lib/payroll');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); passed++; }
  catch (err) { console.log(`FAIL: ${name}\n  -> ${err.message}`); failed++; }
}

const PERIOD = { periodYear: 2026, periodMonth: 9 }; // kỳ 09/2026 -> 2026-09-01..2026-09-30
const RATE_CONFIG = defaultRateConfig();

function baseAppData(overrides) {
  return Object.assign({
    employeeProfiles: [{ employeeCode: 'NV001', username: 'emp1', status: 'ACTIVE', dependents: [] }],
    users: [{ username: 'emp1', posType: 'OFFICE', dept: 'Phòng Kinh Doanh', active: true }],
    hrProcesses: [],
    attendanceRecords: [],
    laborContracts: [
      {
        id: 1, employeeCode: 'NV001', status: 'ACTIVE', baseSalary: 20000000, dept: 'Phòng Kinh Doanh',
        contractType: 'PROBATION', probationSalaryRate: 85, startDate: '2020-01-01', history: []
      }
    ]
  }, overrides);
}

test('LỖI ĐÃ VÁ: hợp đồng thử việc cấu hình 85% -> BASIC_SALARY chỉ tính 85% lương cơ bản (không trả dư 100%)', () => {
  const appData = baseAppData();
  const result = computeEmployeePayslip('NV001', PERIOD, appData, RATE_CONFIG);
  assert.ok(!result.skipped, 'Không được skip khi có đủ hợp đồng/mô hình chấm công');
  const basicLine = result.details.find(d => d.componentCode === 'BASIC_SALARY');
  assert.ok(basicLine, 'Phải có dòng BASIC_SALARY');
  assert.strictEqual(basicLine.amount, 17000000, 'Phải là 85% của 20.000.000 = 17.000.000, KHÔNG phải đủ 100%');
  assert.ok(basicLine.note.includes('85%'), `Ghi chú phải nêu rõ đã áp dụng 85%, got: ${basicLine.note}`);
  assert.ok(basicLine.note.includes('20.000.000'), 'Ghi chú phải nêu rõ mức lương GỐC trước khi áp tỷ lệ, để kế toán đối chiếu lại hợp đồng');
});

test('Hợp đồng thử việc cấu hình 100% -> KHÔNG đổi gì (100% = không giảm, giữ nguyên ghi chú mặc định)', () => {
  const appData = baseAppData();
  appData.laborContracts[0].probationSalaryRate = 100;
  const result = computeEmployeePayslip('NV001', PERIOD, appData, RATE_CONFIG);
  const basicLine = result.details.find(d => d.componentCode === 'BASIC_SALARY');
  assert.strictEqual(basicLine.amount, 20000000);
  assert.strictEqual(basicLine.note, 'Theo hợp đồng lao động đang hiệu lực', 'probationSalaryRate=100 là no-op, không thêm ghi chú thừa');
});

test('Hợp đồng KHÔNG phải PROBATION (VD FIXED_TERM) dù có probationSalaryRate cũ sót lại -> KHÔNG áp dụng (field chỉ có ý nghĩa với PROBATION)', () => {
  const appData = baseAppData();
  appData.laborContracts[0].contractType = 'FIXED_TERM';
  appData.laborContracts[0].probationSalaryRate = 85; // sót lại từ hợp đồng thử việc trước đó, đã chuyển loại
  const result = computeEmployeePayslip('NV001', PERIOD, appData, RATE_CONFIG);
  const basicLine = result.details.find(d => d.componentCode === 'BASIC_SALARY');
  assert.strictEqual(basicLine.amount, 20000000, 'KHÔNG được áp dụng tỷ lệ thử việc cho hợp đồng đã chuyển loại khác PROBATION');
  assert.strictEqual(basicLine.note, 'Theo hợp đồng lao động đang hiệu lực');
});

test('Hợp đồng PROBATION nhưng probationSalaryRate = null (chưa cấu hình) -> KHÔNG tự suy đoán, giữ đủ 100% như hành vi cũ', () => {
  const appData = baseAppData();
  appData.laborContracts[0].probationSalaryRate = null;
  const result = computeEmployeePayslip('NV001', PERIOD, appData, RATE_CONFIG);
  const basicLine = result.details.find(d => d.componentCode === 'BASIC_SALARY');
  assert.strictEqual(basicLine.amount, 20000000);
  assert.strictEqual(basicLine.note, 'Theo hợp đồng lao động đang hiệu lực');
});

test('Tỷ lệ thử việc 85% kết hợp với nhánh cảnh báo "vào làm giữa kỳ" đã có từ trước -> CẢ 2 cùng áp dụng (giảm 85% + vẫn nhắc rà soát ngày công)', () => {
  const appData = baseAppData();
  appData.laborContracts[0].startDate = '2026-09-10'; // vào làm giữa kỳ 09/2026
  const result = computeEmployeePayslip('NV001', PERIOD, appData, RATE_CONFIG);
  const basicLine = result.details.find(d => d.componentCode === 'BASIC_SALARY');
  assert.strictEqual(basicLine.amount, 17000000, 'Vẫn phải áp đúng 85% dù đồng thời có cảnh báo vào làm giữa kỳ');
  assert.ok(basicLine.note.includes('vào làm'), 'Ghi chú "vào làm giữa kỳ" (đã có từ trước) vẫn phải còn, không bị ghi đè');
  assert.ok(basicLine.note.includes('85%'), 'Ghi chú áp dụng tỷ lệ thử việc vẫn phải nối thêm vào cuối');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
