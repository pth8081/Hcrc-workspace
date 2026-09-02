// server/tests/test-orgchart-excel-import.js
//
// Regression test cho tính năng Xuất/Nhập Excel Cơ Cấu Tổ Chức (lib/orgChartImport.js):
//   - Dò cột theo tiêu đề (username/managerUsername) bất kể vị trí, không phân biệt hoa-thường/dấu.
//   - Rơi về vị trí cột mặc định (1, 5) khi không dò được tiêu đề (file không có header).
//   - Bỏ qua dòng thiếu username, dòng trùng username (giữ lần xuất hiện đầu).
//   - Chặn file trống, file vượt trần số dòng.
//
// Chạy: node server/tests/test-orgchart-excel-import.js
const ExcelJS = require('exceljs');
const { createRunner, assert, assertEqual } = require('./testHarness');
const { parseOrgChartImportXlsx } = require('../lib/orgChartImport');

const run = createRunner();

async function buildXlsx(columns, rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  if (columns) sheet.columns = columns.map(c => ({ header: c, key: c }));
  rows.forEach(r => sheet.addRow(r));
  return wb.xlsx.writeBuffer();
}

async function main() {

await run.run('Dò cột theo tiêu đề (username/managerUsername) đúng dù có xen thêm cột tham khảo khác', async () => {
  const buf = await buildXlsx(
    ['username', 'name', 'dept', 'jobTitle', 'managerUsername', 'managerName'],
    [
      { username: 'staff1', name: 'A', dept: 'D1', jobTitle: '', managerUsername: 'ceo', managerName: 'CEO' },
      { username: 'staff2', name: 'B', dept: 'D2', jobTitle: '', managerUsername: '', managerName: '' }
    ]
  );
  const rows = await parseOrgChartImportXlsx(buf);
  assertEqual(rows.length, 2, 'phải đọc đúng 2 dòng');
  assertEqual(rows[0].username, 'staff1');
  assertEqual(rows[0].managerUsername, 'ceo');
  assertEqual(rows[1].username, 'staff2');
  assertEqual(rows[1].managerUsername, '', 'managerUsername trống -> chuỗi rỗng (client hiểu là bỏ quản lý)');
});

await run.run('Tiêu đề tiếng Việt có dấu ("Username Quản Lý Trực Tiếp") vẫn dò đúng cột', async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.addRow(['Username', 'Họ Tên', 'Username Quản Lý Trực Tiếp']);
  sheet.addRow(['staff1', 'Lê Văn A', 'ceo']);
  const buf = await wb.xlsx.writeBuffer();
  const rows = await parseOrgChartImportXlsx(buf);
  assertEqual(rows.length, 1);
  assertEqual(rows[0].username, 'staff1');
  assertEqual(rows[0].managerUsername, 'ceo');
});

await run.run('Không dò được tiêu đề (file không có header) -> rơi về vị trí mặc định cột 1/cột 5', async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  // 6 cột đúng thứ tự mẫu (username, name, dept, jobTitle, managerUsername, managerName), KHÔNG có dòng tiêu đề
  sheet.addRow(['staff1', 'Lê Văn A', 'Kế Toán', '', 'ceo', 'CEO']);
  const buf = await wb.xlsx.writeBuffer();
  const rows = await parseOrgChartImportXlsx(buf);
  assertEqual(rows.length, 1);
  assertEqual(rows[0].username, 'staff1');
  assertEqual(rows[0].managerUsername, 'ceo');
});

await run.run('Bỏ qua dòng thiếu username', async () => {
  const buf = await buildXlsx(
    ['username', 'managerUsername'],
    [
      { username: '', managerUsername: 'ceo' },
      { username: 'staff1', managerUsername: 'ceo' }
    ]
  );
  const rows = await parseOrgChartImportXlsx(buf);
  assertEqual(rows.length, 1, 'chỉ giữ dòng có username');
  assertEqual(rows[0].username, 'staff1');
});

await run.run('Trùng username -> chỉ giữ lần xuất hiện ĐẦU TIÊN', async () => {
  const buf = await buildXlsx(
    ['username', 'managerUsername'],
    [
      { username: 'staff1', managerUsername: 'ceo' },
      { username: 'staff1', managerUsername: 'someone_else' }
    ]
  );
  const rows = await parseOrgChartImportXlsx(buf);
  assertEqual(rows.length, 1, 'phải loại bỏ dòng trùng username');
  assertEqual(rows[0].managerUsername, 'ceo', 'giữ giá trị của lần xuất hiện đầu tiên');
});

await run.run('File chỉ có dòng tiêu đề, không có dữ liệu -> báo lỗi rõ ràng', async () => {
  // sheet.columns đã tự ghi ra 1 dòng tiêu đề thật trong file -> đây là trường hợp "có header nhưng 0
  // dòng dữ liệu" (rows.length === 0 sau khi đọc), KHÔNG phải trường hợp sheet trống tuyệt đối.
  const buf = await buildXlsx(['username', 'managerUsername'], []);
  let threw = false;
  try { await parseOrgChartImportXlsx(buf); } catch (e) { threw = true; assert(/không đọc được tài khoản/i.test(e.message), 'thông báo lỗi phải nêu rõ không có tài khoản hợp lệ'); }
  assert(threw, 'phải ném lỗi khi file không có dữ liệu');
});

await run.run('File trống tuyệt đối (không cả dòng tiêu đề) -> báo lỗi rõ ràng', async () => {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Sheet1'); // không addRow gì cả
  const buf = await wb.xlsx.writeBuffer();
  let threw = false;
  try { await parseOrgChartImportXlsx(buf); } catch (e) { threw = true; assert(/trống/.test(e.message), 'thông báo lỗi phải nêu rõ file trống'); }
  assert(threw, 'phải ném lỗi khi sheet không có dòng nào');
});

await run.run('Vượt trần số dòng (>5000) -> báo lỗi, không đọc hết', async () => {
  const rows = [];
  for (let i = 0; i < 5010; i++) rows.push({ username: `u${i}`, managerUsername: '' });
  const buf = await buildXlsx(['username', 'managerUsername'], rows);
  let threw = false;
  try { await parseOrgChartImportXlsx(buf); } catch (e) { threw = true; assert(/quá nhiều dòng/.test(e.message), 'thông báo lỗi phải nêu rõ vượt trần'); }
  assert(threw, 'phải ném lỗi khi vượt trần 5000 dòng');
});

}

main().then(() => run.summary()).catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
