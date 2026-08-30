// tests/test-audit-fixes-batch2-zipbomb.js — Kiểm tra bản vá lỗ hổng DoS "zip bomb" ở 6 luồng import
// Excel (lib/priceFileParser.js, lib/trainingRoster.js, lib/budgetTemplateImport.js,
// lib/trainingPlanImport.js, lib/storeCatalogImport.js, lib/vppCatalog.js).
//
// Lỗ hổng cũ: cả 6 file gọi `await workbook.xlsx.load(buffer)` TRƯỚC rồi mới áp giới hạn số dòng khi
// duyệt worksheet đã nạp xong -> 1 file .xlsx (thực chất là .zip) nhỏ vài trăm KB nhưng bung ra hàng GB
// làm hết RAM/PM2 restart worker. Bản vá (lib/xlsxSafeRead.js) đổi sang đọc theo DÒNG bằng
// ExcelJS.stream.xlsx.WorkbookReader + chặn trần dung lượng sau giải nén của cả archive.
//
// File test này KHÔNG cần trình duyệt (không dùng setup()/Playwright của _harness.js, chỉ mượn
// makeRunner/assert/assertEqual) — toàn bộ kịch bản chạy thẳng trên buffer trong bộ nhớ.
//
// 3 nhóm kịch bản:
//   (a) file hợp lệ, kích thước bình thường -> đọc ra ĐÚNG dữ liệu như trước bản vá (không đổi hành vi);
//   (b) file hợp lệ nhưng VƯỢT trần số dòng của từng luồng -> vẫn đúng hành vi cũ của CHÍNH luồng đó
//       (ném lỗi, hay âm thầm cắt bớt), chỉ khác là trần được chặn NGAY trong lúc đọc;
//   (c) archive bung ra vượt trần dung lượng -> bị từ chối bằng lỗi 400 rõ ràng, không nạp vào bộ nhớ.
//
// Run: node server/tests/test-audit-fixes-batch2-zipbomb.js
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const { makeRunner, assert, assertEqual } = require('./_harness');

const { parsePriceFile, parsePriceTemplateColumns } = require('../lib/priceFileParser');
const { parseRosterFile } = require('../lib/trainingRoster');
const { parseStoreFile } = require('../lib/storeCatalogImport');
const { parseCatalogFile } = require('../lib/vppCatalog');
const { parsePlanImportFile } = require('../lib/trainingPlanImport');
const { parseBudgetTemplateFieldsExcelBuffer, parseArbitraryColumnLabels } = require('../lib/budgetTemplateImport');
const { MAX_UNCOMPRESSED_BYTES } = require('../lib/xlsxSafeRead');

// ---------------------------------------------------------------------------------------------
// Tiện ích dựng file .xlsx THẬT trong bộ nhớ bằng chính bộ ghi của exceljs.
// useSharedStrings: bảng sharedStrings là cách Excel thật lưu ô kiểu chuỗi — phải test cả nhánh này vì
// bộ đọc streaming tra cứu nội dung ô qua bảng đó (khác nhánh inlineStr mặc định của exceljs).
async function buildXlsx(rows, { useSharedStrings = false, sheetName = 'Sheet1', extraSheet = false } = {}) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet(sheetName);
  rows.forEach((r) => sheet.addRow(r));
  if (extraSheet) wb.addWorksheet('Ghi Chú').addRow(['ghi chú không được đọc']);
  return Buffer.from(await wb.xlsx.writeBuffer({ useSharedStrings }));
}

async function expectError(fn, needle, label) {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert(err, `${label}: expected an error, got none`);
  assert(String(err.message).includes(needle),
    `${label}: expected error containing "${needle}", got: ${err.message}`);
  assertEqual(err.status, 400, `${label}: error should be a 400`);
}

