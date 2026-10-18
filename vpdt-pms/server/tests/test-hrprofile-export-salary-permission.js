'use strict';

// tests/test-hrprofile-export-salary-permission.js
//
// LỖI ĐÃ VÁ (re-audit lần 5, mức Cao): GET /api/hr-profile/export-xlsx trước đây CHỈ gác
// requireProfileFullView (hrProfileManage/hrProfileFullView/hrProfileEdit) — KHÔNG đòi hrContractManage
// — nhưng buildExportWorkbook() (lib/employeeProfileImport.js) LUÔN kèm ~19 cột CHỈ XEM nguồn từ Hợp
// Đồng Lao Động (Lương Cơ Bản/phụ cấp/thu nhập, trường VỐN chỉ admin/hrContractManage được đọc, xem
// canViewLaborContract() ở lib/recordViewScope.js) + 12 cột lịch sử (amendment{i}Content có thể LÀ
// CHÍNH thay đổi lương). 1 tài khoản CHỈ quản lý Hồ Sơ Nhân Sự (không có bất kỳ quyền Hợp Đồng Lao
// Động nào) vẫn tải được NGUYÊN VẸN lương của TOÀN BỘ nhân viên qua file Excel — cùng lớp lỗ hổng đã
// chặn đúng ở GET .../by-code/:employeeCode/history và GET .../reports (đòi CẢ hrProfileManage LẪN
// hrContractManage).
//
// Đã vá: thêm tham số `includeContractData` (mặc định true, tương thích ngược) vào
// buildExportWorkbook() — CHỈ thêm 2 nhóm cột nguồn hợp đồng vào sheet.columns khi true. Route
// export-xlsx truyền canManageContracts(req.freshUser) làm tham số này — KHÔNG chặn hẳn cả route (vẫn
// xuất đầy đủ dữ liệu Hồ Sơ Nhân Sự thuần cho người chỉ có hrProfileManage/hrProfileFullView/
// hrProfileEdit, chỉ ẩn đúng 2 nhóm cột nhạy cảm).
//
// Test này gọi THẲNG buildExportWorkbook() (cùng khuôn test-hr-profile-import-90fields.js — không cần
// dựng lại toàn bộ route/HTTP để kiểm đúng phần MỚI: tham số includeContractData).
//
// Chạy: node server/tests/test-hrprofile-export-salary-permission.js
const assert = require('assert');
const employeeProfileImport = require('../lib/employeeProfileImport');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err && err.stack ? err.stack : err}`); }
}

const PROFILE = { employeeCode: 'NV999', status: 'ACTIVE', permanentAddress: 'Số 1 Lê Lợi', nationalId: '079099001234' };
const CONTRACT = {
  employeeCode: 'NV999', status: 'ACTIVE', code: 'HDLD-NV999-1', contractType: 'INDEFINITE',
  startDate: '2020-01-10', endDate: null, baseSalary: 15000000,
  responsibilityAllowance: 500000, concurrentAllowance: 200000, hazardAllowance: 0,
  lunchAllowance: 700000, transportAllowance: 300000, phoneAllowance: 100000, otherAllowance: 0,
  terminationDate: null, terminationReason: null,
  amendments: [{ applyDate: '2021-01-01', amendmentType: 'SALARY_CHANGE', oldValue: '10000000', newValue: '15000000' }]
};

(async () => {
  await test('LỖI ĐÃ VÁ: includeContractData=false -> cột "Lương Cơ Bản (CHỈ XEM)" KHÔNG xuất hiện trong header', async () => {
    const wb = await employeeProfileImport.buildExportWorkbook([PROFILE], [], [], [CONTRACT], {}, false);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    const headerRow = sheet.getRow(1).values;
    assert.strictEqual(headerRow.indexOf('Lương Cơ Bản (CHỈ XEM)'), -1, 'cột Lương Cơ Bản phải bị ẩn hoàn toàn, không chỉ để trống giá trị');
    assert.strictEqual(headerRow.indexOf('Phụ Cấp Trách Nhiệm (CHỈ XEM)'), -1);
    assert.strictEqual(headerRow.indexOf('Hỗ Trợ Đi Lại (CHỈ XEM)'), -1);
    assert.strictEqual(headerRow.indexOf('Mã Hợp Đồng (CHỈ XEM)'), -1, 'cả nhóm cột HĐLĐ (không riêng lương) phải bị ẩn');
  });

  await test('LỖI ĐÃ VÁ: includeContractData=false -> cột lịch sử điều chỉnh HĐLĐ (có thể chứa nội dung đổi lương) cũng KHÔNG xuất hiện', async () => {
    const wb = await employeeProfileImport.buildExportWorkbook([PROFILE], [], [], [CONTRACT], {}, false);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    const headerRow = sheet.getRow(1).values;
    assert.strictEqual(headerRow.indexOf('Nội Dung Điều Chỉnh Lần 1 (CHỈ XEM)'), -1);
    assert.strictEqual(headerRow.indexOf('Ngày Ký HĐLĐ Lần 1 (CHỈ XEM)'), -1);
  });

  await test('includeContractData=false -> dữ liệu Hồ Sơ Nhân Sự thuần (CCCD/địa chỉ) vẫn xuất bình thường, không bị chặn oan', async () => {
    const wb = await employeeProfileImport.buildExportWorkbook([PROFILE], [], [], [CONTRACT], {}, false);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    const headerRow = sheet.getRow(1).values;
    const values = sheet.getRow(2).values;
    const idx = (label) => headerRow.indexOf(label);
    assert.strictEqual(values[idx('Số CCCD/CMND')], '079099001234');
    assert.strictEqual(values[idx('Địa Chỉ Thường Trú')], 'Số 1 Lê Lợi');
  });

  await test('includeContractData=true (mặc định, KHÔNG truyền tham số) -> vẫn xuất đủ cột Lương như trước (tương thích ngược)', async () => {
    const wb = await employeeProfileImport.buildExportWorkbook([PROFILE], [], [], [CONTRACT]);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    const headerRow = sheet.getRow(1).values;
    const values = sheet.getRow(2).values;
    const idx = (label) => headerRow.indexOf(label);
    assert.notStrictEqual(idx('Lương Cơ Bản (CHỈ XEM)'), -1, 'không truyền tham số mới vẫn phải giữ hành vi CŨ (có cột lương)');
    assert.strictEqual(values[idx('Lương Cơ Bản (CHỈ XEM)')], 15000000);
  });

  await test('includeContractData=true (truyền rõ) -> vẫn xuất đủ cột Lương (không bị chặn oan khi có đủ quyền)', async () => {
    const wb = await employeeProfileImport.buildExportWorkbook([PROFILE], [], [], [CONTRACT], {}, true);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    const headerRow = sheet.getRow(1).values;
    const values = sheet.getRow(2).values;
    const idx = (label) => headerRow.indexOf(label);
    assert.strictEqual(values[idx('Lương Cơ Bản (CHỈ XEM)')], 15000000);
  });

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
