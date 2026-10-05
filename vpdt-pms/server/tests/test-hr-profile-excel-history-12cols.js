// server/tests/test-hr-profile-excel-history-12cols.js
//
// Regression test cho đợt "báo cáo rà soát mẫu Excel mới" (10/2026, bước 4/4) — mở rộng
// lib/employeeProfileImport.js::buildExportWorkbook():
//  1. Symmetry fix: bankAccountNo/bankName/bankAccountHolderName/contactPhone — có trong mẫu Tải Về để
//     nhập nhưng TRƯỚC ĐÂY không xuất hiện lại khi Xuất Excel (LỖI ĐÃ VÁ, 1 chiều nhập->mất khi xuất).
//  2. 8 cột CHỈ XEM đọc LIVE từ users/hrProcesses (WIRED_READONLY_COLUMNS — deptCode/khoiBan/
//     managerUsername+Name/managerManagerUsername+Name/resignationReason/actualEndDateDisplay).
//  3. 4 cột CHỈ XEM mở rộng khối hợp đồng ACTIVE (socialInsuranceSalary/productivityBonus/otherIncome/
//     probationSalaryRate).
//  4. 12 cột lịch sử (HISTORY_READONLY_COLUMNS) — HĐLĐ lần 1/2/3 (3 bản ghi laborContracts CŨ NHẤT theo
//     startDate) + Điều chỉnh thu nhập lần 1/2/3 (3 amendments CŨ NHẤT theo applyDate của hợp đồng
//     ACTIVE) — CHỈ dùng khi xuất, không có trong mẫu nhập.
//
// Test THUẦN (không HTTP), cùng khuôn tests/test-hr-profile-import-90fields.js.
// Chạy: node server/tests/test-hr-profile-excel-history-12cols.js
'use strict';

const assert = require('assert');
const employeeProfileImport = require('../lib/employeeProfileImport');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

function cellByHeader(sheet, rowNum, label) {
  const headerRow = sheet.getRow(1).values;
  const values = sheet.getRow(rowNum).values;
  const idx = headerRow.indexOf(label);
  assert.ok(idx > -1, `Không tìm thấy cột "${label}"`);
  return values[idx];
}