// ---------------------------------------------------------------------------------------------
async function main() {
  const { run, summarize } = makeRunner();

  // ===================== (a) File hợp lệ đọc ra ĐÚNG như trước =====================

  await run('[vppCatalog] file danh mục bình thường đọc ra đúng mã/tên/ĐVT/xuất xứ/quy cách/đơn giá', async () => {
    const buf = await buildXlsx([
      ['Mã Hàng', 'Tên Mặt Hàng', 'Đơn Vị Tính', 'Xuất Xứ', 'Quy Cách', 'ĐƠN GIÁ\nCHƯA VAT'],
      ['MH01', 'Bút bi xanh', 'Cây', 'Việt Nam', 'Hộp 20', '15.000'],
      ['MH02', 'Giấy A4', 'Ream', 'Indonesia', 'Thùng 5', '75.500'],
      ['MH03', 'BÚT BI XANH', 'Cây', '', '', '9.000'] // trùng tên (bỏ dấu/hoa-thường) -> bỏ qua
    ]);
    const items = await parseCatalogFile(buf, '.xlsx');
    assertEqual(items.length, 2, 'duplicate item name should be dropped exactly as before');
    assertEqual(items[0].code, 'MH01', 'code mismatch');
    assertEqual(items[0].name, 'Bút bi xanh', 'name mismatch');
    assertEqual(items[0].unit, 'Cây', 'unit mismatch');
    assertEqual(items[0].origin, 'Việt Nam', 'origin mismatch');
    assertEqual(items[0].spec, 'Hộp 20', 'spec mismatch');
    assertEqual(items[0].price, 15000, 'VNĐ thousands-separator price parsing must be unchanged');
    assertEqual(items[1].price, 75500, 'price mismatch on row 2');
  });

  await run('[vppCatalog] bảng sharedStrings (cách Excel thật lưu ô chuỗi) đọc ra đúng nội dung', async () => {
    const buf = await buildXlsx([
      ['Tên Mặt Hàng', 'Đơn Vị Tính'],
      ['Bút bi xanh', 'Cây'],
      ['Giấy A4', 'Ream']
    ], { useSharedStrings: true });
    const items = await parseCatalogFile(buf, '.xlsx');
    assertEqual(items.length, 2, 'row count mismatch');
    assertEqual(items[0].name, 'Bút bi xanh', 'shared-string cell must resolve to its real text');
    assertEqual(items[1].unit, 'Ream', 'shared-string cell must resolve to its real text');
  });

  await run('[vppCatalog] file không có dòng tiêu đề vẫn đọc theo vị trí cột (cột 1 = tên, cột 2 = ĐVT)', async () => {
    const buf = await buildXlsx([['Bút bi xanh', 'Cây'], ['Giấy A4', 'Ream']]);
    const items = await parseCatalogFile(buf, '.xlsx');
    assertEqual(items.length, 2, 'header-less file must treat row 1 as data, as before');
    assertEqual(items[0].name, 'Bút bi xanh', 'name mismatch');
    assertEqual(items[0].unit, 'Cây', 'unit mismatch');
  });

  await run('[trainingRoster] danh sách học viên đọc đúng, bỏ trùng và bỏ dòng trống', async () => {
    const buf = await buildXlsx([
      ['Tài Khoản Đăng Nhập', 'Họ Tên (chỉ để tham khảo)'],
      ['nv1', 'Một'], ['nv2', 'Hai'], ['', ''], ['nv1', 'Trùng']
    ]);
    const usernames = await parseRosterFile(buf, '.xlsx');
    assertEqual(JSON.stringify(usernames), JSON.stringify(['nv1', 'nv2']), 'roster parsing changed');
  });

  await run('[storeCatalogImport] danh sách siêu thị đọc đúng, bỏ trùng', async () => {
    const buf = await buildXlsx([['Tên Siêu Thị'], ['Siêu Thị Q1'], ['Siêu Thị Q3'], ['Siêu Thị Q1']]);
    const names = await parseStoreFile(buf, '.xlsx');
    assertEqual(JSON.stringify(names), JSON.stringify(['Siêu Thị Q1', 'Siêu Thị Q3']), 'store parsing changed');
  });

  await run('[trainingPlanImport] ô Tháng kiểu Date THẬT vẫn đọc ra "YYYY-MM" (giá trị ô không bị ép chuỗi sớm)', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Kế Hoạch Đào Tạo');
    sheet.addRow(['Tháng (YYYY-MM)', 'Chương Trình', 'Đơn Vị', 'Đối Tượng', 'Số Lớp', 'Số Học Viên', 'Thời Lượng (giờ)']);
    const r = sheet.addRow([new Date(2026, 8, 1), 'Kỹ năng bán hàng cơ bản', 'Phòng Kinh Doanh', 'Nhân viên mới', 2, 40, 16]);
    r.getCell(1).numFmt = 'yyyy-mm-dd'; // ô định dạng ngày -> exceljs trả về Date, cần styles để nhận ra
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const items = await parsePlanImportFile(buf, '.xlsx', [{ id: 42, name: 'KỸ NĂNG BÁN HÀNG CƠ BẢN' }]);
    assertEqual(items.length, 1, 'row count mismatch');
    assertEqual(items[0].month, '2026-09', 'a real Date cell must still be read as YYYY-MM');
    assertEqual(items[0].monthValid, true, 'month should be valid');
    assertEqual(items[0].courseId, 42, 'course fuzzy-match must be unchanged');
    assertEqual(items[0].plannedClasses, 2, 'plannedClasses mismatch');
    assertEqual(items[0].plannedHours, 16, 'plannedHours mismatch');
  });

  await run('[trainingPlanImport] mẫu tải xuống (2 sheet) chỉ đọc sheet đầu, bỏ qua sheet "Ghi Chú"', async () => {
    const { buildPlanImportTemplateWorkbook } = require('../lib/trainingPlanImport');
    const wb = await buildPlanImportTemplateWorkbook();
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const items = await parsePlanImportFile(buf, '.xlsx', []);
    assertEqual(items.length, 1, 'only the data sheet may be read, the note sheet must be ignored');
    assertEqual(items[0].month, '2026-09', 'template month mismatch');
  });

  await run('[priceFileParser] khớp cột theo Mẫu Giá, đọc nguyên văn giá trị từng ô', async () => {
    const template = { columns: [{ key: 'k1', label: 'Tên mặt hàng' }, { key: 'k2', label: 'Đơn giá' }] };
    const buf = await buildXlsx([['ĐƠN GIÁ', 'TÊN MẶT HÀNG'], ['15.000', 'Bút bi'], ['', ''], ['9.000', 'Giấy A4']]);
    const { items, columnLabels } = await parsePriceFile(buf, template);
    assertEqual(items.length, 2, 'blank rows must still be skipped');
    assertEqual(items[0].values.k1, 'Bút bi', 'column re-mapping by header name must be unchanged');
    assertEqual(items[0].values.k2, '15.000', 'cell text must stay verbatim');
    assertEqual(columnLabels.length, 2, 'columnLabels mismatch');
  });

  await run('[priceFileParser] file không khớp Mẫu Giá bị từ chối ngay ở dòng tiêu đề', async () => {
    const template = { columns: [{ key: 'k1', label: 'Tên mặt hàng' }, { key: 'k2', label: 'Đơn giá' }] };
    const buf = await buildXlsx([['Tên mặt hàng', 'Cột lạ'], ['Bút bi', 'x']]);
    await expectError(() => parsePriceFile(buf, template), 'chưa khớp đúng cột', 'price header mismatch');
  });

  await run('[priceFileParser] Mẫu Giá chỉ lấy dòng tiêu đề, không đọc dữ liệu bên dưới', async () => {
    const buf = await buildXlsx([['Mã hàng', 'Tên mặt hàng', 'Đơn giá'], ['MH01', 'Bút bi', '15.000']]);
    const columns = await parsePriceTemplateColumns(buf);
    assertEqual(columns.length, 3, 'template column count mismatch');
    assertEqual(columns[1].label, 'Tên mặt hàng', 'template column label mismatch');
    assertEqual(columns[1].key, 'c1', 'template column key is positional and must not change');
  });

  await run('[budgetTemplateImport] đọc cột tuỳ biến và DỪNG đúng ở dòng trống trước dòng ghi chú', async () => {
    const { buildBudgetTemplateFieldsWorkbook } = require('../lib/budgetTemplateImport');
    const wb = await buildBudgetTemplateFieldsWorkbook();
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const fields = await parseBudgetTemplateFieldsExcelBuffer(buf);
    assertEqual(fields.length, 3, 'must stop at the blank row, never read the trailing note row as a column');
    assertEqual(fields[0].label, 'Nhà cung cấp', 'field label mismatch');
    assertEqual(fields[2].type, 'select', 'field type mismatch');
    assertEqual(JSON.stringify(fields[2].options), JSON.stringify(['Chưa duyệt', 'Đã duyệt']), 'select options mismatch');
    assertEqual(fields[2].required, true, 'required flag mismatch');
  });

  await run('[budgetTemplateImport] "Từ File Dữ Liệu Thật" chỉ lấy tên cột ở ĐÚNG dòng 1', async () => {
    const buf = await buildXlsx([['Tên Hạng Mục', 'Số Tiền', 'Ghi Chú'], ['Mua máy in', 5000000, 'x']]);
    const labels = await parseArbitraryColumnLabels(buf);
    assertEqual(JSON.stringify(labels), JSON.stringify(['Tên Hạng Mục', 'Số Tiền', 'Ghi Chú']), 'header labels mismatch');
  });

  await run('[budgetTemplateImport] dòng 1 trống -> báo đúng lỗi "dòng 1 trống" dù dữ liệu nằm ở dòng dưới', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('S');
    sheet.getRow(3).values = ['Tên Hạng Mục', 'Số Tiền'];
    sheet.getRow(3).commit();
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expectError(() => parseArbitraryColumnLabels(buf), 'dòng 1 trống', 'empty first row');
  });

  await run('[xlsxSafeRead] xlsx sắp xếp entry theo thứ tự của Excel thật (sharedStrings trước sheet) vẫn đọc đúng', async () => {
    // Excel/LibreOffice không xếp entry giống bộ ghi của exceljs; đóng gói lại theo thứ tự khác để chắc
    // chắn bộ đọc streaming không phụ thuộc thứ tự entry trong file zip.
    const original = await buildXlsx([
      ['Tên Mặt Hàng', 'Đơn Vị Tính'], ['Bút bi xanh', 'Cây'], ['Giấy A4', 'Ream']
    ], { useSharedStrings: true });
    const src = await JSZip.loadAsync(original);
    const names = Object.keys(src.files).filter((n) => !src.files[n].dir);
    const order = (n) => {
      if (n === '[Content_Types].xml') return 0;
      if (n === '_rels/.rels') return 1;
      if (n === 'xl/workbook.xml') return 2;
      if (n === 'xl/_rels/workbook.xml.rels') return 3;
      if (n === 'xl/styles.xml') return 4;
      if (n === 'xl/sharedStrings.xml') return 5; // cố tình đặt TRƯỚC sheet1.xml
      if (n.startsWith('xl/worksheets/')) return 6;
      return 7;
    };
    const repacked = new JSZip();
    for (const n of names.sort((a, b) => order(a) - order(b))) {
      repacked.file(n, await src.file(n).async('nodebuffer'));
    }
    const buf = await repacked.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const items = await parseCatalogFile(buf, '.xlsx');
    assertEqual(items.length, 2, 'row count mismatch after repacking the archive in Excel-like entry order');
    assertEqual(items[0].name, 'Bút bi xanh', 'cell text mismatch after repacking');
    assertEqual(items[1].unit, 'Ream', 'cell text mismatch after repacking');
  });

  // ===================== (b) Trần số dòng chặn ĐÚNG như trước, nhưng chặn trong lúc đọc =====================

  await run('[vppCatalog] đúng 2000 mặt hàng vẫn đọc được, 2050 mặt hàng bị từ chối (tối đa 2000)', async () => {
    const header = ['Tên Mặt Hàng', 'Đơn Vị Tính'];
    const okRows = [header, ...Array.from({ length: 2000 }, (_, i) => [`Mặt hàng ${i}`, 'Cái'])];
    const items = await parseCatalogFile(await buildXlsx(okRows), '.xlsx');
    assertEqual(items.length, 2000, 'exactly-at-cap file must still parse fully');
    assertEqual(items[1999].name, 'Mặt hàng 1999', 'last row content mismatch');

    const tooMany = [header, ...Array.from({ length: 2050 }, (_, i) => [`Mặt hàng ${i}`, 'Cái'])];
    const tooManyBuf = await buildXlsx(tooMany);
    await expectError(() => parseCatalogFile(tooManyBuf, '.xlsx'), 'tối đa 2000 mặt hàng', 'vpp cap');
  });

  await run('[trainingRoster] đúng 500 học viên đọc được, 550 học viên bị từ chối (tối đa 500)', async () => {
    const header = ['Tài Khoản Đăng Nhập'];
    const ok = [header, ...Array.from({ length: 500 }, (_, i) => [`nv${i}`])];
    const usernames = await parseRosterFile(await buildXlsx(ok), '.xlsx');
    assertEqual(usernames.length, 500, 'exactly-at-cap roster must still parse fully');
    assertEqual(usernames[499], 'nv499', 'last username mismatch');

    const tooMany = [header, ...Array.from({ length: 550 }, (_, i) => [`nv${i}`])];
    const tooManyBuf = await buildXlsx(tooMany);
    await expectError(() => parseRosterFile(tooManyBuf, '.xlsx'), 'tối đa 500 học viên', 'roster cap');
  });

  await run('[storeCatalogImport] đúng 500 siêu thị đọc được, 550 siêu thị bị từ chối (tối đa 500)', async () => {
    const header = ['Tên Siêu Thị'];
    const ok = [header, ...Array.from({ length: 500 }, (_, i) => [`Siêu Thị ${i}`])];
    const names = await parseStoreFile(await buildXlsx(ok), '.xlsx');
    assertEqual(names.length, 500, 'exactly-at-cap store list must still parse fully');

    const tooMany = [header, ...Array.from({ length: 550 }, (_, i) => [`Siêu Thị ${i}`])];
    const tooManyBuf = await buildXlsx(tooMany);
    await expectError(() => parseStoreFile(tooManyBuf, '.xlsx'), 'tối đa 500 siêu thị', 'store cap');
  });

  await run('[trainingPlanImport] đúng 500 dòng kế hoạch đọc được, 550 dòng bị từ chối (tối đa 500)', async () => {
    const header = ['Tháng (YYYY-MM)', 'Chương Trình', 'Đơn Vị'];
    const ok = [header, ...Array.from({ length: 500 }, () => ['2026-09', 'Khoá A', 'Phòng CNTT'])];
    const items = await parsePlanImportFile(await buildXlsx(ok), '.xlsx', []);
    assertEqual(items.length, 500, 'exactly-at-cap plan file must still parse fully');

    const tooMany = [header, ...Array.from({ length: 550 }, () => ['2026-09', 'Khoá A', 'Phòng CNTT'])];
    const tooManyBuf = await buildXlsx(tooMany);
    await expectError(() => parsePlanImportFile(tooManyBuf, '.xlsx', []), 'tối đa 500 dòng kế hoạch', 'plan cap');
  });

  await run('[priceFileParser] đúng 1000 dòng giá đọc được, 1050 dòng bị từ chối (tối đa 1000)', async () => {
    const header = ['Tên mặt hàng', 'Đơn giá'];
    const ok = [header, ...Array.from({ length: 1000 }, (_, i) => [`Hàng ${i}`, '1.000'])];
    const { items } = await parsePriceFile(await buildXlsx(ok), null);
    assertEqual(items.length, 1000, 'exactly-at-cap price file must still parse fully');
    assertEqual(items[999].values.c0, 'Hàng 999', 'last row content mismatch');

    const tooMany = [header, ...Array.from({ length: 1050 }, (_, i) => [`Hàng ${i}`, '1.000'])];
    const tooManyBuf = await buildXlsx(tooMany);
    await expectError(() => parsePriceFile(tooManyBuf, null), 'tối đa 1000 dòng', 'price cap');
  });

  await run('[budgetTemplateImport] quá 30 cột tuỳ biến vẫn ÂM THẦM cắt còn 30 (không ném lỗi, đúng như cũ)', async () => {
    const rows = [['Tên Cột', 'Kiểu Dữ Liệu', 'Bắt Buộc', 'Danh Sách Chọn'],
      ...Array.from({ length: 35 }, (_, i) => [`Cột ${i}`, 'text', 'khong', ''])];
    const fields = await parseBudgetTemplateFieldsExcelBuffer(await buildXlsx(rows));
    assertEqual(fields.length, 30, 'over-cap custom fields must be truncated to 30, not rejected');
    assertEqual(fields[29].label, 'Cột 29', 'truncation must keep the first 30 rows in order');
  });

  // ===================== (c) Trần dung lượng sau giải nén =====================

  await run('[xlsxSafeRead] archive bung ra vượt trần bị từ chối nhanh, không nạp vào bộ nhớ', async () => {
    // Lấy 1 file .xlsx HỢP LỆ rồi nhét thêm 1 entry nén cực tốt (40MB toàn ký tự giống nhau -> vài chục
    // KB sau khi nén). Đây chính là hình dạng của 1 "zip bomb" thật, chỉ khác là cỡ vừa đủ vượt trần
    // (không cần dựng bomb hàng GB mới chứng minh được chốt chặn hoạt động).
    const base = await buildXlsx([['Tên Mặt Hàng', 'Đơn Vị Tính'], ['Bút bi xanh', 'Cây']]);
    const zip = await JSZip.loadAsync(base);
    const oversized = MAX_UNCOMPRESSED_BYTES + 8 * 1024 * 1024;
    zip.file('xl/media/padding.bin', Buffer.alloc(oversized, 0x41));
    const bomb = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
    assert(bomb.length < 1024 * 1024, `crafted file should stay small once compressed, got ${bomb.length} bytes`);

    const heapBefore = process.memoryUsage().heapUsed;
    const startedAt = Date.now();
    await expectError(() => parseCatalogFile(bomb, '.xlsx'), 'giải nén ra quá lớn', 'decompression budget');
    const heapDeltaMB = (process.memoryUsage().heapUsed - heapBefore) / (1024 * 1024);
    const elapsed = Date.now() - startedAt;
    assert(heapDeltaMB < 32, `rejecting the file must not materialise it in memory (heap grew ${heapDeltaMB.toFixed(1)}MB)`);
    assert(elapsed < 15000, `rejection should be prompt, took ${elapsed}ms`);
  });

  await run('[xlsxSafeRead] tệp không phải .xlsx (không giải nén được) báo lỗi 400 rõ ràng, không sập', async () => {
    await expectError(() => parseCatalogFile(Buffer.from('khong-phai-zip'), '.xlsx'),
      'Không đọc được file Excel', 'non-zip input');
  });

  summarize('test-audit-fixes-batch2-zipbomb');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
