// tests/test-perm-matrix-multisheet.js — Test THUẦN NODE cho phần "1 module = 1 sheet" của Ma Trận Phân
// Quyền (10/2026, yêu cầu người dùng trực tiếp): lib/permMatrixExcel.js::parseGenericMultiSheetMatrixXlsx()
// (đọc + GỘP nhiều sheet lại thành đúng 1 object/định danh) và lib/adminExport.js::buildMultiSheetWorkbook()
// (dựng workbook nhiều sheet, có sanitize tên sheet). Không cần SQL Server/Playwright.
//
// Chạy: node server/tests/test-perm-matrix-multisheet.js
const assert = require('assert');
const ExcelJS = require('exceljs');

const { parseGenericMultiSheetMatrixXlsx, MAX_MATRIX_IMPORT_ROWS } = require('../lib/permMatrixExcel');
const { buildMultiSheetWorkbook } = require('../lib/adminExport');

let passed = 0, failed = 0;
async function run(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`);
  }
}

async function buildXlsxSheets(sheets) {
  const wb = new ExcelJS.Workbook();
  sheets.forEach(({ name, rows }) => {
    const sheet = wb.addWorksheet(name);
    rows.forEach(r => sheet.addRow(r));
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function main() {
  await run('Tương thích ngược: file 1 sheet (bản cũ) đọc ra kết quả giống hệt parseGenericMatrixXlsx()', async () => {
    const buf = await buildXlsxSheets([
      { name: 'Người Dùng', rows: [
        ['Username', 'HoTen', 'Q_admin'],
        ['nv01', 'Nguyễn Văn A', 'TRUE'],
        ['nv02', 'Trần Thị B', 'FALSE'],
      ] },
    ]);
    const rows = await parseGenericMultiSheetMatrixXlsx(buf);
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[0], { Username: 'nv01', HoTen: 'Nguyễn Văn A', Q_admin: 'TRUE', duplicateInFile: false, duplicateExisting: false });
    assert.strictEqual(rows[1].Username, 'nv02');
    assert.strictEqual(rows[1].Q_admin, 'FALSE');
  });

  await run('GỘP đúng 2 sheet: mỗi sheet đóng góp cột quyền riêng, ra 1 dòng/định danh có ĐỦ cả 2 cột', async () => {
    const buf = await buildXlsxSheets([
      { name: 'Hệ Thống & Chung', rows: [
        ['Username', 'HoTen', 'Q_admin'],
        ['nv01', 'Nguyễn Văn A', 'TRUE'],
        ['nv02', 'Trần Thị B', 'FALSE'],
      ] },
      { name: 'Hợp Đồng & Giấy Phép', rows: [
        ['Username', 'HoTen', 'Q_contractApprove'],
        ['nv01', 'Nguyễn Văn A', 'FALSE'],
        ['nv02', 'Trần Thị B', 'TRUE'],
      ] },
    ]);
    const rows = await parseGenericMultiSheetMatrixXlsx(buf);
    assert.strictEqual(rows.length, 2, 'gộp theo định danh -> chỉ 2 dòng (2 người), không phải 4');
    const nv01 = rows.find(r => r.Username === 'nv01');
    const nv02 = rows.find(r => r.Username === 'nv02');
    assert.deepStrictEqual(
      { admin: nv01.Q_admin, contractApprove: nv01.Q_contractApprove },
      { admin: 'TRUE', contractApprove: 'FALSE' },
      'nv01 phải có ĐỦ cả 2 cột quyền dù đến từ 2 sheet khác nhau'
    );
    assert.deepStrictEqual(
      { admin: nv02.Q_admin, contractApprove: nv02.Q_contractApprove },
      { admin: 'FALSE', contractApprove: 'TRUE' }
    );
  });

  await run('Cột định danh mô tả (HoTen) lặp lại giống hệt nhau ở mọi sheet -> vẫn giữ đúng giá trị sau gộp', async () => {
    const buf = await buildXlsxSheets([
      { name: 'Sheet A', rows: [['Username', 'HoTen', 'Q_a'], ['nv01', 'Nguyễn Văn A', 'TRUE']] },
      { name: 'Sheet B', rows: [['Username', 'HoTen', 'Q_b'], ['nv01', 'Nguyễn Văn A', 'FALSE']] },
    ]);
    const rows = await parseGenericMultiSheetMatrixXlsx(buf);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].HoTen, 'Nguyễn Văn A');
  });

  await run('CÙNG định danh xuất hiện ở NHIỀU SHEET KHÁC NHAU -> KHÔNG bị đánh dấu duplicateInFile (đúng thiết kế, không phải lỗi)', async () => {
    const buf = await buildXlsxSheets([
      { name: 'Sheet A', rows: [['Username', 'Q_a'], ['nv01', 'TRUE']] },
      { name: 'Sheet B', rows: [['Username', 'Q_b'], ['nv01', 'TRUE']] },
      { name: 'Sheet C', rows: [['Username', 'Q_c'], ['nv01', 'TRUE']] },
    ]);
    const rows = await parseGenericMultiSheetMatrixXlsx(buf);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].duplicateInFile, false, 'nv01 xuất hiện ở 3 sheet khác nhau — đây là THIẾT KẾ (mỗi sheet 1 khối quyền), không phải trùng lặp lỗi');
  });

  await run('CÙNG định danh xuất hiện 2 LẦN TRONG CÙNG 1 SHEET -> đánh dấu duplicateInFile=true (lỗi thật, VD dán nhầm trùng dòng)', async () => {
    const buf = await buildXlsxSheets([
      { name: 'Sheet A', rows: [['Username', 'Q_a'], ['nv01', 'TRUE'], ['nv01', 'FALSE']] },
      { name: 'Sheet B', rows: [['Username', 'Q_b'], ['nv01', 'TRUE']] },
    ]);
    const rows = await parseGenericMultiSheetMatrixXlsx(buf);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].duplicateInFile, true, 'nv01 lặp 2 lần trong CHÍNH Sheet A -> phải bị đánh dấu trùng, để client chặn không cho áp dụng nhầm');
  });

  await run(`Trần số dòng đếm theo ĐỊNH DANH riêng biệt (không nhân theo số sheet) -> vượt quá ${MAX_MATRIX_IMPORT_ROWS} vẫn bị từ chối 400`, async () => {
    const header = ['Username', 'Q_a'];
    const dataRows = Array.from({ length: MAX_MATRIX_IMPORT_ROWS + 5 }, (_, i) => [`nv${i}`, 'TRUE']);
    const buf = await buildXlsxSheets([{ name: 'Sheet A', rows: [header, ...dataRows] }]);
    let err = null;
    try { await parseGenericMultiSheetMatrixXlsx(buf); } catch (e) { err = e; }
    assert.ok(err, 'phải ném lỗi khi vượt trần số dòng');
    assert.strictEqual(err.status, 400);
    assert.ok(/quá nhiều dòng/.test(err.message), `thông báo lỗi bất ngờ: ${err.message}`);
  });

  await run('Cùng 1 định danh lặp lại nhiều sheet KHÔNG bị tính nhiều lần vào trần số dòng (200 định danh x 5 sheet vẫn qua)', async () => {
    const rowsPerSheet = 200; // dưới trần, lặp ở nhiều sheet không được cộng dồn
    const header = ['Username', 'Q_x'];
    const dataRows = Array.from({ length: rowsPerSheet }, (_, i) => [`nv${i}`, 'TRUE']);
    const sheets = Array.from({ length: 5 }, (_, i) => ({ name: `Sheet ${i}`, rows: [header, ...dataRows] }));
    const buf = await buildXlsxSheets(sheets);
    const rows = await parseGenericMultiSheetMatrixXlsx(buf);
    assert.strictEqual(rows.length, rowsPerSheet, 'gộp theo định danh -> đúng 200 dòng, không phải 1000');
  });

  // ===== buildMultiSheetWorkbook() — sanitize tên sheet =====
  await run('buildMultiSheetWorkbook(): thay ký tự Excel cấm ("/") trong tên sheet, không ném lỗi', async () => {
    const wb = buildMultiSheetWorkbook([
      { sheetName: 'Văn Phòng (Mua/Sửa)', columns: [{ header: 'Username', key: 'Username', width: 16 }], rows: [{ Username: 'nv01' }] },
    ]);
    const names = wb.worksheets.map(s => s.name);
    assert.strictEqual(names.length, 1);
    assert.ok(!/[\\/?*[\]:]/.test(names[0]), `tên sheet vẫn còn ký tự cấm: "${names[0]}"`);
    assert.ok(names[0].includes('Văn Phòng'), `mất hẳn nội dung tên gốc: "${names[0]}"`);
  });

  await run('buildMultiSheetWorkbook(): 2 sheet trùng tên sau khi cắt 31 ký tự -> tự thêm hậu tố, không throw', async () => {
    const longBase = 'A'.repeat(40);
    const wb = buildMultiSheetWorkbook([
      { sheetName: longBase + '_X', columns: [{ header: 'Username', key: 'Username', width: 16 }], rows: [] },
      { sheetName: longBase + '_Y', columns: [{ header: 'Username', key: 'Username', width: 16 }], rows: [] },
    ]);
    const names = wb.worksheets.map(s => s.name);
    assert.strictEqual(names.length, 2);
    assert.notStrictEqual(names[0], names[1], 'phải khác tên nhau dù bị cắt còn cùng 31 ký tự đầu');
    names.forEach(n => assert.ok(n.length <= 31, `tên sheet "${n}" vượt quá 31 ký tự`));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Lỗi không mong muốn:', err);
  process.exit(1);
});