async function main() {
  await test('LỖI ĐÃ VÁ: bankAccountNo/bankName/bankAccountHolderName/contactPhone giờ xuất hiện khi Xuất Excel (trước đây mất, chỉ nhập được)', async () => {
    const profile = {
      employeeCode: 'NV5001', status: 'ACTIVE',
      bankAccountNo: '0071009999999', bankName: 'Vietcombank', bankAccountHolderName: 'Trần Văn X',
      contactPhone: '0909888777'
    };
    const wb = await employeeProfileImport.buildExportWorkbook([profile], [], [], []);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    assert.strictEqual(cellByHeader(sheet, 2, 'Số Tài Khoản Ngân Hàng'), '0071009999999');
    assert.strictEqual(cellByHeader(sheet, 2, 'Ngân Hàng'), 'Vietcombank');
    assert.strictEqual(cellByHeader(sheet, 2, 'Tên Chủ Tài Khoản Ngân Hàng'), 'Trần Văn X');
    assert.strictEqual(cellByHeader(sheet, 2, 'Điện Thoại Liên Hệ'), '0909888777');
  });

  await test('WIRED_READONLY_COLUMNS: đọc đúng khoiBan/mã+tên quản lý trực tiếp/cấp trên từ users, deptCode từ deptCodeMap', async () => {
    const users = [
      { username: 'nv1', name: 'Nhân Viên Một', dept: 'Phòng Kinh Doanh', khoiBan: 'Khối Kinh Doanh', managerUsername: 'tp1' },
      { username: 'tp1', name: 'Trưởng Phòng Một', managerUsername: 'gd1' },
      { username: 'gd1', name: 'Giám Đốc Một' }
    ];
    const profile = { employeeCode: 'NV5002', status: 'ACTIVE', username: 'nv1' };
    const deptCodeMap = { 'Phòng Kinh Doanh': 'PH0007' };
    const wb = await employeeProfileImport.buildExportWorkbook([profile], users, [], [], deptCodeMap);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    assert.strictEqual(cellByHeader(sheet, 2, 'Mã Bộ Phận (CHỈ XEM)'), 'PH0007');
    assert.strictEqual(cellByHeader(sheet, 2, 'Khối/Ban (CHỈ XEM)'), 'Khối Kinh Doanh');
    assert.strictEqual(cellByHeader(sheet, 2, 'Mã QLTT (CHỈ XEM)'), 'tp1');
    assert.strictEqual(cellByHeader(sheet, 2, 'Họ Tên QLTT (CHỈ XEM)'), 'Trưởng Phòng Một');
    assert.strictEqual(cellByHeader(sheet, 2, 'Mã QL Cấp Trên (CHỈ XEM)'), 'gd1');
    assert.strictEqual(cellByHeader(sheet, 2, 'Họ Tên QL Cấp Trên (CHỈ XEM)'), 'Giám Đốc Một');
  });

  await test('WIRED_READONLY_COLUMNS: deptCode để trống nếu bộ phận CHƯA từng được cấp mã (không tự sinh mã mới lúc xuất)', async () => {
    const profile = { employeeCode: 'NV5003', status: 'ACTIVE', username: 'nv2' };
    const users = [{ username: 'nv2', name: 'Nhân Viên Hai', dept: 'Phòng Mới Chưa Cấp Mã' }];
    const wb = await employeeProfileImport.buildExportWorkbook([profile], users, [], [], {});
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    assert.strictEqual(cellByHeader(sheet, 2, 'Mã Bộ Phận (CHỈ XEM)'), '');
  });

  await test('WIRED_READONLY_COLUMNS: resignationReason + actualEndDateDisplay đọc đúng từ OFFBOARDING mới nhất', async () => {
    const profile = { employeeCode: 'NV5004', status: 'INACTIVE', username: 'nv3' };
    const users = [{ username: 'nv3', name: 'Nhân Viên Ba' }];
    const hrProcesses = [
      { processType: 'OFFBOARDING', employeeUsername: 'nv3', resignationReason: 'Lý do cũ', actualEndDate: '2025-01-01', createdAt: '08:00:00 1/1/2025' },
      { processType: 'OFFBOARDING', employeeUsername: 'nv3', resignationReason: 'Lý do mới nhất', actualEndDate: '2026-06-02', createdAt: '08:00:00 1/6/2026' }
    ];
    const wb = await employeeProfileImport.buildExportWorkbook([profile], users, hrProcesses, []);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    assert.strictEqual(cellByHeader(sheet, 2, 'Lý Do Nghỉ Việc (CHỈ XEM)'), 'Lý do mới nhất');
    assert.strictEqual(cellByHeader(sheet, 2, 'Ngày Nghỉ Việc Thực Tế (CHỈ XEM)'), '2026-06-02');
  });

  await test('4 cột thu nhập mở rộng (socialInsuranceSalary/productivityBonus/otherIncome/probationSalaryRate) đọc LIVE từ hợp đồng ACTIVE', async () => {
    const profile = { employeeCode: 'NV5005', status: 'ACTIVE' };
    const contract = {
      employeeCode: 'NV5005', status: 'ACTIVE', code: 'HDLD-NV5005-1', contractType: 'PROBATION',
      startDate: '2026-01-01', endDate: '2026-02-28',
      socialInsuranceSalary: 8500000, productivityBonus: 1200000, otherIncome: 300000, probationSalaryRate: 85
    };
    const wb = await employeeProfileImport.buildExportWorkbook([profile], [], [], [contract]);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    assert.strictEqual(cellByHeader(sheet, 2, 'Mức Lương Đóng BHXH (CHỈ XEM)'), 8500000);
    assert.strictEqual(cellByHeader(sheet, 2, 'Thưởng HQCV/Năng Suất (CHỈ XEM)'), 1200000);
    assert.strictEqual(cellByHeader(sheet, 2, 'Khoản Khác (CHỈ XEM)'), 300000);
    assert.strictEqual(cellByHeader(sheet, 2, 'Tỷ Lệ Lương Thử Việc % (CHỈ XEM)'), 85);
  });

  await test('12 cột lịch sử: HĐLĐ lần 1/2/3 lấy đúng 3 bản ghi CŨ NHẤT theo startDate, KHÔNG phụ thuộc thứ tự trong mảng', async () => {
    const profile = { employeeCode: 'NV5006', status: 'ACTIVE' };
    const contracts = [
      { employeeCode: 'NV5006', status: 'ACTIVE', startDate: '2026-07-01', endDate: null, contractType: 'INDEFINITE' },
      { employeeCode: 'NV5006', status: 'EXPIRED', startDate: '2024-01-01', endDate: '2024-06-30', contractType: 'PROBATION' },
      { employeeCode: 'NV5006', status: 'SUPERSEDED', startDate: '2024-07-01', endDate: '2026-06-30', contractType: 'FIXED_TERM' },
      { employeeCode: 'KHAC001', status: 'ACTIVE', startDate: '2020-01-01', endDate: null, contractType: 'INDEFINITE' }
    ];
    const wb = await employeeProfileImport.buildExportWorkbook([profile], [], [], contracts);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    assert.strictEqual(cellByHeader(sheet, 2, 'Ngày Ký HĐLĐ Lần 1 (CHỈ XEM)'), '2024-01-01');
    assert.strictEqual(cellByHeader(sheet, 2, 'Ngày Hết Hạn HĐLĐ Lần 1 (CHỈ XEM)'), '2024-06-30');
    assert.strictEqual(cellByHeader(sheet, 2, 'Ngày Ký HĐLĐ Lần 2 (CHỈ XEM)'), '2024-07-01');
    assert.strictEqual(cellByHeader(sheet, 2, 'Ngày Hết Hạn HĐLĐ Lần 2 (CHỈ XEM)'), '2026-06-30');
    assert.strictEqual(cellByHeader(sheet, 2, 'Ngày Ký HĐLĐ Lần 3 (CHỈ XEM)'), '2026-07-01');
    assert.strictEqual(cellByHeader(sheet, 2, 'Ngày Hết Hạn HĐLĐ Lần 3 (CHỈ XEM)'), '');
  });

  await test('12 cột lịch sử: chỉ 1 hợp đồng ACTIVE duy nhất -> vẫn hiện ở "Lần 1", Lần 2/3 để trống', async () => {
    const profile = { employeeCode: 'NV5007', status: 'ACTIVE' };
    const contracts = [{ employeeCode: 'NV5007', status: 'ACTIVE', startDate: '2026-01-01', endDate: null, contractType: 'INDEFINITE' }];
    const wb = await employeeProfileImport.buildExportWorkbook([profile], [], [], contracts);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    assert.strictEqual(cellByHeader(sheet, 2, 'Ngày Ký HĐLĐ Lần 1 (CHỈ XEM)'), '2026-01-01');
    assert.strictEqual(cellByHeader(sheet, 2, 'Ngày Ký HĐLĐ Lần 2 (CHỈ XEM)'), '');
    assert.strictEqual(cellByHeader(sheet, 2, 'Ngày Ký HĐLĐ Lần 3 (CHỈ XEM)'), '');
  });

  await test('12 cột lịch sử: Điều chỉnh thu nhập lần 1/2/3 lấy đúng 3 amendments CŨ NHẤT theo applyDate của hợp đồng ACTIVE', async () => {
    const profile = { employeeCode: 'NV5008', status: 'ACTIVE' };
    const contract = {
      employeeCode: 'NV5008', status: 'ACTIVE', code: 'HDLD-NV5008-1', contractType: 'INDEFINITE', startDate: '2024-01-01', endDate: null,
      amendments: [
        { amendmentType: 'Tăng lương lần 2', applyDate: '2026-01-01', oldValue: '10tr', newValue: '12tr' },
        { amendmentType: 'Tăng lương lần 1', applyDate: '2025-01-01', oldValue: '8tr', newValue: '10tr' },
        { amendmentType: 'Phụ cấp mới', applyDate: '2026-06-01', oldValue: '0', newValue: '500k' }
      ]
    };
    const wb = await employeeProfileImport.buildExportWorkbook([profile], [], [], [contract]);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    assert.strictEqual(cellByHeader(sheet, 2, 'Ngày Áp Dụng Điều Chỉnh Lần 1 (CHỈ XEM)'), '2025-01-01');
    assert.ok(cellByHeader(sheet, 2, 'Nội Dung Điều Chỉnh Lần 1 (CHỈ XEM)').includes('Tăng lương lần 1'));
    assert.strictEqual(cellByHeader(sheet, 2, 'Ngày Áp Dụng Điều Chỉnh Lần 2 (CHỈ XEM)'), '2026-01-01');
    assert.strictEqual(cellByHeader(sheet, 2, 'Ngày Áp Dụng Điều Chỉnh Lần 3 (CHỈ XEM)'), '2026-06-01');
  });

  await test('12 cột lịch sử: không có hợp đồng/amendment nào -> toàn bộ 12 cột để trống, không lỗi', async () => {
    const profile = { employeeCode: 'NV5009', status: 'ACTIVE' };
    const wb = await employeeProfileImport.buildExportWorkbook([profile], [], [], []);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    for (let i = 1; i <= 3; i++) {
      assert.strictEqual(cellByHeader(sheet, 2, `Ngày Ký HĐLĐ Lần ${i} (CHỈ XEM)`), '');
      assert.strictEqual(cellByHeader(sheet, 2, `Ngày Hết Hạn HĐLĐ Lần ${i} (CHỈ XEM)`), '');
      assert.strictEqual(cellByHeader(sheet, 2, `Ngày Áp Dụng Điều Chỉnh Lần ${i} (CHỈ XEM)`), '');
      assert.strictEqual(cellByHeader(sheet, 2, `Nội Dung Điều Chỉnh Lần ${i} (CHỈ XEM)`), '');
    }
  });

  await test('buildExportWorkbook(): vẫn chạy được khi gọi KHÔNG truyền deptCodeMap (tương thích cũ)', async () => {
    const profile = { employeeCode: 'NV5010', status: 'ACTIVE', username: 'nv4' };
    const users = [{ username: 'nv4', name: 'Nhân Viên Bốn', dept: 'Phòng X' }];
    const wb = await employeeProfileImport.buildExportWorkbook([profile], users, [], []);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    assert.strictEqual(cellByHeader(sheet, 2, 'Mã Bộ Phận (CHỈ XEM)'), '');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
