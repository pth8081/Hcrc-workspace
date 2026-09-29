// server/tests/test-training-video-layout.js
//
// Regression test THUẦN NODE (đọc file tĩnh, không cần Playwright/YT.Player thật — sandbox chặn mạng
// youtube.com nên không dựng iframe thật được, xem tests/test-training-video-pdf-progress.js) cho lỗi
// ĐÃ VÁ (9/2026, mảng Đào Tạo): modal xem Video bài giảng bị co nhỏ/lệch vị trí so với tiêu đề + cảnh
// báo tốc độ phát bên dưới.
//
// NGUYÊN NHÂN: new YT.Player('trainingVideoPlayerMount', {...}) (public/js/module-internalcomms-daotao.js)
// THAY THẾ HẲN div mount bằng 1 <iframe> trần — nếu div đó tự mang class `video-16-9`/`w-full`/`bg-black`
// thì các class đó MẤT LUÔN theo, vì iframe mới không kế thừa class của div cũ.
//
// VÁ: tách thành 1 WRAPPER ngoài giữ cố định `video-16-9 w-full bg-black ...` (KHÔNG bị YT.Player đụng
// tới) bọc 1 div CON rỗng id="trainingVideoPlayerMount" (chỉ div con này bị thay bằng iframe).
//
// Chạy: node server/tests/test-training-video-layout.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passed = 0, failed = 0;
function run(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); }
  catch (err) { failed++; console.error(`FAIL  ${name}\n      ${err && err.stack ? err.stack : err}`); }
}

const fragmentPath = path.join(__dirname, '..', 'public', 'fragments', 'internalSection.html');
const jsPath = path.join(__dirname, '..', 'public', 'js', 'module-internalcomms-daotao.js');
const fragmentHtml = fs.readFileSync(fragmentPath, 'utf8');
const jsSrc = fs.readFileSync(jsPath, 'utf8');

run('internalSection.html: có 1 WRAPPER ngoài mang video-16-9/w-full/bg-black, bọc div con rỗng id=trainingVideoPlayerMount', () => {
  // Không còn khuôn CŨ (lỗi): chính div#trainingVideoPlayerMount tự mang class video-16-9 -> mất class khi
  // YT.Player thay nó bằng iframe.
  assert.ok(
    !/<div id="trainingVideoPlayerMount"[^>]*\bvideo-16-9\b/.test(fragmentHtml),
    'div#trainingVideoPlayerMount KHÔNG được tự mang class video-16-9 nữa (phải để ở wrapper ngoài)'
  );
  // Khuôn ĐÚNG: 1 div ngoài (không có id, hoặc id khác) mang đủ 3 class, bọc trực tiếp div con
  // id="trainingVideoPlayerMount" rỗng.
  const wrapperMatch = fragmentHtml.match(/<div class="[^"]*\bvideo-16-9\b[^"]*">\s*<div id="trainingVideoPlayerMount"[^>]*><\/div>\s*<\/div>/);
  assert.ok(wrapperMatch, 'phải có wrapper <div class="...video-16-9..."><div id="trainingVideoPlayerMount" ...></div></div>');
  const wrapperClass = wrapperMatch[0].match(/<div class="([^"]*)"/)[1];
  ['video-16-9', 'w-full', 'bg-black'].forEach(cls => {
    assert.ok(wrapperClass.split(/\s+/).includes(cls), `wrapper phải giữ class "${cls}" (đã thấy: "${wrapperClass}")`);
  });
});

run('module-internalcomms-daotao.js: new YT.Player(...) vẫn nhắm đúng id trainingVideoPlayerMount, width/height 100%', () => {
  const m = jsSrc.match(/new YT\.Player\('trainingVideoPlayerMount',\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s);
  assert.ok(m, 'phải tìm thấy new YT.Player(\'trainingVideoPlayerMount\', {...}) trong file');
  assert.ok(/width:\s*'100%'/.test(m[1]) && /height:\s*'100%'/.test(m[1]), 'YT.Player phải dùng width:\'100%\', height:\'100%\' (để lấp đầy wrapper 16:9 ổn định, không co lại theo kích thước mặc định của Youtube)');
});

console.log('');
console.log(`test-training-video-layout.js: ${passed}/${passed + failed} scenarios passed.`);
if (failed > 0) process.exitCode = 1;
