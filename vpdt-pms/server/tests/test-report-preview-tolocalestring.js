// server/tests/test-report-preview-tolocalestring.js
//
// Regression test cho Thấp#8 (đợt rà soát chuyên sâu v25.1→v25.70): dòng xây HTML xem trước báo cáo
// (buildReportPreviewDocumentHTML(), public/js/module-baocaoquantri-preview.js) copy-paste nguyên cụm
// options định dạng NGÀY GIỜ (dùng cho new Date().toLocaleString(...) ngay trước đó) sang gọi
// filtered.length.toLocaleString(...) — filtered.length là SỐ DÒNG (một số nguyên), không phải ngày giờ,
// nên cụm options đó hoàn toàn thừa/vô nghĩa ở đây (Number.prototype.toLocaleString() âm thầm bỏ qua
// option lạ nên KHÔNG đổi kết quả hiển thị — xác nhận bằng node -e, xem thêm ghi chú dưới — chỉ là lỗi vệ
// sinh code do copy-paste, không phải lỗi logic/hiển thị sai). Test này xác nhận TRỰC TIẾP trên MÃ NGUỒN
// (không phải hành vi runtime, vì hành vi runtime vốn không đổi) rằng cụm options ngày giờ đã được dọn
// khỏi lệnh gọi toLocaleString() dùng để định dạng SỐ DÒNG.
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

function main() {
  const src = fs.readFileSync(path.join(__dirname, '../public/js/module-baocaoquantri-preview.js'), 'utf8');
  const lineMatch = src.split('\n').find(l => l.includes('Tổng số dòng:'));

  test('LỖI ĐÃ VÁ: dòng "Tổng số dòng" phải có trong file', () => {
    if (!lineMatch) throw new Error('Không tìm thấy dòng "Tổng số dòng" trong module-baocaoquantri-preview.js');
  });

  test('LỖI ĐÃ VÁ: filtered.length.toLocaleString() KHÔNG còn kèm cụm options ngày giờ copy-paste thừa (day/month/year/hour/minute/second/hour12)', () => {
    const m = lineMatch.match(/filtered\.length\.toLocaleString\(([^)]*)\)/);
    if (!m) throw new Error('Không tìm thấy lệnh gọi filtered.length.toLocaleString(...) trong dòng: ' + lineMatch);
    const args = m[1];
    if (/day:|month:|year:|hour:|minute:|second:|hour12:/.test(args)) {
      throw new Error(`Vẫn còn cụm options ngày giờ thừa trong filtered.length.toLocaleString(${args})`);
    }
  });

  test("Xác nhận lý do KHÔNG viết test so sánh hành vi runtime: Number.prototype.toLocaleString() bỏ qua option lạ, output giống hệt dù có/không cụm options ngày giờ thừa", () => {
    const withJunkOptions = (12345).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const clean = (12345).toLocaleString('vi-VN');
    if (withJunkOptions !== clean) throw new Error('Giả định sai — cần viết lại test theo hành vi runtime thay vì kiểm mã nguồn');
  });

  test('new Date().toLocaleString() ngay trước đó vẫn GIỮ NGUYÊN cụm options ngày giờ (không bị xoá nhầm)', () => {
    const m = lineMatch.match(/new Date\(\)\.toLocaleString\(([^)]*)\)/);
    if (!m) throw new Error('Không tìm thấy new Date().toLocaleString(...) trong dòng: ' + lineMatch);
    if (!/day:.*month:.*year:.*hour:.*minute:.*second:.*hour12:/.test(m[1])) {
      throw new Error('Cụm options ngày giờ cho new Date() bị xoá nhầm — chỉ nên xoá ở filtered.length.toLocaleString()');
    }
  });
}

main();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
