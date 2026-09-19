// server/tests/test-payroll-basesalary-midperiod.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu đợt 3, 9/2026): computeEmployeePayslip() (lib/payroll.js) đã cảnh báo
// BASIC_SALARY khi nhân viên nghỉ việc/vào làm GIỮA KỲ, nhưng chưa cảnh báo khi lương cơ bản được HR
// "💰 Cập Nhật Lương Cơ Bản" trực tiếp trên hợp đồng đang ACTIVE (applyManualEdit(), lib/laborContract.js,
// ghi history action='MANUAL_EDIT', flow thêm ở v23.56) NGAY TRONG kỳ đang tính lương — payslip vẫn tính
// đủ 1 tháng theo mức MỚI dù đổi giữa kỳ, không có ghi chú nào để kế toán biết cần rà soát/chia tỷ lệ.
//
// computeEmployeePayslip() là hàm THUẦN (không đụng DB/network) — gọi thẳng, không cần stub gì.
//
// Chạy: node server/tests/test-payroll-basesalary-midperiod.js
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
        startDate: '2020-01-01', history: []
      }
    ]
  }, overrides);
}

test('MANUAL_EDIT đổi lương cơ bản GIỮA kỳ đang tính -> BASIC_SALARY có ghi chú nhắc rà soát', () => {
  const appData = baseAppData();
  appData.laborContracts[0].history = [
    { action: 'MANUAL_EDIT', by: 'hr1', byName: 'Nhân Sự', time: '09:00:00 15/9/2026', detail: 'Lương cơ bản: "15.000.000" → "20.000.000"' }
  ];
  const result = computeEmployeePayslip('NV001', PERIOD, appData, RATE_CONFIG);
  assert.ok(!result.skipped, 'Không được skip khi có đủ hợp đồng/mô hình chấm công');
  const basicLine = result.details.find(d => d.componentCode === 'BASIC_SALARY');
  assert.ok(basicLine, 'Phải có dòng BASIC_SALARY');
  assert.ok(basicLine.note.includes('15/9/2026') || basicLine.note.includes('2026-09-15'), `Ghi chú phải nêu đúng ngày đổi lương giữa kỳ, got: ${basicLine.note}`);
  assert.ok(basicLine.note.includes('rà soát') && basicLine.note.includes('Điều chỉnh'), 'Ghi chú phải nhắc kế toán rà soát + điều chỉnh, cùng khuôn 2 nhánh nghỉ/vào làm giữa kỳ');
});

test('MANUAL_EDIT đổi lương cơ bản ở KỲ TRƯỚC (ngoài kỳ đang tính) -> KHÔNG có ghi chú gì thêm', () => {
  const appData = baseAppData();
  appData.laborContracts[0].history = [
    { action: 'MANUAL_EDIT', by: 'hr1', byName: 'Nhân Sự', time: '09:00:00 15/8/2026', detail: 'Lương cơ bản: "15.000.000" → "20.000.000"' }
  ];
  const result = computeEmployeePayslip('NV001', PERIOD, appData, RATE_CONFIG);
  const basicLine = result.details.find(d => d.componentCode === 'BASIC_SALARY');
  assert.strictEqual(basicLine.note, 'Theo hợp đồng lao động đang hiệu lực', 'Đổi lương ở kỳ TRƯỚC không liên quan tới kỳ đang tính -> không cần cảnh báo');
});

test('MANUAL_EDIT sửa field KHÁC (không phải lương cơ bản) trong kỳ -> KHÔNG kích hoạt cảnh báo lương', () => {
  const appData = baseAppData();
  appData.laborContracts[0].history = [
    { action: 'MANUAL_EDIT', by: 'hr1', byName: 'Nhân Sự', time: '09:00:00 15/9/2026', detail: 'Phòng ban: "Phòng Kinh Doanh" → "Phòng Marketing"' }
  ];
  const result = computeEmployeePayslip('NV001', PERIOD, appData, RATE_CONFIG);
  const basicLine = result.details.find(d => d.componentCode === 'BASIC_SALARY');
  assert.strictEqual(basicLine.note, 'Theo hợp đồng lao động đang hiệu lực', 'Sửa field khác (không phải baseSalary) không được kích hoạt cảnh báo này');
});

test('Nhiều lần đổi lương trong CÙNG kỳ -> ghi chú lấy mốc GẦN NHẤT (khớp mức lương hiện tại là mức sau lần đổi cuối)', () => {
  const appData = baseAppData();
  appData.laborContracts[0].history = [
    { action: 'MANUAL_EDIT', by: 'hr1', byName: 'Nhân Sự', time: '09:00:00 5/9/2026', detail: 'Lương cơ bản: "15.000.000" → "18.000.000"' },
    { action: 'MANUAL_EDIT', by: 'hr1', byName: 'Nhân Sự', time: '09:00:00 20/9/2026', detail: 'Lương cơ bản: "18.000.000" → "20.000.000"' }
  ];
  const result = computeEmployeePayslip('NV001', PERIOD, appData, RATE_CONFIG);
  const basicLine = result.details.find(d => d.componentCode === 'BASIC_SALARY');
  assert.ok(basicLine.note.includes('20/9/2026') || basicLine.note.includes('2026-09-20'), `Phải lấy mốc GẦN NHẤT (20/9), got: ${basicLine.note}`);
});

test('Không có MANUAL_EDIT nào đổi lương -> giữ nguyên ghi chú mặc định như trước (không đổi hành vi cũ)', () => {
  const appData = baseAppData();
  const result = computeEmployeePayslip('NV001', PERIOD, appData, RATE_CONFIG);
  const basicLine = result.details.find(d => d.componentCode === 'BASIC_SALARY');
  assert.strictEqual(basicLine.note, 'Theo hợp đồng lao động đang hiệu lực');
});

test('Nhân viên vào làm giữa kỳ VẪN ưu tiên ghi chú "vào làm giữa kỳ" hơn (không bị ghi đè bởi nhánh MANUAL_EDIT) khi cả 2 cùng xảy ra', () => {
  const appData = baseAppData();
  appData.laborContracts[0].startDate = '2026-09-10'; // vào làm giữa kỳ 09/2026
  appData.laborContracts[0].history = [
    { action: 'MANUAL_EDIT', by: 'hr1', byName: 'Nhân Sự', time: '09:00:00 15/9/2026', detail: 'Lương cơ bản: "15.000.000" → "20.000.000"' }
  ];
  const result = computeEmployeePayslip('NV001', PERIOD, appData, RATE_CONFIG);
  const basicLine = result.details.find(d => d.componentCode === 'BASIC_SALARY');
  assert.ok(basicLine.note.includes('vào làm'), 'Nhánh vào làm giữa kỳ đã tồn tại từ trước phải giữ nguyên ưu tiên, không bị nhánh mới lấn át');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
