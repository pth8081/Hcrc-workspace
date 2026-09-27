// server/tests/test-hr-profile-import-gd1-fields.js
//
// Regression test cho 7 cột Excel mới bổ sung vào Nhập/Xuất hàng loạt Hồ Sơ Nhân Sự (GĐ1, 10/2026 —
// đối chiếu file Excel quản lý thủ công của bộ phận Nhân Sự, xem lib/employeeProfileImport.js): Quốc
// Tịch, Tình Trạng Hôn Nhân, Ngày/Nơi Cấp CCCD, Vị Trí Bàn Làm Việc, Ngày Nghỉ Hưu Dự Kiến, BHXH Tại Đơn
// Vị Này. Test THUẦN (không HTTP) — dựng 1 workbook bằng chính buildImportTemplateWorkbook() rồi tự
// chỉnh dòng dữ liệu, xác nhận parseImportExcelBuffer() đọc/validate đúng.
//
// Chạy: node server/tests/test-hr-profile-import-gd1-fields.js
'use strict';

const assert = require('assert');
const employeeProfileImport = require('../lib/employeeProfileImport');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

async function buildBufferWithRow(overrides) {
  const wb = await employeeProfileImport.buildImportTemplateWorkbook();
  const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
  const row = sheet.getRow(2); // dòng ví dụ có sẵn trong mẫu
  for (const [key, val] of Object.entries(overrides)) row.getCell(key).value = val;
  return wb.xlsx.writeBuffer();
}

async function main() {
  await test('buildImportTemplateWorkbook(): mẫu có đủ 7 cột mới với dữ liệu ví dụ hợp lệ', async () => {
    const buffer = await buildBufferWithRow({});
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], []);
    assert.strictEqual(items.length, 1);
    const it = items[0];
    assert.strictEqual(it.nationality, 'Việt Nam');
    assert.strictEqual(it.maritalStatus, 'Độc thân');
    assert.strictEqual(it.nationalIdIssueDate, '2020-01-15');
    assert.ok(it.nationalIdIssuePlace, 'Nơi cấp CCCD phải đọc được từ dòng ví dụ');
    assert.ok(it.deskLocation, 'Vị trí bàn làm việc phải đọc được từ dòng ví dụ');
    assert.strictEqual(it.retirementDate, null, 'Dòng ví dụ để trống Ngày nghỉ hưu -> null hợp lệ');
    assert.strictEqual(it.socialInsuranceAtThisUnit, true, '"Có" phải parse thành true');
    assert.strictEqual(it.valid, true);
  });

  await test('parseImportExcelBuffer(): maritalStatus lạ bị đánh dấu lỗi (không chặn cả file)', async () => {
    const buffer = await buildBufferWithRow({ maritalStatus: 'Ly thân' });
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], []);
    assert.strictEqual(items[0].valid, false);
    assert.ok(/Tình trạng hôn nhân/.test(items[0].errors.join(';')), items[0].errors.join(';'));
  });

  await test('parseImportExcelBuffer(): ngày cấp CCCD không hợp lệ bị đánh dấu lỗi', async () => {
    const buffer = await buildBufferWithRow({ nationalIdIssueDate: 'không-phải-ngày' });
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], []);
    assert.strictEqual(items[0].valid, false);
    assert.ok(/Ngày cấp CCCD/.test(items[0].errors.join(';')), items[0].errors.join(';'));
  });

  await test('parseImportExcelBuffer(): BHXH Tại Đơn Vị Này "Không" -> false; giá trị lạ bị đánh dấu lỗi', async () => {
    const bufferKhong = await buildBufferWithRow({ socialInsuranceAtThisUnit: 'Không' });
    const itemsKhong = await employeeProfileImport.parseImportExcelBuffer(bufferKhong, [], []);
    assert.strictEqual(itemsKhong[0].socialInsuranceAtThisUnit, false);
    assert.strictEqual(itemsKhong[0].valid, true);

    const bufferLa = await buildBufferWithRow({ socialInsuranceAtThisUnit: 'Chưa biết' });
    const itemsLa = await employeeProfileImport.parseImportExcelBuffer(bufferLa, [], []);
    assert.strictEqual(itemsLa[0].valid, false);
    assert.ok(/BHXH Tại Đơn Vị Này/.test(itemsLa[0].errors.join(';')), itemsLa[0].errors.join(';'));
  });

  await test('parseImportExcelBuffer(): để trống cả 7 cột mới vẫn hợp lệ (tuỳ chọn)', async () => {
    const buffer = await buildBufferWithRow({
      nationality: '', maritalStatus: '', nationalIdIssueDate: '', nationalIdIssuePlace: '',
      deskLocation: '', retirementDate: '', socialInsuranceAtThisUnit: ''
    });
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], []);
    assert.strictEqual(items[0].valid, true);
    assert.strictEqual(items[0].nationality, null);
    assert.strictEqual(items[0].socialInsuranceAtThisUnit, null);
  });

  await test('buildExportWorkbook(): xuất đúng 7 cột mới, kể cả jobGrade (chỉ đọc) và nhãn Có/Không cho BHXH', async () => {
    const profile = {
      employeeCode: 'NV999', status: 'ACTIVE', nationality: 'Việt Nam', maritalStatus: 'Đã kết hôn',
      nationalIdIssueDate: '2019-03-01', nationalIdIssuePlace: 'Công an TP.HCM',
      jobGrade: 'L6', deskLocation: 'Tầng 2', retirementDate: '2050-01-01', socialInsuranceAtThisUnit: true
    };
    const wb = await employeeProfileImport.buildExportWorkbook([profile], [], []);
    const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
    const row = sheet.getRow(2);
    const values = row.values; // ExcelJS: index 0 rỗng, cột thật từ index 1
    const headerRow = sheet.getRow(1).values;
    const idx = (label) => headerRow.indexOf(label);
    assert.strictEqual(values[idx('Quốc Tịch')], 'Việt Nam');
    assert.strictEqual(values[idx('Tình Trạng Hôn Nhân')], 'Đã kết hôn');
    assert.strictEqual(values[idx('Cấp Bậc')], 'L6');
    assert.strictEqual(values[idx('BHXH Tại Đơn Vị Này')], 'Có');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
