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
const { buildGenericWorkbook } = require('../lib/adminExport');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
