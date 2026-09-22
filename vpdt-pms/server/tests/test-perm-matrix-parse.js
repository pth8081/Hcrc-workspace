// tests/test-perm-matrix-parse.js — Test THUẦN NODE cho lib/permMatrixExcel.js (đọc file Excel "Ma Trận
// Phân Quyền" admin tải lên) — phần server-side của tính năng Ma Trận Phân Quyền (10/2026, xem
// module-admin-permgroups.js cho phần client). Không cần SQL Server/Playwright — hàm chỉ đọc buffer
// Excel thuần, không đụng DB.
//
// Chạy: node server/tests/test-perm-matrix-parse.js
const assert = require('assert');
const ExcelJS = require('exceljs');

const { parseGenericMatrixXlsx, MAX_MATRIX_IMPORT_ROWS } = require('../lib/permMatrixExcel');

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

async function buildXlsx(rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  rows.forEach(r => sheet.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function main() {
  await run('đọc đúng header động + dữ liệu theo tên cột (không hard-code khoá quyền nào)', async () => {
    const buf = await buildXlsx([
      ['Username', 'HoTen', 'NhomPhanQuyen', 'BaoCao_MucBoSung', 'Q_admin', 'Q_moduleAccess.hanhchinh.car'],
      ['nv01', 'Nguyễn Văn A', 'Nhóm Kế Toán', 'HANHCHINH_CAR', 'FALSE', 'TRUE'],
      ['nv02', 'Trần Thị B', '', '', 'TRUE', 'FALSE'],
    ]);
    const rows = await parseGenericMatrixXlsx(buf);
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows[0], {
      Username: 'nv01', HoTen: 'Nguyễn Văn A', NhomPhanQuyen: 'Nhóm Kế Toán',
      BaoCao_MucBoSung: 'HANHCHINH_CAR', Q_admin: 'FALSE', 'Q_moduleAccess.hanhchinh.car': 'TRUE',
      duplicateInFile: false, duplicateExisting: false,
    });
    assert.strictEqual(rows[1].Username, 'nv02');
    assert.strictEqual(rows[1].Q_admin, 'TRUE');
  });

  await run('dòng thiếu khoá định danh ở cột đầu (Username/TenNhom rỗng) bị bỏ qua', async () => {
    const buf = await buildXlsx([
      ['Username', 'Q_admin'],
      ['nv01', 'TRUE'],
      ['', 'TRUE'], // thiếu username -> bỏ qua
      ['   ', 'TRUE'], // chỉ toàn khoảng trắng -> cũng coi là rỗng, bỏ qua
      ['nv03', 'FALSE'],
    ]);
    const rows = await parseGenericMatrixXlsx(buf);
    assert.strictEqual(rows.length, 2);
    assert.deepStrictEqual(rows.map(r => r.Username), ['nv01', 'nv03']);
  });

  await run('cột không có tiêu đề (thừa) bị bỏ qua, không lọt vào object dòng', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Sheet1');
    sheet.addRow(['Username', '', 'Q_admin']);
    sheet.addRow(['nv01', 'cột rác không tiêu đề', 'TRUE']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await parseGenericMatrixXlsx(buf);
    assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual(Object.keys(rows[0]).sort(), ['Q_admin', 'Username', 'duplicateInFile', 'duplicateExisting'].sort());
  });

  await run('trùng khoá định danh trong CÙNG 1 file được gắn cờ duplicateInFile (markDuplicateItems)', async () => {
    const buf = await buildXlsx([
      ['Username', 'Q_admin'],
      ['nv01', 'TRUE'],
      ['nv01', 'FALSE'], // trùng username với dòng trên
      ['nv02', 'TRUE'],
    ]);
    const rows = await parseGenericMatrixXlsx(buf);
    assert.strictEqual(rows.length, 3);
    assert.strictEqual(rows[0].duplicateInFile, false, 'dòng XUẤT HIỆN ĐẦU TIÊN không bị đánh dấu (chỉ dòng lặp lại SAU nó mới bị đánh dấu, khớp markDuplicateItems())');
    assert.strictEqual(rows[1].duplicateInFile, true, 'dòng lặp lại (nv01 lần 2) phải bị đánh dấu trùng');
    assert.strictEqual(rows[2].duplicateInFile, false);
  });

  await run('không có dòng tiêu đề hợp lệ (sheet rỗng) -> ném lỗi 400 rõ ràng', async () => {
    const buf = await buildXlsx([]);
    let err = null;
    try { await parseGenericMatrixXlsx(buf); } catch (e) { err = e; }
    assert.ok(err, 'phải ném lỗi');
    assert.strictEqual(err.status, 400);
    assert.ok(/không có dòng tiêu đề/.test(err.message), `thông báo lỗi bất ngờ: ${err.message}`);
  });

  await run(`vượt quá ${MAX_MATRIX_IMPORT_ROWS} dòng -> bị từ chối 400, không đọc hết vào RAM`, async () => {
    const header = ['Username', 'Q_admin'];
    const dataRows = Array.from({ length: MAX_MATRIX_IMPORT_ROWS + 5 }, (_, i) => [`nv${i}`, 'TRUE']);
    const buf = await buildXlsx([header, ...dataRows]);
    let err = null;
    try { await parseGenericMatrixXlsx(buf); } catch (e) { err = e; }
    assert.ok(err, 'phải ném lỗi khi vượt trần số dòng');
    assert.strictEqual(err.status, 400);
    assert.ok(/quá nhiều dòng/.test(err.message), `thông báo lỗi bất ngờ: ${err.message}`);
  });

  await run('chỉ đọc SHEET ĐẦU TIÊN — sheet thứ 2 bị bỏ qua hoàn toàn (khớp streamFirstSheetRows())', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet1 = wb.addWorksheet('Người Dùng');
    sheet1.addRow(['Username', 'Q_admin']);
    sheet1.addRow(['nv01', 'TRUE']);
    const sheet2 = wb.addWorksheet('Nhóm Phân Quyền');
    sheet2.addRow(['TenNhom', 'Q_admin']);
    sheet2.addRow(['Nhóm Lạ', 'TRUE']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await parseGenericMatrixXlsx(buf);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].Username, 'nv01');
    assert.ok(!('TenNhom' in rows[0]), 'không được lẫn dữ liệu từ sheet thứ 2');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Lỗi không mong muốn:', err);
  process.exit(1);
});
