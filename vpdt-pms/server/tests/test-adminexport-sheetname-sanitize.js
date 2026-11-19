// tests/test-adminexport-sheetname-sanitize.js — LỖI THẬT đã vá (10/2026, người dùng báo "Xuất Excel
// Danh Sách Chức Danh (Khối VP/HO)" hiện "Không thể tạo file Excel"): buildGenericWorkbook()
// (lib/adminExport.js — dùng chung cho MỌI màn "Xuất Excel"/"Tải Mẫu" 1-sheet qua downloadXlsxFromServer()
// ở core.js) trước đây chỉ String()+cắt 31 ký tự cho sheetName, KHÔNG lọc 7 ký tự Excel cấm trong tên
// sheet (\ / ? * [ ] :) như buildMultiSheetWorkbook() bên cạnh đã làm từ trước — nhãn
// "Chức Danh (Khối VP/HO)" (SIMPLE_CATALOG_EXCEL_CONFIG.jobTitles, module-admin.js, dùng làm sheetName
// qua downloadXlsxFromServer(fileName, cfg.label, ...)) có dấu "/" khiến wb.addWorksheet() ném lỗi ngay,
// route chỉ log console rồi trả về thông báo chung chung "Không thể tạo file Excel" — không rõ nguyên
// nhân thật. Test dưới đây khoá lại CẢ gốc rễ (buildGenericWorkbook với MỌI ký tự cấm) LẪN quét TOÀN BỘ
// SIMPLE_CATALOG_EXCEL_CONFIG hiện có (đọc trực tiếp từ public/js/core.js, không hard-code lại danh
// sách) — bất kỳ danh mục nào sau này lỡ đặt nhãn chứa ký tự cấm cũng bị bắt ngay ở đây, không phải chờ
// người dùng report lại.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildGenericWorkbook, buildMultiSheetWorkbook } = require('../lib/adminExport');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`PASS: ${name}`); }
  catch (e) { fail++; console.log(`FAIL: ${name} — ${e.message}`); }
}

check('buildGenericWorkbook(): sheetName có dấu "/" (đúng lỗi thật đã báo — jobTitles) không ném lỗi', () => {
  const rows = ['Nhân viên', 'Chuyên viên', 'Trưởng phòng'].map(v => ({ name: v }));
  const wb = buildGenericWorkbook('Chức Danh (Khối VP/HO)', [{ key: 'name', header: 'Tên Chức Danh' }], rows);
  assert.strictEqual(wb.worksheets.length, 1);
  assert.ok(!/[\\/?*[\]:]/.test(wb.worksheets[0].name), `tên sheet vẫn còn ký tự cấm: ${wb.worksheets[0].name}`);
});

check('buildGenericWorkbook(): CẢ 7 ký tự Excel cấm trong tên sheet đều không ném lỗi', () => {
  const forbidden = ['\\', '/', '?', '*', '[', ']', ':'];
  for (const ch of forbidden) {
    const wb = buildGenericWorkbook(`Test${ch}Sheet`, [{ key: 'name', header: 'Tên' }], [{ name: 'a' }]);
    assert.ok(!/[\\/?*[\]:]/.test(wb.worksheets[0].name), `ký tự "${ch}" vẫn còn sót trong tên sheet: ${wb.worksheets[0].name}`);
  }
});

check('buildGenericWorkbook(): tên sheet vẫn bị cắt đúng 31 ký tự (không đổi hành vi cũ)', () => {
  const longName = 'A'.repeat(50);
  const wb = buildGenericWorkbook(longName, [{ key: 'name', header: 'Tên' }], []);
  assert.ok(wb.worksheets[0].name.length <= 31, `tên sheet vượt 31 ký tự: ${wb.worksheets[0].name.length}`);
});

// Quét TOÀN BỘ SIMPLE_CATALOG_EXCEL_CONFIG thật (đọc trực tiếp từ core.js) — không hard-code lại danh
// sách nhãn để tránh lệch pha khi ai đó thêm/sửa danh mục mới mà quên cập nhật test.
check('SIMPLE_CATALOG_EXCEL_CONFIG: MỌI nhãn danh mục hiện có đều xuất được Excel (không ai chứa ký tự Excel cấm chưa được xử lý)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'core.js'), 'utf8');
  const block = src.match(/const SIMPLE_CATALOG_EXCEL_CONFIG = \{([\s\S]*?)\n\};/);
  assert.ok(block, 'không tìm thấy SIMPLE_CATALOG_EXCEL_CONFIG trong core.js — kiểm tra lại tên biến/khuôn khai báo có đổi không');
  const labels = [...block[1].matchAll(/label:\s*'([^']*)'/g)].map(m => m[1]);
  assert.ok(labels.length >= 5, `chỉ tìm được ${labels.length} nhãn — có thể regex trích xuất bị lệch`);
  for (const label of labels) {
    assert.doesNotThrow(() => {
      const wb = buildGenericWorkbook(label, [{ key: 'name', header: 'Tên' }], [{ name: 'mẫu' }]);
      assert.strictEqual(wb.worksheets.length, 1);
    }, `nhãn "${label}" khiến buildGenericWorkbook() ném lỗi`);
  }
});

