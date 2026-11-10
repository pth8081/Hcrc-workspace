'use strict';

// tests/test-appdata-defaults-coverage.js
//
// LỖI ĐÃ VÁ (báo cáo người dùng 11/2026, "Cây Sơ Đồ Tổ Chức" — bấm "Thêm Vào Sơ Đồ" lần ĐẦU TIÊN sau khi
// nâng cấp lên bản có tính năng này báo "⛔ Không thể thêm Phòng Ban"): khoá AppData mới
// "orgChartDiagramNodes" (lib/orgChartDiagramTree.js, giới thiệu v29.78) bị BỎ SÓT khỏi defaults.js lúc
// tạo tính năng. seedDefaults() (chạy mỗi lần khởi động server, xem seedDefaults.js) CHỈ tự chèn dòng vào
// dbo.AppData cho khoá CÓ MẶT trong DEFAULTS — khoá thiếu sẽ KHÔNG BAO GIỜ có dòng trên CSDL thật đã
// triển khai TRƯỚC khi khoá đó được thêm vào defaults.js. GET vẫn chạy được (getAppDataValue(...) || []
// tự có giá trị mặc định khi đọc) nên không ai nhận ra ngay, nhưng MỌI lượt ghi qua
// withLockedAppDataValue(key, ...) (lib/appData.js) đều BẮT BUỘC dòng phải tồn tại sẵn — thiếu thì luôn
// throw "Key không tồn tại trong AppData", sập 500 ngay lần ghi ĐẦU TIÊN.
//
// Test này quét TĨNH (static) toàn bộ routes/+lib/ tìm MỌI lời gọi withLockedAppDataValue('<khoá chữ
// thường>', ...) thật trong code (bỏ qua dòng chú thích '//' để không báo nhầm theo kiểu "leaveBalances"
// — khoá đó CHỈ xuất hiện trong 1 đoạn chú thích giải thích 1 lỗi KHÁC đã vá, không phải lời gọi thật),
// rồi xác nhận MỖI khoá tìm được đều có mặt trong DEFAULTS (defaults.js) — bắt đúng LỚP LỖI "quên thêm
// khoá mới vào defaults.js" trước khi nó lọt lên server thật, không chỉ riêng trường hợp
// orgChartDiagramNodes đã vá.
//
// Chạy: node server/tests/test-appdata-defaults-coverage.js
const fs = require('fs');
const path = require('path');
const { DEFAULTS } = require('../defaults');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ''}`); }
}

function listJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Bỏ dòng chú thích '//...' (naive — đủ dùng cho codebase này, không có chuỗi chứa "//" ngay trước lời
// gọi withLockedAppDataValue thật nào) trước khi so khớp, để không báo nhầm theo khoá chỉ xuất hiện trong
// văn bản giải thích (VD "leaveBalances", xem chú thích đầu file).
function stripLineComments(src) {
  return src.split('\n').map(line => {
    const idx = line.indexOf('//');
    return idx === -1 ? line : line.slice(0, idx);
  }).join('\n');
}

function main() {
  const roots = [path.join(__dirname, '..', 'routes'), path.join(__dirname, '..', 'lib')];
  const foundKeys = new Set();
  const keyToFiles = new Map();
  for (const root of roots) {
    for (const file of listJsFiles(root)) {
      const code = stripLineComments(fs.readFileSync(file, 'utf8'));
      const re = /withLockedAppDataValue\(\s*'([A-Za-z0-9_]+)'/g;
      let m;
      while ((m = re.exec(code))) {
        foundKeys.add(m[1]);
        if (!keyToFiles.has(m[1])) keyToFiles.set(m[1], new Set());
        keyToFiles.get(m[1]).add(path.relative(path.join(__dirname, '..'), file));
      }
    }
  }

  check('Quét được ít nhất 1 khoá withLockedAppDataValue thật trong routes/+lib/ (tự kiểm tra test không rỗng oan)',
    foundKeys.size > 0, `foundKeys.size=${foundKeys.size}`);

  check('"orgChartDiagramNodes" có mặt trong DEFAULTS (bản vá đã xác nhận, không bị lùi lại)',
    'orgChartDiagramNodes' in DEFAULTS);

  const missing = [...foundKeys].filter(k => !(k in DEFAULTS));
  check('MỌI khoá withLockedAppDataValue(...) thật trong routes/+lib/ đều có trong DEFAULTS (defaults.js) — nếu FAIL, seedDefaults() sẽ KHÔNG BAO GIỜ tạo dòng cho khoá đó trên CSDL đã triển khai trước, mọi lượt ghi đầu tiên sẽ sập 500',
    missing.length === 0,
    missing.map(k => `"${k}" thiếu trong DEFAULTS (gọi tại: ${[...(keyToFiles.get(k) || [])].join(', ')})`).join('\n      '));

  console.log('');
  console.log(`==== ${passed}/${passed + failed} scenario(s) passed ====`);
  if (failed > 0) process.exitCode = 1;
}

main();
