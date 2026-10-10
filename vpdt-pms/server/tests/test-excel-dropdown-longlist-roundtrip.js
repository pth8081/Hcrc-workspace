// server/tests/test-excel-dropdown-longlist-roundtrip.js
//
// Test bổ sung (10/2026, theo yêu cầu người dùng "test lại kỹ xem có ảnh hưởng thao tác/logic nghiệp
// vụ không" sau khi merge v25.69): applyDropdownValidation() (lib/adminExport.js) khi danh sách dropdown
// DÀI (>255 ký tự) phải tự chuyển sang cột ẩn + tham chiếu range — cột ẩn này KHÔNG có header (header
// rỗng), nên cần xác nhận parseImportFile()/parseImportExcelBuffer() (dùng detectColumns() theo TÊN
// header, không theo vị trí cột) vẫn đọc đúng — không bị lẫn cột ẩn vào field nào, và dòng dữ liệu thật
// (dept lấy đúng 1 giá trị trong danh sách dài đó) vẫn parse đúng, không bị lỗi/bỏ qua.
'use strict';
const assert = require('assert');
const laborContractImport = require('../lib/laborContractImport');
const orgChartImport = require('../lib/orgChartImport');
const laborContract = require('../lib/laborContract');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

async function main() {
  const LONG_DEPTS = Array.from({ length: 40 }, (_, i) => `Siêu Thị Quận ${i + 1} - Khu Vực Miền Nam Việt Nam`);
  assert.ok(LONG_DEPTS.join(',').length > 255, 'fixture phải thật sự vượt 255 ký tự');

  await test('[Labor Contract] dropdown dept DÀI (fallback cột ẩn) -> parseImportFile() vẫn đọc đúng field dept của dòng thật, không lẫn cột ẩn', async () => {
    const wb = laborContractImport.buildImportTemplateWorkbook({ depts: LONG_DEPTS });
    const sheet = wb.getWorksheet('Hợp Đồng Lao Động');
    const deptCol = sheet.getColumn('dept');
    const dv = sheet.getCell(`${deptCol.letter}2`).dataValidation;
    assert.ok(dv && !dv.formulae[0].startsWith('"'), 'phải rơi vào nhánh fallback range-reference (danh sách dài)');

    const contract = laborContract.defaultContract({
      id: 1, employeeCode: 'NV9001', code: 'HDLD-NV9001-1', status: 'ACTIVE',
      contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31', baseSalary: 10000000, dept: 'Phòng Cũ'
    });
    sheet.getRow(2).getCell('employeeCode').value = 'NV9001';
    sheet.getRow(2).getCell('dept').value = LONG_DEPTS[17]; // 1 giá trị THẬT trong danh sách dài
    const buffer = await wb.xlsx.writeBuffer();
    const items = await laborContractImport.parseImportFile(buffer, { laborContracts: [contract], employeeProfiles: [], users: [], hrProcesses: [] });
    assert.strictEqual(items.length, 1, 'phải đọc đúng 1 dòng dữ liệu (dòng ví dụ mẫu ĐÚNG dòng 2), không lẫn thêm dòng/cột ẩn nào thành dòng giả: ' + JSON.stringify(items));
    assert.strictEqual(items[0].fields.dept, LONG_DEPTS[17], 'field dept phải đọc đúng giá trị đã chọn từ dropdown dài, không bị lệch cột');
    assert.strictEqual(items[0].valid, true, 'dòng hợp lệ phải parse thành công: ' + JSON.stringify(items[0].errors));
  });

  await test('[Cơ Cấu Tổ Chức] dropdown departmentRef/jobTitle DÀI -> parseImportExcelBuffer() vẫn đọc đúng cây, không lẫn cột ẩn', async () => {
    const wb = await orgChartImport.buildImportTemplateWorkbook({
      depts: LONG_DEPTS, stores: [], jobTitles: ['Trưởng Phòng'], storeJobTitles: [], jobGrades: []
    });
    const sheet = wb.getWorksheet('Cơ Cấu Tổ Chức');
    const dvDept = sheet.getCell(`${sheet.getColumn('departmentRef').letter}2`).dataValidation;
    assert.ok(dvDept && !dvDept.formulae[0].startsWith('"'), 'departmentRef phải rơi vào nhánh fallback (danh sách dài)');

    // Giữ nguyên 5 dòng ví dụ mẫu có sẵn (đúng dòng 2-6, như người dùng thật mở file sẽ thấy) — chỉ sửa
    // đúng 1 ô departmentRef (dòng PKD, dòng 3) sang 1 giá trị THẬT trong danh sách dài, mô phỏng đúng
    // thao tác chọn từ dropdown dài.
    sheet.getRow(3).getCell('departmentRef').value = LONG_DEPTS[22];
    const buffer = await wb.xlsx.writeBuffer();
    const { items, fileErrors, valid } = await orgChartImport.parseImportExcelBuffer(buffer);
    assert.strictEqual(fileErrors.length, 0, 'không được có lỗi cấu trúc: ' + fileErrors.join(';'));
    assert.ok(valid, 'phải hợp lệ');
    assert.strictEqual(items.length, 5, 'phải đọc đúng 5 dòng ví dụ mẫu có sẵn (ĐÚNG dòng 2-6), không lẫn cột ẩn thành dòng/field giả: ' + JSON.stringify(items));
    const pkd = items.find(it => it.nodeKey === 'PKD');
    assert.strictEqual(pkd.departmentRef, LONG_DEPTS[22], 'departmentRef phải đọc đúng giá trị đã chọn từ dropdown dài');
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed${failed ? ', ' + failed + ' FAILED' : ''} ====`);
  if (failed) process.exitCode = 1;
}
main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
