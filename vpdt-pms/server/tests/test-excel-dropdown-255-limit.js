// server/tests/test-excel-dropdown-255-limit.js
//
// LỖI ĐÃ VÁ (đợt rà soát v25.1→v25.70): buildWorkbookForSpec() (lib/objectCatalogImport.js) +
// buildGroupedTemplateWorkbook() (lib/groupedExcelImport.js) trước đây nối formula dropdown bằng
// `"${list.join(',')}"` thẳng cho cột kiểu "enum" — Excel giới hạn formula kiểu danh sách literal ở ĐÚNG
// 255 ký tự, danh mục dài (VD vài chục Phòng Ban/Nhóm Phê Duyệt) vượt ngưỡng này sẽ ÂM THẦM MẤT dropdown
// khi mở file (không có lỗi/cảnh báo nào) — cùng lớp lỗi đã vá trước đó ở lib/adminExport.js. Cả 2 engine
// giờ đi qua applyCatalogDropdownValidation() dùng chung, tự chuyển sang cột ẩn khi vượt ngưỡng.
//
// Chạy: node server/tests/test-excel-dropdown-255-limit.js
'use strict';

const { createRunner, assert, assertEqual } = require('./testHarness');
const { buildWorkbookForSpec, applyCatalogDropdownValidation } = require('../lib/objectCatalogImport');
const { buildGroupedTemplateWorkbook } = require('../lib/groupedExcelImport');

// 40 giá trị đủ dài để vượt 255 ký tự khi nối bằng dấu phẩy.
const LONG_OPTIONS = Array.from({ length: 40 }, (_, i) => `Phòng Ban Rất Dài Số ${i + 1} (Chi Nhánh Miền Bắc)`);
const SHORT_OPTIONS = ['Có', 'Không'];

async function main() {
  const run = createRunner();

  await run.run('applyCatalogDropdownValidation(): danh sách ngắn (<=255 ký tự) vẫn dùng formula literal như cũ', () => {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('T');
    sheet.columns = [{ header: 'A', key: 'a', width: 10 }];
    applyCatalogDropdownValidation(sheet, 'a', SHORT_OPTIONS, { startRow: 2, endRow: 3, required: false, helperColIdx: 100 });
    const dv = sheet.getCell('A2').dataValidation;
    assertEqual(dv.formulae[0], '"Có,Không"');
  });

  await run.run('applyCatalogDropdownValidation(): danh sách dài (>255 ký tự) tự chuyển sang cột ẩn, KHÔNG mất dropdown', () => {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('T');
    sheet.columns = [{ header: 'A', key: 'a', width: 10 }];
    assert(LONG_OPTIONS.join(',').length > 255, 'fixture phải thật sự vượt 255 ký tự');
    applyCatalogDropdownValidation(sheet, 'a', LONG_OPTIONS, { startRow: 2, endRow: 3, required: true, helperColIdx: 200 });
    const dv = sheet.getCell('A2').dataValidation;
    assertEqual(dv.type, 'list');
    assert(/^\$[A-Z]+\$1:\$[A-Z]+\$40$/.test(dv.formulae[0]), `formula phải tham chiếu cột ẩn, nhận: ${dv.formulae[0]}`);
    assertEqual(dv.allowBlank, false, 'required:true -> allowBlank phải false');
    const helperCol = sheet.getColumn(200);
    assert(helperCol.hidden, 'cột ẩn phải được đánh dấu hidden=true');
    assertEqual(sheet.getCell(1, 200).value, LONG_OPTIONS[0]);
    assertEqual(sheet.getCell(40, 200).value, LONG_OPTIONS[39]);
  });

  await run.run('buildWorkbookForSpec(): cột enum danh sách DÀI vẫn có dropdown qua file mẫu thật (XÁC NHẬN LỖI ĐÃ VÁ)', () => {
    const spec = {
      sheetName: 'Test Spec', label: 'Test',
      columns: [
        { header: 'Phòng Ban', key: 'dept', type: 'enum', required: true, options: LONG_OPTIONS }
      ],
      sampleRows: []
    };
    const wb = buildWorkbookForSpec(spec);
    const sheet = wb.worksheets[0];
    const dv = sheet.getCell('A2').dataValidation;
    assertEqual(dv.type, 'list');
    assert(!dv.formulae[0].startsWith('"'), 'formula literal thẳng sẽ bắt đầu bằng dấu ngoặc kép — phải KHÔNG còn vậy (đã chuyển cột ẩn)');
    assert(/^\$[A-Z]+\$1:\$[A-Z]+\$40$/.test(dv.formulae[0]), `formula phải tham chiếu cột ẩn, nhận: ${dv.formulae[0]}`);
  });

  await run.run('buildGroupedTemplateWorkbook(): cột enum danh sách DÀI vẫn có dropdown qua file mẫu thật (XÁC NHẬN LỖI ĐÃ VÁ)', () => {
    const spec = {
      sheets: [{
        sheetName: 'Nhóm', note: '',
        columns: [
          { header: 'Phòng Ban', key: 'dept', type: 'enum', required: true, options: LONG_OPTIONS }
        ],
        groupKeyCol: 'dept',
        sampleRows: []
      }]
    };
    const wb = buildGroupedTemplateWorkbook(spec);
    const sheet = wb.worksheets[0];
    const dv = sheet.getCell('A3').dataValidation; // dòng 1=note, dòng 2=tiêu đề, dòng 3=dữ liệu đầu tiên
    assertEqual(dv.type, 'list');
    assert(!dv.formulae[0].startsWith('"'), 'formula literal thẳng sẽ bắt đầu bằng dấu ngoặc kép — phải KHÔNG còn vậy (đã chuyển cột ẩn)');
    assert(/^\$[A-Z]+\$1:\$[A-Z]+\$40$/.test(dv.formulae[0]), `formula phải tham chiếu cột ẩn, nhận: ${dv.formulae[0]}`);
  });

  run.summary();
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