// LỖI THẬT đã vá (12/2026, người dùng báo tab "📦 Tồn Kho" (Kiểm Kê) xuất Excel nhiều sheet — mỗi siêu
// thị 1 sheet, tên sheet = TÊN SIÊU THỊ THẬT do admin tự đặt, không phải nhãn cố định như Ma Trận Phân
// Quyền — báo "Không thể tạo file Excel"): sanitizeSheetNameBase() chỉ lọc 7 ký tự cấm, KHÔNG xử lý 2
// luật khác của exceljs: (1) tên không được bắt đầu/kết thúc bằng dấu nháy đơn ('), (2) tên "History"
// (không phân biệt hoa/thường) bị giữ riêng. Cả 2 lỗi đều ném exception ĐỒNG BỘ ngay tại addWorksheet(),
// route chỉ log console rồi trả lỗi chung chung. Test dưới đây tái hiện ĐÚNG tên siêu thị gây lỗi thật
// ("Cửa hàng 'Thảo Điền'") lẫn mọi biến thể khác của 2 luật trên, cho cả buildGenericWorkbook() (1 sheet)
// lẫn buildMultiSheetWorkbook() (nhiều sheet, đúng luồng Tồn Kho dùng).

check('buildGenericWorkbook(): sheetName có dấu nháy đơn ở đầu/cuối (đúng lỗi thật — tên siêu thị) không ném lỗi', () => {
  const wb = buildGenericWorkbook("Cửa hàng 'Thảo Điền'", [{ key: 'name', header: 'Tên' }], [{ name: 'a' }]);
  assert.strictEqual(wb.worksheets.length, 1);
  assert.ok(!/^'|'$/.test(wb.worksheets[0].name), `tên sheet vẫn còn dấu nháy đơn ở biên: ${wb.worksheets[0].name}`);
});

check('buildGenericWorkbook(): sheetName "History"/"history" (tên Excel giữ riêng) không ném lỗi', () => {
  for (const n of ['History', 'history', 'HISTORY']) {
    const wb = buildGenericWorkbook(n, [{ key: 'name', header: 'Tên' }], [{ name: 'a' }]);
    assert.notStrictEqual(wb.worksheets[0].name.toLowerCase(), 'history', `tên sheet vẫn là "History": ${wb.worksheets[0].name}`);
  }
});

check('buildMultiSheetWorkbook(): nhiều sheet với tên siêu thị thật (dấu nháy đơn, "History", trùng không phân biệt hoa/thường) không ném lỗi', () => {
  const columns = [{ key: 'name', header: 'Tên' }];
  const sheets = [
    { sheetName: "Cửa hàng 24-26 Trần Nhật Duật", columns, rows: [{ name: 'a' }] },
    { sheetName: "Cửa hàng 'Thảo Điền'", columns, rows: [{ name: 'b' }] },
    { sheetName: "Cửa hàng [VIP] Phú Mỹ Hưng", columns, rows: [{ name: 'c' }] },
    { sheetName: 'History', columns, rows: [{ name: 'd' }] },
    { sheetName: "''''", columns, rows: [{ name: 'e' }] },
    { sheetName: "Cùng Tên Kho", columns, rows: [{ name: 'f' }] },
    { sheetName: "cùng tên kho", columns, rows: [{ name: 'g' }] }, // trùng không phân biệt hoa/thường với dòng trên
  ];
  let wb;
  assert.doesNotThrow(() => { wb = buildMultiSheetWorkbook(sheets); }, 'buildMultiSheetWorkbook() ném lỗi với tên siêu thị thật');
  assert.strictEqual(wb.worksheets.length, sheets.length);
  const names = wb.worksheets.map(ws => ws.name);
  const namesLower = names.map(n => n.toLowerCase());
  assert.strictEqual(new Set(namesLower).size, names.length, `vẫn còn tên sheet trùng không phân biệt hoa/thường: ${JSON.stringify(names)}`);
  names.forEach(n => {
    assert.ok(!/^'|'$/.test(n), `tên sheet "${n}" vẫn còn dấu nháy đơn ở biên`);
    assert.notStrictEqual(n.toLowerCase(), 'history', `tên sheet vẫn là "History": ${n}`);
    assert.ok(n.length > 0 && n.length <= 31, `tên sheet "${n}" sai độ dài (0 < len <= 31)`);
  });
});

(async () => {
  // check() ở trên chỉ gọi fn() đồng bộ (không await) — test ghi file .xlsx thật (writeBuffer() là async
  // của exceljs) phải tự await riêng ở ngoài, không dùng chung check() để tránh "pass giả" (fn() trả về
  // Promise ngay lập tức, không throw đồng bộ dù sau đó reject).
  const name = 'buildMultiSheetWorkbook(): xuất ra file .xlsx thật được (writeBuffer không ném lỗi) với tên siêu thị dính cả 2 luật cùng lúc';
  try {
    const columns = [{ key: 'name', header: 'Tên' }];
    const sheets = [
      { sheetName: "'History'", columns, rows: [{ name: 'a' }] }, // vừa dính dấu nháy đơn, vừa trùng "History" sau khi strip
    ];
    const wb = buildMultiSheetWorkbook(sheets);
    const buf = await wb.xlsx.writeBuffer();
    assert.ok(buf.length > 0, 'file .xlsx sinh ra rỗng');
    pass++; console.log(`PASS: ${name}`);
  } catch (e) {
    fail++; console.log(`FAIL: ${name} — ${e.message}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
